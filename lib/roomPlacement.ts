/**
 * Where a new room lands.
 *
 * The first version laid rooms out left to right from the canvas's top-left corner, skipping any
 * slot already taken. That was right for a sketch that fits on one screen and wrong the moment it
 * did not: a PM zoomed in on the far end of a plan pressed "Add room" and nothing seemed to happen,
 * because the room had landed back at the origin, off the edge of what they were looking at.
 *
 * Now a new room lands where the PM is working:
 *
 *   1. beside the room they have selected — to its right, below it, to its left, above it — the
 *      first side that is clear of every other room and wholly within the part of the plan on
 *      screen
 *   2. failing that, anywhere on screen that is clear, scanned left to right, top to bottom
 *   3. failing that, beside the selected room even though it is off screen
 *   4. failing that, the old scan from the origin
 *
 * `visible` says whether the spot chosen is on screen. When it is not, the editor pans to it: a
 * room that appears where you cannot see it may as well not have appeared.
 *
 * Pure geometry, in world pixels, so it can be checked in Node.
 */

import {
  type Sketch,
  type SketchRoom,
  type Vertex,
  type WallGeometry,
  DEFAULT_CEILING_HEIGHT_FEET,
  DEFAULT_ROOM_FEET,
  MIN_WALL_PX,
  PIXELS_PER_FOOT,
  WALL_THICKNESS_PX,
  dragWall,
  ensureClockwise,
  freeWallLevel,
  freeWallSegments,
  freeWallsOf,
  isRoomInside,
  newSketchId,
  nextRoomName,
  pruneCollinearVertices,
  reflowContents,
  removeVertex,
  roomBounds,
  roomLevel,
  standWallApart,
  wallById,
  wallsOf,
} from "./sketch";

export interface Viewport {
  /** The canvas transform — see `SketchView`. */
  view: { x: number; y: number; scale: number };
  /** The canvas's size on screen, in CSS pixels. */
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  /** Whether the whole room lies within the part of the plan on screen. */
  visible: boolean;
}

/** The world rectangle the canvas is showing. */
export function visibleWorld(viewport: Viewport): { minX: number; minY: number; maxX: number; maxY: number } {
  const { view, width, height } = viewport;
  const minX = -view.x / view.scale;
  const minY = -view.y / view.scale;
  return { minX, minY, maxX: minX + width / view.scale, maxY: minY + height / view.scale };
}

/**
 * A spot for a `width` x `height` room, clear of `rooms` by `gap`, preferring the neighbourhood of
 * `anchor` and the screen — see the file header for the order tried.
 */
export function placeNewRoom(params: {
  rooms: SketchRoom[];
  anchor: SketchRoom | null;
  width: number;
  height: number;
  gap: number;
  viewport: Viewport;
}): Placement {
  const { rooms, anchor, width, height, gap, viewport } = params;
  const taken = rooms.map(roomBounds);
  const clear = (x: number, y: number) => !taken.some((b) => x < b.maxX + gap && x + width + gap > b.minX && y < b.maxY + gap && y + height + gap > b.minY);
  const shown = visibleWorld(viewport);
  const onScreen = (x: number, y: number) => x >= shown.minX && y >= shown.minY && x + width <= shown.maxX && y + height <= shown.maxY;

  const beside: { x: number; y: number }[] = [];
  if (anchor) {
    const a = roomBounds(anchor);
    beside.push({ x: a.maxX + gap, y: a.minY }, { x: a.minX, y: a.maxY + gap }, { x: a.minX - gap - width, y: a.minY }, { x: a.minX, y: a.minY - gap - height });
  }

  for (const spot of beside) if (clear(spot.x, spot.y) && onScreen(spot.x, spot.y)) return { ...spot, visible: true };

  /*
    Anywhere on screen. The scan steps by a fraction of the room so a spot between two rooms is
    found rather than stepped over, and starts a small margin in from the edge so the room does not
    land touching the frame of the canvas.
  */
  const margin = gap;
  const step = Math.max(gap, Math.min(width, height) / 4);
  for (let y = shown.minY + margin; y + height + margin <= shown.maxY; y += step) {
    for (let x = shown.minX + margin; x + width + margin <= shown.maxX; x += step) {
      if (clear(x, y)) return { x, y, visible: true };
    }
  }

  for (const spot of beside) if (clear(spot.x, spot.y)) return { ...spot, visible: onScreen(spot.x, spot.y) };

  // The old scan from the origin, for a plan with no room to spare anywhere near the work.
  for (let y = 40; y < 4000; y += height + gap) {
    for (let x = 40; x < 4000; x += width + gap) {
      if (clear(x, y)) return { x, y, visible: onScreen(x, y) };
    }
  }
  const x = 40 + rooms.length * 24;
  const y = 40 + rooms.length * 24;
  return { x, y, visible: onScreen(x, y) };
}

/* ── Pulling a room off a wall ──────────────────────────────────────────────────────────────── */

/** How deep a pulled room is when the PM taps the wall rather than dragging out from it. */
export const PULLED_ROOM_DEFAULT_DEPTH_PX = DEFAULT_ROOM_FEET * PIXELS_PER_FOOT;

/** Shallowest a pulled room may be, in world pixels — a foot, so a shaky release is a closet, not a line. */
export const PULLED_ROOM_MIN_DEPTH_PX = PIXELS_PER_FOOT;

/**
 * The wall's outward side: the unit normal pointing out of the room. For a clockwise polygon the
 * inward normal is the wall's direction turned +90° in screen space, so outward is the other way.
 */
export function outwardNormal(wall: WallGeometry): { x: number; y: number } {
  const length = wall.lengthPx || 1;
  return { x: (wall.y2 - wall.y1) / length, y: -(wall.x2 - wall.x1) / length };
}

