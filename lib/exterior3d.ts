/**
 * The outside of the house in three dimensions (2026-10-13): what the exterior's 3D view draws
 * (components/sketch/Exterior3D.tsx). Pure geometry, so it is tested in Node with the rest of the
 * exterior (test/exterior/run.mjs).
 *
 * "Once roof and siding are captured, could Scrivn render a 3D view" (the owner). Everything here is
 * read from the exterior model as it stands - the sides as measured, the footprint they close into,
 * the roof `buildRoof` works out over it - and nothing is worked out a second way: a wall stands as
 * high as `roofRiseAlongWall` says the roof's underside is over it, and each slope is lifted by the
 * very plane the plan's lines were read off (`roofHeightAt`). So the roof meets the walls exactly, and
 * where it does not, the model is wrong and the view shows it.
 *
 * UNITS ARE FEET. The view's x is the footprint's x, its z the footprint's y turned round (the front,
 * along the footprint's y = 0, is nearest the view), and its y is up.
 *
 * ── Heights ────────────────────────────────────────────────────────────────────────────────────
 * A side is measured from the ground under it, and the roof from its drip line; the view needs both
 * on one level. Each roof's eave - the top of the walls under its eaves - is where the sides under it
 * say it is: the middle reading of their eave heights (`eaveLevels`), so one stray tap moves nothing.
 * A side then stands its own eave reading below that, which is where its ground is. On a lot that
 * falls to the back the rear walls stand taller and their ground lower, which is what the ground drawn
 * round the house (`ground`) follows.
 *
 * A side tapped on the phone has every height from one level and its eaves "worked out from the
 * shapes: the highest corner over each bottom corner" (lib/exteriorImport.ts): its higher eave is the
 * one the roof sits on, a lower one being a shape that stops short of it.
 *
 * ── The roof ───────────────────────────────────────────────────────────────────────────────────
 * Its underside is the plane, and its top a slab's thickness above: the walls meet the underside,
 * as a side's gable meets the roof in the elevation, and the slab's edge round the drip line is the
 * fascia. A roof set lower against a wall (a garage) stands on its own walls' eave, and the house's
 * wall over it is drawn from that roof up to the house's roof - the strip of siding between.
 */

import {
  CLADDING_KINDS,
  type CladdingKind,
  DEFAULT_EAVE_FEET,
  elevationFaces,
  elevationShape,
  type Exterior,
  exteriorFootprint,
  exteriorPitch,
  formatPitch,
  type ExteriorOpeningKind,
  type ExteriorSide,
  type Footprint,
  openingRect,
  type RoofRise,
  roofInput,
  type SidePhoto,
} from "./exterior";
import { buildRoof, polygonArea, type Pt, roofHeightAt, type RoofInput, type RoofPlan, roofRiseAlongWall, type RoofSection } from "./roof";

export type V3 = [number, number, number];

/** How thick the roof is drawn: its deck and shingles, and so the fascia round its edge. */
export const ROOF_THICKNESS_FEET = 0.5;
/** A lower porch roof's height is not measured: its top meets the wall this far under the house's eave. */
export const LEAN_TO_BELOW_EAVE_FEET = 1.5;
/** How far in from a porch roof's eave its posts stand, and the most room between two. */
const POST_INSET_FEET = 1;
const POST_SPACING_FEET = 10;
export const POST_SIZE_FEET = 0.45;
/** Walls are carried this far below the lowest ground, so no gap shows under one where the ground dips. */
const BELOW_GROUND_FEET = 1;
const EPS = 1e-6;

export type WallFaceKind = CladdingKind | "parging";

export interface Wall3D {
  id: string;
  /** The side it is; null for the house's wall standing over a lower roof (a garage's), which is no side. */
  sideId: string | null;
  name: string;
  /** Where its left end stands (at height 0), and the units along it and out of it: a point (u along, v up) is origin + along·u + (0, v, 0). */
  origin: V3;
  along: V3;
  out: V3;
  length: number;
  /** Its face in (u along, v up), a simple polygon: from below the ground up to the roof's underside. */
  outline: Pt[];
  /** The ground it was measured from, left to right; null for a wall over a roof. */
  grade: Pt[] | null;
  /** Its cladding, drawn in order - a later face over an earlier one, as on the elevation - in (u, v). */
  faces: { kind: WallFaceKind; poly: Pt[] }[];
  /** What shows where no face is: the side's top band, or nothing measured ("unclad") on a side tapped as shapes. */
  background: CladdingKind | "unclad";
  /** Windows, doors and garage doors, in (u, v). */
  openings: { id: string; kind: ExteriorOpeningKind; x0: number; x1: number; y0: number; y1: number }[];
  /** v of the side's own frame's zero (its heights are from there): what lays its photos on it. */
  frameV: number;
  photos: SidePhoto[];
}

export interface Roof3D {
  /** Triangles, x y z flattened: the top of every slope (facing up), the underside (the soffit over the overhangs). */
  top: number[];
  under: number[];
  /** The slab's edge round every eave and rake. */
  fascia: number[];
  /** A cross gable's face: siding under its rakes. */
  gables: number[];
  /** Where one part of a roof stands over another of the same roof (a gable's face over a porch running under it): siding. */
  steps: number[];
  /** Ridges, hips and valleys on the top. */
  lines: { kind: "ridge" | "hip" | "valley"; a: V3; b: V3 }[];
  /** Each slope's letter, over it, and which way the slope faces (a unit normal): a letter is read only from the side it is on. */
  labels: { text: string; at: V3; normal: V3 }[];
}

