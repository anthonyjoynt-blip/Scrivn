/**
 * The structured-extraction data shape for a water loss. Ported field-for-field from the Android
 * app's `model/waterloss/WaterLossExtraction.kt` — this is the *only* shape the extraction API
 * call (step 1, see `extractionPrompt.ts`) is responsible for producing. Gap-check (step 2,
 * `gapCheck.ts`) then mutates a copy of this tree as the user answers follow-up questions;
 * document generation (step 3, `documentGenerationPrompt.ts`) reads the completed tree.
 *
 * Every "optional if not yet known" field is `| null` on purpose: extraction only captures what
 * the transcript actually said, and gap-check's whole job is noticing what's still missing.
 *
 * This is the in-memory/UI shape, with ordinary `null`s. The Claude API's structured-outputs
 * response has a *different* wire shape (no nulls at all, sentinel values instead — see
 * `extractionWire.ts` for why and how it maps into this shape).
 *
 * A few fields below aren't in the original schema text but are necessary extensions the Android
 * app added to make gap-check actually work — each is called out at its declaration:
 * `EquipmentRecord` (room-level equipment list), `FlooringRecord/BaseboardRecord.phaseUncertain`,
 * `CeilingRecord.spaceAboveHasInsulation`, and `ElectricalOutletRecord.isOutlet`.
 *
 * NOTE on scope: extraction currently only ever populates `flooring`, `baseboard`, `walls`,
 * `doors`, `cabinetry`, `countertops`, `ceilings`, `floorRegistersDetached`, `equipment`, and
 * `contents` on a Room — the Android app's extraction JSON schema was trimmed twice after hitting
 * Anthropic Structured Outputs size limits (see `schema.ts`), cutting `outlets`, `electricalPanel`,
 * `toeKicks`, `wallTile`, `lightFixtures`, `plumbingFixtures`, and `stairs` from what extraction
 * sends/receives. The *types* and *gap-check questions* for those categories are kept here anyway
 * (ported in full, same as the Android app) so re-enabling a category later is purely a
 * schema/wire change — nothing in this file or `gapCheck.ts` has to change.
 */
export interface WaterLossExtraction {
  loss: Loss;
  rooms: Room[];
}

export interface Loss {
  /** IICRC contamination category, 1-3. Null — the transcript may not have stated it yet. */
  category: number | null;
  /** IICRC extent/difficulty class, 1-4. */
  lossClass: number | null;
  source: string | null;
  /** ISO-8601 date string (yyyy-MM-dd), or null if not stated. */
  dateOfLoss: string | null;
  yearOfBuilding: number | null;
  /**
   * Derived, never extracted — computed immediately after extraction as `yearOfBuilding <= 1990`.
   * Deliberately excluded from the extraction JSON schema; see {@link withDerivedFields}.
   */
  asbestosTestingRequired: boolean;
  asbestosSamplesTaken: boolean | null;
  /** Only meaningful when `asbestosSamplesTaken === true`. */
  asbestosSampleCount: number | null;
  /** Always directly extracted (never gap-checked) — whether this loss involves a basement at all. */
  isBasementLoss: boolean;
  /** Gap-checked only when `isBasementLoss === true`. */
  hvacInspectionRequired: boolean | null;
}

