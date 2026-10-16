/**
 * A side's photo, squared up to its elevation (2026-10-12, Scan 0.1.151).
 *
 * Scan knows each side's wall face and where the phone stood when it took the side's photo, so it
 * sends, with each photo, the 3x3 `to_photo` that takes a point of the side's elevation - (along,
 * up) in metres, the frame `shapes` and `openings` are in - to the photo's pixel. Square-on and to
 * scale is then only arithmetic: for each pixel of the squared image, its point on the wall, sent
 * through `to_photo`, says where in the photo to look. No straight edges are guessed and no tape is
 * carried round a corner, the two weak steps of the owner's test with photos alone.
 *
 * Pure, so the editor (in a canvas), the trace route and the tests all square a photo the same way:
 * what the estimator confirms behind the elevation is the very image the AI traced.
 */

import type { ExteriorSide, SidePhoto } from "./exterior";

const FEET_PER_METRE = 1 / 0.3048;
/**
 * The squared image's longer edge. The owner's test traced 2400 px images; Claude reads up to 2576
 * px on the long edge before it scales an image down, so its answers stay in this image's pixels.
 */
export const MAX_SQUARED_PX = 2400;
/**
 * Beyond the side's own extent, how far the squared image reaches: a strip of stucco over a deck, the
 * soffit above the wall - and, above it, the roof over the side (4 m since 2026-10-15, was 1.5): a
 * dormer's face on the slope, or an upper floor's wall set back behind a lower roof, for the trace to
 * read (lib/roofPhotoShapes.ts). Never past what the photo holds.
 */
const MARGIN_ALONG_M = 2.5;
const MARGIN_BELOW_M = 0.6;
const MARGIN_ABOVE_M = 4;
/**
 * Over a side the phone has no height for - tapped as its two bottom corners alone, for Finish exterior to
 * read its walls off the photo (2026-10-15) - the squared photo reaches this far above its bottom: two
 * storeys and the roof over them.
 */
const UNMEASURED_ABOVE_M = 9;

/** A 3x3, row by row. */
export type Mat3 = readonly number[];

/** (x, y, 1) through [h]: the homogeneous point, not yet divided. */
export function applyH(h: Mat3, x: number, y: number): { x: number; y: number; w: number } {
  return {
    x: (h[0] as number) * x + (h[1] as number) * y + (h[2] as number),
    y: (h[3] as number) * x + (h[4] as number) * y + (h[5] as number),
    w: (h[6] as number) * x + (h[7] as number) * y + (h[8] as number),
  };
}

type Lens = { camera?: { width: number; cx: number; cy: number; k?: number } };

/**
 * A pixel as the camera saw it, from where a straight (pinhole) camera would have put it: moved out
 * from the middle by the lens's radial term (2026-10-16, the photo route keeps its photos as taken).
 * The inverse of p_u = c + d (1 + k |d|^2 / width^2) by a few fixed-point steps; nothing to do at k = 0,
 * which is every photo Scan sends.
 */
export function lensDistort(photo: Lens, x: number, y: number): { x: number; y: number } {
  const c = photo.camera;
  const k = c?.k;
  if (!c || !k) return { x, y };
  const ux = x - c.cx;
  const uy = y - c.cy;
  let dx = ux;
  let dy = uy;
  for (let i = 0; i < 5; i++) {
    const s = 1 + (k * (dx * dx + dy * dy)) / (c.width * c.width);
    dx = ux / s;
    dy = uy / s;
  }
  return { x: c.cx + dx, y: c.cy + dy };
}

/** The other way: a pixel of the photo as a straight camera would have put it. */
export function lensUndistort(photo: Lens, x: number, y: number): { x: number; y: number } {
  const c = photo.camera;
  const k = c?.k;
  if (!c || !k) return { x, y };
  const dx = x - c.cx;
  const dy = y - c.cy;
  const s = 1 + (k * (dx * dx + dy * dy)) / (c.width * c.width);
  return { x: c.cx + dx * s, y: c.cy + dy * s };
}

/**
 * Where a point of the elevation falls in the photo, in its pixels; null when it is behind the
 * camera. Scan divides `to_photo` through by its last entry, so w is positive in front: its own
 * `SidePhoto.project` reads it the same way. A photo with a radial term (`camera.k`) is read where
 * the lens put the point.
 */
export function projectToPhoto(photo: Pick<SidePhoto, "toPhoto"> & Lens, alongM: number, upM: number): { x: number; y: number } | null {
  const p = applyH(photo.toPhoto, alongM, upM);
  if (!(p.w > 1e-9)) return null;
  return lensDistort(photo, p.x / p.w, p.y / p.w);
}

