/**
 * Turning a room on the plan, and everything that is part of it.
 *
 * Asked for from the field on 2026-09-30: "give me a rotate button in scrivn on the sketch pad.
 * similar to door flip so when i select a room or block i can rotate it. in 15 degree increments or
 * something". Scanned rooms and islands sometimes land a few degrees crooked, and until now only a
 * door or a flight of stairs could be turned in the editor.
 *
 * A room turns about the middle of its floor (`roomCentroid`) and takes with it what a drag takes
 * with it (`carriedWithRoom`): the rooms inside it — a closet, an ensuite — and the free walls
 * standing against it, all about the same centre, so the group comes round as one piece. The
 * geometry of one room is `turnRoomAbout` in lib/sketch.ts; this file is the choosing of what moves
 * and by how much.
 *
 * A FLIGHT is the exception to everything turning by the same amount. `stairFlight` reads a flight's
 * run and width off its bounding box, so a flight only ever stands square to the page and turns by
 * quarters. A room with a flight in it therefore turns by quarters too (`roomTurnStepDeg`), and the
 * flight comes round with it exactly. See `turnFlightAbout` for the one case where a room with a
 * flight turns by less: a room that was off square to begin with, coming square around its flight.
 *
 * A BLOCK turns about its own middle (`turnBlock` in lib/sketch.ts); what is here is the run of
 * presses the editor keeps so the other button takes a press back exactly (`turnBlockInRun`).
 *
 * Pure geometry, like lib/sketchWalls.ts: the editor decides when, and this says what.
 */

import {
  type FreeCabinet,
  QUARTER_TURN_DEG,
  type Sketch,
  type SketchRoom,
  TURN_STEP_DEG,
  blockAngleDeg,
  blockInsideRoom,
  freeWallsOf,
  MIN_VERTICES,
  roomBounds,
  roomCentroid,
  roomFrameDeg,
  settledAfterTurn,
  turnBlock,
  turnFlightAbout,
  turnRoomAbout,
  turnStepDeg,
  turnedPoint,
  withDerivedParents,
} from "./sketch";
import { freeWallsAttachedToRoom } from "./sketchWalls";
import type { RoomTurnMotion } from "./moisture";

/**
 * Everything that moves when a room does: the room, every room nested under it however deep, and
 * the free walls standing against any of them with whatever is joined to those.
 *
 * The same set a drag carries (the editor's `handleMoveRoom`) — a bedroom turned without its closet,
 * or out from under the partition drawn off its wall, is a drawing in two pieces that then has to be
 * put back together by hand. One function so that moving and turning cannot come to disagree about
 * what a room is made of.
 */
export function carriedWithRoom(sketch: Sketch, roomId: string): { roomIds: Set<string>; freeWallIds: Set<string> } {
  const roomIds = new Set<string>([roomId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of sketch.rooms) {
      if (!roomIds.has(r.id) && r.parentRoomId && roomIds.has(r.parentRoomId)) {
        roomIds.add(r.id);
        grew = true;
      }
    }
  }
  const walls = freeWallsOf(sketch);
  const freeWallIds = new Set<string>();
  for (const id of roomIds) {
    const host = sketch.rooms.find((r) => r.id === id);
    if (host) for (const wallId of freeWallsAttachedToRoom(host, walls)) freeWallIds.add(wallId);
  }
  return { roomIds, freeWallIds };
}

/**
 * The step a press of the turn buttons takes for this room: a quarter when it is a flight or carries
 * one, since a flight can only stand square to the page; `TURN_STEP_DEG` otherwise.
 */
export function roomTurnStepDeg(sketch: Sketch, roomId: string): number {
  const { roomIds } = carriedWithRoom(sketch, roomId);
  const carriesFlight = sketch.rooms.some((r) => roomIds.has(r.id) && r.stairs !== null);
  return carriesFlight ? QUARTER_TURN_DEG : TURN_STEP_DEG;
}

/**
 * The turn one press of ↻ (+1) or ↺ (-1) makes to a room, in degrees clockwise: to the next step from
 * the way the room is turned now (`roomFrameDeg`, `turnStepDeg`), by quarters for a flight or a room
 * with one in it. Null when there is no such room.
 *
 * The editor's buttons and keys call this and nothing else, so what the tests press is what the PM does.
 */
export function roomTurnForPress(sketch: Sketch, roomId: string, direction: 1 | -1): number | null {
  const room = sketch.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  return turnStepDeg(room.stairs ? 0 : roomFrameDeg(room), direction, roomTurnStepDeg(sketch, roomId));
}

/**
 * One run of presses of a block's turn buttons: every place the block has stood in it, first to
 * last, and the room it was all in. The editor keeps it between presses — see `turnBlockInRun`.
 */
export interface BlockTurnRun {
  blockId: string;
  /** The room's corners as they were for the whole run, written out: a room reshaped since is a new run. */
  roomKey: string;
  steps: FreeCabinet[];
}