export interface Room {
  roomName: string;
  flooring: FlooringRecord[];
  baseboard: BaseboardRecord[];
  walls: WallRecord[];
  doors: DoorRecord[];
  cabinetry: CabinetryRecord[];
  toeKicks: ToeKickRecord[];
  countertops: CountertopRecord[];
  wallTile: WallTileRecord[];
  ceilings: CeilingRecord[];
  outlets: ElectricalOutletRecord[];
  lightFixtures: LightFixtureRecord[];
  /** Non-null means this room's panel was flagged as affected. */
  electricalPanel: ElectricalPanelRecord | null;
  plumbingFixtures: PlumbingFixtureRecord[];
  stairs: StairRecord | null;
  /** Only meaningful (and only gap-checked) when this room has flooring with disposition REMOVE_AND_DISPOSE. */
  floorRegistersDetached: number | null;
  /**
   * Not every room has contents that need moving out of the way for mitigation work. Gap-checked
   * per the contents rule: any room with emergency/repair work gets asked its content size,
   * unless manipulation was explicitly declined for that room.
   */
  contents: ContentsManipulation | null;
  /**
   * Not part of the original given data schema, but required to support the "any drying equipment
   * mentioned with no stated quantity" always-required rule. Extraction populates
   * `EquipmentRecord.quantity` only when a count was stated; `type` is free-text because equipment
   * naming is dictated, not a fixed enum in the domain model (though the extraction *prompt*
   * currently restricts it to "air movers" / "dehumidifiers" — see `extractionPrompt.ts`).
   */
  equipment: EquipmentRecord[];
  /**
   * Appliances that come out and go back — see {@link ApplianceRecord}.
   *
   * Populated by the DETAIL pass, not call 1, and unlike everything else it returns this list is not
   * positional: there are no call-1 appliance records to line up against, so the detail pass produces
   * the list outright rather than annotating one. That is safe precisely because nothing else refers
   * to these by index.
   */
  appliances: ApplianceRecord[];
  /**
   * Gap-check-only, round 12 — never populated by extraction. General water-claim gap-check ("one
   * more gap check for all water claims, if water extraction was not mentioned - ask if water
   * extraction was required"), distinct from the narrow LIFT_AND_REINSTALL-carpet auto-include in
   * documentGenerationPrompt.ts (that case is always assumed true and never reaches this field at
   * all — see gapCheck.ts's waterExtractionQuestions). null means "not yet asked," same convention
   * as every other nullable gap-checked field in this file — no separate "asked" flag needed.
   */
  waterExtractionRequired: boolean | null;
  /**
   * Antimicrobial applied in this room.
   *
   * Per-room, not claim-level, because that is the shape the data already has: DGIG's Emergency form
   * has carried `antimicrobial` per room since it was built (`lib/dgig.ts`), and a PM saying
   * "antimicrobial throughout both spaces" is naming rooms. Claim-level would have had to invent a
   * shape the rest of the app does not use.
   *
   * It existed ONLY on that DGIG form, which is why a Wawanesa claim stating antimicrobial produced
   * an inspection report that mentioned it and a scope that did not: the report is written with the
   * transcript in hand, the scope's line rules can only see this tree. A fact with no home here is
   * visible to one and invisible to the other — the same shape as the gap-check bug that
   * `test/gapcheck/extractable.mjs` exists to prevent.
   */
  antimicrobialApplied: boolean | null;
  /**
   * Poly barriers sealing this area off. Priced per square foot of barrier, per the user.
   *
   * Two fields for the same reason water extraction has two: a PM routinely says containment is
   * going up without saying how big it is, and "mentioned but unmeasured" has to be distinguishable
   * from "never came up" or gap-check cannot know to ask.
   */
  containmentRequired: boolean | null;
  /** SF of barrier. Only meaningful, and only gap-checked, when containmentRequired is true. */
  containmentSF: number | null;
  /**
   * HEPA vacuuming in this room. A boolean and no quantity of its own: it is priced per SF of floor,
   * which the room already has — from the sketch where one exists, and qualitatively otherwise — so
   * asking for the number again would be asking the PM to repeat the floor area.
   */
  hepaVacuumingRequired: boolean | null;
  /** Only meaningful (and only gap-checked) when waterExtractionRequired is true. Real SF count. */
  waterExtractionSF: number | null;
  /** Qualitative alternative to waterExtractionSF — see {@link AreaFraction}. */
  waterExtractionFraction: AreaFraction | null;
  /**
   * Gap-check bookkeeping only — never populated by extraction, never read by document generation.
   * Set when the PM answers the baseboard completeness question with "no baseboard in this area",
   * which is what stops a room being asked for ever about trim it does not have.
   *
   * Its former companion `baseboardPresenceConfirmed` is gone: presence used to be its own yes/no
   * shown beside the action, and folding absence into the action question's options left nothing
   * for a "yes, they exist" flag to do.
   */
  baseboardConfirmedAbsent: boolean;
  /**
   * Windows needing cleaning after drywall work — gap-check only, never extracted.
   *
   * Cutting and sanding drywall coats everything in the room, and glass shows it. A PM dictating a
   * scope is describing damage, not the mess the repair will make, so this is one nobody mentions
   * and everybody has to go back for. Same shape as the baseboard and equipment flags above: the
   * `Asked` flag is what makes it fire exactly once however it is answered, rather than every pass.
   */
  windowCleaningAsked: boolean;
  /**
   * How many windows of each size band.
   *
   * A map rather than a count plus one size, because a room's windows are routinely not all the same
   * size and one size band applied to all of them prices the job wrong — "if I said 2 windows I
   * couldn't say 2 different sizes". Null means nobody has said yet; an empty map means asked and
   * answered none. A band that is absent, or present as zero, means none of that size.
   */
  windowCleaningCounts: Partial<Record<WindowCleaningSize, number>> | null;
  /**
   * Gap-check bookkeeping only, same idea as baseboardConfirmedAbsent — round 12, per direct
   * feedback ("on water claims lets also just ask if drying equipment was used... but if the pm
   * just forgot to mention drying equipment lets just check that on water claims in general").
   * `equipment` above only ever gets quantity-gap-checked for records extraction already created;
   * this flag is what lets a room with ZERO equipment records still get asked "was any used at
   * all" exactly once, whichever way it's answered, rather than every subsequent evaluate() pass.
   */
  equipmentAsked: boolean;
  /**
   * Room-level, not tied to a specific ceiling record — asked once when the room has any ceiling
   * drywall replacement work at all (see gapCheck.ts's ceilingFixtureQuestions). Not part of the
   * Android app's model — added during the Phase 1 web review (round 6): ceiling drywall work
   * often means light fixtures need to come down and go back up too.
   */
  ceilingLightFixturesPresent: boolean | null;
  /**
   * Whether the ceiling fixtures sit inside the drywall actually coming out — gap-check only.
   *
   * Decides the PHASE of their detach and reset. A fixture inside the removal area has to come down
   * before the drywall does, so detach is Emergency and reset is Repair. A fixture outside it is
   * only coming down for the retexturing, which is Repair work — so both halves are Repair, and
   * splitting them across phases would put a crew on site in the emergency phase for a fixture
   * nobody needs to touch yet.
   *
   * Asked rather than inferred: the app knows a ceiling is partly coming out, not which part, and
   * guessing where a fixture sits relative to a six-by-four patch is exactly the kind of geometry
   * it has no business assuming.
   */
  ceilingFixturesInRemovalArea: boolean | null;
  /** Only meaningful (and only gap-checked) when ceilingLightFixturesPresent === true. */
  ceilingLightFixtureType: RoomLightFixtureType | null;
  /**
   * How many fixtures — gap-check only, and previously not asked at all.
   *
   * The scope said "Detach light fixture" whether the room had one or six, which is not a quantity
   * anyone can price or plan a crew around. Same trigger and same round as the type.
   */
  ceilingLightFixtureCount: number | null;
  /**
   * Free text, room-level, same trigger as ceilingLightFixturesPresent — whatever the PM says
   * becomes the scope line verbatim (smoke detectors, other fixtures needing to come down). Empty
   * string means "not yet asked"; an answer of "None" (or similar) means nothing to add — either
   * way this isn't rendered as its own bullet, see documentGenerationPrompt.ts.
   */
  otherCeilingFixtures: string | null;
}

