import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanEnv } from "@/lib/env";
import { scanPriceIds } from "@/lib/stripe/prices";
import { SCAN_PLAN, SCAN_TIER, isScanTier, planForTier, seatLimitFor } from "@/lib/plans";
import {
  WEBHOOK_EVENTS,
  billingLookups,
  paymentEventApplies,
  paymentGraceEndsAt,
  scanSubscriptionsToCancel,
  subscriptionEventApplies,
  withinPaymentGrace,
  type BillingLookup,
} from "@/lib/billingTiers";
import { isBillingSchemaMissing } from "@/lib/usageState";
import { sendEmail } from "@/lib/email/send";
import { PaymentFailedEmail } from "@/emails/PaymentFailed";

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
 *
 * A declined card (2026-10-14, 0013): `invoice.payment_failed` records the failure and emails the
 * owner once per invoice; the subscription turning past due keeps its plan for PAYMENT_GRACE_DAYS
 * from the first failure, instead of losing it on the spot; `invoice.paid` clears it. On a database
 * without 0013 the plan goes at the first failure, as it did before.
 */

/** Handled events — `WEBHOOK_EVENTS` in lib/billingTiers.ts, which the go-live script prints. */
const HANDLED = new Set<string>(WEBHOOK_EVENTS);

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
        await handleSubscriptionChange(event.data.object, event.type === "customer.subscription.deleted", eventTime(event));
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object, eventTime(event), stripe);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object, eventTime(event), stripe);
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

/** When Stripe says the event happened, which orders a failure against the payment that clears it. */
function eventTime(event: Stripe.Event): string {
  return new Date(event.created * 1000).toISOString();
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
    // Null (no limit) on a Scrivn plan until a seat price is chosen, see SEAT_PRICING; one person on
    // the Scan plan (SCAN_SEATS).
    seat_limit: seatLimitFor(tier, quantityOf(subscription)),
    ...(customerId ? { stripe_customer_id: customerId } : {}),
  });
}

async function handleSubscriptionChange(subscription: Stripe.Subscription, deleted: boolean, at: string) {
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
    // a full fresh allowance to anyone who cancels and resubscribes. Stripe also cancels after the
    // last retry of a declined card; the failure goes with the plan it was about.
    await updateOrganization(admin, org.id, { subscription_tier: null, period_reset_at: null, seat_limit: null });
    await settlePayment(admin, org.id, at);
    return;
  }

  // A subscription that's unpaid or cancelled shouldn't keep its plan active. Past due — a renewal
  // the card did not pay, which Stripe is still retrying — keeps it through the grace period.
  const active = subscription.status === "active" || subscription.status === "trialing";
  const inGrace = subscription.status === "past_due" && eventTier !== null && (await planKeptWhilePastDue(admin, org.id, at));
  const tier = active || inGrace ? eventTier : null;
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

  // Active again: whatever failed before this has been paid.
  if (active) await settlePayment(admin, org.id, at);
}

/* ── A declined card (0013) ────────────────────────────────────────────────────────────────────── */

/**
 * The subscription an invoice bills, if it bills one. A one-off invoice is not about a plan.
 *
 * Events arrive in the API version of the endpoint they were sent to, which is fixed when the
 * endpoint is registered; before 2025-03-31 the subscription sat on the invoice itself. Both shapes
 * are read, as `periodEndIso` reads both shapes of the period end.
 */
