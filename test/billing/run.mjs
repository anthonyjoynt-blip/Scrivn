/**
 * Billing rules, as decisions, with no Stripe and no Supabase.
 *
 *   npm run test:billing      (this, then test/billing/db.mjs against every migration)
 *
 * Scrivn Scan's own plan beside the Scrivn plans (2026-10-08): the rules the Stripe webhook keeps for
 * a customer who briefly holds two subscriptions. lib/billingTiers.ts is pure, so the rules are
 * tested as the decisions they are: which events may write the tier, and which subscriptions a
 * purchase cancels. Also holds lib/plans.ts to the shape the rest of the app relies on: Scan is not a
 * Scrivn `Plan`, so the claim caps and the trial never see it.
 *
 * The plan on the organization (0011, 2026-10-13): `usageFromBilling` must give an organization of
 * one exactly what the profile-reading code it replaced gave a person — checked against a frozen copy
 * of that code over every combination of tier, counter, trial and date that matters — plus the
 * owner-only billing flag, the seat model that has not been priced, how a Stripe event finds its
 * organization, and which errors mean "0011 is not applied yet".
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "billing-tests-"));
const bundlePath = join(outDir, "bundle.mjs");

await build({
  stdin: {
    contents: `export * from "@/lib/billingTiers"; export * from "@/lib/plans"; export * from "@/lib/usageState";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root },
  logLevel: "error",
});

const {
  subscriptionEventApplies, scanSubscriptionsToCancel, billingLookups, PLANS, SCAN_TIER, SCAN_PLAN, planForTier, claimLimitForTier, isScanTier, isScrivnTier,
  TRIAL_CLAIM_LIMIT, TRIAL_DAYS, SEAT_PRICING, seatLimitFor, checkoutQuantity, usageFromBilling, isBillingSchemaMissing,
} = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}
const applies = (eventTier, storedTier, deleted = false) => subscriptionEventApplies({ eventTier, storedTier, deleted });

/* ── The plan itself ───────────────────────────────────────────────────────────────────────────── */

check(SCAN_TIER === "scan", "the tier is stored as 'scan' (what migration 0009 lets the column hold)");
check(!PLANS.some((p) => p.tier === SCAN_TIER), "Scan is not among the Scrivn plans, so the three-tier pricing row and the home teaser never show it");
check(planForTier(SCAN_TIER) === null, "planForTier('scan') is null: for claims a Scan subscriber has no Scrivn plan");
check(claimLimitForTier(SCAN_TIER) === 0, "so the Scrivn claim cap for 'scan' is 0, and lib/usage.ts puts them on the free trial like anyone without a plan");
check(isScanTier("scan") && !isScanTier("starter") && !isScanTier(null), "isScanTier knows only 'scan'");
check(isScrivnTier("starter") && isScrivnTier("growth") && isScrivnTier("unlimited"), "every Scrivn tier is a Scrivn tier");
check(!isScrivnTier("scan") && !isScrivnTier(null) && !isScrivnTier("platinum"), "and nothing else is");
check(SCAN_PLAN.monthlyLabel === "$19" && SCAN_PLAN.yearlyLabel === "$190", "the pages quote $19 a month and $190 a year (the owner's prices, 2026-10-08)");

/* ── Which events write the tier ───────────────────────────────────────────────────────────────── */

check(applies("scan", null), "a Scan purchase by someone with no plan gives them Scan");
check(applies("starter", "scan"), "a Scrivn purchase by a Scan subscriber gives them the Scrivn plan");
check(applies("unlimited", "scan"), "any Scrivn tier, not only Starter");
check(!applies("scan", "starter"), "a Scan subscription's event never takes a Scrivn plan down to Scan");
check(!applies("scan", "growth", true), "nor does its cancellation clear the Scrivn plan — the cancellation the Scrivn purchase itself caused");
check(applies("scan", "scan", true), "a Scan subscription cancelled on its own clears Scan");
check(applies("starter", "starter", true), "a Scrivn plan cancelled clears it, as it always did");
check(!applies("starter", "growth", true), "a cancelled subscription takes away only the plan it gave");
check(applies("growth", "starter"), "a plan change between Scrivn tiers still writes, as it always did");
check(applies(null, "starter", true), "a cancellation for a price this deployment doesn't know still clears, as it always did");
check(applies("scan", "scan"), "a Scan renewal writes (rolls the period on)");

/* ── What a purchase cancels ───────────────────────────────────────────────────────────────────── */

