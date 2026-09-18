/**
 * The wall tool: walls drawn one corner at a time, and what a drawn run becomes.
 *
 * Rooms began as rectangles that were added, then bent. That covers most rooms and it never covered
 * a wall on its own — the wing wall beside a doorway, the pony wall between a kitchen and the living
 * room, the partition alongside a stair — and it made an irregular room a matter of adding a box and
 * breaking its sides until it looked right. This is the other way in: tap the corners of a wall run
 * in turn, and the run is whatever it turns out to be.
 *
 *   * a run that ends back on its own first corner is a ROOM
 *   * a run that starts and ends on the walls of one room cuts a piece off it, and that piece is a
 *     SUB-ROOM of it — a closet drawn into a corner, a room split by a partition
 *   * a run that meets the free ends of walls already drawn and closes a loop with them is a room
 *     made of all of them, and those walls are used up by it
 *   * anything else is a FREE WALL, kept as drawn — see `FreeWall`
 *
 * Every tap is snapped before it is kept (`snapDraftPoint`): onto a corner, onto a wall, or square
 * with the corner before it. The snapping is what makes closing a loop a matter of tapping near the
 * corner rather than on it, and what keeps a room drawn by eye from coming out with a wall a degree
 * off square.
 *
 * Pure geometry, in world pixels, with nothing of the canvas in it — the canvas snaps and draws,
 * the editor decides, and both call in here.
 */

import {
  type FreeWall,
  type Sketch,
  type SketchRoom,
  type Vertex,
  type WallGeometry,
  DEFAULT_CEILING_HEIGHT_FEET,
  MIN_VERTICES,
  PIXELS_PER_FOOT,
  ensureClockwise,
  freeWallLevel,
  freeWallSegmentRoom,
  freeWallSegments,
  freeWallsOf,
  newSketchId,
  pruneCollinearVertices,
  wallsOf,
} from "./sketch";

/** A corner the PM has tapped, after snapping. */
export interface DraftPoint {
  x: number;
  y: number;
  /**
   * The room wall this point landed on, when it did. It is what lets a run that starts and ends on
   * one room's walls cut a piece out of that room — the walk round the room's own outline between
   * the two points needs to know where on it they are.
   */
  on: { roomId: string; wallId: string; t: number } | null;
}

/** How close a tap has to land to a corner or a wall to snap onto it, in SCREEN pixels. */
export const WALL_SNAP_SCREEN_PX = 12;

/** Shortest free wall worth keeping, in world pixels: half a foot. */
export const MIN_FREE_WALL_PX = 6;

/** Smallest region a run may close off and be called a room: a square foot. */
const MIN_ROOM_AREA_PX = PIXELS_PER_FOOT * PIXELS_PER_FOOT;

export interface SnapContext {
  /** The rooms on the storey being drawn. */
  rooms: SketchRoom[];
  /** The free walls on it. */
  freeWalls: FreeWall[];
  /** The run so far; its corners are snap targets too, the first one especially. */
  draft: DraftPoint[];
  /** The snap radius in WORLD pixels — the screen radius over the zoom. */
  radiusPx: number;
}

/**
 * Where a tap lands once snapped.
 *
 * Square first: a point within the radius of the previous corner's x or y takes that x or y, which
 * is how a room drawn by eye comes out with square corners. Then a corner within the radius of the
 * tap wins outright — corners of rooms, of free walls, and of the run itself. Failing that, the
 * nearest wall within the radius, with the point projected onto it; a room wall records itself on
 * the point. Failing that, the squared point as it is.
 *
 * Corners are tested against the RAW tap and walls against the squared one: a corner near the
 * finger is what was meant whatever the previous corner was, while a wall that is straight keeps
 * the squared coordinate when the point is projected onto it, so a closet wall drawn up to the
 * room's top wall lands exactly above the corner below it.
 */
