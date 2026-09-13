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
  emptyMoistureMap, setRoomMoisture, resolveRound, pruneMoisture, paintedFloorSquareFeet,
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
  return { roomName: name, flooring: [], baseboard: [], walls: [], ceilings: [], doors: [], cabinetry: [], toeKicks: [], countertops: [], wallTile: [], outlets: [], lightFixtures: [], electricalPanel: null, plumbingFixtures: [], stairs: null, floorRegistersDetached: null, contents: null, equipment: [], antimicrobialApplied: null, containmentRequired: null, containmentSF: null, hepaVacuumingRequired: null, temporaryPowerRequired: null, appliances: [], trim: [], windowCoverings: [], cabinetHardware: [], subfloor: [], unscoped: [], waterExtractionRequired: null, waterExtractionSF: null, waterExtractionFraction: null, baseboardConfirmedAbsent: false, windowCleaningAsked: false, windowCleaningCounts: null, equipmentAsked: false, ceilingLightFixturesPresent: null, ceilingFixturesInRemovalArea: null, ceilingLightFixtureType: null, ceilingLightFixtureCount: null, otherCeilingFixtures: null, ...overrides };
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



/* ── Moisture paint cannot outlive the floor it describes ─────────────────────────────────────── */

/*
  Reported with a screenshot: after editing a sketch whose moisture map was already done, the painted
  area hung outside the room outline and could not be erased.

  Cells are addressed as `col,row` into a grid anchored at the room's own bounding box, so dragging a
  wall outward moves that anchor and every stored cell silently maps somewhere else. The paint ends up
  outside the room, and nothing can remove it: a stroke only starts over a room, and the brush only
  ever names cells whose centre is inside the outline. It is also not merely ugly — those cells count
  into the affected floor area that gap-check pre-fills from, so stray paint becomes a wrong number.
*/
{
  const small = sketchRoom("r1", "Bedroom", 10);
  /*
    Every cell of the room, painted. Cells are 3 inches (FLOOR_CELL_FEET), so a 10' room is 40 across
    — the first version of this looped 10x10 and painted only the top-left corner, which stayed
    inside the narrowed room and let the bug pass.
  */
  const across = Math.round(10 / 0.25);
  const cells = [];
  for (let col = 0; col < across; col++) for (let row = 0; row < across; row++) cells.push(`${col},${row}`);
  const painted = setRoomMoisture(emptyMoistureMap(), "r1", {
    wallReadings: [], floorCells: cells, ceilingCells: [], insetsOver18Inches: 0,
  });

  // Nothing changed: pruning must be a no-op, and must not churn the object either.
  const unchanged = pruneMoisture(painted, { rooms: [small] });
  check(unchanged.rooms.r1.floorCells.length === cells.length, "an untouched sketch keeps all of its paint");
  check(unchanged.rooms.r1 === painted.rooms.r1, "and keeps the same object, so the effect that prunes cannot loop");

  /*
    The reported case: a wall dragged INWARD.

    Growing the room outward proves nothing — the anchor and the paint move together and everything
    stays inside, which is what the first version of this test did and why it passed against the bug.
    Narrowing is what breaks it: the left edge moving right raises bounds.minX, so every stored key
    now describes a position further right, and the ones past the far wall land outside the room —
    the paint hanging over the edge in the screenshot.
  */
  const p = PIXELS_PER_FOOT;
  const narrowed = {
    ...small,
    vertices: [
      { id: "r1a", x: 5 * p, y: 0 },
      { id: "r1b", x: 10 * p, y: 0 },
      { id: "r1c", x: 10 * p, y: 10 * p },
      { id: "r1d", x: 5 * p, y: 10 * p },
    ],
  };
  const after = pruneMoisture(painted, { rooms: [narrowed] });
  check(
    after.rooms.r1.floorCells.length < cells.length,
    `paint that now falls outside the room is dropped (kept ${after.rooms.r1.floorCells.length} of ${cells.length})`,
  );
  check(after.rooms.r1.floorCells.length > 0, "and paint still inside it is kept — this drops orphans, not the map");

  // The reason it matters: the area billed follows the floor that exists.
  check(
    paintedFloorSquareFeet(after.rooms.r1.floorCells) < paintedFloorSquareFeet(cells),
    "so the affected floor area no longer counts squares outside the room",
  );

  // A deleted room still goes entirely — the behaviour this function already had.
  check(Object.keys(pruneMoisture(painted, { rooms: [] }).rooms).length === 0, "a deleted room takes its readings with it");

  // A key that cannot be parsed describes nothing and can never be drawn or erased.
  const corrupt = setRoomMoisture(emptyMoistureMap(), "r1", {
    wallReadings: [], floorCells: ["3,4", "not-a-cell", ""], ceilingCells: [], insetsOver18Inches: 0,
  });
  check(pruneMoisture(corrupt, { rooms: [small] }).rooms.r1.floorCells.length === 1, "an unparseable cell key is dropped rather than kept forever");
}

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
const withAppliances = [room("Laundry", { appliances: [{ type: "WASHER", action: null }, { type: "DRYER", action: null }, { type: "BUILT_IN_MICROWAVE", action: null }] })];
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