/** The inverse of a 3x3, or null when it has none. */
export function invert3(m: Mat3): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m as number[] as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/**
 * The point of the elevation a pixel of the photo shows: `to_photo` run backwards. Null when the
 * pixel's ray meets the wall's plane behind the camera - above the wall's horizon, say.
 */
export function photoToElevation(photo: Pick<SidePhoto, "toPhoto"> & Lens, px: number, py: number): { alongM: number; upM: number } | null {
  const inv = invert3(photo.toPhoto);
  if (!inv) return null;
  const u = lensUndistort(photo, px, py);
  const q = applyH(inv, u.x, u.y);
  // Through to_photo, (q.x/q.w, q.y/q.w) comes back as (px, py, 1)/q.w: in front when q.w > 0.
  if (!(q.w > 1e-12)) return null;
  return { alongM: q.x / q.w, upM: q.y / q.w };
}

/**
 * A side's photo laid on a part of that side (2026-10-15: a tall side split at the floor line, the
 * upper storey's part): the same picture, its `to_photo` taking the part's own frame - along from
 * `alongFeet` on the side, up from `upFeet` - so every wall point is still seen at the very pixel it
 * was. What of the part's bottom is in view is the side's, cut to the part; its top is the side's.
 */
export function photoOnPart(photo: SidePhoto, alongFeet: number, upFeet: number, lengthFeet: number, sideFeet: number): SidePhoto {
  const a = alongFeet / FEET_PER_METRE;
  const u = upFeet / FEET_PER_METRE;
  const len = lengthFeet / FEET_PER_METRE;
  const h = photo.toPhoto;
  const at = (i: number) => h[i] as number;
  // (along, up) on the part is (along + a, up + u) on the side: the side's matrix times that shift.
  const toPhoto = [at(0), at(1), at(0) * a + at(1) * u + at(2), at(3), at(4), at(3) * a + at(4) * u + at(5), at(6), at(7), at(6) * a + at(7) * u + at(8)];
  const v = photo.inView;
  const reaches = (x: number) => v !== null && v.fromM <= x + 0.05 && v.toM >= x - 0.05;
  const inView = v
    ? {
        fromM: Math.min(len, Math.max(0, v.fromM - a)),
        toM: Math.min(len, Math.max(0, v.toM - a)),
        // The part's end on the side's own end is in view as that end is; elsewhere, where the side's bottom in view reaches it.
        leftEnd: Math.abs(alongFeet) < 1e-6 ? v.leftEnd : reaches(a),
        rightEnd: Math.abs(alongFeet + lengthFeet - sideFeet) < 1e-6 ? v.rightEnd : reaches(a + len),
        top: v.top,
      }
    : null;
  return { ...photo, toPhoto, inView };
}

/** The squared image: which part of the elevation it holds, and at how many pixels a metre - the same across and up. */
export interface SquareFrame {
  alongMinM: number;
  alongMaxM: number;
  upMinM: number;
  upMaxM: number;
  ppm: number;
  width: number;
  height: number;
}

export const frameX = (f: SquareFrame, alongM: number) => (alongM - f.alongMinM) * f.ppm;
export const frameY = (f: SquareFrame, upM: number) => (f.upMaxM - upM) * f.ppm;
export const frameAlongM = (f: SquareFrame, x: number) => f.alongMinM + x / f.ppm;
export const frameUpM = (f: SquareFrame, y: number) => f.upMaxM - y / f.ppm;

/** How far the side reaches, in metres: its ends, its faces (stucco over a deck runs past the wall), its openings, eaves and peak. */
export function sideExtentM(side: ExteriorSide): { alongMin: number; alongMax: number; upMin: number; upMax: number } {
  const xs = [0, side.lengthFeet];
  const ys = [0, side.baseLeftFeet, side.baseRightFeet];
  if (side.eaveLeftFeet != null) ys.push(side.eaveLeftFeet);
  if (side.eaveRightFeet != null) ys.push(side.eaveRightFeet);
  if (side.gable) ys.push(side.gable.peakFeet);
  for (const s of side.shapes ?? []) {
    xs.push(...s.polygon.map((p) => p.x));
    ys.push(...s.polygon.map((p) => p.y));
  }
  for (const o of side.openings) {
    xs.push(o.fromLeftFeet + o.widthFeet);
    ys.push(o.sillFeet + o.heightFeet);
  }
  const m = (v: number) => v / FEET_PER_METRE;
  return { alongMin: m(Math.min(...xs)), alongMax: m(Math.max(...xs)), upMin: m(Math.min(...ys)), upMax: m(Math.max(...ys)) };
}

