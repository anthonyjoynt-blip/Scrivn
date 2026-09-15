import type { AreaFraction, Room, WaterLossExtraction, WallDrywallCutHeight } from "./types";
import { normaliseRoomName } from "./gapCheck";

/**
 * How much comes out of the house, and what to put it in.
 *
 * The first quantity in the app that is DERIVED rather than stated or asked: every removal the tree
 * already renders has a weight per unit, the weights are summed per phase, and the total is read
 * off the disposal ladder below. The estimate is printed beside the size — "20 yd dumpster
 * (est. 3.6 t)" — so an estimator can disagree with the number; one who sees only "20 yd" cannot.
 *
 * ── Two tables, both the PM's to tune ────────────────────────────────────────────────────────────
 *
 * `DEBRIS_WEIGHTS` is the model. The factors are WET demolition weights — water-damaged material is
 * what comes out of a water loss — and were reviewed against real loads on 2026-09-14. If dumpsters
 * consistently run heavier or lighter than this says, these are the numbers to change, and nothing
 * else needs to.
 *
 * `disposalForTons` is the ladder, as given: a pickup in quarter loads up to half a ton, a dump
 * trailer to 1.67, then 12 / 20 / 30 / 40 yard dumpsters, and a top-up past eight tons.
 *
 * ── What it cannot weigh ─────────────────────────────────────────────────────────────────────────
 *
 * A removal stated as a fraction — "half the room" — needs the room's area, which only the sketch
 * has. Without it the removal is listed as UNWEIGHED on the line rather than guessed, and so is any
 * unscoped item, which has words but no quantity. An estimate that names what it left out is one
 * somebody can correct; one that quietly rounded down is not.
 */

/** Pounds per unit, wet. Units are SF unless the key says otherwise. */
export const DEBRIS_WEIGHTS = {
  drywallPerSF: 2.0, // wet; 1.6 dry
  ceilingDrywallPerSF: 2.0,
  insulationPerSF: { FIBERGLASS_BATT: 0.3, BLOWN_IN: 1.0, CELLULOSE: 1.0, FOAM: 0.5, unknown: 0.3 } as Record<string, number>,
  flooringPerSF: { CARPET: 1.0, VINYL_SHEET: 0.6, VINYL_PLANK: 1.8, LAMINATE: 1.8, HARDWOOD: 2.8, TILE: 4.5, CONCRETE: 0, unknown: 1.5 } as Record<string, number>,
  padPerSF: 0.5,
  subfloorPerSF: { PLYWOOD_OSB: 2.2, SLEEPER_SYSTEM: 1.0, OTHER: 2.0, CONCRETE_SLAB: 0, unknown: 2.0 } as Record<string, number>,
  baseboardPerLF: { MDF: 0.6, SOLID_WOOD: 0.5, VINYL_PVC_COMPOSITE: 0.4, unknown: 0.6 } as Record<string, number>,
  cabinetryPerRun: { UPPERS: 200, LOWERS: 300, FULL_HEIGHT: 400, unknown: 300 } as Record<string, number>,
  countertopEach: 50,
  plumbingFixtureEach: 80, // vanity or toilet, only when replaced
  doorEach: { SOLID_CORE: 90, unknown: 60 } as Record<string, number>,
} as const;

/** How far up a flood cut goes, in feet. FULL_WALL assumes an eight-foot wall; null is read as BASE, as the scope rule does. */
const CUT_HEIGHT_FEET: Record<WallDrywallCutHeight, number> = { BASE: 4 / 12, TWO_FOOT: 2, FOUR_FOOT: 4, FULL_WALL: 8 };

const FRACTION_VALUE: Record<AreaFraction, number> = { QUARTER: 0.25, HALF: 0.5, THREE_QUARTERS: 0.75, FULL: 1 };

const POUNDS_PER_TON = 2000;

/** A table lookup that falls to the table's `unknown` entry — every table above has one — and never to undefined. */
function factor(table: Record<string, number>, key: string | null | undefined): number {
  return table[key ?? "unknown"] ?? table.unknown ?? 0;
}

