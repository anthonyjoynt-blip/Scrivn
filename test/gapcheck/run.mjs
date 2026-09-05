/**
 * Gap-check must terminate.
 *
 *   npm run test:gapcheck
 *
 * The whole engine is a loop: ask questions, apply the answers, ask again, stop when there is
 * nothing left. Nothing in it guarantees that stopping ever happens — a question whose trigger
 * survives its own answer comes back every round, and the PM is left pressing Continue on a form
 * that will not advance.
 *
 * That is not a hypothetical: it was reported from the field. So this drives the real engine the
 * way the real UI does — answer every question in the round, apply them in order, regenerate — and
 * fails with the ids of whatever will not die.
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { declaredState, savedKeys, notPersisted, appliedSetters } from "./persistRule.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXTRACTABLE, DELIBERATELY_ASKED, fieldKeyFor } from "./extractable.mjs";
import { checkResetClearsEveryState } from "./resetRule.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "gapcheck-tests-"));
const bundlePath = join(outDir, "bundle.mjs");

await build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root },
  logLevel: "error",
});

const mod = await import(pathToFileURL(bundlePath).href);
const {
  evaluate,
  applyAnswer,
  withDerivedFields,
  emptyClaimInfo,
  claimInfoQuestions,
  isClaimInfoQuestion,
  applyClaimAnswer,
  isContentsSizeQuestion,
  isRepairOnlyQuestion,
  isEmergencyOnlyQuestion,
  isEquipmentPresenceQuestion,
  isWaterExtractionQuestion,
  resolveRound,
  totalWindowsToClean,
  canApplyToAllRooms,
  siblingQuestionIds,
  equipmentNeedsConsolidating,
  consolidatedEquipmentId,
  recordRound,
  formatQuestionLog,
  hasQuestionLog,
  canonicalRecordShapes,
} = mod;

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}

/*
  The page's own function, imported rather than re-implemented.

  This used to be a hand copy of the claim page's claim-context filtering, which is a copy that
  drifts: the suite could pass against filtering the product no longer did. `nextQuestions` and
  `resolveRound` now live in `lib/questionRound.ts` precisely so both callers are the same code.
*/
const nextQuestions = mod.nextQuestions;

/**
 * What a PM would type. `choose` lets a test steer particular questions — answering the ceiling
 * finish "Smooth" is the whole point of the reported case.
 */
function answerFor(q, choose) {
  const steered = choose(q);
  if (steered !== undefined) return steered;
  if (q.defaultValue !== undefined) return q.defaultValue;
  switch (q.kind.type) {
    case "choice":
      return q.kind.options[0];
    case "yesNo":
      return "Yes";
    case "wholeNumber":
      return "2";
    case "decimal":
      return "2.5";
    case "bucketCounts":
      // One of each bucket — exercises the multi-band path rather than collapsing to a single value.
      return q.kind.buckets.map((b) => `${b.key}:1`).join(",");
    case "text":
      /*
        Every free-text question in the engine is an area quantity, and an area quantity is parsed —
        an unparseable answer is discarded and the question comes straight back. "n/a" here made the
        whole suite look like it had found a hang in the ceiling and extraction quantities, when all
        it had found was the harness typing nonsense into a field that asks for a number.
      */
      return "100 SF";
    default:
      return "n/a";
  }
}

/**
 * Runs the loop the way the page does. Returns how it ended.
 *
 * Every question in a round gets answered, because every question in a round is answerable — that is
 * the invariant `findPrematureQuestions` below enforces. This loop checks the other half: that
 * answering them all actually gets you out.
 */
function runToCompletion(claim, extraction, choose = () => undefined, maxRounds = 40) {
  let c = claim;
  let e = withDerivedFields(extraction);
  const seen = [];
  for (let round = 0; round < maxRounds; round += 1) {
    const questions = nextQuestions(c, e);
    // The finished tree comes back too: "did it terminate" is half the question, and "what did it
    // end up recording" is the other half — a field nobody was asked about is invisible to the first.
    if (questions.length === 0) return { ok: true, rounds: round, seen, claim: c, extraction: e };
    seen.push(questions.map((q) => q.id));

    for (const q of questions) {
      const answer = answerFor(q, choose);
      if (isClaimInfoQuestion(q.id)) {
        const result = applyClaimAnswer(c, e, q.id, answer);
        c = result.claim;
        e = result.extraction;
      } else {
        e = applyAnswer(e, q.id, answer);
      }
    }
    e = withDerivedFields(e);
  }
  // Whatever is in every one of the last few rounds is what will not die.
  const tail = seen.slice(-3);
  const stuck = tail.length === 0 ? [] : tail[0].filter((id) => tail.every((r) => r.includes(id)));
  return { ok: false, rounds: maxRounds, stuck, seen, claim: c, extraction: e };
}

/**
 * No question may be asked before it is known whether it applies.
 *
 * This is the reported bug, stated as a property. "Popcorn or knockdown?" appeared in the same round
 * as "Texture or smooth?", so answering Smooth left a question on screen with neither option true
 * and no way to dismiss it. The termination loop above cannot see this — it answers everything, so
 * it always gets out.
 *
 * The probe is mechanical: answer ONE question, regenerate, and see what else vanished. Anything
 * that disappears without having been answered was never really being asked — it was waiting on the
 * answer just given, and it should not have been on the pending list until that answer existed.
 *
 * There is deliberately no exemption. An earlier version let a question opt out by declaring what it
 * depended on, and the UI hid it — but `isComplete` is `questions.length === 0`, computed from the
 * engine's list and not the screen's, so a hidden question still held the flow open. The only fix
 * that reaches every consumer is not generating it, so that is the only thing this accepts.
 */
function answerSpace(q) {
  if (q.kind.type === "choice") return q.kind.options;
  if (q.kind.type === "yesNo") return ["Yes", "No"];
  return [];
}

function findPrematureQuestions(claim, extraction, maxRounds = 40) {
  let c = claim;
  let e = withDerivedFields(extraction);
  const found = [];
  for (let round = 0; round < maxRounds; round += 1) {
    const questions = nextQuestions(c, e);
    if (questions.length === 0) break;

    for (const parent of questions) {
      for (const option of answerSpace(parent)) {
        let probeClaim = c;
        let probe = e;
        if (isClaimInfoQuestion(parent.id)) {
          const r = applyClaimAnswer(probeClaim, probe, parent.id, option);
          probeClaim = r.claim;
          probe = r.extraction;
        } else {
          probe = applyAnswer(probe, parent.id, option);
        }
        const after = new Set(nextQuestions(probeClaim, withDerivedFields(probe)).map((q) => q.id));
        for (const dependent of questions) {
          if (dependent.id === parent.id || after.has(dependent.id)) continue;
          found.push(`${dependent.id} vanishes when ${parent.id} is answered "${option}"`);
        }
      }
    }

    for (const q of questions) {
      const answer = answerFor(q, () => undefined);
      if (isClaimInfoQuestion(q.id)) {
        const r = applyClaimAnswer(c, e, q.id, answer);
        c = r.claim;
        e = r.extraction;
      } else {
        e = applyAnswer(e, q.id, answer);
      }
    }
    e = withDerivedFields(e);
  }
  return [...new Set(found)];
}

/* ── Fixtures ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every field of `Room`, defaulted the way a freshly-extracted room arrives: nothing answered.
 *
 * All of them, deliberately. A missing field reads as `undefined`, which is not `null` — the gates
 * here are written against `null`, so an omitted field either skips a question silently or throws
 * inside a generator that assumed a string. Both hide whatever the test was meant to find.
 */
function room(name, overrides = {}) {
  return {
    roomName: name,
    flooring: [],
    baseboard: [],
    walls: [],
    doors: [],
    cabinetry: [],
    toeKicks: [],
    countertops: [],
    wallTile: [],
    ceilings: [],
    outlets: [],
    lightFixtures: [],
    electricalPanel: null,
    plumbingFixtures: [],
    stairs: null,
    floorRegistersDetached: null,
    contents: null,
    equipment: [],
    waterExtractionRequired: null, antimicrobialApplied: null, containmentRequired: null, containmentSF: null, hepaVacuumingRequired: null, appliances: [],
    waterExtractionSF: null,
    waterExtractionFraction: null,
    baseboardConfirmedAbsent: false,
    windowCleaningAsked: false,
    windowCleaningCounts: null,
    equipmentAsked: false,
    ceilingLightFixturesPresent: null,
    ceilingFixturesInRemovalArea: null,
    ceilingLightFixtureType: null,
    ceilingLightFixtureCount: null,
    otherCeilingFixtures: null,
    ...overrides,
  };
}

function extractionWith(rooms, loss = {}) {
  return {
    loss: {
      category: 1,
      lossClass: 2,
      source: "Supply line",
      dateOfLoss: "2026-08-30",
      yearOfBuilding: 1998,
      asbestosTestingRequired: false,
      asbestosSamplesTaken: null,
      asbestosSampleCount: null,
      ...loss,
    },
    rooms,
  };
}

const claim = {
  ...emptyClaimInfo(),
  customerName: "Test",
  jobNumber: "J-1",
  insurer: "Other",
  lossType: "WATER",
  waterCategory: 1,
  waterClass: 2,
  scopePhases: ["EMERGENCY", "REPAIR"],
  address: "1 Test St",
  pmName: "PM",
  dateOfLoss: "2026-08-30",
};

/* ── The reported case: a ceiling answered SMOOTH ──────────────────────────────────────────────── */

