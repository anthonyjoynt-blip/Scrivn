import { jsPDF } from "jspdf";
import { PAGE_MARGIN, type PdfTable, drawTables } from "./pdf";
import { PIXELS_PER_FOOT, type Sketch, freeWallsOf, freeWallsOnLevel, roomBounds, roomsOnLevel } from "./sketch";
import { DEFAULT_QUANTITY_OPTIONS } from "./sketchQuantities";
import { EDITOR_VERSION, architecturalScale, deductionNote, jpegPxPerFt, quantityRows, storeys } from "./scanEditor";

/**
 * Scrivn Scan's plan, shared from its own sketch editor (2026-10-28): a PDF and a JPG per storey, from the sketch as edited.
 *
 * It does what Scan's PlanPdf.kt does for a live scan, because the owner underlays it in Xactimate:
 *   - each storey on a Letter page at a TRUE architectural scale ([architecturalScale]: 1/2", 1/4", 1/8"... a foot), with a
 *     10 ft bar and "Scale ... when printed at 100%";
 *   - a JPG per storey at whole pixels a foot ([jpegPxPerFt]), with its bar.
 * After the plans come the rooms, with the Quantities panel's numbers (PF, PC, F, W, C) and the details an estimate prices.
 *
 * The pictures come from [PlanHost], so the jsPDF layout runs in Node with a fake (test/scanEditor/run.mjs). On the phone
 * the host mounts the real SketchCanvas (components/sketch/planStage.tsx), and the plan on the page is the plan in the
 * editor, by construction.
 */

/** Letter, in points. */
export const PAGE_W = 612;
export const PAGE_H = 792;
const MARGIN = 40;
/** Room round the plan for the lengths drawn outside its walls, in points (PlanPdf.kt's PDF_PAD). */
export const PLAN_PAD_PT = 22;
/** Picture pixels per PDF point: sharp when printed. */
export const PICTURE_RATIO = 3;
/** Where the plan may go: under the title, over the bar and the footer. */
const PLAN_TOP = MARGIN + 50;
const PLAN_BOTTOM = PAGE_H - MARGIN - 34 - 44;
export const PLAN_W = PAGE_W - 2 * MARGIN;
export const PLAN_H = PLAN_BOTTOM - PLAN_TOP;

export interface PlanPicture {
  /** A PNG or JPEG data URL. */
  dataUrl: string;
  /** Its size in picture pixels. */
  width: number;
  height: number;
}

export interface PlanHost {
  /**
   * Storey [level]'s plan, one foot to [unitsPerFoot] units, with [padUnits] round it, drawn at [ratio] picture pixels a
   * unit: a PNG, transparent outside the rooms.
   */
  plan(level: number, unitsPerFoot: number, padUnits: number, ratio: number): Promise<PlanPicture | null>;
  /** Storey [level] as the JPG: [pxPerFoot] whole pixels a foot, white, with [heading] over it and a 10 ft bar under it. */
  jpeg(level: number, pxPerFoot: number, heading: string): Promise<PlanPicture | null>;
}

export interface PlanMeta {
  title: string;
  subtitle: string;
  /** Write a JPG per storey too. */
  jpg: boolean;
  /** What the footer says made it; the editor's version when absent (Scan's own page). */
  madeBy?: string;
}

export interface PlanFiles {
  files: { name: string; mime: "application/pdf" | "image/jpeg"; base64: string }[];
}

