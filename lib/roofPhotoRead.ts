/**
 * The roof read off a side's photo (2026-10-15): its pitch, how far the roof edge stands out past
 * the wall, and whether the roof over the side is a gable, a hip or an eave - proposals the
 * estimator ticks, as every other part of the AI trace is (lib/exteriorTrace.ts).
 *
 * The owner's test of 10-12 (photo-elevation-test.md, section 4) read his roof at 4.9-5.1 on 12 on
 * both slopes of three square-on gables - he has since measured it at 5/12 - and its rake overhang
 * at 22" from how much bigger the fascia shows than the wall under it. This does the same from every
 * side's photo, and reads the eave overhang where the roof edge ends at a plain corner.
 *
 * ── The wall is to scale; the roof edge is not ────────────────────────────────────────────────
 * The squared image is the wall's plane, square-on and to scale. The fascia stands OUT from the
 * wall, nearer the phone, so it shows bigger, swollen away from the point of the wall straight in
 * front of the phone (its foot): a point o out from a wall the phone stands D from shows at
 *     foot + (where it is - foot) × D / (D - o).
 * Scan says where the phone stood (`wallCamera`, from the photo's own `to_photo`), so the swelling
 * can be measured, and how much it is says how far out the line is.
 *
 *   * PITCH. A line parallel to the wall keeps its slope however far out it stands, so the gable's
 *     two slopes read true off the wall top, and again off the fascia. A gable's two slopes are
 *     alike: when they differ by more than 1/2 in 12, the photo or the peak is off, and the pitch
 *     is not ticked for the estimator. (The test's photo 53° off square read 5.3 and 6.0.)
 *   * RAKE OVERHANG. Under a rake the soffit is level going out from the wall, so the fascia's
 *     bottom edge is the wall top carried out to the fascia, and lowered by however far the fascia
 *     hangs below the soffit. One slope can't tell the two apart; two slopes seen from a phone off
 *     to one side can, because the hang shows differently on each (`rakeFromSlopes`).
 *   * EAVE OVERHANG. At the foot of a rake the roof edge is the eave's fascia: as far past the
 *     wall's corner as the eave overhang, and as far out as the rake overhang. With the rake read,
 *     the swelling is undone and what is left is the eave overhang - best from a phone near that
 *     corner, where an error in the rake hardly moves it (`eaveAtRakeFoot`). A hip's corner is as
 *     far past the end of the wall as it is out from it - one overhang both ways - which fixes it
 *     too, except from a phone on the corner's diagonal (`HIP_CORNER_GAIN_MAX`).
 *
 * ── The trace's lines, set on the photo's own edges ───────────────────────────────────────────
 * Claude places the wall top and the fascia to within 5-25 px of where they are in a 2400 px image
 * (the owner's west gable against the 10-12 hand marks), and the rake overhang is the small gap
 * between the two: 10 px is 2-3". So where the picture is to hand (the editor, which squared it), the
 * lines are moved onto the edges the photo shows (`snapRoof`): the wall top onto the step from wall
 * to soffit along each slope, and the fascia onto the first strong step above the soffit, parallel
 * to the wall top - in the squared image the two are exactly parallel - found in the brightness
 * averaged along the whole rake. The owner's west gable snapped to within 1 px of the hand marks.
 *
 * Assumed: eaves meet rakes square. A side squared from two or three photos is read point by point
 * through the phone the squared image took that point from (`photoIndexAt`).
 *
 * Pure: the route reads the trace with it, the editor snaps it, the tests check it against cameras
 * worked by hand.
 */

import type { SidePhoto } from "./exterior";
import { frameAlongM, frameUpM, frameX, frameY, photoIndexAt, type SquareFrame } from "./exteriorPhoto";
import type { Pt } from "./roof";

const FEET_PER_METRE = 1 / 0.3048;
const INCH_M = 0.0254;

/** A gable's two slopes further apart than this, in 12, are not ticked: the photo or the peak is off. */
export const SLOPES_AGREE_IN_12 = 0.5;
/** Two readings of one overhang further apart than this (3") are said to differ. */
export const OVERHANGS_AGREE_M = 3 * INCH_M;
/** An overhang read outside 0-4 ft is not an overhang: the line was something else. */
const OVERHANG_MAX_M = 1.25;
/** An overhang read under 4" is flagged, not ticked: a roof with soffits stands further out than that, and a trace on the wall's corner reads 0. */
const SMALLEST_OVERHANG_M = 4 * INCH_M;
/** A rake read within this of its peak is left out: the fascia rounds the apex there. */
const NEAR_PEAK_M = 0.3;
/**
 * Metres of overhang per metre the hip corner moves in the squared image: beyond this the phone
 * stood too near the corner's diagonal for its corner to say much.
 */
export const HIP_CORNER_GAIN_MAX = 3;
/** A pitch within this of a whole one, in 12, is that whole one: roofs are framed to whole pitches. */
const WHOLE_PITCH_WITHIN = 0.25;
/**
 * How differently the two slopes must see the fascia's hang (the difference in their height above
 * the phone over its distance, `rakeFromSlopes`) to tell the hang from the overhang. Under it, a phone
 * near the middle of the gable, the fascia is taken as level with the soffit.
 */
const SLOPES_APART_MIN = 0.25;
/** How far a fascia can hang below its soffit: 1/2" above it to 3" below. Outside that, the two-slope read is not believed. */
const HANG_MIN_M = -0.5 * INCH_M;
const HANG_MAX_M = 3 * INCH_M;

// ---------------------------------------------------------------------------------------------
// Where the phone stood
// ---------------------------------------------------------------------------------------------

/** Where the phone stood for a photo: its foot on the wall's plane, in the elevation's metres (along from the left end, up from the side's level), and how far out from the wall. */
export interface WallCamera {
  alongM: number;
  upM: number;
  distanceM: number;
}