/*
  One room carrying a record of every kind, each with its optional fields null and an action that
  triggers the follow-ups. This is the shape that finds a question with no working handler: a
  question whose answer does not change the extraction regenerates identically for ever, and the
  loop below is the only thing that notices.
*/
function everyRecordRoom(name) {
  return room(name, {
    flooring: [
      {
        type: "CARPET", carpetStyle: null, padPresent: null, vinylSubtype: null, vinylInstallation: null,
        vinylSubstrate: null, hardwoodConstruction: null, hardwoodConstructionOther: null, hardwoodInstallation: null,
        disposition: "REMOVE_AND_DISPOSE", phase: null, phaseUncertain: true, padRemoved: null,
        removalSF: null, removalFraction: null, cleaningRequired: null, cleaningRequired: null,
        carpetLiftSF: null, carpetLiftFraction: null, padRemovedSF: null, padRemovedFraction: null,
      },
    ],
    baseboard: [
      { material: null, heightIn: null, wallRunFt: null, action: null, disposition: "REMOVE_AND_DISPOSE", phase: null, phaseUncertain: true, mdfProfile: null },
    ],
    walls: [
      { wallMaterial: "DRYWALL", drywallBeingRemoved: true, insulationAffected: null, insulationType: null, insulationRValue: null, floodCutHeightIn: null, cutHeight: null, cutRunFt: null, cutRunFraction: null },
    ],
    doors: [{ location: "Entry", action: "REMOVE_AND_REPLACE", slabOnly: null, doorType: null, unitType: null, saveHardware: null }],
    cabinetry: [{ location: "Base run", action: "REMOVE_AND_REPLACE", extent: null, grade: null }],
    toeKicks: [{ action: "REMOVE_AND_REPLACE", method: null }],
    countertops: [{ action: "REMOVE_AND_REPLACE", material: null }],
    wallTile: [{ surface: null, trimPresent: null, trimLinearFt: null }],
    ceilings: [
      {
        type: "DRYWALL_PLASTER", action: "REMOVE_AND_REPLACE", finish: null, textureStyle: null, spaceAboveHasInsulation: true,
        aboveInsulationAffected: null, aboveInsulationType: null, aboveInsulationRValue: null, detachScope: null, tileSize: null,
        mountMethod: null, replaceSF: null, replaceFraction: null,
      },
    ],
    outlets: [{ action: "DETACH_AND_RESET", isOutlet: true, detachScope: null, voltage: null }],
    lightFixtures: [{ action: "DETACH_AND_RESET", fixtureType: null }],
    plumbingFixtures: [
      {
        fixtureType: "SINK", action: "DETACH_AND_RESET", basinCount: null, mount: null, sinkAlsoNeeded: null,
        topDetached: null, topKept: null, topMaterial: null, sinkFaucetSaved: null, grade: null,
        includesSurround: null, surroundMaterial: null,
      },
    ],
    stairs: { flooringType: "CARPET", riserStyle: null, skirtingCarpeted: null, risersFlooredAsWell: null, nosingMaterial: null, nosingPresent: null },
    electricalPanel: { requiresInspection: null, includedInScope: true, amperage: null, includeMeterWork: null },
    equipment: [{ type: "air movers", quantity: null }],
    contents: null,
  });
}

/* ── The reported case: a ceiling answered SMOOTH ──────────────────────────────────────────────── */

const oneRoom = extractionWith([everyRecordRoom("Bedroom")]);

/*
  The fixture is checked before anything is concluded from it.

  Every `action` above started out as "REPLACE", which is not a value the enum has — so the ceiling,
  door, cabinetry and countertop branches never fired and the whole suite passed while testing
  nothing. A fixture full of plausible-looking strings fails silently; this is what makes it speak up.
*/
const firstRound = nextQuestions(claim, withDerivedFields(oneRoom)).map((q) => q.id);
for (const required of [
  "room:0:ceiling:0:finish",
  "room:0:cabinetry:0:extent",
  "room:0:door:0:doorType",
  "room:0:wall:0:insulationAffected",
  "room:0:windowCleaning:present",
]) {
  check(firstRound.includes(required), `fixture actually asks ${required} (it asked: ${firstRound.join(", ")})`);
}

/*
  The reported bug, named directly.

  It is not enough that the flow completes, and it is not enough that the UI hides the question: the
  requirement is that "popcorn or knockdown" is never QUEUED for a ceiling that isn't textured. So
  these assert on the engine's pending list — the same list `isComplete` counts — rather than on
  anything a screen decided to show.
*/
const TEXTURE_STYLE = "room:0:ceiling:0:textureStyle";

check(
  !firstRound.includes(TEXTURE_STYLE),
  `textureStyle is not queued while the finish is still unanswered (round 1 asked: ${firstRound.join(", ")})`,
);

/** Every question id this run ever put on the pending list, across every round. */
function idsEverAsked(choose) {
  const result = runToCompletion(claim, oneRoom, choose);
  return { ok: result.ok, ids: new Set((result.seen ?? []).flat()), stuck: result.stuck ?? [] };
}

const smooth = idsEverAsked((q) => (q.id.endsWith(":finish") ? "Smooth" : undefined));
check(smooth.ok, `a ceiling answered Smooth completes (stuck on: ${smooth.stuck.join(", ") || "n/a"})`);
check(!smooth.ids.has(TEXTURE_STYLE), "a ceiling answered Smooth never queues textureStyle, in any round");

// The other half: gating it must not make it unreachable. A textured ceiling still gets asked.
const textured = idsEverAsked((q) => (q.id.endsWith(":finish") ? "Texture" : undefined));
check(textured.ok, `and so does one answered Texture (stuck on: ${textured.stuck.join(", ") || "n/a"})`);
check(textured.ids.has(TEXTURE_STYLE), "a ceiling answered Texture does still get asked which texture");

/* ── Every question, answered every way ────────────────────────────────────────────────────────── */

const twoRooms = extractionWith([everyRecordRoom("Kitchen"), everyRecordRoom("Bathroom")]);

const allFirst = runToCompletion(claim, twoRooms);
check(allFirst.ok, `two fully-populated rooms complete on first-option answers (stuck on: ${(allFirst.stuck ?? []).join(", ") || "n/a"})`);

const allLast = runToCompletion(claim, twoRooms, (q) => (q.kind.type === "choice" ? q.kind.options[q.kind.options.length - 1] : undefined));
check(allLast.ok, `and on last-option answers (stuck on: ${(allLast.stuck ?? []).join(", ") || "n/a"})`);

// "No" everywhere is where a dependent gets orphaned: its gate closes and its own answer is discarded.
const allNo = runToCompletion(claim, twoRooms, (q) => {
  if (q.kind.type === "yesNo") return "No";
  if (q.id.endsWith(":finish")) return "Smooth";
  return undefined;
});
check(allNo.ok, `answering No to every yes/no completes (stuck on: ${(allNo.stuck ?? []).join(", ") || "n/a"})`);

const allYes = runToCompletion(claim, twoRooms, (q) => (q.kind.type === "yesNo" ? "Yes" : undefined));
check(allYes.ok, `and Yes to every yes/no (stuck on: ${(allYes.stuck ?? []).join(", ") || "n/a"})`);

// Zero is a real answer, and the classic way a count question fails to record itself.
const zeros = runToCompletion(claim, twoRooms, (q) => (q.kind.type === "wholeNumber" ? "0" : undefined));
check(zeros.ok, `answering 0 to every count completes (stuck on: ${(zeros.stuck ?? []).join(", ") || "n/a"})`);

/* ── The reported case: a baseboard removed and never replaced ─────────────────────────────────── */

/*
  Reported from the field. One claim's Emergency section carried "Remove baseboard – MDF baseboard,
  profiled – perimeter" for a bathroom and its Repair section said nothing about that baseboard at
  all, while the bedroom and closet in the same claim — same material, same work — each got their
  "Replace baseboard" line. The one difference between the rooms was a single field: extraction had
  captured an action for the bedroom's record and not for the bathroom's.

  Nothing ever asked for it. Every question on a baseboard record is gated on its action, so a record
  that arrived without one was asked its material and nothing else, and gap-check reported complete
  with the action still null — and the replacement half of the job is keyed off exactly that field in
  both outputs, the scope document (documentGenerationPrompt.ts) and the Finish Carpentry work order
  (workOrders.ts). The missing height was the visible symptom; the unasked action is the bug.
*/

/**
 * The shape extraction actually produces (see extractionWire.ts's baseboardToDomain): material,
 * disposition and mdfProfile are always null out of extraction, and action only when the PM said so.
 */
function extractedBaseboard(overrides = {}) {
  return { material: null, heightIn: null, wallRunFt: null, action: null, disposition: null, phase: null, phaseUncertain: false, mdfProfile: null, ...overrides };
}
function removalFlooring() {
  return {
    type: "VINYL", carpetStyle: null, padPresent: null, vinylSubtype: "SHEET", vinylInstallation: null,
    vinylSubstrate: null, hardwoodConstruction: null, hardwoodConstructionOther: null, hardwoodInstallation: null,
    disposition: "REMOVE_AND_DISPOSE", phase: null, phaseUncertain: false, padRemoved: null,
    removalSF: null, removalFraction: null, cleaningRequired: null,
    carpetLiftSF: null, carpetLiftFraction: null, padRemovedSF: null, padRemovedFraction: null,
  };
}

const BATHROOM = 0;
const BEDROOM = 1;
// Exactly the two rooms of the report: the action stated for one of them and not for the other.
const reportedRooms = extractionWith([
  room("Basement Bathroom", { flooring: [removalFlooring()], baseboard: [extractedBaseboard()] }),
  room("Basement Bedroom", { flooring: [removalFlooring()], baseboard: [extractedBaseboard({ action: "REMOVE_AND_REPLACE" })] }),
]);

const BB_ACTION = "room:0:baseboard:0:action";
const BB_HEIGHT = "room:0:baseboard:0:heightIn";

const bbOpen = nextQuestions(claim, withDerivedFields(reportedRooms)).map((q) => q.id);
check(
  bbOpen.includes(BB_ACTION),
  `a baseboard record with no action is asked what is happening to it (asked: ${bbOpen.filter((id) => id.includes("baseboard")).join(", ") || "nothing at all about the baseboard"})`,
);
// And only that, for now — material and height both depend on the answer, so neither can be queued yet.
check(!bbOpen.includes(BB_HEIGHT), "and not its height in the same breath — that only applies once it is being replaced");

/*
  The answer that was never available: replacing it surfaces the height — the question the bedroom
  got and the bathroom did not.
*/
const bbReplacing = resolveRound(claim, reportedRooms, { [BB_ACTION]: "Removed and replaced" });
check(
  bbReplacing.extraction.rooms[BATHROOM].baseboard[0].action === "REMOVE_AND_REPLACE",
  `answering it records the action (got ${bbReplacing.extraction.rooms[BATHROOM].baseboard[0].action})`,
);
check(
  bbReplacing.questions.some((q) => q.id === BB_HEIGHT),
  `and surfaces the height in the same round (open: ${bbReplacing.questions.map((q) => q.id).filter((id) => id.includes("baseboard")).join(", ") || "nothing"})`,
);

// Detached-only ends somewhere else entirely, and must not ask for a height it will never use.
const bbDetaching = resolveRound(claim, reportedRooms, { [BB_ACTION]: "Detached and reset on repairs" });
const detached = bbDetaching.extraction.rooms[BATHROOM].baseboard[0];
check(
  detached.action === "DETACH_AND_RESET" && detached.disposition === "SALVAGE_DRY",
  `detached-only records the action and the salvage it implies (got ${JSON.stringify(detached)})`,
);
check(!bbDetaching.questions.some((q) => q.id === BB_HEIGHT), "and asks no height for a baseboard going back down as it is");

