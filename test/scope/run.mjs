/**
 * Scope output — the deterministic half.
 *
 *   npm run test:scope
 *
 * The scope document is written by a model from `documentGenerationPrompt.ts`; the work orders are
 * rendered here in TypeScript from the same rules in `paintDerivation.ts`. Two expressions of one
 * rule set, which is only safe while they agree — so this covers the executable half, and the shared
 * module is what keeps the prompt honest about the same numbers.
 *
 * Written after a report that a replaced ceiling produced no priming or painting anywhere, and that
 * a measured ceiling quantity never said it was a ceiling. Neither had any test at all.
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { RENDERED, NOT_RENDERED, NOT_MODELLED } from "./rendered.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "scope-tests-"));
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

const {
  ceilingPaintLine, ceilingQuantity, primingLine, buildWorkOrders, emptyClaimInfo, withDerivedFields,
  surfaceThumbnails, surfaceRenderId, isSurfaceRender, availableRenders, pruneAttachments,
  sketchRenderLabel, sketchRenderDescription, parseRender, defaultSketchAttachments, PIXELS_PER_FOOT,
  pruneScopeMarks, scopeWallRunFeet,
  emptyMoistureMap, setRoomMoisture, resolveRound,
} = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}

/* ── Every fact the tree holds reaches the scope, or is documented as not needing to ─────────────── */

/*
  The mirror image of test/gapcheck/extractable.mjs. Generation is handed BOTH the tree and the
  transcript: the inspection report is narrative and written from the transcript, the scope's line
  items are built only from rules that see the tree. A fact with a home in the tree but no rule
  naming it therefore reads as correct in the report and vanishes from the scope — which is exactly
  what makes it hard to spot, and has now been reported three times (equipment, antimicrobial,
  floor cleaning).
*/
{
  const promptSource = readFileSync(join(root, "lib", "documentGenerationPrompt.ts"), "utf8");
  const unruled = [...RENDERED.keys()].filter((key) => !promptSource.includes(key.split(".")[1]));
  check(
    unruled.length === 0,
    ["a rule in documentGenerationPrompt.ts names every fact the scope must render.",
     "         Named in test/scope/rendered.mjs but absent from the prompt:",
     ...unruled.map((k) => `           ${k}  — claimed rule: ${RENDERED.get(k)}`)].join("\n"),
  );

  // The tables must describe reality: a fact cannot be both rendered and deliberately not rendered.
  const both = [...RENDERED.keys()].filter((k) => NOT_RENDERED.has(k));
  check(both.length === 0, `no fact is listed as both rendered and not rendered (got ${both.join(", ")})`);

  // A hole that has since been modelled must move out of NOT_MODELLED rather than sit there stale.
  const closed = [...NOT_MODELLED.keys()].filter((k) => RENDERED.has(k));
  check(closed.length === 0, `NOT_MODELLED holds only genuinely unmodelled work (stale: ${closed.join(", ")})`);
}

/* ── Fixtures ──────────────────────────────────────────────────────────────────────────────────── */

function ceiling(overrides = {}) {
  return {
    type: "DRYWALL_PLASTER", action: "REMOVE_AND_REPLACE", finish: "SMOOTH", textureStyle: null,
    spaceAboveHasInsulation: false, aboveInsulationAffected: null, aboveInsulationType: null,
    aboveInsulationRValue: null, detachScope: null, tileSize: null, mountMethod: null,
    replaceSF: 120, replaceFraction: null, ...overrides,
  };
}
function wall(overrides = {}) {
  return { wallMaterial: "DRYWALL", drywallBeingRemoved: true, insulationAffected: null, insulationType: null, insulationRValue: null, floodCutHeightIn: null, cutHeight: "TWO_FOOT", cutRunFt: 30, cutRunFraction: null, ...overrides };
}
function flooring(overrides = {}) {
  return {
    type: "CONCRETE", carpetStyle: null, padPresent: null, vinylSubtype: null, vinylInstallation: null,
    vinylSubstrate: null, hardwoodConstruction: null, hardwoodConstructionOther: null, hardwoodInstallation: null,
    disposition: "DRY_IN_PLACE", phase: null, phaseUncertain: false, padRemoved: null,
    removalSF: null, removalFraction: null, cleaningRequired: null,
    carpetLiftSF: null, carpetLiftFraction: null, padRemovedSF: null, padRemovedFraction: null, ...overrides,
  };
}
function room(name, overrides = {}) {
  return { roomName: name, flooring: [], baseboard: [], walls: [], ceilings: [], doors: [], cabinetry: [], toeKicks: [], countertops: [], wallTile: [], outlets: [], lightFixtures: [], electricalPanel: null, plumbingFixtures: [], stairs: null, floorRegistersDetached: null, contents: null, equipment: [], antimicrobialApplied: null, containmentRequired: null, containmentSF: null, hepaVacuumingRequired: null, appliances: [], waterExtractionRequired: null, waterExtractionSF: null, waterExtractionFraction: null, baseboardConfirmedAbsent: false, windowCleaningAsked: false, windowCleaningCounts: null, equipmentAsked: false, ceilingLightFixturesPresent: null, ceilingFixturesInRemovalArea: null, ceilingLightFixtureType: null, ceilingLightFixtureCount: null, otherCeilingFixtures: null, ...overrides };
}

