/**
 * A 360° spot as one picture (2026-10-02). "unless im exactly where the scan happened i will only see
 * a small slice and not the full room... we will want to clean it up a little bit if possible so it all
 * blends together looking nice and cohesive rather than the fragmentation and ghost walls" (the owner,
 * of walk mode's spots, which hung each of a turn's 28 frames as its own flat picture over the model).
 *
 * Walk mode now stitches a spot's frames into one panorama - every direction from the spot, blended -
 * and stands the view inside it. This file is the arithmetic, kept free of three.js so it can be
 * checked as numbers (test/sketch/panorama.mjs); components/sketch/panoBake.ts does the drawing.
 *
 * THREE THINGS THE FRAMES NEED, found on the owner's own spots of 2026-10-02 06:18 and 06:23:
 *
 * - WHERE EACH CAMERA STOOD. The phone does not turn about its lens: held out at arm's length it swings
 *   round the person, and tilting it down to the floor drops it about 10" (the file's frames carry that,
 *   0.20 m out along the way they look, the floor ring 0.25 m below the level one). Seen from 2 m away
 *   that is 5-6 degrees - a doorway drawn twice, a sconce beside itself. So a frame is not laid on the
 *   sphere by its turn alone: the point a direction from the spot meets on the model (wall, floor,
 *   ceiling, cabinet - the proxy) is looked at from where that frame's camera was ([warpThrough]).
 * - A TURN TRUE TO A DEGREE. Each frame's turn comes from the phone's rotation sensor, good to 2-4
 *   degrees over a turn of the spot (its own log's "drift" grew 0.2 -> 4.3 degrees over spot 1). The
 *   pictures themselves say how far apart the same things land where two frames overlap
 *   ([measurePair]); one small turn per frame that brings every overlap together is solved for
 *   ([solveRotations]) - residual 2.9 -> 0.75 degree on spot 1.
 * - ONE EXPOSURE. The camera set its own exposure frame by frame; where two frames overlap their
 *   brightness is compared and one gain per frame and channel evens them out ([solveGains], Brown and
 *   Lowe's gain compensation, on ratios).
 *
 * UNITS are the model's: feet, x across the page, y up, z down the page (lib/sketch3d.ts). Directions
 * are unit vectors in the same frame. A frame's pixels are its picture's at full size (`camera`), x
 * right and y down.
 */

import type { WalkCamera } from "./sketch";

export type V3 = [number, number, number];

/** One frame of a spot, as the stitching sees it. */
export interface PanoFrame {
  /** The camera's axes, unit: the way it looked, the picture's top edge, its right edge. */
  forward: V3;
  up: V3;
  right: V3;
  /** Where its camera stood, from the spot's middle (feet). */
  offset: V3;
  camera: WalkCamera;
}