/** What the sketch knows about a room, keyed by `normaliseRoomName`. Null where the room was never drawn. */
export interface RoomAreas {
  floorSquareFeet: number | null;
  wallRunFeet: number | null;
  ceilingSquareFeet: number | null;
}
export type RoomAreasByName = Record<string, RoomAreas>;

export interface DebrisLine {
  room: string;
  item: string;
  pounds: number;
}

export interface DebrisEstimate {
  pounds: number;
  lines: DebrisLine[];
  /** Removals that exist but could not be weighed — a fraction with no sketch area, an unscoped item. */
  unweighed: { item: string; room: string }[];
  /** How many rooms the claim has, so the line can leave the room off when there is only one. */
  rooms: number;
}

export type DisposalPhase = "EMERGENCY" | "REPAIR";

/*
  ── The ladder ────────────────────────────────────────────────────────────────────────────────────
*/

/** The disposal size for a load, as the ladder was given. Past eight tons, a 40 yd and whatever the remainder needs. */
export function disposalForTons(tons: number): string {
  if (tons <= 0.125) return "pickup – 1/4 load";
  if (tons <= 0.25) return "pickup – 1/2 load";
  if (tons <= 0.375) return "pickup – 3/4 load";
  if (tons <= 0.5) return "pickup – full load";
  if (tons <= 1.67) return "dump trailer";
  if (tons <= 3) return "12 yd dumpster";
  if (tons <= 4) return "20 yd dumpster";
  if (tons <= 7) return "30 yd dumpster";
  if (tons <= 8) return "40 yd dumpster";
  return `40 yd dumpster + ${disposalForTons(tons - 8)}`;
}

/*
  ── The estimate ──────────────────────────────────────────────────────────────────────────────────
*/

/** A stated number, else a fraction of the sketch's figure, else null — the caller records null as unweighed. */
function resolve(stated: number | null, fraction: AreaFraction | null, base: number | null): number | null {
  if (stated !== null) return stated;
  if (fraction !== null && base !== null) return base * FRACTION_VALUE[fraction];
  return null;
}

