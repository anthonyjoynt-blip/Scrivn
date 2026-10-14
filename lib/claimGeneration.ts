import { carryAnswers, carriedSuggestions } from "./answerCarryOver";
import { buildAsbestosScopeSection } from "./asbestosScope";
import { hasAsbestosContent } from "./asbestos";
import { buildBricABracScopeSection, type BricABracData } from "./bricABrac";
import { applyClaimYearOfBuilding, hasSeparateContents, type ClaimInfo } from "./claimInfo";
import type { SavedClaimState } from "./claimState";
import { buildContentsScopeSection, type ContentsTM } from "./contentsTM";
import { hasDGIGContent } from "./dgig";
import { claimEquipment, DEFAULT_EQUIPMENT_SETTINGS } from "./equipment";
import { exteriorScopeLines } from "./exterior";
import { type EquipmentSuggestions, normaliseRoomName, withoutResolvedSuggestions } from "./gapCheck";
import { isDGIG } from "./insurers";
import { roomMoistureSummary, type MoistureMap } from "./moisture";
import { nextQuestions, resolveRound } from "./questionRound";
import { notePrints, noteTime, photoNotes, photoNotesText } from "./photos";
import type { Sketch } from "./sketch";
import { roomAreasForEstimate } from "./sketchQuantities";
import type { GeneratedDocuments, WaterLossExtraction } from "./types";
import type { ContentsApproach } from "./workOrders";

/**
 * What the two Claude steps send, and what their answers do to a claim — as functions of the claim
 * alone (2026-10-13, offline mode).
 *
 * These lived inside the claim page, built from its state at the moment Generate was pressed. A step
 * that waits for signal cannot work that way: it runs minutes or hours later, possibly with the claim
 * no longer on screen, so it must build its request from the claim as it stands THEN and fold the
 * answer into the claim as it stands then. The page uses the same functions, so the two routes to a
 * document are one route.
 */