/** A frame's picture in grey, `scale` of its full size, row by row from the top. */
export interface Gray {
  w: number;
  h: number;
  scale: number;
  data: Float32Array;
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

const DEG = Math.PI / 180;

/** [a] turned by the rotation vector [w] (its axis times its angle, radians). */
export function rotate(a: V3, w: V3): V3 {
  const t = Math.hypot(w[0], w[1], w[2]);
  if (t < 1e-12) return [a[0], a[1], a[2]];
  const k = mul(w, 1 / t);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return add(add(mul(a, c), cross(k, a), s), k, dot(k, a) * (1 - c));
}

// ---- The panorama's own map: equirectangular ---------------------------------------------------------

/**
 * The direction a point of the panorama's picture stands for: [u] round from the back (0) through
 * straight ahead at no turn (0.5, looking down -z) to the back again (1), turning right as it grows;
 * [v] from straight down (0) to straight up (1). The shaders use the same (panoBake.ts).
 */
export function dirOfEquirect(u: number, v: number): V3 {
  const yaw = (u - 0.5) * 2 * Math.PI;
  const pitch = (v - 0.5) * Math.PI;
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/** Where direction [d] lands on the panorama's picture: [u, v] as [dirOfEquirect] reads them. */
export function equirectOf(d: V3): [number, number] {
  const n = norm(d);
  const yaw = Math.atan2(n[0], -n[2]);
  return [0.5 + yaw / (2 * Math.PI), 0.5 + Math.asin(Math.max(-1, Math.min(1, n[1]))) / Math.PI];
}

// ---- A frame's camera ----------------------------------------------------------------------------------

/** The full-size pixel [d] lands on in [f]'s picture, or null when off it (or within [margin] of its edge, a share of its size). */
export function projectToFrame(f: PanoFrame, d: V3, margin = 0): [number, number] | null {
  const z = dot(d, f.forward);
  if (z < 0.1) return null;
  const c = f.camera;
  const px = c.cx + (c.fx * dot(d, f.right)) / z;
  const py = c.cy - (c.fy * dot(d, f.up)) / z;
  const mx = c.width * margin;
  const my = c.height * margin;
  if (px < mx || px > c.width - mx || py < my || py > c.height - my) return null;
  return [px, py];
}

/** The direction [f]'s full-size pixel ([px], [py]) looked along. */
export function rayOfPixel(f: PanoFrame, px: number, py: number): V3 {
  const c = f.camera;
  return norm(add(add(f.forward, f.right, (px - c.cx) / c.fx), f.up, -(py - c.cy) / c.fy));
}

/**
 * How a direction from the spot's middle is looked along by a frame: towards the point it meets
 * [distanceOf] feet out (the proxy), from where that frame's camera stood. Without a proxy, as it is.
 */
export type Warp = (f: PanoFrame, d: V3) => V3;
export function warpThrough(distanceOf: (d: V3) => number): Warp {
  return (f, d) => {
    const t = distanceOf(d);
    if (!(t > 0) || !Number.isFinite(t)) return d;
    return norm([d[0] * t - f.offset[0], d[1] * t - f.offset[1], d[2] * t - f.offset[2]]);
  };
}

/** Frames with their axes turned by one rotation vector each. */
export function applyRotations(frames: PanoFrame[], w: V3[]): PanoFrame[] {
  return frames.map((f, k) => {
    const r = w[k] ?? [0, 0, 0];
    const forward = norm(rotate(f.forward, r));
    const up0 = rotate(f.up, r);
    const up = norm(add(up0, forward, -dot(up0, forward)));
    return { ...f, forward, up, right: norm(cross(forward, up)) };
  });
}

// ---- Measuring where two frames disagree ---------------------------------------------------------------

/**
 * What one overlap says: where the content [i] shows at direction [c] lands in [j] - [dx] along [e1] and
 * [dy] along [e2], radians - and how far to believe it ([weight], 0 for not at all).
 */
export interface Pair {
  i: number;
  j: number;
  c: V3;
  e1: V3;
  e2: V3;
  dx: number;
  dy: number;
  /** The match's correlation, -1..1, and how many pixels it rests on. */
  r: number;
  n: number;
  weight: number;
}

function bilinear(g: Gray, x: number, y: number): number {
  if (x < 0 || y < 0 || x > g.w - 1.001 || y > g.h - 1.001) return Number.NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const ax = x - x0;
  const ay = y - y0;
  const i = y0 * g.w + x0;
  const d = g.data;
  return ((d[i] as number) * (1 - ax) + (d[i + 1] as number) * ax) * (1 - ay) + ((d[i + g.w] as number) * (1 - ax) + (d[i + g.w + 1] as number) * ax) * ay;
}

/** [f]'s picture as seen on the plane touching the sphere at [c] (axes [e1], [e2]): [w] x [h] samples [step] radians apart. */
function renderPatch(f: PanoFrame, g: Gray, c: V3, e1: V3, e2: V3, w: number, h: number, step: number, warp: Warp | null): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const b = (y - (h - 1) / 2) * step;
    for (let x = 0; x < w; x++) {
      const a = (x - (w - 1) / 2) * step;
      const d0 = norm(add(add(c, e1, a), e2, b));
      const p = projectToFrame(f, warp ? warp(f, d0) : d0, 0.02);
      out[y * w + x] = p ? bilinear(g, p[0] * g.scale, p[1] * g.scale) : Number.NaN;
    }
  }
  return out;
}

/** How fast the picture changes at each sample (content, not brightness, is matched); NaN at the edges and holes. */
function gradient(p: Float32Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h).fill(Number.NaN);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      g[i] = Math.hypot((p[i + 1] as number) - (p[i - 1] as number), (p[i + w] as number) - (p[i - w] as number));
    }
  }
  return g;
}

/** Every [k] x [k] block averaged, where at least half of it is there. */
function shrink(p: Float32Array, w: number, h: number, k: number): { p: Float32Array; w: number; h: number } {
  const W = Math.floor(w / k);
  const H = Math.floor(h / k);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      let n = 0;
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const v = p[(y * k + j) * w + x * k + i] as number;
          if (!Number.isNaN(v)) {
            s += v;
            n++;
          }
        }
      }
      out[y * W + x] = n > (k * k) / 2 ? s / n : Number.NaN;
    }
  }
  return { p: out, w: W, h: H };
}

