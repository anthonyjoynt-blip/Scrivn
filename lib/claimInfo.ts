import type { Room, WaterLossExtraction } from "./types";
import { withDerivedFields } from "./types";
import type { GapCheckQuestion } from "./questions";

/**
 * The claim-identity + report-level fields the document-generation prompt needs that don't live
 * inside `WaterLossExtraction` — see `documentGenerationPrompt.ts`'s `userMessage`.
 *
 * Round 5 moved customerName/jobNumber/claimNumber/address/insurer/pmName to a dedicated intake
 * form (`components/ClaimIntakeForm.tsx`, step 1) instead of gap-checking them. Round 6 extended
 * that to every remaining field here — waterCategory/waterClass/dateOfLoss/yearOfBuilding/
 * causeOfLoss/preExistingConditions/dateTimeInspected — per direct feedback that being asked for
 * this after already dictating the whole scope felt backwards: "the more natural way to fill this
 * in is client name and address, claim number etc at the beginning." So this file's gap-check
 * (`claimInfoQuestions` below) is now permanently empty — every field here is collected up front.
 * It's kept rather than deleted, same as every other "dormant but ready" piece of this codebase
 * (see schema.ts's cut categories): if a field ever needs to move back to a post-extraction
 * question, the "claim:"-prefixed id convention and the routing in `app/page.tsx` are already
 * there waiting for it.
 *
 * `yearOfBuilding` is the one field that also has to live on `WaterLossExtraction.loss` (it drives
 * `asbestosTestingRequired` — see `withDerivedFields` in types.ts), so intake's answer has to be
 * copied over after extraction runs — see `applyClaimYearOfBuilding` below. Every other field here
 * only ever lived on `ClaimInfo`, extraction never touches it.
 *
 * `hasSketch` isn't modeled at all — Create Sketch is a mocked/demo feature even in the Android
 * app today ("effectively always false"), and Phase 1 web has no sketch feature, so the inspection
 * report's SKETCH section is simply never generated (see `documentGenerationPrompt.ts`).
 *
 * `pmPhone`/`pmEmail` are deliberately NOT here — the plan (per the round-6 discussion) is to pull
 * those from a user profile once accounts/login exist, or let a stand-in filler override them;
 * neither exists yet in this Phase 1 prototype, so the inspection report still leaves PM Phone
 * blank rather than half-building a profile system for it now.
 *
 * `scopeOnly` and `scopePhases` (added later) are the two intake questions that control *which*
 * document(s) get generated and how the scope document's phases are structured — see their own
 * doc comments below for what each controls.
 *
 * `lossType` (round 10) is asked first, ahead of category/class — this app's extraction, gap-check,
 * and generation prompts are still entirely water-loss-specific (nothing here changes for a FIRE/
 * WIND/HAIL/REMEDIATION claim beyond this one field and the category/class relaxation below), but
 * per direct feedback the type-of-loss question itself, and the ability to skip category/class for
 * a non-water claim, were wanted now rather than waiting on full multi-loss-type support.
 */
