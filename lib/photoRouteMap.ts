/**
 * A map outline on the photo route's plan (2026-10-23): a building's footprint off a public map - Microsoft's open
 * building footprints, traced by computer from aerial photos - laid on the house as the walk and the photos measured it,
 * for the long dimension the photos can't give. Blind runs of a test house (10-22) fitted its true shape and one several
 * feet shorter equally well: nothing in those photos ties the front to the back. A map outline does, to a foot or two on
 * its long walls. But it misses small parts (a bump-out a few feet deep, a step) and may take in a deck or a covered
 * area, so it is never the answer for those - and its long side is not always the whole wall: a reviewer laying a map on
 * by eye took its long side for a whole side wall that runs on past it along a bump-out.
 *
 * Laid rigidly - turned and moved, never stretched (`fitMapOutline`):
 *   1. turned square to the plan, by the map's own sides; of the four quarter-turns, the one that overlaps the outline
 *      most and puts the fewest of the sizes the photos do hold against it;
 *   2. moved to overlap the outline most;
 *   3. each long side of it (15' or more) traces one wall: of the outline's walls facing the same way under it, the one at
 *      the middle of their spread, by length (a close call with a bump-out's face: the wall behind it; over a bump-out's
 *      face and the wall behind it, the one the photos alone agree with - `MapPair`). A bump-out it missed stands out past it, a notch or a covered deck it took in
 *      stands in from it, and neither is the wall it traces. That is read off the outline's own shape across the map's
 *      side - which walls, how long, in what order - so a depth the photos got wrong never chooses it.
 * Each two walls traced the same way are then held to the map's distance between them in the solve (`MapHold`,
 * lib/photoRoute.ts): the depth from the map, and every other size still from the photos and the tapes. Where the map and
 * the photos disagree it is said (`mapCheck`), and what the map leaves out.
 *
 * A map traced from above runs along the ROOF's edge (2026-10-23, a test house's map): a porch line runs along the porch
 * roof, feet out from the porch wall, and a back line across a covered notch's mouth. So a porch's wall is
 * held its depth in from the map's line, a covered notch's walls never (its mouth counts as the wall it meets), and every
 * hold is looser by the roof's overhang (`MapRoofOver`: the eave, or the rake on a gable end) - centred on the line, not
 * free anywhere inside it: on the test house Microsoft's lines sat within inches of the walls, and a hold free over the
 * eave let the depth slide to its short edge, feet short of the tape. The
 * depth is held from the longest open wall straight to each other one, never chained through a porch's line.
 *
 * Nothing here looks anything up: the outline comes in as its corners, feet, x east and y north. The app's map lookup is
 * for launch.
 */

import type { Pt } from "./roof";
import { formatFeetInches } from "./sketch";

/** A building's outline off a map: its corners in order round it, feet, x east, y north (true north). */
export interface MapOutline {
  corners: Pt[];
  /** Where it came from, in words ("Microsoft building footprints"). */
  source?: string;
  /** One sd of a long side's line, feet: `MAP_SD_FEET` when not said. */
  sdFeet?: number;
}

/**
 * The app's own map lookup (for launch, 2026-10-23: the house's outline off a public map, tapped on): not there yet. When it
 * is, a size not measured says "or tap your house on the map" beside its tape (lib/photoRoute.ts `settleWords`).
 */
export const MAP_LOOKUP_READY = false;

/** A long side of a building footprint off aerial photos is good to about a foot (one sd): "usually within 1-2 ft". */
export const MAP_SD_FEET = 1;
/** Only the map's long sides hold anything: a short one is where it is least sure, and most often a part it simplified. */
export const MAP_LONG_FEET = 15;
/** A map side within this of square to the plan is one of its walls' lines; one further off is at an angle and holds nothing. */
const SQUARE_DEG = 15;
/** Walls under one map side within this of the one it traces are the same line to the map (a garage door's step of a foot or two). */
const CLUSTER_FEET = 2.5;
/** Of a map side's length, the share the wall it traces (with those level with it) must run under it. */
const TRACE_SHARE = 0.25;
/** A part standing out this little or less from the wall beside it is a bump-out: the kind of part a footprint off aerial photos misses. */
const BUMP_FEET = 10;
/**
 * A bump-out's face or the wall behind it: one way is clearly the photos' when its distances are this much nearer theirs,
 * in sum of squares of sd off (two sd on one distance), and none of its own more than two sd off.
 */
const PAIR_CLEAR_CHI2 = 4;
const PAIR_OFF_SD = 2;

type Axis = "E" | "N";

/** One side of the map as laid on the plan, and the wall it traces. */
export interface MapSide {
  index: number;
  lengthFeet: number;
  /** "E": runs north-south on the plan (a wall with an x), "N": east-west (a y); null: at an angle to the plan. */
  axis: Axis | null;
  /** Its line on the plan (x for "E", y for "N"), and how far it runs the other way. */
  at: number;
  lo: number;
  hi: number;
  /** Which way it faces: +1 east or north, -1 west or south. */
  outward: 1 | -1;
  /** The outline side it traces; null when none, and why. */
  traces: number | null;
  /** On the outline as measured with the map, it would trace this other side (`mapCheck`): said, not held. */
  nowTraces?: number;
  /** How far inside its line the wall it traces stands (a porch's depth; 0 in the open), and one sd more for the roof (half its overhang; a porch's depth); null: not held (a porch of no known depth). */
  inside?: { feet: number; sdFeet: number } | null;
  why?: string;
  /** The outline's other sides under it facing the same way, and how far each stands out past the one it traces (+) or in from it (-), feet. */
  others: { side: number; offFeet: number }[];
  /**
   * A close call: another of them, not level with the one it traces, that the map's line could as well be on - the two
   * near enough equal by how far the walls under the map's side stand off each (within 15%). Held as traced, and said.
   */
  close?: { side: number; offFeet: number };
  /** A bump-out's face and the wall behind it both under it: which one it is on, as the photos alone say (`MapPair`). */
  pair?: MapPair;
}

