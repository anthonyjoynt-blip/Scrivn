/**
 * The outside of the house made by hand, on the plan (2026-10-13): what the exterior's plan screen
 * does to the model in lib/exterior.ts, kept pure so test:exterior holds it.
 *
 * The owner, the first time he tried the exterior: "Outside of the house is rectangle or L shaped?"
 * A typed rectangle or L was the only way in. Now there are three, and each ends in the same model -
 * sides in order round the house, each with its length and the corner at its right-hand end:
 *
 *   * DRAWN: the corners tapped on the plan, as the interior's Wall tool draws a room. Every wall is
 *     square to the last one, on a one-foot grid, and the outline closes on its first corner. Each
 *     wall is a side, named by the way it faces (`exteriorFromOutline`). Its length is the drawing's
 *     until one is typed (`lengthFrom: "drawn"`).
 *   * WALKED: the front's length typed, then each next side round the house with its turn and its
 *     length (`startWalk`, `withNextSide`), as the estimator walks it with a tape. Open until it is
 *     back at the start (`walkState`, `closeWalk`).
 *   * A Scrivn Scan walk, which lands in the same sides (lib/exteriorImport.ts).
 *
 * ── A typed length ─────────────────────────────────────────────────────────────────────────────
 * Typing a side's length moves the corner at its right-hand end, as typing a room's wall moves the
 * wall hanging off it (lib/sketch.ts `withWallLength`): everything of the outline from there on
 * slides along the side, and the sides running the same way across that line - the rear of a
 * rectangle when the front was typed - stretch with it. Only a DRAWN side stretches: one typed or
 * taped keeps its length, and the gap two different tapes leave is shared out by the footprint as it
 * always was ("the sides as typed missed meeting by ..."). So front and rear taped 40'2" and 39'10"
 * come out 40'0" each, said, while a rear only drawn simply follows the front.
 *
 * Plan feet, y UP, the front along the bottom; walking round to the right along the faces is
 * counter-clockwise from above, an outside corner a left turn and an inside one a right turn.
 */

import {
  bandRanges,
  clipRect,
  DEFAULT_EAVE_FEET,
  defaultRoof,
  type Exterior,
  type ExteriorRoof,
  type ExteriorSide,
  exteriorFootprint,
  type Footprint,
  newSide,
  type SideTurn,
  UPPER_SNAP_FEET,
  UPPER_STOREY_FEET,
  upperFootprint,
  type UpperFloor,
  zFromGrade,
} from "./exterior";
import { polygonArea, type Pt, type RoofAddition, type RoofBreak, type RoofEndKind, type RoofPlan } from "./roof";
import type { RoofPiece, RoofPieceKind } from "./roofPieces";
import { photoCoverageM, photoOnPart } from "./exteriorPhoto";
import { type PhotoPiece, shiftedRoofRead } from "./roofPhotoShapes";
import { newSketchId } from "./sketch";

/** A foot in metres: a side's photos are laid on it in metres. */
const FOOT_M = 0.3048;

/** No side is shorter than this: half a foot. */
export const MIN_SIDE_FEET = 0.5;

const EPS = 1e-6;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
/** The way on after an outside corner (a left turn) and after an inside one (a right turn). */
const afterTurn = (d: Pt, turn: SideTurn): Pt => (turn === "outside" ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x });

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

export type Facing = "Front" | "Right" | "Rear" | "Left";

/** Which way a wall walked along `d` faces: out of a counter-clockwise outline is `d` turned right. */
export function facingOf(d: Pt): Facing {
  const n = { x: d.y, y: -d.x };
  if (Math.abs(n.y) >= Math.abs(n.x)) return n.y < 0 ? "Front" : "Rear";
  return n.x > 0 ? "Right" : "Left";
}

/** The first name free for a wall facing that way: "Front", then "Front 2", "Front 3"... */
export function nextFacingName(facing: Facing, taken: string[]): string {
  const used = new Set(taken.map((t) => t.trim()));
  if (!used.has(facing)) return facing;
  for (let k = 2; ; k++) if (!used.has(`${facing} ${k}`)) return `${facing} ${k}`;
}

// ---------------------------------------------------------------------------------------------
// The outline drawn on the plan
// ---------------------------------------------------------------------------------------------

/**
 * Where a tap lands on the outline being drawn: on the foot grid, and square to the last wall - the
 * first wall whichever way it mostly goes, every one after it across the one before, so each corner
 * is a corner of the house and none is a wall carried straight on.
 */
export function snapOutlinePoint(raw: Pt, draft: Pt[], gridFeet = 1, lines?: { xs: number[]; ys: number[] }): Pt {
  // On a line of what is traced over (the main floor, under an upper floor being drawn) when within a foot of one; else the grid.
  const onLine = (v: number, list: number[] | undefined) => list?.filter((l) => Math.abs(l - v) <= UPPER_SNAP_FEET).sort((a, b) => Math.abs(a - v) - Math.abs(b - v))[0];
  const g = (v: number, list?: number[]) => onLine(v, list) ?? Math.round(v / gridFeet) * gridFeet;
  const p = { x: g(raw.x, lines?.xs), y: g(raw.y, lines?.ys) };
  const last = draft[draft.length - 1];
  if (!last) return p;
  const prev = draft[draft.length - 2];
  const horizontal = prev ? Math.abs(last.x - prev.x) < EPS : Math.abs(p.x - last.x) >= Math.abs(p.y - last.y);
  return horizontal ? { x: p.x, y: last.y } : { x: last.x, y: p.y };
}

/** Whether two closed segments, each level or upright, meet anywhere. */
function segmentsMeet(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const box = (p: Pt, q: Pt) => ({ x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) });
  const r = box(a, b);
  const s = box(c, d);
  return r.x0 <= s.x1 + EPS && s.x0 <= r.x1 + EPS && r.y0 <= s.y1 + EPS && s.y0 <= r.y1 + EPS;
}

/**
 * An outline as the footprint takes one: no corner twice, none on a straight wall, every wall level
 * or upright, nothing crossing, counter-clockwise. Null when the corners can't be one.
 */
