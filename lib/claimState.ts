import type { ClaimInfo } from "./claimInfo";
import { emptyClaimInfo } from "./claimInfo";
import type { GeneratedDocuments, WaterLossExtraction } from "./types";
import type { ContentsTM } from "./contentsTM";
import { emptyContentsTM } from "./contentsTM";
import type { BricABracData } from "./bricABrac";
import { emptyBricABracData } from "./bricABrac";
import type { DGIGData } from "./dgig";
import { emptyDGIGData } from "./dgig";
import type { AsbestosScope } from "./asbestos";
import { emptyAsbestosScope } from "./asbestos";
import type { Sketch } from "./sketch";
import { emptySketch } from "./sketch";
import type { MoistureMap } from "./moisture";
import { emptyMoistureMap } from "./moisture";
import type { ScopeMarks } from "./scopeMarks";
import type { SketchAttachments } from "./sketchAttachments";
import { defaultSketchAttachments } from "./sketchAttachments";
import type { AskedQuestion } from "./questionLog";
import type { ContentsApproach, Trade, WorkOrder } from "./workOrders";
import { nextQuestions } from "./questionRound";
import { withDerivedFields } from "./types";

/**
 * Everything a saved claim is, and the only place that decides what persists.
 *
 * ── Why this file exists rather than the page serialising itself ─────────────────────────────────
 *
 * The claim page holds twenty-six pieces of state. Some describe the claim; some describe the
 * screen. Saving all of it would restore a PM into a half-open editing panel from another device;
 * saving the wrong subset loses work silently, which is worse — nothing errors, the field is just
 * empty when they come back to it.
 *
 * So the split is written down once, here, and `test/gapcheck/persistRule.mjs` checks the page
 * against it. That guard exists because this exact failure has already happened twice in this
 * codebase in a different form: a field added to a record was missing from the test fixtures and
 * silently disabled its own question, and a `reset()` that missed a field left the previous claim's
 * data on screen. A list of fields maintained by hand drifts; a list of fields a test compares
 * against the source does not.
 *
 * ── Deliberately NOT persisted ───────────────────────────────────────────────────────────────────
 *
 *   error, isEditingInspectionReport, isEditingScopeDocument, editingWorkOrders, showSketch,
 *   markingQuestion    — all describe the screen, not the claim. Restoring a PM on their phone into
 *                        an open sketch-marking dialog they opened on a laptop is not resuming work.
 *
 *   sketchImages       — derived. The page re-renders them from `sketch`, `moisture` and
 *                        `sketchAttachments` whenever those change (see the effect around
 *                        renderSketchImages). They are base64 PNGs at 2x pixel ratio, so storing
 *                        them would multiply a claim's size for something regenerated on load
 *                        anyway.
 */
export interface SavedClaimState {
  /** Where the PM had got to. Free text — the step list belongs to the UI, not to storage. */
  step: string;
  claim: ClaimInfo;
  transcript: string;
  extraction: WaterLossExtraction | null;
  /**
   * Gap-check answers typed but not yet committed by pressing Continue.
   *
   * Saved on purpose. The whole point is resuming where the PM is, and "where they are" routinely
   * means part-way down a screen of questions — dropping these would lose exactly the work somebody
   * is most likely to be interrupted in the middle of.
   */
  answers: Record<string, string>;
  questionLog: AskedQuestion[];
  documents: GeneratedDocuments | null;
  contentsApproach: ContentsApproach;
  contentsTM: ContentsTM;
  bricABrac: BricABracData;
  dgigData: DGIGData;
  asbestos: AsbestosScope;
  selectedTrades: Trade[];
  workOrders: WorkOrder[];
  sketch: Sketch;
  sketchAttachments: SketchAttachments;
  moisture: MoistureMap;
  scopeMarks: ScopeMarks;
  resolvedSuggestions: string[];
}

/**
 * The keys of `SavedClaimState`, as data.
 *
 * A type cannot be iterated at runtime, and the guard in `test/gapcheck/persistRule.mjs` needs to
 * compare this against the page's `useState` declarations. Listing them here — with the compiler
 * checking the list is exactly the interface's keys, no more and no fewer — is what keeps the two
 * from drifting: adding a field to the interface without adding it here is a type error.
 */
export const SAVED_CLAIM_KEYS = [
  "step", "claim", "transcript", "extraction", "answers", "questionLog", "documents",
  "contentsApproach", "contentsTM", "bricABrac", "dgigData", "asbestos",
  "selectedTrades", "workOrders", "sketch", "sketchAttachments", "moisture", "scopeMarks",
  "resolvedSuggestions",
] as const satisfies readonly (keyof SavedClaimState)[];

