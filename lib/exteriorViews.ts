import type { CladdingKind, ExteriorOpeningKind, TrimPart } from "./exterior";
import type { ExteriorModel3D, V3, Wall3D, WallFaceKind } from "./exterior3d";
import { POST_SIZE_FEET } from "./exterior3d";
import type { Pt } from "./roof";

/**
 * The house's four elevations (2026-10-16, the owner: "consider 4 main elevation views for n/s/e/w. the
 * individual sides and shapes are fine to include but an overview of the full face on view would be nice
 * as well"): the 3D model (lib/exterior3d.ts, the walls already standing up to the roof) looked at
 * square-on from each compass point, drawn as an architect's elevation sheet draws it.
 *
 * An orthographic view: what is nearer covers what is behind, drawn back to front - each wall that
 * faces the view with its cladding and openings, each slope of the roof that faces it, the fascia, the
 * posts. A wall or a slope turned away is behind the house and is left out; one seen edge-on draws nothing.
 *
 * The compass: the plan's front, along its bottom, is SOUTH - Scrivn has no bearing for a house - so the
 * south elevation is the front, the north the back, and east is to the right of the front.
 *
 * Feet. In a view, x runs left to right as the viewer sees it, y is up as the model has it.
 */

export type Compass = "south" | "east" | "north" | "west";

/** In the order an elevation sheet gives them: the front, round to the right. */
export const COMPASS: Compass[] = ["south", "east", "north", "west"];

export const COMPASS_WORD: Record<Compass, string> = { south: "South", east: "East", north: "North", west: "West" };

/** The way the viewer looks, in plan (x right, y to the back): from the south they look north. */
const LOOKS: Record<Compass, Pt> = { south: { x: 0, y: 1 }, east: { x: -1, y: 0 }, north: { x: 0, y: -1 }, west: { x: 1, y: 0 } };

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
  openings: { id: string; kind: ExteriorOpeningKind; x0: number; x1: number; y0: number; y1: number }[];
  /** The ground it stands on, left to right; null for a wall standing on a roof or a deck's ceiling. */
  grade: Pt[] | null;
  /** How squarely it faces the view: 1 square-on. Its marks are drawn a little lighter turned away. */
  facing: number;
  /** A party wall (2026-10-17): drawn bare and marked "Shared wall" - the neighbour's home stands against it. */
  shared?: true;
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

export type ViewPiece = ViewWall | ViewRoof | ViewPost | ViewColumn;

export interface HouseView {
  compass: Compass;
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

/** The house seen from [compass]. */
export function houseView(model: ExteriorModel3D, compass: Compass): HouseView {
  const look = LOOKS[compass];
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
        return { id: op.id, kind: op.kind, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: op.y0, y1: op.y1 };
      }),
      grade: w.grade && w.grade.length >= 2 ? w.grade.map(at) : null,
      facing,
      ...(w.shared ? { shared: true as const } : {}),
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

  // Back to front; at one depth a wall before the roof over it, a post or column last.
  const order = { wall: 0, roof: 1, post: 2, column: 2 } as const;
  pieces.sort((p, q) => q.depth - p.depth || order[p.type] - order[q.type]);

  // ---- The ground at the foot of the house: under each x, the nearest wall's ------------------------
  const walls = pieces.filter((p): p is ViewWall => p.type === "wall");
  const grounded = walls.filter((w) => w.grade !== null);
  const xs = [...new Set(grounded.flatMap((w) => (w.grade as Pt[]).map((p) => Math.round(p.x * 1e6) / 1e6)))].sort((a, b) => a - b);
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
      if (!w) continue;
      const g = [...(w.grade as Pt[])].sort((a, b) => a.x - b.x);
      ground.push({ x: x + e, y: yAt(g, x + e) });
    }
  }
  const allX = walls.flatMap((w) => w.outline.map((p) => p.x));
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
  return { compass, pieces, ground: dedupeX(ground), minX, maxX, topY, groundY, sides, levels, party };
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
