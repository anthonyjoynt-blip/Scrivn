/**
 * The lens and the level of each photo (2026-10-16, the photo route): from straight edges alone,
 * as the owner's proof did it (photo-route-proof/scripts: calib.py, manh.py, globcal.py).
 *
 * A house is square: its edges run three ways, up and the two ways round it. In each photo the
 * vertical edges meet at one vanishing point and the level edges of each wall at another, and the
 * three directions are at right angles. That fixes the camera's tilt and its turn against the house,
 * and, across many photos, the lens itself: one focal length and one radial distortion term for
 * all of them, since they were taken with the same 1x camera.
 *
 *   * per photo: the vertical vanishing point by RANSAC over the near-upright segments; then, with
 *     a first focal, the two level directions by a search round the horizon (they are 90 degrees
 *     apart, so it is a search in one angle); each segment put with the direction it points to;
 *   * all photos at once: the focal over the width (f/W), the radial term k, and each photo's
 *     rotation, fitted to every classified segment (soft-L1, as the proof).
 *
 * Distortion is p_u = c + d (1 + k |d|^2 / W^2), d = p - c: the proof's model (k = -0.022 there).
 *
 * The house frame of a photo ("local"): X and Z the two level directions, Y up; Z the one nearest
 * the way the camera faced, X = Z x Y so it is to the right. Which way round the house that is - Z
 * north, east, south or west on the plan - the plan solve decides (lib/photoRouteSolve.ts).
 */

import { leastSquares, type Mat3, matToRotvec, mulMtV, mulMV, norm3, rotvecToMat, type Vec3, cross3, dot3, unit3 } from "./photoRouteMath";
import type { Segment } from "./photoRouteLines";

/** A picture's long side, which the focal is taken over (f/W): its width held sideways, its height upright. */
export const longSide = (p: { width: number; height: number }) => Math.max(p.width, p.height);

/** The S25 Ultra's 1x camera, as the proof fitted it: the starting focal when a photo's file gives none. */
export const DEFAULT_FOCAL_OVER_WIDTH = 0.664;
/**
 * The radial term the photos are levelled with (2026-10-16). A phone corrects its own lens in software
 * and leaves a small term: the proof measured -0.022 for the owner's S25 Ultra. Fitted from the
 * vanishing points alone it came out -0.07 to -0.08 on his photos, which the bearings do not bear out
 * (the plan solve's residual is least near -0.02) and which carried the house's size 3-5% wrong
 * round it; so the photos are levelled with this, and the plan solve moves it if its bearings say so
 * (lib/photoRoute.ts, LENS_K_SD).
 */
export const DEFAULT_RADIAL_K = -0.02;
const DEG = Math.PI / 180;

export interface PhotoLines {
  width: number;
  height: number;
  segments: Segment[];
  /**
   * Where the house is in the photo, as boxes [x0, y0, x1, y1]: only segments whose middles are in one count.
   * Absent: the whole photo. The route sets it from the corners tapped, so a neighbour's house or a trailer
   * standing at another angle does not pull the turn.
   */
  regions?: [number, number, number, number][] | null;
  /** f/W to start from: from the file's 35 mm focal when it had one. */
  focalPrior?: number | null;
}

/** A photo's lens and turn: what makes a pixel a direction in the house's frame. */
export interface PhotoCamera {
  width: number;
  height: number;
  /** Focal length in pixels; the principal point is the image's middle. */
  f: number;
  /** Radial term, as above. */
  k: number;
  /**
   * Row by row; its columns are the house frame's X, Y (up) and Z in the camera's coordinates (x right,
   * y down, z forward), so a direction d of the house frame is R d in the camera's. Left-handed, as the
   * proof's: det -1.
   */
  R: Mat3;
}

export interface LevelResult {
  /** Per photo, in the order given; null for one with too few straight edges to level (a close-up, a tape). */
  cameras: (PhotoCamera | null)[];
  focalOverWidth: number;
  k: number;
  /** Per photo, how many of its segments went to X, Y and Z. */
  counts: ([number, number, number] | null)[];
  /** Why a photo could not be levelled, in plain words. */
  notes: (string | null)[];
}

