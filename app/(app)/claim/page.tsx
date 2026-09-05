"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type GapCheckQuestion, siblingQuestionIds } from "@/lib/questions";
import { type AskedQuestion, formatQuestionLog, hasQuestionLog, recordRound } from "@/lib/questionLog";
import { type SavedClaimState, resumeStep } from "@/lib/claimState";
import { useClaimPersistence } from "@/lib/useClaimPersistence";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { resolveRound, nextQuestions } from "@/lib/questionRound";
import type { GeneratedDocuments, WaterLossExtraction } from "@/lib/types";
import { evaluate, applyAnswer, isContentsSizeQuestion, isEmergencyOnlyQuestion, isEquipmentPresenceQuestion, isRepairOnlyQuestion, isWaterExtractionQuestion } from "@/lib/gapCheck";
import { emptyLoss, withDerivedFields } from "@/lib/types";
import {
  type ClaimInfo,
  type LossType,
  type ScopePhase,
  applyClaimAnswer,
  applyClaimYearOfBuilding,
  claimInfoQuestions,
  emptyClaimInfo,
  hasSeparateContents,
  isClaimIdentityComplete,
  isClaimInfoQuestion,
  isContentsOnly,
  hasRemediation,
  hasStructuralScope,
  isRemediationOnly,
  skipsTranscriptPipeline,
  buildScopeDocumentHeaderLines,
} from "@/lib/claimInfo";
import { isDGIG, isTD } from "@/lib/insurers";
import { DGIGForm } from "@/components/DGIGForm";
import { type AntimicrobialExtent, type DGIGData, type DryingClass, buildDGIGSyntheticTranscript, emptyDGIGData, emptyDGIGRoom, hasDGIGContent, newDGIGRoomId } from "@/lib/dgig";
import { ClaimIntakeForm } from "@/components/ClaimIntakeForm";
import { QuestionGroup } from "@/components/QuestionGroup";
import { isQuestionAnswered } from "@/components/QuestionField";
import { JobInformationSection } from "@/components/JobInformationSection";
import { LetterheadBanner } from "@/components/LetterheadBanner";
import { ContentsForm } from "@/components/ContentsForm";
import { AsbestosForm } from "@/components/AsbestosForm";
import { type AsbestosScope, emptyAsbestosScope, hasAsbestosContent } from "@/lib/asbestos";
import { buildAsbestosScopeSection } from "@/lib/asbestosScope";
import { BricABracForm } from "@/components/BricABracForm";
import { claimFileName, downloadDocumentPdf } from "@/lib/pdf";
import { buildJobInformationGroups } from "@/lib/jobInformation";
import {
  type ContentsTM,
  type DisposalType,
  buildContentsOnlyScopeDocument,
  buildContentsScopeSection,
  emptyContentsTM,
} from "@/lib/contentsTM";
import {
  type BricABracData,
  type ContentSize,
  buildBricABracOnlyScopeDocument,
  buildBricABracScopeSection,
  emptyBricABracData,
  emptyBricABracRoom,
  newRoomId,
} from "@/lib/bricABrac";
import {
  type BoxCleanFamily,
  type BoxCleaningEntry,
  type BoxCleanSize,
  type CleanIntensity,
  type Density,
  emptyBoxCleaningEntry,
  listLines,
  newId,
} from "@/lib/contentCleaning";
import { type Trade, type WorkOrder, availableTrades, buildWorkOrders, unavailableTradeNote } from "@/lib/workOrders";
import { WorkOrderSelector } from "@/components/WorkOrderSelector";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { type Sketch, emptySketch, hasSketchContent, knownRoomNames, levelsOf } from "@/lib/sketch";
import { type MoistureMap, emptyMoistureMap, hasMoistureContent, roomMoistureSummary } from "@/lib/moisture";
import { DEFAULT_EQUIPMENT_SETTINGS, claimEquipment } from "@/lib/equipment";
import {
  type AttachmentTarget,
  type SketchAttachments,
  type SketchRender,
  sketchRenderLabel,
  attachmentsFor,
  availableRenders,
  defaultSketchAttachments,
  pruneAttachments,
} from "@/lib/sketchAttachments";
import { type SketchImage, dataUrlToBlob, downloadDataUrl, renderSketchImages, renderSketchJpeg } from "@/components/sketch/renderSketchImage";
import { surfaceThumbnails } from "@/lib/surfaceThumbnails";
import { SketchAttachmentToggle } from "@/components/sketch/SketchAttachmentPicker";
import { ScopeMarkPicker, type ScopeMeasure } from "@/components/sketch/ScopeMarkPicker";
import { type ScopeMark, type ScopeMarks, paintableWallSquareFeet, pruneScopeMarks, scopeMarkFor, setScopeMark } from "@/lib/scopeMarks";
import type { SketchPage } from "@/lib/pdf";
import {
  type EquipmentSuggestions,
  equipmentSuggestionKey,
  normaliseRoomName,
  sketchMeasureFor,
  withoutResolvedSuggestions,
} from "@/lib/gapCheck";
import { type SendableDocument, SendDocumentsPanel } from "@/components/SendDocumentsPanel";
import Link from "next/link";

type Step = "intake" | "transcript" | "extracting" | "questions" | "ready" | "dgig" | "contents" | "remediation" | "generating" | "results";

/** Two alternate ways to fill in the same "Contents" section (see contentsTM.ts / bricABrac.ts's doc comments) — a claim picks one, not both. */
type ContentsApproach = "TM" | "BRIC_A_BRAC";

/** Dispatches to whichever approach is active — every call site that needs the Contents section text goes through this one place. */
function buildContentsSection(approach: ContentsApproach, contentsTM: ContentsTM, bricABrac: BricABracData): string {
  return approach === "TM" ? buildContentsScopeSection(contentsTM) : buildBricABracScopeSection(bricABrac);
}

function buildContentsOnlyDocument(approach: ContentsApproach, claim: ClaimInfo, contentsTM: ContentsTM, bricABrac: BricABracData): string {
  return approach === "TM" ? buildContentsOnlyScopeDocument(claim, contentsTM) : buildBricABracOnlyScopeDocument(claim, bricABrac);
}

/**
 * The inspection report's CONTENTS line when Contents is selected alongside structural scope (see
 * claimInfo.ts's `hasSeparateContents`) — see documentGenerationPrompt.ts's
 * documentGenerationUserMessage doc comment for why this has to be computed here and sent as
 * authoritative claim context rather than left for the model to infer: the transcript deliberately
 * says nothing about contents in that case (see the transcript step's own guidance), so there's
 * nothing to infer from. Null otherwise — there's no separate contents assignment to note. T&M has
 * no non-restorable/cleaning concept of its own, so the "processing" clause only ever applies under
 * the bric-a-brac approach.
 */
function buildContentsAssignmentNote(claim: ClaimInfo, contentsApproach: ContentsApproach, bricABrac: BricABracData): string | null {
  if (!hasSeparateContents(claim)) return null;
  const isProcessing = contentsApproach === "BRIC_A_BRAC" && (Number.parseFloat(bricABrac.nonRestorableCount) > 0 || bricABrac.cleaning.isCleaningContent);
  return isProcessing
    ? "A separate contents assignment is required to pack out and pack back the contents, including processing of non-restorable and/or cleaned items."
    : "A separate contents assignment is required to pack out and pack back the contents.";
}

const STEP_NUMBER: Record<Step, number> = {
  intake: 1,
  transcript: 2,
  extracting: 2,
  dgig: 2,
  questions: 3,
  ready: 3,
  contents: 3,
  // Alongside contents rather than after it: both are the "fill in the form" stage, and a claim
  // with both still passes through one numbered step from the PM's point of view.
  remediation: 3,
  generating: 3,
  results: 4,
};

/** Small label + progress bar shown at the top of every step's card. */
function StepHeader({ step, label }: { step: Step; label: string }) {
  const n = STEP_NUMBER[step];
  return (
    <>
      <div className="step-indicator">
        Step {n} of 4 — {label}
      </div>
      <div className="step-progress-track">
        <div className="step-progress-fill" style={{ width: `${(n / 4) * 100}%` }} />
      </div>
    </>
  );
}

/** Report Details first, then claim-level loss questions (roomName === null), then one group per room, in room-mention order. */
function groupQuestions(questions: GapCheckQuestion[]): { title: string; questions: GapCheckQuestion[] }[] {
  const reportQuestions = questions.filter((q) => isClaimInfoQuestion(q.id));
  const lossQuestions = questions.filter((q) => !isClaimInfoQuestion(q.id) && q.roomName === null);
  const byRoom = new Map<string, GapCheckQuestion[]>();
  for (const q of questions) {
    if (isClaimInfoQuestion(q.id) || q.roomName === null) continue;
    const list = byRoom.get(q.roomName) ?? [];
    list.push(q);
    byRoom.set(q.roomName, list);
  }
  const groups: { title: string; questions: GapCheckQuestion[] }[] = [];
  if (reportQuestions.length > 0) groups.push({ title: "Report Details", questions: reportQuestions });
  if (lossQuestions.length > 0) groups.push({ title: "Loss Details", questions: lossQuestions });
  for (const [roomName, roomQuestions] of byRoom) groups.push({ title: roomName, questions: roomQuestions });
  return groups;
}


async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && typeof data === "object" && "error" in data && String(data.error)) || `Request failed (${res.status})`);
  }
  return data as T;
}