/** State the page holds that is deliberately not saved, with the reason. Read by the same guard. */
export const NOT_PERSISTED: Record<string, string> = {
  error: "a message about the last action, not a fact about the claim",
  isEditingInspectionReport: "which panel is open on this screen",
  isEditingScopeDocument: "which panel is open on this screen",
  editingWorkOrders: "which panels are open on this screen",
  showSketch: "whether the sketch pane is open on this screen",
  markingQuestion: "a dialog that is open right now",
  sketchImages: "derived — re-rendered from sketch, moisture and sketchAttachments on load",
};

/**
 * A blank claim, and the shape every load is merged onto.
 *
 * Load goes through this rather than trusting the stored payload, which matters more than it looks:
 * a claim saved last week does not have the fields added since, and reading `payload.asbestos.rooms`
 * on a row that predates asbestos would throw inside a render. Merging onto a complete blank means
 * an old claim opens with today's defaults for anything it has never heard of.
 */
export function emptySavedClaimState(): SavedClaimState {
  return {
    step: "intake",
    claim: emptyClaimInfo(),
    transcript: "",
    extraction: null,
    answers: {},
    questionLog: [],
    documents: null,
    contentsApproach: "TM",
    contentsTM: emptyContentsTM(),
    bricABrac: emptyBricABracData(),
    dgigData: emptyDGIGData(),
    asbestos: emptyAsbestosScope(),
    selectedTrades: [],
    workOrders: [],
    sketch: emptySketch(),
    sketchAttachments: defaultSketchAttachments(),
    moisture: emptyMoistureMap(),
    scopeMarks: {},
    resolvedSuggestions: [],
  };
}

/**
 * A stored payload, made safe to render.
 *
 * Shallow-merged onto a blank per key, not deep-merged. A deep merge would silently graft today's
 * defaults into the middle of last week's nested objects and produce a claim that is neither what
 * was saved nor what the code expects — an array of rooms half-filled with default rooms, say. Per
 * key, an old claim either has the whole object or gets today's blank, and both are states the app
 * already handles.
 */
export function parseSavedClaimState(payload: unknown): SavedClaimState {
  const base = emptySavedClaimState();
  if (payload === null || typeof payload !== "object") return base;
  const stored = payload as Partial<Record<keyof SavedClaimState, unknown>>;
  const merged = { ...base } as Record<string, unknown>;
  for (const key of SAVED_CLAIM_KEYS) {
    const value = stored[key];
    // `undefined` means the field predates this claim; `null` is a real value for extraction and
    // documents, so it is kept.
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as SavedClaimState;
}

/**
 * The columns the claims list reads, pulled out of the payload at save time.
 *
 * Duplicated on purpose — see 0004_organizations_and_claims.sql. The list must be able to render a
 * hundred claims without loading a hundred sketches.
 */
export function claimSummary(state: SavedClaimState): {
  customer_name: string;
  job_number: string;
  address: string;
  insurer: string;
  step: string;
  status: ClaimStatus;
} {
  return {
    customer_name: state.claim.customerName.trim(),
    job_number: state.claim.jobNumber.trim(),
    address: state.claim.address.trim(),
    insurer: state.claim.insurer.trim(),
    // The screen last open, kept because resuming needs it.
    step: state.step,
    // Where the claim actually is, which is a different question — see `claimStatus`.
    status: claimStatus(state),
  };
}

/**
 * Whether there is anything worth saving yet.
 *
 * Guards against a row being created the moment somebody opens the page and types nothing — an
 * empty claim in the list is noise, and a list full of them makes the real ones hard to find.
 */
export function hasAnyContent(state: SavedClaimState): boolean {
  return (
    state.claim.customerName.trim() !== "" ||
    state.claim.jobNumber.trim() !== "" ||
    state.transcript.trim() !== "" ||
    state.extraction !== null ||
    state.sketch.rooms.length > 0
  );
}

/**
 * Where a claim actually is, as opposed to which screen was last open.
 *
 * `step` alone is not a status. It is the screen the PM happened to be on, so a claim they opened,
 * glanced at and left sits at "intake" whether it is empty or nearly finished, and one they scrolled
 * back to reads as less complete than it is. A list sorted by that would be sorted by browsing.
 *
 * So this is derived from what the claim CONTAINS, walking backwards from the most complete state —
 * the first thing that is true wins, and each rung genuinely requires the one below it.
 *
 * Written to the `status` column on every save, so the list can sort and group without reading a
 * single payload. See 0005_claim_list_columns.sql.
 */
export type ClaimStatus =
  | "intake"
  | "transcript"
  | "gap_check"
  | "contents_pending"
  | "ready"
  | "documents"
  | "work_orders";

export const CLAIM_STATUS_ORDER: ClaimStatus[] = [
  "intake",
  "transcript",
  "gap_check",
  "contents_pending",
  "ready",
  "documents",
  "work_orders",
];

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  intake: "Intake only",
  transcript: "Transcript entered",
  gap_check: "Gap-check in progress",
  contents_pending: "Contents pending",
  ready: "Ready to generate",
  documents: "Documents generated",
  work_orders: "Work orders generated",
};

