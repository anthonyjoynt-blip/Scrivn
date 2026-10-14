/**
 * Answers survive a second read of the walkthrough — lib/answerCarryOver.ts.
 *
 * Update scope (new photo notes) and an edited transcript both read the walkthrough again and
 * replace the extraction tree, which is where every gap-check answer lives. These drive the real
 * engine to an answered tree, read "again", and check three things:
 *
 *   - the same read again keeps every answer: nothing is asked, and the tree is the answered one;
 *   - a record the new read inserts does not take its neighbour's answers;
 *   - where the match is ambiguous, the question is asked again rather than guessed.
 *
 * Called from run.mjs with its harness, so the fixtures and the answering loop are the suite's own.
 */
export function checkCarryOver({ mod, check, claim, room, extractionWith, runToCompletion }) {
  const { carryAnswers, carriedSuggestions, withExtraction, nextQuestions, withDerivedFields, canonicalRecordShapes, emptySavedClaimState, resolveRound } = mod;

  /* ── Records, every field present ──────────────────────────────────────────────────────────── */

  /*
    Every key of the real records, every value unsaid. The canonical shapes are built from the wire's
    sentinels, which map an empty enum to "" rather than null — and "" reads as a stated material.
  */
  const shapes = canonicalRecordShapes();
  const unsaid = (shape) => Object.fromEntries(Object.keys(shape).map((k) => [k, k === "phaseUncertain" ? false : null]));
  const floor = (o = {}) => ({ ...unsaid(shapes.flooring), ...o });
  const baseboard = (o = {}) => ({ ...unsaid(shapes.baseboard), ...o });
  const wall = (o = {}) => ({
    wallMaterial: "DRYWALL", drywallBeingRemoved: true, insulationAffected: null, insulationType: null, insulationRValue: null,
    floodCutHeightIn: null, cutHeight: null, cutRunFt: null, cutRunFraction: null, ...o,
  });
  const door = (o = {}) => ({ location: "", action: "REMOVE_AND_REPLACE", slabOnly: null, doorType: null, doorStyle: null, unitType: null, saveHardware: null, ...o });
  const cabinet = (o = {}) => ({ location: "", action: "REMOVE_AND_REPLACE", extent: null, grade: null, shoringRequired: null, ...o });
  const countertop = (o = {}) => ({ action: "REMOVE_AND_REPLACE", material: null, ...o });
  const ceiling = (o = {}) => ({
    type: "DRYWALL_PLASTER", action: "REMOVE_AND_REPLACE", finish: null, textureStyle: null, spaceAboveHasInsulation: false,
    aboveInsulationAffected: null, aboveInsulationType: null, aboveInsulationRValue: null, detachScope: null, tileSize: null,
    mountMethod: null, replaceSF: null, replaceFraction: null, ...o,
  });
  const vanity = (o = {}) => ({
    fixtureType: "BATHROOM_VANITY", action: "DETACH_AND_RESET", basinCount: null, mount: null, sinkAlsoNeeded: null, topDetached: null,
    topKept: null, topMaterial: null, sinkFaucetSaved: null, grade: null, includesSurround: null, surroundMaterial: null, ...o,
  });
  const equipment = (type, quantity = null) => ({ type, quantity, holeCount: null });

  /** Deep equality that ignores key order, with the first difference named — a bare false explains nothing. */
  function difference(a, b, path = "") {
    if (a === b) return null;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
      return (a ?? null) === (b ?? null) ? null : `${path || "(root)"}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const d = difference(a[k], b[k], path ? `${path}.${k}` : k);
      if (d) return d;
    }
    return null;
  }

  const ids = (c, tree, suggestions) => nextQuestions(c, withDerivedFields(tree), suggestions).map((q) => q.id);
  const carry = (c, before, after, suggestions) => carryAnswers(c, before, after, suggestions);

  /* ── The same read again keeps every answer ────────────────────────────────────────────────── */

  /*
    A walkthrough as extraction hands it over: four rooms, every extractable kind, and enough left
    unsaid that most of the engine is asked — floor types and dispositions, hardwood construction and
    phase, baseboard created by the completeness question, insulation and cut heights, doors, a
    cabinet run and its hardware, a counter, a blind, a drywall ceiling and its fixtures, a tile
    ceiling, a vanity top, carpet lifted for its pad, containment, windows, contents, a subfloor,
    trim, an appliance (asked on a repair-only visit), an unscoped item, the asbestos samples (a 1975
    house) and the furnace (a basement loss).
  */
  function walkthrough({ statedAirMovers = null } = {}) {
    return extractionWith(
      [
        room("Kitchen", {
          flooring: [floor({ type: "VINYL", disposition: "REMOVE_AND_DISPOSE" })],
          walls: [wall()],
          doors: [door({ location: "pantry" })],
          cabinetry: [cabinet({ location: "sink base" })],
          cabinetHardware: [{ location: "sink base", action: null }],
          countertops: [countertop()],
          windowCoverings: [{ type: "BLIND", location: "over the sink", action: null }],
          appliances: [{ type: "DISHWASHER", action: null }],
          trim: [{ kind: "DOOR_CASING", location: "pantry door", action: null }],
          subfloor: [{ type: null, disposition: null, removalSF: null }],
          unscoped: [{ description: "replace two outlets on the wet wall", disposition: null }],
        }),
        room("Main Bathroom", {
          flooring: [floor({ type: null })],
          baseboard: [baseboard({ action: null })],
          ceilings: [ceiling()],
          plumbingFixtures: [vanity(), vanity({ action: "REMOVE_AND_REPLACE" })],
          equipment: [equipment("air movers", statedAirMovers)],
        }),
        room("Bedroom", {
          flooring: [floor({ type: "CARPET", disposition: "LIFT_AND_REINSTALL" })],
          doors: [door({ location: "closet", action: "DETACH_AND_RESET" })],
          equipment: [equipment("dehumidifiers"), equipment("injecti-dry units")],
        }),
        room("Living Room", {
          flooring: [floor({ type: "HARDWOOD", disposition: "REMOVE_AND_ASSESS", phaseUncertain: true })],
          ceilings: [ceiling({ type: "SUSPENDED_TILE" }), ceiling({ type: "SUSPENDED_TILE", action: "DETACH_AND_RESET" })],
          containmentRequired: true,
        }),
      ],
      { yearOfBuilding: 1975, isBasementLoss: true, hvacInspectionRequired: null },
    );
  }

  const LAST = (q) => {
    if (q.kind.type === "choice") return q.kind.options[q.kind.options.length - 1];
    if (q.kind.type === "yesNo") return "No";
    return undefined;
  };
  // Last options for choices but "yes" to every yes/no, so the follow-ups behind a yes are reached too.
  const LAST_BUT_YES = (q) => (q.kind.type === "choice" ? q.kind.options[q.kind.options.length - 1] : undefined);

  // The appliance question is only asked where there is no Emergency phase still to come.
  const repairVisit = { ...claim, scopePhases: ["REPAIR"] };
  // Every question the runs below asked, by shape — `room:N:wall:N:cutHeight`.
  const reached = new Set();

  for (const [label, fixture, choose, visit] of [
    ["job-wide equipment, first answers", walkthrough(), () => undefined, claim],
    ["job-wide equipment, last answers and every no", walkthrough(), LAST, claim],
    // Baseboard replaced rather than reset, so its height is asked — the first option never gets there.
    ["room-by-room equipment, baseboard replaced", walkthrough({ statedAirMovers: 2 }), (q) => (/:baseboard(:\d+)?:action$/.test(q.id) ? "Removed and replaced, with the shoe mold" : undefined), claim],
    ["room-by-room equipment, last answers and every yes", walkthrough({ statedAirMovers: 2 }), LAST_BUT_YES, claim],
    ["a repair-only visit, last answers", walkthrough({ statedAirMovers: 2 }), LAST, repairVisit],
  ]) {
    const asked = ids(visit, fixture);
    check(asked.length > 20, `carry-over (${label}): the fixture is asked plenty to carry (${asked.length})`);
    const answered = runToCompletion(visit, fixture, choose);
    check(answered.ok, `carry-over (${label}): the fixture answers to completion`);
    for (const id of answered.seen.flat()) reached.add(id.replace(/:\d+(?=:|$)/g, ":N"));

    const again = carry(answered.claim, answered.extraction, fixture);
    const reAsked = ids(answered.claim, again.extraction);
    check(reAsked.length === 0, `carry-over (${label}): the same read again asks nothing (asked: ${reAsked.join(", ")})`);
    const diff = difference(again.extraction, answered.extraction);
    check(diff === null, `carry-over (${label}): and the tree is the answered tree (first difference — ${diff})`);

    // The same, through what the claim page and the waiting-step queue both call.
    const state = { ...emptySavedClaimState(), claim: answered.claim, extraction: answered.extraction, step: "results" };
    const next = withExtraction(state, fixture);
    check(next.step === "ready", `carry-over (${label}): Update scope with nothing new goes straight to Ready (got ${next.step})`);
    check(difference(next.extraction, answered.extraction) === null, `carry-over (${label}): withExtraction keeps the answered tree`);
  }

  /*
    "Asks nothing" proves only as much as was asked to begin with. Every question the carry-over has a
    rule for must have come up in the runs above, or a rule could be wrong with nothing to show it.
    The ones it has no rule for, and so asks again, are listed in lib/answerCarryOver.ts's header;
    kitchen sinks and tub surrounds are left out because extraction records neither.
  */
  const RULES = [
    ...["type", "disposition", "hardwoodConstruction", "hardwoodConstructionOther", "hardwoodInstallation", "vinylSubtype", "vinylInstallation",
      "padPresent", "padRemoved", "carpetLiftSF", "padRemovedSF", "removalSF", "phase"].map((f) => `room:N:flooring:N:${f}`),
    ...["action", "shoeMold", "material", "heightIn"].map((f) => `room:N:baseboard:N:${f}`),
    ...["insulationAffected", "insulationType", "insulationRValue", "cutHeight", "cutRunFt"].map((f) => `room:N:wall:N:${f}`),
    ...["slabOnly", "doorType", "doorStyle", "unitType", "saveHardware"].map((f) => `room:N:door:N:${f}`),
    ...["extent", "grade", "shoringRequired"].map((f) => `room:N:cabinetry:N:${f}`),
    "room:N:countertop:N:material",
    ...["finish", "textureStyle", "aboveInsulationAffected", "aboveInsulationType", "aboveInsulationRValue", "replaceSF", "detachScope", "tileSize", "mountMethod"]
      .map((f) => `room:N:ceiling:N:${f}`),
    ...["topDetached", "topKept", "topMaterial"].map((f) => `room:N:plumbing:N:${f}`),
    "room:N:trim:N:action", "room:N:windowCovering:N:action", "room:N:cabinetHardware:N:action", "room:N:appliance:N:action",
    ...["type", "disposition", "removalSF"].map((f) => `room:N:subfloor:N:${f}`),
    "room:N:unscoped:N:disposition",
    "room:N:equipment:N:quantity", "room:N:equipment:N:holeCount", "room:N:equipment:used", "equipment:allRooms:air movers",
    "room:N:baseboard:action", "room:N:waterExtraction:required", "room:N:waterExtraction:sf", "room:N:containment:sf", "room:N:floorRegistersDetached",
    "room:N:ceilingLightFixtures:present", "room:N:ceilingLightFixtures:type", "room:N:ceilingLightFixtures:count", "room:N:otherCeilingFixtures",
    "room:N:ceilingFixtures:inRemovalArea", "room:N:windowCleaning:present", "room:N:windowCleaning:counts", "room:N:contents:size",
    "asbestos:taken", "asbestos:count", "loss:hvacInspectionRequired",
  ];
  const unreached = RULES.filter((shape) => !reached.has(shape));
  check(unreached.length === 0, `carry-over: the same-read fixtures reach every question carried (never asked: ${unreached.join(", ")})`);

  // The job-wide question really is in play in the first fixture — otherwise the case above proves nothing about it.
  check(
    ids(claim, walkthrough()).some((id) => id.startsWith("equipment:allRooms:")),
    "carry-over: the first fixture asks the job-wide equipment question",
  );
  check(
    ids(claim, walkthrough({ statedAirMovers: 2 })).includes("room:0:equipment:used"),
    "carry-over: the room-by-room fixture asks whether equipment was used in the kitchen",
  );

  /* ── Something genuinely new is all that is asked ──────────────────────────────────────────── */

  {
    const answered = runToCompletion(claim, walkthrough());
    const withLaundry = walkthrough();
    // A photo note names a room the walkthrough never did.
    const laundry = `room:${withLaundry.rooms.length}:`;
    withLaundry.rooms.push(room("Laundry", { flooring: [floor({ type: "LAMINATE", disposition: "REMOVE_AND_DISPOSE" })] }));
    const kept = carry(answered.claim, answered.extraction, withLaundry).extraction;
    const asked = ids(answered.claim, kept);
    const elsewhere = asked.filter((id) => !id.startsWith(laundry));
    check(asked.some((id) => id.startsWith(laundry)), `carry-over: a room only a photo note names is asked about (asked: ${asked.join(", ")})`);
    check(elsewhere.length === 0, `carry-over: and nothing already answered is asked again — the job-wide equipment counts included (also asked: ${elsewhere.join(", ")})`);
    // The other rooms keep their counts, so the laundry is asked on its own whether any equipment went in.
    check(asked.includes(`${laundry}equipment:used`), "carry-over: the new room is asked whether drying equipment was used in it");
    check(difference(kept.rooms.slice(0, -1), answered.extraction.rooms) === null, "carry-over: and every other room is exactly as answered");
  }

  /* ── A record the new read inserts does not take its neighbour's answers ───────────────────── */

  {
    const before = extractionWith([
      room("Kitchen", {
        flooring: [floor({ type: "CARPET", disposition: "REMOVE_AND_DISPOSE" })],
        walls: [wall()],
        doors: [door({ location: "pantry" })],
      }),
    ]);
    const answered = runToCompletion(claim, before, (q) => {
      if (q.id.endsWith(":cutHeight")) return "4 feet";
      if (q.id.endsWith(":doorType")) return "Solid core";
      if (q.id.endsWith(":removalSF")) return "120";
      return undefined;
    });
    const kitchen = answered.extraction.rooms[0];
    check(kitchen.walls[0].cutHeight === "FOUR_FOOT" && kitchen.doors[0].doorType === "SOLID_CORE", "carry-over: the inserted-record fixture was answered");

    // Read again: a hallway ahead of the kitchen, and a new wall, door and floor ahead of each old one.
    const after = extractionWith([
      room("Hallway", { flooring: [floor({ type: "LAMINATE", disposition: "REMOVE_AND_DISPOSE" })] }),
      room("Kitchen", {
        flooring: [floor({ type: "VINYL", disposition: "REMOVE_AND_DISPOSE" }), floor({ type: "CARPET", disposition: "REMOVE_AND_DISPOSE" })],
        walls: [wall({ wallMaterial: "PLASTER" }), wall()],
        doors: [door({ location: "front entry" }), door({ location: "the Pantry" })],
      }),
    ]);
    const kept = carry(answered.claim, answered.extraction, after).extraction;
    const k = kept.rooms[1];
    check(k.walls[1].cutHeight === "FOUR_FOOT" && k.walls[1].insulationAffected === kitchen.walls[0].insulationAffected, "carry-over: the drywall keeps its cut height though a plaster wall now comes first");
    check(k.walls[0].cutHeight === null && k.walls[0].insulationAffected === null, "carry-over: and the inserted plaster wall is given none of it");
    check(k.doors[1].doorType === "SOLID_CORE" && k.doors[0].doorType === null, "carry-over: the pantry door keeps its answers, the new entry door gets none");
    check(k.flooring[1].removalSF === 120 && k.flooring[0].removalSF === null, "carry-over: the carpet keeps its 120 SF, the inserted vinyl does not get it");
    check(kept.rooms[0].flooring[0].removalSF === null, "carry-over: the inserted hallway takes nothing of the kitchen's");

    const asked = ids(answered.claim, kept);
    for (const id of ["room:1:wall:0:insulationAffected", "room:1:door:0:doorType", "room:1:flooring:0:removalSF", "room:0:flooring:0:removalSF"]) {
      check(asked.includes(id), `carry-over: ${id} is asked of the inserted record`);
    }
    const reAsked = asked.filter((id) => /^room:1:(wall|door|flooring):1:/.test(id));
    check(reAsked.length === 0, `carry-over: nothing about the kitchen's original wall, door or floor is asked again (asked: ${reAsked.join(", ")})`);
  }

  /* ── Ambiguous matches are asked again ─────────────────────────────────────────────────────── */

  {
    const before = extractionWith([
      room("Kitchen", {
        flooring: [floor({ type: "TILE", disposition: "REMOVE_AND_DISPOSE" }), floor({ type: "VINYL", disposition: "REMOVE_AND_DISPOSE" })],
        baseboard: [baseboard({ action: null })],
        walls: [wall()],
        doors: [door({ location: "pantry" })],
      }),
    ]);
    const answered = runToCompletion(claim, before, (q) => (q.id.endsWith(":cutHeight") ? "2 feet" : undefined));

    // Two drywall walls now, where there was one: which of them was cut at two feet is not knowable.
    const twoWalls = extractionWith([room("Kitchen", { ...answered.extraction.rooms[0], walls: [wall(), wall()] })]);
    const walls = carry(answered.claim, answered.extraction, twoWalls).extraction.rooms[0].walls;
    check(walls.every((w) => w.cutHeight === null && w.insulationAffected === null), "carry-over: two walls that both match one old wall get none of its answers");
    const wallsAsked = ids(answered.claim, { ...twoWalls, rooms: [{ ...twoWalls.rooms[0], walls }] });
    check(wallsAsked.includes("room:0:wall:0:insulationAffected") && wallsAsked.includes("room:0:wall:1:insulationAffected"), "carry-over: both are asked");

    // Baseboard says nothing about itself, so two where there was one is two unknowns.
    const twoBaseboards = extractionWith([room("Kitchen", { ...before.rooms[0], baseboard: [baseboard({ action: null }), baseboard({ action: null })] })]);
    const bb = carry(answered.claim, answered.extraction, twoBaseboards).extraction.rooms[0].baseboard;
    check(bb.every((b) => b.action === null && b.material === null), "carry-over: two baseboards where there was one take neither's answers");

    // A floor that does not say what it is, in a room that had two.
    const unnamedFloor = extractionWith([room("Kitchen", { ...before.rooms[0], flooring: [floor({ disposition: "REMOVE_AND_DISPOSE" })] })]);
    const f = carry(answered.claim, answered.extraction, unnamedFloor).extraction.rooms[0].flooring[0];
    check(f.type === null, "carry-over: a floor of no stated material is not guessed between the room's two old floors");

    // Two doors with the same words for where they are.
    const twoPantries = extractionWith([room("Kitchen", { ...before.rooms[0], doors: [door({ location: "pantry" }), door({ location: "Pantry" })] })]);
    const doors = carry(answered.claim, answered.extraction, twoPantries).extraction.rooms[0].doors;
    check(doors.every((d) => d.doorType === null), "carry-over: two doors at the same place take neither's answers");

    // Two old rooms of one name: which bedroom the new one is cannot be told.
    const bedrooms = extractionWith([
      room("Bedroom", { flooring: [floor({ type: "CARPET", disposition: "REMOVE_AND_DISPOSE" })] }),
      room("bedroom", { flooring: [floor({ type: "CARPET", disposition: "REMOVE_AND_DISPOSE" })] }),
    ]);
    const bedroomsAnswered = runToCompletion(claim, bedrooms);
    const oneBedroom = extractionWith([bedrooms.rooms[0]]);
    const oneKept = carry(bedroomsAnswered.claim, bedroomsAnswered.extraction, oneBedroom).extraction.rooms[0];
    check(oneKept.flooring[0].removalSF === null && oneKept.contents === null, "carry-over: one bedroom read again from two of that name is asked afresh");
    const split = carry(claim, runToCompletion(claim, oneBedroom).extraction, bedrooms).extraction.rooms;
    check(split.every((r) => r.flooring[0].removalSF === null), "carry-over: and two read from one are both asked afresh");

    // The placeholder never pairs: the room it was answered to be is not knowable from the new read.
    const unnamed = extractionWith([room("Unnamed Room", { flooring: [floor({ type: "TILE", disposition: "REMOVE_AND_DISPOSE" })] })]);
    const named = runToCompletion(claim, unnamed, (q) => (q.id.endsWith(":roomName") ? "Laundry" : undefined));
    check(named.extraction.rooms[0].roomName === "Laundry", "carry-over: the unnamed room was named by its answer");
    const unnamedAsked = ids(named.claim, carry(named.claim, named.extraction, unnamed).extraction);
    check(unnamedAsked.includes("room:0:roomName") && unnamedAsked.includes("room:0:flooring:0:removalSF"), "carry-over: read again unnamed, it is asked what room it is and everything else");
  }

  /* ── What the new read says stands, and a carried value needs the same conditions ───────────── */

  {
    const before = extractionWith([
      room("Main Bathroom", {
        baseboard: [baseboard({ action: "REMOVE_AND_REPLACE", disposition: "REMOVE_AND_DISPOSE", shoeMold: false })],
        walls: [wall()],
        ceilings: [ceiling()],
        flooring: [floor({ type: "VINYL", disposition: "REMOVE_AND_ASSESS" })],
      }),
    ]);
    const answered = runToCompletion(claim, before, (q) => {
      if (q.id.endsWith(":heightIn")) return "4";
      if (q.id.endsWith(":finish")) return "Texture";
      if (q.id.endsWith(":textureStyle")) return "Popcorn";
      if (q.id.endsWith(":insulationAffected")) return "Yes";
      if (q.id.endsWith(":removalSF")) return "half";
      return undefined;
    });
    const was = answered.extraction.rooms[0];
    check(was.baseboard[0].heightIn === 4 && was.ceilings[0].textureStyle === "POPCORN" && was.walls[0].insulationType !== null, "carry-over: the conditions fixture was answered");

    // A photo note says otherwise: 3" baseboard, a smooth ceiling, dry insulation, the vinyl is being replaced.
    const after = extractionWith([
      room("Main Bathroom", {
        baseboard: [baseboard({ action: "REMOVE_AND_REPLACE", disposition: "REMOVE_AND_DISPOSE", shoeMold: false, heightIn: 3 })],
        walls: [wall({ insulationAffected: false })],
        ceilings: [ceiling({ finish: "SMOOTH" })],
        flooring: [floor({ type: "VINYL", disposition: "REMOVE_AND_DISPOSE" })],
      }),
    ]);
    const now = carry(answered.claim, answered.extraction, after).extraction.rooms[0];
    check(now.baseboard[0].heightIn === 3, "carry-over: a height the new read states is never overwritten by the old answer");
    check(now.ceilings[0].finish === "SMOOTH" && now.ceilings[0].textureStyle === null, "carry-over: a popcorn texture does not follow onto a ceiling now read as smooth");
    check(now.walls[0].insulationAffected === false && now.walls[0].insulationType === null, "carry-over: an insulation type does not follow onto insulation now read as dry");
    check(now.walls[0].cutHeight === was.walls[0].cutHeight, "carry-over: the same wall's cut height, which nothing contradicts, is kept");
    check(now.flooring[0].removalFraction === "HALF", "carry-over: the area coming out is kept when the floor goes from assess to replace");

    /*
      The action answer writes the shoe mold with it ("Detached and reset" means none comes off). A new
      read that heard the shoe mold is coming off but not what happens to the baseboard is not
      overruled by that: the two disagree, so the action is asked again.
    */
    const resetHall = extractionWith([room("Hall", { walls: [wall()], baseboard: [baseboard({ action: null })] })]);
    const reset = runToCompletion(claim, resetHall, (q) => (/:baseboard:\d+:action$/.test(q.id) ? "Detached and reset on repairs" : undefined));
    check(reset.extraction.rooms[0].baseboard[0].shoeMold === false, "carry-over: detached and reset recorded no shoe mold");
    const heardShoe = extractionWith([room("Hall", { walls: [wall()], baseboard: [baseboard({ action: null, shoeMold: true })] })]);
    const shoe = carry(reset.claim, reset.extraction, heardShoe).extraction.rooms[0].baseboard[0];
    check(shoe.shoeMold === true && shoe.action === null, "carry-over: a shoe mold the new read heard is not overwritten, and the action it contradicts is asked again");

    // The shoe-mold question means two things by action; an answer to one is not an answer to the other.
    const finishing = extractionWith([room("Hall", { walls: [wall()], baseboard: [baseboard({ action: "FINISH_ONLY" })] })]);
    const finished = runToCompletion(claim, finishing);
    check(finished.extraction.rooms[0].baseboard[0].shoeMold === true, "carry-over: the finish-only shoe mold was answered yes");
    const removing = extractionWith([room("Hall", { walls: [wall()], baseboard: [baseboard({ action: "REMOVE_AND_REPLACE", disposition: "REMOVE_AND_DISPOSE" })] })]);
    const removed = carry(finished.claim, finished.extraction, removing).extraction.rooms[0].baseboard[0];
    check(removed.shoeMold === null, "carry-over: \"the shoe needs its final coat\" is not carried as \"the shoe is coming off\"");
    check(removed.material === finished.extraction.rooms[0].baseboard[0].material, "carry-over: but the baseboard's material, the same either way, is");
  }

  /* ── Equipment ─────────────────────────────────────────────────────────────────────────────── */

  {
    // Job-wide counts: three air movers in the bathroom, none anywhere else.
    const before = walkthrough();
    const answered = runToCompletion(claim, before, (q) => (q.id === "equipment:allRooms:air movers" ? "1:3" : undefined));
    const BATHROOM = 1;
    const BEDROOM = 2;
    check(answered.extraction.rooms[BEDROOM].equipment.every((e) => e.type !== "air movers"), "carry-over: the job-wide fixture gave the bedroom no air movers");

    // Read again, a photo note puts air movers in the bedroom: that one count is new, the rest are not.
    const after = walkthrough();
    after.rooms[BEDROOM].equipment = [equipment("dehumidifiers"), equipment("air movers")];
    const kept = carry(answered.claim, answered.extraction, after).extraction;
    const keptAsked = ids(answered.claim, kept);
    check(keptAsked.length === 1 && keptAsked[0] === `room:${BEDROOM}:equipment:1:quantity`, `carry-over: news of air movers in the bedroom asks only how many there (asked: ${keptAsked.join(", ")})`);
    check(kept.rooms[BATHROOM].equipment.find((e) => e.type === "air movers")?.quantity === 3, "carry-over: and the bathroom keeps its three");

    // A new room the old answer never covered, with dehumidifiers but no air movers: a count of its
    // own would never be asked about air movers there, so the job-wide questions are asked again whole.
    const laundry = walkthrough();
    laundry.rooms.push(room("Laundry", { flooring: [floor({ type: "TILE", disposition: "REMOVE_AND_DISPOSE" })], equipment: [equipment("dehumidifiers")] }));
    const laundryKept = carry(answered.claim, answered.extraction, laundry).extraction;
    check(ids(answered.claim, laundryKept).includes("equipment:allRooms:air movers"), "carry-over: a new room with only another type of equipment keeps the job-wide question");
    check(laundryKept.rooms.every((r) => r.equipment.every((e) => e.quantity === null)), "carry-over: with none of the old counts carried by halves");

    // Moisture-map plan counts, and whether a suggestion stays answered.
    const map = { kitchen: { equipment: { "air movers": 4 }, floorSquareFeet: null, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: null } };
    const planned = extractionWith([room("Kitchen", { flooring: [floor({ type: "TILE", disposition: "DRY_IN_PLACE" })], equipment: [equipment("air movers")] })]);
    const planAnswered = resolveRound(claim, planned, { "room:0:equipment:0:plan:4": "2" }, map).extraction;
    check(planAnswered.rooms[0].equipment[0].quantity === 2, "carry-over: the plan question took 2 against a suggestion of 4");
    const planKept = carry(claim, planAnswered, planned, map).extraction;
    check(planKept.rooms[0].equipment[0].quantity === 2, "carry-over: the planned count is carried to the new read");
    const retired = ["kitchen::air movers"];
    check(carriedSuggestions(planAnswered, planKept, retired).length === 1, "carry-over: and the suggestion stays answered while the count is the one weighed");
    const restated = extractionWith([room("Kitchen", { ...planned.rooms[0], equipment: [equipment("air movers", 3)] })]);
    check(carriedSuggestions(planAnswered, carry(claim, planAnswered, restated, map).extraction, retired).length === 0, "carry-over: a count the new read states differently is checked against the map again");
  }

  /* ── Answers on screen, not yet continued ──────────────────────────────────────────────────── */

  {
    const fixture = extractionWith([room("Kitchen", { walls: [wall()] })]);
    const state = {
      ...emptySavedClaimState(),
      claim,
      extraction: withDerivedFields(fixture),
      answers: { "room:0:wall:0:insulationAffected": "No" },
      step: "questions",
    };
    const next = withExtraction(state, fixture);
    check(next.extraction.rooms[0].walls[0].insulationAffected === false, "carry-over: an answer typed on screen but not continued is kept through Update scope");
    check(Object.keys(next.answers).length === 0, "carry-over: and the answers map starts empty, as its ids belonged to the old tree");
  }
}
