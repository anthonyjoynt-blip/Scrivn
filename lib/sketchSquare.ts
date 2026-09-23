import { type SketchRoom, type Vertex, isDegenerate, wallsOf } from "@/lib/sketch";

/**
 * Squaring a corner back to its neighbours.
 *
 * A scanned room comes in with most of its corners exactly square — the capture squares what it
 * can — and one or two leaning, because a corner read from three feet away lands a foot along its
 * wall. The kitchen of 2026-09-22 was ten corners at exactly 90 degrees and a jog at 74.4, and the
 * fix its estimator described was "grab that corner and straighten it out".
 *
 * The operation is not a nudge. Moving a corner to wherever makes its two walls perpendicular has
 * infinitely many answers (every point on the circle through its neighbours), and the nearest of
 * them tilts the wall that arrived, which is the wall that was RIGHT. So:
 *
 *   **the longer of the two walls keeps its direction, and the corner slides along it** until the
 *   shorter wall meets it square.
 *
 * On that jog the longer wall was the 8'4" one the room came in on, so the corner slid along it
 * and the 7'2" jog stood up straight — and the corner after it came square for free, because the
 * wall on its far side was parallel to the one that had been kept. One press, the geometry an
 * estimator would have drawn.
 */

/** How far off square a corner may be and still be offered — beyond this it is a shape, not a slip. */
export const SQUARE_TOLERANCE_DEG = 20;

/** A corner squared by less than this is not worth moving, and the move would be noise. */
const ALREADY_SQUARE_DEG = 0.5;

/** The interior turn at vertex [index], in degrees: 90 for a square corner, 180 for a straight run. */
export function cornerAngleDeg(room: SketchRoom, index: number): number {
  const n = room.vertices.length;
  if (n < 3) return Number.NaN;
  const a = room.vertices[(index - 1 + n) % n] as Vertex;
  const b = room.vertices[index] as Vertex;
  const c = room.vertices[(index + 1) % n] as Vertex;
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-6 || lv < 1e-6) return Number.NaN;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** How far the corner at [index] is from square, in degrees. NaN when it has no angle. */
export function offSquareDeg(room: SketchRoom, index: number): number {
  const angle = cornerAngleDeg(room, index);
  return Number.isNaN(angle) ? Number.NaN : Math.abs(angle - 90);
}

/**
 * Where the corner at [index] goes to be square, or null when it should not move.
 *
 * Null when it is square already, when it is further off than [SQUARE_TOLERANCE_DEG] (a chamfer or
 * a genuinely angled wall, which is a shape somebody drew on purpose), or when squaring it would
 * land it on one of its own neighbours.
 */
export function squaredCorner(room: SketchRoom, index: number, toleranceDeg = SQUARE_TOLERANCE_DEG): { x: number; y: number } | null {
  const off = offSquareDeg(room, index);
  if (Number.isNaN(off) || off <= ALREADY_SQUARE_DEG || off > toleranceDeg) return null;

  const n = room.vertices.length;
  const a = room.vertices[(index - 1 + n) % n] as Vertex;
  const b = room.vertices[index] as Vertex;
  const c = room.vertices[(index + 1) % n] as Vertex;

  // The longer wall keeps its direction; the corner slides along it to the foot of the
  // perpendicular dropped from the far end of the shorter one.
  const keepFrom = Math.hypot(b.x - a.x, b.y - a.y) >= Math.hypot(c.x - b.x, c.y - b.y) ? a : c;
  const swing = keepFrom === a ? c : a;
  const ux = b.x - keepFrom.x;
  const uy = b.y - keepFrom.y;
  const len = Math.hypot(ux, uy);
  if (len < 1e-6) return null;
  const t = ((swing.x - keepFrom.x) * ux + (swing.y - keepFrom.y) * uy) / (len * len);
  const x = keepFrom.x + ux * t;
  const y = keepFrom.y + uy * t;

  // Landing on either neighbour is a wall of no length, which is not a room.
  const MIN_PX = 6;
  if (Math.hypot(x - a.x, y - a.y) < MIN_PX || Math.hypot(x - c.x, y - c.y) < MIN_PX) return null;
  return { x, y };
}

/** Which corners of [room] are leaning enough to offer, and near enough to square. */
export function leaningCorners(room: SketchRoom, toleranceDeg = SQUARE_TOLERANCE_DEG): number[] {
  const out: number[] = [];
  for (let i = 0; i < room.vertices.length; i++) {
    if (squaredCorner(room, i, toleranceDeg) !== null) out.push(i);
  }
  return out;
}

/**
 * Squares every leaning corner of [room], one at a time.
 *
 * One at a time and not all at once: squaring a corner moves it along a wall, which changes the
 * angle at the far end of that wall — often INTO square, as it did on the kitchen's jog. Working
 * from a single snapshot would move that neighbour as well, for an angle it no longer had.
 *
 * A move that folds the room over itself is dropped and the rest carry on. Returns the room
 * unchanged, and `moved` empty, when there was nothing to do.
 */
export function squareUpRoom(
  room: SketchRoom,
  toleranceDeg = SQUARE_TOLERANCE_DEG,
): { room: SketchRoom; moved: string[] } {
  let current = room;
  const moved: string[] = [];
  // Bounded by the corner count: each pass squares at most one corner and never revisits it.
  for (let pass = 0; pass < room.vertices.length; pass++) {
    const next = leaningCorners(current, toleranceDeg).find((i) => !moved.includes((current.vertices[i] as Vertex).id));
    if (next === undefined) break;
    const target = squaredCorner(current, next, toleranceDeg);
    const vertex = current.vertices[next] as Vertex;
    if (target === null) break;
    const vertices = current.vertices.map((v, i) => (i === next ? { ...v, x: target.x, y: target.y } : v));
    const candidate = { ...current, vertices };
    if (isDegenerate(vertices) || wallsOf(candidate).some((w) => w.lengthPx < 1)) {
      // Squaring this one would fold the room; leave it and carry on with the others.
      moved.push(vertex.id);
      continue;
    }
    current = candidate;
    moved.push(vertex.id);
  }
  // `moved` collected every corner tried, including any that were left alone above.
  const changed = moved.filter((id) => {
    const before = room.vertices.find((v) => v.id === id);
    const after = current.vertices.find((v) => v.id === id);
    return before !== undefined && after !== undefined && (before.x !== after.x || before.y !== after.y);
  });
  return { room: changed.length > 0 ? current : room, moved: changed };
}
