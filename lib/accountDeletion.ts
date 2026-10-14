import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { getStripe, isStripeConfigured } from "./stripe/server";
import { isBillingSchemaMissing } from "./usageState";
import { SCAN_PHOTO_BUCKET } from "./scanPhotos";
import { sendEmail } from "./email/send";
import { AccountDeletedEmail } from "@/emails/AccountDeleted";

/**
 * Deleting a person's account: in Scrivn Scan's Account screen and at scrivn.ca/account/delete
 * (Google Play requires both for an app where people can make an account).
 *
 * What goes, per PRIVACY.md ("kept until the company deletes them"):
 *
 *   * the person: their sign-in, profile, memberships and paired phones (the auth user's foreign keys,
 *     0001 / 0004 / 0006), any problem reports they sent, and their pairing codes;
 *   * an organization that is theirs alone — the one they own with nobody else in it, and their own
 *     set aside while they are on a team (0012) — with everything in it: claims, scans, scan photos,
 *     letterhead and logo, scan counts. A person deleting the account nobody else is in IS the company
 *     deleting its claims;
 *   * NOT a team they are on: they leave it, and the claims they started stay with it, no longer
 *     showing who started them. An owner with other people in their organization is refused until they
 *     hand it over (P0411), so a team is never left without an owner.
 *
 * In this order, so that a failure part way leaves nothing billing and nothing half-deleted that a
 * retry would not finish:
 *
 *   1. what would go (`account_deletion_plan`, 0014) — refused here for an owner of a team;
 *   2. the Stripe subscriptions of each organization that goes, cancelled now, without a refund of
 *      the period already paid: a failure stops everything, because an account deleted with its plan
 *      still running would go on charging a card nobody can reach. The Stripe customer is kept (Stripe
 *      keeps invoices for the tax record; PRIVACY.md says so). A team's plan is not touched;
 *   3. the database half (`account_close`, 0014);
 *   4. the photos and logo in storage, under each deleted organization's id;
 *   5. the auth user — which a retry after any failure above reaches again, since steps 1-4 find
 *      nothing left to do the second time;
 *   6. an email saying it is done, to the address the account had.
 */

export class TeamOwnerCannotDeleteError extends Error {
  constructor() {
    super("You own an organization with other people in it. Hand it to one of them first (Account → Team), then delete your account.");
    this.name = "TeamOwnerCannotDeleteError";
  }
}

export class DeletionUnavailableError extends Error {
  constructor(message = "Deleting an account isn't available yet. Email privacy@scrivn.ca and we'll do it for you.") {
    super(message);
    this.name = "DeletionUnavailableError";
  }
}

/** The two Stripe calls deletion makes, so the test can stand in for Stripe. */
export interface SubscriptionCanceller {
  list(customerId: string): Promise<{ id: string; status: string }[]>;
  cancel(subscriptionId: string): Promise<void>;
}

export interface DeletionDeps {
  admin: SupabaseClient;
  /** Null when Stripe is not configured on this deployment. */
  stripe: SubscriptionCanceller | null;
  /** Sends the "your account is deleted" email; best effort. */
  notify: (email: string) => Promise<void>;
}

export interface DeletionResult {
  /** Organizations deleted with everything in them. */
  organizationsDeleted: number;
  /** True when the person left a team rather than deleting it. */
  leftTeam: boolean;
  subscriptionsCancelled: number;
}

/** A subscription that can still charge someone. */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

function stripeCanceller(): SubscriptionCanceller | null {
  if (!isStripeConfigured()) return null;
  const stripe = getStripe();
  return {
    async list(customerId) {
      const { data } = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
      return data.map((s) => ({ id: s.id, status: s.status }));
    },
    async cancel(subscriptionId) {
      // No proration: the period already paid for is not refunded, and nothing more is charged.
      await stripe.subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
    },
  };
}

export function defaultDeletionDeps(): DeletionDeps {
  return {
    admin: createAdminClient(),
    stripe: stripeCanceller(),
    notify: async (email) => {
      await sendEmail({ to: email, subject: "Your Scrivn account has been deleted", react: AccountDeletedEmail() });
    },
  };
}

interface PlanRow {
  organization_id: string;
  stripe_customer_id: string | null;
  action: "delete" | "leave";
}