/* ── A replaced ceiling gets primed and painted ────────────────────────────────────────────────── */

/*
  The reported gap: "priming and painting is also not populating for this drywall work." A ceiling
  could be torn out and reinstalled across a whole claim and no finishing line appeared anywhere —
  which reads to an estimator as a ceiling that does not need painting, not one nobody costed.
*/
check(
  ceilingPaintLine(ceiling()) === "Prime & paint ceiling – 120 SF of ceiling",
  `a replaced smooth ceiling is primed and painted (got ${JSON.stringify(ceilingPaintLine(ceiling()))})`,
);
check(
  ceilingPaintLine(ceiling({ replaceSF: null, replaceFraction: "HALF" })) === "Prime & paint ceiling – half of the ceiling",
  `and states a fraction qualitatively (got ${JSON.stringify(ceilingPaintLine(ceiling({ replaceSF: null, replaceFraction: "HALF" })))})`,
);

/*
  A textured ceiling gets NOTHING here — its own texture bullet already says "prime and spray new
  texture". A line here as well would bill the same priming twice.
*/
for (const style of ["POPCORN", "KNOCKDOWN"]) {
  check(
    ceilingPaintLine(ceiling({ finish: "TEXTURE", textureStyle: style })) === null,
    `a ${style} ceiling gets no separate paint line, since its texture bullet already primes`,
  );
}
check(ceilingPaintLine(ceiling({ finish: null })) === null, "and neither does a ceiling whose finish nobody has said yet");
check(ceilingPaintLine(ceiling({ action: "DETACH_AND_RESET" })) === null, "a detached-and-reset ceiling is not repainted");
check(ceilingPaintLine(ceiling({ type: "SUSPENDED_TILE" })) === null, "and a tile ceiling has no drywall to paint");

/* ── A ceiling quantity says it is a ceiling ───────────────────────────────────────────────────── */

/*
  Reported: the scope doc "does not say that SF of drywall work is for the ceiling". The fraction
  branch had always read "half of the ceiling"; the MEASURED branch — the precise one — rendered as
  a bare "120 SF" that could as easily have been a wall run.
*/
check(ceilingQuantity(ceiling()) === "120 SF of ceiling", `a measured ceiling names its surface (got ${JSON.stringify(ceilingQuantity(ceiling()))})`);
check(ceilingQuantity(ceiling({ replaceSF: null, replaceFraction: "FULL" })) === "the whole of the ceiling" || ceilingQuantity(ceiling({ replaceSF: null, replaceFraction: "FULL" })).includes("ceiling"), "and so does a fraction");
check(ceilingQuantity(ceiling({ replaceSF: null, replaceFraction: null })) === "ceiling", "with nothing captured it still says which surface");

/* ── Walls are unchanged ───────────────────────────────────────────────────────────────────────── */

// The ceiling rule must not have leaked into the wall rule: a 2' cut still uses the feather-out
// multiplier, which is a patch-band allowance and has nothing to do with a ceiling.
check(primingLine(wall()) === "Prime & paint walls – 90 SF", `a 2' cut over 30 LF still primes 90 SF (got ${JSON.stringify(primingLine(wall()))})`);
// The one priming branch that produced a bare figure now names its surface too, so no line in the
// document is a square footage whose surface has to be inferred from where it sits.
check(primingLine(wall()).includes("walls"), "and says it is a wall, not a ceiling");
check(primingLine(wall({ cutHeight: "BASE" })) === null, "and a base-height cut still gets no paint at all");

