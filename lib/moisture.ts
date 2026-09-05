import { PIXELS_PER_FOOT, isInsideRoom, roomBounds, type SketchRoom, type Sketch, wallById, wallsOf } from "./sketch";

/**
 * Moisture mapping: where the damage is, on a room the PM has already drawn.
 *
 * ── Why this is a separate file, and a separate object ────────────────────────────────────────
 * The moisture map is a LAYER over the sketch, never part of it. Nothing here is stored on
 * `SketchRoom`, and `Sketch` is not touched: a room carries its geometry, and this module carries
 * readings keyed BY that room's id. Two things follow, and both are requirements rather than
 * conveniences:
 *
 *   - the room is drawn once. Adding moisture data never asks the PM to re-trace a wall.
 *   - the clean sketch keeps existing. It is not a copy taken before the mark-up, it is simply what
 *     the geometry renders as when this layer is not drawn — so it cannot drift or be overwritten.
 *
 * Merging the two would have made both of those something to maintain rather than something that is
 * true by construction.
 *
 * ── Single visit ─────────────────────────────────────────────────────────────────────────────
 * There is deliberately no timestamp, no reading history, no visit number and no previous-value
 * field anywhere in this file. This records what is wet now, to size equipment now. A second set of
 * readings would be a different feature with a different shape, and leaving hooks for it here would
 * only invite half of it to be built by accident.
 */

export type MoistureMaterial = "drywall" | "woodFraming" | "paneling" | "subfloor" | "concrete";

export const MATERIAL_LABEL: Record<MoistureMaterial, string> = {
  drywall: "Drywall",
  woodFraming: "Wood framing",
  paneling: "Paneling",
  subfloor: "Subfloor",
  concrete: "Concrete",
};

export const MATERIAL_ORDER: MoistureMaterial[] = ["drywall", "woodFraming", "paneling", "subfloor", "concrete"];

/**
 * What a WALL can be made of. Subfloor is deliberately absent.
 *
 * Readings are taken on walls, and offering a floor material there is a question the PM has to stop
 * and dismiss every time. Subfloor keeps its entry in the table above rather than being deleted —
 * it is a real material with a real dry standard, and readings on a floor are a plausible next step.
 */
export const WALL_MATERIALS: MoistureMaterial[] = ["drywall", "woodFraming", "paneling", "concrete"];

/**
 * Dry-standard starting points — ranges, because that is what these actually are.
 *
 * NOT authority, and not checked against current S500 text. A dry standard properly comes from an
 * unaffected area of the same material in the same building; published figures are ranges because
 * they move with meter type, species and regional climate. They are offered so the common case is a
 * number the PM confirms rather than four they type, and every one is editable per reading.
 *
 * Concrete has no `prefill` on purpose. Pin meters give a relative number on concrete rather than a
 * true moisture content, so there is no single value worth putting in the box — inventing one would
 * be worse than an empty field, because a wrong number that looks official gets accepted. The PM is
 * asked for their own reference reading instead, and until they give one the concern colour is
 * withheld rather than guessed.
 */
export interface DryStandardGuide {
  /** Midpoint of the range, pre-filled into a new reading. Null means "ask, do not guess". */
  prefill: number | null;
  low: number | null;
  high: number | null;
  /**
   * The reading at which this material is soaked, used to scale the concern bands.
   *
   * Needed because a ratio against the dry standard alone is useless on materials whose numbers are
   * small: drywall dry at 0.75 makes 1.9 a 2.5x elevation, so almost every wet drywall reading
   * pinned to the top band and the gradation carried no information. Grading against the distance
   * from dry to soaked spreads the bands over the range the meter actually produces.
   *
   * Same standing as the dry standards above: starting values, NOT verified against S500.
   */
  saturatedAt: number | null;
  /** Shown next to the field, so the number never reads as settled fact. */
  note: string;
}

