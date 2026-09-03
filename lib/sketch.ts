/**
 * The sketch: rooms drawn on a canvas, and the structured data that comes out of them.
 *
 * A sketch is NOT a picture. The rendered canvas is a view; this file defines the actual output —
 * per room, the real length of each wall plus the type, size and position of every door, window and
 * cabinet. That's what makes a sketch useful downstream (an estimator can read dimensions off it)
 * rather than being an image someone has to re-measure from.
 *
 * ── Geometry model ───────────────────────────────────────────────────────────────────────────
 * A room is a closed POLYGON: an ordered, clockwise list of vertices. A rectangle is simply the
 * four-vertex case, and behaves exactly as it always did — dragging a corner still resizes it as a
 * rectangle (see `moveVertex`). Anything with more vertices is an L, a notch, a bay.
 *
 * Walls are the segments between consecutive vertices, wrapping from the last back to the first, so
 * a room has exactly as many walls as vertices. A wall is identified by the id of the vertex it
 * STARTS at, not by its index: inserting a vertex renumbers every wall after it, and symbols would
 * silently jump to a different wall if they held an index.
 *
 * Clockwise winding is load-bearing. The inward normal of a wall is its direction rotated +90° in
 * screen space (y down), which is only "into the room" if the winding is clockwise. That single
 * fact is what lets every door, window and cabinet glyph be drawn once in a wall-local frame with
 * +y meaning "into the room", on any wall at any angle.
 *
 * Rooms are NOT joined to each other: no shared walls, no wall-graph, no snapping between rooms.
 * Two rooms drawn edge to edge still have their own full set of walls. Connected multi-room
 * sketching is a later phase; see `SketchView` for the groundwork laid for it.
 *
 * ── Units ────────────────────────────────────────────────────────────────────────────────────
 * Room geometry is in WORLD PIXELS, at ONE fixed scale for the whole sketch: `PIXELS_PER_FOOT`.
 * One world pixel is one inch. Real measurements are in FEET, as decimal numbers. The
 * feet-and-inches string (12'6") is a display format from `formatFeetInches`, never storage —
 * storing "12'6\"" would mean re-parsing it for every calculation and accumulating rounding error.
 *
 * Because the scale is a constant, a drawn distance and a real distance are the same fact in two
 * units, everywhere, always. There is no per-room scale and no unscaled state: a wall's length in
 * feet is `lengthPx / PIXELS_PER_FOOT` and nothing has to ask whether that division is meaningful
 * yet. Zoom (`SketchView.scale`) is the only other scale in the tool, and it is a camera — it
 * changes what you see, never what anything measures.
 *
 * It was not always so. Each room used to carry its own `pixelsPerFoot`, set from how big it
 * happened to be drawn when its first wall length was typed. Every room's own numbers stayed
 * correct, so the arithmetic was never wrong — but two rooms drawn the same size on screen could
 * mean 12' and 20', a closet drawn inside a bedroom bore no relation to the bedroom around it, and
 * the plan could not be traced as an underlay at any single scale. `withWallLength` now RESIZES the
 * room to the length you typed instead of redefining what a pixel means to it.
 */

/** A room's corner. Ids are stable across edits so walls and symbols can refer to them. */
export interface Vertex {
  id: string;
  x: number;
  y: number;
}

export type SymbolType = "door" | "window" | "cabinet" | "fixture";

export const SYMBOL_LABEL: Record<SymbolType, string> = {
  door: "Door",
  window: "Window",
  cabinet: "Cabinet",
  fixture: "Fixture",
};

/** Plumbing and appliances. Placed against a wall, the same way a cabinet is. */
export type FixtureType = "toilet" | "sink" | "shower" | "tub" | "fridge" | "range" | "dishwasher";

export const FIXTURE_LABEL: Record<FixtureType, string> = {
  toilet: "Toilet",
  sink: "Sink",
  shower: "Shower",
  tub: "Tub",
  fridge: "Fridge",
  range: "Range",
  dishwasher: "Dishwasher",
};

/** A shower is either a rectangular enclosure or the corner (neo-angle) kind. */
export type ShowerShape = "rectangular" | "corner";

/**
 * Typical footprints, in feet, width x depth. Starting points only — every one is editable, and
 * real bathrooms are full of exceptions.
 */
export const FIXTURE_DEFAULT_FEET: Record<FixtureType, { width: number; depth: number }> = {
  toilet: { width: 1.67, depth: 2.5 },
  sink: { width: 2, depth: 1.75 },
  shower: { width: 3, depth: 3 },
  tub: { width: 5, depth: 2.5 },
  fridge: { width: 3, depth: 2.5 },
  range: { width: 2.5, depth: 2.5 },
  dishwasher: { width: 2, depth: 2 },
};

/**
 * Which fixtures cover wall and floor the way a cabinet does.
 *
 * A shower or tub surround is built against the wall, so the finish behind it is not part of the
 * wall being scoped; a fridge is simply standing in the room and the wall behind it still exists.
 * Only the built-in ones are deductible — see `roomQuantities`.
 */
export const FIXTURE_IS_BUILT_IN: Record<FixtureType, boolean> = {
  toilet: false,
  sink: false,
  shower: true,
  tub: true,
  fridge: false,
  range: false,
  dishwasher: false,
};

/** Plan-view door conventions. Each draws differently — see DoorGlyph in SketchCanvas.tsx. */
/**
 * "opening" is a missing wall — a cased opening with no door in it. Kept as a door type rather than
 * a type of its own because it behaves like one in every way that matters: it breaks the wall, it
 * sits at a position along it, it has a width. It just has no leaf, so the editor hides the swing
 * and leaf controls for it.
 */
export type DoorType = "swing" | "bifold" | "pocket" | "sliding" | "opening";
export type DoorLeaves = "single" | "double";

export const DOOR_TYPE_LABEL: Record<DoorType, string> = {
  swing: "Swing",
  bifold: "Bifold",
  pocket: "Pocket",
  sliding: "Sliding",
  opening: "Opening",
};

/** Standard head height, and the default for every door and opening. */
export const DEFAULT_DOOR_HEIGHT_FEET = 6 + 8 / 12;

export const DOOR_LEAVES_LABEL: Record<DoorLeaves, string> = {
  single: "Single",
  double: "Double",
};

/**
 * How a room's ceiling is shaped.
 *
 * "sloped" rises steadily from one side to the other (a shed or stairwell ceiling); "vaulted" rises
 * to a ridge in the middle and falls again. Both change the wall and ceiling quantities — see
 * `roomQuantities`.
 */
export type CeilingType = "flat" | "sloped" | "vaulted";

export const CEILING_TYPE_LABEL: Record<CeilingType, string> = {
  flat: "Flat",
  sloped: "Sloped",
  vaulted: "Vaulted",
};

/** Base (floor-standing) vs wall (upper) cabinets — they differ in depth and in how they're drawn. */
export type CabinetTier = "base" | "wall" | "full";

/**
 * Does this cabinet stand on the floor?
 *
 * A pantry or a broom cupboard occupies floor and floor perimeter exactly as a base run does — the
 * only thing that sets it apart is that it keeps going up. Every `tier === "base"` test in the code
 * was really asking this question, and answering it with an equality check quietly excluded the
 * full-height tier the day it arrived.
 */
export function standsOnFloor(tier: CabinetTier): boolean {
  return tier !== "wall";
}

export const CABINET_TIER_LABEL: Record<CabinetTier, string> = {
  base: "Lower / base",
  wall: "Upper / wall",
  full: "Full height",
};

/**
 * Standard cabinet depths. 24" base and 12" wall are the North American norms; both are editable
 * per cabinet, since real kitchens are full of exceptions (a 15" upper over a fridge, a shallow
 * peninsula).
 */
export const CABINET_DEFAULT_DEPTH_FEET: Record<CabinetTier, number> = {
  base: 2,
  wall: 1,
  // A pantry or utility cupboard is built on a base carcass, so it comes out the same 24".
  full: 2,
};

/** Standard cabinet heights: 36" to the counter, 30" for a wall box. Both editable. */
export const CABINET_DEFAULT_HEIGHT_FEET: Record<CabinetTier, number> = {
  base: 3,
  wall: 2.5,
  full: 6,
};

/** Default fixture height, used for the wall deduction on the built-in ones. */
export const FIXTURE_DEFAULT_HEIGHT_FEET: Record<FixtureType, number> = {
  toilet: 2.5,
  sink: 2.75,
  shower: 6,
  tub: 1.5,
  fridge: 6,
  range: 3,
  dishwasher: 2.9,
};

/** Ceilings are 8' unless told otherwise, which is the overwhelming majority of what gets scoped. */
export const DEFAULT_CEILING_HEIGHT_FEET = 8;

/** Standard residential stair dimensions, all editable per flight. */
export const STAIRS_DEFAULT = {
  /** Run along the wall. Roughly thirteen 10.5" treads, which is what an 8' ceiling needs. */
  runFeet: 11,
  /** Stair width, projecting into the room. 3'0" is the usual minimum. */
  widthFeet: 3,
  /** Tread depth, front to back. */
  treadDepthFeet: 10.5 / 12,
};

/**
 * Added to a room's ceiling height to get the floor-to-floor rise a flight has to climb.
 *
 * The stairs do not stop at the ceiling — they carry on through the floor structure above it. A foot
 * covers joists plus subfloor and finish on ordinary residential framing, so an 8' ceiling gives a
 * 9'0" rise, which is what produces a believable tread count without anyone measuring a stairwell.
 */
export const FLOOR_STRUCTURE_FEET = 1;

interface SymbolBase {
  id: string;
  /**
   * Which wall it sits on, as that wall's stable id (the id of its start vertex). An index would
   * break the moment a vertex was inserted earlier in the ring. Changing walls means deleting and
   * re-placing — see `moveSymbolAlongWall`.
   */
  wallId: string;
  /**
   * Centre of the symbol along its wall, 0–1 from the wall's start corner. A fraction rather than
   * a pixel offset so a symbol stays put when the room is resized.
   */
  t: number;
  /** Share of the wall's length. Authoritative only while the room has no scale — see the header. */
  widthFraction: number;
  /** Real width. Authoritative once the room is scaled; null before that. */
  widthFeet: number | null;
}

export interface DoorSymbol extends SymbolBase {
  type: "door";
  doorType: DoorType;
  leaves: DoorLeaves;
  /**
   * Head height of the opening — the top of the door or of the cased opening.
   *
   * Every door type has one, but it matters most for `doorType: "opening"`: a missing wall or a
   * cased opening between two rooms is described by nothing else. A standard door is 6'8" and is
   * rarely worth changing; an opening is whatever the wall was cut to and often is not.
   */
  heightFeet: number;
  /**
   * Orientation, as two mirrors in WORLD space: flip the glyph horizontally, flip it vertically.
   *
   * These replaced a "hand" (left/right) and a "swing" (into/out of room) pair, both of which were
   * wrong in ways worth recording:
   *
   *  - "Left hand" was a lie on three walls out of four. Hand was stored in the wall's own local
   *    frame, which runs clockwise around the room, so local-left is screen-left only on the top
   *    wall. The label said left and the door hinged on the right.
   *  - "Into/out of room" has no meaning once rooms connect. Out of one room is into the next, and
   *    the phrasing would have had to be rewritten the moment multi-room sketching lands.
   *
   * A pair of world-space mirrors is true on every wall and stays true when rooms are joined. Which
   * property a given flip changes depends on the wall's orientation — see `doorOrientation` — which
   * is exactly right: flipping a door on a side wall horizontally moves its swing, not its hinge.
   */
  flipX: boolean;
  flipY: boolean;
}

export interface WindowSymbol extends SymbolBase {
  type: "window";
  /** Height of the glazed opening. Elevation data — it doesn't affect the plan view, it's output. */
  heightFeet: number | null;
  /** Sill height: how far up from the finished floor the opening starts. */
  sillFeet: number | null;
}

export interface CabinetSymbol extends SymbolBase {
  type: "cabinet";
  label: string;
  tier: CabinetTier;
  /** How far it projects from the wall into the room. */
  depthFeet: number;
  /**
   * How tall it is. Only used for the wall-area deduction — a cabinet hides width x height of wall
   * finish behind it, and without a height that deduction can't be calculated at all.
   */
  heightFeet: number;
}

