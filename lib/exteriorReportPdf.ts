import { jsPDF } from "jspdf";
import { createElement, type ReactElement } from "react";
import {
  CHECK_INK,
  CLADDING_FILL,
  CladdingLegend,
  ElevationDrawing,
  elevationFontFeet,
  FootprintDrawing,
  HouseElevationDrawing,
  houseViewFontFeet,
  LINE_STYLE,
  type LegendItem,
  roofLegendItem,
  RoofPlanDrawing,
  roofTone,
} from "@/components/sketch/exteriorDrawings";
import { allSides, elevationFaces, type Exterior, houseColours, lengthToCheck, sharedOf, trimShapes } from "./exterior";
import { type ExteriorReport, LINE_WORD, type ReportTable, roofPlanCaption } from "./exteriorReport";
import { type Letterhead, letterheadInkColor } from "./letterhead";
import { drawLetterhead, drawPhotoPages, drawTables, LETTERHEAD_HEIGHT, PAGE_MARGIN, type PdfPhoto } from "./pdf";
import { paintSvg, parseSvg, pdfSafe, svgViewBox } from "./svgPdf";

/**
 * The exterior report on paper (2026-10-15): lib/exteriorReport.ts's report drawn with jsPDF, US
 * Letter, the same on the phone (Scrivn Scan's Share, in Scrivn's engine) and on scrivn.ca (the claim's
 * Exterior report).
 *
 *   1. the cover: what it is, where every number came from, what is assumed, the footprint;
 *   2. the roof plan, every line with its length, the slopes with their pitches and areas;
 *   3. the elevations, side by side, each with every dimension under it;
 *   4. the side photos, two to a page, with what was read off each;
 *   5. the tables: walls by side and material, openings, roof lines, squares, slopes, soffit, fascia
 *      and eavestrough, corners and trim, and what is still to answer.
 *
 * With other buildings on the claim (2026-10-16, lib/buildings.ts), the cover lists them all with their totals and
 * the totals of them all, and after the house's pages each building has the same five of its own, every page
 * headed with its name ("Shed · Roof plan"). Without any, the report is the house's exactly as it always was.
 *
 * DRAWN TO SCALE, as Scan's room plan is (PlanPdf.kt): each drawing at the largest standard
 * architectural scale that fits its page, the scale written under it with a 10 ft bar, true when
 * printed at 100%. The drawings are Scrivn's own (components/sketch/exteriorDrawings.tsx), painted as
 * lines (lib/svgPdf.ts), so the report shows what the estimator saw. The tables, the letterhead and the
 * photo pages are Scrivn's documents' own (lib/pdf.ts).
 */

export interface ReportPhotoImage {
  /** A JPEG data URL. */
  dataUrl: string;
  width: number;
  height: number;
}

