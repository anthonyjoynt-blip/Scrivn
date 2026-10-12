import {
  PIXELS_PER_FOOT,
  type Sketch,
  type SketchRoom,
  missingWallMarks,
  openingsSharedWith,
  symbolCentrePx,
  symbolWidthPx,
  wallsOf,
} from "./sketch";
import { type MoistureMap, hasRoomMoisture, roomMoisture } from "./moisture";
import { type EquipmentSettings, affectedFloorSquareFeet, affectedUpperSquareFeet } from "./equipment";
import { grossFloorArea } from "./sketchQuantities";
import { type DryingPlan, type DryingRoom, type WallStretch, dryingPlan } from "./dryingPlan";

/**
 * A sketched room, with its moisture map, as a `DryingRoom` — the bridge from a claim's sketch (drawn
 * by hand, or scanned and sent by Scrivn Scan) to the drying plan's counts and layout.
 *
 * The wet areas are read by lib/equipment.ts's own `affectedFloorSquareFeet` and
 * `affectedUpperSquareFeet`, not summed again here, so `sketchDryingPlan` gives the sketch equipment
 * panel's numbers exactly (test/drying checks it). What this adds is WHERE: the stretches of wall the
 * readings cover, the doorways, and the outline in feet, for the layout.
 *
 * Spots come back in feet on the sketch's axes: times PIXELS_PER_FOOT is world pixels.
 */
export function dryingRoomFromSketch(room: SketchRoom, map: MoistureMap, rooms: SketchRoom[] = []): DryingRoom {
  const walls = wallsOf(room);
  const byId = new Map(walls.map((w) => [w.id, w]));
  const data = roomMoisture(map, room.id);

  const openings: WallStretch[] = [];
  for (const symbol of room.symbols) {
    if (symbol.type !== "door") continue;
    const wall = byId.get(symbol.wallId);
    if (!wall) continue;
    const centre = symbolCentrePx(symbol, room, rooms);
    const half = symbolWidthPx(symbol, room, rooms) / 2;
    openings.push({ wall: wall.index, fromFeet: (centre - half) / PIXELS_PER_FOOT, toFeet: (centre + half) / PIXELS_PER_FOOT });
  }
  // A door is one symbol, kept by one of the two rooms it joins; the other room sees it here.
  for (const shared of openingsSharedWith(room, rooms)) {
    const wall = byId.get(shared.wallId);
    if (!wall || shared.symbol.type !== "door") continue;
    openings.push({ wall: wall.index, fromFeet: shared.fromPx / PIXELS_PER_FOOT, toFeet: shared.toPx / PIXELS_PER_FOOT });
  }
  // A missing wall is no wall: nothing to stand a mover against, and the room is open beyond it.
  for (const id of missingWallMarks(room)) {
    const wall = byId.get(id);
    if (wall) openings.push({ wall: wall.index, fromFeet: 0, toFeet: wall.lengthFeet });
  }

  // The same choice `affectedUpperSquareFeet` makes: with readings, the read stretches are the wet
  // walls; with none, every wall is assumed wet, so every wall is where the movers go.
  const wetWalls: WallStretch[] =
    data.wallReadings.length > 0
      ? data.wallReadings.flatMap((r) => {
          const wall = byId.get(r.wallId);
          return wall ? [{ wall: wall.index, fromFeet: r.startT * wall.lengthFeet, toFeet: r.endT * wall.lengthFeet }] : [];
        })
      : walls.map((w) => ({ wall: w.index, fromFeet: 0, toFeet: w.lengthFeet }));

  return {
    id: room.id,
    name: room.name.trim() || "Unnamed room",
    outline: room.vertices.map((v) => ({ x: v.x / PIXELS_PER_FOOT, y: v.y / PIXELS_PER_FOOT })),
    openings,
    wetWalls,
    floorSquareFeet: grossFloorArea(room),
    ceilingHeightFeet: room.ceilingHeightFeet ?? 8,
    wet: {
      affectedFloorSquareFeet: affectedFloorSquareFeet(room, map, null),
      affectedUpperSquareFeet: affectedUpperSquareFeet(room, map),
      insetsAndOffsetsOver18Inches: data.insetsOver18Inches,
    },
  };
}

/** The plan for every room with anything marked on its moisture map — the rooms `claimEquipment` counts. */
export function sketchDryingPlan(sketch: Sketch, map: MoistureMap, settings: EquipmentSettings): DryingPlan {
  const rooms = sketch.rooms.filter((room) => hasRoomMoisture(map, room.id)).map((room) => dryingRoomFromSketch(room, map, sketch.rooms));
  return dryingPlan(rooms, settings);
}