const SCAN_PRICES = ["price_scan_m", "price_scan_y"];
const subs = [
  { id: "sub_scan", status: "active", priceId: "price_scan_m" },
  { id: "sub_scan_old", status: "canceled", priceId: "price_scan_y" },
  { id: "sub_scan_due", status: "past_due", priceId: "price_scan_y" },
  { id: "sub_new", status: "active", priceId: "price_starter" },
];
check(
  JSON.stringify(scanSubscriptionsToCancel(subs, SCAN_PRICES, "starter", "sub_new")) === JSON.stringify(["sub_scan", "sub_scan_due"]),
  "buying a Scrivn plan cancels every live Scan subscription — active or still owing — and not one already cancelled",
);
check(scanSubscriptionsToCancel(subs, SCAN_PRICES, "scan", "sub_scan").length === 0, "buying Scan cancels nothing");
check(scanSubscriptionsToCancel(subs, SCAN_PRICES, null, "sub_new").length === 0, "nor does a purchase at a price this deployment doesn't know");
check(
  scanSubscriptionsToCancel([{ id: "sub_new", status: "active", priceId: "price_scan_m" }], SCAN_PRICES, "growth", "sub_new").length === 0,
  "the subscription just bought is never the one cancelled",
);
check(
  scanSubscriptionsToCancel([{ id: "sub_x", status: "active", priceId: "price_starter" }], SCAN_PRICES, "growth", "sub_new").length === 0,
  "and a second Scrivn subscription is left alone — that is not this rule's business",
);
check(scanSubscriptionsToCancel(subs, [], "starter", "sub_new").length === 0, "with no Scan prices configured nothing is a Scan subscription");

/* ── The plan on the organization: alone, nothing changed ──────────────────────────────────────── */

// The arithmetic getUsageState did on the PROFILE before 0011, frozen here word for word. The new code
// must give an organization of one the same answer for the same row, in every combination below.
function profileUsageBefore0011(profile, now) {
  const tier = profile?.subscription_tier ?? null;
  const used = profile?.claims_used_this_period ?? 0;
  const limit = claimLimitForTier(tier);
  const noPlan = planForTier(tier) === null;
  const trialClaimsUsed = profile?.trial_claims_used ?? 0;
  const trialStartedAt = profile?.trial_started_at ?? null;
  const trialEndsAt = trialStartedAt ? new Date(new Date(trialStartedAt).getTime() + TRIAL_DAYS * 86_400_000).toISOString() : null;
  const claimsSpent = trialClaimsUsed >= TRIAL_CLAIM_LIMIT;
  const windowClosed = trialEndsAt !== null && now > new Date(trialEndsAt).getTime();
  const trialExpiredReason = !noPlan ? null : claimsSpent ? "claims" : windowClosed ? "time" : null;
  const onTrial = noPlan && trialExpiredReason === null;
  return {
    tier,
    used,
    limit,
    periodResetAt: profile?.period_reset_at ?? null,
    noPlan,
    atLimit: noPlan ? !onTrial : limit > 0 && used >= limit,
    remaining: noPlan ? Math.max(0, TRIAL_CLAIM_LIMIT - trialClaimsUsed) : Math.max(0, limit - used),
    onTrial,
    trialClaimsUsed,
    trialEndsAt,
    trialExpiredReason,
  };
}
const OLD_FIELDS = ["tier", "used", "limit", "periodResetAt", "noPlan", "atLimit", "remaining", "onTrial", "trialClaimsUsed", "trialEndsAt", "trialExpiredReason"];

{
  const now = Date.parse("2026-10-13T15:00:00Z");
  const day = 86_400_000;
  let cases = 0;
  let mismatch = null;
  const rowsToTry = [null, {}];
  for (const subscription_tier of [null, "starter", "growth", "unlimited", "scan", "platinum"])
    for (const claims_used_this_period of [0, 1, 15, 16, 19, 20, 21, 59, 60, 74, 75, 76, 239, 240, 299, 300, 301, null])
      for (const trial_claims_used of [0, 3, 4, 5, 6, null])
        for (const trial_started_at of [null, new Date(now - day).toISOString(), new Date(now - 29.9 * day).toISOString(), new Date(now - 30 * day).toISOString(), new Date(now - 31 * day).toISOString(), new Date(now + day).toISOString()])
          for (const period_reset_at of [null, "2026-11-01T00:00:00.000Z"])
            rowsToTry.push({ subscription_tier, claims_used_this_period, trial_claims_used, trial_started_at, period_reset_at });
  for (const row of rowsToTry) {
    cases += 1;
    const before = profileUsageBefore0011(row, now);
    const after = usageFromBilling(row, { organizationId: "org-1", role: "owner" }, now);
    for (const field of OLD_FIELDS) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field]) && mismatch === null) mismatch = { row, field, before: before[field], after: after[field] };
    }
    if (after.canManageBilling !== true && mismatch === null) mismatch = { row, field: "canManageBilling", after: after.canManageBilling };
  }
  check(mismatch === null, `an organization of one gets exactly what the profile code gave, in all ${cases} cases (first difference: ${JSON.stringify(mismatch)})`);
}
{
  const growthAtCap = { subscription_tier: "growth", claims_used_this_period: 75 };
  const u = usageFromBilling(growthAtCap, { organizationId: "o", role: "owner" });
  check(u.atLimit && u.remaining === 0 && u.limit === 75, "the hard cap is still hard: Growth at 75 of 75 is at its limit with none left");
  const trialSpent = usageFromBilling({ trial_claims_used: 5, trial_started_at: new Date().toISOString() }, { organizationId: "o", role: "owner" });
  check(!trialSpent.onTrial && trialSpent.trialExpiredReason === "claims", "the trial still ends at five claims, inside the window");
  const scan = usageFromBilling({ subscription_tier: "scan", trial_claims_used: 2, trial_started_at: new Date().toISOString() }, { organizationId: "o", role: "owner" });
  check(scan.noPlan && scan.onTrial && scan.limit === 0, "and a Scan-only organization is on the trial for claims, as a Scan-only person was");
}
{
  const row = { subscription_tier: "starter", claims_used_this_period: 7, seat_limit: 4 };
  const owner = usageFromBilling(row, { organizationId: "o", role: "owner" });
  const admin = usageFromBilling(row, { organizationId: "o", role: "admin" });
  const member = usageFromBilling(row, { organizationId: "o", role: "member" });
  check(owner.canManageBilling && !admin.canManageBilling && !member.canManageBilling, "only the owner manages billing; an admin does not");
  check(member.used === 7 && admin.used === 7 && owner.used === 7 && member.limit === 20, "everyone on a team sees the one shared counter and cap");
  check(owner.seatLimit === 4 && owner.organizationId === "o" && member.role === "member", "the state says whose numbers they are, and the seat limit");
  check(
    usageFromBilling(row, { organizationId: null, role: null }).canManageBilling === true,
    "a role that could not be read shows the billing buttons, as the page always did (checkout and the portal check the role themselves)",
  );
}