export interface ReportPdfInput {
  /** The house's report; null on a claim with only other buildings measured (then `buildings` has one at least). */
  report: ExteriorReport | null;
  /** A drawing's SVG markup: react-dom/server's renderToStaticMarkup, or a rendered element's innerHTML. */
  svgOf: (element: ReactElement) => string;
  /** The side photos by Scan's number. A photo not here is named in the list, not printed. */
  photos?: Record<number, ReportPhotoImage>;
  /** The claim's other buildings (2026-10-16, lib/buildings.ts): each a section of its own after the house's. */
  buildings?: { name: string; report: ExteriorReport; photos?: Record<number, ReportPhotoImage> }[];
  /** The cover's table of every building, per building and for them all (lib/buildings.ts `siteReport`). */
  totals?: ReportTable | null;
  /** The company's letterhead on the cover; none, a plain title. */
  letterhead?: Letterhead | null;
  /** At the foot of every page, right: what made it ("Scrivn Scan 0.1.170"). */
  footer: string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - 2 * PAGE_MARGIN;
const BOTTOM = PAGE_H - PAGE_MARGIN;
const NAVY: [number, number, number] = [27, 58, 92];
const INK: [number, number, number] = [20, 20, 20];
const MUTED: [number, number, number] = [91, 100, 114];
/** One pixel of a drawing's line, on paper. */
const PIXEL = 0.5;

/** One building's pages: the house's (no name), or another building's, each page headed with its name. */
interface Part {
  report: ExteriorReport;
  photos: Record<number, ReportPhotoImage>;
  name: string | null;
}

/** A page's heading in [part]: the house's as it always was, another building's with its name in front. */
const titled = (part: Part, words: string) => (part.name ? `${part.name} · ${words}` : words);

/** The standard scales, largest first: points a foot, and how each is written. */
const SCALES: [number, string][] = [
  [36, '1/2" = 1\'-0"'],
  [27, '3/8" = 1\'-0"'],
  [18, '1/4" = 1\'-0"'],
  [13.5, '3/16" = 1\'-0"'],
  [9, '1/8" = 1\'-0"'],
  [6.75, '3/32" = 1\'-0"'],
  [4.5, '1/16" = 1\'-0"'],
  [2.25, '1/32" = 1\'-0"'],
];

/** A side's ± on its length where it is to check (`lengthToCheck`): what the plans mark. */
function plusMinusOf(exterior: Exterior) {
  return (id: string) => {
    const side = allSides(exterior).find((s) => s.id === id);
    return side ? lengthToCheck(side) : undefined;
  };
}

/** The largest standard scale at which [w] x [h] feet fit [boxW] x [boxH] points; the smallest if none does. */
export function standardScale(w: number, h: number, boxW: number, boxH: number): [number, string] {
  for (const s of SCALES) if (w * s[0] <= boxW && h * s[0] <= boxH) return s;
  return SCALES[SCALES.length - 1] as [number, string];
}

function setText(doc: jsPDF, size: number, style: "normal" | "bold" | "italic" = "normal", color: [number, number, number] = INK): void {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

/** [text] wrapped to [width], down from [y] at [lead] a line: where it ends. */
function para(doc: jsPDF, text: string, x: number, y: number, width: number, lead: number): number {
  for (const line of doc.splitTextToSize(pdfSafe(text), width) as string[]) {
    doc.text(line, x, y);
    y += lead;
  }
  return y;
}

/** A page's heading, and where its content starts. */
function heading(doc: jsPDF, words: string, sub?: string): number {
  setText(doc, 13, "bold", NAVY);
  doc.text(pdfSafe(words), PAGE_MARGIN, PAGE_MARGIN);
  let y = PAGE_MARGIN + 6;
  if (sub) {
    setText(doc, 8.5, "normal", MUTED);
    y = para(doc, sub, PAGE_MARGIN, y + 10, CONTENT_W, 10.5) - 4;
  }
  doc.setDrawColor(215, 223, 231);
  doc.setLineWidth(0.8);
  doc.line(PAGE_MARGIN, y + 4, PAGE_W - PAGE_MARGIN, y + 4);
  return y + 18;
}

/** A 10 ft bar at [ptPerFt] (20 ft when 10 would be too short to read), with the scale over it. */
function scaleBar(doc: jsPDF, x: number, y: number, ptPerFt: number, scaleText: string): void {
  const feet = ptPerFt * 10 < 45 ? 20 : 10;
  const step = feet / 5;
  doc.setFillColor(...NAVY);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.6);
  for (let k = 0; k < 5; k += 2) doc.rect(x + k * step * ptPerFt, y, step * ptPerFt, 3.5, "F");
  doc.rect(x, y, feet * ptPerFt, 3.5, "S");
  setText(doc, 7, "normal", MUTED);
  doc.text("0", x, y + 11, { align: "center" });
  doc.text(String(feet / 2), x + (feet / 2) * ptPerFt, y + 11, { align: "center" });
  doc.text(`${feet} ft`, x + feet * ptPerFt, y + 11, { align: "center" });
  doc.text(pdfSafe(`Scale ${scaleText} when printed at 100% (actual size, not fit to page)`), x + feet * ptPerFt + 22, y + 6);
}

/** A drawing's markup, read, and its frame in feet. */
function drawing(input: ReportPdfInput, element: ReactElement) {
  const svg = parseSvg(input.svgOf(element));
  return { svg, box: svgViewBox(svg) };
}

/** The footprint at the largest standard scale at which it fits [w] x [h] points as drawn - its names lettered about 8 points - with room for the scale under it; null when none does. */
function fitFootprint(input: ReportPdfInput, part: Part, w: number, h: number): { made: ReturnType<typeof drawing>; ptPerFt: number; text: string } | null {
  const { report } = part;
  const fp = report.q.footprint;
  const nameOf = (id: string) => allSides(report.exterior).find((s) => s.id === id)?.name.trim() || "Side";
  const approx = (id: string) => report.exterior.sides.find((s) => s.id === id)?.lengthFrom === "drawn";
  const upper = report.q.upperFootprint?.closes ? report.q.upperFootprint.corners : null;
  const plusMinus = plusMinusOf(report.exterior);
  // Each scale tried with the lettering it gives, so the names that widen the frame are in what is measured.
  for (const [ptPerFt, text] of SCALES) {
    const made = drawing(input, createElement(FootprintDrawing, { footprint: fp, nameOf, approx, plusMinus, shared: sharedOf(report.exterior), upper, fontFeet: 8 / ptPerFt }));
    if (made.box.width * ptPerFt <= w && made.box.height * ptPerFt <= h - 24) return { made, ptPerFt, text };
  }
  return null;
}

/** The footprint as fitted, centred across [w]; where it ends. */
function drawFootprint(doc: jsPDF, fit: NonNullable<ReturnType<typeof fitFootprint>>, x: number, y: number, w: number): number {
  const { made, ptPerFt, text } = fit;
  const dw = made.box.width * ptPerFt;
  const dh = made.box.height * ptPerFt;
  paintSvg(doc, made.svg, x + (w - dw) / 2, y, ptPerFt, { pixel: PIXEL });
  scaleBar(doc, x, y + dh + 10, ptPerFt, text);
  return y + dh + 28;
}

function cover(doc: jsPDF, input: ReportPdfInput, house: Part | null, meta: ExteriorReport["meta"]): void {
  const letterhead = input.letterhead ?? null;
  let y: number;
  if (letterhead) {
    drawLetterhead(doc, letterhead, PAGE_W);
    y = LETTERHEAD_HEIGHT + 40;
    doc.setTextColor(...letterheadInkColor(letterhead.primaryColor));
    doc.setFont("times", "bold");
    doc.setFontSize(15);
    doc.text("Exterior report", PAGE_MARGIN, y);
    doc.setDrawColor(...letterhead.accentColor);
    doc.setLineWidth(1.5);
    doc.line(PAGE_MARGIN, y + 10, PAGE_W - PAGE_MARGIN, y + 10);
    y += 32;
  } else {
    setText(doc, 11, "bold", MUTED);
    doc.text("EXTERIOR REPORT", PAGE_MARGIN, PAGE_MARGIN);
    y = PAGE_MARGIN + 26;
  }
  setText(doc, 18, "bold", NAVY);
  y = para(doc, meta.title, PAGE_MARGIN, y, CONTENT_W, 21);
  setText(doc, 9.5, "normal", MUTED);
  doc.text(pdfSafe(`${meta.date} · ${meta.madeWith}`), PAGE_MARGIN, y);
  y += 20;
  // The buildings on the claim, the house first, with the totals of them all (2026-10-16): only with another building.
  const totals = input.totals && (input.buildings ?? []).length > 0 ? input.totals : null;
  if (!house) {
    if (totals) drawTables(doc, [totals], y - 6, CONTENT_W, BOTTOM);
    return;
  }
  coverBody(doc, input, house, y, totals);
}

/**
 * A building's facts, where its numbers came from, what is assumed and what to check, and its footprint: under the
 * cover's title for the house, on a page of its own for another building. [totals], on the house's cover only, goes
 * between its facts and the lists.
 */
function coverBody(doc: jsPDF, input: ReportPdfInput, part: Part, start: number, totals: ReportTable | null = null): void {
  const { report } = part;
  let y = start;
  // The house in a few lines, label beside value.
  for (const f of report.facts) {
    setText(doc, 7.5, "bold", MUTED);
    doc.text(f.label.toUpperCase(), PAGE_MARGIN, y);
    setText(doc, 9.5, "normal", INK);
    y = para(doc, f.value, PAGE_MARGIN + 92, y, CONTENT_W - 92, 12) + 3;
  }
  y += 6;
  if (totals) y = drawTables(doc, [totals], y - 6, CONTENT_W, BOTTOM) + 10;
  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    setText(doc, 10, "bold", NAVY);
    doc.text(title, PAGE_MARGIN, y);
    y += 14;
    setText(doc, 8.8, "normal", INK);
    for (const item of items) {
      // A list longer than the page (2026-10-17: the owner's trim to check) runs on to the next, never off its foot.
      const lines = (doc.splitTextToSize(pdfSafe(item), CONTENT_W - 12) as string[]).length;
      if (y + lines * 11 > BOTTOM - 14) {
        doc.addPage();
        y = heading(doc, titled(part, title), "Continued.");
        setText(doc, 8.8, "normal", INK);
      }
      doc.text("-", PAGE_MARGIN + 2, y);
      y = para(doc, item, PAGE_MARGIN + 12, y, CONTENT_W - 12, 11) + 2;
    }
    y += 6;
  };
  list("Where the numbers come from", report.sources);
  list("Assumed", report.assumed.length > 0 ? report.assumed : ["Nothing: every number is measured, read off a photo, or typed."]);
  list("To check", report.notes);

