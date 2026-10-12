/**
 * Scrivn Scan's exterior capture into the claim's exterior (2026-10-12): Scan's own format,
 * `arcapture-exterior/1`, read as it is - see docs/exterior-import.md for the format and how each
 * key lands.
 *
 * Scan measures in metres from the grade under each tap, side by side round the house, and works
 * out its own areas. Scrivn keeps what was measured - lengths, heights, the peak, the band lines,
 * the openings, which corners are inside ones - and works the areas out again itself, so a side
 * typed by hand and a side tapped on the phone are priced by the same arithmetic. Scan's own net
 * area is checked against Scrivn's on the way in and any side that disagrees is named.
 *
 * It arrives either as the file Scan's Export writes (room_<stamp>_exterior.json), through the
 * editor's Import scan, or under an "exterior" key of the capture a phone sends - with the rooms,
 * or alone in a capture with none.
 */

import { newSketchId } from "./sketch";
import {
  CLADDING_KINDS,
  type CladdingBand,
  type CladdingKind,
  defaultRoof,
  type Exterior,
  type ExteriorOpening,
  type ExteriorOpeningKind,
  type ExteriorSide,
  sideQuantities,
} from "./exterior";

export const EXTERIOR_FORMAT = "arcapture-exterior/1";

const FEET_PER_METRE = 1 / 0.3048;
/** No house side is longer, and no tap higher; past these a number is a slip, not a house. */
const MAX_LENGTH_M = 200;
const MAX_HEIGHT_M = 60;
const MAX_SIDES = 40;
const MAX_OPENINGS = 100;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A scan body as an object: the phone may send it parsed or as its JSON text. */
function asObject(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The exterior a scan body carries: the body itself when it is Scan's exterior file, else its "exterior" key. */
export function scanExteriorPart(input: unknown): Json | null {
  const body = asObject(input);
  if (!isObject(body)) return null;
  if (body.format === EXTERIOR_FORMAT) return body;
  const inner = body.exterior;
  return isObject(inner) && inner.format === EXTERIOR_FORMAT ? inner : null;
}

/** Whether a scan body has rooms to draw: a capture's non-empty "rooms", or a one-room file's outline. */
export function scanHasRooms(input: unknown): boolean {
  const body = asObject(input);
  if (!isObject(body) || body.format === EXTERIOR_FORMAT) return false;
  if (Array.isArray(body.rooms)) return body.rooms.length > 0;
  return true;
}

/** A capture that is ONLY an exterior: Scan's file on its own, or a capture with the key and no rooms. */
export function isExteriorOnlyScan(body: unknown): boolean {
  return scanExteriorPart(body) !== null && !scanHasRooms(body);
}

function claddingOf(raw: unknown): { kind: CladdingKind; label?: string } {
  if (typeof raw === "string" && (CLADDING_KINDS as string[]).includes(raw) && raw !== "other") return { kind: raw as CladdingKind };
  return { kind: "other", label: typeof raw === "string" && raw.trim() ? raw.trim().replace(/_/g, " ") : undefined };
}

function openingKind(raw: unknown): ExteriorOpeningKind {
  return raw === "door" || raw === "garage" ? raw : "window";
}

/** A height in metres within reason, or null. */
function height(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= -5 && n <= MAX_HEIGHT_M ? n : null;
}

export type ExteriorImportResult = { ok: true; exterior: Exterior; notes: string[] } | { ok: false; error: string };

/** Scan's exterior, read into the claim's exterior model. */
export function parseScanExterior(input: unknown, meta: { scanId?: string | null; receivedAt?: string | null } = {}): ExteriorImportResult {
  const part = scanExteriorPart(input);
  if (!part) return { ok: false, error: "This file is not a Scrivn Scan exterior." };
  const rawSides = Array.isArray(part.sides) ? part.sides : [];
  if (rawSides.length === 0) return { ok: false, error: "The exterior has no sides in it." };
  if (rawSides.length > MAX_SIDES) return { ok: false, error: `The exterior has ${rawSides.length} sides, more than a house has.` };

  const walkLeft = part.walk === "left";
  const notes: string[] = [];

  // The corner at each side's RIGHT end (facing it from outside). Walking right, side `from` ends
  // there; walking left, the walk leaves side `from` by its left end, so the corner is `to`'s right.
  const inside = new Set<number>();
  if (Array.isArray(part.corners)) {
    for (const c of part.corners) {
      if (!isObject(c) || c.outside !== false) continue;
      const at = num(walkLeft ? c.to : c.from);
      if (at !== null) inside.add(at);
    }
  }

  const sides: ExteriorSide[] = [];
  const unmeasured: string[] = [];
  const disagree: string[] = [];
  for (let i = 0; i < rawSides.length; i++) {
    const raw = rawSides[i];
    if (!isObject(raw)) return { ok: false, error: `Side ${i + 1} is not a side.` };
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Side ${i + 1}`;
    const lengthM = num(raw.length_m);
    if (lengthM === null || lengthM <= 0 || lengthM > MAX_LENGTH_M) return { ok: false, error: `${name} has no usable length.` };
    const L = lengthM;

    const eaveL = height(raw.eave_left_m);
    const eaveR = height(raw.eave_right_m) ?? eaveL;
    const bottomL = height(raw.bottom_left_m) ?? 0;
    const bottomR = height(raw.bottom_right_m) ?? bottomL;
    // How far the grade falls left to right: the eave is level, and so is the top of the parging.
    const fall = eaveL !== null && eaveR !== null ? eaveR - eaveL : bottomR - bottomL;
    /** A level line tapped `above` metres over the grade at `along`, as Scrivn holds it: above the grade at the left corner. */
    const level = (above: number, along: number | null) => above - (along === null ? 0 : (fall * along) / L);

    // Bands bottom up; a parging line is the bottom of the cladding, not a cladding.
    const lines = (Array.isArray(raw.bands) ? raw.bands : [])
      .filter(isObject)
      .map((b) => ({ at: height(b.height_m), along: num(b.along_m), below: b.below }))
      .filter((b): b is { at: number; along: number | null; below: unknown } => b.at !== null)
      .map((b) => ({ top: level(b.at, b.along), below: b.below }))
      .sort((a, b) => a.top - b.top);
    let baseL = bottomL;
    let baseR = bottomR;
    const bands: CladdingBand[] = [];
    for (const line of lines) {
      if (line.below === "parging") {
        if (Math.max(baseL, baseR) < 0.01) {
          baseL = line.top;
          baseR = line.top + fall;
        }
        continue;
      }
      bands.push({ id: newSketchId("band"), ...claddingOf(line.below), top: line.top * FEET_PER_METRE });
    }
    bands.push({ id: newSketchId("band"), ...claddingOf(raw.cladding ?? "stucco"), top: null });

    const openings: ExteriorOpening[] = [];
    for (const o of (Array.isArray(raw.openings) ? raw.openings : []).slice(0, MAX_OPENINGS)) {
      if (!isObject(o)) continue;
      const from = num(o.from_m);
      const width = num(o.width_m);
      const sill = height(o.sill_m);
      const head = height(o.head_m);
      if (from === null || width === null || width <= 0 || sill === null || head === null || head <= sill) continue;
      openings.push({
        id: newSketchId("opening"),
        kind: openingKind(o.kind),
        widthFeet: width * FEET_PER_METRE,
        heightFeet: (head - sill) * FEET_PER_METRE,
        sillFeet: Math.max(0, sill) * FEET_PER_METRE,
        fromLeftFeet: Math.max(0, from) * FEET_PER_METRE,
      });
    }

    let gable: ExteriorSide["gable"] = null;
    if (isObject(raw.peak)) {
      const along = num(raw.peak.along_m);
      const peak = height(raw.peak.height_m);
      if (along !== null && peak !== null) {
        const from = num(raw.peak.from_m);
        const to = num(raw.peak.to_m);
        gable = {
          peakFeet: peak * FEET_PER_METRE,
          atFeet: along * FEET_PER_METRE,
          ...(from !== null ? { fromFeet: from * FEET_PER_METRE } : {}),
          ...(to !== null ? { toFeet: to * FEET_PER_METRE } : {}),
        };
      }
    }

    const base = Math.max(baseL, baseR) < 0.01 ? "grade" : "parging";
    const side: ExteriorSide = {
      id: newSketchId("side"),
      name,
      lengthFeet: L * FEET_PER_METRE,
      turn: inside.has(num(raw.index) ?? i) ? "inside" : "outside",
      base,
      baseLeftFeet: Math.max(0, baseL) * FEET_PER_METRE,
      baseRightFeet: Math.max(0, baseR) * FEET_PER_METRE,
      eaveLeftFeet: eaveL === null ? null : eaveL * FEET_PER_METRE,
      eaveRightFeet: eaveR === null ? null : eaveR * FEET_PER_METRE,
      gable,
      bands,
      openings,
    };
    sides.push(side);

    if (eaveL === null) unmeasured.push(name);
    // Scan's own area, against Scrivn's own arithmetic. The gable is the measured one or none: the roof is not built yet.
    const theirs = num(raw.net_sf);
    if (theirs !== null && eaveL !== null) {
      const ours = sideQuantities(side).netSquareFeet;
      if (Math.abs(ours - theirs) > Math.max(2, theirs * 0.02)) disagree.push(`${name} (Scan ${Math.round(theirs)} SF, Scrivn ${Math.round(ours)} SF)`);
    }
  }
  // Walked the other way round: the same ring the other way, the Front still first.
  if (walkLeft) sides.splice(1, sides.length - 1, ...sides.slice(1).reverse());

  const closed = part.closed === true;
  notes.push(`Exterior imported: ${sides.length} side${sides.length === 1 ? "" : "s"} measured on the phone${closed ? "" : ", but the walk did not go all the way round, so there is no footprint or roof until the rest are put in"}.`);
  const scale = num(part.scale);
  if (scale !== null && Math.abs(scale - 1) > 0.0005) notes.push(`Scaled to a tape by the phone (x${scale.toFixed(3)}).`);
  if (unmeasured.length > 0) notes.push(`No eave was tapped on ${unmeasured.join(", ")}: put it in to count that side.`);
  if (disagree.length > 0) notes.push(`Scan and Scrivn work out different areas for ${disagree.join("; ")}.`);
  notes.push("Type the pitch, or check the one the gables give, and the overhangs, on Roof & footprint.");

  const roof = defaultRoof();
  if (isObject(part.roof)) {
    const pitch = num(part.roof.pitch_in_12 ?? part.roof.pitch_12);
    const eaveOver = num(part.roof.eave_overhang_m);
    const rakeOver = num(part.roof.rake_overhang_m);
    if (pitch !== null && pitch >= 0 && pitch <= 24) roof.pitch = pitch;
    if (eaveOver !== null && eaveOver >= 0 && eaveOver < 3) roof.eaveOverhangFeet = eaveOver * FEET_PER_METRE;
    if (rakeOver !== null && rakeOver >= 0 && rakeOver < 3) roof.rakeOverhangFeet = rakeOver * FEET_PER_METRE;
  }

  const outer = asObject(input);
  const captureId = typeof part.capture_id === "string" ? part.capture_id : isObject(outer) && typeof outer.capture_id === "string" ? outer.capture_id : null;
  return {
    ok: true,
    exterior: { sides, roof, source: { kind: "scan", captureId, scanId: meta.scanId ?? null, receivedAt: meta.receivedAt ?? null, notes } },
    notes,
  };
}

/**
 * Whether a scan's exterior may replace the claim's without asking: when there is none, or the one
 * there came from a scan too and nobody has changed a measurement since. An exterior measured or
 * corrected by hand is the estimator's work and is kept.
 */
export function exteriorReplaceable(current: Exterior | undefined): boolean {
  return current === undefined || (current.source?.kind === "scan" && current.source.edited !== true);
}
