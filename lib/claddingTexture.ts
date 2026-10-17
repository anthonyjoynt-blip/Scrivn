import type { CladdingKind } from "./exterior";
import type { Pt } from "./roof";

/**
 * How each cladding looks on an elevation (2026-10-16, the owner: "consider adding some form of texture
 * and imagery for the windows doors and siding materials for a better appearance"): its marks as plain
 * lines and rows of dots, already cut to the face, so the editor, the documents' pictures and the PDF
 * painter (lib/svgPdf.ts, which has no patterns or clip paths) all draw them alike. Grey marks on the
 * face's light fill, so they read in black and white.
 *
 * Lap lines sit at the siding's own exposure and brick at its courses, counted up from the side's level,
 * so two faces of one siding line up. Where that is finer than `unit * FINEST` (about 2 points on the
 * report's page, `unit` being the drawing's lettering) every second or third course is drawn, as a
 * drawing at that scale would. Plan feet, y up, as the elevation's own frame.
 */

export type Texture = "stucco" | "eifs" | "lap" | "shake" | "brick" | "stone" | "battens" | "ribs" | "parging" | "ground" | "shingles" | "seams" | "plain";

export interface TextureSpec {
  texture: Texture;
  /** Lap siding: the exposure, feet. */
  exposureFeet?: number;
  /** Shingles: laminated (architectural), their tabs of uneven width; else three-tab, a tab every foot. */
  laminated?: boolean;
}

/**
 * How a roof's slopes are drawn on the elevations (2026-10-17, the owner: "The shingles on the elevations look like vinyl
 * siding with the horizontal lines. Can we have that look more shingle like"): asphalt shingles as courses at 5" to the
 * weather with their tab cuts staggered course to course - three-tab even, laminated uneven - metal roofing as standing
 * seams running down the slope, anything else plain. Null material: shingles, the usual roof.
 */
export function roofTextureOf(material: "three_tab" | "composite" | "metal" | "tile" | "cedar_shake" | null | undefined): TextureSpec {
  if (material === "metal") return { texture: "seams" };
  if (material === "tile" || material === "cedar_shake") return { texture: "plain" };
  return { texture: "shingles", exposureFeet: 5 / 12, laminated: material === "composite" };
}

/** The finest spacing drawn, in lettering heights. */
const FINEST = 0.3;

const LAP = (inches: number): TextureSpec => ({ texture: "lap", exposureFeet: inches / 12 });

/** What a cladding is drawn with. "Other" goes by its name: board and batten, cedar shingles, Hardie... */
export function textureOf(kind: CladdingKind | "parging", label?: string): TextureSpec {
  switch (kind) {
    case "stucco":
      return { texture: "stucco" };
    case "eifs":
      return { texture: "eifs" };
    case "vinyl":
      return LAP(4);
    case "fibre_cement":
      return LAP(7);
    case "wood":
      return LAP(6);
    case "wood_shake":
      return { texture: "shake" };
    case "brick":
      return { texture: "brick" };
    case "stone":
      return { texture: "stone" };
    case "metal":
      return { texture: "ribs" };
    case "parging":
      return { texture: "parging" };
    default: {
      const t = (label ?? "").toLowerCase();
      if (/batten/.test(t)) return { texture: "battens" };
      if (/brick/.test(t)) return { texture: "brick" };
      if (/stone|rock|cultured/.test(t)) return { texture: "stone" };
      if (/shake|shingle|cedar/.test(t)) return { texture: "shake" };
      if (/vinyl/.test(t)) return LAP(4);
      if (/cement|hardie|fib(er|re)/.test(t)) return LAP(7);
      if (/lap|clap|siding|wood|board/.test(t)) return LAP(6);
      if (/metal|steel|alum|tin/.test(t)) return { texture: "ribs" };
      if (/stucco|plaster/.test(t)) return { texture: "stucco" };
      if (/eifs/.test(t)) return { texture: "eifs" };
      return { texture: "plain" };
    }
  }
}

export interface DotRow {
  a: Pt;
  b: Pt;
  /** The dash pattern that sets the dots along it, in the drawing's pixels (a stroke that does not scale). */
  dash: string;
  offset: number;
}

export interface TextureMarks {
  /** Solid strokes. */
  lines: [Pt, Pt][];
  /** Lighter solid strokes: a shake's joints, a metal panel's minor ribs. */
  fine: [Pt, Pt][];
  /** Rows of dots: stucco's and EIFS's stipple. */
  dots: DotRow[];
}