/**
 * A map side over a bump-out's face and the wall behind it (2026-10-23, two blind runs of a test house): a map can
 * miss the bump-out (its line on the wall behind) or take in what stands beside it - a deck, a covered notch - (its line on
 * the face), and the shape under the line can't say which. On a test house two blind runs' fits held one each - one of
 * them the wrong one and sure of itself, though that run's photos alone had put the depth right.
 * So each way is fitted, and its distances to the map's other lines in the open held against the photos alone, each off by
 * its sd; the way they agree with is held when it clearly does. When it doesn't (photos that barely tie the front to the back),
 * the one the shape under the line traces is held as before - the map's depth is still the best there is - but the walls
 * whose lengths hang on which it is are not measured, the tape that settles it named: said either way.
 */
export interface MapPair {
  face: number;
  behind: number;
  /** How far the face stands out past the wall behind, feet, on the plan the fit was made on. */
  apartFeet: number;
  /** The one the shape under the line traces by itself (`traceSides`). */
  traced: number;
  /** Each way, the map's line on that wall: its distances against the photos alone, and their sum of squares off. */
  ways: { side: number; against: { to: number; mapFeet: number; photosFeet: number; photosSdFeet: number; offSd: number }[]; chi2: number }[];
  /** The wall held: the one the photos chose, or (they didn't) the one traced. */
  held: number;
  /**
   * The photos alone chose it, clearly. Not: held as traced, and the walls either side of the face and of the wall behind it -
   * whose lengths hang on which it is - are not measured (lib/photoRoute.ts `solveWithMap`).
   */
  decided: boolean;
}

/**
 * The ways a measure chose for its map sides over a bump-out's face and the wall behind it, at the turn it laid the map
 * (2026-10-23): made once, on the photos alone before the map moved anything, and kept for every solve after. The map's
 * holds move the lens's radial term the measure levels the photos with again (lib/photoRouteData.ts `measureRoute`), and on
 * two blind runs that alone moved the "photos alone" depth by feet: weighed after it, the photos say what the map made them.
 */
export interface MapChoice {
  turnDeg: number;
  pairs: { mapSide: number; pair: MapPair }[];
}

/**
 * What the roof covers past the walls, as a map traced from above sees it (2026-10-23): the roof's overhangs (typed or
 * read), its gable ends, the notches it carries over (a covered deck) and the porches under it. Side indices are the
 * outline's. Absent: walls up to `MAP_OVERHANG_FEET` inside the map's line, nothing covered.
 */
export interface MapRoofOver {
  eaveFeet?: number;
  rakeFeet?: number;
  /** Sides that are gable ends: a rake over them, not an eave. */
  gableSides?: number[];
  /** Each notch the roof carries over, by any one of its inner walls. */
  coveredNotches?: number[];
  /** Porches under the roof, by the wall they stand along: the roof's edge is their depth (when known) and the overhang out. */
  porches?: { side: number; depthFeet?: number }[];
}

/** How far inside a map's line a wall may stand where the roof's overhang isn't known: an eave's, about. */
export const MAP_OVERHANG_FEET = 1.5;
/** A porch's depth, one sd, feet: where its roof's edge stands past its posts is not said. */
const PORCH_SD_FEET = 1;

/** Two of the outline's walls held to the map's distance between them: sides [a] and [b], each the wall its map side traces. */
export interface MapHold {
  id: string;
  a: number;
  b: number;
  axis: Axis;
  /** The distance with each wall on its map line, or a porch's depth in from it. */
  feet: number;
  /** One sd: each line's (the map's, half a step level with it, half the roof's overhang, a porch's depth). */
  sdFeet: number;
  /** The map sides that trace them. */
  mapSides: [number, number];
  /** Walls level with either (within 2'6": a garage door's step), on the same map line: the map holds where they stand too. */
  level?: number[];
}

export interface MapFit {
  /** The map turned by this (degrees, counter-clockwise) and moved by `shift` is on the plan. */
  turnDeg: number;
  shift: [number, number];
  /** Which way the plan's front (its street side, the plan's -y) faces, degrees clockwise from north. */
  frontFacesDeg: number;
  /** Overlap of the map and the outline, area over area of either: 1 is the same shape. */
  overlap: number;
  onPlan: Pt[];
  sides: MapSide[];
  holds: MapHold[];
}

// ── Plain geometry ───────────────────────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;
const rot = (p: Pt, deg: number): Pt => {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
const areaOf = (ring: Pt[]) => ring.reduce((s, p, i) => s + p.x * (ring[(i + 1) % ring.length] as Pt).y - (ring[(i + 1) % ring.length] as Pt).x * p.y, 0) / 2;
/** Counter-clockwise from above, as the plan's outline runs. */
const ccw = (ring: Pt[]) => (areaOf(ring) < 0 ? [...ring].reverse() : ring);

function inside(p: Pt, ring: Pt[]): boolean {
  let at = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Pt;
    const b = ring[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) at = !at;
  }
  return at;
}

function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** How far a point is from a ring's edge: + outside it, - inside. */
export function offRing(p: Pt, ring: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, toSegment(p, ring[i] as Pt, ring[(i + 1) % ring.length] as Pt));
  return inside(p, ring) ? -d : d;
}

/** A side of a ring as a line square to the plan, or at an angle. */
interface Line {
  index: number;
  lengthFeet: number;
  axis: Axis | null;
  at: number;
  lo: number;
  hi: number;
  outward: 1 | -1;
}

function linesOf(ring: Pt[], squareDeg = 1): Line[] {
  const n = ring.length;
  return ring.map((a, i) => {
    const b = ring[(i + 1) % n] as Pt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    const ns = Math.abs(dx) < Math.abs(dy);
    const off = Math.atan2(ns ? Math.abs(dx) : Math.abs(dy), ns ? Math.abs(dy) : Math.abs(dx)) / RAD;
    // Outward is to the right of a counter-clockwise ring: (dy, -dx).
    const outward: 1 | -1 = ns ? (dy > 0 ? 1 : -1) : -dx > 0 ? 1 : -1;
    return {
      index: i,
      lengthFeet: L,
      axis: off <= squareDeg ? (ns ? "E" : "N") : null,
      at: ns ? (a.x + b.x) / 2 : (a.y + b.y) / 2,
      lo: ns ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
      hi: ns ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
      outward,
    };
  });
}

