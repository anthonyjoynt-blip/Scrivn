/**
 * The roof's shapes read off a side's photo (2026-10-15): the dormers on the slope over the side and
 * any turret, whether an upper floor stands over the side, and what roof runs from the side up to it -
 * proposals the estimator ticks, as the pitch and overhang reads are (lib/roofPhotoRead.ts). The same
 * one AI trace call per side answers them (lib/exteriorTrace.ts); nothing here is another call.
 *
 * ── A dormer stands back from the wall ────────────────────────────────────────────────────────
 * A dormer's face looks out the same way as the wall under it, so the squared image shows it square,
 * but set back on the slope: further from the phone than the wall, so SMALLER than it is, shrunk
 * toward the point of the wall in front of the phone (its foot). A point b behind the wall, seen
 * through a phone D out, shows at foot + (where it is - foot) × D / (D + b).
 *   * PITCH. The face is one plane square to the photo, so its gable's two slopes read true at any
 *     distance, as the main gable's do.
 *   * HOW FAR BACK. Where the face meets the roof below it (its apron) is on the main slope. That
 *     slope rises from the eave's fascia, which stands the eave overhang out from the wall and the
 *     fascia's height above the soffit (`ROOF_OVER_SOFFIT_FEET`), at the slope's pitch m. A point seen
 *     at height u on the wall's plane is on the slope b back when
 *         cu + (u - cu)(D + b)/D = z0 + m b,   z0 = wall top + fascia + m × eave overhang,
 *     so  b = (u - z0) / (m - (u - cu)/D),  cu the phone's height. From a phone low and far, the slope
 *     is seen at a glancing angle and an inch of the trace is feet of b: such a read is said and the
 *     dormer left for the estimator (`SCALE_PER_INCH_MAX`). b goes into the width as (D + b)/D, so a
 *     few inches of it hardly matter.
 *   * WIDTH, across the face at its walls: as seen, times (D + b)/D.
 *   * PROJECTION. A gable dormer's eaves stand m × its projection over the slope at its face
 *     (lib/roofPieces.ts), so the projection is the face's eaves over its apron, scaled, over m. A
 *     shed dormer's own pitch runs away from the photo: its projection and pitch are left to type.
 * The slope's pitch m is the roof's as built - typed, then photos, then assumed - so these are worked
 * out when the roof is (`resolvePhotoPiece`), not when the photo is read: a pitch ticked or typed
 * later carries into the dormer.
 *
 * ── A turret ──────────────────────────────────────────────────────────────────────────────────
 * Its roof's outline is the cone's (or pyramid's) slope seen side-on, so its pitch reads true. Its
 * width is read as if it stood on the wall's line: a turret standing out from the wall shows a
 * little bigger than it is, and that is said.
 *
 * ── Two storeys ───────────────────────────────────────────────────────────────────────────────
 * Whether an upper floor stands over the side - flush, the wall carrying on up past a floor line, or
 * set back behind a roof running up to it - and that roof's kind: a lean-to, or a ridge running out
 * from the upper wall with its gable over the side. Scrivn never draws the upper floor's outline from
 * a photo: the read is a tick against the upper floor and the lower roofs the estimator draws
 * (lib/exterior.ts), and a floor line to split a tall side at.
 */

import type { SideRoofRead } from "./exterior";
import type { LowerRoofKind, Pt } from "./roof";
import { type CameraAt, framedPitch, type Seen } from "./roofPhotoRead";
import type { RoofPiece } from "./roofPieces";

const FEET_PER_METRE = 1 / 0.3048;

