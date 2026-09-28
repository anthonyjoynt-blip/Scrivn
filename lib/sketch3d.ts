/**
 * The house in three dimensions, built from the sketch: what the walk-through draws
 * (components/sketch/Sketch3D.tsx). Pure geometry, so it is tested in Node like the rest of the sketch.
 *
 * UNITS ARE FEET. The model's x is the sketch's x, its z the sketch's y (down the page), and its y is
 * up. Every solid is a PRISM - a plan polygon standing between two heights - which is all a wall, a
 * cabinet, a step or a pane of glass needs to be, and all the renderer has to know how to draw.
 *
 * THE WALLS ARE THE PLAN'S. Each room's walls stand 4" outward from its inside faces, mitred at the
 * corners (`outerWallFaces`), exactly as the plan draws them; where two rooms touch, inside to inside,
 * the wall between them is the one room's that owns it (`flushWallStretches`) and the other builds
 * none there. A door or window cuts its wall from floor to head, or leaves the wall below the sill -
 * in its own room's wall and, across a partition, in the neighbour's (`openingsSharedWith`), the way
 * the plan draws a doorway once through both. A stair flight has no walls of its own; it is steps.
 *
 * A SLOPED OR VAULTED CEILING stands its walls up to it: a wall's top follows the ceiling over it
 * (`ceilingModel`), so a shed room's high wall is its peak and a vault's end walls are gables. The
 * ceiling itself is left out, for now - this is a dollhouse, looked into from above - and so are
 * fixtures.
 */

import {
  blockCorners,
  DEFAULT_CEILING_HEIGHT_FEET,
  FLOOR_STRUCTURE_FEET,
  freeWallLevel,
  freeWallSegments,
  freeWallsOf,
  flushWallStretches,
  openingsSharedWith,
  outerWallFaces,
  PIXELS_PER_FOOT,
  roomBounds,
  roomLevel,
  stairFlight,
  symbolCentrePx,
  symbolWidthPx,
  WALL_THICKNESS_PX,
  wallsOf,
  type CabinetTier,
  type Sketch,
  type SketchRoom,
  type SketchSymbol,
} from "./sketch";

export type PrismKind = "wall" | "cabinet" | "step" | "glass";

/** A plan polygon standing between two heights. */
export interface Prism {
  kind: PrismKind;
  /** The room it belongs to; null for a free wall standing in no room. */
  roomId: string | null;
  /** The storey it stands on. */
  level: number;
  /** The footprint in feet, as (x, z) pairs in the plan's own winding. */
  points: { x: number; z: number }[];
  y0: number;
  /** The top; with [tops], the highest of them. */
  y1: number;
  /**
   * Each footprint point's own top, when the top is not level: a wall under a sloped ceiling. Absent
   * for everything else, which stands level from y0 to y1.
   */
  tops?: number[];
}

export interface ModelFloor {
  roomId: string;
  name: string;
  level: number;
  points: { x: number; z: number }[];
  /** The floor's height; a room inside another sits a hair above it so the two never flicker. */
  y: number;
  /** Where the room's name is drawn. */
  labelAt: { x: number; y: number; z: number };
}

export interface ModelLevel {
  level: number;
  /** Height of this storey's floor. */
  baseY: number;
  /** Its tallest ceiling. */
  heightFeet: number;
}