/** See Room.ceilingLightFixtureType's doc comment. */
export type RoomLightFixtureType = "REGULAR" | "RECESSED" | "RECESSED_TRIM_ONLY" | "CHANDELIER";

export interface EquipmentRecord {
  type: string;
  quantity: number | null;
}

/**
 * An appliance that comes out to work behind or under it, and goes back afterwards.
 *
 * No action field, unlike every other category: a restoration contractor detaches and resets
 * appliances, and does not replace them — that is the homeowner's or the retailer's, so modelling
 * remove-and-replace here would offer a choice nobody makes. Confirmed with the user.
 */
export type ApplianceType =
  | "WASHER"
  | "DRYER"
  | "FRIDGE"
  | "RANGE"
  | "DISHWASHER"
  | "BUILT_IN_OVEN"
  | "COOKTOP"
  | "RANGE_HOOD"
  | "BUILT_IN_MICROWAVE";

export interface ApplianceRecord {
  type: ApplianceType;
}

export type FlooringType = "CARPET" | "VINYL" | "HARDWOOD" | "LAMINATE" | "TILE" | "CONCRETE";
export type CarpetStyle = "PILE" | "BERBER" | "RUBBER_BACKED_GLUE_DOWN";
export type VinylSubtype = "SHEET" | "PLANK";
export type VinylInstallation = "GLUED" | "SNAPLOCK_FLOATING";
export type VinylSubstrate = "CONCRETE" | "WOOD";
/**
 * PREFINISHED is a real third construction, not a finish applied to the other two — it changes what
 * a replacement costs and how it goes in, so it belongs beside them rather than as a note.
 *
 * OTHER exists because species and construction are broad enough that any fixed list misses real
 * floors, and forcing a PM to pick the nearest wrong option puts a wrong spec in a scope. It pairs
 * with `hardwoodConstructionOther` below, which carries what they actually said.
 */
export type HardwoodConstruction = "SOLID" | "ENGINEERED" | "PREFINISHED" | "OTHER";
/** NAILED is the traditional method and was simply missing — a nailed floor is neither of the others. */
export type HardwoodInstallation = "FLOATING" | "GLUED" | "NAILED";
export type FlooringDisposition = "DRY_IN_PLACE" | "LIFT_AND_REINSTALL" | "REMOVE_AND_DISPOSE" | "REMOVE_AND_ASSESS";
export type WorkPhase = "EMERGENCY" | "REPAIR" | "BOTH";

