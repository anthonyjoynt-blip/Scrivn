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
 * Whether an event about a subscription of `eventTier` may write the profile's tier, given what the
 * profile holds now. `eventTier` is the tier the subscription's price maps to, whatever its status —
 * null for a price this deployment doesn't know.
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
