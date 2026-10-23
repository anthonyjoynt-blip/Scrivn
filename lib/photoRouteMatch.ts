/**
 * A detail photo laid exactly on its wall's full photo (2026-10-23, the photo route). The walk round the house takes each
 * wall straight on, then "Take more of this wall": close-ups of its windows, doors and trim. Placed by guessing where the
 * tester stood they pulled the house apart (blind runs 10-22), so since ad25ad1 they size nothing and are only read. Read
 * at their own guessed place, though, an opening off a close-up lands roughly; laid on the wall's full photo it lands at
 * the wall's true scale and place - the full photo is placed by its corners, and a wall is flat, so one homography takes
 * every pixel of the close-up that is on the wall to the full photo's pixel of the same point.
 *
 * Found in code, no taps:
 *
 *   1. Each photo squared up to the wall from its own levelling (lib/photoRouteLens.ts): its vertical and the wall's
 *      level direction say how it is turned to the wall, so up to how far off it stood (a scale) and where (a shift) the
 *      squared close-up IS the squared full photo. Which of the house's four ways the wall faces is the one the photo
 *      looks most squarely at; a photo at 45 degrees tries both.
 *   2. That scale and shift searched for: both made edge images (the gradient's size), the close-up shrunk by each scale
 *      in 6% steps, from a little past 1:1 down till it is too small to find, and correlated over every shift at once (an
 *      FFT, the normalised correlation of Lewis 1995 under the close-up's own mask), each place scored by how far it
 *      stands above the rest at its scale. A camera's eye height is the squared image's level line, and the two were held
 *      within about a storey of each other, which leaves out most false places.
 *   3. Each of the best places made exact: the close-up drawn into the full photo's squared frame as placed, and small
 *      patches of it with edges both ways (a window's corner, the end of a sill, a keystone) found again in the full
 *      photo a few pixels round; the homography that best takes the one to the other (RANSAC, then least squares on the
 *      points that agree), at two finer scales. The levelling's last degree goes in this step.
 *   4. Kept only when enough patches agree, to 2 px of the full photo, the two photos' edges are alike laid one on the
 *      other, and the two squared photos are still nearly the same shape: a false place - on a repeating
 *      wall, or on a porch rail in front of it - has few points that agree, edges unalike or a wrong shape. On the
 *      test house (10-23) no close-up laid on a photo of another wall was kept. A plane parallel to the wall in front
 *      of it (a deck's rail) passes all of these: whether the points are on the wall's face is the caller's to check,
 *      with the wall as measured (scripts/house/match.mjs).
 *
 * Or from taps: 4 or more points the reviewer put on both photos (a window's corners, a trim corner), `matchFromTaps`.
 *
 * What a match gives: `detailSidePhoto` - the close-up as a side's photo, (along, up) of the wall to its pixel, through the
 * full photo's own; so its openings and trim are read at the full photo's scale, and `wallLine` says how long a line on it
 * is on the wall (a measurement entered on the close-up, checked against the tape). A match never sizes anything: the
 * wall's scale is the measure's, from the photos with corners and the tapes.
 *
 * What it can't do, and says so (a tap of 4 points then does it): a tape close-up (a hand-span of plain wall), a wall
 * behind a porch's columns and rail or a deck's glass, a photo into the sun, a full photo that sees the wall only
 * edge-on. Plain TypeScript and pure, as the rest of the route, so it runs in a phone's browser; 5-15 seconds a pair
 * here.
 */

import type { SidePhoto } from "./exterior";
import { distort, undistort, type PhotoCamera } from "./photoRouteLens";
import type { Gray } from "./photoRouteLines";
import { inv3, type Mat3, mulMM, mulMtV, mulMV, symEigen, type Vec3 } from "./photoRouteMath";

// ── 3x3s ─────────────────────────────────────────────────────────────────────────────────────────

/** (x, y) through [h], divided; null behind (w not positive). */
function mapH(h: Mat3, x: number, y: number): [number, number] | null {
  const w = h[6] * x + h[7] * y + h[8];
  if (!(w > 1e-12)) return null;
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Scaled so its last entry is 1 (or, if that is near 0, its largest is 1). */
function normH(h: Mat3): Mat3 {
  const s = Math.abs(h[8]) > 1e-12 ? h[8] : Math.max(...h.map(Math.abs));
  return h.map((v) => v / s) as Mat3;
}

/**
 * The homography taking each src point to its dst point, by the normalised DLT: 4 pairs fix one, more are fitted in least
 * squares. Null when they don't fix one (three in a line).
 */
export function homographyFrom(src: readonly [number, number][], dst: readonly [number, number][]): Mat3 | null {
  const n = Math.min(src.length, dst.length);
  if (n < 4) return null;
  const normOf = (pts: readonly [number, number][]): Mat3 => {
    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i++) {
      mx += (pts[i] as [number, number])[0] / n;
      my += (pts[i] as [number, number])[1] / n;
    }
    let d = 0;
    for (let i = 0; i < n; i++) d += Math.hypot((pts[i] as [number, number])[0] - mx, (pts[i] as [number, number])[1] - my) / n;
    const s = d > 1e-12 ? Math.SQRT2 / d : 1;
    return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
  };
  const Ts = normOf(src);
  const Td = normOf(dst);
  const A = new Float64Array(81);
  for (let i = 0; i < n; i++) {
    const [x, y] = [Ts[0] * (src[i] as [number, number])[0] + Ts[2], Ts[4] * (src[i] as [number, number])[1] + Ts[5]];
    const [u, v] = [Td[0] * (dst[i] as [number, number])[0] + Td[2], Td[4] * (dst[i] as [number, number])[1] + Td[5]];
    const rows = [
      [-x, -y, -1, 0, 0, 0, u * x, u * y, u],
      [0, 0, 0, -x, -y, -1, v * x, v * y, v],
    ];
    for (const r of rows) for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) A[a * 9 + b] = (A[a * 9 + b] as number) + (r[a] as number) * (r[b] as number);
  }
  const { values, vectors } = symEigen(A, 9);
  let k = 0;
  for (let i = 1; i < 9; i++) if ((values[i] as number) < (values[k] as number)) k = i;
  // The second smallest near zero too: the points don't fix one.
  const sorted = [...values].sort((p, q) => p - q);
  if (!((sorted[1] as number) > 1e-9 * Math.max(1, sorted[8] as number))) return null;
  const hn = Array.from({ length: 9 }, (_, i) => vectors[i * 9 + k] as number) as Mat3;
  const TdInv = inv3(Td);
  if (!TdInv) return null;
  const h = mulMM(mulMM(TdInv, hn), Ts);
  if (!h.every(Number.isFinite) || Math.abs(h[8]) < 1e-15) return null;
  return normH(h);
}

// ── Squaring a photo up to a wall ───────────────────────────────────────────────────────────────

/**
 * A way a wall can face, seen from a photo: its outward direction n in the photo's house frame (one of the four level
 * ways, X or Z either sign), the way along it to the right as seen from outside (a), and how squarely the photo looks at
 * it (the cosine of the angle off face-on).
 */
export interface WallFacing {
  n: Vec3;
  a: Vec3;
  facing: number;
}