export const DRY_STANDARD_GUIDE: Record<MoistureMaterial, DryStandardGuide> = {
  drywall: { prefill: 0.75, low: 0.5, high: 1, saturatedAt: 5, note: "0.5–1% typical. Varies by meter type (pin vs pinless)." },
  // Fibre saturation is around 28% for most species — wood does not hold much more than that.
  woodFraming: { prefill: 11, low: 7, high: 15, saturatedAt: 28, note: "7–15% typical. Varies by species and regional climate." },
  // Thin stock over a backing, so it wets and dries faster than framing does.
  paneling: { prefill: 9, low: 6, high: 12, saturatedAt: 22, note: "6–12% typical. Varies with the backing and the veneer." },
  subfloor: { prefill: 9.5, low: 7, high: 12, saturatedAt: 25, note: "7–12% typical for OSB and plywood." },
  concrete: {
    prefill: null,
    low: null,
    high: null,
    saturatedAt: null,
    note: "No reliable default — concrete is measured differently. Enter your own reference reading.",
  },
};

/** What a new reading of this material starts with. Null for concrete: an empty field, deliberately. */
export function defaultDryStandard(material: MoistureMaterial): number | null {
  return DRY_STANDARD_GUIDE[material].prefill;
}

export interface WallReading {
  id: string;
  /** The wall's start-vertex id — walls are identified by that, never by index. */
  wallId: string;
  /**
   * The affected RUN along the wall, as fractions from its start vertex. Defaults to the whole wall.
   *
   * Water rarely takes a whole wall — it comes in at one end, or stops at a doorway. Recording the
   * run means the affected wall area is length actually wet x height actually wet, rather than the
   * whole wall every time, which overstates both the drying scope and the air movers derived from it.
   */
  startT: number;
  endT: number;
  /** How far the moisture has wicked UP the wall, in feet. */
  affectedHeightFeet: number;
  material: MoistureMaterial;
  /**
   * The meter reading. Null until one is entered — see `readingBand`.
   *
   * Nullable rather than defaulted to a number because a fabricated measurement would flow straight
   * into the summary and out to a document. An unmeasured wall says so.
   */
  reading: number | null;
  /**
   * Pre-filled from `DRY_STANDARD_GUIDE` where a defensible default exists, then whatever the PM
   * says it is. Null while unknown — concrete starts here, and concern is withheld until it is set.
   */
  dryStandard: number | null;
}

export interface RoomMoisture {
  wallReadings: WallReading[];
  /**
   * Painted ceiling cells, on the same grid as the floor and stored separately.
   *
   * A ceiling is a different surface with a different scope — water from above wets the ceiling
   * without necessarily wetting the floor under it — so it gets its own set rather than a flag on
   * the floor's. Both are drawn in plan because in plan they occupy the same footprint.
   */
  ceilingCells: string[];
  /**
   * Painted floor cells, as "col,row" into this room's own grid — see `cellsUnderBrush`.
   *
   * A painted AREA rather than a traced boundary: the PM is marking roughly where the water went,
   * and a freehand outline is fragile in exactly the ways freehand outlines are — it self-crosses
   * and it does not close. Summing cells has neither failure mode.
   */
  floorCells: string[];
  /** Counted by the PM, not derived from the geometry: wall insets and offsets over 18 inches. */
  insetsOver18Inches: number;
}

/** Keyed by room id. A room absent from here simply has no moisture data. */
export interface MoistureMap {
  rooms: Record<string, RoomMoisture>;
}

export function emptyMoistureMap(): MoistureMap {
  return { rooms: {} };
}

export function emptyRoomMoisture(): RoomMoisture {
  return { wallReadings: [], floorCells: [], ceilingCells: [], insetsOver18Inches: 0 };
}

/** Which surface the brush is painting. */
export type PaintSurface = "floor" | "ceiling";

export function roomMoisture(map: MoistureMap, roomId: string): RoomMoisture {
  return map.rooms[roomId] ?? emptyRoomMoisture();
}

