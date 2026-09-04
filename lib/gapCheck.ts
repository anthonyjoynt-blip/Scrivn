import type {
  AreaFraction,
  BaseboardAction,
  BaseboardDisposition,
  BaseboardMaterial,
  BaseboardMdfProfile,
  BaseboardRecord,
  BasinCount,
  CabinetryExtent,
  CabinetryGrade,
  CabinetryRecord,
  CeilingRecord,
  CeilingTextureStyle,
  CeilingType,
  ContentsManipulation,
  ContentsSize,
  CountertopMaterial,
  CountertopRecord,
  DetachOrReplaceAction,
  DoorRecord,
  DoorType,
  DoorUnitType,
  ElectricalOutletRecord,
  ElectricalPanelRecord,
  FlooringDisposition,
  FlooringRecord,
  FlooringType,
  HardwoodConstruction,
  HardwoodInstallation,
  InsulationType,
  LightFixtureRecord,
  LightFixtureType,
  OutletDetachScope,
  OutletVoltage,
  PlumbingFixtureRecord,
  PlumbingFixtureType,
  Room,
  RoomLightFixtureType,
  SinkMount,
  StairFlooringType,
  StairRecord,
  StairRiserStyle,
  SurroundMaterial,
  ToeKickMethod,
  ToeKickRecord,
  VanityTopMaterial,
  VinylInstallation,
  VinylSubtype,
  WallDrywallCutHeight,
  WallRecord,
  WallTileRecord,
  WallTileSurface,
  WaterLossExtraction,
  WindowCleaningSize,
  WorkPhase,
} from "./types";
import {
  BATT_R_VALUES,
  BLOWN_IN_R_VALUES,
  WINDOW_CLEANING_SIZE_LABEL,
  WINDOW_CLEANING_SIZES,
  blownInLabel,
  rValueOptionsFor,
  totalWindowsToClean,
  withDerivedFields,
} from "./types";
import { type GapCheckQuestion, type GapCheckQuestionKind, type GapCheckResult, parseBucketCounts } from "./questions";

/**
 * Deterministic, zero-API-call gap-check for water losses. Pure function of the current
 * extraction tree in, question list out — see {@link evaluate}. Answers are applied with
 * {@link applyAnswer}, which returns a new tree; the caller re-runs {@link evaluate} on the result
 * to get the next batch of questions (a question can resolve into new questions — e.g. answering
 * the baseboard-presence question can surface the baseboard action question, and confirming a
 * replacement can surface a material/height question). `evaluate` returns `isComplete: true` once
 * no more questions remain.
 *
 * Order: claim-level questions first (asbestos, then basement/HVAC), then per room in
 * room-mention order, then within a room: baseboard-completeness, flooring, baseboard, walls,
 * doors, cabinetry, toe kicks, countertops, wall tile, ceilings, outlets, light fixtures,
 * electrical panel, plumbing fixtures, stairs, floor registers, equipment, contents.
 *
 * Ported field-for-field from the Android app's `service/scoping/GapCheckEngine.kt`, including
 * the categories (outlets, electrical panel, toe kicks, wall tile, light fixtures, plumbing
 * fixtures, stairs) that never currently fire because extraction doesn't populate them (see
 * `schema.ts`) — kept dormant-but-ready here for the same reason the Android app keeps them: the
 * question logic already exists and needs no changes if/when one of those categories comes back.
 */

/**
 * Suggested equipment counts, keyed by room name, for the confirm-or-suggest question.
 *
 * Passed in rather than computed here because it comes from the moisture map, which is sketch data
 * and has no business inside the extraction engine. Keyed by name because that is the only thing a
 * sketch room and an extraction room share — the sketch offers the claim's known room names as
 * autocomplete precisely so this match can be made.
 *
 * Omitted entirely for a claim with no moisture map, and then nothing below behaves any differently
 * than it did before this existed.
 */
export interface MoistureDerived {
  /** Suggested unit counts, keyed by the free-text equipment type extraction uses. */
  equipment: Partial<Record<string, number>>;
  /** Measured affected floor area, in square feet. Null when nothing was painted. */
  floorSquareFeet: number | null;
  /** Measured affected wall run, in linear feet — the sum of every mark's own run. */
  wallRunFeet: number | null;
  /** Measured affected ceiling area, in square feet. */
  ceilingSquareFeet: number | null;
  /**
   * The room this one is drawn inside, if any — a closet within a bedroom, an ensuite off a primary.
   *
   * Carried here because nesting is a fact about the drawing, and the engine is a pure function of
   * the extraction: this is the existing channel from sketch to gap-check, so it does not need a
   * second one. Normalised the same way the keys of `EquipmentSuggestions` are, so it can be looked
   * up directly.
   */
  parentRoomKey: string | null;
}

export type EquipmentSuggestions = Record<string, MoistureDerived>;

/**
 * Whether a question asks for a quantity the sketch can measure, and which measurement.
 *
 * Deliberately keyed off the question id rather than a flag on the question, for the same reason the
 * other `is…Question` predicates here are: the engine stays a pure function of the extraction, and
 * everything that needs to know about the sketch asks from one layer up.
 *
 * Wall runs are linear feet along walls; the rest are areas painted on the floor. A question not
 * listed simply gets no button.
 */
export function sketchMeasureFor(questionId: string): "wallRun" | "floorArea" | null {
  if (/:wall:\d+:cutRunFt$/.test(questionId)) return "wallRun";
  if (/:baseboard:\d+:(lengthFt|runFt)$/.test(questionId)) return "wallRun";
  if (/:flooring:\d+:(removalSF|carpetLiftSF|padRemovedSF|sf)$/.test(questionId)) return "floorArea";
  if (/:waterExtraction:sf$/.test(questionId)) return "floorArea";
  if (/:ceilings?:\d+:replaceSF$/.test(questionId)) return "floorArea";
  return null;
}

/**
 * The room-and-equipment a suggestion question was about, so an answered suggestion is not re-offered.
 *
 * A suggestion is advice, and advice the PM has answered — accepted, declined, or replaced with their
 * own number — is finished. Nothing in the extraction records that it was ever offered, so the caller
 * keeps these keys and strips the matching entry out of the suggestions it passes to `evaluate`.
 *
 * It has to be the caller, not this function: `evaluate` is a pure function of the tree, and "has the
 * PM already been asked this" is session state that the tree deliberately does not carry.
 *
 * Covers the plan question as well as confirm-or-suggest. A PM who types 3 against a suggestion of 6
 * has already weighed the recommendation; following it with "we suggest 6" is the same nag under a
 * different name.
 */
export function equipmentSuggestionKey(question: GapCheckQuestion): string | null {
  if (question.kind.type !== "confirmOrSuggest" && question.kind.type !== "equipmentPlan") return null;
  if (!question.roomName) return null;
  return `${normaliseRoomName(question.roomName)}::${question.kind.unit}`;
}

/** Removes every retired suggestion, leaving the rest untouched. */
export function withoutResolvedSuggestions(suggestions: EquipmentSuggestions, resolved: string[]): EquipmentSuggestions {
  if (resolved.length === 0) return suggestions;
  const retired = new Set(resolved);
  const out: EquipmentSuggestions = {};
  for (const [roomKey, derived] of Object.entries(suggestions)) {
    const equipment: Partial<Record<string, number>> = {};
    for (const [type, units] of Object.entries(derived.equipment)) {
      if (!retired.has(`${roomKey}::${type}`)) equipment[type] = units;
    }
    out[roomKey] = { ...derived, equipment };
  }
  return out;
}

