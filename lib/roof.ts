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
 * Rectangles and L-shapes are built as they always were. Any other outline (a T, a U, the owner's
 * twelve corners, 2026-10-13) is taken apart into a MAIN roof and WINGS: the main is a rectangle of
 * the outline, every part left over a wing standing on it (or on another wing), its ridge running
 * out from the wall it stands on, the same tent as an L's wing. A wing ties into the roof it meets
 * - or, where it can't, sits lower and stops at the wall: on a gable end there is no slope to run
 * into, and a wing wider than what it meets would carry its ridge over that one's. Which rectangle
 * is the main is tried every way (`wingsRoof`). An outline that doesn't come apart that way still
 * gets its area (the outline grown by the eave overhang, × the factor) and its eave run, and says
 * that its ridge and hips are not worked out rather than inventing them.
 *
 * A wing set lower can stand under a GABLE of the roof it meets: the wing's own tent as it would be
 * tied in, its face at the wall the wing stops at, its ridge running back into the slope. The
 * owner's garage, 2026-10-13: hipped at the street end, it "ties in lower ... under a gable on the
 * house", siding between.
 *
 * A NOTCH the roof carries over - a covered deck in a corner of the house - is the estimator's to
 * say: the outline can't tell a deck under the roof from a corner of yard. Said, the notch is filled
 * in before the roof is planned, so the main roof is the rectangle with the deck in it. A porch
 * addition can't do that: it carries on a slope that is already there, and the deck changes which
 * rectangle is the main roof, and so where every slope is.
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
  /** Lower wings that stand under a gable of the roof they meet, each by the side its free end stands over. */
  wingGables?: string[];
  /** Notches the roof carries over (a covered deck), each by any one of its inner walls' sides. */
  coveredNotches?: string[];
  /** For the notes: what each side is called. */
  sideNames?: Record<string, string>;
}

/** A wing as built, by the side its free end stands over. */
export interface RoofWing {
  sideId: string;
  /** Its roof sits lower and stops at the wall of the roof it meets. */
  lower: boolean;
  /** Lower because it has to be (the note says why), not because it was said to be. */
  forced: boolean;
  /** It stands on a slope of the roof it meets, not on an end: so that roof can have a gable over it. */
  onSlope: boolean;
  /** Lower, under a gable of the roof it meets - with a strip of wall between, as the owner's garage. */
  gable: boolean;
}

