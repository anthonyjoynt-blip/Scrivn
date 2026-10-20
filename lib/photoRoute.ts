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
import type { Gray } from "./photoRouteLines";
import { planDirection, resect, type SolveBearing, type SolveCamera, type SolveDistance, type SolvePoint, type SolveWall, solvePlan, type Solution } from "./photoRouteSolve";

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
}

/** What a photo was taken for, from the checklist: a corner (outline index) at 45 degrees, or a wall (outline side index) straight on. */
export type RouteShot = { kind: "corner"; index: number } | { kind: "wall"; index: number };

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
  placedBy: "corners" | "one-corner";
}

export interface RouteSolution {
  building: string;
  /** The corners as solved, plan feet, in the outline's order. */
  corners: Pt[];
  sides: RouteSide[];
  cameras: RouteCamera[];
  /** Photos that could not be placed, and why, in plain words. */
  unplaced: { photo: string; why: string }[];
  /** Bearings used: the corners tapped and the wall edges found. */
  counts: { cornerBearings: number; edgeBearings: number; edgePoints: number; tapes: number };
  /** RMS of the bearings in sd (sd 2 px). */
  rms: number;
  /** True when no tape gave it a size: lengths then follow the outline as drawn. */
  unscaled: boolean;
  /** Which sides want a tape and why: advice, never a block. */
  advice: { from: number; why: string }[];
  /** The wall edges tied across photos: which side, how far along it, and the photos that saw it. */
  edgePoints: { id: string; side: number; along: number; photos: string[] }[];
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
      return { photo: id, corner: t.corner, ...s, bearing: columnBearing(d.camera as PhotoCamera, s.u) };
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
    const fromShot = user.some((c) => c >= 0) || !shot ? null : shotNames(shot, job.snapped, cameraWidth(byId.get(job.id)), n);
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
    let userSet = fromShot ?? user;
    // The photos either side in time that are placed.
    const t0 = time.get(job.id) ?? 0;
    const near = [...chosen].map(([id, at]) => ({ at, dt: Math.abs((time.get(id) ?? 0) - t0) })).sort((p, q) => p.dt - q.dt).slice(0, 2);
    let best: { labels: number[]; score: number; at: [number, number] } | null = null;
    const gaps = (k: number): number[][] => (k === 0 ? [[]] : gaps(k - 1).flatMap((g) => [1, 2, 3].map((x) => [...g, x])));
    for (let attempt = 0; attempt < 2 && !best; attempt++) {
    if (attempt === 1) {
      if (userSet === user) break;
      userSet = user;
    }
    for (const g of gaps(m - 1)) {
      if (g.reduce((s, v) => s + v, 0) >= n) continue;
      for (let s0 = 0; s0 < n; s0++) {
        const labels = [s0];
        for (const step of g) labels.push(((labels[labels.length - 1] as number) + step) % n);
        if (labels.some((l, k) => (userSet[k] as number) >= 0 && userSet[k] !== l)) continue;
        // Where this home ends is a corner of a shared wall.
        if (labels.some((l, k) => (out[job.idx[k] as number] as CornerTap).party && !party.has(l))) continue;
        const taps = job.snapped.map((t, k) => ({ ...t, corner: labels[k] as number }));
        const cam = (byId.get(job.id) as RoutePhotoData).camera as PhotoCamera;
        for (const p of placementsFromCorners(taps, ring, shared, cam)) {
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
 * The corners a photo from the checklist names, left to right as its taps run: a corner shot the tap nearest its
 * middle; a wall shot its leftmost and rightmost taps (the wall's two corners, left to right as seen from outside).
 * -1 for a tap it does not name.
 */
function shotNames(shot: RouteShot, snapped: { u: number }[], width: number, n: number): number[] {
  const out = snapped.map(() => -1);
  if (snapped.length === 0) return out;
  if (shot.kind === "corner") {
    let k = 0;
    snapped.forEach((t, i) => {
      if (Math.abs(t.u - width / 2) < Math.abs((snapped[k] as { u: number }).u - width / 2)) k = i;
    });
    out[k] = ((shot.index % n) + n) % n;
    return out;
  }
  if (snapped.length < 2) return out;
  out[0] = ((shot.index % n) + n) % n;
  out[snapped.length - 1] = (shot.index + 1) % n;
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

interface SnappedTap {
  photo: string;
  corner: number;
  u: number;
  v: number;
  bearing: number;
  onEdge: boolean;
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
  /** For the tests: no wall edges tied on these sides, and these corner taps left out. */
  skipSides?: number[];
  skipTap?: (t: CornerTap) => boolean;
}

/**
 * The building's outline, sides and cameras from its photos, taps and tapes. Photos with no level
 * camera, or that could not be placed, are listed in `unplaced` and left out; nothing is guessed for
 * them.
 */
export function solveRoute(input: PhotoRouteInput, buildingId: string, data: RoutePhotoData[], opts: SolveRouteOptions = {}): RouteSolution {
  const b = input.buildings.find((x) => x.id === buildingId);
  if (!b) throw new Error(`No building ${buildingId}`);
  const n = b.outline.length;
  const byId = new Map(data.map((d) => [d.id, d]));
  const tapes = b.tapes.filter((t) => !(opts.withoutTapes ?? []).includes(t.id));
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
    taps.push({ photo: t.photo, corner: t.corner, ...s, bearing: columnBearing(d.camera, s.u) });
  }

  // 2. The walls from the shape drawn, and each camera placed from its corners on it.
  const { walls, corners } = outlineWalls(b.outline);
  const roughPerimeter = b.outline.reduce((s, p, i) => s + segLen(p, b.outline[(i + 1) % n] as Pt), 0);
  const cams = new Map<string, { quadrant: number; at: [number, number]; placedBy: RouteCamera["placedBy"] }>();
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
      const list = placementsFromCorners(mine, b.outline, new Set(b.shared ?? []), d.camera);
      if (list.length) candidates.set(id, list);
      else unplaced.push({ photo: id, why: "Its corners do not fit the shape drawn: check which corners they are." });
    }
  }
  for (const [id, c] of chooseByWalk(candidates, input.photos)) cams.set(id, { ...c, placedBy: "corners" });
  void photosWithTaps;

  // The lens's radial term, as the vanishing points gave it, fitted again in the plan solve.
  const k0 = data.find((d) => d.camera)?.camera?.k ?? 0;
  const lensPrior = { k0, sd: LENS_K_SD };
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
      cameras.push({ id, quadrant: c.quadrant, guess: c.at, yawSdDeg: YAW_SD_DEG });
      for (const t of taps.filter((x) => x.photo === id)) bearings.push({ camera: id, point: `c${t.corner}`, bearing: t.bearing, sd: CORNER_SD / (d.camera as PhotoCamera).f, bearingAt: atK(d.camera as PhotoCamera, t.px) });
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
        bearings.push({ camera: o.photo, point: p.id, bearing: o.bearing, sd: PX_SD / oc.f, bearingAt: atK(oc, o.px) });
      }
    }
    const distances: SolveDistance[] = [];
    for (const t of sideTapes) {
      const prev = walls[(t.from - 1 + n) % n] as SolveWall;
      const next = walls[(t.from + 1) % n] as SolveWall;
      distances.push({ id: t.id, a: `wall:${prev.id}`, b: `wall:${next.id}`, axis: prev.axis, feet: t.feet, sdFeet: TAPE_SD_FEET });
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
    for (const t of lineTapes) {
      const ends = tapeEnds.filter((e) => e.tape === t.id);
      if (ends.length !== 2) continue;
      const [ea, eb] = ends as [TapeEnd, TapeEnd];
      const axis = ea.side === eb.side ? (walls[ea.side] as SolveWall).axis === "E" ? "N" : "E" : "any";
      distances.push({ id: t.id, a: ea.point, b: eb.point, axis, feet: t.feet, sdFeet: TAPE_SD_FEET });
    }
    // Without a tape nothing sizes the house: its perimeter is held, loosely, to the one drawn.
    const hasScale = distances.length > 0;
    // Each camera's hand height, from the corner tapped lowest in it: the one most likely tapped at the ground (one shown over a deck is tapped higher).
    const heights: { camera: string; point: string; drop: number; forward: number; feet: number; sdFeet: number }[] = [];
    for (const [id] of placedCams) {
      const cam = (byId.get(id) as RoutePhotoData).camera as PhotoCamera;
      const mine = taps.filter((t) => t.photo === id && t.v > cam.height / 2 + 0.02 * cam.f).sort((a, b) => a.v - b.v);
      const t = mine[mine.length - 1];
      if (!t) continue;
      const { zl } = levelAxes(cam);
      heights.push({ camera: id, point: `c${t.corner}`, drop: (t.v - cam.height / 2) / cam.f, forward: Math.atan2(zl[0], zl[2]), feet: HAND_FEET, sdFeet: HAND_SD_FEET });
    }
    return { input: { walls: wallsNow, points, cameras, bearings, distances, lens: lensPrior, heights }, hasScale };
  };

  /**
   * Each side held, loosely, to its length as drawn (35%): what the photos say outweighs it a hundred to
   * one wherever they say anything, but where they say little - a wall no photo faced, or the house's
   * depth before the wall edges are tied - the solve stays near the shape the user knows, rather than
   * folding up. With no tape at all it is also the only size the house has (said: `unscaled`).
   */
  const scaleHold = (inp: ReturnType<typeof build>): ReturnType<typeof build>["input"] => {
    const drawn: SolveDistance[] = [];
    for (let i = 0; i < n; i++) {
      const prev = walls[(i - 1 + n) % n] as SolveWall;
      const next = walls[(i + 1) % n] as SolveWall;
      const feet = segLen(b.outline[i] as Pt, b.outline[(i + 1) % n] as Pt);
      drawn.push({ id: `drawn:${i}`, a: `wall:${prev.id}`, b: `wall:${next.id}`, axis: prev.axis, feet, sdFeet: Math.max(1, feet * 0.35) });
    }
    return { ...inp.input, distances: [...inp.input.distances, ...drawn] };
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
      if (depth > 1) hs.push(((t.v - d.camera.height / 2) / d.camera.f) * depth);
    }
    if (hs.length === 0) return null;
    hs.sort((p, q) => p - q);
    return hs[Math.floor(hs.length / 2)] as number;
  };
  // The shift two photos may disagree by along a wall, round by round, as the cameras settle.
  const SEARCH = [2, 1, 0.5, 0.3, 0.2];
  const TOL = [0.15, 0.12, 0.1, 0.08, 0.08];
  const rounds = opts.wallEdges === false ? 1 : SEARCH.length;
  for (let round = 0; round < rounds; round++) {
    const placedNow = new Map([...cams].filter(([id]) => sol.input.cameras.some((c) => c.id === id) || round === 0));
    const obs = opts.wallEdges === false ? [] : wallObservations(placedNow, byId, ring, sol, camHeight).filter((o) => !(b.shared ?? []).includes(o.side));
    edgePoints = opts.wallEdges === false ? [] : tieEdges(obs, SEARCH[round] as number, TOL[round] as number).filter((q) => !(opts.skipSides ?? []).includes(q.side));
    // Photos with one corner: placed along that corner's ray where their wall edges meet the others' (once there are some to meet).
    for (const id of input.photos.map((p) => p.id)) {
      if (cams.has(id) || opts.wallEdges === false || round === 0) continue;
      const d = byId.get(id);
      const mine = taps.filter((t) => t.photo === id);
      if (!d?.camera || mine.length !== 1) continue;
      const placed = placeByOneCorner(mine[0] as SnappedTap, d, ring, edgePoints, sol);
      if (placed) cams.set(id, { ...placed, placedBy: "one-corner" });
    }
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
    ring = solvedCorners(sol, n);
    update();
  }
  for (const id of new Set(b.corners.filter((c) => !c.proposed).map((c) => c.photo))) {
    if (!cams.has(id) && !unplaced.some((u) => u.photo === id)) {
      const k = taps.filter((t) => t.photo === id).length;
      unplaced.push({
        photo: id,
        why:
          k === 0
            ? "No corner of the house tapped on it."
            : "It shows one corner, and one corner can't say where you stood; too few of its window or door edges match the other photos to place it that way. A photo at 45° to that corner, both walls in, would.",
      });
    }
  }

  // 5. The sides, their ± and who saw them.
  const scaled = tapes.length > 0;
  const tapedSides = new Set(sideTapes.map((t) => t.from));
  const sideObs = new Map<number, Set<string>>();
  for (const p of edgePoints) for (const o of p.obs) (sideObs.get(p.side) ?? sideObs.set(p.side, new Set()).get(p.side))?.add(o.photo);
  const sides: RouteSide[] = [];
  for (let i = 0; i < n; i++) {
    const prev = walls[(i - 1 + n) % n] as SolveWall;
    const next = walls[(i + 1) % n] as SolveWall;
    const len = (x: Float64Array) => Math.abs(sol.wall(next.id, x) - sol.wall(prev.id, x));
    const L = len(sol.x);
    const sd = sol.sigma(len);
    const taped = tapedSides.has(i);
    // The proof's ± ran about twice the formal sd (its variants' spread); never under 2%.
    const pct = taped ? null : Math.max(2, Math.round(((2 * sd) / Math.max(L, 0.1)) * 100));
    sides.push({ from: i, lengthFeet: L, plusMinusPct: pct, sdFeet: sd, taped, photos: sideObs.get(i)?.size ?? 0 });
  }
  const cameras: RouteCamera[] = [...cams].filter(([id]) => sol.input.cameras.some((c) => c.id === id)).map(([id, c]) => ({
    photo: id,
    at: sol.camera(id).at,
    quadrant: c.quadrant,
    yawTweakDeg: (sol.camera(id).yaw * 180) / Math.PI,
    heightFeet: camHeight(id),
    placedBy: c.placedBy,
  }));
  const cornerBearings = sol.input.bearings.filter((x) => /^c\d+$/.test(x.point)).length;
  const edgeBearings = sol.input.bearings.filter((x) => x.point.startsWith("e")).length;
  return {
    building: b.id,
    corners: ring,
    sides,
    cameras,
    unplaced,
    counts: { cornerBearings, edgeBearings, edgePoints: edgePoints.length, tapes: tapes.length },
    rms: sol.rms,
    unscaled: !scaled,
    advice: tapeAdvice(sides, ring, cameras, taps, edgePoints, new Set(b.shared ?? [])),
    edgePoints: edgePoints.map((q) => ({ id: q.id, side: q.side, along: sol.input.points.some((x) => x.id === q.id) ? alongOf(sol, q.id, ring, q.side) : q.along, photos: q.obs.map((o) => o.photo) })),
    solution: sol,
  };
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
function placementsFromCorners(mine: SnappedTap[], outline: Pt[], shared: Set<number> = new Set(), cam?: PhotoCamera): Placement[] {
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
  return out.some(plausible) ? out.filter(plausible) : out;
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
      return ((t.v - cam.height / 2) / cam.f) * ((P.x - at[0]) * zg[0] + (P.y - at[1]) * zg[1]);
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

/**
 * A photo with one corner tapped: somewhere along that corner's ray (each quarter-turn tried), where
 * the most of its wall edges land on the points the other photos have already tied. Null when no
 * place lines up at least four.
 */
function placeByOneCorner(tap: SnappedTap, d: RoutePhotoData, ring: Pt[], points: { id: string; side: number; obs: EdgeObs[]; along: number }[], sol: Solution): { quadrant: number; at: [number, number] } | null {
  void sol;
  const cam = d.camera as PhotoCamera;
  const P = ring[tap.corner] as Pt;
  const n = ring.length;
  let best: { quadrant: number; at: [number, number]; score: number } | null = null;
  let second = 0;
  // How far below the level camera's horizon the corner's foot was tapped: at distance t along the ray
  // the camera then stood (v - cy) / f * depth over the ground there.
  const { zl } = levelAxes(cam);
  const drop = (tap.v - cam.height / 2) / cam.f;
  for (let q = 0; q < 4; q++) {
    const dir = planDirection(tap.bearing, q, 0);
    const zg = planDirection(Math.atan2(zl[0], zl[2]), q, 0);
    const ahead = dir[0] * zg[0] + dir[1] * zg[1];
    for (let t = 6; t <= 120; t += 0.25) {
      const C = { x: P.x - dir[0] * t, y: P.y - dir[1] * t };
      if (insideRing(C, ring)) continue;
      // A photo held in the hand is taken 3 to 7.5 ft over the ground at the corner it shows (a step or a slope
      // either way): a place along the ray that puts the camera higher or lower is not where it stood.
      const h = drop * t * ahead;
      if (drop > 0.005 && (h < HAND_HEIGHT_FEET[0] || h > HAND_HEIGHT_FEET[1])) continue;
      // The corner itself must be the first thing the ray meets (no wall in the way).
      const back = castRay(C, dir, ring);
      if (back && back.t < t - 0.5) continue;
      let score = 0;
      for (const e of d.edges) {
        const de = planDirection(columnBearing(cam, e.u), q, 0);
        const hit = castRay(C, de, ring);
        if (!hit) continue;
        const A = ring[hit.side] as Pt;
        const B = ring[(hit.side + 1) % n] as Pt;
        const nrm = outward(A, B);
        if ((C.x - A.x) * nrm.x + (C.y - A.y) * nrm.y <= 0) continue;
        if (points.some((p) => p.side === hit.side && Math.abs(p.along - hit.along) < 0.15 && p.obs[0]?.polarity === e.polarity)) score++;
      }
      // A camera held higher or lower than the hand usually holds one scores the worse for it.
      if (drop > 0.005) score -= 1.5 * Math.max(0, Math.abs(drop * t * ahead - HAND_FEET) - 0.75);
      if (!best || score > best.score) {
        if (best && Math.hypot(best.at[0] - C.x, best.at[1] - C.y) > 3) second = Math.max(second, best.score);
        best = { quadrant: q, at: [C.x, C.y], score };
      } else if (Math.hypot(best.at[0] - C.x, best.at[1] - C.y) > 3) second = Math.max(second, score);
    }
  }
  if (!best || best.score < 6 || best.score < second + 3) return null;
  return { quadrant: best.quadrant, at: best.at };
}

/**
 * Which sides want a tape, and why, in plain words: any whose ± is over 5%. Advice only: nothing waits
 * on it.
 */
function tapeAdvice(sides: RouteSide[], ring: Pt[], cameras: RouteCamera[], taps: SnappedTap[], points: { side: number; obs: EdgeObs[] }[], shared: Set<number> = new Set()): { from: number; why: string }[] {
  const n = ring.length;
  const out: { from: number; why: string }[] = [];
  for (const s of sides) {
    if (s.taped || (s.plusMinusPct ?? 0) <= 5) continue;
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
    out.push({ from: i, why: `±${s.plusMinusPct}%: ${why}. A tape along it fixes it.` });
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
export function proposeCorners(input: PhotoRouteInput, buildingId: string, data: RoutePhotoData[], sol: RouteSolution): CornerTap[] {
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
    if (!d || !cam) continue;
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
      const s = snapToEdge(d.gray, cam, px[0], px[1]);
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

/** For the tests: the steps inside `solveRoute`. */
export const routeSteps = { wallObservations, tieEdges, castRay, placementsFromCorners, chooseByWalk, matchShift };