/** A storey's rooms and walls, in feet: its width and height, for the scale. Null with nothing on it. */
export function storeyExtentFt(sketch: Sketch, level: number): { widthFt: number; heightFt: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of roomsOnLevel(sketch, level)) {
    const b = roomBounds(room);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  for (const wall of freeWallsOf({ ...sketch, freeWalls: freeWallsOnLevel(sketch, level) })) {
    for (const v of wall.vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { widthFt: (maxX - minX) / PIXELS_PER_FOOT, heightFt: (maxY - minY) / PIXELS_PER_FOOT };
}

/** The plan's files: the PDF, then a JPG per storey (top down) when [meta.jpg]. */
export async function buildPlanFiles(sketch: Sketch, meta: PlanMeta, host: PlanHost): Promise<PlanFiles> {
  const options = sketch.quantities ?? DEFAULT_QUANTITY_OPTIONS;
  const levels = storeys(sketch).filter((s) => storeyExtentFt(sketch, s.level) !== null);
  if (levels.length === 0) throw new Error("There is no room on the plan to share yet.");
  const many = levels.length > 1;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let page = 0;
  const footer = () => {
    page += 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(91, 100, 114);
    const madeBy = meta.madeBy ?? `editor ${EDITOR_VERSION.replace(/^scrivn /, "")}`;
    doc.text(`Inside wall-to-wall, in feet and inches. ${meta.subtitle} · ${madeBy}`, MARGIN, PAGE_H - MARGIN + 14);
    doc.text(`Page ${page}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 14, { align: "right" });
  };

  for (const [k, storey] of levels.entries()) {
    if (k > 0) doc.addPage();
    const extent = storeyExtentFt(sketch, storey.level);
    if (!extent) continue;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(27, 58, 92);
    doc.text(many ? `${meta.title} - ${storey.name}` : meta.title, MARGIN, MARGIN + 16);
    const scale = architecturalScale(extent.widthFt, extent.heightFt, PLAN_W, PLAN_H, PLAN_PAD_PT);
    const { rows } = quantityRows(sketch, storey.level, options);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(91, 100, 114);
    doc.text(`${rows.length} room${rows.length === 1 ? "" : "s"} · ${meta.subtitle}`, MARGIN, MARGIN + 32);
    doc.setDrawColor(215, 223, 231);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, MARGIN + 42, PAGE_W - MARGIN, MARGIN + 42);

    const picture = await host.plan(storey.level, scale.ptPerFt, PLAN_PAD_PT, PICTURE_RATIO);
    if (picture) {
      // At exactly its size in points: the picture is the plan at [scale], so the page is too.
      const w = picture.width / PICTURE_RATIO;
      const h = picture.height / PICTURE_RATIO;
      const x = MARGIN + Math.max(0, (PLAN_W - w) / 2);
      const y = PLAN_TOP + Math.max(0, (PLAN_H - h) / 2);
      doc.addImage(picture.dataUrl, picture.dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG", x, y, w, h, undefined, "FAST");
    }
    drawBar(doc, MARGIN, PLAN_BOTTOM + 22, scale.ptPerFt, `Scale ${scale.label} when printed at 100% (no "fit to page")`);
    footer();
  }

  // The rooms, storey by storey, with the totals and what is deducted.
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(27, 58, 92);
  doc.text(`${meta.title} - rooms`, MARGIN, MARGIN + 16);
  const tables: PdfTable[] = [];
  for (const storey of levels) {
    const { rows, total } = quantityRows(sketch, storey.level, options);
    if (rows.length === 0) continue;
    tables.push({
      caption: many ? storey.name : undefined,
      columns: [
        { title: "Room", weight: 3 },
        { title: "Size", weight: 2.4 },
        { title: "Ceiling", weight: 1.3 },
        { title: "PF", weight: 1.1, align: "center" },
        { title: "PC", weight: 1.1, align: "center" },
        { title: "F", weight: 1.1, align: "center" },
        { title: "W", weight: 1.1, align: "center" },
        { title: "C", weight: 1.1, align: "center" },
      ],
      rows: [...rows, total].map((r) => [r.name, r.size, r.ceiling, r.pf, r.pc, r.f, r.w, r.c]),
    });
    const details = rows.filter((r) => r.details.length > 0);
    if (details.length > 0) {
      tables.push({
        caption: many ? `${storey.name} - details` : "Details",
        columns: [
          { title: "Room", weight: 1 },
          { title: "", weight: 3 },
        ],
        rows: details.map((r) => [r.name, r.details.join("\n")]),
      });
    }
  }
  const end = drawTables(doc, tables, MARGIN + 30, PAGE_W - 2 * PAGE_MARGIN, PAGE_H - MARGIN - 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(91, 100, 114);
  doc.text(deductionNote(options), MARGIN, Math.min(end + 12, PAGE_H - MARGIN - 20), { maxWidth: PAGE_W - 2 * MARGIN });
  footer();

  const files: PlanFiles["files"] = [{ name: "plan.pdf", mime: "application/pdf", base64: base64Of(doc.output("arraybuffer")) }];
  if (meta.jpg) {
    for (const storey of levels) {
      const extent = storeyExtentFt(sketch, storey.level);
      if (!extent) continue;
      const ppf = jpegPxPerFt(extent.widthFt, extent.heightFt);
      const jpg = await host.jpeg(storey.level, ppf, many ? `${meta.title} - ${storey.name}` : meta.title);
      if (!jpg) continue;
      files.push({ name: `level-${storey.level}.jpg`, mime: "image/jpeg", base64: jpg.dataUrl.replace(/^data:image\/jpeg;base64,/, "") });
    }
  }
  return { files };
}

/** A bar 10 ft long at [ptPerFt], solid and open every 2 ft, "0", "5" and "10 ft" under it, [note] over it. */
function drawBar(doc: jsPDF, x: number, y: number, ptPerFt: number, note: string): void {
  const h = 5;
  doc.setDrawColor(27, 58, 92);
  doc.setFillColor(27, 58, 92);
  doc.setLineWidth(0.8);
  for (let k = 0; k < 5; k++) if (k % 2 === 0) doc.rect(x + k * 2 * ptPerFt, y, 2 * ptPerFt, h, "F");
  doc.rect(x, y, 10 * ptPerFt, h, "S");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(26, 36, 48);
  doc.text("0", x, y + h + 9, { align: "center" });
  doc.text("5", x + 5 * ptPerFt, y + h + 9, { align: "center" });
  doc.text("10 ft", x + 10 * ptPerFt, y + h + 9, { align: "center" });
  doc.text(note, x, y - 4);
}

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64");
}