/* ── Trim comes off and goes back, and never becomes the door ──────────────────────────────────── */

/*
  A batch of test transcripts lost every casing, jamb, sill and return. One lost it in the worst
  direction: "door jamb on the closet door needs replacing, it warped" came out as
  *Remove & replace door – Colonial, pre-hung*. That is not a dropped line but an inflated one — a
  strip of wood priced as a whole pre-hung unit, and nothing about the sentence looks wrong.

  So these check both halves: that trim appears at all, and that it stays trim.
*/
const withTrim = [room("Hall", {
  trim: [
    { kind: "DOOR_JAMB", location: "closet door", action: "REMOVE_AND_REPLACE" },
    { kind: "WINDOW_CASING", location: "front window", action: "DETACH_AND_RESET" },
  ],
})];
const trimDemo = emergencyFor(cat3, withTrim);
check(/Remove door jamb/.test(trimDemo), `a jamb being replaced is removed by name (got:
${trimDemo})`);
check(/Detach window casing/.test(trimDemo), "and casing coming off for later reuse is detached, not removed");
check(
  !/Remove door – |Install new door|Replace door/.test(trimDemo),
  "and NO door line appears from a jamb — the failure this whole category exists to stop",
);

const trimCarpentry = buildWorkOrders({
  trades: ["FINISH_CARPENTRY"],
  claim: cat3,
  extraction: withDerivedFields({
    loss: { category: 3, lossClass: 2, source: null, dateOfLoss: null, yearOfBuilding: 2000, asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null, isBasementLoss: true, hvacInspectionRequired: null },
    rooms: withTrim,
  }),
  contentsApproach: "TM",
  contentsTM: { entries: [] },
  bricABrac: { rooms: [] },
  dgigData: null,
}).find((o) => o.trade === "FINISH_CARPENTRY")?.text ?? "";
check(/Install new door jamb/.test(trimCarpentry), `a replaced jamb is installed on repairs (got:
${trimCarpentry})`);
check(/Reset window casing/.test(trimCarpentry), "and detached casing goes back on — never one half of the pair without the other");
check(/closet door/.test(trimDemo) && /front window/.test(trimCarpentry), "the location travels with it, since it is what tells two casings apart");

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
  return { material: "MDF", heightIn: 3.25, wallRunFt: null, action: "REMOVE_AND_REPLACE", disposition: "REMOVE_AND_DISPOSE", shoeMold: null, phase: null, phaseUncertain: false, mdfProfile: "PROFILE", ...overrides };
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

/* ── Drying mats and temporary power ───────────────────────────────────────────────────────────── */

/*
  Both were prose-only: a drying mat system and a spider box reached the scope once, written from the
  transcript by the generator, and reached the tree never. Mats are ordinary equipment and needed
  nothing but a wider vocabulary. Temporary power is deliberately never gap-checked — a standing "is
  temporary power needed?" would fire on every claim and be answered no on nearly all of them.
*/
const matsOrder = (overrides) =>
  bbText(
    buildWorkOrders({
      trades: ["MITIGATION_DEMO"],
      claim,
      extraction: bbExtraction([room("Basement", overrides)]),
      contentsApproach: "TM",
      contentsTM: { entries: [] },
      bricABrac: { rooms: [] },
      dgigData: null,
    }),
    "MITIGATION_DEMO",
  );

const mats = matsOrder({ equipment: [{ type: "drying mats", quantity: 4, holeCount: null }] });
check(mats.includes("Place equipment – drying mats – 4"), `mats are placed and counted like any other equipment (got:\n${mats})`);
check(!mats.includes("injection holes"), "and drill nothing — that is the other one");

const power = matsOrder({ temporaryPowerRequired: true });
check(power.includes("Set up temporary power distribution"), `a spider box reaches the crew sheet (got:\n${power})`);
check(!matsOrder({ temporaryPowerRequired: null }).includes("temporary power"), "and a claim that never mentioned one gets no line");
check(!matsOrder({ temporaryPowerRequired: false }).includes("temporary power"), "nor does one that said none is needed");

/* ── Injecti-dry drills holes now and fills them later ─────────────────────────────────────────── */

/*
  It is ordinary drying equipment that happens to arrive with a small demolition and a small repair
  attached: holes into the wall to get warm dry air behind the drywall, and those holes filled
  afterwards. Both halves are real line items and neither was on any document — the whole thing
  reached one scope as prose the generator echoed from the transcript, and reached the tree never.

  The point it is NOT: a flood cut. Injecti-dry is chosen precisely so the wall stays up.
*/
const injection = (overrides = {}) => ({ type: "injecti-dry units", quantity: 1, holeCount: 12, ...overrides });
const injectionOrders = (record) =>
  buildWorkOrders({
    trades: ["MITIGATION_DEMO", "DRYWALL"],
    claim,
    extraction: bbExtraction([room("Basement", { equipment: [record] })]),
    contentsApproach: "TM",
    contentsTM: { entries: [] },
    bricABrac: { rooms: [] },
    dgigData: null,
  });

