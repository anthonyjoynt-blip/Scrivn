/**
 * Importing a scanned room — the JSON the ARCore capture prototype writes — as a sketch room.
 *
 * The scanner fits a rectangle: two facing walls on each of two axes, each wall carrying the gaps
 * it found in the chest-height band, classified as door / opening / window / something else. That
 * is a strict subset of what a `SketchRoom` can say, which is what makes the import mechanical:
 * the rectangle becomes the four vertices, the ceiling height becomes `ceilingHeightFeet`, and each
 * door or window becomes a wall symbol at the fraction along the wall where the scanner saw it.
 *
 * Since 2026-09-17 (evening) the scanner can also say where the rectangle is wrong: an `outline`
 * polygon in the same frame, with the closet notch at the far end of the office (13'0" to the closet
 * face across 4'2", 15'0" across the rest) and the chamfered door corner, when its cells supported
 * them. When it is there the polygon is the room; the four walls are still the four walls, and the
 * openings on them are laid onto whichever polygon edge is that wall — or, for a door sitting in a
 * chamfer, the nearest edge. A file without `outline` is the rectangle it always was.
 *
 * Since 2026-09-17 (night) there is a second way the phone can arrive at that polygon: tap to
 * measure. The continuous lap was fragile on this phone — ARCore loses tracking in dim light or
 * once the phone is warm, and the map ends up holding shifted copies of the room — while the depth
 * itself was accurate to an inch. So the PM points the phone at each wall and each opening and taps;
 * the phone measures from the depth image and the rotation sensor, and a tracking loss between taps
 * costs nothing. A taps file has `source: "taps"`, an `outline` that IS the room (every corner was
 * tapped, so it can be a triangle, and there is no rectangle to fall back on), openings listed
 * against the outline's edges as `outline_openings`, and an empty `walls`. The two-walls-per-axis
 * rule is the rectangle's rule; a file that brings its own polygon does not need it.
 *
 * Since 2026-09-19 (the big basement room: fifteen corners, a hall partition, a stair, and the
 * bookcase corner five feet off) a taps file can carry three more things, each of which the sketch
 * already had a home for and the phone had no way to give it:
 *
 *  - A PARTITION END. A thin wall — the hall wall, 4½" thick — that runs into the room and stops
 *    has two corners inches apart, and the phone's same-corner rule would fold them into one. The
 *    phone now writes the end as TWO consecutive outline vertices, the tapped face and the far face
 *    across the wall's thickness, and the importer keeps both: the rule that collapses a repeated
 *    vertex is a micron wide, so a 0.115 m edge (4½ px at one pixel an inch) comes through as the
 *    real wall it is. The editor's `MIN_WALL_PX` is a rule about DRAGGING — a wall may not be driven
 *    below it, and a wall already below it may not be shortened further — and says nothing about a
 *    wall that arrives short; see `collapsesAWall`. Nothing was relaxed to let the partition in.
 *  - CABINETS, laid on the outline's edges the way openings are (`cabinets`), each with its tier.
 *    The room's polygon runs along the wall BEHIND the cabinet, and the cabinet becomes the wall
 *    symbol the sketch draws by hand: `CabinetSymbol`, with the phone's depth or the tier's default.
 *  - STAIRS (`stairs`). The sketch draws a flight as a room of its own (see `StairsData`), so each
 *    entry becomes an extra `SketchRoom` beside the imported one — the rectangle the four taps
 *    describe, in the same frame, with the direction of travel read off them — and the editor adds
 *    it in the same update, where `withDerivedParents` nests it in the room it stands in. The taps
 *    are squared, not traced, and a side that lands within an inch or three of one of the room's
 *    walls is put flush on it; the stairs loop in `scanToSketchRoom` says why both.
 *
 * Since 2026-09-20 the phone can capture a HOUSE in one session — the family room, the small hall
 * off it, the bathroom off that — and write the lot in ONE file, "arcapture-capture/1", with every
 * room's coordinates in one shared frame. Before, each room was its own Start and Export in its own
 * ARCore session, so where the rooms stood relative to each other was lost at the door and the PM
 * dragged each one up against the last by eye. Now they land here as they stand in the building,
 * and the PM types the tape where the phone was rough. Each room in a capture is exactly the object
 * a one-room file is, so a room is read by the same validators whichever file it arrives in; what
 * changes is the FRAME. A one-room file's polygon has its own top-left put at `at`. A capture's
 * rooms are all built against one origin — the top-left of the union of their outlines, which is
 * what lands at `at` — so the same metre in two rooms' outlines becomes the same pixel, a wall two
 * rooms share is one line on the sketch rather than two a pixel apart, and a room a metre to the
 * right of another comes in a metre to the right. The first room becomes `room` (selected, named,
 * dragged by the PM) and the rest ride in `extraRooms` ahead of the stairs, so the editor's one
 * update adds them all and `withDerivedParents` sees them together: the hall beside the family
 * room is a neighbour, not a sub-room, because none of its corners is inside the other.
 *
 * A door between two rooms is tapped from ONE of them — that is the phone's guidance — and lands
 * on that room's wall. One tapped from both sides comes in twice, once on each room's wall, and
 * nothing here folds the pair: two taps a wall's thickness apart in two rooms' outlines are two
 * symbols to this importer, and guessing which to keep is worse than the PM deleting one. The
 * guidance exists so they do not have to. Closet doors are offered for the first room only, because
 * the editor's offer is built from one room's id and the result names one room's doors whichever
 * shape it came from; a closet door tapped in the third room comes in as the swing door it is,
 * unoffered. The result does say which shape it came from (`kind`), because the notice the editor
 * shows leads differently for the two — see `ScanImportResult`.
 *
 * The scanner speaks metres in its own room-aligned frame (U along one pair of walls, V along the
 * other); the sketch is world pixels at `PIXELS_PER_FOOT`, y down, clockwise. The room's own
 * corner becomes the top-left of wherever the editor chooses to put it. Orientation on the page is
 * arbitrary — the scanner has no idea which way is north and neither does the sketch.
 *
 * ── The JSON: a capture ─────────────────────────────────────────────────────────────────────
 *   {
 *     "format": "arcapture-capture/1",
 *     "source": "taps",
 *     "frame": { "theta_deg": 12.3 },      // the capture's rotation off ARCore's frame; not needed here
 *     "rooms": [ ROOM, ROOM, ... ],        // capture order; each ROOM is the one-room object below,
 *                                          //   plus "name": "Room 1" and "index": 0, with every
 *                                          //   outline and stairs coordinate in the CAPTURE's frame
 *     "epochs": [ ... ],                   // capture-wide; ignored
 *     "taps": [ { ..., "room": 0 }, ... ]  // each tap says which room it belongs to; ignored
 *   }
 * The phone writes this shape when there are two or more rooms and the one-room shape below when
 * there is one, so a single room keeps importing through every path it always did. The file is
 * told apart by its `format` alone — NOT by the presence of `rooms`, which a Scrivn sketch file
 * also has, and which must still be refused as "not a room scan".
 *
 * ── The JSON: one room ──────────────────────────────────────────────────────────────────────
 *   {
 *     "format": "arcapture-room/1",        // optional; older files from the analysis script have none
 *     "name": "Office",                    // optional
 *     "source": "taps",                    // optional; the lap writes its .ply name, tapping writes "taps"
 *     "ceiling_m": 2.62,                   // null when the scan never saw the ceiling
 *     "outline": [[-1.4, -4.06], ...],     // optional; (u, v) metres, clockwise with u right and v down
 *     "outline_openings": [                // optional; openings against the outline's edges
 *       { "edge": 3, "from_m": 0.0, "width_m": 1.295, "kind": "door",
 *         "sill_m": null, "head_m": null }
 *     ],
 *     "cabinets": [                        // optional; runs of cabinets against the outline's edges
 *       { "edge": 2, "from_m": 1.0, "width_m": 1.8, "tier": "base", "depth_m": 0.61 }
 *     ],
 *     "stairs": [                          // optional; flights, four tapped corners each
 *       { "corners": [[u, v], [u, v], [u, v], [u, v]], "run_m": 3.0, "width_m": 0.9,
 *         "direction": "up" }
 *     ],
 *     "walls": [
 *       { "axis": "across", "offset_m": -0.27, "span_from_m": -1.34, "span_to_m": 2.71,
 *         "openings": [ { "kind": "door", "from_m": 1.4, "width_m": 1.2 } ] },
 *       ...
 *     ]
 *   }
 * `across` walls sit at a V offset and run along U; `along` walls the other way round. An opening's
 * `from_m` is measured from the low end of the wall's span. The `outline` ring is UNCLOSED — the
 * last vertex joins the first by implication, and the phone's writer must not repeat the first
 * point at the end (a closing point, or any repeated vertex, is dropped here so it cannot become a
 * wall of no length, but the writer should not lean on that). An outline opening's `edge` is the
 * polygon edge from vertex i to vertex i+1 and its `from_m` runs from vertex i; `sill_m` and
 * `head_m` are heights off the floor and, for a window, become its sill and its height when they
 * are at least 0.3 m apart (closer than that is two taps at the same height, and the defaults are
 * used). An opening of zero or negative `width_m` — the same jamb tapped twice — is dropped.
 *
 * A cabinet's `edge`, `from_m` and `width_m` mean what an opening's do; `tier` is one of the
 * sketch's three (`base`, `wall`, `full`) and `depth_m` is how far it stands off the wall (the phone
 * writes 0.61 for a base or full-height run and 0.305 for uppers; missing, the tier's default is
 * used). A stairs entry's `corners` are the four taps in the OUTLINE's frame, in tap order — bottom
 * riser left end, bottom riser right end, top riser right end, top riser left end — so the bottom
 * riser is corners 0–1 and the top riser 2–3, and the direction of travel is from the one to the
 * other. `run_m` and `width_m` are the phone's own tally of the same four points — run the mean of
 * |s1-s4| and |s2-s3|, width the mean of |s1-s2| and |s3-s4| — and the importer works the same two
 * numbers out of the corners itself rather than reading them, so the flight it draws agrees with
 * the phone's tally by construction and a file whose tally disagrees with its corners cannot say
 * two things. `direction` is "up" when the flight rises away from the bottom riser, which is every
 * flight tapped from the room it starts in. A malformed cabinet or stairs entry is skipped with a
 * note, never fatal.
 *
 * `outline_notes` are the phone's own sentences about what it could not place — "Cabinet 2 sits
 * 1.95 m (6'5") off every wall – unplaced" — and for a taps file they are passed to the PM word for
 * word, because a run that was tapped and is not on the sketch is exactly what the notice exists
 * to say. The lap fitter writes the same field with its own diagnostics (where it found a notch's
 * step, a chamfer's legs), which are not for the PM and are not passed on; the corner-count note
 * covers the lap.
 *
 * Anything else in the file is ignored, so the analysis script's extra fields (feet-and-inches
 * strings, coverage), the phone's raw `taps` and its `outline_tapped` flags do no harm. Nor do a
 * capture's `frame`, `epochs` and `corrections`: the outline the phone writes already has its
 * corrections and its frame applied, and the rest is the phone's record of how it got there.
 *
 * Only what the scanner is sure of is imported. A gap it could not classify — an unscanned corner,
 * a stretch hidden behind a desk — is left as wall, because a wrong door on the sketch costs more to
 * notice and remove than a missing one costs to add.
 */

