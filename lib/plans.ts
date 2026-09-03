/**
 * The subscription tiers, their hard caps, and how they're described on the pricing page.
 *
 * Deliberately client-safe — no price IDs, no secrets. The checkout route takes a *tier id* from
 * the browser and looks the Stripe Price up server-side (see `lib/stripe/prices.ts`). Letting the
 * client hand over a raw price ID instead would mean anyone could open devtools and check out
 * against any price in the account, including a cheaper or $0 one.
 *
 * This is a HARD CAP model: at the limit, generation stops until the period resets or the plan is
 * upgraded. Nothing meters, and nothing bills beyond the subscription price — see
 * `lib/usage.ts`.
 */
export type SubscriptionTier = "starter" | "growth" | "unlimited";

export interface Plan {
  tier: SubscriptionTier;
  name: string;
  /** Claims per billing period. At this number, generation blocks. */
  claimLimit: number;
  /**
   * Shown on the pricing card. Display only — Stripe is the source of truth for what's actually
   * charged, and these two can drift apart if a price is edited in the Dashboard without updating
   * here. Currency is stated explicitly because "$" alone is ambiguous for a Canadian business
   * selling in CAD.
   */
  priceLabel: string;
  cadence: string;
  /**
   * The tier's bullet list on the pricing page. Copy comes from the approved pricing mockup
   * (design-reference/scrivn-pricing-mockup.html), with one deletion: Growth listed "Multiple team
   * members, one account", which isn't built — `profiles` is one row per auth user and there is no
   * shared-account structure. See the ACCURACY notes in app/faq/page.tsx for the matching change.
   */
  features: string[];
  /**
   * Free trial length in days. 0 = no trial, and the button then reads "Subscribe" rather than
   * "Start free trial" — a button promising a trial that the checkout session doesn't create would
   * be a straightforwardly false claim to a paying customer.
   *
   * Trial length is a pricing decision, so this is left at 0 rather than guessed. Set it here and
   * both the checkout session and the button label follow automatically.
   */
  trialDays: number;
}

export const PLANS: Plan[] = [
  {
    tier: "starter",
    name: "Starter",
    claimLimit: 20,
    priceLabel: "$39",
    cadence: "CAD / month",
    features: ["Scope + inspection report generation", "Gap-check follow-up questions", "Edit or revise any document", "Email support"],
    trialDays: 0,
  },
  {
    tier: "growth",
    name: "Growth",
    claimLimit: 75,
    priceLabel: "$89",
    cadence: "CAD / month",
    features: ["Everything in Starter", "Priority email support"],
    trialDays: 0,
  },
  {
    tier: "unlimited",
    name: "Unlimited",
    claimLimit: 300,
    priceLabel: "$179",
    cadence: "CAD / month",
    // Mockup read "Highest volume before overage". There is no overage to be before.
    features: ["Everything in Growth", "Highest claim volume available", "Priority email support"],
    trialDays: 0,
  },
];

export function planForTier(tier: string | null | undefined): Plan | null {
  if (!tier) return null;
  return PLANS.find((p) => p.tier === tier) ?? null;
}

/** The cap for a tier, or 0 for no/unknown tier — no plan means nothing can be generated. */
export function claimLimitForTier(tier: string | null | undefined): number {
  return planForTier(tier)?.claimLimit ?? 0;
}

/** Usage fraction at which the UI starts warning, before the hard stop. */
export const USAGE_WARNING_THRESHOLD = 0.8;

/**
 * The free trial: 5 claims within 30 days, whichever runs out first, with no card required.
 *
 * App-enforced rather than a Stripe trial — Stripe's `trial_period_days` is time-only and has no
 * notion of a "claim", and with no card there's no subscription to attach a trial to anyway. See
 * supabase/migrations/0003_trial.sql.
 *
 * Note this is unrelated to `Plan.trialDays`, which stays 0: that field controls a Stripe trial on a
 * *paid* subscription and is a separate mechanism that isn't currently used.
 */
export const TRIAL_CLAIM_LIMIT = 5;
export const TRIAL_DAYS = 30;
/** Trial claims used at which the "trial nearly over" email fires — 4 of 5, leaving one in hand. */
export const TRIAL_WARNING_AT_CLAIMS = 4;
