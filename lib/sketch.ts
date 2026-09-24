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

/*
  Type-only, so nothing is imported at runtime and the cycle with sketchQuantities (which imports
  the geometry from here) never exists outside the compiler. QuantityOptions lives next door because
  that is where the deductions are worked out; it is named here because it is saved with the sketch.
*/
import type { QuantityOptions } from "./sketchQuantities";

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
   * True when the name is NOT drawn on the plan.
   *
   * Asked for from the field alongside the label pass that keeps names above fixtures: a 3' hall or
   * a closet is smaller on paper than its own name, and once the name is guaranteed to paint on top
   * it is guaranteed to cover the door swing, the wall lines, whatever the little room holds. The
   * PM decides which matters. The name itself stays — it names the room in the scope, the panel and
   * the document — only the drawing leaves it out.
   *
   * Optional on the type so a sketch saved before it existed still loads, and read through
   * `labelShown`, which treats a missing field as shown. Nothing writes undefined. Hiding is a
   * drawing choice, not data: the tap target under the name stays where it was, so a single tap
   * still selects the room and a double-tap still opens the rename — which is how a name hidden by
   * mistake is found again without the panel.
   */
  labelHidden?: boolean;
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
  /**
   * How far the ceiling travels between its low end and its high one, in feet, when the phone
   * measured it. Null for a ceiling drawn or typed here rather than scanned.
   *
   * `ceilingProfile` otherwise has to assume the slope runs the length of the room's larger
   * bounding dimension, which is the one soft number in the quantities — a shed ceiling falling
   * across a room's short side runs 11', not the 16' the bounding box suggests, and the wall and
   * ceiling areas follow that number. The phone reads the ceiling at every corner and so knows
   * which way it falls; when it says so, this is used instead of the assumption.
   */
  ceilingRunFeet?: number | null;
  /**
   * False when `ceilingHeightFeet` is the 8' default rather than something anyone measured.
   *
   * Undefined on every sketch drawn by hand, where the height is whatever the PM typed or left at
   * the default and the distinction has never been recorded. Only a scan sets it, and only a scan
   * that read nothing sets it false — see the phone's `CeilingFit`.
   */
  ceilingMeasured?: boolean;
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
   * Derived from geometry unless chosen: a room dragged wholly inside another becomes its
   * sub-room, and dragging it back out clears the link (see `containingRoomId`) — or the PM names
   * the parent outright (`chosenParentRoomId`), and then this is that room whatever the drawing
   * shows. Always read this field, never the choice: it is the one answer, however it was reached.
   *
   * A sub-room drawn INSIDE its parent shares the parent's floor: its footprint comes out of the
   * parent's floor and ceiling (`roomQuantities`) and its walls hide the stretch of the parent's
   * wall they stand on (`exposedWallRuns`). One that stands BESIDE its parent — pulled off its
   * wall, drawn behind its door — shares nothing but the wall between them, and is a sub-room for
   * grouping only. Every consumer that assumes the footprint is inside gates on `isRoomInside`.
   */
  parentRoomId: string | null;
  /**
   * The parent the PM picked from the list, when they did.
   *
   * Nesting was derived from geometry alone, so a closet pulled off a bedroom's wall, or drawn
   * beside it corner by corner, could never be the bedroom's — the control to make it one only
   * appeared for a room drawn inside another. Asked for from the field: select the room, pick its
   * parent from a dropdown of the others. This is that pick. It wins over geometry and over
   * `nestingOptOut`, survives dragging, and is ignored (not lost) while its room is missing —
   * deleted and not yet undone — or would make a loop. Optional because sketches saved before it
   * existed have no such field; absent means "nothing chosen", the same as null.
   */
  chosenParentRoomId?: string | null;
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
 * A wall drawn on its own, not as the side of a room.
 *
 * A partition that runs into a room and stops — the wing wall beside a doorway, the pony wall
 * between a kitchen and the living room, the wall alongside a stair — is a wall the PM has to
 * measure and the estimator has to finish on both faces, and a room polygon has no way to hold one:
 * every side of a polygon is a side, and a wall with a free end is not. So these are their own
 * thing on the sketch, drawn with the wall tool one corner at a time.
 *
 * An OPEN run, always. A run whose last corner lands back on its first is not a free wall with a
 * loop in it; it is a room, and the wall tool makes one (see `lib/sketchWalls.ts`). The same goes
 * for a run that starts and ends on a room's own walls — the region it cuts off becomes a sub-room
 * — and for one that meets the ends of walls already drawn to close a loop with them.
 *
 * Nothing attaches to a free wall: no doors, no cabinets, no moisture readings. The quantities it
 * carries are its two faces and two runs of base, credited to the room it stands in — see
 * `freeWallQuantities`.
 */
