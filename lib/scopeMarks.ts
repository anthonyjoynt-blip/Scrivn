import { type Sketch, type SketchRoom, openingSquareFeetOnWall, wallById } from "./sketch";
import { type MoistureMap, emptyMoistureMap, paintedFloorSquareFeet, roomMoisture, setRoomMoisture } from "./moisture";

/**
 * Marking out WHERE a scope item applies, on the sketch, to answer a quantity question.
 *
 * Distinct from the moisture map, and deliberately so. Moisture records what is wet; this records
 * what is being done — the wall run being cut, the floor being lifted. They frequently differ: a PM
 * cuts past the wet line to a stud, or replaces a whole floor because half of it is ruined. Storing
 * them together would make each one lie about the other.
 *
 * Keyed by the gap-check question the marking answers, so reopening the picker shows what was marked
 * last time rather than a blank plan, and so two questions about the same room keep their own extents.
 *
 * ── On the shared shape with moisture ───────────────────────────────────────────────────────────
 * A marked wall run and a moisture reading's run are geometrically the same thing: a wall id and two
 * fractions along it. The canvas already knows how to draw and drag that, so the picker borrows it
 * through the adapters at the bottom of this file rather than growing a second interaction. The
 * MODELS stay separate; only the drawing is shared.
 */

export interface ScopeWallMark {
  roomId: string;
  /** The wall's start-vertex id, the same identity walls carry everywhere else. */
  wallId: string;
  startT: number;
  endT: number;
}

export interface ScopeMark {
  walls: ScopeWallMark[];
  /** Painted floor cells, keyed by room id — the same grid the moisture map paints on. */
  floorCells: Record<string, string[]>;
}

/** Keyed by gap-check question id. */
export type ScopeMarks = Record<string, ScopeMark>;

export function emptyScopeMark(): ScopeMark {
  return { walls: [], floorCells: {} };
}

export function scopeMarkFor(marks: ScopeMarks, questionId: string): ScopeMark {
  return marks[questionId] ?? emptyScopeMark();
}

export function hasScopeMark(mark: ScopeMark): boolean {
  return mark.walls.length > 0 || Object.values(mark.floorCells).some((cells) => cells.length > 0);
}

export function setScopeMark(marks: ScopeMarks, questionId: string, mark: ScopeMark): ScopeMarks {
  if (!hasScopeMark(mark)) {
    if (!(questionId in marks)) return marks;
    const next = { ...marks };
    delete next[questionId];
    return next;
  }
  return { ...marks, [questionId]: mark };
}

/* ── What a marking measures ───────────────────────────────────────────────────────────────────── */

/** The marked run along each wall, summed. This is what a cut length is measured in. */
export function scopeWallRunFeet(mark: ScopeMark, sketch: Sketch): number {
  return mark.walls.reduce((sum, m) => {
    const room = sketch.rooms.find((r) => r.id === m.roomId);
    const wall = room ? wallById(room, m.wallId) : null;
    if (!wall?.lengthFeet) return sum;
    return sum + wall.lengthFeet * Math.max(0, Math.min(1, m.endT) - Math.max(0, m.startT));
  }, 0);
}

/** The painted floor area, summed across rooms. */
export function scopeFloorSquareFeet(mark: ScopeMark, sketch: Sketch): number {
  return Object.entries(mark.floorCells).reduce((sum, [roomId, cells]) => {
    const room = sketch.rooms.find((r) => r.id === roomId);
    return room ? sum + paintedFloorSquareFeet(cells) : sum;
  }, 0);
}

/**
 * The FULL area of every marked wall, floor to ceiling — what painting actually covers.
 *
 * A drywall cut is a band; the paint that follows it is not. Once a wall has been opened and patched
 * it gets finished corner to corner, or the repair shows as a stripe. So painting is derived from the
 * marked walls' whole length times the room's ceiling height, not from the height of the cut.
 *
 * The exception is a base-height cut — a few inches at the bottom, behind where the baseboard goes
 * back — which is why `paintableWallSquareFeet` takes the cut height and returns null for it.
 */
