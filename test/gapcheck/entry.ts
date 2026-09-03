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