/** A point as it shows on the wall's plane, metres. */
export interface Seen {
  alongM: number;
  upM: number;
}

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec) => Math.sqrt(dot(a, a));
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The phone, out of the photo's `to_photo` and its camera. Scan builds `to_photo` as K · [the
 * wall's along, its up, its origin less the phone] in the camera's axes (SidePhoto.homography), over
 * its last entry; K⁻¹ undoes the lens, and the along and up columns, unit in a real camera, give the
 * one scale the matrix was divided by. Null when the columns are not a camera's (not alike, or not
 * square to each other).
 */
export function wallCamera(photo: Pick<SidePhoto, "toPhoto" | "camera">): WallCamera | null {
  const h = photo.toPhoto;
  const { fx, fy, cx, cy } = photo.camera;
  if (h.length !== 9 || !h.every((v) => Number.isFinite(v)) || !(fx > 0) || !(fy > 0)) return null;
  const col = (j: number): Vec => {
    const x = h[j] as number;
    const y = h[3 + j] as number;
    const w = h[6 + j] as number;
    return [(x - cx * w) / fx, (y - cy * w) / fy, w];
  };
  const a = col(0);
  const u = col(1);
  const o = col(2);
  const na = norm(a);
  const nu = norm(u);
  if (!(na > 1e-12 && nu > 1e-12)) return null;
  if (Math.abs(na - nu) / Math.max(na, nu) > 0.02 || Math.abs(dot(a, u)) / (na * nu) > 0.02) return null;
  // Scan's w is positive in front of the phone, so the scale is too.
  const s = 2 / (na + nu);
  const r1: Vec = [a[0] * s, a[1] * s, a[2] * s];
  const r2: Vec = [u[0] * s, u[1] * s, u[2] * s];
  const t: Vec = [o[0] * s, o[1] * s, o[2] * s];
  const distanceM = Math.abs(dot(cross(r1, r2), t));
  if (!(distanceM > 0.2)) return null;
  return { alongM: -dot(r1, t), upM: -dot(r2, t), distanceM };
}

/** Where a point seen at (alongM, upM) on the wall's plane really is, standing [outM] out from the wall: the swelling undone. */
export function unswell(cam: WallCamera, seen: Seen, outM: number): Seen {
  const v = (cam.distanceM - outM) / cam.distanceM;
  return { alongM: cam.alongM + v * (seen.alongM - cam.alongM), upM: cam.upM + v * (seen.upM - cam.upM) };
}

/** Which phone saw a point of the squared image: a function of where the point shows. */
export type CameraAt = (seen: Seen) => WallCamera | null;

/** The phones of a side's photos, in the order the squared image was made from them. */
export function camerasAt(photos: readonly Pick<SidePhoto, "toPhoto" | "camera">[]): CameraAt {
  const cams = photos.map((p) => wallCamera(p));
  return (seen) => {
    const k = photoIndexAt(photos, seen.alongM, seen.upM);
    return k >= 0 ? (cams[k] ?? null) : null;
  };
}

// ---------------------------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------------------------

/**
 * A gable's two runs off the wall top: from the peak out along each side as far as the line runs
 * straight - to the eave corner, past any point the trace put on the way - with each run's slope,
 * rise in 12. [line] left to right, [peak] its index.
 */
export function gableRuns(line: readonly Pt[], peak: number): { from: number; to: number; slopes: [number, number] } | null {
  const p = line[peak];
  if (!p || peak <= 0 || peak >= line.length - 1) return null;
  const run = (step: 1 | -1): { end: number; slope: number } | null => {
    let end = peak + step;
    const first = line[end] as Pt;
    const s0 = (p.y - first.y) / Math.abs(p.x - first.x);
    if (!Number.isFinite(s0) || s0 <= 0) return null;
    for (let i = end + step; i >= 0 && i < line.length; i += step) {
      const q = line[i] as Pt;
      const prev = line[i - step] as Pt;
      const s = (prev.y - q.y) / Math.abs(prev.x - q.x);
      if (!Number.isFinite(s) || Math.abs(s - s0) > Math.max(0.75 / 12, 0.15 * s0)) break;
      end = i;
    }
    const q = line[end] as Pt;
    return { end, slope: ((p.y - q.y) / Math.abs(p.x - q.x)) * 12 };
  };
  const l = run(-1);
  const r = run(1);
  return l && r ? { from: l.end, to: r.end, slopes: [l.slope, r.slope] } : null;
}

/** Each slope of a gable off the wall top, rise in 12, over its whole run (`gableRuns`). */
export function gableSlopes(line: readonly Pt[], peak: number): [number, number] | null {
  return gableRuns(line, peak)?.slopes ?? null;
}

const formatTenth = (v: number) => (Math.round(v * 10) / 10).toString();

/** A pitch as a roof is framed: the whole one within 1/4, else to a tenth. */
export function framedPitch(pitch: number): number {
  const whole = Math.round(pitch);
  return Math.abs(pitch - whole) <= WHOLE_PITCH_WITHIN ? whole : Math.round(pitch * 10) / 10;
}

