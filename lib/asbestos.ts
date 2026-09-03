import type { SketchRoom } from "./sketch";
import { roomBounds, PIXELS_PER_FOOT, wallsOf } from "./sketch";
import {
  type ContainmentLevel,
  type ContainmentPlan,
  type HepaVacPlan,
  type Surface,
  WALLS_PER_ROOM,
  containmentPlan,
  hepaVacPlan,
} from "./containment";
import { airChangeCfm, unitsForCapacity } from "./equipmentSizing";

/**
 * Asbestos abatement scoping — a form, not a conversation.
 *
 * Same family as `lib/contentsTM.ts`: every field is something the PM knows and types, so there is
 * no transcript, no extraction, no gap-check and no Claude call anywhere in this path. The scope
 * text is built from the numbers below, client-side, deterministically. A quantity a PM defends to
 * an adjuster should come out the same way every time it is calculated.
 *
 * This is phase 1 of the Remediation loss type. Mould is a deliberate follow-on and is NOT here —
 * but the two pieces it will want are already hazard-neutral: `lib/containment.ts` decides what to
 * seal from a risk level and a removed surface without knowing what the hazard is, and
 * `lib/equipmentSizing.ts` holds the machine-count arithmetic. Adding mould should mean mapping
 * Condition 1/2/3 onto `ContainmentLevel` and writing its own scope text, not editing either.
 *
 * ── What is derived and what is asked ────────────────────────────────────────────────────────
 * The Type is DERIVED from two facts a PM can actually observe — is it friable, and how much is
 * being disturbed — rather than asked for directly, because "what type is this?" is the question
 * the regulation answers, not one the PM should have to. The derivation is always overridable: it
 * reads the two commonest inputs and a real job can turn on a third thing it cannot see.
 *
 * Two things here are deliberately NOT derived, and both for the same reason — no verified source:
 *
 *   - PPE changes. There is no reliable decon-cycle figure to calculate a count from, so it is a
 *     number the PM enters.
 *   - PPE level. No asbestos-specific respirator/suit tier table has been verified, so it is a
 *     selection from real kit rather than a lookup keyed on Type.
 *
 * Inventing either would put a figure nobody can source into a document somebody signs.
 */

/* ── Classification ────────────────────────────────────────────────────────────────────────────── */

export type AsbestosType = 1 | 2 | 3;

export const ASBESTOS_TYPE_LABEL: Record<AsbestosType, string> = {
  1: "Type 1 — low risk",
  2: "Type 2 — moderate risk",
  3: "Type 3 — high risk",
};

/**
 * The area at which friable removal becomes Type 3, in square metres.
 *
 * From Ontario O. Reg. 278/05, which is the framework this maps to. Stated as a named constant
 * rather than inlined so the one number the derivation turns on is visible and citable.
 */
export const TYPE_3_FRIABLE_AREA_SQ_M = 1;

/** Square feet in a square metre, for PMs who measure in feet and a regulation written in metres. */
export const SQ_FT_PER_SQ_M = 10.7639;

export function sqFtToSqM(squareFeet: number): number {
  return squareFeet / SQ_FT_PER_SQ_M;
}

/**
 * Type from the two underlying facts, per O. Reg. 278/05.
 *
 *   Type 1  non-friable, and the disturbance is minimal — nothing that makes more than trivial dry dust
 *   Type 3  friable, being removed or disturbed over roughly a square metre
 *   Type 2  everything else
 *
 * Type 2 is the real middle of the regulation and the honest default, not a shrug: most jobs that
 * are neither trivially small and bound nor large and friable land there.
 *
 * `minimalDisturbance` is the PM's own judgement about dry dust, asked separately because area
 * alone cannot answer it — a small amount of non-friable material can still be Type 2 if the method
 * grinds or breaks it.
 */
export function deriveAsbestosType(input: { friable: boolean; areaSqM: number; minimalDisturbance: boolean }): AsbestosType {
  if (input.friable && input.areaSqM > TYPE_3_FRIABLE_AREA_SQ_M) return 3;
  if (!input.friable && input.minimalDisturbance) return 1;
  return 2;
}

