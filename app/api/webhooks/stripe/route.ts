import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanEnv } from "@/lib/env";

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
 * billing columns are intentionally not user-writable (see migration 0002).
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
  return null;
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

  // client_reference_id is the user id we set at checkout; customer id is the fallback path.
  const userId = session.client_reference_id;
  const match = userId ? { id: userId } : customerId ? { stripe_customer_id: customerId } : null;
  if (!match) return;

  await admin
    .from("profiles")
    .update({
      subscription_tier: tier,
      // A fresh subscription starts a fresh allowance.
      claims_used_this_period: 0,
      period_reset_at: periodEndIso(subscription),
      ...(customerId ? { stripe_customer_id: customerId } : {}),
    })
    .match(match);
}

async function handleSubscriptionChange(subscription: Stripe.Subscription, deleted: boolean) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return;

  const admin = createAdminClient();

  if (deleted) {
    // Cancelled: back to no plan. Usage is left as-is rather than zeroed — resetting it would hand
    // a full fresh allowance to anyone who cancels and resubscribes.
    await admin.from("profiles").update({ subscription_tier: null, period_reset_at: null }).eq("stripe_customer_id", customerId);
    return;
  }

  // A subscription that's past due, unpaid, or cancelled shouldn't keep its plan active.
  const active = subscription.status === "active" || subscription.status === "trialing";
  const tier = active ? tierForPriceId(subscription.items.data[0]?.price?.id) : null;
  const newPeriodEnd = periodEndIso(subscription);

  const { data: profile } = await admin
    .from("profiles")
    .select("period_reset_at")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  // A renewal shows up here as a period end later than the one we stored — that, not a separate
  // event, is what rolls the usage counter over for the new period. Plan changes mid-period keep
  // their existing usage.
  const storedEnd = (profile?.period_reset_at as string | null) ?? null;
  const isNewPeriod = Boolean(newPeriodEnd && (!storedEnd || new Date(newPeriodEnd) > new Date(storedEnd)));

  await admin
    .from("profiles")
    .update({
      subscription_tier: tier,
      period_reset_at: newPeriodEnd,
      ...(isNewPeriod ? { claims_used_this_period: 0 } : {}),
    })
    .eq("stripe_customer_id", customerId);
}