/** The map's own square: the direction its sides run, length-weighted, folded to a quarter-turn (degrees, -45 to 45). */
function squareOf(ring: Pt[]): number {
  let c = 0;
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % ring.length] as Pt;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const t = Math.atan2(b.y - a.y, b.x - a.x);
    c += L * Math.cos(4 * t);
    s += L * Math.sin(4 * t);
  }
  return Math.atan2(s, c) / 4 / RAD;
}

/** The bearing the plan's front (-y) faces with the map turned by [turnDeg] onto it: degrees clockwise from north. */
export function frontBearing(turnDeg: number): number {
  const t = turnDeg * RAD;
  return (((Math.atan2(-Math.sin(t), -Math.cos(t)) / RAD) % 360) + 360) % 360;
}

// ── Overlap ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The shift putting [poly] on [ring] with the most overlap, and that overlap (area shared over area of either): searched on
 * a grid of cells, coarse then fine, within [search] feet of the boxes' middles lined up.
 */
function bestShift(ring: Pt[], poly: Pt[], search: number): { shift: [number, number]; overlap: number } {
  const box = (r: Pt[]) => ({ x0: Math.min(...r.map((p) => p.x)), x1: Math.max(...r.map((p) => p.x)), y0: Math.min(...r.map((p) => p.y)), y1: Math.max(...r.map((p) => p.y)) });
  const R = box(ring);
  const P = box(poly);
  const start: [number, number] = [(R.x0 + R.x1) / 2 - (P.x0 + P.x1) / 2, (R.y0 + R.y1) / 2 - (P.y0 + P.y1) / 2];
  const at = (cell: number, around: [number, number], reach: number) => {
    const pad = reach + cell;
    const gx0 = Math.min(R.x0, P.x0 + around[0]) - pad;
    const gy0 = Math.min(R.y0, P.y0 + around[1]) - pad;
    const nx = Math.ceil((Math.max(R.x1, P.x1 + around[0]) + pad - gx0) / cell);
    const ny = Math.ceil((Math.max(R.y1, P.y1 + around[1]) + pad - gy0) / cell);
    const grid = new Uint8Array(nx * ny);
    let inRing = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (inside({ x: gx0 + (i + 0.5) * cell, y: gy0 + (j + 0.5) * cell }, ring)) {
          grid[j * nx + i] = 1;
          inRing++;
        }
      }
    }
    // The map's cells with it at [around], on the same grid.
    const cells: number[] = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (inside({ x: gx0 + (i + 0.5) * cell - around[0], y: gy0 + (j + 0.5) * cell - around[1] }, poly)) cells.push(i, j);
      }
    }
    const inPoly = cells.length / 2;
    const k = Math.ceil(reach / cell);
    let best = { shift: around, overlap: -1 };
    for (let dy = -k; dy <= k; dy++) {
      for (let dx = -k; dx <= k; dx++) {
        let shared = 0;
        for (let c = 0; c < cells.length; c += 2) {
          const i = (cells[c] as number) + dx;
          const j = (cells[c + 1] as number) + dy;
          if (i >= 0 && j >= 0 && i < nx && j < ny && grid[j * nx + i]) shared++;
        }
        const overlap = shared / Math.max(1, inRing + inPoly - shared);
        if (overlap > best.overlap) best = { shift: [around[0] + dx * cell, around[1] + dy * cell], overlap };
      }
    }
    return best;
  };
  const extent = Math.max(R.x1 - R.x0, R.y1 - R.y0, P.x1 - P.x0, P.y1 - P.y0);
  const coarse = at(Math.max(1, extent / 40), start, search);
  return at(Math.max(0.25, extent / 200), coarse.shift, Math.max(1, extent / 40) * 2);
}

// ── What each map side traces ────────────────────────────────────────────────────────────────────

/**
 * Each side of the map (on the plan) and the outline's wall it traces: of the outline's walls facing the same way under it
 * (the outermost at each place along it), the one at the middle of their spread by length - with those level with it
 * (within 2'6") taking in at least a quarter of the map side. Its others stand out past it (a part the map missed) or in
 * from it (a notch or a covered area the map took in). A close call between a bump-out's face and the wall behind it goes
 * to the wall behind: a bump-out is what such maps miss.
 */
