/**
 * Scrivn's photo route for exteriors (2026-10-16): the house's photos, the corners tapped on them and
 * a few tapes become its outline, every wall's length with its ± and where each photo was taken.
 * No AR, no Scan, no server: it all runs in the browser (the PWA), on any phone.
 *
 * The owner's proof of 10-16 (photo-route-proof/README.md) did this by hand with OpenCV: 18 photos and
 * 3 tapes, 129 bearings picked by eye, outline within 2-4% on 8 of 12 sides. Here the app does what
 * it can on its own and asks the user only for what it cannot:
 *
 *   THE USER  draws the house's shape rough (the plan's outline tool), taps each corner of the house
 *             on each photo where it meets the ground, and puts in a few tapes (a line on a photo
 *             across a garage door or a window, or a wall's length typed).
 *   THE APP   levels every photo and fits the lens from straight edges (lib/photoRouteLens.ts), snaps
 *             each tap onto the corner's edge (lib/photoRouteEdges.ts), places the cameras from the
 *             corners, then finds the edges of windows, doors and trim on each wall and ties the ones
 *             two photos agree on, as the proof's 129 bearings did, and solves it all together
 *             (lib/photoRouteSolve.ts). Scale comes only from the tapes.
 *
 * See the design note in the session notes (photo-route-design.md) for why corners and not more.
 *
 * Plan feet, x east, y north, the street at the bottom, as lib/exteriorPlan.ts. One building per
 * `RouteBuilding`; photos and their lens are shared, so a shed can later be tapped in the same photos.
 */

import { type HomeType, isAttachedHome } from "./exterior";
import type { Pt } from "./roof";
import { fromLevel, type PhotoCamera, levelAxes, planBearing, toLevel } from "./photoRouteLens";
import { snapToEdge, type UprightEdge } from "./photoRouteEdges";
import { formatFeetInches } from "./sketch";
import { isWalkShape, type RouteWalk, type WalkTag } from "./photoRouteWalk";
import type { Gray } from "./photoRouteLines";
import { fitMapOutline, mapCheck, type MapFit, type MapHold, type MapOutline, type RouteMapCheck, sameHolds } from "./photoRouteMap";
import { planDirection, resect, type SolveBearing, type SolveCamera, type SolveDistance, type SolveInput, type SolvePoint, type SolveWall, solvePlan, type Solution } from "./photoRouteSolve";

export const PHOTO_ROUTE_FORMAT = "scrivn-photo-route/1";

// ── What the user gives ──────────────────────────────────────────────────────────────────────────

export interface RoutePhoto {
  /** The claim photo's id (lib/photos.ts), filed to Exterior. */
  id: string;
  /** As stored (at most 2,000 px a side, upright). */
  width: number;
  height: number;
  /** f/W from the camera file's 35 mm focal, read before the photo was drawn again (lib/photoRouteExif.ts). Null when the file had none. */
  focalPrior?: number | null;
  /** When it was taken (ms). The photos of a walk round the house are taken in order, so the ones either side in time stood nearby. */
  takenAt?: number | null;
  /**
   * What it was taken for, when it was taken from the checklist's "Take it" (2026-10-17, lib/photoRouteCoverage.ts):
   * a corner at 45 degrees, or a wall straight on. It names its own corners: the tap nearest its middle is that
   * corner, or its two end taps that wall's corners.
   */
  shot?: RouteShot;
  /**
   * Where the user stood for it (2026-10-20, every photo counts), tapped on the shape as drawn (plan feet, rough): asked of
   * a photo with one corner, or none, that its edges could not place for sure. The photo is then put on its corner's ray
   * nearest there, or searched round there, and held there loosely - in place of the hand-height guess, which a corner
   * tapped on a porch deck or a step throws off.
   */
  standAt?: [number, number];
  /**
   * Its place on the walk round the house (2026-10-21, lib/photoRouteWalk.ts): the front, side k or corner k (outside or
   * inside, and at an inside corner which wall). Set by the walk as each photo is taken; with the lap closed it also sets
   * `shot`, on the shape the lap makes.
   */
  walk?: WalkTag;
  /**
   * Which way the camera looked, roughly, on the plan (a unit vector, x east, y north) - from the step of the walk round
   * the house it was taken at (2026-10-21): the front looks north at the house, a corner's 45 looks in across that corner.
   * Two corners fit a photo placed on any of four quarter-turns; one facing well away from this is not where it was taken.
   * Absent: from `shot` on the building's shape, or not known.
   */
  facing?: [number, number];
}

/**
 * What a photo was taken for, from the checklist: a corner (outline index) at 45 degrees, or a wall (outline side index)
 * straight on; or (2026-10-21, the walk's front) a run of walls straight on, from corner `index` round to corner `to` -
 * the whole front, steps and all, its leftmost corner `index` and its rightmost `to`; or the wall before or after the
 * walk's inside corner `index`.
 */
export type RouteShot =
  /**
   * A corner at 45 degrees. `far` (2026-10-22, cleaner input): taken from far back, the whole of both walls in - corner
   * `index` is in it, but not always in the middle (a far-back photo at the front's right corner framed the whole front),
   * and the corners either side of it are whichever the photo shows: named by fitting, the run of corners that holds
   * `index` and looks the way the photo was taken.
   */
  | { kind: "corner"; index: number; far?: true }
  | { kind: "wall"; index: number }
  /** `far` (2026-10-22): from far back - its corners are among the run's, not necessarily its two ends. */
  | { kind: "run"; index: number; to: number; far?: true }
  /** The walk's inside corner (2026-10-21): a wall either side of it straight on, the inside corner tapped first, then the wall's other end. */
  | { kind: "inside"; index: number; wall: "before" | "after" };

/** A corner of the house tapped on a photo, where it meets the ground: its index on the building's outline. */
export interface CornerTap {
  photo: string;
  corner: number;
  /** In the stored photo's pixels. */
  x: number;
  y: number;
  /** Who said which corner it is: the app numbering it, or the user changing that. Absent: the app. */
  by?: "app" | "user";
  /**
   * Where this home ends (2026-10-17, attached homes): tapped on a front or back photo at the party line - often a
   * downspout, a trim line, or where the siding or colour changes. It is a corner of a shared wall, and numbered
   * only as one; what lies past it is the neighbour's and is not measured.
   */
  party?: true;
  /**
   * Put on the corner's edge already, to the pixel (2026-10-20): by someone working from a close-up, not a finger. It is
   * taken as placed, not snapped: on ribbed metal or board-and-batten the strongest edge within the snap's reach is
   * often a rib beside the corner. The app's own taps never set it.
   */
  exact?: true;
  /**
   * With `exact`: the corner's edge marked from its foot (x, y) up to here, on one upright edge. Its column is read where
   * that edge crosses the photo's horizon, which a small error in the photo's levelling moves least (a tilt of half a
   * degree moves the foot's column 5 px or more); the foot still says how high the camera stood.
   */
  top?: [number, number];
  /**
   * Marked by Scrivn after a measure (2026-10-17, `proposeCorners`): where this corner of the shape should be on
   * this photo, seen from where the photo was placed, on the edge nearest. Left out of the solve until the user
   * keeps it ("Looks right"); a tap on it takes it away.
   */
  proposed?: true;
  /**
   * Tapped this far over the ground, feet (2026-10-22): its foot on a deck, a porch or a step, where the corner shows. The
   * camera's height over the ground - which sets the ground line of every side squared from the photo - is read from the
   * tap plus this. Absent: tapped where the corner meets the ground.
   */
  aboveGround?: number;
}

export type TapeWhat = "garage" | "door" | "window" | "wall" | "other";

/**
 * A tape: a line dragged on a photo across what was taped (its ends land on upright edges - a door's
 * jambs, a window's trim - on one wall), or a wall's length typed from corner to corner.
 */
export type RouteTape =
  /** `exact`: its ends were put where the tape's ends were, to the pixel (a door's opening inside its trim): not snapped, as `CornerTap.exact`. */
  | { id: string; kind: "line"; photo: string; a: [number, number]; b: [number, number]; feet: number; what: TapeWhat; exact?: true }
  | { id: string; kind: "side"; /** The side from outline corner `from` to the next. */ from: number; feet: number };

/**
 * A side's length as someone at the house judged it by eye (2026-10-21): "the bump-out sticks out about 6'", "the back
 * wall is about 15'". Never a tape. By default it only checks the measure (`use` "check"): the solve is left as the
 * photos and tapes make it, and a side the measure puts further from what was said than its ± is said to disagree, with
 * a tape asked for. Held ("hold"), the side is held to it loosely instead, its ± read as the route reads its own (about
 * two sd), and still worked out from the photos and marked to check. Blind run E and the owner's own house (10-21) showed
 * why "check" is the default: held, a guess fixed a side the photos had 100% out, but dragged one they had right 15%.
 */
export interface RouteEstimate {
  id: string;
  /** The side from outline corner `from` to the next. */
  from: number;
  feet: number;
  /** How far it may be out, ± percent: 20 when the person said nothing. */
  plusMinusPct: number;
  /** "check" (the default): compared with the measure, which it never moves; "hold": held in the solve, loosely. */
  use?: "check" | "hold";
}

/** A rough size's ± when none was said: someone standing at the house gets a wall within about a fifth by eye. */
export const ESTIMATE_PLUS_MINUS_PCT = 20;

/** A side's length against what was estimated on site: how far off, and whether past the estimate's ±. */
export function checkEstimate(lengthFeet: number, e: Pick<RouteEstimate, "feet" | "plusMinusPct">): EstimateCheck {
  const pm = e.plusMinusPct > 0 ? e.plusMinusPct : ESTIMATE_PLUS_MINUS_PCT;
  const off = (lengthFeet / e.feet - 1) * 100;
  return { feet: e.feet, plusMinusPct: pm, offPct: Math.round(off * 10) / 10, disagrees: Math.abs(off) > pm };
}

/**
 * A measure and a size estimated on site that disagree, in words, from "estimated": "estimated on site at about 7', but
 * the photos make it 12'0": 71% longer, more than the estimate's ±20%. Tape it to see which is right."
 */
export function estimateDisagreement(lengthFeet: number, c: EstimateCheck): string {
  return `estimated on site at about ${formatFeetInches(c.feet)}, but the photos make it ${formatFeetInches(lengthFeet)}: ${Math.round(Math.abs(c.offPct))}% ${c.offPct > 0 ? "longer" : "shorter"}, more than the estimate's ±${c.plusMinusPct}%. Tape it to see which is right.`;
}

export interface RouteBuilding {
  id: string;
  name?: string;
  /** Semi-detached or a townhouse (2026-10-17): said first, one tap; it marks the shared sides, which a tap on a wall changes. */
  homeType?: HomeType;
  /** The outline's sides shared with a neighbour's home (party walls), by side index: not photographed, not measured on. */
  shared?: number[];
  /** The shape as drawn: corners in order round the house (counter-clockwise from above, as the plan draws them). Sizes rough. */
  outline: Pt[];
  corners: CornerTap[];
  tapes: RouteTape[];
  /** Sides' lengths estimated on site, by eye: held loosely, never as tapes. */
  estimates?: RouteEstimate[];
  /** "walk": the shape is the one the walk round the house made (2026-10-21, `lapOutline`): its turns as walked, its sizes rough. */
  outlineFrom?: "walk";
  /**
   * Its outline off a map (2026-10-23, lib/photoRouteMap.ts): a building footprint, feet, x east and y north. Laid on the
   * outline as the photos measure it, rigidly, its long sides hold the walls they trace to the map's distances - the depth
   * the photos can't fix - and where the two disagree it is said.
   */
  map?: MapOutline;
}

export interface PhotoRouteInput {
  photos: RoutePhoto[];
  buildings: RouteBuilding[];
}

/** The route as kept on the exterior (`Exterior.photoRoute`): its inputs, and what the last measure said. */
export interface PhotoRouteState extends PhotoRouteInput {
  format: typeof PHOTO_ROUTE_FORMAT;
  measured?: RouteMeasured | null;
  /** "Check these" rows closed by "Looks right" (2026-10-16, lib/exteriorCheck.ts), by their keys. */
  checksClosed?: string[];
  /** The walk round the house (2026-10-21, lib/photoRouteWalk.ts): the step-by-step way in, as far as it has gone. */
  walk?: RouteWalk;
}

/** A measure, as kept: enough to show it again and to lay the photos on the sides, not the solve itself. */
export interface RouteMeasured {
  at: string;
  building: string;
  /** The lens as measured: f over the photo's width, and the radial term. */
  focalOverWidth: number;
  k: number;
  rms: number;
  corners: Pt[];
  sides: Omit<RouteSide, "sdFeet">[];
  cameras: RouteCamera[];
  unplaced: { photo: string; why: string }[];
  /** Photos with one corner or none that wait for where the user stood, with Scrivn's best places for each (solved frame). */
  doubtful?: RouteSolution["doubtful"];
  advice: { from: number; why: string }[];
  counts: RouteSolution["counts"];
  /** Each placed photo's lens and turn as measured: what lays it on a side again (lib/photoRouteExterior.ts). */
  lenses: Record<string, { f: number; k: number; R: number[]; width: number; height: number }>;
  /** The exterior side made of each outline side, by the outline's side index: measured again, a side keeps its id. */
  sideIds?: string[];
}

export function emptyPhotoRoute(): PhotoRouteState {
  return { format: PHOTO_ROUTE_FORMAT, photos: [], buildings: [{ id: "main", outline: [], corners: [], tapes: [] }], measured: null };
}

// ── What the app works from ──────────────────────────────────────────────────────────────────────

/** One photo as the solve needs it: its levelled camera, its grey (for snapping) and its upright edges. */
export interface RoutePhotoData {
  id: string;
  camera: PhotoCamera | null;
  gray: Gray;
  edges: UprightEdge[];
}

export interface RouteSide {
  /** Outline corner it runs from (to the next). */
  from: number;
  lengthFeet: number;
  /** The ± on its length, percent; null when it was taped. */
  plusMinusPct: number | null;
  /** One sd, feet, from the solve. */
  sdFeet: number;
  taped: boolean;
  /** How many photos saw it face-on enough to measure along it. */
  photos: number;
  /** Estimated on site and held (`RouteEstimate` use "hold"), untaped: what was said, which held it loosely. Its length and ± are still the measure's. */
  estimated?: { feet: number; plusMinusPct: number };
  /**
   * Estimated on site to check the measure by (`RouteEstimate` use "check", the default), untaped: what was said, how
   * far the measure is off it (percent of what was said), and whether that is past its ±. Disagreeing, one of the two
   * is wrong and a tape on the side settles which. The length and ± are the measure's, unmoved.
   */
  estimateCheck?: EstimateCheck;
  /**
   * Not measured (2026-10-22, honest sizes): a long wall the photos hold no better than ±10%, or every untaped side when the
   * tapes disagree by more than 5% held out. Why, and the one photo or measurement that would measure it. The length is
   * still the solve's, to draw with, but it is said as not measured - never printed as a size.
   */
  notMeasured?: { why: string; fix: string };
  /** Held by the map outline (2026-10-23, `RouteBuilding.map`): its length is the map's and the photos', not the photos' alone. */
  fromMap?: true;
}

/** A side's measure against a size estimated on site (`RouteSide.estimateCheck`). */
export interface EstimateCheck {
  feet: number;
  plusMinusPct: number;
  /** The measure off what was said, percent of what was said: + longer. */
  offPct: number;
  /** Off by more than the estimate's ±. */
  disagrees: boolean;
}

export interface RouteCamera {
  photo: string;
  at: [number, number];
  quadrant: number;
  /** The turn the solve put on top of the photo's vanishing points, degrees. */
  yawTweakDeg: number;
  /** The camera's height over the ground at the corners tapped in it, feet; null when none was. */
  heightFeet: number | null;
  /** How it was placed: from two or more corners, or from one corner and the wall edges it shares with the others. */
  placedBy: "corners" | "one-corner" | "edges" | "stood";
  /**
   * "detail" (2026-10-22): placed only to be read - a detail photo where the user stood for it, or a photo the self-check
   * left out of the size - on the house as the measure photos made it. It sized nothing. Absent: it is in the size solve.
   */
  role?: "detail";
}

