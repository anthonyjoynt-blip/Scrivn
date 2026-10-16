"use client";

import { allSides, type Exterior } from "@/lib/exterior";
import { exteriorReport } from "@/lib/exteriorReport";
import { exteriorReportPdf, type ReportPhotoImage } from "@/lib/exteriorReportPdf";
import type { Letterhead } from "@/lib/letterhead";
import { claimFileName } from "@/lib/pdf";
import { pdfImage } from "@/lib/photoImage";
import { claimPhotoUrl } from "./exteriorPhotoAccess";
import { markup } from "./exteriorImages";

/**
 * The claim's Exterior report (2026-10-15): lib/exteriorReport.ts on the claim's exterior, drawn by
 * lib/exteriorReportPdf.ts with the company's letterhead - the same report Scrivn Scan's Share makes on
 * the phone, from the same exterior, so the two agree (test:exterior:engine proves it on the owner's
 * walk). The side photos come from the scan they came with, each made small enough for the PDF to be
 * emailed (`pdfImage`, as the site report's photos); a photo that can't be had is named, not printed.
 */

export interface ExteriorReportFor {
  exterior: Exterior;
  title: string;
  jobNumber: string;
  customerName: string;
  letterhead: Letterhead;
  /** The claim the photo route's side photos are filed under (its site photos); none, those are named, not printed. */
  claimId?: string | null;
}

/**
 * Each side photo by its number, made small for a PDF: a scan's from the scan, the photo route's from the
 * claim's site photos (2026-10-16). Those that can't be fetched are left out.
 */
async function sidePhotos(exterior: Exterior, claimId: string | null): Promise<Record<number, ReportPhotoImage>> {
  const out: Record<number, ReportPhotoImage> = {};
  // The photo route's: this phone's own copy while it waits to upload, else the claim's.
  for (const side of allSides(exterior)) {
    for (const p of side.photos ?? []) {
      if (!p.claimPhotoId || out[p.n]) continue;
      try {
        const url = await claimPhotoUrl(claimId, p.claimPhotoId);
        if (!url) continue;
        const img = await fetch(url);
        if (img.ok) out[p.n] = await pdfImage(await img.blob());
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      } catch {
        // Named in the report, not printed.
      }
    }
  }
  const byScan = new Map<string, number[]>();
  for (const side of allSides(exterior)) for (const p of side.photos ?? []) if (p.scanId) byScan.set(p.scanId, [...(byScan.get(p.scanId) ?? []), p.n]);
  for (const [scanId, ns] of byScan) {
    try {
      const res = await fetch(`/api/scans/${scanId}/photos`);
      if (!res.ok) continue;
      const body = (await res.json()) as { photos?: { n: number; url: string }[] };
      for (const p of body.photos ?? []) {
        if (!ns.includes(p.n)) continue;
        try {
          const img = await fetch(p.url);
          if (img.ok) out[p.n] = await pdfImage(await img.blob());
        } catch {
          // Named in the report, not printed.
        }
      }
    } catch {
      // No signal: the report goes without the photos, and says which.
    }
  }
  return out;
}

/** The report as a file to download or send; null when the exterior has nothing measured. */
export async function exteriorReportFile(r: ExteriorReportFor): Promise<{ blob: Blob; filename: string } | null> {
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const report = exteriorReport(r.exterior, { title: r.title.trim() || "Exterior", date, madeWith: "Scrivn" });
  if (!report) return null;
  const photos = await sidePhotos(r.exterior, r.claimId ?? null);
  const doc = exteriorReportPdf({ report, svgOf: (el) => markup(el as Parameters<typeof markup>[0]), photos, letterhead: r.letterhead, footer: "Scrivn" });
  return { blob: doc.output("blob"), filename: claimFileName(r.jobNumber, r.customerName, "Exterior Report", "pdf") };
}

/** Whether the claim's exterior has anything to report: a side with a length. */
export function hasExteriorReport(exterior: Exterior | undefined): exterior is Exterior {
  return !!exterior && allSides(exterior).some((s) => s.lengthFeet > 0);
}