export interface Ground3D {
  /** A grid of heights over x from x0 and z from z0, `step` apart, `nx` by `nz` points, row by row along x. */
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  heights: number[];
}

export interface ExteriorModel3D {
  walls: Wall3D[];
  /** Null with no roof worked out: no pitch, or an outline the roof is not built for. */
  roof: Roof3D | null;
  /** Under a porch roof and at a covered deck's open corner: each from the ground to the roof. */
  posts: { x: number; z: number; y0: number; y1: number }[];
  /** Flat ceilings under the roof a covered deck is under, triangles. */
  ceilings: number[];
  ground: Ground3D;
  /** Each roof's eave height in the view, by layer: 0 the house's. */
  eaves: Record<number, number>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** What the view can't show as the model has it, in the estimator's words. */
  notes: string[];
}

export type ExteriorModelResult = { ok: true; model: ExteriorModel3D } | { ok: false; reason: string };

/** Plan (x, y) at height h, in the view. */
const at3 = (p: Pt, h: number): V3 => [p.x, h, -p.y];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function insideRect(r: { x0: number; x1: number; y0: number; y1: number }, p: Pt): boolean {
  return p.x >= r.x0 - EPS && p.x <= r.x1 + EPS && p.y >= r.y0 - EPS && p.y <= r.y1 + EPS;
}

/** The roof whose walls stand at a point of a wall: the lowest layer that has walls there, as `roofRiseAlongWall` picks it. */
function layerAtWall(sections: RoofSection[], p: Pt): number {
  const layers = [...new Set(sections.map((s) => s.layer))].sort((a, b) => a - b);
  for (const l of layers) if (sections.some((s) => s.layer === l && s.wall && insideRect(s.wall, p))) return l;
  return 0;
}

/** A side's pieces along its wall, each under one roof: (t0, t1) fractions along, the layer, and the rise at each end. */
interface Stretch {
  t0: number;
  t1: number;
  layer: number;
  r0: number;
  r1: number;
}

function stretchesOf(input: RoofInput | null, plan: RoofPlan | null, a: Pt, b: Pt): Stretch[] {
  const mid = (t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  if (!input || !plan || plan.shape === "other") return [{ t0: 0, t1: 1, layer: 0, r0: 0, r1: 0 }];
  const rise = roofRiseAlongWall(input, a, b);
  if (rise.length < 2) return [{ t0: 0, t1: 1, layer: layerAtWall(plan.sections, mid(0.5)), r0: 0, r1: 0 }];
  const out: Stretch[] = [];
  for (let k = 0; k + 1 < rise.length; k++) {
    const p = rise[k] as { t: number; rise: number };
    const q = rise[k + 1] as { t: number; rise: number };
    if (q.t - p.t < 1e-9) continue;
    out.push({ t0: p.t, t1: q.t, layer: layerAtWall(plan.sections, mid((p.t + q.t) / 2)), r0: p.rise, r1: q.rise });
  }
  return out.length > 0 ? out : [{ t0: 0, t1: 1, layer: layerAtWall(plan.sections, mid(0.5)), r0: 0, r1: 0 }];
}

/** A side's two eave readings, as the roof sits on them: see the doc above. Null with no eave measured. */
function eaveReadings(side: ExteriorSide, sameRoof: boolean): [number, number] | null {
  if (side.eaveLeftFeet == null) return null;
  const left = side.eaveLeftFeet;
  const right = side.eaveRightFeet ?? left;
  if (side.heightsFrom === "level" && sameRoof) {
    const high = Math.max(left, right);
    return [high, high];
  }
  return [left, right];
}

/**
 * Each roof's eave in the view: the middle of what the sides under it read, so the ground averages
 * out at about 0. A lower porch roof, which no side stands under, meets the wall
 * [LEAN_TO_BELOW_EAVE_FEET] under the house's eave.
 */
function eaveLevels(sides: { side: ExteriorSide; stretches: Stretch[] }[], plan: RoofPlan | null, overhang: number, rise: number): Record<number, number> {
  const readings = new Map<number, number[]>();
  for (const { side, stretches } of sides) {
    const first = stretches[0] as Stretch;
    const last = stretches[stretches.length - 1] as Stretch;
    const r = eaveReadings(side, first.layer === last.layer);
    if (!r) continue;
    readings.set(first.layer, [...(readings.get(first.layer) ?? []), r[0]]);
    readings.set(last.layer, [...(readings.get(last.layer) ?? []), r[1]]);
  }
  const e0 = median(readings.get(0) ?? []) ?? median([...readings.values()].flat()) ?? DEFAULT_EAVE_FEET;
  const out: Record<number, number> = { 0: e0 };
  for (const layer of new Set(plan?.sections.map((s) => s.layer) ?? [])) {
    if (layer === 0) continue;
    const own = median(readings.get(layer) ?? []);
    if (own !== null) {
      out[layer] = own;
      continue;
    }
    // A lean-to: its one slope rises to the wall, `depth` of run from its drip line - see `withAdditions`.
    const porch = plan?.sections.find((s) => s.layer === layer && s.role === "porch" && s.planes?.length === 1);
    const plane = porch?.planes?.[0];
    if (porch && plane) {
      const depth = Math.max(...[porch.x0, porch.x1].flatMap((x) => [porch.y0, porch.y1].map((y) => plane.a * x + plane.b * y + plane.c)));
      out[layer] = e0 - LEAN_TO_BELOW_EAVE_FEET - (depth - overhang) * rise;
    } else out[layer] = e0;
  }
  return out;
}

/** Where a footprint side runs in the view. */
function wallFrame(a: Pt, b: Pt): { origin: V3; along: V3; out: V3; length: number } {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  // The footprint goes counter-clockwise, so out is to the right of the way along: (d.y, -d.x) in plan.
  return { origin: at3(a, 0), along: [d.x, 0, -d.y], out: [d.y, 0, d.x], length };
}

/** The dominant cladding of the house by area, for a strip of wall nobody measured. */
function mainCladding(walls: Wall3D[]): CladdingKind {
  const area = new Map<CladdingKind, number>();
  for (const w of walls) for (const f of w.faces) if (f.kind !== "parging" && f.poly.length >= 3) area.set(f.kind, (area.get(f.kind) ?? 0) + polygonArea(f.poly));
  let best: CladdingKind = "stucco";
  let most = 0;
  for (const kind of CLADDING_KINDS) if ((area.get(kind) ?? 0) > most) [best, most] = [kind, area.get(kind) as number];
  return best;
}

/** Inverse-distance ground through the measured points; the far field settles to their average. */
function groundAt(samples: { x: number; z: number; h: number }[], x: number, z: number): number {
  let sum = 0;
  let weight = 0;
  for (const s of samples) {
    const w = 1 / ((s.x - x) ** 2 + (s.z - z) ** 2 + 1);
    sum += w * s.h;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

/** A convex polygon, counter-clockwise in plan. */
function ccw(poly: Pt[]): Pt[] {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    s += p.x * q.y - q.x * p.y;
  }
  return s < 0 ? [...poly].reverse() : poly;
}

function onSegment(p: Pt, a: Pt, b: Pt): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t <= 1e-7 || t >= 1 - 1e-7) return null;
  const off = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(len2);
  return off < 1e-6 ? t : null;
}