/** Zero-mean normalised correlation of [a] with [b] moved by ([dx], [dy]): b(x + dx, y + dy) against a(x, y). */
function zncc(a: Float32Array, b: Float32Array, w: number, h: number, dx: number, dy: number): { r: number; n: number } {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(w, w - dx);
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(h, h - dy);
  for (let y = y0; y < y1; y++) {
    const ra = y * w;
    const rb = (y + dy) * w + dx;
    for (let x = x0; x < x1; x++) {
      const va = a[ra + x] as number;
      const vb = b[rb + x] as number;
      if (Number.isNaN(va) || Number.isNaN(vb)) continue;
      n++;
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  if (n < 60) return { r: -1, n };
  const ca = saa - (sa * sa) / n;
  const cb = sbb - (sb * sb) / n;
  if (ca <= 1e-9 || cb <= 1e-9) return { r: -1, n };
  return { r: (sab - (sa * sb) / n) / Math.sqrt(ca * cb), n };
}

function bestShift(a: Float32Array, b: Float32Array, w: number, h: number, cx: number, cy: number, radius: number) {
  let best = { r: -2, dx: 0, dy: 0, n: 0 };
  for (let dy = cy - radius; dy <= cy + radius; dy++) {
    for (let dx = cx - radius; dx <= cx + radius; dx++) {
      const z = zncc(a, b, w, h, dx, dy);
      if (z.r > best.r) best = { r: z.r, dx, dy, n: z.n };
    }
  }
  return best;
}

/** Samples of a patch: a quarter of a degree apart, finer than the stitched picture's own (about 0.09). */
const PATCH_STEP = 0.25 * DEG;
/** The farthest apart two frames' versions of one thing are looked for, in coarse samples (4 patch samples, a degree): 7 degrees. */
const SEARCH_COARSE = 7;
/** A match is believed from this correlation, over at least this many samples. */
const MIN_R = 0.35;
const MIN_N = 400;

/**
 * The pairs of frames worth measuring: looking within 70 degrees of each other. Measured one at a
 * time ([measurePair]) so a caller can let the page breathe in between.
 */
export function overlappingPairs(frames: PanoFrame[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      if (dot((frames[i] as PanoFrame).forward, (frames[j] as PanoFrame).forward) >= Math.cos(70 * DEG)) out.push([i, j]);
    }
  }
  return out;
}

/**
 * Where frames [i] and [j] disagree, from their pictures: the part of the sphere both see, drawn from
 * each on the plane touching it there, and the shift of [j]'s that lines its edges up with [i]'s found
 * coarse (4x smaller) then fine, to a tenth of a sample. Null when they hardly overlap.
 */
export function measurePair(frames: PanoFrame[], grays: Gray[], i: number, j: number, warp: Warp | null = null, search = SEARCH_COARSE): Pair | null {
  const fi = frames[i] as PanoFrame;
  const fj = frames[j] as PanoFrame;
  const gi = grays[i] as Gray;
  const gj = grays[j] as Gray;
  // Directions both see, sampled over frame i.
  const inside: V3[] = [];
  for (let gy = 0; gy < 24; gy++) {
    for (let gx = 0; gx < 14; gx++) {
      const d = rayOfPixel(fi, ((gx + 0.5) / 14) * fi.camera.width, ((gy + 0.5) / 24) * fi.camera.height);
      if (projectToFrame(fj, warp ? warp(fj, d) : d, 0.03)) inside.push(d);
    }
  }
  if (inside.length < 24) return null;
  let c: V3 = [0, 0, 0];
  for (const d of inside) c = add(c, d);
  c = norm(c);
  const worldUp: V3 = Math.abs(c[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm(cross(worldUp, c));
  const e2 = cross(c, e1);
  let amax = 0;
  let bmax = 0;
  for (const d of inside) {
    const z = dot(d, c);
    amax = Math.max(amax, Math.abs(dot(d, e1) / z));
    bmax = Math.max(bmax, Math.abs(dot(d, e2) / z));
  }
  amax = Math.min(amax, Math.tan(22 * DEG));
  bmax = Math.min(bmax, Math.tan(30 * DEG));
  const w = Math.max(40, Math.min(240, Math.round((2 * Math.atan(amax)) / PATCH_STEP)));
  const h = Math.max(40, Math.min(320, Math.round((2 * Math.atan(bmax)) / PATCH_STEP)));
  const pa = gradient(renderPatch(fi, gi, c, e1, e2, w, h, PATCH_STEP, warp), w, h);
  const pb = gradient(renderPatch(fj, gj, c, e1, e2, w, h, PATCH_STEP, warp), w, h);
  const ca = shrink(pa, w, h, 4);
  const cb = shrink(pb, w, h, 4);
  const coarse = bestShift(ca.p, cb.p, ca.w, ca.h, 0, 0, search);
  // The coarse match is good to half a coarse sample: two fine ones either way.
  const fine = bestShift(pa, pb, w, h, coarse.dx * 4, coarse.dy * 4, 2);
  // A tenth of a sample, from a parabola through the neighbours.
  const sub = (axis: 0 | 1) => {
    const m = zncc(pa, pb, w, h, fine.dx - (axis === 0 ? 1 : 0), fine.dy - (axis === 1 ? 1 : 0)).r;
    const p = zncc(pa, pb, w, h, fine.dx + (axis === 0 ? 1 : 0), fine.dy + (axis === 1 ? 1 : 0)).r;
    const den = m - 2 * fine.r + p;
    return Math.abs(den) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / den)) : 0;
  };
  const ok = fine.r > MIN_R && fine.n > MIN_N;
  return {
    i,
    j,
    c,
    e1,
    e2,
    dx: (fine.dx + sub(0)) * PATCH_STEP,
    dy: (fine.dy + sub(1)) * PATCH_STEP,
    r: fine.r,
    n: fine.n,
    weight: ok ? Math.min(1, (fine.r - 0.3) * 2) * Math.sqrt(Math.min(1, fine.n / 4000)) : 0,
  };
}

// ---- Solving ----------------------------------------------------------------------------------------------

/** x for A x = b, by elimination with partial pivoting; A is n x n, row by row. */
export function solveLinear(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const M: Float64Array[] = A.map((row, k) => {
    const r = new Float64Array(n + 1);
    r.set(row);
    r[n] = b[k] as number;
    return r;
  });
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((M[r] as Float64Array)[c] as number) > Math.abs((M[piv] as Float64Array)[c] as number)) piv = r;
    const swap = M[c] as Float64Array;
    M[c] = M[piv] as Float64Array;
    M[piv] = swap;
    const row = M[c] as Float64Array;
    const d = row[c] as number;
    if (Math.abs(d) < 1e-18) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const other = M[r] as Float64Array;
      const k = (other[c] as number) / d;
      if (k === 0) continue;
      for (let q = c; q <= n; q++) other[q] = (other[q] as number) - k * (row[q] as number);
    }
  }
  const x = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const row = M[k] as Float64Array;
    x[k] = Math.abs(row[k] as number) < 1e-18 ? 0 : (row[n] as number) / (row[k] as number);
  }
  return x;
}

