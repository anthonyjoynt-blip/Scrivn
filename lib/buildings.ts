import {
  allSides,
  type CladdingKind,
  defaultRoof,
  type Exterior,
  type ExteriorOpening,
  type ExteriorOpeningKind,
  type ExteriorScopeLines,
  exteriorScopeLines,
  rectangleExterior,
} from "./exterior";
import { exteriorReport, type ExteriorReport, type ReportMeta, type ReportTable } from "./exteriorReport";
import type { RoofEndKind } from "./roof";
import { formatFeetInches, newSketchId, type Sketch } from "./sketch";

/**
 * Other buildings on a claim (2026-10-16): a shed, a detached garage, a workshop - the owner: "i have a large shed
 * in my back yard for example and we could tack that on too".
 *
 * Each is a WHOLE exterior, the house's kind (lib/exterior.ts), kept in `Sketch.buildings` beside the house's
 * `Sketch.exterior` with an id and the name the estimator gave it. So everything the house has, each building has
 * the same way and by the same code - the plan, the sides face-on, the roof and its check, Check these, the
 * photos, the 3D view, the report - and nothing that reads one exterior had to learn a second kind. What is new
 * is only what is about there being more than one:
 *
 *   * the QUICK BOX, a shed's start: its two lengths, the wall height, a gable, one slope or a hip at a pitch, the
 *     siding, and a door or window with a tap - under a minute with a tape;
 *   * the scope's lines, each building's after the house's, each NAMED for it ("Shed – Remove & replace ...");
 *   * the report's section per building after the house's, and the cover's totals per building and for them all.
 *
 * Not placed on the site: where a shed stands in the yard prices nothing. A scan always lands on the house.
 */

/** What the house is called beside the other buildings: on the switcher and in the report's totals. */
export const HOUSE_NAME = "House";

/** The names offered when adding one: a tap, or type another. */
export const BUILDING_NAMES = ["Shed", "Detached garage", "Workshop"] as const;

/** A building's name as shown: as typed, else "Building". */
export function buildingName(b: Pick<Exterior, "name">): string {
  return b.name?.trim() || "Building";
}

/** "the house", "the shed", "the detached garage": a building's name in a sentence. */
export function subjectWords(name: string | null | undefined): string {
  const n = name?.trim();
  if (!n) return "the house";
  // "Shed" reads "the shed"; a name with capitals of its own past the first ("Barn B", "Bob's Shop") is kept as typed.
  const rest = n.slice(1);
  return `the ${rest === rest.toLowerCase() ? n.charAt(0).toLowerCase() + rest : n}`;
}

/** The claim's other buildings, for a sketch saved before there were any as much as for one made today. */
export function buildingsOf(sketch: Pick<Sketch, "buildings">): Exterior[] {
  return sketch.buildings ?? [];
}

/** [name] made unique among [taken] - and never "House": "Shed", then "Shed 2". */
export function uniqueName(name: string, taken: string[]): string {
  const base = name.trim() || "Building";
  const used = new Set([HOUSE_NAME, ...taken].map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let k = 2; ; k++) if (!used.has(`${base} ${k}`.toLowerCase())) return `${base} ${k}`;
}

/** [exterior] as a building of its own, called [name], with an id. */
export function asBuilding(exterior: Exterior, name: string, id: string = newSketchId("building")): Exterior {
  return { ...exterior, id, name: name.trim() || "Building" };
}

/** A change to one exterior, from the exterior as it is now; undefined removes it. */
export type ExteriorChange = (prev: Exterior | undefined) => Exterior | undefined;

/**
 * The sketch with the house's exterior changed: the editor's updater for the house (SketchEditor), kept here so
 * "Use it" on a house the Scrivn team measured (lib/exteriorRequests.ts) goes through the same code. Nothing
 * changed, the same sketch back.
 */
export function withHouseChange(sketch: Sketch, update: ExteriorChange): Sketch {
  const next = update(sketch.exterior);
  if (next === sketch.exterior) return sketch;
  const out: Sketch = { ...sketch, exterior: next };
  if (next === undefined) delete out.exterior;
  return out;
}

