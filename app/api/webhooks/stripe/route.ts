import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanEnv } from "@/lib/env";
import { scanPriceIds } from "@/lib/stripe/prices";
import { SCAN_TIER, seatLimitFor } from "@/lib/plans";
import { billingLookups, scanSubscriptionsToCancel, subscriptionEventApplies, type BillingLookup } from "@/lib/billingTiers";

/**
 * The Stripe webhook — what makes a subscription real to this app rather than only to Stripe.
 *
 * Reached by Stripe's servers, not a browser: no cookies, no session. `middleware.ts` lets this
 * path through unauthenticated, which is safe only because of the signature check below — that
 * check is the authentication for this endpoint. Without it, anyone who found the URL could POST a
 * forged "subscription active" event and grant themselves a plan.
 *
 * Subscription state changes happen asynchronously and long after checkout — renewals,
 * cancellations, plan changes, failed payments. An integration that only reads the checkout success
 * page never learns about any of them, which is why this handler is required rather than optional.
 *
 * Writes go through the service-role client: there's no user session to satisfy RLS, and the
 * billing columns are intentionally not user-writable (see migrations 0002 and 0011).
 *
 * The plan belongs to the ORGANIZATION (0011_org_billing.sql): a team shares one subscription. Alone,
 * a person's organization is theirs alone, so a purchase lands where it always effectively did. Only
 * the owner can reach checkout (app/api/checkout), and the organization an event is about is found
 * by `billingLookups` — the organization id checkout sends, the person id it sent before 0011, or the
 * Stripe customer stored on the organization.
 */

/** Handled events. Renewals arrive as `customer.subscription.updated` with a later period end. */
const HANDLED = new Set(["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted"]);