import {
  dropDuplicateSharedOpenings,
  type CabinetSymbol,
  type CabinetTier,
  type DoorSymbol,
  type SketchRoom,
  type SketchSymbol,
  type StairsData,
  type Vertex,
  type WallGeometry,
  type WindowSymbol,
  CABINET_DEFAULT_DEPTH_FEET,
  CABINET_DEFAULT_HEIGHT_FEET,
  type CeilingType,
  DEFAULT_CEILING_HEIGHT_FEET,
  formatFeetInches,
  roomBounds,
  DEFAULT_DOOR_HEIGHT_FEET,
  DEFAULT_WINDOW_HEIGHT_FEET,
  DEFAULT_WINDOW_SILL_FEET,
  PIXELS_PER_FOOT,
  STAIRS_DEFAULT,
  ensureClockwise,
  isDegenerate,
  moveSymbolAlongWall,
  newSketchId,
  rectangleVertices,
  wallsOf,
} from "./sketch";

const FEET_PER_METRE = 1 / 0.3048;
const PX_PER_METRE = PIXELS_PER_FOOT * FEET_PER_METRE;

/**
 * How near a side of a tapped flight has to come to one of the room's walls to be put flush on it,
 * in pixels — inches, at this scale. Three is the phone's tap noise: a corner lands within an inch
 * or three of the tape. It is also half the sketch's own `SAME_WALL_TOLERANCE_PX` (lib/sketch.ts),
 * inside which a sub-room's wall already counts as lying on its parent's, so nothing that snaps
 * here was ever going to be read as a wall of its own.
 */
const STAIR_FLUSH_PX = 3;

/** A position in world pixels — a tap once it is in the sketch's frame, before it is a vertex. */
type Point = { x: number; y: number };

export interface ScanOpening {
  kind: string;
  from_m: number;
  width_m: number;
}

export interface ScanWall {
  axis: "across" | "along";
  offset_m: number;
  span_from_m: number;
  span_to_m: number;
  openings: ScanOpening[];
}

/** An opening tapped against the outline: on edge `edge`, `from_m` along it from the edge's start. */
export interface ScanOutlineOpening {
  edge: number;
  kind: string;
  from_m: number;
  width_m: number;
  sill_m: number | null;
  head_m: number | null;
}

/**
 * A run of cabinets tapped against the outline: on edge `edge`, `from_m` along it from the edge's
 * start, `width_m` wide — the same three numbers an opening has, because the phone places both the
 * same way (the nearest edge to the two taps). The tier is the phone's chip; the depth is the tier's
 * standard as the phone writes it, or null when it did not, and then the sketch's own default.
 */
export interface ScanCabinet {
  edge: number;
  from_m: number;
  width_m: number;
  tier: CabinetTier;
  depth_m: number | null;
}

/**
 * A flight of stairs as four tapped corners in the outline's frame, in tap order: bottom riser
 * left end, bottom riser right end, top riser right end, top riser left end. The phone's `run_m`
 * and `width_m` are not kept — the builder works the same two numbers out of these corners, by
 * the phone's own definition, and a second copy of the same number would only ever disagree.
 */
export interface ScanStairs {
  corners: [[number, number], [number, number], [number, number], [number, number]];
  direction: "up" | "down";
}

/**
 * An island as the phone measured it: [u] and [v] its middle in the outline's frame, [width_m] the
 * run and [depth_m] how deep it is — measured when [depth_measured], the tier's own depth when
 * nobody tapped the back edge. [angle_deg] is the run's turn, read by [islandQuarterTurn]:
 * `FreeCabinet` is an axis-aligned block.
 */
export interface ScanIsland {
  number?: number;
  u: number;
  v: number;
  width_m: number;
  depth_m: number;
  depth_measured?: boolean;
  angle_deg?: number;
  /**
   * The footprint's shape, when the phone said one: "triangle" for a CORNER UNIT — a fireplace, a
   * corner shower, a corner pantry — whose legs run along the two walls and whose long face looks
   * into the room. Absent on every file written before corner units were blocks, which reads as a
   * rectangle.
   */
  shape?: string;
  tier?: string;
}

export interface ScanRoom {
  format?: string;
  name?: string;
  /**
   * The room's position in a capture's `rooms` list, as the phone wrote it (its taps say `"room":
   * index`). Absent for a one-room file. The default name of an unnamed capture room is made of it.
   */
  index?: number;
  source?: string;
  ceiling_m?: number | null;
  /**
   * The ceiling's shape and its other end, as the phone's `CeilingFit` read them off the taps.
   *
   * `ceiling_m` is the LOW end whenever these are present, which is what `ceilingHeightFeet`
   * means. `ceiling_run_m` is how far the ceiling travels between the two, measured across the
   * room rather than assumed from its bounding box. `ceiling_measured` false means the phone read
   * no ceiling anywhere and `ceiling_m` is its 8' default, not a measurement. All optional: a file
   * from before the phone measured ceilings has none of them.
   */
  ceiling_type?: string | null;
  ceiling_peak_m?: number | null;
  ceiling_run_m?: number | null;
  ceiling_measured?: boolean | null;
  walls: ScanWall[];
  /** The room polygon in the scanner's (u, v) frame, when the scanner found more than a rectangle. */
  outline?: [number, number][];
  /** Openings placed on the outline's edges, which is how tap-to-measure reports them. */
  outline_openings: ScanOutlineOpening[];
  /** Cabinet runs placed on the outline's edges the same way. Empty for a lap scan. */
  cabinets: ScanCabinet[];
  /**
   * Cabinet runs that stood in open floor rather than against a wall — islands.
   *
   * The phone tells them apart itself (a run more than a cabinet's depth off every wall is not on
   * one) and sends the middle, the size and the turn. Absent from a file written before
   * 2026-09-22, where an island was named in `outline_notes` and sent nowhere at all: a kitchen's
   * island simply did not arrive.
   */
  islands: ScanIsland[];
  /** Flights of stairs tapped in the room, each becoming a room of its own. Empty for a lap scan. */
  stairs: ScanStairs[];
}

/** The `format` a file of several rooms declares; see the header. */
export const CAPTURE_FORMAT = "arcapture-capture/1";

/**
 * A whole capture: several rooms tapped in one session, in one frame. `rooms` is in capture order,
 * each read by the same validators as a one-room file, with its coordinates left where the phone
 * put them — in the capture's shared frame, NOT re-based to the room's own corner. Where each room
 * lands is the builder's business, and for a capture the builder is told the frame once for all.
 */
export interface ScanCapture {
  format: typeof CAPTURE_FORMAT;
  source?: string;
  rooms: ScanRoom[];
}

/**
 * How far off a quarter turn an island's run may be and still be taken as lying on that axis.
 *
 * Generous, because the answer is only ever which of two ways round to draw a rectangle, and the
 * phone's own reading of a run's bearing carries a degree or two of tap noise. Past this the run is
 * at a real angle, which an axis-aligned block cannot say at all.
 */
