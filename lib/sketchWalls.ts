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
 *   * anything else is FREE WALL, kept as drawn — one straight `FreeWall` per piece
 *
 * Every tap is snapped before it is kept (`snapDraftPoint`): onto a corner, onto a wall, or square
 * with the corner before it. The snapping is what makes closing a loop a matter of tapping near the
 * corner rather than on it, and what keeps a room drawn by eye from coming out with a wall a degree
 * off square. The radius is a fingertip on screen and never less than the wall's own thickness — the
 * first version was twelve screen pixels, which zoomed in was narrower than the drawn wall, so a tap
 * that landed visibly ON a wall could still miss it and leave a second wall lying a hair off the
 * first.
 *
 * Two walls never lie along each other. A piece drawn along wall that is already there is clipped
 * to the part that is not (`clipToExistingWalls`), and a piece that carries on in line from the end
 * of a free wall is merged into it (`finishDraft`), so a wall that is one wall reads as one
 * measurement however many taps it took.
 *
 * Pure geometry, in world pixels, with nothing of the canvas in it — the canvas snaps and draws,
 * the editor decides, and both call in here.
 */

import {
  type FreeWall,
  type Sketch,
  type SketchRoom,
  type Vertex,
  type WallDimension,
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
  nextRoomName,
  pruneCollinearVertices,
  roomLevel,
  wallDimensions,
  wallExtensionReach,
  wallStrokePx,
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

/** How close a tap has to land to a corner or a wall to snap onto it, in SCREEN pixels: a fingertip. */
export const WALL_SNAP_SCREEN_PX = 16;

/**
 * The snap radius in WORLD pixels at a given zoom: the fingertip on screen, but never less than the
 * drawn wall is thick — zoomed right in, a tap on the wall's own stroke has to count as on the wall.
 */
export function wallSnapRadiusPx(zoom: number): number {
  return Math.max(WALL_SNAP_SCREEN_PX / zoom, wallStrokePx(zoom) * 0.75 + 2);
}

/** Shortest free wall worth keeping, in world pixels: half a foot. */
export const MIN_FREE_WALL_PX = 6;

/** How far off a wall's line a point may be and still count as on that line, in world pixels. */
const ON_LINE_PX = 1.5;

/** Two ends closer than this are the same corner. */
const SAME_CORNER_PX = 0.5;

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
   * "degenerate": the run closed on itself but encloses nothing worth calling a room. "covered":
   * the piece lies entirely along wall that is already there.
   */
  | { kind: "ignore"; reason: "last" | "degenerate" | "covered" };

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
  // Whatever a closed run becomes is named like any other new room — see `nextRoomName`.
  const name = nextRoomName(sketch.rooms);
  if (first && samePoint(first, point)) {
    const room = roomFromPoints(draft, level, name);
    return room ? { kind: "room", room, usedFreeWallIds: [] } : { kind: "ignore", reason: "degenerate" };
  }

  if (first) {
    const loop = loopThroughFreeWalls(draft, point, freeWallsOf(sketch).filter((w) => freeWallLevel(w) === level), radiusPx);
    if (loop) {
      const room = roomFromPoints(loop.points, level, name);
      if (room) return { kind: "room", room, usedFreeWallIds: loop.usedFreeWallIds };
    }

    if (first.on && point.on && first.on.roomId === point.on.roomId) {
      const host = sketch.rooms.find((r) => r.id === first.on?.roomId);
      const cut = host ? enclosureWithRoom(draft, point, host) : null;
      const room = cut ? roomFromPoints(cut, level, name) : null;
      if (room) return { kind: "room", room, usedFreeWallIds: [] };
    }

    /*
      Whatever of the new piece is already wall is not drawn again. The start may only move when it
      is the run's first corner — otherwise the piece before it ends there, and would be left
      hanging. A piece that is all overlap adds nothing.
    */
    const clipped = clipToExistingWalls(last ?? first, point, existingWalls(sketch, level), draft.length === 1);
    if (!clipped) return { kind: "ignore", reason: "covered" };
    return { kind: "extend", draft: [...draft.slice(0, -1), clipped.from, clipped.to] };
  }

  return { kind: "extend", draft: [...draft, point] };
}