// ── Geometry ─────────────────────────────────────────────────────────────────────────────────────

const FLIP_Y: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, 1];
/** R from a proper rotation: its second column flipped, so Y is up while the camera's y is down. */
const fromProper = (P: Mat3): Mat3 => [P[0], -P[1], P[2], P[3], -P[4], P[5], P[6], -P[7], P[8]];
const toProper = (R: Mat3): Mat3 => fromProper(R);
void FLIP_Y;

/** Distorted pixel to undistorted. */
export function undistort(cam: Pick<PhotoCamera, "width" | "height" | "k">, x: number, y: number): [number, number] {
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const s = 1 + (cam.k * (dx * dx + dy * dy)) / (cam.width * cam.width);
  return [cx + dx * s, cy + dy * s];
}

/** Undistorted pixel to distorted (the inverse, by a few fixed-point steps; |k| is small). */
export function distort(cam: Pick<PhotoCamera, "width" | "height" | "k">, xu: number, yu: number): [number, number] {
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  const ux = xu - cx;
  const uy = yu - cy;
  let dx = ux;
  let dy = uy;
  for (let i = 0; i < 6; i++) {
    const s = 1 + (cam.k * (dx * dx + dy * dy)) / (cam.width * cam.width);
    dx = ux / s;
    dy = uy / s;
  }
  return [cx + dx, cy + dy];
}

/** A pixel of the photo as a direction in the house frame (not of unit length). */
export function pixelToHouse(cam: PhotoCamera, x: number, y: number): Vec3 {
  const [xu, yu] = undistort(cam, x, y);
  const d: Vec3 = [(xu - cam.width / 2) / cam.f, (yu - cam.height / 2) / cam.f, 1];
  return mulMtV(cam.R, d);
}

/** A direction of the house frame as a pixel of the photo; null when it is behind the camera. */
export function houseToPixel(cam: PhotoCamera, d: Vec3): [number, number] | null {
  const c = mulMV(cam.R, d);
  if (!(c[2] > 1e-9)) return null;
  return distort(cam, cam.width / 2 + (cam.f * c[0]) / c[2], cam.height / 2 + (cam.f * c[1]) / c[2]);
}

/**
 * The plan bearing of a vertical edge through pixel (x, y): its direction (X, Z) in the house frame's
 * plan, as an angle from Z towards X (radians). Every pixel of the same upright edge gives the same.
 */
export function planBearing(cam: PhotoCamera, x: number, y: number): number {
  const d = pixelToHouse(cam, x, y);
  return Math.atan2(d[0], d[2]);
}

/**
 * The level camera: the same centre and focal, its tilt and roll taken out, its turn kept. Its axes in
 * the house frame (rows), so a level pixel (u, v) is the direction (u - cx)/f xl + (v - cy)/f yl + zl.
 */
export function levelAxes(cam: PhotoCamera): { xl: Vec3; yl: Vec3; zl: Vec3 } {
  const fwd = mulMtV(cam.R, [0, 0, 1]);
  const hz = unit3([fwd[0], 0, fwd[2]]);
  return { xl: [hz[2], 0, -hz[0]], yl: [0, -1, 0], zl: hz };
}

/** A photo pixel in the level camera's image (same size and focal). */
export function toLevel(cam: PhotoCamera, x: number, y: number): [number, number] {
  const d = pixelToHouse(cam, x, y);
  const { xl, yl, zl } = levelAxes(cam);
  const z = dot3(d, zl);
  return [cam.width / 2 + (cam.f * dot3(d, xl)) / z, cam.height / 2 + (cam.f * dot3(d, yl)) / z];
}

/** A level-image pixel back in the photo. */
export function fromLevel(cam: PhotoCamera, u: number, v: number): [number, number] | null {
  const { xl, yl, zl } = levelAxes(cam);
  const a = (u - cam.width / 2) / cam.f;
  const b = (v - cam.height / 2) / cam.f;
  return houseToPixel(cam, [a * xl[0] + b * yl[0] + zl[0], a * xl[1] + b * yl[1] + zl[1], a * xl[2] + b * yl[2] + zl[2]]);
}