/*
  The asymmetry itself, as the property it violated: the room whose action extraction captured and
  the room whose it didn't must end up describing the same job, once both have been asked.
*/
const bbBoth = runToCompletion(claim, reportedRooms, (q) => {
  if (!q.id.includes(":baseboard:")) return undefined;
  if (q.id.endsWith(":action")) return "Removed and replaced";
  if (q.id.endsWith(":material")) return "MDF with profile";
  return undefined;
});
check(bbBoth.ok, `the reported claim completes (stuck on: ${(bbBoth.stuck ?? []).join(", ") || "n/a"})`);
const bath = bbBoth.extraction.rooms[BATHROOM].baseboard[0];
const bed = bbBoth.extraction.rooms[BEDROOM].baseboard[0];
check(
  bath.action === "REMOVE_AND_REPLACE" && bed.action === "REMOVE_AND_REPLACE",
  `both rooms end up removed-and-replaced (bathroom ${bath.action}, bedroom ${bed.action})`,
);
check(
  bath.heightIn !== null && bed.heightIn !== null,
  `and both end up with a height for what is going back in (bathroom ${bath.heightIn}, bedroom ${bed.heightIn})`,
);
check(
  bath.material === bed.material && bath.mdfProfile === bed.mdfProfile,
  `described identically otherwise (bathroom ${bath.material}/${bath.mdfProfile}, bedroom ${bed.material}/${bed.mdfProfile})`,
);

/*
  The general form, over the fixtures carrying every kind of record: whatever the PM answers, a
  completed gap-check cannot leave behind a baseboard that never said what was happening to it.
  Everything downstream keyed on the action — the scope document's Repair portion, the Finish
  Carpentry order — renders nothing at all for such a record, silently.
*/
for (const [label, choose] of [
  ["first-option answers", () => undefined],
  ["last-option answers", (q) => (q.kind.type === "choice" ? q.kind.options[q.kind.options.length - 1] : undefined)],
]) {
  const done = runToCompletion(claim, twoRooms, choose);
  const unanswered = done.extraction.rooms.flatMap((r) => r.baseboard.filter((b) => b.action === null).map(() => r.roomName));
  check(unanswered.length === 0, `no baseboard finishes gap-check without an action, on ${label} (left null in: ${unanswered.join(", ")})`);
}

/*
  The claim-level asbestos question reads a baseboard's disposition to decide whether there is any
  removal work at all, and answering the action rewrites that disposition to match. So the fixture
  that matters is one where the baseboard is the ONLY removal signal in a pre-1990 building: that is
  where "there is removal work" could flip to false mid-round and take an already-asked question off
  the screen with it.
*/
const asbestosEra = extractionWith(
  [room("Bathroom", { baseboard: [extractedBaseboard({ disposition: "REMOVE_AND_DISPOSE" })] })],
  { yearOfBuilding: 1980 },
);
const bbPremature = findPrematureQuestions(claim, asbestosEra);
check(
  bbPremature.length === 0,
  `answering the baseboard action takes no other question off the screen\n         ${bbPremature.join("\n         ")}`,
);

/* ── Nothing is asked before it is known to apply ──────────────────────────────────────────────── */

/* ── Follow-ups arrive on the answer, not on the next submit ───────────────────────────────────── */

/*
  `resolveRound` is what the claim page renders from: it folds the answers on screen into a draft and
  re-runs the engine, so a dependent question appears the moment its trigger is answered rather than
  one press of Continue later. These check that directly, because the whole complaint was about WHEN
  a question shows up, and the round-at-a-time loop above cannot see timing at all.
*/
const windowRoom = extractionWith([everyRecordRoom("Study")]);
const WINDOWS_PRESENT = "room:0:windowCleaning:present";
const WINDOW_COUNTS = "room:0:windowCleaning:counts";

const beforeWindows = resolveRound(claim, windowRoom, {});
check(
  beforeWindows.questions.some((q) => q.id === WINDOWS_PRESENT),
  "the window presence question is open before anything is answered",
);
check(
  !beforeWindows.questions.some((q) => q.id === WINDOW_COUNTS),
  "and the size tally is not, since nobody has said there are windows",
);

// The same round, with only that one answer added — no submit in between.
const afterYes = resolveRound(claim, windowRoom, { [WINDOWS_PRESENT]: "Yes" });
check(
  afterYes.questions.some((q) => q.id === WINDOW_COUNTS),
  "answering yes surfaces the size tally in the same round",
);

/*
  An answered question stays on screen.

  Folding an answer into the draft stops the engine asking, so the OPEN list loses it immediately —
  and rendering that list alone made each question vanish the moment it was answered, taking the
  answer with it. Nothing could be re-read or corrected. `display` is what the form renders.
*/
check(
  !afterYes.questions.some((q) => q.id === WINDOWS_PRESENT),
  "an answered question leaves the open list",
);
check(
  afterYes.display.some((q) => q.id === WINDOWS_PRESENT),
  "but stays on screen so it can be re-read and changed",
);
check(
  afterYes.display.some((q) => q.id === WINDOW_COUNTS),
  "alongside the follow-up it revealed",
);
// First-seen order: the trigger keeps its place and the follow-up lands after it, rather than the
// form reshuffling into answered-then-open every time somebody taps something.
const presentAt = afterYes.display.findIndex((q) => q.id === WINDOWS_PRESENT);
const countsAt = afterYes.display.findIndex((q) => q.id === WINDOW_COUNTS);
check(presentAt < countsAt, `the follow-up renders after its trigger (${presentAt} then ${countsAt})`);

const afterNo = resolveRound(claim, windowRoom, { [WINDOWS_PRESENT]: "No" });
check(
  !afterNo.questions.some((q) => q.id === WINDOW_COUNTS),
  "answering no never surfaces it",
);

/*
  Retracting an answer must retract what it pulled in.

  The counts stay in the answers map — the PM may flip back — but they must not reach the tree once
  the question that justified them has stopped being asked. Applying the whole answer map blindly is
  what would record windows for a room the PM just said has none.
*/
const retracted = resolveRound(claim, windowRoom, { [WINDOWS_PRESENT]: "No", [WINDOW_COUNTS]: "SF_3_9:4" });
check(
  !retracted.applied.some((q) => q.id === WINDOW_COUNTS),
  "a tally typed then retracted is never folded into the tree",
);
check(
  totalWindowsToClean(retracted.extraction.rooms[0].windowCleaningCounts) === 0,
  `and the room records no windows (got ${JSON.stringify(retracted.extraction.rooms[0].windowCleaningCounts)})`,
);

/* ── Windows of different sizes ─────────────────────────────────────────────────────────────────── */

/*
  The reported limitation: "if i said 2 windows i couldnt say 2 different sizes". One tally, several
  bands, so a room with a mix survives into the scope at the right rates.
*/
const mixed = resolveRound(claim, windowRoom, {
  [WINDOWS_PRESENT]: "Yes",
  [WINDOW_COUNTS]: "SF_10_20:2,SF_41_60:1",
});
const counts = mixed.extraction.rooms[0].windowCleaningCounts;
check(counts?.SF_10_20 === 2 && counts?.SF_41_60 === 1, `two size bands are both recorded (got ${JSON.stringify(counts)})`);
check(totalWindowsToClean(counts) === 3, `and total three windows (got ${totalWindowsToClean(counts)})`);
check(counts?.SF_3_9 === undefined, "with untouched bands left absent rather than zeroed in");

// All zeroes is a real answer — the PM opened the tally and said none of any size.
const noneOfAny = resolveRound(claim, windowRoom, { [WINDOWS_PRESENT]: "Yes", [WINDOW_COUNTS]: "" });
check(
  !noneOfAny.questions.some((q) => q.id === WINDOW_COUNTS),
  "an all-zero tally closes the question rather than re-asking for ever",
);

/* ── A sub-room inherits, rather than being asked all over again ───────────────────────────────── */

/*
  A closet drawn inside a bedroom is one space for most of what gap-check asks: same ceiling, same
  drying setup, same windows. Its own flooring and door still get asked about, because those really
  do differ. Nesting reaches the engine through the moisture map's `parentRoomKey` — see MoistureDerived.
*/
const nested = extractionWith([everyRecordRoom("Bedroom"), everyRecordRoom("Bedroom Closet")]);
const nestedSuggestions = {
  bedroom: { equipment: {}, floorSquareFeet: null, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: null },
  "bedroom closet": { equipment: {}, floorSquareFeet: null, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: "bedroom" },
};

const nestedIds = nextQuestions(claim, withDerivedFields(nested), nestedSuggestions).map((q) => q.id);
const askedOf = (roomIndex) => nestedIds.filter((id) => id.startsWith(`room:${roomIndex}:`));

for (const roomWide of ["ceiling:0:finish", "windowCleaning:present", "contents:size", "floorRegistersDetached"]) {
  check(
    askedOf(0).some((id) => id === `room:0:${roomWide}`),
    `the parent room is still asked ${roomWide} (asked: ${askedOf(0).join(", ")})`,
  );
  check(
    !askedOf(1).some((id) => id === `room:1:${roomWide}`),
    `the closet is not asked ${roomWide} again (asked: ${askedOf(1).join(", ")})`,
  );
}

// What is recorded IN the closet still gets asked — the point is inheritance, not silence.
check(
  askedOf(1).some((id) => id.includes(":flooring:")),
  `the closet is still asked about its own flooring (asked: ${askedOf(1).join(", ")})`,
);
check(
  askedOf(1).some((id) => id.includes(":door:")),
  `and its own door (asked: ${askedOf(1).join(", ")})`,
);

/* ── The moisture map has to find the room ─────────────────────────────────────────────────────── */

/*
  The sketch is labelled standing in the room ("Bedroom"); the transcript describes it in context
  ("Main Bedroom"). An exact key lookup missed, and a miss is invisible — the question just arrives
  with no measured default, looking exactly like a room nobody mapped. That was the report: "the
  moisture map isn't coming up, it's asking me to highlight again", while the closet in the same
  claim was pre-filled because its two names happened to agree.
*/
const mapped = { bedroom: { equipment: {}, floorSquareFeet: 210, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: null } };
const loose = extractionWith([everyRecordRoom("Main Bedroom")]);
const looseExtraction = nextQuestions(claim, withDerivedFields(loose), mapped).find((q) => q.id === "room:0:waterExtraction:required");
check(looseExtraction !== undefined, "the extraction question is asked for a loosely-named room");

