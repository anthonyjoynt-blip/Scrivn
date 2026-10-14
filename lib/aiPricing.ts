/**
 * What a Claude call costs, estimated from the tokens it reports — the arithmetic half of the AI
 * spending alarm (lib/aiSpend.ts), pure so `npm run test:scanaccounts` can check it.
 *
 * AN ESTIMATE. The Anthropic console is the authority on what was spent, and its own spend limits
 * (Settings → Limits) are the hard stop; this only notices a bad day early and emails the owner.
 *
 * Prices are US dollars per million tokens, Anthropic's first-party rates as of 2026-10-06. A cache
 * WRITE (the five-minute cache lib/anthropic.ts uses) is 1.25 times the input rate; a cache READ is
 * the model's own read rate. A model not listed is priced as Opus 5.5, the default, and the four
 * AI_PRICE_* variables override whatever is listed, for the day prices change before this file does.
 */

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
};

export const DEFAULT_PRICED_MODEL = "claude-opus-5-5";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

function rate(raw: string | undefined): number | null {
  const text = raw?.replace(/﻿/g, "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The price for `model`, with any AI_PRICE_* override applied. */
export function priceFor(model: string, env: Record<string, string | undefined> = {}): ModelPrice {
  const listed = MODEL_PRICES[model] ?? MODEL_PRICES[DEFAULT_PRICED_MODEL]!;
  return {
    input: rate(env.AI_PRICE_INPUT_PER_MTOK) ?? listed.input,
    output: rate(env.AI_PRICE_OUTPUT_PER_MTOK) ?? listed.output,
    cacheWrite: rate(env.AI_PRICE_CACHE_WRITE_PER_MTOK) ?? listed.cacheWrite,
    cacheRead: rate(env.AI_PRICE_CACHE_READ_PER_MTOK) ?? listed.cacheRead,
  };
}

/** US dollars for one call. */
export function estimateUsd(model: string, usage: TokenUsage, env: Record<string, string | undefined> = {}): number {
  const p = priceFor(model, env);
  const count = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return (
    (count(usage.inputTokens) * p.input +
      count(usage.outputTokens) * p.output +
      count(usage.cacheCreationTokens) * p.cacheWrite +
      count(usage.cacheReadTokens) * p.cacheRead) /
    1_000_000
  );
}

/** The alarm's threshold in US dollars a day, or null when AI_SPEND_ALARM_USD is unset, zero or not a number. */
export function alarmThreshold(env: Record<string, string | undefined>): number | null {
  const n = rate(env.AI_SPEND_ALARM_USD);
  return n !== null && n > 0 ? n : null;
}

/** The owner's day, YYYY-MM-DD, in `timeZone` (AI_SPEND_TIMEZONE, America/Edmonton by default). */
export function spendDay(at: Date, timeZone: string | undefined): string {
  const zone = timeZone?.trim() || "America/Edmonton";
  try {
    return at.toLocaleDateString("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    // An unknown zone name: the UTC day rather than no alarm at all.
    return at.toISOString().slice(0, 10);
  }
}