/** The sketch with its list of other buildings changed (SketchEditor): an empty list is no list, as before buildings. */
export function withBuildingsChange(sketch: Sketch, update: (list: Exterior[]) => Exterior[]): Sketch {
  const list = sketch.buildings ?? [];
  const next = update(list);
  if (next === list) return sketch;
  const out: Sketch = { ...sketch, buildings: next };
  if (next.length === 0) delete out.buildings;
  return out;
}

/** One building changed on the list (ExteriorSite): it keeps its id and name whatever comes back, and is gone when its exterior is. */
export function withBuildingChange(list: Exterior[], id: string, update: ExteriorChange): Exterior[] {
  const at = list.findIndex((b) => b.id === id);
  const prev = list[at];
  if (!prev) return list;
  const next = update(prev);
  if (next === prev) return list;
  if (next === undefined) return list.filter((b) => b.id !== id);
  return list.map((b, i) => (i === at ? { ...next, id: prev.id, name: prev.name } : b));
}

/** Whether there is anything on the outside of the claim at all: the house's exterior, or any building. */
export function hasAnyExterior(sketch: Pick<Sketch, "exterior" | "buildings">): boolean {
  return !!sketch.exterior || buildingsOf(sketch).length > 0;
}

// ---------------------------------------------------------------------------------------------
// The quick box: a shed with a tape
// ---------------------------------------------------------------------------------------------

export type QuickRoof = "gable" | "one" | "hip";

/** Its four walls by where they are, in the order round it: the front first. */
export const QUICK_WALLS = ["Front", "Right", "Rear", "Left"] as const;

export interface QuickOpening {
  id: string;
  kind: ExteriorOpeningKind;
  /** Which wall: 0 the front, 1 the right, 2 the rear, 3 the left (`QUICK_WALLS`). */
  wall: number;
  widthFeet: number;
  heightFeet: number;
}

export interface QuickBox {
  /** Along the front. */
  widthFeet: number;
  /** Front to back: the sides. */
  depthFeet: number;
  /** From the ground to the top of the walls - the eave - all round. */
  wallFeet: number;
  roof: QuickRoof;
  /** Rise in 12; null is the roof's assumed pitch, said to be assumed everywhere, as the house's is. */
  pitch: number | null;
  cladding: CladdingKind;
  openings: QuickOpening[];
}

/** What a door, window or garage door starts at when added: the house's sizes (components/sketch/ExteriorSide.tsx), a 9' garage door. */
export const QUICK_OPENING_SIZE: Record<ExteriorOpeningKind, { w: number; h: number }> = {
  door: { w: 3, h: 6 + 8 / 12 },
  window: { w: 3, h: 4 },
  garage: { w: 9, h: 7 },
};

/** A window's top stands at a door's: 6'8" (lower under a wall shorter than that). */
const HEAD_FEET = 6 + 8 / 12;

/** A new opening of [kind] on [wall], at its usual size. */
export function quickOpening(kind: ExteriorOpeningKind, wall: number): QuickOpening {
  const size = QUICK_OPENING_SIZE[kind];
  return { id: newSketchId("opening"), kind, wall, widthFeet: size.w, heightFeet: size.h };
}

/** Why the box can't be made yet, in plain words; null when it can. */
export function quickBoxProblem(box: Pick<QuickBox, "widthFeet" | "depthFeet" | "wallFeet" | "openings">): string | null {
  if (!(box.widthFeet > 0) || !(box.depthFeet > 0)) return "Type both lengths.";
  if (!(box.wallFeet > 0)) return "Type the wall height.";
  for (const o of box.openings) {
    const wallLength = o.wall % 2 === 0 ? box.widthFeet : box.depthFeet;
    if (!(o.widthFeet > 0) || !(o.heightFeet > 0)) return "Every door and window needs a width and a height.";
    if (o.heightFeet > box.wallFeet + 1e-9) return `A ${o.kind === "window" ? "window" : "door"} ${formatFeetInches(o.heightFeet)} high is taller than the ${formatFeetInches(box.wallFeet)} walls.`;
    const onIt = box.openings.filter((p) => p.wall === o.wall).reduce((s, p) => s + p.widthFeet, 0);
    if (onIt > wallLength + 1e-9) return `What is on the ${QUICK_WALLS[o.wall]?.toLowerCase() ?? "wall"} is wider than its ${formatFeetInches(wallLength)}.`;
  }
  return null;
}