function traceSides(onPlan: Pt[], ring: Pt[], over: MapRoofOver = {}): MapSide[] {
  const walls = linesOf(ring);
  const n = ring.length;
  // Corner k (where side k-1 meets side k) turns left round a counter-clockwise ring: an outside corner.
  const outside = ring.map((p, k) => {
    const a = ring[(k - 1 + n) % n] as Pt;
    const b = ring[(k + 1) % n] as Pt;
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) > 0;
  });
  // A notch the roof carries over: its inner walls (the two at its inside corner) are under the roof, the map's line runs
  // across its mouth. Each is never traced; the length it runs counts for the wall its mouth is on - the one beyond the
  // notch's other wall, parallel to it (the covered deck's back counts for the rear wall the deck's open side meets).
  const mouth = new Map<number, number>();
  for (const k of over.coveredNotches ?? []) {
    if (!(k >= 0 && k < n)) continue;
    const at = !outside[k] ? k : !outside[(k + 1) % n] ? (k + 1) % n : null;
    if (at === null) continue;
    mouth.set((at - 1 + n) % n, (at + 1) % n);
    mouth.set(at, (at - 2 + n) % n);
  }
  const allowed = (i: number) => insideOf(i, over);
  // The face of a bump-out: both its corners outside, and a side beside it short and back to an inside corner.
  const bumpFace = (i: number) => {
    const before = (i - 1 + n) % n;
    const after = (i + 1) % n;
    if (!outside[i] || !outside[after]) return false;
    return ((walls[before] as Line).lengthFeet <= BUMP_FEET && !outside[before]) || ((walls[after] as Line).lengthFeet <= BUMP_FEET && !outside[(i + 2) % n]);
  };
  return linesOf(onPlan, SQUARE_DEG).map((m): MapSide => {
    const base = { index: m.index, lengthFeet: m.lengthFeet, axis: m.axis, at: m.at, lo: m.lo, hi: m.hi, outward: m.outward, others: [] as MapSide["others"] };
    if (!m.axis) return { ...base, traces: null, why: "it runs at an angle to the house" };
    // A covered notch's wall stands in for its mouth's: where it runs, at that wall's line.
    const as = (w: Line): Line => {
      const to = mouth.get(w.index);
      const wall = to === undefined ? undefined : walls[to];
      return wall && wall.axis === w.axis && wall.outward === w.outward ? { ...w, index: wall.index, at: wall.at } : w;
    };
    const under = walls.map(as).filter((w) => w.axis === m.axis && w.outward === m.outward && Math.min(w.hi, m.hi) - Math.max(w.lo, m.lo) > 0.5);
    if (!under.length) return { ...base, traces: null, why: "no wall of the house faces that way under it" };
    // Along the map side, the outermost wall at each place: how much of the side each takes.
    const cuts = [...new Set([m.lo, m.hi, ...under.flatMap((w) => [w.lo, w.hi]).filter((v) => v > m.lo && v < m.hi)])].sort((p, q) => p - q);
    const share = new Map<number, number>();
    for (let k = 0; k + 1 < cuts.length; k++) {
      const u = cuts[k] as number;
      const v = cuts[k + 1] as number;
      const mid = (u + v) / 2;
      const over = under.filter((w) => w.lo <= mid && w.hi >= mid);
      if (!over.length) continue;
      const outer = over.reduce((p, q) => (q.outward * q.at > p.outward * p.at ? q : p));
      share.set(outer.index, (share.get(outer.index) ?? 0) + (v - u));
    }
    const seen = [...new Map(under.filter((w) => (share.get(w.index) ?? 0) > 0.5).map((w) => [w.index, walls[w.index] as Line])).values()].sort((p, q) => p.outward * p.at - q.outward * q.at);
    if (!seen.length) return { ...base, traces: null, why: "no wall of the house faces that way under it" };
    const total = seen.reduce((s, w) => s + (share.get(w.index) as number), 0);
    let run = 0;
    let middle = seen[0] as Line;
    for (const w of seen) {
      run += share.get(w.index) as number;
      middle = w;
      if (run >= total / 2) break;
    }
    // Walls level with it (a garage door's step) are one line to the map: of those, the one taking most of the side - or,
    // about as much (within a fifth), the outer one, where a roof's edge seen from above stands.
    const level = seen.filter((w) => Math.abs(w.at - middle.at) <= CLUSTER_FEET);
    const most = Math.max(...level.map((w) => share.get(w.index) as number));
    const traced = level.filter((w) => (share.get(w.index) as number) >= 0.8 * most).reduce((p, q) => (q.outward * q.at > p.outward * p.at ? q : p));
    const others = seen.filter((w) => w !== traced).map((w) => ({ side: w.index, offFeet: m.outward * (w.at - traced.at) }));
    const levelShare = level.reduce((s, w) => s + (share.get(w.index) as number), 0);
    if (m.lengthFeet < MAP_LONG_FEET) return { ...base, others, traces: null, why: `short (${formatFeetInches(m.lengthFeet)}): the map holds only its long sides` };
    if (levelShare < Math.max(6, TRACE_SHARE * m.lengthFeet)) return { ...base, others, traces: null, why: "the walls under it step in and out: none runs along enough of it" };
    // How far the walls under it stand off a line on each, length by length: the middle is the least; another as little,
    // near enough, is a close call (a rear wall and a bump-out's back under one line, their scores within a tenth).
    const offAt = (v: Line) => seen.reduce((s, w) => s + (share.get(w.index) as number) * Math.abs(w.at - v.at), 0);
    const rival = seen.filter((w) => Math.abs(w.at - traced.at) > CLUSTER_FEET).map((w) => ({ w, off: offAt(w) })).sort((p, q) => p.off - q.off)[0];
    let held = traced;
    let close: MapSide["close"];
    if (rival && rival.off <= 1.15 * offAt(traced)) {
      // A close call between a bump-out's face and the wall it stands out from: the map missed the bump-out (what such maps
      // miss), so it traces the wall behind. Otherwise the middle stands.
      const outer = rival.w.outward * rival.w.at > traced.outward * traced.at ? rival.w : traced;
      const inner = outer === traced ? rival.w : traced;
      held = bumpFace(outer.index) && !bumpFace(inner.index) ? inner : traced;
      const other = held === traced ? rival.w : traced;
      close = { side: other.index, offFeet: m.outward * (other.at - held.at) };
    }
    // Traced on a bump-out's face or the wall behind it, both under the line: which, the photos say (`resolvePairs`).
    const pair = pairUnder(m, held);
    return { ...base, others: seen.filter((w) => w !== held).map((w) => ({ side: w.index, offFeet: m.outward * (w.at - held.at) })), traces: held.index, inside: allowed(held.index), ...(pair ? { pair } : close ? { close } : {}) };
  });

  /** A bump-out's face under map side [m] and the wall behind it, under it too, one of them (or level with it) [held]. */
  function pairUnder(m: Line, held: Line): MapPair | undefined {
    const under = (w: Line) => w.axis === m.axis && w.outward === m.outward && Math.min(w.hi, m.hi) - Math.max(w.lo, m.lo) > 0.5;
    for (let i = 0; i < n; i++) {
      const face = walls[i] as Line;
      if (!bumpFace(i) || !under(face)) continue;
      // The wall behind: past the short side back to the inside corner, parallel to the face.
      const after = (i + 1) % n;
      const before = (i - 1 + n) % n;
      const j = (walls[after] as Line).lengthFeet <= BUMP_FEET && !outside[(i + 2) % n] ? (i + 2) % n : (i - 2 + n) % n;
      if (j === (i - 2 + n) % n && !((walls[before] as Line).lengthFeet <= BUMP_FEET && !outside[before])) continue;
      const behind = walls[j] as Line;
      const apart = face.outward * (face.at - behind.at);
      if (!under(behind) || apart <= CLUSTER_FEET || apart > BUMP_FEET + CLUSTER_FEET) continue;
      if (Math.abs(held.at - face.at) > CLUSTER_FEET && Math.abs(held.at - behind.at) > CLUSTER_FEET) continue;
      return { face: i, behind: j, apartFeet: apart, traced: held.index, ways: [], held: held.index, decided: false };
    }
    return undefined;
  }
}