/** Rounded the way a PM would write it: one decimal, and no trailing ".0". */
function quantityText(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Room names match loosely: a sketch says "Basement Bedroom", extraction may say "basement bedroom".
 *
 * Exported because the KEYS of an `EquipmentSuggestions` must be normalised with this same function
 * — a caller rolling its own would silently fail to match, and a suggestion that never fires looks
 * exactly like a claim with no moisture map.
 */
export function normaliseRoomName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Finds the moisture map's entry for a room, tolerating the two names not being written identically.
 *
 * "Loosely" was only ever case and whitespace, which is not how the two names actually differ. The
 * sketch is labelled while standing in the room ("Bedroom") and the transcript describes it in
 * context ("Main bedroom"), so an exact key lookup missed — and a miss is invisible: the question
 * simply arrives with no measured default, looking for all the world like a room nobody mapped. That
 * is what "the moisture map isn't coming up, it's asking me to highlight again" was, and why the
 * closet — whose two names happened to agree — was pre-filled correctly in the same claim.
 *
 * Exact match wins. Failing that, one name containing the other as a whole-word run is accepted, but
 * ONLY when exactly one entry qualifies: "bedroom" would otherwise match both "main bedroom" and
 * "bedroom closet", and silently taking the first would attach a closet's readings to a bedroom.
 * Ambiguity is left unmatched on purpose — no default is recoverable, a wrong one is not.
 */
export function findDerived(
  suggestions: EquipmentSuggestions | undefined,
  roomName: string | null,
): MoistureDerived | undefined {
  if (!suggestions || !roomName) return undefined;
  const key = normaliseRoomName(roomName);
  const exact = suggestions[key];
  if (exact) return exact;

  const contains = (haystack: string, needle: string) =>
    new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(haystack);

  const candidates = Object.keys(suggestions).filter((k) => contains(k, key) || contains(key, k));
  const only = candidates.length === 1 ? candidates[0] : undefined;
  return only === undefined ? undefined : suggestions[only];
}

export function evaluate(raw: WaterLossExtraction, suggestions?: EquipmentSuggestions): GapCheckResult {
  const extraction = withDerivedFields(raw);
  const questions: GapCheckQuestion[] = [];

  if (extraction.loss.asbestosTestingRequired && hasAnyRemovalWork(extraction)) {
    /*
      Both parts in one round, not two.

      These were a sequential tree — answer yes, submit, wait, then get asked how many — which is a
      round trip for a number the PM already has in their head at the moment they say yes. The count
      is only meaningful when samples were taken, so it is offered alongside rather than after: a
      "no" simply leaves it blank and it is never applied.
    */
    if (extraction.loss.asbestosSamplesTaken === null) {
      questions.push({
        id: "asbestos:taken",
        roomName: null,
        prompt: "Were asbestos samples taken?",
        kind: { type: "yesNo" },
      });
    }

    // Only once samples are known to have been taken. `!== false` would also be true while nobody
    // has said, which queues a count for samples that may not exist — see the ceiling finish pair.
    if (extraction.loss.asbestosSamplesTaken === true && extraction.loss.asbestosSampleCount === null) {
      questions.push({
        id: "asbestos:count",
        roomName: null,
        prompt: "How many asbestos samples were taken?",
        kind: { type: "wholeNumber" },
      });
    }
    // asbestosSamplesTaken === false: the count is moot and is not asked.
  }

  if (extraction.loss.isBasementLoss && extraction.loss.hvacInspectionRequired === null) {
    questions.push({
      id: "loss:hvacInspectionRequired",
      roomName: null,
      prompt: "Does the furnace or hot water tank require inspection?",
      kind: { type: "yesNo" },
    });
  }

  /*
    Equipment stated for the job rather than per room is asked ONCE — see
    `equipmentNeedsConsolidating` for every condition that turns this back off.
  */
  const consolidateEquipment = equipmentNeedsConsolidating(extraction, suggestions);
  if (consolidateEquipment) questions.push(...consolidatedEquipmentQuestions(extraction));

  extraction.rooms.forEach((room, roomIndex) => {
    // What the moisture map measured for THIS room, if it was mapped at all. Undefined everywhere
    // else, and every use below is optional — an unmapped claim behaves exactly as it always did.
    const derived = findDerived(suggestions, room.roomName);
    /*
      A room drawn inside another inherits the room-wide answers rather than being asked for its own.

      A closet off a bedroom is one space for almost every purpose that matters here: it is under the
      same ceiling, inside the same drying setup, behind the same windows. Asking it separately about
      ceiling finish, insulation, windows and equipment is the same question twice, and the second
      time the PM has no new information to give. What it does get asked about is whatever is
      recorded IN it — its own flooring, baseboard, door — because those genuinely differ.
    */
    const isSubRoom = derived?.parentRoomKey != null;

    questions.push(...roomNameQuestion(roomIndex, room));
    /*
      Ordered by surface, the way somebody walks a room: floor, then walls, then ceiling, then the
      fittings hanging off them.

      It used to follow the schema's field order, which interleaved surfaces — the walls' insulation
      questions landed several questions before the ceiling's, and since both once read "What type of
      insulation?" the pair looked like the tool asking what type before asking whether there was any.
      Grouping by surface is what makes a sequence of questions read as a description of the work
      rather than a walk through a data structure; the prompts now name their surface as well, so
      neither the order nor the wording can be misread on its own.
    */

    // ---- Floor ----
    questions.push(...waterExtractionQuestions(roomIndex, room, derived));
    room.flooring.forEach((f, i) => questions.push(...flooringQuestions(roomIndex, room.roomName, i, f, derived)));
    // Registers are ducted off the room's own system; a closet does not get its own.
    if (!isSubRoom && hasRemovalFlooring(room) && room.floorRegistersDetached === null) {
      questions.push({
        id: `room:${roomIndex}:floorRegistersDetached`,
        roomName: room.roomName,
        prompt: "How many floor registers need to be detached/reset in this room?",
        kind: { type: "wholeNumber" },
      });
    }

    // ---- Where floor meets wall ----
    questions.push(...baseboardCompletenessQuestions(roomIndex, room));
    room.baseboard.forEach((b, i) => questions.push(...baseboardRecordQuestions(roomIndex, room.roomName, i, b)));

    // ---- Walls, and what is fixed to them ----
    room.walls.forEach((w, i) => questions.push(...wallQuestions(roomIndex, room.roomName, i, w, derived)));
    room.wallTile.forEach((wt, i) => questions.push(...wallTileQuestions(roomIndex, room.roomName, i, wt)));
    room.doors.forEach((d, i) => questions.push(...doorQuestions(roomIndex, room.roomName, i, d)));
    room.outlets.forEach((o, i) => questions.push(...outletQuestions(roomIndex, room.roomName, i, o)));

    // ---- Ceiling, all of it together. A sub-room is under its parent's ceiling. ----
    if (!isSubRoom) {
      room.ceilings.forEach((c, i) => questions.push(...ceilingQuestions(roomIndex, room.roomName, i, c)));
      questions.push(...ceilingFixtureQuestions(roomIndex, room));
      room.lightFixtures.forEach((l, i) => questions.push(...lightFixtureQuestions(roomIndex, room.roomName, i, l)));
    }

    // ---- Fixtures and joinery ----
    room.cabinetry.forEach((c, i) => questions.push(...cabinetryQuestions(roomIndex, room.roomName, i, c, room.cabinetry.length === 1)));
    room.toeKicks.forEach((t, i) => questions.push(...toeKickQuestions(roomIndex, room.roomName, i, t)));
    room.countertops.forEach((c, i) => questions.push(...countertopQuestions(roomIndex, room.roomName, i, c)));
    room.plumbingFixtures.forEach((p, i) => questions.push(...plumbingQuestions(roomIndex, room.roomName, i, p)));
    if (room.electricalPanel) questions.push(...panelQuestions(roomIndex, room.roomName, room.electricalPanel));
    if (room.stairs) questions.push(...stairsQuestions(roomIndex, room.roomName, room.stairs));
    // Replaced by the single consolidated question above when equipment was never room-attributed.
    if (!consolidateEquipment) room.equipment.forEach((e, i) => {
      const suggested = derived?.equipment[e.type];

      if (e.quantity === null) {
        /*
          With a moisture map, the bare "how many?" is the wrong question — the calculation already
          has a number, so asking the PM to produce one makes them redo work the tool has done. The
          two answers worth a tap are "that is right" and "none is needed here"; anything else is a
          number they type, same as before.
        */
        if (suggested !== undefined) {
          questions.push({
            id: `room:${roomIndex}:equipment:${i}:plan:${suggested}`,
            roomName: room.roomName,
            prompt: `How many ${e.type} for this room? The moisture map suggests ${suggested}.`,
            kind: { type: "equipmentPlan", suggested, unit: e.type },
          });
          return;
        }

        questions.push({
          id: `room:${roomIndex}:equipment:${i}:quantity`,
          roomName: room.roomName,
          prompt: `How many ${e.type} are being placed?`,
          kind: { type: "wholeNumber" },
        });
        return;
      }

      /*
        A quantity IS stated — so the only thing left to ask is whether it matches what the moisture
        map suggests, and only when a map produced a number at all. Above or equal to the suggestion
        is left alone: the PM is standing in the room, and over-drying is not a defect to argue with.

        The suggested count rides in the question id so `applyAnswer` keeps its signature — it stays
        a pure function of (tree, id, answer) with nothing to look up.
      */
      /*
        An explicit zero is a decision, not a shortfall.

        Quantity is null until somebody answers, so zero can only have come from the PM choosing
        "None required". Suggesting six air movers straight after they said none were needed is the
        tool arguing with a judgement it just asked for.
      */
      if (e.quantity > 0 && suggested !== undefined && suggested > e.quantity) {
        questions.push({
          id: `room:${roomIndex}:equipment:${i}:suggest:${suggested}`,
          roomName: room.roomName,
          prompt: `You stated ${e.quantity} ${e.type}; IICRC guidance suggests ${suggested} for this room based on the moisture map.`,
          kind: { type: "confirmOrSuggest", stated: e.quantity, suggested, unit: e.type },
        });
      }
    });
    /*
      Drying, cleaning and contents are all about the space as a whole.

      Equipment is placed for the room and its closet together — a PM says "six air movers between
      the bedroom and closet", not six here and two there. Windows belong to the outside wall the
      closet does not have. Contents get carried out through the room they open onto. Each of these
      asked separately of a sub-room is the same question twice with no new answer available.
    */
    if (!isSubRoom) {
      // The presence backstop asks whether equipment was FORGOTTEN, which is a different question —
      // but it is redundant once a consolidated question is already listing every room.
      if (!consolidateEquipment) questions.push(...equipmentPresenceQuestions(roomIndex, room));
      // Cleaning and contents come last: they are about the room once the work in it is understood.
      questions.push(...windowCleaningQuestions(roomIndex, room));
      questions.push(...contentsQuestions(roomIndex, room));
    }
  });

  return { isComplete: questions.length === 0, questions };
}

// ---- Claim-level ---------------------------------------------------------------------------

function hasAnyRemovalWork(extraction: WaterLossExtraction): boolean {
  return extraction.rooms.some(
    (room) =>
      room.flooring.some((f) => f.disposition === "REMOVE_AND_DISPOSE" || f.disposition === "REMOVE_AND_ASSESS") ||
      /*
        A baseboard whose action is still unanswered counts for nothing here yet.

        The disposition clause used to stand alone, and a record can carry a removal disposition
        while its own action question (see baseboardRecordQuestions) is still open — so this claim
        would say "there is removal work" on the strength of something the PM is in the middle of
        being asked about, and answering "detached only" would take the asbestos question back off
        the screen. A question that disappears when a neighbouring one is answered is the exact
        failure test/gapcheck/run.mjs exists to catch. Waiting for the action costs a round at worst:
        the asbestos question then arrives as a follow-up, which is how every other dependency here
        behaves.
      */
      room.baseboard.some((b) => b.action === "REMOVE_AND_REPLACE" || (b.action !== null && b.disposition === "REMOVE_AND_DISPOSE")) ||
      room.walls.some((w) => w.drywallBeingRemoved),
  );
}

// ---- Room naming (round 12) ------------------------------------------------------------------

/**
 * A room the PM never actually named in the transcript — extraction uses this exact placeholder
 * (see extractionPrompt.ts) rather than inventing a plausible-sounding name or silently dropping
 * the work described. Per direct feedback: "if we just list out work but dont say any rooms itd be
 * worth asking what room this belongs too. itd be a rare case i think unless the claim takes place
 * in a single room but should be clarified."
 */
export const UNNAMED_ROOM_PLACEHOLDER = "Unnamed Room";

function roomNameQuestion(roomIndex: number, room: Room): GapCheckQuestion[] {
  if (room.roomName !== UNNAMED_ROOM_PLACEHOLDER) return [];
  return [{ id: `room:${roomIndex}:roomName`, roomName: room.roomName, prompt: "What room does this work belong to?", kind: { type: "text" } }];
}

// ---- Baseboard "triggered by absence" completeness tree -------------------------------------

/**
 * The three things that can be happening to a baseboard, in the PM's words.
 *
 * Shared by the two places the question is asked — the completeness tree below, where the answer
 * CREATES the record, and `baseboardRecordQuestions`, where it fills in a record extraction already
 * produced. `baseboardActionAnswer` parses exactly these, so the wording and the parsing cannot
 * drift apart.
 */
/*
  "Detached and reset on repairs", not "Detached only".

  The work this produces has always been right — the baseboard comes off in Emergency and goes back
  down in Repair, two bullets, driven by the action rather than the phase field. What was wrong was
  that a PM choosing it had to already know that. "Detached only" describes half the job and reads
  like the other half is being declined, so the reset arriving in the repair scope looks like the
  tool adding work nobody asked for. Naming the whole thing in the option is the entire fix; nothing
  downstream changes.
*/
const BASEBOARD_ACTION_OPTIONS = ["Detached and reset on repairs", "Removed and replaced", "Shoe mold removed and replaced"];

/** The same three, plus the answer that says the premise is wrong — see `baseboardCompletenessQuestions`. */
const NO_BASEBOARD_OPTION = "No baseboard in this area";
const BASEBOARD_COMPLETENESS_OPTIONS = [...BASEBOARD_ACTION_OPTIONS, NO_BASEBOARD_OPTION];

function hasRemovalFlooring(room: Room): boolean {
  return room.flooring.some((f) => f.disposition === "REMOVE_AND_DISPOSE" || f.disposition === "REMOVE_AND_ASSESS");
}

/**
 * Flooring whose removal actually disturbs the baseboard — everything except carpet.
 *
 * Vinyl, laminate, hardwood and tile all run to the wall and under the trim, so the baseboard has to
 * come off to pull the old floor or to lay the new one to the wall. Carpet does not: it is stretched
 * onto tack strip that sits INSIDE the trim, so it comes up and goes back down without the baseboard
 * being touched at all. Asking about baseboard on a carpet tear-out is a question with no work
 * behind it, which is how a scope acquires a detach-and-reset line for trim nobody is going near.
 *
 * Separate from `hasRemovalFlooring` on purpose: floor registers still need detaching under carpet,
 * so that trigger keeps every flooring type.
 */
function hasBaseboardDisturbingFlooring(room: Room): boolean {
  return room.flooring.some(
    // A null type is not "not carpet" — it is not yet known. Asking about baseboard before the
    // material is named would put a detach-and-reset line under a carpet that never needed one.
    (f) => f.type !== null && f.type !== "CARPET" && (f.disposition === "REMOVE_AND_DISPOSE" || f.disposition === "REMOVE_AND_ASSESS"),
  );
}

/**
 * Any drywall work in the room, wall or ceiling.
 *
 * Ceilings count as much as walls: a ceiling coming down is the messiest version of this, and it is
 * the one most likely to leave the windows needing doing.
 */
function hasDrywallWork(room: Room): boolean {
  if (room.walls.some((w) => w.drywallBeingRemoved)) return true;
  return room.ceilings.some((c) => c.type === "DRYWALL_PLASTER" && c.action === "REMOVE_AND_REPLACE");
}

/**
 * Windows needing cleaning once drywall work is done — presence first, then how many and how big.
 *
 * All three used to be returned in one round so a PM could answer in one thought. That put a count
 * and a size on the pending list before anyone had said there were windows at all, and a "no" left
 * both of them queued for windows that do not exist. Count and size now wait for the yes.
 *
 * `windowCleaningAsked` is what records that presence has been answered — it is set either way, so
 * it cannot double as "there are windows". A null `windowCleaningCounts` after that flag is set is
 * yes-but-not-yet-counted, which is exactly the state that should be asking for the tally.
 */
function windowCleaningQuestions(roomIndex: number, room: Room): GapCheckQuestion[] {
  if (!hasDrywallWork(room)) return [];
  const base = `room:${roomIndex}:windowCleaning`;

  if (!room.windowCleaningAsked) {
    return [
      {
        id: `${base}:present`,
        roomName: room.roomName,
        prompt: "Drywall work in this room — are there windows that will need cleaning afterwards?",
        kind: { type: "yesNo" },
      },
    ];
  }

  // Answered, and counted. An empty map is a recorded "none" — see `windowCleaningCounts`.
  if (room.windowCleaningCounts !== null) return [];

  /*
    One question for the whole tally, not a count followed by a size.

    A room's windows are routinely not all the same size, and the old pair made every window in the
    room take one band — so two windows could not be two sizes, and whichever band was chosen priced
    both. Counting straight into the bands is the same single glance for the PM and survives any mix.
  */
  return [
    {
      id: `${base}:counts`,
      roomName: room.roomName,
      prompt: "How many windows of each size?",
      kind: {
        type: "bucketCounts",
        unit: "windows",
        buckets: WINDOW_CLEANING_SIZES.map((key) => ({ key, label: WINDOW_CLEANING_SIZE_LABEL[key] })),
      },
    },
  ];
}

/**
 * Drywall coming off a wall is as good a reason to ask about baseboard as flooring coming up.
 *
 * Baseboard sits on the joint between the two, so it has to come off for either — and it is the
 * thing most often left out of a scope, because a PM describing a wall cut is thinking about the
 * wall. This is why the question fires on wall removal too, not only flooring.
 */
function hasDrywallRemoval(room: Room): boolean {
  return room.walls.some((w) => w.drywallBeingRemoved);
}

function baseboardCompletenessQuestions(roomIndex: number, room: Room): GapCheckQuestion[] {
  const triggers = hasBaseboardDisturbingFlooring(room) || hasDrywallRemoval(room);
  if (!triggers || room.baseboard.length > 0 || room.baseboardConfirmedAbsent) return [];

  /*
    One question, covering every outcome including "there is no baseboard here".

    It used to be two, shown side by side: "Are baseboards present?" and then the action. That put a
    yes/no in front of a question the PM could already answer — anyone who can say the trim is being
    detached and reset has plainly established it exists — and it made the second question depend on
    the first in a way nothing on screen explained. Folding absence in as an option collapses them
    without losing anything: the three real outcomes and the answer that says the premise is wrong.

    The record does not exist yet; answering the action is what creates it (see `applyAnswer`), and
    `baseboardRecordQuestions` then asks material — and height only for REMOVE_AND_REPLACE. Material
    and height used to ride along here and were both wrong to: height is a spec for NEW baseboard, so
    it does not apply to one being reset, and its prompt hedged "if it is being replaced" while still
    refusing to let the PM past. The round still resolves in one screen, because answering the action
    reveals them immediately.
  */
  return [
    {
      id: `room:${roomIndex}:baseboard:action`,
      roomName: room.roomName,
      /*
        Stands on its own. It read "If so, are they being detached only..." — but the "if" referred to
        a presence question the PM may never have seen, so the sentence pointed at nothing. A prompt
        has to make sense to whoever is looking at it, not to whoever wrote the branch above it.
      */
      prompt: "What is happening with the baseboards in this room?",
      kind: { type: "choice", options: BASEBOARD_COMPLETENESS_OPTIONS },
    },
  ];
}

// ---- Flooring ---------------------------------------------------------------------------------

/** Kept beside the parsers below so the labels and what they map to cannot drift apart. */
/** What to call a floor in a prompt before anyone has said what it is made of. */
function flooringLabel(f: FlooringRecord): string {
  return f.type === null ? "flooring" : f.type.toLowerCase();
}

/** The materials extraction knows, offered when it could not tell which one this is. */
const FLOORING_TYPE_OPTIONS = ["Carpet", "Vinyl", "Hardwood", "Laminate", "Tile", "Concrete"];

const HARDWOOD_CONSTRUCTION_OPTIONS = ["Solid", "Engineered", "Prefinished", "Other"];
const HARDWOOD_INSTALLATION_OPTIONS = ["Floating", "Glued", "Nailed"];

function flooringQuestions(roomIndex: number, roomName: string, i: number, f: FlooringRecord, derived?: MoistureDerived): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:flooring:${i}`;

  /*
    What the floor is made of, when the transcript never said.

    Everything else about a floor branches on this — which spec questions apply, whether the
    baseboard has to come off, how the removal renders — so it is asked first and the switch below
    simply produces nothing until it is answered. Before the record could exist without a type, a
    PM saying "flooring's coming up in all three" produced no flooring records at all and the
    largest line item on the claim vanished from the scope with nothing looking wrong.
  */
  if (f.type === null) {
    q.push({
      id: `${base}:type`,
      roomName,
      prompt: "What type of flooring is it?",
      kind: { type: "choice", options: FLOORING_TYPE_OPTIONS },
    });
  }

  switch (f.type) {
    case "HARDWOOD":
      if (f.hardwoodConstruction === null)
        q.push({
          id: `${base}:hardwoodConstruction`, roomName, prompt: "What construction is the hardwood?",
          kind: { type: "choice", options: HARDWOOD_CONSTRUCTION_OPTIONS },
        });
      /*
        Species and construction are broad enough that any fixed list misses real floors, so "Other"
        opens a free-text field rather than forcing the PM to pick the nearest wrong option. Only
        asked once "Other" is the answer — see the ceiling texture pair for why a dependent waits.
      */
      if (f.hardwoodConstruction === "OTHER" && (f.hardwoodConstructionOther ?? "").trim() === "")
        q.push({
          id: `${base}:hardwoodConstructionOther`, roomName, prompt: "What construction is it?",
          kind: { type: "text" },
        });
      if (f.hardwoodInstallation === null)
        q.push({
          id: `${base}:hardwoodInstallation`, roomName, prompt: "How is the hardwood installed?",
          kind: { type: "choice", options: HARDWOOD_INSTALLATION_OPTIONS },
        });
      break;
    case "VINYL":
      if (f.vinylSubtype === null)
        q.push({ id: `${base}:vinylSubtype`, roomName, prompt: "Is the vinyl sheet or plank?", kind: { type: "choice", options: ["Sheet", "Plank"] } });
      // Sheet vinyl is glued down in practice — the glued/snaplock-floating distinction only
      // matters for plank (LVP/LVT), so this is never asked for sheet.
      if (f.vinylSubtype === "PLANK" && f.vinylInstallation === null)
        q.push({ id: `${base}:vinylInstallation`, roomName, prompt: "Is the vinyl glued or snaplock/floating?", kind: { type: "choice", options: ["Glued", "Snaplock/Floating"] } });
      break;
    case "CARPET":
      // carpetStyle is never asked — it never changed the scope, only added a question.
      if (f.disposition === "LIFT_AND_REINSTALL" && f.padPresent === null)
        q.push({ id: `${base}:padPresent`, roomName, prompt: "Is pad present under the carpet?", kind: { type: "yesNo" } });
      if (f.disposition === "LIFT_AND_REINSTALL" && f.padPresent === true && f.padRemoved === null)
        q.push({ id: `${base}:padRemoved`, roomName, prompt: "Is the pad being removed while the carpet is lifted?", kind: { type: "yesNo" } });
      // Both quantities are asked together once pad removal is confirmed — lifting the carpet to
      // get at the pad and removing the pad are the same physical action, by nature. Accepts an
      // exact SF number OR a qualitative fraction of the room (see parseAreaQuantity) — whichever
      // the PM finds natural to answer with.
      // Bug fixed round 6: these two must also require LIFT_AND_REINSTALL, same as the
      // padPresent/padRemoved questions right above them. Without that gate, a REMOVE_AND_DISPOSE
      // record whose padRemoved happened to be true (e.g. "tear out carpet and pad" — pad removal
      // stated, but nothing is being lifted) wrongly asked "how much is being lifted," and
      // generation rendered contradictory "remove and dispose" + "lift the carpet" bullets for the
      // same record (see the matching fix in documentGenerationPrompt.ts's auto-include 2).
      if (f.disposition === "LIFT_AND_REINSTALL" && f.padRemoved === true && f.carpetLiftSF === null && f.carpetLiftFraction === null)
        q.push({
          id: `${base}:carpetLiftSF`,
          roomName,
          prompt: AREA_QUANTITY_PROMPT("How much carpet is being lifted?", "room") + derivedNote(derived?.floorSquareFeet, "SF"),
          kind: { type: "text" },
          ...defaultFrom(derived?.floorSquareFeet, "SF"),
        });
      if (f.disposition === "LIFT_AND_REINSTALL" && f.padRemoved === true && f.padRemovedSF === null && f.padRemovedFraction === null)
        q.push({
          id: `${base}:padRemovedSF`,
          roomName,
          prompt: AREA_QUANTITY_PROMPT("How much pad is being removed?", "room") + derivedNote(derived?.floorSquareFeet, "SF"),
          kind: { type: "text" },
          ...defaultFrom(derived?.floorSquareFeet, "SF"),
        });
      break;
    case "LAMINATE":
    case "TILE":
    case "CONCRETE":
      break;
  }

  const involvesRemoval = f.disposition === "REMOVE_AND_DISPOSE" || f.disposition === "REMOVE_AND_ASSESS";

  /*
    How much floor is coming out — asked for every type, not just carpet.

    Without this the only thing generation had for a vinyl or laminate tear-out was the qualitative
    extent it falls back on when nothing is known, so a scope read "small area at the dishwasher"
    for a floor the PM had measured. Asking directly is the same pattern water extraction already
    uses: an exact number or a share of the room, whichever the PM has to hand.

    Only when extraction did not already capture it. A stated "six by eight feet" now lands in
    `removalSF` during the detail pass, and re-asking for something the PM has already said is the
    exact complaint that drove the extractable-fields audit — see test/gapcheck/extractable.mjs.
  */
  if (involvesRemoval && f.removalSF === null && f.removalFraction === null) {
    q.push({
      id: `${base}:removalSF`,
      roomName,
      prompt:
        AREA_QUANTITY_PROMPT(`How much ${flooringLabel(f)} is being removed?`, "room") +
        derivedNote(derived?.floorSquareFeet, "SF"),
      kind: { type: "text" },
      ...defaultFrom(derived?.floorSquareFeet, "SF"),
    });
  }

  if (involvesRemoval && f.phase === null && f.phaseUncertain) {
    q.push({
      id: `${base}:phase`,
      roomName,
      prompt: `For the ${flooringLabel(f)}, is this emergency work, repair, or both?`,
      kind: { type: "choice", options: ["Emergency", "Repair", "Both"] },
    });
  }
  return q;
}

// ---- Existing baseboard records (always-required once mentioned) ----------------------------

function baseboardRecordQuestions(roomIndex: number, roomName: string, i: number, b: BaseboardRecord): GapCheckQuestion[] {
  const base = `room:${roomIndex}:baseboard:${i}`;

  /*
    What is happening to it, first and on its own, whenever extraction did not settle it.

    Extraction's action is nullable — the "UNKNOWN" sentinel maps to null, see extractionWire.ts's
    `baseboardToDomain` — and nothing used to ask for it. Every question below is gated on an action,
    so a record that arrived without one was asked its material and nothing else, and gap-check
    reported complete with the action still null. That is not a cosmetic gap: both outputs key the
    entire baseboard treatment off this field — the scope document's Repair portion
    (documentGenerationPrompt.ts) and the Finish Carpentry order's "Install new baseboard"
    (workOrders.ts) — so the room got an Emergency removal line and no replacement anywhere, and the
    height for the new baseboard was never asked either. Reported from the field: a bathroom whose
    baseboard came off and never went back on, next to a bedroom (whose action extraction did
    capture) that got both lines.

    Asked ALONE, not folded in with the material: shoe-mold-only ends the questions for this
    record, and a question that vanishes when another in its own round is answered is exactly what
    test/gapcheck/run.mjs rejects.
  */
  if (b.action === null) {
    return [
      {
        id: `${base}:action`,
        roomName,
        // No "no baseboard" option here, unlike the completeness question: this record exists
        // because extraction found a baseboard, so its absence is not one of the outcomes.
        prompt: "What is happening with this baseboard?",
        kind: { type: "choice", options: BASEBOARD_ACTION_OPTIONS },
      },
    ];
  }

  // SHOE_MOLD_ONLY is "no further questions" — nothing to specify for a shoe-mold-only job.
  // DETACH_AND_RESET used to be excluded too, but material now matters for it as well (round 6) —
  // the paint/finish auto-include (documentGenerationPrompt.ts) needs to know MDF vs. wood vs.
  // vinyl/composite regardless of action, so material is asked either way. Height and phase stay
  // REMOVE_AND_REPLACE-only below — a detach-and-reset baseboard is the existing one going back
  // down, not a new spec decision.
  if (b.action === "SHOE_MOLD_ONLY") return [];

  const q: GapCheckQuestion[] = [];
  // Material and MDF's flat-vs-profile are one combined choice (round 6) — used to be two
  // sequential questions; folding the profile options directly into the material choice removes a
  // follow-up round without losing any information (see applyBaseboardAnswer's "material" case for
  // how one answer sets both material and mdfProfile at once).
  if (b.material === null)
    q.push({
      id: `${base}:material`, roomName, prompt: "What material is the baseboard?",
      kind: { type: "choice", options: ["Solid wood", "Flat MDF", "MDF with profile", "Vinyl/PVC composite"] },
    });
  if (b.action === "REMOVE_AND_REPLACE") {
    if (b.heightIn === null) q.push({ id: `${base}:heightIn`, roomName, prompt: "What height is the baseboard, in inches?", kind: { type: "decimal" } });
    if (b.phase === null && b.phaseUncertain)
      q.push({ id: `${base}:phase`, roomName, prompt: "For the baseboard, is this emergency work, repair, or both?", kind: { type: "choice", options: ["Emergency", "Repair", "Both"] } });
  }
  return q;
}

// ---- Walls --------------------------------------------------------------------------------------

function wallQuestions(roomIndex: number, roomName: string, i: number, w: WallRecord, derived?: MoistureDerived): GapCheckQuestion[] {
  if (!w.drywallBeingRemoved) return [];
  const base = `room:${roomIndex}:wall:${i}`;
  /*
    Insulation first, and nothing else until it is settled — the cut-height questions below wait.

    The gate is "is anything about the insulation still open", which now includes the R-value. It
    used to stop at the type, so the R-value question was written inside a block that had already
    closed by the time a type existed: unreachable, and invisibly so, since an unasked question looks
    exactly like a question that does not apply.
  */
  const insulationOpen =
    w.insulationAffected === null ||
    (w.insulationAffected === true && (w.insulationType === null || (w.insulationRValue === null && rValueOptionsFor(w.insulationType).length > 0)));

  if (insulationOpen) {
    const q: GapCheckQuestion[] = [];
    if (w.insulationAffected === null) {
      q.push({ id: `${base}:insulationAffected`, roomName, prompt: "Is the insulation in the walls affected?", kind: { type: "yesNo" } });
    }
    // Only once insulation is known to BE affected — while that is still null there is nothing here
    // to describe, and queueing it anyway is the bug the ceiling's finish/textureStyle pair had.
    if (w.insulationAffected === true && w.insulationType === null) {
      q.push({
        id: `${base}:insulationType`, roomName, prompt: "What type of insulation is in the walls?",
        kind: { type: "choice", options: INSULATION_TYPE_OPTIONS },
      });
    }
    /*
      R-value, once the type is known and that type has a table.

      Gated on the type rather than asked alongside it, for the reason the whole conditional class is:
      the options themselves DEPEND on the answer — batt is picked by R-value, blown-in by the depth
      you can actually measure — so there is no honest set of options to show before it is known.
      Cellulose and foam get no question at all; no table was given for them.
    */
    if (w.insulationAffected === true && w.insulationType !== null && w.insulationRValue === null) {
      const options = rValueOptionsFor(w.insulationType);
      if (options.length > 0) {
        q.push({
          id: `${base}:insulationRValue`, roomName,
          prompt: rValuePrompt(w.insulationType, "in the walls"),
          kind: { type: "choice", options },
        });
      }
    }
    return q;
  }
  // How high the cut runs determines both Repair-phase phrasing and whether priming/painting gets
  // included at all — see WallDrywallCutHeight's doc comment and documentGenerationPrompt.ts.
  if (w.cutHeight === null) {
    return [{
      id: `${base}:cutHeight`, roomName, prompt: "How high does the drywall cut run?",
      kind: { type: "choice", options: ["Base height (up to 4\")", "2 feet", "4 feet", "Full wall (floor to ceiling)"] },
    }];
  }
  // Only 2'/4' cuts need a linear-footage basis for the priming math — base height and full wall
  // render qualitatively (see documentGenerationPrompt.ts), so no quantity is asked for those.
  if ((w.cutHeight === "TWO_FOOT" || w.cutHeight === "FOUR_FOOT") && w.cutRunFt === null && w.cutRunFraction === null) {
    return [
      {
        id: `${base}:cutRunFt`,
        roomName,
        prompt:
          AREA_QUANTITY_PROMPT("How much of the wall run is being cut?", "room's wall run", "linear feet") +
          derivedNote(derived?.wallRunFeet, "LF"),
        kind: { type: "text" },
        ...defaultFrom(derived?.wallRunFeet, "LF"),
      },
    ];
  }
  return [];
}

// ---- Doors --------------------------------------------------------------------------------------

function doorQuestions(roomIndex: number, roomName: string, i: number, d: DoorRecord): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:door:${i}`;
  if (d.action === "DETACH_AND_RESET") {
    if (d.slabOnly === null)
      q.push({ id: `${base}:slabOnly`, roomName, prompt: "Is this a slab-only detach & reset (not the full frame/unit)?", kind: { type: "yesNo" } });
  } else {
    if (d.doorType === null)
      q.push({ id: `${base}:doorType`, roomName, prompt: "What type of door?", kind: { type: "choice", options: ["Colonial", "Solid core", "Hollow core", "Other"] } });
    if (d.unitType === null) q.push({ id: `${base}:unitType`, roomName, prompt: "Pre-hung unit, or slab only?", kind: { type: "choice", options: ["Pre-hung", "Slab only"] } });
    if (d.saveHardware === null) q.push({ id: `${base}:saveHardware`, roomName, prompt: "Save the existing hardware?", kind: { type: "yesNo" } });
  }
  return q;
}

