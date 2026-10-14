import "server-only";
import { createAdminClient } from "./supabase/admin";
import { isSupabaseConfigured } from "./supabase/env";
import { cleanEnv } from "./env";
import { isBillingSchemaMissing } from "./usageState";
import { sendEmail } from "./email/send";
import { alarmThreshold, estimateUsd, spendDay, type TokenUsage } from "./aiPricing";
import { AiSpendAlarmEmail } from "@/emails/AiSpendAlarm";

/**
 * The AI spending alarm (b-guard): every Claude call's tokens, priced (lib/aiPricing.ts) and added to
 * the day's total (`ai_spend_add`, 0013); the call that takes the day past AI_SPEND_ALARM_USD emails
 * AI_SPEND_ALARM_EMAIL (CONTACT_EMAIL when that is unset), once that day.
 *
 * It watches; it does not stop anything. The hard stop is the Anthropic console's own spend limit,
 * which only the owner can set. Recording never fails a call: everything here is caught and logged,
 * and with no Supabase, no service key or no 0013 it does nothing.
 */
export async function recordAiSpend(model: string, usage: TokenUsage, now: Date = new Date()): Promise<void> {
  if (!isSupabaseConfigured() || !cleanEnv("SUPABASE_SERVICE_ROLE_KEY")) return;
  try {
    const usd = estimateUsd(model, usage, process.env);
    const day = spendDay(now, cleanEnv("AI_SPEND_TIMEZONE"));
    const threshold = alarmThreshold(process.env);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("ai_spend_add", {
      day,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_write_tokens: usage.cacheCreationTokens,
      cache_read_tokens: usage.cacheReadTokens,
      usd: Number(usd.toFixed(6)),
      alarm_usd: threshold,
    });
    if (error) {
      if (!isBillingSchemaMissing(error)) console.error("[ai spend] could not record a call:", error.message);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { total_usd: number | string; calls: number; alarm: boolean } | null;
    if (!row?.alarm || threshold === null) return;

    const to = cleanEnv("AI_SPEND_ALARM_EMAIL") || cleanEnv("CONTACT_EMAIL");
    const total = Number(row.total_usd);
    const sent = to
      ? await sendEmail({
          to,
          subject: `Scrivn AI spend: about US$${total.toFixed(2)} today`,
          react: AiSpendAlarmEmail({ day, totalUsd: total, thresholdUsd: threshold, calls: row.calls }),
        })
      : { ok: false as const, reason: "AI_SPEND_ALARM_EMAIL is not set" };
    if (!sent.ok) {
      console.error(`[ai spend] US$${total.toFixed(2)} today is over the alarm, and the email did not go: ${sent.reason}`);
      // Given back, so the next call tries the email again.
      await admin.rpc("ai_spend_alarm_unsent", { day });
    }
  } catch (err) {
    console.error("[ai spend] could not record a call:", err);
  }
}