  // The footprint under it all, when there is room for it; its own page when not.
  if (report.q.footprint.closes) {
    const room = BOTTOM - 20 - y;
    // A wall whose length is to check is marked on the plan, and said under it.
    const marked = allSides(report.exterior).some((s) => lengthToCheck(s) !== undefined) ? " A wall dashed, with a ±: worked out from the photos, to tape." : "";
    // Under the cover's words when it fits there at 1/16" or larger; else a page of its own.
    const here = room >= 180 ? fitFootprint(input, part, CONTENT_W, room - 10) : null;
    if (here && here.ptPerFt >= 4.5) {
      setText(doc, 10, "bold", NAVY);
      doc.text("Footprint", PAGE_MARGIN, y);
      drawFootprint(doc, here, PAGE_MARGIN, y + 10, CONTENT_W);
    } else {
      doc.addPage();
      y = heading(doc, titled(part, "Footprint"), `To scale, front at the bottom. Each wall's name and length outside it.${marked}`);
      const fit = fitFootprint(input, part, CONTENT_W, BOTTOM - 20 - y);
      if (fit) drawFootprint(doc, fit, PAGE_MARGIN, y, CONTENT_W);
    }
  }
}

function roofPage(doc: jsPDF, input: ReportPdfInput, part: Part): void {
  const { report } = part;
  const plan = report.q.roof;
  const roof = report.roof;
  if (!plan || !roof) return;
  doc.addPage();
  const top = heading(doc, titled(part, roofPlanCaption(plan)), roof.title);
  const nameOf = (id: string) => allSides(report.exterior).find((s) => s.id === id)?.name.trim() || "Side";
  const R = report.exterior.roof;
  const props = {
    plan,
    footprint: report.q.footprint,
    upper: report.q.upperFootprint?.closes ? report.q.upperFootprint.corners : null,
    nameOf,
    slopes: R.slopes ?? null,
    edges: R.edges ?? null,
    ridgeVents: R.ridgeVents ?? [],
    approx: (id: string) => report.exterior.sides.find((s) => s.id === id)?.lengthFrom === "drawn",
    plusMinus: plusMinusOf(report.exterior),
    shared: sharedOf(report.exterior),
  };
  // Room under it for the legend, the slopes and the notes.
  const below = 64 + roof.notes.length * 22;
  const boxH = Math.max(200, BOTTOM - top - below - 24);
  // The drawing letters itself at 3% of the roof (`RoofPlanDrawing`); at a fixed scale that is set to
  // about 9 points on paper instead, and the scale found again for the frame the lettering makes.
  const xs = [...plan.outlineRects.flatMap((r) => [r.x0, r.x1]), ...plan.lines.flatMap((l) => [l.a.x, l.b.x]), ...props.footprint.corners.map((p) => p.x)];
  const ys = [...plan.outlineRects.flatMap((r) => [r.y0, r.y1]), ...plan.lines.flatMap((l) => [l.a.y, l.b.y]), ...props.footprint.corners.map((p) => p.y)];
  const own = Math.max(0.6, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.03);
  let made = drawing(input, createElement(RoofPlanDrawing, props));
  let [ptPerFt, text] = standardScale(made.box.width, made.box.height, CONTENT_W, boxH);
  for (let pass = 0; pass < 2; pass++) {
    made = drawing(input, createElement(RoofPlanDrawing, { ...props, fontScale: 9 / ptPerFt / own }));
    const next = standardScale(made.box.width, made.box.height, CONTENT_W, boxH);
    if (next[0] === ptPerFt) break;
    [ptPerFt, text] = next;
  }
  const dw = made.box.width * ptPerFt;
  const dh = made.box.height * ptPerFt;
  paintSvg(doc, made.svg, PAGE_MARGIN + (CONTENT_W - dw) / 2, top, ptPerFt, { pixel: PIXEL });
  let y = top + dh + 12;
  scaleBar(doc, PAGE_MARGIN, y, ptPerFt, text);
  y += 26;
  // The legend: each kind of line, as drawn, with its total.
  let x = PAGE_MARGIN;
  for (const { kind, feet } of roof.legend) {
    const s = LINE_STYLE[kind];
    const words = `${LINE_WORD[kind]} ${(Math.round(feet * 10) / 10).toFixed(1)} LF`;
    setText(doc, 8, "normal", INK);
    const w = 26 + doc.getTextWidth(words) + 14;
    if (x > PAGE_MARGIN && x + w > PAGE_W - PAGE_MARGIN) {
      x = PAGE_MARGIN;
      y += 13;
    }
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.stroke.slice(i, i + 2), 16)) as [number, number, number];
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(s.width * PIXEL);
    doc.setLineDashPattern(s.dash ? s.dash.split(" ").map((v) => Number(v) * PIXEL) : [], 0);
    doc.line(x, y - 3, x + 20, y - 3);
    doc.setLineDashPattern([], 0);
    doc.text(pdfSafe(words), x + 26, y);
    x += w;
  }
  // A wall whose length is to check (2026-10-16): marked as on the plan.
  if (allSides(report.exterior).some((s) => lengthToCheck(s) !== undefined)) {
    const words = "Length to check (±): worked out from the photos, not taped";
    setText(doc, 8, "normal", INK);
    const w = 26 + doc.getTextWidth(pdfSafe(words)) + 14;
    if (x > PAGE_MARGIN && x + w > PAGE_W - PAGE_MARGIN) {
      x = PAGE_MARGIN;
      y += 13;
    }
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(CHECK_INK.slice(i, i + 2), 16)) as [number, number, number];
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(2.2 * PIXEL);
    doc.setLineDashPattern([6 * PIXEL, 3 * PIXEL], 0);
    doc.line(x, y - 3, x + 20, y - 3);
    doc.setLineDashPattern([], 0);
    doc.text(pdfSafe(words), x + 26, y);
  }
  y += 16;
  setText(doc, 8, "normal", INK);
  if (roof.slopes) y = para(doc, `Slopes: ${roof.slopes}`, PAGE_MARGIN, y, CONTENT_W, 10.5) + 4;
  setText(doc, 8, "italic", MUTED);
  for (const note of roof.notes) y = para(doc, note, PAGE_MARGIN, y, CONTENT_W, 10.5) + 2;
}

