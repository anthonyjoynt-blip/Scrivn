import "server-only";
import { Resend } from "resend";
import type { ReactElement } from "react";
import { cleanEnv } from "../env";

/**
 * The app's own outgoing email, via Resend.
 *
 * SEPARATE FROM SUPABASE'S EMAIL. Supabase sends the two auth emails (confirm address, reset
 * password) through its own SMTP configuration, which also happens to point at Resend. That setup
 * lives in the Supabase dashboard and uses a different key. Nothing here touches it — these are the
 * emails the application itself decides to send.
 *
 * `server-only` makes importing this from client code a build error: RESEND_API_KEY can send mail
 * as this domain, so it must never reach the browser.
 */

/**
 * The From domain, which must match a domain verified in the Resend account exactly — Resend does
 * not let a verified domain cover its own subdomains. `scrivn.ca` is what's registered there, so
 * that's what this has to be.
 *
 * Why the root domain is correct even though it publishes `v=spf1 -all`: SPF is evaluated against
 * the *envelope* sender (Return-Path), not the From header. Resend sets the envelope to its own
 * `send.scrivn.ca` subdomain, which is a CNAME to Resend's infrastructure and inherits its SPF —
 * so SPF passes there while the root's `-all` continues to do its real job of stopping anyone
 * forging @scrivn.ca through any other route. Authentication then aligns via DKIM:
 * `resend._domainkey.scrivn.ca` signs as d=scrivn.ca, matching the From domain.
 *
 * `send.scrivn.ca` is therefore Resend's return-path, NOT a sending identity. Sending as
 * @send.scrivn.ca is rejected outright, because no such domain is registered in the account.
 *
 * A constant rather than a configurable: it's determined by the DNS and the Resend account, and a
 * wrong value fails every send rather than degrading.
 */
export const SENDING_DOMAIN = "scrivn.ca";
const FROM = `Scrivn <no-reply@${SENDING_DOMAIN}>`;

let cached: Resend | undefined;

function getResend(): Resend {
  if (!cleanEnv("RESEND_API_KEY")) {
    throw new Error("RESEND_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  }
  cached ??= new Resend(cleanEnv("RESEND_API_KEY"));
  return cached;
}

export function isEmailConfigured(): boolean {
  return Boolean(cleanEnv("RESEND_API_KEY"));
}

export interface Attachment {
  filename: string;
  /** Base64-encoded file contents — what Resend's API expects. */
  content: string;
}

/**
 * Sends one email. Returns whether it went out rather than throwing.
 *
 * Deliberately non-throwing: every caller here is a side effect attached to something more
 * important (a confirmed signup, a completed generation). A transient Resend outage must never turn
 * a successful generation into a failed request — the user's actual work matters more than the
 * notification about it. Failures are logged for diagnosis instead.
 *
 * The one caller that *does* care whether it worked is `/api/send-documents`, where sending IS the
 * user's request — that route surfaces the false to the UI rather than reporting success.
 */
/**
 * Why this reports the reason and not just false.
 *
 * It used to return a boolean, and the real cause went only to the server console. A live failure
 * read "The email couldn't be sent. Check the address and try again." while the log said:
 *
 *   TypeError: Cannot convert argument to a ByteString because the character at index 7
 *   has a value of 65279
 *
 * — a byte-order mark in the API key. The address was fine; the message sent the user to check the
 * one thing that was not wrong, and nothing visible to them would ever have said otherwise.
 *
 * The lifecycle emails still ignore this: a welcome message that fails is not the user's problem.
 * The send-documents route is the opposite — sending is what they asked for — and its own doc
 * comment already promised the result would be "reported honestly rather than swallowed", which a
 * boolean cannot do.
 */
export type SendResult = { ok: true } | { ok: false; reason: string };

export async function sendEmail(params: { to: string | string[]; subject: string; react: ReactElement; attachments?: Attachment[]; replyTo?: string }): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.warn("[email] RESEND_API_KEY not set — skipping send:", params.subject);
    return { ok: false, reason: "Email is not configured on this deployment." };
  }

  try {
    const { error } = await getResend().emails.send({
      from: FROM,
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      react: params.react,
      ...(params.attachments ? { attachments: params.attachments } : {}),
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    });

    if (error) {
      console.error("[email] Resend rejected the send:", error);
      return { ok: false, reason: error.message || "The email provider rejected the message." };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { ok: false, reason: err instanceof Error ? err.message : "Unexpected error while sending." };
  }
}