/** How well a measurement is believed: about a third of a degree. */
const MEASURE_SIGMA = 0.3 * DEG;

/**
 * One small turn per frame (world rotation vectors) that best brings every measured overlap together:
 * after the turns, [j]'s version of what [i] shows at c lands on it - (w_i - w_j) x c = dx e1 + dy e2.
 * A weak pull ([priorDeg]) keeps each turn small (the sensor is mostly right); the turns add up to
 * nothing, so the spot as a whole stays level and facing where the sensor set it in the room. A few
 * rounds take the weight off overlaps that disagree with the rest (a bad match, a near thing's
 * parallax).
 */
export function solveRotations(n: number, pairs: Pair[], priorDeg = 4, rounds = 3): V3[] {
  const use = pairs.filter((p) => p.weight > 0).map((p) => ({ ...p, weight0: p.weight }));
  let w: V3[] = Array.from({ length: n }, () => [0, 0, 0] as V3);
  if (n === 0) return w;
  for (let round = 0; round <= rounds; round++) {
    if (round > 0) {
      for (const p of use) {
        const e = pairError(p, w);
        const deg = Math.hypot(e[0], e[1]) / DEG;
        p.weight = p.weight0 * (deg < 1 ? 1 : 1 / deg);
      }
    }
    w = solveOnce(n, use, priorDeg);
  }
  return w;
}

function pairError(p: Pair, w: V3[]): [number, number] {
  const wi = w[p.i] as V3;
  const wj = w[p.j] as V3;
  const dw: V3 = [wi[0] - wj[0], wi[1] - wj[1], wi[2] - wj[2]];
  return [dot(dw, p.e2) - p.dx, -dot(dw, p.e1) - p.dy];
}

function solveOnce(n: number, pairs: Pair[], priorDeg: number): V3[] {
  const N = 3 * n;
  const A = Array.from({ length: N }, () => new Float64Array(N));
  const b = new Float64Array(N);
  const addEq = (coef: Map<number, number>, rhs: number, weight: number) => {
    for (const [p, cp] of coef) {
      b[p] = (b[p] as number) + weight * cp * rhs;
      const row = A[p] as Float64Array;
      for (const [q, cq] of coef) row[q] = (row[q] as number) + weight * cp * cq;
    }
  };
  for (const pr of pairs) {
    if (pr.weight <= 0) continue;
    const weight = pr.weight / (MEASURE_SIGMA * MEASURE_SIGMA);
    // (w_i - w_j) x c . e1 = (w_i - w_j) . e2 = dx;   (w_i - w_j) x c . e2 = -(w_i - w_j) . e1 = dy.
    for (const [v, rhs] of [
      [pr.e2, pr.dx],
      [mul(pr.e1, -1), pr.dy],
    ] as [V3, number][]) {
      const coef = new Map<number, number>();
      for (let a = 0; a < 3; a++) {
        const va = v[a] as number;
        coef.set(3 * pr.i + a, (coef.get(3 * pr.i + a) ?? 0) + va);
        coef.set(3 * pr.j + a, (coef.get(3 * pr.j + a) ?? 0) - va);
      }
      addEq(coef, rhs, weight);
    }
  }
  const prior = 1 / (priorDeg * DEG) ** 2;
  for (let k = 0; k < N; k++) (A[k] as Float64Array)[k] = ((A[k] as Float64Array)[k] as number) + prior;
  // The turns add up to nothing, about every axis.
  const hard = (1e4 * n * n) / (MEASURE_SIGMA * MEASURE_SIGMA);
  for (let a = 0; a < 3; a++) {
    const coef = new Map<number, number>();
    for (let k = 0; k < n; k++) coef.set(3 * k + a, 1 / n);
    addEq(coef, 0, hard);
  }
  const x = solveLinear(A, b);
  return Array.from({ length: n }, (_, k) => [x[3 * k] as number, x[3 * k + 1] as number, x[3 * k + 2] as number] as V3);
}

/** The overlaps' disagreement under turns [w], degrees (weighted rms): what [solveRotations] brings down. */
export function residualDeg(pairs: Pair[], w: V3[]): number {
  let s = 0;
  let n = 0;
  for (const p of pairs) {
    if (p.weight <= 0) continue;
    const e = pairError(p, w);
    s += p.weight * (e[0] * e[0] + e[1] * e[1]);
    n += p.weight;
  }
  return n > 0 ? Math.sqrt(s / n) / DEG : 0;
}

/**
 * The frames turned until their overlaps agree: [rounds] rounds of measuring every overlapping pair
 * and solving, each round starting from the last one's turns. Lets the page breathe between pairs (a
 * pair is tens of milliseconds); [cancelled] stops it. The overlaps' disagreement before and after, in
 * degrees, for the log.
 */
