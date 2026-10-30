export {
  evaluate,
  applyAnswer,
  isContentsSizeQuestion,
  isRepairOnlyQuestion,
  isEmergencyOnlyQuestion,
  isEquipmentPresenceQuestion,
  isWaterExtractionQuestion,
} from "@/lib/gapCheck";
export { withDerivedFields, totalWindowsToClean } from "@/lib/types";
export { emptyClaimInfo, claimInfoQuestions, isClaimInfoQuestion, applyClaimAnswer } from "@/lib/claimInfo";

export { nextQuestions, resolveRound } from "@/lib/questionRound";
export { canApplyToAllRooms, siblingQuestionIds } from "@/lib/questions";
export { equipmentNeedsConsolidating, consolidatedEquipmentId } from "@/lib/gapCheck";
export { recordRound, formatQuestionLog, hasQuestionLog } from "@/lib/questionLog";

/*
  A record with every field present, built through the REAL wire mapping.

  Fixtures in run.mjs are hand-written object literals, so a field added to a domain type is simply
  absent from them — and `undefined` is not `null`, so every question gated on `x === null` silently
  stops firing in the tests while still firing in production. That is how `flooring.removalSF` was
  added, asked in the app, and walked straight past the extractable-fields audit.

  Exporting the shape from TypeScript is what makes it self-maintaining: `flooringToDomain` returns a
  `FlooringRecord`, so the compiler rejects a missing field here, and run.mjs compares fixture keys
  against these at runtime.
*/
export { canonicalRecordShapes } from "@/lib/extractionWire";
export { claimStatus, resumeStep, contentsOutstanding, emptySavedClaimState, CLAIM_STATUS_ORDER, claimStatusLabel } from "@/lib/claimState";
export { isClaimIdentityComplete, WATER_NOT_APPLICABLE, waterScaleLabel, isWaterNotApplicable, buildScopeDocumentHeaderLines } from "@/lib/claimInfo";
export { contentsScopingNeeded, CONTENTS_TIMING_OPTIONS } from "@/lib/claimInfo";
export { sketchMeasureFor } from "@/lib/gapCheck";
// Answers kept across a second read of the walkthrough — see test/gapcheck/carryOver.mjs.
export { carryAnswers, carriedSuggestions } from "@/lib/answerCarryOver";
export { withExtraction } from "@/lib/claimGeneration";
// The moisture map's suggestions, built the way the claim page builds them, against the sketch's own plan.
export { equipmentSuggestionsFor } from "@/lib/claimGeneration";
export { equipmentSuggestionKey } from "@/lib/gapCheck";
export { claimEquipment, DEFAULT_EQUIPMENT_SETTINGS } from "@/lib/equipment";
export { sketchDryingPlan } from "@/lib/dryingPlanSketch";
// The round live and after a reload — see test/gapcheck/sameRound.mjs.
export { claimRound } from "@/lib/claimGeneration";
export { parseSavedClaimState } from "@/lib/claimState";
export { blankRoom } from "@/lib/extractionWire";
export { emptyMoistureMap, emptyRoomMoisture } from "@/lib/moisture";
export { PIXELS_PER_FOOT } from "@/lib/sketch";