// ---- Cabinetry ----------------------------------------------------------------------------------

/**
 * The extent answer that means "this is not cabinetry at all".
 *
 * Shared by the question and the handler so the two cannot drift — the handler routes on this exact
 * string, and a typo in either place would silently turn the answer into an unrecognised extent.
 */
export const VANITY_EXTENT_ANSWER = "It's a vanity";

/**
 * Insulation types, as the PM picks them. Blown-in is separate from cellulose on purpose: it is how
 * the product went in, which is what decides whether an R-value is read off a label or off a depth.
 */
const INSULATION_TYPE_OPTIONS = ["Fiberglass batt", "Blown-in", "Cellulose", "Foam"];

function parseInsulationType(answer: string): InsulationType | null {
  if (equalsIgnoreCase(answer, "Fiberglass batt")) return "FIBERGLASS_BATT";
  if (equalsIgnoreCase(answer, "Blown-in")) return "BLOWN_IN";
  if (equalsIgnoreCase(answer, "Cellulose")) return "CELLULOSE";
  if (equalsIgnoreCase(answer, "Foam")) return "FOAM";
  return null;
}

/** Batt is picked by its R-value; blown-in by the depth on site, which is what the label shows. */
function rValuePrompt(type: InsulationType, where: string): string {
  return type === "BLOWN_IN"
    ? `How deep is the blown-in insulation ${where}?`
    : `What R-value is the insulation ${where}?`;
}

/**
 * Reads an R-value answer back. Blown-in answers arrive as `10" — R26`, so the R-value is taken from
 * the option rather than parsed out of the string — the label is a display concern and the record
 * should hold the figure that ends up in the scope.
 */