/** The ways a wall in front of [cam] can face, the squarest first: those under [maxDeg] off face-on. */
export function wallFacings(cam: PhotoCamera, maxDeg = 70): WallFacing[] {
  const fwd = mulMtV(cam.R, [0, 0, 1]);
  const h = Math.hypot(fwd[0], fwd[2]) || 1;
  const out: WallFacing[] = [];
  for (const n of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as Vec3[]) {
    const facing = -(n[0] * fwd[0] + n[2] * fwd[2]) / h;
    if (facing < Math.cos((maxDeg * Math.PI) / 180)) continue;
    let a: Vec3 = [n[2], 0, -n[0]];
    // To the right in the photo is to the right along the wall as seen from outside.
    if (mulMV(cam.R, a)[0] < 0) a = [-a[0], 0, -a[2]];
    out.push({ n, a, facing });
  }
  return out.sort((p, q) => q.facing - p.facing);
}

/**
 * The wall squared up: (s, t, 1) - along to the right and up, in units of the camera's distance from the wall, from the
 * point straight in front of the camera at its eye height - to the photo's pixel as a straight camera puts it.
 */
export function squaringH(cam: PhotoCamera, w: WallFacing): Mat3 {
  const M: Mat3 = [w.a[0], 0, -w.n[0], w.a[1], 1, -w.n[1], w.a[2], 0, -w.n[2]];
  const K: Mat3 = [cam.f, 0, cam.width / 2, 0, cam.f, cam.height / 2, 0, 0, 1];
  return mulMM(K, mulMM(cam.R, M));
}

/** A box of the squared wall, (s, t) as above. */
interface Box {
  s0: number;
  s1: number;
  t0: number;
  t1: number;
}

/**
 * How far off face-on the squared image reaches, along (tan of 58 degrees) and up (50): past that a pixel stretches over
 * many. Up less: a photo at 45 degrees reaches far up and down at its near end, which the coarse search would otherwise
 * spend its pixels on.
 */
const SQUARE_LIMIT = 1.6;
const SQUARE_LIMIT_UP = 1.2;

/** What of the squared wall [h] the photo holds: its border walked back through [h], cut at SQUARE_LIMIT. */
function extentOf(cam: PhotoCamera, h: Mat3): Box | null {
  const inv = inv3(h);
  if (!inv) return null;
  let s0 = Infinity;
  let s1 = -Infinity;
  let t0 = Infinity;
  let t1 = -Infinity;
  const STEPS = 32;
  const { width: W, height: H } = cam;
  for (let k = 0; k <= STEPS; k++) {
    const f = k / STEPS;
    for (const [x, y] of [
      [f * W, 0],
      [f * W, H],
      [0, f * H],
      [W, f * H],
      [f * W, H / 2],
      [W / 2, f * H],
    ] as [number, number][]) {
      const [xu, yu] = undistort(cam, x, y);
      const p = mapH(inv, xu, yu);
      if (!p) continue;
      s0 = Math.min(s0, p[0]);
      s1 = Math.max(s1, p[0]);
      t0 = Math.min(t0, p[1]);
      t1 = Math.max(t1, p[1]);
    }
  }
  const box = { s0: Math.max(s0, -SQUARE_LIMIT), s1: Math.min(s1, SQUARE_LIMIT), t0: Math.max(t0, -SQUARE_LIMIT_UP), t1: Math.min(t1, SQUARE_LIMIT_UP) };
  return box.s1 - box.s0 > 0.05 && box.t1 - box.t0 > 0.05 ? box : null;
}

/** A grey image halved again and again: what a squared image samples from, at the level its pixel spans. */
function pyramidOf(g: Gray): Gray[] {
  const out = [g];
  while (true) {
    const p = out[out.length - 1] as Gray;
    if (Math.min(p.width, p.height) < 64) break;
    const w = p.width >> 1;
    const h = p.height >> 1;
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = 2 * y * p.width + 2 * x;
        d[y * w + x] = 0.25 * ((p.data[o] as number) + (p.data[o + 1] as number) + (p.data[o + p.width] as number) + (p.data[o + p.width + 1] as number));
      }
    }
    out.push({ data: d, width: w, height: h });
  }
  return out;
}

/** A photo to square: its grey (at any size: [scale] is its pixels per camera pixel, as a halved copy), lens and level. */
interface Source {
  pyr: Gray[];
  cam: PhotoCamera;
  scale: number;
}

/** A squared image: pixel (i, j)'s middle is (s0 + (i + 0.5) / ppu, t1 - (j + 0.5) / ppu) of whatever [h] took in. */
interface Squared {
  data: Float32Array;
  mask: Uint8Array;
  width: number;
  height: number;
  s0: number;
  t1: number;
  ppu: number;
}

/**
 * The photo squared through [h] ((s, t) to a straight camera's pixel) over [box] at [ppu] pixels a unit: each pixel read
 * off the level of the photo's pyramid its pixel spans (so a squared image smaller than the photo is not aliased), with
 * the lens's radial term put back.
 */
function render(src: Source, h: Mat3, box: Box, ppu: number): Squared {
  const width = Math.max(1, Math.round((box.s1 - box.s0) * ppu));
  const height = Math.max(1, Math.round((box.t1 - box.t0) * ppu));
  const data = new Float32Array(width * height);
  const mask = new Uint8Array(width * height);
  const { cam, pyr, scale } = src;
  const at = (s: number, t: number): [number, number] | null => {
    const p = mapH(h, s, t);
    if (!p) return null;
    const [x, y] = distort(cam, p[0], p[1]);
    return [x * scale, y * scale];
  };
  for (let j = 0; j < height; j++) {
    const t = box.t1 - (j + 0.5) / ppu;
    let prev = at(box.s0 - 0.5 / ppu, t);
    for (let i = 0; i < width; i++) {
      const p = at(box.s0 + (i + 0.5) / ppu, t);
      if (!p) {
        prev = null;
        continue;
      }
      const span = prev ? Math.hypot(p[0] - prev[0], p[1] - prev[1]) : 1;
      prev = p;
      const level = Math.max(0, Math.min(pyr.length - 1, Math.floor(Math.log2(Math.max(1, span)))));
      const g = pyr[level] as Gray;
      const f = 1 << level;
      const u = (p[0] + 0.5) / f - 0.5;
      const v = (p[1] + 0.5) / f - 0.5;
      if (u < 0 || v < 0 || u > g.width - 1 || v > g.height - 1) continue;
      const x0 = Math.min(g.width - 2, Math.floor(u));
      const y0 = Math.min(g.height - 2, Math.floor(v));
      const fx = u - x0;
      const fy = v - y0;
      const o = y0 * g.width + x0;
      const d = g.data;
      data[j * width + i] = ((d[o] as number) * (1 - fx) + (d[o + 1] as number) * fx) * (1 - fy) + ((d[o + g.width] as number) * (1 - fx) + (d[o + g.width + 1] as number) * fx) * fy;
      mask[j * width + i] = 1;
    }
  }
  return { data, mask, width, height, s0: box.s0, t1: box.t1, ppu };
}

/**
 * Edges of a squared image: the size of its gradient after a light blur, square-rooted (so the sky's edge on a roof does
 * not drown a window's), and nothing within two pixels of where the photo ends (its own border is not an edge on the wall).
 */