/**
 * A qualitative alternative to stating an exact square-footage/linear-footage quantity — "half the
 * room" is just as valid an answer as "120 SF." Not in the Android source; added during the Phase
 * 1 web review for every "real count" field that turned out to need this flexibility (carpet
 * lift/pad removal, wall drywall cut run, ceiling drywall replacement). Wherever this is used, it
 * pairs with a same-named `...SF`/`...Ft` numeric field — exactly one of the pair is ever set, the
 * other stays null. See `gapCheck.ts`'s `parseAreaQuantity` for how a free-text answer becomes one
 * or the other, and `documentGenerationPrompt.ts` for how each renders in the generated bullet.
 */
export type AreaFraction = "QUARTER" | "HALF" | "THREE_QUARTERS" | "FULL";

/**
 * Window size bands for post-drywall cleaning, in square feet of glass.
 *
 * Bands rather than a measurement: nobody measures a window to price cleaning it, and the bands are
 * what the pricing actually keys off. See `WINDOW_CLEANING_SIZE_LABEL` for how each one reads.
 */
export type WindowCleaningSize = "SF_3_9" | "SF_10_20" | "SF_21_40" | "SF_41_60";

export const WINDOW_CLEANING_SIZE_LABEL: Record<WindowCleaningSize, string> = {
  SF_3_9: "3–9 SF",
  SF_10_20: "10–20 SF",
  SF_21_40: "21–40 SF",
  SF_41_60: "41–60 SF",
};

/** Every band, in ascending order — the order they are offered and printed in. */
export const WINDOW_CLEANING_SIZES: WindowCleaningSize[] = ["SF_3_9", "SF_10_20", "SF_21_40", "SF_41_60"];

/** Total windows across all bands. Zero for "asked, none"; zero also for a map of zeroes. */
export function totalWindowsToClean(counts: Partial<Record<WindowCleaningSize, number>> | null): number {
  if (!counts) return 0;
  return WINDOW_CLEANING_SIZES.reduce((sum, band) => sum + (counts[band] ?? 0), 0);
}

export interface FlooringRecord {
  type: FlooringType;
  carpetStyle: CarpetStyle | null;
  padPresent: boolean | null;
  vinylSubtype: VinylSubtype | null;
  vinylInstallation: VinylInstallation | null;
  vinylSubstrate: VinylSubstrate | null;
  hardwoodConstruction: HardwoodConstruction | null;
  /** Free text, only meaningful when `hardwoodConstruction` is OTHER. Gap-check only. */
  hardwoodConstructionOther: string | null;
  hardwoodInstallation: HardwoodInstallation | null;
  disposition: FlooringDisposition | null;
  phase: WorkPhase | null;
  /**
   * Extraction-only signal, never gap-checked directly and never used by document generation:
   * true when the transcript itself expressed uncertainty about phase ("assess", "not sure if
   * replacing", "hold off on repair"). Gap-check reads this to decide between silently defaulting
   * phase and asking a phase question. A plain "remove and replace" leaves this false.
   */
  phaseUncertain: boolean;
  /**
   * Only meaningful when disposition === LIFT_AND_REINSTALL and padPresent === true — whether the
   * pad itself is being pulled out while the carpet is lifted to get at it.
   */
  padRemoved: boolean | null;
  /**
   * How much of this floor is coming out. Only meaningful for a removal disposition
   * (REMOVE_AND_DISPOSE / REMOVE_AND_ASSESS) — a floor being lifted and reinstalled uses
   * `carpetLiftSF` instead, and a floor staying put has no removal at all.
   *
   * Applies to EVERY flooring type, not just carpet. Carpet-lift was the only quantity flooring
   * carried, so a stated "six by eight feet" of vinyl had nowhere to land and the scope rendered
   * the qualitative fallback — "small area at the dishwasher" — for a floor whose exact size the PM
   * had said out loud. A number that was given and then dropped is worse than one never given: the
   * vague phrase looks like the best anyone knew.
   */
  removalSF: number | null;
  /** Qualitative alternative to removalSF — see {@link AreaFraction}. */
  removalFraction: AreaFraction | null;
  /**
   * The floor stays and gets cleaned — and, on a category 2/3 loss, treated.
   *
   * The case this exists for is the one nobody had a field for: an unfinished basement's concrete
   * slab. Nothing is removed, so every rule keyed off a removal disposition passes it by, and the
   * only thing the scope had left to say was "dry in place" — which in this trade means saving
   * material you would otherwise tear out, and nobody tears out a slab. So a floor that was going to
   * be scrubbed and treated reached the estimator described as having been left alone.
   *
   * Not limited to concrete. Tile, sealed hardwood and sheet vinyl all routinely stay down and get
   * cleaned, and all of them read the same way without this.
   */
  cleaningRequired: boolean | null;
  /** SF of carpet being lifted to access the pad. Only gap-checked when padRemoved === true. */
  carpetLiftSF: number | null;
  /** Qualitative alternative to carpetLiftSF — see {@link AreaFraction}. */
  carpetLiftFraction: AreaFraction | null;
  /** SF of pad being removed. Only gap-checked when padRemoved === true. */
  padRemovedSF: number | null;
  /** Qualitative alternative to padRemovedSF — see {@link AreaFraction}. */
  padRemovedFraction: AreaFraction | null;
}