/** Why the derivation landed where it did, so the PM can see whether to override it. */
export function typeReason(input: { friable: boolean; areaSqM: number; minimalDisturbance: boolean }): string {
  const area = `${input.areaSqM.toFixed(2)} m²`;
  if (input.friable && input.areaSqM > TYPE_3_FRIABLE_AREA_SQ_M) {
    return `Friable material over ${TYPE_3_FRIABLE_AREA_SQ_M} m² (${area}) — high fibre-release potential.`;
  }
  if (!input.friable && input.minimalDisturbance) {
    return `Non-friable, minimal disturbance (${area}) — no more than trivial dry dust expected.`;
  }
  if (input.friable) return `Friable, but ${area} is at or under ${TYPE_3_FRIABLE_AREA_SQ_M} m².`;
  return `Non-friable, but the disturbance is more than minimal (${area}).`;
}

/** Type 3 is full containment; Type 1 and 2 seal the entry only. */
export function containmentLevelForType(type: AsbestosType): ContainmentLevel {
  return type === 3 ? "full" : "entry";
}

/* ── Decontamination ───────────────────────────────────────────────────────────────────────────── */

export type DeconChamber = "three_stage" | "single_stage";

export const DECON_CHAMBER_LABEL: Record<DeconChamber, string> = {
  three_stage: "Three-stage (equipment/dirty room, shower room, clean room)",
  single_stage: "Single chamber, no shower stage",
};

/** Type 3 gets the full three-stage system, Type 1/2 a single chamber. Both are defaults the PM edits. */
export function defaultDeconChamber(type: AsbestosType): DeconChamber {
  return type === 3 ? "three_stage" : "single_stage";
}

/* ── PPE ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Real kit, listed for the PM to pick from — NOT a tier table keyed on Type.
 *
 * A lookup that answered "Type 3 means a PAPR" would be inventing a rule. These are descriptions of
 * equipment a crew actually carries; which one the job calls for is the PM's call, informed by their
 * own program and the jurisdiction, not by this app.
 */
export const RESPIRATOR_OPTIONS = [
  "Half-face air-purifying respirator, P100",
  "Full-face air-purifying respirator, P100",
  "Powered air-purifying respirator (PAPR)",
  "Supplied-air respirator",
] as const;

export const SUIT_OPTIONS = [
  "Disposable coveralls",
  "Disposable coveralls with hood and booties",
  "Disposable coveralls, hood, booties and gloves taped",
] as const;

/* ── The form's state ──────────────────────────────────────────────────────────────────────────── */

/**
 * Strings, not numbers, for every entered figure — the same choice `ContentsTM` makes. A controlled
 * numeric input has to be able to hold "", and parsing at the edge keeps "blank" distinguishable
 * from "zero" everywhere downstream.
 */
export interface AsbestosScope {
  /** What the material is, in the PM's words — "9x9 floor tile and black mastic". */
  material: string;
  /** Which surface it is coming off. Drives the containment plan. */
  surface: Surface;
  /** Walls only: the area of wall coming out, in square feet — the quantity an estimate is written in. */
  wallRemovalSqFt: string;
  /**
   * How many of the room's walls that area spans, when the PM disagrees with the derived count.
   *
   * Blank means "work it out from the area" — see `wallsRemovedFrom`. The count exists only because
   * containment needs to know which walls are STAYING; nobody scopes a job in whole walls, which is
   * why the area above is the field and this is the exception to it.
   */
  wallsRemovedOverride: string;

  friable: boolean;
  /** The PM's judgement on dry dust, which area alone cannot answer. */
  minimalDisturbance: boolean;
  /** Area being disturbed, in square feet — converted to m² for the regulation's threshold. */
  areaDisturbedSqFt: string;
  /** Set when the PM disagrees with the derivation. Null means "use the derived Type". */
  typeOverride: AsbestosType | null;

  /** Direct entry, and the required path — a mechanical room or crawlspace may never be sketched. */
  roomLengthFt: string;
  roomWidthFt: string;
  roomHeightFt: string;
  /** When set, geometry comes from this sketch room instead of the three fields above. */
  sketchRoomId: string | null;

  crewSize: string;
  durationDays: string;
  hoursPerDay: string;
  /** Overrides days x hours/day when the PM would rather state the total outright. */
  totalHoursOverride: string;

  deconChamber: DeconChamber | null;
  ppeChanges: string;
  respirator: string;
  suit: string;

