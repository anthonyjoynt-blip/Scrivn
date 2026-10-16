import {
  allSides,
  CLADDING_LABEL,
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
import { exteriorModel } from "./exterior3d";
import { NOT_SCALED, scaleOf, sizesFrom } from "./exteriorScale";
import { COMPASS, COMPASS_WORD, type Compass, type HouseView, houseView } from "./exteriorViews";
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
}

/** The whole house from one compass point (2026-10-16): lib/exteriorViews.ts. */
export interface ReportView {
  view: HouseView;
  /** "South elevation · the front". */
  heading: string;
  /** "Shows Garage front, west bay, ... and Front wall behind the porch." */
  shows: string;
}

/** Where each compass point is, the plan's front being south. */
const COMPASS_PLACE: Record<Compass, string> = { south: "the front", east: "to the right of the front", north: "the back", west: "to the left of the front" };

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
  /** The house from the south, east, north and west, before the sides one by one; none without a footprint. */
  views: ReportView[];
  photos: ReportPhoto[];
  tables: ReportTable[];
  /** The roof plan's title line, its legend and its slopes; null with no roof drawn. */
  roof: { title: string; legend: { kind: RoofLineKind; feet: number }[]; slopes: string; notes: string[] } | null;
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
  return `${name}: ${formatOpeningSize(o.widthFeet, o.heightFeet)}, ${sill > 0.04 ? `sill ${ft(sill)} up` : "at the bottom"}, ${ft(o.fromLeftFeet)} from the left end${o.from === "photo" ? " (from photo)" : ""}`;
}

