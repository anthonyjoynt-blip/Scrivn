import { readFileSync } from "node:fs";

/**
 * The same claim asks the same questions, live or reloaded.
 *
 * Reported 2026-10-30 from a demo run: the questions step showed one list straight after the
 * transcript was read and another after a reload of the very same saved claim. On the reload the
 * mechanical room's "How much water extraction was required?" was gone, answer and all, because a page
 * effect had written the moisture map's floor area into the extraction tree as the claim opened — an
 * effect that never runs when a transcript is read with the map already drawn.
 *
 * So this builds the round both ways from one claim, at every stage of answering it: the page's way
 * (the claim on screen, the extraction put on it by `withExtraction`) and a reload's way (the claim
 * through JSON and `parseSavedClaimState`, as the save and the load carry it). Both go through
 * `claimRound`, the one function the page renders from. The two must agree on every question, its
 * wording and pre-fill, what is still open, what was applied, and the tree that Continue would commit.
 *
 * And because the bug lived in the page rather than in that function, the page is read too: no effect
 * on it may write what the round is built from (`checkNoEffectRewritesRound`).
 *
 * The claim is a small basement loss: a water heater in a mechanical room, wet through a hallway into
 * the corner of a rec room. The plan and the moisture map are made up for this test; the extraction is
 * written by hand from the notes below, as the extraction call and its detail pass would return them —
 * no call is made.
 */

const NOTES =
  "Basement loss. The water heater let go in the mechanical room overnight, clean water, so category 1, class 2. " +
  "It ran out under the door, down the hallway and into the corner of the rec room by the hall. Mechanical room is " +
  "bare concrete, we extracted it. Hallway and that corner of the rec room are carpet over pad, both soaked, so the " +
  "carpet and pad are coming out. Drywall is wet up about two feet in the mechanical room and the hallway, so flood " +
  "cut at two feet in both. Rec room walls only read high at the bottom, so just the baseboards off along the wet wall " +
  "there. Air movers and dehumidifiers going in, set them to the moisture map. The plumber is replacing the tank, " +
  "that's not ours.";

/**
 * The basement claim before its notes are read: the claim, the plan and the map — and the extraction
 * that reading the notes returns. Exported so the same claim can be put on a local Scrivn to look at.
 */
export function basementLoss(mod, baseClaim) {
  const { blankRoom, canonicalRecordShapes, emptyMoistureMap, emptyRoomMoisture, PIXELS_PER_FOOT: PX } = mod;

  const claim ={ ...baseClaim, waterCategory: 1, waterClass: 2, causeOfLoss: "Water heater failure", yearOfBuilding: 2004 };

  // Every key of the real records, every value unsaid — see carryOver.mjs for why "" will not do.
  const shapes = canonicalRecordShapes();
  const unsaid = (shape) => Object.fromEntries(Object.keys(shape).map((k) => [k, k === "phaseUncertain" ? false : null]));
  const floor = (o) => ({ ...unsaid(shapes.flooring), ...o });
  const baseboard = (o) => ({ ...unsaid(shapes.baseboard), ...o });
  // Cut at 2 ft, as the detail pass reads "flood cut at two feet"; insulation is never mentioned.
  const flood = () => ({
    wallMaterial: "DRYWALL", drywallBeingRemoved: true, insulationAffected: null, insulationType: null, insulationRValue: null,
    floodCutHeightIn: null, cutHeight: "TWO_FOOT", cutRunFt: null, cutRunFraction: null,
  });
  // "Air movers and dehumidifiers going in, set them to the moisture map": named, never counted.
  const drying = () => [{ type: "air movers", quantity: null, holeCount: null }, { type: "dehumidifiers", quantity: null, holeCount: null }];
  const room = (name, o) => ({ ...blankRoom(name), equipment: drying(), ...o });
  const soakedCarpet = () => floor({ type: "CARPET", disposition: "REMOVE_AND_DISPOSE", padPresent: true, padRemoved: true });

  const extraction = {
    loss: {
      category: 1, lossClass: 2, source: "Water heater", dateOfLoss: null, yearOfBuilding: null,
      asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null,
      isBasementLoss: true, hvacInspectionRequired: null,
    },
    rooms: [
      // "we extracted it" — the one room where extraction is stated rather than asked.
      room("Mechanical Room", { flooring: [floor({ type: "CONCRETE", disposition: "DRY_IN_PLACE" })], walls: [flood()], waterExtractionRequired: true }),
      room("Hallway", { flooring: [soakedCarpet()], walls: [flood()] }),
      room("Rec Room", { flooring: [soakedCarpet()], baseboard: [baseboard({ action: "REMOVE_AND_REPLACE", disposition: "REMOVE_AND_DISPOSE" })] }),
    ],
  };

  /* ── The plan and the moisture map ─────────────────────────────────────────────────────────── */

  const box = (id, name, x, wFeet, hFeet) => {
    const corners = [[x, 0], [x + wFeet * PX, 0], [x + wFeet * PX, hFeet * PX], [x, hFeet * PX]];
    return {
      id, name, vertices: corners.map(([vx, vy], i) => ({ id: `${id}-v${i}`, x: vx, y: vy })),
      ceilingHeightFeet: 8, ceilingType: "flat", ceilingPeakFeet: null, stairs: null, parentRoomId: null,
      nestingOptOut: false, symbols: [], freeCabinets: [],
    };
  };
  const mech = box("mech", "Mechanical Room", 0, 8, 10);
  const hall = box("hall", "Hallway", 8 * PX, 4, 14);
  const rec = box("rec", "Rec Room", 12 * PX, 16, 14);
  const sketch = { rooms: [mech, hall, rec] };

  // A wall read wet to 2 ft from t0 to t1 of the wall starting at vertex `v`.
  const wet = (r, v, t0, t1) => ({ id: `${r.id}-r${v}`, wallId: `${r.id}-v${v}`, startT: t0, endT: t1, affectedHeightFeet: 2, material: "drywall", reading: 4, dryStandard: 0.75 });
  // Painted floor, `w` by `h` feet of quarter-foot cells.
  const paint = (w, h) => Array.from({ length: w * 4 * h * 4 }, (_, i) => `${i % (w * 4)},${Math.floor(i / (w * 4))}`);
  const moisture = {
    ...emptyMoistureMap(),
    rooms: {
      mech: { ...emptyRoomMoisture(), wallReadings: [wet(mech, 0, 0, 0.75)], floorCells: paint(8, 10) }, // 6 LF of wall, 80 SF of floor
      hall: { ...emptyRoomMoisture(), wallReadings: [wet(hall, 1, 0, 0.5)], floorCells: paint(4, 10) }, // 7 LF, 40 SF
      rec: { ...emptyRoomMoisture(), wallReadings: [wet(rec, 3, 0.5, 1)], floorCells: paint(4, 4) }, // the corner: 7 LF, 16 SF
    },
  };

  return { claim, transcript: NOTES, sketch, moisture, extraction };
}