  /** Air changes per hour the containment is held at. A starting value — see `DEFAULT_AIR_CHANGES`. */
  airChangesPerHour: string;
  /** Which size of machine to calculate against. Null uses `DEFAULT_NEGATIVE_AIR_SIZE`. */
  negativeAirSize: NegativeAirSize | null;
  /**
   * Flexible ducting to exhaust the machines out of the room, in linear feet.
   *
   * Entered rather than derived: how far it is to a window, a door or a shaft is a fact about the
   * building's layout, and nothing in this form describes the route out of the containment.
   */
  ductingLinearFeet: string;
  /** Equipment beyond the negative air machines that also has to be decontaminated. */
  otherEquipmentUnits: string;
  

  /**
   * Asbestos samples taken, entered here.
   *
   * The claim already has a place for this, filled in by the water-loss gap-check pair — but a
   * standalone abatement assignment never runs that pipeline, so on those claims there is nothing
   * to read. Entered here it wins; left blank the claim's own figure is used.
   */
  sampleCount: string;

  /**
   * Fees a third party charges, entered when known.
   *
   * Both are hygienist attendances and both are commonly unpriced at the scoping stage — the
   * inspection has not been booked and the clearance has not been quoted. Blank therefore does NOT
   * mean zero and does not mean "omit": it prints as an open item, so the line is on the document
   * to be filled in later rather than quietly missing from it.
   */
  preAbatementFee: string;
  postAbatementFee: string;

  notes: string;
}

/* ── Negative air machines ─────────────────────────────────────────────────────────────────────── */

export type NegativeAirSize = "small" | "medium" | "large";

export interface NegativeAirBand {
  label: string;
  /** The CFM one unit of this size is calculated at. See the note below on which end of the band. */
  rating: number;
}

/**
 * The sizes an estimate is written against, and the rating each is calculated at.
 *
 * Which end of a band to calculate from is the same question `DEHUMIDIFIER_SIZES` answers, and the
 * answer is the same shape: an "up to" band has one number and it is the ceiling, while a range is
 * calculated at its LOW end, because a band is a range of real machines and assuming the weakest
 * one in it can only ever recommend more units than the kit on the truck needs. That is the safe
 * direction — under-sizing containment air is the failure that matters.
 *
 * The small unit in practice is an adjustable 200–750 CFM machine; it is priced as the "up to 699"
 * line, which is why that is the figure here rather than what the machine can be wound up to.
 */
export const NEGATIVE_AIR_SIZES: Record<NegativeAirSize, NegativeAirBand> = {
  small: { label: "Up to 699 CFM", rating: 699 },
  medium: { label: "800–1399 CFM", rating: 800 },
  large: { label: "1400+ CFM", rating: 1400 },
};

/** Smallest first — the order the picker offers them and the order a suggestion searches. */
export const NEGATIVE_AIR_ORDER: NegativeAirSize[] = ["small", "medium", "large"];

/**
 * The size the job defaults to.
 *
 * The small unit, always, with more of them as the volume demands. That is how these jobs are
 * actually run and quoted — a second small machine is a far more common answer than a bigger one —
 * so the default is the common case and the suggestion below handles the exception.
 */
export const DEFAULT_NEGATIVE_AIR_SIZE: NegativeAirSize = "small";

/**
 * A larger size worth offering, or null when the default is fine.
 *
 * Suggested only when it would genuinely reduce the machine count: three small units versus one
 * large is worth putting in front of a PM, one versus one is noise. Returns the SMALLEST size that
 * improves on the default, so the suggestion is the least change that helps rather than the biggest
 * machine on the list.
 */
export function suggestNegativeAirSize(requiredCfm: number): NegativeAirSize | null {
  const defaultUnits = unitsForCapacity(requiredCfm, NEGATIVE_AIR_SIZES[DEFAULT_NEGATIVE_AIR_SIZE].rating);
  if (defaultUnits <= 1) return null;
  for (const size of NEGATIVE_AIR_ORDER) {
    if (size === DEFAULT_NEGATIVE_AIR_SIZE) continue;
    if (unitsForCapacity(requiredCfm, NEGATIVE_AIR_SIZES[size].rating) < defaultUnits) return size;
  }
  return null;
}

/**
 * Air changes per hour for the containment.
 *
 * A STARTING VALUE, not a sourced requirement. Four ACH is widely used for containment negative
 * air and is offered so the field is not blank, but the governing figure is whatever the
 * jurisdiction and the abatement plan specify — the field is editable and the UI says so. The same
 * honesty applies here as to the moisture dry standards: a default nobody has verified must not be
 * presented as an authority.
 */
