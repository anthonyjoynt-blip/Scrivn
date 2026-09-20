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
 * The scanner speaks metres in its own room-aligned frame (U along one pair of walls, V along the
 * other); the sketch is world pixels at `PIXELS_PER_FOOT`, y down, clockwise. The room's own
 * corner becomes the top-left of wherever the editor chooses to put it. Orientation on the page is
 * arbitrary — the scanner has no idea which way is north and neither does the sketch.
 *
 * ── The JSON ────────────────────────────────────────────────────────────────────────────────
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
 * strings, coverage), the phone's raw `taps` and its `outline_tapped` flags do no harm.
 *
 * Only what the scanner is sure of is imported. A gap it could not classify — an unscanned corner,
 * a stretch hidden behind a desk — is left as wall, because a wrong door on the sketch costs more to
 * notice and remove than a missing one costs to add.
 */

import {
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
  DEFAULT_CEILING_HEIGHT_FEET,
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

export interface ScanRoom {
  format?: string;
  name?: string;
  source?: string;
  ceiling_m?: number | null;
  walls: ScanWall[];
  /** The room polygon in the scanner's (u, v) frame, when the scanner found more than a rectangle. */
  outline?: [number, number][];
  /** Openings placed on the outline's edges, which is how tap-to-measure reports them. */
  outline_openings: ScanOutlineOpening[];
  /** Cabinet runs placed on the outline's edges the same way. Empty for a lap scan. */
  cabinets: ScanCabinet[];
  /** Flights of stairs tapped in the room, each becoming a room of its own. Empty for a lap scan. */
  stairs: ScanStairs[];
}

export type ScanImportResult =
  | {
      ok: true;
      room: SketchRoom;
      /**
       * Rooms that came in alongside the main one — today, one per flight of stairs the phone
       * tapped, since the sketch draws a flight as a room (`StairsData`). Built in the same frame
       * as `room`, so they land where they were tapped relative to it; the editor adds them in the
       * same update as the room, and `withDerivedParents` nests each in the room it stands in.
       * Empty when the file has no stairs, which is every lap scan.
       */
      extraRooms: SketchRoom[];
      notes: string[];
      /**
       * The doors that were tapped as "closet_door", in wall order. They come in as ordinary swing
       * doors on the room's wall — the sketch has no closet-door type and needs none — but the
       * editor offers to draw the closet behind each one (`closetBehindDoor`), and once the symbol
       * is built nothing else says which doors those were. Empty for a lap scan, which never
       * writes the kind.
       */
      closetDoorIds: string[];
    }
  | { ok: false; error: string };

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
      source: typeof raw.source === "string" ? raw.source : undefined,
      ceiling_m: isFiniteNumber(raw.ceiling_m) ? raw.ceiling_m : null,
      walls,
      outline,
      outline_openings: outlineOpenings,
      cabinets,
      stairs,
    },
    notes,
  };
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
 * Builds the sketch room. `at` is where its top-left corner lands, in world pixels, and `level` the
 * storey it joins; both are the editor's business, not the scan's.
 */
export function scanToSketchRoom(scan: ScanRoom, at: { x: number; y: number }, level: number): ScanImportResult {
  // The polygon: the scanner's outline when it sent one, else the rectangle the four walls
  // describe, in the same clockwise order (top-left, top-right, bottom-right, bottom-left). One
  // path for both, so a four-point outline is the rectangle exactly, openings and all. The
  // two-walls-per-axis rule only applies when the rectangle is all there is: a tapped room has an
  // outline and no walls at all.
  let polygon: [number, number][];
  if (scan.outline !== undefined) {
    polygon = scan.outline;
  } else {
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
    polygon = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
  }

  // The room's own corner becomes the drop point: the polygon's top-left, which for the rectangle
  // is (u0, v0) and for a notched or chamfered one may be a vertex the rectangle never had.
  const minU = Math.min(...polygon.map((p) => p[0]));
  const minV = Math.min(...polygon.map((p) => p[1]));
  const width = Math.max(...polygon.map((p) => p[0])) - minU;
  const depth = Math.max(...polygon.map((p) => p[1])) - minV;
  if (width < 0.5 || depth < 0.5) return { ok: false, error: "The scanned room is too small to be a room." };

  const { x, y } = at;
  // Whole pixels: one pixel is one inch, and the scan is not better than that.
  const toPx = (p: [number, number]): { x: number; y: number } => ({
    x: x + Math.round((p[0] - minU) * PX_PER_METRE),
    y: y + Math.round((p[1] - minV) * PX_PER_METRE),
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
  const room: SketchRoom = {
    id: newSketchId("room"),
    name: scan.name ?? "",
    vertices,
    ceilingHeightFeet: ceiling ?? DEFAULT_CEILING_HEIGHT_FEET,
    ceilingType: "flat",
    ceilingPeakFeet: null,
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
    const offsetPx = horizontal ? y + (wall.offset_m - minV) * PX_PER_METRE : x + (wall.offset_m - minU) * PX_PER_METRE;
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
        x: x + (centreUV[0] - minU) * PX_PER_METRE,
        y: y + (centreUV[1] - minV) * PX_PER_METRE,
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
      x: x + (p[0] - minU) * PX_PER_METRE,
      y: y + (p[1] - minV) * PX_PER_METRE,
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

  // A tapped room's corners were each put there on purpose, so the wall count is the news; a
  // lap's extra corners came from the fitter and are worth a second look.
  if (scan.source === "taps") {
    notes.push(`Measured by tapping; ${vertices.length} walls.`);
  } else if (vertices.length > 4) {
    notes.push(`The scan drew ${vertices.length} corners (a notch or an angled wall); check them against the room.`);
  }
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

  return { ok: true, room: { ...room, symbols }, extraRooms, notes, closetDoorIds };
}

/**
 * File text in, sketch room out — the one call the editor makes. What the parser had to skip is
 * said after what the builder had to, so the notice reads room first, then the file's faults.
 */
export function importScanRoom(text: string, at: { x: number; y: number }, level: number): ScanImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not a room scan — it is not valid JSON." };
  }
  const checked = parseScanRoom(parsed);
  if (!checked.ok) return checked;
  const built = scanToSketchRoom(checked.scan, at, level);
  if (!built.ok) return built;
  return { ...built, notes: [...built.notes, ...checked.notes] };
}
