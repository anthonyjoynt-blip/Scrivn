import Link from "next/link";
import { getUsageState } from "@/lib/usage";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { TRIAL_CLAIM_LIMIT, USAGE_WARNING_THRESHOLD } from "@/lib/plans";

/**
 * App-wide usage warning: visible from 80% of the plan's claim limit, and again (differently) at
 * the cap itself.
 *
 * Lives in the root layout rather than on the claim page so it can't be missed — the point of
 * warning before the hard stop is that someone mid-way through a caseload finds out with room to
 * act, not at the moment generation refuses.
 *
 * Renders nothing below the threshold, and nothing at all for a signed-out visitor or one with no
 * plan; "you have no subscription" is the pricing page's job, not a permanent banner.
 */
export async function UsageBanner() {
  if (!isSupabaseConfigured()) return null;

  const usage = await getUsageState();
  if (!usage) return null;

  // Trial users get their own banner: their "limit" is the trial allowance, and the way out is
  // choosing a plan rather than waiting for a period reset that will never come.
  if (usage.noPlan) {
    if (usage.onTrial) {
      const endsAt = usage.trialEndsAt ? new Date(usage.trialEndsAt).toLocaleDateString() : null;
      return (
        <div className="usage-banner" role="status">
          <strong>
            Free trial — {usage.trialClaimsUsed} of {TRIAL_CLAIM_LIMIT} claims used.
          </strong>{" "}
          {usage.remaining} remaining{endsAt ? `, trial ends ${endsAt}` : ""}. <PlanLink canBuy={usage.canManageBilling}>See plans</PlanLink>
        </div>
      );
    }
    return (
      <div className="usage-banner usage-banner-blocked" role="status">
        <strong>{usage.trialExpiredReason === "time" ? "Your free trial has ended." : `You've used all ${TRIAL_CLAIM_LIMIT} trial claims.`}</strong>{" "}
        Choose a plan to keep generating documents. <PlanLink canBuy={usage.canManageBilling}>See plans</PlanLink>
      </div>
    );
  }

  if (usage.limit <= 0) return null;

  const fraction = usage.used / usage.limit;
  if (fraction < USAGE_WARNING_THRESHOLD) return null;

  const resets = usage.periodResetAt ? new Date(usage.periodResetAt).toLocaleDateString() : null;

  if (usage.atLimit) {
    return (
      <div className="usage-banner usage-banner-blocked" role="status">
        <strong>You’ve used all {usage.limit} claims in your plan for this period.</strong>{" "}
        {resets ? `Your limit resets on ${resets}.` : ""} {usage.canManageBilling ? (
          <>
            To keep going now, <Link href="/pricing">upgrade your plan</Link>.
          </>
        ) : (
          OWNER_MANAGES_PLAN
        )}
      </div>
    );
  }

  return (
    <div className="usage-banner" role="status">
      <strong>
        {usage.used} of {usage.limit} claims used this period.
      </strong>{" "}
      {usage.remaining} remaining{resets ? `, resetting ${resets}` : ""}. <PlanLink canBuy={usage.canManageBilling}>See plans</PlanLink>
    </div>
  );
}

const OWNER_MANAGES_PLAN = "Your organization’s owner manages the plan.";

/**
 * Where the banner points: the pricing page, for whoever can buy. A teammate cannot (only the owner
 * changes the plan, 0011), so they are told who can instead of being sent to a button that refuses
 * them. Alone, everyone is their organization's owner and always gets the link.
 */
function PlanLink({ canBuy, children }: { canBuy: boolean; children: React.ReactNode }) {
  return canBuy ? <Link href="/pricing">{children}</Link> : <>{OWNER_MANAGES_PLAN}</>;
}
