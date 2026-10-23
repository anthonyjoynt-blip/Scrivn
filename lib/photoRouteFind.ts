/**
 * The house's corners on a far-back photo, as edges (2026-10-21, the photo route): every upright edge that could be one, each
 * put on the photo's own sharp edge with its top and foot, so a corner picked from them needs no close-up.
 *
 * A corner of the house is an upright edge that runs the wall's whole height, eave to ground, between two broad surfaces
 * that differ: one wall in sun and one in shade, or the wall and what is behind it. `cornerEdges` finds those in the
 * levelled photo: each row smoothed across with a running median, so a downspout or a thin trim drops out; then the step
 * across each column followed down it, gaps for a rail or a branch allowed; the long ones that reach the eye's height kept;
 * each then moved onto the sharpest edge of the photo itself within 14 px (the smoothing moves a corner beside a downspout
 * by up to the downspout's width).
 *
 * On a test house's far-back photos they hold most of the corners a reviewer placed by hand within 10 px, and most on
 * close-ups of two others - well more than the long-edge letters the house runner offered before. But they hold
 * everything else that runs eave to ground too, dozens a photo: porch and deck posts, garage door
 * trim, pilasters, a neighbour's house. Which of them are corners, and which corner each is, this does not say, and the
 * tries on 10-21 show it can't be said from the photos alone (the hand-over note says more):
 *
 *   * by look: a logistic fit of 20 features of the edge (length, step, what is above it, posts either side, the walls'
 *     directions either side...) trained on one house's photos finds only a few of another's corners in each photo's best few;
 *   * by the shape: each photo placed where the drawn shape's corners land on edges finds one or two in twenty, on the shape
 *     as drawn or as measured from the hand corners - with dozens of edges a photo, any place lands most corners on some edge.
 *
 * So the edges are offered to whoever names the corners (the house runner's lettered candidates), never taken as corners.
 */

import { type PhotoCamera, levelAxes } from "./photoRouteLens";
import type { Gray } from "./photoRouteLines";
import { mulMV, type Vec3 } from "./photoRouteMath";

/** An upright edge in a levelled photo that may be a corner of the house: its column and rows in the level image. */
export interface CornerEdge {
  /** Column in the level image (full size), to a fraction of a pixel. */
  u: number;
  /** Its top and foot, rows of the level image. */
  vTop: number;
  vBottom: number;
  /** +1 lighter on the right, -1 darker on the right (after the thin things are smoothed away). */
  sign: 1 | -1;
  /** Mean step across it, grey levels. */
  step: number;
  /** How much it looks like a corner, 0..1: its length and its step. */
  weight: number;
}

/** A level-image pixel back in the photo, with the axes worked out once (lib/photoRouteLens.ts fromLevel, inlined for speed). */
function levelMapper(cam: PhotoCamera): (u: number, v: number) => [number, number] | null {
  const { xl, yl, zl } = levelAxes(cam);
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  const W2 = cam.width * cam.width;
  return (u, v) => {
    const a = (u - cx) / cam.f;
    const b = (v - cy) / cam.f;
    const d: Vec3 = [a * xl[0] + b * yl[0] + zl[0], a * xl[1] + b * yl[1] + zl[1], a * xl[2] + b * yl[2] + zl[2]];
    const c = mulMV(cam.R, d);
    if (!(c[2] > 1e-9)) return null;
    const ux = (cam.f * c[0]) / c[2];
    const uy = (cam.f * c[1]) / c[2];
    // distort(): a few fixed-point steps.
    let dx = ux;
    let dy = uy;
    for (let i = 0; i < 4; i++) {
      const s = 1 + (cam.k * (dx * dx + dy * dy)) / W2;
      dx = ux / s;
      dy = uy / s;
    }
    return [cx + dx, cy + dy];
  };
}