export interface HouseModel {
  prisms: Prism[];
  floors: ModelFloor[];
  levels: ModelLevel[];
  /** Everything in the model; null when there is nothing. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
}

/** A door with no head height recorded: 6'8". */
export const DOOR_HEAD_FEET = 6 + 8 / 12;
/** A window with no sill recorded sits 3' up and is 4' tall. */
export const WINDOW_SILL_FEET = 3;
export const WINDOW_HEIGHT_FEET = 4;
/** Where wall cabinets top out: 7' (84"). */
export const WALL_CABINET_TOP_FEET = 7;

const EPS = 1e-6;

function feet(px: number): number {
  return px / PIXELS_PER_FOOT;
}

function pt(x: number, y: number): { x: number; z: number } {
  return { x: feet(x), z: feet(y) };
}

function ceilingOf(room: SketchRoom): number {
  const h = room.ceilingHeightFeet;
  return h != null && h > 0 ? h : DEFAULT_CEILING_HEIGHT_FEET;
}

/**
 * How high a room's ceiling stands over a point of the plan, in feet above its floor.
 *
 * Flat is one height. A SLOPED ceiling rises from the room's low side at `ceilingRunFeet` of run for
 * the rise from `ceilingHeightFeet` to `ceilingPeakFeet`, and stays at the peak past it. A VAULTED one
 * rises the same way to a ridge that far in and falls again beyond it; with no run on record the
 * ridge is the middle of the room. Which way is `ceilingRiseDeg`, and without one the room's larger
 * bounding dimension - what the quantities assume (`ceilingProfile`). The low side is the room's own
 * extreme against that direction: the phone's low tap is near that wall, since it asks for the low
 * side, and a room drawn here has no other.
 *
 * `breaks` is where along a segment the height stops changing linearly - the ridge, the foot of the
 * slope, where it reaches the peak - so a wall cut there has a straight top in every piece.
 */
export interface CeilingModel {
  at: (x: number, y: number) => number;
  breaks: (x1: number, y1: number, x2: number, y2: number) => number[];
  low: number;
  high: number;
}

export function ceilingModel(room: SketchRoom): CeilingModel {
  const low = ceilingOf(room);
  const flat: CeilingModel = { at: () => low, breaks: () => [], low, high: low };
  const peak = room.ceilingPeakFeet;
  if (room.ceilingType === "flat" || peak == null || !(peak > low + EPS) || room.vertices.length < 3) return flat;
  const b = roomBounds(room);
  const deg = room.ceilingRiseDeg ?? (b.width >= b.height ? 0 : 90);
  const dx = Math.cos((deg * Math.PI) / 180);
  const dy = Math.sin((deg * Math.PI) / 180);
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const v of room.vertices) {
    const s = v.x * dx + v.y * dy;
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
  }
  const extent = sMax - sMin;
  if (extent < EPS) return flat;
  const vaulted = room.ceilingType === "vaulted";
  const run = room.ceilingRunFeet != null && room.ceilingRunFeet > 0 ? room.ceilingRunFeet * PIXELS_PER_FOOT : vaulted ? extent / 2 : extent;
  const perPx = (peak - low) / run;
  const along = (x: number, y: number) => x * dx + y * dy - sMin;
  const at = vaulted
    ? (x: number, y: number) => low + Math.max(0, run - Math.abs(along(x, y) - run)) * perPx
    : (x: number, y: number) => low + Math.min(run, Math.max(0, along(x, y))) * perPx;
  const marks = vaulted ? [0, run, 2 * run] : [0, run];
  const breaks = (x1: number, y1: number, x2: number, y2: number) => {
    const f0 = along(x1, y1);
    const f1 = along(x2, y2);
    if (Math.abs(f1 - f0) < EPS) return [];
    return marks.map((m) => (m - f0) / (f1 - f0)).filter((t) => t > EPS && t < 1 - EPS);
  };
  return { at, breaks, low, high: peak };
}

/** Floor heights, storey by storey: each floor stands on the tallest ceiling below it plus the floor structure. */
export function modelLevels(sketch: Sketch): ModelLevel[] {
  const heights = new Map<number, number>();
  for (const room of sketch.rooms) {
    if (room.stairs) continue;
    const level = roomLevel(room);
    heights.set(level, Math.max(heights.get(level) ?? 0, ceilingOf(room)));
  }
  for (const wall of freeWallsOf(sketch)) {
    const level = freeWallLevel(wall);
    if (!heights.has(level)) heights.set(level, DEFAULT_CEILING_HEIGHT_FEET);
  }
  for (const level of sketch.levels ?? []) if (!heights.has(level)) heights.set(level, DEFAULT_CEILING_HEIGHT_FEET);
  if (!heights.has(0)) heights.set(0, DEFAULT_CEILING_HEIGHT_FEET);
  const all = [...heights.keys()].sort((a, b) => a - b);
  const lo = all[0] as number;
  const hi = all[all.length - 1] as number;
  const heightOf = (level: number) => heights.get(level) ?? DEFAULT_CEILING_HEIGHT_FEET;
  const base = new Map<number, number>([[0, 0]]);
  for (let level = 1; level <= hi; level++) base.set(level, (base.get(level - 1) as number) + heightOf(level - 1) + FLOOR_STRUCTURE_FEET);
  for (let level = -1; level >= lo; level--) base.set(level, (base.get(level + 1) as number) - heightOf(level) - FLOOR_STRUCTURE_FEET);
  return all.map((level) => ({ level, baseY: base.get(level) as number, heightFeet: heightOf(level) }));
}