/** The slope of a straight line through points, rise in 12 (least squares); null with fewer than two or no run. */
function fittedSlope(points: readonly Seen[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const ma = points.reduce((s, p) => s + p.alongM, 0) / n;
  const mu = points.reduce((s, p) => s + p.upM, 0) / n;
  let saa = 0;
  let sau = 0;
  for (const p of points) {
    saa += (p.alongM - ma) ** 2;
    sau += (p.alongM - ma) * (p.upM - mu);
  }
  return saa > 1e-6 ? (sau / saa) * 12 : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

// ---------------------------------------------------------------------------------------------
// Overhangs
// ---------------------------------------------------------------------------------------------

/**
 * How far out a fascia point seen at [seen] stands, taking its bottom edge as level with the soffit:
 * the point is the wall-top line through [at] (metres) at [slope] (rise over run) carried out. Null
 * when the phone is level with the line, where it shows no swelling.
 */
export function outFromLine(cam: WallCamera, seen: Seen, at: Seen, slope: number): number | null {
  // The point is foot + v (seen - foot), v = (D - o) / D, and lies on the line: solve for v.
  const num = at.upM - cam.upM + slope * (cam.alongM - at.alongM);
  const den = seen.upM - cam.upM - slope * (seen.alongM - cam.alongM);
  if (Math.abs(den) < 0.3) return null;
  return cam.distanceM * (1 - num / den);
}

/**
 * The rake overhang from both slopes' fascia, and how far the fascia hangs below the soffit. A point
 * of a slope's fascia, seen at s through a phone D out, is its wall-top line lowered by the hang h
 * and carried out by o:  (1 - o / D) · den + h = num  (den and num as in `outFromLine`) - one line
 * in (o, h) for each slope, the same for every point along it. The two slopes' lines cross at the
 * answer when the phone stood off to one side, where one slope's fascia stands higher above it than
 * the other's; from the middle they are one line, and the hang is taken as none.
 */
export function rakeFromSlopes(
  slopes: { at: Seen; slope: number; points: readonly Seen[] }[],
  cameraAt: CameraAt,
  twoSlopes: boolean,
): { outM: number; perSlope: (number | null)[]; hangM: number | null } | null {
  const rows = slopes.map(({ at, slope, points }) => {
    const level: number[] = [];
    const a: number[] = [];
    const b: number[] = [];
    for (const p of points) {
      const cam = cameraAt(p);
      if (!cam) continue;
      const num = at.upM - cam.upM + slope * (cam.alongM - at.alongM);
      const den = p.upM - cam.upM - slope * (p.alongM - cam.alongM);
      if (Math.abs(den) < 0.3) continue;
      const o = cam.distanceM * (1 - num / den);
      if (!(o > -0.1 && o < OVERHANG_MAX_M)) continue;
      level.push(o);
      a.push(-den / cam.distanceM);
      b.push(num - den);
    }
    return level.length >= 2 ? { level: median(level) as number, a: median(a) as number, b: median(b) as number } : null;
  });
  const perSlope = rows.map((r) => (r ? r.level : null));
  const got = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  if (got.length === 0) return null;
  const levelMean = got.reduce((s, r) => s + r.level, 0) / got.length;
  if (twoSlopes && got.length === 2) {
    const [l, r] = got as [(typeof got)[number], (typeof got)[number]];
    const apart = l.a - r.a;
    if (Math.abs(apart) >= SLOPES_APART_MIN) {
      const outM = (l.b - r.b) / apart;
      const hangM = l.b - l.a * outM;
      if (outM >= 0 && outM < OVERHANG_MAX_M && hangM >= HANG_MIN_M && hangM <= HANG_MAX_M) return { outM, perSlope, hangM };
    }
  }
  return { outM: Math.max(0, levelMean), perSlope, hangM: null };
}

/** The eave overhang at a rake's foot seen at [seen], the rake [rakeOutM] out: past the wall's left end (0) or right end ([lengthM]). */
export function eaveAtRakeFoot(cam: WallCamera, seen: Seen, rakeOutM: number, end: "left" | "right", lengthM: number): number {
  const at = unswell(cam, seen, rakeOutM);
  return end === "left" ? -at.alongM : at.alongM - lengthM;
}

/** How much an error in the rake overhang moves the eave read at a foot seen at [seen]: none from a phone straight out from the foot. */
export function rakeFootGain(cam: WallCamera, seen: Seen): number {
  return Math.abs(seen.alongM - cam.alongM) / cam.distanceM;
}

/**
 * The eave overhang at a hip's corner seen at [seen]: as far past the end of the wall as out from
 * it. Also how many metres of overhang a metre of the corner's place is worth (`HIP_CORNER_GAIN_MAX`).
 */
export function eaveAtHipCorner(cam: WallCamera, seen: Seen, end: "left" | "right", lengthM: number): { outM: number; gain: number } | null {
  const D = cam.distanceM;
  const c = cam.alongM;
  const x = seen.alongM;
  // Right end: x = c + D (L + o - c) / (D - o)  ->  o = D (x - L) / (D + x - c). Left, mirrored.
  const den = end === "right" ? D + x - c : D - x + c;
  // Seen exactly down the diagonal: nothing to read.
  if (!(Math.abs(den) > 1e-6)) return Number.isFinite(den) ? { outM: Number.NaN, gain: Infinity } : null;
  const outM = end === "right" ? (D * (x - lengthM)) / den : (-x * D) / den;
  // How far the corner moves in the image per metre of overhang: D (D + L - c) / (D - o)² on the right,
  // D (D + c) / (D - o)² on the left - nothing at all from the corner's diagonal, where the sum above is 0 / 0.
  const moves = Math.abs(end === "right" ? D * (D + lengthM - c) : D * (D + c)) / (D - outM) ** 2;
  return { outM, gain: moves > 1e-9 ? 1 / moves : Infinity };
}

// ---------------------------------------------------------------------------------------------
// The lines, set on the photo's own edges
// ---------------------------------------------------------------------------------------------

/** A picture's brightness, one value a pixel, rows top down. */
export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

/** The brightness of RGB or RGBA pixels (Rec. 601 weights). */
export function grayOf(pixels: { data: ArrayLike<number>; width: number; height: number; channels: 3 | 4 }): Gray {
  const { width, height, channels } = pixels;
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    data[i] = 0.299 * (pixels.data[o] as number) + 0.587 * (pixels.data[o + 1] as number) + 0.114 * (pixels.data[o + 2] as number);
  }
  return { data, width, height };
}

function sampleGray(g: Gray, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(g.width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(g.height - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const i = y0 * g.width + x0;
  const d = g.data;
  return ((d[i] as number) * (1 - fx) + (d[i + 1] as number) * fx) * (1 - fy) + ((d[i + g.width] as number) * (1 - fx) + (d[i + g.width + 1] as number) * fx) * fy;
}

interface PxPt {
  x: number;
  y: number;
}

/** A straight line in the picture: a point, its direction and its normal up the picture (y down), all unit. */
function frameOf(a: PxPt, b: PxPt): { len: number; dx: number; dy: number; nx: number; ny: number } {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  // (-dy, dx) or its opposite, whichever points up the picture.
  return dx > 0 || (dx === 0 && dy > 0) ? { len, dx, dy, nx: dy, ny: -dx } : { len, dx, dy, nx: -dy, ny: dx };
}

/**
 * A line the trace drew from [a] to [b] (pixels), moved onto the photo's own edge beside it: every
 * few pixels along it, the strongest step in brightness within [reach] either side - lighter above
 * ([sign] 1) or darker above (-1) - then a straight line fitted, points off it by more than 2 px
 * dropped and fitted again. Null when the photo shows no such edge along most of it.
 */
export function snapSegment(g: Gray, a: PxPt, b: PxPt, reach = 16, sign: 1 | -1 = 1): { a: PxPt; b: PxPt; moved: number; strength: number; count: number } | null {
  const { len, dx, dy, nx, ny } = frameOf(a, b);
  if (!(len > 30)) return null;
  const found: { t: number; s: number; w: number }[] = [];
  for (let t = 10; t <= len - 10; t += 4) {
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    // The profile across the line, averaged over 3 px along it to quiet the stucco's grain.
    const prof: number[] = [];
    for (let s = -reach - 2; s <= reach + 2; s++) {
      let v = 0;
      for (const u of [-1.5, 0, 1.5]) v += sampleGray(g, px + nx * s + dx * u, py + ny * s + dy * u);
      prof.push(v / 3);
    }
    let best = -1;
    let bestG = 0;
    for (let k = 2; k < prof.length - 2; k++) {
      const grad = sign * ((prof[k + 1] as number) + (prof[k + 2] as number) - (prof[k - 1] as number) - (prof[k - 2] as number));
      if (grad > bestG) {
        bestG = grad;
        best = k;
      }
    }
    if (best < 3 || best > prof.length - 4) continue;
    // To a fraction of a pixel: the steepest point of the step, by a parabola through its neighbours.
    const gAt = (k: number) => sign * ((prof[k + 1] as number) - (prof[k - 1] as number));
    const g0 = gAt(best - 1);
    const g1 = gAt(best);
    const g2 = gAt(best + 1);
    const den = g0 - 2 * g1 + g2;
    const frac = Math.abs(den) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (g0 - g2)) / den)) : 0;
    found.push({ t, s: best - reach - 2 + frac, w: bestG });
  }
  const steps = Math.floor((len - 20) / 4) + 1;
  if (found.length < Math.max(4, steps * 0.5)) return null;
  // Weak steps are the stucco's or the soffit's grain, not the edge.
  const strong = [...found].sort((p, q) => q.w - p.w);
  const cut = (strong[Math.floor(strong.length / 2)]?.w ?? 0) * 0.35;
  let pts = found.filter((p) => p.w >= cut);
  const fit = (ps: typeof pts) => {
    const n = ps.length;
    const mt = ps.reduce((sum, p) => sum + p.t, 0) / n;
    const ms = ps.reduce((sum, p) => sum + p.s, 0) / n;
    let stt = 0;
    let sts = 0;
    for (const p of ps) {
      stt += (p.t - mt) ** 2;
      sts += (p.t - mt) * (p.s - ms);
    }
    const k = stt > 1e-9 ? sts / stt : 0;
    return (t: number) => ms + k * (t - mt);
  };
  let line = fit(pts);
  pts = pts.filter((p) => Math.abs(p.s - line(p.t)) <= 2);
  if (pts.length < Math.max(4, steps * 0.4)) return null;
  line = fit(pts);
  const s0 = line(0);
  const s1 = line(len);
  return {
    a: { x: a.x + nx * s0, y: a.y + ny * s0 },
    b: { x: b.x + nx * s1, y: b.y + ny * s1 },
    moved: (Math.abs(s0) + Math.abs(s1)) / 2,
    strength: pts.reduce((sum, p) => sum + p.w, 0) / pts.length,
    count: pts.length,
  };
}