/* ── The Painting work order carries ceilings ──────────────────────────────────────────────────── */

/*
  `paintDerivation` having the rule is not the same as the crew sheet showing it. The Painting order
  iterated walls and baseboard only, so ceilings were absent from it entirely regardless.
*/
const claim = { ...emptyClaimInfo(), customerName: "Test", jobNumber: "J-1", scopePhases: ["EMERGENCY", "REPAIR"] };
const extraction = withDerivedFields({
  loss: { category: 1, lossClass: 2, source: null, dateOfLoss: null, yearOfBuilding: 2000, asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null, isBasementLoss: false, hvacInspectionRequired: null },
  rooms: [room("Main Bedroom", { ceilings: [ceiling()], walls: [wall()] })],
});

const orders = buildWorkOrders({
  trades: ["PAINTING"],
  claim,
  extraction,
  contentsApproach: "TM",
  contentsTM: { entries: [] },
  bricABrac: { rooms: [] },
  dgigData: null,
});
const painting = orders.find((o) => o.trade === "PAINTING")?.text ?? "";
check(painting !== "", "a Painting work order is produced");
check(
  painting.includes("Prime & paint ceiling – 120 SF of ceiling"),
  `the Painting order carries the ceiling (got:\n${painting.split("\n").filter((l) => l.includes("Prime")).join("\n") || "no Prime lines at all"})`,
);
check(painting.includes("Prime & paint walls – 90 SF"), "alongside the wall priming it always carried");



/* ── A floor that stays, and antimicrobial ─────────────────────────────────────────────────────── */

/*
  Reported: a category 3 basement loss whose transcript said the concrete "just needs to be cleaned
  and treated" and that antimicrobial applied "throughout both spaces". The inspection report had
  both right; the scope had neither. Both facts had no home in the tree at all — antimicrobial lived
  only on DGIG's Emergency form — and the report is written with the transcript in hand while these
  bullets are built only from the tree. Third instance of that asymmetry; drying equipment was first.
*/
const cat3 = { ...emptyClaimInfo(), customerName: "Test", jobNumber: "J-2", waterCategory: 3, scopePhases: ["EMERGENCY", "REPAIR"] };
const emergencyFor = (claimInfo, rooms) =>
  buildWorkOrders({
    trades: ["MITIGATION_DEMO"],
    claim: claimInfo,
    extraction: withDerivedFields({
      loss: { category: 3, lossClass: 2, source: null, dateOfLoss: null, yearOfBuilding: 2000, asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null, isBasementLoss: true, hvacInspectionRequired: null },
      rooms,
    }),
    contentsApproach: "TM",
    contentsTM: { entries: [] },
    bricABrac: { rooms: [] },
    dgigData: null,
  }).find((o) => o.trade === "MITIGATION_DEMO")?.text ?? "";

const cleaned = emergencyFor(cat3, [room("Storage Area", { flooring: [flooring({ cleaningRequired: true })] })]);
check(/Clean & treat concrete floor/.test(cleaned), `a floor being cleaned reaches the crew (got:
${cleaned})`);
check(
  !/[Dd]ry in place/.test(cleaned),
  "and is never described as dried in place — that means saving material you would otherwise tear out, and nobody tears out a slab",
);

// Category 1 has nothing to treat.
const cat1 = { ...emptyClaimInfo(), customerName: "Test", jobNumber: "J-3", waterCategory: 1, scopePhases: ["EMERGENCY"] };
const cat1Text = emergencyFor(cat1, [room("Storage Area", { flooring: [flooring({ cleaningRequired: true })] })]);
check(/Clean concrete floor/.test(cat1Text) && !/treat/.test(cat1Text), `a category 1 floor is cleaned, not treated (got:
${cat1Text})`);

// Not stated is not "no" — but it is not a line either.
const unstated = emergencyFor(cat3, [room("Storage Area", { flooring: [flooring()] })]);
check(!/Clean/.test(unstated), "a floor nobody said to clean gets no cleaning line");