/**
 * The same wall walked the other way, so that its outward side (`outwardNormal`) is the room's
 * inside: what an inward pull extrudes from.
 */
export function reversedWall(wall: WallGeometry): WallGeometry {
  return { ...wall, x1: wall.x2, y1: wall.y2, x2: wall.x1, y2: wall.y1, rotation: (wall.rotation + 180) % 360 };
}

/**
 * Where a room pulled off [wall] starts, as the wall it is extruded from ([extrudeWall]).
 *
 * OUT (a positive [depthPx]): a wall's thickness beyond the wall, which is where the wall between the
 * two rooms stands - Xactimate's rule, and the rule rooms dragged together follow
 * (`snapRoomTranslation`). Pulled flush off the wall, as it always was until 2026-09-26, the new
 * room's inside touched the old one's with nowhere for the wall between them, and the wall was drawn
 * over the new room's floor - 4" of it gone under the wall. IN (negative): on the wall's line,
 * walked the other way (`reversedWall`) - a closet pulled into a room shares the room's own wall.
 */
export function pullBase(wall: WallGeometry, depthPx: number): WallGeometry {
  if (depthPx < 0) return reversedWall(wall);
  const n = outwardNormal(wall);
  const t = WALL_THICKNESS_PX;
  return { ...wall, x1: wall.x1 + n.x * t, y1: wall.y1 + n.y * t, x2: wall.x2 + n.x * t, y2: wall.y2 + n.y * t };
}

/**
 * The depth of the room a pull makes, from how far the finger is from the wall ([pullDepthPx]):
 * pulled out, the room ends under the finger and starts a wall out ([pullBase]); pulled in, it is
 * the finger's reach. Within a wall of the wall, going out, there is no room.
 */
export function pulledRoomDepthPx(fingerPx: number): number {
  return fingerPx > 0 ? Math.max(0, fingerPx - WALL_THICKNESS_PX) : fingerPx;
}

/**
 * How far out from the wall a point is, in world pixels: positive on the outside of the room,
 * negative inside it. The depth a pull gesture has reached, and which way it went.
 */
export function pullDepthPx(wall: WallGeometry, point: { x: number; y: number }): number {
  const n = outwardNormal(wall);
  return (point.x - wall.x1) * n.x + (point.y - wall.y1) * n.y;
}

/**
 * The outline of the room a pull makes, corners clockwise, or null when nothing worth calling a
 * room fits: what the editor makes ([pullRoomFromWall]) and what the canvas shows while the finger
 * is still down, so the outline followed is the room that lands.
 *
 * The band swept [depthPx] out from [pullBase] and stopped by whatever walls are in the way
 * ([extrudeWall]); then every side of it that came to lie flush against another room - insides
 * touching - moved a wall's thickness in ([standWallApart]), so the new room meets the rooms around
 * it across a wall, as it meets the room it was pulled from.
 */
export function pulledRoomOutline(source: SketchRoom, own: WallGeometry, depthPx: number, around: { obstacles: Obstacle[]; rooms: SketchRoom[] }): Vertex[] | null {
  const wall = pullBase(own, depthPx);
  const depth = Math.max(PULLED_ROOM_MIN_DEPTH_PX, Math.abs(depthPx));
  /*
    The far side follows whatever walls are in the way — see `extrudeWall`. Out, along, back is
    clockwise by construction when the source is, which every room is; `ensureClockwise` guards a
    source that somehow is not, and does nothing otherwise — and puts an inward pull, which comes
    out the other way round, right.
  */
  const band = extrudeWall(wall, depth, around.obstacles);
  if (!band) return null;
  const far = depthPx < 0 ? levelNarrowPockets(band.far, wall) : band.far;
  const clockwise = ensureClockwise(far.map((p) => ({ id: newSketchId("v"), x: p.x, y: p.y })));
  if (clockwise.length < 3) return null;
  const tidy = pruneCollinearVertices({ ...source, vertices: clockwise, symbols: [], freeCabinets: [] }).vertices;
  const traced = depthPx > 0 ? alongSourceRoom(tidy, source, own, around.obstacles) : tidy;
  const apart = standWallApart(traced, roomLevel(source), around.rooms);
  // Nothing worth calling a room: a band too thin, or nothing left in front of the wall.
  if (Math.abs(polygonArea(apart)) < PIXELS_PER_FOOT * PIXELS_PER_FOOT) return null;
  return apart;
}

/**
 * A PULL FOLLOWS THE ROOM IT CAME FROM (2026-10-05). The band a pull sweeps is as wide as the wall it
 * was pulled from, and a wall in a notch of its room - the bedroom's 4'1" wall under a diagonal closet
 * door, with the rec room's wall above - gave a closet that stopped at the wall's own top end: "when
 * pulling it isnt tracing the room shape thats already there with the shared wall. keeps stopping
 * short" (the owner, on the walk of 10:07). So each side of the band carries on along the room it was
 * pulled from, as far as that room's own lines reach that way: it is dragged out sideways as the
 * editor's own wall drag drags a wall ([conformedDragWall]), following whatever walls stand in the way
 * a wall off them - the room's diagonal, the room next door. A wall that is a whole side of its room
 * reaches no further, and the band is as it was.
 */