export type BaseboardMaterial = "SOLID_WOOD" | "MDF" | "VINYL_PVC_COMPOSITE";
export type BaseboardAction = "DETACH_AND_RESET" | "REMOVE_AND_REPLACE" | "SHOE_MOLD_ONLY";
export type BaseboardDisposition = "SALVAGE_DRY" | "REMOVE_AND_DISPOSE";
/** Not in the Android source — added after Phase 1 web review found MDF replacement needs this distinction. */
export type BaseboardMdfProfile = "FLAT" | "PROFILE";

export interface BaseboardRecord {
  material: BaseboardMaterial | null;
  heightIn: number | null;
  wallRunFt: number | null;
  /**
   * Null only transiently, right after the room-level "are baseboards present?" completeness
   * question has been answered "yes" but the shoe-mold/detach/replace follow-up hasn't been
   * answered yet. Every baseboard record generation reads has a non-null action.
   */
  action: BaseboardAction | null;
  /**
   * Not applicable for SHOE_MOLD_ONLY (nothing is removed) or DETACH_AND_RESET (the same
   * baseboard goes back down, so it's salvaged by construction, not by a stated choice).
   * Meaningful — and gap-checked as part of the standard always-required fields — only once
   * action === REMOVE_AND_REPLACE.
   */
  disposition: BaseboardDisposition | null;
  phase: WorkPhase | null;
  phaseUncertain: boolean;
  /**
   * Only meaningful (and only gap-checked) when material === MDF and action === REMOVE_AND_REPLACE
   * — new MDF baseboard can be a flat plain profile or a decorative/molded profile, and that
   * changes the material detail on the scope-document line. Not part of the extraction schema —
   * purely a gap-check follow-up, same as cabinetry grade or countertop material.
   */
  mdfProfile: BaseboardMdfProfile | null;
}

export type WallMaterial = "DRYWALL" | "PLASTER" | "PANELING";
export type InsulationType = "FIBERGLASS_BATT" | "BLOWN_IN" | "CELLULOSE" | "FOAM";

/**
 * Insulation R-value, and the depths that produce it where the product is blown rather than batted.
 *
 * Batt is sold by R-value, so the PM reads it off the label. Blown-in has no label to read: what is
 * knowable on site is the DEPTH, and the R-value follows from it — which is why these options name
 * both. The two lists are per-type on purpose; offering a batt R-value against a blown-in install
 * invites a number that was never measured.
 *
 * Cellulose and foam are deliberately absent. No table was given for them, and an R-value invented
 * for an insurer's scope is worse than an R-value left unrecorded.
 */
export const BATT_R_VALUES = ["R12", "R14", "R20", "R24"] as const;

export const BLOWN_IN_R_VALUES = [
  { depth: '10"', rValue: "R26" },
  { depth: '12"', rValue: "R30" },
  { depth: '14"', rValue: "R38" },
  { depth: '16"', rValue: "R44" },
  { depth: '20"', rValue: "R50" },
  { depth: '24"', rValue: "R66" },
] as const;

/** How a blown-in option reads to the PM: the depth they can measure, and what it comes to. */
export function blownInLabel(option: { depth: string; rValue: string }): string {
  return `${option.depth} — ${option.rValue}`;
}

/** The R-value options for a given insulation type, or none where no table applies. */
export function rValueOptionsFor(type: InsulationType | null): string[] {
  if (type === "FIBERGLASS_BATT") return [...BATT_R_VALUES];
  if (type === "BLOWN_IN") return BLOWN_IN_R_VALUES.map(blownInLabel);
  return [];
}
/**
 * How high the drywall flood cut runs — governs both the Repair-phase phrasing and whether
 * priming/painting gets auto-included at all (see `documentGenerationPrompt.ts`). BASE is a cut
 * right at/below baseboard height (up to ~4"): standard practice is to replace and let the
 * baseboard cover the seam, unfinished — no priming/painting. TWO_FOOT/FOUR_FOOT are flood cuts at
 * those heights specifically (the two heights actually used in practice); FULL_WALL is floor to
 * ceiling. Not part of the Android app's model — added during the Phase 1 web review, gap-check
 * only (not extracted) since it's a small, closed set the PM can just confirm on the follow-up
 * screen.
 */
