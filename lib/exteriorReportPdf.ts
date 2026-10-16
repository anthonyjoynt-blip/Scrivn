import { jsPDF } from "jspdf";
import { createElement, type ReactElement } from "react";
import { CHECK_INK, CladdingLegend, ElevationDrawing, elevationFontFeet, FootprintDrawing, LINE_STYLE, type LegendItem, RoofPlanDrawing } from "@/components/sketch/exteriorDrawings";
import { allSides, elevationFaces, type Exterior, lengthToCheck } from "./exterior";
import { type ExteriorReport, LINE_WORD, roofPlanCaption } from "./exteriorReport";
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
  report: ExteriorReport;
  /** A drawing's SVG markup: react-dom/server's renderToStaticMarkup, or a rendered element's innerHTML. */
  svgOf: (element: ReactElement) => string;
  /** The side photos by Scan's number. A photo not here is named in the list, not printed. */
  photos?: Record<number, ReportPhotoImage>;
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

/** The footprint, to a standard scale inside the box; where it ends. */
function drawFootprint(doc: jsPDF, input: ReportPdfInput, x: number, y: number, w: number, h: number): number {
  const { report } = input;
  const fp = report.q.footprint;
  const nameOf = (id: string) => allSides(report.exterior).find((s) => s.id === id)?.name.trim() || "Side";
  const approx = (id: string) => report.exterior.sides.find((s) => s.id === id)?.lengthFrom === "drawn";
  const upper = report.q.upperFootprint?.closes ? report.q.upperFootprint.corners : null;
  const plusMinus = plusMinusOf(report.exterior);
  // Lettering about 8 points on paper: a first frame at 3% lettering finds the scale, the second is drawn.
  const first = drawing(input, createElement(FootprintDrawing, { footprint: fp, nameOf, approx, plusMinus, upper }));
  let [ptPerFt, text] = standardScale(first.box.width, first.box.height, w, h - 24);
  let made = drawing(input, createElement(FootprintDrawing, { footprint: fp, nameOf, approx, plusMinus, upper, fontFeet: 8 / ptPerFt }));
  [ptPerFt, text] = standardScale(made.box.width, made.box.height, w, h - 24);
  made = drawing(input, createElement(FootprintDrawing, { footprint: fp, nameOf, approx, plusMinus, upper, fontFeet: 8 / ptPerFt }));
  const dw = made.box.width * ptPerFt;
  const dh = made.box.height * ptPerFt;
  paintSvg(doc, made.svg, x + (w - dw) / 2, y, ptPerFt, { pixel: PIXEL });
  scaleBar(doc, x, y + dh + 10, ptPerFt, text);
  return y + dh + 28;
}

function cover(doc: jsPDF, input: ReportPdfInput): void {
  const { report } = input;
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
  y = para(doc, report.meta.title, PAGE_MARGIN, y, CONTENT_W, 21);
  setText(doc, 9.5, "normal", MUTED);
  doc.text(pdfSafe(`${report.meta.date} · ${report.meta.madeWith}`), PAGE_MARGIN, y);
  y += 20;

  // The house in a few lines, label beside value.
  for (const f of report.facts) {
    setText(doc, 7.5, "bold", MUTED);
    doc.text(f.label.toUpperCase(), PAGE_MARGIN, y);
    setText(doc, 9.5, "normal", INK);
    y = para(doc, f.value, PAGE_MARGIN + 92, y, CONTENT_W - 92, 12) + 3;
  }
  y += 6;
  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    setText(doc, 10, "bold", NAVY);
    doc.text(title, PAGE_MARGIN, y);
    y += 14;
    setText(doc, 8.8, "normal", INK);
    for (const item of items) {
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
    if (room < 180) {
      doc.addPage();
      y = heading(doc, "Footprint", `To scale, front at the bottom. Each wall's name and length outside it.${marked}`);
      drawFootprint(doc, input, PAGE_MARGIN, y, CONTENT_W, BOTTOM - 20 - y);
    } else {
      setText(doc, 10, "bold", NAVY);
      doc.text("Footprint", PAGE_MARGIN, y);
      drawFootprint(doc, input, PAGE_MARGIN, y + 10, CONTENT_W, room - 10);
    }
  }
}

