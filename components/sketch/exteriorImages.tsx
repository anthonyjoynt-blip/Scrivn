"use client";

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { allSides, elevationFaces, type Exterior, exteriorQuantities, formatPitch, lengthToCheck, pieceLine, ROOF_TOTAL_KEYS, ROOF_TOTAL_LABEL, type RoofTotalKey, sharedOf, sourceWords } from "@/lib/exterior";
import { sizesFrom } from "@/lib/exteriorScale";
import { formatQuantity } from "@/lib/sketchQuantities";
import { lineTotals, textWidthEm } from "@/lib/roofLabels";
import { CladdingLegend, ElevationDrawing, elevationFontFeet, LINE_STYLE, type LegendItem, RoofPlanDrawing } from "./exteriorDrawings";

/**
 * The exterior as pictures for the documents (2026-10-12): the roof plan with the slopes being
 * roofed shaded - the owner: "that image would be included in the scope doc" - and every side's
 * elevation on one sheet.
 *
 * Drawn by the editor's own drawings (`exteriorDrawings.tsx`), not a second routine: rendered into
 * a detached container, read back as SVG, and painted onto a canvas, so the page in the PDF is the
 * drawing the estimator worked from.
 */

export type ExteriorRender = "roof" | "elevations";

export interface ExteriorImage {
  render: ExteriorRender;
  dataUrl: string;
  width: number;
  height: number;
}

const WIDTH = 1400;
const PIXEL_RATIO = 2;
const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const INK = "#1a1d23";

/** Which exterior pictures there is something to draw for. */
export function exteriorRenders(exterior: Exterior | undefined): ExteriorRender[] {
  if (!exterior || exterior.sides.length === 0) return [];
  const q = exteriorQuantities(exterior);
  const out: ExteriorRender[] = [];
  if (q.roof && q.footprint.closes) out.push("roof");
  if (q.sides.some((s) => s.complete)) out.push("elevations");
  return out;
}

/** A React element as SVG markup, rendered off screen (the exterior report draws from it too, lib/exteriorReportPdf.ts). */
export function markup(element: ReturnType<typeof createElement>): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  flushSync(() => root.render(element));
  const html = container.innerHTML;
  root.unmount();
  return html;
}

/** An SVG's viewBox size, in the drawing's own units (feet). */
function viewBox(svg: string): { width: number; height: number } {
  const m = /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/.exec(svg);
  const w = m ? Number(m[3]) : 1;
  const h = m ? Number(m[4]) : 1;
  return { width: w > 0 ? w : 1, height: h > 0 ? h : 1 };
}

/** Width over height of an SVG's viewBox. */
function aspect(svg: string): number {
  const b = viewBox(svg);
  return b.width / b.height;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function label(x: number, y: number, text: string, size: number, weight = 400, anchor = "start"): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" font-family="${FONT}" fill="${INK}" text-anchor="${anchor}">${escapeXml(text)}</text>`;
}

/** Paints SVG onto a white canvas: PNG for a document page, JPEG for a file to keep. */
async function rasterize(svg: string, width: number, height: number, format: "png" | "jpeg"): Promise<string | null> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * PIXEL_RATIO);
  canvas.height = Math.round(height * PIXEL_RATIO);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return format === "png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.94);
}

