import "server-only";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { isSupabaseConfigured } from "./supabase/env";
import { TRIAL_CLAIM_LIMIT, TRIAL_DAYS, TRIAL_WARNING_AT_CLAIMS, USAGE_WARNING_THRESHOLD, claimLimitForTier, planForTier } from "./plans";
import { sendEmail } from "./email/send";
import { UsageWarningEmail } from "@/emails/UsageWarning";
import { UsageCapReachedEmail } from "@/emails/UsageCapReached";
import { TrialEndingEmail } from "@/emails/TrialEnding";

/**
 * Hard-cap usage enforcement.
 *
 * The model is a hard stop, not metered overage: at the cap, generation refuses until the billing
 * period rolls over or the plan is upgraded. Nothing is ever auto-billed past the subscription
 * price — there is deliberately no usage-record or billing-meter call anywhere in this file.
 *
 * "One claim" is counted as one *document generation*, not one API call. Extraction and generation
 * are two calls in the same claim, so only `/api/generate` increments; `/api/extract` checks the
 * cap (to fail early, before spending an expensive extraction on a claim that can't be finished)
 * but does not count.
 */

export interface UsageState {
  tier: string | null;
  used: number;
  limit: number;
  periodResetAt: string | null;
  /** True when the user has no paid plan — they're on the trial, or the trial is spent. */
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
}

/**
 * Development with no Supabase project standing — the same state `middleware.ts` fails open on.
 *
 * That fail-open exists so the scoping pipeline can be worked on locally without standing up a
 * Supabase project first, and it says so in as many words. Without this it was a promise the app
 * could not keep: the middleware waved /claim through, and then `/api/extract` threw out of
 * `supabaseUrl()` and returned a bare 500 the moment anyone pressed Generate. The pipeline was
 * exactly the thing that could not be worked on.
 *
 * Fails CLOSED on both halves, matching the middleware: in production this is always false (so a
 * deploy missing its env vars gets the 503 the middleware already returns, never a free pass), and
 * with Supabase configured it is always false too (so the real gate runs for every real user).
 */
function unauthenticatedDevMode(): boolean {
  return process.env.NODE_ENV !== "production" && !isSupabaseConfigured();
}

/** Reads the signed-in user's usage state. Returns null when nobody is signed in. */
export async function getUsageState(): Promise<UsageState | null> {
  if (unauthenticatedDevMode()) return null;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (typeof userId !== "string") return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier, claims_used_this_period, period_reset_at, trial_started_at, trial_claims_used")
    .eq("id", userId)
    .maybeSingle();

  const tier = (profile?.subscription_tier as string | null) ?? null;
  const used = (profile?.claims_used_this_period as number | null) ?? 0;
  const limit = claimLimitForTier(tier);
  const noPlan = planForTier(tier) === null;

  const trialClaimsUsed = (profile?.trial_claims_used as number | null) ?? 0;
  const trialStartedAt = (profile?.trial_started_at as string | null) ?? null;
  const trialEndsAt = trialStartedAt ? new Date(new Date(trialStartedAt).getTime() + TRIAL_DAYS * 86_400_000).toISOString() : null;

  // Whichever runs out first ends the trial. Claims are checked before time so that someone who
  // used all five on day one is told *that*, rather than being told to wait for a window that has
  // weeks left and won't help them.
  const claimsSpent = trialClaimsUsed >= TRIAL_CLAIM_LIMIT;
  const windowClosed = trialEndsAt !== null && Date.now() > new Date(trialEndsAt).getTime();
  const trialExpiredReason: "claims" | "time" | null = !noPlan ? null : claimsSpent ? "claims" : windowClosed ? "time" : null;
  const onTrial = noPlan && trialExpiredReason === null;

  return {
    tier,
    used,
    limit,
    periodResetAt: (profile?.period_reset_at as string | null) ?? null,
    noPlan,
    // On trial, "the limit" is the trial allowance — so the banner and account page can render one
    // set of numbers without every caller re-deriving which mode the user is in.
    atLimit: noPlan ? !onTrial : limit > 0 && used >= limit,
    remaining: noPlan ? Math.max(0, TRIAL_CLAIM_LIMIT - trialClaimsUsed) : Math.max(0, limit - used),
    onTrial,
    trialClaimsUsed,
    trialEndsAt,
    trialExpiredReason,
  };
}