export async function alignFrames(
  frames: PanoFrame[],
  grays: Gray[],
  warp: Warp | null,
  opts: { rounds?: number; cancelled?: () => boolean } = {},
): Promise<{ frames: PanoFrame[]; before: number; after: number; used: number } | null> {
  const rounds = opts.rounds ?? 2;
  let current = frames;
  let before = Number.NaN;
  let after = Number.NaN;
  let used = 0;
  for (let round = 0; round < rounds; round++) {
    const pairs: Pair[] = [];
    let since = performance.now();
    for (const [i, j] of overlappingPairs(current)) {
      if (opts.cancelled?.()) return null;
      // After the first round the frames are within a degree or so: a short search is enough.
      const p = measurePair(current, grays, i, j, warp, round === 0 ? SEARCH_COARSE : 3);
      if (p) pairs.push(p);
      if (performance.now() - since > 24) {
        await new Promise((r) => setTimeout(r, 0));
        since = performance.now();
      }
    }
    const zero = current.map(() => [0, 0, 0] as V3);
    const w = solveRotations(current.length, pairs);
    if (round === 0) before = residualDeg(pairs, zero);
    after = residualDeg(pairs, w);
    used = pairs.filter((p) => p.weight > 0).length;
    current = applyRotations(current, w);
  }
  return { frames: current, before, after, used };
}

/** Two frames where they overlap: how much brighter frame [i] is there than frame [j], per channel (a log), over [n] samples. */
export interface Overlap {
  i: number;
  j: number;
  n: number;
  log: [number, number, number];
}

/**
 * One gain per frame and channel that evens out the frames' exposures where they overlap (Brown and Lowe's gain
 * compensation, on ratios): sum over overlaps of n ((x_i - x_j + log)^2 / sigmaN^2 + x_i^2 / sigma_i^2 + x_j^2 /
 * sigma_j^2), least squares, x the log of a gain and log how much brighter frame i is than frame j there.
 *
 * On ratios, not on the brightness itself as Brown and Lowe have it (2026-10-03): weighed by its own brightness, a
 * dim room's every difference was small beside the pull of each gain towards 1, and the 07:21 walk's bedroom kept a
 * floor-ring frame half again as bright as the level ring above it. Solved twice: the brightness (the channels' logs
 * weighed as the eye weighs them) with each frame pulled towards no change by [sigmaG], then each channel's own
 * difference from it by [sigmaC] - one number, or one per frame. The colour is for holding hard where the camera's
 * own is to be trusted (the level ring: evened halfway to the floor ring's carpet-lit frames, the bedroom's grey walls
 * went lavender) and leaving free where it is not (the floor ring's frame under the bedroom window, bluer than the
 * level ring above it).
 */
export function solveGains(n: number, overlaps: Overlap[], sigmaG: number | ArrayLike<number> = 0.3, sigmaC: number | ArrayLike<number> = 0.04, sigmaN = 0.04): [number, number, number][] {
  const brightness = (o: Overlap) => 0.299 * o.log[0] + 0.587 * o.log[1] + 0.114 * o.log[2];
  const x = solveLogGains(n, overlaps, brightness, sigmaN, sigmaG);
  const out: [number, number, number][] = Array.from({ length: n }, () => [1, 1, 1]);
  for (let ch = 0; ch < 3; ch++) {
    const c = solveLogGains(n, overlaps, (o) => (o.log[ch] as number) - brightness(o), sigmaN, sigmaC);
    for (let k = 0; k < n; k++) (out[k] as [number, number, number])[ch] = Math.max(0.5, Math.min(2, Math.exp((x[k] as number) + (c[k] as number))));
  }
  return out;
}

/** The log gains [solveGains] solves for, one per frame, from each overlap's [value] (how much brighter i is than j, a log). */
function solveLogGains(n: number, overlaps: Overlap[], value: (o: Overlap) => number, sigmaN: number, sigma: number | ArrayLike<number>): Float64Array {
  const prior = (k: number) => {
    const s = typeof sigma === "number" ? sigma : (sigma[k] as number);
    return 1 / (s * s);
  };
  const A = Array.from({ length: n }, () => new Float64Array(n));
  const b = new Float64Array(n);
  for (const o of overlaps) {
    if (o.n <= 0) continue;
    const d = value(o);
    const ri = A[o.i] as Float64Array;
    const rj = A[o.j] as Float64Array;
    ri[o.i] = (ri[o.i] as number) + o.n * (1 / (sigmaN * sigmaN) + prior(o.i));
    ri[o.j] = (ri[o.j] as number) - o.n / (sigmaN * sigmaN);
    b[o.i] = (b[o.i] as number) - (o.n * d) / (sigmaN * sigmaN);
    rj[o.j] = (rj[o.j] as number) + o.n * (1 / (sigmaN * sigmaN) + prior(o.j));
    rj[o.i] = (rj[o.i] as number) - o.n / (sigmaN * sigmaN);
    b[o.j] = (b[o.j] as number) + (o.n * d) / (sigmaN * sigmaN);
  }
  for (let k = 0; k < n; k++) {
    if ((A[k] as Float64Array)[k] === 0) {
      (A[k] as Float64Array)[k] = 1;
      b[k] = 0;
    }
  }
  return solveLinear(A, b);
}