export interface ClaimInfo {
  // ---- Collected up front, step 1 (ClaimIntakeForm) — never gap-checked, always filled in (or
  // deliberately left blank for the optional ones) by the time extraction runs.
  customerName: string;
  jobNumber: string;
  /** Distinct from jobNumber — the insurer's claim number. Optional at intake. */
  claimNumber: string;
  address: string;
  insurer: string;
  pmName: string;
  lossType: LossType | null;
  /**
   * What "Other" actually is, in the PM's own words. Empty for every other loss type.
   *
   * A catch-all that only ever renders as the word "Other" tells a reader nothing — the whole point
   * of choosing it is that the loss is something the five named types do not cover, so the document
   * has to carry what it was. See `lossTypeLabel`.
   */
  lossTypeOther: string;
  /**
   * IICRC water category/class — required whenever lossType is WATER, and not collected at all
   * (stay null) for any other lossType. See `isClaimIdentityComplete` for the exact gating and
   * `documentGenerationPrompt.ts`'s scope-document header notes for how a null pair renders.
   */
  /**
   * IICRC category, or {@link WATER_NOT_APPLICABLE} when the PM has said it does not apply.
   *
   * null means NOT YET ANSWERED, and the two are genuinely different. They used to share `null`,
   * which meant the "N/A" button appeared pre-selected on a blank form and pressing it left Continue
   * disabled — the claim could not be started at all. A category that does not apply is an answer;
   * one nobody has given is a gap.
   */
  waterCategory: number | null;
  /**
   * Why the category is what it is, when it was not simply stated — currently set only by the
   * elapsed-time escalation in `claimInfoQuestions`.
   *
   * A category that changed needs its reason travelling with it. An adjuster reading Category 3 on a
   * clean-water loss will ask why, and "the PM confirmed it after N days had passed" is the answer;
   * without somewhere to put it, the escalation would arrive on the document unexplained.
   */
  waterCategoryNote: string | null;
  /**
   * How contents work is being handled, once a PM has been asked.
   *
   * Only ever set by answering the gap-check question below. `null` means the question has not
   * arisen — either no contents were described, or Contents was already selected at intake and there
   * is nothing to decide.
   *
   *   SEPARATE  — a contents assignment of its own, still to be scoped. The claim carries on through
   *               Emergency and Repair meanwhile, and shows as "Contents pending" in the claims list
   *               until that scope is actually filled in.
   *   IN_SCOPE  — the contents work sits inside the Emergency/Repair scope as ordinary line items.
   *               Nothing is owed and nothing is pending.
   */
  contentsAssignment: ContentsAssignment | null;
  /**
   * Whether the contents scope is being done in this sitting or left for later.
   *
   * Only asked once the contents scoping tool is known to be NEEDED — see `contentsScopingNeeded`.
   * "NOW" routes the PM into the contents step after the emergency and repair gap-checks are
   * finished, so the whole claim is done in one pass; "LATER" leaves the claim owing a contents
   * scope, which is what the claims list shows as "Contents pending".
   */
  contentsScopeTiming: ContentsScopeTiming | null;
  /** IICRC class, or {@link WATER_NOT_APPLICABLE}. Same distinction as `waterCategory`. */
  waterClass: number | null;
  /** ISO-8601 date string (yyyy-MM-dd). */
  dateOfLoss: string | null;
  yearOfBuilding: number | null;
  causeOfLoss: string;
  preExistingConditions: string;
  /** Free text (e.g. "8/26/2026 2:00 PM") — optional at intake, same reasoning as claimNumber. */
  dateTimeInspected: string;
  /**
   * When true, this claim generates a scope document only — no inspection report, and none of the
   * inspection-report-only intake fields (address/PM/date of loss/year built/cause of
   * loss/pre-existing conditions/date-time inspected) are required or shown. See
   * `isClaimIdentityComplete` and `ClaimIntakeForm.tsx` for the field-set this trims, and
   * `documentGenerationPrompt.ts`/`schema.ts`'s "scope only" exports for the generation side.
   */
  scopeOnly: boolean;
  /**
   * Which phase(s) of the scope document to generate — always asked, independent of `scopeOnly`,
   * since it's purely a scope-document concern (the inspection report has no phase structure at
   * all). A claim can select any non-empty combination of the three — see `ScopePhase`'s doc
   * comment for what each one does and how they interact.
   */
  scopePhases: ScopePhase[];
}

/**
 * The three independently-selectable phases of the scope document (round 7, generalized to a free
 * multi-select round 12 — per direct feedback: "have emergency, repair, contents there and the user
 * can select one or multiple so they arent constrained if they need a repair and a contents"). A
 * claim can select any non-empty subset — see documentGenerationPrompt.ts's SCOPE_PHASE_RULES for
 * exactly how each combination renders. A few combinations are worth calling out:
 * - EMERGENCY + REPAIR (no CONTENTS) is what this app has always produced by default: an Emergency
 *   section and a Repair section, phases derived per-record the way documentGenerationPrompt.ts's
 *   EMERGENCY_DERIVATION_RULES already describes.
 * - REPAIR selected without EMERGENCY combines what would have been separate Emergency
 *   "detach/remove" and Repair "reset/replace" bullets into one line describing the whole job — see
 *   SCOPE_PHASE_RULES.
 * - CONTENTS alone (EMERGENCY and REPAIR both unselected — see `isContentsOnly`) is a pure contents
 *   assignment, no structural scope at all. This combination skips the transcript/extraction/
 *   gap-check pipeline entirely (see `usesReducedIntake` and `app/page.tsx`'s intake-continue
 *   handler) — there's no room/damage data to gather — and never calls Claude:
 *   `lib/contentsTM.ts`'s `buildContentsOnlyScopeDocument` builds the whole document client-side
 *   from the claim fields plus the Time & Material (or bric-a-brac) contents form.
 * - CONTENTS selected ALONGSIDE Emergency and/or Repair (see `hasSeparateContents`) adds a separate
 *   Contents section, appended client-side after Claude returns the structural scope document (see
 *   `app/page.tsx`'s `handleGenerateDocuments`). Per direct feedback, contents is NOT phase-split
 *   (no Emergency/Repair nesting) — it's its own top-level heading with activity-based subheadings
 *   (Pack Out, Pack Back, Equipment, ...), and the "Manipulate contents"/"Reset contents" auto-
 *   include is suppressed from Emergency/Repair in that case (see documentGenerationPrompt.ts's
 *   contents auto-include rule) since content handling now lives in its own section instead.
 */
