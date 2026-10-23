import type { DeckPartKind } from "./decks";
import type { CladdingKind, ExteriorOpeningKind, TrimPart } from "./exterior";
import type { ExteriorModel3D, V3, Wall3D, WallFaceKind } from "./exterior3d";
import { POST_SIZE_FEET } from "./exterior3d";
import type { Pt } from "./roof";

/**
 * The house's four elevations (2026-10-16, the owner: "consider 4 main elevation views for n/s/e/w. the
 * individual sides and shapes are fine to include but an overview of the full face on view would be nice
 * as well"): the 3D model (lib/exterior3d.ts, the walls already standing up to the roof) looked at
 * square-on from each side, drawn as an architect's elevation sheet draws it.
 *
 * An orthographic view: what is nearer covers what is behind, drawn back to front - each wall that
 * faces the view with its cladding and openings, each slope of the roof that faces it, the fascia, the
 * posts. A wall or a slope turned away is behind the house and is left out; one seen edge-on draws nothing.
 *
 * Which way they are named (2026-10-20, the owner: "fix the front label to north"): the views are always square to
 * the house - from in front of it, from its right, from behind it and from its left, as you face its front from
 * outside - and are named by the compass only when the exterior says which way its front faces
 * (`Exterior.frontFacesDeg`). Then each is named by the way its wall faces, to the nearest of north, east, south
 * and west: a front facing 20 degrees west of north has the North elevation for its view, and the wall on its
 * right, as you face it, the West. Without it they are the Front, Right side, Back and Left side elevations: before
 * 2026-10-20 the front was taken to be south, which named a north-facing house's every view wrong.
 *
 * Feet. In a view, x runs left to right as the viewer sees it, y is up as the model has it.
 */

/** Which side of the house a view is from, as you face the house's front from outside. */
export type ViewFrom = "front" | "right" | "back" | "left";

/** In the order an elevation sheet gives them: the front, round to the right. */
export const VIEWS: ViewFrom[] = ["front", "right", "back", "left"];

const VIEW_WORD: Record<ViewFrom, string> = { front: "Front", right: "Right side", back: "Back", left: "Left side" };

export type Compass = "north" | "east" | "south" | "west";

/** Clockwise from north. */
const COMPASS_ROUND: Compass[] = ["north", "east", "south", "west"];

export const COMPASS_WORD: Record<Compass, string> = { north: "North", east: "East", south: "South", west: "West" };

/**
 * The one-tap choices for which way the front faces (the exterior editor, 2026-10-20): degrees clockwise from north.
 * "Not set" is none of them: the exterior has no `frontFacesDeg`.
 */
export const FRONT_FACES_CHOICES: { deg: number; label: string; words: string }[] = [
  { deg: 0, label: "N", words: "north" },
  { deg: 45, label: "NE", words: "northeast" },
  { deg: 90, label: "E", words: "east" },
  { deg: 135, label: "SE", words: "southeast" },
  { deg: 180, label: "S", words: "south" },
  { deg: 225, label: "SW", words: "southwest" },
  { deg: 270, label: "W", words: "west" },
  { deg: 315, label: "NW", words: "northwest" },
];

/** Degrees from 0 up to 360. */
export function normalDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Which way an exterior's front faces, 0 up to 360 clockwise from north; undefined when not set. */
export function frontFacesOf(exterior: { frontFacesDeg?: number }): number | undefined {
  const d = exterior.frontFacesDeg;
  return typeof d === "number" && Number.isFinite(d) ? normalDeg(d) : undefined;
}

/** How far each view's wall faces round from the front's: the right side a quarter anticlockwise of it, as a map has it. */
const TURN: Record<ViewFrom, number> = { front: 0, right: -90, back: 180, left: 90 };

/** The way the wall a view looks at faces, clockwise from north, for a front facing [frontFacesDeg]. */
export function viewFacesDeg(from: ViewFrom, frontFacesDeg: number): number {
  return normalDeg(frontFacesDeg + TURN[from]);
}

