import {
  allSides,
  CLADDING_LABEL,
  COLUMN_LABEL,
  type ColumnQuantity,
  hasTrim,
  type OpeningTrim,
  type SideColumn,
  SURROUND_WORDS,
  trimLabel,
  DEFAULT_EAVE_OVERHANG_FEET,
  DEFAULT_RAKE_OVERHANG_FEET,
  elevationFaces,
  FEET_PER_DOWNSPOUT,
  endsFromPhotos,
  type Exterior,
  type ExteriorOpening,
  type ExteriorQuantities,
  exteriorQuantities,
  type ExteriorSide,
  formatOpeningSize,
  formatPitch,
  groundAt,
  homeTypeWords,
  sharedSideIds,
  unseenWords,
  lengthToCheck,
  OPENING_LABEL,
  photoNotes,
  type PitchReading,
  pieceLine,
  ROOF_MATERIAL_LABEL,
  roofProposal,
  type RoofRise,
  type RoofSource,
  SIDE_FIXTURE_LABEL,
  type SidePhoto,
  type SideQuantities,
  type SideRoofRead,
  SIDING_KINDS,
} from "./exterior";
import {
  coveredShare,
  DECKING_LABEL,
  deckLines,
  type DeckPlanShape,
  deckPlanShapes,
  type DeckQuantities,
  decksQuantities,
  POST_MATERIAL_LABEL,
  postHeightWords,
  railingWords,
  riseWords,
  SCREEN_LABEL,
  screenGroups,
  stairWords,
} from "./decks";
import { exteriorModel } from "./exterior3d";
import { checkNotes } from "./exteriorCheck";
import { NOT_SCALED, scaleOf, sizesFrom } from "./exteriorScale";
import { frontFacesOf, type HouseView, houseView, VIEWS, type ViewFrom } from "./exteriorViews";
import type { RoofLineKind, RoofPlan, RoofSection } from "./roof";
import { lineTotals } from "./roofLabels";
import { PHOTO_PIECE_LABEL, UPPER_SHOWN_WORDS } from "./roofPhotoShapes";
import { formatFeetInches } from "./sketch";

/**
 * The exterior report (2026-10-15): everything the outside of the house came to, on paper - the
 * owner: "generate a pdf with all elevations, roof sketch, photos, all measurements listed".
 *
 * ONE report, made by this code wherever it is made: on the phone, Scrivn Scan's Share runs it in
 * Scrivn's own engine (lib/scanEngine.ts) on the exterior the phone measured; on scrivn.ca the claim's
 * Exterior report runs it on the claim's exterior. The two are the same exterior read by the same
 * code (Scan's file through lib/exteriorImport.ts, its Finish through lib/exteriorFinish.ts), so they
 * agree to the inch. This file is the WHAT - every number, word and table, worked out by
 * lib/exterior.ts's own quantities, the ones the scope is written from. lib/exteriorReportPdf.ts draws it.
 *
 * Everything not measured or read says so: an assumed pitch, a default overhang, a roof end nobody
 * saw, a length only drawn. Nothing is rounded before it is added.
 */

export interface ReportMeta {
  /** The job's name or address, else "Exterior". */
  title: string;
  /** "Oct 15, 2026". */
  date: string;
  /** What made it: "Scrivn Scan 0.1.170", "Scrivn". */
  madeWith: string;
}

export interface ReportFact {
  label: string;
  value: string;
}

export interface ReportTableColumn {
  title: string;
  weight: number;
  align?: "left" | "center";
}

/** The same shape as lib/pdf.ts's `PdfTable`, so Scrivn's documents draw it as they draw every table. */
export interface ReportTable {
  caption: string;
  columns: ReportTableColumn[];
  rows: string[][];
  note?: string;
}

export interface ReportSide {
  side: ExteriorSide;
  q: SideQuantities;
  /** The roof's gable over it, what its elevation draws. */
  rise: RoofRise | null;
  /** An upper side's: what it stands on. */
  base: RoofRise | null;
  heading: string;
  /** Every dimension of it, in lines. */
  dims: string[];
  /** Shared with the neighbour's home (2026-10-17): no elevation drawn, one line saying so. */
  shared?: true;
}

/** The whole house from one side (2026-10-16): lib/exteriorViews.ts. */
export interface ReportView {
  view: HouseView;
  /** "North elevation · the front" when the front's bearing is known, else "Front elevation". */
  heading: string;
  /** "Shows Front wall behind the porch, Garage front, left bay and Garage front, right bay." */
  shows: string;
}

/** Where each view is from, said after its compass name. */
const VIEW_PLACE: Record<ViewFrom, string> = { front: "the front", right: "to the right of the front", back: "the back", left: "to the left of the front" };

export interface ReportPhoto {
  sideName: string;
  photo: SidePhoto;
  /** "Left 5 · photo 1 of 2". */
  label: string;
  caption: string;
}

export interface ExteriorReport {
  meta: ReportMeta;
  exterior: Exterior;
  q: ExteriorQuantities;
  facts: ReportFact[];
  /** Where each number came from, a sentence each. */
  sources: string[];
  /** Everything assumed, a sentence each; empty when nothing is. */
  assumed: string[];
  /** What the roof's reads say of themselves, and anything else to check. */
  notes: string[];
  sides: ReportSide[];
  /** The house from the front, its right, the back and its left, before the sides one by one; none without a footprint. */
  views: ReportView[];
  photos: ReportPhoto[];
  tables: ReportTable[];
  /** The roof plan's title line, its legend and its slopes; null with no roof drawn. */
  roof: { title: string; legend: { kind: RoofLineKind; feet: number }[]; slopes: string; notes: string[] } | null;
  /** Its decks and porches (2026-10-20, lib/decks.ts): each with its plan, its facts and its lines, and their tables. Absent with none. */
  decks?: ReportDecks;
}

/** One deck in the report: its plan, its facts in a few lines, and its lines as the scope prices it. */
export interface ReportDeck {
  q: DeckQuantities;
  shape: DeckPlanShape;
  /** "Rear deck · 312 SF · 7'6" up". */
  heading: string;
  facts: ReportFact[];
  lines: string[];
}

export interface ReportDecks {
  list: ReportDeck[];
  /** Where their numbers came from, a sentence each. */
  sources: string[];
  tables: ReportTable[];
}

const ft = formatFeetInches;
const sf = (v: number) => `${Math.round(v).toLocaleString("en-US")} SF`;
const lf = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)} LF`;
const one = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const listWords = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Where an overhang came from, in words. */
function overhangWords(o: { feet: number; source: RoofSource; reads: { name: string }[] }, which: "eave" | "rake"): string {
  const names = [...new Set(o.reads.map((r) => r.name))];
  switch (o.source) {
    case "typed":
      return `${ft(o.feet)}, typed`;
    case "photos":
      return `${ft(o.feet)}, read off the photos of ${listWords(names)}`;
    case "scan":
      return `${ft(o.feet)}, read by the phone from the roofline`;
    default:
      return `${ft(o.feet)}, Scrivn's default ${which} overhang (assumed, not measured)`;
  }
}

/** The pitch and where it came from, in words. */
function pitchWords(p: PitchReading): string {
  const v = formatPitch(p.value ?? 4);
  switch (p.source) {
    case "typed":
      return `${v}, typed`;
    case "photos":
      return `${v}, read off the gable photos of ${listWords([...new Set(p.fromPhotos.map((r) => r.name))])}`;
    case "sides":
      return `${v}, from the gables measured on ${listWords(p.fromSides.map((s) => s.name))}`;
    default:
      return `${v} (assumed: no photo, measured gable or typed pitch gives it)`;
  }
}

/** A part of the roof by what names it: the main roof, a wing by its end, a porch or cross gable by its side. */
export function sectionName(s: RoofSection, nameOf: (id: string) => string, exterior: Exterior): string {
  if (s.key === "main") return "Main roof";
  if (s.key.startsWith("wing:")) return `Wing at ${nameOf(s.key.slice(5))}`;
  if (s.key.startsWith("over-")) return `Gable over ${nameOf(s.key.slice(5))}`;
  const a = (exterior.roof.additions ?? []).find((x) => x.id === s.key);
  if (a) return `${a.kind === "porch" ? "Porch roof" : "Cross gable"} on ${nameOf(a.sideId)}`;
  if (s.floor === "main") return `Lower roof (${s.key})`;
  return s.key;
}

