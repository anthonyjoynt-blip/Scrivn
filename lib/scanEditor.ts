import { adoptScan, isPhoneOwned } from "./scanInbox";
import { splitScanLevels } from "./scanImport";
import { MAIN_LEVEL, PIXELS_PER_FOOT, type Sketch, type SketchRoom, emptySketch, levelName, roomBounds, roomLevel } from "./sketch";
import { type MoistureMap, emptyMoistureMap, withScanMoisture } from "./moisture";
import { DEFAULT_QUANTITY_OPTIONS, type QuantityOptions, formatQuantity, roomDetailLines, roomQuantities } from "./sketchQuantities";

/**
 * Scrivn's sketch editor inside Scrivn Scan (2026-10-28): what the phone's copy of the editor does that scrivn.ca's does
 * not, kept out of the page shell (lib/scanEditorWebView.tsx) so it runs in Node too (test/scanEditor/run.mjs).
 *
 * The phone app went out on its own: a scan is finished in this editor, offline, with no Scrivn account, or a sketch is
 * drawn from nothing. The contract with the app is ARCapturePrototype's scan-editor/BRIDGE.md, `scan-editor/1`.
 *
 *   - [importCapture]: a scan made into a sketch exactly as a Send of it would land in a new claim (lib/scanInbox.ts
 *     adoptScan), each of its levels on its own storey.
 *   - [sketchSummary]: what the phone's list of saved sketches shows, and whether it has been edited.
 *   - [quantityRows]: the plan PDF's room table, the Quantities panel's numbers.
 *   - [architecturalScale] / [jpegPxPerFt]: the scales Scan's own PlanPdf.kt picks, so a plan underlaid in Xactimate is
 *     to the same scale whichever app made it.
 */

/** Which editor this is: "scrivn <sha>", set by scripts/build-scan-editor.mjs. */
declare const __SCRIVN_EDITOR__: string | undefined;
export const EDITOR_VERSION: string = typeof __SCRIVN_EDITOR__ === "string" ? __SCRIVN_EDITOR__ : "scrivn dev";

/** A sketch from the phone: an object with a list of rooms, or why it is not one. Never throws. */
export function readSketch(raw: unknown): { ok: true; sketch: Sketch } | { ok: false; error: string } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "The saved sketch is not readable." };
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "The saved sketch is not a sketch." };
  const rooms = (value as { rooms?: unknown }).rooms;
  if (!Array.isArray(rooms)) return { ok: false, error: "The saved sketch has no rooms list." };
  if (rooms.some((r) => r === null || typeof r !== "object" || !Array.isArray((r as { vertices?: unknown }).vertices))) {
    return { ok: false, error: "A room in the saved sketch has no corners." };
  }
  return { ok: true, sketch: value as Sketch };
}

export interface ImportedCapture {
  sketch: Sketch;
  moisture: MoistureMap;
  /** What the importer had to say, for the editor's notice. */
  notes: string[];
  roomCount: number;
}

/**
 * The phone's scan made into a sketch: each level of the walk onto a storey of its own (the phone's level 0, where the walk
 * began, on the main storey; above and below it from there), each through `adoptScan`, the conversion a Send gets. The
 * outside of the house is left out: exteriors are not in Scan's standalone release.
 *
 * `adoptScan` writes the scan's provenance afresh each time, so with several levels the closets and the untapped spaces it
 * offers are gathered from every level into the last one's. The fingerprint is the whole sketch's, so the result reads as
 * the phone's own (`isPhoneOwned`) until somebody edits it.
 */