/**
 * What of the elevation a photo shows, as a box in metres: its edges walked through `to_photo`
 * backwards. A pixel above the wall's horizon meets the plane behind the camera and is passed over;
 * one just under it lands very far off, which the caller clips.
 */
export function photoCoverageM(photo: SidePhoto): { alongMin: number; alongMax: number; upMin: number; upMax: number } | null {
  const { width: W, height: H } = photo.camera;
  const pts: { alongM: number; upM: number }[] = [];
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    for (const [x, y] of [
      [t * W, 0],
      [t * W, H],
      [0, t * H],
      [W, t * H],
    ] as [number, number][]) {
      const p = photoToElevation(photo, x, y);
      if (p) pts.push(p);
    }
  }
  if (pts.length === 0) return null;
  return {
    alongMin: Math.min(...pts.map((p) => p.alongM)),
    alongMax: Math.max(...pts.map((p) => p.alongM)),
    upMin: Math.min(...pts.map((p) => p.upM)),
    upMax: Math.max(...pts.map((p) => p.upM)),
  };
}

/**
 * The squared image for a side's photos: the side and a margin round it, cut to what the photos
 * hold, at one scale with the longer edge MAX_SQUARED_PX. Null when no photo shows any of it.
 */
export function squareFrame(side: ExteriorSide, photos: SidePhoto[], maxPx: number = MAX_SQUARED_PX): SquareFrame | null {
  const e = sideExtentM(side);
  let alongMin = Infinity;
  let alongMax = -Infinity;
  let upMin = Infinity;
  let upMax = -Infinity;
  for (const photo of photos) {
    const c = photoCoverageM(photo);
    if (!c) continue;
    alongMin = Math.min(alongMin, c.alongMin);
    alongMax = Math.max(alongMax, c.alongMax);
    upMin = Math.min(upMin, c.upMin);
    upMax = Math.max(upMax, c.upMax);
  }
  alongMin = Math.max(alongMin, e.alongMin - MARGIN_ALONG_M);
  alongMax = Math.min(alongMax, e.alongMax + MARGIN_ALONG_M);
  upMin = Math.max(upMin, e.upMin - MARGIN_BELOW_M);
  const measured = side.eaveLeftFeet != null || side.eaveRightFeet != null || side.gable !== null || (side.shapes ?? []).length > 0;
  upMax = Math.min(upMax, measured ? e.upMax + MARGIN_ABOVE_M : e.upMax + UNMEASURED_ABOVE_M);
  if (!(alongMax - alongMin > 0.05 && upMax - upMin > 0.05)) return null;
  const ppm = maxPx / Math.max(alongMax - alongMin, upMax - upMin);
  return {
    alongMinM: alongMin,
    alongMaxM: alongMax,
    upMinM: upMin,
    upMaxM: upMax,
    ppm,
    width: Math.max(1, Math.round((alongMax - alongMin) * ppm)),
    height: Math.max(1, Math.round((upMax - upMin) * ppm)),
  };
}

/** A photo's pixels as decoded: rows top down, 3 or 4 bytes a pixel. Its size may differ from its camera's if it was scaled. */
export interface PhotoPixels {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: 3 | 4;
}

/**
 * The squared image, RGBA, rows top down: each pixel's point on the wall, sent through each photo's
 * `to_photo`, read off that photo bilinearly. Where photos overlap, the one that has the point
 * nearest its middle (the least stretched) is read. Where none has it, the pixel is left clear,
 * alpha 0: the caller says what that is.
 */