/** [ranges] with every stretch of [cut] taken out. */
function subtract(ranges: [number, number][], cut: [number, number][]): [number, number][] {
  let out = ranges;
  for (const [c0, c1] of cut) {
    const next: [number, number][] = [];
    for (const [r0, r1] of out) {
      if (c1 <= r0 + EPS || c0 >= r1 - EPS) {
        next.push([r0, r1]);
        continue;
      }
      if (c0 > r0 + EPS) next.push([r0, c0]);
      if (c1 < r1 - EPS) next.push([c1, r1]);
    }
    out = next;
  }
  return out;
}

/** The heights a wall still stands over an opening, from the floor: above a door's head; below a window's sill and above its head. */
function bandsOver(symbol: SketchSymbol, ceiling: number): [number, number][] {
  const bands: [number, number][] = [];
  if (symbol.type === "door") {
    const head = Math.min(ceiling, symbol.heightFeet > 0 ? symbol.heightFeet : DOOR_HEAD_FEET);
    if (head < ceiling - EPS) bands.push([head, ceiling]);
  } else if (symbol.type === "window") {
    const sill = Math.max(0, Math.min(ceiling, symbol.sillFeet ?? WINDOW_SILL_FEET));
    const head = Math.min(ceiling, sill + (symbol.heightFeet ?? WINDOW_HEIGHT_FEET));
    if (sill > EPS) bands.push([0, sill]);
    if (head < ceiling - EPS) bands.push([head, ceiling]);
  } else {
    bands.push([0, ceiling]);
  }
  return bands;
}

/** The glass in a window, from sill to head. */
function glassBand(symbol: SketchSymbol, ceiling: number): [number, number] | null {
  if (symbol.type !== "window") return null;
  const sill = Math.max(0, Math.min(ceiling, symbol.sillFeet ?? WINDOW_SILL_FEET));
  const head = Math.min(ceiling, sill + (symbol.heightFeet ?? WINDOW_HEIGHT_FEET));
  return head > sill + EPS ? [sill, head] : null;
}

function cabinetHeights(tier: CabinetTier, heightFeet: number | null | undefined): [number, number] {
  if (tier === "wall") {
    const h = heightFeet != null && heightFeet > 0 ? heightFeet : 2.5;
    return [Math.max(0, WALL_CABINET_TOP_FEET - h), WALL_CABINET_TOP_FEET];
  }
  if (tier === "full") return [0, heightFeet != null && heightFeet > 0 ? heightFeet : WALL_CABINET_TOP_FEET];
  return [0, heightFeet != null && heightFeet > 0 ? heightFeet : 3];
}

/** How many rooms deep [room] is nested (a closet in a bedroom is 1). */
function nestingDepth(room: SketchRoom, rooms: SketchRoom[]): number {
  let depth = 0;
  let parentId = room.parentRoomId;
  const seen = new Set<string>([room.id]);
  while (parentId && !seen.has(parentId) && depth < 8) {
    seen.add(parentId);
    const parent = rooms.find((r) => r.id === parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parentRoomId;
  }
  return depth;
}

/** The middle of a polygon's area, falling back to its corners' average for a degenerate one. */
function centroid(points: { x: number; z: number }[]): { x: number; z: number } {
  let a2 = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as { x: number; z: number };
    const q = points[(i + 1) % points.length] as { x: number; z: number };
    const cross = p.x * q.z - q.x * p.z;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  }
  if (Math.abs(a2) < EPS) {
    const n = Math.max(1, points.length);
    return { x: points.reduce((s, p) => s + p.x, 0) / n, z: points.reduce((s, p) => s + p.z, 0) / n };
  }
  return { x: cx / (3 * a2), z: cz / (3 * a2) };
}

