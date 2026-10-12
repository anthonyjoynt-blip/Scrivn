/**
 * Where the wet is, in the walk-through (2026-10-12): a small water-drop tag on every wet surface the claim's moisture
 * map marks, pinned in the 3D view and on a 360 spot's stills. Asked for from the field once the phone's 360s became
 * their own step at the end of a walk: "would it be possible to mark out the wet walls and floor in the scan on the
 * photos. nothing big just a little water drop tag or something on the affected surface" (the owner).
 *
 * ONE TAG PER WET THING, never one per cell:
 *   - a wet stretch of wall: at the middle of the stretch, halfway up the wet, on the wall's inside face;
 *   - painted floor or ceiling: one per painted REGION (`paintedRegions`), at its painted cell nearest the region's
 *     middle (`regionMiddleCell`), so a C of paint never puts its tag on the dry floor inside the C.
 *
 * SEEN OR NOT (`tagSeenFrom`): a tag shows only where its face looks at the eye and no wall stands between them. A still
 * is a photo - it cannot hide a tag behind a wall the way the 3D view's depth does - so the walls are tested here, as
 * the plan stands them up (lib/sketch3d.ts). Cabinets are not: wet drywall behind a run of base cabinets is still wet,
 * and its tag on the cabinet front says where.
 *
 * UNITS are the 3D model's (lib/sketch3d.ts): feet, x across the page, y up, z down the page.
 */

import { formatFeetInches, isInsideRoom, PIXELS_PER_FOOT, roomLevel, wallById, type Sketch, type SketchRoom } from "./sketch";
import { ceilingModel, modelLevels, type HouseModel } from "./sketch3d";
import { cellCentreWorld, CELL_SQUARE_FEET, MATERIAL_LABEL, parseCellKey, type MoistureMap, type MoistureMaterial, type WallReading } from "./moisture";
import type { Vec3 } from "./walkView";

export type WetSurface = "wall" | "floor" | "ceiling";

export interface MoistureTag {
  /** Stable across rebuilds: "wall:<reading id>", "floor:<room id>:<k>", "ceiling:<room id>:<k>". */
  id: string;
  roomId: string;
  level: number;
  surface: WetSurface;
  /** Where the tag is pinned: a hair off its surface, into the room. */
  position: Vec3;
  /** The way the surface faces, unit: into the room off a wall, up off a floor, down off a ceiling. */
  normal: Vec3;
  /** A wall's material and meter reading; null on a floor or ceiling, and a reading not entered yet is null. */
  material: MoistureMaterial | null;
  reading: number | null;
  /** How high a wall is wet; null on a floor or ceiling. */
  heightFeet: number | null;
  /** The wet area this tag stands for: a wall's run times its height, a region's painted cells. Square feet. */
  areaSquareFeet: number;
}

/** How far off its surface a tag is pinned: an inch, so the surface it sits on never hides it. */
export const TAG_OFF_SURFACE_FEET = 1 / 12;
/** The lowest a wall's tag sits, and the nearest it comes to the ceiling: 6". */
const WALL_TAG_MARGIN_FEET = 0.5;
/**
 * Painted cells this many cells apart or nearer are one region: 5, so a dry gap of up to a foot (four 3 in cells) between
 * two patches leaves them one wet area to look at, and a brush that skipped a cell (or a phone that paints in dabs) does
 * not split one area into a scatter of tags.
 */
export const REGION_REACH_CELLS = 5;

const EPS = 1e-6;

/**
 * Painted cells ("col,row") grouped into regions: cells within [reach] of each other either way, diagonals included, are
 * one region. Each region's cells in the order they were found; regions in the order of their first cell. Keys that do
 * not parse are left out.
 */
export function paintedRegions(cells: readonly string[], reach = REGION_REACH_CELLS): { col: number; row: number }[][] {
  const at = new Map<string, { col: number; row: number }>();
  for (const key of cells) {
    const c = parseCellKey(key);
    if (c && !at.has(`${c.col},${c.row}`)) at.set(`${c.col},${c.row}`, c);
  }
  const seen = new Set<string>();
  const regions: { col: number; row: number }[][] = [];
  for (const [key, start] of at) {
    if (seen.has(key)) continue;
    seen.add(key);
    const region = [start];
    for (let i = 0; i < region.length; i++) {
      const c = region[i] as { col: number; row: number };
      for (let dc = -reach; dc <= reach; dc++) {
        for (let dr = -reach; dr <= reach; dr++) {
          const k = `${c.col + dc},${c.row + dr}`;
          const next = at.get(k);
          if (!next || seen.has(k)) continue;
          seen.add(k);
          region.push(next);
        }
      }
    }
    regions.push(region);
  }
  return regions;
}