export type WallDrywallCutHeight = "BASE" | "TWO_FOOT" | "FOUR_FOOT" | "FULL_WALL";

export interface WallRecord {
  wallMaterial: WallMaterial;
  drywallBeingRemoved: boolean;
  insulationAffected: boolean | null;
  insulationType: InsulationType | null;
  /**
   * R-value, once the type is known and has a table. Gap-check only — never extracted, for the same
   * reason `insulationType` is not: the schema is at its compiled-grammar ceiling.
   */
  insulationRValue: string | null;
  floodCutHeightIn: number | null;
  /**
   * Only meaningful (and only gap-checked) when drywallBeingRemoved === true. See
   * {@link WallDrywallCutHeight}. Round 12 tried extracting this directly from the transcript (a PM
   * who already said "remove drywall at 2 feet" was still being asked the height as a gap-check
   * question) — adding it to the extraction schema immediately hit Structured Outputs' "compiled
   * grammar is too large" ceiling and broke extraction outright, so that was reverted; this field
   * stays gap-check-only. See schema.ts's wallRecordSchema comment for the full story.
   */
  cutHeight: WallDrywallCutHeight | null;
  /**
   * Linear feet of wall run being cut/replaced — only meaningful, and only gap-checked, when
   * cutHeight is TWO_FOOT or FOUR_FOOT (the math needs a linear-footage basis; BASE and FULL_WALL
   * render qualitatively — see documentGenerationPrompt.ts).
   */
  cutRunFt: number | null;
  /** Qualitative alternative to cutRunFt — see {@link AreaFraction}. */
  cutRunFraction: AreaFraction | null;
}

/** Shared by every record type below whose only two possible actions are "detach & reset" vs. "remove & replace". */
export type DetachOrReplaceAction = "DETACH_AND_RESET" | "REMOVE_AND_REPLACE";

export type DoorType = "COLONIAL" | "SOLID_CORE" | "HOLLOW_CORE" | "OTHER";
export type DoorUnitType = "PRE_HUNG" | "SLAB_ONLY";

export interface DoorRecord {
  location: string;
  action: DetachOrReplaceAction;
  slabOnly: boolean | null;
  doorType: DoorType | null;
  unitType: DoorUnitType | null;
  saveHardware: boolean | null;
}

export type CabinetryExtent = "UPPERS" | "LOWERS" | "FULL_HEIGHT";
export type CabinetryGrade = "STANDARD" | "HIGH" | "PREMIUM" | "DELUXE";

export interface CabinetryRecord {
  location: string;
  action: DetachOrReplaceAction;
  extent: CabinetryExtent | null;
  grade: CabinetryGrade | null;
}

export type ToeKickMethod = "RESKIN" | "PREFINISHED_REPLACEMENT";

export interface ToeKickRecord {
  action: DetachOrReplaceAction;
  method: ToeKickMethod | null;
}

/**
 * SOLID_SURFACE was missing here until a PM said "the countertop’s solid surface" on a
 * transcript and extraction had nowhere to put it — it captured nothing, gap-check then asked a
 * question that had already been answered out loud, and the answer typed in testing contradicted
 * the recording. A value the field cannot hold is a value the transcript cannot state.
 *
 * `VanityTopMaterial` below has always had it, which is the same surface in a different room.
 */
export type CountertopMaterial = "LAMINATE" | "QUARTZ" | "GRANITE" | "SOLID_SURFACE";

export interface CountertopRecord {
  action: DetachOrReplaceAction;
  material: CountertopMaterial | null;
}

export type WallTileSurface = "WALL" | "FLOOR";

export interface WallTileRecord {
  // Action isn't modeled as a field: DETACH_AND_RESET isn't valid for this material, so every
  // WallTileRecord is implicitly REMOVE_AND_REPLACE — see the gap-check note in gapCheck.ts.
  surface: WallTileSurface | null;
  trimPresent: boolean | null;
  trimLinearFt: number | null;
}

