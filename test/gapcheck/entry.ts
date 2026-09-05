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
