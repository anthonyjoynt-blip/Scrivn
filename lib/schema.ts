/**
 * Hand-authored JSON Schemas passed as `output_config.format` on each Structured Outputs call, so
 * the API guarantees a response matching {@link WaterLossExtraction} (extraction) or the
 * two-document shape (generation) — rather than relying on a "please return JSON" instruction.
 *
 * Ported from the Android app's `service/scoping/WaterLossJsonSchemas.kt`, including its trimming
 * history — this is NOT the full domain model in `types.ts`; it is deliberately smaller. Two
 * separate Structured Outputs limits forced that, both discovered on the Android app and worth
 * preserving here verbatim rather than re-deriving:
 *
 * 1. Every field below is a single, non-union type — no `anyOf`, no `type` arrays. An earlier
 *    version modeled "optional" fields the usual JSON Schema way (`anyOf: [{...}, {type: "null"}]`),
 *    and Claude's Structured Outputs schema compiler caps union-typed fields at 16 per request
 *    ("too many parameters with union types... reduce the number of nullable or union-typed
 *    parameters"). So every "optional" field carries an explicit sentinel meaning "not stated"
 *    instead: -1 for numbers, "" for free-text strings, "UNKNOWN" appended to enum value lists,
 *    and a YES/NO/UNKNOWN string standing in for nullable booleans. The corresponding TypeScript
 *    domain types (`types.ts`) are still ordinary nullable types (`number | null`, `boolean | null`,
 *    `CarpetStyle | null`, ...) — `extractionWire.ts` is what translates between the two, so
 *    `gapCheck.ts`, the UI, and this schema never have to agree on what "unknown" looks like in
 *    more than one place.
 *
 * 2. Even after the sentinel fix, the *number of properties* still hit a separate, harder ceiling
 *    ("compiled grammar is too large") once the schema grew to ~100+ properties across 18 nested
 *    record types. Two rounds of category cuts followed — electrical panel and outlets/switches
 *    cut first, then stairs/wallTile/lightFixtures/plumbingFixtures/toeKicks — keeping whatever a
 *    PM/adjuster naturally narrates during a walkthrough (what something is, whether it's
 *    happening, what action) and dropping finish/spec detail that a human can confirm in a
 *    follow-up question anyway. The full record schemas for the cut categories still exist in
 *    `types.ts` and `gapCheck.ts` (dormant — extraction just never populates them, same as if the
 *    transcript never mentioned them); only this file and `extractionWire.ts` need to change to
 *    bring one back. If headroom is needed again, the real fix is splitting extraction into two
 *    smaller API calls rather than continuing to strip categories.
 */

type JsonSchema = Record<string, unknown>;

const UNKNOWN = "UNKNOWN";
/** Sentinel for "not stated" on numeric fields — every field using this is a real-world quantity that's always positive. */
const NOT_STATED = -1;

function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function str(): JsonSchema {
  return { type: "string" };
}
/** Free-text, optional — empty string on the wire means "not stated". */
function nullableStr(): JsonSchema {
  return { type: "string" };
}
function bool(): JsonSchema {
  return { type: "boolean" };
}
/** Nullable boolean, represented as a three-way enum since JSON boolean has no third state. */
function nullableBool(): JsonSchema {
  return { type: "string", enum: ["YES", "NO", UNKNOWN] };
}
function enumOf(...values: string[]): JsonSchema {
  return { type: "string", enum: values };
}
/** Nullable enum — UNKNOWN stands in for "not stated" so the field can stay a single, non-union type. */
function nullableEnumOf(...values: string[]): JsonSchema {
  return { type: "string", enum: [...values, UNKNOWN] };
}
/** Nullable numeric enum (category/class) — NOT_STATED stands in for "not stated". */
function nullableIntEnum(...values: number[]): JsonSchema {
  return { type: "integer", enum: [...values, NOT_STATED] };
}
/** Nullable integer — NOT_STATED means "not stated". */
function nullableInt(): JsonSchema {
  return { type: "integer" };
}
/** Nullable number — NOT_STATED (as a float) means "not stated". */
function nullableNumber(): JsonSchema {
  return { type: "number" };
}
function arr(items: JsonSchema): JsonSchema {
  return { type: "array", items };
}

const lossSchema = obj({
  category: nullableIntEnum(1, 2, 3),
  class: nullableIntEnum(1, 2, 3, 4),
  source: nullableStr(),
  dateOfLoss: nullableStr(),
  yearOfBuilding: nullableInt(),
  asbestosSamplesTaken: nullableBool(),
  asbestosSampleCount: nullableInt(),
  isBasementLoss: bool(),
  hvacInspectionRequired: nullableBool(),
});

