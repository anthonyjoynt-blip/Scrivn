/**
 * No gap-check question may ask what extraction could already have captured.
 *
 * The bug this exists to prevent, reported three separate times before anyone saw the pattern:
 *
 *   - "Is the hardwood floating or glued down?" — asked after the PM said "glued".
 *   - "Is insulation affected?" — asked after the PM said it was.
 *   - "Are there light fixtures?" — asked after a fixture was described, and while that same
 *     fixture appeared in the generated scope document.
 *
 * One cause. Gap-check reads ONLY the extraction tree; document generation is also given the
 * transcript. So a fact with no home in the tree is invisible to gap-check and visible to
 * generation — which is why the PM gets asked about something the finished document already
 * states. Every field below is therefore a decision: either extraction captures it, or a human
 * decided it is not worth a schema slot and being asked is correct.
 *
 * This file is that decision written down. Adding a question without listing its field here fails
 * the run, which is the point — the next instance should be a failing test, not a bug report.
 */

/**
 * Fields extraction can populate today. Call 1 is `extractionSchema`, call 2 is
 * `extractionDetailSchema` — see `lib/schema.ts`. A question gated on one of these is correct: the
 * gate only fires when extraction genuinely came back empty.
 */
export const EXTRACTABLE = new Set([
  // ── Call 1: structure ────────────────────────────────────────────────────────────────────────
  "loss:category", "loss:lossClass", "loss:source", "loss:dateOfLoss", "loss:yearOfBuilding",
  "loss:asbestosSamplesTaken", "loss:asbestosSampleCount", "loss:isBasementLoss",
  "loss:hvacInspectionRequired",
  "room:roomName", "room:floorRegistersDetached", "room:contents",
  "flooring:type", "flooring:vinylSubtype", "flooring:disposition", "flooring:phase",
  "flooring:phaseUncertain", "flooring:padPresent", "flooring:padRemoved",
  "baseboard:heightIn", "baseboard:action", "baseboard:phase", "baseboard:phaseUncertain",
  "wall:wallMaterial", "wall:drywallBeingRemoved", "wall:insulationAffected",
  "door:location", "door:action",
  "cabinetry:location", "cabinetry:action",
  "countertop:action", "countertop:material",
  "ceiling:type", "ceiling:action", "ceiling:finish", "ceiling:replaceSF",
  "plumbing:fixtureType", "plumbing:action", "plumbing:topDetached", "plumbing:topKept",
  "plumbing:topMaterial",
  "equipment:type", "equipment:quantity",

  // ── Call 2: spec detail ──────────────────────────────────────────────────────────────────────
  "flooring:carpetStyle",
  "flooring:hardwoodConstruction", "flooring:hardwoodInstallation", "flooring:vinylInstallation",
  // How much floor is coming out, any type. Stated dimensions ("six by eight feet") are multiplied
  // out during the detail pass; the question below only fires when nothing was stated at all.
  "flooring:removalSF",
  "door:doorType", "door:unitType",
  "cabinetry:extent",
  "ceilingLightFixtures:present", "ceilingLightFixtures:count",
  "baseboard:material", "baseboard:mdfProfile",
  "wall:cutHeight", "wall:insulationType",
  "ceiling:textureStyle", "ceiling:aboveInsulationAffected", "ceiling:aboveInsulationType",
]);

/**
 * Fields no extraction pass captures, each with the reason it is a question rather than a schema
 * slot. Every entry is a claim that a PM does NOT reliably state this on a walkthrough — if one
 * turns out to be stated routinely, the fix is to move it into the detail pass, not to widen this
 * list.
 *
 * The two schema ceilings behind these are real and documented: call 1 cannot take another field of
 * any size (`lib/schema.ts`), and whole categories were cut to get under the second one.
 */