function parseRValue(type: InsulationType, answer: string): string | null {
  if (type === "BLOWN_IN") {
    const match = BLOWN_IN_R_VALUES.find((o) => equalsIgnoreCase(answer, blownInLabel(o)) || equalsIgnoreCase(answer, o.rValue));
    return match ? match.rValue : null;
  }
  const batt = BATT_R_VALUES.find((r) => equalsIgnoreCase(answer, r));
  return batt ?? null;
}

/** Rooms where a "cabinet" is at least as likely to be a vanity as a run of cabinetry. */
function looksLikeBathroom(roomName: string): boolean {
  return /\b(bath|bathroom|ensuite|en[- ]?suite|powder|washroom|wc)\b/i.test(roomName);
}

function cabinetryQuestions(roomIndex: number, roomName: string, i: number, c: CabinetryRecord, onlyRecord: boolean): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:cabinetry:${i}`;

  /*
    A cabinet in a bathroom is usually a vanity, and a vanity is a different thing to scope.

    Extraction is told to record vanities as plumbing fixtures rather than cabinetry precisely
    because they carry their own questions — the top, the sink, the faucet. When it lands one in
    cabinetry instead, the tell is that nothing was said about how much of it is affected: a real
    run of cabinetry gets described by extent, a vanity just gets called a cabinet.

    Offered as a fourth extent option rather than as its own question, and only when it is the room's
    ONLY cabinetry record — "Vanity" moves the record between lists, which would shift the indices
    later answers in the same round are addressed by, and one record means there are no later answers
    to shift.

    Folding it in is what makes this terminate. It used to be a separate question that `return`ed
    early, suppressing the extent question until it was resolved — and answering "Cabinetry" is a
    decision to change nothing, so extent stayed null, the same gate fired, and the identical
    question came back for ever with nothing else in the round to make progress on. Its own comment
    claimed "the extent question follows on the next pass"; nothing moved between passes, so it
    never did. Splitting it back into two questions reintroduces that, in either direction: whichever
    one is asked first, the other's answer is what closes its gate.

    As one question every answer settles the record — three of them fill in extent, the fourth moves
    it — and the PM taps once instead of twice for the same fact.
  */
  const CABINETRY_EXTENTS = ["Uppers", "Lowers", "Full height"];
  const offeringVanity = onlyRecord && c.extent === null && looksLikeBathroom(roomName);
  if (c.extent === null) {
    q.push({
      id: `${base}:extent`, roomName,
      prompt: offeringVanity
        ? "Is this a bathroom vanity, or a run of cabinetry — and how much of it is affected?"
        : "How much of the cabinetry is affected — uppers, lowers, or full height?",
      kind: { type: "choice", options: offeringVanity ? [VANITY_EXTENT_ANSWER, ...CABINETRY_EXTENTS] : CABINETRY_EXTENTS },
    });
  }
  /*
    Held back while the vanity option is still on the table.

    Answering "It's a vanity" moves the record out of cabinetry altogether, and a vanity's grade is a
    plumbing-fixture question with its own prompt — so a grade queued in the same round is a question
    about a record that may be about to stop existing. Once extent is set this is an ordinary
    unconditional question, which is what the round after the answer sees.
  */
  if (c.action === "REMOVE_AND_REPLACE" && c.grade === null && !offeringVanity)
    q.push({
      id: `${base}:grade`, roomName, prompt: "What grade of replacement cabinetry?",
      kind: { type: "choice", options: ["Standard", "High", "Premium", "Deluxe"] },
    });
  return q;
}

// ---- Toe kicks ----------------------------------------------------------------------------------

function toeKickQuestions(roomIndex: number, roomName: string, i: number, t: ToeKickRecord): GapCheckQuestion[] {
  if (t.action !== "REMOVE_AND_REPLACE" || t.method !== null) return [];
  return [{ id: `room:${roomIndex}:toeKick:${i}:method`, roomName, prompt: "Reskin the toe kick, or a prefinished replacement?", kind: { type: "choice", options: ["Reskin", "Prefinished replacement"] } }];
}

// ---- Countertops --------------------------------------------------------------------------------

function countertopQuestions(roomIndex: number, roomName: string, i: number, c: CountertopRecord): GapCheckQuestion[] {
  if (c.material !== null) return [];
  return [{ id: `room:${roomIndex}:countertop:${i}:material`, roomName, prompt: "What material is the countertop?", kind: { type: "choice", options: ["Laminate", "Quartz", "Granite", "Solid surface"] } }];
}

// ---- Wall tile ------------------------------------------------------------------------------------

function wallTileQuestions(roomIndex: number, roomName: string, i: number, wt: WallTileRecord): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:wallTile:${i}`;
  if (wt.surface === null) q.push({ id: `${base}:surface`, roomName, prompt: "Is the tile on the wall or the floor?", kind: { type: "choice", options: ["Wall", "Floor"] } });
  if (wt.trimPresent === null) q.push({ id: `${base}:trimPresent`, roomName, prompt: "Is there tile trim present?", kind: { type: "yesNo" } });
  // Only once trim is known to be there — see the ceiling finish/textureStyle pair.
  if (wt.trimPresent === true && wt.trimLinearFt === null)
    q.push({ id: `${base}:trimLinearFt`, roomName, prompt: "How many linear feet of tile trim?", kind: { type: "decimal" } });
  return q;
}

// ---- Ceilings ---------------------------------------------------------------------------------

function ceilingQuestions(roomIndex: number, roomName: string, i: number, c: CeilingRecord): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:ceiling:${i}`;
  if (c.type === "DRYWALL_PLASTER") {
    if (c.action === "REMOVE_AND_REPLACE") {
      if (c.finish === null) q.push({ id: `${base}:finish`, roomName, prompt: "Texture or smooth finish for the ceiling?", kind: { type: "choice", options: ["Texture", "Smooth"] } });
      /*
        "Scrape and retexture" alone doesn't say which texture — a PM saying it almost never
        clarifies unprompted, so this is asked once the finish is known to BE textured.

        `=== "TEXTURE"`, never `!== "SMOOTH"`. Those differ on exactly one value — null — and that
        difference is the bug this question was reported for: while the finish was still unanswered,
        `!== "SMOOTH"` was true, so this went onto the pending list in the same round as the very
        question that decides whether it applies. Answering Smooth then left a queued question with
        neither option true, and `isComplete` counts the pending list, so the flow could not finish
        until the PM answered a question that should never have been asked.

        A three-state field must be tested for the state that means yes. Testing for "not the state
        that means no" silently includes "nobody has said yet".
      */
      if (c.finish === "TEXTURE" && c.textureStyle === null)
        q.push({
          id: `${base}:textureStyle`, roomName, prompt: "Popcorn or knockdown?",
          kind: { type: "choice", options: ["Popcorn", "Knockdown"] },
        });
      /*
        Asked whenever the ceiling is coming out, mirroring the wall version.

        It used to be gated on spaceAboveHasInsulation, which nothing ever sets — see that field's
        doc comment — so this never fired and a ceiling that came down over wet insulation had
        nowhere to record it. Ceiling drywall coming out is the same trigger the wall version uses.
      */
      if (c.aboveInsulationAffected === null)
        q.push({ id: `${base}:aboveInsulationAffected`, roomName, prompt: "Is the insulation above this ceiling affected?", kind: { type: "yesNo" } });
      // `=== true`, not `!== false` — see the finish/textureStyle pair above for why the difference
      // matters while the answer is still null.
      if (c.aboveInsulationAffected === true && c.aboveInsulationType === null)
        q.push({
          id: `${base}:aboveInsulationType`, roomName, prompt: "What type of insulation is above the ceiling?",
          kind: { type: "choice", options: INSULATION_TYPE_OPTIONS },
        });
      // Same shape as the wall's — see there for why the R-value waits on the type.
      if (c.aboveInsulationAffected === true && c.aboveInsulationType !== null && c.aboveInsulationRValue === null) {
        const options = rValueOptionsFor(c.aboveInsulationType);
        if (options.length > 0) {
          q.push({
            id: `${base}:aboveInsulationRValue`, roomName,
            prompt: rValuePrompt(c.aboveInsulationType, "above the ceiling"),
            kind: { type: "choice", options },
          });
        }
      }
      // Real quantity, same SF-or-fraction flexibility as carpet lift/wall cut run — see
      // AreaFraction. Asked regardless of texture/insulation answers, not gated behind them.
      if (c.replaceSF === null && c.replaceFraction === null)
        q.push({ id: `${base}:replaceSF`, roomName, prompt: AREA_QUANTITY_PROMPT("How much ceiling drywall is being replaced?", "ceiling"), kind: { type: "text" } });
    }
  } else if (c.type === "SUSPENDED_TILE") {
    if (c.action === "DETACH_AND_RESET" && c.detachScope === null)
      q.push({ id: `${base}:detachScope`, roomName, prompt: "Detach the tiles only, or the tiles and grid?", kind: { type: "choice", options: ["Tiles only", "Tiles and grid"] } });
    if (c.action === "REMOVE_AND_REPLACE") {
      if (c.tileSize === null) q.push({ id: `${base}:tileSize`, roomName, prompt: "What size are the replacement ceiling tiles?", kind: { type: "text" } });
      if (c.mountMethod === null) q.push({ id: `${base}:mountMethod`, roomName, prompt: "Suspended grid, or stapled/glued?", kind: { type: "choice", options: ["Suspended", "Stapled/glued"] } });
    }
  }
  return q;
}

// ---- Electrical outlets/switches ---------------------------------------------------------------

function outletQuestions(roomIndex: number, roomName: string, i: number, o: ElectricalOutletRecord): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:outlet:${i}`;
  const label = o.isOutlet ? "outlet" : "switch";
  if (o.action === "DETACH_AND_RESET" && o.detachScope === null)
    q.push({ id: `${base}:detachScope`, roomName, prompt: `Detach the full ${label}, or just the cover plate?`, kind: { type: "choice", options: ["Full outlet", "Cover plate only"] } });
  if (o.action === "REMOVE_AND_REPLACE" && o.isOutlet && o.voltage === null)
    q.push({ id: `${base}:voltage`, roomName, prompt: "What voltage is the outlet?", kind: { type: "choice", options: ["110V", "220V"] } });
  return q;
}

// ---- Light fixtures -----------------------------------------------------------------------------

function lightFixtureQuestions(roomIndex: number, roomName: string, i: number, l: LightFixtureRecord): GapCheckQuestion[] {
  if (l.action !== "REMOVE_AND_REPLACE" || l.fixtureType !== null) return [];
  return [{ id: `room:${roomIndex}:lightFixture:${i}:fixtureType`, roomName, prompt: "What type of light fixture?", kind: { type: "choice", options: ["Hanging", "Flush mount", "Chandelier", "Other"] } }];
}

// ---- Electrical panel (flag-only) ----------------------------------------------------------------

function panelQuestions(roomIndex: number, roomName: string, p: ElectricalPanelRecord): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:panel`;
  if (p.requiresInspection === null) {
    q.push({ id: `${base}:requiresInspection`, roomName, prompt: "Does the electrical panel require inspection?", kind: { type: "yesNo" } });
    return q; // amperage/meter only make sense once we know inspection is required
  }
  if (p.requiresInspection && p.includedInScope) {
    if (p.amperage === null) q.push({ id: `${base}:amperage`, roomName, prompt: "What amperage is the panel?", kind: { type: "wholeNumber" } });
    if (p.includeMeterWork === null) q.push({ id: `${base}:includeMeterWork`, roomName, prompt: "Include meter work in scope?", kind: { type: "yesNo" } });
  }
  return q;
}

// ---- Plumbing fixtures -----------------------------------------------------------------------------

function plumbingQuestions(roomIndex: number, roomName: string, i: number, p: PlumbingFixtureRecord): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:plumbing:${i}`;

  switch (p.fixtureType) {
    case "KITCHEN_SINK":
    case "BATHROOM_SINK":
      if (p.fixtureType === "KITCHEN_SINK" && p.basinCount === null)
        q.push({ id: `${base}:basinCount`, roomName, prompt: "Single or double basin?", kind: { type: "choice", options: ["Single", "Double"] } });
      if (p.mount === null)
        q.push({ id: `${base}:mount`, roomName, prompt: "How is the sink mounted — undermount, drop-in, or other?", kind: { type: "choice", options: ["Undermount", "Drop-in", "Other"] } });
      break;
    case "BATHROOM_VANITY":
      // Sink handling is not a question at all — whenever a vanity is in scope, detaching (and
      // later resetting) the sink is assumed automatically. See the "Bathroom vanity" auto-include
      // in documentGenerationPrompt.ts. Only the countertop's fate is actually asked about, and it
      // depends on which action the vanity itself has:
      if (p.action === "DETACH_AND_RESET") {
        if (p.topDetached === null)
          q.push({
            id: `${base}:topDetached`, roomName,
            prompt: "Are we detaching the countertop as well, or is it staying in place?",
            kind: { type: "yesNo", yesLabel: "Detaching", noLabel: "Staying in place" },
          });
        if (p.topDetached === true && p.topMaterial === null)
          q.push({ id: `${base}:topMaterial`, roomName, prompt: "What material is the vanity countertop?", kind: { type: "choice", options: ["Laminate", "Solid surface"] } });
      } else {
        if (p.topKept === null)
          q.push({
            id: `${base}:topKept`, roomName,
            prompt: "Are we keeping the existing countertop, or is it being replaced as part of the new vanity unit?",
            kind: { type: "yesNo", yesLabel: "Keeping it", noLabel: "Replaced with unit" },
          });
        if (p.topKept === true && p.topMaterial === null)
          q.push({ id: `${base}:topMaterial`, roomName, prompt: "What material is the vanity countertop?", kind: { type: "choice", options: ["Laminate", "Solid surface"] } });
      }
      break;
    case "TOILET":
      break; // no extra fields, ever — wax ring is implied by the action line at generation time
    case "TUB_SHOWER":
      if (p.includesSurround === null) q.push({ id: `${base}:includesSurround`, roomName, prompt: "Does this include the tub/shower surround?", kind: { type: "yesNo" } });
      if (p.includesSurround === true && p.surroundMaterial === null)
        q.push({ id: `${base}:surroundMaterial`, roomName, prompt: "Fiberglass or tile surround?", kind: { type: "choice", options: ["Fiberglass", "Tile"] } });
      break;
  }
  return q;
}

// ---- Stairs -----------------------------------------------------------------------------------

