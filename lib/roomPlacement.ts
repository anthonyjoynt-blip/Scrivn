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
  type SketchRoom,
  type SketchSymbol,
  type WallGeometry,
  DEFAULT_CEILING_HEIGHT_FEET,
  DEFAULT_ROOM_FEET,
  MIN_WALL_PX,
  PIXELS_PER_FOOT,
  ensureClockwise,
  newSketchId,
  roomBounds,
  roomLevel,
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
 * How far out from the wall a point is, in world pixels: positive on the outside of the room.
 * The depth a pull gesture has reached.
 */
export function pullDepthPx(wall: WallGeometry, point: { x: number; y: number }): number {
  const n = outwardNormal(wall);
  return (point.x - wall.x1) * n.x + (point.y - wall.y1) * n.y;
}

/**
 * A new room pulled off one wall of an existing room: the far side of a shared wall.
 *
 * The next room over shares a wall with this one, exactly — same two corners, same angle — and the
 * only honest way to draw that was to add a box and drag its corners onto the neighbour's until
 * they snapped, four times, for every room in the house. Now the wall is the starting point: the
 * new room's near wall IS the tapped wall, and it goes `depthPx` straight out from it, whatever
 * angle the wall lies at.
 *
 * The doors, openings and windows in that wall come with it. A door between two rooms is in both
 * rooms' walls, and a room drawn without it would show an unbroken wall where there is a doorway
 * and deduct nothing for it. On the new side a door is an OPENING — the same hole, jambs and no
 * leaf — because a leaf swings into one room only, and it is already drawn swinging into the room
 * it was placed in; a second swing on the other side would read as a pair of doors. Cabinets and
 * fixtures stay where they are: they stand against one side of a wall, not in it.
 *
 * Symbols keep their place along the wall. The new room is wound clockwise like every room, which
 * runs its copy of the wall the other way, so a symbol at `t` sits at `1 - t` there. Nothing else
 * about the symbol changes.
 */
export function pullRoomFromWall(source: SketchRoom, wallId: string, depthPx: number): SketchRoom | null {
  const wall = wallById(source, wallId);
  if (!wall || wall.lengthPx < MIN_WALL_PX) return null;
  const depth = Math.max(PULLED_ROOM_MIN_DEPTH_PX, depthPx);
  const n = outwardNormal(wall);

  // Out, along, back: clockwise by construction when the source is, which every room is. The
  // `ensureClockwise` is a guard for a source that somehow is not, and does nothing otherwise.
  const vertices = ensureClockwise([
    { id: newSketchId("v"), x: wall.x1, y: wall.y1 },
    { id: newSketchId("v"), x: wall.x1 + n.x * depth, y: wall.y1 + n.y * depth },
    { id: newSketchId("v"), x: wall.x2 + n.x * depth, y: wall.y2 + n.y * depth },
    { id: newSketchId("v"), x: wall.x2, y: wall.y2 },
  ]);
  const room: SketchRoom = {
    id: newSketchId("room"),
    name: "",
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

  // The new room's copy of the shared wall: the one whose corners are the source wall's.
  const same = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
  const shared = wallsOf(room).find(
    (w) => (same({ x: w.x1, y: w.y1 }, { x: wall.x1, y: wall.y1 }) && same({ x: w.x2, y: w.y2 }, { x: wall.x2, y: wall.y2 })) || (same({ x: w.x1, y: w.y1 }, { x: wall.x2, y: wall.y2 }) && same({ x: w.x2, y: w.y2 }, { x: wall.x1, y: wall.y1 })),
  );
  if (!shared) return room;
  const reversed = same({ x: shared.x1, y: shared.y1 }, { x: wall.x2, y: wall.y2 });

  room.symbols = source.symbols.flatMap((symbol): SketchSymbol[] => {
    if (symbol.wallId !== wallId) return [];
    const placed = { id: newSketchId(symbol.type), wallId: shared.id, t: reversed ? 1 - symbol.t : symbol.t };
    if (symbol.type === "door") return [{ ...symbol, ...placed, doorType: "opening" }];
    if (symbol.type === "window") return [{ ...symbol, ...placed }];
    return [];
  });
  return room;
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