export function orthogonalRing(points: Pt[]): Pt[] | null {
  let ring = points.filter((p, i) => {
    const q = points[(i + 1) % points.length] as Pt;
    return Math.abs(p.x - q.x) > EPS || Math.abs(p.y - q.y) > EPS;
  });
  // A corner on a straight wall, or a wall doubling back on itself, is no corner: take it out until none is left.
  for (let changed = true; changed && ring.length >= 3; ) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i - 1 + ring.length) % ring.length] as Pt;
      const b = ring[i] as Pt;
      const c = ring[(i + 1) % ring.length] as Pt;
      const zero = Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
      if (zero || Math.abs(cross({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - b.x, y: c.y - b.y })) < EPS) {
        ring = ring.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  const n = ring.length;
  if (n < 4) return null;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % n] as Pt;
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) return null;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsMeet(ring[i] as Pt, ring[(i + 1) % n] as Pt, ring[j] as Pt, ring[(j + 1) % n] as Pt)) return null;
    }
  }
  let twice = 0;
  for (let i = 0; i < n; i++) twice += cross(ring[i] as Pt, ring[(i + 1) % n] as Pt);
  if (Math.abs(twice) / 2 < 1) return null;
  return twice > 0 ? ring : [...ring].reverse();
}

/**
 * The outline closed from the corners drawn so far. The wall that closes it runs across the last one.
 * A last corner within `snapFeet` of lining up with the first slides along its wall to line up, so
 * the closing wall goes straight to the first corner; otherwise the corner it turns at on the way is
 * added, and a first corner left on a straight wall is taken out. Null with fewer than three
 * corners, or when the outline would cross itself.
 */
export function closeOutline(draft: Pt[], snapFeet = 0): Pt[] | null {
  if (draft.length < 3) return null;
  const first = draft[0] as Pt;
  const last = draft[draft.length - 1] as Pt;
  const prev = draft[draft.length - 2] as Pt;
  const lastUpright = Math.abs(last.x - prev.x) < EPS;
  const head = draft.slice(0, -1);
  if (lastUpright && Math.abs(last.y - first.y) <= snapFeet) return orthogonalRing([...head, { x: last.x, y: first.y }]);
  if (!lastUpright && Math.abs(last.x - first.x) <= snapFeet) return orthogonalRing([...head, { x: first.x, y: last.y }]);
  const elbow = lastUpright ? { x: first.x, y: last.y } : { x: last.x, y: first.y };
  return orthogonalRing([...draft, elbow]);
}

/**
 * An exterior from an outline drawn on the plan: each wall a side, in order round the house to the
 * right from the FRONT - the wall facing the street (the bottom of the plan) that stands nearest it,
 * the longest of those level with it - each as long as it was drawn and named by the way it faces.
 * Of the walls facing one way the outermost has the plain name - "Rear" is the back of the house,
 * not the back of a notch - and the rest are numbered from the outside in.
 */
/** The wall of an outline that is its front: facing the street, nearest it, the longest of those level with it. -1 for none. */
function frontOf(ring: Pt[]): number {
  const n = ring.length;
  const wall = (i: number) => ({ a: ring[i] as Pt, b: ring[(i + 1) % n] as Pt });
  let front = -1;
  for (let i = 0; i < n; i++) {
    const { a, b } = wall(i);
    if (!(b.x - a.x > EPS && Math.abs(b.y - a.y) < EPS)) continue;
    if (front < 0) {
      front = i;
      continue;
    }
    const f = wall(front);
    if (a.y < f.a.y - EPS || (Math.abs(a.y - f.a.y) < EPS && b.x - a.x > f.b.x - f.a.x + EPS)) front = i;
  }
  return front;
}

export function exteriorFromOutline(drawn: Pt[], eaveFeet: number = DEFAULT_EAVE_FEET): Exterior | null {
  const ring = orthogonalRing(drawn);
  if (!ring) return null;
  const n = ring.length;
  const wall = (i: number) => ({ a: ring[i] as Pt, b: ring[(i + 1) % n] as Pt });
  const front = frontOf(ring);
  if (front < 0) return null;
  const walls = ring.map((_, k) => {
    const { a, b } = wall((front + k) % n);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const facing = facingOf(d);
    // How far out it stands the way it faces: the front lowest, the rear highest, and so on.
    const out = facing === "Front" ? -a.y : facing === "Rear" ? a.y : facing === "Right" ? a.x : -a.x;
    return { length, d, facing, out };
  });
  const names = walls.map((w, k) => {
    // Furthest out first, the longer of two level with each other, then round from the front.
    const same = walls
      .map((v, j) => ({ v, j }))
      .filter(({ v }) => v.facing === w.facing)
      .sort((p, q) => (Math.abs(q.v.out - p.v.out) > EPS ? q.v.out - p.v.out : Math.abs(q.v.length - p.v.length) > EPS ? q.v.length - p.v.length : p.j - q.j));
    const rank = same.findIndex(({ j }) => j === k);
    return rank === 0 ? w.facing : `${w.facing} ${rank + 1}`;
  });
  const sides = walls.map((w, k) => {
    const next = walls[(k + 1) % n] as (typeof walls)[number];
    const turn: SideTurn = cross(w.d, next.d) > 0 ? "outside" : "inside";
    return { ...newSide(names[k] as string, w.length, eaveFeet, turn), lengthFrom: "drawn" as const };
  });
  return { sides, roof: defaultRoof() };
}

// ---------------------------------------------------------------------------------------------
// The upper floor of a two-storey house (2026-10-14)
// ---------------------------------------------------------------------------------------------

/**
 * An upper floor from an outline drawn over the main floor's: its walls are sides named as the main
 * floor's are, "Upper front" and so on, each 9' from the floor line to its eave, and it is placed by
 * the main floor's corner nearest its first one - so retyping a main-floor length far from it leaves
 * it be. Null when the corners can't be an outline.
 */
export function upperFromOutline(drawn: Pt[], main: Footprint, eaveFeet: number = UPPER_STOREY_FEET): UpperFloor | null {
  const made = exteriorFromOutline(drawn, eaveFeet);
  const ring = orthogonalRing(drawn);
  if (!made || !ring || !main.closes || main.corners.length === 0) return null;
  const start = ring[frontOf(ring)] as Pt;
  let k = 0;
  main.corners.forEach((c, i) => {
    if (Math.hypot(c.x - start.x, c.y - start.y) < Math.hypot((main.corners[k] as Pt).x - start.x, (main.corners[k] as Pt).y - start.y)) k = i;
  });
  const corner = main.corners[k] as Pt;
  const sides = made.sides.map((s) => ({ ...s, name: `Upper ${s.name.charAt(0).toLowerCase()}${s.name.slice(1)}`, base: "grade" as const }));
  return { sides, at: { sideId: main.sideIds[k] as string, dx: start.x - corner.x, dy: start.y - corner.y } };
}