/** A room's walls: the plan's band 4" outward from its inside faces, cut where its openings are. */
function roomWalls(room: SketchRoom, levelRooms: Sketch["rooms"], sketch: Sketch, level: number, baseY: number, out: Prism[]): void {
  const n = room.vertices.length;
  if (n < 3) return;
  const ceil = ceilingModel(room);
  const sloped = ceil.high > ceil.low + EPS;
  const outer = outerWallFaces(room.vertices, WALL_THICKNESS_PX);
  const freeWalls = freeWallsOf(sketch);
  const shared = openingsSharedWith(room, levelRooms);
  wallsOf(room).forEach((wall, i) => {
    const L = wall.lengthPx;
    if (L <= EPS) return;
    const ux = (wall.x2 - wall.x1) / L;
    const uy = (wall.y2 - wall.y1) / L;
    // Outward: the wall's direction turned -90 degrees on a y-down page (see `outerWallFaces`).
    const nx = uy;
    const ny = -ux;
    const oA = outer[i] as { x: number; y: number };
    const oB = outer[(i + 1) % n] as { x: number; y: number };
    const along = (p: { x: number; y: number }) => (p.x - wall.x1) * ux + (p.y - wall.y1) * uy;
    const sA = along(oA);
    const sB = along(oB);
    const inner = (s: number) => ({ x: wall.x1 + ux * s, y: wall.y1 + uy * s });
    const outerAt = (s: number) => {
      if (Math.abs(s) < EPS && sA <= sB) return oA;
      if (Math.abs(s - L) < EPS && sA <= sB) return oB;
      const p = inner(s);
      return { x: p.x + nx * WALL_THICKNESS_PX, y: p.y + ny * WALL_THICKNESS_PX };
    };
    // Where another room owns the wall it is theirs to build.
    const theirs = flushWallStretches(room, wall, levelRooms)
      .filter((s) => !s.owned)
      .map((s) => [Math.max(0, Math.min(s.from, s.to)), Math.min(L, Math.max(s.from, s.to))] as [number, number]);
    const ranges = subtract([[0, L]], theirs);
    // The holes in it: this room's doors and windows on this wall, and a neighbour's across the partition.
    const holes: { from: number; to: number; symbol: SketchSymbol }[] = [];
    for (const symbol of room.symbols) {
      if ((symbol.type !== "door" && symbol.type !== "window") || symbol.wallId !== wall.id) continue;
      const c = symbolCentrePx(symbol, room, levelRooms, freeWalls);
      const w = symbolWidthPx(symbol, room, levelRooms, freeWalls);
      holes.push({ from: c - w / 2, to: c + w / 2, symbol });
    }
    for (const s of shared) if (s.wallId === wall.id) holes.push({ from: Math.min(s.fromPx, s.toPx), to: Math.max(s.fromPx, s.toPx), symbol: s.symbol });
    // Where the ceiling over this wall changes pitch: a piece between two of these has a straight top.
    const pitchBreaks = ceil.breaks(wall.x1, wall.y1, wall.x2, wall.y2).map((t) => t * L);
    for (const [r0, r1] of ranges) {
      const cuts = [r0, r1];
      for (const h of holes) for (const s of [h.from, h.to]) if (s > r0 + EPS && s < r1 - EPS) cuts.push(s);
      for (const s of pitchBreaks) if (s > r0 + EPS && s < r1 - EPS) cuts.push(s);
      cuts.sort((a, b) => a - b);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k] as number;
        const b = cuts[k + 1] as number;
        if (b - a < EPS) continue;
        const mid = (a + b) / 2;
        const hole = holes.find((h) => h.from <= mid && mid <= h.to);
        const ia = inner(a);
        const ib = inner(b);
        const oa = outerAt(a);
        const ob = outerAt(b);
        const footprint = [pt(ia.x, ia.y), pt(ib.x, ib.y), pt(ob.x, ob.y), pt(oa.x, oa.y)];
        // Under a slope the piece's lowest ceiling decides what the openings leave; a band that
        // reaches the ceiling then follows it, point by point.
        const tops = sloped ? [ia, ib, ob, oa].map((p) => ceil.at(p.x, p.y)) : null;
        const ceiling = tops ? Math.min(...tops) : ceil.low;
        const bands = hole ? bandsOver(hole.symbol, ceiling) : ([[0, ceiling]] as [number, number][]);
        for (const [y0, y1] of bands) {
          const follows = tops != null && Math.abs(y1 - ceiling) < EPS && Math.max(...tops) > ceiling + EPS;
          out.push({
            kind: "wall",
            roomId: room.id,
            level,
            points: footprint,
            y0: baseY + y0,
            y1: baseY + (follows ? Math.max(...(tops as number[])) : y1),
            ...(follows ? { tops: (tops as number[]).map((t) => baseY + t) } : {}),
          });
        }
        const glass = hole ? glassBand(hole.symbol, ceiling) : null;
        if (glass) {
          const g0 = WALL_THICKNESS_PX * 0.44;
          const g1 = WALL_THICKNESS_PX * 0.56;
          out.push({
            kind: "glass",
            roomId: room.id,
            level,
            points: [
              pt(ia.x + nx * g0, ia.y + ny * g0),
              pt(ib.x + nx * g0, ib.y + ny * g0),
              pt(ib.x + nx * g1, ib.y + ny * g1),
              pt(ia.x + nx * g1, ia.y + ny * g1),
            ],
            y0: baseY + glass[0],
            y1: baseY + glass[1],
          });
        }
      }
    }
  });
}

