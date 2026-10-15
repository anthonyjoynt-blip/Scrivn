/**
 * The outside of the house (2026-10-12): one ELEVATION per side, and the footprint and roof the
 * sides make when they are joined round the house.
 *
 * Built to work BY HAND first - a tape, a laser, a pitch gauge - and to be where Scrivn Scan's
 * exterior mode lands. The owner's own workflow decides the shape of it: each side of the house
 * is an elevation; tap (or tape) the cladding corners above the parging, the eave, the gable peak
 * and the openings; go on to the next side, round the house. The footprint builds from the joined
 * sides, and the roof fills in from the footprint, the overhangs and the pitch.
 *
 * ── Where it lives ─────────────────────────────────────────────────────────────────────────────
 * On the sketch (`Sketch.exterior`), shown as its own view beside Sketch and Moisture, and NOT as
 * a level of rooms. Everything that walks `sketch.rooms` - floor and wall areas, the disposal
 * weights, the moisture map, the 3D view - would otherwise have to learn that one "room" is the
 * outside of the house and skip it, and the first one to forget would price a footprint as a
 * floor. An elevation is a wall's face, not a plan; it has no business among the rooms.
 *
 * ── Heights ────────────────────────────────────────────────────────────────────────────────────
 * Every height is measured from the grade UNDER THE POINT, because that is where a tape or a
 * laser stands, and the grade may slope from one end of a side to the other. Each side is worked
 * in its own frame: x along the wall from its LEFT corner (as you face it from outside), z up from
 * the grade at that left corner. The eave is level, so the eave heights at the two ends say how far
 * the grade falls between them; everything else measured from grade is put on that line.
 *
 * All lengths are decimal FEET, as the rest of the sketch keeps them; feet-and-inches is display.
 */

import { formatFeetInches, newSketchId } from "./sketch";
import { buildRoof, type GutterRun, gutterRuns, polygonArea, type Pt, type RoofAddition, type RoofEndKind, type RoofInput, type RoofLineKind, type RoofPlan, roofRiseAlongWall } from "./roof";

export type CladdingKind = "stucco" | "vinyl" | "wood_shake" | "eifs" | "wood" | "fibre_cement" | "brick" | "stone" | "metal" | "other";

/**
 * The owner's four sidings first (10-12: stucco, vinyl, wood shake, EIFS), then the rest of Scan's
 * list (arcapture-exterior/1) so a capture's cladding reads straight across, then "other".
 */
export const CLADDING_KINDS: CladdingKind[] = ["stucco", "vinyl", "wood_shake", "eifs", "wood", "fibre_cement", "brick", "stone", "metal", "other"];

export const CLADDING_LABEL: Record<CladdingKind, string> = {
  stucco: "Stucco",
  vinyl: "Vinyl siding",
  wood_shake: "Wood shake",
  eifs: "EIFS",
  wood: "Wood siding",
  fibre_cement: "Fibre cement",
  brick: "Brick",
  stone: "Stone",
  metal: "Metal siding",
  other: "Other",
};

/**
 * A band of one cladding, bottom up. Each runs from the top of the one below it (the bottom of the
 * cladding, for the first) to its own `top`.
 */
export interface CladdingBand {
  id: string;
  kind: CladdingKind;
  /** What "other" is, in the estimator's words. */
  label?: string;
  /**
   * Where it stops: feet above the grade at the side's LEFT corner (a band line is level, so one
   * height places it); "eave" for the eave line, so a gable can be clad differently from the walls;
   * null for all the way up, gable included. The last band's is always read as null.
   */
  top: number | "eave" | null;
}

export type ExteriorOpeningKind = "window" | "door" | "garage";

export const OPENING_LABEL: Record<ExteriorOpeningKind, string> = { window: "Window", door: "Door", garage: "Garage door" };

export interface ExteriorOpening {
  id: string;
  kind: ExteriorOpeningKind;
  widthFeet: number;
  heightFeet: number;
  /** The bottom of the opening, above the grade under it. */
  sillFeet: number;
  /** From the side's left corner to the opening's left edge. */
  fromLeftFeet: number;
}

/** A gable as measured: the peak, and where along the wall it is. */
export interface ExteriorGable {
  /** The peak of the cladding, above the grade under it. */
  peakFeet: number;
  /** From the left corner to the peak. */
  atFeet: number;
  /** Where the gable starts and ends along the wall, when it covers only part of it (an L). Default the whole wall. */
  fromFeet?: number;
  toFeet?: number;
}

export type SideTurn = "outside" | "inside";
export type BaseLine = "parging" | "grade";

export interface ExteriorSide {
  id: string;
  /** Front, Right, Rear, Left - or whatever the estimator calls it. */
  name: string;
  /** Cladding corner to cladding corner. */
  lengthFeet: number;
  /**
   * "drawn": read off the outline tapped on the plan, not taped (2026-10-13, lib/exteriorPlan.ts).
   * A drawn side gives way when a length is typed - the outline stays closed round it - and is
   * shown as about that long until its own length is typed. Absent: typed, or measured by the phone.
   */
  lengthFrom?: "drawn";
  /** The corner at this side's RIGHT end, facing it from outside: an outside corner, or an inside one (the inside of an L). */
  turn: SideTurn;
  /** Where the cladding starts: the top of the parging (the usual), or the grade itself. */
  base: BaseLine;
  /** The top of the parging above grade, at each corner. Ignored when the base is the grade. */
  baseLeftFeet: number;
  baseRightFeet: number;
  /** The eave - the soffit line, the top of the wall's cladding - above grade at each corner. Null until measured. */
  eaveLeftFeet: number | null;
  eaveRightFeet: number | null;
  /** The gable as measured. Null when there is none, or none was measured - the roof supplies one then. */
  gable: ExteriorGable | null;
  bands: CladdingBand[];
  openings: ExteriorOpening[];
  /** What is on the wall and has to come off for the cladding, or be replaced: dryer vents, hose bibs... Optional for exteriors saved before it. */
  fixtures?: SideFixture[];
  /**
   * "level": every height on the side is from ONE level - Scan's ground estimate for the side - so
   * no slope of the ground is read from the two eaves, and they may differ (a gable whose eave
   * steps). Absent: each height is from the grade under it, as a tape reads it.
   */
  heightsFrom?: "level";
  /**
   * The faces as tapped on the phone (arcapture-exterior/2): a polygon per material, round like a
   * room. When there are any they ARE the side's cladding, in place of the bands; parging is drawn
   * and not counted, and so is a shape left open.
   */
  shapes?: ExteriorShape[];
  /** The roof's edge as the phone read it along the side: its ends, and its peak on a gable. */
  roofline?: RooflinePoint[];
  /** The pitch the phone worked out from this side, rise in 12. Believed over the gable's own when both are there. */
  pitchMeasured?: number | null;
  /**
   * The roof as the AI trace read it off this side's photo, as the estimator ticked it (2026-10-15,
   * lib/roofPhotoRead.ts): it fills the roof "from photos", under anything typed and over anything assumed.
   */
  roofRead?: SideRoofRead;
  /** The phone's photos of this side (Scan 0.1.151), each with what lays it on the elevation - see lib/exteriorPhoto.ts. */
  photos?: SidePhoto[];
}

/**
 * The roof read off a side's photo, as ticked: a number is a read the estimator ticked, null one they
 * set aside (kept, so a gable set aside gives no pitch off its peak either), absent one not read.
 */
export interface SideRoofRead {
  /** When it was put on the side. */
  at: string;
  /** Rise in 12, as a roof is framed: the whole pitch within 1/4 (lib/roofPhotoRead.ts, `framedPitch`). */
  pitch?: number | null;
  /** The gable's two slopes as read, for the record. */
  slopes?: [number, number];
  rakeOverhangFeet?: number | null;
  eaveOverhangFeet?: number | null;
  /** What the roof does over this side: a gable end, a hip end, an eave along it. */
  over?: "gable" | "hip" | "eave" | null;
}

/**
 * A photo of a side, as Scan sends it: the picture itself is stored with the scan
 * (`scan-photos/<org>/<scanId>/<n>.jpg`), and `toPhoto` lays it on the side's elevation. Kept in
 * Scan's metres, untouched, because the matrix is in metres: lib/exteriorPhoto.ts converts.
 */
export interface SidePhoto {
  /** Its number among the scan's photos: 900 and up. */
  n: number;
  /** The scan it was sent with; null when the exterior came in as a file, whose photos stay on the phone. */
  scanId: string | null;
  /** The JPEG upright, as saved: pixels, x right, y down. */
  camera: { width: number; height: number; fx: number; fy: number; cx: number; cy: number };
  /** Row by row: (along_m, up_m, 1) of this side's elevation to the photo's pixel (x, y, w), x/w across and y/w down. */
  toPhoto: number[];
  /** How much of the side's bottom is in the picture, and whether its ends and top are; null when Scan could not say. */
  inView: { fromM: number; toM: number; leftEnd: boolean; rightEnd: boolean; top: boolean } | null;
}