// ── Segments against vanishing points ───────────────────────────────────────────────────────────

/**
 * How far a segment's ends are off the line from its middle to the vanishing point v, in pixels:
 * sin(angle) * length / 2. The proof weighted the angle by sqrt(length); an end's error is about the
 * same in pixels whatever the length, so this lets one long eave outweigh a roof's worth of shingle
 * edges, which pulled the turn 3 degrees on the owner's #2.
 */
function segRes(x1: number, y1: number, x2: number, y2: number, v: Vec3): number {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  let dx = x2 - x1;
  let dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  dx /= L;
  dy /= L;
  let tx = v[0] - v[2] * mx;
  let ty = v[1] - v[2] * my;
  const tn = Math.hypot(tx, ty) + 1e-300;
  tx /= tn;
  ty /= tn;
  return ((dx * ty - dy * tx) * L) / 2;
}

function vpsOf(R: Mat3, f: number, cx: number, cy: number): [Vec3, Vec3, Vec3] {
  const vp = (j: number): Vec3 => {
    const c: Vec3 = [R[j] as number, R[3 + j] as number, R[6 + j] as number];
    return [f * c[0] + cx * c[2], f * c[1] + cy * c[2], c[2]];
  };
  return [vp(0), vp(1), vp(2)];
}

interface Seg4 {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  L: number;
}

function undistortSegs(segs: Segment[], w: number, h: number, k: number): Seg4[] {
  const cam = { width: w, height: h, k };
  return segs.map((s) => {
    const [a, b] = undistort(cam, s.x1, s.y1);
    const [c, d] = undistort(cam, s.x2, s.y2);
    return { x1: a, y1: b, x2: c, y2: d, L: Math.hypot(c - a, d - b) };
  });
}

/** Each segment's direction: 0 X, 1 Y, 2 Z, or -1 none with its ends within thrPx (and within 5 degrees). */
function classify(segs: Seg4[], V: [Vec3, Vec3, Vec3], thrPx: number): Int8Array {
  const out = new Int8Array(segs.length).fill(-1);
  const maxSin = Math.sin(5 * DEG);
  segs.forEach((s, i) => {
    let best = -1;
    let bestA = Infinity;
    for (let j = 0; j < 3; j++) {
      const a = Math.abs(segRes(s.x1, s.y1, s.x2, s.y2, V[j] as Vec3));
      if (a < bestA) {
        bestA = a;
        best = j;
      }
    }
    if (bestA < thrPx && bestA / (s.L / 2) < maxSin) out[i] = best;
  });
  return out;
}

// ── One photo's first rotation ───────────────────────────────────────────────────────────────────