function alongSourceRoom(band: Vertex[], source: SketchRoom, own: WallGeometry, obstacles: Obstacle[]): Vertex[] {
  if (own.lengthPx <= 0) return band;
  const ux = (own.x2 - own.x1) / own.lengthPx;
  const uy = (own.y2 - own.y1) / own.lengthPx;
  const along = (p: { x: number; y: number }) => (p.x - own.x1) * ux + (p.y - own.y1) * uy;
  const reach = source.vertices.map(along);
  // Every other wall of the source room is in the way of the sides, and so is the wall pulled from.
  const around = [...obstacles, { x1: own.x1, y1: own.y1, x2: own.x2, y2: own.y2, room: true }];
  let room: SketchRoom = { ...source, id: newSketchId("room"), vertices: band, symbols: [], freeCabinets: [] };
  const walls = wallsOf(source);
  const at = walls.findIndex((w) => w.id === own.id);
  const n = outwardNormal(own);
  const middle = { x: (own.x1 + own.x2) / 2 + n.x * (WALL_THICKNESS_PX + 1), y: (own.y1 + own.y2) / 2 + n.y * (WALL_THICKNESS_PX + 1) };
  for (const [end, beyond, next] of [
    [0, -Math.min(...reach), -1],
    [own.lengthPx, Math.max(...reach) - own.lengthPx, 1],
  ] as const) {
    if (beyond <= 1 || at < 0) continue;
    // The wall meeting the pulled one at that end. Only where it comes FORWARD - out in front of the pulled wall, as
    // a notch's wall does - does the room carry on that way; one that turns back behind it is the room's own corner,
    // and the band stops at the wall's end as it always has.
    const meeting = walls[(at + next + walls.length) % walls.length] as WallGeometry;
    const far = next < 0 ? { x: meeting.x1, y: meeting.y1 } : { x: meeting.x2, y: meeting.y2 };
    if ((far.x - own.x1) * n.x + (far.y - own.y1) * n.y <= 1) continue;
    // When the band stands outside it - a diagonal across the notch's corner - the band's corner is cut a wall off it
    // first, or the side dragged from there starts inside that wall.
    const m = outwardNormal(meeting);
    if ((middle.x - meeting.x1) * m.x + (middle.y - meeting.y1) * m.y > 0) {
      const cut = cutToHalfPlane(room.vertices, (q) => (q.x - meeting.x1) * m.x + (q.y - meeting.y1) * m.y - WALL_THICKNESS_PX);
      if (cut.length < 3) continue;
      room = { ...room, vertices: cut };
    }
    // The side of the band at that end: the wall square to the pulled one, across the band there.
    const side = wallsOf(room).find((w) => {
      const a = along({ x: w.x1, y: w.y1 });
      const b = along({ x: w.x2, y: w.y2 });
      return Math.abs(a - end) < 1 && Math.abs(b - end) < 1 && w.lengthPx > 1;
    });
    if (!side) continue;
    const sign = end === 0 ? -1 : 1;
    room = conformedDragWall(room, side.id, ux * sign * beyond, uy * sign * beyond, around);
  }
  return room.vertices;
}

/** Narrower than this along the wall, and no deeper than this past the far side beside it, a pocket is not followed. */
const POCKET_PX = PIXELS_PER_FOOT;

/**
 * A PULL INTO A ROOM DOES NOT FOLLOW A POCKET UNDER A FOOT (2026-10-08). The owner pulled a sub-room down off the top of
 * the family room's end, past its bottom wall, and it came out with an 0'8" piece and a 3" jog in its bottom: the family
 * room's bottom wall steps 3" down 8" along from where its end begins, and the band followed the step into that 8" x 3"
 * pocket, and every corner drag after that worked on a six-cornered room. A stretch of the far side narrower than
 * [POCKET_PX] that reaches deeper than the far side beside it, by less than [POCKET_PX], is brought back level with
 * it - the deeper side's level when both are shallower. Only ever nearer the wall pulled from, so never into a wall; the
 * pocket stays the room's floor. Inward pulls only ([pulledRoomOutline]): pulled out, the band meets other rooms, and a
 * side short of one of them is no longer flush with it.
 */
function levelNarrowPockets(far: { x: number; y: number }[], wall: WallGeometry): { x: number; y: number }[] {
  const L = wall.lengthPx;
  if (L <= 0 || far.length < 6) return far;
  const tx = (wall.x2 - wall.x1) / L;
  const ty = (wall.y2 - wall.y1) / L;
  const n = outwardNormal(wall);
  let path = far.map((p) => ({ u: (p.x - wall.x1) * tx + (p.y - wall.y1) * ty, v: (p.x - wall.x1) * n.x + (p.y - wall.y1) * n.y }));
  const level = (a: { u: number; v: number }, b: { u: number; v: number }) => Math.abs(a.v - b.v) <= EXTRUDE_EPS && b.u - a.u > EXTRUDE_EPS;
  const step = (a: { u: number; v: number }, b: { u: number; v: number }) => Math.abs(a.u - b.u) <= EXTRUDE_EPS;
  for (let changed = true; changed; ) {
    changed = false;
    // Inside the two corners on the wall itself (the first and last points): those steps are the band's own sides.
    for (let i = 1; i + 1 < path.length - 1; i++) {
      const a = path[i] as { u: number; v: number };
      const b = path[i + 1] as { u: number; v: number };
      if (!level(a, b) || b.u - a.u >= POCKET_PX) continue;
      const beside: number[] = [];
      const before = path[i - 1] as { u: number; v: number };
      const after = path[i + 2] as { u: number; v: number };
      if (i - 1 > 0 && step(before, a)) beside.push(before.v);
      if (i + 2 < path.length - 1 && step(b, after)) beside.push(after.v);
      const shallower = beside.filter((v) => v < a.v && a.v - v < POCKET_PX);
      if (shallower.length === 0) continue;
      const v = Math.max(...shallower);
      path[i] = { u: a.u, v };
      path[i + 1] = { u: b.u, v };
      changed = true;
    }
    // Points run together and straight runs made one, so the stretch beside a levelled pocket is one stretch again.
    path = path.filter((p, i) => i === 0 || Math.hypot(p.u - (path[i - 1] as { u: number }).u, p.v - (path[i - 1] as { v: number }).v) > EXTRUDE_EPS);
    const straight: { u: number; v: number }[] = [];
    for (const p of path) {
      const a = straight[straight.length - 2];
      const b = straight[straight.length - 1];
      if (a && b && Math.abs((b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u)) <= 1e-6 * Math.max(1, Math.hypot(p.u - a.u, p.v - a.v))) straight.pop();
      straight.push(p);
    }
    path = straight;
  }
  return path.map((p) => ({ x: wall.x1 + tx * p.u + n.x * p.v, y: wall.y1 + ty * p.u + n.y * p.v }));
}

