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
    Every question the engine produced while resolving, in the engine's own order — see
    `spliceInGenerationOrder` for why that is not simply the order they were first seen.
  */
  let display: GapCheckQuestion[] = [];
  let questions = nextQuestions(draftClaim, draft, suggestions);

  for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass += 1) {
    display = spliceInGenerationOrder(display, questions);
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
  display = spliceInGenerationOrder(display, questions);

  return { claim: draftClaim, extraction: draft, questions, applied, display };
}

/**
 * Merges one pass's questions into the display list, keeping the ENGINE's ordering rather than the
 * order things happened to be revealed in.
 *
 * The difference is the whole point. A question revealed by an answer — "popcorn or knockdown?",
 * which only exists once the ceiling is known to be textured — is generated on a later pass than the
 * question that revealed it. Appending it put it at the bottom of the form, several rooms away from
 * the ceiling question it belongs to, so it read as a stray unrelated question rather than the
 * immediate follow-up it is.
 *
 * A new question is placed immediately BEFORE the next question in its own pass that already has a
 * position. That is what puts the texture style directly after the finish question: in the pass that
 * generates it, its neighbour is the ceiling's insulation question, which is already placed — and the
 * finish question sits just above that, exactly where it was answered.
 *
 * That anchor alone is not stable, which was a reported bug: a pass only ever contains questions
 * still OPEN, so answering the question directly below a follow-up removed the very neighbour the
 * follow-up was anchored to, and it was re-placed further down — "how much extraction" jumping below
 * whatever was answered next. Every keystroke rebuilds this list from scratch, so the anchor has to
 * be something answering cannot take away.
 *
 * So a second anchor is taken from the question's own id, which is a structured address: everything
 * before the final segment names the RECORD it belongs to, and questions about one record belong
 * together. `room:0:waterExtraction:sf` therefore anchors to `room:0:waterExtraction:required`,
 * which stays in the display list once answered and cannot vanish.
 *
 * The earlier of the two positions wins, so this can only ever pull a follow-up CLOSER to what it
 * belongs with, never push it away — which is why adding it cannot disturb an ordering that was
 * already right.
 *
 * Existing entries are replaced with the newer object, since a later pass can hand back the same id
 * carrying a `defaultValue` that only became derivable once something else was answered.
 */
function spliceInGenerationOrder(display: GapCheckQuestion[], pass: GapCheckQuestion[]): GapCheckQuestion[] {
  const result = display.map((existing) => pass.find((q) => q.id === existing.id) ?? existing);
  const positionOf = (id: string) => result.findIndex((q) => q.id === id);

  for (let i = 0; i < pass.length; i += 1) {
    const q = pass[i]!;
    if (positionOf(q.id) !== -1) continue;

    // Where the next already-placed neighbour sits; the end of the list when there is no such
    // neighbour, which is the correct home for a question generated after everything else.
    let at = result.length;
    for (let j = i + 1; j < pass.length; j += 1) {
      const neighbour = positionOf(pass[j]!.id);
      if (neighbour !== -1) {
        at = neighbour;
        break;
      }
    }

    // And where its own record says it goes: directly after the last question already placed for
    // that same record.
    const prefix = recordPrefix(q.id);
    if (prefix !== null) {
      let lastOfRecord = -1;
      for (let k = 0; k < result.length; k += 1) {
        if (recordPrefix(result[k]!.id) === prefix) lastOfRecord = k;
      }
      if (lastOfRecord !== -1) at = Math.min(at, lastOfRecord + 1);
    }

    result.splice(at, 0, q);
  }
  return result;
}

/**
 * The record an id belongs to — everything before the final segment.
 *
 * Null for anything shallower than `room:N:something:field`, which is the point: a room-level id like
 * `room:0:floorRegistersDetached` would otherwise reduce to `room:0` and group every room-level
 * question in the room together, anchoring a new one after whichever came first rather than where it
 * belongs. Only ids specific enough to name a real record are worth grouping by.
 */
function recordPrefix(id: string): string | null {
  const parts = id.split(":");
  return parts.length >= 4 ? parts.slice(0, -1).join(":") : null;
}