/**
 * Which room a wall mark belongs to, found from the mark's own id.
 *
 * The map is keyed by room, so anything acting on a mark needs to know its room first. Taking that
 * from whichever room happens to be selected is the tempting shortcut and it is wrong: tapping a
 * mark on a room you had not selected leaves the two disagreeing, and every operation then reaches
 * into the wrong room's list and silently does nothing.
 */
export function roomIdForReading(map: MoistureMap, readingId: string): string | null {
  for (const [roomId, data] of Object.entries(map.rooms)) {
    if (data.wallReadings.some((r) => r.id === readingId)) return roomId;
  }
  return null;
}

/** True when anything at all has been recorded — used to decide whether a moisture render exists. */
export function hasMoistureContent(map: MoistureMap): boolean {
  return Object.values(map.rooms).some(
    (r) => r.wallReadings.length > 0 || r.floorCells.length > 0 || r.ceilingCells.length > 0 || r.insetsOver18Inches > 0,
  );
}

export function hasRoomMoisture(map: MoistureMap, roomId: string): boolean {
  const r = map.rooms[roomId];
  return !!r && (r.wallReadings.length > 0 || r.floorCells.length > 0 || r.ceilingCells.length > 0 || r.insetsOver18Inches > 0);
}

/**
 * Readings that no longer describe anything, dropped.
 *
 * Two ways that happens, and this used to handle only the first.
 *
 * A DELETED ROOM strands its whole entry. Straightforward.
 *
 * A RESHAPED ROOM is subtler and was the reported bug. Cells are addressed as `col,row` into a grid
 * anchored at the room's own bounding box (see `cellsUnderBrush`), so dragging a wall outward moves
 * that anchor and every stored cell silently maps to a different place — paint that was inside the
 * room ends up hanging outside it. It cannot be erased, either: a stroke only starts over a room,
 * and `cellsUnderBrush` only ever returns cells whose centre is inside the outline, so nothing the
 * eraser can name covers it. And it is not merely ugly — `paintedFloorSquareFeet` counts those cells
 * into the affected floor area that gap-check pre-fills from, so the stray paint becomes a wrong
 * number on a document.
 *
 * Dropping it is the honest resolution. The paint described a floor that no longer exists, and the
 * alternative is an area nobody can see the edge of, cannot remove, and is billed for.
 */
export function pruneMoisture(map: MoistureMap, sketch: Sketch): MoistureMap {
  const live = new Map(sketch.rooms.map((r) => [r.id, r]));
  const rooms: Record<string, RoomMoisture> = {};
  for (const [roomId, data] of Object.entries(map.rooms)) {
    const room = live.get(roomId);
    if (!room) continue;

    const floorCells = data.floorCells.filter((key) => cellIsInsideRoom(room, key));
    const ceilingCells = data.ceilingCells.filter((key) => cellIsInsideRoom(room, key));
    // Rebuilt only when something actually went, so an untouched sketch keeps its object identity
    // and the effect that calls this does not loop.
    rooms[roomId] =
      floorCells.length === data.floorCells.length && ceilingCells.length === data.ceilingCells.length
        ? data
        : { ...data, floorCells, ceilingCells };
  }
  return { rooms };
}

/** Whether a stored cell key still lands inside the room it belongs to. */
function cellIsInsideRoom(room: SketchRoom, key: string): boolean {
  const [colText, rowText] = key.split(",");
  const col = Number(colText);
  const row = Number(rowText);
  // An unparseable key describes nothing and cannot be drawn or erased — drop it.
  if (!Number.isFinite(col) || !Number.isFinite(row)) return false;
  const size = cellSizePx();
  const bounds = roomBounds(room);
  // The same centre-of-cell test `cellsUnderBrush` paints by, so the two cannot disagree about
  // which cells belong to a room.
  return isInsideRoom(room, bounds.minX + (col + 0.5) * size, bounds.minY + (row + 0.5) * size);
}