export const DEFAULT_AIR_CHANGES = 4;

/** Machine hours one HEPA filter is charged over. The divisor in the filter-charge formula. */
export const HEPA_FILTER_HOURS = 800;

export function emptyAsbestosScope(): AsbestosScope {
  return {
    material: "",
    surface: "ceiling",
    wallRemovalSqFt: "",
    wallsRemovedOverride: "",
    friable: false,
    minimalDisturbance: true,
    areaDisturbedSqFt: "",
    typeOverride: null,
    roomLengthFt: "",
    roomWidthFt: "",
    roomHeightFt: "",
    sketchRoomId: null,
    crewSize: "",
    durationDays: "",
    hoursPerDay: "",
    totalHoursOverride: "",
    deconChamber: null,
    ppeChanges: "",
    respirator: "",
    suit: "",
    airChangesPerHour: String(DEFAULT_AIR_CHANGES),
    negativeAirSize: null,
    ductingLinearFeet: "",
    otherEquipmentUnits: "",
    sampleCount: "",
    preAbatementFee: "",
    postAbatementFee: "",
    notes: "",
  };
}

/** A positive number if `value` parses to one, else null. Blank never means zero — same rule as ContentsTM. */
function parsePositive(value: string): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ── Geometry ──────────────────────────────────────────────────────────────────────────────────── */

export interface RoomGeometry {
  lengthFt: number;
  widthFt: number;
  heightFt: number;
  floorSqFt: number;
  ceilingSqFt: number;
  wallSqFt: number;
  cubicFt: number;
  /** Where the numbers came from, so the scope can say so rather than assert them. */
  source: "sketch" | "entered";
}

/**
 * The room's dimensions — from the sketch when one is attached, from the three fields otherwise.
 *
 * Typed entry is the DEFAULT and the required path, not the fallback. A sketch is a nicety; a
 * mechanical room, a crawlspace or a riser cupboard is exactly the sort of space that gets abated
 * and never gets drawn, and requiring geometry the PM has no reason to produce would make the tool
 * unusable for the jobs it is most needed on.
 *
 * When a sketch room IS attached it wins, because it is measured rather than remembered.
 */
export function roomGeometry(scope: AsbestosScope, sketchRoom: SketchRoom | null): RoomGeometry | null {
  if (sketchRoom) {
    const bounds = roomBounds(sketchRoom);
    const lengthFt = bounds.width / PIXELS_PER_FOOT;
    const widthFt = bounds.height / PIXELS_PER_FOOT;
    const heightFt = sketchRoom.ceilingHeightFeet ?? parsePositive(scope.roomHeightFt) ?? 8;
    // Perimeter from the real outline, so an L-shaped room is not treated as its bounding box.
    const perimeterFt = wallsOf(sketchRoom).reduce((sum, wall) => sum + wall.lengthFeet, 0);
    const floorSqFt = lengthFt * widthFt;
    return {
      lengthFt,
      widthFt,
      heightFt,
      floorSqFt,
      ceilingSqFt: floorSqFt,
      wallSqFt: perimeterFt * heightFt,
      cubicFt: floorSqFt * heightFt,
      source: "sketch",
    };
  }

  const lengthFt = parsePositive(scope.roomLengthFt);
  const widthFt = parsePositive(scope.roomWidthFt);
  const heightFt = parsePositive(scope.roomHeightFt);
  if (lengthFt === null || widthFt === null || heightFt === null) return null;

  const floorSqFt = lengthFt * widthFt;
  return {
    lengthFt,
    widthFt,
    heightFt,
    floorSqFt,
    ceilingSqFt: floorSqFt,
    wallSqFt: 2 * (lengthFt + widthFt) * heightFt,
    cubicFt: floorSqFt * heightFt,
    source: "entered",
  };
}

/**
 * How many of the room's walls a given removal area spans.
 *
 * An estimate is written in square feet, but containment is decided per surface — so the count has
 * to come from somewhere, and deriving it from the area beats asking for it: "240 SF of wall" is a
 * measurement, "two walls" is a judgement about how that measurement is spread.
 *
 * Averaged over the room's four walls rather than matched to a particular one. Two walls are L x H
 * and two are W x H, and nothing in the form says WHICH walls the material is on, so an average is
 * the honest answer — and it is only ever used to decide how many walls remain to be sealed, never
 * to compute an area. Rounded UP and clamped to the room: half a wall's worth of removal still
 * leaves that wall out of the containment.
 *
 * Returns 1 when there is no geometry to reckon against, because a wall job removes at least one.
 */
