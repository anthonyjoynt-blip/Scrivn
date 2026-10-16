/**
 * The house's plan from bearings (2026-10-16, the photo route): the owner's proof's plan bundle
 * adjustment (photo-route-proof/scripts/ba.py) in TypeScript.
 *
 * A levelled photo turns every upright edge into a bearing on the plan (lib/photoRouteLens.ts). The
 * house is square, so each wall is one number - its east or its north - and a corner is where two
 * meet. The solve finds, together:
 *
 *   * each camera's place on the plan (east, north) and a small turn on top of its vanishing points
 *     (held to them by a prior, 0.3 degrees in the proof);
 *   * each wall's line, and the free coordinate of anything on one wall only (a window's edge, a
 *     tape's end) or on none (a porch post);
 *
 * so that every bearing points from its camera to its point. Bearings carry no size: the tapes do,
 * each a distance between two points along a wall's line, with its own sd. Robust (soft-L1 at 3 sd)
 * so one wrong tap costs a little, not the house.
 *
 * Plan feet, x east, y north. A photo's own frame (X, Z) is turned onto the plan by a quarter-turn
 * `quadrant`: its Z axis faces north, east, south or west for 0..3, its X axis a quarter turn
 * clockwise from that (lib/photoRouteLens.ts: X = Z x Y, to the right).
 */

import { leastSquares, sigmaOf, symPinv } from "./photoRouteMath";

export type WallAxis = "E" | "N";

export interface SolveWall {
  id: string;
  /** "E": the wall runs north-south and this is its east; "N": it runs east-west and this is its north. */
  axis: WallAxis;
  guess: number;
  /** Held where it is: two walls, one of each axis, set the plan's origin. */
  fixed?: boolean;
}

export interface SolvePoint {
  id: string;
  /** The wall that sets its east, or null when its east is free. */
  e: string | null;
  /** The wall that sets its north, or null. */
  n: string | null;
  guess: [number, number];
}

export interface SolveCamera {
  id: string;
  quadrant: number;
  guess: [number, number];
  /** How far its turn may stray from its vanishing points: the prior's sd, degrees. */
  yawSdDeg: number;
}

export interface SolveBearing {
  camera: string;
  point: string;
  /** In the photo's own plan frame: atan2(X, Z), radians. */
  bearing: number;
  /** One sd, radians (a pixel sd over the focal). */
  sd: number;
  /**
   * The bearing again for another radial term k, when the solve fits the lens (`SolveInput.lens`): the
   * same pixel undistorted with that k. Absent: the bearing is as given whatever k is.
   */
  bearingAt?: (k: number) => number;
}

export interface SolveDistance {
  id: string;
  /** Two points' ids; or "wall:<id>" for a wall's own line (its east or north, as the distance's axis). */
  a: string;
  b: string;
  /** Measured along the plan's east ("E") or north ("N"), or straight between them ("any"). */
  axis: WallAxis | "any";
  feet: number;
  sdFeet: number;
}

export interface SolveInput {
  walls: SolveWall[];
  points: SolvePoint[];
  cameras: SolveCamera[];
  bearings: SolveBearing[];
  distances: SolveDistance[];
  /** soft-L1's scale, in sd. */
  robustSd?: number;
  /**
   * Fit the lens's radial term with everything else (self-calibration), held to k0 by a prior of sd: the
   * vanishing points give k first, and the bearings - many points seen from many photos, at the middle
   * and the edges of the frame - say it better (2026-10-16: on the owner's photos the vanishing points
   * gave -0.07, the bearings -0.02, as the proof's own fit).
   */
  lens?: { k0: number; sd: number };
}

export interface Solution {
  input: SolveInput;
  x: Float64Array;
  wall: (id: string, x?: Float64Array) => number;
  point: (id: string, x?: Float64Array) => [number, number];
  camera: (id: string, x?: Float64Array) => { at: [number, number]; yaw: number };
  /** The lens's radial term as solved (k0 when it was not fitted). */
  k: number;
  /** Each bearing's residual in sd, in the input's order. */
  residuals: number[];
  rms: number;
  /** The covariance of the unknowns (n x n, row-major). */
  covariance: Float64Array;
  sigma: (f: (x: Float64Array) => number) => number;
  cost: number;
}