/* ── "0011 is not applied yet" ─────────────────────────────────────────────────────────────────── */

for (const code of ["42703", "42883", "42P01", "PGRST200", "PGRST202", "PGRST204", "PGRST205"]) {
  check(isBillingSchemaMissing({ code }), `${code} reads as the migration not applied, so the profile path is used`);
}
for (const code of ["42501", "PGRST301", "08006", "57014", "23505", "", null, undefined]) {
  check(!isBillingSchemaMissing({ code }), `${JSON.stringify(code)} does not — a refusal or an outage is never a reason to read stale numbers`);
}
check(!isBillingSchemaMissing(null) && !isBillingSchemaMissing(undefined), "and no error is no error");

/* ── Seats: room for a price, no price ─────────────────────────────────────────────────────────── */

check(SEAT_PRICING.kind === "unlimited", "no seat price is chosen (owner, 2026-10-13): seats are unlimited");
check(["starter", "growth", "unlimited", "scan", null].every((t) => seatLimitFor(t, 3) === null), "so every organization's stored seat limit stays null — no limit");
check(checkoutQuantity(7) === 1, "and checkout buys one of the price, however many people there are");
{
  const included = { kind: "included", seats: { starter: 1, growth: 3, unlimited: 10 } };
  check(seatLimitFor("starter", 1, included) === 1 && seatLimitFor("growth", 1, included) === 3 && seatLimitFor("unlimited", 99, included) === 10, "'included' seats come from the tier, whatever the quantity");
  check(seatLimitFor("scan", 1, included) === null && seatLimitFor(null, 1, included) === null, "an organization on the trial or on Scan alone has no seat limit");
  check(checkoutQuantity(7, included) === 1, "and still buys one of the price");
  const perSeat = { kind: "per_seat", minimum: 2 };
  check(seatLimitFor("growth", 5, perSeat) === 5 && seatLimitFor("growth", 1, perSeat) === 2 && seatLimitFor("growth", null, perSeat) === 2, "'per_seat' stores the quantity bought, never below the minimum");
  check(checkoutQuantity(7, perSeat) === 7 && checkoutQuantity(1, perSeat) === 2, "and checkout buys a seat for everyone already there, at least the minimum");
}

/* ── How a Stripe event finds its organization ─────────────────────────────────────────────────── */

{
  const org = "3f1c2a9e-7b4d-4c1e-9a2b-1d2e3f4a5b6c";
  check(
    JSON.stringify(billingLookups({ clientReferenceId: org, customerId: "cus_1" })) ===
      JSON.stringify([{ by: "organization", value: org }, { by: "owner", value: org }, { by: "customer", value: "cus_1" }]),
    "a checkout is matched by the organization id it carries, then as the person id checkouts carried before 0011, then by its customer",
  );
  check(JSON.stringify(billingLookups({ customerId: "cus_1" })) === JSON.stringify([{ by: "customer", value: "cus_1" }]), "a subscription event, carrying only its customer, by the customer");
  check(JSON.stringify(billingLookups({ clientReferenceId: "not-a-uuid", customerId: null })) === "[]", "and a reference that cannot be an id is not sent to Postgres at all");
}

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