/*
  The PM's answers. The mechanical room's extraction area is their own figure, marked on the plan, not
  the map's 80 SF pre-fill — an answer that differs from what the map would have filled in is exactly
  what a reload must not lose. Everything else pre-filled is left as the map has it (undefined).
*/
export function basementAnswer(q) {
  if (q.id === "room:0:waterExtraction:sf") return "72 SF";
  // Lower case, as the page writes a yes/no answer.
  if (q.id.endsWith(":insulationAffected")) return q.id.startsWith("room:0:") ? "yes" : "no";
  if (q.defaultValue !== undefined) return undefined;
  switch (q.kind.type) {
    case "yesNo":
      return /water extraction/i.test(q.prompt) ? "yes" : "no";
    case "choice":
      return q.kind.options.find((o) => o === "Removed and replaced" || o === "Fiberglass batt") ?? q.kind.options[0];
    case "equipmentPlan":
      return String(q.kind.suggested);
    case "wholeNumber":
      return "1";
    case "decimal":
      return "3.25";
    default:
      return "half";
  }
}

export function checkSameRound({ mod, check, claim: baseClaim }) {
  const { claimRound, withExtraction, parseSavedClaimState, emptySavedClaimState } = mod;
  const { claim, transcript, sketch, moisture, extraction } = basementLoss(mod, baseClaim);

  /* ── Live: the transcript read with the plan and the map already on the claim ─────────────── */

  const before = { ...emptySavedClaimState(), step: "transcript", claim, transcript, sketch, moisture };
  const read = withExtraction(before, extraction);
  check(read.step === "questions", `the basement claim goes to the questions step after its read (got ${read.step})`);
  const onScreen = { ...before, ...read };

  /* ── Answering it, a wave at a time, the way the demo did ──────────────────────────────────── */

  const reloaded = (answers) => parseSavedClaimState(JSON.parse(JSON.stringify({ ...onScreen, answers })));
  const shape = (q) => ({ id: q.id, prompt: q.prompt, defaultValue: q.defaultValue ?? null, kind: q.kind });

  const answers = {};
  const waves = [];
  for (let wave = 0; wave < 12; wave += 1) {
    const snapshot = { ...answers };
    const live = claimRound({ ...onScreen, answers: snapshot });
    const again = claimRound(reloaded(snapshot));
    waves.push({ answers: snapshot, live, again });

    const label = `wave ${wave} (${Object.keys(snapshot).length} answers)`;
    const d =
      difference(live.display.map(shape), again.display.map(shape), "display") ??
      difference(live.questions.map((q) => q.id), again.questions.map((q) => q.id), "open") ??
      difference(live.applied.map((q) => q.id), again.applied.map((q) => q.id), "applied") ??
      difference(live.extraction, again.extraction, "draft");
    check(d === null, `${label}: the round on screen and the round after a reload are the same — first difference: ${d}`);

    // Everything on screen and not yet answered, pre-filled or not: a pre-fill is typed over the same way.
    let gave = 0;
    for (const q of live.display.filter((x) => snapshot[x.id] === undefined)) {
      const a = basementAnswer(q);
      if (a !== undefined) {
        answers[q.id] = a;
        gave += 1;
      }
    }
    if (gave === 0) break;
  }

  const first = waves[0];
  const last = waves[waves.length - 1];
  check(waves.length >= 3, `the basement claim takes more than one wave of answers, so follow-ups are compared too (took ${waves.length})`);
  check(last.live.questions.every((q) => last.answers[q.id] !== undefined), "the basement claim ends with every open question answered");

  /* ── What the report was about, said outright ──────────────────────────────────────────────── */

  const ids = (round) => round.display.map((q) => q.id);
  const EXTRACTED = "room:0:waterExtraction:sf";

  // The answered extraction area stays on screen through a reload, with the PM's figure in the draft.
  for (const [how, round] of [["live", last.live], ["after a reload", last.again]]) {
    check(ids(round).includes(EXTRACTED), `${how}: the mechanical room's answered extraction question is still on screen`);
    check(round.extraction.rooms[0].waterExtractionSF === 72, `${how}: the mechanical room's extraction is the PM's 72 SF, not the map's 80 (got ${round.extraction.rooms[0].waterExtractionSF})`);
  }
  // Straight after the read, it is asked with the map's area pre-filled — the map is not ignored, it is offered.
  const offered = first.live.display.find((q) => q.id === EXTRACTED);
  check(offered?.defaultValue === "80 SF", `the mechanical room's extraction question is pre-filled with the map's 80 SF (got ${offered?.defaultValue})`);

  /*
    The cut runs come from the map too, and only once the walls' insulation is settled — that gate is
    by design, so straight after the read neither is asked, live or reloaded. Once it is, both are,
    either way, with the map's length pre-filled and named.
  */
  const CUTS = [["room:0:wall:0:cutRunFt", "6 LF"], ["room:1:wall:0:cutRunFt", "7 LF"]];
  for (const [id] of CUTS) {
    check(!ids(first.live).includes(id) && !ids(first.again).includes(id), `${id} waits for the walls' insulation, live and reloaded`);
  }
  for (const [id, measured] of CUTS) {
    for (const [how, round] of [["live", last.live], ["after a reload", last.again]]) {
      const q = round.display.find((x) => x.id === id);
      check(q?.defaultValue === measured && q.prompt.includes(`moisture map measures ${measured}`), `${how}: ${id} is asked with the map's ${measured} (got ${q ? q.defaultValue : "not asked"})`);
    }
  }

  // Answered means kept: every answer folded in during the round is still a question on screen after a reload.
  const lost = last.live.applied.map((q) => q.id).filter((id) => !ids(last.again).includes(id));
  check(lost.length === 0, `every answered question is still on screen after a reload (lost ${lost.join(", ")})`);
}