/** A side's roof read in words: what was read, and what was set aside. */
export function roofReadWords(read: SideRoofRead): string[] {
  const out: string[] = [];
  if (read.over) out.push(read.over === "gable" ? "a gable end" : read.over === "hip" ? "a hip end" : "an eave along it");
  if (read.pitch !== undefined) out.push(read.pitch === null ? "pitch set aside" : `pitch ${formatPitch(read.pitch)}${read.slopes ? ` (slopes ${read.slopes[0].toFixed(1)} and ${read.slopes[1].toFixed(1)})` : ""}`);
  if (read.rakeOverhangFeet !== undefined) out.push(read.rakeOverhangFeet === null ? "rake overhang set aside" : `rake overhang ${ft(read.rakeOverhangFeet)}`);
  if (read.eaveOverhangFeet !== undefined) out.push(read.eaveOverhangFeet === null ? "eave overhang set aside" : `eave overhang ${ft(read.eaveOverhangFeet)}`);
  for (const p of read.pieces ?? []) out.push(`${PHOTO_PIECE_LABEL[p.kind].toLowerCase()}${p.taken ? "" : " (seen, not counted)"}`);
  if (read.upper && read.upper !== "none") out.push(UPPER_SHOWN_WORDS[read.upper]);
  return out;
}

/** A tape on the photo route, as said: what was taped across, or the wall typed corner to corner. */
const TAPE_WORDS: Record<string, string> = { garage: "a garage door", door: "a door", window: "a window", wall: "a wall", other: "a tape" };

/**
 * Where a photos-only house's sizes come from (2026-10-16, the photo route, lib/photoRoute.ts): the photos,
 * scaled by the tapes the estimator took. "the photos (9 of 18 used) and 4 tapes: a garage door 9', ..." for
 * the sentence; "the photos and 4 tapes" for the cover. Null for any other exterior.
 */
function photoRouteSizes(exterior: Exterior): { line: string; short: string } | null {
  if (exterior.source?.kind !== "photos") return null;
  const route = exterior.photoRoute;
  const tapes = route?.buildings.flatMap((b) => b.tapes) ?? [];
  const ids = route?.measured?.sideIds ?? [];
  const nameOf = (from: number) => exterior.sides.find((s) => s.id === ids[from])?.name.trim();
  const taped = tapes.map((t) => (t.kind === "side" ? `${nameOf(t.from) ? `the ${nameOf(t.from)}` : "a wall"} ${formatFeetInches(t.feet)}` : `${TAPE_WORDS[t.what] ?? "a tape"} ${formatFeetInches(t.feet)}`));
  const used = route?.measured ? ` (${route.measured.cameras.length} of ${route.photos.length} used)` : "";
  const count = plural(tapes.length, "tape");
  if (tapes.length === 0) return { line: `Sizes: from the photos${used}; no tape was taken, so they are the photos' own and not to scale.`, short: "the photos alone, no tape" };
  return { line: `Sizes: from the photos${used}, scaled by ${count}: ${listWords(taped)}.`, short: `the photos and ${count}` };
}

/** Each opening numbered by its kind along the side, left to right: "Window 2". */
function openingNames(side: ExteriorSide): Map<string, string> {
  const names = new Map<string, string>();
  const count: Record<string, number> = {};
  for (const o of [...side.openings].sort((a, b) => a.fromLeftFeet - b.fromLeftFeet)) {
    count[o.kind] = (count[o.kind] ?? 0) + 1;
    names.set(o.id, `${OPENING_LABEL[o.kind]} ${count[o.kind]}`);
  }
  return names;
}

/**
 * A side tapped as shapes stands on its parging's bottom, which may step (2026-10-16, the owner's side
 * yard): its heights in its own frame are from one level, and a tape reads them from the ground under
 * them. Every other side's heights are from the ground already.
 */
function steps(side: ExteriorSide): boolean {
  return (side.shapes ?? []).some((s) => s.polygon.length >= 2);
}

/** A height on [side] at x along it, as a tape from the ground there reads it. */
function aboveGround(side: ExteriorSide, z: number, x: number): number {
  return steps(side) ? z - groundAt(side, x) : z;
}

/** An opening's sill above the ground under its middle. */
function sillOf(side: ExteriorSide, o: ExteriorOpening): number {
  return Math.max(0, aboveGround(side, o.sillFeet, o.fromLeftFeet + o.widthFeet / 2));
}

/** How the ground goes along a side tapped as shapes, when it isn't level: "the ground falls 6'5" from left to right, in steps". */
function groundWords(side: ExteriorSide): string | null {
  if (!steps(side)) return null;
  const grade = elevationFaces(side).grade;
  const left = groundAt(side, 0);
  const right = groundAt(side, side.lengthFeet);
  const low = Math.min(...grade.map((p) => p.y));
  const high = Math.max(...grade.map((p) => p.y));
  if (high - low < 1 / 24) return null;
  const stepped = grade.some((p, i) => i > 0 && Math.abs(p.x - (grade[i - 1] as { x: number }).x) < 1e-6 && Math.abs(p.y - (grade[i - 1] as { y: number }).y) > 1e-3);
  const how = stepped ? ", in steps" : "";
  if (Math.abs(left - right) < 1 / 24) return `the ground is uneven along it, ${ft(high - low)} from its highest to its lowest${how}`;
  return `the ground ${left > right ? "falls" : "rises"} ${ft(Math.abs(left - right))} from left to right${how}`;
}

function openingLine(side: ExteriorSide, o: ExteriorOpening, name: string): string {
  const sill = sillOf(side, o);
  return `${name}: ${formatOpeningSize(o.widthFeet, o.heightFeet)}, ${sill > 0.04 ? `sill ${ft(sill)} up` : "at the bottom"}, ${ft(o.fromLeftFeet)} from the left end${o.from === "photo" ? " (from photo)" : o.from === "said" ? " (said on site: size and place not measured)" : ""}${o.notMeasured ? ` (not measured: ${o.notMeasured} - to check)` : ""}${o.trim ? ` · ${surroundWords(o.trim)}` : ""}`;
}

/**
 * A surround in words (2026-10-17): "surround 9" each side, 6" head, 9" sill, keystone 11" × 10" (stucco trim)" - its
 * pieces' widths, a gap to the opening, sides running on up, and its keystone.
 */
export function surroundWords(t: OpeningTrim): string {
  const sides = Math.abs(t.leftFeet - t.rightFeet) < 1 / 48 ? `${ft(t.leftFeet)} each side` : `${ft(t.leftFeet)} left, ${ft(t.rightFeet)} right`;
  const parts = [
    sides,
    t.topFeet > 1e-6 ? `${ft(t.topFeet)} head` : "no head",
    ...(t.bottomFeet > 1e-6 ? [`${ft(t.bottomFeet)} sill`] : []),
    ...((t.gapFeet ?? 0) > 1e-6 ? [`set ${ft(t.gapFeet ?? 0)} off it`] : []),
    ...((t.upFeet ?? 0) > t.topFeet + (t.gapFeet ?? 0) + 1e-6 ? [`its sides up ${ft(t.upFeet ?? 0)} over the top`] : []),
    ...(t.keystone ? [`keystone ${formatOpeningSize(t.keystone.widthFeet, t.keystone.heightFeet)}`] : []),
  ];
  return `surround ${parts.join(", ")} (${trimLabel(t.material, t.label).toLowerCase()} trim)`;
}

/** A column or pilaster in words: "Pilaster 1: 9" × 9", 9'6" high, base and cap, standing out 4", 0'0" from the left end (stucco) · 59 SF wrap". */
function columnLine(c: SideColumn, name: string, q: ColumnQuantity | undefined): string {
  const blocks = [c.base && c.base.heightFeet > 0 ? "base" : "", c.cap && c.cap.heightFeet > 0 ? "cap" : ""].filter(Boolean);
  const stands = c.kind === "column" ? `standing ${ft(c.outFeet)} off the wall` : `standing out ${ft(c.outFeet)}`;
  const at = c.fromLeftFeet < -1 / 24 ? `round the left corner, ${ft(-c.fromLeftFeet)} past it` : c.fromLeftFeet < 1 / 24 ? "at the left corner" : `${ft(c.fromLeftFeet)} from the left end`;
  return `${name}: ${formatOpeningSize(c.widthFeet, c.depthFeet)}, ${ft(c.heightFeet)} high${blocks.length > 0 ? `, ${blocks.join(" and ")}` : ""}, ${stands}, ${at} (${trimLabel(c.material, c.label).toLowerCase()})${q ? ` · ${sf(q.wrapSquareFeet)} wrap` : ""}${c.from === "photo" ? " (from photo)" : ""}`;
}

/** Each column numbered by its kind along the side, left to right: "Pilaster 2". */
function columnNames(side: ExteriorSide): Map<string, string> {
  const names = new Map<string, string>();
  const count: Record<string, number> = {};
  for (const c of [...(side.columns ?? [])].sort((a, b) => a.fromLeftFeet - b.fromLeftFeet)) {
    count[c.kind] = (count[c.kind] ?? 0) + 1;
    names.set(c.id, `${COLUMN_LABEL[c.kind]} ${count[c.kind]}`);
  }
  return names;
}