const anti = emergencyFor(cat3, [room("Rec Room", { antimicrobialApplied: true }), room("Storage Area", { antimicrobialApplied: true })]);
check(
  (anti.match(/Antimicrobial application/g) ?? []).length === 2,
  `antimicrobial reaches every room it applies to (got ${(anti.match(/Antimicrobial application/g) ?? []).length}):
${anti}`,
);
check(
  !/Antimicrobial/.test(emergencyFor(cat3, [room("Rec Room")])),
  "and a room that never mentioned it gets no line, category 3 or not",
);


/* ── Containment, HEPA, appliances ─────────────────────────────────────────────────────────────── */

/*
  Four categories a PM states routinely that had no field anywhere, so they reached neither document
  as a line. Found by the audit above after two of them were reported; each was confirmed dropped by
  a live extraction call before being built.
*/
const contained = emergencyFor(cat3, [room("Rec Room", { containmentRequired: true, containmentSF: 80 })]);
check(/Containment – poly barrier – 80 SF/.test(contained), `containment carries its barrier area (got:
${contained})`);

/*
  A barrier hangs across an opening; its area has nothing to do with the floor it stands on. So a
  missing figure stays missing rather than borrowing the room's — a confidently wrong number on a
  priced line is worse than a blank somebody fills in.
*/
const unmeasured = emergencyFor(cat3, [room("Rec Room", { containmentRequired: true, containmentSF: null, flooring: [flooring({ removalSF: 400 })] })]);
check(/Containment – poly barrier/.test(unmeasured), "containment with no size still gets its line");
check(
  !unmeasured.split("\n").some((line) => line.includes("Containment") && line.includes("400")),
  "and never borrows the room's floor area for it",
);
check(!/Containment/.test(emergencyFor(cat3, [room("Rec Room")])), "a room with no containment gets no line");

const hepa = emergencyFor(cat3, [room("Rec Room", { hepaVacuumingRequired: true })]);
check(/HEPA vacuuming – floor area/.test(hepa), `HEPA vacuuming reaches the crew (got:
${hepa})`);
check(!/HEPA/.test(emergencyFor(cat3, [room("Rec Room")])), "and only where it was actually stated");

/*
  Appliances are a PAIR, like baseboard. A room whose emergency sheet says the washer came out and
  whose repair sheet says nothing reads as an appliance nobody put back.
*/
const withAppliances = [room("Laundry", { appliances: [{ type: "WASHER" }, { type: "DRYER" }, { type: "BUILT_IN_MICROWAVE" }] })];
const demo = emergencyFor(cat3, withAppliances);
check(/Detach washer/.test(demo) && /Detach dryer/.test(demo), `each appliance is detached (got:
${demo})`);
check(/Detach built-in microwave/.test(demo), "and the label reads as words, not as an enum");
const carpentry = buildWorkOrders({
  trades: ["FINISH_CARPENTRY"],
  claim: cat3,
  extraction: withDerivedFields({
    loss: { category: 3, lossClass: 2, source: null, dateOfLoss: null, yearOfBuilding: 2000, asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null, isBasementLoss: true, hvacInspectionRequired: null },
    rooms: withAppliances,
  }),
  contentsApproach: "TM",
  contentsTM: { entries: [] },
  bricABrac: { rooms: [] },
  dgigData: null,
}).find((o) => o.trade === "FINISH_CARPENTRY")?.text ?? "";
check(/Reset washer/.test(carpentry) && /Reset dryer/.test(carpentry), `and every one goes back on repairs (got:
${carpentry})`);
check(
  !/Remove washer|Replace washer/.test(demo + carpentry),
  "never removed or replaced — a restoration contractor does not buy the homeowner a new washer",
);

/* ── A baseboard that comes off goes back on ───────────────────────────────────────────────────── */

/*
  The reported gap, in the outputs that render it deterministically. A bathroom's baseboard was
  removed in Emergency and replaced nowhere: no "Replace baseboard" line in the scope document's
  Repair section, and — the same field, the same silence — no baseboard line in either work order.
  The room next door, identical but for one captured field, got both.

  The scope document is written by a model from documentGenerationPrompt.ts, so what is executable
  here is the crew-sheet half: a removed-and-replaced baseboard produces BOTH halves of the job, the
  Emergency removal and the Repair replacement. The prompt now states the same pairing in prose, and
  gap-check (test/gapcheck/run.mjs) is what guarantees the action both of them read is ever set.

  The height rides along as a spec detail on the replacement, never a condition on it — a record with
  no height captured produces exactly the same pair.
*/