const inj = injectionOrders(injection());
const injDemo = bbText(inj, "MITIGATION_DEMO");
const injDrywall = bbText(inj, "DRYWALL");
check(injDemo.includes("Place equipment – injecti-dry units – 1"), `the unit is placed like any other equipment (got:\n${injDemo})`);
check(injDemo.includes("Drill injection holes – 12"), "and the holes it needs are their own line, with the count");
check(injDrywall.includes("Fill & finish injection holes – 12"), `filled on the drywall order, which is the trade that patches (got:\n${injDrywall})`);

const noCount = injectionOrders(injection({ holeCount: null }));
check(
  bbText(noCount, "MITIGATION_DEMO").includes("Drill injection holes") &&
    bbText(noCount, "DRYWALL").includes("Fill & finish injection holes"),
  "both lines survive a count nobody stated — a missing quantity is not evidence the work is not happening",
);

const airMovers = injectionOrders({ type: "air movers", quantity: 3, holeCount: null });
check(
  !bbText(airMovers, "MITIGATION_DEMO").includes("injection holes") && !bbText(airMovers, "DRYWALL").includes("injection holes"),
  "and ordinary equipment drills nothing",
);
check(
  !injDemo.includes("Remove drywall") && !injDrywall.includes("Replace drywall"),
  "injecti-dry never implies drywall coming off — the wall staying up is the whole reason it is chosen",
);

/* ── Blinds and cabinet hardware, which used to reach no field at all ──────────────────────────── */

/*
  "There's also a blind on that window, detach it before the sill work, reset it after" was as clear
  an instruction as anything else in the dictation and landed nowhere. It survived into one scope
  only because generation is handed the raw transcript as well as the tree — and the same run
  silently dropped a rotted sill, which is why that is not a mechanism to rely on.
*/
const fittingSheets = (overrides) => {
  const built = bbOrders(bbExtraction([room("Entry", overrides)]));
  return { emergency: bbText(built, "MITIGATION_DEMO"), repair: bbText(built, "FINISH_CARPENTRY") };
};

const blind = fittingSheets({ windowCoverings: [{ type: "BLIND", location: "front window", action: "DETACH_AND_RESET" }] });
check(blind.emergency.includes("Detach blind – front window"), `a blind comes down by name (got:\n${blind.emergency})`);
check(blind.repair.includes("Reset blind – front window"), `and goes back up (got:\n${blind.repair})`);

const shutter = fittingSheets({ windowCoverings: [{ type: "SHUTTER", location: "", action: "REMOVE_AND_REPLACE" }] });
check(
  shutter.emergency.includes("Remove shutter") && shutter.repair.includes("Install new shutter"),
  "and the type is named, since a roller shade and plantation shutters are not the same labour",
);

const blindBack = fittingSheets({ windowCoverings: [{ type: "BLIND", location: "front window", action: "RESET_ONLY" }] });
check(!blindBack.emergency.includes("blind"), `a blind already down gets no Emergency line (got:\n${blindBack.emergency})`);
check(blindBack.repair.includes("Reset blind"), "but is still re-hung");

const hardwareOff = fittingSheets({ cabinetHardware: [{ location: "base run", action: "DETACH_AND_RESET" }] });
check(hardwareOff.emergency.includes("Detach cabinet hardware – base run"), `hardware coming off is its own line (got:\n${hardwareOff.emergency})`);
check(hardwareOff.repair.includes("Reset cabinet hardware – base run"), "and goes back on");

const hardware = fittingSheets({ cabinetHardware: [{ location: "base run", action: "RESET_ONLY" }] });
check(!hardware.emergency.includes("cabinet hardware"), "hardware already pulled is not pulled again");
check(hardware.repair.includes("Reset cabinet hardware – base run"), `but goes back on (got:\n${hardware.repair})`);

const noFittings = fittingSheets({});
check(
  !noFittings.emergency.includes("blind") && !noFittings.emergency.includes("cabinet hardware"),
  "and a room with neither gets neither — most windows have something on them and almost none is in scope",
);

/* ── A door's style is on the line, because it is what the job costs ───────────────────────────── */

/*
  "Pocket door into the bathroom, water got into the wall cavity where it slides, more involved than
  a normal door given it's in the wall" produced a line indistinguishable from any other door in the
  house — because doorType held the CORE and had no room for how the thing opens. The bifold beside
  it landed on OTHER. A scope that calls all three "door" prices the easiest of them.
*/
const doorRecord = (overrides = {}) => ({
  location: "closet", action: "REMOVE_AND_REPLACE", slabOnly: null,
  doorType: "HOLLOW_CORE", doorStyle: null, unitType: "PRE_HUNG", saveHardware: null, ...overrides,
});
const doorSheets = (record) => {
  const built = bbOrders(bbExtraction([room("Hall", { doors: [record] })]));
  return { emergency: bbText(built, "MITIGATION_DEMO"), repair: bbText(built, "FINISH_CARPENTRY") };
};