export function importCapture(
  text: string,
  at: { captureId: string | null; capturedAt?: string | null; now: string },
): { ok: true; imported: ImportedCapture } | { ok: false; error: string } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "The scan on the phone could not be read." };
  }
  const parts = splitScanLevels(text) ?? [{ level: 0, name: null, text, roomCount: 0 }];
  let sketch: Sketch = emptySketch();
  let moisture: MoistureMap = emptyMoistureMap();
  const notes: string[] = [];
  const closetDoors: NonNullable<NonNullable<Sketch["scan"]>["closetDoors"]> = [];
  const spaces: NonNullable<NonNullable<Sketch["scan"]>["spaces"]> = [];
  let roomCount = 0;
  for (const part of parts) {
    const partBody = parts.length === 1 ? body : JSON.parse(part.text);
    const storey = MAIN_LEVEL + part.level;
    const adopted = adoptScan(sketch, {
      id: `${at.captureId ?? "scan"}-L${part.level}`,
      claimId: "",
      captureId: at.captureId,
      capturedAt: at.capturedAt ?? null,
      receivedAt: at.now,
      level: storey,
      body: withoutExterior(partBody),
      deviceName: null,
    });
    if ("ok" in adopted) {
      // A level that will not convert is said, and the others still come in.
      if (parts.length === 1) return adopted;
      notes.push(`${part.name ?? `Level ${part.level}`} did not come in: ${adopted.error}`);
      continue;
    }
    sketch = adopted.sketch;
    roomCount += adopted.roomCount;
    notes.push(...adopted.notes);
    if (adopted.moisture) moisture = withScanMoisture(moisture, adopted.moisture);
    closetDoors.push(...(adopted.sketch.scan?.closetDoors ?? []));
    spaces.push(...(adopted.sketch.scan?.spaces ?? []));
  }
  if (roomCount === 0) return { ok: false, error: notes[0] ?? "The scan has no closed room to draw." };
  if (sketch.scan) {
    const scan = { ...sketch.scan };
    if (closetDoors.length > 0) scan.closetDoors = closetDoors;
    else delete scan.closetDoors;
    if (spaces.length > 0) scan.spaces = spaces;
    else delete scan.spaces;
    sketch = { ...sketch, scan };
  }
  delete sketch.exterior;
  return { ok: true, imported: { sketch, moisture, notes, roomCount } };
}

/** The capture without its exterior part (`exterior` on the file): the rooms only. */
function withoutExterior(body: unknown): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
  const copy = { ...(body as Record<string, unknown>) };
  delete copy.exterior;
  return copy;
}

export interface SketchSummary {
  rooms: number;
  levels: number;
  floorSqFt: number;
  /** False while the sketch is exactly what the import made (`isPhoneOwned`); a sketch drawn by hand is edited once it has a room. */
  edited: boolean;
}

/** What the phone's list shows of a sketch: rooms (flights of stairs aside), storeys, floor area. */
export function sketchSummary(sketch: Sketch, options: QuantityOptions = sketch.quantities ?? DEFAULT_QUANTITY_OPTIONS): SketchSummary {
  const rooms = sketch.rooms.filter((r) => !r.stairs);
  const levels = new Set(sketch.rooms.map(roomLevel)).size;
  // Sub-rooms are inside their parent's floor already: counted once, at the top.
  const floor = rooms.filter((r) => !r.parentRoomId).reduce((sum, r) => sum + roomQuantities(r, sketch, options).floorArea, 0);
  return {
    rooms: rooms.length,
    levels,
    floorSqFt: Math.round(floor * 10) / 10,
    edited: sketch.scan !== undefined ? !isPhoneOwned(sketch) : sketch.rooms.length > 0,
  };
}

export interface QuantityRow {
  name: string;
  /** "12' 6\" x 10' 2\"", the room's outside size on the plan. */
  size: string;
  ceiling: string;
  pf: string;
  pc: string;
  f: string;
  w: string;
  c: string;
  details: string[];
}

/** The plan's room table for storey [level]: the Quantities panel's five numbers per room, stairs left out. */
export function quantityRows(sketch: Sketch, level: number, options: QuantityOptions = sketch.quantities ?? DEFAULT_QUANTITY_OPTIONS): { rows: QuantityRow[]; total: QuantityRow } {
  const rooms = sketch.rooms.filter((r) => roomLevel(r) === level && !r.stairs);
  const sums = { pf: 0, pc: 0, f: 0, w: 0, c: 0 };
  const rows = rooms.map((room) => {
    const q = roomQuantities(room, sketch, options);
    const top = !room.parentRoomId;
    if (top) {
      sums.pf += q.perimeterFloor;
      sums.pc += q.perimeterCeiling;
      sums.f += q.floorArea;
      sums.c += q.ceilingArea;
    }
    sums.w += q.wallArea;
    return {
      name: room.name.trim() || "Unnamed room",
      size: roomSize(room),
      ceiling: q.ceilingHeightFeet == null ? "–" : feetInches(q.ceilingHeightFeet),
      pf: formatQuantity(q.perimeterFloor),
      pc: formatQuantity(q.perimeterCeiling),
      f: formatQuantity(q.floorArea),
      w: q.ceilingHeightFeet == null ? "–" : formatQuantity(q.wallArea),
      c: formatQuantity(q.ceilingArea),
      details: roomDetailLines(q.details),
    };
  });
  const total: QuantityRow = {
    name: "Total",
    size: "",
    ceiling: "",
    pf: formatQuantity(sums.pf),
    pc: formatQuantity(sums.pc),
    f: formatQuantity(sums.f),
    w: formatQuantity(sums.w),
    c: formatQuantity(sums.c),
    details: [],
  };
  return { rows, total };
}