/** An upper floor's side typed to a length, as a main-floor side is (`withSideLength`): its own outline moves, the main floor's stays. */
export function withUpperSideLength(exterior: Exterior, sideId: string, feet: number): Exterior {
  const up = exterior.upper;
  if (!up) return exterior;
  const done = withSideLength({ sides: up.sides, roof: exterior.roof }, sideId, feet);
  return { ...exterior, upper: { ...up, sides: done.sides }, roof: done.roof };
}

/** The upper floor taken off: its sides, and what the roof said about them. */
export function withoutUpper(exterior: Exterior): Exterior {
  const ids = new Set((exterior.upper?.sides ?? []).map((s) => s.id));
  const out: Exterior = { ...exterior, roof: roofWithoutSides(exterior.roof, (id) => ids.has(id)) };
  delete out.upper;
  if (out.scope) out.scope = { ...out.scope, sides: out.scope.sides.filter((id) => !ids.has(id)) };
  return out;
}

/**
 * A main-floor side whose eave reads this high or more was likely measured up to the upper floor's
 * eave - a two-storey wall as one tall side, as Scrivn Scan walks a two-storey house.
 */
export const TALL_SIDE_FEET = 14;

/** A tall main-floor side, and the upper sides over it: each by where its left corner is along the main side. */
export interface TallSide {
  sideId: string;
  name: string;
  /** Its eave as read, the higher corner. */
  eaveFeet: number;
  over: { sideId: string; fromFeet: number; lengthFeet: number }[];
}

/**
 * The main-floor sides an upper floor stands on that read as tall sides (`TALL_SIDE_FEET`): each with
 * the upper sides flush over it - on its wall's line, facing its way - which take what is above the
 * floor line when it is split (`splitTallSides`).
 */
export function tallSides(exterior: Exterior): TallSide[] {
  if (!exterior.upper) return [];
  const main = exteriorFootprint(exterior);
  const up = upperFootprint(exterior, main);
  if (!main.closes || !up?.closes) return [];
  const n = main.corners.length;
  const m = up.corners.length;
  const out: TallSide[] = [];
  exterior.sides.forEach((side, i) => {
    const eave = Math.max(side.eaveLeftFeet ?? 0, side.eaveRightFeet ?? side.eaveLeftFeet ?? 0);
    if (eave < TALL_SIDE_FEET) return;
    const a = main.corners[i] as Pt;
    const b = main.corners[(i + 1) % n] as Pt;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const over: TallSide["over"] = [];
    up.sideIds.forEach((id, j) => {
      const p = up.corners[j] as Pt;
      const q = up.corners[(j + 1) % m] as Pt;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      // The same way along, on the same line, and overlapping it.
      if (len < EPS || dot({ x: (q.x - p.x) / len, y: (q.y - p.y) / len }, d) < 1 - 1e-6 || Math.abs(cross(d, { x: p.x - a.x, y: p.y - a.y })) > 1e-4) return;
      const from = dot({ x: p.x - a.x, y: p.y - a.y }, d);
      if (Math.min(L, from + len) - Math.max(0, from) > 0.01) over.push({ sideId: id, fromFeet: from, lengthFeet: len });
    });
    if (over.length > 0) out.push({ sideId: side.id, name: side.name.trim() || "Side", eaveFeet: eave, over });
  });
  return out;
}

/**
 * Tall sides split at the floor line (2026-10-15), with one height said once: the floor line, the top
 * of the main floor's walls, this far above the grade. Each tall side's eave is set to it, keeping the
 * fall of the ground between its corners (one level - a side the phone walked - both at it), and what
 * is above it goes onto the upper side over it, measured from the floor line: the cladding above (its
 * bands, or the phone's shapes cut at the line), the openings whose middle is over the line, the gable
 * as measured, the roofline, and the roof read off the side - the roof is the upper floor's now - onto
 * the upper side its peak is over. Its photos show both storeys: each stays on the main side, and goes
 * onto the upper side too, laid on that side's own frame (`photoOnPart`), where it shows anything over
 * the line - so the upper side's elevation and any trace of it see the photo. Fixtures and doors kept
 * for sizes stay on the main side, at the ground.
 */