export const QUARTER_TURN_TOLERANCE_DEG = 20;

/**
 * Which way an island's run lies relative to the room's axes: along the page, across it, or at an
 * angle no quarter turn describes. A run and its reverse are the same run, so the bearing is read
 * modulo 180 degrees.
 */
export function islandQuarterTurn(angleDeg: number | undefined): "along" | "across" | "neither" {
  if (!isFiniteNumber(angleDeg)) return "along";
  const a = ((angleDeg % 180) + 180) % 180;
  if (a <= QUARTER_TURN_TOLERANCE_DEG || a >= 180 - QUARTER_TURN_TOLERANCE_DEG) return "along";
  if (Math.abs(a - 90) <= QUARTER_TURN_TOLERANCE_DEG) return "across";
  return "neither";
}

/**
 * The point of the scanner's frame, in metres, that lands at `at` when a room is built. A one-room
 * import leaves it to the builder, which uses the polygon's own top-left so the room's corner is
 * the drop point; a capture hands every room the same one — the top-left of the union of its rooms
 * — so their pixels agree.
 */
export interface ScanOrigin {
  u: number;
  v: number;
}

export type ScanImportResult =
  | {
      ok: true;
      /**
       * Which shape the file was: one room at the top level, or a capture of rooms. The editor
       * leads its notice by this and by nothing else, because the two shapes' notes start
       * differently: a capture's first note is the importer's own count ("3 rooms imported,
       * placed as tapped.") and a one-room file's notes have no such sentence, so the editor
       * supplies "Room imported." for the one and not the other. It is not something to work out
       * from the result — a capture that came in with ONE drawable room (the other tapped short)
       * still says "1 room imported, placed as tapped.", and counting the rooms would put "Room
       * imported." in front of that.
       */
      kind: "room" | "capture";
      room: SketchRoom;
      /**
       * Rooms that came in alongside the main one, in the same frame as `room` so they land where
       * they were tapped relative to it: for a capture, every room after the first, in capture
       * order; then one per flight of stairs the phone tapped in any room, since the sketch draws
       * a flight as a room (`StairsData`). The editor adds them in the same update as the room,
       * and `withDerivedParents` nests each in the room it stands in — a flight in the room it was
       * tapped in, a neighbouring room in nothing. Empty for a one-room file with no stairs, which
       * is every lap scan.
       */
      extraRooms: SketchRoom[];
      notes: string[];
      /**
       * The doors that were tapped as "closet_door", in wall order. They come in as ordinary swing
       * doors on the room's wall — the sketch has no closet-door type and needs none — but the
       * editor offers to draw the closet behind each one (`closetBehindDoor`), and once the symbol
       * is built nothing else says which doors those were. Empty for a lap scan, which never
       * writes the kind. For a capture these are the FIRST room's alone — see the header.
       */
      closetDoorIds: string[];
    }
  | { ok: false; error: string };

/**
 * How much of the page a file's rooms will take, in world pixels: the union of every room's outline
 * (for a one-room file, the one), at the scale the rooms are built to. `null` when the file will
 * not parse or no room in it has a polygon — the import that follows says why in words.
 *
 * Exists because the editor picks the drop point BEFORE it imports — `importScanRoom` takes `at`
 * and builds against it — and a spot found for a room's default size is not clear for a capture
 * two or three rooms wide: the hall and bathroom lap the room already on the page to the right,
 * and a small room that lands wholly inside an existing one is nested into it by
 * `withDerivedParents`. Sized here, `placeNewRoom` finds a pocket the whole capture fits. The file
 * is parsed twice, once here and once to build; it is a few kilobytes and this stays one call the
 * editor can read, where an `at` that is a callback would not be.
 */
export function scanExtentPx(text: string): { width: number; height: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const checked = parseScan(parsed);
  if (!checked.ok) return null;
  const scans = checked.kind === "capture" ? checked.capture.rooms : [checked.scan];
  const polygons = scans.map(polygonOf).flatMap((shape) => (shape.ok ? [shape.polygon] : []));
  if (polygons.length === 0) return null;
  const us = polygons.flatMap((polygon) => polygon.map((p) => p[0]));
  const vs = polygons.flatMap((polygon) => polygon.map((p) => p[1]));
  return {
    width: Math.round((Math.max(...us) - Math.min(...us)) * PX_PER_METRE),
    height: Math.round((Math.max(...vs) - Math.min(...vs)) * PX_PER_METRE),
  };
}