/** A plane height = a·x + b·y + c, in feet of run. */
type PlanePt = { a: number; b: number; c: number };
const planeZ = (p: PlanePt, q: Pt) => p.a * q.x + p.b * q.y + p.c;

/**
 * The house in 3D, or why not: a footprint is needed to stand the walls on (the sides closed round),
 * and a pitch for a roof.
 */
export function exteriorModel(exterior: Exterior): ExteriorModelResult {
  const footprint: Footprint = exteriorFootprint(exterior);
  if (!footprint.closes) return { ok: false, reason: footprint.reason ?? "The sides don't close into a footprint." };
  const notes: string[] = [];
  const reading = exteriorPitch(exterior);
  const pitch = reading.value;
  const input = pitch !== null ? roofInput(exterior, footprint, pitch) : null;
  const plan = input ? buildRoof(input) : null;
  // A measured gable gives a pitch, so with none there is no gable either.
  if (!input) notes.push("No pitch yet, so no roof: the walls stand to their eaves.");
  else if (plan?.shape === "other") notes.push("The roof isn't worked out for this outline, so only the walls are drawn.");
  else if (reading.source === "assumed") notes.push(`The roof is at an assumed ${formatPitch(input.pitch)} until its pitch is typed or a gable is measured.`);
  const built = plan && plan.shape !== "other" ? plan : null;
  const r = (input?.pitch ?? 0) / 12;
  const ov = input?.eaveOverhangFeet ?? 0;
  const n = footprint.corners.length;
  const byId = new Map(exterior.sides.map((s) => [s.id, s]));

  const sides = footprint.sideIds.map((id, i) => {
    const side = byId.get(id) as ExteriorSide;
    const a = footprint.corners[i] as Pt;
    const b = footprint.corners[(i + 1) % n] as Pt;
    return { side, a, b, stretches: stretchesOf(input, built, a, b) };
  });
  const eaves = eaveLevels(sides, built, ov, r);
  const eaveOf = (layer: number) => eaves[layer] ?? (eaves[0] as number);
  if (built?.sections.some((s) => s.role === "porch" && s.layer > 0)) notes.push("A lower porch roof's height isn't measured: it is drawn meeting the wall 1'6\" under the eave.");

  // ---- Each side: where its ground is, how high it stands, its cladding -------------------------
  const prepared = sides.map(({ side, a, b, stretches }) => {
    const frame = wallFrame(a, b);
    const L = frame.length;
    const first = stretches[0] as Stretch;
    const last = stretches[stretches.length - 1] as Stretch;
    const readings = eaveReadings(side, first.layer === last.layer);
    let frameV = 0;
    if (readings) {
      const left = eaveOf(first.layer) - readings[0];
      const right = eaveOf(last.layer) - readings[1];
      frameV = side.heightsFrom === "level" ? (left + right) / 2 : left;
    }
    // The roof's underside over it, stretch by stretch: each roof's eave and its rise along the wall.
    let top: Pt[];
    if (built) {
      top = [];
      for (const s of stretches) {
        const e = eaveOf(s.layer);
        top.push({ x: s.t0 * L, y: e + s.r0 }, { x: s.t1 * L, y: e + s.r1 });
      }
    } else {
      // No roof to meet: the side as measured, its gable included.
      const shape = elevationShape(side, null);
      top = shape.top.length >= 2 ? shape.top.map((p) => ({ x: p.x, y: p.y + frameV })) : [{ x: 0, y: frameV + DEFAULT_EAVE_FEET }, { x: L, y: frameV + DEFAULT_EAVE_FEET }];
    }
    const rise: RoofRise | null = built ? stretchesToRise(stretches) : null;
    const faces = elevationFaces(side, rise);
    const lift = (poly: Pt[]) => poly.map((p) => ({ x: p.x, y: p.y + frameV }));
    const wallFaces: Wall3D["faces"] = [];
    if (!faces.fromShapes) {
      const shape = faces.shape;
      if (side.base !== "grade" && shape.eaveZ !== null) wallFaces.push({ kind: "parging", poly: lift([shape.grade[0], shape.grade[1], shape.bottom[1], shape.bottom[0]]) });
    }
    for (const f of faces.faces) if (f.poly.length >= 3) wallFaces.push({ kind: f.kind, poly: lift(f.poly) });
    const bands = side.bands.length > 0 ? side.bands : null;
    return {
      side,
      frame,
      L,
      frameV,
      top: dedupe(top),
      grade: lift(groundUnder(side, faces.grade)),
      faces: wallFaces,
      background: faces.fromShapes ? ("unclad" as const) : ((bands?.[bands.length - 1]?.kind ?? "stucco") as CladdingKind),
      openings: faces.openings.map(({ opening, rect }) => ({ id: opening.id, kind: opening.kind, x0: rect.x0, x1: rect.x1, y0: rect.y0 + frameV, y1: rect.y1 + frameV })),
    };
  });
  const lowest = Math.min(...prepared.flatMap((p) => p.grade.map((g) => g.y)));
  const bottom = lowest - BELOW_GROUND_FEET;

  const walls: Wall3D[] = prepared.map((p) => ({
    id: p.side.id,
    sideId: p.side.id,
    name: p.side.name.trim() || "Side",
    origin: p.frame.origin,
    along: p.frame.along,
    out: p.frame.out,
    length: p.L,
    outline: [{ x: 0, y: bottom }, { x: p.L, y: bottom }, ...[...p.top].reverse()],
    grade: p.grade,
    faces: p.faces,
    background: p.background,
    openings: p.openings,
    frameV: p.frameV,
    photos: p.side.photos ?? [],
  }));

  // ---- The roof ----------------------------------------------------------------------------------
  let roof: Roof3D | null = null;
  const posts: ExteriorModel3D["posts"] = [];
  const ceilings: number[] = [];
  if (built && input) {
    const underAt = (layer: number, z: number) => eaveOf(layer) + (z - ov) * r;
    roof = roofModel(built, underAt, eaveOf, ov, r, input.rakeOverhangFeet);
    // The house's wall over each lower roof that stops at it (the garage's): from that roof up to the one above.
    const cladding = mainCladding(walls);
    for (const s of built.sections) {
      if (s.layer === 0 || !s.wall || s.role === "porch") continue;
      for (const we of s.wallEdges) {
        const lo = Math.max(we.from, we.vertical ? s.wall.y0 : s.wall.x0);
        const hi = Math.min(we.to, we.vertical ? s.wall.y1 : s.wall.x1);
        if (hi - lo < 0.1) continue;
        const centre = we.vertical ? (s.wall.x0 + s.wall.x1) / 2 : (s.wall.y0 + s.wall.y1) / 2;
        const sign = centre > we.at ? 1 : -1;
        // Out toward the lower roof's side; along so that out is to its right.
        const outP = we.vertical ? { x: sign, y: 0 } : { x: 0, y: sign };
        const d = { x: -outP.y, y: outP.x };
        const start = we.vertical ? { x: we.at, y: d.y > 0 ? lo : hi } : { x: d.x > 0 ? lo : hi, y: we.at };
        const end = we.vertical ? { x: we.at, y: d.y > 0 ? hi : lo } : { x: d.x > 0 ? hi : lo, y: we.at };
        const upper = layerAtWall(
          built.sections.filter((q) => q.layer < s.layer),
          { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        );
        const profile = profileAlong(built, upper, start, end).map((q) => ({ x: q.t, y: underAt(upper, q.z) }));
        if (profile.length < 2) continue;
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const frame = wallFrame(start, end);
        walls.push({
          id: `over-${walls.length}`,
          sideId: null,
          name: "Wall over the lower roof",
          origin: frame.origin,
          along: frame.along,
          out: frame.out,
          length,
          outline: [{ x: 0, y: eaveOf(s.layer) - ROOF_THICKNESS_FEET }, { x: length, y: eaveOf(s.layer) - ROOF_THICKNESS_FEET }, ...[...profile].reverse()],
          grade: null,
          faces: [],
          background: cladding,
          openings: [],
          frameV: 0,
          photos: [],
        });
      }
    }
    // A covered deck: a flat ceiling at the eave of the roof over it, and a post at each open corner.
    for (const k of built.notches) {
      if (!k.covered) continue;
      const layer = layerAtWall(built.sections, { x: (k.x0 + k.x1) / 2, y: (k.y0 + k.y1) / 2 });
      const h = eaveOf(layer);
      const c = [
        { x: k.x0, y: k.y0 },
        { x: k.x1, y: k.y0 },
        { x: k.x1, y: k.y1 },
        { x: k.x0, y: k.y1 },
      ];
      ceilings.push(...at3(c[0] as Pt, h), ...at3(c[2] as Pt, h), ...at3(c[1] as Pt, h), ...at3(c[0] as Pt, h), ...at3(c[3] as Pt, h), ...at3(c[2] as Pt, h));
      // Over each open side, the wall carried on from the ceiling up to the roof: the strip of siding
      // over a deck under a gable (the owner's, in the photos of 10-12).
      for (let i = 0; i < 4; i++) {
        const p = c[i] as Pt;
        const q = c[(i + 1) % 4] as Pt;
        if (onOutline(footprint.corners, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })) continue;
        // The rect goes counter-clockwise, so the notch is to the left of p -> q and out is to the right.
        const profile = profileAlong(built, layer, p, q).map((s) => ({ x: s.t, y: underAt(layer, s.z) }));
        if (profile.length < 2 || Math.max(...profile.map((s) => s.y)) - h < 0.05) continue;
        const frame = wallFrame(p, q);
        walls.push({
          id: `deck-${walls.length}`,
          sideId: null,
          name: "Wall over the deck",
          origin: frame.origin,
          along: frame.along,
          out: frame.out,
          length: frame.length,
          outline: [{ x: 0, y: h }, { x: frame.length, y: h }, ...[...profile].reverse()],
          grade: null,
          faces: [],
          background: cladding,
          openings: [],
          frameV: 0,
          photos: [],
        });
      }
      for (const p of c) {
        if (onOutline(footprint.corners, p)) continue;
        const inX = p.x === k.x0 ? 1 : -1;
        const inY = p.y === k.y0 ? 1 : -1;
        posts.push({ x: p.x + inX * POST_SIZE_FEET, z: -(p.y + inY * POST_SIZE_FEET), y0: NaN, y1: h });
      }
    }
    // Porch roofs: posts along the eave, a foot in.
    for (const s of built.sections) {
      if (s.role !== "porch") continue;
      const plane = s.planes?.[0];
      if (!plane) continue;
      // The eave is the edge the slope falls to: the plane rises along (a, b).
      const alongX = Math.abs(plane.a) < 0.5;
      const edge = alongX ? (plane.b > 0 ? s.y0 : s.y1) : plane.a > 0 ? s.x0 : s.x1;
      const inward = alongX ? Math.sign(plane.b) : Math.sign(plane.a);
      const line = edge + inward * POST_INSET_FEET;
      const from = (alongX ? s.x0 : s.y0) + POST_INSET_FEET;
      const to = (alongX ? s.x1 : s.y1) - POST_INSET_FEET;
      if (to - from < 0) continue;
      const count = Math.max(2, Math.ceil((to - from) / POST_SPACING_FEET) + 1);
      for (let k = 0; k < count; k++) {
        const t = from + ((to - from) * k) / (count - 1);
        const p = alongX ? { x: t, y: line } : { x: line, y: t };
        // Not where the porch stops at a wall: its beam is carried there.
        if (distanceToOutline(footprint.corners, p) < POST_INSET_FEET + 0.5) continue;
        const z = roofHeightAt(built, s.layer, p.x, p.y);
        if (z === null) continue;
        posts.push({ x: p.x, z: -p.y, y0: NaN, y1: underAt(s.layer, z) });
      }
    }
  }

  // ---- The ground: through every side's ground line --------------------------------------------
  const samples: { x: number; z: number; h: number }[] = [];
  for (const p of prepared) {
    const steps = Math.max(1, Math.ceil(p.L / 2));
    for (let k = 0; k <= steps; k++) {
      const u = (p.L * k) / steps;
      const v = interpolate(p.grade, u);
      samples.push({ x: p.frame.origin[0] + p.frame.along[0] * u, z: p.frame.origin[2] + p.frame.along[2] * u, h: v });
    }
  }
  for (const post of posts) post.y0 = groundAt(samples, post.x, post.z);

  // ---- How far it all reaches ----------------------------------------------------------------------
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const grow = (x: number, y: number, z: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (const w of walls) {
    for (const q of w.outline) grow(w.origin[0] + w.along[0] * q.x, Math.max(q.y, lowest), w.origin[2] + w.along[2] * q.x);
  }
  if (roof) for (let i = 0; i < roof.top.length; i += 3) grow(roof.top[i] as number, roof.top[i + 1] as number, roof.top[i + 2] as number);
  const span = Math.max(maxX - minX, maxZ - minZ, 10);
  const margin = Math.max(25, span * 0.75);
  const step = Math.max(1, (span + 2 * margin) / 60);
  const nx = Math.ceil((maxX - minX + 2 * margin) / step) + 1;
  const nz = Math.ceil((maxZ - minZ + 2 * margin) / step) + 1;
  const ground: Ground3D = { x0: minX - margin, z0: minZ - margin, step, nx, nz, heights: [] };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) ground.heights.push(groundAt(samples, ground.x0 + i * step, ground.z0 + j * step));

  return { ok: true, model: { walls, roof, posts, ceilings, ground, eaves, bounds: { minX, maxX, minY, maxY, minZ, maxZ }, notes } };
}

