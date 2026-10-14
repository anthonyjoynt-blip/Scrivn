import { createHash } from "node:crypto";

/**
 * The guards' arithmetic and wording, without a database (lib/requestGuard.ts counts): whose
 * attempt this is, as a hash; an email address as the free trial knows it; and the limits, read from
 * the environment so the owner can tune them without a deploy of code.
 *
 * ── The limits (b-guard, launch checklist) ───────────────────────────────────────────────────────
 *
 *   SIGNUP_LIMIT_PER_IP_PER_DAY      new accounts from one address in a day         default 3
 *   SIGNUP_LIMIT_PER_DAY             new accounts from everywhere in a day          default 25
 *   SIGNIN_LIMIT_PER_IP_PER_HOUR     phone sign-ins from one address in an hour     default 30
 *   SIGNIN_LIMIT_PER_EMAIL_PER_HOUR  phone sign-ins to one email in an hour         default 10
 *
 * A value that is not a whole number of at least 0 is ignored and the default stands, so a typo
 * never opens a door. 0 refuses everything of that kind.
 *
 * Days and hours are fixed windows (midnight to midnight UTC, the top of the hour), not rolling:
 * a burst across the boundary can reach twice a limit, which is fine for numbers this size.
 */

export interface GuardLimits {
  signupPerIpPerDay: number;
  signupPerDay: number;
  signinPerIpPerHour: number;
  signinPerEmailPerHour: number;
}

export const DEFAULT_GUARD_LIMITS: GuardLimits = {
  signupPerIpPerDay: 3,
  signupPerDay: 25,
  signinPerIpPerHour: 30,
  signinPerEmailPerHour: 10,
};

function wholeNumber(raw: string | undefined, fallback: number): number {
  const text = raw?.replace(/﻿/g, "").trim();
  if (!text || !/^\d{1,7}$/.test(text)) return fallback;
  return Number(text);
}

export function guardLimits(env: Record<string, string | undefined>): GuardLimits {
  return {
    signupPerIpPerDay: wholeNumber(env.SIGNUP_LIMIT_PER_IP_PER_DAY, DEFAULT_GUARD_LIMITS.signupPerIpPerDay),
    signupPerDay: wholeNumber(env.SIGNUP_LIMIT_PER_DAY, DEFAULT_GUARD_LIMITS.signupPerDay),
    signinPerIpPerHour: wholeNumber(env.SIGNIN_LIMIT_PER_IP_PER_HOUR, DEFAULT_GUARD_LIMITS.signinPerIpPerHour),
    signinPerEmailPerHour: wholeNumber(env.SIGNIN_LIMIT_PER_EMAIL_PER_HOUR, DEFAULT_GUARD_LIMITS.signinPerEmailPerHour),
  };
}

/**
 * The caller's address. On Vercel the first entry of x-forwarded-for is the client, written by
 * Vercel's edge (a client cannot put its own value in front of it). Elsewhere it is whatever the
 * proxy says; "unknown" when nothing does, which all such callers then share.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

/**
 * A value as the guards store it: SHA-256 of a purpose, a secret and the value, hex. Nothing in the
 * tables can be read back into an address or an email. GUARD_HASH_SECRET, when set, makes the hashes
 * useless to anyone who reads the table without it; unset, they are still one-way.
 */
export function guardHash(purpose: string, value: string, secret: string | undefined): string {
  return createHash("sha256").update(`scrivn-guard:${purpose}:${secret ?? ""}:${value}`, "utf8").digest("hex");
}

/**
 * An email address as the free trial knows it: one trial per mailbox, not per spelling. Lower case
 * and trimmed; "+anything" before the @ dropped (most providers deliver a+b@ to a@); and for Gmail,
 * the dots in the name dropped and googlemail.com read as gmail.com, since Gmail ignores both.
 */
export function normaliseEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return trimmed;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Good enough to catch a typo before Supabase does; the confirmation email is the real test. */
export function looksLikeEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** The same floor the sign-up page states. Supabase's own is 6. */
export const MIN_PASSWORD_LENGTH = 8;

/** "in 14 minutes" / "tomorrow": when a refused attempt may try again, for the sentence. */
export function retryWords(retryAt: Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return minutes === 1 ? "in a minute" : `in ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours < 20 ? `in about ${hours} hours` : "tomorrow";
}