/** [ring] cut to where [keep] is zero or more, its corners keeping their ids and those the cut makes taking new ones. */
function cutToHalfPlane(ring: Vertex[], keep: (p: { x: number; y: number }) => number): Vertex[] {
  const out: Vertex[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Vertex;
    const q = ring[(i + 1) % ring.length] as Vertex;
    const kp = keep(p);
    const kq = keep(q);
    if (kp >= 0) out.push(p);
    if (kp >= 0 !== kq >= 0) {
      const t = kp / (kp - kq);
      out.push({ id: newSketchId("v"), x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length] as Vertex;
    return out.length < 2 || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6;
  });
}

/**
 * A new room pulled off one wall of an existing room: the far side of a shared wall.
 *
 * The next room over shares a wall with this one, exactly — same two corners, same angle — and the
 * only honest way to draw that was to add a box and drag its corners onto the neighbour's until
 * they snapped, four times, for every room in the house. Now the wall is the starting point: the
 * new room stands across the tapped wall from this one — its near side a wall's thickness out
 * ([pullBase]), the wall between them filling the gap — and it is `depthPx` deep, straight out,
 * whatever angle the wall lies at.
 *
 * It goes out only as far as the walls already there allow — `extrudeWall` — so its far side and
 * its flanks are made of those walls where they stand in the way, angle and all, and it never lies
 * over another room; and where it comes up against another room it stops a wall short of it, as it
 * stands a wall off the room it was pulled from ([pulledRoomOutline]).
 *
 * The doors, openings and windows in every wall it shares are seen from the new side — the wall
 * it was pulled from, and any wall it came to rest along — without being copied into it: a door
 * is one thing in one room's wall, drawn and deducted from both sides (`openingsSharedWith`). A
 * first version copied them in as openings of the new room's own, and the copies drifted from the
 * doors they were copies of the first time either was moved. Cabinets and fixtures stand against
 * one side of a wall, not in it, and are the one room's.
 *
 * A NEGATIVE depth pulls the other way, into the room the wall belongs to: a closet off that wall,
 * bounded by the room's other walls and whatever already stands inside it, and a sub-room of it by
 * geometry the moment it lands. Asked for from the field: the pull only ever went out.
 */
export function pullRoomFromWall(
  source: SketchRoom,
  wallId: string,
  depthPx: number,
  around: { obstacles: Obstacle[]; rooms: SketchRoom[] } = { obstacles: [], rooms: [source] },
): SketchRoom | null {
  const own = wallById(source, wallId);
  if (!own || own.lengthPx < MIN_WALL_PX) return null;
  // Out, a wall beyond the wall; in, the same band off the same wall taken the other way round -
  // see `pullBase`. And a wall short of any other room it meets - see `pulledRoomOutline`.
  const vertices = pulledRoomOutline(source, own, depthPx, around);
  if (!vertices) return null;
  const room: SketchRoom = {
    id: newSketchId("room"),
    name: nextRoomName(around.rooms),
    vertices,
    ceilingHeightFeet: source.ceilingHeightFeet ?? DEFAULT_CEILING_HEIGHT_FEET,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
  };
  if (roomLevel(source) !== 0) room.level = roomLevel(source);
  return room;
}

/** Signed polygon area, in square pixels. */
function polygonArea(vertices: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i] as { x: number; y: number };
    const b = vertices[(i + 1) % vertices.length] as { x: number; y: number };
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/* ── Pushing a wall out until it meets something ────────────────────────────────────────────── */

/** A straight piece of wall in the way of an extrusion — another room's wall, or a free wall. */
export interface Obstacle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * A room's wall, running the way its room winds (clockwise), so which face is its outside is
   * known: a wall dragged up to it stops at that face ([wallDragBand]). A free wall has no sides.
   */
  room?: boolean;
}

/**
 * Every wall on a storey that a wall being pushed out could run into: rooms' walls and free walls,
 * less the room whose wall is moving (`exceptRoomId` — its own walls move with it) or the one wall
 * being pulled from (`exceptWall` — the rest of that room still stands in the way).
 */
export function obstaclesFor(
  sketch: Sketch,
  level: number,
  except: { roomId?: string; wall?: { roomId: string; wallId: string }; inward?: boolean },
): Obstacle[] {
  const out: Obstacle[] = [];
  const from = sketch.rooms.find((r) => r.id === (except.roomId ?? except.wall?.roomId));
  for (const room of sketch.rooms) {
    if (room.id === except.roomId || roomLevel(room) !== level) continue;
    // A room drawn inside the one being worked on — its closet — lies behind every wall of it,
    // whichever it is. Its walls are not in the way of a wall going OUT; a closet flush to the
    // wall has a wall along that very line, and taken as an obstacle it read as a room already
    // standing in front. Going IN (`inward`, a closet pulled into the room) they are exactly what
    // is in the way.
    if (!except.inward && from && room.id !== from.id && isRoomInside(room, from)) continue;
    for (const w of wallsOf(room)) {
      if (except.wall && except.wall.roomId === room.id && except.wall.wallId === w.id) continue;
      out.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, room: true });
    }
  }
  for (const wall of freeWallsOf(sketch)) {
    if (freeWallLevel(wall) !== level) continue;
    for (const s of freeWallSegments(wall)) out.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 });
  }
  return out;
}

