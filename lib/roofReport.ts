import type { CallUsage } from "./anthropic";
import type { RoofReport, RoofTotalKey, TypedRoofTotals } from "./exterior";

/**
 * A roof report read off its PDF (2026-10-15): EagleView, Hover, Roofr, GAF QuickMeasure or a
 * roofer's own sheet, uploaded by the estimator on the exterior's Plan & roof pane. One Claude call
 * (`POST /api/exterior/roof-report`) reads its totals, its pitch and who made it; the panel
 * (components/sketch/RoofTotals.tsx) offers each beside its box, and only what the estimator takes
 * becomes a typed total, said to be from the roof report (`ExteriorRoof.typedFrom`).
 *
 * The PDF is not kept: it is in the request and the call, and nowhere after. Claim photos are the
 * only claim files Scrivn stores, in a bucket that takes JPEGs only, on a free plan already half full.
 *
 * The schema keeps to sentinels, as the extraction's does (lib/schema.ts): -1 for a number not in the
 * report and "" for a string, never a nullable type - the API caps union-typed fields at 16 a call.
 */

/**
 * Vercel refuses a request body over 4.5 MB, so a report goes up as the file itself (multipart, no
 * base64) and no bigger than this. A larger one is printed to PDF with only its pages of totals.
 */
export const ROOF_REPORT_MAX_BYTES = 4_400_000;

/** Highest believable figures: a mansion's roof, a long ridge. Anything past them is a misread. */
const MAX_SQUARE_FEET = 100_000;
const MAX_FEET = 20_000;
const MAX_PITCH = 24;

const NUMBER = { type: "number" };

/** The model's lengths, by the total each fills. */
export const REPORT_LENGTH_FIELDS: Record<Exclude<RoofTotalKey, "squareFeet">, string> = {
  ridge: "ridge_feet",
  hip: "hip_feet",
  valley: "valley_feet",
  eave: "eave_feet",
  rake: "rake_feet",
  step: "step_flashing_feet",
  headwall: "headwall_flashing_feet",
  dripEdge: "drip_edge_feet",
  starter: "starter_feet",
  iceWater: "ice_water_feet",
};