/**
 * The exterior a quick box makes: four walls round a rectangle (Front, Right, Rear, Left), each clad all the way
 * down to the ground - an outbuilding has no parging to speak of - at the wall height, the roof as picked: a
 * gable (ridge along the longer walls, as any rectangle's), one slope draining to the rear, or a hip all round.
 * Each wall's doors and windows are spread evenly along it, doors at the ground and windows topped at 6'8".
 * Every one of them can be moved, resized or changed after on the wall face-on, as the house's are.
 */
export function quickBoxExterior(box: QuickBox): Exterior {
  const base = rectangleExterior(box.widthFeet, box.depthFeet, box.wallFeet);
  const sides = base.sides.map((s, wall) => {
    const mine = box.openings.filter((o) => o.wall === wall);
    const used = mine.reduce((sum, o) => sum + o.widthFeet, 0);
    const gap = Math.max(0, (s.lengthFeet - used) / (mine.length + 1));
    let at = gap;
    const openings: ExteriorOpening[] = mine.map((o) => {
      const head = Math.min(HEAD_FEET, box.wallFeet);
      const sill = o.kind === "window" ? Math.max(0, head - o.heightFeet) : 0;
      const placed: ExteriorOpening = { id: o.id, kind: o.kind, widthFeet: o.widthFeet, heightFeet: o.heightFeet, sillFeet: sill, fromLeftFeet: at };
      at += o.widthFeet + gap;
      return placed;
    });
    return {
      ...s,
      base: "grade" as const,
      baseLeftFeet: 0,
      baseRightFeet: 0,
      bands: [{ id: newSketchId("band"), kind: box.cladding, top: null }],
      openings,
    };
  });
  // Picked on the box, so set by the estimator - never "assumed" - whichever way the ridge is turned after.
  const end: RoofEndKind = box.roof === "hip" ? "hip" : "gable";
  const ends: Record<string, RoofEndKind> = Object.fromEntries(sides.map((s) => [s.id, end]));
  const rear = sides[2];
  return {
    sides,
    roof: { ...defaultRoof(), pitch: box.pitch, ends, ...(box.roof === "one" && rear ? { oneSlopeTo: rear.id } : {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// Into the scope: each building's lines, named for it
// ---------------------------------------------------------------------------------------------

/** [lines] with the building's name in front of each: "Shed – Remove & replace vinyl siding – ...". */
export function namedScopeLines(name: string, lines: ExteriorScopeLines): ExteriorScopeLines {
  const tag = (line: string) => `${name} – ${line}`;
  return { roofing: lines.roofing.map(tag), siding: lines.siding.map(tag) };
}

/** A building's own scope lines as they go on the scope: named for it. The house's as they always were. */
export function buildingScopeLines(exterior: Exterior | undefined): ExteriorScopeLines {
  const lines = exteriorScopeLines(exterior);
  return exterior?.id ? namedScopeLines(buildingName(exterior), lines) : lines;
}

/**
 * Every exterior line for the scope document and the work orders: the house's, exactly as they always were, then
 * each building's in the order they were added, each named for its building. Only what was ticked, as ever.
 */
export function siteScopeLines(house: Exterior | undefined, buildings: Exterior[] | undefined): ExteriorScopeLines {
  const out = exteriorScopeLines(house);
  for (const b of buildings ?? []) {
    const lines = namedScopeLines(buildingName(b), exteriorScopeLines(b));
    out.roofing.push(...lines.roofing);
    out.siding.push(...lines.siding);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The report: the house, then each building, and the totals of them all
// ---------------------------------------------------------------------------------------------

export interface BuildingReport {
  id: string;
  name: string;
  report: ExteriorReport;
}

/** One line of the cover's totals: a building, or all of them. */
export interface SiteTotal {
  name: string;
  /** Null for a building whose sides don't close. */
  footprintSquareFeet: number | null;
  wallsGrossSquareFeet: number;
  wallsNetSquareFeet: number;
  openings: number;
  /** Null with no roof drawn or typed. */
  roofSquares: number | null;
}

export interface SiteReport {
  meta: ReportMeta;
  /** The house's report; null on a claim with only other buildings measured. */
  house: ExteriorReport | null;
  /** Each other building with something measured, in the order added. */
  buildings: BuildingReport[];
  /** The cover's table of every building and all of them; null with no other building (the house's report as it always was). */
  totals: ReportTable | null;
  /** The same as numbers: each building's, the house first, then all of them. */
  rows: SiteTotal[];
  combined: SiteTotal | null;
}

function totalOf(name: string, r: ExteriorReport): SiteTotal {
  const q = r.q;
  return {
    name,
    footprintSquareFeet: q.footprint.closes ? q.footprint.areaSquareFeet : null,
    wallsGrossSquareFeet: q.totals.grossSquareFeet,
    wallsNetSquareFeet: q.totals.netSquareFeet,
    openings: allSides(r.exterior).reduce((n, s) => n + s.openings.length, 0),
    roofSquares: q.roofing ? q.roofing.squares : null,
  };
}

function sumOf(rows: SiteTotal[]): SiteTotal {
  const some = <T>(xs: (T | null)[]) => xs.filter((v): v is T => v !== null);
  const fp = some(rows.map((r) => r.footprintSquareFeet));
  const sq = some(rows.map((r) => r.roofSquares));
  return {
    name: "All buildings",
    footprintSquareFeet: fp.length > 0 ? fp.reduce((a, b) => a + b, 0) : null,
    wallsGrossSquareFeet: rows.reduce((s, r) => s + r.wallsGrossSquareFeet, 0),
    wallsNetSquareFeet: rows.reduce((s, r) => s + r.wallsNetSquareFeet, 0),
    openings: rows.reduce((s, r) => s + r.openings, 0),
    roofSquares: sq.length > 0 ? sq.reduce((a, b) => a + b, 0) : null,
  };
}

const one = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/**
 * The report of the house and every other building on the claim: the house's exactly as it is on its own, each
 * building's the same report of its own exterior, and - with any other building - the cover's table of them all.
 * Null when nothing anywhere is measured.
 */
export function siteReport(house: Exterior | undefined, buildings: Exterior[] | undefined, meta: ReportMeta): SiteReport | null {
  const h = house ? exteriorReport(house, meta) : null;
  const bs: BuildingReport[] = [];
  for (const b of buildings ?? []) {
    const report = exteriorReport(b, meta);
    if (report) bs.push({ id: b.id ?? "", name: buildingName(b), report });
  }
  if (!h && bs.length === 0) return null;
  if (bs.length === 0) return { meta, house: h, buildings: [], totals: null, rows: [], combined: null };
  const rows = [...(h ? [totalOf(HOUSE_NAME, h)] : []), ...bs.map((b) => totalOf(b.name, b.report))];
  const combined = sumOf(rows);
  const cell = (t: SiteTotal) => [
    t.name,
    t.footprintSquareFeet === null ? "-" : one(t.footprintSquareFeet),
    one(t.wallsGrossSquareFeet),
    one(t.wallsNetSquareFeet),
    String(t.openings),
    t.roofSquares === null ? "-" : t.roofSquares.toFixed(2),
  ];
  const totals: ReportTable = {
    caption: "The buildings on this claim",
    columns: [
      { title: "Building", weight: 2.4 },
      { title: "Footprint SF", weight: 1.1, align: "center" },
      { title: "Walls gross SF", weight: 1.1, align: "center" },
      { title: "Walls net SF", weight: 1.1, align: "center" },
      { title: "Openings", weight: 0.9, align: "center" },
      { title: "Roof SQ", weight: 0.9, align: "center" },
    ],
    rows: [...rows.map(cell), cell(combined)],
    note: `Each building has its own section after ${h ? "the house's" : "this page"}: its plan, roof plan, elevations, side photos and measurements. Real figures, no waste.`,
  };
  return { meta, house: h, buildings: bs, totals, rows, combined };
}
