import { TRIAL_CLAIM_LIMIT, TRIAL_DAYS, claimLimitForTier, planForTier } from "./plans";
import { canManageBilling, type OrgRole } from "./teams";
import { paymentGraceEndsAt } from "./billingTiers";

/**
 * What an organization's plan, counter and trial add up to — the arithmetic half of `lib/usage.ts`,
 * kept free of Supabase and `server-only` so `npm run test:billing` can hold it to the rules.
 *
 * Moved here unchanged when the plan moved from the profile to the organization (0011). Alone, a
 * person IS an organization of one, so these are the same numbers for the same row: the test
 * compares this, case by case, with a frozen copy of the code it replaced.
 */

export interface UsageState {
  tier: string | null;
  used: number;
  limit: number;
  periodResetAt: string | null;
  /** True when the organization has no paid plan — on the trial, or the trial is spent. */
  noPlan: boolean;
  atLimit: boolean;
  remaining: number;

  // ---- Trial (only meaningful while noPlan is true; a subscription supersedes it entirely) ----
  /** On an active free trial right now — claims left AND still inside the 30-day window. */
  onTrial: boolean;
  trialClaimsUsed: number;
  trialEndsAt: string | null;
  /** Why the trial stopped working, for a message that says the true reason rather than a generic one. */
  trialExpiredReason: "claims" | "time" | null;

  // ---- Whose numbers these are (0011) ----
  /** The organization the plan and counter belong to. */
  organizationId: string | null;
  /** The signed-in person's role in it. Alone, always "owner". */
  role: OrgRole | null;
  /**
   * Whether to SHOW this person the billing buttons — the organization's owner. Alone, always true.
   * A role that could not be read shows them too, as the page always did: this decides only what is
   * drawn, and checkout and the portal check the role for themselves.
   */
  canManageBilling: boolean;
  /** People the plan covers; null = no limit (no seat price has been chosen — see SEAT_PRICING). */
  seatLimit: number | null;

  // ---- A card that failed (0013) — null/false on a database without it ----
  /** When the card first failed for the plan's unpaid invoice; null when the plan is paid up. */
  paymentFailedAt: string | null;
  /** When the plan stops working unless the card is updated — PAYMENT_GRACE_DAYS after the failure. */
  paymentGraceEndsAt: string | null;
  /** The grace period has run out with the invoice still unpaid: generating is paused. */
  paymentOverdue: boolean;
}

/**
 * Whether a Supabase error means "0011 has not been applied to this database" — a column, function or
 * table that does not exist — as opposed to any other failure.
 *
 * Migrations are applied by hand and any deploy of main ships the code that reads the organization's
 * plan, so for a while that code may run against a database without the columns. Only this answer
 * sends `lib/usage.ts` (and the portal and confirm routes) back to the profile columns the previous
 * build used; a timeout or a refused permission is not a reason to read stale numbers or count in the
 * wrong place. Postgres's own codes come through PostgREST unchanged (42703 a column, 42883 a
 * function, 42P01 a table); PGRST20x are PostgREST's schema-cache misses for the same three things.
 */
export function isBillingSchemaMissing(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42703" || code === "42883" || code === "42P01" || code === "PGRST200" || code === "PGRST202" || code === "PGRST204" || code === "PGRST205";
}

/** The billing columns of one `organizations` row, as PostgREST returns them. */
export interface OrganizationBillingRow {
  subscription_tier?: string | null;
  claims_used_this_period?: number | null;
  period_reset_at?: string | null;
  trial_started_at?: string | null;
  trial_claims_used?: number | null;
  seat_limit?: number | null;
  payment_failed_at?: string | null;
}

export function usageFromBilling(
  row: OrganizationBillingRow | null | undefined,
  membership: { organizationId: string | null; role: OrgRole | null },
  now: number = Date.now(),
): UsageState {
  const tier = row?.subscription_tier ?? null;
  const used = row?.claims_used_this_period ?? 0;
  const limit = claimLimitForTier(tier);
  const noPlan = planForTier(tier) === null;

  const trialClaimsUsed = row?.trial_claims_used ?? 0;
  const trialStartedAt = row?.trial_started_at ?? null;
  const trialEndsAt = trialStartedAt ? new Date(new Date(trialStartedAt).getTime() + TRIAL_DAYS * 86_400_000).toISOString() : null;

  // Whichever runs out first ends the trial. Claims are checked before time so that someone who
  // used all five on day one is told *that*, rather than being told to wait for a window that has
  // weeks left and won't help them.
  const claimsSpent = trialClaimsUsed >= TRIAL_CLAIM_LIMIT;
  const windowClosed = trialEndsAt !== null && now > new Date(trialEndsAt).getTime();
  const trialExpiredReason: "claims" | "time" | null = !noPlan ? null : claimsSpent ? "claims" : windowClosed ? "time" : null;
  const onTrial = noPlan && trialExpiredReason === null;

  const paymentFailedAt = row?.payment_failed_at ?? null;
  const graceEndsAt = paymentFailedAt ? paymentGraceEndsAt(paymentFailedAt) : null;

  return {
    tier,
    used,
    limit,
    periodResetAt: row?.period_reset_at ?? null,
    noPlan,
    // On trial, "the limit" is the trial allowance — so the banner and account page can render one
    // set of numbers without every caller re-deriving which mode the user is in.
    atLimit: noPlan ? !onTrial : limit > 0 && used >= limit,
    remaining: noPlan ? Math.max(0, TRIAL_CLAIM_LIMIT - trialClaimsUsed) : Math.max(0, limit - used),
    onTrial,
    trialClaimsUsed,
    trialEndsAt,
    trialExpiredReason,
    organizationId: membership.organizationId,
    role: membership.role,
    canManageBilling: membership.role === null || canManageBilling(membership.role),
    seatLimit: row?.seat_limit ?? null,
    paymentFailedAt,
    paymentGraceEndsAt: graceEndsAt,
    paymentOverdue: graceEndsAt !== null && now > new Date(graceEndsAt).getTime(),
  };
}