function edgesOf(img: Squared): Float32Array {
  const { width: W, height: H, data, mask } = img;
  const tmp = new Float32Array(W * H);
  const bl = new Float32Array(W * H);
  const K = [1, 4, 6, 4, 1];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      let ws = 0;
      for (let k = -2; k <= 2; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= W || !mask[y * W + xx]) continue;
        s += (K[k + 2] as number) * (data[y * W + xx] as number);
        ws += K[k + 2] as number;
      }
      tmp[y * W + x] = ws ? s / ws : 0;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      let ws = 0;
      for (let k = -2; k <= 2; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= H || !mask[yy * W + x]) continue;
        s += (K[k + 2] as number) * (tmp[yy * W + x] as number);
        ws += K[k + 2] as number;
      }
      bl[y * W + x] = ws ? s / ws : 0;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) if (!mask[(y + dy) * W + x + dx]) ok = false;
      if (!ok) continue;
      const gx = (bl[y * W + x + 1] as number) - (bl[y * W + x - 1] as number);
      const gy = (bl[(y + 1) * W + x] as number) - (bl[(y - 1) * W + x] as number);
      out[y * W + x] = Math.sqrt(Math.hypot(gx, gy));
    }
  }
  return out;
}

/** Where an image's edges are valid: its mask less two pixels round. */
function edgeMask(img: Squared): Uint8Array {
  const { width: W, height: H, mask } = img;
  const out = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) if (!mask[(y + dy) * W + x + dx]) ok = false;
      if (ok) out[y * W + x] = 1;
    }
  }
  return out;
}

// ── FFT ──────────────────────────────────────────────────────────────────────────────────────────

const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function tablesFor(n: number) {
  let t = twiddles.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  twiddles.set(n, t);
  return t;
}

/** In place, radix 2; [inverse] without the 1/n. */
function fft1(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  const { cos, sin, rev } = tablesFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i] as number;
    if (j > i) {
      const a = re[i] as number;
      re[i] = re[j] as number;
      re[j] = a;
      const b = im[i] as number;
      im[i] = im[j] as number;
      im[j] = b;
    }
  }
  const sg = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step] as number;
        const s = sg * (sin[k * step] as number);
        const a = i + k;
        const b = a + half;
        const xr = (re[b] as number) * c - (im[b] as number) * s;
        const xi = (re[b] as number) * s + (im[b] as number) * c;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
      }
    }
  }
}

/** 2D, in place, rows of [w] (powers of 2); the inverse divided by w h. */
function fft2(re: Float64Array, im: Float64Array, w: number, h: number, inverse: boolean): void {
  const rr = new Float64Array(w);
  const ri = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    rr.set(re.subarray(y * w, y * w + w));
    ri.set(im.subarray(y * w, y * w + w));
    fft1(rr, ri, inverse);
    re.set(rr, y * w);
    im.set(ri, y * w);
  }
  const cr = new Float64Array(h);
  const ci = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      cr[y] = re[y * w + x] as number;
      ci[y] = im[y * w + x] as number;
    }
    fft1(cr, ci, inverse);
    for (let y = 0; y < h; y++) {
      re[y * w + x] = cr[y] as number;
      im[y * w + x] = ci[y] as number;
    }
  }
  if (inverse) {
    const s = 1 / (w * h);
    for (let i = 0; i < re.length; i++) {
      re[i] = (re[i] as number) * s;
      im[i] = (im[i] as number) * s;
    }
  }
}

const pow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

// ── 2. The scale and shift ───────────────────────────────────────────────────────────────────────

/** A place for the close-up in the full photo's squared frame: (s, t) there = zoom (s, t) here + shift. */
interface Place {
  rho: number;
  ts: number;
  tt: number;
  /** How far its correlation stands above the rest at its scale, in their standard deviations. */
  score: number;
  ncc: number;
  /** Which way each photo was squared. */
  wd: number;
  wf: number;
}

/** The full photo's squared frame at the coarse search's size: its long side this many pixels. */
const COARSE_PX = 256;
/** The scales tried, close-up to full: from a close-up taken from a little further back than the full photo, down, 6% a step. */
const RHO_MAX = 1.5;
const RHO_STEP = 1.06;
/** A close-up smaller than this at a scale, pixels, is too small to find. */
const MIN_TEMPLATE_PX = 20;
/** The two eye heights apart, at most, in the full photo's units (its distance from the wall): a storey at 10 m. */
const EYE_APART = 0.35;
/** Overlap with the full photo, at least, of the close-up placed. */
const MIN_OVERLAP = 0.6;

interface CoarseFull {
  img: Squared;
  e: Float32Array;
  m: Uint8Array;
  NW: number;
  NH: number;
  FF: { re: Float64Array; im: Float64Array };
  FF2: { re: Float64Array; im: Float64Array };
  FM: { re: Float64Array; im: Float64Array };
}

function coarseFull(full: Source, hf: Mat3, box: Box): CoarseFull {
  const P = COARSE_PX / Math.max(box.s1 - box.s0, box.t1 - box.t0);
  const img = render(full, hf, box, P);
  const e = edgesOf(img);
  const m = edgeMask(img);
  const NW = pow2(2 * img.width);
  const NH = pow2(2 * img.height);
  const spec = (f: (i: number) => number) => {
    const re = new Float64Array(NW * NH);
    const im = new Float64Array(NW * NH);
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) re[y * NW + x] = f(y * img.width + x);
    fft2(re, im, NW, NH, false);
    return { re, im };
  };
  return { img, e, m, NW, NH, FF: spec((i) => (m[i] ? (e[i] as number) : 0)), FF2: spec((i) => (m[i] ? (e[i] as number) ** 2 : 0)), FM: spec((i) => m[i] as number) };
}

/**
 * The best places for the close-up at each scale: its edge image correlated with the full photo's over every shift (the
 * normalised correlation under the close-up's mask, by FFT), the eye heights within EYE_APART, MIN_OVERLAP of it on the
 * full photo. A few of the best, well apart.
 */