export type ScopePhase = "EMERGENCY" | "REPAIR" | "CONTENTS" | "REMEDIATION";

export const SCOPE_PHASE_OPTIONS: { value: ScopePhase; label: string }[] = [
  { value: "EMERGENCY", label: "Emergency" },
  { value: "REPAIR", label: "Repair" },
  { value: "CONTENTS", label: "Contents" },
  { value: "REMEDIATION", label: "Remediation" },
];

/**
 * The phases actually offered for a claim.
 *
 * Remediation appears only on a Remediation loss — an abatement scope on a hail claim is not a
 * thing, and a phase nobody can use is a phase that reads as broken. Every other loss type sees the
 * three it always saw.
 */
export function availableScopePhases(claim: ClaimInfo): { value: ScopePhase; label: string }[] {
  return SCOPE_PHASE_OPTIONS.filter((o) => o.value !== "REMEDIATION" || claim.lossType === "REMEDIATION");
}

/** True when Contents is selected with neither Emergency nor Repair — a pure contents assignment, no structural scope to dictate/extract at all. See `ScopePhase`'s doc comment. */
export function isContentsOnly(claim: ClaimInfo): boolean {
  return claim.scopePhases.length === 1 && claim.scopePhases[0] === "CONTENTS";
}

/**
 * True when Remediation is the only phase — an abatement assignment on its own.
 *
 * The same shape as `isContentsOnly` and for the same reason: there is no structural damage to
 * dictate, so the transcript, the extraction and the gap check all have nothing to work on. The
 * scope comes out of the abatement form, client-side, with no Claude call anywhere in the path.
 */
export function isRemediationOnly(claim: ClaimInfo): boolean {
  return claim.scopePhases.length === 1 && claim.scopePhases[0] === "REMEDIATION";
}

/** True when an abatement scope is wanted at all, on its own or beside structural work. */
export function hasRemediation(claim: ClaimInfo): boolean {
  return claim.scopePhases.includes("REMEDIATION");
}

/**
 * True when nothing that needs dictating is selected — Contents and/or Remediation only.
 *
 * Both skip the transcript pipeline, so the question the router actually needs to ask is "is there
 * anything here to dictate?", not "which of these two is it?". Written as its own predicate so
 * adding a third such phase later means adding it here rather than finding every `||`.
 */
export function skipsTranscriptPipeline(claim: ClaimInfo): boolean {
  return claim.scopePhases.length > 0 && !hasStructuralScope(claim);
}

/** True when there's any structural scope to generate (Emergency and/or Repair selected) — gates whether the transcript/extraction/gap-check pipeline runs at all. */
export function hasStructuralScope(claim: ClaimInfo): boolean {
  return claim.scopePhases.includes("EMERGENCY") || claim.scopePhases.includes("REPAIR");
}

/** True when Contents is selected alongside structural scope — the separate Contents section gets appended, and the Manipulate/Reset contents auto-include is suppressed from Emergency/Repair (see documentGenerationPrompt.ts's SCOPE_PHASE_RULES). */
export function hasSeparateContents(claim: ClaimInfo): boolean {
  return claim.scopePhases.includes("CONTENTS") && hasStructuralScope(claim);
}

/** See `ClaimInfo.lossType`'s doc comment — only WATER has any effect on the rest of the pipeline today. */
export type LossType = "WATER" | "FIRE" | "WIND" | "HAIL" | "REMEDIATION" | "OTHER";

