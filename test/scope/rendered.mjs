/**
 * No fact the tree holds may be silently dropped from the scope.
 *
 * Three separate reports, one shape:
 *
 *   - Drying equipment placed in each room — right in the inspection report, absent from the scope.
 *   - Antimicrobial applied "throughout both spaces" — right in the report, absent from the scope.
 *   - A concrete floor to be "cleaned and treated" — right in the report, absent from the scope.
 *
 * One cause, and it is the mirror image of the gap-check bug `extractable.mjs` guards. Document
 * generation gets BOTH the extraction tree and the transcript. The inspection report is narrative
 * and written from the transcript, so it states whatever the PM said. The scope's line items are
 * built only from the rules in `documentGenerationPrompt.ts`, which see only the tree. So a fact
 * with a home in the tree but NO RULE naming it reads as correct in one document and vanishes from
 * the other — and the two documents disagreeing is precisely what makes it hard to notice, because
 * the report looks right.
 *
 * Every field below is therefore a decision: either a rule renders it, or somebody wrote down why
 * nothing needs to. A field appearing in neither list fails the run.
 *
 * What this CANNOT check: a fact with no field at all. Antimicrobial was invisible here until it had
 * somewhere to live, and air scrubbers, containment, HEPA vacuuming and deodorisation are invisible
 * today for the same reason — extraction has no field for any of them, so this file cannot see them
 * either. That gap belongs to `extractable.mjs`'s side of the pipeline, and is recorded in NOT_MODELLED
 * below so the list of known holes lives somewhere rather than in a chat log.
 */

/** Facts the tree carries that a scope line must render. The value is where the rule lives. */
export const RENDERED = new Map([
  ["Room.equipment", "rule 13 — Place {quantity} {type}; added after the first report of this bug"],
  ["Room.antimicrobialApplied", "rule 14 — Antimicrobial application, per room"],
  ["Room.containmentRequired", "rule 15 — Containment – poly barrier"],
  ["Room.containmentSF", "rule 15 — its SF of BARRIER, never the room's floor area"],
  ["Room.hepaVacuumingRequired", "rule 16 — HEPA vacuuming, priced per SF of floor"],
  ["Room.appliances", "rule 17 — the Detach/Reset pair, per appliance"],
  ["FlooringRecord.cleaningRequired", "rule 1c — Clean & treat {type} floor"],
  ["FlooringRecord.removalSF", "rule 1b — the removal extent, every flooring type"],
  ["FlooringRecord.removalFraction", "rule 1b — the qualitative half of removalSF"],
  ["FlooringRecord.disposition", "the per-record action bullet; see rule 1d for the concrete exception"],
  ["FlooringRecord.carpetLiftSF", "rule 2 — carpet lift and pad removal"],
  ["FlooringRecord.padRemovedSF", "rule 2"],
  ["Room.floorRegistersDetached", "rule 3 — Detach & reset floor registers, both phases"],
  ["Room.waterExtractionRequired", "rule 1a/1b — Extract water"],
  ["Room.waterExtractionSF", "rule 1b — its quantity"],
  ["Room.windowCleaningCounts", "one Repair bullet per size band"],
  ["Room.contents", "Manipulate / Reset contents"],
  ["BaseboardRecord.action", "the detach/reset and remove/replace pairs"],
  ["WallRecord.drywallBeingRemoved", "the drywall removal bullet and its cut height"],
  ["WallRecord.insulationAffected", "Remove affected insulation"],
  ["CeilingRecord.action", "the ceiling bullet plus priming and painting"],
  ["CeilingRecord.aboveInsulationAffected", "rule 12 — Remove wet insulation above ceiling"],
  ["Room.ceilingLightFixturesPresent", "the light-fixture detach/reset pair"],
  ["Room.otherCeilingFixtures", "rule 11 — the PM's own words, verbatim"],
  ["Loss.hvacInspectionRequired", "rule 4 — Furnace/hot water tank inspection"],
  ["Loss.asbestosSamplesTaken", "the General asbestos sample-collection line"],
  ["Loss.asbestosSampleCount", "its {N} samples"],
]);

/**
 * Facts a scope line deliberately does NOT render, each with the reason.
 *
 * Mostly two kinds: spec detail that reaches the page through the generic "{material detail}" slot
 * rather than a rule of its own (the model is handed the whole tree, so a carpet's berber style or a
 * vinyl's plank subtype lands in the bullet without being named), and bookkeeping that describes the
 * questioning rather than the building.
 */
export const NOT_RENDERED = new Map([
  ["spec-detail", "carpetStyle, vinylSubtype, hardwoodConstruction, doorType, mdfProfile and the rest reach the bullet through the generic {material detail} slot, not a rule of their own"],
  ["bookkeeping", "baseboardConfirmedAbsent, windowCleaningAsked, equipmentAsked and phaseUncertain describe the questioning, not the building"],
  ["r-values", "insulationRValue and aboveInsulationRValue are a spec on an insulation line that already renders"],
]);

/**
 * Known holes: real work a PM states that has NO field anywhere, so it cannot reach either document
 * as a scope line. Listed so they are tracked rather than rediscovered one bug report at a time.
 *
 * Each was confirmed dropped by a live extraction call, not assumed.
 */
export const NOT_MODELLED = new Map([
  /*
    Emptied once the five holes below were closed. Kept as a list rather than deleted, because the
    next one is found the same way — a transcript states something, the report says it, the scope
    does not — and having somewhere to write it down is the point.

    Closed: air scrubbers (now a third equipment type, negative air recorded as the same unit),
    containment (per SF of barrier), HEPA vacuuming (per SF of floor, reusing the room's own area),
    appliance detach & reset (nine types, detach-and-reset only — restoration does not replace them),
    and deodorisation, which on a WATER loss is another way of saying antimicrobial and so needed no
    field at all. Deodorisation on a FIRE or trauma job genuinely is a different thing, and this
    schema does not cover those.
  */
]);