/** A number in [0, 1) that is always the same for the same (i, j): stone joints and stipple that never jump. */
function rnd(i: number, j: number): number {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Where the line through `p` along unit `d` is inside [poly]: [t0, t1] pairs along it, by crossings
 * counted the half-open way, so a line through a corner is neither in twice nor out.
 */
export function insideRuns(poly: Pt[], p: Pt, d: Pt): [number, number][] {
  // In the line's own frame: u along it, v across; the line is v = 0.
  const n = { x: -d.y, y: d.x };
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    const va = (a.x - p.x) * n.x + (a.y - p.y) * n.y;
    const vb = (b.x - p.x) * n.x + (b.y - p.y) * n.y;
    if (va > 0 === vb > 0) continue;
    const ua = (a.x - p.x) * d.x + (a.y - p.y) * d.y;
    const ub = (b.x - p.x) * d.x + (b.y - p.y) * d.y;
    ts.push(ua + ((0 - va) * (ub - ua)) / (vb - va));
  }
  ts.sort((s, t) => s - t);
  const runs: [number, number][] = [];
  for (let k = 0; k + 1 < ts.length; k += 2) if ((ts[k + 1] as number) - (ts[k] as number) > 1e-9) runs.push([ts[k] as number, ts[k + 1] as number]);
  return runs;
}

/** The parts of the segment a → b inside [poly]. */
export function clipSegment(poly: Pt[], a: Pt, b: Pt): [Pt, Pt][] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return [];
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const at = (t: number): Pt => ({ x: a.x + d.x * t, y: a.y + d.y * t });
  return insideRuns(poly, a, d)
    .map(([s, t]) => [Math.max(0, s), Math.min(len, t)] as [number, number])
    .filter(([s, t]) => t - s > 1e-6)
    .map(([s, t]) => [at(s), at(t)]);
}

function bounds(poly: Pt[]) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** The spacing drawn for a course of [real] feet: itself, or every second or third one where it is too fine to read. */
function drawnEvery(real: number, finest: number): number {
  return real * Math.max(1, Math.ceil(finest / real - 1e-9));
}

/** Level lines every [step] feet up from 0, cut to [poly]. */
function levels(poly: Pt[], step: number): { y: number; runs: [Pt, Pt][] }[] {
  const b = bounds(poly);
  const out: { y: number; runs: [Pt, Pt][] }[] = [];
  // Not on the face's own bottom edge: the outline is drawn there.
  for (let k = Math.floor(b.y0 / step + 1e-9) + 1; k * step < b.y1 - 1e-9; k++) {
    const y = k * step;
    out.push({ y, runs: clipSegment(poly, { x: b.x0 - 1, y }, { x: b.x1 + 1, y }) });
  }
  return out;
}

/** Upright lines at [xs], each from y0 to y1, cut to [poly]. */
function uprights(poly: Pt[], xs: number[], y0: number, y1: number): [Pt, Pt][] {
  return xs.flatMap((x) => clipSegment(poly, { x, y: y0 }, { x, y: y1 }));
}

/** Parallel lines at [deg] degrees, [step] apart, cut to [poly]. */
function hatch(poly: Pt[], deg: number, step: number): [Pt, Pt][] {
  const r = (deg * Math.PI) / 180;
  const d = { x: Math.cos(r), y: Math.sin(r) };
  const n = { x: -d.y, y: d.x };
  const vs = poly.map((p) => p.x * n.x + p.y * n.y);
  const us = poly.map((p) => p.x * d.x + p.y * d.y);
  const [u0, u1] = [Math.min(...us) - 1, Math.max(...us) + 1];
  const out: [Pt, Pt][] = [];
  for (let k = Math.ceil(Math.min(...vs) / step); k * step < Math.max(...vs); k++) {
    const v = k * step;
    const p = (u: number): Pt => ({ x: d.x * u + n.x * v, y: d.y * u + n.y * v });
    out.push(...clipSegment(poly, p(u0), p(u1)));
  }
  return out;
}

/**
 * The marks of [spec] on the face [poly], lettering `unit` feet. Lines run the whole face: the drawing
 * lays the openings over them.
 */