function roomDebris(room: Room, areas: RoomAreas | undefined, phase: DisposalPhase, estimate: DebrisEstimate): void {
  const name = room.roomName || "Room";
  const floor = areas?.floorSquareFeet ?? null;
  const run = areas?.wallRunFeet ?? null;
  const ceiling = areas?.ceilingSquareFeet ?? floor;
  const add = (item: string, pounds: number) => {
    estimate.lines.push({ room: name, item, pounds });
    estimate.pounds += pounds;
  };
  const skip = (item: string) => estimate.unweighed.push({ item, room: name });

  // Flooring and baseboard carry a phase of their own; a removal on the repair visit is repair debris.
  const phaseOf = (p: "EMERGENCY" | "REPAIR" | "BOTH" | null): DisposalPhase => (p === "REPAIR" ? "REPAIR" : "EMERGENCY");

  for (const f of room.flooring) {
    if (phaseOf(f.phase) !== phase) continue;
    const removing = f.disposition === "REMOVE_AND_DISPOSE" || f.disposition === "REMOVE_AND_ASSESS";
    if (removing) {
      const sf = resolve(f.removalSF, f.removalFraction, floor);
      const key = f.type === "VINYL" ? (f.vinylSubtype === "SHEET" ? "VINYL_SHEET" : "VINYL_PLANK") : f.type ?? "unknown";
      const perSF = factor(DEBRIS_WEIGHTS.flooringPerSF, key);
      if (sf === null) skip(`${(f.type ?? "flooring").toLowerCase()} removal`);
      else add(`${(f.type ?? "flooring").toLowerCase()} removal`, sf * perSF);
    }
    // Pad comes out on its own terms — under a carpet that is lifted and kept, or with one that goes.
    if (f.padRemoved === true) {
      const sf = resolve(f.padRemovedSF, f.padRemovedFraction, floor) ?? (removing ? resolve(f.removalSF, f.removalFraction, floor) : null);
      if (sf === null) skip("carpet pad removal");
      else add("carpet pad removal", sf * DEBRIS_WEIGHTS.padPerSF);
    }
  }

  for (const b of room.baseboard) {
    if (phaseOf(b.phase) !== phase || b.action !== "REMOVE_AND_REPLACE") continue;
    const lf = b.wallRunFt ?? run;
    if (lf === null) skip("baseboard removal");
    else add("baseboard removal", lf * factor(DEBRIS_WEIGHTS.baseboardPerLF, b.material));
  }

  if (phase !== "EMERGENCY") return;

  for (const w of room.walls) {
    if (!w.drywallBeingRemoved) continue;
    const lf = resolve(w.cutRunFt, w.cutRunFraction, run);
    if (lf === null) {
      skip("drywall removal");
      if (w.insulationAffected) skip("insulation removal");
      continue;
    }
    const sf = lf * CUT_HEIGHT_FEET[w.cutHeight ?? "BASE"];
    add("drywall removal", sf * DEBRIS_WEIGHTS.drywallPerSF);
    if (w.insulationAffected) add("insulation removal", sf * factor(DEBRIS_WEIGHTS.insulationPerSF, w.insulationType));
  }

  for (const c of room.ceilings) {
    if (c.type !== "DRYWALL_PLASTER" || c.action !== "REMOVE_AND_REPLACE") continue;
    const sf = resolve(c.replaceSF, c.replaceFraction, ceiling);
    if (sf === null) {
      skip("ceiling drywall removal");
      if (c.aboveInsulationAffected) skip("ceiling insulation removal");
      continue;
    }
    add("ceiling drywall removal", sf * DEBRIS_WEIGHTS.ceilingDrywallPerSF);
    if (c.aboveInsulationAffected) add("ceiling insulation removal", sf * factor(DEBRIS_WEIGHTS.insulationPerSF, c.aboveInsulationType));
  }

  for (const s of room.subfloor) {
    if (s.disposition !== "REMOVE_AND_REPLACE") continue;
    const sf = s.removalSF ?? floor;
    const perSF = factor(DEBRIS_WEIGHTS.subfloorPerSF, s.type);
    if (sf === null) skip("subfloor removal");
    else add("subfloor removal", sf * perSF);
  }

  for (const c of room.cabinetry) {
    if (c.action !== "REMOVE_AND_REPLACE") continue;
    add("cabinetry removal", factor(DEBRIS_WEIGHTS.cabinetryPerRun, c.extent));
  }
  for (const c of room.countertops) if (c.action === "REMOVE_AND_REPLACE") add("countertop removal", DEBRIS_WEIGHTS.countertopEach);
  for (const p of room.plumbingFixtures) if (p.action === "REMOVE_AND_REPLACE") add(`${p.fixtureType.toLowerCase().replace(/_/g, " ")} removal`, DEBRIS_WEIGHTS.plumbingFixtureEach);
  for (const d of room.doors) if (d.action === "REMOVE_AND_REPLACE") add("door removal", factor(DEBRIS_WEIGHTS.doorEach, d.doorType));
}

/** Everything coming out in one phase, weighed where it can be and listed where it cannot. */
export function estimateDebris(extraction: WaterLossExtraction, areas: RoomAreasByName, phase: DisposalPhase): DebrisEstimate {
  const estimate: DebrisEstimate = { pounds: 0, lines: [], unweighed: [], rooms: extraction.rooms.length };
  for (const room of extraction.rooms) {
    roomDebris(room, areas[normaliseRoomName(room.roomName)], phase, estimate);
    // Work with no field has words but no quantity. It is real debris — a tub surround is heavy —
    // so it is named on the line as unweighed rather than left out of the picture.
    for (const u of room.unscoped) {
      if (u.disposition === "BOTH" || u.disposition === phase) estimate.unweighed.push({ item: u.description, room: room.roomName || "Room" });
    }
  }
  return estimate;
}

/*
  ── The line ──────────────────────────────────────────────────────────────────────────────────────
*/

