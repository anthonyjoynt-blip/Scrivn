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
import {
  buildRoof,
  EAVE_END_SHARE,
  type GutterRun,
  gutterRuns,
  type LowerRoofKind,
  pitchFactor,
  polygonArea,
  type Pt,
  type RoofAddition,
  splitLevels,
  roofBaseAlongWall,
  type RoofEndKind,
  type RoofInput,
  type RoofLineKind,
  type RoofPlan,
  roofRiseAlongWall,
  type RoofBreak,
  upperOverhang,
} from "./roof";
import { isLegacyRoof, proposeRoof, type RoofProposal, type WingDrop, wingDrops } from "./roofCheck";
import { PIECE_LENGTH_KEYS, pieceCount, pieceCounts, type PieceFigures, pieceFigures, pieceFromPhotos, ROOF_PIECE_LABEL, type RoofPiece } from "./roofPieces";
import { type PhotoPiece, type ResolvedPhotoPiece, resolvePhotoPiece, type UpperShown } from "./roofPhotoShapes";
import type { PhotoRouteState } from "./photoRoute";
import type { Deck } from "./decks";

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

/**
 * A roll-up door (2026-10-19): an overhead door of narrow slats that coils into a hood over its head - the owner's
 * shed has a 5' one. A garage door lifts in panelled sections.
 */
export type ExteriorOpeningKind = "window" | "door" | "garage" | "rollup";

export const OPENING_LABEL: Record<ExteriorOpeningKind, string> = { window: "Window", door: "Door", garage: "Garage door", rollup: "Roll-up door" };

export interface ExteriorOpening {
  id: string;
  kind: ExteriorOpeningKind;
  widthFeet: number;
  heightFeet: number;
  /** The bottom of the opening, above the grade under it. */
  sillFeet: number;
  /** From the side's left corner to the opening's left edge. */
  fromLeftFeet: number;
  /**
   * "photo": read off the side's photo by Finish exterior on the phone (2026-10-15, lib/exteriorFinish.ts), not tapped.
   * "said" (2026-10-21): on a wall no photo faces, the person at the house said how many windows and doors it has
   * (`ExteriorSide.unseenSaid`): put in at a standard size, spaced along it - its size and place not measured.
   */
  from?: "photo" | "said";
  /**
   * Counted and placed off a photo that sees its wall edge-on, or as near (2026-10-22, house G's walkway side): its size and
   * place are not measured, only that it is there - said why ("seen edge-on only (photos 2, 3)"). Drawn faint and dashed,
   * as one said on site is, and named on the report's "To check" until a photo of the wall straight on measures it.
   */
  notMeasured?: string;
  /**
   * What hid part of it in its photo, in the trace's words (2026-10-16): a railing, a deck, plants, a car.
   * Its kind is then a guess, asked on "Check these" (lib/exteriorCheck.ts). Absent: nothing did, or it was tapped.
   */
  hiddenBy?: string;
  /** The estimator said what it is (2026-10-16): on "Check these", or by changing its kind. No longer a guess off a photo. */
  confirmed?: true;
  /** Its surround, when it has one of another finish or colour than the wall (2026-10-17, `OpeningTrim`). */
  trim?: OpeningTrim;
}

/**
 * Trim round an opening (2026-10-17, the owner: "the main house is stucco but you will notice another color and shapes.
 * Columns and surrounding the windows and garage doors. We would want to be able to differentiate these in the report"):
 * a raised surround of another finish or colour - white stucco on his dark stucco - and the keystone at its head. It has
 * its own lines on the scope and the report, and the wall's cladding under it comes off the field, as an opening's does.
 * Not the narrow casing every window and door has: that is the opening's own.
 */
export interface OpeningTrim {
  /** How wide it is past the opening, feet: each jamb, the head over its top, a sill band under its bottom. 0: none there (a door's foot). */
  leftFeet: number;
  rightFeet: number;
  topFeet: number;
  bottomFeet: number;
  /** A strip of the wall showing between the opening and the surround all round, feet: a band set off from the window. Absent: tight to it. */
  gapFeet?: number;
  /** Its jambs run on up past its head to this far over the opening's top: up to a porch ceiling, say. Absent: to the head's top. */
  upFeet?: number;
  material: CladdingKind;
  /** What "other" is. */
  label?: string;
  /** Its colour off the photo, "#rrggbb": for drawing only. */
  colour?: string;
  /** A keystone at the head, centred: its width across its top, and its height from the opening's top up. */
  keystone?: { widthFeet: number; heightFeet: number };
  /** Read off the side's photo, not tapped or typed. */
  from?: "photo";
  /** Why the read is unsure, in words: what hid part of it in its photo, or that its photo saw it edge-on. Asked on "Check these". */
  unsure?: string;
  /** The estimator kept it on "Check these": no longer asked. */
  confirmed?: true;
}

export type ColumnKind = "pilaster" | "column";

export const COLUMN_LABEL: Record<ColumnKind, string> = { pilaster: "Pilaster", column: "Column" };

/** A column's base or cap: a block standing out past its shaft all round. */
export interface ColumnBlock {
  heightFeet: number;
  /** How far it stands out past the shaft, each way. */
  outFeet: number;
}

/**
 * A column or pilaster on a side (2026-10-17): the owner's square stucco columns at the porch and beside the garage doors,
 * with their bases and caps. A PILASTER stands against the wall, its back in it, and covers the cladding behind it; a
 * COLUMN stands clear of the wall (a porch column) and hides nothing of it - each is counted, never taken as the wall hidden.
 */
export interface SideColumn {
  id: string;
  kind: ColumnKind;
  /** From the side's left corner to its left edge, feet: less than 0, or past the right end, where it wraps the corner. */
  fromLeftFeet: number;
  /** Its shaft across, as the side's face sees it, and front to back. */
  widthFeet: number;
  depthFeet: number;
  /** A pilaster: how far its face stands out from the wall. A column: how far its back stands off the wall. */
  outFeet: number;
  /** Its foot above the ground under it (a porch deck), and its height from there to its top, cap and all. */
  footFeet: number;
  heightFeet: number;
  base?: ColumnBlock | null;
  cap?: ColumnBlock | null;
  material: CladdingKind;
  /** What "other" is. */
  label?: string;
  /** Its colour off the photo, "#rrggbb": for drawing only. */
  colour?: string;
  from?: "photo";
  /** Why the read is unsure, in words (see `OpeningTrim.unsure`). */
  unsure?: string;
  confirmed?: true;
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
  /**
   * How far its length may be out, ± percent (2026-10-16, the photos-only route, lib/photoRoute.ts): a side
   * worked out from the photos, not taped. The plan, its elevation and the report's "To check" mark it.
   * Absent: taped, typed, drawn or measured by the phone.
   */
  lengthPlusMinusPct?: number;
  /**
   * Not measured (2026-10-22, the photo route's honest sizes, lib/photoRoute.ts `RouteSide.notMeasured`): why, and the one
   * photo or tape that would measure it. Its length is still drawn with, but the report says it is not measured and never
   * prints it as a size. Absent: measured (taped, or held by the photos to its ±).
   */
  lengthNotMeasured?: string;
  /**
   * With `lengthNotMeasured` (2026-10-23): the side whose tape or laser settles it - its own, or the one wall whose tape
   * settles it and others with it (the house's depth: one tape along the long side). Asked, never required.
   */
  lengthSettleSideId?: string;
  /**
   * Estimated on site (2026-10-21, lib/photoRoute.ts `RouteEstimate`): someone at the house judged it about this long, by
   * eye, and the photos' measure held it there loosely. Never a tape: the report says so beside its length.
   */
  lengthEstimatedFeet?: number;
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
  /** Doors of a standard size on its photo, kept off its AI trace as checks on the house's sizes (2026-10-15, lib/exteriorScale.ts). */
  sizeDoors?: SizeDoor[];
  /**
   * The eaves (and the peak) read off the side's photo by Finish exterior, where none was tapped (2026-10-15,
   * lib/exteriorFinish.ts): "photo". "neighbours" (2026-10-15, the owner's corners-lap-then-photos walk): no photo
   * showed its wall top, so its eaves are the sides' beside it at the corners it shares with them.
   */
  wallTopFrom?: "photo" | "neighbours";
  /**
   * A party wall, shared with the neighbour's home (2026-10-17: semi-detached houses and townhouses, the owner:
   * "One tester at least will have a townhouse. Semi detached"). Nothing on it is counted - cladding, openings,
   * trim, its corners - nor scoped; its elevation is a line saying so; the roof is cut by the party line over it.
   */
  shared?: boolean;
  /** Its columns and pilasters (2026-10-17, `SideColumn`). Absent: none. */
  columns?: SideColumn[];
  /**
   * A wall no photo faces (2026-10-21, `notPhotographed`): what the person at the house said is on it - so many windows and
   * doors, both 0 for none. Absent: not asked, or not answered, and its windows and doors aren't known. The owner, of the
   * first house the Scrivn team measured: windows and doors were missing on walls nobody photographed.
   */
  unseenSaid?: { windows: number; doors: number };
}

/**
 * The kind of home, as a label (2026-10-17): the sides' `shared` flags are what is counted. Absent: by the flags. A
 * split-level and an up/down duplex (2026-10-19) are labels for the cover too: a split-level's sections are measured by
 * their own walls' heights (`splitLevels`), and a duplex is one building, its two units not split.
 */
export type HomeType = "detached" | "semi" | "town_end" | "town_middle" | "split" | "duplex_updown";

export const HOME_TYPE_LABEL: Record<HomeType, string> = {
  detached: "Detached",
  semi: "Semi-detached",
  town_end: "Townhouse, end unit",
  town_middle: "Townhouse, middle unit",
  split: "Split-level",
  duplex_updown: "Duplex (up/down)",
};

/** A home that shares a wall with its neighbour's by its kind: a semi or a townhouse. */
export const isAttachedHome = (type: HomeType | undefined): boolean => type === "semi" || type === "town_end" || type === "town_middle";

const sharedCache = new WeakMap<Exterior, { sides: ExteriorSide[]; upper: UpperFloor | undefined; got: Set<string> }>();

/**
 * Every side shared with a neighbour's home, by id (2026-10-17): each one said so, and an upper floor's side
 * standing on a shared wall's line - a party wall runs up the whole house, so a townhouse's second storey
 * is shared where its first is, with nothing more to set.
 */
export function sharedSideIds(exterior: Exterior): Set<string> {
  const cached = sharedCache.get(exterior);
  if (cached && cached.sides === exterior.sides && cached.upper === exterior.upper) return cached.got;
  const got = new Set(allSides(exterior).filter((s) => s.shared === true).map((s) => s.id));
  const main = exterior.sides.filter((s) => s.shared === true);
  if (exterior.upper && main.length > 0) {
    const fp = exteriorFootprint(exterior);
    const up = upperFootprint(exterior, fp);
    if (fp.closes && up?.closes) {
      const seg = (corners: Pt[], i: number) => [corners[i] as Pt, corners[(i + 1) % corners.length] as Pt] as const;
      const walls = fp.sideIds.map((id, i) => ({ id, seg: seg(fp.corners, i) })).filter((w) => main.some((s) => s.id === w.id));
      up.sideIds.forEach((id, i) => {
        const [a, b] = seg(up.corners, i);
        const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
        const on = walls.some(({ seg: [p, q] }) => {
          const wv = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
          if (wv !== vertical) return false;
          if (vertical ? Math.abs(p.x - a.x) > 0.01 : Math.abs(p.y - a.y) > 0.01) return false;
          const [lo, hi] = vertical ? [Math.min(p.y, q.y), Math.max(p.y, q.y)] : [Math.min(p.x, q.x), Math.max(p.x, q.x)];
          const [ulo, uhi] = vertical ? [Math.min(a.y, b.y), Math.max(a.y, b.y)] : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
          return Math.min(hi, uhi) - Math.max(lo, ulo) > 0.5;
        });
        if (on) got.add(id);
      });
    }
  }
  sharedCache.set(exterior, { sides: exterior.sides, upper: exterior.upper, got });
  return got;
}

/** The sides shared with the neighbours' homes, main floor and upper (`sharedSideIds`). */
export function sharedSides(exterior: Exterior): ExteriorSide[] {
  const ids = sharedSideIds(exterior);
  return allSides(exterior).filter((s) => ids.has(s.id));
}

/**
 * A wall no photo faces (2026-10-21): on an exterior measured from photos, a side - not shared - with none of them laid on
 * it (lib/photoRouteExterior.ts lays a photo on each side it faces and shows). Its windows and doors aren't known, so it is
 * drawn and reported "not photographed", never as a blank wall that reads as "no windows"; the person at the house is
 * asked how many there are (`unseenSaid`). The owner, of the first house the Scrivn team measured from his walk: windows
 * and doors were missing on walls nobody photographed. An exterior from Scan or drawn by hand is never "not photographed":
 * its openings were put in at the house.
 */
export function notPhotographed(exterior: Pick<Exterior, "source" | "sides">, side: ExteriorSide): boolean {
  // The main floor's walls: an upper floor's are seen over the roofs in the main walls' photos, never laid on their own.
  return exterior.source?.kind === "photos" && !side.shared && (side.photos ?? []).length === 0 && exterior.sides.some((s) => s.id === side.id);
}

/** The main floor's walls no photo faces (`notPhotographed`), in order round the house. */
export function notPhotographedSides(exterior: Exterior): ExteriorSide[] {
  return exterior.sides.filter((s) => notPhotographed(exterior, s));
}

/** A wall no photo faces, for the drawings: "unknown" (nobody said), "said" (windows or doors said on site), "none" (said: none). Null: a photo faces it. */
export function unseenState(exterior: Pick<Exterior, "source" | "sides">, side: ExteriorSide): "unknown" | "said" | "none" | null {
  if (!notPhotographed(exterior, side)) return null;
  const said = side.unseenSaid;
  return !said ? "unknown" : said.windows + said.doors === 0 ? "none" : "said";
}

/** Under "Not photographed" on a drawing, by `unseenState`. */
export const UNSEEN_DRAWN: Record<"unknown" | "said" | "none", string> = {
  unknown: "windows and doors not known",
  said: "openings said on site, not measured",
  none: "no openings, said on site",
};

/** The size a window or door said on site is put in at (`unseenSaid`): a common one, its place and size not measured. */
export const SAID_OPENING: Record<"window" | "door", { widthFeet: number; heightFeet: number; sillFeet: number }> = {
  window: { widthFeet: 3, heightFeet: 4, sillFeet: 3 },
  door: { widthFeet: 3, heightFeet: 6 + 8 / 12, sillFeet: 0 },
};

/**
 * What the person at the house said is on a wall no photo faces, put in: so many windows and doors at a common size, spaced
 * evenly along it (doors first), each `from: "said"`; null takes the answer back out. Openings read or put in otherwise
 * stay. As many as fit with a foot between them: a short wall said to have more gets what fits.
 */
export function withUnseenSaid(exterior: Exterior, sideId: string, said: { windows: number; doors: number } | null): Exterior {
  const sides = exterior.sides.map((s) => {
    if (s.id !== sideId) return s;
    const kept = s.openings.filter((o) => o.from !== "said");
    if (!said) {
      const { unseenSaid: _u, ...rest } = s;
      return { ...rest, openings: kept };
    }
    const kinds = [...Array(Math.max(0, Math.round(said.doors))).fill("door"), ...Array(Math.max(0, Math.round(said.windows))).fill("window")] as ("door" | "window")[];
    const fit = Math.max(0, Math.floor((s.lengthFeet - 1) / (SAID_OPENING.window.widthFeet + 1)));
    const placed = kinds.slice(0, fit);
    const step = s.lengthFeet / Math.max(1, placed.length);
    const openings: ExteriorOpening[] = placed.map((k, i) => {
      const size = SAID_OPENING[k];
      return { id: newSketchId("opening"), kind: k, widthFeet: size.widthFeet, heightFeet: size.heightFeet, sillFeet: size.sillFeet, fromLeftFeet: Math.round((step * (i + 0.5) - size.widthFeet / 2) * 100) / 100, from: "said" };
    });
    return { ...s, openings: [...kept, ...openings], unseenSaid: { windows: Math.max(0, Math.round(said.windows)), doors: Math.max(0, Math.round(said.doors)) } };
  });
  return { ...exterior, sides };
}

/**
 * A wall no photo faces, in words: "Not photographed: its windows and doors aren't known." / "Not photographed: 2 windows
 * and a door said on site, their sizes and places not measured." / "Not photographed: no windows or doors, said on site."
 * Null for a side a photo faces.
 */
export function unseenWords(exterior: Pick<Exterior, "source" | "sides">, side: ExteriorSide): string | null {
  if (!notPhotographed(exterior, side)) return null;
  const said = side.unseenSaid;
  if (!said) return "Not photographed: its windows and doors aren't known.";
  if (said.windows === 0 && said.doors === 0) return "Not photographed: no windows or doors, said on site.";
  const n = (count: number, one: string, many: string) => (count === 0 ? "" : count === 1 ? one : `${count} ${many}`);
  const what = [n(said.windows, "a window", "windows"), n(said.doors, "a door", "doors")].filter(Boolean).join(" and ");
  return `Not photographed: ${what} said on site, ${said.windows + said.doors === 1 ? "its size and place" : "their sizes and places"} not measured.`;
}

/** For the drawings: whether a side is shared - or nothing at all for a home with none, drawn as it always was. */
export function sharedOf(exterior: Exterior): ((sideId: string) => boolean) | undefined {
  const ids = sharedSideIds(exterior);
  return ids.size > 0 ? (id: string) => ids.has(id) : undefined;
}

/**
 * What the home is, in words for the report's cover, or null for one with no wall shared: its type as said,
 * else by how many of the main floor's walls are shared.
 */