/** A deterministic random (the same answer every run, so a solve can be told again). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** The vertical vanishing point (homogeneous, image pixels) by RANSAC over near-upright segments; null when too few. */
function verticalVp(segs: Seg4[]): Vec3 | null {
  const up = segs.filter((s) => Math.abs(s.x2 - s.x1) < Math.tan(20 * DEG) * Math.abs(s.y2 - s.y1));
  if (up.length < 8) return null;
  const line = (s: Seg4): Vec3 => cross3([s.x1, s.y1, 1], [s.x2, s.y2, 1]);
  const lines = up.map(line);
  const rand = rng(12345);
  const thr = 2;
  let best: Vec3 | null = null;
  let bestScore = -1;
  for (let it = 0; it < 600; it++) {
    const i = Math.floor(rand() * up.length);
    const j = Math.floor(rand() * up.length);
    if (i === j) continue;
    const v = cross3(lines[i] as Vec3, lines[j] as Vec3);
    if (norm3(v) < 1e-12) continue;
    let score = 0;
    for (const s of up) if (Math.abs(segRes(s.x1, s.y1, s.x2, s.y2, v)) < thr) score += s.L;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  if (!best) return null;
  // Refined: the point nearest every inlier's line, weighted by length (smallest eigenvector of Σ L l lᵀ, lines normalised).
  const inl = up.filter((s) => Math.abs(segRes(s.x1, s.y1, s.x2, s.y2, best as Vec3)) < thr);
  const M = new Float64Array(9);
  for (const s of inl) {
    const l = line(s);
    const n = Math.hypot(l[0], l[1]);
    const ln: Vec3 = [l[0] / n, l[1] / n, l[2] / n];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a * 3 + b] = (M[a * 3 + b] as number) + s.L * (ln[a] as number) * (ln[b] as number);
  }
  // Inverse iteration for the smallest eigenvector of a 3x3, from the RANSAC answer.
  let v: Vec3 = unit3(best);
  for (let k = 0; k < 30; k++) {
    const A = Array.from(M);
    for (let d = 0; d < 3; d++) A[d * 4] = (A[d * 4] as number) + 1e-9;
    const det = A[0]! * (A[4]! * A[8]! - A[5]! * A[7]!) - A[1]! * (A[3]! * A[8]! - A[5]! * A[6]!) + A[2]! * (A[3]! * A[7]! - A[4]! * A[6]!);
    if (Math.abs(det) < 1e-300) break;
    const inv = [
      (A[4]! * A[8]! - A[5]! * A[7]!) / det,
      (A[2]! * A[7]! - A[1]! * A[8]!) / det,
      (A[1]! * A[5]! - A[2]! * A[4]!) / det,
      (A[5]! * A[6]! - A[3]! * A[8]!) / det,
      (A[0]! * A[8]! - A[2]! * A[6]!) / det,
      (A[2]! * A[3]! - A[0]! * A[5]!) / det,
      (A[3]! * A[7]! - A[4]! * A[6]!) / det,
      (A[1]! * A[6]! - A[0]! * A[7]!) / det,
      (A[0]! * A[4]! - A[1]! * A[3]!) / det,
    ] as Mat3;
    v = unit3(mulMV(inv, v));
  }
  return v;
}