export function splitTallSides(exterior: Exterior, floorFeet: number): Exterior {
  const up = exterior.upper;
  const tall = tallSides(exterior);
  if (!up || tall.length === 0 || !(floorFeet > 0)) return exterior;
  const uppers = new Map(up.sides.map((s) => [s.id, s]));
  const mains = new Map(exterior.sides.map((s) => [s.id, s]));
  for (const t of tall) {
    const S = mains.get(t.sideId) as ExteriorSide;
    const level = S.heightsFrom === "level";
    const L = Math.max(S.lengthFeet, EPS);
    const eL = S.eaveLeftFeet ?? floorFeet;
    const eR = S.eaveRightFeet ?? eL;
    // The floor line on the side's own frame (z = 0 at the ground under its left corner, or the one level): where its eave goes.
    const newLeft = level ? floorFeet : floorFeet - (eR - eL) / 2;
    const newRight = level ? floorFeet : floorFeet + (eR - eL) / 2;
    const Fz = newLeft;
    // The old eave line along it: level on a taped side, as read at each end on one the phone walked.
    const eaveZ = (x: number) => (level ? eL + ((eR - eL) * x) / L : eL);
    if (eaveZ(0) <= Fz + EPS && eaveZ(L) <= Fz + EPS) continue;
    const ranges = bandRanges(S, eL);
    let openings = S.openings;
    let shapes = S.shapes;
    let roofline = S.roofline;
    let gable = S.gable;
    // The upper side that gets what goes with the roof over the whole side - its pitch, the roof read off it: the one the roof's peak
    // is over (the roofline's highest point, else the gable's), else the one over most of it.
    const most = [...t.over].sort((p, q) => Math.min(L, q.fromFeet + q.lengthFeet) - Math.max(0, q.fromFeet) - (Math.min(L, p.fromFeet + p.lengthFeet) - Math.max(0, p.fromFeet)))[0];
    const top = (S.roofline ?? []).reduce<{ alongFeet: number; upFeet: number } | null>((b, p) => (!b || p.upFeet > b.upFeet ? p : b), null);
    const peakAt = top && top.upFeet > Fz ? top.alongFeet : S.gable ? S.gable.atFeet : null;
    const roofOver = (peakAt === null ? undefined : t.over.find((o) => peakAt >= o.fromFeet - EPS && peakAt <= o.fromFeet + o.lengthFeet + EPS)) ?? most;
    for (const o of t.over) {
      const U = uppers.get(o.sideId);
      if (!U) continue;
      const lo = o.fromFeet;
      const hi = o.fromFeet + o.lengthFeet;
      const within = (x: number) => x >= lo - EPS && x <= hi + EPS;
      // A point of the main side's frame on the upper side's: along from its left corner, up from the floor line.
      const toUpper = (p: Pt): Pt => ({ x: p.x - lo, y: p.y - Fz });
      const moving = openings.filter((w) => {
        const mid = w.fromLeftFeet + w.widthFeet / 2;
        return within(mid) && zFromGrade(S, mid, w.sillFeet) + w.heightFeet / 2 > Fz;
      });
      openings = openings.filter((w) => !moving.includes(w));
      const bands = ranges
        .filter((r) => r.hi > Fz + EPS)
        .map((r, k, list) => ({ ...r.band, id: newSketchId("band"), top: k === list.length - 1 ? null : r.band.top === "eave" ? ("eave" as const) : r.hi - Fz }));
      const above = (shapes ?? [])
        .filter((s) => s.kind !== "parging" && s.closed)
        .map((s) => ({ ...s, id: newSketchId("shape"), polygon: clipRect(s.polygon, lo, hi, Fz, Infinity).map(toUpper) }))
        .filter((s) => s.polygon.length >= 3 && polygonArea(s.polygon) > 1e-6);
      const points = (roofline ?? []).filter((p) => within(p.alongFeet) && p.upFeet > Fz);
      roofline = roofline?.filter((p) => !points.includes(p));
      const takesGable = gable !== null && within(gable.atFeet);
      // Each photo that shows this upper side above the floor line, laid on its frame.
      const photos = (S.photos ?? [])
        .filter((p) => {
          const c = photoCoverageM(p);
          return c !== null && c.upMax > Fz * FOOT_M && c.alongMax > lo * FOOT_M && c.alongMin < hi * FOOT_M;
        })
        .map((p) => photoOnPart(p, lo, Fz, o.lengthFeet, L));
      const next: ExteriorSide = {
        ...U,
        eaveLeftFeet: eaveZ(Math.max(0, lo)) - Fz,
        eaveRightFeet: eaveZ(Math.min(L, hi)) - Fz,
        ...(level ? { heightsFrom: "level" as const } : {}),
        bands: bands.length > 0 ? bands : U.bands,
        openings: [
          ...U.openings,
          ...moving.map((w) => {
            const mid = w.fromLeftFeet + w.widthFeet / 2;
            return { ...w, fromLeftFeet: w.fromLeftFeet - lo, sillFeet: Math.max(0, zFromGrade(S, mid, w.sillFeet) - Fz) };
          }),
        ],
        ...(above.length > 0 ? { shapes: [...(U.shapes ?? []), ...above] } : {}),
        ...(points.length > 0 ? { roofline: [...(U.roofline ?? []), ...points.map((p) => ({ ...p, alongFeet: p.alongFeet - lo, upFeet: p.upFeet - Fz }))] } : {}),
        ...(photos.length > 0 ? { photos: [...(U.photos ?? []), ...photos] } : {}),
      };
      if (takesGable && gable) {
        const clampTo = (v: number) => Math.min(o.lengthFeet, Math.max(0, v - lo));
        next.gable = {
          peakFeet: zFromGrade(S, gable.atFeet, gable.peakFeet) - Fz,
          atFeet: clampTo(gable.atFeet),
          ...(gable.fromFeet !== undefined ? { fromFeet: clampTo(gable.fromFeet) } : {}),
          ...(gable.toFeet !== undefined ? { toFeet: clampTo(gable.toFeet) } : {}),
        };
        gable = null;
      }
      if (o === roofOver) {
        if (S.pitchMeasured != null) next.pitchMeasured = S.pitchMeasured;
        // Its dormers, and where the phone stood, on the upper side's frame too (2026-10-15).
        if (S.roofRead) next.roofRead = shiftedRoofRead(S.roofRead, lo, Fz);
      }
      uppers.set(o.sideId, next);
    }
    // What is left on the main side: below the floor line under the upper floor, all of it past it (a garage's gable, say) - a shape cut where the upper floor starts and stops.
    const cuts = [...new Set([-Infinity, ...t.over.flatMap((o) => [o.fromFeet, o.fromFeet + o.lengthFeet]), Infinity])].sort((p, q) => p - q);
    const underUpper = (x0: number, x1: number) => t.over.some((o) => (x0 + x1) / 2 > o.fromFeet && (x0 + x1) / 2 < o.fromFeet + o.lengthFeet);
    shapes = shapes?.flatMap((s) => {
      if (s.kind === "parging" || !s.closed) return [s];
      const pieces = cuts
        .slice(0, -1)
        .map((x0, k) => {
          const x1 = cuts[k + 1] as number;
          const mid = Number.isFinite(x0) && Number.isFinite(x1) ? [x0, x1] : Number.isFinite(x0) ? [x0, x0 + 1] : [x1 - 1, x1];
          return clipRect(s.polygon, x0, x1, -Infinity, underUpper(mid[0] as number, mid[1] as number) ? Fz : Infinity);
        })
        .filter((poly) => poly.length >= 3 && polygonArea(poly) > 1e-6);
      return pieces.map((polygon, k) => ({ ...s, id: k === 0 ? s.id : newSketchId("shape"), polygon }));
    });
    const kept = ranges.filter((r) => r.lo < Fz - EPS);
    const split: ExteriorSide = {
      ...S,
      eaveLeftFeet: newLeft,
      eaveRightFeet: newRight,
      gable,
      openings,
      bands: (kept.length > 0 ? kept : ranges.slice(0, 1)).map((r, k, list) => ({ ...r.band, top: k === list.length - 1 ? null : r.band.top })),
      ...(shapes ? { shapes } : {}),
      ...(roofline ? { roofline } : {}),
    };
    if (roofOver) {
      delete split.pitchMeasured;
      delete split.roofRead;
    }
    mains.set(S.id, split);
  }
  return { ...exterior, sides: exterior.sides.map((s) => mains.get(s.id) ?? s), upper: { ...up, sides: up.sides.map((s) => uppers.get(s.id) ?? s) } };
}

// ---------------------------------------------------------------------------------------------
// Side by side round the house
// ---------------------------------------------------------------------------------------------

/** A walk round the house begun with the front's length: one side, open until it comes back. */
export function startWalk(frontFeet: number, eaveFeet: number = DEFAULT_EAVE_FEET): Exterior {
  return { sides: [newSide("Front", frontFeet, eaveFeet)], open: true, roof: defaultRoof() };
}