/** Nearest inch, which is what a tape reads to and the precision the scan actually has. */
function toFeetInches(metres: number): number {
  return Math.round(metres * FEET_PER_METRE * 12) / 12;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCabinetTier(value: unknown): value is CabinetTier {
  return value === "base" || value === "wall" || value === "full";
}

/**
 * Checks the shape of a parsed file. Hand-rolled rather than a schema library because the shape is
 * eight fields and the messages have to say which of them is wrong in words a PM can act on.
 *
 * `notes` is what the parser had to leave out that the PM should hear about: a cabinet or a flight
 * of stairs written wrongly is skipped rather than failing the import — the room is still a room
 * without it — but a skipped one is a tap the PM made and will look for on the sketch, so unlike a
 * malformed opening (dropped silently, as it always was) it is counted and said.
 */
export function parseScanRoom(input: unknown): { ok: true; scan: ScanRoom; notes: string[] } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "This file is not a room scan." };
  const raw = input as Record<string, unknown>;
  const notes: string[] = [];

  // The outline is optional and, when malformed, ignored rather than fatal: the rectangle the
  // walls describe is still a usable room, and a bad polygon must not stop the import. Three
  // points is the floor because a tapped room can be a triangle; the lap's fitter never writes
  // fewer than four.
  let outline: [number, number][] | undefined;
  if (Array.isArray(raw.outline) && raw.outline.length >= 3) {
    const points: [number, number][] = [];
    for (const p of raw.outline) {
      if (!Array.isArray(p) || p.length < 2 || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1])) {
        points.length = 0;
        break;
      }
      points.push([p[0], p[1]]);
    }
    // A repeated vertex would become a wall of no length: the ring closed GeoJSON-style by writing
    // its first point again, or the same corner tapped twice. Either made a zero-length edge that
    // `wallsOf` kept and an opening on it was refused as if its edge did not exist. Consecutive
    // duplicates collapse to one point (a micron apart is the same point) and a closing point that
    // equals the first is dropped; the ring is unclosed from here on.
    const samePoint = (a: [number, number], b: [number, number]): boolean =>
      Math.abs(a[0] - b[0]) <= 1e-6 && Math.abs(a[1] - b[1]) <= 1e-6;
    const ring: [number, number][] = [];
    for (const p of points) {
      const last = ring[ring.length - 1];
      if (last !== undefined && samePoint(last, p)) continue;
      ring.push(p);
    }
    if (ring.length > 1 && samePoint(ring[0] as [number, number], ring[ring.length - 1] as [number, number])) ring.pop();
    if (ring.length >= 3) outline = ring;
  }

  // A taps file writes `walls: []`; a file with an outline and no `walls` at all is read the same
  // way. Without either there is nothing to make a room from, and a sketch file or any other JSON
  // is told so in those words.
  if (!Array.isArray(raw.walls) && outline === undefined) {
    return { ok: false, error: "This file is not a room scan — it has no walls in it." };
  }

  const walls: ScanWall[] = [];
  for (const entry of Array.isArray(raw.walls) ? raw.walls : []) {
    if (typeof entry !== "object" || entry === null) return { ok: false, error: "A wall in the scan is malformed." };
    const w = entry as Record<string, unknown>;
    if (w.axis !== "across" && w.axis !== "along") return { ok: false, error: "A wall in the scan has no axis." };
    if (!isFiniteNumber(w.offset_m) || !isFiniteNumber(w.span_from_m) || !isFiniteNumber(w.span_to_m)) {
      return { ok: false, error: "A wall in the scan has no position." };
    }
    // An opening with no width is no opening: the fitter never writes one, but a zero here would
    // draw a door of no width, and the check costs nothing.
    const openings: ScanOpening[] = [];
    if (Array.isArray(w.openings)) {
      for (const o of w.openings) {
        if (typeof o !== "object" || o === null) continue;
        const op = o as Record<string, unknown>;
        if (typeof op.kind !== "string" || !isFiniteNumber(op.from_m) || !isFiniteNumber(op.width_m) || op.width_m <= 0) continue;
        openings.push({ kind: op.kind, from_m: op.from_m, width_m: op.width_m });
      }
    }
    walls.push({ axis: w.axis, offset_m: w.offset_m, span_from_m: w.span_from_m, span_to_m: w.span_to_m, openings });
  }

  // Outline openings are checked one at a time, like the openings on a wall: a malformed one is
  // dropped, the rest still come in. The edge index is kept as written, out of range or not —
  // the builder skips those and says so, since a tapped opening the PM cannot find on the sketch
  // deserves a note where a silently dropped field does not. A width of zero or less is dropped
  // too: it is what the phone writes when the same jamb is tapped twice, and a door of no width
  // on the sketch is worse than the missing one the PM will notice on the wall.
  const outlineOpenings: ScanOutlineOpening[] = [];
  if (Array.isArray(raw.outline_openings)) {
    for (const o of raw.outline_openings) {
      if (typeof o !== "object" || o === null) continue;
      const op = o as Record<string, unknown>;
      if (
        typeof op.kind !== "string" ||
        !isFiniteNumber(op.edge) ||
        !isFiniteNumber(op.from_m) ||
        !isFiniteNumber(op.width_m) ||
        op.width_m <= 0
      ) {
        continue;
      }
      outlineOpenings.push({
        edge: Math.trunc(op.edge),
        kind: op.kind,
        from_m: op.from_m,
        width_m: op.width_m,
        sill_m: isFiniteNumber(op.sill_m) ? op.sill_m : null,
        head_m: isFiniteNumber(op.head_m) ? op.head_m : null,
      });
    }
  }

  // Cabinets are checked like outline openings — edge, from, width — plus a tier the sketch knows.
  // A cabinet of no width is the same jamb tapped twice, as for an opening. A tier the sketch does
  // not have is a phone this importer has not met, and the cabinet is skipped rather than guessed
  // at: a base run drawn where a wall run was tapped deducts the wrong wall. The depth is kept when
  // it is a sensible number and left to the tier's default otherwise.
  const cabinets: ScanCabinet[] = [];
  let badCabinets = 0;
  if (Array.isArray(raw.cabinets)) {
    for (const c of raw.cabinets) {
      if (typeof c !== "object" || c === null) {
        badCabinets += 1;
        continue;
      }
      const cab = c as Record<string, unknown>;
      if (!isFiniteNumber(cab.edge) || !isFiniteNumber(cab.from_m) || !isFiniteNumber(cab.width_m) || cab.width_m <= 0 || !isCabinetTier(cab.tier)) {
        badCabinets += 1;
        continue;
      }
      cabinets.push({
        edge: Math.trunc(cab.edge),
        from_m: cab.from_m,
        width_m: cab.width_m,
        tier: cab.tier,
        depth_m: isFiniteNumber(cab.depth_m) && cab.depth_m > 0 ? cab.depth_m : null,
      });
    }
  }
  if (badCabinets > 0) notes.push(`${badCabinets} cabinet${badCabinets === 1 ? "" : "s"} in the file could not be read; skipped.`);

  // An island needs a middle and a size and nothing else. A tier the sketch does not have is
  // dropped to "base", which is what an island is nine times in ten, rather than skipping a block
  // of cabinetry the estimator stood in front of and tapped.
  const islands: ScanIsland[] = [];
  let badIslands = 0;
  if (Array.isArray(raw.islands)) {
    for (const i of raw.islands) {
      if (typeof i !== "object" || i === null) {
        badIslands += 1;
        continue;
      }
      const isl = i as Record<string, unknown>;
      if (!isFiniteNumber(isl.u) || !isFiniteNumber(isl.v) || !isFiniteNumber(isl.width_m) || isl.width_m <= 0) {
        badIslands += 1;
        continue;
      }
      islands.push({
        number: isFiniteNumber(isl.number) ? Math.trunc(isl.number) : undefined,
        u: isl.u,
        v: isl.v,
        width_m: isl.width_m,
          // 3', Scrivn's own default island depth, for a file that sends none.
        depth_m: isFiniteNumber(isl.depth_m) && isl.depth_m > 0 ? isl.depth_m : 3 / FEET_PER_METRE,
        depth_measured: isl.depth_measured === true,
        angle_deg: isFiniteNumber(isl.angle_deg) ? isl.angle_deg : 0,
        shape: typeof isl.shape === "string" ? isl.shape : undefined,
        tier: isCabinetTier(isl.tier) ? isl.tier : "base",
      });
    }
  }
  if (badIslands > 0) notes.push(`${badIslands} island${badIslands === 1 ? "" : "s"} in the file could not be read; skipped.`);

  // A flight needs its four corners, each a finite (u, v); anything else about it is optional. The
  // direction defaults to "up" because a flight is tapped from the room it starts in, and from
  // there it can only go up — the phone writes "up" for the same reason.
  const stairs: ScanStairs[] = [];
  let badStairs = 0;
  if (Array.isArray(raw.stairs)) {
    for (const s of raw.stairs) {
      if (typeof s !== "object" || s === null) {
        badStairs += 1;
        continue;
      }
      const flight = s as Record<string, unknown>;
      const corners = Array.isArray(flight.corners) ? flight.corners : [];
      const wellFormed =
        corners.length === 4 && corners.every((p) => Array.isArray(p) && p.length >= 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]));
      if (!wellFormed) {
        badStairs += 1;
        continue;
      }
      // Checked just above; this only copies the two numbers out of whatever else the point carries.
      const point = (p: unknown): [number, number] => {
        const q = p as [number, number];
        return [q[0], q[1]];
      };
      stairs.push({
        corners: [point(corners[0]), point(corners[1]), point(corners[2]), point(corners[3])],
        direction: flight.direction === "down" ? "down" : "up",
      });
    }
  }
  if (badStairs > 0) notes.push(`${badStairs} flight${badStairs === 1 ? "" : "s"} of stairs in the file could not be read; skipped.`);

  // The phone's own word on the taps it could not place, passed on as written — see the header.
  // A taps file only: the lap fitter's notes in the same field are its diagnostics, not the PM's.
  // Said before the importer's own faults with the file, so the notice reads phone first, then
  // what this side could not read.
  if (raw.source === "taps" && Array.isArray(raw.outline_notes)) {
    const said: string[] = [];
    for (const n of raw.outline_notes) {
      if (typeof n === "string" && n.trim() !== "") said.push(n.trim());
    }
    notes.unshift(...said);
  }

  return {
    ok: true,
    scan: {
      format: typeof raw.format === "string" ? raw.format : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
      index: isFiniteNumber(raw.index) ? Math.trunc(raw.index) : undefined,
      source: typeof raw.source === "string" ? raw.source : undefined,
      ceiling_m: isFiniteNumber(raw.ceiling_m) ? raw.ceiling_m : null,
      ceiling_type: typeof raw.ceiling_type === "string" ? raw.ceiling_type : null,
      ceiling_peak_m: isFiniteNumber(raw.ceiling_peak_m) ? raw.ceiling_peak_m : null,
      ceiling_run_m: isFiniteNumber(raw.ceiling_run_m) ? raw.ceiling_run_m : null,
      ceiling_measured: typeof raw.ceiling_measured === "boolean" ? raw.ceiling_measured : null,
      walls,
      outline,
      outline_openings: outlineOpenings,
      cabinets,
      islands,
      stairs,
    },
    notes,
  };
}

/** What a capture room is called in the notice and on the sketch: the phone's name, else its number. */
function captureRoomName(name: string | undefined, index: number): string {
  return name !== undefined && name.trim() !== "" ? name : `Room ${index + 1}`;
}

/**
 * Checks a capture: `rooms`, each through `parseScanRoom`. The capture says `source` once, at the
 * top, and each room means the same, so a room without its own inherits it — that is what lets a
 * room's `outline_notes` through and marks it as tapped, the same as in a one-room file.
 *
 * A room that cannot be read is LEFT OUT with a note, not fatal, on the reasoning that covers a
 * malformed cabinet: the capture is still a capture without it, the others still land where they
 * were tapped, and the PM who tapped the missing one will look for it on the sketch and needs to
 * hear why it is not there. Only a capture with no readable room at all is refused, in words. The
 * note names the room the way the sketch will, so "Room 2" in the notice is "Room 2" on the page.
 */
export function parseScanCapture(input: unknown): { ok: true; capture: ScanCapture; notes: string[] } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "This file is not a room scan." };
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.rooms) || raw.rooms.length === 0) {
    return { ok: false, error: "This capture has no rooms in it." };
  }
  const source = typeof raw.source === "string" ? raw.source : undefined;
  const rooms: ScanRoom[] = [];
  const notes: string[] = [];
  raw.rooms.forEach((entry, position) => {
    if (typeof entry !== "object" || entry === null) {
      notes.push(`Room ${position + 1} in the file is not a room; left out.`);
      return;
    }
    const room = entry as Record<string, unknown>;
    const merged = typeof room.source === "string" || source === undefined ? room : { ...room, source };
    const parsed = parseScanRoom(merged);
    // The phone's index when it wrote one (its taps refer to it), else the room's place in the list.
    const index = parsed.ok && parsed.scan.index !== undefined ? parsed.scan.index : position;
    const name = captureRoomName(typeof room.name === "string" ? room.name : undefined, index);
    if (!parsed.ok) {
      notes.push(`${name}: ${parsed.error} Left out.`);
      return;
    }
    rooms.push({ ...parsed.scan, name, index });
    notes.push(...parsed.notes.map((n) => `${name}: ${n}`));
  });
  if (rooms.length === 0) {
    return { ok: false, error: `None of the ${raw.rooms.length} rooms in this capture could be read.` };
  }
  return { ok: true, capture: { format: CAPTURE_FORMAT, source, rooms }, notes };
}