export interface ExteriorShape {
  id: string;
  kind: CladdingKind | "parging";
  /** What "other" is. */
  label?: string;
  /** Tapped back round to its first corner. An open shape is drawn, never counted. */
  closed: boolean;
  /** Its corners in tap order, in the side's frame: feet along from the left end, feet up. */
  polygon: Pt[];
}

export interface RooflinePoint {
  alongFeet: number;
  upFeet: number;
  /** How far in front of the wall face, read by depth; null where it was aimed onto the face. */
  outFeet: number | null;
}

export type SideFixtureKind = "dryer_vent" | "furnace_vent" | "hose_bib" | "light" | "outlet" | "other";

export const SIDE_FIXTURE_LABEL: Record<SideFixtureKind, string> = {
  dryer_vent: "Dryer vent",
  furnace_vent: "Furnace vent",
  hose_bib: "Hose bib",
  light: "Light fixture",
  outlet: "Exterior outlet",
  other: "Other",
};

export interface SideFixture {
  id: string;
  kind: SideFixtureKind;
  /** What "other" is. */
  label?: string;
  action: "replace" | "detach_reset";
  count: number;
}

export type RoofMaterial = "three_tab" | "composite" | "metal" | "tile" | "cedar_shake";

export const ROOF_MATERIAL_LABEL: Record<RoofMaterial, string> = {
  three_tab: "3-tab shingles",
  composite: "Composite (laminated) shingles",
  metal: "Metal roofing",
  tile: "Cement tile",
  cedar_shake: "Cedar shakes",
};

export type RoofVentKind = "turtle" | "turbine" | "static" | "exhaust";

export const ROOF_VENT_LABEL: Record<RoofVentKind, string> = {
  turtle: "Turtle vent",
  turbine: "Turbine vent",
  static: "High-profile static vent",
  exhaust: "Exhaust vent",
};

export type ChimneySize = "none" | "small" | "medium" | "large";
export type Underlayment = "synthetic" | "felt" | "none";

export interface ExteriorRoof {
  /** Rise in 12 as typed; null takes it from the sides' measured gables. */
  pitch: number | null;
  eaveOverhangFeet: number;
  rakeOverhangFeet: number;
  /** A rectangle's ridge runs parallel to this side; null = along the longer walls. */
  ridgeAlong: string | null;
  /** Each end of the roof by the side it stands over. Absent = gable. */
  ends: Record<string, RoofEndKind>;
  /** Porches carried on from a slope (or lower, against the wall) and cross gables, each on a side. */
  additions?: RoofAddition[];
  /** Wings whose roof sits below the eave and stops at the wall, each by the side its free end stands over. */
  lowerWings?: string[];
  /** Of those, the ones under a gable of the roof they meet (the owner's garage), by the same side. */
  wingGables?: string[];
  /** Notches the roof carries over (a covered deck), each by one of its inner walls' sides. */
  coveredNotches?: string[];
  /**
   * No longer used: waste is the estimator's to add (owner, 10-12: "just want real values"). Kept
   * optional so an exterior saved with it still loads.
   */
  wastePercent?: number;
  /** How many downspouts; null = one per 35 ft of eavestrough, at least one per run. */
  downspouts: number | null;

  /*
    The owner's list of 10-12, everything a roof and its eavestrough are priced from. All optional so an
    exterior saved before it loads. A yes/no or a choice left null is NOT a no: it is a question still
    to answer, listed as one (`RoofingQuantities.toAnswer`), never quietly left off the scope.
  */
  material?: RoofMaterial | null;
  /** The slopes being roofed (`RoofFacet.key`), picked on the plan; null or absent = every slope. */
  slopes?: string[] | null;
  /** The eaves and rakes the eavestrough, soffit and fascia run along (`RoofEdge.key`); null or absent = all. */
  edges?: string[] | null;
  /** The ridges with ridge vent (`RoofLine.key`). */
  ridgeVents?: string[];
  vents?: Partial<Record<RoofVentKind, number>>;
  pipeJacks?: { four: number; six: number };
  chimney?: ChimneySize | null;
  dripEdge?: boolean | null;
  underlayment?: Underlayment | null;
  /** Two storeys or higher: the high-roof charge. */
  high?: boolean | null;
  /** Materials carried by hand: more than 30 ft from the front of the driveway, or the truck cannot reach. */
  handload?: boolean | null;
  /** Debris carried by hand to disposal: nowhere for a bin on the driveway (an alley, or otherwise). */
  disposalHandload?: boolean | null;
  leafGuard?: boolean | null;
  /** Elbows per downspout: two at the eave and one at the foot, unless said otherwise. */
  elbowsPerDownspout?: number;
  /** The downspouts' total length, typed; null or absent = each side's eave height + 15%. */
  downspoutFeet?: number | null;
  soffitMaterial?: "metal" | "wood" | null;
}

/** Which of the measured parts the scope prices - see `exteriorScopeLines`. */
export interface ExteriorScope {
  roofing: boolean;
  /** Side ids whose cladding is in scope. */
  sides: string[];
  soffitFascia: boolean;
  eavestrough: boolean;
}

export interface Exterior {
  /** In order round the house: each next side is to the RIGHT of the one before, as you face them from outside. */
  sides: ExteriorSide[];
  /**
   * Being typed in side by side round the house and not yet back at the start (2026-10-13): the last
   * side's corner is not known until the next is added, so there is no footprint until it is closed.
   */
  open?: boolean;
  roof: ExteriorRoof;
  /** Optional so an exterior drawn before the scope existed loads; absent reads as nothing in scope. */
  scope?: ExteriorScope;
  /**
   * Where it came from when the phone measured it - see `lib/exteriorImport.ts`. `edited` is set by the
   * first change to a measurement in Scrivn; from then on it is the estimator's, and a later scan asks
   * before replacing it. Ticking what is in scope is not a change to what was measured.
   */
  source?: {
    kind: "scan";
    captureId: string | null;
    scanId: string | null;
    receivedAt: string | null;
    notes: string[];
    edited?: boolean;
    /** False when the phone's walk did not go all the way round: its sides are not yet a footprint. */
    walkClosed?: boolean;
  };
}

export const DEFAULT_EAVE_FEET = 10;
/**
 * The pitch a roof is drawn at before one is typed or a gable is measured (2026-10-13): the owner
 * could not find the roof while it waited for a pitch. Always said to be assumed, on the plan, the
 * scope and the documents, and asked for until it is answered. 4/12 since 2026-10-14, the owner's
 * call: closer to the houses he works on (his own reads 4-5/12) than the 6/12 it started at.
 */
export const ASSUMED_PITCH = 4;
export const DEFAULT_PARGING_FEET = 8 / 12;
export const DEFAULT_EAVE_OVERHANG_FEET = 16 / 12;
export const DEFAULT_RAKE_OVERHANG_FEET = 12 / 12;
/** Downspout length over the eave height: the run down the wall, the offsets and the kick-out. */
export const DOWNSPOUT_ALLOWANCE = 1.15;
export const DEFAULT_ELBOWS_PER_DOWNSPOUT = 3;
/** One downspout per this many feet of eavestrough, and at least one per run. */
export const FEET_PER_DOWNSPOUT = 35;

export function defaultRoof(): ExteriorRoof {
  return {
    pitch: null,
    eaveOverhangFeet: DEFAULT_EAVE_OVERHANG_FEET,
    rakeOverhangFeet: DEFAULT_RAKE_OVERHANG_FEET,
    ridgeAlong: null,
    ends: {},
    downspouts: null,
  };
}

export function emptyScope(): ExteriorScope {
  return { roofing: false, sides: [], soffitFascia: false, eavestrough: false };
}

export function newSide(name: string, lengthFeet: number, eaveFeet: number | null = DEFAULT_EAVE_FEET, turn: SideTurn = "outside"): ExteriorSide {
  return {
    id: newSketchId("side"),
    name,
    lengthFeet,
    turn,
    base: "parging",
    baseLeftFeet: DEFAULT_PARGING_FEET,
    baseRightFeet: DEFAULT_PARGING_FEET,
    eaveLeftFeet: eaveFeet,
    eaveRightFeet: eaveFeet,
    gable: null,
    bands: [{ id: newSketchId("band"), kind: "stucco", top: null }],
    openings: [],
  };
}

/** Four sides from a width (the front) and a depth (the sides), each with the same eave. */
export function rectangleExterior(widthFeet: number, depthFeet: number, eaveFeet: number = DEFAULT_EAVE_FEET): Exterior {
  return {
    sides: [newSide("Front", widthFeet, eaveFeet), newSide("Right", depthFeet, eaveFeet), newSide("Rear", widthFeet, eaveFeet), newSide("Left", depthFeet, eaveFeet)],
    roof: defaultRoof(),
  };
}

