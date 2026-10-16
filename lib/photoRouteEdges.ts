/**
 * Upright edges in a levelled photo (2026-10-16, the photo route): where a tap lands, and every
 * other upright edge the photo has.
 *
 *   * `snapToEdge`: a tap on a corner, moved onto the corner's edge to a fraction of a pixel. A strip
 *     of the level image round the tap (mostly above it: the tap is where the corner meets the
 *     ground) is averaged down its height into one profile across, and the strongest step in it
 *     nearest the tap is the edge - the proof's edge profiles (photo-route-proof/scripts/edges.py).
 *   * `uprightEdges`: the photo's vertical line segments (from lib/photoRouteLines.ts), joined where
 *     they lie on one column of the level image, each with its column, its rows and which side is
 *     lighter. The wall edges the route ties across photos come from these.
 */

import { fromLevel, type PhotoCamera, toLevel, pixelToHouse } from "./photoRouteLens";
import type { Gray, Segment } from "./photoRouteLines";

function bilinear(g: Gray, x: number, y: number): number {
  // Pixel centres at +0.5.
  const u = x - 0.5;
  const v = y - 0.5;
  const x0 = Math.max(0, Math.min(g.width - 1, Math.floor(u)));
  const y0 = Math.max(0, Math.min(g.height - 1, Math.floor(v)));
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, u - x0));
  const fy = Math.max(0, Math.min(1, v - y0));
  const a = g.data[y0 * g.width + x0] as number;
  const b = g.data[y0 * g.width + x1] as number;
  const c = g.data[y1 * g.width + x0] as number;
  const d = g.data[y1 * g.width + x1] as number;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

export interface Snapped {
  /** Where the edge is, in the photo's pixels, at the tap's height. */
  x: number;
  y: number;
  /** Its column in the level image: what the bearing is read from. */
  u: number;
  /** How strong the step is, in grey levels; small for a tap on no edge (then it stays where it was tapped). */
  strength: number;
  /** +1 lighter on the right, -1 darker on the right. */
  polarity: 1 | -1;
  /** True when it moved onto an edge; false when none was clear and the tap stands as tapped. */
  onEdge: boolean;
}

/** How far a tap is moved, in pixels of the level image, at most. */
export const SNAP_RADIUS_PX = 14;
/** A step weaker than this (grey levels across a pixel, averaged down the strip) is no edge. */
const MIN_STRENGTH = 3;

/**
 * The tap at (x, y) on the photo moved onto the upright edge nearest it. `above` is how far up the
 * strip reaches from the tap (pixels of the level image); `below`, down.
 */