/** The roof's surface stands this far above the soffit at the eave's fascia: the fascia board, the drip edge and the shingles' edge (8"). */
export const ROOF_OVER_SOFFIT_FEET = 8 / 12;
/** A dormer set back further than this is not one the photo read rightly. */
const SET_BACK_MAX_FEET = 30;
/** How much an inch of the trace may move a dormer's size (its share of it) before its set-back is said to be unreadable. */
const SCALE_PER_INCH_MAX = 0.04;
/** A gable dormer's two slopes further apart than this, in 12, are flagged, as a main gable's are. */
const SLOPES_AGREE_IN_12 = 0.5;
/** Narrower than this, or wider, a dormer or turret is not one: the trace saw something else. */
const WIDTH_MIN_FEET = 1.5;
const WIDTH_MAX_FEET = 40;

export const DORMER_KINDS = ["gable", "shed", "hipped", "other"] as const;
export const TURRET_KINDS = ["round", "many_sided"] as const;
export const UPPER_FLOOR_SAID = ["none", "flush", "set_back", "unclear"] as const;
export const LOWER_ROOF_SAID = ["lean_to", "ridge_out", "none", "unclear"] as const;

/*
  The trace's answer for the roof's shapes is one small object (2026-10-15), and lean: the call's schema
  is compiled into a grammar, and the trace's is at the size the API takes. Dormers, turrets and storeys
  as objects of their own with enums, or a note on each piece, came back "The compiled grammar is too
  large"; this - words as plain strings, points as flat runs of numbers [x1, y1, x2, y2, ...], one note
  for all of it - compiles. Anything more for the trace needs room made first. Each word is read
  leniently here; one not known reads as unclear.
*/

/** A dormer or turret as the trace answers it, in the squared image's pixels: points as [x1, y1, x2, y2, ...]. */
export interface PieceWire {
  /** "gable_dormer", "shed_dormer", "hipped_dormer", "other_dormer", "round_turret" or "many_sided_turret". */
  kind: string;
  /** A dormer: its front wall's top, left corner, peak (a gable), right corner. A turret: its roof's left bottom corner, apex, right bottom corner. */
  outline: number[];
  /** A dormer: where its front wall meets the roof below, left then right. A turret: its wall's left and right edges under its soffit. */
  foot: number[];
  /** A turret: how many sides all round; 0 round, or for a dormer. */
  sides: number;
}

/** The roof's shapes over the side, as the trace answers them. */
export interface RoofShapesWire {
  pieces: PieceWire[];
  /** "none", "flush", "set_back" or "unclear". */
  upper_floor: string;
  floor_line: number[];
  /** "lean_to", "ridge_out", "none" or "unclear". */
  lower_roof: string;
  notes: string;
}

/** A flat run [x1, y1, x2, y2, ...] as points; an odd number left over is dropped. Anything else: none. */
export function pointsOf(flat: unknown): number[][] {
  if (!Array.isArray(flat)) return [];
  // An answer that gave pairs after all reads the same.
  if (flat.every((v) => Array.isArray(v))) return flat as number[][];
  const out: number[][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i] as number, flat[i + 1] as number]);
  return out;
}

/** What stands over the side, as `readStoreys` takes it. */
export type StoreysWire = Pick<RoofShapesWire, "upper_floor" | "floor_line" | "lower_roof" | "notes">;