function stairsQuestions(roomIndex: number, roomName: string, s: StairRecord): GapCheckQuestion[] {
  const q: GapCheckQuestion[] = [];
  const base = `room:${roomIndex}:stairs`;
  switch (s.flooringType) {
    case "CARPET":
      if (s.riserStyle === null) q.push({ id: `${base}:riserStyle`, roomName, prompt: "Waterfall or open riser style?", kind: { type: "choice", options: ["Waterfall", "Open riser"] } });
      if (s.skirtingCarpeted === null) q.push({ id: `${base}:skirtingCarpeted`, roomName, prompt: "Is the stair skirting carpeted?", kind: { type: "yesNo" } });
      break;
    case "WOOD":
      if (s.risersFlooredAsWell === null) q.push({ id: `${base}:risersFlooredAsWell`, roomName, prompt: "Are the risers floored as well as the treads?", kind: { type: "yesNo" } });
      if (s.nosingMaterial === null) q.push({ id: `${base}:nosingMaterial`, roomName, prompt: "What material is the stair nosing?", kind: { type: "text" } });
      break;
    case "VINYL":
      if (s.nosingPresent === null) q.push({ id: `${base}:nosingPresent`, roomName, prompt: "Is stair nosing present?", kind: { type: "yesNo" } });
      break;
  }
  return q;
}

// ---- Equipment presence (round 12) -------------------------------------------------------------

/**
 * "Was drying equipment used at all" — fires only when the room has real work AND extraction found
 * zero equipment records (a PM who mentioned equipment already has records to quantity-gap-check
 * instead, via the loop right above this call in evaluate()) AND this hasn't been asked yet for
 * this room. See Room.equipmentAsked's doc comment for why a flag is needed here (contentsQuestions
 * right below doesn't need one — a size answer is itself proof of being asked).
 */
/* ── Equipment stated for the job rather than per room ─────────────────────────────────────────── */

/**
 * The id of the one consolidated equipment question, per type.
 *
 * Claim-level rather than room-level, because the whole point is that it is not about one room.
 */
export function consolidatedEquipmentId(type: string): string {
  return `equipment:allRooms:${type}`;
}

export function isConsolidatedEquipmentQuestion(questionId: string): boolean {
  return questionId.startsWith("equipment:allRooms:");
}

/**
 * Whether equipment was mentioned for the job without ever being attributed to a room.
 *
 * A PM says "six air movers and two dehus" for the whole property far more often than they walk it
 * room by room assigning units. Extraction records what was said — equipment records with no
 * quantity — and gap-check then asked "was drying equipment used in this room? how many air movers?
 * how many dehumidifiers?" of EVERY room in turn, which is the same question three times per room
 * for one fact the PM already stated once.
 *
 * Every condition here is a reason NOT to consolidate:
 *
 *   - Fewer than two rooms: there is no repetition to collapse, and a per-room question is clearer.
 *   - Any stated quantity anywhere: the transcript DID attribute equipment, so the data is already
 *     known and this must not touch it. This is the case most existing claims are in.
 *   - No equipment mentioned at all: nothing to distribute. The per-room "was any used?" backstop is
 *     a different question — it asks whether the PM forgot to mention equipment — and still fires.
 *   - A moisture map exists: it produces a measured per-room recommendation, which is a better answer
 *     than anything a PM would type into a consolidated box, and those questions arrive pre-filled
 *     so the repetition being complained about does not bite.
 */
export function equipmentNeedsConsolidating(extraction: WaterLossExtraction, suggestions?: EquipmentSuggestions): boolean {
  if (suggestions && Object.keys(suggestions).length > 0) return false;
  const withWork = extraction.rooms.filter(roomHasWork);
  if (withWork.length < 2) return false;
  if (extraction.rooms.some((r) => r.equipment.some((e) => e.quantity !== null))) return false;
  return extraction.rooms.some((r) => r.equipment.length > 0);
}

/** Equipment types mentioned anywhere on the claim, in the order first seen. */
function equipmentTypesMentioned(extraction: WaterLossExtraction): string[] {
  const seen: string[] = [];
  for (const room of extraction.rooms) {
    for (const e of room.equipment) if (!seen.includes(e.type)) seen.push(e.type);
  }
  return seen;
}

/**
 * One question per equipment type, with a count against each room that has work in it.
 *
 * Split by type rather than one grid of every room-and-type pairing: a PM placing equipment thinks
 * "where do the air movers go", then "where do the dehus go". A single control mixing both makes
 * them hold two answers at once for no saving — it is still one screen either way.
 */
function consolidatedEquipmentQuestions(extraction: WaterLossExtraction): GapCheckQuestion[] {
  const buckets = extraction.rooms
    .map((room, index) => ({ room, index }))
    .filter(({ room }) => roomHasWork(room))
    .map(({ room, index }) => ({ key: String(index), label: room.roomName || `Room ${index + 1}` }));

  return equipmentTypesMentioned(extraction)
    .filter((type) => extraction.rooms.some((r) => r.equipment.some((e) => e.type === type && e.quantity === null)))
    .map((type) => ({
      id: consolidatedEquipmentId(type),
      roomName: null,
      prompt: `How many ${type} in each room? Leave a room blank if none go there.`,
      kind: { type: "bucketCounts" as const, buckets, unit: type },
    }));
}

function equipmentPresenceQuestions(roomIndex: number, room: Room): GapCheckQuestion[] {
  if (room.equipmentAsked || room.equipment.length > 0 || !roomHasWork(room)) return [];
  return [{ id: `room:${roomIndex}:equipment:used`, roomName: room.roomName, prompt: "Was drying equipment used in this room?", kind: { type: "yesNo" } }];
}

/** True for the "was drying equipment used" question above. Exported for the same "filter by claim context one layer up" reason as isContentsSizeQuestion — this one only applies to WATER claims (see app/page.tsx's `nextQuestions`), since drying equipment is a water-loss concept specifically. */
export function isEquipmentPresenceQuestion(questionId: string): boolean {
  return /^room:\d+:equipment:used$/.test(questionId);
}

/**
 * "Was water extraction required" — round 12, per direct feedback: "one more gap check for all
 * water claims, if water extraction was not mentioned - ask if water extraction was required.
 * follow up... how much" (the "what room" part of that feedback is already satisfied by this being
 * per-room, same as every other gap-check question here; "hard surface or carpet" is deliberately
 * NOT asked — see documentGenerationPrompt.ts's auto-include 1b, which derives it from the room's
 * own flooring records instead of asking a redundant question). Skips a room that already has a
 * LIFT_AND_REINSTALL carpet record — that case is a different, narrower auto-include that's always
 * assumed true (see the same auto-include's part 1a) — so this only ever fires for the cases that
 * auto-include doesn't already cover. A sequential decision tree, same shape as wallQuestions:
 * required first, quantity only once required is confirmed true.
 */
function waterExtractionQuestions(roomIndex: number, room: Room, derived?: MoistureDerived): GapCheckQuestion[] {
  if (!roomHasWork(room)) return [];
  if (room.flooring.some((f) => f.disposition === "LIFT_AND_REINSTALL" && f.type === "CARPET")) return [];
  const base = `room:${roomIndex}:waterExtraction`;
  const q: GapCheckQuestion[] = [];
  if (room.waterExtractionRequired === null) {
    q.push({ id: `${base}:required`, roomName: room.roomName, prompt: "Was water extraction required in this room?", kind: { type: "yesNo" } });
  }
  // Only once extraction is known to have been required. `applyAnswer` also stands this down on a
  // "no"; that stays as a second line of defence, but it is no longer what keeps this out of the
  // pending list — the gate here is.
  if (room.waterExtractionRequired === true && room.waterExtractionSF === null && room.waterExtractionFraction === null) {
    q.push({
      id: `${base}:sf`,
      roomName: room.roomName,
      prompt: AREA_QUANTITY_PROMPT("How much water extraction was required?", "room"),
      kind: { type: "text" },
      ...defaultFrom(derived?.floorSquareFeet, "SF"),
    });
  }
  /*
    Containment's size, and only once containment is known to be happening.

    Deliberately NOT pre-filled from the moisture map, unlike every other area question here. A
    barrier hangs across an opening; its area has nothing to do with the floor it stands on, so
    offering the room's measured floor SF would be offering a confidently wrong number — worse than
    an empty field, because a pre-filled one is designed to be accepted.
  */
  if (room.containmentRequired === true && room.containmentSF === null) {
    q.push({
      id: `room:${roomIndex}:containment:sf`,
      roomName: room.roomName,
      prompt: 'How much containment is going up? Enter the square feet of barrier — dimensions work too, "8 x 10" is read as 80 SF.',
      kind: { type: "text" },
    });
  }
  return q;
}

/** True for either question above. Same "filter by claim context one layer up, WATER claims only" reason as isEquipmentPresenceQuestion. */
export function isWaterExtractionQuestion(questionId: string): boolean {
  return /^room:\d+:waterExtraction:(required|sf)$/.test(questionId);
}

// ---- Contents manipulation -----------------------------------------------------------------------

/**
 * Any room with emergency/repair work gets asked its content size, unless manipulation has been
 * explicitly declined for that room. The size question fires regardless of whether a
 * ContentsManipulation record exists yet (it's created on the first answer, see
 * `applyContentsAnswer`) — its absence just means nothing about contents has been said yet, not
 * that there's nothing to ask.
 */
/**
 * The four sizes, plus a way to say there is nothing to move.
 *
 * "None" exists because the question fires on any room with work in it, and a hallway with a floor
 * coming up genuinely may have nothing in it — the transcript said nothing about contents because
 * there were none. Without this the PM had to invent a size for furniture that does not exist, and
 * "Small" is not the same answer as "none": one bills a contents line, the other does not.
 *
 * Same shape as the smoke-detector question's explicit "None", and for the same reason.
 */
const CONTENTS_SIZE_OPTIONS = ["None — nothing to move", "Small", "Medium", "Large", "Extra Large"];

function contentsQuestions(roomIndex: number, room: Room): GapCheckQuestion[] {
  if (room.contents?.manipulationDeclined === true) return [];
  if (room.contents?.size != null) return [];
  if (!roomHasWork(room)) return [];
  /*
    "What size are the contents in this room?" read as a question about the ROOM's size, which is
    not what it asks. It is about how much there is to move, so it now says that, and the four
    options are described in the prompt rather than left as four bare words to interpret.
  */
  return [
    {
      id: `room:${roomIndex}:contents:size`,
      roomName: room.roomName,
      prompt:
        "How much furniture and contents need to be moved in this room? " +
        "Small (a few items), Medium (a partly furnished room), Large (a fully furnished room), " +
        "Extra Large (packed, or heavy items needing more than one person).",
      kind: { type: "choice", options: CONTENTS_SIZE_OPTIONS },
    },
  ];
}

/**
 * True for the per-room "what size are the contents" question above. Exported so a caller that
 * already knows contents is being scoped separately (see claimInfo.ts's `ScopePhase` — Contents
 * selected at all, alone or alongside structural scope) can filter it out without needing to know
 * its id shape — see app/page.tsx's `nextQuestions`. This function has no claim-awareness of its
 * own on purpose (see this file's evaluate() signature); that filtering happens one layer up, at
 * the one place claim and extraction-derived questions already meet.
 */
export function isContentsSizeQuestion(questionId: string): boolean {
  return /^room:\d+:contents:size$/.test(questionId);
}

/**
 * Questions whose answer ONLY ever affects Repair-phase rendering — never referenced anywhere in an
 * Emergency bullet's own wording (see documentGenerationPrompt.ts). Exported so a caller that
 * already knows Repair isn't selected at all (see claimInfo.ts's `ScopePhase`) can filter these out
 * without needing to know their id shape — see app/page.tsx's `nextQuestions`. Direct feedback:
 * "I ran a test selecting Emergency only and still got gap checked on baseboard sizes and such, if
 * its emergency only we shouldnt get checked on that." Same "no claim-awareness of its own" split as
 * isContentsSizeQuestion — the filtering happens one layer up.
 * - Baseboard heightIn: only asked for REMOVE_AND_REPLACE, and only feeds the new baseboard going in
 *   during Repair — Emergency's "Remove baseboard" bullet has no height in its own wording.
 * - Wall cutRunFt: feeds the Repair-side drywall-replacement quantity and priming-SF math
 *   specifically — Emergency's wall bullet is driven by cutHeight alone, never the linear footage.
 * - Cabinetry grade: describes the REPLACEMENT cabinetry going in during Repair — the old cabinetry
 *   being removed during Emergency has no "grade" of the new one to speak of.
 * - Toe kick method (reskin vs. prefinished replacement): itself describes a Repair-phase action.
 * - Ceiling finish/textureStyle/replaceSF/aboveInsulationAffected: explicitly Repair-only already,
 *   per the ceiling-drywall trade sequence in documentGenerationPrompt.ts ("Emergency for this
 *   record is unaffected by any of this... this whole sequence is Repair-only").
 */
export function isRepairOnlyQuestion(questionId: string): boolean {
  return (
    /:baseboard:\d+:heightIn$/.test(questionId) ||
    /:wall:\d+:cutRunFt$/.test(questionId) ||
    /:cabinetry:\d+:grade$/.test(questionId) ||
    /:toeKick:\d+:method$/.test(questionId) ||
    /:ceiling:\d+:(finish|textureStyle|replaceSF|aboveInsulationAffected)$/.test(questionId)
  );
}

/**
 * Questions whose answer ONLY ever affects Emergency-phase rendering — never referenced anywhere in
 * a Repair bullet's own wording. Same reasoning and caller pattern as `isRepairOnlyQuestion` above.
 * - Asbestos taken/count: "Asbestos sample collection" is a General item under Emergency only.
 * - HVAC inspection required: "Furnace/hot water tank inspection" is a General item under Emergency
 *   only.
 * - Equipment quantity (including the new "was drying equipment used" question below): drying
 *   equipment is placed during Emergency mitigation, not Repair — "Equipment pickup and monitoring"
 *   is a General item under Emergency only.
 */
export function isEmergencyOnlyQuestion(questionId: string): boolean {
  return (
    questionId === "asbestos:taken" ||
    questionId === "asbestos:count" ||
    questionId === "loss:hvacInspectionRequired" ||
    /:equipment:(\d+:quantity|used)$/.test(questionId) ||
    isWaterExtractionQuestion(questionId)
  );
}

/** Same "is there actually work happening in this room" signal used for asbestos gating, generalized across every category. */
function roomHasWork(room: Room): boolean {
  return (
    room.flooring.length > 0 ||
    room.baseboard.length > 0 ||
    room.walls.some((w) => w.drywallBeingRemoved) ||
    room.doors.length > 0 ||
    room.cabinetry.length > 0 ||
    room.toeKicks.length > 0 ||
    room.countertops.length > 0 ||
    room.wallTile.length > 0 ||
    room.ceilings.length > 0 ||
    room.outlets.length > 0 ||
    room.lightFixtures.length > 0 ||
    room.electricalPanel !== null ||
    room.plumbingFixtures.length > 0 ||
    room.stairs !== null ||
    (room.floorRegistersDetached !== null && room.floorRegistersDetached > 0) ||
    room.equipment.length > 0
  );
}

