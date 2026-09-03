import type { Sketch, SketchRoom } from "./sketch";
import type { ScopeMarks } from "./scopeMarks";
import type { MoistureMap } from "./moisture";
import { roomMoisture } from "./moisture";
import { normaliseRoomName } from "./gapCheck";
import type { WaterLossExtraction } from "./types";

/**
 * One thumbnail per surface getting drywall work — the plan, with that surface picked out.
 *
 * Asked for directly: "walls that would be getting drywall repairs and painting etc to have
 * thumbnail sketches we could attach to the scope doc and their respective work orders." A crew
 * handed "Replace drywall at 2' — 30 LF" has no way to tell WHICH wall from the sheet; a plan with
 * the wall picked out answers that in a glance, and it is the one thing the sketch already knows.
 *
 * WHICH WALLS — and the answer is only ever "the ones the PM marked".
 *
 * An extraction wall record says a wall in this room is being cut; it does NOT say which wall on the
 * plan, and the two models have no correspondence. There are exactly two places that correspondence
 * gets made, both by the PM pointing at the plan:
 *
 *   - The moisture map, where walls are marked affected and therefore come out in Emergency.
 *   - A scope marking, made when Add-from-sketch is used to answer how much wall run is being cut.
 *
 * With neither, there is NO wall thumbnail. An earlier version fell back to highlighting the whole
 * room perimeter on the reasoning that "the walls in this room are flood cut" is a statement about
 * the room — but a picture of four highlighted walls is a claim that four walls are being cut, and
 * a scope that shows work on walls nobody touched is worse than one with no picture. Where the
 * quantity is genuinely unclear the fix is to ask the PM to mark it up, which is what the
 * Add-from-sketch button on the cut-run question is for; marking there produces the thumbnail.
 *
 * Drywall replaced without a flood cut is the case that legitimately gets nothing: a bare square
 * footage says how much, never which wall, and no amount of inference will recover it. What matters
 * there is that the figure is attributed to the right SURFACE, which is `ceilingQuantity`'s job.
 *
 * A ceiling has none of this ambiguity — a room has one — so a ceiling thumbnail shades the room it
 * belongs to and needs nothing marked.
 */

export interface SurfaceThumbnail {
  /** Stable across renders of the same claim — see `SketchRender`. */
  id: string;
  /** What the PM ticks, e.g. "Basement Bedroom — walls". */
  label: string;
  roomId: string;
  /** Empty for a ceiling thumbnail, which shades the room rather than picking out walls. */
  wallIds: string[];
  surface: "walls" | "ceiling";
}

/** The render id for one thumbnail. Parsed back by `renderSketchImage`, so the shape is load-bearing. */
export function surfaceRenderId(roomId: string, surface: "walls" | "ceiling"): string {
  return `surface:${surface}:${roomId}`;
}

/** True for a render id produced above — everything else is "clean" or "moisture". */
export function isSurfaceRender(render: string): boolean {
  return render.startsWith("surface:");
}

/**
 * Matches an extraction room to a sketch room by name, tolerating the two not being written
 * identically — same problem and the same rule as `findDerived`: exact first, then a whole-word
 * containment match, and nothing at all when more than one room could be meant. A thumbnail
 * labelled with the wrong room is worse than one that never appears.
 */
function matchSketchRoom(rooms: SketchRoom[], roomName: string | null): SketchRoom | undefined {
  if (!roomName) return undefined;
  const key = normaliseRoomName(roomName);
  const exact = rooms.find((r) => normaliseRoomName(r.name ?? "") === key);
  if (exact) return exact;

  const contains = (haystack: string, needle: string) =>
    new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(haystack);
  const candidates = rooms.filter((r) => {
    const name = normaliseRoomName(r.name ?? "");
    return contains(name, key) || contains(key, name);
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Every surface worth a thumbnail, in room order.
 *
 * Derived, not selected: a surface appears here because the claim says work is happening on it. What
 * the PM chooses is which documents each one rides on — see `SketchAttachments`.
 */
export function surfaceThumbnails(
  extraction: WaterLossExtraction | null,
  sketch: Sketch,
  moisture: MoistureMap,
  scopeMarks: ScopeMarks = {},
): SurfaceThumbnail[] {
  if (!extraction) return [];
  const out: SurfaceThumbnail[] = [];

  for (const room of extraction.rooms) {
    const sketchRoom = matchSketchRoom(sketch.rooms, room.roomName);
    if (!sketchRoom) continue;

    if (room.walls.some((w) => w.drywallBeingRemoved)) {
      /*
        Both marking surfaces count, and they are a union rather than a preference.

        They record different things on purpose — moisture is what is wet, a scope marking is what is
        being done (see `scopeMarks.ts`) — and a PM who cut past the wet line to a stud has pointed
        at both. Taking one and ignoring the other would drop a wall they explicitly marked.
      */
      const fromMoisture = roomMoisture(moisture, sketchRoom.id).wallReadings.map((r) => r.wallId);
      const fromScope = Object.values(scopeMarks)
        .flatMap((mark) => mark.walls)
        .filter((w) => w.roomId === sketchRoom.id)
        .map((w) => w.wallId);
      const wallIds = [...new Set([...fromMoisture, ...fromScope])];
      if (wallIds.length > 0) {
        out.push({
          id: surfaceRenderId(sketchRoom.id, "walls"),
          label: `${sketchRoom.name || "Unnamed room"} — walls`,
          roomId: sketchRoom.id,
          wallIds,
          surface: "walls",
        });
      }
    }

    if (room.ceilings.some((c) => c.type === "DRYWALL_PLASTER" && c.action === "REMOVE_AND_REPLACE")) {
      out.push({
        id: surfaceRenderId(sketchRoom.id, "ceiling"),
        label: `${sketchRoom.name || "Unnamed room"} — ceiling`,
        roomId: sketchRoom.id,
        wallIds: [],
        surface: "ceiling",
      });
    }
  }

  return out;
}

/** The thumbnail a render id names, or undefined once the claim no longer produces it. */
export function thumbnailFor(thumbnails: SurfaceThumbnail[], render: string): SurfaceThumbnail | undefined {
  return thumbnails.find((t) => t.id === render);
}
