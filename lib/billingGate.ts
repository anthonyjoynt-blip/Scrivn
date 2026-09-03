import "server-only";

/**
 * Whether this deployment will take money.
 *
 * Scrivn is deployed and usable before it is a business: the tax registration is not sorted, and
 * `STRIPE_WEBHOOK_SECRET` is not set in production, which means a payment would be taken and the
 * app would never hear about it — the customer is charged and nothing unlocks. A checkout that
 * cannot complete should not be reachable, so this closes it deliberately rather than leaving it
 * open on the hope that nobody clicks.
 *
 * Fails CLOSED. Billing is on only when `BILLING_ENABLED` is exactly "true"; a missing, misspelt or
 * empty value leaves it off. The other way round — open unless told otherwise — puts a payment page
 * in front of the public the first time someone forgets an environment variable, and the cost of
 * that mistake is somebody's money.
 *
 * Turning it on is one variable, and the checks it guards are the same ones that were always there.
 */
export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

/** What to tell someone who reaches a purchase path while billing is off. */
export const BILLING_DISABLED_MESSAGE = "Scrivn isn’t taking subscriptions yet.";