export type CeilingType = "DRYWALL_PLASTER" | "SUSPENDED_TILE";
export type CeilingFinish = "TEXTURE" | "SMOOTH";
export type CeilingTileDetachScope = "TILES_ONLY" | "TILES_AND_GRID";
export type CeilingMountMethod = "SUSPENDED" | "STAPLED_GLUED";
/** Only meaningful when finish === TEXTURE — a PM saying "scrape and retexture" doesn't by itself say which. */
export type CeilingTextureStyle = "POPCORN" | "KNOCKDOWN";

export interface CeilingRecord {
  type: CeilingType;
  action: DetachOrReplaceAction;
  finish: CeilingFinish | null;
  /** Only meaningful, and only gap-checked, when finish === TEXTURE. Not part of the Android app's model — added during the Phase 1 web review. */
  textureStyle: CeilingTextureStyle | null;
  /**
   * Not in the original literal schema, but the gap-check rule ("insulation exists in the space
   * above → ask if affected") needs a signal to gate on, same role as WallRecord's
   * drywallBeingRemoved gating insulationAffected, applied upward instead of behind a wall.
   */
  /**
   * Dead as a gate, kept as a field.
   *
   * It was meant to decide whether the insulation question was worth asking, but nothing ever sets
   * it — the wire conversion hardcodes false and it is not in the extraction schema — so the
   * question it guarded could never fire, and a ceiling that came down over wet insulation had
   * nowhere to record that. The question is now asked whenever ceiling drywall is being removed,
   * which is the same trigger the wall version uses. Left in place rather than removed so nothing
   * reading it breaks; it simply gates nothing.
   */
  spaceAboveHasInsulation: boolean;
  aboveInsulationAffected: boolean | null;
  /**
   * Only meaningful, and only gap-checked, when aboveInsulationAffected === true. Gap-check only —
   * deliberately not extracted, since the schema is already at its compiled-grammar ceiling.
   */
  aboveInsulationType: InsulationType | null;
  /** R-value above the ceiling, same shape and same gap-check-only reason as the wall's. */
  aboveInsulationRValue: string | null;
  detachScope: CeilingTileDetachScope | null;
  tileSize: string | null;
  mountMethod: CeilingMountMethod | null;
  /**
   * SF of ceiling drywall being replaced — only meaningful, and only gap-checked, for type
   * DRYWALL_PLASTER with action REMOVE_AND_REPLACE. Not part of the Android app's model — added
   * during the Phase 1 web review so partial ceiling replacements keep a real quantity instead of
   * silently dropping it (see documentGenerationPrompt.ts).
   */
  replaceSF: number | null;
  /** Qualitative alternative to replaceSF — see {@link AreaFraction}. */
  replaceFraction: AreaFraction | null;
}

export type OutletDetachScope = "FULL_OUTLET" | "COVER_PLATE_ONLY";
export type OutletVoltage = "V110" | "V220";

export interface ElectricalOutletRecord {
  action: DetachOrReplaceAction;
  /**
   * Not in the original literal schema block, but the gap-check rules talk about "outlet/switch"
   * as one combined record and explicitly gate the voltage question on "if it's an outlet" — this
   * is that discriminator. Defaults true (outlet); false means the record describes a switch.
   */
  isOutlet: boolean;
  detachScope: OutletDetachScope | null;
  voltage: OutletVoltage | null;
}

export type LightFixtureType = "HANGING" | "FLUSH_MOUNT" | "CHANDELIER" | "OTHER";

export interface LightFixtureRecord {
  action: DetachOrReplaceAction;
  fixtureType: LightFixtureType | null;
}

export interface ElectricalPanelRecord {
  /** Gap-checked — "ask if it requires inspection" — despite appearing non-optional in the original schema text. */
  requiresInspection: boolean | null;
  /**
   * Whether work explicitly asked for panel work (beyond inspection) to be included in scope.
   * Extraction sets this directly from the transcript (defaults false). Never itself a gap-check
   * question.
   */
  includedInScope: boolean;
  /** Only gap-checked when `includedInScope === true`. */
  amperage: number | null;
  /** Only gap-checked when `includedInScope === true`. */
  includeMeterWork: boolean | null;
}

export type PlumbingFixtureType = "KITCHEN_SINK" | "BATHROOM_SINK" | "BATHROOM_VANITY" | "TOILET" | "TUB_SHOWER";
export type BasinCount = "SINGLE" | "DOUBLE";
export type SinkMount = "UNDERMOUNT" | "DROP_IN" | "OTHER";
export type VanityTopMaterial = "LAMINATE" | "SOLID_SURFACE";
export type SurroundMaterial = "FIBERGLASS" | "TILE";

