/**
 * What the photos cover, and what to take next (2026-10-17): the photo route's live checklist. On the
 * owner's house the photos taken at 45 degrees to a corner (#6, #7, #14) held the outline together, and
 * the sides that came out weak were the ones seen only in photos showing a single corner. So, from the
 * shape and the photos so far:
 *
 *   * each corner should be in two photos at least;
 *   * each wall should have one photo with both its corners in (what measures it);
 *   * each outside corner should have a photo at 45 degrees to it, both walls in;
 *   * each wall a few feet long or more should have one photo straight on, both corners in;
 *   * a gable wall should have one square on, its peak in.
 *
 * Advice only, never a block: Measure works whatever this says. Before a measure the list is the photos
 * to take, from the shape (each outside corner at 45 degrees, each wall straight on), ticked off as
 * they are taken from it - a photo added any other way can't be judged until a measure places it. After
 * one, it is what is still thin: a photo counts for every corner its solved camera sees, and only if
 * it could be placed, since a photo the solve could not place helps nothing.
 *
 * Plan feet, x east, y north, the street at the bottom, as lib/photoRoute.ts; left and right as seen
 * from the street.
 */

import { neighbourBlocks, partyCorners, type RouteMeasured, type RouteShot } from "./photoRoute";
import { levelAxes, type PhotoCamera } from "./photoRouteLens";
import { planDirection } from "./photoRouteSolve";
import type { Pt } from "./roof";

/** Where a placed photo was taken from and which way it looked, in plan feet: enough to say what it shows. */
export interface CoverageView {
  photo: string;
  at: [number, number];
  /** Unit plan direction the camera looked. */
  forward: [number, number];
  /** Half the width it saw, radians. */
  halfFov: number;
}

export interface CoverageInput {
  /** The shape, measured or as drawn: corners counter-clockwise from above. */
  ring: Pt[];
  /** Placed photos (after a measure). */
  views: CoverageView[];
  /** Before a measure, or for photos not placed: the corners tapped on each, numbered. */
  taps: { photo: string; corner: number }[];
  /** Photos taken from the shot list, by what they were taken for. */
  shots: { photo: string; shot: RouteShot }[];
  /** True once there is a measure: then only placed photos count. */
  measured: boolean;
  /** Walls (outline side indices) that are gable ends, as answered or read. */
  gables?: number[];
  /** A wall's name, when the exterior has one (outline side index → "Rear 2"). */
  wallName?: (side: number) => string | null;
  /** Walls shared with a neighbour's home (2026-10-17): never asked for, and the neighbour's home hides what is past them. */
  shared?: number[];
  /** A tape on a wall running back from the street (the depth), for a home whose depth no photo can see. */
  depthTaped?: boolean;
}

export type CoverageKind = "corner-seen" | "wall-both" | "corner-45" | "wall-straight" | "gable" | "depth-tape";

export interface CoverageItem {
  key: string;
  kind: CoverageKind;
  /** The corner or the wall (outline side index) it is about. */
  corner?: number;
  wall?: number;
  /** In plain words, with where to stand. */
  words: string;
  /** The photo that would fix it, for the camera. */
  shot: RouteShot;
}

export interface Coverage {
  corners: { index: number; outside: boolean; photos: string[]; at45: boolean }[];
  walls: { from: number; feet: number; both: string[]; straight: boolean }[];
  /** What is still thin, most useful first. Empty when the photos cover the house. */
  items: CoverageItem[];
}

/** A corner seen this near its bisector counts as 45 degrees to both walls. */
const AT45_DEG = 25;
/** A wall seen this near its normal counts as straight on. */
const STRAIGHT_DEG = 30;
/** A wall shorter than this (a step beside a garage bay, a pilaster) needs no photo straight on: the corner photos either side show it. */
const STRAIGHT_MIN_FEET = 6;
/** The edges of a photo: a corner this near them is not counted as in it. */
const EDGE_FRACTION = 0.04;
const DEG = Math.PI / 180;

const segLen = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function outward(a: Pt, b: Pt): Pt {
  const L = segLen(a, b) || 1;
  return { x: (b.y - a.y) / L, y: -(b.x - a.x) / L };
}

/** Left turn at corner k of a counter-clockwise ring: an outside corner. */
function isOutside(ring: Pt[], k: number): boolean {
  const n = ring.length;
  const a = ring[(k - 1 + n) % n] as Pt;
  const b = ring[k] as Pt;
  const c = ring[(k + 1) % n] as Pt;
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0;
}