export interface FixtureSymbol extends SymbolBase {
  type: "fixture";
  fixtureType: FixtureType;
  label: string;
  /** How far it projects from the wall into the room. */
  depthFeet: number;
  /** Used for the wall-area deduction, and only meaningful for the built-in fixtures. */
  heightFeet: number;
  /** Shower only. A corner unit is drawn with its front corner cut off. */
  showerShape: ShowerShape;
}

export type SketchSymbol = DoorSymbol | WindowSymbol | CabinetSymbol | FixtureSymbol;

/**
 * A flight of stairs. Attached to a ROOM, not placed on a wall.
 *
 * Stairs were first built as a wall symbol, and that was the wrong shape for them. A staircase is a
 * space, not a fitting: it has its own floor, its own walls, its own ceiling — one that climbs with
 * the treads — and it belongs nowhere near the wall-symbol machinery that governs where a door sits
 * along a wall.
 *
 * As a room it gets everything for free and correctly: place it anywhere rather than snapped to a
 * wall, drag its walls to set BOTH the run and the width, nest it inside another room when it sits
 * in one, and keep its quantities out of that room's.
 */
export interface StairsData {
  /** Travel direction as drawn, in degrees: 0 right, 90 down, 180 left, 270 up. */
  orientation: 0 | 90 | 180 | 270;
  /** Whether the flight climbs or descends in the direction of travel. */
  direction: "up" | "down";
  /** Depth of one tread, front to back. 10.5" is the common residential run. */
  treadDepthFeet: number;
  /** Total floor-to-floor rise. Null means the standard assumption — see `stairFlight`. */
  riseFeet: number | null;
}

/** Anything drawn against a wall that has a depth into the room. */
export type BlockSymbol = CabinetSymbol | FixtureSymbol;

export function isBlockSymbol(symbol: SketchSymbol): symbol is BlockSymbol {
  return symbol.type === "cabinet" || symbol.type === "fixture";
}

/** Does this symbol cover the wall and floor behind it, for deduction purposes? */
export function isDeductible(symbol: SketchSymbol): boolean {
  if (symbol.type === "cabinet") return true;
  return symbol.type === "fixture" && FIXTURE_IS_BUILT_IN[symbol.fixtureType];
}

/**
 * A cabinet standing in open floor — an island, a peninsula, a free-standing unit.
 *
 * Deliberately a separate type from the wall-mounted `CabinetSymbol` rather than a nullable `wall`
 * on it. Everything about a wall symbol is expressed relative to its wall (a fraction along it, a
 * width as a share of it, a local frame rotated to it); an island has no wall to be relative to, so
 * folding the two together would mean every one of those fields becoming conditional. Two clear
 * types beat one type with a mode flag threaded through all of its geometry.
 *
 * Position is an offset from the room's top-left in world pixels, so an island travels with its
 * room when the room is moved, and stays put when the room is resized from a far corner.
 */
export interface FreeCabinet {
  id: string;
  /** Top-left of the block, as an offset from the room's bounding-box top-left, in world pixels. */
  x: number;
  y: number;
  /** Drawn size while the room has no scale — the same fallback role `widthFraction` plays for wall symbols. */
  widthPx: number;
  depthPx: number;
  /** Authoritative once the room is scaled. */
  widthFeet: number | null;
  depthFeet: number | null;
  label: string;
  tier: CabinetTier;
}

export interface SketchRoom {
  id: string;
  /**
   * Which storey this room is drawn on. 0 is the main level, negative is below it, positive above.
   *
   * A number rather than a name because the only thing the geometry needs from a level is its ORDER
   * — which one is under which, so the right one can be shown as a tracing underlay. Names are a
   * presentation concern and live in `levelLabel`.
   *
   * Optional on the type so a sketch drawn before levels existed still loads; `roomLevel` is what
   * every reader should go through, and it treats a missing level as the main one. Nothing writes
   * undefined.
   */
  level?: number;
  /**
   * Free text, but intended to match a room name already used elsewhere in the claim — see
   * `knownRoomNames`. Matching is what lets a sketch be cross-referenced with the scope later;
   * it is not enforced, because a PM may legitimately sketch a room the transcript never mentioned.
   */
  name: string;
  /**
   * The room's outline, clockwise, in world pixels. Four vertices is a rectangle; six makes an L.
   * Never fewer than three — see `MIN_VERTICES`.
   */
  vertices: Vertex[];
  /**
   * Floor-to-ceiling height. Captured here rather than derived because it's the missing input for
   * cubic-volume equipment sizing (the IICRC recommendation work deferred earlier): area comes from
   * the polygon, but volume needs this. Nothing computes with it yet.
   */
  ceilingHeightFeet: number | null;
  /**
   * Flat, or rising to a peak.
   *
   * A stairwell is the usual reason this stops being flat, which is why it arrived alongside stairs.
   * `ceilingHeightFeet` is the LOW point in every case; `ceilingPeakFeet` is the high one and is
   * ignored when the ceiling is flat.
   */
  ceilingType: CeilingType;
  ceilingPeakFeet: number | null;
  /**
   * Non-null when this "room" is a flight of stairs — see `StairsData`.
   *
   * A stair room's ceiling is not stored: it climbs with the treads, so it is worked out from the
   * rise every time it is asked for (`stairCeiling`). Setting it by hand would just be a number that
   * drifts away from the flight it is supposed to describe.
   */
  stairs: StairsData | null;
  /**
   * The room this one sits inside — a closet within a bedroom, an ensuite off a primary. Null for a
   * room standing on its own.
   *
   * Derived from geometry rather than declared: a room dragged wholly inside another becomes its
   * sub-room, and dragging it back out clears the link (see `containingRoomId`). That keeps the
   * relationship honest — it can't claim a nesting the drawing doesn't show.
   *
   * The parent's polygon still covers the sub-room's footprint. Nothing computes floor area yet, so
   * nothing is double-counted today, but any later area calculation has to subtract its children.
   */
  parentRoomId: string | null;
  /**
   * Set when the user says this room is NOT a sub-room, even though it sits inside another.
   *
   * Nesting is derived from geometry, which is right by default but wrong sometimes — a room drawn
   * inside another for want of space, or two spaces that share a footprint on the drawing but not in
   * the building. This is the override, and it survives further dragging: an explicit "no" should
   * not be undone by nudging the room a few pixels.
   */
  nestingOptOut: boolean;
  symbols: SketchSymbol[];
  /** Cabinets standing in open floor rather than against a wall — see `FreeCabinet`. */
  freeCabinets: FreeCabinet[];
}

/**
 * The viewport: how world coordinates map to the screen.
 *
 * Kept separate from the sketch data because it's a camera, not a measurement — two people looking
 * at the same sketch at different zooms are looking at the same sketch.
 *
 * This is the groundwork for connected multi-room sketching. Room coordinates are already world
 * coordinates rather than screen coordinates, and this transform is the only thing between world
 * and screen, so a later phase can lay out rooms across a large shared plane and let the user
 * navigate it without any of the geometry below changing.
 */