export function homeTypeWords(exterior: Exterior): string | null {
  // The main floor's walls named: an upper floor's on them goes without saying.
  const mainShared = exterior.sides.filter((s) => s.shared === true);
  const shared = mainShared.length > 0 ? mainShared : sharedSides(exterior);
  if (shared.length === 0) {
    if (exterior.homeType === "split") return "Split-level: its parts stand at different floor levels, each under its own roof, each wall to its own height.";
    if (exterior.homeType === "duplex_updown") return "Duplex (up/down): two units, one over the other, measured as one building.";
    return null;
  }
  const main = mainShared.length;
  const type = isAttachedHome(exterior.homeType) ? HOME_TYPE_LABEL[exterior.homeType as HomeType] : main >= 2 ? "Attached on both sides" : "Attached on one side";
  const wallOf = (s: ExteriorSide) => {
    const name = s.name.trim() || "Side";
    return `the ${name}${/\bwall$/i.test(name) ? "" : " wall"}`;
  };
  const names = shared.map(wallOf);
  const list = names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${type}: ${list} ${names.length === 1 ? "is" : "are"} shared with the neighbour${names.length === 1 ? "" : "s"} and not counted.`;
}

/**
 * A garage door or a door of a size doors are sold in, found by the AI trace on a side's photo and
 * kept as a check on the house's sizes (2026-10-15, lib/exteriorScale.ts): the size it is taken to
 * be, and what the phone measured it at.
 */
export interface SizeDoor {
  id: string;
  /** A garage door, read to the door itself; or a door, read by its leaf - the slab that swings. */
  kind: "garage" | "door";
  /** The size it is taken to be. */
  widthFeet: number;
  heightFeet: number;
  /**
   * As the phone measured it: the trace's read with the house's scale at the time taken off, so it
   * holds however the house is scaled after. `middleFeet` is where it is, from the side's left end.
   */
  phone: { widthFeet: number; heightFeet: number; middleFeet: number };
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
  /**
   * A gambrel's or mansard's break, read off this side's photo (2026-10-15, a slot: nothing reads it
   * yet): the flatter pitch above it and its height above the eave. `pitch` is then the one below.
   * It fills the break of the part with this gable end, under one typed (`ExteriorRoof.sectionBreaks`).
   */
  upperPitch?: number | null;
  breakFeet?: number | null;
  /**
   * The dormers and turrets on the roof over this side, read off its photo (2026-10-15,
   * lib/roofPhotoShapes.ts): each a roof piece "from photos" once ticked (`taken`), its numbers worked
   * out on the roof as built (`photoRoofPieces`). One not ticked is offered on the roof pane.
   */
  pieces?: PhotoPiece[];
  /**
   * What the photo shows over the side: an upper floor flush over it, one set back behind a roof, or
   * none. The upper floor is never drawn from it: it says one is to draw, and answers the high-roof charge.
   */
  upper?: UpperShown | null;
  /** On a wall flush with an upper floor: the floor line, feet up from the side's level - where a tall side splits. */
  floorLineFeet?: number | null;
  /** Set back: the roof from this side up to the upper floor's wall. It fills that lower roof's kind under one picked on the plan. */
  lowerRoof?: LowerRoofKind | null;
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
  /**
   * A site photo of the claim instead (2026-10-16, the photo route): its id among the claim's photos
   * (lib/photos.ts), kept on the phone and in the claim-photos bucket like any other.
   */
  claimPhotoId?: string;
  /**
   * The JPEG upright, as saved: pixels, x right, y down. `k`: the lens's radial term, when the photo is
   * as the camera took it rather than straightened (the photo route): a pixel `to_photo` gives is moved
   * out from the middle by it - see lib/exteriorPhoto.ts.
   */
  camera: { width: number; height: number; fx: number; fy: number; cx: number; cy: number; k?: number };
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
  /** Read off the side's photo by Finish exterior on the phone (2026-10-15, lib/exteriorFinish.ts), not tapped. */
  from?: "photo";
  /** Its colour off the photo, "#rrggbb" (2026-10-17): for drawing only - the owner's dark stucco drawn dark. */
  colour?: string;
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

/**
 * The roof's totals as the estimator types them (2026-10-14): off a roof report the homeowner
 * hands over, a measure by hand, or a roof the drawing can't make - a dormer, a turret, a curved
 * roof. Each one typed replaces the drawing's for the scope lines, the quantities and the documents;
 * a box left blank keeps the drawing's. With no outline drawn at all, the typed totals are the roof.
 *
 * The area is kept in square feet (typed as squares or SF), the rest in feet along the roof. Drip
 * edge, starter and ice & water follow the eaves, rakes and valleys - typed or drawn - unless they
 * are typed themselves.
 *
 * Roof PIECES (2026-10-15, `ExteriorRoof.pieces`, lib/roofPieces.ts) are the other way round: a
 * dormer, a turret, a curved or flat roof put on top of the drawing, its quantities ADDED to the
 * drawing's. The rule between the two: a typed total replaces the drawing's and the pieces' alike,
 * because a roof report already counts its dormers - so a total typed off one is never added to.
 * A total left blank is the drawing's plus the pieces'.
 */
export const ROOF_TOTAL_KEYS = ["squareFeet", "ridge", "hip", "valley", "eave", "rake", "step", "headwall", "dripEdge", "starter", "iceWater"] as const;
export type RoofTotalKey = (typeof ROOF_TOTAL_KEYS)[number];
export type TypedRoofTotals = Partial<Record<RoofTotalKey, number | null>>;
/**
 * Where a total came from: typed, taken off a roof report (2026-10-15), read off the drawing - or a
 * sum of more than one: "both" is the estimator and the drawing, as it was before the report.
 */
export type TotalSource = "estimator" | "report" | "drawing" | "both" | "report+drawing" | "report+estimator" | "all";

export const ROOF_TOTAL_LABEL: Record<RoofTotalKey, string> = {
  squareFeet: "Roof area",
  ridge: "Ridge",
  hip: "Hips",
  valley: "Valleys",
  eave: "Eaves",
  rake: "Rakes",
  step: "Step flashing",
  headwall: "Headwall flashing",
  dripEdge: "Drip edge",
  starter: "Starter",
  iceWater: "Ice & water",
};

/** A typed total, or null where the box was left blank. */
export function typedTotal(roof: ExteriorRoof, key: RoofTotalKey): number | null {
  const v = roof.typed?.[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export function hasTypedTotals(roof: ExteriorRoof): boolean {
  return ROOF_TOTAL_KEYS.some((k) => typedTotal(roof, k) !== null);
}

/** Who gave a typed total: taken off the roof report, or the estimator's own. */
export function typedSource(roof: ExteriorRoof, key: RoofTotalKey): "report" | "estimator" {
  return roof.typedFrom?.[key] === "report" ? "report" : "estimator";
}

/**
 * A roof report the estimator uploaded (2026-10-15): EagleView, Hover, Roofr, GAF QuickMeasure or a
 * roofer's own, read by Claude (lib/roofReport.ts). What it says is kept here and offered beside each
 * box until it is taken or set aside - never applied by itself. A total taken is a typed total
 * (`ExteriorRoof.typed`) marked as the report's (`ExteriorRoof.typedFrom`). The PDF is not kept.
 */
export interface RoofReport {
  /** "EagleView", "Hover", a roofer's company; null when the report names none. */
  vendor: string | null;
  /** The report's own date, YYYY-MM-DD; null when it gives none. */
  date: string | null;
  address: string | null;
  fileName: string;
  /** When it was read, ISO. */
  readAt: string;
  /** Each total the report gives, the area in square feet and the rest in feet; absent = not in it. */
  totals: TypedRoofTotals;
  /** The predominant pitch, rise in 12; null when the report gives none. */
  pitch: number | null;
  /** The areas by pitch, as the report lists them, most area first; empty when it has no such table. */
  pitches: { pitch: number; squareFeet: number | null; percent: number | null }[];
  /** What the estimator should know before taking a number: waste included, structures, a page unreadable. */
  notes: string[];
  /** What the estimator set aside, not to be offered again. */
  setAside?: (RoofTotalKey | "pitch" | "pitches")[];
  /** The areas by pitch taken for the squares at each pitch: a roof with no outline drawn only. */
  pitchesTaken?: boolean;
}

/** "EagleView, 2026-09-30": the report as the documents name it; null for one that names neither. */
export function reportLabel(report: RoofReport | null | undefined): string | null {
  if (!report) return null;
  const parts = [report.vendor, report.date].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** How far a total may stand from the drawing's before it is flagged: squares 5%, lengths 10%. */
export const DISAGREE_SQUARES = 0.05;
export const DISAGREE_LENGTHS = 0.1;

/**
 * A total, typed or off the report, against the drawing's own figure - or the photos' roof's
 * (`photoRoofCheck`), named by `against` - words to say beside its box when the two are further
 * apart than the drawing could be (2026-10-15), else null. One of them is wrong - a slope missed on
 * the drawing, a structure the report has and the drawing hasn't, a typo.
 */
export function totalDisagreement(key: RoofTotalKey, value: number, drawn: number, against: "drawing" | "photos" = "drawing"): string | null {
  const squares = key === "squareFeet";
  const show = (v: number) => (squares ? `${(v / 100).toFixed(2)} SQ` : `${(Math.round(v * 10) / 10).toFixed(1)} LF`);
  const whose = against === "photos" ? "the photos'" : "the drawing's";
  if (drawn <= 1e-6) return value > (squares ? 50 : 0.5) ? (against === "photos" ? "The photos' roof has none." : "The drawing has none.") : null;
  const off = (value - drawn) / drawn;
  if (Math.abs(off) <= (squares ? DISAGREE_SQUARES : DISAGREE_LENGTHS) + 1e-9) return null;
  // To the tenth near the limits, so 5.1% is not said as the 5% it is over.
  const pct = Math.abs(off) * 100;
  return `${pct < 20 ? (Math.round(pct * 10) / 10).toFixed(1) : Math.round(pct)}% ${off > 0 ? "more" : "less"} than ${whose} ${show(drawn)}.`;
}

/**
 * "from the estimator", "from the roof report", "from the drawing", or a mix: what a line says its
 * number came from. Given the report's name ("EagleView, 2026-09-30"), the report is named: the
 * documents' roof plan and figures say which report; the scope lines just "the roof report".
 */
export function sourceWords(source: TotalSource, report?: string | null): string {
  const named = report ? `the roof report (${report})` : "the roof report";
  switch (source) {
    case "estimator":
      return "from the estimator";
    case "report":
      return `from ${named}`;
    case "drawing":
      return "from the drawing";
    case "both":
      return "from the estimator and the drawing";
    case "report+drawing":
      return `from ${named} and the drawing`;
    case "report+estimator":
      return `from ${named} and the estimator`;
    case "all":
      return `from ${named}, the estimator and the drawing`;
  }
}

/** Each single source a mix is made of. */
function sourcesIn(s: TotalSource): ("estimator" | "report" | "drawing")[] {
  if (s === "both") return ["estimator", "drawing"];
  if (s === "report+drawing") return ["report", "drawing"];
  if (s === "report+estimator") return ["report", "estimator"];
  if (s === "all") return ["report", "estimator", "drawing"];
  return [s];
}

function mixSources(sources: TotalSource[]): TotalSource {
  const has = new Set(sources.flatMap(sourcesIn));
  const e = has.has("estimator");
  const p = has.has("report");
  const d = has.has("drawing") || has.size === 0;
  if (p && e && d) return "all";
  if (p && e) return "report+estimator";
  if (p && d) return "report+drawing";
  if (p) return "report";
  if (e && d) return "both";
  return e ? "estimator" : "drawing";
}

/** Where a sum came from: the parts that add anything to it (a hip roof's rakes add nothing to its drip edge). */
export function sourceOfParts(...parts: [number, TotalSource][]): TotalSource {
  const adding = parts.filter(([v]) => v > 1e-9);
  return mixSources((adding.length > 0 ? adding : parts).map(([, s]) => s));
}

export interface ExteriorRoof {
  /** Rise in 12 as typed; null takes it from the sides' measured gables. The main roof's, and every section's not set apart. */
  pitch: number | null;
  /**
   * A section's own pitch, by its key (`RoofSection.key`), set with a tap on it on the plan
   * (2026-10-14): a 4/12 garage on a 6/12 house, a 12/12 cross gable. Absent: the roof's pitch (a
   * porch or cross gable: the slope's it comes off).
   */
  sectionPitches?: Record<string, number>;
  eaveOverhangFeet: number;
  rakeOverhangFeet: number;
  /**
   * Where each overhang came from when it is not the default (2026-10-15): typed on the plan, or read
   * by the phone off Scan's roofline. Absent from an exterior saved before then: a value off the
   * default is taken as typed. The photos fill an overhang not typed (`resolvedOverhang`).
   */
  overhangSource?: { eave?: "typed" | "scan"; rake?: "typed" | "scan" };
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
  /** Of those, the ones whose ridge still runs into the roof they meet, valleys either side and no wall between (2026-10-22). */
  lowerWingsInto?: string[];
  /** Notches the roof carries over (a covered deck), each by one of its inner walls' sides. */
  coveredNotches?: string[];
  /**
   * The roof check (2026-10-16, lib/roofCheck.ts): the parts the estimator answered, "wing:<side>" and
   * "notch:<side>" - for those, the three lists above are the answer. A part not answered takes what the
   * outline and the photos propose (`roofProposal`). Absent with any of the lists set: an exterior from
   * before the check, whose lists are all there is.
   */
  answered?: string[];
  /** When the estimator said the roof's parts are right on the roof check; absent or null until then. */
  checkedAt?: string | null;
  /**
   * How far each lower roof's eave is under the eave of the roof it meets, feet, typed on the roof check
   * (2026-10-16), by the side its free end stands over. Absent: as the walls measure it where they meet,
   * else an assumed 1'6" (lib/roofCheck.ts `wingDrops`).
   */
  wingDrops?: Record<string, number>;
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
  /** Totals typed over the drawing's, or in place of one (`TypedRoofTotals`). Absent: all from the drawing. */
  typed?: TypedRoofTotals;
  /** Which of `typed` were taken off the roof report (2026-10-15); the rest are the estimator's own. */
  typedFrom?: Partial<Record<RoofTotalKey, "report">>;
  /** The roof report read, and what it offers (`RoofReport`). */
  report?: RoofReport;
  /**
   * What the drawing can't make, added on top of it (2026-10-15): dormers, turrets, a curved or flat
   * roof (lib/roofPieces.ts). Each one's quantities add to the drawing's; a typed total stands for both.
   */
  pieces?: RoofPiece[];
  /** A gambrel or mansard: a section's second, flatter pitch above a break, by its key (lib/roof.ts `RoofBreak`). */
  sectionBreaks?: Record<string, RoofBreak>;
  /**
   * Two storeys: each lower roof over the main floor against the upper floor, by the side its free
   * end stands over - a lean-to, or a ridge running out from the wall. Absent: by its shape.
   */
  lowerRoofs?: Record<string, LowerRoofKind>;
  /**
   * One slope, draining to this side (2026-10-16, a shed's roof, lib/roof.ts `RoofInput.oneSlope`): a rectangle
   * only. Absent: the roof the outline gives, gable or hip at its ends.
   */
  oneSlopeTo?: string;
}

/**
 * The upper floor of a two-storey house (2026-10-14), drawn or traced over the main floor's outline.
 * Its sides are elevations of their own: each stands on the main floor's wall below it, or on the
 * lower roof against it, and its heights are from the FLOOR LINE - the top of the main floor's walls,
 * their eave - not from the ground. The house's roof goes over it, and the main floor outside it is
 * roofed lower against its walls (lib/roof.ts).
 */
export interface UpperFloor {
  /** In order round it, as `Exterior.sides`: each next to the RIGHT of the one before, facing them from outside. */
  sides: ExteriorSide[];
  /** Where its first side's left corner stands: this far from the main floor's corner at the start of `sideId`. */
  at: { sideId: string; dx: number; dy: number };
}

/** An upper floor's walls, from the floor line to its eave, as they start out: a storey and its floor. */
export const UPPER_STOREY_FEET = 9;
/** An upper floor's corner this close to a line of the main floor's walls is on it: a wall flush with the one below. */
export const UPPER_SNAP_FEET = 1;

/** Which of the measured parts the scope prices - see `exteriorScopeLines`. */
export interface ExteriorScope {
  roofing: boolean;
  /** Side ids whose cladding is in scope. */
  sides: string[];
  soffitFascia: boolean;
  eavestrough: boolean;
  /** Decks whose lines the scope prices, by id (2026-10-20, lib/decks.ts). Absent: none. */
  decks?: string[];
}

export interface Exterior {
  /**
   * Another building on the claim (2026-10-16, lib/buildings.ts): a shed, a detached garage, a workshop, kept in
   * `Sketch.buildings` with its own id and the name the estimator gave it. Absent on the house's (`Sketch.exterior`).
   */
  id?: string;
  name?: string;
  /** In order round the house: each next side is to the RIGHT of the one before, as you face them from outside. */
  sides: ExteriorSide[];
  /** Semi-detached, a townhouse's end or middle unit (2026-10-17): a label; the sides' `shared` flags are the truth. */
  homeType?: HomeType;
  /**
   * Which way the front faces (2026-10-20): its compass bearing, degrees clockwise from north (the front is the first
   * side, along the plan's bottom). It names the report's four views north, south, east and west, and puts a north
   * arrow on the plans (lib/exteriorViews.ts). Absent: not known - the views are the front, back and sides. Another
   * building has its own.
   */
  frontFacesDeg?: number;
  /**
   * Being typed in side by side round the house and not yet back at the start (2026-10-13): the last
   * side's corner is not known until the next is added, so there is no footprint until it is closed.
   */
  open?: boolean;
  roof: ExteriorRoof;
  /** A two-storey house's upper floor (2026-10-14). Absent: one storey, or two measured as tall sides. */
  upper?: UpperFloor;
  /**
   * Its decks and porches (2026-10-20, lib/decks.ts): each against a side or free-standing, measured off the same photos
   * or typed in the quick-deck box. Absent: none - the exterior as it always was.
   */
  decks?: Deck[];
  /** Optional so an exterior drawn before the scope existed loads; absent reads as nothing in scope. */
  scope?: ExteriorScope;
  /**
   * What a scanned exterior's sizes are from (2026-10-15, lib/exteriorScale.ts): the phone's own
   * measure, a tape, or a door of a standard size. Absent: see `scaleOf`.
   */
  scale?: ExteriorScale;
  /**
   * The photo route's own inputs (2026-10-16, lib/photoRoute.ts): which photos, the shape drawn, the
   * corners tapped on them and the tapes, and what the last measure said - kept so the estimator can
   * come back, add a tape or a photo, and measure again.
   */
  photoRoute?: PhotoRouteState;
  /**
   * Where it came from when the phone measured it - see `lib/exteriorImport.ts`. `edited` is set by the
   * first change to a measurement in Scrivn; from then on it is the estimator's, and a later scan asks
   * before replacing it. Ticking what is in scope is not a change to what was measured.
   */
  source?: {
    /** "scan": Scrivn Scan measured it; "photos": the photo route in Scrivn (2026-10-16, lib/photoRoute.ts). */
    kind: "scan" | "photos";
    captureId: string | null;
    scanId: string | null;
    receivedAt: string | null;
    notes: string[];
    edited?: boolean;
    /** False when the phone's walk did not go all the way round: its sides are not yet a footprint. */
    walkClosed?: boolean;
    /** "photos": measured off ordinary photos and a few tapes, nothing tapped on the walls (2026-10-16, the photos-only route). */
    by?: "photos";
    /**
     * Finish exterior on the phone (2026-10-15, lib/exteriorFinish.ts): when the roof was read off the
     * photos there, when the estimator accepted it, and the Scrivn build the phone ran.
     */
    finish?: { at: string | null; acceptedAt: string | null; engine: string | null };
  };
}

/**
 * What the sizes of a scanned exterior are from (2026-10-15, lib/exteriorScale.ts). Every length and
 * height is the phone's own measure times `factor`; `from` says which reference that factor is.
 */
export interface ExteriorScale {
  from: "phone" | "tape" | "door";
  /** The sizes over the phone's own measure: 1 from the phone. */
  factor: number;
  /**
   * The tape kept, whichever the sizes are from: the side taped, its length on the tape, and what the
   * phone read it. Absent with "tape" from a Scan file of before 2026-10-15, which noted only the factor.
   */
  tape?: { sideId: string; feet: number; phoneFeet: number; by: "scan" | "scrivn" };
  /** With "door": the door the sizes are from (`SizeDoor.id`). */
  doorId?: string;
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

/** The part of a polygon inside a box: on a side's elevation, between two places along it and two levels. */
export function clipRect(poly: Pt[], x0: number, x1: number, y0: number, y1: number): Pt[] {
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
  /** An upper-floor side: the bottom of its cladding, left to right - the floor line, and any lower roof it stands on. */
  bottomLine?: Pt[];
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
export function elevationShape(side: ExteriorSide, roofRise: RoofRise | null = null, standsOn: RoofRise | null = null): ElevationShape {
  const L = Math.max(0, side.lengthFeet);
  const fall = side.heightsFrom !== "level" && side.eaveLeftFeet != null && side.eaveRightFeet != null ? side.eaveRightFeet - side.eaveLeftFeet : 0;
  const grade: [Pt, Pt] = [{ x: 0, y: 0 }, { x: L, y: -fall }];
  const baseL = side.base === "grade" ? 0 : side.baseLeftFeet;
  const baseR = side.base === "grade" ? 0 : side.baseRightFeet;
  // An upper-floor side stands on what is under it (`roofBaseAlongWall`): the floor line, and a lower roof where one meets it.
  const bottomLine = standsOn && standsOn.length >= 2 ? simplify(standsOn.map((b) => ({ x: clamp(b.t, 0, 1) * L, y: b.rise }))) : null;
  const bottom: [Pt, Pt] = bottomLine ? [bottomLine[0] as Pt, bottomLine[bottomLine.length - 1] as Pt] : [{ x: 0, y: baseL }, { x: L, y: -fall + baseR }];
  if (side.eaveLeftFeet == null || L <= 0) {
    return { lengthFeet: L, fallFeet: fall, eaveZ: null, grade, bottom, top: [], cladding: [], gable: null, ...(bottomLine ? { bottomLine } : {}) };
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

  const cladding = [...(bottomLine ?? bottom), ...[...top].reverse()];
  return { lengthFeet: L, fallFeet: fall, eaveZ, grade, bottom, top, cladding, gable, ...(bottomLine ? { bottomLine } : {}) };
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
  /** Its colour off the photo (2026-10-17): drawn in it. Absent: the kind's own. */
  colour?: string;
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
 * Where the ground steps (2026-10-16, the owner's side yard: "it steps down"), the parging's bottom
 * steps with it, and the step is kept upright: the ground just left of it and just right of it.
 */
function gradeFromParging(shapes: ExteriorShape[]): Pt[] | null {
  const polys = shapes.filter((s) => s.kind === "parging" && s.polygon.length >= 3).map((s) => s.polygon);
  if (polys.length === 0) return null;
  // Each corner's own x, once: a rounded one can miss the corner it came from, and the ground with it.
  const xs = polys
    .flatMap((p) => p.map((v) => v.x))
    .sort((a, b) => a - b)
    .filter((x, i, all) => i === 0 || x - (all[i - 1] as number) > 1e-6);
  const low = (x: number) => Math.min(...polys.map((p) => lowestAt(p, x)));
  const pts = xs
    .flatMap((x) => {
      const [l, r] = [low(x - 1e-5), low(x + 1e-5)];
      return Number.isFinite(l) && Number.isFinite(r) && Math.abs(l - r) > 1e-3 ? [{ x, y: l }, { x, y: r }] : [{ x, y: low(x) }];
    })
    .filter((p) => Number.isFinite(p.y));
  return pts.length >= 2 ? pts : null;
}

/**
 * A length worked out from the photos further out than this, ± percent, is marked to check (2026-10-16:
 * on the owner's photos-only house the three sides to tape were ±6, ±11 and ±12%; the rest ±2 to ±5%).
 */
export const LENGTH_CHECK_PCT = 5;

/** The ± a side's length is marked with, to check; undefined when it is taped, measured, or close enough. */
export function lengthToCheck(side: ExteriorSide): number | undefined {
  const pct = side.lengthPlusMinusPct;
  return pct !== undefined && pct > LENGTH_CHECK_PCT ? pct : undefined;
}

/**
 * The ground's height in the side's frame at x along it, as its elevation stands on it: a side tapped as
 * shapes on its parging's bottom, stepped or not (2026-10-16); any other on its grade line. What a tape
 * from the ground reads a height above, at the ends.
 */
export function groundAt(side: ExteriorSide, x: number): number {
  const line = (side.shapes ?? []).some((s) => s.polygon.length >= 2) ? gradeFromParging(side.shapes ?? []) : null;
  if (!line) return gradeAt(side, x);
  const first = line[0] as Pt;
  const last = line[line.length - 1] as Pt;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i] as Pt;
    const q = line[i + 1] as Pt;
    if (x >= p.x && x <= q.x && q.x - p.x > 1e-9) return p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
  }
  return last.y;
}

/** What an elevation drawing needs: the shape, each face of cladding, the ground, and each opening's rectangle. */
export function elevationFaces(side: ExteriorSide, roofRise: RoofRise | null = null, standsOn: RoofRise | null = null) {
  const fromShapes = (side.shapes ?? []).some((s) => s.polygon.length >= 2);
  // Tapped shapes are the face: the roof draws no gable over them.
  const shape = elevationShape(side, fromShapes ? null : roofRise, standsOn);
  const openings = side.openings.map((opening) => ({ opening, rect: openingRect(side, opening) }));
  if (fromShapes) {
    const faces: ElevationFace[] = (side.shapes ?? [])
      .filter((s) => s.polygon.length >= 2)
      .map((s) => ({ id: s.id, kind: s.kind, label: shapeLabel(s), poly: s.polygon, closed: s.closed && s.polygon.length >= 3, ...(s.colour ? { colour: s.colour } : {}) }));
    return { shape, faces, bandLines: [] as number[], grade: gradeFromParging(side.shapes ?? []) ?? [...shape.grade], openings, fromShapes };
  }
  const ranges = shape.eaveZ === null ? [] : bandRanges(side, shape.eaveZ);
  const faces: ElevationFace[] = ranges.map(({ band, lo, hi }) => ({ id: band.id, kind: band.kind, label: bandLabel(band), poly: clipLevels(shape.cladding, lo, hi), closed: true }));
  const bandLines = ranges.slice(0, -1).map((r) => r.hi).filter((v) => Number.isFinite(v));
  return { shape, faces, bandLines, grade: shape.bottomLine ? [...shape.bottomLine] : [...shape.grade], openings, fromShapes };
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
  /** The trim over it (2026-10-17): surrounds, keystones and pilasters, taken off as an opening is. Absent: none. */
  trimSquareFeet?: number;
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

/** How much two simple polygons share, square feet (2026-10-17: a read shape over a tapped one). */
export function polygonOverlap(a: Pt[], b: Pt[]): number {
  return a.length >= 3 && b.length >= 3 ? sharedArea(a, b) : 0;
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
  /** Its surrounds, keystones, columns and pilasters (2026-10-17); absent with none. */
  trim?: SideTrim;
  /** Its parging drawn as shapes (2026-10-22): the area, and the run of foundation it covers. Absent with none. */
  parging?: { squareFeet: number; linearFeet: number };
}

/** A surround round one opening, as priced. */
export interface SurroundQuantity {
  openingId: string;
  openingKind: ExteriorOpeningKind;
  material: CladdingKind;
  /** "Stucco", or what "other" is: the trim's material. */
  label: string;
  /** Its pieces as cut, each along its run: the jambs full height, the head and the sill between them. */
  linearFeet: number;
  /** Its face, pieces and the keystone's part past the head. */
  squareFeet: number;
  keystone: boolean;
  unsure?: string;
}

/** A column or pilaster, as priced. */
export interface ColumnQuantity {
  id: string;
  kind: ColumnKind;
  material: CladdingKind;
  label: string;
  /** Round its shaft where it is clad: all four faces of a column; a pilaster's face and the two returns to the wall. */
  perimeterFeet: number;
  heightFeet: number;
  /** Perimeter × height. */
  wrapSquareFeet: number;
  base: boolean;
  cap: boolean;
  unsure?: string;
}

export interface SideTrim {
  /** The trim's face where it covers the side's counted cladding, once: what comes off it. */
  squareFeet: number;
  surrounds: SurroundQuantity[];
  columns: ColumnQuantity[];
}

export function bandLabel(band: CladdingBand): string {
  return band.kind === "other" && band.label?.trim() ? band.label.trim() : CLADDING_LABEL[band.kind];
}

/**
 * A side tapped as shapes: each closed shape of cladding is its own face, its area its polygon's,
 * less every opening where it overlaps it - a window across a stucco/stone line comes out of both.
 * Parging and open shapes are not counted. The wall/gable split is the line between the two eaves.
 */
/**
 * A side's parging drawn as shapes (2026-10-22, the owner: parging "as a shape", its top following the grade): their
 * area, and the run along the wall they cover. Null with none.
 */
function pargingOf(side: ExteriorSide): { squareFeet: number; linearFeet: number } | null {
  const polys = (side.shapes ?? []).filter((s) => s.kind === "parging" && s.closed && s.polygon.length >= 3).map((s) => s.polygon);
  if (polys.length === 0) return null;
  const squareFeet = polys.reduce((sum, q) => sum + area(q), 0);
  const linearFeet = polys.reduce((sum, q) => sum + Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x)), 0);
  return squareFeet > 0.05 ? { squareFeet, linearFeet } : null;
}

function shapeQuantities(side: ExteriorSide, empty: SideQuantities): SideQuantities {
  const faces = (side.shapes ?? []).filter((s) => s.closed && s.kind !== "parging" && s.polygon.length >= 3);
  if (faces.length === 0) return empty;
  const L = Math.max(1e-9, side.lengthFeet);
  const rects = side.openings.map((o) => openingRect(side, o));
  // The trim over the wall (2026-10-17): each shape gives up what of it is under trim, the topmost shape only.
  const cover = trimCover(side);
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
    const trim = cover.length > 0 ? Math.min(Math.max(0, gross - holes), trimAreaIn(f.polygon, later.map((g) => g.polygon), cover)) : 0;
    return {
      bandId: f.id,
      kind: f.kind as CladdingKind,
      label: shapeLabel(f),
      grossSquareFeet: gross,
      openingSquareFeet: holes,
      netSquareFeet: Math.max(0, gross - holes - trim),
      ...(overlap > 1e-6 ? { overlapSquareFeet: overlap } : {}),
      ...(trim > 1e-6 ? { trimSquareFeet: trim } : {}),
    };
  });
  const zl = side.eaveLeftFeet;
  const zr = side.eaveRightFeet ?? zl;
  const gross = bands.reduce((sum, b) => sum + b.grossSquareFeet, 0);
  const holes = bands.reduce((sum, b) => sum + b.openingSquareFeet, 0);
  const trimOff = bands.reduce((sum, b) => sum + (b.trimSquareFeet ?? 0), 0);
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
    netSquareFeet: Math.max(0, gross - holes - trimOff),
    bands,
    corners: { leftFeet: zl == null ? 0 : zl - baseL, rightFeet: zr == null ? 0 : zr - baseR },
    pitchFromGable,
    gableSource: side.gable ? "measured" : null,
    ...trimOf(side, trimOff),
  };
}

/**
 * A wall shared with the neighbour's home (2026-10-17): nothing counted - no cladding, openings or trim, no
 * gable - its length kept for the plan.
 */
export function sharedSideQuantities(side: ExteriorSide): SideQuantities {
  return {
    sideId: side.id,
    name: side.name.trim() || "Side",
    complete: true,
    lengthFeet: side.lengthFeet,
    fallFeet: 0,
    wallSquareFeet: 0,
    gableSquareFeet: 0,
    grossSquareFeet: 0,
    openingSquareFeet: 0,
    netSquareFeet: 0,
    bands: [],
    openings: [],
    openingTrimFeet: 0,
    corners: { leftFeet: 0, rightFeet: 0 },
    pitchFromGable: null,
    gableSource: null,
  };
}

export function sideQuantities(side: ExteriorSide, roofRise: RoofRise | null = null, standsOn: RoofRise | null = null): SideQuantities {
  const shape = elevationShape(side, roofRise, standsOn);
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
  if ((side.shapes ?? []).length > 0) {
    const parging = pargingOf(side);
    return { ...shapeQuantities(side, empty), ...(parging ? { parging } : {}) };
  }
  if (shape.eaveZ === null || shape.cladding.length < 3) return empty;
  const eaveZ = shape.eaveZ;

  const rects = side.openings.map((o) => openingRect(side, o));
  const cover = trimCover(side);
  const bands: BandQuantities[] = bandRanges(side, eaveZ).map(({ band, lo, hi }) => {
    const part = clipLevels(shape.cladding, lo, hi);
    const gross = area(part);
    const holes = rects.reduce((s, r) => s + area(clipRect(part, r.x0, r.x1, r.y0, r.y1)), 0);
    // The trim over it (2026-10-17), taken off as the openings are.
    const trim = cover.length > 0 && part.length >= 3 ? Math.min(Math.max(0, gross - holes), trimAreaIn(part, [], cover)) : 0;
    return {
      bandId: band.id,
      kind: band.kind,
      label: bandLabel(band),
      grossSquareFeet: gross,
      openingSquareFeet: holes,
      netSquareFeet: Math.max(0, gross - holes - trim),
      ...(trim > 1e-6 ? { trimSquareFeet: trim } : {}),
    };
  });
  const wall = area(clipLevels(shape.cladding, -Infinity, eaveZ));
  const gable = area(clipLevels(shape.cladding, eaveZ, Infinity));
  const gross = bands.reduce((s, b) => s + b.grossSquareFeet, 0);
  const holes = bands.reduce((s, b) => s + b.openingSquareFeet, 0);
  const trimOff = bands.reduce((s, b) => s + (b.trimSquareFeet ?? 0), 0);

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
    netSquareFeet: Math.max(0, gross - holes - trimOff),
    bands,
    corners: { leftFeet: eaveZ - shape.bottom[0].y, rightFeet: eaveZ - shape.bottom[1].y },
    pitchFromGable,
    gableSource: shape.gable?.source ?? null,
    ...trimOf(side, trimOff),
  };
}

// ---------------------------------------------------------------------------------------------
// Trim on a side: surrounds, keystones, columns and pilasters (2026-10-17)
// ---------------------------------------------------------------------------------------------

/*
  The owner's house: dark grey field stucco with WHITE stucco trim - a wide surround round each window and garage door,
  a keystone over some, square columns with bases and caps at the porch and beside the garage doors. Each is its own
  line, and the field stucco is what is left of the wall once the openings AND the trim are off it.

  A surround is its pieces: two jambs full height, a head over the top and a sill band under the bottom between them, a
  keystone over the head. A pilaster covers the wall behind it; a column standing clear of the wall covers none of it.
  Where pieces overlap (a keystone on its head, a surround against a pilaster), the wall under them comes off once.
*/

/** How far a surround and a keystone stand out of the wall: for the drawings and the 3D view only. */
export const SURROUND_OUT_FEET = 1.5 / 12;
export const KEYSTONE_OUT_FEET = 2.5 / 12;
/** A keystone's foot as a share of its top: it narrows down to the opening, as a keystone does. */
export const KEYSTONE_FOOT = 0.6;

export type TrimPart = "jamb" | "head" | "sill" | "keystone" | "shaft" | "base" | "cap";

/** One piece of trim as drawn, in the side's frame: convex, counter-clockwise. */
export interface TrimShape {
  part: TrimPart;
  /** The opening or column it belongs to, by id. */
  of: string;
  poly: Pt[];
  material: CladdingKind;
  label: string;
  colour?: string;
  /** How far its face stands out of the wall's face. */
  outFeet: number;
  /** How far its back stands off the wall's face: 0 but for a column standing clear. */
  backFeet: number;
  /** Against the wall, covering its cladding: false for a column standing clear of it. */
  onWall: boolean;
}

const rectPoly = (x0: number, x1: number, y0: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The trim's material in words: "Stucco", or what "other" is. */
export function trimLabel(material: CladdingKind, label?: string): string {
  return material === "other" && label?.trim() ? label.trim() : CLADDING_LABEL[material];
}

/** Whether a side has any trim at all: a surround or a column. */
export function hasTrim(side: ExteriorSide): boolean {
  return side.openings.some((o) => o.trim) || (side.columns ?? []).length > 0;
}

/** An opening's surround as drawn: its pieces, then its keystone whole, over the head. */
export function surroundShapes(side: ExteriorSide, o: ExteriorOpening): TrimShape[] {
  const t = o.trim;
  if (!t) return [];
  const r = openingRect(side, o);
  const g = Math.max(0, t.gapFeet ?? 0);
  const [L, R, T, B] = [t.leftFeet, t.rightFeet, t.topFeet, t.bottomFeet].map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0)) as [number, number, number, number];
  const ix0 = r.x0 - g;
  const ix1 = r.x1 + g;
  const iy0 = B > 0 ? r.y0 - g : r.y0;
  const iy1 = r.y1 + g;
  const oy0 = iy0 - B;
  const oy1 = Math.max(iy1 + T, r.y1 + Math.max(0, t.upFeet ?? 0));
  const of = { of: o.id, material: t.material, label: trimLabel(t.material, t.label), ...(t.colour ? { colour: t.colour } : {}), outFeet: SURROUND_OUT_FEET, backFeet: 0, onWall: true };
  const out: TrimShape[] = [];
  if (L > 1e-6) out.push({ part: "jamb", poly: rectPoly(ix0 - L, ix0, oy0, oy1), ...of });
  if (R > 1e-6) out.push({ part: "jamb", poly: rectPoly(ix1, ix1 + R, oy0, oy1), ...of });
  if (T > 1e-6) out.push({ part: "head", poly: rectPoly(ix0, ix1, iy1, iy1 + T), ...of });
  if (B > 1e-6) out.push({ part: "sill", poly: rectPoly(ix0, ix1, oy0, iy0), ...of });
  const k = t.keystone;
  if (k && k.widthFeet > 1e-6 && k.heightFeet > 1e-6) {
    const xc = (r.x0 + r.x1) / 2;
    const top = k.widthFeet / 2;
    const foot = top * KEYSTONE_FOOT;
    const keystone = [
      { x: xc - foot, y: r.y1 },
      { x: xc + foot, y: r.y1 },
      { x: xc + top, y: r.y1 + k.heightFeet },
      { x: xc - top, y: r.y1 + k.heightFeet },
    ];
    out.push({ part: "keystone", poly: keystone, ...of, outFeet: KEYSTONE_OUT_FEET });
  }
  return out;
}

/** A column or pilaster as drawn: its base, shaft and cap, in the side's frame. */
export function columnShapes(side: ExteriorSide, c: SideColumn): TrimShape[] {
  const x0 = c.fromLeftFeet;
  const x1 = x0 + Math.max(0, c.widthFeet);
  const y0 = zFromGrade(side, (x0 + x1) / 2, c.footFeet);
  const y1 = y0 + Math.max(0, c.heightFeet);
  if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return [];
  const clear = c.kind === "column";
  const back = clear ? Math.max(0, c.outFeet) : 0;
  const face = clear ? back + Math.max(0, c.depthFeet) : Math.max(0, c.outFeet);
  const bh = c.base ? clamp(c.base.heightFeet, 0, y1 - y0) : 0;
  const ch = c.cap ? clamp(c.cap.heightFeet, 0, y1 - y0 - bh) : 0;
  const bo = c.base ? Math.max(0, c.base.outFeet) : 0;
  const co = c.cap ? Math.max(0, c.cap.outFeet) : 0;
  const of = { of: c.id, material: c.material, label: trimLabel(c.material, c.label), ...(c.colour ? { colour: c.colour } : {}), backFeet: back, onWall: !clear };
  const out: TrimShape[] = [];
  if (bh > 1e-6) out.push({ part: "base", poly: rectPoly(x0 - bo, x1 + bo, y0, y0 + bh), ...of, outFeet: face + bo, backFeet: clear ? Math.max(0, back - bo) : 0 });
  if (y1 - ch - (y0 + bh) > 1e-6) out.push({ part: "shaft", poly: rectPoly(x0, x1, y0 + bh, y1 - ch), ...of, outFeet: face });
  if (ch > 1e-6) out.push({ part: "cap", poly: rectPoly(x0 - co, x1 + co, y1 - ch, y1), ...of, outFeet: face + co, backFeet: clear ? Math.max(0, back - co) : 0 });
  return out;
}

/** How light a "#rrggbb" colour is, 0 to 1 (Rec. 709 weights on the sRGB values); 1 for no colour. */
export function colourLightness(hex: string | undefined): number {
  const v = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!v) return 1;
  const [r, g, b] = [v[1], v[2], v[3]].map((c) => parseInt(c as string, 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The house's colours for drawing (2026-10-17), by material: its walls' faces, and its trim apart. */
export interface HouseColours {
  faces: Partial<Record<CladdingKind | "parging", string>>;
  trim: Partial<Record<CladdingKind, string>>;
}

/**
 * Each material drawn in ONE colour round the house (2026-10-17), off what its sides' photos read: as light as the middle
 * of the reads for a wall's face, as the upper quarter for its trim - a white surround reads grey in the shade or against
 * the sun, never whiter than it is - and of the hue of the lightest read, the one in the most direct light: a wall in the
 * shade under a blue sky reads blue. So the owner's photos of the front, taken into the sun, and of the back, in it, draw
 * one dark grey stucco with white trim, and a side no photo read is drawn in them too. Null when nothing was read.
 */
export function houseColours(exterior: Exterior): HouseColours | null {
  const faces = new Map<string, string[]>();
  const trim = new Map<string, string[]>();
  for (const side of allSides(exterior)) {
    for (const s of side.shapes ?? []) if (s.colour) faces.set(s.kind, [...(faces.get(s.kind) ?? []), s.colour]);
    for (const o of side.openings) if (o.trim?.colour) trim.set(o.trim.material, [...(trim.get(o.trim.material) ?? []), o.trim.colour]);
    for (const c of side.columns ?? []) if (c.colour) trim.set(c.material, [...(trim.get(c.material) ?? []), c.colour]);
  }
  if (faces.size === 0 && trim.size === 0) return null;
  const at = (list: string[], q: number) => {
    const sorted = [...list].sort((a, b) => colourLightness(a) - colourLightness(b));
    const want = colourLightness(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]);
    const hue = sorted[sorted.length - 1] as string;
    const k = colourLightness(hue) > 1e-6 ? want / colourLightness(hue) : 1;
    const v = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hue);
    if (!v) return hue;
    return `#${[v[1], v[2], v[3]].map((c) => Math.min(255, Math.round(parseInt(c as string, 16) * k)).toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    faces: Object.fromEntries([...faces].map(([k, list]) => [k, at(list, 0.5)])),
    trim: Object.fromEntries([...trim].map(([k, list]) => [k, at(list, 0.75)])),
  };
}