/**
 * Store a room's moisture data, dropping the entry entirely once it holds nothing.
 *
 * An empty entry is not the same as no entry anywhere it is read, and keeping one around meant a
 * room the PM had merely selected — or typed into and cleared — looked mapped to everything
 * downstream. Removing it keeps "is this room mapped" a question about content rather than about
 * whether a key happens to exist.
 */
export function setRoomMoisture(map: MoistureMap, roomId: string, next: RoomMoisture): MoistureMap {
  const empty = next.wallReadings.length === 0 && next.floorCells.length === 0 && next.ceilingCells.length === 0 && next.insetsOver18Inches === 0;
  if (empty) {
    if (!(roomId in map.rooms)) return map;
    const rooms = { ...map.rooms };
    delete rooms[roomId];
    return { rooms };
  }
  return { rooms: { ...map.rooms, [roomId]: next } };
}

/* ── How wet is it ─────────────────────────────────────────────────────────────────────────────── */

export type ConcernBand = "dry" | "slight" | "elevated" | "high";

/**
 * How far above its dry standard a reading sits, as a multiple. Reported, not used for grading.
 *
 * Kept because it is the number a PM would quote ("three times dry"), but it is deliberately NOT
 * what picks the colour — see `wetness`.
 */
export function elevationRatio(reading: number, dryStandard: number | null): number | null {
  if (dryStandard == null || !(dryStandard > 0)) return null;
  return reading / dryStandard;
}

/**
 * Where a reading sits between dry and soaked, from 0 to 1. This is what the colour grades on.
 *
 * Grading on the ratio alone was wrong, and wrong in a way that made the map useless on the most
 * common material: drywall's dry standard is under 1, so 1.9 is already 2.5x dry and every damp
 * reading pinned to the top band. Measuring the distance travelled from dry towards soaked puts
 * drywall's 0.5-to-5 range and wood's 11-to-28 range on the same footing, which is the whole point
 * of having four bands.
 *
 * Null when the material has no dry standard set, or no saturation reference to scale against.
 */
export function wetness(reading: number, dryStandard: number | null, material: MoistureMaterial): number | null {
  const saturated = DRY_STANDARD_GUIDE[material].saturatedAt;
  if (dryStandard == null || saturated == null || saturated <= dryStandard) return null;
  return (reading - dryStandard) / (saturated - dryStandard);
}

/**
 * Null when there is no dry standard to compare against — an honest "not known yet", not a guess.
 *
 * Concrete arrives here by default, and any material does if the PM clears the field. The map draws
 * those walls in a neutral colour so they read as unassessed rather than as safe.
 */
/**
 * Where one band ends and the next begins, as a multiple of the dry standard.
 *
 * A triage aid for reading the map at a glance, NOT a standard and not a scoping threshold — which
 * is why it lives in one named place that can be changed in one edit.
 *
 * The dry band is 1.1 rather than something tighter because these ratios sit on very different
 * absolute scales. Drywall at 0.8 against a 0.75 standard is five hundredths of a percentage point
 * apart — inside any meter's noise — yet a 5% band would light it up as elevated. A tenth keeps that
 * honest while still separating 12% wood from 11% wood correctly.
 */
export const BAND_THRESHOLDS = { dry: 0.05, slight: 0.35, elevated: 0.7 } as const;

export function concernBand(reading: number, dryStandard: number | null, material: MoistureMaterial): ConcernBand | null {
  const t = wetness(reading, dryStandard, material);
  if (t == null) return null;
  if (t <= BAND_THRESHOLDS.dry) return "dry";
  if (t <= BAND_THRESHOLDS.slight) return "slight";
  if (t <= BAND_THRESHOLDS.elevated) return "elevated";
  return "high";
}

export const BAND_LABEL: Record<ConcernBand, string> = {
  dry: "At dry standard",
  slight: "Slightly elevated",
  elevated: "Elevated",
  high: "Significantly elevated",
};