/** The message shown when an action is refused — plain about what happened and both ways out. */
export function blockedMessage(usage: UsageState): string {
  if (usage.noPlan) {
    // The two trial endings need different wording: one is "you've used them all", the other is
    // "time ran out" — telling someone with 3 unused claims that they're out of claims would be
    // simply untrue, and would send them looking for a problem that isn't there.
    if (usage.trialExpiredReason === "claims") {
      return `You’ve used all ${TRIAL_CLAIM_LIMIT} claims in your free trial. Choose a plan to keep generating documents.`;
    }
    if (usage.trialExpiredReason === "time") {
      return `Your ${TRIAL_DAYS}-day free trial has ended. Choose a plan to keep generating documents.`;
    }
    return "You don’t have an active subscription yet. Choose a plan to start generating documents.";
  }
  const resets = usage.periodResetAt ? ` Your limit resets on ${new Date(usage.periodResetAt).toLocaleDateString()}.` : "";
  return `You’ve used all ${usage.limit} claims included in your plan for this billing period.${resets} You can wait for the period to reset, or upgrade your plan for a higher limit.`;
}

/**
 * Gate for a paid action. Returns null when allowed, or a ready-to-send refusal when not.
 * `status` is 402 (Payment Required) rather than 403 — the request is well-formed and the user is
 * authenticated; what's missing is billing headroom, and that distinction lets the client tell a
 * cap block apart from a genuine permission error.
 */
export async function checkUsageAllowed(): Promise<{ error: string; status: number } | null> {
  // No auth to check against — see `unauthenticatedDevMode`. Never reached in production.
  if (unauthenticatedDevMode()) return null;
  const usage = await getUsageState();
  if (!usage) return { error: "Not authenticated.", status: 401 };
  // An active trial is a legitimate way to generate — `noPlan` alone no longer means blocked, which
  // it did before the trial existed.
  if (usage.onTrial) return null;
  if (usage.noPlan || usage.atLimit) return { error: blockedMessage(usage), status: 402 };
  return null;
}

/**
 * Counts one claim against the signed-in user's period, after a generation succeeds.
 *
 * Uses the admin client because `claims_used_this_period` is deliberately not user-writable (see
 * migration 0002) — if users could write it, they could reset their own counter from the browser.
 *
 * Increments via a read-then-write rather than an atomic SQL expression, which is a real (if
 * small) race: two generations finishing in the same instant could both read the same value and
 * write used+1 once. The consequence is one uncounted claim, capped by how many requests one user
 * can have genuinely in flight at once — acceptable for a hard cap whose purpose is preventing
 * sustained overuse, not exact accounting. If this ever needs to be exact, replace it with a
 * Postgres function called via `rpc` so the increment happens in one statement.
 */
export async function incrementClaimUsage(): Promise<void> {
  // Nothing to count against — see `unauthenticatedDevMode`. Never reached in production.
  if (unauthenticatedDevMode()) return;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (typeof userId !== "string") return;
  const email = typeof claimsData?.claims?.email === "string" ? claimsData.claims.email : null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("claims_used_this_period, subscription_tier, period_reset_at, trial_claims_used, trial_started_at, trial_ending_email_sent_at, full_name")
    .eq("id", userId)
    .maybeSingle();

  const tier = (profile?.subscription_tier as string | null) ?? null;
  const onTrial = planForTier(tier) === null;

  // Trial claims are counted in their own column, so converting to a paid plan starts from zero
  // rather than inheriting whatever the trial used.
  if (onTrial) {
    const previousTrial = (profile?.trial_claims_used as number | null) ?? 0;
    const nextTrial = previousTrial + 1;
    await admin.from("profiles").update({ trial_claims_used: nextTrial }).eq("id", userId);

    if (email) {
      await sendTrialNotifications({
        userId,
        email,
        previous: previousTrial,
        next: nextTrial,
        trialStartedAt: (profile?.trial_started_at as string | null) ?? null,
        alreadySent: (profile?.trial_ending_email_sent_at as string | null) !== null,
      });
    }
    return;
  }

  const previous = (profile?.claims_used_this_period as number | null) ?? 0;
  const next = previous + 1;
  await admin.from("profiles").update({ claims_used_this_period: next }).eq("id", userId);

  // Notifications hang off this one place, so there's exactly one definition of "how much has been
  // used" — the cap check and the emails can't disagree about it.
  if (email) {
    await sendUsageNotifications({
      email,
      previous,
      next,
      tier: (profile?.subscription_tier as string | null) ?? null,
      periodResetAt: (profile?.period_reset_at as string | null) ?? null,
    });
  }
}