function coarsePlaces(detail: Source, hd: Mat3, boxD: Box, F: CoarseFull, wd: number, wf: number): Place[] {
  const { img: Fi, NW, NH } = F;
  const P = Fi.ppu;
  const out: Place[] = [];
  for (let rho = RHO_MAX; ; rho /= RHO_STEP) {
    const ppu = rho * P;
    // A "close-up" from about as far as the full photo: its middle only, at most most of the full photo.
    const bw = Math.min(boxD.s1 - boxD.s0, (0.8 * Fi.width) / ppu);
    const bh = Math.min(boxD.t1 - boxD.t0, (0.8 * Fi.height) / ppu);
    const cs = Math.min(boxD.s1 - bw / 2, Math.max(boxD.s0 + bw / 2, 0));
    const ct = Math.min(boxD.t1 - bh / 2, Math.max(boxD.t0 + bh / 2, 0));
    const bx: Box = { s0: cs - bw / 2, s1: cs + bw / 2, t0: ct - bh / 2, t1: ct + bh / 2 };
    const tw = Math.round(bw * ppu);
    const th = Math.round(bh * ppu);
    if (Math.min(tw, th) < MIN_TEMPLATE_PX) break;
    if (tw >= NW / 2 || th >= NH / 2) continue;
    const T = render(detail, hd, bx, ppu);
    const te = edgesOf(T);
    const tm = edgeMask(T);
    let cnt = 0;
    let mean = 0;
    for (let i = 0; i < te.length; i++) {
      if (!tm[i]) continue;
      cnt++;
      mean += te[i] as number;
    }
    // A photo at 45 degrees holds a wedge of its box: enough of it, still.
    if (cnt < 0.25 * T.width * T.height) continue;
    mean /= cnt;
    let norm = 0;
    // The close-up less its mean, and its mask, packed in one transform (both real).
    const re = new Float64Array(NW * NH);
    const im = new Float64Array(NW * NH);
    for (let y = 0; y < T.height; y++) {
      for (let x = 0; x < T.width; x++) {
        const i = y * T.width + x;
        if (!tm[i]) continue;
        const v = (te[i] as number) - mean;
        re[y * NW + x] = v;
        im[y * NW + x] = 1;
        norm += v * v;
      }
    }
    if (!(norm > 1e-9)) continue;
    fft2(re, im, NW, NH, false);
    // Unpacked: T(k) = (Z(k) + conj Z(-k)) / 2, M(k) = (Z(k) - conj Z(-k)) / 2i; then each against the full photo's, as
    // correlations (times the conjugate), packed two to an inverse transform.
    const aRe = new Float64Array(NW * NH);
    const aIm = new Float64Array(NW * NH);
    const bRe = new Float64Array(NW * NH);
    const bIm = new Float64Array(NW * NH);
    for (let ky = 0; ky < NH; ky++) {
      for (let kx = 0; kx < NW; kx++) {
        const i = ky * NW + kx;
        const j = ((NH - ky) % NH) * NW + ((NW - kx) % NW);
        const zr = re[i] as number;
        const zi = im[i] as number;
        const cr = re[j] as number;
        const ci = -(im[j] as number);
        const tRe = (zr + cr) / 2;
        const tIm = (zi + ci) / 2;
        const mRe = (zi - ci) / 2;
        const mIm = -(zr - cr) / 2;
        // X * conj(Y)
        const mul = (xr: number, xi: number, yr: number, yi: number): [number, number] => [xr * yr + xi * yi, xi * yr - xr * yi];
        const [nr, ni] = mul(F.FF.re[i] as number, F.FF.im[i] as number, tRe, tIm);
        const [s1r, s1i] = mul(F.FF.re[i] as number, F.FF.im[i] as number, mRe, mIm);
        const [s2r, s2i] = mul(F.FF2.re[i] as number, F.FF2.im[i] as number, mRe, mIm);
        const [or, oi] = mul(F.FM.re[i] as number, F.FM.im[i] as number, mRe, mIm);
        // num + i S1; S2 + i overlap
        aRe[i] = nr - s1i;
        aIm[i] = ni + s1r;
        bRe[i] = s2r - oi;
        bIm[i] = s2i + or;
      }
    }
    fft2(aRe, aIm, NW, NH, true);
    fft2(bRe, bIm, NW, NH, true);
    // The close-up's eye height (t = 0) in its rows, for the band of shifts down the full photo.
    const j0 = bx.t1 * ppu - 0.5;
    const local: Place[] = [];
    // Each place's correlation over the spread of all of them at this scale: a small close-up correlates well with
    // something almost anywhere, so a raw score favours the smallest scales.
    let n = 0;
    let sum = 0;
    let sum2 = 0;
    for (let pass = 0; pass < 2; pass++) {
      const mean = n ? sum / n : 0;
      const sd = n ? Math.sqrt(Math.max(1e-12, sum2 / n - mean * mean)) : 1;
      for (let oy = -(T.height - 1); oy < Fi.height; oy++) {
        // The full photo's t at the close-up's eye line: the shift up.
        const tt = Fi.t1 - (oy + j0 + 0.5) / P;
        if (Math.abs(tt) > EYE_APART) continue;
        const row = ((oy % NH) + NH) % NH;
        for (let ox = -(T.width - 1); ox < Fi.width; ox++) {
          const i = row * NW + (((ox % NW) + NW) % NW);
          const overlap = (bIm[i] as number) / cnt;
          if (overlap < MIN_OVERLAP) continue;
          const s1 = aIm[i] as number;
          const s2 = bRe[i] as number;
          const v = s2 - (s1 * s1) / cnt;
          if (!(v > 1e-9)) continue;
          const ncc = (aRe[i] as number) / Math.sqrt(norm * v);
          if (pass === 0) {
            n++;
            sum += ncc;
            sum2 += ncc * ncc;
            continue;
          }
          const score = (ncc - mean) / sd;
          if (local.length < 3 || score > (local[local.length - 1] as Place).score) {
            const ts = Fi.s0 + ox / P - rho * bx.s0;
            const pl: Place = { rho, ts, tt, score, ncc, wd, wf };
            // One per neighbourhood: a better one nearby replaces it.
            const near = local.findIndex((q) => Math.abs(q.ts - ts) * P < 6 && Math.abs(q.tt - tt) * P < 6);
            if (near >= 0) {
              if ((local[near] as Place).score < score) local[near] = pl;
            } else local.push(pl);
            local.sort((p, q) => q.score - p.score);
            if (local.length > 3) local.length = 3;
          }
        }
      }
      if (n < 50) break;
    }
    out.push(...local);
  }
  return out.sort((p, q) => q.score - p.score);
}

// ── 3. Made exact ────────────────────────────────────────────────────────────────────────────────

/** A point found in both: the close-up's (as drawn into the full photo's frame) and the full photo's, frame pixels. */
interface Pair {
  w: [number, number];
  f: [number, number];
  ncc: number;
}

const PATCH = 8;

/**
 * The close-up's patches with edges both ways (the smaller eigenvalue of the structure tensor of its edge image, the top
 * of a grid), each found again in the full photo's edge image within [r] pixels: the best normalised correlation,
 * to a part of a pixel by a parabola either way.
 */