/**
 * The way a direction on the plan faces, clockwise from north (the plan: x to the right of the front, y to the back,
 * the front facing -y). The plan is the map turned, never mirrored.
 */
export function planFacesDeg(dir: Pt, frontFacesDeg: number): number {
  return normalDeg(frontFacesDeg + 180 + (Math.atan2(dir.x, dir.y) * 180) / Math.PI);
}

/** North on the plan, a unit direction (x to the right of the front, y to the back). */
export function northOnPlan(frontFacesDeg: number): Pt {
  const r = (frontFacesDeg * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

/** The nearest of north, east, south and west; halfway between, the one clockwise (northeast is east). */
export function compassOf(deg: number): Compass {
  return COMPASS_ROUND[Math.round(Math.round(normalDeg(deg) * 1e6) / 1e6 / 90) % 4] as Compass;
}

/** "Front elevation" with no bearing; "North elevation" for a front facing 16 degrees. */
export function viewTitle(from: ViewFrom, frontFacesDeg?: number): string {
  return frontFacesDeg === undefined ? `${VIEW_WORD[from]} elevation` : `${COMPASS_WORD[compassOf(viewFacesDeg(from, frontFacesDeg))]} elevation`;
}

/** "north", "northeast", or "16° east of north": which way a bearing faces, in words. */
export function bearingWords(deg: number): string {
  const d = normalDeg(Math.round(deg));
  const eight = FRONT_FACES_CHOICES.find((c) => c.deg === d);
  if (eight) return eight.words;
  const c = Math.round(d / 90) % 4;
  const off = normalDeg(d - c * 90);
  const signed = off > 180 ? off - 360 : off;
  return `${Math.abs(signed)}° ${COMPASS_ROUND[(c + (signed > 0 ? 1 : 3)) % 4]} of ${COMPASS_ROUND[c]}`;
}

/** The way the viewer looks, in plan (x right, y to the back): from in front they look to the back. */
const LOOKS: Record<ViewFrom, Pt> = { front: { x: 0, y: 1 }, right: { x: -1, y: 0 }, back: { x: 0, y: -1 }, left: { x: 1, y: 0 } };

/** A wall seen nearer than this to edge-on is not drawn: it would be a sliver. */
const FACING = 0.2;

export interface ViewWall {
  type: "wall";
  id: string;
  sideId: string | null;
  name: string;
  /** How far back from the viewer: what is drawn first is furthest. */
  depth: number;
  /** Its face from the ground (or what it stands on) up to the roof, in the view. */
  outline: Pt[];
  faces: { kind: WallFaceKind; poly: Pt[]; colour?: string }[];
  /** Its trim against it, in the view (2026-10-17): each piece's face, and how far it stands out. Absent with none. */
  trim?: { part: TrimPart; poly: Pt[]; out: number; material: CladdingKind; colour?: string }[];
  background: Wall3D["background"];
  /** Its colour off the photos, where read (2026-10-17). */
  backgroundColour?: string;
  /** `said`: said on site on a wall no photo faces (2026-10-21): drawn faint and dashed, not measured. */
  openings: { id: string; kind: ExteriorOpeningKind; x0: number; x1: number; y0: number; y1: number; said?: true }[];
  /** The ground it stands on, left to right; null for a wall standing on a roof or a deck's ceiling. */
  grade: Pt[] | null;
  /** How squarely it faces the view: 1 square-on. Its marks are drawn a little lighter turned away. */
  facing: number;
  /** A party wall (2026-10-17): drawn bare and marked "Shared wall" - the neighbour's home stands against it. */
  shared?: true;
  /** A wall no photo faces (2026-10-21): marked "Not photographed", never left to read as a wall with no windows. */
  unseen?: "unknown" | "said" | "none";
  /** A two-storey house's main wall standing to the floor line (2026-10-19): its top is the floor line, not an eave. */
  toFloorLine?: true;
  /** An upper wall standing on a lower roof: how many of the outline's points are its bottom (`Wall3D.bottomPoints`). */
  bottomPoints?: number;
}

export interface ViewRoof {
  type: "roof";
  /** "edge": a slope seen edge-on - drawn as its line, the roof's profile, with nothing to fill. */
  kind: "slope" | "edge" | "fascia" | "gable" | "step";
  depth: number;
  poly: Pt[];
  /** How squarely it faces the view, 0 to 1. */
  facing: number;
}

export interface ViewPost {
  type: "post";
  depth: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * A column standing clear of a wall (2026-10-17): a porch column, seen from any side - each piece (base, shaft, cap) the
 * box it is, square-on.
 */
export interface ViewColumn {
  type: "column";
  depth: number;
  pieces: { part: TrimPart; x0: number; x1: number; y0: number; y1: number }[];
  material: CladdingKind;
  colour?: string;
}

/**
 * A flat piece of a deck (2026-10-20, lib/decks.ts): its rim, a post's face, a railing's glass or pickets and cap, a
 * stair's riser or stringer, a screen - each where it is, seen square-on. Level pieces (the decking, a tread) are edge-on
 * in an elevation and not drawn.
 */
export interface ViewDeck {
  type: "deck";
  deckId: string;
  kind: DeckPartKind;
  depth: number;
  poly: Pt[];
  /** How squarely it faces the view, 0 to 1. */
  facing: number;
  material?: string;
}

export type ViewPiece = ViewWall | ViewRoof | ViewPost | ViewColumn | ViewDeck;

export interface HouseView {
  from: ViewFrom;
  /** "North elevation" when the front's bearing is known, else "Front elevation" (`viewTitle`). */
  title: string;
  /** Back to front: the order they are drawn in. */
  pieces: ViewPiece[];
  /** The ground as the view sees it at the foot of the house, left to right: each stretch the nearest wall's. */
  ground: Pt[];
  /** The house's walls left to right, and the roof's top. */
  minX: number;
  maxX: number;
  topY: number;
  /** The lowest ground the view shows: heights on the sheet are from it. */
  groundY: number;
  /** The sides it shows, left to right, by their names: a side shows when some of its wall does. */
  sides: { sideId: string; name: string }[];
  /** The main levels: the eave of each of the widest walls, and the roof's top. */
  levels: { label: string; y: number }[];
  /**
   * Where the house is cut by a party line seen edge-on (2026-10-17): a wall shared with the neighbour's home, at
   * view x, from its foot to its top, and which way the neighbour's home is (+1 to the right). Drawn as a clean cut.
   */
  party: { x: number; y0: number; y1: number; side: 1 | -1 }[];
}

const plan = (v: V3): Pt => ({ x: v[0], y: -v[2] });

/** Newell's normal of a polygon in 3D, as plan x, plan y and up. */
function normalOf(poly: V3[]): { x: number; y: number; z: number } {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as V3;
    const q = poly[(i + 1) % poly.length] as V3;
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  // View (x, up, z = -plan y) to plan (x, y, up).
  return { x: nx / len, y: -nz / len, z: ny / len };
}

function area2(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** A polyline's y at x, flat past its ends. */
function yAt(line: Pt[], x: number): number {
  const first = line[0] as Pt;
  const last = line[line.length - 1] as Pt;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let k = 0; k + 1 < line.length; k++) {
    const p = line[k] as Pt;
    const q = line[k + 1] as Pt;
    if (x >= p.x && x <= q.x && q.x - p.x > 1e-9) return p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
  }
  return last.y;
}

/** The house seen from [from]: named by the compass when [frontFacesDeg], the way its front faces, is known. */
export function houseView(model: ExteriorModel3D, from: ViewFrom, frontFacesDeg?: number): HouseView {
  const look = LOOKS[from];
  // The viewer's right hand: the way they look, turned a quarter clockwise.
  const right = { x: look.y, y: -look.x };
  const sx = (p: Pt) => p.x * right.x + p.y * right.y;
  const depthOf = (p: Pt) => p.x * look.x + p.y * look.y;
  const pieces: ViewPiece[] = [];

  // ---- Walls facing the view --------------------------------------------------------------------
  const party: HouseView["party"] = [];
  for (const w of model.walls) {
    const out = { x: w.out[0], y: -w.out[2] };
    const facing = -(out.x * look.x + out.y * look.y);
    // A column standing clear of the wall (2026-10-17): seen from every side, whichever way the wall faces.
    const clear = (w.trim ?? []).filter((t) => !t.onWall);
    if (clear.length > 0) {
      const o = plan(w.origin);
      const along = { x: w.along[0], y: -w.along[2] };
      const corner = (u: number, d: number): Pt => ({ x: o.x + along.x * u + out.x * d, y: o.y + along.y * u + out.y * d });
      const box = (t: (typeof clear)[number]) => {
        const us = t.poly.map((p) => p.x);
        const ps = [corner(Math.min(...us), t.w0), corner(Math.max(...us), t.w0), corner(Math.max(...us), t.w1), corner(Math.min(...us), t.w1)];
        const xs = ps.map(sx);
        const ys = t.poly.map((p) => p.y);
        return { part: t.part, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), depth: Math.min(...ps.map(depthOf)) };
      };
      // One piece a column, its base, shaft and cap together: by the column each belongs to, along the wall.
      const columns = new Map<string, typeof clear>();
      for (const t of clear) {
        const us = t.poly.map((p) => p.x);
        const key = `${Math.round(((Math.min(...us) + Math.max(...us)) / 2) * 4)}`;
        columns.set(key, [...(columns.get(key) ?? []), t]);
      }
      for (const parts of columns.values()) {
        const boxes = parts.map(box);
        const first = parts[0] as (typeof clear)[number];
        pieces.push({ type: "column", depth: Math.min(...boxes.map((b) => b.depth)), pieces: boxes.map(({ depth: _d, ...b }) => b), material: first.material, ...(first.colour ? { colour: first.colour } : {}) });
      }
    }
    // A shared wall seen edge-on is where the house is cut: the neighbour's home carries on past it.
    if (w.shared && Math.abs(facing) < FACING) {
      const ys = w.outline.map((p) => p.y);
      const foot = w.grade && w.grade.length > 0 ? Math.min(...w.grade.map((p) => p.y)) : Math.min(...ys);
      const side = out.x * right.x + out.y * right.y > 0 ? 1 : -1;
      party.push({ x: sx(plan(w.origin)), y0: foot, y1: Math.max(...ys), side });
    }
    if (facing < FACING) continue;
    const o = plan(w.origin);
    const along = { x: w.along[0], y: -w.along[2] };
    const k = along.x * right.x + along.y * right.y;
    const x0 = sx(o);
    const at = (q: Pt): Pt => ({ x: x0 + q.x * k, y: q.y });
    const bottom = w.bottomPoints ?? 2;
    const top = w.outline.slice(bottom);
    const outline = w.grade && w.grade.length >= 2 ? [...w.grade, ...top].map(at) : w.outline.map(at);
    pieces.push({
      type: "wall",
      id: w.id,
      sideId: w.sideId,
      name: w.name,
      depth: Math.min(depthOf(o), depthOf({ x: o.x + along.x * w.length, y: o.y + along.y * w.length })),
      outline,
      faces: w.faces.map((f) => ({ kind: f.kind, poly: f.poly.map(at), ...(f.colour ? { colour: f.colour } : {}) })),
      ...((w.trim ?? []).some((t) => t.onWall)
        ? { trim: (w.trim ?? []).filter((t) => t.onWall).map((t) => ({ part: t.part, poly: t.poly.map(at), out: t.w1, material: t.material, ...(t.colour ? { colour: t.colour } : {}) })) }
        : {}),
      background: w.background,
      ...(w.backgroundColour ? { backgroundColour: w.backgroundColour } : {}),
      openings: w.openings.map((op) => {
        const a = at({ x: op.x0, y: op.y0 });
        const b = at({ x: op.x1, y: op.y1 });
        return { id: op.id, kind: op.kind, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: op.y0, y1: op.y1, ...(op.said ? { said: true as const } : {}) };
      }),
      grade: w.grade && w.grade.length >= 2 ? w.grade.map(at) : null,
      facing,
      ...(w.shared ? { shared: true as const } : {}),
      ...(w.unseen ? { unseen: w.unseen } : {}),
      ...(w.toFloorLine ? { toFloorLine: true as const } : {}),
      ...(!(w.grade && w.grade.length >= 2) && w.bottomPoints !== undefined ? { bottomPoints: w.bottomPoints } : {}),
    });
  }

  // ---- The roof: the slopes and faces that face the view -------------------------------------------
  const project = (poly: V3[]) => poly.map((v) => ({ x: sx(plan(v)), y: v[1] }));
  const roofPiece = (kind: ViewRoof["kind"], poly: V3[], facing: number) => {
    const flat = project(poly);
    if (Math.abs(area2(flat)) < 1e-4) return;
    pieces.push({ type: "roof", kind, poly: flat, depth: Math.min(...poly.map((v) => depthOf(plan(v)))), facing });
  };
  const roof = model.roof;
  if (roof) {
    // Each slope whole: its cells joined, so only its own edges - eaves, rakes, hips, valleys, ridges - are drawn.
    const byFacet = new Map<string, V3[][]>();
    for (const f of roof.faces) byFacet.set(f.facet, [...(byFacet.get(f.facet) ?? []), f.poly]);
    for (const cells of byFacet.values()) {
      for (const poly of joinCells(cells)) {
        const n = normalOf(poly);
        // Up-facing by construction; it faces the view where it tips toward the viewer, and is edge-on where it neither tips toward nor away.
        const toward = -(n.x * look.x + n.y * look.y);
        const level = Math.hypot(n.x, n.y);
        if (toward > 1e-3) roofPiece("slope", poly, level > 1e-9 ? toward / level : 0);
        else if (toward > -1e-3) pieces.push({ type: "roof", kind: "edge", poly: project(poly), depth: Math.min(...poly.map((v) => depthOf(plan(v)))), facing: 0 });
      }
    }
    for (const f of roof.fasciaFaces) {
      const toward = -(f.out.x * look.x + f.out.y * look.y);
      if (toward > FACING) roofPiece("fascia", f.poly, toward);
    }
    // A cross gable's face and a step's face, either way round: seen when they are not edge-on.
    const triangles = (flat: number[]) => {
      const out: V3[][] = [];
      for (let i = 0; i + 8 < flat.length; i += 9) out.push([0, 3, 6].map((j) => [flat[i + j], flat[i + j + 1], flat[i + j + 2]] as V3));
      return out;
    };
    for (const t of triangles(roof.gables)) {
      const n = normalOf(t);
      const toward = Math.abs(n.x * look.x + n.y * look.y);
      if (toward > FACING) roofPiece("gable", t, toward);
    }
    for (const t of triangles(roof.steps)) {
      const n = normalOf(t);
      const toward = Math.abs(n.x * look.x + n.y * look.y);
      if (toward > FACING) roofPiece("step", t, toward);
    }
  }

  // ---- Posts ------------------------------------------------------------------------------------------
  for (const p of model.posts) {
    const at = { x: p.x, y: -p.z };
    const c = sx(at);
    if (!Number.isFinite(p.y0)) continue;
    pieces.push({ type: "post", depth: depthOf(at), x0: c - POST_SIZE_FEET / 2, x1: c + POST_SIZE_FEET / 2, y0: p.y0, y1: p.y1 });
  }

  // ---- Decks (2026-10-20): each upright piece that isn't edge-on; a panel seen from either side -----------------
  const TWO_SIDED = new Set<DeckPartKind>(["glass", "pickets", "cable", "rail", "screen", "skirting", "stringer"]);
  const deckSpans = new Map<string, { x0: number; x1: number; y: number; depth: number }>();
  for (const part of model.decks ?? []) {
    if (!part.normal) continue;
    const toward = -(part.normal.x * look.x + part.normal.y * look.y);
    const seen = TWO_SIDED.has(part.kind) ? Math.abs(toward) : toward;
    if (seen < 0.12) continue;
    const flat = project(part.poly);
    if (Math.abs(area2(flat)) < 1e-4) continue;
    const depth = Math.min(...part.poly.map((v) => depthOf(plan(v))));
    pieces.push({ type: "deck", deckId: part.deckId, kind: part.kind, depth, poly: flat, facing: seen, ...(part.material ? { material: part.material } : {}) });
    // Where the deck stands in the view, and its ground: the foot of its lowest piece.
    const s = deckSpans.get(part.deckId) ?? { x0: Infinity, x1: -Infinity, y: Infinity, depth: Infinity };
    for (const p of flat) {
      s.x0 = Math.min(s.x0, p.x);
      s.x1 = Math.max(s.x1, p.x);
      s.y = Math.min(s.y, p.y);
    }
    s.depth = Math.min(s.depth, depth);
    deckSpans.set(part.deckId, s);
  }
  // Its ground is where the deck says, at its outer edge - the lawn its stairs land on, a porch's walk - not its lowest piece.
  for (const [id, s] of deckSpans) {
    const y = model.deckGrounds?.[id];
    if (y !== undefined) s.y = y;
  }

  // Back to front; at one depth a wall before the roof over it, a post or column last, a deck in front of the wall it is on.
  const order = { wall: 0, roof: 1, post: 2, column: 2, deck: 3 } as const;
  pieces.sort((p, q) => q.depth - p.depth || order[p.type] - order[q.type]);

  // ---- The ground at the foot of the house: under each x, the nearest wall's - or a deck's in front of it ---------
  const walls = pieces.filter((p): p is ViewWall => p.type === "wall");
  const grounded = walls.filter((w) => w.grade !== null);
  const spans = [...deckSpans.values()];
  const xs = [...new Set([...grounded.flatMap((w) => (w.grade as Pt[]).map((p) => Math.round(p.x * 1e6) / 1e6)), ...spans.flatMap((s) => [Math.round(s.x0 * 1e6) / 1e6, Math.round(s.x1 * 1e6) / 1e6])])].sort((a, b) => a - b);
  const nearestAt = (x: number) => {
    let best: ViewWall | null = null;
    for (const w of grounded) {
      const g = w.grade as Pt[];
      const lo = Math.min((g[0] as Pt).x, (g[g.length - 1] as Pt).x);
      const hi = Math.max((g[0] as Pt).x, (g[g.length - 1] as Pt).x);
      if (x < lo - 1e-9 || x > hi + 1e-9) continue;
      if (!best || w.depth < best.depth) best = w;
    }
    return best;
  };
  const ground: Pt[] = [];
  for (const x of xs) {
    // Either side of each corner, so a step stays a step and one wall hands over to the next.
    for (const e of [-1e-4, 1e-4]) {
      const w = nearestAt(x + e);
      const d = spans.filter((s) => x + e >= s.x0 - 1e-9 && x + e <= s.x1 + 1e-9).sort((a, b) => a.depth - b.depth)[0];
      // A deck in front of the wall stands on its own ground, nearer the viewer: a porch's walk under a wall measured from
      // the porch, a lawn higher than the ground at the walls. A deck behind the house, or past its walls, changes nothing.
      if (d && w && d.depth < w.depth - 1e-6) {
        ground.push({ x: x + e, y: d.y });
        continue;
      }
      if (!w) continue;
      const g = [...(w.grade as Pt[])].sort((a, b) => a.x - b.x);
      ground.push({ x: x + e, y: yAt(g, x + e) });
    }
  }
  // The decks reach past the walls only by what shows: a stair running out past the house's end is in the view.
  const allX = [...walls.flatMap((w) => w.outline.map((p) => p.x)), ...pieces.filter((p): p is ViewDeck => p.type === "deck").flatMap((p) => p.poly.map((q) => q.x))];
  const minX = allX.length > 0 ? Math.min(...allX) : 0;
  const maxX = allX.length > 0 ? Math.max(...allX) : 1;
  const roofs = pieces.filter((p): p is ViewRoof => p.type === "roof");
  const topY = Math.max(...walls.flatMap((w) => w.outline.map((p) => p.y)), ...roofs.flatMap((r) => r.poly.map((p) => p.y)), 0);
  const groundY = ground.length > 0 ? Math.min(...ground.map((p) => p.y)) : 0;

  // ---- What it shows, and its main levels -------------------------------------------------------------
  const sides: HouseView["sides"] = [];
  for (const w of [...walls].filter((x) => x.sideId !== null).sort((p, q) => Math.min(...p.outline.map((v) => v.x)) - Math.min(...q.outline.map((v) => v.x)))) {
    if (!sides.some((s) => s.sideId === w.sideId)) sides.push({ sideId: w.sideId as string, name: w.name });
  }
  const levels: HouseView["levels"] = [];
  const widest = [...walls]
    .filter((w) => w.sideId !== null)
    .sort((p, q) => Math.max(...q.outline.map((v) => v.x)) - Math.min(...q.outline.map((v) => v.x)) - (Math.max(...p.outline.map((v) => v.x)) - Math.min(...p.outline.map((v) => v.x))));
  // A wall's eave: the lowest of its top, where the roof's underside meets it.
  const topOf = (w: ViewWall): number | null => {
    const top = w.outline.slice(w.grade ? w.grade.length : (w.bottomPoints ?? 2));
    return top.length === 0 ? null : Math.min(...top.map((p) => p.y));
  };
  for (const w of widest.filter((x) => !x.toFloorLine).slice(0, 2)) {
    const y = topOf(w);
    if (y !== null && !levels.some((l) => Math.abs(l.y - y) < 0.5)) levels.push({ label: "Eave", y });
  }
  // A two-storey house's floor line where a main wall stands to it (2026-10-19): said as what it is.
  const floor = widest.find((x) => x.toFloorLine);
  const floorY = floor ? topOf(floor) : null;
  if (floorY !== null && !levels.some((l) => Math.abs(l.y - floorY) < 0.5)) levels.push({ label: "Floor line", y: floorY });
  if (roofs.length > 0 && !levels.some((l) => Math.abs(l.y - topY) < 0.5)) levels.push({ label: "Top of roof", y: topY });
  levels.sort((p, q) => p.y - q.y);
  return { from, title: viewTitle(from, frontFacesDeg), pieces, ground: dedupeX(ground), minX, maxX, topY, groundY, sides, levels, party };
}

/** A deck's piece on one side's own drawing: in the side's frame (x along from its left end, y up from its level). */
export interface SideDeckPiece {
  kind: DeckPartKind;
  poly: Pt[];
  /** How far out from the wall it stands: what is drawn first is furthest back. */
  out: number;
  facing: number;
  material?: string;
  /** Its deck's ground at its outer edge, in the side's frame: where its stairs land. */
  ground?: number;
}

/**
 * The decks in front of one side (2026-10-20), seen square-on from outside it, as its own elevation draws them: each
 * upright piece standing out from the wall, in the side's frame. Empty with none.
 */
export function decksOnSide(model: ExteriorModel3D, sideId: string): SideDeckPiece[] {
  const parts = model.decks ?? [];
  const w = model.walls.find((x) => x.sideId === sideId);
  if (!w || parts.length === 0) return [];
  const o = plan(w.origin);
  const along = { x: w.along[0], y: -w.along[2] };
  const out = { x: w.out[0], y: -w.out[2] };
  const TWO_SIDED = new Set<DeckPartKind>(["glass", "pickets", "cable", "rail", "screen", "skirting", "stringer"]);
  const pieces: SideDeckPiece[] = [];
  for (const part of parts) {
    if (!part.normal) continue;
    const toward = part.normal.x * out.x + part.normal.y * out.y;
    const seen = TWO_SIDED.has(part.kind) ? Math.abs(toward) : toward;
    if (seen < 0.12) continue;
    const pts = part.poly.map((v) => {
      const p = plan(v);
      const d = { x: p.x - o.x, y: p.y - o.y };
      return { x: d.x * along.x + d.y * along.y, y: v[1] - w.frameV, w: d.x * out.x + d.y * out.y };
    });
    const far = Math.max(...pts.map((p) => p.w));
    // In front of the wall only: a deck round the corner is another side's.
    if (far < 0.05) continue;
    // And along it (2026-10-22): a porch off past the end of a 2' garage step stands in front of the step's line, not of
    // the step - it is drawn in the house's views, not in the step's own.
    const xs = pts.map((p) => p.x);
    if (Math.max(...xs) < 0.05 || Math.min(...xs) > w.length - 0.05) continue;
    const poly = pts.map((p) => ({ x: p.x, y: p.y }));
    if (Math.abs(area2(poly)) < 1e-4) continue;
    const ground = model.deckGrounds?.[part.deckId];
    pieces.push({ kind: part.kind, poly, out: Math.min(...pts.map((p) => p.w)), facing: seen, ...(part.material ? { material: part.material } : {}), ...(ground !== undefined ? { ground: ground - w.frameV } : {}) });
  }
  // Nearest the wall first: what stands further out is drawn over it.
  return pieces.sort((p, q) => p.out - q.out);
}

/**
 * A slope's convex cells joined into its outline: the edges no two cells share, chained round. The cells
 * already share their corners (lib/exterior3d.ts puts each into its neighbours' edges), so a shared edge
 * is the same two points both ways. A slope whose edges don't chain into one ring is left as its cells.
 */
function joinCells(cells: V3[][]): V3[][] {
  if (cells.length === 1) return cells;
  const key = (v: V3) => `${Math.round(v[0] * 1e4)},${Math.round(v[2] * 1e4)}`;
  const edges = new Map<string, { a: V3; b: V3 }>();
  for (const c of cells) for (let i = 0; i < c.length; i++) edges.set(`${key(c[i] as V3)}>${key(c[(i + 1) % c.length] as V3)}`, { a: c[i] as V3, b: c[(i + 1) % c.length] as V3 });
  const outer = [...edges.entries()].filter(([k]) => {
    const [a, b] = k.split(">");
    return !edges.has(`${b}>${a}`);
  });
  const from = new Map(outer.map(([, e]) => [key(e.a), e]));
  if (from.size !== outer.length || outer.length < 3) return cells;
  const ring: V3[] = [];
  let e = (outer[0] as [string, { a: V3; b: V3 }])[1];
  for (let guard = 0; guard <= outer.length; guard++) {
    ring.push(e.a);
    const next = from.get(key(e.b));
    if (!next) return cells;
    if (next === (outer[0] as [string, { a: V3; b: V3 }])[1]) return ring.length === outer.length ? [straight(ring)] : cells;
    e = next;
  }
  return cells;
}

/** A ring with the corners that lie on a straight run between their neighbours taken out. */
function straight(ring: V3[]): V3[] {
  return ring.filter((v, i) => {
    const p = ring[(i - 1 + ring.length) % ring.length] as V3;
    const q = ring[(i + 1) % ring.length] as V3;
    const [ax, ay, az] = [v[0] - p[0], v[1] - p[1], v[2] - p[2]];
    const [bx, by, bz] = [q[0] - v[0], q[1] - v[1], q[2] - v[2]];
    const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    return cross > 1e-6 * Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) + 1e-12;
  });
}

/** Points closer than a hair along x and y dropped. */
function dedupeX(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  return out;
}