export const LOSS_TYPE_OPTIONS: { value: LossType; label: string }[] = [
  { value: "WATER", label: "Water" },
  { value: "FIRE", label: "Fire" },
  { value: "WIND", label: "Wind" },
  { value: "HAIL", label: "Hail" },
  { value: "REMEDIATION", label: "Remediation" },
  // Last on purpose: a catch-all belongs after the named types, not competing with them.
  { value: "OTHER", label: "Other" },
];

/**
 * Whether this claim uses the reduced "scope only" intake field set (see `isClaimIdentityComplete`
 * and `ClaimIntakeForm.tsx`) — either because `scopeOnly` is checked, or because Contents is the
 * only phase selected (see `isContentsOnly`), which has no structural scope at all and so nothing
 * to put an inspection report's address/PM/date-of-loss/cause-of-loss narrative around.
 */
export function usesReducedIntake(claim: ClaimInfo): boolean {
  return claim.scopeOnly || skipsTranscriptPipeline(claim);
}

/**
 * "Does not apply", as distinct from "not answered yet".
 *
 * Zero because it is a number — so nothing about `ClaimInfo`'s shape or the wire format changes —
 * and because the IICRC scales start at 1, so it can never collide with a real category or class.
 * Every read of these two fields has to decide between three states now, not two, which is why they
 * go through the helpers below rather than being compared to numbers inline.
 */
/** See `ClaimInfo.contentsAssignment`. */
export type ContentsAssignment = "SEPARATE" | "IN_SCOPE";

/** See `ClaimInfo.contentsScopeTiming`. */
export type ContentsScopeTiming = "NOW" | "LATER";

export const CONTENTS_TIMING_OPTIONS = ["Scope the contents now", "Leave it for later"];

export const CONTENTS_ASSIGNMENT_OPTIONS = [
  "Separate contents assignment",
  "Within the Emergency/Repair scope",
];

export const WATER_NOT_APPLICABLE = 0;

/** True when the PM explicitly said the scale does not apply. */
export function isWaterNotApplicable(value: number | null): boolean {
  return value === WATER_NOT_APPLICABLE;
}

/**
 * How a category or class reads on a document: the number, "N/A", or blank when nobody has said.
 *
 * A blank is deliberately not "N/A". An unanswered field printed as N/A is a claim asserting
 * something nobody decided, on a document an adjuster reads.
 */
export function waterScaleLabel(value: number | null): string {
  if (value === null) return "";
  return isWaterNotApplicable(value) ? "N/A" : String(value);
}

export function emptyClaimInfo(): ClaimInfo {
  return {
    customerName: "",
    jobNumber: "",
    claimNumber: "",
    address: "",
    insurer: "",
    pmName: "",
    lossType: null,
    lossTypeOther: "",
    waterCategory: null,
    waterCategoryNote: null,
    contentsAssignment: null,
    contentsScopeTiming: null,
    waterClass: null,
    dateOfLoss: null,
    yearOfBuilding: null,
    causeOfLoss: "",
    preExistingConditions: "",
    dateTimeInspected: "",
    scopeOnly: false,
    scopePhases: ["EMERGENCY", "REPAIR"],
  };
}

/**
 * Whether every required step-1 intake field is filled in — gates moving on to the next step.
 * Claim number and date/time inspected are always optional; everything below Insurer is skipped
 * entirely (not just optional) whenever `usesReducedIntake` is true, since none of it feeds a
 * scope document (and a Contents-only claim has no inspection report to feed at all). waterCategory/
 * waterClass are only required when lossType is WATER — every other lossType skips IICRC
 * category/class entirely (see ClaimInfo.lossType's doc comment). "Required" here means ANSWERED,
 * and {@link WATER_NOT_APPLICABLE} is an answer: a PM who says the scale does not apply to this
 * claim has told us something, and blocking them is refusing to accept a fact about their own job.
 * Only `null` — nobody has said — holds Continue shut. At least one scope phase must be
 * selected — nothing renders at all otherwise.
 */
export function isClaimIdentityComplete(claim: ClaimInfo): boolean {
  const hasCoreFields =
    claim.customerName.trim() !== "" &&
    claim.jobNumber.trim() !== "" &&
    claim.insurer.trim() !== "" &&
    claim.lossType !== null &&
    (claim.lossType !== "WATER" || (claim.waterCategory !== null && claim.waterClass !== null)) &&
    // Choosing "Other" and leaving it blank records nothing — the same gap as picking no type at all.
    (claim.lossType !== "OTHER" || claim.lossTypeOther.trim() !== "") &&
    claim.scopePhases.length > 0;
  if (usesReducedIntake(claim)) return hasCoreFields;
  return (
    hasCoreFields &&
    claim.address.trim() !== "" &&
    claim.pmName.trim() !== "" &&
    claim.dateOfLoss !== null &&
    claim.dateOfLoss.trim() !== "" &&
    claim.yearOfBuilding !== null &&
    claim.causeOfLoss.trim() !== "" &&
    claim.preExistingConditions.trim() !== ""
  );
}