/**
 * Each map side over a bump-out's face and the wall behind it (`MapPair`), fitted both ways: its line on each wall, the
 * distances that puts to the map's other lines in the open held against the photos alone ([ring], their house; [sdBetween],
 * their sd on the distance between two walls), each off by its sd (the photos' and the map's). A porch's line is never one
 * of them: it stands off its wall by a depth guessed or typed, not measured. The way nearer the photos by `PAIR_CLEAR_CHI2`,
 * none of its own over `PAIR_OFF_SD`, is held, decided; else the one traced, not decided. No sd from the photos (no tape:
 * they have no size of their own) decides nothing. [assign]: the ways chosen before (`MapChoice`), by map side, kept.
 */
function resolvePairs(sides: MapSide[], ring: Pt[], sd: number, over: MapRoofOver, sdBetween?: (a: number, b: number) => number | null, assign?: Map<number, MapPair>): MapSide[] {
  const walls = linesOf(ring);
  // Side [s] traced on wall [w]: the others under it measured from it again.
  const on = (s: MapSide, w: number, pair: MapPair): MapSide => {
    const { close: _close, why: _why, ...rest } = s;
    void _close;
    void _why;
    if (w === s.traces) return { ...rest, pair };
    const was = s.traces === null ? null : (walls[s.traces] as Line);
    const at = (walls[w] as Line).at;
    const others = [...s.others.filter((o) => o.side !== w), ...(was ? [{ side: was.index, offFeet: 0 }] : [])].map((o) => ({ side: o.side, offFeet: s.outward * ((walls[o.side] as Line).at - at) }));
    return { ...rest, traces: w, inside: insideOf(w, over), others, pair };
  };
  let out = sides;
  for (const s of sides) {
    const given = assign?.get(s.index);
    if (given) {
      out = out.map((q) => (q.index === s.index ? on(q, given.held, given) : q));
      continue;
    }
    if (!s.pair) continue;
    const pair = s.pair;
    const ways = [pair.behind, pair.face].map((w) => {
      const tried = out.map((q) => (q.index === s.index ? on(q, w, pair) : q));
      const byIndex = new Map(tried.map((q) => [q.index, q]));
      const mine = holdsOf(tried, ring, sd).filter((h) => h.mapSides.includes(s.index));
      const open = mine.filter((h) => h.mapSides.every((k) => (byIndex.get(k)?.inside?.feet ?? 0) === 0));
      const against: MapPair["ways"][number]["against"] = [];
      for (const h of open.length ? open : mine) {
        const photosSdFeet = sdBetween?.(h.a, h.b);
        if (photosSdFeet === null || photosSdFeet === undefined || !Number.isFinite(photosSdFeet)) continue;
        const photosFeet = Math.abs((walls[h.b] as Line).at - (walls[h.a] as Line).at);
        against.push({ to: h.a === w ? h.b : h.a, mapFeet: h.feet, photosFeet, photosSdFeet, offSd: (photosFeet - h.feet) / Math.hypot(photosSdFeet, h.sdFeet) });
      }
      return { side: w, against, chi2: against.reduce((t, a) => t + a.offSd ** 2, 0) };
    });
    const [p, q] = [...ways].sort((u, v) => u.chi2 - v.chi2) as [MapPair["ways"][number], MapPair["ways"][number]];
    const clear = p.against.length > 0 && q.against.length > 0 && q.chi2 - p.chi2 >= PAIR_CLEAR_CHI2 && p.against.every((a) => Math.abs(a.offSd) <= PAIR_OFF_SD);
    const decided: MapPair = { ...pair, ways, held: clear ? p.side : pair.traced, decided: clear };
    out = out.map((r) => (r.index === s.index ? on(r, decided.held, decided) : r));
  }
  return out;
}

/**
 * How far inside its map line a wall stands: on it in the open, a porch's wall its depth in; and how loosely, one sd: half
 * the roof's overhang (the rake on a gable end, else the eave; `MAP_OVERHANG_FEET` not known), and a porch's depth. A
 * porch of no known depth: null, not held - where its roof's edge is, nothing says.
 */
function insideOf(side: number, over: MapRoofOver): { feet: number; sdFeet: number } | null {
  const gable = (over.gableSides ?? []).includes(side);
  const oh = Math.max(0, (gable ? over.rakeFeet : over.eaveFeet) ?? over.eaveFeet ?? MAP_OVERHANG_FEET);
  const porch = (over.porches ?? []).find((p) => p.side === side);
  if (porch) return Number.isFinite(porch.depthFeet) && (porch.depthFeet as number) > 0 ? { feet: porch.depthFeet as number, sdFeet: Math.hypot(oh / 2, PORCH_SD_FEET) } : null;
  return { feet: 0, sdFeet: oh / 2 };
}

/**
 * The walls the map traces, held to its distances: each way across the plan, from the longest map side tracing a wall in
 * the open (no porch under its line) straight to every other - the house's depth from the map's own long side, never
 * through a porch roof's line. Each wall at its line less what stands in front of it (`insideOf`). One sd: the two sides'
 * lines, each the map's sd, half the step of any wall level with it (a garage door's step: which of the two the map's line
 * is on, it can't say) and the roof's (`insideOf`). Two map sides tracing one wall: the longer. A pair the outline puts
 * the other way round is left out.
 */
