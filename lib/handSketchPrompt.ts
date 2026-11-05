/**
 * What the model is asked when it reads a photo of a hand-drawn sketch, and the shape it answers in
 * (2026-11-05). The answer is a `HandSketchRead` (lib/handSketch.ts) once `readFromWire` has turned
 * its stand-ins back into nulls.
 *
 * Like the extraction schema (lib/schema.ts), the wire shape has no union types: Structured
 * Outputs caps union-typed fields per request. "Not written" is "" for text, -1 for a wall index,
 * and UNKNOWN for a guess, and `readFromWire` is the one place that knows it.
 */
import type { DrawnItemKind, DrawnOpeningKind, DrawnRoomGuess, HandSketchRead } from "./handSketch";

const OPENING_KINDS: DrawnOpeningKind[] = ["door", "window", "opening", "bifold", "sliding", "pocket"];
const ITEM_KINDS: DrawnItemKind[] = ["vanity", "toilet", "tub", "shower", "sink", "cabinet", "fridge", "range", "furnace", "waterHeater"];
const GUESSES: DrawnRoomGuess[] = ["bedroom", "bathroom", "closet", "kitchen", "living", "hall", "laundry", "utility", "office", "room"];
const UNKNOWN = "UNKNOWN";

export const HAND_SKETCH_SYSTEM = `You read photos of floor sketches drawn by restoration estimators, usually by hand on paper, and report exactly what is drawn and written, so a program can rebuild the rooms at their real size. You never estimate a size: the program does that from the numbers written on the paper. Your job is to say which lines make which walls, and which written number belongs to which wall.

COORDINATES. Give every point in pixels of the image exactly as you are given it (x right, y down, origin top left), even when the drawing is sideways. Separately, "rotate" is how many degrees clockwise the image must turn for the writing to read upright (0, 90, 180 or 270).

ROOMS. Each enclosed space is a room: its corners in order around it, following the drawn lines, one corner wherever a wall changes direction. Corners where a line just wobbles are not corners. walls[i] is the wall from corners[i] to corners[i+1]; the last wall closes back to corners[0], so walls has exactly as many entries as corners. A small space drawn against a room — a closet behind an angled wall, a pantry — is a room of its own; give the corners it shares with its neighbour the SAME coordinates in both rooms. A drawn line that overshoots a corner is not a wall.

WALL LENGTHS. For each wall, the number written against it, copied exactly as written (14'3, 4'11", 8'3, 144 1/2"), or "" when none is. A number belongs to the wall it is written beside and parallel to; when it sits between two walls, give it to the nearer one. A number written inside a room away from its walls, or marked C or ceiling, is the ceiling height, not a wall. Anything crossed out or scribbled over is not used: list it under "ignored". Never invent or compute a number that is not written.

OPENINGS, on the wall they are drawn on:
- a door: a gap with a swing arc, or a short line drawn diagonally into the room from a point on a wall. When that point is at a corner, the door is on the wall the point sits on; if it could equally be the other wall at that corner, give that one as orWall (otherwise -1).
- a window: a window drawn in the wall, ticks marking a span of wall with "window" or "w" written by it, or a written size like 5'9 x 2'9.
- "opening" for a cased opening with no door; bifold, sliding or pocket when drawn or written so.
"at" is the centre of the opening as a fraction 0 to 1 along the wall from corners[wall]. "size" is the size written for it, exactly as written, or "". "sure" is false when it may not be an opening at all — a wall drawn over heavily or scribbled, a mark you cannot be sure of — and say what you saw in "note".

ITEMS. Fixtures drawn against a wall: vanity (also a bathroom sink cabinet), toilet, tub, shower, sink, cabinet, fridge, range, furnace, waterHeater. "from" and "to" are where it starts and ends, as fractions 0 to 1 along the wall from corners[wall]; "depth" is how far it is drawn out from that wall, in pixels. "label" is the word written on it, or "". "size" only if a size is written for it, else "".

NAMES. "name" is the room's name only if written in it, else "". "guess" is what the drawing suggests the room is (a tub and a toilet: bathroom; a closet off a room with a window and a door: bedroom), or ${UNKNOWN}.

"kind" is "hand" for a hand drawing and "blueprint" for a printed plan. Under "ignored", list writing you read but did not use, briefly.`;