function roofPage(doc: jsPDF, input: ReportPdfInput): void {
  const { report } = input;
  const plan = report.q.roof;
  const roof = report.roof;
  if (!plan || !roof) return;
  doc.addPage();
  const top = heading(doc, roofPlanCaption(plan), roof.title);
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

function elevationPages(doc: jsPDF, input: ReportPdfInput): void {
  const { report } = input;
  const sides = report.sides.filter((s) => s.q.complete);
  if (sides.length === 0) return;
  const roofAssumed = report.q.pitch.source === "assumed";
  const el = (s: (typeof sides)[number], fontFeet: number) => createElement(ElevationDrawing, { side: s.side, rise: s.rise, base: s.base, fontFeet, roofAssumed });
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
  let y = heading(doc, "Elevations", "Each side as seen from outside, left to right, to scale: heights from the ground under each end, every opening's size over it, the length under it.");
  // The materials, as the faces show them (2026-10-16): a swatch of each with its name.
  const items: LegendItem[] = [];
  for (const s of sides) {
    const { faces, fromShapes } = elevationFaces(s.side, s.rise, s.base);
    const found: LegendItem[] = faces.filter((f) => f.closed && f.poly.length >= 3).map((f) => ({ kind: f.kind, label: f.label }));
    if (!fromShapes && s.side.base === "parging") found.push({ kind: "parging", label: "Parging" });
    for (const it of found) if (!items.some((x) => x.kind === it.kind && x.label === it.label)) items.push(it);
  }
  if (items.length > 0) {
    const legend = drawing(input, createElement(CladdingLegend, { items }));
    const k = Math.min(7.5, CONTENT_W / legend.box.width);
    paintSvg(doc, legend.svg, PAGE_MARGIN, y - 6, k, { pixel: PIXEL });
    y += legend.box.height * k + 8;
  }
  for (const { s, made, ptPerFt, text } of scaled) {
    const dh = made.box.height * ptPerFt;
    const dw = made.box.width * ptPerFt;
    setText(doc, 8.2, "normal", INK);
    const lines = s.dims.flatMap((d) => doc.splitTextToSize(pdfSafe(d), CONTENT_W) as string[]);
    const need = 16 + dh + 6 + lines.length * 10 + 14;
    if (y + need > BOTTOM - 14) {
      doc.addPage();
      y = heading(doc, "Elevations", "Continued.");
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
}

function photoPages(doc: jsPDF, input: ReportPdfInput): void {
  const images = input.photos ?? {};
  const printed: PdfPhoto[] = [];
  const missing: string[] = [];
  for (const p of input.report.photos) {
    const img = images[p.photo.n];
    if (img) printed.push({ dataUrl: img.dataUrl, width: img.width, height: img.height, label: pdfSafe(p.label), caption: pdfSafe(p.caption) });
    else missing.push(p.label);
  }
  if (printed.length > 0) drawPhotoPages(doc, printed, "Side photos");
  if (missing.length > 0) {
    doc.addPage();
    const y = heading(doc, "Side photos not printed");
    setText(doc, 9, "normal", INK);
    para(doc, `These photos are on the phone or in the claim but could not be read for this report: ${missing.join("; ")}.`, PAGE_MARGIN, y, CONTENT_W, 12);
  }
}

function tablePages(doc: jsPDF, input: ReportPdfInput): void {
  doc.addPage();
  const y = heading(doc, "Measurements", "Worked out by Scrivn from the measurements above: the same figures the scope is written from.");
  drawTables(doc, input.report.tables, y - 6, CONTENT_W, BOTTOM);
}

/** What every page says at its foot: which report, the page, and what made it. */
function footers(doc: jsPDF, input: ReportPdfInput): void {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    setText(doc, 7, "normal", MUTED);
    doc.text(pdfSafe(`Exterior report · ${input.report.meta.title} · page ${i} of ${n}`), PAGE_MARGIN, PAGE_H - PAGE_MARGIN / 2);
    doc.text(pdfSafe(input.footer), PAGE_W - PAGE_MARGIN, PAGE_H - PAGE_MARGIN / 2, { align: "right" });
  }
}

/** The report as a jsPDF document, every page drawn. */
export function exteriorReportPdf(input: ReportPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  cover(doc, input);
  roofPage(doc, input);
  elevationPages(doc, input);
  photoPages(doc, input);
  tablePages(doc, input);
  footers(doc, input);
  return doc;
}

/** The same as bytes: what the phone saves and shares, and what a test reads back. */
export function exteriorReportBytes(input: ReportPdfInput): Uint8Array {
  return new Uint8Array(exteriorReportPdf(input).output("arraybuffer"));
}