/** Every piece of trim on a side as drawn: the surrounds round its openings, then its columns and pilasters. */
export function trimShapes(side: ExteriorSide): TrimShape[] {
  return [...side.openings.flatMap((o) => surroundShapes(side, o)), ...(side.columns ?? []).flatMap((c) => columnShapes(side, c))];
}

function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** The part of [poly] to the left of a → b (inside, for a counter-clockwise edge), or to its right. */
function sideOf(poly: Pt[], a: Pt, b: Pt, left: boolean): Pt[] {
  const A = b.y - a.y;
  const B = -(b.x - a.x);
  const C = A * a.x + B * a.y;
  return left ? clipHalf(poly, A, B, C) : clipHalf(poly, -A, -B, -C);
}

/** [p] cut to the convex [q]. */
function clipConvex(p: Pt[], q: Pt[]): Pt[] {
  const qq = signedArea(q) < 0 ? [...q].reverse() : q;
  let out = p;
  for (let i = 0; i < qq.length && out.length >= 3; i++) out = sideOf(out, qq[i] as Pt, qq[(i + 1) % qq.length] as Pt, true);
  return out;
}

/** The convex [p] less the convex [q], as convex pieces that do not overlap. */
function convexMinus(p: Pt[], q: Pt[]): Pt[][] {
  const qq = signedArea(q) < 0 ? [...q].reverse() : q;
  const out: Pt[][] = [];
  let rest = p;
  for (let i = 0; i < qq.length && rest.length >= 3; i++) {
    const a = qq[i] as Pt;
    const b = qq[(i + 1) % qq.length] as Pt;
    const outside = sideOf(rest, a, b, false);
    if (outside.length >= 3 && Math.abs(signedArea(outside)) > 1e-9) out.push(outside);
    rest = sideOf(rest, a, b, true);
  }
  return out;
}