function applyContentsAnswer(c: ContentsManipulation, field: string, answer: string): ContentsManipulation {
  if (field !== "size") return c;
  /*
    "None" is recorded as manipulation DECLINED, not as a size.

    A room with nothing in it and a room with a few items are different scope outcomes — one bills a
    contents line, the other does not — so "none" cannot be folded into "Small". `manipulationDeclined`
    is the field that already means exactly this, and it is what the generation prompt and the work
    orders both read to decide whether the room gets a contents line at all.
  */
  if (isContentsNone(answer)) return { ...c, manipulationDeclined: true, size: null };
  const size = parseContentsSize(answer);
  return size === null ? c : { ...c, size, manipulationDeclined: false };
}

/** The "nothing to move" answer, matched on its leading word so the label can be reworded freely. */
function isContentsNone(answer: string): boolean {
  return answer.trim().toLowerCase().startsWith("none");
}

/** Null for an answer that is not one of the four sizes — dropped rather than defaulted. */
function parseContentsSize(answer: string): ContentsSize | null {
  if (equalsIgnoreCase(answer, "Small")) return "SMALL";
  if (equalsIgnoreCase(answer, "Medium")) return "MEDIUM";
  if (equalsIgnoreCase(answer, "Large")) return "LARGE";
  if (equalsIgnoreCase(answer, "Extra Large")) return "EXTRA_LARGE";
  return null;
}

// ---- Ceiling-triggered electrical fixtures (round 6) -----------------------------------------

/** Whenever a room has ceiling drywall replacement work at all, ask about light fixtures and any other detach/reset fixtures once, room-level (not per ceiling record). */
function ceilingFixtureQuestions(roomIndex: number, room: Room): GapCheckQuestion[] {
  const hasCeilingDrywallWork = room.ceilings.some((c) => c.type === "DRYWALL_PLASTER" && c.action === "REMOVE_AND_REPLACE");
  if (!hasCeilingDrywallWork) return [];

  const q: GapCheckQuestion[] = [];
  /*
    Presence first, then type and count together once the answer is yes.

    These three used to be asked in one round, so that a PM looking at a ceiling could say what kind
    and how many in the same breath. The gates were `!== false`, which is also true while nobody has
    answered — so a room whose fixtures turned out not to exist still had a type and a count sitting
    on the pending list, and `isComplete` counts the pending list. Type and count now wait one round
    for the presence answer; that costs one press, and it is the only version where a "no" leaves
    nothing behind.

    `applyAnswer` still drops a stray type or count on a "no". That is now belt-and-braces rather
    than the thing holding this together.
  */
  if (room.ceilingLightFixturesPresent === null) {
    q.push({ id: `room:${roomIndex}:ceilingLightFixtures:present`, roomName: room.roomName, prompt: "Are there light fixtures to detach and reset?", kind: { type: "yesNo" } });
  }
  if (room.ceilingLightFixturesPresent === true && room.ceilingLightFixtureType === null) {
    q.push({
      id: `room:${roomIndex}:ceilingLightFixtures:type`, roomName: room.roomName, prompt: "What type of light fixture?",
      kind: { type: "choice", options: ["Regular fixture", "Recessed", "Recessed trim only", "Chandelier"] },
    });
  }
  if (room.ceilingLightFixturesPresent === true && room.ceilingLightFixtureCount === null) {
    q.push({ id: `room:${roomIndex}:ceilingLightFixtures:count`, roomName: room.roomName, prompt: "How many light fixtures?", kind: { type: "wholeNumber" } });
  }
  if (room.otherCeilingFixtures === null) {
    q.push({
      id: `room:${roomIndex}:otherCeilingFixtures`, roomName: room.roomName,
      prompt: "Any smoke detectors or other fixtures to detach and reset? (Enter \"None\" if not.)",
      kind: { type: "text" },
    });
  }

  /*
    Where the fixtures sit decides which phase(s) their detach and reset belong to.

    Only worth asking once something is actually coming down — a room with no fixtures and no other
    fixtures has no phase to decide. Asked rather than inferred: see
    `Room.ceilingFixturesInRemovalArea`.
  */
  const hasFixtures =
    room.ceilingLightFixturesPresent === true ||
    (room.otherCeilingFixtures !== null && room.otherCeilingFixtures.trim() !== "" && !isEffectivelyNone(room.otherCeilingFixtures));
  if (hasFixtures && room.ceilingFixturesInRemovalArea === null) {
    q.push({
      id: `room:${roomIndex}:ceilingFixtures:inRemovalArea`,
      roomName: room.roomName,
      prompt: "Are those fixtures inside the area of ceiling actually being removed, or do they only need to come down for the retexturing?",
      kind: { type: "choice", options: ["Inside the removal area", "Only for retexturing"] },
    });
  }
  return q;
}

// ---- Applying an answer -----------------------------------------------------------------------

/**
 * Applies one raw UI answer to the tree, returning a new `WaterLossExtraction`. `answer` is
 * whatever the UI collected for the question's `GapCheckQuestionKind` — "yes"/"no" for yesNo, the
 * exact option label for choice, or a raw number string for wholeNumber/decimal. Malformed
 * numeric input is ignored (returns the tree unchanged) rather than throwing — the UI is expected
 * to validate before calling this.
 */
export function applyAnswer(extraction: WaterLossExtraction, questionId: string, answer: string): WaterLossExtraction {
  const parts = questionId.split(":");

  /*
    The consolidated equipment answer distributes one tally across every room at once.

    Written here rather than as N per-room answers because it IS one answer — the PM said "six air
    movers" for the job, and splitting that into six writes the UI would have to keep in step is
    exactly the bookkeeping this question exists to remove.

    A room given zero is recorded as asked-and-none rather than left blank, so the per-room "was any
    equipment used here?" backstop does not come straight back for it.
  */
  if (isConsolidatedEquipmentQuestion(questionId)) {
    const type = questionId.slice("equipment:allRooms:".length);
    const counts = parseBucketCounts(answer);
    return {
      ...extraction,
      rooms: extraction.rooms.map((room, index) => {
        if (!roomHasWork(room)) return room;
        const count = counts[String(index)] ?? 0;
        const existing = room.equipment.findIndex((e) => e.type === type);
        const equipment =
          existing === -1
            ? count > 0
              ? [...room.equipment, { type, quantity: count }]
              : room.equipment
            : room.equipment.map((e, i) => (i === existing ? { ...e, quantity: count } : e));
        return { ...room, equipment, equipmentAsked: true };
      }),
    };
  }

  if (questionId === "asbestos:taken") return { ...extraction, loss: { ...extraction.loss, asbestosSamplesTaken: isYes(answer) } };
  if (questionId === "asbestos:count") {
    // Both parts are asked in one round now, so a count can arrive alongside a "no". The presence
    // answer is applied first, so by here the tree already says so — and a stray number typed next
    // to it must not be recorded as though samples had been taken.
    if (extraction.loss.asbestosSamplesTaken === false) return extraction;
    const n = toIntOrNull(answer);
    return n === null ? extraction : { ...extraction, loss: { ...extraction.loss, asbestosSampleCount: n } };
  }
  if (questionId === "loss:hvacInspectionRequired") return { ...extraction, loss: { ...extraction.loss, hvacInspectionRequired: isYes(answer) } };

  if (parts.length >= 3 && parts[0] === "room" && parts[2] === "roomName") {
    const name = answer.trim();
    return name === "" ? extraction : updateRoom(extraction, roomIndex(parts), (room) => ({ ...room, roomName: name }));
  }

  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "equipment" && parts[3] === "used") {
    return updateRoom(extraction, roomIndex(parts), (room) =>
      isYes(answer)
        ? { ...room, equipmentAsked: true, equipment: [...room.equipment, { type: "air movers", quantity: null }, { type: "dehumidifiers", quantity: null }] }
        : { ...room, equipmentAsked: true },
    );
  }

  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "waterExtraction" && parts[3] === "required") {
    return updateRoom(extraction, roomIndex(parts), (room) => ({ ...room, waterExtractionRequired: isYes(answer) }));
  }
  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "containment" && parts[3] === "sf") {
    const { sf } = parseAreaQuantity(answer);
    if (sf === null) return extraction;
    // Asked in the same round as nothing else, but the same defensive shape as water extraction: a
    // room that turned out not to need containment must not acquire a barrier size.
    return updateRoom(extraction, roomIndex(parts), (room) =>
      room.containmentRequired === false ? room : { ...room, containmentSF: sf },
    );
  }

  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "waterExtraction" && parts[3] === "sf") {
    const { sf, fraction } = parseAreaQuantity(answer);
    if (sf === null && fraction === null) return extraction;
    // Asked in the same round as "was it required", so an amount can arrive next to a "no".
    return updateRoom(extraction, roomIndex(parts), (room) =>
      room.waterExtractionRequired === false ? room : { ...room, waterExtractionSF: sf, waterExtractionFraction: fraction },
    );
  }

  /*
    Window cleaning: presence, then a count and a size that only mean anything if the answer was yes.

    Presence is applied first — it comes first in the question list, and answers are applied in that
    order — so by the time the count and size arrive the tree already records the decision. Both
    check it and stand down on a no, which is what stops a stray number typed next to a "no" from
    being recorded as though windows were being cleaned after all.
  */
  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "ceilingFixtures" && parts[3] === "inRemovalArea") {
    return updateRoom(extraction, roomIndex(parts), (room) => ({
      ...room,
      ceilingFixturesInRemovalArea: equalsIgnoreCase(answer, "Inside the removal area"),
    }));
  }

  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "windowCleaning") {
    const field = parts[3];
    return updateRoom(extraction, roomIndex(parts), (room) => {
      if (field === "present") {
        // "No" records the empty tally, which is what closes the follow-up out — see the generator.
        return isYes(answer)
          ? { ...room, windowCleaningAsked: true }
          : { ...room, windowCleaningAsked: true, windowCleaningCounts: {} };
      }

      // Answered "no" already: nothing further applies.
      if (room.windowCleaningAsked && totalWindowsToClean(room.windowCleaningCounts) === 0 && room.windowCleaningCounts !== null) {
        return room;
      }

      if (field === "counts") {
        const parsed = parseBucketCounts(answer);
        const counts: Partial<Record<WindowCleaningSize, number>> = {};
        for (const band of WINDOW_CLEANING_SIZES) {
          const n = parsed[band];
          if (n !== undefined && n > 0) counts[band] = n;
        }
        /*
          An all-zero tally is still an answer — the PM opened the question and said none of any
          size. Recording the empty map is what closes it; leaving it null would re-ask for ever.
        */
        return { ...room, windowCleaningCounts: counts };
      }
      return room;
    });
  }

  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "baseboard" && parts[3] === "action") {
    return updateRoom(extraction, roomIndex(parts), (room) => {
      if (room.baseboardConfirmedAbsent) return room;
      /*
        "No baseboard in this area" is an answer, not a non-answer. It closes the question by
        recording the absence, exactly as the separate presence question used to — without it the
        room would be asked for ever, since nothing else can satisfy a completeness check whose whole
        premise the PM has just rejected.
      */
      if (equalsIgnoreCase(answer, NO_BASEBOARD_OPTION)) return { ...room, baseboardConfirmedAbsent: true };
      // An unrecognised action creates no record at all, so the question comes back rather than a
      // baseboard being invented with the wrong disposition — see `baseboardActionAnswer`.
      const action = baseboardActionAnswer(answer);
      if (action === null) return room;
      return { ...room, baseboard: [...room.baseboard, blankBaseboardRecord(action)] };
    });
  }

  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "panel") {
    return updateRoom(extraction, roomIndex(parts), (room) => ({
      ...room,
      electricalPanel: room.electricalPanel ? applyPanelAnswer(room.electricalPanel, parts[3]!, answer) : room.electricalPanel,
    }));
  }

  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "stairs") {
    return updateRoom(extraction, roomIndex(parts), (room) => ({
      ...room,
      stairs: room.stairs ? applyStairsAnswer(room.stairs, parts[3]!, answer) : room.stairs,
    }));
  }

  // Unlike panel/stairs (only ever answered once extraction already created the record), contents
  // questions fire whether or not a ContentsManipulation exists yet — this creates one on first
  // answer instead of no-op'ing on null.
  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "contents") {
    return updateRoom(extraction, roomIndex(parts), (room) => ({
      ...room,
      contents: applyContentsAnswer(room.contents ?? blankContentsManipulation(), parts[3]!, answer),
    }));
  }

  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "ceilingLightFixtures" && parts[3] === "present") {
    return updateRoom(extraction, roomIndex(parts), (room) => ({ ...room, ceilingLightFixturesPresent: isYes(answer) }));
  }
  /*
    Type and count ride with the presence question, so both are dropped when the answer was no.

    Presence is listed first and answers apply in order, so by the time these arrive the room
    already records it — which is what stops a type or a count typed next to a "no" being kept.
  */
  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "ceilingLightFixtures" && parts[3] === "type") {
    let fixtureType: RoomLightFixtureType;
    if (equalsIgnoreCase(answer, "Regular fixture")) fixtureType = "REGULAR";
    else if (equalsIgnoreCase(answer, "Recessed")) fixtureType = "RECESSED";
    else if (equalsIgnoreCase(answer, "Recessed trim only")) fixtureType = "RECESSED_TRIM_ONLY";
    else fixtureType = "CHANDELIER";
    return updateRoom(extraction, roomIndex(parts), (room) =>
      room.ceilingLightFixturesPresent === false ? room : { ...room, ceilingLightFixtureType: fixtureType },
    );
  }
  if (parts.length >= 4 && parts[0] === "room" && parts[2] === "ceilingLightFixtures" && parts[3] === "count") {
    const count = toIntOrNull(answer);
    if (count === null || count < 0) return extraction;
    return updateRoom(extraction, roomIndex(parts), (room) =>
      room.ceilingLightFixturesPresent === false ? room : { ...room, ceilingLightFixtureCount: count },
    );
  }
  if (parts.length >= 3 && parts[0] === "room" && parts[2] === "otherCeilingFixtures") {
    return updateRoom(extraction, roomIndex(parts), (room) => ({ ...room, otherCeilingFixtures: answer }));
  }

  if (parts.length >= 3 && parts[0] === "room" && parts[2] === "floorRegistersDetached") {
    const count = toIntOrNull(answer);
    return count === null ? extraction : updateRoom(extraction, roomIndex(parts), (room) => ({ ...room, floorRegistersDetached: count }));
  }

  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "flooring") {
    return updateFlooring(extraction, roomIndex(parts), Number(parts[3]), (f) => applyFlooringAnswer(f, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "baseboard") {
    return updateBaseboard(extraction, roomIndex(parts), Number(parts[3]), (b) => applyBaseboardAnswer(b, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "wall") {
    return updateWall(extraction, roomIndex(parts), Number(parts[3]), (w) => applyWallAnswer(w, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "door") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.doors, (r, l) => ({ ...r, doors: l }), (d) => applyDoorAnswer(d, parts[4]!, answer));
  }
  /*
    Answering the extent question "Vanity" moves the record between lists rather than editing it.

    A vanity belongs in plumbingFixtures — that is where the top, sink and faucet questions hang off,
    and where the generation prompt looks for it. Leaving it in cabinetry and merely labelling it
    would mean the scope described a vanity while none of the vanity follow-ups ever fired.

    The other three answers fall through to `applyCabinetryAnswer` below and set `extent` normally.
    Every answer therefore changes something, which is what stops the question being re-asked — see
    the option list in `cabinetryQuestions`.
  */
  if (
    parts.length >= 5 && parts[0] === "room" && parts[2] === "cabinetry" && parts[4] === "extent" &&
    equalsIgnoreCase(answer, VANITY_EXTENT_ANSWER)
  ) {
    const index = Number(parts[3]);
    return updateRoom(extraction, roomIndex(parts), (room) => {
      const moving = room.cabinetry[index];
      if (!moving) return room;
      return {
        ...room,
        cabinetry: room.cabinetry.filter((_, i) => i !== index),
        plumbingFixtures: [
          ...room.plumbingFixtures,
          {
            fixtureType: "BATHROOM_VANITY" as PlumbingFixtureType,
            action: moving.action,
            basinCount: null,
            mount: null,
            sinkAlsoNeeded: null,
            topDetached: null,
            topKept: null,
            topMaterial: null,
            sinkFaucetSaved: null,
            grade: null,
            includesSurround: null,
            surroundMaterial: null,
          },
        ],
      };
    });
  }

  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "cabinetry") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.cabinetry, (r, l) => ({ ...r, cabinetry: l }), (c) => applyCabinetryAnswer(c, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "toeKick") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.toeKicks, (r, l) => ({ ...r, toeKicks: l }), (t) => applyToeKickAnswer(t, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "countertop") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.countertops, (r, l) => ({ ...r, countertops: l }), (c) => applyCountertopAnswer(c, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "wallTile") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.wallTile, (r, l) => ({ ...r, wallTile: l }), (wt) => applyWallTileAnswer(wt, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "ceiling") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.ceilings, (r, l) => ({ ...r, ceilings: l }), (c) => applyCeilingAnswer(c, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "outlet") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.outlets, (r, l) => ({ ...r, outlets: l }), (o) => applyOutletAnswer(o, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "lightFixture") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.lightFixtures, (r, l) => ({ ...r, lightFixtures: l }), (lf) => applyLightFixtureAnswer(lf, parts[4]!, answer));
  }
  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "plumbing") {
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.plumbingFixtures, (r, l) => ({ ...r, plumbingFixtures: l }), (p) => applyPlumbingAnswer(p, parts[4]!, answer));
  }
  /*
    Confirm-or-suggest.

    "keep" deliberately leaves the tree alone — the PM's number is already what is recorded. But that
    is NOT what stops the question coming back: nothing about the tree changed, so re-evaluating with
    the same suggestions would ask again, and a second, different answer would overwrite the first
    without a trace. That shipped, and it is what `equipmentSuggestionKey` exists to prevent — the
    caller retires the suggestion once it has been answered either way. See its doc comment.
  */
  /*
    The equipment plan answer: a number, or "none".

    "none" is recorded as a quantity of ZERO rather than left null. Null means "nobody has said",
    which is what put the question here in the first place; zero is a decision, and it is what lets
    the documents state that no drying equipment was required rather than silently omitting it.
  */
  if (parts.length >= 6 && parts[0] === "room" && parts[2] === "equipment" && parts[4] === "plan") {
    const qty = answer.trim().toLowerCase() === "none" ? 0 : toIntOrNull(answer);
    if (qty === null || qty < 0) return extraction;
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.equipment, (r, l) => ({ ...r, equipment: l }), (e) => ({ ...e, quantity: qty }));
  }

  if (parts.length >= 6 && parts[0] === "room" && parts[2] === "equipment" && parts[4] === "suggest") {
    if (answer.toLowerCase() !== "adopt") return extraction;
    const suggested = toIntOrNull(parts[5] ?? "");
    if (suggested === null) return extraction;
    // Written as if the PM had stated this number themselves — document generation needs no special case.
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.equipment, (r, l) => ({ ...r, equipment: l }), (e) => ({ ...e, quantity: suggested }));
  }

  if (parts.length >= 5 && parts[0] === "room" && parts[2] === "equipment" && parts[4] === "quantity") {
    const qty = toIntOrNull(answer);
    if (qty === null) return extraction;
    return updateList(extraction, roomIndex(parts), Number(parts[3]), (r) => r.equipment, (r, l) => ({ ...r, equipment: l }), (e) => ({ ...e, quantity: qty }));
  }

  return extraction;
}