function holdsOf(sides: MapSide[], ring: Pt[], sd: number): MapHold[] {
  const walls = linesOf(ring);
  const out: MapHold[] = [];
  for (const axis of ["E", "N"] as Axis[]) {
    const traced = new Map<number, MapSide>();
    for (const s of sides) {
      if (s.axis !== axis || s.traces === null || !s.inside) continue;
      const had = traced.get(s.traces);
      if (!had || s.lengthFeet > had.lengthFeet) traced.set(s.traces, s);
    }
    const list = [...traced.values()];
    if (list.length < 2) continue;
    const open = list.filter((s) => (s.inside as { feet: number }).feet === 0);
    const anchor = (open.length ? open : list).reduce((p, q) => (q.lengthFeet > p.lengthFeet ? q : p));
    const sdOf = (s: MapSide) => Math.hypot(sd, Math.max(0, ...s.others.filter((o) => Math.abs(o.offFeet) <= CLUSTER_FEET).map((o) => Math.abs(o.offFeet))) / 2, (s.inside as { sdFeet: number }).sdFeet);
    for (const other of list) {
      if (other === anchor) continue;
      const [p, q] = other.at < anchor.at ? [other, anchor] : [anchor, other];
      const wp = walls[p.traces as number] as Line;
      const wq = walls[q.traces as number] as Line;
      if (wq.at - wp.at < -CLUSTER_FEET) continue;
      // A wall u in from its line stands at its line less outward x u.
      const up = (p.inside as { feet: number }).feet;
      const uq = (q.inside as { feet: number }).feet;
      const level = [...p.others, ...q.others].filter((o) => Math.abs(o.offFeet) <= CLUSTER_FEET).map((o) => o.side);
      out.push({ id: `map:${p.index}-${q.index}`, a: p.traces as number, b: q.traces as number, axis, feet: q.at - p.at - q.outward * uq + p.outward * up, sdFeet: Math.hypot(sdOf(p), sdOf(q)), mapSides: [p.index, q.index], ...(level.length ? { level } : {}) });
    }
  }
  return out;
}

/** The map turned by [turnDeg] and moved by [shift] onto the plan. */
const placed = (corners: Pt[], turnDeg: number, shift: [number, number]) => corners.map((p) => {
  const r = rot(p, turnDeg);
  return { x: r.x + shift[0], y: r.y + shift[1] };
});

/**
 * The map outline laid on the outline [ring] (the plan, counter-clockwise, square), rigidly: turned square and to the best
 * of its four quarter-turns, moved to overlap it most, and each long side's wall traced. [sdBetween]: the photos' own sd
 * on the distance between two of the outline's walls (by side index), or null - a quarter-turn that puts the map's
 * distances against sizes the photos hold well is not the one. [frontFacesDeg], when known (the compass): only the
 * quarter-turn with the front that way. [turnDeg]: laid at that turn again (a fit already made, on the outline now).
 * [choice]: the ways chosen before for a bump-out's face or the wall behind it (`choiceOf`), kept at that turn. Null when
 * the map has fewer than three corners.
 */
export function fitMapOutline(
  map: MapOutline,
  ring: Pt[],
  opts: { sdBetween?: (a: number, b: number) => number | null; frontFacesDeg?: number | null; turnDeg?: number; over?: MapRoofOver; choice?: MapChoice } = {},
): MapFit | null {
  if (map.corners.length < 3 || ring.length < 3) return null;
  const corners = ccw(map.corners.map((p) => ({ x: Number(p.x), y: Number(p.y) })));
  if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const sd = map.sdFeet && map.sdFeet > 0 ? map.sdFeet : MAP_SD_FEET;
  const square = squareOf(corners);
  const turns = opts.turnDeg !== undefined ? [opts.turnDeg] : [0, 1, 2, 3].map((k) => -square + 90 * k);
  const facing = opts.frontFacesDeg;
  const allowed = facing === null || facing === undefined || opts.turnDeg !== undefined ? turns : turns.filter((t) => Math.abs(((frontBearing(t) - facing + 540) % 360) - 180) <= 45);
  const extent = Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x)) + Math.max(...ring.map((p) => p.y)) - Math.min(...ring.map((p) => p.y));
  const walls = linesOf(ring);
  const tries = (allowed.length ? allowed : turns).map((turnDeg) => {
    const turned = corners.map((p) => rot(p, turnDeg));
    const { shift, overlap } = bestShift(ring, turned, Math.max(10, 0.35 * extent));
    const onPlan = placed(corners, turnDeg, shift);
    const given = opts.choice && Math.abs(((turnDeg - opts.choice.turnDeg + 540) % 360) - 180) < 1 ? new Map(opts.choice.pairs.map((q) => [q.mapSide, q.pair])) : undefined;
    const sides = resolvePairs(traceSides(onPlan, ring, opts.over), ring, sd, opts.over ?? {}, opts.sdBetween, given);
    const holds = holdsOf(sides, ring, sd);
    // The sizes the photos hold, against the map's: each off by its sd, counted at most 3 sd (a size the photos got wrong
    // counts no more than one that is missing).
    let against = 0;
    for (const h of holds) {
      const s = opts.sdBetween?.(h.a, h.b);
      if (s === null || s === undefined || !Number.isFinite(s)) continue;
      const photos = Math.abs((walls[h.b] as Line).at - (walls[h.a] as Line).at);
      against += Math.min(9, ((photos - h.feet) / Math.hypot(s, h.sdFeet)) ** 2);
    }
    return { turnDeg, shift, overlap, onPlan, sides, holds, cost: against + 30 * (1 - overlap) };
  });
  const most = Math.max(...tries.map((t) => t.holds.length));
  const best = tries.reduce((p, q) => (q.cost + 3 * (most - q.holds.length) < p.cost + 3 * (most - p.holds.length) ? q : p));
  return { turnDeg: best.turnDeg, shift: best.shift, frontFacesDeg: frontBearing(best.turnDeg), overlap: best.overlap, onPlan: best.onPlan, sides: best.sides, holds: best.holds };
}

/**
 * The walls whose lengths hang on which of a bump-out's face and the wall behind it a map side is on: those either side of
 * each (not shared), and of them the longest - the house's depth along the bump-out, the one tape that settles which.
 */
export function pairHangs(pair: MapPair, lengths: number[], shared: Set<number> = new Set()): { walls: number[]; settle: number } {
  const n = lengths.length;
  const walls = [...new Set([pair.face, pair.behind].flatMap((k) => [(k - 1 + n) % n, (k + 1) % n]))].filter((k) => k !== pair.face && k !== pair.behind && !shared.has(k)).sort((a, b) => a - b);
  const settle = walls.reduce((a, k) => ((lengths[k] ?? 0) > (lengths[a] ?? 0) ? k : a), walls[0] ?? pair.face);
  return { walls, settle };
}