function elevationPages(doc: jsPDF, input: ReportPdfInput, part: Part): void {
  const { report } = part;
  const sides = report.sides.filter((s) => s.q.complete && !s.shared);
  const shared = report.sides.filter((s) => s.shared);
  if (sides.length === 0) return;
  const roofAssumed = report.q.pitch.source === "assumed";
  // Each material in one colour round the house, off its photos (2026-10-17): none read, as it always was.
  const colours = houseColours(report.exterior);
  const el = (s: (typeof sides)[number], fontFeet: number) => createElement(ElevationDrawing, { side: s.side, rise: s.rise, base: s.base, fontFeet, roofAssumed, ...(colours ? { colours } : {}) });
  /*
    Each side at the largest standard scale that fits the page's width and a third of its height, up
    to 3/16" = 1'-0" - one scale for a whole house would draw a 10 ft return at the scale its 66 ft side
    needs, and a bigger one would put a page to every short side. Its scale is written beside its name, and its lettering is about 7.5 points whatever the
    scale (the drawing's own 3% would be 20 points on a short side and 4 on a long one).
  */
  const boxH = 175;
  const MAX = 13.5;
  const most = SCALES.find((s) => s[0] === MAX) as [number, string];
  const scaled = sides.map((s) => {
    let made = drawing(input, el(s, elevationFontFeet(s.side, s.rise, s.base)));
    let [ptPerFt, text] = standardScale(made.box.width, made.box.height, CONTENT_W, boxH);
    if (ptPerFt > MAX) [ptPerFt, text] = most;
    for (let pass = 0; pass < 2; pass++) {
      made = drawing(input, el(s, 7.5 / ptPerFt));
      let next = standardScale(made.box.width, made.box.height, CONTENT_W, boxH);
      if (next[0] > MAX) next = most;
      if (next[0] === ptPerFt) break;
      [ptPerFt, text] = next;
    }
    return { s, made, ptPerFt, text };
  });

  doc.addPage();
  const views = report.views;
  let y = heading(
    doc,
    titled(part, "Elevations"),
    views.length > 0
      ? `The whole ${part.name ? "building" : "house"} square-on from each side, then each side on its own, to scale. The plan's front is taken as south: no compass bearing is measured.`
      : "Each side as seen from outside, left to right, to scale: heights from the ground under each end, every opening's size over it, the length under it.",
  );
  // The materials, as the faces show them (2026-10-16): a swatch of each with its name - in its colour off the photos,
  // and the trim apart from the field (2026-10-17) - then the roof as the house's elevations draw it.
  const items: LegendItem[] = [];
  const trimItems: LegendItem[] = [];
  for (const s of sides) {
    const { faces, fromShapes } = elevationFaces(s.side, s.rise, s.base);
    const found: LegendItem[] = faces
      .filter((f) => f.closed && f.poly.length >= 3)
      .map((f) => {
        const colour = colours?.faces[f.kind] ?? f.colour;
        return { kind: f.kind, label: f.label, ...(colour ? { colour } : {}) };
      });
    if (!fromShapes && s.side.base === "parging") found.push({ kind: "parging", label: "Parging" });
    for (const it of found) if (!items.some((x) => x.kind === it.kind && x.label === it.label)) items.push(it);
    for (const t of trimShapes(s.side)) {
      const label = `${t.label} trim`;
      const colour = colours?.trim[t.material] ?? t.colour;
      if (!trimItems.some((x) => x.label === label)) trimItems.push({ kind: t.material, label, ...(colour ? { colour } : {}) });
    }
  }
  items.push(...trimItems);
  if (views.length > 0 && report.q.roof) {
    const fills = views.flatMap((v) => v.view.pieces.flatMap((p) => (p.type === "wall" && !p.shared ? [p.backgroundColour ?? (p.background === "unclad" ? "#eef0f2" : CLADDING_FILL[p.background]), ...p.faces.map((f) => f.colour ?? (f.kind === "parging" ? "#dfe1e5" : CLADDING_FILL[f.kind]))] : [])));
    items.push(roofLegendItem(report.exterior.roof.material, roofTone(fills)));
  }
  if (items.length > 0) {
    const legend = drawing(input, createElement(CladdingLegend, { items }));
    const k = Math.min(7.5, CONTENT_W / legend.box.width);
    paintSvg(doc, legend.svg, PAGE_MARGIN, y - 6, k, { pixel: PIXEL });
    y += legend.box.height * k + 8;
  }

  /*
    The house from the south, east, north and west first (2026-10-16, the owner: "an overview of the full
    face on view would be nice as well"), all four at ONE standard scale - the largest at which each fits
    the page's width and about 300 points - so they compare as an architect's sheet does. Lettered at
    about 7.5 points, as the sides are.
  */
  if (views.length > 0) {
    const houseEl = (v: (typeof views)[number], fontFeet: number) => createElement(HouseElevationDrawing, { view: v.view, fontFeet, roof: report.exterior.roof.material ?? null });
    const fitOf = (fontFor: (v: (typeof views)[number]) => number) =>
      views.map((v) => {
        const made = drawing(input, houseEl(v, fontFor(v)));
        return standardScale(made.box.width, made.box.height, CONTENT_W, 300);
      });
    const least = (scales: [number, string][]) => scales.reduce((a, b) => (b[0] < a[0] ? b : a));
    let [ptPerFt, text] = least(fitOf((v) => houseViewFontFeet(v.view)));
    if (ptPerFt > MAX) [ptPerFt, text] = most;
    for (let pass = 0; pass < 2; pass++) {
      let next = least(fitOf(() => 7.5 / ptPerFt));
      if (next[0] > MAX) next = most;
      if (next[0] === ptPerFt) break;
      [ptPerFt, text] = next;
    }
    for (const v of views) {
      const made = drawing(input, houseEl(v, 7.5 / ptPerFt));
      const dh = made.box.height * ptPerFt;
      const dw = made.box.width * ptPerFt;
      setText(doc, 8, "normal", MUTED);
      const shows = doc.splitTextToSize(pdfSafe(v.shows), CONTENT_W) as string[];
      if (y + 16 + shows.length * 10 + dh + 18 > BOTTOM - 14) {
        doc.addPage();
        y = heading(doc, titled(part, "Elevations"), "Continued.");
      }
      setText(doc, 10.5, "bold", NAVY);
      doc.text(pdfSafe(v.heading), PAGE_MARGIN, y + 2);
      setText(doc, 7.5, "normal", MUTED);
      doc.text(pdfSafe(`Scale ${text} at 100%`), PAGE_W - PAGE_MARGIN, y + 2, { align: "right" });
      y += 14;
      setText(doc, 8, "normal", MUTED);
      for (const line of shows) {
        doc.text(line, PAGE_MARGIN, y);
        y += 10;
      }
      paintSvg(doc, made.svg, PAGE_MARGIN + (CONTENT_W - dw) / 2, y, ptPerFt, { pixel: PIXEL });
      y += dh + 8;
      doc.setDrawColor(225, 229, 234);
      doc.setLineWidth(0.5);
      doc.line(PAGE_MARGIN, y, PAGE_W - PAGE_MARGIN, y);
      y += 16;
    }
    // Then each side on its own: its heading kept with the first of them.
    const first = scaled[0];
    setText(doc, 8.2, "normal", INK);
    const firstNeed = first ? 16 + first.made.box.height * first.ptPerFt + 6 + first.s.dims.flatMap((d) => doc.splitTextToSize(pdfSafe(d), CONTENT_W) as string[]).length * 10 + 14 : 0;
    if (y + 40 + firstNeed > BOTTOM - 14) {
      doc.addPage();
      y = heading(doc, titled(part, "Elevations"), "Continued.");
    }
    setText(doc, 12, "bold", NAVY);
    doc.text("Each side", PAGE_MARGIN, y + 2);
    setText(doc, 8.5, "normal", MUTED);
    y = para(doc, "As seen from outside, left to right, to scale: heights from the ground under each end, every opening's size over it, the length under it.", PAGE_MARGIN, y + 16, CONTENT_W, 10.5) + 8;
  }
  for (const { s, made, ptPerFt, text } of scaled) {
    const dh = made.box.height * ptPerFt;
    const dw = made.box.width * ptPerFt;
    setText(doc, 8.2, "normal", INK);
    const lines = s.dims.flatMap((d) => doc.splitTextToSize(pdfSafe(d), CONTENT_W) as string[]);
    const need = 16 + dh + 6 + lines.length * 10 + 14;
    if (y + need > BOTTOM - 14) {
      doc.addPage();
      y = heading(doc, titled(part, "Elevations"), "Continued.");
    }
    setText(doc, 10.5, "bold", NAVY);
    doc.text(pdfSafe(s.heading), PAGE_MARGIN, y + 2);
    setText(doc, 7.5, "normal", MUTED);
    doc.text(pdfSafe(`Scale ${text} at 100%`), PAGE_W - PAGE_MARGIN, y + 2, { align: "right" });
    paintSvg(doc, made.svg, PAGE_MARGIN + (CONTENT_W - dw) / 2, y + 8, ptPerFt, { pixel: PIXEL });
    y += 8 + dh + 8;
    setText(doc, 8.2, "normal", INK);
    for (const line of lines) {
      doc.text(line, PAGE_MARGIN, y);
      y += 10;
    }
    doc.setDrawColor(225, 229, 234);
    doc.setLineWidth(0.5);
    doc.line(PAGE_MARGIN, y, PAGE_W - PAGE_MARGIN, y);
    y += 16;
  }
  // A wall shared with the neighbour's home (2026-10-17): no drawing, its line.
  for (const s of shared) {
    if (y + 40 > BOTTOM - 14) {
      doc.addPage();
      y = heading(doc, titled(part, "Elevations"), "Continued.");
    }
    setText(doc, 10.5, "bold", NAVY);
    doc.text(pdfSafe(s.heading), PAGE_MARGIN, y + 2);
    y += 16;
    setText(doc, 8.2, "normal", INK);
    for (const d of s.dims) {
      doc.text(pdfSafe(d), PAGE_MARGIN, y);
      y += 10;
    }
    y += 10;
  }
}