function patchPairs(W: Float32Array, Wm: Uint8Array, Fe: Float32Array, Fm: Uint8Array, width: number, height: number, r: number): Pair[] {
  const step = PATCH + 2;
  const cands: { x: number; y: number; q: number }[] = [];
  for (let cy = PATCH + r + 1; cy < height - PATCH - r - 1; cy += step) {
    for (let cx = PATCH + r + 1; cx < width - PATCH - r - 1; cx += step) {
      let ok = true;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let y = cy - PATCH; y <= cy + PATCH && ok; y++) {
        for (let x = cx - PATCH; x <= cx + PATCH; x++) {
          if (!Wm[y * width + x]) {
            ok = false;
            break;
          }
          const gx = (W[y * width + x + 1] as number) - (W[y * width + x - 1] as number);
          const gy = (W[(y + 1) * width + x] as number) - (W[(y - 1) * width + x] as number);
          sxx += gx * gx;
          syy += gy * gy;
          sxy += gx * gy;
        }
      }
      if (!ok) continue;
      const tr = sxx + syy;
      const q = tr / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
      cands.push({ x: cx, y: cy, q });
    }
  }
  if (cands.length === 0) return [];
  cands.sort((a, b) => b.q - a.q);
  const top = cands[0] as { q: number };
  const keep = cands.filter((c, i) => i < 160 && c.q > 0.02 * top.q);
  const n = (2 * PATCH + 1) ** 2;
  const out: Pair[] = [];
  const S = 2 * r + 1;
  const sc = new Float64Array(S * S);
  for (const c of keep) {
    let mw = 0;
    for (let y = -PATCH; y <= PATCH; y++) for (let x = -PATCH; x <= PATCH; x++) mw += W[(c.y + y) * width + c.x + x] as number;
    mw /= n;
    let vw = 0;
    for (let y = -PATCH; y <= PATCH; y++) for (let x = -PATCH; x <= PATCH; x++) vw += ((W[(c.y + y) * width + c.x + x] as number) - mw) ** 2;
    if (!(vw > 1e-9)) continue;
    let best = -2;
    let bx = 0;
    let by = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        let sf = 0;
        let sff = 0;
        let swf = 0;
        let ok = true;
        for (let y = -PATCH; y <= PATCH && ok; y++) {
          const fo = (c.y + dy + y) * width + c.x + dx;
          const wo = (c.y + y) * width + c.x;
          for (let x = -PATCH; x <= PATCH; x++) {
            if (!Fm[fo + x]) {
              ok = false;
              break;
            }
            const f = Fe[fo + x] as number;
            sf += f;
            sff += f * f;
            swf += ((W[wo + x] as number) - mw) * f;
          }
        }
        const vf = sff - (sf * sf) / n;
        const v = ok && vf > 1e-9 ? swf / Math.sqrt(vw * vf) : -2;
        sc[(dy + r) * S + dx + r] = v;
        if (v > best) {
          best = v;
          bx = dx;
          by = dy;
        }
      }
    }
    if (best < 0.5 || Math.abs(bx) === r || Math.abs(by) === r) continue;
    // A second peak nearly as good, away from the first: a repeat (a row of balusters), not a place.
    let second = -2;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx - bx), Math.abs(dy - by)) >= 3) second = Math.max(second, sc[(dy + r) * S + dx + r] as number);
    if (second > best - 0.05) continue;
    const at = (dx: number, dy: number) => sc[(dy + r) * S + dx + r] as number;
    const para = (m: number, c0: number, p: number) => {
      const d = m - 2 * c0 + p;
      return d < -1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / d)) : 0;
    };
    const fx = bx + para(at(bx - 1, by), best, at(bx + 1, by));
    const fy = by + para(at(bx, by - 1), best, at(bx, by + 1));
    out.push({ w: [c.x, c.y], f: [c.x + fx, c.y + fy], ncc: best });
  }
  return out;
}

/** A small seeded random, so a match comes out the same every run. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** The scale, turn and shift taking each w to its f, in least squares (two pairs or more). */
function similarityFrom(pairs: readonly Pair[]): Mat3 | null {
  const n = pairs.length;
  if (n < 2) return null;
  let mwx = 0;
  let mwy = 0;
  let mfx = 0;
  let mfy = 0;
  for (const p of pairs) {
    mwx += p.w[0] / n;
    mwy += p.w[1] / n;
    mfx += p.f[0] / n;
    mfy += p.f[1] / n;
  }
  let sa = 0;
  let sb = 0;
  let ww = 0;
  for (const p of pairs) {
    const wx = p.w[0] - mwx;
    const wy = p.w[1] - mwy;
    const fx = p.f[0] - mfx;
    const fy = p.f[1] - mfy;
    sa += wx * fx + wy * fy;
    sb += wx * fy - wy * fx;
    ww += wx * wx + wy * wy;
  }
  if (!(ww > 1e-9)) return null;
  const a = sa / ww;
  const b = sb / ww;
  return [a, -b, mfx - a * mwx + b * mwy, b, a, mfy - b * mwx - a * mwy, 0, 0, 1];
}

/** The affine map taking each w to its f, in least squares (three pairs or more, not in a line). */
function affineFrom(pairs: readonly Pair[]): Mat3 | null {
  if (pairs.length < 3) return null;
  // Normal equations for [x y 1] -> u and -> v.
  const A = new Float64Array(9);
  const bu = [0, 0, 0];
  const bv = [0, 0, 0];
  for (const p of pairs) {
    const r = [p.w[0], p.w[1], 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i * 3 + j] = (A[i * 3 + j] as number) + (r[i] as number) * (r[j] as number);
      bu[i] = (bu[i] as number) + (r[i] as number) * p.f[0];
      bv[i] = (bv[i] as number) + (r[i] as number) * p.f[1];
    }
  }
  const inv = inv3(Array.from(A) as Mat3);
  if (!inv) return null;
  const u = mulMV(inv, bu as Vec3);
  const v = mulMV(inv, bv as Vec3);
  return [u[0], u[1], u[2], v[0], v[1], v[2], 0, 0, 1];
}

/**
 * The map most pairs agree with, within [tol] pixels. Squared up, the two photos differ by little more than a scale and
 * a shift, so the samples are pairs and the model a similarity (a close-up with a dozen points on two windows is found as
 * surely as one with fifty); the agreeing points are then fitted with as much as they can hold - a homography with 12 or
 * more, which takes the levelling's last degree out; an affine map with 6; else the similarity.
 */
function ransacFit(pairs: Pair[], tol: number): { h: Mat3; inliers: Pair[]; rms: number } | null {
  if (pairs.length < 4) return null;
  const rand = rng(pairs.length * 7919 + 17);
  const err = (h: Mat3, p: Pair) => {
    const q = mapH(h, p.w[0], p.w[1]);
    return q ? Math.hypot(q[0] - p.f[0], q[1] - p.f[1]) : Infinity;
  };
  let best: { h: Mat3; n: number } | null = null;
  for (let it = 0; it < 300; it++) {
    const i = Math.floor(rand() * pairs.length);
    const j = Math.floor(rand() * pairs.length);
    if (i === j) continue;
    const pi = pairs[i] as Pair;
    const pj = pairs[j] as Pair;
    if (Math.hypot(pi.w[0] - pj.w[0], pi.w[1] - pj.w[1]) < 10) continue;
    const h = similarityFrom([pi, pj]);
    if (!h) continue;
    let n = 0;
    for (const p of pairs) if (err(h, p) <= 1.5 * tol) n++;
    if (!best || n > best.n) best = { h, n };
  }
  if (!best || best.n < 4) return null;
  let h = best.h;
  let inl = pairs.filter((p) => err(h, p) <= 1.5 * tol);
  for (let k = 0; k < 4; k++) {
    const h2 = inl.length >= 12 ? homographyFrom(inl.map((p) => p.w), inl.map((p) => p.f)) : inl.length >= 6 ? affineFrom(inl) : similarityFrom(inl);
    if (!h2) break;
    const inl2 = pairs.filter((p) => err(h2, p) <= tol);
    if (inl2.length < 4) break;
    h = h2;
    inl = inl2;
  }
  const rms = Math.sqrt(inl.reduce((s2, p) => s2 + err(h, p) ** 2, 0) / Math.max(1, inl.length));
  return { h, inliers: inl, rms };
}

/**
 * The finer scales a place is made exact at, each this many times the one before (the first, the coarse search's), never
 * finer than the full photo has, searched this far (pixels) and fitted to this tolerance: a coarse pixel's doubt is about
 * 3 at the first.
 */
const REFINE_STEPS: { times: number; r: number; tol: number }[] = [
  { times: 3, r: 8, tol: 2 },
  { times: 3, r: 5, tol: 1.5 },
  { times: 3, r: 3, tol: 1.2 },
];