/** "±6%": the ± a side's length is marked with, to check (`lengthToCheck`), or nothing. */
function plusMinus(side: ExteriorSide): string {
  const pct = lengthToCheck(side);
  return pct === undefined ? "" : `±${Math.max(1, Math.round(pct))}%`;
}

/** A side whose length was estimated on site by eye (2026-10-21): said so beside it, never as a tape. */
function estimatedWords(side: ExteriorSide): string {
  return side.lengthEstimatedFeet ? `estimated on site at about ${ft(side.lengthEstimatedFeet)}` : "";
}

/** What a side's walls came from, each part: read off its photo by Finish exterior (2026-10-15), else tapped or entered. */
function wallsFromPhoto(side: ExteriorSide): { shapes: boolean; openings: number; wallTop: boolean } {
  return { shapes: (side.shapes ?? []).some((x) => x.from === "photo"), openings: side.openings.filter((o) => o.from === "photo").length, wallTop: side.wallTopFrom === "photo" };
}

/**
 * The report of [exterior], dated and titled by [meta]. Null when there is nothing measured to report:
 * no side with a length.
 */
export function exteriorReport(exterior: Exterior, meta: ReportMeta): ExteriorReport | null {
  const every = allSides(exterior);
  if (every.length === 0) return null;
  const q = exteriorQuantities(exterior);
  const r = q.roofing;
  const plan = q.roof;
  const nameOf = (id: string) => every.find((s) => s.id === id)?.name.trim() || "Side";
  const scanned = exterior.source?.kind === "scan";
  // Measured off photos and tapes, nothing tapped (2026-10-16): its walls are the photos', and say so.
  const photosOnly = exterior.source?.by === "photos";
  /** Where a wall, a height or an opening came from when nothing marks it: photos, taps on the phone, or typed in Scrivn. */
  const ownFrom = photosOnly ? "photo" : scanned ? "tapped" : "entered";

  // Its decks (2026-10-20): what each covers of the roof is the roof's own, counted there.
  const deckQs = decksQuantities(exterior, plan);
  /** A side's line for each deck against it: "The Rear deck stands against it: 15'3" of ledger." */
  const deckAgainst = (sideId: string): string[] =>
    deckQs.flatMap((dq) => {
      const feet = (dq.geometry?.edges ?? []).reduce((s, e) => s + e.against.filter((g) => g.sideId === sideId).reduce((t, g) => t + (g.toFeet - g.fromFeet), 0), 0);
      return feet > 0.05 ? [`${dq.name} against it: ${ft(feet)} of ledger, its top ${ft(dq.heightFeet)} off the ground.`] : [];
    });

  // ---- The sides, each with every dimension ----
  const sharedIds = sharedSideIds(exterior);
  const sides: ReportSide[] = every.map((side, i) => {
    const sq = q.sides[i] as SideQuantities;
    // A party wall (2026-10-17): nothing on it counted, and its elevation not drawn - a line saying so.
    if (sharedIds.has(side.id)) {
      return { side, q: sq, rise: null, base: null, heading: `${side.name.trim() || "Side"} · ${ft(sq.lengthFeet)} · shared wall`, dims: ["Shared with the neighbour \u2013 not counted."], shared: true as const };
    }
    const names = openingNames(side);
    const ground = groundWords(side);
    const heights = [
      side.eaveLeftFeet != null ? `eave ${ft(aboveGround(side, side.eaveLeftFeet, 0))}${ground ? " above the ground" : ""} at the left` : null,
      side.eaveRightFeet != null ? `${ft(aboveGround(side, side.eaveRightFeet, side.lengthFeet))} at the right` : null,
      side.gable ? `peak ${ft(aboveGround(side, side.gable.peakFeet, side.gable.atFeet))}, ${ft(side.gable.atFeet)} from the left end` : sq.gableSource === "roof" ? `gable from the roof${q.pitch.source === "assumed" ? " (pitch assumed)" : ""}` : null,
      ground,
    ].filter(Boolean);
    const pm = plusMinus(side);
    const est = estimatedWords(side);
    const shapeFrom = new Set((side.shapes ?? []).filter((x) => x.from === "photo").map((x) => x.id));
    const colNames = columnNames(side);
    const colQ = new Map((sq.trim?.columns ?? []).map((c) => [c.id, c]));
    const dims = [
      `${side.lengthNotMeasured ? `NOT measured: about ${ft(sq.lengthFeet)} from the photos${pm ? ` ${pm}` : ""}, to draw with, not a size` : `${side.lengthFrom === "drawn" ? "About " : ""}${ft(sq.lengthFeet)} long${side.lengthFrom === "drawn" ? " (drawn, not measured)" : ""}${pm ? ` ${pm} (worked out from the photos${est ? ` and ${est}` : ""}: to check)` : est ? ` (${est}, not taped)` : ""}`}${heights.length > 0 ? ` · ${heights.join(", ")}${side.wallTopFrom === "photo" ? " (from photo)" : side.wallTopFrom === "neighbours" ? ` (from the sides beside it: ${(side.photos ?? []).length === 0 ? "not seen in a photo" : "its photo didn't show the top"})` : ""}` : ""}${side.base === "parging" ? ` · parging ${ft(side.baseLeftFeet)} / ${ft(side.baseRightFeet)}` : ""}`,
      ...sq.bands.map((b) => `${b.label}: ${sf(b.grossSquareFeet)} gross, ${sf(b.openingSquareFeet)} of openings, ${b.trimSquareFeet ? `${sf(b.trimSquareFeet)} of trim, ` : ""}${sf(b.netSquareFeet)} net${shapeFrom.has(b.bandId) ? " (from photo)" : ""}`),
      ...[...side.openings].sort((a, b) => a.fromLeftFeet - b.fromLeftFeet).map((o) => openingLine(side, o, names.get(o.id) ?? OPENING_LABEL[o.kind])),
      ...[...(side.columns ?? [])].sort((a, b) => a.fromLeftFeet - b.fromLeftFeet).map((c) => columnLine(c, colNames.get(c.id) ?? COLUMN_LABEL[c.kind], colQ.get(c.id))),
      ...(side.fixtures ?? []).filter((f) => f.count > 0).map((f) => `${f.kind === "other" ? f.label?.trim() || "Other" : SIDE_FIXTURE_LABEL[f.kind]}: ${f.count} (${f.action === "replace" ? "replace" : "detach & reset"})`),
      ...(side.roofRead ? [`Roof read off its photo: ${roofReadWords(side.roofRead).join(", ") || "nothing taken"}.`] : []),
      ...(!sq.complete ? ["Not every height of this side was measured: its area is not counted."] : []),
      // A wall no photo faces (2026-10-21): said so, never left to read as a wall with no windows.
      ...(unseenWords(exterior, side) ? [unseenWords(exterior, side) as string] : []),
      ...deckAgainst(side.id),
    ];
    return {
      side,
      q: sq,
      rise: q.rises[side.id] ?? null,
      base: q.bases[side.id] ?? null,
      heading: `${side.name.trim() || "Side"} · ${side.lengthNotMeasured ? `about ${ft(sq.lengthFeet)}, NOT measured` : `${ft(sq.lengthFeet)}${pm ? ` ${pm}` : ""}`} · ${sf(sq.netSquareFeet)} net${unseenWords(exterior, side) ? " · not photographed" : ""}`,
      dims,
    };
  });

  // ---- The photos, each with what was read off it ----
  const photos: ReportPhoto[] = every.flatMap((side) => {
    const list = side.photos ?? [];
    const read = side.roofRead ? roofReadWords(side.roofRead) : [];
    const w = wallsFromPhoto(side);
    const walls = [w.shapes ? "the cladding" : "", w.openings > 0 ? `${w.openings} opening${w.openings === 1 ? "" : "s"}` : "", w.wallTop ? "the wall top" : ""].filter(Boolean);
    return list.map((photo, k) => ({
      sideName: side.name.trim() || "Side",
      photo,
      label: `${side.name.trim() || "Side"} · photo ${k + 1} of ${list.length}`,
      caption: [walls.length > 0 ? `Walls read off it: ${listWords(walls)}.` : "", read.length > 0 ? `Read for the roof: ${read.join(", ")}.` : ""].filter(Boolean).join(" "),
    }));
  });

  // ---- Where each number came from, and what is assumed ----
  const sources: string[] = [];
  const assumed: string[] = [];
  const from = sizesFrom(exterior);
  // Not scaled to anything (2026-10-15, the owner: "Should be scaled off of something"): said plainly.
  const routeSizes = photoRouteSizes(exterior);
  sources.push(routeSizes ? routeSizes.line : scanned && scaleOf(exterior)?.from === "phone" ? NOT_SCALED : `Sizes: ${from ? `from ${from}` : scanned ? "from the phone" : "as drawn and typed in Scrivn"}.`);
  // How well the tapes agree with each other, held out in turn (2026-10-23): a confidence note on the house as a whole.
  const spread = routeSizes ? exterior.photoRoute?.measured?.tapeSpread : undefined;
  if (spread) sources.push(spread.words);
  sources.push(
    photosOnly
      ? "Walls, heights, materials and openings: read off the photos, side by side round the house; nothing was tapped on the walls."
      : scanned
        ? "Walls, heights, materials and openings: tapped on the phone, side by side round the house."
        : "Walls, heights, materials and openings: as entered in Scrivn.",
  );
  // The trim (2026-10-17): its own lines, read off the photos or entered; the field is what is left once it is off.
  const trimmed = every.filter((s) => !sharedIds.has(s.id) && hasTrim(s));
  if (trimmed.length > 0) {
    const read = trimmed.some((s) => s.openings.some((o) => o.trim?.from === "photo") || (s.columns ?? []).some((c) => c.from === "photo"));
    sources.push(
      `Trim - surrounds, keystones, columns and pilasters, on ${listWords(trimmed.map((s) => s.name.trim() || "Side"))}: ${read || photosOnly ? "read off the photos" : scanned ? "tapped on the phone" : "as entered in Scrivn"}, each its own line. The wall's cladding under it comes off the field, as an opening's does; its colours are the photos', for the drawings.`,
    );
  }
  // Read off the photos where nothing was tapped (2026-10-15, Finish exterior): said side by side, each part marked "from photo" below.
  const walled = every.filter((s) => {
    const w = wallsFromPhoto(s);
    return w.shapes || w.openings > 0 || w.wallTop;
  });
  if (walled.length > 0) sources.push(`Read off the side's photo where nothing was tapped (Finish exterior), marked "from photo": ${walled.map((s) => {
    const w = wallsFromPhoto(s);
    return `${s.name} (${listWords([w.shapes ? "cladding" : "", w.openings > 0 ? `${w.openings} opening${w.openings === 1 ? "" : "s"}` : "", w.wallTop ? "wall top" : ""].filter(Boolean))})`;
  }).join(", ")}.`);
  // Heights from the sides beside them (2026-10-15): not seen in a photo, or its photo didn't show the top.
  const borrowed = every.filter((s) => s.wallTopFrom === "neighbours").map((s) => s.name);
  if (borrowed.length > 0) assumed.push(`${listWords(borrowed)}: ${borrowed.length === 1 ? "its height is" : "their heights are"} the sides' beside ${borrowed.length === 1 ? "it" : "them"} at the corners, not seen in a photo; no openings unless tapped.`);
  const drawn = every.filter((s) => s.lengthFrom === "drawn").map((s) => s.name);
  if (drawn.length > 0) assumed.push(`${listWords(drawn)}: ${drawn.length === 1 ? "its length is" : "their lengths are"} only drawn, not measured.`);
  const unmeasured = sides.filter((s) => !s.q.complete).map((s) => s.side.name);
  if (unmeasured.length > 0) assumed.push(`${listWords(unmeasured)}: not every height was measured, so ${unmeasured.length === 1 ? "its" : "their"} wall area is left out.`);
  if (plan && r) {
    sources.push(`Pitch: ${pitchWords(q.pitch)}.`);
    if (q.pitch.source === "assumed") assumed.push(`The pitch, ${formatPitch(q.pitch.value ?? 4)}: nothing measured it. Type it, or photograph a gable square-on.`);
    for (const s of plan.sections) {
      if (s.key === "main" || Math.abs(s.pitch - (q.pitch.value ?? s.pitch)) < 1e-6) continue;
      sources.push(`${sectionName(s, nameOf, exterior)}: ${formatPitch(s.pitch)}${exterior.roof.sectionPitches?.[s.key] !== undefined ? ", typed" : ", from its gable's photo"}.`);
    }
    sources.push(`Eave overhang: ${overhangWords(r.overhangs.eave, "eave")}.`);
    sources.push(`Rake overhang: ${overhangWords(r.overhangs.rake, "rake")}.`);
    if (r.overhangs.eave.source === "default") assumed.push(`The eave overhang, ${ft(DEFAULT_EAVE_OVERHANG_FEET)}: Scrivn's default. Tape it, or take the corner photo.`);
    if (r.overhangs.rake.source === "default") assumed.push(`The rake overhang, ${ft(DEFAULT_RAKE_OVERHANG_FEET)}: Scrivn's default. Tape it, or photograph a gable square-on.`);
    const fromPhotos = endsFromPhotos(exterior);
    const typedEnds = exterior.roof.ends;
    const ends = plan.ends.map((e) => ({ ...e, name: nameOf(e.sideId), how: e.sideId in typedEnds ? "set by the estimator" : fromPhotos.has(e.sideId) ? "from its photo" : "assumed" }));
    if (ends.length > 0) {
      sources.push(`Roof ends: ${ends.map((e) => `${e.name} ${e.kind} (${e.how})`).join(", ")}.`);
      const guessed = ends.filter((e) => e.how === "assumed");
      if (guessed.length > 0) assumed.push(`The roof end${guessed.length === 1 ? "" : "s"} over ${listWords(guessed.map((e) => e.name))}: ${guessed.length === 1 ? "a gable, as nothing" : "gables, as nothing"} says otherwise. A photo of the side, or a tap on the plan, settles it.`);
    }
    // The roof check's parts as proposed off the outline and the photos, until the estimator answers them or says it looks right (2026-10-16).
    if (!exterior.roof.checkedAt) {
      const answered = new Set(exterior.roof.answered ?? []);
      const parts = (roofProposal(exterior)?.proposed ?? [])
        .filter((p) => !answered.has(p.key))
        .map((p) => {
          const id = p.key.slice(p.key.indexOf(":") + 1);
          if (p.key.startsWith("notch:")) {
            const k = plan.notches.find((n) => n.sideId === id);
            return `the corner at ${listWords((k?.sideIds ?? [id]).map(nameOf))} under the roof`;
          }
          return `the part out to ${nameOf(id)} lower, ${p.value === "gable" ? "under a gable on the roof it meets" : "under its eave"}`;
        });
      if (parts.length > 0) assumed.push(`The roof's parts as proposed off the outline and the photos, not yet checked: ${parts.join("; ")}. Check them on the roof plan.`);
    }
    // A lower roof's eave under the roof it meets (2026-10-16, lib/roofCheck.ts `wingDrops`): what the views stand it at.
    for (const [id, d] of Object.entries(q.wingDrops)) {
      if (d.source === "assumed") assumed.push(`The roof out to ${nameOf(id)} sits ${ft(d.feet)} under the eave of the roof it meets: Scrivn's assumption, as nothing measured it. Type it on the roof check.`);
      else sources.push(`The roof out to ${nameOf(id)}: ${ft(d.feet)} under the eave of the roof it meets, ${d.source === "typed" ? "as set on the roof check" : "as its walls and the other roof's measure where they meet"}.`);
    }
    const taken = r.pieces.list.filter((x) => x.figures.missing.length === 0);
    if (taken.length > 0) sources.push(`Roof pieces: ${taken.map((x) => pieceLine(x.piece, x.figures, r.pitch)).join("; ")}.`);
    if (r.gutter.downspoutsCounted && r.gutter.downspouts > 0) assumed.push(`Downspouts: ${r.gutter.downspouts}, one for each ${FEET_PER_DOWNSPOUT}' of eavestrough run or part of one, counted by rule.`);
    if (r.gutter.downspoutFeet !== null && !r.gutter.downspoutFeetTyped && r.gutter.downspouts > 0) assumed.push(`Downspout length: each eave's height plus 15%.`);
  } else if (q.footprint.closes) {
    sources.push("Roof: not drawn.");
  } else {
    sources.push(`Roof: none yet - ${q.footprint.reason ?? "the sides don't close into a footprint"}.`);
  }
  const fin = exterior.source?.finish;
  if (fin?.at) {
    const when = fin.at.slice(0, 16).replace("T", " ");
    sources.push(`The roof was read off the side photos on the phone (Finish exterior, ${when} UTC)${fin.acceptedAt ? ", and accepted there" : ", not yet accepted"}.`);
  }

  // ---- The cover's facts ----
  const facts: ReportFact[] = [];
  const fp = q.footprint;
  // A semi-detached house or a townhouse (2026-10-17): what it is, and which walls are shared and not counted.
  const home = homeTypeWords(exterior);
  if (home) facts.push({ label: "Home", value: home });
  facts.push({ label: "Footprint", value: fp.closes ? `${sf(fp.areaSquareFeet)} · perimeter ${ft(fp.perimeterFeet)} · ${plural(fp.sideIds.length, "side")}` : `${plural(every.length, "side")}, not closed${fp.reason ? `: ${fp.reason}` : ""}` });
  facts.push({ label: "Walls", value: `${sf(q.totals.grossSquareFeet)} gross · ${sf(q.totals.openingSquareFeet)} of openings · ${q.trim ? `${sf(q.totals.trimSquareFeet ?? 0)} of trim · ` : ""}${sf(q.totals.netSquareFeet)} net` });
  // How much of the cladding was read off photos rather than tapped, side by side.
  const photoNet = sides.reduce((sum, s) => {
    const ids = new Set((s.side.shapes ?? []).filter((x) => x.from === "photo").map((x) => x.id));
    return sum + s.q.bands.filter((b) => ids.has(b.bandId)).reduce((t, b) => t + b.netSquareFeet, 0);
  }, 0);
  if (q.cladding.length > 0) facts.push({ label: "Cladding", value: q.cladding.map((c) => `${c.label} ${sf(c.netSquareFeet)} net`).join(" · ") + (photoNet > 0.5 ? ` (${sf(photoNet)} of it read off photos)` : "") });
  const count = (k: ExteriorOpening["kind"]) => every.reduce((n, s) => n + s.openings.filter((o) => o.kind === k).length, 0);
  // A roll-up door (2026-10-19) is said only where there is one, and then "0 garage doors" is not.
  const rollups = count("rollup");
  facts.push({
    label: "Openings",
    value: [
      plural(count("window"), "window"),
      plural(count("door"), "door"),
      ...(count("garage") > 0 || rollups === 0 ? [plural(count("garage"), "garage door")] : []),
      ...(rollups > 0 ? [plural(rollups, "roll-up door")] : []),
    ].join(" · "),
  });
  // The trim (2026-10-17), in a line: the owner's "differentiate these in the report".
  if (q.trim) {
    const t = q.trim;
    const n = t.surrounds.reduce((s, g) => s + g.count, 0);
    const lfAll = t.surrounds.reduce((s, g) => s + g.linearFeet, 0);
    const sfAll = t.surrounds.reduce((s, g) => s + g.squareFeet, 0);
    const cols = t.columns.reduce((s, g) => s + g.count, 0);
    const wrap = t.columns.reduce((s, g) => s + g.wrapSquareFeet, 0);
    facts.push({
      label: "Trim",
      value: [
        ...(n > 0 ? [`${plural(n, "surround")} ${lf(lfAll)} (${sf(sfAll)})`] : []),
        ...(t.keystones > 0 ? [plural(t.keystones, "keystone")] : []),
        ...(cols > 0 ? [`${plural(cols, "column or pilaster", "columns and pilasters")} (${sf(wrap)} wrap)`] : []),
      ].join(" · "),
    });
  }
  // The decks (2026-10-20), a line: each by its name, its area and how high it stands.
  if (deckQs.length > 0) {
    facts.push({
      label: deckQs.length === 1 ? "Deck" : "Decks",
      value: deckQs.map((d) => `${d.name} ${sf(d.areaSquareFeet)}, ${heightWords(d)}${coveredShare(d) ? (d.openSquareFeet < 0.5 ? ", under the roof" : `, ${sf(d.coveredSquareFeet)} of it under the roof`) : ""}`).join(" · "),
    });
  }
  if (r && plan) {
    const pitches = r.byPitch.length > 1 ? r.byPitch.map((b) => `${formatPitch(b.pitch)}${b.assumed ? " (assumed)" : b.fromPhotos ? " (from photos)" : ""} on ${b.squares.toFixed(2)} SQ`).join(", ") : `${formatPitch(r.pitch)}${r.pitchAssumed ? " (assumed)" : r.pitchFromPhotos ? " (from photos)" : ""}`;
    facts.push({ label: "Roof", value: `${r.squares.toFixed(2)} SQ (${sf(r.areaSquareFeet)}) · ${pitches}` });
    facts.push({ label: "Roof lines", value: lineTotals(plan).map(({ kind, feet }) => `${LINE_WORD[kind]} ${ft(feet)}`).join(" · ") });
    facts.push({ label: "Overhangs", value: `eave ${ft(r.overhangs.eave.feet)}${r.overhangs.eave.source === "default" ? " (assumed)" : r.overhangs.eave.source === "photos" ? " (from photos)" : ""} · rake ${ft(r.overhangs.rake.feet)}${r.overhangs.rake.source === "default" ? " (assumed)" : r.overhangs.rake.source === "photos" ? " (from photos)" : ""}` });
  }
  if (from || routeSizes) facts.push({ label: "Sizes from", value: routeSizes ? routeSizes.short : (from as string) });

  // ---- The tables ----
  const tables: ReportTable[] = [];
  // With trim (2026-10-17) the wall tables have a column for what it took off; without, they are as they were.
  const withTrim = !!q.trim;
  const trimCol = (v: number | undefined) => (withTrim ? [one(v ?? 0)] : []);
  tables.push({
    caption: "Walls by side and material",
    columns: [
      { title: "Side", weight: 2 },
      { title: "Material", weight: 2 },
      { title: "From", weight: 1.2 },
      { title: "Gross SF", weight: 1, align: "center" },
      { title: "Openings SF", weight: 1, align: "center" },
      ...(withTrim ? [{ title: "Trim SF", weight: 1, align: "center" as const }] : []),
      { title: "Net SF", weight: 1, align: "center" },
    ],
    rows: sides.flatMap((s) => {
      const ids = new Set((s.side.shapes ?? []).filter((x) => x.from === "photo").map((x) => x.id));
      const own = s.side.wallTopFrom === "neighbours" ? "neighbours" : ownFrom;
      return s.q.bands.length === 0
        ? [[s.side.name, s.q.complete ? "-" : "not counted", "-", "-", "-", ...(withTrim ? ["-"] : []), "-"]]
        : s.q.bands.map((b, k) => [k === 0 ? s.side.name : "", b.label, ids.has(b.bandId) ? "photo" : own, one(b.grossSquareFeet), one(b.openingSquareFeet), ...trimCol(b.trimSquareFeet), one(b.netSquareFeet)]);
    }),
    note: `Gross includes the gable triangles (${sf(q.totals.gableSquareFeet)} in all). Parging is not counted as cladding. An opening comes off only the part of it inside the cladding.${withTrim ? " So does the trim over it - surrounds, keystones and pilasters - once, where it covers counted cladding: the net is the field." : ""}`,
  });
  if (q.cladding.length > 0) {
    const sided = q.cladding.filter((c) => SIDING_KINDS.includes(c.kind)).reduce((s, c) => s + c.netSquareFeet, 0);
    tables.push({
      caption: "Walls by material",
      columns: [
        { title: "Material", weight: 3 },
        { title: "Gross SF", weight: 1, align: "center" },
        { title: "Openings SF", weight: 1, align: "center" },
        ...(withTrim ? [{ title: "Trim SF", weight: 1, align: "center" as const }] : []),
        { title: "Net SF", weight: 1, align: "center" },
      ],
      rows: [
        ...q.cladding.map((c) => [c.label || CLADDING_LABEL[c.kind], one(c.grossSquareFeet), one(c.openingSquareFeet), ...trimCol(c.trimSquareFeet), one(c.netSquareFeet)]),
        ["All walls", one(q.totals.grossSquareFeet), one(q.totals.openingSquareFeet), ...trimCol(q.totals.trimSquareFeet), one(q.totals.netSquareFeet)],
      ],
      ...(sided > 0 ? { note: `House wrap under the siding: ${one(sided)} SF.` } : {}),
    });
  }
  // The trim (2026-10-17): each surround and column where it is, then the lines the scope prices.
  if (q.trim) {
    const rows = sides.flatMap((s) => {
      if (!s.q.trim || s.shared) return [];
      const names = openingNames(s.side);
      const colNames = columnNames(s.side);
      const byOpening = new Map(s.side.openings.map((o) => [o.id, o]));
      const surrounds = [...s.q.trim.surrounds]
        .sort((a, b) => (byOpening.get(a.openingId)?.fromLeftFeet ?? 0) - (byOpening.get(b.openingId)?.fromLeftFeet ?? 0))
        .map((g) => {
          const o = byOpening.get(g.openingId) as ExteriorOpening;
          return [`${names.get(o.id) ?? OPENING_LABEL[o.kind]} surround`, surroundWords(o.trim as OpeningTrim).replace(/^surround /, "").replace(/ \([^)]*trim\)$/, ""), one(g.linearFeet), one(g.squareFeet)];
        });
      const byColumn = new Map((s.side.columns ?? []).map((c) => [c.id, c]));
      const columns = [...s.q.trim.columns]
        .sort((a, b) => (byColumn.get(a.id)?.fromLeftFeet ?? 0) - (byColumn.get(b.id)?.fromLeftFeet ?? 0))
        .map((g) => {
          const c = byColumn.get(g.id) as SideColumn;
          const blocks = [g.base ? "base" : "", g.cap ? "cap" : ""].filter(Boolean);
          return [colNames.get(c.id) ?? COLUMN_LABEL[c.kind], `${formatOpeningSize(c.widthFeet, c.depthFeet)} × ${ft(c.heightFeet)} high${blocks.length > 0 ? `, ${blocks.join(" and ")}` : ""}`, "-", `${one(g.wrapSquareFeet)} wrap`];
        });
      return [...surrounds, ...columns].map((r, k) => [k === 0 ? s.side.name : "", ...r]);
    });
    tables.push({
      caption: "Trim by side",
      columns: [
        { title: "Side", weight: 2 },
        { title: "Trim", weight: 1.8 },
        { title: "Size", weight: 3.6 },
        { title: "LF", weight: 0.8, align: "center" },
        { title: "SF", weight: 1, align: "center" },
      ],
      rows,
      note: "A surround's widths are past the opening; LF is each piece along its run - the jambs full height, the head and sill between them - and SF its face, a keystone's part past the head included. A column's size is across, front to back and high; its wrap is round the shaft where it is clad, times its height.",
    });
    const t = q.trim;
    const totalRows: string[][] = [];
    for (const label of [...new Set(t.surrounds.map((g) => g.label))]) {
      const mine = t.surrounds.filter((g) => g.label === label);
      for (const g of mine) totalRows.push([`${label} trim – ${SURROUND_WORDS[g.openingKind]}`, String(g.count), one(g.linearFeet), one(g.squareFeet)]);
      const keys = mine.reduce((n, g) => n + g.keystones, 0);
      if (keys > 0) totalRows.push([`${label} trim – keystones`, String(keys), "-", "-"]);
    }
    for (const c of t.columns) {
      const what = c.kind === "column" ? "Columns" : "Pilasters";
      totalRows.push([`${what} – ${c.label.toLowerCase()} wrap`, String(c.count), "-", one(c.wrapSquareFeet)]);
      if (c.caps > 0) totalRows.push([`${what} – caps`, String(c.caps), "-", "-"]);
      if (c.bases > 0) totalRows.push([`${what} – bases`, String(c.bases), "-", "-"]);
    }
    tables.push({
      caption: "Trim totals",
      columns: [
        { title: "", weight: 3 },
        { title: "Count", weight: 1, align: "center" },
        { title: "LF", weight: 1, align: "center" },
        { title: "SF", weight: 1, align: "center" },
      ],
      rows: totalRows,
      note: `Taken off the cladding under it: ${one(t.squareFeet)} SF - the trim's face where it covers counted cladding (not parging), each square foot once.`,
    });
  }
  const openingRows = every.flatMap((side) => {
    const names = openingNames(side);
    return [...side.openings]
      .sort((a, b) => a.fromLeftFeet - b.fromLeftFeet)
      .map((o) => [side.name, names.get(o.id) ?? OPENING_LABEL[o.kind], o.notMeasured ? "not measured" : o.from === "photo" ? "photo" : o.from === "said" ? "said on site" : ownFrom, formatOpeningSize(o.widthFeet, o.heightFeet), ft(sillOf(side, o)), ft(o.fromLeftFeet), one(o.widthFeet * o.heightFeet)]);
  });
  if (openingRows.length > 0) {
    tables.push({
      caption: "Openings",
      columns: [
        { title: "Side", weight: 2 },
        { title: "Opening", weight: 2 },
        { title: "From", weight: 1.2 },
        { title: "Width × height", weight: 2, align: "center" },
        { title: "Sill", weight: 1, align: "center" },
        { title: "From the left", weight: 1.3, align: "center" },
        { title: "SF", weight: 1, align: "center" },
      ],
      rows: openingRows,
      note: `${q.openings.map((g) => `${g.count} × ${OPENING_LABEL[g.kind].toLowerCase()} ${formatOpeningSize(g.widthFeet, g.heightFeet)}`).join("; ")}. Trim round them: ${lf(q.totals.openingTrimFeet)}.`,
    });
  }
  if (r) {
    const fromWord = (k: keyof typeof r.from) => (r.from[k] === "drawing" ? (plan ? "the drawing" : "") : r.from[k] === "estimator" ? "typed" : r.from[k] === "report" ? "the roof report" : "typed and the drawing");
    const lineRow = (label: string, feet: number, k: keyof typeof r.from, note = "") => [label, one(feet), fromWord(k) + (note ? ` (${note})` : "")];
    tables.push({
      caption: "Roof lines",
      columns: [
        { title: "Line", weight: 3 },
        { title: "LF", weight: 1, align: "center" },
        { title: "From", weight: 3 },
      ],
      rows: [
        lineRow("Ridge", r.ridgeFeet, "ridge"),
        lineRow("Hips", r.hipFeet, "hip"),
        lineRow("Hip & ridge cap", r.ridgeFeet + r.hipFeet, "ridge", "ridge + hips"),
        lineRow("Valleys", r.valleyFeet, "valley"),
        lineRow("Eaves", r.eaveFeet, "eave"),
        lineRow("Rakes", r.rakeFeet, "rake"),
        lineRow("Step flashing", r.stepFeet, "step"),
        lineRow("Headwall flashing", r.headwallFeet, "headwall"),
        lineRow("Drip edge", r.dripEdgeFeet, "dripEdge", "eaves + rakes"),
        lineRow("Starter", r.starterFeet, "starter", "eaves"),
        lineRow("Ice & water", r.iceWaterFeet, "iceWater", "eaves + valleys"),
        ...(r.material === "metal" ? [lineRow("Closure strips", r.closureFeet, "eave", "eaves + 2 × ridge")] : []),
        ...(r.ridgeVentFeet > 0 ? [lineRow("Ridge vent", r.ridgeVentFeet, "ridge")] : []),
        // Cut at a wall shared with the neighbour (2026-10-17): the firewall's cap and flashing, to check.
        ...(r.partyFeet > 0 ? [[`Party line`, one(r.partyFeet), "the drawing (the firewall's cap and flashing: to check)"]] : []),
      ],
      note: "Lengths along the roof: a hip, valley, rake or step along its slope, a ridge, eave or headwall level. Real lengths, no waste.",
    });
    const squareRows = [
      ...r.byPitch.map((b) => [`At ${formatPitch(b.pitch)}${b.assumed ? " (assumed)" : b.fromPhotos ? " (from photos)" : ""}`, b.squares.toFixed(2), sf(b.areaSquareFeet)]),
      ...(r.curved ? [["Curved roof pieces", r.curved.squares.toFixed(2), sf(r.curved.areaSquareFeet)]] : []),
      ["All the roof", r.squares.toFixed(2), sf(r.areaSquareFeet)],
      ...r.steepBands.map((b) => [`Steep, ${b.band}`, b.squares.toFixed(2), ""]),
      ...(r.high ? [[`High roof (two storeys or more${r.high.fromPhotos ? ", from photos" : ""})`, r.high.squares.toFixed(2), ""]] : []),
    ];
    tables.push({
      caption: "Roof squares",
      columns: [
        { title: "", weight: 3 },
        { title: "SQ", weight: 1, align: "center" },
        { title: "SF", weight: 1, align: "center" },
      ],
      rows: squareRows,
      note: `On the slope, real, with no waste added.${r.material ? ` Material: ${ROOF_MATERIAL_LABEL[r.material]}.` : ""}`,
    });
    if (r.slopes.length > 0 && plan) {
      tables.push({
        caption: "Slopes",
        columns: [
          { title: "Slope", weight: 1, align: "center" },
          { title: "Drains to", weight: 2 },
          { title: "Part", weight: 2.5 },
          { title: "Pitch", weight: 1, align: "center" },
          { title: "Plan SF", weight: 1, align: "center" },
          { title: "Roof SF", weight: 1, align: "center" },
        ],
        rows: r.slopes.map((s) => {
          const f = plan.facets.find((x) => x.key === s.key);
          const sec = f?.section ? plan.sections.find((x) => x.key === f.section) : undefined;
          return [s.label, s.faces || "-", sec ? sectionName(sec, nameOf, exterior) : f && f.layer > 0 ? "Lower roof" : "-", formatPitch(s.pitch), one(s.planSquareFeet), one(s.areaSquareFeet)];
        }),
      });
    }
    const g = r.gutter;
    tables.push({
      caption: "Soffit, fascia and eavestrough",
      columns: [
        { title: "", weight: 3 },
        { title: "Quantity", weight: 1.4, align: "center" },
        { title: "", weight: 3 },
      ],
      rows: [
        ["Soffit at the eaves", lf(r.soffit.eaveFeet), `${one(r.soffit.eaveSquareFeet)} SF at ${ft(r.overhangs.eave.feet)}${r.overhangs.eave.source === "default" ? " (assumed)" : r.overhangs.eave.source === "photos" ? " (from photos)" : ""}`],
        ["Soffit at the rakes", lf(r.soffit.rakeFeet), `${one(r.soffit.rakeSquareFeet)} SF at ${ft(r.overhangs.rake.feet)}${r.overhangs.rake.source === "default" ? " (assumed)" : r.overhangs.rake.source === "photos" ? " (from photos)" : ""}`],
        ...(q.floorSoffitSquareFeet > 0.05 ? [["Floor soffit (upper floor past the walls)", sf(q.floorSoffitSquareFeet), ""]] : []),
        ["Fascia", lf(r.fasciaFeet), "eaves + rakes"],
        ["Eavestrough", lf(g.feet), `${g.endCaps} end caps, ${g.outsideMitres} outside and ${g.insideMitres} inside mitres`],
        ["Downspouts", String(g.downspouts), `${g.downspoutFeet === null ? "length to measure" : `${lf(g.downspoutFeet)}${g.downspoutFeetTyped ? "" : " (eave height + 15%)"}`}; ${g.drops} drops, ${g.elbows} elbows`],
      ],
      note: r.allEdges ? undefined : "Only the eaves and rakes chosen on the roof plan are counted.",
    });
  }
  tables.push({
    caption: "Corners and trim",
    columns: [
      { title: "", weight: 3 },
      { title: "LF", weight: 1, align: "center" },
    ],
    rows: [
      ["Outside corners", one(q.totals.outsideCornerFeet)],
      ["Inside corners", one(q.totals.insideCornerFeet)],
      ["Trim round openings", one(q.totals.openingTrimFeet)],
    ],
  });
  if (r) {
    const asks = [...r.toAnswer.roofing, ...r.toAnswer.eavestrough, ...r.toAnswer.soffitFascia];
    if (asks.length > 0) {
      tables.push({
        caption: "Still to answer for the scope",
        columns: [{ title: "Asked before the roof, eavestrough, soffit and fascia can be priced", weight: 1 }],
        rows: asks.map((a) => [a.charAt(0).toUpperCase() + a.slice(1)]),
      });
    }
  }

  // ---- The roof plan's words ----
  let roof: ExteriorReport["roof"] = null;
  if (plan && r && q.footprint.closes) {
    const pitches =
      r.byPitch.length > 1 || r.curved
        ? [...r.byPitch.map((b) => `${formatPitch(b.pitch)}${b.assumed ? " (assumed)" : b.fromPhotos ? " (from photos)" : ""}`), ...(r.curved ? ["curved"] : [])].join(" and ")
        : `${formatPitch(r.pitch)}${r.pitchAssumed ? " (assumed)" : r.pitchFromPhotos ? " (from photos)" : ""}`;
    roof = {
      title: `${pitches} · ${r.squares.toFixed(2)} SQ (${sf(r.areaSquareFeet)}) · eave overhang ${ft(r.overhangs.eave.feet)}, rake ${ft(r.overhangs.rake.feet)} · front at the bottom`,
      legend: lineTotals(plan),
      slopes: r.slopes.map((s) => `${s.label} ${Math.round(s.areaSquareFeet)} SF at ${formatPitch(s.pitch)}${s.faces ? ` (${s.faces})` : ""}`).join(" · "),
      notes: [plan.note, ...photoNotes(exterior)].filter((n): n is string => !!n),
    };
  }

  // A length worked out from the photos and further out than it should be: named to tape (2026-10-16).
  const toTape = every.filter((s) => lengthToCheck(s) !== undefined && !s.lengthNotMeasured).map((s) => `${s.name.trim() || "Side"}: ${ft(s.lengthFeet)} ${plusMinus(s)}, worked out from the photos${s.lengthEstimatedFeet ? ` and ${estimatedWords(s)}` : ""}, not taped. Tape it to be sure.`);
  // A size the photos and tapes don't hold (2026-10-22): said not measured, why, and the one photo or tape that measures it -
  // first, with what rests on it: never a confident number.
  const notMeasuredSides = every.filter((s) => s.lengthNotMeasured);
  const notMeasuredLengths = notMeasuredSides.length
    ? [
        `NOT measured: ${notMeasuredSides.map((s) => s.name.trim() || "Side").join(", ")}. Their lengths are drawn from the photos to lay the house out, not sizes; the wall and roof areas that rest on them are rough until they are measured.`,
        ...notMeasuredSides.map((s) => `${s.name.trim() || "Side"}: NOT measured (about ${ft(s.lengthFeet)}): ${s.lengthNotMeasured}`),
      ]
    : [];
  // What a photo couldn't settle and nobody answered on "Check these" (2026-10-16, lib/exteriorCheck.ts): a part-hidden opening, an assumed drop.
  // A wall no photo faces (2026-10-21): what is on it isn't known, or was only said - a photo of it straight on settles it.
  const unseen = every.flatMap((s) => {
    const w = unseenWords(exterior, s);
    return w ? [`${s.name.trim() || "Side"}: ${w.charAt(0).toLowerCase()}${w.slice(1)} A photo of it straight on settles it.`] : [];
  });
  // Openings counted off a photo that sees their wall edge-on (2026-10-22): there, but not measured.
  const notMeasuredNotes = every.flatMap((s) => {
    const list = s.openings.filter((o) => o.notMeasured);
    if (list.length === 0) return [];
    return [`${s.name.trim() || "Side"}: ${list.length} ${list.length === 1 ? "opening" : "openings"} not measured (${list[0]?.notMeasured}): sizes and places to check. A photo of it straight on measures them.`];
  });
  const notes = [...notMeasuredLengths, ...toTape, ...unseen, ...notMeasuredNotes, ...checkNotes(exterior, q), ...(roof?.notes ?? [])];

  // ---- The house from each side: the 3D model, square-on, named by the compass when the front's bearing is known ----
  const model = exteriorModel(exterior);
  const facing = frontFacesOf(exterior);
  const views: ReportView[] = model.ok
    ? VIEWS.map((from) => houseView(model.model, from, facing))
        .filter((v) => v.sides.length > 0)
        .map((view) => ({
          view,
          heading: facing === undefined ? view.title : `${view.title} · ${VIEW_PLACE[view.from]}`,
          shows: `Shows ${listWords(view.sides.map((s) => s.name))}.`,
        }))
    : [];
  const decks = deckQs.length > 0 ? deckReport(exterior, deckQs, plan) : null;
  if (decks) {
    sources.push(...decks.sources);
    // A stair's treads at the usual going, nobody having measured one: said.
    const assumedRun = deckQs.flatMap((d) => d.stairs.filter((s) => s.stair.runFeet === undefined).map(() => d.name));
    if (assumedRun.length > 0) assumed.push(`${listWords([...new Set(assumedRun)])}: the stairs' treads are drawn ${ft(10 / 12)} deep, the usual going; nothing measured one.`);
  }
  return { meta, exterior, q, facts, sources, assumed, notes, sides, views, photos, tables, roof, ...(decks ? { decks } : {}) };
}

