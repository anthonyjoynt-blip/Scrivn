import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { looksLikeEmail } from "./guardRules";
import { MAX_COMPANY_NAME_LENGTH, MAX_FULL_NAME_LENGTH, makeAccount, organizationNameFor } from "./accountMaking";

/**
 * Giving a tester a Scrivn account while sign-up is shut (NEXT_PUBLIC_SIGNUPS_OPEN, SIGNUPS.md):
 *
 *   node scripts/add-tester.mjs jane@example.com --name "Jane Smith" --company "Smith Restoration"
 *   node scripts/list-testers.mjs
 *
 * Run from this machine with the service-role key in .env.local. The account is made by the same
 * steps as a sign-up (lib/accountMaking.ts: the user, then the trigger's profile, own organization and
 * owner membership, then the one-trial-per-mailbox check), so it is the same account. Only the way in
 * differs, and no password ever passes through us:
 *
 *   - the email is confirmed from the start (we were given it by the person who invited them), and
 *     there is no password, so nobody can sign in until the tester sets one;
 *   - they get one plain-text email from no-reply@scrivn.ca, with no links (the owner's rule for
 *     Canada: scrivn.ca is named as plain words), telling them to set it with Forgot password, the
 *     site's own flow (Supabase's recovery email, /auth/confirm, /reset-password);
 *   - `--no-email` leaves the telling to the owner.
 *
 * Safe to repeat: an address that already has an account, however it was made, is reported and left
 * exactly as it is. `--dry-run` reads only.
 *
 * The welcome a sign-up gets when it confirms (app/(app)/auth/confirm) is not sent: this email takes
 * its place. The trial window starts when the account is made, which for a tester is the moment it is
 * confirmed too — the column's own default, as sign-up's confirmation would set it.
 *
 * Each account is marked in its app_metadata — `invited_by: "add-tester"` and when — which only the
 * service role can write, so list-testers finds them and a tester cannot unmark themselves.
 */

export const TESTER_MARK = "add-tester";

/** A refusal before anything is touched: a bad address or name. The script prints it and stops. */
export class TesterInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TesterInputError";
  }
}

export interface TesterRequest {
  email: string;
  fullName?: string;
  companyName?: string;
}

export interface TesterPlan {
  email: string;
  fullName: string;
  companyName: string;
  /** What the trigger will name their organization. */
  organizationName: string;
  appMetadata: { invited_by: typeof TESTER_MARK; invited_at: string };
}

export interface AccountSummary {
  id: string;
  email: string;
  fullName: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  madeByAddTester: boolean;
}

export interface TesterMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendText = (message: TesterMessage) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type AddTesterResult =
  | { outcome: "exists"; plan: TesterPlan; account: AccountSummary }
  | { outcome: "dry-run"; plan: TesterPlan; message: TesterMessage }
  | {
      outcome: "made";
      plan: TesterPlan;
      userId: string;
      organization: { name: string; role: string } | null;
      message: TesterMessage;
      emailed: { sent: true } | { sent: false; reason: string } | null;
    };

/** The address and names checked and tidied, and what will be made. Throws TesterInputError. */
export function planTester(request: TesterRequest, now = new Date()): TesterPlan {
  const email = request.email.trim().toLowerCase();
  const fullName = (request.fullName ?? "").trim();
  const companyName = (request.companyName ?? "").trim();
  if (!looksLikeEmail(email)) throw new TesterInputError(`That email address doesn't look right: ${request.email.trim() || "(none given)"}`);
  if (fullName.length > MAX_FULL_NAME_LENGTH) throw new TesterInputError(`The name is too long (at most ${MAX_FULL_NAME_LENGTH} characters).`);
  if (companyName.length > MAX_COMPANY_NAME_LENGTH) throw new TesterInputError(`The company name is too long (at most ${MAX_COMPANY_NAME_LENGTH} characters).`);
  return {
    email,
    fullName,
    companyName,
    organizationName: organizationNameFor(fullName, companyName),
    appMetadata: { invited_by: TESTER_MARK, invited_at: now.toISOString() },
  };
}

/**
 * The one email a tester gets. Plain text, no links: scrivn.ca and the page are written as words, as
 * the sign-up refusal writes scrivn.ca/contact. The site's home page has no Sign in button, so it
 * names the Forgot password page itself rather than a path through other pages.
 */