const flooringRecordSchema = obj({
  /*
    Nullable, which it was not. A flooring record could not exist without a named material, so a
    transcript saying "flooring's coming up in all three" produced NO flooring record in any of the
    three rooms — the largest line item on the claim, gone, with nothing in the document looking
    wrong. Gap-check could not rescue it either: there was no record to ask about. UNKNOWN lets the
    record exist so the question can be asked.
  */
  type: nullableEnumOf("CARPET", "VINYL", "HARDWOOD", "LAMINATE", "TILE", "CONCRETE"),
  vinylSubtype: nullableEnumOf("SHEET", "PLANK"),
  disposition: nullableEnumOf("DRY_IN_PLACE", "LIFT_AND_REINSTALL", "REMOVE_AND_DISPOSE", "REMOVE_AND_ASSESS"),
  phase: nullableEnumOf("EMERGENCY", "REPAIR", "BOTH"),
  phaseUncertain: bool(),
  // Re-enabled (Phase 1 web review, round 4) — previously gap-check-only, so a PM who already
  // stated "lift carpet and remove pad" got asked about it again anyway.
  padPresent: nullableBool(),
  padRemoved: nullableBool(),
});

const baseboardRecordSchema = obj({
  heightIn: nullableNumber(),
  action: nullableEnumOf("DETACH_AND_RESET", "REMOVE_AND_REPLACE", "SHOE_MOLD_ONLY"),
  phase: nullableEnumOf("EMERGENCY", "REPAIR", "BOTH"),
  phaseUncertain: bool(),
});

const wallRecordSchema = obj({
  wallMaterial: enumOf("DRYWALL", "PLASTER", "PANELING"),
  drywallBeingRemoved: bool(),
  insulationAffected: nullableBool(),
  // Tried re-enabling cutHeight here (round 12, same reasoning as padPresent/padRemoved above —
  // previously gap-check only, so a PM who already said "remove drywall at 2 feet" got asked "how
  // high does the cut run" anyway) and it immediately hit the exact "compiled grammar is too large"
  // ceiling this file's doc comment warns about — extraction failed outright for every claim, not
  // just a cosmetic miss. Reverted; cutHeight stays gap-check-only for now. Per that doc comment,
  // real headroom for a field like this needs splitting extraction into two smaller API calls, not
  // another single-field add — not attempted here, a bigger change than this round's scope.
});

const equipmentRecordSchema = obj({
  type: str(),
  quantity: nullableInt(),
});

const detachOrReplace = enumOf("DETACH_AND_RESET", "REMOVE_AND_REPLACE");

const doorRecordSchema = obj({
  location: str(),
  action: detachOrReplace,
});

const cabinetryRecordSchema = obj({
  location: str(),
  action: detachOrReplace,
});

// toeKickRecordSchema deliberately not defined — cut in the round-2 schema-shrink, see the file
// doc comment above.

const countertopRecordSchema = obj({
  action: detachOrReplace,
  material: nullableEnumOf("LAMINATE", "QUARTZ", "GRANITE", "SOLID_SURFACE"),
});

// wallTileRecordSchema deliberately not defined — round 2, same treatment as toeKicks above.

const ceilingRecordSchema = obj({
  type: enumOf("DRYWALL_PLASTER", "SUSPENDED_TILE"),
  action: detachOrReplace,
  // finish/replaceSF re-enabled for extraction (round 6) — were gap-check-only, so a PM saying
  // "scrape and retexture" (clearly TEXTURE) or stating an exact SF got asked anyway.
  finish: nullableEnumOf("TEXTURE", "SMOOTH"),
  replaceSF: nullableInt(),
  // Tried adding aboveInsulationAffected here, after a direct report: a transcript saying
  // "insulation above is soaked, all of that's coming out too" still got gap-checked on whether the
  // insulation above the ceiling was affected, because the field is gap-check-only and there was
  // nowhere for the answer to land. It was picked as a nullable BOOL on the theory that the round-12
  // failure below was a four-value nullable enum and therefore several times larger.
  //
  // It made no difference: the API returned "The compiled grammar is too large" for every claim,
  // same as cutHeight did. That is now TWO data points saying this schema has no room for a single
  // additional field of any size, and confirms the file doc comment — the only way to capture
  // another field is splitting extraction into two smaller calls, not trimming or trading one here.
});

// outletRecordSchema, lightFixtureRecordSchema, electricalPanelRecordSchema, stairRecordSchema
// deliberately not defined — "outlets"/"electricalPanel" (round 1) and "lightFixtures"/"stairs"
// (round 2) stay dropped from roomSchema entirely. The record types and gap-check question logic
// for all of them still exist (types.ts, gapCheck.ts); they just never fire while extraction
// never populates them.