export const DELIBERATELY_ASKED = new Map([
  // Quantities. A PM says "flood cut two feet up", rarely "thirty-one linear feet" — and where they
  // do, `parseAreaQuantity` takes it in the answer. The moisture map also pre-fills these.
  ["wall:cutRunFt", "a measured quantity, pre-filled from the moisture map where one exists"],
  ["wall:cutRunFraction", "the qualitative half of cutRunFt"],
  ["flooring:removalFraction", "the qualitative half of removalSF, which IS extracted"],
  ["flooring:carpetLiftSF", "a measured quantity, pre-filled from the moisture map"],
  ["flooring:carpetLiftFraction", "the qualitative half of carpetLiftSF"],
  ["flooring:padRemovedSF", "a measured quantity, pre-filled from the moisture map"],
  ["flooring:padRemovedFraction", "the qualitative half of padRemovedSF"],
  ["ceiling:replaceFraction", "the qualitative half of replaceSF, which IS extracted"],
  ["waterExtraction:sf", "a measured quantity, pre-filled from the moisture map"],
  ["waterExtraction:fraction", "the qualitative half of waterExtractionSF"],

  // R-values. Read off a label or a depth gauge on site, not something dictated on a walkthrough.
  ["wall:insulationRValue", "read off the batt label or a depth gauge, not dictated"],
  ["ceiling:aboveInsulationRValue", "read off the batt label or a depth gauge, not dictated"],

  // Decisions the PM makes later, not observations they make on site.
  ["cabinetry:grade", "a replacement-spec decision made when pricing, not observed on site"],
  ["door:saveHardware", "a decision about the rebuild, not an observation"],
  ["ceilingFixtures:inRemovalArea", "a judgement about the removal boundary, not stated"],
  ["room:otherCeilingFixtures", "free text, deliberately open-ended"],
  ["plumbing:sinkAlsoNeeded", "a rebuild decision"],
  ["plumbing:sinkFaucetSaved", "a rebuild decision"],
  ["plumbing:grade", "a replacement-spec decision made when pricing"],

  // Post-construction cleanup — describes the mess the repair makes, which nobody narrates while
  // describing damage. See `Room.windowCleaningAsked`.
  ["windowCleaning:present", "post-construction cleanup, never narrated as damage"],
  ["windowCleaning:counts", "post-construction cleanup, never narrated as damage"],

  // Gap-check bookkeeping — flags that exist to make the question fire exactly once.
  ["room:baseboardConfirmedAbsent", "bookkeeping, not a fact about the building"],
  ["room:equipmentAsked", "bookkeeping, not a fact about the building"],
  ["waterExtraction:required", "a general water-claim backstop; rarely narrated either way"],

  // Categories cut wholesale to get under the compiled-grammar ceiling. Each is a question today
  // because its whole record type is absent from extraction, not because the field is unknowable.
  ["outlet:detachScope", "outlets cut from extraction entirely (schema.ts round 1)"],
  ["outlet:voltage", "outlets cut from extraction entirely (schema.ts round 1)"],
  ["panel:requiresInspection", "electrical panel cut from extraction entirely (round 1)"],
  ["panel:amperage", "electrical panel cut from extraction entirely (round 1)"],
  ["panel:includeMeterWork", "electrical panel cut from extraction entirely (round 1)"],
  ["wallTile:surface", "wall tile cut from extraction entirely (round 2)"],
  ["wallTile:trimPresent", "wall tile cut from extraction entirely (round 2)"],
  ["wallTile:trimLinearFt", "wall tile cut from extraction entirely (round 2)"],
  ["toeKick:method", "toe kicks cut from extraction entirely (round 2)"],
  ["stairs:riserStyle", "stairs cut from extraction entirely (round 2)"],
  ["stairs:skirtingCarpeted", "stairs cut from extraction entirely (round 2)"],
  ["stairs:risersFlooredAsWell", "stairs cut from extraction entirely (round 2)"],
  ["stairs:nosingMaterial", "stairs cut from extraction entirely (round 2)"],
  ["stairs:nosingPresent", "stairs cut from extraction entirely (round 2)"],
  ["ceiling:detachScope", "suspended-tile detail; the type itself is extracted, this is not"],
  ["ceiling:tileSize", "suspended-tile detail, rarely stated"],
  ["ceiling:mountMethod", "suspended-tile detail, rarely stated"],
  ["plumbing:basinCount", "vanity detail beyond what the cut schema carries"],
  ["plumbing:mount", "vanity detail beyond what the cut schema carries"],
  ["plumbing:includesSurround", "tub/shower detail beyond what the cut schema carries"],
  ["plumbing:surroundMaterial", "tub/shower detail beyond what the cut schema carries"],

  // Bookkeeping flags that exist so a question fires exactly once, whichever way it is answered.
  // They are not facts about the building, so there is nothing for extraction to capture.
  ["equipment:used", "bookkeeping — makes the drying-equipment backstop fire once"],

  /*
    Light fixture TYPE is the one part of the trio still asked. Presence and count are extracted
    now, but a PM saying "a light fixture" almost never says whether it is recessed, a chandelier or
    a plain fixture — and that distinction changes the line item, so a guess would be worse than the
    question. If transcripts turn out to state it, move it into the detail pass alongside the others.
  */
  ["ceilingLightFixtures:type", "the kind of fixture is rarely named, and it changes the line item"],

  /*
    The consolidated equipment question. Its FIELD — equipment quantity — is extractable and listed
    above; this asks it once for every room at a time because the transcript stated a total for the
    job and never split it. So it fires precisely when extraction came back with equipment and no
    quantity, which is the honest gap, not a fact anybody skipped capturing.
  */
  ["equipment:allRooms", "one tally the PM stated for the job, distributed across rooms"],

  // Claim-level, collected at intake rather than dictated.
  ["claim:categoryEscalation", "a PM judgement prompted by elapsed time, never in the transcript"],
  /*
    How contents work is being scoped — a separate assignment, or line items inside Emergency and
    Repair. Extraction can see that contents ARE affected (it records that per room) but not how the
    company intends to bill them, which is a commercial decision made after the walkthrough.
  */
  ["claim:contentsAssignment", "how the contents work is scoped, decided after the walkthrough rather than during it"],
  ["contents:size", "an operational estimate, not a description of damage"],
]);

/**
 * Turns a question id into the `record:field` key the two tables above are written in.
 *
 * Ids are structured (`room:0:wall:1:cutHeight`), so the record type and field fall out of the
 * shape. Indices are stripped: which wall it is says nothing about whether the FIELD is extractable.
 */
export function fieldKeyFor(questionId) {
  const parts = questionId.split(":").filter((p) => !/^\d+$/.test(p));
  if (parts[0] === "room" && parts.length >= 3) return `${parts[1]}:${parts.slice(2).join(":")}`;
  if (parts[0] === "room" && parts.length === 2) return `room:${parts[1]}`;
  if (parts[0] === "claim") return `claim:${parts[1]}`;
  if (parts[0] === "asbestos") return `loss:asbestos${parts[1] === "taken" ? "SamplesTaken" : "SampleCount"}`;
  if (parts[0] === "loss") return `loss:${parts[1]}`;
  // The equipment type is free text (and contains spaces), so the decision is recorded against the
  // question rather than against every type a transcript might name.
  if (parts[0] === "equipment" && parts[1] === "allRooms") return "equipment:allRooms";
  return parts.join(":");
}