/** The deductions in force, said in words, for the note under the table. */
export function deductionNote(options: QuantityOptions = DEFAULT_QUANTITY_OPTIONS): string {
  const parts: string[] = [];
  parts.push(options.deductOpeningsFromWallArea ? "W less doors and windows" : "W with doors and windows left in");
  if (options.deductFromWallArea) parts.push("W less cabinets and showers");
  if (options.deductFromFloorArea) parts.push("F less cabinets and showers");
  if (options.deductCabinetsFromFloorPerimeter) parts.push("PF less cabinet runs");
  return `PF/PC perimeter at floor/ceiling (LF), F floor, W walls, C ceiling (SF). ${parts.join("; ")}.`;
}

function roomSize(room: SketchRoom): string {
  const b = roomBounds(room);
  return `${feetInches(b.width / PIXELS_PER_FOOT)} x ${feetInches(b.height / PIXELS_PER_FOOT)}`;
}

/** 12.5 -> 12' 6": the plan's own way of writing a length, to the inch. */
export function feetInches(feet: number): string {
  const inches = Math.round(feet * 12);
  const f = Math.floor(inches / 12);
  const i = inches - f * 12;
  return i === 0 ? `${f}'` : `${f}' ${i}"`;
}

/** The storeys with rooms, top down as a house is drawn, each with its name. */
export function storeys(sketch: Sketch): { level: number; name: string }[] {
  return [...new Set(sketch.rooms.map(roomLevel))].sort((a, b) => b - a).map((level) => ({ level, name: levelName(sketch, level) }));
}

/** The standard scales, largest first: paper points a foot, and how the scale is written (PlanPdf.kt's SCALES). */
export const SCALES: [number, string][] = [
  [36, '1/2" = 1\'-0"'],
  [18, '1/4" = 1\'-0"'],
  [9, '1/8" = 1\'-0"'],
  [4.5, '1/16" = 1\'-0"'],
  [2.25, '1/32" = 1\'-0"'],
];
const SMALLEST_SCALE = '1/32" = 1\'-0"';

/**
 * The scale the plan is drawn at on the PDF (PlanPdf.pdfScale): the largest of [SCALES] at which a plan [widthFt] by
 * [heightFt] fits [w] x [h] points with [pad] round it, else the smallest.
 */
export function architecturalScale(widthFt: number, heightFt: number, w: number, h: number, pad: number): { ptPerFt: number; label: string } {
  for (const [ptPerFt, label] of SCALES) {
    if (widthFt * ptPerFt + 2 * pad <= w && heightFt * ptPerFt + 2 * pad <= h) return { ptPerFt, label };
  }
  return { ptPerFt: 2.25, label: SMALLEST_SCALE };
}

/** The JPG's whole pixels a foot (PlanPdf.jpegPxPerFt): the largest that keeps the image within [JPEG_MAX_PX] a side. */
export const JPEG_PX_PER_FT = [48, 36, 24, 18, 12, 8, 6];
export const JPEG_MAX_PX = 3200;
export const JPEG_PAD = 90;
export const JPEG_HEAD = 150;
export const JPEG_FOOT = 130;

export function jpegPxPerFt(widthFt: number, heightFt: number): number {
  for (const ppf of JPEG_PX_PER_FT) {
    if (widthFt * ppf + 2 * JPEG_PAD <= JPEG_MAX_PX && heightFt * ppf + 2 * JPEG_PAD + JPEG_HEAD + JPEG_FOOT <= JPEG_MAX_PX) return ppf;
  }
  return 6;
}