/**
 * The scope document's header lines ("{jobNumber} – {customerName}" / Category / Class / Insurer),
 * shared by every client-side scope-document builder that doesn't go through Claude (contentsTM.ts,
 * bricABrac.ts) — mirrors documentGenerationPrompt.ts's SCOPE_DOCUMENT_SECTION template, including
 * its rule that Category/Class are omitted entirely (not printed blank) for a non-WATER lossType,
 * where they were never collected at intake (see ClaimInfo.lossType's doc comment).
 */
/**
 * The loss type as it should read on a document.
 *
 * "Other" alone is not an answer, so what the PM typed stands in for it — falling back to the bare
 * word only when they left it blank, which is better than printing an empty line.
 */
export function lossTypeLabel(claim: ClaimInfo): string | null {
  if (claim.lossType === null) return null;
  if (claim.lossType === "OTHER") {
    const typed = claim.lossTypeOther.trim();
    return typed === "" ? "Other" : typed;
  }
  return LOSS_TYPE_OPTIONS.find((o) => o.value === claim.lossType)?.label ?? null;
}

export function buildScopeDocumentHeaderLines(claim: ClaimInfo): string[] {
  const lines = [`${claim.jobNumber} – ${claim.customerName}`];
  if (claim.lossType === "WATER") {
    lines.push(`Category of loss: ${waterScaleLabel(claim.waterCategory)}`, `Class of loss: ${waterScaleLabel(claim.waterClass)}`);
  }
  lines.push(`Insurer: ${claim.insurer}`);
  return lines;
}

/**
 * yearOfBuilding is the one intake field that also has to reach `extraction.loss` (see the file
 * doc comment) — call this right after extraction succeeds. Overwrites whatever extraction itself
 * found for yearOfBuilding with the intake answer (intake is authoritative, matching the "claim
 * context wins" rule every other report field already follows), then recomputes
 * asbestosTestingRequired from that authoritative year.
 */
export function applyClaimYearOfBuilding(claim: ClaimInfo, extraction: WaterLossExtraction): WaterLossExtraction {
  if (claim.yearOfBuilding === null) return extraction;
  return withDerivedFields({ ...extraction, loss: { ...extraction.loss, yearOfBuilding: claim.yearOfBuilding } });
}

/**
 * Permanently empty as of round 6 — see the file doc comment. Kept (rather than deleted) as the
 * place a claim-level, post-extraction question would go if one ever needs to move back here.
 */
/** How long water has to sit before the category is worth a second look. */
export const CATEGORY_ESCALATION_DAYS = 3;

/**
 * Whole days between the loss and the inspection, or null when either date is unusable.
 *
 * `dateTimeInspected` is free text ("8/26/2026 2:00 PM"), so it is parsed leniently and today is
 * used when it cannot be read — a scope is normally written the day it is inspected, and an
 * unparseable field should not silence the check entirely. `dateOfLoss` is an ISO date and is not
 * guessed at: with no loss date there is no elapsed time and nothing to ask about.
 */
export function daysBetweenLossAndInspection(claim: ClaimInfo): number | null {
  if (!claim.dateOfLoss || claim.dateOfLoss.trim() === "") return null;
  const loss = new Date(`${claim.dateOfLoss}T00:00:00`);
  if (Number.isNaN(loss.getTime())) return null;

  const typed = claim.dateTimeInspected.trim();
  const parsed = typed === "" ? null : new Date(typed);
  const inspected = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();

  /*
    Counted in calendar days, not elapsed milliseconds.

    "Three days later" is a thing people say about dates, not about 72 hours: a loss on Monday
    inspected Thursday morning is three days later even though barely 60 hours have passed. Dividing
    timestamps also made the answer depend on the time of day each was recorded, so the same pair of
    dates could land either side of the threshold.
  */
  const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((atMidnight(inspected) - atMidnight(loss)) / 86_400_000);
  return days < 0 ? null : days;
}