/** A notch cut from the outline, which the roof can be said to carry over: a covered deck or porch. */
export interface RoofNotch {
  /** What names it in `coveredNotches`: its first inner wall in walk order. Any of `sideIds` names it too. */
  sideId: string;
  /** The sides that are its inner walls: two in a corner, three in a slot between two wings. */
  sideIds: string[];
  /** Where it is, plan feet. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  covered: boolean;
}

export interface RoofPlan {
  /** "rectangle", "L" and "wings" (a main roof and its wings) are built; "other" has an area and an eave run only. */
  shape: "rectangle" | "L" | "wings" | "other";
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
  /** The wings that could sit lower against the wall, each by the side its free end stands over: an L's two arms, or every wing. */
  wingEnds: string[];
  /** The wings as built: the L's one, or every wing. */
  wings: RoofWing[];
  /** The notches the roof could carry over, and whether it does. */
  notches: RoofNotch[];
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
function outlineOf(sections: Rect[]): { rects: Rect[]; edges: [Pt, Pt][]; area: number } {
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
 * A section's ends are first built as gables to find which side each end stands over, then rebuilt
 * with the kind that side asks for - the overhang differs (a rake's or an eave's), so the end has
 * to be known before the rectangle is.
 */
function buildSection(input: RoofInput, role: "main" | "wing", wall: Rect, axis: "x" | "y", lo: SectionEnd, hi: SectionEnd, tieAt: number | null): RoofSection {
  const probe = makeSection(input, role, wall, axis, lo, hi, tieAt);
  const loKind: SectionEnd = lo === "tie" || lo === "wall" ? lo : endKind(input, probe.loSide);
  const hiKind: SectionEnd = hi === "tie" || hi === "wall" ? hi : endKind(input, probe.hiSide);
  return makeSection(input, role, wall, axis, loKind, hiKind, tieAt);
}

/** The sections a footprint gives, and what the settings offer for them. */
export interface BuiltSections {
  shape: "rectangle" | "L" | "wings";
  sections: RoofSection[];
  wingEnds: string[];
  wings: RoofWing[];
  /** Why a wing is not as it was asked to be, or not where it might be expected. */
  notes: string[];
}

const builtFor = new WeakMap<RoofInput, BuiltSections | null>();

/**
 * The sections over a footprint: one for a rectangle, a main and a wing for an L, a main and its
 * wings for any other outline that comes apart that way (`wingsRoof`), and null for one that
 * doesn't. A notch the roof is said to carry over is filled in first. Worked out once per input:
 * the plan and every side's gable read the same sections.
 */
export function roofSections(input: RoofInput): BuiltSections | null {
  const known = builtFor.get(input);
  if (known !== undefined) return known;
  const out = sectionsOf(input);
  builtFor.set(input, out);
  return out;
}

function sectionsOf(input: RoofInput): BuiltSections | null {
  const notches = roofNotches(input);
  const grid = roofGrid(input, notches);
  // The outline the roof is planned round: the footprint, any notch it carries over filled in.
  const pts = notches.some((k) => k.covered) ? gridOutline(grid) : input.corners;
  if (!pts) return null;
  const box = boxOf(pts);
  const nameOf = (id: string) => input.sideNames?.[id] || "that side";

  if (pts.length === 4 && pts.every((_, i) => !isReflex(pts, i))) {
    let axis: "x" | "y" = box.maxx - box.minx >= box.maxy - box.miny ? "x" : "y";
    const i = input.ridgeAlong === null ? -1 : input.sideIds.indexOf(input.ridgeAlong);
    if (i >= 0) {
      const p = input.corners[i] as Pt;
      const q = input.corners[(i + 1) % input.corners.length] as Pt;
      axis = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? "x" : "y";
    }
    const wall = { x0: box.minx, x1: box.maxx, y0: box.miny, y1: box.maxy };
    return { shape: "rectangle", sections: [buildSection(input, "main", wall, axis, "gable", "gable", null)], wingEnds: [], wings: [], notes: [] };
  }

  const reflex = pts.map((_, i) => i).filter((i) => isReflex(pts, i));
  if (pts.length !== 6 || reflex.length !== 1) return wingsRoof(input, grid, nameOf);
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
  let main: RoofSection;
  let wing: RoofSection;
  if (mainIsH) {
    main = buildSection(input, "main", h, "x", "gable", "gable", null);
    const wingWall = { x0: v.x0, x1: v.x1, y0: top ? r.y : box.miny, y1: top ? box.maxy : r.y };
    const tieAt = wingLower ? r.y : top ? r.y + oe : r.y - oe;
    wing = buildSection(input, "wing", wingWall, "y", top ? join : "gable", top ? "gable" : join, tieAt);
    if (wingLower) {
      wing.layer = 1;
      wing.wallEdges = [{ vertical: false, at: r.y, from: h.x0, to: h.x1 }];
    }
  } else {
    main = buildSection(input, "main", v, "y", "gable", "gable", null);
    const wingWall = { x0: right ? r.x : box.minx, x1: right ? box.maxx : r.x, y0: h.y0, y1: h.y1 };
    const tieAt = wingLower ? r.x : right ? r.x + oe : r.x - oe;
    wing = buildSection(input, "wing", wingWall, "x", right ? join : "gable", right ? "gable" : join, tieAt);
    if (wingLower) {
      wing.layer = 1;
      wing.wallEdges = [{ vertical: true, at: r.x, from: v.y0, to: v.y1 }];
    }
  }
  const sections = [main, wing];
  const notes: string[] = [];
  const free = mainIsH ? vFar : hFar;
  const wings: RoofWing[] = [];
  if (free !== null) {
    const record: RoofWing = { sideId: free, lower: wingLower, forced: false, onSlope: true, gable: false };
    if (wingLower && (input.wingGables ?? []).includes(free)) record.gable = gableOverWing(input, sections, wing, main, free, nameOf, notes);
    wings.push(record);
  }
  return { shape: "L", sections, wingEnds, wings, notes };
}

/**
 * A gable of the roof a lower wing meets, standing over the wing: the wing's own tent as it would
 * be tied in, carried no further out than the wall the wing stops at - its face over that wall at
 * the drip line, its ridge running back into the slope. The owner's garage (2026-10-13) "ties in
 * lower ... under a gable on the house", siding between. Put in `sections` if it fits there; why
 * not in `notes` if it doesn't.
 */
function gableOverWing(input: RoofInput, sections: RoofSection[], wing: RoofSection, parent: RoofSection, sideId: string, nameOf: (id: string) => string, notes: string[]): boolean {
  const w = wing.wall;
  const P = parent.wall;
  if (!w || !P) return false;
  const oe = input.eaveOverhangFeet;
  const name = `The wing out to ${nameOf(sideId)}`;
  if (wing.axis === parent.axis) {
    notes.push(`${name} stands on an end of the roof it meets, not under a slope, so there is no gable over it.`);
    return false;
  }
  const span = wing.axis === "y" ? w.x1 - w.x0 : w.y1 - w.y0;
  if (span > (parent.axis === "x" ? P.y1 - P.y0 : P.x1 - P.x0) + 1e-6) {
    notes.push(`${name} is wider than the roof it meets: a gable over it would stand over that roof's ridge, so there is none.`);
    return false;
  }
  const half = span / 2 + oe;
  const tag = `over-${sideId}`;
  // The roof it meets is beyond the wing's wall end; the gable's face is that roof's drip line there.
  const inward = wing.hi === "wall" ? 1 : -1;
  let rect: Rect;
  let planes: Plane[];
  if (wing.axis === "y") {
    const drip = inward > 0 ? w.y1 - oe : w.y0 + oe;
    rect = { x0: w.x0 - oe, x1: w.x1 + oe, y0: Math.min(drip, drip + inward * half), y1: Math.max(drip, drip + inward * half) };
    planes = [
      { a: 1, b: 0, c: -(w.x0 - oe), sideId: null, tag: `${tag}-a` },
      { a: -1, b: 0, c: w.x1 + oe, sideId: null, tag: `${tag}-b` },
    ];
  } else {
    const drip = inward > 0 ? w.x1 - oe : w.x0 + oe;
    rect = { x0: Math.min(drip, drip + inward * half), x1: Math.max(drip, drip + inward * half), y0: w.y0 - oe, y1: w.y1 + oe };
    planes = [
      { a: 0, b: 1, c: -(w.y0 - oe), sideId: null, tag: `${tag}-a` },
      { a: 0, b: -1, c: w.y1 + oe, sideId: null, tag: `${tag}-b` },
    ];
  }
  // No further than the roof it is part of: flush with that roof's gable end, it stops at the rake.
  rect = { x0: Math.max(rect.x0, parent.x0), x1: Math.min(rect.x1, parent.x1), y0: Math.max(rect.y0, parent.y0), y1: Math.min(rect.y1, parent.y1) };
  const gable = planeSection("gable", parent.layer, rect, planes);
  if (!seamless([...sections.filter((s) => s.layer === parent.layer), gable])) {
    notes.push(`A gable over ${name.charAt(0).toLowerCase()}${name.slice(1)} would leave a step in the roof it meets, so there is none.`);
    return false;
  }
  sections.push(gable);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Notches, and the outline on a grid
// ---------------------------------------------------------------------------------------------

/** Inside a polygon of either winding, by a ray to the right. */
function insidePolygon(points: Pt[], x: number, y: number): boolean {
  let within = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Pt;
    const b = points[j] as Pt;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The notches the roof could be said to carry over: a corner cut out between two outside corners
 * (a deck in a corner of the house), or a slot between two wings out as far as the shorter one (a
 * courtyard). Only one with nothing of the house inside it.
 */
export function roofNotches(input: RoofInput): RoofNotch[] {
  const pts = input.corners;
  const n = pts.length;
  if (n < 6) return [];
  const mod = (k: number) => ((k % n) + n) % n;
  const at = (k: number) => pts[mod(k)] as Pt;
  const side = (k: number) => input.sideIds[mod(k)] ?? null;
  const reflex = (k: number) => isReflex(pts, mod(k));
  const xs = [...new Set(pts.map((p) => round6(p.x)))].sort((a, b) => a - b);
  const ys = [...new Set(pts.map((p) => round6(p.y)))].sort((a, b) => a - b);
  const clear = (r: Rect) => {
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j + 1 < ys.length; j++) {
        const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
        const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
        if (cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1 && insidePolygon(pts, cx, cy)) return false;
      }
    }
    return true;
  };
  const covered = input.coveredNotches ?? [];
  const out: RoofNotch[] = [];
  for (let i = 0; i < n; i++) {
    if (!reflex(i) || reflex(i - 1)) continue;
    let corners: Pt[];
    let walls: (string | null)[];
    if (!reflex(i + 1)) {
      corners = [at(i - 1), at(i), at(i + 1)];
      walls = [side(i - 1), side(i)];
    } else if (!reflex(i + 2)) {
      const b = at(i);
      const c = at(i + 1);
      const armA = Math.hypot(at(i - 1).x - b.x, at(i - 1).y - b.y);
      const armB = Math.hypot(at(i + 2).x - c.x, at(i + 2).y - c.y);
      const depth = Math.min(armA, armB);
      const u = { x: (at(i - 1).x - b.x) / armA, y: (at(i - 1).y - b.y) / armA };
      corners = [b, c, { x: b.x + u.x * depth, y: b.y + u.y * depth }, { x: c.x + u.x * depth, y: c.y + u.y * depth }];
      walls = [side(i - 1), side(i), side(i + 1)];
    } else continue;
    const ids = walls.filter((id): id is string => id !== null);
    if (ids.length === 0) continue;
    const r = {
      x0: round6(Math.min(...corners.map((p) => p.x))),
      x1: round6(Math.max(...corners.map((p) => p.x))),
      y0: round6(Math.min(...corners.map((p) => p.y))),
      y1: round6(Math.max(...corners.map((p) => p.y))),
    };
    if (r.x1 - r.x0 < 1e-6 || r.y1 - r.y0 < 1e-6 || !clear(r)) continue;
    out.push({ sideId: ids[0] as string, sideIds: ids, ...r, covered: ids.some((id) => covered.includes(id)) });
  }
  return out;
}

/** The roof's outline on a grid of the footprint's own lines: which cells it covers, row by row up each column. */
interface Grid {
  xs: number[];
  ys: number[];
  /** Cell [xs[i], xs[i+1]] × [ys[j], ys[j+1]] is at i·(ys.length - 1) + j. */
  cell: boolean[];
}

function roofGrid(input: RoofInput, notches: RoofNotch[]): Grid {
  const xs = [...new Set(input.corners.map((p) => round6(p.x)))].sort((a, b) => a - b);
  const ys = [...new Set(input.corners.map((p) => round6(p.y)))].sort((a, b) => a - b);
  const filled = notches.filter((k) => k.covered);
  const cell: boolean[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
      const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
      cell.push(insidePolygon(input.corners, cx, cy) || filled.some((k) => inside(k, cx, cy)));
    }
  }
  return { xs, ys, cell };
}

/** A rectangle of whole cells: [i0, i1) across, [j0, j1) up. */
interface CellBox {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

function feetOf(g: Grid, b: CellBox): Rect {
  return { x0: g.xs[b.i0] as number, x1: g.xs[b.i1] as number, y0: g.ys[b.j0] as number, y1: g.ys[b.j1] as number };
}

/** Every box of cells that are all `ok`, and a test for any box. */
function boxesOf(g: Grid, ok: (cell: number) => boolean): { boxes: CellBox[]; full: (b: CellBox) => boolean } {
  const nx = g.xs.length - 1;
  const ny = g.ys.length - 1;
  const sum: number[] = new Array<number>((nx + 1) * (ny + 1)).fill(0);
  const S = (i: number, j: number) => sum[i * (ny + 1) + j] as number;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) sum[(i + 1) * (ny + 1) + j + 1] = S(i, j + 1) + S(i + 1, j) - S(i, j) + (ok(i * ny + j) ? 1 : 0);
  }
  const full = (b: CellBox) =>
    b.i0 >= 0 && b.j0 >= 0 && b.i1 <= nx && b.j1 <= ny && b.i1 > b.i0 && b.j1 > b.j0 && S(b.i1, b.j1) - S(b.i0, b.j1) - S(b.i1, b.j0) + S(b.i0, b.j0) === (b.i1 - b.i0) * (b.j1 - b.j0);
  const boxes: CellBox[] = [];
  for (let i0 = 0; i0 < nx; i0++) {
    for (let i1 = i0 + 1; i1 <= nx; i1++) {
      for (let j0 = 0; j0 < ny; j0++) {
        for (let j1 = j0 + 1; j1 <= ny; j1++) if (full({ i0, i1, j0, j1 })) boxes.push({ i0, i1, j0, j1 });
      }
    }
  }
  return { boxes, full };
}