/**
 * `turnBlock` for a press of the buttons: a block turned back to an angle it already stood at in the
 * same run of presses goes back to exactly where it stood then.
 *
 * `turnBlock` keeps a block against a wall it stood against, so a peninsula turned and turned back is
 * flush again without this. What the drawing cannot say is where a block stood before a wall got in
 * its way: an island a foot off the counter, turned 30, is pushed off the counter and then stands
 * against it, and turned back it would stay there — a foot from where it was. The editor has no undo
 * and the other button is how a PM takes a press back, so the run remembers where it was.
 *
 * Only for the presses in between. A block that has been dragged, resized or relabelled since, or a
 * room whose walls have moved, starts a new run; and the angle a press goes to is `turnStepDeg`'s
 * whatever the run holds, so a button that says 15 still turns 15.
 */
export function turnBlockInRun(
  run: BlockTurnRun | null,
  block: FreeCabinet,
  room: SketchRoom,
  deg: number,
): { block: FreeCabinet; run: BlockTurnRun } | null {
  const roomKey = JSON.stringify(room.vertices);
  const blockKey = JSON.stringify(block);
  const at = run && run.blockId === block.id && run.roomKey === roomKey ? run.steps.findIndex((s) => JSON.stringify(s) === blockKey) : -1;
  // Where it has stood on the way to here; anything after here was a turn taken back.
  const steps = run && at >= 0 ? run.steps.slice(0, at + 1) : [block];

  const target = blockAngleDeg(block) + deg;
  const sameAngle = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d) < 1e-6;
  };
  const been = steps.find((s) => sameAngle(blockAngleDeg(s), target) && blockInsideRoom(s, room));
  if (been) return { block: been, run: { blockId: block.id, roomKey, steps } };

  const turned = turnBlock(block, room, deg);
  if (!turned) return null;
  return { block: turned, run: { blockId: block.id, roomKey, steps: [...steps, turned] } };
}

/** What a turn did: the sketch after it, and each room it moved, as it was and as it is. */
export interface RoomTurn {
  sketch: Sketch;
  /** The point the room turned about. */
  centre: { x: number; y: number };
  /**
   * Every room the turn moved, with how it moved — what the moisture paint is carried by
   * (`turnedRoomMoisture`). A room turns about `centre`; a flight turns about its own middle and is
   * carried to where the turn takes that middle, so the two need their own.
   */
  moved: { before: SketchRoom; after: SketchRoom; motion: RoomTurnMotion }[];
}

/**
 * The sketch with one room turned `deg` clockwise on screen, and everything it carries with it.
 *
 * Parents are re-derived afterwards, as after a drag: a turned room can come to stand inside another
 * or out of one. Null when there is no such room, or nothing to turn.
 */
export function turnRoomInSketch(sketch: Sketch, roomId: string, deg: number): RoomTurn | null {
  const room = sketch.rooms.find((r) => r.id === roomId);
  if (!room || room.vertices.length < MIN_VERTICES || deg === 0) return null;

  // A flight turns about the middle of its box, as `rotateStairs` always has; a room about its floor's.
  const box = roomBounds(room);
  const centre = room.stairs ? { x: box.minX + box.width / 2, y: box.minY + box.height / 2 } : roomCentroid(room);
  /*
    How many quarter turns a flight carried by this turn takes: the number of times the room's own
    frame passes a diagonal. Six presses of 15 take a room from 0 to 90 and its flight a quarter,
    at the 45; pressed back, it comes back at the same place.
  */
  const frame = room.stairs ? 0 : roomFrameDeg(room);
  const quarters = Math.round((frame + deg) / QUARTER_TURN_DEG) - Math.round(frame / QUARTER_TURN_DEG);

  const { roomIds, freeWallIds } = carriedWithRoom(sketch, roomId);
  const moved: RoomTurn["moved"] = [];
  const rooms = sketch.rooms.map((r) => {
    if (!roomIds.has(r.id)) return r;
    if (r.stairs) {
      const b = roomBounds(r);
      const middle = { x: b.minX + b.width / 2, y: b.minY + b.height / 2 };
      const after = turnFlightAbout(r, deg, centre, quarters);
      moved.push({ before: r, after, motion: { deg: quarters * QUARTER_TURN_DEG, from: middle, to: turnedPoint(middle, centre, deg) } });
      return after;
    }
    const after = turnRoomAbout(r, deg, centre);
    moved.push({ before: r, after, motion: { deg, from: centre, to: centre } });
    return after;
  });

  const walls = freeWallsOf(sketch);
  const freeWalls = walls.map((w) =>
    freeWallIds.has(w.id) ? { ...w, vertices: settledAfterTurn(w.vertices.map((v) => ({ ...v, ...turnedPoint(v, centre, deg) })), false) } : w,
  );

  return {
    sketch: { ...sketch, rooms: withDerivedParents(rooms), ...(sketch.freeWalls !== undefined ? { freeWalls } : {}) },
    centre,
    moved,
  };
}
