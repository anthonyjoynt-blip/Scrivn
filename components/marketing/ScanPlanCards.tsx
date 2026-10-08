import { PricingButton } from "@/components/PricingButton";
import { SCAN_PLAN, SCAN_TIER, type ScanInterval } from "@/lib/plans";
import { SCAN_GET_HREF, SCAN_GET_LABEL } from "@/lib/scanApp";

/**
 * Scrivn Scan's own plan as tier cards: monthly and yearly, and on the Scan page the free tier
 * beside them. Shared by /scan and /pricing so the two can't quote different prices. Sits inside a
 * `.mk-tiers` block, whose taller card style it relies on.
 */
export function ScanPlanCards({
  signedIn,
  billingOpen,
  available,
  returnPath,
  showFree,
}: {
  signedIn: boolean;
  billingOpen: boolean;
  available: Set<ScanInterval>;
  returnPath: "/pricing" | "/scan";
  showFree: boolean;
}) {
  return (
    <div className="mk-tier-row">
      {showFree && (
        <div className="mk-tier-card">
          <div className="mk-tname">Free</div>
          <div className="mk-tprice">$0</div>
          <div className="mk-tclaims">{SCAN_PLAN.freeScansPerMonth} scans a month</div>
          <div className="mk-tnote">No card needed</div>
          <ul className="mk-tfeatures">
            <li>Every feature in the app</li>
            <li>Floor plan PDF and to-scale JPG</li>
            <li>Upgrade when you need more</li>
          </ul>
          <a href={SCAN_GET_HREF} className="mk-tier-btn">
            {SCAN_GET_LABEL}
          </a>
        </div>
      )}
      <PlanCard interval="month" signedIn={signedIn} billingOpen={billingOpen} available={available} returnPath={returnPath} />
      <PlanCard interval="year" signedIn={signedIn} billingOpen={billingOpen} available={available} returnPath={returnPath} />
    </div>
  );
}

function PlanCard({
  interval,
  signedIn,
  billingOpen,
  available,
  returnPath,
}: {
  interval: ScanInterval;
  signedIn: boolean;
  billingOpen: boolean;
  available: Set<ScanInterval>;
  returnPath: "/pricing" | "/scan";
}) {
  const yearly = interval === "year";
  return (
    <div className={`mk-tier-card${yearly ? " featured" : ""}`}>
      {yearly && <div className="mk-badge">TWO MONTHS FREE</div>}
      <div className="mk-tname">{yearly ? "Scan yearly" : "Scan monthly"}</div>
      <div className="mk-tprice">
        {yearly ? SCAN_PLAN.yearlyLabel : SCAN_PLAN.monthlyLabel}
        <span>{yearly ? "/yr" : "/mo"}</span>
      </div>
      <div className="mk-tclaims">CAD, unlimited scans</div>
      <div className="mk-tnote">Cancel anytime</div>
      <ul className="mk-tfeatures">
        {SCAN_PLAN.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <PricingButton
        tier={SCAN_TIER}
        interval={interval}
        trialDays={0}
        signedIn={signedIn}
        available={available.has(interval)}
        billingOpen={billingOpen}
        buttonClassName="mk-tier-btn"
        returnPath={returnPath}
      />
    </div>
  );
}
