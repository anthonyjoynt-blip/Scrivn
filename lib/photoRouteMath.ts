/**
 * The numbers under the photo route (2026-10-16, lib/photoRoute*.ts): a robust least-squares solver,
 * a symmetric eigen-solver for the covariance, and 3x3 rotations. Small and dense on purpose: the
 * route's problems are a few hundred unknowns at most (a camera's 3, a wall's 1), and every one runs
 * in the browser of a phone, with no library to load.
 *
 * `leastSquares` is Levenberg-Marquardt on a forward-difference Jacobian, with scipy's "soft_l1" loss
 * (rho(z) = 2(sqrt(1 + z) - 1), z = (r / fScale)^2) done as iteratively reweighted Gauss-Newton: the
 * proof (photo-route-proof/scripts/ba.py) used scipy's least_squares with that loss, and this gives
 * the same minimum.
 */

export type Vec3 = [number, number, number];
/** Row by row. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

// ── 3x3 ─────────────────────────────────────────────────────────────────────────────────────────

export const mat3 = (rows: number[][]): Mat3 => rows.flat() as Mat3;
export const col = (m: Mat3, j: number): Vec3 => [m[j] as number, m[3 + j] as number, m[6 + j] as number];
export const mulMV = (m: Mat3, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
/** Mᵀv. */
export const mulMtV = (m: Mat3, v: Vec3): Vec3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
export function mulMM(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) o[i * 3 + j] = (a[i * 3] as number) * (b[j] as number) + (a[i * 3 + 1] as number) * (b[3 + j] as number) + (a[i * 3 + 2] as number) * (b[6 + j] as number);
  return o;
}
export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit3 = (a: Vec3): Vec3 => {
  const n = norm3(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
export const det3 = (m: Mat3) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

export function inv3(m: Mat3): Mat3 | null {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-300) return null;
  const [a, b, c, e, f, g, h, i, j] = m;
  return [
    (f * j - g * i) / d,
    (c * i - b * j) / d,
    (b * g - c * f) / d,
    (g * h - e * j) / d,
    (a * j - c * h) / d,
    (c * e - a * g) / d,
    (e * i - f * h) / d,
    (b * h - a * i) / d,
    (a * f - b * e) / d,
  ];
}

/** The rotation of angle |r| about r (Rodrigues). */
export function rotvecToMat(r: Vec3): Mat3 {
  const t = norm3(r);
  if (t < 1e-12) return [1, -r[2], r[1], r[2], 1, -r[0], -r[1], r[0], 1];
  const [x, y, z] = [r[0] / t, r[1] / t, r[2] / t];
  const c = Math.cos(t);
  const s = Math.sin(t);
  const C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

/** The rotation vector of a rotation matrix (det +1). */
export function matToRotvec(m: Mat3): Vec3 {
  const tr = m[0] + m[4] + m[8];
  const cos = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const t = Math.acos(cos);
  if (t < 1e-9) return [(m[7] - m[5]) / 2, (m[2] - m[6]) / 2, (m[3] - m[1]) / 2];
  if (Math.PI - t < 1e-6) {
    // Near a half turn: the axis from the diagonal.
    const xx = Math.sqrt(Math.max(0, (m[0] + 1) / 2));
    const yy = Math.sqrt(Math.max(0, (m[4] + 1) / 2));
    const zz = Math.sqrt(Math.max(0, (m[8] + 1) / 2));
    let ax: Vec3 = [xx, yy, zz];
    if (xx >= yy && xx >= zz) ax = [xx, m[1] >= 0 ? yy : -yy, m[2] >= 0 ? zz : -zz];
    else if (yy >= zz) ax = [m[1] >= 0 ? xx : -xx, yy, m[5] >= 0 ? zz : -zz];
    else ax = [m[2] >= 0 ? xx : -xx, m[5] >= 0 ? yy : -yy, zz];
    const u = unit3(ax);
    return [u[0] * t, u[1] * t, u[2] * t];
  }
  const s = 2 * Math.sin(t);
  return [((m[7] - m[5]) / s) * t, ((m[2] - m[6]) / s) * t, ((m[3] - m[1]) / s) * t];
}

// ── Dense symmetric ──────────────────────────────────────────────────────────────────────────────

/** Eigenvalues and eigenvectors (columns of `vectors`, row-major n x n) of a symmetric n x n matrix, by cyclic Jacobi. */
export function symEigen(a: Float64Array, n: number): { values: Float64Array; vectors: Float64Array } {
  const A = Float64Array.from(a);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += (A[p * n + q] as number) ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q] as number;
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p] as number;
        const aqq = A[q * n + q] as number;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p] as number;
          const akq = A[k * n + q] as number;
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k] as number;
          const aqk = A[q * n + k] as number;
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p] as number;
          const vkq = V[k * n + q] as number;
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = A[i * n + i] as number;
  return { values, vectors: V };
}