export function wallsRemovedFrom(removalSqFt: number | null, geometry: RoomGeometry | null, wallsPerRoom = WALLS_PER_ROOM): number {
  if (removalSqFt === null || geometry === null) return 1;
  const averageWallSqFt = geometry.wallSqFt / wallsPerRoom;
  if (averageWallSqFt <= 0) return 1;
  return Math.min(wallsPerRoom, Math.max(1, Math.ceil(removalSqFt / averageWallSqFt)));
}

/**
 * The sample count to state: entered here if given, else the claim's own.
 *
 * Entered wins because a standalone abatement claim never runs the pipeline that fills the claim
 * field in, so on those jobs this is the only place the number can come from. Where both exist the
 * PM typed the one in front of them more recently.
 */
export function resolveSampleCount(scope: AsbestosScope, claimSampleCount: number | null): number | null {
  const entered = Number.parseFloat(scope.sampleCount);
  if (Number.isFinite(entered) && entered >= 0) return entered;
  return claimSampleCount;
}

/* ── The calculated job ────────────────────────────────────────────────────────────────────────── */

export interface NegativeAirResult {
  cubicFeet: number;
  airChangesPerHour: number;
  /** CFM the containment needs. */
  required: number;
  size: NegativeAirSize;
  band: NegativeAirBand;
  units: number;
  /** Set when the PM chose a size rather than taking the default. */
  sizeIsChosen: boolean;
  /** A larger size that would need fewer machines, or null. Advisory only. */
  suggestion: { size: NegativeAirSize; band: NegativeAirBand; units: number } | null;
}

export interface FilterUsageResult {
  jobHours: number;
  /** Job hours / 800 — a share of one filter, deliberately not rounded. See `filterUsage`. */
  filters: number;
}

export interface AsbestosCalculations {
  type: AsbestosType;
  derivedType: AsbestosType;
  typeIsOverridden: boolean;
  typeReason: string;
  areaSqM: number | null;

  geometry: RoomGeometry | null;
  containment: ContainmentPlan;
  hepaVac: HepaVacPlan;
  deconChamber: DeconChamber;

  /** Hours the job runs for — days x hours/day, or the PM's own total. Drives the filter charge. */
  jobHours: number | null;
  /** Crew size x job hours. */
  labourHours: number | null;

  negativeAir: NegativeAirResult | null;
  filterUsage: FilterUsageResult | null;
  /** Linear feet of exhaust ducting the PM entered, or null. */
  ductingLinearFeet: number | null;
  /** Negative air units plus any other equipment, which is what gets decontaminated. */
  equipmentUnits: number;

  /** Wall removal only: the area entered, and how many walls it was reckoned to span. */
  wallRemovalSqFt: number | null;
  wallsRemovedIsOverridden: boolean;

  /** Null when the PM has not priced it yet — an open item, not zero. See `AsbestosScope`. */
  preAbatementFee: number | null;
  postAbatementFee: number | null;
}

/**
 * Hours the job actually runs.
 *
 * A stated total wins over days x hours/day, because a PM who typed one meant it — and the two
 * disagreeing is a normal state of a half-filled form, not an error to surface.
 */
export function jobHours(scope: AsbestosScope): number | null {
  const total = parsePositive(scope.totalHoursOverride);
  if (total !== null) return total;
  const days = parsePositive(scope.durationDays);
  const perDay = parsePositive(scope.hoursPerDay);
  if (days === null || perDay === null) return null;
  return days * perDay;
}

/**
 * The share of a HEPA filter the job uses: job hours / 800.
 *
 * A FRACTION OF A FILTER, not a dollar figure — pricing belongs to the estimate, not here, and a
 * cost typed into this app would be a second place for a number that already lives in Xactimate.
 *
 * Deliberately not rounded up to a whole filter either: this is the share of a filter's life the
 * job consumed, so a two-hour job reads as the sliver it is rather than as a whole filter.
 */
export function filterUsage(hours: number): FilterUsageResult {
  return { jobHours: hours, filters: hours / HEPA_FILTER_HOURS };
}