/**
 * Within this of the wall's line, a piece is along the wall — the same six pixels that make a
 * sub-room's wall count as lying on its parent's (`exposedWallRuns`), and that room snapping
 * lands within.
 */
const ALONG_WALL_PX = 6;

/** Closer than this, two points along an extrusion are one. */
const EXTRUDE_EPS = 0.5;

/**
 * The outline of a wall pushed `depthPx` straight out from itself, stopped by whatever walls are in
 * the way — the shape a pulled room takes, and a dragged wall when it runs into something.
 *
 * Reported from the field with three pictures: a room pulled off a wall ran straight across the
 * angled wall and door hanging off that wall's corner, and widening it ran its side over them.
 * "Rooms shouldn't overlap like this — it should continue following that existing wall and shape
 * and door." So the band a wall sweeps out is bounded by every wall it meets: at each point along
 * the wall the room reaches out only as far as the first wall in the way, or the depth, whichever
 * comes first. Where an obstacle ends and the band goes on past it, the outline steps out along
 * the obstacle's end — usually along the next wall of whatever it was, so the new room's side is
 * made of the walls already there, angle and all.
 *
 * Worked in the wall's own frame — `u` along it from its start, `v` straight out — where the far
 * side is the lower envelope of the obstacles' pieces and the depth line. Pieces lying along the
 * wall itself (v = 0) belong to whatever already stands against it and close the band there;
 * pieces square to the wall have no run along it and shape nothing, which is what lets a wall
 * hanging off a corner or standing across the band be drawn and stay a wall on its own.
 *
 * Returns the far side as points from the wall's start corner to its end corner, in world
 * coordinates, corners included, and whether any obstacle limited it — or null when nothing at
 * all fits in front of the wall: nowhere is [minDepthPx] free. A pull wants half its least room; a
 * wall dragged ([wallDragBand]) wants any room at all to move into. A piece within [alongPx] of the
 * wall is against it: a pull's [ALONG_WALL_PX], a room snapped flush a pixel or so off; a drag's a
 * hair, since what it meets is a face a wall's thickness off a room, and 6" short of that face is
 * room to move.
 */