/**
 * Six sides of an L: the whole width and depth, with a notch out of the REAR RIGHT corner. Walking
 * round to the right from the front: the front, the right side up to the notch, the back of the
 * front part (the inside corner is at its far end), the notch's side, the rear, the left side.
 */
export function lShapeExterior(widthFeet: number, depthFeet: number, notchWidthFeet: number, notchDepthFeet: number, eaveFeet: number = DEFAULT_EAVE_FEET): Exterior {
  return {
    sides: [
      newSide("Front", widthFeet, eaveFeet),
      newSide("Right", depthFeet - notchDepthFeet, eaveFeet),
      newSide("Right rear", notchWidthFeet, eaveFeet, "inside"),
      newSide("Inside right", notchDepthFeet, eaveFeet),
      newSide("Rear", widthFeet - notchWidthFeet, eaveFeet),
      newSide("Left", depthFeet, eaveFeet),
    ],
    roof: defaultRoof(),
  };
}

// ---------------------------------------------------------------------------------------------
// One elevation
// ---------------------------------------------------------------------------------------------

/** Keeps the part of a polygon where a·x + b·y ≤ c (Sutherland–Hodgman; exact for any simple polygon against a half-plane). */
function clipHalf(poly: Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  const val = (p: Pt) => a * p.x + b * p.y - c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    const vp = val(p);
    const vq = val(q);
    if (vp <= 0) out.push(p);
    if ((vp < 0 && vq > 0) || (vp > 0 && vq < 0)) {
      const t = vp / (vp - vq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

/** The part of a polygon between two levels. */
function clipLevels(poly: Pt[], lo: number, hi: number): Pt[] {
  let out = poly;
  if (Number.isFinite(lo)) out = clipHalf(out, 0, -1, -lo);
  if (Number.isFinite(hi)) out = clipHalf(out, 0, 1, hi);
  return out;
}

function clipRect(poly: Pt[], x0: number, x1: number, y0: number, y1: number): Pt[] {
  return clipLevels(clipHalf(clipHalf(poly, -1, 0, -x0), 1, 0, x1), y0, y1);
}

function area(poly: Pt[]): number {
  return poly.length < 3 ? 0 : polygonArea(poly);
}

/** The roof's gable over a side: (fraction along, feet above the eave) at each bend. */
export type RoofRise = { t: number; rise: number }[];

export interface ElevationShape {
  lengthFeet: number;
  /** How far the grade falls from the left corner to the right; negative where it rises. */
  fallFeet: number;
  /** The eave line's level, in the side's frame (z = 0 at the grade under the left corner). Null with no eave. */
  eaveZ: number | null;
  grade: [Pt, Pt];
  /** The bottom of the cladding, left to right. */
  bottom: [Pt, Pt];
  /** The top of the cladding, left to right: the eave, and any gable. */
  top: Pt[];
  /** The cladding's face as a polygon (empty with no eave). */
  cladding: Pt[];
  gable: { source: "measured" | "roof"; peak: Pt; from: number; to: number } | null;
}

/** The grade's height in the side's frame at x along it. */
function gradeAt(side: ExteriorSide, x: number): number {
  if (side.heightsFrom === "level" || side.eaveLeftFeet == null || side.eaveRightFeet == null || side.lengthFeet <= 0) return 0;
  return -((side.eaveRightFeet - side.eaveLeftFeet) * x) / side.lengthFeet;
}

/** The z (side frame) of a point measured `above` feet from the grade at x. */
export function zFromGrade(side: ExteriorSide, x: number, above: number): number {
  return gradeAt(side, x) + above;
}

/**
 * The side drawn: its grade, the cladding's bottom and top, the gable, and the face as a polygon.
 *
 * The gable is the one MEASURED on the side when there is one, else the roof's (`roofRise`) - a
 * gable end whose peak nobody could reach is still clad, and the roof knows how high it climbs.
 */
export function elevationShape(side: ExteriorSide, roofRise: RoofRise | null = null): ElevationShape {
  const L = Math.max(0, side.lengthFeet);
  const fall = side.heightsFrom !== "level" && side.eaveLeftFeet != null && side.eaveRightFeet != null ? side.eaveRightFeet - side.eaveLeftFeet : 0;
  const grade: [Pt, Pt] = [{ x: 0, y: 0 }, { x: L, y: -fall }];
  const baseL = side.base === "grade" ? 0 : side.baseLeftFeet;
  const baseR = side.base === "grade" ? 0 : side.baseRightFeet;
  const bottom: [Pt, Pt] = [{ x: 0, y: baseL }, { x: L, y: -fall + baseR }];
  if (side.eaveLeftFeet == null || L <= 0) {
    return { lengthFeet: L, fallFeet: fall, eaveZ: null, grade, bottom, top: [], cladding: [], gable: null };
  }
  const eaveZ = side.eaveLeftFeet;
  let top: Pt[] = [{ x: 0, y: eaveZ }, { x: L, y: eaveZ }];
  let gable: ElevationShape["gable"] = null;

  if (side.gable) {
    const from = clamp(side.gable.fromFeet ?? 0, 0, L);
    const to = clamp(side.gable.toFeet ?? L, from, L);
    const at = clamp(side.gable.atFeet, from, to);
    const peakZ = zFromGrade(side, at, side.gable.peakFeet);
    if (peakZ > eaveZ + 1e-6 && to - from > 1e-6) {
      top = [{ x: 0, y: eaveZ }, { x: from, y: eaveZ }, { x: at, y: peakZ }, { x: to, y: eaveZ }, { x: L, y: eaveZ }];
      gable = { source: "measured", peak: { x: at, y: peakZ }, from, to };
    }
  } else if (roofRise && roofRise.some((r) => r.rise > 1e-6)) {
    const pts = roofRise.map((r) => ({ x: clamp(r.t, 0, 1) * L, y: eaveZ + r.rise }));
    top = simplify([{ x: 0, y: eaveZ }, ...pts, { x: L, y: eaveZ }]);
    const peak = top.reduce((best, p) => (p.y > best.y ? p : best), top[0] as Pt);
    const raised = top.filter((p) => p.y > eaveZ + 1e-6);
    const firstUp = top.findIndex((p) => p.y > eaveZ + 1e-6);
    const lastUp = top.length - 1 - [...top].reverse().findIndex((p) => p.y > eaveZ + 1e-6);
    const from = raised.length > 0 ? (top[Math.max(0, firstUp - 1)] as Pt).x : 0;
    const to = raised.length > 0 ? (top[Math.min(top.length - 1, lastUp + 1)] as Pt).x : L;
    gable = { source: "roof", peak, from, to };
  }

  const cladding = [bottom[0], bottom[1], ...[...top].reverse()];
  return { lengthFeet: L, fallFeet: fall, eaveZ, grade, bottom, top, cladding, gable };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Drops points that lie on the line through their neighbours. */
function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (out.length > 0) {
      const last = out[out.length - 1] as Pt;
      if (Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    }
    while (out.length >= 2) {
      const a = out[out.length - 2] as Pt;
      const b = out[out.length - 1] as Pt;
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) > 1e-9) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}

/** An opening's rectangle in the side's frame. */
export function openingRect(side: ExteriorSide, o: ExteriorOpening): { x0: number; x1: number; y0: number; y1: number } {
  const x0 = o.fromLeftFeet;
  const x1 = o.fromLeftFeet + o.widthFeet;
  const y0 = zFromGrade(side, (x0 + x1) / 2, o.sillFeet);
  return { x0, x1, y0, y1: y0 + o.heightFeet };
}

/** Each band's level range in the side's frame, bottom up. */
export function bandRanges(side: ExteriorSide, eaveZ: number | null): { band: CladdingBand; lo: number; hi: number }[] {
  const bands = side.bands.length > 0 ? side.bands : [{ id: "default", kind: "stucco" as CladdingKind, top: null }];
  let lo = -Infinity;
  return bands.map((band, i) => {
    const last = i === bands.length - 1;
    const raw = last || band.top === null ? Infinity : band.top === "eave" ? eaveZ ?? Infinity : band.top;
    const hi = Math.max(lo, raw);
    const range = { band, lo, hi };
    lo = hi;
    return range;
  });
}

/** One face of cladding on an elevation: a band of it, or a shape tapped on the phone. */
export interface ElevationFace {
  id: string;
  kind: CladdingKind | "parging";
  label: string;
  poly: Pt[];
  /** False for a shape left open: drawn, not counted. */
  closed: boolean;
}

function shapeLabel(shape: ExteriorShape): string {
  if (shape.kind === "parging") return "Parging";
  return shape.kind === "other" && shape.label?.trim() ? shape.label.trim() : CLADDING_LABEL[shape.kind];
}

/** The lowest y of a polygon's edges over x, or Infinity where it has none. */
function lowestAt(poly: Pt[], x: number): number {
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

/**
 * The ground under a side tapped as shapes: the bottom edge of its parging, where the parging was
 * tapped down to the ground - Scan's one level elsewhere. What the drawing stands the side on.
 */
function gradeFromParging(shapes: ExteriorShape[]): Pt[] | null {
  const polys = shapes.filter((s) => s.kind === "parging" && s.polygon.length >= 3).map((s) => s.polygon);
  if (polys.length === 0) return null;
  const xs = [...new Set(polys.flatMap((p) => p.map((v) => Math.round(v.x * 1e6) / 1e6)))].sort((a, b) => a - b);
  const pts = xs.map((x) => ({ x, y: Math.min(...polys.map((p) => lowestAt(p, x))) })).filter((p) => Number.isFinite(p.y));
  return pts.length >= 2 ? pts : null;
}

/** What an elevation drawing needs: the shape, each face of cladding, the ground, and each opening's rectangle. */
export function elevationFaces(side: ExteriorSide, roofRise: RoofRise | null = null) {
  const fromShapes = (side.shapes ?? []).some((s) => s.polygon.length >= 2);
  // Tapped shapes are the face: the roof draws no gable over them.
  const shape = elevationShape(side, fromShapes ? null : roofRise);
  const openings = side.openings.map((opening) => ({ opening, rect: openingRect(side, opening) }));
  if (fromShapes) {
    const faces: ElevationFace[] = (side.shapes ?? [])
      .filter((s) => s.polygon.length >= 2)
      .map((s) => ({ id: s.id, kind: s.kind, label: shapeLabel(s), poly: s.polygon, closed: s.closed && s.polygon.length >= 3 }));
    return { shape, faces, bandLines: [] as number[], grade: gradeFromParging(side.shapes ?? []) ?? [...shape.grade], openings, fromShapes };
  }
  const ranges = shape.eaveZ === null ? [] : bandRanges(side, shape.eaveZ);
  const faces: ElevationFace[] = ranges.map(({ band, lo, hi }) => ({ id: band.id, kind: band.kind, label: bandLabel(band), poly: clipLevels(shape.cladding, lo, hi), closed: true }));
  const bandLines = ranges.slice(0, -1).map((r) => r.hi).filter((v) => Number.isFinite(v));
  return { shape, faces, bandLines, grade: [...shape.grade], openings, fromShapes };
}

export interface BandQuantities {
  bandId: string;
  kind: CladdingKind;
  label: string;
  grossSquareFeet: number;
  openingSquareFeet: number;
  netSquareFeet: number;
  /** A shape's area that a shape tapped after it covers, taken out so nothing is counted twice. */
  overlapSquareFeet?: number;
}

/** A simple polygon in triangles (ear clipping), either way round. */
function triangulate(poly: Pt[]): Pt[][] {
  let pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length] as Pt;
    return Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.y - q.y) > 1e-9;
  });
  let signed = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    signed += p.x * q.y - q.x * p.y;
  }
  if (signed < 0) pts = [...pts].reverse();
  const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const inside = (p: Pt, a: Pt, b: Pt, c: Pt) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  const tris: Pt[][] = [];
  for (let guard = 0; pts.length > 3 && guard < 1000; guard++) {
    const n = pts.length;
    let cut = -1;
    for (let i = 0; i < n && cut < 0; i++) {
      const a = pts[(i - 1 + n) % n] as Pt;
      const b = pts[i] as Pt;
      const c = pts[(i + 1) % n] as Pt;
      if (cross(a, b, c) <= 1e-12) continue;
      if (pts.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      tris.push([a, b, c]);
      cut = i;
    }
    // No ear: a corner on a straight edge holds it up, and it adds no area.
    if (cut < 0) cut = pts.findIndex((b, i) => Math.abs(cross(pts[(i - 1 + n) % n] as Pt, b, pts[(i + 1) % n] as Pt)) < 1e-9);
    if (cut < 0) break;
    pts = pts.filter((_, k) => k !== cut);
  }
  if (pts.length === 3) tris.push(pts);
  return tris;
}