/** "±6%": the ± a side's length is marked with, to check (`lengthToCheck`), or nothing. */
function plusMinus(side: ExteriorSide): string {
  const pct = lengthToCheck(side);
  return pct === undefined ? "" : `±${Math.max(1, Math.round(pct))}%`;
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

  // ---- The sides, each with every dimension ----
  const sides: ReportSide[] = every.map((side, i) => {
    const sq = q.sides[i] as SideQuantities;
    const names = openingNames(side);
    const ground = groundWords(side);
    const heights = [
      side.eaveLeftFeet != null ? `eave ${ft(aboveGround(side, side.eaveLeftFeet, 0))}${ground ? " above the ground" : ""} at the left` : null,
      side.eaveRightFeet != null ? `${ft(aboveGround(side, side.eaveRightFeet, side.lengthFeet))} at the right` : null,
      side.gable ? `peak ${ft(aboveGround(side, side.gable.peakFeet, side.gable.atFeet))}, ${ft(side.gable.atFeet)} from the left end` : sq.gableSource === "roof" ? `gable from the roof${q.pitch.source === "assumed" ? " (pitch assumed)" : ""}` : null,
      ground,
    ].filter(Boolean);
    const pm = plusMinus(side);
    const shapeFrom = new Set((side.shapes ?? []).filter((x) => x.from === "photo").map((x) => x.id));
    const dims = [
      `${side.lengthFrom === "drawn" ? "About " : ""}${ft(sq.lengthFeet)} long${side.lengthFrom === "drawn" ? " (drawn, not measured)" : ""}${pm ? ` ${pm} (worked out from the photos: to check)` : ""}${heights.length > 0 ? ` · ${heights.join(", ")}${side.wallTopFrom === "photo" ? " (from photo)" : side.wallTopFrom === "neighbours" ? ` (from the sides beside it: ${(side.photos ?? []).length === 0 ? "not seen in a photo" : "its photo didn't show the top"})` : ""}` : ""}${side.base === "parging" ? ` · parging ${ft(side.baseLeftFeet)} / ${ft(side.baseRightFeet)}` : ""}`,
      ...sq.bands.map((b) => `${b.label}: ${sf(b.grossSquareFeet)} gross, ${sf(b.openingSquareFeet)} of openings, ${sf(b.netSquareFeet)} net${shapeFrom.has(b.bandId) ? " (from photo)" : ""}`),
      ...[...side.openings].sort((a, b) => a.fromLeftFeet - b.fromLeftFeet).map((o) => openingLine(side, o, names.get(o.id) ?? OPENING_LABEL[o.kind])),
      ...(side.fixtures ?? []).filter((f) => f.count > 0).map((f) => `${f.kind === "other" ? f.label?.trim() || "Other" : SIDE_FIXTURE_LABEL[f.kind]}: ${f.count} (${f.action === "replace" ? "replace" : "detach & reset"})`),
      ...(side.roofRead ? [`Roof read off its photo: ${roofReadWords(side.roofRead).join(", ") || "nothing taken"}.`] : []),
      ...(!sq.complete ? ["Not every height of this side was measured: its area is not counted."] : []),
    ];
    return {
      side,
      q: sq,
      rise: q.rises[side.id] ?? null,
      base: q.bases[side.id] ?? null,
      heading: `${side.name.trim() || "Side"} · ${ft(sq.lengthFeet)}${pm ? ` ${pm}` : ""} · ${sf(sq.netSquareFeet)} net`,
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
  sources.push(
    photosOnly
      ? "Walls, heights, materials and openings: read off the photos, side by side round the house; nothing was tapped on the walls."
      : scanned
        ? "Walls, heights, materials and openings: tapped on the phone, side by side round the house."
        : "Walls, heights, materials and openings: as entered in Scrivn.",
  );
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
  facts.push({ label: "Footprint", value: fp.closes ? `${sf(fp.areaSquareFeet)} · perimeter ${ft(fp.perimeterFeet)} · ${plural(fp.sideIds.length, "side")}` : `${plural(every.length, "side")}, not closed${fp.reason ? `: ${fp.reason}` : ""}` });
  facts.push({ label: "Walls", value: `${sf(q.totals.grossSquareFeet)} gross · ${sf(q.totals.openingSquareFeet)} of openings · ${sf(q.totals.netSquareFeet)} net` });
  // How much of the cladding was read off photos rather than tapped, side by side.
  const photoNet = sides.reduce((sum, s) => {
    const ids = new Set((s.side.shapes ?? []).filter((x) => x.from === "photo").map((x) => x.id));
    return sum + s.q.bands.filter((b) => ids.has(b.bandId)).reduce((t, b) => t + b.netSquareFeet, 0);
  }, 0);
  if (q.cladding.length > 0) facts.push({ label: "Cladding", value: q.cladding.map((c) => `${c.label} ${sf(c.netSquareFeet)} net`).join(" · ") + (photoNet > 0.5 ? ` (${sf(photoNet)} of it read off photos)` : "") });
  const count = (k: ExteriorOpening["kind"]) => every.reduce((n, s) => n + s.openings.filter((o) => o.kind === k).length, 0);
  facts.push({ label: "Openings", value: [plural(count("window"), "window"), plural(count("door"), "door"), plural(count("garage"), "garage door")].join(" · ") });
  if (r && plan) {
    const pitches = r.byPitch.length > 1 ? r.byPitch.map((b) => `${formatPitch(b.pitch)}${b.assumed ? " (assumed)" : b.fromPhotos ? " (from photos)" : ""} on ${b.squares.toFixed(2)} SQ`).join(", ") : `${formatPitch(r.pitch)}${r.pitchAssumed ? " (assumed)" : r.pitchFromPhotos ? " (from photos)" : ""}`;
    facts.push({ label: "Roof", value: `${r.squares.toFixed(2)} SQ (${sf(r.areaSquareFeet)}) · ${pitches}` });
    facts.push({ label: "Roof lines", value: lineTotals(plan).map(({ kind, feet }) => `${LINE_WORD[kind]} ${ft(feet)}`).join(" · ") });
    facts.push({ label: "Overhangs", value: `eave ${ft(r.overhangs.eave.feet)}${r.overhangs.eave.source === "default" ? " (assumed)" : r.overhangs.eave.source === "photos" ? " (from photos)" : ""} · rake ${ft(r.overhangs.rake.feet)}${r.overhangs.rake.source === "default" ? " (assumed)" : r.overhangs.rake.source === "photos" ? " (from photos)" : ""}` });
  }
  if (from || routeSizes) facts.push({ label: "Sizes from", value: routeSizes ? routeSizes.short : (from as string) });

  // ---- The tables ----
  const tables: ReportTable[] = [];
  tables.push({
    caption: "Walls by side and material",
    columns: [
      { title: "Side", weight: 2 },
      { title: "Material", weight: 2 },
      { title: "From", weight: 1.2 },
      { title: "Gross SF", weight: 1, align: "center" },
      { title: "Openings SF", weight: 1, align: "center" },
      { title: "Net SF", weight: 1, align: "center" },
    ],
    rows: sides.flatMap((s) => {
      const ids = new Set((s.side.shapes ?? []).filter((x) => x.from === "photo").map((x) => x.id));
      const own = s.side.wallTopFrom === "neighbours" ? "neighbours" : ownFrom;
      return s.q.bands.length === 0
        ? [[s.side.name, s.q.complete ? "-" : "not counted", "-", "-", "-", "-"]]
        : s.q.bands.map((b, k) => [k === 0 ? s.side.name : "", b.label, ids.has(b.bandId) ? "photo" : own, one(b.grossSquareFeet), one(b.openingSquareFeet), one(b.netSquareFeet)]);
    }),
    note: `Gross includes the gable triangles (${sf(q.totals.gableSquareFeet)} in all). Parging is not counted as cladding. An opening comes off only the part of it inside the cladding.`,
  });
  if (q.cladding.length > 0) {
    const sided = q.cladding.filter((c) => SIDING_KINDS.includes(c.kind)).reduce((s, c) => s + c.netSquareFeet, 0);
    tables.push({
      caption: "Walls by material",
      columns: [
        { title: "Material", weight: 3 },
        { title: "Gross SF", weight: 1, align: "center" },
        { title: "Openings SF", weight: 1, align: "center" },
        { title: "Net SF", weight: 1, align: "center" },
      ],
      rows: [
        ...q.cladding.map((c) => [c.label || CLADDING_LABEL[c.kind], one(c.grossSquareFeet), one(c.openingSquareFeet), one(c.netSquareFeet)]),
        ["All walls", one(q.totals.grossSquareFeet), one(q.totals.openingSquareFeet), one(q.totals.netSquareFeet)],
      ],
      ...(sided > 0 ? { note: `House wrap under the siding: ${one(sided)} SF.` } : {}),
    });
  }
  const openingRows = every.flatMap((side) => {
    const names = openingNames(side);
    return [...side.openings]
      .sort((a, b) => a.fromLeftFeet - b.fromLeftFeet)
      .map((o) => [side.name, names.get(o.id) ?? OPENING_LABEL[o.kind], o.from === "photo" ? "photo" : ownFrom, formatOpeningSize(o.widthFeet, o.heightFeet), ft(sillOf(side, o)), ft(o.fromLeftFeet), one(o.widthFeet * o.heightFeet)]);
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
  const toTape = every.filter((s) => lengthToCheck(s) !== undefined).map((s) => `${s.name.trim() || "Side"}: ${ft(s.lengthFeet)} ${plusMinus(s)}, worked out from the photos, not taped. Tape it to be sure.`);
  const notes = [...toTape, ...(roof?.notes ?? [])];

  // ---- The house from each compass point: the 3D model, square-on ----
  const model = exteriorModel(exterior);
  const views: ReportView[] = model.ok
    ? COMPASS.map((c) => houseView(model.model, c))
        .filter((v) => v.sides.length > 0)
        .map((view) => ({
          view,
          heading: `${COMPASS_WORD[view.compass]} elevation · ${COMPASS_PLACE[view.compass]}`,
          shows: `Shows ${listWords(view.sides.map((s) => s.name))}.`,
        }))
    : [];
  return { meta, exterior, q, facts, sources, assumed, notes, sides, views, photos, tables, roof };
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
};

/** The plan drawn with every line's length (lib/roofLabels.ts): what a page of it is called. */
export function roofPlanCaption(plan: RoofPlan): string {
  return plan.shape === "other" ? "Roof outline (its lines are not worked out for this shape)" : "Roof plan";
}