export function testerEmail(plan: Pick<TesterPlan, "email" | "fullName">): TesterMessage {
  const first = plan.fullName.split(/\s+/)[0] ?? "";
  const text = [
    first ? `Hi ${first},` : "Hello,",
    "",
    "You've been set up with a Scrivn account to try it out.",
    "",
    "To get in, set your password:",
    `1. Go to scrivn.ca/forgot-password and enter this email address (${plan.email}).`,
    "2. Open the email that comes next and choose a password. You're then signed in.",
    "",
    "Then start a claim and choose Exterior, then From photos. Scrivn Scan on Android signs in with the same email and password.",
    "",
    "Questions? Ask the person who invited you.",
    "",
    "Scrivn",
  ].join("\n");
  return { to: plan.email, subject: "You've been set up on Scrivn", text };
}

/** Every account, a page at a time (GoTrue's admin list). Stops at an empty page, whatever size a page turns out to be. */
export async function allAccounts(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 500; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not read the accounts: ${error.message}`);
    if (data.users.length === 0) break;
    users.push(...data.users);
  }
  return users;
}

function summary(user: User): AccountSummary {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: typeof meta.full_name === "string" ? meta.full_name : "",
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    madeByAddTester: (user.app_metadata as Record<string, unknown> | undefined)?.invited_by === TESTER_MARK,
  };
}

/** The account for an address, if there is one. GoTrue keeps addresses in lower case; compared that way. */
export async function findAccount(admin: SupabaseClient, email: string): Promise<AccountSummary | null> {
  const wanted = email.trim().toLowerCase();
  const user = (await allAccounts(admin)).find((u) => (u.email ?? "").toLowerCase() === wanted);
  return user ? summary(user) : null;
}

async function organizationOf(admin: SupabaseClient, userId: string): Promise<{ name: string; role: string } | null> {
  const { data: membership } = await admin.from("organization_members").select("organization_id, role").eq("user_id", userId).limit(1).maybeSingle();
  if (!membership) return null;
  const { data: org } = await admin.from("organizations").select("name").eq("id", membership.organization_id).maybeSingle();
  return { name: typeof org?.name === "string" ? org.name : "", role: String(membership.role) };
}

/**
 * The whole step: check, make, email. With `dryRun`, reads only. With no `send`, emails nobody
 * (--no-email). An address that has an account is never touched.
 */
export async function addTester(
  admin: SupabaseClient,
  request: TesterRequest,
  options: { dryRun?: boolean; send?: SendText | null; now?: Date } = {},
): Promise<AddTesterResult> {
  const plan = planTester(request, options.now);
  const existing = await findAccount(admin, plan.email);
  if (existing) return { outcome: "exists", plan, account: existing };

  const message = testerEmail(plan);
  if (options.dryRun) return { outcome: "dry-run", plan, message };

  const made = await makeAccount(admin, {
    email: plan.email,
    emailConfirmed: true,
    fullName: plan.fullName,
    companyName: plan.companyName,
    appMetadata: plan.appMetadata,
  });
  if (!made.made) {
    // Made by someone else between the look and the make, or refused for another reason.
    const now = await findAccount(admin, plan.email);
    if (now) return { outcome: "exists", plan, account: now };
    throw new Error(`Supabase would not make the account: ${made.message}`);
  }

  const organization = await organizationOf(admin, made.userId);
  let emailed: { sent: true } | { sent: false; reason: string } | null = null;
  if (options.send) {
    try {
      const sent = await options.send(message);
      emailed = sent.ok ? { sent: true } : { sent: false, reason: sent.reason };
    } catch (err) {
      emailed = { sent: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
  return { outcome: "made", plan, userId: made.userId, organization, message, emailed };
}

export interface TesterRow {
  email: string;
  fullName: string;
  company: string;
  createdAt: string | null;
  lastSignInAt: string | null;
}

/** The accounts add-tester made, oldest first, with their organization's name. */
export async function listTesters(admin: SupabaseClient): Promise<TesterRow[]> {
  const testers = (await allAccounts(admin)).map(summary).filter((a) => a.madeByAddTester);
  if (testers.length === 0) return [];
  const ids = testers.map((t) => t.id);
  const { data: memberships, error } = await admin.from("organization_members").select("user_id, organization_id").in("user_id", ids);
  if (error) throw new Error(`Could not read the organizations: ${error.message}`);
  const orgIds = [...new Set((memberships ?? []).map((m) => m.organization_id as string))];
  const { data: orgs, error: orgError } = orgIds.length ? await admin.from("organizations").select("id, name").in("id", orgIds) : { data: [], error: null };
  if (orgError) throw new Error(`Could not read the organizations: ${orgError.message}`);
  const orgName = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const companyOf = new Map((memberships ?? []).map((m) => [m.user_id as string, orgName.get(m.organization_id as string) ?? ""]));
  return testers
    .map((t) => ({ email: t.email, fullName: t.fullName, company: companyOf.get(t.id) ?? "", createdAt: t.createdAt, lastSignInAt: t.lastSignInAt }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