export interface RouteSolution {
  building: string;
  /** The corners as solved, plan feet, in the outline's order. */
  corners: Pt[];
  sides: RouteSide[];
  cameras: RouteCamera[];
  /** Photos that could not be placed, and why, in plain words. */
  unplaced: { photo: string; why: string }[];
  /** Of those, the ones with one corner or none whose edges point to more than one place: where each could have been taken from. Tapping where you stood places it. */
  doubtful: { photo: string; spots: { at: [number, number]; score: number }[] }[];
  /** Bearings used: the corners tapped and the wall edges found. */
  counts: { cornerBearings: number; edgeBearings: number; edgePoints: number; tapes: number };
  /** RMS of the bearings in sd (sd 2 px). */
  rms: number;
  /** True when no tape gave it a size: lengths then follow the outline as drawn. */
  unscaled: boolean;
  /** Line tapes on photos that didn't size the house (2026-10-22: a detail photo, or one left out by the self-check): they placed that photo, nothing more. */
  tapesOnDetail?: string[];
  /** Which sides want a tape and why: advice, never a block. */
  advice: { from: number; why: string }[];
  /** The wall edges tied across photos: which side, how far along it, and the photos that saw it. */
  /** Each with the heights its photos saw it between (median, ft over their ground) and which side of it is lighter. */
  edgePoints: { id: string; side: number; along: number; photos: string[]; zLow: number; zHigh: number; polarity: 1 | -1 }[];
  /** The map outline against the measure, when the building has one (`RouteBuilding.map`): how it was laid, what it held, where it and the photos disagree. */
  map?: RouteMapCheck;
  /** For the tests and the drawings: the solve itself. */
  solution: Solution;
}

// ── The outline as walls ─────────────────────────────────────────────────────────────────────────

/** Side i runs from corner i to i+1; its wall is "w<i>": an east wall ("E") when it runs north-south, a north wall ("N") when east-west. */
export function outlineWalls(outline: Pt[]): { walls: SolveWall[]; corners: SolvePoint[] } {
  const n = outline.length;
  const walls: SolveWall[] = outline.map((a, i) => {
    const b = outline[(i + 1) % n] as Pt;
    const ns = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
    return { id: `w${i}`, axis: ns ? "E" : "N", guess: ns ? a.x : a.y };
  });
  // The plan's origin held by the first two walls (one of each way, as consecutive sides are).
  (walls[0] as SolveWall).fixed = true;
  (walls[1] as SolveWall).fixed = true;
  const corners: SolvePoint[] = outline.map((p, i) => {
    const before = walls[(i - 1 + n) % n] as SolveWall;
    const after = walls[i] as SolveWall;
    const e = before.axis === "E" ? before.id : after.id;
    const nn = before.axis === "N" ? before.id : after.id;
    return { id: `c${i}`, e, n: nn, guess: [p.x, p.y] };
  });
  return { walls, corners };
}

/** The corners of the outline from a solution's walls. */
function solvedCorners(sol: Solution, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = sol.point(`c${i}`);
    out.push({ x, y });
  }
  return out;
}

const segLen = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Outward normal of side a->b of a counter-clockwise ring: to its right. */
function outward(a: Pt, b: Pt): Pt {
  const L = segLen(a, b) || 1;
  return { x: (b.y - a.y) / L, y: -(b.x - a.x) / L };
}

function insideRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Pt;
    const b = ring[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The first side a ray from c along d meets, and where: its index, distance and the along from its start corner. */
function castRay(c: Pt, d: [number, number], ring: Pt[]): { side: number; t: number; along: number } | null {
  let best: { side: number; t: number; along: number } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % ring.length] as Pt;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den;
    const s = ((a.x - c.x) * d[1] - (a.y - c.y) * d[0]) / den;
    if (t <= 1e-6 || s < -1e-6 || s > 1 + 1e-6) continue;
    if (!best || t < best.t) best = { side: i, t, along: s * Math.hypot(ex, ey) };
  }
  return best;
}

/** A pixel's bearing as a function of the lens's radial term: the photo's own rotation and focal kept. */
function atK(cam: PhotoCamera, px: [number, number]): (k: number) => number {
  return (k) => planBearing(k === cam.k ? cam : { ...cam, k }, px[0], px[1]);
}

/** A level-image column's bearing in the photo's own plan frame (atan2(X, Z)). */
export function columnBearing(cam: PhotoCamera, u: number): number {
  const { xl, zl } = levelAxes(cam);
  const a = (u - cam.width / 2) / cam.f;
  return Math.atan2(a * xl[0] + zl[0], a * xl[2] + zl[2]);
}

/** A tap on a corner as the solve reads it: snapped onto its edge, or taken as placed when it is `exact` (its column at the horizon when its edge's `top` is given). */
function tapOnEdge(gray: Gray, cam: PhotoCamera, t: Pick<CornerTap, "x" | "y" | "exact" | "top">): { u: number; v: number; onEdge: boolean; px: [number, number] } {
  const [u0, v] = toLevel(cam, t.x, t.y);
  if (t.exact && t.top) {
    const [ut, vt] = toLevel(cam, t.top[0], t.top[1]);
    // Along the edge in the level image, to the horizon's row (the middle row of a level image).
    const along = Math.abs(v - vt) < 1 ? 0.5 : (v - cam.height / 2) / (v - vt);
    return { u: u0 + (ut - u0) * along, v, onEdge: true, px: [t.x, t.y] };
  }
  if (t.exact) return { u: u0, v, onEdge: true, px: [t.x, t.y] };
  const s = snapToEdge(gray, cam, t.x, t.y);
  return { u: s.u, v, onEdge: s.onEdge, px: [s.x, s.y] };
}

// ── The corners' numbers ─────────────────────────────────────────────────────────────────────────

/**
 * The app's number for each corner tap the user did not number (2026-10-16): so a user taps corners
 * and does not have to say which.
 *
 * Facing a house, its corners run left to right in the outline's own order (each next side is to the
 * right). So a photo's taps, left to right, are some run of the outline's corners, perhaps skipping one
 * or two hidden behind a wing. Every such run is tried, each with the four quarter-turns, and the
 * camera placed from it on the shape: a run is possible only if the camera then sees those corners
 * ahead, from outside the house, with the walls between them facing it. Of those, the one that fits
 * best and sees its walls most face-on wins, and where two corners leave it open, the one that puts
 * the camera nearest the photos taken just before and after it. A number the user gave is kept, and
 * the runs must agree with it.
 *
 * A photo with one tap gets no number: one bearing cannot say which corner it is, and the pane asks.
 */
export function numberCorners(input: PhotoRouteInput, buildingId: string, data: RoutePhotoData[], outline?: Pt[]): CornerTap[] {
  const b = input.buildings.find((x) => x.id === buildingId);
  if (!b) throw new Error(`No building ${buildingId}`);
  const ring = outline ?? b.outline;
  const n = ring.length;
  const byId = new Map(data.map((d) => [d.id, d]));
  const out = b.corners.map((c) => ({ ...c }));
  const shared = new Set(b.shared ?? []);
  const party = partyCorners(n, shared);
  const time = new Map(input.photos.map((p, i) => [p.id, p.takenAt ?? i]));
  const shotOf = new Map(input.photos.filter((p) => p.shot).map((p) => [p.id, p.shot as RouteShot]));
  const walkedPhotos = new Set(input.photos.filter((p) => p.walk).map((p) => p.id));
  const photoIds = [...new Set(out.map((c) => c.photo))];
  const chosen = new Map<string, [number, number]>();
  type Job = { id: string; idx: number[]; snapped: SnappedTap[] };
  const jobs: Job[] = [];
  for (const id of photoIds) {
    const d = byId.get(id);
    if (!d?.camera) continue;
    const idx = out.map((c, i) => (c.photo === id && !c.proposed ? i : -1)).filter((i) => i >= 0);
    const snapped = idx.map((i) => {
      const t = out[i] as CornerTap;
      const s = tapOnEdge(d.gray, d.camera as PhotoCamera, t);
      return { photo: id, corner: t.corner, ...s, bearing: columnBearing(d.camera as PhotoCamera, s.u), aboveGround: t.aboveGround ?? 0 };
    });
    // Left to right in the photo.
    const order = snapped.map((_, k) => k).sort((p, q) => (snapped[p] as SnappedTap).u - (snapped[q] as SnappedTap).u);
    jobs.push({ id, idx: order.map((k) => idx[k] as number), snapped: order.map((k) => snapped[k] as SnappedTap) });
  }
  // Photos with more taps first: they leave the fewest answers, and place the walk the others are judged by.
  jobs.sort((p, q) => q.idx.length - p.idx.length);
  for (const job of jobs) {
    const m = job.idx.length;
    const user = job.idx.map((i) => ((out[i] as CornerTap).by === "user" && (out[i] as CornerTap).corner >= 0 ? (out[i] as CornerTap).corner : -1));
    // A photo from the checklist names its own: the tap nearest its middle is the corner it was taken for, or its two end
    // taps the corners of the wall. The user's own number stands over it; where the shot fits no placement, it is dropped.
    const shot = shotOf.get(job.id);
    // A photo of the walk round the house is what the walk says it is: its names stand even where the shape - rough, from
    // the lap - fits no placement; the app numbers only the taps they leave (2026-10-21: fitted freely on the lap's shape,
    // 31 of 83 taps on a walk of the owner's house came out wrong).
    const walked = !!shot && walkedPhotos.has(job.id);
    // A far-back photo names no tap by its place in the picture (2026-10-22): a corner's says only that the corner is
    // among them, and it looked in across that corner; a run's (the front, the back) that its corners are the run's.
    const farCorner = shot?.kind === "corner" && shot.far ? ((shot.index % n) + n) % n : -1;
    const farRun = shot?.kind === "run" && shot.far ? runCorners(shot.index, shot.to, n) : null;
    const fromShot = user.some((c) => c >= 0) || !shot || farCorner >= 0 || farRun ? null : shotNames(shot, job.snapped, cameraWidth(byId.get(job.id)), n, job.idx, walked);
    if (m < 2) {
      const only = job.idx[0] as number;
      if ((user[0] as number) >= 0) continue;
      // One tap: one bearing cannot say which corner it is - unless the photo was taken for that corner.
      const named = fromShot?.[0] ?? -1;
      (out[only] as CornerTap).corner = named;
      if (named >= 0) (out[only] as CornerTap).by = "app";
      continue;
    }
    if (user.every((c) => c >= 0)) continue;
    if (walked && fromShot && fromShot.every((c) => c >= 0)) {
      job.idx.forEach((i, k) => {
        (out[i] as CornerTap).corner = fromShot[k] as number;
        (out[i] as CornerTap).by = "app";
      });
      continue;
    }
    let userSet = fromShot ?? user;
    const facing = facingOf(input.photos.find((p) => p.id === job.id), ring);
    // The photos either side in time that are placed.
    const t0 = time.get(job.id) ?? 0;
    const near = [...chosen].map(([id, at]) => ({ at, dt: Math.abs((time.get(id) ?? 0) - t0) })).sort((p, q) => p.dt - q.dt).slice(0, 2);
    let best: { labels: number[]; score: number; at: [number, number] } | null = null;
    const gaps = (k: number): number[][] => (k === 0 ? [[]] : gaps(k - 1).flatMap((g) => [1, 2, 3].map((x) => [...g, x])));
    for (let attempt = 0; attempt < 2 && !best; attempt++) {
    if (attempt === 1) {
      if (userSet === user || walked) break;
      userSet = user;
    }
    for (const g of gaps(m - 1)) {
      if (g.reduce((s, v) => s + v, 0) >= n) continue;
      for (let s0 = 0; s0 < n; s0++) {
        const labels = [s0];
        for (const step of g) labels.push(((labels[labels.length - 1] as number) + step) % n);
        if (labels.some((l, k) => (userSet[k] as number) >= 0 && userSet[k] !== l)) continue;
        if (farCorner >= 0 && !user.some((c) => c >= 0) && !labels.includes(farCorner)) continue;
        if (farRun && !labels.every((l) => farRun.has(l))) continue;
        // Where this home ends is a corner of a shared wall.
        if (labels.some((l, k) => (out[job.idx[k] as number] as CornerTap).party && !party.has(l))) continue;
        const taps = job.snapped.map((t, k) => ({ ...t, corner: labels[k] as number }));
        const cam = (byId.get(job.id) as RoutePhotoData).camera as PhotoCamera;
        for (const p of placementsFromCorners(taps, ring, shared, cam, facing, farCorner >= 0 ? FAR_FACING_TOLERANCE_DEG : FACING_TOLERANCE_DEG)) {
          const skipped = g.reduce((s, v) => s + v - 1, 0);
          const walk = near.length ? Math.min(...near.map((x) => Math.hypot(x.at[0] - p.at[0], x.at[1] - p.at[1]))) / 30 : 0;
          // Corners this camera would see plainly - in the picture, ahead, nothing of the house in the way - that were not tapped.
          const seenUntapped = ring.filter((_, c) => !labels.includes(c) && cornerInView(cam, p, ring, c, shared)).length;
          const score = 200 * p.err + p.slant + 0.4 * skipped + walk + seenUntapped;
          if (!best || score < best.score) best = { labels, score, at: p.at };
        }
      }
    }
    }
    if (!best && walked && fromShot) {
      job.idx.forEach((i, k) => {
        if ((fromShot[k] as number) < 0 || ((out[i] as CornerTap).by === "user" && (out[i] as CornerTap).corner >= 0)) return;
        (out[i] as CornerTap).corner = fromShot[k] as number;
        (out[i] as CornerTap).by = "app";
      });
      continue;
    }
    if (!best) continue;
    job.idx.forEach((i, k) => {
      const t = out[i] as CornerTap;
      if (t.by === "user" && t.corner >= 0) return;
      t.corner = (best as { labels: number[] }).labels[k] as number;
      t.by = "app";
    });
    chosen.set(job.id, best.at);
  }
  return out;
}

const cameraWidth = (d: RoutePhotoData | undefined) => d?.camera?.width ?? 0;

/**
 * Which way a photo looked on the plan, roughly (unit): said (`RoutePhoto.facing`, from the walk), or from what it was
 * taken for on [outline] - a wall straight on looks against the wall's outward face, a corner's 45 in across the corner.
 * Null when neither is known.
 */
export function facingOf(photo: Pick<RoutePhoto, "facing" | "shot"> | undefined, outline: Pt[]): [number, number] | null {
  if (!photo) return null;
  const n = outline.length;
  let d: [number, number] | null = null;
  if (photo.facing) d = [photo.facing[0], photo.facing[1]];
  else if (photo.shot && n >= 3) {
    const nrm = (i: number) => outward(outline[((i % n) + n) % n] as Pt, outline[(((i + 1) % n) + n) % n] as Pt);
    const shot = photo.shot;
    if (shot.kind === "wall" || shot.kind === "inside") {
      // A wall straight on; or a wall either side of the walk's inside corner.
      const o = nrm(shot.kind === "wall" ? shot.index : shot.wall === "before" ? shot.index - 1 : shot.index);
      d = [-o.x, -o.y];
    } else if (shot.kind === "run") {
      // A run of walls straight on (the walk's front): against their faces, each as long as it is.
      let sx = 0;
      let sy = 0;
      for (let i = ((shot.index % n) + n) % n, k = 0; i !== ((shot.to % n) + n) % n && k < n; i = (i + 1) % n, k++) {
        const o = nrm(i);
        const L = segLen(outline[i] as Pt, outline[(i + 1) % n] as Pt);
        sx -= o.x * L;
        sy -= o.y * L;
      }
      d = [sx, sy];
    } else {
      const a = nrm(photo.shot.index - 1);
      const b = nrm(photo.shot.index);
      d = [-(a.x + b.x), -(a.y + b.y)];
    }
  }
  if (!d) return null;
  const L = Math.hypot(d[0], d[1]);
  return L > 1e-9 ? [d[0] / L, d[1] / L] : null;
}

/** A placement may face this far from the way the photo was said to look, degrees: a 45 taken a little round the corner, a wall a little to one side. */
const FACING_TOLERANCE_DEG = 60;
/** A far-back photo of a corner looks in across it, both walls in: closer to the corner's diagonal than a photo of a wall's part. */
const FAR_FACING_TOLERANCE_DEG = 35;

/** The outline's corners from `from` round to `to`, both in. */
function runCorners(from: number, to: number, n: number): Set<number> {
  const out = new Set<number>();
  for (let i = ((from % n) + n) % n, k = 0; k <= n; i = (i + 1) % n, k++) {
    out.add(i);
    if (i === ((to % n) + n) % n) break;
  }
  return out;
}

/**
 * The corners a photo from the checklist names, left to right as its taps run (-1 for a tap it does not name):
 *
 *   a corner at 45 degrees: the tap nearest its middle that corner; and on a photo of the walk round the house (`walked`),
 *     the taps beside it either way the far ends of its two walls (2026-10-21: the walk asks for just those - a 45 shows the
 *     wall walked to the corner on its left, the one on from it on its right. The checklist asks for every corner in sight,
 *     and on the owner's 10-16 photos the ones beside it were the far ends 18 times in 24);
 *   a wall straight on: its leftmost and rightmost taps, the wall's two corners as seen from outside;
 *   a run (the walk's front): its leftmost and rightmost taps, the run's two ends - and every tap in order when there are
 *     as many as the run has corners;
 *   an inside corner's wall: by the order they were tapped (`order`, each tap's place in the photo's taps), as the walk
 *     asks - the inside corner first, then the wall's other end.
 */