export interface DisposalRecommendation {
  phase: DisposalPhase | "COMBINED";
  /** The container, off the ladder. */
  size: string;
  /** Estimated tons, to one decimal; null when nothing at all could be weighed. */
  tons: number | null;
  unweighed: { item: string; room: string }[];
  rooms: number;
  /** "estimated" from the tree; "default" when the phase carries no weighed debris and the standing rule applies. */
  basis: "estimated" | "default";
}

/**
 * Repair defaults to a pickup — offcuts and packaging, the standing rule — and steps up the ladder
 * only when a removal is actually scheduled for the repair visit and weighs more than one.
 *
 * COMBINED is for a document with one phase heading: a Repair-only claim folds the tear-out into
 * that single visit, and the debris is just as real, so both phases are weighed together.
 */
export function recommendDisposal(extraction: WaterLossExtraction, areas: RoomAreasByName, phase: DisposalPhase | "COMBINED"): DisposalRecommendation {
  const estimate =
    phase === "COMBINED"
      ? merge(estimateDebris(extraction, areas, "EMERGENCY"), estimateDebris(extraction, areas, "REPAIR"))
      : estimateDebris(extraction, areas, phase);
  const tons = Math.round((estimate.pounds / POUNDS_PER_TON) * 10) / 10;
  const common = { phase, unweighed: estimate.unweighed, rooms: estimate.rooms };
  if (phase === "REPAIR" && estimate.pounds / POUNDS_PER_TON <= 0.5) {
    return { ...common, size: "pickup", tons: estimate.lines.length > 0 ? tons : null, basis: "default" };
  }
  if (estimate.lines.length === 0) {
    return { ...common, size: disposalForTons(0), tons: null, basis: "default" };
  }
  return { ...common, size: disposalForTons(estimate.pounds / POUNDS_PER_TON), tons, basis: "estimated" };
}

function merge(a: DebrisEstimate, b: DebrisEstimate): DebrisEstimate {
  return { pounds: a.pounds + b.pounds, lines: [...a.lines, ...b.lines], unweighed: [...a.unweighed, ...b.unweighed], rooms: a.rooms };
}

/**
 * "vinyl, baseboard and drywall removal (Basement bathroom)" — grouped by room, the shared word
 * said once, and the room left off altogether when the claim has only one.
 */
export function unweighedNote(unweighed: { item: string; room: string }[], rooms: number): string {
  const byRoom = new Map<string, string[]>();
  for (const u of unweighed) {
    const list = byRoom.get(u.room) ?? [];
    if (!list.includes(u.item)) list.push(u.item);
    byRoom.set(u.room, list);
  }
  const join = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
  return [...byRoom.entries()]
    .map(([room, items]) => {
      const removals = items.filter((i) => i.endsWith(" removal")).map((i) => i.slice(0, -" removal".length));
      const other = items.filter((i) => !i.endsWith(" removal"));
      const parts = [...(removals.length > 0 ? [`${join(removals)} removal`] : []), ...other];
      return rooms > 1 ? `${parts.join(", ")} (${room})` : parts.join(", ");
    })
    .join("; ");
}

/** The line as it appears on the scope and the crew sheet. */
export function disposalLine(rec: DisposalRecommendation): string {
  const notes: string[] = [];
  if (rec.tons !== null) notes.push(`est. ${rec.tons < 0.1 ? "under 0.1" : rec.tons} t`);
  if (rec.unweighed.length > 0) notes.push(`not weighed: ${unweighedNote(rec.unweighed, rec.rooms)}`);
  return `Disposal – ${rec.size}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
}

/** The three lines a document might need: one per phase, and the combined one for a single-heading document. */
export interface DisposalLines {
  emergency: string;
  repair: string;
  combined: string;
}

export function disposalLines(extraction: WaterLossExtraction, areas: RoomAreasByName): DisposalLines {
  return {
    emergency: disposalLine(recommendDisposal(extraction, areas, "EMERGENCY")),
    repair: disposalLine(recommendDisposal(extraction, areas, "REPAIR")),
    combined: disposalLine(recommendDisposal(extraction, areas, "COMBINED")),
  };
}