/**
 * The ground along a side, in its own frame. Typed by hand, it is the grade the heights were taped
 * from; tapped on the phone, the bottom of the parging where the parging was tapped down to it. A side
 * tapped with no parging stands its cladding on the ground: the phone's one level for it is a bottom
 * corner of the cladding ("corners") or its ground estimate, so where the cladding's bottom climbs
 * along the wall - 0.8 m over the 21 m of the owner's right side - it is the ground climbing, and
 * drawn flat at the level the side would show a wedge of bare wall the house doesn't have.
 */
function groundUnder(side: ExteriorSide, grade: Pt[]): Pt[] {
  const shapes = (side.shapes ?? []).filter((s) => s.closed && s.polygon.length >= 3);
  if (shapes.length === 0 || shapes.some((s) => s.kind === "parging")) return grade;
  const xs = [...new Set(shapes.flatMap((s) => s.polygon.map((p) => Math.round(p.x * 1e6) / 1e6)))].sort((a, b) => a - b);
  const bottom = xs.map((x) => ({ x, y: Math.min(...shapes.map((s) => lowestOver(s.polygon, x))) })).filter((p) => Number.isFinite(p.y));
  return bottom.length >= 2 ? bottom : grade;
}

/** The lowest point of a polygon's edges over x, or Infinity where it has none. */
function lowestOver(poly: Pt[], x: number): number {
  let low = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    if (x < Math.min(p.x, q.x) - 1e-9 || x > Math.max(p.x, q.x) + 1e-9) continue;
    if (Math.abs(q.x - p.x) < 1e-9) low = Math.min(low, p.y, q.y);
    else low = Math.min(low, p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x));
  }
  return low;
}