function shotNames(shot: RouteShot, snapped: { u: number }[], width: number, n: number, order: number[] = snapped.map((_, i) => i), walked = false): number[] {
  const out = snapped.map(() => -1);
  const mod = (k: number) => ((k % n) + n) % n;
  if (snapped.length === 0) return out;
  if (shot.kind === "corner") {
    let k = 0;
    snapped.forEach((t, i) => {
      if (Math.abs(t.u - width / 2) < Math.abs((snapped[k] as { u: number }).u - width / 2)) k = i;
    });
    out[k] = mod(shot.index);
    if (walked && k > 0) out[k - 1] = mod(shot.index - 1);
    if (walked && k < snapped.length - 1) out[k + 1] = mod(shot.index + 1);
    return out;
  }
  if (shot.kind === "inside") {
    const byTap = snapped.map((_, i) => i).sort((p, q) => (order[p] as number) - (order[q] as number));
    out[byTap[0] as number] = mod(shot.index);
    if (byTap.length > 1) out[byTap[1] as number] = mod(shot.wall === "before" ? shot.index - 1 : shot.index + 1);
    return out;
  }
  if (snapped.length < 2) return out;
  if (shot.kind === "run") {
    const len = mod(shot.to - shot.index) + 1;
    if (snapped.length === len) return snapped.map((_, i) => mod(shot.index + i));
    out[0] = mod(shot.index);
    out[snapped.length - 1] = mod(shot.to);
    return out;
  }
  out[0] = mod(shot.index);
  out[snapped.length - 1] = mod(shot.index + 1);
  return out;
}

/**
 * The numbers a photo's shot gives its taps, in the order they were tapped, before any measure (2026-10-21): what the pane
 * shows on a photo of the walk as each corner is tapped. Left to right by where each was tapped; -1 for one it doesn't name.
 */
export function shotNumbers(shot: RouteShot, taps: { x: number }[], width: number, n: number, walked = false): number[] {
  const order = taps.map((_, i) => i).sort((p, q) => (taps[p] as { x: number }).x - (taps[q] as { x: number }).x);
  const names = shotNames(shot, order.map((i) => ({ u: (taps[i] as { x: number }).x })), width, n, order, walked);
  const out = taps.map(() => -1);
  order.forEach((i, k) => (out[i] = names[k] as number));
  return out;
}

/**
 * Whether outline corner c would show plainly in a photo from placement p: ahead, inside the picture
 * with a margin of a twentieth of its width, and the first thing of the house its ray meets.
 */
function cornerInView(cam: PhotoCamera, p: { quadrant: number; at: [number, number] }, ring: Pt[], c: number, shared: Set<number> = new Set()): boolean {
  const P = ring[c] as Pt;
  const v: [number, number] = [P.x - p.at[0], P.y - p.at[1]];
  const dist = Math.hypot(v[0], v[1]);
  if (dist < 1) return false;
  // The corner's bearing in the photo's own frame, against the level camera's forward.
  const Z = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ][((p.quadrant % 4) + 4) % 4] as [number, number];
  const X: [number, number] = [Z[1], -Z[0]];
  const lx = (v[0] * X[0] + v[1] * X[1]) / dist;
  const lz = (v[0] * Z[0] + v[1] * Z[1]) / dist;
  const { xl, zl } = levelAxes(cam);
  const ahead = lx * zl[0] + lz * zl[2];
  if (ahead <= 0.05) return false;
  const across = lx * xl[0] + lz * xl[2];
  const u = cam.width / 2 + (cam.f * across) / ahead;
  if (u < 0.05 * cam.width || u > 0.95 * cam.width) return false;
  const hit = castRay({ x: p.at[0], y: p.at[1] }, [v[0] / dist, v[1] / dist], ring);
  return (!hit || hit.t >= dist - 0.5) && !neighbourBlocks({ x: p.at[0], y: p.at[1] }, P, ring, shared);
}

// ── Attached homes ───────────────────────────────────────────────────────────────────────────────

/** How far the neighbour's home is taken to reach past a shared wall, feet: what a camera can't stand in or see through. */
const NEIGHBOUR_FEET = 40;

/**
 * The sides a home of this kind shares, on a shape drawn with the street at the bottom (2026-10-17): a semi or an
 * end townhouse its right-hand side wall - the outermost wall running back from the street on the right - a middle
 * townhouse both its outermost side walls. A tap on a wall changes it. None for a detached home.
 */
export function defaultShared(outline: Pt[], homeType: HomeType | undefined): number[] {
  if (!isAttachedHome(homeType) || outline.length < 4) return [];
  const n = outline.length;
  const runsBack = outline.map((a, i) => {
    const b = outline[(i + 1) % n] as Pt;
    return Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
  });
  const xs = outline.map((p) => p.x);
  const side = (right: boolean): number[] => {
    const x = right ? Math.max(...xs) : Math.min(...xs);
    const on = outline.map((a, i) => i).filter((i) => runsBack[i] && Math.abs((outline[i] as Pt).x - x) < 0.5);
    // Of the walls on that edge of the shape, the longest (a step in it is no party wall).
    const len = (i: number) => Math.abs((outline[(i + 1) % n] as Pt).y - (outline[i] as Pt).y);
    return on.length ? [on.reduce((a, c) => (len(c) > len(a) ? c : a))] : [];
  };
  return homeType === "town_middle" ? [...side(false), ...side(true)].sort((a, c) => a - c) : side(true);
}

/** The corners where this home ends: both ends of each shared side. */
export function partyCorners(n: number, shared: Set<number> | number[]): Set<number> {
  const out = new Set<number>();
  for (const i of shared) {
    out.add(((i % n) + n) % n);
    out.add((i + 1) % n);
  }
  return out;
}

/** The neighbour's home past shared side i: the wall and a box reaching NEIGHBOUR_FEET out from it. */
function neighbourBox(ring: Pt[], i: number): Pt[] {
  const A = ring[i] as Pt;
  const B = ring[(i + 1) % ring.length] as Pt;
  const nrm = outward(A, B);
  return [A, B, { x: B.x + NEIGHBOUR_FEET * nrm.x, y: B.y + NEIGHBOUR_FEET * nrm.y }, { x: A.x + NEIGHBOUR_FEET * nrm.x, y: A.y + NEIGHBOUR_FEET * nrm.y }];
}

/** Whether C stands inside a neighbour's home (past a shared wall). */
export function inNeighbour(C: Pt, ring: Pt[], shared: Set<number> | number[]): boolean {
  for (const i of shared) if (insideRing(C, neighbourBox(ring, i))) return true;
  return false;
}

/** Whether a neighbour's home stands between C and P: the line between them crosses one of its outer edges first. */
export function neighbourBlocks(C: Pt, P: Pt, ring: Pt[], shared: Set<number> | number[]): boolean {
  for (const i of shared) {
    const box = neighbourBox(ring, i);
    // Its three edges away from this home (the shared wall itself is this home's).
    for (let e = 1; e < 4; e++) {
      const a = box[e] as Pt;
      const b = box[(e + 1) % 4] as Pt;
      const d1x = P.x - C.x;
      const d1y = P.y - C.y;
      const d2x = b.x - a.x;
      const d2y = b.y - a.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - C.x) * d2y - (a.y - C.y) * d2x) / den;
      const s = ((a.x - C.x) * d1y - (a.y - C.y) * d1x) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && s > 1e-6 && s < 1 - 1e-6) return true;
    }
    if (insideRing({ x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 }, box)) return true;
  }
  return false;
}

// ── The solve ────────────────────────────────────────────────────────────────────────────────────

/** Where a photo held in the hand is taken from, feet over the ground at the corner it shows: what places a photo with one corner along that corner's ray. */
const HAND_HEIGHT_FEET: [number, number] = [3, 7.5];
/**
 * The same, for placing a photo by its edges: wider, as a corner tapped where it shows - on a porch deck, at the top of
 * a step - reads the camera lower than it was over the ground (the owner's #1: tapped on the porch, 2'6" up).
 */
const PLACE_HAND_FEET: [number, number] = [1.5, 8.5];
/** A photo placed by its edges whose own bearings then fit worse than this (rms, in sd) was put in the wrong place. */
const PLACED_FIT_SD = 2.5;
/**
 * The heights a placement from corners may put the camera at, over the ground at each corner tapped, feet:
 * crouching to standing on a deck or a step. Two corners fit any of the four quarter-turns; one that puts the camera
 * a foot off the ground, or twenty feet up, is not where the photo was taken (2026-10-20, the shed's #1: placed
 * beside the corner it showed, at 0.6 ft).
 */
const PLACED_HEIGHT_FEET: [number, number] = [1.5, 15];
/** And about this high: the hand-height prior every camera is held to, loosely (lib/photoRouteSolve.ts `heights`). */
const HAND_FEET = 5;
const HAND_SD_FEET = 2.5;
/** A wall edge's bearing sd: the proof's 2 px. */
const PX_SD = 2;
/**
 * A corner tap's: 6 px. A tap marks the corner's visible edge, and on a real house that is often a
 * pilaster, a corner board or a porch post standing a few inches proud of the walls: weighed as a
 * wall edge, the owner's corners pulled his porch 8% short (2026-10-16); at 6 px they place the
 * cameras and the wall edges measure.
 */
const CORNER_SD = 6;
/** The lens's radial term may move this far (one sd) from what the photos were levelled with, in the plan solve. */
const LENS_K_SD = 0.015;
/** The turn each photo may take on top of its vanishing points, degrees: found automatically they are good to about a degree (the proof's, set by hand, to 0.3). */
const YAW_SD_DEG = 1;
/** A tape's sd, feet: a quarter inch, as the proof's 0.02 ft. */
const TAPE_SD_FEET = 0.02;
/**
 * How loosely a side is held to the shape the walk round the house made (2026-10-21, `RouteBuilding.outlineFrom`), one sd
 * as a fraction of its length there: the lap knows the turns, not the sizes - a step to a notch is taken 8' whether it is
 * 2' or 25'. Held at the drawn shape's 35%, a walk of the owner's house (made up from its true shape, every photo the
 * walk asks for, the corners tapped as it asks; test:exterior) came out 15-16% off on average; at 2x, 1.6% (1.9% with the
 * taps 1.5 px off). His own 10-16 photos with the lap's shape in place of the one he drew - not taken as a walk, six of
 * them showing one corner - still need the drawn shape: the porch and bump-out came within 2-5%, the depth 15-20% short.
 */
export const WALK_HOLD = 2;

/** A size estimated on site, one sd: half its ±, as the route's own ± is two sd; never under 3". */
const estimateSd = (e: RouteEstimate): number => Math.max(0.25, (e.feet * Math.max(1, e.plusMinusPct || ESTIMATE_PLUS_MINUS_PCT)) / 200);

interface SnappedTap {
  photo: string;
  corner: number;
  u: number;
  v: number;
  bearing: number;
  onEdge: boolean;
  /** How far over the ground it was tapped, feet (`CornerTap.aboveGround`): 0 at the ground. */
  aboveGround?: number;
  /** The snapped point in the photo, for the bearing at another k. */
  px: [number, number];
}

interface EdgeObs {
  photo: string;
  index: number;
  side: number;
  along: number;
  polarity: 1 | -1;
  bearing: number;
  /** Heights of its ends over the camera's ground, feet. */
  zLow: number;
  zHigh: number;
  /** Where its camera stood, and the sine of the angle its ray met the wall at. */
  from: [number, number];
  graze: number;
  /** Its place on the plan. */
  at: [number, number];
  /** A pixel on it in the photo, for the bearing at another k. */
  px: [number, number];
}

export interface SolveRouteOptions {
  /** Find and tie wall edges (on by default; off shows what the corners alone give). */
  wallEdges?: boolean;
  /** Leave these tapes out (for the hold-out tests). */
  withoutTapes?: string[];
  /** Leave the sizes estimated on site out, held or checked (to show what they changed). */
  withoutEstimates?: boolean;
  /** For the tests: no wall edges tied on these sides, and these corner taps left out. */
  skipSides?: number[];
  skipTap?: (t: CornerTap) => boolean;
  /** Work out the best places of the photos still waiting for where the user stood (on by default; the measure's first, rough solve skips it). */
  guesses?: boolean;
  /** How loosely each side is held to the shape drawn, one sd as a fraction of its drawn length: 0.35, or `WALK_HOLD` for the walk's shape. */
  holdPct?: number;
  /**
   * Which photos size the house (2026-10-22, cleaner input). "measure" (the default): only MEASURE photos - those with two
   * corners of the house or more tapped on them - and the tapes on them or on a side. A DETAIL photo (one corner or none)
   * is placed afterwards on the house as measured, where the user stood for it, only to be read (openings, trim, parging,
   * the deck and the porch): its guessed place never moves a size, and a tape on it places it and sizes nothing. "all"
   * (10-20 to 10-22, kept to compare): a photo placed where the user stood is in the size solve with the rest.
   */
  sizePhotos?: "measure" | "all";
  /** Photos left out of the size solve (the self-check's, lib/photoRouteCheck.ts): placed afterwards to be read, as a detail photo is. */
  outOfSize?: string[];
  /** The map outline (`RouteBuilding.map`): used (the default) when the building has one; false measures from the photos alone. */
  map?: boolean;
  /** Which way the front faces, when known (the compass): the map is laid only with its front that way. */
  frontFacesDeg?: number | null;
  /** The map's distances, already laid (`solveWithMap`): held as they are, the map not laid again. */
  mapHolds?: MapHold[];
  /** For experiments on saved houses (the runner's comparisons): the solve's weights changed. Absent: as they are. */
  tune?: { holdFloor?: number; handFeet?: number; handSdFeet?: number; lensKSd?: number; yawSdDeg?: number; cornerSdPx?: number; edgeSdPx?: number };
}

/**
 * The building's outline, sides and cameras from its photos, taps and tapes. Photos with no level
 * camera, or that could not be placed, are listed in `unplaced` and left out; nothing is guessed for
 * them.
 */