const withDefault = nextQuestions(
  claim,
  withDerivedFields(applyAnswer(withDerivedFields(loose), "room:0:waterExtraction:required", "Yes")),
  mapped,
).find((q) => q.id === "room:0:waterExtraction:sf");
check(
  withDefault?.defaultValue === "210 SF",
  `"Main Bedroom" picks up the map's "Bedroom" measurement (got ${withDefault?.defaultValue ?? "no default"})`,
);

/*
  The wall-cut run takes its default from the map too.

  Reported alongside the extraction default: "wall cuts also did not populate from the moisture map
  sketch made originally." Same root cause — the lookup, not the arithmetic. `affectedLengthFeet` was
  computing correctly all along; the room it belonged to simply could not be found, and a missing
  default is indistinguishable from a room nobody mapped.
*/
const cutRunClaim = { ...claim, scopePhases: ["EMERGENCY", "REPAIR"] };
const cutRunMap = {
  bedroom: { equipment: {}, floorSquareFeet: null, wallRunFeet: 31.5, ceilingSquareFeet: null, parentRoomKey: null },
};
const cutRoom = extractionWith([
  room("Main Bedroom", {
    walls: [
      {
        wallMaterial: "DRYWALL", drywallBeingRemoved: true, insulationAffected: false, insulationType: null,
        insulationRValue: null, floodCutHeightIn: null, cutHeight: "TWO_FOOT", cutRunFt: null, cutRunFraction: null,
      },
    ],
  }),
]);
const cutRunQ = nextQuestions(cutRunClaim, withDerivedFields(cutRoom), cutRunMap).find((q) => q.id === "room:0:wall:0:cutRunFt");
check(cutRunQ !== undefined, "the cut-run question is asked for a 2-foot cut");
check(
  cutRunQ?.defaultValue === "31.5 LF",
  `and is pre-filled from the map's measured wall run (got ${cutRunQ?.defaultValue ?? "no default"})`,
);
check(
  (cutRunQ?.prompt ?? "").includes("31.5"),
  `with the prompt saying where the figure came from (got "${(cutRunQ?.prompt ?? "").slice(-70)}")`,
);

/*
  Ambiguity must NOT resolve. "Bedroom" is inside both "Main Bedroom" and "Bedroom Closet", and
  guessing would attach a closet's readings to a bedroom — a wrong default is worse than none,
  because nobody re-checks a number the tool filled in.
*/
const ambiguous = {
  "main bedroom": { equipment: {}, floorSquareFeet: 210, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: null },
  "bedroom closet": { equipment: {}, floorSquareFeet: 16, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: null },
};
const bare = extractionWith([everyRecordRoom("Bedroom")]);
const ambiguousDefault = nextQuestions(
  claim,
  withDerivedFields(applyAnswer(withDerivedFields(bare), "room:0:waterExtraction:required", "Yes")),
  ambiguous,
).find((q) => q.id === "room:0:waterExtraction:sf");
check(
  ambiguousDefault?.defaultValue === undefined,
  `an ambiguous name gets no default rather than the wrong one (got ${ambiguousDefault?.defaultValue ?? "none"})`,
);

/* ── Insulation type, and the R-value that depends on it ───────────────────────────────────────── */

/*
  The R-value options are DIFFERENT per type — batt is picked by R-value off the label, blown-in by
  the depth you can measure on site — so there is no honest set of options to offer before the type
  is known. That makes this the same conditional shape as the ceiling texture pair, and it is checked
  the same way: on the pending list, not on the screen.
*/
const wallRoom = extractionWith([everyRecordRoom("Study")]);
const AFFECTED = "room:0:wall:0:insulationAffected";
const TYPE = "room:0:wall:0:insulationType";
const RVALUE = "room:0:wall:0:insulationRValue";

const noType = resolveRound(claim, wallRoom, { [AFFECTED]: "Yes" });
check(noType.questions.some((q) => q.id === TYPE), "the wall insulation type is asked once it is affected");
check(!noType.questions.some((q) => q.id === RVALUE), "and the R-value is not, with no type to size it against");

const batt = resolveRound(claim, wallRoom, { [AFFECTED]: "Yes", [TYPE]: "Fiberglass batt" });
const battQ = batt.questions.find((q) => q.id === RVALUE);
check(battQ !== undefined, "batt surfaces the R-value question in the same round");
check(
  JSON.stringify(battQ?.kind.options) === JSON.stringify(["R12", "R14", "R20", "R24"]),
  `batt offers its own R-values (got ${JSON.stringify(battQ?.kind.options)})`,
);

const blown = resolveRound(claim, wallRoom, { [AFFECTED]: "Yes", [TYPE]: "Blown-in" });
const blownQ = blown.questions.find((q) => q.id === RVALUE);
check(blownQ?.prompt.includes("How deep"), `blown-in asks for depth, not an R-value off a label (got "${blownQ?.prompt}")`);
check(
  JSON.stringify(blownQ?.kind.options) ===
    JSON.stringify(['10" — R26', '12" — R30', '14" — R38', '16" — R44', '20" — R50', '24" — R66']),
  `blown-in offers depth-to-R-value (got ${JSON.stringify(blownQ?.kind.options)})`,
);

// The depth is what the PM picks; the R-value is what the scope needs to carry.
const depthAnswered = resolveRound(claim, wallRoom, { [AFFECTED]: "Yes", [TYPE]: "Blown-in", [RVALUE]: '14" — R38' });
check(
  depthAnswered.extraction.rooms[0].walls[0].insulationRValue === "R38",
  `a chosen depth records its R-value (got ${depthAnswered.extraction.rooms[0].walls[0].insulationRValue})`,
);

// No table was given for cellulose or foam, so nothing is invented for them.
for (const type of ["Cellulose", "Foam"]) {
  const other = resolveRound(claim, wallRoom, { [AFFECTED]: "Yes", [TYPE]: type });
  check(!other.questions.some((q) => q.id === RVALUE), `${type} gets no R-value question, since no table covers it`);
}

// The ceiling's pair is the same shape, and was written into a block that could equally have closed
// before a type existed — the wall's did exactly that. Checked separately rather than assumed.
const C_AFFECTED = "room:0:ceiling:0:aboveInsulationAffected";
const C_TYPE = "room:0:ceiling:0:aboveInsulationType";
const C_RVALUE = "room:0:ceiling:0:aboveInsulationRValue";
const ceilBlown = resolveRound(claim, wallRoom, { [C_AFFECTED]: "Yes", [C_TYPE]: "Blown-in" });
const ceilQ = ceilBlown.questions.find((q) => q.id === C_RVALUE);
check(ceilQ !== undefined, "the ceiling insulation R-value question is reachable once its type is known");
check(ceilQ?.prompt.includes("above the ceiling"), `and names its surface (got "${ceilQ?.prompt}")`);
const ceilAnswered = resolveRound(claim, wallRoom, { [C_AFFECTED]: "Yes", [C_TYPE]: "Blown-in", [C_RVALUE]: '20" — R50' });
check(
  ceilAnswered.extraction.rooms[0].ceilings[0].aboveInsulationRValue === "R50",
  `and records it (got ${ceilAnswered.extraction.rooms[0].ceilings[0].aboveInsulationRValue})`,
);

// An unrecognised type must not silently become foam, which is what the old else-branch did.
const garbage = resolveRound(claim, wallRoom, { [AFFECTED]: "Yes", [TYPE]: "Rockwool" });
check(
  garbage.extraction.rooms[0].walls[0].insulationType === null,
  `an unrecognised insulation type is not recorded as foam (got ${garbage.extraction.rooms[0].walls[0].insulationType})`,
);

const premature = findPrematureQuestions(claim, twoRooms);
check(premature.length === 0, `no question is asked before its trigger is settled\n         ${premature.join("\n         ")}`);



/* ── A question already on screen does not move as others are answered ────────────────────────── */

/*
  Reported: "how much extraction" jumping below whatever was answered next — "an annoyance in the
  workflow", and worse than it sounds, because the PM is answering down the page and the thing they
  are reading moves while they read it.

  The cause was the anchor. Every keystroke rebuilds the display list from scratch, and a revealed
  follow-up was placed relative to the next question in its PASS — but a pass only contains questions
  still open, so answering the question directly below removed the very neighbour the follow-up was
  anchored to, and it was re-placed further down.

  The property this checks is not "sf sits at index 1"; it is that answering anything else does not
  move it. That is the invariant the PM actually experiences.
*/
const orderingRoom = extractionWith([
  room("Kitchen", {
    flooring: [{ ...removalFlooring(), type: "LAMINATE", vinylSubtype: null, removalSF: 100 }],
    baseboardConfirmedAbsent: true,
    equipmentAsked: true,
  }),
]);

const positionsWith = (answers) => {
  const ids = resolveRound(claim, orderingRoom, answers).display.map((q) => q.id);
  return new Map(ids.map((id, i) => [id, i]));
};

const justRevealed = positionsWith({ "room:0:waterExtraction:required": "yes" });
check(justRevealed.has("room:0:waterExtraction:sf"), "answering the extraction yes/no reveals the amount question");
check(
  justRevealed.get("room:0:waterExtraction:sf") === justRevealed.get("room:0:waterExtraction:required") + 1,
  `and it lands directly under the question that revealed it (got ${justRevealed.get("room:0:waterExtraction:sf")})`,
);

/*
  Now answer every OTHER question that was on screen, one at a time, and check the amount question
  has not moved for any of them. One at a time on purpose: answering them all at once would hide a
  bug that only fires for a particular neighbour — and the neighbour that broke this was the one
  immediately below.
*/
const settledAnswer = (q) => answerFor(q, () => undefined);
for (const [id] of justRevealed) {
  if (id === "room:0:waterExtraction:sf" || id === "room:0:waterExtraction:required") continue;
  const q = resolveRound(claim, orderingRoom, { "room:0:waterExtraction:required": "yes" }).display.find((d) => d.id === id);
  if (!q) continue;
  const after = positionsWith({ "room:0:waterExtraction:required": "yes", [id]: settledAnswer(q) });
  check(
    after.get("room:0:waterExtraction:sf") === justRevealed.get("room:0:waterExtraction:sf"),
    `answering ${id} does not move the extraction amount (was ${justRevealed.get("room:0:waterExtraction:sf")}, now ${after.get("room:0:waterExtraction:sf")})`,
  );
}

/* ── A revealed follow-up sits beside what revealed it ─────────────────────────────────────────── */