export type ParsedScan =
  | { ok: true; kind: "room"; scan: ScanRoom; notes: string[] }
  | { ok: true; kind: "capture"; capture: ScanCapture; notes: string[] }
  | { ok: false; error: string };

/**
 * Either shape. The capture is told apart by its `format` and nothing else: a Scrivn sketch file
 * has a `rooms` list too, and it must go on being refused as "not a room scan — it has no walls",
 * which is what the one-room parser says of it.
 */
export function parseScan(input: unknown): ParsedScan {
  if (typeof input === "object" && input !== null && (input as Record<string, unknown>).format === CAPTURE_FORMAT) {
    const parsed = parseScanCapture(input);
    return parsed.ok ? { ok: true, kind: "capture", capture: parsed.capture, notes: parsed.notes } : parsed;
  }
  const parsed = parseScanRoom(input);
  return parsed.ok ? { ok: true, kind: "room", scan: parsed.scan, notes: parsed.notes } : parsed;
}

/**
 * The scanner's vocabulary, reduced to what the sketch can draw.
 *
 * "door" is a floor-to-header gap of door width; "opening" is a wider one — a cased opening or a
 * missing wall. "window" (the analysis script writes it with a question mark, honestly) is a gap
 * with wall still below it. Tapping adds "closet_door", which the sketch draws as the swing door
 * it is — the closet itself is the notch in the outline, not the door. It is kept distinct here
 * rather than folded into "door" because the editor offers to draw a closet behind each one, and
 * the symbol itself cannot say which doors those were. Everything else — hidden behind furniture,
 * a corner the scan never reached, a recess — is not an opening and is not imported.
 */
function openingKind(kind: string): "door" | "closet_door" | "opening" | "window" | null {
  const k = kind.toLowerCase();
  if (k === "door") return "door";
  if (k === "closet_door") return "closet_door";
  if (k === "opening") return "opening";
  if (k.startsWith("window")) return "window";
  return null;
}

/**
 * The polygon a scan describes, in its own metres: the scanner's outline when it sent one, else
 * the rectangle the four walls describe, in the same clockwise order (top-left, top-right,
 * bottom-right, bottom-left). One path for both, so a four-point outline is the rectangle exactly,
 * openings and all. The two-walls-per-axis rule only applies when the rectangle is all there is: a
 * tapped room has an outline and no walls at all.
 *
 * Its own function because a capture needs every room's polygon BEFORE any room is built, to find
 * the one origin they are all built against; a one-room import asks for it once, on the way in.
 */
function polygonOf(scan: ScanRoom): { ok: true; polygon: [number, number][] } | { ok: false; error: string } {
  if (scan.outline !== undefined) return { ok: true, polygon: scan.outline };
  const across = scan.walls.filter((w) => w.axis === "across").sort((a, b) => a.offset_m - b.offset_m);
  const along = scan.walls.filter((w) => w.axis === "along").sort((a, b) => a.offset_m - b.offset_m);
  if (across.length !== 2 || along.length !== 2) {
    return {
      ok: false,
      error: `The scan needs two facing walls on each side to make a room; it has ${across.length} and ${along.length}.`,
    };
  }
  // The rectangle in the scanner's frame: U between the `along` walls, V between the `across` ones.
  const u0 = (along[0] as ScanWall).offset_m;
  const u1 = (along[1] as ScanWall).offset_m;
  const v0 = (across[0] as ScanWall).offset_m;
  const v1 = (across[1] as ScanWall).offset_m;
  return {
    ok: true,
    polygon: [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ],
  };
}

/**
 * The ceiling the phone measured, as the sketch records one.
 *
 * The phone fits a plane to the ceiling height it reads at every corner and sends what that plane
 * says: the low end as `ceiling_m`, the shape, the high end, and the run between them measured
 * ACROSS the room. Only the run is new information the sketch could not have worked out for
 * itself — see `SketchRoom.ceilingRunFeet`.
 *
 * Everything here is defensive about the wire: a file from before the phone measured ceilings has
 * none of these keys and comes out flat, exactly as it did before; a peak at or under the low end
 * is not a rise and the room is flat whatever the shape said; a shape this does not recognise is
 * treated as flat rather than guessed at.
 */
function ceilingShape(
  scan: ScanRoom,
  lowFeet: number | null,
): { type: CeilingType; peakFeet: number | null; runFeet: number | null; measured: boolean | undefined } {
  const flat = { type: "flat" as CeilingType, peakFeet: null, runFeet: null };
  // `undefined` rather than true when the phone said nothing: an older file's height is neither a
  // measurement nor known not to be one, and the sketch has never claimed to know.
  const measured = scan.ceiling_measured == null ? undefined : scan.ceiling_measured;
  const type = scan.ceiling_type === "sloped" ? "sloped" : scan.ceiling_type === "vaulted" ? "vaulted" : "flat";
  if (type === "flat") return { ...flat, measured };

  const low = lowFeet ?? DEFAULT_CEILING_HEIGHT_FEET;
  const peak = scan.ceiling_peak_m != null && scan.ceiling_peak_m > 1.5 ? toFeetInches(scan.ceiling_peak_m) : null;
  if (peak === null || peak <= low) return { ...flat, measured };

  const run = scan.ceiling_run_m != null && scan.ceiling_run_m > 0 ? toFeetInches(scan.ceiling_run_m) : null;
  return { type, peakFeet: peak, runFeet: run, measured };
}

/**
 * Builds the sketch room. `at` is where the frame's origin lands, in world pixels, and `level` the
 * storey the room joins; both are the editor's business, not the scan's. `origin` is which point of
 * the scanner's frame that is (`ScanOrigin`): left out, it is the polygon's own top-left, so the
 * room's corner is the drop point; a capture passes the one its rooms share, and then the room
 * lands wherever it stands relative to that.
 */