export function extrudeWall(
  wall: WallGeometry,
  depthPx: number,
  obstacles: Obstacle[],
  { minDepthPx = PULLED_ROOM_MIN_DEPTH_PX / 2, alongPx = ALONG_WALL_PX }: { minDepthPx?: number; alongPx?: number } = {},
): { far: { x: number; y: number }[]; limited: boolean } | null {
  const L = wall.lengthPx;
  if (L <= 0 || depthPx <= 0) return null;
  const tx = (wall.x2 - wall.x1) / L;
  const ty = (wall.y2 - wall.y1) / L;
  const n = outwardNormal(wall);
  const local = (p: { x: number; y: number }) => ({ u: (p.x - wall.x1) * tx + (p.y - wall.y1) * ty, v: (p.x - wall.x1) * n.x + (p.y - wall.y1) * n.y });
  const world = (u: number, v: number) => ({ x: wall.x1 + tx * u + n.x * v, y: wall.y1 + ty * u + n.y * v });

  // The pieces of the obstacles that lie within the band, as v over u, running left to right.
  const pieces: { u1: number; v1: number; u2: number; v2: number }[] = [];
  for (const o of obstacles) {
    let a = local({ x: o.x1, y: o.y1 });
    let b = local({ x: o.x2, y: o.y2 });
    if (a.u > b.u) [a, b] = [b, a];
    if (b.u - a.u <= EXTRUDE_EPS) continue; // square to the wall: no run along it
    // Clip to the band: 0 <= u <= L, 0 <= v <= depth. A piece entirely behind the wall or beyond
    // the depth is no obstacle; one that crosses in is kept from where it crosses.
    const vAt = (u: number) => a.v + ((b.v - a.v) * (u - a.u)) / (b.u - a.u);
    let u1 = Math.max(a.u, 0);
    let u2 = Math.min(b.u, L);
    if (u2 - u1 <= EXTRUDE_EPS) continue;
    let v1 = vAt(u1);
    let v2 = vAt(u2);
    // A piece running along the wall within the same tolerance as a shared wall anywhere else is
    // ON the wall: a room already standing against it, which leaves nothing to pull there. A room
    // snapped flush lands a pixel or so either side of the line, and a pixel inside read as
    // "wholly behind the wall" — so the room pulled off that wall ran the whole length, over it.
    if (Math.abs(v1) <= alongPx && Math.abs(v2) <= alongPx) {
      v1 = 0;
      v2 = 0;
    }
    if (Math.max(v1, v2) < -EXTRUDE_EPS) continue; // wholly behind the wall
    if (Math.min(v1, v2) > depthPx + EXTRUDE_EPS) continue; // wholly beyond reach
    // Trim the part behind the wall, so a piece that comes in from behind starts at the wall.
    if (v1 < 0 || v2 < 0) {
      const uAtZero = u1 + ((0 - v1) * (u2 - u1)) / (v2 - v1);
      if (v1 < 0) {
        u1 = uAtZero;
        v1 = 0;
      } else {
        u2 = uAtZero;
        v2 = 0;
      }
      if (u2 - u1 <= EXTRUDE_EPS) continue;
    }
    pieces.push({ u1, v1, u2, v2 });
  }

  // Where the envelope can change hands: piece ends, and pieces crossing each other.
  const events = new Set<number>([0, L]);
  for (const p of pieces) {
    events.add(p.u1);
    events.add(p.u2);
    // Where a piece crosses the depth line, the depth takes over from it, or it from the depth.
    if ((p.v1 - depthPx) * (p.v2 - depthPx) < 0) events.add(p.u1 + ((depthPx - p.v1) * (p.u2 - p.u1)) / (p.v2 - p.v1));
  }
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[i] as { u1: number; v1: number; u2: number; v2: number };
      const q = pieces[j] as { u1: number; v1: number; u2: number; v2: number };
      const lo = Math.max(p.u1, q.u1);
      const hi = Math.min(p.u2, q.u2);
      if (hi - lo <= EXTRUDE_EPS) continue;
      const sp = (p.v2 - p.v1) / (p.u2 - p.u1);
      const sq = (q.v2 - q.v1) / (q.u2 - q.u1);
      if (Math.abs(sp - sq) < 1e-9) continue;
      const u = (q.v1 - q.u1 * sq - (p.v1 - p.u1 * sp)) / (sp - sq);
      if (u > lo && u < hi) events.add(u);
    }
  }
  // Stops closer together than the tolerance are one stop. A wall drawn a hair off its line comes
  // into the band a fraction past the corner rather than at it, and taken literally that fraction
  // is a stretch with nothing in it — a sliver at full depth in front of the corner, and the far
  // side spiking out and back through it. The corner itself stays exact whatever merged into it.
  const stops: number[] = [];
  for (const u of [...events].filter((u) => u >= 0 && u <= L).sort((a, b) => a - b)) {
    const last = stops[stops.length - 1];
    if (last === undefined || u - last > EXTRUDE_EPS) stops.push(u);
  }
  if ((stops[stops.length - 1] as number) < L) stops[stops.length - 1] = L;

  // The far side over each stretch between stops: the lowest piece there, or the depth line.
  const path: { u: number; v: number }[] = [{ u: 0, v: 0 }];
  const push = (u: number, v: number) => {
    const last = path[path.length - 1] as { u: number; v: number };
    if (Math.hypot(u - last.u, v - last.v) > EXTRUDE_EPS) path.push({ u, v });
  };
  let anyRoom = false;
  let limited = false;
  for (let i = 0; i + 1 < stops.length; i++) {
    const ua = stops[i] as number;
    const ub = stops[i + 1] as number;
    if (ub - ua <= 1e-9) continue;
    // Which piece rules this stretch is decided at its middle; its ends are then read off that piece.
    const um = (ua + ub) / 2;
    let ruling: { u1: number; v1: number; u2: number; v2: number } | null = null;
    let vm = depthPx;
    for (const p of pieces) {
      if (um < p.u1 || um > p.u2) continue;
      const v = p.v1 + ((p.v2 - p.v1) * (um - p.u1)) / (p.u2 - p.u1);
      if (v < vm) {
        vm = v;
        ruling = p;
      }
    }
    if (ruling) limited = true;
    // Read off the ruling piece's line, held within the band: a stretch reaches a hair past the
    // piece's end where a stop merged into another.
    const vAtEnd = (u: number) => (ruling ? Math.min(depthPx, Math.max(0, ruling.v1 + ((ruling.v2 - ruling.v1) * (u - ruling.u1)) / (ruling.u2 - ruling.u1))) : depthPx);
    const va = vAtEnd(ua);
    const vb = vAtEnd(ub);
    if (vb > minDepthPx || va > minDepthPx) anyRoom = true;
    push(ua, va);
    push(ub, vb);
  }
  push(L, 0);
  if (!anyRoom) return null;

  // Straight runs through a point are one run; the stops were only where something might change.
  const cleaned: { u: number; v: number }[] = [];
  for (const p of path) {
    const a = cleaned[cleaned.length - 2];
    const b = cleaned[cleaned.length - 1];
    if (a && b && Math.abs((b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u)) <= 1e-6 * Math.max(1, Math.hypot(p.u - a.u, p.v - a.v))) cleaned.pop();
    cleaned.push(p);
  }
  return { far: cleaned.map((p) => world(p.u, p.v)), limited };
}

/**
 * Does any wall of the room cross an obstacle — meet it at a point inside both, rather than
 * touching it at an end or lying along it? Sharing a wall is how rooms sit together; crossing one
 * is a drawing of something that cannot be built.
 */
export function crossesAny(room: SketchRoom, obstacles: Obstacle[]): boolean {
  return wallsOf(room).some((w) => obstacles.some((o) => properlyCross(w.x1, w.y1, w.x2, w.y2, o.x1, o.y1, o.x2, o.y2)));
}

function properlyCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false; // parallel or along one line: never a crossing
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const s = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  const eps = 1e-6;
  return t > eps && t < 1 - eps && s > eps && s < 1 - eps;
}

/**
 * A wall dragged outward that would run into other walls follows them instead — see
 * `extrudeWall`. A drag whose band meets nothing is the ordinary `dragWall`, which keeps the room's
 * own angles; only a drag that would reach a wall is reshaped, and then the walls in the way become
 * the room's side. Decided by what stands in the band, not by whether the moved walls cross
 * anything: a room dragged clean over a neighbour that lines up with it crosses no wall of it at
 * all. Inward drags never meet anything that is not already inside the room.
 *
 * Worked from the wall as it was when the drag began (`room` is that room) and the whole travel so
 * far, not frame by frame: the shape the band takes depends on how far out it goes, and a band
 * grown a few pixels at a time from a reshaped room would compound.
 *
 * The doors and windows in the dragged wall move out with it, onto whichever piece of the new
 * side lies where they were along the wall. The doors in the walls the room came to lie along are
 * seen from the new side without being copied in (`openingsSharedWith`), as for a pulled room.
 */
