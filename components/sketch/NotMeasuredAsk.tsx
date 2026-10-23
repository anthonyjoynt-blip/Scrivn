import type { Exterior } from "@/lib/exterior";
import { notMeasuredAsks } from "@/lib/photoRouteExterior";

/**
 * What settles the sizes not measured (2026-10-23, lib/photoRouteExterior.ts `notMeasuredAsks`): a line each, the one wall
 * named - "A tape or laser along the Fence side settles both." Said on the measure's results and at Use it; asked, never
 * required: nothing waits on it, and Finish and Use it work as ever. Nothing when every size is measured.
 */
export function NotMeasuredAsk({ exterior, className, after }: { exterior: Pick<Exterior, "sides" | "upper" | "photoRoute">; className?: string; /** What follows the asks: when to put it in. */ after: string }) {
  const asks = notMeasuredAsks(exterior);
  if (asks.length === 0) return null;
  return (
    <div className={className}>
      {asks.map((a) => (
        <p key={a}>{a}</p>
      ))}
      <p className="field-note">{after}</p>
    </div>
  );
}
