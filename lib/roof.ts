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
 *
 * ── What the footprint can't tell (2026-10-12) ─────────────────────────────────────────────────
 * Three things the estimator says on top of the footprint, each the smallest step from the tents.
 * All three are on the owner's own house: its porch, the gable over its front door, and its garage.
 *   * a PORCH roof that is the slope running down to a side carried on past its wall: the same
 *     plane, so one slope, its eave further out and lower - not a roof of its own;
 *   * a CROSS GABLE rising out of a slope at its drip line (over a front door): two planes of its
 *     own, higher where they win, so its valleys fall out as an L's do;
 *   * a roof that sits LOWER and stops at a wall, with a strip of wall between it and the roof
 *     above: a lean-to porch, or a wing set below the house's eave - the owner's garage, hipped at
 *     the street end, ties in lower under a gable on the house, siding between. It is a LAYER of
 *     its own - its own drip line, its own area under the house's overhang, which still has its
 *     eave - and where its drip line stands
 *     against the wall it is flashing, not eave or rake: STEP flashing up a slope, HEADWALL along a
 *     level top. An L's wing can be that, or a porch.
 */

export interface Pt {
  x: number;
  y: number;
}

export type RoofEndKind = "gable" | "hip";
/** A tie runs on into the section it meets (valleys); a wall end stops at the wall (flashing). */
type SectionEnd = RoofEndKind | "tie" | "wall";

/** A plane rising from a line in plan: height (in feet of run) = a·x + b·y + c, with (a, b) a unit axis. */
export interface RoofPlane {
  a: number;
  b: number;
  c: number;
  /**
   * The side whose wall line it rises from (a section's long sides and hip ends are walls), or that
   * a porch's slope drains toward. What names a slope, and keeps its name when a length is retyped.
   */
  sideId: string | null;
  /** What names a slope that rises from no side: a cross gable's, by the addition's id. */
  tag?: string;
}
type Plane = RoofPlane;

/** A straight stretch of a section's drip line that stands against a wall, on x = at (vertical) or y = at. */
export interface WallEdge {
  vertical: boolean;
  at: number;
  from: number;
  to: number;
}

type Rect = { x0: number; x1: number; y0: number; y1: number };

/** One rectangle of roof with its ridge along `axis`. */
export interface RoofSection {
  role: "main" | "wing" | "porch" | "gable";
  /** 0 is the house's roof; each roof that sits lower and stops at a wall is a layer of its own. */
  layer: number;
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
  /** The sides under its two long eaves: the low one (y0, or x0 for a ridge along y) and the high one. */
  sideA: string | null;
  sideB: string | null;
  /** The wall length under each end - what a gable end's triangle and rake soffit span. */
  loWallFeet: number;
  hiWallFeet: number;
  /** The walls it stands over (a main or a wing): what a side's gable is read from. */
  wall: Rect | null;
  /** A porch's or cross gable's own planes, instead of a tent's. */
  planes?: RoofPlane[];
  /** Where its drip line stands against a wall. */
  wallEdges: WallEdge[];
}

/**
 * What the estimator adds to the roof the footprint gives, on one side. "porch": the slope running
 * down to the side carried on past its wall, one plane with its eave further out (or, `lower`, a
 * roof of its own below the eave that stops at the wall). "gable": a small cross gable rising out
 * of the slope at its drip line, over a front door say.
 */
export interface RoofAddition {
  id: string;
  kind: "porch" | "gable";
  sideId: string;
  /** Along the side from its left end, as seen from outside: where it starts and stops, feet. */
  fromFeet: number;
  toFeet: number;
  /** A porch: from the wall out to its eave, feet. */
  depthFeet?: number;
  /** A porch: a lower roof of its own, against the wall (headwall flashing), not the slope carried on. */
  lower?: boolean;
}

/** "headwall" and "step" are flashing: a lower roof's level top, and its slope, against a wall. */
export type RoofLineKind = "ridge" | "hip" | "valley" | "eave" | "rake" | "headwall" | "step";

export interface RoofLine {
  kind: RoofLineKind;
  /**
   * Which line it is, kept across a retyped length: a crease by the two slopes either side of it, an
   * eave or rake by the side it runs along. What a selection on the plan holds.
   */
  key: string;
  /** Plan ends, feet, y up. */
  a: Pt;
  b: Pt;
  /** Height above the drip line at each end, feet. */
  za: number;
  zb: number;
  /** Along the roof: the plan length for a ridge, eave or headwall, the sloped length for a hip, valley, rake or step. */
  feet: number;
  /** The slopes it bounds (`RoofFacet.key`): two for a crease, one for an eave or rake. */
  facets: string[];
  /** The roof it is on: 0 the house's, more a lower one (`RoofSection.layer`). */
  layer: number;
}

/** One slope of the roof: everywhere one plane is the roof, in one piece. */
export interface RoofFacet {
  /** `<side the plane rises from>#<piece>` - the same slope keeps it when a length is retyped. */
  key: string;
  sideId: string | null;
  /** A, B, C... in order round the house from the first side, for the drawing and the scope. */
  label: string;
  /** Which way water runs off it, in plan (a unit vector). */
  facing: Pt;
  /** Convex pieces that together are the slope, plan feet. */
  cells: Pt[][];
  centroid: Pt;
  planSquareFeet: number;
  /** On the slope: the plan area times the pitch factor. */
  areaSquareFeet: number;
  layer: number;
}

/**
 * A piece of the drip line in order round the roof (counter-clockwise from above): eave or rake, or
 * flashing where a lower roof stands against a wall.
 */
export interface RoofEdge extends RoofLine {
  kind: "eave" | "rake" | "headwall" | "step";
  /** The side it runs along, one overhang out (or the side whose wall it is against). */
  sideId: string | null;
  /** Plan length (an eave's `feet`; a rake's run along the drip line). */
  planFeet: number;
  /** What the drip line does at its far end: turns round an outside corner, an inside one, or carries straight on (an eave meeting a rake). */
  cornerAtEnd: "outside" | "inside" | "straight";
  /** Which drip line it is on: one per roof, the house's first. */
  loop: number;
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
  /** Porches and cross gables, in the order added. */
  additions?: RoofAddition[];
  /** Wings whose roof sits lower and stops at the wall, each by the side its free end stands over. */
  lowerWings?: string[];
  /** For the notes: what each side is called. */
  sideNames?: Record<string, string>;
}