/** A word of the answer as one of [known], however it was written ("Set back", "set-back"); null when it is none of them. */
function wordOf<T extends string>(said: unknown, known: readonly T[]): T | null {
  const w = String(said ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (known as readonly string[]).includes(w) ? (w as T) : null;
}

/** A dormer's lines on the wall's plane, metres. */
export interface DormerLines {
  kind: (typeof DORMER_KINDS)[number];
  faceTop: Seen[];
  apron: Seen[];
  notes: string;
}

export interface TurretLines {
  kind: (typeof TURRET_KINDS)[number];
  sides: number;
  wallLeft: Seen | null;
  wallRight: Seen | null;
  roofLeft: Seen | null;
  roofRight: Seen | null;
  apex: Seen | null;
  notes: string;
}

/** Each pixel point out of a wire into the wall's metres; null where it is not one. */
export type ToSeen = (p: unknown) => Seen | null;

/** The dormers and turrets of the answer, each on the wall's plane in metres. */
export function piecesOfWire(wire: unknown, toM: ToSeen): { dormers: DormerLines[]; turrets: TurretLines[] } {
  const dormers: DormerLines[] = [];
  const turrets: TurretLines[] = [];
  if (!Array.isArray(wire)) return { dormers, turrets };
  const line = (pts: unknown) => pointsOf(pts).map(toM).filter((p): p is Seen => p !== null);
  for (const w of wire as Partial<PieceWire>[]) {
    const kind = String(w?.kind ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    // One note for all the shapes: the grammar has no room for one a piece.
    const notes = "";
    if (kind.endsWith("turret")) {
      // Its outline left, apex, right as given; its wall's two edges left to right.
      const [roofLeft, apex, roofRight] = pointsOf(w?.outline).map(toM);
      const [wallLeft, wallRight] = line(w?.foot).sort((a, b) => a.alongM - b.alongM);
      turrets.push({
        kind: kind.startsWith("many") ? "many_sided" : "round",
        sides: typeof w?.sides === "number" && Number.isFinite(w.sides) ? Math.round(w.sides) : 0,
        wallLeft: wallLeft ?? null,
        wallRight: wallRight ?? null,
        roofLeft: roofLeft ?? null,
        roofRight: roofRight ?? null,
        apex: apex ?? null,
        notes,
      });
    } else {
      dormers.push({
        kind: wordOf(kind.replace(/_dormer$/, ""), DORMER_KINDS) ?? "other",
        faceTop: line(w?.outline).sort((a, b) => a.alongM - b.alongM),
        apron: line(w?.foot).sort((a, b) => a.alongM - b.alongM),
        notes,
      });
    }
  }
  return { dormers, turrets };
}

// ---------------------------------------------------------------------------------------------
// The pieces, as kept on the side
// ---------------------------------------------------------------------------------------------

export type PhotoPieceKind = "gableDormer" | "shedDormer" | "roundTurret" | "polygonTurret";

/**
 * A dormer or turret read off a side's photo, as kept on the side (`SideRoofRead.pieces`): what the
 * photo shows of it, which the roof's own pitch and overhang turn into a roof piece's numbers when the
 * roof is built (`resolvePhotoPiece`). Lengths in feet, in the side's frame: along from its left end,
 * up from its level.
 */
export interface PhotoPiece {
  id: string;
  kind: PhotoPieceKind;
  /** Ticked by the estimator: only then does it count. Unticked, it is offered on the roof pane. */
  taken: boolean;
  /** Its middle along the side. */
  alongFeet: number;
  /** As the squared photo shows it on the wall's plane: not to scale, as it stands back (or out) from the wall. */
  seen: {
    /** Across its face at its walls. */
    widthFeet: number;
    /** A dormer: where its face meets the roof below it; null where hidden. */
    apronFeet: number | null;
    /** A dormer: its face's eaves (the top of its side walls). A turret: its roof's eave. */
    eaveFeet: number;
    /** The wall's own top under it, where the roof starts; null where the trace drew none there. */
    wallTopFeet: number | null;
  };
  /** Its own pitch, read off its face or its outline: a slope reads true at any distance. Null where not seen: a shed dormer. */
  pitch: number | null;
  slopes?: [number, number];
  /** A many-sided turret: how many sides all round. */
  sideCount?: number;
  /** The phone that saw it: its foot on the wall's plane, and how far out from it. Null when not known: its size is then read as if on the wall. */
  camera: { alongFeet: number; upFeet: number; distanceFeet: number } | null;
  /** Changed by hand on the roof pane: the estimator's own piece (`RoofPiece.id`) stands in its place while it is there. */
  typedAs?: string;
}

export const PHOTO_PIECE_LABEL: Record<PhotoPieceKind, string> = {
  gableDormer: "Gable dormer",
  shedDormer: "Shed dormer",
  roundTurret: "Round turret",
  polygonTurret: "Many-sided turret",
};

/** A piece read off the photo, before it is ticked. */
export interface ProposedPiece {
  key: string;
  piece: Omit<PhotoPiece, "id" | "taken">;
  /** It holds together: ticked to start with. */
  agree: boolean;
  /** As seen, for the drawing over the photo, in the side's feet. */
  outline: Pt[];
  checks: string[];
  notes: string;
}

/** The wall top's height at x along (feet), where the line reaches it. */
function wallTopAt(line: readonly Pt[] | null, xFeet: number): number | null {
  if (!line || line.length < 2) return null;
  const first = line[0] as Pt;
  const last = line[line.length - 1] as Pt;
  if (xFeet < first.x - 0.5 || xFeet > last.x + 0.5) return null;
  if (xFeet <= first.x) return first.y;
  if (xFeet >= last.x) return last.y;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Pt;
    const b = line[i] as Pt;
    if (xFeet >= a.x && xFeet <= b.x) return b.x === a.x ? Math.max(a.y, b.y) : a.y + ((b.y - a.y) * (xFeet - a.x)) / (b.x - a.x);
  }
  return null;
}

const feetOf = (p: Seen): Pt => ({ x: p.alongM * FEET_PER_METRE, y: p.upM * FEET_PER_METRE });
const inFeet = (m: number) => m * FEET_PER_METRE;
const pitchWords = (v: number) => `${Math.round(v * 10) / 10}/12`;

/**
 * The dormers and turrets the trace saw on this side, as proposals: [wallTop] the side's wall top in
 * its feet (the trace's), [cameraAt] the phone behind each point of the image (null when not known).
 */
export function readPieces(dormers: DormerLines[], turrets: TurretLines[], wallTop: readonly Pt[] | null, cameraAt: CameraAt | null): { pieces: ProposedPiece[]; checks: string[] } {
  const out: ProposedPiece[] = [];
  const said: string[] = [];
  const cameraOf = (p: Seen) => {
    const c = cameraAt ? cameraAt(p) : null;
    return c ? { alongFeet: inFeet(c.alongM), upFeet: inFeet(c.upM), distanceFeet: inFeet(c.distanceM) } : null;
  };
  dormers.forEach((d, i) => {
    const key = `dormer-${i}`;
    const checks: string[] = [];
    if (d.kind === "hipped" || d.kind === "other") {
      // No piece to propose: said, so the estimator can put it in by hand.
      said.push(`The trace saw a ${d.kind === "hipped" ? "hipped dormer" : "dormer"} it can't read as a gable or shed one${d.notes ? ` (${d.notes})` : ""}: put it in by hand, + Add a roof piece…, Other.`);
      return;
    }
    const top = d.faceTop;
    if (top.length < 2) return;
    const left = top[0] as Seen;
    const right = top[top.length - 1] as Seen;
    const widthM = right.alongM - left.alongM;
    if (!(inFeet(widthM) >= WIDTH_MIN_FEET && inFeet(widthM) <= WIDTH_MAX_FEET)) return;
    const middle = { alongM: (left.alongM + right.alongM) / 2, upM: (left.upM + right.upM) / 2 };
    const eaveM = (left.upM + right.upM) / 2;
    // The apron: level, under the face; its two ends' mean.
    const apronM = d.apron.length > 0 ? d.apron.reduce((s, p) => s + p.upM, 0) / d.apron.length : null;
    if (apronM !== null && !(apronM < eaveM - 0.05)) checks.push("The dormer's foot was traced at or above its eaves: its projection can't be read.");
    let pitch: number | null = null;
    let slopes: [number, number] | undefined;
    let agree = apronM !== null && apronM < eaveM - 0.05;
    if (d.kind === "gable") {
      // The face's peak: its highest point between its corners, and each slope over its whole run.
      const peak = top.slice(1, -1).reduce<Seen | null>((m, p) => (m === null || p.upM > m.upM ? p : m), null);
      if (peak && peak.upM > Math.max(left.upM, right.upM) + 0.05) {
        const l = ((peak.upM - left.upM) / (peak.alongM - left.alongM)) * 12;
        const r = ((peak.upM - right.upM) / (right.alongM - peak.alongM)) * 12;
        slopes = [l, r];
        const read = (l + r) / 2;
        pitch = framedPitch(read);
        if (Math.abs(l - r) > SLOPES_AGREE_IN_12) {
          agree = false;
          checks.push(`The dormer's two slopes read ${l.toFixed(1)} and ${r.toFixed(1)} on 12: a gable's are alike, so its peak is likely traced off.`);
        } else if (pitch !== Math.round(pitch)) {
          agree = false;
          checks.push(`The dormer's slopes read ${read.toFixed(1)} on 12, between whole pitches: check it, or type its pitch.`);
        }
      } else {
        agree = false;
        checks.push("The trace calls it a gable dormer, but its face top has no peak: check it.");
      }
    } else {
      checks.push("A shed dormer's own slope runs away from the photo: type its projection and its pitch.");
    }
    const camera = cameraOf(middle);
    if (!camera) {
      agree = false;
      checks.push("Where the phone stood isn't known for this photo, so how far back the dormer stands, and so its size, can't be read.");
    }
    if (apronM === null) {
      agree = false;
      checks.push("Where the dormer's face meets the roof below it is hidden, so how far back it stands can't be read: check its width, and type its projection.");
    }
    const outline = [...(d.apron.length > 0 ? [feetOf(d.apron[0] as Seen)] : []), ...top.map(feetOf), ...(d.apron.length > 1 ? [feetOf(d.apron[d.apron.length - 1] as Seen)] : [])];
    out.push({
      key,
      piece: {
        kind: d.kind === "gable" ? "gableDormer" : "shedDormer",
        alongFeet: inFeet(middle.alongM),
        seen: { widthFeet: inFeet(widthM), apronFeet: apronM === null ? null : inFeet(apronM), eaveFeet: inFeet(eaveM), wallTopFeet: wallTopAt(wallTop, inFeet(middle.alongM)) },
        pitch,
        ...(slopes ? { slopes } : {}),
        camera,
      },
      agree,
      outline,
      checks,
      notes: d.notes,
    });
  });
  turrets.forEach((t, i) => {
    const key = `turret-${i}`;
    const checks: string[] = [];
    if (!t.wallLeft || !t.wallRight || !t.apex || !t.roofLeft || !t.roofRight) return;
    const widthM = Math.abs(t.wallRight.alongM - t.wallLeft.alongM);
    if (!(inFeet(widthM) >= WIDTH_MIN_FEET && inFeet(widthM) <= WIDTH_MAX_FEET)) return;
    const l = ((t.apex.upM - t.roofLeft.upM) / (t.apex.alongM - t.roofLeft.alongM)) * 12;
    const r = ((t.apex.upM - t.roofRight.upM) / (t.roofRight.alongM - t.apex.alongM)) * 12;
    if (!(l > 0 && r > 0)) return;
    const read = (l + r) / 2;
    let agree = true;
    if (Math.abs(l - r) > SLOPES_AGREE_IN_12) {
      agree = false;
      checks.push(`The turret's roof reads ${l.toFixed(1)} and ${r.toFixed(1)} on 12 either side: its apex or its eave is likely traced off.`);
    }
    const sides = t.kind === "many_sided" ? t.sides : 0;
    if (t.kind === "many_sided" && !(sides >= 3 && sides <= 24)) {
      agree = false;
      checks.push("How many sides the turret has wasn't said: type it.");
    }
    checks.push("Its width is read as if it stood on the wall's line: one standing out in front of the wall shows a little bigger than it is. Check it.");
    if (t.kind === "many_sided") checks.push("A many-sided turret's outline can be along its hips, which read flatter than its faces: check its pitch.");
    const middle = { alongM: (t.wallLeft.alongM + t.wallRight.alongM) / 2, upM: (t.wallLeft.upM + t.wallRight.upM) / 2 };
    out.push({
      key,
      piece: {
        kind: t.kind === "many_sided" ? "polygonTurret" : "roundTurret",
        alongFeet: inFeet(middle.alongM),
        seen: { widthFeet: inFeet(widthM), apronFeet: null, eaveFeet: inFeet(middle.upM), wallTopFeet: null },
        pitch: framedPitch(read),
        slopes: [l, r],
        ...(t.kind === "many_sided" && sides >= 3 ? { sideCount: sides } : {}),
        camera: cameraOf(middle),
      },
      agree,
      outline: [t.roofLeft, t.apex, t.roofRight].map(feetOf),
      checks,
      notes: t.notes,
    });
  });
  return { pieces: out, checks: said };
}

/** What a photo piece comes to on the roof as built, and what the estimator should know of it. */
export interface ResolvedPhotoPiece {
  piece: RoofPiece;
  /** How far back from the wall a dormer's face was read to stand; null when it couldn't be. */
  setBackFeet: number | null;
  checks: string[];
}

/**
 * A photo piece as a roof piece (lib/roofPieces.ts), on a slope of [slopePitch] (rise in 12, the roof's
 * over that side as built) under an eave overhang of [eaveOverhangFeet]. [mainPitch] is the roof's:
 * a slope at it leaves the piece's "on a slope of" blank, as one typed would be. Its numbers are worked
 * out each time the roof is, so a pitch ticked or typed later carries into it (see the head of the file).
 */
export function resolvePhotoPiece(pp: PhotoPiece, slopePitch: number, eaveOverhangFeet: number, mainPitch: number = slopePitch): ResolvedPhotoPiece {
  const checks: string[] = [];
  const base: RoofPiece = { id: pp.id, kind: pp.kind, source: "photos", taken: pp.taken };
  const s = pp.seen;
  if (pp.kind === "roundTurret") return { piece: { ...base, diameterFeet: s.widthFeet, pitch: pp.pitch }, setBackFeet: null, checks };
  if (pp.kind === "polygonTurret") {
    const n = pp.sideCount ?? null;
    // Across its flats, as a turret square to the street shows: each side is that times tan(π/n).
    return { piece: { ...base, sideCount: n, sideFeet: n !== null && n >= 3 ? s.widthFeet * Math.tan(Math.PI / n) : null, pitch: pp.pitch }, setBackFeet: null, checks };
  }
  const m = slopePitch / 12;
  const onPitch = Math.abs(slopePitch - mainPitch) < 1e-9 ? null : slopePitch;
  const cam = pp.camera;
  let setBack: number | null = null;
  if (cam && s.apronFeet !== null && s.wallTopFeet !== null && m > 0) {
    // The slope rises from the eave's fascia: [z0] is it carried back to the wall's face.
    const z0 = s.wallTopFeet + ROOF_OVER_SOFFIT_FEET + m * eaveOverhangFeet;
    const D = cam.distanceFeet;
    const u = s.apronFeet;
    const den = m - (u - cam.upFeet) / D;
    const b = den > 1e-9 ? (u - z0) / den : Number.NaN;
    // How far an inch of the trace moves b, and so the size: d b / d u = (m - (z0 - cu)/D) / den².
    const perInch = den > 1e-9 ? Math.abs((m - (z0 - cam.upFeet) / D) / (den * den)) / 12 / (D + Math.max(0, b)) : Infinity;
    if (!(b > -0.5 && b < SET_BACK_MAX_FEET)) checks.push(`How far back the dormer stands didn't come out (${Number.isFinite(b) ? `${b.toFixed(1)}'` : "no answer"} at the slope's ${pitchWords(slopePitch)}): is the roof's pitch right? Check its width and type its projection.`);
    else if (perInch > SCALE_PER_INCH_MAX) checks.push(`From where the phone stood the ${pitchWords(slopePitch)} slope is seen almost edge-on, so how far back the dormer stands can't be read well: check its width and its projection.`);
    else setBack = Math.max(0, b);
  }
  const k = cam && setBack !== null ? (cam.distanceFeet + setBack) / cam.distanceFeet : 1;
  const widthFeet = s.widthFeet * k;
  if (setBack === null) checks.push("Its width is read as if its face were on the wall's line: it stands back on the roof, so it is a little wider than that.");
  if (pp.kind === "shedDormer") return { piece: { ...base, widthFeet, projectionFeet: null, pitch: null, onPitch }, setBackFeet: setBack, checks };
  // A gable dormer's eaves stand m × its projection over the slope at its face.
  const cheek = s.apronFeet !== null && setBack !== null ? (s.eaveFeet - s.apronFeet) * k : null;
  const projectionFeet = cheek !== null && cheek > 0 && m > 0 ? cheek / m : null;
  return { piece: { ...base, widthFeet, projectionFeet, pitch: pp.pitch, onPitch }, setBackFeet: setBack, checks };
}

// ---------------------------------------------------------------------------------------------
// Two storeys
// ---------------------------------------------------------------------------------------------

export type UpperShown = "flush" | "setBack" | "none";

/** What the photo says stands over the side, before it is ticked. */
export interface ProposedStoreys {
  /** An upper floor flush over the side, set back behind a roof, or none; null when the photo can't say. */
  upper: UpperShown | null;
  /** On a flush wall, the upper floor's floor line, feet up from the side's level; null where not seen. */
  floorLineFeet: number | null;
  /** Set back: the roof from the side up to the upper floor's wall. */
  lowerRoof: LowerRoofKind | null;
  /** Each read holds together: ticked to start with. */
  agree: { upper: boolean; floorLine: boolean; lowerRoof: boolean };
  checks: string[];
  notes: string;
}

/** Below this, a wall's eave is one storey's; at or over it (lib/exteriorPlan.ts `TALL_SIDE_FEET`), two. */
const TALL_EAVE_FEET = 14;

/**
 * The storeys over the side, out of the trace's answer: [over] what the roof over the side does as the
 * trace read it, [eaveFeet] the wall's own top at its middle (the trace's), to check the two against.
 */
export function readStoreys(wire: Partial<StoreysWire> | null | undefined, toM: ToSeen, over: "gable" | "hip" | "eave" | null, eaveFeet: number | null): ProposedStoreys | null {
  if (!wire) return null;
  const said = wordOf(wire.upper_floor, UPPER_FLOOR_SAID);
  const upper: UpperShown | null = said === "flush" ? "flush" : said === "set_back" ? "setBack" : said === "none" ? "none" : null;
  const checks: string[] = [];
  const agree = { upper: upper !== null, floorLine: true, lowerRoof: true };
  let floorLineFeet: number | null = null;
  if (upper === "flush") {
    const pts = pointsOf(wire.floor_line).map(toM).filter((p): p is Seen => p !== null);
    if (pts.length > 0) {
      floorLineFeet = inFeet(pts.reduce((s, p) => s + p.upM, 0) / pts.length);
      // A floor line is a storey up: not at the ground, not at the eave.
      if (!(floorLineFeet >= 6) || (eaveFeet !== null && floorLineFeet > eaveFeet - 6)) {
        checks.push(`The upper floor's floor line was read ${Math.round(floorLineFeet * 10) / 10}' up, which is no storey's height: it is left out.`);
        floorLineFeet = null;
      }
    }
    if (eaveFeet !== null && eaveFeet < TALL_EAVE_FEET - 1) {
      agree.upper = false;
      checks.push(`The photo shows an upper floor flush over this side, but its wall top reads ${Math.round(eaveFeet * 10) / 10}' up, one storey's: check the photo, or the wall top.`);
    }
  }
  if (upper === "none" && eaveFeet !== null && eaveFeet >= TALL_EAVE_FEET) {
    agree.upper = false;
    checks.push(`The photo shows no upper floor, but the wall top reads ${Math.round(eaveFeet * 10) / 10}' up, two storeys': check it.`);
  }
  let lowerRoof: LowerRoofKind | null = null;
  if (upper === "setBack") {
    const kind = wordOf(wire.lower_roof, LOWER_ROOF_SAID);
    lowerRoof = kind === "lean_to" ? "leanto" : kind === "ridge_out" ? "tent" : null;
    // The roof over the side says the same: a lean-to's eave runs along the side; a ridge out from the wall ends in a gable (or hip) over it.
    if (lowerRoof === "leanto" && over !== null && over !== "eave") {
      agree.lowerRoof = false;
      checks.push(`The roof up to the upper floor reads as a lean-to, but the roof over this side as a ${over} end: one of the two is off.`);
    } else if (lowerRoof === "tent" && over === "eave") {
      agree.lowerRoof = false;
      checks.push("The roof up to the upper floor reads as a ridge running out from it, but the roof over this side as an eave: one of the two is off.");
    }
  }
  return { upper, floorLineFeet, lowerRoof, agree, checks, notes: String(wire.notes ?? "").trim() };
}

export const UPPER_SHOWN_WORDS: Record<UpperShown, string> = {
  flush: "an upper floor flush over it",
  setBack: "an upper floor set back over it, behind a roof",
  none: "no upper floor over it",
};

export const LOWER_ROOF_WORDS: Record<LowerRoofKind, string> = {
  leanto: "a lean-to, one slope up to the upper floor's wall",
  tent: "a ridge running out from the upper floor's wall, its gable over this side",
};

// ---------------------------------------------------------------------------------------------
// Kept on the side: scaled with it, moved with it
// ---------------------------------------------------------------------------------------------

/** A roof read's photo pieces and floor line with every length times [k], as the side is scaled. A pitch is a ratio. */
export function scaledRoofRead(read: SideRoofRead, k: number): SideRoofRead {
  const out = { ...read };
  if (typeof out.floorLineFeet === "number") out.floorLineFeet *= k;
  if (out.pieces) {
    out.pieces = out.pieces.map((p) => ({
      ...p,
      alongFeet: p.alongFeet * k,
      seen: {
        widthFeet: p.seen.widthFeet * k,
        apronFeet: p.seen.apronFeet === null ? null : p.seen.apronFeet * k,
        eaveFeet: p.seen.eaveFeet * k,
        wallTopFeet: p.seen.wallTopFeet === null ? null : p.seen.wallTopFeet * k,
      },
      camera: p.camera ? { alongFeet: p.camera.alongFeet * k, upFeet: p.camera.upFeet * k, distanceFeet: p.camera.distanceFeet * k } : null,
    }));
  }
  return out;
}

/**
 * A roof read moved onto another side's frame, [along] and [up] feet off this one's (a tall side split
 * at the floor line: the upper side's left end is [along] along this one, its level [up] up). Where the
 * pieces are, and where the phone stood, move with it; the floor line is spent once split.
 */
export function shiftedRoofRead(read: SideRoofRead, along: number, up: number): SideRoofRead {
  const out = { ...read };
  delete out.floorLineFeet;
  if (out.pieces) {
    out.pieces = out.pieces.map((p) => ({
      ...p,
      alongFeet: p.alongFeet - along,
      seen: {
        widthFeet: p.seen.widthFeet,
        apronFeet: p.seen.apronFeet === null ? null : p.seen.apronFeet - up,
        eaveFeet: p.seen.eaveFeet - up,
        wallTopFeet: p.seen.wallTopFeet === null ? null : p.seen.wallTopFeet - up,
      },
      camera: p.camera ? { alongFeet: p.camera.alongFeet - along, upFeet: p.camera.upFeet - up, distanceFeet: p.camera.distanceFeet } : null,
    }));
  }
  return out;
}