/** The pseudo-inverse of a symmetric matrix: eigenvalues under rcond times the largest are taken as zero. */
export function symPinv(a: Float64Array, n: number, rcond = 1e-12): Float64Array {
  const { values, vectors } = symEigen(a, n);
  let max = 0;
  for (const v of values) max = Math.max(max, Math.abs(v));
  const out = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    const l = values[k] as number;
    if (Math.abs(l) <= rcond * max) continue;
    for (let i = 0; i < n; i++) {
      const vik = (vectors[i * n + k] as number) / l;
      if (vik === 0) continue;
      for (let j = 0; j < n; j++) out[i * n + j] = (out[i * n + j] as number) + vik * (vectors[j * n + k] as number);
    }
  }
  return out;
}

/** Solves (A) x = b for symmetric positive definite A by Cholesky; null when it is not positive definite. */
export function cholSolve(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * n + j] as number;
      for (let k = 0; k < j; k++) s -= (L[i * n + k] as number) * (L[j * n + k] as number);
      if (i === j) {
        if (!(s > 0)) return null;
        L[i * n + i] = Math.sqrt(s);
      } else L[i * n + j] = s / (L[j * n + j] as number);
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i] as number;
    for (let k = 0; k < i; k++) s -= (L[i * n + k] as number) * (y[k] as number);
    y[i] = s / (L[i * n + i] as number);
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i] as number;
    for (let k = i + 1; k < n; k++) s -= (L[k * n + i] as number) * (x[k] as number);
    x[i] = s / (L[i * n + i] as number);
  }
  return x;
}

// ── Least squares ────────────────────────────────────────────────────────────────────────────────

export interface LsqOptions {
  /** soft_l1's scale; null for plain least squares. */
  fScale?: number | null;
  maxIterations?: number;
  /** Forward-difference step per unknown; default 1e-6 times max(1, |x|). */
  step?: (x: number, i: number) => number;
  /** Stop when the cost falls by less than this fraction. */
  tolerance?: number;
}

export interface LsqResult {
  x: Float64Array;
  /** Half the sum of rho over the residuals, as scipy reports it. */
  cost: number;
  residuals: Float64Array;
  /** JᵀWJ at the solution (n x n, row-major): the Gauss-Newton Hessian of the cost, for the covariance. */
  hessian: Float64Array;
  iterations: number;
}

function costOf(r: Float64Array, c: number | null): number {
  let s = 0;
  if (c === null) {
    for (const v of r) s += v * v;
    return s / 2;
  }
  for (const v of r) s += 2 * c * c * (Math.sqrt(1 + (v / c) ** 2) - 1);
  return s / 2;
}

/**
 * Minimises the cost of `fun(x)` from `x0`. Each residual is weighted by soft_l1's rho'(z) at the
 * current point (IRLS), and the step is damped Gauss-Newton (Levenberg-Marquardt, the damping scaled
 * to JᵀWJ's own diagonal so unknowns of different units step alike).
 */