interface Refined {
  /** Close-up's squared frame (s, t) to the full photo's. */
  hrr: Mat3;
  pairs: number;
  inliers: number;
  rms: number;
  /** The inliers, as (close-up frame, full frame) points. */
  points: { d: [number, number]; f: [number, number] }[];
  /** The edges of the two squared alike over where both are: their normalised correlation at the finest step. */
  ncc: number;
  /** The step it was made exact at (REFINE_STEPS), the last when every step held. */
  step: number;
}

function refinePlace(detail: Source, hd: Mat3, boxD: Box, full: Source, hf: Mat3, boxF: Box, place: Place, coarsePpu: number): Refined | null {
  let hrr: Mat3 = [place.rho, 0, place.ts, 0, place.rho, place.tt, 0, 0, 1];
  let last: Refined | null = null;
  const fullPpu = full.cam.f;
  let ppuWas = coarsePpu;
  for (const [stepAt, step] of REFINE_STEPS.entries()) {
    // The close-up's outline on the full photo's frame, as placed now; cut to the full photo's.
    const pts: [number, number][] = [];
    for (const [s, t] of [
      [boxD.s0, boxD.t0],
      [boxD.s1, boxD.t0],
      [boxD.s0, boxD.t1],
      [boxD.s1, boxD.t1],
      [(boxD.s0 + boxD.s1) / 2, boxD.t0],
      [(boxD.s0 + boxD.s1) / 2, boxD.t1],
    ] as [number, number][]) {
      const p = mapH(hrr, s, t);
      if (p) pts.push(p);
    }
    if (pts.length < 4) return null;
    const box: Box = {
      s0: Math.max(boxF.s0, Math.min(...pts.map((p) => p[0]))),
      s1: Math.min(boxF.s1, Math.max(...pts.map((p) => p[0]))),
      t0: Math.max(boxF.t0, Math.min(...pts.map((p) => p[1]))),
      t1: Math.min(boxF.t1, Math.max(...pts.map((p) => p[1]))),
    };
    if (!(box.s1 - box.s0 > 0.01 && box.t1 - box.t0 > 0.01)) return null;
    // No finer than the full photo has: past that its pixels are only drawn bigger. Nor bigger than 2,000 px across.
    const ppu = Math.min(ppuWas * step.times, fullPpu, 2000 / Math.max(box.s1 - box.s0, box.t1 - box.t0));
    ppuWas = ppu;
    const inv = inv3(hrr);
    if (!inv) return null;
    const F = render(full, hf, box, ppu);
    const D = render(detail, mulMM(hd, inv), box, ppu);
    const Fe = edgesOf(F);
    const Fm = edgeMask(F);
    const De = edgesOf(D);
    const Dm = edgeMask(D);
    const pairs = patchPairs(De, Dm, Fe, Fm, F.width, F.height, step.r);
    const fit = ransacFit(pairs, step.tol);
    if (!fit) return last;
    // Frame pixel to (s, t): its middle.
    const U: Mat3 = [1 / ppu, 0, box.s0 + 0.5 / ppu, 0, -1 / ppu, box.t1 - 0.5 / ppu, 0, 0, 1];
    const Ui = inv3(U) as Mat3;
    hrr = normH(mulMM(mulMM(mulMM(U, fit.h), Ui), hrr));
    // How alike the two are now: the close-up drawn again as placed.
    const inv2 = inv3(hrr);
    if (!inv2) return null;
    const D2 = render(detail, mulMM(hd, inv2), box, ppu);
    const ncc = nccOver(edgesOf(D2), edgeMask(D2), Fe, Fm);
    const toFrame = (p: [number, number]) => [box.s0 + (p[0] + 0.5) / ppu, box.t1 - (p[1] + 0.5) / ppu] as [number, number];
    // The close-up's point: its patch's middle, through the placing it was drawn with; the full photo's where it was found.
    const points = fit.inliers.map((p) => {
      const w = toFrame(p.w);
      return { d: mapH(inv, w[0], w[1]) as [number, number], f: toFrame(p.f) };
    });
    last = { hrr, pairs: pairs.length, inliers: fit.inliers.length, rms: fit.rms * (fullPpu / ppu), points, ncc, step: stepAt };
  }
  return last;
}

function nccOver(a: Float32Array, am: Uint8Array, b: Float32Array, bm: Uint8Array): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i] || !bm[i]) continue;
    n++;
    sa += a[i] as number;
    sb += b[i] as number;
  }
  if (n < 100) return 0;
  const ma = sa / n;
  const mb = sb / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i] || !bm[i]) continue;
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

// ── 4. Kept, or not ──────────────────────────────────────────────────────────────────────────────

/** A match is kept with at least this many points agreeing, this share of those tried, and edges this alike. */
export const MATCH_MIN_POINTS = 8;
export const MATCH_MIN_SHARE = 0.4;
export const MATCH_MIN_NCC = 0.15;
/** And they agree to within this, in the full photo's pixels: a place only the coarse steps hold is not exact. */
export const MATCH_MAX_RMS_PX = 2;
/** Squared both, the two differ only by a scale and a shift: what's left of the levelling, at most - stretched one way more than the other, or turned. */
const MATCH_MAX_STRETCH = 1.12;
const MATCH_MAX_TURN_DEG = 4;
/** Nor did making it exact move its scale far from the search's: a place that wandered was not one. */
const MATCH_MAX_DRIFT = 1.2;

/** A close-up laid on its wall's full photo. */
export interface DetailMatch {
  /** The close-up's pixel to the full photo's, both as a straight camera puts them (the lens's radial term taken out). */
  h: number[];
  by: "code" | "taps";
  /** Code: points tried and points agreeing; taps: the taps. */
  points: number;
  inliers: number;
  /** How far the agreeing points are off the homography, in the full photo's pixels. */
  rmsPx: number;
  /** How alike the two photos' edges are, laid one on the other (-1 to 1). */
  ncc: number;
  /** How much nearer the close-up was taken: its pixels a foot of wall over the full photo's, at its middle. */
  zoom: number;
  /** The agreeing points, in each photo's own pixels (as taken), for a picture of the match. */
  pairs: { d: [number, number]; f: [number, number] }[];
}

export interface MatchResult {
  match: DetailMatch | null;
  /** Why not, in plain words; or how it went. */
  words: string;
  /** Not kept, the place that came nearest (6 points or more agreeing): for a reviewer to look at, never used. */
  nearest?: DetailMatch;
  /** Each place tried, for a look. */
  tried: { rho: number; score: number; ncc0: number; inliers: number; share: number; ncc: number; kept: boolean; why?: string }[];
}

/** A photo to match: its grey (from lib/photoRouteLines.ts grayFrom, at any size) and its lens and level. */
export interface MatchPhoto {
  gray: Gray;
  camera: PhotoCamera | null;
}

function sourceOf(p: MatchPhoto): Source | null {
  if (!p.camera) return null;
  return { pyr: pyramidOf(p.gray), cam: p.camera, scale: p.gray.width / p.camera.width };
}