export function fullWallSquareFeet(mark: ScopeMark, sketch: Sketch): number {
  return mark.walls.reduce((sum, m) => {
    const room = sketch.rooms.find((r) => r.id === m.roomId);
    const wall = room ? wallById(room, m.wallId) : null;
    if (!room || !wall?.lengthFeet) return sum;
    /*
      A doorway in the marked wall is not painted, for the same reason it is not drywalled.

      Always deducted here, even though the quantities table offers it as a toggle. The two answer
      different questions: W is a general readout an estimator may legitimately want gross, to set
      against a figure from somewhere else, while this becomes a scope line saying how many square
      feet get painted — and nobody paints a doorway. The toggle is deliberately not threaded
      through: it is editor state about a readout, and a scope line should not change because
      somebody was comparing numbers.
    */
    const gross = wall.lengthFeet * (room.ceilingHeightFeet ?? 8);
    return sum + Math.max(0, gross - openingSquareFeetOnWall(room, wall.id));
  }, 0);
}

/**
 * Paintable area for a marked wall run, or null when the cut does not call for repainting the wall.
 *
 * Null for a base-height cut, and null when nothing was marked — in both cases the caller falls back
 * to the existing per-linear-foot estimate rather than inventing a number from geometry it does not
 * have.
 */
export function paintableWallSquareFeet(
  mark: ScopeMark,
  sketch: Sketch,
  cutHeight: string | null,
): number | null {
  if (cutHeight === "BASE") return null;
  if (mark.walls.length === 0) return null;
  const area = fullWallSquareFeet(mark, sketch);
  return area > 0 ? area : null;
}

/** Every room a marking touches, for naming what was marked without re-deriving it. */
export function markedRooms(mark: ScopeMark, sketch: Sketch): SketchRoom[] {
  const ids = new Set([...mark.walls.map((w) => w.roomId), ...Object.keys(mark.floorCells)]);
  return sketch.rooms.filter((room) => ids.has(room.id));
}

/* ── Borrowing the canvas's marking layer ──────────────────────────────────────────────────────── */

/**
 * A marking, shaped as the layer the canvas already knows how to draw and drag.
 *
 * The reading fields are placeholders: this is not a moisture reading and nothing reads them back.
 * A scope mark has no severity, so the canvas is told to draw this layer in the scope style — see
 * `markStyle` — rather than colouring it on a wet-to-dry ramp that would mean nothing here.
 */
export function toCanvasLayer(mark: ScopeMark): MoistureMap {
  let map = emptyMoistureMap();

  for (const wall of mark.walls) {
    const existing = roomMoisture(map, wall.roomId);
    map = setRoomMoisture(map, wall.roomId, {
      ...existing,
      wallReadings: [
        ...existing.wallReadings,
        {
          id: `${wall.roomId}:${wall.wallId}`,
          wallId: wall.wallId,
          startT: wall.startT,
          endT: wall.endT,
          affectedHeightFeet: 0,
          material: "drywall",
          reading: null,
          dryStandard: null,
        },
      ],
    });
  }

  for (const [roomId, cells] of Object.entries(mark.floorCells)) {
    if (cells.length === 0) continue;
    map = setRoomMoisture(map, roomId, { ...roomMoisture(map, roomId), floorCells: cells });
  }

  return map;
}

/** The inverse: what the PM drew on the canvas, back as a marking. */
export function fromCanvasLayer(map: MoistureMap): ScopeMark {
  const walls: ScopeWallMark[] = [];
  const floorCells: Record<string, string[]> = {};

  for (const [roomId, data] of Object.entries(map.rooms)) {
    for (const reading of data.wallReadings) {
      walls.push({ roomId, wallId: reading.wallId, startT: reading.startT, endT: reading.endT });
    }
    if (data.floorCells.length > 0) floorCells[roomId] = data.floorCells;
  }

  return { walls, floorCells };
}
