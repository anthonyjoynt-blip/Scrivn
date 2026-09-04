/**
 * What the pipeline harness needs from the app, bundled by esbuild so the script runs the REAL
 * gap-check engine rather than a copy of it. Same arrangement as the other suites' entry files.
 */
export { resolveRound, nextQuestions } from "@/lib/questionRound";
export { emptyClaimInfo, isClaimInfoQuestion } from "@/lib/claimInfo";
export { withDerivedFields } from "@/lib/types";
export { recordRound } from "@/lib/questionLog";
export { parseBucketCounts, formatBucketCounts } from "@/lib/questions";
