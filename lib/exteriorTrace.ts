/**
 * The AI trace of a side's squared-up photo (2026-10-12): one Claude call per side, which returns
 * each material as a shape, the openings, the wall's top and what stands in front of the wall.
 * Nothing goes onto the side until the estimator ticks it.
 *
 * The prompt and schema are the owner's test of 10-12 (photo-elevation-test.md, section 2), which
 * traced squared photos of his own house within 1/2" of hand marks for $0.04-0.08 a wall. Claude
 * answers in the squared image's own pixels and the code turns them into the side's frame, which
 * is exact at a known pixels-a-metre. What the test found wanting is written into the prompt: a
 * garage door was traced to its stucco surround, so the door itself is now asked for in so many
 * words. A tall glass unit whose foot a deck railing hid was read as French doors (the owner, 10-16:
 * "Its a window not a door"), so a door now needs what makes it one in the photo, and what hid
 * part of an opening is asked for: the photo route's "Check these" asks about those.
 *
 * Shared by the route (the prompt, the schema) and the editor (the proposals, applying them); no
 * server-only code here.
 */

import {
  CLADDING_KINDS,
  type CladdingKind,
  type ExteriorOpening,
  type ExteriorOpeningKind,
  type ExteriorShape,
  type ExteriorSide,
  type OpeningTrim,
  type SideColumn,
  type SidePhoto,
  type SideRoofRead,
} from "./exterior";
import type { CallUsage } from "./anthropic";
import { frameAlongM, frameUpM, frameX, frameY, OUTSIDE_PHOTO_GREY, type SquareFrame } from "./exteriorPhoto";
import { polygonArea, type Pt } from "./roof";
import { type CameraAt, gableSlopes, type Gray, type ProposedRoof, readRoof, readRoofLines, ROOF_EDGE_ENDS, ROOF_OVER_WALL, type RoofLines, type RoofWire, snapRoof } from "./roofPhotoRead";
import { type PhotoPiece, piecesOfWire, type ProposedPiece, type ProposedStoreys, readPieces, readStoreys, type RoofShapesWire } from "./roofPhotoShapes";
import { formatFeetInches, newSketchId } from "./sketch";

const FEET_PER_METRE = 1 / 0.3048;

/** Scan's materials, in its picker's order, and "other". */
export const TRACE_MATERIALS = ["stucco", "vinyl", "wood_shake", "eifs", "wood", "fibre_cement", "brick", "stone", "metal", "parging", "other"] as const;
const OPENING_KINDS = ["window", "door", "patio_door", "garage_door"] as const;

const POINT = { type: "array", items: { type: "number" } };
/** Points as one flat run [x1, y1, x2, y2, ...]: an array of arrays costs the schema's grammar more than it has room for (lib/roofPhotoShapes.ts). */
const FLAT_POINTS = { type: "array", items: { type: "number" } };
const ROOF_END = {
  type: "object",
  properties: { kind: { type: "string", enum: [...ROOF_EDGE_ENDS] }, point: POINT },
  required: ["kind", "point"],
  additionalProperties: false,
};
export const TRACE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    materials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          material: { type: "string", enum: [...TRACE_MATERIALS] },
          polygon: { type: "array", items: POINT },
          partly_hidden_by: { type: "string" },
        },
        required: ["material", "polygon", "partly_hidden_by"],
        additionalProperties: false,
      },
    },
    openings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...OPENING_KINDS] },
          left: { type: "number" },
          right: { type: "number" },
          top: { type: "number" },
          bottom: { type: "number" },
          measured_to: { type: "string", enum: ["outer_trim", "frame", "door_itself"] },
          // A door's leaf, the slab that swings (2026-10-15): a door of a standard size is a check on the house's sizes (lib/exteriorScale.ts).
          leaf: POINT,
          partly_hidden_by: { type: "string" },
        },
        required: ["kind", "left", "right", "top", "bottom", "measured_to", "leaf", "partly_hidden_by"],
        additionalProperties: false,
      },
    },
    wall_top: { type: "array", items: POINT },
    off_wall: {
      type: "array",
      items: {
        type: "object",
        properties: { what: { type: "string" }, box: POINT },
        required: ["what", "box"],
        additionalProperties: false,
      },
    },
    // The roof's edge over the wall (2026-10-15, lib/roofPhotoRead.ts): what it does, the fascia's lines and where it ends.
    roof: {
      type: "object",
      properties: {
        over_wall: { type: "string", enum: [...ROOF_OVER_WALL] },
        rake_left: { type: "array", items: POINT },
        rake_right: { type: "array", items: POINT },
        eave_line: { type: "array", items: POINT },
        left_end: ROOF_END,
        right_end: ROOF_END,
        notes: { type: "string" },
      },
      required: ["over_wall", "rake_left", "rake_right", "eave_line", "left_end", "right_end", "notes"],
      additionalProperties: false,
    },
    // The roof's shapes over the wall (2026-10-15, lib/roofPhotoShapes.ts): dormers on its slope, turrets, an upper floor over it.
    // Lean on purpose - plain strings, points as flat runs, one note: the schema is compiled into a grammar, and this is at the
    // size the API takes ("The compiled grammar is too large" one step past it). Make room before adding to the trace.
    roof_shapes: {
      type: "object",
      properties: {
        pieces: {
          type: "array",
          items: {
            type: "object",
            properties: { kind: { type: "string" }, outline: FLAT_POINTS, foot: FLAT_POINTS, sides: { type: "number" } },
            required: ["kind", "outline", "foot", "sides"],
            additionalProperties: false,
          },
        },
        upper_floor: { type: "string" },
        floor_line: FLAT_POINTS,
        lower_roof: { type: "string" },
        notes: { type: "string" },
      },
      required: ["pieces", "upper_floor", "floor_line", "lower_roof", "notes"],
      additionalProperties: false,
    },
    notes: { type: "string" },
  },
  required: ["materials", "openings", "wall_top", "off_wall", "roof", "roof_shapes", "notes"],
  additionalProperties: false,
};

/** What the call answers, in the squared image's pixels. `roof` and a door's `leaf` are absent from an answer given before 2026-10-15. */
export interface TraceWire {
  materials: { material: string; polygon: number[][]; partly_hidden_by: string }[];
  openings: { kind: string; left: number; right: number; top: number; bottom: number; measured_to: string; leaf?: number[]; partly_hidden_by: string }[];
  wall_top: number[][];
  off_wall: { what: string; box: number[] }[];
  roof?: RoofWire;
  /** The roof's shapes (2026-10-15): absent from an answer given before then. */
  roof_shapes?: RoofShapesWire;
  notes: string;
}