/**
 * How much brighter one frame is than another where they overlap, per channel: the median of the log of their ratio
 * over the samples both have ([a] and [b], RGBA, alpha 128 and up where a frame has it), stored as [gamma]. Where a
 * thing near is a degree or more apart in the two - a dresser against a pale wall in one, the wall alone in the
 * other - the two are not one thing in two lights: a sample differing by more than [agree] (a log) is left out, and
 * the median takes care of the rest. The 07:21 walk's floor-ring frame beside the bedroom's dresser overlapped the
 * level ring mostly across the dresser, and with every sample counted it came out a shade too light and green.
 * Samples darker than [dark] (0-1, as stored) say little in eight bits and are left out too. Null when a channel has
 * fewer than [minSamples] left: an overlap with nothing to say must not say the two are alike.
 */
export function overlapLog(a: Uint8Array, b: Uint8Array, gamma = 2.2, dark = 0.12, minSamples = 40, agree = 1.4): { n: number; log: [number, number, number] } | null {
  const BINS = 400;
  const SPAN = 2;
  const hist = new Uint32Array(BINS * 3);
  const lg = new Float64Array(256);
  for (let v = 1; v < 256; v++) lg[v] = Math.log(v / 255);
  const floor = Math.ceil(dark * 255);
  let n = 0;
  for (let p = 0; p < a.length; p += 4) {
    if ((a[p + 3] as number) < 128 || (b[p + 3] as number) < 128) continue;
    n++;
    for (let c = 0; c < 3; c++) {
      const va = a[p + c] as number;
      const vb = b[p + c] as number;
      if (va < floor || vb < floor) continue;
      const v = gamma * ((lg[va] as number) - (lg[vb] as number));
      if (Math.abs(v) > agree) continue;
      const k = Math.max(0, Math.min(BINS - 1, Math.floor(((v + SPAN) / (2 * SPAN)) * BINS)));
      hist[c * BINS + k] = (hist[c * BINS + k] as number) + 1;
    }
  }
  if (n < minSamples) return null;
  const log: [number, number, number] = [0, 0, 0];
  let used = n;
  for (let c = 0; c < 3; c++) {
    let total = 0;
    for (let k = 0; k < BINS; k++) total += hist[c * BINS + k] as number;
    if (total < minSamples) return null;
    used = Math.min(used, total);
    let seen = 0;
    for (let k = 0; k < BINS; k++) {
      const h = hist[c * BINS + k] as number;
      if (seen + h >= total / 2) {
        // Within the bin, as far as the middle sample lies into it.
        const into = h > 0 ? (total / 2 - seen) / h : 0.5;
        log[c] = ((k + into) / BINS) * 2 * SPAN - SPAN;
        break;
      }
      seen += h;
    }
  }
  return { n: used, log };
}

// ---- Where one ring hands over to the next (2026-10-03) -----------------------------------------

/** How [seamCost] weighs a place. */
export interface SeamCostOptions {
  /** A difference in texture between the two rings (0-1 grey) squared, times this, up to 1. */
  gain: number;
  /** Each row the seam hands to a ring with no frame well over it. */
  uncovered: number;
  /** Times the square of the seam's distance from [toward], as a fraction of the band. */
  centre: number;
  /** Where between the lowest (0) and highest (1) row both rings are, the seam is drawn to. */
  toward: number;
}

export const SEAM_COST_DEFAULTS: SeamCostOptions = { gain: 8, uncovered: 0.2, centre: 0.3, toward: 0.5 };

/**
 * What each place costs the seam between the level ring and another, for [seamRows] (2026-10-03, "360 looks good
 * other than some warping still. can see it on the dresser" - the owner). Each ring was taken from its own height -
 * the phone drops about 10" for the floor ring - and the model the frames are laid through has no furniture, so
 * anything near (a dresser a metre away) lands a degree or two apart in the two: wherever the seam crosses it, it
 * crosses it with a step, so it should cross where the two agree. And everything below the seam is the lower ring's
 * to draw and everything above it the upper ring's, so it should not hand a place to a ring with no frame there - the
 * 07:21 walk's floor ring left a notch between two of its frames by the dresser, a seam above it handed the notch to
 * the floor ring, and the notch was drawn as a blur.
 *
 * [level] and [other] are the two rings' texture over the band the seam may take - grey less its local mean, NaN
 * where the ring has no frame well over it - [w] columns by [h] rows, row 0 the lowest. [side] -1: the other ring is
 * the one below the seam (the floor ring), +1 the one above it (the ceiling ring). A seam at row y of a column costs
 * there: how much the two differ at y ([gain]; nothing where either is missing - only one is drawn there), [uncovered]
 * for each row under y the lower ring is missing from and each row from y up the upper ring is missing from, and
 * [centre] times the square of its distance from the middle of the rows where both rings are (none if there are none),
 * so that where nothing else decides, the seam runs where both rings are at their best and not at either's edge.
 */
export function seamCost(level: Float32Array, other: Float32Array, w: number, h: number, side: 1 | -1, o: SeamCostOptions = SEAM_COST_DEFAULTS): Float32Array {
  const lower = side < 0 ? other : level;
  const upper = side < 0 ? level : other;
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let lackLower = 0;
    let lackUpper = 0;
    let first = -1;
    let last = -1;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (Number.isNaN(upper[i] as number)) lackUpper++;
      if (!Number.isNaN(level[i] as number) && !Number.isNaN(other[i] as number)) {
        if (first < 0) first = y;
        last = y;
      }
    }
    const mid = first < 0 ? Number.NaN : first + (last - first) * o.toward;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      const a = level[i] as number;
      const b = other[i] as number;
      const differ = Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.min(1, o.gain * (a - b) * (a - b));
      const centre = Number.isNaN(mid) ? 0 : o.centre * ((y - mid) / h) ** 2;
      out[i] = differ + o.uncovered * (lackLower + lackUpper) + centre;
      // The seam a row higher: this row is the lower ring's.
      if (Number.isNaN(lower[i] as number)) lackLower++;
      if (Number.isNaN(upper[i] as number)) lackUpper--;
    }
  }
  return out;
}