/** The rise along a side as the elevation draws it: each stretch's above its own roof's eave. */
function stretchesToRise(stretches: Stretch[]): RoofRise | null {
  const out: RoofRise = [];
  for (const s of stretches) out.push({ t: s.t0, rise: s.r0 }, { t: s.t1, rise: s.r1 });
  return out.some((p) => p.rise > 1e-6) ? out : null;
}

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push(p);
  }
  return out;
}

/** A polyline's v at u, by its x; flat past its ends. */
function interpolate(line: Pt[], u: number): number {
  if (line.length === 0) return 0;
  if (u <= (line[0] as Pt).x) return (line[0] as Pt).y;
  for (let k = 0; k + 1 < line.length; k++) {
    const p = line[k] as Pt;
    const q = line[k + 1] as Pt;
    if (u <= q.x) return q.x - p.x < 1e-9 ? q.y : p.y + ((q.y - p.y) * (u - p.x)) / (q.x - p.x);
  }
  return (line[line.length - 1] as Pt).y;
}

function onOutline(corners: Pt[], p: Pt): boolean {
  return distanceToOutline(corners, p) < 1e-4;
}

function distanceToOutline(corners: Pt[], p: Pt): number {
  let best = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i] as Pt;
    const b = corners[(i + 1) % corners.length] as Pt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