export function solveRoute(input: PhotoRouteInput, buildingId: string, data: RoutePhotoData[], opts: SolveRouteOptions = {}): RouteSolution {
  const b = input.buildings.find((x) => x.id === buildingId);
  if (!b) throw new Error(`No building ${buildingId}`);
  if (b.map && opts.map !== false && !opts.mapHolds) return solveWithMap(input, buildingId, data, opts, b.map);
  const n = b.outline.length;
  const byId = new Map(data.map((d) => [d.id, d]));
  const tapes = b.tapes.filter((t) => !(opts.withoutTapes ?? []).includes(t.id));
  // One estimate a side (the last said), on a side no tape measures: held in the solve, or (the default) only checked against it.
  const estimates = new Map<number, RouteEstimate>();
  const checks = new Map<number, RouteEstimate>();
  if (!opts.withoutEstimates) {
    for (const e of b.estimates ?? []) {
      if (!(e.from >= 0 && e.from < n && e.feet > 0) || tapes.some((t) => t.kind === "side" && t.from === e.from)) continue;
      estimates.delete(e.from);
      checks.delete(e.from);
      (e.use === "hold" ? estimates : checks).set(e.from, e);
    }
  }
  const unplaced: { photo: string; why: string }[] = [];

  // 1. Every corner tap snapped onto its edge: a bearing, and its row in the level image.
  const taps: SnappedTap[] = [];
  for (const t of b.corners) {
    if (opts.skipTap?.(t)) continue;
    // A corner Scrivn marked and the user has not kept: not an observation.
    if (t.proposed) continue;
    // A tap not yet numbered (one alone on its photo): the pane asks which corner it is.
    if (!(t.corner >= 0 && t.corner < n)) continue;
    const d = byId.get(t.photo);
    if (!d?.camera) continue;
    const s = tapOnEdge(d.gray, d.camera, t);
    taps.push({ photo: t.photo, corner: t.corner, ...s, bearing: columnBearing(d.camera, s.u), aboveGround: t.aboveGround ?? 0 });
  }

  // Which photos size the house: measure photos (two corners or more), or (the old way) every photo that can be placed.
  const legacy = opts.sizePhotos === "all";
  const outOfSize = new Set(opts.outOfSize ?? []);
  // The taps of photos that don't size the house wait for the detail placement, after the size is solved.
  const detailTaps = taps.filter((t) => outOfSize.has(t.photo));
  if (detailTaps.length) taps.splice(0, taps.length, ...taps.filter((t) => !outOfSize.has(t.photo)));

  // 2. The walls from the shape drawn, and each camera placed from its corners on it.
  const { walls, corners } = outlineWalls(b.outline);
  const roughPerimeter = b.outline.reduce((s, p, i) => s + segLen(p, b.outline[(i + 1) % n] as Pt), 0);
  const cams = new Map<string, { quadrant: number; at: [number, number]; placedBy: RouteCamera["placedBy"] }>();
  // Where the user stood for each photo placed that way, on the shape as solved now; and the doubtful ones' best places.
  const standPrior = new Map<string, [number, number]>();
  const doubt = new Map<string, { at: [number, number]; score: number }[]>();
  const photosWithTaps = [...new Set(taps.map((t) => t.photo))];
  const candidates = new Map<string, Placement[]>();
  for (const id of input.photos.map((p) => p.id)) {
    const d = byId.get(id);
    const mine = taps.filter((t) => t.photo === id);
    if (!d?.camera) {
      if (b.corners.some((c) => c.photo === id)) unplaced.push({ photo: id, why: "Too few straight edges in it to level it." });
      continue;
    }
    if (mine.length >= 2) {
      const list = placementsFromCorners(mine, b.outline, new Set(b.shared ?? []), d.camera, facingOf(input.photos.find((p) => p.id === id), b.outline));
      if (list.length) candidates.set(id, list);
      else unplaced.push({ photo: id, why: "Its corners do not fit the shape drawn: check which corners they are." });
    }
  }
  for (const [id, c] of chooseByWalk(candidates, input.photos)) cams.set(id, { ...c, placedBy: "corners" });
  void photosWithTaps;

  // The lens's radial term, as the vanishing points gave it, fitted again in the plan solve.
  const k0 = data.find((d) => d.camera)?.camera?.k ?? 0;
  const tune = opts.tune ?? {};
  const lensPrior = { k0, sd: tune.lensKSd ?? LENS_K_SD };
  const sideTapes = tapes.filter((t): t is Extract<RouteTape, { kind: "side" }> => t.kind === "side");
  const lineTapes = tapes.filter((t): t is Extract<RouteTape, { kind: "line" }> => t.kind === "line");

  /** The solve's input from what is known so far. */
  const build = (edgePoints: { id: string; side: number; obs: EdgeObs[]; along: number }[], tapeEnds: TapeEnd[], placedCams: Map<string, { quadrant: number; at: [number, number] }>, ring: Pt[]) => {
    const points: SolvePoint[] = corners.map((c, i) => ({ ...c, guess: [(ring[i] as Pt).x, (ring[i] as Pt).y] as [number, number] }));
    const wallsNow: SolveWall[] = walls.map((w, i) => {
      const a = ring[i] as Pt;
      return { ...w, guess: w.fixed ? w.guess : w.axis === "E" ? a.x : a.y };
    });
    const bearings: SolveBearing[] = [];
    const cameras: SolveCamera[] = [];
    for (const [id, c] of placedCams) {
      const d = byId.get(id) as RoutePhotoData;
      const stood = standPrior.get(id);
      cameras.push({ id, quadrant: c.quadrant, guess: c.at, yawSdDeg: tune.yawSdDeg ?? YAW_SD_DEG, ...(stood ? { prior: { at: stood, sdFeet: STOOD_SD_FEET } } : {}) });
      for (const t of taps.filter((x) => x.photo === id)) bearings.push({ camera: id, point: `c${t.corner}`, bearing: t.bearing, sd: (tune.cornerSdPx ?? CORNER_SD) / (d.camera as PhotoCamera).f, bearingAt: atK(d.camera as PhotoCamera, t.px) });
    }
    for (const p of edgePoints) {
      const wall = walls[p.side] as SolveWall;
      const a = ring[p.side] as Pt;
      const bb = ring[(p.side + 1) % n] as Pt;
      const L = segLen(a, bb) || 1;
      const at: [number, number] = [a.x + ((bb.x - a.x) / L) * p.along, a.y + ((bb.y - a.y) / L) * p.along];
      points.push({ id: p.id, e: wall.axis === "E" ? wall.id : null, n: wall.axis === "N" ? wall.id : null, guess: at });
      for (const o of p.obs) {
        if (!placedCams.has(o.photo)) continue;
        const oc = (byId.get(o.photo) as RoutePhotoData).camera as PhotoCamera;
        bearings.push({ camera: o.photo, point: p.id, bearing: o.bearing, sd: (tune.edgeSdPx ?? PX_SD) / oc.f, bearingAt: atK(oc, o.px) });
      }
    }
    const distances: SolveDistance[] = [];
    for (const t of sideTapes) {
      const prev = walls[(t.from - 1 + n) % n] as SolveWall;
      const next = walls[(t.from + 1) % n] as SolveWall;
      distances.push({ id: t.id, a: `wall:${prev.id}`, b: `wall:${next.id}`, axis: prev.axis, feet: t.feet, sdFeet: TAPE_SD_FEET });
    }
    // A size estimated on site: the same wall-to-wall length, held as loosely as it was said.
    for (const e of estimates.values()) {
      const prev = walls[(e.from - 1 + n) % n] as SolveWall;
      const next = walls[(e.from + 1) % n] as SolveWall;
      distances.push({ id: `estimate:${e.id}`, a: `wall:${prev.id}`, b: `wall:${next.id}`, axis: prev.axis, feet: e.feet, sdFeet: estimateSd(e) });
    }
    for (const e of tapeEnds) {
      const wall = walls[e.side] as SolveWall;
      if (!points.some((p) => p.id === e.point)) points.push({ id: e.point, e: wall.axis === "E" ? wall.id : null, n: wall.axis === "N" ? wall.id : null, guess: e.at });
      // Its own photo's bearing, unless the tied point it joined already has it.
      if (!e.seen && placedCams.has(e.photo)) {
        const ec = (byId.get(e.photo) as RoutePhotoData).camera as PhotoCamera;
        bearings.push({ camera: e.photo, point: e.point, bearing: e.bearing, sd: PX_SD / ec.f, bearingAt: atK(ec, e.px) });
      }
    }
    // The map outline's long walls (lib/photoRouteMap.ts): each two traced the same way held to the map's distance.
    for (const h of opts.mapHolds ?? []) {
      const wa = walls[h.a] as SolveWall | undefined;
      const wb = walls[h.b] as SolveWall | undefined;
      if (wa && wb && wa.axis === h.axis && wb.axis === h.axis) distances.push({ id: h.id, a: `wall:${wa.id}`, b: `wall:${wb.id}`, axis: h.axis, feet: h.feet, sdFeet: h.sdFeet });
    }
    for (const t of lineTapes) {
      const ends = tapeEnds.filter((e) => e.tape === t.id);
      if (ends.length !== 2) continue;
      const [ea, eb] = ends as [TapeEnd, TapeEnd];
      const axis = ea.side === eb.side ? (walls[ea.side] as SolveWall).axis === "E" ? "N" : "E" : "any";
      distances.push({ id: t.id, a: ea.point, b: eb.point, axis, feet: t.feet, sdFeet: TAPE_SD_FEET });
    }
    // Without a tape nothing sizes the house: its perimeter is held, loosely, to the one drawn.
    const hasScale = distances.some((d) => !d.id.startsWith("estimate:"));
    // Each camera's hand height, from the corner tapped lowest in it: the one most likely tapped at the ground (one shown over a deck is tapped higher).
    const heights: { camera: string; point: string; drop: number; forward: number; feet: number; sdFeet: number }[] = [];
    for (const [id] of placedCams) {
      if (standPrior.has(id)) continue;
      const cam = (byId.get(id) as RoutePhotoData).camera as PhotoCamera;
      const mine = taps.filter((t) => t.photo === id && t.v > cam.height / 2 + 0.02 * cam.f).sort((a, b) => a.v - b.v);
      const t = mine[mine.length - 1];
      if (!t) continue;
      const { zl } = levelAxes(cam);
      heights.push({ camera: id, point: `c${t.corner}`, drop: (t.v - cam.height / 2) / cam.f, forward: Math.atan2(zl[0], zl[2]), feet: (tune.handFeet ?? HAND_FEET) - (t.aboveGround ?? 0), sdFeet: tune.handSdFeet ?? HAND_SD_FEET });
    }
    // A camera nothing ties yet (a photo placed by its edges, before they are tied in the next round) waits out this solve.
    const seen = new Set(bearings.map((x) => x.camera));
    return { input: { walls: wallsNow, points, cameras: cameras.filter((c) => seen.has(c.id)), bearings, distances, lens: lensPrior, heights: heights.filter((h) => seen.has(h.camera)) }, hasScale };
  };

  /**
   * Each side held, loosely, to its length as drawn (35%; the walk's shape, its sizes rough, at `WALK_HOLD`): what the photos say outweighs it a hundred to
   * one wherever they say anything, but where they say little - a wall no photo faced, or the house's
   * depth before the wall edges are tied - the solve stays near the shape the user knows, rather than
   * folding up. With no tape at all it is also the only size the house has (said: `unscaled`). A side estimated
   * on site is held to that instead: said at the house, it knows better than a shape drawn on a phone.
   */
  const hold = opts.holdPct ?? (isWalkShape(b) ? WALK_HOLD : 0.35);
  // With a map outline (2026-10-23) the shape as drawn is stretched to the map's distances first, and held no tighter than
  // three times the map's sd the ways the map holds: it is no measurement, and must never outweigh one. (House G's reviewer
  // drew the covered deck's 9' side as a 2' step; held at its 1' floor it kept the map's porch-to-back 12' short.)
  const drawnShape = opts.mapHolds?.length ? stretchedToMap(b.outline, opts.mapHolds) : b.outline;
  const mapFloor = new Map<string, number>();
  for (const axis of ["E", "N"]) {
    const sds = (opts.mapHolds ?? []).filter((h) => h.axis === axis).map((h) => h.sdFeet).sort((p, q) => p - q);
    if (sds.length) mapFloor.set(axis, 3 * (sds[Math.floor(sds.length / 2)] as number));
  }
  const extentX = Math.max(...drawnShape.map((p) => p.x)) - Math.min(...drawnShape.map((p) => p.x));
  const extentY = Math.max(...drawnShape.map((p) => p.y)) - Math.min(...drawnShape.map((p) => p.y));
  const scaleHold = (inp: ReturnType<typeof build>): SolveInput => {
    const drawn: SolveDistance[] = [];
    for (let i = 0; i < n; i++) {
      if (estimates.has(i)) continue;
      const prev = walls[(i - 1 + n) % n] as SolveWall;
      const next = walls[(i + 1) % n] as SolveWall;
      const feet = segLen(drawnShape[i] as Pt, drawnShape[(i + 1) % n] as Pt);
      const extent = prev.axis === "E" ? extentX : extentY;
      drawn.push({ id: `drawn:${i}`, a: `wall:${prev.id}`, b: `wall:${next.id}`, axis: prev.axis, feet, sdFeet: Math.max(1, feet * hold, extent * (tune.holdFloor ?? 0), mapFloor.get(prev.axis) ?? 0) });
    }
    // With a map, each side kept the way the walk turned it: its length alone would let a bump-out fold back through the
    // wall behind it (house G: the map pulled the rear wall out past the bump-out's back, the bump-out's side 4'2" either way).
    const apart: NonNullable<SolveInput["apart"]> = [];
    if (opts.mapHolds?.length) {
      for (let i = 0; i < n; i++) {
        const prev = walls[(i - 1 + n) % n] as SolveWall;
        const next = walls[(i + 1) % n] as SolveWall;
        const at = (k: number) => (prev.axis === "E" ? (drawnShape[k] as Pt).x : (drawnShape[k] as Pt).y);
        // Side i's walls either side, as drawn: the one before at corner i's line, the one after at corner i+1's.
        const way = at((i + 1) % n) - at(i);
        if (Math.abs(way) < 1e-6) continue;
        const [a, c] = way > 0 ? [prev, next] : [next, prev];
        apart.push({ a: `wall:${a.id}`, b: `wall:${c.id}`, axis: prev.axis, minFeet: Math.min(0.5, Math.abs(way) / 2), sdFeet: 0.05 });
      }
    }
    // The shape as drawn holds the solve, but it is no measurement: the ± leaves it out (`sigmaInformed`).
    return { ...inp.input, distances: [...inp.input.distances, ...drawn], uninformed: ["drawn:"], ...(apart.length ? { apart } : {}) };
  };
  void roughPerimeter;

  // 3. Round 1: the corners alone (and any wall tapes).
  let ring = b.outline.map((p) => ({ ...p }));
  let edgePoints: { id: string; side: number; obs: EdgeObs[]; along: number }[] = [];
  let tapeEnds: TapeEnd[] = [];
  let sol = solvePlan(scaleHold(build(edgePoints, tapeEnds, cams, ring)));
  ring = solvedCorners(sol, n);
  const update = () => {
    for (const [id, c] of cams) {
      if (!sol.input.cameras.some((x) => x.id === id)) continue;
      c.at = sol.camera(id).at;
    }
  };
  update();

  // 4. Wall edges, tapes on photos, and the photos placed by one corner; then all of it again.
  const camHeight = (id: string): number | null => {
    const c = cams.get(id);
    const d = byId.get(id);
    if (!c || !d?.camera) return null;
    const yaw = sol.input.cameras.some((x) => x.id === id) ? sol.camera(id).yaw : 0;
    const hs: number[] = [];
    for (const t of taps.filter((x) => x.photo === id)) {
      const P = ring[t.corner] as Pt;
      const { zl } = levelAxes(d.camera);
      const zg = planDirection(Math.atan2(zl[0], zl[2]), c.quadrant, yaw);
      const depth = (P.x - c.at[0]) * zg[0] + (P.y - c.at[1]) * zg[1];
      if (depth > 1) hs.push(((t.v - d.camera.height / 2) / d.camera.f) * depth + (t.aboveGround ?? 0));
    }
    if (hs.length === 0) return null;
    hs.sort((p, q) => p - q);
    return hs[Math.floor(hs.length / 2)] as number;
  };
  // The shift two photos may disagree by along a wall, round by round, as the cameras settle.
  const SEARCH = [2, 1, 0.5, 0.3, 0.2];
  const TOL = [0.15, 0.12, 0.1, 0.08, 0.08];
  let rounds = opts.wallEdges === false ? 1 : SEARCH.length;
  // Photos placed where the user stood this round: their edges tied in the next. (Not searched any wider than the
  // round's: on the owner's house a wider search for them tied posts and railings as jambs, and the depth came out 7% short.)
  let fresh = new Set<string>();
  // Photos put back out after their bearings didn't fit: not tried again.
  const misfit = new Set<string>();
  for (let round = 0; round < rounds; round++) {
    // Placed by their corners and in the last solve; or placed by their edges since, to have those tied this round.
    const placedNow = new Map([...cams].filter(([id, c]) => sol.input.cameras.some((x) => x.id === id) || round === 0 || c.placedBy !== "corners"));
    const obs = opts.wallEdges === false ? [] : wallObservations(placedNow, byId, ring, sol, camHeight).filter((o) => !(b.shared ?? []).includes(o.side));
    const at = Math.min(round, SEARCH.length - 1);
    edgePoints = opts.wallEdges === false ? [] : tieEdges(obs, SEARCH[at] as number, TOL[at] as number).filter((q) => !(opts.skipSides ?? []).includes(q.side));
    fresh = new Set();
    // Photos with one corner, or none (2026-10-20, every photo counts): where their upright edges repeat the edges the
    // placed photos tied, each at its own height, is worked out - but not taken on its own. On the owner's house the
    // edges of #1 pointed, surely and self-consistently, to a place twice as far out as it was taken from (the porch's
    // posts and railings, seen from out front as the front photos saw them), and it shortened the house 8%; #2's, as
    // surely, to its true place. Nothing in the edges told the two apart. So a photo is placed once the user says where
    // they stood (one tap on the plan, Scrivn's best places shown); until then its best places are listed (`doubtful`).
    const tied = opts.wallEdges === false || round === 0 ? [] : tiedPoints([...edgePoints].sort((p, q) => q.obs.length - p.obs.length), ring);
    const shared = new Set(b.shared ?? []);
    const toSolved = sketchToSolved(b.outline, ring);
    // The stand spots as the shape is solved now.
    for (const id of standPrior.keys()) {
      const said = input.photos.find((p) => p.id === id)?.standAt;
      if (said) standPrior.set(id, toSolved(said));
    }
    for (const p of input.photos) {
      const id = p.id;
      if (cams.has(id) || misfit.has(id) || opts.wallEdges === false || round === 0 || !legacy || outOfSize.has(id)) continue;
      const d = byId.get(id);
      const mine = taps.filter((t) => t.photo === id);
      if (!d?.camera || mine.length > 1) continue;
      // Only where the user said they stood: the others' best places are worked out once, after the last round.
      if (!p.standAt) continue;
      const spot = toSolved(p.standAt);
      // With a corner: on that corner's ray, nearest there. With none: searched round there.
      const placed = mine[0] ? nearestOnRay(mine[0], ring, spot, shared) : placeByEdges(null, d, ring, tied, shared, undefined, { at: { x: spot[0], y: spot[1] }, radius: STOOD_SEARCH_FEET });
      if (!placed) continue;
      cams.set(id, { quadrant: placed.quadrant, at: placed.at, placedBy: "stood" });
      standPrior.set(id, spot);
      fresh.add(id);
    }
    // One placed in the last round has its edges tied in one more.
    if (fresh.size > 0 && round === rounds - 1 && rounds < SEARCH.length + 2) rounds++;

    // Tapes on photos: each end on the wall its ray meets.
    tapeEnds = [];
    for (const t of lineTapes) {
      const d = byId.get(t.photo);
      const c = cams.get(t.photo);
      if (!d?.camera || !c) continue;
      const yaw = sol.input.cameras.some((x) => x.id === t.photo) ? sol.camera(t.photo).yaw : 0;
      for (const [k, end] of [["a", t.a], ["b", t.b]] as const) {
        const s = t.exact ? { u: toLevel(d.camera, end[0], end[1])[0], x: end[0], y: end[1] } : snapToEdge(d.gray, d.camera, end[0], end[1], { above: 60, below: 60 });
        const bearing = columnBearing(d.camera, s.u);
        const dir = planDirection(bearing, c.quadrant, yaw);
        const hit = castRay({ x: c.at[0], y: c.at[1] }, dir, ring);
        if (!hit) continue;
        // The end is on an edge other photos saw too (a door's jamb): it is that tied point, seen from all of them.
        const own = edgePoints.find((q) => q.side === hit.side && q.obs.some((o) => o.photo === t.photo && Math.abs(((d.edges[o.index] as UprightEdge).u) - s.u) < 2));
        // Else one other photos tied within 0.2 ft of it: the jamb a finger's drag was meant for. Not for an end put to the pixel:
        // a trimmed opening's edges stand closer than that (2026-10-20, the shed's roll-up: inner edge joined to the trim's outer).
        const near = own ?? (t.exact ? undefined : edgePoints.find((q) => q.side === hit.side && !q.obs.some((o) => o.photo === t.photo) && Math.abs(q.along - hit.along) < 0.2));
        tapeEnds.push({ tape: t.id, point: near?.id ?? `tape:${t.id}:${k}`, photo: t.photo, side: hit.side, bearing, at: [c.at[0] + dir[0] * hit.t, c.at[1] + dir[1] * hit.t], seen: !!own, px: [s.x, s.y] });
      }
    }
    sol = solvePlan(scaleHold(build(edgePoints, tapeEnds, cams, ring)));
    // Bearings far off (a snap on the wrong edge, a tie that was not one) dropped, and solved again.
    const bad = new Set<string>();
    sol.input.bearings.forEach((bb, i) => {
      if (Math.abs(sol.residuals[i] as number) > 4 && !bb.point.startsWith("c")) bad.add(`${bb.camera}|${bb.point}`);
    });
    if (bad.size > 0) {
      edgePoints = edgePoints.map((p) => ({ ...p, obs: p.obs.filter((o) => !bad.has(`${o.photo}|${p.id}`)) })).filter((p) => p.obs.length >= 2);
      sol = solvePlan(scaleHold(build(edgePoints, tapeEnds, cams, ring)));
    }
    // A photo placed by its edges, once its bearings are in, fitting them badly: it was put in the wrong place.
    for (const [id, c] of cams) {
      if (c.placedBy === "corners") continue;
      const res = sol.input.bearings.map((bb, i) => (bb.camera === id ? (sol.residuals[i] as number) : NaN)).filter((r) => Number.isFinite(r));
      if (res.length < 3) continue;
      const rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length);
      if (rms > PLACED_FIT_SD) {
        cams.delete(id);
        misfit.add(id);
      }
    }
    ring = solvedCorners(sol, n);
    update();
  }
  // The photos still waiting with one corner or none: their best places off their edges, for the user to say which.
  if (opts.wallEdges !== false && opts.guesses !== false) {
    const tiedNow = tiedPoints([...edgePoints].sort((p, q) => q.obs.length - p.obs.length), ring);
    const sharedNow = new Set(b.shared ?? []);
    for (const p of input.photos) {
      if (cams.has(p.id)) continue;
      const d = byId.get(p.id);
      const mine = taps.filter((t) => t.photo === p.id);
      if (!d?.camera || mine.length > 1) continue;
      const guess = placeByEdges(mine[0] ?? null, d, ring, tiedNow, sharedNow);
      if (guess && guess.spots.length) doubt.set(p.id, guess.spots);
    }
  }
  // 5. The detail photos (2026-10-22): placed on the house as measured, to be read, never sizing it.
  const detail = legacy && outOfSize.size === 0 ? new Map<string, DetailCamera>() : placeDetailPhotos({
    input,
    b,
    byId,
    ring,
    sol,
    walls,
    taps: [...taps, ...detailTaps],
    edgePoints,
    tapes: lineTapes,
    sized: new Set(sol.input.cameras.map((c) => c.id)),
    outOfSize,
    legacy,
  });
  for (const id of new Set(b.corners.filter((c) => !c.proposed).map((c) => c.photo))) {
    if (!cams.has(id) && !detail.has(id) && !unplaced.some((u) => u.photo === id)) {
      const k = taps.filter((t) => t.photo === id).length;
      unplaced.push({
        photo: id,
        why: misfit.has(id)
          ? "Its window and door edges pointed to a place they then didn't fit. Tap where you stood for it on the plan."
          : doubt.has(id)
            ? "Its window and door edges fit more than one place. Tap where you stood for it on the plan."
            : k === 0
              ? "No corner of the house tapped on it."
              : "It shows one corner, and too few of its window or door edges match the other photos to say where you stood. Tap where you stood for it on the plan, or take one at 45° to that corner, both walls in.",
      });
    }
  }

  // 5. The sides, their ± and who saw them. A tape on a photo that doesn't size the house (a detail photo) scales nothing.
  const sizedBy = new Set(sol.input.cameras.map((c) => c.id));
  const tapesOnDetail = lineTapes.filter((t) => !sizedBy.has(t.photo)).map((t) => t.id);
  // A map outline's distances size it too: a foot or two on its long walls.
  const scaled = (legacy ? tapes.length > 0 : sideTapes.length > 0 || lineTapes.some((t) => sizedBy.has(t.photo))) || (opts.mapHolds?.length ?? 0) > 0;
  const tapedSides = new Set(sideTapes.map((t) => t.from));
  const sideObs = new Map<number, Set<string>>();
  for (const p of edgePoints) for (const o of p.obs) (sideObs.get(p.side) ?? sideObs.set(p.side, new Set()).get(p.side))?.add(o.photo);
  const sides: RouteSide[] = [];
  for (let i = 0; i < n; i++) {
    const prev = walls[(i - 1 + n) % n] as SolveWall;
    const next = walls[(i + 1) % n] as SolveWall;
    const len = (x: Float64Array) => Math.abs(sol.wall(next.id, x) - sol.wall(prev.id, x));
    const L = len(sol.x);
    // The ± from what was measured: the photos and the tapes, not the shape as drawn (2026-10-22: on a test house a depth
    // the photos left loose followed whatever the reviewer drew, at the same fit, and was said to be good to ±10%). The old
    // way, or with no tape (the drawing is then the only size, and said so), as it was.
    const sd = legacy || !scaled ? sol.sigma(len) : sol.sigmaInformed(len);
    const taped = tapedSides.has(i);
    // The proof's ± ran about twice the formal sd (its variants' spread); never under 2%.
    const pct = taped ? null : Math.max(2, Math.round(((2 * sd) / Math.max(L, 0.1)) * 100));
    const said = estimates.get(i);
    const toCheck = taped ? undefined : checks.get(i);
    sides.push({
      from: i,
      lengthFeet: L,
      plusMinusPct: pct,
      sdFeet: sd,
      taped,
      photos: sideObs.get(i)?.size ?? 0,
      ...(said ? { estimated: { feet: said.feet, plusMinusPct: said.plusMinusPct } } : {}),
      ...(toCheck ? { estimateCheck: checkEstimate(L, toCheck) } : {}),
    });
  }
  const cameras: RouteCamera[] = [...cams].filter(([id]) => sol.input.cameras.some((c) => c.id === id)).map(([id, c]) => ({
    photo: id,
    at: sol.camera(id).at,
    quadrant: c.quadrant,
    yawTweakDeg: (sol.camera(id).yaw * 180) / Math.PI,
    heightFeet: camHeight(id),
    placedBy: c.placedBy,
  }));
  for (const [id, c] of detail) {
    cameras.push({ photo: id, at: c.at, quadrant: c.quadrant, yawTweakDeg: (c.yaw * 180) / Math.PI, heightFeet: c.heightFeet, placedBy: c.placedBy, role: "detail" });
  }
  const cornerBearings = sol.input.bearings.filter((x) => /^c\d+$/.test(x.point)).length;
  const edgeBearings = sol.input.bearings.filter((x) => x.point.startsWith("e")).length;
  return {
    building: b.id,
    corners: ring,
    sides,
    cameras,
    unplaced,
    doubtful: [...doubt].filter(([id]) => !cams.has(id) && !detail.has(id)).map(([photo, spots]) => ({ photo, spots })),
    counts: { cornerBearings, edgeBearings, edgePoints: edgePoints.length, tapes: tapes.length },
    rms: sol.rms,
    unscaled: !scaled,
    tapesOnDetail,
    advice: tapeAdvice(markLongWalls(sides, ring, cameras.filter((c) => c.role !== "detail"), taps, edgePoints, legacy || !scaled), ring, cameras, taps, edgePoints, new Set(b.shared ?? [])),
    edgePoints: edgePoints.map((q) => ({ id: q.id, side: q.side, along: sol.input.points.some((x) => x.id === q.id) ? alongOf(sol, q.id, ring, q.side) : q.along, photos: q.obs.map((o) => o.photo), zLow: medianOf(q.obs.map((o) => o.zLow)), zHigh: medianOf(q.obs.map((o) => o.zHigh)), polarity: (q.obs[0] as EdgeObs).polarity })),
    solution: sol,
  };
}