export function snapDraftPoint(raw: { x: number; y: number }, ctx: SnapContext): DraftPoint {
  const r = ctx.radiusPx;
  const last = ctx.draft[ctx.draft.length - 1];
  const aligned = {
    x: last && Math.abs(raw.x - last.x) <= r ? last.x : raw.x,
    y: last && Math.abs(raw.y - last.y) <= r ? last.y : raw.y,
  };

  let corner: DraftPoint | null = null;
  let cornerDistance = r;
  const consider = (x: number, y: number, on: DraftPoint["on"]) => {
    const d = Math.hypot(x - raw.x, y - raw.y);
    if (d <= cornerDistance) {
      cornerDistance = d;
      corner = { x, y, on };
    }
  };
  for (const point of ctx.draft) consider(point.x, point.y, point.on);
  for (const room of ctx.rooms) for (const wall of wallsOf(room)) consider(wall.x1, wall.y1, { roomId: room.id, wallId: wall.id, t: 0 });
  for (const wall of ctx.freeWalls) for (const v of wall.vertices) consider(v.x, v.y, null);
  if (corner) return corner;

  let nearest: DraftPoint | null = null;
  let wallDistance = r;
  const project = (segment: WallGeometry, on: (t: number) => DraftPoint["on"]) => {
    if (segment.lengthPx <= 0) return;
    const t = ((aligned.x - segment.x1) * (segment.x2 - segment.x1) + (aligned.y - segment.y1) * (segment.y2 - segment.y1)) / (segment.lengthPx * segment.lengthPx);
    if (t < 0 || t > 1) return;
    const x = segment.x1 + (segment.x2 - segment.x1) * t;
    const y = segment.y1 + (segment.y2 - segment.y1) * t;
    const d = Math.hypot(x - aligned.x, y - aligned.y);
    if (d <= wallDistance) {
      wallDistance = d;
      nearest = { x, y, on: on(t) };
    }
  };
  for (const room of ctx.rooms) for (const wall of wallsOf(room)) project(wall, (t) => ({ roomId: room.id, wallId: wall.id, t }));
  for (const wall of ctx.freeWalls) for (const segment of freeWallSegments(wall)) project(segment, () => null);
  if (nearest) return nearest;

  return { ...aligned, on: null };
}

/* ── What a run becomes ─────────────────────────────────────────────────────────────────────── */

/** What adding a corner to the run did. */
export type DraftStep =
  | { kind: "extend"; draft: DraftPoint[] }
  | { kind: "room"; room: SketchRoom; usedFreeWallIds: string[] }
  /**
   * Nothing to add. "last": the tap landed on the run's last corner again — which, with a run of
   * two or more corners, is the sign to keep the run as it is; a double-tap does exactly this.
   * "degenerate": the run closed on itself but encloses nothing worth calling a room.
   */
  | { kind: "ignore"; reason: "last" | "degenerate" };

/**
 * Adds a snapped corner to the run and says what that made.
 *
 * Checked in the order a closing tap is most likely to mean it: back on the run's own first corner;
 * onto the end of a free wall that leads, through free walls, back to where the run began; onto the
 * wall of the room the run began on. Only then is the corner simply another corner.
 */
export function addDraftPoint(draft: DraftPoint[], point: DraftPoint, sketch: Sketch, level: number, radiusPx: number): DraftStep {
  const first = draft[0];
  const last = draft[draft.length - 1];
  if (last && samePoint(last, point)) return { kind: "ignore", reason: "last" };

  // Back on the first corner. `roomFromPoints` wants three corners and a square foot, so two
  // corners and the first again is a line, and stays one.
  if (first && samePoint(first, point)) {
    const room = roomFromPoints(draft, level);
    return room ? { kind: "room", room, usedFreeWallIds: [] } : { kind: "ignore", reason: "degenerate" };
  }

  if (first) {
    const loop = loopThroughFreeWalls(draft, point, freeWallsOf(sketch).filter((w) => freeWallLevel(w) === level), radiusPx);
    if (loop) {
      const room = roomFromPoints(loop.points, level);
      if (room) return { kind: "room", room, usedFreeWallIds: loop.usedFreeWallIds };
    }

    if (first.on && point.on && first.on.roomId === point.on.roomId) {
      const host = sketch.rooms.find((r) => r.id === first.on?.roomId);
      const cut = host ? enclosureWithRoom(draft, point, host) : null;
      const room = cut ? roomFromPoints(cut, level) : null;
      if (room) return { kind: "room", room, usedFreeWallIds: [] };
    }
  }

  return { kind: "extend", draft: [...draft, point] };
}

/** The run as it stands, kept as a free wall — or nothing, when it is too short to be one. */
export function finishDraftAsWall(draft: DraftPoint[], level: number): FreeWall | null {
  const points = dedupe(draft);
  if (points.length < 2) return null;
  const vertices = points.map((p) => ({ id: newSketchId("v"), x: p.x, y: p.y }));
  const wall: FreeWall = { id: newSketchId("wall"), vertices, heightFeet: null };
  if (level !== 0) wall.level = level;
  return wall;
}

