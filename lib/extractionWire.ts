import type {
  BaseboardAction,
  BaseboardRecord,
  CabinetryRecord,
  CeilingFinish,
  CeilingRecord,
  CeilingType,
  ContentsManipulation,
  CountertopMaterial,
  CountertopRecord,
  DetachOrReplaceAction,
  DoorRecord,
  EquipmentRecord,
  FlooringDisposition,
  FlooringRecord,
  FlooringType,
  Loss,
  PlumbingFixtureRecord,
  PlumbingFixtureType,
  Room,
  VanityTopMaterial,
  VinylSubtype,
  WallMaterial,
  WallRecord,
  WaterLossExtraction,
  WorkPhase,
} from "./types";

/**
 * The wire shape of the extraction API's structured-outputs response — matches
 * `schema.ts`'s `extractionSchema` field-for-field, all non-nullable, sentinels standing in for
 * "not stated" (-1 for numbers, "" for free-text strings, "UNKNOWN" for enums, YES/NO/UNKNOWN for
 * tri-state booleans, and a "present" boolean for the one remaining nullable single-record field,
 * `contents`). See `schema.ts` for why this can't just be nullable fields, and for the
 * schema-shrink note explaining why this only covers a subset of the full domain model's fields.
 *
 * Deliberately a separate shape from `WaterLossExtraction` rather than reusing it directly:
 * decoding into this plain, fully-non-nullable wire shape first, then mapping to the domain model
 * by hand via `toDomain`, keeps every sentinel-to-null decision in exactly one place.
 *
 * Ported from the Android app's `service/scoping/ExtractionResponseWire.kt`.
 */
export interface ExtractionResponseWire {
  loss: LossWire;
  rooms: RoomWire[];
}

export function wireToDomain(wire: ExtractionResponseWire): WaterLossExtraction {
  return { loss: lossToDomain(wire.loss), rooms: wire.rooms.map(roomToDomain) };
}

export interface LossWire {
  category: number;
  class: number;
  source: string;
  dateOfLoss: string;
  yearOfBuilding: number;
  asbestosSamplesTaken: string;
  asbestosSampleCount: number;
  isBasementLoss: boolean;
  hvacInspectionRequired: string;
}

function lossToDomain(w: LossWire): Loss {
  return {
    category: intOrNull(w.category),
    lossClass: intOrNull(w.class),
    source: orNullIfBlank(w.source),
    dateOfLoss: orNullIfBlank(w.dateOfLoss),
    yearOfBuilding: intOrNull(w.yearOfBuilding),
    asbestosTestingRequired: false, // derived — see withDerivedFields()
    asbestosSamplesTaken: toTriState(w.asbestosSamplesTaken),
    asbestosSampleCount: intOrNull(w.asbestosSampleCount),
    isBasementLoss: w.isBasementLoss,
    hvacInspectionRequired: toTriState(w.hvacInspectionRequired),
  };
}

export interface RoomWire {
  roomName: string;
  flooring: FlooringRecordWire[];
  baseboard: BaseboardRecordWire[];
  walls: WallRecordWire[];
  doors: DoorRecordWire[];
  cabinetry: CabinetryRecordWire[];
  countertops: CountertopRecordWire[];
  ceilings: CeilingRecordWire[];
  plumbingFixtures: PlumbingFixtureRecordWire[];
  floorRegistersDetached: number;
  equipment: EquipmentRecordWire[];
  contents: ContentsManipulationRecordWire;
}

function roomToDomain(w: RoomWire): Room {
  return {
    roomName: w.roomName,
    flooring: w.flooring.map(flooringToDomain),
    baseboard: w.baseboard.map(baseboardToDomain),
    walls: w.walls.map(wallToDomain),
    doors: w.doors.map(doorToDomain),
    cabinetry: w.cabinetry.map(cabinetryToDomain),
    countertops: w.countertops.map(countertopToDomain),
    ceilings: w.ceilings.map(ceilingToDomain),
    // outlets/electricalPanel/toeKicks/wallTile/lightFixtures/stairs: never sent by extraction
    // (see schema.ts's schema-shrink note) — always empty/null here, exactly as if the PM never
    // mentioned them. plumbingFixtures is re-enabled (round 3) but scoped to just bathroom
    // vanity/toilet — see PlumbingFixtureRecordWire below.
    toeKicks: [],
    wallTile: [],
    outlets: [],
    lightFixtures: [],
    electricalPanel: null,
    plumbingFixtures: w.plumbingFixtures.map(plumbingFixtureToDomain),
    stairs: null,
    floorRegistersDetached: intOrNull(w.floorRegistersDetached),
    equipment: w.equipment.map(equipmentToDomain),
    contents: w.contents.present ? contentsToDomain(w.contents) : null,
    ceilingLightFixtureCount: null,
    ceilingFixturesInRemovalArea: null,
    windowCleaningAsked: false,
    windowCleaningCounts: null,
    baseboardConfirmedAbsent: false,
    equipmentAsked: false,
    waterExtractionRequired: null,
    antimicrobialApplied: null,
    containmentRequired: null,
    containmentSF: null,
    hepaVacuumingRequired: null,
    // Filled by the detail pass — call 1 has no room for another category (see schema.ts).
    appliances: [],
    waterExtractionSF: null,
    waterExtractionFraction: null,
    // Gap-check-only (round 6) — never extracted, see Room.ceilingLightFixturesPresent's doc comment.
    ceilingLightFixturesPresent: null,
    ceilingLightFixtureType: null,
    otherCeilingFixtures: null,
  };
}