/**
 * The run as it stands, kept as free walls — one per piece — merged into any free wall it carries
 * on from in a straight line, so a wall that is one wall reads as one measurement.
 *
 * Returns the sketch's whole free-wall list as it should now be, plus the ids to select: the pieces
 * added, or the walls they were merged into. Nothing is returned when the run is too short to be a
 * wall at all.
 */
export function finishDraft(draft: DraftPoint[], level: number, existing: FreeWall[]): { freeWalls: FreeWall[]; selectIds: string[] } | null {
  // Three taps along one line are two pieces here and one wall after the merge below.
  const points = dedupe(draft);
  if (points.length < 2) return null;

  let walls = [...existing];
  const selectIds: string[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as DraftPoint;
    const b = points[i + 1] as DraftPoint;
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_FREE_WALL_PX) continue;
    const merged = mergeIntoCollinear(a, b, walls, level);
    if (merged) {
      walls = walls.map((w) => (w.id === merged.id ? merged : w)).filter((w) => !merged.absorbed.includes(w.id));
      if (!selectIds.includes(merged.id)) selectIds.push(merged.id);
      continue;
    }
    const wall: FreeWall = { id: newSketchId("wall"), vertices: [{ id: newSketchId("v"), x: a.x, y: a.y }, { id: newSketchId("v"), x: b.x, y: b.y }], heightFeet: null };
    if (level !== 0) wall.level = level;
    walls.push(wall);
    selectIds.push(wall.id);
  }
  return selectIds.length > 0 ? { freeWalls: walls, selectIds } : null;
}

/**
 * A piece that carries straight on from the end of a free wall becomes part of that wall: the wall
 * is extended to the piece's far end, keeping its id and its height. The extended wall may then
 * reach the end of ANOTHER wall in the same line, which is absorbed the same way — three pieces
 * tapped along one line are one wall.
 */
function mergeIntoCollinear(a: DraftPoint, b: DraftPoint, walls: FreeWall[], level: number): (FreeWall & { absorbed: string[] }) | null {
  let from = { x: a.x, y: a.y };
  let to = { x: b.x, y: b.y };
  let host: FreeWall | null = null;
  const absorbed: string[] = [];

  for (let guard = 0; guard < walls.length + 1; guard++) {
    const next = walls.find((w) => {
      if (freeWallLevel(w) !== level || absorbed.includes(w.id) || w.id === host?.id) return false;
      const [p, q] = ends(w);
      const touches = samePoint(p, from) || samePoint(p, to) || samePoint(q, from) || samePoint(q, to);
      return touches && collinear(p, q, from, to);
    });
    if (!next) break;
    const [p, q] = ends(next);
    // The union of the two runs along the shared line: the two points furthest apart.
    const extremes = [p, q, from, to];
    let best: [{ x: number; y: number }, { x: number; y: number }] = [from, to];
    let bestLength = Math.hypot(to.x - from.x, to.y - from.y);
    for (const s of extremes) for (const t of extremes) {
      const length = Math.hypot(t.x - s.x, t.y - s.y);
      if (length > bestLength) {
        bestLength = length;
        best = [s, t];
      }
    }
    from = best[0];
    to = best[1];
    if (host) absorbed.push(next.id);
    else host = next;
  }
  if (!host) return null;
  return {
    ...host,
    vertices: [
      { ...(host.vertices[0] as Vertex), x: from.x, y: from.y },
      { ...(host.vertices[host.vertices.length - 1] as Vertex), x: to.x, y: to.y },
    ],
    absorbed,
  };
}

/**
 * The part of a new piece that is not already wall.
 *
 * A piece drawn along a wall that exists — a run started in the middle of a room's wall and carried
 * past its corner, say — keeps only the part beyond it, starting exactly at the corner. A piece
 * lying wholly along existing wall is nothing (null). The start moves only when `startMayMove`; the
 * end always may, since nothing hangs off it yet.
 */
