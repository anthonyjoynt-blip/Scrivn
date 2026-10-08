import "server-only";
import type { ScanInterval, SubscriptionTier } from "../plans";
import { cleanEnv } from "../env";

/**
 * Tier → Stripe Price ID, resolved server-side only.
 *
 * The client sends a tier name ("growth"), never a price ID. That direction matters: if the browser
 * supplied the price, anyone could substitute a different one — a cheaper tier's price, or a $0
 * test price — and check out against it. Mapping here means the only prices reachable are the ones
 * this deployment is configured with.
 *
 * These are Stripe Price IDs (`price_…`), not secrets, but they live in env vars rather than the
 * codebase because they differ between the sandbox and live accounts.
 */
const PRICE_ENV_VAR: Record<SubscriptionTier, string> = {
  starter: "STRIPE_PRICE_STARTER",
  growth: "STRIPE_PRICE_GROWTH",
  unlimited: "STRIPE_PRICE_UNLIMITED",
};

/** Scrivn Scan on its own has two prices, one product — see `SCAN_PLAN` in lib/plans.ts. */
const SCAN_PRICE_ENV_VAR: Record<ScanInterval, string> = {
  month: "STRIPE_PRICE_SCAN_MONTHLY",
  year: "STRIPE_PRICE_SCAN_YEARLY",
};

export function priceIdForTier(tier: SubscriptionTier): string {
  const envVar = PRICE_ENV_VAR[tier];
  const priceId = process.env[envVar];
  if (!priceId) {
    throw new Error(
      `${envVar} is not set, so the "${tier}" plan can't be checked out. Create the product/price in Stripe and add its price ID to .env.local — see supabase/../STRIPE.md.`,
    );
  }
  return priceId;
}

export function scanPriceId(interval: ScanInterval): string {
  const envVar = SCAN_PRICE_ENV_VAR[interval];
  const priceId = cleanEnv(envVar);
  if (!priceId) {
    throw new Error(`${envVar} is not set, so the Scan plan can't be checked out ${interval === "year" ? "yearly" : "monthly"}. See STRIPE.md.`);
  }
  return priceId;
}

/** Which tiers are actually purchasable in this deployment — a plan with no configured price is shown as unavailable rather than erroring on click. */
export function configuredTiers(): Set<SubscriptionTier> {
  const configured = new Set<SubscriptionTier>();
  for (const [tier, envVar] of Object.entries(PRICE_ENV_VAR) as [SubscriptionTier, string][]) {
    if (process.env[envVar]) configured.add(tier);
  }
  return configured;
}

/** The same for the Scan plan's two prices. */
export function configuredScanIntervals(): Set<ScanInterval> {
  const configured = new Set<ScanInterval>();
  for (const [interval, envVar] of Object.entries(SCAN_PRICE_ENV_VAR) as [ScanInterval, string][]) {
    if (cleanEnv(envVar)) configured.add(interval);
  }
  return configured;
}

/** The Scan plan's price IDs as configured, for the webhook's price → tier lookup. */
export function scanPriceIds(): string[] {
  return Object.values(SCAN_PRICE_ENV_VAR)
    .map((envVar) => cleanEnv(envVar))
    .filter((id): id is string => Boolean(id));
}
