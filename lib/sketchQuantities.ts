import {
  blockFloorAreaFeet,
  blockWallContacts,
  type BlockSymbol,
  type FreeWall,
  freeWallsOf,
  MIN_VERTICES,
  PIXELS_PER_FOOT,
  roomBounds,
  type Sketch,
  type SketchRoom,
  type SketchSymbol,
  isBlockSymbol,
  isDeductible,
  isNestedWithin,
  openingSquareFeet,
  standsOnFloor,
  stairCeiling,
  stairFlight,
  symbolWidthFeet,
  wallsOf,
} from "./sketch";
import { freeWallRunsIn } from "./sketchWalls";

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
function blockFootprint(
  symbol: BlockSymbol,
  room: SketchRoom,
  rooms: SketchRoom[],
  freeWalls: FreeWall[],
): { widthFeet: number; depthFeet: number; heightFeet: number } | null {
  /*
    `rooms` matters here as much as it does on the canvas. A cabinet whose width is capped because a
    sub-room stands on part of its wall must be PRICED at the capped width — otherwise the drawing
    and the estimate disagree, and the estimate is the one somebody bills from.
  */
  const widthFeet = symbolWidthFeet(symbol, room, rooms, freeWalls);
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
  /*
    The run the phone measured, when there is one.

    The assumption below — that a slope runs the length of the room's larger bounding dimension —
    is this file's one soft number, and it is wrong by the difference between a room's two sides
    whenever the ceiling falls the other way. A scan reads the ceiling at every corner and so knows
    which way it falls and how far; `ceilingRunFeet` is that, already halved for a vault by the
    phone, and it is believed over the assumption. A sketch drawn by hand has no such reading and
    is unchanged.
  */
  const run = room.ceilingRunFeet != null && room.ceilingRunFeet > 0
    ? room.ceilingRunFeet
    : room.ceilingType === "vaulted" ? spanFeet / 2 : spanFeet;
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

  // Children's footprints come out of this room's floor and ceiling — see the header note. Only
  // the children standing INSIDE it: a sub-room beside its parent (pulled off its wall and made
  // its sub-room by choice) has a floor of its own that was never part of this one.
  const childArea = sketch.rooms
    .filter((r) => isNestedWithin(r, room))
    .reduce((sum, child) => sum + grossFloorArea(child), 0);

  const outlineArea = grossFloorArea(room) - childArea;
  const blocks = deductibleBlocks(room);

  let perimeterDeduction = 0;
  let floorDeduction = 0;
  let wallDeduction = 0;

  for (const block of blocks) {
    const f = blockFootprint(block, room, sketch.rooms, freeWallsOf(sketch));
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

  /*
    FREE BLOCKS — an island, a peninsula, a corner fireplace. These deducted NOTHING until
    2026-09-24: the loop above walks the wall-mounted symbols, and a block standing in open floor is
    not one, so a 6' x 3' island took eighteen square feet of flooring nobody was going to lay.

    Three differences from a wall run, and each is the block's freedom showing:

     - the FLOOR it covers is its real footprint through `blockFloorAreaFeet`, which turns with it
       and halves for a triangle. A corner fireplace drawn as a rectangle across the corner would
       otherwise claim the two triangles of floor either side of it that are still there.
     - the PERIMETER it takes is only what it actually touches (`blockWallContacts`, derived from
       where the block is rather than stored). An island in open floor touches nothing and takes no
       perimeter; a peninsula touches at one end and takes that end; a run pushed flat against a
       wall touches along its length and takes it, exactly as a wall-mounted run would.
     - the WALL behind it is deducted only when somebody said how tall it is. `heightFeet` is
       nullable here on purpose — a seeded height is a measurement nobody took.
  */
  for (const block of room.freeCabinets) {
    const onFloor = standsOnFloor(block.tier);
    if (options.deductFromFloorArea && onFloor) {
      floorDeduction += blockFloorAreaFeet(block, room);
    }
    if ((options.deductCabinetsFromFloorPerimeter && onFloor) || options.deductFromWallArea) {
      const contacts = blockWallContacts(block, room);
      const touching = contacts.reduce((sum, c) => sum + c.feet, 0);
      if (options.deductCabinetsFromFloorPerimeter && onFloor) perimeterDeduction += touching;
      if (options.deductFromWallArea && block.heightFeet != null) wallDeduction += touching * block.heightFeet;
    }
  }

  // Other rooms' doors in this room's walls count too — see `openingSquareFeetOnWall`.
  const openings = options.deductOpeningsFromWallArea ? openingSquareFeet(room, sketch.rooms) : 0;

  const profile = ceilingProfile(room);

  /*
    Free walls standing in this room — see `FreeWall`. A partition has two faces and base along both
    sides, so each foot of it is two feet of floor perimeter and two faces of wall; only a full-
    height one meets the ceiling, so a pony wall adds nothing at the ceiling line. Credited here,
    to the room the wall stands in, because that is whose finish it is.
  */
  const partitions = freeWallRunsIn(room, sketch);
  const partitionFloorFeet = partitions.reduce((sum, run) => sum + 2 * run.lengthFeet, 0);
  const partitionCeilingFeet = partitions.reduce((sum, run) => sum + (run.heightFeet == null ? 2 * run.lengthFeet : 0), 0);
  const partitionWallArea =
    profile.meanHeightFeet == null ? 0 : partitions.reduce((sum, run) => sum + 2 * run.lengthFeet * Math.min(run.heightFeet ?? Infinity, profile.meanHeightFeet as number), 0);

  const grossWallArea = (profile.meanHeightFeet == null ? 0 : perimeter * profile.meanHeightFeet) + partitionWallArea;
  const ceilingSurface = outlineArea * profile.surfaceFactor;
  const grossPerimeterFloor = perimeter + partitionFloorFeet;

  return {
    perimeterCeiling: perimeter + partitionCeilingFeet,
    perimeterFloor: Math.max(0, grossPerimeterFloor - perimeterDeduction),
    floorArea: Math.max(0, outlineArea - floorDeduction),
    wallArea: Math.max(0, grossWallArea - wallDeduction - openings),
    ceilingArea: Math.max(0, ceilingSurface),
    gross: { perimeterFloor: grossPerimeterFloor, floorArea: outlineArea, wallArea: grossWallArea },
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

/**
 * What the ESTIMATE is told about each room's size, keyed by `normaliseRoomName`.
 *
 * Structurally `RoomAreasByName` from `lib/debris.ts`, named here rather than imported so the
 * quantities do not have to depend on the disposal estimate to describe their own output.
 */
export type RoomAreasForEstimate = Record<
  string,
  { floorSquareFeet: number | null; wallRunFeet: number | null; ceilingSquareFeet: number | null }
>;

/**
 * Every drawn room's size as the scope should price it: the deductions the estimator chose, applied.
 *
 * WHY THIS IS NOT `grossFloorArea`, which is what it used to be. Until 2026-09-24 the claim page
 * worked these out itself, from the room's own outline and the sum of its walls, and that second
 * calculation drifted from `roomQuantities` in three ways that all understated or overstated a
 * priced number:
 *
 *  - CABINETS AND BUILT-INS never came off. The toggles existed, the panel obeyed them, and the
 *    estimate did not — so taking a kitchen run out of the floor changed a number on screen and
 *    nothing that was sent. The deduction was a readout rather than a decision, which is the worst
 *    kind of wrong: it looks like it worked.
 *  - A SUB-ROOM was counted TWICE. A closet drawn inside a bedroom was weighed once as the closet
 *    and again as part of the bedroom, because a room's own outline takes no notice of what is
 *    nested in it.
 *  - PARTITIONS contributed no wall run, since only the outline's own walls were summed.
 *
 * The ceiling is `ceilingArea` and the floor is `floorArea`, which are no longer the same number:
 * both lose their sub-rooms, and only the floor loses the cabinets standing on it. A cabinet does
 * not shorten the ceiling above it.
 */
export function roomAreasForEstimate(
  sketch: Sketch,
  keyOf: (name: string) => string,
  options: QuantityOptions = sketch.quantities ?? DEFAULT_QUANTITY_OPTIONS,
): RoomAreasForEstimate {
  const out: RoomAreasForEstimate = {};
  for (const room of sketch.rooms) {
    const q = roomQuantities(room, sketch, options);
    out[keyOf(room.name ?? "")] = {
      floorSquareFeet: q.floorArea > 0 ? q.floorArea : null,
      wallRunFeet: q.perimeterFloor > 0 ? q.perimeterFloor : null,
      ceilingSquareFeet: q.ceilingArea > 0 ? q.ceilingArea : null,
    };
  }
  return out;
}
