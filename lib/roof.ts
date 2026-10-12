/**
 * The roof over a footprint: worked out from the outline, the overhangs and one pitch, the way an
 * estimator does it at the desk from a tape and a pitch gauge (2026-10-12, the exterior).
 *
 * ── Why the area needs no roof at all ──────────────────────────────────────────────────────────
 * Every face of a roof of ONE pitch is that pitch, so each face's true area is its plan area times
 * the same factor, √(1 + (rise/12)²), and so is the total: roof area = the plan area inside the drip
 * line × the pitch factor, whatever the style. Gable or hip, L or rectangle. The research for this
 * rated it ±3–5% on squares from a taped footprint, which is inside any waste allowance.
 *
 * ── Why the lines do ───────────────────────────────────────────────────────────────────────────
 * Ridge, hip and valley lengths depend on where the faces meet, so the roof is built: the footprint
 * is split into SECTIONS, each a rectangle with its own ridge, and each section is a "tent" - the
 * lowest of the planes rising from its eaves (two long sides, plus one per hip end; a gable end
 * has no plane, its sides simply stop). Where sections overlap the roof is the HIGHER of the two:
 * that is how an L is framed, a wing's roof carried into the main roof until the two meet, and the
 * crease they meet in is a valley. A wing's end that runs into the main ("tie") is extended into it
 * by its own half-span, which is exactly where its ridge reaches the main roof's slope.
 *
 * The lines are then read off that surface, not added up per section. That matters on the very
 * first L: a main roof with a hip at the end the wing is flush with has a hip running to the inside
 * of the wall, and the wing has a side face rising from that same wall. They are one plane. Summed
 * per section, the L would carry a hip and a valley that do not exist; read off the surface, they
 * are not there, because nothing changes across them.
 *
 * Everything here is in FEET with y UP (the front of the house along y = 0, the rear above it), in
 * plan. Heights are worked in feet of RUN - distance in from the drip line - and only turned into
 * rise by the pitch at the end, so a crease is where it is whatever the pitch.
 *
 * Rectangles and L-shapes are built. Any other outline still gets its area (the outline grown by
 * the eave overhang, × the factor) and its eave run, and says that its ridge and hips are not
 * worked out yet rather than inventing them.
 */

export interface Pt {
  x: number;
  y: number;
}

export type RoofEndKind = "gable" | "hip";
type SectionEnd = RoofEndKind | "tie";

/** A plane rising from a line in plan: height (in feet of run) = a·x + b·y + c, with (a, b) a unit axis. */
interface Plane {
  a: number;
  b: number;
  c: number;
}

/** One rectangle of roof with its ridge along `axis`. */
export interface RoofSection {
  role: "main" | "wing";
  /** The drip outline this section covers, plan feet. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  axis: "x" | "y";
  lo: SectionEnd;
  hi: SectionEnd;
  /** How far a tie end carries on into the section it ties into. */
  reachLo: number;
  reachHi: number;
  /** The side each free end stands over, when it is one. */
  loSide: string | null;
  hiSide: string | null;
  /** The wall length under each end - what a gable end's triangle and rake soffit span. */
  loWallFeet: number;
  hiWallFeet: number;
}

export type RoofLineKind = "ridge" | "hip" | "valley" | "eave" | "rake";

export interface RoofLine {
  kind: RoofLineKind;
  /** Plan ends, feet, y up. */
  a: Pt;
  b: Pt;
  /** Height above the drip line at each end, feet. */
  za: number;
  zb: number;
  /** Along the roof: the plan length for a ridge or eave, the sloped length for a hip, valley or rake. */
  feet: number;
}

export interface RoofEnd {
  sideId: string;
  kind: RoofEndKind;
  role: "main" | "wing";
}

export interface RoofInput {
  /** The footprint, counter-clockwise (y up), every wall square to the axes. */
  corners: Pt[];
  /** The side each wall is: wall i runs corners[i] → corners[i + 1]. */
  sideIds: string[];
  /** Rise in 12. */
  pitch: number;
  eaveOverhangFeet: number;
  rakeOverhangFeet: number;
  /** A rectangle's ridge runs parallel to this side; null = along the longer walls. */
  ridgeAlong: string | null;
  /** Each end by the side it stands over; anything absent is a gable. */
  ends: Record<string, RoofEndKind>;
}