/** The area two simple polygons share: the one clipped to each triangle of the other. */
function sharedArea(a: Pt[], b: Pt[]): number {
  let total = 0;
  for (const [p, q, r] of triangulate(a) as [Pt, Pt, Pt][]) {
    let part = b;
    for (const [s, t] of [
      [p, q],
      [q, r],
      [r, p],
    ] as [Pt, Pt][]) {
      // Keep what is left of s -> t: the inside of a counter-clockwise triangle.
      const ea = t.y - s.y;
      const eb = -(t.x - s.x);
      part = clipHalf(part, ea, eb, ea * s.x + eb * s.y);
      if (part.length < 3) break;
    }
    total += area(part);
  }
  return total;
}

export interface SideQuantities {
  sideId: string;
  name: string;
  /** False until an eave is measured: a face with no top has no area. */
  complete: boolean;
  lengthFeet: number;
  fallFeet: number;
  /** The face below the eave line, and the gable above it, before openings. */
  wallSquareFeet: number;
  gableSquareFeet: number;
  grossSquareFeet: number;
  openingSquareFeet: number;
  netSquareFeet: number;
  bands: BandQuantities[];
  openings: { id: string; kind: ExteriorOpeningKind; widthFeet: number; heightFeet: number; squareFeet: number }[];
  /** Round each opening: all four sides of a window, three of a door. For J-channel and trim. */
  openingTrimFeet: number;
  /** The cladding's height at each corner. */
  corners: { leftFeet: number; rightFeet: number };
  /** Rise in 12 from a MEASURED gable: (peak − the eave under it) over half the gable's span. */
  pitchFromGable: number | null;
  gableSource: "measured" | "roof" | null;
}

export function bandLabel(band: CladdingBand): string {
  return band.kind === "other" && band.label?.trim() ? band.label.trim() : CLADDING_LABEL[band.kind];
}

/**
 * A side tapped as shapes: each closed shape of cladding is its own face, its area its polygon's,
 * less every opening where it overlaps it - a window across a stucco/stone line comes out of both.
 * Parging and open shapes are not counted. The wall/gable split is the line between the two eaves.
 */
function shapeQuantities(side: ExteriorSide, empty: SideQuantities): SideQuantities {
  const faces = (side.shapes ?? []).filter((s) => s.closed && s.kind !== "parging" && s.polygon.length >= 3);
  if (faces.length === 0) return empty;
  const L = Math.max(1e-9, side.lengthFeet);
  const rects = side.openings.map((o) => openingRect(side, o));
  /*
    Shapes that overlap - a stone wainscot tapped over a stucco wall - would count the overlap twice.
    The later-tapped shape is taken to be the one on top, as it is laid over the first, so the
    earlier gives up what the later covers. A shared corner or edge shares no area.
  */
  const lost = faces.map(() => 0);
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) lost[i] = (lost[i] as number) + sharedArea((faces[i] as ExteriorShape).polygon, (faces[j] as ExteriorShape).polygon);
  }
  const bands: BandQuantities[] = faces.map((f, i) => {
    const own = area(f.polygon);
    const overlap = Math.min(own, lost[i] as number);
    const gross = own - overlap;
    // An opening's part under a later shape already went with the overlap: it comes out of that shape, not this one too.
    const later = faces.slice(i + 1);
    const holes = Math.min(
      gross,
      rects.reduce((sum, r) => {
        const inside = clipRect(f.polygon, r.x0, r.x1, r.y0, r.y1);
        const a = area(inside);
        if (a <= 0) return sum;
        const covered = later.reduce((c, g) => c + sharedArea(g.polygon, inside), 0);
        return sum + a - Math.min(a, covered);
      }, 0),
    );
    return {
      bandId: f.id,
      kind: f.kind as CladdingKind,
      label: shapeLabel(f),
      grossSquareFeet: gross,
      openingSquareFeet: holes,
      netSquareFeet: Math.max(0, gross - holes),
      ...(overlap > 1e-6 ? { overlapSquareFeet: overlap } : {}),
    };
  });
  const zl = side.eaveLeftFeet;
  const zr = side.eaveRightFeet ?? zl;
  const gross = bands.reduce((sum, b) => sum + b.grossSquareFeet, 0);
  const holes = bands.reduce((sum, b) => sum + b.openingSquareFeet, 0);
  // Below the line between the two eaves is wall; above it, gable - each shape's share less what it gave up to an overlap.
  const wall =
    zl == null || zr == null
      ? gross
      : faces.reduce((sum, f, i) => {
          const own = area(f.polygon);
          const below = area(clipHalf(f.polygon, -(zr - zl) / L, 1, zl));
          return sum + (own > 0 ? (below * (bands[i] as BandQuantities).grossSquareFeet) / own : 0);
        }, 0);
  const baseL = side.base === "grade" ? 0 : side.baseLeftFeet;
  const baseR = side.base === "grade" ? 0 : side.baseRightFeet;
  let pitchFromGable: number | null = side.pitchMeasured ?? null;
  if (pitchFromGable === null && side.gable && zl != null && zr != null) {
    const at = clamp(side.gable.atFeet, 0, L);
    const eaveAt = zl + ((zr - zl) * at) / L;
    if (at > 0 && at < L) pitchFromGable = ((side.gable.peakFeet - eaveAt) / Math.min(at, L - at)) * 12;
  }
  return {
    ...empty,
    complete: true,
    wallSquareFeet: wall,
    gableSquareFeet: Math.max(0, gross - wall),
    grossSquareFeet: gross,
    openingSquareFeet: holes,
    netSquareFeet: Math.max(0, gross - holes),
    bands,
    corners: { leftFeet: zl == null ? 0 : zl - baseL, rightFeet: zr == null ? 0 : zr - baseR },
    pitchFromGable,
    gableSource: side.gable ? "measured" : null,
  };
}