/** The four boxes one cell bigger. */
function grownBoxes(b: CellBox): CellBox[] {
  return [
    { ...b, i0: b.i0 - 1 },
    { ...b, i1: b.i1 + 1 },
    { ...b, j0: b.j0 - 1 },
    { ...b, j1: b.j1 + 1 },
  ];
}

/** The outline of the covered cells, counter-clockwise; null unless it is one simple loop. */
function gridOutline(g: Grid): Pt[] | null {
  const ny = g.ys.length - 1;
  const rects = g.cell.flatMap((on, k) => (on ? [feetOf(g, { i0: Math.floor(k / ny), i1: Math.floor(k / ny) + 1, j0: k % ny, j1: (k % ny) + 1 })] : []));
  if (rects.length === 0) return null;
  const { edges } = outlineOf(rects);
  const loop = boundaryLoop(edges);
  const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const round = loop.reduce((s, p, i) => s + len(p, loop[(i + 1) % loop.length] as Pt), 0);
  if (loop.length < 4 || Math.abs(round - edges.reduce((s, [a, b]) => s + len(a, b), 0)) > 1e-6) return null;
  return loop;
}

/** The covered cells in pieces that touch along an edge. */
function piecesOf(g: Grid, cells: Set<number>): Set<number>[] {
  const ny = g.ys.length - 1;
  const nx = g.xs.length - 1;
  const seen = new Set<number>();
  const out: Set<number>[] = [];
  for (const start of [...cells].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const piece = new Set<number>([start]);
    seen.add(start);
    const queue = [start];
    while (queue.length > 0) {
      const c = queue.pop() as number;
      const i = Math.floor(c / ny);
      const j = c % ny;
      for (const [a, b] of [
        [i - 1, j],
        [i + 1, j],
        [i, j - 1],
        [i, j + 1],
      ] as [number, number][]) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const k = a * ny + b;
        if (!cells.has(k) || seen.has(k)) continue;
        seen.add(k);
        piece.add(k);
        queue.push(k);
      }
    }
    out.push(piece);
  }
  return out;
}

