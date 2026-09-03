import type { ClaimInfo } from "./claimInfo";
import { applyClaimAnswer, claimInfoQuestions, isClaimInfoQuestion } from "./claimInfo";
import { isDGIG } from "./insurers";
import {
  type EquipmentSuggestions,
  applyAnswer,
  evaluate,
  isContentsSizeQuestion,
  isEmergencyOnlyQuestion,
  isEquipmentPresenceQuestion,
  isRepairOnlyQuestion,
  isWaterExtractionQuestion,
} from "./gapCheck";
import type { GapCheckQuestion } from "./questions";
import { type WaterLossExtraction, withDerivedFields } from "./types";

/**
 * One round of gap-check, as the claim page presents it.
 *
 * Split out of the page because it is pure and it is the part that has to be right: which questions
 * are open, and what the tree looks like once the answers on screen are folded in. Living in the
 * component meant `test/gapcheck/run.mjs` had to re-implement the claim-context filtering by hand to
 * test anything, and a hand copy of a filter is a copy that drifts.
 */

/**
 * Contents is being scoped in its own dedicated step whenever it's selected at all (see claimInfo.ts
 * — round 12 simplified this to a single `includes` check, now that Contents is an independent
 * multi-select flag rather than baked into fixed mode names) — asking the per-room "what size are
 * the contents" gap-check question here too is redundant and confusing (direct feedback, round 8: a
 * PM who'd said nothing about emergency/repair-side content manipulation got asked it anyway). A
 * pure Contents-only selection never reaches this function at all in practice (it skips the
 * transcript/extraction pipeline entirely), but the check costs nothing and keeps this correct if
 * that ever changes.
 */
function contentsScopedSeparately(claim: ClaimInfo): boolean {
  return claim.scopePhases.includes("CONTENTS");
}

/**
 * Every filter here follows the same split as isContentsSizeQuestion itself: evaluate() has no
 * claim-awareness on purpose, so this is the one place claim context and extraction-derived
 * questions meet.
 */
export function nextQuestions(
  claim: ClaimInfo,
  extraction: WaterLossExtraction,
  suggestions?: EquipmentSuggestions,
): GapCheckQuestion[] {
  let questions = [...claimInfoQuestions(claim, extraction), ...evaluate(extraction, suggestions).questions];
  if (contentsScopedSeparately(claim) || isDGIG(claim.insurer)) questions = questions.filter((q) => !isContentsSizeQuestion(q.id));
  // Repair/Emergency-only gap-check questions (round 12): "I ran a test selecting Emergency only
  // and still got gap checked on baseboard sizes and such, if its emergency only we shouldnt get
  // checked on that." Whichever phase isn't selected, drop every question that only ever feeds that
  // phase's own rendering — see isRepairOnlyQuestion/isEmergencyOnlyQuestion for exactly which.
  if (!claim.scopePhases.includes("REPAIR")) questions = questions.filter((q) => !isRepairOnlyQuestion(q.id));
  if (!claim.scopePhases.includes("EMERGENCY")) questions = questions.filter((q) => !isEmergencyOnlyQuestion(q.id));
  // The "was drying equipment used" / "was water extraction required" prompts only make sense for a water claim.
  if (claim.lossType !== "WATER") questions = questions.filter((q) => !isEquipmentPresenceQuestion(q.id) && !isWaterExtractionQuestion(q.id));
  return questions;
}

/** How many times `resolveRound` will re-ask the engine before giving up. */
const MAX_RESOLVE_PASSES = 24;

export interface ResolvedRound {
  claim: ClaimInfo;
  extraction: WaterLossExtraction;
  /** Still open — nothing here has an answer yet. Empty means the gap-check is complete. */
  questions: GapCheckQuestion[];
  /** The questions whose answers were actually folded into `extraction`, in the order applied. */
  applied: GapCheckQuestion[];
  /**
   * What to put on screen: everything asked while resolving, answered or not, in the order the
   * engine first produced it.
   *
   * NOT the same as `questions`, and this is the difference that matters. Once an answer is folded
   * into the draft, the engine stops asking — so rendering `questions` alone made a question
   * DISAPPEAR the instant it was answered, taking the answer off screen with it. The PM could not
   * re-read what they had said, let alone change it, and a mis-tap was unrecoverable without
   * starting the claim again.
   *
   * Order is first-seen rather than open-then-answered, so a question stays put as it is answered
   * instead of jumping around the form, and a follow-up appears directly after whatever revealed it.
   */
  display: GapCheckQuestion[];
}

/**
 * Folds the answers on screen into a draft tree, and returns both it and the questions still open.
 *
 * The engine only ever describes the tree in front of it, so a dependent question cannot exist until
 * its trigger has actually been recorded. Re-running it against a draft is what lets a follow-up
 * appear the instant its answer is given instead of one submit later — say there are two windows and
 * the size tally belongs on that screen, not after a press of Continue.
 *
 * An answer is applied ONLY to a question the engine asked on some pass. That matters when an answer
 * is changed: flip "are there windows" from yes to no and the tally question stops being generated,
 * so the counts typed against it are never folded in — no stale number reaches the tree, and they
 * are still there if the PM flips back. Applying the whole answer map blindly would record work the
 * PM had just retracted.
 *
 * Terminates because each pass either applies an answer that has never been applied (a finite set)
 * or stops. The cap is belt-and-braces against a handler that fails to record what it was given —
 * `test/gapcheck/run.mjs` is what actually proves no such handler exists.
 */
export function resolveRound(
  claim: ClaimInfo,
  extraction: WaterLossExtraction,
  answers: Record<string, string>,
  suggestions?: EquipmentSuggestions,
): ResolvedRound {
  let draftClaim = claim;
  let draft = withDerivedFields(extraction);
  const applied: GapCheckQuestion[] = [];
  const seen = new Set<string>();
  /*
    Every question the engine produced while resolving, newest version of each, in first-seen order.
    A later pass can hand back the same id with a different `defaultValue` (a measured figure that
    only became derivable once something else was answered), so the value is overwritten while the
    position is kept.
  */
  const display = new Map<string, GapCheckQuestion>();
  let questions = nextQuestions(draftClaim, draft, suggestions);

  for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass += 1) {
    for (const q of questions) display.set(q.id, q);
    let progressed = false;
    for (const q of questions) {
      if (seen.has(q.id)) continue;
      // A pre-filled question left untouched is confirmed, not skipped — see `defaultValue`.
      const answer = answers[q.id] ?? q.defaultValue;
      if (answer === undefined) continue;
      seen.add(q.id);
      applied.push(q);
      if (isClaimInfoQuestion(q.id)) {
        const result = applyClaimAnswer(draftClaim, draft, q.id, answer);
        draftClaim = result.claim;
        draft = result.extraction;
      } else {
        draft = applyAnswer(draft, q.id, answer);
      }
      progressed = true;
    }
    if (!progressed) break;
    draft = withDerivedFields(draft);
    questions = nextQuestions(draftClaim, draft, suggestions);
  }
  for (const q of questions) display.set(q.id, q);

  return { claim: draftClaim, extraction: draft, questions, applied, display: [...display.values()] };
}