/** The roof's slopes as convex cells, each with its plane, by layer. */
function cellsOf(plan: RoofPlan): { layer: number; facet: string; label: string; poly: Pt[]; plane: PlanePt }[] {
  const out: { layer: number; facet: string; label: string; poly: Pt[]; plane: PlanePt }[] = [];
  for (const f of plan.facets) {
    // Water runs off along `facing`, so the plane rises against it.
    const a = -f.facing.x;
    const b = -f.facing.y;
    for (const cell of f.cells) {
      if (cell.length < 3) continue;
      const m = cell.reduce((s, p) => ({ x: s.x + p.x / cell.length, y: s.y + p.y / cell.length }), { x: 0, y: 0 });
      const z = roofHeightAt(plan, f.layer, m.x, m.y);
      if (z === null) continue;
      out.push({ layer: f.layer, facet: f.key, label: f.label, poly: ccw(cell), plane: { a, b, c: z - a * m.x - b * m.y } });
    }
  }
  return out;
}

/**
 * Where the roof of [layer] stands along a line, as (feet along, feet of run) at every bend - two at a
 * point where it steps - read off its slopes.
 */
export function profileAlong(plan: RoofPlan, layer: number, a: Pt, b: Pt): { t: number; z: number }[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return [];
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const cells = cellsOf(plan).filter((c) => c.layer === layer);
  const ts = new Set<number>([0, len]);
  for (const c of cells) {
    for (let i = 0; i < c.poly.length; i++) {
      const p = c.poly[i] as Pt;
      const q = c.poly[(i + 1) % c.poly.length] as Pt;
      // Where the line crosses this edge.
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
      const s = ((p.x - a.x) * d.y - (p.y - a.y) * d.x) / den;
      if (t > 1e-9 && t < len - 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) ts.add(Math.round(t * 1e7) / 1e7);
    }
  }
  const sorted = [...ts].sort((x, y) => x - y);
  const zIn = (t0: number, t1: number, at: number): number | null => {
    const m = { x: a.x + d.x * ((t0 + t1) / 2), y: a.y + d.y * ((t0 + t1) / 2) };
    const cell = cells.find((c) => insideConvex(c.poly, m));
    return cell ? planeZ(cell.plane, { x: a.x + d.x * at, y: a.y + d.y * at }) : null;
  };
  const out: { t: number; z: number }[] = [];
  for (let k = 0; k + 1 < sorted.length; k++) {
    const t0 = sorted[k] as number;
    const t1 = sorted[k + 1] as number;
    if (t1 - t0 < 1e-7) continue;
    const z0 = zIn(t0, t1, t0);
    const z1 = zIn(t0, t1, t1);
    if (z0 === null || z1 === null) continue;
    const last = out[out.length - 1];
    if (!last || Math.abs(last.t - t0) > 1e-7 || Math.abs(last.z - z0) > 1e-7) out.push({ t: t0, z: z0 });
    out.push({ t: t1, z: z1 });
  }
  return out;
}