/** The first rotation of one photo at focal f: up from the vertical VP, then the two level directions round the horizon. */
function firstRotation(segs: Seg4[], w: number, h: number, f: number): Mat3 | null {
  const cx = w / 2;
  const cy = h / 2;
  const vv = verticalVp(segs);
  if (!vv) return null;
  // Up in camera coordinates (y down): K⁻¹ v, turned to point up.
  let up = unit3([(vv[0] - cx * vv[2]) / f, (vv[1] - cy * vv[2]) / f, vv[2]]);
  if (up[1] > 0) up = [-up[0], -up[1], -up[2]];
  // A level frame: a the camera's forward laid level, b at right angles.
  const z: Vec3 = [0, 0, 1];
  const a = unit3([z[0] - up[0] * dot3(z, up), z[1] - up[1] * dot3(z, up), z[2] - up[2] * dot3(z, up)]);
  const b = cross3(up, a);
  // Each candidate turn t (a quarter turn in 0.1 degree steps) scored by the segments that point, in
  // the image, within a degree of its two vanishing points: a world-angle histogram let a segment seen
  // nearly end-on outvote many that pin the turn down, and was 10 degrees out on the owner's #17.
  const flat = segs.filter((s) => Math.abs(s.x2 - s.x1) >= Math.tan(20 * DEG) * Math.abs(s.y2 - s.y1));
  const vpAt = (t: number): Vec3 => {
    const d: Vec3 = [Math.cos(t) * a[0] + Math.sin(t) * b[0], Math.cos(t) * a[1] + Math.sin(t) * b[1], Math.cos(t) * a[2] + Math.sin(t) * b[2]];
    return [f * d[0] + cx * d[2], f * d[1] + cy * d[2], d[2]];
  };
  const score = (t: number, thr: number) => {
    const v1 = vpAt(t);
    const v2 = vpAt(t + Math.PI / 2);
    let sc = 0;
    for (const s of flat) {
      const r = Math.min(Math.abs(segRes(s.x1, s.y1, s.x2, s.y2, v1)), Math.abs(segRes(s.x1, s.y1, s.x2, s.y2, v2)));
      if (r < thr) sc += s.L * (1 - (r / thr) ** 2);
    }
    return sc;
  };
  let bestT = 0;
  let bestV = -1;
  for (let i = 0; i < 900; i++) {
    const t = ((i + 0.5) / 900) * (Math.PI / 2);
    const v = score(t, 4);
    if (v > bestV) {
      bestV = v;
      bestT = t;
    }
  }
  for (let i = -10; i <= 10; i++) {
    const t = bestT + (i / 10) * 0.1 * DEG;
    const v = score(t, 2);
    if (i === -10 || v > bestV) {
      bestV = v;
      bestT = t;
    }
  }
  // The two level directions; Z the one nearest forward (within 45 degrees of a).
  let t0 = ((bestT % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  if (t0 > Math.PI / 4) t0 -= Math.PI / 2;
  const Z = unit3([Math.cos(t0) * a[0] + Math.sin(t0) * b[0], Math.cos(t0) * a[1] + Math.sin(t0) * b[1], Math.cos(t0) * a[2] + Math.sin(t0) * b[2]]);
  const X = cross3(Z, up);
  return [X[0], up[0], Z[0], X[1], up[1], Z[1], X[2], up[2], Z[2]];
}

/** R with the house frame turned by d radians about its up axis. */
function turned(R: Mat3, d: number): Mat3 {
  const c = Math.cos(d);
  const s = Math.sin(d);
  const X: Vec3 = [R[0], R[3], R[6]];
  const Z: Vec3 = [R[2], R[5], R[8]];
  const nX: Vec3 = [c * X[0] - s * Z[0], c * X[1] - s * Z[1], c * X[2] - s * Z[2]];
  const nZ: Vec3 = [s * X[0] + c * Z[0], s * X[1] + c * Z[1], s * X[2] + c * Z[2]];
  return [nX[0], R[1], nZ[0], nX[1], R[4], nZ[1], nX[2], R[7], nZ[2]];
}

/**
 * How badly a rotation fits ALL the segments: each its soft-L1 cost to the nearest vanishing point,
 * capped at what a segment 2 px off costs, so one that fits nothing costs the same whatever the turn.
 * What the multi-start below keeps the least of.
 */
function truncatedCost(segs: Seg4[], R: Mat3, f: number, w: number, h: number): number {
  const V = vpsOf(R, f, w / 2, h / 2);
  const cap = 2 * (Math.sqrt(1 + 4) - 1);
  let c = 0;
  for (const s of segs) {
    let best = Infinity;
    for (const v of V) best = Math.min(best, Math.abs(segRes(s.x1, s.y1, s.x2, s.y2, v)));
    c += Math.min(cap, 2 * (Math.sqrt(1 + best * best) - 1));
  }
  return c;
}

/**
 * The photo's rotation, refined from R0 and from R0 turned by up to 4 degrees each way: the first
 * guess off the horizon is often a degree or two out, and refining from there alone stopped in the
 * wrong place on 6 of the owner's 15 photos (2026-10-16). The start whose refined rotation fits the
 * segments best is kept.
 */
function bestTurn(segs: Seg4[], w: number, h: number, f: number, R0: Mat3): Mat3 {
  let best = R0;
  let bestCost = Infinity;
  for (const dDeg of [0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2, -3, 3, -4, 4]) {
    let R = turned(R0, dDeg * DEG);
    for (const thr of [4, 3, 2, 2]) R = refineRotation(segs, classify(segs, vpsOf(R, f, w / 2, h / 2), thr), w, h, f, R);
    const c = truncatedCost(segs, R, f, w, h);
    if (c < bestCost) {
      bestCost = c;
      best = R;
    }
  }
  return best;
}

/** The rotation re-fitted to its classified segments at a fixed focal (soft-L1), from R0. */
function refineRotation(segs: Seg4[], cls: Int8Array, w: number, h: number, f: number, R0: Mat3): Mat3 {
  const r0 = matToRotvec(toProper(R0));
  const L = segs.filter((_, i) => (cls[i] as number) >= 0).map((s) => s.L);
  if (L.length < 6) return R0;
  const scale = 1;
  const res = (x: Float64Array) => {
    const R = fromProper(rotvecToMat([x[0] as number, x[1] as number, x[2] as number]));
    const V = vpsOf(R, f, w / 2, h / 2);
    const out: number[] = [];
    segs.forEach((s, i) => {
      const c = cls[i] as number;
      if (c >= 0) out.push(segRes(s.x1, s.y1, s.x2, s.y2, V[c] as Vec3));
    });
    return Float64Array.from(out);
  };
  const r = leastSquares(res, Float64Array.from(r0), { fScale: scale, maxIterations: 30 });
  return fromProper(rotvecToMat([r.x[0] as number, r.x[1] as number, r.x[2] as number]));
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : 0;
}

// ── All photos ───────────────────────────────────────────────────────────────────────────────────

/** Fewest segments a photo needs in each of its three directions to be levelled and to take part in the lens. */
const MIN_PER_DIRECTION = 6;

/**
 * Every photo's lens and turn, from its segments: first each on its own at the starting focal, then the
 * focal (as f/W), the radial term and every rotation together.
 *
 * W is the picture's long side (2026-10-21): a photo turned upright, as the walk round the house allows on a side
 * too tight to step back from, has the same focal in pixels as one held sideways, not one a quarter shorter. For a
 * photo held sideways - every photo before that - the long side is its width, and nothing changes.
 */
export function levelPhotos(photos: PhotoLines[], opts: { fitLens?: boolean; focalOverWidth?: number; k?: number } = {}): LevelResult {
  const priors = photos.map((p) => p.focalPrior).filter((v): v is number => typeof v === "number" && v > 0.3 && v < 1.5);
  let fw = opts.focalOverWidth ?? (priors.length ? median(priors) : DEFAULT_FOCAL_OVER_WIDTH);
  let k = opts.k ?? 0;
  const inRegions = (p: PhotoLines, s: Segment) => {
    if (!p.regions || p.regions.length === 0) return true;
    const mx = (s.x1 + s.x2) / 2;
    const my = (s.y1 + s.y2) / 2;
    return p.regions.some(([x0, y0, x1, y1]) => mx > x0 && mx < x1 && my > y0 && my < y1);
  };
  const raw = photos.map((p) => p.segments.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= Math.max(25, 0.015 * p.width) && inRegions(p, s)));
  const notes: (string | null)[] = photos.map(() => null);
  // Each photo on its own.
  const Rs: (Mat3 | null)[] = photos.map((p, i) => {
    const segs = undistortSegs(raw[i] as Segment[], p.width, p.height, k);
    const f = fw * longSide(p);
    let R = firstRotation(segs, p.width, p.height, f);
    if (!R) {
      notes[i] = "Too few upright edges in it to level it.";
      return null;
    }
    R = bestTurn(segs, p.width, p.height, f, R);
    const cls = classify(segs, vpsOf(R, f, p.width / 2, p.height / 2), 2);
    const n = [0, 0, 0];
    for (const c of cls) if (c >= 0) n[c] = (n[c] as number) + 1;
    if ((n[1] as number) < MIN_PER_DIRECTION || (n[0] as number) + (n[2] as number) < 2 * MIN_PER_DIRECTION) {
      notes[i] = "Too few straight edges running round the house in it to level it.";
      return null;
    }
    return R;
  });
  const using = photos.map((_, i) => i).filter((i) => Rs[i] !== null);
  if (opts.fitLens !== false && using.length >= 2) {
    // The lens and every rotation together; the classes re-made from the fit each round.
    for (let round = 0; round < 3; round++) {
      const sets = using.map((i) => {
        const p = photos[i] as PhotoLines;
        const segs = undistortSegs(raw[i] as Segment[], p.width, p.height, k);
        const cls = classify(segs, vpsOf(Rs[i] as Mat3, fw * longSide(p), p.width / 2, p.height / 2), round === 0 ? 3 : 2);
        // Classified as distorted segments, fitted as undistorted ones each step.
        return { i, p, cls, rawSegs: (raw[i] as Segment[]).filter((_, j) => (cls[j] as number) >= 0), cl: Array.from(cls).filter((c) => c >= 0) };
      });
      const allL = sets.flatMap((s) => s.rawSegs.map((g) => Math.hypot(g.x2 - g.x1, g.y2 - g.y1)));
      const angleMode = (typeof process !== "undefined" && process.env?.JOINTW) === "angle";
      const scale = angleMode ? Math.sin(0.3 * DEG) * Math.sqrt(median(allL)) : 1;
      const x0 = [Math.log(fw), k, ...sets.flatMap((s) => matToRotvec(toProper(Rs[s.i] as Mat3)))];
      const res = (x: Float64Array) => {
        const f0 = opts.focalOverWidth ?? Math.exp(x[0] as number);
        const kk = opts.k ?? (x[1] as number);
        const out: number[] = [];
        sets.forEach((s, j) => {
          const R = fromProper(rotvecToMat([x[2 + 3 * j] as number, x[3 + 3 * j] as number, x[4 + 3 * j] as number]));
          const V = vpsOf(R, f0 * longSide(s.p), s.p.width / 2, s.p.height / 2);
          const cam = { width: s.p.width, height: s.p.height, k: kk };
          s.rawSegs.forEach((g, q) => {
            const [a, b] = undistort(cam, g.x1, g.y1);
            const [c, d] = undistort(cam, g.x2, g.y2);
            const r = segRes(a, b, c, d, V[s.cl[q] as number] as Vec3);
            out.push(angleMode ? (2 * r) / Math.sqrt(Math.hypot(c - a, d - b)) : r);
          });
        });
        return Float64Array.from(out);
      };
      const r = leastSquares(res, Float64Array.from(x0), {
        fScale: scale,
        maxIterations: 40,
        step: (v, i) => (i < 2 ? 1e-6 : 1e-7 * Math.max(1, Math.abs(v))),
      });
      fw = opts.focalOverWidth ?? Math.exp(r.x[0] as number);
      k = opts.k ?? (r.x[1] as number);
      sets.forEach((s, j) => {
        Rs[s.i] = fromProper(rotvecToMat([r.x[2 + 3 * j] as number, r.x[3 + 3 * j] as number, r.x[4 + 3 * j] as number]));
      });
    }
  }
  const cameras = photos.map((p, i) => (Rs[i] ? ({ width: p.width, height: p.height, f: fw * longSide(p), k, R: canonical(Rs[i] as Mat3) } as PhotoCamera) : null));
  const counts = photos.map((p, i) => {
    const cam = cameras[i];
    if (!cam) return null;
    const segs = undistortSegs(raw[i] as Segment[], p.width, p.height, k);
    const cls = classify(segs, vpsOf(cam.R, cam.f, p.width / 2, p.height / 2), 2);
    const n: [number, number, number] = [0, 0, 0];
    for (const c of cls) if (c >= 0) n[c] = (n[c] as number) + 1;
    return n;
  });
  return { cameras, focalOverWidth: fw, k, counts, notes };
}

/** Keeps the frame's rule after a fit: Y up, Z the level direction nearest forward, X = Z x Y. */
function canonical(R: Mat3): Mat3 {
  let Y: Vec3 = [R[1], R[4], R[7]];
  if (Y[1] > 0) Y = [-Y[0], -Y[1], -Y[2]];
  const X0: Vec3 = [R[0], R[3], R[6]];
  const Z0: Vec3 = [R[2], R[5], R[8]];
  // Of ±X, ±Z, the one most forward is Z.
  const cands: Vec3[] = [X0, Z0, [-X0[0], -X0[1], -X0[2]], [-Z0[0], -Z0[1], -Z0[2]]];
  let Z = cands[0] as Vec3;
  for (const c of cands) if (c[2] > Z[2]) Z = c;
  const X = cross3(Z, Y);
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}

/** For the tests: the steps inside `levelPhotos`. */
export const levelSteps = { verticalVp, firstRotation, refineRotation, classify, undistortSegs, vpsOf, bestTurn, truncatedCost };
