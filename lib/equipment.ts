import type { Sketch, SketchRoom } from "./sketch";
import { wallsOf } from "./sketch";
import { type MoistureMap, hasRoomMoisture, roomMoisture, roomMoistureSummary } from "./moisture";
import { grossFloorArea } from "./sketchQuantities";
import type { AreaFraction } from "./types";
import { airChangeCfm, capacityFromFactor, unitsForCapacity } from "./equipmentSizing";

/**
 * IICRC-based equipment sizing, from the moisture map.
 *
 * Deterministic and entirely local — no API call — for the same reason the gap-check engine is:
 * these are arithmetic, and a number a PM is going to defend to an adjuster should come out the same
 * way every time it is computed. Everything here is a pure function of a room, its moisture data and
 * the PM's chosen unit size.
 *
 * Every count rounds UP. Half an air mover does not exist, and rounding a drying calculation down is
 * the one direction that fails the building.
 *
 * ── The numbers are the standard's, the judgement is not ─────────────────────────────────────────
 * These recommendations are a starting point that the PM confirms or overrides — see
 * `equipmentSuggestion` and the confirm-or-suggest question it feeds. Nothing here overwrites a
 * stated quantity on its own.
 */

/* ── Dehumidifiers ─────────────────────────────────────────────────────────────────────────────── */

export type WaterClass = 1 | 2 | 3 | 4;
export type DehumidifierType = "lgr" | "desiccant";
export type UnitSize = "small" | "medium" | "large";

/**
 * Class factors. LGR divides cubic footage; desiccant is air changes per hour.
 *
 * Conventional refrigerant is deliberately absent: the PM-facing picker offers LGR and desiccant
 * only, so a factor for a machine nobody can select would be dead weight that later reads as an
 * oversight.
 */
export const LGR_FACTOR: Record<WaterClass, number> = { 1: 100, 2: 50, 3: 40, 4: 40 };
export const DESICCANT_ACH: Record<WaterClass, number> = { 1: 1, 2: 2, 3: 3, 4: 3 };

export interface SizeBand {
  label: string;
  /** PPD for LGR, CFM for desiccant. */
  low: number;
  high: number;
}

/**
 * What the PM picks from, and the rating each pick is calculated at.
 *
 * The LOWER bound of the chosen band is used as the representative rating. A band is a range of real
 * machines, and assuming the weakest one in the range can only ever recommend more units than the
 * PM's actual kit needs — the safe direction. Assuming the strongest would quietly undersize the
 * job whenever the unit on the truck sat at the bottom of its class.
 */
export const DEHUMIDIFIER_SIZES: Record<DehumidifierType, Record<UnitSize, SizeBand>> = {
  lgr: {
    small: { label: "Small — up to 69 PPD", low: 69, high: 69 },
    medium: { label: "Medium — 70–109 PPD", low: 70, high: 109 },
    large: { label: "Large — 110–159 PPD", low: 110, high: 159 },
  },
  desiccant: {
    small: { label: "Small — 3,000–4,000 CFM", low: 3000, high: 4000 },
    medium: { label: "Medium — 4,500–7,000 CFM", low: 4500, high: 7000 },
    large: { label: "Large — 8,500–15,000 CFM", low: 8500, high: 15000 },
  },
};

export const DEHUMIDIFIER_TYPE_LABEL: Record<DehumidifierType, string> = {
  lgr: "LGR",
  desiccant: "Desiccant",
};

export interface DehumidifierResult {
  /** PPD for LGR, CFM for desiccant — the total the space needs. */
  required: number;
  /** The units the total is expressed in, for labelling. */
  unit: "PPD" | "CFM";
  /** The rating one selected unit is credited with: the low end of its band. */
  ratingPerUnit: number;
  units: number;
  cubicFeet: number;
}

/**
 * LGR: cubic footage / class factor = PPD needed. Desiccant: cubic footage x ACH / 60 = CFM needed.
 */
export function dehumidifiers(
  cubicFeet: number,
  waterClass: WaterClass,
  type: DehumidifierType,
  size: UnitSize,
): DehumidifierResult {
  const band = DEHUMIDIFIER_SIZES[type][size];
  const ratingPerUnit = band.low;

  // The two lines below are the whole of the shared sizing maths — see `lib/equipmentSizing.ts`,
  // which negative air machines size themselves with too.
  const required =
    type === "lgr" ? capacityFromFactor(cubicFeet, LGR_FACTOR[waterClass]) : airChangeCfm(cubicFeet, DESICCANT_ACH[waterClass]);

  return {
    required,
    unit: type === "lgr" ? "PPD" : "CFM",
    ratingPerUnit,
    units: unitsForCapacity(required, ratingPerUnit),
    cubicFeet,
  };
}