/** `snapSegment` either way round - lighter or darker above - whichever finds the steadier edge. */
export function snapEdge(g: Gray, a: PxPt, b: PxPt, reach = 16): { a: PxPt; b: PxPt; moved: number } | null {
  const up = snapSegment(g, a, b, reach, 1);
  const down = snapSegment(g, a, b, reach, -1);
  if (!up || !down) return up ?? down;
  return up.count * up.strength >= down.count * down.strength ? up : down;
}

/**
 * Where the fascia's bottom edge is, as an offset (pixels, up the picture) from the snapped wall-top
 * line [a]→[b]: in the brightness averaged along the run (between [from] and [to], fractions of it,
 * at the points [keep] allows, judged [near] above the run), the first strong step above the wall
 * top - the soffit, looked at from below, is one even band from the wall out to the fascia, and the
 * fascia's own top edge and the shingles come after its bottom edge. Up to [upTo] px: past the trace's
 * own fascia line, which Claude puts on the fascia's face. Null when the photo shows no step there.
 */
export function fasciaOffset(g: Gray, a: PxPt, b: PxPt, near: number, upTo: number, from = 0.2, to = 0.85, keep: (p: PxPt) => boolean = () => true): number | null {
  const { len, dx, dy, nx, ny } = frameOf(a, b);
  // Clear of the wall-to-soffit step itself, whose spill reaches a few pixels.
  const lo = 6;
  const hi = Math.max(lo + 8, Math.round(upTo));
  const ts: number[] = [];
  for (let t = from * len; t <= to * len; t += 3) {
    const p = { x: a.x + dx * t + nx * near, y: a.y + dy * t + ny * near };
    if (p.x >= 0 && p.y >= 0 && p.x < g.width && p.y < g.height && keep(p)) ts.push(t);
  }
  if (ts.length < 10) return null;
  const prof: number[] = [];
  for (let s = lo - 2; s <= hi + 2; s++) {
    let v = 0;
    for (const t of ts) v += sampleGray(g, a.x + dx * t + nx * s, a.y + dy * t + ny * s);
    prof.push(v / ts.length);
  }
  const at = (s: number) => prof[s - (lo - 2)] as number;
  const step = (s: number) => at(s + 1) - at(s - 1);
  let max = 0;
  for (let s = lo; s <= hi; s++) max = Math.max(max, Math.abs(step(s)));
  // A step of 12 levels over two pixels at the least: a fascia against its soffit is many times that.
  if (max < 12) return null;
  let best: number | null = null;
  for (let s = lo; s <= hi && best === null; s++) {
    const here = Math.abs(step(s));
    if (here >= 0.5 * max && here >= Math.abs(step(s - 1)) && here >= Math.abs(step(s + 1))) best = s;
  }
  if (best === null) return null;
  // To a fraction of a pixel.
  const g0 = Math.abs(step(best - 1));
  const g1 = Math.abs(step(best));
  const g2 = Math.abs(step(best + 1));
  const den = g0 - 2 * g1 + g2;
  return best + (Math.abs(den) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (g0 - g2)) / den)) : 0);
}