/** The ways a fit (or a measure's map check) chose for its map sides over a bump-out's face and the wall behind it; none weighed: undefined. */
export function choiceOf(fit: { turnDeg: number; sides: MapSide[] }): MapChoice | undefined {
  const pairs = fit.sides.filter((s) => s.pair && s.pair.ways.length).map((s) => ({ mapSide: s.index, pair: s.pair as MapPair }));
  return pairs.length ? { turnDeg: fit.turnDeg, pairs } : undefined;
}

/** The same walls held, both ways round: a fit made again on the outline as measured and holding what it held before. */
export function sameHolds(a: MapHold[], b: MapHold[]): boolean {
  const key = (h: MapHold) => `${h.axis}:${Math.min(h.a, h.b)}-${Math.max(h.a, h.b)}`;
  const A = new Set(a.map(key));
  return a.length === b.length && b.every((h) => A.has(key(h)));
}

// ── What the map says against the photos ─────────────────────────────────────────────────────────

/** The map against the measure, as the measure keeps it (`RouteSolution.map`). */
export interface RouteMapCheck {
  source: string;
  turnDeg: number;
  frontFacesDeg: number;
  overlap: number;
  /** The map's corners where it lies on the plan as measured: its traced sides on their walls. */
  onPlan: Pt[];
  /** Each map side and what it traces. */
  sides: MapSide[];
  /** The distances it held, each against what the photos alone made it, and what the measure made it with the map. */
  holds: (MapHold & { photosFeet: number; photosSdFeet: number | null; nowFeet: number; disagrees: boolean })[];
  /** How far the map's corners stand off the outline as measured, on average, feet: the map's corners that are on it (within 3'). */
  cornersOffFeet: number;
  /** The outline's corners off the map's outline by more than 3': + outside it (a part the map misses), - inside (a notch, or a covered area it takes in). */
  offMap: { corner: number; feet: number }[];
  /** Each side as the photos alone measured it, before the map, and the corners they made. */
  photosOnly: { from: number; lengthFeet: number; plusMinusPct: number | null; notMeasured: boolean }[];
  photosCorners: Pt[];
}

/** How far off the map a corner may stand and still be on it, feet. */
const ON_MAP_FEET = 3;

/**
 * The map laid on the outline as measured with it ([ring]): moved so the walls it traces sit on its lines (a fit is good
 * to its corners then), each corner of either off the other, and each distance held against the photos' own
 * ([photosRing], [photosSd]: the photos alone).
 */
export function mapCheck(
  map: MapOutline,
  fit: MapFit,
  ring: Pt[],
  photosRing: Pt[],
  photosSd: (a: number, b: number) => number | null,
  photosOnly: RouteMapCheck["photosOnly"],
  over: MapRoofOver = {},
): RouteMapCheck {
  const corners = ccw(map.corners);
  const now = linesOf(ring);
  const before = linesOf(photosRing);
  // Moved onto the outline as measured: each way, the length-weighted mean of the traced walls off the map's lines.
  const turned = linesOf(corners.map((p) => rot(p, fit.turnDeg)), SQUARE_DEG);
  const shift: [number, number] = [...fit.shift];
  for (const [k, axis] of (["E", "N"] as Axis[]).entries()) {
    let w = 0;
    let s = 0;
    for (const m of fit.sides) {
      if (m.axis !== axis || m.traces === null) continue;
      const t = turned[m.index] as Line;
      // The wall stands in from the line by what is in front of it (a porch's depth): the line is out past it by that.
      const lo = m.inside ? m.inside.feet : 0;
      w += m.lengthFeet;
      s += m.lengthFeet * ((now[m.traces] as Line).at + m.outward * lo - t.at);
    }
    if (w > 0) shift[k] = s / w;
  }
  const onPlan = placed(corners, fit.turnDeg, shift);
  const mapOff = onPlan.map((p) => Math.abs(offRing(p, ring)));
  const on = mapOff.filter((d) => d <= ON_MAP_FEET);
  const offMap = ring.map((p, corner) => ({ corner, feet: offRing(p, onPlan) })).filter((c) => Math.abs(c.feet) > ON_MAP_FEET);
  // The sides as traced and held; on the outline as measured, a side that would trace another wall now is said.
  const nowTraced = traceSides(onPlan, ring, over);
  // A side over a bump-out's face and the wall behind it is on the one the photos chose (or neither): never "would sit on".
  const sides = fit.sides.map((s) => {
    const now = nowTraced[s.index];
    return !s.pair && now && s.traces !== null && now.traces !== null && now.traces !== s.traces ? { ...s, nowTraces: now.traces } : s;
  });
  const holds = fit.holds.map((h) => {
    const photosFeet = Math.abs((before[h.b] as Line).at - (before[h.a] as Line).at);
    const photosSdFeet = photosSd(h.a, h.b);
    const nowFeet = Math.abs((now[h.b] as Line).at - (now[h.a] as Line).at);
    // Disagrees: the photos held it, and the map is further from them than either could be off.
    const disagrees = photosSdFeet !== null && Number.isFinite(photosSdFeet) && Math.abs(photosFeet - h.feet) > Math.max(1.5, 2 * Math.hypot(photosSdFeet, h.sdFeet));
    return { ...h, photosFeet, photosSdFeet: photosSdFeet !== null && Number.isFinite(photosSdFeet) ? photosSdFeet : null, nowFeet, disagrees };
  });
  return {
    source: map.source ?? "a map outline",
    turnDeg: fit.turnDeg,
    frontFacesDeg: frontBearing(fit.turnDeg),
    overlap: fit.overlap,
    onPlan,
    sides,
    holds,
    cornersOffFeet: on.length ? on.reduce((s, d) => s + d, 0) / on.length : NaN,
    offMap,
    photosOnly,
    photosCorners: photosRing.map((p) => ({ x: p.x, y: p.y })),
  };
}

/**
 * Which tape settles a close call, in words: one along the wall the map's side's two ends run across (the side square to
 * it, from the map side that traces the wall it meets), else along the house's depth.
 */