function insideConvex(poly: Pt[], p: Pt): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < -1e-9) return false;
  }
  return true;
}

/**
 * The roof's own pieces: every slope lifted onto its plane, its underside, the fascia round its drip
 * line, the faces of siding a roof brings (a cross gable's front; a step where one part of a roof
 * stands over another), and its lines and letters.
 */
function roofModel(plan: RoofPlan, underAt: (layer: number, z: number) => number, eaveOf: (layer: number) => number, ov: number, r: number, rake: number): Roof3D {
  const T = ROOF_THICKNESS_FEET;
  const cells = cellsOf(plan);
  const top: number[] = [];
  const under: number[] = [];
  const fascia: number[] = [];
  const gables: number[] = [];
  const steps: number[] = [];
  const tri = (out: number[], p: V3, q: V3, s: V3) => out.push(...p, ...q, ...s);

  // Every corner of a layer's cells that lies along another cell's edge is put into that edge, so
  // neighbouring cells share their corners and no hairline opens between them.
  for (const c of cells) {
    const others = cells.filter((o) => o.layer === c.layer && o !== c).flatMap((o) => o.poly);
    const ring: Pt[] = [];
    for (let i = 0; i < c.poly.length; i++) {
      const p = c.poly[i] as Pt;
      const q = c.poly[(i + 1) % c.poly.length] as Pt;
      ring.push(p);
      const on = others
        .map((o) => ({ o, t: onSegment(o, p, q) }))
        .filter((x): x is { o: Pt; t: number } => x.t !== null)
        .sort((x, y) => x.t - y.t);
      for (const { o } of on) if (!ring.some((v) => Math.abs(v.x - o.x) < 1e-7 && Math.abs(v.y - o.y) < 1e-7)) ring.push(o);
    }
    const m = c.poly.reduce((s, p) => ({ x: s.x + p.x / c.poly.length, y: s.y + p.y / c.poly.length }), { x: 0, y: 0 });
    const h = (p: Pt) => underAt(c.layer, planeZ(c.plane, p));
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i] as Pt;
      const q = ring[(i + 1) % ring.length] as Pt;
      // Counter-clockwise in plan faces up; the underside the other way, to face down.
      tri(top, at3(m, h(m) + T), at3(p, h(p) + T), at3(q, h(q) + T));
      tri(under, at3(m, h(m)), at3(q, h(q)), at3(p, h(p)));
    }
  }

  // The fascia: the slab's edge round each eave and rake (flashing stands against a wall, and has none).
  for (const e of plan.edges) {
    if (e.kind !== "eave" && e.kind !== "rake") continue;
    const base = eaveOf(e.layer) - ov * r;
    const a0 = at3(e.a, base + e.za);
    const b0 = at3(e.b, base + e.zb);
    const a1 = at3(e.a, base + e.za + T);
    const b1 = at3(e.b, base + e.zb + T);
    tri(fascia, a0, b0, b1);
    tri(fascia, a0, b1, a1);
  }

  // Steps: where two cells of one roof meet along an edge at different heights, the face between them.
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as (typeof cells)[number];
    for (let j = i + 1; j < cells.length; j++) {
      const o = cells[j] as (typeof cells)[number];
      if (o.layer !== c.layer) continue;
      for (let k = 0; k < c.poly.length; k++) {
        const p = c.poly[k] as Pt;
        const q = c.poly[(k + 1) % c.poly.length] as Pt;
        for (let m = 0; m < o.poly.length; m++) {
          const s = o.poly[m] as Pt;
          const u = o.poly[(m + 1) % o.poly.length] as Pt;
          const shared = overlap(p, q, s, u);
          if (!shared) continue;
          const [x0, x1] = shared;
          const h0c = planeZ(c.plane, x0);
          const h1c = planeZ(c.plane, x1);
          const h0o = planeZ(o.plane, x0);
          const h1o = planeZ(o.plane, x1);
          if (Math.abs(h0c - h0o) < 1e-4 && Math.abs(h1c - h1o) < 1e-4) continue;
          // From the lower one's underside to the higher one's top, at each end.
          const lo0 = underAt(c.layer, Math.min(h0c, h0o));
          const lo1 = underAt(c.layer, Math.min(h1c, h1o));
          const hi0 = underAt(c.layer, Math.max(h0c, h0o)) + T;
          const hi1 = underAt(c.layer, Math.max(h1c, h1o)) + T;
          tri(steps, at3(x0, lo0), at3(x1, lo1), at3(x1, hi1));
          tri(steps, at3(x0, lo0), at3(x1, hi1), at3(x0, hi0));
        }
      }
    }
  }

  // A cross gable's face (an estimator's addition, over a front door): its triangle, set back from its
  // rakes as a gable end is. The gable over a lower wing needs none: its face is the house's wall.
  for (const s of plan.sections) {
    if (s.role !== "gable" || !s.planes || s.planes.length !== 2) continue;
    if (s.planes.some((p) => p.tag?.startsWith("over-"))) continue;
    const pl = s.planes[0] as PlanePt;
    const pr = s.planes[1] as PlanePt;
    // The two planes rise along (a, b) and back: the front is the rect's edge the roof does not run on past.
    const alongX = Math.abs(pl.a) > 0.5;
    const outEdges = alongX ? [s.y0, s.y1] : [s.x0, s.x1];
    const mid = alongX ? (s.x0 + s.x1) / 2 : (s.y0 + s.y1) / 2;
    const beyond = (v: number, dir: number) => (alongX ? { x: mid, y: v + dir * 0.05 } : { x: v + dir * 0.05, y: mid });
    const zLo = roofHeightAt(plan, s.layer, beyond(outEdges[0] as number, -1).x, beyond(outEdges[0] as number, -1).y);
    const zHi = roofHeightAt(plan, s.layer, beyond(outEdges[1] as number, 1).x, beyond(outEdges[1] as number, 1).y);
    const frontIsLow = zLo === null || (zHi !== null && zLo < zHi);
    const front = frontIsLow ? (outEdges[0] as number) : (outEdges[1] as number);
    const depth = Math.abs((outEdges[1] as number) - (outEdges[0] as number));
    const setBack = Math.min(rake, depth / 2) * (frontIsLow ? 1 : -1);
    const line = front + setBack;
    const span0 = alongX ? s.x0 : s.y0;
    const span1 = alongX ? s.x1 : s.y1;
    const pt = (v: number): Pt => (alongX ? { x: v, y: line } : { x: line, y: v });
    const zOf = (p: Pt) => Math.min(planeZ(pl, p), planeZ(pr, p));
    const p0 = pt(span0);
    const p1 = pt(span1);
    const pm = pt((span0 + span1) / 2);
    tri(gables, at3(p0, underAt(s.layer, zOf(p0))), at3(p1, underAt(s.layer, zOf(p1))), at3(pm, underAt(s.layer, zOf(pm))));
  }

  const lines: Roof3D["lines"] = [];
  for (const l of plan.lines) {
    if (l.kind !== "ridge" && l.kind !== "hip" && l.kind !== "valley") continue;
    const base = eaveOf(l.layer) - ov * r + T + 0.04;
    lines.push({ kind: l.kind, a: at3(l.a, base + l.za), b: at3(l.b, base + l.zb) });
  }
  const labels: Roof3D["labels"] = [];
  for (const f of plan.facets) {
    // Over its largest piece, so a slope that wraps a corner is lettered on itself.
    const piece = [...f.cells].sort((p, q) => polygonArea(q) - polygonArea(p))[0];
    if (!piece) continue;
    const m = piece.reduce((s, p) => ({ x: s.x + p.x / piece.length, y: s.y + p.y / piece.length }), { x: 0, y: 0 });
    const z = roofHeightAt(plan, f.layer, m.x, m.y);
    if (z === null) continue;
    // The plane rises against `facing`: up, and tipped toward the way water runs off.
    const len = Math.hypot(f.facing.x * r, 1, f.facing.y * r);
    labels.push({ text: f.label, at: at3(m, underAt(f.layer, z) + T + 0.3), normal: [(f.facing.x * r) / len, 1 / len, (-f.facing.y * r) / len] });
  }
  return { top, under, fascia, gables, steps, lines, labels };
}

/** The stretch two segments share, when they lie on one line: its two ends. */
function overlap(p: Pt, q: Pt, s: Pt, u: Pt): [Pt, Pt] | null {
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (len < 1e-9) return null;
  const d = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  const off = (v: Pt) => (v.x - p.x) * d.y - (v.y - p.y) * d.x;
  if (Math.abs(off(s)) > 1e-6 || Math.abs(off(u)) > 1e-6) return null;
  const ts = (v: Pt) => (v.x - p.x) * d.x + (v.y - p.y) * d.y;
  const a = Math.max(0, Math.min(ts(s), ts(u)));
  const b = Math.min(len, Math.max(ts(s), ts(u)));
  if (b - a < 1e-6) return null;
  return [
    { x: p.x + d.x * a, y: p.y + d.y * a },
    { x: p.x + d.x * b, y: p.y + d.y * b },
  ];
}
