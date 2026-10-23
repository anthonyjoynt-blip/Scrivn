/**
 * A map outline on the photo route's plan (2026-10-23): a building's footprint off a public map - Microsoft's open
 * building footprints, traced by computer from aerial photos - laid on the house as the walk and the photos measured it,
 * for the long dimension the photos can't give. Blind runs of the owner's house (10-22) fitted his true shape (66'8"
 * deep) and a short one (55'3") equally well: nothing in those photos ties the front to the back. A map outline does, to
 * a foot or two on its long walls. But it misses small parts (his 6' bump-out, a step) and may take in a deck or a covered
 * area, so it is never the answer for those - and its long side is not always the whole wall: a reviewer laying his map on
 * by eye took its 62'5" side for the whole walkway wall, which runs on 6' past it along the bump-out.
 *
 * Laid rigidly - turned and moved, never stretched (`fitMapOutline`):
 *   1. turned square to the plan, by the map's own sides; of the four quarter-turns, the one that overlaps the outline
 *      most and puts the fewest of the sizes the photos do hold against it;
 *   2. moved to overlap the outline most;
 *   3. each long side of it (15' or more) traces one wall: of the outline's walls facing the same way under it, the one at
 *      the middle of their spread, by length (a close call with a bump-out's face: the wall behind it). A bump-out it missed stands out past it, a notch or a covered deck it took in
 *      stands in from it, and neither is the wall it traces. That is read off the outline's own shape across the map's
 *      side - which walls, how long, in what order - so a depth the photos got wrong never chooses it.
 * Each two walls traced the same way are then held to the map's distance between them in the solve (`MapHold`,
 * lib/photoRoute.ts): the depth from the map, and every other size still from the photos and the tapes. Where the map and
 * the photos disagree it is said (`mapCheck`), and what the map leaves out.
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
/** Walls under one map side within this of the one it traces are the same line to the map (a garage door's 1'9" or 2' step). */
const CLUSTER_FEET = 2.5;
/** Of a map side's length, the share the wall it traces (with those level with it) must run under it. */
const TRACE_SHARE = 0.25;
/** A part standing out this little or less from the wall beside it is a bump-out: the kind of part a footprint off aerial photos misses. */
const BUMP_FEET = 10;

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
  why?: string;
  /** The outline's other sides under it facing the same way, and how far each stands out past the one it traces (+) or in from it (-), feet. */
  others: { side: number; offFeet: number }[];
  /**
   * A close call: another of them, not level with the one it traces, that the map's line could as well be on - the two
   * near enough equal by how far the walls under the map's side stand off each (within 15%). Held as traced, and said.
   */
  close?: { side: number; offFeet: number };
}

/** Two of the outline's walls held to the map's distance between them: sides [a] and [b], each the wall its map side traces. */
export interface MapHold {
  id: string;
  a: number;
  b: number;
  axis: Axis;
  feet: number;
  sdFeet: number;
  /** The map sides that trace them. */
  mapSides: [number, number];
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
function traceSides(onPlan: Pt[], ring: Pt[]): MapSide[] {
  const walls = linesOf(ring);
  const n = ring.length;
  // Corner k (where side k-1 meets side k) turns left round a counter-clockwise ring: an outside corner.
  const outside = ring.map((p, k) => {
    const a = ring[(k - 1 + n) % n] as Pt;
    const b = ring[(k + 1) % n] as Pt;
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) > 0;
  });
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
    const under = walls.filter((w) => w.axis === m.axis && w.outward === m.outward && Math.min(w.hi, m.hi) - Math.max(w.lo, m.lo) > 0.5);
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
    const seen = under.filter((w) => (share.get(w.index) ?? 0) > 0.5).sort((p, q) => p.outward * p.at - q.outward * q.at);
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
    // near enough, is a close call (house G's back: the rear wall 120 against the bump-out's back 130 sq ft).
    const offAt = (v: Line) => seen.reduce((s, w) => s + (share.get(w.index) as number) * Math.abs(w.at - v.at), 0);
    const rival = seen.filter((w) => Math.abs(w.at - traced.at) > CLUSTER_FEET).map((w) => ({ w, off: offAt(w) })).sort((p, q) => p.off - q.off)[0];
    if (!rival || rival.off > 1.15 * offAt(traced)) return { ...base, others, traces: traced.index };
    // A close call between a bump-out's face and the wall it stands out from: the map missed the bump-out (what such maps
    // miss), so it traces the wall behind. Otherwise the middle stands.
    const outer = rival.w.outward * rival.w.at > traced.outward * traced.at ? rival.w : traced;
    const inner = outer === traced ? rival.w : traced;
    const held = bumpFace(outer.index) && !bumpFace(inner.index) ? inner : traced;
    const other = held === traced ? rival.w : traced;
    const close = { side: other.index, offFeet: m.outward * (other.at - held.at) };
    return { ...base, others: seen.filter((w) => w !== held).map((w) => ({ side: w.index, offFeet: m.outward * (w.at - held.at) })), traces: held.index, close };
  });
}