/* ── Air movers ────────────────────────────────────────────────────────────────────────────────── */

export interface AirMoverInput {
  affectedFloorSquareFeet: number;
  /** Affected wall area above the base, plus affected ceiling. */
  affectedUpperSquareFeet: number;
  insetsAndOffsetsOver18Inches: number;
}

export interface AirMoverResult extends AirMoverInput {
  units: number;
  /** The four terms, so the number can be explained rather than just asserted. */
  breakdown: { base: number; floor: number; upper: number; insets: number };
}

/**
 * 1 + ceil(floor sq ft / 50) + ceil(upper wall and ceiling sq ft / 100) + insets over 18".
 *
 * The base 1 is per affected room, not per claim: every room being dried gets at least one mover.
 */
export function airMovers(input: AirMoverInput): AirMoverResult {
  const base = 1;
  const floor = Math.ceil(Math.max(0, input.affectedFloorSquareFeet) / 50);
  const upper = Math.ceil(Math.max(0, input.affectedUpperSquareFeet) / 100);
  const insets = Math.max(0, Math.floor(input.insetsAndOffsetsOver18Inches));

  return {
    ...input,
    units: base + floor + upper + insets,
    breakdown: { base, floor, upper, insets },
  };
}

/* ── Reading a room's areas off the moisture map ───────────────────────────────────────────────── */

const FRACTION_VALUE: Record<AreaFraction, number> = {
  QUARTER: 0.25,
  HALF: 0.5,
  THREE_QUARTERS: 0.75,
  FULL: 1,
};

/** Has the PM marked anything at all in this room? Content, never the presence of a key. */
function isMapped(room: SketchRoom, map: MoistureMap): boolean {
  const data = roomMoisture(map, room.id);
  return data.wallReadings.length > 0 || data.floorCells.length > 0 || data.ceilingCells.length > 0;
}

/**
 * The affected floor area for one room.
 *
 * The painted highlight wins when there is one: the PM's own mark of where the water went, measured
 * rather than estimated.
 *
 * With no highlight, what matters is whether this room was mapped AT ALL. In a mapped room an unpainted
 * floor is a statement — the PM marked the walls and left the floor alone, because the floor is not
 * wet — so it contributes nothing. Treating it as the whole footprint was wrong and expensive: a large
 * room with damage in one corner and no floor marked was billing its entire area to the air mover
 * count, which is most of how a three-mover room was reporting twenty-two.
 *
 * Only for an UNMAPPED room does the old behaviour apply: a stated AreaFraction against the real
 * footprint, or the whole footprint, since there no absence of a mark carries any meaning.
 */
export function affectedFloorSquareFeet(room: SketchRoom, map: MoistureMap, fraction: AreaFraction | null): number {
  const summary = roomMoistureSummary(room, map);
  if (summary.affectedFloorSquareFeet > 0) return summary.affectedFloorSquareFeet;
  if (isMapped(room, map)) return 0;

  const footprint = grossFloorArea(room) ?? 0;
  return fraction ? footprint * FRACTION_VALUE[fraction] : footprint;
}

/**
 * Affected wall area above the base, plus affected ceiling.
 *
 * Once ANY wall in the room carries a reading, only the walls with readings count, each contributing
 * its measured run times its measured height. Marking two walls of a room says the other walls are
 * dry — that is the entire point of marking them individually — so adding an assumed area for every
 * unmarked wall inflated a partly-affected room to nearly a fully-affected one.
 *
 * The assumption of length x (ceiling height - 2) survives for a room with NO readings at all, where
 * nothing has been said about any wall. That is the pre-moisture-map behaviour, unchanged, and it is
 * what the fallback was always for.
 */
export function affectedUpperSquareFeet(room: SketchRoom, map: MoistureMap): number {
  const summary = roomMoistureSummary(room, map);
  const ceiling = summary.affectedCeilingSquareFeet;

  if (summary.readings.length > 0) {
    return summary.readings.reduce((sum, r) => sum + (r.affectedWallSquareFeet ?? 0), 0) + ceiling;
  }

  const assumedHeight = Math.max(0, (room.ceilingHeightFeet ?? 8) - 2);
  return wallsOf(room).reduce((sum, w) => sum + (w.lengthFeet ?? 0) * assumedHeight, 0) + ceiling;
}