export function scanToSketchRoom(scan: ScanRoom, at: { x: number; y: number }, level: number, origin?: ScanOrigin): ScanImportResult {
  const shape = polygonOf(scan);
  if (!shape.ok) return shape;
  const polygon = shape.polygon;

  // The polygon's own top-left, which for the rectangle is (u0, v0) and for a notched or chamfered
  // one may be a vertex the rectangle never had. The size check is the room's own whatever the
  // origin; the origin defaults to this corner.
  const minU = Math.min(...polygon.map((p) => p[0]));
  const minV = Math.min(...polygon.map((p) => p[1]));
  const width = Math.max(...polygon.map((p) => p[0])) - minU;
  const depth = Math.max(...polygon.map((p) => p[1])) - minV;
  if (width < 0.5 || depth < 0.5) return { ok: false, error: "The scanned room is too small to be a room." };

  const { x, y } = at;
  const { u: originU, v: originV } = origin ?? { u: minU, v: minV };
  // Whole pixels: one pixel is one inch, and the scan is not better than that. Rounded from the
  // origin, not from the room's own corner, so two rooms built against one origin put the same
  // metre on the same pixel.
  const toPx = (p: [number, number]): { x: number; y: number } => ({
    x: x + Math.round((p[0] - originU) * PX_PER_METRE),
    y: y + Math.round((p[1] - originV) * PX_PER_METRE),
  });
  // `ring` is the polygon in the file's own order, which is what an outline opening's edge index
  // counts along; `vertices` is the same ring wound clockwise, which for a well-formed file is the
  // same array and for a reversed one is not.
  const ring: Vertex[] = polygon.map((p) => ({ id: newSketchId("v"), ...toPx(p) }));
  const vertices: Vertex[] = ensureClockwise(ring);
  if (isDegenerate(vertices)) {
    return { ok: false, error: "The scanned outline folds over itself; the scan needs redoing." };
  }

  const ceiling = scan.ceiling_m != null && scan.ceiling_m > 1.5 ? toFeetInches(scan.ceiling_m) : null;
  const overhead = ceilingShape(scan, ceiling);
  const room: SketchRoom = {
    id: newSketchId("room"),
    name: scan.name ?? "",
    vertices,
    ceilingHeightFeet: ceiling ?? DEFAULT_CEILING_HEIGHT_FEET,
    ceilingType: overhead.type,
    ceilingPeakFeet: overhead.peakFeet,
    ceilingRunFeet: overhead.runFeet,
    ceilingMeasured: overhead.measured,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    level,
  };
  const walls = wallsOf(room);

  const symbols: SketchSymbol[] = [];
  /** The ids of the doors that were tapped as closet doors — see `ScanImportResult`. */
  const closetDoors = new Set<string>();
  const notes: string[] = [];
  let skipped = 0;

  /*
    Islands: cabinet runs the phone found standing in open floor. `FreeCabinet` is an axis-aligned
    block positioned from the room's bounding-box top-left, so the middle the phone sends becomes a
    top-left by half its size.

    The run's turn USED to be dropped here, and the kitchen of 2026-09-23 is what that cost: an
    island tapped at -90.9 deg arrived square to the room, so a 7'9" run across a 3'0" one was
    drawn as a 3'0" run across a 7'9" one — a quarter turn from where the estimator had stood to
    tap it, and the first thing they said about the sketch.

    A quarter turn needs no rotation, which is why it can be fixed here and a true diagonal cannot:
    an island lying across the room is the same block with its width and depth swapped. So a run
    within [QUARTER_TURN_TOLERANCE_DEG] of the room's cross axis is swapped, one along the room is
    left as it is, and anything else — an island at 30 deg, which no swap describes — is left square
    with a note, because a block the estimator can see is wrong and drag is better than one quietly
    turned to an angle it is not at.
  */
  const bounds = roomBounds(room);
  const feetInchesText = (metres: number): string => formatFeetInches(toFeetInches(metres));
  for (const isl of scan.islands) {
    /*
      A BLOCK NOW KEEPS ITS OWN TURN. Until blocks could be turned, the only thing that could be
      done with the angle the phone recorded was to round it to the nearest quarter and swap the
      width and depth for a run lying across the page — so a fireplace standing at 45 degrees in a
      corner arrived square, and everything between the quarters was thrown away.

      A turned block draws and prices at its real angle, so the angle comes through as it was
      measured and the width and depth stay the run's own. `islandQuarterTurn` is still what decides
      whether the NOTE calls it along or across, which is a sentence for a person, not geometry.
    */
    const turn = islandQuarterTurn(isl.angle_deg);
    const acrossM = isl.width_m;
    const downM = isl.depth_m;
    const widthPx = Math.max(1, Math.round(acrossM * PX_PER_METRE));
    const depthPx = Math.max(1, Math.round(downM * PX_PER_METRE));
    const middle = toPx([isl.u, isl.v]);
    const triangle = isl.shape === "triangle";
    room.freeCabinets.push({
      id: newSketchId("island"),
      x: middle.x - widthPx / 2 - bounds.minX,
      y: middle.y - depthPx / 2 - bounds.minY,
      widthPx,
      depthPx,
      widthFeet: toFeetInches(acrossM),
      depthFeet: toFeetInches(downM),
      label: triangle ? "Corner unit" : "Island",
      tier: (isl.tier ?? "base") as CabinetTier,
      ...(isFiniteNumber(isl.angle_deg) && isl.angle_deg !== 0 ? { angleDeg: isl.angle_deg } : {}),
      ...(triangle ? { shape: "triangle" as const } : {}),
    });
    const which = `Island ${isl.number ?? room.freeCabinets.length}`;
    if (isl.depth_measured !== true) {
      notes.push(`${which}: its depth was not measured on the phone — drawn ${feetInchesText(isl.depth_m)} deep.`);
    }
    if (turn === "neither") {
      notes.push(`${which}: it was tapped at an angle to the room — drawn square, drag it round if it matters.`);
    }
  }

  let flatWindows = 0;

  /**
   * The polygon edge an opening belongs on. First choice: an edge that IS the scanner's wall —
   * runs the same way and sits within 0.3 m of the wall's offset — with the opening's centre within
   * its run. Failing that, a diagonal edge (a chamfer) within 0.5 m of the centre: the door in this
   * room's chamfer is reported on one of the walls the chamfer joins, past the end of the edge that
   * wall became. An opening past the end of a wall with no chamfer there is what it always was, a
   * fitting artefact, and is not moved onto the neighbouring wall.
   */
  const edgeFor = (wall: ScanWall, centre: { x: number; y: number }): { wall: WallGeometry; t: number } | null => {
    const horizontal = wall.axis === "across";
    const offsetPx = horizontal ? y + (wall.offset_m - originV) * PX_PER_METRE : x + (wall.offset_m - originU) * PX_PER_METRE;
    let best: { wall: WallGeometry; t: number; d: number } | null = null;
    let diagonal: { wall: WallGeometry; t: number; d: number } | null = null;
    for (const w of walls) {
      if (w.lengthPx <= 0) continue;
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const raw = ((centre.x - w.x1) * dx + (centre.y - w.y1) * dy) / (w.lengthPx * w.lengthPx);
      const t = Math.min(1, Math.max(0, raw));
      const d = Math.hypot(centre.x - (w.x1 + dx * t), centre.y - (w.y1 + dy * t));
      if (dx !== 0 && dy !== 0) {
        if (diagonal === null || d < diagonal.d) diagonal = { wall: w, t, d };
        continue;
      }
      const sameWay = horizontal ? dy === 0 : dx === 0;
      if (!sameWay) continue;
      if (Math.abs((horizontal ? w.y1 : w.x1) - offsetPx) > 0.3 * PX_PER_METRE) continue;
      if (raw < 0 || raw > 1) continue;
      if (best === null || d < best.d) best = { wall: w, t: raw, d };
    }
    if (best !== null) return { wall: best.wall, t: best.t };
    if (diagonal !== null && diagonal.d <= 0.5 * PX_PER_METRE) return { wall: diagonal.wall, t: diagonal.t };
    return null;
  };

  /**
   * The symbol for an opening on a wall, then the same clamp the editor applies when a door is
   * placed by hand: the whole symbol stays on the wall even if the scanner put its centre a few
   * inches from the corner. A window's sill and height are the scanner's when it measured them
   * (tapping does; the lap never did) and the sketch's defaults when it did not.
   *
   * "Measured" means at least a foot of glass between sill and head. The phone takes the sill from
   * the lower jamb tap and the head from the higher, so a pair of taps aimed at chest height on
   * both jambs comes in as sill 1.19 m, head 1.21 m — a window an inch tall at 3'11", drawn as a
   * line where the 3' sill and 4' of glass it would have defaulted to were right. No real window is
   * under a foot tall; that pair is two taps at the same height and is treated as no measurement.
   */
  const place = (
    kind: "door" | "closet_door" | "opening" | "window",
    placed: { wall: WallGeometry; t: number },
    width_m: number,
    elevation: { sill_m: number | null; head_m: number | null },
  ): void => {
    const widthFeet = toFeetInches(width_m);
    const base = {
      id: newSketchId(kind === "window" ? "window" : "door"),
      wallId: placed.wall.id,
      t: placed.t,
      widthFraction: (widthFeet * PIXELS_PER_FOOT) / placed.wall.lengthPx,
      widthFeet,
    };
    const both = elevation.sill_m !== null && elevation.head_m !== null;
    const measured = both && (elevation.head_m as number) - (elevation.sill_m as number) >= 0.3;
    if (kind === "window" && both && !measured) flatWindows += 1;
    const symbol: DoorSymbol | WindowSymbol =
      kind === "window"
        ? {
            ...base,
            type: "window",
            heightFeet: measured ? toFeetInches((elevation.head_m as number) - (elevation.sill_m as number)) : DEFAULT_WINDOW_HEIGHT_FEET,
            sillFeet: measured ? toFeetInches(elevation.sill_m as number) : DEFAULT_WINDOW_SILL_FEET,
          }
        : {
            ...base,
            type: "door",
            doorType: kind === "opening" ? "opening" : "swing",
            leaves: "single",
            heightFeet: DEFAULT_DOOR_HEIGHT_FEET,
            flipX: false,
            flipY: false,
          };
    symbols.push(moveSymbolAlongWall(symbol, room, placed.t * placed.wall.lengthPx));
    if (kind === "closet_door") closetDoors.add(symbol.id);
  };

  for (const wall of scan.walls) {
    for (const opening of wall.openings) {
      const kind = openingKind(opening.kind);
      if (kind === null) {
        skipped += 1;
        continue;
      }
      // The opening's centre in the scanner's frame, then in world pixels the way the vertices went.
      const along_m = wall.span_from_m + opening.from_m + opening.width_m / 2;
      const centreUV: [number, number] = wall.axis === "across" ? [along_m, wall.offset_m] : [wall.offset_m, along_m];
      const centre = {
        x: x + (centreUV[0] - originU) * PX_PER_METRE,
        y: y + (centreUV[1] - originV) * PX_PER_METRE,
      };
      const placed = edgeFor(wall, centre);
      if (placed === null) {
        skipped += 1;
        continue;
      }
      place(kind, placed, opening.width_m, { sill_m: null, head_m: null });
    }
  }

  /**
   * An outline opening names its edge outright, so there is nothing to search for: edge i runs
   * from ring vertex i to i+1, and the opening's centre is `from_m + width_m / 2` along it in the
   * metres the file was written in. If the ring had to be reversed to wind clockwise, that edge is
   * the wall that starts at vertex i+1 and runs the other way, so the fraction flips with it.
   */
  const outlineEdge = (edge: number, centre_m: number): { wall: WallGeometry; t: number } | null => {
    const n = ring.length;
    if (!Number.isInteger(edge) || edge < 0 || edge >= n) return null;
    const from = ring[edge] as Vertex;
    const to = ring[(edge + 1) % n] as Vertex;
    const length_m = Math.hypot(
      (polygon[(edge + 1) % n] as [number, number])[0] - (polygon[edge] as [number, number])[0],
      (polygon[(edge + 1) % n] as [number, number])[1] - (polygon[edge] as [number, number])[1],
    );
    if (length_m <= 0) return null;
    const t = Math.min(1, Math.max(0, centre_m / length_m));
    const reversed = vertices !== ring;
    const wall = walls.find((w) => w.id === (reversed ? to.id : from.id));
    if (wall === undefined || wall.lengthPx <= 0) return null;
    return { wall, t: reversed ? 1 - t : t };
  };

  let offOutline = 0;
  for (const opening of scan.outline_openings) {
    const kind = openingKind(opening.kind);
    if (kind === null) {
      skipped += 1;
      continue;
    }
    const placed = outlineEdge(opening.edge, opening.from_m + opening.width_m / 2);
    if (placed === null) {
      offOutline += 1;
      continue;
    }
    place(kind, placed, opening.width_m, { sill_m: opening.sill_m, head_m: opening.head_m });
  }

  /**
   * A cabinet run is placed exactly as an opening is — its edge, its centre along it — and becomes
   * the same `CabinetSymbol` the editor's cabinet tool makes (`newSymbol`), with the phone's tier
   * and depth in place of the tool's defaults. The height is the tier's standard: the phone
   * measures nothing above the counter, and the height only feeds the wall deduction.
   *
   * `moveSymbolAlongWall` gives it the clamp every hand-placed symbol gets, plus the block snap: a
   * run whose end lands within a few inches of the corner is pulled flush, which is where a real
   * run of cabinets is and where a tap aimed at the corner meant to be.
   */
  let cabinetsOff = 0;
  for (const cabinet of scan.cabinets) {
    const placed = outlineEdge(cabinet.edge, cabinet.from_m + cabinet.width_m / 2);
    if (placed === null) {
      cabinetsOff += 1;
      continue;
    }
    const widthFeet = toFeetInches(cabinet.width_m);
    const symbol: CabinetSymbol = {
      id: newSketchId("cabinet"),
      type: "cabinet",
      wallId: placed.wall.id,
      t: placed.t,
      widthFraction: (widthFeet * PIXELS_PER_FOOT) / placed.wall.lengthPx,
      widthFeet,
      label: "Cabinet",
      tier: cabinet.tier,
      depthFeet: cabinet.depth_m !== null ? toFeetInches(cabinet.depth_m) : CABINET_DEFAULT_DEPTH_FEET[cabinet.tier],
      heightFeet: CABINET_DEFAULT_HEIGHT_FEET[cabinet.tier],
    };
    symbols.push(moveSymbolAlongWall(symbol, room, placed.t * placed.wall.lengthPx));
  }

  /**
   * Each flight becomes a stair room (`newStairRoom` is the hand-drawn equivalent): the rectangle
   * the four taps describe, put through the SAME transform as the room's own outline — same
   * origin, same scale — so the flight lands in the room where it was tapped, and the editor's
   * `withDerivedParents` finds it inside the room and nests it there.
   *
   * The direction of travel is read from the taps, not assumed: bottom riser (corners 0–1) to top
   * riser (corners 2–3), snapped to the four the sketch draws. The risers are named by tap order,
   * so it is read before anything reorders the corners. The rise is left null — the standard
   * storey — since the phone did not measure the floor above; the ceiling at the foot of the flight
   * is this room's, which is what `stairCeiling` takes as its low point.
   *
   * SQUARED, not traced. Everything the sketch knows about a flight assumes an axis-aligned
   * rectangle: `stairFlight` reads run and width off the bounding box, `StairsOverlay` draws the
   * treads across it, `rotateStairs` turns it about its centre, and `moveVertex` keeps a four-corner
   * room square only while each corner shares an x and a y with its neighbours to half a pixel.
   * Four taps never do. The first cut used the taps as the corners, and an inch of noise on one of
   * them made a quadrilateral whose first drag turned it into a trapezoid, whose treads poked past
   * its own walls, and whose width read an inch wider than its risers. So the taps are reduced to
   * the phone's own two numbers — run, the mean of |s1-s4| and |s2-s3|; width, the mean of |s1-s2|
   * and |s3-s4| — rounded to whole inches and laid along the direction of travel about the taps'
   * centroid. The phone's tally and the sketch's flight then agree to the inch, the four taps are
   * honoured in size and position, and a flight tapped askew to the room comes in square to it,
   * which is the only way the sketch can draw one.
   *
   * FLUSH, when nearly so. A flight against a wall — the basement's runs on up beside the hall
   * wall, and most do — is tapped against it, and the phone reads to an inch or three either way.
   * Half an inch OUTSIDE the wall and `isRoomInside` (half a pixel of grace) says the flight is not
   * in the room: it does not nest, it is left behind when the room is dragged into place, and its
   * floor is not kept out of the room's. So a side of the rectangle within `STAIR_FLUSH_PX` of a
   * wall of the room that runs the same way, and overlaps it, is put on that wall — from either
   * side, so a flight the noise put an inch INSIDE goes flush too rather than drawing an inch of
   * floor nobody can stand on. Further out than that is a flight that really leaves the room, out
   * through a doorway, and it stays where it was tapped. Only walls running the same way count: a
   * rectangle cannot sit flush against a chamfer, and the sketch's block snapping makes the same
   * exception (`snapBlockToWalls`, which this follows).
   *
   * It follows it in the other respect too: the flight SLIDES to the nearest wall on each axis
   * first, size unchanged, so a flight against one wall keeps the run and width the phone tallied
   * and the PM taped. Then each side is brought flush on its own, so a flight between two walls —
   * a stairwell — is flush to both at the stairwell's width, which is the truth of it; sliding
   * alone would have left the far side the sum of both noises off, and outside if both were out.
   *
   * A flight whose taps enclose nothing — the same corner tapped twice, or two taps that landed on
   * one riser — is not a room and is skipped with a note rather than drawn as a line.
   */
  const extraRooms: SketchRoom[] = [];
  let flatFlights = 0;
  /**
   * The wall of the room a side of the flight should lie on, if one is within reach: parallel,
   * overlapping the side's span, and within `STAIR_FLUSH_PX` of it. `vertical` says which way the
   * side runs (a left or right side is vertical); `lo`..`hi` is its span the other way. Null when
   * nothing qualifies — null, not the side's own position, because `slideBy` compares the two
   * sides' shifts and "no wall" must lose to "a wall one pixel off", where a shift of zero would
   * have won.
   */
  const flushTo = (position: number, vertical: boolean, lo: number, hi: number): number | null => {
    let best: number | null = null;
    let bestDistance = STAIR_FLUSH_PX + 1e-9;
    for (const wall of walls) {
      if (wall.lengthPx <= 0) continue;
      if (vertical ? wall.x1 !== wall.x2 : wall.y1 !== wall.y2) continue;
      const at = vertical ? wall.x1 : wall.y1;
      const from = vertical ? Math.min(wall.y1, wall.y2) : Math.min(wall.x1, wall.x2);
      const to = vertical ? Math.max(wall.y1, wall.y2) : Math.max(wall.x1, wall.x2);
      if (Math.min(to, hi) <= Math.max(from, lo)) continue;
      const distance = Math.abs(at - position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = at;
      }
    }
    return best;
  };
  /** How far the pair of sides on one axis slides to put whichever of them is nearer a wall on it. */
  const slideBy = (near: number, far: number, vertical: boolean, lo: number, hi: number): number => {
    const a = flushTo(near, vertical, lo, hi);
    const b = flushTo(far, vertical, lo, hi);
    const shiftA = a === null ? null : a - near;
    const shiftB = b === null ? null : b - far;
    if (shiftA === null) return shiftB ?? 0;
    if (shiftB === null) return shiftA;
    return Math.abs(shiftA) <= Math.abs(shiftB) ? shiftA : shiftB;
  };
  for (const flight of scan.stairs) {
    // The taps in world pixels, unrounded: the rectangle is rounded once, when it is laid out.
    const taps: Point[] = flight.corners.map((p) => ({
      x: x + (p[0] - originU) * PX_PER_METRE,
      y: y + (p[1] - originV) * PX_PER_METRE,
    }));
    const [s1, s2, s3, s4] = taps as [Point, Point, Point, Point];
    const bottom = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
    const top = { x: (s3.x + s4.x) / 2, y: (s3.y + s4.y) / 2 };
    const dx = top.x - bottom.x;
    const dy = top.y - bottom.y;
    const orientation: StairsData["orientation"] = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 180) : dy >= 0 ? 90 : 270;

    const runPx = Math.round((Math.hypot(s4.x - s1.x, s4.y - s1.y) + Math.hypot(s3.x - s2.x, s3.y - s2.y)) / 2);
    const widthPx = Math.round((Math.hypot(s2.x - s1.x, s2.y - s1.y) + Math.hypot(s4.x - s3.x, s4.y - s3.y)) / 2);
    const centre = { x: (s1.x + s2.x + s3.x + s4.x) / 4, y: (s1.y + s2.y + s3.y + s4.y) / 4 };
    const acrossPage = orientation === 0 || orientation === 180;
    const w = acrossPage ? runPx : widthPx;
    const h = acrossPage ? widthPx : runPx;
    let left = Math.round(centre.x - w / 2);
    let right = left + w;
    let above = Math.round(centre.y - h / 2);
    let below = above + h;
    // Slide to the nearest wall on each axis, then each side flush on its own — see above.
    const shiftX = slideBy(left, right, true, above, below);
    left += shiftX;
    right += shiftX;
    const shiftY = slideBy(above, below, false, left, right);
    above += shiftY;
    below += shiftY;
    left = flushTo(left, true, above, below) ?? left;
    right = flushTo(right, true, above, below) ?? right;
    above = flushTo(above, false, left, right) ?? above;
    below = flushTo(below, false, left, right) ?? below;

    const stairVertices = ensureClockwise(rectangleVertices(left, above, right - left, below - above));
    if (right <= left || below <= above || isDegenerate(stairVertices)) {
      flatFlights += 1;
      continue;
    }
    extraRooms.push({
      id: newSketchId("room"),
      name: "Stairs",
      vertices: stairVertices,
      ceilingHeightFeet: room.ceilingHeightFeet,
      ceilingType: "sloped",
      ceilingPeakFeet: null,
      stairs: { orientation, direction: flight.direction, treadDepthFeet: STAIRS_DEFAULT.treadDepthFeet, riseFeet: null },
      parentRoomId: null,
      nestingOptOut: false,
      symbols: [],
      freeCabinets: [],
      level,
    });
  }

  // What the builder had to leave out or assume, in the order the PM walks it: the room itself
  // first, then its openings, cabinets and flights. The sentence about how the room was measured
  // is `measurementNote`, said by the importer — see there for why it is not said here.
  if (ceiling === null) notes.push("The scan did not see the ceiling; 8' assumed.");
  if (skipped > 0) notes.push(`${skipped} unclassified gap${skipped === 1 ? "" : "s"} left as wall.`);
  if (flatWindows > 0) {
    notes.push(
      `${flatWindows} window${flatWindows === 1 ? "'s" : "s'"} sill and head were tapped at the same height; defaults used.`,
    );
  }
  if (offOutline > 0) {
    notes.push(`${offOutline} opening${offOutline === 1 ? "" : "s"} named a wall the outline does not have; skipped.`);
  }
  if (cabinetsOff > 0) {
    notes.push(`${cabinetsOff} cabinet${cabinetsOff === 1 ? "" : "s"} named a wall the outline does not have; skipped.`);
  }
  if (extraRooms.length > 0) {
    notes.push(`${extraRooms.length} flight${extraRooms.length === 1 ? "" : "s"} of stairs placed.`);
  }
  if (flatFlights > 0) {
    notes.push(`${flatFlights} flight${flatFlights === 1 ? "" : "s"} of stairs had corners that enclose nothing; skipped.`);
  }

  // In wall order — round the ring, then along each wall — rather than the order they were tapped
  // in, so the closets the editor offers to draw come out in the order a PM walks the room.
  const wallIndex = new Map(walls.map((w) => [w.id, w.index]));
  const closetDoorIds = symbols
    .filter((s) => closetDoors.has(s.id))
    .sort((a, b) => (wallIndex.get(a.wallId) ?? 0) - (wallIndex.get(b.wallId) ?? 0) || a.t - b.t)
    .map((s) => s.id);

  // One room built is a one-room result; the capture importer says otherwise for its own.
  return { ok: true, kind: "room", room: { ...room, symbols }, extraRooms, notes, closetDoorIds };
}