const pocket = doorSheets(doorRecord({ doorStyle: "POCKET" }));
check(pocket.emergency.includes("Remove pocket door"), `a pocket door is named as one (got:\n${pocket.emergency})`);
check(pocket.repair.includes("Install new pocket door"), "in both phases");

const bifold = doorSheets(doorRecord({ doorStyle: "BIFOLD" }));
check(bifold.emergency.includes("Remove bifold door"), `and so is a bifold (got:\n${bifold.emergency})`);

const swing = doorSheets(doorRecord({ doorStyle: "SWING" }));
check(
  swing.emergency.includes("Remove door") && !swing.emergency.includes("swing door"),
  `an ordinary swing door is just a door — the word would be noise on most lines (got:\n${swing.emergency})`,
);

const unsaidStyle = doorSheets(doorRecord({ doorStyle: null }));
check(
  unsaidStyle.emergency.includes("Remove door") && !unsaidStyle.emergency.includes("swing"),
  "and a style nobody stated is silence, not a claim that it swings",
);

/* ── Repair-visit verbs: the taking-off already happened ───────────────────────────────────────── */

/*
  Two repair-only transcripts in batch 3 were billed for work that had already been done. The fridge
  and dishwasher "were sitting out this whole time" and the scope said *Detach & reset* both. The
  casing "needs to go back on now that the wall's patched" and the scope said detach that too. And
  "baseboard and shoe both need their final coat" had no answerable option at all — every value in
  the enum starts from a removal.

  The failure is not a missing line, it is an extra one: an hour of labour on an estimate for a
  detach nobody is going to do, on a visit whose whole purpose is putting things back.
*/
const resetOnlyRoom = (overrides) => {
  const built = bbOrders(bbExtraction([room("Kitchen", overrides)]));
  return { emergency: bbText(built, "MITIGATION_DEMO"), repair: bbText(built, "FINISH_CARPENTRY") };
};

const applianceOut = resetOnlyRoom({ appliances: [{ type: "FRIDGE", action: "RESET_ONLY" }] });
check(!applianceOut.emergency.includes("Detach fridge"), `an appliance already out is not detached again (got:\n${applianceOut.emergency})`);
const applianceOutRepair = bbText(bbOrders(bbExtraction([room("Kitchen", { appliances: [{ type: "FRIDGE", action: "RESET_ONLY" }] })])), "FINISH_CARPENTRY");
check(applianceOutRepair.includes("Reset fridge"), `but it still goes back (got:\n${applianceOutRepair})`);

const applianceIn = resetOnlyRoom({ appliances: [{ type: "FRIDGE", action: "DETACH_AND_RESET" }] });
check(applianceIn.emergency.includes("Detach fridge"), "an appliance still in place is detached as before");

const applianceUnsaid = resetOnlyRoom({ appliances: [{ type: "FRIDGE", action: null }] });
check(
  applianceUnsaid.emergency.includes("Detach fridge"),
  "and one nobody has been asked about reads as the ordinary job — null is not a claim that the work is done",
);

const trimBack = resetOnlyRoom({ trim: [{ kind: "WINDOW_CASING", location: "front window", action: "RESET_ONLY" }] });
/*
  No Emergency line of ANY wording. Checking only for "Detach" passed vacuously: with the guard
  removed the renderer falls through to the replace branch and writes "Remove window casing", which
  is further from the truth than the line the assertion was looking for.
*/
check(
  !trimBack.emergency.includes("window casing"),
  `casing already off gets no Emergency line at all (got:\n${trimBack.emergency})`,
);
check(trimBack.repair.includes("Reset window casing"), `but it is put back (got:\n${trimBack.repair})`);
check(!trimBack.repair.includes("Install new window casing"), "and it is the same piece going back, not a new one");

/*
  A baseboard that is already installed produces its finish line and NOTHING else. The Painting
  trade is the only sheet it belongs on: nothing is taken off, and nothing is installed.
*/
const finishOnly = bbOrders(bbExtraction([room("Hall", { baseboard: [bbRecord({ action: "FINISH_ONLY" })] })]));
/*
  Three gaps the auditor found after the fact, all of them the same shape: a repair visit that only
  needs a coat of paint written up as though something came off the wall.
*/
const paintingFor = (overrides) =>
  bbText(
    buildWorkOrders({
      trades: ["MITIGATION_DEMO", "FINISH_CARPENTRY", "PAINTING"],
      claim,
      extraction: bbExtraction([room("Hall", overrides)]),
      contentsApproach: "TM",
      contentsTM: { entries: [] },
      bricABrac: { rooms: [] },
      dgigData: null,
    }),
    "PAINTING",
  );
const carpentryFor = (overrides) =>
  bbText(
    buildWorkOrders({
      trades: ["MITIGATION_DEMO", "FINISH_CARPENTRY", "PAINTING"],
      claim,
      extraction: bbExtraction([room("Hall", overrides)]),
      contentsApproach: "TM",
      contentsTM: { entries: [] },
      bricABrac: { rooms: [] },
      dgigData: null,
    }),
    "FINISH_CARPENTRY",
  );

