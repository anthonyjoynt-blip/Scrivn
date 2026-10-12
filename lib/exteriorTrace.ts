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
 * words.
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
} from "./exterior";
import type { CallUsage } from "./anthropic";
import { frameAlongM, frameUpM, frameX, frameY, OUTSIDE_PHOTO_GREY, type SquareFrame } from "./exteriorPhoto";
import { polygonArea, type Pt } from "./roof";
import { formatFeetInches, newSketchId } from "./sketch";

const FEET_PER_METRE = 1 / 0.3048;

/** Scan's materials, in its picker's order, and "other". */
export const TRACE_MATERIALS = ["stucco", "vinyl", "wood_shake", "eifs", "wood", "fibre_cement", "brick", "stone", "metal", "parging", "other"] as const;
const OPENING_KINDS = ["window", "door", "patio_door", "garage_door"] as const;

const POINT = { type: "array", items: { type: "number" } };
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
          partly_hidden_by: { type: "string" },
        },
        required: ["kind", "left", "right", "top", "bottom", "measured_to", "partly_hidden_by"],
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
    notes: { type: "string" },
  },
  required: ["materials", "openings", "wall_top", "off_wall", "notes"],
  additionalProperties: false,
};

/** What the call answers, in the squared image's pixels. */
export interface TraceWire {
  materials: { material: string; polygon: number[][]; partly_hidden_by: string }[];
  openings: { kind: string; left: number; right: number; top: number; bottom: number; measured_to: string; partly_hidden_by: string }[];
  wall_top: number[][];
  off_wall: { what: string; box: number[] }[];
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
2. openings: every window, door, patio door and garage door on this wall. A window or door: to the outer edge of its trim, or of its frame where it has no trim; say which. A garage door: the door itself - the panels that move, from their bottom edge to their top edge and side to side - never the trim, jamb or stucco surround framing it; its measured_to is "door_itself".
3. wall_top: the line where the wall's cladding meets the soffit, left to right, including any gable peak, as a polyline.
4. off_wall: everything in front of the wall that hides part of it, as boxes [x0, y0, x1, y1].
5. notes: anything that makes this wall hard to trace, and anything you are unsure of.`;
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
  /** What the trace was unsure of, in its words. */
  notes: string;
  /** The test's own checks: both slopes of a gable alike, an eave level end to end. */
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
 */
export function traceProposals(wire: TraceWire, frame: SquareFrame, lengthFeet: number): TraceProposals {
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
  (wire.openings ?? []).forEach((o, i) => {
    if (![o.left, o.right, o.top, o.bottom].every((v) => typeof v === "number" && Number.isFinite(v))) return;
    const x0 = frameAlongM(frame, Math.min(o.left, o.right)) * FEET_PER_METRE;
    const x1 = frameAlongM(frame, Math.max(o.left, o.right)) * FEET_PER_METRE;
    const y0 = frameUpM(frame, Math.max(o.top, o.bottom)) * FEET_PER_METRE;
    const y1 = frameUpM(frame, Math.min(o.top, o.bottom)) * FEET_PER_METRE;
    if (x1 - x0 < 1 / 12 || y1 - y0 < 1 / 12) return;
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
  if (line.length >= 2) {
    const eaveLeftFeet = heightAt(line, 0);
    const eaveRightFeet = heightAt(line, lengthFeet);
    // A peak stands 0.3 m over both ends of the line, between the side's ends - Scan's own rule.
    const ends = Math.max((line[0] as Pt).y, (line[line.length - 1] as Pt).y);
    let at = -1;
    line.forEach((p, i) => {
      if (i > 0 && i < line.length - 1 && p.x > 0 && p.x < lengthFeet && p.y >= ends + 0.3 * FEET_PER_METRE && (at < 0 || p.y > (line[at] as Pt).y)) at = i;
    });
    let peak: ProposedWallTop["peak"] = null;
    let slopes: ProposedWallTop["slopes"] = null;
    if (at > 0) {
      const p = line[at] as Pt;
      const before = line[at - 1] as Pt;
      const after = line[at + 1] as Pt;
      peak = { atFeet: p.x, peakFeet: p.y };
      slopes = [((p.y - before.y) / Math.max(1e-6, p.x - before.x)) * 12, ((p.y - after.y) / Math.max(1e-6, after.x - p.x)) * 12];
      const [l, r] = slopes;
      checks.push(
        Math.abs(l - r) > 0.5
          ? `The gable's two slopes read ${l.toFixed(1)} and ${r.toFixed(1)} on 12. A gable's are usually alike: check the peak, and the photo, before using it.`
          : `Both slopes of the gable read ${((l + r) / 2).toFixed(1)} on 12.`,
      );
    } else if (eaveLeftFeet !== null && eaveRightFeet !== null && Math.abs(eaveLeftFeet - eaveRightFeet) > 4 / 12) {
      checks.push(
        `The wall top reads ${formatFeetInches(Math.abs(eaveLeftFeet - eaveRightFeet))} higher at the ${eaveLeftFeet > eaveRightFeet ? "left" : "right"} end. An eave is level, so either the wall steps or the photo leans: check it.`,
      );
    }
    wallTop = { line, eaveLeftFeet, eaveRightFeet, peak, slopes };
  }

  const offWall = (wire.off_wall ?? []).flatMap((b) => {
    const [x0, y0, x1, y1] = (b.box ?? []) as number[];
    if (![x0, y0, x1, y1].every((v) => typeof v === "number" && Number.isFinite(v))) return [];
    const a = point(frame, [Math.min(x0 as number, x1 as number), Math.max(y0 as number, y1 as number)]) as Pt;
    const c = point(frame, [Math.max(x0 as number, x1 as number), Math.min(y0 as number, y1 as number)]) as Pt;
    if (c.x - a.x < 1 / 12 || c.y - a.y < 1 / 12) return [];
    return [{ what: String(b.what ?? "").trim() || "something", x0: a.x, x1: c.x, y0: a.y, y1: c.y }];
  });

  return { shapes, openings, wallTop, offWall, notes: (wire.notes ?? "").trim(), checks };
}

/** Which proposals the estimator ticked, with any material or kind they changed. */
export interface TracePicks {
  shapes: { key: string; kind: CladdingKind | "parging" }[];
  openings: { key: string; kind: ExteriorOpeningKind }[];
  wallTop: boolean;
}

/**
 * The ticked proposals onto the side. Ticked shapes replace the side's shapes, and ticked openings
 * its openings - each only when any are ticked, so a side whose phone taps are kept loses nothing.
 * The wall top sets the eaves over each end it reaches, and the peak and pitch when it has one.
 */
export function applyTrace(side: ExteriorSide, proposals: TraceProposals, picks: TracePicks): ExteriorSide {
  const next: ExteriorSide = { ...side };
  if (picks.shapes.length > 0) {
    next.shapes = picks.shapes.flatMap(({ key, kind }) => {
      const s = proposals.shapes.find((p) => p.key === key);
      if (!s) return [];
      const shape: ExteriorShape = { id: newSketchId("shape"), kind, closed: true, polygon: s.polygon.map((p) => ({ ...p })) };
      if (kind === "other" && s.label) shape.label = s.label;
      return [shape];
    });
  }
  if (picks.openings.length > 0) {
    next.openings = picks.openings.flatMap(({ key, kind }) => {
      const o = proposals.openings.find((p) => p.key === key);
      if (!o) return [];
      const opening: ExteriorOpening = { id: newSketchId("opening"), kind, widthFeet: o.widthFeet, heightFeet: o.heightFeet, sillFeet: o.sillFeet, fromLeftFeet: o.fromLeftFeet };
      return [opening];
    });
  }
  const top = proposals.wallTop;
  if (picks.wallTop && top) {
    if (top.eaveLeftFeet !== null) next.eaveLeftFeet = top.eaveLeftFeet;
    if (top.eaveRightFeet !== null) next.eaveRightFeet = top.eaveRightFeet;
    if (top.peak) {
      next.gable = { peakFeet: top.peak.peakFeet, atFeet: top.peak.atFeet };
      if (top.slopes) next.pitchMeasured = (top.slopes[0] + top.slopes[1]) / 2;
    }
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
}