export const ROOF_REPORT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    is_roof_report: { type: "boolean" },
    vendor: { type: "string" },
    report_date: { type: "string" },
    address: { type: "string" },
    area_square_feet: NUMBER,
    ...Object.fromEntries(Object.values(REPORT_LENGTH_FIELDS).map((f) => [f, NUMBER])),
    predominant_pitch: NUMBER,
    pitches: {
      type: "array",
      items: {
        type: "object",
        properties: { pitch: NUMBER, square_feet: NUMBER, percent: NUMBER },
        required: ["pitch", "square_feet", "percent"],
        additionalProperties: false,
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["is_roof_report", "vendor", "report_date", "address", "area_square_feet", ...Object.values(REPORT_LENGTH_FIELDS), "predominant_pitch", "pitches", "notes"],
  additionalProperties: false,
};

/** What the model answers, exactly as the schema has it. */
export type RoofReportWire = {
  is_roof_report: boolean;
  vendor: string;
  report_date: string;
  address: string;
  area_square_feet: number;
  predominant_pitch: number;
  pitches: { pitch: number; square_feet: number; percent: number }[];
  notes: string[];
} & Record<string, unknown>;

export const ROOF_REPORT_SYSTEM_PROMPT = `You read roof measurement reports for a restoration estimating app: EagleView, Hover, Roofr, GAF QuickMeasure, RoofSnap, or a roofer's own measurement sheet. Each number you give is offered to an estimator beside the roof's own drawing, and each one they take goes on an insurance estimate, so a wrong number is worse than none.

Give the totals for the whole roof as the report states them. Never estimate a number the report does not give, and never add up a diagram's labels when the report states the total: give -1 for any number not in the report, and "" for any text not in it.

area_square_feet: the roof's measured area on the slope, in square feet, with NO waste. Reports also list the area with waste added (10%, 15%, a suggested waste) and in squares; take the measured, 0% figure. Given only in squares, multiply by 100. If the only area given includes waste, give it and say so in notes.

Lengths are in decimal feet: convert feet and inches (120' 6" is 120.5).
- ridge_feet, hip_feet, valley_feet: ridges, hips, valleys.
- eave_feet: eaves (some reports say eaves/starter). rake_feet: rakes, the sloped gable edges.
- step_flashing_feet: step flashing, where a slope meets a wall running up the slope.
- headwall_flashing_feet: flashing where the top of a slope meets a wall running level along it, called flashing, apron, headwall or wall flashing. EagleView's "Flashing" is this.
- drip_edge_feet, starter_feet, ice_water_feet: only when the report gives each as its own length in feet (drip edge is often "eaves + rakes"). Ice & water given in square feet or rolls: -1, and say what it gave in notes.
- Parapet walls, transitions and anything else: leave out; mention a large one in notes.

predominant_pitch: the predominant pitch as rise in 12 (6/12 is 6, flat is 0). pitches: each pitch in the report's table of areas by pitch, with its area in square feet and its share of the roof in percent as printed, -1 for one not printed; empty if the report has no such table.

If the report covers more than one structure (a house and a detached garage), give its combined totals when it states them, and say in notes which structures they include. With no combined totals, give the main structure's and say in notes what else the report measured.

vendor: the company that made the report ("EagleView", "Hover", "Roofr", "GAF QuickMeasure", or the roofer's company); "" if none is named. report_date: the date the report was made, YYYY-MM-DD; "" if none. address: the property's address as printed; "" if none.

notes: at most five short, plain sentences the estimator should know before taking these numbers: waste included, structures, a page that could not be read, totals that do not agree with each other. Empty if there is nothing.

is_roof_report: false if the document is not a roof measurement report at all. Then give -1 and "" everywhere and say in one note what the document is.`;

export function roofReportUserMessage(): string {
  return "Read this roof report's totals.";
}

/** A number the model gave: the sentinel -1, or anything out of range, is not in the report. */
function amount(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

function text(v: unknown, max: number): string | null {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t ? t.slice(0, max) : null;
}

/** "2026-09-30" as given, if it is a real date; anything else is no date. */
function isoDate(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}

/**
 * The model's answer as the report the panel offers: each total it gave, in range, and nothing it
 * didn't. With no predominant pitch stated, the table's pitch with the most area stands for it. A
 * document that is not a roof report, or one with nothing to take, comes back with `problem` set.
 */
export function roofReportFromWire(wire: RoofReportWire, fileName: string, readAt: string): { report: RoofReport | null; problem: string | null } {
  const notes = (Array.isArray(wire.notes) ? wire.notes : [])
    .map((n) => text(n, 240))
    .filter((n): n is string => n !== null)
    .slice(0, 5);
  if (!wire.is_roof_report) return { report: null, problem: notes[0] ?? "This PDF doesn't look like a roof report." };

  const totals: TypedRoofTotals = {};
  const area = amount(wire.area_square_feet, MAX_SQUARE_FEET);
  if (area !== null && area > 0) totals.squareFeet = area;
  for (const [key, field] of Object.entries(REPORT_LENGTH_FIELDS) as [Exclude<RoofTotalKey, "squareFeet">, string][]) {
    const v = amount(wire[field], MAX_FEET);
    if (v !== null) totals[key] = v;
  }

  // Each pitch once (a table repeated on two pages), most area first.
  const pitches: RoofReport["pitches"] = [];
  for (const p of Array.isArray(wire.pitches) ? wire.pitches : []) {
    const at = amount(p?.pitch, MAX_PITCH);
    if (at === null || pitches.some((q) => q.pitch === at)) continue;
    pitches.push({ pitch: at, squareFeet: amount(p?.square_feet, MAX_SQUARE_FEET), percent: amount(p?.percent, 100) });
  }
  pitches.sort((a, b) => (b.squareFeet ?? b.percent ?? 0) - (a.squareFeet ?? a.percent ?? 0));
  // Not stated: the table's pitch with the most area - or its only one; a table with no areas tells none.
  const stated = amount(wire.predominant_pitch, MAX_PITCH);
  const most = pitches[0];
  const pitch = stated ?? (most && (most.squareFeet !== null || most.percent !== null || pitches.length === 1) ? most.pitch : null);

  const report: RoofReport = {
    vendor: text(wire.vendor, 60),
    date: isoDate(wire.report_date),
    address: text(wire.address, 160),
    fileName: fileName.slice(0, 120),
    readAt,
    totals,
    pitch,
    pitches,
    notes,
  };
  const nothing = Object.keys(totals).length === 0 && pitch === null;
  return { report, problem: nothing ? "No roof totals or pitch were found in this report." : null };
}

/** What the route answers. */
export interface RoofReportResponse {
  report: RoofReport | null;
  problem: string | null;
  model: string;
  seconds: number;
  pages: number | null;
  usage: CallUsage;
  costUsd: number;
}

/**
 * The page count a PDF declares, for the cost log: the largest /Count of a page tree it can see. Null
 * when the tree is inside a compressed object stream, as in many newer PDFs.
 */
export function pdfPageCount(bytes: Uint8Array): number | null {
  const pdf = new TextDecoder("latin1").decode(bytes);
  let most = 0;
  for (const dict of pdf.matchAll(/<<[^<>]*\/Type\s*\/Pages\b[^<>]*>>/g)) {
    const count = /\/Count\s+(\d+)/.exec(dict[0]);
    if (count) most = Math.max(most, Number(count[1]));
  }
  return most > 0 ? most : null;
}