export interface RoofPlan {
  /** "rectangle" and "L" are built; "other" has an area and an eave run only. */
  shape: "rectangle" | "L" | "other";
  sections: RoofSection[];
  /** The drip outline as rectangles (filled), and its edge as segments. */
  outlineRects: { x0: number; x1: number; y0: number; y1: number }[];
  lines: RoofLine[];
  /** Where each free end is, and what it is - what the settings offer gable or hip for. */
  ends: RoofEnd[];
  pitch: number;
  pitchFactor: number;
  /** √(2 + (rise/12)²): a hip or valley's length per foot of run. */
  hipFactor: number;
  planSquareFeet: number;
  footprintSquareFeet: number;
  areaSquareFeet: number;
  totals: Record<RoofLineKind, number>;
  /** The soffit under the eaves (flat) and under the rakes (sloped with the roof), square feet. */
  soffit: { eaveSquareFeet: number; rakeSquareFeet: number };
  /** Each straight run of eave, for the eavestrough and its downspouts. */
  eaveRuns: number[];
  /** Why the lines are not all there, when they are not. */
  note: string | null;
}

const EPS = 1e-7;

export function pitchFactor(pitch: number): number {
  const r = pitch / 12;
  return Math.sqrt(1 + r * r);
}

export function hipValleyFactor(pitch: number): number {
  const r = pitch / 12;
  return Math.sqrt(2 + r * r);
}