export async function POST(request: Request) {
  const secret = cleanEnv("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET is not set — refusing to process unverifiable events.");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  // The raw, unparsed body — the signature is computed over exact bytes, so `request.json()` here
  // would reserialize and invalidate it.
  const rawBody = await request.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (err) {
    // Either a forgery or a genuine secret mismatch. Both are a 400; neither should reach the
    // handlers below.
    console.error("[stripe webhook] signature verification failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    // Acknowledged, not an error — Stripe retries non-2xx responses, and an endpoint subscribed to
    // extra event types shouldn't generate retry storms for events it deliberately ignores.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object, stripe);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChange(event.data.object, event.type === "customer.subscription.deleted");
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry with backoff, which is what we want for a transient database
    // failure — better than acknowledging an event whose state never got written.
    console.error(`[stripe webhook] failed handling ${event.type}:`, err);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Maps a Stripe Price ID back to one of our tiers. Env lookup, so a re-pointed price needs no code change. */
function tierForPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  if (priceId === cleanEnv("STRIPE_PRICE_STARTER")) return "starter";
  if (priceId === cleanEnv("STRIPE_PRICE_GROWTH")) return "growth";
  if (priceId === process.env.STRIPE_PRICE_UNLIMITED) return "unlimited";
  // Scan on its own: two prices (monthly, yearly), one tier.
  if (scanPriceIds().includes(priceId)) return SCAN_TIER;
  return null;
}

/** The organization an event is about, with what it holds now. */
interface BillingTarget {
  id: string;
  subscription_tier: string | null;
  period_reset_at: string | null;
}

/** The first organization the lookups reach, in their order — see `billingLookups`. */
async function findOrganization(admin: ReturnType<typeof createAdminClient>, lookups: BillingLookup[]): Promise<BillingTarget | null> {
  for (const lookup of lookups) {
    let organizationId: string | null = null;
    let column = "id";
    if (lookup.by === "owner") {
      const { data } = await admin.from("organization_members").select("organization_id").eq("user_id", lookup.value).eq("role", "owner").maybeSingle();
      organizationId = (data?.organization_id as string | undefined) ?? null;
      if (!organizationId) continue;
    } else if (lookup.by === "customer") {
      column = "stripe_customer_id";
    }
    const { data, error } = await admin
      .from("organizations")
      .select("id, subscription_tier, period_reset_at")
      .eq(column, organizationId ?? lookup.value)
      .maybeSingle();
    // A failed read is not "no such organization": throw, so Stripe retries rather than the event being dropped.
    if (error) throw new Error(`could not look up the organization: ${error.message}`);
    if (data) return data as BillingTarget;
  }
  return null;
}

/** What one subscription item is bought in — the seat count, if seats are ever priced one by one. */
function quantityOf(subscription: Stripe.Subscription): number | null {
  return subscription.items?.data?.[0]?.quantity ?? null;
}

/** Writes to one organization, throwing on failure so the event is retried rather than lost. */
async function updateOrganization(admin: ReturnType<typeof createAdminClient>, id: string, values: Record<string, unknown>) {
  const { error } = await admin.from("organizations").update(values).eq("id", id);
  if (error) throw new Error(`could not update the organization's plan: ${error.message}`);
}

/**
 * Cancels the customer's Scan subscriptions once they have bought a Scrivn plan, which includes Scan
 * — otherwise they would go on paying for both. Prorated, so the unused part of the Scan period comes
 * back as credit on their next Scrivn bill. A failure is logged and not thrown: the Scrivn plan is
 * already theirs, and a Stripe retry would only repeat the grant; the Scan subscription stays visible
 * (and cancellable) in the billing portal.
 */
async function cancelScanOnceScrivnBought(stripe: Stripe, customerId: string, boughtTier: string, boughtId: string) {
  try {
    const { data } = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    const ids = scanSubscriptionsToCancel(
      data.map((s) => ({ id: s.id, status: s.status, priceId: s.items.data[0]?.price?.id ?? null })),
      scanPriceIds(),
      boughtTier,
      boughtId,
    );
    for (const id of ids) await stripe.subscriptions.cancel(id, { prorate: true, invoice_now: true });
  } catch (err) {
    console.error("[stripe webhook] could not cancel the Scan subscription a Scrivn plan replaces:", err);
  }
}

/** Period end lives on the subscription item in current API versions; fall back to the subscription for older shapes. */
function periodEndIso(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
  const epoch = item?.current_period_end ?? (subscription as unknown as { current_period_end?: number }).current_period_end;
  return typeof epoch === "number" ? new Date(epoch * 1000).toISOString() : null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, stripe: Stripe) {
  // Subscriptions complete synchronously for card payments, but a delayed payment method can leave
  // a session completed-but-unpaid. Granting a plan on an unpaid session is exactly the hole this
  // check closes.
  if (session.payment_status === "unpaid") return;

  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const tier = tierForPriceId(subscription.items.data[0]?.price?.id);
  if (!tier) {
    console.error("[stripe webhook] checkout completed for an unrecognised price — no tier assigned.");
    return;
  }

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const admin = createAdminClient();

  // client_reference_id is the organization id checkout sets; customer id is the fallback path.
  const org = await findOrganization(admin, billingLookups({ clientReferenceId: session.client_reference_id, customerId }));
  if (!org) {
    console.error("[stripe webhook] checkout completed for no organization this deployment knows — no tier assigned.");
    return;
  }

  // Scan bought by someone already on a Scrivn plan (the checkout route refuses it, so only a race
  // gets here): the Scrivn plan stays.
  if (!subscriptionEventApplies({ eventTier: tier, storedTier: org.subscription_tier, deleted: false })) return;

  if (customerId) await cancelScanOnceScrivnBought(stripe, customerId, tier, subscription.id);

  await updateOrganization(admin, org.id, {
    subscription_tier: tier,
    // A fresh subscription starts a fresh allowance.
    claims_used_this_period: 0,
    period_reset_at: periodEndIso(subscription),
    // Null — no limit — until a seat price is chosen; see SEAT_PRICING in lib/plans.ts.
    seat_limit: seatLimitFor(tier, quantityOf(subscription)),
    ...(customerId ? { stripe_customer_id: customerId } : {}),
  });
}

async function handleSubscriptionChange(subscription: Stripe.Subscription, deleted: boolean) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return;

  const admin = createAdminClient();
  const org = await findOrganization(admin, billingLookups({ customerId }));
  if (!org) return;

  // Not every subscription event is about the plan the organization holds: a Scan subscription a
  // Scrivn plan replaced still sends its cancellation — see lib/billingTiers.ts.
  const eventTier = tierForPriceId(subscription.items.data[0]?.price?.id);
  if (!subscriptionEventApplies({ eventTier, storedTier: org.subscription_tier, deleted })) return;

  if (deleted) {
    // Cancelled: back to no plan. Usage is left as-is rather than zeroed — resetting it would hand
    // a full fresh allowance to anyone who cancels and resubscribes.
    await updateOrganization(admin, org.id, { subscription_tier: null, period_reset_at: null, seat_limit: null });
    return;
  }

  // A subscription that's past due, unpaid, or cancelled shouldn't keep its plan active.
  const active = subscription.status === "active" || subscription.status === "trialing";
  const tier = active ? eventTier : null;
  const newPeriodEnd = periodEndIso(subscription);

  // A renewal shows up here as a period end later than the one we stored — that, not a separate
  // event, is what rolls the usage counter over for the new period. Plan changes mid-period keep
  // their existing usage.
  const storedEnd = org.period_reset_at;
  const isNewPeriod = Boolean(newPeriodEnd && (!storedEnd || new Date(newPeriodEnd) > new Date(storedEnd)));

  await updateOrganization(admin, org.id, {
    subscription_tier: tier,
    period_reset_at: newPeriodEnd,
    seat_limit: seatLimitFor(tier, quantityOf(subscription)),
    ...(isNewPeriod ? { claims_used_this_period: 0 } : {}),
  });
}