const finishTrim = { trim: [{ kind: "WINDOW_RETURN", location: "front window", action: "FINISH_ONLY" }] };
check(
  paintingFor(finishTrim).includes("Finish window return – front window"),
  `trim staying on the wall is painted (got:\n${paintingFor(finishTrim)})`,
);
check(
  !carpentryFor(finishTrim).includes("window return"),
  "and never reset — re-hanging a piece that never came down is a bigger job than painting it",
);
check(
  !matsOrder(finishTrim).includes("window return"),
  "nor detached: there is no Emergency half to a coat of paint",
);

const shoeCoat = { baseboard: [bbRecord({ action: "FINISH_ONLY", shoeMold: true })] };
check(
  paintingFor(shoeCoat).includes("Finish shoe mold"),
  `"baseboard and shoe both need their final coat" is two coats (got:\n${paintingFor(shoeCoat)})`,
);
check(
  paintingFor(shoeCoat).split("\n").filter((l) => l.includes("aseboard")).length > 0,
  "alongside the baseboard's own, not instead of it",
);
check(
  !paintingFor({ baseboard: [bbRecord({ action: "FINISH_ONLY", shoeMold: false })] }).includes("shoe mold"),
  "and a baseboard with no shoe gets no shoe line",
);

const finishPainting = bbText(
  buildWorkOrders({
    trades: ["PAINTING"],
    claim,
    extraction: bbExtraction([room("Hall", { baseboard: [bbRecord({ action: "FINISH_ONLY" })] })]),
    contentsApproach: "TM",
    contentsTM: { entries: [] },
    bricABrac: { rooms: [] },
    dgigData: null,
  }),
  "PAINTING",
);
check(
  finishPainting.includes("baseboard"),
  `a finish-only baseboard reaches the Painting sheet, which is the whole of its job (got:
${finishPainting})`,
);
check(
  !bbText(finishOnly, "MITIGATION_DEMO").includes("baseboard"),
  `a finish-only baseboard is never removed (got:\n${bbText(finishOnly, "MITIGATION_DEMO")})`,
);
check(
  !bbText(finishOnly, "FINISH_CARPENTRY").includes("baseboard"),
  `nor installed — it is already on the wall (got:\n${bbText(finishOnly, "FINISH_CARPENTRY")})`,
);

/* ── The shoe mold, which used to have nowhere to go ───────────────────────────────────────────── */

/*
  Batch 3 built one claim with all three cases in three rooms, to see whether they render as three
  different jobs. They did not.

  · "both the baseboard and the shoe mold, replacing both" — the shoe was DROPPED. `action` held
    base-only, shoe-only and detach, so the combination was unsayable and the record came out
    identical to a room with no shoe mold at all.
  · "just the shoe mold got damaged, baseboard's fine" — removed in Emergency, replaced nowhere.
    Half a pair, in the opposite direction from the crew sheets, which installed shoe mold in a room
    nothing had been taken off.
  · plain baseboard, no shoe — correct, and the reason the other two went unnoticed.
*/
const shoePair = (record) => {
  const built = bbOrders(bbExtraction([room("Living Room", { baseboard: [record] })]));
  return { emergency: bbText(built, "MITIGATION_DEMO"), repair: bbText(built, "FINISH_CARPENTRY") };
};

const withShoe = shoePair(bbRecord({ shoeMold: true }));
check(withShoe.emergency.includes("Remove shoe mold"), `base and shoe together: the shoe comes off too (got:
${withShoe.emergency})`);
check(withShoe.repair.includes("Install shoe mold"), `and goes back on (got:
${withShoe.repair})`);
check(
  withShoe.emergency.includes("Remove baseboard") && withShoe.repair.includes("Install new baseboard"),
  "alongside the baseboard's own pair, not instead of it — they are two lines with two footages",
);

const detachedWithShoe = shoePair(bbRecord({ action: "DETACH_AND_RESET", shoeMold: true }));
check(
  detachedWithShoe.emergency.includes("Detach shoe mold") && detachedWithShoe.repair.includes("Reset shoe mold"),
  "a baseboard being detached and reset takes its shoe off and puts it back, rather than replacing it",
);

const shoeOnly = shoePair(bbRecord({ action: "SHOE_MOLD_ONLY" }));
check(shoeOnly.emergency.includes("Remove shoe mold"), `shoe only: it comes off in Emergency (got:
${shoeOnly.emergency})`);
check(shoeOnly.repair.includes("Install shoe mold"), "and goes back on in Repair — the half that was missing");
check(
  !shoeOnly.emergency.includes("Remove baseboard") && !shoeOnly.repair.includes("Install new baseboard"),
  "and the baseboard itself is never touched — it is the thing staying put",
);

const noShoe = shoePair(bbRecord({ shoeMold: false }));
check(
  !noShoe.emergency.includes("shoe mold") && !noShoe.repair.includes("shoe mold"),
  "plain baseboard with no shoe gets no shoe line at all — most baseboard has none in the scope",
);