const bbLoss = { category: 1, lossClass: 2, source: null, dateOfLoss: null, yearOfBuilding: 2000, asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null, isBasementLoss: false, hvacInspectionRequired: null };
const bbExtraction = (rooms) => withDerivedFields({ loss: bbLoss, rooms });

function bbRecord(overrides = {}) {
  return { material: "MDF", heightIn: 3.25, wallRunFt: null, action: "REMOVE_AND_REPLACE", disposition: "REMOVE_AND_DISPOSE", phase: null, phaseUncertain: false, mdfProfile: "PROFILE", ...overrides };
}

/** Both phases' crew sheets for one tree: Mitigation & Demo is the Emergency half, Finish Carpentry the Repair half. */
function bbOrders(extractionTree) {
  return buildWorkOrders({
    trades: ["MITIGATION_DEMO", "FINISH_CARPENTRY"],
    claim,
    extraction: extractionTree,
    contentsApproach: "TM",
    contentsTM: { entries: [] },
    bricABrac: { rooms: [] },
    dgigData: null,
  });
}
const bbText = (orders, trade) => orders.find((o) => o.trade === trade)?.text ?? "";

for (const [label, record] of [
  ["with a height captured", bbRecord()],
  ["with no height captured", bbRecord({ heightIn: null })],
]) {
  const built = bbOrders(bbExtraction([room("Basement Bathroom", { baseboard: [record] })]));
  const emergency = bbText(built, "MITIGATION_DEMO");
  const repair = bbText(built, "FINISH_CARPENTRY");
  check(
    emergency.includes("Remove baseboard"),
    `a removed-and-replaced baseboard ${label} comes off in Emergency (got:\n${emergency})`,
  );
  check(
    repair.includes("Install new baseboard"),
    `and the same baseboard ${label} goes back on in Repair (got:\n${repair})`,
  );
}

/*
  End to end, from the shape extraction actually hands over.

  The bathroom's record arrives with no action at all — the reported claim exactly — and gap-check is
  what turns it into a job the orders can render. Rendering from the raw extracted record produces
  neither half, which is what made the missing Repair line so quiet: nothing errors, a room simply
  says less than it should.
*/
const bbExtracted = { material: null, heightIn: null, wallRunFt: null, action: null, disposition: null, phase: null, phaseUncertain: false, mdfProfile: null };
const bbRaw = bbOrders(bbExtraction([room("Basement Bathroom", { baseboard: [bbExtracted] })]));
check(
  !bbText(bbRaw, "MITIGATION_DEMO").includes("baseboard") && !bbText(bbRaw, "FINISH_CARPENTRY").includes("baseboard"),
  "a baseboard whose action was never settled renders in neither order — which is why gap-check has to ask",
);

const bbAnswered = resolveRound(claim, bbExtraction([room("Basement Bathroom", { baseboard: [bbExtracted] })]), {
  "room:0:baseboard:0:action": "Removed and replaced",
  "room:0:baseboard:0:material": "MDF with profile",
  "room:0:baseboard:0:heightIn": "3.25",
});
const bbBuilt = bbOrders(bbAnswered.extraction);
check(
  bbText(bbBuilt, "MITIGATION_DEMO").includes("Remove baseboard"),
  `answered, it comes off in Emergency (got:\n${bbText(bbBuilt, "MITIGATION_DEMO")})`,
);
check(
  bbText(bbBuilt, "FINISH_CARPENTRY").includes("Install new baseboard – MDF"),
  `and goes back on in Repair, in the material that was answered (got:\n${bbText(bbBuilt, "FINISH_CARPENTRY")})`,
);
// The height it was never asked for before is on the record now, for the estimator's line in the scope document.
check(
  bbAnswered.extraction.rooms[0].baseboard[0].heightIn === 3.25,
  `with the height recorded (got ${bbAnswered.extraction.rooms[0].baseboard[0].heightIn})`,
);

/* ── Per-surface thumbnails ────────────────────────────────────────────────────────────────────── */