/**
 * The band a mark shows, which is not quite the band its reading computes to.
 *
 * A wall with no reading yet shows as significantly elevated. Marking a wall is itself the assertion
 * that it is wet — nobody taps a dry wall to record it — so the useful default is the one that says
 * so, and the PM narrows it down by typing the number they measured. The alternative, starting at
 * nothing, made the common case a step longer for no gain.
 *
 * The assumption never leaks into the data: `reading` stays null until measured, and the summary
 * reports it as null alongside the assumed band, so nothing downstream can mistake one for the other.
 */
export function readingBand(reading: WallReading): ConcernBand | null {
  if (reading.reading == null) return "high";
  return concernBand(reading.reading, reading.dryStandard, reading.material);
}

/**
 * A sequential ramp, deliberately not red-versus-green.
 *
 * Severity here is one thing getting worse, not two opposed states, so a single warm ramp reads
 * correctly — and it stays readable for the ~8% of men with red/green colour blindness, who cannot
 * separate the two hues that scheme depends on. Lightness falls as concern rises, so the ordering
 * survives greyscale printing too, which matters for a document that gets attached to a claim.
 */
export const BAND_COLOR: Record<ConcernBand, string> = {
  dry: "#9aa5b1",
  slight: "#f2c14e",
  elevated: "#e07b39",
  high: "#b3382c",
};

/** A wall with a reading but no dry standard: assessed, but not yet interpretable. */
export const UNKNOWN_BAND_COLOR = "#6b7a8f";
export const UNKNOWN_BAND_LABEL = "No dry standard set";

export function bandColor(band: ConcernBand | null): string {
  return band === null ? UNKNOWN_BAND_COLOR : BAND_COLOR[band];
}

export function bandLabel(band: ConcernBand | null): string {
  return band === null ? UNKNOWN_BAND_LABEL : BAND_LABEL[band];
}

/* ── The floor grid ────────────────────────────────────────────────────────────────────────────── */

/**
 * Cell size, in feet. Three inches.
 *
 * Small enough that a painted edge reads as a smooth stroke rather than a staircase, and small
 * enough that the area quantum (1/16 of a square foot) is well under the precision anyone claims
 * for this. Not so small that a big room turns into a set of tens of thousands of strings.
 *
 * The grid is never drawn. It exists so the area is a sum of known quantities instead of an integral
 * over a freehand path.
 */
export const FLOOR_CELL_FEET = 0.25;

/** One painted cell's real area. */
export const CELL_SQUARE_FEET = FLOOR_CELL_FEET * FLOOR_CELL_FEET;

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function parseCellKey(key: string): { col: number; row: number } | null {
  const [c, r] = key.split(",");
  if (c === undefined || r === undefined) return null;
  const col = Number(c);
  const row = Number(r);
  return Number.isFinite(col) && Number.isFinite(row) ? { col, row } : null;
}

/**
 * Cells are indexed from the room's bounding-box origin, so the paint travels with the room.
 *
 * Storing them as absolute world coordinates would leave the highlight behind the moment the room
 * was nudged; indexing from the room's own origin means moving the room moves its moisture with it,
 * for free and without touching this layer.
 */
export function cellSizePx(): number {
  return PIXELS_PER_FOOT * FLOOR_CELL_FEET;
}

export function cellCentreWorld(room: SketchRoom, col: number, row: number): { x: number; y: number } {
  const size = cellSizePx();
  const bounds = roomBounds(room);
  return { x: bounds.minX + (col + 0.5) * size, y: bounds.minY + (row + 0.5) * size };
}

/**
 * Every cell under one dab of the brush.
 *
 * Constrained to the room's own outline: a cell counts only when its centre is inside the polygon,
 * so painting over a wall and out into open space cannot add area that does not exist. That test is
 * against the true outline, not the bounding box, so an L-shaped room's notch stays unpainted.
 */