export function clipToExistingWalls(
  from: DraftPoint,
  to: DraftPoint,
  walls: { segment: WallGeometry; onStart: DraftPoint["on"]; onEnd: DraftPoint["on"] }[],
  startMayMove: boolean,
): { from: DraftPoint; to: DraftPoint } | null {
  let start = from;
  let end = to;
  for (let guard = 0; guard < walls.length + 1; guard++) {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < MIN_FREE_WALL_PX) return null;
    const ux = (end.x - start.x) / length;
    const uy = (end.y - start.y) / length;
    const along = (p: { x: number; y: number }) => (p.x - start.x) * ux + (p.y - start.y) * uy;

    let clipped = false;
    for (const { segment, onStart, onEnd } of walls) {
      const p = { x: segment.x1, y: segment.y1 };
      const q = { x: segment.x2, y: segment.y2 };
      if (!collinear(p, q, start, end)) continue;
      const lo = Math.min(along(p), along(q));
      const hi = Math.max(along(p), along(q));
      const overlapLo = Math.max(lo, 0);
      const overlapHi = Math.min(hi, length);
      if (overlapHi - overlapLo <= SAME_CORNER_PX) continue;

      if (lo <= SAME_CORNER_PX && hi >= length - SAME_CORNER_PX) return null;
      if (lo <= SAME_CORNER_PX) {
        // Overlap at the start: the piece begins where the existing wall ends.
        if (!startMayMove) continue;
        const at = along(p) > along(q) ? { point: p, on: onStart } : { point: q, on: onEnd };
        start = { x: at.point.x, y: at.point.y, on: at.on };
      } else if (hi >= length - SAME_CORNER_PX) {
        // Overlap at the end: the piece stops where the existing wall begins.
        const at = along(p) < along(q) ? { point: p, on: onStart } : { point: q, on: onEnd };
        end = { x: at.point.x, y: at.point.y, on: at.on };
      } else {
        // The existing wall sits inside the piece: keep the part the finger ended on.
        const at = along(p) > along(q) ? { point: p, on: onStart } : { point: q, on: onEnd };
        start = { x: at.point.x, y: at.point.y, on: at.on };
      }
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  return Math.hypot(end.x - start.x, end.y - start.y) < MIN_FREE_WALL_PX ? null : { from: start, to: end };
}

/** Every wall on the storey a new piece could lie along, with what its two ends are on. */
function existingWalls(sketch: Sketch, level: number): { segment: WallGeometry; onStart: DraftPoint["on"]; onEnd: DraftPoint["on"] }[] {
  const out: { segment: WallGeometry; onStart: DraftPoint["on"]; onEnd: DraftPoint["on"] }[] = [];
  for (const room of sketch.rooms) {
    if (roomLevel(room) !== level) continue;
    const walls = wallsOf(room);
    walls.forEach((segment, i) => {
      const next = walls[(i + 1) % walls.length] as WallGeometry;
      out.push({ segment, onStart: { roomId: room.id, wallId: segment.id, t: 0 }, onEnd: { roomId: room.id, wallId: next.id, t: 0 } });
    });
  }
  for (const wall of freeWallsOf(sketch)) {
    if (freeWallLevel(wall) !== level) continue;
    for (const segment of freeWallSegments(wall)) out.push({ segment, onStart: null, onEnd: null });
  }
  return out;
}

/**
 * A room from a closed run of corners, or null when the run does not enclose anything worth
 * calling a room. Wound clockwise, since every wall's inward side depends on it, and with any
 * corner that lies straight between its neighbours dropped — tapping three points along one wall
 * should make one wall.
 */
export function roomFromPoints(points: { x: number; y: number }[], level: number, name = ""): SketchRoom | null {
  const distinct = dedupe(points);
  if (distinct.length < MIN_VERTICES) return null;
  if (Math.abs(shoelace(distinct)) / 2 < MIN_ROOM_AREA_PX) return null;

  const room: SketchRoom = {
    id: newSketchId("room"),
    name,
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

/**
 * The free walls joined to this one, end to end, and to those, and so on — the walls that move
 * together when one of them is dragged. A corner where two pieces meet is one corner; dragging
 * one piece away from the other would tear it.
 */
export function connectedFreeWallIds(wallId: string, walls: FreeWall[]): string[] {
  const found = new Set<string>([wallId]);
  const queue = [wallId];
  while (queue.length > 0) {
    const id = queue.shift();
    const current = walls.find((w) => w.id === id);
    if (!current) continue;
    const [p, q] = ends(current);
    for (const other of walls) {
      if (found.has(other.id) || freeWallLevel(other) !== freeWallLevel(current)) continue;
      const [s, t] = ends(other);
      if ([s, t].some((e) => samePoint(e, p) || samePoint(e, q))) {
        found.add(other.id);
        queue.push(other.id);
      }
    }
  }
  return [...found];
}

/**
 * The free walls standing against a room — an end on its outline — and everything joined to them.
 * These go with the room when it is moved: a partition drawn off a wall is that wall's partition,
 * and a room moved out from under it would leave it standing in the open.
 */
export function freeWallsAttachedToRoom(room: SketchRoom, walls: FreeWall[]): string[] {
  const attached = new Set<string>();
  for (const wall of walls) {
    if (freeWallLevel(wall) !== roomLevel(room)) continue;
    if (ends(wall).some((e) => distanceToOutline(room, e) <= ON_LINE_PX)) {
      for (const id of connectedFreeWallIds(wall.id, walls)) attached.add(id);
    }
  }
  return [...attached];
}

/**
 * Moves one corner of a free wall and every other free-wall end that shares it, so a corner two
 * pieces meet at stays one corner. Refused, walls unchanged, when any piece would be left shorter
 * than the minimum.
 */
export function moveSharedFreeWallVertex(walls: FreeWall[], wallId: string, vertexId: string, x: number, y: number): FreeWall[] {
  const wall = walls.find((w) => w.id === wallId);
  const vertex = wall?.vertices.find((v) => v.id === vertexId);
  if (!wall || !vertex) return walls;
  const moved = walls.map((w) => {
    if (freeWallLevel(w) !== freeWallLevel(wall)) return w;
    let next = w;
    for (const v of w.vertices) {
      if (v.id === vertexId || samePoint(v, vertex)) next = moveFreeWallVertex(next, v.id, x, y);
    }
    return next;
  });
  // Any refusal is everyone's refusal; a corner half-moved is a corner torn.
  const refused = moved.some((w, i) => w === walls[i] && (walls[i] as FreeWall).vertices.some((v) => v.id === vertexId || samePoint(v, vertex)));
  return refused ? walls : moved;
}

/**
 * The translation that lands a moved set of free walls flush with something: the nearest of their
 * ends to a room corner, a room wall or the end of another free wall, within the radius, decides.
 * Otherwise the drag is left as the finger put it. Nothing in the set snaps to itself.
 */
export function snapFreeWallTranslation(
  ids: string[],
  walls: FreeWall[],
  rooms: SketchRoom[],
  dx: number,
  dy: number,
  radiusPx: number,
): { dx: number; dy: number } {
  const moving = walls.filter((w) => ids.includes(w.id));
  const others = walls.filter((w) => !ids.includes(w.id));
  let best: { dx: number; dy: number; distance: number } | null = null;
  for (const wall of moving) {
    for (const end of ends(wall)) {
      const at = { x: end.x + dx, y: end.y + dy };
      const target = snapDraftPoint(at, { rooms, freeWalls: others, draft: [], radiusPx });
      const distance = Math.hypot(target.x - at.x, target.y - at.y);
      if (distance > 0 && (!best || distance < best.distance)) best = { dx: dx + (target.x - at.x), dy: dy + (target.y - at.y), distance };
    }
  }
  return best ? { dx: best.dx, dy: best.dy } : { dx, dy };
}

/**
 * A room wall's dimension labels once the free walls carrying straight on from its corners are
 * counted in.
 *
 * A wall that runs on past the room's corner — the front wall continuing along the hall, the wing
 * wall off the end of a partition line — is one wall to the PM with the tape, and it read as two
 * figures: the room's share, and the free wall's own. Now the run is measured corner to corner of
 * the WALL: the label sits over the middle of the whole run and gives its whole length, and the
 * free wall carries no label of its own (`absorbed`). Typing over that label sets the whole run,
 * and `withWallRunLength` takes the free wall's share back off to size the room's wall.
 *
 * Only free walls extend a room wall this way — never another room's wall. Two rooms side by side
 * have two walls that each belong to their room and are each typed for their room, and one figure
 * across both would leave nobody knowing which they were setting.
 *
 * The run is in the wall's own fractions, so an extension is a run reaching below 0 or past 1.
 */
export function wallDimensionsWithExtensions(room: SketchRoom, wall: WallGeometry, rooms: SketchRoom[], freeWalls: FreeWall[]): { dimensions: WallDimension[]; absorbed: string[] } {
  const reach = wallExtensionReach(room, wall, freeWalls);
  const dimensions = wallDimensions(room, wall, rooms).map((dimension) => {
    let [lo, hi] = dimension.run;
    if (lo === 0) lo = reach.lo;
    if (hi === 1) hi = reach.hi;
    if (lo === dimension.run[0] && hi === dimension.run[1]) return dimension;
    return { run: [lo, hi] as [number, number], t: (lo + hi) / 2, lengthFeet: wall.lengthFeet * (hi - lo) };
  });
  return { dimensions, absorbed: reach.absorbed };
}

/** Every free wall whose length is already on a room wall's label — see `wallDimensionsWithExtensions`. */
export function absorbedFreeWallIds(rooms: SketchRoom[], freeWalls: FreeWall[]): Set<string> {
  const absorbed = new Set<string>();
  for (const room of rooms) {
    for (const wall of wallsOf(room)) {
      for (const id of wallDimensionsWithExtensions(room, wall, rooms, freeWalls).absorbed) absorbed.add(id);
    }
  }
  return absorbed;
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
  return Math.hypot(a.x - b.x, a.y - b.y) <= SAME_CORNER_PX;
}

/** A free wall's two ends. */
function ends(wall: FreeWall): [Vertex, Vertex] {
  return [wall.vertices[0] as Vertex, wall.vertices[wall.vertices.length - 1] as Vertex];
}

/** Do the segments p–q and a–b lie along one line? Both ends of each within `ON_LINE_PX` of the other's line. */
function collinear(p: { x: number; y: number }, q: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return distanceToLine(a, p, q) <= ON_LINE_PX && distanceToLine(b, p, q) <= ON_LINE_PX && distanceToLine(p, a, b) <= ON_LINE_PX && distanceToLine(q, a, b) <= ON_LINE_PX;
}

/** Perpendicular distance from a point to the infinite line through p and q. */
function distanceToLine(point: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }): number {
  const length = Math.hypot(q.x - p.x, q.y - p.y);
  if (length === 0) return Math.hypot(point.x - p.x, point.y - p.y);
  return Math.abs((q.x - p.x) * (p.y - point.y) - (p.x - point.x) * (q.y - p.y)) / length;
}

/** Distance from a point to the nearest wall of a room. */
function distanceToOutline(room: SketchRoom, point: { x: number; y: number }): number {
  let best = Infinity;
  for (const wall of wallsOf(room)) {
    if (wall.lengthPx <= 0) continue;
    const t = Math.max(0, Math.min(1, ((point.x - wall.x1) * (wall.x2 - wall.x1) + (point.y - wall.y1) * (wall.y2 - wall.y1)) / (wall.lengthPx * wall.lengthPx)));
    best = Math.min(best, Math.hypot(wall.x1 + (wall.x2 - wall.x1) * t - point.x, wall.y1 + (wall.y2 - wall.y1) * t - point.y));
  }
  return best;
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