/**
 * The seam between two rings of a spot, as a row per column of the panorama: the cheapest path round the whole
 * circle over [cost] ([w] columns by [h] rows, row-major, row 0 first - [seamCost]). The path moves at most
 * [maxStep] rows from one column to the next, at [stepCost] a row: a seam that wanders for nothing draws a line that
 * wanders. It goes round - the panorama's first and last columns are neighbours - so the path is found over three
 * laps and the middle one kept.
 */
export function seamRows(cost: Float32Array, w: number, h: number, maxStep = 1, stepCost = 0.02): Int32Array {
  const laps = 3;
  const cols = w * laps;
  const acc = new Float32Array(cols * h);
  const from = new Int8Array(cols * h);
  const at = (x: number, y: number) => cost[(x % w) + y * w] as number;
  for (let y = 0; y < h; y++) acc[y] = at(0, y);
  for (let x = 1; x < cols; x++) {
    for (let y = 0; y < h; y++) {
      let best = Infinity;
      let step = 0;
      for (let s = -maxStep; s <= maxStep; s++) {
        const yy = y + s;
        if (yy < 0 || yy >= h) continue;
        const v = (acc[(x - 1) * h + yy] as number) + Math.abs(s) * stepCost;
        if (v < best) { best = v; step = s; }
      }
      acc[x * h + y] = best + at(x, y);
      from[x * h + y] = step;
    }
  }
  let y = 0;
  let best = Infinity;
  for (let k = 0; k < h; k++) if ((acc[(cols - 1) * h + k] as number) < best) { best = acc[(cols - 1) * h + k] as number; y = k; }
  const out = new Int32Array(w);
  for (let x = cols - 1; x >= 0; x--) {
    if (x >= w && x < 2 * w) out[x - w] = y;
    y += from[x * h + y] as number;
  }
  return out;
}

// ---- Where one frame of a ring hands over to the next round it (2026-10-04) ---------------------

/** How [columnSeamCost] weighs a place. */
export interface ColumnSeamOptions {
  /** A difference in texture between the two frames (0-1 grey) squared, times this, up to 1. */
  gain: number;
  /** A place one of the two frames has nothing well over: the seam is not drawn there. */
  uncovered: number;
  /** Times the square of the seam's distance from the band's middle, as a fraction of the band. */
  centre: number;
}

export const COLUMN_SEAM_DEFAULTS: ColumnSeamOptions = { gain: 8, uncovered: 1, centre: 0.3 };

/**
 * What each place in the band between two neighbouring frames of a ring costs the seam between them (2026-10-04, "The
 * stitch doesn't look great" - the owner, of the first 360s on the ultra-wide). The ultra-wide sees 84 degrees across
 * and its dots are 30 apart, so neighbours overlap by more than half; blended over all of it, anything the two frames
 * see a few degrees apart - the bathroom's arched doorway 0.85 m away, the bedroom's ceiling fan over the phone - was
 * drawn twice, a ghost beside it. Each place of the panorama is now one frame's or the other's, cut along a seam that
 * crosses where the two agree, as the rings meet ([seamCost]).
 *
 * [a] and [b] are the two frames' texture over the band - grey less its local mean, NaN where the frame has nothing well
 * over it - [w] columns (round the circle, [a]'s side first) by [h] rows. A seam at column x of a row costs there how
 * much the two differ ([gain]), [uncovered] where either has nothing (a seam there hands a place to a frame that never
 * saw it), and [centre] times the square of its distance from the band's middle, so that where nothing else decides,
 * the seam runs half way between the two.
 */
export function columnSeamCost(a: Float32Array, b: Float32Array, w: number, h: number, o: ColumnSeamOptions = COLUMN_SEAM_DEFAULTS): Float32Array {
  const out = new Float32Array(w * h);
  const mid = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const va = a[i] as number;
      const vb = b[i] as number;
      const differ = Number.isNaN(va) || Number.isNaN(vb) ? o.uncovered : Math.min(1, o.gain * (va - vb) * (va - vb));
      out[i] = differ + o.centre * ((x - mid) / w) ** 2;
    }
  }
  return out;
}

/**
 * The seam between two neighbouring frames of a ring, as a column per row: the cheapest path from the first row to the
 * last over [cost] ([w] columns by [h] rows, row-major - [columnSeamCost]), moving at most [maxStep] columns from one
 * row to the next at [stepCost] a column. Not round the circle, as [seamRows] is: it runs from straight down to
 * straight up.
 */