function depthWords(s: MapSide, check: RouteMapCheck, nameOf: (side: number) => string): string {
  const across = check.sides.filter((q) => q.traces !== null && q.axis !== null && q.axis !== s.axis).sort((p, q) => q.lengthFeet - p.lengthFeet)[0];
  return across ? `A tape or laser along ${nameOf(across.traces as number)} settles which.` : "A tape or laser along the house's depth settles which.";
}

/**
 * The map's check in plain words, sides named by [nameOf] (side index -> "C3-C4 Fence side"): how it was laid, where
 * it and the photos disagree, the map's sides that are not the whole wall under them, and the parts it leaves out or takes in.
 */
export function mapWords(check: RouteMapCheck, ringLengths: number[], nameOf: (side: number) => string = (i) => `the wall from corner ${i + 1} to corner ${((i + 1) % ringLengths.length) + 1}`): string[] {
  const ft = formatFeetInches;
  const n = ringLengths.length;
  const out: string[] = [];
  const traced = check.sides.filter((s) => s.traces !== null);
  out.push(
    `Laid on the plan from ${check.source}, turned and moved, never stretched: the front faces ${Math.round(check.frontFacesDeg)}°, ${Math.round(check.overlap * 100)}% of the two shapes shared${Number.isFinite(check.cornersOffFeet) ? `, the map's corners within ${ft(check.cornersOffFeet)} of the outline on average` : ""}. ${traced.length} of its ${check.sides.length} sides trace a wall; it holds ${check.holds.length} distance${check.holds.length === 1 ? "" : "s"} between them.`,
  );
  const porch = traced.filter((s) => s.inside && s.inside.feet > 0);
  for (const s of porch) out.push(`The map's ${ft(s.lengthFeet)} side runs along a porch roof's edge: ${nameOf(s.traces as number)} held ${ft((s.inside as { feet: number }).feet)} in from it, the porch's depth.`);
  for (const s of check.sides) if (s.axis && s.inside === null && s.traces !== null) out.push(`The map's ${ft(s.lengthFeet)} side runs along a porch roof of no known depth over ${nameOf(s.traces)}: not held.`);
  for (const h of check.holds) {
    if (!h.disagrees) continue;
    out.push(`The map and the photos disagree: ${nameOf(h.a)} to ${nameOf(h.b)} is ${ft(h.feet)} on the map, ${ft(h.photosFeet)} ±${ft(2 * (h.photosSdFeet ?? 0))} from the photos (${ft(Math.abs(h.feet - h.photosFeet))} apart). The map is held; a tape or laser along a wall between them settles which is right.`);
  }
  for (const s of traced) {
    const i = s.traces as number;
    // The map's side against the whole wall: a map side shorter than the wall it traces ends where a part it missed begins.
    const wall = ringLengths[i] as number;
    if (wall - s.lengthFeet <= 2) continue;
    const past = check.offMap.filter((c) => c.corner === i || c.corner === (i + 1) % n || c.corner === (i + 2) % n || c.corner === (i - 1 + n) % n);
    const out_ = past.filter((c) => c.feet > 0);
    const under = past.filter((c) => c.feet < 0);
    const why = out_.length ? `: the map leaves out what stands past corner ${out_.map((c) => c.corner + 1).join(" and ")}` : under.length ? `: corner ${under.map((c) => c.corner + 1).join(" and ")} is under a roof the map takes in (a porch, a covered deck)` : "";
    out.push(`The map's side along ${nameOf(i)} is ${ft(s.lengthFeet)}; the wall is ${ft(wall)}${why}. Its side is not the whole wall.`);
  }
  for (const s of traced) {
    if (s.close) out.push(`A close call: the map's ${ft(s.lengthFeet)} side is held on ${nameOf(s.traces as number)}, but it could as well be on ${nameOf(s.close.side)} (${ft(Math.abs(s.close.offFeet))} ${s.close.offFeet > 0 ? "out" : "in"} from it). ${depthWords(s, check, nameOf)}`);
    else if (s.nowTraces !== undefined) out.push(`On the house as measured, the map's ${ft(s.lengthFeet)} side held on ${nameOf(s.traces as number)} would sit on ${nameOf(s.nowTraces)} instead. ${depthWords(s, check, nameOf)}`);
  }
  // Over a bump-out's face and the wall behind it: which the photos chose, and on what - or that they didn't decide, and what
  // that leaves not measured.
  for (const s of check.sides) {
    const p = s.pair;
    if (!p || !p.ways.length) continue;
    const said = p.ways.flatMap((w) => w.against.map((a) => `${nameOf(a.to)} to ${nameOf(w.side)} ${ft(a.photosFeet)} ±${ft(2 * a.photosSdFeet)}, the map ${ft(a.mapFeet)}`)).join("; ");
    const lead = `The map's ${ft(s.lengthFeet)} side runs over a bump-out's face, ${nameOf(p.face)}, and the wall behind it, ${nameOf(p.behind)}, ${ft(p.apartFeet)} apart: a map can miss a bump-out or take in what stands beside one, so which it is on is the photos' to say.`;
    if (p.decided) {
      out.push(`${lead} The photos alone, before the map moved anything, put it on ${nameOf(p.held)} (${said}): held there.`);
      continue;
    }
    const hang = pairHangs(p, ringLengths);
    const walls = hang.walls.map(nameOf);
    const list = walls.length > 1 ? `${walls.slice(0, -1).join(", ")} and ${walls[walls.length - 1]} are` : `${walls[0]} is`;
    out.push(`${lead} The photos alone didn't decide between them (${said || "they hold nothing between it and the map's other lines"}): it is held on ${nameOf(p.held)}, as the shape under it has it, and ${list} NOT measured. A tape or laser along ${nameOf(hang.settle)}, ${s.axis === "N" ? "front corner to back corner" : "corner to corner"}, settles which.`);
  }
  for (const c of check.offMap) out.push(`Corner ${c.corner + 1} stands ${ft(Math.abs(c.feet))} ${c.feet > 0 ? "outside the map's outline: a part the map misses" : "inside the map's outline: a notch, or a covered deck or porch the map takes in"}.`);
  return out;
}