/**
 * Re-enabled (round 3, Phase 1 web review) but deliberately narrower than the full domain model —
 * only the two fixture types actually needed right now (bathroom vanity, toilet), not the original
 * five. Kitchen sink / standalone bathroom sink / tub-shower stay unextracted for now (same
 * "cut, not trimmed" treatment as everything else in this file) — their record schema, wire DTOs,
 * and gap-check question logic in types.ts/gapCheck.ts are all still there, ready to re-add here
 * if they're needed later. sinkAlsoNeeded/sinkFaucetSaved/grade/mount aren't part of this schema
 * either — see PlumbingFixtureRecord's doc comments for why (auto-included or dropped, not asked).
 */
const plumbingFixtureRecordSchema = obj({
  fixtureType: enumOf("BATHROOM_VANITY", "TOILET"),
  action: detachOrReplace,
  topDetached: nullableBool(),
  topKept: nullableBool(),
  topMaterial: nullableEnumOf("LAMINATE", "SOLID_SURFACE"),
});

const contentsRecordSchema = obj({
  manipulationDeclined: bool(),
  affected: bool(),
});

/** A nullable "single record" field — same UNKNOWN-sentinel idiom, but wrapped so the model can also emit "not present at all". */
function nullableSingle(schema: JsonSchema, presentFlagKey = "present"): JsonSchema {
  const properties = { ...(schema.properties as Record<string, JsonSchema>), [presentFlagKey]: bool() };
  return obj(properties);
}

const roomSchema = obj({
  roomName: str(),
  flooring: arr(flooringRecordSchema),
  baseboard: arr(baseboardRecordSchema),
  walls: arr(wallRecordSchema),
  doors: arr(doorRecordSchema),
  cabinetry: arr(cabinetryRecordSchema),
  countertops: arr(countertopRecordSchema),
  ceilings: arr(ceilingRecordSchema),
  plumbingFixtures: arr(plumbingFixtureRecordSchema),
  floorRegistersDetached: nullableInt(),
  equipment: arr(equipmentRecordSchema),
  contents: nullableSingle(contentsRecordSchema),
});

/** Schema for the extraction call — matches WaterLossExtraction (minus derived/bookkeeping fields). */
export const extractionSchema: JsonSchema = obj({
  loss: lossSchema,
  rooms: arr(roomSchema),
});

/*
  ── The detail pass ────────────────────────────────────────────────────────────────────────────

  A SECOND extraction call, with its own much smaller schema, carrying the spec fields that will not
  fit alongside the structure above. This is the split the file doc comment has recommended since
  round 2, and the thing that finally forced it: two separate attempts to add ONE field to the main
  schema (`cutHeight`, round 12; `aboveInsulationAffected`, this round) both returned "the compiled
  grammar is too large" and broke extraction outright. There is no room left for a field of any size.

  Why a second call works where trimming did not: the ceiling is on the compiled grammar of the
  schema in a single request, not on the transcript, the response, or the total across a claim. Two
  requests each carrying half the properties compile independently. Note this is also why splitting
  by ROOM would achieve nothing — the same schema for fewer rooms is the same grammar.

  The seam is "what is happening" (call 1) versus "what exactly is it" (call 2). Call 1 establishes
  the rooms and the records in them; this pass describes those records and adds nothing new, which is
  what lets it be a parallel array matched by position instead of repeating names and actions.

  Deliberately NOT duplicated here: anything call 1 already carries. `insulationAffected`, ceiling
  `finish`, baseboard `heightIn` and the rest stay in call 1 alone, so there is never a question of
  which answer wins.
*/

const flooringDetailSchema = obj({
  carpetStyle: nullableEnumOf("PILE", "BERBER", "RUBBER_BACKED_GLUE_DOWN"),
  // Reported: "Is the hardwood floating or glued down?" asked after the PM said "glued". These are
  // things somebody says while looking at a floor, so they belong in extraction, not in a question.
  // PREFINISHED is a third construction, not a finish on the other two; NAILED is the traditional
  // install method and was simply missing. OTHER pairs with the free-text field the question offers.
  hardwoodConstruction: nullableEnumOf("SOLID", "ENGINEERED", "PREFINISHED", "OTHER"),
  hardwoodInstallation: nullableEnumOf("FLOATING", "GLUED", "NAILED"),
  vinylInstallation: nullableEnumOf("GLUED", "SNAPLOCK_FLOATING"),
  /*
    How much floor is coming out, in SF, for any type — not just carpet.

    Reported: a transcript said "six by eight feet" of vinyl plank and the scope rendered "small
    area at the dishwasher". Flooring carried no removal quantity at all, so an exact figure the PM
    had stated had nowhere to go, and generation fell back to the qualitative extent it uses when
    nothing is known. Dimensions are multiplied out during extraction rather than stored as a pair,
    because every consumer of this wants area and none of them wants two numbers.
  */
  removalSF: nullableNumber(),
  /*
    The floor stays and gets cleaned. Nothing keyed off a removal disposition sees this case, so an
    unfinished basement's slab reached the scope described only as "dry in place" — which in this
    trade means saving material you would otherwise tear out, and nobody tears out a slab.
  */
  cleaningRequired: nullableBool(),
});