/**
 * Fires the 80% and at-limit emails on the exact generation that crosses each line.
 *
 * Crossing detection (`previous < threshold && next >= threshold`) is what makes these send once per
 * billing period with no extra state to store or reset. The alternatives are worse: emailing
 * whenever usage is *above* the threshold would send on every subsequent generation, and emailing
 * from the blocked path would send on every retry — a PM hitting a wall three times would get three
 * identical emails. It also self-heals on renewal, since the webhook resets the counter to 0 and the
 * next period crosses the line again naturally.
 *
 * Deliberate deviation worth knowing: the spec described the cap email as firing "when a generation
 * gets blocked". This fires when the cap is *reached* — the generation that consumes the last claim
 * — which is once, and tells the PM at the moment it happens rather than when they next try and
 * fail. The in-app blocking message still covers the blocked attempt itself.
 */
async function sendUsageNotifications(params: { email: string; previous: number; next: number; tier: string | null; periodResetAt: string | null }): Promise<void> {
  const plan = planForTier(params.tier);
  if (!plan) return;

  const limit = plan.claimLimit;
  const warnAt = Math.ceil(limit * USAGE_WARNING_THRESHOLD);
  const resetDate = params.periodResetAt ? new Date(params.periodResetAt).toLocaleDateString() : null;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://scrivn.ca";
  const pricingUrl = `${baseUrl}/pricing`;

  if (params.previous < limit && params.next >= limit) {
    await sendEmail({
      to: params.email,
      subject: `You've reached your ${plan.name} claim limit`,
      react: UsageCapReachedEmail({ limit, planName: plan.name, resetDate, pricingUrl }),
    });
    // Reaching the cap supersedes the 80% warning — don't send both for one generation.
    return;
  }

  if (params.previous < warnAt && params.next >= warnAt) {
    await sendEmail({
      to: params.email,
      subject: `You've used ${params.next} of ${limit} claims this period`,
      react: UsageWarningEmail({ used: params.next, limit, planName: plan.name, resetDate, pricingUrl }),
    });
  }
}

/**
 * Fires the "trial nearly over" email at 4 of 5 claims used.
 *
 * Guarded by a stored timestamp rather than crossing-detection alone. The usage emails can rely on
 * a crossing because their counter resets every billing period, so a missed or duplicated send
 * self-corrects. A trial counter never resets — it only ever counts up to 5 and then stops — so a
 * flag is the only thing that keeps this to one send.
 *
 * KNOWN GAP — the time half of "whichever comes first" is not implemented. The spec also wanted
 * this email when the 30-day window is closing with claims still unused. That can't be triggered
 * from here: this function only runs when someone generates a document, and the whole point of a
 * "your trial expires in 3 days" email is reaching someone who *hasn't* been using it. Firing it
 * opportunistically on their next visit would deliver it precisely to the people who don't need it.
 *
 * It needs a scheduled job — a Vercel Cron hitting a route that finds profiles where the window is
 * nearly closed, trial claims remain, and trial_ending_email_sent_at is null, then calls
 * `sendTrialEndingEmail` below. The email template and the send function are both ready for it; only
 * the scheduler is missing.
 */
async function sendTrialNotifications(params: {
  userId: string;
  email: string;
  previous: number;
  next: number;
  trialStartedAt: string | null;
  alreadySent: boolean;
}): Promise<void> {
  if (params.alreadySent) return;
  if (!(params.previous < TRIAL_WARNING_AT_CLAIMS && params.next >= TRIAL_WARNING_AT_CLAIMS)) return;

  const daysRemaining = params.trialStartedAt
    ? Math.max(0, Math.ceil((new Date(params.trialStartedAt).getTime() + TRIAL_DAYS * 86_400_000 - Date.now()) / 86_400_000))
    : null;

  const sent = await sendTrialEndingEmail({ email: params.email, generationsUsed: params.next, daysRemaining });
  if (sent) {
    await createAdminClient().from("profiles").update({ trial_ending_email_sent_at: new Date().toISOString() }).eq("id", params.userId);
  }
}

/**
 * Sends the trial-ending email. Exported so a future scheduled job can reuse it for the
 * time-based trigger without duplicating the subject line or prop wiring.
 */
export async function sendTrialEndingEmail(params: { email: string; generationsUsed: number; daysRemaining: number | null }): Promise<boolean> {
  // A lifecycle email: the caller only cares whether it went, not why it did not.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://scrivn.ca";
  return (await sendEmail({
    to: params.email,
    subject: "Your Scrivn trial is nearly over",
    react: TrialEndingEmail({
      generationsUsed: params.generationsUsed,
      generationsAllowed: TRIAL_CLAIM_LIMIT,
      daysRemaining: params.daysRemaining,
      pricingUrl: `${baseUrl}/pricing`,
    }),
  })).ok;
}
