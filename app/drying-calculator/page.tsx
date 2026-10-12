import { MarketingShell } from "@/components/marketing/MarketingShell";
import { DryingCalculator } from "@/components/marketing/DryingCalculator";

/**
 * The public drying equipment calculator: no sign-in, beside How It Works and the FAQ.
 *
 * The page is the shell and the copy; the calculator is a client component on lib/dryingPlan.ts, the
 * engine the sketch's equipment panel counts with — see components/marketing/DryingCalculator.tsx.
 */
export const metadata = {
  title: "Drying Equipment Calculator — Scrivn",
  description: "How many air movers and dehumidifiers a water loss needs, room by room, from IICRC S500 guidance — with a suggested layout.",
};

export default function DryingCalculatorPage() {
  return (
    <MarketingShell page="drying-calculator">
      <div className="mk-pagehead wrap">
        <h1>Drying equipment calculator</h1>
        <p>Air movers and dehumidifiers for a water loss, room by room, from IICRC S500 guidance. Every count rounds up.</p>
      </div>

      <div className="wrap-narrow">
        <DryingCalculator />
      </div>
    </MarketingShell>
  );
}