/**
 * The round's inputs are written by the PM and by what arrives — never by an effect.
 *
 * An effect that derives one of them from another runs whenever its source changes, and opening a
 * claim is a change: so it rewrites a reloaded claim and leaves the same claim alone while it is being
 * worked on. That is the whole of the 2026-10-30 report. `checkSameRound` cannot see it, because it
 * builds the round the way the page should; this reads the page for the effect that would make it
 * build it some other way.
 *
 * Returns what it found, one line per offending effect, each with the setters it calls.
 */
const ROUND_INPUT_SETTERS = ["setClaim", "setExtraction", "setAnswers", "setResolvedSuggestions", "setSketch", "setMoisture"];

/** Effects that may write one anyway, matched on their body, each with the reason. */
const ALLOWED_EFFECTS = [
  {
    match: /pmName: profile\.fullName/,
    why: "fills the PM's name and phone from their profile into a claim that has neither; no question reads them",
  },
];

export function checkNoEffectRewritesRound(pagePath) {
  const source = readFileSync(pagePath, "utf8").replace(/\r\n/g, "\n");
  const found = [];
  // Component-level hooks are indented two spaces; the lazy match stops at this effect's own close.
  for (const match of source.matchAll(/use(?:Layout)?Effect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]/g)) {
    const body = match[1];
    const setters = ROUND_INPUT_SETTERS.filter((s) => new RegExp(`\\b${s}\\(`).test(body));
    if (setters.length === 0 || ALLOWED_EFFECTS.some((a) => a.match.test(body))) continue;
    const line = source.slice(0, match.index).split("\n").length;
    found.push(`the effect at page.tsx:${line} (on [${match[2].trim()}]) calls ${setters.join(", ")}`);
  }
  return found;
}

/** Deep equality that ignores key order, with the first difference named. */
function difference(a, b, path) {
  if (a === b) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return (a ?? null) === (b ?? null) ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    const d = difference(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