export function leastSquares(fun: (x: Float64Array) => Float64Array, x0: Float64Array, opts: LsqOptions = {}): LsqResult {
  const n = x0.length;
  const c = opts.fScale ?? null;
  const maxIt = opts.maxIterations ?? 100;
  const tol = opts.tolerance ?? 1e-10;
  const stepOf = opts.step ?? ((v: number) => 1e-6 * Math.max(1, Math.abs(v)));
  let x: Float64Array = Float64Array.from(x0);
  let r: Float64Array = fun(x);
  let cost = costOf(r, c);
  let lambda = 1e-3;
  let it = 0;
  let H: Float64Array = new Float64Array(n * n);
  const jacobian = (xx: Float64Array, r0: Float64Array): Float64Array => {
    const m = r0.length;
    const J = new Float64Array(m * n);
    for (let j = 0; j < n; j++) {
      const h = stepOf(xx[j] as number, j);
      const keep = xx[j] as number;
      xx[j] = keep + h;
      const r1 = fun(xx);
      xx[j] = keep;
      for (let i = 0; i < m; i++) J[i * n + j] = ((r1[i] as number) - (r0[i] as number)) / h;
    }
    return J;
  };
  const normal = (J: Float64Array, rr: Float64Array): { H: Float64Array; g: Float64Array } => {
    const m = rr.length;
    const Hn = new Float64Array(n * n);
    const g = new Float64Array(n);
    for (let i = 0; i < m; i++) {
      const v = rr[i] as number;
      const w = c === null ? 1 : 1 / Math.sqrt(1 + (v / c) ** 2);
      if (w === 0) continue;
      const row = i * n;
      for (let a = 0; a < n; a++) {
        const ja = J[row + a] as number;
        if (ja === 0) continue;
        const wja = w * ja;
        g[a] = (g[a] as number) + wja * v;
        for (let b = a; b < n; b++) {
          const jb = J[row + b] as number;
          if (jb !== 0) Hn[a * n + b] = (Hn[a * n + b] as number) + wja * jb;
        }
      }
    }
    for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) Hn[a * n + b] = Hn[b * n + a] as number;
    return { H: Hn, g };
  };
  for (; it < maxIt; it++) {
    const J = jacobian(x, r);
    const ne = normal(J, r);
    H = ne.H;
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = Float64Array.from(H);
      for (let a = 0; a < n; a++) A[a * n + a] = (A[a * n + a] as number) * (1 + lambda) + 1e-12;
      const minusG = ne.g.map((v) => -v);
      const dx = cholSolve(A, minusG, n);
      if (!dx) {
        lambda *= 10;
        continue;
      }
      const xn = x.map((v, i) => v + (dx[i] as number));
      const rn = fun(xn);
      const cn = costOf(rn, c);
      if (Number.isFinite(cn) && cn < cost) {
        const fell = (cost - cn) / Math.max(cost, 1e-300);
        x = xn;
        r = rn;
        cost = cn;
        lambda = Math.max(1e-9, lambda / 3);
        improved = true;
        if (fell < tol) it = maxIt;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  H = normal(jacobian(x, r), r).H;
  return { x, cost, residuals: r, hessian: H, iterations: it };
}

/** 1-sigma of a scalar function of the unknowns, from the covariance (the pseudo-inverse of the Hessian). */
export function sigmaOf(f: (x: Float64Array) => number, x: Float64Array, cov: Float64Array, h = 1e-5): number {
  const n = x.length;
  const g = new Float64Array(n);
  const f0 = f(x);
  const xx = Float64Array.from(x);
  for (let i = 0; i < n; i++) {
    const keep = xx[i] as number;
    xx[i] = keep + h;
    g[i] = (f(xx) - f0) / h;
    xx[i] = keep;
  }
  let s = 0;
  for (let i = 0; i < n; i++) {
    const gi = g[i] as number;
    if (gi === 0) continue;
    for (let j = 0; j < n; j++) s += gi * (cov[i * n + j] as number) * (g[j] as number);
  }
  return Math.sqrt(Math.max(0, s));
}