function inBox(g: Grid, b: CellBox, cell: number): boolean {
  const ny = g.ys.length - 1;
  const i = Math.floor(cell / ny);
  const j = cell % ny;
  return i >= b.i0 && i < b.i1 && j >= b.j0 && j < b.j1;
}

/** Whether a piece shares an edge with a box. */
function touches(g: Grid, piece: Set<number>, b: CellBox): boolean {
  const ny = g.ys.length - 1;
  for (const c of piece) {
    const i = Math.floor(c / ny);
    const j = c % ny;
    if ((j >= b.j0 && j < b.j1 && (i === b.i0 - 1 || i === b.i1)) || (i >= b.i0 && i < b.i1 && (j === b.j0 - 1 || j === b.j1))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Any other outline: a main roof and its wings
// ---------------------------------------------------------------------------------------------

/** A rectangle of the outline with its ridge, standing on the one it is a wing of. */
interface Wing {
  box: CellBox;
  wall: Rect;
  axis: "x" | "y";
  /** The wing it stands on, by its place in the list; -1 for the main. */
  parent: number;
  /** The end of it that stands on the parent, and the line that end is on. */
  root: "lo" | "hi";
  at: number;
  /** On the parent's end, its ridge running the same way, rather than under one of its slopes. */
  onEnd: boolean;
  /** Wider across than the parent: tied in, its ridge would stand over the parent's. */
  wider: boolean;
}

/**
 * The wing a piece of the outline makes on `parent`: the biggest rectangle of it standing with one
 * whole end on the parent's wall - as wide along that wall as it can be while it still stands on
 * it, and as far out. One no wider than the parent first, so its ridge dies into the parent's slope.
 */
function wingOn(g: Grid, piece: Set<number>, parent: Wing, parentIndex: number): Wing | null {
  const P = parent.wall;
  const across = parent.axis === "x" ? P.y1 - P.y0 : P.x1 - P.x0;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const standing = (r: Rect): "below" | "above" | "left" | "right" | null => {
    const inX = r.x0 >= P.x0 - 1e-6 && r.x1 <= P.x1 + 1e-6;
    const inY = r.y0 >= P.y0 - 1e-6 && r.y1 <= P.y1 + 1e-6;
    if (inX && near(r.y1, P.y0)) return "below";
    if (inX && near(r.y0, P.y1)) return "above";
    if (inY && near(r.x1, P.x0)) return "left";
    if (inY && near(r.x0, P.x1)) return "right";
    return null;
  };
  const { boxes, full } = boxesOf(g, (c) => piece.has(c));
  let best: { wing: Wing; score: number[] } | null = null;
  for (const box of boxes) {
    const r = feetOf(g, box);
    const on = standing(r);
    if (on === null) continue;
    if (grownBoxes(box).some((b) => full(b) && standing(feetOf(g, b)) === on)) continue;
    const vertical = on === "left" || on === "right";
    const axis: "x" | "y" = vertical ? "x" : "y";
    const span = vertical ? r.y1 - r.y0 : r.x1 - r.x0;
    const wing: Wing = {
      box,
      wall: r,
      axis,
      parent: parentIndex,
      root: on === "below" || on === "left" ? "hi" : "lo",
      at: on === "below" ? P.y0 : on === "above" ? P.y1 : on === "left" ? P.x0 : P.x1,
      onEnd: parent.axis === axis,
      wider: span > across + 1e-6,
    };
    const score = [wing.wider ? 1 : 0, -(r.x1 - r.x0) * (r.y1 - r.y0), box.i0, box.j0];
    if (!best || before(score, best.score)) best = { wing, score };
  }
  return best?.wing ?? null;
}

/** Lexical order of two scores, the first that differs deciding. */
function before(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (Math.abs(d) > 1e-9) return d < 0;
  }
  return false;
}

/**
 * The outline taken apart from a main roof: each piece left over a wing standing on the main, and
 * what is left of each piece a wing on that wing (or, failing that, on what it was cut from, or on
 * anything else it touches). Null if some piece stands on nothing as a whole rectangle end.
 */
function takeApart(g: Grid, main: CellBox, axis: "x" | "y"): Wing[] | null {
  const plan: Wing[] = [{ box: main, wall: feetOf(g, main), axis, parent: -1, root: "lo", at: 0, onEnd: false, wider: false }];
  const rest = new Set<number>();
  g.cell.forEach((on, k) => {
    if (on && !inBox(g, main, k)) rest.add(k);
  });
  const place = (piece: Set<number>, parents: number[]): boolean => {
    for (const p of parents) {
      const wing = wingOn(g, piece, plan[p] as Wing, p);
      if (!wing) continue;
      const k = plan.push(wing) - 1;
      const left = new Set([...piece].filter((c) => !inBox(g, wing.box, c)));
      for (const bit of piecesOf(g, left)) {
        const others = plan.map((_, m) => m).filter((m) => m !== k && m !== p && touches(g, bit, (plan[m] as Wing).box));
        if (!place(bit, [k, p, ...others])) return false;
      }
      return true;
    }
    return false;
  };
  for (const piece of piecesOf(g, rest)) if (!place(piece, [0])) return null;
  return plan;
}

interface Planned {
  sections: RoofSection[];
  wingEnds: string[];
  wings: RoofWing[];
  notes: string[];
  /** Wings wider than what they meet, or that can't run into it without a step: a sign the main roof is the wrong one. */
  unsound: number;
  /** Wings that had to be lower on a gable end: a roof anyone frames. */
  forced: number;
}

/**
 * The sections of a main and its wings. A wing ties into the roof it stands on - its end carried
 * on into that roof by its own half-span, as an L's - unless it is said to sit lower, or has to:
 * on a gable end (no slope to run into: a hip end has one), wider than what it meets, or where
 * carried in it would leave a step in the roof. Lower, it is a roof of its own, stopping at the
 * wall with flashing; a wing standing on it ties into it there.
 */
function plannedSections(input: RoofInput, plan: Wing[], nameOf: (id: string) => string): Planned {
  const oe = input.eaveOverhangFeet;
  const said = input.lowerWings ?? [];
  const gables = input.wingGables ?? [];
  const head = plan[0] as Wing;
  const main = buildSection(input, "main", head.wall, head.axis, "gable", "gable", null);
  const sections: RoofSection[] = [main];
  // Each wing's own section, by its place in `plan` (a gable over a wing goes on the end of `sections`).
  const own: RoofSection[] = [main];
  const out: Planned = { sections, wingEnds: [], wings: [], notes: [], unsound: 0, forced: 0 };
  for (let k = 1; k < plan.length; k++) {
    const w = plan[k] as Wing;
    const parent = own[w.parent] as RoofSection;
    const make = (join: "tie" | "wall"): RoofSection => {
      const tieAt = join === "wall" ? w.at : w.root === "lo" ? w.at + oe : w.at - oe;
      return buildSection(input, "wing", w.wall, w.axis, w.root === "lo" ? join : "gable", w.root === "hi" ? join : "gable", tieAt);
    };
    let s = make("tie");
    const free = w.root === "lo" ? s.hiSide : s.loSide;
    const name = free === null ? "A wing" : `The wing out to ${nameOf(free)}`;
    let why: string | null = null;
    let lower = free !== null && said.includes(free);
    if (!lower) {
      // The parent's end it stands on, if it stands on one.
      const end = w.onEnd ? (w.root === "hi" ? parent.lo : parent.hi) : null;
      const endSide = w.root === "hi" ? parent.loSide : parent.hiSide;
      if (w.wider) {
        why = `${name} is wider than the roof it meets, so carried into it its ridge would stand over that roof's: it is built lower, stopping at the wall.`;
        out.unsound += 1;
      } else if (end !== null && end !== "hip") {
        why = `${name} stands on a gable end${endSide ? ` (over ${nameOf(endSide)})` : ""}, which has no slope for it to run into: it is built lower, stopping at the wall.${endSide ? " A hip there ties it in." : ""}`;
        out.forced += 1;
      } else {
        s.layer = parent.layer;
        if (!seamless([...sections.filter((x) => x.layer === s.layer), s])) {
          why = `${name} can't be carried into the roof it meets without a step in that roof: it is built lower, stopping at the wall.`;
          out.unsound += 1;
        }
      }
      lower = why !== null;
    }
    if (lower) {
      s = make("wall");
      s.layer = 1 + Math.max(...sections.map((x) => x.layer));
      const P = parent.wall as Rect;
      s.wallEdges = [w.axis === "y" ? { vertical: false, at: w.at, from: P.x0, to: P.x1 } : { vertical: true, at: w.at, from: P.y0, to: P.y1 }];
      if (why) out.notes.push(why);
    }
    sections.push(s);
    own.push(s);
    if (free === null) continue;
    out.wingEnds.push(free);
    const record: RoofWing = { sideId: free, lower, forced: why !== null, onSlope: !w.onEnd, gable: false };
    if (lower && gables.includes(free)) record.gable = gableOverWing(input, sections, s, parent, free, nameOf, out.notes);
    out.wings.push(record);
  }
  return out;
}

/**
 * Whether these sections make one roof with no step in it: wherever a section's reach ends inside
 * the roof, what is beyond stands as high. A wing carried into a gable end, or wider than the roof
 * it meets, is not; nor is anything else that only looks like a roof from above.
 */
function seamless(sections: RoofSection[]): boolean {
  const surface = new Surface(sections);
  const d = 1e-5;
  for (const s of sections) {
    const r = sectionDomain(s);
    const sides: [Pt, Pt, Pt][] = [
      [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: 0, y: -1 }],
      [{ x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: 1, y: 0 }],
      [{ x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }, { x: 0, y: 1 }],
      [{ x: r.x0, y: r.y1 }, { x: r.x0, y: r.y0 }, { x: -1, y: 0 }],
    ];
    for (const [a, b, out] of sides) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const ts = uniqSorted(surface.breaks(a, dir), 0, len);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k] as number;
        const t1 = ts[k + 1] as number;
        if (t1 - t0 < 1e-6) continue;
        // Between two bends both sides are flat: the two ends and the middle settle it.
        for (const t of [t0 + (t1 - t0) * 0.01, (t0 + t1) / 2, t1 - (t1 - t0) * 0.01]) {
          const p = { x: a.x + dir.x * t, y: a.y + dir.y * t };
          const zIn = surface.z(p.x - out.x * d, p.y - out.y * d);
          const zOut = surface.z(p.x + out.x * d, p.y + out.y * d);
          if (zIn !== null && zOut !== null && Math.abs(zIn - zOut) > 1e-4) return false;
        }
      }
    }
  }
  return true;
}

