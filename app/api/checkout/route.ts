import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";
import { BILLING_DISABLED_MESSAGE, isBillingEnabled } from "@/lib/billingGate";
import { priceIdForTier } from "@/lib/stripe/prices";
import { PLANS, type SubscriptionTier } from "@/lib/plans";

/** Random 8-letter suffix for `integration_identifier` — lets checkout flows be compared in the Stripe Dashboard. */
function integrationIdentifier(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += letters[Math.floor(Math.random() * letters.length)];
  return `scrivn-pricing-${suffix}`;
}

/**
 * Creates a Stripe Checkout Session for the signed-in user and returns its URL.
 *
 * Two things here are deliberate and security-relevant:
 *
 * 1. **The user comes from the Supabase session, never the request body.** A client-supplied user
 *    id would let anyone attach a subscription to someone else's account.
 * 2. **The client sends a tier name, not a price ID.** The price is resolved server-side (see
 *    lib/stripe/prices.ts) so the only purchasable prices are this deployment's three.
 */
export async function POST(request: Request) {
  // Before anything else, including the auth check: there is nothing to authorise if the deployment
  // is not selling. See `isBillingEnabled` for why this fails closed.
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: BILLING_DISABLED_MESSAGE }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  const email = typeof claims?.email === "string" ? claims.email : undefined;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const tier = (body as { tier?: unknown } | null)?.tier;
  const plan = PLANS.find((p) => p.tier === tier);
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const admin = createAdminClient();

    // Reuse this user's Stripe customer if they've checked out before, so repeat checkouts and
    // plan changes stay on one customer record (and one card, one invoice history).
    const { data: profile } = await admin.from("profiles").select("stripe_customer_id, full_name").eq("id", userId).maybeSingle();
    let customerId = (profile?.stripe_customer_id as string | null) ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: (profile?.full_name as string | null) ?? undefined,
        // The webhook's fallback route back to this profile if a session ever arrives without
        // client_reference_id — see the webhook's resolveUserId.
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
      // Stored now, not on webhook receipt: the customer exists in Stripe from this moment, and if
      // the user abandons checkout we still want to reuse it rather than create a duplicate.
      await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId);
    }

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      // Deliberately NOT setting payment_method_types — omitting it enables dynamic payment
      // methods, so what's offered is controlled from the Dashboard and adapts to the customer.
      // Hardcoding ['card'] here would silently disable everything else.
      line_items: [{ price: priceIdForTier(plan.tier as SubscriptionTier), quantity: 1 }],
      ...(plan.trialDays > 0 ? { subscription_data: { trial_period_days: plan.trialDays } } : {}),
      // Belt and braces for matching the event back to a profile in the webhook.
      client_reference_id: userId,
      success_url: `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
      // Returning to pricing with no error state — a cancelled checkout is just a change of mind.
      cancel_url: `${origin}/pricing`,
      integration_identifier: integrationIdentifier(),
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL." }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[/api/checkout]", err);
    const message = err instanceof Error ? err.message : "Could not start checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