function roofSvg(exterior: Exterior): { svg: string; width: number; height: number } | null {
  const q = exteriorQuantities(exterior);
  const plan = q.roof;
  const r = q.roofing;
  if (!plan || !r || !q.footprint.closes) return null;
  const nameOf = (id: string) => allSides(exterior).find((s) => s.id === id)?.name.trim() || "Side";
  const props = {
    plan,
    footprint: q.footprint,
    upper: q.upperFootprint?.closes ? q.upperFootprint.corners : null,
    nameOf,
    slopes: exterior.roof.slopes ?? null,
    edges: exterior.roof.edges ?? null,
    ridgeVents: exterior.roof.ridgeVents ?? [],
    // A side only drawn, never taped, is about that long on the page as on the screen.
    approx: (id: string) => exterior.sides.find((s) => s.id === id)?.lengthFrom === "drawn",
    // A length worked out from the photos, to check (2026-10-16): marked on the plan as in the report.
    plusMinus: (id: string) => {
      const side = allSides(exterior).find((s) => s.id === id);
      return side ? lengthToCheck(side) : undefined;
    },
    // A wall shared with the neighbour's home (2026-10-17), hatched as on the report.
    shared: sharedOf(exterior),
  };
  const planW = WIDTH - 80;
  const planH = Math.round(planW / aspect(markup(createElement(RoofPlanDrawing, props))));
  const drawing = markup(createElement(RoofPlanDrawing, { ...props, size: { width: planW, height: planH } }));
  const chosen = r.slopes.filter((s) => s.selected);
  const which = r.slopes.length === 0 ? "the whole roof" : r.allSlopes ? "all slopes" : `slope${chosen.length === 1 ? "" : "s"} ${chosen.map((s) => s.label).join(", ") || "none"}`;
  const top = 96;
  // Each kind of line with its total along the whole roof, as labelled on the plan; rows wrap.
  const keys: [string, string, number, string?, number?][] = [
    ...lineTotals(plan).map(({ kind: k, feet }) => [`${LINE_STYLE[k].label} ${formatQuantity(feet)} LF`, LINE_STYLE[k].stroke, LINE_STYLE[k].width, LINE_STYLE[k].dash] as [string, string, number, string?]),
    ...((exterior.roof.ridgeVents ?? []).length > 0 ? [["Ridge vent", "#15803d", 6, undefined, 0.55] as [string, string, number, string?, number?]] : []),
  ];
  let x = 40;
  let legendY = top + planH + 36;
  const legendParts: string[] = [];
  for (const [text, color, w, dash, opacity] of keys) {
    const itemW = 42 + textWidthEm(text) * 18 + 30;
    if (x > 40 && x + itemW > WIDTH - 40) {
      x = 40;
      legendY += 30;
    }
    legendParts.push(`<line x1="${x}" y1="${legendY - 6}" x2="${x + 34}" y2="${legendY - 6}" stroke="${color}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}${opacity ? ` stroke-opacity="${opacity}"` : ""}/>${label(x + 42, legendY, text, 18)}`);
    x += itemW;
  }
  const legend = legendParts.join("");
  const slopeList = r.slopes.map((s) => `${s.label} ${Math.round(s.areaSquareFeet)} SF${s.faces ? ` (${s.faces})` : ""}${s.selected ? "" : ", not roofed"}`).join(" · ");
  // Totals typed over the drawing's, or taken off a roof report (2026-10-15): said on the page, as on the scope's
  // lines, since the drawing's own are what is drawn. The report is named: which one, and its date.
  const total = (k: RoofTotalKey) =>
    k === "squareFeet" ? `${r.squares.toFixed(2)} SQ` : `${ROOF_TOTAL_LABEL[k].toLowerCase()} ${formatQuantity(k === "dripEdge" ? r.dripEdgeFeet : k === "starter" ? r.starterFeet : k === "iceWater" ? r.iceWaterFeet : r[`${k}Feet` as "ridgeFeet"])} LF`;
  const typed = ROOF_TOTAL_KEYS.filter((k) => r.from[k] === "estimator").map(total);
  const reported = ROOF_TOTAL_KEYS.filter((k) => r.from[k] === "report").map(total);
  const over = [
    reported.length > 0 ? `${sourceWords("report", r.report?.label).replace(/^f/, "F")}, over the drawing: ${reported.join(" · ")}.` : "",
    typed.length > 0 ? `From the estimator, over the drawing: ${typed.join(" · ")}.` : "",
  ].filter(Boolean);
  const typedNote = over.length > 0 ? `${over.join(" ")} The lengths drawn are the drawing's own.` : "";
  // The roof pieces put on top of the drawing (lib/roofPieces.ts): not drawn, so named, with what the area above counts of them.
  const ready = r.pieces.list.filter((x) => x.figures.missing.length === 0);
  const piecesNote =
    ready.length > 0
      ? `Added roof pieces, not drawn: ${ready.map((x) => pieceLine(x.piece, x.figures, r.pitch)).join("; ")}. Their lengths are in the scope's totals, not the lines drawn${over.length > 0 ? "; a total typed counts them already" : ""}.`
      : "";
  // Wrapped to the page: about 120 characters a line at 18 px.
  const typedLines: string[] = [];
  for (const note of [typedNote, piecesNote]) {
    const start = typedLines.length;
    for (const word of note.split(" ").filter(Boolean)) {
      const last = typedLines[typedLines.length - 1];
      if (typedLines.length > start && last !== undefined && last.length + word.length < 120) typedLines[typedLines.length - 1] = `${last} ${word}`;
      else typedLines.push(word);
    }
  }
  // What the sizes are from (2026-10-15, lib/exteriorScale.ts), for a house the phone measured: the last line.
  const from = sizesFrom(exterior);
  if (from) typedLines.push(`Sizes from ${from}.`);
  const typedTop = legendY + (slopeList ? 72 : 40);
  const height = typedLines.length > 0 ? typedTop + (typedLines.length - 1) * 26 + 24 : legendY + (slopeList ? 64 : 30);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`,
    `<rect width="${WIDTH}" height="${height}" fill="#ffffff"/>`,
    label(40, 44, "Roof plan", 30, 700),
    label(40, 78, `${r.byPitch.length > 1 || r.curved ? [...r.byPitch.map((b) => `${formatPitch(b.pitch)}${b.assumed ? " (assumed)" : b.fromPhotos ? " (from photos)" : ""}`), ...(r.curved ? ["curved"] : [])].join(" and ") : `${formatPitch(r.pitch)}${r.pitchAssumed ? " (assumed)" : r.pitchFromPhotos ? " (from photos)" : ""}`} · ${which} · ${formatQuantity(r.areaSquareFeet)} SF (${r.squares.toFixed(2)} SQ${r.from.squareFeet !== "drawing" ? `, ${sourceWords(r.from.squareFeet)}` : ""}) · to scale, front at the bottom`, 20),
    `<g transform="translate(40 ${top})">${drawing}</g>`,
    legend,
    slopeList ? label(40, legendY + 40, `Slopes: ${slopeList}`, 18) : "",
    ...typedLines.map((line, i) => label(40, typedTop + i * 26, line, 18)),
    `</svg>`,
  ].join("");
  return { svg, width: WIDTH, height };
}

function elevationsSvg(exterior: Exterior): { svg: string; width: number; height: number } | null {
  const q = exteriorQuantities(exterior);
  // Every side, the upper floor's after the main floor's, each standing on what it stands on.
  const sides = allSides(exterior)
    .map((side, i) => ({ side, sq: q.sides[i] }))
    .filter((s) => s.sq?.complete);
  if (sides.length === 0) return null;
  const columns = sides.length === 1 ? 1 : 2;
  const gap = 40;
  const cellW = Math.floor((WIDTH - 80 - gap * (columns - 1)) / columns);
  // One scale for the whole sheet, the longest side filling its cell, so the sides compare as they stand.
  const fontFeet = Math.max(...sides.map(({ side }) => elevationFontFeet(side, q.rises[side.id] ?? null, q.bases[side.id] ?? null)));
  // A gable the roof gives at a pitch nobody gave says so on the page, as on the screen.
  const roofAssumed = q.pitch.source === "assumed";
  const boxes = sides.map(({ side }) => viewBox(markup(createElement(ElevationDrawing, { side, rise: q.rises[side.id] ?? null, base: q.bases[side.id] ?? null, fontFeet, roofAssumed }))));
  const scale = Math.min(...boxes.map((b) => cellW / b.width));
  const cells = sides.map(({ side, sq }, i) => {
    const rise = q.rises[side.id] ?? null;
    const box = boxes[i] as { width: number; height: number };
    const w = Math.round(box.width * scale);
    const h = Math.round(box.height * scale);
    return { side, sq, h, drawing: markup(createElement(ElevationDrawing, { side, rise, base: q.bases[side.id] ?? null, fontFeet, roofAssumed, size: { width: w, height: h } })) };
  });
  // What the sizes are from (2026-10-15, lib/exteriorScale.ts), for a house the phone measured: under the title.
  const from = sizesFrom(exterior);
  let y = from ? 96 : 70;
  const parts: string[] = [label(40, 44, "Elevations", 30, 700), from ? label(40, 78, `Sizes from ${from}.`, 20) : ""];
  // The materials as the faces show them (2026-10-16): a swatch of each, as on the report.
  const items: LegendItem[] = [];
  for (const { side } of sides) {
    const { faces, fromShapes } = elevationFaces(side, q.rises[side.id] ?? null, q.bases[side.id] ?? null);
    const found: LegendItem[] = faces.filter((f) => f.closed && f.poly.length >= 3).map((f) => ({ kind: f.kind, label: f.label }));
    if (!fromShapes && side.base === "parging") found.push({ kind: "parging", label: "Parging" });
    for (const it of found) if (!items.some((o) => o.kind === it.kind && o.label === it.label)) items.push(it);
  }
  if (items.length > 0) {
    const legend = markup(createElement(CladdingLegend, { items }));
    const box = viewBox(legend);
    const k = Math.min(20, (WIDTH - 80) / box.width);
    parts.push(`<g transform="translate(40 ${y + 4})">${markup(createElement(CladdingLegend, { items, size: { width: box.width * k, height: box.height * k } }))}</g>`);
    y += box.height * k + 12;
  }
  for (let i = 0; i < cells.length; i += columns) {
    const row = cells.slice(i, i + columns);
    const rowH = Math.max(...row.map((c) => c.h));
    row.forEach((c, k) => {
      const x = 40 + k * (cellW + gap);
      const net = c.sq ? `${formatQuantity(c.sq.netSquareFeet)} SF of cladding net` : "";
      parts.push(label(x, y + 26, `${c.side.name.trim() || "Side"} · ${net}`, 20, 600));
      parts.push(`<g transform="translate(${x} ${y + 40})">${c.drawing}</g>`);
    });
    y += 40 + rowH + 30;
  }
  const height = y + 10;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`,
    `<rect width="${WIDTH}" height="${height}" fill="#ffffff"/>`,
    ...parts,
    `</svg>`,
  ].join("");
  return { svg, width: WIDTH, height };
}

/** One exterior picture, or null when there is nothing to draw. */
export async function renderExteriorImage(exterior: Exterior | undefined, render: ExteriorRender, format: "png" | "jpeg" = "png"): Promise<ExteriorImage | null> {
  if (!exterior) return null;
  const built = render === "roof" ? roofSvg(exterior) : elevationsSvg(exterior);
  if (!built) return null;
  const dataUrl = await rasterize(built.svg, built.width, built.height, format);
  return dataUrl ? { render, dataUrl, width: built.width, height: built.height } : null;
}