/** The corner's outward bisector: the way to stand to see it at 45 degrees (into it, for an inside corner). */
function bisector(ring: Pt[], k: number): Pt {
  const n = ring.length;
  const n1 = outward(ring[(k - 1 + n) % n] as Pt, ring[k] as Pt);
  const n2 = outward(ring[k] as Pt, ring[(k + 1) % n] as Pt);
  const s = { x: n1.x + n2.x, y: n1.y + n2.y };
  const L = Math.hypot(s.x, s.y) || 1;
  return { x: s.x / L, y: s.y / L };
}

/** The first side a ray from c along d meets, and how far. */
function firstHit(c: Pt, d: Pt, ring: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % ring.length] as Pt;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den;
    const s = ((a.x - c.x) * d.y - (a.y - c.y) * d.x) / den;
    if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.min(best, t);
  }
  return best;
}

/** Whether a placed photo shows plan point P: ahead, inside the picture, nothing of the house in the way. */
function shows(v: CoverageView, P: Pt, ring: Pt[], shared: Set<number> = new Set()): boolean {
  const dx = P.x - v.at[0];
  const dy = P.y - v.at[1];
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return false;
  const cos = (dx * v.forward[0] + dy * v.forward[1]) / dist;
  const sin = (v.forward[0] * dy - v.forward[1] * dx) / dist;
  if (cos <= 0.05) return false;
  // Inside the picture, a margin off its edges: its column's tan against the half width's.
  if (Math.abs(sin / cos) > Math.tan(v.halfFov) * (1 - 2 * EDGE_FRACTION)) return false;
  return firstHit({ x: v.at[0], y: v.at[1] }, { x: dx / dist, y: dy / dist }, ring) >= dist - 0.5 && !neighbourBlocks({ x: v.at[0], y: v.at[1] }, P, ring, shared);
}

/** A wall running back from the street (north-south on the plan): what a home's depth is seen along. */
const runsBack = (A: Pt, B: Pt) => Math.abs(B.x - A.x) < Math.abs(B.y - A.y);

/**
 * Whether no photo can see the home's depth (2026-10-17, a middle townhouse): every wall running back from the
 * street is shared, so the front and the back are all the photos see. One tape of the depth then measures it.
 */
function depthHidden(ring: Pt[], shared: Set<number>): boolean {
  if (shared.size === 0) return false;
  const n = ring.length;
  return !ring.some((A, i) => {
    const B = ring[(i + 1) % n] as Pt;
    return runsBack(A, B) && !shared.has(i) && segLen(A, B) >= STRAIGHT_MIN_FEET;
  });
}

const DEPTH_WORDS = "Tape the depth once, front wall to back wall – along the fence or inside: no photo can see it past the neighbours' homes.";

/** The angle, degrees, between the way a photo looked at P and direction d out of the house there. */
function angleOff(v: CoverageView, P: Pt, d: Pt): number {
  const dx = v.at[0] - P.x;
  const dy = v.at[1] - P.y;
  const L = Math.hypot(dx, dy) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (dx * d.x + dy * d.y) / L))) / DEG;
}

/** Where corner k is on the house, as seen from the street: "back left", "front right", "back, middle". */
export function cornerPlace(ring: Pt[], k: number): string {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const W = Math.max(...xs) - x0 || 1;
  const H = Math.max(...ys) - y0 || 1;
  const P = ring[k] as Pt;
  const fx = (P.x - x0) / W;
  const fy = (P.y - y0) / H;
  const fb = fy <= 0.3 ? "front" : fy >= 0.7 ? "back" : null;
  const lr = fx <= 0.3 ? "left" : fx >= 0.7 ? "right" : null;
  if (fb && lr) return `${fb} ${lr}`;
  if (fb) return `${fb}, middle`;
  if (lr) return `${lr} side`;
  return "middle";
}

/** Where to stand, out along direction d from the house: "from the back left", "from the street", "from the left side". */
function standWords(d: Pt): string {
  const fb = d.y < -0.38 ? "front" : d.y > 0.38 ? "back" : null;
  const lr = d.x < -0.38 ? "left" : d.x > 0.38 ? "right" : null;
  if (fb && lr) return `from the ${fb} ${lr}`;
  if (fb === "front") return "from the street";
  if (fb === "back") return "from the back yard";
  if (lr) return `from the ${lr} side`;
  return "from outside";
}

function cornerWords(ring: Pt[], k: number): string {
  return `Corner ${k + 1} (${isOutside(ring, k) ? "" : "inside, "}${cornerPlace(ring, k)})`;
}

/**
 * Before a measure: the photos to take, from the shape - each outside corner at 45 degrees, each wall a few feet long
 * or more straight on (a gable square on, its peak in) - less those already taken from this list. Photos added any
 * other way can't be judged until a measure places them.
 */