/**
 * Claim-level follow-ups that need the intake data, not just the extraction tree.
 *
 * Currently one: water that has been sitting for days may no longer be the category it started as.
 * Clean water degrades — Category 1 becomes Category 2 or 3 with time, temperature and contact with
 * building materials — so once enough days have passed this asks rather than assumes. It ASKS: the
 * PM is the one who saw it, and elapsed time is a reason to look, not a diagnosis.
 *
 * Silent when the claim already says Category 3, when the loss is not water, or when the dates make
 * the question meaningless.
 */
/**
 * Whether the contents scoping tool is NEEDED, as opposed to merely available.
 *
 * Two ways it becomes needed:
 *
 *   * The PM said this is a separate contents assignment. Obvious.
 *
 *   * Contents are being PACKED OUT. This holds even when the work was said to sit within the
 *     Emergency/Repair scope, and that is the point: "Manipulate contents – Large" is a line item a
 *     size band can carry, but a pack-out is an inventory, boxes, a truck, storage and a pack-back,
 *     and none of that can be derived from a band. So the work belonging to emergency and repair
 *     does NOT mean it has been scoped — it means the bill goes on those phases, and the detail
 *     still has to come from somewhere.
 *
 * Contents merely being "affected" is not enough. On-site manipulation is exactly what the existing
 * size question captures, and sending every claim with a full living room into a contents scoping
 * tool would be making work.
 */
export function contentsScopingNeeded(claim: ClaimInfo, extraction: WaterLossExtraction): boolean {
  if (claim.contentsAssignment === "SEPARATE") return true;
  return extraction.rooms.some((r) => r.contents?.packOutRequired === true);
}

/**
 * Contents were described, but Contents was not one of the phases selected at intake.
 *
 * That is not a mistake to correct silently either way. A PM who described a homeowner's packed
 * basement may be scoping a separate contents assignment, or may intend that work to sit inside the
 * emergency and repair line items — and those produce genuinely different documents. Assuming the
 * first invents an assignment nobody ordered; assuming the second quietly drops the work.
 *
 * So it is asked, once, and the answer is recorded. Answering "separate" does NOT stop the claim:
 * Emergency and Repair carry on exactly as before, and the claim simply carries an outstanding
 * contents scope, which is what the claims list surfaces as "Contents pending".
 */
function contentsAssignmentQuestions(claim: ClaimInfo, extraction: WaterLossExtraction): GapCheckQuestion[] {
  if (claim.contentsAssignment !== null) return [];
  // Already scoped as its own assignment at intake — there is nothing to decide.
  if (claim.scopePhases.includes("CONTENTS")) return [];
  /*
    Affected OR being packed out, not affected alone.

    A live extraction of "we're doing a full pack-out, boxing it all up and putting it in storage"
    came back with packOutRequired true and affected FALSE — the two fields are populated by
    different passes and nothing makes one imply the other. Depending on `affected` meant a claim
    that plainly needs a contents assignment was never asked about one, which is exactly the silence
    this question exists to break.
  */
  const involved = (r: Room) => r.contents?.affected === true || r.contents?.packOutRequired === true;
  if (!extraction.rooms.some(involved)) return [];

  const rooms = extraction.rooms.filter(involved).map((r) => r.roomName);
  const named = rooms.length === 1 ? rooms[0] : `${rooms.length} rooms`;
  /*
    A pack-out changes the answer, so the question says so rather than leaving the PM to remember
    what they dictated. Moving contents around a room and taking them off site are different jobs,
    and only one of them usually belongs to somebody else's assignment.
  */
  const packOut = extraction.rooms.some((r) => r.contents?.packOutRequired === true);
  const lead = packOut
    ? `Contents in ${named} are being packed out, but Contents was not selected as part of this scope.`
    : `Contents are affected in ${named}, but Contents was not selected as part of this scope.`;
  return [
    {
      id: "claim:contentsAssignment",
      roomName: null,
      prompt: `${lead} Is that a separate contents assignment, or does the work sit within the Emergency/Repair scope?`,
      kind: { type: "choice", options: CONTENTS_ASSIGNMENT_OPTIONS },
    },
  ];
}

/**
 * Now, or later.
 *
 * Asked only once the tool is known to be needed, and only when the claim is not already routed
 * through it — a claim that selected Contents at intake goes to that step anyway, so there is
 * nothing to decide.
 *
 * Deliberately not asked at the same time as the assignment question. The answer to this one depends
 * on the answer to that one, and offering both at once means offering a choice about scoping
 * contents to somebody who is about to say the contents belong to another assignment entirely.
 */