/** Shoelace area of a polygon, unsigned. */
export function polygonArea(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Pt;
    const q = points[(i + 1) % points.length] as Pt;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

// ---------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------

function sectionPlanes(s: RoofSection): Plane[] {
  const planes: Plane[] = [];
  if (s.axis === "x") {
    planes.push({ a: 0, b: 1, c: -s.y0 }, { a: 0, b: -1, c: s.y1 });
    if (s.lo === "hip") planes.push({ a: 1, b: 0, c: -s.x0 });
    if (s.hi === "hip") planes.push({ a: -1, b: 0, c: s.x1 });
  } else {
    planes.push({ a: 1, b: 0, c: -s.x0 }, { a: -1, b: 0, c: s.x1 });
    if (s.lo === "hip") planes.push({ a: 0, b: 1, c: -s.y0 });
    if (s.hi === "hip") planes.push({ a: 0, b: -1, c: s.y1 });
  }
  return planes;
}

function planeAt(p: Plane, x: number, y: number): number {
  return p.a * x + p.b * y + p.c;
}

/** Where a section's roof reaches: its own rectangle, carried on past a tie end. */
function sectionDomain(s: RoofSection): { x0: number; x1: number; y0: number; y1: number } {
  return s.axis === "x"
    ? { x0: s.x0 - s.reachLo, x1: s.x1 + s.reachHi, y0: s.y0, y1: s.y1 }
    : { x0: s.x0, x1: s.x1, y0: s.y0 - s.reachLo, y1: s.y1 + s.reachHi };
}

function inside(r: { x0: number; x1: number; y0: number; y1: number }, x: number, y: number): boolean {
  return x >= r.x0 - EPS && x <= r.x1 + EPS && y >= r.y0 - EPS && y <= r.y1 + EPS;
}

/** The roof as a height field, in feet of run. Built once per plan. */
class Surface {
  readonly planes: Plane[];
  private readonly parts: { domain: ReturnType<typeof sectionDomain>; rect: RoofSection; planes: Plane[] }[];

  constructor(readonly sections: RoofSection[]) {
    this.parts = sections.map((s) => ({ domain: sectionDomain(s), rect: s, planes: sectionPlanes(s) }));
    // The same plane from two sections is one plane: a hip end and the wing side rising from the same wall.
    const seen = new Map<string, Plane>();
    for (const part of this.parts) {
      for (const p of part.planes) {
        const key = `${p.a},${p.b},${Math.round(p.c * 1e6)}`;
        if (!seen.has(key)) seen.set(key, p);
      }
    }
    this.planes = [...seen.values()];
  }

  covered(x: number, y: number): boolean {
    return this.parts.some((p) => inside(p.rect, x, y));
  }

  /** Height in feet of run, or null off the roof. */
  z(x: number, y: number): number | null {
    if (!this.covered(x, y)) return null;
    let best = -Infinity;
    for (const part of this.parts) {
      if (!inside(part.domain, x, y)) continue;
      let low = Infinity;
      for (const p of part.planes) low = Math.min(low, planeAt(p, x, y));
      best = Math.max(best, low);
    }
    return best === -Infinity ? null : Math.max(0, best);
  }

  /** Every place along a line where the surface might bend: two planes level, or a section's edge crossed. */
  breaks(o: Pt, d: Pt): number[] {
    const out: number[] = [];
    const along = (p: Plane) => ({ alpha: planeAt(p, o.x, o.y), beta: p.a * d.x + p.b * d.y });
    const vals = this.planes.map(along);
    for (let i = 0; i < vals.length; i++) {
      for (let j = i + 1; j < vals.length; j++) {
        const u = vals[i] as { alpha: number; beta: number };
        const v = vals[j] as { alpha: number; beta: number };
        if (Math.abs(u.beta - v.beta) < 1e-12) continue;
        out.push((v.alpha - u.alpha) / (u.beta - v.beta));
      }
    }
    for (const part of this.parts) {
      for (const r of [part.domain, part.rect]) {
        if (Math.abs(d.x) > 1e-12) out.push((r.x0 - o.x) / d.x, (r.x1 - o.x) / d.x);
        if (Math.abs(d.y) > 1e-12) out.push((r.y0 - o.y) / d.y, (r.y1 - o.y) / d.y);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// The outline
// ---------------------------------------------------------------------------------------------

/** The union of the sections' rectangles: its cells, and its boundary as maximal straight segments. */
function outlineOf(sections: RoofSection[]): { rects: RoofPlan["outlineRects"]; edges: [Pt, Pt][]; area: number } {
  const xs = [...new Set(sections.flatMap((s) => [s.x0, s.x1]).map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
  const ys = [...new Set(sections.flatMap((s) => [s.y0, s.y1]).map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
  const cov = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
    const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
    return sections.some((s) => inside(s, cx, cy));
  };
  const rects: RoofPlan["outlineRects"] = [];
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!cov(i, j)) continue;
      const r = { x0: xs[i] as number, x1: xs[i + 1] as number, y0: ys[j] as number, y1: ys[j + 1] as number };
      rects.push(r);
      area += (r.x1 - r.x0) * (r.y1 - r.y0);
    }
  }
  const edges: [Pt, Pt][] = [];
  // Vertical boundary pieces, merged up each grid line.
  for (let i = 0; i < xs.length; i++) {
    let start: number | null = null;
    for (let j = 0; j <= ys.length - 1; j++) {
      const edge = j < ys.length - 1 && cov(i - 1, j) !== cov(i, j);
      if (edge && start === null) start = j;
      if (!edge && start !== null) {
        edges.push([{ x: xs[i] as number, y: ys[start] as number }, { x: xs[i] as number, y: ys[j] as number }]);
        start = null;
      }
    }
  }
  for (let j = 0; j < ys.length; j++) {
    let start: number | null = null;
    for (let i = 0; i <= xs.length - 1; i++) {
      const edge = i < xs.length - 1 && cov(i, j - 1) !== cov(i, j);
      if (edge && start === null) start = i;
      if (!edge && start !== null) {
        edges.push([{ x: xs[start] as number, y: ys[j] as number }, { x: xs[i] as number, y: ys[j] as number }]);
        start = null;
      }
    }
  }
  return { rects, edges, area };
}

// ---------------------------------------------------------------------------------------------
// Sections from a footprint
// ---------------------------------------------------------------------------------------------

interface Box {
  minx: number;
  maxx: number;
  miny: number;
  maxy: number;
}

function boxOf(points: Pt[]): Box {
  return {
    minx: Math.min(...points.map((p) => p.x)),
    maxx: Math.max(...points.map((p) => p.x)),
    miny: Math.min(...points.map((p) => p.y)),
    maxy: Math.max(...points.map((p) => p.y)),
  };
}

/** The side whose wall lies on x = value (or y = value), overlapping [lo, hi] across. */
function sideOn(input: RoofInput, vertical: boolean, value: number, lo: number, hi: number): string | null {
  const n = input.corners.length;
  for (let i = 0; i < n; i++) {
    const p = input.corners[i] as Pt;
    const q = input.corners[(i + 1) % n] as Pt;
    if (vertical) {
      if (Math.abs(p.x - value) > 1e-6 || Math.abs(q.x - value) > 1e-6) continue;
      if (Math.min(hi, Math.max(p.y, q.y)) - Math.max(lo, Math.min(p.y, q.y)) > 1e-6) return input.sideIds[i] ?? null;
    } else {
      if (Math.abs(p.y - value) > 1e-6 || Math.abs(q.y - value) > 1e-6) continue;
      if (Math.min(hi, Math.max(p.x, q.x)) - Math.max(lo, Math.min(p.x, q.x)) > 1e-6) return input.sideIds[i] ?? null;
    }
  }
  return null;
}

/** Whether a turn at corner i is inside (reflex) on a counter-clockwise outline. */
function isReflex(points: Pt[], i: number): boolean {
  const n = points.length;
  const a = points[(i - 1 + n) % n] as Pt;
  const b = points[i] as Pt;
  const c = points[(i + 1) % n] as Pt;
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -EPS;
}

/**
 * One rectangle of roof over the box [ax0, ax1] × [ay0, ay1] of WALL, ridge along `axis`, with the
 * overhang each end and side takes. A tie end starts at `tieAt` (the main roof's drip line) instead.
 */
function makeSection(
  input: RoofInput,
  role: "main" | "wing",
  wall: { x0: number; x1: number; y0: number; y1: number },
  axis: "x" | "y",
  lo: SectionEnd,
  hi: SectionEnd,
  tieAt: number | null,
): RoofSection {
  const oe = input.eaveOverhangFeet;
  const over = (end: SectionEnd) => (end === "gable" ? input.rakeOverhangFeet : end === "hip" ? oe : 0);
  const s: RoofSection = {
    role,
    x0: wall.x0,
    x1: wall.x1,
    y0: wall.y0,
    y1: wall.y1,
    axis,
    lo,
    hi,
    reachLo: 0,
    reachHi: 0,
    loSide: null,
    hiSide: null,
    loWallFeet: axis === "x" ? wall.y1 - wall.y0 : wall.x1 - wall.x0,
    hiWallFeet: axis === "x" ? wall.y1 - wall.y0 : wall.x1 - wall.x0,
  };
  if (axis === "x") {
    s.y0 -= oe;
    s.y1 += oe;
    s.x0 = lo === "tie" ? (tieAt as number) : wall.x0 - over(lo);
    s.x1 = hi === "tie" ? (tieAt as number) : wall.x1 + over(hi);
    const run = (s.y1 - s.y0) / 2;
    if (lo === "tie") s.reachLo = run;
    if (hi === "tie") s.reachHi = run;
    if (lo !== "tie") s.loSide = sideOn(input, true, wall.x0, wall.y0, wall.y1);
    if (hi !== "tie") s.hiSide = sideOn(input, true, wall.x1, wall.y0, wall.y1);
  } else {
    s.x0 -= oe;
    s.x1 += oe;
    s.y0 = lo === "tie" ? (tieAt as number) : wall.y0 - over(lo);
    s.y1 = hi === "tie" ? (tieAt as number) : wall.y1 + over(hi);
    const run = (s.x1 - s.x0) / 2;
    if (lo === "tie") s.reachLo = run;
    if (hi === "tie") s.reachHi = run;
    if (lo !== "tie") s.loSide = sideOn(input, false, wall.y0, wall.x0, wall.x1);
    if (hi !== "tie") s.hiSide = sideOn(input, false, wall.y1, wall.x0, wall.x1);
  }
  return s;
}

/** The end kind a side asks for: gable unless it says hip. */
function endKind(input: RoofInput, sideId: string | null): RoofEndKind {
  return sideId !== null && input.ends[sideId] === "hip" ? "hip" : "gable";
}

/**
 * The sections over a footprint: one for a rectangle, a main and a wing for an L. Null for any
 * other outline.
 *
 * Section ends are first built as gables to find which side each end stands over, then rebuilt with
 * the kind that side asks for - the overhang differs (a rake's or an eave's), so the end has to be
 * known before the rectangle is.
 */
export function roofSections(input: RoofInput): { shape: "rectangle" | "L"; sections: RoofSection[] } | null {
  const pts = input.corners;
  const box = boxOf(pts);
  const build = (role: "main" | "wing", wall: Box | { x0: number; x1: number; y0: number; y1: number }, axis: "x" | "y", lo: SectionEnd, hi: SectionEnd, tieAt: number | null) => {
    const w = "minx" in wall ? { x0: wall.minx, x1: wall.maxx, y0: wall.miny, y1: wall.maxy } : wall;
    const probe = makeSection(input, role, w, axis, lo, hi, tieAt);
    const loKind: SectionEnd = lo === "tie" ? "tie" : endKind(input, probe.loSide);
    const hiKind: SectionEnd = hi === "tie" ? "tie" : endKind(input, probe.hiSide);
    return makeSection(input, role, w, axis, loKind, hiKind, tieAt);
  };

  if (pts.length === 4 && pts.every((_, i) => !isReflex(pts, i))) {
    let axis: "x" | "y" = box.maxx - box.minx >= box.maxy - box.miny ? "x" : "y";
    if (input.ridgeAlong !== null) {
      const i = input.sideIds.indexOf(input.ridgeAlong);
      if (i >= 0) {
        const p = pts[i] as Pt;
        const q = pts[(i + 1) % pts.length] as Pt;
        axis = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? "x" : "y";
      }
    }
    return { shape: "rectangle", sections: [build("main", box, axis, "gable", "gable", null)] };
  }

  const reflex = pts.map((_, i) => i).filter((i) => isReflex(pts, i));
  if (pts.length !== 6 || reflex.length !== 1) return null;
  const r = pts[reflex[0] as number] as Pt;
  // The notch: the corner of the box that is not a corner of the footprint.
  const boxCorners = [
    { x: box.minx, y: box.miny },
    { x: box.maxx, y: box.miny },
    { x: box.maxx, y: box.maxy },
    { x: box.minx, y: box.maxy },
  ];
  const notch = boxCorners.find((c) => !pts.some((p) => Math.abs(p.x - c.x) < 1e-6 && Math.abs(p.y - c.y) < 1e-6));
  if (!notch) return null;
  const top = Math.abs(notch.y - box.maxy) < 1e-6;
  const right = Math.abs(notch.x - box.maxx) < 1e-6;
  // The full-length strip each way, through the corner the two arms share.
  const h = { x0: box.minx, x1: box.maxx, y0: top ? box.miny : r.y, y1: top ? r.y : box.maxy };
  const v = { x0: right ? box.minx : r.x, x1: right ? r.x : box.maxx, y0: box.miny, y1: box.maxy };
  const hSpan = h.y1 - h.y0;
  const vSpan = v.x1 - v.x0;
  /*
    The arm with the wider span is the main roof, through the corner. Its ridge is the higher one,
    so the narrower wing's roof always dies into its slope before reaching its ridge - the other way
    round the wing would run over the main ridge, which is not a roof anyone frames.
  */
  const mainIsH = hSpan > vSpan + 1e-9 || (Math.abs(hSpan - vSpan) <= 1e-9 && h.x1 - h.x0 >= v.y1 - v.y0);
  const oe = input.eaveOverhangFeet;
  if (mainIsH) {
    const main = build("main", h, "x", "gable", "gable", null);
    const wingWall = { x0: v.x0, x1: v.x1, y0: top ? r.y : box.miny, y1: top ? box.maxy : r.y };
    const tieAt = top ? r.y + oe : r.y - oe;
    const wing = build("wing", wingWall, "y", top ? "tie" : "gable", top ? "gable" : "tie", tieAt);
    return { shape: "L", sections: [main, wing] };
  }
  const main = build("main", v, "y", "gable", "gable", null);
  const wingWall = { x0: right ? r.x : box.minx, x1: right ? box.maxx : r.x, y0: h.y0, y1: h.y1 };
  const tieAt = right ? r.x + oe : r.x - oe;
  const wing = build("wing", wingWall, "x", right ? "tie" : "gable", right ? "gable" : "tie", tieAt);
  return { shape: "L", sections: [main, wing] };
}

// ---------------------------------------------------------------------------------------------
// Reading the lines off the surface
// ---------------------------------------------------------------------------------------------

function uniqSorted(values: number[], lo: number, hi: number): number[] {
  const all = [lo, hi, ...values.filter((t) => Number.isFinite(t) && t > lo + 1e-9 && t < hi - 1e-9)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) if (out.length === 0 || t - (out[out.length - 1] as number) > 1e-9) out.push(t);
  return out;
}

/** The parameter range of a line o + t·d inside a box. */
function clipToBox(o: Pt, d: Pt, box: Box): [number, number] | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (const [p, dp, a, b] of [
    [o.x, d.x, box.minx, box.maxx],
    [o.y, d.y, box.miny, box.maxy],
  ] as [number, number, number, number][]) {
    if (Math.abs(dp) < 1e-12) {
      if (p < a - EPS || p > b + EPS) return null;
      continue;
    }
    const t1 = (a - p) / dp;
    const t2 = (b - p) / dp;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  return hi - lo > 1e-9 ? [lo, hi] : null;
}

/** The height profile along a straight line, as (t, z-in-run) at every bend: exact, the surface being piecewise flat. */
function profile(surface: Surface, a: Pt, b: Pt): { t: number; z: number | null }[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return [];
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const ts = uniqSorted(surface.breaks(a, d), 0, len);
  return ts.map((t) => ({ t, z: surface.z(a.x + d.x * t, a.y + d.y * t) }));
}

/** A crease between planes p and q, wherever it really is one. */
function creasesBetween(surface: Surface, p: Plane, q: Plane, box: Box): { a: Pt; b: Pt; kind: "ridge" | "hip" | "valley" }[] {
  const na = p.a - q.a;
  const nb = p.b - q.b;
  const nlen = Math.hypot(na, nb);
  if (nlen < 1e-12) return [];
  const n = { x: na / nlen, y: nb / nlen };
  const d = { x: -n.y, y: n.x };
  // A point on p = q: along n from the origin.
  const k = -(p.c - q.c) / nlen;
  const o = { x: n.x * k, y: n.y * k };
  const range = clipToBox(o, d, box);
  if (!range) return [];
  const ts = uniqSorted(surface.breaks(o, d), range[0], range[1]);
  const ridge = Math.abs(p.a + q.a) < 1e-12 && Math.abs(p.b + q.b) < 1e-12;
  const delta = 1e-5;
  const found: { t0: number; t1: number; kind: "ridge" | "hip" | "valley" }[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i] as number;
    const t1 = ts[i + 1] as number;
    const tm = (t0 + t1) / 2;
    const m = { x: o.x + d.x * tm, y: o.y + d.y * tm };
    const z = surface.z(m.x, m.y);
    if (z === null || Math.abs(z - planeAt(p, m.x, m.y)) > 1e-6 || Math.abs(z - planeAt(q, m.x, m.y)) > 1e-6) continue;
    // Across the crease: p is the higher of the two on the +n side.
    const plus = { x: m.x + n.x * delta, y: m.y + n.y * delta };
    const minus = { x: m.x - n.x * delta, y: m.y - n.y * delta };
    const zp = surface.z(plus.x, plus.y);
    const zm = surface.z(minus.x, minus.y);
    if (zp === null || zm === null) continue;
    const onP = (pt: Pt, z2: number) => Math.abs(z2 - planeAt(p, pt.x, pt.y)) < 1e-9;
    const onQ = (pt: Pt, z2: number) => Math.abs(z2 - planeAt(q, pt.x, pt.y)) < 1e-9;
    let kind: "ridge" | "hip" | "valley" | null = null;
    if (onP(plus, zp) && onQ(minus, zm) && !onQ(plus, zp)) kind = "valley";
    else if (onQ(plus, zp) && onP(minus, zm) && !onP(plus, zp)) kind = ridge ? "ridge" : "hip";
    if (kind === null) continue;
    const last = found[found.length - 1];
    if (last && last.kind === kind && Math.abs(last.t1 - t0) < 1e-9) last.t1 = t1;
    else found.push({ t0, t1, kind });
  }
  return found.map((f) => ({ a: { x: o.x + d.x * f.t0, y: o.y + d.y * f.t0 }, b: { x: o.x + d.x * f.t1, y: o.y + d.y * f.t1 }, kind: f.kind }));
}

/** Joins pieces of one line found end to end (a ridge a wing's ridge stops on). */
function mergeCollinear(lines: RoofLine[]): RoofLine[] {
  const out: RoofLine[] = [];
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    let cur = lines[i] as RoofLine;
    let grown = true;
    while (grown) {
      grown = false;
      for (let j = 0; j < lines.length; j++) {
        if (j === i || used.has(j)) continue;
        const o = lines[j] as RoofLine;
        if (o.kind !== cur.kind) continue;
        const dx = cur.b.x - cur.a.x;
        const dy = cur.b.y - cur.a.y;
        const len = Math.hypot(dx, dy);
        const off = (p: Pt) => Math.abs(dx * (p.y - cur.a.y) - dy * (p.x - cur.a.x)) / len;
        if (off(o.a) > 1e-6 || off(o.b) > 1e-6) continue;
        const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-4;
        if (near(cur.b, o.a)) cur = { ...cur, b: o.b, zb: o.zb, feet: cur.feet + o.feet };
        else if (near(cur.a, o.b)) cur = { ...cur, a: o.a, za: o.za, feet: cur.feet + o.feet };
        else if (near(cur.b, o.b)) cur = { ...cur, b: o.a, zb: o.za, feet: cur.feet + o.feet };
        else if (near(cur.a, o.a)) cur = { ...cur, a: o.b, za: o.zb, feet: cur.feet + o.feet };
        else continue;
        used.add(j);
        grown = true;
      }
    }
    used.add(i);
    out.push(cur);
  }
  return out;
}

/** The outline grown outward by `by` on every wall: a counter-clockwise orthogonal polygon's offset. */
function grownOutline(points: Pt[], by: number): Pt[] {
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n] as Pt;
    const next = points[(i + 1) % n] as Pt;
    const norm = (a: Pt, b: Pt) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    };
    const n1 = norm(prev, p);
    const n2 = norm(p, next);
    return { x: p.x + by * (n1.x + n2.x), y: p.y + by * (n1.y + n2.y) };
  });
}