/*
  Reported, and distinct from the smooth-ceiling blocking bug: when a ceiling IS textured, "popcorn
  or knockdown?" appeared "later, disconnected" rather than next to the texture question.

  The cause was ordering, not timing. A question revealed by an answer is generated on a LATER pass
  than the one that revealed it, and the display list appended in first-seen order — so the follow-up
  landed at the bottom of the form, past every other room, reading as a stray question.
*/
const texturedRound = resolveRound(claim, oneRoom, { "room:0:ceiling:0:finish": "Texture" });
const ids = texturedRound.display.map((q) => q.id);
const finishAt = ids.indexOf("room:0:ceiling:0:finish");
const styleAt = ids.indexOf("room:0:ceiling:0:textureStyle");

check(finishAt !== -1 && styleAt !== -1, "a textured ceiling shows both the finish and the style question");
check(styleAt === finishAt + 1, `and the style sits immediately after the finish (finish at ${finishAt}, style at ${styleAt} of ${ids.length})`);

/*
  Not merely "somewhere after". Appending put it last, which is also "after" — the check that matters
  is that nothing unrelated separates them.
*/
check(styleAt !== ids.length - 1 || ids.length === finishAt + 2, "it is placed, not appended to the end of the form");

// The rest of the ceiling's own questions still follow it, so the block reads as one group.
const aboveAt = ids.indexOf("room:0:ceiling:0:aboveInsulationAffected");
check(aboveAt === -1 || aboveAt > styleAt, `the ceiling's remaining questions still follow (above at ${aboveAt})`);


/* ── Baseboard height belongs to the replacement, not to a detach-and-reset ────────────────────── */

/*
  Reported as unconfirmed, and it was real. In the baseboard-ABSENCE chain (a room where extraction
  found no baseboard record at all), the height question rode along with the presence question
  unconditionally — prompt and all: "If it is being replaced, what height is it", a question openly
  admitting it might not apply while still refusing to let the PM past without an answer.

  The probe above never caught it because that chain only fires when a room has NO baseboard record,
  and the fixture rooms all have one. Fixture coverage, again.
*/
const noBaseboardRoom = extractionWith([
  room("Hall", {
    flooring: [everyRecordRoom("x").flooring[0]],
    walls: [everyRecordRoom("x").walls[0]],
    baseboard: [],
  }),
]);

const askedFor = (answers) =>
  resolveRound(claim, noBaseboardRoom, answers).display.map((q) => q.id);

const presenceOnly = askedFor({});
const completeness = resolveRound(claim, noBaseboardRoom, {}).display.find((q) => q.id === "room:0:baseboard:action");
check(completeness !== undefined, `a room with no baseboard record is asked what happens to the trim (asked: ${presenceOnly.join(", ")})`);
check(
  !presenceOnly.includes("room:0:baseboard:present"),
  "and is asked it as ONE question — the separate yes/no is gone, its answer folded into the options",
);

/*
  All three real outcomes plus the one that says the premise is wrong. A PM who can say the trim is
  being detached and reset has already established it exists, so the old yes/no in front of this was
  a question nobody needed — but "there is none here" still has to be sayable, or the room is asked
  for ever about trim it does not have.
*/
for (const option of ["Detached and reset on repairs", "Removed and replaced", "Shoe mold removed and replaced", "No baseboard in this area"]) {
  check(
    (completeness?.kind.options ?? []).includes(option),
    `the completeness question offers "${option}" (offers: ${JSON.stringify(completeness?.kind.options)})`,
  );
}

/*
  "Detached only" said half the job. The work has always been right — off in Emergency, back down in
  Repair — but a PM reading the old label had to already know that, so the reset turning up in the
  repair scope looked like the tool adding work nobody asked for.
*/
check(
  !(completeness?.kind.options ?? []).some((o) => /only$/i.test(o) && /detach/i.test(o)),
  "and never describes a detach as 'only', which reads as the reset being declined",
);

// Saying there is none closes the question rather than leaving the room stuck on it.
const noneHere = resolveRound(claim, noBaseboardRoom, { "room:0:baseboard:action": "No baseboard in this area" });
check(
  !noneHere.questions.some((q) => q.id.includes("baseboard")),
  `answering "no baseboard" closes it (still asked: ${noneHere.questions.filter((q) => q.id.includes("baseboard")).map((q) => q.id).join(", ")})`,
);
check(
  noneHere.extraction.rooms[0].baseboard.length === 0,
  "and invents no baseboard record for a room that just said it has none",
);

check(
  !presenceOnly.some((id) => id.endsWith(":heightIn")),
  `and is NOT asked a height before anyone has said there are baseboards (asked: ${presenceOnly.join(", ")})`,
);

// Detached and reset: the existing baseboard goes back down, so there is no new height to spec.
const detachOnly = askedFor({ "room:0:baseboard:action": "Detached and reset on repairs" });
check(
  !detachOnly.some((id) => id.endsWith(":heightIn")),
  `a detach-and-reset baseboard is never asked its height (asked: ${detachOnly.filter((i) => i.includes("baseboard")).join(", ")})`,
);

// Removed and replaced: a new baseboard is going in, so the height is a real spec decision.
const replaced = askedFor({ "room:0:baseboard:action": "Removed and replaced" });
check(
  replaced.some((id) => id.endsWith(":heightIn")),
  `a removed-and-replaced baseboard IS asked its height (asked: ${replaced.filter((i) => i.includes("baseboard")).join(", ")})`,
);


/* ── Carpet does not disturb the baseboard ────────────────────────────────────────────────────── */

/*
  Vinyl, laminate, hardwood and tile all run to the wall and under the trim, so the baseboard has to
  come off to pull the old floor or lay the new one. Carpet does not: it is stretched onto tack strip
  that sits INSIDE the trim, so it comes up and goes back down without the baseboard being touched.
  Asking about baseboard on a carpet tear-out is a question with no work behind it — and answering it
  puts a detach-and-reset line on the scope for trim nobody is going near.
*/
const bbFor = (extraction) => resolveRound(claim, extraction, {}).display.map((q) => q.id).filter((id) => id.includes("baseboard"));
const floorOnly = (type, extra = {}) =>
  extractionWith([room("Hall", { flooring: [{ ...removalFlooring(), type, vinylSubtype: type === "VINYL" ? "SHEET" : null }], baseboard: [], ...extra })]);

for (const type of ["VINYL", "LAMINATE", "HARDWOOD", "TILE", "CONCRETE"]) {
  check(bbFor(floorOnly(type)).length > 0, `a ${type} tear-out asks about the baseboard`);
}
check(
  bbFor(floorOnly("CARPET")).length === 0,
  `a carpet tear-out does NOT (asked: ${bbFor(floorOnly("CARPET")).join(", ")})`,
);

/*
  Drywall coming off is its own trigger and is untouched by the flooring rule. A carpeted room with a
  flood cut still needs the question — the baseboard sits on the joint the cut runs along — so the
  carpet exclusion must narrow the FLOORING trigger only, not the check as a whole.
*/
const carpetWithCut = extractionWith([
  room("Hall", {
    flooring: [{ ...removalFlooring(), type: "CARPET", vinylSubtype: null }],
    walls: [{ ...everyRecordRoom("x").walls[0], drywallBeingRemoved: true }],
    baseboard: [],
  }),
]);
check(bbFor(carpetWithCut).length > 0, "but a carpeted room with a flood cut still does — drywall is its own trigger");

// Floor registers are under the floor whatever it is made of, so that trigger keeps carpet.
check(
  resolveRound(claim, floorOnly("CARPET"), {}).display.some((q) => q.id.endsWith(":floorRegistersDetached")),
  "and carpet still reaches the floor-register question, which the baseboard rule must not narrow",
);

/* ── Contents: "none" is an answer, not a size ─────────────────────────────────────────────────── */

/*
  Reported: a hallway with only flooring work and nothing said about contents anywhere still demanded
  a contents size. "Small" is not the same answer as "nothing to move" — one bills a contents line
  and the other does not — so the option had to exist rather than the PM inventing a size.
*/
const contentsQ = resolveRound(claim, noBaseboardRoom, {}).display.find((q) => q.id === "room:0:contents:size");
check(contentsQ !== undefined, "a room with work is still asked about contents");
check(
  (contentsQ?.kind.options ?? []).some((o) => o.toLowerCase().startsWith("none")),
  `and can answer that there is nothing to move (options: ${JSON.stringify(contentsQ?.kind.options)})`,
);

const declined = resolveRound(claim, noBaseboardRoom, { "room:0:contents:size": "None — nothing to move" });
check(
  declined.extraction.rooms[0].contents?.manipulationDeclined === true,
  `"none" records manipulation as declined (got ${JSON.stringify(declined.extraction.rooms[0].contents)})`,
);
check(
  declined.extraction.rooms[0].contents?.size == null,
  "and records no size, since there is nothing to size",
);
// A real size must still record as a size, and must not read as declined.
const sized = resolveRound(claim, noBaseboardRoom, { "room:0:contents:size": "Medium" });
check(
  sized.extraction.rooms[0].contents?.size === "MEDIUM" && sized.extraction.rooms[0].contents?.manipulationDeclined === false,
  `a real size still records normally (got ${JSON.stringify(sized.extraction.rooms[0].contents)})`,
);

/* ── Hardwood: the fixed lists were too narrow ─────────────────────────────────────────────────── */

const hardwoodRoom = extractionWith([
  room("Study", { flooring: [{ ...everyRecordRoom("x").flooring[0], type: "HARDWOOD" }] }),
]);
const hw = (answers) => resolveRound(claim, hardwoodRoom, answers);

const construction = hw({}).display.find((q) => q.id === "room:0:flooring:0:hardwoodConstruction");
check(
  JSON.stringify(construction?.kind.options) === JSON.stringify(["Solid", "Engineered", "Prefinished", "Other"]),
  `construction offers prefinished and other (got ${JSON.stringify(construction?.kind.options)})`,
);
const install = hw({}).display.find((q) => q.id === "room:0:flooring:0:hardwoodInstallation");
check(
  JSON.stringify(install?.kind.options) === JSON.stringify(["Floating", "Glued", "Nailed"]),
  `installation offers nailed (got ${JSON.stringify(install?.kind.options)})`,
);