const unknownShoe = shoePair(bbRecord({ shoeMold: null }));
check(
  !unknownShoe.emergency.includes("shoe mold") && !unknownShoe.repair.includes("shoe mold"),
  "and neither does one nobody has been asked about yet — gap-check asks rather than the renderer guessing",
);

/*
  End to end, from the shape extraction actually hands over.

  The bathroom's record arrives with no action at all — the reported claim exactly — and gap-check is
  what turns it into a job the orders can render. Rendering from the raw extracted record produces
  neither half, which is what made the missing Repair line so quiet: nothing errors, a room simply
  says less than it should.
*/
const bbExtracted = { material: null, heightIn: null, wallRunFt: null, action: null, disposition: null, shoeMold: null, phase: null, phaseUncertain: false, mdfProfile: null };
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

/* ── The subfloor comes out and goes back, as a pair ───────────────────────────────────────────── */

/*
  "Floor's on a sleeper subfloor system over the slab, wood sleepers are wet, those need to come out
  along with the vinyl on top." The vinyl reached the scope. The sleepers — the wood framing the
  floor stands on, and by some distance the bigger half of that job — reached nothing, because the
  only fields under a floor were the floor's own. What was produced read as vinyl peeled off a slab.

  A pair like flooring's, and for a firmer reason: nothing stands on a floor with its subfloor gone,
  so the rebuild is not a separate decision the way replacing a carpet is. One half without the
  other is a crew sheet nobody can work from.
*/
const subSheets = (subfloor) => {
  const built = bbOrders(bbExtraction([room("Rec room", { subfloor })]));
  return { emergency: bbText(built, "MITIGATION_DEMO"), repair: bbText(built, "FINISH_CARPENTRY") };
};

const sleeper = subSheets([{ type: "SLEEPER_SYSTEM", disposition: "REMOVE_AND_REPLACE", removalSF: 180 }]);
check(sleeper.emergency.includes("Remove sleeper subfloor – 180 SF"), `the sleepers come out, named and sized (got:\n${sleeper.emergency})`);
check(sleeper.repair.includes("Install new sleeper subfloor – 180 SF"), `and go back — the other half of the pair (got:\n${sleeper.repair})`);

const plywood = subSheets([{ type: "PLYWOOD_OSB", disposition: "REMOVE_AND_REPLACE", removalSF: 180 }]);
check(
  plywood.emergency.includes("Remove plywood/OSB subfloor") && plywood.repair.includes("Install new plywood/OSB subfloor"),
  `the kind is on the line, because sheet goods over joists and sleepers over a slab are not the same job (got:\n${plywood.emergency})`,
);

const unnamedKind = subSheets([{ type: null, disposition: "REMOVE_AND_REPLACE", removalSF: 180 }]);
check(
  unnamedKind.emergency.includes("Remove subfloor") && !unnamedKind.emergency.includes("sleeper"),
  `a kind nobody stated is just "subfloor" — silence, not a guess at sleepers (got:\n${unnamedKind.emergency})`,
);

const noArea = subSheets([{ type: "SLEEPER_SYSTEM", disposition: "REMOVE_AND_REPLACE", removalSF: null }]);
check(
  noArea.emergency.includes("Remove sleeper subfloor – floor area") && noArea.repair.includes("Install new sleeper subfloor – floor area"),
  `both halves survive an area nobody stated — a missing quantity is not evidence the work is not happening (got:\n${noArea.emergency})`,
);

const dried = subSheets([{ type: "SLEEPER_SYSTEM", disposition: "DRY_IN_PLACE", removalSF: null }]);
check(
  !dried.emergency.includes("subfloor") && !dried.repair.includes("subfloor"),
  `a subfloor being dried in place is demolished on neither sheet (got:\n${dried.emergency})`,
);
check(
  !subSheets([{ type: "SLEEPER_SYSTEM", disposition: null, removalSF: null }]).emergency.includes("subfloor"),
  "and neither is one whose disposition nobody has answered yet — an unanswered question is not a demolition",
);
check(!subSheets([]).emergency.includes("subfloor"), "a room with no subfloor record gets no subfloor line at all");

/* ── Shoring: the labour that holds up whatever stays ───────────────────────────────────────────── */

/*
  "The cabinet's coming out but the countertop and sink are staying put, so that section needs
  shoring." Temporary posts in, posts out, and an hour of a carpenter's time — and it reached no
  field, so the scope showed a plain cabinet removal.

  That is the shape of miss nobody re-checks. The removal IS there; the line reads complete. It is
  only wrong in what it leaves out, and a reader has no way to see the omission from the page.
*/
const shoringSheets = (cabinetry) => {
  const built = bbOrders(bbExtraction([room("Kitchen", { cabinetry })]));
  return { emergency: bbText(built, "MITIGATION_DEMO"), repair: bbText(built, "FINISH_CARPENTRY") };
};
const cabinetOut = (overrides = {}) => ({ location: "Sink run", action: "REMOVE_AND_REPLACE", extent: "Lowers", grade: "Standard", shoringRequired: null, ...overrides });