/** The 2x2 of [h] at (s, t): how it stretches and turns there. */
function shapeAt(h: Mat3, s: number, t: number): { stretch: number; turnDeg: number; scale: number } {
  const e = 1e-4;
  const p = mapH(h, s, t);
  const px = mapH(h, s + e, t);
  const py = mapH(h, s, t + e);
  if (!p || !px || !py) return { stretch: Infinity, turnDeg: 180, scale: 0 };
  const a = (px[0] - p[0]) / e;
  const c = (px[1] - p[1]) / e;
  const b = (py[0] - p[0]) / e;
  const d = (py[1] - p[1]) / e;
  // Singular values of [[a b][c d]].
  const s1 = Math.hypot(a + d, c - b) / 2;
  const s2 = Math.hypot(a - d, c + b) / 2;
  const big = s1 + s2;
  const small = Math.abs(s1 - s2);
  return { stretch: small > 1e-12 ? big / small : Infinity, turnDeg: (Math.atan2(c - b, a + d) * 180) / Math.PI, scale: Math.sqrt(Math.abs(a * d - b * c)) };
}

/**
 * The close-up [detail] laid on [full], the photo of its wall straight on, in code (steps 1-4 above). Null match, with the
 * reason in words, when no place for it holds: a close-up of plain stucco, a tape's numbers held to a window, a photo the
 * levelling could not level.
 */
export function matchDetail(detail: MatchPhoto, full: MatchPhoto, opts: { log?: (words: string) => void } = {}): MatchResult {
  const log = opts.log ?? (() => {});
  const D = sourceOf(detail);
  const F = sourceOf(full);
  if (!D || !F) return { match: null, words: `${!D ? "The close-up" : "The full photo"} could not be levelled (too few straight edges): tap 4 points on both.`, tried: [] };
  const wds = wallFacings(D.cam);
  const wfs = wallFacings(F.cam).slice(0, 2);
  if (wds.length === 0 || wfs.length === 0) return { match: null, words: "No wall faces the camera in one of them.", tried: [] };
  const places: Place[] = [];
  const geo = { d: [] as { h: Mat3; box: Box }[], f: [] as { h: Mat3; box: Box; coarse: CoarseFull }[] };
  wds.forEach((w) => {
    const h = squaringH(D.cam, w);
    const box = extentOf(D.cam, h);
    geo.d.push({ h, box: box ?? { s0: 0, s1: 0, t0: 0, t1: 0 } });
  });
  wfs.forEach((w) => {
    const h = squaringH(F.cam, w);
    const box = extentOf(F.cam, h) ?? { s0: 0, s1: 0, t0: 0, t1: 0 };
    geo.f.push({ h, box, coarse: coarseFull(F, h, box) });
  });
  log(`squared: ${wds.length} way(s) for the close-up, ${wfs.length} for the full photo`);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  log(`boxes: close-up ${geo.d.map((g, i) => `${r2((wds[i] as WallFacing).facing)} [${r2(g.box.s0)}, ${r2(g.box.s1)}] x [${r2(g.box.t0)}, ${r2(g.box.t1)}]`).join("; ")}; full ${geo.f.map((g, i) => `${r2((wfs[i] as WallFacing).facing)} [${r2(g.box.s0)}, ${r2(g.box.s1)}] x [${r2(g.box.t0)}, ${r2(g.box.t1)}] ${g.coarse.img.width}x${g.coarse.img.height}`).join("; ")}`);
  wds.forEach((_, i) => {
    const gd = geo.d[i] as { h: Mat3; box: Box };
    if (gd.box.s1 <= gd.box.s0) return;
    wfs.forEach((__, j) => {
      const gf = geo.f[j] as { h: Mat3; box: Box; coarse: CoarseFull };
      places.push(...coarsePlaces(D, gd.h, gd.box, gf.coarse, i, j).slice(0, 4));
      log(`searched close-up way ${i} against full way ${j}`);
    });
  });
  places.sort((p, q) => q.score - p.score);
  const tried: MatchResult["tried"] = [];
  let best: { r: Refined; place: Place } | null = null;
  let nearest: { r: Refined; place: Place } | null = null;
  for (const place of places.slice(0, 5)) {
    const gd = geo.d[place.wd] as { h: Mat3; box: Box };
    const gf = geo.f[place.wf] as { h: Mat3; box: Box };
    const r = refinePlace(D, gd.h, gd.box, F, gf.h, gf.box, place, (geo.f[place.wf] as { coarse: CoarseFull }).coarse.img.ppu);
    log(`made exact the place at 1:${(1 / place.rho).toFixed(2)} (${place.score.toFixed(1)} sd, correlation ${place.ncc.toFixed(2)})`);
    if (!r) {
      tried.push({ rho: place.rho, score: place.score, ncc0: place.ncc, inliers: 0, share: 0, ncc: 0, kept: false, why: "no points agree" });
      continue;
    }
    // At (0, 0): straight in front of the close-up's camera, its photo's middle.
    const shape = shapeAt(r.hrr, 0, 0);
    const share = r.inliers / Math.max(1, r.pairs);
    const why =
      r.rms > MATCH_MAX_RMS_PX
        ? `its points agree only to ${r.rms.toFixed(1)} px of the full photo`
        : r.inliers < MATCH_MIN_POINTS
        ? `${r.inliers} points agree (${MATCH_MIN_POINTS} wanted)`
        : share < MATCH_MIN_SHARE
          ? `${Math.round(share * 100)}% of the points agree`
          : r.ncc < MATCH_MIN_NCC
            ? `edges only ${r.ncc.toFixed(2)} alike`
            : shape.stretch > MATCH_MAX_STRETCH || Math.abs(shape.turnDeg) > MATCH_MAX_TURN_DEG
              ? `squared, they differ by more than a scale (stretch ${shape.stretch.toFixed(2)}, turn ${shape.turnDeg.toFixed(1)}°)`
              : Math.abs(Math.log(shape.scale / place.rho)) > Math.log(MATCH_MAX_DRIFT)
                ? `made exact, it drifted from 1:${(1 / place.rho).toFixed(2)} to 1:${(1 / shape.scale).toFixed(2)}`
                : null;
    tried.push({ rho: place.rho, score: place.score, ncc0: place.ncc, inliers: r.inliers, share, ncc: r.ncc, kept: !why, ...(why ? { why } : {}) });
    if (!why && (!best || r.inliers * r.ncc > best.r.inliers * best.r.ncc)) best = { r, place };
    if (r.inliers >= 6 && (!nearest || r.inliers * Math.max(0.01, r.ncc) > nearest.r.inliers * Math.max(0.01, nearest.r.ncc))) nearest = { r, place };
  }
  const asMatch = (b: { r: Refined; place: Place }): DetailMatch => {
    const gd = geo.d[b.place.wd] as { h: Mat3; box: Box };
    const gf = geo.f[b.place.wf] as { h: Mat3; box: Box };
    const h = normH(mulMM(mulMM(gf.h, b.r.hrr), inv3(gd.h) as Mat3));
    const toPhoto = (cam: PhotoCamera, hh: Mat3, p: [number, number]): [number, number] => {
      const q = mapH(hh, p[0], p[1]) as [number, number];
      return distort(cam, q[0], q[1]);
    };
    const pairs = b.r.points.map((p) => ({ d: toPhoto(D.cam, gd.h, p.d), f: toPhoto(F.cam, gf.h, p.f) }));
    return { h: [...h], by: "code", points: b.r.pairs, inliers: b.r.inliers, rmsPx: b.r.rms, ncc: b.r.ncc, zoom: zoomOf(h, D.cam), pairs };
  };
  if (!best) {
    const words = places.length ? `No place for it holds (${tried.map((t) => t.why).filter(Boolean)[0] ?? "none tried"}): tap 4 points on both.` : "Not found in the full photo at any scale: tap 4 points on both.";
    return { match: null, words, tried, ...(nearest ? { nearest: asMatch(nearest) } : {}) };
  }
  const m = asMatch(best);
  return { match: m, words: `Laid on its wall: ${m.inliers} of ${m.points} points agree within ${m.rmsPx.toFixed(1)} px, taken ${m.zoom.toFixed(1)}x nearer.`, tried };
}