/**
 * The shape as drawn stretched to a map outline's distances (2026-10-23): each way across the plan, the walls the map holds
 * put at its distances from the first of them, and every corner between moved in proportion (beyond them, moved with the
 * nearest). Square stays square. A way whose held walls the drawing puts in another order is left as drawn.
 */
function stretchedToMap(outline: Pt[], holds: MapHold[]): Pt[] {
  const n = outline.length;
  const remap = (axis: "E" | "N"): ((v: number) => number) => {
    const at = (i: number) => {
      const a = outline[i] as Pt;
      const c = outline[(i + 1) % n] as Pt;
      return axis === "E" ? (a.x + c.x) / 2 : (a.y + c.y) / 2;
    };
    // The held walls in the map's order, each where the map puts it from the first.
    const knots: [number, number][] = [];
    for (const h of holds.filter((q) => q.axis === axis)) {
      if (!knots.length) knots.push([at(h.a), at(h.a)]);
      // Each held from one already put (they run in a chain); one that doesn't leaves this way as drawn.
      const base = knots.find((k) => k[0] === at(h.a));
      if (!base) return (v) => v;
      knots.push([at(h.b), base[1] + h.feet]);
    }
    knots.sort((p, q) => p[0] - q[0]);
    for (let k = 1; k < knots.length; k++) if (!((knots[k] as [number, number])[0] > (knots[k - 1] as [number, number])[0] + 1e-6) || !((knots[k] as [number, number])[1] > (knots[k - 1] as [number, number])[1])) return (v) => v;
    if (knots.length < 2) return (v) => v;
    return (v) => {
      const first = knots[0] as [number, number];
      const last = knots[knots.length - 1] as [number, number];
      if (v <= first[0]) return v + first[1] - first[0];
      if (v >= last[0]) return v + last[1] - last[0];
      const k = knots.findIndex((q) => q[0] >= v);
      const [d0, m0] = knots[k - 1] as [number, number];
      const [d1, m1] = knots[k] as [number, number];
      return m0 + ((v - d0) * (m1 - m0)) / (d1 - d0);
    };
  };
  const fx = remap("E");
  const fy = remap("N");
  return outline.map((p) => ({ x: fx(p.x), y: fy(p.y) }));
}

/**
 * The measure with a map outline (2026-10-23, lib/photoRouteMap.ts): the photos alone first, the map laid rigidly on the
 * house they make and each long side's wall traced, then the photos again with the walls it traces held to its distances.
 * Laid once more on the house as measured: walls traced differently there are held instead, and measured again. Each side
 * the map held is `fromMap`; how it was laid, what it held and where it and the photos disagree are `map`.
 */
function solveWithMap(input: PhotoRouteInput, buildingId: string, data: RoutePhotoData[], opts: SolveRouteOptions, map: MapOutline): RouteSolution {
  const photos = solveRoute(input, buildingId, data, { ...opts, map: false, guesses: false });
  // The photos' own sd on the distance between two walls: what they hold, not the shape as drawn.
  const sdBetween = (a: number, c: number): number | null => {
    const sol = photos.solution;
    const f = (x: Float64Array) => sol.wall(`w${c}`, x) - sol.wall(`w${a}`, x);
    const v = photos.unscaled ? sol.sigma(f) : sol.sigmaInformed(f);
    return Number.isFinite(v) ? v : null;
  };
  // With no tape the photos' house is to no scale: it is laid on the map at the map's size, only to see which wall is which.
  const area = (r: Pt[]) => Math.abs(r.reduce((s, p, i) => s + p.x * (r[(i + 1) % r.length] as Pt).y - (r[(i + 1) % r.length] as Pt).x * p.y, 0) / 2);
  const k = photos.unscaled ? Math.sqrt(area(map.corners) / Math.max(1e-6, area(photos.corners))) : 1;
  const ringToFit = photos.corners.map((p) => ({ x: p.x * k, y: p.y * k }));
  const fit = fitMapOutline(map, ringToFit, { sdBetween: photos.unscaled ? undefined : sdBetween, frontFacesDeg: opts.frontFacesDeg });
  const photosOnly = photos.sides.map((s) => ({ from: s.from, lengthFeet: s.lengthFeet, plusMinusPct: s.plusMinusPct, notMeasured: !!s.notMeasured }));
  if (!fit || fit.holds.length === 0) {
    const sol = opts.guesses === false ? photos : solveRoute(input, buildingId, data, { ...opts, map: false });
    return { ...sol, ...(fit ? { map: mapCheck(map, fit, sol.corners, photos.corners, sdBetween, photosOnly) } : {}) };
  }
  // Laid again on the house the map made: the photos' own house can be too far out to trace on (a depth 14' short puts the
  // map's side walls over the wrong walls); walls traced differently there are held instead, and measured again.
  let laid: MapFit = fit;
  let sol = solveRoute(input, buildingId, data, { ...opts, mapHolds: laid.holds });
  const again = fitMapOutline(map, sol.corners, { turnDeg: fit.turnDeg });
  if (again && again.holds.length && !sameHolds(again.holds, laid.holds)) {
    laid = again;
    sol = solveRoute(input, buildingId, data, { ...opts, mapHolds: laid.holds });
  } else if (again && again.holds.length) laid = { ...again, holds: laid.holds };
  // Held by the map: a side the photos left not measured that is measured now, or whose sd the map took down by half.
  const sides = sol.sides.map((s, i) => {
    const before = photos.sides[i] as RouteSide;
    const held = !s.taped && ((before.notMeasured && !s.notMeasured) || s.sdFeet < 0.5 * before.sdFeet);
    return held ? { ...s, fromMap: true as const } : s;
  });
  return { ...sol, sides, map: mapCheck(map, laid, sol.corners, photos.corners, sdBetween, photosOnly) };
}

function medianOf(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : 0;
}

function alongOf(sol: Solution, id: string, ring: Pt[], side: number): number {
  const [x, y] = sol.point(id);
  const A = ring[side] as Pt;
  const B = ring[(side + 1) % ring.length] as Pt;
  const L = segLen(A, B) || 1;
  return ((x - A.x) * (B.x - A.x) + (y - A.y) * (B.y - A.y)) / L;
}

interface TapeEnd {
  tape: string;
  /** Its point: its own, or the tied wall edge it lies on. */
  point: string;
  photo: string;
  side: number;
  bearing: number;
  at: [number, number];
  /** True when the tied point it joined already holds its own photo's bearing. */
  seen?: boolean;
  px: [number, number];
}

interface Placement {
  quadrant: number;
  at: [number, number];
  /** Misfit of its corners' bearings (radians squared), and how badly it sees the walls between them (0 face-on). */
  err: number;
  slant: number;
  /** The camera's heights over the ground its corners tapped below the horizon imply, feet, lowest and highest; null with none. */
  heights: [number, number] | null;
}

/**
 * Where a camera may have stood, from two or more of its corners on the shape drawn: each of the four
 * quarter-turns tried and the camera resected for it, kept when it sees its corners ahead, from outside
 * the house, with nothing of the house in the way, and faces every wall that runs between two of them.
 * Two corners fit any quarter-turn exactly, so there are often two answers: `chooseByWalk` picks. Given the photo's
 * [cam], a placement putting the camera at a height no photo is taken from (`PLACED_HEIGHT_FEET`, off any corner tapped
 * below the horizon) is dropped, as long as another is not.
 */