/** Cabinet runs on the room's walls, standing into the room, and its islands. */
function roomCabinets(room: SketchRoom, levelRooms: Sketch["rooms"], sketch: Sketch, level: number, baseY: number, out: Prism[]): void {
  const freeWalls = freeWallsOf(sketch);
  const walls = wallsOf(room);
  for (const symbol of room.symbols) {
    if (symbol.type !== "cabinet") continue;
    const wall = walls.find((w) => w.id === symbol.wallId);
    if (!wall || wall.lengthPx <= EPS) continue;
    const L = wall.lengthPx;
    const ux = (wall.x2 - wall.x1) / L;
    const uy = (wall.y2 - wall.y1) / L;
    // Into the room: the outward normal reversed.
    const ix = -uy;
    const iy = ux;
    const c = symbolCentrePx(symbol, room, levelRooms, freeWalls);
    const w = symbolWidthPx(symbol, room, levelRooms, freeWalls);
    const d = Math.max(0, symbol.depthFeet) * PIXELS_PER_FOOT;
    const a = { x: wall.x1 + ux * (c - w / 2), y: wall.y1 + uy * (c - w / 2) };
    const b = { x: wall.x1 + ux * (c + w / 2), y: wall.y1 + uy * (c + w / 2) };
    const [y0, y1] = cabinetHeights(symbol.tier, symbol.heightFeet);
    out.push({
      kind: "cabinet",
      roomId: room.id,
      level,
      points: [pt(a.x, a.y), pt(b.x, b.y), pt(b.x + ix * d, b.y + iy * d), pt(a.x + ix * d, a.y + iy * d)],
      y0: baseY + y0,
      y1: baseY + y1,
    });
  }
  for (const block of room.freeCabinets ?? []) {
    const corners = blockCorners(block, room);
    if (corners.length < 3) continue;
    const [y0, y1] = cabinetHeights(block.tier, block.heightFeet);
    out.push({ kind: "cabinet", roomId: room.id, level, points: corners.map((p) => pt(p.x, p.y)), y0: baseY + y0, y1: baseY + y1 });
  }
}