/**
 * The one sentence about how a room was measured, which leads the notice for a one-room file. A
 * tapped room's corners were each put there on purpose, so the wall count is the news; a lap's
 * extra corners came from the fitter and are worth a second look; a lap that drew a rectangle has
 * nothing to say.
 *
 * Said by the importer rather than the builder because it is a sentence about the FILE's room, and
 * a capture's notice leads with a sentence about its rooms instead ("3 rooms imported, placed as
 * tapped.") — three of these in a row, one per room, would be three sentences of nothing where
 * the PM is looking for what went wrong.
 */
export function measurementNote(scan: ScanRoom, room: SketchRoom): string | null {
  if (scan.source === "taps") return `Measured by tapping; ${room.vertices.length} walls.`;
  if (room.vertices.length > 4) return `The scan drew ${room.vertices.length} corners (a notch or an angled wall); check them against the room.`;
  return null;
}

/**
 * Several rooms, one frame — see the header. Every room's polygon is found first, because the
 * origin they are all built against is the top-left of the UNION of them: that is what lands at
 * `at`, so the whole capture drops where a single room would have, and each room keeps its place
 * relative to the others. The first room that builds is `room` — the one the editor selects and
 * the one whose closet doors are offered — and the rest are `extraRooms`, in capture order, ahead
 * of every flight of stairs from every room.
 *
 * A room that will not build (the phone wrote too few corners, or a ring that folds over itself)
 * is left out with a note, on the reasoning `parseScanCapture` gives for one it could not read,
 * and a capture in which nothing builds is refused. A room with no polygon at all is left out of
 * the union too, so the others still drop with their own top-left at `at`; one the builder refuses
 * afterwards — too small to be a room, or folded — has already had its say in the union, and the
 * half-metre a too-small room can add to it is nothing against the drag that follows.
 *
 * `fileNotes` are the parser's, already named by room; they come after the builders' notes so the
 * notice reads rooms first, then the file's faults, as it does for one room.
 */