/**
 * A room from a closed run of corners, or null when the run does not enclose anything worth
 * calling a room. Wound clockwise, since every wall's inward side depends on it, and with any
 * corner that lies straight between its neighbours dropped — tapping three points along one wall
 * should make one wall.
 */
export function roomFromPoints(points: { x: number; y: number }[], level: number): SketchRoom | null {
  const distinct = dedupe(points);
  if (distinct.length < MIN_VERTICES) return null;
  if (Math.abs(shoelace(distinct)) / 2 < MIN_ROOM_AREA_PX) return null;

  const room: SketchRoom = {
    id: newSketchId("room"),
    name: "",
    vertices: ensureClockwise(distinct.map((p) => ({ id: newSketchId("v"), x: p.x, y: p.y }))),
    ceilingHeightFeet: DEFAULT_CEILING_HEIGHT_FEET,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
  };
  if (level !== 0) room.level = level;
  const pruned = pruneCollinearVertices(room);
  return pruned.vertices.length >= MIN_VERTICES ? pruned : null;
}

/**
 * The piece of `room` a run cuts off, as the corners of a polygon — the run itself, then the walk
 * back along the room's own outline from where the run ended to where it began.
 *
 * There are two ways round the outline, and they enclose the two pieces the run splits the room
 * into. The smaller is the one being drawn: a closet in a corner, the near side of a partition.
 * Returns null when the run runs along the wall it started on and encloses nothing.
 */
export function enclosureWithRoom(draft: DraftPoint[], point: DraftPoint, room: SketchRoom): { x: number; y: number }[] | null {
  const from = point.on;
  const to = draft[0]?.on;
  if (!from || !to || from.roomId !== room.id || to.roomId !== room.id) return null;

  const walls = wallsOf(room);
  const cumulative: number[] = [];
  let total = 0;
  for (const wall of walls) {
    cumulative.push(total);
    total += wall.lengthPx;
  }
  if (total <= 0) return null;
  const along = (at: { wallId: string; t: number }) => {
    const index = walls.findIndex((w) => w.id === at.wallId);
    const wall = walls[index];
    return index < 0 || !wall ? null : (cumulative[index] as number) + at.t * wall.lengthPx;
  };
  const sFrom = along(from);
  const sTo = along(to);
  if (sFrom === null || sTo === null) return null;

  const run = [...draft, point].map((p) => ({ x: p.x, y: p.y }));
  const walk = (direction: 1 | -1) => {
    const distance = (s: number) => (direction === 1 ? (s - sFrom + total) % total : (sFrom - s + total) % total);
    const span = distance(sTo);
    return walls
      .map((wall, index) => ({ x: wall.x1, y: wall.y1, d: distance(cumulative[index] as number) }))
      .filter((v) => v.d > 0.5 && v.d < span - 0.5)
      .sort((a, b) => a.d - b.d)
      .map((v) => ({ x: v.x, y: v.y }));
  };

  // A piece is a piece: it has to leave some of the room behind. A run that lies along the wall it
  // began on "encloses" the whole room one way round and nothing the other, and is neither.
  const roomArea = Math.abs(shoelace(room.vertices)) / 2;
  const candidates = [walk(1), walk(-1)]
    .map((path) => dedupe([...run, ...path]))
    .filter((polygon) => {
      const area = Math.abs(shoelace(polygon)) / 2;
      return polygon.length >= MIN_VERTICES && area >= MIN_ROOM_AREA_PX && area <= roomArea - MIN_ROOM_AREA_PX;
    })
    .sort((a, b) => Math.abs(shoelace(a)) - Math.abs(shoelace(b)));
  return candidates[0] ?? null;
}

/**
 * A closed loop made of the run and free walls already drawn: the run's last corner is on the end
 * of a free wall, and free walls lead end to end from there back to the run's first corner.
 *
 * Walls are followed from either end and each is used once. The search is tiny — a sketch has a
 * handful of free walls — so it is a plain depth-first walk.
 */