export function handSketchUserMessage(width: number, height: number): string {
  return `The photo is ${width} x ${height} pixels. Read the sketch in it.`;
}

const point = { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "number" }, y: { type: "number" } } };

export const HAND_SKETCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "rotate", "rooms", "ignored"],
  properties: {
    kind: { type: "string", enum: ["hand", "blueprint"] },
    rotate: { type: "integer", enum: [0, 90, 180, 270] },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "guess", "corners", "walls", "ceiling", "openings", "items"],
        properties: {
          name: { type: "string" },
          guess: { type: "string", enum: [...GUESSES, UNKNOWN] },
          corners: { type: "array", items: point },
          walls: { type: "array", items: { type: "object", additionalProperties: false, required: ["length"], properties: { length: { type: "string" } } } },
          ceiling: { type: "string" },
          openings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "wall", "at", "size", "orWall", "sure", "note"],
              properties: {
                kind: { type: "string", enum: OPENING_KINDS },
                wall: { type: "integer" },
                at: { type: "number" },
                size: { type: "string" },
                orWall: { type: "integer" },
                sure: { type: "boolean" },
                note: { type: "string" },
              },
            },
          },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "label", "wall", "from", "to", "depth", "size"],
              properties: {
                kind: { type: "string", enum: ITEM_KINDS },
                label: { type: "string" },
                wall: { type: "integer" },
                from: { type: "number" },
                to: { type: "number" },
                depth: { type: "number" },
                size: { type: "string" },
              },
            },
          },
        },
      },
    },
    ignored: { type: "array", items: { type: "string" } },
  },
};

interface WireRoom {
  name: string;
  guess: DrawnRoomGuess | typeof UNKNOWN;
  corners: { x: number; y: number }[];
  walls: { length: string }[];
  ceiling: string;
  openings: { kind: DrawnOpeningKind; wall: number; at: number; size: string; orWall: number; sure: boolean; note: string }[];
  items: { kind: DrawnItemKind; label: string; wall: number; from: number; to: number; depth: number; size: string }[];
}

export interface HandSketchWire {
  kind: "hand" | "blueprint";
  rotate: 0 | 90 | 180 | 270;
  rooms: WireRoom[];
  ignored: string[];
}

const text = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** The model's answer as a read: stand-ins back to nulls, out-of-range walls dropped. */
export function readFromWire(wire: HandSketchWire): HandSketchRead {
  return {
    version: 1,
    kind: wire.kind,
    rotate: wire.rotate,
    ignored: wire.ignored,
    rooms: wire.rooms.map((r) => {
      const n = r.corners.length;
      const onWall = (w: number) => Number.isInteger(w) && w >= 0 && w < n;
      return {
        name: text(r.name),
        guess: r.guess === UNKNOWN ? null : r.guess,
        corners: r.corners,
        // A walls list that disagrees with the corners in length is padded or cut to match: a
        // missing number is only a missing number.
        walls: Array.from({ length: n }, (_, i) => ({ length: text(r.walls[i]?.length ?? "") })),
        ceiling: text(r.ceiling),
        openings: r.openings
          .filter((o) => onWall(o.wall))
          .map((o) => ({ kind: o.kind, wall: o.wall, at: o.at, size: text(o.size), orWall: onWall(o.orWall) && o.orWall !== o.wall ? o.orWall : null, sure: o.sure, ...(text(o.note) ? { note: o.note } : {}) })),
        items: r.items.filter((it) => onWall(it.wall)).map((it) => ({ kind: it.kind, label: text(it.label), wall: it.wall, from: it.from, to: it.to, depth: it.depth, size: text(it.size) })),
      };
    }),
  };
}
