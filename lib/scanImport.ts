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
 * Anything else in the file is ignored, so the analysis script's extra fields (feet-and-inches
 * strings, coverage) and the phone's raw `taps` do no harm.
 *
 * Only what the scanner is sure of is imported. A gap it could not classify — an unscanned corner,
 * a stretch hidden behind a desk — is left as wall, because a wrong door on the sketch costs more to
 * notice and remove than a missing one costs to add.
 */

import {
  type DoorSymbol,
  type SketchRoom,
  type SketchSymbol,
  type Vertex,
  type WallGeometry,
  type WindowSymbol,
  DEFAULT_CEILING_HEIGHT_FEET,
  DEFAULT_DOOR_HEIGHT_FEET,
  DEFAULT_WINDOW_HEIGHT_FEET,
  DEFAULT_WINDOW_SILL_FEET,
  PIXELS_PER_FOOT,
  ensureClockwise,
  isDegenerate,
  moveSymbolAlongWall,
  newSketchId,
  wallsOf,
} from "./sketch";

const FEET_PER_METRE = 1 / 0.3048;
const PX_PER_METRE = PIXELS_PER_FOOT * FEET_PER_METRE;

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
}

export type ScanImportResult =
  | {
      ok: true;
      room: SketchRoom;
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

/**
 * Checks the shape of a parsed file. Hand-rolled rather than a schema library because the shape is
 * six fields and the messages have to say which of them is wrong in words a PM can act on.
 */
export function parseScanRoom(input: unknown): { ok: true; scan: ScanRoom } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "This file is not a room scan." };
  const raw = input as Record<string, unknown>;

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
    },
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

  // In wall order — round the ring, then along each wall — rather than the order they were tapped
  // in, so the closets the editor offers to draw come out in the order a PM walks the room.
  const wallIndex = new Map(walls.map((w) => [w.id, w.index]));
  const closetDoorIds = symbols
    .filter((s) => closetDoors.has(s.id))
    .sort((a, b) => (wallIndex.get(a.wallId) ?? 0) - (wallIndex.get(b.wallId) ?? 0) || a.t - b.t)
    .map((s) => s.id);

  return { ok: true, room: { ...room, symbols }, notes, closetDoorIds };
}

/** File text in, sketch room out — the one call the editor makes. */
export function importScanRoom(text: string, at: { x: number; y: number }, level: number): ScanImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not a room scan — it is not valid JSON." };
  }
  const checked = parseScanRoom(parsed);
  if (!checked.ok) return checked;
  return scanToSketchRoom(checked.scan, at, level);
}