export default function Home() {
  const [step, setStep] = useState<Step>("intake");
  const [claim, setClaim] = useState<ClaimInfo>(emptyClaimInfo());
  const [transcript, setTranscript] = useState("");
  const [extraction, setExtraction] = useState<WaterLossExtraction | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /*
    What was asked and answered, appended a round at a time — see `lib/questionLog.ts`.

    Recorded rather than derived because nothing else keeps it: `answers` is emptied on every
    Continue below and the displayed list is rebuilt per round, so a question's wording and its
    position are gone the moment the round is committed.
  */
  const [questionLog, setQuestionLog] = useState<AskedQuestion[]>([]);
  const [documents, setDocuments] = useState<GeneratedDocuments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentsTM, setContentsTM] = useState<ContentsTM>(emptyContentsTM());
  const [contentsApproach, setContentsApproach] = useState<ContentsApproach>("TM");
  const [bricABrac, setBricABrac] = useState<BricABracData>(emptyBricABracData());
  const [dgigData, setDgigData] = useState<DGIGData>(emptyDGIGData());
  const [isEditingInspectionReport, setIsEditingInspectionReport] = useState(false);
  const [isEditingScopeDocument, setIsEditingScopeDocument] = useState(false);
  const [selectedTrades, setSelectedTrades] = useState<Trade[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  /** Which generated work orders are currently in edit mode, keyed by trade. */
  const [editingWorkOrders, setEditingWorkOrders] = useState<Record<string, boolean>>({});
  /**
   * The sketch, and whether its editor is open.
   *
   * Deliberately standalone: nothing reads `sketch` to decide what else can happen, and nothing
   * else has to exist before a sketch can be drawn. It's available from the first step onward and
   * is never a precondition for extraction, generation or work orders — a claim with no sketch is a
   * complete claim. Same in-session-only storage as every other piece of claim state here; it is
   * lost on reload, which is what persistence (a later stage) will fix for all of this at once.
   */
  const [sketch, setSketch] = useState<Sketch>(emptySketch());
  /**
   * Moisture readings, held beside the sketch rather than inside it.
   *
   * Same ephemeral pattern as everything else here, and same optionality: a claim with a sketch and
   * no moisture map is an ordinary claim. Keeping it out of `sketch` is what lets the plain drawing
   * and the marked-up one both come from the one room the PM drew — see `lib/moisture.ts`.
   */
  const [moisture, setMoisture] = useState<MoistureMap>(emptyMoistureMap());
  /**
   * Equipment suggestions the PM has already answered, so they are never offered twice.
   *
   * Answers are cleared between rounds, and nothing in the extraction records that a suggestion was
   * ever made — so without this the confirm-or-suggest question re-fired after "keep", and a second,
   * different answer silently replaced the first. See `equipmentSuggestionKey`.
   */
  const [resolvedSuggestions, setResolvedSuggestions] = useState<string[]>([]);


  /**
   * Equipment counts the moisture map suggests, for gap-check to compare a stated count against.
   *
   * Undefined — not an empty object — when there is no map, so the confirm-or-suggest question is
   * never constructed rather than merely never matching. A claim without moisture mapping goes
   * through gap-check exactly as it did before this existed.
   */
  const equipmentSuggestions = useMemo<EquipmentSuggestions | undefined>(() => {
    const result = claimEquipment(sketch, moisture, DEFAULT_EQUIPMENT_SETTINGS);
    if (result.rooms.length === 0) return undefined;

    const byRoom: EquipmentSuggestions = {};
    for (const room of result.rooms) {
      const sketchRoom = sketch.rooms.find((r) => r.id === room.roomId);
      const measured = sketchRoom ? roomMoistureSummary(sketchRoom, moisture) : null;
      byRoom[normaliseRoomName(room.roomName)] = {
        // Keyed by the same free-text type strings extraction uses — see `EquipmentRecord.type`.
        equipment: { "air movers": room.airMovers.units, dehumidifiers: room.dehumidifiers.units },
        floorSquareFeet: measured && measured.affectedFloorSquareFeet > 0 ? measured.affectedFloorSquareFeet : null,
        // The affected wall RUN, which is what a cut length is measured in — not the area.
        wallRunFeet: measured
          ? measured.readings.reduce((sum, r) => sum + (r.affectedLengthFeet ?? 0), 0) || null
          : null,
        ceilingSquareFeet: measured && measured.affectedCeilingSquareFeet > 0 ? measured.affectedCeilingSquareFeet : null,
        /*
          Nesting, carried through to gap-check so a closet drawn inside a bedroom stops being asked
          the bedroom's questions over again. Normalised to the same key space as `byRoom` above so
          it can be looked up directly; null for a room standing on its own, and null too if the
          parent has somehow gone from the sketch, which correctly makes this a top-level room again.
        */
        parentRoomKey: (() => {
          const parentId = sketchRoom?.parentRoomId ?? null;
          if (parentId === null) return null;
          const parent = sketch.rooms.find((r) => r.id === parentId);
          return parent ? normaliseRoomName(parent.name ?? "") : null;
        })(),
      };
    }
    return withoutResolvedSuggestions(byRoom, resolvedSuggestions);
  }, [sketch, moisture, resolvedSuggestions]);
  /**
   * Asbestos abatement — phase 1 of the Remediation loss type.
   *
   * Held here beside the sketch and contents forms because it is the same kind of thing: an optional
   * section the PM fills in, whose scope text is built client-side and appended to whatever else the
   * claim produces. See lib/asbestos.ts for why nothing in it calls Claude.
   */
  const [asbestos, setAsbestos] = useState<AsbestosScope>(emptyAsbestosScope);
  const [showSketch, setShowSketch] = useState(false);
  /** Which door the sketch was opened by — see `openSketch`. */
  const [sketchOpensReadOnly, setSketchOpensReadOnly] = useState(false);
  /** Which rendering of the sketch goes on which document — see `lib/sketchAttachments.ts`. */
  const [sketchAttachments, setSketchAttachments] = useState<SketchAttachments>(defaultSketchAttachments);
  /**
   * The rendered plans, held as images so every PDF call stays synchronous.
   *
   * Rendering is asynchronous — it mounts the real canvas off screen — and it would be wrong to make
   * Download PDF wait on it at the moment of clicking. They are produced once whenever the sketch
   * changes, and each document then picks the ones it was told to carry.
   */
  const [sketchImages, setSketchImages] = useState<SketchImage[]>([]);
  /**
   * Quantities marked out on the sketch, keyed by the question each answers.
   *
   * Kept rather than discarded once the number is taken, so reopening the picker shows what was
   * marked instead of a blank plan — a quantity is usually adjusted, not re-derived.
   */
  const [scopeMarks, setScopeMarks] = useState<ScopeMarks>({});
  /** The question whose marking is open, if any. */
  const [markingQuestion, setMarkingQuestion] = useState<{ question: GapCheckQuestion; measure: ScopeMeasure } | null>(null);

  /* ── Saving, and picking a claim back up ─────────────────────────────────────────────────────
     Assembled from the same nineteen states listed in `SavedClaimState`, and only those — see
     lib/claimState.ts for what is left out and why, and test/gapcheck/persistRule.mjs for the check
     that stops this list and that one drifting apart. */
  const persistedState: SavedClaimState = useMemo(
    () => ({
      step, claim, transcript, extraction, answers, questionLog, documents,
      contentsApproach, contentsTM, bricABrac, dgigData, asbestos,
      selectedTrades, workOrders, sketch, sketchAttachments, moisture, scopeMarks, resolvedSuggestions,
    }),
    [
      step, claim, transcript, extraction, answers, questionLog, documents,
      contentsApproach, contentsTM, bricABrac, dgigData, asbestos,
      selectedTrades, workOrders, sketch, sketchAttachments, moisture, scopeMarks, resolvedSuggestions,
    ],
  );

  /*
    Pushing a loaded claim back in.

    Every setter, in the same order the interface lists them, so a field added there and missed here
    is visible as an obviously shorter function rather than as a field that silently loads blank.
  */
  const applyLoadedClaim = useCallback((loaded: SavedClaimState) => {
    /*
      `resumeStep`, not `loaded.step`. A claim saved mid-request carries a step describing a request
      that died with the tab — reopening into "extracting" or "generating" is a spinner that never
      resolves. See lib/claimState.ts for the full set of exceptions.
    */
    setStep(resumeStep(loaded) as Step);
    setClaim(loaded.claim);
    setTranscript(loaded.transcript);
    setExtraction(loaded.extraction);
    setAnswers(loaded.answers);
    setQuestionLog(loaded.questionLog);
    setDocuments(loaded.documents);
    setContentsApproach(loaded.contentsApproach);
    setContentsTM(loaded.contentsTM);
    setBricABrac(loaded.bricABrac);
    setDgigData(loaded.dgigData);
    setAsbestos(loaded.asbestos);
    setSelectedTrades(loaded.selectedTrades);
    setWorkOrders(loaded.workOrders);
    setSketch(loaded.sketch);
    setSketchAttachments(loaded.sketchAttachments);
    setMoisture(loaded.moisture);
    setScopeMarks(loaded.scopeMarks);
    setResolvedSuggestions(loaded.resolvedSuggestions);
  }, []);

  /*
    Points worth guaranteeing a save at, rather than waiting for the debounce.

    The autosave already writes after every change, which is what makes a claim resumable at all.
    What it does not give is a GUARANTEE at any particular moment: it is time-based, so a gap-check
    round committed a second before a browser crash, a lost connection or a phone running out of
    battery is a round that was never written. The pagehide flush covers a tab being closed; it does
    not cover the machine simply stopping.

    So each meaningful transition bumps this, and the effect below writes immediately. The counter
    exists rather than calling `saveNow()` from the handlers directly because `saveNow` reads the
    state through a ref, and a ref updated during render still holds the OLD state when an event
    handler runs — calling it inline would reliably save the round BEFORE the one just committed.
    Bumping a counter defers the write to after the re-render, when the state is actually current.
  */
  const [saveCheckpoint, setSaveCheckpoint] = useState(0);
  const checkpoint = useCallback(() => setSaveCheckpoint((n) => n + 1), []);

  const persistence = useClaimPersistence({
    state: persistedState,
    apply: applyLoadedClaim,
    /*
      Off in the dev fail-open, where there is nobody to save for. `isSupabaseConfigured` is the
      client-side half of the same test `lib/usage.ts` makes on the server — with the two public
      variables blank, middleware waves requests through and there is no session for a claim to
      belong to, so saving would only collect 401s.
    */
    enabled: isSupabaseConfigured(),
  });

  useEffect(() => {
    // Zero is the initial value, not a checkpoint — writing on mount would save a blank claim.
    if (saveCheckpoint === 0) return;
    void persistence.saveNow();
    // Deliberately only the counter: `persistence` is a fresh object every render, and depending on
    // it would flush on every render instead of at the points that asked for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveCheckpoint]);

  /*
    The pending list, recomputed from the answers on screen rather than snapshotted at Continue.

    A follow-up has to appear the moment the answer that calls for it is given — say there are two
    windows and the size question belongs on that screen, not after a submit. Snapshotting the list
    made every dependent cost a round trip, which is what made the flow feel long: the PM answers
    one thing, presses Continue, and gets handed the question they were already thinking about.

    So the answers are folded into a DRAFT tree and the engine is re-run against it. `resolveRound`
    applies each answer only to a question the engine actually asked, iterating until the list stops
    growing — which is the same fixed point the old multi-round loop reached, minus the submits.
    Continue then just commits the draft it has already computed.

    Every question here is still a question the engine generated from real state; nothing is shown
    speculatively and nothing applicable is hidden. That invariant is what `isComplete` rests on.
  */
  const round = useMemo(
    () => (extraction ? resolveRound(claim, extraction, answers, equipmentSuggestions) : null),
    [claim, extraction, answers, equipmentSuggestions],
  );
  /*
    Rendered: everything asked while resolving, answered or not — see `ResolvedRound.display`.
    Gating: whatever is still OPEN. The two differ the moment an answer is given, and rendering the
    open list alone made each question vanish as it was answered.
  */
  const currentQuestions = useMemo(() => round?.display ?? [], [round]);
  const openQuestions = useMemo(() => round?.questions ?? [], [round]);
  const groups = useMemo(() => groupQuestions(currentQuestions), [currentQuestions]);
  /*
    One thumbnail per surface getting drywall work, derived from the claim — see
    `lib/surfaceThumbnails.ts`. Recomputed as the scope fills in, so a wall that stops being cut
    stops being offered and `pruneAttachments` drops it if it had already been ticked.
  */
  const thumbnails = useMemo(
    () => surfaceThumbnails(extraction, sketch, moisture, scopeMarks),
    [extraction, sketch, moisture, scopeMarks],
  );
  const sketchRenders = availableRenders(hasSketchContent(sketch), hasMoistureContent(moisture), thumbnails, levelsOf(sketch));
  const sketchRenderKey = sketchRenders.join(",");

  /*
    Re-render the attachable plans when the sketch changes.

    Deferred rather than immediate: a paint stroke fires this many times a second, and each run
    mounts a canvas off screen. A short settle means the work happens once the PM stops drawing.
  */
  useEffect(() => {
    if (sketchRenderKey === "") {
      setSketchImages([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderSketchImages(sketch, moisture, sketchRenderKey.split(",") as SketchAttachments["inspectionReport"], thumbnails).then((images) => {
        if (!cancelled) setSketchImages(images);
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sketch, moisture, sketchRenderKey]);

  /** Drop any selection whose render no longer exists, so a tick can never produce a blank page. */
  useEffect(() => {
    const available = sketchRenderKey === "" ? [] : (sketchRenderKey.split(",") as SketchAttachments["inspectionReport"]);
    setSketchAttachments((prev) => {
      const next = pruneAttachments(prev, available);
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [sketchRenderKey]);

  /**
   * Paint area for every wall the PM marked out on the sketch, keyed the way work orders index walls.
   *
   * A wall marked for a drywall cut is repainted corner to corner, so its full area is what painting
   * covers — except at base height, where the patch hides behind the baseboard and
   * `paintableWallSquareFeet` returns null so the old per-linear-foot estimate stands.
   */
  /*
    Markings reference sketch geometry by id, so deleting a room strands every mark that pointed at
    it — and a stranded mark keeps feeding a wall run into a scope quantity. Same orphan
    `pruneMoisture` exists to prevent on the other store that indexes the same drawing.
  */
  useEffect(() => {
    setScopeMarks((prev) => pruneScopeMarks(prev, sketch));
  }, [sketch]);

  const paintableWallSF = useMemo(() => {
    const out: Record<string, number | null> = {};
    if (!extraction) return out;
    for (const room of extraction.rooms) {
      room.walls.forEach((wall, wallIndex) => {
        const questionId = `room:${extraction.rooms.indexOf(room)}:wall:${wallIndex}:cutRunFt`;
        const mark = scopeMarks[questionId];
        if (!mark) return;
        out[`${room.roomName ?? ""}:${wallIndex}`] = paintableWallSquareFeet(mark, sketch, wall.cutHeight);
      });
    }
    return out;
  }, [extraction, scopeMarks, sketch]);

  /**
   * Painted floor area per room, keyed the way gap-check matches room names.
   *
   * The moisture map and the water-extraction question ask for the same real-world fact — how much
   * floor the water reached — so once it has been marked out it is not asked for again.
   */
  const paintedFloorByRoom = useMemo(() => {
    const out: Record<string, number> = {};
    for (const room of sketch.rooms) {
      const summary = roomMoistureSummary(room, moisture);
      if (summary.affectedFloorSquareFeet > 0) {
        out[normaliseRoomName(room.name)] = Math.round(summary.affectedFloorSquareFeet * 10) / 10;
      }
    }
    return out;
  }, [sketch, moisture]);

  /*
    Fill the water-extraction amount in from the map, rather than asking for it a second time.

    Only the AMOUNT. Whether extraction was required at all stays the PM's call — a wet floor does
    not always need extracting — so that question still fires; this just means answering it yes does
    not then lead to marking out an area that has already been marked out.
  */
  useEffect(() => {
    if (Object.keys(paintedFloorByRoom).length === 0) return;
    setExtraction((prev) => {
      if (!prev) return prev;
      let changed = false;
      const rooms = prev.rooms.map((room) => {
        if (room.waterExtractionRequired !== true) return room;
        if (room.waterExtractionSF !== null || room.waterExtractionFraction !== null) return room;
        const sf = paintedFloorByRoom[normaliseRoomName(room.roomName ?? "")];
        if (sf === undefined) return room;
        changed = true;
        return { ...room, waterExtractionSF: sf };
      });
      return changed ? { ...prev, rooms } : prev;
    });
  }, [paintedFloorByRoom]);

  /** What the claim already states is being placed, for the on-the-spot check in the sketch. */
  const statedEquipment = useMemo(() => {
    const out: Record<string, Partial<Record<string, number>>> = {};
    for (const room of extraction?.rooms ?? []) {
      const key = normaliseRoomName(room.roomName ?? "");
      for (const e of room.equipment) {
        if (e.quantity === null) continue;
        out[key] = { ...(out[key] ?? {}), [e.type]: e.quantity };
      }
    }
    return out;
  }, [extraction]);

  /**
   * The PM answered the equipment check from inside the sketch, so record it and retire it.
   *
   * Retiring matters as much as recording: without it the same comparison would come round again in
   * the next gap-check pass, which is precisely the disconnected second asking this replaces.
   */
  const handleResolveEquipment = useCallback(
    (roomName: string, equipmentType: string, adopt: number | null) => {
      setResolvedSuggestions((prev) => [...new Set([...prev, `${normaliseRoomName(roomName)}::${equipmentType}`])]);
      if (adopt === null) return;
      setExtraction((prev) =>
        prev
          ? {
              ...prev,
              rooms: prev.rooms.map((room) =>
                normaliseRoomName(room.roomName ?? "") === normaliseRoomName(roomName)
                  ? { ...room, equipment: room.equipment.map((e) => (e.type === equipmentType ? { ...e, quantity: adopt } : e)) }
                  : room,
              ),
            }
          : prev,
      );
    },
    [],
  );

  /** The pages one document should carry, ready to hand to the PDF builder. */
  const sketchPagesFor = useCallback(
    (target: AttachmentTarget): SketchPage[] => {
      const wanted = attachmentsFor(sketchAttachments, target);
      return sketchImages
        .filter((image) => wanted.includes(image.render))
        .map((image) => ({ dataUrl: image.dataUrl, width: image.width, height: image.height, caption: sketchRenderLabel(image.render, thumbnails) }));
    },
    [sketchAttachments, sketchImages],
  );

  /**
   * The plan as a JPEG, built at the moment it is asked for.
   *
   * Not held in state beside `sketchImages` because nothing displays it: it exists to be downloaded
   * or attached, both of which are clicks. Rendering it eagerly would mount a third canvas off
   * screen after every stroke to produce a file most claims never ask for.
   */
  const buildSketchJpeg = useCallback(
    async (render: SketchRender): Promise<{ blob: Blob; filename: string } | null> => {
      const image = await renderSketchJpeg(sketch, moisture, render);
      if (!image) return null;
      return {
        blob: dataUrlToBlob(image.dataUrl),
        filename: claimFileName(claim.jobNumber, claim.customerName, sketchRenderLabel(render, thumbnails), "jpg"),
      };
    },
    [sketch, moisture, claim.jobNumber, claim.customerName],
  );

  /**
   * The session as a text file: what was asked, in order, and what came back.
   *
   * Includes the round on screen right now as well as the committed ones — mid-flow is exactly when
   * somebody exports this to describe a problem, and a log that stopped at the last submit would be
   * missing the screen they are actually looking at.
   */
  const exportQuestionLog = useCallback(() => {
    const inFlight = round
      ? recordRound(questionLog.length === 0 ? 1 : questionLog[questionLog.length - 1]!.round + 1, round.display, round.applied, answers)
      : [];
    const text = formatQuestionLog(claim, questionLog, inFlight);
    const url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
    downloadDataUrl(url, claimFileName(claim.jobNumber, claim.customerName, "Questions and answers", "txt"));
  }, [claim, questionLog, round, answers]);

  const downloadSketchJpeg = useCallback(
    async (render: SketchRender) => {
      const image = await renderSketchJpeg(sketch, moisture, render);
      if (!image) return;
      downloadDataUrl(image.dataUrl, claimFileName(claim.jobNumber, claim.customerName, sketchRenderLabel(render, thumbnails), "jpg"));
    },
    [sketch, moisture, claim.jobNumber, claim.customerName, thumbnails],
  );

  /**
   * Room names already used elsewhere in this claim, offered as suggestions when naming a sketch
   * room so the two can be cross-referenced later. Recomputed as the claim fills in, because a
   * sketch drawn at intake has no room names to offer yet but one drawn after extraction does.
   */
  const sketchRoomNames = useMemo(
    () => knownRoomNames({ extractionRooms: extraction?.rooms, dgigRooms: dgigData.rooms, contentsRooms: bricABrac.rooms }),
    [extraction, dgigData.rooms, bricABrac.rooms],
  );
  // Every open question answered — equivalently, nothing left open. Uses the open list rather
  // than the rendered one, which still carries the questions already answered.
  /*
    Exactly what is holding Continue shut, by name.

    Twice in testing the flow reached a state it could not leave with nothing on screen explaining
    why — once a real conditional-logic bug, once simply a question scrolled past — and both times
    the only way to find the blocker was re-reading every question by hand. A disabled button that
    will not say what it is waiting for is a dead end for whoever is using it AND for whoever is
    debugging it, so the answer is named rather than implied.
  */
  const blockingQuestions = useMemo(
    () => openQuestions.filter((q) => !isQuestionAnswered(q, answers[q.id])),
    [openQuestions, answers],
  );
  const allAnswered = blockingQuestions.length === 0;

  function reset() {
    setStep("intake");
    setClaim(emptyClaimInfo());
    setTranscript("");
    setExtraction(null);
    setAnswers({});
    setDocuments(null);
    setError(null);
    setContentsTM(emptyContentsTM());
    setContentsApproach("TM");
    setBricABrac(emptyBricABracData());
    setDgigData(emptyDGIGData());
    setIsEditingInspectionReport(false);
    setIsEditingScopeDocument(false);
    setSelectedTrades([]);
    setWorkOrders([]);
    setEditingWorkOrders({});
    setSketch(emptySketch());
    setMoisture(emptyMoistureMap());
    setResolvedSuggestions([]);
    setShowSketch(false);
    setSketchOpensReadOnly(false);
    /*
      Everything below was missing, and every one of them is claim data that outlived the claim.

      There is no persistence anywhere in this app — state lives only in these hooks — so the ONLY
      way a deleted claim's data can reappear is a teardown that forgets a piece of it. That makes
      this function the single point of failure for "I deleted it and it came back", and the reason
      `test/gapcheck/resetRule.mjs` now checks it against the state list mechanically rather than
      trusting anyone to remember.

      The asbestos form was the worst of them: a whole Remediation scope — containment, samples,
      hygienist fees — carried silently into the next claim and into the documents built from it.
    */
    setAsbestos(emptyAsbestosScope());
    setScopeMarks({});
    setSketchAttachments(defaultSketchAttachments());
    setSketchImages([]);
    setMarkingQuestion(null);
    setQuestionLog([]);
    /*
      Let go of the saved row as well as the state on screen.

      Without this, Start Over would keep writing to the claim that was open and overwrite a real,
      finished claim with a blank one — the same class of mistake as a reset that forgets a field,
      except the damage is to work already saved rather than to what is on screen. The previous
      claim stays exactly as it was; the next save starts a new one.
    */
    persistence.forget();
    /*
      Reset the checkpoint counter too, so the next claim's first real checkpoint is a change rather
      than a continuation of the last one's count. Caught by test/gapcheck/resetRule.mjs, which is
      the whole reason that guard exists.
    */
    setSaveCheckpoint(0);
  }

  /*
    Which door was used, remembered for the editor to open in.

    A separate piece of state rather than a prop computed at render, because the editor keeps its own
    lock state after mounting — the PM can unlock and carry on without coming back out here, which is
    the point of the lock being a toggle rather than a mode.
  */
  function openSketch(readOnly: boolean) {
    setSketchOpensReadOnly(readOnly);
    setShowSketch(true);
  }

  function handleToggleTrade(trade: Trade) {
    setSelectedTrades((prev) => (prev.includes(trade) ? prev.filter((t) => t !== trade) : [...prev, trade]));
  }

  /**
   * Builds every selected work order from data already in memory — no API call, so this never
   * re-extracts and never counts against the usage cap.
   */
  function handleGenerateWorkOrders() {
    setWorkOrders(
      buildWorkOrders({
        trades: selectedTrades,
        claim,
        extraction,
        contentsApproach,
        contentsTM,
        bricABrac,
        // Same condition the generate call uses, so a DGIG claim's work order and its scope
        // document's Emergency section always read from the same source.
        dgigData: isDGIG(claim.insurer) && hasDGIGContent(dgigData) ? dgigData : null,
        paintableWallSF,
      }),
    );
    setEditingWorkOrders({});
    // Work orders are built from data already in memory, so nothing else would prompt a write —
    // without this they would sit unsaved until the PM happened to touch something else.
    checkpoint();
  }

  function handleWorkOrderTextChange(trade: Trade, text: string) {
    setWorkOrders((prev) => prev.map((wo) => (wo.trade === trade ? { ...wo, text } : wo)));
  }

  function handleInspectionReportTextChange(value: string) {
    setDocuments((prev) => (prev ? { ...prev, inspectionReport: value } : prev));
  }

  function handleScopeDocumentTextChange(value: string) {
    setDocuments((prev) => (prev ? { ...prev, scopeDocument: value } : prev));
  }

  function handleClaimTextChange(field: keyof ClaimInfo, value: string) {
    setClaim((prev) => ({ ...prev, [field]: value }));
  }

  function handleClaimLossTypeChange(value: LossType) {
    // Category/class no longer auto-clear on a loss-type switch (round 12) — they're always visible
    // now, with their own explicit N/A option, so there's no "stale hidden value" concern the way
    // there was when they were only shown for WATER.
    setClaim((prev) => ({
      ...prev,
      lossType: value,
      /*
        Remediation is only offered on a Remediation loss, so switching away from one has to drop
        it. Left in place it would be a selected phase with no button to unselect it — the claim
        would route to an abatement step the PM could no longer see they had asked for.

        Category and class are deliberately NOT cleared here (round 12): they are always visible and
        have their own explicit N/A option, so there is no stale-hidden-value concern for them.
      */
      scopePhases: value === "REMEDIATION" ? prev.scopePhases : prev.scopePhases.filter((p) => p !== "REMEDIATION"),
    }));
  }

  // number | null — null is a real, explicit "N/A" choice now (round 12), not just "unanswered".
  function handleClaimCategoryChange(value: number | null) {
    setClaim((prev) => ({ ...prev, waterCategory: value }));
  }

  function handleClaimClassChange(value: number | null) {
    setClaim((prev) => ({ ...prev, waterClass: value }));
  }

  function handleClaimYearOfBuildingChange(value: string) {
    const n = Number.parseInt(value, 10);
    setClaim((prev) => ({ ...prev, yearOfBuilding: Number.isNaN(n) ? null : n }));
  }

  function handleClaimDateOfLossChange(value: string) {
    setClaim((prev) => ({ ...prev, dateOfLoss: value }));
  }

  function handleClaimDateTimeInspectedChange(value: string) {
    setClaim((prev) => ({ ...prev, dateTimeInspected: value }));
  }

  function handleScopeOnlyChange(value: boolean) {
    setClaim((prev) => ({ ...prev, scopeOnly: value }));
  }

  function handleScopePhaseToggle(value: ScopePhase) {
    setClaim((prev) => ({
      ...prev,
      scopePhases: prev.scopePhases.includes(value) ? prev.scopePhases.filter((p) => p !== value) : [...prev.scopePhases, value],
    }));
  }

  function handleContentsHoursChange(field: "onSiteManipulationHours" | "packOutHours" | "packBackHours", value: string) {
    setContentsTM((prev) => ({ ...prev, [field]: value }));
  }

  function handleContentsConsumableChange(itemId: string, value: string) {
    setContentsTM((prev) => ({ ...prev, consumables: { ...prev.consumables, [itemId]: value } }));
  }

  function handleContentsTruckChargeChange(value: string) {
    setContentsTM((prev) => ({ ...prev, truckChargeCount: value }));
  }

  function handleContentsDisposalTypeChange(value: DisposalType | null) {
    setContentsTM((prev) => ({ ...prev, disposalType: value }));
  }

  function handleContentsOtherAdditionsChange(value: string) {
    setContentsTM((prev) => ({ ...prev, otherAdditions: value }));
  }

  function handleAddBricABracRoom() {
    setBricABrac((prev) => ({ ...prev, rooms: [...prev.rooms, emptyBricABracRoom(newRoomId())] }));
  }

  function handleRemoveBricABracRoom(id: string) {
    setBricABrac((prev) => ({ ...prev, rooms: prev.rooms.filter((r) => r.id !== id) }));
  }

  function updateBricABracRoom(id: string, patch: Partial<BricABracData["rooms"][number]>) {
    setBricABrac((prev) => ({ ...prev, rooms: prev.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }

  function handleBricABracRoomNameChange(id: string, value: string) {
    updateBricABracRoom(id, { roomName: value });
  }

  function handleBricABracRoomSizeChange(id: string, value: ContentSize) {
    updateBricABracRoom(id, { contentSize: value });
  }

  function handleBricABracRoomItemsChange(id: string, value: string) {
    updateBricABracRoom(id, { unboxableItems: value });
  }

  function handleBricABracRoomBoxChange(id: string, itemId: string, value: string) {
    setBricABrac((prev) => ({
      ...prev,
      rooms: prev.rooms.map((r) => (r.id === id ? { ...r, boxes: { ...r.boxes, [itemId]: value } } : r)),
    }));
  }

  function handleBricABracRoomOtherConsumablesChange(id: string, value: string) {
    updateBricABracRoom(id, { otherConsumables: value });
  }

  function handleBricABracRoomBlanketsChange(id: string, value: string) {
    updateBricABracRoom(id, { movingBlankets: value });
  }

  function handleBricABracNonRestorableChange(value: string) {
    setBricABrac((prev) => ({ ...prev, nonRestorableCount: value }));
  }

  function handleBricABracTruckChargeChange(value: string) {
    setBricABrac((prev) => ({ ...prev, truckChargeCount: value }));
  }

  function handleBricABracDisposalTypeChange(value: DisposalType | null) {
    setBricABrac((prev) => ({ ...prev, disposalType: value }));
  }

  /** The first time cleaning is turned on, pre-fill the individual-items list from every room's unboxable-items list — per the plan to reuse that list instead of asking the PM to type the same items twice. Never overwrites text they've already entered/edited. */
  function handleToggleCleaningContent(value: boolean) {
    setBricABrac((prev) => {
      const shouldPrefill = value && prev.cleaning.individualItemsText.trim() === "";
      const individualItemsText = shouldPrefill ? prev.rooms.flatMap((r) => listLines(r.unboxableItems)).join("\n") : prev.cleaning.individualItemsText;
      return { ...prev, cleaning: { ...prev.cleaning, isCleaningContent: value, individualItemsText } };
    });
  }

  function handleToggleBoxCleaning(value: boolean) {
    setBricABrac((prev) => ({
      ...prev,
      cleaning: {
        ...prev.cleaning,
        isCleaningBoxes: value,
        boxEntries: value && prev.cleaning.boxEntries.length === 0 ? [emptyBoxCleaningEntry(newId())] : prev.cleaning.boxEntries,
      },
    }));
  }

  function handleAddBoxEntry() {
    setBricABrac((prev) => ({ ...prev, cleaning: { ...prev.cleaning, boxEntries: [...prev.cleaning.boxEntries, emptyBoxCleaningEntry(newId())] } }));
  }

  function handleRemoveBoxEntry(id: string) {
    setBricABrac((prev) => ({ ...prev, cleaning: { ...prev.cleaning, boxEntries: prev.cleaning.boxEntries.filter((e) => e.id !== id) } }));
  }

  function updateBoxEntry(id: string, patch: Partial<BoxCleaningEntry>) {
    setBricABrac((prev) => ({
      ...prev,
      cleaning: { ...prev.cleaning, boxEntries: prev.cleaning.boxEntries.map((e) => (e.id === id ? { ...e, ...patch } : e)) },
    }));
  }

  function handleBoxEntryFamilyChange(id: string, value: BoxCleanFamily) {
    updateBoxEntry(id, { family: value });
  }

  function handleBoxEntrySizeChange(id: string, value: BoxCleanSize) {
    updateBoxEntry(id, { size: value });
  }

  function handleBoxEntryCountChange(id: string, value: string) {
    updateBoxEntry(id, { count: value });
  }

  function handleBoxEntryIntensityChange(id: string, value: CleanIntensity) {
    updateBoxEntry(id, { intensity: value });
  }

  function handleBoxEntryDensityChange(id: string, value: Density) {
    updateBoxEntry(id, { density: value });
  }

  function handleIndividualItemsChange(value: string) {
    setBricABrac((prev) => ({ ...prev, cleaning: { ...prev.cleaning, individualItemsText: value } }));
  }

  function handleDGIGGeneralHoursChange(field: "pmInspectionHours" | "travelHours" | "equipmentMonitoringHours", value: string) {
    setDgigData((prev) => ({ ...prev, [field]: value }));
  }

  function handleDGIGDisposalTypeChange(value: DisposalType | null) {
    setDgigData((prev) => ({ ...prev, disposalType: value }));
  }

  function handleAddDGIGRoom() {
    setDgigData((prev) => ({ ...prev, rooms: [...prev.rooms, emptyDGIGRoom(newDGIGRoomId())] }));
  }

  function handleRemoveDGIGRoom(id: string) {
    setDgigData((prev) => ({ ...prev, rooms: prev.rooms.filter((r) => r.id !== id) }));
  }

  function updateDGIGRoom(id: string, patch: Partial<DGIGData["rooms"][number]>) {
    setDgigData((prev) => ({ ...prev, rooms: prev.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }

  function handleDGIGRoomNameChange(id: string, value: string) {
    updateDGIGRoom(id, { roomName: value });
  }

  function handleDGIGRoomTearOutHoursChange(id: string, value: string) {
    updateDGIGRoom(id, { tearOutHours: value });
  }

  function handleDGIGRoomTearOutDescriptionChange(id: string, value: string) {
    updateDGIGRoom(id, { tearOutDescription: value });
  }

  function handleDGIGRoomContentManipulationHoursChange(id: string, value: string) {
    updateDGIGRoom(id, { contentManipulationHours: value });
  }

  function handleDGIGRoomWaterExtractionHoursChange(id: string, value: string) {
    updateDGIGRoom(id, { waterExtractionHours: value });
  }

  function handleDGIGRoomCleaningHoursChange(id: string, value: string) {
    updateDGIGRoom(id, { cleaningHours: value });
  }

  function handleDGIGRoomDryingClassChange(id: string, value: DryingClass) {
    updateDGIGRoom(id, { dryingClass: value });
  }

  function handleDGIGRoomAntimicrobialChange(id: string, value: boolean) {
    updateDGIGRoom(id, { antimicrobial: value });
  }

  // Mutually exclusive, same convention as bric-a-brac's disposal-type single-select — an exact SF
  // number and the qualitative full/partial-floor extent are never both meaningfully set at once.
  function handleDGIGRoomAntimicrobialSFChange(id: string, value: string) {
    updateDGIGRoom(id, { antimicrobialSF: value, antimicrobialExtent: null });
  }

  function handleDGIGRoomAntimicrobialExtentChange(id: string, value: AntimicrobialExtent | null) {
    updateDGIGRoom(id, { antimicrobialExtent: value, antimicrobialSF: "" });
  }

  function handleDGIGRoomOtherNotesChange(id: string, value: string) {
    updateDGIGRoom(id, { otherNotes: value });
  }

  function handleContinueFromIntake() {
    // A Contents-only selection is a pure contents assignment — no rooms/structural damage to
    // dictate, so it skips the transcript/extraction/gap-check pipeline entirely and goes straight
    // to the contents form (see claimInfo.ts's `isContentsOnly` doc comment) — regardless of
    // insurer, DGIG included, since there's no structural scope for DGIG's rules to apply to.
    // A DGIG claim with any structural scope selected fills in its Emergency form FIRST, before any
    // transcript — see dgig.ts's file doc comment and handleContinueFromDGIGForm below.
    // Contents and Remediation both have nothing to dictate — see `skipsTranscriptPipeline`. Where
    // both are selected, Contents comes first and hands on to Remediation.
    if (skipsTranscriptPipeline(claim)) {
      setStep(claim.scopePhases.includes("CONTENTS") ? "contents" : "remediation");
      return;
    }
    setStep(isDGIG(claim.insurer) ? "dgig" : "transcript");
    // Intake complete — the point a claim first becomes worth resuming.
    checkpoint();
  }

  /**
   * Runs extraction on `sourceText` — either the dictated transcript (handleGenerate) or the
   * synthetic one built from a DGIG claim's tear-out descriptions (handleContinueFromDGIGForm).
   * `onFailureStep` is where to land the user back on if the call fails, since the two callers came
   * from different steps.
   */
  async function runExtraction(sourceText: string, onFailureStep: Step) {
    setError(null);
    setStep("extracting");
    try {
      const result = await postJson<{ extraction: WaterLossExtraction }>("/api/extract", { transcript: sourceText });
      // yearOfBuilding is the one intake field that also has to reach extraction.loss (drives
      // asbestosTestingRequired) — see claimInfo.ts's applyClaimYearOfBuilding doc comment.
      const extractionWithYear = applyClaimYearOfBuilding(claim, result.extraction);
      const questions = nextQuestions(claim, extractionWithYear, equipmentSuggestions);
      setExtraction(extractionWithYear);
      setAnswers({});
      setStep(questions.length === 0 ? "ready" : "questions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed unexpectedly.");
      setStep(onFailureStep);
    }
  }

  function handleGenerate() {
    runExtraction(transcript, "transcript");
  }

  /**
   * From the "dgig" step (round 11): the per-room "what was torn out" text IS the transcript for a
   * DGIG claim — see dgig.ts's buildDGIGSyntheticTranscript and this file's doc comment on the
   * DGIGData import. If no room has any tear-out described at all, there's genuinely nothing for
   * extraction to work from (same reasoning as CONTENTS mode never calling /api/extract with
   * nothing to extract) — skip straight to "ready" with an empty, room-less extraction rather than
   * calling the API with blank input.
   */
  function handleContinueFromDGIGForm() {
    const synthetic = buildDGIGSyntheticTranscript(dgigData);
    setTranscript(synthetic);
    if (synthetic.trim() === "") {
      const empty = applyClaimYearOfBuilding(claim, withDerivedFields({ loss: emptyLoss(), rooms: [] }));
      setExtraction(empty);
      setAnswers({});
      setStep("ready");
    } else {
      runExtraction(synthetic, "dgig");
    }
  }

  function handleAnswerChange(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  /*
    Commits the draft `resolveRound` has already built from what is on screen.

    Nothing is applied here that was not already applied to produce the list the PM is looking at —
    which is what makes the screen an honest preview of what pressing this does. `round.questions`
    being empty is the same completeness test as before; it is just already computed.
  */
  function handleContinue() {
    if (!extraction || !round) return;

    /*
      Retire every suggestion answered in this round, so it cannot come back.

      Read off `round.applied` — the questions the draft actually consumed — not off the open list,
      which by definition no longer contains anything that was answered. A suggestion whose question
      stopped being asked part-way through editing is not retired either, since its answer was never
      folded in.
    */
    const retiring = round.applied
      .map(equipmentSuggestionKey)
      .filter((key): key is string => key !== null);
    if (retiring.length > 0) setResolvedSuggestions((prev) => [...new Set([...prev, ...retiring])]);

    // Recorded before the answers are cleared, since clearing them is what loses this.
    setQuestionLog((prev) => [
      ...prev,
      ...recordRound(prev.length === 0 ? 1 : prev[prev.length - 1]!.round + 1, round.display, round.applied, answers),
    ]);

    setClaim(round.claim);
    setExtraction(round.extraction);
    setAnswers({});
    if (round.questions.length === 0) setStep("ready");
    /*
      Every round, not only the last. A claim abandoned mid-gap-check has to be exactly as resumable
      as a finished one, and that means each committed round is written before the next begins.
    */
    checkpoint();
  }

  /** From the "ready" step: separate Contents needs its form filled in first (it appends to whatever this generates), everyone else generates directly. A DGIG claim's Emergency form already happened, first thing after intake — nothing left to collect at this point. */
  function handleContinueFromReady() {
    /*
      Contents first when both are selected, then Remediation, then generate.

      `contentsScopeTiming === "NOW"` routes here too, without Contents having been selected at
      intake. That is the whole point of asking: a PM who discovers mid-walkthrough that a pack-out
      is involved should be able to finish the whole claim in one sitting rather than having to go
      back and re-scope it. Answering "later" skips this and leaves the claim owing a contents
      scope, which the claims list shows.
    */
    if (hasSeparateContents(claim) || claim.contentsScopeTiming === "NOW") setStep("contents");
    else if (hasRemediation(claim)) setStep("remediation");
    else handleGenerateDocuments();
  }

  /**
   * The abatement section, or "" when the form is empty.
   *
   * The sample count is READ from the claim's existing asbestos field rather than re-asked in the
   * form — see `AsbestosScopeContext`. One building fact, one place to record it.
   */
  function buildAsbestosSection(): string {
    if (!hasAsbestosContent(asbestos)) return "";
    const room = asbestos.sketchRoomId ? (sketch.rooms.find((r) => r.id === asbestos.sketchRoomId) ?? null) : null;
    return buildAsbestosScopeSection(asbestos, {
      sampleCount: extraction?.loss.asbestosSampleCount ?? null,
      sketchRoom: room,
      roomName: room?.name.trim() || null,
    });
  }

  async function handleGenerateDocuments() {
    if (!extraction) return;
    setError(null);
    setStep("generating");
    try {
      const contentsAssignmentNote = buildContentsAssignmentNote(claim, contentsApproach, bricABrac);
      // Only sent once the DGIG form actually has content in it — see dgig.ts's hasDGIGContent doc
      // comment for why an empty form falls back to the standard derivation instead of an empty
      // Emergency/Repair section.
      const dgigPayload = isDGIG(claim.insurer) && hasDGIGContent(dgigData) ? dgigData : null;
      const result = await postJson<{ documents: GeneratedDocuments }>("/api/generate", { claim, extraction, transcript, contentsAssignmentNote, dgigData: dgigPayload });
      const documents = result.documents;
      // Contents alongside structural scope: Claude generates the structural Emergency/Repair scope
      // only (see documentGenerationPrompt.ts's SCOPE_PHASE_RULES) — the Contents section is
      // appended here, client-side, same reasoning as a Contents-only claim never calling Claude at all.
      if (hasSeparateContents(claim)) {
        const contentsSection = buildContentsSection(contentsApproach, contentsTM, bricABrac);
        if (contentsSection) {
          documents.scopeDocument = `${documents.scopeDocument}\n\n${contentsSection}`;
        }
      }
      // Asbestos abatement, appended the same way and for the same reason — it is calculated
      // from the form rather than generated, so it goes on after the model's structural scope
      // instead of being asked of it.
      const asbestosSection = buildAsbestosSection();
      if (asbestosSection) {
        documents.scopeDocument = `${documents.scopeDocument}

${asbestosSection}`;
      }
      setDocuments(documents);
      setStep("results");
      checkpoint();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document generation failed unexpectedly.");
      // Return to whichever step actually triggered this call: "contents" when Contents is selected
      // alongside structural scope (always the last stop before generating), else "ready" directly —
      // a DGIG claim's Emergency form already happened earlier in the flow, so "ready" is correct
      // for it too.
      setStep(hasSeparateContents(claim) ? "contents" : "ready");
    }
  }

  /**
   * The whole document for a claim with no structural scope — Contents, Remediation, or both.
   *
   * No Claude call anywhere in this path, for the reason claimInfo.ts's `isContentsOnly` gives and
   * lib/asbestos.ts repeats: every figure is typed or arithmetic on what was typed. Composed from
   * whichever sections were actually selected rather than special-cased per combination, so
   * Contents + Remediation produces both without a third builder.
   */
  function handleNonStructuralGenerate() {
    if (isContentsOnly(claim)) {
      setDocuments({ scopeDocument: buildContentsOnlyDocument(contentsApproach, claim, contentsTM, bricABrac) });
      setStep("results");
      checkpoint();
      return;
    }
    const parts = [buildScopeDocumentHeaderLines(claim).join("\n")];
    if (claim.scopePhases.includes("CONTENTS")) {
      const contents = buildContentsSection(contentsApproach, contentsTM, bricABrac);
      if (contents) parts.push(contents);
    }
    const asbestos = buildAsbestosSection();
    if (asbestos) parts.push(asbestos);
    setDocuments({ scopeDocument: parts.join("\n\n") });
    setStep("results");
    checkpoint();
  }

  function handleContentsContinue() {
    if (hasRemediation(claim)) {
      setStep("remediation");
    } else if (hasStructuralScope(claim)) {
      handleGenerateDocuments();
    } else {
      handleNonStructuralGenerate();
    }
  }

  /** The last stop when Remediation is selected: generate from here, whatever else was chosen. */
  function handleRemediationContinue() {
    // The asbestos intake is complete at this point — classification, containment and the
    // quantities derived from them — so it is written before the generation call rather than after.
    checkpoint();
    if (hasStructuralScope(claim)) handleGenerateDocuments();
    else handleNonStructuralGenerate();
  }

  return (
    <main>
      <h1>Scope Assistant</h1>
      <p className="subtitle">Fill in the claim, paste a walkthrough transcript, answer a few follow-up questions, and get an inspection report and scope document.</p>

      {error && <div className="error-banner">{error}</div>}
      {persistence.loadError && <div className="error-banner">{persistence.loadError}</div>}

      {/*
        Whether the work is safe, said plainly.

        A claim that saves itself silently asks the PM to trust that it did, and the moment that
        trust is wrong is the moment they have already closed the tab. "Saving…" and "Saved" cost a
        line; a failure that nobody noticed costs the claim. The error state deliberately does not
        offer a retry button — the next edit retries on its own, and a button implying otherwise
        would suggest the work is lost until it is pressed.
      */}
      {persistence.status !== "idle" && (
        <p className={`save-status${persistence.status === "error" ? " save-status-error" : ""}`}>
          {persistence.status === "saving" && "Saving…"}
          {persistence.status === "saved" && "Saved — you can pick this up on another device from Claims."}
          {persistence.status === "error" && "Could not save. Your work is still on screen; the next change will try again."}
        </p>
      )}

      {/*
        The sketch. Rendered outside the step conditionals on purpose — it's an independent optional
        action available from claim creation onward, not a stage in the pipeline, so it neither
        advances `step` nor waits for one.
      */}
      {showSketch ? (
        <SketchEditor
          sketch={sketch}
          knownRoomNames={sketchRoomNames}
          moisture={moisture}
          statedEquipment={statedEquipment}
          onResolveEquipment={handleResolveEquipment}
          onMoistureChange={setMoisture}
          onChange={setSketch}
          startReadOnly={sketchOpensReadOnly}
          onClose={() => {
            setShowSketch(false);
            /*
              Closing the sketch is a checkpoint of its own.

              Geometry and moisture readings already save as they are drawn — the debounce sees every
              change — but a drawing session ends here, and a PM who has just spent ten minutes on a
              floor plan should not be relying on a timer for it. This is also the moment the whole
              sketch is definitely complete rather than mid-drag.
            */
            checkpoint();
          }}
        />
      ) : (
        <div className="sketch-launch">
          {hasSketchContent(sketch) ? (
            /*
              View and Edit as separate doors, with View first.

              A finished sketch is looked at far more often than it is changed, and every look used
              to open an edit session — where a stray drag on a phone moves a room and nothing says
              it happened. The geometry decides quantities the scope is built from, so a silent nudge
              is a silent change to a number on a document. Editing is still one tap; it is just no
              longer the only tap.
            */
            <>
              <button className="btn-secondary" onClick={() => openSketch(true)}>
                View sketch ({sketch.rooms.length} room{sketch.rooms.length === 1 ? "" : "s"})
              </button>
              <button className="btn-secondary" onClick={() => openSketch(false)}>
                Edit sketch
              </button>
            </>
          ) : (
            // Primary, because on an empty claim this IS the action — it was a quiet secondary
            // button that read as one option among several, and was reported as easy to miss.
            <button className="btn-primary" onClick={() => openSketch(false)}>
              Create sketch
            </button>
          )}
          <span className="field-note">Optional — draw the affected rooms and their measurements.</span>
        </div>
      )}

      {step === "intake" && (
        <div className="card">
          <StepHeader step={step} label="Claim Info" />
          <h2>Claim details</h2>
          <ClaimIntakeForm
            claim={claim}
            onTextChange={handleClaimTextChange}
            onLossTypeChange={handleClaimLossTypeChange}
            onCategoryChange={handleClaimCategoryChange}
            onClassChange={handleClaimClassChange}
            onYearOfBuildingChange={handleClaimYearOfBuildingChange}
            onDateOfLossChange={handleClaimDateOfLossChange}
            onDateTimeInspectedChange={handleClaimDateTimeInspectedChange}
            onScopeOnlyChange={handleScopeOnlyChange}
            onScopePhaseToggle={handleScopePhaseToggle}
          />
          <div className="actions-row">
            <button className="btn-primary" onClick={handleContinueFromIntake} disabled={!isClaimIdentityComplete(claim)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "dgig" && (
        <div className="card">
          <StepHeader step={step} label="DGIG Scope" />
          <h2>Emergency scope details</h2>
          <p className="subtitle" style={{ marginBottom: 20 }}>
            This insurer bills Emergency work in labor hours rather than the usual item-based scope, so it comes first — before anything else, no dictation needed. Everything below is optional; skip whatever doesn’t apply. What you enter under “What was torn out” for each room also becomes the basis for that room’s repair scope — you’ll get a few follow-up questions about it next (baseboard height, material, and the like), the same way a dictated transcript works elsewhere in this app.
          </p>
          <DGIGForm
            data={dgigData}
            onGeneralHoursChange={handleDGIGGeneralHoursChange}
            onDisposalTypeChange={handleDGIGDisposalTypeChange}
            onAddRoom={handleAddDGIGRoom}
            onRemoveRoom={handleRemoveDGIGRoom}
            onRoomNameChange={handleDGIGRoomNameChange}
            onRoomTearOutHoursChange={handleDGIGRoomTearOutHoursChange}
            onRoomTearOutDescriptionChange={handleDGIGRoomTearOutDescriptionChange}
            onRoomContentManipulationHoursChange={handleDGIGRoomContentManipulationHoursChange}
            onRoomWaterExtractionHoursChange={handleDGIGRoomWaterExtractionHoursChange}
            onRoomCleaningHoursChange={handleDGIGRoomCleaningHoursChange}
            onRoomDryingClassChange={handleDGIGRoomDryingClassChange}
            onRoomAntimicrobialChange={handleDGIGRoomAntimicrobialChange}
            onRoomAntimicrobialSFChange={handleDGIGRoomAntimicrobialSFChange}
            onRoomAntimicrobialExtentChange={handleDGIGRoomAntimicrobialExtentChange}
            onRoomOtherNotesChange={handleDGIGRoomOtherNotesChange}
          />
          <div className="actions-row">
            <button className="btn-secondary" onClick={reset}>
              Start Over
            </button>
            <button className="btn-secondary" onClick={() => setStep("intake")}>
              Back
            </button>
            <button className="btn-primary" onClick={handleContinueFromDGIGForm}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "extracting" && isDGIG(claim.insurer) && (
        <div className="card">
          <StepHeader step={step} label="Repair Scope" />
          <h2>Reading the repair detail…</h2>
          <div className="loading-row">
            <span className="spinner" /> Extracting structured data with Claude…
          </div>
        </div>
      )}

      {(step === "transcript" || (step === "extracting" && !isDGIG(claim.insurer))) && (
        <div className="card">
          <StepHeader step={step} label="Transcript" />
          {hasSeparateContents(claim) && (
            <p className="field-note" style={{ marginBottom: 12 }}>
              This covers the emergency and repair scope only — no need to mention pack-out, pack-back, or other contents handling here. You’ll be asked about the contents assignment separately, right after this.
            </p>
          )}
          <textarea
            placeholder="Paste the dictated walkthrough transcript here…"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            disabled={step === "extracting"}
          />
          <div className="actions-row">
            {step === "extracting" && (
              <div className="loading-row">
                <span className="spinner" /> Extracting structured data with Claude…
              </div>
            )}
            <button className="btn-secondary" onClick={() => setStep("intake")} disabled={step === "extracting"}>
              Back
            </button>
            <button className="btn-primary" onClick={handleGenerate} disabled={step === "extracting" || transcript.trim() === ""}>
              Generate
            </button>
          </div>
        </div>
      )}

      {step === "questions" && (
        <div className="card">
          <StepHeader step={step} label="Follow-up Questions" />
          <h2>A few more details</h2>
          {isDGIG(claim.insurer) && (
            <p className="field-note" style={{ marginBottom: 12 }}>
              These are about the repair scope, based on what you entered for each room’s tear-out — Emergency is already covered by what you filled in on the previous step.
            </p>
          )}
          {groups.map((group) => (
            <QuestionGroup
              key={group.title}
              title={group.title}
              questions={group.questions}
              answers={answers}
              onChange={handleAnswerChange}
              /* Offered only where the sketch can actually measure the answer, and only once a
                 sketch exists to measure — see `sketchMeasureFor`. */
              canAddFromSketch={(q) => hasSketchContent(sketch) && sketchMeasureFor(q.id) !== null}
              onAddFromSketch={(q) => {
                const measure = sketchMeasureFor(q.id);
                if (measure) setMarkingQuestion({ question: q, measure });
              }}
              markedQuestionIds={Object.keys(scopeMarks)}
              applyToAllCount={(q) => siblingQuestionIds(q.id, currentQuestions).length}
              onApplyToAll={(q) => {
                /*
                  Copies this answer into the same question in every other room, as ordinary answers.

                  Written into `answers` rather than straight into the tree so each copy stays an
                  answer the PM can change — a property trimmed at one height throughout still has
                  the odd room that is not, and that room is a normal edit rather than an undo.
                */
                const value = answers[q.id] ?? q.defaultValue;
                if (value === undefined) return;
                const siblings = siblingQuestionIds(q.id, currentQuestions);
                if (siblings.length === 0) return;
                setAnswers((prev) => {
                  const next = { ...prev };
                  for (const id of siblings) next[id] = value;
                  return next;
                });
              }}
            />
          ))}
          {blockingQuestions.length > 0 && (
            /*
              Named, grouped by room, and clickable — the point is to end the hunt, so it scrolls to
              the question rather than just describing it. Only rendered while something is actually
              outstanding, so a completed round shows nothing rather than an empty reassurance.
            */
            <div className="blocking-questions" role="status" aria-live="polite">
              <p className="blocking-questions-title">
                {blockingQuestions.length === 1
                  ? "One question still needs an answer before you can continue:"
                  : `${blockingQuestions.length} questions still need answers before you can continue:`}
              </p>
              <ul>
                {blockingQuestions.map((q) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      className="blocking-question-link"
                      onClick={() => {
                        const el = document.getElementById(q.id) ?? document.querySelector(`[for="${CSS.escape(q.id)}"]`);
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        // Focusing a plain label does nothing, so highlight the whole question block
                        // instead — the row is what the PM is looking for, not the input alone.
                        const block = el?.closest(".question");
                        if (block) {
                          block.classList.add("question-flash");
                          setTimeout(() => block.classList.remove("question-flash"), 1600);
                        }
                      }}
                    >
                      {q.roomName ? `${q.roomName} — ` : ""}
                      {q.prompt}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="actions-row">
            <button className="btn-secondary" onClick={reset}>
              Start Over
            </button>
            {/* Offered mid-flow on purpose: this gets exported to describe a problem while it is on
                screen, so it covers the current round as well as the submitted ones. */}
            <button className="btn-secondary" onClick={exportQuestionLog}>
              Export questions &amp; answers
            </button>
            <button className="btn-primary" onClick={handleContinue} disabled={!allAnswered}>
              Continue
            </button>
          </div>
        </div>
      )}

      {markingQuestion && (
        <ScopeMarkPicker
          sketch={sketch}
          measure={markingQuestion.measure}
          title={markingQuestion.question.prompt}
          initial={scopeMarkFor(scopeMarks, markingQuestion.question.id)}
          onCancel={() => setMarkingQuestion(null)}
          onUse={(mark: ScopeMark, value: string) => {
            // The marking is kept AND its total answers the question — one action, both outcomes.
            setScopeMarks((prev) => setScopeMark(prev, markingQuestion.question.id, mark));
            handleAnswerChange(markingQuestion.question.id, value);
            setMarkingQuestion(null);
          }}
        />
      )}

      {(step === "ready" || step === "generating") && extraction && (
        <div className="card">
          <StepHeader step={step} label="Follow-up Questions" />
          <h2>All details captured</h2>
          <p className="subtitle" style={{ marginBottom: 20 }}>
            {extraction.rooms.length === 0
              ? isDGIG(claim.insurer)
                ? "No rooms with repair-relevant tear-out were captured."
                : "No rooms were captured from the transcript."
              : `Captured ${extraction.rooms.length} room${extraction.rooms.length === 1 ? "" : "s"}: ${extraction.rooms.map((r) => r.roomName).join(", ")}.`}
            {" "}
            {hasSeparateContents(claim)
              ? "Next, the contents assignment details."
              : `Ready to generate the ${claim.scopeOnly ? "scope document" : "inspection report and scope document"}.`}
          </p>
          <div className="actions-row">
            <button className="btn-secondary" onClick={reset} disabled={step === "generating"}>
              Start Over
            </button>
            {/* Also here, where the whole session is complete — the natural point to keep a record
                of what was asked alongside the documents it produced. */}
            {hasQuestionLog(questionLog) && (
              <button className="btn-secondary" onClick={exportQuestionLog} disabled={step === "generating"}>
                Export questions &amp; answers
              </button>
            )}
            {step === "generating" && (
              <div className="loading-row">
                <span className="spinner" /> Generating documents with Claude…
              </div>
            )}
            <button className="btn-primary" onClick={handleContinueFromReady} disabled={step === "generating"}>
              {hasSeparateContents(claim) || hasRemediation(claim) ? "Continue" : "Generate Documents"}
            </button>
          </div>
        </div>
      )}

      {/*
        Remediation gets a step of its own rather than a card bolted onto another one.

        It is a phase now, selected at intake like Emergency or Repair, and a claim can be nothing
        but Remediation — in which case there is no transcript, no extraction and no "All details
        captured" step for a card to sit on. Its own step is the only arrangement that works for
        both the standalone case and the alongside-structural-work one.
      */}
      {step === "remediation" && (
        <div className="card">
          <StepHeader step={step} label="Remediation" />
          <h2>Asbestos abatement</h2>
          <p className="subtitle" style={{ marginBottom: 20 }}>
            Everything here is calculated from what you enter — no dictation and no AI. Skip anything that doesn&rsquo;t apply and it
            won&rsquo;t appear in the scope.
          </p>
          <AsbestosForm
            scope={asbestos}
            sketch={hasSketchContent(sketch) ? sketch : null}
            sampleCount={extraction?.loss.asbestosSampleCount ?? null}
            onChange={setAsbestos}
          />
          <div className="actions-row">
            <button className="btn-secondary" onClick={reset}>
              Start Over
            </button>
            <button className="btn-primary" onClick={handleRemediationContinue}>
              {hasStructuralScope(claim) ? "Generate Documents" : "Generate Scope Document"}
            </button>
          </div>
        </div>
      )}

      {step === "contents" && (
        <div className="card">
          <StepHeader step={step} label="Contents" />
          <h2>Contents assignment</h2>
          <p className="subtitle" style={{ marginBottom: 20 }}>
            Everything here is optional — skip anything that doesn’t apply and it won’t appear in the scope.
          </p>

          <div className="question">
            <label className="prompt">How do you want to scope contents?</label>
            <div className="option-group" role="radiogroup" aria-label="Contents approach">
              <button type="button" className={`option-btn${contentsApproach === "TM" ? " selected" : ""}`} aria-pressed={contentsApproach === "TM"} onClick={() => setContentsApproach("TM")}>
                Time &amp; Material
              </button>
              <button
                type="button"
                className={`option-btn${contentsApproach === "BRIC_A_BRAC" ? " selected" : ""}`}
                aria-pressed={contentsApproach === "BRIC_A_BRAC"}
                onClick={() => setContentsApproach("BRIC_A_BRAC")}
              >
                Bric-a-Brac
              </button>
            </div>
            {isTD(claim.insurer) && <p className="field-note">This insurer (TD) requires adjuster approval for a Time &amp; Material contents approach — you can still select it, approval is just something to line up separately.</p>}
          </div>
          <h3 className="intake-subheading">{contentsApproach === "TM" ? "Time & Material" : "Bric-a-Brac"}</h3>

          {contentsApproach === "TM" ? (
            <ContentsForm
              tm={contentsTM}
              onHoursChange={handleContentsHoursChange}
              onConsumableChange={handleContentsConsumableChange}
              onTruckChargeChange={handleContentsTruckChargeChange}
              onDisposalTypeChange={handleContentsDisposalTypeChange}
              onOtherAdditionsChange={handleContentsOtherAdditionsChange}
            />
          ) : (
            <BricABracForm
              data={bricABrac}
              onAddRoom={handleAddBricABracRoom}
              onRemoveRoom={handleRemoveBricABracRoom}
              onRoomNameChange={handleBricABracRoomNameChange}
              onRoomSizeChange={handleBricABracRoomSizeChange}
              onRoomItemsChange={handleBricABracRoomItemsChange}
              onRoomBoxChange={handleBricABracRoomBoxChange}
              onRoomOtherConsumablesChange={handleBricABracRoomOtherConsumablesChange}
              onRoomBlanketsChange={handleBricABracRoomBlanketsChange}
              onToggleCleaning={handleToggleCleaningContent}
              onToggleBoxCleaning={handleToggleBoxCleaning}
              onAddBoxEntry={handleAddBoxEntry}
              onRemoveBoxEntry={handleRemoveBoxEntry}
              onBoxEntryFamilyChange={handleBoxEntryFamilyChange}
              onBoxEntrySizeChange={handleBoxEntrySizeChange}
              onBoxEntryCountChange={handleBoxEntryCountChange}
              onBoxEntryIntensityChange={handleBoxEntryIntensityChange}
              onBoxEntryDensityChange={handleBoxEntryDensityChange}
              onIndividualItemsChange={handleIndividualItemsChange}
              onNonRestorableChange={handleBricABracNonRestorableChange}
              onTruckChargeChange={handleBricABracTruckChargeChange}
              onDisposalTypeChange={handleBricABracDisposalTypeChange}
            />
          )}

          <div className="actions-row">
            {/* No disabled-while-submitting state needed here — the moment a generate request starts,
                handleGenerateDocuments/handleNonStructuralGenerate move `step` off "contents" entirely
                (to "generating" or "results"), so this block is never rendered while one is in flight. */}
            <button className="btn-secondary" onClick={reset}>
              Start Over
            </button>
            <button className="btn-primary" onClick={handleContentsContinue}>
              {hasRemediation(claim)
                ? "Continue"
                : hasStructuralScope(claim)
                  ? "Generate Documents"
                  : "Generate Scope Document"}
            </button>
          </div>
        </div>
      )}

      {step === "results" && documents && (
        <div className="card">
          <StepHeader step={step} label="Documents" />
          {documents.inspectionReport && (
            <div className="document-block">
              <div className="document-block-header">
                <h2>Inspection Report</h2>
                <SketchAttachmentToggle
                  available={sketchRenders}
                  selection={sketchAttachments}
              thumbnails={thumbnails}
                  target={{ kind: "inspectionReport" }}
                  onChange={setSketchAttachments}
                />
                <div className="document-actions">
                  <button className="btn-secondary" onClick={() => setIsEditingInspectionReport((v) => !v)}>
                    {isEditingInspectionReport ? "Save" : "Edit"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      downloadDocumentPdf({
                        docLabel: "Inspection Report",
                        bodyText: documents.inspectionReport ?? "",
                        jobNumber: claim.jobNumber,
                        customerName: claim.customerName,
                        documentTitle: "Initial Site Report",
                        jobInformation: buildJobInformationGroups(claim),
                        sketchImages: sketchPagesFor({ kind: "inspectionReport" }),
                      })
                    }
                  >
                    Download PDF
                  </button>
                </div>
              </div>
              <LetterheadBanner />
              <div className="document-paper">
                <div className="document-title">Initial Site Report</div>
                <JobInformationSection claim={claim} />
              </div>
              {isEditingInspectionReport ? (
                <textarea
                  className="document-edit-textarea"
                  value={documents.inspectionReport}
                  onChange={(e) => handleInspectionReportTextChange(e.target.value)}
                />
              ) : (
                <pre>{documents.inspectionReport}</pre>
              )}
            </div>
          )}
          <div className="document-block">
            <div className="document-block-header">
              <h2>Scope Document</h2>
              <SketchAttachmentToggle
                available={sketchRenders}
                selection={sketchAttachments}
              thumbnails={thumbnails}
                target={{ kind: "scopeDocument" }}
                onChange={setSketchAttachments}
              />
              <div className="document-actions">
                <button className="btn-secondary" onClick={() => setIsEditingScopeDocument((v) => !v)}>
                  {isEditingScopeDocument ? "Save" : "Edit"}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    downloadDocumentPdf({
                      docLabel: "Scope Document",
                      bodyText: documents.scopeDocument,
                      jobNumber: claim.jobNumber,
                      customerName: claim.customerName,
                      sketchImages: sketchPagesFor({ kind: "scopeDocument" }),
                    })
                  }
                >
                  Download PDF
                </button>
                {/*
                  The plan as a separate image file, next to the document it belongs with.

                  A sketch page inside a PDF is something to read; Xactimate needs something to trace
                  under, and that has to be an image file it can import. Same drawing, second format.
                */}
                {sketchRenders.includes("clean") && (
                  <button className="btn-secondary" onClick={() => void downloadSketchJpeg("clean")} title="For tracing as an Xactimate underlay">
                    Sketch JPG
                  </button>
                )}
              </div>
            </div>
            <LetterheadBanner />
            {isEditingScopeDocument ? (
              <textarea className="document-edit-textarea" value={documents.scopeDocument} onChange={(e) => handleScopeDocumentTextChange(e.target.value)} />
            ) : (
              <pre>{documents.scopeDocument}</pre>
            )}
          </div>
          {/*
            No Start Over here.

            Reported as easy to hit by accident, sitting alone under a finished set of documents —
            and there is nothing it does that anybody wants at that moment. Clearing the screen was
            the only way to begin another claim back when nothing was saved; now a claim persists, so
            beginning another one is a navigation, and the finished one stays exactly where it is.

            Both of these are non-destructive by construction rather than by being careful. A mis-tap
            costs a page load.
          */}
          <div className="actions-row">
            <Link className="btn-secondary" href="/claims">
              All claims
            </Link>
            <Link className="btn-secondary" href="/claim">
              Start another claim
            </Link>
          </div>
        </div>
      )}

      {/* Work orders — offered only once the documents above exist, since they're built from the
          same completed data. Optional: a claim is finished without them. */}
      {step === "results" && documents && (
        <>
          <WorkOrderSelector
            available={availableTrades(claim, contentsApproach)}
            selected={selectedTrades}
            unavailableNote={unavailableTradeNote(claim, contentsApproach)}
            onToggle={handleToggleTrade}
            onGenerate={handleGenerateWorkOrders}
          />

          {/* Emails whatever exists right now — including any work orders generated above, and any
              edits made to them, since these read the same live state the PDF buttons do. */}
          <SendDocumentsPanel
            senderName={claim.pmName}
            documents={[
              ...(documents.inspectionReport
                ? [
                    {
                      label: "Inspection Report",
                      pdf: {
                        docLabel: "Inspection Report",
                        bodyText: documents.inspectionReport,
                        jobNumber: claim.jobNumber,
                        customerName: claim.customerName,
                        documentTitle: "Initial Site Report",
                        jobInformation: buildJobInformationGroups(claim),
                        sketchImages: sketchPagesFor({ kind: "inspectionReport" }),
                      },
                    } satisfies SendableDocument,
                  ]
                : []),
              {
                label: "Scope Document",
                pdf: {
                  docLabel: "Scope Document",
                  bodyText: documents.scopeDocument,
                  jobNumber: claim.jobNumber,
                  customerName: claim.customerName,
                  sketchImages: sketchPagesFor({ kind: "scopeDocument" }),
                },
              } satisfies SendableDocument,
              ...workOrders.map(
                (wo) =>
                  ({
                    label: wo.label,
                    pdf: {
                      docLabel: `Work Order — ${wo.label}`,
                      bodyText: wo.text,
                      jobNumber: claim.jobNumber,
                      customerName: claim.customerName,
                      sketchImages: sketchPagesFor({ kind: "workOrder", trade: wo.trade }),
                    },
                  }) satisfies SendableDocument,
              ),
              /* Ticked like everything else. The estimator needs the image file, not a page of a
                 PDF, and a supplementary attachment nobody remembers to tick never arrives. */
              ...(sketchRenders.includes("clean")
                ? [{ label: "Sketch (JPG)", file: () => buildSketchJpeg("clean") } satisfies SendableDocument]
                : []),
            ]}
          />

          {workOrders.map((wo) => (
            <div className="card" key={wo.trade}>
              <div className="document-block">
                <div className="document-block-header">
                  <h2>{wo.label}</h2>
                  <SketchAttachmentToggle
                    available={sketchRenders}
                    selection={sketchAttachments}
              thumbnails={thumbnails}
                    target={{ kind: "workOrder", trade: wo.trade }}
                    onChange={setSketchAttachments}
                  />
                  <div className="document-actions">
                    <button className="btn-secondary" onClick={() => setEditingWorkOrders((prev) => ({ ...prev, [wo.trade]: !prev[wo.trade] }))}>
                      {editingWorkOrders[wo.trade] ? "Save" : "Edit"}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        downloadDocumentPdf({
                          docLabel: `Work Order — ${wo.label}`,
                          bodyText: wo.text,
                          jobNumber: claim.jobNumber,
                          customerName: claim.customerName,
                          sketchImages: sketchPagesFor({ kind: "workOrder", trade: wo.trade }),
                        })
                      }
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
                <LetterheadBanner />
                {editingWorkOrders[wo.trade] ? (
                  <textarea className="document-edit-textarea" value={wo.text} onChange={(e) => handleWorkOrderTextChange(wo.trade, e.target.value)} />
                ) : (
                  <pre>{wo.text}</pre>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