export const TRACE_SYSTEM_PROMPT = `You trace exterior wall elevations for a restoration estimating app.

Each image is a photo of one side of a house, squared up to that wall: the wall's plane is shown square-on and to scale, the same number of pixels per metre across and up. Only things lying on that wall plane are true to scale. Anything standing in front of it or set back from it (posts, columns, railings, fences, decks, porch roofs, fascia and the roof edge, downspouts, meters, AC units, bikes, plants, another wall further back) is drawn at the wrong size and in the wrong place, and must not be traced as wall.

Flat mid-grey areas (RGB ${OUTSIDE_PHOTO_GREY}, ${OUTSIDE_PHOTO_GREY}, ${OUTSIDE_PHOTO_GREY}) are outside the photo: nothing is known there. Never trace into them; where a material runs into one, stop at its edge and say so.

Answer in this image's own pixel coordinates: x to the right, y down, origin at the top-left pixel. Be exact: the numbers become measurements on an insurance estimate.`;

/** The side as the trace is told it: its name, its length and where the phone put its bottom corners. */
export interface TraceSide {
  name: string;
  lengthM: number;
  bottomLeftM: number;
  bottomRightM: number;
  /** Whether each end is in the photo at all, as far as Scan could tell. */
  leftEndInPhoto: boolean;
  rightEndInPhoto: boolean;
}

const px = (v: number) => Math.round(v * 10) / 10;

export function traceUserMessage(frame: SquareFrame, side: TraceSide): string {
  const xL = px(frameX(frame, 0));
  const xR = px(frameX(frame, side.lengthM));
  const bl = [xL, px(frameY(frame, side.bottomLeftM))];
  const br = [xR, px(frameY(frame, side.bottomRightM))];
  const end = (which: string, x: number, inPhoto: boolean) =>
    x < 0 || x > frame.width ? `its ${which} end is beyond the image's ${x < 0 ? "left" : "right"} edge` : inPhoto ? `its ${which} end is at x = ${x}` : `its ${which} end should be at x = ${x}, but may be outside the photo`;
  return `This image is ${frame.width}x${frame.height} pixels. It is the side of the house called "${side.name}", ${side.lengthM.toFixed(2)} m long, measured on a phone: ${end("left", xL, side.leftEndInPhoto)} and ${end("right", xR, side.rightEndInPhoto)}. The phone put the wall's bottom corners at [${bl.join(", ")}] and [${br.join(", ")}] - where the cladding stops at the bottom, or the ground. The phone's corners can be out by a few centimetres; trust the photo.

Scale: ${frame.ppm.toFixed(1)} pixels per metre, the same across and up.

Trace, in pixels:
1. materials: each cladding material on this wall as a closed polygon (corners in order, not repeating the first). Include parging (the cement coat over the foundation) down to the ground. If a material runs on past the wall's ends (over a covered deck, up a gable), follow it. Say what hides any part of it, or "" when nothing does.
2. openings: every window, door, patio door and garage door on this wall. Call an opening a door, a patio door or a garage door only when the photo shows what makes it one: a handle, hinges, a threshold, or a step, deck, path or driveway meeting its foot. Tall glass whose foot is hidden - by a railing, a deck, plants, a car - is a window. Say what hides any part of an opening, or "" when nothing does. A window or door: to the outer edge of its trim, or of its frame where it has no trim; say which. Its trim is the narrow casing round its frame: a wide surround of stucco, foam or another colour than the wall is not, and goes in off_wall (4). A garage door: the door itself - the panels that move, from their bottom edge to their top edge and side to side - never the trim, jamb or stucco surround framing it; its measured_to is "door_itself". A roll-up door is a garage_door here too, but tell it from a sectional garage door: a roll-up's curtain is narrow horizontal slats, a few inches each, often with a hood or box across its top, where a sectional door has three to five tall panelled sections; for a roll-up, also put a box in off_wall (4) round its hood, or round the door itself where no hood shows, its what starting "roll-up". For a door (not a patio door or a garage door) also give leaf: the door leaf itself - the slab that swings, from its hinge edge to its latch edge and from its bottom edge to its top edge, inside the frame and its stops, sidelights left out - as [x0, y0, x1, y1]; [] for every other opening, and for a door whose leaf you cannot see whole.
3. wall_top: the line where the wall's cladding meets the soffit, left to right, including any gable peak, as a polyline.
4. off_wall: everything in front of the wall that hides part of it, as boxes [x0, y0, x1, y1]. The wall's own trim goes here too, each piece its own box, its what starting with one of these words, then its material ("surround, stucco"), and ending "partly hidden by ..." when something hides part of it:
   - "surround": a raised band round a window or door, often another colour than the wall: its outer edges, the opening inside it traced on its own in (2). Add "open top" when it has no head and its sides run on up.
   - "keystone": the block over a surround's head, at the middle of the opening.
   - "pilaster": a flat column against the wall; "column": a column standing clear of the wall, a porch column - each from its foot to its top. "base" and "cap": a column's or pilaster's base and cap, where they stand out wider than it.
   None of these is a material in (1): the wall's material runs on behind them. A column standing clear of the wall is counted, not taken as wall hidden.
5. roof: the roof's edge over this wall. The fascia and the soffit stand out in front of the wall, so they show larger than the wall and set off from it: trace them where they show in this image, and the code works out how far out they stand.
   - over_wall: "gable" if the wall rises to a peak under the roof; "hip_end" if the wall's top is level and the roof above it slopes up and back, with a hip rising from each end; "eave" if the wall's top is level and the roof slopes up and back to a ridge along the wall, or up to an upper storey's wall standing back above it; "none" if no roof edge is over this wall; "unclear" if you can't tell.
   - rake_left, rake_right: on a gable, the bottom edge of the fascia (the rake board) along each slope, where the soffit under the rake meets it - from the foot of the rake up to the peak on the left, from the peak down to its foot on the right, with a point every metre or so. Not the line where the soffit meets the wall (that is wall_top), not the shingles. [] when there is no gable.
   - eave_line: the bottom edge of the fascia along an eave over this wall, left to right; where an eavestrough hides it, the trough's bottom edge. [] when there is none.
   - left_end, right_end: where the roof's edge ends, past each end of the wall: point is the outermost bottom corner of the fascia there, where the rake board itself ends - past the wall's corner by the eave overhang, often 1 to 2 ft, and further out still in this image since the fascia stands out from the wall; never the wall's own corner, never where an eave's return running back along the house meets it, never the eavestrough's end cap or a downspout. kind: "rake_foot" where a rake comes down to an eave that runs back from it; "hip_corner" where the eave turns the corner; "eave_into_rake" where this wall's eave ends under the next wall's rake; "runs_on" where the roof carries on past the end, over a porch, a deck or another roof; "against_wall" where it stops against a wall; "hidden" where something in front hides it; "out_of_photo" where it is outside the photo. point is [] when hidden or out of the photo.
   - notes: anything about the roof's edge you are unsure of.
6. roof_shapes: what stands on the roof above this wall, and over it. Points here are one flat run of numbers, x then y for each point in turn: [x1, y1, x2, y2, ...].
   - pieces: each dormer on the roof above this wall whose front faces out the same way as this wall, so its front wall shows square-on, and each turret (a round or many-sided tower with its own cone or pyramid roof) on or at this wall - not a dormer seen from its side, a skylight, a chimney or the main roof's own gable. A dormer's front wall stands back on the roof, so it shows smaller than it is: trace it where it shows. [] when there are none.
     - kind: "gable_dormer" (its own little gable roof), "shed_dormer" (one slope, running back up into the main roof), "hipped_dormer", "other_dormer", "round_turret" or "many_sided_turret".
     - outline: a dormer's front wall top, where its cladding meets its soffit, from its left corner (the top of its left side wall) to its right corner, with its peak between on a gable dormer; a turret's roof outline, its left bottom corner at the eave, its apex, its right bottom corner.
     - foot: a dormer's front wall where it meets the main roof below it, its left and right ends, [] when hidden; a turret's wall, its left and right edges just under its soffit.
     - sides: a many-sided turret's sides all the way round (count the faces you see and work it out); 0 otherwise.
   - upper_floor: "none" if only roof stands over the wall's top (dormers and a walk-out basement make no upper floor); "flush" if the wall carries on up past a floor line to a second storey's wall in the same plane; "set_back" if a roof runs along this wall's top up to a second storey's wall standing back above it; "unclear".
   - floor_line: on a flush wall, the upper storey's floor line where it shows - a band board, a change of cladding, the joint between the storeys - its left and right ends; [] otherwise.
   - lower_roof: on a set-back wall, the roof between this wall and the upper storey: "lean_to" if it slopes up from this wall's eave to the upper wall; "ridge_out" if its ridge runs from the upper wall out over this wall, with a gable or hip end over it; "none" otherwise; "unclear".
   - notes: anything about the pieces or the storeys you are unsure of.
7. notes: anything that makes this wall hard to trace, and anything you are unsure of.`;
}