export function loopThroughFreeWalls(
  draft: DraftPoint[],
  point: DraftPoint,
  freeWalls: FreeWall[],
  radiusPx: number,
): { points: { x: number; y: number }[]; usedFreeWallIds: string[] } | null {
  const first = draft[0];
  if (!first) return null;
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= radiusPx;

  const search = (at: { x: number; y: number }, used: string[], collected: { x: number; y: number }[]): { points: { x: number; y: number }[]; usedFreeWallIds: string[] } | null => {
    if (used.length > 0 && near(at, first)) return { points: collected, usedFreeWallIds: used };
    for (const wall of freeWalls) {
      if (used.includes(wall.id) || wall.vertices.length < 2) continue;
      const head = wall.vertices[0] as Vertex;
      const tail = wall.vertices[wall.vertices.length - 1] as Vertex;
      const ordered = near(at, head) ? wall.vertices : near(at, tail) ? [...wall.vertices].reverse() : null;
      if (!ordered) continue;
      // The wall's own corners, minus the one shared with where we came from and the one we leave by
      // — the loop's corners are collected once each, and the run's own first corner closes it.
      const interior = ordered.slice(1, -1).map((v) => ({ x: v.x, y: v.y }));
      const end = ordered[ordered.length - 1] as Vertex;
      const found = search({ x: end.x, y: end.y }, [...used, wall.id], [...collected, ...interior, ...(near(end, first) ? [] : [{ x: end.x, y: end.y }])]);
      if (found) return found;
    }
    return null;
  };

  const found = search(point, [], [...draft.map((p) => ({ x: p.x, y: p.y })), { x: point.x, y: point.y }]);
  return found;
}

/* ── Editing a free wall ────────────────────────────────────────────────────────────────────── */

export function translateFreeWall(wall: FreeWall, dx: number, dy: number): FreeWall {
  return { ...wall, vertices: wall.vertices.map((v) => ({ ...v, x: v.x + dx, y: v.y + dy })) };
}

/** Moves one corner. Refused, wall unchanged, when it would leave a piece shorter than the minimum. */
export function moveFreeWallVertex(wall: FreeWall, vertexId: string, x: number, y: number): FreeWall {
  const index = wall.vertices.findIndex((v) => v.id === vertexId);
  if (index < 0) return wall;
  const neighbours = [wall.vertices[index - 1], wall.vertices[index + 1]].filter((v): v is Vertex => v !== undefined);
  if (neighbours.some((v) => Math.hypot(v.x - x, v.y - y) < MIN_FREE_WALL_PX)) return wall;
  return { ...wall, vertices: wall.vertices.map((v) => (v.id === vertexId ? { ...v, x, y } : v)) };
}

/**
 * Sets the length of one piece by moving the corner it ends at along the piece's own direction.
 * The corners after it stay where they are, so the next piece takes up the difference — the way a
 * tape would have it, measuring from the start.
 */
export function withFreeWallSegmentLength(wall: FreeWall, startVertexId: string, feet: number): FreeWall {
  const index = wall.vertices.findIndex((v) => v.id === startVertexId);
  const from = wall.vertices[index];
  const to = wall.vertices[index + 1];
  if (!from || !to || feet <= 0) return wall;
  const targetPx = feet * PIXELS_PER_FOOT;
  if (targetPx < MIN_FREE_WALL_PX) return wall;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length <= 0) return wall;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  return moveFreeWallVertex(wall, to.id, from.x + ux * targetPx, from.y + uy * targetPx);
}

/* ── What a free wall is worth ──────────────────────────────────────────────────────────────── */

/** Every piece of free wall standing in `room`, with its length and its height (null: full). */
export function freeWallRunsIn(room: SketchRoom, sketch: Sketch): { lengthFeet: number; heightFeet: number | null }[] {
  const runs: { lengthFeet: number; heightFeet: number | null }[] = [];
  for (const wall of freeWallsOf(sketch)) {
    for (const segment of freeWallSegments(wall)) {
      if (freeWallSegmentRoom(segment, wall, sketch)?.id === room.id) runs.push({ lengthFeet: segment.lengthFeet, heightFeet: wall.heightFeet });
    }
  }
  return runs;
}

/* ── Helpers ────────────────────────────────────────────────────────────────────────────────── */

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

/** Drops consecutive repeats, and a last point that repeats the first. */
function dedupe<P extends { x: number; y: number }>(points: P[]): P[] {
  const out: P[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || !samePoint(prev, p)) out.push(p);
  }
  const head = out[0];
  const tail = out[out.length - 1];
  if (out.length > 1 && head && tail && samePoint(head, tail)) out.pop();
  return out;
}

/** Signed area, doubled — the shoelace sum. */
function shoelace(points: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as { x: number; y: number };
    const b = points[(i + 1) % points.length] as { x: number; y: number };
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}