export function conformedDragWall(room: SketchRoom, wallId: string, dx: number, dy: number, obstacles: Obstacle[]): SketchRoom {
  const wall = wallById(room, wallId);
  if (!wall) return room;
  const band = wallDragBand(wall, dx, dy, obstacles);
  if (band === "plain") return dragWall(room, wallId, dx, dy);
  if (band === null) return room;
  const path = band.far;
  if (path.length < 2) return room;
  const count = room.vertices.length;
  const index = room.vertices.findIndex((v) => v.id === wallId);
  const start = room.vertices[index];
  const end = room.vertices[(index + 1) % count];
  const before = room.vertices[(index - 1 + count) % count];
  if (!start || !end || !before) return room;

  // The far side's corners between the wall's own two. Where the band runs straight on from the
  // start corner — the wall before it and the new side lie along one line — that corner is no
  // corner any more: it moves up to the first turn instead of a new corner going there, keeping
  // its id, because that id is the wall's, and the wall must stay itself for the whole drag (the
  // grip being dragged is that wall's; lose the id and the drag stops dead a frame in).
  let inner = path.slice(1, -1).map((p) => ({ id: newSketchId("v"), x: p.x, y: p.y }));
  let startCorner = start;
  const firstTurn = inner[0];
  const startFlat = firstTurn !== undefined && flat(before, start, firstTurn);
  if (startFlat) {
    startCorner = { ...start, x: firstTurn.x, y: firstTurn.y };
    inner = inner.slice(1);
  }
  const vertices = [...room.vertices.slice(0, index), startCorner, ...inner, ...room.vertices.slice(index + 1)];
  const reshaped: SketchRoom = { ...room, vertices };

  // Symbols on the old wall land on the piece of the new side that lies at their place along it.
  // With the start corner moved up, the wall before it now covers the first stretch of the side.
  const along = (p: { x: number; y: number }) => ((p.x - wall.x1) * (wall.x2 - wall.x1) + (p.y - wall.y1) * (wall.y2 - wall.y1)) / wall.lengthPx;
  const newWalls = wallsOf(reshaped);
  const onNewSide = (id: string) => id === start.id || inner.some((v) => v.id === id) || (startFlat && id === before.id);
  // Everything else in the room follows the rule every resize follows (`reflowContents`): a
  // symbol on a wall that changed length — the wall before the moved corner, now longer or (at a
  // reflex corner) shorter — stays the same distance from whichever corner it was nearer, and an
  // island holds its corner. A symbol's place is a fraction of its wall, so left alone it slid
  // along with the wall: reported from the field as an opening that drifted down the wall on the
  // next widening. The same rule as the plain drag, so a drag that meets a wall part-way through
  // does not move the doors differently from the frames before it.
  const reflowed = new Map(reflowContents(room, { ...reshaped, symbols: room.symbols }).symbols.map((s) => [s.id, s] as const));
  const symbols = room.symbols.map((symbol) => {
    if (symbol.wallId !== wallId) return reflowed.get(symbol.id) ?? symbol;
    const u = symbol.t * wall.lengthPx;
    const host = newWalls.find((w) => {
      const a = along({ x: w.x1, y: w.y1 });
      const b = along({ x: w.x2, y: w.y2 });
      return Math.abs(b - a) > EXTRUDE_EPS && u >= Math.min(a, b) - EXTRUDE_EPS && u <= Math.max(a, b) + EXTRUDE_EPS && onNewSide(w.id);
    });
    if (!host) return symbol;
    const a = along({ x: host.x1, y: host.y1 });
    const b = along({ x: host.x2, y: host.y2 });
    return { ...symbol, wallId: host.id, t: Math.min(1, Math.max(0, (u - a) / (b - a))) };
  });
  // The end corner stays where it was, so where the band comes back to it straight along the next
  // wall it lies flat on that wall and goes (`removeVertex` carries the symbols across). Nothing
  // else of the room is touched: a break left elsewhere on it is pruned when the room is left, as
  // it always was, not by dragging some other wall.
  const withSymbols: SketchRoom = { ...reshaped, symbols, freeCabinets: reflowContents(room, reshaped).freeCabinets };
  const tail = inner[inner.length - 1] ?? startCorner;
  const after = room.vertices[(index + 2) % count];
  return after && flat(tail, end, after) ? removeVertex(withSymbols, end.id) : withSymbols;
}

/**
 * What a wall drag of `dx, dy` meets: "plain" when nothing is in the band (an inward drag, or an
 * outward one that reaches no wall) and the ordinary `dragWall` applies; the band when a wall in
 * the way shapes the new side; null when there is no room to move into at all. A room's wall
 * facing the dragged one is met at its outer face ([facingOuterFace]).
 */
function wallDragBand(wall: WallGeometry, dx: number, dy: number, obstacles: Obstacle[]): ReturnType<typeof extrudeWall> | "plain" {
  const n = outwardNormal(wall);
  const depth = dx * n.x + dy * n.y;
  if (depth <= 0) return "plain";
  /*
    ANY DISTANCE (2026-10-05). The drag used the pull's test - half a foot of room or none - so a wall
    within 6" of a room's wall could not be dragged up to it at all, and a nudge under 6" was refused
    outright: "keeps stopping short and not allowing me to pull any further" (the owner). A wall
    moves any distance it has room for.
  */
  const faced: Obstacle[] = [];
  for (const o of obstacles) {
    const face = facingOuterFace(o, wall);
    faced.push(face);
    if (face !== o) faced.push(...heldBack(o, face, wall));
  }
  const band = extrudeWall(wall, depth, faced, { minDepthPx: EXTRUDE_EPS, alongPx: EXTRUDE_EPS });
  if (!band) return null;
  return band.limited ? band : "plain";
}