// ---------------------------------------------------------------------------------------------
// Into the side's frame
// ---------------------------------------------------------------------------------------------

export interface ProposedShape {
  key: string;
  kind: CladdingKind | "parging";
  /** What the AI said it was, when that is "other". */
  label?: string;
  /** Feet along from the side's left end, feet up from its level. */
  polygon: Pt[];
  squareFeet: number;
  hiddenBy: string;
  /** Its colour off the squared photo, "#rrggbb" (2026-10-17, `withSwatches`): for drawing only. */
  colour?: string;
}

/** A surround read off the photo, on the opening it goes round (by its proposal's key). */
export interface ProposedTrim {
  key: string;
  openingKey: string;
  trim: OpeningTrim;
  /** The off_wall boxes it was read from, by place in `offWall`. */
  from: number[];
}

/** A column or pilaster read off the photo. */
export interface ProposedColumn {
  key: string;
  column: Omit<SideColumn, "id">;
  from: number[];
}

export interface ProposedOpening {
  key: string;
  kind: ExteriorOpeningKind;
  /** The AI's own word: a patio door is a door here, and a garage door a garage. */
  traced: string;
  fromLeftFeet: number;
  widthFeet: number;
  sillFeet: number;
  heightFeet: number;
  measuredTo: string;
  hiddenBy: string;
  /**
   * The opening whole as traced, in the side's feet, before it is cut at the side's ends and level
   * (2026-10-15): a garage door's size check reads this. Absent from a trace made before then.
   */
  box?: FeetBox;
  /** A door's leaf, the slab that swings, as traced: its size check. Null for any other opening; absent from a trace made before 2026-10-15. */
  leaf?: FeetBox | null;
  /** A roll-up door (2026-10-19): the off_wall box that said so, by place in `offWall` (`readRollups`). Absent on any other opening. */
  rollupFrom?: number;
}

/** A box on the side, feet along from its left end and up from its level. */
export interface FeetBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ProposedWallTop {
  line: Pt[];
  /** The wall top over each end of the side, where the line reaches it. */
  eaveLeftFeet: number | null;
  eaveRightFeet: number | null;
  peak: { atFeet: number; peakFeet: number } | null;
  /** Each slope's own rise in 12 either side of the peak: the two should agree. */
  slopes: [number, number] | null;
}

export interface TraceProposals {
  shapes: ProposedShape[];
  openings: ProposedOpening[];
  wallTop: ProposedWallTop | null;
  offWall: { what: string; x0: number; x1: number; y0: number; y1: number }[];
  /**
   * The roof read off the photo (2026-10-15, lib/roofPhotoRead.ts): its pitch, overhangs and what it
   * does over the side. Absent from a trace made before it; null when the photo says nothing of the roof.
   */
  roof?: ProposedRoof | null;
  /**
   * The dormers and turrets read off the photo (2026-10-15, lib/roofPhotoShapes.ts), each a roof piece
   * once ticked; and what stands over the side. Absent from a trace made before then.
   */
  pieces?: ProposedPiece[];
  storeys?: ProposedStoreys | null;
  /**
   * The wall's own trim (2026-10-17), off the off_wall boxes whose words start "surround", "keystone", "pilaster",
   * "column", "base" or "cap": each surround on the opening it goes round, and each column or pilaster. Absent with none.
   */
  trims?: ProposedTrim[];
  columns?: ProposedColumn[];
  /** What the trace was unsure of, in its words. */
  notes: string;
  /** The test's own checks: an eave level end to end. A gable's two slopes are the roof's (`roof.checks`). */
  checks: string[];
}

function point(frame: SquareFrame, p: unknown): Pt | null {
  if (!Array.isArray(p) || p.length < 2) return null;
  const [x, y] = p as unknown[];
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: frameAlongM(frame, x) * FEET_PER_METRE, y: frameUpM(frame, y) * FEET_PER_METRE };
}

function shapeKind(material: string): { kind: CladdingKind | "parging"; label?: string } {
  if (material === "parging") return { kind: "parging" };
  if ((CLADDING_KINDS as string[]).includes(material) && material !== "other") return { kind: material as CladdingKind };
  return { kind: "other", label: material === "other" ? undefined : material.replace(/_/g, " ") };
}

function openingKind(kind: string): ExteriorOpeningKind {
  return kind === "garage_door" ? "garage" : kind === "door" || kind === "patio_door" ? "door" : "window";
}

/** [box] when it lies inside [outer], give or take 3": a door's leaf inside the door. Null otherwise. */
function insideOf(box: FeetBox | null, outer: FeetBox): FeetBox | null {
  const grace = 3 / 12;
  if (!box) return null;
  return box.x0 >= outer.x0 - grace && box.x1 <= outer.x1 + grace && box.y0 >= outer.y0 - grace && box.y1 <= outer.y1 + grace ? box : null;
}

/** The line's height at x, where it reaches x (a few inches' grace at its ends). */
function heightAt(line: Pt[], x: number): number | null {
  if (line.length === 0) return null;
  const first = line[0] as Pt;
  const last = line[line.length - 1] as Pt;
  const grace = 0.5;
  if (x < first.x - grace || x > last.x + grace) return null;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Pt;
    const b = line[i] as Pt;
    if (x >= a.x && x <= b.x) return b.x === a.x ? Math.max(a.y, b.y) : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return null;
}

