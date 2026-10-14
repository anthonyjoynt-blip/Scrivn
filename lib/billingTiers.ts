import { isScanTier, isScrivnTier } from "./plans";

/**
 * The webhook's rules for a customer who can hold two subscriptions at once.
 *
 * Until the Scan plan (2026-10-08) every customer had at most one, so each subscription event simply
 * wrote its tier. Now someone on Scan who buys a Scrivn plan briefly holds both: the Scrivn plan
 * includes Scan, so the webhook cancels the Scan subscription (`scanSubscriptionsToCancel`), and the
 * events that cancellation sends must not take the Scrivn plan with it. Kept free of Stripe and
 * Supabase so `npm run test:billing` can hold them to it.
 */

/**
 * Whether an event about a subscription of `eventTier` may write the organization's tier, given what
 * it holds now (the profile's, before 0011 — the rule is the same). `eventTier` is the tier the
 * subscription's price maps to, whatever its status — null for a price this deployment doesn't know.
 */
export function subscriptionEventApplies({
  eventTier,
  storedTier,
  deleted,
}: {
  eventTier: string | null;
  storedTier: string | null;
  deleted: boolean;
}): boolean {
  // A Scan subscription never touches a Scrivn plan — neither its renewal, its lapse nor its
  // cancellation. The Scrivn plan already covers Scan.
  if (isScanTier(eventTier) && isScrivnTier(storedTier)) return false;
  // A cancelled subscription takes away only the plan it gave.
  if (deleted && eventTier && storedTier && eventTier !== storedTier) return false;
  return true;
}

/**
 * How a Stripe event finds the organization it is about (0011: the plan is the organization's), in
 * the order to try:
 *
 *   1. the checkout's `client_reference_id` as an organization id — what checkout sends now;
 *   2. the same value as a person's id, resolved to the organization they own — what checkout sent
 *      before 0011, so a session opened just before the change still lands;
 *   3. the Stripe customer id, stored on the organization at its first checkout — the only key a
 *      subscription event carries.
 *
 * Ids that cannot be uuids are skipped rather than sent to Postgres to fail.
 */
export type BillingLookup = { by: "organization" | "owner" | "customer"; value: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function billingLookups({ clientReferenceId, customerId }: { clientReferenceId?: string | null; customerId?: string | null }): BillingLookup[] {
  const out: BillingLookup[] = [];
  if (clientReferenceId && UUID.test(clientReferenceId)) {
    out.push({ by: "organization", value: clientReferenceId }, { by: "owner", value: clientReferenceId });
  }
  if (customerId) out.push({ by: "customer", value: customerId });
  return out;
}

/** One of the customer's subscriptions, reduced to what the rule below reads. */
export interface SubscriptionSummary {
  id: string;
  status: string;
  priceId: string | null;
}

/** Statuses a subscription can still charge in — the ones worth cancelling. */
const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

/**
 * The customer's Scan subscriptions to cancel now that they have bought `boughtTier` through the
 * subscription `boughtId`: all of them when it is a Scrivn plan, none otherwise.
 */
export function scanSubscriptionsToCancel(
  subscriptions: SubscriptionSummary[],
  scanPriceIds: string[],
  boughtTier: string | null,
  boughtId: string,
): string[] {
  if (!isScrivnTier(boughtTier)) return [];
  return subscriptions
    .filter((s) => s.id !== boughtId && LIVE.has(s.status) && s.priceId != null && scanPriceIds.includes(s.priceId))
    .map((s) => s.id);
}