/**
 * The sides walked from the front's left corner with square corners, NOT closed: where each side
 * starts and the last one ends (n + 1 points), and the way each one runs.
 */
export function sideChain(sides: ExteriorSide[]): { points: Pt[]; dirs: Pt[] } {
  const points: Pt[] = [{ x: 0, y: 0 }];
  const dirs: Pt[] = [];
  let d: Pt = { x: 1, y: 0 };
  let at: Pt = { x: 0, y: 0 };
  for (const side of sides) {
    dirs.push(d);
    at = { x: at.x + d.x * side.lengthFeet, y: at.y + d.y * side.lengthFeet };
    points.push(at);
    d = afterTurn(d, side.turn);
  }
  return { points, dirs };
}

export interface WalkState {
  /** The start, and where each side ends. */
  points: Pt[];
  dirs: Pt[];
  perimeterFeet: number;
  /** From where the last side ends back to the start. */
  gapFeet: number;
  /** The corner the last side has to turn at to meet the front, or null when it runs the front's way. */
  closingTurn: SideTurn | null;
  /** With that corner, whether the corners go round: four more outside than inside. */
  turnsClose: boolean;
  /** How far off meeting is close enough to close by itself: a tape's worth over the walk. */
  toleranceFeet: number;
  /** The one more side that would bring the walk back to the start, when one would. */
  lastSide: { turn: SideTurn; lengthFeet: number; name: string } | null;
}

function closeTolerance(perimeter: number): number {
  return Math.max(1, perimeter * 0.02);
}

/** How a walk round the house stands: how far it is from closing, and how it would close. */
export function walkState(exterior: Exterior): WalkState {
  const sides = exterior.sides;
  const { points, dirs } = sideChain(sides);
  const start = points[0] as Pt;
  const end = points[points.length - 1] as Pt;
  const perimeter = sides.reduce((s, x) => s + x.lengthFeet, 0);
  const tolerance = closeTolerance(perimeter);
  const front: Pt = { x: 1, y: 0 };
  const lastDir = dirs[dirs.length - 1] ?? front;
  const turnInto = (d: Pt): SideTurn | null => {
    const c = cross(d, front);
    return Math.abs(c) < EPS ? null : c > 0 ? "outside" : "inside";
  };
  const balance = (turns: SideTurn[]) => turns.filter((t) => t === "outside").length - turns.filter((t) => t === "inside").length;
  const closingTurn = sides.length > 0 ? turnInto(lastDir) : null;
  const turnsClose = closingTurn !== null && balance([...sides.slice(0, -1).map((s) => s.turn), closingTurn]) === 4;

  let lastSide: WalkState["lastSide"] = null;
  if (sides.length >= 3) {
    const gap = { x: start.x - end.x, y: start.y - end.y };
    for (const turn of ["outside", "inside"] as SideTurn[]) {
      const d = afterTurn(lastDir, turn);
      const length = dot(gap, d);
      const off = Math.abs(cross(d, gap));
      const into = turnInto(d);
      if (length < MIN_SIDE_FEET || off > tolerance || into === null) continue;
      if (balance([...sides.slice(0, -1).map((s) => s.turn), turn, into]) !== 4) continue;
      lastSide = { turn, lengthFeet: length, name: nextFacingName(facingOf(d), sides.map((s) => s.name)) };
      break;
    }
  }
  return {
    points,
    dirs,
    perimeterFeet: perimeter,
    gapFeet: Math.hypot(end.x - start.x, end.y - start.y),
    closingTurn,
    turnsClose,
    toleranceFeet: tolerance,
    lastSide,
  };
}

/** The walk closed where it stands: the last side turned to meet the front, the gap shared out by the footprint. Null when the corners can't go round. */
export function closeWalk(exterior: Exterior): Exterior | null {
  const w = walkState(exterior);
  const last = exterior.sides[exterior.sides.length - 1];
  if (!w.turnsClose || !w.closingTurn || !last) return null;
  const closed: Exterior = { ...exterior, sides: [...exterior.sides.slice(0, -1), { ...last, turn: w.closingTurn }] };
  delete closed.open;
  return closed;
}

/**
 * How far off the start a walk may end and still close by itself: what two tapes of the same wall
 * disagree by, not a wall's worth. Within the offer's wider reach (`toleranceFeet`) it is asked - a
 * jog of a few feet still to come must not be swallowed by a walk that closes itself.
 */
function closesItselfWithin(perimeter: number): number {
  return Math.max(0.5, perimeter * 0.005);
}

/**
 * The next side round the house: the last one's corner (outside, a left turn; inside, a right one),
 * then the new side, named by the way it faces. Back within a tape's error of the start with the
 * corners going round, the walk closes by itself.
 */
export function withNextSide(exterior: Exterior, turn: SideTurn, lengthFeet: number): Exterior {
  const sides = exterior.sides;
  const last = sides[sides.length - 1];
  if (!last || !(lengthFeet >= MIN_SIDE_FEET)) return exterior;
  const d = afterTurn(sideChain(sides).dirs[sides.length - 1] as Pt, turn);
  const side = newSide(nextFacingName(facingOf(d), sides.map((s) => s.name)), lengthFeet, last.eaveRightFeet ?? last.eaveLeftFeet ?? DEFAULT_EAVE_FEET);
  const next: Exterior = { ...exterior, open: true, sides: [...sides.slice(0, -1), { ...last, turn }, side] };
  const w = walkState(next);
  return w.turnsClose && w.gapFeet <= closesItselfWithin(w.perimeterFeet) ? (closeWalk(next) ?? next) : next;
}

/**
 * A side put in after another (2026-10-13, the review): a corner the walk missed, a jog drawn as a
 * straight wall. It comes in 10' long round an outside corner, named by the way it would face; the
 * outline then needs its corners and lengths put right, and says so until they are.
 */
export function withSideAfter(exterior: Exterior, sideId: string, id?: string): Exterior {
  const i = exterior.sides.findIndex((s) => s.id === sideId);
  const at = exterior.sides[i];
  if (!at) return exterior;
  const d = afterTurn(sideChain(exterior.sides).dirs[i] as Pt, at.turn);
  const made = newSide(nextFacingName(facingOf(d), exterior.sides.map((s) => s.name)), 10, at.eaveRightFeet ?? at.eaveLeftFeet ?? DEFAULT_EAVE_FEET);
  const side = id ? { ...made, id } : made;
  return { ...exterior, sides: [...exterior.sides.slice(0, i + 1), side, ...exterior.sides.slice(i + 1)] };
}