/**
 * The walls the map traces, held two by two to its distances: each way across the plan, from one traced wall to the next
 * in turn. One sd: the two sides' lines, each the map's sd and half the step of any wall level with it (a garage door's
 * step: which of the two the map's line is on, it can't say). Two map sides tracing one wall: the longer. A pair the
 * outline puts the other way round is left out.
 */
function holdsOf(sides: MapSide[], ring: Pt[], sd: number): MapHold[] {
  const walls = linesOf(ring);
  const out: MapHold[] = [];
  for (const axis of ["E", "N"] as Axis[]) {
    const traced = new Map<number, MapSide>();
    for (const s of sides) {
      if (s.axis !== axis || s.traces === null) continue;
      const had = traced.get(s.traces);
      if (!had || s.lengthFeet > had.lengthFeet) traced.set(s.traces, s);
    }
    const list = [...traced.values()].sort((p, q) => p.at - q.at);
    const sdOf = (s: MapSide) => Math.hypot(sd, Math.max(0, ...s.others.filter((o) => Math.abs(o.offFeet) <= CLUSTER_FEET).map((o) => Math.abs(o.offFeet))) / 2);
    for (let k = 0; k + 1 < list.length; k++) {
      const p = list[k] as MapSide;
      const q = list[k + 1] as MapSide;
      const wp = walls[p.traces as number] as Line;
      const wq = walls[q.traces as number] as Line;
      if (wq.at - wp.at < -CLUSTER_FEET) continue;
      out.push({ id: `map:${p.index}-${q.index}`, a: p.traces as number, b: q.traces as number, axis, feet: q.at - p.at, sdFeet: Math.hypot(sdOf(p), sdOf(q)), mapSides: [p.index, q.index] });
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
 * Null when the map has fewer than three corners.
 */
export function fitMapOutline(
  map: MapOutline,
  ring: Pt[],
  opts: { sdBetween?: (a: number, b: number) => number | null; frontFacesDeg?: number | null; turnDeg?: number } = {},
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
    const sides = traceSides(onPlan, ring);
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
      w += m.lengthFeet;
      s += m.lengthFeet * ((now[m.traces] as Line).at - t.at);
    }
    if (w > 0) shift[k] = s / w;
  }
  const onPlan = placed(corners, fit.turnDeg, shift);
  const mapOff = onPlan.map((p) => Math.abs(offRing(p, ring)));
  const on = mapOff.filter((d) => d <= ON_MAP_FEET);
  const offMap = ring.map((p, corner) => ({ corner, feet: offRing(p, onPlan) })).filter((c) => Math.abs(c.feet) > ON_MAP_FEET);
  // The sides as traced and held; on the outline as measured, a side that would trace another wall now is said.
  const nowTraced = traceSides(onPlan, ring);
  const sides = fit.sides.map((s) => {
    const now = nowTraced[s.index];
    return now && s.traces !== null && now.traces !== null && now.traces !== s.traces ? { ...s, nowTraces: now.traces } : s;
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
 * The map's check in plain words, sides named by [nameOf] (side index -> "C1-C2 Walkway side"): how it was laid, where
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
    out.push(`The map's side along ${nameOf(i)} is ${ft(s.lengthFeet)}; the wall is ${ft(wall)}${past.length ? `: the map leaves out what stands past corner ${past.map((c) => c.corner + 1).join(" and ")}` : ""}. Its side is not the whole wall.`);
  }
  for (const s of traced) {
    if (s.close) out.push(`A close call: the map's ${ft(s.lengthFeet)} side is held on ${nameOf(s.traces as number)}, but it could as well be on ${nameOf(s.close.side)} (${ft(Math.abs(s.close.offFeet))} ${s.close.offFeet > 0 ? "out" : "in"} from it). ${depthWords(s, check, nameOf)}`);
    else if (s.nowTraces !== undefined) out.push(`On the house as measured, the map's ${ft(s.lengthFeet)} side held on ${nameOf(s.traces as number)} would sit on ${nameOf(s.nowTraces)} instead. ${depthWords(s, check, nameOf)}`);
  }
  for (const c of check.offMap) out.push(`Corner ${c.corner + 1} stands ${ft(Math.abs(c.feet))} ${c.feet > 0 ? "outside the map's outline: a part the map misses" : "inside the map's outline: a notch, or a covered deck or porch the map takes in"}.`);
  return out;
}
