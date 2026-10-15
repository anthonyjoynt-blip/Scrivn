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
  type UpperFloor,
} from "./exterior";
import type { Pt, RoofAddition, RoofEndKind, RoofPlan } from "./roof";
import { newSketchId } from "./sketch";

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

export type AdditionKind = "porch" | "leanto" | "gable";

/**
 * A porch roof (the slope carried on), a lean-to (a lower roof against the wall) or a cross gable
 * put on a side with one tap: a porch along the whole side, 6' out; a cross gable 10' wide in the
 * middle. Its numbers are typed after, in the list under the plan.
 */
export function withAddition(roof: ExteriorRoof, kind: AdditionKind, sideId: string, sideFeet: number): ExteriorRoof {
  const id = newSketchId("roof");
  const L = Math.max(0, sideFeet);
  const a: RoofAddition =
    kind === "gable"
      ? { id, kind: "gable", sideId, fromFeet: Math.max(0, L / 2 - 5), toFeet: Math.min(L, L / 2 + 5) }
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
    additions,
    lowerWings: roof.lowerWings?.filter((w) => !gone(w)),
    wingGables: roof.wingGables?.filter((w) => !gone(w)),
    coveredNotches: roof.coveredNotches?.filter((w) => !gone(w)),
  };
}