const doorDetailSchema = obj({
  doorType: nullableEnumOf("COLONIAL", "SOLID_CORE", "HOLLOW_CORE", "OTHER"),
  unitType: nullableEnumOf("PRE_HUNG", "SLAB_ONLY"),
});

const cabinetryDetailSchema = obj({
  extent: nullableEnumOf("UPPERS", "LOWERS", "FULL_HEIGHT"),
});

const baseboardDetailSchema = obj({
  material: nullableEnumOf("SOLID_WOOD", "MDF", "VINYL_PVC_COMPOSITE"),
  mdfProfile: nullableEnumOf("FLAT", "PROFILE"),
});

const wallDetailSchema = obj({
  cutHeight: nullableEnumOf("BASE", "TWO_FOOT", "FOUR_FOOT", "FULL_WALL"),
  insulationType: nullableEnumOf("FIBERGLASS_BATT", "BLOWN_IN", "CELLULOSE", "FOAM"),
});

const ceilingDetailSchema = obj({
  textureStyle: nullableEnumOf("POPCORN", "KNOCKDOWN"),
  aboveInsulationAffected: nullableBool(),
  aboveInsulationType: nullableEnumOf("FIBERGLASS_BATT", "BLOWN_IN", "CELLULOSE", "FOAM"),
});

const roomDetailSchema = obj({
  flooring: arr(flooringDetailSchema),
  baseboard: arr(baseboardDetailSchema),
  walls: arr(wallDetailSchema),
  ceilings: arr(ceilingDetailSchema),
  doors: arr(doorDetailSchema),
  cabinetry: arr(cabinetryDetailSchema),
  /*
    Room-level, not per-record: light fixtures were cut from extraction as a whole category, so there
    are no records to describe — but "are there light fixtures?" was still being asked of a PM who had
    just described one, while that same fixture appeared in the generated scope document. These two
    fields are the smallest thing that closes that gap without re-enabling the whole record type.
  */
  lightFixturesPresent: nullableBool(),
  lightFixtureCount: nullableInt(),
  /*
    Antimicrobial, per room. It lived only on DGIG's Emergency form, so a claim with any other
    insurer stating it produced an inspection report that said so and a scope that did not — the
    report is written with the transcript in hand, the scope's line rules see only the tree.
  */
  antimicrobialApplied: nullableBool(),
  // Poly barriers, priced per SF of barrier. Two fields for the same reason water extraction has
  // two: "mentioned but unmeasured" must be distinguishable from "never came up", or gap-check
  // cannot know to ask for the size.
  containmentRequired: nullableBool(),
  containmentSF: nullableNumber(),
  // Priced per SF of floor, which the room already has — so a boolean, not another quantity.
  hepaVacuumingRequired: nullableBool(),
  /*
    The one list this pass produces outright rather than annotating. Every other array here is
    positional against a call-1 record; appliances have no call-1 counterpart, so there is nothing to
    align to and `mergeDetail` appends the list as given. Safe only because nothing refers to these
    by index.
  */
  appliances: arr(obj({
    type: enumOf("WASHER", "DRYER", "FRIDGE", "RANGE", "DISHWASHER", "BUILT_IN_OVEN", "COOKTOP", "RANGE_HOOD", "BUILT_IN_MICROWAVE"),
  })),
});

/**
 * Schema for the detail pass. One entry per room, in the SAME order call 1 returned them, and
 * within each room one entry per record in the same order — see `extractionDetailPrompt.ts`, which
 * states the exact counts, and `mergeDetail`, which discards a room whose counts come back wrong
 * rather than attaching a cut height to the wrong wall.
 */
export const extractionDetailSchema: JsonSchema = obj({
  rooms: arr(roomDetailSchema),
});

/** Schema for the document-generation call — the two finished documents, nothing else. */
export const documentGenerationSchema: JsonSchema = obj({
  inspectionReport: str(),
  scopeDocument: str(),
});

/** Schema for a "scope document only" generation call (see claimInfo.ts's `scopeOnly`) — no inspectionReport property at all, so there's nothing for the model to fabricate for a report it was never given the fields to fill in. */
export const scopeOnlyGenerationSchema: JsonSchema = obj({
  scopeDocument: str(),
});
