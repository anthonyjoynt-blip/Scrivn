import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";
import { BILLING_DISABLED_MESSAGE, isBillingEnabled } from "@/lib/billingGate";
import { priceIdForTier, scanPriceId } from "@/lib/stripe/prices";
import { PLANS, SCAN_TIER, SEAT_PRICING, checkoutQuantity, isScanTier, isScrivnTier, type ScanInterval, type SubscriptionTier } from "@/lib/plans";
import { canManageBilling, isOrgRole } from "@/lib/teams";

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
 * Three things here are deliberate and security-relevant:
 *
 * 1. **The user comes from the Supabase session, never the request body,** and the organization from
 *    their membership. A client-supplied id would let anyone attach a subscription to someone else's
 *    account.
 * 2. **The client sends a tier name, not a price ID.** The price is resolved server-side (see
 *    lib/stripe/prices.ts) so the only purchasable prices are this deployment's configured ones —
 *    the three Scrivn plans and Scan's monthly and yearly.
 * 3. **Only the organization's owner buys** (0011: the plan is the organization's). Alone, everyone
 *    owns their own organization, so this refuses nobody today; on a team it keeps a member from
 *    changing the company's plan.
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

  // Through the person's own session, so RLS answers: their organization, and their role in it.
  const { data: membership } = await supabase.from("organization_members").select("organization_id, role").eq("user_id", userId).limit(1).maybeSingle();
  const organizationId = typeof membership?.organization_id === "string" ? membership.organization_id : null;
  if (!organizationId) {
    return NextResponse.json({ error: "This account has no organization yet." }, { status: 409 });
  }
  if (!canManageBilling(isOrgRole(membership?.role) ? membership.role : null)) {
    return NextResponse.json({ error: "Only your organization’s owner can change its plan." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { tier, interval, from } = (body ?? {}) as { tier?: unknown; interval?: unknown; from?: unknown };
  // Scan on its own is a tier with two prices rather than a `Plan` — see SCAN_PLAN in lib/plans.ts.
  const scan = tier === SCAN_TIER;
  const plan = scan ? null : PLANS.find((p) => p.tier === tier);
  if (!scan && !plan) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }
  const scanInterval: ScanInterval = interval === "year" ? "year" : "month";
  // Where a cancelled checkout goes back to: a fixed path, never one the request names.
  const returnPath = from === "scan" ? "/scan" : "/pricing";

  try {
    const stripe = getStripe();
    const admin = createAdminClient();

    // Reuse the organization's Stripe customer if it has checked out before, so repeat checkouts and
    // plan changes stay on one customer record (and one card, one invoice history).
    const [{ data: org, error: orgError }, { data: profile }] = await Promise.all([
      admin.from("organizations").select("stripe_customer_id, subscription_tier").eq("id", organizationId).maybeSingle(),
      admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    ]);
    if (orgError) throw new Error(`Could not read the organization's plan: ${orgError.message}`);

    // Every Scrivn plan includes Scan, so the Scan plan is for people without one; and a second Scan
    // subscription would bill twice for the same thing.
    const currentTier = (org?.subscription_tier as string | null) ?? null;
    if (scan && isScrivnTier(currentTier)) {
      return NextResponse.json({ error: "Your Scrivn plan already includes Scan." }, { status: 409 });
    }
    if (scan && isScanTier(currentTier)) {
      return NextResponse.json({ error: "You already have the Scan plan. Change or cancel it from your account." }, { status: 409 });
    }

    let customerId = (org?.stripe_customer_id as string | null) ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: (profile?.full_name as string | null) ?? undefined,
        // Whose customer this is, readable in the Stripe Dashboard. The webhook finds the
        // organization by the stored customer id, or by client_reference_id below.
        metadata: { organization_id: organizationId, supabase_user_id: userId },
      });
      customerId = customer.id;
      // Stored now, not on webhook receipt: the customer exists in Stripe from this moment, and if
      // the user abandons checkout we still want to reuse it rather than create a duplicate.
      await admin.from("organizations").update({ stripe_customer_id: customerId }).eq("id", organizationId);
    }

    // One of the price, unless seats are ever priced one by one — SEAT_PRICING in lib/plans.ts.
    const quantity = SEAT_PRICING.kind === "per_seat" ? checkoutQuantity(await memberCount(admin, organizationId)) : 1;

    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      // Deliberately NOT setting payment_method_types — omitting it enables dynamic payment
      // methods, so what's offered is controlled from the Dashboard and adapts to the customer.
      // Hardcoding ['card'] here would silently disable everything else.
      line_items: [{ price: plan ? priceIdForTier(plan.tier as SubscriptionTier) : scanPriceId(scanInterval), quantity }],
      ...(plan && plan.trialDays > 0 ? { subscription_data: { trial_period_days: plan.trialDays } } : {}),
      // How the webhook finds the organization the plan is for (lib/billingTiers.ts billingLookups).
      client_reference_id: organizationId,
      // `plan=scan` only words the page (the Scan plan has no claims); it grants nothing.
      success_url: `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}${scan ? "&plan=scan" : ""}`,
      // Returning to the page they came from with no error state — a cancelled checkout is just a
      // change of mind.
      cancel_url: `${origin}${returnPath}`,
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

/** How many people are in the organization — only asked when seats are priced one by one. */
async function memberCount(admin: ReturnType<typeof createAdminClient>, organizationId: string): Promise<number> {
  const { count } = await admin.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", organizationId);
  return count ?? 1;
}
