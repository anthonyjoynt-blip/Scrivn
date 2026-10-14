import "server-only";
import { createAdminClient } from "./supabase/admin";
import { cleanEnv } from "./env";
import { isBillingSchemaMissing } from "./usageState";
import { guardHash, guardLimits, retryWords, type GuardLimits } from "./guardRules";

/**
 * The counted half of the guards (the rules and numbers are lib/guardRules.ts): one call per
 * attempt, through `request_limit_hit` (0014_scan_accounts.sql), which counts it in its window and
 * says whether it is within the limit. Durable and shared between serverless instances, unlike the
 * contact form's in-memory throttle, because these guard accounts and money rather than an inbox.
 *
 * FAILS OPEN when the database cannot answer — the migration not applied, or Supabase down. A guard
 * that refused everyone whenever the database blinked would lock every phone out of signing in; the
 * limits are a brake on abuse, and Supabase's own per-address limits stand behind them. Each such
 * pass is logged.
 */

export class TooManyAttemptsError extends Error {
  constructor(
    message: string,
    readonly retryAt: Date,
  ) {
    super(message);
    this.name = "TooManyAttemptsError";
  }
}

export function currentGuardLimits(): GuardLimits {
  return guardLimits(process.env);
}

export function hashForGuard(purpose: string, value: string): string {
  return guardHash(purpose, value, cleanEnv("GUARD_HASH_SECRET"));
}

/** One attempt in `bucket` for `key`. Resolves to the time it may try again when over `max`, else null. */
export async function hitLimit(bucket: string, key: string, windowSeconds: number, max: number): Promise<Date | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("request_limit_hit", { bucket, key, window_seconds: windowSeconds, max_hits: max });
    if (error) {
      if (!isBillingSchemaMissing(error)) console.error(`[guard] ${bucket} could not be counted; letting it through:`, error.message);
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; retry_at?: string } | null;
    if (!row || row.allowed !== false) return null;
    return row.retry_at ? new Date(row.retry_at) : new Date(Date.now() + windowSeconds * 1000);
  } catch (err) {
    console.error(`[guard] ${bucket} could not be counted; letting it through:`, err);
    return null;
  }
}

const DAY = 86_400;
const HOUR = 3_600;

/**
 * A new account from `ip`: refused past the per-address and the everyone-together limits for the day.
 * Both are counted on every attempt, so the second check cannot be skipped by the first one refusing.
 */
export async function guardSignup(ip: string): Promise<void> {
  const limits = currentGuardLimits();
  const [mine, all] = await Promise.all([
    hitLimit("signup-ip", hashForGuard("ip", ip), DAY, limits.signupPerIpPerDay),
    hitLimit("signup-day", "all", DAY, limits.signupPerDay),
  ]);
  if (mine) throw new TooManyAttemptsError(`Too many new accounts from this connection today. Try again ${retryWords(mine)}.`, mine);
  if (all) throw new TooManyAttemptsError(`Scrivn isn't taking more new accounts today. Try again ${retryWords(all)}.`, all);
}

/** A phone signing in: refused past the per-address and per-email limits for the hour. */
export async function guardSignIn(ip: string, email: string): Promise<void> {
  const limits = currentGuardLimits();
  const [mine, theirs] = await Promise.all([
    hitLimit("signin-ip", hashForGuard("ip", ip), HOUR, limits.signinPerIpPerHour),
    hitLimit("signin-email", hashForGuard("email", email.trim().toLowerCase()), HOUR, limits.signinPerEmailPerHour),
  ]);
  const until = mine ?? theirs;
  if (until) throw new TooManyAttemptsError(`Too many sign-in attempts. Try again ${retryWords(until)}.`, until);
}