/** Cubic footage from the room's own outline and ceiling height. */
export function roomCubicFeet(room: SketchRoom): number {
  const area = grossFloorArea(room) ?? 0;
  return area * (room.ceilingHeightFeet ?? 8);
}

export interface RoomEquipment {
  roomId: string;
  roomName: string;
  airMovers: AirMoverResult;
  dehumidifiers: DehumidifierResult;
}

export interface EquipmentSettings {
  waterClass: WaterClass;
  dehumidifierType: DehumidifierType;
  dehumidifierSize: UnitSize;
}

export const DEFAULT_EQUIPMENT_SETTINGS: EquipmentSettings = {
  waterClass: 2,
  dehumidifierType: "lgr",
  dehumidifierSize: "medium",
};

export function roomEquipment(
  room: SketchRoom,
  map: MoistureMap,
  settings: EquipmentSettings,
  fraction: AreaFraction | null = null,
): RoomEquipment {
  const data = roomMoisture(map, room.id);
  return {
    roomId: room.id,
    roomName: room.name.trim() || "Unnamed room",
    airMovers: airMovers({
      affectedFloorSquareFeet: affectedFloorSquareFeet(room, map, fraction),
      affectedUpperSquareFeet: affectedUpperSquareFeet(room, map),
      insetsAndOffsetsOver18Inches: data.insetsOver18Inches,
    }),
    dehumidifiers: dehumidifiers(roomCubicFeet(room), settings.waterClass, settings.dehumidifierType, settings.dehumidifierSize),
  };
}

export interface ClaimEquipment {
  rooms: RoomEquipment[];
  totalAirMovers: number;
  /**
   * Dehumidifiers are sized on the whole affected volume at once, not summed per room.
   *
   * Summing per-room counts would round up once per room and buy a machine for every doorway; the
   * air is continuous through an open structure, and the standard sizes the space, not the rooms.
   */
  totalDehumidifiers: DehumidifierResult;
}

/**
 * Only rooms with moisture data. A claim with no map produces no rooms and no recommendation.
 *
 * "Has data" means content — `hasRoomMoisture` — not the presence of a key. This filtered on the key
 * and so counted any room that had ever been touched: a sub-room with nothing marked in it was
 * included, fell through to the unmapped fallbacks, and was billed as a fully affected room, adding
 * its whole floor and every wall to the air mover count.
 */
export function claimEquipment(sketch: Sketch, map: MoistureMap, settings: EquipmentSettings): ClaimEquipment {
  const affected = sketch.rooms.filter((room) => hasRoomMoisture(map, room.id));
  const rooms = affected.map((room) => roomEquipment(room, map, settings));

  const cubicFeet = affected.reduce((sum, room) => sum + roomCubicFeet(room), 0);

  return {
    rooms,
    totalAirMovers: rooms.reduce((sum, r) => sum + r.airMovers.units, 0),
    totalDehumidifiers: dehumidifiers(cubicFeet, settings.waterClass, settings.dehumidifierType, settings.dehumidifierSize),
  };
}

/* ── Confirm or suggest ────────────────────────────────────────────────────────────────────────── */

export interface EquipmentSuggestion {
  roomId: string;
  roomName: string;
  equipmentType: "air movers" | "dehumidifiers";
  stated: number;
  suggested: number;
}

/**
 * Whether a stated quantity is worth putting a question to the PM about.
 *
 * Only when the map produced a recommendation AND the stated number is below it. Above or equal is
 * the PM's call and is left alone — they are standing on the ground, and over-drying is not a defect
 * this tool should argue with.
 */
export function equipmentSuggestion(
  room: RoomEquipment,
  equipmentType: "air movers" | "dehumidifiers",
  stated: number | null,
): EquipmentSuggestion | null {
  if (stated == null) return null;
  const suggested = equipmentType === "air movers" ? room.airMovers.units : room.dehumidifiers.units;
  if (suggested <= stated) return null;
  return { roomId: room.roomId, roomName: room.roomName, equipmentType, stated, suggested };
}

/** Unused for now, but the shape the sketch-derived tear-out quantities will read from. */
export function roomAffectedAreas(room: SketchRoom, map: MoistureMap): { floorSquareFeet: number; ceilingSquareFeet: number; wallSquareFeet: number } {
  const summary = roomMoistureSummary(room, map);
  return {
    floorSquareFeet: summary.affectedFloorSquareFeet,
    ceilingSquareFeet: summary.affectedCeilingSquareFeet,
    wallSquareFeet: summary.affectedWallSquareFeet,
  };
}