/**
 * The trim that covers a side's wall, cut to the side's length (a pilaster wrapping a corner covers the next wall
 * there), as convex pieces that overlap neither each other nor an opening: what comes off the cladding, once.
 */
function trimCover(side: ExteriorSide): Pt[][] {
  if (!hasTrim(side)) return [];
  const L = Math.max(0, side.lengthFeet);
  const holes = side.openings.map((o) => {
    const r = openingRect(side, o);
    return rectPoly(r.x0, r.x1, r.y0, r.y1);
  });
  const out: Pt[][] = [];
  for (const s of trimShapes(side)) {
    if (!s.onWall) continue;
    let parts = [clipHalf(clipHalf(s.poly, -1, 0, 0), 1, 0, L)].filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 1e-9);
    for (const q of [...holes, ...out]) parts = parts.flatMap((p) => convexMinus(p, q));
    out.push(...parts);
  }
  return out;
}

/** How much of [pieces] lies on [face] and under none of the faces laid over it after ([later]). */
function trimAreaIn(face: Pt[], later: Pt[][], pieces: Pt[][]): number {
  const over = later.flatMap((g) => triangulate(g));
  let total = 0;
  for (const p of pieces) {
    let a = sharedArea(face, p);
    if (a <= 1e-9) continue;
    for (const t of over) {
      const q = clipConvex(p, t);
      if (q.length >= 3) a -= sharedArea(face, q);
    }
    total += Math.max(0, a);
  }
  return total;
}

/** A surround's run and face, as priced. */
function surroundQuantity(side: ExteriorSide, o: ExteriorOpening): SurroundQuantity | null {
  const t = o.trim;
  if (!t) return null;
  const shapes = surroundShapes(side, o);
  const pieces = shapes.filter((s) => s.part !== "keystone");
  const run = (s: TrimShape) => {
    const xs = s.poly.map((p) => p.x);
    const ys = s.poly.map((p) => p.y);
    return s.part === "jamb" ? Math.max(...ys) - Math.min(...ys) : Math.max(...xs) - Math.min(...xs);
  };
  let squareFeet = pieces.reduce((sum, s) => sum + area(s.poly), 0);
  const key = shapes.find((s) => s.part === "keystone");
  if (key) {
    // The keystone's face past the head it sits on.
    let parts = [key.poly];
    for (const s of pieces) parts = parts.flatMap((p) => convexMinus(p, s.poly));
    squareFeet += parts.reduce((sum, p) => sum + area(p), 0);
  }
  return {
    openingId: o.id,
    openingKind: o.kind,
    material: t.material,
    label: trimLabel(t.material, t.label),
    linearFeet: pieces.reduce((sum, s) => sum + run(s), 0),
    squareFeet,
    keystone: !!key,
    ...(t.unsure && !t.confirmed ? { unsure: t.unsure } : {}),
  };
}

/**
 * Round a column's shaft where it is clad: a column standing clear, all four faces; a pilaster, its face and its two
 * returns to the wall - and where it runs past an end of the side round the corner, its far face and its back there too.
 */
export function columnPerimeter(side: ExteriorSide, c: SideColumn): number {
  const w = Math.max(0, c.widthFeet);
  const d = Math.max(0, c.depthFeet, c.kind === "pilaster" ? c.outFeet : 0);
  if (c.kind === "column") return 2 * (w + d);
  const p = Math.max(0, c.outFeet);
  const a = c.fromLeftFeet;
  const L = Math.max(0, side.lengthFeet);
  const left = a < -1e-6 ? d + Math.min(-a, w) : p;
  const right = a + w > L + 1e-6 ? d + Math.min(a + w - L, w) : p;
  return w + left + right;
}

function columnQuantity(side: ExteriorSide, c: SideColumn): ColumnQuantity {
  const perimeterFeet = columnPerimeter(side, c);
  const heightFeet = Math.max(0, c.heightFeet);
  return {
    id: c.id,
    kind: c.kind,
    material: c.material,
    label: trimLabel(c.material, c.label),
    perimeterFeet,
    heightFeet,
    wrapSquareFeet: perimeterFeet * heightFeet,
    base: !!c.base && c.base.heightFeet > 0,
    cap: !!c.cap && c.cap.heightFeet > 0,
    ...(c.unsure && !c.confirmed ? { unsure: c.unsure } : {}),
  };
}