/*
  One plan per surface getting drywall work, with that surface picked out — asked for so a crew
  handed "Replace drywall at 2' – 30 LF" can tell WHICH wall without walking the building.

  The rule that decides whether one exists at all: a wall thumbnail is produced ONLY where the PM
  marked the walls, on the moisture map or via Add-from-sketch. An extraction record says a wall in
  this room is being cut, never which wall, and a picture of highlighted walls is a claim that those
  walls are being worked on. Drywall replaced without a flood cut is the case that legitimately gets
  nothing — a bare square footage says how much, never which wall.
*/
function sketchRoom(id, name, feet = 12, parentRoomId = null) {
  const p = PIXELS_PER_FOOT;
  return {
    id, name, ceilingHeightFeet: 8, ceilingType: "flat", ceilingPeakFeet: null, stairs: null,
    parentRoomId, nestingOptOut: false, symbols: [], freeCabinets: [],
    vertices: [
      { id: id + "a", x: 0, y: 0 },
      { id: id + "b", x: feet * p, y: 0 },
      { id: id + "c", x: feet * p, y: feet * p },
      { id: id + "d", x: 0, y: feet * p },
    ],
  };
}

const planSketch = { rooms: [sketchRoom("r1", "Main Bedroom")] };
const wallWork = withDerivedFields({
  loss: { category: 1, lossClass: 2, source: null, dateOfLoss: null, yearOfBuilding: 2000, asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null, isBasementLoss: false, hvacInspectionRequired: null },
  rooms: [room("Main Bedroom", { walls: [wall()], ceilings: [ceiling()] })],
});

/* ── Nothing marked, no wall thumbnail ─────────────────────────────────────────────────────────── */

const unmarked = surfaceThumbnails(wallWork, planSketch, emptyMoistureMap(), {});
check(
  unmarked.filter((t) => t.surface === "walls").length === 0,
  `walls nobody marked produce no thumbnail (got ${JSON.stringify(unmarked.map((t) => t.label))})`,
);
// The ceiling has no such ambiguity — a room has one — so it still gets its picture.
const ceilingOnly = unmarked.find((t) => t.surface === "ceiling");
check(ceilingOnly?.label === "Main Bedroom — ceiling", `the ceiling still does (got ${JSON.stringify(ceilingOnly?.label)})`);
check(ceilingOnly?.wallIds.length === 0, "and shades the room rather than picking out walls");

/* ── Marked on the moisture map ────────────────────────────────────────────────────────────────── */

// Walls marked affected there come out in Emergency because of that mark-up, which is exactly the
// case where the plan does know which walls.
const wetWall = setRoomMoisture(emptyMoistureMap(), "r1", {
  // A REAL wall id — walls are identified by their starting vertex, so this is the top wall.
  wallReadings: [{ id: "x", wallId: "r1a", startT: 0, endT: 1, affectedHeightFeet: 2, material: "drywall", reading: null, dryStandard: null }],
  floorCells: [], ceilingCells: [], insetsOver18: null,
});
const fromMoisture = surfaceThumbnails(wallWork, planSketch, wetWall, {}).find((t) => t.surface === "walls");
check(
  fromMoisture?.wallIds.length === 1 && fromMoisture.wallIds[0] === "r1a",
  `a wall marked wet produces a thumbnail of exactly that wall (got ${JSON.stringify(fromMoisture?.wallIds)})`,
);
check(fromMoisture?.label === "Main Bedroom — walls", `named by room and surface (got ${JSON.stringify(fromMoisture?.label)})`);

/* ── Marked while answering the cut-run question ───────────────────────────────────────────────── */

/*
  The other route the PM has: "if we are unclear on how much drywall is being replaced in a flood cut
  situation, we can ask to mark up on sketch — then it would generate." That marking lands in
  `ScopeMarks`, a different store from the moisture map on purpose, and it has to count too.
*/
const scopeMarked = {
  "room:0:wall:0:cutRunFt": { walls: [{ roomId: "r1", wallId: "r1b", startT: 0, endT: 1 }], floorCells: {} },
};
const fromScope = surfaceThumbnails(wallWork, planSketch, emptyMoistureMap(), scopeMarked).find((t) => t.surface === "walls");
check(
  fromScope?.wallIds.length === 1 && fromScope.wallIds[0] === "r1b",
  `an Add-from-sketch marking produces one too (got ${JSON.stringify(fromScope?.wallIds)})`,
);