export function sideQuantities(side: ExteriorSide, roofRise: RoofRise | null = null): SideQuantities {
  const shape = elevationShape(side, roofRise);
  const openings = side.openings.map((o) => ({ id: o.id, kind: o.kind, widthFeet: o.widthFeet, heightFeet: o.heightFeet, squareFeet: o.widthFeet * o.heightFeet }));
  const openingTrimFeet = side.openings.reduce((s, o) => s + (o.kind === "window" ? 2 * (o.widthFeet + o.heightFeet) : 2 * o.heightFeet + o.widthFeet), 0);
  const empty: SideQuantities = {
    sideId: side.id,
    name: side.name,
    complete: false,
    lengthFeet: shape.lengthFeet,
    fallFeet: shape.fallFeet,
    wallSquareFeet: 0,
    gableSquareFeet: 0,
    grossSquareFeet: 0,
    openingSquareFeet: 0,
    netSquareFeet: 0,
    bands: [],
    openings,
    openingTrimFeet,
    corners: { leftFeet: 0, rightFeet: 0 },
    pitchFromGable: null,
    gableSource: null,
  };
  if ((side.shapes ?? []).length > 0) return shapeQuantities(side, empty);
  if (shape.eaveZ === null || shape.cladding.length < 3) return empty;
  const eaveZ = shape.eaveZ;

  const rects = side.openings.map((o) => openingRect(side, o));
  const bands: BandQuantities[] = bandRanges(side, eaveZ).map(({ band, lo, hi }) => {
    const part = clipLevels(shape.cladding, lo, hi);
    const gross = area(part);
    const holes = rects.reduce((s, r) => s + area(clipRect(part, r.x0, r.x1, r.y0, r.y1)), 0);
    return { bandId: band.id, kind: band.kind, label: bandLabel(band), grossSquareFeet: gross, openingSquareFeet: holes, netSquareFeet: Math.max(0, gross - holes) };
  });
  const wall = area(clipLevels(shape.cladding, -Infinity, eaveZ));
  const gable = area(clipLevels(shape.cladding, eaveZ, Infinity));
  const gross = bands.reduce((s, b) => s + b.grossSquareFeet, 0);
  const holes = bands.reduce((s, b) => s + b.openingSquareFeet, 0);

  let pitchFromGable: number | null = side.pitchMeasured ?? null;
  if (pitchFromGable === null && shape.gable?.source === "measured") {
    const half = (shape.gable.to - shape.gable.from) / 2;
    if (half > 0) pitchFromGable = ((shape.gable.peak.y - eaveZ) / half) * 12;
  }

  return {
    ...empty,
    complete: true,
    wallSquareFeet: wall,
    gableSquareFeet: gable,
    grossSquareFeet: gross,
    openingSquareFeet: holes,
    netSquareFeet: Math.max(0, gross - holes),
    bands,
    corners: { leftFeet: eaveZ - shape.bottom[0].y, rightFeet: eaveZ - shape.bottom[1].y },
    pitchFromGable,
    gableSource: shape.gable?.source ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// The footprint: the sides joined
// ---------------------------------------------------------------------------------------------

export interface Footprint {
  /** Whether the sides go all the way round and meet. */
  closes: boolean;
  /** Why not, when they don't. */
  reason: string | null;
  /** Corner i is where side i starts (its left corner); y up, the front along y = 0. */
  corners: Pt[];
  sideIds: string[];
  /** Each side's length as the footprint uses it, after any closing gap is shared out. */
  lengthsFeet: number[];
  /** How far the sides as typed missed meeting their start. */
  misclosureFeet: number;
  areaSquareFeet: number;
  perimeterFeet: number;
}

/** Whether an outline's walls, each level or upright, cross or touch anywhere but at the corner two of them share. */
function crossesItself(points: Pt[]): boolean {
  const n = points.length;
  const meet = (a: Pt, b: Pt, c: Pt, d: Pt) =>
    Math.min(a.x, b.x) <= Math.max(c.x, d.x) + 1e-6 && Math.min(c.x, d.x) <= Math.max(a.x, b.x) + 1e-6 && Math.min(a.y, b.y) <= Math.max(c.y, d.y) + 1e-6 && Math.min(c.y, d.y) <= Math.max(a.y, b.y) + 1e-6;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (meet(points[i] as Pt, points[(i + 1) % n] as Pt, points[j] as Pt, points[(j + 1) % n] as Pt)) return true;
    }
  }
  return false;
}

/**
 * Walks the sides round with square corners: each outside corner a left turn, each inside one a
 * right turn (walking with the house on your left, as you do going to the right along the faces).
 *
 * Lengths taped round a real house never close exactly - the owner's first side read 34'3" on the
 * phone and 33'6" on his tape. Whatever the walk misses by is shared out over the sides running
 * that way, each in proportion to its length, so opposite sides of a rectangle end up equal (at a
 * length between the two typed) and every corner stays square. The miss is reported, so a typo
 * shows rather than being quietly absorbed.
 */