function importScanCapture(capture: ScanCapture, fileNotes: string[], at: { x: number; y: number }, level: number): ScanImportResult {
  const drawable: { scan: ScanRoom; polygon: [number, number][] }[] = [];
  const leftOut: string[] = [];
  capture.rooms.forEach((scan, position) => {
    const shape = polygonOf(scan);
    if (!shape.ok) {
      leftOut.push(`${captureRoomName(scan.name, scan.index ?? position)}: ${shape.error} Left out.`);
      return;
    }
    drawable.push({ scan, polygon: shape.polygon });
  });
  if (drawable.length === 0) {
    return { ok: false, error: `None of the ${capture.rooms.length} rooms in this capture could be drawn.` };
  }
  const origin: ScanOrigin = {
    u: Math.min(...drawable.flatMap((d) => d.polygon.map((p) => p[0]))),
    v: Math.min(...drawable.flatMap((d) => d.polygon.map((p) => p[1]))),
  };

  const rooms: SketchRoom[] = [];
  const flights: SketchRoom[] = [];
  const notes: string[] = [];
  let closetDoorIds: string[] = [];
  drawable.forEach(({ scan }, position) => {
    const label = captureRoomName(scan.name, scan.index ?? position);
    // A room that arrived unnamed is named here as the note names it, so the two agree.
    const built = scanToSketchRoom({ ...scan, name: label }, at, level, origin);
    if (!built.ok) {
      leftOut.push(`${label}: ${built.error} Left out.`);
      return;
    }
    if (rooms.length === 0) closetDoorIds = built.closetDoorIds;
    rooms.push(built.room);
    flights.push(...built.extraRooms);
    notes.push(...built.notes.map((n) => `${label}: ${n}`));
  });
  /*
    ONE DOORWAY, TAPPED FROM BOTH SIDES, DRAWN ONCE.

    The join asks the estimator to tap the shared door in BOTH rooms — that is how it knows which
    door is which — so a joined capture arrives with two symbols a partition apart for one hole.
    Scrivn already refuses to COUNT it twice (`openingsSharedWith`); nothing stopped it being drawn
    twice until now: "for some reason it plopped a door on there that shouldnt be there".
  */
  const deduped = dropDuplicateSharedOpenings(rooms);
  const dropped = rooms.reduce((n, r, k) => n + (r.symbols.length - (deduped[k]?.symbols.length ?? r.symbols.length)), 0);
  if (dropped > 0) {
    notes.push(`${dropped} ${dropped === 1 ? "doorway was" : "doorways were"} tapped from both rooms; drawn once.`);
  }
  const room = deduped[0];
  if (room === undefined) {
    return { ok: false, error: `None of the ${capture.rooms.length} rooms in this capture could be drawn.` };
  }
  return {
    ok: true,
    kind: "capture",
    room,
    extraRooms: [...deduped.slice(1), ...flights],
    notes: [`${rooms.length} room${rooms.length === 1 ? "" : "s"} imported, placed as tapped.`, ...notes, ...leftOut, ...fileNotes],
    closetDoorIds,
  };
}

/**
 * File text in, sketch room(s) out — the one call the editor makes. Either shape: a one-room file
 * builds one room at `at`; a capture builds its rooms together (`importScanCapture`), the first
 * as `room` and the rest in `extraRooms`. What the parser had to skip is said after what the
 * builder had to, so the notice reads room first, then the file's faults.
 */
export function importScanRoom(text: string, at: { x: number; y: number }, level: number): ScanImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not a room scan — it is not valid JSON." };
  }
  const checked = parseScan(parsed);
  if (!checked.ok) return checked;
  if (checked.kind === "capture") return importScanCapture(checked.capture, checked.notes, at, level);
  const built = scanToSketchRoom(checked.scan, at, level);
  if (!built.ok) return built;
  const measured = measurementNote(checked.scan, built.room);
  return { ...built, notes: [...(measured === null ? [] : [measured]), ...built.notes, ...checked.notes] };
}
