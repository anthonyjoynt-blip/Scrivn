/**
 * Straight edges in a photo (2026-10-16, the photo route): the line segments the lens and the
 * levelling are fitted to (lib/photoRouteLens.ts). The proof used OpenCV's LSD; this is the same idea
 * in plain TypeScript, so it runs in a phone's browser with nothing to load:
 *
 *   1. The gradient on LSD's 2x2 stencil, after a light blur, and each pixel's level-line angle (the
 *      edge's direction, with which side is darker kept, so a dark-to-light edge never joins a
 *      light-to-dark one).
 *   2. Pixels taken strongest first; from each, a region grows through its neighbours whose angle is
 *      within 22.5 degrees of the region's.
 *   3. Each region becomes the rectangle round it, along its principal axis; one that does not fill
 *      its rectangle (a curve, a corner) is grown again at half the tolerance, and dropped if it
 *      still does not.
 *
 * LSD's a-contrario test is left out: a minimum length and a filled rectangle do the same job for
 * edges long enough to say where a vanishing point is.
 */

export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

/** A segment, in the image's pixels (centres at +0.5), with its rectangle's width. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

/** RGBA or RGB bytes as grey (0-255), optionally scaled down by an integer factor (a box average). */
export function grayFrom(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number, factor = 1): Gray {
  const f = Math.max(1, Math.floor(factor));
  const w = Math.floor(width / f);
  const h = Math.floor(height / f);
  const out = new Float32Array(w * h);
  const inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * width;
        for (let dx = 0; dx < f; dx++) {
          const o = (row + x * f + dx) * channels;
          s += 0.299 * (data[o] as number) + 0.587 * (data[o + 1] as number) + 0.114 * (data[o + 2] as number);
        }
      }
      out[y * w + x] = s * inv;
    }
  }
  return { data: out, width: w, height: h };
}

function blur(g: Gray, sigma: number): Gray {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] = (k[i] as number) / sum;
  const { width: w, height: h } = g;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += (k[i + r] as number) * (g.data[y * w + Math.min(w - 1, Math.max(0, x + i))] as number);
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += (k[i + r] as number) * (tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] as number);
      out[y * w + x] = s;
    }
  }
  return { data: out, width: w, height: h };
}

const TAU = (22.5 * Math.PI) / 180;
/** LSD's gradient threshold: q / sin(tau) with q = 2 grey levels of quantisation noise. */
const RHO = 2 / Math.sin(TAU);
const NOT_DEFINED = -1000;

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
}