/**
 * How many machines of which size, plus a larger size worth considering.
 *
 * The suggestion is advisory and never applied on its own — `size` is whatever the PM chose, or the
 * default. Overwriting their choice with a recommendation is the behaviour the equipment
 * confirm-or-suggest question in the water pipeline was built specifically to avoid.
 */
export function negativeAir(cubicFeet: number, ach: number, size: NegativeAirSize | null): NegativeAirResult {
  const chosen = size ?? DEFAULT_NEGATIVE_AIR_SIZE;
  const band = NEGATIVE_AIR_SIZES[chosen];
  const required = airChangeCfm(cubicFeet, ach);
  const suggested = size === null ? suggestNegativeAirSize(required) : null;

  return {
    cubicFeet,
    airChangesPerHour: ach,
    required,
    size: chosen,
    band,
    units: unitsForCapacity(required, band.rating),
    sizeIsChosen: size !== null,
    suggestion:
      suggested === null
        ? null
        : {
            size: suggested,
            band: NEGATIVE_AIR_SIZES[suggested],
            units: unitsForCapacity(required, NEGATIVE_AIR_SIZES[suggested].rating),
          },
  };
}

export function asbestosCalculations(scope: AsbestosScope, sketchRoom: SketchRoom | null): AsbestosCalculations {
  const areaSqFt = parsePositive(scope.areaDisturbedSqFt);
  const areaSqM = areaSqFt === null ? null : sqFtToSqM(areaSqFt);
  const classifyInput = { friable: scope.friable, areaSqM: areaSqM ?? 0, minimalDisturbance: scope.minimalDisturbance };

  const derivedType = deriveAsbestosType(classifyInput);
  const type = scope.typeOverride ?? derivedType;

  const geometry = roomGeometry(scope, sketchRoom);
  const wallRemovalSqFt = parsePositive(scope.wallRemovalSqFt);
  const derivedWalls = wallsRemovedFrom(wallRemovalSqFt, geometry);
  const wallsOverride = parsePositive(scope.wallsRemovedOverride);
  const containment = containmentPlan(containmentLevelForType(type), scope.surface, wallsOverride ?? derivedWalls, WALLS_PER_ROOM);

  const hours = jobHours(scope);
  const crew = parsePositive(scope.crewSize);
  const ach = parsePositive(scope.airChangesPerHour) ?? DEFAULT_AIR_CHANGES;
  // A machine count needs only the room and the air changes now — the size has a default, so this
  // no longer waits on the PM to type a CFM rating.
  const air = geometry ? negativeAir(geometry.cubicFt, ach, scope.negativeAirSize) : null;

  return {
    type,
    derivedType,
    typeIsOverridden: scope.typeOverride !== null && scope.typeOverride !== derivedType,
    typeReason: typeReason(classifyInput),
    areaSqM,
    geometry,
    containment,
    hepaVac: hepaVacPlan(containment),
    deconChamber: scope.deconChamber ?? defaultDeconChamber(type),
    jobHours: hours,
    labourHours: hours !== null && crew !== null ? crew * hours : null,
    negativeAir: air,
    filterUsage: hours !== null ? filterUsage(hours) : null,
    ductingLinearFeet: parsePositive(scope.ductingLinearFeet),
    wallRemovalSqFt,
    wallsRemovedIsOverridden: wallsOverride !== null && wallsOverride !== derivedWalls,
    preAbatementFee: parsePositive(scope.preAbatementFee),
    postAbatementFee: parsePositive(scope.postAbatementFee),
    equipmentUnits: (air?.units ?? 0) + (parsePositive(scope.otherEquipmentUnits) ?? 0),
  };
}

/** Anything filled in at all — used to decide whether the section exists, same as Contents. */
export function hasAsbestosContent(scope: AsbestosScope): boolean {
  return (
    scope.material.trim() !== "" ||
    parsePositive(scope.areaDisturbedSqFt) !== null ||
    parsePositive(scope.roomLengthFt) !== null ||
    scope.sketchRoomId !== null ||
    jobHours(scope) !== null ||
    parsePositive(scope.preAbatementFee) !== null ||
    parsePositive(scope.postAbatementFee) !== null ||
    scope.sampleCount.trim() !== "" ||
    scope.notes.trim() !== ""
  );
}
