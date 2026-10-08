import Link from "next/link";
import { PLANS } from "@/lib/plans";
import { configuredScanIntervals, configuredTiers } from "@/lib/stripe/prices";
import { isBillingEnabled } from "@/lib/billingGate";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { PricingButton } from "@/components/PricingButton";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { ScanPlanCards } from "@/components/marketing/ScanPlanCards";
import { SCAN_PLAN } from "@/lib/plans";

/**
 * The pricing page — approved design from design-reference/scrivn-pricing-mockup.html over the
 * checkout wiring that was already here.
 *
 * Still a Server Component, for the two things it has to know before rendering: whether the visitor
 * is signed in (which decides whether Subscribe goes straight to checkout or through sign-up first),
 * and which tiers actually have a Stripe Price configured. A tier without one renders as unavailable
 * rather than as a button that errors on click.
 *
 * ACCURACY: the mockup put a per-claim overage rate under every tier ("$2.00 per claim after that",
 * and Unlimited's "Highest volume before overage"). This is a hard-cap product — lib/usage.ts stops
 * generation at the limit and nothing bills past the subscription price — so that line has been
 * replaced with what actually happens. Advertising overage would have promised uninterrupted work at
 * the cap and delivered a blocked generation instead.
 */
export const metadata = {
  title: "Pricing — Scrivn",
  description: "Simple monthly plans priced around the documentation step, with a hard claim cap and no overage billing.",
};

/** Same for every tier, so it's stated once rather than three times with room to drift. */
const CAP_NOTE = "Hard cap — no overage billing";

export default async function PricingPage() {
  let signedIn = false;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    signedIn = data?.claims != null;
  }

  const available = configuredTiers();
  const billingOpen = isBillingEnabled();

  return (
    <MarketingShell page="pricing">
      <div className="mk-pagehead wrap">
        <h1>Simple pricing, no full-platform price tag</h1>
        <p>Built around getting your documentation done fast and right — priced for exactly that, not a bundle of features you may not need yet.</p>
      </div>

      <div className="mk-tiers wrap">
        <div className="mk-tier-row">
          {PLANS.map((plan) => {
            const featured = plan.tier === "growth";
            return (
              <div className={`mk-tier-card${featured ? " featured" : ""}`} key={plan.tier}>
                {featured && <div className="mk-badge">MOST POPULAR</div>}
                <div className="mk-tname">{plan.name}</div>
                <div className="mk-tprice">
                  {plan.priceLabel}
                  <span>/mo</span>
                </div>
                <div className="mk-tclaims">{plan.claimLimit} claims included</div>
                <div className="mk-tnote">{CAP_NOTE}</div>
                <ul className="mk-tfeatures">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <PricingButton
                  tier={plan.tier}
                  trialDays={plan.trialDays}
                  signedIn={signedIn}
                  available={available.has(plan.tier)}
                  billingOpen={billingOpen}
                  buttonClassName="mk-tier-btn"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/*
        Scan on its own, for someone who needs floor plans and not estimates (owner, 2026-10-08).
        Below the Scrivn tiers rather than among them: it has no claims, and every plan above
        already includes it — see SCAN_PLAN in lib/plans.ts.
      */}
      <div className="mk-tiers mk-scan-offer wrap">
        <div className="mk-scan-offer-head">
          <h2>Just need floor plans?</h2>
          <p>
            <Link href="/scan">Scrivn Scan</Link> on its own: measured floor plans from your phone. Free for {SCAN_PLAN.freeScansPerMonth} scans a month, and every
            plan above includes it.
          </p>
        </div>
        <ScanPlanCards signedIn={signedIn} billingOpen={billingOpen} available={configuredScanIntervals()} returnPath="/pricing" showFree={false} />
      </div>

      <div className="wrap">
        <div className="mk-enterprise">
          <div className="mk-enterprise-copy">
            <h2>Multiple offices?</h2>
            <p>
              One consolidated account for your whole company — a shared claims pool across every office instead of separate subscriptions, with a discounted per-claim rate at
              real volume.
            </p>
          </div>
          {/* Pre-selects the matching reason on the contact form so the enquiry arrives labelled. */}
          <Link href="/contact?reason=enterprise" className="mk-enterprise-btn">
            Get a custom quote
          </Link>
        </div>

        <div className="mk-reassure">
          <div>
            <b>No credit card</b> required to try it
          </div>
          <div>
            <b>Cancel</b> anytime
          </div>
          <div>
            <b>Switch plans</b> whenever your volume changes
          </div>
        </div>
      </div>
    </MarketingShell>
  );
}