/** A flight as steps: each tread a block up to its own height, climbing (or descending) the way it is drawn. */
function stairSteps(room: SketchRoom, level: number, baseY: number, out: Prism[]): void {
  const stairs = room.stairs;
  if (!stairs) return;
  const flight = stairFlight(room);
  if (flight.treadCount <= 0 || flight.riserFeet == null) return;
  const bounds = roomBounds(room);
  const count = flight.treadCount;
  const riser = flight.riserFeet;
  const horizontal = stairs.orientation === 0 || stairs.orientation === 180;
  const run = horizontal ? bounds.width : bounds.height;
  const tread = run / count;
  for (let i = 0; i < count; i++) {
    let x0: number;
    let x1: number;
    let y0: number;
    let y1: number;
    const lo = i * tread;
    const hi = (i + 1) * tread;
    if (stairs.orientation === 0) [x0, x1, y0, y1] = [bounds.minX + lo, bounds.minX + hi, bounds.minY, bounds.maxY];
    else if (stairs.orientation === 180) [x0, x1, y0, y1] = [bounds.maxX - hi, bounds.maxX - lo, bounds.minY, bounds.maxY];
    else if (stairs.orientation === 90) [x0, x1, y0, y1] = [bounds.minX, bounds.maxX, bounds.minY + lo, bounds.minY + hi];
    else [x0, x1, y0, y1] = [bounds.minX, bounds.maxX, bounds.maxY - hi, bounds.maxY - lo];
    const top = stairs.direction === "up" ? baseY + (i + 1) * riser : baseY - (i + 1) * riser;
    const bottom = stairs.direction === "up" ? baseY : baseY - flight.riseFeet;
    out.push({
      kind: "step",
      roomId: room.id,
      level,
      points: [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)],
      y0: Math.min(bottom, top),
      y1: Math.max(bottom, top),
    });
  }
}

/** The whole house: every storey's floors, walls, cabinets and stairs, stacked. */
export function houseModel(sketch: Sketch): HouseModel {
  const levels = modelLevels(sketch);
  const baseOf = (level: number) => levels.find((l) => l.level === level)?.baseY ?? 0;
  const prisms: Prism[] = [];
  const floors: ModelFloor[] = [];
  for (const room of sketch.rooms) {
    if (room.vertices.length < 3) continue;
    const level = roomLevel(room);
    const baseY = baseOf(level);
    const levelRooms = sketch.rooms.filter((r) => roomLevel(r) === level);
    if (room.stairs) {
      stairSteps(room, level, baseY, prisms);
      continue;
    }
    roomWalls(room, levelRooms, sketch, level, baseY, prisms);
    roomCabinets(room, levelRooms, sketch, level, baseY, prisms);
    const points = room.vertices.map((v) => pt(v.x, v.y));
    const y = baseY + 0.01 * nestingDepth(room, levelRooms);
    const c = centroid(points);
    floors.push({ roomId: room.id, name: room.name, level, points, y, labelAt: { x: c.x, y: y + 0.1, z: c.z } });
  }
  for (const wall of freeWallsOf(sketch)) {
    const baseY = baseOf(freeWallLevel(wall));
    const height = wall.heightFeet != null && wall.heightFeet > 0 ? wall.heightFeet : DEFAULT_CEILING_HEIGHT_FEET;
    for (const seg of freeWallSegments(wall)) {
      if (seg.lengthPx <= EPS) continue;
      const nx = (seg.y2 - seg.y1) / seg.lengthPx;
      const ny = -(seg.x2 - seg.x1) / seg.lengthPx;
      const h = WALL_THICKNESS_PX / 2;
      prisms.push({
        kind: "wall",
        roomId: null,
        level: freeWallLevel(wall),
        points: [pt(seg.x1 - nx * h, seg.y1 - ny * h), pt(seg.x2 - nx * h, seg.y2 - ny * h), pt(seg.x2 + nx * h, seg.y2 + ny * h), pt(seg.x1 + nx * h, seg.y1 + ny * h)],
        y0: baseY,
        y1: baseY + height,
      });
    }
  }
  let bounds: HouseModel["bounds"] = null;
  const grow = (x: number, y: number, z: number) => {
    if (!bounds) bounds = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z };
    else {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
      bounds.minZ = Math.min(bounds.minZ, z);
      bounds.maxZ = Math.max(bounds.maxZ, z);
    }
  };
  for (const p of prisms) for (const q of p.points) {
    grow(q.x, p.y0, q.z);
    grow(q.x, p.y1, q.z);
  }
  for (const f of floors) for (const q of f.points) grow(q.x, f.y, q.z);
  return { prisms, floors, levels, bounds };
}