// Nailed must record as nailed. The old handler was a two-way ternary, so any third option became
// the fallback — a nailed floor would have been recorded as glued.
const nailed = hw({ "room:0:flooring:0:hardwoodInstallation": "Nailed" });
check(
  nailed.extraction.rooms[0].flooring[0].hardwoodInstallation === "NAILED",
  `"Nailed" records as NAILED, not the old fallback (got ${nailed.extraction.rooms[0].flooring[0].hardwoodInstallation})`,
);
const prefinished = hw({ "room:0:flooring:0:hardwoodConstruction": "Prefinished" });
check(
  prefinished.extraction.rooms[0].flooring[0].hardwoodConstruction === "PREFINISHED",
  `"Prefinished" records as PREFINISHED (got ${prefinished.extraction.rooms[0].flooring[0].hardwoodConstruction})`,
);

// "Other" opens a free-text field — and only then, for the same reason every dependent waits.
check(
  !hw({}).display.some((q) => q.id.endsWith("hardwoodConstructionOther")),
  "the free-text field is not offered before Other is chosen",
);
const otherChosen = hw({ "room:0:flooring:0:hardwoodConstruction": "Other" });
const otherQ = otherChosen.display.find((q) => q.id === "room:0:flooring:0:hardwoodConstructionOther");
check(otherQ !== undefined, "choosing Other offers a free-text field");
const typed = hw({ "room:0:flooring:0:hardwoodConstruction": "Other", "room:0:flooring:0:hardwoodConstructionOther": "Reclaimed heart pine" });
check(
  typed.extraction.rooms[0].flooring[0].hardwoodConstructionOther === "Reclaimed heart pine",
  `and what was typed is recorded (got ${JSON.stringify(typed.extraction.rooms[0].flooring[0].hardwoodConstructionOther)})`,
);
/*
  Text typed against Other must not survive a change to a real construction. Checked within ONE round,
  because that is where it can happen: the PM picks Other, types, then changes their mind, and both
  answers are sitting in the same map when the round resolves.
*/
const changedAway = hw({
  "room:0:flooring:0:hardwoodConstruction": "Solid",
  "room:0:flooring:0:hardwoodConstructionOther": "Reclaimed heart pine",
});
check(
  changedAway.extraction.rooms[0].flooring[0].hardwoodConstruction === "SOLID" &&
    changedAway.extraction.rooms[0].flooring[0].hardwoodConstructionOther === null,
  `text typed against Other is discarded when the construction is changed (got ${JSON.stringify(changedAway.extraction.rooms[0].flooring[0].hardwoodConstructionOther)})`,
);


/* ── Answering one room for the whole property ─────────────────────────────────────────────────── */

/*
  A property is very often trimmed at one baseboard height throughout, so answering it room by room
  is typing the same number five times. This is an OFFER: nothing copies unless the PM asks, and
  every copy lands as an ordinary answer they can change afterwards.
*/
check(canApplyToAllRooms("room:0:baseboard:0:heightIn"), "baseboard height can be applied to every room");
check(canApplyToAllRooms("room:2:wall:1:cutHeight"), "so can the flood cut height, which is a job-level decision");
check(!canApplyToAllRooms("room:0:contents:size"), "contents size cannot — it genuinely differs room to room");
check(!canApplyToAllRooms("room:0:flooring:0:hardwoodInstallation"), "and neither can flooring, which varies by room");

const twoRoomRound = resolveRound(claim, twoRooms, {}).display;
const heightIds = twoRoomRound.filter((q) => q.id.endsWith(":heightIn")).map((q) => q.id);
if (heightIds.length > 1) {
  const siblings = siblingQuestionIds(heightIds[0], twoRoomRound);
  check(
    siblings.length === heightIds.length - 1 && !siblings.includes(heightIds[0]),
    `the same question in other rooms is found, excluding itself (got ${JSON.stringify(siblings)})`,
  );
  check(
    siblings.every((id) => id.endsWith(":heightIn")),
    "and only the same question, never a different one that happens to share a room",
  );
}
check(siblingQuestionIds("room:0:contents:size", twoRoomRound).length === 0, "a question that is not uniform offers no siblings");

/* ── Equipment stated for the job, not per room ────────────────────────────────────────────────── */

/*
  Reported: "was drying equipment used in this room? how many air movers? how many dehumidifiers?"
  repeating for every room, for one fact the PM stated once for the whole job. Consolidated into a
  single question per equipment type, with a count against each room.

  Every check below is a condition that must turn it back OFF — the feature is only correct when it
  fires exactly where the transcript genuinely never attributed the equipment.
*/
const unattributed = extractionWith([
  room("Bedroom", { flooring: [everyRecordRoom("x").flooring[0]], equipment: [{ type: "air movers", quantity: null }] }),
  room("Kitchen", { flooring: [everyRecordRoom("x").flooring[0]], equipment: [] }),
]);
check(equipmentNeedsConsolidating(withDerivedFields(unattributed)), "equipment mentioned with no quantity anywhere consolidates");

// Already attributed: the transcript said how many go where, so this must not touch it.
const attributed = extractionWith([
  room("Bedroom", { flooring: [everyRecordRoom("x").flooring[0]], equipment: [{ type: "air movers", quantity: 3 }] }),
  room("Kitchen", { flooring: [everyRecordRoom("x").flooring[0]], equipment: [] }),
]);
check(!equipmentNeedsConsolidating(withDerivedFields(attributed)), "a stated quantity anywhere means it was attributed — leave it alone");

// Nothing said about equipment at all: the per-room "did you forget?" backstop is a DIFFERENT
// question and must keep firing.
const silent = extractionWith([
  room("Bedroom", { flooring: [everyRecordRoom("x").flooring[0]] }),
  room("Kitchen", { flooring: [everyRecordRoom("x").flooring[0]] }),
]);
check(!equipmentNeedsConsolidating(withDerivedFields(silent)), "a claim that never mentions equipment does not consolidate");

// One room is not a repetition worth collapsing.
const oneRoomOnly = extractionWith([
  room("Bedroom", { flooring: [everyRecordRoom("x").flooring[0]], equipment: [{ type: "air movers", quantity: null }] }),
]);
check(!equipmentNeedsConsolidating(withDerivedFields(oneRoomOnly)), "a single-room claim keeps its per-room question");

// A moisture map produces a measured per-room recommendation, which beats anything typed here.
const mappedRooms = { bedroom: { equipment: { "air movers": 3 }, floorSquareFeet: null, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: null } };
check(!equipmentNeedsConsolidating(withDerivedFields(unattributed), mappedRooms), "a moisture map keeps the pre-filled per-room questions");

/* ── The consolidated question replaces the per-room loop ──────────────────────────────────────── */

const consolidated = resolveRound(claim, unattributed, {}).display;
const consolidatedId = consolidatedEquipmentId("air movers");
const asked = consolidated.find((q) => q.id === consolidatedId);
check(asked !== undefined, `one consolidated question is asked (asked: ${consolidated.map((q) => q.id).join(", ")})`);
check(asked?.roomName === null, "and it belongs to the claim, not to any one room — that is the point");
check(
  (asked?.kind.buckets ?? []).length === 2,
  `with a count against each room that has work (got ${JSON.stringify(asked?.kind.buckets)})`,
);
// The export of this exact question is what showed `0:2,1:2` in a real session.
const askedLog = recordRound(1, [asked], [asked], { [consolidatedId]: "0:2,1:2" })[0].answer;
check(
  askedLog.includes("Bedroom") && askedLog.includes("Kitchen") && !askedLog.includes("0:"),
  `the live consolidated question exports by room name (got ${JSON.stringify(askedLog)})`,
);

check(
  !consolidated.some((q) => /^room:\d+:equipment:/.test(q.id)),
  `and the per-room equipment questions are gone (still asked: ${consolidated.filter((q) => q.id.includes("equipment")).map((q) => q.id).join(", ")})`,
);

// The one answer distributes across every room.
const distributed = resolveRound(claim, unattributed, { [consolidatedId]: "0:4,1:2" });
const distributedRooms = distributed.extraction.rooms;
check(
  distributedRooms[0].equipment.find((e) => e.type === "air movers")?.quantity === 4,
  `the first room gets its share (got ${JSON.stringify(distributedRooms[0].equipment)})`,
);
check(
  distributedRooms[1].equipment.find((e) => e.type === "air movers")?.quantity === 2,
  `and so does a room that had no equipment record at all (got ${JSON.stringify(distributedRooms[1].equipment)})`,
);

// A room given none is recorded as asked, so the per-room backstop does not come straight back.
const someNone = resolveRound(claim, unattributed, { [consolidatedId]: "0:6" });
check(
  someNone.extraction.rooms[1].equipmentAsked === true,
  "a room given none is recorded as asked-and-none, not left to be asked again",
);
check(
  !someNone.questions.some((q) => q.id === "room:1:equipment:used"),
  `and its presence question does not reappear (open: ${someNone.questions.map((q) => q.id).join(", ")})`,
);


/* ── The session log: what was asked, in order, and what came back ─────────────────────────────── */

/*
  Recorded rather than derived, and the reason matters: `answers` is emptied on every Continue and
  the displayed list is rebuilt per round, so a question's wording and its position are gone the
  moment that round is committed. The extraction tree keeps the resulting VALUES, which cannot say
  what was asked, in what words, or in what order.
*/
const logRound = resolveRound(claim, oneRoom, {
  "room:0:ceiling:0:finish": "Texture",
  "room:0:waterExtraction:required": "Yes",
});
const recorded = recordRound(1, logRound.display, logRound.applied, {
  "room:0:ceiling:0:finish": "Texture",
  "room:0:waterExtraction:required": "Yes",
});

check(recorded.length === logRound.display.length, "every question that was shown is recorded, answered or not");
check(
  recorded.map((e) => e.prompt).join("|") === logRound.display.map((q) => q.prompt).join("|"),
  "in the order they were on screen, not regrouped",
);

const finishEntry = recorded.find((e) => e.prompt.includes("Texture or smooth"));
check(finishEntry?.answer === "Texture", `an answered question carries its answer (got ${JSON.stringify(finishEntry?.answer)})`);
check(finishEntry?.applied === true, "and is marked as having reached the claim");
check(
  recorded.some((e) => e.answer === "" && e.applied === false),
  "a question shown but never answered is recorded as unanswered rather than dropped",
);

// The room a question belonged to travels with it; claim-level questions say so.
check(
  recorded.some((e) => e.roomName === "Bedroom"),
  `entries carry their room (rooms seen: ${JSON.stringify([...new Set(recorded.map((e) => e.roomName))])})`,
);

/* ── Answers read as English, not as storage ───────────────────────────────────────────────────── */