/** Every object under `<organization id>/` in a bucket, one folder deep for the scan photos' `<scan id>/` folders. */
async function removeFolder(admin: SupabaseClient, bucket: string, organizationId: string): Promise<number> {
  const storage = admin.storage.from(bucket);
  const paths: string[] = [];
  const { data: top, error } = await storage.list(organizationId, { limit: 1000 });
  if (error) throw new Error(`could not list ${bucket}: ${error.message}`);
  for (const entry of top ?? []) {
    // A folder lists with no id; a file has one.
    if (entry.id) {
      paths.push(`${organizationId}/${entry.name}`);
      continue;
    }
    const { data: inner, error: innerError } = await storage.list(`${organizationId}/${entry.name}`, { limit: 1000 });
    if (innerError) throw new Error(`could not list ${bucket}: ${innerError.message}`);
    for (const file of inner ?? []) if (file.id) paths.push(`${organizationId}/${entry.name}/${file.name}`);
  }
  for (let i = 0; i < paths.length; i += 500) {
    const { error: removeError } = await storage.remove(paths.slice(i, i + 500));
    if (removeError) throw new Error(`could not remove from ${bucket}: ${removeError.message}`);
  }
  return paths.length;
}

/** Deletes `userId`'s account — see the file comment for what that takes with it, and in what order. */
export async function deleteAccount(userId: string, email: string | null, deps: DeletionDeps = defaultDeletionDeps()): Promise<DeletionResult> {
  const { admin } = deps;

  const { data: planData, error: planError } = await admin.rpc("account_deletion_plan", { person: userId });
  if (planError) {
    if (planError.code === "P0411") throw new TeamOwnerCannotDeleteError();
    if (isBillingSchemaMissing(planError)) throw new DeletionUnavailableError();
    throw new Error(`could not plan the deletion: ${planError.message}`);
  }
  const plan = (planData ?? []) as PlanRow[];
  const going = plan.filter((p) => p.action === "delete");

  // 2. The plans of whatever goes, before anything is deleted.
  let subscriptionsCancelled = 0;
  for (const org of going) {
    if (!org.stripe_customer_id) continue;
    if (!deps.stripe) throw new DeletionUnavailableError("Your plan couldn't be cancelled just now, so nothing was deleted. Try again, or email privacy@scrivn.ca.");
    try {
      const subscriptions = await deps.stripe.list(org.stripe_customer_id);
      for (const s of subscriptions) {
        if (!LIVE_STATUSES.has(s.status)) continue;
        await deps.stripe.cancel(s.id);
        subscriptionsCancelled += 1;
      }
    } catch (err) {
      console.error("[account delete] Stripe refused:", err);
      throw new DeletionUnavailableError("Your plan couldn't be cancelled just now, so nothing was deleted. Try again, or email privacy@scrivn.ca.");
    }
  }

  // 3. The database half.
  const { error: closeError } = await admin.rpc("account_close", { person: userId });
  if (closeError) {
    if (closeError.code === "P0411") throw new TeamOwnerCannotDeleteError();
    throw new Error(`could not delete the account's data: ${closeError.message}`);
  }

  // 4. What storage holds for the organizations that went. Logged, not thrown: the rows that pointed
  // at these files are gone, so nobody can reach them, and a retry would find no plan to repeat this.
  for (const org of going) {
    for (const bucket of [SCAN_PHOTO_BUCKET, "logos"]) {
      try {
        await removeFolder(admin, bucket, org.organization_id);
      } catch (err) {
        console.error(`[account delete] files left in ${bucket}/${org.organization_id}/ — remove them by hand:`, err);
      }
    }
  }

  // 5. The person.
  const { error: userError } = await admin.auth.admin.deleteUser(userId);
  if (userError && userError.status !== 404) throw new Error(`could not delete the sign-in: ${userError.message}`);

  // 6. Best effort.
  if (email) {
    try {
      await deps.notify(email);
    } catch (err) {
      console.error("[account delete] the confirmation email failed (the account is deleted):", err);
    }
  }

  return {
    organizationsDeleted: going.length,
    leftTeam: plan.some((p) => p.action === "leave"),
    subscriptionsCancelled,
  };
}