export interface PlumbingFixtureRecord {
  fixtureType: PlumbingFixtureType;
  action: DetachOrReplaceAction;
  /** Kitchen sink only. */
  basinCount: BasinCount | null;
  /** Kitchen sink or standalone bathroom sink — also reused by the vanity "sink not saved" loop-back. */
  mount: SinkMount | null;
  /**
   * Bathroom vanity, DETACH_AND_RESET only. Not itself gap-checked as of the Phase 1 web review —
   * detaching the sink is now assumed automatically whenever a vanity is in scope at all (see the
   * generation prompt's auto-include), regardless of action. Left defined for parity with the
   * Android app; nothing sets or reads it here.
   */
  sinkAlsoNeeded: boolean | null;
  /** Bathroom vanity, DETACH_AND_RESET only — is the countertop also being detached, or staying in place? */
  topDetached: boolean | null;
  /**
   * Bathroom vanity, REMOVE_AND_REPLACE only — is the existing countertop being kept (detached and
   * reset), rather than replaced as part of the new vanity unit? New field, not part of the
   * Android app's model — added during the Phase 1 web review.
   */
  topKept: boolean | null;
  /** Bathroom vanity, only when `topDetached === true` or `topKept === true`. */
  topMaterial: VanityTopMaterial | null;
  /** Bathroom vanity, REMOVE_AND_REPLACE only. */
  sinkFaucetSaved: boolean | null;
  /** Bathroom vanity, REMOVE_AND_REPLACE only. Free text — no fixed grade vocabulary given. */
  grade: string | null;
  /** Tub/shower, either action. */
  includesSurround: boolean | null;
  /** Tub/shower, only when `includesSurround === true`. */
  surroundMaterial: SurroundMaterial | null;
}

export type StairFlooringType = "CARPET" | "WOOD" | "VINYL";
export type StairRiserStyle = "WATERFALL" | "OPEN_RISER";

export interface StairRecord {
  // No action field: structural stair work is out of scope — flooring on stairs only — so every
  // StairRecord is treated as the replacement scenario the gap-check rule describes.
  flooringType: StairFlooringType;
  /** Carpet only. */
  riserStyle: StairRiserStyle | null;
  /** Carpet only. */
  skirtingCarpeted: boolean | null;
  /** Wood only. */
  risersFlooredAsWell: boolean | null;
  /** Wood only. Free text — no fixed material vocabulary given. */
  nosingMaterial: string | null;
  /** Vinyl only. */
  nosingPresent: boolean | null;
}

export type ContentsSize = "SMALL" | "MEDIUM" | "LARGE" | "EXTRA_LARGE";

/**
 * Whether/how a room's contents need to be moved out of the way for mitigation work — distinct
 * from the room's structural records (flooring, walls, etc.), which describe damage to the
 * building itself. `manipulationDeclined` and `affected` are always directly extracted (never
 * gap-checked); `size` is gap-checked unless `manipulationDeclined` is true, in which case
 * there's nothing further to ask.
 */
export interface ContentsManipulation {
  size: ContentsSize | null;
  manipulationDeclined: boolean;
  /** A flag only — noting contents were affected doesn't gate any other question or field. */
  affected: boolean;
}

/** Applies the one derived field the extraction step is not allowed to set itself. */
export function withDerivedFields(extraction: WaterLossExtraction): WaterLossExtraction {
  const year = extraction.loss.yearOfBuilding;
  const required = year != null && year <= 1990;
  if (extraction.loss.asbestosTestingRequired === required) return extraction;
  return { ...extraction, loss: { ...extraction.loss, asbestosTestingRequired: required } };
}

/**
 * Both documents from step 3 of the pipeline — see `documentGenerationPrompt.ts`. Ported from the
 * Android app's `model/waterloss/GeneratedDocuments.kt`, minus `inspectionReportPhotoIds` and
 * `workOrder` — photo attachments and the on-demand work order document are both out of scope for
 * Phase 1 (no PDF export, no photo capture; see the project brief).
 *
 * `inspectionReport` is optional as of the "scope document only" mode (see `claimInfo.ts`'s
 * `scopeOnly` field) — that mode's generation call never asks the model for one, and
 * `app/page.tsx`'s results step simply skips rendering the Inspection Report block when it's absent.
 */
export interface GeneratedDocuments {
  inspectionReport?: string;
  scopeDocument: string;
}

/** An empty tree — used to seed room-less starting state; not otherwise produced by extraction. */
export function emptyLoss(): Loss {
  return {
    category: null,
    lossClass: null,
    source: null,
    dateOfLoss: null,
    yearOfBuilding: null,
    asbestosTestingRequired: false,
    asbestosSamplesTaken: null,
    asbestosSampleCount: null,
    isBasementLoss: false,
    hvacInspectionRequired: null,
  };
}