export interface RoofPlan {
  /** "rectangle" and "L" are built; "other" has an area and an eave run only. */
  shape: "rectangle" | "L" | "other";
  sections: RoofSection[];
  /** The drip outline as rectangles (filled), each roof's own, and its edge as segments. */
  outlineRects: { x0: number; x1: number; y0: number; y1: number; layer: number }[];
  lines: RoofLine[];
  /** The slopes, lettered. Empty for an outline the roof is not built for. */
  facets: RoofFacet[];
  /** The drip line, piece by piece, in order round the roof. */
  edges: RoofEdge[];
  /** Where each free end is, and what it is - what the settings offer gable or hip for. */
  ends: RoofEnd[];
  /** The wings that could sit lower against the wall, each by the side its free end stands over: an L's two arms. */
  wingEnds: string[];
  pitch: number;
  pitchFactor: number;
  /** √(2 + (rise/12)²): a hip or valley's length per foot of run. */
  hipFactor: number;
  planSquareFeet: number;
  footprintSquareFeet: number;
  areaSquareFeet: number;
  totals: Record<RoofLineKind, number>;
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
  if (s.planes) return s.planes;
  const planes: Plane[] = [];
  if (s.axis === "x") {
    planes.push({ a: 0, b: 1, c: -s.y0, sideId: s.sideA }, { a: 0, b: -1, c: s.y1, sideId: s.sideB });
    if (s.lo === "hip") planes.push({ a: 1, b: 0, c: -s.x0, sideId: s.loSide });
    if (s.hi === "hip") planes.push({ a: -1, b: 0, c: s.x1, sideId: s.hiSide });
  } else {
    planes.push({ a: 1, b: 0, c: -s.x0, sideId: s.sideA }, { a: -1, b: 0, c: s.x1, sideId: s.sideB });
    if (s.lo === "hip") planes.push({ a: 0, b: 1, c: -s.y0, sideId: s.loSide });
    if (s.hi === "hip") planes.push({ a: 0, b: -1, c: s.y1, sideId: s.hiSide });
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

  /** The lines a slope can end on: every pair of planes level, and every section's edges. As a·x + b·y + c = 0. */
  cutLines(): { a: number; b: number; c: number }[] {
    const out: { a: number; b: number; c: number }[] = [];
    for (let i = 0; i < this.planes.length; i++) {
      for (let j = i + 1; j < this.planes.length; j++) {
        const p = this.planes[i] as Plane;
        const q = this.planes[j] as Plane;
        const a = p.a - q.a;
        const b = p.b - q.b;
        if (Math.abs(a) + Math.abs(b) < 1e-12) continue;
        out.push({ a, b, c: p.c - q.c });
      }
    }
    for (const part of this.parts) {
      for (const r of [part.domain, part.rect]) {
        out.push({ a: 1, b: 0, c: -r.x0 }, { a: 1, b: 0, c: -r.x1 }, { a: 0, b: 1, c: -r.y0 }, { a: 0, b: 1, c: -r.y1 });
      }
    }
    return out;
  }

  /** The plane that is the roof at a point inside the outline. */
  planeIndexAt(x: number, y: number): number {
    const z = this.z(x, y);
    if (z === null) return -1;
    let best = -1;
    let bestErr = Infinity;
    this.planes.forEach((p, i) => {
      const err = Math.abs(planeAt(p, x, y) - z);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    });
    return bestErr < 1e-6 ? best : -1;
  }

  /** Height in feet of run above the drip line the planes rise from (below it over a porch), or null off the roof. */
  z(x: number, y: number): number | null {
    if (!this.covered(x, y)) return null;
    let best = -Infinity;
    for (const part of this.parts) {
      if (!inside(part.domain, x, y)) continue;
      let low = Infinity;
      for (const p of part.planes) low = Math.min(low, planeAt(p, x, y));
      best = Math.max(best, low);
    }
    if (best === -Infinity) return null;
    return Math.abs(best) < 1e-12 ? 0 : best;
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
function outlineOf(sections: RoofSection[]): { rects: Rect[]; edges: [Pt, Pt][]; area: number } {
  const xs = [...new Set(sections.flatMap((s) => [s.x0, s.x1]).map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
  const ys = [...new Set(sections.flatMap((s) => [s.y0, s.y1]).map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
  const cov = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
    const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
    return sections.some((s) => inside(s, cx, cy));
  };
  const rects: Rect[] = [];
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
 * overhang each end and side takes. A tie end starts at `tieAt` (the main roof's drip line) instead,
 * and a wall end at `tieAt` too (the wall it stops at).
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
  const joined = (end: SectionEnd) => end === "tie" || end === "wall";
  const s: RoofSection = {
    role,
    layer: 0,
    wall: { ...wall },
    wallEdges: [],
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
    sideA: null,
    sideB: null,
    loWallFeet: axis === "x" ? wall.y1 - wall.y0 : wall.x1 - wall.x0,
    hiWallFeet: axis === "x" ? wall.y1 - wall.y0 : wall.x1 - wall.x0,
  };
  if (axis === "x") {
    s.y0 -= oe;
    s.y1 += oe;
    s.x0 = joined(lo) ? (tieAt as number) : wall.x0 - over(lo);
    s.x1 = joined(hi) ? (tieAt as number) : wall.x1 + over(hi);
    const run = (s.y1 - s.y0) / 2;
    if (lo === "tie") s.reachLo = run;
    if (hi === "tie") s.reachHi = run;
    if (!joined(lo)) s.loSide = sideOn(input, true, wall.x0, wall.y0, wall.y1);
    if (!joined(hi)) s.hiSide = sideOn(input, true, wall.x1, wall.y0, wall.y1);
    s.sideA = sideOn(input, false, wall.y0, wall.x0, wall.x1);
    s.sideB = sideOn(input, false, wall.y1, wall.x0, wall.x1);
  } else {
    s.x0 -= oe;
    s.x1 += oe;
    s.y0 = joined(lo) ? (tieAt as number) : wall.y0 - over(lo);
    s.y1 = joined(hi) ? (tieAt as number) : wall.y1 + over(hi);
    const run = (s.x1 - s.x0) / 2;
    if (lo === "tie") s.reachLo = run;
    if (hi === "tie") s.reachHi = run;
    if (!joined(lo)) s.loSide = sideOn(input, false, wall.y0, wall.x0, wall.x1);
    if (!joined(hi)) s.hiSide = sideOn(input, false, wall.y1, wall.x0, wall.x1);
    s.sideA = sideOn(input, true, wall.x0, wall.y0, wall.y1);
    s.sideB = sideOn(input, true, wall.x1, wall.y0, wall.y1);
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
export function roofSections(input: RoofInput): { shape: "rectangle" | "L"; sections: RoofSection[]; wingEnds: string[] } | null {
  const pts = input.corners;
  const box = boxOf(pts);
  const build = (role: "main" | "wing", wall: Box | { x0: number; x1: number; y0: number; y1: number }, axis: "x" | "y", lo: SectionEnd, hi: SectionEnd, tieAt: number | null) => {
    const w = "minx" in wall ? { x0: wall.minx, x1: wall.maxx, y0: wall.miny, y1: wall.maxy } : wall;
    const probe = makeSection(input, role, w, axis, lo, hi, tieAt);
    const loKind: SectionEnd = lo === "tie" || lo === "wall" ? lo : endKind(input, probe.loSide);
    const hiKind: SectionEnd = hi === "tie" || hi === "wall" ? hi : endKind(input, probe.hiSide);
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
    return { shape: "rectangle", sections: [build("main", box, axis, "gable", "gable", null)], wingEnds: [] };
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
  let mainIsH = hSpan > vSpan + 1e-9 || (Math.abs(hSpan - vSpan) <= 1e-9 && h.x1 - h.x0 >= v.y1 - v.y0);
  /*
    Either arm can be the wing that sits lower and stops at the other's wall (a garage below the
    house's eave), named by the side its free end stands over. Saying so makes it the wing: lower,
    it never runs over the other's ridge, whichever is the wider.
  */
  const vFar = sideOn(input, false, top ? box.maxy : box.miny, v.x0, v.x1);
  const hFar = sideOn(input, true, right ? box.maxx : box.minx, h.y0, h.y1);
  const wingEnds = [vFar, hFar].filter((id): id is string => id !== null);
  const lower = input.lowerWings ?? [];
  let wingLower = false;
  if (vFar !== null && lower.includes(vFar)) {
    mainIsH = true;
    wingLower = true;
  } else if (hFar !== null && lower.includes(hFar)) {
    mainIsH = false;
    wingLower = true;
  }
  const join: SectionEnd = wingLower ? "wall" : "tie";
  const oe = input.eaveOverhangFeet;
  if (mainIsH) {
    const main = build("main", h, "x", "gable", "gable", null);
    const wingWall = { x0: v.x0, x1: v.x1, y0: top ? r.y : box.miny, y1: top ? box.maxy : r.y };
    const tieAt = wingLower ? r.y : top ? r.y + oe : r.y - oe;
    const wing = build("wing", wingWall, "y", top ? join : "gable", top ? "gable" : join, tieAt);
    if (wingLower) {
      wing.layer = 1;
      wing.wallEdges = [{ vertical: false, at: r.y, from: h.x0, to: h.x1 }];
    }
    return { shape: "L", sections: [main, wing], wingEnds };
  }
  const main = build("main", v, "y", "gable", "gable", null);
  const wingWall = { x0: right ? r.x : box.minx, x1: right ? box.maxx : r.x, y0: h.y0, y1: h.y1 };
  const tieAt = wingLower ? r.x : right ? r.x + oe : r.x - oe;
  const wing = build("wing", wingWall, "x", right ? join : "gable", right ? "gable" : join, tieAt);
  if (wingLower) {
    wing.layer = 1;
    wing.wallEdges = [{ vertical: true, at: r.x, from: v.y0, to: v.y1 }];
  }
  return { shape: "L", sections: [main, wing], wingEnds };
}

/** A section that is only planes over a rectangle: a porch or a cross gable. */
function planeSection(role: "porch" | "gable", layer: number, r: Rect, planes: Plane[], wallEdges: WallEdge[] = []): RoofSection {
  return {
    role,
    layer,
    ...r,
    axis: "x",
    lo: "gable",
    hi: "gable",
    reachLo: 0,
    reachHi: 0,
    loSide: null,
    hiSide: null,
    sideA: null,
    sideB: null,
    loWallFeet: 0,
    hiWallFeet: 0,
    wall: null,
    planes,
    wallEdges,
  };
}

/**
 * The estimator's porches and cross gables put on the footprint's sections, each by the side it is
 * on. A porch carried on is the very plane rising from that side's wall, over the strip from its
 * drip line out to the porch's; a lower porch is a lean-to of its own; a cross gable stands at the
 * drip line there (the porch's, when there is one), its eaves level with it. One that can't be put
 * where it is asked for says why in `notes`, rather than being bent to fit.
 */
function withAdditions(input: RoofInput, base: RoofSection[], nameOf: (id: string) => string, notes: string[]): RoofSection[] {
  const sections = [...base];
  const rank = (a: RoofAddition) => (a.kind === "porch" ? (a.lower ? 1 : 0) : 2);
  const adds = [...(input.additions ?? [])].sort((p, q) => rank(p) - rank(q));
  const n = input.corners.length;
  for (const add of adds) {
    const i = input.sideIds.indexOf(add.sideId);
    if (i < 0) continue;
    const p = input.corners[i] as Pt;
    const q = input.corners[(i + 1) % n] as Pt;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1e-9) continue;
    const d = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    // Outward: to the right of the wall's direction, the footprint being counter-clockwise.
    const out = { x: d.y, y: -d.x };
    const at = (along: number, o: number): Pt => ({ x: p.x + d.x * along + out.x * o, y: p.y + d.y * along + out.y * o });
    const rectOf = (a0: number, a1: number, o0: number, o1: number): Rect => {
      const u = at(a0, o0);
      const v = at(a1, o1);
      return { x0: Math.min(u.x, v.x), x1: Math.max(u.x, v.x), y0: Math.min(u.y, v.y), y1: Math.max(u.y, v.y) };
    };
    const alongOf = (pt: Pt) => (pt.x - p.x) * d.x + (pt.y - p.y) * d.y;
    const outOf = (pt: Pt) => (pt.x - p.x) * out.x + (pt.y - p.y) * out.y;
    const lo = Math.max(0, Math.min(len, Math.min(add.fromFeet, add.toFeet)));
    const hi = Math.max(0, Math.min(len, Math.max(add.fromFeet, add.toFeet)));
    const what = add.kind === "gable" ? "cross gable" : "porch roof";
    const name = nameOf(add.sideId);
    if (hi - lo < 1e-6) {
      notes.push(`The ${what} on ${name} has no length along the wall, so it is left out.`);
      continue;
    }
    const corners = (r: Rect): Pt[] => [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y1 },
    ];

    if (add.kind === "porch" && add.lower) {
      const depth = add.depthFeet ?? 0;
      if (depth <= 1e-6) {
        notes.push(`The porch roof on ${name} needs its depth from the wall.`);
        continue;
      }
      // At a corner of the side it runs on past it by a rake's overhang, as the roof above does.
      const a0 = lo <= 1e-6 ? -input.rakeOverhangFeet : lo;
      const a1 = hi >= len - 1e-6 ? len + input.rakeOverhangFeet : hi;
      // One slope, rising from its eave to the wall: run in from the eave is depth - out.
      const plane: Plane = { a: -out.x, b: -out.y, c: depth + p.x * out.x + p.y * out.y, sideId: add.sideId, tag: add.id };
      const vertical = Math.abs(d.x) < 0.5;
      const wallEdge: WallEdge = vertical ? { vertical, at: p.x, from: Math.min(p.y, q.y), to: Math.max(p.y, q.y) } : { vertical, at: p.y, from: Math.min(p.x, q.x), to: Math.max(p.x, q.x) };
      const layer = 1 + Math.max(...sections.map((s) => s.layer));
      sections.push(planeSection("porch", layer, rectOf(a0, a1, 0, depth), [plane], [wallEdge]));
      continue;
    }

    // The slope running down to this side: the plane rising from its wall.
    const owner = sections.find(
      (s) => (s.role === "main" || s.role === "wing") && sectionPlanes(s).some((pl) => pl.sideId === add.sideId && Math.abs(pl.a + out.x) < 1e-9 && Math.abs(pl.b + out.y) < 1e-9),
    );
    const plane = owner ? sectionPlanes(owner).find((pl) => pl.sideId === add.sideId && Math.abs(pl.a + out.x) < 1e-9 && Math.abs(pl.b + out.y) < 1e-9) : undefined;
    if (!owner || !plane) {
      notes.push(
        add.kind === "porch"
          ? `No slope runs down to ${name} (a gable end), so a porch roof there can't carry it on: make it a lower roof against the wall.`
          : `No slope runs down to ${name} (a gable end) for a cross gable to rise out of, so it is left out.`,
      );
      continue;
    }
    // Run from the drip line in to the wall: how far out the drip line stands.
    const dripOut = planeAt(plane, p.x, p.y);

    if (add.kind === "porch") {
      const depth = add.depthFeet ?? 0;
      if (depth <= dripOut + 1e-6) {
        notes.push(`The porch roof on ${name} reaches no further out than the eave already does, so it is left out: give its depth from the wall.`);
        continue;
      }
      // At a corner it carries on as far as the roof does there, so its rake lines up with the roof's.
      const reach = corners(owner).map(alongOf);
      const a0 = lo <= 1e-6 ? Math.min(...reach) : lo;
      const a1 = hi >= len - 1e-6 ? Math.max(...reach) : hi;
      sections.push(planeSection("porch", owner.layer, rectOf(a0, a1, dripOut, depth), [plane]));
      continue;
    }

    // A cross gable: its front at the drip line there, the furthest out the slope reaches.
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2;
    const own = sections.filter((s) => s.layer === owner.layer);
    const surface = new Surface(own);
    let front = dripOut;
    for (const o of own.map((s) => Math.max(...corners(s).map(outOf))).sort((u, v) => v - u)) {
      const pt = at(mid, o - 1e-4);
      const z = surface.z(pt.x, pt.y);
      if (z !== null && Math.abs(z - planeAt(plane, pt.x, pt.y)) < 1e-6) {
        front = o;
        break;
      }
    }
    const zFront = dripOut - front;
    // Its ridge, half its width up, must die into the slope before the slope's own top.
    const back = at(mid, front - half);
    const zBack = surface.z(back.x, back.y);
    if (zBack === null || zBack < zFront + half - 1e-6) {
      notes.push(`The cross gable on ${name} is too wide for the slope it rises out of: its ridge would stand over the roof's.`);
      continue;
    }
    const pd = p.x * d.x + p.y * d.y;
    const planes: Plane[] = [
      { a: d.x, b: d.y, c: zFront - lo - pd, sideId: null, tag: `${add.id}-left` },
      { a: -d.x, b: -d.y, c: zFront + hi + pd, sideId: null, tag: `${add.id}-right` },
    ];
    sections.push(planeSection("gable", owner.layer, rectOf(lo, hi, front - half, front), planes));
  }
  return sections;
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

/** Sorted breaks with any closer than 1e-5 to the one before dropped, keeping both ends. */
function withoutSlivers(ts: number[]): number[] {
  const out: number[] = [];
  for (const t of ts) {
    if (out.length > 0 && t - (out[out.length - 1] as number) < 1e-5) {
      if (t === ts[ts.length - 1] && out.length > 1) out[out.length - 1] = t;
      continue;
    }
    out.push(t);
  }
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
        if (o.kind !== cur.kind || o.facets.join("|") !== cur.facets.join("|")) continue;
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

const EMPTY_TOTALS: Record<RoofLineKind, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, headwall: 0, step: 0 };

// ---------------------------------------------------------------------------------------------
// Slopes
// ---------------------------------------------------------------------------------------------

/** Keeps the part of a convex polygon where a·x + b·y + c ≤ 0. */
function clipSide(poly: Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  const val = (p: Pt) => a * p.x + b * p.y + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    const vp = val(p);
    const vq = val(q);
    if (vp <= 1e-12) out.push(p);
    if ((vp < -1e-12 && vq > 1e-12) || (vp > 1e-12 && vq < -1e-12)) {
      const t = vp / (vp - vq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

function centroidOf(poly: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-12) return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Inside (or on) a convex polygon of either winding. */
function insideConvex(poly: Pt[], p: Pt): boolean {
  let pos = false;
  let neg = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross > 1e-9) pos = true;
    if (cross < -1e-9) neg = true;
    if (pos && neg) return false;
  }
  return true;
}

/** Whether two convex polygons share a stretch of edge (not just a corner). */
function sharesEdge(A: Pt[], B: Pt[]): boolean {
  for (let i = 0; i < A.length; i++) {
    const a0 = A[i] as Pt;
    const a1 = A[(i + 1) % A.length] as Pt;
    const len = Math.hypot(a1.x - a0.x, a1.y - a0.y);
    if (len < 1e-9) continue;
    const d = { x: (a1.x - a0.x) / len, y: (a1.y - a0.y) / len };
    const off = (p: Pt) => Math.abs(d.x * (p.y - a0.y) - d.y * (p.x - a0.x));
    const along = (p: Pt) => d.x * (p.x - a0.x) + d.y * (p.y - a0.y);
    for (let j = 0; j < B.length; j++) {
      const b0 = B[j] as Pt;
      const b1 = B[(j + 1) % B.length] as Pt;
      if (off(b0) > 1e-7 || off(b1) > 1e-7) continue;
      const lo = Math.max(0, Math.min(along(b0), along(b1)));
      const hi = Math.min(len, Math.max(along(b0), along(b1)));
      if (hi - lo > 1e-6) return true;
    }
  }
  return false;
}

/** "A".."Z", then "AA".. - a slope's letter on the plan. */
function letter(i: number): string {
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return i < 26 ? (L[i] as string) : `${L[Math.floor(i / 26) - 1]}${L[i % 26]}`;
}

/**
 * The slopes: the outline cut along every line two planes are level on, and every section edge -
 * inside each piece one plane is the roof, so the pieces of one plane that touch along an edge are
 * one slope. Exact, the roof being flat between creases. Lettered round the house from the first
 * side, as the sides are listed, every roof's slopes together (a lower roof's after the house's
 * from the same side).
 */
function facetsOf(layers: { layer: number; surface: Surface; rects: Rect[] }[], sideOrder: string[], factor: number): RoofFacet[] {
  const pieces = layers.flatMap(({ layer, surface, rects }) => slopePieces(surface, rects).map((p) => ({ ...p, layer })));
  const order = (id: string | null) => {
    const i = id === null ? -1 : sideOrder.indexOf(id);
    return i < 0 ? sideOrder.length : i;
  };
  pieces.sort((p, q) => order(p.sideId) - order(q.sideId) || p.layer - q.layer || p.plane - q.plane || p.centroid.x - q.centroid.x || p.centroid.y - q.centroid.y);
  const counts = new Map<string, number>();
  return pieces.map((p, i) => {
    const base = p.sideId ?? p.tag ?? `plane${p.plane}`;
    const k = counts.get(base) ?? 0;
    counts.set(base, k + 1);
    return {
      key: `${base}#${k}`,
      sideId: p.sideId,
      label: letter(i),
      facing: p.facing,
      cells: p.cells,
      centroid: p.centroid,
      planSquareFeet: p.plan,
      areaSquareFeet: p.plan * factor,
      layer: p.layer,
    };
  });
}

/** One roof's slopes, unlettered: the connected pieces of each plane. */
function slopePieces(surface: Surface, rects: Rect[]) {
  let cells: Pt[][] = rects.map((r) => [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ]);
  const seen = new Set<string>();
  for (const line of surface.cutLines()) {
    const len = Math.hypot(line.a, line.b);
    let a = line.a / len;
    let b = line.b / len;
    let c = line.c / len;
    const sign = Math.abs(a) > 1e-12 ? Math.sign(a) : Math.sign(b);
    a *= sign;
    b *= sign;
    c *= sign;
    const key = `${a.toFixed(6)},${b.toFixed(6)},${c.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const next: Pt[][] = [];
    for (const cell of cells) {
      const below = clipSide(cell, a, b, c);
      const above = clipSide(cell, -a, -b, -c);
      if (below.length >= 3 && polygonArea(below) > 1e-9) next.push(below);
      if (above.length >= 3 && polygonArea(above) > 1e-9) next.push(above);
    }
    cells = next;
  }

  const tagged = cells.map((poly) => {
    const m = centroidOf(poly);
    return { poly, plane: surface.planeIndexAt(m.x, m.y) };
  }).filter((c) => c.plane >= 0);

  // One slope per plane per connected piece.
  const parent = tagged.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
  for (let i = 0; i < tagged.length; i++) {
    for (let j = i + 1; j < tagged.length; j++) {
      const ci = tagged[i] as { poly: Pt[]; plane: number };
      const cj = tagged[j] as { poly: Pt[]; plane: number };
      if (ci.plane !== cj.plane || find(i) === find(j)) continue;
      if (sharesEdge(ci.poly, cj.poly)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, { plane: number; cells: Pt[][] }>();
  tagged.forEach((c, i) => {
    const root = find(i);
    const g = groups.get(root) ?? { plane: c.plane, cells: [] };
    g.cells.push(c.poly);
    groups.set(root, g);
  });

  return [...groups.values()].map((g) => {
    const plan = g.cells.reduce((s, p) => s + polygonArea(p), 0);
    const centroid = g.cells.reduce(
      (acc, p) => {
        const a = polygonArea(p);
        const m = centroidOf(p);
        return { x: acc.x + (m.x * a) / plan, y: acc.y + (m.y * a) / plan };
      },
      { x: 0, y: 0 },
    );
    const plane = surface.planes[g.plane] as Plane;
    return { plane: g.plane, sideId: plane.sideId, tag: plane.tag, cells: g.cells, plan, centroid, facing: { x: -plane.a, y: -plane.b } };
  });
}

function facetAt(facets: RoofFacet[], p: Pt): RoofFacet | null {
  for (const f of facets) if (f.cells.some((c) => insideConvex(c, p))) return f;
  return null;
}

/**
 * A line cut where the slope beside it changes: a ridge the wing's ridge stops on borders one back
 * slope to the left of the wing and another to the right, and a selection of one of them must
 * count only its own stretch. Each stretch with the slopes on its `sides` (+1 the left of the line's
 * direction, -1 the right; for the drip line, only the inside).
 */
function byFacets(surface: Surface, facets: RoofFacet[], a: Pt, b: Pt, sides: (1 | -1)[]): { t0: number; t1: number; facets: string[] }[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return [];
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -d.y, y: d.x };
  const ts = uniqSorted(surface.breaks(a, d), 0, len);
  const out: { t0: number; t1: number; facets: string[] }[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i] as number;
    const t1 = ts[i + 1] as number;
    const m = { x: a.x + d.x * ((t0 + t1) / 2), y: a.y + d.y * ((t0 + t1) / 2) };
    const keys = sides
      .map((s) => facetAt(facets, { x: m.x + n.x * s * 1e-4, y: m.y + n.y * s * 1e-4 })?.key ?? null)
      .filter((k): k is string => k !== null)
      .sort();
    const last = out[out.length - 1];
    if (last && last.facets.join("|") === keys.join("|") && Math.abs(last.t1 - t0) < 1e-9) last.t1 = t1;
    else out.push({ t0, t1, facets: keys });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The drip line in order
// ---------------------------------------------------------------------------------------------

/** The outline's corners in order round it, counter-clockwise from above. */
function boundaryLoop(edges: [Pt, Pt][]): Pt[] {
  if (edges.length === 0) return [];
  const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
  const first = edges[0] as [Pt, Pt];
  const loop: Pt[] = [first[0]];
  let cur = first[1];
  const used = new Set<number>([0]);
  for (let guard = 0; guard < edges.length && !same(cur, first[0]); guard++) {
    loop.push(cur);
    const j = edges.findIndex((e, k) => !used.has(k) && (same(e[0], cur) || same(e[1], cur)));
    if (j < 0) break;
    used.add(j);
    const e = edges[j] as [Pt, Pt];
    cur = same(e[0], cur) ? e[1] : e[0];
  }
  let signed = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i] as Pt;
    const q = loop[(i + 1) % loop.length] as Pt;
    signed += p.x * q.y - q.x * p.y;
  }
  return signed < 0 ? loop.reverse() : loop;
}

/** The side a piece of drip line runs along: the nearest wall parallel to it, inside it, beside it. */
function sideAlong(input: RoofInput, a: Pt, b: Pt): string | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return null;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const inward = { x: -d.y, y: d.x };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let best: string | null = null;
  let bestDist = Infinity;
  const n = input.corners.length;
  for (let i = 0; i < n; i++) {
    const p = input.corners[i] as Pt;
    const q = input.corners[(i + 1) % n] as Pt;
    const elen = Math.hypot(q.x - p.x, q.y - p.y);
    if (elen < 1e-9) continue;
    const e = { x: (q.x - p.x) / elen, y: (q.y - p.y) / elen };
    if (Math.abs(d.x * e.y - d.y * e.x) > 1e-6) continue;
    const dist = (p.x - m.x) * inward.x + (p.y - m.y) * inward.y;
    if (dist < -1e-6) continue;
    const ta = (a.x - p.x) * e.x + (a.y - p.y) * e.y;
    const tb = (b.x - p.x) * e.x + (b.y - p.y) * e.y;
    if (Math.min(elen, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb)) <= 1e-6) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = input.sideIds[i] ?? null;
    }
  }
  return best;
}

/** Keys that stay put: by kind and side, numbered along the side's own direction. */
function keyEdges(input: RoofInput, pieces: Omit<RoofEdge, "key">[]): RoofEdge[] {
  const n = input.corners.length;
  const along = (piece: Omit<RoofEdge, "key">) => {
    const i = piece.sideId === null ? -1 : input.sideIds.indexOf(piece.sideId);
    if (i < 0) return 0;
    const p = input.corners[i] as Pt;
    const q = input.corners[(i + 1) % n] as Pt;
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const mid = { x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2 };
    return ((mid.x - p.x) * (q.x - p.x) + (mid.y - p.y) * (q.y - p.y)) / len;
  };
  const groups = new Map<string, Omit<RoofEdge, "key">[]>();
  for (const piece of pieces) {
    const g = `${piece.kind}:${piece.sideId ?? "?"}`;
    groups.set(g, [...(groups.get(g) ?? []), piece]);
  }
  const keys = new Map<Omit<RoofEdge, "key">, string>();
  for (const [g, list] of groups) [...list].sort((p, q) => along(p) - along(q)).forEach((piece, k) => keys.set(piece, `${g}:${k}`));
  return pieces.map((piece) => ({ ...piece, key: keys.get(piece) as string }));
}

/** The stretch of a wall edge a drip-line piece runs along, as parameters along the piece; null when it is not on that wall's line. */
function alongWall(w: WallEdge, a: Pt, d: Pt): [number, number] | null {
  if (w.vertical ? Math.abs(d.x) > 1e-9 || Math.abs(a.x - w.at) > 1e-6 : Math.abs(d.y) > 1e-9 || Math.abs(a.y - w.at) > 1e-6) return null;
  const s = w.vertical ? d.y : d.x;
  const o = w.vertical ? a.y : a.x;
  const t0 = (w.from - o) / s;
  const t1 = (w.to - o) / s;
  return [Math.min(t0, t1), Math.max(t0, t1)];
}

/**
 * One roof's drip line piece by piece, cut where the slope inside it changes, in order round it: a
 * level piece is an eave, a sloped one a rake - or, where it stands against a wall, headwall and
 * step flashing.
 */
function dripPieces(surface: Surface, facets: RoofFacet[], input: RoofInput, loop: Pt[], rise: number, walls: WallEdge[], loopIndex: number, layer: number): Omit<RoofEdge, "key">[] {
  const pieces: Omit<RoofEdge, "key">[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i] as Pt;
    const b = loop[(i + 1) % n] as Pt;
    const c = loop[(i + 2) % n] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const corner: RoofEdge["cornerAtEnd"] = turn > 1e-9 ? "outside" : turn < -1e-9 ? "inside" : "straight";
    // Bends of the profile and changes of slope alike start a new stretch.
    const prof = profile(surface, a, b);
    const zAt = (t: number) => {
      for (let k = 0; k + 1 < prof.length; k++) {
        const p0 = prof[k] as { t: number; z: number | null };
        const p1 = prof[k + 1] as { t: number; z: number | null };
        if (t >= p0.t - 1e-9 && t <= p1.t + 1e-9) {
          const span = p1.t - p0.t;
          const z0 = p0.z ?? 0;
          const z1 = p1.z ?? 0;
          return span < 1e-12 ? z0 : z0 + ((z1 - z0) * (t - p0.t)) / span;
        }
      }
      return 0;
    };
    const onWalls = walls.map((w) => ({ w, span: alongWall(w, a, d) })).filter((x): x is { w: WallEdge; span: [number, number] } => x.span !== null);
    // The outline's corners are rounded to a millionth and the planes are not: a break that close to another is the same one.
    const ts = withoutSlivers(uniqSorted([...prof.map((p) => p.t), ...byFacets(surface, facets, a, b, [1]).flatMap((s) => [s.t0, s.t1]), ...onWalls.flatMap((x) => x.span)], 0, len));
    type Run = { kind: RoofEdge["kind"]; t0: number; t1: number; feet: number; facet: string | null; wall: WallEdge | null };
    const runs: Run[] = [];
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k] as number;
      const t1 = ts[k + 1] as number;
      const z0 = zAt(t0);
      const z1 = zAt(t1);
      const level = Math.abs(z1 - z0) < 1e-6;
      const tm = (t0 + t1) / 2;
      const wall = onWalls.find((x) => tm > x.span[0] && tm < x.span[1])?.w ?? null;
      const kind: RoofEdge["kind"] = wall ? (level ? "headwall" : "step") : level ? "eave" : "rake";
      const mid = { x: a.x + d.x * tm - d.y * 1e-4, y: a.y + d.y * tm + d.x * 1e-4 };
      const facet = facetAt(facets, mid)?.key ?? null;
      const feet = level ? t1 - t0 : Math.hypot(t1 - t0, (z1 - z0) * rise);
      const last = runs[runs.length - 1];
      if (last && last.kind === kind && last.facet === facet) {
        last.t1 = t1;
        last.feet += feet;
      } else runs.push({ kind, t0, t1, feet, facet, wall });
    }
    runs.forEach((r, k) => {
      const pa = { x: a.x + d.x * r.t0, y: a.y + d.y * r.t0 };
      const pb = { x: a.x + d.x * r.t1, y: a.y + d.y * r.t1 };
      pieces.push({
        kind: r.kind,
        a: pa,
        b: pb,
        za: zAt(r.t0) * rise,
        zb: zAt(r.t1) * rise,
        feet: r.feet,
        planFeet: r.t1 - r.t0,
        facets: r.facet === null ? [] : [r.facet],
        // Flashing is on the side whose wall it is against, if the wall is one of the outside's at all.
        sideId: r.wall
          ? sideOn(input, r.wall.vertical, r.wall.at, r.wall.vertical ? Math.min(pa.y, pb.y) : Math.min(pa.x, pb.x), r.wall.vertical ? Math.max(pa.y, pb.y) : Math.max(pa.x, pb.x))
          : sideAlong(input, pa, pb),
        cornerAtEnd: k === runs.length - 1 ? corner : "straight",
        layer,
        loop: loopIndex,
      });
    });
  }
  return pieces;
}

/** One continuous length of eavestrough: eave pieces end to end round the corners. */
export interface GutterRun {
  /** The drip-line pieces it runs along, in order. */
  edges: RoofEdge[];
  feet: number;
  /** All the way round with no end: a hip roof's eaves. */
  closed: boolean;
  endCaps: number;
  outsideMitres: number;
  insideMitres: number;
}

/**
 * The eavestrough the chosen eaves make (all of them when `chosen` is null): each run of eave pieces
 * that meet end to end, with a mitre at every corner it turns and an end cap wherever it stops - at
 * a rake, at flashing, at an eave not chosen, or at a hip roof's never. Each roof's drip line on its own.
 */
export function gutterRuns(plan: RoofPlan, chosen: string[] | null): GutterRun[] {
  const loops = [...new Set(plan.edges.map((e) => e.loop))];
  return loops.flatMap((loop) => runsRound(plan.edges.filter((e) => e.loop === loop), chosen));
}

function runsRound(edges: RoofEdge[], chosen: string[] | null): GutterRun[] {
  const isGutter = (e: RoofEdge | undefined) => e !== undefined && e.kind === "eave" && (chosen === null || chosen.includes(e.key));
  const n = edges.length;
  if (n === 0) return [];
  const runOf = (list: RoofEdge[], closed: boolean): GutterRun => {
    let outside = 0;
    let inside = 0;
    list.forEach((e, k) => {
      if (k === list.length - 1 && !closed) return;
      if (e.cornerAtEnd === "outside") outside += 1;
      if (e.cornerAtEnd === "inside") inside += 1;
    });
    return { edges: list, feet: list.reduce((s, e) => s + e.planFeet, 0), closed, endCaps: closed ? 0 : 2, outsideMitres: outside, insideMitres: inside };
  };
  if (edges.every((e) => isGutter(e))) return [runOf(edges, true)];
  const runs: GutterRun[] = [];
  // Start just after a piece that is not gutter, so no run is split across the start of the list.
  const start = edges.findIndex((e, i) => !isGutter(e) && isGutter(edges[(i + 1) % n]));
  if (start < 0) return [];
  let current: RoofEdge[] = [];
  for (let k = 1; k <= n; k++) {
    const e = edges[(start + k) % n] as RoofEdge;
    if (isGutter(e)) current.push(e);
    else if (current.length > 0) {
      runs.push(runOf(current, false));
      current = [];
    }
  }
  if (current.length > 0) runs.push(runOf(current, false));
  return runs;
}

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
    const n = grown.length;
    const edges: RoofEdge[] = grown.map((a, i) => {
      const b = grown[(i + 1) % n] as Pt;
      const c = grown[(i + 2) % n] as Pt;
      const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const feet = Math.hypot(b.x - a.x, b.y - a.y);
      const sideId = input.sideIds[i] ?? null;
      return {
        kind: "eave",
        key: `eave:${sideId ?? "?"}:0`,
        a,
        b,
        za: 0,
        zb: 0,
        feet,
        planFeet: feet,
        facets: [],
        sideId,
        cornerAtEnd: turn > 1e-9 ? "outside" : turn < -1e-9 ? "inside" : "straight",
        layer: 0,
        loop: 0,
      };
    });
    const waiting = (input.additions ?? []).length > 0 || (input.lowerWings ?? []).length > 0 ? " The porches, cross gables and lower roofs wait for it too." : "";
    return {
      shape: "other",
      sections: [],
      outlineRects: [],
      lines: edges,
      facets: [],
      edges,
      ends: [],
      wingEnds: [],
      pitch,
      pitchFactor: factor,
      hipFactor,
      planSquareFeet: plan,
      footprintSquareFeet,
      areaSquareFeet: plan * factor,
      totals: { ...EMPTY_TOTALS, eave: edges.reduce((s, l) => s + l.feet, 0) },
      note: `Only rectangles and L-shapes are built so far: the area and the eaves are right for this outline (all eaves, as a hip roof), but its slopes, ridge, hips, valleys and any gables are not worked out.${waiting}`,
    };
  }

  const notes: string[] = [];
  if (pitch <= 0) notes.push("A flat roof: no ridge, hips or valleys, and every edge is an eave.");
  const nameOf = (id: string) => input.sideNames?.[id] || "that side";
  const sections = withAdditions(input, built.sections, nameOf, notes);
  const { shape } = built;
  // Each roof on its own: the house's, then each lower one against a wall.
  const roofs = [...new Set(sections.map((s) => s.layer))]
    .sort((a, b) => a - b)
    .map((layer) => {
      const own = sections.filter((s) => s.layer === layer);
      const box: Box = {
        minx: Math.min(...own.map((s) => s.x0)),
        maxx: Math.max(...own.map((s) => s.x1)),
        miny: Math.min(...own.map((s) => s.y0)),
        maxy: Math.max(...own.map((s) => s.y1)),
      };
      return { layer, own, surface: new Surface(own), outline: outlineOf(own), box };
    });
  const facets = facetsOf(
    roofs.map((r) => ({ layer: r.layer, surface: r.surface, rects: r.outline.rects })),
    input.sideIds,
    factor,
  );

  // Ridges, hips and valleys: every pair of planes, kept only where the surface really folds, cut where the slopes beside them change.
  const creases: RoofLine[] = [];
  const pieces: Omit<RoofEdge, "key">[] = [];
  roofs.forEach(({ layer, own, surface, outline, box }, loop) => {
    const mine = facets.filter((f) => f.layer === layer);
    if (pitch > 0) {
      for (let i = 0; i < surface.planes.length; i++) {
        for (let j = i + 1; j < surface.planes.length; j++) {
          for (const c of creasesBetween(surface, surface.planes[i] as Plane, surface.planes[j] as Plane, box)) {
            const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
            const d = { x: (c.b.x - c.a.x) / len, y: (c.b.y - c.a.y) / len };
            for (const s of byFacets(surface, mine, c.a, c.b, [1, -1])) {
              const pa = { x: c.a.x + d.x * s.t0, y: c.a.y + d.y * s.t0 };
              const pb = { x: c.a.x + d.x * s.t1, y: c.a.y + d.y * s.t1 };
              const za = (surface.z(pa.x, pa.y) ?? 0) * rise;
              const zb = (surface.z(pb.x, pb.y) ?? 0) * rise;
              const plan = s.t1 - s.t0;
              if (plan < 1e-5) continue;
              creases.push({ kind: c.kind, key: "", a: pa, b: pb, za, zb, feet: Math.hypot(plan, zb - za), facets: s.facets, layer });
            }
          }
        }
      }
    }
    pieces.push(...dripPieces(surface, mine, input, boundaryLoop(outline.edges), rise, own.flatMap((s) => s.wallEdges), loop, layer));
  });
  const merged = mergeCollinear(creases);
  const used = new Map<string, number>();
  const keyed = merged.map((l) => {
    const base = `${l.kind}:${l.facets.join("|")}`;
    const k = used.get(base) ?? 0;
    used.set(base, k + 1);
    return { ...l, key: k === 0 ? base : `${base}:${k}` };
  });

  const edges = keyEdges(input, pieces);
  const lines: RoofLine[] = [...keyed, ...edges];
  const totals = { ...EMPTY_TOTALS };
  for (const l of lines) totals[l.kind] += l.feet;

  const ends: RoofEnd[] = [];
  for (const s of built.sections) {
    if (s.role !== "main" && s.role !== "wing") continue;
    for (const [side, kind] of [
      [s.loSide, s.lo],
      [s.hiSide, s.hi],
    ] as [string | null, SectionEnd][]) {
      if (side === null || kind === "tie" || kind === "wall") continue;
      ends.push({ sideId: side, kind, role: s.role });
    }
  }

  const planSquareFeet = roofs.reduce((sum, r) => sum + r.outline.area, 0);
  return {
    shape,
    sections,
    outlineRects: roofs.flatMap((r) => r.outline.rects.map((rect) => ({ ...rect, layer: r.layer }))),
    lines,
    facets,
    edges,
    ends,
    wingEnds: built.wingEnds,
    pitch,
    pitchFactor: factor,
    hipFactor,
    planSquareFeet,
    footprintSquareFeet,
    areaSquareFeet: planSquareFeet * factor,
    totals,
    note: notes.length > 0 ? notes.join(" ") : null,
  };
}

/**
 * How far the roof's underside climbs above the eave along a wall, from its start corner to its end,
 * as (fraction along, feet) at every bend - the gable a side carries when the roof says it has one.
 *
 * Measured at the wall face: the roof there is one overhang in from the drip line, so its height
 * at an eave wall is the overhang's worth of rise, and the gable is what it climbs above that. A
 * wall under a lower roof (a garage wing's) is read off that roof, above its own eave. Porches and
 * cross gables stand off the walls and change no side's gable.
 */
export function roofRiseAlongWall(input: RoofInput, from: Pt, to: Pt): { t: number; rise: number }[] {
  const built = roofSections(input);
  if (!built || input.pitch <= 0) return [];
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 1e-9) return [];
  const d = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  const rise = input.pitch / 12;
  const base = input.eaveOverhangFeet;
  const roofs = [...new Set(built.sections.map((s) => s.layer))]
    .sort((a, b) => a - b)
    .map((layer) => {
      const own = built.sections.filter((s) => s.layer === layer);
      return { surface: new Surface(own), walls: own.map((s) => s.wall).filter((w): w is Rect => w !== null) };
    });
  const at = (t: number): Pt => ({ x: from.x + d.x * t, y: from.y + d.y * t });
  const ts = uniqSorted(
    roofs.flatMap((r) => [...r.surface.breaks(from, d), ...r.walls.flatMap((w) => [(w.x0 - from.x) / (d.x || NaN), (w.x1 - from.x) / (d.x || NaN), (w.y0 - from.y) / (d.y || NaN), (w.y1 - from.y) / (d.y || NaN)])]),
    0,
    len,
  );
  const out: { t: number; rise: number }[] = [];
  const push = (t: number, z: number | null) => {
    const point = { t: t / len, rise: Math.max(0, ((z ?? base) - base) * rise) };
    const last = out[out.length - 1];
    if (!last || Math.abs(last.t - point.t) > 1e-12 || Math.abs(last.rise - point.rise) > 1e-9) out.push(point);
  };
  // Each stretch from the roof whose walls stand there - the house's where both do - and a step where that changes.
  for (let k = 0; k + 1 < ts.length; k++) {
    const t0 = ts[k] as number;
    const t1 = ts[k + 1] as number;
    const m = at((t0 + t1) / 2);
    const roof = roofs.find((r) => r.walls.some((w) => inside(w, m.x, m.y))) ?? (roofs[0] as (typeof roofs)[number]);
    const p0 = at(t0);
    const p1 = at(t1);
    push(t0, roof.surface.z(p0.x, p0.y));
    push(t1, roof.surface.z(p1.x, p1.y));
  }
  return out;
}