function placementsFromCorners(mine: SnappedTap[], outline: Pt[], shared: Set<number> = new Set(), cam?: PhotoCamera, facing?: [number, number] | null, toleranceDeg = FACING_TOLERANCE_DEG): Placement[] {
  const out: Placement[] = [];
  const n = outline.length;
  for (let q = 0; q < 4; q++) {
    const obs = mine.map((t) => ({ bearing: t.bearing, at: [(outline[t.corner] as Pt).x, (outline[t.corner] as Pt).y] as [number, number] }));
    const at = resect(obs, q);
    if (!at) continue;
    if (insideRing({ x: at[0], y: at[1] }, outline)) continue;
    // Not in the neighbour's home, and nothing of it in the way.
    if (inNeighbour({ x: at[0], y: at[1] }, outline, shared)) continue;
    if (obs.some((o) => neighbourBlocks({ x: at[0], y: at[1] }, { x: o.at[0], y: o.at[1] }, outline, shared))) continue;
    let err = 0;
    let ahead = true;
    for (const o of obs) {
      const d = planDirection(o.bearing, q, 0);
      const v0 = o.at[0] - at[0];
      const v1 = o.at[1] - at[1];
      if (d[0] * v0 + d[1] * v1 <= 0) ahead = false;
      err += Math.atan2(d[0] * v1 - d[1] * v0, d[0] * v0 + d[1] * v1) ** 2;
    }
    if (!ahead) continue;
    // A camera further than 300 ft off is no answer.
    if (Math.hypot(at[0] - outline[0]!.x, at[1] - outline[0]!.y) > 300) continue;
    const C = { x: at[0], y: at[1] };
    // Each corner the first thing its ray meets: the house is not see-through.
    let clear = true;
    for (const o of obs) {
      const P = { x: o.at[0], y: o.at[1] };
      const dist = segLen(C, P);
      const hit = castRay(C, [(P.x - C.x) / dist, (P.y - C.y) / dist], outline);
      if (hit && hit.t < dist - 0.5) clear = false;
    }
    if (!clear) continue;
    // A wall between two corners it saw must face it; seen at a slant it scores worse.
    let slant = 0;
    let faces = true;
    const tapped = new Set(mine.map((t) => t.corner));
    for (const i of tapped) {
      if (!tapped.has((i + 1) % n)) continue;
      const A = outline[i] as Pt;
      const B = outline[(i + 1) % n] as Pt;
      const nrm = outward(A, B);
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      const v = { x: C.x - mid.x, y: C.y - mid.y };
      const f = (v.x * nrm.x + v.y * nrm.y) / (Math.hypot(v.x, v.y) || 1);
      if (f <= 0) faces = false;
      slant += 1 - f;
    }
    if (!faces) continue;
    out.push({ quadrant: q, at, err, slant, heights: cam ? placedHeights(cam, mine, outline, q, at) : null });
  }
  const plausible = (p: Placement) => p.heights === null || (p.heights[0] >= PLACED_HEIGHT_FEET[0] && p.heights[1] <= PLACED_HEIGHT_FEET[1]);
  let list = out.some(plausible) ? out.filter(plausible) : out;
  // Taken from a step of the walk, it looked about that way (2026-10-21, house G: with one of its three corners left out,
  // photos fitted two corners on another quarter-turn and Scrivn's marks for the third landed 200-600 px off).
  if (facing && cam) {
    const { zl } = levelAxes(cam);
    const b0 = Math.atan2(zl[0], zl[2]);
    const cos = Math.cos((toleranceDeg * Math.PI) / 180);
    const faces = (p: Placement) => {
      const F = planDirection(b0, p.quadrant, 0);
      return F[0] * facing[0] + F[1] * facing[1] >= cos;
    };
    if (list.some(faces)) list = list.filter(faces);
  }
  return list;
}

/**
 * The camera's height over the ground at each corner tapped below the horizon, placed at [at] on quadrant [q]: the lowest
 * and the highest, feet. Every one is where a corner meets the ground (or a deck, which reads a little lower), so a
 * placement right is about five feet at each; null with none below the horizon.
 */
function placedHeights(cam: PhotoCamera, mine: SnappedTap[], outline: Pt[], q: number, at: [number, number]): [number, number] | null {
  const { zl } = levelAxes(cam);
  const zg = planDirection(Math.atan2(zl[0], zl[2]), q, 0);
  const hs = mine
    .filter((t) => t.v > cam.height / 2)
    .map((t) => {
      const P = outline[t.corner] as Pt;
      return ((t.v - cam.height / 2) / cam.f) * ((P.x - at[0]) * zg[0] + (P.y - at[1]) * zg[1]) + (t.aboveGround ?? 0);
    });
  return hs.length ? [Math.min(...hs), Math.max(...hs)] : null;
}

/**
 * One placement each: a photo whose corners leave one answer takes it; where two fit (two corners fit
 * any quarter-turn), the one nearer the photos taken just before and after it on the walk round the
 * house, then the one that sees its walls more face-on.
 */
function chooseByWalk(cands: Map<string, Placement[]>, photos: RoutePhoto[]): Map<string, { quadrant: number; at: [number, number] }> {
  const chosen = new Map<string, { quadrant: number; at: [number, number] }>();
  const order = photos.filter((p) => cands.has(p.id)).map((p, i) => ({ id: p.id, t: p.takenAt ?? i }));
  order.sort((a, b) => a.t - b.t);
  const sure = (list: Placement[]) => {
    if (list.length === 1) return list[0] as Placement;
    // Three or more corners: the misfit tells.
    const s = [...list].sort((a, b) => a.err - b.err);
    return (s[1] as Placement).err > 4 * (s[0] as Placement).err + 1e-4 ? (s[0] as Placement) : null;
  };
  for (const { id } of order) {
    const one = sure(cands.get(id) as Placement[]);
    if (one) chosen.set(id, { quadrant: one.quadrant, at: one.at });
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < order.length; k++) {
      const id = (order[k] as { id: string }).id;
      if (chosen.has(id)) continue;
      // The nearest photos in time either side that are placed.
      const near: [number, number][] = [];
      for (const dk of [-1, 1]) {
        for (let j = k + dk; j >= 0 && j < order.length; j += dk) {
          const c = chosen.get((order[j] as { id: string }).id);
          if (c) {
            near.push(c.at);
            break;
          }
        }
      }
      if (near.length === 0 && pass < 2) continue;
      const score = (p: Placement) => (near.length ? Math.min(...near.map((a) => Math.hypot(a[0] - p.at[0], a[1] - p.at[1]))) : 0) + 10 * p.slant;
      const best = [...(cands.get(id) as Placement[])].sort((a, b) => score(a) - score(b))[0] as Placement;
      chosen.set(id, { quadrant: best.quadrant, at: best.at });
    }
  }
  return chosen;
}

/** Each placed photo's upright edges laid on the walls their rays meet first, face-on enough and clear of the corners. */
function wallObservations(
  placed: Map<string, { quadrant: number; at: [number, number] }>,
  byId: Map<string, RoutePhotoData>,
  ring: Pt[],
  sol: Solution,
  camHeight: (id: string) => number | null,
): EdgeObs[] {
  const out: EdgeObs[] = [];
  const n = ring.length;
  for (const [id, c] of placed) {
    const d = byId.get(id);
    if (!d?.camera) continue;
    const yaw = sol.input.cameras.some((x) => x.id === id) ? sol.camera(id).yaw : 0;
    const h = camHeight(id) ?? 5;
    const { xl, zl } = levelAxes(d.camera);
    void xl;
    const zg = planDirection(Math.atan2(zl[0], zl[2]), c.quadrant, yaw);
    d.edges.forEach((e, index) => {
      const bearing = columnBearing(d.camera as PhotoCamera, e.u);
      const dir = planDirection(bearing, c.quadrant, yaw);
      const hit = castRay({ x: c.at[0], y: c.at[1] }, dir, ring);
      if (!hit) return;
      const A = ring[hit.side] as Pt;
      const B = ring[(hit.side + 1) % n] as Pt;
      const L = segLen(A, B);
      const nrm = outward(A, B);
      // Facing the camera, and not seen all but edge-on (6 degrees at least: a side yard is seen no better).
      if ((c.at[0] - A.x) * nrm.x + (c.at[1] - A.y) * nrm.y <= 0) return;
      const graze = Math.abs(dir[0] * nrm.x + dir[1] * nrm.y);
      if (graze < Math.sin((6 * Math.PI) / 180)) return;
      // Clear of the corners: those are tapped.
      if (hit.along < 0.4 || hit.along > L - 0.4) return;
      const depth = hit.t * (dir[0] * zg[0] + dir[1] * zg[1]);
      const cam = d.camera as PhotoCamera;
      const zAt = (v: number) => h - ((v - cam.height / 2) / cam.f) * depth;
      out.push({ photo: id, index, side: hit.side, along: hit.along, polarity: e.polarity, bearing, zLow: zAt(e.vBottom), zHigh: zAt(e.vTop), from: c.at, graze, at: [c.at[0] + dir[0] * hit.t, c.at[1] + dir[1] * hit.t], px: fromLevel(cam, e.u, (e.vTop + e.vBottom) / 2) ?? [cam.width / 2, cam.height / 2] });
    });
  }
  return out;
}

/**
 * Edges on the same wall seen from two photos tied as one point (the proof's window and door jambs):
 * for each pair of photos, the shift along the wall (within `search` feet - the cameras' error so far)
 * that lines up the most of their edges of the same light/dark side and overlapping heights, within
 * `tol`; edges tied that way joined across all pairs, each point at most one edge a photo.
 */
function tieEdges(obs: EdgeObs[], search: number, tol: number): { id: string; side: number; obs: EdgeObs[]; along: number }[] {
  const bySide = new Map<number, EdgeObs[]>();
  for (const o of obs) (bySide.get(o.side) ?? bySide.set(o.side, []).get(o.side))?.push(o);
  const points: { id: string; side: number; obs: EdgeObs[]; along: number }[] = [];
  let next = 0;
  for (const [side, list] of bySide) {
    // A run of edges thicker than one every 4 inches is a railing or a fence in front of the wall: no use for tying.
    const photos = [...new Set(list.map((o) => o.photo))];
    const per = new Map(photos.map((p) => [p, thin(list.filter((o) => o.photo === p).sort((a, b) => a.along - b.along))]));
    const parent = new Map<EdgeObs, EdgeObs>();
    const find = (o: EdgeObs): EdgeObs => {
      let r = o;
      while (parent.get(r) && parent.get(r) !== r) r = parent.get(r) as EdgeObs;
      return r;
    };
    for (let i = 0; i < photos.length; i++) {
      for (let j = i + 1; j < photos.length; j++) {
        const P = per.get(photos[i] as string) as EdgeObs[];
        const Q = per.get(photos[j] as string) as EdgeObs[];
        if (P.length < 2 || Q.length < 2) continue;
        // Two photos from nearly the same way tie anything in front of the wall as if on it - a post, a railing, a bin:
        // only photos whose views of the wall differ by 8 degrees or more are tied.
        const mid = (P[Math.floor(P.length / 2)] as EdgeObs).along;
        void mid;
        const a0 = Math.atan2((P[0] as EdgeObs).from[1] - wallMid(P), (P[0] as EdgeObs).from[0] - wallMidX(P));
        const b0 = Math.atan2((Q[0] as EdgeObs).from[1] - wallMid(P), (Q[0] as EdgeObs).from[0] - wallMidX(P));
        let dAng = Math.abs(a0 - b0);
        if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
        if (dAng < (8 * Math.PI) / 180) continue;
        let bestD = 0;
        let best: [EdgeObs, EdgeObs][] = [];
        for (let d = -search; d <= search + 1e-9; d += 0.02) {
          const m = matchShift(P, Q, d, tol);
          if (m.length > best.length || (m.length === best.length && Math.abs(d) < Math.abs(bestD))) {
            best = m;
            bestD = d;
          }
        }
        if (best.length < 3) continue;
        for (const [p, q] of best) {
          if (!parent.has(p)) parent.set(p, p);
          if (!parent.has(q)) parent.set(q, q);
          parent.set(find(p), find(q));
        }
      }
    }
    const groups = new Map<EdgeObs, EdgeObs[]>();
    for (const o of parent.keys()) (groups.get(find(o)) ?? groups.set(find(o), []).get(find(o)))?.push(o);
    for (const g of groups.values()) {
      // One edge a photo; a group holding two of one photo's is no single edge.
      const seen = new Set(g.map((o) => o.photo));
      if (seen.size !== g.length || g.length < 2) continue;
      points.push({ id: `e${next++}`, side, obs: g, along: g.reduce((s, o) => s + o.along, 0) / g.length });
    }
  }
  return points;
}

/** Where on the plan the edges of a list lie, roughly: the middle of their rays' ends (for the angle two photos see a wall from). */
function wallMidX(list: EdgeObs[]): number {
  return list.reduce((s, o) => s + o.at[0], 0) / list.length;
}
function wallMid(list: EdgeObs[]): number {
  return list.reduce((s, o) => s + o.at[1], 0) / list.length;
}

/**
 * Edges of one photo on one wall, with railings and pickets taken out: a run of edges every 4 or 5
 * inches (seven or more within 9 inches either side). A window's or a door's trim is three or four
 * edges to a jamb, and stays.
 */
function thin(sorted: EdgeObs[]): EdgeObs[] {
  return sorted.filter((o, i) => {
    const near = sorted.filter((p, k) => k !== i && Math.abs(p.along - o.along) < 0.75).length;
    return near < 6;
  });
}

function matchShift(P: EdgeObs[], Q: EdgeObs[], d: number, tol: number): [EdgeObs, EdgeObs][] {
  const out: [EdgeObs, EdgeObs][] = [];
  const used = new Set<EdgeObs>();
  for (const p of P) {
    let best: EdgeObs | null = null;
    let bestE = tol;
    for (const q of Q) {
      if (used.has(q) || q.polarity !== p.polarity) continue;
      const e = Math.abs(p.along - (q.along + d));
      // Seen at a slant an edge's place along the wall is that much less sure: up to four times the tolerance.
      const slack = Math.min(4, Math.max(1, 0.5 / Math.min(p.graze, q.graze)));
      if (e > bestE * slack) continue;
      // Their heights overlap by half the shorter at least.
      const lo = Math.max(p.zLow, q.zLow);
      const hi = Math.min(p.zHigh, q.zHigh);
      const shorter = Math.min(p.zHigh - p.zLow, q.zHigh - q.zLow);
      if (hi - lo < 0.3 * shorter) continue;
      best = q;
      bestE = e;
    }
    if (best) {
      used.add(best);
      out.push([p, best]);
    }
  }
  return out;
}

/** A wall edge two or more photos tied, where the solve put it: on its wall, at its height, light on one side. */
interface TiedPoint {
  side: number;
  at: Pt;
  zLow: number;
  zHigh: number;
  polarity: 1 | -1;
}

/** The tied wall edges as points on the plan, each at the middle of the heights its photos saw it at. */
function tiedPoints(points: { side: number; obs: EdgeObs[]; along: number }[], ring: Pt[]): TiedPoint[] {
  const n = ring.length;
  const med = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] as number;
  };
  return points.flatMap((p) => {
    const A = ring[p.side] as Pt;
    const B = ring[(p.side + 1) % n] as Pt;
    const L = segLen(A, B) || 1;
    const first = p.obs[0];
    if (!first) return [];
    return [{ side: p.side, at: { x: A.x + ((B.x - A.x) / L) * p.along, y: A.y + ((B.y - A.y) / L) * p.along }, zLow: med(p.obs.map((o) => o.zLow)), zHigh: med(p.obs.map((o) => o.zHigh)), polarity: first.polarity }];
  });
}

/** Most tied edges a photo may be asked to repeat, the strongest: more add time, not a better answer. */
const PLACE_POINTS_MAX = 80;
/** A photo with one corner is placed where at least this many tied edges land on its own; one with none, this many. */
const PLACE_MIN_ONE = 5;
const PLACE_MIN_NONE = 7;
/** And by this many more than anywhere else it could have stood (four feet off, or another quarter-turn). */
const PLACE_MARGIN_ONE = 2;
const PLACE_MARGIN_NONE = 3;

/**
 * A photo with one corner, or none (2026-10-20, every photo counts): placed where its upright edges best repeat
 * the wall edges the placed photos tied - each tied edge seen from there landing on one of its own, on the same
 * column (to a few inches), light on the same side, at the same height and as tall. Heights are what make it
 * work: from too near a wall every edge would read far taller than it is. With one corner the camera is on that
 * corner's ray and held 3 to 7.5 ft up; with none it is searched round the house. Each quarter-turn is tried, and
 * a degree of turn either way on top of the vanishing points. Null when no place lines up enough of them, or two
 * places do equally: the photo is then left out, and said so.
 */