/** How many of the close-up's pixels to one of the full photo's, at the close-up's middle. */
function zoomOf(h: Mat3, cam: { width: number; height: number }): number {
  const s = shapeAt(h, cam.width / 2, cam.height / 2).scale;
  return s > 0 ? 1 / s : 0;
}

/**
 * The fallback: 4 or more points the reviewer put on both photos (each [close-up x, y, full x, y], in the photos' own
 * pixels as taken) - a window's corners, a trim corner, the ends of a sill. The lens's radial term comes off both first.
 */
export function matchFromTaps(taps: readonly (readonly [number, number, number, number])[], detail: Pick<PhotoCamera, "width" | "height" | "k">, full: Pick<PhotoCamera, "width" | "height" | "k">): DetailMatch | null {
  if (taps.length < 4) return null;
  const src = taps.map((t) => undistort(detail, t[0], t[1]));
  const dst = taps.map((t) => undistort(full, t[2], t[3]));
  const h = homographyFrom(src, dst);
  if (!h) return null;
  const errs = src.map((p, i) => {
    const q = mapH(h, p[0], p[1]);
    return q ? Math.hypot(q[0] - (dst[i] as [number, number])[0], q[1] - (dst[i] as [number, number])[1]) : Infinity;
  });
  const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  return { h: [...h], by: "taps", points: taps.length, inliers: taps.length, rmsPx: rms, ncc: 0, zoom: zoomOf(h, detail), pairs: taps.map((t) => ({ d: [t[0], t[1]], f: [t[2], t[3]] })) };
}

// ── What a match gives ───────────────────────────────────────────────────────────────────────────

/**
 * The close-up as a photo of the side [full] is a photo of: (along, up) of the side to its pixel, through the full photo's
 * own (`to_photo`, then the match backwards). So whatever is read off it - an opening, a sill, a keystone - is at the
 * full photo's scale, which the measure set. Null when the side is behind it or the match has no inverse.
 */
export function detailSidePhoto(full: SidePhoto, m: Pick<DetailMatch, "h">, detail: { width: number; height: number; f?: number; k?: number }, n: number, claimPhotoId: string, lengthM?: number): SidePhoto | null {
  const back = inv3(m.h as Mat3);
  if (!back) return null;
  let toPhoto = mulMM(back, full.toPhoto as Mat3) as number[];
  // Divided through so w is 1, positive, where the close-up's middle shows the side, as sidePhotoFor leaves it.
  const fwd = inv3(toPhoto as Mat3);
  if (!fwd) return null;
  const cx = detail.width / 2;
  const cy = detail.height / 2;
  const q = fwd[6] * cx + fwd[7] * cy + fwd[8];
  const mid = q !== 0 ? [(fwd[0] * cx + fwd[1] * cy + fwd[2]) / q, (fwd[3] * cx + fwd[4] * cy + fwd[5]) / q] : null;
  if (!mid) return null;
  const w = toPhoto[6]! * mid[0]! + toPhoto[7]! * mid[1]! + toPhoto[8]!;
  if (!(Math.abs(w) > 1e-12)) return null;
  toPhoto = toPhoto.map((v) => v / w);
  const f = detail.f ?? full.camera.fx * (detail.width / full.camera.width);
  const camera = { width: detail.width, height: detail.height, fx: f, fy: f, cx, cy, ...(detail.k ? { k: detail.k } : {}) };
  const at = (a: number, u: number) => {
    const ww = toPhoto[6]! * a + toPhoto[7]! * u + toPhoto[8]!;
    return { x: (toPhoto[0]! * a + toPhoto[1]! * u + toPhoto[2]!) / ww, y: (toPhoto[3]! * a + toPhoto[4]! * u + toPhoto[5]!) / ww, w: ww };
  };
  const inPic = (p: { x: number; y: number; w: number }) => p.w > 0 && p.x >= 0 && p.y >= 0 && p.x < detail.width && p.y < detail.height;
  let inView: SidePhoto["inView"] = null;
  if (lengthM && lengthM > 0) {
    let fromM = Infinity;
    let toM = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * lengthM;
      if (inPic(at(a, 0.05))) {
        fromM = Math.min(fromM, a);
        toM = Math.max(toM, a);
      }
    }
    if (Number.isFinite(fromM)) inView = { fromM, toM, leftEnd: inPic(at(0.02, 0.05)), rightEnd: inPic(at(lengthM - 0.02, 0.05)), top: inPic(at(lengthM / 2, 3)) };
  }
  return { n, scanId: null, claimPhotoId, camera, toPhoto, inView };
}

/** A point of a photo (its pixels as taken) on the side it is laid on: (along, up) in metres. */
export function onWall(sp: Pick<SidePhoto, "toPhoto" | "camera">, x: number, y: number): [number, number] | null {
  const inv = inv3(sp.toPhoto as Mat3);
  if (!inv) return null;
  const k = sp.camera.k ?? 0;
  const [xu, yu] = k ? undistort({ width: sp.camera.width, height: sp.camera.height, k }, x, y) : [x, y];
  return mapH(inv, xu, yu);
}

/** A line drawn on a photo laid on a side - a tape's ends - as it lies on the wall: its length and its ends, feet. */
export function wallLine(sp: Pick<SidePhoto, "toPhoto" | "camera">, a: readonly [number, number], b: readonly [number, number]): { feet: number; from: [number, number]; to: [number, number] } | null {
  const p = onWall(sp, a[0], a[1]);
  const q = onWall(sp, b[0], b[1]);
  if (!p || !q) return null;
  const M = 1 / 0.3048;
  return { feet: Math.hypot(q[0] - p[0], q[1] - p[1]) * M, from: [p[0] * M, p[1] * M], to: [q[0] * M, q[1] * M] };
}

/** How far a measurement entered on a close-up may be off what the wall frame makes it, %, before it is worth a look. */
export const DETAIL_CHECK_PCT = 5;

/**
 * A measurement on a close-up checked against the wall (step 3 of the brief): the line it was taped along, through the
 * match, on the wall as the measure scaled it - its length beside the tape's. Never used to size anything.
 */
export function checkOnWall(sp: Pick<SidePhoto, "toPhoto" | "camera">, a: readonly [number, number], b: readonly [number, number], tapedFeet: number): { feet: number; offPct: number; agrees: boolean } | null {
  const l = wallLine(sp, a, b);
  if (!l || !(tapedFeet > 0)) return null;
  const offPct = ((l.feet - tapedFeet) / tapedFeet) * 100;
  return { feet: l.feet, offPct, agrees: Math.abs(offPct) <= DETAIL_CHECK_PCT };
}

export const matchSteps = { squaringH, extentOf, render, edgesOf, edgeMask, pyramidOf, fft2, coarseFull, coarsePlaces, refinePlace, patchPairs, ransacFit, shapeAt };
