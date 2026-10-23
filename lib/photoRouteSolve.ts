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

import { leastSquares, sigmaOf, symEigen, symPinv } from "./photoRouteMath";

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
  /** Where the user said the photo was taken from, held loosely (2026-10-20): a photo with one corner, or none. */
  prior?: { at: [number, number]; sdFeet: number };
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
  /**
   * A photo held in the hand stands about 5 ft over the ground (2026-10-16): for a corner tapped where it
   * meets the ground, `drop` (how far below the level camera's horizon, over the focal) times the
   * corner's depth ahead of the camera is the camera's height. Held loosely (sd `sdFeet`, robust), it
   * says roughly how far off each camera stood, which the bearings alone never say.
   */
  heights?: { camera: string; point: string; drop: number; forward: number; feet: number; sdFeet: number }[];
  /**
   * Distances (by id prefix, "drawn:") that hold the solve where nothing else says anything - the shape as drawn - but are
   * not information about the house (2026-10-22): `Solution.sigmaInformed` leaves them out, so a size only they held reads
   * as not measured rather than as sure as the drawing was taken to be.
   */
  uninformed?: string[];
  /**
   * Walls kept in order (2026-10-23): wall b at least `minFeet` past wall a along the axis - a side keeps the way the walk
   * turned it. Nothing until it would flip; then a steep cost. A distance is a length either way round, so a bump-out held
   * by its length alone could fold back through the wall behind it when a map outline pulled that wall out.
   */
  apart?: { a: string; b: string; axis: WallAxis; minFeet: number; sdFeet: number }[];
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
  /**
   * One sd of f from what was measured alone (2026-10-22): the photos, the tapes, the estimates, the priors - not the
   * `uninformed` distances (the shape as drawn). As `sigma` when there are none. A direction only those held is as good as
   * unbounded here.
   */
  sigmaInformed: (f: (x: Float64Array) => number) => number;
  /**
   * As `sigmaInformed`, with one more measurement of g (one sd [sd]) taken as well (2026-10-23): what a tape not yet taken
   * would do to f - which one wall's tape settles most of what is not measured.
   */
  sigmaInformedWith: (f: (x: Float64Array) => number, g: (x: Float64Array) => number, sd: number) => number;
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
  const end = (id: string, axis: WallAxis | "any", x: Float64Array): [number, number] => {
    if (!id.startsWith("wall:")) return point(id, x);
    const v = wall(id.slice(5), x);
    return axis === "N" ? [0, v] : [v, 0];
  };
  const distanceResidual = (dd: SolveDistance, x: Float64Array): number => {
    const A = end(dd.a, dd.axis, x);
    const B = end(dd.b, dd.axis, x);
    const got = dd.axis === "E" ? Math.abs(B[0] - A[0]) : dd.axis === "N" ? Math.abs(B[1] - A[1]) : Math.hypot(B[0] - A[0], B[1] - A[1]);
    return (got - dd.feet) / dd.sdFeet;
  };
  const residual = (x: Float64Array): Float64Array => {
    void 0;
    const hs = input.heights ?? [];
    const priors = input.cameras.filter((c) => c.prior);
    const apart = input.apart ?? [];
    const out = new Float64Array(bearings.length + input.cameras.length + input.distances.length + (input.lens ? 1 : 0) + hs.length + 2 * priors.length + apart.length);
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
    if (input.lens) out[bearings.length + input.cameras.length + input.distances.length] = (lensK(x) - input.lens.k0) / input.lens.sd;
    const hAt = bearings.length + input.cameras.length + input.distances.length + (input.lens ? 1 : 0);
    hs.forEach((hh, j) => {
      const cam = camById.get(hh.camera);
      if (!cam) return;
      const { at, yaw } = camera(hh.camera, x);
      const P = point(hh.point, x);
      const z = planDirection(hh.forward, cam.quadrant, yaw);
      const depth = (P[0] - at[0]) * z[0] + (P[1] - at[1]) * z[1];
      out[hAt + j] = (hh.drop * depth - hh.feet) / hh.sdFeet;
    });
    // Where the user said each was taken from, last.
    let pAt = hAt + hs.length;
    for (const c of priors) {
      const pr = c.prior as { at: [number, number]; sdFeet: number };
      const { at } = camera(c.id, x);
      out[pAt++] = (at[0] - pr.at[0]) / pr.sdFeet;
      out[pAt++] = (at[1] - pr.at[1]) / pr.sdFeet;
    }
    for (const ap of apart) out[pAt++] = Math.max(0, ap.minFeet - (wall(ap.b.slice(5), x) - wall(ap.a.slice(5), x))) / ap.sdFeet;
    for (const dd of input.distances) out[i++] = distanceResidual(dd, x);
    return out;
  };
  const r = leastSquares(residual, x0, { fScale: input.robustSd ?? 3, maxIterations: opts.maxIterations ?? 200, step: (v) => 1e-6 * Math.max(1, Math.abs(v)) });
  const cov = symPinv(r.hessian, n);
  const res = Array.from(r.residuals.slice(0, bearings.length));
  const rms = Math.sqrt(res.reduce((s, v) => s + v * v, 0) / Math.max(1, res.length));
  const xs = r.x;
  // The covariance without the uninformed distances: their part of JᵀWJ taken off the Hessian (each a scalar residual, its
  // gradient by differences, weighted as the solve weighed it).
  let informed: Float64Array | null = null;
  const informedCov = (): Float64Array => {
    if (informed) return informed;
    const prefixes = input.uninformed ?? [];
    const out = prefixes.length ? Float64Array.from(r.hessian) : cov;
    if (prefixes.length) {
      const c = input.robustSd ?? 3;
      const xx = Float64Array.from(xs);
      for (const dd of input.distances) {
        if (!prefixes.some((p) => dd.id.startsWith(p))) continue;
        const r0 = distanceResidual(dd, xs);
        const g = new Float64Array(n);
        for (let j = 0; j < n; j++) {
          const keep = xx[j] as number;
          const h = 1e-6 * Math.max(1, Math.abs(keep));
          xx[j] = keep + h;
          g[j] = (distanceResidual(dd, xx) - r0) / h;
          xx[j] = keep;
        }
        const w = 1 / Math.sqrt(1 + (r0 / c) ** 2);
        for (let a = 0; a < n; a++) {
          const ga = g[a] as number;
          if (ga === 0) continue;
          for (let b2 = 0; b2 < n; b2++) out[a * n + b2] = (out[a * n + b2] as number) - w * ga * (g[b2] as number);
        }
      }
    }
    if (!prefixes.length) {
      informed = cov;
      return informed;
    }
    // Inverted eigenvalue by eigenvalue, each held at least at the pseudo-inverse's own cut (1e-12 of the largest): a
    // direction the taken-off part alone held - or that came out a hair negative taking it off - is then as good as
    // unbounded, and every other is as the full solve has it or wider, never narrower.
    const { values, vectors } = symEigen(out, n);
    let mx = 0;
    for (const v of values) mx = Math.max(mx, Math.abs(v));
    const floor = 1e-12 * mx;
    const inv = new Float64Array(n * n);
    for (let k = 0; k < n; k++) {
      const l = Math.max(values[k] as number, floor);
      if (!(l > 0)) continue;
      for (let a = 0; a < n; a++) {
        const va = (vectors[a * n + k] as number) / l;
        if (va === 0) continue;
        for (let b2 = 0; b2 < n; b2++) inv[a * n + b2] = (inv[a * n + b2] as number) + va * (vectors[b2 * n + k] as number);
      }
    }
    informed = inv;
    return informed;
  };
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
    sigmaInformed: (f) => sigmaOf(f, xs, informedCov()),
    sigmaInformedWith: (f, g, sd) => {
      // One more scalar measurement of g: var f' = fCf - (fCg)^2 / (sd^2 + gCg).
      const C = informedCov();
      const grad = (h: (x: Float64Array) => number) => {
        const out = new Float64Array(n);
        const xx = Float64Array.from(xs);
        const h0 = h(xx);
        for (let j = 0; j < n; j++) {
          const keep = xx[j] as number;
          xx[j] = keep + 1e-5;
          out[j] = (h(xx) - h0) / 1e-5;
          xx[j] = keep;
        }
        return out;
      };
      const gf = grad(f);
      const gg = grad(g);
      let fCf = 0;
      let fCg = 0;
      let gCg = 0;
      for (let a = 0; a < n; a++) {
        const fa = gf[a] as number;
        const ga = gg[a] as number;
        if (fa === 0 && ga === 0) continue;
        for (let b2 = 0; b2 < n; b2++) {
          const c = C[a * n + b2] as number;
          fCf += fa * c * (gf[b2] as number);
          fCg += fa * c * (gg[b2] as number);
          gCg += ga * c * (gg[b2] as number);
        }
      }
      return Math.sqrt(Math.max(0, fCf - (fCg * fCg) / (sd * sd + gCg)));
    },
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