function placeByEdges(
  tap: SnappedTap | null,
  d: RoutePhotoData,
  ring: Pt[],
  tied: TiedPoint[],
  shared: Set<number>,
  trace?: (poses: { q: number; dyaw: number; h: number; C: Pt; s: number; v: number }[]) => void,
  near?: { at: Pt; radius: number },
): { quadrant: number; at: [number, number]; score: number; confident: boolean; spots: { at: [number, number]; score: number }[] } | null {
  const cam = d.camera as PhotoCamera;
  const n = ring.length;
  if (tied.length < (tap ? PLACE_MIN_ONE : PLACE_MIN_NONE)) return null;
  const pts = tied.slice(0, PLACE_POINTS_MAX);
  const W = cam.width;
  const f = cam.f;
  const cy = cam.height / 2;
  const { zl } = levelAxes(cam);
  const b0 = Math.atan2(zl[0], zl[2]);
  const edges = d.edges.map((e, i) => ({ ...e, i })).sort((a, b) => a.u - b.u);
  const firstAt = (u: number) => {
    let lo = 0;
    let hi = edges.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((edges[mid] as { u: number }).u < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const sides = ring.map((A, i) => {
    const B = ring[(i + 1) % n] as Pt;
    return { A, nrm: outward(A, B) };
  });
  /** How many tied edges a camera at C (quarter-turn q, turned dyaw more, h ft up) sees land on its own. */
  /** How many tied edges the last pose scored should have seen at all. */
  let lastSeen = 0;
  const score = (C: Pt, q: number, dyaw: number, h: number): number => {
    const Z = GDIR_PLAN[q] as [number, number];
    const X: [number, number] = [Z[1], -Z[0]];
    const cs = Math.cos(dyaw);
    const sn = Math.sin(dyaw);
    const used = new Set<number>();
    let got = 0;
    let seen = 0;
    for (const p of pts) {
      const s = sides[p.side] as { A: Pt; nrm: Pt };
      if ((C.x - s.A.x) * s.nrm.x + (C.y - s.A.y) * s.nrm.y <= 0.5) continue;
      const v0 = p.at.x - C.x;
      const v1 = p.at.y - C.y;
      const dist = Math.hypot(v0, v1);
      if (dist < 4) continue;
      // Its column in the photo: planDirection with this quarter-turn and turn, run backwards.
      const l0 = cs * v0 - sn * v1;
      const l1 = sn * v0 + cs * v1;
      const off = Math.atan2(l0 * X[0] + l1 * X[1], l0 * Z[0] + l1 * Z[1]) - b0;
      if (Math.cos(off) < 0.25) continue;
      const u = W / 2 + f * Math.tan(off);
      if (u < 0.02 * W || u > 0.98 * W) continue;
      const hit = castRay(C, [v0 / dist, v1 / dist], ring);
      if (!hit || hit.side !== p.side || Math.abs(hit.t - dist) > 0.5) continue;
      if (shared.size && neighbourBlocks(C, p.at, ring, shared)) continue;
      seen++;
      const depth = dist * Math.cos(off);
      const top = cy - (f * (p.zHigh - h)) / depth;
      const bottom = cy - (f * (p.zLow - h)) / depth;
      const tall = bottom - top;
      const tol = 2.5 + (f * 0.3) / depth;
      for (let k = firstAt(u - tol); k < edges.length; k++) {
        const e = edges[k] as UprightEdge & { i: number };
        if (e.u > u + tol) break;
        if (used.has(e.i) || e.polarity !== p.polarity) continue;
        const seen = e.vBottom - e.vTop;
        const overlap = Math.min(bottom, e.vBottom) - Math.max(top, e.vTop);
        if (overlap < 0.3 * Math.min(seen, tall) || seen < 0.35 * tall || seen > 2.8 * tall) continue;
        used.add(e.i);
        got++;
        break;
      }
    }
    lastSeen = seen;
    return got;
  };
  type Pose = { q: number; dyaw: number; h: number; C: Pt; s: number; v: number };
  const poses: Pose[] = [];
  const DY = [-1, -0.5, 0, 0.5, 1].map((dg) => (dg * Math.PI) / 180);
  const okSpot = (C: Pt) => !insideRing(C, ring) && !(shared.size && inNeighbour(C, ring, shared)) && (!near || Math.hypot(C.x - near.at.x, C.y - near.at.y) <= near.radius);
  if (tap) {
    const P = ring[tap.corner] as Pt;
    const drop = (tap.v - cy) / f;
    for (let q = 0; q < 4; q++) {
      for (const dyaw of DY) {
        const dir = planDirection(tap.bearing, q, dyaw);
        const zg = planDirection(b0, q, dyaw);
        const ahead = dir[0] * zg[0] + dir[1] * zg[1];
        if (ahead <= 0.2) continue;
        for (let t = 5; t <= 150; t += t < 40 ? 0.25 : 0.5) {
          const C = { x: P.x - dir[0] * t, y: P.y - dir[1] * t };
          if (!okSpot(C)) continue;
          // Held in the hand, 3 to 7.5 ft over the ground at the corner it shows.
          const h = drop > 0.005 ? drop * t * ahead : HAND_FEET;
          if (drop > 0.005 && (h < PLACE_HAND_FEET[0] || h > PLACE_HAND_FEET[1])) continue;
          const back = castRay(C, dir, ring);
          if (back && back.t < t - 0.5) continue;
          if (shared.size && neighbourBlocks(C, P, ring, shared)) continue;
          const s = score(C, q, dyaw, h);
          poses.push({ q, dyaw, h, C, s, v: lastSeen });
        }
      }
    }
  } else {
    // No corner: round the house on a 3 ft grid, then the best few again on a finer one.
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    const x0 = Math.min(...xs) - 70;
    const x1 = Math.max(...xs) + 70;
    const y0 = Math.min(...ys) - 70;
    const y1 = Math.max(...ys) + 70;
    const coarse: Pose[] = [];
    for (let q = 0; q < 4; q++)
      for (const dyaw of DY)
        for (const h of [4, 6])
          for (let x = x0; x <= x1; x += 3)
            for (let y = y0; y <= y1; y += 3) {
              const C = { x, y };
              if (!okSpot(C)) continue;
              const s = score(C, q, dyaw, h);
              if (s >= 3) coarse.push({ q, dyaw, h, C, s, v: lastSeen });
            }
    coarse.sort((a, b) => b.s - a.s);
    const seeds = coarse.slice(0, 12);
    for (const sd of seeds) {
      for (let dx = -2; dx <= 2; dx += 0.5)
        for (let dy = -2; dy <= 2; dy += 0.5)
          for (const ddy of [-0.25, 0, 0.25].map((dg) => (dg * Math.PI) / 180))
            for (const h of [sd.h - 1, sd.h, sd.h + 1]) {
              const C = { x: sd.C.x + dx, y: sd.C.y + dy };
              if (!okSpot(C)) continue;
              const s = score(C, sd.q, sd.dyaw + ddy, h);
              poses.push({ q: sd.q, dyaw: sd.dyaw + ddy, h, C, s, v: lastSeen });
            }
    }
    poses.push(...coarse);
  }
  if (poses.length === 0) return null;
  poses.sort((a, b) => b.s - a.s);
  trace?.(poses);
  const best = poses[0] as Pose;
  // A rival: another quarter-turn, or a place 8 ft or more away (a few feet along the same ray is the same answer).
  const second = poses.find((p) => p.q !== best.q || Math.hypot(p.C.x - best.C.x, p.C.y - best.C.y) > 8);
  const min = tap ? PLACE_MIN_ONE : PLACE_MIN_NONE;
  const margin = tap ? PLACE_MARGIN_ONE : PLACE_MARGIN_NONE;
  // The best places a few feet apart, for the user to say which (or neither).
  const spots: { at: [number, number]; score: number }[] = [];
  for (const p of poses) {
    if (spots.length >= 3 || p.s < 2) break;
    if (spots.some((s) => Math.hypot(s.at[0] - p.C.x, s.at[1] - p.C.y) < 8)) continue;
    spots.push({ at: [p.C.x, p.C.y], score: p.s });
  }
  if (best.s < 2) return null;
  const confident = best.s >= min && !(second && best.s < second.s + margin);
  // Fits one place clearly: that one first and alone; else its best few.
  return { quadrant: best.q, at: [best.C.x, best.C.y], score: best.s, confident, spots: confident ? spots.slice(0, 1) : spots };
}

/** A stand spot is held this loosely (one sd, ft): it is tapped on a rough shape. */
const STOOD_SD_FEET = 8;
/** A photo with no corner and a stand spot is searched this far round it. */
const STOOD_SEARCH_FEET = 12;

/**
 * A point on the shape as drawn on the shape as solved, axis by axis: each corner's drawn x goes to its solved x (and
 * y to y), and anything between goes between - so a stand spot tapped beside the drawn garage lands beside the solved one.
 */
function sketchToSolved(drawn: Pt[], solved: Pt[]): (p: [number, number]) => [number, number] {
  const axis = (pick: (q: Pt) => number) => {
    const pairs = drawn.map((q, i) => [pick(q), pick(solved[i] as Pt)] as [number, number]).sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [a, s] of pairs) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last[0] - a) < 1e-6) last[1] = (last[1] + s) / 2;
      else merged.push([a, s]);
    }
    return (v: number): number => {
      if (merged.length === 1) return v - (merged[0] as [number, number])[0] + (merged[0] as [number, number])[1];
      let k = 1;
      while (k < merged.length - 1 && (merged[k] as [number, number])[0] < v) k++;
      const [a0, s0] = merged[k - 1] as [number, number];
      const [a1, s1] = merged[k] as [number, number];
      return s0 + ((v - a0) * (s1 - s0)) / (a1 - a0 || 1);
    };
  };
  const fx = axis((q) => q.x);
  const fy = axis((q) => q.y);
  return (p) => [fx(p[0]), fy(p[1])];
}

/**
 * A photo with one corner and a stand spot: on that corner's ray, for the quarter-turn whose ray passes nearest the
 * spot, as near it as the ray goes - outside the house, the corner the first thing it sees.
 */
function nearestOnRay(tap: SnappedTap, ring: Pt[], spot: [number, number], shared: Set<number>): { quadrant: number; at: [number, number]; score: number; confident: boolean; spots: { at: [number, number]; score: number }[] } | null {
  const P = ring[tap.corner] as Pt;
  let best: { quadrant: number; at: [number, number]; off: number } | null = null;
  for (let q = 0; q < 4; q++) {
    const dir = planDirection(tap.bearing, q, 0);
    const t = (P.x - spot[0]) * dir[0] + (P.y - spot[1]) * dir[1];
    if (t < 4) continue;
    const C = { x: P.x - dir[0] * t, y: P.y - dir[1] * t };
    if (insideRing(C, ring) || (shared.size && inNeighbour(C, ring, shared))) continue;
    const back = castRay(C, dir, ring);
    if (back && back.t < t - 0.5) continue;
    const off = Math.hypot(C.x - spot[0], C.y - spot[1]);
    if (!best || off < best.off) best = { quadrant: q, at: [C.x, C.y], off };
  }
  return best ? { quadrant: best.quadrant, at: best.at, score: 0, confident: true, spots: [] } : null;
}

/** A detail photo as placed on the house as measured (2026-10-22): read from, never sizing it. */
interface DetailCamera {
  quadrant: number;
  at: [number, number];
  /** Its turn on top of its vanishing points, radians. */
  yaw: number;
  heightFeet: number | null;
  placedBy: RouteCamera["placedBy"];
}

/** How far a detail photo's wall edge may be from a tied one to be taken as it, feet, round by round as the photo settles. */
const DETAIL_TIE_FEET = [0.6, 0.3, 0.2];

/**
 * The photos that don't size the house, placed on it as measured, only to be read (2026-10-22, cleaner input): a detail
 * photo (one corner or none) where the user stood for it, and a photo the self-check left out of the size, by its corners.
 * Everything the size solve found is held where it put it - every wall, every window and door edge two measure photos
 * tied - and only the photo's own place and turn are solved: from its corner, its upright edges on the tied ones near
 * them, a tape on it (which places it and sizes nothing), the stand spot loosely and the hand height. So a guessed stand
 * spot can put the photo a little wrong for reading, and nothing else.
 */
function placeDetailPhotos(ctx: {
  input: PhotoRouteInput;
  b: RouteBuilding;
  byId: Map<string, RoutePhotoData>;
  ring: Pt[];
  sol: Solution;
  walls: SolveWall[];
  taps: SnappedTap[];
  edgePoints: { id: string; side: number; obs: EdgeObs[]; along: number }[];
  tapes: Extract<RouteTape, { kind: "line" }>[];
  sized: Set<string>;
  outOfSize: Set<string>;
  legacy: boolean;
}): Map<string, DetailCamera> {
  const { input, b, byId, ring, sol, walls, taps, edgePoints, tapes, sized, outOfSize, legacy } = ctx;
  const out = new Map<string, DetailCamera>();
  const n = ring.length;
  const shared = new Set(b.shared ?? []);
  const toSolved = sketchToSolved(b.outline, ring);
  const fixedWalls: SolveWall[] = walls.map((w) => ({ ...w, fixed: true, guess: sol.wall(w.id) }));
  const { corners } = outlineWalls(b.outline);
  // The tied wall edges where the size solve put them.
  const tied = edgePoints.map((q) => {
    const A = ring[q.side] as Pt;
    const B = ring[(q.side + 1) % n] as Pt;
    const L = segLen(A, B) || 1;
    const along = sol.input.points.some((x) => x.id === q.id) ? alongOf(sol, q.id, ring, q.side) : q.along;
    return { id: q.id, side: q.side, along, at: { x: A.x + ((B.x - A.x) / L) * along, y: A.y + ((B.y - A.y) / L) * along }, zLow: medianOf(q.obs.map((o) => o.zLow)), zHigh: medianOf(q.obs.map((o) => o.zHigh)), polarity: (q.obs[0] as EdgeObs).polarity };
  });
  const tiedForPlacing: TiedPoint[] = tied.map((t) => ({ side: t.side, at: t.at, zLow: t.zLow, zHigh: t.zHigh, polarity: t.polarity }));
  for (const p of input.photos) {
    const d = byId.get(p.id);
    if (sized.has(p.id) || !d?.camera) continue;
    const cam = d.camera;
    const mine = taps.filter((t) => t.photo === p.id);
    let start: { quadrant: number; at: [number, number]; placedBy: RouteCamera["placedBy"]; spot: [number, number] | null } | null = null;
    if (mine.length >= 2) {
      // Left out of the size by the self-check: placed by its corners on the house as measured.
      if (!outOfSize.has(p.id)) continue;
      const list = placementsFromCorners(mine, ring, shared, cam, facingOf(p, ring));
      const best = [...list].sort((x, y) => 200 * x.err + x.slant - (200 * y.err + y.slant))[0];
      if (best) start = { quadrant: best.quadrant, at: best.at, placedBy: "corners", spot: null };
    } else if (p.standAt && !legacy) {
      const spot = toSolved(p.standAt);
      const placed = mine[0] ? nearestOnRay(mine[0], ring, spot, shared) : placeByEdges(null, d, ring, tiedForPlacing, shared, undefined, { at: { x: spot[0], y: spot[1] }, radius: STOOD_SEARCH_FEET });
      if (placed) start = { quadrant: placed.quadrant, at: placed.at, placedBy: "stood", spot };
    }
    if (!start) continue;
    let at = start.at;
    let yaw = 0;
    let fit = Number.POSITIVE_INFINITY;
    let bearingsUsed = 0;
    for (const tol of DETAIL_TIE_FEET) {
      const fake = { input: { cameras: [{ id: p.id }] }, camera: () => ({ at, yaw }) } as unknown as Solution;
      const here = new Map([[p.id, { quadrant: start.quadrant, at }]]);
      const h = heightAt(cam, mine, ring, start.quadrant, at, yaw);
      const obs = wallObservations(here, byId, ring, fake, () => h).filter((o) => !shared.has(o.side));
      // Each of its edges on the tied edge nearest it on the same wall, light on the same side, heights overlapping; one each.
      const pairs: { o: EdgeObs; t: (typeof tied)[number]; e: number }[] = [];
      for (const o of obs) {
        for (const t of tied) {
          if (t.side !== o.side || t.polarity !== o.polarity) continue;
          const e = Math.abs(t.along - o.along);
          const slack = Math.min(4, Math.max(1, 0.5 / o.graze));
          const lo = Math.max(o.zLow, t.zLow);
          const hi = Math.min(o.zHigh, t.zHigh);
          if (e <= tol * slack && hi - lo >= 0.3 * Math.min(o.zHigh - o.zLow, t.zHigh - t.zLow)) pairs.push({ o, t, e });
        }
      }
      pairs.sort((x, y) => x.e - y.e);
      const usedO = new Set<EdgeObs>();
      const usedT = new Set<string>();
      const matched = pairs.filter((q) => {
        if (usedO.has(q.o) || usedT.has(q.t.id)) return false;
        usedO.add(q.o);
        usedT.add(q.t.id);
        return true;
      });
      const points: SolvePoint[] = corners.map((c) => ({ ...c }));
      const extraWalls: SolveWall[] = [];
      const bearings: SolveBearing[] = [];
      const pin = (id: string, side: number, P: Pt) => {
        const w = fixedWalls[side] as SolveWall;
        const free: SolveWall = { id: `fix:${id}`, axis: w.axis === "E" ? "N" : "E", guess: w.axis === "E" ? P.y : P.x, fixed: true };
        extraWalls.push(free);
        points.push({ id, e: w.axis === "E" ? w.id : free.id, n: w.axis === "N" ? w.id : free.id, guess: [P.x, P.y] });
      };
      for (const t of mine) bearings.push({ camera: p.id, point: `c${t.corner}`, bearing: t.bearing, sd: CORNER_SD / cam.f });
      for (const q of matched) {
        pin(q.t.id, q.t.side, q.t.at);
        bearings.push({ camera: p.id, point: q.t.id, bearing: q.o.bearing, sd: PX_SD / cam.f });
      }
      // A tape on it: its ends on the wall each meets, as far apart as taped - what says how far off it stood.
      const distances: SolveDistance[] = [];
      for (const tp of tapes.filter((x) => x.photo === p.id)) {
        const ends: string[] = [];
        for (const [k, end] of [["a", tp.a], ["b", tp.b]] as const) {
          const s = tp.exact ? { u: toLevel(cam, end[0], end[1])[0] } : snapToEdge(d.gray, cam, end[0], end[1], { above: 60, below: 60 });
          const bearing = columnBearing(cam, s.u);
          const dir = planDirection(bearing, start.quadrant, yaw);
          const hit = castRay({ x: at[0], y: at[1] }, dir, ring);
          if (!hit) continue;
          const w = fixedWalls[hit.side] as SolveWall;
          const id = `tape:${tp.id}:${k}`;
          points.push({ id, e: w.axis === "E" ? w.id : null, n: w.axis === "N" ? w.id : null, guess: [at[0] + dir[0] * hit.t, at[1] + dir[1] * hit.t] });
          bearings.push({ camera: p.id, point: id, bearing, sd: PX_SD / cam.f });
          ends.push(id);
        }
        if (ends.length === 2) distances.push({ id: tp.id, a: ends[0] as string, b: ends[1] as string, axis: "any", feet: tp.feet, sdFeet: TAPE_SD_FEET });
      }
      const low = mine.filter((t) => t.v > cam.height / 2 + 0.02 * cam.f).sort((x, y) => x.v - y.v).pop();
      const { zl } = levelAxes(cam);
      const heights = low ? [{ camera: p.id, point: `c${low.corner}`, drop: (low.v - cam.height / 2) / cam.f, forward: Math.atan2(zl[0], zl[2]), feet: HAND_FEET - (low.aboveGround ?? 0), sdFeet: HAND_SD_FEET }] : [];
      const s = solvePlan({
        walls: [...fixedWalls, ...extraWalls],
        points,
        cameras: [{ id: p.id, quadrant: start.quadrant, guess: at, yawSdDeg: YAW_SD_DEG, ...(start.spot ? { prior: { at: start.spot, sdFeet: STOOD_SD_FEET } } : {}) }],
        bearings,
        distances,
        heights,
      });
      const C = s.camera(p.id);
      if (!Number.isFinite(C.at[0]) || !Number.isFinite(C.at[1]) || insideRing({ x: C.at[0], y: C.at[1] }, ring)) break;
      at = C.at;
      yaw = C.yaw;
      fit = s.rms;
      bearingsUsed = bearings.length;
    }
    // Its own bearings fitting badly where it was put: not where it was taken (as a photo placed by its edges, `PLACED_FIT_SD`).
    if (bearingsUsed >= 3 && fit > PLACED_FIT_SD) continue;
    out.set(p.id, { quadrant: start.quadrant, at, yaw, heightFeet: heightAt(cam, mine, ring, start.quadrant, at, yaw), placedBy: start.placedBy });
  }
  return out;
}