// ---------------------------------------------------------------------------------------------
// A typed length
// ---------------------------------------------------------------------------------------------

/** A place along a side moved by `by` feet, and the side's new length, kept on the wall. */
function clampAlong(v: number, length: number): number {
  return Math.min(length, Math.max(0, v));
}

/**
 * What stands along a side, moved with the wall it is on: each point along it (`shift(f)` - an
 * opening by its middle) moves as the part of the outline it is on moves, then everything is kept on
 * the wall at its new length. An opening that would run past the end is brought back to finish there.
 */
function movedAlong(side: ExteriorSide, length: number, shift: (f: number) => number): ExteriorSide {
  const openings = side.openings.map((o) => {
    const from = o.fromLeftFeet + shift(o.fromLeftFeet + o.widthFeet / 2);
    return { ...o, fromLeftFeet: from + o.widthFeet > length ? Math.max(0, length - o.widthFeet) : Math.max(0, from) };
  });
  const gable = side.gable
    ? {
        ...side.gable,
        atFeet: clampAlong(side.gable.atFeet + shift(side.gable.atFeet), length),
        ...(side.gable.fromFeet !== undefined ? { fromFeet: clampAlong(side.gable.fromFeet + shift(side.gable.fromFeet), length) } : {}),
        ...(side.gable.toFeet !== undefined ? { toFeet: clampAlong(side.gable.toFeet + shift(side.gable.toFeet), length) } : {}),
      }
    : null;
  return { ...side, lengthFeet: length, openings, gable };
}

/** A porch or cross gable on a side, moved the same way; one along the whole side stays along it. */
function additionAlong(a: RoofAddition, before: number, length: number, shift: (f: number) => number): RoofAddition {
  const lo = Math.min(a.fromFeet, a.toFeet);
  const hi = Math.max(a.fromFeet, a.toFeet);
  if (lo <= 0.01 && hi >= before - 0.01) return { ...a, fromFeet: 0, toFeet: length };
  return { ...a, fromFeet: clampAlong(lo + shift(lo), length), toFeet: clampAlong(hi + shift(hi), length) };
}

/**
 * The exterior with one side's length typed (see the file header): the corner at its right-hand
 * end moves, and the drawn sides running its way across the line where the outline moves stretch
 * with it. Where one of those was typed or taped instead, or the outline would cross itself, the
 * next place along the side is tried; failing that, the drawn sides running its way share what is
 * left over; failing that, the typed length stands and the footprint shares the gap, as for any
 * taped sides. Whatever is kept must still be an outline: one that would cross itself is never
 * offered in place of what was typed.
 */
export function withSideLength(exterior: Exterior, sideId: string, feet: number): Exterior {
  return withUpperFollowing(exterior, mainSideLength(exterior, sideId, feet));
}

/**
 * The upper floor kept on the main floor's walls once a main-floor length is typed (2026-10-15): each
 * of its walls on a line of the main floor's walls moves with that line, so a wall flush with the one
 * below stays flush, and its sides across stretch to meet it; a wall on no line keeps its place from
 * the corner the upper floor is set by (`UpperFloor.at`). An upper side typed or taped keeps its
 * length, as a main-floor side does: a line that would stretch it leaves the upper floor as it was.
 */
function withUpperFollowing(before: Exterior, after: Exterior): Exterior {
  const up = before.upper;
  if (!up || after === before) return after;
  const was = exteriorFootprint(before);
  const now = exteriorFootprint(after);
  const placed = upperFootprint(before, was);
  const k = was.sideIds.indexOf(up.at.sideId);
  if (!was.closes || !now.closes || !placed?.closes || k < 0 || was.corners.length !== now.corners.length) return after;
  const U = placed.corners;
  const m = U.length;
  const n = was.corners.length;
  const anchor = { x: (now.corners[k] as Pt).x - (was.corners[k] as Pt).x, y: (now.corners[k] as Pt).y - (was.corners[k] as Pt).y };
  // Each upper wall's line: the main floor's wall it is flush with, moved as that wall moved; else moved with the anchor corner.
  const moved = U.map((p) => ({ ...p }));
  for (let j = 0; j < m; j++) {
    const a = U[j] as Pt;
    const b = U[(j + 1) % m] as Pt;
    const upright = Math.abs(a.x - b.x) < EPS;
    const at = upright ? a.x : a.y;
    const lo = upright ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const hi = upright ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    let best = -1;
    let bestScore = -Infinity;
    for (let w = 0; w < n; w++) {
      const p = was.corners[w] as Pt;
      const q = was.corners[(w + 1) % n] as Pt;
      if (upright ? Math.abs(p.x - q.x) > EPS || Math.abs(p.x - at) > EPS : Math.abs(p.y - q.y) > EPS || Math.abs(p.y - at) > EPS) continue;
      const wlo = upright ? Math.min(p.y, q.y) : Math.min(p.x, q.x);
      const whi = upright ? Math.max(p.y, q.y) : Math.max(p.x, q.x);
      // The one it runs along most; failing any, the nearest along the line.
      const score = Math.min(hi, whi) - Math.max(lo, wlo);
      if (score > bestScore) [best, bestScore] = [w, score];
    }
    const to = best >= 0 ? (upright ? (now.corners[best] as Pt).x : (now.corners[best] as Pt).y) : at + (upright ? anchor.x : anchor.y);
    for (const c of [j, (j + 1) % m]) {
      if (upright) (moved[c] as Pt).x = to;
      else (moved[c] as Pt).y = to;
    }
  }
  if (moved.every((p, j) => Math.abs(p.x - (U[j] as Pt).x) < EPS && Math.abs(p.y - (U[j] as Pt).y) < EPS)) return after;
  const lengths = moved.map((p, j) => Math.hypot((moved[(j + 1) % m] as Pt).x - p.x, (moved[(j + 1) % m] as Pt).y - p.y));
  if (lengths.some((l) => l < MIN_SIDE_FEET)) return after;
  // How far each side's left corner moved along it: what stands along it keeps its place on the wall.
  const startShift = U.map((a, j) => {
    const b = U[(j + 1) % m] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return (((moved[j] as Pt).x - a.x) * (b.x - a.x) + ((moved[j] as Pt).y - a.y) * (b.y - a.y)) / len;
  });
  const sides = up.sides.map((s, j) => {
    const length = lengths[j] as number;
    if (Math.abs(length - s.lengthFeet) < EPS) return s;
    return movedAlong(s, length, () => -(startShift[j] as number));
  });
  // A side typed or taped is a measurement: not stretched to follow a line.
  if (sides.some((s, j) => s !== up.sides[j] && up.sides[j]?.lengthFrom !== "drawn")) return after;
  const additions = after.roof.additions?.map((a) => {
    const j = up.sides.findIndex((s) => s.id === a.sideId);
    const side = up.sides[j];
    return side && sides[j] !== side ? additionAlong(a, side.lengthFeet, lengths[j] as number, () => -(startShift[j] as number)) : a;
  });
  const origin = now.corners[k] as Pt;
  const first = moved[0] as Pt;
  return {
    ...after,
    roof: additions ? { ...after.roof, additions } : after.roof,
    upper: { ...up, sides, at: { sideId: up.at.sideId, dx: first.x - origin.x, dy: first.y - origin.y } },
  };
}