function contentsTimingQuestions(claim: ClaimInfo, extraction: WaterLossExtraction): GapCheckQuestion[] {
  if (claim.contentsScopeTiming !== null) return [];
  if (claim.scopePhases.includes("CONTENTS")) return [];
  if (!contentsScopingNeeded(claim, extraction)) return [];
  return [
    {
      id: "claim:contentsScopeTiming",
      roomName: null,
      prompt:
        "This claim needs a contents scope. Do you want to complete it now, after the emergency and repair questions, or leave it for later?",
      kind: { type: "choice", options: CONTENTS_TIMING_OPTIONS },
    },
  ];
}

export function claimInfoQuestions(claim: ClaimInfo, extraction: WaterLossExtraction): GapCheckQuestion[] {
  const contents = [...contentsAssignmentQuestions(claim, extraction), ...contentsTimingQuestions(claim, extraction)];
  // Asked for every loss type: contents are as affected by a fire as by a burst pipe, and the
  // water-only early return below would otherwise swallow this.
  if (claim.lossType !== "WATER") return contents;
  if (claim.waterCategory === 3) return contents;
  // Nothing to escalate FROM: the PM has said the scale does not apply to this claim.
  if (isWaterNotApplicable(claim.waterCategory)) return contents;
  if (claim.waterCategoryNote !== null) return contents;

  const days = daysBetweenLossAndInspection(claim);
  if (days === null || days < CATEGORY_ESCALATION_DAYS) return contents;

  const stated = claim.waterCategory === null ? "no category recorded" : `Category ${claim.waterCategory}`;
  return [
    ...contents,
    {
      id: `claim:categoryEscalation:${days}`,
      roomName: null,
      prompt:
        `${days} days passed between the loss and the inspection, and this claim has ${stated}. ` +
        "Water that has sat that long can degrade. Should this be scoped as a Category 3 loss?",
      kind: { type: "yesNo" },
    },
  ];
}

/** True for any question this module owns — lets the UI dispatch without both modules parsing every id. Currently never matches anything real; see claimInfoQuestions. */
export function isClaimInfoQuestion(questionId: string): boolean {
  return questionId.startsWith("claim:");
}

/** Mirrors gapCheck.ts's applyAnswer shape. Currently unreachable in practice (claimInfoQuestions never produces a "claim:" id), kept for the same reason claimInfoQuestions is. */
export function applyClaimAnswer(
  claim: ClaimInfo,
  extraction: WaterLossExtraction,
  questionId: string,
  answer: string,
): { claim: ClaimInfo; extraction: WaterLossExtraction } {
  const escalation = /^claim:categoryEscalation:(\d+)$/.exec(questionId);
  if (escalation) {
    const days = Number(escalation[1]);
    const yes = answer.trim().toLowerCase() === "yes";
    /*
      Either answer is recorded, and both close the question.

      A "no" has to be written down as much as a "yes" — otherwise the check fires again on the next
      pass, and a PM who has already considered it gets asked repeatedly. The note is what closes it,
      which is why it is set in both branches; `claimInfoQuestions` reads it as "already decided".
    */
    return {
      claim: {
        ...claim,
        waterCategory: yes ? 3 : claim.waterCategory,
        waterCategoryNote: yes
          ? `Scoped as Category 3: ${days} days elapsed between the loss and the inspection, confirmed by the project manager on site.`
          : `Category left as recorded: ${days} days elapsed between the loss and the inspection, reviewed and not escalated by the project manager.`,
      },
      extraction,
    };
  }

  if (questionId === "claim:contentsAssignment") {
    /*
      Both answers are recorded, and both close the question. "Within the Emergency/Repair scope" is
      a decision, not a refusal — leaving it unrecorded would re-ask on the next pass and the PM
      would be handed the same question every round.
    */
    const separate = answer.trim().toLowerCase().startsWith("separate");
    return { claim: { ...claim, contentsAssignment: separate ? "SEPARATE" : "IN_SCOPE" }, extraction };
  }

  if (questionId === "claim:contentsScopeTiming") {
    const now = answer.trim().toLowerCase().startsWith("scope");
    return { claim: { ...claim, contentsScopeTiming: now ? "NOW" : "LATER" }, extraction };
  }

  return { claim, extraction };
}