/** A camera's height over the ground at the corners tapped in it (the median), placed at [at] on quadrant [q] turned [yaw]; null with none ahead. */
function heightAt(cam: PhotoCamera, mine: SnappedTap[], ring: Pt[], q: number, at: [number, number], yaw: number): number | null {
  const { zl } = levelAxes(cam);
  const zg = planDirection(Math.atan2(zl[0], zl[2]), q, yaw);
  const hs: number[] = [];
  for (const t of mine) {
    const P = ring[t.corner] as Pt;
    const depth = (P.x - at[0]) * zg[0] + (P.y - at[1]) * zg[1];
    if (depth > 1) hs.push(((t.v - cam.height / 2) / cam.f) * depth + (t.aboveGround ?? 0));
  }
  if (hs.length === 0) return null;
  hs.sort((x, y) => x - y);
  return hs[Math.floor(hs.length / 2)] as number;
}

/** A point on one shape on another of the same corners, axis by axis: the drawn shape to the solved and back (the pane's stand spots). */
export const planMapping = sketchToSolved;

/** For the tests: where placeByEdges would put a photo, and the tied points it had. */
export const placeSteps = { placeByEdges, tiedPoints };

/**
 * Which sides want a tape, and why, in plain words: any whose ± is over 5%, and any whose measure disagrees with what
 * was estimated on site. Advice only: nothing waits on it.
 */
/** A wall this long or longer is a long wall: its ± over `NOT_MEASURED_PCT` makes it not measured (a short step or jog stays "to check"). */
export const LONG_WALL_FEET = 15;
/** A long wall the photos hold no better than this, ± percent, is not measured. */
export const NOT_MEASURED_PCT = 10;

/** How the placed measure photos saw side i: the squarest any faced it (degrees), which of its corners were tapped, its tied edges. */
function sideSeen(i: number, ring: Pt[], cameras: RouteCamera[], taps: SnappedTap[], points: { side: number }[]): { squarest: number; ends: number[]; edges: number } {
  const n = ring.length;
  const A = ring[i] as Pt;
  const B = ring[(i + 1) % n] as Pt;
  const nrm = outward(A, B);
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  let squarest = 0;
  for (const c of cameras) {
    const v = { x: mid.x - c.at[0], y: mid.y - c.at[1] };
    const L = Math.hypot(v.x, v.y) || 1;
    const facing = -(v.x * nrm.x + v.y * nrm.y) / L;
    if (facing > 0) squarest = Math.max(squarest, (Math.asin(Math.min(1, facing)) * 180) / Math.PI);
  }
  const placed = new Set(cameras.map((c) => c.photo));
  return { squarest, ends: [i, (i + 1) % n].filter((k) => taps.some((t) => t.corner === k && placed.has(t.photo))), edges: points.filter((p) => p.side === i).length };
}

/**
 * Each long wall the photos hold no better than ±10% marked not measured (2026-10-22), with why and the one thing that would
 * measure it: a far-back photo at 45° to a corner of it no measure photo shows; a tape along it when it was only seen from
 * along it (a side yard) or the photos round it just don't hold it. [off]: not marked (the old way, or no tape at all).
 */
function markLongWalls(sides: RouteSide[], ring: Pt[], cameras: RouteCamera[], taps: SnappedTap[], points: { side: number }[], off: boolean): RouteSide[] {
  if (off) return sides;
  const n = ring.length;
  for (const s of sides) {
    if (s.taped || s.plusMinusPct === null || s.plusMinusPct <= NOT_MEASURED_PCT || s.lengthFeet < LONG_WALL_FEET) continue;
    const i = s.from;
    const seen = sideSeen(i, ring, cameras, taps, points);
    const missing = [i, (i + 1) % n].find((k) => !seen.ends.includes(k));
    const name = `corner ${i + 1} to corner ${((i + 1) % n) + 1}`;
    if (missing !== undefined && seen.squarest >= 25) {
      s.notMeasured = { why: `±${s.plusMinusPct}%: corner ${missing + 1} is on no photo that sizes the house`, fix: `A photo from far back at 45° to corner ${missing + 1}, both its walls in, measures it - or a tape along it, ${name}.` };
    } else if (seen.squarest < 25) {
      s.notMeasured = { why: `±${s.plusMinusPct}%: it was only seen from along it (a side yard, a narrow gap), never faced`, fix: `A tape along it, ${name}, measures it.` };
    } else {
      s.notMeasured = { why: `±${s.plusMinusPct}%: the photos round it don't hold it`, fix: `A tape along it, ${name}, measures it.` };
    }
  }
  return sides;
}

/**
 * Every untaped side marked not measured when the tapes that size the house disagree by more than 5% held out (2026-10-22,
 * lib/photoRouteCheck.ts): the scale is no better than that anywhere. The fix named is the tape most off - [tape] in words,
 * and how far the others put it off.
 */
export function tapesDisagree(sides: RouteSide[], worstPct: number, tape: string, offPct: number): RouteSide[] {
  return sides.map((s) =>
    s.taped
      ? s
      : {
          ...s,
          notMeasured: {
            why: `the tapes disagree by up to ${worstPct.toFixed(1)}%, held out in turn${s.notMeasured ? `; and ${s.notMeasured.why}` : ""}`,
            // One fix each: a side loose by itself keeps its own (checking the tape would not measure it); the rest, the tape.
            fix: s.notMeasured ? s.notMeasured.fix : `Check ${tape} again: the others put it ${offPct >= 0 ? "+" : ""}${offPct.toFixed(1)}% off - what was taped, and its ends.`,
          },
        },
  );
}

function tapeAdvice(sides: RouteSide[], ring: Pt[], cameras: RouteCamera[], taps: SnappedTap[], points: { side: number; obs: EdgeObs[] }[], shared: Set<number> = new Set()): { from: number; why: string }[] {
  const n = ring.length;
  const out: { from: number; why: string }[] = [];
  // No tape front to back, and the depth loose: that tape first (2026-10-20: both blind runs of the owner's house picked it).
  const runsBack = (i: number) => {
    const A = ring[i] as Pt;
    const B = ring[(i + 1) % n] as Pt;
    return Math.abs(B.x - A.x) < Math.abs(B.y - A.y);
  };
  const back = sides.filter((s) => runsBack(s.from) && !shared.has(s.from));
  const longest = back.reduce<RouteSide | null>((a, s) => (!a || s.lengthFeet > a.lengthFeet ? s : a), null);
  if (longest && !sides.some((s) => s.taped && runsBack(s.from)) && (longest.plusMinusPct ?? 0) > 5) {
    out.push({ from: longest.from, why: `±${longest.plusMinusPct}%: no tape runs front to back. One along this wall, front corner to back corner, holds the house's depth - the most useful tape there is.` });
  }
  for (const s of sides) {
    if (s.taped || (s.plusMinusPct ?? 0) <= 5 || s === longest && out.length > 0) continue;
    const i = s.from;
    // A party wall: no photo sees along it; it is the home's depth.
    if (shared.has(i)) {
      out.push({ from: i, why: `±${s.plusMinusPct}%: it is shared with the neighbour, so no photo sees along it. Tape the depth once, front wall to back wall – along the fence or inside.` });
      continue;
    }
    const A = ring[i] as Pt;
    const B = ring[(i + 1) % n] as Pt;
    const nrm = outward(A, B);
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    // How squarely any placed camera saw it: the best angle off the wall, degrees.
    let squarest = 0;
    for (const c of cameras) {
      const v = { x: mid.x - c.at[0], y: mid.y - c.at[1] };
      const L = Math.hypot(v.x, v.y) || 1;
      const facing = -(v.x * nrm.x + v.y * nrm.y) / L;
      if (facing > 0) squarest = Math.max(squarest, (Math.asin(Math.min(1, facing)) * 180) / Math.PI);
    }
    const endsSeen = [i, (i + 1) % n].filter((k) => taps.some((t) => t.corner === k)).length;
    const edges = points.filter((p) => p.side === i).length;
    let why: string;
    if (squarest < 5 && edges === 0 && endsSeen === 0) why = "no photo shows it";
    else if (squarest < 25) why = "it was only seen from along it (a side yard, or a narrow gap): no photo faces it";
    else if (endsSeen < 2) why = `only ${endsSeen === 1 ? "one of its corners was" : "neither of its corners was"} tapped on a photo`;
    else if (edges === 0) why = "nothing on it (a window or door edge) was seen in two photos";
    else why = "the photos round it do not hold it to better than that";
    const said = s.estimated ? ` Estimated on site at about ${formatFeetInches(s.estimated.feet)}, which holds it only loosely.` : "";
    out.push({ from: i, why: `±${s.plusMinusPct}%: ${why}.${said} A tape along it fixes it.` });
  }
  // A measure and the size estimated on site that disagree: one of them is wrong, whatever the measure's ±.
  for (const s of sides) {
    if (s.taped || !s.estimateCheck?.disagrees) continue;
    const words = estimateDisagreement(s.lengthFeet, s.estimateCheck);
    const had = out.find((a) => a.from === s.from);
    if (had) had.why = `${had.why} It was ${words}`;
    else out.push({ from: s.from, why: `±${s.plusMinusPct}%: it was ${words}` });
  }
  return out;
}

/**
 * The corners Scrivn marks for the user to keep (2026-10-17): on each placed photo, every corner of the
 * shape as measured that its camera sees plainly - ahead, inside the picture, nothing of the house in the
 * way - and that was not tapped on it, where the camera says its foot is, moved onto the edge nearest. A
 * corner whose edge is not clear (behind a post, in a hedge) is marked where the camera puts it.
 *
 * Nothing found by eye here: each mark is the measure's own prediction, shown so the user can see the
 * numbering is right and keep what is - each kept mark is one more bearing in the next measure.
 */
export function proposeCorners(input: PhotoRouteInput, buildingId: string, data: RoutePhotoData[], sol: RouteSolution, opts: { snap?: "edge" | "none" } = {}): CornerTap[] {
  const b = input.buildings.find((x) => x.id === buildingId);
  if (!b) return [];
  const ring = sol.corners;
  const n = ring.length;
  const out: CornerTap[] = [];
  const shared = new Set(b.shared ?? []);
  const party = partyCorners(n, shared);
  for (const c of sol.cameras) {
    const d = data.find((q) => q.id === c.photo);
    const cam = d?.camera;
    // A detail photo is placed only roughly, to be read: its marks would be no better than its stand spot.
    if (!d || !cam || c.role === "detail") continue;
    const tapped = new Set(b.corners.filter((t) => t.photo === c.photo && !t.proposed && t.corner >= 0).map((t) => t.corner));
    const yaw = (c.yawTweakDeg * Math.PI) / 180;
    const { zl } = levelAxes(cam);
    const b0 = Math.atan2(zl[0], zl[2]);
    const Z = GDIR_PLAN[((c.quadrant % 4) + 4) % 4] as [number, number];
    const X: [number, number] = [Z[1], -Z[0]];
    const h = c.heightFeet ?? HAND_FEET;
    for (let k = 0; k < n; k++) {
      if (tapped.has(k)) continue;
      const P = ring[k] as Pt;
      const v0 = P.x - c.at[0];
      const v1 = P.y - c.at[1];
      const dist = Math.hypot(v0, v1);
      if (dist < 3) continue;
      const hit = castRay({ x: c.at[0], y: c.at[1] }, [v0 / dist, v1 / dist], ring);
      if (hit && hit.t < dist - 0.5) continue;
      if (neighbourBlocks({ x: c.at[0], y: c.at[1] }, P, ring, shared)) continue;
      // The plan direction in the photo's own frame: planDirection with this quadrant and turn, run backwards.
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const l0 = cy * v0 - sy * v1;
      const l1 = sy * v0 + cy * v1;
      const bearing = Math.atan2(l0 * X[0] + l1 * X[1], l0 * Z[0] + l1 * Z[1]);
      const off = bearing - b0;
      if (Math.cos(off) < 0.2) continue;
      const u = cam.width / 2 + cam.f * Math.tan(off);
      if (u < 0.03 * cam.width || u > 0.97 * cam.width) continue;
      const depth = dist * Math.cos(off);
      const v = Math.min(0.97 * cam.height, cam.height / 2 + (cam.f * h) / depth);
      const px = fromLevel(cam, u, v);
      if (!px || px[0] < 0 || px[1] < 0 || px[0] >= cam.width || px[1] >= cam.height) continue;
      const s = opts.snap === "none" ? { onEdge: false, x: px[0], y: px[1] } : snapToEdge(d.gray, cam, px[0], px[1]);
      out.push({ photo: c.photo, corner: k, x: s.onEdge ? s.x : px[0], y: s.onEdge ? s.y : px[1], by: "app", proposed: true, ...(party.has(k) ? { party: true as const } : {}) });
    }
  }
  return out;
}

const GDIR_PLAN: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** The first side a ray meets, for the sanity checks (lib/photoRouteSanity.ts). */
export { castRay as castRayToSides };

/** For the tests: the steps inside `solveRoute`. */
export const routeSteps = { wallObservations, tieEdges, castRay, placementsFromCorners, chooseByWalk, matchShift };