/** A side's trim as priced, and what it took off the cladding - nothing at all for a side with none. */
function trimOf(side: ExteriorSide, taken: number): Pick<SideQuantities, "trim"> {
  if (!hasTrim(side)) return {};
  const surrounds = side.openings.map((o) => surroundQuantity(side, o)).filter((q): q is SurroundQuantity => q !== null);
  const columns = (side.columns ?? []).map((c) => columnQuantity(side, c));
  return { trim: { squareFeet: taken, surrounds, columns } };
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

/** Every side of the house: the main floor's round it, then the upper floor's. */
export function allSides(exterior: Exterior): ExteriorSide[] {
  return [...exterior.sides, ...(exterior.upper?.sides ?? [])];
}

/**
 * The upper floor's outline on the main floor's plan: its sides walked as the main floor's are, set
 * where `at` says, and every corner within `UPPER_SNAP_FEET` of a line of the main floor's walls put
 * on it, so a wall flush with the one below is flush to the inch. Null with no upper floor.
 */
export function upperFootprint(exterior: Exterior, main: Footprint): Footprint | null {
  const up = exterior.upper;
  if (!up) return null;
  const own = exteriorFootprint({ sides: up.sides, roof: exterior.roof });
  if (!own.closes) return own;
  if (!main.closes) return { ...own, closes: false, corners: [], reason: "The main floor's outline has to close first: the upper floor stands on it." };
  const k = main.sideIds.indexOf(up.at.sideId);
  const origin = k >= 0 ? (main.corners[k] as Pt) : (main.corners[0] as Pt);
  const xs = main.corners.map((c) => c.x);
  const ys = main.corners.map((c) => c.y);
  const snap = (v: number, lines: number[]) => {
    const near = [...lines].sort((a, b) => Math.abs(a - v) - Math.abs(b - v))[0];
    return near !== undefined && Math.abs(near - v) <= UPPER_SNAP_FEET ? near : Math.round(v * 1e6) / 1e6;
  };
  const corners = own.corners.map((c) => ({ x: snap(c.x + origin.x + (k >= 0 ? up.at.dx : 0), xs), y: snap(c.y + origin.y + (k >= 0 ? up.at.dy : 0), ys) }));
  const n = corners.length;
  const lengths = corners.map((c, i) => Math.hypot((corners[(i + 1) % n] as Pt).x - c.x, (corners[(i + 1) % n] as Pt).y - c.y));
  if (lengths.some((l) => l < 0.01) || crossesItself(corners)) {
    return { ...own, closes: false, corners: [], reason: "The upper floor's walls, put on the main floor's, cross or close up: draw it again over the main floor." };
  }
  return { ...own, corners, lengthsFeet: lengths, areaSquareFeet: polygonArea(corners), perimeterFeet: lengths.reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------------------------------------
// The roof from the side photos (2026-10-15)
// ---------------------------------------------------------------------------------------------

/*
  What the estimator ticked off each side's photo (`ExteriorSide.roofRead`, lib/roofPhotoRead.ts),
  gathered into the roof's own numbers. The owner's rule: what is typed always wins, and the photos
  win over anything assumed.
    * PITCH, part by part: typed for that part, or for the roof; else the photo of that part's own
      gable; else the photo of the main roof's gable; else a gable measured on the phone or by hand;
      else `ASSUMED_PITCH`.
    * OVERHANGS: typed; else the photos' reads, between them; else the phone's roofline; else the default.
    * GABLE OR HIP at each end of the roof: typed (a tap on the plan); else that side's photo; else a gable.
    * THE RIDGE'S DIRECTION (2026-10-15): typed (picked on the plan); else the way that puts a roof end
      over the sides the photos show as gables or hip ends, and none over those they show as eaves;
      else along the longer walls.
    * ROOF PIECES (2026-10-15): the estimator's own; else the dormers and turrets read off the photos,
      once ticked. One changed by hand becomes the estimator's and stands in its place.
    * TWO STOREYS (2026-10-15): the upper floor is only ever drawn; the photos say one is to draw, answer
      the high-roof charge until it is, give the floor line a tall side splits at, and fill each lower
      roof's kind - lean-to or a ridge running out - under one picked on the plan.
  A read set aside counts for nothing, and a gable whose photo pitch was set aside gives none off its peak.
*/

/** Where a number the roof is built with came from. */
export type RoofSource = "typed" | "photos" | "scan" | "default";

/** One side's ticked read, by name for the notes. */
export interface PhotoRead<T> {
  sideId: string;
  name: string;
  value: T;
}

/** Every read ticked off the sides' photos, by kind. */
export interface PhotoReads {
  pitches: PhotoRead<number>[];
  rakeOverhangs: PhotoRead<number>[];
  eaveOverhangs: PhotoRead<number>[];
  ends: PhotoRead<"gable" | "hip" | "eave">[];
  /** A gambrel's or mansard's break, where a side's photo gives both its numbers. */
  breaks: PhotoRead<RoofBreak>[];
  /** What stands over each side: an upper floor flush over it, set back, or none (2026-10-15). */
  upper: PhotoRead<UpperShown>[];
  /** The upper floor's floor line on a flush wall, feet up from that side's level. */
  floorLines: PhotoRead<number>[];
  /** The roof from a side up to the upper floor's wall, by that side. */
  lowerRoofs: PhotoRead<LowerRoofKind>[];
}

export function photoReads(exterior: Exterior): PhotoReads {
  const out: PhotoReads = { pitches: [], rakeOverhangs: [], eaveOverhangs: [], ends: [], breaks: [], upper: [], floorLines: [], lowerRoofs: [] };
  for (const side of allSides(exterior)) {
    const r = side.roofRead;
    if (!r) continue;
    const at = { sideId: side.id, name: side.name.trim() || "Side" };
    if (typeof r.pitch === "number" && Number.isFinite(r.pitch)) out.pitches.push({ ...at, value: r.pitch });
    if (typeof r.rakeOverhangFeet === "number" && Number.isFinite(r.rakeOverhangFeet)) out.rakeOverhangs.push({ ...at, value: r.rakeOverhangFeet });
    if (typeof r.eaveOverhangFeet === "number" && Number.isFinite(r.eaveOverhangFeet)) out.eaveOverhangs.push({ ...at, value: r.eaveOverhangFeet });
    if (r.over) out.ends.push({ ...at, value: r.over });
    if (typeof r.upperPitch === "number" && Number.isFinite(r.upperPitch) && typeof r.breakFeet === "number" && Number.isFinite(r.breakFeet) && r.breakFeet > 0) {
      out.breaks.push({ ...at, value: { upperPitch: Math.max(0, r.upperPitch), breakFeet: r.breakFeet } });
    }
    if (r.upper) out.upper.push({ ...at, value: r.upper });
    if (typeof r.floorLineFeet === "number" && Number.isFinite(r.floorLineFeet)) out.floorLines.push({ ...at, value: r.floorLineFeet });
    if (r.lowerRoof) out.lowerRoofs.push({ ...at, value: r.lowerRoof });
  }
  return out;
}

const meanOf = (vs: number[]) => vs.reduce((s, v) => s + v, 0) / vs.length;
/** "A", "A and B", "A, B and C". */
const listWords = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** An overhang as the roof is built with it, and where it came from. */
export interface ResolvedOverhang {
  feet: number;
  source: RoofSource;
  /** The photos' reads of it: what it was taken from, or what a typed value is set over. */
  reads: PhotoRead<number>[];
  /** How far apart the photos' reads are when more than 3": they are said to disagree. */
  spread: number | null;
}

/** Photo reads of one overhang further apart than this (3") are said to disagree. */
const PHOTO_OVERHANGS_AGREE_FEET = 3 / 12;

/**
 * An overhang's value and where it came from. Typed: said so (`overhangSource`), or - an exterior from
 * before 2026-10-15 - off the default. Scan's roofline read ("scan") is under the photos.
 */
export function resolvedOverhang(exterior: Exterior, which: "eave" | "rake"): ResolvedOverhang {
  const roof = exterior.roof;
  const stored = which === "eave" ? roof.eaveOverhangFeet : roof.rakeOverhangFeet;
  const fallback = which === "eave" ? DEFAULT_EAVE_OVERHANG_FEET : DEFAULT_RAKE_OVERHANG_FEET;
  const said = roof.overhangSource?.[which];
  const reads = photoReads(exterior)[which === "eave" ? "eaveOverhangs" : "rakeOverhangs"];
  const values = reads.map((r) => r.value);
  const apart = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
  const spread = apart > PHOTO_OVERHANGS_AGREE_FEET ? apart : null;
  if (said === "typed" || (said === undefined && Math.abs(stored - fallback) > 1e-6)) return { feet: Math.max(0, stored), source: "typed", reads, spread };
  if (reads.length > 0) return { feet: meanOf(values), source: "photos", reads, spread };
  if (said === "scan") return { feet: Math.max(0, stored), source: "scan", reads, spread: null };
  return { feet: fallback, source: "default", reads, spread: null };
}

/**
 * Each end of the roof by the side it stands over: typed (a tap on the plan) over the photos, which
 * say gable or hip. The roof passes over any side that is no end of it. A photo showing a level wall
 * top - an eave - is `eaveSidesFromPhotos`: a hip only of an end over most of that side (2026-10-16).
 */
export function resolvedEnds(exterior: Exterior): Record<string, RoofEndKind> {
  const fromPhotos: Record<string, RoofEndKind> = {};
  for (const r of photoReads(exterior).ends) if (r.value !== "eave") fromPhotos[r.sideId] = r.value;
  return { ...fromPhotos, ...exterior.roof.ends };
}

/**
 * The sides whose photo shows a level wall top with the roof sloping up from it, none typed (2026-10-16):
 * an end of the roof over most of one is a hip (lib/roof.ts `eaveSides`). Until then any end over such a
 * side was - and the owner's 70' east wall, eaves over his garage and bump-out, hipped his house's gable.
 */
export function eaveSidesFromPhotos(exterior: Exterior): string[] {
  return photoReads(exterior)
    .ends.filter((r) => r.value === "eave" && !(r.sideId in exterior.roof.ends))
    .map((r) => r.sideId);
}

/**
 * The sides whose end of the roof the photos set: read off the photo as a gable or hip, not typed; or a
 * hip because its photo shows its eave and the end stands over most of it, on the roof as built [plan]
 * (worked out here when not given).
 */
export function endsFromPhotos(exterior: Exterior, plan?: RoofPlan | null): Set<string> {
  const reads = photoReads(exterior).ends.filter((r) => !(r.sideId in exterior.roof.ends));
  const out = new Set(reads.filter((r) => r.value !== "eave").map((r) => r.sideId));
  if (reads.some((r) => r.value === "eave")) {
    const built = plan === undefined ? roofAsBuilt(exterior) : plan;
    for (const e of built?.ends ?? []) if (e.fromEave) out.add(e.sideId);
  }
  return out;
}

const builtCache = new WeakMap<Exterior, { roof: ExteriorRoof; sides: ExteriorSide[]; upper: UpperFloor | undefined; got: RoofPlan | null }>();

/** The roof as the quantities build it, kept against the exterior as it was. */
function roofAsBuilt(exterior: Exterior): RoofPlan | null {
  const cached = builtCache.get(exterior);
  if (cached && cached.roof === exterior.roof && cached.sides === exterior.sides && cached.upper === exterior.upper) return cached.got;
  const footprint = exteriorFootprint(exterior);
  const pitch = exteriorPitch(exterior).value;
  const got = footprint.closes && pitch !== null ? buildRoof(roofInput(exterior, footprint, pitch)) : null;
  builtCache.set(exterior, { roof: exterior.roof, sides: exterior.sides, upper: exterior.upper, got });
  return got;
}

/** The ridge's direction the photos give: the side it is set by, and the reads it bears out. */
export interface RidgeFromPhotos {
  /** As `ExteriorRoof.ridgeAlong`: the side a rectangle's ridge runs along, or the main roof stands over. */
  ridgeAlong: string;
  /** The reads it bears out, and how many there are in all. */
  agree: PhotoRead<"gable" | "hip" | "eave">[];
  of: number;
}

const ridgeCache = new WeakMap<Exterior, { roof: ExteriorRoof; sides: ExteriorSide[]; upper: UpperFloor | undefined; got: RidgeFromPhotos | null }>();

/**
 * The ridge's direction off the photos (2026-10-15, photo-mode plan piece 4a): with none picked on the
 * plan, the roof is built each way the plan offers, and the one that puts a roof end over the most
 * sides the photos show as gables or hip ends - and none over those they show as eaves - is taken
 * when it bears out more of them than the roof worked out from the outline does. Null when nothing is
 * gained by it, or the ridge is picked.
 */
export function ridgeFromPhotos(exterior: Exterior): RidgeFromPhotos | null {
  if (exterior.roof.ridgeAlong !== null) return null;
  const cached = ridgeCache.get(exterior);
  if (cached && cached.roof === exterior.roof && cached.sides === exterior.sides && cached.upper === exterior.upper) return cached.got;
  let got: RidgeFromPhotos | null = null;
  const reads = photoReads(exterior).ends;
  const footprint = reads.length > 0 ? exteriorFootprint(exterior) : null;
  if (footprint?.closes) {
    /*
      A read of an eave agrees unless an end stands over most of its side: a long side can be eaves along
      most of it and a gable end over a stretch (2026-10-16). And a ridge that makes more of the roof sit
      lower because it has to than the outline's own does is no roof anyone frames, however many reads it
      bears out - the owner's house came out as a 13' strip from the garage's bay to the bump-out.
    */
    const bearsOut = (ridgeAlong: string | null) => {
      const plan = buildRoof(roofInputBase(exterior, footprint, ASSUMED_PITCH, ridgeAlong));
      if (plan.shape === "other") return null;
      const ends = new Map(plan.ends.map((e) => [e.sideId, e]));
      const agree = reads.filter((r) => (r.value === "eave" ? (ends.get(r.sideId)?.share ?? 0) < EAVE_END_SHARE - 1e-9 : ends.has(r.sideId)));
      return { agree, forced: plan.wings.filter((w) => w.forced).length };
    };
    const outline = bearsOut(ridgeAcrossParty(exterior));
    if (outline && outline.agree.length < reads.length) {
      for (const side of allSides(exterior)) {
        const tried = bearsOut(side.id);
        if (tried && tried.forced <= outline.forced && tried.agree.length > (got?.agree.length ?? outline.agree.length)) got = { ridgeAlong: side.id, agree: tried.agree, of: reads.length };
      }
    }
  }
  ridgeCache.set(exterior, { roof: exterior.roof, sides: exterior.sides, upper: exterior.upper, got });
  return got;
}

/** The ridge's direction the roof is built with: picked on the plan, else the photos', else across the shared walls, else by the outline (null). */
export function resolvedRidgeAlong(exterior: Exterior): string | null {
  return exterior.roof.ridgeAlong ?? ridgeFromPhotos(exterior)?.ridgeAlong ?? ridgeAcrossParty(exterior);
}

/**
 * An attached home's ridge (2026-10-17): across its shared walls, as a semi's or a row's roof most often
 * runs - a deep middle townhouse came off the photo route with its ridge front to back and rakes over its
 * front and back. The side it runs along is the longest wall square to a shared one and not shared itself,
 * of the upper floor when there is one (its roof is the house's). Null for a home with no wall shared,
 * whose ridge is the outline's to say.
 */
export function ridgeAcrossParty(exterior: Exterior): string | null {
  const shared = sharedSideIds(exterior);
  if (shared.size === 0) return null;
  const fp = exteriorFootprint(exterior);
  if (!fp.closes) return null;
  const up = exterior.upper ? upperFootprint(exterior, fp) : null;
  const ring = up?.closes ? up : fp;
  const n = ring.corners.length;
  const run = (i: number) => {
    const a = ring.corners[i] as Pt;
    const b = ring.corners[(i + 1) % n] as Pt;
    return { dx: b.x - a.x, dy: b.y - a.y, len: Math.hypot(b.x - a.x, b.y - a.y) };
  };
  const party = ring.sideIds.map((id, i) => (shared.has(id) ? run(i) : null)).filter((r) => r !== null);
  let best: { id: string; len: number } | null = null;
  for (let i = 0; i < n; i++) {
    const id = ring.sideIds[i] as string;
    if (shared.has(id)) continue;
    const r = run(i);
    const square = party.some((p) => Math.abs(r.dx * p.dx + r.dy * p.dy) < 0.1 * r.len * p.len);
    if (square && (!best || r.len > best.len + 1e-6)) best = { id, len: r.len };
  }
  return best?.id ?? null;
}

/**
 * Each lower roof's kind against the upper floor, by the side its free end stands over: picked on the
 * plan, else the photo of that side (a lean-to, or a ridge running out), else by its shape (absent).
 */
export function resolvedLowerRoofKinds(exterior: Exterior): Record<string, LowerRoofKind> {
  const fromPhotos: Record<string, LowerRoofKind> = {};
  for (const r of photoReads(exterior).lowerRoofs) fromPhotos[r.sideId] = r.value;
  return { ...fromPhotos, ...(exterior.roof.lowerRoofs ?? {}) };
}

/** The sides whose lower roof's kind the photos set: read off the photo, not picked. */
export function lowerRoofsFromPhotos(exterior: Exterior): Set<string> {
  const picked = exterior.roof.lowerRoofs ?? {};
  return new Set(photoReads(exterior).lowerRoofs.filter((r) => !(r.sideId in picked)).map((r) => r.sideId));
}

/**
 * Two storeys or more, as the photos show it (2026-10-15): yes when a ticked read shows an upper floor
 * over any side; no when the reads of two sides or more all show none; null when they don't say.
 */
export function photoStoreys(exterior: Exterior): { twoStoreys: boolean | null; reads: PhotoRead<UpperShown>[] } {
  const reads = photoReads(exterior).upper;
  const shown = reads.filter((r) => r.value !== "none");
  if (shown.length > 0) return { twoStoreys: true, reads: shown };
  return { twoStoreys: new Set(reads.map((r) => r.sideId)).size >= 2 ? false : null, reads };
}

/** The floor line the photos read on walls flush with an upper floor, between them (the median); null when none did. */
export function photoFloorLine(exterior: Exterior): { feet: number; reads: PhotoRead<number>[] } | null {
  const reads = photoReads(exterior).floorLines;
  if (reads.length === 0) return null;
  const v = reads.map((r) => r.value).sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return { feet: v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2, reads };
}

/** The pitch of the slope rising from [sideId]'s eave as the roof is built: its biggest slope's; null when none rises from it. */
export function slopePitchOver(plan: RoofPlan | null, sideId: string): number | null {
  const own = (plan?.facets ?? []).filter((f) => f.sideId === sideId).sort((a, b) => b.areaSquareFeet - a.areaSquareFeet);
  return own[0]?.pitch ?? null;
}

/** A dormer or turret read off a side's photo, on the roof as built. */
export interface PhotoRoofPiece extends ResolvedPhotoPiece {
  sideId: string;
  sideName: string;
  photo: PhotoPiece;
}

/**
 * The dormers and turrets the photos read (`SideRoofRead.pieces`), as roof pieces "from photos" on the
 * roof as built [plan] at [mainPitch]: each on the slope over its side, under the eave overhang the
 * roof has (lib/roofPhotoShapes.ts `resolvePhotoPiece`). One the estimator changed by hand is left out
 * while their own piece stands in its place.
 */
export function photoRoofPieces(exterior: Exterior, plan: RoofPlan | null, mainPitch: number): PhotoRoofPiece[] {
  const typed = new Set((exterior.roof.pieces ?? []).map((p) => p.id));
  const out: PhotoRoofPiece[] = [];
  for (const side of allSides(exterior)) {
    const onRoof = photoPieceOnRoof(exterior, plan, mainPitch, side.id);
    for (const photo of side.roofRead?.pieces ?? []) {
      if (photo.typedAs && typed.has(photo.typedAs)) continue;
      out.push({ ...onRoof(photo), sideId: side.id, sideName: side.name.trim() || "Side", photo });
    }
  }
  return out;
}

/** How a dormer or turret read off [sideId]'s photo comes out on the roof as built [plan] at [mainPitch]: on the slope over that side, under the roof's eave overhang. */
export function photoPieceOnRoof(exterior: Exterior, plan: RoofPlan | null, mainPitch: number, sideId: string): (pp: PhotoPiece) => ResolvedPhotoPiece {
  const eave = resolvedOverhang(exterior, "eave").feet;
  const slope = slopePitchOver(plan, sideId) ?? mainPitch;
  // A dormer's size rests on the slope's pitch: on an assumed one, said.
  const assumed = exteriorPitch(exterior).source === "assumed" && Math.abs(slope - mainPitch) < 1e-9;
  return (pp) => {
    const r = resolvePhotoPiece(pp, slope, eave, mainPitch);
    if (!assumed || (pp.kind !== "gableDormer" && pp.kind !== "shedDormer")) return r;
    return { ...r, checks: [`Its size is worked out on the roof's assumed ${formatPitch(slope)}: tick a gable's pitch, or type the roof's, and it follows.`, ...r.checks] };
  };
}

/** Every roof piece on the roof as built: the estimator's own, then the photos'. */
export function allRoofPieces(exterior: Exterior, plan: RoofPlan | null, mainPitch: number): RoofPiece[] {
  return [...(exterior.roof.pieces ?? []), ...photoRoofPieces(exterior, plan, mainPitch).map((p) => p.piece)];
}

/** Whether the roof has any piece at all: the estimator's, or one read off a photo. */
export function hasRoofPieces(exterior: Exterior): boolean {
  return (exterior.roof.pieces ?? []).length > 0 || allSides(exterior).some((s) => (s.roofRead?.pieces ?? []).length > 0);
}

/** The gable photos' pitches, each on the part of the roof whose gable it is. */
export interface PhotoPitches {
  /** The main roof's own gables'. */
  main: PhotoRead<number>[];
  /** Every other part's, by its key (`RoofSection.key`): a wing, a cross gable. */
  sections: Record<string, PhotoRead<number>[]>;
  /** Off sides that are no gable end of the roof as drawn: taken for the main roof, and said. */
  unplaced: PhotoRead<number>[];
  /** A gambrel's or mansard's break off a gable's photo, by the key of the part it is the gable of: "main" for the main roof and for one on no gable end. */
  breaks: Record<string, PhotoRead<RoofBreak>[]>;
}

const photoPitchCache = new WeakMap<Exterior, { roof: ExteriorRoof; sides: ExteriorSide[]; upper: UpperFloor | undefined; got: PhotoPitches }>();

/**
 * Which part of the roof each gable photo is of: the part with a gable end over that side (built
 * once at any pitch: which part stands over which side is all that is wanted), or the cross gable
 * on it. Kept against the exterior and its roof, sides and upper floor as they were.
 */
export function photoPitches(exterior: Exterior): PhotoPitches {
  const cached = photoPitchCache.get(exterior);
  if (cached && cached.roof === exterior.roof && cached.sides === exterior.sides && cached.upper === exterior.upper) return cached.got;
  const { pitches: reads, breaks } = photoReads(exterior);
  const out: PhotoPitches = { main: [], sections: {}, unplaced: [], breaks: {} };
  if (reads.length > 0 || breaks.length > 0) {
    const footprint = exteriorFootprint(exterior);
    const plan = footprint.closes ? buildRoof(roofInputBase(exterior, footprint, exterior.roof.pitch ?? (reads.length > 0 ? meanOf(reads.map((r) => r.value)) : ASSUMED_PITCH))) : null;
    const keyOf = (sideId: string): string | null => {
      const cross = (exterior.roof.additions ?? []).find((a) => a.kind === "gable" && a.sideId === sideId);
      const section = plan?.sections.find((s) => (s.loSide === sideId && s.lo === "gable") || (s.hiSide === sideId && s.hi === "gable"));
      return cross ? cross.id : (section?.key ?? null);
    };
    for (const r of reads) {
      const key = keyOf(r.sideId);
      if (key === null) out.unplaced.push(r);
      else if (key === "main") out.main.push(r);
      else (out.sections[key] ??= []).push(r);
    }
    // A break is a tent's: off a cross gable's photo it has nowhere to go; off no gable end, the main roof's, as a pitch is.
    for (const r of breaks) {
      const key = keyOf(r.sideId) ?? "main";
      if ((exterior.roof.additions ?? []).some((a) => a.id === key)) continue;
      (out.breaks[key] ??= []).push(r);
    }
  }
  photoPitchCache.set(exterior, { roof: exterior.roof, sides: exterior.sides, upper: exterior.upper, got: out });
  return out;
}

/**
 * The parts' pitches the photos give, by key - none of them for the main roof, nor while the roof's
 * pitch is typed (it is every part's not set apart), nor where a part's own is typed.
 */
export function photoSectionPitches(exterior: Exterior): Record<string, number> {
  if (exterior.roof.pitch !== null && exterior.roof.pitch >= 0) return {};
  const typed = exterior.roof.sectionPitches ?? {};
  const out: Record<string, number> = {};
  for (const [key, reads] of Object.entries(photoPitches(exterior).sections)) if (!(key in typed)) out[key] = meanOf(reads.map((r) => r.value));
  return out;
}

/**
 * The gambrel and mansard breaks the photos give, by the key of the part each is of (2026-10-15) - the
 * second pitch's order is the first's: typed for that part (`ExteriorRoof.sectionBreaks`), else its
 * gable's photo, else none (a break is never assumed). Several photos of one part: their mean.
 */
export function photoSectionBreaks(exterior: Exterior): Record<string, RoofBreak> {
  const typed = exterior.roof.sectionBreaks ?? {};
  const out: Record<string, RoofBreak> = {};
  for (const [key, reads] of Object.entries(photoPitches(exterior).breaks)) {
    if (key in typed || reads.length === 0) continue;
    out[key] = { upperPitch: meanOf(reads.map((r) => r.value.upperPitch)), breakFeet: meanOf(reads.map((r) => r.value.breakFeet)) };
  }
  return out;
}

/** Where a number came from, after it on the scope: nothing when typed or the default, as always. */
export function sourceNote(source: RoofSource): string {
  return source === "photos" ? " (from photos)" : source === "scan" ? " (read by the phone)" : "";
}

/** What the plan says of the photos' reads: where they disagree, and where something typed is set over them. */
export function photoNotes(exterior: Exterior): string[] {
  const notes: string[] = [];
  const list = (rs: PhotoRead<number>[], f: (v: number) => string) => rs.map((r) => `${f(r.value)} (${r.name})`).join(", ");
  const pp = photoPitches(exterior);
  const main = pp.main.length > 0 ? pp.main : pp.unplaced;
  if (main.length > 1 && Math.max(...main.map((r) => r.value)) - Math.min(...main.map((r) => r.value)) > 0.5) {
    notes.push(`The gables' photos read ${list(main, formatPitch)}: if they are one roof, check them, or give each part its own pitch (Pitch, on the plan).`);
  }
  if (pp.unplaced.length > 0) {
    notes.push(`${list(pp.unplaced, formatPitch)}: the photo shows a gable, but the roof is drawn with no gable end over ${pp.unplaced.length === 1 ? "that side" : "those sides"}. Check the ridge's direction, or the gable or hip at each end.`);
  }
  // The ridge turned to the photos (2026-10-15): said, with what it rests on.
  const ridge = ridgeFromPhotos(exterior);
  if (ridge) {
    const ends = ridge.agree.filter((r) => r.value !== "eave").map((r) => r.name);
    const eaves = ridge.agree.filter((r) => r.value === "eave").map((r) => r.name);
    const words = [ends.length > 0 ? `${listWords(ends)} ${ends.length === 1 ? "shows" : "show"} a roof end` : "", eaves.length > 0 ? `${listWords(eaves)} ${eaves.length === 1 ? "shows" : "show"} an eave` : ""].filter(Boolean).join(", and ");
    notes.push(`The ridge is set from the photos: ${words}.${ridge.agree.length < ridge.of ? ` ${ridge.of - ridge.agree.length} of the photos' reads still don't fit: check them.` : ""} Pick the ridge below to set it yourself.`);
  }
  const typedPitch = exterior.roof.pitch !== null && exterior.roof.pitch >= 0 ? exterior.roof.pitch : null;
  if (typedPitch !== null) {
    const all = [...pp.main, ...pp.unplaced, ...Object.values(pp.sections).flat()];
    const off = all.filter((r) => Math.abs(r.value - typedPitch) > 0.25);
    if (off.length > 0) notes.push(`The pitch is typed at ${formatPitch(typedPitch)}, and that is used; the photos read ${list(off, formatPitch)}. Give a part its own pitch on the plan to use its photo's.`);
  }
  for (const which of ["eave", "rake"] as const) {
    const o = resolvedOverhang(exterior, which);
    if (o.source === "photos" && o.spread !== null) notes.push(`The photos read the ${which} overhang ${list(o.reads, formatFeetInches)}; the roof is drawn at ${formatFeetInches(o.feet)} between them. Set aside the read that is off, on its side, or type it.`);
    if (o.source === "typed" && o.reads.length > 0 && Math.abs(meanOf(o.reads.map((r) => r.value)) - o.feet) > PHOTO_OVERHANGS_AGREE_FEET) {
      notes.push(`The ${which} overhang is typed at ${formatFeetInches(o.feet)}; the photos read ${list(o.reads, formatFeetInches)}.`);
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------------------------
// Pitch, roof and everything together
// ---------------------------------------------------------------------------------------------

export interface PitchReading {
  /** Never null since 2026-10-13: with nothing typed or measured it is `ASSUMED_PITCH`. */
  value: number | null;
  source: "typed" | "photos" | "sides" | "assumed" | null;
  /** Each side with a gable measured on the phone or by hand, and the pitch it gives - not one read off its photo. */
  fromSides: { sideId: string; name: string; pitch: number }[];
  /** The gable photos the main roof's pitch is read off (2026-10-15). */
  fromPhotos: PhotoRead<number>[];
}

/**
 * The pitch the main roof is built at: as typed, else the photos of its gables, else the mean of what
 * the measured gables give, else `ASSUMED_PITCH` - so the roof is there as soon as the footprint
 * closes, said to be assumed. A side whose photo was read for the roof gives its pitch as a photo, or
 * - set aside - none at all.
 */
export function exteriorPitch(exterior: Exterior): PitchReading {
  const fromSides = allSides(exterior)
    .filter((side) => side.roofRead?.pitch === undefined)
    .map((side) => ({ side, q: sideQuantities(side) }))
    .filter(({ q }) => q.pitchFromGable !== null)
    .map(({ side, q }) => ({ sideId: side.id, name: side.name, pitch: q.pitchFromGable as number }));
  const pp = photoPitches(exterior);
  const fromPhotos = pp.main.length > 0 ? pp.main : pp.unplaced;
  if (exterior.roof.pitch !== null && exterior.roof.pitch >= 0) return { value: exterior.roof.pitch, source: "typed", fromSides, fromPhotos };
  if (fromPhotos.length > 0) return { value: meanOf(fromPhotos.map((r) => r.value)), source: "photos", fromSides, fromPhotos };
  if (fromSides.length > 0) return { value: fromSides.reduce((s, f) => s + f.pitch, 0) / fromSides.length, source: "sides", fromSides, fromPhotos };
  return { value: ASSUMED_PITCH, source: "assumed", fromSides, fromPhotos };
}

/**
 * The roof's input with everything but the photos' part pitches: what tells which part is over which
 * side. [ridgeAlong] is the ridge's direction, as resolved unless given (`ridgeFromPhotos` tries each).
 * The parts not answered on the roof check are as proposed (`roofProposal`, 2026-10-16).
 */
function roofInputBase(exterior: Exterior, footprint: Footprint, pitch: number, ridgeAlong: string | null = resolvedRidgeAlong(exterior)): RoofInput {
  const said = saidRoofInput(exterior, footprint, pitch, ridgeAlong);
  const proposal = roofProposal(exterior);
  return proposal ? { ...said, coveredNotches: proposal.coveredNotches, lowerWings: proposal.lowerWings, wingGables: proposal.wingGables } : said;
}

/** The roof's input as said: typed, read off the photos, and the parts as answered - nothing proposed. */
function saidRoofInput(exterior: Exterior, footprint: Footprint, pitch: number, ridgeAlong: string | null): RoofInput {
  const upper = upperFootprint(exterior, footprint);
  const eaveSides = eaveSidesFromPhotos(exterior);
  return {
    ...(upper?.closes ? { upper: { corners: upper.corners, sideIds: upper.sideIds }, lowerRoofKinds: resolvedLowerRoofKinds(exterior) } : {}),
    corners: footprint.corners,
    sideIds: footprint.sideIds,
    pitch,
    eaveOverhangFeet: resolvedOverhang(exterior, "eave").feet,
    rakeOverhangFeet: resolvedOverhang(exterior, "rake").feet,
    ridgeAlong,
    ends: resolvedEnds(exterior),
    ...(eaveSides.length > 0 ? { eaveSides } : {}),
    ...(sharedSides(exterior).length > 0 ? { sharedSides: sharedSides(exterior).map((x) => x.id) } : {}),
    sectionPitches: exterior.roof.sectionPitches ?? {},
    ...(exterior.roof.sectionBreaks ? { sectionBreaks: exterior.roof.sectionBreaks } : {}),
    additions: exterior.roof.additions ?? [],
    lowerWings: exterior.roof.lowerWings ?? [],
    wingGables: exterior.roof.wingGables ?? [],
    ...((exterior.roof.lowerWingsInto ?? []).length > 0 ? { lowerWingsInto: exterior.roof.lowerWingsInto, wingDropsFeet: exterior.roof.wingDrops ?? {} } : {}),
    coveredNotches: exterior.roof.coveredNotches ?? [],
    sideNames: Object.fromEntries(allSides(exterior).map((s) => [s.id, s.name.trim() || "Side"])),
    ...(exterior.roof.oneSlopeTo ? { oneSlope: exterior.roof.oneSlopeTo } : {}),
  };
}

/**
 * Each side's eave as measured above the ground under each of its ends, left and right (2026-10-16): where
 * two walls meet at a corner the ground under them is the same, so there their eaves compare - whatever
 * ground each wall's own heights are from. A side whose height came from the sides beside it, or that has
 * none, says nothing - nor, on the photo route, one still at the route's 10' it starts every side at,
 * neither read off its photo nor typed (session A, 10-16).
 */
export function measuredSideEnds(exterior: Exterior): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  const placeholders = exterior.source?.kind === "photos";
  for (const s of exterior.sides) {
    if (s.shared || s.wallTopFrom === "neighbours" || s.eaveLeftFeet == null || s.lengthFeet <= 0) continue;
    if (placeholders && s.wallTopFrom !== "photo" && s.eaveLeftFeet === DEFAULT_EAVE_FEET && s.eaveRightFeet === DEFAULT_EAVE_FEET) continue;
    const right = s.eaveRightFeet ?? s.eaveLeftFeet;
    // Heights from one level: the eave is the higher reading, as the 3D view takes it - a lower one is a stray tap.
    const [l, r] = s.heightsFrom === "level" ? [Math.max(s.eaveLeftFeet, right), Math.max(s.eaveLeftFeet, right)] : [s.eaveLeftFeet, right];
    const above = (x: number, eave: number) => zFromGrade(s, x, eave) - groundAt(s, x);
    const ends: [number, number] = [above(0, l), above(s.lengthFeet, r)];
    if (ends.every((v) => Number.isFinite(v) && v > 0)) out[s.id] = ends;
  }
  return out;
}

/**
 * Each lower roof's eave under the eave of the roof it meets, on the roof [plan] built from [input]
 * (lib/roofCheck.ts `wingDrops`): typed, else measured where their walls meet, else an assumed 1'6".
 */
export function exteriorWingDrops(exterior: Exterior, input: RoofInput, plan: RoofPlan): Record<string, WingDrop> {
  return wingDrops(input, plan, { ends: measuredSideEnds(exterior) }, exterior.roof.wingDrops ?? {});
}

/**
 * The pitch the roof check proposes on (no roof built for it, so no part's own pitch): typed, else the
 * photos' gables, else the measured gables, else assumed.
 */
function proposalPitch(exterior: Exterior): number {
  if (exterior.roof.pitch !== null && exterior.roof.pitch >= 0) return exterior.roof.pitch;
  const read = photoReads(exterior).pitches;
  if (read.length > 0) return meanOf(read.map((r) => r.value));
  const sides = exterior.sides.filter((s) => s.roofRead?.pitch === undefined).map((s) => sideQuantities(s).pitchFromGable).filter((p): p is number => p !== null);
  return sides.length > 0 ? meanOf(sides) : ASSUMED_PITCH;
}

const proposalCache = new WeakMap<Exterior, { roof: ExteriorRoof; sides: ExteriorSide[]; upper: UpperFloor | undefined; got: RoofProposal | null }>();

/**
 * The roof check's proposal (2026-10-16, lib/roofCheck.ts): the notches to cover and the wings to set
 * lower, over what is answered. Only for a house that was photographed - the photo route, where the
 * estimator never drew the roof - and one storey; never for a roof from before the check, whose lists
 * are all it says. Null when there is nothing to propose on.
 */
export function roofProposal(exterior: Exterior): RoofProposal | null {
  const cached = proposalCache.get(exterior);
  if (cached && cached.roof === exterior.roof && cached.sides === exterior.sides && cached.upper === exterior.upper) return cached.got;
  let got: RoofProposal | null = null;
  const photographed = exterior.sides.some((s) => (s.photos?.length ?? 0) > 0 || s.roofRead !== undefined);
  if (photographed && !exterior.upper && !isLegacyRoof(exterior.roof)) {
    const footprint = exteriorFootprint(exterior);
    if (footprint.closes) {
      got = proposeRoof(saidRoofInput(exterior, footprint, proposalPitch(exterior), exterior.roof.ridgeAlong ?? ridgeAcrossParty(exterior)), {
        ends: measuredSideEnds(exterior),
        garageSides: exterior.sides.filter((s) => s.openings.some((o) => o.kind === "garage" || o.kind === "rollup")).map((s) => s.id),
        answered: exterior.roof.answered ?? [],
      });
    }
  }
  proposalCache.set(exterior, { roof: exterior.roof, sides: exterior.sides, upper: exterior.upper, got });
  return got;
}

/**
 * A two-storey house's floor line and a split-level's lower roofs over it (2026-10-19, `splitLevels`), off the main
 * sides' eave readings - a side read level takes its higher, as the 3D view reads it - on the roof [plan] built.
 */
export function splitLevelHeights(exterior: Exterior, footprint: Footprint, plan: RoofPlan): { floorLine: number | null; lifts: Record<number, number> } {
  if (!exterior.upper || !footprint.closes) return { floorLine: null, lifts: {} };
  const byId = new Map(exterior.sides.map((s) => [s.id, s]));
  return splitLevels(
    footprint.corners,
    plan.sections,
    footprint.sideIds.map((id) => {
      const s = byId.get(id);
      if (!s || s.eaveLeftFeet == null) return null;
      const right = s.eaveRightFeet ?? s.eaveLeftFeet;
      const high = Math.max(s.eaveLeftFeet, right);
      return s.heightsFrom === "level" ? [high, high] : [s.eaveLeftFeet, right];
    }),
  );
}

/** The roof's input: the overhangs and ends as typed, else read off the photos; each part's pitch, and any break, as typed, else its gable photo's. */
export function roofInput(exterior: Exterior, footprint: Footprint, pitch: number): RoofInput {
  const base = roofInputBase(exterior, footprint, pitch);
  const fromPhotos = photoSectionPitches(exterior);
  const withPitches = Object.keys(fromPhotos).length > 0 ? { ...base, sectionPitches: { ...fromPhotos, ...base.sectionPitches } } : base;
  // A gambrel's or mansard's break the same way: typed, else its gable's photo.
  const breaksFromPhotos = photoSectionBreaks(exterior);
  return Object.keys(breaksFromPhotos).length > 0 ? { ...withPitches, sectionBreaks: { ...breaksFromPhotos, ...(base.sectionBreaks ?? {}) } } : withPitches;
}

export interface CladdingTotal {
  /** The kind, or "other: <label>" kept apart per label. */
  key: string;
  kind: CladdingKind;
  label: string;
  grossSquareFeet: number;
  openingSquareFeet: number;
  netSquareFeet: number;
  /** The trim over it (2026-10-17), taken off; absent with none. */
  trimSquareFeet?: number;
}

/**
 * The house's trim as priced (2026-10-17): its surrounds by material and the kind of opening, its keystones, its columns
 * and pilasters by material - each a line of its own.
 */
export interface TrimTotals {
  /** What it took off the cladding, every side. */
  squareFeet: number;
  surrounds: { label: string; material: CladdingKind; openingKind: ExteriorOpeningKind; count: number; linearFeet: number; squareFeet: number; keystones: number }[];
  keystones: number;
  columns: { label: string; material: CladdingKind; kind: ColumnKind; count: number; wrapSquareFeet: number; caps: number; bases: number }[];
}

/** The sides' trim added up, grouped as the scope prices it; null with none. */
export function trimTotals(sides: SideQuantities[]): TrimTotals | null {
  const withTrim = sides.filter((s) => s.trim);
  if (withTrim.length === 0) return null;
  const surrounds = new Map<string, TrimTotals["surrounds"][number]>();
  const columns = new Map<string, TrimTotals["columns"][number]>();
  for (const s of withTrim) {
    const t = s.trim as SideTrim;
    for (const q of t.surrounds) {
      const key = `${q.label.toLowerCase()}:${q.openingKind}`;
      const g = surrounds.get(key) ?? { label: q.label, material: q.material, openingKind: q.openingKind, count: 0, linearFeet: 0, squareFeet: 0, keystones: 0 };
      g.count += 1;
      g.linearFeet += q.linearFeet;
      g.squareFeet += q.squareFeet;
      if (q.keystone) g.keystones += 1;
      surrounds.set(key, g);
    }
    for (const c of t.columns) {
      const key = `${c.label.toLowerCase()}:${c.kind}`;
      const g = columns.get(key) ?? { label: c.label, material: c.material, kind: c.kind, count: 0, wrapSquareFeet: 0, caps: 0, bases: 0 };
      g.count += 1;
      g.wrapSquareFeet += c.wrapSquareFeet;
      if (c.cap) g.caps += 1;
      if (c.base) g.bases += 1;
      columns.set(key, g);
    }
  }
  // Windows, doors, garage doors, roll-up doors; pilasters before columns, as the house is walked.
  const ORDER: Record<ExteriorOpeningKind, number> = { window: 0, door: 1, garage: 2, rollup: 3 };
  const list = [...surrounds.values()].sort((a, b) => a.label.localeCompare(b.label) || ORDER[a.openingKind] - ORDER[b.openingKind]);
  const cols = [...columns.values()].sort((a, b) => a.label.localeCompare(b.label) || (a.kind === b.kind ? 0 : a.kind === "pilaster" ? -1 : 1));
  return {
    squareFeet: withTrim.reduce((sum, s) => sum + (s.trim as SideTrim).squareFeet, 0),
    surrounds: list,
    keystones: list.reduce((n, g) => n + g.keystones, 0),
    columns: cols,
  };
}

/** A slope of the roof as the estimate sees it. */
export interface SlopeQuantity {
  key: string;
  label: string;
  /** Its own pitch, rise in 12. */
  pitch: number;
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
  /** The main roof's pitch read off its gables' photos (2026-10-15): said on the scope. */
  pitchFromPhotos: boolean;
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
  /** Where the roof is cut by a party line over a shared wall (2026-10-17): the firewall's cap and flashing, not priced here. */
  partyFeet: number;
  dripEdgeFeet: number;
  starterFeet: number;
  iceWaterFeet: number;
  /** Metal: foam closure at the eaves and on both sides of the ridge. */
  closureFeet: number;
  ridgeVentFeet: number;
  /** "7/12 to 9/12" and up: the steepest band the chosen slopes are in, for the steep charge. */
  steep: string | null;
  /**
   * The squares being roofed by pitch, steepest first - one entry for a roof of one pitch. A typed
   * area is shared out as the drawing's slopes are; with no drawing, all of it at the roof's pitch.
   */
  byPitch: { pitch: number; areaSquareFeet: number; squares: number; assumed: boolean; fromPhotos: boolean }[];
  /** The squares on a curved roof piece, which has no one pitch (and so no steep charge); null with none. */
  curved: { areaSquareFeet: number; squares: number } | null;
  /**
   * The roof pieces on top of the drawing (2026-10-15, lib/roofPieces.ts): each with its figures, and
   * what they add to each total - nothing to one that is typed, which stands for them too.
   */
  pieces: {
    /** The ones that count: typed, or proposed off the photos and ticked. */
    list: { piece: RoofPiece; figures: PieceFigures }[];
    /** Proposed off the photos and not ticked: counted nowhere until they are. */
    offered: { piece: RoofPiece; figures: PieceFigures }[];
    added: Record<RoofTotalKey, number>;
    /** Of `added`, what came from pieces off the photos. */
    addedFromPhotos: Record<RoofTotalKey, number>;
    /** Dormers' cheeks and faces, gross. */
    sidingSquareFeet: number;
  };
  /** The steep charge band by band, on the squares of the slopes in each. */
  steepBands: { band: string; squares: number }[];
  /**
   * The high-roof charge: on the roof over a drawn upper floor by itself (automatic), else on the
   * whole roof when two storeys or more was answered yes; null when it isn't charged.
   */
  high: { squares: number; automatic: boolean; fromPhotos?: boolean } | null;
  /** Two storeys or more as the photos answer it, with no upper floor drawn and nothing answered (2026-10-15); null when they don't say. */
  highFromPhotos: { twoStoreys: boolean; sides: string[] } | null;
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
  /** The overhangs the soffit is priced at, and where each came from (2026-10-15). */
  overhangs: { eave: ResolvedOverhang; rake: ResolvedOverhang };
  fasciaFeet: number;
  /** What is still to be answered before each part can be priced: never taken as a no. */
  toAnswer: { roofing: string[]; eavestrough: string[]; soffitFascia: string[] };
  /** A roof drawn over a closed outline to read from; false for totals typed with no outline. */
  drawn: boolean;
  /** Anything typed over the drawing: the lines then say where each number came from. */
  typed: boolean;
  /** Where each total came from. */
  from: Record<RoofTotalKey, TotalSource>;
  /** Where the eavestrough's, soffit's and fascia's eaves and rakes came from: typed only when every eave and rake is chosen. */
  edgesFrom: { eave: TotalSource; rake: TotalSource };
  /** The drawing's own figure for each total, for the boxes to show beside the typed one; null with no drawing. */
  drawing: Record<RoofTotalKey, number> | null;
  /** The roof report any total was taken from, as the documents name it (`reportLabel`); null when none was. */
  report: { label: string | null; fileName: string } | null;
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

/**
 * The roof as priced: the slopes chosen on the plan, the eaves and rakes chosen for the eavestrough,
 * and the owner's list of questions - with any total the estimator typed in place of the drawing's
 * (`ExteriorRoof.typed`). With no drawing (`roof` null) the typed totals are all there is.
 */
export function roofingQuantities(exterior: Exterior, roof: RoofPlan | null, pitch: PitchReading = exteriorPitch(exterior)): RoofingQuantities {
  const R = exterior.roof;
  const pitchAssumed = pitch.source === "assumed";
  const pitchFromPhotos = pitch.source === "photos";
  const roofPitch = roof?.pitch ?? pitch.value ?? ASSUMED_PITCH;
  // The pitches the photos gave: the main roof's, and each part's whose own was read off its gable.
  const photoPitchValues = [...(pitchFromPhotos ? [roofPitch] : []), ...Object.values(photoSectionPitches(exterior)), ...Object.values(photoSectionBreaks(exterior)).map((b) => b.upperPitch)];
  const overhangs = { eave: resolvedOverhang(exterior, "eave"), rake: resolvedOverhang(exterior, "rake") };
  const sideById = new Map(exterior.sides.map((s) => [s.id, s]));
  const slopeChosen = (key: string) => R.slopes == null || R.slopes.includes(key);
  const facets = roof?.facets ?? [];
  const slopes: SlopeQuantity[] = facets.map((f) => ({
    key: f.key,
    label: f.label,
    pitch: f.pitch,
    faces: (f.sideId !== null ? sideById.get(f.sideId)?.name.trim() : "") || "",
    planSquareFeet: f.planSquareFeet,
    areaSquareFeet: f.areaSquareFeet,
    selected: slopeChosen(f.key),
  }));
  const noSlopes = facets.length === 0;
  const allSlopes = noSlopes || slopes.every((s) => s.selected);
  const touches = (keys: string[]) => noSlopes || keys.some(slopeChosen);
  const t: Record<RoofLineKind, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, headwall: 0, step: 0, party: 0 };
  for (const l of roof?.lines ?? []) if (touches(l.facets)) t[l.kind] += l.feet;
  const ridgeVentFeet = (roof?.lines ?? []).filter((l) => l.kind === "ridge" && (R.ridgeVents ?? []).includes(l.key)).reduce((s, l) => s + l.feet, 0);

  // Each total: typed, else the drawing's; drip edge, starter and ice & water follow what they are made of unless typed.
  const drawing: Record<RoofTotalKey, number> | null = roof
    ? {
        squareFeet: noSlopes ? roof.areaSquareFeet : slopes.filter((s) => s.selected).reduce((sum, s) => sum + s.areaSquareFeet, 0),
        ridge: t.ridge,
        hip: t.hip,
        valley: t.valley,
        eave: t.eave,
        rake: t.rake,
        step: t.step,
        headwall: t.headwall,
        dripEdge: t.eave + t.rake,
        starter: t.eave,
        iceWater: t.eave + t.valley,
      }
    : null;
  // The pieces on top of the drawing, each worked out on its own (lib/roofPieces.ts), and what they come to together: the estimator's, then the photos' (2026-10-15).
  const everyPiece = allRoofPieces(exterior, roof, roofPitch);
  const pieceList = everyPiece.filter(pieceCounts).map((piece) => ({ piece, figures: pieceFigures(piece, roofPitch) }));
  // Proposed off the photos and not yet ticked: offered beside the plan, counted nowhere.
  const offered = everyPiece.filter((piece) => !pieceCounts(piece)).map((piece) => ({ piece, figures: pieceFigures(piece, roofPitch) }));
  const sumOf = (list: { figures: PieceFigures }[]) => {
    const sum: Record<RoofTotalKey, number> = { squareFeet: 0, ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, step: 0, headwall: 0, dripEdge: 0, starter: 0, iceWater: 0 };
    for (const { figures } of list) {
      sum.squareFeet += figures.squareFeet;
      for (const k of PIECE_LENGTH_KEYS) sum[k] += figures.lengths[k];
      sum.dripEdge += figures.dripEdgeFeet;
    }
    return sum;
  };
  const pieceSum = sumOf(pieceList);
  // The part of it off the photos (ticked proposals), for the lines to say so.
  const photoSum = sumOf(pieceList.filter((x) => pieceFromPhotos(x.piece)));
  // With no drawing, a total the pieces give is the estimator's own numbers worked out.
  const piecesFrom: TotalSource = roof ? "drawing" : "estimator";

  // A total typed stands for the drawing and the pieces alike (a roof report counts its dormers); blank, it is the two added.
  const value = {} as Record<RoofTotalKey, number>;
  const from = {} as Record<RoofTotalKey, TotalSource>;
  const added = {} as Record<RoofTotalKey, number>;
  const addedFromPhotos = {} as Record<RoofTotalKey, number>;
  for (const k of ["squareFeet", "ridge", "hip", "valley", "eave", "rake", "step", "headwall"] as const) {
    const typed = typedTotal(R, k);
    added[k] = typed === null ? pieceSum[k] : 0;
    addedFromPhotos[k] = typed === null ? photoSum[k] : 0;
    value[k] = typed ?? (drawing?.[k] ?? 0) + added[k];
    from[k] = typed !== null ? typedSource(R, k) : added[k] !== 0 ? piecesFrom : "drawing";
  }
  const madeOf = (k: "dripEdge" | "starter" | "iceWater", parts: RoofTotalKey[]) => {
    const typed = typedTotal(R, k);
    // A flat piece's edge said to be a drip edge alone is drip edge of its own, not an eave.
    const own = pieceSum[k];
    added[k] = typed === null ? parts.reduce((s, p) => s + added[p], 0) + own : 0;
    addedFromPhotos[k] = typed === null ? parts.reduce((s, p) => s + addedFromPhotos[p], 0) + photoSum[k] : 0;
    value[k] = typed ?? parts.reduce((s, p) => s + value[p], 0) + own;
    from[k] = typed !== null ? typedSource(R, k) : sourceOfParts(...parts.map((p): [number, TotalSource] => [value[p], from[p]]), ...(own > 0 ? [[own, piecesFrom] as [number, TotalSource]] : []));
  };
  madeOf("dripEdge", ["eave", "rake"]);
  madeOf("starter", ["eave"]);
  madeOf("iceWater", ["eave", "valley"]);

  // The eavestrough, soffit and fascia run along the eaves and rakes chosen, slopes or no slopes - or, with
  // every one chosen, along the eaves and rakes typed.
  const chosenEdges = R.edges ?? null;
  const edgeChosen = (key: string) => chosenEdges === null || chosenEdges.includes(key);
  // Flashing takes no eavestrough, soffit or fascia, so it is never one to choose.
  const allEdges = (roof?.edges ?? []).filter((e) => e.kind === "eave" || e.kind === "rake").every((e) => edgeChosen(e.key));
  const typedEave = allEdges ? typedTotal(R, "eave") : null;
  const typedRake = allEdges ? typedTotal(R, "rake") : null;
  const runs = roof ? gutterRuns(roof, chosenEdges) : [];
  const drawnGutter = runs.reduce((s, r) => s + r.feet, 0);
  const gutterFeet = typedEave ?? drawnGutter;
  const counted = R.downspouts === null;
  // Counted run by run on the drawing, each run scaled to the eaves typed; with no drawing, on the typed eaves alone.
  const scale = typedEave !== null && drawnGutter > 0 ? typedEave / drawnGutter : 1;
  const byRule =
    runs.length > 0
      ? runs.reduce((s, r) => s + Math.max(1, Math.ceil((r.feet * scale) / FEET_PER_DOWNSPOUT - 1e-9)), 0)
      : gutterFeet > 0
        ? Math.max(1, Math.ceil(gutterFeet / FEET_PER_DOWNSPOUT - 1e-9))
        : 0;
  const downspouts = counted ? byRule : Math.max(0, Math.round(R.downspouts as number));
  // Each run down from its own eave: the eave height of the side under it, by length; with no runs, the sides' own.
  // An upper floor's side reads its eave from the floor line (2026-10-19): its run comes down from the floor line and that.
  const upperById = new Map((exterior.upper?.sides ?? []).map((s) => [s.id, s]));
  const floorLine = upperById.size > 0 && roof ? splitLevelHeights(exterior, exteriorFootprint(exterior), roof).floorLine : null;
  const runEave = (id: string): number | null => {
    const up = upperById.get(id);
    if (!up) return sideEave(sideById.get(id));
    const h = sideEave(up);
    return h !== null && floorLine !== null ? floorLine + h : null;
  };
  let heightFeet = 0;
  let heightOver = 0;
  for (const run of runs) {
    for (const e of run.edges) {
      const h = e.sideId !== null ? runEave(e.sideId) : null;
      if (h === null) continue;
      heightFeet += h * e.planFeet;
      heightOver += e.planFeet;
    }
  }
  if (heightOver === 0) {
    for (const s of exterior.sides) {
      const h = sideEave(s);
      if (h === null) continue;
      heightFeet += h;
      heightOver += 1;
    }
  }
  const eaveHeight = heightOver > 0 ? heightFeet / heightOver : null;
  const typedFeet = R.downspoutFeet != null && R.downspoutFeet >= 0;
  const downspoutFeet = typedFeet ? (R.downspoutFeet as number) : eaveHeight === null ? null : downspouts * eaveHeight * DOWNSPOUT_ALLOWANCE;

  const soffitEave = typedEave ?? (roof?.edges ?? []).filter((e) => e.kind === "eave" && edgeChosen(e.key)).reduce((s, e) => s + e.planFeet, 0);
  const soffitRake = typedRake ?? (roof?.edges ?? []).filter((e) => e.kind === "rake" && edgeChosen(e.key)).reduce((s, e) => s + e.feet, 0);
  const material = R.material ?? null;

  const roofingQs: string[] = [];
  if (!roof && typedTotal(R, "squareFeet") === null) roofingQs.push("the roof's squares (type them, or draw the outline)");
  if (pitchAssumed) roofingQs.push(`the pitch (${formatPitch(roofPitch)} is assumed)`);
  if (material === null) roofingQs.push("the roofing material");
  if (R.dripEdge == null) roofingQs.push("drip edge, yes or no");
  if (R.underlayment == null) roofingQs.push("underlayment: synthetic, felt or none");
  // A drawn upper floor answers it: the roof over it is the high one.
  const upperKeys = new Set((roof?.sections ?? []).filter((x) => x.floor === "upper").map((x) => x.key));
  const twoStorey = upperKeys.size > 0;
  // Not drawn and not answered: the photos answer it (2026-10-15) - an upper floor over any side, or none over two sides or more.
  const storeysRead = R.high == null && !twoStorey ? photoStoreys(exterior) : null;
  const highFromPhotos = storeysRead?.twoStoreys ?? null;
  if (R.high == null && !twoStorey && highFromPhotos === null) roofingQs.push("two storeys or higher, yes or no");
  if (R.handload == null) roofingQs.push("handload materials, yes or no");
  if (R.disposalHandload == null) roofingQs.push("handload to disposal, yes or no");
  if (R.chimney == null) roofingQs.push("chimney flashing: none, small, medium or large");
  if (R.vents === undefined) roofingQs.push("how many roof vents (0 if none)");
  if (R.pipeJacks === undefined) roofingQs.push("how many pipe jacks (0 if none)");
  if (R.ridgeVents === undefined && (roof?.lines ?? []).some((l) => l.kind === "ridge")) roofingQs.push("ridge vent: which ridges, or none");
  // A piece put on and not yet given its numbers is asked for, never quietly counted as nothing.
  for (const { piece, figures } of pieceList) {
    const m = figures.missing;
    if (m.length > 0) roofingQs.push(`the ${pieceWords(piece).toLowerCase()}: ${m.length === 1 ? m[0] : `${m.slice(0, -1).join(", ")} and ${m[m.length - 1]}`}`);
  }

  // The squares by pitch: the chosen slopes' own and the pieces', shared out to a typed area as the drawing and pieces have them.
  // With no outline, the roof report's areas by pitch where the estimator took them (2026-10-15): those count its dormers already.
  const pitchArea = new Map<number, number>();
  const addAt = (p: number, a: number) => {
    const key = [...pitchArea.keys()].find((k) => Math.abs(k - p) < 0.005) ?? Math.round(p * 100) / 100;
    pitchArea.set(key, (pitchArea.get(key) ?? 0) + a);
  };
  const chosenSlopes = noSlopes ? [] : slopes.filter((s) => s.selected);
  const reportPitches = !roof && R.report?.pitchesTaken ? R.report.pitches.filter((p) => p.squareFeet !== null && p.squareFeet > 0) : [];
  // The pieces go by their own pitches beside a drawing or a typed area; with neither, the squares are still to be given.
  const byPieces = (roof !== null || typedTotal(R, "squareFeet") !== null) && reportPitches.length === 0;
  if (chosenSlopes.length === 0 && reportPitches.length > 0) for (const p of reportPitches) pitchArea.set(p.pitch, (pitchArea.get(p.pitch) ?? 0) + (p.squareFeet as number));
  // With no slopes to go by, the rest of the area is at the roof's pitch: a typed area already counts the pieces.
  else if (chosenSlopes.length === 0) pitchArea.set(roofPitch, Math.max(0, value.squareFeet - (byPieces ? pieceSum.squareFeet : 0)));
  else for (const s of chosenSlopes) addAt(s.pitch, s.areaSquareFeet);
  let curvedArea = 0;
  for (const { figures } of byPieces ? pieceList : []) {
    for (const a of figures.areas) {
      if (a.pitch === null) curvedArea += a.squareFeet;
      else addAt(a.pitch, a.squareFeet);
    }
  }
  const drawnArea = [...pitchArea.values()].reduce((a, b) => a + b, 0) + curvedArea;
  const share = drawnArea > 0 ? value.squareFeet / drawnArea : 0;
  const byPitch = [...pitchArea.entries()]
    .map(([p, a]) => ({
      pitch: p,
      areaSquareFeet: a * share,
      squares: (a * share) / 100,
      assumed: pitchAssumed && Math.abs(p - roofPitch) < 1e-6,
      fromPhotos: photoPitchValues.some((v) => Math.abs(p - Math.round(v * 100) / 100) < 1e-6),
    }))
    .filter((b) => b.areaSquareFeet > 1e-9 || pitchArea.size === 1)
    .sort((a, b) => b.pitch - a.pitch);
  const upperArea = noSlopes ? 0 : chosenSlopes.filter((x) => facets.find((f) => f.key === x.key && (f.section === null ? f.layer === 0 : upperKeys.has(f.section)))).reduce((a, x) => a + x.areaSquareFeet, 0);
  const high = twoStorey
    ? { squares: (upperArea * share) / 100, automatic: true }
    : R.high === true || highFromPhotos === true
      ? { squares: value.squareFeet / 100, automatic: false, ...(highFromPhotos === true ? { fromPhotos: true } : {}) }
      : null;
  const steepBands: { band: string; squares: number }[] = [];
  for (const b of byPitch) {
    const band = steepBand(b.pitch);
    if (!band) continue;
    const at = steepBands.find((s) => s.band === band);
    if (at) at.squares += b.squares;
    else steepBands.push({ band, squares: b.squares });
  }

  return {
    pitch: roofPitch,
    pitchAssumed,
    pitchFromPhotos,
    pitchFactor: roof?.pitchFactor ?? pitchFactor(roofPitch),
    material,
    slopes,
    allSlopes,
    areaSquareFeet: value.squareFeet,
    squares: value.squareFeet / 100,
    ridgeFeet: value.ridge,
    hipFeet: value.hip,
    valleyFeet: value.valley,
    headwallFeet: value.headwall,
    stepFeet: value.step,
    eaveFeet: value.eave,
    rakeFeet: value.rake,
    partyFeet: t.party,
    dripEdgeFeet: value.dripEdge,
    starterFeet: value.starter,
    iceWaterFeet: value.iceWater,
    closureFeet: value.eave + 2 * value.ridge,
    ridgeVentFeet,
    steep: steepBands[0]?.band ?? null,
    byPitch,
    curved: curvedArea * share > 1e-9 ? { areaSquareFeet: curvedArea * share, squares: (curvedArea * share) / 100 } : null,
    pieces: { list: pieceList, offered, added, addedFromPhotos, sidingSquareFeet: pieceList.reduce((s, x) => s + x.figures.sidingSquareFeet, 0) },
    steepBands,
    high,
    highFromPhotos: storeysRead && highFromPhotos !== null ? { twoStoreys: highFromPhotos, sides: [...new Set(storeysRead.reads.map((x) => x.name))] } : null,
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
      eaveSquareFeet: soffitEave * Math.max(0, overhangs.eave.feet),
      rakeSquareFeet: soffitRake * Math.max(0, overhangs.rake.feet),
    },
    overhangs,
    fasciaFeet: soffitEave + soffitRake,
    toAnswer: {
      roofing: roofingQs,
      eavestrough: R.leafGuard == null ? ["leaf guard, yes or no"] : [],
      soffitFascia: R.soffitMaterial == null ? ["soffit and fascia: metal or wood"] : [],
    },
    drawn: roof !== null,
    typed: hasTypedTotals(R),
    from,
    edgesFrom: { eave: typedEave !== null ? typedSource(R, "eave") : "drawing", rake: typedRake !== null ? typedSource(R, "rake") : "drawing" },
    drawing,
    report: ROOF_TOTAL_KEYS.some((k) => from[k] === "report") && R.report ? { label: reportLabel(R.report), fileName: R.report.fileName } : null,
  };
}

export interface ExteriorQuantities {
  footprint: Footprint;
  /** The upper floor's outline on the main floor's plan; null for one storey. */
  upperFootprint: Footprint | null;
  /** The upper floor's underside where it stands out past the main floor's walls (a cantilever): floor soffit, plan square feet. */
  floorSoffitSquareFeet: number;
  pitch: PitchReading;
  /** Null until the sides close and there is a pitch. */
  roof: RoofPlan | null;
  /** Null with neither a roof drawn nor any total typed. */
  roofing: RoofingQuantities | null;
  sides: SideQuantities[];
  /** The roof's gable over each side, where the roof gives one - what each elevation draws. */
  rises: Record<string, RoofRise>;
  /** What each upper-floor side stands on, above the floor line, where a lower roof meets it. */
  bases: Record<string, RoofRise>;
  /** Each lower roof's eave under the eave of the roof it meets, by the side its free end stands over (`exteriorWingDrops`). */
  wingDrops: Record<string, WingDrop>;
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
    /** What the trim took off the cladding (2026-10-17); absent with none. */
    trimSquareFeet?: number;
  };
  /** The surrounds, keystones, columns and pilasters (2026-10-17); absent with none. */
  trim?: TrimTotals;
}

export function exteriorQuantities(exterior: Exterior): ExteriorQuantities {
  const footprint = exteriorFootprint(exterior);
  const pitch = exteriorPitch(exterior);
  const upper = upperFootprint(exterior, footprint);
  let roof: RoofPlan | null = null;
  let wingDropsBuilt: Record<string, WingDrop> = {};
  const rises: Record<string, RoofRise> = {};
  const bases: Record<string, RoofRise> = {};
  let floorSoffitSquareFeet = 0;
  if (footprint.closes && pitch.value !== null) {
    const input = roofInput(exterior, footprint, pitch.value);
    roof = buildRoof(input);
    if (!input.upper) wingDropsBuilt = exteriorWingDrops(exterior, input, roof);
    // Stood out past the main floor's walls no further than a cantilever, the upper floor has an underside to clad.
    if (input.upper && roof.sections.some((s) => s.floor === "upper")) floorSoffitSquareFeet = upperOverhang(input).squareFeet;
    if (roof.shape !== "other") {
      const n = footprint.corners.length;
      footprint.sideIds.forEach((id, i) => {
        const rise = roofRiseAlongWall(input, footprint.corners[i] as Pt, footprint.corners[(i + 1) % n] as Pt, "main");
        if (rise.some((r) => r.rise > 1e-6)) rises[id] = rise;
      });
      // Two storeys: an upper side's gable is the house's roof's, and it stands on the floor line or a lower roof.
      if (input.upper && upper?.closes) {
        const m = upper.corners.length;
        const { lifts } = splitLevelHeights(exterior, footprint, roof);
        upper.sideIds.forEach((id, i) => {
          const a = upper.corners[i] as Pt;
          const b = upper.corners[(i + 1) % m] as Pt;
          const rise = roofRiseAlongWall(input, a, b, "upper");
          if (rise.some((r) => r.rise > 1e-6)) rises[id] = rise;
          const base = roofBaseAlongWall(input, a, b, lifts);
          if (base.length >= 2) bases[id] = base;
        });
      }
    }
  }

  const every = allSides(exterior);
  const sharedIds = sharedSideIds(exterior);
  const sides = every.map((side) => (sharedIds.has(side.id) ? sharedSideQuantities(side) : sideQuantities(side, rises[side.id] ?? null, bases[side.id] ?? null)));

  const byKind = new Map<string, CladdingTotal>();
  for (const s of sides) {
    for (const b of s.bands) {
      const key = b.kind === "other" ? `other:${b.label.toLowerCase()}` : b.kind;
      const t: CladdingTotal = byKind.get(key) ?? { key, kind: b.kind, label: b.label, grossSquareFeet: 0, openingSquareFeet: 0, netSquareFeet: 0 };
      t.grossSquareFeet += b.grossSquareFeet;
      t.openingSquareFeet += b.openingSquareFeet;
      t.netSquareFeet += b.netSquareFeet;
      if (b.trimSquareFeet) t.trimSquareFeet = (t.trimSquareFeet ?? 0) + b.trimSquareFeet;
      byKind.set(key, t);
    }
  }

  const openingGroups = new Map<string, { kind: ExteriorOpeningKind; widthFeet: number; heightFeet: number; count: number }>();
  for (const side of every) {
    if (sharedIds.has(side.id)) continue;
    for (const o of side.openings) {
      const key = `${o.kind}:${Math.round(o.widthFeet * 12)}x${Math.round(o.heightFeet * 12)}`;
      const g = openingGroups.get(key) ?? { kind: o.kind, widthFeet: o.widthFeet, heightFeet: o.heightFeet, count: 0 };
      g.count += 1;
      openingGroups.set(key, g);
    }
  }

  let outsideCornerFeet = 0;
  let insideCornerFeet = 0;
  // Round each floor's own outline: the main floor's corners, then the upper floor's.
  for (const [from, list] of [
    [0, exterior.sides],
    [exterior.sides.length, exterior.upper?.sides ?? []],
  ] as [number, ExteriorSide[]][]) {
    list.forEach((side, i) => {
      const q = sides[from + i] as SideQuantities;
      if (!q.complete) return;
      // A corner at a shared wall is no corner of the outside: the wall runs on into the neighbour's.
      if (sharedIds.has(side.id) || sharedIds.has(list[(i + 1) % list.length]?.id ?? "")) return;
      const next = sides[from + ((i + 1) % list.length)] as SideQuantities;
      const height = next.complete ? (q.corners.rightFeet + next.corners.leftFeet) / 2 : q.corners.rightFeet;
      if (side.turn === "outside") outsideCornerFeet += height;
      else insideCornerFeet += height;
    });
  }

  // Typed totals and roof pieces price a roof with no outline drawn, or one the drawing can't make.
  const roofing: RoofingQuantities | null = roof || hasTypedTotals(exterior.roof) || hasRoofPieces(exterior) ? roofingQuantities(exterior, roof, pitch) : null;
  // The trim (2026-10-17): its own lines; nothing at all on a house with none, so such a house's quantities are as they were.
  const trim = trimTotals(sides);

  return {
    footprint,
    upperFootprint: upper,
    floorSoffitSquareFeet,
    pitch,
    roof,
    roofing,
    sides,
    rises,
    bases,
    wingDrops: wingDropsBuilt,
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
      ...(trim ? { trimSquareFeet: trim.squareFeet } : {}),
    },
    ...(trim ? { trim } : {}),
  };
}

/**
 * The roof as the photos read it (2026-10-15), for a roof report to be checked against: the owner's
 * route is the photos, the report the fallback and the cross-check, and the report never quietly
 * overrules what the photos read. The drawing is rebuilt with every pitch and overhang the photos
 * read standing over anything typed (or taken off the report) and no totals typed. Null when the
 * photos read nothing for the roof.
 */
export interface PhotoRoofCheck {
  /** The main roof's pitch the gables' photos read, and off which sides; null when none read it. */
  mainPitch: { value: number; reads: PhotoRead<number>[] } | null;
  /** Each other part's pitch its own gable's photo read, by section key. */
  sectionPitches: { key: string; value: number; reads: PhotoRead<number>[] }[];
  /** The overhangs the photos read, between them; null for one they did not. */
  overhangs: { eave: number | null; rake: number | null };
  /** The totals the photos' roof gives, as `RoofingQuantities.drawing`; null with no closed outline. */
  totals: Record<RoofTotalKey, number> | null;
  /** Nothing typed stands over the photos: the drawing is the photos' roof, and one check covers both. */
  sameAsDrawing: boolean;
  /** "5/12 (West), eave overhang 1'11", rake overhang 2'2"": what the photos read, for the panel. */
  words: string;
}

/** A pitch a report gives further than this from the photos' read (half a pitch) is flagged, as gables that disagree are. */
export const DISAGREE_PITCH = 0.5;

export function photoRoofCheck(exterior: Exterior): PhotoRoofCheck | null {
  const reads = photoReads(exterior);
  if (reads.pitches.length === 0 && reads.eaveOverhangs.length === 0 && reads.rakeOverhangs.length === 0) return null;
  const pp = photoPitches(exterior);
  const mainReads = pp.main.length > 0 ? pp.main : pp.unplaced;
  const mainPitch = mainReads.length > 0 ? { value: meanOf(mainReads.map((r) => r.value)), reads: mainReads } : null;
  const sectionPitches = Object.entries(pp.sections).map(([key, rs]) => ({ key, value: meanOf(rs.map((r) => r.value)), reads: rs }));
  const eave = reads.eaveOverhangs.length > 0 ? meanOf(reads.eaveOverhangs.map((r) => r.value)) : null;
  const rake = reads.rakeOverhangs.length > 0 ? meanOf(reads.rakeOverhangs.map((r) => r.value)) : null;
  // Every read set explicitly, so nothing typed can stand over it.
  const R = exterior.roof;
  const asRead: Exterior = {
    ...exterior,
    roof: {
      ...R,
      pitch: mainPitch ? mainPitch.value : R.pitch,
      sectionPitches: { ...(R.sectionPitches ?? {}), ...Object.fromEntries(sectionPitches.map((s) => [s.key, s.value])) },
      eaveOverhangFeet: eave ?? R.eaveOverhangFeet,
      rakeOverhangFeet: rake ?? R.rakeOverhangFeet,
      overhangSource: { ...R.overhangSource, ...(eave !== null ? { eave: "typed" as const } : {}), ...(rake !== null ? { rake: "typed" as const } : {}) },
      typed: {},
      typedFrom: {},
    },
  };
  const totals = exteriorQuantities(asRead).roofing?.drawing ?? null;
  const drawing = totals ? (exteriorQuantities(exterior).roofing?.drawing ?? null) : null;
  const sameAsDrawing = totals !== null && drawing !== null && ROOF_TOTAL_KEYS.every((k) => Math.abs(totals[k] - drawing[k]) < 1e-6);
  const names = (rs: PhotoRead<number>[]) => rs.map((r) => r.name).join(", ");
  const words = [
    ...(mainPitch ? [`${formatPitch(mainPitch.value)} (${names(mainPitch.reads)})`] : []),
    ...sectionPitches.map((s) => `${formatPitch(s.value)} (${names(s.reads)})`),
    ...(eave !== null ? [`eave overhang ${formatFeetInches(eave)}`] : []),
    ...(rake !== null ? [`rake overhang ${formatFeetInches(rake)}`] : []),
  ].join(", ");
  return { mainPitch, sectionPitches, overhangs: { eave, rake }, totals, sameAsDrawing, words };
}

/**
 * The report's pitches against the photos' (2026-10-15): its predominant pitch against the main
 * roof's gables, and each other part's photo against any pitch the report lists. Each further than
 * half a pitch is said; nothing when they agree or either has no pitch.
 */
export function reportPitchFlags(report: RoofReport, check: PhotoRoofCheck | null): string[] {
  if (!check) return [];
  const flags: string[] = [];
  const names = (rs: PhotoRead<number>[]) => rs.map((r) => r.name).join(", ");
  if (check.mainPitch && report.pitch !== null && Math.abs(check.mainPitch.value - report.pitch) > DISAGREE_PITCH + 1e-9) {
    flags.push(`The photos read ${formatPitch(check.mainPitch.value)} (${names(check.mainPitch.reads)}); the report has ${formatPitch(report.pitch)}.`);
  }
  const listed = [...(report.pitch !== null ? [report.pitch] : []), ...report.pitches.map((p) => p.pitch)];
  if (listed.length > 0) {
    for (const s of check.sectionPitches) {
      if (listed.some((p) => Math.abs(p - s.value) <= DISAGREE_PITCH + 1e-9)) continue;
      flags.push(`The photos read ${formatPitch(s.value)} (${names(s.reads)}); the report lists no pitch near it.`);
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------------------------
// Into the scope
// ---------------------------------------------------------------------------------------------

/** Siding that goes on over a wrap and is trimmed round its openings; stucco, EIFS, brick and stone are not. */
export const SIDING_KINDS: CladdingKind[] = ["vinyl", "wood_shake", "wood", "fibre_cement", "metal"];

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
/**
 * " – from the drawing", " – from the roof report (EagleView, 2026-09-30)": a list's source words,
 * nothing at all while nothing is typed. The report is named in full the first time the list says it
 * (2026-10-15), and is "the roof report" after - each list is one trade's work order.
 */
function reportNamer(r: RoofingQuantities): (s: TotalSource) => string {
  let named = false;
  return (s) => {
    if (!r.typed) return "";
    const full = !named && s !== "estimator" && s !== "drawing" && s !== "both";
    if (full) named = true;
    return ` – ${sourceWords(s, full ? r.report?.label : null)}`;
  };
}

export function exteriorScopeLines(exterior: Exterior | undefined): ExteriorScopeLines {
  const out: ExteriorScopeLines = { roofing: [], siding: [] };
  const scope = exterior?.scope;
  if (!exterior) return out;
  const q = exteriorQuantities(exterior);
  const num = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  const r = q.roofing;
  const R = exterior.roof;

  if (scope?.roofing && r) {
    // Once anything is typed over the drawing, every measured line says where its number came from;
    // the roof report is named (maker, date) the first time, and is "the roof report" after.
    const from = reportNamer(r);
    // With no drawing, the squares are known only once typed or taken off a report: roof pieces alone are not the roof.
    const sqKnown = r.drawn || typedTotal(R, "squareFeet") !== null;
    const sq = sqKnown ? `${r.squares.toFixed(2)} SQ` : "squares to confirm";
    const sqFrom = () => (sqKnown ? from(r.from.squareFeet) : "");
    const chosen = r.slopes.filter((s) => s.selected);
    // What the added roof pieces (lib/roofPieces.ts) put into a line's number, said in its brackets; nothing when they put in nothing.
    const P = r.pieces.added;
    const paren = (...parts: string[]) => (parts.some(Boolean) ? ` (${parts.filter(Boolean).join("; ")})` : "");
    const ofPieces = (add: number, total: number, photos = 0, unit = "LF") => {
      if (Math.abs(add) < 0.05) return "";
      // Off the photos, all of it or some: said, as the photos' pitches and overhangs are.
      const whose = Math.abs(add - photos) < 0.05 ? "added pieces from photos" : "added pieces";
      const some = Math.abs(photos) >= 0.05 && Math.abs(add - photos) >= 0.05 ? `, ${num(photos)} ${unit} of it from photos` : "";
      return `${Math.abs(total - add) < 0.05 ? "from" : `incl. ${num(add)} ${unit} from`} ${whose}${some}`;
    };
    const PP = r.pieces.addedFromPhotos;
    // Typed squares are the roof being done, whatever is picked on the drawing.
    const withPieces = Math.abs(P.squareFeet) > 0.05 ? (Math.abs(P.squareFeet - r.pieces.addedFromPhotos.squareFeet) < 0.05 ? ", with added pieces from photos" : ", with added pieces") : "";
    const which = r.from.squareFeet !== "drawing" || !r.drawn ? "" : ` (${r.allSlopes ? "all slopes" : `slope${chosen.length === 1 ? "" : "s"} ${chosen.map((s) => s.label).join(", ")}`}${withPieces})`;
    const metal = r.material === "metal";
    // One pitch, said once; several, each with the squares at it, and a curved piece's apart.
    // Where a pitch came from when it wasn't typed: assumed, or read off a gable's photo (2026-10-15).
    const pitchFrom = (assumed: boolean, photos: boolean) => (assumed ? " (assumed, to confirm)" : photos ? sourceNote("photos") : "");
    const pitches =
      r.byPitch.length > 1 || r.curved
        ? [...r.byPitch.map((b) => `${formatPitch(b.pitch)}${pitchFrom(b.assumed, b.fromPhotos)} on ${b.squares.toFixed(2)} SQ`), ...(r.curved ? [`curved on ${r.curved.squares.toFixed(2)} SQ`] : [])].join(", ")
        : `${formatPitch(r.byPitch[0]?.pitch ?? r.pitch)}${pitchFrom(r.pitchAssumed, r.byPitch[0]?.fromPhotos ?? r.pitchFromPhotos)}`;
    out.roofing.push(`Remove & replace roofing – ${r.material ? ROOF_MATERIAL_LABEL[r.material] : "material to confirm"} – ${pitches} – ${sq}${which}${sqFrom()}`);
    // The pieces themselves, named once: their quantities are in the lines.
    const ready = r.pieces.list.filter((x) => x.figures.missing.length === 0);
    if (ready.length > 0) {
      const over = r.typed ? " – added to the drawing's totals, not to those typed" : r.drawn ? " – added to the drawing's totals" : "";
      out.roofing.push(`Added roof pieces – ${ready.map((x) => pieceLine(x.piece, x.figures, r.pitch)).join("; ")}${over}`);
    }
    // Steep is charged on the squares at a steep pitch: all of them on a roof of one pitch.
    for (const band of r.steepBands) out.roofing.push(`Steep roof charge – ${band.band} – ${(r.byPitch.length > 1 || r.curved) && sqKnown ? `${band.squares.toFixed(2)} SQ` : sq}${sqFrom()}`);
    if (r.high?.automatic) out.roofing.push(`High roof charge – two storeys or more – ${sqKnown ? `${r.high.squares.toFixed(2)} SQ` : sq} (the roof over the upper floor)${sqFrom()}`);
    else if (r.high) out.roofing.push(`High roof charge – two storeys or more${r.high.fromPhotos ? " (from photos)" : ""} – ${sq}${sqFrom()}`);
    if (r.ridgeFeet + r.hipFeet > 0) out.roofing.push(`Hip & ridge cap – ${num(r.ridgeFeet + r.hipFeet)} LF${paren(ofPieces(P.ridge + P.hip, r.ridgeFeet + r.hipFeet, PP.ridge + PP.hip))}${from(sourceOfParts([r.ridgeFeet, r.from.ridge], [r.hipFeet, r.from.hip]))}`);
    if (metal) out.roofing.push(`Closure strips – ${num(r.closureFeet)} LF${paren("eaves + 2 × ridge", ofPieces(P.eave + 2 * P.ridge, r.closureFeet, PP.eave + 2 * PP.ridge))}${from(sourceOfParts([r.eaveFeet, r.from.eave], [r.ridgeFeet, r.from.ridge]))}`);
    else if (r.starterFeet > 0) out.roofing.push(`Starter – ${num(r.starterFeet)} LF${paren("eaves", ofPieces(P.starter, r.starterFeet, PP.starter))}${from(r.from.starter)}`);
    if (R.dripEdge === true) out.roofing.push(`Drip edge – ${num(r.dripEdgeFeet)} LF${paren("eaves + rakes", ofPieces(P.dripEdge, r.dripEdgeFeet, PP.dripEdge))}${from(r.from.dripEdge)} – photos required`);
    if (r.drawn || r.iceWaterFeet > 0) out.roofing.push(`${metal ? "High-temperature ice & water barrier" : "Ice & water barrier"} – ${num(r.iceWaterFeet)} LF${paren("eaves + valleys", ofPieces(P.iceWater, r.iceWaterFeet, PP.iceWater))}${from(r.from.iceWater)}`);
    if (R.underlayment === "synthetic" || R.underlayment === "felt") out.roofing.push(`Underlayment – ${R.underlayment} – ${sq}${sqFrom()} – photos required`);
    if (r.valleyFeet > 0) out.roofing.push(`Valleys – ${num(r.valleyFeet)} LF${paren(ofPieces(P.valley, r.valleyFeet, PP.valley))}${from(r.from.valley)}`);
    // Flashing against a wall: a lower roof's on the drawing, and a dormer's cheeks, face and top among the pieces.
    const drawnToo = (add: number, total: number) => Math.abs(total - add) >= 0.05;
    if (r.stepFeet > 0) out.roofing.push(`Step flashing – ${num(r.stepFeet)} LF${paren(drawnToo(P.step, r.stepFeet) ? "a lower roof's slopes against the wall" : "", ofPieces(P.step, r.stepFeet, PP.step))}${from(r.from.step)}`);
    if (r.headwallFeet > 0) out.roofing.push(`Headwall flashing – ${num(r.headwallFeet)} LF${paren(drawnToo(P.headwall, r.headwallFeet) ? "a lower roof's top against the wall" : "", ofPieces(P.headwall, r.headwallFeet, PP.headwall))}${from(r.from.headwall)}`);
    for (const kind of Object.keys(ROOF_VENT_LABEL) as RoofVentKind[]) {
      const n = Math.round(R.vents?.[kind] ?? 0);
      if (n > 0) out.roofing.push(`${ROOF_VENT_LABEL[kind]} – ${n}`);
    }
    if (r.ridgeVentFeet > 0) out.roofing.push(`Ridge vent – ${num(r.ridgeVentFeet)} LF${from("drawing")}`);
    if ((R.pipeJacks?.four ?? 0) > 0) out.roofing.push(`Pipe jack – 4" – ${Math.round(R.pipeJacks?.four ?? 0)}`);
    if ((R.pipeJacks?.six ?? 0) > 0) out.roofing.push(`Pipe jack – 6" – ${Math.round(R.pipeJacks?.six ?? 0)}`);
    if (R.chimney && R.chimney !== "none") out.roofing.push(`Chimney flashing – ${R.chimney}`);
    if (R.handload === true) out.roofing.push(`Handload roofing materials – ${sq}${sqFrom()}`);
    if (R.disposalHandload === true) out.roofing.push(`Handload debris to disposal – ${sq}${sqFrom()}`);
    if (metal) out.roofing.push(`Disposal – metal roofing – ${sq}${sqFrom()}`);
  }

  const sides = q.sides.filter((s) => (scope?.sides ?? []).includes(s.sideId) && s.complete);
  if (sides.length > 0) {
    // A gable the roof gives at a pitch nobody measured is that pitch's guess: the line says so.
    const guessed = (s: SideQuantities) => q.pitch.source === "assumed" && s.gableSource === "roof" && s.gableSquareFeet > 0.05;
    const kinds = new Map<string, { label: string; kind: CladdingKind; gross: number; holes: number; trim: number; net: number; names: string[]; guessed: boolean }>();
    for (const s of sides) {
      for (const b of s.bands) {
        const key = b.kind === "other" ? `other:${b.label.toLowerCase()}` : b.kind;
        const k = kinds.get(key) ?? { label: b.label, kind: b.kind, gross: 0, holes: 0, trim: 0, net: 0, names: [], guessed: false };
        k.gross += b.grossSquareFeet;
        k.holes += b.openingSquareFeet;
        k.trim += b.trimSquareFeet ?? 0;
        k.net += b.netSquareFeet;
        k.guessed ||= guessed(s);
        if (!k.names.includes(s.name)) k.names.push(s.name);
        kinds.set(key, k);
      }
    }
    let wrap = 0;
    for (const k of kinds.values()) {
      if (k.net <= 0) continue;
      // The field: what is left once the openings and the trim (2026-10-17) are off it.
      const less = [k.holes > 0.05 ? `${num(k.holes)} SF of openings` : "", k.trim > 0.05 ? `${num(k.trim)} SF of trim` : ""].filter(Boolean);
      const holes = less.length > 0 ? ` (${num(k.gross)} SF less ${less.join(" and ")})` : "";
      const gables = k.guessed ? ` – gables at the assumed ${formatPitch(q.pitch.value ?? ASSUMED_PITCH)}, to confirm` : "";
      out.siding.push(`Remove & replace ${k.label.toLowerCase()} – ${k.names.join(", ")} – ${num(k.net)} SF${holes}${gables}`);
      if (SIDING_KINDS.includes(k.kind)) wrap += k.net;
    }
    out.siding.push(...trimLines(trimTotals(sides)));
    // Parging drawn as shapes (2026-10-22): by its area, over the run of foundation it covers.
    const parged = sides.filter((s) => s.parging);
    if (parged.length > 0) {
      const sf = parged.reduce((sum, s) => sum + (s.parging?.squareFeet ?? 0), 0);
      const lf = parged.reduce((sum, s) => sum + (s.parging?.linearFeet ?? 0), 0);
      out.siding.push(`Parging – ${parged.map((s) => s.name).join(", ")} – ${num(sf)} SF (${num(lf)} LF of foundation)`);
    }
    if (wrap > 0) out.siding.push(`House wrap – ${num(wrap)} SF`);
    const sidedTrim = sides
      .filter((s) => s.bands.some((b) => SIDING_KINDS.includes(b.kind) && b.netSquareFeet > 0))
      .reduce((sum, s) => sum + s.openingTrimFeet, 0);
    if (sidedTrim > 0) out.siding.push(`Trim & J-channel round openings – ${num(sidedTrim)} LF`);
    // The dormers' own walls go with the siding: no side's elevation has them.
    const dormers = r?.pieces.sidingSquareFeet ?? 0;
    if (dormers > 0.05) out.siding.push(`Remove & replace siding – dormer cheeks & faces – ${num(dormers)} SF (added pieces, openings not taken off)`);
  }
  // What is on the walls goes on whether or not the cladding is: a vent can be replaced on its own.
  for (const side of allSides(exterior)) {
    for (const f of side.fixtures ?? []) {
      if (f.count > 0) out.siding.push(`${fixtureLine(f)} – ${side.name.trim() || "Side"} – ${Math.round(f.count)}`);
    }
  }

  // Typed eaves and rakes carry on to what runs along them: said, as on the roofing lines.
  const edgeFrom = r ? reportNamer(r) : () => "";
  if (scope?.soffitFascia && r) {
    const material = R.soffitMaterial ?? "material to confirm";
    if (r.soffit.eaveFeet > 0) {
      out.siding.push(`Remove & replace soffit – ${material} – ${num(r.soffit.eaveFeet)} LF at ${formatFeetInches(r.overhangs.eave.feet)} overhang${sourceNote(r.overhangs.eave.source)} (${num(r.soffit.eaveSquareFeet)} SF) – eaves${edgeFrom(r.edgesFrom.eave)}`);
    }
    if (r.soffit.rakeFeet > 0) {
      out.siding.push(`Remove & replace soffit – ${material} – ${num(r.soffit.rakeFeet)} LF at ${formatFeetInches(r.overhangs.rake.feet)} overhang${sourceNote(r.overhangs.rake.source)} (${num(r.soffit.rakeSquareFeet)} SF) – rakes${edgeFrom(r.edgesFrom.rake)}`);
    }
    if (r.fasciaFeet > 0) {
      out.siding.push(`Remove & replace fascia – ${material} – ${num(r.fasciaFeet)} LF (eaves + rakes)${edgeFrom(sourceOfParts([r.soffit.eaveFeet, r.edgesFrom.eave], [r.soffit.rakeFeet, r.edgesFrom.rake]))}`);
    }
  }
  // A cantilevered upper floor's underside is soffit too, by its area off the drawing (2026-10-15).
  if (scope?.soffitFascia && q.floorSoffitSquareFeet > 0.05) {
    out.siding.push(`Remove & replace soffit – ${R.soffitMaterial ?? "material to confirm"} – ${num(q.floorSoffitSquareFeet)} SF – floor overhang (the upper floor's underside past the main floor's walls)`);
  }
  if (scope?.eavestrough && r && r.gutter.feet > 0) {
    const g = r.gutter;
    out.siding.push(`Remove & replace eavestrough – ${num(g.feet)} LF${edgeFrom(r.edgesFrom.eave)}`);
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

/** A surround by the kind of opening it goes round: "window surrounds". */
export const SURROUND_WORDS: Record<ExteriorOpeningKind, string> = { window: "window surrounds", door: "door surrounds", garage: "garage door surrounds", rollup: "roll-up door surrounds" };

/**
 * The trim's scope lines (2026-10-17), each its own: "Stucco trim – window surrounds – 9 – 112.4 LF (68.0 SF)",
 * "Stucco trim – keystones – 3", "Columns – stucco wrap – 3 – 81.0 SF (round the shaft × its height)", then the caps
 * and the bases by count. Nothing with no trim.
 */
export function trimLines(t: TrimTotals | null): string[] {
  if (!t) return [];
  const num = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  const out: string[] = [];
  const labels = [...new Set(t.surrounds.map((g) => g.label))];
  for (const label of labels) {
    const mine = t.surrounds.filter((g) => g.label === label);
    for (const g of mine) out.push(`${label} trim – ${SURROUND_WORDS[g.openingKind]} – ${g.count} – ${num(g.linearFeet)} LF (${num(g.squareFeet)} SF)`);
    const keys = mine.reduce((n, g) => n + g.keystones, 0);
    if (keys > 0) out.push(`${label} trim – keystones – ${keys}`);
  }
  for (const c of t.columns) {
    const what = c.kind === "column" ? "Columns" : "Pilasters";
    const m = c.label.toLowerCase();
    out.push(`${what} – ${m} wrap – ${c.count} – ${num(c.wrapSquareFeet)} SF (round the shaft × its height)`);
    if (c.caps > 0) out.push(`${what} – ${m} caps – ${c.caps}`);
    if (c.bases > 0) out.push(`${what} – ${m} bases – ${c.bases}`);
  }
  return out;
}

/** A roof piece by its kind, or by the name an Other piece is given. */
export function pieceWords(piece: RoofPiece): string {
  return piece.kind === "other" ? piece.label?.trim() || "Other roof piece" : ROOF_PIECE_LABEL[piece.kind];
}

/**
 * A roof piece as the scope and the documents name it: what it is, its sizes, and what it adds to
 * the roof's area - "2 × gable dormer, 8' wide, 6' out, 12/12 on a 6/12 slope (+23.7 SF net of the
 * slope it covers each)", then "(from photos)" for one proposed off the photos and ticked. Its
 * lengths are in the roof's own lines.
 */
export function pieceLine(piece: RoofPiece, figures: PieceFigures, roofPitch: number): string {
  const n = pieceCount(piece);
  const ft = (v: number | null | undefined) => formatFeetInches(v ?? 0);
  const num = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  const signed = (v: number) => `${v < 0 ? "-" : "+"}${num(Math.abs(v))} SF`;
  const pitch = formatPitch(piece.pitch ?? 0);
  // Sizes and areas are each one's: several alike are said once.
  const per = figures.squareFeet / n;
  const each = n > 1 ? " each" : "";
  let what: string;
  switch (piece.kind) {
    case "gableDormer":
    case "shedDormer": {
      const on = typeof piece.onPitch === "number" && piece.onPitch >= 0 ? piece.onPitch : roofPitch;
      what = `${piece.kind === "gableDormer" ? "gable" : "shed"} dormer, ${ft(piece.widthFeet)} wide, ${ft(piece.projectionFeet)} out, ${pitch} on a ${formatPitch(on)} slope (${signed(per)} net of the slope it covers${each})`;
      break;
    }
    case "roundTurret":
      what = `round turret, ${ft(piece.diameterFeet)} across, ${pitch} (${num(per)} SF${each})`;
      break;
    case "polygonTurret":
      what = `${Math.round(piece.sideCount ?? 0)}-sided turret, ${ft(piece.sideFeet)} a side, ${pitch} (${num(per)} SF${each})`;
      break;
    case "barrel":
      what = `curved roof, ${ft(piece.spanFeet)} span, ${ft(piece.lengthFeet)} long, ${ft(piece.riseFeet)} rise (${num(per)} SF${each})`;
      break;
    case "flat": {
      const edge = piece.perimeterFeet && piece.perimeterFeet > 0 ? `, ${num(piece.perimeterFeet)} LF of ${piece.perimeterAs === "dripEdge" ? "drip edge" : "eave"} round it` : "";
      what = `flat roof, ${num(per)} SF${edge}${each}`;
      break;
    }
    case "other": {
      const at = typeof piece.pitch === "number" && piece.pitch >= 0 ? piece.pitch : roofPitch;
      const lengths = PIECE_LENGTH_KEYS.filter((k) => figures.lengths[k] > 0).map((k) => `${ROOF_TOTAL_LABEL[k].toLowerCase()} ${num(figures.lengths[k] / n)} LF`);
      what = `${[`${pieceWords(piece).toLowerCase()}${per > 0 ? `, ${num(per)} SF at ${formatPitch(at)}` : ""}`, ...lengths].join(", ")}${each}`;
      break;
    }
  }
  // Proposed off the photos and ticked: said, as the photos' pitches and overhangs are.
  return `${n > 1 ? `${n} × ` : ""}${what}${pieceFromPhotos(piece) ? sourceNote("photos") : ""}`;
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
