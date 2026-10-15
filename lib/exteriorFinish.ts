/**
 * Finish exterior (2026-10-15): the roof read off the side photos ON THE PHONE, and what the estimator
 * changed there, carried in Scan's exterior file as its `finish` block, so the claim's roof is the one
 * the phone showed.
 *
 * The owner, looking at Scan's exterior: "so what about the roof from photos? and really that should be
 * able to complete the exteriors as well and generate a pdf with all elevations, roof sketch, photos,
 * all measurements listed". Scan runs Scrivn's own exterior code (lib/scanEngine.ts, bundled into the
 * app), so the photo read on the phone is the editor's: each side's photos squared up
 * (lib/exteriorPhoto.ts), one trace call (`/api/device/exterior/trace`, the same call as the editor's),
 * the answer's lines set on the photo's edges (`snapTrace`), and the reads that hold together ticked
 * as the editor ticks them first (`roofPicksAtFirst`, `shapePicksAtFirst`).
 *
 * Only the roof is taken: the side's shapes, openings and wall top stay the phone's own taps. The
 * estimator who wants the trace's cladding and openings too opens the side in Scrivn.
 *
 *   "finish": {
 *     "format": "scrivn-finish/1", "engine": "<Scrivn build>", "at": "<when Finish last ran>",
 *     "acceptedAt": "<when the estimator accepted the roof>" | null,
 *     "pitch": <the main roof's pitch typed on the phone, rise in 12> | null,
 *     "ends": { "<Scan side index>": "gable" | "hip" },          switched on the phone
 *     "sides": { "<Scan side index>": FinishSide }                the roof read off each side's photos
 *   }
 *
 * Keyed by Scan's side index, the only name a side has on both: Scrivn gives each side an id of its
 * own when it reads the file (lib/exteriorImport.ts). Reads made at another tape's scale are scaled
 * to the file's as they are put on (`scaledRoofRead`; a pitch is a ratio and stays).
 */

import { allSides, type Exterior, type ExteriorRoof, type ExteriorSide, formatPitch, type SidePhoto, type SideRoofRead } from "./exterior";
import type { SquareFrame } from "./exteriorPhoto";
import { applyTrace, type TracePicks, type TraceProposals, type TraceRequest, roofPicksAtFirst, shapePicksAtFirst } from "./exteriorTrace";
import type { RoofEndKind } from "./roof";
import { PHOTO_PIECE_LABEL, scaledRoofRead, UPPER_SHOWN_WORDS } from "./roofPhotoShapes";
import { formatFeetInches } from "./sketch";

export const FINISH_FORMAT = "scrivn-finish/1";

const FEET_PER_METRE = 1 / 0.3048;

/** One side's roof read, as Finish made it on the phone. */
export interface FinishSide {
  /** When it was read. */
  at: string;
  /** The photos it was read off, by Scan's numbers: a side photographed again is read again. */
  photos: number[];
  /** The house's scale when it was read (the file's `scale`): read before a tape, it is in the phone's own sizes. */
  scaleAt: number;
  /** The read as Scrivn keeps it on a side: what holds together ticked, what doesn't set aside (null). */
  roofRead: SideRoofRead;
  /** What it read, in words, for the phone's Review and the report. */
  said: string[];
  /** The call: which model, and what it cost. */
  model?: string;
  costUsd?: number;
}