export function squareUp(sources: { photo: SidePhoto; pixels: PhotoPixels }[], frame: SquareFrame): Uint8ClampedArray {
  const { width: W, height: H } = frame;
  const out = new Uint8ClampedArray(W * H * 4);
  const srcs = sources.map(({ photo, pixels }) => {
    const sx = pixels.width / photo.camera.width;
    const sy = pixels.height / photo.camera.height;
    // The photo's pixels in the decoded image's: a photo scaled on the way is read where it now is.
    const h = photo.toPhoto as number[];
    return { h, sx, sy, cx: photo.camera.width / 2, cy: photo.camera.height / 2, cw: photo.camera.width, ch: photo.camera.height, px: pixels, lens: photo.camera.k ? photo : null };
  });
  for (let j = 0; j < H; j++) {
    const up = frame.upMaxM - (j + 0.5) / frame.ppm;
    for (let i = 0; i < W; i++) {
      const along = frame.alongMinM + (i + 0.5) / frame.ppm;
      let best = -1;
      let bestScore = Infinity;
      let bx = 0;
      let by = 0;
      for (let k = 0; k < srcs.length; k++) {
        const s = srcs[k] as (typeof srcs)[number];
        const h = s.h;
        const w = (h[6] as number) * along + (h[7] as number) * up + (h[8] as number);
        if (!(w > 1e-9)) continue;
        let x = ((h[0] as number) * along + (h[1] as number) * up + (h[2] as number)) / w;
        let y = ((h[3] as number) * along + (h[4] as number) * up + (h[5] as number)) / w;
        if (s.lens) ({ x, y } = lensDistort(s.lens, x, y));
        if (x < 0 || y < 0 || x >= s.cw || y >= s.ch) continue;
        const dx = (x - s.cx) / s.cw;
        const dy = (y - s.cy) / s.ch;
        const score = dx * dx + dy * dy;
        if (score < bestScore) {
          bestScore = score;
          best = k;
          bx = x;
          by = y;
        }
      }
      if (best < 0) continue;
      const s = srcs[best] as (typeof srcs)[number];
      const o = (j * W + i) * 4;
      sample(s.px, bx * s.sx - 0.5, by * s.sy - 0.5, out, o);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Which of [photos] the squared image shows at (along, up) of the elevation: the one that has the point
 * nearest its middle, as `squareUp` picks - the same sum, kept beside it. -1 when none has it. A roof
 * edge stands out from the wall, so where it shows depends on where the phone stood: this says which
 * phone (2026-10-15, lib/roofPhotoRead.ts).
 */
export function photoIndexAt(photos: readonly Pick<SidePhoto, "toPhoto" | "camera">[], alongM: number, upM: number): number {
  let best = -1;
  let bestScore = Infinity;
  for (let k = 0; k < photos.length; k++) {
    const photo = photos[k] as Pick<SidePhoto, "toPhoto" | "camera">;
    const h = photo.toPhoto as number[];
    const w = (h[6] as number) * alongM + (h[7] as number) * upM + (h[8] as number);
    if (!(w > 1e-9)) continue;
    const { x, y } = lensDistort(photo, ((h[0] as number) * alongM + (h[1] as number) * upM + (h[2] as number)) / w, ((h[3] as number) * alongM + (h[4] as number) * upM + (h[5] as number)) / w);
    const { width: cw, height: ch } = photo.camera;
    if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
    const dx = (x - cw / 2) / cw;
    const dy = (y - ch / 2) / ch;
    const score = dx * dx + dy * dy;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

/** Bilinear, at pixel-centre coordinates (u, v), clamped to the edge. */
function sample(p: PhotoPixels, u: number, v: number, out: Uint8ClampedArray, o: number): void {
  const x0 = Math.max(0, Math.min(p.width - 1, Math.floor(u)));
  const y0 = Math.max(0, Math.min(p.height - 1, Math.floor(v)));
  const x1 = Math.min(p.width - 1, x0 + 1);
  const y1 = Math.min(p.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, u - x0));
  const fy = Math.max(0, Math.min(1, v - y0));
  const c = p.channels;
  const a = (y0 * p.width + x0) * c;
  const b = (y0 * p.width + x1) * c;
  const d = (y1 * p.width + x0) * c;
  const e = (y1 * p.width + x1) * c;
  for (let ch = 0; ch < 3; ch++) {
    const top = (p.data[a + ch] as number) * (1 - fx) + (p.data[b + ch] as number) * fx;
    const bottom = (p.data[d + ch] as number) * (1 - fx) + (p.data[e + ch] as number) * fx;
    out[o + ch] = top * (1 - fy) + bottom * fy;
  }
}

/** The grey that fills what no photo shows, before the squared image is made a JPEG - the trace is told what it means. */
export const OUTSIDE_PHOTO_GREY = 128;

/** Clear pixels filled with OUTSIDE_PHOTO_GREY, for a JPEG, which has no clear. In place. */
export function fillOutside(rgba: Uint8ClampedArray): Uint8ClampedArray {
  for (let o = 0; o < rgba.length; o += 4) {
    if (rgba[o + 3] === 0) {
      rgba[o] = OUTSIDE_PHOTO_GREY;
      rgba[o + 1] = OUTSIDE_PHOTO_GREY;
      rgba[o + 2] = OUTSIDE_PHOTO_GREY;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}