function mainSideLength(exterior: Exterior, sideId: string, feet: number): Exterior {
  const i = exterior.sides.findIndex((s) => s.id === sideId);
  const side = exterior.sides[i];
  if (!side || !(feet >= MIN_SIDE_FEET)) return exterior;
  const delta = feet - side.lengthFeet;
  const still = () => 0;
  /** The exterior with these lengths, what stands along each side moved by its shift, and side i typed. */
  const applied = (lengths: number[], shifts: ((f: number) => number)[]): Exterior => {
    const sides = exterior.sides.map((s, k) => {
      const length = lengths[k] as number;
      if (k !== i && Math.abs(length - s.lengthFeet) < EPS) return s;
      const moved = movedAlong(s, length, shifts[k] as (f: number) => number);
      // Typed, it is a measurement now, and stands when another side is typed.
      if (k === i) delete moved.lengthFrom;
      return moved;
    });
    const additions = exterior.roof.additions?.map((a) => {
      const k = exterior.sides.findIndex((s) => s.id === a.sideId);
      const before = exterior.sides[k]?.lengthFeet;
      const length = lengths[k];
      return before === undefined || length === undefined || Math.abs(length - before) < EPS ? a : additionAlong(a, before, length, shifts[k] as (f: number) => number);
    });
    return { ...exterior, sides, roof: additions ? { ...exterior.roof, additions } : exterior.roof };
  };
  const typedAlone = applied(
    exterior.sides.map((s, k) => (k === i ? feet : s.lengthFeet)),
    exterior.sides.map(() => still),
  );

  const footprint = Math.abs(delta) > EPS ? exteriorFootprint(exterior) : null;
  if (!footprint?.closes) return typedAlone;
  const c = footprint.corners;
  const n = c.length;
  const dirOf = (k: number): Pt => {
    const a = c[k] as Pt;
    const b = c[(k + 1) % n] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  const u = dirOf(i);
  const proj = (p: Pt) => dot(p, u);
  const s0 = proj(c[i] as Pt);
  const s1 = proj(c[(i + 1) % n] as Pt);
  const breaks = [s0, ...[...new Set(c.map((p) => Math.round(proj(p) * 1e6) / 1e6))].filter((v) => v > s0 + EPS && v < s1 - EPS).sort((a, b) => a - b), s1];
  const parallel = exterior.sides.map((_, k) => Math.abs(dot(dirOf(k), u)) > 0.5);
  const sound = (next: Exterior) => exteriorFootprint(next).closes;

  for (let k = breaks.length - 2; k >= 0; k--) {
    const mid = ((breaks[k] as number) + (breaks[k + 1] as number)) / 2;
    const others = exterior.sides
      .map((_, j) => {
        if (j === i || !parallel[j]) return -1;
        const a = proj(c[j] as Pt);
        const b = proj(c[(j + 1) % n] as Pt);
        return Math.min(a, b) < mid && mid < Math.max(a, b) ? j : -1;
      })
      .filter((j) => j >= 0);
    if (others.length === 0 || !others.every((j) => exterior.sides[j]?.lengthFrom === "drawn" && (exterior.sides[j]?.lengthFeet ?? 0) + delta >= MIN_SIDE_FEET)) continue;
    // Everything past the cut, just short of the end of this stretch, slides `delta` along the typed side.
    const cut = (breaks[k + 1] as number) - 1e-6;
    // Where a point along the typed side's line ends up: past the cut it moves; short of it, where the
    // outline closes up it is kept on what is left, so nothing along a wall changes order.
    const moved = (p: number) => (p > cut ? p + delta : delta < 0 ? Math.min(p, cut + delta) : p);
    const lengths = exterior.sides.map((s, j) => (j === i ? feet : others.includes(j) ? s.lengthFeet + delta : s.lengthFeet));
    const shifts = exterior.sides.map((_, j) => {
      if (j !== i && !others.includes(j)) return still;
      const sigma = dot(dirOf(j), u);
      const start = proj(c[j] as Pt);
      const startAfter = start > cut ? start + delta : start;
      return (f: number) => sigma * (moved(start + sigma * f) - startAfter) - f;
    });
    const next = applied(lengths, shifts);
    if (sound(next)) return next;
  }

  // The drawn sides running this way take up what is left over, each by its length.
  const drawn = exterior.sides.map((s, j) => (j !== i && parallel[j] && s.lengthFrom === "drawn" ? j : -1)).filter((j) => j >= 0);
  const w = sideChain(exterior.sides).dirs;
  const lengths = exterior.sides.map((s, j) => (j === i ? feet : s.lengthFeet));
  const over = exterior.sides.reduce((s, _, j) => s + dot(w[j] as Pt, u) * (lengths[j] as number), 0);
  const total = drawn.reduce((s, j) => s + (lengths[j] as number), 0);
  const shared = drawn.map((j) => (lengths[j] as number) - (over * dot(w[j] as Pt, u) * (lengths[j] as number)) / total);
  if (drawn.length > 0 && total > 0 && shared.every((v) => v >= MIN_SIDE_FEET)) {
    drawn.forEach((j, k) => (lengths[j] = shared[k] as number));
    const next = applied(
      lengths,
      exterior.sides.map(() => still),
    );
    if (sound(next)) return next;
  }
  return typedAlone;
}

// ---------------------------------------------------------------------------------------------
// The roof, by taps on the plan
// ---------------------------------------------------------------------------------------------

/** What a tap on an end of the roof makes it: a gable a hip, a hip a gable. Null for a side that is no end. */
export function toggledEnd(plan: RoofPlan, sideId: string): RoofEndKind | null {
  const end = plan.ends.find((e) => e.sideId === sideId);
  return end ? (end.kind === "hip" ? "gable" : "hip") : null;
}

export function withRoofEnd(roof: ExteriorRoof, sideId: string, kind: RoofEndKind): ExteriorRoof {
  return { ...roof, ends: { ...roof.ends, [sideId]: kind } };
}

/**
 * A section's own pitch, from a tap on it on the plan (2026-10-14). The main roof's is the roof's own
 * pitch; null puts a section back to the roof's (a porch or cross gable: the slope's it comes off).
 */
export function withSectionPitch(roof: ExteriorRoof, key: string, pitch: number | null): ExteriorRoof {
  if (key === "main") return { ...roof, pitch };
  const sectionPitches = { ...(roof.sectionPitches ?? {}) };
  if (pitch === null) delete sectionPitches[key];
  else sectionPitches[key] = pitch;
  return { ...roof, sectionPitches };
}

/**
 * A section's second pitch above a break (gambrel, mansard), or none (null). A height not yet typed
 * is kept as 0, which builds no break until it is (lib/roof.ts `withBreaks`).
 */
export function withSectionBreak(roof: ExteriorRoof, key: string, brk: RoofBreak | null): ExteriorRoof {
  const sectionBreaks = { ...(roof.sectionBreaks ?? {}) };
  if (brk === null) delete sectionBreaks[key];
  else sectionBreaks[key] = brk;
  return { ...roof, sectionBreaks };
}

/** A roof piece of a kind, put on with nothing typed: it counts nothing, and is asked for, until its numbers are in. */
export function newRoofPiece(kind: RoofPieceKind): RoofPiece {
  return { id: newSketchId("piece"), kind, count: 1, ...(kind === "flat" ? { perimeterAs: "eave" as const } : {}) };
}

/** [exterior] with the dormer or turret [pieceId] read off [sideId]'s photo changed by [f], or taken off the side's read when [f] gives null (2026-10-15). */
export function withPhotoPiece(exterior: Exterior, sideId: string, pieceId: string, f: (pp: PhotoPiece) => PhotoPiece | null): Exterior {
  const onSide = (s: ExteriorSide): ExteriorSide => {
    if (s.id !== sideId || !s.roofRead?.pieces) return s;
    const pieces = s.roofRead.pieces.flatMap((pp) => (pp.id === pieceId ? (f(pp) ?? []) : [pp]));
    return { ...s, roofRead: { ...s.roofRead, pieces } };
  };
  return { ...exterior, sides: exterior.sides.map(onSide), ...(exterior.upper ? { upper: { ...exterior.upper, sides: exterior.upper.sides.map(onSide) } } : {}) };
}

/**
 * A photo's dormer or turret made the estimator's own, a number of it changed on the roof pane
 * (2026-10-15): [own] goes among their pieces, and the photo's stands aside for it while it is there -
 * taken off again, the photo's comes back.
 */
export function withPhotoPieceMadeOwn(exterior: Exterior, sideId: string, pieceId: string, own: RoofPiece): Exterior {
  const piece: RoofPiece = { ...own, id: newSketchId("piece") };
  delete piece.source;
  delete piece.taken;
  const e = withPhotoPiece(exterior, sideId, pieceId, (pp) => ({ ...pp, typedAs: piece.id }));
  return { ...e, roof: { ...e.roof, pieces: [...(e.roof.pieces ?? []), piece] } };
}

export type AdditionKind = "porch" | "leanto" | "gable";

/** A cross gable put on a side with a door covers the door and this much either side of it. */
export const DOOR_GABLE_MARGIN_FEET = 2;

/**
 * A porch roof (the slope carried on), a lean-to (a lower roof against the wall) or a cross gable
 * put on a side with one tap: a porch along the whole side, 6' out; a cross gable over the side's
 * [door] (2026-10-16), or 10' wide in the middle. Its numbers are typed after, in the list under the plan.
 */
export function withAddition(roof: ExteriorRoof, kind: AdditionKind, sideId: string, sideFeet: number, door?: { fromLeftFeet: number; widthFeet: number }): ExteriorRoof {
  const id = newSketchId("roof");
  const L = Math.max(0, sideFeet);
  // A cross gable over the side's door when there is one (2026-10-16): the door and 2' either side, where a porch's posts stand; else 10' in the middle.
  const [from, to] = door ? [door.fromLeftFeet - DOOR_GABLE_MARGIN_FEET, door.fromLeftFeet + door.widthFeet + DOOR_GABLE_MARGIN_FEET] : [L / 2 - 5, L / 2 + 5];
  const a: RoofAddition =
    kind === "gable"
      ? { id, kind: "gable", sideId, fromFeet: Math.max(0, from), toFeet: Math.min(L, to) }
      : { id, kind: "porch", sideId, fromFeet: 0, toFeet: L, depthFeet: 6, lower: kind === "leanto" };
  return { ...roof, additions: [...(roof.additions ?? []), a] };
}

/** Everything the roof says about the sides, let go of sides that are no longer there. */
export function roofWithoutSides(roof: ExteriorRoof, gone: (id: string) => boolean): ExteriorRoof {
  const ends = Object.fromEntries(Object.entries(roof.ends).filter(([id]) => !gone(id)));
  const additions = roof.additions?.filter((a) => !gone(a.sideId));
  // A section's own pitch goes with its side: a wing's and a gable over one by the side, a porch's by the porch.
  const kept = (key: string) => {
    const side = /^(?:wing:|over-)(.+)$/.exec(key)?.[1];
    if (side !== undefined) return !gone(side);
    return key === "main" || (additions ?? []).some((a) => a.id === key) || !(roof.additions ?? []).some((a) => a.id === key);
  };
  return {
    ...roof,
    ends,
    ridgeAlong: roof.ridgeAlong !== null && gone(roof.ridgeAlong) ? null : roof.ridgeAlong,
    ...(roof.sectionPitches ? { sectionPitches: Object.fromEntries(Object.entries(roof.sectionPitches).filter(([key]) => kept(key))) } : {}),
    ...(roof.sectionBreaks ? { sectionBreaks: Object.fromEntries(Object.entries(roof.sectionBreaks).filter(([key]) => kept(key))) } : {}),
    additions,
    lowerWings: roof.lowerWings?.filter((w) => !gone(w)),
    wingGables: roof.wingGables?.filter((w) => !gone(w)),
    coveredNotches: roof.coveredNotches?.filter((w) => !gone(w)),
  };
}