export interface ScanFinish {
  format: typeof FINISH_FORMAT;
  /** The Scrivn build the phone's engine was, for when the two are compared. */
  engine?: string;
  at?: string;
  acceptedAt?: string | null;
  pitch?: number | null;
  ends?: Record<string, RoofEndKind>;
  sides?: Record<string, FinishSide>;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A read's fields that are lengths or ratios, each a finite number or null. */
function readOf(raw: unknown): SideRoofRead | null {
  if (!isObject(raw)) return null;
  const read: SideRoofRead = { at: str(raw.at) ?? new Date(0).toISOString() };
  const numberOrNull = (k: "pitch" | "rakeOverhangFeet" | "eaveOverhangFeet" | "upperPitch" | "breakFeet" | "floorLineFeet", lo: number, hi: number) => {
    if (!(k in raw)) return;
    const v = raw[k];
    if (v === null) read[k] = null;
    else if (num(v) !== null && (v as number) >= lo && (v as number) <= hi) read[k] = v as number;
  };
  numberOrNull("pitch", 0, 24);
  numberOrNull("rakeOverhangFeet", 0, 8);
  numberOrNull("eaveOverhangFeet", 0, 8);
  numberOrNull("upperPitch", 0, 24);
  numberOrNull("breakFeet", 0, 60);
  numberOrNull("floorLineFeet", 0, 60);
  if (Array.isArray(raw.slopes) && raw.slopes.length === 2 && raw.slopes.every((v) => num(v) !== null)) read.slopes = [raw.slopes[0] as number, raw.slopes[1] as number];
  if ("over" in raw) read.over = raw.over === "gable" || raw.over === "hip" || raw.over === "eave" ? raw.over : null;
  if ("upper" in raw) read.upper = raw.upper === "flush" || raw.upper === "setBack" || raw.upper === "none" ? raw.upper : null;
  if ("lowerRoof" in raw) read.lowerRoof = raw.lowerRoof === "leanto" || raw.lowerRoof === "tent" ? raw.lowerRoof : null;
  // The pieces are Scrivn's own objects, made by the same code on the phone: kept as they came, when they are a list.
  if (Array.isArray(raw.pieces)) read.pieces = raw.pieces.filter(isObject) as unknown as SideRoofRead["pieces"];
  return read;
}

/** The `finish` block as Scan wrote it, or null when there is none or it is not one. */
export function readScanFinish(raw: unknown): ScanFinish | null {
  if (!isObject(raw) || raw.format !== FINISH_FORMAT) return null;
  const out: ScanFinish = { format: FINISH_FORMAT };
  const engine = str(raw.engine);
  if (engine) out.engine = engine.slice(0, 80);
  const at = str(raw.at);
  if (at) out.at = at;
  if ("acceptedAt" in raw) out.acceptedAt = str(raw.acceptedAt);
  const pitch = num(raw.pitch);
  if (pitch !== null && pitch >= 0 && pitch <= 24) out.pitch = pitch;
  if (isObject(raw.ends)) {
    const ends: Record<string, RoofEndKind> = {};
    for (const [k, v] of Object.entries(raw.ends)) if (/^\d+$/.test(k) && (v === "gable" || v === "hip")) ends[k] = v;
    if (Object.keys(ends).length > 0) out.ends = ends;
  }
  if (isObject(raw.sides)) {
    const sides: Record<string, FinishSide> = {};
    for (const [k, v] of Object.entries(raw.sides)) {
      if (!/^\d+$/.test(k) || !isObject(v)) continue;
      const roofRead = readOf(v.roofRead);
      if (!roofRead) continue;
      const scaleAt = num(v.scaleAt);
      sides[k] = {
        at: str(v.at) ?? roofRead.at,
        photos: Array.isArray(v.photos) ? v.photos.filter((n): n is number => num(n) !== null) : [],
        scaleAt: scaleAt !== null && scaleAt > 0.5 && scaleAt < 2 ? scaleAt : 1,
        roofRead,
        said: Array.isArray(v.said) ? v.said.filter((s): s is string => typeof s === "string").slice(0, 12) : [],
        ...(str(v.model) ? { model: str(v.model) as string } : {}),
        ...(num(v.costUsd) !== null ? { costUsd: num(v.costUsd) as number } : {}),
      };
    }
    if (Object.keys(sides).length > 0) out.sides = sides;
  }
  return out;
}

/**
 * The phone's Finish put onto the sides and roof Scrivn read from the same file: each side's roof read
 * (scaled from the scale it was read at to [scaleNow]), the pitch typed and the ends switched on the
 * phone, which stand over the photos as anything typed does. [idByIndex] is each side's id by Scan's
 * index for it. What it did comes back in words for the import's notes.
 */
export function applyScanFinish(
  sides: ExteriorSide[],
  roof: ExteriorRoof,
  finish: ScanFinish,
  idByIndex: Map<number, string>,
  scaleNow: number,
): { sides: ExteriorSide[]; roof: ExteriorRoof; notes: string[] } {
  const notes: string[] = [];
  const reads = new Map<string, SideRoofRead>();
  for (const [k, fs] of Object.entries(finish.sides ?? {})) {
    const id = idByIndex.get(Number(k));
    if (!id) continue;
    const k2 = fs.scaleAt > 0 ? scaleNow / fs.scaleAt : 1;
    reads.set(id, Math.abs(k2 - 1) > 1e-6 ? scaledRoofRead(scaleOverhangs(fs.roofRead, k2), k2) : fs.roofRead);
  }
  const nextSides = sides.map((s) => (reads.has(s.id) ? { ...s, roofRead: reads.get(s.id) as SideRoofRead } : s));
  const nextRoof: ExteriorRoof = { ...roof };
  if (finish.pitch != null) nextRoof.pitch = finish.pitch;
  if (finish.ends) {
    const ends: Record<string, RoofEndKind> = { ...roof.ends };
    for (const [k, kind] of Object.entries(finish.ends)) {
      const id = idByIndex.get(Number(k));
      if (id) ends[id] = kind;
    }
    nextRoof.ends = ends;
  }
  const named = (ids: string[]) => ids.map((id) => nextSides.find((s) => s.id === id)?.name ?? "a side");
  if (reads.size > 0) notes.push(`The roof was read off the photos of ${listWords(named([...reads.keys()]))} on the phone (Finish exterior).`);
  if (finish.pitch != null) notes.push(`The pitch was typed on the phone: ${formatPitch(finish.pitch)}.`);
  if (finish.ends && Object.keys(finish.ends).length > 0) {
    notes.push(`Roof ends set on the phone: ${Object.entries(finish.ends).map(([k, kind]) => `${named([idByIndex.get(Number(k)) ?? ""])[0]} ${kind}`).join(", ")}.`);
  }
  return { sides: nextSides, roof: nextRoof, notes };
}

/** The overhangs are lengths too: scaled with the side, as the photos' pieces are. */
function scaleOverhangs(read: SideRoofRead, k: number): SideRoofRead {
  const out = { ...read };
  if (typeof out.rakeOverhangFeet === "number") out.rakeOverhangFeet *= k;
  if (typeof out.eaveOverhangFeet === "number") out.eaveOverhangFeet *= k;
  if (typeof out.breakFeet === "number") out.breakFeet *= k;
  return out;
}

const listWords = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// ---------------------------------------------------------------------------------------------
// One side, on the phone: the request, and the answer made a read
// ---------------------------------------------------------------------------------------------

/**
 * The trace's request for a side's squared photo: what the editor sends, and the phone the same.
 * [used] are the photos the image was squared from, in that order; [image] the squared JPEG, base64.
 */
export function traceRequestFor(side: ExteriorSide, frame: SquareFrame, used: Pick<SidePhoto, "toPhoto" | "camera" | "inView">[], image: string, scaleAt?: number | null): TraceRequest {
  return {
    image,
    frame,
    side: {
      name: side.name,
      lengthM: side.lengthFeet / FEET_PER_METRE,
      bottomLeftM: side.baseLeftFeet / FEET_PER_METRE,
      bottomRightM: side.baseRightFeet / FEET_PER_METRE,
      // Whether any of the side's photos has each end, as the phone worked it out.
      leftEndInPhoto: (side.photos ?? used).some((p) => p.inView?.leftEnd !== false),
      rightEndInPhoto: (side.photos ?? used).some((p) => p.inView?.rightEnd !== false),
    },
    photos: used.map((p) => ({ toPhoto: p.toPhoto, camera: p.camera })),
    ...(scaleAt != null ? { scaleAt } : {}),
  };
}

/** Finish takes the roof alone: no shapes, openings or wall top, which stay the phone's taps. */
export function roofOnlyPicks(p: TraceProposals): TracePicks {
  return { shapes: [], openings: [], wallTop: false, roof: roofPicksAtFirst(p.roof), roofShapes: shapePicksAtFirst(p) };
}

/**
 * A trace's answer (snapped already) made the side's Finish read: the roof's reads ticked as the editor
 * ticks them first, and what was read and set aside in words.
 */
export function finishSideFrom(side: ExteriorSide, proposals: TraceProposals, photos: number[], scaleAt: number, at: string, call?: { model?: string; costUsd?: number }): FinishSide {
  const applied = applyTrace(side, proposals, roofOnlyPicks(proposals), at);
  const roofRead = applied.roofRead ?? { at };
  return {
    at,
    photos,
    scaleAt,
    roofRead,
    said: readWords(proposals, roofRead),
    ...(call?.model ? { model: call.model } : {}),
    ...(call?.costUsd !== undefined ? { costUsd: call.costUsd } : {}),
  };
}

const inchesOf = (feet: number) => formatFeetInches(feet);

/** What a side's read came to, in words: each read, and why any was set aside. */
export function readWords(p: TraceProposals, read: SideRoofRead): string[] {
  const out: string[] = [];
  const r = p.roof;
  if (r?.over) out.push(r.over === "gable" ? "a gable end" : r.over === "hip" ? "a hip end" : "an eave along it");
  else if (r && (r.said === "none" || r.said === "unclear")) out.push(r.said === "none" ? "no roof over it" : "the roof over it unclear");
  if (r?.pitch) {
    const slopes = `${r.pitch.slopes[0].toFixed(1)} and ${r.pitch.slopes[1].toFixed(1)}`;
    if (read.pitch != null) out.push(`pitch ${formatPitch(read.pitch)} (slopes ${slopes})`);
    else out.push(`pitch set aside: the slopes read ${slopes}${r.pitch.agree ? ", off a whole pitch" : ", too far apart"}`);
  }
  if (r?.rakeOverhang) out.push(read.rakeOverhangFeet != null ? `rake overhang ${inchesOf(read.rakeOverhangFeet)}` : `rake overhang set aside (${inchesOf(r.rakeOverhang.feet)}, its two reads disagree)`);
  if (r?.eaveOverhang) out.push(read.eaveOverhangFeet != null ? `eave overhang ${inchesOf(read.eaveOverhangFeet)}` : `eave overhang set aside (${inchesOf(r.eaveOverhang.feet)}, its two reads disagree)`);
  for (const q of p.pieces ?? []) out.push(`${PHOTO_PIECE_LABEL[q.piece.kind].toLowerCase()} ${q.agree ? "proposed" : "seen, not counted (unsure)"}`);
  if (read.upper && read.upper !== "none") out.push(UPPER_SHOWN_WORDS[read.upper]);
  if (r && !r.pitch && !r.rakeOverhang && !r.eaveOverhang && !r.over) out.push("nothing of the roof could be read");
  if (!r) out.push("the photo shows no roof edge");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Which sides to read
// ---------------------------------------------------------------------------------------------

/** A side's Scan index and its photos' numbers, as the exterior file has them. */
export interface SidePhotosAt {
  index: number;
  name: string;
  photos: number[];
}

/**
 * The sides Finish has still to read: each with photos whose read is missing, made off other photos, or
 * at another scale. [scaleNow] is the file's scale.
 */
export function sidesToRead(sides: SidePhotosAt[], finish: ScanFinish | null, scaleNow: number): SidePhotosAt[] {
  return sides.filter((s) => {
    if (s.photos.length === 0) return false;
    const done = finish?.sides?.[String(s.index)];
    if (!done) return true;
    const same = done.photos.length === s.photos.length && s.photos.every((n) => done.photos.includes(n));
    return !same || Math.abs(done.scaleAt - scaleNow) > 1e-6;
  });
}

/** Every side of [exterior] with a roof read from photos, by name: what the report and the phone list. */
export function sidesRead(exterior: Exterior): { name: string; read: SideRoofRead }[] {
  return allSides(exterior)
    .filter((s) => s.roofRead)
    .map((s) => ({ name: s.name.trim() || "Side", read: s.roofRead as SideRoofRead }));
}