export interface FlooringRecordWire {
  type: string;
  vinylSubtype: string;
  disposition: string;
  phase: string;
  phaseUncertain: boolean;
  /** Re-enabled (Phase 1 web review) — was gap-check-only; extraction now captures it when stated. */
  padPresent: string;
  /** Re-enabled (Phase 1 web review) — was gap-check-only; extraction now captures it when stated. */
  padRemoved: string;
}

function flooringToDomain(w: FlooringRecordWire): FlooringRecord {
  return {
    type: enumOrNull<FlooringType>(w.type),
    carpetStyle: null,
    padPresent: toTriState(w.padPresent),
    vinylSubtype: enumOrNull<VinylSubtype>(w.vinylSubtype),
    vinylInstallation: null,
    vinylSubstrate: null,
    hardwoodConstruction: null,
    hardwoodConstructionOther: null,
    hardwoodInstallation: null,
    disposition: enumOrNull<FlooringDisposition>(w.disposition),
    phase: enumOrNull<WorkPhase>(w.phase),
    phaseUncertain: w.phaseUncertain,
    padRemoved: toTriState(w.padRemoved),
    // Filled by the detail pass, not here — call 1's schema has no room left (see schema.ts).
    removalSF: null,
    removalFraction: null,
    cleaningRequired: null,
    // carpetLiftSF/padRemovedSF and their new fraction counterparts stay gap-check-only — the SF
    // vs. fraction distinction is a UI/answer-format concern (see gapCheck.ts), not something
    // worth extraction schema complexity for.
    carpetLiftSF: null,
    carpetLiftFraction: null,
    padRemovedSF: null,
    padRemovedFraction: null,
  };
}

export interface BaseboardRecordWire {
  heightIn: number;
  action: string;
  phase: string;
  phaseUncertain: boolean;
}

function baseboardToDomain(w: BaseboardRecordWire): BaseboardRecord {
  return {
    material: null,
    heightIn: numberOrNull(w.heightIn),
    wallRunFt: null,
    action: enumOrNull<BaseboardAction>(w.action),
    disposition: null,
    phase: enumOrNull<WorkPhase>(w.phase),
    phaseUncertain: w.phaseUncertain,
    mdfProfile: null,
  };
}

export interface WallRecordWire {
  wallMaterial: string;
  drywallBeingRemoved: boolean;
  insulationAffected: string;
}

function wallToDomain(w: WallRecordWire): WallRecord {
  return {
    wallMaterial: w.wallMaterial as WallMaterial,
    drywallBeingRemoved: w.drywallBeingRemoved,
    insulationAffected: toTriState(w.insulationAffected),
    insulationType: null,
    insulationRValue: null,
    floodCutHeightIn: null,
    // cutHeight/cutRunFt/cutRunFraction stay gap-check-only — see schema.ts's wallRecordSchema
    // comment for why a schema-level fix for cutHeight specifically was tried and reverted (round 12).
    cutHeight: null,
    cutRunFt: null,
    cutRunFraction: null,
  };
}

export interface DoorRecordWire {
  location: string;
  action: string;
}

function doorToDomain(w: DoorRecordWire): DoorRecord {
  return {
    location: w.location,
    action: w.action as DetachOrReplaceAction,
    slabOnly: null,
    doorType: null,
    unitType: null,
    saveHardware: null,
  };
}

export interface CabinetryRecordWire {
  location: string;
  action: string;
}

function cabinetryToDomain(w: CabinetryRecordWire): CabinetryRecord {
  return {
    location: w.location,
    action: w.action as DetachOrReplaceAction,
    extent: null,
    grade: null,
  };
}

// ToeKickRecordWire, WallTileRecordWire, LightFixtureRecordWire, and StairRecordWire are
// deliberately not defined — RoomWire has no toeKicks/wallTile/lightFixtures/stairs fields at all
// (round 2 of the schema-shrink, see schema.ts). The domain types and gap-check question logic for
// all four are untouched and ready to go — re-adding these wire shapes plus their fields on
// RoomWire is the whole job if any of them come back later. PlumbingFixtureRecordWire (below,
// after CeilingRecordWire) is back as of round 3, scoped to bathroom vanity/toilet only.

export interface CountertopRecordWire {
  action: string;
  material: string;
}