/*
  Several kinds submit a machine format the screen never shows. A yes/no button submits the literal
  "yes" whatever its label says, and a tally submits `key:count` — which for the consolidated
  equipment question is keyed by ROOM INDEX, so the raw answer is `0:2,1:2`. A log whose questions
  are in English and whose answers are not defeats the purpose of exporting it.
*/
// Constructed rather than fished out of a fixture, so this cannot silently skip: the equipment
// question's buckets are keyed by ROOM INDEX, which is the case that produced `0:2,1:2` on a real
// export. The same shape with real bucket ids is asserted against the live question further down.
const tally = {
  id: "equipment:allRooms:air movers",
  roomName: null,
  prompt: "How many air movers in each room?",
  kind: { type: "bucketCounts", buckets: [{ key: "0", label: "Kitchen" }, { key: "1", label: "Living Room" }], unit: "air movers" },
};
const tallied = recordRound(1, [tally], [tally], { [tally.id]: "0:2,1:3" })[0].answer;
check(tallied === "Kitchen × 2, Living Room × 3", `a tally exports by room name, not by index (got ${JSON.stringify(tallied)})`);
check(!/\d+:\d+/.test(tallied), "with no trace of the stored key:count format");
check(
  recordRound(1, [tally], [tally], { [tally.id]: "0:2" })[0].answer === "Kitchen × 2",
  "a room left blank is omitted rather than shown as zero",
);
check(recordRound(1, [tally], [tally], { [tally.id]: "" })[0].answer === "", "an untouched tally is 'not answered', not a false 'none'");

// A custom yes/no label is what the PM pressed, so it is what the log has to say.
const labelled = {
  id: "x",
  roomName: null,
  prompt: "Is the baseboard coming off?",
  kind: { type: "yesNo", yesLabel: "Detaching", noLabel: "Staying in place" },
};
check(
  recordRound(1, [labelled], [labelled], { x: "yes" })[0].answer === "Detaching",
  "a yes/no exports the label that was on the button, not the stored \"yes\"",
);
check(
  recordRound(1, [labelled], [labelled], { x: "no" })[0].answer === "Staying in place",
  "and the same for no",
);

const plan = { id: "y", roomName: "Kitchen", prompt: "How many?", kind: { type: "equipmentPlan", suggested: 3, unit: "air movers" } };
check(
  recordRound(1, [plan], [plan], { y: "none" })[0].answer.toLowerCase().includes("no air movers"),
  "declining equipment reads as a decision, not the bare word \"none\"",
);
check(recordRound(1, [plan], [plan], { y: "4" })[0].answer === "4 air movers", "and a count carries its unit");

/* ── The exported text ─────────────────────────────────────────────────────────────────────────── */

const text = formatQuestionLog(claim, recorded);
check(text.includes(claim.jobNumber), `the export names the job (${claim.jobNumber})`);
check(text.includes(claim.customerName), "and the customer, so the file identifies itself");
check(text.includes("Bedroom"), "rooms appear as headings");
check(text.includes("Q: ") && text.includes("A: "), "each entry pairs a question with an answer");
check(text.includes("(not answered)"), "an unanswered question says so rather than showing a blank");

/*
  A room comes back around within one round whenever an answer reveals a follow-up. The export keeps
  it where it happened and marks the heading, rather than merging the two runs into an order nobody
  saw on screen — merging would misreport the very thing this export exists to show.
*/
const revisit = [
  { round: 1, roomName: "Kitchen", prompt: "Flooring?", answer: "Laminate", applied: true },
  { round: 1, roomName: "Living Room", prompt: "Flooring?", answer: "Carpet", applied: true },
  { round: 1, roomName: "Kitchen", prompt: "How much laminate?", answer: "Full", applied: true },
];
const revisitText = formatQuestionLog(claim, revisit);
check(revisitText.includes("Kitchen (continued)"), `a room revisited later in the round is marked (got:
${revisitText})`);
check(
  revisitText.indexOf("Living Room") < revisitText.indexOf("Kitchen (continued)"),
  "and the revisit stays where it happened rather than being merged upward",
);
check(
  (revisitText.match(/^  Kitchen$/gm) ?? []).length === 1,
  "only the first appearance is unmarked",
);

// A question shown, answered, then withdrawn is called out — "I answered that and it did not take"
// is exactly what somebody reports, so the log has to be able to show it.
const withdrawn = recordRound(1, logRound.display, [], { "room:0:ceiling:0:finish": "Texture" });
check(
  formatQuestionLog(claim, withdrawn).includes("[not applied"),
  "an answer that never reached the claim is flagged, not shown as an ordinary answer",
);

// Rounds stay separated, and the in-flight one is labelled as not yet submitted.
const twoRoundText = formatQuestionLog(claim, recorded, recordRound(2, logRound.display, [], {}));
check(twoRoundText.includes("Round 1") && twoRoundText.includes("Round 2"), "rounds are kept apart");
check(twoRoundText.includes("not yet submitted"), "and the round still on screen is marked as such");

check(!hasQuestionLog([]), "an empty log reports as empty, so the export is not offered with nothing in it");
check(hasQuestionLog(recorded), "and a real one does not");
check(formatQuestionLog(claim, []).includes("No questions have been asked yet"), "an empty export still says what it is");

/* ── A floor whose material nobody named ───────────────────────────────────────────────────────── */

/*
  Found by test/pipeline: a transcript saying "flooring's coming up in all three" produced NO
  flooring record in any of the three rooms, and the finished scope had no flooring lines at all —
  the largest line item on most claims, gone, with nothing in the document looking wrong. A record
  could not exist without a named material, so extraction dropped it rather than guess.

  The record can now exist with a null type, which is what lets this be a question instead of a
  silence.
*/
const unnamedFloor = extractionWith([
  room("Hallway", { flooring: [{ ...removalFlooring(), type: null, vinylSubtype: null }], baseboard: [] }),
]);
const unnamedIds = () => nextQuestions(claim, withDerivedFields(unnamedFloor)).map((q) => q.id);
check(unnamedIds().includes("room:0:flooring:0:type"), `a floor with no material is asked what it is (asked: ${unnamedIds().join(", ")})`);

/*
  And nothing that depends on the material is asked before it is known. Baseboard is the one that
  matters: carpet does not disturb it and everything else does, so asking before the material is
  named would put a detach-and-reset line under a carpet that never needed one.
*/
check(
  !unnamedIds().some((id) => id.includes("baseboard")),
  `and the baseboard question waits for it (asked: ${unnamedIds().filter((i) => i.includes("baseboard")).join(", ")})`,
);

// Answering it names the material and unlocks the questions that branch on it.
const namedRound = resolveRound(claim, unnamedFloor, { "room:0:flooring:0:type": "Vinyl" });
check(namedRound.extraction.rooms[0].flooring[0].type === "VINYL", `the answer sets the type (got ${namedRound.extraction.rooms[0].flooring[0].type})`);
check(
  namedRound.display.some((q) => q.id === "room:0:flooring:0:vinylSubtype"),
  "and the vinyl-specific question appears once it is known to be vinyl",
);
check(
  namedRound.display.some((q) => q.id.includes("baseboard")),
  "as does the baseboard question, now that the floor is known not to be carpet",
);

// Carpet is the case the wait exists for.
const carpetNamed = resolveRound(claim, unnamedFloor, { "room:0:flooring:0:type": "Carpet" });
check(
  !carpetNamed.questions.some((q) => q.id.includes("baseboard")),
  `naming it carpet leaves the baseboard alone (still asked: ${carpetNamed.questions.filter((q) => q.id.includes("baseboard")).map((q) => q.id).join(", ")})`,
);

// An unrecognised answer records nothing rather than inventing a material.
check(
  applyAnswer(withDerivedFields(unnamedFloor), "room:0:flooring:0:type", "Linoleum-ish").rooms[0].flooring[0].type === null,
  "an answer that names no known material leaves the type unset, so the question comes back",
);

/* ── How much floor is coming out, for every flooring type ────────────────────────────────────── */

/*
  Reported: a transcript stated "6 by 8 feet" of vinyl plank — a real 48 SF — and the scope rendered
  "small area at the dishwasher". Carpet-lift was the only quantity a flooring record carried, so an
  exact figure the PM had said out loud had nowhere to land and generation used the qualitative
  fallback it reaches for when nothing is known. A number that was given and then dropped is worse
  than one never given: the vague phrase looks like the best anyone knew.
*/
for (const type of ["VINYL", "LAMINATE", "HARDWOOD", "TILE", "CONCRETE", "CARPET"]) {
  const tearOut = extractionWith([
    room("Utility", { flooring: [{ ...removalFlooring(), type, vinylSubtype: type === "VINYL" ? "SHEET" : null }] }),
  ]);
  const asked = nextQuestions(claim, withDerivedFields(tearOut)).find((q) => q.id.endsWith(":removalSF"));
  check(asked !== undefined, `${type} being torn out is asked how much of it there is`);
}

// A floor being lifted and put back is not a removal — its quantity is the carpet-lift pair.
const lifted = extractionWith([
  room("Lounge", { flooring: [{ ...removalFlooring(), type: "CARPET", disposition: "LIFT_AND_REINSTALL" }] }),
]);
check(
  !nextQuestions(claim, withDerivedFields(lifted)).some((q) => q.id.endsWith(":removalSF")),
  "a lift-and-reinstall floor is not asked for a removal area",
);

// Extraction having captured it is the whole point — the question must not re-ask.
const measured = extractionWith([room("Utility", { flooring: [{ ...removalFlooring(), removalSF: 48 }] })]);
check(
  !nextQuestions(claim, withDerivedFields(measured)).some((q) => q.id.endsWith(":removalSF")),
  "a stated area is not asked for again",
);

const vagueButAnswered = extractionWith([room("Utility", { flooring: [{ ...removalFlooring(), removalFraction: "HALF" }] })]);
check(
  !nextQuestions(claim, withDerivedFields(vagueButAnswered)).some((q) => q.id.endsWith(":removalSF")),
  "and neither is one already given as a share of the room",
);

/* ── The answer: a number, a share, or dimensions ─────────────────────────────────────────────── */

const tearOutRoom = extractionWith([room("Utility", { flooring: [removalFlooring()] })]);
const removalId = "room:0:flooring:0:removalSF";
const answered = (answer) => applyAnswer(withDerivedFields(tearOutRoom), removalId, answer).rooms[0].flooring[0];

check(answered("48").removalSF === 48, "an exact number is taken as SF");
check(answered("half").removalFraction === "HALF", "a share of the room is taken as a fraction");