function subscriptionOfInvoice(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription ?? (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  return typeof subscription === "string" ? subscription : (subscription?.id ?? null);
}

/**
 * Records a failure through `org_payment_failed`, keeping the time of the first. Null on a database
 * without 0013, where there is nowhere to keep it.
 */
async function recordPaymentFailure(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  invoiceId: string | null,
  failedAt: string,
): Promise<{ since: string; firstNotice: boolean } | null> {
  const { data, error } = await admin.rpc("org_payment_failed", { org_id: organizationId, invoice_id: invoiceId, failed_at: failedAt });
  if (error && isBillingSchemaMissing(error)) return null;
  if (error) throw new Error(`could not record the failed payment: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { failed_since?: string; first_notice?: boolean } | undefined;
  if (!row?.failed_since) return null;
  return { since: new Date(row.failed_since).toISOString(), firstNotice: row.first_notice === true };
}

/** Clears a failure from before `at` (`org_payment_settled`). Nothing to clear without 0013. */
async function settlePayment(admin: ReturnType<typeof createAdminClient>, organizationId: string, at: string) {
  const { error } = await admin.rpc("org_payment_settled", { org_id: organizationId, paid_at: at });
  if (error && !isBillingSchemaMissing(error)) throw new Error(`could not clear the failed payment: ${error.message}`);
}

/**
 * Whether a past-due subscription keeps its plan: yes for PAYMENT_GRACE_DAYS from the first failure.
 * The failure is recorded here too, because Stripe does not promise that `invoice.payment_failed`
 * arrives before the subscription turns past due. Without 0013, no: the plan goes, as before.
 */
async function planKeptWhilePastDue(admin: ReturnType<typeof createAdminClient>, organizationId: string, at: string): Promise<boolean> {
  const failure = await recordPaymentFailure(admin, organizationId, null, at);
  return failure !== null && withinPaymentGrace(failure.since, new Date(at).getTime());
}

async function handlePaymentFailed(invoice: Stripe.Invoice, at: string, stripe: Stripe) {
  const subscriptionId = subscriptionOfInvoice(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!subscriptionId || !customerId) return;

  const admin = createAdminClient();
  const org = await findOrganization(admin, billingLookups({ customerId }));
  if (!org) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const eventTier = tierForPriceId(subscription.items.data[0]?.price?.id);
  if (!paymentEventApplies({ eventTier, storedTier: org.subscription_tier })) return;

  const failure = await recordPaymentFailure(admin, org.id, invoice.id ?? null, at);
  // Without 0013 the plan went the moment the subscription turned past due, as it always did, so
  // there is no grace to tell anyone about: the in-app refusal says what to do.
  if (!failure?.firstNotice) return;

  const to = (await ownerEmail(admin, org.id)) ?? invoice.customer_email ?? null;
  if (!to) {
    console.error("[stripe webhook] a card was declined and the organization has nobody to tell:", org.id);
    return;
  }
  const planName = planForTier(eventTier)?.name ?? (isScanTier(eventTier) ? SCAN_PLAN.name.replace(/^Scrivn /, "") : "Scrivn");
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://scrivn.ca";
  // A failed send is logged by sendEmail, not thrown: the failure is recorded either way, and a
  // retry of this event would find the invoice already noticed and send nothing.
  await sendEmail({
    to,
    subject: "Your Scrivn card payment didn't go through",
    react: PaymentFailedEmail({
      planName,
      amount: formatAmount(invoice.amount_due, invoice.currency),
      graceEndDate: new Date(paymentGraceEndsAt(failure.since)).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" }),
      updateUrl: `${baseUrl}/billing`,
    }),
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice, at: string, stripe: Stripe) {
  const subscriptionId = subscriptionOfInvoice(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!subscriptionId || !customerId) return;

  const admin = createAdminClient();
  const org = await findOrganization(admin, billingLookups({ customerId }));
  if (!org) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const eventTier = tierForPriceId(subscription.items.data[0]?.price?.id);
  if (!paymentEventApplies({ eventTier, storedTier: org.subscription_tier })) return;
  await settlePayment(admin, org.id, at);
}

/** The organization owner's address: the one person who can update the card. */
async function ownerEmail(admin: ReturnType<typeof createAdminClient>, organizationId: string): Promise<string | null> {
  const { data: owner } = await admin.from("organization_members").select("user_id").eq("organization_id", organizationId).eq("role", "owner").maybeSingle();
  const ownerId = typeof owner?.user_id === "string" ? owner.user_id : null;
  if (!ownerId) return null;
  const { data } = await admin.auth.admin.getUserById(ownerId);
  return data?.user?.email ?? null;
}

/** "$44.07 CAD", from Stripe's cents. */
function formatAmount(cents: number | null | undefined, currency: string | null | undefined): string | null {
  if (typeof cents !== "number" || !currency) return null;
  return `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}
