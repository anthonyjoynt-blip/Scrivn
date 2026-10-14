import "server-only";
import { createAdminClient } from "./supabase/admin";
import { isEmailConfigured, sendEmail } from "./email/send";
import { isBillingSchemaMissing } from "./usageState";
import { TRIAL_CLAIM_LIMIT } from "./plans";
import { MIN_PASSWORD_LENGTH, looksLikeEmail, normaliseEmail } from "./guardRules";
import { guardSignup, hashForGuard } from "./requestGuard";
import { ConfirmSignupEmail } from "@/emails/ConfirmSignup";
import { AccountExistsEmail } from "@/emails/AccountExists";

/**
 * Making a Scrivn account — from the website's sign-up page and from Scrivn Scan's "Create an
 * account" — through one door, on the server.
 *
 * ── Why on the server ────────────────────────────────────────────────────────────────────────────
 *
 * Sign-up used to run in the browser against Supabase's public key, which made every check in front
 * of it honesty rather than enforcement (SIGNUPS.md): anyone could call `auth.signUp` directly. The
 * guards the launch needs — so many new accounts per address per day, so many in all, one free trial
 * per mailbox — only hold if nothing can make an account around them. So the account is made here
 * with Supabase's admin API, and Supabase's own "Allow new users to sign up" stays OFF for good: the
 * admin API is not subject to it, and the public key can then make no account at all.
 *
 * Supabase sends no email for an account made this way, so this sends the confirmation itself, with
 * the same /auth/confirm link Supabase's template carried (`type=email`, which confirms the address
 * and signs them in; app/(app)/auth/confirm starts the trial and sends the welcome, as before).
 *
 * ── The gate ─────────────────────────────────────────────────────────────────────────────────────
 *
 * NEXT_PUBLIC_SIGNUPS_OPEN, exactly as the sign-up page reads it: closed unless it is "true". The
 * phone asks the same question (`signupsOpen`), so it shows the invitation sentence instead of a form
 * while it is closed, and opening sign-up on the website opens it in the app too.
 *
 * ── Who already has an account ───────────────────────────────────────────────────────────────────
 *
 * The answer is the same whether or not the address had one — "check your email" — so the form
 * cannot be used to learn who has an account. An unconfirmed account gets its confirmation again; a
 * confirmed one gets an email saying it already exists.
 */

export class SignupsClosedError extends Error {
  constructor() {
    super("Scrivn accounts are by invitation for now. If you've been given one, sign in. To ask for one, write to us at scrivn.ca/contact.");
    this.name = "SignupsClosedError";
  }
}

export class SignupInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignupInvalidError";
  }
}

export class SignupEmailFailedError extends Error {
  constructor() {
    super("We couldn't send the confirmation email just now. Try again in a minute.");
    this.name = "SignupEmailFailedError";
  }
}

/** Fails closed, like the page: open only on the exact string "true". */
export function signupsOpen(): boolean {
  return process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "true";
}

export interface SignupInput {
  email: string;
  password: string;
  fullName: string;
  companyName?: string;
  /** Where the confirmation link lands after signing in; a path on this site. */
  next?: string;
  /** Made from Scrivn Scan: the email says to go back to the app. */
  forScan?: boolean;
  ip: string;
  /** This deployment's origin, for the link. */
  origin: string;
}

/** Only ever a path on this site — the same rule as app/(app)/auth/confirm. */
export function safeNextPath(value: string | null | undefined, fallback = "/claim"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

function validate(input: SignupInput): { email: string; fullName: string; companyName: string } {
  const email = input.email.trim();
  const fullName = input.fullName.trim();
  const companyName = (input.companyName ?? "").trim();
  if (!looksLikeEmail(email)) throw new SignupInvalidError("That email address doesn't look right.");
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new SignupInvalidError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (input.password.length > 72) throw new SignupInvalidError("Password must be 72 characters or fewer.");
  if (fullName === "") throw new SignupInvalidError("Enter your name.");
  if (fullName.length > 120 || companyName.length > 160) throw new SignupInvalidError("That name is too long.");
  return { email, fullName, companyName };
}

function confirmUrl(origin: string, next: string, hashedToken: string): string {
  return `${origin}/auth/confirm?next=${encodeURIComponent(next)}&token_hash=${encodeURIComponent(hashedToken)}&type=email`;
}

async function deliver(to: string, subject: string, react: React.ReactElement, devLine: string): Promise<boolean> {
  if (!isEmailConfigured() && process.env.NODE_ENV !== "production") {
    // Local development with no Resend key: the link is what a person needs to go on testing.
    console.warn(`[signup] email not configured; ${devLine}`);
    return true;
  }
  return (await sendEmail({ to, subject, react })).ok;
}

/**
 * A new account, or the right email for an address that has one. Throws a sentence for the form
 * when the gate is shut, a field is wrong, a guard refuses, or the email cannot be sent.
 */
export async function createAccount(input: SignupInput): Promise<void> {
  if (!signupsOpen()) throw new SignupsClosedError();
  const { email, fullName, companyName } = validate(input);
  await guardSignup(input.ip);

  const admin = createAdminClient();
  const next = safeNextPath(input.next, input.forScan ? "/scan/ready" : "/claim");

  const created = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: false,
    user_metadata: { full_name: fullName, company_name: companyName },
  });

  if (created.error) {
    if (created.error.code !== "email_exists" && created.error.status !== 422) throw new Error(`could not make the account: ${created.error.message}`);
    // Already there. Unconfirmed: its confirmation again. Confirmed: "you already have one".
    const again = await admin.auth.admin.generateLink({ type: "signup", email, password: input.password, options: { data: { full_name: fullName, company_name: companyName }, redirectTo: `${input.origin}${next}` } });
    if (again.error || !again.data.properties?.hashed_token) {
      const ok = await deliver(
        email,
        "You already have a Scrivn account",
        AccountExistsEmail({ loginUrl: `${input.origin}/login`, resetUrl: `${input.origin}/forgot-password` }),
        `${email} already has an account`,
      );
      if (!ok) throw new SignupEmailFailedError();
      return;
    }
    const url = confirmUrl(input.origin, next, again.data.properties.hashed_token);
    if (!(await deliver(email, "Confirm your email for Scrivn", ConfirmSignupEmail({ fullName, confirmUrl: url, forScan: input.forScan === true }), `confirm ${email} at ${url}`))) {
      throw new SignupEmailFailedError();
    }
    return;
  }

  const userId = created.data.user.id;

  // One free trial per mailbox: an address that has had one before starts with it spent.
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

  const link = await admin.auth.admin.generateLink({ type: "signup", email, password: input.password, options: { data: { full_name: fullName, company_name: companyName }, redirectTo: `${input.origin}${next}` } });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error(`could not make the confirmation link: ${link.error?.message ?? "no token"}`);
  const url = confirmUrl(input.origin, next, hashed);
  if (!(await deliver(email, "Confirm your email for Scrivn", ConfirmSignupEmail({ fullName, confirmUrl: url, forScan: input.forScan === true }), `confirm ${email} at ${url}`))) {
    throw new SignupEmailFailedError();
  }
}