const GDIR: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** A bearing in a photo's own frame as a plan direction (unit), for its quadrant and turn (clockwise positive). */
export function planDirection(bearing: number, quadrant: number, yaw: number): [number, number] {
  const q = (((quadrant % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const Z = GDIR[q] as [number, number];
  const X: [number, number] = [Z[1], -Z[0]];
  const lx = Math.sin(bearing);
  const lz = Math.cos(bearing);
  const d0 = lx * X[0] + lz * Z[0];
  const d1 = lx * X[1] + lz * Z[1];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * d0 + s * d1, -s * d0 + c * d1];
}

export function solvePlan(input: SolveInput, opts: { maxIterations?: number } = {}): Solution {
  const index = new Map<string, number>();
  let k = 0;
  const wallById = new Map(input.walls.map((w) => [w.id, w]));
  for (const w of input.walls) if (!w.fixed) index.set(`w:${w.id}`, k++);
  const pointById = new Map(input.points.map((p) => [p.id, p]));
  for (const p of input.points) {
    if (p.e === null) index.set(`p:${p.id}:e`, k++);
    if (p.n === null) index.set(`p:${p.id}:n`, k++);
  }
  for (const c of input.cameras) {
    index.set(`c:${c.id}:e`, k++);
    index.set(`c:${c.id}:n`, k++);
    index.set(`c:${c.id}:y`, k++);
  }
  if (input.lens) index.set("lens:k", k++);
  const n = k;
  const camById = new Map(input.cameras.map((c) => [c.id, c]));
  const wall = (id: string, x: Float64Array): number => {
    const w = wallById.get(id);
    if (!w) throw new Error(`No wall ${id}`);
    return w.fixed ? w.guess : (x[index.get(`w:${id}`) as number] as number);
  };
  const point = (id: string, x: Float64Array): [number, number] => {
    const p = pointById.get(id);
    if (!p) throw new Error(`No point ${id}`);
    return [p.e !== null ? wall(p.e, x) : (x[index.get(`p:${id}:e`) as number] as number), p.n !== null ? wall(p.n, x) : (x[index.get(`p:${id}:n`) as number] as number)];
  };
  const camera = (id: string, x: Float64Array) => ({
    at: [x[index.get(`c:${id}:e`) as number] as number, x[index.get(`c:${id}:n`) as number] as number] as [number, number],
    yaw: x[index.get(`c:${id}:y`) as number] as number,
  });
  const x0 = new Float64Array(n);
  for (const w of input.walls) if (!w.fixed) x0[index.get(`w:${w.id}`) as number] = w.guess;
  for (const p of input.points) {
    if (p.e === null) x0[index.get(`p:${p.id}:e`) as number] = p.guess[0];
    if (p.n === null) x0[index.get(`p:${p.id}:n`) as number] = p.guess[1];
  }
  for (const c of input.cameras) {
    x0[index.get(`c:${c.id}:e`) as number] = c.guess[0];
    x0[index.get(`c:${c.id}:n`) as number] = c.guess[1];
  }
  if (input.lens) x0[index.get("lens:k") as number] = input.lens.k0;
  const lensK = (x: Float64Array) => (input.lens ? (x[index.get("lens:k") as number] as number) : 0);
  const bearings = input.bearings.filter((b) => camById.has(b.camera) && pointById.has(b.point));
  const residual = (x: Float64Array): Float64Array => {
    void 0;
    const out = new Float64Array(bearings.length + input.cameras.length + input.distances.length + (input.lens ? 1 : 0));
    let i = 0;
    for (const b of bearings) {
      const cam = camById.get(b.camera) as SolveCamera;
      const { at, yaw } = camera(b.camera, x);
      const P = point(b.point, x);
      const v0 = P[0] - at[0];
      const v1 = P[1] - at[1];
      const d = planDirection(input.lens && b.bearingAt ? b.bearingAt(lensK(x)) : b.bearing, cam.quadrant, yaw);
      out[i++] = Math.atan2(d[0] * v1 - d[1] * v0, d[0] * v0 + d[1] * v1) / b.sd;
    }
    for (const c of input.cameras) out[i++] = camera(c.id, x).yaw / ((c.yawSdDeg * Math.PI) / 180);
    const end = (id: string, axis: WallAxis | "any", x: Float64Array): [number, number] => {
      if (!id.startsWith("wall:")) return point(id, x);
      const v = wall(id.slice(5), x);
      return axis === "N" ? [0, v] : [v, 0];
    };
    if (input.lens) out[out.length - 1] = (lensK(x) - input.lens.k0) / input.lens.sd;
    for (const dd of input.distances) {
      const A = end(dd.a, dd.axis, x);
      const B = end(dd.b, dd.axis, x);
      const got = dd.axis === "E" ? Math.abs(B[0] - A[0]) : dd.axis === "N" ? Math.abs(B[1] - A[1]) : Math.hypot(B[0] - A[0], B[1] - A[1]);
      out[i++] = (got - dd.feet) / dd.sdFeet;
    }
    return out;
  };
  const r = leastSquares(residual, x0, { fScale: input.robustSd ?? 3, maxIterations: opts.maxIterations ?? 200, step: (v) => 1e-6 * Math.max(1, Math.abs(v)) });
  const cov = symPinv(r.hessian, n);
  const res = Array.from(r.residuals.slice(0, bearings.length));
  const rms = Math.sqrt(res.reduce((s, v) => s + v * v, 0) / Math.max(1, res.length));
  const xs = r.x;
  return {
    input,
    x: xs,
    wall: (id, x = xs) => wall(id, x),
    point: (id, x = xs) => point(id, x),
    camera: (id, x = xs) => camera(id, x),
    k: input.lens ? lensK(xs) : 0,
    residuals: res,
    rms,
    covariance: cov,
    sigma: (f) => sigmaOf(f, xs, cov),
    cost: r.cost,
  };
}

/**
 * Where a camera stood, from bearings to points whose places are known and its quadrant: the least
 * squares point on every bearing's line. Null with fewer than two, or lines all but parallel.
 */
export function resect(obs: { bearing: number; at: [number, number] }[], quadrant: number, yaw = 0): [number, number] | null {
  if (obs.length < 2) return null;
  // Each line: through P with direction d; C on it when d x (P - C) = 0, i.e. d1 Cx - d0 Cy = d1 Px - d0 Py.
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (const o of obs) {
    const d = planDirection(o.bearing, quadrant, yaw);
    const r1 = d[1];
    const r2 = -d[0];
    const rhs = d[1] * o.at[0] - d[0] * o.at[1];
    a11 += r1 * r1;
    a12 += r1 * r2;
    a22 += r2 * r2;
    b1 += r1 * rhs;
    b2 += r2 * rhs;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-6) return null;
  return [(a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det];
}