const EMPTY_TOTALS: Record<RoofLineKind, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 };

/** The roof over a footprint. */
export function buildRoof(input: RoofInput): RoofPlan {
  const pitch = Math.max(0, input.pitch);
  const factor = pitchFactor(pitch);
  const hipFactor = hipValleyFactor(pitch);
  const rise = pitch / 12;
  const footprintSquareFeet = polygonArea(input.corners);
  const built = roofSections(input);

  if (!built) {
    // Area and eaves from the outline grown by the eave overhang; nothing invented beyond that.
    const grown = grownOutline(input.corners, input.eaveOverhangFeet);
    const plan = polygonArea(grown);
    const lines: RoofLine[] = grown.map((a, i) => {
      const b = grown[(i + 1) % grown.length] as Pt;
      return { kind: "eave", a, b, za: 0, zb: 0, feet: Math.hypot(b.x - a.x, b.y - a.y) };
    });
    return {
      shape: "other",
      sections: [],
      outlineRects: [],
      lines,
      ends: [],
      pitch,
      pitchFactor: factor,
      hipFactor,
      planSquareFeet: plan,
      footprintSquareFeet,
      areaSquareFeet: plan * factor,
      totals: { ...EMPTY_TOTALS, eave: lines.reduce((s, l) => s + l.feet, 0) },
      soffit: { eaveSquareFeet: plan - footprintSquareFeet, rakeSquareFeet: 0 },
      eaveRuns: lines.map((l) => l.feet),
      note: "Only rectangles and L-shapes are built so far: the area and the eaves are right for this outline (all eaves, as a hip roof), but its ridge, hips, valleys and any gables are not worked out.",
    };
  }

  const { sections, shape } = built;
  const surface = new Surface(sections);
  const outline = outlineOf(sections);
  const box: Box = {
    minx: Math.min(...sections.map((s) => s.x0)),
    maxx: Math.max(...sections.map((s) => s.x1)),
    miny: Math.min(...sections.map((s) => s.y0)),
    maxy: Math.max(...sections.map((s) => s.y1)),
  };
  const lines: RoofLine[] = [];

  // Eaves and rakes: round the drip line, eave where the roof is down at the drip, rake where it climbs.
  const eaveRuns: number[] = [];
  for (const [a, b] of outline.edges) {
    const prof = profile(surface, a, b);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let run = 0;
    for (let i = 0; i + 1 < prof.length; i++) {
      const p0 = prof[i] as { t: number; z: number | null };
      const p1 = prof[i + 1] as { t: number; z: number | null };
      const z0 = p0.z ?? 0;
      const z1 = p1.z ?? 0;
      const kind: RoofLineKind = z0 < 1e-6 && z1 < 1e-6 ? "eave" : "rake";
      const pa = { x: a.x + d.x * p0.t, y: a.y + d.y * p0.t };
      const pb = { x: a.x + d.x * p1.t, y: a.y + d.y * p1.t };
      const plan = p1.t - p0.t;
      const feet = kind === "eave" ? plan : Math.hypot(plan, (z1 - z0) * rise);
      lines.push({ kind, a: pa, b: pb, za: z0 * rise, zb: z1 * rise, feet });
      if (kind === "eave") run += plan;
      else if (run > 0) {
        eaveRuns.push(run);
        run = 0;
      }
    }
    if (run > 0) eaveRuns.push(run);
  }

  // Ridges, hips and valleys: every pair of planes, kept only where the surface really folds.
  if (pitch > 0) {
    for (let i = 0; i < surface.planes.length; i++) {
      for (let j = i + 1; j < surface.planes.length; j++) {
        for (const c of creasesBetween(surface, surface.planes[i] as Plane, surface.planes[j] as Plane, box)) {
          const za = (surface.z(c.a.x, c.a.y) ?? 0) * rise;
          const zb = (surface.z(c.b.x, c.b.y) ?? 0) * rise;
          const plan = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
          lines.push({ kind: c.kind, a: c.a, b: c.b, za, zb, feet: Math.hypot(plan, zb - za) });
        }
      }
    }
  }

  const merged = mergeCollinear(lines);
  const totals = { ...EMPTY_TOTALS };
  for (const l of merged) totals[l.kind] += l.feet;

  const ends: RoofEnd[] = [];
  let rakeSoffitPlan = 0;
  for (const s of sections) {
    for (const [side, kind, wallFeet] of [
      [s.loSide, s.lo, s.loWallFeet],
      [s.hiSide, s.hi, s.hiWallFeet],
    ] as [string | null, SectionEnd, number][]) {
      if (side === null || kind === "tie") continue;
      ends.push({ sideId: side, kind, role: s.role });
      if (kind === "gable") rakeSoffitPlan += wallFeet * input.rakeOverhangFeet;
    }
  }
  const overhangPlan = outline.area - footprintSquareFeet;

  return {
    shape,
    sections,
    outlineRects: outline.rects,
    lines: merged,
    ends,
    pitch,
    pitchFactor: factor,
    hipFactor,
    planSquareFeet: outline.area,
    footprintSquareFeet,
    areaSquareFeet: outline.area * factor,
    totals,
    soffit: { eaveSquareFeet: Math.max(0, overhangPlan - rakeSoffitPlan), rakeSquareFeet: rakeSoffitPlan * factor },
    eaveRuns,
    note: pitch > 0 ? null : "A flat roof: no ridge, hips or valleys, and every edge is an eave.",
  };
}

/**
 * How far the roof's underside climbs above the eave along a wall, from its start corner to its end,
 * as (fraction along, feet) at every bend - the gable a side carries when the roof says it has one.
 *
 * Measured at the wall face: the roof there is one overhang in from the drip line, so its height
 * at an eave wall is the overhang's worth of rise, and the gable is what it climbs above that.
 */
export function roofRiseAlongWall(input: RoofInput, from: Pt, to: Pt): { t: number; rise: number }[] {
  const built = roofSections(input);
  if (!built || input.pitch <= 0) return [];
  const surface = new Surface(built.sections);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 1e-9) return [];
  const rise = input.pitch / 12;
  const base = input.eaveOverhangFeet;
  return profile(surface, from, to).map((p) => ({ t: p.t / len, rise: Math.max(0, ((p.z ?? base) - base) * rise) }));
}
