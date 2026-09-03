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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    waterExtractionRequired: null,
    waterExtractionSF: null,
    waterExtractionFraction: null,
    baseboardPresenceConfirmed: false,
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
        vinylSubstrate: null, hardwoodConstruction: null, hardwoodInstallation: null,
        disposition: "REMOVE_AND_DISPOSE", phase: null, phaseUncertain: true, padRemoved: null,
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
    vinylSubstrate: null, hardwoodConstruction: null, hardwoodInstallation: null,
    disposition: "REMOVE_AND_DISPOSE", phase: null, phaseUncertain: false, padRemoved: null,
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
const bbDetaching = resolveRound(claim, reportedRooms, { [BB_ACTION]: "Detached only" });
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

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