function bilinear(g: Gray, x: number, y: number): number {
  const u = x - 0.5;
  const v = y - 0.5;
  const x0 = Math.max(0, Math.min(g.width - 1, Math.floor(u)));
  const y0 = Math.max(0, Math.min(g.height - 1, Math.floor(v)));
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, u - x0));
  const fy = Math.max(0, Math.min(1, v - y0));
  const d = g.data;
  const w = g.width;
  return ((d[y0 * w + x0] as number) * (1 - fx) + (d[y0 * w + x1] as number) * fx) * (1 - fy) + ((d[y1 * w + x0] as number) * (1 - fx) + (d[y1 * w + x1] as number) * fx) * fy;
}

/** The levelled photo at [scale] of its size, grey; NaN outside the photo. */
export function levelGray(gray: Gray, cam: PhotoCamera, scale: number): Gray {
  const W = Math.round(cam.width * scale);
  const H = Math.round(cam.height * scale);
  const out = new Float32Array(W * H).fill(Number.NaN);
  const at = levelMapper(cam);
  const sx = gray.width / cam.width;
  const sy = gray.height / cam.height;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const p = at((u + 0.5) / scale, (v + 0.5) / scale);
      if (!p || p[0] < 0 || p[1] < 0 || p[0] >= cam.width || p[1] >= cam.height) continue;
      out[v * W + u] = bilinear(gray, p[0] * sx, p[1] * sy);
    }
  }
  return { data: out, width: W, height: H };
}

/** Each row smoothed across by a running median of 2r+1: a bar narrower than about r is gone, a broad step kept. */
function rowMedian(L: Gray, r: number): Float32Array {
  const { width: W, height: H, data } = L;
  const out = new Float32Array(W * H).fill(Number.NaN);
  const win: number[] = [];
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      win.length = 0;
      for (let k = -r; k <= r; k++) {
        const uu = u + k;
        if (uu < 0 || uu >= W) continue;
        const g = data[v * W + uu] as number;
        if (Number.isFinite(g)) win.push(g);
      }
      if (win.length <= r) continue;
      win.sort((a, b) => a - b);
      out[v * W + u] = win[win.length >> 1] as number;
    }
  }
  return out;
}

export interface CornerEdgeOptions {
  /** The scale the photo is searched at (half its size by default). */
  scale?: number;
  /** A step weaker than this, grey levels, is no edge. */
  minStep?: number;
}

/**
 * The photo's upright edges that run long between two broad surfaces: a corner of the house is one. Strongest first.
 */