export function seamColumns(cost: Float32Array, w: number, h: number, maxStep = 1, stepCost = 0.02): Int32Array {
  const acc = new Float32Array(w * h);
  const from = new Int8Array(w * h);
  for (let x = 0; x < w; x++) acc[x] = cost[x] as number;
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      let step = 0;
      for (let s = -maxStep; s <= maxStep; s++) {
        const xx = x + s;
        if (xx < 0 || xx >= w) continue;
        const v = (acc[(y - 1) * w + xx] as number) + Math.abs(s) * stepCost;
        if (v < best) { best = v; step = s; }
      }
      acc[y * w + x] = best + (cost[y * w + x] as number);
      from[y * w + x] = step;
    }
  }
  let x = 0;
  let best = Infinity;
  for (let k = 0; k < w; k++) if ((acc[(h - 1) * w + k] as number) < best) { best = acc[(h - 1) * w + k] as number; x = k; }
  const out = new Int32Array(h);
  for (let y = h - 1; y >= 0; y--) {
    out[y] = x;
    x += from[y * w + x] as number;
  }
  return out;
}

/** How [seamLight] reads the light either side of a seam. */
export interface SeamLightOptions {
  /** The patch round each column's seam: columns each side, rows each side. */
  halfCols: number;
  halfRows: number;
  /** Too dark to go by (0-1, as stored, in either ring): eight bits say little down there. */
  dark: number;
  /** A place where the two differ by more than this (a log) is two different things, not one in two lights: a thing near, seen a degree or more apart by the two. */
  agree: number;
  /** The previews' gamma: the light is compared as it was before it was stored. */
  gamma: number;
  /** The fewest readings a column needs. */
  minPairs: number;
  /** How far along the circle each column is evened with its neighbours (columns each side, twice over). */
  smooth: number;
  /** The most either ring is evened, either way (a log). */
  limit: number;
}

export const SEAM_LIGHT_DEFAULTS: SeamLightOptions = { halfCols: 12, halfRows: 12, dark: 0.25, agree: 0.4, gamma: 2.2, minPairs: 60, smooth: 32, limit: 0.3 };

/**
 * How much brighter ring [a] is than ring [b] along the seam between them, column by column (2026-10-03): the seam
 * hands one over to the other in under a degree, and a ring a shade brighter than the next - the phone sets its own
 * exposure for every frame, and the floor ring's frames are full of carpet - would show there as a line. The median
 * of log(a / b) in brightness over a patch round the seam ([halfCols] by [halfRows]) where both rings are there,
 * neither is too dark and the two are near enough alike to be the same thing ([agree]): a thing near lands a degree
 * or more apart in the two, and a dark drawer front set against a pale wall says nothing about the light. Brightness
 * only, the same for red, green and blue - a reading per channel tinted what it got wrong. A column with too little
 * to go on takes its neighbours' (round the circle), and every column is then evened with its own.
 *
 * [a] and [b] are RGBA previews, [w] by [h], row 0 straight down, alpha under 128 where the ring has nothing; [rows]
 * the seam's row in each column. Returns a log per column - all 0 if there is nothing anywhere.
 */
export function seamLight(a: Uint8Array, b: Uint8Array, w: number, h: number, rows: ArrayLike<number>, o: SeamLightOptions = SEAM_LIGHT_DEFAULTS): Float32Array {
  const grey = (p: Uint8Array, i: number) => (0.299 * (p[i] as number) + 0.587 * (p[i + 1] as number) + 0.114 * (p[i + 2] as number)) / 255;
  const col = new Float32Array(w).fill(Number.NaN);
  const vals: number[] = [];
  for (let x = 0; x < w; x++) {
    vals.length = 0;
    const ys = Math.round(rows[x] as number);
    for (let dy = -o.halfRows; dy <= o.halfRows; dy++) {
      const y = ys + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -o.halfCols; dx <= o.halfCols; dx++) {
        const p = (y * w + ((((x + dx) % w) + w) % w)) * 4;
        if ((a[p + 3] as number) < 128 || (b[p + 3] as number) < 128) continue;
        const va = grey(a, p);
        const vb = grey(b, p);
        if (va < o.dark || vb < o.dark) continue;
        const v = o.gamma * Math.log(va / vb);
        if (Math.abs(v) <= o.agree) vals.push(v);
      }
    }
    if (vals.length < o.minPairs) continue;
    vals.sort((p, q) => p - q);
    const m = vals.length >> 1;
    col[x] = vals.length % 2 ? (vals[m] as number) : ((vals[m - 1] as number) + (vals[m] as number)) / 2;
  }
  // The columns with nothing to go on, from the nearest either side that had something.
  const known: number[] = [];
  for (let x = 0; x < w; x++) if (!Number.isNaN(col[x] as number)) known.push(x);
  if (known.length === 0) return new Float32Array(w);
  for (let k = 0; k < known.length; k++) {
    const x0 = known[k] as number;
    const x1 = k + 1 < known.length ? (known[k + 1] as number) : (known[0] as number) + w;
    const v0 = col[x0] as number;
    const v1 = col[x1 % w] as number;
    for (let x = x0 + 1; x < x1; x++) col[x % w] = v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
  }
  // Evened along the circle: a box each side, twice.
  let cur = col;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let d = -o.smooth; d <= o.smooth; d++) sum += cur[(((x + d) % w) + w) % w] as number;
      next[x] = sum / (2 * o.smooth + 1);
    }
    cur = next;
  }
  return Float32Array.from(cur, (v) => Math.max(-o.limit, Math.min(o.limit, v)));
}
