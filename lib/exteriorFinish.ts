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
 * The same call reads the side's WALLS too (2026-10-15, the owner's option 1: "two bottom-corner taps per
 * side, the side's photo, then Finish"): its cladding as shapes, its windows, doors and garage doors, and its
 * wall top - the eaves and a gable's peak. They are kept as the side's `walls` and put on where the phone
 * has nothing of its own, as typed beats photos beats assumed:
 *   - shapes: the read ones only on a side with no shape tapped;
 *   - openings: each read one that no tapped opening already covers;
 *   - wall top: only where no eave was tapped (a side tapped as corners alone has none).
 * Each is marked `from: "photo"` (the side `wallTopFrom`), so the report and the scope can say so; the
 * estimator keeps or sets aside a side's walls on the phone (`taken`).
 *
 *   "finish": {
 *     "format": "scrivn-finish/1", "engine": "<Scrivn build>", "at": "<when Finish last ran>",
 *     "acceptedAt": "<when the estimator accepted the roof>" | null,
 *     "pitch": <the main roof's pitch typed on the phone, rise in 12> | null,
 *     "ends": { "<Scan side index>": "gable" | "hip" },          switched on the phone
 *     "sides": { "<Scan side index>": FinishSide }                the roof read off each side's photos
 *   }
 *
 * HEIGHTS FROM THE NEIGHBOURS (2026-10-15, the owner after his 18:02 walk: "Tapping corners and a few photos is fine but
 * its every tiny side and some of them just will not be possible to photograph correctly"). The walk is now a lap of corners,
 * then a few photos of the house, each laid on every side it sees. Once Finish has read any side, a side left with no height
 * of its own - no photo saw it, or none showed its top - takes its eaves from the sides beside it, at the corners it shares
 * with them, marked "neighbours" ([heightsFromNeighbours]): its siding counts at that height, with no openings unless some
 * were tapped. A side whose read walls the estimator set aside is left as he set it.
 *
 * THE GARAGE DOOR TYPED ON THE PHONE (2026-10-15, the owner: "we need to include a taped measurement in the walks. Should be
 * scaled off of something"). Scan's walk asks for a tape on one wall or the garage door's width, typed. The tape is Scan's own
 * `taped` (the house's scale, as ever). The door is `garageDoorFeet` here, and it is matched against each garage door a photo
 * read (within 12%, the read at the scale it was read): with no tape, the house's sizes are taken from it, once
 * (`withScaleFrom`, lib/exteriorScale.ts); with a tape, the tape stands for the house - it measures the lap itself - and the
 * door corrects only what was read off its own wall's photo, heights and openings, where the two disagree by more than 3%.
 *
 * Keyed by Scan's side index, the only name a side has on both: Scrivn gives each side an id of its
 * own when it reads the file (lib/exteriorImport.ts). Reads made at another tape's scale are scaled
 * to the file's as they are put on (`scaledRoofRead`; a pitch is a ratio and stays).
 */

import {
  allSides,
  CLADDING_KINDS,
  type CladdingKind,
  type Exterior,
  type ExteriorOpening,
  type ExteriorOpeningKind,
  type ExteriorRoof,
  type ExteriorSide,
  formatPitch,
  type OpeningTrim,
  polygonOverlap,
  type SideColumn,
  type SidePhoto,
  type SideRoofRead,
  type SizeDoor,
} from "./exterior";
import { withSizeDoors } from "./exteriorScale";
import type { SquareFrame } from "./exteriorPhoto";
import { applyTrace, type ProposedOpening, type TracePicks, type TraceProposals, type TraceRequest, roofPicksAtFirst, shapePicksAtFirst } from "./exteriorTrace";
import type { Pt, RoofEndKind } from "./roof";
import { PHOTO_PIECE_LABEL, scaledRoofRead, UPPER_SHOWN_WORDS } from "./roofPhotoShapes";
import { formatFeetInches, newSketchId } from "./sketch";

export const FINISH_FORMAT = "scrivn-finish/1";

const FEET_PER_METRE = 1 / 0.3048;

/** A side's walls as its photo was read: in the side's own feet, as the trace proposed them (lib/exteriorTrace.ts). */
export interface FinishWalls {
  /** Kept, unless the estimator set them aside on the phone. */
  taken: boolean;
  /** Each with its colour off the photo (2026-10-17), when it was read: for drawing only. */
  shapes: { kind: CladdingKind | "parging"; label?: string; polygon: Pt[]; colour?: string }[];
  /**
   * Each with what hid part of it in the photo, when something did (2026-10-16): its kind is asked on "Check these".
   * And its surround (2026-10-17), when it has one: put on the opening it is, read or tapped.
   */
  openings: { kind: ExteriorOpeningKind; widthFeet: number; heightFeet: number; sillFeet: number; fromLeftFeet: number; hiddenBy?: string; trim?: OpeningTrim }[];
  wallTop: { eaveLeftFeet: number | null; eaveRightFeet: number | null; peak: { atFeet: number; peakFeet: number } | null } | null;
  /** The side's columns and pilasters off the photo (2026-10-17): put on a side with none of its own. Absent from a read before then. */
  columns?: Omit<SideColumn, "id">[];
}

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
  /** The side's walls off the same photo (2026-10-15): put on where nothing was tapped. Absent from a read made before then. */
  walls?: FinishWalls;
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
  /** The garage door's width as typed on the phone, feet: a reference for the sizes (2026-10-15). */
  garageDoorFeet?: number | null;
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

const pts = (v: unknown): Pt[] =>
  Array.isArray(v) ? v.filter(isObject).map((p) => ({ x: num(p.x), y: num(p.y) })).filter((p): p is Pt => p.x !== null && p.y !== null && Math.abs(p.x) < 700 && Math.abs(p.y) < 200) : [];

/** A colour as Scrivn keeps one, "#rrggbb", or nothing. */
const colourOf = (v: unknown): string | undefined => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined);
/** A trim's material: one of Scrivn's, else "other". */
const materialOf = (v: unknown): CladdingKind => ((CLADDING_KINDS as string[]).includes(String(v)) ? (v as CladdingKind) : "other");
/** A length a trim can be: 0 to 4 ft. */
const trimFeet = (v: unknown, hi = 4): number => {
  const n = num(v);
  return n !== null && n >= 0 && n <= hi ? n : 0;
};

/** An opening's surround as the phone wrote it (2026-10-17), checked; undefined when there is none or it is no surround. */
function openingTrimOf(raw: unknown): OpeningTrim | undefined {
  if (!isObject(raw)) return undefined;
  const t: OpeningTrim = { leftFeet: trimFeet(raw.leftFeet), rightFeet: trimFeet(raw.rightFeet), topFeet: trimFeet(raw.topFeet), bottomFeet: trimFeet(raw.bottomFeet), material: materialOf(raw.material) };
  const gap = trimFeet(raw.gapFeet);
  if (gap > 0) t.gapFeet = gap;
  const up = trimFeet(raw.upFeet, 20);
  if (up > 0) t.upFeet = up;
  if (str(raw.label)) t.label = (str(raw.label) as string).slice(0, 60);
  if (colourOf(raw.colour)) t.colour = colourOf(raw.colour);
  if (isObject(raw.keystone) && trimFeet(raw.keystone.widthFeet) > 0 && trimFeet(raw.keystone.heightFeet) > 0) t.keystone = { widthFeet: trimFeet(raw.keystone.widthFeet), heightFeet: trimFeet(raw.keystone.heightFeet) };
  t.from = "photo";
  if (str(raw.unsure)) t.unsure = (str(raw.unsure) as string).slice(0, 120);
  return t.leftFeet + t.rightFeet + t.topFeet + t.bottomFeet > 0 || t.keystone ? t : undefined;
}

/** A column as the phone wrote it (2026-10-17), checked; null when it is no column. */
function columnOf(raw: unknown): Omit<SideColumn, "id"> | null {
  if (!isObject(raw)) return null;
  const width = trimFeet(raw.widthFeet, 6);
  const height = trimFeet(raw.heightFeet, 40);
  const from = num(raw.fromLeftFeet);
  if (!(width > 0.1) || !(height > 0.5) || from === null || Math.abs(from) > 700) return null;
  const block = (v: unknown) => (isObject(v) && trimFeet(v.heightFeet, 6) > 0 ? { heightFeet: trimFeet(v.heightFeet, 6), outFeet: trimFeet(v.outFeet, 2) } : null);
  const base = block(raw.base);
  const cap = block(raw.cap);
  return {
    kind: raw.kind === "column" ? "column" : "pilaster",
    fromLeftFeet: from,
    widthFeet: width,
    depthFeet: trimFeet(raw.depthFeet, 6) || width,
    outFeet: trimFeet(raw.outFeet, 30),
    footFeet: trimFeet(raw.footFeet, 30),
    heightFeet: height,
    ...(base ? { base } : {}),
    ...(cap ? { cap } : {}),
    material: materialOf(raw.material),
    ...(str(raw.label) ? { label: (str(raw.label) as string).slice(0, 60) } : {}),
    ...(colourOf(raw.colour) ? { colour: colourOf(raw.colour) } : {}),
    from: "photo",
    ...(str(raw.unsure) ? { unsure: (str(raw.unsure) as string).slice(0, 120) } : {}),
  };
}

/** A side's walls as the phone wrote them, checked: what is not a shape, an opening or a wall top is left out. */
function wallsOf(raw: unknown): FinishWalls | undefined {
  if (!isObject(raw)) return undefined;
  const kinds = [...CLADDING_KINDS, "parging"] as string[];
  const shapes = (Array.isArray(raw.shapes) ? raw.shapes : [])
    .filter(isObject)
    .map((s) => ({ kind: (kinds.includes(String(s.kind)) ? s.kind : "other") as CladdingKind | "parging", ...(str(s.label) ? { label: str(s.label) as string } : {}), polygon: pts(s.polygon), ...(colourOf(s.colour) ? { colour: colourOf(s.colour) } : {}) }))
    .filter((s) => s.polygon.length >= 3);
  const openings = (Array.isArray(raw.openings) ? raw.openings : [])
    .filter(isObject)
    .map((o) => ({
      kind: (o.kind === "door" || o.kind === "garage" ? o.kind : "window") as ExteriorOpeningKind,
      widthFeet: num(o.widthFeet) ?? 0,
      heightFeet: num(o.heightFeet) ?? 0,
      sillFeet: Math.max(0, num(o.sillFeet) ?? 0),
      fromLeftFeet: num(o.fromLeftFeet) ?? 0,
      ...(str(o.hiddenBy) ? { hiddenBy: (str(o.hiddenBy) as string).slice(0, 120) } : {}),
      ...(openingTrimOf(o.trim) ? { trim: openingTrimOf(o.trim) } : {}),
    }))
    .filter((o) => o.widthFeet > 0.2 && o.widthFeet < 60 && o.heightFeet > 0.2 && o.heightFeet < 40);
  const columns = (Array.isArray(raw.columns) ? raw.columns : []).map(columnOf).filter((c): c is Omit<SideColumn, "id"> => c !== null);
  const t = isObject(raw.wallTop) ? raw.wallTop : null;
  const height = (v: unknown) => {
    const n = num(v);
    return n !== null && n > 0 && n < 120 ? n : null;
  };
  const peak = t && isObject(t.peak) && height(t.peak.peakFeet) !== null && num(t.peak.atFeet) !== null ? { atFeet: num(t.peak.atFeet) as number, peakFeet: height(t.peak.peakFeet) as number } : null;
  const wallTop = t ? { eaveLeftFeet: height(t.eaveLeftFeet), eaveRightFeet: height(t.eaveRightFeet), peak } : null;
  return {
    taken: raw.taken !== false,
    shapes,
    openings,
    wallTop: wallTop && (wallTop.eaveLeftFeet !== null || wallTop.eaveRightFeet !== null || wallTop.peak) ? wallTop : null,
    ...(columns.length > 0 ? { columns } : {}),
  };
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
  const door = num(raw.garageDoorFeet);
  if (door !== null && door >= 6 && door <= 30) out.garageDoorFeet = door;
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
        ...(wallsOf(v.walls) ? { walls: wallsOf(v.walls) as FinishWalls } : {}),
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
  /** The walk went all the way round: the last side's right end meets the first's left. */
  closed = false,
  /** The house's scale is a tape's: a garage door typed corrects only its own wall's read, not the house. */
  taped = false,
): { sides: ExteriorSide[]; roof: ExteriorRoof; notes: string[]; doorScaleId?: string } {
  const notes: string[] = [];
  const reads = new Map<string, SideRoofRead>();
  const walls = new Map<string, FinishWalls>();
  for (const [k, fs] of Object.entries(finish.sides ?? {})) {
    const id = idByIndex.get(Number(k));
    if (!id) continue;
    // Read off photos this side still has: a side undone on the phone and tapped again under the same number is another
    // wall, with other photos (Scan never gives a number twice), and its read is not this one.
    const has = new Set((sides.find((s) => s.id === id)?.photos ?? []).map((p) => p.n));
    if (fs.photos.length === 0 || !fs.photos.every((n) => has.has(n))) continue;
    const k2 = fs.scaleAt > 0 ? scaleNow / fs.scaleAt : 1;
    reads.set(id, Math.abs(k2 - 1) > 1e-6 ? scaledRoofRead(scaleOverhangs(fs.roofRead, k2), k2) : fs.roofRead);
    if (fs.walls?.taken) walls.set(id, Math.abs(k2 - 1) > 1e-6 ? scaledWalls(fs.walls, k2) : fs.walls);
  }
  // The garage door typed on the phone, against each garage door a photo read: kept as a size check on its side, and with a
  // tape, its own wall's read corrected to it; with none, the house's sizes are taken from it after (`doorScaleId`).
  const doors = new Map<string, SizeDoor>();
  const doorNotes: string[] = [];
  let doorScaleId: string | undefined;
  let doorMid: { id: string; door: SizeDoor; k: number } | undefined;
  const typed = finish.garageDoorFeet ?? null;
  if (typed !== null && typed > 0) {
    const found: { id: string; door: SizeDoor; k: number }[] = [];
    for (const [id, w] of walls) {
      for (const o of w.openings) {
        if (o.kind !== "garage" || !(o.widthFeet > 0)) continue;
        const k = typed / o.widthFeet;
        if (Math.abs(k - 1) > GARAGE_WITHIN) continue;
        // In the phone's own measure, as every size check is kept; its height taken in the same proportion, as only the width was typed.
        const phone = { widthFeet: o.widthFeet / scaleNow, heightFeet: o.heightFeet / scaleNow, middleFeet: (o.fromLeftFeet + o.widthFeet / 2) / scaleNow };
        const door: SizeDoor = { id: newSketchId("door"), kind: "garage", widthFeet: typed, heightFeet: phone.heightFeet * (typed / phone.widthFeet), phone };
        found.push({ id, door, k });
      }
    }
    for (const f of found) doors.set(f.id, f.door);
    const nameOfId = (id: string) => sides.find((s) => s.id === id)?.name ?? "a side";
    if (found.length === 0) {
      doorNotes.push(`The ${formatFeetInches(typed)} garage door typed on the phone wasn't found in the photos read: the sizes stay from ${taped ? "the tape" : "the phone's own measure"}.`);
    } else if (taped) {
      for (const f of found) {
        if (Math.abs(f.k - 1) <= DOOR_AGREE) continue;
        const w = walls.get(f.id) as FinishWalls;
        walls.set(f.id, readHeightsScaled(w, f.k));
        const r = reads.get(f.id);
        if (r) reads.set(f.id, scaleOverhangs(r, f.k));
        doorNotes.push(`The garage door on ${nameOfId(f.id)} read ${formatFeetInches(typed / f.k)} wide against the ${formatFeetInches(typed)} typed: the heights and openings read off its photo are scaled to it (x${f.k.toFixed(3)}); the tape stays the house's.`);
      }
    } else {
      // The house from the door: the one in the middle, where there are more of the typed size.
      doorMid = [...found].sort((a, b) => a.k - b.k)[Math.floor((found.length - 1) / 2)] as (typeof found)[number];
    }
  }
  const walledSides = sides.map((s) => {
    const withRead = reads.has(s.id) ? { ...s, roofRead: reads.get(s.id) as SideRoofRead } : s;
    const w = walls.get(s.id);
    const walled = w ? withWalls(withRead, w) : withRead;
    const d = doors.get(s.id);
    return d ? withSizeDoors(walled, [d]) : walled;
  });
  // The door the house is taken from, by the id it was kept under.
  if (doorMid) {
    const mid = doorMid;
    doorScaleId = walledSides.find((s) => s.id === mid.id)?.sizeDoors?.find((d) => d.kind === "garage" && Math.abs(d.phone.middleFeet - mid.door.phone.middleFeet) < 1e-6)?.id;
  }
  // Once anything was read: a side still with no height takes its neighbours' at the corners it shares - not one whose read
  // walls were set aside on the phone, which stays as he left it.
  const setAside = new Set<string>();
  for (const [k, fs] of Object.entries(finish.sides ?? {})) {
    const id = idByIndex.get(Number(k));
    if (id && fs.walls && !fs.walls.taken) setAside.add(id);
  }
  const neighbours = reads.size > 0 ? heightsFromNeighbours(walledSides, closed, setAside) : { sides: walledSides, filled: [] as string[] };
  const nextSides = neighbours.sides;
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
  const walled = nextSides.filter((s) => walls.has(s.id) && (s.wallTopFrom === "photo" || (s.shapes ?? []).some((x) => x.from === "photo") || s.openings.some((o) => o.from === "photo")));
  if (walled.length > 0) notes.push(`Walls read off the photos where nothing was tapped (cladding, windows, doors, wall top): ${listWords(walled.map((s) => s.name))}. Each is marked from photo.`);
  if (neighbours.filled.length > 0) {
    const unseen = neighbours.filled.filter((id) => (nextSides.find((s) => s.id === id)?.photos ?? []).length === 0);
    const unread = neighbours.filled.filter((id) => !unseen.includes(id));
    if (unseen.length > 0) notes.push(`Not seen in any photo, ${unseen.length === 1 ? "its height comes" : "their heights come"} from the sides beside ${unseen.length === 1 ? "it" : "them"}: ${listWords(named(unseen))}. No openings on ${unseen.length === 1 ? "it" : "them"} unless tapped.`);
    if (unread.length > 0) notes.push(`The wall top didn't read off the photo of ${listWords(named(unread))}: the height comes from the sides beside ${unread.length === 1 ? "it" : "them"}.`);
  }
  notes.push(...doorNotes);
  if (finish.pitch != null) notes.push(`The pitch was typed on the phone: ${formatPitch(finish.pitch)}.`);
  if (finish.ends && Object.keys(finish.ends).length > 0) {
    notes.push(`Roof ends set on the phone: ${Object.entries(finish.ends).map(([k, kind]) => `${named([idByIndex.get(Number(k)) ?? ""])[0]} ${kind}`).join(", ")}.`);
  }
  return { sides: nextSides, roof: nextRoof, notes, ...(doorScaleId ? { doorScaleId } : {}) };
}

/** A garage door read further than this from the width typed is another door (a double beside a single). */
const GARAGE_WITHIN = 0.12;
/** With a tape, a door within this of its wall's read leaves the read as it is: the two agree. */
const DOOR_AGREE = 0.03;

/**
 * A side's walls read off its photo with every height and opening size times [k], where along the wall stays: the door on it
 * says the photo's read is k off, and the wall's length is the tape's (2026-10-15).
 */
function readHeightsScaled(w: FinishWalls, k: number): FinishWalls {
  const sc = (v: number | null) => (v === null ? null : v * k);
  return {
    taken: w.taken,
    shapes: w.shapes.map((s) => ({ ...s, polygon: s.polygon.map((p) => ({ x: p.x, y: p.y * k })) })),
    openings: w.openings.map((o) => ({ ...o, widthFeet: o.widthFeet * k, heightFeet: o.heightFeet * k, sillFeet: o.sillFeet * k, ...(o.trim ? { trim: trimScaled(o.trim, k) } : {}) })),
    wallTop: w.wallTop ? { eaveLeftFeet: sc(w.wallTop.eaveLeftFeet), eaveRightFeet: sc(w.wallTop.eaveRightFeet), peak: w.wallTop.peak ? { atFeet: w.wallTop.peak.atFeet, peakFeet: w.wallTop.peak.peakFeet * k } : null } : null,
    ...(w.columns ? { columns: w.columns.map((c) => columnScaled(c, k, false)) } : {}),
  };
}

/** A surround with every length times [k] (2026-10-17). */
function trimScaled(t: OpeningTrim, k: number): OpeningTrim {
  return {
    ...t,
    leftFeet: t.leftFeet * k,
    rightFeet: t.rightFeet * k,
    topFeet: t.topFeet * k,
    bottomFeet: t.bottomFeet * k,
    ...(t.gapFeet !== undefined ? { gapFeet: t.gapFeet * k } : {}),
    ...(t.upFeet !== undefined ? { upFeet: t.upFeet * k } : {}),
    ...(t.keystone ? { keystone: { widthFeet: t.keystone.widthFeet * k, heightFeet: t.keystone.heightFeet * k } } : {}),
  };
}

/** A column with its sizes times [k], and where it is along the side too when [along]. */
function columnScaled(c: Omit<SideColumn, "id">, k: number, along: boolean): Omit<SideColumn, "id"> {
  const block = (b: SideColumn["base"]) => (b ? { heightFeet: b.heightFeet * k, outFeet: b.outFeet * k } : b);
  return {
    ...c,
    fromLeftFeet: along ? c.fromLeftFeet * k : c.fromLeftFeet,
    widthFeet: c.widthFeet * k,
    depthFeet: c.depthFeet * k,
    outFeet: c.outFeet * k,
    footFeet: c.footFeet * k,
    heightFeet: c.heightFeet * k,
    ...(c.base !== undefined ? { base: block(c.base) } : {}),
    ...(c.cap !== undefined ? { cap: block(c.cap) } : {}),
  };
}

/** Two openings the same one: their boxes share more than a third of the smaller's area. */
function sameOpening(a: Pick<ExteriorOpening, "fromLeftFeet" | "widthFeet" | "sillFeet" | "heightFeet">, b: Pick<ExteriorOpening, "fromLeftFeet" | "widthFeet" | "sillFeet" | "heightFeet">): boolean {
  const w = Math.min(a.fromLeftFeet + a.widthFeet, b.fromLeftFeet + b.widthFeet) - Math.max(a.fromLeftFeet, b.fromLeftFeet);
  const h = Math.min(a.sillFeet + a.heightFeet, b.sillFeet + b.heightFeet) - Math.max(a.sillFeet, b.sillFeet);
  if (w <= 0 || h <= 0) return false;
  return w * h > Math.min(a.widthFeet * a.heightFeet, b.widthFeet * b.heightFeet) / 3;
}

/**
 * A side's walls off its photo put on where the phone has nothing of its own: its shapes when none was
 * tapped, each opening no tapped one covers, its wall top when no eave was tapped. What it put on is
 * marked from photo.
 */
export function withWalls(side: ExteriorSide, w: FinishWalls): ExteriorSide {
  const next: ExteriorSide = { ...side };
  if ((side.shapes ?? []).length === 0 && w.shapes.length > 0) {
    next.shapes = w.shapes.map((s) => ({ id: newSketchId("shape"), kind: s.kind, ...(s.label ? { label: s.label } : {}), closed: true, polygon: s.polygon.map((p) => ({ ...p })), from: "photo" as const, ...(s.colour ? { colour: s.colour } : {}) }));
  } else if ((side.shapes ?? []).length > 0 && w.shapes.some((s) => s.colour)) {
    // Tapped shapes keep their corners and take the colour of the read shape of their kind over them most (2026-10-17): drawing only.
    next.shapes = (side.shapes ?? []).map((s) => {
      if (s.colour || s.polygon.length < 3) return s;
      const best = w.shapes
        .filter((r) => r.colour && r.kind === s.kind && r.polygon.length >= 3)
        .map((r) => ({ r, over: overlapArea(s.polygon, r.polygon) }))
        .sort((a, b) => b.over - a.over)[0];
      return best && best.over > 0.5 ? { ...s, colour: best.r.colour } : s;
    });
  }
  // A read surround goes on the tapped opening it is (2026-10-17), where that one has none: typed beats photos beats nothing.
  const trimmed = side.openings.map((t) => {
    if (t.trim) return t;
    const r = w.openings.find((o) => o.trim && sameOpening(t, o));
    return r?.trim ? { ...t, trim: trimOnto(r, r.trim, t) } : t;
  });
  if (trimmed.some((t, i) => t !== side.openings[i])) next.openings = trimmed;
  const added = w.openings.filter((o) => !side.openings.some((t) => sameOpening(t, o))).map((o) => ({ id: newSketchId("opening"), ...o, from: "photo" as const }));
  if (added.length > 0) next.openings = [...(next.openings ?? side.openings), ...added];
  if ((side.columns ?? []).length === 0 && (w.columns ?? []).length > 0) next.columns = (w.columns ?? []).map((c) => ({ id: newSketchId("column"), ...c }));
  const t = w.wallTop;
  if (t && side.eaveLeftFeet == null && side.eaveRightFeet == null && (t.eaveLeftFeet !== null || t.eaveRightFeet !== null)) {
    next.eaveLeftFeet = t.eaveLeftFeet ?? t.eaveRightFeet;
    next.eaveRightFeet = t.eaveRightFeet ?? t.eaveLeftFeet;
    if (!side.gable && t.peak) next.gable = { peakFeet: t.peak.peakFeet, atFeet: t.peak.atFeet };
    next.wallTopFrom = "photo";
  }
  return next;
}

type Box = Pick<ExteriorOpening, "fromLeftFeet" | "widthFeet" | "sillFeet" | "heightFeet">;

/**
 * A surround read round one opening put round the tapped opening it is (2026-10-17): its outer edges stay where the photo
 * put them, so each width gives or takes what the two openings differ by - and its keystone's top stays too.
 */
function trimOnto(read: Box, t: OpeningTrim, onto: Box): OpeningTrim {
  const dLeft = onto.fromLeftFeet - read.fromLeftFeet;
  const dRight = read.fromLeftFeet + read.widthFeet - (onto.fromLeftFeet + onto.widthFeet);
  const dTop = read.sillFeet + read.heightFeet - (onto.sillFeet + onto.heightFeet);
  const dBottom = onto.sillFeet - read.sillFeet;
  const out: OpeningTrim = {
    ...t,
    leftFeet: Math.max(0, t.leftFeet + dLeft),
    rightFeet: Math.max(0, t.rightFeet + dRight),
    topFeet: t.topFeet > 0 ? Math.max(0, t.topFeet + dTop) : 0,
    bottomFeet: t.bottomFeet > 0 ? Math.max(0, t.bottomFeet + dBottom) : 0,
  };
  if (t.upFeet !== undefined) out.upFeet = Math.max(0, t.upFeet + dTop);
  if (t.keystone) out.keystone = { widthFeet: t.keystone.widthFeet, heightFeet: Math.max(1 / 12, t.keystone.heightFeet + dTop) };
  return out;
}

/** How much two polygons share, square feet. */
function overlapArea(a: Pt[], b: Pt[]): number {
  return polygonOverlap(a, b);
}

/**
 * Sides with no height of their own - neither eave tapped nor read - given their neighbours' eaves at the corners they share
 * (2026-10-15): side k's right end meets side k + 1's left end, and with the walk [closed] the last's meets the first's. A run
 * of such sides fills in from both ends, a side at a time; a side whose one neighbour has a height takes it at both ends. Sides
 * in [keepOut] are left as they are. Each side filled is marked `wallTopFrom: "neighbours"`, and its id is in `filled`.
 */
export function heightsFromNeighbours(sides: ExteriorSide[], closed: boolean, keepOut: Set<string> = new Set()): { sides: ExteriorSide[]; filled: string[] } {
  const out = sides.map((s) => ({ ...s }));
  const n = out.length;
  const has = (s: ExteriorSide) => s.eaveLeftFeet != null || s.eaveRightFeet != null;
  const leftOf = (s: ExteriorSide) => s.eaveLeftFeet ?? s.eaveRightFeet;
  const rightOf = (s: ExteriorSide) => s.eaveRightFeet ?? s.eaveLeftFeet;
  const filled: string[] = [];
  const wanted = new Set(out.filter((s) => !has(s) && !keepOut.has(s.id)).map((s) => s.id));
  if (wanted.size === 0 || wanted.size === n) return { sides: out, filled };
  for (let pass = 0; pass < n && wanted.size > 0; pass++) {
    const now: { i: number; left: number | null; right: number | null }[] = [];
    const at = (i: number): ExteriorSide | null => (i >= 0 && i < n ? (out[i] as ExteriorSide) : closed ? (out[(i + n) % n] as ExteriorSide) : null);
    for (let i = 0; i < n; i++) {
      const me = out[i] as ExteriorSide;
      if (!wanted.has(me.id)) continue;
      const prev = at(i - 1);
      const next = at(i + 1);
      const left = prev && has(prev) ? rightOf(prev) ?? null : null;
      const right = next && has(next) ? leftOf(next) ?? null : null;
      if (left != null || right != null) now.push({ i, left, right });
    }
    if (now.length === 0) break;
    for (const { i, left, right } of now) {
      const me = out[i] as ExteriorSide;
      // A level eave at the lower of the two corners: where the neighbours differ, the wall between is the lower one more often
      // than not - a wing against a taller gable wall - and its gable, if any, comes from the roof.
      const eave = left != null && right != null ? Math.min(left, right) : (left ?? right);
      out[i] = { ...me, eaveLeftFeet: eave, eaveRightFeet: eave, wallTopFrom: "neighbours" };
      wanted.delete(me.id);
      filled.push(me.id);
    }
  }
  return { sides: out, filled };
}

/** A side's walls with every length times [k], as the side is scaled. */
function scaledWalls(w: FinishWalls, k: number): FinishWalls {
  const sc = (v: number | null) => (v === null ? null : v * k);
  return {
    taken: w.taken,
    shapes: w.shapes.map((s) => ({ ...s, polygon: s.polygon.map((p) => ({ x: p.x * k, y: p.y * k })) })),
    openings: w.openings.map((o) => ({ ...o, widthFeet: o.widthFeet * k, heightFeet: o.heightFeet * k, sillFeet: o.sillFeet * k, fromLeftFeet: o.fromLeftFeet * k, ...(o.trim ? { trim: trimScaled(o.trim, k) } : {}) })),
    wallTop: w.wallTop ? { eaveLeftFeet: sc(w.wallTop.eaveLeftFeet), eaveRightFeet: sc(w.wallTop.eaveRightFeet), peak: w.wallTop.peak ? { atFeet: w.wallTop.peak.atFeet * k, peakFeet: w.wallTop.peak.peakFeet * k } : null } : null,
    ...(w.columns ? { columns: w.columns.map((c) => columnScaled(c, k, true)) } : {}),
  };
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
    walls: wallsFrom(proposals),
    ...(call?.model ? { model: call.model } : {}),
    ...(call?.costUsd !== undefined ? { costUsd: call.costUsd } : {}),
  };
}

/** The trace's cladding, openings and wall top as a side's walls: every one, as the editor ticks them first. */
export function wallsFrom(p: TraceProposals): FinishWalls {
  const trimOf = (o: ProposedOpening) => {
    const t = (p.trims ?? []).find((x) => x.openingKey === o.key)?.trim;
    if (!t) return {};
    // Its widths past the opening as kept (its left end cut at the side's), as applyTrace puts it on.
    const cut = o.box ? o.fromLeftFeet - o.box.x0 : 0;
    return { trim: { ...t, leftFeet: Math.max(0, t.leftFeet + cut) } };
  };
  return {
    taken: true,
    shapes: p.shapes.map((s) => ({ kind: s.kind, ...(s.label ? { label: s.label } : {}), polygon: s.polygon.map((q) => ({ x: q.x, y: q.y })), ...(s.colour ? { colour: s.colour } : {}) })),
    openings: p.openings.map((o) => ({ kind: o.kind, widthFeet: o.widthFeet, heightFeet: o.heightFeet, sillFeet: o.sillFeet, fromLeftFeet: o.fromLeftFeet, ...(o.hiddenBy ? { hiddenBy: o.hiddenBy } : {}), ...trimOf(o) })),
    wallTop: p.wallTop ? { eaveLeftFeet: p.wallTop.eaveLeftFeet, eaveRightFeet: p.wallTop.eaveRightFeet, peak: p.wallTop.peak ? { ...p.wallTop.peak } : null } : null,
    ...((p.columns ?? []).length > 0 ? { columns: (p.columns ?? []).map((c) => ({ ...c.column })) } : {}),
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