function photoPages(doc: jsPDF, part: Part): void {
  const images = part.photos;
  const printed: PdfPhoto[] = [];
  const missing: string[] = [];
  for (const p of part.report.photos) {
    const img = images[p.photo.n];
    if (img) printed.push({ dataUrl: img.dataUrl, width: img.width, height: img.height, label: pdfSafe(p.label), caption: pdfSafe(p.caption) });
    else missing.push(p.label);
  }
  if (printed.length > 0) drawPhotoPages(doc, printed, pdfSafe(titled(part, "Side photos")));
  if (missing.length > 0) {
    doc.addPage();
    const y = heading(doc, titled(part, "Side photos not printed"));
    setText(doc, 9, "normal", INK);
    para(doc, `These photos are on the phone or in the claim but could not be read for this report: ${missing.join("; ")}.`, PAGE_MARGIN, y, CONTENT_W, 12);
  }
}

function tablePages(doc: jsPDF, part: Part): void {
  doc.addPage();
  const y = heading(doc, titled(part, "Measurements"), "Worked out by Scrivn from the measurements above: the same figures the scope is written from.");
  drawTables(doc, part.report.tables, y - 6, CONTENT_W, BOTTOM);
}

/** Another building's section (2026-10-16): a page of its facts and footprint, then its roof, elevations, photos and tables. */
function buildingSection(doc: jsPDF, input: ReportPdfInput, part: Part): void {
  doc.addPage();
  const y = heading(doc, part.name ?? "Building", "Measured, drawn and roofed on its own, as the house is: every number in this section is this building's alone.");
  coverBody(doc, input, part, y + 4);
  roofPage(doc, input, part);
  elevationPages(doc, input, part);
  photoPages(doc, part);
  tablePages(doc, part);
}