export function cellsUnderBrush(room: SketchRoom, world: { x: number; y: number }, brushRadiusPx: number): string[] {
  const size = cellSizePx();
  const bounds = roomBounds(room);

  const minCol = Math.floor((world.x - brushRadiusPx - bounds.minX) / size);
  const maxCol = Math.ceil((world.x + brushRadiusPx - bounds.minX) / size);
  const minRow = Math.floor((world.y - brushRadiusPx - bounds.minY) / size);
  const maxRow = Math.ceil((world.y + brushRadiusPx - bounds.minY) / size);

  const out: string[] = [];
  const rSquared = brushRadiusPx * brushRadiusPx;
  for (let col = Math.max(0, minCol); col <= maxCol; col++) {
    for (let row = Math.max(0, minRow); row <= maxRow; row++) {
      const centre = { x: bounds.minX + (col + 0.5) * size, y: bounds.minY + (row + 0.5) * size };
      const dx = centre.x - world.x;
      const dy = centre.y - world.y;
      if (dx * dx + dy * dy > rSquared) continue;
      if (!isInsideRoom(room, centre.x, centre.y)) continue;
      out.push(cellKey(col, row));
    }
  }
  return out;
}

/**
 * The cells along a stroke, not just under its endpoints.
 *
 * Pointer events arrive far apart when a finger moves quickly — far enough to leave gaps a brush
 * dab at each reported position would not close. Stepping along the segment at half the brush radius
 * guarantees consecutive dabs overlap, so a fast stroke paints as one continuous mark.
 */
export function cellsAlongStroke(
  room: SketchRoom,
  from: { x: number; y: number },
  to: { x: number; y: number },
  brushRadiusPx: number,
): string[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(brushRadiusPx / 2, 1);
  const steps = Math.max(1, Math.ceil(dist / step));
  const out = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const at = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    for (const key of cellsUnderBrush(room, at, brushRadiusPx)) out.add(key);
  }
  return [...out];
}

/**
 * Painted cells collapsed into horizontal runs, for drawing.
 *
 * A fully painted 20' room is some 4,800 cells; asking the canvas to fill that many rectangles every
 * frame of a drag is what would make painting feel heavy. Merging each row into runs turns it into
 * one rectangle per row per gap — tens, not thousands — and the result is identical.
 */
export function floorRuns(cells: Iterable<string>): { col: number; row: number; length: number }[] {
  const byRow = new Map<number, number[]>();
  for (const key of cells) {
    const parsed = parseCellKey(key);
    if (!parsed) continue;
    const cols = byRow.get(parsed.row);
    if (cols) cols.push(parsed.col);
    else byRow.set(parsed.row, [parsed.col]);
  }

  const runs: { col: number; row: number; length: number }[] = [];
  for (const [row, cols] of byRow) {
    cols.sort((a, b) => a - b);
    let start = cols[0];
    if (start === undefined) continue;
    let length = 1;
    for (let i = 1; i < cols.length; i++) {
      const col = cols[i];
      if (col === undefined) continue;
      if (col === start + length) {
        length++;
        continue;
      }
      runs.push({ col: start, row, length });
      start = col;
      length = 1;
    }
    runs.push({ col: start, row, length });
  }
  return runs;
}

export function paintedFloorSquareFeet(cells: string[]): number {
  return cells.length * CELL_SQUARE_FEET;
}

/* ── What comes out ────────────────────────────────────────────────────────────────────────────── */

export interface ReadingSummary {
  wallId: string;
  /** Which wall, in terms a person can find on the plan. */
  wallLengthFeet: number | null;
  /** The wet run along that wall, which is what the affected area is actually computed from. */
  affectedLengthFeet: number | null;
  affectedHeightFeet: number;
  /** Wall length x affected height — the number the air-mover calculation actually wants. */
  affectedWallSquareFeet: number | null;
  material: MoistureMaterial;
  /** Null when nothing has been measured yet — see `readingBand`. */
  reading: number | null;
  dryStandard: number | null;
  /** Null when no dry standard has been set — the reading stands, its meaning does not. */
  elevationRatio: number | null;
  band: ConcernBand | null;
  /** True when `band` is the assumed one rather than one computed from a measurement. */
  bandAssumed: boolean;
}