function shotList(ring: Pt[], shots: { shot: RouteShot }[], gables: Set<number>, wallName: (i: number) => string, shared: Set<number>, depthTaped: boolean): CoverageItem[] {
  const n = ring.length;
  const items: CoverageItem[] = [];
  const taken = (kind: RouteShot["kind"], index: number) => shots.some((s) => s.shot.kind === kind && s.shot.index === index);
  const party = partyCorners(n, shared);
  ring.forEach((_, k) => {
    // Where this home ends is no corner to stand at 45 degrees to: the neighbour's home is there.
    if (!isOutside(ring, k) || taken("corner", k) || party.has(k)) return;
    items.push({
      key: `corner-45:${k}`,
      kind: "corner-45",
      corner: k,
      words: `${cornerWords(ring, k)}: stand ${standWords(bisector(ring, k)).replace(/^from /, "at ")}, at 45° to its two walls, both walls in.`,
      shot: { kind: "corner", index: k },
    });
  });
  ring.forEach((A, i) => {
    const B = ring[(i + 1) % n] as Pt;
    if (segLen(A, B) < STRAIGHT_MIN_FEET || taken("wall", i) || shared.has(i)) return;
    const nrm = outward(A, B);
    const gable = gables.has(i);
    items.push({
      key: `${gable ? "gable" : "wall-straight"}:${i}`,
      kind: gable ? "gable" : "wall-straight",
      wall: i,
      words: `${wallName(i)}${gable ? ", a gable" : ""}: straight on ${standWords(nrm)}, both corners${gable ? " and its peak" : ""} in.`,
      shot: { kind: "wall", index: i },
    });
  });
  if (depthHidden(ring, shared) && !depthTaped) items.push(depthItem(ring, shared));
  return items;
}

/** The depth to tape: about no wall a photo can be taken of, so none is marked for it. */
function depthItem(ring: Pt[], shared: Set<number>): CoverageItem {
  void ring;
  return { key: "depth-tape", kind: "depth-tape", words: DEPTH_WORDS, shot: { kind: "wall", index: [...shared][0] ?? 0 } };
}

/** Each placed photo of a measure as what it saw: where it stood, the way it looked, and how wide. */
export function viewsFromMeasure(m: RouteMeasured): CoverageView[] {
  return m.cameras.flatMap((c) => {
    const lens = m.lenses[c.photo];
    if (!lens) return [];
    const cam: PhotoCamera = { width: lens.width, height: lens.height, f: lens.f, k: lens.k, R: lens.R as PhotoCamera["R"] };
    const { zl } = levelAxes(cam);
    const forward = planDirection(Math.atan2(zl[0], zl[2]), c.quadrant, (c.yawTweakDeg * Math.PI) / 180);
    return [{ photo: c.photo, at: c.at, forward, halfFov: Math.atan(lens.width / 2 / lens.f) }];
  });
}

/**
 * The checklist: what the photos so far cover, and the photos still worth taking, in plain words.
 */