/**
 * What every page says at its foot: which report, the page, and what made it - and on another building's pages its
 * name (2026-10-16), [owners] holding each page's: so a table run on to a page with no heading says whose it is.
 */
function footers(doc: jsPDF, input: ReportPdfInput, meta: ExteriorReport["meta"], owners: (string | null)[] = []): void {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    setText(doc, 7, "normal", MUTED);
    const owner = owners[i - 1] ?? null;
    doc.text(pdfSafe(`Exterior report · ${meta.title}${owner ? ` · ${owner}` : ""} · page ${i} of ${n}`), PAGE_MARGIN, PAGE_H - PAGE_MARGIN / 2);
    doc.text(pdfSafe(input.footer), PAGE_W - PAGE_MARGIN, PAGE_H - PAGE_MARGIN / 2, { align: "right" });
  }
}

/** The report as a jsPDF document, every page drawn. */
export function exteriorReportPdf(input: ReportPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const house: Part | null = input.report ? { report: input.report, photos: input.photos ?? {}, name: null } : null;
  const others: Part[] = (input.buildings ?? []).map((b) => ({ report: b.report, photos: b.photos ?? {}, name: b.name }));
  const meta = (house ?? others[0])?.report.meta;
  if (!meta) throw new Error("There is nothing measured to report yet.");
  cover(doc, input, house, meta);
  if (house) {
    roofPage(doc, input, house);
    elevationPages(doc, input, house);
    photoPages(doc, house);
    tablePages(doc, house);
  }
  // After the house, each other building: its own section, every page headed and footed with its name (2026-10-16).
  const owners: (string | null)[] = Array.from({ length: doc.getNumberOfPages() }, () => null);
  for (const part of others) {
    buildingSection(doc, input, part);
    while (owners.length < doc.getNumberOfPages()) owners.push(part.name);
  }
  footers(doc, input, meta, owners);
  return doc;
}

/** The same as bytes: what the phone saves and shares, and what a test reads back. */
export function exteriorReportBytes(input: ReportPdfInput): Uint8Array {
  return new Uint8Array(exteriorReportPdf(input).output("arraybuffer"));
}