/**
 * Where [face] - a room's wall [raw] stood a wall's thickness off ([facingOuterFace]) - crosses the dragged [wall]'s
 * line, the stretch of the wall on the side where the face is behind it while the wall itself is in front of it
 * stands within that wall's thickness already: it can go no further out. A piece along the dragged wall closes the
 * band there. Without it the stretch saw nothing in front of it - the face behind, the wall not counted - and the
 * drag ran a sliver straight up into the room beyond: the closet pulled off the bedroom's 4'1" wall, its top dragged
 * past the bedroom's diagonal (2026-10-05).
 */
function heldBack(raw: Obstacle, face: Obstacle, wall: WallGeometry): Obstacle[] {
  const L = wall.lengthPx;
  if (L <= 0) return [];
  const tx = (wall.x2 - wall.x1) / L;
  const ty = (wall.y2 - wall.y1) / L;
  const n = outwardNormal(wall);
  const local = (x: number, y: number) => ({ u: (x - wall.x1) * tx + (y - wall.y1) * ty, v: (x - wall.x1) * n.x + (y - wall.y1) * n.y });
  const fa = local(face.x1, face.y1);
  const fb = local(face.x2, face.y2);
  if (fa.v > 0 === fb.v > 0 || Math.abs(fb.u - fa.u) <= EXTRUDE_EPS) return [];
  const crossing = fa.u + ((0 - fa.v) * (fb.u - fa.u)) / (fb.v - fa.v);
  const behindLow = (fa.u < fb.u ? fa.v : fb.v) <= 0;
  const ra = local(raw.x1, raw.y1);
  const rb = local(raw.x2, raw.y2);
  if (Math.abs(rb.u - ra.u) <= EXTRUDE_EPS) return [];
  const u1 = Math.max(behindLow ? 0 : crossing, Math.min(ra.u, rb.u), 0);
  const u2 = Math.min(behindLow ? crossing : L, Math.max(ra.u, rb.u), L);
  if (u2 - u1 <= EXTRUDE_EPS) return [];
  const middle = (u1 + u2) / 2;
  if (ra.v + ((rb.v - ra.v) * (middle - ra.u)) / (rb.u - ra.u) <= 0) return [];
  return [{ x1: wall.x1 + tx * u1, y1: wall.y1 + ty * u1, x2: wall.x1 + tx * u2, y2: wall.y1 + ty * u2 }];
}

/**
 * Does this drag run into a wall and get reshaped by it — see `conformedDragWall`? The editor asks
 * at the end of a drag: a wall placed by the walls in its way is left exactly there, and not then
 * snapped to the room's own corners. Snapping is for a wall the PM put down freehand, and after a
 * reshape the id the drag began with names the first piece of the new side — the sliver along the
 * angled wall, in the report — whose "snap" moved that sliver off the wall it followed and pulled
 * the top wall up askew with it.
 */
/**
 * [o] as a wall dragged up to it meets it. A room's wall the dragged [wall] stands OUTSIDE of - on
 * the far side of its line from its own room - stands at its outer face: a wall's thickness toward
 * [wall], and a thickness longer at each end, which is where that room's walls stand round its
 * corners. So the dragged wall stops a wall short of the room and clear of its corners, with one wall
 * between the two, as rooms dragged together (`snapRoomTranslation`) and pulled rooms
 * (`pulledRoomOutline`) have. Stopped at the inside face, as it was until 2026-09-26, the dragged
 * room ended flush and the wall between them was drawn over one of the floors.
 *
 * At ANY angle (2026-10-05): until then only a wall facing the dragged one square on stood off, and a
 * drag that followed the bedroom's diagonal closet wall lay flush along it, its floor under that wall.
 * A wall the dragged one is INSIDE of - the room a closet stands in - is where it is: the closet
 * shares its walls. A free wall has no sides and is where it is.
 */
function facingOuterFace(o: Obstacle, wall: WallGeometry): Obstacle {
  if (!o.room || wall.lengthPx <= 0) return o;
  const length = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
  if (length <= 0) return o;
  const ux = (o.x2 - o.x1) / length;
  const uy = (o.y2 - o.y1) / length;
  // Out of its own room is its direction turned -90 degrees, (uy, -ux): a room is clockwise. The
  // dragged wall's middle on that side, it is outside that room there.
  const mx = (wall.x1 + wall.x2) / 2;
  const my = (wall.y1 + wall.y2) / 2;
  if ((mx - o.x1) * uy - (my - o.y1) * ux <= 0) return o;
  const t = WALL_THICKNESS_PX;
  return { ...o, x1: o.x1 + uy * t - ux * t, y1: o.y1 - ux * t - uy * t, x2: o.x2 + uy * t + ux * t, y2: o.y2 - ux * t + uy * t };
}

export function wallDragMeetsWall(room: SketchRoom, wallId: string, dx: number, dy: number, obstacles: Obstacle[]): boolean {
  const wall = wallById(room, wallId);
  if (!wall) return false;
  const band = wallDragBand(wall, dx, dy, obstacles);
  return band !== "plain" && band !== null;
}

/** Whether `b` lies flat on the line from `a` to `c` — no corner there, within half a degree. */
function flat(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): boolean {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return lengths > 0 && Math.abs(ux * vy - uy * vx) / lengths < 0.01;
}

/**
 * The view that puts a room in the middle of the canvas, at the zoom it has: where the canvas pans
 * to when a room lands off screen.
 */
export function viewCentredOn(room: { x: number; y: number; width: number; height: number }, viewport: Viewport): { x: number; y: number; scale: number } {
  const { view, width, height } = viewport;
  const cx = room.x + room.width / 2;
  const cy = room.y + room.height / 2;
  return { scale: view.scale, x: width / 2 - cx * view.scale, y: height / 2 - cy * view.scale };
}