/**
 * Whether a claim that involves contents still has none recorded.
 *
 * NOT the "contents check-in" feature — no such feature exists in this codebase; every "pending" in
 * it belongs to the sketch editor or the gap-check question list. This is built from what is really
 * there: the claim selected the Contents phase, or a room's extraction says contents are affected,
 * and yet nothing has been entered on either contents form. That is a real outstanding piece of work
 * and it is worth surfacing — but if a different check-in feature was meant, this is the wrong rule
 * and should be replaced rather than extended.
 */
export function contentsOutstanding(state: SavedClaimState): boolean {
  /*
    A decision the PM actually made, where there is one.

    `IN_SCOPE` means they were asked and said the contents work belongs inside the Emergency/Repair
    line items. Nothing is owed, and continuing to report "Contents pending" would be the list
    arguing with an answer it already has.
  */
  if (state.claim.contentsAssignment === "IN_SCOPE") return false;

  const contentsExpected =
    state.claim.contentsAssignment === "SEPARATE" ||
    state.claim.scopePhases.includes("CONTENTS") ||
    /*
      Contents described but never asked about. Only reachable before the assignment question has
      been answered — which means the claim is still in gap-check, and `claimStatus` reports that
      instead. Kept anyway so this function is honest on its own rather than only in the one context
      that currently calls it.
    */
    (state.extraction?.rooms ?? []).some((r) => r.contents?.affected === true);
  if (!contentsExpected) return false;

  const tmEntered =
    state.contentsTM.onSiteManipulationHours.trim() !== "" ||
    state.contentsTM.packOutHours.trim() !== "" ||
    state.contentsTM.packBackHours.trim() !== "" ||
    Object.values(state.contentsTM.consumables).some((v) => v.trim() !== "");
  /*
    Room COUNT proves nothing here. `emptyBricABracData` seeds one blank room so the form has a row
    to type into, so a claim nobody has touched already has `rooms.length === 1`. Checked against the
    fields instead — which is the difference between "the form exists" and "somebody filled it in",
    and the whole point of this status.
  */
  const bricEntered = state.bricABrac.rooms.some(
    (r) =>
      r.roomName.trim() !== "" ||
      r.contentSize !== null ||
      r.unboxableItems.trim() !== "" ||
      r.movingBlankets.trim() !== "" ||
      r.otherConsumables.trim() !== "" ||
      Object.values(r.boxes).some((v) => v.trim() !== ""),
  );
  return !tmEntered && !bricEntered;
}

export function claimStatus(state: SavedClaimState): ClaimStatus {
  // Most complete first: a claim with work orders also has documents, and so on down.
  if (state.workOrders.length > 0) return "work_orders";
  if (state.documents !== null) return "documents";

  if (state.extraction !== null) {
    /*
      Whether the gap-check is finished is the engine's own answer, not a guess from `step`. Asking
      it here costs one evaluation per save and means the list cannot disagree with the screen.
    */
    const open = nextQuestions(state.claim, withDerivedFields(state.extraction));
    if (open.length > 0) return "gap_check";

    /*
      Between "questions done" and "ready to generate", never before.

      Outstanding contents outranks READY — a claim with every question answered is still waiting on
      the one thing nobody has done, and "Ready to generate" would hide exactly that. It does NOT
      outrank the gap-check: a PM part-way through the questions is doing the more immediate work,
      and labelling that claim "Contents pending" would point them at the wrong thing.
    */
    if (contentsOutstanding(state)) return "contents_pending";
    return "ready";
  }

  if (state.transcript.trim() !== "") return "transcript";
  return "intake";
}

/** For the list. Falls back to the raw value so an unrecognised status is visible, not blank. */
export function claimStatusLabel(status: string): string {
  return CLAIM_STATUS_LABEL[status as ClaimStatus] ?? status;
}

/**
 * The step to reopen a claim at.
 *
 * Mostly the step it was saved on — that is the whole point of saving it. Two kinds of exception:
 *
 *   * The TRANSIENT steps. "extracting" and "generating" describe a request that was in flight, and
 *     that request died with the tab. Reopening into either shows a spinner that will never resolve,
 *     so each falls back to the screen its request was launched from.
 *
 *   * Steps whose data did not survive. A claim saved on "results" whose documents are somehow
 *     absent would render an empty results screen with no way forward; sending it to "ready" gives
 *     the PM a button that regenerates them.
 */
export function resumeStep(state: SavedClaimState): string {
  switch (state.step) {
    case "extracting":
      return "transcript";
    case "generating":
      return "ready";
    case "results":
      return state.documents === null ? "ready" : "results";
    default:
      return state.step;
  }
}
