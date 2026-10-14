import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { withClockSkewRetry } from "./supabase/clockSkew";
import { isSupabaseConfigured } from "./supabase/env";
import { TRIAL_CLAIM_LIMIT, TRIAL_DAYS, TRIAL_WARNING_AT_CLAIMS, USAGE_WARNING_THRESHOLD, planForTier } from "./plans";
import { isOrgRole, type OrgRole } from "./teams";
import { isBillingSchemaMissing, usageFromBilling, type OrganizationBillingRow, type UsageState } from "./usageState";
import { sendEmail } from "./email/send";
import { UsageWarningEmail } from "@/emails/UsageWarning";
import { UsageCapReachedEmail } from "@/emails/UsageCapReached";
import { TrialEndingEmail } from "@/emails/TrialEnding";

export type { UsageState } from "./usageState";

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
 *
 * And one generation is counted once, however often it is sent (2026-10-14, 0013). The device names
 * each generation with an id it keeps for every retry (lib/aiJobs.ts); `beginGeneration` answers a
 * repeat of a finished one with the documents already made, and `incrementClaimUsage` counts an id
 * only the first time it finishes. Without 0013, or without an id, a generation is counted as before.
 *
 * ── Whose allowance (0011_org_billing.sql) ───────────────────────────────────────────────────────
 *
 * The plan, the counter and the trial belong to the ORGANIZATION, reached through the signed-in
 * person's membership. Alone, that is their own organization of one and every number is what it
 * always was; on a team, everyone draws on one allowance and the owner gets the emails, because the
 * owner is the one who can upgrade. The arithmetic is `usageFromBilling` (usageState.ts), moved
 * there unchanged from this file.
 *
 * ── Until 0011 is applied ────────────────────────────────────────────────────────────────────────
 *
 * Migrations are applied by hand and any deploy of main ships this file, so for a while it may run
 * against a database without the organization columns. Then it reads and counts the PROFILE, exactly
 * as the build before it did (the `legacyProfile*` functions below), and a deploy that gets ahead
 * of the migration changes nothing anyone sees. Only a "that column or function does not exist"
 * error takes that path (`isBillingSchemaMissing`); any other failure is handled as it always was.
 * The profile path goes with the profile columns, in the migration that drops them.
 */

/** The organization's billing columns, as `getUsageState` reads them. */
const ORG_BILLING_COLUMNS = "subscription_tier, claims_used_this_period, period_reset_at, trial_started_at, trial_claims_used, seat_limit";
/** The same with a failed card's state (0013). Without 0013 the read above is used, as before it. */
const ORG_BILLING_AND_PAYMENT_COLUMNS = `${ORG_BILLING_COLUMNS}, payment_failed_at`;

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

/** PostgREST embeds a to-one relation as an object; typed loosely, it can arrive as a one-row array. */
function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function membershipOf(row: { organization_id?: unknown; role?: unknown } | null | undefined): { organizationId: string | null; role: OrgRole | null } {
  return {
    organizationId: typeof row?.organization_id === "string" ? row.organization_id : null,
    role: isOrgRole(row?.role) ? row.role : null,
  };
}

/** Reads the usage state of the signed-in person's organization. Returns null when nobody is signed in. */
export async function getUsageState(): Promise<UsageState | null> {
  if (unauthenticatedDevMode()) return null;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (typeof userId !== "string") return null;

  // One round trip: the membership, and through it the organization's plan — both under the person's
  // own session, so RLS hands back their own organization's row and no other (0004).
  const read = (columns: string) =>
    withClockSkewRetry(() => supabase.from("organization_members").select(`organization_id, role, organizations (${columns})`).eq("user_id", userId).limit(1).maybeSingle());
  let { data, error } = await read(ORG_BILLING_AND_PAYMENT_COLUMNS);
  // 0011 applied and 0013 not: the plan as the build before read it, with no failed card to show. Only
  // when the missing column is that one; without 0011 the plan's own columns are missing too, and the
  // profile is read straight away rather than after a second failed query.
  if (error && isBillingSchemaMissing(error) && /payment_failed_at/.test(error.message ?? "")) ({ data, error } = await read(ORG_BILLING_COLUMNS));
  if (error && isBillingSchemaMissing(error)) return legacyProfileUsage(supabase, userId);

  const row = data as { organization_id?: unknown; role?: unknown; organizations?: OrganizationBillingRow | OrganizationBillingRow[] | null } | null;
  return usageFromBilling(embedded(row?.organizations), membershipOf(row));
}