/** Dispatches to whichever contents approach is active — see contentsTM.ts / bricABrac.ts. */
export function buildContentsSection(approach: ContentsApproach, contentsTM: ContentsTM, bricABrac: BricABracData): string {
  return approach === "TM" ? buildContentsScopeSection(contentsTM) : buildBricABracScopeSection(bricABrac);
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
export function buildContentsAssignmentNote(claim: ClaimInfo, contentsApproach: ContentsApproach, bricABrac: BricABracData): string | null {
  if (!hasSeparateContents(claim)) return null;
  const isProcessing = contentsApproach === "BRIC_A_BRAC" && (Number.parseFloat(bricABrac.nonRestorableCount) > 0 || bricABrac.cleaning.isCleaningContent);
  return isProcessing
    ? "A separate contents assignment is required to pack out and pack back the contents, including processing of non-restorable and/or cleaned items."
    : "A separate contents assignment is required to pack out and pack back the contents.";
}

/**
 * The abatement section, or "" when the form is empty.
 *
 * The sample count is READ from the claim's existing asbestos field rather than re-asked in the
 * form — see `AsbestosScopeContext`. One building fact, one place to record it.
 */
export function buildAsbestosSection(state: Pick<SavedClaimState, "asbestos" | "sketch" | "extraction">): string {
  if (!hasAsbestosContent(state.asbestos)) return "";
  const room = state.asbestos.sketchRoomId ? (state.sketch.rooms.find((r) => r.id === state.asbestos.sketchRoomId) ?? null) : null;
  return buildAsbestosScopeSection(state.asbestos, {
    sampleCount: state.extraction?.loss.asbestosSampleCount ?? null,
    sketchRoom: room,
    roomName: room?.name.trim() || null,
  });
}

/**
 * Equipment counts the moisture map suggests, for gap-check to compare a stated count against.
 *
 * Undefined — not an empty object — when there is no map, so the confirm-or-suggest question is
 * never constructed rather than merely never matching. A claim without moisture mapping goes
 * through gap-check exactly as it did before this existed.
 */
export function equipmentSuggestionsFor(sketch: Sketch, moisture: MoistureMap, resolvedSuggestions: string[]): EquipmentSuggestions | undefined {
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
      wallRunFeet: measured ? measured.readings.reduce((sum, r) => sum + (r.affectedLengthFeet ?? 0), 0) || null : null,
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
}

/**
 * The photo notes the scope step reads, built from the photos as they are at this moment (2026-10-14):
 * one line per captioned photo — room, time, caption — and a print of each, which the claim keeps as
 * what this scope was made from (`photos.scopedNotes`), for "N new photo notes since the scope was
 * made". Built fresh every run and never copied into the transcript, so an edited or deleted caption
 * leaves nothing behind. See lib/photoNotesPrompt.ts for the rule the prompts carry with it.
 */
export function photoNotesFor(state: Pick<SavedClaimState, "photos" | "sketch">): { text: string; prints: string[] } {
  const notes = photoNotes(state.photos, state.sketch);
  return { text: photoNotesText(notes, noteTime), prints: notePrints(notes) };
}

/**
 * The body /api/extract is sent for this claim — the transcript (or `source`, the DGIG form's
 * tear-out text) and the photo notes — with the notes' prints, for `withExtraction`. Null when there
 * is nothing to read.
 */
export function extractionRequest(state: SavedClaimState, source = state.transcript): { body: { transcript: string; photoNotes?: string }; scopedNotes: string[] } | null {
  if (!source.trim()) return null;
  const notes = photoNotesFor(state);
  return { body: notes.text ? { transcript: source, photoNotes: notes.text } : { transcript: source }, scopedNotes: notes.prints };
}

/**
 * What a returned extraction does to the claim: the tree (with the intake's year of building on it,
 * which drives asbestosTestingRequired — see claimInfo.ts's applyClaimYearOfBuilding), a fresh set
 * of answers, the step — straight to Ready when the engine has nothing to ask — and which photo notes
 * it was made from (`scopedNotes`, as `extractionRequest` printed them when it was sent).
 *
 * A second read (Update scope, or an edited transcript read again) keeps the answers already given
 * wherever the new tree has the same room and the same record and left the field empty — see
 * lib/answerCarryOver.ts. The tree it carries from is the old one with the answers on screen folded
 * in, so a round left half-answered is not lost either. Everything else is asked.
 *
 * The equipment checks answered against the old tree (`resolvedSuggestions`) stay only where the new
 * tree's count is the count that was weighed — see `carriedSuggestions`. Anywhere else, kept, they
 * would stop the check being asked of the new tree, and the new tree's own count would stand with
 * nobody told. The first read of a claim has none to keep.
 */
export function withExtraction(
  state: SavedClaimState,
  extraction: WaterLossExtraction,
  scopedNotes?: string[],
): Pick<SavedClaimState, "extraction" | "answers" | "step" | "photos" | "resolvedSuggestions"> {
  const extractionWithYear = applyClaimYearOfBuilding(state.claim, extraction);
  const suggestions = (resolved: string[]) => equipmentSuggestionsFor(state.sketch, state.moisture, resolved);
  const answered = state.extraction
    ? resolveRound(state.claim, state.extraction, state.answers ?? {}, suggestions(state.resolvedSuggestions ?? [])).extraction
    : null;
  const kept = answered ? carryAnswers(state.claim, answered, extractionWithYear, suggestions([])).extraction : extractionWithYear;
  const resolvedSuggestions = answered ? carriedSuggestions(answered, kept, state.resolvedSuggestions ?? []) : [];
  const questions = nextQuestions(state.claim, kept, suggestions(resolvedSuggestions));
  return {
    extraction: kept,
    answers: {},
    resolvedSuggestions,
    step: questions.length === 0 ? "ready" : "questions",
    photos: scopedNotes ? { ...state.photos, scopedNotes } : state.photos,
  };
}

/** The body /api/generate is sent for this claim. Null when there is no extraction to generate from. */
export function generationRequest(state: SavedClaimState) {
  if (!state.extraction) return null;
  const exterior = exteriorScopeLines(state.sketch.exterior);
  return {
    claim: state.claim,
    extraction: state.extraction,
    transcript: state.transcript,
    contentsAssignmentNote: buildContentsAssignmentNote(state.claim, state.contentsApproach, state.bricABrac),
    // Only sent once the DGIG form actually has content in it — see dgig.ts's hasDGIGContent doc
    // comment for why an empty form falls back to the standard derivation instead of an empty
    // Emergency/Repair section.
    dgigData: isDGIG(state.claim.insurer) && hasDGIGContent(state.dgigData) ? state.dgigData : null,
    roomAreas: roomAreasForEstimate(state.sketch, normaliseRoomName),
    exterior: [...exterior.roofing, ...exterior.siding],
    // The same notes the extraction read, as they stand now — see `photoNotesFor`. Absent when none.
    ...(() => {
      const notes = photoNotesFor(state).text;
      return notes ? { photoNotes: notes } : {};
    })(),
  };
}

/** The generated documents, finished with what is built here rather than by Claude, and the step they open on. */
export function withGeneratedDocuments(state: SavedClaimState, generated: GeneratedDocuments): Pick<SavedClaimState, "documents" | "step"> {
  const documents = { ...generated };
  // Contents alongside structural scope: Claude generates the structural Emergency/Repair scope
  // only (see documentGenerationPrompt.ts's SCOPE_PHASE_RULES) — the Contents section is
  // appended here, client-side, same reasoning as a Contents-only claim never calling Claude at all.
  if (hasSeparateContents(state.claim)) {
    const contentsSection = buildContentsSection(state.contentsApproach, state.contentsTM, state.bricABrac);
    if (contentsSection) documents.scopeDocument = `${documents.scopeDocument}\n\n${contentsSection}`;
  }
  // Asbestos abatement, appended the same way and for the same reason — it is calculated from the
  // form rather than generated, so it goes on after the model's structural scope instead of being
  // asked of it.
  const asbestosSection = buildAsbestosSection(state);
  if (asbestosSection) documents.scopeDocument = `${documents.scopeDocument}\n\n${asbestosSection}`;
  return { documents, step: "results" };
}