// ---------------------------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------------------------

/** What the trace said the roof does over the wall. */
export type RoofOverWall = "gable" | "hip_end" | "eave" | "none" | "unclear";
/** What the roof edge does at an end of the wall, as the trace saw it. */
export type RoofEdgeEnd = "rake_foot" | "hip_corner" | "eave_into_rake" | "runs_on" | "against_wall" | "hidden" | "out_of_photo";

export const ROOF_OVER_WALL: RoofOverWall[] = ["gable", "hip_end", "eave", "none", "unclear"];
export const ROOF_EDGE_ENDS: RoofEdgeEnd[] = ["rake_foot", "hip_corner", "eave_into_rake", "runs_on", "against_wall", "hidden", "out_of_photo"];

/** The roof part of the trace's answer, in the squared image's pixels. */
export interface RoofWire {
  over_wall: string;
  rake_left: number[][];
  rake_right: number[][];
  eave_line: number[][];
  left_end: { kind: string; point: number[] };
  right_end: { kind: string; point: number[] };
  notes: string;
}

/** The roof's lines as they show on the wall's plane, metres: what the read works from. */
export interface RoofLines {
  said: RoofOverWall;
  rakeLeft: Seen[];
  rakeRight: Seen[];
  eave: Seen[];
  leftEnd: { kind: RoofEdgeEnd; point: Seen | null };
  rightEnd: { kind: RoofEdgeEnd; point: Seen | null };
  notes: string;
}

/** The wall top the trace gave, in the side's feet: its line and its peak, if it has one. */
export interface WallTopForRoof {
  line: Pt[];
  peakIndex: number;
}

export interface ProposedRoof {
  /** What the trace said the roof does over this side, in its words. */
  said: RoofOverWall;
  /** What the roof does over this side: a gable, a hip end, an eave; null when the photo can't say. */
  over: "gable" | "hip" | "eave" | null;
  pitch: {
    /** As a roof is framed (`framedPitch`); `read` is the mean of the two slopes. */
    value: number;
    read: number;
    slopes: [number, number];
    /** The same two slopes off the fascia as Claude traced it, a second look; null where it was not traced. */
    fascia: [number | null, number | null] | null;
    /** Both slopes within 1/2 in 12 of each other. */
    agree: boolean;
    /** Within 1/4 of a whole pitch, as roofs are framed. With `agree`, ticked to start with. */
    onWhole: boolean;
  } | null;
  rakeOverhang: {
    feet: number;
    /** Each slope's read with the fascia taken as level with the soffit. */
    perSlope: [number | null, number | null];
    /** How far the fascia hangs below the soffit, feet, when the two slopes could tell; null when taken as none. */
    hangFeet: number | null;
    agree: boolean;
  } | null;
  eaveOverhang: { feet: number; left: number | null; right: number | null; from: "rake_foot" | "hip_corner"; agree: boolean } | null;
  /** The roof edge as traced, where it shows (not to scale - it stands out from the wall), in the side's feet: for the drawing. */
  lines: { rakeLeft: Pt[]; rakeRight: Pt[]; eave: Pt[]; leftEnd: Pt | null; rightEnd: Pt | null };
  ends: { left: RoofEdgeEnd; right: RoofEdgeEnd };
  /** The lines were set on the photo's own edges (`snapRoof`), and how far that moved them, inches. */
  snapped: { wallTopInches: number; fasciaInches: number | null } | null;
  /** What the estimator should know before ticking any of it. */
  checks: string[];
  /** The trace's own words on the roof. */
  notes: string;
}

const inches = (m: number) => `${Math.round(m / INCH_M)}"`;

/** The roof part of the trace's answer, out of its pixels into the wall's metres. Absent (a trace before 2026-10-15): no lines. */
export function linesOfWire(wire: RoofWire | null | undefined, frame: SquareFrame): RoofLines {
  const toM = (p: unknown): Seen | null => {
    if (!Array.isArray(p) || p.length < 2) return null;
    const [x, y] = p as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { alongM: frameAlongM(frame, x), upM: frameUpM(frame, y) };
  };
  const line = (pts: unknown) => (Array.isArray(pts) ? pts.map(toM).filter((p): p is Seen => p !== null) : []);
  const endOf = (e: RoofWire["left_end"] | undefined) => ({
    kind: (ROOF_EDGE_ENDS as string[]).includes(String(e?.kind)) ? (e?.kind as RoofEdgeEnd) : ("hidden" as const),
    point: toM(e?.point),
  });
  return {
    said: (ROOF_OVER_WALL as string[]).includes(String(wire?.over_wall)) ? (wire?.over_wall as RoofOverWall) : "unclear",
    rakeLeft: line(wire?.rake_left),
    rakeRight: line(wire?.rake_right),
    eave: line(wire?.eave_line),
    leftEnd: endOf(wire?.left_end),
    rightEnd: endOf(wire?.right_end),
    notes: String(wire?.notes ?? "").trim(),
  };
}