/** The message shown when an action is refused — plain about what happened and both ways out. */
export function blockedMessage(usage: UsageState): string {
  // A declined card first: it is the true reason, and choosing a new plan would be the wrong fix —
  // the plan is still theirs once the card is.
  if (usage.paymentFailedAt && (usage.paymentOverdue || usage.noPlan)) {
    return usage.canManageBilling
      ? "Your card payment didn’t go through, so generating new documents is paused. Update your card under Manage billing on your Account page, and it starts again as soon as the payment is taken."
      : "Your organization’s card payment didn’t go through, so generating new documents is paused until its owner updates the card.";
  }
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
  // A plan whose card failed works through the grace period (PAYMENT_GRACE_DAYS), then pauses. The
  // webhook may still hold the tier — Stripe sends nothing on the day the grace ends — so the date
  // is checked here, where it is read.
  if (usage.noPlan || usage.atLimit || usage.paymentOverdue) return { error: blockedMessage(usage), status: 402 };
  return null;
}

/**
 * Where a generation sent with an id stands (0013), before anything is spent on it:
 *
 *   "new"        run it; `incrementClaimUsage({ id, documents })` keeps the documents and counts it;
 *   "done"       it was generated and counted already, and its answer lost on the way back: send
 *                these documents again, with no Claude call and no count;
 *   "running"    the same generation is being made right now, from an earlier send: say so (409);
 *   "untracked"  no id, nobody signed in, or a database without 0013: run and count as before.
 */
export type GenerationStart = { state: "untracked" } | { state: "new"; id: string } | { state: "done"; documents: unknown } | { state: "running" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in person and their organization, from their own session. */
async function sessionOrganization(): Promise<{ userId: string; email: string | null; organizationId: string | null } | null> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (typeof userId !== "string") return null;
  const email = typeof claimsData?.claims?.email === "string" ? claimsData.claims.email : null;
  const { data: membership } = await withClockSkewRetry(() => supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).maybeSingle());
  const organizationId = typeof membership?.organization_id === "string" ? membership.organization_id : null;
  return { userId, email, organizationId };
}

/**
 * Looks a generation up by the id the device sent, and claims it if it is new — see
 * `GenerationStart`. Called before the usage gate: a repeat of a generation that used the last claim
 * must still get its documents, not a refusal for the claim it already paid for.
 */
export async function beginGeneration(id: unknown): Promise<GenerationStart> {
  if (typeof id !== "string" || !UUID.test(id) || unauthenticatedDevMode()) return { state: "untracked" };
  const session = await sessionOrganization();
  if (!session?.organizationId) return { state: "untracked" };
  const { data, error } = await createAdminClient().rpc("generation_job_begin", { job_id: id, caller: session.userId, org_id: session.organizationId });
  if (error) {
    // A generation is never refused for want of its bookkeeping: without 0013, or on any other
    // failure, it runs and is counted as before.
    if (!isBillingSchemaMissing(error)) console.error("[usage] could not look the generation up by its id:", error);
    return { state: "untracked" };
  }
  const row = embedded(data as { outcome: string; saved: unknown } | { outcome: string; saved: unknown }[] | null);
  if (row?.outcome === "done") return { state: "done", documents: row.saved };
  if (row?.outcome === "running") return { state: "running" };
  if (row?.outcome === "new") return { state: "new", id };
  return { state: "untracked" };
}

/** Gives a generation's id back after it failed or was refused, so a retry can run. */
export async function releaseGeneration(start: GenerationStart): Promise<void> {
  if (start.state !== "new") return;
  const session = await sessionOrganization();
  if (!session) return;
  const { error } = await createAdminClient().rpc("generation_job_release", { job_id: start.id, caller: session.userId });
  // Not fatal: an id left running is taken over by a retry after six minutes (0013).
  if (error) console.error("[usage] could not release a generation's id:", error);
}

