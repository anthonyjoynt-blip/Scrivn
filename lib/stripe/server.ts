import "server-only";
import Stripe from "stripe";

/**
 * The server-side Stripe client. `server-only` makes importing this from a Client Component a build
 * error — `STRIPE_SECRET_KEY` has full API access to the account and must never reach the browser.
 *
 * Instantiated as a client object rather than the old module-level `Stripe.setApiKey(...)` global,
 * which is deprecated across all current Stripe SDKs.
 *
 * No `apiVersion` override on purpose: the installed SDK (v22.6.0) already pins
 * `2026-08-26.dahlia`, the current version. Hardcoding a version string here would only create a
 * second place to forget to update, and pinning an older one than the SDK expects causes response
 * shapes to drift from the SDK's own types.
 */
let cached: Stripe | undefined;

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env.local (see .env.local.example).");
  }
  cached ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return cached;
}

/** Whether Stripe is configured at all — lets billing-aware UI degrade instead of throwing when it isn't. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