/** The segments of [gray] at least `minLength` pixels long. */
export function lineSegments(gray: Gray, minLength: number, opts: { tauDeg?: number; density?: number; sigma?: number; stats?: Record<string, number> } = {}): Segment[] {
  const tau = ((opts.tauDeg ?? 22.5) * Math.PI) / 180;
  const minDensity = opts.density ?? 0.7;
  const st = opts.stats;
  const g = blur(gray, opts.sigma ?? 0.6);
  const { width: w, height: h } = g;
  const W = w - 1;
  const H = h - 1;
  const ang = new Float32Array(W * H);
  const mag = new Float32Array(W * H);
  let maxMag = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = g.data[y * w + x] as number;
      const b = g.data[y * w + x + 1] as number;
      const c = g.data[(y + 1) * w + x] as number;
      const d = g.data[(y + 1) * w + x + 1] as number;
      const gx = (b + d - a - c) / 2;
      const gy = (c + d - a - b) / 2;
      const m = Math.hypot(gx, gy);
      const i = y * W + x;
      mag[i] = m;
      if (m <= RHO) ang[i] = NOT_DEFINED;
      else {
        // The level line runs at right angles to the gradient; LSD's sign, so polarity is kept.
        ang[i] = Math.atan2(gx, -gy);
        if (m > maxMag) maxMag = m;
      }
    }
  }
  // Strongest first, by 1024 bins of magnitude.
  const BINS = 1024;
  const counts = new Int32Array(BINS + 1);
  const binOf = (m: number) => Math.min(BINS - 1, Math.floor((m / (maxMag || 1)) * BINS));
  for (let i = 0; i < ang.length; i++) if (ang[i] !== NOT_DEFINED) counts[binOf(mag[i] as number) + 1] = (counts[binOf(mag[i] as number) + 1] as number) + 1;
  for (let b = 1; b <= BINS; b++) counts[b] = (counts[b] as number) + (counts[b - 1] as number);
  const order = new Int32Array(counts[BINS] as number);
  const fill = Int32Array.from(counts);
  for (let i = 0; i < ang.length; i++) {
    if (ang[i] === NOT_DEFINED) continue;
    const b = binOf(mag[i] as number);
    order[fill[b] as number] = i;
    fill[b] = (fill[b] as number) + 1;
  }
  const used = new Uint8Array(W * H);
  const regX = new Int32Array(W * H);
  const regY = new Int32Array(W * H);
  const out: Segment[] = [];
  const minRegion = Math.max(8, Math.round(minLength * 0.8));

  const grow = (seed: number, tol: number, mark: number): { n: number; angle: number } => {
    let n = 0;
    const sx = seed % W;
    const sy = (seed - sx) / W;
    regX[0] = sx;
    regY[0] = sy;
    n = 1;
    used[seed] = mark;
    let regAngle = ang[seed] as number;
    let sumC = Math.cos(regAngle);
    let sumS = Math.sin(regAngle);
    for (let k = 0; k < n; k++) {
      const px = regX[k] as number;
      const py = regY[k] as number;
      for (let yy = py - 1; yy <= py + 1; yy++) {
        if (yy < 0 || yy >= H) continue;
        for (let xx = px - 1; xx <= px + 1; xx++) {
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (used[j] || ang[j] === NOT_DEFINED) continue;
          if (angleDiff(ang[j] as number, regAngle) > tol) continue;
          used[j] = mark;
          regX[n] = xx;
          regY[n] = yy;
          n++;
          sumC += Math.cos(ang[j] as number);
          sumS += Math.sin(ang[j] as number);
          regAngle = Math.atan2(sumS, sumC);
        }
      }
    }
    return { n, angle: regAngle };
  };
  const rect = (n: number, regAngle: number) => {
    let sw = 0;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < n; k++) {
      const m = mag[(regY[k] as number) * W + (regX[k] as number)] as number;
      sw += m;
      cx += m * (regX[k] as number);
      cy += m * (regY[k] as number);
    }
    cx /= sw;
    cy /= sw;
    let Ixx = 0;
    let Iyy = 0;
    let Ixy = 0;
    for (let k = 0; k < n; k++) {
      const m = mag[(regY[k] as number) * W + (regX[k] as number)] as number;
      const dx = (regX[k] as number) - cx;
      const dy = (regY[k] as number) - cy;
      Ixx += m * dy * dy;
      Iyy += m * dx * dx;
      Ixy -= m * dx * dy;
    }
    // LSD's get_theta: the eigenvector of the smaller eigenvalue, turned to agree with the region's angle.
    const lambda = 0.5 * (Ixx + Iyy - Math.sqrt((Ixx - Iyy) * (Ixx - Iyy) + 4 * Ixy * Ixy));
    let theta = Math.abs(Ixx) > Math.abs(Iyy) ? Math.atan2(lambda - Ixx, Ixy) : Math.atan2(Ixy, lambda - Iyy);
    if (angleDiff(theta, regAngle) > tau) theta += Math.PI;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    let l0 = Infinity;
    let l1 = -Infinity;
    let w0 = Infinity;
    let w1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const ex = (regX[k] as number) - cx;
      const ey = (regY[k] as number) - cy;
      const l = ex * dx + ey * dy;
      const ww = -ex * dy + ey * dx;
      if (l < l0) l0 = l;
      if (l > l1) l1 = l;
      if (ww < w0) w0 = ww;
      if (ww > w1) w1 = ww;
    }
    // Pixel (x, y) of the gradient grid stands for the point (x + 1, y + 1) between four image pixels' centres (x + 0.5 ...) plus 0.5.
    const ox = cx + 1;
    const oy = cy + 1;
    return { x1: ox + l0 * dx, y1: oy + l0 * dy, x2: ox + l1 * dx, y2: oy + l1 * dy, width: w1 - w0 + 1, length: l1 - l0 + 1 };
  };
  for (let o = order.length - 1; o >= 0; o--) {
    const seed = order[o] as number;
    if (used[seed]) continue;
    let { n, angle } = grow(seed, tau, 1);
    if (n < minRegion) {
      if (st) st.small = (st.small ?? 0) + 1;
      continue;
    }
    let r = rect(n, angle);
    let density = n / (r.length * r.width);
    if (density < minDensity) {
      if (st) st.refined = (st.refined ?? 0) + 1;
      // Refine: free the region and grow it again, tighter, from its seed.
      for (let k = 0; k < n; k++) used[(regY[k] as number) * W + (regX[k] as number)] = 0;
      ({ n, angle } = grow(seed, tau / 2, 1));
      if (n < minRegion) continue;
      r = rect(n, angle);
      density = n / (r.length * r.width);
      if (density < minDensity) {
        if (st) st.dropped = (st.dropped ?? 0) + 1;
        continue;
      }
    }
    if (r.length < minLength) continue;
    out.push({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, width: r.width });
  }
  return out;
}