/**
 * Counts one claim against the signed-in person's organization, after a generation succeeds.
 *
 * With `job` (a generation `beginGeneration` called "new"), its documents are kept and the claim is
 * counted in one statement, and only if no other send of the same generation finished first.
 *
 * The organization comes from the person's own session, never from the request. The count itself
 * goes through `org_count_claim` with the service role, because the counters are deliberately not
 * user-writable (0011, as 0002 did for profiles) — if users could write them, they could reset their
 * own counter from the browser.
 *
 * The increment is one SQL statement. It used to be a read and then a write here, which two
 * generations finishing in the same instant could both read as 4 and both write as 5; harmless for
 * one person, likely for a team sharing one counter. Which counter is still decided here, from the
 * tier — the database only adds one and reports the before and after the emails key on.
 */
export async function incrementClaimUsage(job?: { id: string; documents: unknown }): Promise<void> {
  // Nothing to count against — see `unauthenticatedDevMode`. Never reached in production.
  if (unauthenticatedDevMode()) return;
  const session = await sessionOrganization();
  if (!session) return;
  const { userId, email, organizationId } = session;

  const admin = createAdminClient();
  const { data: org, error } = organizationId
    ? await admin.from("organizations").select("subscription_tier, period_reset_at, trial_started_at, trial_ending_email_sent_at").eq("id", organizationId).maybeSingle()
    : { data: null, error: null };
  if (error && isBillingSchemaMissing(error)) return legacyProfileIncrement(admin, userId, email);
  if (!organizationId || error || !org) {
    console.error("[usage] no organization to count this claim against:", error ?? userId);
    return;
  }

  const tier = (org.subscription_tier as string | null) ?? null;
  // Trial claims are counted in their own column, so converting to a paid plan starts from zero
  // rather than inheriting whatever the trial used.
  const onTrial = planForTier(tier) === null;
  const countOnce = (j: { id: string; documents: unknown }) => admin.rpc("generation_job_finish", { job_id: j.id, caller: userId, on_trial: onTrial, documents: j.documents });
  const countAlways = () => admin.rpc("org_count_claim", { org_id: organizationId, on_trial: onTrial });
  let { data: counted, error: countError } = job ? await countOnce(job) : await countAlways();
  if (job && countError && isBillingSchemaMissing(countError)) ({ data: counted, error: countError } = await countAlways());
  const count = embedded(counted as { used_before: number; used_after: number } | { used_before: number; used_after: number }[] | null);
  if (countError) {
    console.error("[usage] could not count a claim:", countError);
    return;
  }
  if (!count) {
    // With an id, no row is the answer that another send of this generation finished first and was
    // counted — nothing to count, and no emails to send again.
    if (!job) console.error("[usage] could not count a claim: no row");
    return;
  }

  // Notifications hang off this one place, so there's exactly one definition of "how much has been
  // used" — the cap check and the emails can't disagree about it.
  const contact = await billingContactEmail(admin, organizationId, userId, email);
  if (!contact) return;

  if (onTrial) {
    await sendTrialNotifications({
      email: contact,
      previous: count.used_before,
      next: count.used_after,
      trialStartedAt: (org.trial_started_at as string | null) ?? null,
      alreadySent: (org.trial_ending_email_sent_at as string | null) !== null,
      markSent: async () => {
        await admin.from("organizations").update({ trial_ending_email_sent_at: new Date().toISOString() }).eq("id", organizationId);
      },
    });
    return;
  }

  await sendUsageNotifications({
    email: contact,
    previous: count.used_before,
    next: count.used_after,
    tier,
    periodResetAt: (org.period_reset_at as string | null) ?? null,
  });
}

/**
 * Who hears about the allowance: the organization's owner, because the owner is who can upgrade.
 * Alone, that is the person who just generated, whose address is already in hand — so for everyone
 * today the emails go exactly where they always went, and nothing is looked up.
 */