function countertopToDomain(w: CountertopRecordWire): CountertopRecord {
  return {
    action: w.action as DetachOrReplaceAction,
    material: enumOrNull<CountertopMaterial>(w.material),
  };
}

export interface CeilingRecordWire {
  type: string;
  action: string;
  finish: string;
  replaceSF: number;
}

function ceilingToDomain(w: CeilingRecordWire): CeilingRecord {
  return {
    type: w.type as CeilingType,
    action: w.action as DetachOrReplaceAction,
    finish: enumOrNull<CeilingFinish>(w.finish),
    textureStyle: null,
    spaceAboveHasInsulation: false,
    aboveInsulationType: null,
    aboveInsulationRValue: null,
    aboveInsulationAffected: null,
    detachScope: null,
    tileSize: null,
    mountMethod: null,
    replaceSF: intOrNull(w.replaceSF),
    replaceFraction: null,
  };
}

/**
 * Scoped to just BATHROOM_VANITY and TOILET (see schema.ts's plumbingFixtureRecordSchema) —
 * kitchen sink, standalone bathroom sink, and tub/shower aren't extracted yet, so their wire
 * fields (basinCount, mount, includesSurround, surroundMaterial) don't appear here at all;
 * `toDomain` fills the domain model's defaults for those the same way every other cut field does
 * elsewhere in this file. sinkAlsoNeeded/sinkFaucetSaved/grade default the same way — see
 * PlumbingFixtureRecord's doc comments in types.ts for why those aren't gap-checked either.
 */
export interface PlumbingFixtureRecordWire {
  fixtureType: string;
  action: string;
  topDetached: string;
  topKept: string;
  topMaterial: string;
}

function plumbingFixtureToDomain(w: PlumbingFixtureRecordWire): PlumbingFixtureRecord {
  return {
    fixtureType: w.fixtureType as PlumbingFixtureType,
    action: w.action as DetachOrReplaceAction,
    basinCount: null,
    mount: null,
    sinkAlsoNeeded: null,
    topDetached: toTriState(w.topDetached),
    topKept: toTriState(w.topKept),
    topMaterial: enumOrNull<VanityTopMaterial>(w.topMaterial),
    sinkFaucetSaved: null,
    grade: null,
    includesSurround: null,
    surroundMaterial: null,
  };
}

// ElectricalOutletRecordWire and ElectricalPanelRecordWire are deliberately not defined — RoomWire
// has no outlets/electricalPanel fields at all (see schema.ts: "we won't check this category" for
// now). The domain types and gap-check question logic for both are untouched and ready to go.

export interface ContentsManipulationRecordWire {
  present: boolean;
  manipulationDeclined: boolean;
  affected: boolean;
}

function contentsToDomain(w: ContentsManipulationRecordWire): ContentsManipulation {
  // packOutRequired is filled by the detail pass — call 1 has no room (see schema.ts).
  return { size: null, manipulationDeclined: w.manipulationDeclined, affected: w.affected, packOutRequired: null };
}

export interface EquipmentRecordWire {
  type: string;
  quantity: number;
}

function equipmentToDomain(w: EquipmentRecordWire): EquipmentRecord {
  return { type: w.type, quantity: intOrNull(w.quantity) };
}

// ---- sentinel helpers --------------------------------------------------------------------------

function intOrNull(n: number): number | null {
  return n === -1 ? null : n;
}
function numberOrNull(n: number): number | null {
  return n === -1 || n === -1.0 ? null : n;
}
function orNullIfBlank(s: string): string | null {
  return s.trim() === "" ? null : s;
}
function toTriState(s: string): boolean | null {
  if (s === "YES") return true;
  if (s === "NO") return false;
  return null;
}
/** The schema's `enum` list already constrains the model to real values or "UNKNOWN" for this field. */
function enumOrNull<T extends string>(value: string): T | null {
  return value === "UNKNOWN" ? null : (value as T);
}

/**
 * One fully-populated record of each type, as the real mapping builds it.
 *
 * Exists for the test fixtures, and only for them — nothing in the app reads it. Fixtures are
 * hand-written object literals, so a field added to a domain type is simply missing from them; and
 * `undefined` is not `null`, so every question gated on `field === null` quietly stops firing in the
 * tests while firing normally in the app. `flooring.removalSF` was added, asked in the app, and
 * walked straight past the audit that exists to catch exactly that.
 *
 * These come from the real `*ToDomain` functions, so TypeScript rejects a missing field here the
 * moment a domain type grows one, and `test/gapcheck/run.mjs` compares fixture keys against them.
 */
export function canonicalRecordShapes(): { flooring: FlooringRecord; baseboard: BaseboardRecord } {
  return {
    flooring: flooringToDomain({
      type: "",
      vinylSubtype: "",
      disposition: "",
      phase: "",
      phaseUncertain: false,
      padPresent: "",
      padRemoved: "",
    }),
    baseboard: baseboardToDomain({ heightIn: -1, action: "", phase: "", phaseUncertain: false }),
  };
}
