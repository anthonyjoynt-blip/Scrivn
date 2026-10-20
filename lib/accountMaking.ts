import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isBillingSchemaMissing } from "./usageState";
import { TRIAL_CLAIM_LIMIT } from "./plans";
import { normaliseEmail } from "./guardRules";
import { hashForGuard } from "./requestGuard";

/**
 * The steps that make a Scrivn account, in one place: sign-up (lib/signup.ts, from the website and
 * from Scrivn Scan) and the owner's tester script (scripts/add-tester.mjs, lib/testerAccounts.ts) both
 * call `makeAccount`, so an account made either way is the same account.
 *
 *   1. The auth user, through Supabase's admin API, with the name and company in its metadata.
 *   2. The database trigger on that insert (`handle_new_user`, 0001 → 0004 → 0012) makes the rest:
 *      the profile, the person's own organization (named after the company, else the name), and their
 *      owner membership of it. Nothing here writes those rows — a second path doing so would drift.
 *   3. One free trial per mailbox: an address that has had one before starts with it spent.
 *
 * What differs between the two callers is only how the person gets in: sign-up sets their password
 * and emails a confirmation link; a tester's account is made confirmed with no password, and they set
 * one with Forgot password.
 */

export const MAX_FULL_NAME_LENGTH = 120;
export const MAX_COMPANY_NAME_LENGTH = 160;

/** What the trigger names the person's own organization (0012 handle_new_user), for saying so beforehand. */
export function organizationNameFor(fullName: string, companyName: string): string {
  return companyName.trim() || fullName.trim() || "My organization";
}

/** The auth user's metadata, which the trigger copies into the profile and the organization's name. */
export function accountMetadata(fullName: string, companyName: string): { full_name: string; company_name: string } {
  return { full_name: fullName, company_name: companyName };
}

export interface NewAccount {
  email: string;
  /** Left out, the account has no password until its owner sets one (Forgot password). */
  password?: string;
  emailConfirmed: boolean;
  fullName: string;
  companyName: string;
  /** Marks only the service role can write (the auth user's app_metadata); the person cannot change them. */
  appMetadata?: Record<string, unknown>;
}

export type MadeAccount = { made: true; userId: string } | { made: false; message: string };

/**
 * A new account, or `made: false` when Supabase says the address already has one (sign-up then sends
 * the right email for that). Throws on anything else.
 */
export async function makeAccount(admin: SupabaseClient, account: NewAccount): Promise<MadeAccount> {
  const created = await admin.auth.admin.createUser({
    email: account.email,
    ...(account.password !== undefined ? { password: account.password } : {}),
    email_confirm: account.emailConfirmed,
    user_metadata: accountMetadata(account.fullName, account.companyName),
    ...(account.appMetadata ? { app_metadata: account.appMetadata } : {}),
  });

  if (created.error) {
    if (created.error.code !== "email_exists" && created.error.status !== 422) throw new Error(`could not make the account: ${created.error.message}`);
    return { made: false, message: created.error.message };
  }

  const userId = created.data.user.id;
  await spendRepeatTrial(admin, userId, account.email);
  return { made: true, userId };
}

/** One free trial per mailbox: an address that has had one before starts with it spent. Never fails the account. */
async function spendRepeatTrial(admin: SupabaseClient, userId: string, email: string): Promise<void> {
  try {
    const { data: seen, error } = await admin.rpc("trial_email_seen", { email_hash: hashForGuard("trial-email", normaliseEmail(email)) });
    if (error && !isBillingSchemaMissing(error)) console.error("[signup] could not check the trial address:", error.message);
    if (seen === true) {
      const { error: spendError } = await admin.from("organizations").update({ trial_claims_used: TRIAL_CLAIM_LIMIT }).eq("personal_for", userId);
      if (spendError) console.error("[signup] could not mark the repeat trial spent:", spendError.message);
    }
  } catch (err) {
    console.error("[signup] the trial check failed:", err);
  }
}