/** Valleys between two slopes facing each other: level, so water lies in them. No one frames a roof that way by choice. */
function levelValleys(sections: RoofSection[]): number {
  let count = 0;
  for (const layer of new Set(sections.map((s) => s.layer))) {
    const own = sections.filter((s) => s.layer === layer);
    const surface = new Surface(own);
    const box: Box = {
      minx: Math.min(...own.map((s) => s.x0)),
      maxx: Math.max(...own.map((s) => s.x1)),
      miny: Math.min(...own.map((s) => s.y0)),
      maxy: Math.max(...own.map((s) => s.y1)),
    };
    const planes = surface.planes;
    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        const p = planes[i] as Plane;
        const q = planes[j] as Plane;
        if (Math.abs(p.a + q.a) > 1e-9 || Math.abs(p.b + q.b) > 1e-9) continue;
        count += creasesBetween(surface, p, q, box).filter((c) => c.kind === "valley").length;
      }
    }
  }
  return count;
}

/** A side's wall, as a line: vertical or not, where, and from and to along it. */
function wallOf(input: RoofInput, sideId: string | null): WallEdge | null {
  const i = sideId === null ? -1 : input.sideIds.indexOf(sideId);
  if (i < 0) return null;
  const p = input.corners[i] as Pt;
  const q = input.corners[(i + 1) % input.corners.length] as Pt;
  const vertical = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
  return vertical ? { vertical, at: p.x, from: Math.min(p.y, q.y), to: Math.max(p.y, q.y) } : { vertical, at: p.y, from: Math.min(p.x, q.x), to: Math.max(p.x, q.x) };
}

