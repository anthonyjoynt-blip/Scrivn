import {
  type BlockSymbol,
  MIN_VERTICES,
  PIXELS_PER_FOOT,
  roomBounds,
  type Sketch,
  type SketchRoom,
  type SketchSymbol,
  isBlockSymbol,
  isDeductible,
  openingSquareFeet,
  standsOnFloor,
  stairCeiling,
  stairFlight,
  symbolWidthFeet,
  wallsOf,
} from "./sketch";

/**
 * The measured quantities a sketch produces: the five numbers an estimator reads off a plan.
 *
 *   PC  perimeter, ceiling   — the full run around the room
 *   PF  perimeter, floor     — the same run, optionally less the cabinet runs standing on it
 *   F   floor area
 *   W   wall surface area
 *   C   ceiling area
 *
 * Kept in its own file rather than in sketch.ts because this is arithmetic ON a sketch, not part of
 * what a sketch IS. Nothing here mutates anything; every function takes a room and returns numbers.
 *
 * ── What gets deducted, and why it is a choice ────────────────────────────────────────────────
 * Whether a cabinet run comes out of the wall behind it is a scoping decision, not a fact about the
 * building: some carriers pay to remove and replace finish behind cabinetry, some don't. So each
 * deduction is a toggle, and the gross figure is always reported alongside so the two can be
 * compared without re-deriving anything.
 *
 * Doors, openings and windows are a toggle too, but ON by default. There is genuinely no wall in a
 * doorway, so deducting is the accurate answer; the switch is there because an estimator comparing
 * against a gross figure from elsewhere needs to be able to turn it off, not because the building
 * is in any doubt.
 *
 * ── Sub-rooms ─────────────────────────────────────────────────────────────────────────────────
 * A closet drawn inside a bedroom is inside the bedroom's outline, so its floor would be counted
 * twice — once as its own room, once as part of its parent. Parents therefore have their children's
 * footprints subtracted from floor and ceiling. Perimeter is NOT adjusted: the closet's walls are
 * real walls that exist in addition to the bedroom's, not instead of part of them.
 */

export interface QuantityOptions {
  /** PF: take the running feet of lower cabinets out of the floor perimeter. */
  deductCabinetsFromFloorPerimeter: boolean;
  /** F: take the footprint of lower cabinets and built-in fixtures out of the floor area. */
  deductFromFloorArea: boolean;
  /** W: take the wall face behind lowers, uppers and built-ins out of the wall area. */
  deductFromWallArea: boolean;
  /** W: take doors, cased openings and windows out of the wall area. On by default — see above. */
  deductOpeningsFromWallArea: boolean;
}

export const DEFAULT_QUANTITY_OPTIONS: QuantityOptions = {
  deductCabinetsFromFloorPerimeter: false,
  deductFromFloorArea: false,
  deductFromWallArea: false,
  deductOpeningsFromWallArea: true,
};

export interface RoomQuantities {
  /** Perimeter at the ceiling, in feet. */
  perimeterCeiling: number;
  /** Perimeter at the floor, in feet — PC less cabinet runs when that option is on. */
  perimeterFloor: number;
  /** Floor area in square feet, after sub-rooms and any chosen deductions. */
  floorArea: number;
  /** Wall surface in square feet: perimeter x ceiling height, less any chosen deductions. */
  wallArea: number;
  /** Ceiling area in square feet, after sub-rooms. */
  ceilingArea: number;
  /** The same five before any deduction, so the difference is visible. */
  gross: { perimeterFloor: number; floorArea: number; wallArea: number };
  /**
   * What was taken off, itemised — a number nobody can check is a number nobody will trust.
   *
   * `openingSquareFeet` is listed apart from `wallSquareFeet` because the two are not the same kind
   * of thing: the wall figure is what the deduction toggles chose to take off, and the opening
   * figure is wall that is not there. One is a scoping decision, the other is the building.
   */
  deductions: { perimeterFeet: number; floorSquareFeet: number; wallSquareFeet: number; openingSquareFeet: number };
  /** Null when the room has no ceiling height, which makes wall area unknowable. */
  ceilingHeightFeet: number | null;
}

/** Polygon area in square pixels, via the shoelace formula. */
function polygonAreaPx(room: SketchRoom): number {
  const vs = room.vertices;
  let sum = 0;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % vs.length];
    if (!a || !b) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Real floor area of a room's own outline, before sub-rooms are taken out. */
export function grossFloorArea(room: SketchRoom): number {
  return polygonAreaPx(room) / (PIXELS_PER_FOOT * PIXELS_PER_FOOT);
}

/** How wide a block symbol is along its wall, how far it comes out, and how far up it covers. */
function blockFootprint(symbol: BlockSymbol, room: SketchRoom): { widthFeet: number; depthFeet: number; heightFeet: number } | null {
  const widthFeet = symbolWidthFeet(symbol, room);
  if (widthFeet == null) return null;
  return { widthFeet, depthFeet: symbol.depthFeet, heightFeet: symbol.heightFeet };
}

/** Everything against a wall that covers what's behind it. */
function deductibleBlocks(room: SketchRoom): BlockSymbol[] {
  return room.symbols.filter((s): s is BlockSymbol => isBlockSymbol(s) && isDeductible(s));
}

/** Lower and full-height cabinets and built-in fixtures — the things that stand ON the floor. */
function floorStanding(symbols: BlockSymbol[]): BlockSymbol[] {
  return symbols.filter((s) => (s.type === "cabinet" ? standsOnFloor(s.tier) : true));
}