function roomIndex(parts: string[]): number {
  return Number(parts[1]);
}
function isYes(answer: string): boolean {
  return answer.toLowerCase() === "yes";
}
/**
 * The answers a PM gives when they mean "there aren't any".
 *
 * Mirrors the generation prompt's own effectively-"none" rule for `otherCeilingFixtures`, so the
 * question about where fixtures sit is not asked for a room whose only answer was "none".
 */
function isEffectivelyNone(value: string): boolean {
  return ["none", "n/a", "na", "no", "nothing", "-"].includes(value.trim().toLowerCase());
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
function toIntOrNull(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}
function toDoubleOrNull(s: string): number | null {
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Shared by every "real count" quantity that also accepts a qualitative fraction instead of an
 * exact number (carpet lift/pad removal, wall drywall cut run, ceiling drywall replacement) — see
 * `AreaFraction` in types.ts. A plain `{type:"text"}` question rather than a dedicated kind: the
 * prompt itself explains the accepted forms, and this parses whatever comes back.
 */
/**
 * The sentence that says a number came from the sketch rather than from nowhere.
 *
 * Always shown alongside a pre-filled value. A quantity that appears in a field without explanation
 * is one a PM has to either trust blindly or re-derive, and neither is what a measured map is for.
 */
function derivedNote(value: number | null | undefined, unit: string): string {
  return value == null || value <= 0 ? "" : ` The moisture map measures ${quantityText(value)} ${unit} — confirm or edit.`;
}

/** Pre-fills the input, or contributes nothing at all when there is no measurement. */
function defaultFrom(value: number | null | undefined, unit: string): { defaultValue?: string } {
  return value == null || value <= 0 ? {} : { defaultValue: `${quantityText(value)} ${unit}` };
}

function AREA_QUANTITY_PROMPT(question: string, ofWhat: string, unit: "SF" | "linear feet" = "SF"): string {
  const dimensions = unit === "SF" ? ` Dimensions work too — "6 x 8" is read as 48 SF.` : "";
  return `${question} Enter an exact ${unit} number, or say "quarter", "half", "three quarters," or "full" of the ${ofWhat}.${dimensions}`;
}

/**
 * "6 x 8", "6 by 8", "6' x 8'" — the two numbers multiplied, or null if that is not what this is.
 *
 * A PM standing in a room has the two sides, not the product; making them do the arithmetic is how
 * a typo becomes a scope quantity. Only ever tried for areas — a linear-feet question asking for one
 * number would read "6 x 8" as something the PM did not mean, so the caller decides.
 */
function parseDimensions(answer: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:x|by|\*|×)\s*(\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:sf|sq\.?\s*ft\.?)?\s*$/i.exec(answer);
  if (!m) return null;
  const a = Number.parseFloat(m[1]!);
  const b = Number.parseFloat(m[2]!);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  // Two decimals: 6.5 × 8.3 is 53.95, and a floating-point tail on an insurer's scope reads as noise.
  return Math.round(a * b * 100) / 100;
}

function parseAreaQuantity(answer: string, unit: "SF" | "linear feet" = "SF"): { sf: number | null; fraction: AreaFraction | null } {
  const t = answer.trim().toLowerCase();
  if (t === "quarter" || t === "a quarter" || t === "1/4" || t === "25%") return { sf: null, fraction: "QUARTER" };
  if (t === "half" || t === "a half" || t === "1/2" || t === "50%") return { sf: null, fraction: "HALF" };
  if (t === "three quarters" || t === "3/4" || t === "75%") return { sf: null, fraction: "THREE_QUARTERS" };
  if (t === "full" || t === "all" || t === "whole" || t === "100%") return { sf: null, fraction: "FULL" };
  /*
    Dimensions are tried before the single-number parse, because `toDoubleOrNull` reads "6 x 8" as a
    plain 6 and would silently scope an eighth of the floor.

    For a LINEAR question they are refused outright rather than multiplied — a wall run has one
    dimension, so "6 x 8" is not an answer to it, and leaving the question open sends the PM back to
    it. Taking the 6 is the one outcome that puts a wrong number on the scope with nothing to show
    for it.
  */
  const dimensions = parseDimensions(answer);
  if (dimensions !== null) return unit === "SF" ? { sf: dimensions, fraction: null } : { sf: null, fraction: null };
  const n = toDoubleOrNull(answer);
  return n === null ? { sf: null, fraction: null } : { sf: n, fraction: null };
}

/**
 * An action answer, and the disposition that action implies.
 *
 * disposition isn't its own gap-check question — it follows from the action: detach-and-reset means
 * the existing baseboard is salvaged (it goes back down); remove-and-replace means the old one is
 * disposed of, not salvaged; shoe mold only has no disposition concept at all.
 *
 * Shared by the two places an action is recorded — the completeness tree, where the answer creates
 * the record, and `applyBaseboardAnswer`, where it fills in one extraction already produced — so a
 * record cannot end up describing itself two different ways depending on which route it took.
 */
/**
 * Null for an answer that is none of the three, rather than falling through to remove-and-replace.
 *
 * The fallback was silent and load-bearing in the wrong direction: remove-and-replace is the ONLY
 * action that goes on to demand a height and a material, so an answer that failed to match — a
 * relabelled option, a typo — did not merely record the wrong action, it also conjured two spec
 * questions about a baseboard that was being put straight back down.
 */
function baseboardActionAnswer(answer: string): Pick<BaseboardRecord, "action" | "disposition"> | null {
  if (equalsIgnoreCase(answer, "Shoe mold removed and replaced")) return { action: "SHOE_MOLD_ONLY", disposition: null };
  if (equalsIgnoreCase(answer, "Detached and reset on repairs")) return { action: "DETACH_AND_RESET", disposition: "SALVAGE_DRY" };
  if (equalsIgnoreCase(answer, "Removed and replaced")) return { action: "REMOVE_AND_REPLACE", disposition: "REMOVE_AND_DISPOSE" };
  return null;
}

function blankBaseboardRecord(overrides: Partial<BaseboardRecord>): BaseboardRecord {
  return { material: null, heightIn: null, wallRunFt: null, action: null, disposition: null, phase: null, phaseUncertain: false, mdfProfile: null, ...overrides };
}
function blankContentsManipulation(): ContentsManipulation {
  return { size: null, manipulationDeclined: false, affected: false };
}

function applyFlooringAnswer(f: FlooringRecord, field: string, answer: string): FlooringRecord {
  switch (field) {
    /*
      Matched explicitly, with an unrecognised answer DROPPED rather than defaulting.

      Both of these were a two-way ternary — "Solid" or else engineered, "Floating" or else glued —
      so the moment a third option existed every one of its answers silently became the fallback.
      Adding Prefinished, Other and Nailed to the lists without this would have recorded a nailed
      floor as glued, which is a wrong spec that reads as a real one.
    */
    case "hardwoodConstruction": {
      const construction = equalsIgnoreCase(answer, "Solid")
        ? "SOLID"
        : equalsIgnoreCase(answer, "Engineered")
          ? "ENGINEERED"
          : equalsIgnoreCase(answer, "Prefinished")
            ? "PREFINISHED"
            : equalsIgnoreCase(answer, "Other")
              ? "OTHER"
              : null;
      if (construction === null) return f;
      // Changing away from Other invalidates whatever was typed against it.
      return { ...f, hardwoodConstruction: construction, hardwoodConstructionOther: construction === "OTHER" ? f.hardwoodConstructionOther : null };
    }
    case "hardwoodConstructionOther":
      return f.hardwoodConstruction === "OTHER" ? { ...f, hardwoodConstructionOther: answer.trim() || null } : f;
    case "hardwoodInstallation": {
      const install = equalsIgnoreCase(answer, "Floating")
        ? "FLOATING"
        : equalsIgnoreCase(answer, "Glued")
          ? "GLUED"
          : equalsIgnoreCase(answer, "Nailed")
            ? "NAILED"
            : null;
      return install === null ? f : { ...f, hardwoodInstallation: install };
    }
    case "vinylSubtype":
      return { ...f, vinylSubtype: (equalsIgnoreCase(answer, "Sheet") ? "SHEET" : "PLANK") as VinylSubtype };
    case "vinylInstallation":
      return { ...f, vinylInstallation: (equalsIgnoreCase(answer, "Glued") ? "GLUED" : "SNAPLOCK_FLOATING") as VinylInstallation };
    case "padPresent":
      return { ...f, padPresent: isYes(answer) };
    case "padRemoved":
      return { ...f, padRemoved: isYes(answer) };
    case "type": {
      const named = FLOORING_TYPE_OPTIONS.find((t) => equalsIgnoreCase(answer, t));
      return named === undefined ? f : { ...f, type: named.toUpperCase() as FlooringType };
    }
    case "removalSF": {
      const { sf, fraction } = parseAreaQuantity(answer);
      return sf === null && fraction === null ? f : { ...f, removalSF: sf, removalFraction: fraction };
    }
    case "carpetLiftSF": {
      const { sf, fraction } = parseAreaQuantity(answer);
      return sf === null && fraction === null ? f : { ...f, carpetLiftSF: sf, carpetLiftFraction: fraction };
    }
    case "padRemovedSF": {
      const { sf, fraction } = parseAreaQuantity(answer);
      return sf === null && fraction === null ? f : { ...f, padRemovedSF: sf, padRemovedFraction: fraction };
    }
    case "phase":
      return { ...f, phase: parsePhase(answer) };
    default:
      return f;
  }
}

function applyBaseboardAnswer(b: BaseboardRecord, field: string, answer: string): BaseboardRecord {
  /*
    Material and height are asked alongside the action, before it is known — so they are dropped
    here when the action turns out not to want them. A shoe-mold-only job has no baseboard material
    to specify, and a baseboard that is only being detached and reset is the existing one going back
    down, not a new height being chosen.
  */
  if (b.action === "SHOE_MOLD_ONLY" && (field === "material" || field === "heightIn")) return b;
  if (field === "heightIn" && b.action !== "REMOVE_AND_REPLACE") return b;

  switch (field) {
    /*
      The one question that unlocks every other one on this record — see baseboardRecordQuestions.
      It carries the disposition with it, exactly as the completeness tree's own action answer does:
      the two routes to an action must not produce records that describe themselves differently.
    */
    case "action":
      return { ...b, ...baseboardActionAnswer(answer) };
    case "material": {
      // One combined choice sets both material and mdfProfile (round 6) — see the question side
      // in baseboardRecordQuestions for why. mdfProfile stays null for the two non-MDF options.
      if (equalsIgnoreCase(answer, "Solid wood")) return { ...b, material: "SOLID_WOOD", mdfProfile: null };
      if (equalsIgnoreCase(answer, "Flat MDF")) return { ...b, material: "MDF", mdfProfile: "FLAT" as BaseboardMdfProfile };
      if (equalsIgnoreCase(answer, "MDF with profile")) return { ...b, material: "MDF", mdfProfile: "PROFILE" as BaseboardMdfProfile };
      return { ...b, material: "VINYL_PVC_COMPOSITE" as BaseboardMaterial, mdfProfile: null };
    }
    case "heightIn": {
      const v = toDoubleOrNull(answer);
      return v === null ? b : { ...b, heightIn: v };
    }
    case "phase":
      return { ...b, phase: parsePhase(answer) };
    default:
      return b;
  }
}

function applyWallAnswer(w: WallRecord, field: string, answer: string): WallRecord {
  switch (field) {
    case "insulationAffected":
      return { ...w, insulationAffected: isYes(answer) };
    case "insulationType": {
      // Rides with the affected question, so it is dropped when that came back no.
      if (w.insulationAffected === false) return w;
      const insulationType = parseInsulationType(answer);
      /*
        An unrecognised answer is now DROPPED rather than silently recorded as foam. The old chain
        ended in a bare `else insulationType = "FOAM"`, so anything that was not batt or cellulose —
        including a typo, and including the newly added blown-in before it was handled — became foam
        in the scope. A missing type gets asked again; a wrong one never does.
      */
      if (insulationType === null) return w;
      // The R-value belongs to the type. Changing the type invalidates it, so it is cleared rather
      // than left describing a product that is no longer selected.
      return { ...w, insulationType, insulationRValue: insulationType === w.insulationType ? w.insulationRValue : null };
    }
    case "insulationRValue": {
      if (w.insulationAffected === false || w.insulationType === null) return w;
      const parsed = parseRValue(w.insulationType, answer);
      return parsed === null ? w : { ...w, insulationRValue: parsed };
    }
    case "cutHeight": {
      let cutHeight: WallDrywallCutHeight;
      if (equalsIgnoreCase(answer, "2 feet")) cutHeight = "TWO_FOOT";
      else if (equalsIgnoreCase(answer, "4 feet")) cutHeight = "FOUR_FOOT";
      else if (answer.toLowerCase().startsWith("full")) cutHeight = "FULL_WALL";
      else cutHeight = "BASE";
      return { ...w, cutHeight };
    }
    case "cutRunFt": {
      // Linear, not an area — see `parseAreaQuantity` on why "6 x 8" is refused here.
      const { sf, fraction } = parseAreaQuantity(answer, "linear feet");
      return sf === null && fraction === null ? w : { ...w, cutRunFt: sf, cutRunFraction: fraction };
    }
    default:
      return w;
  }
}

function applyDoorAnswer(d: DoorRecord, field: string, answer: string): DoorRecord {
  switch (field) {
    case "slabOnly":
      return { ...d, slabOnly: isYes(answer) };
    case "doorType": {
      let doorType: DoorType;
      if (equalsIgnoreCase(answer, "Colonial")) doorType = "COLONIAL";
      else if (equalsIgnoreCase(answer, "Solid core")) doorType = "SOLID_CORE";
      else if (equalsIgnoreCase(answer, "Hollow core")) doorType = "HOLLOW_CORE";
      else doorType = "OTHER";
      return { ...d, doorType };
    }
    case "unitType":
      return { ...d, unitType: (equalsIgnoreCase(answer, "Pre-hung") ? "PRE_HUNG" : "SLAB_ONLY") as DoorUnitType };
    case "saveHardware":
      return { ...d, saveHardware: isYes(answer) };
    default:
      return d;
  }
}

function applyCabinetryAnswer(c: CabinetryRecord, field: string, answer: string): CabinetryRecord {
  switch (field) {
    case "extent": {
      let extent: CabinetryExtent;
      if (equalsIgnoreCase(answer, "Uppers")) extent = "UPPERS";
      else if (equalsIgnoreCase(answer, "Lowers")) extent = "LOWERS";
      else extent = "FULL_HEIGHT";
      return { ...c, extent };
    }
    case "grade": {
      let grade: CabinetryGrade;
      if (equalsIgnoreCase(answer, "Standard")) grade = "STANDARD";
      else if (equalsIgnoreCase(answer, "High")) grade = "HIGH";
      else if (equalsIgnoreCase(answer, "Premium")) grade = "PREMIUM";
      else grade = "DELUXE";
      return { ...c, grade };
    }
    default:
      return c;
  }
}

function applyToeKickAnswer(t: ToeKickRecord, field: string, answer: string): ToeKickRecord {
  if (field === "method") return { ...t, method: (equalsIgnoreCase(answer, "Reskin") ? "RESKIN" : "PREFINISHED_REPLACEMENT") as ToeKickMethod };
  return t;
}

function applyCountertopAnswer(c: CountertopRecord, field: string, answer: string): CountertopRecord {
  if (field === "material") {
    /*
      Matched explicitly, with an unrecognised answer left alone rather than defaulting.

      This used to fall through to GRANITE for anything it did not recognise, so adding a fourth
      option would have silently recorded every "Solid surface" answer as granite. A wrong material
      that looks deliberate is worse than a missing one.
    */
    if (equalsIgnoreCase(answer, "Laminate")) return { ...c, material: "LAMINATE" };
    if (equalsIgnoreCase(answer, "Quartz")) return { ...c, material: "QUARTZ" };
    if (equalsIgnoreCase(answer, "Granite")) return { ...c, material: "GRANITE" };
    if (equalsIgnoreCase(answer, "Solid surface")) return { ...c, material: "SOLID_SURFACE" };
    return c;
  }
  return c;
}

function applyWallTileAnswer(wt: WallTileRecord, field: string, answer: string): WallTileRecord {
  switch (field) {
    case "surface":
      return { ...wt, surface: (equalsIgnoreCase(answer, "Wall") ? "WALL" : "FLOOR") as WallTileSurface };
    case "trimPresent":
      return { ...wt, trimPresent: isYes(answer) };
    case "trimLinearFt": {
      // Asked beside "is there trim" — a length next to a "no" is not a length.
      if (wt.trimPresent === false) return wt;
      const v = toDoubleOrNull(answer);
      return v === null ? wt : { ...wt, trimLinearFt: v };
    }
    default:
      return wt;
  }
}

function applyCeilingAnswer(c: CeilingRecord, field: string, answer: string): CeilingRecord {
  switch (field) {
    case "finish":
      return { ...c, finish: equalsIgnoreCase(answer, "Texture") ? "TEXTURE" : "SMOOTH" };
    case "textureStyle": {
      // Asked beside the finish question — a smooth ceiling has no texture style to record.
      if (c.finish === "SMOOTH") return c;
      const textureStyle: CeilingTextureStyle = equalsIgnoreCase(answer, "Popcorn") ? "POPCORN" : "KNOCKDOWN";
      return { ...c, textureStyle };
    }
    case "replaceSF": {
      const { sf, fraction } = parseAreaQuantity(answer);
      return sf === null && fraction === null ? c : { ...c, replaceSF: sf, replaceFraction: fraction };
    }
    case "aboveInsulationAffected": {
      const affected = isYes(answer);
      // Saying no clears any type already given, so the two can never disagree.
      return { ...c, aboveInsulationAffected: affected, aboveInsulationType: affected ? c.aboveInsulationType : null };
    }
    case "aboveInsulationType": {
      if (c.aboveInsulationAffected === false) return c;
      const aboveInsulationType = parseInsulationType(answer);
      if (aboveInsulationType === null) return c;
      // Same as the wall's: the R-value describes the type, so a changed type clears it.
      return {
        ...c,
        aboveInsulationType,
        aboveInsulationRValue: aboveInsulationType === c.aboveInsulationType ? c.aboveInsulationRValue : null,
      };
    }
    case "aboveInsulationRValue": {
      if (c.aboveInsulationAffected === false || c.aboveInsulationType === null) return c;
      const parsed = parseRValue(c.aboveInsulationType, answer);
      return parsed === null ? c : { ...c, aboveInsulationRValue: parsed };
    }
    case "detachScope":
      return { ...c, detachScope: equalsIgnoreCase(answer, "Tiles only") ? "TILES_ONLY" : "TILES_AND_GRID" };
    case "tileSize":
      return { ...c, tileSize: answer };
    case "mountMethod":
      return { ...c, mountMethod: equalsIgnoreCase(answer, "Suspended") ? "SUSPENDED" : "STAPLED_GLUED" };
    default:
      return c;
  }
}

function applyOutletAnswer(o: ElectricalOutletRecord, field: string, answer: string): ElectricalOutletRecord {
  switch (field) {
    case "detachScope":
      return { ...o, detachScope: (equalsIgnoreCase(answer, "Full outlet") ? "FULL_OUTLET" : "COVER_PLATE_ONLY") as OutletDetachScope };
    case "voltage":
      return { ...o, voltage: (answer === "110V" ? "V110" : "V220") as OutletVoltage };
    default:
      return o;
  }
}

function applyLightFixtureAnswer(l: LightFixtureRecord, field: string, answer: string): LightFixtureRecord {
  if (field === "fixtureType") {
    let fixtureType: LightFixtureType;
    if (equalsIgnoreCase(answer, "Hanging")) fixtureType = "HANGING";
    else if (equalsIgnoreCase(answer, "Flush mount")) fixtureType = "FLUSH_MOUNT";
    else if (equalsIgnoreCase(answer, "Chandelier")) fixtureType = "CHANDELIER";
    else fixtureType = "OTHER";
    return { ...l, fixtureType };
  }
  return l;
}

function applyPanelAnswer(p: ElectricalPanelRecord, field: string, answer: string): ElectricalPanelRecord {
  switch (field) {
    case "requiresInspection":
      return { ...p, requiresInspection: isYes(answer) };
    case "amperage": {
      const v = toIntOrNull(answer);
      return v === null ? p : { ...p, amperage: v };
    }
    case "includeMeterWork":
      return { ...p, includeMeterWork: isYes(answer) };
    default:
      return p;
  }
}

function applyPlumbingAnswer(p: PlumbingFixtureRecord, field: string, answer: string): PlumbingFixtureRecord {
  switch (field) {
    case "basinCount":
      return { ...p, basinCount: (equalsIgnoreCase(answer, "Single") ? "SINGLE" : "DOUBLE") as BasinCount };
    case "mount": {
      let mount: SinkMount;
      if (equalsIgnoreCase(answer, "Undermount")) mount = "UNDERMOUNT";
      else if (equalsIgnoreCase(answer, "Drop-in")) mount = "DROP_IN";
      else mount = "OTHER";
      return { ...p, mount };
    }
    case "sinkAlsoNeeded":
      return { ...p, sinkAlsoNeeded: isYes(answer) };
    case "topDetached":
      return { ...p, topDetached: isYes(answer) };
    case "topKept":
      return { ...p, topKept: isYes(answer) };
    case "topMaterial":
      return { ...p, topMaterial: (equalsIgnoreCase(answer, "Laminate") ? "LAMINATE" : "SOLID_SURFACE") as VanityTopMaterial };
    case "sinkFaucetSaved":
      return { ...p, sinkFaucetSaved: isYes(answer) };
    case "grade":
      return { ...p, grade: answer };
    case "includesSurround":
      return { ...p, includesSurround: isYes(answer) };
    case "surroundMaterial":
      return { ...p, surroundMaterial: (equalsIgnoreCase(answer, "Fiberglass") ? "FIBERGLASS" : "TILE") as SurroundMaterial };
    default:
      return p;
  }
}

function applyStairsAnswer(s: StairRecord, field: string, answer: string): StairRecord {
  switch (field) {
    case "riserStyle":
      return { ...s, riserStyle: (equalsIgnoreCase(answer, "Waterfall") ? "WATERFALL" : "OPEN_RISER") as StairRiserStyle };
    case "skirtingCarpeted":
      return { ...s, skirtingCarpeted: isYes(answer) };
    case "risersFlooredAsWell":
      return { ...s, risersFlooredAsWell: isYes(answer) };
    case "nosingMaterial":
      return { ...s, nosingMaterial: answer };
    case "nosingPresent":
      return { ...s, nosingPresent: isYes(answer) };
    default:
      return s;
  }
}

function parsePhase(answer: string): WorkPhase {
  if (equalsIgnoreCase(answer, "Emergency")) return "EMERGENCY";
  if (equalsIgnoreCase(answer, "Repair")) return "REPAIR";
  return "BOTH";
}

// ---- Nested-copy helpers ------------------------------------------------------------------------

function updateRoom(extraction: WaterLossExtraction, index: number, transform: (room: Room) => Room): WaterLossExtraction {
  return { ...extraction, rooms: extraction.rooms.map((r, i) => (i === index ? transform(r) : r)) };
}

function updateFlooring(extraction: WaterLossExtraction, roomIdx: number, flooringIndex: number, transform: (f: FlooringRecord) => FlooringRecord): WaterLossExtraction {
  return updateRoom(extraction, roomIdx, (room) => ({ ...room, flooring: room.flooring.map((f, i) => (i === flooringIndex ? transform(f) : f)) }));
}

function updateBaseboard(extraction: WaterLossExtraction, roomIdx: number, baseboardIndex: number, transform: (b: BaseboardRecord) => BaseboardRecord): WaterLossExtraction {
  return updateRoom(extraction, roomIdx, (room) => ({ ...room, baseboard: room.baseboard.map((b, i) => (i === baseboardIndex ? transform(b) : b)) }));
}

function updateWall(extraction: WaterLossExtraction, roomIdx: number, wallIndex: number, transform: (w: WallRecord) => WallRecord): WaterLossExtraction {
  return updateRoom(extraction, roomIdx, (room) => ({ ...room, walls: room.walls.map((w, i) => (i === wallIndex ? transform(w) : w)) }));
}

/** Generic "update the Nth item of one of Room's list fields" helper, used by every other record type. */
function updateList<T>(
  extraction: WaterLossExtraction,
  roomIdx: number,
  itemIndex: number,
  getList: (room: Room) => T[],
  setList: (room: Room, list: T[]) => Room,
  transform: (item: T) => T,
): WaterLossExtraction {
  return updateRoom(extraction, roomIdx, (room) => setList(room, getList(room).map((item, i) => (i === itemIndex ? transform(item) : item))));
}