// The two stores record different things — what is wet, and what is being done — so a PM who cut
// past the wet line has pointed at both, and both walls belong in the picture.
const both = surfaceThumbnails(wallWork, planSketch, wetWall, scopeMarked).find((t) => t.surface === "walls");
check(
  both?.wallIds.length === 2 && both.wallIds.includes("r1a") && both.wallIds.includes("r1b"),
  `both marking sources are united, not preferred (got ${JSON.stringify(both?.wallIds)})`,
);

// A marking in another room does not leak into this one.
const elsewhere = { q: { walls: [{ roomId: "r2", wallId: "r2a", startT: 0, endT: 1 }], floorCells: {} } };
check(
  surfaceThumbnails(wallWork, planSketch, emptyMoistureMap(), elsewhere).filter((t) => t.surface === "walls").length === 0,
  "a marking in a different room does not produce a thumbnail here",
);

/* ── Nothing to picture is no thumbnail ────────────────────────────────────────────────────────── */

const noWork = withDerivedFields({ loss: wallWork.loss, rooms: [room("Main Bedroom")] });
check(surfaceThumbnails(noWork, planSketch, wetWall, {}).length === 0, "a room with no drywall work yields none even when walls are marked");
check(surfaceThumbnails(wallWork, { rooms: [] }, wetWall, {}).length === 0, "and neither does a claim with no sketch");
check(surfaceThumbnails(null, planSketch, wetWall, {}).length === 0, "nor one with no extraction yet");

/*
  A room that could be either of two on the plan gets nothing, same rule as the moisture lookup: a
  thumbnail labelled with the wrong room is worse than one that never appears.
*/
const ambiguous = { rooms: [sketchRoom("r1", "Main Bedroom"), sketchRoom("r2", "Bedroom Closet")] };
const bare = withDerivedFields({ loss: wallWork.loss, rooms: [room("Bedroom", { walls: [wall()] })] });
check(surfaceThumbnails(bare, ambiguous, wetWall, {}).length === 0, "an ambiguous room name produces no thumbnail rather than the wrong one");

/* ── They reach the attachment picker, and leave it when the work does ─────────────────────────── */

const marked = surfaceThumbnails(wallWork, planSketch, wetWall, {});
const renders = availableRenders(true, true, marked);
check(renders.includes("clean") && renders.includes("moisture"), "the two whole-plan renders are still offered");
check(renders.includes(surfaceRenderId("r1", "walls")), "alongside each surface thumbnail");
check(isSurfaceRender(surfaceRenderId("r1", "walls")) && !isSurfaceRender("clean"), "and a surface id is distinguishable from a whole-plan one");
check(sketchRenderLabel("clean") === "Sketch", "whole-plan renders keep their fixed names");
check(sketchRenderLabel(surfaceRenderId("r1", "walls"), marked) === "Main Bedroom — walls", "and a surface render is named from the claim");

/*
  A ticked thumbnail whose wall stops being cut must not survive as a selection — it would render
  nothing and read as a lost attachment.
*/
const ticked = { ...defaultSketchAttachments(), scopeDocument: ["clean", surfaceRenderId("r1", "walls")] };
const pruned = pruneAttachments(ticked, availableRenders(true, true, []));
check(
  !pruned.scopeDocument.includes(surfaceRenderId("r1", "walls")) && pruned.scopeDocument.includes("clean"),
  `a thumbnail that stops being produced is dropped from the selection (got ${JSON.stringify(pruned.scopeDocument)})`,
);


/* ── One plan per storey, once there is more than one ──────────────────────────────────────────── */

/*
  Levels share ONE coordinate space so an upper floor can be traced over the one below it. That makes
  a single "the plan" image wrong the moment a second storey exists — it would print one floor on top
  of another. A single-storey claim must keep exactly the ids it has always had, so nothing about the
  common case changes.
*/
const oneStorey = availableRenders(true, true, []);
check(
  oneStorey.join(",") === "clean,moisture",
  `a single-storey claim keeps the plain ids (got ${oneStorey.join(",")})`,
);