/**
 * The height to reckon wall area by, and how much bigger the ceiling surface is than its plan area.
 *
 * A sloped ceiling rises steadily from one side to the other; a vaulted one rises to a ridge and
 * falls again. In both cases the height varies LINEARLY, so the mean over the room is simply the
 * average of the low and high points — that is exact for a shed slope and for a symmetric vault, and
 * it is what wall area should use.
 *
 * The ceiling SURFACE is longer than its plan because it is a hypotenuse. The horizontal run of that
 * slope is assumed to be the room's larger bounding dimension for a single slope, and half of it for
 * a vault, which rises to a ridge in the middle. That assumption is the one soft number here: the
 * sketch records that a ceiling is sloped, not which way it falls. It is documented rather than
 * hidden, and a flat ceiling — the overwhelming majority — is unaffected.
 */
function ceilingProfile(room: SketchRoom): { meanHeightFeet: number | null; surfaceFactor: number } {
  // A stair room's ceiling is not a setting, it is a consequence of the flight — and here the run is
  // known exactly rather than assumed, because it is the flight's own direction of travel.
  if (room.stairs) {
    const { lowFeet, peakFeet } = stairCeiling(room);
    const flight = stairFlight(room);
    const mean = (lowFeet + peakFeet) / 2;
    const run = flight.runFeet;
    const surfaceFactor = run && run > 0 ? Math.hypot(run, peakFeet - lowFeet) / run : 1;
    return { meanHeightFeet: mean, surfaceFactor };
  }

  const low = room.ceilingHeightFeet;
  if (low == null) return { meanHeightFeet: null, surfaceFactor: 1 };
  if (room.ceilingType === "flat" || room.ceilingPeakFeet == null) return { meanHeightFeet: low, surfaceFactor: 1 };

  const peak = Math.max(low, room.ceilingPeakFeet);
  const bounds = roomBounds(room);
  const spanFeet = Math.max(bounds.width, bounds.height) / PIXELS_PER_FOOT;
  const run = room.ceilingType === "vaulted" ? spanFeet / 2 : spanFeet;
  const rise = peak - low;
  const surfaceFactor = run > 0 ? Math.hypot(run, rise) / run : 1;

  return { meanHeightFeet: (low + peak) / 2, surfaceFactor };
}

export function roomQuantities(room: SketchRoom, sketch: Sketch, options: QuantityOptions): RoomQuantities {
  const ceilingHeightFeet = room.ceilingHeightFeet;

  const empty: RoomQuantities = {
    perimeterCeiling: 0,
    perimeterFloor: 0,
    floorArea: 0,
    wallArea: 0,
    ceilingArea: 0,
    gross: { perimeterFloor: 0, floorArea: 0, wallArea: 0 },
    deductions: { perimeterFeet: 0, floorSquareFeet: 0, wallSquareFeet: 0, openingSquareFeet: 0 },
    ceilingHeightFeet,
  };
  // A room with fewer than three corners encloses nothing; everything below would divide by it.
  if (room.vertices.length < MIN_VERTICES) return empty;

  const perimeter = wallsOf(room).reduce((sum, wall) => sum + wall.lengthFeet, 0);

  // Children's footprints come out of this room's floor and ceiling — see the header note.
  const childArea = sketch.rooms
    .filter((r) => r.parentRoomId === room.id)
    .reduce((sum, child) => sum + grossFloorArea(child), 0);

  const outlineArea = grossFloorArea(room) - childArea;
  const blocks = deductibleBlocks(room);

  let perimeterDeduction = 0;
  let floorDeduction = 0;
  let wallDeduction = 0;

  for (const block of blocks) {
    const f = blockFootprint(block, room);
    if (!f) continue;
    const onFloor = block.type === "cabinet" ? standsOnFloor(block.tier) : true;

    // A pantry takes up floor perimeter the same way a base run does — see `standsOnFloor`.
    if (options.deductCabinetsFromFloorPerimeter && block.type === "cabinet" && standsOnFloor(block.tier)) {
      perimeterDeduction += f.widthFeet;
    }
    if (options.deductFromFloorArea && onFloor) {
      floorDeduction += f.widthFeet * f.depthFeet;
    }
    if (options.deductFromWallArea) {
      wallDeduction += f.widthFeet * f.heightFeet;
    }
  }

  const openings = options.deductOpeningsFromWallArea ? openingSquareFeet(room) : 0;

  const profile = ceilingProfile(room);
  const grossWallArea = profile.meanHeightFeet == null ? 0 : perimeter * profile.meanHeightFeet;
  const ceilingSurface = outlineArea * profile.surfaceFactor;

  return {
    perimeterCeiling: perimeter,
    perimeterFloor: Math.max(0, perimeter - perimeterDeduction),
    floorArea: Math.max(0, outlineArea - floorDeduction),
    wallArea: Math.max(0, grossWallArea - wallDeduction - openings),
    ceilingArea: Math.max(0, ceilingSurface),
    gross: { perimeterFloor: perimeter, floorArea: outlineArea, wallArea: grossWallArea },
    deductions: {
      perimeterFeet: perimeterDeduction,
      floorSquareFeet: floorDeduction,
      wallSquareFeet: wallDeduction,
      openingSquareFeet: openings,
    },
    ceilingHeightFeet,
  };
}

/** One decimal is the precision these numbers are actually good to; two implies false accuracy. */
export function formatQuantity(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** Every symbol that contributes to a deduction, for showing the user what was taken off. */
export function deductionSources(room: SketchRoom): SketchSymbol[] {
  return deductibleBlocks(room);
}

export { floorStanding };