/**
 * The roof part of a trace, read: [wire] in the squared image's pixels, [frame] the image, the side
 * [lengthM] long, [wallTop] the wall top as the trace gave it (feet), [cameraAt] the phone behind
 * each point (null when the photos' phones are not known - a pitch is still read, no overhang is).
 */
export function readRoof(wire: RoofWire | null | undefined, frame: SquareFrame, lengthM: number, wallTop: WallTopForRoof | null, cameraAt: CameraAt | null): ProposedRoof | null {
  // A trace from before 2026-10-15 has no roof: its wall top still gives the pitch.
  if (!wire && !wallTop) return null;
  return readRoofLines(linesOfWire(wire, frame), lengthM, wallTop, cameraAt, null);
}

/** The read itself, off the lines in metres; [snapped] says they were set on the photo's edges, and how far that moved them. */
export function readRoofLines(lines: RoofLines, lengthM: number, wallTop: WallTopForRoof | null, cameraAt: CameraAt | null, snapped: ProposedRoof["snapped"], traced: Pick<RoofLines, "rakeLeft" | "rakeRight"> = lines): ProposedRoof {
  const feet = (p: Seen): Pt => ({ x: p.alongM * FEET_PER_METRE, y: p.upM * FEET_PER_METRE });
  const { rakeLeft, rakeRight, leftEnd, rightEnd } = lines;
  const checks: string[] = [];

  // The wall top's peak, in metres, and each slope's rise over run.
  const peakPt = wallTop && wallTop.peakIndex > 0 ? (wallTop.line[wallTop.peakIndex] ?? null) : null;
  const slopes = wallTop && peakPt ? gableSlopes(wallTop.line, wallTop.peakIndex) : null;

  // What the roof does over the wall: the trace's word, borne out by the wall top.
  const said = lines.said;
  let over: ProposedRoof["over"] = null;
  if (said === "gable") {
    if (slopes) over = "gable";
    else checks.push("The trace calls this a gable, but the wall top it drew has no peak: check the photo before calling it one.");
  } else if (said === "hip_end" || said === "eave") {
    if (slopes) checks.push(`The trace calls the roof over this side ${said === "eave" ? "an eave" : "a hip end"}, but the wall top it drew rises to a peak: check the photo.`);
    else over = said === "eave" ? "eave" : "hip";
  } else if (slopes) {
    // "unclear" or "none", but the wall top rises to a peak: the wall's own shape says gable.
    over = "gable";
  }

  // Pitch: the wall top's two slopes, and the fascia as Claude traced it for a second look.
  let pitch: ProposedRoof["pitch"] = null;
  if (slopes && over === "gable") {
    const [l, r] = slopes;
    const read = (l + r) / 2;
    const fasciaSlope = (pts: Seen[], sign: 1 | -1) => {
      // One phone's points only: across two photos the fascia shows at two swellings.
      const groups = new Map<WallCamera | null, Seen[]>();
      for (const p of pts) {
        const c = cameraAt ? cameraAt(p) : null;
        groups.set(c, [...(groups.get(c) ?? []), p]);
      }
      const most = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
      const s = fittedSlope(most);
      return s === null ? null : sign * s;
    };
    const fl = fasciaSlope(traced.rakeLeft, 1);
    const fr = fasciaSlope(traced.rakeRight, -1);
    const agree = Math.abs(l - r) <= SLOPES_AGREE_IN_12;
    const onWhole = Math.abs(read - Math.round(read)) <= WHOLE_PITCH_WITHIN;
    pitch = { value: framedPitch(read), read, slopes: [l, r], fascia: fl === null && fr === null ? null : [fl, fr], agree, onWhole };
    if (agree && onWhole) checks.push(`Both slopes of the gable read ${l.toFixed(1)} and ${r.toFixed(1)} on 12: ${pitch.value}/12.`);
    else if (agree) {
      checks.push(
        `The gable's slopes read ${l.toFixed(1)} and ${r.toFixed(1)} on 12, ${read.toFixed(1)} between them: roofs are framed to whole pitches, and this falls between ${Math.floor(read)}/12 and ${Math.ceil(read)}/12, so one slope is likely off. Check the photo, or type the pitch; tick it only if this roof really is ${formatTenth(read)}/12.`,
      );
    } else {
      checks.push(
        `The gable's two slopes read ${l.toFixed(1)} and ${r.toFixed(1)} on 12. A gable's are alike, so the photo is off square or the peak is misplaced: take the gable again, straight out from the middle of the wall, or tick the pitch only if this roof's slopes really differ.`,
      );
    }
    const off = [fl !== null ? Math.abs(fl - l) : 0, fr !== null ? Math.abs(fr - r) : 0];
    if (!snapped && Math.max(...off) > SLOPES_AGREE_IN_12) {
      checks.push(`The fascia reads ${fl?.toFixed(1) ?? "-"} and ${fr?.toFixed(1) ?? "-"} on 12 against the wall top's ${l.toFixed(1)} and ${r.toFixed(1)}: one of the two lines is traced off.`);
    }
  }

  // Rake overhang: the fascia against the wall top, both slopes together when they can tell the hang apart.
  let rakeOverhang: ProposedRoof["rakeOverhang"] = null;
  if (slopes && peakPt && over === "gable" && cameraAt) {
    const at = { alongM: peakPt.x / FEET_PER_METRE, upM: peakPt.y / FEET_PER_METRE };
    const away = (pts: Seen[], side: 1 | -1) => {
      const highest = pts.reduce<Seen | null>((m, p) => (m === null || p.upM > m.upM ? p : m), null);
      return pts.filter((p) => !highest || side * (p.alongM - highest.alongM) >= NEAR_PEAK_M);
    };
    // The hang only from snapped lines: off Claude's own lines, a few pixels either way would read as inches of hang.
    const read = rakeFromSlopes(
      [
        { at, slope: slopes[0] / 12, points: away(rakeLeft, -1) },
        { at, slope: -slopes[1] / 12, points: away(rakeRight, 1) },
      ],
      cameraAt,
      snapped !== null,
    );
    if (read) {
      const per = read.perSlope.map((o) => (o === null ? null : o * FEET_PER_METRE)) as [number | null, number | null];
      const got = read.perSlope.filter((o): o is number => o !== null);
      const alike = read.hangM !== null || got.length < 2 || Math.abs((got[0] as number) - (got[1] as number)) <= OVERHANGS_AGREE_M;
      const some = read.outM >= SMALLEST_OVERHANG_M;
      rakeOverhang = { feet: read.outM * FEET_PER_METRE, perSlope: per, hangFeet: read.hangM === null ? null : read.hangM * FEET_PER_METRE, agree: alike && some };
      if (read.hangM !== null) checks.push(`The fascia hangs ${inches(read.hangM)} below the soffit, read off the two slopes together; the rake stands ${inches(read.outM)} out to the fascia's face.`);
      else if (!alike) checks.push(`The two rakes stand out ${inches(got[0] as number)} and ${inches(got[1] as number)}: a roof's are alike, so one fascia is traced off.`);
      if (!some) checks.push(`The rake reads under 4" out from the wall: the fascia is most likely traced on the wall top. Check it before ticking it.`);
    } else if (rakeLeft.length + rakeRight.length > 0) {
      checks.push("The fascia up the gable was traced, but no rake overhang could be read off it.");
    }
  } else if (over === "gable" && !cameraAt) {
    checks.push("Where the phone stood for this photo isn't known, so the overhangs can't be read off it.");
  }

  // Eave overhang: a rake's foot (with the rake read), or a hip's corner.
  let eaveOverhang: ProposedRoof["eaveOverhang"] = null;
  if (cameraAt) {
    // How sure the rake is: an inch when snapped and read off both slopes, else two and a half.
    const rakeSd = (rakeOverhang?.hangFeet != null ? 1 : 2.5) * INCH_M;
    const traceSd = 1 * INCH_M;
    const reads: { end: "left" | "right"; o: number; varM2: number; from: "rake_foot" | "hip_corner" }[] = [];
    for (const [end, e] of [
      ["left", leftEnd],
      ["right", rightEnd],
    ] as const) {
      if (!e.point) continue;
      const cam = cameraAt(e.point);
      if (!cam) continue;
      if (e.kind === "rake_foot" && rakeOverhang) {
        const o = eaveAtRakeFoot(cam, e.point, rakeOverhang.feet / FEET_PER_METRE, end, lengthM);
        const gain = rakeFootGain(cam, e.point);
        if (o > -0.05 && o < OVERHANG_MAX_M) reads.push({ end, o: Math.max(0, o), varM2: traceSd ** 2 + (gain * rakeSd) ** 2, from: "rake_foot" });
        else checks.push(`The roof edge at the ${end} end reads ${inches(o)} past the wall, too far for an eave: is the roof carried on there, over a porch or a deck?`);
      } else if (e.kind === "hip_corner") {
        const r = eaveAtHipCorner(cam, e.point, end, lengthM);
        if (!r) continue;
        if (r.gain > HIP_CORNER_GAIN_MAX) checks.push(`The hip's corner at the ${end} end was photographed from near its diagonal, where it shows the same whatever the overhang: a photo more square to the wall reads it.`);
        else if (r.outM > -0.05 && r.outM < OVERHANG_MAX_M) reads.push({ end, o: Math.max(0, r.outM), varM2: (traceSd * r.gain) ** 2, from: "hip_corner" });
      }
    }
    // Rake feet first; each end weighted by how sure it is - a foot far across the photo leans on the rake.
    const best = reads.some((r) => r.from === "rake_foot") ? reads.filter((r) => r.from === "rake_foot") : reads;
    if (best.length > 0) {
      const left = best.find((r) => r.end === "left") ?? null;
      const right = best.find((r) => r.end === "right") ?? null;
      const w = best.reduce((s, r) => s + 1 / r.varM2, 0);
      const mean = best.reduce((s, r) => s + r.o / r.varM2, 0) / w;
      const ends = !left || !right || Math.abs(left.o - right.o) <= Math.max(OVERHANGS_AGREE_M, 2 * Math.sqrt(left.varM2 + right.varM2));
      // Hardly past the wall at all: the trace has most likely put the foot on the wall's own corner.
      const some = best.every((r) => r.o >= SMALLEST_OVERHANG_M);
      eaveOverhang = {
        feet: mean * FEET_PER_METRE,
        left: left ? left.o * FEET_PER_METRE : null,
        right: right ? right.o * FEET_PER_METRE : null,
        from: (best[0] as (typeof best)[number]).from,
        agree: ends && some,
      };
      if (!ends && left && right) checks.push(`The eave reads ${inches(left.o)} past the wall at the left end and ${inches(right.o)} at the right: if the roof is the same all round, one end is traced off.`);
      else if (!some) checks.push(`The roof edge's end reads under 4" past the wall: the trace has most likely put it on the wall's own corner. Check it before ticking it.`);
    }
  }
  for (const [end, e] of [
    ["left", leftEnd],
    ["right", rightEnd],
  ] as const) {
    if (e.kind === "runs_on") checks.push(`At the ${end} end the roof carries on past the wall, so its eave overhang isn't read there.`);
  }
  if (snapped) {
    const by = (v: number) => `${v < 0.5 ? "under 1/2" : v.toFixed(1)}"`;
    checks.unshift(
      `The lines were set on the photo's own edges: the wall top moved ${by(snapped.wallTopInches)}${snapped.fasciaInches === null ? ", the fascia stayed where the trace put it (no clear edge)" : `, the fascia ${by(snapped.fasciaInches)}`}.`,
    );
  }

  return {
    said,
    over,
    pitch,
    rakeOverhang,
    eaveOverhang,
    lines: {
      rakeLeft: rakeLeft.map(feet),
      rakeRight: rakeRight.map(feet),
      eave: lines.eave.map(feet),
      leftEnd: leftEnd.point ? feet(leftEnd.point) : null,
      rightEnd: rightEnd.point ? feet(rightEnd.point) : null,
    },
    ends: { left: leftEnd.kind, right: rightEnd.kind },
    snapped,
    checks,
    notes: lines.notes,
  };
}