export function textureMarks(poly: Pt[], spec: TextureSpec, unit: number): TextureMarks {
  const marks: TextureMarks = { lines: [], fine: [], dots: [] };
  if (poly.length < 3 || !(unit > 0)) return marks;
  const finest = unit * FINEST;
  const b = bounds(poly);
  switch (spec.texture) {
    case "lap": {
      for (const row of levels(poly, drawnEvery(spec.exposureFeet ?? 0.5, finest))) marks.lines.push(...row.runs);
      return marks;
    }
    case "brick": {
      // Three courses to 8", a brick 8" long and laid half over the one below.
      const course = drawnEvery(8 / 36, finest);
      const length = course * 3;
      for (const row of levels(poly, course)) {
        marks.lines.push(...row.runs);
        const k = Math.round(row.y / course);
        const start = Math.floor(b.x0 / length) * length + (k % 2 === 0 ? 0 : length / 2);
        const xs: number[] = [];
        for (let x = start; x < b.x1; x += length) xs.push(x);
        marks.lines.push(...uprights(poly, xs, row.y, row.y + course));
      }
      return marks;
    }
    case "shake": {
      // Courses at 7" to the weather, each shake 4" to 10" wide.
      const course = drawnEvery(7 / 12, finest * 1.4);
      for (const row of levels(poly, course)) {
        marks.lines.push(...row.runs);
        const k = Math.round(row.y / course);
        const xs: number[] = [];
        for (let x = b.x0 - rnd(k, 0) * course, j = 1; x < b.x1; j++) {
          x += course * (0.6 + 0.9 * rnd(k, j));
          xs.push(x);
        }
        marks.fine.push(...uprights(poly, xs, row.y, row.y + course));
      }
      return marks;
    }
    case "stone": {
      // Coursed fieldstone: rows of uneven height, each stone 1.2 to 2.5 times as long as it is high.
      const base = Math.max(0.75, finest * 3);
      let y = Math.floor(b.y0 / base) * base;
      for (let k = 0; y < b.y1; k++) {
        const h = base * (0.75 + 0.5 * rnd(k, 0.5));
        marks.lines.push(...clipSegment(poly, { x: b.x0 - 1, y }, { x: b.x1 + 1, y }));
        const xs: number[] = [];
        for (let x = b.x0 - rnd(k, 0) * h * 2, j = 1; x < b.x1; j++) {
          x += h * (1.2 + 1.3 * rnd(k, j));
          xs.push(x);
        }
        marks.lines.push(...uprights(poly, xs, y, y + h));
        y += h;
      }
      return marks;
    }
    case "battens": {
      // A 2 1/2" batten over every joint, the boards 12" apart.
      const every = drawnEvery(1, finest * 3);
      const w = Math.max(2.5 / 12, finest * 0.6);
      const xs: number[] = [];
      for (let x = Math.ceil(b.x0 / every) * every; x < b.x1; x += every) xs.push(x - w / 2, x + w / 2);
      marks.lines.push(...uprights(poly, xs, b.y0 - 1, b.y1 + 1));
      return marks;
    }
    case "ribs": {
      // A rib every 12", a lighter one between.
      const every = drawnEvery(1, finest * 2);
      const ribs: number[] = [];
      const minor: number[] = [];
      for (let x = Math.ceil(b.x0 / every) * every; x < b.x1; x += every) {
        ribs.push(x);
        minor.push(x + every / 2);
      }
      marks.lines.push(...uprights(poly, ribs, b.y0 - 1, b.y1 + 1));
      marks.fine.push(...uprights(poly, minor, b.y0 - 1, b.y1 + 1));
      return marks;
    }
    case "shingles": {
      /*
        Courses at their exposure, thinned where too fine, and in each course the tab cuts rising from its bottom edge
        most of the way to the next: a three-tab strip's every foot, half a tab over from the course below; a laminated
        one's at uneven widths. The cuts are what no lap siding has.
      */
      const course = drawnEvery(spec.exposureFeet ?? 5 / 12, finest);
      const tab = drawnEvery(1, finest * 2.2);
      for (const row of levels(poly, course)) marks.lines.push(...row.runs);
      // Each course's cuts, the lowest (from the drip edge, under the first line) included.
      for (let k = Math.floor(b.y0 / course + 1e-9); k * course < b.y1 - 1e-9; k++) {
        const y = Math.max(b.y0, k * course);
        const xs: number[] = [];
        if (spec.laminated) {
          for (let x = b.x0 - rnd(k, 0) * tab, j = 1; x < b.x1; j++) {
            x += tab * (0.55 + 0.9 * rnd(k, j));
            xs.push(x);
          }
        } else {
          for (let x = Math.floor(b.x0 / tab) * tab + (((k % 2) + 2) % 2 === 0 ? 0 : tab / 2); x < b.x1; x += tab) xs.push(x);
        }
        marks.fine.push(...uprights(poly, xs, y, k * course + course * 0.7));
      }
      return marks;
    }
    case "seams": {
      // Standing seams every 16", running down the slope.
      const every = drawnEvery(16 / 12, finest * 2);
      const xs: number[] = [];
      for (let x = Math.ceil(b.x0 / every) * every; x < b.x1; x += every) xs.push(x);
      marks.lines.push(...uprights(poly, xs, b.y0 - 1, b.y1 + 1));
      return marks;
    }
    case "parging":
      marks.fine.push(...hatch(poly, 45, Math.max(finest * 1.1, 0.2)));
      return marks;
    case "ground":
      marks.lines.push(...hatch(poly, -50, Math.max(finest * 1.3, 0.25)));
      return marks;
    case "stucco":
    case "eifs": {
      // A stipple: rows of dots set unevenly along each row, the same every time it is drawn.
      const fine = spec.texture === "eifs";
      const step = Math.max(finest * (fine ? 2.2 : 1.35), 0.2);
      let k = Math.ceil(b.y0 / step);
      for (const row of levels(poly, step)) {
        k++;
        const gaps = [0, 1, 2, 3, 4].map((j) => (fine ? 7 : 2.5) + rnd(k, j) * (fine ? 6 : 6));
        const dash = gaps.map((g) => `0.01 ${g.toFixed(1)}`).join(" ");
        const total = gaps.reduce((s, g) => s + g, 0);
        for (const [a, c] of row.runs) marks.dots.push({ a, b: c, dash, offset: Math.round(rnd(k, 9) * total * 10) / 10 });
      }
      return marks;
    }
    default:
      return marks;
  }
}