export interface RoomMoistureSummary {
  roomId: string;
  roomName: string;
  readings: ReadingSummary[];
  /** Sum of the painted floor cells, in square feet. */
  affectedFloorSquareFeet: number;
  /** Sum of the painted ceiling cells, in square feet. */
  affectedCeilingSquareFeet: number;
  /** Sum of every reading's wall length x its own affected height. */
  affectedWallSquareFeet: number;
  insetsOver18Inches: number;
  /** The worst band present, for a one-glance status. Null with no readings, or none interpretable. */
  worstBand: ConcernBand | null;
  /** Readings that cannot be interpreted yet, so the gap is visible rather than silently skipped. */
  readingsWithoutDryStandard: number;
  /** Marks still carrying the assumed band because no number has been entered. */
  readingsNotMeasured: number;
}

const BAND_RANK: Record<ConcernBand, number> = { dry: 0, slight: 1, elevated: 2, high: 3 };

/**
 * The structured result, per room.
 *
 * Built to be read directly by the equipment calculation that follows this work — which is why the
 * per-wall affected area is computed here rather than left to be re-derived. That figure is the
 * refinement this whole wall-based approach buys: the air-mover formula can use each wall's measured
 * affected height where a reading exists, instead of assuming ceiling height less two feet, and fall
 * back to the assumption only for walls with no reading.
 */
export function roomMoistureSummary(room: SketchRoom, map: MoistureMap): RoomMoistureSummary {
  const data = roomMoisture(map, room.id);

  const readings: ReadingSummary[] = data.wallReadings.map((r) => {
    const wall = wallById(room, r.wallId);
    const lengthFeet = wall?.lengthFeet ?? null;
    const run = Math.max(0, r.endT - r.startT);
    const affectedLengthFeet = lengthFeet == null ? null : lengthFeet * run;
    return {
      wallId: r.wallId,
      wallLengthFeet: lengthFeet,
      affectedLengthFeet,
      affectedHeightFeet: r.affectedHeightFeet,
      affectedWallSquareFeet: affectedLengthFeet == null ? null : affectedLengthFeet * r.affectedHeightFeet,
      material: r.material,
      reading: r.reading,
      dryStandard: r.dryStandard,
      elevationRatio: r.reading == null ? null : elevationRatio(r.reading, r.dryStandard),
      band: readingBand(r),
      bandAssumed: r.reading == null,
    };
  });

  const worstBand = readings.reduce<ConcernBand | null>(
    (worst, r) => (r.band !== null && (worst === null || BAND_RANK[r.band] > BAND_RANK[worst]) ? r.band : worst),
    null,
  );

  return {
    roomId: room.id,
    roomName: room.name.trim() || "Unnamed room",
    readings,
    affectedFloorSquareFeet: paintedFloorSquareFeet(data.floorCells),
    affectedCeilingSquareFeet: paintedFloorSquareFeet(data.ceilingCells),
    affectedWallSquareFeet: readings.reduce((sum, r) => sum + (r.affectedWallSquareFeet ?? 0), 0),
    insetsOver18Inches: data.insetsOver18Inches,
    worstBand,
    readingsWithoutDryStandard: readings.filter((r) => r.band === null).length,
    readingsNotMeasured: readings.filter((r) => r.bandAssumed).length,
  };
}

export function moistureSummary(sketch: Sketch, map: MoistureMap): RoomMoistureSummary[] {
  return sketch.rooms.filter((room) => hasRoomMoisture(map, room.id)).map((room) => roomMoistureSummary(room, map));
}

/** Walls that have no reading — the ones an equipment calculation must fall back to assuming for. */
export function unreadWalls(room: SketchRoom, map: MoistureMap): string[] {
  const read = new Set(roomMoisture(map, room.id).wallReadings.map((r) => r.wallId));
  return wallsOf(room)
    .map((w) => w.id)
    .filter((id) => !read.has(id));
}