/**
 * The trace's roof lines set on the photo's own edges: the wall top's two sloped runs onto the step
 * from wall to soffit (the peak where they meet), and each rake's fascia onto the first strong step
 * above the soffit, parallel to its run (`fasciaOffset`). [g] is the squared image, [frame] its frame;
 * the lines come and go in the wall's metres (the wall top in the side's feet). Null when the wall
 * top's runs can't be found on the photo; a fascia that can't be keeps the trace's line.
 */
export function snapRoof(
  g: Gray,
  frame: SquareFrame,
  wallTop: WallTopForRoof,
  lines: RoofLines,
  cameraAt: CameraAt | null,
): { wallTop: WallTopForRoof; lines: RoofLines; movedInches: { wallTop: number; fascia: number | null } } | null {
  const runs = gableRuns(wallTop.line, wallTop.peakIndex);
  if (!runs) return null;
  const px = (p: Pt): PxPt => ({ x: frameX(frame, p.x / FEET_PER_METRE), y: frameY(frame, p.y / FEET_PER_METRE) });
  const pxM = (p: Seen): PxPt => ({ x: frameX(frame, p.alongM), y: frameY(frame, p.upM) });
  const seen = (p: PxPt): Seen => ({ alongM: frameAlongM(frame, p.x), upM: frameUpM(frame, p.y) });
  const ft = (p: PxPt): Pt => ({ x: frameAlongM(frame, p.x) * FEET_PER_METRE, y: frameUpM(frame, p.y) * FEET_PER_METRE });
  const lineFrom = wallTop.line[runs.from] as Pt;
  const peak = wallTop.line[wallTop.peakIndex] as Pt;
  const lineTo = wallTop.line[runs.to] as Pt;
  const left = snapEdge(g, px(lineFrom), px(peak));
  const right = snapEdge(g, px(peak), px(lineTo));
  if (!left || !right) return null;
  // The peak where the two runs meet.
  const d1 = { x: left.b.x - left.a.x, y: left.b.y - left.a.y };
  const d2 = { x: right.b.x - right.a.x, y: right.b.y - right.a.y };
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((right.a.x - left.a.x) * d2.y - (right.a.y - left.a.y) * d2.x) / det;
  const apex = { x: left.a.x + d1.x * t, y: left.a.y + d1.y * t };
  const yOn = (s: { a: PxPt; b: PxPt }, x: number) => s.a.y + ((s.b.y - s.a.y) * (x - s.a.x)) / (s.b.x - s.a.x);
  const leftEnd = { x: px(lineFrom).x, y: yOn(left, px(lineFrom).x) };
  const rightEnd = { x: px(lineTo).x, y: yOn(right, px(lineTo).x) };
  const line = [...wallTop.line.slice(0, runs.from), ft(leftEnd), ft(apex), ft(rightEnd), ...wallTop.line.slice(runs.to + 1)];
  const snappedTop: WallTopForRoof = { line, peakIndex: runs.from + 1 };

  // Each rake's fascia: parallel to its run, as high above it as the photo's first strong step near the trace's line.
  const ppm = frame.ppm;
  const fascia = (traced: Seen[], a: PxPt, b: PxPt): { pts: Seen[]; moved: number } | null => {
    if (traced.length < 2) return null;
    const { len, dx, dy, nx, ny } = frameOf(a, b);
    const tracedPx = traced.map(pxM);
    // How high above the run, and how far along it, the trace's fascia points are (near the peak left out).
    const offsets = tracedPx.map((p) => ({ t: (p.x - a.x) * dx + (p.y - a.y) * dy, s: (p.x - a.x) * nx + (p.y - a.y) * ny }));
    const along = offsets.filter((o) => o.t > 0.1 * len && o.t < 0.9 * len);
    if (along.length === 0) return null;
    const near = Math.min(...along.map((o) => o.s));
    const upTo = Math.max(...along.map((o) => o.s)) + 20;
    // Only where the squared image shows the fascia through the same phone as most of the trace's points.
    const camOf = (p: PxPt) => (cameraAt ? cameraAt(seen(p)) : null);
    const counts = new Map<WallCamera | null, number>();
    for (const p of tracedPx) counts.set(camOf(p), (counts.get(camOf(p)) ?? 0) + 1);
    const main = [...counts.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
    const s = fasciaOffset(g, a, b, near, upTo, 0.2, 0.85, (p) => camOf(p) === main);
    if (s === null) return null;
    const t0 = Math.max(0, Math.min(...along.map((o) => o.t)));
    const t1 = Math.min(len, Math.max(...along.map((o) => o.t)));
    const pts: Seen[] = [];
    for (let i = 0; i <= 8; i++) {
      const tt = t0 + ((t1 - t0) * i) / 8;
      const p = { x: a.x + dx * tt + nx * s, y: a.y + dy * tt + ny * s };
      if (camOf(p) === main) pts.push(seen(p));
    }
    const movedPx = along.reduce((sum, o) => sum + Math.abs(o.s - s), 0) / along.length;
    return pts.length >= 2 ? { pts, moved: movedPx / ppm } : null;
  };
  const fl = fascia(lines.rakeLeft, leftEnd, apex);
  const fr = fascia(lines.rakeRight, apex, rightEnd);
  const movedFascia = [fl, fr].filter((f): f is NonNullable<typeof f> => f !== null).map((f) => f.moved);
  return {
    wallTop: snappedTop,
    lines: { ...lines, rakeLeft: fl ? fl.pts : lines.rakeLeft, rakeRight: fr ? fr.pts : lines.rakeRight },
    movedInches: {
      wallTop: ((left.moved + right.moved) / 2 / ppm) / INCH_M,
      fascia: movedFascia.length > 0 ? movedFascia.reduce((s, m) => s + m, 0) / movedFascia.length / INCH_M : null,
    },
  };
}