async function billingContactEmail(admin: SupabaseClient, organizationId: string, userId: string, sessionEmail: string | null): Promise<string | null> {
  const { data: owner } = await admin.from("organization_members").select("user_id").eq("organization_id", organizationId).eq("role", "owner").maybeSingle();
  const ownerId = typeof owner?.user_id === "string" ? owner.user_id : null;
  if (!ownerId || ownerId === userId) return sessionEmail;
  const { data } = await admin.auth.admin.getUserById(ownerId);
  return data?.user?.email ?? null;
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
 * flag is the only thing that keeps this to one send. `markSent` stamps it wherever the trial lives
 * (the organization; the profile on a database without 0011).
 *
 * KNOWN GAP — the time half of "whichever comes first" is not implemented. The spec also wanted
 * this email when the 30-day window is closing with claims still unused. That can't be triggered
 * from here: this function only runs when someone generates a document, and the whole point of a
 * "your trial expires in 3 days" email is reaching someone who *hasn't* been using it. Firing it
 * opportunistically on their next visit would deliver it precisely to the people who don't need it.
 *
 * It needs a scheduled job — a Vercel Cron hitting a route that finds organizations where the window
 * is nearly closed, trial claims remain, and trial_ending_email_sent_at is null, then calls
 * `sendTrialEndingEmail` below. The email template and the send function are both ready for it; only
 * the scheduler is missing.
 */
async function sendTrialNotifications(params: {
  email: string;
  previous: number;
  next: number;
  trialStartedAt: string | null;
  alreadySent: boolean;
  markSent: () => Promise<void>;
}): Promise<void> {
  if (params.alreadySent) return;
  if (!(params.previous < TRIAL_WARNING_AT_CLAIMS && params.next >= TRIAL_WARNING_AT_CLAIMS)) return;

  const daysRemaining = params.trialStartedAt
    ? Math.max(0, Math.ceil((new Date(params.trialStartedAt).getTime() + TRIAL_DAYS * 86_400_000 - Date.now()) / 86_400_000))
    : null;

  const sent = await sendTrialEndingEmail({ email: params.email, generationsUsed: params.next, daysRemaining });
  if (sent) await params.markSent();
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

/* ── On a database without 0011 — see "Until 0011 is applied" at the top ─────────────────────── */

/** The previous build's read: the person's own profile columns. The role still comes from the membership (0004). */
async function legacyProfileUsage(supabase: SupabaseClient, userId: string): Promise<UsageState> {
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase.from("organization_members").select("organization_id, role").eq("user_id", userId).limit(1).maybeSingle(),
    supabase.from("profiles").select("subscription_tier, claims_used_this_period, period_reset_at, trial_started_at, trial_claims_used").eq("id", userId).maybeSingle(),
  ]);
  return usageFromBilling(profile as OrganizationBillingRow | null, membershipOf(membership));
}

/** The previous build's count: a read and a write on the person's own profile, emails to them. */
async function legacyProfileIncrement(admin: SupabaseClient, userId: string, email: string | null): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("claims_used_this_period, subscription_tier, period_reset_at, trial_claims_used, trial_started_at, trial_ending_email_sent_at")
    .eq("id", userId)
    .maybeSingle();

  const tier = (profile?.subscription_tier as string | null) ?? null;
  if (planForTier(tier) === null) {
    const previous = (profile?.trial_claims_used as number | null) ?? 0;
    await admin.from("profiles").update({ trial_claims_used: previous + 1 }).eq("id", userId);
    if (email) {
      await sendTrialNotifications({
        email,
        previous,
        next: previous + 1,
        trialStartedAt: (profile?.trial_started_at as string | null) ?? null,
        alreadySent: (profile?.trial_ending_email_sent_at as string | null) !== null,
        markSent: async () => {
          await admin.from("profiles").update({ trial_ending_email_sent_at: new Date().toISOString() }).eq("id", userId);
        },
      });
    }
    return;
  }

  const previous = (profile?.claims_used_this_period as number | null) ?? 0;
  await admin.from("profiles").update({ claims_used_this_period: previous + 1 }).eq("id", userId);
  if (email) await sendUsageNotifications({ email, previous, next: previous + 1, tier, periodResetAt: (profile?.period_reset_at as string | null) ?? null });
}
