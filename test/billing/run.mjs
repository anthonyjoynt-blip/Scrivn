/**
 * Scrivn Scan's own plan beside the Scrivn plans (2026-10-08): the rules the Stripe webhook keeps for
 * a customer who briefly holds two subscriptions.
 *
 *   npm run test:billing
 *
 * lib/billingTiers.ts is pure — no Stripe, no Supabase — so the rules are tested as the decisions
 * they are: which events may write the profile's tier, and which subscriptions a purchase cancels.
 * Also holds lib/plans.ts to the shape the rest of the app relies on: Scan is not a Scrivn `Plan`,
 * so the claim caps and the trial never see it.
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
    contents: `export * from "@/lib/billingTiers"; export * from "@/lib/plans";`,
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

const { subscriptionEventApplies, scanSubscriptionsToCancel, PLANS, SCAN_TIER, SCAN_PLAN, planForTier, claimLimitForTier, isScanTier, isScrivnTier } = await import(
  pathToFileURL(bundlePath).href
);

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

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