/**
 * A main roof and its wings over an outline that is neither a rectangle nor an L: the T, the U, the
 * owner's twelve corners. Every rectangle of the outline that can't be made bigger is tried as the
 * main, its ridge each way. One that leaves a level valley is no roof anyone frames, and is not
 * kept; of the rest, in order: the one with no wing wider than what it meets, nor one that can't be
 * carried into it without a step (a house's body beside a deep garage, not the garage run on through
 * the house); the biggest; the one with the fewest wings that had to be lower on a gable end; the
 * one whose ridge runs along its longer walls. `ridgeAlong` names the side the main roof stands
 * over, its ridge along it, when the estimator says which it is.
 */
function wingsRoof(input: RoofInput, g: Grid, nameOf: (id: string) => string): BuiltSections | null {
  const { boxes, full } = boxesOf(g, (c) => g.cell[c] === true);
  const mains = boxes.filter((b) => !grownBoxes(b).some(full));
  const spanOf = (box: CellBox, axis: "x" | "y") => {
    const W = feetOf(g, box);
    return { along: axis === "x" ? W.x1 - W.x0 : W.y1 - W.y0, across: axis === "x" ? W.y1 - W.y0 : W.x1 - W.x0 };
  };
  const all = mains.flatMap((box) => (["x", "y"] as const).map((axis) => ({ box, axis })));
  // Its ridge across the longer walls only on a nearly square main: across a long one, every wing is "narrower" under a ridge no one would frame.
  const tries = all.filter(({ box, axis }) => spanOf(box, axis).along >= 0.8 * spanOf(box, axis).across - 1e-9);
  const over = wallOf(input, input.ridgeAlong);
  const onIt = (r: Rect, w: WallEdge) =>
    w.vertical
      ? (Math.abs(r.x0 - w.at) < 1e-6 || Math.abs(r.x1 - w.at) < 1e-6) && Math.min(r.y1, w.to) - Math.max(r.y0, w.from) > 1e-6
      : (Math.abs(r.y0 - w.at) < 1e-6 || Math.abs(r.y1 - w.at) < 1e-6) && Math.min(r.x1, w.to) - Math.max(r.x0, w.from) > 1e-6;
  const theirs = over ? all.filter(({ box, axis }) => axis === (over.vertical ? "y" : "x") && onIt(feetOf(g, box), over)) : [];
  let best: { score: number[]; planned: Planned } | null = null;
  for (const { box, axis } of theirs.length > 0 ? theirs : tries) {
    const plan = takeApart(g, box, axis);
    if (!plan) continue;
    const planned = plannedSections(input, plan, nameOf);
    if (levelValleys(planned.sections) > 0) continue;
    const W = feetOf(g, box);
    const { along, across } = spanOf(box, axis);
    const score = [planned.unsound, -along * across, planned.forced, along >= across - 1e-9 ? 0 : 1, W.x0, W.y0];
    if (!best || before(score, best.score)) best = { score, planned };
  }
  if (!best) return null;
  const notes = [...best.planned.notes];
  if (over && theirs.length === 0 && input.ridgeAlong !== null) notes.unshift(`No main roof here stands over ${nameOf(input.ridgeAlong)} with its ridge along it, so the main roof is worked out from the outline.`);
  return { shape: "wings", sections: best.planned.sections, wingEnds: best.planned.wingEnds, wings: best.planned.wings, notes };
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
    // Only round an outside corner does a porch run on past the side's end; at an inside one the next wall stops it.
    const outsideStart = lo <= 1e-6 && !isReflex(input.corners, i);
    const outsideEnd = hi >= len - 1e-6 && !isReflex(input.corners, (i + 1) % n);
    // The wall that stops it there - the garage's side, say - which it is flashed against when that is a roof apart.
    const lineOf = (u: Pt, v: Pt): WallEdge =>
      Math.abs(u.x - v.x) < 1e-9 ? { vertical: true, at: u.x, from: Math.min(u.y, v.y), to: Math.max(u.y, v.y) } : { vertical: false, at: u.y, from: Math.min(u.x, v.x), to: Math.max(u.x, v.x) };
    const stops: WallEdge[] = [
      ...(lo <= 1e-6 && !outsideStart ? [lineOf(input.corners[(i - 1 + n) % n] as Pt, p)] : []),
      ...(hi >= len - 1e-6 && !outsideEnd ? [lineOf(q, input.corners[(i + 2) % n] as Pt)] : []),
    ];

    if (add.kind === "porch" && add.lower) {
      const depth = add.depthFeet ?? 0;
      if (depth <= 1e-6) {
        notes.push(`The porch roof on ${name} needs its depth from the wall.`);
        continue;
      }
      // At a corner of the side it runs on past it by a rake's overhang, as the roof above does.
      const a0 = outsideStart ? -input.rakeOverhangFeet : lo;
      const a1 = outsideEnd ? len + input.rakeOverhangFeet : hi;
      // One slope, rising from its eave to the wall: run in from the eave is depth - out.
      const plane: Plane = { a: -out.x, b: -out.y, c: depth + p.x * out.x + p.y * out.y, sideId: add.sideId, tag: add.id };
      const vertical = Math.abs(d.x) < 0.5;
      const wallEdge: WallEdge = vertical ? { vertical, at: p.x, from: Math.min(p.y, q.y), to: Math.max(p.y, q.y) } : { vertical, at: p.y, from: Math.min(p.x, q.x), to: Math.max(p.x, q.x) };
      const layer = 1 + Math.max(...sections.map((s) => s.layer));
      sections.push(planeSection("porch", layer, rectOf(a0, a1, 0, depth), [plane], [wallEdge, ...stops]));
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
      const a0 = outsideStart ? Math.min(...reach) : lo;
      const a1 = outsideEnd ? Math.max(...reach) : hi;
      sections.push(planeSection("porch", owner.layer, rectOf(a0, a1, dripOut, depth), [plane], stops));
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
    /*
      A stretch's two end heights, read from just inside it and just inside the roof. At a break the
      roof can step - the face of a gable over a garage stands above the porch roof running under it -
      and what the stretch carries is its own slope, not the height of what stands over its end.
    */
    const inward = { x: -d.y, y: d.x };
    const zIn = (t: number) => surface.z(a.x + d.x * t + inward.x * 1e-6, a.y + d.y * t + inward.y * 1e-6);
    const endsOf = (t0: number, t1: number): [number, number] => {
      const e = Math.min(1e-4, (t1 - t0) / 4);
      const u = zIn(t0 + e) ?? zAt(t0);
      const v = zIn(t1 - e) ?? zAt(t1);
      const slope = (v - u) / (t1 - t0 - 2 * e);
      return [u - slope * e, v + slope * e];
    };
    const onWalls = walls.map((w) => ({ w, span: alongWall(w, a, d) })).filter((x): x is { w: WallEdge; span: [number, number] } => x.span !== null);
    // The outline's corners are rounded to a millionth and the planes are not: a break that close to another is the same one.
    const ts = withoutSlivers(uniqSorted([...prof.map((p) => p.t), ...byFacets(surface, facets, a, b, [1]).flatMap((s) => [s.t0, s.t1]), ...onWalls.flatMap((x) => x.span)], 0, len));
    type Run = { kind: RoofEdge["kind"]; t0: number; t1: number; z0: number; z1: number; feet: number; facet: string | null; wall: WallEdge | null };
    const runs: Run[] = [];
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k] as number;
      const t1 = ts[k + 1] as number;
      const [z0, z1] = endsOf(t0, t1);
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
        last.z1 = z1;
        last.feet += feet;
      } else runs.push({ kind, t0, t1, z0, z1, feet, facet, wall });
    }
    runs.forEach((r, k) => {
      const pa = { x: a.x + d.x * r.t0, y: a.y + d.y * r.t0 };
      const pb = { x: a.x + d.x * r.t1, y: a.y + d.y * r.t1 };
      pieces.push({
        kind: r.kind,
        a: pa,
        b: pb,
        za: r.z0 * rise,
        zb: r.z1 * rise,
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
    const notches = roofNotches(input);
    const deck = notches.some((k) => !k.covered) ? " If the roof carries over one of its notches (a covered deck), saying so may let it." : "";
    return {
      shape: "other",
      sections: [],
      outlineRects: [],
      lines: edges,
      facets: [],
      edges,
      ends: [],
      wingEnds: [],
      wings: [],
      notches,
      pitch,
      pitchFactor: factor,
      hipFactor,
      planSquareFeet: plan,
      footprintSquareFeet,
      areaSquareFeet: plan * factor,
      totals: { ...EMPTY_TOTALS, eave: edges.reduce((s, l) => s + l.feet, 0) },
      note: `This outline doesn't come apart into a main roof and wings that meet it, so only its area and its eaves are worked out (all eaves, as a hip roof): its slopes, ridge, hips, valleys and any gables are not.${deck}${waiting}`,
    };
  }

  const notes: string[] = [];
  if (pitch <= 0) notes.push("A flat roof: no ridge, hips or valleys, and every edge is an eave.");
  notes.push(...built.notes);
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
      // Two ends over one side follow the one setting: listed once.
      if (side === null || kind === "tie" || kind === "wall" || ends.some((e) => e.sideId === side)) continue;
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
    wings: built.wings,
    notches: roofNotches(input),
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
  // A wall the roof carries over - the back of a covered deck - stands under the roof, not under its edge: no gable.
  const beyond = { x: (from.x + to.x) / 2 + d.y * 1e-3, y: (from.y + to.y) / 2 - d.x * 1e-3 };
  if (roofNotches(input).some((k) => k.covered && beyond.x > k.x0 && beyond.x < k.x1 && beyond.y > k.y0 && beyond.y < k.y1)) return [];
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