export function exteriorFootprint(exterior: Exterior): Footprint {
  const sides = exterior.sides;
  const ids = sides.map((s) => s.id);
  const fail = (reason: string): Footprint => ({
    closes: false,
    reason,
    corners: [],
    sideIds: ids,
    lengthsFeet: sides.map((s) => s.lengthFeet),
    misclosureFeet: 0,
    areaSquareFeet: 0,
    perimeterFeet: 0,
  });
  if (exterior.open) return fail("Still going round the house: add the next side, or close the outline.");
  if (sides.length < 4) return fail(`A footprint needs every side of the house: ${sides.length} of at least 4 so far.`);
  /*
    A walk the phone did not close can still add up to four corners by chance - six sides of a house
    with a side or two missed - and a roof built on that would be the wrong roof. Not until the
    estimator has worked on the sides.
  */
  if (exterior.source?.walkClosed === false && !exterior.source.edited) {
    return fail("The phone's walk did not go all the way round the house: put in the sides it missed, or put the corners right, and the footprint and roof build from them.");
  }
  const outside = sides.filter((s) => s.turn === "outside").length;
  const inside = sides.length - outside;
  if (outside - inside !== 4) {
    return fail(`The corners don't go round: ${outside} outside and ${inside} inside. A house has 4 more outside corners than inside ones.`);
  }
  if (sides.some((s) => !(s.lengthFeet > 0))) return fail("Every side needs a length.");

  const dirs: Pt[] = [];
  let d: Pt = { x: 1, y: 0 };
  for (const side of sides) {
    dirs.push(d);
    d = side.turn === "outside" ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
  }
  let ex = 0;
  let ey = 0;
  let sx = 0;
  let sy = 0;
  sides.forEach((side, i) => {
    const dir = dirs[i] as Pt;
    ex += dir.x * side.lengthFeet;
    ey += dir.y * side.lengthFeet;
    if (dir.x !== 0) sx += side.lengthFeet;
    else sy += side.lengthFeet;
  });
  const lengths = sides.map((side, i) => {
    const dir = dirs[i] as Pt;
    if (dir.x !== 0) return side.lengthFeet - (sx > 0 ? (ex * dir.x * side.lengthFeet) / sx : 0);
    return side.lengthFeet - (sy > 0 ? (ey * dir.y * side.lengthFeet) / sy : 0);
  });
  if (lengths.some((l) => !(l > 0.01))) return fail("The sides don't meet: one would have to shrink to nothing to close the outline. Check the lengths.");

  const corners: Pt[] = [];
  let at: Pt = { x: 0, y: 0 };
  lengths.forEach((len, i) => {
    corners.push(at);
    const dir = dirs[i] as Pt;
    at = { x: at.x + dir.x * len, y: at.y + dir.y * len };
  });
  // Snap away float dust, so walls the roof treats as square are exactly square.
  const snapped = corners.map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }));
  // Lengths that walk the outline across itself are no house: said, rather than built into a roof.
  if (crossesItself(snapped)) return fail("The sides as typed cross over each other: check the lengths and the corners.");
  return {
    closes: true,
    reason: null,
    corners: snapped,
    sideIds: ids,
    lengthsFeet: lengths,
    misclosureFeet: Math.hypot(ex, ey),
    areaSquareFeet: polygonArea(snapped),
    perimeterFeet: lengths.reduce((s, l) => s + l, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Pitch, roof and everything together
// ---------------------------------------------------------------------------------------------

export interface PitchReading {
  /** Never null since 2026-10-13: with nothing typed or measured it is `ASSUMED_PITCH`. */
  value: number | null;
  source: "typed" | "sides" | "assumed" | null;
  /** Each side with a measured gable, and the pitch it gives. */
  fromSides: { sideId: string; name: string; pitch: number }[];
}

/**
 * The pitch the roof is built at: as typed, else the mean of what the measured gables give, else
 * `ASSUMED_PITCH` - so the roof is there as soon as the footprint closes, said to be assumed.
 */
export function exteriorPitch(exterior: Exterior): PitchReading {
  const fromSides = exterior.sides
    .map((side) => ({ side, q: sideQuantities(side) }))
    .filter(({ q }) => q.pitchFromGable !== null)
    .map(({ side, q }) => ({ sideId: side.id, name: side.name, pitch: q.pitchFromGable as number }));
  if (exterior.roof.pitch !== null && exterior.roof.pitch >= 0) return { value: exterior.roof.pitch, source: "typed", fromSides };
  if (fromSides.length > 0) return { value: fromSides.reduce((s, f) => s + f.pitch, 0) / fromSides.length, source: "sides", fromSides };
  return { value: ASSUMED_PITCH, source: "assumed", fromSides };
}

export function roofInput(exterior: Exterior, footprint: Footprint, pitch: number): RoofInput {
  return {
    corners: footprint.corners,
    sideIds: footprint.sideIds,
    pitch,
    eaveOverhangFeet: Math.max(0, exterior.roof.eaveOverhangFeet),
    rakeOverhangFeet: Math.max(0, exterior.roof.rakeOverhangFeet),
    ridgeAlong: exterior.roof.ridgeAlong,
    ends: exterior.roof.ends,
    additions: exterior.roof.additions ?? [],
    lowerWings: exterior.roof.lowerWings ?? [],
    wingGables: exterior.roof.wingGables ?? [],
    coveredNotches: exterior.roof.coveredNotches ?? [],
    sideNames: Object.fromEntries(exterior.sides.map((s) => [s.id, s.name.trim() || "Side"])),
  };
}

export interface CladdingTotal {
  /** The kind, or "other: <label>" kept apart per label. */
  key: string;
  kind: CladdingKind;
  label: string;
  grossSquareFeet: number;
  openingSquareFeet: number;
  netSquareFeet: number;
}

/** A slope of the roof as the estimate sees it. */
export interface SlopeQuantity {
  key: string;
  label: string;
  /** The side it drains toward, by name. */
  faces: string;
  planSquareFeet: number;
  areaSquareFeet: number;
  selected: boolean;
}

export interface RoofingQuantities {
  pitch: number;
  /** Neither typed nor given by a measured gable: `ASSUMED_PITCH`, and asked for. */
  pitchAssumed: boolean;
  pitchFactor: number;
  material: RoofMaterial | null;
  slopes: SlopeQuantity[];
  /** Every slope chosen - and so for an outline whose slopes are not worked out. */
  allSlopes: boolean;
  /** The chosen slopes on the slope, and in squares: real values, no waste (the estimator adds it). */
  areaSquareFeet: number;
  squares: number;
  /** Every ridge, hip and valley that bounds a chosen slope. */
  ridgeFeet: number;
  hipFeet: number;
  valleyFeet: number;
  /** Flashing where a lower roof meets a wall: along its level top, and up its slopes. */
  headwallFeet: number;
  stepFeet: number;
  /** The drip line of the chosen slopes. */
  eaveFeet: number;
  rakeFeet: number;
  dripEdgeFeet: number;
  starterFeet: number;
  iceWaterFeet: number;
  /** Metal: foam closure at the eaves and on both sides of the ridge. */
  closureFeet: number;
  ridgeVentFeet: number;
  /** "7/12 to 9/12" and up: the steep charge on the chosen slopes. */
  steep: string | null;
  /** Every eave and rake chosen for the eavestrough, soffit and fascia. */
  allEdges: boolean;
  gutter: {
    feet: number;
    runs: GutterRun[];
    endCaps: number;
    outsideMitres: number;
    insideMitres: number;
    downspouts: number;
    /** Counted by the rule, not typed. */
    downspoutsCounted: boolean;
    /** Their total length: typed, or each eave's height + 15%; null with no eave height known. */
    downspoutFeet: number | null;
    downspoutFeetTyped: boolean;
    drops: number;
    elbows: number;
  };
  soffit: { eaveFeet: number; rakeFeet: number; eaveSquareFeet: number; rakeSquareFeet: number };
  fasciaFeet: number;
  /** What is still to be answered before each part can be priced: never taken as a no. */
  toAnswer: { roofing: string[]; eavestrough: string[]; soffitFascia: string[] };
}

function steepBand(pitch: number): string | null {
  if (pitch >= 12 + 1e-9) return "over 12/12";
  if (pitch >= 10 - 1e-9) return "10/12 to 12/12";
  if (pitch >= 7 - 1e-9) return "7/12 to 9/12";
  return null;
}

/** A side's eave height: the mean of its two corners. */
function sideEave(side: ExteriorSide | undefined): number | null {
  if (!side || side.eaveLeftFeet == null) return null;
  return (side.eaveLeftFeet + (side.eaveRightFeet ?? side.eaveLeftFeet)) / 2;
}

/** The roof as priced: the slopes chosen on the plan, the eaves and rakes chosen for the eavestrough, and the owner's list of questions. */
export function roofingQuantities(exterior: Exterior, roof: RoofPlan, pitch: PitchReading = exteriorPitch(exterior)): RoofingQuantities {
  const R = exterior.roof;
  const pitchAssumed = pitch.source === "assumed";
  const sideById = new Map(exterior.sides.map((s) => [s.id, s]));
  const slopeChosen = (key: string) => R.slopes == null || R.slopes.includes(key);
  const slopes: SlopeQuantity[] = roof.facets.map((f) => ({
    key: f.key,
    label: f.label,
    faces: (f.sideId !== null ? sideById.get(f.sideId)?.name.trim() : "") || "",
    planSquareFeet: f.planSquareFeet,
    areaSquareFeet: f.areaSquareFeet,
    selected: slopeChosen(f.key),
  }));
  const noSlopes = roof.facets.length === 0;
  const allSlopes = noSlopes || slopes.every((s) => s.selected);
  const areaSquareFeet = noSlopes ? roof.areaSquareFeet : slopes.filter((s) => s.selected).reduce((sum, s) => sum + s.areaSquareFeet, 0);
  const touches = (facets: string[]) => noSlopes || facets.some(slopeChosen);
  const t: Record<RoofLineKind, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, headwall: 0, step: 0 };
  for (const l of roof.lines) if (touches(l.facets)) t[l.kind] += l.feet;
  const ridgeVentFeet = roof.lines.filter((l) => l.kind === "ridge" && (R.ridgeVents ?? []).includes(l.key)).reduce((s, l) => s + l.feet, 0);

  // The eavestrough, soffit and fascia run along the eaves and rakes chosen, slopes or no slopes.
  const chosenEdges = R.edges ?? null;
  const edgeChosen = (key: string) => chosenEdges === null || chosenEdges.includes(key);
  // Flashing takes no eavestrough, soffit or fascia, so it is never one to choose.
  const allEdges = roof.edges.filter((e) => e.kind === "eave" || e.kind === "rake").every((e) => edgeChosen(e.key));
  const runs = gutterRuns(roof, chosenEdges);
  const gutterFeet = runs.reduce((s, r) => s + r.feet, 0);
  const counted = R.downspouts === null;
  const downspouts = counted ? runs.reduce((s, r) => s + Math.max(1, Math.ceil(r.feet / FEET_PER_DOWNSPOUT - 1e-9)), 0) : Math.max(0, Math.round(R.downspouts as number));
  // Each run down from its own eave: the eave height of the side under it, by length.
  let heightFeet = 0;
  let heightOver = 0;
  for (const run of runs) {
    for (const e of run.edges) {
      const h = sideEave(e.sideId !== null ? sideById.get(e.sideId) : undefined);
      if (h === null) continue;
      heightFeet += h * e.planFeet;
      heightOver += e.planFeet;
    }
  }
  const eaveHeight = heightOver > 0 ? heightFeet / heightOver : null;
  const typedFeet = R.downspoutFeet != null && R.downspoutFeet >= 0;
  const downspoutFeet = typedFeet ? (R.downspoutFeet as number) : eaveHeight === null ? null : downspouts * eaveHeight * DOWNSPOUT_ALLOWANCE;

  const soffitEave = roof.edges.filter((e) => e.kind === "eave" && edgeChosen(e.key)).reduce((s, e) => s + e.planFeet, 0);
  const soffitRake = roof.edges.filter((e) => e.kind === "rake" && edgeChosen(e.key)).reduce((s, e) => s + e.feet, 0);
  const material = R.material ?? null;

  const roofingQs: string[] = [];
  if (pitchAssumed) roofingQs.push(`the pitch (${formatPitch(roof.pitch)} is assumed)`);
  if (material === null) roofingQs.push("the roofing material");
  if (R.dripEdge == null) roofingQs.push("drip edge, yes or no");
  if (R.underlayment == null) roofingQs.push("underlayment: synthetic, felt or none");
  if (R.high == null) roofingQs.push("two storeys or higher, yes or no");
  if (R.handload == null) roofingQs.push("handload materials, yes or no");
  if (R.disposalHandload == null) roofingQs.push("handload to disposal, yes or no");
  if (R.chimney == null) roofingQs.push("chimney flashing: none, small, medium or large");
  if (R.vents === undefined) roofingQs.push("how many roof vents (0 if none)");
  if (R.pipeJacks === undefined) roofingQs.push("how many pipe jacks (0 if none)");
  if (R.ridgeVents === undefined && roof.lines.some((l) => l.kind === "ridge")) roofingQs.push("ridge vent: which ridges, or none");

  return {
    pitch: roof.pitch,
    pitchAssumed,
    pitchFactor: roof.pitchFactor,
    material,
    slopes,
    allSlopes,
    areaSquareFeet,
    squares: areaSquareFeet / 100,
    ridgeFeet: t.ridge,
    hipFeet: t.hip,
    valleyFeet: t.valley,
    headwallFeet: t.headwall,
    stepFeet: t.step,
    eaveFeet: t.eave,
    rakeFeet: t.rake,
    dripEdgeFeet: t.eave + t.rake,
    starterFeet: t.eave,
    iceWaterFeet: t.eave + t.valley,
    closureFeet: t.eave + 2 * t.ridge,
    ridgeVentFeet,
    steep: steepBand(roof.pitch),
    allEdges,
    gutter: {
      feet: gutterFeet,
      runs,
      endCaps: runs.reduce((s, r) => s + r.endCaps, 0),
      outsideMitres: runs.reduce((s, r) => s + r.outsideMitres, 0),
      insideMitres: runs.reduce((s, r) => s + r.insideMitres, 0),
      downspouts,
      downspoutsCounted: counted,
      downspoutFeet,
      downspoutFeetTyped: typedFeet,
      drops: downspouts,
      elbows: downspouts * Math.max(0, Math.round(R.elbowsPerDownspout ?? DEFAULT_ELBOWS_PER_DOWNSPOUT)),
    },
    soffit: {
      eaveFeet: soffitEave,
      rakeFeet: soffitRake,
      eaveSquareFeet: soffitEave * Math.max(0, R.eaveOverhangFeet),
      rakeSquareFeet: soffitRake * Math.max(0, R.rakeOverhangFeet),
    },
    fasciaFeet: soffitEave + soffitRake,
    toAnswer: {
      roofing: roofingQs,
      eavestrough: R.leafGuard == null ? ["leaf guard, yes or no"] : [],
      soffitFascia: R.soffitMaterial == null ? ["soffit and fascia: metal or wood"] : [],
    },
  };
}

export interface ExteriorQuantities {
  footprint: Footprint;
  pitch: PitchReading;
  /** Null until the sides close and there is a pitch. */
  roof: RoofPlan | null;
  roofing: RoofingQuantities | null;
  sides: SideQuantities[];
  /** The roof's gable over each side, where the roof gives one - what each elevation draws. */
  rises: Record<string, RoofRise>;
  cladding: CladdingTotal[];
  openings: { kind: ExteriorOpeningKind; widthFeet: number; heightFeet: number; count: number }[];
  totals: {
    grossSquareFeet: number;
    openingSquareFeet: number;
    netSquareFeet: number;
    gableSquareFeet: number;
    openingTrimFeet: number;
    outsideCornerFeet: number;
    insideCornerFeet: number;
  };
}

export function exteriorQuantities(exterior: Exterior): ExteriorQuantities {
  const footprint = exteriorFootprint(exterior);
  const pitch = exteriorPitch(exterior);
  let roof: RoofPlan | null = null;
  const rises: Record<string, RoofRise> = {};
  if (footprint.closes && pitch.value !== null) {
    const input = roofInput(exterior, footprint, pitch.value);
    roof = buildRoof(input);
    if (roof.shape !== "other") {
      const n = footprint.corners.length;
      footprint.sideIds.forEach((id, i) => {
        const rise = roofRiseAlongWall(input, footprint.corners[i] as Pt, footprint.corners[(i + 1) % n] as Pt);
        if (rise.some((r) => r.rise > 1e-6)) rises[id] = rise;
      });
    }
  }

  const sides = exterior.sides.map((side) => sideQuantities(side, rises[side.id] ?? null));

  const byKind = new Map<string, CladdingTotal>();
  for (const s of sides) {
    for (const b of s.bands) {
      const key = b.kind === "other" ? `other:${b.label.toLowerCase()}` : b.kind;
      const t = byKind.get(key) ?? { key, kind: b.kind, label: b.label, grossSquareFeet: 0, openingSquareFeet: 0, netSquareFeet: 0 };
      t.grossSquareFeet += b.grossSquareFeet;
      t.openingSquareFeet += b.openingSquareFeet;
      t.netSquareFeet += b.netSquareFeet;
      byKind.set(key, t);
    }
  }

  const openingGroups = new Map<string, { kind: ExteriorOpeningKind; widthFeet: number; heightFeet: number; count: number }>();
  for (const side of exterior.sides) {
    for (const o of side.openings) {
      const key = `${o.kind}:${Math.round(o.widthFeet * 12)}x${Math.round(o.heightFeet * 12)}`;
      const g = openingGroups.get(key) ?? { kind: o.kind, widthFeet: o.widthFeet, heightFeet: o.heightFeet, count: 0 };
      g.count += 1;
      openingGroups.set(key, g);
    }
  }

  let outsideCornerFeet = 0;
  let insideCornerFeet = 0;
  exterior.sides.forEach((side, i) => {
    const q = sides[i] as SideQuantities;
    if (!q.complete) return;
    const next = sides[(i + 1) % sides.length] as SideQuantities;
    const height = next.complete ? (q.corners.rightFeet + next.corners.leftFeet) / 2 : q.corners.rightFeet;
    if (side.turn === "outside") outsideCornerFeet += height;
    else insideCornerFeet += height;
  });

  const roofing: RoofingQuantities | null = roof ? roofingQuantities(exterior, roof, pitch) : null;

  return {
    footprint,
    pitch,
    roof,
    roofing,
    sides,
    rises,
    cladding: [...byKind.values()],
    openings: [...openingGroups.values()],
    totals: {
      grossSquareFeet: sides.reduce((s, q) => s + q.grossSquareFeet, 0),
      openingSquareFeet: sides.reduce((s, q) => s + q.openingSquareFeet, 0),
      netSquareFeet: sides.reduce((s, q) => s + q.netSquareFeet, 0),
      gableSquareFeet: sides.reduce((s, q) => s + q.gableSquareFeet, 0),
      openingTrimFeet: sides.reduce((s, q) => s + q.openingTrimFeet, 0),
      outsideCornerFeet,
      insideCornerFeet,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Into the scope
// ---------------------------------------------------------------------------------------------

/** Siding that goes on over a wrap and is trimmed round its openings; stucco, EIFS, brick and stone are not. */
const SIDING_KINDS: CladdingKind[] = ["vinyl", "wood_shake", "wood", "fibre_cement", "metal"];

export interface ExteriorScopeLines {
  /** For the roofer. */
  roofing: string[];
  /** For the siding crew: cladding and what is on the walls, soffit and fascia, eavestrough. */
  siding: string[];
}

/** "Detach & reset dryer vent", "Replace hose bib". */
export function fixtureLine(f: SideFixture): string {
  const what = f.kind === "other" ? f.label?.trim() || "item" : SIDE_FIXTURE_LABEL[f.kind].toLowerCase();
  return `${f.action === "replace" ? "Replace" : "Detach & reset"} ${what}`;
}

/**
 * The exterior's lines for the scope document and the work orders: what the estimator put in
 * scope, with the quantity the measurements give.
 *
 * Built here and handed over READY, as the disposal line is (lib/debris.ts): the document's writer
 * copies each one exactly and never works a number out of its own. A line is only made for what
 * was ticked - measuring the outside of a house is not deciding to replace it - and every answer
 * given for a ticked part has its line: nothing typed in is left off. Squares are real, with no
 * waste: that is the estimator's to add.
 */
export function exteriorScopeLines(exterior: Exterior | undefined): ExteriorScopeLines {
  const out: ExteriorScopeLines = { roofing: [], siding: [] };
  const scope = exterior?.scope;
  if (!exterior) return out;
  const q = exteriorQuantities(exterior);
  const num = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  const r = q.roofing;
  const R = exterior.roof;

  if (scope?.roofing && r) {
    const sq = `${r.squares.toFixed(2)} SQ`;
    const which = r.allSlopes ? "all slopes" : `slope${r.slopes.filter((s) => s.selected).length === 1 ? "" : "s"} ${r.slopes.filter((s) => s.selected).map((s) => s.label).join(", ")}`;
    const metal = r.material === "metal";
    out.roofing.push(`Remove & replace roofing – ${r.material ? ROOF_MATERIAL_LABEL[r.material] : "material to confirm"} – ${formatPitch(r.pitch)}${r.pitchAssumed ? " (assumed, to confirm)" : ""} – ${sq} (${which})`);
    if (r.steep) out.roofing.push(`Steep roof charge – ${r.steep} – ${sq}`);
    if (R.high === true) out.roofing.push(`High roof charge – two storeys or more – ${sq}`);
    if (r.ridgeFeet + r.hipFeet > 0) out.roofing.push(`Hip & ridge cap – ${num(r.ridgeFeet + r.hipFeet)} LF`);
    if (metal) out.roofing.push(`Closure strips – ${num(r.closureFeet)} LF (eaves + 2 × ridge)`);
    else if (r.starterFeet > 0) out.roofing.push(`Starter – ${num(r.starterFeet)} LF (eaves)`);
    if (R.dripEdge === true) out.roofing.push(`Drip edge – ${num(r.dripEdgeFeet)} LF (eaves + rakes) – photos required`);
    out.roofing.push(`${metal ? "High-temperature ice & water barrier" : "Ice & water barrier"} – ${num(r.iceWaterFeet)} LF (eaves + valleys)`);
    if (R.underlayment === "synthetic" || R.underlayment === "felt") out.roofing.push(`Underlayment – ${R.underlayment} – ${sq} – photos required`);
    if (r.valleyFeet > 0) out.roofing.push(`Valleys – ${num(r.valleyFeet)} LF`);
    if (r.stepFeet > 0) out.roofing.push(`Step flashing – ${num(r.stepFeet)} LF (a lower roof's slopes against the wall)`);
    if (r.headwallFeet > 0) out.roofing.push(`Headwall flashing – ${num(r.headwallFeet)} LF (a lower roof's top against the wall)`);
    for (const kind of Object.keys(ROOF_VENT_LABEL) as RoofVentKind[]) {
      const n = Math.round(R.vents?.[kind] ?? 0);
      if (n > 0) out.roofing.push(`${ROOF_VENT_LABEL[kind]} – ${n}`);
    }
    if (r.ridgeVentFeet > 0) out.roofing.push(`Ridge vent – ${num(r.ridgeVentFeet)} LF`);
    if ((R.pipeJacks?.four ?? 0) > 0) out.roofing.push(`Pipe jack – 4" – ${Math.round(R.pipeJacks?.four ?? 0)}`);
    if ((R.pipeJacks?.six ?? 0) > 0) out.roofing.push(`Pipe jack – 6" – ${Math.round(R.pipeJacks?.six ?? 0)}`);
    if (R.chimney && R.chimney !== "none") out.roofing.push(`Chimney flashing – ${R.chimney}`);
    if (R.handload === true) out.roofing.push(`Handload roofing materials – ${sq}`);
    if (R.disposalHandload === true) out.roofing.push(`Handload debris to disposal – ${sq}`);
    if (metal) out.roofing.push(`Disposal – metal roofing – ${sq}`);
  }

  const sides = q.sides.filter((s) => (scope?.sides ?? []).includes(s.sideId) && s.complete);
  if (sides.length > 0) {
    // A gable the roof gives at a pitch nobody measured is that pitch's guess: the line says so.
    const guessed = (s: SideQuantities) => q.pitch.source === "assumed" && s.gableSource === "roof" && s.gableSquareFeet > 0.05;
    const kinds = new Map<string, { label: string; kind: CladdingKind; gross: number; holes: number; net: number; names: string[]; guessed: boolean }>();
    for (const s of sides) {
      for (const b of s.bands) {
        const key = b.kind === "other" ? `other:${b.label.toLowerCase()}` : b.kind;
        const k = kinds.get(key) ?? { label: b.label, kind: b.kind, gross: 0, holes: 0, net: 0, names: [], guessed: false };
        k.gross += b.grossSquareFeet;
        k.holes += b.openingSquareFeet;
        k.net += b.netSquareFeet;
        k.guessed ||= guessed(s);
        if (!k.names.includes(s.name)) k.names.push(s.name);
        kinds.set(key, k);
      }
    }
    let wrap = 0;
    for (const k of kinds.values()) {
      if (k.net <= 0) continue;
      const holes = k.holes > 0.05 ? ` (${num(k.gross)} SF less ${num(k.holes)} SF of openings)` : "";
      const gables = k.guessed ? ` – gables at the assumed ${formatPitch(q.pitch.value ?? ASSUMED_PITCH)}, to confirm` : "";
      out.siding.push(`Remove & replace ${k.label.toLowerCase()} – ${k.names.join(", ")} – ${num(k.net)} SF${holes}${gables}`);
      if (SIDING_KINDS.includes(k.kind)) wrap += k.net;
    }
    if (wrap > 0) out.siding.push(`House wrap – ${num(wrap)} SF`);
    const sidedTrim = sides
      .filter((s) => s.bands.some((b) => SIDING_KINDS.includes(b.kind) && b.netSquareFeet > 0))
      .reduce((sum, s) => sum + s.openingTrimFeet, 0);
    if (sidedTrim > 0) out.siding.push(`Trim & J-channel round openings – ${num(sidedTrim)} LF`);
  }
  // What is on the walls goes on whether or not the cladding is: a vent can be replaced on its own.
  for (const side of exterior.sides) {
    for (const f of side.fixtures ?? []) {
      if (f.count > 0) out.siding.push(`${fixtureLine(f)} – ${side.name.trim() || "Side"} – ${Math.round(f.count)}`);
    }
  }

  if (scope?.soffitFascia && r) {
    const material = R.soffitMaterial ?? "material to confirm";
    if (r.soffit.eaveFeet > 0) {
      out.siding.push(`Remove & replace soffit – ${material} – ${num(r.soffit.eaveFeet)} LF at ${formatFeetInches(R.eaveOverhangFeet)} overhang (${num(r.soffit.eaveSquareFeet)} SF) – eaves`);
    }
    if (r.soffit.rakeFeet > 0) {
      out.siding.push(`Remove & replace soffit – ${material} – ${num(r.soffit.rakeFeet)} LF at ${formatFeetInches(R.rakeOverhangFeet)} overhang (${num(r.soffit.rakeSquareFeet)} SF) – rakes`);
    }
    if (r.fasciaFeet > 0) out.siding.push(`Remove & replace fascia – ${material} – ${num(r.fasciaFeet)} LF (eaves + rakes)`);
  }
  if (scope?.eavestrough && r && r.gutter.feet > 0) {
    const g = r.gutter;
    out.siding.push(`Remove & replace eavestrough – ${num(g.feet)} LF`);
    if (R.leafGuard === true) out.siding.push(`Leaf guard – ${num(g.feet)} LF`);
    if (g.endCaps > 0) out.siding.push(`End caps – ${g.endCaps}`);
    if (g.outsideMitres + g.insideMitres > 0) out.siding.push(`Mitres – ${g.outsideMitres + g.insideMitres} (${g.outsideMitres} outside, ${g.insideMitres} inside)`);
    if (g.drops > 0) out.siding.push(`Drops – ${g.drops}`);
    if (g.elbows > 0) out.siding.push(`Elbows – ${g.elbows}`);
    if (g.downspouts > 0) {
      const length = g.downspoutFeet === null ? "" : ` – ${num(g.downspoutFeet)} LF${g.downspoutFeetTyped ? "" : " (eave height + 15%)"}`;
      out.siding.push(`Remove & replace downspouts – ${g.downspouts}${length}`);
    }
  }
  return out;
}

/** "4/12", or "4.1/12" when it is not a whole number. */
export function formatPitch(pitch: number): string {
  const r = Math.round(pitch * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}/12`;
}

/** "2'1\" × 4'10\"" - an opening's size, width first. */
export function formatOpeningSize(widthFeet: number, heightFeet: number): string {
  return `${formatFeetInches(widthFeet)} × ${formatFeetInches(heightFeet)}`;
}