const shored = shoringSheets([cabinetOut({ shoringRequired: true })]);
check(
  shored.emergency.includes("Shore countertop while cabinetry is out – Sink run"),
  `shoring is its own line, at the cabinet it holds up (got:\n${shored.emergency})`,
);
check(shored.emergency.includes("Remove cabinetry – Sink run"), "alongside the removal, not instead of it");
check(
  !shored.repair.includes("Shore"),
  "and only once — one line covers the posts going in and coming out, which is how it prices",
);

check(!shoringSheets([cabinetOut({ shoringRequired: false })]).emergency.includes("Shore"), "a cabinet with nothing above it gets no shoring line");
check(
  !shoringSheets([cabinetOut()]).emergency.includes("Shore"),
  "and neither does one nobody has been asked about — an open question is not a yes",
);

/* ── Insulation goes back before the board ─────────────────────────────────────────────────────── */

/*
  The auditor's first controlled run found it: Emergency took the wet cellulose out, and Repair
  boarded the wall over an empty cavity. The pair had one half. And the R-value the gap-check asks
  for — stored on the record, rendered by nothing, excused by the guard as "a spec on a line that
  already renders" — turns out to belong on exactly the half that was missing: the removal has no
  use for it, the replacement is what it specifies.
*/
const insulationSheets = (walls, ceilings = []) => {
  const built = buildWorkOrders({
    trades: ["MITIGATION_DEMO", "DRYWALL"],
    claim,
    extraction: bbExtraction([room("Basement", { walls, ceilings })]),
    contentsApproach: "TM",
    contentsTM: { entries: [] },
    bricABrac: { rooms: [] },
    dgigData: null,
  });
  return { emergency: bbText(built, "MITIGATION_DEMO"), drywall: bbText(built, "DRYWALL") };
};

const batt = insulationSheets([wall({ insulationAffected: true, insulationType: "FIBERGLASS_BATT", insulationRValue: "R20" })]);
check(batt.emergency.includes("Remove affected insulation – Fiberglass batt"), `the removal is where it always was (got:\n${batt.emergency})`);
check(batt.drywall.includes("Install new insulation – Fiberglass batt R20 – 30 LF"), `and the install is on the drywall sheet, with the type, the R-value and the same run as the board (got:\n${batt.drywall})`);
check(
  batt.drywall.indexOf("Install new insulation") < batt.drywall.indexOf("Replace drywall"),
  "listed before the drywall, because that is the order the wall is built",
);

const cellulose = insulationSheets([wall({ insulationAffected: true, insulationType: "CELLULOSE", insulationRValue: null, cutRunFt: null, cutRunFraction: "HALF" })]);
check(cellulose.drywall.includes("Install new insulation – Cellulose – half"), `no R-value is silence, not a placeholder, and a fraction carries the way the drywall line carries it (got:\n${cellulose.drywall})`);

const unknownType = insulationSheets([wall({ insulationAffected: true, insulationType: null, insulationRValue: null })]);
check(unknownType.drywall.includes("Install new insulation – 30 LF"), `a type nobody stated still gets the line — the cavity is empty either way (got:\n${unknownType.drywall})`);

for (const [label, affected] of [["not affected", false], ["never asked", null]]) {
  const none = insulationSheets([wall({ insulationAffected: affected, insulationType: "CELLULOSE" })]);
  check(!none.drywall.includes("insulation") && !none.emergency.includes("insulation"), `insulation ${label} puts no insulation line on either sheet`);
}

const twoWalls = insulationSheets([
  wall({ insulationAffected: true, insulationType: "FIBERGLASS_BATT", insulationRValue: "R20" }),
  wall({ insulationAffected: true, insulationType: "FIBERGLASS_BATT", insulationRValue: "R20", cutRunFt: 12 }),
]);
check(
  (twoWalls.drywall.match(/Install new insulation/g) ?? []).length === 2 && twoWalls.drywall.includes("– 12 LF") && twoWalls.drywall.includes("– 30 LF"),
  `one install per wall whose insulation came out, each with its own run — the removal is per wall too (got:\n${twoWalls.drywall})`,
);

// The same pair in a different plane.
const above = insulationSheets([], [ceiling({ aboveInsulationAffected: true, aboveInsulationType: "FIBERGLASS_BATT", aboveInsulationRValue: "R24" })]);
check(above.emergency.includes("Remove wet insulation above ceiling – Fiberglass batt"), `wet insulation above a ceiling comes out on the crew sheet — the scope had this line and the sheet did not (got:\n${above.emergency})`);
check(above.drywall.includes("Install new insulation above ceiling – Fiberglass batt R24 – 120 SF of ceiling"), `and goes back before the ceiling is closed, with the R-value and the ceiling's own extent (got:\n${above.drywall})`);
check(above.drywall.indexOf("Install new insulation above ceiling") < above.drywall.indexOf("Replace ceiling drywall"), "ahead of the ceiling drywall");

const aboveDry = insulationSheets([], [ceiling({ aboveInsulationAffected: false, aboveInsulationType: "FIBERGLASS_BATT" })]);
check(!aboveDry.emergency.includes("insulation") && !aboveDry.drywall.includes("insulation"), "dry insulation above a ceiling is left alone on both sheets");