const twoStorey = availableRenders(true, true, [], [0, 1]);
check(
  twoStorey.join(",") === "clean:0,moisture:0,clean:1,moisture:1",
  `two storeys give one of each per level, lowest first (got ${twoStorey.join(",")})`,
);
check(
  availableRenders(true, false, [], [0, 1]).join(",") === "clean:0,clean:1",
  "and a claim with no moisture gets only the clean plan of each",
);

check(sketchRenderLabel("clean:0") === "Sketch — Main level", `a level render names its storey (got ${sketchRenderLabel("clean:0")})`);
check(sketchRenderLabel("moisture:1") === "Moisture map — Level above", `including which one (got ${sketchRenderLabel("moisture:1")})`);
check(sketchRenderLabel("clean") === "Sketch", "and a plain id is still just the sketch");
check(
  sketchRenderDescription("clean:1") === sketchRenderDescription("clean"),
  "a level render describes itself the same way the plain one does",
);

check(parseRender("clean").level === null, "a plain id names no level");
check(parseRender("moisture:-1").level === -1, `a negative level parses (got ${parseRender("moisture:-1").level})`);
check(parseRender("moisture:-1").base === "moisture", "alongside what it draws");


/* ── A marking must not outlive the geometry it points at ──────────────────────────────────────── */

/*
  Reported: a deleted sketch left room data behind that reached the finished documents. A scope
  marking is a room id and a wall id — coordinates into a drawing — so deleting the room strands the
  mark while it keeps holding its numbers, and those numbers keep feeding a scope quantity. Same
  class of orphan `pruneMoisture` exists to prevent on the other store indexing the same drawing.
*/
const markSketch = { rooms: [sketchRoom("r1", "Bedroom")] };
const wallId = "r1a";
const liveMark = { "room:0:wall:0:cutRunFt": { walls: [{ roomId: "r1", wallId, startT: 0, endT: 1 }], floorCells: {} } };

check(
  Object.keys(pruneScopeMarks(liveMark, markSketch)).length === 1,
  "a marking on a room that still exists is kept",
);
check(
  pruneScopeMarks(liveMark, markSketch) === liveMark,
  "and the same object is returned when nothing changed, so this is safe to run from an effect",
);

// The room is gone: the mark measured something that no longer exists, so it must go too.
const orphaned = pruneScopeMarks(liveMark, { rooms: [] });
check(Object.keys(orphaned).length === 0, `a marking whose room was deleted is dropped (got ${JSON.stringify(orphaned)})`);

/*
  Dropped ENTIRELY rather than emptied. An empty mark still reads as "this question was answered
  from the sketch", so the question would stay answered with a measurement of nothing — which is a
  quantity of zero in a scope, not a question the PM gets asked again.
*/
const emptied = pruneScopeMarks(
  { q: { walls: [{ roomId: "gone", wallId: "x", startT: 0, endT: 1 }], floorCells: {} } },
  markSketch,
);
check(emptied.q === undefined, "a marking left with nothing is removed, not kept as an empty shell");

// A mark spanning two rooms keeps only the surviving half, and the figure shrinks to match.
const spanning = {
  q: {
    walls: [
      { roomId: "r1", wallId, startT: 0, endT: 1 },
      { roomId: "deleted", wallId: "z", startT: 0, endT: 1 },
    ],
    floorCells: {},
  },
};
const trimmed = pruneScopeMarks(spanning, markSketch);
check(trimmed.q?.walls.length === 1, `a marking spanning a deleted room keeps only the live half (got ${trimmed.q?.walls.length})`);
check(
  scopeWallRunFeet(trimmed.q, markSketch) === 12,
  `and re-measures to just that wall (got ${scopeWallRunFeet(trimmed.q, markSketch)})`,
);

// Painted floor cells are keyed by room id too, and orphan the same way.
const floorOnly = { q: { walls: [], floorCells: { gone: ["1,1"], r1: ["2,2"] } } };
const floorPruned = pruneScopeMarks(floorOnly, markSketch);
check(
  floorPruned.q !== undefined && floorPruned.q.floorCells.gone === undefined && floorPruned.q.floorCells.r1 !== undefined,
  `floor cells for a deleted room are dropped, live ones kept (got ${JSON.stringify(floorPruned.q?.floorCells)})`,
);

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