/** The region's painted cell nearest the middle of all of them: always one that is painted, whatever shape it is. */
export function regionMiddleCell(region: readonly { col: number; row: number }[]): { col: number; row: number } | null {
  if (region.length === 0) return null;
  let mc = 0;
  let mr = 0;
  for (const c of region) {
    mc += c.col;
    mr += c.row;
  }
  mc /= region.length;
  mr /= region.length;
  let best = region[0] as { col: number; row: number };
  let bestD = Infinity;
  for (const c of region) {
    const d = (c.col - mc) ** 2 + (c.row - mr) ** 2;
    if (d < bestD - EPS) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * A wet stretch's tag: the middle of the stretch along the wall, halfway up the wet (no lower than 6", no nearer the
 * ceiling over it than 6"), an inch into the room. Null when the wall is gone or has no length.
 */
export function wallTagPlace(room: SketchRoom, reading: WallReading, baseY: number): { position: Vec3; normal: Vec3 } | null {
  const wall = wallById(room, reading.wallId);
  if (!wall || wall.lengthPx <= EPS) return null;
  const t = (Math.max(0, Math.min(1, reading.startT)) + Math.max(0, Math.min(1, reading.endT))) / 2;
  const x = wall.x1 + (wall.x2 - wall.x1) * t;
  const y = wall.y1 + (wall.y2 - wall.y1) * t;
  const ux = (wall.x2 - wall.x1) / wall.lengthPx;
  const uy = (wall.y2 - wall.y1) / wall.lengthPx;
  // Into the room: the wall's direction turned +90 degrees on a y-down page for a room drawn clockwise; checked, since
  // a room drawn the other way round is not unheard of.
  let nx = -uy;
  let ny = ux;
  const probe = PIXELS_PER_FOOT / 2;
  if (!isInsideRoom(room, x + nx * probe, y + ny * probe) && isInsideRoom(room, x - nx * probe, y - ny * probe)) {
    nx = -nx;
    ny = -ny;
  }
  const ceiling = ceilingModel(room).at(x, y);
  const wet = Math.max(0, reading.affectedHeightFeet) / 2;
  const height = ceiling <= 2 * WALL_TAG_MARGIN_FEET ? ceiling / 2 : Math.min(ceiling - WALL_TAG_MARGIN_FEET, Math.max(WALL_TAG_MARGIN_FEET, wet));
  const off = TAG_OFF_SURFACE_FEET;
  return {
    position: [x / PIXELS_PER_FOOT + nx * off, baseY + height, y / PIXELS_PER_FOOT + ny * off],
    normal: [nx, 0, ny],
  };
}

/** Every tag of the claim's moisture map, room by room: its wet stretches, then its floor's regions, then its ceiling's. */
export function moistureTags(sketch: Sketch, map: MoistureMap): MoistureTag[] {
  const levels = modelLevels(sketch);
  const baseOf = (level: number) => levels.find((l) => l.level === level)?.baseY ?? 0;
  const out: MoistureTag[] = [];
  for (const room of sketch.rooms) {
    const data = map.rooms[room.id];
    if (!data || room.vertices.length < 3) continue;
    const level = roomLevel(room);
    const baseY = baseOf(level);
    for (const reading of data.wallReadings) {
      const place = wallTagPlace(room, reading, baseY);
      if (!place) continue;
      const wall = wallById(room, reading.wallId);
      const run = Math.max(0, Math.min(1, reading.endT) - Math.max(0, reading.startT));
      out.push({
        id: `wall:${reading.id}`,
        roomId: room.id,
        level,
        surface: "wall",
        ...place,
        material: reading.material,
        reading: reading.reading,
        heightFeet: reading.affectedHeightFeet,
        areaSquareFeet: (wall?.lengthFeet ?? 0) * run * Math.max(0, reading.affectedHeightFeet),
      });
    }
    const ceil = ceilingModel(room);
    for (const surface of ["floor", "ceiling"] as const) {
      const cells = surface === "floor" ? data.floorCells : data.ceilingCells;
      paintedRegions(cells).forEach((region, k) => {
        const middle = regionMiddleCell(region);
        if (!middle) return;
        const c = cellCentreWorld(room, middle.col, middle.row);
        const y = surface === "floor" ? baseY + TAG_OFF_SURFACE_FEET / 2 : baseY + ceil.at(c.x, c.y) - TAG_OFF_SURFACE_FEET / 2;
        out.push({
          id: `${surface}:${room.id}:${k}`,
          roomId: room.id,
          level,
          surface,
          position: [c.x / PIXELS_PER_FOOT, y, c.y / PIXELS_PER_FOOT],
          normal: surface === "floor" ? [0, 1, 0] : [0, -1, 0],
          material: null,
          reading: null,
          heightFeet: null,
          areaSquareFeet: region.length * CELL_SQUARE_FEET,
        });
      });
    }
  }
  return out;
}

export interface SeenOptions {
  /** Only these storeys' walls and floors stand in the way; every storey's when absent. */
  levels?: ReadonlySet<number> | null;
  /** How high a storey's walls stand at most - the dollhouse's Low walls; their own height when absent. */
  wallTop?: ((level: number) => number) | null;
}

/** Whether (x, z) lies inside the polygon [points]. */
function insidePolygon(points: readonly { x: number; z: number }[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as { x: number; z: number };
    const b = points[j] as { x: number; z: number };
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * The part of the segment from [e] along [d] (t from 0 to [tEnd]) whose plan lies inside the convex [points], as its
 * two ends in t; null when it misses. A wall's footprint is a convex four-sided band.
 */
function clipToConvex(points: readonly { x: number; z: number }[], e: Vec3, d: Vec3, tEnd: number): [number, number] | null {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as { x: number; z: number };
    const q = points[(i + 1) % points.length] as { x: number; z: number };
    area += p.x * q.z - q.x * p.z;
  }
  if (Math.abs(area) < EPS) return null;
  const s = area > 0 ? 1 : -1;
  let t0 = 0;
  let t1 = tEnd;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as { x: number; z: number };
    const b = points[(i + 1) % points.length] as { x: number; z: number };
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    // Inside is where the cross of the edge with (point - a) has the polygon's own sign.
    const num = s * (ex * (e[2] - a.z) - ez * (e[0] - a.x));
    const den = s * (ex * d[2] - ez * d[0]);
    if (Math.abs(den) < EPS) {
      if (num < 0) return null;
      continue;
    }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return null;
  }
  return [t0, t1];
}

/**
 * Whether [tag] can be seen from [eye]: its face looks towards the eye, and no wall or floor of the model stands between
 * them. Walls are every `wall` prism, at their own height or [options.wallTop]; floors are each room's floor, which is
 * what hides the storey below from above. Glass, cabinets and steps hide nothing (see the doc above).
 */
export function tagSeenFrom(model: HouseModel, eye: Vec3, tag: Pick<MoistureTag, "position" | "normal">, options: SeenOptions = {}): boolean {
  const p = tag.position;
  const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  if (length < EPS) return true;
  // Its face looks away: the back of a wall, a floor seen from under it, a ceiling from over it.
  if (-(d[0] * tag.normal[0] + d[1] * tag.normal[1] + d[2] * tag.normal[2]) <= EPS) return false;
  // Stopped half an inch short, so what the tag sits on is never in its own way.
  const tEnd = Math.max(0, 1 - 0.04 / length);
  const levels = options.levels ?? null;
  for (const prism of model.prisms) {
    if (prism.kind !== "wall" || (levels && !levels.has(prism.level))) continue;
    const span = clipToConvex(prism.points, eye, d, tEnd);
    if (!span || span[1] - span[0] < EPS) continue;
    const top = Math.min(prism.tops ? Math.max(...prism.tops) : prism.y1, options.wallTop ? options.wallTop(prism.level) : Infinity);
    const ya = eye[1] + d[1] * span[0];
    const yb = eye[1] + d[1] * span[1];
    if (Math.min(ya, yb) < top - EPS && Math.max(ya, yb) > prism.y0 + EPS) return false;
  }
  if (Math.abs(d[1]) > EPS) {
    for (const floor of model.floors) {
      if (levels && !levels.has(floor.level)) continue;
      const t = (floor.y - eye[1]) / d[1];
      if (t <= EPS || t >= tEnd) continue;
      if (insidePolygon(floor.points, eye[0] + d[0] * t, eye[2] + d[2] * t)) return false;
    }
  }
  return true;
}

/** A meter reading as the PM typed it, to two places at most: 0.75, 3.2, 18. */
function readingText(n: number): string {
  return `${Number(n.toFixed(2))}%`;
}

/** What a tag says when tapped or hovered: what is wet, then what it is and what it read. */
export function tagWords(tag: MoistureTag): { title: string; detail: string } {
  if (tag.surface === "wall") {
    const parts = [
      tag.material ? MATERIAL_LABEL[tag.material] : null,
      tag.reading == null ? "not metered" : readingText(tag.reading),
      tag.heightFeet != null && tag.heightFeet > 0 ? `wet to ${formatFeetInches(tag.heightFeet)}` : null,
    ];
    return { title: "Wet wall", detail: parts.filter((s): s is string => !!s).join(" · ") };
  }
  const area = tag.areaSquareFeet >= 10 ? Math.round(tag.areaSquareFeet) : Math.round(tag.areaSquareFeet * 10) / 10;
  return { title: tag.surface === "floor" ? "Wet floor" : "Wet ceiling", detail: `${area} sq ft` };
}