export function snapToEdge(gray: Gray, cam: PhotoCamera, x: number, y: number, opts: { radius?: number; above?: number; below?: number } = {}): Snapped {
  const R = opts.radius ?? SNAP_RADIUS_PX;
  const above = opts.above ?? 150;
  const below = opts.below ?? 10;
  // The photo may be the grey at another size than the camera's (scaled); read it where it is.
  const sx = gray.width / cam.width;
  const sy = gray.height / cam.height;
  const [u0, v0] = toLevel(cam, x, y);
  const STEP = 0.25;
  const n = Math.round((2 * (R + 2)) / STEP) + 1;
  const prof = new Float64Array(n);
  const rows: number[] = [];
  for (let v = v0 - above; v <= v0 + below; v += 1.5) rows.push(v);
  for (let i = 0; i < n; i++) {
    const u = u0 - (R + 2) + i * STEP;
    let s = 0;
    let m = 0;
    for (const v of rows) {
      const p = fromLevel(cam, u, v);
      if (!p) continue;
      if (p[0] < 0 || p[1] < 0 || p[0] >= cam.width || p[1] >= cam.height) continue;
      s += bilinear(gray, p[0] * sx, p[1] * sy);
      m++;
    }
    prof[i] = m ? s / m : NaN;
  }
  // The step across one pixel, at each quarter pixel.
  const k = Math.round(0.5 / STEP);
  const step = new Float64Array(n);
  for (let i = k; i < n - k; i++) step[i] = (prof[i + k] as number) - (prof[i - k] as number);
  let best = -1;
  let bestScore = 0;
  for (let i = k + 1; i < n - k - 1; i++) {
    const du = -(R + 2) + i * STEP;
    if (Math.abs(du) > R) continue;
    const a = Math.abs(step[i] as number);
    if (!Number.isFinite(a)) continue;
    // A local peak, weighed by nearness to the tap.
    if (a < Math.abs(step[i - 1] as number) || a < Math.abs(step[i + 1] as number)) continue;
    const score = a * Math.exp(-0.5 * (du / (R / 2)) ** 2);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  const strength = best >= 0 ? Math.abs(step[best] as number) : 0;
  if (best < 0 || strength < MIN_STRENGTH) return { x, y, u: u0, strength, polarity: 1, onEdge: false };
  // A parabola through the peak and its neighbours, for the fraction.
  const a = Math.abs(step[best - 1] as number);
  const b = Math.abs(step[best] as number);
  const c = Math.abs(step[best + 1] as number);
  const den = a - 2 * b + c;
  const frac = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  const u = u0 - (R + 2) + (best + frac) * STEP;
  const p = fromLevel(cam, u, v0) ?? [x, y];
  return { x: p[0], y: p[1], u, strength, polarity: (step[best] as number) > 0 ? 1 : -1, onEdge: true };
}

export interface UprightEdge {
  /** Column in the level image. */
  u: number;
  /** Its rows in the level image, top and bottom. */
  vTop: number;
  vBottom: number;
  /** +1 lighter on the right, -1 darker on the right. */
  polarity: 1 | -1;
  /** Total length of the segments that make it, pixels. */
  length: number;
}

/**
 * The photo's upright edges: its vertical segments in the level image, those on one column (within
 * `joinPx`) and overlapping or near in height joined. Polarity is read off the grey either side.
 */
export function uprightEdges(gray: Gray, cam: PhotoCamera, segments: Segment[], opts: { joinPx?: number; minLength?: number } = {}): UprightEdge[] {
  const join = opts.joinPx ?? 1.5;
  const minLength = opts.minLength ?? 40;
  const sx = gray.width / cam.width;
  const sy = gray.height / cam.height;
  const pieces: UprightEdge[] = [];
  for (const s of segments) {
    const a = toLevel(cam, s.x1, s.y1);
    const b = toLevel(cam, s.x2, s.y2);
    const dv = Math.abs(b[1] - a[1]);
    const du = Math.abs(b[0] - a[0]);
    // Upright in the level image: within a degree of a column.
    if (dv < 15 || du > dv * Math.tan(Math.PI / 180)) continue;
    // Its ray must point ahead of the camera.
    if (pixelToHouse(cam, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)[2] === 0) continue;
    const u = (a[0] + b[0]) / 2;
    // Which side is lighter: grey 3 px either side at the middle.
    const vm = (a[1] + b[1]) / 2;
    const L = fromLevel(cam, u - 3, vm);
    const Rr = fromLevel(cam, u + 3, vm);
    const gl = L ? bilinear(gray, L[0] * sx, L[1] * sy) : 0;
    const gr = Rr ? bilinear(gray, Rr[0] * sx, Rr[1] * sy) : 0;
    pieces.push({ u, vTop: Math.min(a[1], b[1]), vBottom: Math.max(a[1], b[1]), polarity: gr >= gl ? 1 : -1, length: dv });
  }
  pieces.sort((p, q) => p.u - q.u);
  const out: UprightEdge[] = [];
  for (const p of pieces) {
    const near = out.find((e) => Math.abs(e.u - p.u) <= join && e.polarity === p.polarity && p.vTop <= e.vBottom + 60 && p.vBottom >= e.vTop - 60);
    if (near) {
      const L = near.length + p.length;
      near.u = (near.u * near.length + p.u * p.length) / L;
      near.vTop = Math.min(near.vTop, p.vTop);
      near.vBottom = Math.max(near.vBottom, p.vBottom);
      near.length = L;
    } else out.push({ ...p });
  }
  return out.filter((e) => e.length >= minLength);
}