export interface FreeWall {
  id: string;
  /** The corners in order, two or more. Never closed — see above. */
  vertices: Vertex[];
  /** Which storey, as on a room. Optional for the same reason; read through `freeWallLevel`. */
  level?: number;
  /**
   * Height in feet, or null for full height — the ceiling of the room it stands in. A pony wall
   * is why this exists: 3'6" of wall has 3'6" of face, and no ceiling line at all.
   */
  heightFeet: number | null;
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

/**
 * As far as a fit will zoom in on its own.
 *
 * A one-room sketch would otherwise fill a phone at 4x, where a 13' wall is drawn a foot long and
 * the plan reads as a cartoon of itself. Zooming further is still one pinch away; this is only
 * about what the sketch looks like the moment it opens.
 */
export const FIT_MAX_ZOOM = 2;

/** The rectangle everything on one storey sits in, in world pixels, or null when it is empty. */
export function levelBounds(sketch: Sketch, level: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of roomsOnLevel(sketch, level)) {
    const b = roomBounds(room);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  for (const wall of freeWallsOnLevel(sketch, level)) {
    for (const vertex of wall.vertices) {
      minX = Math.min(minX, vertex.x);
      minY = Math.min(minY, vertex.y);
      maxX = Math.max(maxX, vertex.x);
      maxY = Math.max(maxY, vertex.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * The view that frames [bounds] in a canvas of [width] x [height], centred.
 *
 * A sketch used to open at the world origin whatever was drawn, which on a desktop meant a plan
 * somewhere near the top left of a large canvas and on a phone meant a corner of one room and a
 * screen of empty grid — the first thing every phone session did was pinch and drag to find the
 * drawing. Reset does the same thing rather than returning to an origin nothing is near.
 */
export function fitView(
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  width: number,
  height: number,
  pad = 24,
): SketchView {
  if (bounds === null || width <= 0 || height <= 0) return defaultView();
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const room = Math.min((width - pad * 2) / contentWidth, (height - pad * 2) / contentHeight);
  const scale = Math.min(FIT_MAX_ZOOM, clampZoom(room));
  return {
    scale,
    x: (width - contentWidth * scale) / 2 - bounds.minX * scale,
    y: (height - contentHeight * scale) / 2 - bounds.minY * scale,
  };
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
  /** Walls drawn on their own — see `FreeWall`. Optional so a sketch saved before they existed still loads. */
  freeWalls?: FreeWall[];
  /**
   * The phone scan this geometry came from, when it did — see `lib/scanInbox.ts`.
   *
   * Absent on a hand-drawn sketch and on every sketch saved before the companion existed. While the
   * fingerprint it carries still matches the drawing, the phone owns the geometry and a newer scan
   * of the same storey may replace it without asking; the first edit in the editor breaks that
   * match, and from then on a new scan is offered rather than applied.
   */
  scan?: SketchScan;
  /**
   * Which deductions this sketch's quantities apply — see `QuantityOptions` in `lib/sketchQuantities.ts`.
   *
   * SAVED WITH THE SKETCH, and that is the point of it. These were editor state until 2026-09-24:
   * transient, per-viewer, defaulting to all-off, and read by nothing but the Quantities panel. So
   * an estimator could take the cabinets out of a kitchen floor, watch the number come down, send
   * the claim, and have the scope priced off the gross floor anyway. The deduction was a readout,
   * not a decision.
   *
   * A decision that prices has to travel with the drawing. Optional so every sketch saved before
   * this loads unchanged, and absent reads as `DEFAULT_QUANTITY_OPTIONS`.
   */
  quantities?: QuantityOptions;
}

/**
 * Where a sketch's geometry came from: the scan received from the phone, and the state of the
 * drawing as it was adopted, so a later look can tell whether anyone has touched it since.
 */
export interface SketchScan {
  /** The `claim_scans` row this sketch was built from. */
  scanId: string;
  /** The phone's own id for the capture, when it sent one. */
  captureId: string | null;
  /** When the server received it (ISO 8601). */
  receivedAt: string;
  /** The storey the scan was applied to. */
  level: number;
  /** `sketchFingerprint` of the sketch as adopted — equal to the current one until somebody edits. */
  fingerprint: string;
}

export function emptySketch(): Sketch {
  return { rooms: [] };
}

export function hasSketchContent(sketch: Sketch): boolean {
  return sketch.rooms.length > 0 || freeWallsOf(sketch).length > 0;
}

/** The free walls, for a sketch saved before they existed as much as for one drawn today. */
export function freeWallsOf(sketch: Sketch): FreeWall[] {
  return sketch.freeWalls ?? [];
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
  for (const wall of freeWallsOf(sketch)) levels.add(freeWallLevel(wall));
  return [...levels].sort((a, b) => a - b);
}

/** A free wall's level — the same reading as `roomLevel`. */
export function freeWallLevel(wall: FreeWall): number {
  return wall.level ?? MAIN_LEVEL;
}

export function freeWallsOnLevel(sketch: Sketch, level: number): FreeWall[] {
  return freeWallsOf(sketch).filter((wall) => freeWallLevel(wall) === level);
}

/** The wall's straight pieces, corner to corner, each carrying the id of the corner it starts at. */
export function freeWallSegments(wall: FreeWall): WallGeometry[] {
  const segments: WallGeometry[] = [];
  for (let index = 0; index + 1 < wall.vertices.length; index++) {
    const from = wall.vertices[index] as Vertex;
    const to = wall.vertices[index + 1] as Vertex;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    segments.push({
      id: from.id,
      index,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      lengthPx: Math.hypot(dx, dy),
      lengthFeet: Math.hypot(dx, dy) / PIXELS_PER_FOOT,
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      horizontal: Math.abs(dx) >= Math.abs(dy),
    });
  }
  return segments;
}

/**
 * The room a piece of free wall stands in: the innermost room containing its middle, on its own
 * storey. Null for a wall standing clear of every room, which is drawn and measured and credited to
 * nobody.
 */
export function freeWallSegmentRoom(segment: WallGeometry, wall: FreeWall, sketch: Sketch): SketchRoom | null {
  const mx = (segment.x1 + segment.x2) / 2;
  const my = (segment.y1 + segment.y2) / 2;
  let best: SketchRoom | null = null;
  let bestArea = Infinity;
  for (const room of sketch.rooms) {
    if (roomLevel(room) !== freeWallLevel(wall)) continue;
    if (!isInsideRoom(room, mx, my)) continue;
    const b = roomBounds(room);
    const area = b.width * b.height;
    if (area < bestArea) {
      best = room;
      bestArea = area;
    }
  }
  return best;
}

/**
 * How far the free walls carrying straight on from a wall's corners reach, as fractions of the
 * wall: `lo` at or below 0 past the start corner, `hi` at or above 1 past the end, and the ids of
 * the free walls counted. A wall with nothing carrying on from it reads `{ lo: 0, hi: 1 }`.
 *
 * A free wall extends a corner when one of its ends is that corner, it lies along the wall's line,
 * and its other end is beyond the corner — not back along the wall, which would be overlap. It may
 * be followed by another in the same line from ITS far end.
 *
 * This is what makes a wall that runs on past the room's corner one wall: its label measures the
 * whole run (`wallDimensionsWithExtensions`), and a cabinet on it may stand on the extension
 * (`blockRunPx`) — the reported case was a kitchen run that stopped dead at a corner the wall did
 * not stop at.
 */
export function wallExtensionReach(room: SketchRoom, wall: WallGeometry, freeWalls: FreeWall[]): { lo: number; hi: number; absorbed: string[] } {
  if (wall.lengthPx <= 0) return { lo: 0, hi: 1, absorbed: [] };
  const along = (p: { x: number; y: number }) => ((p.x - wall.x1) * (wall.x2 - wall.x1) + (p.y - wall.y1) * (wall.y2 - wall.y1)) / (wall.lengthPx * wall.lengthPx);
  const offLine = (p: { x: number; y: number }) => Math.abs((wall.x2 - wall.x1) * (wall.y1 - p.y) - (wall.x1 - p.x) * (wall.y2 - wall.y1)) / wall.lengthPx;
  const same = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= 0.5;
  const absorbed: string[] = [];

  const reach = (corner: { x: number; y: number }, outward: -1 | 1): number => {
    let at = corner;
    let t = along(corner);
    for (let guard = 0; guard < freeWalls.length; guard++) {
      const next = freeWalls.find((w) => {
        if (freeWallLevel(w) !== roomLevel(room) || absorbed.includes(w.id) || w.vertices.length < 2) return false;
        const p = w.vertices[0] as Vertex;
        const q = w.vertices[w.vertices.length - 1] as Vertex;
        const far = same(p, at) ? q : same(q, at) ? p : null;
        return far !== null && offLine(p) <= 1.5 && offLine(q) <= 1.5 && Math.sign(along(far) - t) === outward;
      });
      if (!next) break;
      const p = next.vertices[0] as Vertex;
      const q = next.vertices[next.vertices.length - 1] as Vertex;
      at = same(p, at) ? q : p;
      t = along(at);
      absorbed.push(next.id);
    }
    return t;
  };

  const lo = Math.min(0, reach({ x: wall.x1, y: wall.y1 }, -1));
  const hi = Math.max(1, reach({ x: wall.x2, y: wall.y2 }, 1));
  return { lo, hi, absorbed };
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

/**
 * The storey the sketch opens on.
 *
 * The main level whenever anything is drawn on it — most claims are entirely on it and it is the
 * one a PM expects. Otherwise the storey the last thing was drawn on. A claim that was only a
 * basement so far, sent straight to "Level below" from the phone, opened on an empty main level
 * with the basement traced dashed underneath, and read as the sketch being missing. Rooms and
 * free walls are kept in the order they were made, so the last one is the last one worked on.
 */
export function openingLevel(sketch: Sketch): number {
  if (roomsOnLevel(sketch, MAIN_LEVEL).length > 0 || freeWallsOnLevel(sketch, MAIN_LEVEL).length > 0) return MAIN_LEVEL;
  const lastRoom = sketch.rooms[sketch.rooms.length - 1];
  if (lastRoom !== undefined) return roomLevel(lastRoom);
  const walls = freeWallsOf(sketch);
  const lastWall = walls[walls.length - 1];
  if (lastWall !== undefined) return freeWallLevel(lastWall);
  return MAIN_LEVEL;
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
    // Only a sub-room standing INSIDE this one hides any of its wall. A closet pulled off the
    // wall, made a sub-room by choice, has its near wall on the same line — from the other side,
    // where it hides nothing: this wall is still whole from in here.
    if (!isRoomInside(child, room)) continue;
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
 * One dimension label on a wall: the stretch it measures and where it sits.
 *
 * A wall with a closet standing against part of it carried one figure — the whole wall, closet and
 * all — which is the one length nobody can find with a tape. From inside the room the wall stops at
 * the closet, and from inside the closet the closet's own wall is labelled already. So a wall gets a
 * label per exposed stretch (see `exposedWallRuns`), each measuring that stretch alone and centred
 * on it; a closet part-way along leaves a figure on either side of it. This also brings the label
 * out from under a closet in the corner, which drew over the old midpoint figure and hid it.
 *
 * Where nothing is nested there is one label for the whole wall, exactly as before.
 */
export interface WallDimension {
  /** The stretch measured, as fractions of the wall. `[0, 1]` is the whole wall. */
  run: [number, number];
  /** Where the label sits: the middle of the stretch. */
  t: number;
  lengthFeet: number;
}

export function wallDimensions(room: SketchRoom, wall: WallGeometry, rooms: SketchRoom[]): WallDimension[] {
  return exposedWallRuns(room, wall.id, rooms).map((run) => ({ run, t: (run[0] + run[1]) / 2, lengthFeet: wallRunFeet(wall, run) }));
}

/** The length of a stretch of wall, in feet. */
export function wallRunFeet(wall: WallGeometry, [lo, hi]: [number, number]): number {
  return wall.lengthFeet * (hi - lo);
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
export function wallGripSpan(room: SketchRoom, wall: WallGeometry, rooms: SketchRoom[] = []): { t: number; clearPx: number } | null {
  // Another room's door in this wall (`openingsSharedWith`) is drawn on top of the grip, live, so
  // the grip has to keep clear of it as it does of the room's own — laid out as if the wall were
  // empty, it sat under the door and every press on it picked the door up instead.
  const shared = rooms.length > 0 ? openingsSharedWith(room, rooms).filter((s) => s.wallId === wall.id) : [];
  const occupied: { from: number; to: number }[] = [
    ...room.symbols
      .filter((s) => s.wallId === wall.id)
      .map((s) => {
        const half = symbolWidthPx(s, room) / 2;
        const centre = symbolCentrePx(s, room);
        return { from: centre - half, to: centre + half };
      }),
    ...shared.map((s) => ({ from: s.fromPx, to: s.toPx })),
  ].sort((a, b) => a.from - b.from);

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

/**
 * Whether a room's name is drawn on the plan — see `labelHidden`. A sketch saved before the field
 * existed has no such field, and every one of its rooms shows its name, as it always did.
 */
export function labelShown(room: SketchRoom): boolean {
  return room.labelHidden !== true;
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
  if (isDegenerate(vertices)) return room;
  // A drag that has squeezed a jog out of existence FOLDS it away rather than being refused.
  const folded = foldFlat(room, candidate);
  if (folded) return reflowContents(room, folded);
  if (collapsesAWall(room, candidate)) return room;

  return reflowContents(room, candidate);
}

/**
 * How far off straight two walls may be and still be one wall once the jog between them has gone.
 */
const FOLD_STRAIGHT_DEG = 6;

/**
 * A drag that has pushed a wall back into line with its neighbours: the jog it came from, folded
 * away, or null when this drag did no such thing.
 *
 * WHY THIS EXISTS. [collapsesAWall] refuses any move that drives an existing wall below
 * [MIN_WALL_PX], which is sixteen inches. So a jog whose returns are 1 ft 5 in could be shrunk by
 * exactly one inch and never further: the estimator of 2026-09-24 spent a while trying to push one
 * flat and concluded, reasonably, that the editor would not let them. It would not. A jog could be
 * made by dragging and never unmade by dragging, however much anyone wanted it flat.
 *
 * The refusal is right in general - it is what stops a wall being squeezed to nothing by accident,
 * and it is what makes a pull work at all (see its own note). What was missing is that "squeezed to
 * nothing" and "pushed back into line" look identical to a length check and are opposite intentions.
 * They are told apart by what is LEFT: fold the collapsed wall away, and if the walls that then
 * meet are straight, the drag was a flatten. If they are not, it was a squeeze, and it is refused
 * exactly as before.
 *
 * A deliberate break ([insertVertexOnWall]) is safe from this: it makes two collinear walls and no
 * zero-length one, so nothing here ever fires on it.
 */
function foldFlat(prev: SketchRoom, next: SketchRoom): SketchRoom | null {
  const before = new Map(wallsOf(prev).map((w) => [w.id, w.lengthPx]));
  const walls = wallsOf(next);
  // The walls this drag drove under the minimum. Their vertices are what might fold away.
  const collapsed = walls.filter((w) => {
    if (w.lengthPx >= MIN_WALL_PX) return false;
    const was = before.get(w.id);
    return was !== undefined && w.lengthPx < was - 1e-9;
  });
  if (collapsed.length === 0) return null;

  /*
    EVERY one of them has to leave a straight line behind, and this is the whole safety of it.

    A jog's return has the main wall on one side and the jog's face on the other, and those two
    carry straight on once the return has gone: folding it is what the estimator asked for. A
    PARTITION's end cap has the partition's two faces either side, and those double back on each
    other at 180 degrees: folding it would squeeze a 4 1/2 in partition out of existence, which is
    the very thing collapsesAWall is there to prevent, and the scan-import suite says so within a
    second of anyone getting this wrong.

    So the test is not "is this wall short" - it is "is what remains a straight line". Checked
    before anything is removed, and one failure refuses the whole drag exactly as before.
  */
  const marks: { x: number; y: number }[] = [];
  for (const wall of collapsed) {
    const i = walls.findIndex((w) => w.id === wall.id);
    const behind = walls[(i - 1 + walls.length) % walls.length] as WallGeometry;
    const ahead = walls[(i + 1) % walls.length] as WallGeometry;
    if (angleBetweenWallsDeg(behind, ahead) > FOLD_STRAIGHT_DEG) return null;
    marks.push({ x: wall.x1, y: wall.y1 });
  }

  let room = next;
  for (const wall of collapsed) {
    if (room.vertices.length <= MIN_VERTICES) return null;
    const folded = removeVertex(room, wall.id);
    if (folded === room) return null;   // refused: nothing to gain by guessing
    room = folded;
  }

  /*
    Then join what the fold left, AT THE FOLD ONLY. A sweep over every collinear pair in the room
    would undo a break made deliberately somewhere else entirely, so a corner is merged only when it
    is both straight and standing where the jog used to be.
  */
  for (let guard = 0; guard < 8; guard++) {
    const now = wallsOf(room);
    if (now.length <= MIN_VERTICES) break;
    const straight = now.find((w, i) => {
      const behind = now[(i - 1 + now.length) % now.length] as WallGeometry;
      if (angleBetweenWallsDeg(behind, w) > FOLD_STRAIGHT_DEG) return false;
      return marks.some((m) => Math.hypot(w.x1 - m.x, w.y1 - m.y) <= MIN_WALL_PX);
    });
    if (!straight) break;
    const merged = removeVertex(room, straight.id);
    if (merged === room) break;
    room = merged;
  }

  return isDegenerate(room.vertices) ? null : room;
}

/** The turn between two walls, 0 when they carry straight on, in degrees. */
function angleBetweenWallsDeg(a: WallGeometry, b: WallGeometry): number {
  if (a.lengthPx <= 0 || b.lengthPx <= 0) return 180;
  const ax = (a.x2 - a.x1) / a.lengthPx;
  const ay = (a.y2 - a.y1) / a.lengthPx;
  const bx = (b.x2 - b.x1) / b.lengthPx;
  const by = (b.y2 - b.y1) / b.lengthPx;
  const dot = Math.min(1, Math.max(-1, ax * bx + ay * by));
  return (Math.acos(dot) * 180) / Math.PI;
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
 * How far off parallel the two walls either side of a chamfer must be before `squareOffCorner`
 * will extend them to meet: 10 degrees.
 *
 * Two nearly parallel walls meet a very long way away, so the apex of a nearly flat "corner" is a
 * spike somewhere off the plan. This is the guard against turning a slightly bent wall into one.
 */
const SQUARE_OFF_MIN_TURN_DEG = 10;

/**
 * The furthest the restored apex may stand from either end of the cut it replaces, as a multiple of
 * that cut's own length.
 *
 * For a cut across a RIGHT angle each reach is strictly less than the cut, so 1 would do; the
 * allowance is for a room corner that is acute, where the cut is shorter than the legs it joins and
 * the apex therefore stands further out. Past this it is the near-parallel spike arriving by
 * another route.
 */
const SQUARE_OFF_MAX_REACH = 1.5;

/**
 * Why `squareOffCorner` will not square a particular wall off, or null when it will.
 *
 * Separate from the operation so the editor can say WHICH reason on the button rather than offering
 * one that silently does nothing.
 */
export function squareOffRefusal(room: SketchRoom, chamferWallId: string): string | null {
  if (room.vertices.length <= MIN_VERTICES + 1) return "a room this simple has no corner to square off";
  const index = room.vertices.findIndex((v) => v.id === chamferWallId);
  if (index < 0) return "that wall is not part of this room";
  const n = room.vertices.length;
  const a = room.vertices[(index - 1 + n) % n] as Vertex;
  const c1 = room.vertices[index] as Vertex;
  const c2 = room.vertices[(index + 1) % n] as Vertex;
  const b = room.vertices[(index + 2) % n] as Vertex;
  if (room.symbols.some((s) => s.wallId === chamferWallId))
    return "there is something on this wall — a canted bay with a window in it is a real wall, not a corner to square off. Move or delete it first";

  const apex = cornerApex(a, c1, c2, b);
  if (apex === null) return "the two walls either side run parallel, so there is no corner for them to meet at";
  const chamfer = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (chamfer <= 0) return "that wall has no length";

  /*
    IS THIS WALL THE CUT, OR ONE OF THE WALLS IT CUT ACROSS?

    Once a room has one chamfer in it, its two NEIGHBOURS also stop being parallel to their own
    neighbours, so a test that only asks "do the walls either side meet?" offers to square off all
    three. The editor did exactly that on 2026-09-24: one 3'7" cut, and three buttons — the cut, and
    the 10' and 9' walls it runs between. Pressing either of the wrong two would have thrown a spike
    across the room.

    A cut across a corner is a SHORT CUT: it is shorter than both the walls it joins, always, and
    the corner it restores sits just off its own end rather than somewhere across the plan. Both
    tests are geometric rather than tuned — for a cut with legs p and q across a right angle, the
    cut is sqrt(p² + q²) and the apex is p from one end and q from the other, so each reach is less
    than the cut itself. The allowance above 1 is for a room corner that is acute rather than square.
  */
  const legIn = Math.hypot(c1.x - a.x, c1.y - a.y);
  const legOut = Math.hypot(b.x - c2.x, b.y - c2.y);
  if (chamfer >= legIn || chamfer >= legOut)
    return "this is a wall of the room, not a cut across its corner — the cut is the short one";
  const reach = Math.max(
    Math.hypot(apex.x - c1.x, apex.y - c1.y),
    Math.hypot(apex.x - c2.x, apex.y - c2.y),
  );
  if (reach > chamfer * SQUARE_OFF_MAX_REACH) return "those two walls meet a long way off the plan — this is a shallow angle, not a cut corner";

  // The rest is a dry run of the operation itself, so that a button offering this is never a button
  // that does nothing when pressed.
  const candidate = squareOffCandidate(room, index, apex);
  if (isDegenerate(candidate.vertices)) return "squaring this off would fold the room over itself";
  const out = wallById(candidate, c1.id);
  const into = wallById(candidate, a.id);
  if (!out || !into) return "that corner has no walls to extend";
  if (out.lengthPx < MIN_WALL_PX || into.lengthPx < MIN_WALL_PX)
    return "squaring this off would leave a wall too short to draw";
  return null;
}

/** The room with the chamfer at `index` replaced by its apex. Geometry only — contents are not reflowed. */
function squareOffCandidate(room: SketchRoom, index: number, apex: { x: number; y: number }): SketchRoom {
  const n = room.vertices.length;
  const c1 = room.vertices[index] as Vertex;
  const c2 = room.vertices[(index + 1) % n] as Vertex;
  /*
    The apex keeps c1's id, and c2 goes. That way every symbol on the wall INTO the corner (a.id)
    and every symbol on the wall out of it (c2.id, re-homed below) keeps a wall to live on, and the
    ids the rest of the sketch holds — a door's `wallId`, a cabinet's — stay meaningful.
  */
  const vertices = room.vertices
    .filter((v) => v.id !== c2.id)
    .map((v) => (v.id === c1.id ? { ...v, x: apex.x, y: apex.y } : v));
  return { ...room, vertices };
}

/**
 * Where the two walls either side of the chamfer `c1`→`c2` would meet if each carried straight on:
 * the corner the chamfer cut off. Null when they do not meet usefully.
 */
function cornerApex(a: Vertex, c1: Vertex, c2: Vertex, b: Vertex): { x: number; y: number } | null {
  const ux = c1.x - a.x;
  const uy = c1.y - a.y;
  const vx = b.x - c2.x;
  const vy = b.y - c2.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu <= 0 || lv <= 0) return null;
  // As LINES, not rays: a turn near 0 or near 180 is the same near-parallel problem.
  const cos = Math.min(1, Math.abs((ux * vx + uy * vy) / (lu * lv)));
  const turnFromStraight = Math.abs(90 - Math.abs(90 - (Math.acos(cos) * 180) / Math.PI));
  if (turnFromStraight < SQUARE_OFF_MIN_TURN_DEG) return null;
  const denom = ux * vy - uy * vx;
  if (Math.abs(denom) < 1e-9) return null;
  const s = ((c2.x - a.x) * vy - (c2.y - a.y) * vx) / denom;
  return { x: a.x + ux * s, y: a.y + uy * s };
}

/**
 * Replaces a chamfer with the square corner it cut off: the two walls either side carry straight on
 * until they meet, and the two chamfer vertices become that one apex.
 *
 * WHY THIS EXISTS. Until 2026-09-24 a chamfer was a ONE-WAY DOOR. You could draw one and then live
 * with it, and the estimator spent an afternoon discovering that the hard way — "Couldn't do any
 * breaks and then tap in on that to make it correct on scrivn no matter what". Every route out was
 * blocked, and each for its own good reason:
 *
 *  - Dragging it flat: `collapsesAWall` refuses any drag that takes a wall under `MIN_WALL_PX`.
 *  - `foldFlat`, the escape added for a jog, only fires when what is LEFT is straight within
 *    `FOLD_STRAIGHT_DEG` — and a chamfer leaves 45 degrees, so it is refused by design.
 *  - Double-tapping a chamfer corner: `removeVertex` joins the two neighbours DIRECTLY, which cuts
 *    more off the room rather than restoring the apex. It is the right answer for a stray vertex on
 *    a straight run and the wrong one here.
 *
 * None of those is wrong. What was missing is that "square this corner off" is its own operation —
 * it ADDS a vertex's worth of room back rather than removing one — and nothing else in the editor
 * does that. A scan that read a cut corner where the room has a square one, or a corner unit that
 * chamfered a wall it should have stood against, both land here.
 *
 * Returns the room unchanged when `squareOffRefusal` has a reason.
 */
export function squareOffCorner(room: SketchRoom, chamferWallId: string): SketchRoom {
  if (squareOffRefusal(room, chamferWallId) !== null) return room;
  const index = room.vertices.findIndex((v) => v.id === chamferWallId);
  const n = room.vertices.length;
  const a = room.vertices[(index - 1 + n) % n] as Vertex;
  const c1 = room.vertices[index] as Vertex;
  const c2 = room.vertices[(index + 1) % n] as Vertex;
  const b = room.vertices[(index + 2) % n] as Vertex;
  const apex = cornerApex(a, c1, c2, b);
  if (apex === null) return room;
  const candidate = squareOffCandidate(room, index, apex);

  /*
    Reflow FIRST, re-home second, and the order is load-bearing. `reflowContents` looks a symbol's
    wall up by id in the OLD room, and c1's id names the chamfer there and the wall out of the
    corner here — so re-homing first has the reflow rescale a door against the chamfer it never
    stood on, and the door slides. Reflowed first, the wall into the corner is handled normally and
    the wall out of it is simply absent from the new room, so its symbols come through untouched for
    this to place.
  */
  const reflowed = reflowContents(room, candidate);
  const oldOut = wallById(room, c2.id);
  const newOut = wallById(reflowed, c1.id);
  // The far end of that wall is the end that did NOT move, so a door measured from there stays put;
  // measured from the corner, it would slide by however much the corner gained.
  const symbols = reflowed.symbols.map((symbol) => {
    if (symbol.wallId !== c2.id) return symbol;
    if (!oldOut || !newOut || oldOut.lengthPx <= 0 || newOut.lengthPx <= 0) return { ...symbol, wallId: c1.id };
    const fromFarEnd = (1 - symbol.t) * oldOut.lengthPx;
    return { ...symbol, wallId: c1.id, t: Math.max(0, Math.min(1, 1 - fromFarEnd / newOut.lengthPx)) };
  });

  return { ...reflowed, symbols };
}

/**
 * Adjusts a room drag so the room lands flush against, or lined up with, its neighbours.
 *
 * Without this two rooms simply overlap wherever they're dropped, which is neither a real floor plan
 * nor readable. Each axis is considered separately and independently, so a room can butt up against
 * one neighbour horizontally while staying aligned with a different one vertically.
 *
 * Every corner of the dragged room is a candidate against every corner of every other room and
 * every end of every free wall, per axis: corner to corner gives rooms that share a wall line or
 * line up in a row, and it is the corners, not the bounding box, that carry the lines a plan
 * actually has. The first version compared bounding boxes only, so a room could be dragged into
 * the notch of an L and find nothing there to snap to — the notch's walls are not edges of the
 * L's box — and it was left a finger's width off, doubling the wall. The nearest candidate within
 * `ROOM_SNAP_PX` wins, and if nothing is close the drag is left exactly as the finger put it.
 *
 * Snapping deliberately still applies to a room being dragged INSIDE another — a closet is usually
 * built into a corner, so latching onto the parent's walls is what you want there too.
 */
export function snapRoomTranslation(rooms: SketchRoom[], roomId: string, dx: number, dy: number, freeWalls: FreeWall[] = []): { dx: number; dy: number } {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return { dx, dy };

  const targetsX: number[] = [];
  const targetsY: number[] = [];
  for (const other of rooms) {
    if (other.id === roomId || roomLevel(other) !== roomLevel(room)) continue;
    for (const v of other.vertices) {
      targetsX.push(v.x);
      targetsY.push(v.y);
    }
  }
  for (const wall of freeWalls) {
    if (freeWallLevel(wall) !== roomLevel(room)) continue;
    for (const v of wall.vertices) {
      targetsX.push(v.x);
      targetsY.push(v.y);
    }
  }

  let bestX = ROOM_SNAP_PX;
  let bestY = ROOM_SNAP_PX;
  let adjustX = 0;
  let adjustY = 0;
  for (const mine of room.vertices) {
    for (const theirs of targetsX) {
      const delta = theirs - (mine.x + dx);
      if (Math.abs(delta) < bestX) {
        bestX = Math.abs(delta);
        adjustX = delta;
      }
    }
    for (const theirs of targetsY) {
      const delta = theirs - (mine.y + dy);
      if (Math.abs(delta) < bestY) {
        bestY = Math.abs(delta);
        adjustY = delta;
      }
    }
  }

  return { dx: dx + adjustX, dy: dy + adjustY };
}

/**
 * Is every corner of `child` inside `parent`?
 *
 * Tested half a pixel in from each corner, towards the child's own middle. A closet snapped flush
 * against its room's wall has corners exactly ON that wall, and a point-in-polygon test has to put a
 * boundary point on one side or the other: `isInsideRoom` counts the top and left edges in and the
 * bottom and right edges out, so a closet flush in the top-left corner nested and one flush in the
 * bottom-right corner did not — plain fill, nothing taken off its room's walls, a room drawn on top.
 * Flush is the placement snapping exists to produce, and it has to count — the same reasoning as
 * `INSIDE_EPSILON_PX` for blocks.
 *
 * A room is never inside one no bigger than itself. With every edge now counting, two rooms of one
 * size dropped on top of each other would otherwise each be inside the other.
 */
export function isRoomInside(child: SketchRoom, parent: SketchRoom): boolean {
  if (Math.abs(signedArea(child.vertices)) >= Math.abs(signedArea(parent.vertices))) return false;
  const b = roomBounds(child);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return child.vertices.every((v) => {
    const d = Math.hypot(cx - v.x, cy - v.y) || 1;
    return isInsideRoom(parent, v.x + ((cx - v.x) / d) * INSIDE_EPSILON_PX, v.y + ((cy - v.y) / d) * INSIDE_EPSILON_PX);
  });
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

/**
 * Re-derives every room's parent. Cheap, and called after any move so the links can't go stale.
 *
 * A chosen parent (`chosenParentRoomId`) is the parent, full stop, so long as the room is there
 * on the same storey and the choice makes no loop. The rest follow geometry, worked out AFTER the
 * choices are in place: `containingRoomId` refuses to nest a room inside its own descendant, and it
 * reads the links to know who those are, so a small room drawn inside a big one that has just been
 * made its sub-room is not, for one pass, also made its parent.
 */
export function withDerivedParents(rooms: SketchRoom[]): SketchRoom[] {
  const out = rooms.map((room) => {
    const parentRoomId = validChosenParent(rooms, room);
    if (parentRoomId === null) return room;
    return parentRoomId === room.parentRoomId ? room : { ...room, parentRoomId };
  });
  // One room at a time, each seeing the links made before it: a choice pointing UP the drawing (a
  // big room chosen to be the sub-room of a small one drawn two rooms deep inside it) would
  // otherwise close a loop through the rooms between, geometry taking each of them in turn
  // against a snapshot that showed none of the others' new links.
  for (let i = 0; i < out.length; i++) {
    const room = out[i] as SketchRoom;
    if (validChosenParent(rooms, room) !== null) continue;
    const parentRoomId = room.nestingOptOut ? null : containingRoomId(out, room.id);
    if (parentRoomId !== room.parentRoomId) out[i] = { ...room, parentRoomId };
  }
  return out;
}

/**
 * The room's chosen parent, if the choice can be honoured now: the parent exists, is on the same
 * storey, is not the room itself, and following the choices on from it never comes back here.
 */
function validChosenParent(rooms: SketchRoom[], room: SketchRoom): string | null {
  const id = room.chosenParentRoomId ?? null;
  if (!id || id === room.id) return null;
  const parent = rooms.find((r) => r.id === id);
  if (!parent || roomLevel(parent) !== roomLevel(room)) return null;
  const seen = new Set<string>([room.id]);
  let cursor: SketchRoom | undefined = parent;
  while (cursor) {
    if (seen.has(cursor.id)) return null; // a loop, through this room or another
    seen.add(cursor.id);
    const next: string | null = cursor.chosenParentRoomId ?? null;
    cursor = next ? rooms.find((r) => r.id === next) : undefined;
  }
  return id;
}

/**
 * The rooms this one may be made a sub-room of: the others on its storey, less any that are
 * already under it — a room cannot be inside its own closet. What the "Sub-room of" list offers.
 */
export function possibleParents(room: SketchRoom, rooms: SketchRoom[]): SketchRoom[] {
  const under = new Set<string>([room.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rooms) {
      if (under.has(r.id)) continue;
      const parentIds = [r.parentRoomId, r.chosenParentRoomId ?? null];
      if (parentIds.some((id) => id && under.has(id))) {
        under.add(r.id);
        grew = true;
      }
    }
  }
  return rooms.filter((r) => !under.has(r.id) && roomLevel(r) === roomLevel(room));
}

/**
 * Is `child` a sub-room standing INSIDE `parent` — linked to it and drawn within it? The gate for
 * everything that treats a sub-room's footprint as part of the parent's (floor and ceiling area,
 * the stretch of wall it hides). A sub-room beside its parent passes the link test and not this.
 */
export function isNestedWithin(child: SketchRoom, parent: SketchRoom): boolean {
  return child.parentRoomId === parent.id && isRoomInside(child, parent);
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
/**
 * How wide a wall symbol is drawn, in world pixels — never wider than the wall it is on.
 *
 * The cap is the point. Nothing else stopped a symbol from being wider than its own wall, and the
 * result was a cabinet hanging past the end of the wall and out of the room entirely: on an L-shaped
 * room it sat in the notch, which is not floor, drawn over nothing. It happens without anyone doing
 * something silly — drag the width handle past the corner, or, far more often, place a cabinet and
 * then shorten that wall afterwards. The cabinet kept the length it had.
 *
 * Capped on READ as well as on write because sketches already exist with the bad number in them.
 * Fixing it only on write would mean a drawing stayed wrong until somebody happened to touch that
 * cabinet again — and the point of the drawing is that nobody has to.
 *
 * `symbolWidthFeet` caps identically, so the label and the quantities agree with what is drawn.
 * Without that, a 9' cabinet on a 6' wall would deduct more wall area than the wall has.
 */
export function symbolWidthPx(symbol: SketchSymbol, room: SketchRoom, rooms: SketchRoom[] = [], freeWalls: FreeWall[] = []): number {
  const wall = wallById(room, symbol.wallId);
  const raw = symbol.widthFeet != null ? symbol.widthFeet * PIXELS_PER_FOOT : symbol.widthFraction * (wall?.lengthPx ?? 0);
  if (!wall || wall.lengthPx <= 0) return Math.max(6, raw);
  const run = blockRunPx(symbol, room, rooms, freeWalls);
  // Less whatever the run round the corner owns: a trim, not a shove — see `cornerYieldPx`.
  const yielded = cornerYieldPx(symbol, room, wall);
  return capToRun(raw - yielded.atStart - yielded.atEnd, run.to - run.from);
}

/**
 * The stretch of wall a cabinet or fixture is allowed to occupy, in pixels from the wall's start.
 *
 * Not the whole wall, when a sub-room is standing against part of it. A closet drawn inside a
 * bedroom occupies its share of the bedroom's wall — physically, there is a closet there — so a run
 * of cabinets on that wall stops where the closet begins. Reported from the field: a cabinet ran
 * straight under a sub-room, which drew on top of it, leaving part of the cabinet invisible and the
 * whole thing describing a fitting that could not exist.
 *
 * Only blocks are confined. A DOOR on the covered stretch is a door into the closet, which is an
 * ordinary thing to draw; a cabinet there is inside the closet, which is not.
 *
 * And MORE than the whole wall, when a free wall carries straight on from one of its corners: the
 * wall does not stop at the room's corner, so neither does the run of cabinets along it — see
 * `wallExtensionReach`. Reported from the field: a kitchen run that could not be pulled onto the
 * stretch of wall the PM had drawn on past the corner.
 *
 * `rooms` is empty in the many places that only need a symbol's own geometry, and then this is the
 * whole wall — the same answer as before sub-rooms were considered at all.
 */
function blockRunPx(symbol: SketchSymbol, room: SketchRoom, rooms: SketchRoom[], freeWalls: FreeWall[] = []): { from: number; to: number } {
  const wall = wallById(room, symbol.wallId);
  if (!wall || wall.lengthPx <= 0) return { from: 0, to: 0 };
  if (!isBlockSymbol(symbol)) return { from: 0, to: wall.lengthPx };
  const reach = freeWalls.length > 0 ? wallExtensionReach(room, wall, freeWalls) : { lo: 0, hi: 1 };
  if (rooms.length === 0) return { from: reach.lo * wall.lengthPx, to: reach.hi * wall.lengthPx };

  const runs = exposedWallRuns(room, symbol.wallId, rooms);
  /*
    The run the symbol is already in, or failing that the NEAREST one — never simply the longest.
    A cabinet whose middle has ended up behind a closet has to go somewhere legal, and the stretch
    next to where it was is the one its owner will recognise; the longest free run can be at the
    far end of the room.
  */
  const hit = runs.find(([lo, hi]) => symbol.t >= lo && symbol.t <= hi);
  const pick =
    hit ??
    runs.reduce<[number, number] | null>((best, run) => {
      if (!best) return run;
      const distance = ([lo, hi]: [number, number]) => Math.max(lo - symbol.t, 0) + Math.max(symbol.t - hi, 0);
      return distance(run) < distance(best) ? run : best;
    }, null);

  if (!pick) return { from: 0, to: wall.lengthPx };
  // A stretch that reaches a corner reaches on past it, as far as the free walls there go.
  const lo = pick[0] === 0 ? reach.lo : pick[0];
  const hi = pick[1] === 1 ? reach.hi : pick[1];
  return { from: lo * wall.lengthPx, to: hi * wall.lengthPx };
}

/**
 * How much of a cabinet run's wall is taken by the run round the corner from it.
 *
 * Two runs meeting at an inside corner are an L with ONE corner unit in it, not two blocks
 * crossing. Drawn as two full rectangles they overlap in a square as deep as both of them — the
 * kitchen of 2026-09-22 arrived exactly so, its second run starting 1'2" BEFORE its wall began —
 * and the overlap is not only ugly: the floor deduction counts that square twice, so the room
 * loses four square feet of floor it has.
 *
 * So one run keeps the corner and the other stops short of it by the keeper's depth. The LONGER
 * run keeps it, which is the same convention squaring a corner uses and the same one a fitter
 * uses — the corner unit belongs to the run that carries on past it. Ties go to whichever was
 * drawn first, so the answer never changes under a redraw.
 *
 * Compared on RAW widths, never on the capped ones this very function is helping to work out.
 *
 * Only floor-standing runs yield to each other: a wall cabinet and the base run under it are at
 * different heights and share nothing, and neither do two wall cabinets meeting over a corner —
 * they are one cupboard in reality, but nothing about the floor depends on it.
 */
function cornerYieldPx(symbol: SketchSymbol, room: SketchRoom, wall: WallGeometry): { atStart: number; atEnd: number } {
  const none = { atStart: 0, atEnd: 0 };
  if (!isBlockSymbol(symbol) || symbol.type !== "cabinet" || !standsOnFloor(symbol.tier)) return none;
  const walls = wallsOf(room);
  const index = walls.findIndex((w) => w.id === wall.id);
  if (index < 0) return none;
  const n = walls.length;
  const before = walls[(index - 1 + n) % n] as WallGeometry;
  const after = walls[(index + 1) % n] as WallGeometry;
  /*
    THE CORNER FILLS ITSELF IN. A negative answer means "reach further", not "stand back".

    Two runs meeting at an inside corner are an L with one corner unit in it, and a corner unit is
    the one cabinet in a kitchen with nothing to aim at: it has no visible ends, so nobody taps it.
    What an estimator taps is the two runs either side, and where they stop depends on where they
    could stand — the wall above a lower run is usually behind an upper, a backsplash or a kettle,
    so the run gets tapped on its FACE, a couple of feet out into the room.

    So the rule cannot be "did the taps reach the corner". It is "are these two runs both near
    enough to that corner that the gap between them IS the corner unit". The kitchen of
    2026-09-24 07:06 is the case: one run stopped 1 ft 5 in short, the run round the corner
    stopped 1 ft 9 in short, and a base cabinet is 2 ft deep. Neither reached, nothing fired, and
    Scrivn drew two runs with a hole between them — four square feet of floor the room has not got
    and a corner unit nobody is going to price.

    So: the LONGER run reaches through to the corner and owns the square (the same convention the
    trim always used, and the same one a fitter uses), and the shorter one stands off by exactly
    the keeper's depth. A gap wider than a cabinet is deep is not a corner unit — that is a fridge,
    a doorway, a dishwasher — and nothing is filled in there.
  */
  const mine = rawBlockWidthPx(symbol);
  const centre = symbol.t * wall.lengthPx;
  const fromStart = Math.max(0, centre - mine / 2);
  const fromEnd = Math.max(0, wall.lengthPx - (centre + mine / 2));
  return {
    atStart: cornerAdjustPx(symbol, room, before, false, fromStart),
    atEnd: cornerAdjustPx(symbol, room, after, true, fromEnd),
  };
}

/**
 * What this run's end does at the corner it shares with [neighbour]: a positive answer stands it
 * back that far, a negative one reaches it that far further on, and zero leaves it alone.
 *
 * [myGapPx] is how far short of that corner this run currently stops. [neighbourStartsThere] says
 * which end of the neighbour touches the corner — the wall after this one starts at it, the wall
 * before it ends at it.
 *
 * Nothing happens unless BOTH runs come within a cabinet's depth of the corner: that is what makes
 * the gap a corner unit rather than an appliance. Then the longer one reaches through and the
 * shorter one stands off by the longer one's depth, which is the L a kitchen actually has.
 */
function cornerAdjustPx(
  symbol: BlockSymbol, room: SketchRoom, neighbour: WallGeometry,
  neighbourStartsThere: boolean, myGapPx: number,
): number {
  const mine = rawBlockWidthPx(symbol);
  const myDepth = cabinetDepthPx(symbol);
  // A run further off the corner than it is deep is not one side of a corner unit.
  if (myGapPx > myDepth + CORNER_FILL_SLOP_PX) return 0;
  let keeperDepth = 0;
  let iAmTheKeeper = false;
  let found = false;
  for (const other of room.symbols) {
    if (other.id === symbol.id) continue;
    if (!isBlockSymbol(other) || other.type !== "cabinet" || !standsOnFloor(other.tier)) continue;
    if (other.wallId !== neighbour.id) continue;
    const theirs = rawBlockWidthPx(other);
    const theirDepth = cabinetDepthPx(other);
    // How far short of the SHARED corner the neighbour stops, measured from its own wall's end.
    const centre = other.t * neighbour.lengthPx;
    const gap = neighbourStartsThere ? centre - theirs / 2 : neighbour.lengthPx - (centre + theirs / 2);
    if (gap > theirDepth + CORNER_FILL_SLOP_PX) continue;
    found = true;
    // The longer run keeps the corner; a tie goes to the one drawn first.
    const theyKeep = theirs > mine || (theirs === mine && room.symbols.indexOf(other) < room.symbols.indexOf(symbol));
    if (theyKeep) keeperDepth = Math.max(keeperDepth, theirDepth); else iAmTheKeeper = true;
  }
  if (!found) return 0;
  // The keeper reaches through to the corner; everyone else stands off by its depth.
  if (iAmTheKeeper && keeperDepth === 0) return -myGapPx;
  return Math.max(0, keeperDepth - myGapPx);
}

/**
 * How far short of a corner two runs may BOTH stop and still have a corner unit between them, on
 * top of a cabinet's own depth: 6 in of aim, because a run tapped on its face from across a
 * kitchen is not tapped to the inch.
 */
const CORNER_FILL_SLOP_PX = 6;

/** A block's width before any capping, in pixels: what the symbol itself says it is. */
function rawBlockWidthPx(symbol: SketchSymbol): number {
  return symbol.widthFeet != null ? symbol.widthFeet * PIXELS_PER_FOOT : 0;
}

/** Applies the "no wider than the stretch of wall it can stand on" rule, in the caller's unit. */
function capToRun(raw: number, runPx: number, perFoot = 1): number {
  const floor = 6 / perFoot;
  const limit = runPx > 0 ? runPx / perFoot : Infinity;
  return Math.min(Math.max(floor, raw), limit);
}

/**
 * Where a wall symbol's centre sits along its wall, in pixels from the wall's start corner — kept
 * within the wall, whatever `t` says.
 *
 * `t` is a FRACTION of the wall, so it survives a resize by scaling with it. What it does not
 * survive is the symbol's width being a real measurement: a cabinet at t = 0.9 on a wall it nearly
 * fills has most of its length past the far corner, because the fraction fixes its middle rather
 * than its ends. Capping the width alone does not help — an 11' cabinet on a 12' wall is a legal
 * width and still hangs 5' out of the room if its centre is pinned near the end.
 *
 * Clamped on READ, like the width, and for the same reason: sketches already carry positions that
 * were legal when they were set and stopped being legal when a wall moved. `moveSymbolAlongWall`
 * clamps on write, but only a symbol somebody drags goes through it, and the whole point of the
 * drawing is that nobody has to touch it again.
 */
export function symbolCentrePx(symbol: SketchSymbol, room: SketchRoom, rooms: SketchRoom[] = [], freeWalls: FreeWall[] = []): number {
  const wall = wallById(room, symbol.wallId);
  if (!wall || wall.lengthPx <= 0) return 0;
  const half = symbolWidthPx(symbol, room, rooms, freeWalls) / 2;
  const run = blockRunPx(symbol, room, rooms, freeWalls);
  /*
    A run trimmed at a corner keeps its FAR edge: the cabinets it lost are the ones in the corner
    square, which the neighbouring run owns, and the rest of it has not moved an inch. So the
    middle shifts by half of what came off, away from the end that yielded.
  */
  const yielded = cornerYieldPx(symbol, room, wall);
  const centre = symbol.t * wall.lengthPx + yielded.atStart / 2 - yielded.atEnd / 2;
  // The width cap guarantees `half` is at most half the run, so the low bound never exceeds the high.
  return Math.min(run.to - half, Math.max(run.from + half, centre));
}

/**
 * Where along its wall an opening sits, for the dimensions shown while it is selected or slid.
 *
 * The width says how big a door is; nothing said where it was. A PM placing a door from a tape
 * measure — "3' from the corner" — had to judge it by eye against the grid. So while a door, opening
 * or window is selected the canvas draws the clear distance from each jamb to the end of the wall,
 * and this is where those ends and jambs are, in pixels along the wall from its start.
 *
 * The ends are those of the exposed stretch the opening sits on when a sub-room takes part of the
 * wall — the corner a tape hooks onto is the closet's outside wall, not the room's own corner behind
 * it — which is the same stretch the wall's dimension label measures. An opening standing on the
 * covered stretch itself (a closet door drawn on the parent's wall) is measured against the whole
 * wall, the only ends it has.
 */
export interface SymbolOffsets {
  /** The stretch measured against. */
  from: number;
  to: number;
  /** The opening's two jambs. */
  x0: number;
  x1: number;
}

export function symbolOffsetsPx(symbol: SketchSymbol, room: SketchRoom, rooms: SketchRoom[] = []): SymbolOffsets | null {
  const wall = wallById(room, symbol.wallId);
  if (!wall || wall.lengthPx <= 0) return null;
  const half = symbolWidthPx(symbol, room, rooms) / 2;
  const centre = symbolCentrePx(symbol, room, rooms);
  const t = centre / wall.lengthPx;
  const run = exposedWallRuns(room, symbol.wallId, rooms).find(([lo, hi]) => t >= lo && t <= hi) ?? [0, 1];
  return { from: run[0] * wall.lengthPx, to: run[1] * wall.lengthPx, x0: centre - half, x1: centre + half };
}

/** How deep a cabinet is drawn, in world pixels. */
export function cabinetDepthPx(block: BlockSymbol): number {
  return Math.max(6, block.depthFeet * PIXELS_PER_FOOT);
}

/** The symbol's real width, or null when the room has no scale to measure it against. */
export function symbolWidthFeet(symbol: SketchSymbol, room: SketchRoom, rooms: SketchRoom[] = [], freeWalls: FreeWall[] = []): number | null {
  const wall = wallById(room, symbol.wallId);
  if (wall == null && symbol.widthFeet == null) return null;
  return symbolWidthPx(symbol, room, rooms, freeWalls) / PIXELS_PER_FOOT;
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
 *
 * With `rooms`, the openings other rooms have in this wall count too — a door is one hole through
 * a wall two rooms share, and there is no wall behind it to finish from either side. See
 * `openingsSharedWith`. Without `rooms` only this room's own are counted, as before.
 */
export function openingSquareFeetOnWall(room: SketchRoom, wallId: string, rooms: SketchRoom[] = []): number {
  const ceiling = room.ceilingHeightFeet ?? DEFAULT_CEILING_HEIGHT_FEET;
  const own = room.symbols.filter((symbol) => symbol.wallId === wallId).map((symbol) => ({ room, symbol, widthCap: Infinity }));
  // A shared door counts for the stretch of it that lies in THIS wall: a door straddling the corner
  // where two rooms meet a third is half a hole in each of their walls, not a whole one in both.
  const shared = rooms.length > 0 ? openingsSharedWith(room, rooms).filter((s) => s.wallId === wallId).map((s) => ({ room: s.room, symbol: s.symbol, widthCap: (s.toPx - s.fromPx) / PIXELS_PER_FOOT })) : [];
  return [...own, ...shared].reduce((sum, { room: owner, symbol, widthCap }) => {
    const height = symbol.type === "door" ? symbol.heightFeet : symbol.type === "window" ? symbol.heightFeet : null;
    if (height == null) return sum;
    const width = symbolWidthFeet(symbol, owner);
    if (width == null) return sum;
    return sum + Math.min(width, widthCap) * Math.min(height, ceiling);
  }, 0);
}

/** The same across every wall of a room. */
export function openingSquareFeet(room: SketchRoom, rooms: SketchRoom[] = []): number {
  return wallsOf(room).reduce((sum, wall) => sum + openingSquareFeetOnWall(room, wall.id, rooms), 0);
}

/**
 * The doors and windows of OTHER rooms that sit in a wall of this one: every other room's door or
 * window whose wall lies along one of this room's walls and overlaps it, with the wall of this
 * room it sits in. A door is one thing, in one room's wall; the room on the other side of that
 * wall sees it, draws it, and has no wall behind it either — it is never copied into that room.
 *
 * A first version copied the door into the pulled room as an opening of its own. Then the two
 * drifted: slide the original and the copy stayed, "the original opening underneath the one I am
 * moving"; widen the pulled room and the copy slid with its wall while the door was copied in
 * again where it really was. One symbol, seen from both sides, cannot drift from itself.
 *
 * Every room draws its own walls in full and its own doors as gaps in them, so the room drawn
 * later would paint its unbroken wall — and its floor — over the other room's door: the gap fills
 * in, the leaf disappears under the floor. Seen three ways in one picture: a room pulled below a
 * door left "just an opening"; a flight of stairs moved against a wall hid the opening in it; a
 * pulled room that came to lie along an angled wall lost the door in it. Hence each room draws
 * these over its own wall and floor, whichever room is on top.
 *
 * Overlap, not wholly on: a door half past this room's corner is still half in its wall.
 *
 * Not one this room already has at the same place in the same wall: sketches saved while doors
 * were still being copied into pulled rooms hold such a copy, and it is one hole, not two — drawn
 * once and deducted once, through the copy, until the copy is deleted.
 */
export interface SharedOpening {
  /** The room the door belongs to. */
  room: SketchRoom;
  symbol: SketchSymbol;
  /** The wall of the room asking that the door lies in. */
  wallId: string;
  /** The stretch of that wall the door covers, in pixels from the wall's start, clipped to the wall. */
  fromPx: number;
  toPx: number;
}

export function openingsSharedWith(room: SketchRoom, rooms: SketchRoom[]): SharedOpening[] {
  const level = roomLevel(room);
  const ownWalls = wallsOf(room).filter((w) => w.lengthPx > 0);
  const out: SharedOpening[] = [];
  for (const other of rooms) {
    if (other.id === room.id || roomLevel(other) !== level) continue;
    for (const symbol of other.symbols) {
      if (symbol.type !== "door" && symbol.type !== "window") continue;
      const theirs = wallById(other, symbol.wallId);
      if (!theirs || theirs.lengthPx <= 0) continue;
      const centre = symbolCentrePx(symbol, other);
      const half = symbolWidthPx(symbol, other) / 2;
      const at = pointOnWall(theirs, centre / theirs.lengthPx);
      const along = (w: WallGeometry) => ((at.x - w.x1) * (w.x2 - w.x1) + (at.y - w.y1) * (w.y2 - w.y1)) / w.lengthPx;
      const mine = ownWalls.find((w) => {
        if (!alongOneLine(w, theirs)) return false;
        const u = along(w);
        return u + half > 0 && u - half < w.lengthPx;
      });
      if (!mine) continue;
      const u = along(mine);
      const alreadyHere = room.symbols.some((own) => {
        if (own.wallId !== mine.id || (own.type !== "door" && own.type !== "window")) return false;
        // Overlapping at all: two doorways cannot overlap in a wall, so a copy nudged along, or a
        // doorway tapped into both rooms a little apart, is one hole.
        const ownCentre = symbolCentrePx(own, room);
        const ownHalf = symbolWidthPx(own, room) / 2;
        return Math.min(ownCentre + ownHalf, u + half) - Math.max(ownCentre - ownHalf, u - half) > 1;
      });
      if (!alreadyHere) out.push({ room: other, symbol, wallId: mine.id, fromPx: Math.max(0, u - half), toPx: Math.min(mine.lengthPx, u + half) });
    }
  }
  return out;
}

/**
 * Does another room on the storey have a wall along this stretch of this wall — is the stretch one
 * two rooms share? Asked for a symbol's span rather than the whole wall: a closet pulled off one
 * end of a long wall shares only that end of it.
 */
export function stretchSharedWithAnother(room: SketchRoom, wall: WallGeometry, fromPx: number, toPx: number, rooms: SketchRoom[]): boolean {
  if (wall.lengthPx <= 0) return false;
  const along = (p: { x: number; y: number }) => ((p.x - wall.x1) * (wall.x2 - wall.x1) + (p.y - wall.y1) * (wall.y2 - wall.y1)) / wall.lengthPx;
  return rooms.some(
    (other) =>
      other.id !== room.id &&
      roomLevel(other) === roomLevel(room) &&
      wallsOf(other).some((w) => {
        if (w.lengthPx <= 0 || !alongOneLine(wall, w)) return false;
        const a = along({ x: w.x1, y: w.y1 });
        const b = along({ x: w.x2, y: w.y2 });
        return Math.min(Math.max(a, b), toPx) - Math.max(Math.min(a, b), fromPx) > 1;
      }),
  );
}

/** Do two walls lie along one line, overlapping — a shared wall, or a shared stretch of one? */
export function alongOneLine(a: WallGeometry, b: WallGeometry): boolean {
  const off = (p: { x: number; y: number }, w: WallGeometry) => Math.abs((w.x2 - w.x1) * (w.y1 - p.y) - (w.x1 - p.x) * (w.y2 - w.y1)) / w.lengthPx;
  if (off({ x: b.x1, y: b.y1 }, a) > 1.5 || off({ x: b.x2, y: b.y2 }, a) > 1.5) return false;
  const along = (p: { x: number; y: number }) => ((p.x - a.x1) * (a.x2 - a.x1) + (p.y - a.y1) * (a.y2 - a.y1)) / a.lengthPx;
  const lo = Math.min(along({ x: b.x1, y: b.y1 }), along({ x: b.x2, y: b.y2 }));
  const hi = Math.max(along({ x: b.x1, y: b.y1 }), along({ x: b.x2, y: b.y2 }));
  return Math.min(hi, a.lengthPx) - Math.max(lo, 0) > 1;
}

/**
 * Writes a new drawn width back to whichever field is authoritative — feet once the room is
 * scaled, fraction before that. Keeping this in one place is what stops a dragged handle writing
 * to the field that isn't being read.
 */
export function withSymbolWidthPx(symbol: SketchSymbol, room: SketchRoom, widthPx: number, rooms: SketchRoom[] = [], freeWalls: FreeWall[] = []): SketchSymbol {
  // Capped here too, so the stored number matches the drawing rather than drifting past it and
  // being quietly capped on every later read.
  const run = blockRunPx(symbol, room, rooms, freeWalls);
  const capped = capToRun(widthPx, run.to - run.from);
  return { ...symbol, widthFeet: Math.max(0.25, capped / PIXELS_PER_FOOT) };
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

/**
 * Writes a new drawn footprint back to whichever fields are authoritative, growing only as far as
 * the room allows.
 *
 * Without the limit, dragging a handle outward pushed the block through a wall: the size was written
 * whatever it was, and the reposition that follows can only refuse the move, not undo the growth. So
 * the block ended up the size that was asked for and standing outside the room.
 *
 * The largest size that still fits is found by bisection between the size it already had — which is
 * known to fit — and the size asked for. Under the finger the handle simply stops at the wall.
 */
export function withFreeCabinetSizePx(cabinet: FreeCabinet, room: SketchRoom, widthPx: number, depthPx: number): FreeCabinet {
  const wanted = { width: Math.max(8, widthPx), depth: Math.max(8, depthPx) };
  const bounds = roomBounds(room);
  const left = bounds.minX + cabinet.x;
  const top = bounds.minY + cabinet.y;
  const fits = (w: number, d: number) => rectInsideRoom(room, left, top, w, d);

  let { width, depth } = wanted;
  if (!fits(width, depth)) {
    const now = freeCabinetSizePx(cabinet, room);
    let lo = 0;
    let hi = 1;
    // Fourteen halvings resolves a room-sized span to well under a pixel, which is finer than
    // anything a finger can ask for.
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(now.width + (wanted.width - now.width) * mid, now.depth + (wanted.depth - now.depth) * mid)) lo = mid;
      else hi = mid;
    }
    width = Math.max(8, now.width + (wanted.width - now.width) * lo);
    depth = Math.max(8, now.depth + (wanted.depth - now.depth) * lo);
  }

  return { ...cabinet, widthPx: width, depthPx: depth, widthFeet: width / PIXELS_PER_FOOT, depthFeet: depth / PIXELS_PER_FOOT };
}

/**
 * Half a pixel — half an inch at this scale.
 *
 * Containment is tested against a rectangle shrunk by this much, which is what lets a block sitting
 * exactly on a wall count as inside. Without it, flush — the placement the snapping exists to
 * produce — would be rejected as out of the room, and an island could never touch anything.
 */
const INSIDE_EPSILON_PX = 0.5;

/** Do two line segments properly cross? Touching at an endpoint does not count. */
function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = side(cx, cy, dx, dy, ax, ay);
  const d2 = side(cx, cy, dx, dy, bx, by);
  const d3 = side(ax, ay, bx, by, cx, cy);
  const d4 = side(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/**
 * Is every part of an axis-aligned rectangle inside the room's outline?
 *
 * The four corners are not enough on their own. An L-shaped room is concave, and a rectangle can
 * have all four corners on floor while swallowing the inside corner between them — so the walls
 * themselves are checked for crossing it as well. That pair of tests is complete: if no corner is
 * outside and no wall passes through, nothing of the room's boundary is inside the rectangle.
 */
export function rectInsideRoom(room: SketchRoom, x: number, y: number, width: number, depth: number): boolean {
  const e = INSIDE_EPSILON_PX;
  const left = x + e;
  const top = y + e;
  const right = x + width - e;
  const bottom = y + depth - e;
  // Smaller than the epsilon in either direction: nothing meaningful to contain, so test the middle.
  if (right <= left || bottom <= top) return isInsideRoom(room, x + width / 2, y + depth / 2);

  if (
    !isInsideRoom(room, left, top) ||
    !isInsideRoom(room, right, top) ||
    !isInsideRoom(room, right, bottom) ||
    !isInsideRoom(room, left, bottom)
  ) {
    return false;
  }

  for (const wall of wallsOf(room)) {
    const crosses =
      segmentsCross(wall.x1, wall.y1, wall.x2, wall.y2, left, top, right, top) ||
      segmentsCross(wall.x1, wall.y1, wall.x2, wall.y2, right, top, right, bottom) ||
      segmentsCross(wall.x1, wall.y1, wall.x2, wall.y2, right, bottom, left, bottom) ||
      segmentsCross(wall.x1, wall.y1, wall.x2, wall.y2, left, bottom, left, top);
    if (crosses) return false;
  }
  return true;
}

/**
 * Pulls a block's edges flush to any wall they are nearly touching.
 *
 * Only walls that actually run alongside the block are considered — a wall is a candidate for the
 * left or right edge only if it is vertical AND spans some of the block's height, so a block never
 * jumps sideways to line up with a wall it is nowhere near.
 *
 * Diagonal walls are skipped. A block is an axis-aligned rectangle and cannot sit flush against an
 * angled wall, so there is nothing honest to snap it to.
 */
function snapBlockToWalls(
  room: SketchRoom,
  left: number,
  top: number,
  width: number,
  depth: number,
): { left: number; top: number } {
  const right = left + width;
  const bottom = top + depth;
  let bestX: { at: number; gap: number } | null = null;
  let bestY: { at: number; gap: number } | null = null;

  /**
   * `wallAt` is where the wall is; `edge` is the block edge being brought to it; `at` is where the
   * block's top-left ends up if it happens. Measuring the gap from the EDGE is the whole point — an
   * earlier version measured it from `at`, which for a far edge is a whole block-width away from the
   * wall, so the near wall never won and blocks snapped to the wrong side of the room.
   */
  const consider = (
    best: { at: number; gap: number } | null,
    wallAt: number,
    edge: number,
    at: number,
  ): { at: number; gap: number } | null => {
    const gap = Math.abs(wallAt - edge);
    if (gap > BLOCK_END_SNAP_PX) return best;
    return best === null || gap < best.gap ? { at, gap } : best;
  };

  for (const wall of wallsOf(room)) {
    const vertical = Math.abs(wall.x2 - wall.x1) < 1e-6;
    const horizontal = Math.abs(wall.y2 - wall.y1) < 1e-6;

    if (vertical) {
      const lo = Math.min(wall.y1, wall.y2);
      const hi = Math.max(wall.y1, wall.y2);
      if (bottom <= lo || top >= hi) continue; // Alongside a different part of the room.
      bestX = consider(bestX, wall.x1, left, wall.x1);
      bestX = consider(bestX, wall.x1, right, wall.x1 - width);
    } else if (horizontal) {
      const lo = Math.min(wall.x1, wall.x2);
      const hi = Math.max(wall.x1, wall.x2);
      if (right <= lo || left >= hi) continue;
      bestY = consider(bestY, wall.y1, top, wall.y1);
      bestY = consider(bestY, wall.y1, bottom, wall.y1 - depth);
    }
  }

  return { left: bestX?.at ?? left, top: bestY?.at ?? top };
}

/**
 * Moves an island, keeping the whole block inside its room.
 *
 * An island is free of any wall but not free of the room: a block sitting half outside the walls
 * isn't a sketch of anything real, and it would report a position the room can't contain.
 *
 * Edges snap flush to nearby walls first, then the whole rectangle has to fit. It used to test only
 * the block's CENTRE against the outline, on the reasoning that requiring all four corners would
 * make a block hugging an inside corner unplaceable — but that is what the epsilon above solves, and
 * the centre test let a long block hang well out of the room as long as its middle stayed on floor.
 *
 * A move that cannot be made legally is refused rather than approximated. The block stays where it
 * was and under the finger it reads as hitting the wall, which is what it has done.
 */
export function moveFreeCabinet(cabinet: FreeCabinet, room: SketchRoom, x: number, y: number): FreeCabinet {
  const { width, depth } = freeCabinetSizePx(cabinet, room);
  const bounds = roomBounds(room);

  const snapped = snapBlockToWalls(room, bounds.minX + x, bounds.minY + y, width, depth);
  const left = Math.min(Math.max(bounds.minX, snapped.left), Math.max(bounds.minX, bounds.maxX - width));
  const top = Math.min(Math.max(bounds.minY, snapped.top), Math.max(bounds.minY, bounds.maxY - depth));

  if (!rectInsideRoom(room, left, top, width, depth)) return cabinet;
  return { ...cabinet, x: left - bounds.minX, y: top - bounds.minY };
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

/**
 * How close an end has to get to a corner before it goes flush to it.
 *
 * Half a foot: near enough that a cabinet a PM meant to run into the corner does, far enough that
 * one deliberately held off the corner stays where it was put.
 */
export const BLOCK_END_SNAP_PX = 6;

/**
 * Slides a symbol along its own wall. Deliberately cannot move it to a different wall.
 *
 * Cabinets and fixtures snap flush when an end comes near a corner; doors and windows do not. A run
 * of cabinets almost always butts into the corner, and getting there by eye on a phone is fiddly —
 * whereas a door is nearly never flush (there is a jamb, and usually a stud), so the same snap would
 * fight the PM rather than help.
 */
export function moveSymbolAlongWall(
  symbol: SketchSymbol,
  room: SketchRoom,
  centrePx: number,
  rooms: SketchRoom[] = [],
  freeWalls: FreeWall[] = [],
): SketchSymbol {
  const wall = wallById(room, symbol.wallId);
  if (!wall || wall.lengthPx <= 0) return { ...symbol, t: 0.5 };
  const half = symbolWidthPx(symbol, room, rooms, freeWalls) / 2;
  /*
    The run is picked from where the symbol IS, so ask for it before moving — otherwise a drag
    towards a neighbouring stretch would re-pick the run halfway and the block would jump.
  */
  const run = blockRunPx(symbol, room, rooms, freeWalls);
  let clamped = Math.min(run.to - half, Math.max(run.from + half, centrePx));

  if (isBlockSymbol(symbol)) {
    // Flush to whichever end of its own stretch it is near — a room corner, or the face of a
    // sub-room standing on this wall. Both are walls to a cabinet.
    if (clamped - half - run.from <= BLOCK_END_SNAP_PX) clamped = run.from + half;
    else if (run.to - (clamped + half) <= BLOCK_END_SNAP_PX) clamped = run.to - half;
  }

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
 *
 * `hold` names the corner to keep still when the caller knows better than the top-left rule — see
 * `withWallRunLength`, which holds the corner a closet stands in.
 */
export function withWallLength(room: SketchRoom, wallId: string, feet: number, hold: "start" | "end" | null = null): SketchRoom {
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
  const holdStart = hold !== null ? hold === "start" : corner(wall.x1, wall.y1) <= corner(wall.x2, wall.y2);

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

/**
 * `withWallLength` for one stretch of a wall: the figure on its label, and the one a tape finds.
 *
 * The PM measures the wall they can see — from the corner to the closet — and types that. The
 * closet's share is added back so the whole wall comes out right, and the label on the stretch
 * shows what was typed.
 *
 * The run may also reach PAST a corner, below 0 or above 1, when a free wall carries straight on
 * from it and the label measures the whole run — see `wallDimensionsWithExtensions`. The same
 * arithmetic serves: the free wall's share comes off what was typed, and the room's wall is what
 * is left.
 *
 * The corner held is the one something stands at — the closet, or the free wall — not the top-left
 * one. Rooms are not joined (see the file header): a closet flush with a corner stays put when its
 * parent is resized, and a free wall stays where it was drawn, so moving THAT corner would leave
 * either standing clear of the wall, or buried in it. With the whole wall — or something at each
 * end, where there is nothing to prefer — the top-left rule applies as usual.
 */
export function withWallRunLength(room: SketchRoom, wallId: string, run: [number, number], feet: number): SketchRoom {
  const wall = wallById(room, wallId);
  // Checked here as well as on the whole wall: a stretch of nothing added to the closet's share can
  // still make a perfectly legal wall, and it would be drawn.
  if (!wall || feet <= 0) return room;
  const [lo, hi] = run;
  const hold = lo !== 0 && hi === 1 ? "start" : lo === 0 && hi !== 1 ? "end" : null;
  return withWallLength(room, wallId, feet + wall.lengthFeet - wallRunFeet(wall, run), hold);
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

/**
 * Is this a name the tool gave ("Room 3"), as opposed to one somebody typed? A placeholder matches
 * an extraction room only exactly, never by containment — "Room 1" is a whole word inside "Living
 * Room 1", and a room nobody has named yet must not be taken for the living room.
 */
export function isPlaceholderRoomName(name: string): boolean {
  return /^\s*room\s+\d+\s*$/i.test(name);
}

/**
 * The name a new room starts with: "Room 1", "Room 2", and so on — one past the highest number
 * already in use, across every storey, so a plan never holds two "Room 3"s however rooms have been
 * renamed or deleted in between. Asked for from the field: every added, pulled or drawn room came
 * in as "Untitled room", and a plan of six of them told nobody which was which.
 *
 * Only the numbered names count. "Kitchen", "Stairs" and "Closet" are names the PM or the tool
 * chose, and a plan of a kitchen and two closets still starts its first plain room at "Room 1".
 */
export function nextRoomName(rooms: SketchRoom[]): string {
  let highest = 0;
  for (const room of rooms) {
    const match = /^\s*room\s+(\d+)\s*$/i.exec(room.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Room ${highest + 1}`;
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
 * Turns the flight a quarter turn — the whole flight, footprint and all, about its centre.
 *
 * The first version turned only the direction of travel and left the rectangle where it was, so a
 * turn of an 11' x 3' flight made it a flight three feet long and eleven wide, with the treads run
 * across it. A flight turned a quarter turn is the same flight pointing the other way: the outline
 * turns with the treads, so it stays 11' long and 3' wide and comes to rest across where it stood.
 *
 * A quarter turn in screen space is an exact swap of coordinates — no trigonometry, so nothing
 * drifts however many times it is turned. Corners keep their ids and their order, so the doors and
 * cabinets on the walls stay on their walls, and the winding stays clockwise. Islands turn with the
 * room, swapping their width and depth as a block turned a quarter turn does.
 *
 * `turns` is in quarter turns, signed — the button passes nothing and gets a clockwise turn, the
 * left arrow key passes -1. Adding 360 before the modulo keeps a negative turn in range, which the
 * bare `%` would not: -90 % 360 is -90 in JavaScript, not 270.
 */
export function rotateStairs(room: SketchRoom, turns = 1): SketchRoom {
  if (!room.stairs) return room;
  const quarter = (((turns % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const next = ((((room.stairs.orientation + turns * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;

  const before = roomBounds(room);
  const cx = before.minX + before.width / 2;
  const cy = before.minY + before.height / 2;
  const turn = (x: number, y: number): { x: number; y: number } => {
    const dx = x - cx;
    const dy = y - cy;
    // Clockwise on screen (y down): one quarter turn takes (dx, dy) to (-dy, dx).
    switch (quarter) {
      case 1:
        return { x: cx - dy, y: cy + dx };
      case 2:
        return { x: cx - dx, y: cy - dy };
      case 3:
        return { x: cx + dy, y: cy - dx };
      default:
        return { x, y };
    }
  };

  const vertices = room.vertices.map((v) => ({ ...v, ...turn(v.x, v.y) }));
  const after = roomBounds({ ...room, vertices });
  const freeCabinets = room.freeCabinets.map((island) => {
    const swap = quarter % 2 === 1;
    const widthPx = swap ? island.depthPx : island.widthPx;
    const depthPx = swap ? island.widthPx : island.depthPx;
    // Turn the block's centre, then place the turned block's corner from it — relative to the new
    // bounds, since that is how an island is stored.
    const centre = turn(before.minX + island.x + island.widthPx / 2, before.minY + island.y + island.depthPx / 2);
    return {
      ...island,
      x: centre.x - widthPx / 2 - after.minX,
      y: centre.y - depthPx / 2 - after.minY,
      widthPx,
      depthPx,
      widthFeet: swap ? island.depthFeet : island.widthFeet,
      depthFeet: swap ? island.widthFeet : island.depthFeet,
    };
  });

  return { ...room, vertices, freeCabinets, stairs: { ...room.stairs, orientation: next } };
}

// ---------------------------------------------------------------------------------------------
// Closets
// ---------------------------------------------------------------------------------------------

/**
 * How deep a closet is drawn when nothing better is known. 2'0" is a reach-in — a hanging rail with
 * the door in front of it — which is most of the closets in the houses this trade works in. A
 * walk-in is whatever the PM drags or types it to.
 */
export const CLOSET_DEFAULT_DEPTH_FEET = 2;

/**
 * Added to the door's width to get the closet's: 6" of wall each side of the opening, which is a
 * jamb and a stud, and the least a closet can be framed around its door. A closet exactly as wide
 * as its door has no wall to hang the door on.
 */
export const CLOSET_WIDTH_MARGIN_FEET = 1;

/**
 * Narrower than this and it is a cupboard, not a closet. A 2'6" door plus the margin is 3'6", so
 * the floor only bites on a narrow door — a 1'6" linen-closet door still gets a closet with room
 * for a shelf.
 */
export const CLOSET_MIN_WIDTH_FEET = 2.5;

/**
 * How far off a wall the inside-or-outside probe is taken, in world pixels — so, inches. Clear of
 * the wall's own line, where ray casting is undecided, and well inside any room a wall can enclose
 * (`MIN_WALL_PX` is 16).
 */
const SIDE_PROBE_PX = 3;

/**
 * The least the walls either side of a door's wall must turn against each other, in degrees, for
 * the corner between them to be a chamfer's — condition (a) of the corner rule in
 * `closetBehindDoor`.
 *
 * Measured between the LINES, not the directions of travel, so the short connecting wall of an L
 * (its neighbours run the same way) and the back of a bay (they run opposite ways) both read as a
 * turn of zero: parallel lines meet nowhere, and near-parallel ones meet so far off that the
 * "corner" is in another room. 30 degrees is a third of a real chamfer's 90 — a corner cut at
 * 45 degrees leaves its neighbours square to each other — and sixty times the half a degree
 * `collinear` allows a straight run of wall, so neither a chamfer nor a jog is ever near the line.
 */
export const CHAMFER_MIN_TURN_DEG = 30;

/**
 * The longest either side of the cut-off corner may be, in feet, for the corner to be a closet —
 * condition (c) of the corner rule in `closetBehindDoor`.
 *
 * A chamfer is a SHORT diagonal: three feet of leg each way in the office this was built against,
 * two and a half in the bedroom that showed the rectangle was wrong. A long diagonal wall is a wall
 * in its own right — the house is on an angle there — and the point where this room's neighbours
 * would have met is somewhere in the room next door, not in a closet. 8' is past any corner a
 * framer cuts off for a closet and short of any room.
 */
export const CHAMFER_FILL_MAX_FEET = 8;

/**
 * How close, in world pixels (so inches), a room's corners must be to where a closet's would land
 * for `closetExistsBehind` to say the closet is already there. One inch: a closet dragged into a
 * better place has moved further than that, and is then a different closet from the one that would
 * be drawn, which is the honest answer.
 */
export const CLOSET_SAME_PLACE_PX = 1;

/**
 * Where a closet would stand behind a door, before it is a room: the two corners on the door's
 * wall and the corners off it, in one ring. `closetBehindDoor` makes the room, `closetShapeBehindDoor`
 * reports the shape and `closetExistsBehind` looks for the wall-side pair among the other rooms, all
 * from this one outline so that they can never disagree about which shape a door gets.
 */
interface ClosetFootprint {
  shape: "corner" | "rectangle";
  /** The two corners on the wall's line, in the wall's own order. */
  onWall: [{ x: number; y: number }, { x: number; y: number }];
  /** The rest of the ring, continuing from `onWall[1]` round to `onWall[0]`. */
  beyond: { x: number; y: number }[];
}

/**
 * The corner a chamfer cut off, if the door's wall is a chamfer — conditions (a) to (d) of the
 * corner rule, see `closetBehindDoor`. `ox, oy` is the unit outward normal of `wall`, already
 * settled by the probe. Returns the apex, or null when the wall is not a chamfer.
 */
function chamferCorner(walls: WallGeometry[], wall: WallGeometry, ox: number, oy: number): { x: number; y: number } | null {
  const count = walls.length;
  const before = walls[(wall.index + count - 1) % count] as WallGeometry;
  const after = walls[(wall.index + 1) % count] as WallGeometry;
  if (before === wall || after === wall || before.lengthPx <= 0 || after.lengthPx <= 0) return null;

  const px = (before.x2 - before.x1) / before.lengthPx;
  const py = (before.y2 - before.y1) / before.lengthPx;
  const nx = (after.x2 - after.x1) / after.lengthPx;
  const ny = (after.y2 - after.y1) / after.lengthPx;

  // (a) The cross product of two unit vectors is the sine of the angle between their lines — the
  // same for a turn of θ and of 180° - θ, which is what makes a jog and a bay's back both zero.
  const cross = px * ny - py * nx;
  if (Math.abs(cross) < Math.sin((CHAMFER_MIN_TURN_DEG * Math.PI) / 180)) return null;

  // X: along line(before) from its start by s, where it meets line(after).
  const s = ((after.x1 - before.x1) * ny - (after.y1 - before.y1) * nx) / cross;
  const x = before.x1 + px * s;
  const y = before.y1 + py * s;

  // (b) How far X stands off the wall on the outward side — negative is the room's own floor. The
  // triangle's doubled area is that height times the wall, so this is also `isDegenerate`'s test,
  // written for a triangle whose base is the wall: a corner too shallow to be a room is not drawn
  // as one, because the editor would then refuse to touch it.
  const height = (x - wall.x1) * ox + (y - wall.y1) * oy;
  if (height * wall.lengthPx < MIN_WALL_PX * MIN_WALL_PX) return null;

  // (c) Both legs of the corner, from the chamfer's ends to the apex — and (d) neither longer than
  // the chamfer itself, with an inch (one world pixel) of slack for a corner drawn at exactly
  // 60 degrees, where the legs and the chamfer come out equal.
  const legA = Math.hypot(x - wall.x1, y - wall.y1);
  const legB = Math.hypot(x - wall.x2, y - wall.y2);
  const maxLegPx = Math.min(CHAMFER_FILL_MAX_FEET * PIXELS_PER_FOOT, wall.lengthPx + 1);
  if (legA > maxLegPx || legB > maxLegPx) return null;

  return { x, y };
}

/** The outline `closetBehindDoor` would draw — see there for every decision in it. */
function closetFootprint(
  room: SketchRoom,
  doorId: string,
  options: { depthFeet?: number; widthFeet?: number } = {},
): ClosetFootprint | null {
  const door = room.symbols.find((s) => s.id === doorId);
  if (!door || door.type !== "door") return null;
  const walls = wallsOf(room);
  const wall = walls.find((w) => w.id === door.wallId);
  if (!wall || wall.lengthPx <= 0) return null;

  // Along the wall.
  const ux = (wall.x2 - wall.x1) / wall.lengthPx;
  const uy = (wall.y2 - wall.y1) / wall.lengthPx;

  // Across the wall. (-uy, ux) is the wall's direction turned +90° in screen space: the inward
  // normal for a clockwise ring, and the outward one for a ring wound the other way.
  const midX = (wall.x1 + wall.x2) / 2;
  const midY = (wall.y1 + wall.y2) / 2;
  const insideByConvention = isInsideRoom(room, midX - uy * SIDE_PROBE_PX, midY + ux * SIDE_PROBE_PX);
  const insideAgainstIt = isInsideRoom(room, midX + uy * SIDE_PROBE_PX, midY - ux * SIDE_PROBE_PX);
  const reversed = insideAgainstIt && !insideByConvention;
  const ox = reversed ? -uy : uy;
  const oy = reversed ? ux : -ux;

  // The corner rule first: on a chamfer the closet is the corner, whatever `options` asks.
  const apex = chamferCorner(walls, wall, ox, oy);
  if (apex) {
    return { shape: "corner", onWall: [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }], beyond: [apex] };
  }

  // The rectangle. The door's width is its drawn width, already capped to the wall.
  const doorWidthFeet = symbolWidthFeet(door, room) ?? DEFAULT_WIDTH_FEET.door;
  const askedWidthFeet = options.widthFeet ?? doorWidthFeet + CLOSET_WIDTH_MARGIN_FEET;
  const widthPx = Math.min(wall.lengthPx, Math.max(CLOSET_MIN_WIDTH_FEET, askedWidthFeet) * PIXELS_PER_FOOT);
  // A depth under the shortest legal wall would draw a room `isDegenerate` refuses to edit.
  const depthPx = Math.max(MIN_WALL_PX, (options.depthFeet ?? CLOSET_DEFAULT_DEPTH_FEET) * PIXELS_PER_FOOT);
  const centrePx = symbolCentrePx(door, room);
  const fromPx = Math.min(wall.lengthPx - widthPx, Math.max(0, centrePx - widthPx / 2));

  const ax = wall.x1 + ux * fromPx;
  const ay = wall.y1 + uy * fromPx;
  const bx = ax + ux * widthPx;
  const by = ay + uy * widthPx;
  return {
    shape: "rectangle",
    onWall: [{ x: ax, y: ay }, { x: bx, y: by }],
    beyond: [{ x: bx + ox * depthPx, y: by + oy * depthPx }, { x: ax + ox * depthPx, y: ay + oy * depthPx }],
  };
}

/**
 * The closet behind a door: a new room on the far side of the door's wall, sized from the door.
 *
 * Closets are too small to scan and too awkward to tap — the phone cannot get far enough back from
 * the walls to see them, and a PM standing in a bedroom is not going to walk into every closet to
 * measure it. What the scan DOES see, and what a PM draws first by hand, is the closet door in the
 * bedroom's wall. So the closet is drawn from that: a rectangle standing against the outside of the
 * wall, one edge on the wall's line, centred on the door, and the PM drags or types its walls to
 * fit. The office sketch this was built against has exactly such a closet — a 4'6" x 2'1"
 * "Untitled room" drawn by hand beside its door. On a chamfer the closet is the corner the chamfer
 * cut off instead — see below.
 *
 * It is a plain room. Nothing marks it as a closet but its name, so it gets everything a room gets
 * — its own walls to mark moisture on, its own quantities, its own line in the summary — and it
 * becomes a sub-room the moment it is dragged inside the room it opens off (`withDerivedParents`).
 *
 * ── Size ─────────────────────────────────────────────────────────────────────────────────────
 * Width is the door's plus `CLOSET_WIDTH_MARGIN_FEET`, never under `CLOSET_MIN_WIDTH_FEET` and
 * never longer than the wall it stands against — a closet wider than the room is not behind that
 * room's door. Depth is `CLOSET_DEFAULT_DEPTH_FEET`. `options` overrides either, and is clamped the
 * same way. The closet is centred on the door as DRAWN (`symbolCentrePx`, which keeps a door on
 * its wall whatever `t` says) and slid along the wall when centring would put an end past a
 * corner: a closet whose door is in the corner lines up with the corner, which is where such
 * closets are.
 *
 * ── Which side is behind ─────────────────────────────────────────────────────────────────────
 * Outside is the side of the wall the room's floor is NOT on. That is settled by asking
 * `isInsideRoom` about a point a few pixels off the wall on each side, not by taking the clockwise
 * convention on trust. Every room is SUPPOSED to be wound clockwise, but `ensureClockwise` exists
 * precisely because polygons arrive either way — from a file, from a scan, from a drag that turned
 * a room inside out — and a closet drawn INTO the room on a reversed one would be wrong in the one
 * way nobody checks. Only when the probe cannot decide (a self-crossing outline can read as inside
 * on both sides) does the convention stand in. Orientation follows the wall: on an angled wall the
 * closet is a rotated rectangle, flush to that wall.
 *
 * ── The corner behind a chamfer ──────────────────────────────────────────────────────────────
 * "The closet that would be in the last room in the chamfer would effectively fill the rectangle
 * out behind it. It's not just a 2' push behind it." — the user, on the first version, which drew
 * the rectangle on every wall. A chamfer is a short diagonal wall cutting off a room's corner, and
 * the closet behind a door in it IS that corner: the triangle between the diagonal and the point
 * where the two walls either side of it would have met. The bedroom that showed it was a 16'7" x
 * 11'9" rectangle with a 3'6" chamfer (2'6" legs) holding a 2'6" door; a 2' rectangle pushed out
 * at 45 degrees overhangs both of the room's real walls and is not the shape of anything a framer
 * built.
 *
 * So, before the rectangle: with w the door's wall, p the wall before it in the ring (ending at
 * w's start) and n the wall after (starting at w's end), X is where line(p) meets line(n), and the
 * closet is the triangle [w.start, w.end, X] when all of these hold —
 *
 *   (a) p and n turn against each other by at least `CHAMFER_MIN_TURN_DEG`. Parallel lines meet
 *       nowhere and near-parallel ones meet in the next street: the short connecting wall of an L
 *       and the back of a bay are not chamfers, and a door in either gets the rectangle.
 *   (b) X is on the outward side of w — the side the rectangle would be drawn on, settled by the
 *       same probe — and far enough off it for the triangle to be a room `isDegenerate` would let
 *       the PM edit. A diagonal across an INSIDE corner has its X on the room's own floor; what is
 *       behind that wall is the room itself.
 *   (c) both legs, |w.start - X| and |w.end - X|, are at most `CHAMFER_FILL_MAX_FEET`. A corner
 *       closet is a corner. A long diagonal wall whose neighbours would meet fourteen feet away is
 *       a wall — the house is on an angle there, and what is behind it is somebody's room.
 *   (d) neither leg is longer than w itself. A cut ACROSS a corner leaves the chamfer as the
 *       triangle's longest side — always, at any square or obtuse corner, since the right or wide
 *       angle is at X. What this rules out is the straight wall BESIDE a chamfer: its neighbours
 *       (the chamfer and the far wall) also meet outward, close by and at a fair angle, but that
 *       triangle has its right angle at the room's own corner, so the leg across from it is longer
 *       than the wall. Without (d), a door on the 5' wall beside a 3' chamfer in a small bathroom
 *       got a 12 sq ft triangle drawn behind a straight wall.
 *
 * The corner has its own size: `options.depthFeet` and `widthFeet` are ignored on a chamfer, since
 * a triangle that does not reach the corner is not the corner and one that does has no other size
 * to be. Everything else — name, level, ceiling, no symbols — is as for the rectangle. Three
 * vertices is the least a room may have (`MIN_VERTICES`) and this one is a room like any other; if
 * the framer squared the back off, the PM drags the apex.
 *
 * ── What stays where ─────────────────────────────────────────────────────────────────────────
 * The door stays on the parent's wall and the closet has no symbols. Rooms are not joined in this
 * model (see the file header), so a door between two rooms belongs to exactly one of them, and as
 * the `DoorSymbol` doc puts it, "out of one room is into the next": the bedroom's closet door is a
 * door in the bedroom's wall, which is where it was drawn and where the wall-area deduction reads.
 *
 * ── What it does not do ──────────────────────────────────────────────────────────────────────
 * No overlap check. The space behind a wall may already hold another room — the hall, the closet
 * of the room next door — and the new closet is drawn over it regardless; the PM drags it into
 * place, and refusing to draw would leave nothing to drag. And it is never called on its own: a
 * door in a wall is not evidence of a closet behind it, so the PM asks, per door. (The scan
 * importer's "Add closets" offer asks once for all of them, and uses `closetExistsBehind` to skip a
 * door whose closet the PM has already drawn by hand — or that an earlier door in the same batch
 * has just drawn, as two doors on one chamfer would.)
 *
 * Returns null when `doorId` is not a door of `room`.
 */
export function closetBehindDoor(
  room: SketchRoom,
  doorId: string,
  options: { depthFeet?: number; widthFeet?: number } = {},
): SketchRoom | null {
  const footprint = closetFootprint(room, doorId, options);
  if (!footprint) return null;
  const corners: Vertex[] = [...footprint.onWall, ...footprint.beyond].map(({ x, y }) => ({ id: newSketchId("v"), x, y }));

  const closet: SketchRoom = {
    id: newSketchId("room"),
    name: "Closet",
    vertices: ensureClockwise(corners),
    ceilingHeightFeet: room.ceilingHeightFeet ?? DEFAULT_CEILING_HEIGHT_FEET,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
  };
  // The storey is copied only when the room carries one: `level` is optional so a sketch drawn
  // before levels existed still loads, `roomLevel` reads a missing one as the main level, and
  // nothing writes undefined.
  return room.level === undefined ? closet : { ...closet, level: room.level };
}

/**
 * Which shape `closetBehindDoor` would draw behind this door — "corner" on a chamfer, "rectangle"
 * anywhere else — so the UI can say so before the PM presses the button. Null when `doorId` is not
 * a door of `room`, exactly as `closetBehindDoor` would be. Decided from the same outline, so the
 * two cannot disagree.
 */
export function closetShapeBehindDoor(room: SketchRoom, doorId: string): "corner" | "rectangle" | null {
  return closetFootprint(room, doorId)?.shape ?? null;
}

/**
 * Is there already a closet behind this door?
 *
 * "Already" is geometric, not by name: some OTHER room on the same storey has a corner within
 * `CLOSET_SAME_PLACE_PX` of BOTH of the corners the closet would put on the door's wall. Those two
 * are the corners that never move between the shapes — the rectangle's near edge, the triangle's
 * base. For the rectangle the pair sits INSIDE the wall, a door's width apart, and no room next
 * door shares two such points: it shares the wall's line, and at most its ends. For the corner
 * (and for a rectangle clamped to the whole of a short wall) the pair IS the wall's ends, and a
 * room that already spans them — the room next door drawn with an edge on the chamfer — has
 * already taken the space the closet would fill, so "already there" is the same answer by another
 * route. Only the wall-side pair is compared, so a closet the PM has deepened or squared off still
 * counts as there.
 *
 * Same storey only, because rooms on different levels overlap in plan as a matter of course: the
 * closet upstairs is not the closet down here. The room the door is in is never its own closet.
 *
 * Used by the scan importer's "Add closets" offer to leave alone a door the PM has already drawn a
 * closet behind by hand. The button on the door itself does not ask — the PM may want two, and a
 * button that sometimes does nothing is worse than a closet to delete.
 */
export function closetExistsBehind(rooms: SketchRoom[], room: SketchRoom, doorId: string): boolean {
  const footprint = closetFootprint(room, doorId);
  if (!footprint) return false;
  const level = roomLevel(room);
  const hasCornerAt = (other: SketchRoom, at: { x: number; y: number }) =>
    other.vertices.some((v) => Math.hypot(v.x - at.x, v.y - at.y) <= CLOSET_SAME_PLACE_PX);
  return rooms.some(
    (other) => other.id !== room.id && roomLevel(other) === level && footprint.onWall.every((at) => hasCornerAt(other, at)),
  );
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
  /**
   * Doors and windows in other rooms' walls that this room shares — seen from this side, with no
   * wall behind them to finish, but belonging to the other room. See `openingsSharedWith`.
   */
  sharedOpenings: { label: string; wall: number; widthFeet: number | null; withRoom: string }[];
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
      const width = symbolWidthFeet(symbol, room, sketch.rooms);
      const common = {
        type: symbol.type,
        wall: wallNumber.get(symbol.wallId) ?? 0,
        offsetFeet: wall?.lengthFeet == null ? null : round2(symbolCentrePx(symbol, room, sketch.rooms) / PIXELS_PER_FOOT),
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
    sharedOpenings: openingsSharedWith(room, sketch.rooms).map(({ room: theirs, symbol, wallId }) => {
      const width = symbolWidthFeet(symbol, theirs, sketch.rooms);
      const label =
        symbol.type !== "door" ? "Window" : symbol.doorType === "opening" ? "Opening (no door)" : `${DOOR_LEAVES_LABEL[symbol.leaves]} ${DOOR_TYPE_LABEL[symbol.doorType].toLowerCase()} door`;
      return { label, wall: wallNumber.get(wallId) ?? 0, widthFeet: width == null ? null : round2(width), withRoom: theirs.name.trim() || "Unnamed room" };
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
  const walls = freeWallSummaryLines(sketch);
  if (rooms.length === 0 && walls.length === 0) return "";

  const roomText = rooms
    .map((room) => {
      const shape = room.wallCount === 4 ? "" : ` (${room.wallCount}-sided)`;
      // "Sub-room of", not "inside": a closet pulled off a bedroom's wall is the bedroom's without
      // being within it, and the estimator reads this.
      const within = room.withinRoom ? ` — sub-room of ${room.withinRoom}` : "";
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

      // The other room's door in a shared wall: no wall there to finish from this side either.
      for (const shared of room.sharedOpenings) {
        const width = shared.widthFeet == null ? "" : `, ${formatFeetInches(shared.widthFeet)} wide`;
        lines.push(`  ${shared.label} — wall ${shared.wall}, shared with ${shared.withRoom}${width}`);
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

  return [roomText, walls.join("\n")].filter((part) => part !== "").join("\n\n");
}

/**
 * The free walls, one line each: the run of pieces, the height when it is not full, and the room
 * the wall stands in. Kept beside `sketchSummaryText` for the same reason it keeps beside
 * `sketchOutput` — a wall that is drawn but never reported is a wall nobody prices.
 */
function freeWallSummaryLines(sketch: Sketch): string[] {
  const walls = freeWallsOf(sketch);
  if (walls.length === 0) return [];
  return [
    "Free walls",
    ...walls.map((wall, i) => {
      const pieces = freeWallSegments(wall);
      const run = pieces.map((p) => formatFeetInches(p.lengthFeet)).join(" + ");
      const host = pieces[0] ? freeWallSegmentRoom(pieces[0], wall, sketch) : null;
      const where = host ? ` in ${host.name.trim() || "Unnamed room"}` : "";
      const height = wall.heightFeet == null ? "full height" : `${formatFeetInches(wall.heightFeet)} high`;
      return `  Wall ${i + 1} — ${run}${pieces.length > 1 ? ` (${pieces.length} pieces)` : ""}, ${height}${where}`;
    }),
  ];
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
  /** Rooms already named on the sketch — including the names the phone sent with a scan. */
  sketchRooms?: { roomName: string }[] | null;
}): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const list of [sources.extractionRooms, sources.dgigRooms, sources.contentsRooms, sources.sketchRooms]) {
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