export interface SketchView {
  x: number;
  y: number;
  scale: number;
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 4;

export function defaultView(): SketchView {
  return { x: 0, y: 0, scale: 1 };
}

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export interface Sketch {
  rooms: SketchRoom[];
  /**
   * Storeys the PM has created, whether or not anything is drawn on them yet.
   *
   * Held separately from the rooms because a level is added BEFORE it has contents — that is the
   * whole point of adding one — and a level derived only from the rooms on it disappears the instant
   * it is created, taking the tab you just made with it. The main level is always present and is
   * never listed here.
   *
   * Optional so a sketch drawn before levels existed still loads.
   */
  levels?: number[];
}

export function emptySketch(): Sketch {
  return { rooms: [] };
}

export function hasSketchContent(sketch: Sketch): boolean {
  return sketch.rooms.length > 0;
}

/* ── Levels ─────────────────────────────────────────────────────────────────────────────────────
 *
 * A building has storeys and a claim routinely spans them: water comes through a ceiling and the
 * room above is the source. Levels are held as a number ON EACH ROOM rather than as separate room
 * arrays, so everything that already walks `sketch.rooms` — quantities, moisture, scope marks,
 * thumbnails — keeps working and keeps spanning the whole building, which is what those totals
 * should do. Only the things that are inherently about one storey filter: what is drawn, what a new
 * room joins, and what can nest inside what.
 */

export const MAIN_LEVEL = 0;

/** A room's level, treating a sketch drawn before levels existed as all-main-level. */
export function roomLevel(room: SketchRoom): number {
  return room.level ?? MAIN_LEVEL;
}

/**
 * Every level that exists, lowest first. Always includes the main level, even on an empty sketch.
 *
 * The union of levels the PM created and levels rooms actually sit on. The second half matters for
 * a sketch saved before `levels` existed, and as a guard: a room can never be stranded on a storey
 * that no tab reaches.
 */
export function levelsOf(sketch: Sketch): number[] {
  const levels = new Set<number>([MAIN_LEVEL, ...(sketch.levels ?? [])]);
  for (const room of sketch.rooms) levels.add(roomLevel(room));
  return [...levels].sort((a, b) => a - b);
}

/** Records a new storey. Returns the sketch unchanged when it already has one. */
export function withLevel(sketch: Sketch, level: number): Sketch {
  if (levelsOf(sketch).includes(level)) return sketch;
  return { ...sketch, levels: [...(sketch.levels ?? []), level] };
}

export function roomsOnLevel(sketch: Sketch, level: number): SketchRoom[] {
  return sketch.rooms.filter((room) => roomLevel(room) === level);
}

/**
 * What a level is called on screen.
 *
 * Deliberately neutral about what a storey below the main one IS. "Basement" is the common case in
 * this trade and the wrong word often enough — a split level, a raised bungalow, a crawlspace — that
 * naming it here would put a guess on a document.
 */
export function levelLabel(level: number): string {
  if (level === MAIN_LEVEL) return "Main level";
  const n = Math.abs(level);
  const direction = level > 0 ? "above" : "below";
  return n === 1 ? `Level ${direction}` : `${n} levels ${direction}`;
}

/**
 * Which other level to show alongside the one being drawn.
 *
 * Below by default where there is one, because that is the direction the work usually goes: a PM
 * drawing an upper floor is placing it over rooms they have already drawn. Above is the fallback
 * rather than nothing, since seeing one other storey is more useful than an empty toggle.
 */
export function defaultUnderlayLevel(sketch: Sketch, active: number): number | null {
  const levels = levelsOf(sketch);
  const below = levels.filter((l) => l < active).pop();
  if (below !== undefined) return below;
  const above = levels.find((l) => l > active);
  return above ?? null;
}


let idCounter = 0;
/** Client-only ids for React keys and lookup. Never leave the browser. */
export function newSketchId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

/**
 * Renders decimal feet as feet and inches — 12.5 → `12'6"`.
 *
 * Inches are rounded to the nearest whole inch, which is the precision a tape measure is read to on
 * site; carrying fractions of an inch through would imply an accuracy the input doesn't have. The
 * 12-inch carry is handled explicitly because rounding 11.6" up to 12" must become the next foot,
 * not `12'12"`.
 */
export function formatFeetInches(feet: number): string {
  if (!Number.isFinite(feet) || feet < 0) return "—";

  let wholeFeet = Math.floor(feet);
  let inches = Math.round((feet - wholeFeet) * 12);
  if (inches === 12) {
    wholeFeet += 1;
    inches = 0;
  }
  return inches === 0 ? `${wholeFeet}'` : `${wholeFeet}'${inches}"`;
}

/**
 * Renders a small dimension in inches rather than feet-and-inches.
 *
 * A stair riser is talked about as 7¾", never as 0'7¾" — the feet-and-inches form reads as though
 * someone forgot to finish the number. Anything a foot or over falls back to the usual format.
 */
export function formatSmallDimension(feet: number): string {
  if (!Number.isFinite(feet) || feet < 0) return "—";
  if (feet >= 1) return formatFeetInches(feet);
  const inches = Math.round(feet * 120) / 10;
  return `${inches}"`;
}

/**
 * Parses what someone actually types for a length, in either notation:
 *
 *   12.5      12 ft 6 in     12'6"     12' 6"     12-6      12'      6"     12
 *
 * Returns decimal feet, or null if it can't be read as a length. Accepting both formats is a
 * requirement, not a convenience — a PM reading a tape says "twelve six", and forcing that into
 * 12.5 in the field is exactly the kind of mental arithmetic that produces 12.6 by mistake.
 *
 * A bare number is feet (`12` → 12'), because that's the unit the rest of the tool works in.
 */
export function parseFeetInches(raw: string): number | null {
  const input = raw.trim().toLowerCase();
  if (input === "") return null;

  // Feet and inches together: 12'6", 12 ft 6 in, 12-6, 12' 6
  const both = input.match(/^(\d+(?:\.\d+)?)\s*(?:'|’|ft|feet|f|-)\s*(\d+(?:\.\d+)?)\s*(?:"|”|''|in|inch|inches|i)?$/);
  if (both?.[1] && both[2]) {
    const ft = Number(both[1]);
    const inches = Number(both[2]);
    // 13 inches would mean the person meant something else; reject rather than silently normalising.
    if (!Number.isFinite(ft) || !Number.isFinite(inches) || inches >= 12) return null;
    return ft + inches / 12;
  }

  // Feet only: 12', 12 ft, 12 feet
  const feetOnly = input.match(/^(\d+(?:\.\d+)?)\s*(?:'|’|ft|feet)$/);
  if (feetOnly?.[1]) {
    const ft = Number(feetOnly[1]);
    return Number.isFinite(ft) ? ft : null;
  }

  // Inches only: 30", 30 in
  const inchesOnly = input.match(/^(\d+(?:\.\d+)?)\s*(?:"|”|''|in|inch|inches)$/);
  if (inchesOnly?.[1]) {
    const inches = Number(inchesOnly[1]);
    return Number.isFinite(inches) ? inches / 12 : null;
  }

  // Bare number — feet.
  const bare = input.match(/^(\d+(?:\.\d+)?)$/);
  if (bare?.[1]) {
    const ft = Number(bare[1]);
    return Number.isFinite(ft) ? ft : null;
  }

  return null;
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

export interface WallGeometry {
  /** Stable identity: the id of the vertex this wall starts at. */
  id: string;
  /** Position in the ring. Presentation only — never store it, it shifts when a vertex is added. */
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthPx: number;
  /** Real length in feet. Always known — the scale is a constant, so this is just `lengthPx` in
      another unit. It was nullable back when a room could exist without a scale. */
  lengthFeet: number;
  /** Direction of the wall in degrees, which is also the rotation of its local drawing frame. */
  rotation: number;
  /** True when the wall runs more horizontally than vertically — see `doorOrientation`. */
  horizontal: boolean;
}

/**
 * The room's walls, in ring order: vertex i to vertex i+1, wrapping the last back to the first.
 *
 * `rotation` is the wall's own direction, so a symbol group rotated by it gets a local frame where
 * +x runs along the wall and +y points into the room — for a clockwise polygon, at any angle. Every
 * glyph is written once against that frame and needs no per-wall special casing.
 */
export function wallsOf(room: SketchRoom): WallGeometry[] {
  const n = room.vertices.length;

  return room.vertices.map((from, index) => {
    const to = room.vertices[(index + 1) % n] as Vertex;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthPx = Math.hypot(dx, dy);
    return {
      id: from.id,
      index,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      lengthPx,
      lengthFeet: lengthPx / PIXELS_PER_FOOT,
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      horizontal: Math.abs(dx) >= Math.abs(dy),
    };
  });
}

export function wallById(room: SketchRoom, wallId: string): WallGeometry | null {
  return wallsOf(room).find((wall) => wall.id === wallId) ?? null;
}

/** A point at fraction `t` along a wall. */
export function pointOnWall(wall: WallGeometry, t: number): { x: number; y: number } {
  return { x: wall.x1 + (wall.x2 - wall.x1) * t, y: wall.y1 + (wall.y2 - wall.y1) * t };
}

/** Where along a wall a point lands, as a 0–1 fraction. */
export function tapFractionOnWall(wall: WallGeometry, px: number, py: number): number {
  const vx = wall.x2 - wall.x1;
  const vy = wall.y2 - wall.y1;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return 0.5;
  const t = ((px - wall.x1) * vx + (py - wall.y1) * vy) / lenSq;
  return Math.min(1, Math.max(0, t));
}

/**
 * The inset to actually use: what was asked for, or as much of it as the room has room for.
 *
 * The asked-for figure is in SCREEN pixels divided by zoom, so it stays a constant distance on
 * screen — which means it grows without limit in WORLD terms as the view zooms out. On a 4' closet
 * that put the mark past the middle of the room at any sensible zoom, and eventually outside it
 * altogether: the mark stopped describing a wall and started looking like a bar across the floor.
 *
 * The anchor is inside the room, so its distance from the wall stands for how much depth there is
 * to give. Half of that is the cap — far enough to stay clear of the wall line, never far enough to
 * read as the middle of the room.
 */
export function cappedInset(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  towards: { x: number; y: number },
  desired: number,
): number {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length === 0) return desired;
  const dx = (x2 - x1) / length;
  const dy = (y2 - y1) / length;
  const depth = Math.abs(-(towards.x - x1) * dy + (towards.y - y1) * dx);
  return Math.min(desired, depth * 0.5);
}

/**
 * How close two wall centrelines have to be to count as the same wall, in world pixels — so, in
 * inches. Six is generous: a closet dragged against its room's wall snaps flush and lands on zero,
 * and anything further out than half a foot is a wall of its own with a gap behind it.
 */
const SAME_WALL_TOLERANCE_PX = 6;

/**
 * The stretches of a wall that are NOT backed by a sub-room, as `[start, end]` fractions.
 *
 * A closet drawn inside a bedroom shares part of the bedroom's wall. From the bedroom that stretch
 * is not a wall you can see, touch or take a reading on — it is the closet's wall, and the closet is
 * a room in its own right with its own walls to mark. Treating the bedroom's wall as one continuous
 * run meant a single tap claimed the closet's share of it too, and then the closet's own mark had
 * nowhere to go that wasn't already claimed.
 *
 * Only genuine sub-rooms occlude. Two rooms drawn side by side share a wall along its whole length,
 * and that whole length still belongs to both of them — there is nothing to subtract. A room the PM
 * has explicitly said is NOT a sub-room (`nestingOptOut`, which clears `parentRoomId`) is likewise
 * left alone, because they have said it is not inside this one.
 *
 * Returns `[[0, 1]]` when nothing occludes, which is the overwhelmingly common case.
 */
export function exposedWallRuns(room: SketchRoom, wallId: string, rooms: SketchRoom[]): [number, number][] {
  const wall = wallById(room, wallId);
  if (!wall || wall.lengthPx <= 0) return [[0, 1]];

  const dx = (wall.x2 - wall.x1) / wall.lengthPx;
  const dy = (wall.y2 - wall.y1) / wall.lengthPx;
  /** Distance along the wall from its start, as a fraction. */
  const along = (x: number, y: number) => ((x - wall.x1) * dx + (y - wall.y1) * dy) / wall.lengthPx;
  /** Perpendicular distance from the wall's line, unsigned. */
  const across = (x: number, y: number) => Math.abs(-(x - wall.x1) * dy + (y - wall.y1) * dx);

  const covered: [number, number][] = [];
  for (const child of rooms) {
    if (child.parentRoomId !== room.id) continue;
    // Belt and braces with `containingRoomId`, which is what sets parentRoomId in the first place.
    if (roomLevel(child) !== roomLevel(room)) continue;
    for (const childWall of wallsOf(child)) {
      // Both ends on this wall's line, or it is a different wall that merely passes nearby.
      if (across(childWall.x1, childWall.y1) > SAME_WALL_TOLERANCE_PX) continue;
      if (across(childWall.x2, childWall.y2) > SAME_WALL_TOLERANCE_PX) continue;
      const a = along(childWall.x1, childWall.y1);
      const b = along(childWall.x2, childWall.y2);
      const lo = Math.max(0, Math.min(a, b));
      const hi = Math.min(1, Math.max(a, b));
      if (hi > lo) covered.push([lo, hi]);
    }
  }
  if (covered.length === 0) return [[0, 1]];

  // Merge, then take the gaps. Two closets on one wall are as ordinary as one.
  covered.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const span of covered) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }

  const free: [number, number][] = [];
  let cursor = 0;
  for (const [lo, hi] of merged) {
    if (lo - cursor > MIN_READING_RUN_FRACTION) free.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (1 - cursor > MIN_READING_RUN_FRACTION) free.push([cursor, 1]);
  return free;
}

/**
 * Shortest run worth offering as a separate stretch of wall — below this it is a sliver from a
 * closet that does not quite line up, not a piece of wall anybody would take a reading on.
 */
const MIN_READING_RUN_FRACTION = 0.02;

/** The exposed run containing `t`, or the longest one when the tap landed on a covered stretch. */
export function exposedRunAt(room: SketchRoom, wallId: string, rooms: SketchRoom[], t: number): [number, number] {
  const runs = exposedWallRuns(room, wallId, rooms);
  const hit = runs.find(([lo, hi]) => t >= lo && t <= hi);
  if (hit) return hit;
  const longest = runs.reduce<[number, number] | null>((best, run) => (best && best[1] - best[0] >= run[1] - run[0] ? best : run), null);
  return longest ?? [0, 1];
}

/**
 * Resolves a door's two world-space mirrors into what the glyph needs: which jamb carries the
 * hinge, and which side of the wall the leaf sweeps.
 *
 * A mirror in world X negates the wall's local X on a horizontal wall (moving the hinge) and its
 * local Y on a vertical one (moving the swing). World Y is the other way round. The mapping depends
 * only on the wall's orientation, which is why the same two controls make sense on every wall of
 * any polygon, at any angle.
 */
export function doorOrientation(door: DoorSymbol, room: SketchRoom): { hingeAtEnd: boolean; swingReversed: boolean } {
  const horizontal = wallById(room, door.wallId)?.horizontal ?? true;
  return {
    hingeAtEnd: horizontal ? door.flipX : door.flipY,
    swingReversed: horizontal ? door.flipY : door.flipX,
  };
}

export const MIN_ROOM_PX = 40;
/**
 * The scale of the drawing. One world pixel is one inch, for every room, always.
 *
 * A constant rather than a stored value because nothing legitimately varies it. Zoom already covers
 * every display need — a 60' run at 12 px/ft is 720 world pixels, which the camera fits to any
 * screen — so a second, per-room scale bought nothing and cost the one property that makes a plan a
 * plan: that two things drawn the same size are the same size.
 *
 * 12 is chosen so the unit is a whole inch. Dragging therefore has inch resolution, which is the
 * precision a tape is read to on site and finer than `MIN_WALL_PX` needs.
 */
export const PIXELS_PER_FOOT = 12;
export const DEFAULT_ROOM_FEET = 12;

/**
 * How thick a wall is drawn, in real feet. 4" is a 2x4 stud wall with drywall both sides — the
 * common residential interior partition, and what an estimator expects to be tracing.
 *
 * Drawn to scale rather than as a fixed pixel width because the plan is exported as an underlay
 * image: a wall that is always 4 screen pixels reads as 4" at 12 px/ft and as 1½" at 32 px/ft, so a
 * traced-over plan would come out with rooms the wrong size by however far the scale had moved.
 */
export const WALL_THICKNESS_FEET = 4 / 12;

/**
 * Wall stroke width in world pixels.
 *
 * The floor is a *screen*-space minimum, divided back out by zoom: a to-scale 4" wall at 20% zoom
 * is a third of a pixel, which antialiases away to nothing and leaves a room with no visible
 * outline. Above that threshold the true scaled thickness always wins, so the export — always
 * rendered at a zoom that fits the page — is geometrically honest.
 */
export function wallStrokePx(zoom: number): number {
  return Math.max(PIXELS_PER_FOOT * WALL_THICKNESS_FEET, 1.5 / Math.max(zoom, 0.01));
}
/** Shortest a wall may become. Below this a vertex drag is refused rather than collapsing the room. */
export const MIN_WALL_PX = 16;
/** A polygon needs three corners to enclose anything. */
export const MIN_VERTICES = 3;
/**
 * How the grab targets along a wall divide it up.
 *
 * Handles kept swallowing each other — symbol ends over symbols, island handles over islands, corner
 * handles over wall grips, the move grip over a wall grip. Every time it was patched with another
 * one-off cap, and every time a new handle appeared it happened again. This is the rule instead:
 *
 *   the two corners own the outer THIRD of a wall each; the grip owns the middle third.
 *
 * Because the shares are fixed fractions of the wall, they can never overlap at any wall length or
 * zoom, so a wall grip cannot be squeezed out by the corners beside it. That squeeze was real: after
 * splitting a wall, the halves left the grips a clear band as narrow as 11px, which read as the
 * handles being dead until the room was reshaped enough to widen it again.
 *
 * The values are still clamped to something a fingertip can hit, and to something smaller than the
 * ink, so a very short wall simply drops its grip (see `WallGrabHandle`) rather than offering a
 * target too small to use.
 */
export function wallHandleRadii(wallLengthPx: number, zoom: number): { corner: number; grip: number } {
  const finger = 22 / zoom;
  return {
    // No lower bound. A floor here would let a short wall's corners overrun the middle third and
    // swallow its grip again — the exact bug the partition exists to prevent. A small target the
    // user can zoom into beats a comfortable one that isn't reachable.
    corner: Math.min(finger, wallLengthPx / 3),
    // Half the middle third, so the grip's full diameter fits inside its own share.
    grip: Math.min(finger, wallLengthPx / 6),
  };
}

/**
 * Where along a wall to put its grab grip, and how much clear room it has.
 *
 * The grip used to sit at the wall's midpoint, which is exactly where people put doors. The two
 * fought, and since the grip is drawn later it won — a door in the middle of a wall became very hard
 * to select or slide.
 *
 * So the grip goes to the centre of the longest stretch of wall that no symbol is standing on. On an
 * empty wall that is still the midpoint, so nothing changes for the common case; on a wall with a
 * door in the middle it moves aside to one of the clear ends.
 *
 * Returns null when nothing on the wall is long enough to be worth aiming at — a wall completely
 * covered by cabinetry has no grip, and is pulled by its corners instead.
 */
export function wallGripSpan(room: SketchRoom, wall: WallGeometry): { t: number; clearPx: number } | null {
  const occupied: { from: number; to: number }[] = room.symbols
    .filter((s) => s.wallId === wall.id)
    .map((s) => {
      const half = symbolWidthPx(s, room) / 2;
      return { from: s.t * wall.lengthPx - half, to: s.t * wall.lengthPx + half };
    })
    .sort((a, b) => a.from - b.from);

  // Collect every clear stretch, then take the longest. Gathering first rather than tracking a
  // running best keeps this readable and sidesteps narrowing a mutable captured in a closure.
  const gaps: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const block of occupied) {
    if (block.from > cursor) gaps.push({ from: cursor, to: block.from });
    cursor = Math.max(cursor, block.to);
  }
  if (wall.lengthPx > cursor) gaps.push({ from: cursor, to: wall.lengthPx });

  let best: { t: number; clearPx: number } | null = null;
  for (const gap of gaps) {
    const clearPx = gap.to - gap.from;
    if (best === null || clearPx > best.clearPx) {
      best = { t: (gap.from + gap.to) / 2 / wall.lengthPx, clearPx };
    }
  }

  return best !== null && best.clearPx >= MIN_GRIP_WALL_PX ? best : null;
}

/**
 * Shortest wall that still gets a grip.
 *
 * This was 44px — about 3'8" at the default scale — and it was the real cause of "I can see the
 * break but can't do anything with it". Splitting a wall anywhere but its exact centre leaves one
 * half shorter than that, and a wall with no grip cannot be pulled at all. Reshaping other walls
 * eventually lengthened it past the threshold, which is why it seemed to start working after a
 * while.
 *
 * Now low enough that every wall worth drawing has a grip. Short walls get a small one; zooming in
 * makes it bigger on screen, because the finger-sized cap is in screen pixels while the wall's third
 * is in world pixels.
 */
export const MIN_GRIP_WALL_PX = 12;

/** How close, in world pixels, a dragged vertex must be to another to latch onto its axis. */
export const SNAP_PX = 12;
/**
 * The same idea for whole rooms, but wider.
 *
 * A room is a big object dragged with a whole hand, not a point placed with a fingertip, and 12px
 * proved too tight to feel — rooms just slid past each other and overlapped. This is generous enough
 * to catch, and it now applies on every frame of the drag rather than only on release, so the room
 * visibly latches instead of jumping at the end.
 */
export const ROOM_SNAP_PX = 22;

/**
 * Where to put a room's name so it stays inside the room.
 *
 * The bounding-box centre was wrong the moment rooms stopped being rectangles: on an L it lands in
 * the notch, which is outside the floor, and the title drifted off the shape entirely while walls
 * were being dragged.
 *
 * This picks the interior point furthest from any wall — a coarse pole of inaccessibility. On a
 * rectangle that is exactly the centre, so nothing changes for the common case; on an L it settles
 * into the fat part of the shape. The grid is deliberately small: this runs on every frame of a
 * drag, and a label a pixel or two off centre is not worth the arithmetic.
 */
export function roomLabelAnchor(room: SketchRoom): { x: number; y: number } {
  const b = roomBounds(room);
  const centre = { x: b.minX + b.width / 2, y: b.minY + b.height / 2 };
  if (isInsideRoom(room, centre.x, centre.y)) return centre;

  const STEPS = 12;
  let best: { x: number; y: number; clearance: number } | null = null;

  for (let i = 1; i < STEPS; i++) {
    for (let j = 1; j < STEPS; j++) {
      const x = b.minX + (b.width * i) / STEPS;
      const y = b.minY + (b.height * j) / STEPS;
      if (!isInsideRoom(room, x, y)) continue;

      let clearance = Infinity;
      for (const wall of wallsOf(room)) {
        clearance = Math.min(clearance, distanceToSegment(x, y, wall.x1, wall.y1, wall.x2, wall.y2));
      }
      if (!best || clearance > best.clearance) best = { x, y, clearance };
    }
  }

  return best ? { x: best.x, y: best.y } : centre;
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** The axis-aligned box a room occupies. Islands and the canvas both need it. */
export function roomBounds(room: SketchRoom): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  const xs = room.vertices.map((v) => v.x);
  const ys = room.vertices.map((v) => v.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Signed area, doubled. Negative means counter-clockwise in screen space (y down). */
function signedArea(vertices: Vertex[]): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i] as Vertex;
    const b = vertices[(i + 1) % vertices.length] as Vertex;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Forces clockwise winding, which the inward-normal convention depends on.
 *
 * Without it, a polygon wound the other way would draw every door swinging out through its wall and
 * every cabinet standing outside the room.
 */
export function ensureClockwise(vertices: Vertex[]): Vertex[] {
  return signedArea(vertices) >= 0 ? vertices : [...vertices].reverse();
}

/**
 * Would this outline no longer be a room?
 *
 * Checking wall lengths alone is not enough, and that gap was a real defect: pulling a wall far
 * enough pushed it straight through the opposite wall and turned the room inside out, with every
 * wall still comfortably longer than the minimum. Once the winding flips, the inward normals point
 * outward and every door swings through a wall.
 *
 * Signed area catches it. A valid room is wound clockwise, so its area is positive; a wall dragged
 * past the far side drives it through zero and negative. The floor also rejects the sliver just
 * before the flip, which is a room in name only.
 *
 * This does not detect every self-intersection — a bow-tie with balanced lobes can keep a positive
 * area. It covers the case that actually happens when dragging.
 */
export function isDegenerate(vertices: Vertex[]): boolean {
  return signedArea(vertices) < MIN_WALL_PX * MIN_WALL_PX;
}

/**
 * Would this change collapse a wall that was fine before?
 *
 * The test is about MAKING THINGS WORSE, not about absolute length, and that distinction was the
 * whole bug behind "the wall won't move after I add a break". Pulling a wall away from a collinear
 * neighbour inserts a connector as long as the distance pulled — a few pixels on the first frame.
 * A flat "no wall may be under the minimum" check then rejected every subsequent frame, because the
 * connector was still short. The wall could never grow out of the state its own first frame created.
 *
 * So: a wall that did not exist before is fine (it is a new connector, and it grows as the pull
 * continues); a wall that was already short is fine as long as this move does not shorten it
 * further; and a healthy wall may not be driven below the minimum.
 */
export function collapsesAWall(prev: SketchRoom, next: SketchRoom): boolean {
  const before = new Map(wallsOf(prev).map((w) => [w.id, w.lengthPx]));
  return wallsOf(next).some((wall) => {
    if (wall.lengthPx >= MIN_WALL_PX) return false;
    const was = before.get(wall.id);
    if (was === undefined) return false;
    return wall.lengthPx < was - 1e-9;
  });
}

/** Is a point inside the room? Ray casting — used to keep islands on the floor of an L. */
export function isInsideRoom(room: SketchRoom, x: number, y: number): boolean {
  let inside = false;
  const vs = room.vertices;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const a = vs[i] as Vertex;
    const b = vs[j] as Vertex;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The four corners of a rectangle, clockwise — the shape every new room starts as. */
export function rectangleVertices(x: number, y: number, width: number, height: number): Vertex[] {
  return [
    { id: newSketchId("v"), x, y },
    { id: newSketchId("v"), x: x + width, y },
    { id: newSketchId("v"), x: x + width, y: y + height },
    { id: newSketchId("v"), x, y: y + height },
  ];
}

/** Slides the whole room. Islands are stored relative to the bounds, so they come along. */
export function translateRoom(room: SketchRoom, dx: number, dy: number): SketchRoom {
  return { ...room, vertices: room.vertices.map((v) => ({ ...v, x: v.x + dx, y: v.y + dy })) };
}

/**
 * Moves one vertex.
 *
 * SNAPPING EXCLUDES THE VERTICES THAT MOVE WITH IT. On a rectangle the dragged corner's two
 * neighbours share its own x and its own y, so snapping against them latched every drag straight
 * back to where it started: nothing moved until the finger passed the threshold, then it jumped,
 * then it re-pinned. The tool was unusable for setting a size by eye. Excluding whatever propagation
 * carries along leaves only vertices the corner can meaningfully line up with.
 *
 * PROPAGATION applies only to a four-vertex room, where the two axis-aligned neighbours are carried
 * along on the axis each shares — which is what keeps a dragged rectangle a rectangle, with the
 * opposite corner pinned. Past four vertices it is off: on an L, carrying the neighbours along drags
 * one onto the corner being moved and collapses a wall.
 *
 * For reshaping into an L, prefer `dragWall` — pulling a wall segment sideways is the interaction
 * that keeps everything square without the user aiming at a single point.
 *
 * The move is refused outright if it would shorten any wall past MIN_WALL_PX, rather than partially
 * applied: a drag that sticks reads as a limit, a drag that half-moves reads as a bug.
 */
export function moveVertex(room: SketchRoom, vertexId: string, x: number, y: number): SketchRoom {
  const index = room.vertices.findIndex((v) => v.id === vertexId);
  if (index < 0) return room;

  const n = room.vertices.length;
  const current = room.vertices[index] as Vertex;
  const prev = room.vertices[(index - 1 + n) % n] as Vertex;
  const next = room.vertices[(index + 1) % n] as Vertex;

  const nearly = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const prevHorizontal = nearly(prev.y, current.y);
  const prevVertical = nearly(prev.x, current.x);
  const nextHorizontal = nearly(next.y, current.y);
  const nextVertical = nearly(next.x, current.x);
  const propagate = room.vertices.length === 4;

  // Anything that travels with the dragged vertex is not something it can line up against.
  const glued = new Set<string>([vertexId]);
  if (propagate) {
    glued.add(prev.id);
    glued.add(next.id);
  }

  let sx = x;
  let sy = y;
  let bestX = SNAP_PX;
  let bestY = SNAP_PX;
  for (const other of room.vertices) {
    if (glued.has(other.id)) continue;
    if (Math.abs(other.x - x) < bestX) {
      bestX = Math.abs(other.x - x);
      sx = other.x;
    }
    if (Math.abs(other.y - y) < bestY) {
      bestY = Math.abs(other.y - y);
      sy = other.y;
    }
  }

  const moved = room.vertices.map((v) => {
    if (v.id === vertexId) return { ...v, x: sx, y: sy };
    if (!propagate) return v;
    if (v.id === prev.id) return { ...v, x: prevVertical ? sx : v.x, y: prevHorizontal ? sy : v.y };
    if (v.id === next.id) return { ...v, x: nextVertical ? sx : v.x, y: nextHorizontal ? sy : v.y };
    return v;
  });

  const candidate: SketchRoom = { ...room, vertices: moved };
  if (isDegenerate(moved) || collapsesAWall(room, candidate)) return room;

  return reflowContents(room, candidate);
}

/** Perpendicular unit vector of a wall, pointing into the room (clockwise winding). */
function wallNormal(wall: WallGeometry): { x: number; y: number } {
  const len = wall.lengthPx || 1;
  return { x: -(wall.y2 - wall.y1) / len, y: (wall.x2 - wall.x1) / len };
}

/** Are two consecutive walls part of one straight run? */
function collinear(a: WallGeometry, b: WallGeometry): boolean {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  const cross = ax * by - ay * bx;
  // Normalised, so the tolerance means "within about half a degree" at any wall length.
  return Math.abs(cross) / ((a.lengthPx || 1) * (b.lengthPx || 1)) < 0.01;
}

/**
 * Slides a whole wall sideways — the move that actually shapes a room, and the one an estimator
 * expects from a sketching tool.
 *
 * Dragging a wall rather than a corner is what makes rectilinear editing work. Pull the top wall of
 * a rectangle and the room simply gets shorter, still a rectangle. Split a wall first and pull one
 * half, and this inserts the two connecting corners for you, so the step comes out square without
 * anyone aiming at a vertex. That is the L-shape flow: add a break, pull it.
 *
 * Only the perpendicular component of the drag is used. Sliding a wall along its own line moves
 * nothing and would just add jitter, so the parallel component is projected away.
 *
 * ── Vertex identity ──────────────────────────────────────────────────────────────────────────
 * Ids are assigned so that walls keep the symbols standing on them. The dragged wall keeps its own
 * id (its start vertex travels). Where a connector is inserted, the STATIONARY new vertex inherits
 * the id that the far wall was keyed by, so doors and cabinets on the untouched neighbour stay on
 * the untouched neighbour instead of jumping onto the freshly created connector.
 */
export function dragWall(room: SketchRoom, wallId: string, dx: number, dy: number, snap = false): SketchRoom {
  const walls = wallsOf(room);
  const wallIndex = walls.findIndex((w) => w.id === wallId);
  const wall = walls[wallIndex];
  if (!wall || wall.lengthPx <= 0) return room;

  const normal = wallNormal(wall);
  const distance = dx * normal.x + dy * normal.y;
  if (distance === 0) return room;

  const n = room.vertices.length;
  const startIndex = room.vertices.findIndex((v) => v.id === wallId);
  if (startIndex < 0) return room;
  const endIndex = (startIndex + 1) % n;
  const startVertex = room.vertices[startIndex] as Vertex;
  const endVertex = room.vertices[endIndex] as Vertex;

  const prevWall = walls[(wallIndex - 1 + walls.length) % walls.length] as WallGeometry;
  const nextWall = walls[(wallIndex + 1) % walls.length] as WallGeometry;

  /*
    Snapping is OFF while dragging and applied once on release — see `snapWallToNeighbours`.

    Snapping every frame made a wall with a break impossible to pull. A drag reports a few pixels per
    frame, so after the first frame the wall sat 3px from the line it had just left, well inside the
    snap radius, and was pulled straight back onto it. The next frame did the same. The wall escaped
    only if one frame jumped further than the snap radius, which is why yanking it worked when easing
    it out did not.

    Per-frame snapping cannot tell "leaving this line" from "arriving at that one" — both look like a
    nearby axis. Deferring it to the end removes the ambiguity: during the drag the wall follows the
    finger, and it latches once, when the finger lifts.
  */
  let offset = distance;
  if (snap) {
    const movedStart = { x: startVertex.x + normal.x * distance, y: startVertex.y + normal.y * distance };
    const axis = Math.abs(normal.x) > Math.abs(normal.y) ? "x" : "y";
    let best = SNAP_PX;
    for (const other of room.vertices) {
      if (other.id === startVertex.id || other.id === endVertex.id) continue;
      const delta = axis === "x" ? other.x - movedStart.x : other.y - movedStart.y;
      if (Math.abs(delta) < best) {
        best = Math.abs(delta);
        offset = distance + delta / (axis === "x" ? normal.x : normal.y);
      }
    }
  }

  const shift = (v: Vertex): Vertex => ({ ...v, x: v.x + normal.x * offset, y: v.y + normal.y * offset });

  const vertices: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const v = room.vertices[i] as Vertex;

    if (i === startIndex) {
      // A straight run behind this wall needs a corner inserted where the wall used to start.
      if (collinear(prevWall, wall)) vertices.push({ id: newSketchId("v"), x: v.x, y: v.y });
      vertices.push(shift(v));
      continue;
    }

    if (i === endIndex) {
      const movedEnd = shift(v);
      if (collinear(wall, nextWall)) {
        // The stationary corner inherits this vertex's id so the NEXT wall keeps its identity, and
        // therefore keeps its symbols; the moving end takes a fresh one.
        vertices.push({ ...movedEnd, id: newSketchId("v") });
        vertices.push({ ...v });
      } else {
        vertices.push(movedEnd);
      }
      continue;
    }

    vertices.push(v);
  }

  const candidate: SketchRoom = { ...room, vertices };
  if (isDegenerate(vertices) || collapsesAWall(room, candidate)) return room;

  return reflowContents(room, candidate);
}

/**
 * Latches a wall onto the nearest aligned line, if one is within reach.
 *
 * Called when a wall drag ENDS, never during it. Moves the wall by the smallest amount that lines it
 * up with another vertex's axis, and does nothing when there is nothing close.
 */
export function snapWallToNeighbours(room: SketchRoom, wallId: string): SketchRoom {
  const wall = wallById(room, wallId);
  if (!wall || wall.lengthPx <= 0) return room;

  const index = room.vertices.findIndex((v) => v.id === wallId);
  const startVertex = room.vertices[index];
  const endVertex = room.vertices[(index + 1) % room.vertices.length];
  if (!startVertex || !endVertex) return room;

  const normal = wallNormal(wall);
  const axis = Math.abs(normal.x) > Math.abs(normal.y) ? "x" : "y";

  let best = SNAP_PX;
  let delta = 0;
  for (const other of room.vertices) {
    if (other.id === startVertex.id || other.id === endVertex.id) continue;
    const d = axis === "x" ? other.x - startVertex.x : other.y - startVertex.y;
    if (Math.abs(d) < best) {
      best = Math.abs(d);
      delta = d;
    }
  }
  if (delta === 0) return room;

  // Expressed as travel along the wall's normal, which is all `dragWall` accepts.
  const along = delta / (axis === "x" ? normal.x : normal.y);
  return dragWall(room, wallId, normal.x * along, normal.y * along);
}

/**
 * Splits a wall by dropping a vertex on it — the move that turns a plain room into an L.
 *
 * The new vertex starts exactly on the wall, so the outline doesn't change until it's dragged. Its
 * two walls are then collinear, which `moveVertex` reads as "not a corner" and so moves freely.
 *
 * Symbols already on that wall are reassigned to whichever half now contains them, with their
 * position re-expressed as a fraction of that half. Without this they would keep a fraction of a
 * wall that no longer has the same length and slide somewhere arbitrary.
 */
export function insertVertexOnWall(room: SketchRoom, wallId: string, t: number): SketchRoom {
  const wall = wallById(room, wallId);
  if (!wall) return room;

  const index = room.vertices.findIndex((v) => v.id === wallId);
  if (index < 0) return room;

  /*
    Keep both halves long enough to carry a grip.

    A flat 10% clamp let a break near the end of a long wall leave a stub too short to grab, which
    meant the break could be made and then never used. Clamping by absolute length instead
    guarantees each half is grippable whenever the wall is long enough for that to be possible at
    all, and falls back to a near-centre split when it isn't.
  */
  const minFraction = Math.min(0.45, MIN_WALL_PX / wall.lengthPx);
  const clamped = Math.min(1 - minFraction, Math.max(minFraction, t));
  const point = pointOnWall(wall, clamped);
  const inserted: Vertex = { id: newSketchId("v"), x: point.x, y: point.y };

  const vertices = [...room.vertices];
  vertices.splice(index + 1, 0, inserted);

  // The original wall keeps its id and becomes the first half; the new vertex starts the second.
  const symbols = room.symbols.map((symbol) => {
    if (symbol.wallId !== wallId) return symbol;
    return symbol.t <= clamped
      ? { ...symbol, t: Math.min(1, symbol.t / clamped) }
      : { ...symbol, wallId: inserted.id, t: Math.min(1, (symbol.t - clamped) / (1 - clamped)) };
  });

  return { ...room, vertices, symbols };
}

/**
 * Removes a vertex, merging its two walls back into one.
 *
 * Symbols on either half move onto the surviving wall, keeping their real position along it.
 * Refused when it would leave fewer than three corners, which wouldn't be a room.
 */
export function removeVertex(room: SketchRoom, vertexId: string): SketchRoom {
  if (room.vertices.length <= MIN_VERTICES) return room;
  const index = room.vertices.findIndex((v) => v.id === vertexId);
  if (index < 0) return room;

  const n = room.vertices.length;
  const prev = room.vertices[(index - 1 + n) % n] as Vertex;
  const removedWall = wallById(room, vertexId);
  const survivingWall = wallById(room, prev.id);

  const vertices = room.vertices.filter((v) => v.id !== vertexId);
  const merged: SketchRoom = { ...room, vertices };
  const mergedWall = wallById(merged, prev.id);

  if (!removedWall || !survivingWall || !mergedWall || mergedWall.lengthPx <= 0) {
    return { ...merged, symbols: room.symbols.filter((s) => s.wallId !== vertexId) };
  }

  const symbols = room.symbols.map((symbol) => {
    if (symbol.wallId === prev.id) return { ...symbol, t: (symbol.t * survivingWall.lengthPx) / mergedWall.lengthPx };
    if (symbol.wallId === vertexId) {
      const along = survivingWall.lengthPx + symbol.t * removedWall.lengthPx;
      return { ...symbol, wallId: prev.id, t: Math.min(1, along / mergedWall.lengthPx) };
    }
    return symbol;
  });

  return { ...merged, symbols };
}

/**
 * Adjusts a room drag so the room lands flush against, or lined up with, its neighbours.
 *
 * Without this two rooms simply overlap wherever they're dropped, which is neither a real floor plan
 * nor readable. Each axis is considered separately and independently, so a room can butt up against
 * one neighbour horizontally while staying aligned with a different one vertically.
 *
 * Four candidate alignments per axis: the dragged room's leading edge to the other's leading or
 * trailing edge, and the same for its trailing edge. Edge-to-edge gives rooms that share a wall
 * line; edge-to-same-edge gives rooms that line up in a row. The nearest candidate within SNAP_PX
 * wins, and if nothing is close the drag is left exactly as the finger put it.
 *
 * Snapping deliberately still applies to a room being dragged INSIDE another — a closet is usually
 * built into a corner, so latching onto the parent's walls is what you want there too.
 */
export function snapRoomTranslation(rooms: SketchRoom[], roomId: string, dx: number, dy: number): { dx: number; dy: number } {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return { dx, dy };

  const bounds = roomBounds(room);
  const moved = { minX: bounds.minX + dx, maxX: bounds.maxX + dx, minY: bounds.minY + dy, maxY: bounds.maxY + dy };

  let bestX = ROOM_SNAP_PX;
  let bestY = ROOM_SNAP_PX;
  let adjustX = 0;
  let adjustY = 0;

  for (const other of rooms) {
    if (other.id === roomId) continue;
    const o = roomBounds(other);

    for (const [mine, theirs] of [
      [moved.minX, o.minX],
      [moved.minX, o.maxX],
      [moved.maxX, o.minX],
      [moved.maxX, o.maxX],
    ]) {
      const delta = (theirs as number) - (mine as number);
      if (Math.abs(delta) < bestX) {
        bestX = Math.abs(delta);
        adjustX = delta;
      }
    }

    for (const [mine, theirs] of [
      [moved.minY, o.minY],
      [moved.minY, o.maxY],
      [moved.maxY, o.minY],
      [moved.maxY, o.maxY],
    ]) {
      const delta = (theirs as number) - (mine as number);
      if (Math.abs(delta) < bestY) {
        bestY = Math.abs(delta);
        adjustY = delta;
      }
    }
  }

  return { dx: dx + adjustX, dy: dy + adjustY };
}

/** Is every corner of `child` inside `parent`? */
export function isRoomInside(child: SketchRoom, parent: SketchRoom): boolean {
  return child.vertices.every((v) => isInsideRoom(parent, v.x, v.y));
}

/**
 * Which room, if any, this one now sits inside.
 *
 * Picks the SMALLEST container when several qualify, so a closet inside an ensuite inside a bedroom
 * reports the ensuite — the room it actually opens onto — rather than the outermost shell.
 *
 * Guards against a cycle: a room can't become the child of something already inside it.
 */
export function containingRoomId(rooms: SketchRoom[], roomId: string): string | null {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return null;

  const descendantOfRoom = (candidate: SketchRoom): boolean => {
    let cursor: SketchRoom | undefined = candidate;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.parentRoomId === roomId) return true;
      cursor = rooms.find((r) => r.id === cursor?.parentRoomId);
    }
    return false;
  };

  let best: { id: string; area: number } | null = null;
  for (const other of rooms) {
    if (other.id === roomId || descendantOfRoom(other)) continue;
    /*
      Nesting is within one storey. Two levels share a coordinate space — that is the whole point of
      the tracing underlay, an upper room drawn over the one below it — so without this a bedroom
      traced onto a basement room would be swallowed as its closet, taking its floor area out of the
      wrong room's totals.
    */
    if (roomLevel(other) !== roomLevel(room)) continue;
    if (!isRoomInside(room, other)) continue;
    const b = roomBounds(other);
    const area = b.width * b.height;
    if (!best || area < best.area) best = { id: other.id, area };
  }
  return best?.id ?? null;
}

/** Re-derives every room's parent. Cheap, and called after any move so the links can't go stale. */
export function withDerivedParents(rooms: SketchRoom[]): SketchRoom[] {
  return rooms.map((room) => {
    const parentRoomId = room.nestingOptOut ? null : containingRoomId(rooms, room.id);
    return parentRoomId === room.parentRoomId ? room : { ...room, parentRoomId };
  });
}

/**
 * Drops any corner that sits on the straight line between its neighbours.
 *
 * Double-tapping a wall adds a break, and until it's pulled the outline is unchanged — the new
 * corner is exactly collinear with the two beside it. If the user never uses it, it lingers as an
 * invisible extra vertex that splits the wall's measurement in two and clutters the summary. This is
 * called when a room is deselected, so an unused break simply disappears when you click away, while
 * one you actually pulled is no longer collinear and stays.
 *
 * Symbols are carried across by `removeVertex`, which merges the two halves and keeps each one's
 * real position along the joined wall.
 */
export function pruneCollinearVertices(room: SketchRoom): SketchRoom {
  let result = room;
  let changed = true;

  while (changed && result.vertices.length > MIN_VERTICES) {
    changed = false;
    const walls = wallsOf(result);
    for (let i = 0; i < walls.length; i++) {
      const incoming = walls[(i - 1 + walls.length) % walls.length] as WallGeometry;
      const outgoing = walls[i] as WallGeometry;
      if (!collinear(incoming, outgoing)) continue;
      const merged = removeVertex(result, outgoing.id);
      if (merged !== result) {
        result = merged;
        changed = true;
        break;
      }
    }
  }

  return result;
}

/**
 * Repositions a room's contents after its outline changes, anchoring each item to whichever edge it
 * was nearest.
 *
 * Without this, a symbol's position is a fraction of its wall, so shortening a wall slides
 * everything on it proportionally: a cabinet run built into a corner drifts away from that corner,
 * and one near the far end is pushed straight through the wall. Both were reported from real use.
 *
 * Anchoring to the nearer edge is what makes a corner hold. A cabinet flush to a corner has a gap of
 * zero, and zero is preserved exactly, so it stays flush however far the room is reshaped. An item
 * in open wall keeps its real distance from the nearer corner instead of its share of the wall,
 * which is the measurement a PM actually took.
 *
 * A symbol wider than its shortened wall is narrowed to fit. That loses the original width, but the
 * alternative is reporting a 6' cabinet on a 4' wall.
 */
export function reflowContents(prev: SketchRoom, next: SketchRoom): SketchRoom {
  const symbols = next.symbols.map((symbol) => {
    const before = wallById(prev, symbol.wallId);
    const after = wallById(next, symbol.wallId);
    if (!before || !after || before.lengthPx <= 0 || after.lengthPx <= 0 || before.lengthPx === after.lengthPx) return symbol;

    let widthPx = symbolWidthPx(symbol, prev);
    let resized = symbol;
    if (widthPx > after.lengthPx) {
      widthPx = after.lengthPx;
      resized = withSymbolWidthPx(symbol, next, widthPx);
    }

    const centreBefore = symbol.t * before.lengthPx;
    const startGap = centreBefore - widthPx / 2;
    const endGap = before.lengthPx - (centreBefore + widthPx / 2);
    // Ties go to the start corner, which keeps a symbol centred on a short wall from jittering.
    const centreAfter = startGap <= endGap ? startGap + widthPx / 2 : after.lengthPx - endGap - widthPx / 2;

    return moveSymbolAlongWall(resized, next, centreAfter);
  });

  const beforeBounds = roomBounds(prev);
  const afterBounds = roomBounds(next);
  const freeCabinets = next.freeCabinets.map((cabinet) => {
    const size = freeCabinetSizePx(cabinet, next);
    // Each axis anchors independently, so an island tucked into a corner holds both edges while one
    // sitting mid-floor keeps its distance from whichever side it was closer to.
    const anchor = (pos: number, extent: number, beforeLen: number, afterLen: number) => {
      const startGap = pos;
      const endGap = beforeLen - (pos + extent);
      return startGap <= endGap ? startGap : afterLen - endGap - extent;
    };
    const moved = {
      ...cabinet,
      x: anchor(cabinet.x, size.width, beforeBounds.width, afterBounds.width),
      y: anchor(cabinet.y, size.depth, beforeBounds.height, afterBounds.height),
    };
    return moveFreeCabinet(moved, next, moved.x, moved.y);
  });

  return { ...next, symbols, freeCabinets };
}

// ---------------------------------------------------------------------------------------------
// Symbol sizing
// ---------------------------------------------------------------------------------------------

/**
 * Real-world defaults for a newly placed symbol, in feet. 2'6" is the common interior door in the
 * housing stock these claims come from; 3'0" is an exterior or accessible width and is the
 * exception, so it isn't the default.
 */
export const DEFAULT_WIDTH_FEET: Record<SymbolType, number> = { door: 2.5, window: 3, cabinet: 3, fixture: 2.5 };
/**
 * A symbol's share of its wall.
 *
 * Vestigial: it was the size field for a room that had no scale, back when a room could exist
 * without one. Every symbol now gets a real `widthFeet` the moment it is created, so this is only
 * ever the seed value in `newSymbol` and is never read back. Kept because it is stored on symbols
 * already and removing it buys nothing.
 */
const DEFAULT_WIDTH_FRACTION: Record<SymbolType, number> = { door: 0.2, window: 0.24, cabinet: 0.3, fixture: 0.25 };

export const DEFAULT_WINDOW_HEIGHT_FEET = 4;
export const DEFAULT_WINDOW_SILL_FEET = 3;

/** How wide the symbol is drawn, in world pixels. Resolves which size field is authoritative. */
export function symbolWidthPx(symbol: SketchSymbol, room: SketchRoom): number {
  if (symbol.widthFeet != null) return Math.max(6, symbol.widthFeet * PIXELS_PER_FOOT);
  const wall = wallById(room, symbol.wallId);
  return Math.max(6, symbol.widthFraction * (wall?.lengthPx ?? 0));
}

/** How deep a cabinet is drawn, in world pixels. */
export function cabinetDepthPx(block: BlockSymbol): number {
  return Math.max(6, block.depthFeet * PIXELS_PER_FOOT);
}

/** The symbol's real width, or null when the room has no scale to measure it against. */
export function symbolWidthFeet(symbol: SketchSymbol, room: SketchRoom): number | null {
  if (symbol.widthFeet != null) return symbol.widthFeet;
  const wall = wallById(room, symbol.wallId);
  return wall?.lengthFeet == null ? null : symbol.widthFraction * wall.lengthFeet;
}

/**
 * Wall area lost to the doors, cased openings and windows on one wall, in square feet.
 *
 * Unlike a cabinet, which stands against a wall that is still there behind it, a doorway is an
 * absence of wall — nothing hangs, tapes, floats or paints across it, and the same is true of the
 * glass in a window. That is a fact about the building rather than a scoping choice, which is why
 * the toggle governing it starts on rather than off like the cabinetry ones.
 *
 * A window with no height recorded contributes nothing rather than a guess: the field is editable
 * and blank means unknown, and inventing a height here would put a number nobody entered into a
 * figure someone estimates from.
 *
 * The height is clamped to the ceiling, so an opening typed taller than the room it is in cannot
 * deduct more wall than the wall has.
 */
export function openingSquareFeetOnWall(room: SketchRoom, wallId: string): number {
  const ceiling = room.ceilingHeightFeet ?? DEFAULT_CEILING_HEIGHT_FEET;
  return room.symbols.reduce((sum, symbol) => {
    if (symbol.wallId !== wallId) return sum;
    const height = symbol.type === "door" ? symbol.heightFeet : symbol.type === "window" ? symbol.heightFeet : null;
    if (height == null) return sum;
    const width = symbolWidthFeet(symbol, room);
    if (width == null) return sum;
    return sum + width * Math.min(height, ceiling);
  }, 0);
}

/** The same across every wall of a room. */
export function openingSquareFeet(room: SketchRoom): number {
  return wallsOf(room).reduce((sum, wall) => sum + openingSquareFeetOnWall(room, wall.id), 0);
}

/**
 * Writes a new drawn width back to whichever field is authoritative — feet once the room is
 * scaled, fraction before that. Keeping this in one place is what stops a dragged handle writing
 * to the field that isn't being read.
 */
export function withSymbolWidthPx(symbol: SketchSymbol, room: SketchRoom, widthPx: number): SketchSymbol {
  return { ...symbol, widthFeet: Math.max(0.25, widthPx / PIXELS_PER_FOOT) };
}

/** Default island footprint: a 6' x 3' block, the usual kitchen island. */
export const FREE_CABINET_DEFAULT_FEET = { width: 6, depth: 3 };

/** An island's drawn footprint, resolving which size fields are authoritative. */
export function freeCabinetSizePx(cabinet: FreeCabinet, room: SketchRoom): { width: number; depth: number } {
  if (cabinet.widthFeet != null && cabinet.depthFeet != null) {
    return { width: Math.max(8, cabinet.widthFeet * PIXELS_PER_FOOT), depth: Math.max(8, cabinet.depthFeet * PIXELS_PER_FOOT) };
  }
  return { width: Math.max(8, cabinet.widthPx), depth: Math.max(8, cabinet.depthPx) };
}

/** Writes a new drawn footprint back to whichever fields are authoritative. */
export function withFreeCabinetSizePx(cabinet: FreeCabinet, room: SketchRoom, widthPx: number, depthPx: number): FreeCabinet {
  const width = Math.max(8, widthPx);
  const depth = Math.max(8, depthPx);
  return { ...cabinet, widthPx: width, depthPx: depth, widthFeet: width / PIXELS_PER_FOOT, depthFeet: depth / PIXELS_PER_FOOT };
}

/**
 * Moves an island, keeping the whole block inside its room.
 *
 * An island is free of any wall but not free of the room: a block sitting half outside the walls
 * isn't a sketch of anything real, and it would report a position the room can't contain.
 */
export function moveFreeCabinet(cabinet: FreeCabinet, room: SketchRoom, x: number, y: number): FreeCabinet {
  const { width, depth } = freeCabinetSizePx(cabinet, room);
  const bounds = roomBounds(room);
  const clamped = {
    ...cabinet,
    x: Math.min(Math.max(0, x), Math.max(0, bounds.width - width)),
    y: Math.min(Math.max(0, y), Math.max(0, bounds.height - depth)),
  };

  // The bounding box of an L includes the notch, which isn't floor. Keeping the block's centre
  // inside the actual polygon stops an island being parked in the missing corner. Only the centre
  // is tested: requiring all four corners would make an island hugging an inside corner unplaceable.
  const centreX = bounds.minX + clamped.x + width / 2;
  const centreY = bounds.minY + clamped.y + depth / 2;
  return isInsideRoom(room, centreX, centreY) ? clamped : cabinet;
}

export function newFreeCabinet(room: SketchRoom, x: number, y: number): FreeCabinet {
  const cabinet: FreeCabinet = {
    id: newSketchId("island"),
    x: 0,
    y: 0,
    widthPx: FREE_CABINET_DEFAULT_FEET.width * PIXELS_PER_FOOT,
    depthPx: FREE_CABINET_DEFAULT_FEET.depth * PIXELS_PER_FOOT,
    widthFeet: FREE_CABINET_DEFAULT_FEET.width,
    depthFeet: FREE_CABINET_DEFAULT_FEET.depth,
    label: "Island",
    tier: "base",
  };
  const size = freeCabinetSizePx(cabinet, room);
  // Drop it centred on the tap rather than with its corner there.
  return moveFreeCabinet(cabinet, room, x - size.width / 2, y - size.depth / 2);
}

/** Slides a symbol along its own wall. Deliberately cannot move it to a different wall. */
export function moveSymbolAlongWall(symbol: SketchSymbol, room: SketchRoom, centrePx: number): SketchSymbol {
  const wall = wallById(room, symbol.wallId);
  if (!wall || wall.lengthPx <= 0) return { ...symbol, t: 0.5 };
  const half = symbolWidthPx(symbol, room) / 2;
  const clamped = Math.min(wall.lengthPx - half, Math.max(half, centrePx));
  return { ...symbol, t: clamped / wall.lengthPx };
}

/**
 * Resizes a room so one of its walls is the length you typed.
 *
 * This used to do the opposite: it kept the drawing exactly as it was and redefined what a pixel
 * meant to THAT ROOM, so a wall drawn 144px and called 12' made the room 12 px/ft while its
 * neighbour drawn the same and called 20' became 7.2 px/ft. Each room's own numbers stayed right,
 * which is why it survived so long — but two rooms drawn the same size meant different things, a
 * closet inside a bedroom bore no relation to the bedroom, and no single scale could be put on the
 * plan for an estimator to trace against.
 *
 * The scale is now fixed (`PIXELS_PER_FOOT`) and the geometry moves instead. Saying a wall is 20'
 * makes it 20' long on the drawing, which is what a person means when they say it.
 *
 * ── How the room is reshaped ────────────────────────────────────────────────────────────────
 * One of the wall's two corners is held and the other is pushed out or pulled in, by sliding the
 * wall attached to it bodily along this wall's own direction. That changes this wall's length by
 * exactly the distance travelled and leaves the rest of the outline alone.
 *
 * The corner that is held is always the one nearer the room's top-left, so a room only ever grows
 * right and down, whichever of its walls you happen to have typed a length on. Holding the wall's
 * own start corner instead would have been simpler, and it is what the first version did — but in a
 * clockwise polygon the left wall runs bottom-to-top, so setting a room's height from its left wall
 * grew it UPWARDS while setting the same height from its right wall grew it down. Consistent in the
 * code and arbitrary on the screen, which is the worse kind of consistent.
 *
 * On an L-shape the same rule reads correctly: setting the long top wall pushes the right-hand wall
 * out, taking the notch's outer leg with it, and leaves the notch where it is relative to the left.
 *
 * Two walls of a rectangle share a pixel length, so setting one sets its opposite too. Entering a
 * different length on the opposite wall afterwards simply corrects both — the later entry wins,
 * rather than the two fighting.
 *
 * Returns the room unchanged when the request can't be honoured: a length below `MIN_WALL_PX`, or a
 * reshape that would collapse the polygon. Callers should compare the resulting wall length against
 * what was asked rather than assume it took — see `handleSubmitLength`.
 */
export function withWallLength(room: SketchRoom, wallId: string, feet: number): SketchRoom {
  const walls = wallsOf(room);
  const index = walls.findIndex((w) => w.id === wallId);
  const wall = walls[index];
  if (!wall || feet <= 0 || wall.lengthPx <= 0) return room;

  const targetPx = feet * PIXELS_PER_FOOT;
  if (targetPx < MIN_WALL_PX) return room;
  const delta = targetPx - wall.lengthPx;
  // Below a tenth of an inch there is nothing to do, and asking `dragWall` to move by ~0 would
  // churn vertex ids for no reason.
  if (Math.abs(delta) < 0.1) return room;

  // Along this wall, pointing from its start corner to its end corner.
  const u = { x: (wall.x2 - wall.x1) / wall.lengthPx, y: (wall.y2 - wall.y1) / wall.lengthPx };

  /*
    Hold whichever end is nearer the top-left of the room, and move the wall hanging off the other.
    `x + y` from the bounding-box corner ranks them: for a horizontal wall that is just its x, for a
    vertical wall just its y, which is the comparison being made in each case anyway.
  */
  const bounds = roomBounds(room);
  const corner = (x: number, y: number) => x - bounds.minX + (y - bounds.minY);
  const holdStart = corner(wall.x1, wall.y1) <= corner(wall.x2, wall.y2);

  const moving = holdStart ? walls[(index + 1) % walls.length] : walls[(index - 1 + walls.length) % walls.length];
  if (!moving || moving.lengthPx <= 0) return room;

  /*
    `dragWall` only moves a wall along its own normal, so the travel is expressed in those terms.

    Moving that wall by `t` along its normal `m` moves the corner it shares with this one by `t * m`,
    which changes this wall's length by `± t * (m · u)` — plus when the moving corner is this wall's
    end, minus when it is its start, since a start sliding forward along `u` shortens the wall.
    Solving for the `t` that yields `delta` stays exact even where the two walls are not square to
    each other, which a room with a dragged corner need not be. Parallel walls give no purchase at
    all, and nothing can be done with them.
  */
  const m = wallNormal(moving);
  const along = m.x * u.x + m.y * u.y;
  if (Math.abs(along) < 1e-6) return room;
  const travel = (holdStart ? delta : -delta) / along;

  // dragWall re-flows the symbols and islands for us — see `reflowContents`.
  return dragWall(room, moving.id, m.x * travel, m.y * travel);
}

export function newSymbol(type: SymbolType, wallId: string, t: number, room: SketchRoom): SketchSymbol {
  const base = {
    id: newSketchId(type),
    wallId,
    t,
    widthFraction: DEFAULT_WIDTH_FRACTION[type],
    // Real from the start — a 3'0" door, never "a fifth of this wall".
    widthFeet: DEFAULT_WIDTH_FEET[type],
  };

  const symbol: SketchSymbol =
    type === "door"
      ? { ...base, type: "door", doorType: "swing", leaves: "single", heightFeet: DEFAULT_DOOR_HEIGHT_FEET, flipX: false, flipY: false }
      : type === "window"
        ? { ...base, type: "window", heightFeet: DEFAULT_WINDOW_HEIGHT_FEET, sillFeet: DEFAULT_WINDOW_SILL_FEET }
        : type === "cabinet"
          ? {
              ...base,
              type: "cabinet",
              label: "Cabinet",
              tier: "base",
              depthFeet: CABINET_DEFAULT_DEPTH_FEET.base,
              heightFeet: CABINET_DEFAULT_HEIGHT_FEET.base,
            }
          : {
              ...base,
              type: "fixture",
              fixtureType: "toilet",
              label: "",
              depthFeet: FIXTURE_DEFAULT_FEET.toilet.depth,
              heightFeet: FIXTURE_DEFAULT_HEIGHT_FEET.toilet,
              showerShape: "rectangular",
            };

  // Keep the whole symbol on the wall even when placed near a corner.
  return moveSymbolAlongWall(symbol, room, t * (wallById(room, wallId)?.lengthPx ?? 0));
}

/**
 * Render order for a room's symbols.
 *
 * Base cabinets before wall cabinets, so an upper's dashed outline overlays the lower's solid one
 * rather than being hidden under it — the two occupy the same wall run at different heights in
 * reality, and the architectural convention is to show both.
 */
/**
 * Everything about a flight that is worked out rather than stored.
 *
 * The run is the room's own size along the direction of travel, so dragging that wall lengthens the
 * flight and more treads appear; dragging the other wall widens it. Neither number is kept twice.
 *
 * The rise defaults to a storey — a standard ceiling plus the floor structure above it — so a flight
 * is believable the moment it is placed, and the riser height falls out of rise and treads. Riser
 * height is reported because it is the number that says whether the flight is plausible: much over
 * 7.75" and no real staircase is built like that.
 */
export function stairFlight(room: SketchRoom): {
  runFeet: number | null;
  widthFeet: number | null;
  treadCount: number;
  riseFeet: number;
  riserFeet: number | null;
} {
  const stairs = room.stairs;
  const bounds = roomBounds(room);
  const horizontal = !stairs || stairs.orientation === 0 || stairs.orientation === 180;

  const runPx = horizontal ? bounds.width : bounds.height;
  const widthPx = horizontal ? bounds.height : bounds.width;
  const runFeet = runPx / PIXELS_PER_FOOT;
  const widthFeet = widthPx / PIXELS_PER_FOOT;

  const treadDepth = stairs && stairs.treadDepthFeet > 0 ? stairs.treadDepthFeet : STAIRS_DEFAULT.treadDepthFeet;
  const treadCount = runFeet == null ? 0 : Math.max(1, Math.round(runFeet / treadDepth));

  const riseFeet = stairs?.riseFeet ?? DEFAULT_CEILING_HEIGHT_FEET + FLOOR_STRUCTURE_FEET;
  // One more riser than tread: the top riser lands on the floor above, which has no tread of its own.
  const riserFeet = treadCount > 0 ? riseFeet / (treadCount + 1) : null;

  return { runFeet, widthFeet, treadCount, riseFeet, riserFeet };
}

/**
 * The ceiling over a flight, which climbs with it.
 *
 * Headroom is constant up a staircase — the ceiling runs parallel to the treads. Measured from the
 * lower floor, then, it starts at a normal ceiling height and finishes that same height above the
 * top step. So the low point is 8' and the peak is 8' plus the whole rise, and the slope of the
 * ceiling matches the slope of the stairs by construction.
 *
 * Derived rather than stored, because a stored value would drift away from the flight the moment the
 * run or rise changed.
 */
export function stairCeiling(room: SketchRoom): { lowFeet: number; peakFeet: number } {
  const low = room.ceilingHeightFeet ?? DEFAULT_CEILING_HEIGHT_FEET;
  return { lowFeet: low, peakFeet: low + stairFlight(room).riseFeet };
}

/** A stair room, sized to a standard flight, ready to be dropped on the canvas. */
export function newStairRoom(x: number, y: number): SketchRoom {
  const runPx = STAIRS_DEFAULT.runFeet * PIXELS_PER_FOOT;
  const widthPx = STAIRS_DEFAULT.widthFeet * PIXELS_PER_FOOT;
  return {
    id: newSketchId("room"),
    name: "Stairs",
    vertices: ensureClockwise(rectangleVertices(x, y, runPx, widthPx)),
    ceilingHeightFeet: DEFAULT_CEILING_HEIGHT_FEET,
    ceilingType: "sloped",
    ceilingPeakFeet: null,
    stairs: { orientation: 0, direction: "up", treadDepthFeet: STAIRS_DEFAULT.treadDepthFeet, riseFeet: null },
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
  };
}

/**
 * Turns the flight a quarter turn, keeping its footprint.
 *
 * `turns` is in quarter turns, signed — the button passes nothing and gets a clockwise turn, the
 * left arrow key passes -1. Adding 360 before the modulo keeps a negative turn in range, which the
 * bare `%` would not: -90 % 360 is -90 in JavaScript, not 270.
 */
export function rotateStairs(room: SketchRoom, turns = 1): SketchRoom {
  if (!room.stairs) return room;
  const next = ((((room.stairs.orientation + turns * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  return { ...room, stairs: { ...room.stairs, orientation: next } };
}

/** Re-sizes a fixture to its kind's standard footprint, used when the kind is chosen or changed. */
export function withFixtureType(fixture: FixtureSymbol, room: SketchRoom, fixtureType: FixtureType): FixtureSymbol {
  const size = FIXTURE_DEFAULT_FEET[fixtureType];
  const resized: FixtureSymbol = {
    ...fixture,
    fixtureType,
    depthFeet: size.depth,
    heightFeet: FIXTURE_DEFAULT_HEIGHT_FEET[fixtureType],
    widthFeet: size.width,
  };
  return moveSymbolAlongWall(resized, room, resized.t * (wallById(room, resized.wallId)?.lengthPx ?? 0)) as FixtureSymbol;
}

export function symbolsInDrawOrder(symbols: SketchSymbol[]): SketchSymbol[] {
  // Openings first, then things on the floor, then wall cabinets last so their dashed outline
  // overlays whatever shares the run.
  const rank = (s: SketchSymbol) => (s.type === "cabinet" ? (standsOnFloor(s.tier) ? 1 : 2) : s.type === "fixture" ? 1 : 0);
  return [...symbols].sort((a, b) => rank(a) - rank(b));
}

// ---------------------------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------------------------

export interface SketchWallOutput {
  /** 1-based position around the room, for a human reading the summary. */
  wall: number;
  lengthFeet: number | null;
  lengthLabel: string;
}

export interface SketchSymbolOutput {
  type: SymbolType;
  label: string;
  /** 1-based position of the wall it sits on, matching `SketchWallOutput.wall`. */
  wall: number;
  /** Distance from the wall's start corner to the symbol's centre, in feet — null with no scale. */
  offsetFeet: number | null;
  widthFeet: number | null;
  /** Door only. */
  doorType?: DoorType;
  leaves?: DoorLeaves;
  /** Doors, openings and windows all carry a head height; only a window has a sill. */
  heightFeet?: number | null;
  sillFeet?: number | null;
  /** Cabinet only. */
  tier?: CabinetTier;
  depthFeet?: number;
  /** Stairs only. */
  treadCount?: number;
  riseFeet?: number | null;
  riserFeet?: number | null;
}

/** An island reports a footprint and where it sits in the room, not a wall and an offset along it. */
export interface SketchFreeCabinetOutput {
  label: string;
  tier: CabinetTier;
  widthFeet: number | null;
  depthFeet: number | null;
  /** Distance from the room's left/top walls to the block's near corner, in feet. */
  fromLeftFeet: number | null;
  fromTopFeet: number | null;
}

export interface SketchRoomOutput {
  name: string;
  /** Name of the room this one sits inside, or null when it stands alone. */
  withinRoom: string | null;
  /** Number of walls — four for a rectangle, six for an L. */
  wallCount: number;
  ceilingHeightFeet: number | null;
  ceilingType: CeilingType;
  ceilingPeakFeet: number | null;
  /** Present only for a stair room. */
  stairs: { treadCount: number; runFeet: number | null; widthFeet: number | null; riseFeet: number; riserFeet: number | null; direction: "up" | "down" } | null;
  walls: SketchWallOutput[];
  symbols: SketchSymbolOutput[];
  freeCabinets: SketchFreeCabinetOutput[];
}

/**
 * The sketch as data rather than pixels — this is the thing the feature actually produces.
 *
 * World coordinates are deliberately excluded: they mean nothing outside the canvas that drew them,
 * and including them would invite a downstream consumer to depend on the editor's viewport.
 */
export function sketchOutput(sketch: Sketch): SketchRoomOutput[] {
  return sketch.rooms.map((room) => {
    const walls = wallsOf(room);
    const wallNumber = new Map(walls.map((wall, i) => [wall.id, i + 1]));

    const parent = room.parentRoomId ? sketch.rooms.find((r) => r.id === room.parentRoomId) : null;

    return {
    name: room.name.trim() || "Unnamed room",
    withinRoom: parent ? parent.name.trim() || "Unnamed room" : null,
    wallCount: walls.length,
    ceilingHeightFeet: room.ceilingHeightFeet == null ? null : round2(room.ceilingHeightFeet),
    ceilingType: room.stairs ? "sloped" : room.ceilingType,
    ceilingPeakFeet: room.stairs ? round2(stairCeiling(room).peakFeet) : room.ceilingPeakFeet == null ? null : round2(room.ceilingPeakFeet),
    stairs: room.stairs
      ? (() => {
          const f = stairFlight(room);
          return {
            treadCount: f.treadCount,
            runFeet: f.runFeet == null ? null : round2(f.runFeet),
            widthFeet: f.widthFeet == null ? null : round2(f.widthFeet),
            riseFeet: round2(f.riseFeet),
            riserFeet: f.riserFeet == null ? null : round2(f.riserFeet),
            direction: room.stairs.direction,
          };
        })()
      : null,
    walls: walls.map((wall, i) => ({
      wall: i + 1,
      lengthFeet: wall.lengthFeet,
      lengthLabel: wall.lengthFeet == null ? "not measured" : formatFeetInches(wall.lengthFeet),
    })),
    symbols: room.symbols.map((symbol) => {
      const wall = wallById(room, symbol.wallId);
      const width = symbolWidthFeet(symbol, room);
      const common = {
        type: symbol.type,
        wall: wallNumber.get(symbol.wallId) ?? 0,
        offsetFeet: wall?.lengthFeet == null ? null : round2(wall.lengthFeet * symbol.t),
        widthFeet: width == null ? null : round2(width),
      };

      if (symbol.type === "door") {
        const label = symbol.doorType === "opening" ? "Opening (no door)" : `${DOOR_LEAVES_LABEL[symbol.leaves]} ${DOOR_TYPE_LABEL[symbol.doorType].toLowerCase()} door`;
        return { ...common, label, doorType: symbol.doorType, leaves: symbol.leaves, heightFeet: symbol.heightFeet };
      }
      if (symbol.type === "window") {
        return { ...common, label: "Window", heightFeet: symbol.heightFeet, sillFeet: symbol.sillFeet };
      }
      if (symbol.type === "fixture") {
        const shape = symbol.fixtureType === "shower" && symbol.showerShape === "corner" ? "Corner shower" : FIXTURE_LABEL[symbol.fixtureType];
        return { ...common, label: symbol.label.trim() || shape, depthFeet: round2(symbol.depthFeet) };
      }
      return { ...common, label: symbol.label.trim() || "Cabinet", tier: symbol.tier, depthFeet: round2(symbol.depthFeet) };
    }),
    freeCabinets: room.freeCabinets.map((cabinet) => {
      return {
        label: cabinet.label.trim() || "Island",
        tier: cabinet.tier,
        widthFeet: cabinet.widthFeet == null ? null : round2(cabinet.widthFeet),
        depthFeet: cabinet.depthFeet == null ? null : round2(cabinet.depthFeet),
        fromLeftFeet: round2(cabinet.x / PIXELS_PER_FOOT),
        fromTopFeet: round2(cabinet.y / PIXELS_PER_FOOT),
      };
    }),
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A plain-text rendering of the sketch data, for the on-screen summary.
 *
 * Kept next to `sketchOutput` so the two can't drift: if a field is added to the output it should
 * show up here too, or it silently never reaches the person reading the sketch.
 */
export function sketchSummaryText(sketch: Sketch): string {
  const rooms = sketchOutput(sketch);
  if (rooms.length === 0) return "";

  return rooms
    .map((room) => {
      const shape = room.wallCount === 4 ? "" : ` (${room.wallCount}-sided)`;
      const within = room.withinRoom ? ` — inside ${room.withinRoom}` : "";
      const lines: string[] = [`${room.name}${shape}${within}`];
      if (room.ceilingHeightFeet != null) {
        const shape =
          room.ceilingType === "flat" || room.ceilingPeakFeet == null
            ? ""
            : ` to ${formatFeetInches(room.ceilingPeakFeet)} (${room.ceilingType})`;
        lines.push(`  Ceiling height — ${formatFeetInches(room.ceilingHeightFeet)}${shape}`);
      }

      if (room.stairs) {
        const s = room.stairs;
        const size = s.runFeet != null && s.widthFeet != null ? `${formatFeetInches(s.runFeet)} run x ${formatFeetInches(s.widthFeet)} wide` : "";
        lines.push(`  Flight ${s.direction} — ${s.treadCount} treads, ${size}`);
        lines.push(`  Rise ${formatFeetInches(s.riseFeet)}${s.riserFeet == null ? "" : `, ${formatSmallDimension(s.riserFeet)} risers`}`);
      }

      for (const wall of room.walls) {
        lines.push(`  Wall ${wall.wall} — ${wall.lengthLabel}`);
      }

      for (const symbol of room.symbols) {
        const where = symbol.offsetFeet == null ? `wall ${symbol.wall}` : `wall ${symbol.wall}, ${formatFeetInches(symbol.offsetFeet)} from corner`;
        const parts = [`  ${symbol.label} — ${where}`];
        if (symbol.widthFeet != null) parts.push(`${formatFeetInches(symbol.widthFeet)} wide`);
        if (symbol.type === "window") {
          if (symbol.heightFeet != null) parts.push(`${formatFeetInches(symbol.heightFeet)} high`);
          if (symbol.sillFeet != null) parts.push(`sill ${formatFeetInches(symbol.sillFeet)}`);
        }
        /*
          A door's head height is reported only when it is NOT the standard 6'8".

          For an opening it is always reported: a cased opening or a missing wall is described by
          its width and its height and nothing else, so leaving the height out would leave the
          reader guessing at half of it.
        */
        if (symbol.type === "door" && symbol.heightFeet != null) {
          const standard = Math.abs(symbol.heightFeet - DEFAULT_DOOR_HEIGHT_FEET) < 1 / 24;
          if (symbol.doorType === "opening" || !standard) parts.push(`${formatFeetInches(symbol.heightFeet)} high`);
        }
        if (symbol.type === "cabinet" && symbol.depthFeet != null) {
          parts.push(`${formatFeetInches(symbol.depthFeet)} deep`);
          if (symbol.tier) parts.push(CABINET_TIER_LABEL[symbol.tier].toLowerCase());
        }
        lines.push(parts.join(", "));
      }

      for (const island of room.freeCabinets) {
        const size = island.widthFeet == null || island.depthFeet == null ? "size not measured" : `${formatFeetInches(island.widthFeet)} x ${formatFeetInches(island.depthFeet)}`;
        const where =
          island.fromLeftFeet == null || island.fromTopFeet == null
            ? "free-standing"
            : `free-standing, ${formatFeetInches(island.fromLeftFeet)} from left wall, ${formatFeetInches(island.fromTopFeet)} from top wall`;
        lines.push(`  ${island.label} — ${where}, ${size}, ${CABINET_TIER_LABEL[island.tier].toLowerCase()}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}


// ---------------------------------------------------------------------------------------------
// Cross-referencing with the rest of the claim
// ---------------------------------------------------------------------------------------------

/**
 * Every room name already used elsewhere in this claim, de-duplicated and in a stable order.
 *
 * Offered as suggestions when naming a sketch room, so the sketch can be lined up against the scope
 * later — "Basement Bedroom" in both places rather than "Bsmt BR" in one. Suggestions only: a PM may
 * legitimately sketch a room the transcript never mentioned, so nothing here is enforced.
 *
 * Three sources because a claim names rooms in up to three different places depending on its type:
 * the extraction (a dictated walkthrough), the DGIG form (which runs before any dictation), and the
 * bric-a-brac contents form (which can be the only thing a contents-only claim has).
 */
export function knownRoomNames(sources: {
  extractionRooms?: { roomName: string }[] | null;
  dgigRooms?: { roomName: string }[] | null;
  contentsRooms?: { roomName: string }[] | null;
}): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const list of [sources.extractionRooms, sources.dgigRooms, sources.contentsRooms]) {
    for (const room of list ?? []) {
      const name = room.roomName.trim();
      if (name === "") continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }

  return names;
}