export function routeCoverage(inp: CoverageInput): Coverage {
  const { ring } = inp;
  const n = ring.length;
  if (n < 3) return { corners: [], walls: [], items: [] };
  const wallName = (i: number) => {
    const name = inp.wallName?.(i)?.trim();
    return name ? `The ${name} wall (corners ${i + 1} to ${((i + 1) % n) + 1})` : `The wall from corner ${i + 1} to ${((i + 1) % n) + 1}`;
  };
  // Which photos show each corner.
  const sees = new Map<number, Set<string>>();
  const add = (k: number, photo: string) => (sees.get(k) ?? sees.set(k, new Set()).get(k))?.add(photo);
  const placed = new Set(inp.views.map((v) => v.photo));
  const shared = new Set(inp.shared ?? []);
  const party = partyCorners(n, shared);
  for (const v of inp.views) for (let k = 0; k < n; k++) if (shows(v, ring[k] as Pt, ring, shared)) add(k, v.photo);
  for (const t of inp.taps) {
    if (t.corner < 0 || t.corner >= n) continue;
    // After a measure only placed photos count: one the solve could not place helps nothing.
    if (inp.measured && !placed.has(t.photo)) continue;
    add(t.corner, t.photo);
  }
  // Before a measure, a photo from the shot list counts for what it was taken for.
  const shotOf = new Map(inp.shots.map((s) => [s.photo, s.shot]));
  if (!inp.measured) {
    for (const { photo, shot } of inp.shots) {
      if (shot.kind === "corner") add(shot.index, photo);
      else {
        add(shot.index, photo);
        add((shot.index + 1) % n, photo);
      }
    }
  }
  const corners = ring.map((P, k) => {
    const out = isOutside(ring, k);
    const d = bisector(ring, k);
    const at45 =
      inp.views.some((v) => shows(v, P, ring, shared) && angleOff(v, P, d) <= AT45_DEG) ||
      (!inp.measured && inp.shots.some((s) => s.shot.kind === "corner" && s.shot.index === k));
    return { index: k, outside: out, photos: [...(sees.get(k) ?? [])], at45 };
  });
  const walls = ring.map((A, i) => {
    const B = ring[(i + 1) % n] as Pt;
    const a = sees.get(i) ?? new Set<string>();
    const b = sees.get((i + 1) % n) ?? new Set<string>();
    const both = [...a].filter((p) => b.has(p));
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const nrm = outward(A, B);
    const straight =
      inp.views.some((v) => both.includes(v.photo) && angleOff(v, mid, nrm) <= STRAIGHT_DEG) ||
      (!inp.measured && both.some((p) => shotOf.get(p)?.kind === "wall" && shotOf.get(p)?.index === i));
    return { from: i, feet: segLen(A, B), both, straight };
  });

  const gables = new Set(inp.gables ?? []);
  if (!inp.measured) return { corners, walls, items: shotList(ring, inp.shots, gables, wallName, shared, inp.depthTaped === true) };

  const items: CoverageItem[] = [];
  for (const c of corners) {
    if (c.photos.length >= 2) continue;
    // Where this home ends: stood in front of the wall it ends, not at 45 degrees (the neighbour's home is there).
    const open = party.has(c.index) ? openWallNormal(ring, c.index, shared) : null;
    const d = open ?? bisector(ring, c.index);
    const where = open ? `take one ${standWords(d)}, the line where this home ends in it` : c.outside ? `take one ${standWords(d)}, at 45° to its two walls` : `take one ${standWords(d)}, looking into it`;
    items.push({
      key: `corner-seen:${c.index}`,
      kind: "corner-seen",
      corner: c.index,
      words: `${cornerWords(ring, c.index)} is ${c.photos.length === 0 ? "in no photo yet" : "only in one photo"}: ${where}.`,
      shot: { kind: "corner", index: c.index },
    });
  }
  for (const w of walls) {
    if (w.both.length > 0 || shared.has(w.from)) continue;
    const nrm = outward(ring[w.from] as Pt, ring[(w.from + 1) % n] as Pt);
    items.push({
      key: `wall-both:${w.from}`,
      kind: "wall-both",
      wall: w.from,
      words: `${wallName(w.from)} has no photo with both its corners in: take one straight on ${standWords(nrm)}, both corners in.`,
      shot: { kind: "wall", index: w.from },
    });
  }
  for (const c of corners) {
    if (!c.outside || c.at45 || c.photos.length < 2 || party.has(c.index)) continue;
    items.push({
      key: `corner-45:${c.index}`,
      kind: "corner-45",
      corner: c.index,
      words: `No photo looks at ${cornerWords(ring, c.index).replace(/^Corner/, "corner")} at 45°: take one ${standWords(bisector(ring, c.index))}, both walls in.`,
      shot: { kind: "corner", index: c.index },
    });
  }
  const straightNeeded = walls.filter((w) => !w.straight && w.both.length > 0 && w.feet >= STRAIGHT_MIN_FEET && !shared.has(w.from)).sort((a, b) => b.feet - a.feet);
  for (const w of straightNeeded) {
    const nrm = outward(ring[w.from] as Pt, ring[(w.from + 1) % n] as Pt);
    const gable = gables.has(w.from);
    items.push({
      key: `${gable ? "gable" : "wall-straight"}:${w.from}`,
      kind: gable ? "gable" : "wall-straight",
      wall: w.from,
      words: gable
        ? `${wallName(w.from)} is a gable: take one square on ${standWords(nrm)}, its peak and both corners in.`
        : `No photo faces ${wallName(w.from).replace(/^The/, "the")} straight on: take one ${standWords(nrm)}, both corners in.`,
      shot: { kind: "wall", index: w.from },
    });
  }
  if (depthHidden(ring, shared) && !inp.depthTaped) items.push(depthItem(ring, shared));
  return { corners, walls, items };
}

/** At a corner where this home ends: the outward normal of its wall that is not shared - the way to stand to see it. */
function openWallNormal(ring: Pt[], k: number, shared: Set<number>): Pt | null {
  const n = ring.length;
  const before = (k - 1 + n) % n;
  const open = !shared.has(k) ? k : !shared.has(before) ? before : null;
  if (open === null) return null;
  return outward(ring[open] as Pt, ring[(open + 1) % n] as Pt);
}
