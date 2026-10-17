"use client";

import { useState } from "react";
import type { Exterior } from "@/lib/exterior";
import type { Letterhead } from "@/lib/letterhead";
import { exteriorReportFile } from "./sketch/exteriorReportDoc";

/**
 * The Exterior report's door on the claim page (2026-10-15), beside the drying log's and for its reason:
 * a document of the outside of the house that can be had at any stage, before or after the claim's
 * documents are generated. Every elevation to scale, the footprint, the roof plan with every line's
 * length, the side photos and every measurement in tables - the report Scrivn Scan's Share makes on
 * the phone, built from the claim's exterior. No Claude call: everything in it is measured, read or
 * worked out already.
 */
export function ExteriorReportSection({
  exterior,
  buildings = [],
  title,
  jobNumber,
  customerName,
  letterhead,
  claimId = null,
}: {
  /** The house's; none on a claim with only other buildings measured. */
  exterior: Exterior | undefined;
  /** The claim's other buildings (2026-10-16): each a section of the same report. */
  buildings?: Exterior[];
  title: string;
  jobNumber: string;
  customerName: string;
  letterhead: Letterhead;
  /** Where the photo route's side photos are filed: the claim's site photos. */
  claimId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const file = await exteriorReportFile({ exterior, buildings, title, jobNumber, customerName, letterhead, claimId });
      if (!file) {
        setError("There is nothing measured on the outside of the house yet.");
        return;
      }
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The report could not be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dlog-launch">
      <button type="button" className="btn-secondary" onClick={download} disabled={busy}>
        {busy ? "Making the exterior report…" : "Exterior report (PDF)"}
      </button>
      <span className="field-note">{error ?? "Elevations, footprint, roof plan, side photos and every measurement - as Scrivn Scan shares it."}</span>
    </div>
  );
}