export function cornerEdges(gray: Gray, cam: PhotoCamera, opts: CornerEdgeOptions = {}): CornerEdge[] {
  const S = opts.scale ?? 0.5;
  const T = opts.minStep ?? 7;
  const L = levelGray(gray, cam, S);
  const W = L.width;
  const H = L.height;
  const R = Math.max(3, Math.round(12 * S));
  const M = rowMedian(L, R);
  const w = Math.max(2, Math.round(10 * S));
  const gap = Math.max(4, Math.round(24 * S));
  // The step across each column, on the smoothed rows.
  const D = new Float32Array(W * H);
  for (let v = 0; v < H; v++) {
    for (let u = w + 1; u < W - w - 1; u++) {
      let l = 0;
      let r = 0;
      let ok = true;
      for (let k = 1; k <= w; k++) {
        const a = M[v * W + u - k] as number;
        const b = M[v * W + u + k] as number;
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          ok = false;
          break;
        }
        l += a;
        r += b;
      }
      D[v * W + u] = ok ? (r - l) / w : 0;
    }
  }
  // Each column's longest run of one sign, gaps of a few rows allowed (a rail, a branch across it).
  type Run = { u: number; sign: 1 | -1; vt: number; vb: number; len: number; mean: number };
  const runs: Run[] = [];
  for (let u = w + 1; u < W - w - 1; u++) {
    for (const sign of [1, -1] as const) {
      let best: Run | null = null;
      let start = -1;
      let last = -1;
      let sum = 0;
      let cnt = 0;
      for (let v = 0; v <= H; v++) {
        const d = v < H ? sign * (D[v * W + u] as number) : -1;
        if (d > T) {
          if (start < 0) {
            start = v;
            sum = 0;
            cnt = 0;
          }
          last = v;
          sum += d;
          cnt++;
        } else if (start >= 0 && v - last > gap) {
          const len = last - start + 1;
          if (!best || len * (sum / cnt) > best.len * best.mean) best = { u, sign, vt: start, vb: last, len, mean: sum / cnt };
          start = -1;
        }
      }
      if (best) runs.push(best);
    }
  }
  // A corner's edge reaches the eye's height (every wall crosses it, the camera held at about 5 ft) and is long.
  const cy = H / 2;
  const minLen = 0.05 * H;
  const long = runs.filter((r) => r.len >= minLen && r.vt <= cy && r.vb >= cy - 0.05 * H);
  const strength = (r: Run) => r.len * r.mean;
  const kept = long.filter((r) => !long.some((q) => q !== r && q.sign === r.sign && Math.abs(q.u - r.u) <= Math.max(2, 8 * S) && (strength(q) > strength(r) || (strength(q) === strength(r) && q.u < r.u))));
  const at = levelMapper(cam);
  const out: CornerEdge[] = [];
  for (const r of kept.sort((a, b) => strength(b) - strength(a))) {
    const vTop = r.vt / S;
    const vBottom = (r.vb + 1) / S;
    // Put on the photo's own edge, full size: the smoothing moved it up to a bar's width (a downspout beside the corner).
    const u = sharpEdge(gray, cam, at, (r.u + 0.5) / S, vTop, vBottom);
    if (out.some((e) => Math.abs(e.u - u) < 3)) continue;
    out.push({ u, vTop, vBottom, sign: r.sign, step: r.mean, weight: Math.min(1, r.len / (0.25 * H)) * Math.min(1, r.mean / 20) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** How far a found edge may move onto the photo's own sharp edge, full-size pixels. */
const SHARP_REACH_PX = 14;

/**
 * The column of the sharpest step within reach of [u0], down rows [vTop, vBottom] of the level image, full size: the
 * corner's own edge, not the smoothed one beside a downspout or a post.
 */
function sharpEdge(gray: Gray, cam: PhotoCamera, at: (u: number, v: number) => [number, number] | null, u0: number, vTop: number, vBottom: number): number {
  const STEP = 0.25;
  const reach = SHARP_REACH_PX + 2;
  const n = Math.round((2 * reach) / STEP) + 1;
  const sx = gray.width / cam.width;
  const sy = gray.height / cam.height;
  const rows: number[] = [];
  const dv = Math.max(2, (vBottom - vTop) / 120);
  for (let v = vTop; v <= vBottom; v += dv) rows.push(v);
  const prof = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = u0 - reach + i * STEP;
    let s = 0;
    let m = 0;
    for (const v of rows) {
      const p = at(u, v);
      if (!p || p[0] < 0 || p[1] < 0 || p[0] >= cam.width || p[1] >= cam.height) continue;
      s += bilinear(gray, p[0] * sx, p[1] * sy);
      m++;
    }
    prof[i] = m ? s / m : Number.NaN;
  }
  const k = Math.round(1 / STEP);
  const step = new Float64Array(n);
  for (let i = k; i < n - k; i++) step[i] = (prof[i + k] as number) - (prof[i - k] as number);
  let best = -1;
  let bestScore = 0;
  for (let i = k + 1; i < n - k - 1; i++) {
    const du = -reach + i * STEP;
    if (Math.abs(du) > SHARP_REACH_PX) continue;
    const a = Math.abs(step[i] as number);
    if (!Number.isFinite(a) || a < Math.abs(step[i - 1] as number) || a < Math.abs(step[i + 1] as number)) continue;
    const score = a * Math.exp(-0.5 * (du / SHARP_REACH_PX) ** 2);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0 || Math.abs(step[best] as number) < 6) return u0;
  const a = Math.abs(step[best - 1] as number);
  const b = Math.abs(step[best] as number);
  const c = Math.abs(step[best + 1] as number);
  const den = a - 2 * b + c;
  const frac = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return u0 - reach + (best + frac) * STEP;
}

/** For the tests. */
export const findSteps = { levelMapper, rowMedian, sharpEdge };
