/*
  Everything test/photos/run.mjs drives, in one bundle: the photo records and their rules, the claim
  around them, the sync that merges two phones' photos, the queue that uploads the pictures, and the
  email size check.
*/
export * from "@/lib/photos";
export { parseSavedClaimState, emptySavedClaimState, hasAnyContent, SAVED_CLAIM_KEYS } from "@/lib/claimState";
export { stateFingerprint, clashDifferences, onlyPhotosDiffer, withPhotosMerged, syncClaim, stableStringify } from "@/lib/claimSync";
export { changeDeviceClaim, readDeviceClaim, blankDeviceClaim } from "@/lib/deviceClaims";
export * from "@/lib/devicePhotos";
export { tooBigToEmail, EMAIL_LIMIT_BYTES, megabytes } from "@/lib/emailSize";
export { emptySketch } from "@/lib/sketch";
export { photoNotesFor, extractionRequest, generationRequest, withExtraction } from "@/lib/claimGeneration";
export { photoNotesSection, PHOTO_NOTES_RULE } from "@/lib/photoNotesPrompt";
export { extractionUserMessage } from "@/lib/extractionPrompt";
export { extractionDetailUserMessage } from "@/lib/extractionDetailPrompt";
export { extractionSupplementUserMessage } from "@/lib/extractionSupplement";
export { extractionUnscopedUserMessage } from "@/lib/extractionUnscoped";
export { documentGenerationUserMessage } from "@/lib/documentGenerationPrompt";
export { waitForSignal, runWaitingJobs, claimOnScreen } from "@/lib/aiJobs";
export { emptyLoss, withDerivedFields } from "@/lib/types";
export { exifTakenAt, parseExifDate } from "@/lib/exifTime";