/**
 * The trace's pixels as proposals in the side's frame: feet along from its left end, feet up from
 * the one level its heights are from. A polygon of fewer than three corners, an opening with no
 * size, a box with no area, is dropped; anything left is the estimator's to tick or not.
 * [cameraAt] is where the phone stood for each point of the image (lib/roofPhotoRead.ts): without
 * it the roof's pitch is still read, its overhangs are not.
 */
export function traceProposals(wire: TraceWire, frame: SquareFrame, lengthFeet: number, cameraAt: CameraAt | null = null): TraceProposals {
  const shapes: ProposedShape[] = [];
  (wire.materials ?? []).forEach((m, i) => {
    const polygon = (m.polygon ?? []).map((p) => point(frame, p)).filter((p): p is Pt => p !== null);
    if (polygon.length < 3) return;
    const squareFeet = Math.abs(polygonArea(polygon));
    if (squareFeet < 0.5) return;
    shapes.push({ key: `shape-${i}`, ...shapeKind(String(m.material)), polygon, squareFeet, hiddenBy: (m.partly_hidden_by ?? "").trim() });
  });

  const openings: ProposedOpening[] = [];
  const below: string[] = [];
  /** A box [x0, y0, x1, y1] in pixels as feet on the side, or null when it is not one: [] for a leaf not given. */
  const feetBox = (left: unknown, top: unknown, right: unknown, bottom: unknown): FeetBox | null => {
    if (![left, top, right, bottom].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    const [l, t, r, b] = [left, top, right, bottom] as number[] as [number, number, number, number];
    const box = {
      x0: frameAlongM(frame, Math.min(l, r)) * FEET_PER_METRE,
      x1: frameAlongM(frame, Math.max(l, r)) * FEET_PER_METRE,
      y0: frameUpM(frame, Math.max(t, b)) * FEET_PER_METRE,
      y1: frameUpM(frame, Math.min(t, b)) * FEET_PER_METRE,
    };
    return box.x1 - box.x0 < 1 / 12 || box.y1 - box.y0 < 1 / 12 ? null : box;
  };
  (wire.openings ?? []).forEach((o, i) => {
    const box = feetBox(o.left, o.top, o.right, o.bottom);
    if (!box) return;
    const { x0, x1, y0, y1 } = box;
    // As Scan's own openings are read in (lib/exteriorImport.ts): from the left end, from the level, neither below zero.
    const fromLeftFeet = Math.max(0, x0);
    const widthFeet = x1 - fromLeftFeet;
    const sillFeet = Math.max(0, y0);
    // Wholly under the side's level - a basement window in parging below the bottom corners tapped - it has no height above it.
    if (y1 - sillFeet < 1 / 12) {
      below.push(String(o.kind).replace(/_/g, " "));
      return;
    }
    openings.push({
      key: `opening-${i}`,
      kind: openingKind(String(o.kind)),
      traced: String(o.kind).replace(/_/g, " "),
      fromLeftFeet,
      widthFeet,
      sillFeet,
      heightFeet: y1 - sillFeet,
      measuredTo: String(o.measured_to).replace(/_/g, " "),
      hiddenBy: (o.partly_hidden_by ?? "").trim(),
      box,
      // Only a door's, and only one inside the door as traced (a few inches' grace): anything else is not its leaf.
      leaf: o.kind === "door" && Array.isArray(o.leaf) && o.leaf.length === 4 ? insideOf(feetBox(o.leaf[0], o.leaf[1], o.leaf[2], o.leaf[3]), box) : null,
    });
  });

  const line = (wire.wall_top ?? [])
    .map((p) => point(frame, p))
    .filter((p): p is Pt => p !== null)
    .sort((a, b) => a.x - b.x);
  const checks: string[] = [];
  if (below.length > 0) {
    checks.push(`${below.length === 1 ? `A ${below[0]} lies` : `${below.length} openings lie`} below the side's level, where the phone's heights start, so ${below.length === 1 ? "it is" : "they are"} left out: put ${below.length === 1 ? "it" : "them"} in by hand if ${below.length === 1 ? "it is" : "they are"} to be priced.`);
  }
  let wallTop: ProposedWallTop | null = null;
  let peakIndex = -1;
  if (line.length >= 2) {
    const eaveLeftFeet = heightAt(line, 0);
    const eaveRightFeet = heightAt(line, lengthFeet);
    // A peak stands 0.3 m over both ends of the line, between the side's ends - Scan's own rule.
    const ends = Math.max((line[0] as Pt).y, (line[line.length - 1] as Pt).y);
    line.forEach((p, i) => {
      if (i > 0 && i < line.length - 1 && p.x > 0 && p.x < lengthFeet && p.y >= ends + 0.3 * FEET_PER_METRE && (peakIndex < 0 || p.y > (line[peakIndex] as Pt).y)) peakIndex = i;
    });
    let peak: ProposedWallTop["peak"] = null;
    let slopes: ProposedWallTop["slopes"] = null;
    if (peakIndex > 0) {
      const p = line[peakIndex] as Pt;
      peak = { atFeet: p.x, peakFeet: p.y };
      // Each slope over its whole run, peak to eave corner (lib/roofPhotoRead.ts); the roof read says whether they agree.
      slopes = gableSlopes(line, peakIndex);
    } else if (eaveLeftFeet !== null && eaveRightFeet !== null && Math.abs(eaveLeftFeet - eaveRightFeet) > 4 / 12) {
      checks.push(
        `The wall top reads ${formatFeetInches(Math.abs(eaveLeftFeet - eaveRightFeet))} higher at the ${eaveLeftFeet > eaveRightFeet ? "left" : "right"} end. An eave is level, so either the wall steps or the photo leans: check it.`,
      );
    }
    wallTop = { line, eaveLeftFeet, eaveRightFeet, peak, slopes };
  }
  const roof = readRoof(wire.roof, frame, lengthFeet / FEET_PER_METRE, wallTop && peakIndex > 0 ? { line, peakIndex } : null, cameraAt);

  // The roof's shapes (2026-10-15): dormers and turrets as pieces, and what stands over the side.
  const toM = (q: unknown) => {
    const f = point(frame, q);
    return f ? { alongM: f.x / FEET_PER_METRE, upM: f.y / FEET_PER_METRE } : null;
  };
  const rs = wire.roof_shapes;
  const split = rs ? piecesOfWire(rs.pieces, toM) : null;
  const onRoof = split ? readPieces(split.dormers, split.turrets, line.length >= 2 ? line : null, cameraAt) : null;
  if (onRoof) checks.push(...onRoof.checks);
  const eaves = [wallTop?.eaveLeftFeet ?? null, wallTop?.eaveRightFeet ?? null].filter((v): v is number => v !== null);
  const storeys = rs === undefined ? undefined : readStoreys(rs, toM, roof?.over ?? null, eaves.length > 0 ? Math.max(...eaves) : null);

  const offWall = (wire.off_wall ?? []).flatMap((b) => {
    const [x0, y0, x1, y1] = (b.box ?? []) as number[];
    if (![x0, y0, x1, y1].every((v) => typeof v === "number" && Number.isFinite(v))) return [];
    const a = point(frame, [Math.min(x0 as number, x1 as number), Math.max(y0 as number, y1 as number)]) as Pt;
    const c = point(frame, [Math.max(x0 as number, x1 as number), Math.min(y0 as number, y1 as number)]) as Pt;
    if (c.x - a.x < 1 / 12 || c.y - a.y < 1 / 12) return [];
    return [{ what: String(b.what ?? "").trim() || "something", x0: a.x, x1: c.x, y0: a.y, y1: c.y }];
  });

  // A roll-up door (2026-10-19) and the wall's own trim (2026-10-17), off the boxes the prompt asks them in.
  readRollups(offWall, openings);
  const trim = readTrim(offWall, openings, shapes, checks);

  return {
    shapes,
    openings,
    wallTop,
    offWall,
    roof,
    ...(onRoof ? { pieces: onRoof.pieces } : {}),
    ...(storeys !== undefined ? { storeys } : {}),
    ...(trim.trims.length > 0 ? { trims: trim.trims } : {}),
    ...(trim.columns.length > 0 ? { columns: trim.columns } : {}),
    notes: (wire.notes ?? "").trim(),
    checks,
  };
}

// ---------------------------------------------------------------------------------------------
// A roll-up door, read through off_wall (2026-10-19)
// ---------------------------------------------------------------------------------------------

/*
  The opening's kind is a schema enum, and the schema is at the grammar's limit, so a roll-up comes as a garage_door with an
  off_wall box whose words start "roll-up", round its hood or the door itself. The door that box sits on - across most of its
  width, from its foot up to a little over its head - is the roll-up. `traced` stays the AI's own word.
*/
const ROLLUP_WORD = /^\s*roll[- ]?up\b/i;
/** A roll-up's hood sits over its head: up to this far above it. */
const HOOD_ABOVE_FEET = 2;

function readRollups(offWall: TraceProposals["offWall"], openings: ProposedOpening[]): void {
  offWall.forEach((b, i) => {
    if (!ROLLUP_WORD.test(b.what)) return;
    const door = openings.find((o) => {
      if (o.kind === "window" || o.rollupFrom !== undefined) return false;
      const r = o.box ?? { x0: o.fromLeftFeet, x1: o.fromLeftFeet + o.widthFeet, y0: o.sillFeet, y1: o.sillFeet + o.heightFeet };
      const across = Math.min(b.x1, r.x1) - Math.max(b.x0, r.x0);
      return across > 0.5 * Math.min(b.x1 - b.x0, r.x1 - r.x0) && b.y1 > r.y0 && b.y0 < r.y1 + HOOD_ABOVE_FEET;
    });
    if (door) {
      door.kind = "rollup";
      door.rollupFrom = i;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// The wall's trim, read through off_wall (2026-10-17)
// ---------------------------------------------------------------------------------------------

/*
  The trace's schema is at the grammar's limit (flat points, no enums), so the trim comes through a slot it already has:
  an off_wall box whose words start with what it is - "surround, stucco", "keystone", "pilaster", "column", "base", "cap"
  - and end "partly hidden by ..." when it is. Nothing else in off_wall starts with those words; anything that does not
  stays a thing in front of the wall, as before.
*/

const TRIM_WORD = /^\s*(surround|keystone|pilaster|column|base|cap)\b/i;
/** A pilaster's face off the wall, which a square-on photo can't show: a usual 4". */
export const PILASTER_OUT_FEET = 4 / 12;
/** A porch column's back off the wall, which a square-on photo can't show either: a usual porch's depth less the column. */
export const COLUMN_OFF_WALL_FEET = 4;
/** A box inside another, give or take this. */
const TRIM_GRACE_FEET = 0.25;

/** The trim's material in its words; else the wall's own. */
function trimMaterial(what: string, fallback: CladdingKind): { material: CladdingKind; label?: string } {
  const t = what.toLowerCase();
  if (/stucco|plaster/.test(t)) return { material: "stucco" };
  if (/eifs|foam/.test(t)) return { material: "eifs" };
  if (/brick/.test(t)) return { material: "brick" };
  if (/stone/.test(t)) return { material: "stone" };
  if (/vinyl/.test(t)) return { material: "vinyl" };
  if (/fib(re|er) ?cement|hardie/.test(t)) return { material: "fibre_cement" };
  if (/metal|alumin/.test(t)) return { material: "metal" };
  if (/pvc|composite/.test(t)) return { material: "other", label: "PVC" };
  if (/wood|cedar/.test(t)) return { material: "wood" };
  return { material: fallback };
}

const hiddenIn = (what: string) => /partly hidden by (.+?)\s*\.?\s*$/i.exec(what)?.[1]?.trim();

function readTrim(offWall: TraceProposals["offWall"], openings: ProposedOpening[], shapes: ProposedShape[], checks: string[]): { trims: ProposedTrim[]; columns: ProposedColumn[] } {
  const items = offWall.map((b, i) => ({ ...b, i, word: TRIM_WORD.exec(b.what)?.[1]?.toLowerCase() })).filter((b) => b.word);
  if (items.length === 0) return { trims: [], columns: [] };
  // The wall's own material, when the trim's words don't say: the largest counted shape's.
  const main = [...shapes].filter((s) => s.kind !== "parging").sort((a, b) => b.squareFeet - a.squareFeet)[0];
  const fallback: CladdingKind = main && main.kind !== "parging" ? main.kind : "stucco";
  const boxOf = (o: ProposedOpening): FeetBox => o.box ?? { x0: o.fromLeftFeet, x1: o.fromLeftFeet + o.widthFeet, y0: o.sillFeet, y1: o.sillFeet + o.heightFeet };
  const width = (v: number) => (v < 1 / 12 ? 0 : v);
  const trims: ProposedTrim[] = [];
  for (const b of items.filter((x) => x.word === "surround")) {
    const inside = openings.filter((o) => {
      const r = boxOf(o);
      return r.x0 >= b.x0 - TRIM_GRACE_FEET && r.x1 <= b.x1 + TRIM_GRACE_FEET && r.y0 >= b.y0 - TRIM_GRACE_FEET && r.y1 <= b.y1 + TRIM_GRACE_FEET;
    });
    const o = inside.sort((p, q) => q.widthFeet * q.heightFeet - p.widthFeet * p.heightFeet)[0];
    if (!o || trims.some((t) => t.openingKey === o.key)) {
      if (!o) checks.push(`A surround read with no opening inside it was left out (${b.what}).`);
      continue;
    }
    const r = boxOf(o);
    const openTop = /open top/i.test(b.what);
    const hidden = hiddenIn(b.what);
    trims.push({
      key: `trim-${b.i}`,
      openingKey: o.key,
      from: [b.i],
      trim: {
        leftFeet: width(r.x0 - b.x0),
        rightFeet: width(b.x1 - r.x1),
        topFeet: openTop ? 0 : width(b.y1 - r.y1),
        bottomFeet: width(r.y0 - b.y0),
        ...(openTop && b.y1 - r.y1 > 1 / 12 ? { upFeet: b.y1 - r.y1 } : {}),
        ...trimMaterial(b.what, fallback),
        from: "photo",
        ...(hidden ? { unsure: `partly hidden by ${hidden}` } : {}),
      },
    });
  }
  // A keystone sits over an opening's head: on its surround, or on one of its own.
  for (const k of items.filter((x) => x.word === "keystone")) {
    const mid = (k.x0 + k.x1) / 2;
    const o = openings.find((p) => {
      const r = boxOf(p);
      const t = trims.find((x) => x.openingKey === p.key)?.trim;
      return mid > r.x0 && mid < r.x1 && k.y0 >= r.y1 - 0.75 && k.y0 <= r.y1 + (t?.topFeet ?? 0) + 0.75;
    });
    if (!o) continue;
    const r = boxOf(o);
    let t = trims.find((x) => x.openingKey === o.key);
    if (!t) {
      t = { key: `trim-${k.i}`, openingKey: o.key, from: [], trim: { leftFeet: 0, rightFeet: 0, topFeet: 0, bottomFeet: 0, ...trimMaterial(k.what, fallback), from: "photo" } };
      trims.push(t);
    }
    t.from.push(k.i);
    t.trim.keystone = { widthFeet: k.x1 - k.x0, heightFeet: Math.max(1 / 12, k.y1 - r.y1) };
  }
  const columns: ProposedColumn[] = [];
  for (const c of items.filter((x) => x.word === "pilaster" || x.word === "column")) {
    const pilaster = c.word === "pilaster";
    const w = c.x1 - c.x0;
    const foot = Math.max(0, c.y0);
    const hidden = hiddenIn(c.what);
    const blocks = items.filter((x) => (x.word === "base" || x.word === "cap") && Math.min(x.x1, c.x1) - Math.max(x.x0, c.x0) > w / 2);
    const block = (word: string) => {
      const x = blocks.find((q) => q.word === word);
      return x ? { box: x, block: { heightFeet: x.y1 - x.y0, outFeet: Math.max(0, (x.x1 - x.x0 - w) / 2) } } : null;
    };
    const base = block("base");
    const cap = block("cap");
    columns.push({
      key: `column-${c.i}`,
      from: [c.i, ...(base ? [base.box.i] : []), ...(cap ? [cap.box.i] : [])],
      column: {
        kind: pilaster ? "pilaster" : "column",
        fromLeftFeet: c.x0,
        widthFeet: w,
        depthFeet: pilaster ? PILASTER_OUT_FEET : w,
        outFeet: pilaster ? PILASTER_OUT_FEET : COLUMN_OFF_WALL_FEET,
        footFeet: foot,
        heightFeet: Math.max(1 / 12, c.y1 - foot),
        ...(base ? { base: base.block } : {}),
        ...(cap ? { cap: cap.block } : {}),
        ...trimMaterial(c.what, fallback),
        from: "photo",
        ...(hidden ? { unsure: `partly hidden by ${hidden}` } : {}),
      },
    });
  }
  return { trims, columns };
}

/** Pixels of the squared image the trace was asked about, RGB or RGBA. */
export interface SwatchPixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
  channels: 3 | 4;
}

/**
 * Each shape's and each trim's colour off the squared photo (2026-10-17): the middle of the photo's colours inside it -
 * a shape's less its openings and the trim on it - as "#rrggbb", for drawing only: the owner's dark stucco drawn dark and
 * his trim white. Nothing outside the photo (its flat grey) counts; a piece with too little of the photo in it gets none.
 */
export function withSwatches(p: TraceProposals, img: SwatchPixels, frame: SquareFrame): TraceProposals {
  const M = 1 / FEET_PER_METRE;
  const at = (x: number, y: number): [number, number, number] | null => {
    const px = Math.round(frameX(frame, x * M));
    const py = Math.round(frameY(frame, y * M));
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return null;
    const o = (py * img.width + px) * img.channels;
    const rgb: [number, number, number] = [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
    return rgb[0] === OUTSIDE_PHOTO_GREY && rgb[1] === OUTSIDE_PHOTO_GREY && rgb[2] === OUTSIDE_PHOTO_GREY ? null : rgb;
  };
  const inPoly = (poly: Pt[], q: Pt) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i] as Pt;
      const b = poly[j] as Pt;
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  const inBox = (b: FeetBox, q: Pt) => q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1;
  /**
   * The colour over a grid of about 900 points in [inside]'s bounds: each channel's middle for a wall; its upper quarter
   * for trim ([lit]), whose raised pieces each have a lit face and a shaded one - the lit one is its colour.
   */
  const swatch = (bounds: FeetBox, inside: (q: Pt) => boolean, lit = false): string | undefined => {
    const step = Math.max(1 / 24, Math.sqrt(((bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0)) / 900));
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let y = bounds.y0 + step / 2; y < bounds.y1; y += step) {
      for (let x = bounds.x0 + step / 2; x < bounds.x1; x += step) {
        if (!inside({ x, y })) continue;
        const c = at(x, y);
        if (!c) continue;
        rs.push(c[0]);
        gs.push(c[1]);
        bs.push(c[2]);
      }
    }
    if (rs.length < 12) return undefined;
    const mid = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * (lit ? 0.75 : 0.5))] as number;
    return `#${[mid(rs), mid(gs), mid(bs)].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  };
  const boxOf = (o: ProposedOpening): FeetBox => o.box ?? { x0: o.fromLeftFeet, x1: o.fromLeftFeet + o.widthFeet, y0: o.sillFeet, y1: o.sillFeet + o.heightFeet };
  const holes = p.openings.map(boxOf);
  // The trim's outer boxes: kept off the wall's swatch.
  const trimBoxes: FeetBox[] = [];
  const trims = (p.trims ?? []).map((t) => {
    const o = p.openings.find((q) => q.key === t.openingKey);
    if (!o) return t;
    const r = boxOf(o);
    const g = t.trim.gapFeet ?? 0;
    const outer = { x0: r.x0 - g - t.trim.leftFeet, x1: r.x1 + g + t.trim.rightFeet, y0: r.y0 - (t.trim.bottomFeet > 0 ? g + t.trim.bottomFeet : 0), y1: Math.max(r.y1 + g + t.trim.topFeet, r.y1 + (t.trim.upFeet ?? 0)) };
    trimBoxes.push(outer);
    const inner = { x0: r.x0 - g, x1: r.x1 + g, y0: r.y0 - (t.trim.bottomFeet > 0 ? g : 0), y1: r.y1 + g };
    const colour = swatch(outer, (q) => inBox(outer, q) && !inBox(inner, q), true);
    return colour ? { ...t, trim: { ...t.trim, colour } } : t;
  });
  const columns = (p.columns ?? []).map((c) => {
    const k = c.column;
    const box = { x0: k.fromLeftFeet, x1: k.fromLeftFeet + k.widthFeet, y0: k.footFeet, y1: k.footFeet + k.heightFeet };
    trimBoxes.push(box);
    const colour = swatch(box, (q) => inBox(box, q), true);
    return colour ? { ...c, column: { ...k, colour } } : c;
  });
  const shapes = p.shapes.map((s) => {
    const xs = s.polygon.map((q) => q.x);
    const ys = s.polygon.map((q) => q.y);
    const bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const colour = swatch(bounds, (q) => inPoly(s.polygon, q) && !holes.some((h) => inBox(h, q)) && !trimBoxes.some((h) => inBox(h, q)) && !p.offWall.some((h) => inBox(h, q)));
    return colour ? { ...s, colour } : s;
  });
  return { ...p, shapes, ...(p.trims ? { trims } : {}), ...(p.columns ? { columns } : {}) };
}

/** The roof's reads ticked (true) or not (false); one the trace did not read is left out. */
export interface RoofPicks {
  pitch?: boolean;
  rake?: boolean;
  eave?: boolean;
  over?: boolean;
}

/**
 * A trace's wall top and roof lines set on the squared photo's own edges, and the roof read again off
 * them (2026-10-15, lib/roofPhotoRead.ts `snapRoof`): Claude puts those lines within 5-25 px of the
 * edges in a 2400 px image, and the rake overhang is the gap between two of them. The editor does it,
 * having the picture; [g] is the squared image Claude was sent. A trace whose wall top has no peak,
 * or whose lines the photo doesn't show, comes back as it was.
 */
export function snapTrace(p: TraceProposals, frame: SquareFrame, g: Gray, lengthFeet: number, cameraAt: CameraAt | null): TraceProposals {
  const roof = p.roof;
  const top = p.wallTop;
  if (!roof || !top?.peak || roof.snapped) return p;
  const peakIndex = top.line.findIndex((q) => q.x === top.peak?.atFeet && q.y === top.peak?.peakFeet);
  if (peakIndex <= 0) return p;
  const seen = (q: Pt) => ({ alongM: q.x / FEET_PER_METRE, upM: q.y / FEET_PER_METRE });
  const traced: RoofLines = {
    said: roof.said,
    rakeLeft: roof.lines.rakeLeft.map(seen),
    rakeRight: roof.lines.rakeRight.map(seen),
    eave: roof.lines.eave.map(seen),
    leftEnd: { kind: roof.ends.left, point: roof.lines.leftEnd ? seen(roof.lines.leftEnd) : null },
    rightEnd: { kind: roof.ends.right, point: roof.lines.rightEnd ? seen(roof.lines.rightEnd) : null },
    notes: roof.notes,
  };
  const s = snapRoof(g, frame, { line: top.line, peakIndex }, traced, cameraAt);
  if (!s) return p;
  const line = s.wallTop.line;
  const apex = line[s.wallTop.peakIndex] as Pt;
  // A snapped run that turns by more than 1/2 in 12 has caught some other line (a soffit seen edge-on, a fascia): as traced.
  const was = gableSlopes(top.line, peakIndex);
  const now = gableSlopes(line, s.wallTop.peakIndex);
  if (!was || !now || Math.abs(was[0] - now[0]) > 0.5 || Math.abs(was[1] - now[1]) > 0.5) return p;
  const wallTop: ProposedWallTop = {
    line,
    eaveLeftFeet: heightAt(line, 0),
    eaveRightFeet: heightAt(line, lengthFeet),
    peak: { atFeet: apex.x, peakFeet: apex.y },
    slopes: gableSlopes(line, s.wallTop.peakIndex),
  };
  const snapped = { wallTopInches: s.movedInches.wallTop, fasciaInches: s.movedInches.fascia };
  return { ...p, wallTop, roof: readRoofLines(s.lines, lengthFeet / FEET_PER_METRE, s.wallTop, cameraAt, snapped, traced) };
}

/** Which proposals the estimator ticked, with any material or kind they changed. */
export interface TracePicks {
  shapes: { key: string; kind: CladdingKind | "parging" }[];
  openings: { key: string; kind: ExteriorOpeningKind }[];
  wallTop: boolean;
  /** The roof's reads (2026-10-15). Absent: the roof is left as it was. */
  roof?: RoofPicks;
  /** The roof's shapes (2026-10-15): each piece by its key, and what stands over the side. Absent: left as they were. */
  roofShapes?: ShapePicks;
  /**
   * The trim ticked (2026-10-17): surrounds and columns by key. A surround goes on with its opening, ticked; ticked
   * columns replace the side's, as ticked shapes do. Absent: no trim put on.
   */
  trims?: string[];
}

/** What starts ticked of the trim: all of it. */
export function trimPicksAtFirst(p: Pick<TraceProposals, "trims" | "columns">): string[] {
  return [...(p.trims ?? []).map((t) => t.key), ...(p.columns ?? []).map((c) => c.key)];
}

/** The roof's shapes ticked (true) or not (false), as `RoofPicks`: a piece by its key; a read the trace did not make is left out. */
export interface ShapePicks {
  pieces: Record<string, boolean>;
  upper?: boolean;
  floorLine?: boolean;
  lowerRoof?: boolean;
}

/** What starts ticked of the shapes: each piece and read that holds together. */
export function shapePicksAtFirst(p: Pick<TraceProposals, "pieces" | "storeys">): ShapePicks {
  const picks: ShapePicks = { pieces: Object.fromEntries((p.pieces ?? []).map((q) => [q.key, q.agree])) };
  const s = p.storeys;
  if (s?.upper) picks.upper = s.agree.upper;
  if (s?.floorLineFeet != null) picks.floorLine = s.agree.floorLine && s.agree.upper;
  if (s?.lowerRoof) picks.lowerRoof = s.agree.lowerRoof;
  return picks;
}

/** Anything of the shapes to put on the side, ticked or not. */
function anyShapes(sp: ShapePicks | undefined): sp is ShapePicks {
  return !!sp && (Object.keys(sp.pieces).length > 0 || sp.upper !== undefined || sp.floorLine !== undefined || sp.lowerRoof !== undefined);
}

/** Within this along the side, a piece read again is the one read before: kind and place. */
const SAME_PIECE_FEET = 2.5;

/** What starts ticked: every read that holds together - a pitch whose slopes agree on a whole pitch, an overhang read alike both ways. */
export function roofPicksAtFirst(roof: ProposedRoof | null | undefined): RoofPicks {
  if (!roof) return {};
  const picks: RoofPicks = {};
  if (roof.pitch) picks.pitch = roof.pitch.agree && roof.pitch.onWhole !== false;
  if (roof.rakeOverhang) picks.rake = roof.rakeOverhang.agree;
  if (roof.eaveOverhang) picks.eave = roof.eaveOverhang.agree;
  if (roof.over) picks.over = true;
  return picks;
}

/**
 * The ticked proposals onto the side. Ticked shapes replace the side's shapes, and ticked openings
 * its openings - each only when any are ticked, so a side whose phone taps are kept loses nothing.
 * The wall top sets the eaves over each end it reaches, and the peak when it has one. The roof's
 * reads go on the side as `roofRead`, ticked or not: a read set aside is kept as set aside (null), so
 * the gable it came from gives no pitch either (lib/exterior.ts, `exteriorPitch`). So do the roof's
 * shapes (2026-10-15): each dormer or turret kept with its tick (`PhotoPiece.taken`), and what stands
 * over the side.
 */
export function applyTrace(side: ExteriorSide, proposals: TraceProposals, picks: TracePicks, at: string = new Date().toISOString()): ExteriorSide {
  const next: ExteriorSide = { ...side };
  if (picks.shapes.length > 0) {
    next.shapes = picks.shapes.flatMap(({ key, kind }) => {
      const s = proposals.shapes.find((p) => p.key === key);
      if (!s) return [];
      const shape: ExteriorShape = { id: newSketchId("shape"), kind, closed: true, polygon: s.polygon.map((p) => ({ ...p })) };
      if (kind === "other" && s.label) shape.label = s.label;
      // Its colour off the photo (2026-10-17), the same material or not: what the wall looks like.
      if (s.colour) shape.colour = s.colour;
      return [shape];
    });
  }
  const trimPicked = new Set(picks.trims ?? []);
  if (picks.openings.length > 0) {
    next.openings = picks.openings.flatMap(({ key, kind }) => {
      const o = proposals.openings.find((p) => p.key === key);
      if (!o) return [];
      const opening: ExteriorOpening = { id: newSketchId("opening"), kind, widthFeet: o.widthFeet, heightFeet: o.heightFeet, sillFeet: o.sillFeet, fromLeftFeet: o.fromLeftFeet };
      // What hid part of it rides along (2026-10-16): its kind is asked on "Check these".
      if (o.hiddenBy) opening.hiddenBy = o.hiddenBy;
      // Its surround (2026-10-17), ticked, goes on with it; widths are past the opening as traced, and its clipped left end moves them.
      const t = (proposals.trims ?? []).find((x) => x.openingKey === key && trimPicked.has(x.key));
      if (t) {
        const cut = o.box ? o.fromLeftFeet - o.box.x0 : 0;
        opening.trim = { ...t.trim, leftFeet: Math.max(0, t.trim.leftFeet + cut) };
      }
      return [opening];
    });
  }
  const columns = (proposals.columns ?? []).filter((c) => trimPicked.has(c.key));
  if (columns.length > 0) next.columns = columns.map((c) => ({ id: newSketchId("column"), ...c.column }));
  const top = proposals.wallTop;
  if (picks.wallTop && top) {
    if (top.eaveLeftFeet !== null) next.eaveLeftFeet = top.eaveLeftFeet;
    if (top.eaveRightFeet !== null) next.eaveRightFeet = top.eaveRightFeet;
    if (top.peak) {
      next.gable = { peakFeet: top.peak.peakFeet, atFeet: top.peak.atFeet };
      // A trace from before the roof was read: its pitch came with the wall top.
      if (proposals.roof === undefined && top.slopes) next.pitchMeasured = (top.slopes[0] + top.slopes[1]) / 2;
    }
  }
  const roof = proposals.roof;
  const rp = picks.roof ?? {};
  const sp = picks.roofShapes;
  if ((roof && Object.keys(rp).length > 0) || anyShapes(sp)) {
    const read: SideRoofRead = { at };
    if (roof?.pitch && rp.pitch !== undefined) {
      read.pitch = rp.pitch ? roof.pitch.value : null;
      read.slopes = roof.pitch.slopes;
      // The pitch this side gives is the photo's, or none: a gable set aside must not give one off its peak.
      next.pitchMeasured = rp.pitch ? roof.pitch.value : null;
    }
    if (roof?.rakeOverhang && rp.rake !== undefined) read.rakeOverhangFeet = rp.rake ? roof.rakeOverhang.feet : null;
    if (roof?.eaveOverhang && rp.eave !== undefined) read.eaveOverhangFeet = rp.eave ? roof.eaveOverhang.feet : null;
    if (roof?.over && rp.over !== undefined) read.over = rp.over ? roof.over : null;
    if (anyShapes(sp)) {
      // Every piece read is kept, ticked or not: one not ticked is offered on the roof pane, counting nothing.
      const before = side.roofRead?.pieces ?? [];
      const pieces: PhotoPiece[] = (proposals.pieces ?? []).flatMap((q) => {
        if (sp.pieces[q.key] === undefined) return [];
        const piece: PhotoPiece = { ...q.piece, id: newSketchId("roofpiece"), taken: sp.pieces[q.key] === true };
        // The same piece read again, that the estimator had made their own: theirs still stands in its place.
        const same = before.find((b) => b.typedAs && b.kind === q.piece.kind && Math.abs(b.alongFeet - q.piece.alongFeet) <= SAME_PIECE_FEET);
        if (same?.typedAs) piece.typedAs = same.typedAs;
        return [piece];
      });
      if (pieces.length > 0) read.pieces = pieces;
      const st = proposals.storeys;
      if (st?.upper && sp.upper !== undefined) read.upper = sp.upper ? st.upper : null;
      if (st?.floorLineFeet != null && sp.floorLine !== undefined) read.floorLineFeet = sp.floorLine ? st.floorLineFeet : null;
      if (st?.lowerRoof && sp.lowerRoof !== undefined) read.lowerRoof = sp.lowerRoof ? st.lowerRoof : null;
    }
    next.roofRead = read;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// What a call cost
// ---------------------------------------------------------------------------------------------

/**
 * Claude Opus 5.5's list price, dollars a million tokens, as of 2026-10: what the trace's log line
 * multiplies by. The console is the authority on what was really spent; this is the estimate the
 * owner asked to see per call, to decide later what a scan should be charged.
 */
export const TRACE_PRICE_PER_MILLION = { model: "claude-opus-5-5", input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

export function traceCostUsd(usage: CallUsage): number {
  const p = TRACE_PRICE_PER_MILLION;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheCreationTokens * p.cacheWrite + usage.cacheReadTokens * p.cacheRead) / 1e6;
}

/** The request the editor posts, and what the route answers. */
export interface TraceRequest {
  /** The squared image, JPEG, base64 with no data: prefix. */
  image: string;
  frame: SquareFrame;
  side: TraceSide;
  /**
   * The photos the image was squared from, in that order: where each phone stood is what the roof's
   * overhangs are read through (2026-10-15). Absent from an older editor: the pitch is still read.
   */
  photos?: Pick<SidePhoto, "toPhoto" | "camera">[];
  /**
   * The house's scale when the trace was asked for (lib/exteriorScale.ts): a trace that waited for a
   * signal while the house was scaled again is in the old sizes, and is set aside. The route ignores it.
   */
  scaleAt?: number;
}

export interface TraceResponse {
  proposals: TraceProposals;
  model: string;
  seconds: number;
  usage: CallUsage;
  costUsd: number;
}

/** A trace kept against a side until it is used or set aside. */
export interface SideTrace extends TraceResponse {
  at: string;
  /** The house's scale it was traced at (2026-10-15): one traced before the house was scaled again is in the old sizes. */
  scaleAt?: number;
}