/** A deck's height in words: "7'6" up", or "7'6" up at the wall, 4'10" at its outer edge" where the ground steps under it. */
function heightWords(d: DeckQuantities): string {
  const out = d.deck.heightOutFeet;
  return out !== undefined && Math.abs(out - d.heightFeet) > 1 / 24 ? `${ft(d.heightFeet)} up at the wall, ${ft(out)} at its outer edge` : `${ft(d.heightFeet)} up`;
}

/**
 * The decks' part of the report (2026-10-20): each deck with its plan, its facts and its lines, then the tables of them all -
 * the platforms, the railings, the stairs, what is under them, and every line as the scope prices it once the deck is ticked.
 */
function deckReport(exterior: Exterior, deckQs: DeckQuantities[], plan: RoofPlan | null): ReportDecks {
  const shapes = deckPlanShapes(exterior, plan);
  const sideName = (id: string | null) => (id ? allSides(exterior).find((s) => s.id === id)?.name.trim() || "Side" : null);
  const list: ReportDeck[] = deckQs.flatMap((dq) => {
    const shape = shapes.find((s) => s.id === dq.deck.id);
    if (!shape) return [];
    const d = dq.deck;
    const g = dq.geometry;
    const ledgers = (g?.edges ?? []).flatMap((e) => e.against.map((a) => `${a.name} ${ft(a.toFeet - a.fromFeet)}`));
    const facts: ReportFact[] = [
      { label: "Where", value: d.sideId ? `Against the ${sideName(d.sideId)}${ledgers.length > 0 ? `; its ledger along ${listWords(ledgers)}` : ""}` : "Free-standing" },
      {
        label: "Platform",
        value: `${sf(dq.areaSquareFeet)} · ${ft(dq.heightFeet)} up${d.heightOutFeet !== undefined && Math.abs(d.heightOutFeet - d.heightFeet) > 1 / 24 ? `, ${ft(d.heightOutFeet)} at its outer edge` : ""}${coveredShare(dq) ? ` · ${sf(dq.coveredSquareFeet)} under the house's roof (in the roof's squares, not again here)` : dq.coveredSquareFeet > 0.5 ? ` · open to the sky but for the eave's overhang over ${sf(dq.coveredSquareFeet)}` : " · open to the sky"}`,
      },
      { label: "Decking", value: `${d.decking === "other" && d.deckingLabel ? d.deckingLabel : DECKING_LABEL[d.decking]}${d.deckingRead?.unsure && !d.deckingRead.confirmed ? " (to check)" : ""}` },
      ...(dq.railingByKind.length > 0 ? [{ label: "Railings", value: dq.railingByKind.map((r) => `${r.label} ${lf(r.feet)}${r.gates > 0 ? `, ${plural(r.gates, "gate")}` : ""}`).join(" · ") }] : []),
      ...(dq.stairs.length > 0 ? [{ label: "Stairs", value: dq.stairs.map((s) => stairWords(s)).join(" · ") }] : []),
      {
        label: "Under it",
        value:
          [
            dq.posts.count > 0 ? `${plural(dq.posts.count, "post")} (${Math.round(dq.posts.sizeInches)}×${Math.round(dq.posts.sizeInches)}${dq.posts.material ? ` ${POST_MATERIAL_LABEL[dq.posts.material].toLowerCase()}` : ""}, ${postHeightWords(dq)})` : "",
            ...dq.beams.map((b) => `a beam ${ft(b.lengthFeet)}${b.size ? ` (${b.size})` : ""}`),
            ...screenGroups(dq).map((g) => `${SCREEN_LABEL[g.kind].toLowerCase()}, ${g.material}, ${sf(g.squareFeet)}`),
          ]
            .filter(Boolean)
            .join(" · ") || "Nothing read",
      },
    ];
    return [{ q: dq, shape, heading: `${dq.name} · ${sf(dq.areaSquareFeet)} · ${heightWords(dq)}`, facts, lines: deckLines(dq) }];
  });
  const sources: string[] = [];
  const fromPhotos = deckQs.filter((d) => d.deck.from === "photos");
  if (fromPhotos.length > 0) {
    const taps = fromPhotos.reduce((n, d) => n + (d.deck.taps?.length ?? 0), 0);
    const photos = new Set(fromPhotos.flatMap((d) => (d.deck.taps ?? []).map((t) => t.photo))).size;
    sources.push(
      `${listWords(fromPhotos.map((d) => d.name))}: placed off the photos by the photo route's own cameras${taps > 0 ? ` (${plural(taps, "tap")} on ${plural(photos, "photo")})` : ""}; railings, stairs, posts and screens read off the photos. Each ledger is worked out from where it meets the walls.`,
    );
  }
  const typed = deckQs.filter((d) => d.deck.from !== "photos");
  if (typed.length > 0) sources.push(`${listWords(typed.map((d) => d.name))}: as entered in Scrivn${typed.some((d) => d.deck.from === "quick") ? " (the quick-deck box)" : ""}. Each ledger is worked out from where it meets the walls.`);
  const tables: ReportTable[] = [];
  tables.push({
    caption: "Decks",
    columns: [
      { title: "Deck", weight: 1.6 },
      { title: "Against", weight: 1.8 },
      { title: "Area SF", weight: 0.9, align: "center" },
      { title: "Under the roof SF", weight: 1.1, align: "center" },
      { title: "Height", weight: 0.9, align: "center" },
      { title: "Decking", weight: 1.5 },
      { title: "Ledger LF", weight: 0.9, align: "center" },
      { title: "Rim LF", weight: 0.9, align: "center" },
    ],
    rows: list.map((x) => [x.q.name, x.q.deck.sideId ? sideName(x.q.deck.sideId) ?? "-" : "Free-standing", one(x.q.areaSquareFeet), one(x.q.coveredSquareFeet), ft(x.q.heightFeet), DECKING_LABEL[x.q.deck.decking], one(x.q.ledgerFeet), one(x.q.rimFeet)]),
    note: "Area on the plan, real, no waste. What the house's roof covers is in the roof's squares already: it is not roofed again. The decking is never counted as wall.",
  });
  const railRows = list.flatMap((x) => {
    const edges = x.q.geometry?.edges ?? [];
    return x.q.railings
      .filter((r) => r.lengthFeet > 0.05)
      .map((r, k) => [k === 0 ? x.q.name : "", r.stairId ? "down the stairs" : edges[r.edge]?.name ?? "-", r.label.charAt(0).toUpperCase() + r.label.slice(1), r.stairId ? "-" : ft(r.heightFeet), one(r.lengthFeet), r.gates > 0 ? String(r.gates) : "-"]);
  });
  if (railRows.length > 0) {
    tables.push({
      caption: "Deck railings",
      columns: [
        { title: "Deck", weight: 1.6 },
        { title: "Where", weight: 2 },
        { title: "Railing", weight: 2.4 },
        { title: "Height", weight: 0.9, align: "center" },
        { title: "LF", weight: 0.8, align: "center" },
        { title: "Gates", weight: 0.7, align: "center" },
      ],
      rows: railRows,
      note: "Each run along its edge; a stair's along its slope.",
    });
  }
  const stairRows = list.flatMap((x) =>
    x.q.stairs.map((s, k) => [
      k === 0 ? x.q.name : "",
      x.q.geometry?.edges[s.stair.edge]?.name ?? "-",
      ft(s.stair.widthFeet),
      String(Math.round(s.stair.risers)),
      riseWords(s.riseFeet),
      ft(s.totalRunFeet),
      s.stair.landing && s.landingSquareFeet > 0 ? `${ft(s.stair.landing.depthFeet)} deep` : "-",
      s.stair.railing && s.stair.railing.sides > 0 ? `${railingWords(s.stair.railing.kind, s.stair.railing.label)}, ${s.stair.railing.sides === 2 ? "both sides" : "one side"}` : "none",
    ]),
  );
  if (stairRows.length > 0) {
    tables.push({
      caption: "Deck stairs",
      columns: [
        { title: "Deck", weight: 1.4 },
        { title: "Off", weight: 1.6 },
        { title: "Width", weight: 0.8, align: "center" },
        { title: "Risers", weight: 0.8, align: "center" },
        { title: "Each", weight: 0.8, align: "center" },
        { title: "Run", weight: 0.8, align: "center" },
        { title: "Landing", weight: 1, align: "center" },
        { title: "Railing", weight: 2.2 },
      ],
      rows: stairRows,
      note: "Each flight straight out from its edge: its rise is the deck's height, shared over its risers.",
    });
  }
  tables.push({
    caption: "Under the decks",
    columns: [
      { title: "Deck", weight: 1.6 },
      { title: "Posts", weight: 2 },
      { title: "Beams", weight: 1.6 },
      { title: "Screens and skirting", weight: 3 },
    ],
    rows: list.map((x) => [
      x.q.name,
      x.q.posts.count > 0 ? `${x.q.posts.count} × ${Math.round(x.q.posts.sizeInches)}×${Math.round(x.q.posts.sizeInches)}, ${postHeightWords(x.q)}` : "-",
      x.q.beams.length > 0 ? x.q.beams.map((b) => `${ft(b.lengthFeet)}${b.size ? ` ${b.size}` : ""}`).join(", ") : "not seen",
      x.q.screens.length > 0 ? screenGroups(x.q).map((g) => `${SCREEN_LABEL[g.kind]} ${g.material} ${ft(g.lengthFeet)}${g.heights.length === 1 ? ` × ${ft(g.heights[0] as number)}` : " long"} = ${one(g.squareFeet)} SF`).join("; ") : "-",
    ]),
  });
  tables.push({
    caption: "Deck lines",
    columns: [{ title: "As the scope prices each deck once it is ticked", weight: 1 }],
    rows: list.flatMap((x) => x.lines.map((l) => [l])),
  });
  return { list, sources, tables };
}

/** Each line's word in the legend and the facts: Scrivn's own (components/sketch/exteriorDrawings.tsx `LINE_STYLE`). */
export const LINE_WORD: Record<RoofLineKind, string> = {
  eave: "Eave",
  rake: "Rake",
  ridge: "Ridge",
  hip: "Hip",
  valley: "Valley",
  headwall: "Headwall flashing",
  step: "Step flashing",
  party: "Party line",
};

/** The plan drawn with every line's length (lib/roofLabels.ts): what a page of it is called. */
export function roofPlanCaption(plan: RoofPlan): string {
  return plan.shape === "other" ? "Roof outline (its lines are not worked out for this shape)" : "Roof plan";
}