/*
  Dimensions are what a PM standing in the room actually has. Making them multiply is how a typo
  becomes a scope quantity — and the old parser read "6 x 8" as a plain 6, silently scoping an
  eighth of the floor with nothing to show that it had.
*/
for (const [written, expected] of [["6 x 8", 48], ["6 by 8", 48], ["6' x 8'", 48], ["10 X 12", 120], ["6.5 by 8", 52]]) {
  const got = answered(written);
  check(got.removalSF === expected, `"${written}" is read as ${expected} SF (got ${got.removalSF})`);
}
check(answered("6 x 8").removalFraction === null, "and dimensions are a measurement, not a share");

/*
  A wall run has one dimension, so "6 x 8" is not an answer to it. Refusing leaves the question open
  and sends the PM back to it; taking the 6 is the one outcome that puts a wrong number on the scope
  with nothing to show for it.
*/
const linearRoom = extractionWith([room("Utility", { walls: [{ ...everyRecordRoom("x").walls[0], drywallBeingRemoved: true }] })]);
const wallAfter = applyAnswer(withDerivedFields(linearRoom), "room:0:wall:0:cutRunFt", "6 x 8").rooms[0].walls[0];
check(wallAfter.cutRunFt === null, `a linear question refuses dimensions rather than taking the first number (got ${wallAfter.cutRunFt})`);
check(
  applyAnswer(withDerivedFields(linearRoom), "room:0:wall:0:cutRunFt", "31").rooms[0].walls[0].cutRunFt === 31,
  "while a plain linear number still lands",
);

/* ── Every piece of claim state is saved, or documented as not saved ──────────────────────────── */

/*
  Losing a PM's work is silent. A field the page holds but never saves reads as blank when they come
  back to it, with nothing to say it was ever filled in — and the same is true of a field that is
  saved but never applied on load. Neither shows up in review, so it is checked here, the same way
  reset() is.
*/
{
  const pageSource = readFileSync(join(root, "app", "(app)", "claim", "page.tsx"), "utf8");
  const claimStateSource = readFileSync(join(root, "lib", "claimState.ts"), "utf8");

  const saved = savedKeys(claimStateSource);
  const skipped = notPersisted(claimStateSource);
  const applied = appliedSetters(pageSource);
  check(saved !== null, "lib/claimState.ts still declares SAVED_CLAIM_KEYS in the shape this reads");
  check(skipped !== null, "and NOT_PERSISTED");
  check(applied !== null, "and the page still has an applyLoadedClaim this can read");

  if (saved && skipped && applied) {
    const declared = declaredState(pageSource).map((s) => s.name);
    const accountedFor = new Set([...saved, ...skipped]);
    const unaccounted = declared.filter((n) => !accountedFor.has(n));
    check(
      unaccounted.length === 0,
      ["every piece of claim state is either saved or documented as deliberately not saved.",
       "         Neither, in lib/claimState.ts:",
       ...unaccounted.map((n) => `           ${n}`)].join("\n"),
    );

    // Saved but never applied: written to the database, then thrown away when the claim is opened.
    const setterFor = (key) => `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    const neverApplied = saved.filter((k) => !applied.includes(setterFor(k)));
    check(
      neverApplied.length === 0,
      ["every saved field is applied when a claim is loaded.",
       "         Saved but never restored:",
       ...neverApplied.map((k) => `           ${k} (expected ${setterFor(k)})`)].join("\n"),
    );

    // And the reverse: a setter called on load for something that is never saved would restore a
    // field to whatever the last claim left in it.
    const appliedButUnsaved = applied.filter((setter) => !saved.some((k) => setterFor(k) === setter));
    check(
      appliedButUnsaved.length === 0,
      `applyLoadedClaim only restores fields that are actually saved (stray: ${appliedButUnsaved.join(", ")})`,
    );

    // A claim opened from another device must not be able to overwrite a different one: Start Over
    // has to release the row as well as clear the screen.
    check(
      /persistence\.forget\(\)/.test(pageSource),
      "reset() releases the saved claim, so Start Over cannot overwrite the claim that was open",
    );
  }
}

/* ── The offer must not move the page when it appears ─────────────────────────────────────────── */

/*
  Reported: the input "kept moving position while the PM was actively trying to click into or type in
  it". The cause was the apply-to-all offer, which rendered only once its question was answered — so
  answering grew that card and pushed everything below it down, measured at 25.8px on a 1280px
  viewport, right as the PM moved to the next field. It is worst exactly where this offer applies,
  because those are the questions answered in a run down the page.

  The fix reserves the row whether or not the offer is showing. This guards the shape of that fix:
  the button must sit inside a container that is rendered unconditionally alongside it, so the only
  thing the answer changes is what is IN the row, never whether the row is there.
*/
{
  const field = readFileSync(join(root, "components", "QuestionField.tsx"), "utf8");
  const rowIndex = field.indexOf("apply-to-all-row");
  const buttonIndex = field.indexOf('className="apply-to-all"');
  check(rowIndex !== -1, "the apply-to-all offer has a reserving row");
  check(
    rowIndex !== -1 && buttonIndex > rowIndex,
    "and the button is rendered inside it, not in place of it",
  );
  // The answered-check must gate the BUTTON, never the row — gating the row is the original bug.
  const answeredGate = field.indexOf("isQuestionAnswered(question, rawValue)", rowIndex - 400);
  check(
    answeredGate > rowIndex,
    "the answered check gates the button, not the row that holds its space",
  );
}

/* ── Fixtures carry every field the real records do ───────────────────────────────────────────── */

/*
  Every fixture below is a hand-written literal, so a field added to a domain type is simply absent
  from them — and `undefined` is not `null`, so a question gated on `field === null` stops firing in
  the tests while firing normally in the app. That is not a small gap: it silently disables the
  extractable-fields audit for the new field, which is the one check meant to catch it.

  It has already happened once. `flooring.removalSF` was added, asked in the app, and walked past the
  audit untouched until the fixtures were updated by hand. The shapes come from the real wire mapping
  (TypeScript rejects a missing field there), so this is what makes that self-correcting.
*/
const canonical = canonicalRecordShapes();
const missingFrom = (actual, expected) => Object.keys(expected).filter((k) => !(k in actual));

for (const [label, record, shape] of [
  ["everyRecordRoom flooring", everyRecordRoom("x").flooring[0], canonical.flooring],
  ["removalFlooring", removalFlooring(), canonical.flooring],
  ["everyRecordRoom baseboard", everyRecordRoom("x").baseboard[0], canonical.baseboard],
]) {
  const missing = missingFrom(record, shape);
  check(
    missing.length === 0,
    `${label} fixture carries every field the real record does (missing: ${missing.join(", ")})`,
  );
}

/* ── Nothing is asked that extraction could already know ───────────────────────────────────────── */

/*
  Reported three times before the pattern was visible: hardwood installation asked after the PM said
  "glued", insulation-affected asked after they said it was, light fixtures asked while a fixture the
  PM described sat in the generated scope document.

  One cause. Gap-check sees ONLY the extraction tree; document generation is also handed the
  transcript. A fact with no home in the tree is therefore invisible to the questions and visible to
  the document — which is exactly how a PM ends up being asked about something the finished scope
  already states.

  So every question is checked against `extractable.mjs`: either extraction can fill the field, or
  somebody wrote down why it cannot. An unlisted field fails, which turns the next instance of this
  into a failing test rather than another round of testing.
*/
/*
  Flooring branches on type, so a carpet-only fixture never reaches the hardwood or vinyl questions —
  and those are where one of the three reported cases actually lived. The audit is only ever as good
  as the shapes it walks, so every flooring type gets a record here.
*/
const allFlooringTypes = extractionWith([
  room("Flooring Sampler", {
    flooring: [
      { ...everyRecordRoom("x").flooring[0], type: "HARDWOOD" },
      { ...everyRecordRoom("x").flooring[0], type: "VINYL" },
      { ...everyRecordRoom("x").flooring[0], type: "LAMINATE" },
      { ...everyRecordRoom("x").flooring[0], type: "TILE" },
      { ...everyRecordRoom("x").flooring[0], type: "CONCRETE" },
    ],
  }),
]);

const everyQuestionId = new Set();
for (const roomSet of [oneRoom, twoRooms, allFlooringTypes]) {
  const explore = (claimInfo, extraction, depth) => {
    if (depth > 12) return;
    const questions = nextQuestions(claimInfo, withDerivedFields(extraction));
    if (questions.length === 0) return;
    let c = claimInfo;
    let e = withDerivedFields(extraction);
    for (const q of questions) {
      everyQuestionId.add(q.id);
      const answer = answerFor(q, () => undefined);
      if (isClaimInfoQuestion(q.id)) {
        const r = applyClaimAnswer(c, e, q.id, answer);
        c = r.claim;
        e = r.extraction;
      } else {
        e = applyAnswer(e, q.id, answer);
      }
    }
    explore(c, withDerivedFields(e), depth + 1);
  };
  explore(claim, roomSet, 0);
}

const unaccounted = [...everyQuestionId]
  .map((id) => ({ id, key: fieldKeyFor(id) }))
  .filter(({ key }) => !EXTRACTABLE.has(key) && !DELIBERATELY_ASKED.has(key));

check(
  unaccounted.length === 0,
  [
    "every question's field is either extractable or documented as deliberately asked.",
    "         Unaccounted for — decide whether extraction should capture these,",
    "         then list them in test/gapcheck/extractable.mjs:",
    ...unaccounted.map(({ id, key }) => `           ${key}  (from ${id})`),
  ].join("\n"),
);

// The tables must describe reality, not an aspiration: a field claimed extractable that no question
// ever gates on is fine, but one claimed BOTH extractable and deliberately-asked is a contradiction.
const contradictions = [...DELIBERATELY_ASKED.keys()].filter((k) => EXTRACTABLE.has(k));
check(contradictions.length === 0, `no field is listed as both extractable and deliberately asked (got ${contradictions.join(", ")})`);


/* ── Starting a new claim leaves nothing of the old one ────────────────────────────────────────── */

/*
  Reported: a deleted sketch's room kept appearing in gap-check and then in the finished documents.
  Nothing in this app persists — claim state is only ever in the page's hooks — so the single way
  that happens is `reset()` forgetting one of them. See `resetRule.mjs`.
*/
const missedByReset = checkResetClearsEveryState(join(root, "app", "(app)", "claim", "page.tsx"));
check(
  missedByReset.length === 0,
  [
    "reset() clears every piece of claim state.",
    "         These survive a reset and would carry into the next claim:",
    ...missedByReset.map((m) => `           ${m}`),
  ].join("\n"),
);

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