/* ── Unscoped work reaches the crew sheets in the PM's words ─────────────────────────────────────── */

/*
  Emergency has one crew, so a placed item is a room line on its sheet. Repair has three, and the app
  cannot know which of them "replace two outlets" belongs to — so those ride on every repair sheet as
  a note, where the PM sees them whichever sheet is handed out, until a trade is assigned. What never
  appears anywhere: a DROPPED item, or one nobody has placed.
*/
const unscopedSheets = (unscoped) => {
  const built = buildWorkOrders({
    trades: ["MITIGATION_DEMO", "DRYWALL", "PAINTING", "FINISH_CARPENTRY"],
    claim,
    extraction: bbExtraction([room("Basement bathroom", { unscoped })]),
    contentsApproach: "TM",
    contentsTM: { entries: [] },
    bricABrac: { rooms: [] },
    dgigData: null,
  });
  return {
    emergency: bbText(built, "MITIGATION_DEMO"),
    repair: ["DRYWALL", "PAINTING", "FINISH_CARPENTRY"].map((t) => bbText(built, t)),
  };
};
const tile = (disposition) => ({ description: "remove tub-surround tile and the soaked backer board", disposition });

const emergencyItem = unscopedSheets([tile("EMERGENCY")]);
check(emergencyItem.emergency.includes("    - Remove tub-surround tile and the soaked backer board"), `an Emergency item is a room line on the Mitigation & Demo sheet, capitalised and otherwise untouched (got:\n${emergencyItem.emergency})`);
check(emergencyItem.repair.every((t) => !t.includes("tub-surround")), "and on no repair sheet");

const repairItem = unscopedSheets([tile("REPAIR")]);
check(!repairItem.emergency.includes("tub-surround"), "a Repair item is not on the emergency sheet");
check(
  repairItem.repair.every((t) => t.includes("Also on this claim, trade not yet assigned: Remove tub-surround tile and the soaked backer board (Basement bathroom).")),
  `but rides on every repair sheet as a note naming the room, until somebody assigns it (got:\n${repairItem.repair[0]})`,
);

const bothItem = unscopedSheets([tile("BOTH")]);
check(bothItem.emergency.includes("Remove tub-surround tile") && bothItem.repair.every((t) => t.includes("trade not yet assigned: Remove tub-surround tile")), "both phases is both places");

for (const [label, disposition] of [["dropped", "DROPPED"], ["undecided", null]]) {
  const none = unscopedSheets([tile(disposition)]);
  check(!none.emergency.includes("tub-surround") && none.repair.every((t) => !t.includes("tub-surround")), `a ${label} item reaches no sheet at all`);
}
check(!unscopedSheets([]).repair[0].includes("trade not yet assigned"), "and a claim with nothing unscoped carries no note about it");

/* ── Floor registers are a pair, and the PM phone is on the sheet ───────────────────────────────── */

/*
  Registers used to print as one "Detach & reset" line in both phases so the count stayed visible in
  Repair. The auditor read that as the same work billed twice, which is how an estimator reads it
  too. Now a pair on the same terms as everything else that comes off and goes back.
*/
const registerSheets = (count) => {
  const built = bbOrders(bbExtraction([room("Hall", { floorRegistersDetached: count })]));
  return { emergency: bbText(built, "MITIGATION_DEMO"), repair: bbText(built, "FINISH_CARPENTRY") };
};
const twoRegisters = registerSheets(2);
check(twoRegisters.emergency.includes("Detach floor registers – 2"), `the detach half, with the count (got:\n${twoRegisters.emergency})`);
check(twoRegisters.repair.includes("Reset floor registers – 2"), `and the reset half on the finish carpentry sheet, with the same count (got:\n${twoRegisters.repair})`);
check(!twoRegisters.emergency.includes("Reset floor") && !twoRegisters.repair.includes("Detach floor"), "each half on its own sheet only");
for (const [label, count] of [["none", 0], ["unknown", null]]) {
  const sheets = registerSheets(count);
  check(!sheets.emergency.includes("floor registers") && !sheets.repair.includes("floor registers"), `${label} registers put no line on either sheet`);
}

const phoned = buildWorkOrders({
  trades: ["MITIGATION_DEMO"],
  claim: { ...claim, pmPhone: "403 555 0100" },
  extraction: bbExtraction([room("Hall", { floorRegistersDetached: 1 })]),
  contentsApproach: "TM", contentsTM: { entries: [] }, bricABrac: { rooms: [] }, dgigData: null,
});
check(bbText(phoned, "MITIGATION_DEMO").includes("PM phone: 403 555 0100"), `the PM phone reaches every sheet's header (got:\n${bbText(phoned, "MITIGATION_DEMO").split("\n").slice(0, 8).join("\n")})`);
check(bbText(bbOrders(bbExtraction([room("Hall", { floorRegistersDetached: 1 })])), "MITIGATION_DEMO").includes("PM phone: —"), "and a claim with none shows the blank, so a crew can see it is missing rather than assume there was never a number");

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
