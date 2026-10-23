/**
 * The exterior: elevations, the footprint they make, and the roof over it — lib/exterior.ts and
 * lib/roof.ts.
 *
 *   npm run test:exterior
 *
 * Every expected figure here was worked by hand first, and the working is in the comment beside it,
 * so a failure says which of the two is wrong. The cases are the ones the maths has to get right:
 *
 *   * the owner's own side (2026-10-12): 34'3" by Scan (33'6" by his tape), eave 12'7", gable peak
 *     18'5", a 2'1" x 4'10" window, stucco above the parging — and the 4/12 it gives
 *   * a side on sloping grade with a stone band, and a window across the band line
 *   * a footprint whose taped sides do not quite meet
 *   * a plain gable, a hip and a gable-hip rectangle, and the owner's 4/12 house
 *   * an L with hips (where a hip and a valley that a per-section sum would count are not there)
 *     and an L with cross gables
 *   * the owner's own roof, 10-12: a porch that is the slope carried on, a cross gable over the
 *     front door, and every line labelled with its length; and a roof set below the eave that
 *     stops at the wall (a lean-to, or a wing such as the owner's garage), with step and headwall flashing
 *   * a T, a U and the owner's twelve corners (10-13): a main roof and its wings, the deck the roof
 *     carries over, the bay that has to sit lower on a gable end, and the garage hipped at the
 *     street and tied in lower under a gable on the house
 *   * the house in 3D (10-13, lib/exterior3d.ts): every wall's top on the roof's underside, the roof's
 *     top over its whole plan with no crack between slopes, the fascia all round, the garage's roof
 *     under the house's gable with siding between, posts, the deck, and the heights on a sloping lot
 *   * roof pieces on top of the drawing (10-15, lib/roofPieces.ts): gable and shed dormers, round and
 *     many-sided turrets, a barrel, a flat roof, each worked in closed form; and a gambrel and a
 *     mansard as a second pitch above a break (lib/roof.ts)
 *   * the roof's shapes off the side photos (10-15, lib/roofPhotoShapes.ts): a dormer set back on its
 *     slope seen through a phone and worked back to its width, projection and pitch; turrets; what
 *     stands over a side; the ridge turned to the photos' gables; each as a tick under anything typed
 *   * two storeys (10-14, 10-15): the house's roof over the upper floor and lower roofs round it -
 *     lean-tos hipped round its outside corners and in a valley at an inside one, all the way round
 *     with two drip lines - the upper floor kept flush when a main length is typed, tall sides split
 *     at the floor line, and a cantilever's floor soffit
 *   * the walk round the house (10-21, lib/photoRouteWalk.ts): its steps in order, what can be passed by and taken back,
 *     L-shaped and notched laps and the shape each makes, the one measurement it needs, each photo's place on it, a semi's
 *     joined corner, and the owner's house walked as it asks (made-up photos) through the route's own solve
 *   * the drawings and the report as a customer document (10-16): the owner's side yard stepping down
 *     with its parging, the ground off a parging's bottom at its corners' own x, the ± on a length worked
 *     out from photos, a photos-only house said as one, every wall's name beside its own wall, and each
 *     cladding's marks (lib/claddingTexture.ts); the house from each side, named by the compass when known (lib/exteriorViews.ts)
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "exterior-"));
  const entry = join(outDir, "entry.ts");
  const outfile = join(outDir, "entry.mjs");
  writeFileSync(
    entry,
    [
      `export * from "${lib("exterior.ts")}";`,
      `export * from "${lib("roof.ts")}";`,
      `export * from "${lib("roofPieces.ts")}";`,
      `export * from "${lib("roofLabels.ts")}";`,
      `export * from "${lib("claddingTexture.ts")}";`,
      `export * from "${lib("exteriorViews.ts")}";`,
      `export { exteriorReport } from "${lib("exteriorReport.ts")}";`,
      `export { feetFromParts, formatFeetInches } from "${lib("sketch.ts")}";`,
      `export { availableTrades, buildWorkOrders } from "${lib("workOrders.ts")}";`,
      `export { emptyClaimInfo } from "${lib("claimInfo.ts")}";`,
      `export { documentGenerationUserMessage, DOCUMENT_GENERATION_SYSTEM_PROMPT, SCOPE_ONLY_SYSTEM_PROMPT } from "${lib("documentGenerationPrompt.ts")}";`,
      `export * from "${lib("exteriorImport.ts")}";`,
      `export * from "${lib("exteriorPhoto.ts")}";`,
      `export * from "${lib("exteriorTrace.ts")}";`,
      `export * from "${lib("roofPhotoRead.ts")}";`,
      `export * from "${lib("roofPhotoShapes.ts")}";`,
      `export * from "${lib("roofCheck.ts")}";`,
      `export * from "${lib("exteriorCheck.ts")}";`,
      `export { cornerPlace, routeCoverage, viewsFromMeasure } from "${lib("photoRouteCoverage.ts")}";`,
      `export { checkEstimate, columnBearing, defaultShared, facingOf, numberCorners, partyCorners, routeSteps, shotNumbers, solveRoute, tapesDisagree, WALK_HOLD } from "${lib("photoRoute.ts")}";`,
      `export { alignLap, facingWords, isWalkShape, lapCloses, walkPhotoWords, lapOutline, lapProblem, lapTurns, newWalk, ringTurns, measureWords, ringItems, walkAddCorner, walkInsertCorner, walkRemoveCorner, walkSetTurn, walkAddPhoto, walkFinish, walkMissing, walkRemoveLastCorner, walkRemovePhoto, walkReopen, withRingStart, walkAddMeasure, walkBack, walkClose, walkHasMeasure, walkHomeType, walkMeasured, walkMeasures, walkPhotos, walkRemoveMeasure, walkShot, walkSkip, walkStep, walkSummary, walkTake, walkTurn, walkUnplaced, withoutPhotos, withWalk, walkFromTurns, parseTurns, roleShot } from "${lib("photoRouteWalk.ts")}";`,
      `export { cornerEdges } from "${lib("photoRouteFind.ts")}";`,
      `export { holdOutTapes, lineFeet, selfCheck, worstPct } from "${lib("photoRouteCheck.ts")}";`,
      `export { fitMapOutline, frontBearing, mapWords, offRing } from "${lib("photoRouteMap.ts")}";`,
      `export { toLevel } from "${lib("photoRouteLens.ts")}";`,
      `export { exteriorFromRoute, measuredFrom } from "${lib("photoRouteExterior.ts")}";`,
      `export { routeSanity } from "${lib("photoRouteSanity.ts")}";`,
      `export { focalOverWidth } from "${lib("photoRouteExif.ts")}";`,
      `export { longSide } from "${lib("photoRouteLens.ts")}";`,
      `export { applyScanFinish, readScanFinish, wallsFrom } from "${lib("exteriorFinish.ts")}";`,
      `export * from "${lib("exterior3d.ts")}";`,
      `export * from "${lib("exteriorPlan.ts")}";`,
      `export * from "${lib("exteriorScale.ts")}";`,
      `export * from "${lib("roofReport.ts")}";`,
      `export { adoptScan, exteriorScanDecision, sketchFromScan } from "${lib("scanInbox.ts")}";`,
      `export { availableRenders, defaultSketchAttachments, pruneAttachments, withExteriorDefaults, toggleAttachment } from "${lib("sketchAttachments.ts")}";`,
    ].join("\n"),
  );
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, alias: { "@": root }, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const passed = [];
const failures = [];
function test(name, run) {
  try {
    run();
    passed.push(name);
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function near(actual, expected, what, tol = 1e-3) {
  assert(Math.abs(actual - expected) <= tol, `${what}\n      expected ~${expected}\n      actual    ${actual}`);
}

const x = await load();
/** Claude's answer recovered from the route's proposals: what test:exterior:trace records (2026-10-15). */
const rec = await import(pathToFileURL(join(here, "traceRecord.mjs")).href);
const ft = (feet, inches = 0) => feet + inches / 12;

/** A side with everything set, so each case states only what it is about. */
function side(over = {}) {
  return {
    id: over.id ?? "s",
    name: over.name ?? "Side",
    lengthFeet: 30,
    turn: "outside",
    base: "parging",
    baseLeftFeet: ft(0, 8),
    baseRightFeet: ft(0, 8),
    eaveLeftFeet: 10,
    eaveRightFeet: 10,
    gable: null,
    bands: [{ id: "b", kind: "stucco", top: null }],
    openings: [],
    ...over,
  };
}

/** The owner's side as Scan read it on 2026-10-12. */
function ownersSide(lengthFeet = ft(34, 3)) {
  return side({
    id: "left",
    name: "Left",
    lengthFeet,
    eaveLeftFeet: ft(12, 7),
    eaveRightFeet: ft(12, 7),
    gable: { peakFeet: ft(18, 5), atFeet: lengthFeet / 2 },
    openings: [{ id: "w", kind: "window", widthFeet: ft(2, 1), heightFeet: ft(4, 10), sillFeet: 3, fromLeftFeet: 10 }],
  });
}

function exterior(sides, roof = {}) {
  return { sides, roof: { ...x.defaultRoof(), ...roof } };
}

/** A rectangle W (front, along the ridge unless told) x D with the given side names. */
function rect(width, depth, roof = {}, eave = 10) {
  return exterior(
    [
      side({ id: "front", name: "Front", lengthFeet: width, eaveLeftFeet: eave, eaveRightFeet: eave }),
      side({ id: "right", name: "Right", lengthFeet: depth, eaveLeftFeet: eave, eaveRightFeet: eave }),
      side({ id: "rear", name: "Rear", lengthFeet: width, eaveLeftFeet: eave, eaveRightFeet: eave }),
      side({ id: "left", name: "Left", lengthFeet: depth, eaveLeftFeet: eave, eaveRightFeet: eave }),
    ],
    roof,
  );
}

/** The L of [0,20]x[0,10] and [0,10]x[0,20]: a notch 10 x 10 out of the rear right. */
function ell(roof) {
  const ids = ["front", "right", "rightRear", "insideRight", "rear", "left"];
  const lengths = [20, 10, 10, 10, 10, 20];
  return exterior(
    ids.map((id, i) => side({ id, name: id, lengthFeet: lengths[i], turn: id === "rightRear" ? "inside" : "outside", base: "grade" })),
    { eaveOverhangFeet: 0, rakeOverhangFeet: 0, pitch: 12, ...roof },
  );
}

console.log("\nelevations");

test("the owner's side: stucco wall, gable and window, worked by hand", () => {
  const q = x.sideQuantities(ownersSide());
  // Wall: 34.25 x (12'7" - 8") = 34.25 x 11.916667 = 408.1458
  near(q.wallSquareFeet, 34.25 * (ft(12, 7) - ft(0, 8)), "wall below the eave");
  // Gable: 34.25 x (18'5" - 12'7") / 2 = 34.25 x 5.833333 / 2 = 99.8958
  near(q.gableSquareFeet, (34.25 * ft(5, 10)) / 2, "gable triangle");
  near(q.grossSquareFeet, 508.0417, "gross");
  // Window: 2'1" x 4'10" = 2.083333 x 4.833333 = 10.0694
  near(q.openingSquareFeet, 10.0694, "window");
  near(q.netSquareFeet, 497.9722, "net stucco");
  assert(q.bands.length === 1 && q.bands[0].kind === "stucco", "one band of stucco");
  near(q.bands[0].netSquareFeet, 497.9722, "the band carries it all");
  near(q.openingTrimFeet, 2 * (ft(2, 1) + ft(4, 10)), "trim all round a window");
  near(q.corners.leftFeet, ft(11, 11), "cladding height at the corner: 12'7\" less 8\" of parging");
});

test("the owner's side gives his 4/12: (peak - eave) over half the span", () => {
  // 5'10" over 17.125' = 0.340633 -> 4.0876 in 12
  near(x.sideQuantities(ownersSide()).pitchFromGable, (ft(5, 10) / 17.125) * 12, "pitch from the gable");
  assert(Math.abs(x.sideQuantities(ownersSide()).pitchFromGable - 4) < 0.1, "about 4/12");
});

test("correcting the length to his tape (33'6\") moves every figure with it", () => {
  const q = x.sideQuantities(ownersSide(ft(33, 6)));
  near(q.wallSquareFeet, 33.5 * ft(11, 11), "wall");
  near(q.gableSquareFeet, (33.5 * ft(5, 10)) / 2, "gable");
  near(q.pitchFromGable, (ft(5, 10) / 16.75) * 12, "pitch over the shorter span");
});

test("sloping grade: heights from the grade under each point, a band line level", () => {
  // Grade falls 1' over 40' (eave 10' at the left, 11' at the right: the eave is level).
  // Parging top is level too, so 8" at the left is 1'8" at the right.
  const s = side({
    lengthFeet: 40,
    eaveLeftFeet: 10,
    eaveRightFeet: 11,
    baseLeftFeet: ft(0, 8),
    baseRightFeet: ft(1, 8),
    bands: [
      { id: "stone", kind: "stone", top: 3 },
      { id: "stucco", kind: "stucco", top: null },
    ],
    // Sill 3' above the grade under its middle (x = 20, grade -0.5): from z 2.5 to 6.5.
    openings: [{ id: "w", kind: "window", widthFeet: 3, heightFeet: 4, sillFeet: 3, fromLeftFeet: 18.5 }],
  });
  const q = x.sideQuantities(s);
  // Wall: 40 x (10 - 0.666667) = 373.333 (both ends 9'4" of cladding).
  near(q.grossSquareFeet, 40 * (10 - ft(0, 8)), "gross");
  near(q.fallFeet, 1, "grade fall");
  const [stone, stucco] = q.bands;
  // Stone: from the parging top (z 0.666667) to z 3: 40 x 2.333333 = 93.333
  near(stone.grossSquareFeet, 40 * (3 - ft(0, 8)), "stone gross");
  // The window crosses the band line at z 3: 3 x 0.5 below, 3 x 3.5 above.
  near(stone.openingSquareFeet, 1.5, "window in the stone");
  near(stucco.openingSquareFeet, 10.5, "window in the stucco");
  near(stucco.netSquareFeet, 373.3333 - 93.3333 - 10.5, "stucco net");
});

test("base at grade: the cladding follows the slope down", () => {
  const q = x.sideQuantities(side({ lengthFeet: 40, eaveLeftFeet: 10, eaveRightFeet: 11, base: "grade" }));
  // A trapezoid: 10' at the left, 11' at the right.
  near(q.grossSquareFeet, 40 * 10.5, "trapezoid");
});

test("a band to the eave clads the gable in the next one", () => {
  const s = side({
    lengthFeet: 30,
    base: "grade",
    gable: { peakFeet: 15, atFeet: 15 },
    bands: [
      { id: "st", kind: "stucco", top: "eave" },
      { id: "v", kind: "vinyl", top: null },
    ],
  });
  const q = x.sideQuantities(s);
  near(q.bands[0].grossSquareFeet, 300, "stucco walls 30 x 10");
  near(q.bands[1].grossSquareFeet, 75, "vinyl gable 30 x 5 / 2");
});

test("no eave yet: the side is kept but has no area", () => {
  const q = x.sideQuantities(side({ eaveLeftFeet: null, eaveRightFeet: null }));
  assert(!q.complete && q.grossSquareFeet === 0, "nothing until an eave is measured");
});

test("a door has trim on three sides, and a garage door below the parging deducts only cladding", () => {
  const s = side({
    lengthFeet: 30,
    openings: [{ id: "g", kind: "garage", widthFeet: 16, heightFeet: 7, sillFeet: 0, fromLeftFeet: 2 }],
  });
  const q = x.sideQuantities(s);
  // Cladding starts 8" up, so 16 x (7 - 0.666667) of it is door.
  near(q.openingSquareFeet, 16 * (7 - ft(0, 8)), "only the part in the cladding");
  near(q.openingTrimFeet, 2 * 7 + 16, "no trim along the bottom");
});

console.log("\nfootprint");

test("a rectangle whose taped sides disagree closes with opposite sides equal", () => {
  // Front 34'3", rear 33'6": 9" apart, shared by length: 34.25 - 0.75 x 34.25/67.75 = 33.870849 each.
  const e = rect(ft(34, 3), 40);
  e.sides[2].lengthFeet = 33.5;
  const f = x.exteriorFootprint(e);
  assert(f.closes, f.reason ?? "should close");
  near(f.misclosureFeet, 0.75, "the miss");
  near(f.lengthsFeet[0], 33.870849, "front");
  near(f.lengthsFeet[2], 33.870849, "rear");
  near(f.areaSquareFeet, 33.870849 * 40, "area");
});

test("an L closes, and the wrong corner count is refused with a reason", () => {
  const f = x.exteriorFootprint(ell({}));
  assert(f.closes, f.reason ?? "should close");
  near(f.areaSquareFeet, 300, "L area");
  const bad = ell({});
  bad.sides[2].turn = "outside";
  const g = x.exteriorFootprint(bad);
  assert(!g.closes && /corners/.test(g.reason), "six outside corners do not go round");
  assert(!x.exteriorFootprint(exterior([ownersSide()])).closes, "one side is not a footprint");
});

console.log("\nroofs");

function roofOf(e) {
  const q = x.exteriorQuantities(e);
  assert(q.roof, "a roof was built");
  return q;
}

test("plain gable, 40 x 30, 6/12, 16\" eaves and 12\" rakes", () => {
  const q = roofOf(rect(40, 30, { pitch: 6 }));
  const r = q.roofing;
  // Outline 42 x 32.666667 = 1372.0 plan; x 1.118034 = 1533.943
  near(q.roof.planSquareFeet, 1372, "plan");
  near(r.pitchFactor, 1.118034, "6/12 factor", 1e-6);
  near(r.areaSquareFeet, 1533.9426, "area");
  near(r.squares, 15.339426, "squares");
  // Real squares: the waste is the estimator's.
  near(r.eaveFeet, 84, "eaves 2 x 42");
  // Rakes: two ends, each 32.666667 plan across at 1.118034 = 36.522
  near(r.rakeFeet, 2 * 32.666667 * 1.118034, "rakes");
  near(r.ridgeFeet, 42, "ridge the whole outline");
  near(r.hipFeet + r.valleyFeet, 0, "no hips or valleys");
  near(r.dripEdgeFeet, 84 + 73.04489, "drip edge");
  // Soffit by the foot at its overhang: 84 LF of eave at 16", 73.04 LF of rake at 12".
  near(r.soffit.eaveFeet, 84, "eave soffit LF");
  near(r.soffit.eaveSquareFeet, 112, "eave soffit");
  near(r.soffit.rakeSquareFeet, 2 * 32.666667 * 1.118034, "rake soffit");
  // Two eaves, each its own run with an end cap at each end; two downspouts each (42 / 35).
  assert(r.gutter.runs.length === 2 && r.gutter.endCaps === 4 && r.gutter.outsideMitres === 0, "two straight runs");
  assert(r.gutter.downspouts === 4 && r.gutter.downspoutsCounted, "two 42' runs, two downspouts each");
  near(r.gutter.downspoutFeet, 4 * 10 * 1.15, "each the 10' eave + 15%");
  assert(r.gutter.drops === 4 && r.gutter.elbows === 12, "a drop each, three elbows each");
  assert(r.steep === null, "6/12 is not steep");
});

test("hip, 40 x 30, 6/12, 16\" all round: the research's 1,558 SF", () => {
  const q = roofOf(rect(40, 30, { pitch: 6, ends: { left: "hip", right: "hip" } }));
  const r = q.roofing;
  // Outline 42.666667 x 32.666667 = 1393.778 plan; x 1.118034 = 1558.291
  near(r.areaSquareFeet, 1558.2909, "area");
  // Ridge 42.666667 - 32.666667; four hips of 16.333333 run x sqrt(2.25)
  near(r.ridgeFeet, 10, "ridge");
  near(r.hipFeet, 4 * 16.333333 * 1.5, "hips");
  near(r.eaveFeet, 2 * (42.666667 + 32.666667), "eaves all round");
  near(r.rakeFeet, 0, "no rakes");
  near(r.soffit.rakeFeet, 0, "no rake soffit");
  near(r.soffit.eaveSquareFeet, 150.666667 * (16 / 12), "eave soffit, by the foot at 16\"");
  // One run all the way round: four outside mitres and no end caps.
  assert(r.gutter.runs.length === 1 && r.gutter.runs[0].closed, "one closed run");
  assert(r.gutter.outsideMitres === 4 && r.gutter.endCaps === 0, `mitres ${r.gutter.outsideMitres}, caps ${r.gutter.endCaps}`);
  // Four slopes: two trapezoids (42.667 + 10) / 2 x 16.333, two triangles 32.667 x 16.333 / 2.
  const plans = q.roof.facets.map((f) => f.planSquareFeet).sort((a, b) => a - b);
  near(plans[0], 266.7778, "end slope", 1e-3);
  near(plans[3], 430.1111, "side slope", 1e-3);
});

test("gable at one end and hip at the other, 40 x 30, no overhang, 6/12", () => {
  const r = roofOf(rect(40, 30, { pitch: 6, eaveOverhangFeet: 0, rakeOverhangFeet: 0, ends: { left: "hip" } })).roofing;
  near(r.areaSquareFeet, 1200 * 1.118034, "area");
  near(r.ridgeFeet, 40 - 15, "ridge stops one run short of the hip end");
  near(r.hipFeet, 2 * 15 * 1.5, "two hips");
  near(r.rakeFeet, 30 * 1.118034, "one gable's rakes");
  near(r.eaveFeet, 40 + 40 + 30, "both sides and the hip end");
});

test("the ridge runs the way it is told", () => {
  const r = roofOf(rect(40, 30, { pitch: 6, eaveOverhangFeet: 0, rakeOverhangFeet: 0, ridgeAlong: "left" })).roofing;
  near(r.ridgeFeet, 30, "ridge front to back");
  near(r.eaveFeet, 60, "eaves down the sides");
  near(r.rakeFeet, 2 * 40 * 1.118034, "gables front and rear");
});

test("the owner's 4/12 house: 34'3\" gable ends, 40' along the ridge (assumed until taped)", () => {
  const e = rect(40, ft(34, 3), { pitch: 4 }, ft(12, 7));
  const q = roofOf(e);
  const r = q.roofing;
  // f = sqrt(1 + 1/9) = 1.054093; outline 42 x 36.916667 = 1550.5; area 1634.38
  near(r.pitchFactor, 1.0540926, "4/12 factor", 1e-6);
  near(r.areaSquareFeet, 1550.5 * 1.0540926, "area");
  near(r.squares, (1550.5 * 1.0540926) / 100, "squares, real");
  near(r.rakeFeet, 2 * 36.916667 * 1.0540926, "rakes");
  near(r.ridgeFeet, 42, "ridge");
  // The roof's own gable on the 34'3" ends: 4/12 over 17.125' = 5'8.5" above the 12'7" eave.
  const left = q.sides.find((s) => s.sideId === "left");
  assert(left.gableSource === "roof", "the gable comes from the roof when none was measured");
  near(left.gableSquareFeet, (34.25 * (17.125 * 4) / 12) / 2, "gable from the roof");
  assert(!q.rises.front, "no gable over an eave side");
});

test("a pitch nobody typed comes from the measured gable", () => {
  const e = rect(40, ft(34, 3), {}, ft(12, 7));
  e.sides[3] = { ...ownersSide(), id: "left" };
  const q = x.exteriorQuantities(e);
  assert(q.pitch.source === "sides", "taken from the sides");
  near(q.pitch.value, 4.087591, "4.09/12");
  assert(q.roof && Math.abs(q.roof.pitch - 4.087591) < 1e-6, "the roof is built at it");
  // The measured gable wins over the roof's on its own side.
  assert(q.sides[3].gableSource === "measured", "measured gable kept");
  // Typing 4 overrides it.
  e.roof.pitch = 4;
  assert(x.exteriorQuantities(e).pitch.source === "typed", "a typed pitch wins");
});

test("L with hips: five hips, one valley, the ridges meet; no phantom lines", () => {
  // [0,20]x[0,10] + [0,10]x[0,20], 12/12, no overhang. Hips run 5 each way: 5 x sqrt(3) each.
  const q = roofOf(ell({ ends: { left: "hip", right: "hip", rear: "hip" } }));
  const r = q.roofing;
  assert(q.roof.shape === "L", "built as an L");
  near(r.areaSquareFeet, 300 * Math.SQRT2, "area");
  near(r.ridgeFeet, 20, "ridges (5,5)-(15,5) and (5,5)-(5,15)");
  near(r.hipFeet, 5 * 5 * Math.sqrt(3), "five hips");
  near(r.valleyFeet, 5 * Math.sqrt(3), "one valley from the inside corner");
  near(r.eaveFeet, 80, "eaves all round");
  near(r.rakeFeet, 0, "no rakes");
  assert(q.roof.lines.filter((l) => l.kind === "hip").length === 5, "five hip lines, not six");
});

test("L with cross gables: two valleys, three gable ends", () => {
  const q = roofOf(ell({}));
  const r = q.roofing;
  near(r.ridgeFeet, 20 + 15, "main ridge end to end; the wing's runs in to it");
  near(r.valleyFeet, 2 * 5 * Math.sqrt(3), "two valleys");
  near(r.hipFeet, 0, "no hips");
  near(r.rakeFeet, 3 * 10 * Math.SQRT2, "three gable ends");
  near(r.eaveFeet, 50, "eaves");
  // The left wall is the main roof's gable end for 10' and the wing's eave for 10'.
  const left = q.sides.find((s) => s.sideId === "left");
  near(left.gableSquareFeet, (10 * 5) / 2, "a gable over half the wall");
  near(left.wallSquareFeet, 20 * 10, "the rest is wall");
});

test("an L the other way round builds the same roof", () => {
  // The notch at the rear LEFT: walk the mirror image.
  const lengths = [20, 20, 10, 10, 10, 10];
  const turns = ["outside", "outside", "outside", "inside", "outside", "outside"];
  const e = exterior(
    lengths.map((len, i) => side({ id: `s${i}`, name: `s${i}`, lengthFeet: len, turn: turns[i], base: "grade" })),
    { eaveOverhangFeet: 0, rakeOverhangFeet: 0, pitch: 12 },
  );
  const r = roofOf(e).roofing;
  near(r.ridgeFeet, 35, "ridges");
  near(r.valleyFeet, 2 * 5 * Math.sqrt(3), "valleys");
  near(r.rakeFeet, 3 * 10 * Math.SQRT2, "rakes");
});

test("steep pitches are flagged", () => {
  assert(roofOf(rect(30, 20, { pitch: 8 })).roofing.steep === "7/12 to 9/12", "8/12");
  assert(roofOf(rect(30, 20, { pitch: 12 })).roofing.steep === "10/12 to 12/12", "12/12");
});

console.log("\nporches, cross gables and lower roofs (10-12)");

/** The lines of one kind, by kind. */
const linesOf = (plan, kind) => plan.lines.filter((l) => l.kind === kind);
const sum = (lines) => lines.reduce((s, l) => s + l.feet, 0);

test("a porch is the front slope carried on past the wall: one slope, its eave lower, its end a rake", () => {
  // 40 x 30 at 6/12, 1' eaves and rakes. The porch runs from the left corner 20' along the front, 6' out from the wall.
  const q = roofOf(rect(40, 30, { pitch: 6, eaveOverhangFeet: 1, rakeOverhangFeet: 1, additions: [{ id: "p", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 20, depthFeet: 6 }] }));
  const r = q.roofing;
  const f = 1.118034;
  // Outline 42 x 32 = 1344, and the porch from the eave (1' out) to 6' out, from the left rake (-1) to 20: 21 x 5 = 105.
  near(q.roof.planSquareFeet, 1449, "plan");
  near(r.areaSquareFeet, 1449 * f, "area", 1e-2);
  near(r.ridgeFeet, 42, "the ridge is the house's");
  // Eaves: the rear 42, the porch's 21 at 6' out, the house's own 21 beside it.
  near(r.eaveFeet, 42 + 21 + 21, "eaves");
  // Rakes, plan: the left end from the porch's eave to the ridge 21 (one straight rake) and 16 behind; the right end 16 + 16; the porch's own end 5.
  near(r.rakeFeet, (21 + 16 + 16 + 16 + 5) * f, "rakes", 1e-4);
  const left = linesOf(q.roof, "rake").filter((l) => Math.abs(l.a.x + 1) < 1e-9 && Math.abs(l.b.x + 1) < 1e-9);
  assert(left.length === 2 && left.some((l) => Math.abs(l.feet - 21 * f) < 1e-4), "the left rake carries straight on down over the porch");
  near(r.valleyFeet + r.hipFeet, 0, "no valleys: it is not a roof of its own");
  // One front slope, porch and all: 42 x 16 + 105.
  const front = q.roof.facets.filter((s) => s.sideId === "front");
  assert(front.length === 1, `one front slope, not ${front.length}`);
  near(front[0].planSquareFeet, 672 + 105, "the front slope takes in the porch");
  assert(r.gutter.runs.length === 3 && r.gutter.endCaps === 6, `the porch's eave is a run of its own: ${r.gutter.runs.length}`);
  assert(q.roof.note === null, q.roof.note ?? "");
  assert(!q.rises.front, "a porch puts no gable on the wall");
});

test("a cross gable rises out of the slope at its drip line: a ridge, two valleys, two rakes, and no more roof", () => {
  // 40 x 30 at 12/12, no overhangs; a gable 10' wide over the front from 10' to 20'.
  const q = roofOf(rect(40, 30, { pitch: 12, eaveOverhangFeet: 0, rakeOverhangFeet: 0, additions: [{ id: "g", kind: "gable", sideId: "front", fromFeet: 10, toFeet: 20 }] }));
  const r = q.roofing;
  // Its ridge stands 5' up at the eave and runs 5' back, level, until the slope is as high.
  near(r.ridgeFeet, 40 + 5, "the house's ridge and the gable's");
  // Each valley from an eave corner up to the gable's ridge: 5' of run at sqrt(3) a foot of run.
  near(r.valleyFeet, 2 * 5 * Math.sqrt(3), "two valleys");
  assert(linesOf(q.roof, "valley").length === 2, "two valley lines");
  // Rakes: the gable's two of 5' run at sqrt(2), and the house's ends 2 x 30 at sqrt(2).
  near(r.rakeFeet, (10 + 60) * Math.SQRT2, "rakes");
  near(r.eaveFeet, 10 + 20 + 40, "the front's eave less the gable's 10'");
  // Same pitch over the same plan: the area doesn't change.
  near(r.areaSquareFeet, 1200 * Math.SQRT2, "area");
  const own = q.roof.facets.filter((f) => f.key.startsWith("g-"));
  assert(own.length === 2 && own.every((f) => Math.abs(f.planSquareFeet - 12.5) < 1e-6), "two triangles of 12.5 SF plan");
  assert(r.gutter.runs.length === 3, "the gable breaks the front eave in two");
  assert(!q.rises.front, "it changes no wall's gable");
});

test("over a porch the cross gable stands at the porch's eave, and its valleys run up the porch roof", () => {
  // As above with a porch the whole front, 6' out: the gable's eaves are the porch's, 6' lower in run.
  const q = roofOf(
    rect(40, 30, {
      pitch: 12,
      eaveOverhangFeet: 0,
      rakeOverhangFeet: 0,
      additions: [
        { id: "g", kind: "gable", sideId: "front", fromFeet: 10, toFeet: 20 },
        { id: "p", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 40, depthFeet: 6 },
      ],
    }),
  );
  const r = q.roofing;
  near(q.roof.planSquareFeet, 40 * 36, "plan, porch and all");
  near(r.ridgeFeet, 45, "ridges");
  near(r.valleyFeet, 2 * 5 * Math.sqrt(3), "valleys");
  const ridge = linesOf(q.roof, "ridge").find((l) => Math.abs(l.a.x - 15) < 1e-9);
  assert(ridge && Math.abs(Math.min(ridge.a.y, ridge.b.y) + 6) < 1e-9 && Math.abs(Math.max(ridge.a.y, ridge.b.y) + 1) < 1e-9, "the gable's ridge from the porch's eave 5' back");
  // The house's ends now run from the porch's eave: (21 + 15) x 2 at sqrt(2), and the gable's 10.
  near(r.rakeFeet, (72 + 10) * Math.SQRT2, "rakes");
  near(r.eaveFeet, 30 + 40, "eaves");
});

test("a wing set below the house's eave stops at the wall: step flashing, no valleys", () => {
  // The L of [0,20]x[0,10] and [0,10]x[0,20] at 12/12, no overhangs; the wing out to the rear sits lower.
  const q = roofOf(ell({ lowerWings: ["rear"] }));
  const r = q.roofing;
  assert(q.roof.shape === "L" && q.roof.wingEnds.join() === "rear,right", `either arm can be the lower one: ${q.roof.wingEnds}`);
  near(r.valleyFeet, 0, "no valleys");
  near(r.ridgeFeet, 20 + 10, "the house's ridge, and the wing's from the wall to its gable");
  // Where it meets the wall: its two slopes, each 5' of run up to the ridge at sqrt(2).
  near(r.stepFeet, 2 * 5 * Math.SQRT2, "step flashing");
  near(r.headwallFeet, 0, "no level top against the wall");
  // The house's eave over the wing is still an eave: 20 front, 20 behind, and the wing's two sides 10 each.
  near(r.eaveFeet, 20 + 20 + 10 + 10, "eaves");
  near(r.rakeFeet, (20 + 10) * Math.SQRT2, "the house's two gable ends and the wing's");
  near(r.areaSquareFeet, 300 * Math.SQRT2, "area");
  // Two roofs, two drip lines: the house's front and back eaves, the wing's two sides.
  assert(r.gutter.runs.length === 4 && r.gutter.endCaps === 8, `${r.gutter.runs.length} runs`);
  assert(q.roof.edges.filter((e) => e.kind === "step").every((e) => e.layer === 1 && e.sideId === null), "flashing on the wing, at a wall that is no side of the walk");
  const rear = q.sides.find((s) => s.sideId === "rear");
  near(rear.gableSquareFeet, (10 * 5) / 2, "the wing's gable end, from the wing's own eave");
  const left = q.sides.find((s) => s.sideId === "left");
  near(left.gableSquareFeet, (10 * 5) / 2, "the left wall: the house's gable over half, the wing's eave over the rest");
  // Named by its far end, the wider arm can be the lower one too: the same roof turned.
  const turned = roofOf(ell({ lowerWings: ["right"] })).roofing;
  near(turned.stepFeet, 10 * Math.SQRT2, "turned: step flashing");
  near(turned.ridgeFeet, 30, "turned: ridges");
});

test("with overhangs the strip under the house's eave is roofed twice, and the flashing stops at the wall's end", () => {
  // The same L with 1' eaves and rakes. The house: [-1,21]x[-1,11] = 264. The wing from the wall: [-1,11]x[10,21] = 132.
  const q = roofOf(ell({ lowerWings: ["rear"], eaveOverhangFeet: 1, rakeOverhangFeet: 1 }));
  const r = q.roofing;
  near(q.roof.planSquareFeet, 264 + 132, "the 12 SF strip under the overhang counted on both roofs");
  // Along the wall (x 0 to 20): the left slope from 0 to the ridge at 5, the right from 5 to its eave at 11.
  near(r.stepFeet, (5 + 6) * Math.SQRT2, "step flashing");
  // The 1' of the wing's left eave past the house's corner meets no wall: a rake.
  near(r.rakeFeet, (24 + 12 + 1) * Math.SQRT2, "rakes");
  near(r.eaveFeet, 22 + 22 + 11 + 11, "eaves");
});

test("a lean-to porch on a gable end: a lower roof of its own, headwall flashing at the wall", () => {
  // 40 x 30 at 6/12, no overhangs; 8' out from the left (gable) wall, from 5' to 25' along it.
  const e = rect(40, 30, { pitch: 6, eaveOverhangFeet: 0, rakeOverhangFeet: 0, additions: [{ id: "l", kind: "porch", sideId: "left", fromFeet: 5, toFeet: 25, depthFeet: 8, lower: true }] });
  const q = roofOf(e);
  const r = q.roofing;
  const f = 1.118034;
  near(r.headwallFeet, 20, "headwall along the wall");
  near(r.stepFeet, 0, "no step flashing");
  near(q.roof.planSquareFeet, 1200 + 160, "plan");
  near(r.eaveFeet, 80 + 20, "eaves");
  near(r.rakeFeet, (60 + 16) * f, "the house's gable ends and the lean-to's two ends", 1e-4);
  const lean = q.roof.facets.filter((s) => s.layer > 0);
  assert(lean.length === 1 && lean[0].sideId === "left", "one slope, draining to the left");
  assert(r.gutter.runs.length === 3, "its eave is a run of its own");
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const lines = x.exteriorScopeLines(e).roofing;
  assert(lines.some((l) => l.startsWith("Headwall flashing – 20.0 LF")), lines.join("\n"));
  // Flashing is not eavestrough, soffit or fascia: choosing every eave and rake is choosing all.
  e.roof.edges = q.roof.edges.filter((l) => l.kind === "eave" || l.kind === "rake").map((l) => l.key);
  assert(x.exteriorQuantities(e).roofing.allEdges, "all chosen without the flashing");
});

test("what can't be put where it is asked says so, and is left out", () => {
  const notes = (additions) => roofOf(rect(40, 30, { pitch: 6, eaveOverhangFeet: 1, rakeOverhangFeet: 1, additions })).roof.note ?? "";
  assert(/No slope runs down to Left/.test(notes([{ id: "a", kind: "porch", sideId: "left", fromFeet: 0, toFeet: 30, depthFeet: 6 }])), "a porch carried on from a gable end");
  assert(/reaches no further out than the eave/.test(notes([{ id: "a", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 40, depthFeet: 1 }])), "a porch no deeper than the eave");
  assert(/too wide/.test(notes([{ id: "a", kind: "gable", sideId: "front", fromFeet: 0, toFeet: 36 }])), "a cross gable over the ridge");
  // The roof is left as it was.
  near(roofOf(rect(40, 30, { pitch: 6, additions: [{ id: "a", kind: "gable", sideId: "front", fromFeet: 0, toFeet: 36 }] })).roofing.ridgeFeet, 42, "only the house's ridge");
});

console.log("\na main roof and its wings (10-13)");

/** A footprint walked as its sides, [id, length, the corner at its end] each, at 12/12 with no overhangs unless told. */
function walked(list, roof = {}) {
  return exterior(
    list.map(([id, lengthFeet, turn]) => side({ id, name: id, lengthFeet, turn, base: "grade" })),
    { eaveOverhangFeet: 0, rakeOverhangFeet: 0, pitch: 12, ...roof },
  );
}

/** The T: a 30 x 10 bar, and a 10 x 10 stem out of the middle of its front. */
const tee = (roof) =>
  walked(
    [
      ["stemFront", 10, "outside"],
      ["stemRight", 10, "inside"],
      ["barFrontRight", 10, "outside"],
      ["barRight", 10, "outside"],
      ["barRear", 30, "outside"],
      ["barLeft", 10, "outside"],
      ["barFrontLeft", 10, "inside"],
      ["stemLeft", 10, "outside"],
    ],
    roof,
  );

/** The U: a 30 x 10 front, and two 10-wide arms running back 15 from its ends, a 10 x 15 court between. */
const you = (roof) =>
  walked(
    [
      ["front", 30, "outside"],
      ["right", 25, "outside"],
      ["rightArmRear", 10, "outside"],
      ["rightArmInside", 15, "inside"],
      ["court", 10, "inside"],
      ["leftArmInside", 15, "outside"],
      ["leftArmRear", 10, "outside"],
      ["left", 25, "outside"],
    ],
    roof,
  );

/**
 * The owner's twelve corners (Scan's walk of 10-12) in round numbers, front at the bottom: a 40 x 24
 * house with a 10 x 6 deck cut from its rear left corner, a 16 x 6 bump-out at the rear right, and a
 * 20 x 20 garage out of the front at the right, all three flush with the right wall; the garage's
 * right-hand door in a 10 x 2 bay. With the house's front left corner at (0,0): the house [0,40] x
 * [0,24], the deck [0,10] x [18,24], the bump-out [24,40] x [24,30], the garage [20,40] x [-20,0],
 * the bay [30,40] x [-22,-20].
 */
const owners = (roof) =>
  walked(
    [
      ["garageFront", 10, "inside"],
      ["bayLeft", 2, "outside"],
      ["bayFront", 10, "outside"],
      ["right", 52, "outside"],
      ["bumpRear", 16, "outside"],
      ["bumpLeft", 6, "inside"],
      ["rear", 14, "outside"],
      ["deckSide", 6, "inside"],
      ["deckBack", 10, "outside"],
      ["left", 18, "outside"],
      ["front", 20, "inside"],
      ["garageLeft", 20, "outside"],
    ],
    roof,
  );

/**
 * The roof as the owner gives it (10-13): the main roof carried over the deck; the garage hipped at
 * the street end, its bay's gable over the right-hand door, and the whole garage tied in lower,
 * under a gable on the house, siding between.
 */
const ownersRoof = (roof = {}) => owners({ coveredNotches: ["deckSide"], lowerWings: ["garageFront"], wingGables: ["garageFront"], ends: { garageFront: "hip" }, ...roof });

const R3 = Math.sqrt(3);
const gableOf = (q, id) => q.sides.find((s) => s.sideId === id).gableSquareFeet;

test("a T: the stem's roof runs into the bar's front slope, as an L's wing does, up to the bar's ridge", () => {
  // The bar is the main: 300 SF, where the stem run through it is 200.
  const q = roofOf(tee());
  const r = q.roofing;
  assert(q.roof.shape === "wings" && q.roof.note === null, `${q.roof.shape}: ${q.roof.note}`);
  // The bar's ridge 30; the stem's from its front 15 back, where its 5' of rise meets the bar's front
  // slope - at the bar's ridge, the two being as wide.
  near(r.ridgeFeet, 30 + 15, "ridges");
  // From each inside corner up to where the ridges meet: 5' of run at sqrt(3) a foot.
  near(r.valleyFeet, 2 * 5 * R3, "two valleys");
  assert(linesOf(q.roof, "valley").length === 2, "two valley lines");
  near(r.hipFeet, 0, "no hips");
  // The bar's two ends and the stem's front, each 10' across at sqrt(2).
  near(r.rakeFeet, 3 * 10 * Math.SQRT2, "three gable ends");
  // The bar's rear 30, its front either side of the stem 10 + 10, the stem's sides 10 + 10.
  near(r.eaveFeet, 70, "eaves");
  near(r.areaSquareFeet, 400 * Math.SQRT2, "area");
  // The bar's front slope in two (they meet only at the point the ridges do), its rear, the stem's two.
  assert(q.roof.facets.length === 5, `${q.roof.facets.length} slopes`);
  // Eaves round each inside corner are one run: the front left, the front right, the rear.
  assert(r.gutter.runs.length === 3 && r.gutter.endCaps === 6 && r.gutter.insideMitres === 2, `${r.gutter.runs.length} runs, ${r.gutter.insideMitres} inside mitres`);
  // Each gable end carries its triangle: 10 across, 5 up.
  for (const id of ["barLeft", "barRight", "stemFront"]) near(gableOf(q, id), 25, `${id}'s gable`);
  assert(!q.rises.stemLeft && !q.rises.barRear, "no gable over an eave");
  assert(q.roof.wingEnds.join() === "stemFront" && q.roof.wings[0].lower === false, "the stem is the wing, tied in");
});

test("said to stand over the stem's side, the main roof runs front to back through the bar", () => {
  // The main is then the stem run on through the bar, 10 x 20, its ridge along the stem; the bar's
  // two halves are wings on its sides, their ridges meeting its own at (5,15), the spans being equal.
  const r = roofOf(tee({ ridgeAlong: "stemLeft" })).roofing;
  near(r.ridgeFeet, 20 + 15 + 15, "the main's 20 and each half-bar's 15");
  near(r.valleyFeet, 4 * 5 * R3, "four valleys");
  // The main's front and rear ends, and each half-bar's end: 10' each.
  near(r.rakeFeet, 4 * 10 * Math.SQRT2, "four gable ends");
  // The stem's sides 10 + 10; each half-bar's front and rear, 10 each.
  near(r.eaveFeet, 60, "eaves");
});

test("a U: two arms run back into the front's rear slope, each with two valleys", () => {
  // The front is the main (300 SF; each arm run through it is 250).
  const q = roofOf(you());
  const r = q.roofing;
  assert(q.roof.shape === "wings" && q.roof.note === null, `${q.roof.shape}: ${q.roof.note}`);
  // The front's ridge 30; each arm's from its rear end 20 forward, to the front's ridge (as wide).
  near(r.ridgeFeet, 30 + 20 + 20, "ridges");
  // Each arm: a valley from each of its corners on the front's rear wall up to (5,5) or (25,5).
  near(r.valleyFeet, 4 * 5 * R3, "four valleys");
  near(r.hipFeet, 0, "no hips");
  // The front's two ends, each arm's rear: 10' each.
  near(r.rakeFeet, 4 * 10 * Math.SQRT2, "rakes");
  // The front 30; the court's back 10; each arm's two sides, 15 each.
  near(r.eaveFeet, 30 + 10 + 4 * 15, "eaves");
  near(r.areaSquareFeet, 600 * Math.SQRT2, "area");
  // The front's rear slope is in three: the court's width, and a triangle at each end between the
  // gable's rake and the arm's outer valley. Its front, and each arm's two.
  assert(q.roof.facets.length === 8, `${q.roof.facets.length} slopes`);
  const small = q.roof.facets.filter((f) => Math.abs(f.planSquareFeet - 12.5) < 1e-6);
  assert(small.length === 2, "two triangles of 5 x 5 / 2");
  // The front alone, each arm's outer side, and the court's three walls as one run with two inside mitres.
  assert(r.gutter.runs.length === 4 && r.gutter.endCaps === 8 && r.gutter.insideMitres === 2, `${r.gutter.runs.length} runs`);
  // The left wall: the front's gable over its first 10', the arm's eave over the rest.
  near(gableOf(q, "left"), 25, "a gable over part of the wall");
  assert(q.roof.wingEnds.slice().sort().join() === "leftArmRear,rightArmRear", q.roof.wingEnds.join());
});

test("the owner's walk with the deck left open: built, and the deck offered as a notch the roof can carry over", () => {
  const q = roofOf(owners());
  assert(q.roof.shape === "wings", `${q.roof.shape}: ${q.roof.note}`);
  // No overhangs: the plan is the footprint, 900 + 96 + 400 + 20.
  near(q.roof.planSquareFeet, 1416, "plan");
  // Four notches: the step beside the bay (10 x 2), the deck (10 x 6), behind the bump-out's left (14 x 6), and the front left (20 x 20).
  const notches = q.roof.notches.map((k) => `${k.sideIds.join("+")} ${k.x1 - k.x0}x${k.y1 - k.y0}`).sort();
  assert(notches.join(" | ") === "bumpLeft+rear 14x6 | deckSide+deckBack 10x6 | front+garageLeft 20x20 | garageFront+bayLeft 10x2", notches.join(" | "));
  assert(q.roof.notches.every((k) => !k.covered), "none carried over until said");
  // Without the deck the house is two rectangles. The main is the 30 x 24 beside the deck: the 40 x 18
  // in front of it is as big, but the garage (20 across) would be wider than it; the 20 x 44 run from
  // the garage's front to the house's rear is bigger, but leaves a level valley behind the deck. The
  // 10 x 18 in front of the deck then stands on the main's gable end, so it sits lower.
  const main = q.roof.sections[0];
  assert(main.axis === "x" && main.wall.x1 - main.wall.x0 === 30 && main.wall.y1 - main.wall.y0 === 24, JSON.stringify(main.wall));
  const front = q.roof.wings.find((w) => w.sideId === "left");
  assert(front && front.lower && front.forced, JSON.stringify(q.roof.wings));
});

test("the owner's walk, the deck covered and every end a gable: the bay on the garage's gable end has to sit lower", () => {
  // The house [0,40] x [0,24] is the main, deck and all; the bump-out and the garage tie into its
  // rear and front slopes; the bay stands on the garage's gable end, where there is no slope to run
  // into, so it is a roof of its own, its slopes flashed against the garage's front wall.
  const q = roofOf(owners({ coveredNotches: ["deckBack"] }));
  const r = q.roofing;
  assert(q.roof.shape === "wings", q.roof.shape);
  assert(q.roof.notches.find((k) => k.sideId === "deckSide").covered, "named by either of its walls");
  // House 40 at y = 12. Bump-out (16 across, 8 of rise) from its rear 30 to y = 16, where the house's
  // rear slope is 8 up: 14. Garage (20 across, 10 of rise) from its front -20 to y = 10: 30. Bay 2.
  near(r.ridgeFeet, 40 + 14 + 30 + 2, "ridges");
  // Bump-out: (24,24) and (40,24) up to (32,16), 8 of run each. Garage: (20,0) and (40,0) up to (30,10), 10 each.
  near(r.valleyFeet, (2 * 8 + 2 * 10) * R3, "valleys");
  near(r.hipFeet, 0, "no hips");
  // The house's two ends (24 each, the left one across the deck), the bump-out's rear 16, the
  // garage's front 20; the bay's front 10.
  near(r.rakeFeet, (24 + 24 + 16 + 20 + 10) * Math.SQRT2, "rakes");
  // Garage sides 20 + 20, bump-out sides 6 + 6, the house's front left of the garage 20 and its rear
  // 24 (the deck's 10 with it); the bay's sides 2 + 2.
  near(r.eaveFeet, 40 + 12 + 20 + 24 + 4, "eaves");
  // The bay's two slopes against the garage's front wall, 5 across and 5 up each.
  near(r.stepFeet, 2 * 5 * Math.SQRT2, "step flashing");
  near(r.areaSquareFeet, 1476 * Math.SQRT2, "area: the footprint and the deck");
  // The house's front and rear slopes are each one piece (they run on above where the wings' valleys
  // meet); the bump-out's two, the garage's two, the bay's two.
  assert(q.roof.facets.length === 8, `${q.roof.facets.length} slopes`);
  const bay = q.roof.wings.find((w) => w.sideId === "bayFront");
  assert(bay && bay.lower && bay.forced, "the bay is lower, and has to be");
  assert(/bayFront stands on a gable end \(over garageFront\)/.test(q.roof.note ?? "") && /A hip there ties it in/.test(q.roof.note), q.roof.note ?? "");
  assert(q.roof.wings.filter((w) => !w.lower).map((w) => w.sideId).sort().join() === "bumpRear,garageFront", "the others tie in");
});

test("the owner's roof as they give it: the garage hipped at the street, tied in lower under a gable on the house", () => {
  const q = roofOf(ownersRoof());
  const r = q.roofing;
  assert(q.roof.note === null, q.roof.note ?? "");
  // Ridges: the house 40; the bump-out 14 as before; the gable on the house over the garage, from its
  // face at the wall (y = 0) to y = 10, where its 10 of rise meets the house's front slope; the
  // garage's from where its hips meet, (30,-10), back to the wall; the bay's from its front (-22) to
  // (35,-15), where its 5 of rise meets the garage's hip end.
  near(r.ridgeFeet, 40 + 14 + 10 + 10 + 7, "ridges");
  // The garage's hips from (20,-20) up to (30,-10), 10 of run; and from the bay's ridge end (35,-15)
  // on up to (30,-10), 5 - below that the bay's right slope is the garage's own right slope run on.
  near(r.hipFeet, (10 + 5) * R3, "hips");
  // The bump-out's two of 8; the gable on the house, (20,0) and (40,0) up to (30,10), 10 each; the
  // bay's left slope against the garage's hip, (30,-20) up to (35,-15), 5.
  near(r.valleyFeet, (16 + 20 + 5) * R3, "valleys");
  // The house's ends 24 + 24, the bump-out's 16, the gable on the house 20 across; the bay's front 10.
  near(r.rakeFeet, (24 + 24 + 16 + 20 + 10) * Math.SQRT2, "rakes");
  // The house's front 20 and rear 24, the bump-out's sides 6 + 6; the garage's hip end 10 (to the
  // bay), its left side 20, its right side 22 with the bay's, the bay's left 2.
  near(r.eaveFeet, 20 + 24 + 12 + 10 + 20 + 22 + 2, "eaves");
  // The garage's two slopes against the house's front wall, 10 across and 10 up each.
  near(r.stepFeet, 2 * 10 * Math.SQRT2, "step flashing");
  near(r.headwallFeet, 0, "no headwall");
  near(r.areaSquareFeet, 1476 * Math.SQRT2, "area");
  // Two roofs: the house's 1056 (house, deck and bump-out) and the garage's 420 (garage and bay).
  near(q.roof.outlineRects.filter((o) => o.layer > 0).reduce((s, o) => s + (o.x1 - o.x0) * (o.y1 - o.y0), 0), 420, "the garage's roof");
  // The house's front, rear, the bump-out's two, the gable's two; the garage's left, right (its bay's
  // with it) and hip end, the bay's left.
  assert(q.roof.facets.length === 10, `${q.roof.facets.length} slopes`);
  const garage = q.roof.wings.find((w) => w.sideId === "garageFront");
  assert(garage.lower && garage.gable && !garage.forced && garage.onSlope, JSON.stringify(garage));
  assert(q.roof.ends.find((e) => e.sideId === "garageFront").kind === "hip", "the garage's end a hip");
  // The right wall carries the house's gable over its 24' (12 up), and nothing over the garage, bay or bump-out.
  near(gableOf(q, "right"), (24 * 12) / 2, "the right wall's gable");
  // The left wall stops at the deck: the house's gable over 18' of it, 0 up to 12 at y = 12 and back
  // down to 6 at y = 18: 72 + 54.
  near(gableOf(q, "left"), 126, "the left wall's part of the gable");
  assert(!q.rises.deckSide && !q.rises.deckBack, "the deck's walls stand under the roof, not under a gable");
});

test("the owner's walk at its own lengths (14:53, squared): the house is the main roof, deck open or covered", () => {
  // The house 50'2" x 33'1", its deck notch 12'4" x 5'7", the bump-out 24'1" x 5'10", the garage
  // 27'4" x 25'1" with its 12'4" x 2'5" bay. At 5/12, 2' eaves and 22" rakes, as the photo test read them.
  const real = (roof) =>
    walked(
      [
        ["garageFront", 15, "inside"],
        ["bayLeft", 2.4, "outside"],
        ["bayFront", 12.3, "outside"],
        ["right", 66.4, "outside"],
        ["bumpRear", 24.1, "outside"],
        ["bumpLeft", 5.8, "inside"],
        ["rear", 13.8, "outside"],
        ["deckSide", 5.6, "inside"],
        ["deckBack", 12.3, "outside"],
        ["left", 27.5, "outside"],
        ["front", 22.9, "inside"],
        ["garageLeft", 25.1, "outside"],
      ],
      { pitch: 5, eaveOverhangFeet: 2, rakeOverhangFeet: ft(1, 10), ...roof },
    );
  const wall = (q) => q.roof.sections[0].wall;
  const size = (w) => [w.x1 - w.x0, w.y1 - w.y0].map((v) => v.toFixed(1)).join(" x ");
  // Deck open: the house less the deck's 12'4", its ridge along it, the part in front of the deck lower
  // on its gable end. Not the 50'2" x 27'6" in front of the deck: behind that, the 13'10" of house
  // between the deck and the bump-out could only be carried in with a step.
  const open = roofOf(real({}));
  assert(size(wall(open)) === "37.9 x 33.1" && open.roof.sections[0].axis === "x", size(wall(open)));
  // Covered, as the owner gives it: the whole house is the main roof, and nothing has to be lower.
  const theirs = roofOf(real({ coveredNotches: ["deckBack"], lowerWings: ["garageFront"], wingGables: ["garageFront"], ends: { garageFront: "hip" } }));
  assert(size(wall(theirs)) === "50.2 x 33.1" && theirs.roof.note === null, `${size(wall(theirs))}: ${theirs.roof.note}`);
  assert(theirs.roof.wings.every((w) => !w.forced), JSON.stringify(theirs.roof.wings));
  // The house's ridge runs its length and both rakes: 50'2" + 2 x 22".
  near(Math.max(...linesOf(theirs.roof, "ridge").map((l) => l.feet)), 50.2 + 2 * ft(1, 10), "the house's ridge");
});

test("tied in instead, the owner's garage has the same ridges, hips and valleys, less the gable's face and the flashing", () => {
  const r = roofOf(ownersRoof({ lowerWings: [], wingGables: [] })).roofing;
  near(r.ridgeFeet, 81, "ridges: the garage's runs on from (30,-10) to (30,10)");
  near(r.hipFeet, 15 * R3, "hips");
  near(r.valleyFeet, 41 * R3, "valleys: the garage's own where the gable's were");
  near(r.rakeFeet, (24 + 24 + 16 + 10) * Math.SQRT2, "rakes: no gable face at the wall");
  near(r.eaveFeet, 110, "eaves");
  near(r.stepFeet, 0, "no flashing");
});

test("lower but still running into the house's roof (10-22, house G's garage): no wall between, its planes 2' under, its ridge 2' shorter", () => {
  const tied = roofOf(ownersRoof({ lowerWings: [], wingGables: [] }));
  const into = roofOf(ownersRoof({ wingGables: [], lowerWingsInto: ["garageFront"], wingDrops: { garageFront: 2 } }));
  const g = into.roof.sections.find((s) => s.drop);
  assert(g && g.drop === 2 && g.layer === into.roof.sections[0].layer, JSON.stringify(into.roof.sections.map((s) => [s.role, s.layer, s.drop ?? 0])));
  assert(into.roof.wings.some((w) => w.sideId === "garageFront" && w.lower && w.into), JSON.stringify(into.roof.wings));
  assert(!/can't run into/.test(String(into.roof.note ?? "")), into.roof.note);
  // At 12/12 its ridge, 2' lower, meets the house's front slope 2' sooner; its bay's ridge as long, dropped with it.
  near(tied.roofing.ridgeFeet - into.roofing.ridgeFeet, 2, "the garage's ridge 2' shorter");
  assert(into.roofing.stepFeet < 0.01, `no wall to flash: ${into.roofing.stepFeet}`);
});

test("a porch along the owner's front stops at the garage, and is flashed against its wall", () => {
  // The front, (0,0) to (20,0), carried on 6' out. At the left it runs on as the roof does there (no
  // rake overhang here); at the right it stops at the garage's left wall, an inside corner.
  const q = roofOf(ownersRoof({ additions: [{ id: "p", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 20, depthFeet: 6 }] }));
  const r = q.roofing;
  near(q.roof.planSquareFeet, 1476 + 20 * 6, "the porch's 120 SF, and no more");
  // The porch's end against the garage: its slope, 6 across and 6 down, flashed to the garage's left wall.
  const flashed = q.roof.edges.filter((e) => e.kind === "step" && e.sideId === "garageLeft");
  assert(flashed.length === 1 && Math.abs(flashed[0].feet - 6 * Math.SQRT2) < 1e-6, flashed.map((e) => e.feet).join());
  near(r.stepFeet, (20 + 6) * Math.SQRT2, "step flashing, the garage's and the porch's");
  // The house's left rake now runs on down over the porch's end: 24 + 6.
  near(r.rakeFeet, (30 + 24 + 16 + 20 + 10) * Math.SQRT2, "rakes");
  near(r.eaveFeet, 110, "the porch's eave where the house's front one was");
});

/** The plan's labels as the drawing places them: lettering 3% of the plan, lengths at 0.62 of it. */
function labelled(plan) {
  const xs = plan.lines.flatMap((l) => [l.a.x, l.b.x]);
  const ys = plan.lines.flatMap((l) => [l.a.y, l.b.y]);
  const fs = Math.max(0.6, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.03);
  return { fs, labels: x.roofLineLabels(plan, fs * 0.62, x.facetLabelBoxes(plan, fs)), boxes: x.facetLabelBoxes(plan, fs) };
}

test("every line carries its length: on its line, upright, and none over another or a slope's letter", () => {
  const roofs = {
    gable: rect(40, 30, { pitch: 6 }),
    hip: rect(40, 30, { pitch: 6, ends: { left: "hip", right: "hip" } }),
    "L with hips": ell({ ends: { left: "hip", right: "hip", rear: "hip" }, eaveOverhangFeet: 1 }),
    "L with cross gables": ell({ eaveOverhangFeet: 1, rakeOverhangFeet: 1 }),
    "porch and cross gable": rect(54, 33, {
      pitch: 5,
      additions: [
        { id: "p", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 23, depthFeet: ft(4, 10) },
        { id: "g", kind: "gable", sideId: "front", fromFeet: 10, toFeet: 21 },
      ],
    }),
    "lower wing": ell({ lowerWings: ["rear"], eaveOverhangFeet: 1, rakeOverhangFeet: 1 }),
    "lean-to": rect(40, 30, { pitch: 6, additions: [{ id: "l", kind: "porch", sideId: "left", fromFeet: 5, toFeet: 25, depthFeet: 8, lower: true }] }),
    T: tee({ pitch: 6, eaveOverhangFeet: 1, rakeOverhangFeet: 1 }),
    U: you({ pitch: 6, eaveOverhangFeet: 1, rakeOverhangFeet: 1 }),
    "the owner's twelve corners": ownersRoof({ pitch: 5, eaveOverhangFeet: 2, rakeOverhangFeet: ft(1, 10), additions: [{ id: "p", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 20, depthFeet: ft(4, 10) }] }),
  };
  for (const [name, e] of Object.entries(roofs)) {
    const plan = roofOf(e).roof;
    const { labels, boxes } = labelled(plan);
    assert(labels.length === plan.lines.length && new Set(labels.map((l) => l.key)).size === plan.lines.length, `${name}: a label for each of ${plan.lines.length} lines, got ${labels.length}`);
    for (const t of labels) {
      const line = plan.lines.find((l) => l.key === t.key);
      assert(t.text === x.formatFeetInches(line.feet), `${name}: ${t.key} reads ${t.text}, its length is ${line.feet}`);
      assert(t.angle > -90 + 1e-9 && t.angle <= 90 + 1e-9, `${name}: ${t.key} upside down at ${t.angle}`);
      const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
      const off = Math.abs((line.b.x - line.a.x) * (t.y - line.a.y) - (line.b.y - line.a.y) * (t.x - line.a.x)) / len;
      // Off its line only where the line is shorter than the label: the 2" jog where the owner's
      // bump-out's 24" eave meets the house's 22" rake has no room on it at all.
      assert((t.onLine && off < 1e-6) || (!t.onLine && t.width > len), `${name}: ${t.key} (${t.text}) is off its line by ${off.toFixed(2)}'`);
    }
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) assert(!x.labelsOverlap(labels[i], labels[j]), `${name}: ${labels[i].key} (${labels[i].text}) over ${labels[j].key} (${labels[j].text})`);
      for (const b of boxes) assert(!x.labelsOverlap(labels[i], b), `${name}: ${labels[i].key} over a slope's letter`);
    }
  }
});

test("the legend's totals are the lines' own, kind by kind", () => {
  const plan = roofOf(ell({ lowerWings: ["rear"], eaveOverhangFeet: 1, rakeOverhangFeet: 1 })).roof;
  const totals = x.lineTotals(plan);
  assert(totals.map((t) => t.kind).join() === "ridge,eave,rake,step", totals.map((t) => t.kind).join());
  for (const t of totals) near(t.feet, sum(linesOf(plan, t.kind)), t.kind, 1e-9);
  near(totals.find((t) => t.kind === "step").feet, 11 * Math.SQRT2, "step flashing");
});

console.log("\ninto the scope");

/** The owner's house at 4/12, his Left side measured, 40' along the ridge. */
function ownersHouse(scope) {
  const e = rect(40, ft(34, 3), { pitch: 4 }, ft(12, 7));
  e.sides[3] = { ...ownersSide(), id: "left" };
  if (scope) e.scope = { roofing: false, sides: [], soffitFascia: false, eavestrough: false, ...scope };
  return e;
}

test("nothing measured outside is in scope until it is ticked", () => {
  const lines = x.exteriorScopeLines(ownersHouse());
  assert(lines.roofing.length === 0 && lines.siding.length === 0, "no lines without a tick");
  assert(x.exteriorScopeLines(undefined).roofing.length === 0, "no exterior, no lines");
});

test("roofing ticked: real squares, the cap, starter, ice and water - and the material still to say", () => {
  const { roofing, siding } = x.exteriorScopeLines(ownersHouse({ roofing: true }));
  // 1634.38 SF -> 16.34 SQ (see the 4/12 house above); no waste, that is the estimator's.
  assert(roofing[0] === "Remove & replace roofing – material to confirm – 4/12 – 16.34 SQ (all slopes)", `first line: ${roofing[0]}`);
  assert(roofing.includes("Hip & ridge cap – 42.0 LF"), "ridge cap the ridge's 42'");
  assert(roofing.includes("Starter – 84.0 LF (eaves)"), "starter");
  assert(roofing.includes("Ice & water barrier – 84.0 LF (eaves + valleys)"), "ice and water");
  assert(!roofing.some((l) => l.startsWith("Drip edge")), "no drip edge until it is said yes to");
  assert(!roofing.some((l) => l.startsWith("Valleys")), "no valley line on a gable roof");
  assert(!roofing.some((l) => l.startsWith("Steep")), "4/12 is not steep");
  assert(siding.length === 0, "nothing for the siding crew");
});

test("a side's cladding ticked: net of its window, by name", () => {
  const { siding } = x.exteriorScopeLines(ownersHouse({ sides: ["left"] }));
  assert(siding[0] === "Remove & replace stucco – Left – 498.0 SF (508.0 SF less 10.1 SF of openings)", `got ${siding[0]}`);
  assert(!siding.some((l) => l.startsWith("House wrap")), "stucco takes no house wrap line");
});

test("vinyl on two sides adds the wrap and the trim round their openings", () => {
  const e = ownersHouse({ sides: ["left", "front"] });
  for (const s of e.sides) s.bands = [{ id: "v", kind: "vinyl", top: null }];
  const { siding } = x.exteriorScopeLines(e);
  // Front 40 x 11'11" = 476.67 SF, Left 497.97 net: 974.6 SF of vinyl.
  assert(siding[0] === "Remove & replace vinyl siding – Front, Left – 974.6 SF (984.7 SF less 10.1 SF of openings)", `got ${siding[0]}`);
  assert(siding.includes("House wrap – 974.6 SF"), "wrap the vinyl's net");
  assert(siding.includes("Trim & J-channel round openings – 13.8 LF"), "the window's trim");
});

test("soffit, fascia and eavestrough ticked: by the foot, with the fittings", () => {
  const { siding } = x.exteriorScopeLines(ownersHouse({ soffitFascia: true, eavestrough: true }));
  // Soffit: 84 LF of eave at 16" (112 SF); the rakes, 2 x 36.917 x 1.054093 = 77.8 LF at 12".
  assert(siding.includes(`Remove & replace soffit – material to confirm – 84.0 LF at 1'4" overhang (112.0 SF) – eaves`), siding.join(" | "));
  assert(siding.includes("Remove & replace soffit – material to confirm – 77.8 LF at 1' overhang (77.8 SF) – rakes"), siding.join(" | "));
  assert(siding.includes("Remove & replace fascia – material to confirm – 161.8 LF (eaves + rakes)"), "fascia");
  // Two straight eaves: an end cap at each end of each, two downspouts each, a drop each, three elbows each.
  assert(siding.includes("Remove & replace eavestrough – 84.0 LF"), "eavestrough");
  assert(siding.includes("End caps – 4") && siding.includes("Drops – 4") && siding.includes("Elbows – 12"), siding.join(" | "));
  assert(!siding.some((l) => l.startsWith("Mitres")), "no corners on a gable roof's eaves");
  // 4 x 12'7" x 1.15 = 57.88 LF.
  assert(siding.includes("Remove & replace downspouts – 4 – 57.9 LF (eave height + 15%)"), siding.join(" | "));
});

test("the Roofing and Siding work orders are offered only with lines, and carry them", () => {
  const claim = { ...x.emptyClaimInfo(), jobNumber: "J1", customerName: "Owner", scopePhases: ["REPAIR"] };
  const none = x.availableTrades(claim, "TM", x.exteriorScopeLines(ownersHouse()));
  assert(!none.includes("ROOFING") && !none.includes("SIDING"), "nothing ticked, no exterior crews");
  const lines = x.exteriorScopeLines(ownersHouse({ roofing: true, sides: ["left"] }));
  const trades = x.availableTrades(claim, "TM", lines);
  assert(trades.includes("ROOFING") && trades.includes("SIDING"), `offered: ${trades.join(", ")}`);
  assert(!x.availableTrades({ ...claim, scopePhases: ["EMERGENCY"] }, "TM", lines).includes("ROOFING"), "not without Repair");
  const [roofing] = x.buildWorkOrders({ trades: ["ROOFING"], claim, extraction: null, contentsApproach: "TM", contentsTM: null, bricABrac: null, dgigData: null, exterior: lines });
  assert(roofing.text.includes("  Exterior\n    - Remove & replace roofing – material to confirm – 4/12 – 16.34 SQ"), roofing.text);
  assert(/WORK ORDER — ROOFING/.test(roofing.text), "headed as roofing");
});

test("the scope document is handed the lines and told to copy them", () => {
  const extraction = { loss: { category: null, lossClass: null, source: null, dateOfLoss: null, yearOfBuilding: null, asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null, isBasementLoss: false, hvacInspectionRequired: null }, rooms: [] };
  const lines = x.exteriorScopeLines(ownersHouse({ roofing: true }));
  const all = [...lines.roofing, ...lines.siding];
  const claim = x.emptyClaimInfo();
  const message = x.documentGenerationUserMessage(claim, extraction, "", null, null, undefined, all);
  assert(message.includes(JSON.stringify(all[0]).slice(1, -1)), "the first line reaches the claim context");
  assert(x.documentGenerationUserMessage({ ...claim, scopeOnly: true }, extraction, "", null, null, undefined, all).includes('"exterior":['), "and in scope-only mode");
  assert(x.documentGenerationUserMessage(claim, extraction, "").includes('"exterior":[]'), "an empty list when nothing is in scope");
  for (const prompt of [x.DOCUMENT_GENERATION_SYSTEM_PROMPT, x.SCOPE_ONLY_SYSTEM_PROMPT]) {
    assert(/EXTERIOR LINES ARE COMPUTED, NOT WRITTEN BY YOU/.test(prompt), "the rule is in the prompt");
    assert(/Exterior\s+\(only when CLAIM CONTEXT's "exterior" has lines/.test(prompt), "and the heading in the format");
  }
});

console.log("\nslopes, edges and the owner's list (10-12)");

test("roofing only the slopes picked on the plan: squares, lines and edges follow", () => {
  const e = ownersHouse({ roofing: true });
  const q0 = x.exteriorQuantities(e);
  assert(q0.roof.facets.map((f) => `${f.label}:${f.key}`).join() === "A:front#0,B:rear#0", q0.roof.facets.map((f) => f.key).join());
  e.roof.slopes = ["front#0"];
  const r = x.exteriorQuantities(e).roofing;
  // Half the roof: 1550.5 x 1.0540926 / 2 = 817.19 SF.
  near(r.areaSquareFeet, (1550.5 * 1.0540926) / 2, "the front slope", 1e-3);
  near(r.ridgeFeet, 42, "the ridge bounds it, so its cap is in");
  near(r.eaveFeet, 42, "its own eave only");
  // The front half of each rake: 2 x 18.458 x 1.054093.
  near(r.rakeFeet, 36.916667 * 1.0540926, "the front halves of the rakes");
  const { roofing } = x.exteriorScopeLines(e);
  assert(roofing[0] === "Remove & replace roofing – material to confirm – 4/12 – 8.17 SQ (slope A)", roofing[0]);
});

test("eaves and rakes picked for the eavestrough, soffit and fascia", () => {
  const e = ownersHouse({ eavestrough: true, soffitFascia: true });
  const q0 = x.exteriorQuantities(e);
  const front = q0.roof.edges.find((g) => g.kind === "eave" && g.sideId === "front");
  assert(front && front.key === "eave:front:0", `front eave key ${front?.key}`);
  e.roof.edges = [front.key];
  const r = x.exteriorQuantities(e).roofing;
  near(r.gutter.feet, 42, "one eave");
  assert(r.gutter.endCaps === 2 && r.gutter.downspouts === 2, `caps ${r.gutter.endCaps}, downspouts ${r.gutter.downspouts}`);
  near(r.soffit.eaveFeet, 42, "soffit along it");
  near(r.soffit.rakeFeet, 0, "no rake soffit");
  near(r.fasciaFeet, 42, "fascia along it");
});

test("an L with cross gables: three runs of eavestrough, six end caps, one inside mitre", () => {
  const r = roofOf(ell({})).roofing;
  assert(r.gutter.runs.length === 3, `runs ${r.gutter.runs.length}`);
  assert(r.gutter.endCaps === 6 && r.gutter.insideMitres === 1 && r.gutter.outsideMitres === 0, JSON.stringify(r.gutter));
  near(r.gutter.feet, 50, "every eave");
  const hip = roofOf(ell({ ends: { left: "hip", right: "hip", rear: "hip" } })).roofing;
  assert(hip.gutter.runs.length === 1 && hip.gutter.outsideMitres === 5 && hip.gutter.insideMitres === 1 && hip.gutter.endCaps === 0, JSON.stringify(hip.gutter));
  // Five slopes on the cross-gabled L, the back of the main roof in two pieces either side of the wing.
  assert(roofOf(ell({})).roof.facets.length === 5, "five slopes");
});

test("a slope keeps its key when a length is retyped", () => {
  const e = ownersHouse();
  const before = x.exteriorQuantities(e).roof.facets.map((f) => f.key).join();
  e.sides[0].lengthFeet = 44;
  e.sides[2].lengthFeet = 44;
  assert(x.exteriorQuantities(e).roof.facets.map((f) => f.key).join() === before, "same keys");
});

test("every question the owner listed is asked until answered, and each answer has its line", () => {
  const e = ownersHouse({ roofing: true, eavestrough: true, soffitFascia: true });
  const ask = x.exteriorQuantities(e).roofing.toAnswer;
  assert(ask.roofing.length === 10, ask.roofing.join(" | "));
  assert(ask.eavestrough.length === 1 && ask.soffitFascia.length === 1, "leaf guard, soffit material");
  Object.assign(e.roof, {
    material: "composite",
    dripEdge: true,
    underlayment: "synthetic",
    high: true,
    handload: true,
    disposalHandload: true,
    chimney: "medium",
    vents: { turtle: 3, exhaust: 1 },
    pipeJacks: { four: 2, six: 1 },
    ridgeVents: ["ridge:front#0|rear#0"],
    leafGuard: true,
    soffitMaterial: "metal",
  });
  const q = x.exteriorQuantities(e).roofing;
  assert(q.toAnswer.roofing.length + q.toAnswer.eavestrough.length + q.toAnswer.soffitFascia.length === 0, JSON.stringify(q.toAnswer));
  const { roofing, siding } = x.exteriorScopeLines(e);
  for (const line of [
    "Remove & replace roofing – Composite (laminated) shingles – 4/12 – 16.34 SQ (all slopes)",
    "High roof charge – two storeys or more – 16.34 SQ",
    "Drip edge – 161.8 LF (eaves + rakes) – photos required",
    "Underlayment – synthetic – 16.34 SQ – photos required",
    "Turtle vent – 3",
    "Exhaust vent – 1",
    "Ridge vent – 42.0 LF",
    'Pipe jack – 4" – 2',
    'Pipe jack – 6" – 1',
    "Chimney flashing – medium",
    "Handload roofing materials – 16.34 SQ",
    "Handload debris to disposal – 16.34 SQ",
  ]) assert(roofing.includes(line), `missing "${line}" in ${roofing.join(" | ")}`);
  assert(siding.includes("Leaf guard – 84.0 LF"), "leaf guard");
  assert(siding.some((l) => l.startsWith("Remove & replace soffit – metal – 84.0 LF")), "metal soffit");
});

test("metal roofing: closure strips, high-temperature ice and water, its own disposal", () => {
  const e = ownersHouse({ roofing: true });
  e.roof.material = "metal";
  const { roofing } = x.exteriorScopeLines(e);
  // Closure at the eaves and both sides of the ridge: 84 + 2 x 42 = 168.
  assert(roofing.includes("Closure strips – 168.0 LF (eaves + 2 × ridge)"), roofing.join(" | "));
  assert(roofing.includes("High-temperature ice & water barrier – 84.0 LF (eaves + valleys)"), "high-temp barrier");
  assert(roofing.includes("Disposal – metal roofing – 16.34 SQ"), "metal disposal");
  assert(!roofing.some((l) => l.startsWith("Starter")), "no shingle starter under metal");
});

test("steep is charged on the squares being roofed", () => {
  const e = rect(30, 20, { pitch: 8, eaveOverhangFeet: 0, rakeOverhangFeet: 0 });
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  // 600 x sqrt(1 + (8/12)^2) = 721.11 SF.
  assert(x.exteriorScopeLines(e).roofing.includes("Steep roof charge – 7/12 to 9/12 – 7.21 SQ"), x.exteriorScopeLines(e).roofing.join(" | "));
});

test("what is on a wall goes on the scope, cladding ticked or not", () => {
  const e = ownersHouse();
  e.sides[3].fixtures = [
    { id: "d", kind: "dryer_vent", action: "detach_reset", count: 1 },
    { id: "h", kind: "hose_bib", action: "replace", count: 2 },
    { id: "o", kind: "other", label: "Gas meter", action: "detach_reset", count: 1 },
    { id: "z", kind: "light", action: "replace", count: 0 },
  ];
  const { siding } = x.exteriorScopeLines(e);
  assert(siding.join("|") === "Detach & reset dryer vent – Left – 1|Replace hose bib – Left – 2|Detach & reset Gas meter – Left – 1", siding.join(" | "));
});

test("wood shake takes house wrap; EIFS does not", () => {
  const e = ownersHouse({ sides: ["front", "left"] });
  e.sides[0].bands = [{ id: "w", kind: "wood_shake", top: null }];
  e.sides[3].bands = [{ id: "e", kind: "eifs", top: null }];
  const { siding } = x.exteriorScopeLines(e);
  assert(siding.some((l) => l.startsWith("Remove & replace wood shake – Front – 476.7 SF")), siding.join(" | "));
  assert(siding.some((l) => l.startsWith("Remove & replace eifs – Left – 498.0 SF")), siding.join(" | "));
  assert(siding.includes("House wrap – 476.7 SF"), "wrap under the shakes only");
});

test("the roof plan and elevations go on the documents once, and an untick stays", () => {
  // A hail claim with an outside and no inside still has both pictures to offer.
  const available = x.availableRenders(false, false, [], [], ["roof", "elevations"]);
  assert(available.join() === "roof,elevations", available.join());
  assert(x.availableRenders(true, false, [], [0], ["roof"]).join() === "clean,roof", "after the plan");
  const first = x.withExteriorDefaults(x.pruneAttachments(x.defaultSketchAttachments(), available), available);
  assert(first.scopeDocument.includes("roof") && first.scopeDocument.includes("elevations"), first.scopeDocument.join());
  assert(first.inspectionReport.includes("roof"), "on the inspection report too");
  assert(first.workOrders.ROOFING.join() === "roof" && first.workOrders.SIDING.join() === "roof,elevations", JSON.stringify(first.workOrders));
  assert(first.exteriorDefaulted === true, "remembered");
  const unticked = x.toggleAttachment(first, { kind: "scopeDocument" }, "elevations");
  const again = x.withExteriorDefaults(x.pruneAttachments(unticked, available), available);
  assert(!again.scopeDocument.includes("elevations"), "the untick is the PM's");
  // Nothing to draw yet: nothing ticked, and the defaults wait for the first picture.
  const none = x.withExteriorDefaults(x.defaultSketchAttachments(), x.availableRenders(true, false));
  assert(!none.exteriorDefaulted && !none.scopeDocument.includes("roof"), "waits");
});

console.log("\nfrom Scrivn Scan (arcapture-exterior/1)");

const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const roomFixture = (name) => JSON.parse(readFileSync(join(root, "test", "sketch", "fixtures", name), "utf8"));
const M = 1 / 0.3048;
const M2 = M * M;
const pending = (body, over = {}) => ({ id: "scan-1", claimId: "c", captureId: null, capturedAt: null, receivedAt: "2026-10-12T18:00:00Z", level: 0, body, deviceName: null, ...over });

test("Scan's own sample house reads in, and Scrivn's areas agree with Scan's", () => {
  const r = x.parseScanExterior(fixture("scan-exterior-sample.json"));
  assert(r.ok, r.error);
  const e = r.exterior;
  assert(e.sides.map((s) => s.name).join() === "Front,Right,Rear,Left", e.sides.map((s) => s.name).join());
  assert(!r.notes.some((n) => /different areas/.test(n)), r.notes.join(" | "));
  const front = x.sideQuantities(e.sides[0]);
  // Scan: brick 9.000 m2 gross, 1.010 openings, 7.990 net; stucco 18.000, 2.017, 15.983.
  near(front.bands[0].netSquareFeet, 7.99 * M2, "brick net", 0.05);
  near(front.bands[1].netSquareFeet, 15.983 * M2, "stucco net", 0.05);
  near(front.bands[0].openingSquareFeet, 1.01 * M2, "openings in the brick", 0.05);
  assert(e.sides[0].openings[1].kind === "door", "the door is a door");
  near(e.sides[0].bands[0].top, 1.2 * M, "the brick runs to 1.2 m");
  // Right's gable: (4.333 - 3.0) over 4 m = 4/12.
  near(x.sideQuantities(e.sides[1]).pitchFromGable, 4, "4/12 from the peak", 0.01);
  const q = x.exteriorQuantities(e);
  assert(q.footprint.closes, q.footprint.reason);
  near(q.footprint.areaSquareFeet, 80 * M2, "10 x 8 m footprint", 0.01);
  assert(q.pitch.source === "sides" && q.roof, "the roof builds at the gables' pitch");
  assert(e.source.kind === "scan" && !e.source.edited, "marked as from a scan");
});

test("a walk to the left round an L: the Front first, the inside corner where it is", () => {
  const r = x.parseScanExterior(fixture("scan-exterior-handwritten.json"));
  assert(r.ok, r.error);
  const e = r.exterior;
  assert(e.sides.map((s) => s.name).join() === "Front,Right,Right rear,Inside right,Rear,Left", e.sides.map((s) => s.name).join());
  assert(e.sides.map((s) => s.turn).join() === "outside,outside,inside,outside,outside,outside", e.sides.map((s) => s.turn).join());
  const f = x.exteriorFootprint(e);
  assert(f.closes, f.reason);
  near(f.areaSquareFeet, 104 * M2, "12 x 10 m less a 4 x 4 m notch", 0.01);
  assert(e.source.captureId === "handwritten-l-left-walk", "capture id kept");
});

test("a side's heights are from one grade level: band lines as tapped, two eave taps averaged", () => {
  const r = x.parseScanExterior(fixture("scan-exterior-handwritten.json"));
  const left = r.exterior.sides.find((s) => s.name === "Left");
  // Scan reads one ground level per side, so a line tapped 1.0 m up is 1.0 m up wherever along it was.
  near(left.bands[0].top, 1.0 * M, "stone band top as tapped", 1e-9);
  assert(left.bands[0].kind === "stone" && left.bands[1].kind === "stucco", "stone under stucco");
  // Eave tapped 3.836 m and 3.988 m: one level line read twice, so 3.912 m at both ends, and said.
  near(left.eaveLeftFeet, 3.912 * M, "eave averaged", 1e-9);
  assert(left.eaveLeftFeet === left.eaveRightFeet, "no grade fall invented from the difference");
  assert(r.notes.some((n) => /eave taps differ on Left \(6 in\)/.test(n)), r.notes.join(" | "));
  // The phone's own pitch is believed (4.1); worked from the peak it would be 1.701 m over the 5 m half span, 4.08.
  near(x.sideQuantities(left).pitchFromGable, 4.1, "the phone's pitch", 1e-9);
  near(x.sideQuantities({ ...left, pitchMeasured: null }).pitchFromGable, (1.701 / 5) * 12, "the peak's, without it", 1e-3);
});

test("Scan's own Send body for an exterior walked alone", () => {
  const body = fixture("scan-exterior-send.json");
  assert(x.isExteriorOnlyScan(body), "rooms: [] with the exterior");
  const made = x.sketchFromScan(body, { scanId: "s", captureId: null, receivedAt: "2026-10-12T18:00:00Z" });
  assert(made.ok, made.error);
  const e = made.sketch.exterior;
  assert(made.sketch.rooms.length === 0 && e.sides.length === 4, "four sides, no rooms");
  assert(e.sides.find((s) => s.name === "Rear").openings.some((o) => o.kind === "garage"), "the 2.5 m door is a garage door");
  assert(!made.notes.some((n) => /different areas/.test(n)), made.notes.join(" | "));
  assert(e.source.captureId === body.exterior.capture_id, "the capture's own id");
});

test("garage doors, a part-wall gable, a parging line and a side with no eave", () => {
  const r = x.parseScanExterior(fixture("scan-exterior-handwritten.json"));
  const by = (name) => r.exterior.sides.find((s) => s.name === name);
  const garage = by("Front").openings[0];
  assert(garage.kind === "garage", "garage kept");
  near(garage.heightFeet, 2.134 * M, "head less sill");
  near(by("Rear").gable.toFeet, 8 * M, "the gable's span");
  const right = by("Right");
  assert(right.base === "parging", "a parging line is the bottom of the cladding");
  near(right.baseLeftFeet, 0.25 * M, "at 0.25 m");
  assert(right.bands.length === 1 && right.bands[0].kind === "fibre_cement", "and not a band of its own");
  assert(by("Right rear").eaveLeftFeet === null, "no eave stays no eave");
  assert(r.notes.some((n) => /No eave was tapped on Right rear/.test(n)), r.notes.join(" | "));
});

test("the exterior arrives inside a capture, as text, with no rooms", () => {
  const body = JSON.stringify({ format: "arcapture-capture/1", rooms: [], exterior: fixture("scan-exterior-handwritten.json") });
  assert(x.isExteriorOnlyScan(body), "an exterior-only capture");
  assert(!x.isExteriorOnlyScan({ ...roomFixture("scan-taps-capture.json"), exterior: fixture("scan-exterior-sample.json") }), "with rooms it is not");
  assert(x.parseScanExterior(body).ok, "reads from the text");
  assert(!x.parseScanExterior({ format: "something-else" }).ok, "anything else is refused");
  assert(!x.parseScanExterior({ format: "arcapture-exterior/1", sides: [{ name: "Front", length_m: -2 }] }).ok, "a side with no length is refused");
});

test("a phone's exterior-only scan replaces the exterior and leaves the rooms alone", () => {
  const rooms = x.adoptScan({ rooms: [] }, pending(roomFixture("scan-taps-capture.json"), { id: "rooms" }));
  assert(!("ok" in rooms) && rooms.sketch.rooms.length > 0, "the rooms went in");
  const before = rooms.sketch;
  const adopted = x.adoptScan(before, pending(fixture("scan-exterior-sample.json"), { id: "outside" }));
  assert(!("ok" in adopted), adopted.error);
  assert(adopted.sketch.rooms === before.rooms, "the rooms untouched");
  assert(adopted.sketch.scan === before.scan, "and the storey's provenance");
  assert(adopted.exteriorSides === 4 && adopted.sketch.exterior.sides.length === 4, "four sides");
  assert(adopted.sketch.exterior.source.scanId === "outside", "with the scan it came from");
  const made = x.sketchFromScan(fixture("scan-exterior-sample.json"), { scanId: "s", captureId: null, receivedAt: "2026-10-12T18:00:00Z" });
  assert(made.ok && made.sketch.rooms.length === 0 && made.sketch.exterior, "a new claim from one has the exterior and no rooms");
});

test("one measured or changed by hand is asked about, one from a scan is not", () => {
  assert(x.exteriorScanDecision({ rooms: [] }) === "adopt", "none yet");
  assert(x.exteriorScanDecision({ rooms: [], exterior: rect(30, 20) }) === "ask", "typed by hand");
  const scanned = x.parseScanExterior(fixture("scan-exterior-sample.json")).exterior;
  assert(x.exteriorScanDecision({ rooms: [], exterior: scanned }) === "adopt", "from a scan, untouched");
  const edited = { ...scanned, source: { ...scanned.source, edited: true } };
  assert(x.exteriorScanDecision({ rooms: [], exterior: edited }) === "ask", "from a scan, then changed");
});

test("a capture with rooms and an exterior brings both, but never over a hand-made exterior", () => {
  const body = { ...roomFixture("scan-taps-capture.json"), exterior: fixture("scan-exterior-sample.json") };
  const fresh = x.adoptScan({ rooms: [] }, pending(body));
  assert(!("ok" in fresh), fresh.error);
  assert(fresh.roomCount > 0 && fresh.exteriorSides === 4, `rooms ${fresh.roomCount}, sides ${fresh.exteriorSides}`);
  const mine = rect(30, 20);
  const kept = x.adoptScan({ rooms: [], exterior: mine }, pending(body));
  assert(kept.sketch.exterior === mine, "the hand-made exterior kept");
  assert(kept.notes.some((n) => /exterior was not applied/.test(n)), kept.notes.join(" | "));
});

console.log("\nfrom Scrivn Scan, tapped as shapes (arcapture-exterior/2)");

test("the owner's gable side, tapped as shapes: the stucco's own area, less its window, parging not counted", () => {
  const r = x.parseScanExterior(fixture("scan-exterior-v2-sample.json"));
  assert(r.ok, r.error);
  const side = r.exterior.sides[0];
  assert(side.shapes.length === 2 && side.shapes[0].kind === "stucco" && side.shapes[1].kind === "parging", side.shapes.map((s) => s.kind).join());
  assert(side.shapes[0].polygon.length === 7 && side.shapes[0].closed, "seven corners, closed");
  const q = x.sideQuantities(side);
  // Scan: stucco 40.765 m2 gross, 0.75 m2 of window, 40.015 m2 net; parging 7.2 m2 not cladding.
  assert(q.complete && q.bands.length === 1 && q.bands[0].kind === "stucco", q.bands.map((b) => b.kind).join());
  near(q.grossSquareFeet, 40.765 * M2, "stucco gross", 0.05);
  near(q.openingSquareFeet, 0.75 * M2, "the window", 0.01);
  near(q.netSquareFeet, 40.015 * M2, "stucco net", 0.05);
  near(q.wallSquareFeet + q.gableSquareFeet, q.grossSquareFeet, "wall and gable make the whole", 1e-6);
  assert(!r.notes.some((n) => /different areas/.test(n)), r.notes.join(" | "));
});

test("one ground level: the eaves keep their own heights, the phone's pitch is believed", () => {
  const side = x.parseScanExterior(fixture("scan-exterior-v2-sample.json")).exterior.sides[0];
  assert(side.heightsFrom === "level", "heights from one level");
  near(side.eaveLeftFeet, 3.9 * M, "eave over the left wall", 1e-9);
  near(side.eaveRightFeet, 4.9 * M, "eave under the right rake", 1e-9);
  near(x.sideQuantities(side).fallFeet, 0, "no slope read from them");
  near(x.sideQuantities(side).pitchFromGable, 4.304, "Scan's 4.3/12", 1e-9);
  near(x.sideQuantities(side).corners.leftFeet, (3.9 - 0.9) * M, "wall at the left corner, above the parging", 1e-9);
});

test("the roofline sets the rake overhang, and the roof over the deck is said, not dropped", () => {
  const r = x.parseScanExterior(fixture("scan-exterior-v2-sample.json"));
  // A side whose roofline has a peak is a gable: its roof edge 0.3 m out is the rake overhang.
  near(r.exterior.roof.rakeOverhangFeet, 0.3 * M, "rake overhang", 1e-9);
  near(r.exterior.roof.eaveOverhangFeet, 16 / 12, "no eave side measured: the default stands");
  assert(r.notes.some((n) => /^Overhangs from the phone's roofline: rake 1'\./.test(n)), r.notes.join(" | "));
  // 3.1 m past the left wall over the deck; 0.6 m past the right is an ordinary overhang.
  assert(r.notes.some((n) => /The roof runs 10'2" past Front's left end/.test(n)), r.notes.join(" | "));
  assert(!r.notes.some((n) => /past Front's right end/.test(n)), "the right end is an ordinary overhang");
  assert(r.exterior.sides[0].roofline.length === 3, "kept on the side for the drawing");
});

test("Scan's own Send body for /2: an exterior capture of its own", () => {
  const body = fixture("scan-exterior-v2-send.json");
  assert(x.isExteriorOnlyScan(body), "rooms: [] plus exterior");
  const made = x.sketchFromScan(body, { scanId: "s", captureId: null, receivedAt: "2026-10-12T20:00:00Z" });
  assert(made.ok, made.error);
  assert(made.sketch.rooms.length === 0 && made.sketch.exterior.sides[0].shapes.length === 2, "the shapes came in");
});

test("a shape left open is drawn, not counted, and said", () => {
  const raw = fixture("scan-exterior-v2-sample.json");
  raw.sides[0].shapes[0].closed = false;
  const r = x.parseScanExterior(raw);
  assert(r.ok, r.error);
  const q = x.sideQuantities(r.exterior.sides[0]);
  assert(!q.complete && q.grossSquareFeet === 0, "nothing counted from an open shape");
  assert(r.notes.some((n) => /left open is drawn but not counted: Front \(stucco\)/.test(n)), r.notes.join(" | "));
});

/** A side tapped as these shapes (feet), on one ground level. */
function shapedSide(shapes, over = {}) {
  return side({
    lengthFeet: 10,
    eaveLeftFeet: 8,
    eaveRightFeet: 8,
    heightsFrom: "level",
    base: "grade",
    shapes: shapes.map(([kind, poly], i) => ({ id: `sh${i}`, kind, closed: true, polygon: poly.map(([px, py]) => ({ x: px, y: py })) })),
    ...over,
  });
}

test("a stone wainscot tapped over a stucco wall is counted once, as the stone", () => {
  const q = x.sideQuantities(
    shapedSide([
      ["stucco", [[0, 0], [10, 0], [10, 8], [0, 8]]],
      ["stone", [[0, 0], [10, 0], [10, 3], [0, 3]]],
    ]),
  );
  // 80 SF of wall, 30 of it stone tapped on top: 50 stucco, 30 stone.
  near(q.bands[0].grossSquareFeet, 50, "stucco less the stone over it");
  near(q.bands[0].overlapSquareFeet, 30, "what it gave up");
  near(q.bands[1].grossSquareFeet, 30, "stone");
  near(q.grossSquareFeet, 80, "the wall once");
  near(q.wallSquareFeet + q.gableSquareFeet, 80, "wall and gable still the whole");
});

test("a window across the top of a stone wainscot comes out once", () => {
  // Window 3 wide, 1 to 4 ft up; the stone over the stucco runs to 3 ft. 2 ft of it is in the stone, 1 ft above in stucco.
  const q = x.sideQuantities(
    shapedSide([
      ["stucco", [[0, 0], [10, 0], [10, 8], [0, 8]]],
      ["stone", [[0, 0], [10, 0], [10, 3], [0, 3]]],
    ], { openings: [{ id: "w1", kind: "window", fromLeftFeet: 2, widthFeet: 3, sillFeet: 1, heightFeet: 3 }] }),
  );
  near(q.bands[0].openingSquareFeet, 3, "out of the stucco: only the part above the stone");
  near(q.bands[1].openingSquareFeet, 6, "out of the stone");
  near(q.netSquareFeet, 80 - 9, "the wall less the window once");
});

test("an overlap with an L-shaped face is worked exactly", () => {
  // L of 64 SF; a 6 x 4 stone patch over its corner shares 2 x 6 + 2 x 2 = 16 SF with it.
  const q = x.sideQuantities(
    shapedSide([
      ["stucco", [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]],
      ["stone", [[2, 2], [8, 2], [8, 6], [2, 6]]],
    ]),
  );
  near(q.bands[0].overlapSquareFeet, 16, "the shared part");
  near(q.bands[0].grossSquareFeet, 48, "stucco");
  near(q.bands[1].grossSquareFeet, 24, "stone");
});

test("shapes that only share an edge share no area", () => {
  const q = x.sideQuantities(
    shapedSide([
      ["stucco", [[0, 3], [10, 3], [10, 8], [0, 8]]],
      ["stone", [[0, 0], [10, 0], [10, 3], [0, 3]]],
    ]),
  );
  assert(q.bands.every((b) => !b.overlapSquareFeet), JSON.stringify(q.bands));
  near(q.grossSquareFeet, 80, "50 + 30");
});

test("an overlap on the phone is named on the way in", () => {
  const raw = fixture("scan-exterior-v2-sample.json");
  raw.sides[0].shapes.push({ material: "stone", label: "Stone", closed: true, polygon: [[0, 0.9], [8, 0.9], [8, 1.9], [0, 1.9]], area_m2: 8, openings_m2: 0, net_m2: 8, overlaps: [0] });
  const r = x.parseScanExterior(raw);
  assert(r.notes.some((n) => /Shapes overlap on Front \(86 SF\): each overlap is counted once, as the shape tapped later/.test(n)), r.notes.join(" | "));
  const q = x.sideQuantities(r.exterior.sides[0]);
  // The stucco gives up what the stone covers: 8 m2, less the 0.0125 m2 sliver where the stucco's
  // right edge leans in (8.0 m at the bottom, 7.9 m at 4.9 m up) and the stone hangs past it.
  near(q.bands[0].grossSquareFeet, (40.765 - 7.9875) * M2, "stucco", 0.01);
  near(q.bands[1].grossSquareFeet, 8 * M2, "stone", 0.05);
});

test("the roofline's named points: a lone end is only its own end", () => {
  const raw = fixture("scan-exterior-v2-sample.json");
  // An eave side whose only roofline point is its right end, 0.4 m out and 2 m past the wall.
  raw.sides[0].roofline = [{ kind: "right_end", along_m: 10, up_m: 4, out_m: 0.4 }];
  const r = x.parseScanExterior(raw);
  near(r.exterior.roof.eaveOverhangFeet, 0.4 * M, "eave overhang from the eave side", 1e-9);
  assert(r.notes.some((n) => /past Front's right end/.test(n)) && !r.notes.some((n) => /past Front's left end/.test(n)), r.notes.join(" | "));
});

test("the owner's 14:20 walk of six sides: real gables only, overhangs, and no roof on an open walk", () => {
  // Written before Scan's def1456, so it still carries the rear's 0.8/12 "gable" and the right's 0.06/12.
  const r = x.parseScanExterior(fixture("scan-exterior-v2-walk-1420.json"));
  assert(r.ok, r.error);
  const e = r.exterior;
  assert(e.sides.map((s) => s.name).join() === "Front,Right,Front 2,Right 2,Right 3,Rear", e.sides.map((s) => s.name).join());
  assert(e.sides[1].turn === "inside", "the inside corner after the Right side");
  // The rear's middle point is 0.07 m over its ends and the right's pitch 0.06/12: neither a gable.
  assert(e.sides[5].gable === null && e.sides[5].pitchMeasured === undefined, "no gable on the rear");
  assert(e.sides[1].gable === null && e.sides[1].pitchMeasured === undefined, "none on the right");
  // The pitch from the two real gables: Front 4.001, Right 3 4.636.
  near(x.exteriorPitch(e).value, (4.001 + 4.636) / 2, "4.3/12", 1e-9);
  // Eave sides' roof edges stand out 0.294-0.781 m (median 0.4995); the gables' 0.543-0.68 (0.575).
  near(e.roof.eaveOverhangFeet, 0.4995 * M, "eave overhang", 1e-6);
  near(e.roof.rakeOverhangFeet, 0.575 * M, "rake overhang", 1e-6);
  // The porch and deck roofs: 4.1 m past the Front's left wall, and past both ends of the Right side.
  for (const end of ["Front's left", "Front's right", "Right's left", "Right's right"]) {
    assert(r.notes.some((n) => n.includes(`past ${end} end`)), `missing ${end}: ${r.notes.join(" | ")}`);
  }
  assert(!r.notes.some((n) => /past (Front 2|Right 2|Right 3|Rear)'s/.test(n)), "the other sides' ends are ordinary overhangs");
  // Six sides that happen to add up to four corners are still not the house: no footprint, no roof.
  const q = x.exteriorQuantities(e);
  assert(!q.footprint.closes && /did not go all the way round/.test(q.footprint.reason), q.footprint.reason);
  assert(q.roof === null, "no roof on an open walk");
  // Every side agrees with Scan's own figure but the two with garage doors. Each door runs below the
  // stucco's bottom edge (sill 0.126 m, stucco from 0.26 m): Scan took the whole door out, Scrivn only
  // the part that is stucco - 0.38 and 0.31 m2 more, with the stucco's sloping bottom edge.
  assert(r.notes.some((n) => /different areas for Right 2 \(Scan 35 SF, Scrivn 40 SF\); Right 3 \(Scan 59 SF, Scrivn 63 SF\)\. Scrivn takes out/.test(n)), r.notes.join(" | "));
  near(x.sideQuantities(e.sides[5]).netSquareFeet, 77.19 * M2, "the rear's stucco (Scan's to 0.01 m2)", 0.11);
  const garage = x.sideQuantities(e.sides[3]);
  near(garage.openingSquareFeet, garage.grossSquareFeet - garage.netSquareFeet, "the door's stucco part only", 1e-9);
  assert(garage.openingSquareFeet < 6.732 * M2 - 4, "less than the whole door");
});

test("siding elevations only: an empty roofline leaves the overhangs at their defaults", () => {
  // The owner, 10-12: Scan captures siding elevations only for now (its 60ac337), roofline [].
  const raw = fixture("scan-exterior-v2-sample.json");
  raw.sides[0].roofline = [];
  const r = x.parseScanExterior(raw);
  assert(r.ok, r.error);
  near(r.exterior.roof.eaveOverhangFeet, 16 / 12, "eave default");
  near(r.exterior.roof.rakeOverhangFeet, 1, "rake default");
  assert(r.exterior.sides[0].roofline === undefined, "no roofline kept");
  assert(!r.notes.some((n) => /roofline|past Front/.test(n)), r.notes.join(" | "));
  // The gable still comes from the stucco shape's peak, and its pitch.
  assert(r.exterior.sides[0].gable !== null, "the gable from the shape");
  near(x.sideQuantities(r.exterior.sides[0]).pitchFromGable, 4.304, "its pitch", 1e-9);
});

test("once the estimator works on an open walk, the footprint is tried", () => {
  const e = x.parseScanExterior(fixture("scan-exterior-v2-walk-1420.json")).exterior;
  e.source.edited = true;
  assert(!/did not go all the way round/.test(x.exteriorFootprint(e).reason ?? ""), "tried once it is the estimator's");
});

test("a side's shapes set aside by hand fall back to its band", () => {
  const side = x.parseScanExterior(fixture("scan-exterior-v2-sample.json")).exterior.sides[0];
  const bands = { ...side, shapes: undefined };
  assert(bands.bands.length === 1 && bands.bands[0].kind === "stucco", "one band of the main cladding");
  assert(x.sideQuantities(bands).complete, "and it measures");
});

console.log("\nthe sides' photos (Scan 0.1.151)");

test("each side's photos are kept: number, camera, to_photo, what is in view, and the scan to fetch them by", () => {
  const r = x.parseScanExterior(fixture("scan-exterior-v2-photos.json"), { scanId: "scan-9" });
  assert(r.ok, r.error);
  const photos = r.exterior.sides[0].photos;
  // Four sent: a matrix one short and a number outside Scan's 900s are passed over.
  assert(photos.length === 2 && photos.map((p) => p.n).join() === "900,901", JSON.stringify(photos?.map((p) => p.n)));
  const [square] = photos;
  assert(square.scanId === "scan-9", "the scan it came with");
  assert(square.camera.width === 1080 && square.camera.height === 1920 && square.camera.fx === 1500 && square.camera.cy === 960, JSON.stringify(square.camera));
  assert(square.toPhoto.join() === "300,0,-660,0,-300,1410,0,0,1", square.toPhoto.join());
  assert(square.inView.fromM === 2.2 && square.inView.toM === 5.8 && !square.inView.leftEnd && !square.inView.rightEnd && !square.inView.top, JSON.stringify(square.inView));
  assert(photos[1].inView.leftEnd && photos[1].inView.rightEnd && photos[1].inView.top, "the wide one holds the whole side");
  assert(r.notes.some((n) => /1 side was photographed: open a side to see its photo/.test(n)), r.notes.join(" | "));
  // Everything else on the side reads as before.
  near(x.sideQuantities(r.exterior.sides[0]).netSquareFeet, 40.015 * M2, "stucco net", 0.05);
});

test("a file brings no photos: they are kept against the side, with no scan, and it says so", () => {
  const r = x.parseScanExterior(fixture("scan-exterior-v2-photos.json"));
  assert(r.exterior.sides[0].photos.every((p) => p.scanId === null), "no scan to fetch them from");
  assert(r.notes.some((n) => /a file brings no photos: send the scan from the phone/.test(n)), r.notes.join(" | "));
  const none = x.parseScanExterior(fixture("scan-exterior-v2-sample.json"), { scanId: "s" });
  assert(none.exterior.sides[0].photos === undefined && !none.notes.some((n) => /photographed/.test(n)), "a side with none has none");
});

/**
 * A pinhole camera, worked independently of the code under test. The wall is the plane y = 0, x
 * along it from its left end, z up; the camera stands outside (y < 0) looking +y, turned `yaw` to
 * the right and tipped `pitch` up. Its to_photo is built the way Scan's SidePhoto.homography builds
 * it: K times the camera's rows against (along, up, 1), divided through by its last entry.
 */
function camera({ at, yaw = 0, pitch = 0, width, height, f, cx = width / 2, cy = height / 2 }) {
  const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const right = [Math.cos(yaw), -Math.sin(yaw), 0];
  const down = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const q = [-at[0], -at[1], -at[2]];
  const m = [right, down, fwd].map((r) => [r[0], r[2], dot(r, q)]);
  const K = [[f, 0, cx], [0, f, cy], [0, 0, 1]];
  const H = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H.push(K[i][0] * m[0][j] + K[i][1] * m[1][j] + K[i][2] * m[2][j]);
  const toPhoto = H.map((v) => v / H[8]);
  /** Where the wall point (a, u) is seen, straight through the pinhole; null behind the camera. */
  const see = (a, u) => {
    const p = [a - at[0], -at[1], u - at[2]];
    const z = dot(fwd, p);
    return z <= 0 ? null : { x: (f * dot(right, p)) / z + cx, y: (f * dot(down, p)) / z + cy };
  };
  /** The wall point a pixel's ray meets, or null. */
  const ray = (px, py) => {
    const d = [0, 1, 2].map((k) => right[k] * ((px - cx) / f) + down[k] * ((py - cy) / f) + fwd[k]);
    const t = -at[1] / d[1];
    return t > 0 ? { a: at[0] + t * d[0], u: at[2] + t * d[2] } : null;
  };
  return { photo: { n: 900, scanId: "s", camera: { width, height, fx: f, fy: f, cx, cy }, toPhoto, inView: null }, see, ray };
}

/** A photo of a painted wall through [cam]: a red window 2-3 m along and 1.0-2.2 m up on grey stucco, sky over 4 m. */
function shoot(cam, width, height, scale = 1) {
  const W = Math.round(width * scale);
  const Hh = Math.round(height * scale);
  const data = new Uint8Array(W * Hh * 3);
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) {
      const p = cam.ray((i + 0.5) / scale, (j + 0.5) / scale);
      const c = !p || p.u > 4 ? [120, 170, 230] : p.a >= 2 && p.a <= 3 && p.u >= 1 && p.u <= 2.2 ? [220, 30, 30] : [180, 180, 180];
      data.set(c, (j * W + i) * 3);
    }
  }
  return { data, width: W, height: Hh, channels: 3 };
}

const oblique = () => camera({ at: [1.5, -5, 1.6], yaw: 0.45, pitch: 0.12, width: 400, height: 300, f: 330 });

test("to_photo puts a wall point where the pinhole does, Scan's square-on numbers included", () => {
  // Scan's own SidePhotoTest: 6 m along and 3 m up lands at (1140, 510).
  const scan = x.projectToPhoto({ toPhoto: [300, 0, -660, 0, -300, 1410, 0, 0, 1] }, 6, 3);
  near(scan.x, 1140, "x", 1e-9);
  near(scan.y, 510, "y", 1e-9);
  const cam = oblique();
  for (const [a, u] of [[0, 0], [2, 1], [3, 2.2], [5.5, 3.7], [7.9, 0.4]]) {
    const want = cam.see(a, u);
    const got = x.projectToPhoto(cam.photo, a, u);
    near(got.x, want.x, `x of (${a}, ${u})`, 1e-6);
    near(got.y, want.y, `y of (${a}, ${u})`, 1e-6);
  }
});

test("run backwards, it finds the wall point a pixel shows; behind the camera is nothing", () => {
  const cam = oblique();
  for (const [a, u] of [[1, 1], [2.5, 1.6], [4, 3]]) {
    const p = cam.see(a, u);
    const back = x.photoToElevation(cam.photo, p.x, p.y);
    near(back.alongM, a, "along", 1e-6);
    near(back.upM, u, "up", 1e-6);
  }
  // Turned 0.45 rad right from 1.5 m along, 5 m out: the wall 12 m to the left is behind it.
  assert(cam.see(-12, 1) === null && x.projectToPhoto(cam.photo, -12, 1) === null, "behind the camera");
  // A pixel aimed above the wall's horizon never meets it in front.
  const up = camera({ at: [4, -5, 1.6], pitch: 1.2, width: 400, height: 300, f: 330 });
  assert(up.ray(200, 0) === null && x.photoToElevation(up.photo, 200, 0) === null, "above the horizon");
  const inv = x.invert3(cam.photo.toPhoto);
  const id = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => [0, 1, 2].reduce((s, k) => s + cam.photo.toPhoto[i * 3 + k] * inv[k * 3 + j], 0)));
  id.forEach((v, k) => near(v, k % 4 === 0 ? 1 : 0, `identity ${k}`, 1e-9));
});

/** The first column, left to right along a row, whose pixel is red. */
function firstRed(rgba, frame, upM) {
  const j = Math.round(x.frameY(frame, upM) - 0.5);
  for (let i = 0; i < frame.width; i++) {
    const o = (j * frame.width + i) * 4;
    if (rgba[o + 3] && rgba[o] > 150 && rgba[o + 1] < 110) return i;
  }
  return -1;
}
function lastRed(rgba, frame, upM) {
  const j = Math.round(x.frameY(frame, upM) - 0.5);
  for (let i = frame.width - 1; i >= 0; i--) {
    const o = (j * frame.width + i) * 4;
    if (rgba[o + 3] && rgba[o] > 150 && rgba[o + 1] < 110) return i;
  }
  return -1;
}

test("squared up, an oblique photo puts the window where it is on the wall, to the pixel", () => {
  const cam = oblique();
  const frame = { alongMinM: 0, alongMaxM: 6, upMinM: 0, upMaxM: 4, ppm: 50, width: 300, height: 200 };
  const rgba = x.squareUp([{ photo: cam.photo, pixels: shoot(cam, 400, 300) }], frame);
  // The window runs 2-3 m along: columns 100 to 149 at 50 px a metre.
  for (const up of [1.2, 1.6, 2.0]) {
    assert(Math.abs(firstRed(rgba, frame, up) - 100) <= 1, `left edge at ${up} m: ${firstRed(rgba, frame, up)}`);
    assert(Math.abs(lastRed(rgba, frame, up) - 149) <= 1, `right edge at ${up} m: ${lastRed(rgba, frame, up)}`);
  }
  // Its sill 1.0 m and head 2.2 m: rows 150 and 90 from the top (4 m).
  const col = Math.round(x.frameX(frame, 2.5));
  const rows = [];
  for (let j = 0; j < frame.height; j++) if (rgba[(j * frame.width + col) * 4] > 150 && rgba[(j * frame.width + col) * 4 + 1] < 110) rows.push(j);
  assert(Math.abs(rows[0] - 90) <= 1 && Math.abs(rows[rows.length - 1] - 149) <= 1, `rows ${rows[0]}-${rows[rows.length - 1]}`);
});

test("a photo stored smaller than its camera is read where it now is", () => {
  const cam = oblique();
  const frame = { alongMinM: 0, alongMaxM: 6, upMinM: 0, upMaxM: 4, ppm: 50, width: 300, height: 200 };
  const rgba = x.squareUp([{ photo: cam.photo, pixels: shoot(cam, 400, 300, 0.5) }], frame);
  assert(Math.abs(firstRed(rgba, frame, 1.6) - 100) <= 2 && Math.abs(lastRed(rgba, frame, 1.6) - 149) <= 2, `${firstRed(rgba, frame, 1.6)}-${lastRed(rgba, frame, 1.6)}`);
});

test("two stills side by side make one image; what neither shows is left clear", () => {
  const left = camera({ at: [1.5, -3, 1.6], width: 300, height: 300, f: 200 });
  const right = camera({ at: [4.5, -3, 1.6], width: 300, height: 300, f: 200 });
  const frame = { alongMinM: -3, alongMaxM: 9, upMinM: 0, upMaxM: 4, ppm: 25, width: 300, height: 100 };
  const rgba = x.squareUp(
    [
      { photo: left.photo, pixels: shoot(left, 300, 300) },
      { photo: right.photo, pixels: shoot(right, 300, 300) },
    ],
    frame,
  );
  // Each sees 2.25 m either side of where it stands: -0.75 to 3.75 and 2.25 to 6.75 m along.
  const alpha = (a, u) => rgba[(Math.round(x.frameY(frame, u) - 0.5) * frame.width + Math.round(x.frameX(frame, a) - 0.5)) * 4 + 3];
  assert(alpha(0, 2) === 255 && alpha(6.5, 2) === 255, "each half from its own still");
  assert(alpha(-2, 2) === 0 && alpha(8.5, 2) === 0, "past both, clear");
  assert(Math.abs(firstRed(rgba, frame, 1.6) - x.frameX(frame, 2)) <= 1.5 && Math.abs(lastRed(rgba, frame, 1.6) + 1 - x.frameX(frame, 3)) <= 1.5, "the window where it is");
  const filled = x.fillOutside(rgba);
  assert(filled[(50 * 300 + 5) * 4] === x.OUTSIDE_PHOTO_GREY && filled[(50 * 300 + 5) * 4 + 3] === 255, "grey for a JPEG");
});

test("the squared image: the side and a margin, cut to what the photo holds, its long edge 2400 px", () => {
  const side = x.parseScanExterior(fixture("scan-exterior-v2-photos.json"), { scanId: "s" }).exterior.sides[0];
  const [narrow, wide] = side.photos;
  // The wide still holds all of it: the shapes run -2.8 to 8 m along and 0.9 to 6.4 m up.
  const f = x.squareFrame(side, [wide]);
  assert(Math.max(f.width, f.height) === 2400, `${f.width}x${f.height}`);
  near(f.ppm, 2400 / (f.alongMaxM - f.alongMinM), "one scale", 1e-9);
  assert(f.alongMinM <= -2.8 && f.alongMaxM >= 8 && f.upMinM <= 0 && f.upMaxM >= 6.4, JSON.stringify(f));
  assert(f.alongMinM >= -2.8 - 2.5 - 1e-9 && f.upMaxM <= 6.4 + 4 + 1e-9, "no more than the margin (4 m above since 10-15: the roof over the side)");
  // Scan's square-on still from 5 m: 540 and 960 px either side of its middle at 1500 px focal hold
  // 2.2 to 5.8 m along (its in_view) and 1.5 +/- 3.2 m up - the gable's top out of it, as Scan says.
  const g = x.squareFrame(side, [narrow]);
  near(g.alongMinM, 2.2, "its left edge", 1e-6);
  near(g.alongMaxM, 5.8, "its right edge", 1e-6);
  near(g.upMaxM, 4.7, "its top", 1e-6);
  near(g.upMinM, -0.6, "and the margin below the side, not the photo's foot at -1.7 m", 1e-6);
});

console.log("\nthe AI trace");

/** A trace answer in pixels of a frame at 100 px a metre, its left edge 1 m left of the side and its top 6 m up. */
const traceFrame = { alongMinM: -1, alongMaxM: 9, upMinM: -0.5, upMaxM: 6, ppm: 100, width: 1000, height: 650 };
const wire = {
  materials: [
    // Stucco from 0.5 m up to the eaves at 3 m and a peak 4.5 m up at 4 m along: x = 100 + 100 a, y = 600 - 100 u.
    { material: "stucco", polygon: [[100, 550], [900, 550], [900, 300], [500, 150], [100, 300]], partly_hidden_by: "" },
    { material: "parging", polygon: [[100, 600], [900, 600], [900, 550], [100, 550]], partly_hidden_by: "AC unit" },
    { material: "cedar", polygon: [[100, 300], [200, 300]], partly_hidden_by: "" },
  ],
  openings: [
    { kind: "window", left: 250, right: 350, top: 380, bottom: 470, measured_to: "outer_trim", partly_hidden_by: "" },
    { kind: "garage_door", left: 520, right: 790, top: 340, bottom: 600, measured_to: "door_itself", partly_hidden_by: "" },
    { kind: "patio_door", left: 120, right: 200, top: 340, bottom: 550, measured_to: "frame", partly_hidden_by: "" },
  ],
  wall_top: [[100, 300], [500, 150], [900, 300]],
  off_wall: [{ what: "AC unit", box: [700, 520, 800, 600] }],
  notes: "The parging is partly behind the AC unit.",
};

test("the trace's pixels become the side's feet, and each kind what Scrivn calls it", () => {
  const p = x.traceProposals(wire, traceFrame, 8 * M);
  assert(p.shapes.length === 2, "the two-corner 'shape' is dropped");
  const [stucco, parging] = p.shapes;
  assert(stucco.kind === "stucco" && parging.kind === "parging" && parging.hiddenBy === "AC unit", JSON.stringify(p.shapes.map((s) => s.kind)));
  // 8 x 2.5 m of wall and a 8 x 1.5 / 2 m gable: 26 m2.
  near(stucco.squareFeet, 26 * M2, "stucco gross", 1e-6);
  near(stucco.polygon[3].x, 4 * M, "the peak along", 1e-9);
  near(stucco.polygon[3].y, 4.5 * M, "and up", 1e-9);
  const [win, garage, patio] = p.openings;
  assert(win.kind === "window" && garage.kind === "garage" && patio.kind === "door", p.openings.map((o) => o.kind).join());
  near(win.fromLeftFeet, 1.5 * M, "window from the left", 1e-9);
  near(win.widthFeet, 1 * M, "width", 1e-9);
  near(win.sillFeet, 1.3 * M, "sill", 1e-9);
  near(win.heightFeet, 0.9 * M, "height", 1e-9);
  near(garage.sillFeet, 0, "the garage door from the level");
  near(garage.widthFeet, 2.7 * M, "the door itself, 2.7 m", 1e-9);
  assert(p.offWall.length === 1 && p.offWall[0].what === "AC unit", "the AC in front");
  near(p.offWall[0].x0, 6 * M, "its box", 1e-9);
  assert(p.notes === wire.notes, "the trace's notes");
  // A basement window wholly under the level (y 620-640: 0.2-0.4 m below it) is left out, and said.
  const basement = x.traceProposals({ ...wire, openings: [...wire.openings, { kind: "window", left: 300, right: 450, top: 620, bottom: 640, measured_to: "frame", partly_hidden_by: "" }] }, traceFrame, 8 * M);
  assert(basement.openings.length === 3 && basement.checks.some((c) => /^A window lies below the side's level.*left out/.test(c)), basement.checks.join(" | "));
});

test("the wall top gives the eaves, the peak and both slopes - and says when the slopes disagree", () => {
  const p = x.traceProposals(wire, traceFrame, 8 * M);
  near(p.wallTop.eaveLeftFeet, 3 * M, "left eave", 1e-9);
  near(p.wallTop.eaveRightFeet, 3 * M, "right eave", 1e-9);
  near(p.wallTop.peak.peakFeet, 4.5 * M, "peak", 1e-9);
  near(p.wallTop.peak.atFeet, 4 * M, "at", 1e-9);
  // 1.5 m over 4 m: 4.5 in 12 each way. Whether they agree is the roof read's to say (10-15).
  near(p.wallTop.slopes[0], 4.5, "left slope", 1e-9);
  near(p.wallTop.slopes[1], 4.5, "right slope", 1e-9);
  // 4.5 is no whole pitch: said, and not ticked to start with.
  assert(p.roof.checks.some((c) => /slopes read 4\.5 and 4\.5 on 12, 4\.5 between them: .*between 4\/12 and 5\/12/.test(c)), p.roof.checks.join(" | "));
  assert(p.roof.pitch.agree && !p.roof.pitch.onWhole && x.roofPicksAtFirst(p.roof).pitch === false, JSON.stringify(p.roof.pitch));
  const lopsided = x.traceProposals({ ...wire, wall_top: [[100, 300], [500, 150], [900, 260]] }, traceFrame, 8 * M);
  assert(lopsided.roof.checks.some((c) => /two slopes read 4\.5 and 3\.3 on 12/.test(c)), lopsided.roof.checks.join(" | "));
  const leaning = x.traceProposals({ ...wire, wall_top: [[100, 300], [900, 280]] }, traceFrame, 8 * M);
  assert(leaning.wallTop.peak === null && leaning.checks.some((c) => /wall top reads 0'8" higher at the right end/.test(c)), leaning.checks.join(" | "));
});

test("ticked proposals go on the side; what is not ticked stays as the phone tapped it", () => {
  const side = x.parseScanExterior(fixture("scan-exterior-v2-photos.json"), { scanId: "s" }).exterior.sides[0];
  const p = x.traceProposals(wire, traceFrame, side.lengthFeet);
  const all = x.applyTrace(side, p, {
    shapes: p.shapes.map((s) => ({ key: s.key, kind: s.kind })),
    openings: [{ key: p.openings[0].key, kind: "window" }, { key: p.openings[1].key, kind: "garage" }],
    wallTop: true,
    // The pitch is its own tick since 10-15 (4.5 starts unticked: no whole pitch), ticked here.
    roof: { ...x.roofPicksAtFirst(p.roof), pitch: true },
  });
  assert(all.shapes.length === 2 && all.shapes.every((s) => s.closed && s.id), "the two shapes, closed");
  assert(all.openings.length === 2 && all.openings[1].kind === "garage", "two openings");
  near(all.eaveLeftFeet, 3 * M, "eave", 1e-9);
  near(all.gable.peakFeet, 4.5 * M, "peak", 1e-9);
  near(all.pitchMeasured, 4.5, "the pitch from the slopes", 1e-9);
  assert(all.roofRead.pitch === 4.5 && Math.abs(all.roofRead.slopes[0] - 4.5) < 1e-9 && Math.abs(all.roofRead.slopes[1] - 4.5) < 1e-9, JSON.stringify(all.roofRead));
  assert(all.photos === side.photos, "the photos stay with the side");
  const q = x.sideQuantities(all);
  // 26 m2 of stucco less the window (1 x 0.9) and the garage door's stucco part (2.7 x 2.6 m from 0.5 m up).
  near(q.netSquareFeet, (26 - 0.9 - 2.7 * 2.1) * M2, "priced from the trace", 1e-6);
  // Only a material changed and the openings left alone.
  const some = x.applyTrace(side, p, { shapes: [{ key: p.shapes[0].key, kind: "vinyl" }], openings: [], wallTop: false });
  assert(some.shapes.length === 1 && some.shapes[0].kind === "vinyl", "vinyl, as changed");
  assert(some.openings === side.openings && some.eaveLeftFeet === side.eaveLeftFeet && some.gable === side.gable, "the rest untouched");
});

test("the call is told the frame in its own pixels, and priced at Opus 5.5's rate", () => {
  const msg = x.traceUserMessage(traceFrame, { name: "Front", lengthM: 8, bottomLeftM: 0.5, bottomRightM: 0.5, leftEndInPhoto: true, rightEndInPhoto: false });
  assert(msg.includes("1000x650 pixels") && msg.includes("100.0 pixels per metre"), msg.slice(0, 200));
  assert(msg.includes("its left end is at x = 100") && msg.includes("its right end should be at x = 900, but may be outside the photo"), msg.slice(0, 400));
  assert(msg.includes("[100, 550] and [900, 550]"), "the bottom corners");
  assert(/never the trim, jamb or stucco surround/.test(msg), "the garage door rule from the owner's test");
  // 6,000 in at $4 and 1,500 out at $20 a million.
  near(x.traceCostUsd({ inputTokens: 6000, outputTokens: 1500, cacheCreationTokens: 0, cacheReadTokens: 0 }), 0.054, "cost", 1e-12);
  assert(/rake_left, rake_right: on a gable, the bottom edge of the fascia/.test(msg) && /never the eavestrough's end cap/.test(msg), "the roof's edge asked for, fascia not trough");
});

console.log("\nthe roof read off a photo (10-15)");

/**
 * Where a point standing [out] m in front of the wall shows on the wall's plane in [cam]'s photo: through
 * the pinhole into the picture, and back onto the wall through to_photo - the squared image's own sum,
 * not the swelling the code undoes.
 */
function seenOnWall(cam, a, u, out) {
  const { fx, cx, cy } = cam.photo.camera;
  const right = [Math.cos(cam.yaw), -Math.sin(cam.yaw), 0];
  const fwd = [Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch)];
  const down = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const p = [a - cam.at[0], -out - cam.at[1], u - cam.at[2]];
  const z = dot(fwd, p);
  const px = (fx * dot(right, p)) / z + cx;
  const py = (fx * dot(down, p)) / z + cy;
  const w = x.photoToElevation(cam.photo, px, py);
  return { alongM: w.alongM, upM: w.upM };
}
const phone = (o) => ({ ...camera(o), at: o.at, yaw: o.yaw ?? 0, pitch: o.pitch ?? 0 });

/** The owner's gable, as measured: 24'4" wide, eaves 3 m, 5/12 to a peak in the middle; rakes 22" out, eaves 24". */
const G = { L: 7.417, eave: 3.0, pitch: 5, rake: 0.5588, eaveOut: 0.6096 };
G.peakAt = G.L / 2;
G.peak = G.eave + (G.peakAt * G.pitch) / 12;
/** The wall top (soffit meets wall) at a along, carried on past the corners. */
const gTop = (a) => G.peak - (Math.abs(a - G.peakAt) * G.pitch) / 12;
const roofFrame = { alongMinM: -3, alongMaxM: 10.5, upMinM: -0.6, upMaxM: 7, ppm: 150, width: 2025, height: 1140 };
const px = (p) => [x.frameX(roofFrame, p.alongM), x.frameY(roofFrame, p.upM)];

/** What a perfect trace of the gable answers, seen through [cams] as the squared image shows it: each point from the photo the image takes it from. */
function gableWire(cams, { lopsided = 0 } = {}) {
  const photos = cams.map((c) => c.photo);
  /** Every place the squared image shows a point: through each phone, kept where the image is that phone's. */
  const shown = (a, u, out) =>
    cams.flatMap((c, k) => {
      const s = seenOnWall(c, a, u, out);
      return x.photoIndexAt(photos, s.alongM, s.upM) === k ? [s] : [];
    });
  const rake = (from, to) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = from + ((to - from) * i) / 8;
      pts.push(...shown(a, gTop(a), G.rake));
    }
    return pts.sort((p, q) => p.alongM - q.alongM).map(px);
  };
  const foot = (a) => shown(a, gTop(a), G.rake)[0];
  return {
    materials: [],
    openings: [],
    wall_top: [
      [x.frameX(roofFrame, 0), x.frameY(roofFrame, G.eave)],
      [x.frameX(roofFrame, G.peakAt), x.frameY(roofFrame, G.peak)],
      [x.frameX(roofFrame, G.L), x.frameY(roofFrame, G.eave - lopsided)],
    ],
    off_wall: [],
    roof: {
      over_wall: "gable",
      rake_left: rake(-G.eaveOut, G.peakAt),
      rake_right: rake(G.peakAt, G.L + G.eaveOut),
      eave_line: [],
      left_end: { kind: "rake_foot", point: px(foot(-G.eaveOut)) },
      right_end: { kind: "rake_foot", point: px(foot(G.L + G.eaveOut)) },
      notes: "",
    },
    notes: "",
  };
}

test("where the phone stood comes back out of to_photo: Scan's two fixture photos, and a tape-scaled one", () => {
  const side = x.parseScanExterior(fixture("scan-exterior-v2-photos.json"), { scanId: "s" }).exterior.sides[0];
  // Scan sent each photo's position: (4, -5, 1.5) square-on, and (4, -7, 1.6) tipped up; the wall is the plane y = 0.
  const [a, b] = side.photos.map((p) => x.wallCamera(p));
  near(a.alongM, 4, "square-on: along", 1e-6);
  near(a.upM, 1.5, "up", 1e-6);
  near(a.distanceM, 5, "out", 1e-6);
  near(b.alongM, 4, "tipped up: along", 1e-3);
  near(b.upM, 1.6, "up", 1e-3);
  near(b.distanceM, 7, "out", 1e-3);
  // Not a camera's matrix: the fixture's broken photo has none.
  assert(x.wallCamera({ toPhoto: [1, 0, 0, 0, 2, 0, 0, 0, 1], camera: { width: 10, height: 10, fx: 5, fy: 5, cx: 5, cy: 5 } }) === null, "a stretched matrix is no camera");
  // A taped side: the elevation is 1.1 x the phone's metres, and so is where the phone stood.
  const c = phone({ at: [2.6, -6.5, 1.5], yaw: 0.05, pitch: 0.15, width: 1920, height: 1080, f: 1100 });
  const s = 1.1;
  const taped = { ...c.photo, toPhoto: [...c.photo.toPhoto] };
  for (const r of [0, 3, 6]) {
    taped.toPhoto[r] /= s;
    taped.toPhoto[r + 1] /= s;
  }
  const t = x.wallCamera(taped);
  near(t.alongM, 2.6 * s, "taped: along", 1e-6);
  near(t.upM, 1.5 * s, "up", 1e-6);
  near(t.distanceM, 6.5 * s, "out", 1e-6);
});

test("which photo the squared image shows at a point is the one squareUp read there", () => {
  const left = camera({ at: [1.5, -3, 1.6], width: 300, height: 300, f: 200 });
  const right = camera({ at: [4.5, -3, 1.6], width: 300, height: 300, f: 200 });
  const frame = { alongMinM: -3, alongMaxM: 9, upMinM: 0, upMaxM: 4, ppm: 25, width: 300, height: 100 };
  // Each painted its own colour: the squared image says which it read at every pixel.
  const flat = (rgb) => ({ data: new Uint8Array(300 * 300 * 3).map((_, i) => rgb[i % 3]), width: 300, height: 300, channels: 3 });
  const rgba = x.squareUp([{ photo: left.photo, pixels: flat([250, 0, 0]) }, { photo: right.photo, pixels: flat([0, 0, 250]) }], frame);
  let checked = 0;
  for (let j = 2; j < frame.height; j += 7) {
    for (let i = 2; i < frame.width; i += 7) {
      const o = (j * frame.width + i) * 4;
      const k = x.photoIndexAt([left.photo, right.photo], x.frameAlongM(frame, i + 0.5), x.frameUpM(frame, j + 0.5));
      const want = rgba[o + 3] === 0 ? -1 : rgba[o] > 128 ? 0 : 1;
      assert(k === want, `pixel ${i},${j}: image read ${want}, photoIndexAt says ${k}`);
      checked++;
    }
  }
  assert(checked > 500, `${checked} pixels`);
});

test("a gable's slopes over their whole run; a pitch framed to the whole one within 1/4", () => {
  // Points on the way up and a level stretch past the eave corner (the wall top running on over a wing).
  const line = [{ x: -3, y: 10 }, { x: 0, y: 10 }, { x: 4, y: 11.667 }, { x: 8, y: 13.333 }, { x: 12, y: 15 }, { x: 18, y: 12.5 }, { x: 24, y: 10 }];
  const [l, r] = x.gableSlopes(line, 4);
  near(l, 5, "left: 5 ft over 12, not the level bit", 1e-3);
  near(r, 5, "right", 1e-3);
  assert(x.gableSlopes(line, 0) === null && x.gableSlopes(line, 6) === null, "a peak at an end is no gable");
  assert(x.framedPitch(5.08) === 5 && x.framedPitch(4.8) === 5 && x.framedPitch(4.6) === 4.6 && x.framedPitch(4.5) === 4.5, "framed");
});

test("the owner's gable square-on: 5/12, the rakes 22\" out and the eaves 24\", read back to the inch", () => {
  const cam = phone({ at: [2.6, -6.5, 1.5], yaw: 0.05, pitch: 0.15, width: 1920, height: 1080, f: 1100 });
  const w = gableWire([cam]);
  const p = x.traceProposals(w, roofFrame, G.L * M, x.camerasAt([cam.photo]));
  const r = p.roof;
  assert(r.over === "gable", r.over);
  near(r.pitch.slopes[0], 5, "left slope", 0.02);
  near(r.pitch.slopes[1], 5, "right slope", 0.02);
  assert(r.pitch.value === 5 && r.pitch.agree, JSON.stringify(r.pitch));
  // The fascia keeps the slope however far out it is.
  near(r.pitch.fascia[0], 5, "the fascia's left slope", 0.05);
  near(r.pitch.fascia[1], 5, "and right", 0.05);
  near(r.rakeOverhang.feet / M, G.rake, "rake overhang, metres", 0.004);
  assert(r.rakeOverhang.agree, "both rakes alike");
  near(r.eaveOverhang.left / M, G.eaveOut, "eave overhang at the left foot", 0.004);
  near(r.eaveOverhang.right / M, G.eaveOut, "and the right", 0.004);
  assert(r.eaveOverhang.from === "rake_foot" && r.eaveOverhang.agree, JSON.stringify(r.eaveOverhang));
  // Read as if the fascia were on the wall, the rake would be nothing: the swelling is what is measured.
  const flat = x.traceProposals(w, roofFrame, G.L * M, () => ({ alongM: 0, upM: 0, distanceM: 1e9 }));
  assert(flat.roof.rakeOverhang === null || flat.roof.rakeOverhang.feet < 0.05, "no phone, no swelling");
  // Without where the phone stood, only the pitch.
  const blind = x.traceProposals(w, roofFrame, G.L * M);
  assert(blind.roof.pitch.value === 5 && blind.roof.rakeOverhang === null && blind.roof.eaveOverhang === null, "the pitch alone");
  assert(blind.roof.checks.some((c) => /phone stood .* isn't known/.test(c)), blind.roof.checks.join(" | "));
});

test("the gable from two photos side by side: each fascia point read through the phone it came from", () => {
  const left = phone({ at: [1.2, -4.5, 1.5], yaw: -0.05, pitch: 0.3, width: 1080, height: 1440, f: 800 });
  const right = phone({ at: [6.3, -4.5, 1.5], yaw: 0.05, pitch: 0.3, width: 1080, height: 1440, f: 800 });
  const w = gableWire([left, right]);
  const r = x.traceProposals(w, roofFrame, G.L * M, x.camerasAt([left.photo, right.photo])).roof;
  near(r.rakeOverhang.feet / M, G.rake, "rake overhang", 0.004);
  near(r.eaveOverhang.feet / M, G.eaveOut, "eave overhang", 0.004);
  // Read all through the left phone, the right rake's points would be read wrong.
  const one = x.traceProposals(w, roofFrame, G.L * M, x.camerasAt([left.photo])).roof;
  assert(one.rakeOverhang === null || Math.abs(one.rakeOverhang.perSlope[1] / M - G.rake) > 0.02 || one.rakeOverhang.perSlope[1] === null, JSON.stringify(one.rakeOverhang));
});

test("a photo from the corner: the eave end at 45 degrees, the rake read off the same photo", () => {
  // Standing past the right end, 4 m out and 3 m past, turned back to the corner: the corner shot the card asks for.
  const corner = phone({ at: [G.L + 3, -4, 1.5], yaw: -0.65, pitch: 0.25, width: 1920, height: 1080, f: 1000 });
  const w = gableWire([corner]);
  const r = x.traceProposals(w, roofFrame, G.L * M, x.camerasAt([corner.photo])).roof;
  near(r.rakeOverhang.feet / M, G.rake, "rake overhang", 0.006);
  near(r.eaveOverhang.right / M, G.eaveOut, "eave overhang at the corner photographed", 0.006);
});

test("slopes that disagree are flagged and not ticked; a trace calling a peaked wall an eave is not believed", () => {
  const cam = phone({ at: [2.6, -6.5, 1.5], yaw: 0.05, pitch: 0.15, width: 1920, height: 1080, f: 1100 });
  // The right eave corner 0.35 m low: the right slope reads steeper.
  const p = x.traceProposals(gableWire([cam], { lopsided: 0.35 }), roofFrame, G.L * M, x.camerasAt([cam.photo]));
  assert(!p.roof.pitch.agree && p.roof.checks.some((c) => /two slopes read 5\.0 and 6\.1 on 12/.test(c)), p.roof.checks.join(" | "));
  assert(x.roofPicksAtFirst(p.roof).pitch === false, "not ticked");
  // The fascia, traced true, says the same: the wall top's right corner is the line that is off.
  assert(p.roof.checks.some((c) => /fascia reads 5\.0 and 5\.0 on 12 against the wall top's 5\.0 and 6\.1/.test(c)), p.roof.checks.join(" | "));
  const eave = gableWire([cam]);
  eave.roof.over_wall = "eave";
  const q = x.traceProposals(eave, roofFrame, G.L * M, x.camerasAt([cam.photo]));
  assert(q.roof.over === null && q.roof.pitch === null && q.roof.checks.some((c) => /calls the roof over this side an eave, but the wall top it drew rises to a peak/.test(c)), q.roof.checks.join(" | "));
});

test("a rake's foot traced on the wall's own corner reads no eave, and is flagged, not ticked", () => {
  const cam = phone({ at: [2.6, -6.5, 1.5], yaw: 0.05, pitch: 0.15, width: 1920, height: 1080, f: 1100 });
  const w = gableWire([cam]);
  // Both feet where the fascia's line crosses the wall's corners, as a trace mistaking the corner for the foot would put them.
  w.roof.left_end.point = px(seenOnWall(cam, 0, gTop(0), G.rake));
  w.roof.right_end.point = px(seenOnWall(cam, G.L, gTop(G.L), G.rake));
  const r = x.traceProposals(w, roofFrame, G.L * M, x.camerasAt([cam.photo])).roof;
  assert(r.eaveOverhang.feet < 0.05 && !r.eaveOverhang.agree && x.roofPicksAtFirst(r).eave === false, JSON.stringify(r.eaveOverhang));
  assert(r.checks.some((c) => /under 4" past the wall/.test(c)), r.checks.join(" | "));
});

test("a hip's corner: as far past the wall as out from it - unless seen down its diagonal", () => {
  const L = 10;
  const o = 0.5;
  for (const at of [7, 9, L + 1, 3]) {
    const cam = phone({ at: [at, -6, 1.5], width: 4000, height: 3000, f: 1500 });
    const seen = seenOnWall(cam, L + o, 3, o);
    const r = x.eaveAtHipCorner(x.wallCamera(cam.photo), seen, "right", L);
    near(r.outM, o, `the right corner from ${at} m along`, 1e-6);
    const s2 = seenOnWall(cam, -o, 3, o);
    near(x.eaveAtHipCorner(x.wallCamera(cam.photo), s2, "left", L).outM, o, `the left corner from ${at} m along`, 1e-6);
  }
  // From the corner's diagonal (6 m out, 6 m past the end) every overhang shows in one place.
  const diag = phone({ at: [L + 6, -6, 1.5], yaw: -0.6, width: 4000, height: 3000, f: 1500 });
  const r = x.eaveAtHipCorner(x.wallCamera(diag.photo), seenOnWall(diag, L + o, 3, o), "right", L);
  assert(r.gain > x.HIP_CORNER_GAIN_MAX, `gain ${r.gain}`);
});

test("two slopes seen from one side tell the rake overhang from how far the fascia hangs below the soffit", () => {
  // The phone 2.3 m right of the peak: the left slope's fascia stands 2.9 m higher above it than the right's.
  const cam = phone({ at: [6.0, -5.4, 1.0], yaw: 0.05, pitch: 0.2, width: 3000, height: 2000, f: 1100 });
  const wc = x.wallCamera(cam.photo);
  const hang = 0.04;
  /** The fascia's bottom edge: the wall top carried out to the rake and lowered by the hang, seen through the phone. */
  const edge = (from, to) => Array.from({ length: 7 }, (_, i) => from + ((to - from) * i) / 6).map((a) => seenOnWall(cam, a, gTop(a) - hang, G.rake));
  const at = { alongM: G.peakAt, upM: G.peak };
  const slopes = [
    { at, slope: G.pitch / 12, points: edge(0.2, G.peakAt - 0.4) },
    { at, slope: -G.pitch / 12, points: edge(G.peakAt + 0.4, G.L - 0.2) },
  ];
  const both = x.rakeFromSlopes(slopes, () => wc, true);
  near(both.outM, G.rake, "the rake overhang", 1e-6);
  near(both.hangM, hang, "the hang", 1e-6);
  // Each slope alone, taking the fascia as level with the soffit, reads short - by more on the slope nearer the phone's height.
  assert(both.perSlope[0] < G.rake - 0.02 && both.perSlope[1] < both.perSlope[0] - 0.02, both.perSlope.join());
  // Not asked to (lines Claude drew, not set on the photo), it takes the fascia as level.
  const level = x.rakeFromSlopes(slopes, () => wc, false);
  assert(level.hangM === null && Math.abs(level.outM - (both.perSlope[0] + both.perSlope[1]) / 2) < 1e-9, JSON.stringify(level));
  // From the middle of the gable the two slopes see the hang alike, and can't tell it apart.
  const mid = phone({ at: [G.peakAt, -5.4, 1.0], pitch: 0.2, width: 3000, height: 2000, f: 1100 });
  const edgeMid = (from, to) => Array.from({ length: 7 }, (_, i) => from + ((to - from) * i) / 6).map((a) => seenOnWall(mid, a, gTop(a) - hang, G.rake));
  const centred = x.rakeFromSlopes(
    [
      { at, slope: G.pitch / 12, points: edgeMid(0.2, G.peakAt - 0.4) },
      { at, slope: -G.pitch / 12, points: edgeMid(G.peakAt + 0.4, G.L - 0.2) },
    ],
    () => x.wallCamera(mid.photo),
    true,
  );
  assert(centred.hangM === null, "from the middle, no hang read");
});

test("the eave at a rake's foot leans on the rake read less the nearer the phone stood to that foot", () => {
  const cam = phone({ at: [G.L + 0.2, -6, 1.4], yaw: 0, pitch: 0.2, width: 4000, height: 3000, f: 1500 });
  const wc = x.wallCamera(cam.photo);
  const footL = seenOnWall(cam, -G.eaveOut, G.eave - 0.2, G.rake);
  const footR = seenOnWall(cam, G.L + G.eaveOut, G.eave - 0.2, G.rake);
  near(x.eaveAtRakeFoot(wc, footL, G.rake, "left", G.L), G.eaveOut, "left, the rake right", 1e-9);
  near(x.eaveAtRakeFoot(wc, footR, G.rake, "right", G.L), G.eaveOut, "right", 1e-9);
  // With the rake read 2" long, the far foot reads ~2" out; the near one barely moves.
  const off = 2 * 0.0254;
  const farMoves = Math.abs(x.eaveAtRakeFoot(wc, footL, G.rake + off, "left", G.L) - G.eaveOut);
  const nearMoves = Math.abs(x.eaveAtRakeFoot(wc, footR, G.rake + off, "right", G.L) - G.eaveOut);
  assert(farMoves > 0.04 && nearMoves < 0.005 && farMoves > 10 * nearMoves, `${farMoves} ${nearMoves}`);
  near(x.rakeFootGain(wc, footL), farMoves / off, "the gain says so", 0.02);
});

/**
 * The owner's gable as the squared image shows it from [cam]: stucco up to the wall top, the soffit's
 * underside over it, the fascia's white face [hang] below the soffit out at the rake, sky past it -
 * each squared pixel's ray followed out from the wall, as the photo would show it.
 */
function renderGable(cam, frame, hang, fasciaM = 0.2) {
  const wc = x.wallCamera(cam.photo);
  const data = new Float32Array(frame.width * frame.height);
  const grain = (i, j, amp) => amp * ((((i * 73856093) ^ (j * 19349663)) >>> 0) / 4294967295 - 0.5);
  for (let j = 0; j < frame.height; j++) {
    for (let i = 0; i < frame.width; i++) {
      const p = { alongM: x.frameAlongM(frame, i + 0.5), upM: x.frameUpM(frame, j + 0.5) };
      // Where this pixel's ray is at the fascia's face, and how high that is over the soffit there.
      const f = x.unswell(wc, p, G.rake);
      const overSoffit = f.upM - gTop(f.alongM);
      let v;
      if (f.alongM >= -G.eaveOut && f.alongM <= G.L + G.eaveOut && overSoffit >= -hang && overSoffit <= -hang + fasciaM) v = 225 + grain(i, j, 6);
      else if (overSoffit > -hang) v = 160 + grain(i, j, 4);
      else if (p.upM < gTop(p.alongM)) v = 60 + grain(i, j, 24);
      else v = 95 + grain(i, j, 8);
      data[j * frame.width + i] = v;
    }
  }
  return { data, width: frame.width, height: frame.height };
}

test("Claude's roof lines set on the photo's own edges: the wall top and the fascia it drew 6-12 px off, read back to the inch", () => {
  const cam = phone({ at: [6.0, -5.4, 1.0], yaw: -0.1, pitch: 0.2, width: 4000, height: 2400, f: 1100 });
  const hang = 0.035;
  const g = renderGable(cam, roofFrame, hang);
  // A trace as Claude gives it: the wall top a little low and leaning, the fascia drawn on its face.
  const w = gableWire([cam]);
  const lean = (pts, dy0, dy1) => pts.map((p, i) => [p[0], p[1] + dy0 + ((dy1 - dy0) * i) / Math.max(1, pts.length - 1)]);
  w.wall_top = lean(w.wall_top, 9, 4);
  const fascia = (pts) => pts.map((p) => [p[0], p[1] + x.frameY(roofFrame, 0) - x.frameY(roofFrame, -hang) - 12]);
  w.roof.rake_left = fascia(gableWire([cam]).roof.rake_left);
  w.roof.rake_right = fascia(gableWire([cam]).roof.rake_right);
  const raw = x.traceProposals(w, roofFrame, G.L * M, x.camerasAt([cam.photo]));
  const s = x.snapTrace(raw, roofFrame, g, G.L * M, x.camerasAt([cam.photo]));
  const r = s.roof;
  assert(r.snapped && r.snapped.wallTopInches > 0.2 && r.snapped.fasciaInches > 1, JSON.stringify(r.snapped));
  assert(r.pitch.value === 5 && Math.abs(r.pitch.slopes[0] - 5) < 0.05 && Math.abs(r.pitch.slopes[1] - 5) < 0.05, JSON.stringify(r.pitch));
  near(s.wallTop.peak.peakFeet / M, G.peak, "the peak, snapped", 0.012);
  near(r.rakeOverhang.feet / M, G.rake, "the rake overhang", 0.0127);
  near(r.rakeOverhang.hangFeet / M, hang, "the hang", 0.0127);
  near(r.eaveOverhang.feet / M, G.eaveOut, "the eave overhang", 0.0254);
  assert(r.checks[0].startsWith("The lines were set on the photo's own edges"), r.checks[0]);
  // As Claude drew them, the same lines read the rake inches out.
  assert(Math.abs(raw.roof.rakeOverhang.feet / M - G.rake) > 0.04, `${raw.roof.rakeOverhang.feet / M}`);
  // Snapping again does nothing more; a photo with no edges leaves the trace as it was.
  assert(x.snapTrace(s, roofFrame, g, G.L * M, x.camerasAt([cam.photo])) === s, "once");
  const blank = { data: new Float32Array(roofFrame.width * roofFrame.height).fill(128), width: roofFrame.width, height: roofFrame.height };
  assert(x.snapTrace(raw, roofFrame, blank, G.L * M, x.camerasAt([cam.photo])) === raw, "no edges, as traced");
});

test("ticked roof reads go on the side as the photo's; one set aside is kept as set aside, and the gable then gives no pitch", () => {
  const cam = phone({ at: [2.6, -6.5, 1.5], yaw: 0.05, pitch: 0.15, width: 1920, height: 1080, f: 1100 });
  const p = x.traceProposals(gableWire([cam]), roofFrame, G.L * M, x.camerasAt([cam.photo]));
  const base = side({ lengthFeet: G.L * M });
  const yes = x.applyTrace(base, p, { shapes: [], openings: [], wallTop: true, roof: x.roofPicksAtFirst(p.roof) }, "2026-10-15T00:00:00Z");
  assert(yes.roofRead.at === "2026-10-15T00:00:00Z" && yes.roofRead.pitch === 5 && yes.roofRead.over === "gable", JSON.stringify(yes.roofRead));
  near(yes.roofRead.rakeOverhangFeet / M, G.rake, "rake", 0.004);
  near(yes.roofRead.eaveOverhangFeet / M, G.eaveOut, "eave", 0.004);
  assert(yes.pitchMeasured === 5, "the side's pitch is the photo's");
  const no = x.applyTrace(base, p, { shapes: [], openings: [], wallTop: true, roof: { pitch: false, rake: true, eave: false, over: true } });
  assert(no.roofRead.pitch === null && no.roofRead.eaveOverhangFeet === null && no.roofRead.rakeOverhangFeet > 0, JSON.stringify(no.roofRead));
  assert(no.pitchMeasured === null, "set aside: no pitch from this side");
  // Nothing of the roof ticked or unticked: the roof read is left as it was.
  const none = x.applyTrace({ ...base, roofRead: yes.roofRead }, p, { shapes: [], openings: [], wallTop: false });
  assert(none.roofRead === yes.roofRead, "left alone");
});

console.log("\nthe house in 3D (10-13)");

/** The 3D model, which must build. */
function model3d(e) {
  const m = x.exteriorModel(e);
  assert(m.ok, m.ok ? "" : m.reason);
  return m.model;
}
/** A wall's top at u along it. */
function wallTopAt(w, u) {
  const top = w.outline.slice(w.bottomPoints ?? 2).reverse();
  for (let k = 0; k + 1 < top.length; k++) {
    const p = top[k];
    const q = top[k + 1];
    if (u >= p.x - 1e-9 && u <= q.x + 1e-9) return q.x - p.x < 1e-9 ? Math.max(p.y, q.y) : p.y + ((q.y - p.y) * (u - p.x)) / (q.x - p.x);
  }
  return NaN;
}
/** A point of the plan, u along a wall and [inward] feet in from its face. */
function planOf(w, u, inward) {
  return { x: w.origin[0] + w.along[0] * u - w.out[0] * inward, y: -(w.origin[2] + w.along[2] * u - w.out[2] * inward) };
}
/** Every height of the roof's underside, as the view draws it, straight over a plan point (more than one where roofs overlap). */
function undersides(model, p) {
  const t = model.roof.under;
  const out = [];
  for (let i = 0; i < t.length; i += 9) {
    const A = { x: t[i], y: -t[i + 2], h: t[i + 1] };
    const B = { x: t[i + 3], y: -t[i + 5], h: t[i + 4] };
    const C = { x: t[i + 6], y: -t[i + 8], h: t[i + 7] };
    const den = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((B.y - C.y) * (p.x - C.x) + (C.x - B.x) * (p.y - C.y)) / den;
    const l2 = ((C.y - A.y) * (p.x - C.x) + (A.x - C.x) * (p.y - C.y)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    out.push(l1 * A.h + l2 * B.h + l3 * C.h);
  }
  return out;
}
/**
 * The worst gap between a wall's top and the roof's underside just inside it, along every wall - the
 * check that the roof sits on the walls with nothing open between. [skip]: sides that stand under a
 * covered deck's ceiling, not under the roof.
 */
function worstGap(model, skip = []) {
  let worst = 0;
  let where = "";
  for (const w of model.walls) {
    if (skip.includes(w.sideId)) continue;
    for (let k = 0; k < 40; k++) {
      const u = ((k + 0.37) / 40) * w.length;
      const top = wallTopAt(w, u);
      const hs = undersides(model, planOf(w, u, 0.01));
      const gap = hs.length === 0 ? Infinity : Math.min(...hs.map((h) => Math.abs(h - top)));
      if (gap > worst) {
        worst = gap;
        where = `${w.name} at ${u.toFixed(2)}: wall ${top.toFixed(3)}, roof ${hs.map((h) => h.toFixed(3)).join(" / ") || "none"}`;
      }
    }
  }
  return { worst, where };
}
/** The plan area the roof's top covers, and the plan length of its open edges (each roof's drip line, where nothing meets it). */
function topCover(model) {
  const t = model.roof.top;
  let area = 0;
  const edges = new Map();
  const key = (i) => `${t[i].toFixed(4)},${t[i + 1].toFixed(4)},${t[i + 2].toFixed(4)}`;
  for (let i = 0; i < t.length; i += 9) {
    area += Math.abs((t[i + 3] - t[i]) * (t[i + 8] - t[i + 2]) - (t[i + 6] - t[i]) * (t[i + 5] - t[i + 2])) / 2;
    for (const [a, b] of [
      [i, i + 3],
      [i + 3, i + 6],
      [i + 6, i],
    ]) {
      const k = [key(a), key(b)].sort().join("|");
      const e = edges.get(k) ?? { n: 0, len: Math.hypot(t[b] - t[a], t[b + 2] - t[a + 2]) };
      e.n += 1;
      edges.set(k, e);
    }
  }
  let open = 0;
  for (const e of edges.values()) if (e.n === 1) open += e.len;
  return { area, open };
}
/** The fascia's area: the slab's thickness all round the eaves and rakes. */
function fasciaArea(model) {
  const t = model.roof.fascia;
  let area = 0;
  for (let i = 0; i < t.length; i += 9) {
    const u = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2]];
    const v = [t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return area;
}
/** The plan length of the steps' faces: where one part of a roof stands over another, each a quad of two triangles. */
function stepFeet(model) {
  const t = model.roof.steps;
  let feet = 0;
  // A quad's first triangle runs (x0, lo0) (x1, lo1) (x1, hi1): its foot is the first two corners.
  for (let i = 0; i < t.length; i += 18) feet += Math.hypot(t[i + 3] - t[i], t[i + 5] - t[i + 2]);
  return feet;
}
/**
 * Everything a roof is checked for: on its walls, covering its plan, open only along its drip lines and
 * where a step's face stands (one roof's top on each side of it), its edge closed by the fascia - a
 * band of the slab's thickness over each eave and rake's plan length.
 */
/** `gapTol`: the walls are read 0.01' in, so a roof steeper than 12/12 rises more than 0.01 there. */
function soundRoof(e, what, skip = [], gapTol = 0.02) {
  const m = model3d(e);
  const q = x.exteriorQuantities(e);
  const gap = worstGap(m, skip);
  assert(gap.worst < gapTol, `${what}: a gap between wall and roof - ${gap.where}`);
  const cover = topCover(m);
  near(cover.area, q.roof.planSquareFeet, `${what}: the roof's top over its whole plan`, 1e-3);
  near(cover.open, q.roof.edges.reduce((s, e) => s + e.planFeet, 0) + 2 * stepFeet(m), `${what}: open only along its drip lines and steps (no cracks between slopes)`, 1e-3);
  const T = x.ROOF_THICKNESS_FEET;
  near(fasciaArea(m), T * q.roof.edges.filter((e) => e.kind === "eave" || e.kind === "rake").reduce((s, e) => s + e.planFeet, 0), `${what}: fascia round every eave and rake`, 1e-3);
  return { m, q };
}
const wallNamed = (m, name) => m.walls.find((w) => w.name === name);
const topOf = (w) => Math.max(...w.outline.slice(2).map((p) => p.y));

test("3D: a plain gable stands on its walls - the gable ends rise to the ridge, the eave walls to the eave", () => {
  // 40 x 30 at 6/12, 16" eaves, 12" rakes, every eave 10'. The ridge's underside is 15' of run in from
  // the eave walls, 7'6" up: 17'6", its top half a foot above that.
  const { m } = soundRoof(rect(40, 30, { pitch: 6 }), "gable");
  near(m.eaves[0], 10, "the eave at the eaves measured");
  near(topOf(wallNamed(m, "Right")), 17.5, "the gable end's peak");
  near(topOf(wallNamed(m, "Front")), 10, "the eave wall");
  near(m.bounds.maxY, 18, "the ridge's top");
  for (const w of m.walls) near(w.grade[0].y, 0, `${w.name}'s ground`);
  assert(m.notes.length === 0 && m.posts.length === 0, m.notes.join(" "));
  // The slab's edge: two 42' eaves and four rakes of 16'4" across (a band half a foot high over each).
  near(fasciaArea(m), 0.5 * (2 * 42 + 4 * ft(16, 4)), "fascia");
  assert(m.roof.steps.length === 0 && m.roof.gables.length === 0, "no steps, no cross gables");
});

test("3D: a corner under a rake run on past it - its reading a wall top only when the two corners are that far apart (10-22)", () => {
  // The claim saved on 10-16: its left wall's far end is under a rake rising 3.6' above the eave, but its two readings, 18'3"
  // and 17'11" off one level line, are both the eave's: kept as they are, the higher one sets the wall.
  const saved = fixture("claim-saved-1016.json").sketch.exterior;
  // Each wall's frame is the house's eave (the middle of every side's readings) less its own reading.
  const left = (e) => model3d(e).walls.find((w) => w.name === "Left");
  const eave = (e) => model3d(e).eaves[0];
  near(left(saved).frameV, eave(saved) - 18.22, "read at the eave: kept", 0.01);
  // Read as the wall's top under the rake (house G's AC side, its corners 3'11" apart): the rise taken off, the eave read. The
  // pitch typed, so the roof over it stays as it is (else the gable's readings set it).
  const typed = { ...saved, roof: { ...saved.roof, pitch: 6 } };
  const side = typed.sides.find((q) => q.name === "Left");
  const rise = Math.max(...left(typed).outline.filter((p) => p.x < 1e-6).map((p) => p.y)) - eave(typed);
  assert(rise > 3, `the left end under a rake: ${rise}`);
  const top = { ...typed, sides: typed.sides.map((q) => (q === side ? { ...q, eaveLeftFeet: q.eaveRightFeet + rise } : q)) };
  near(left(top).frameV, eave(top) - side.eaveRightFeet, "read at the wall's top: the rise taken off", 0.01);
});

test("3D: hips, an L, a T and a U all sit on their walls with no crack between slopes", () => {
  soundRoof(rect(40, 30, { pitch: 6, ends: { left: "hip", right: "hip" } }), "hip");
  soundRoof(ell({ pitch: 8, ends: { left: "hip" } }), "L with a hip");
  soundRoof(tee(), "T");
  soundRoof(you(), "U");
});

test("3D: the owner's twelve corners - the garage lower under a gable on the house, siding between", () => {
  // The garage's walls read 8' to their eave, the house's 10'. The garage roof is the house's gable over
  // it carried down 2': with the slab half a foot thick, 1'6" of siding between all along.
  const e = ownersRoof();
  for (const s of e.sides) if (["garageFront", "bayLeft", "bayFront", "garageLeft"].includes(s.id)) Object.assign(s, { eaveLeftFeet: 8, eaveRightFeet: 8 });
  const { m } = soundRoof(e, "owner's house", ["deckSide", "deckBack"]);
  near(m.eaves[0], 10, "the house's eave");
  near(m.eaves[1], 8, "the garage's");
  const over = m.walls.filter((w) => w.name === "Wall over the lower roof");
  assert(over.length === 1, `${over.length} walls over the garage`);
  near(over[0].length, 20, "across the garage's width");
  // The garage's own roof along that wall, read just on the garage's side of it: always 1'6" under.
  for (let k = 0; k < 20; k++) {
    const u = ((k + 0.5) / 20) * 20;
    const top = wallTopAt(over[0], u);
    const garage = Math.min(...undersides(m, planOf(over[0], u, -0.01))) + x.ROOF_THICKNESS_FEET;
    near(top - garage, 1.5, `siding between at ${u}`, 0.02);
  }
  // The deck: a ceiling at the eave, a post at its open corner - the house's rear left, the walk having
  // started at the garage - and the house's left gable carried on over it from 16' (6' of run in from
  // the rear, at 12/12 with no overhang) down to the eave.
  const deck = m.walls.filter((w) => w.name === "Wall over the deck");
  assert(deck.length === 1, `${deck.length} strips over the deck`);
  near(topOf(deck[0]), 16, "the gable over the deck");
  assert(m.posts.length === 1, `${m.posts.length} posts`);
  const notch = x.exteriorQuantities(e).roof.notches.find((k) => k.covered);
  near(m.posts[0].x, notch.x0 + x.POST_SIZE_FEET, "the post in from the corner");
  near(m.posts[0].z, -(notch.y1 - x.POST_SIZE_FEET), "the post in from the corner");
  near(m.posts[0].y1, 10, "up to the ceiling");
  near(m.ceilings.length / 3, 6, "the ceiling's two triangles");
});

test("3D: the owner's roof at its own lengths and overhangs, with a porch, stands on its walls", () => {
  const e = ownersRoof({ pitch: 5, eaveOverhangFeet: 2, rakeOverhangFeet: ft(1, 10), additions: [{ id: "p", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 20, depthFeet: ft(4, 10) }] });
  const { m } = soundRoof(e, "owner's house with a porch", ["deckSide", "deckBack"]);
  // The house's gable over the garage has its face at its drip line, from 2' left of the garage (18,-2);
  // the porch runs on under its corner to the garage's wall at x = 20. The step between: 2' long, from
  // the porch's top up to the gable's, which climbs 2' of run there at 5/12.
  near(stepFeet(m), 2, "the gable's face over the porch");
  const ys = m.roof.steps.filter((_, i) => i % 3 === 1);
  near(Math.max(...ys) - Math.min(...ys), (2 * 5) / 12 + x.ROOF_THICKNESS_FEET, "from the porch's underside to the gable's top");
});

test("3D: a porch roof stands on posts a foot in from its eave, from the ground up", () => {
  // The front's slope carried on 6' out at 6/12 with 1' eaves: at 5' out the run in from the old drip
  // line is -4, so the underside is 10 + (-4 - 1) / 2 = 7'6". From 0 (the rake's end, run on past the
  // corner by 1') to 19 (a foot short of where it stops): three posts, under 10' apart.
  const { m } = soundRoof(rect(40, 30, { pitch: 6, eaveOverhangFeet: 1, rakeOverhangFeet: 1, additions: [{ id: "p", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 20, depthFeet: 6 }] }), "porch");
  assert(m.posts.length === 3, `${m.posts.length} posts`);
  m.posts.forEach((p, i) => {
    near(p.x, [0, 9.5, 19][i], "along the porch");
    near(p.z, 5, "a foot in from its eave");
    near(p.y0, 0, "from the ground");
    near(p.y1, 7.5, "to the roof's underside");
  });
});

test("3D: a cross gable's face stands under its rakes", () => {
  // 10' wide on the front at 12/12 with no overhangs: its triangle 10' across, 5' up from the eave.
  // Its roof reaches in over the front wall, which stands to the eave under it: the face closes that.
  const { m } = soundRoof(rect(40, 30, { pitch: 12, eaveOverhangFeet: 0, rakeOverhangFeet: 0, additions: [{ id: "g", kind: "gable", sideId: "front", fromFeet: 10, toFeet: 20 }] }), "cross gable", ["front"]);
  const ys = m.roof.gables.filter((_, i) => i % 3 === 1);
  assert(ys.length === 3, `${ys.length / 3} faces`);
  near(Math.min(...ys), 10, "its foot at the eave");
  near(Math.max(...ys), 15, "its peak");
});

test("3D: a lean-to stands its own height under the eave; heights read off a sloping lot", () => {
  // The lean-to (8' deep at 6/12, no overhang) meets the wall 1'6" under the eave: its eave 4' lower still.
  const lean = model3d(rect(40, 30, { pitch: 6, eaveOverhangFeet: 0, rakeOverhangFeet: 0, additions: [{ id: "l", kind: "porch", sideId: "left", fromFeet: 5, toFeet: 25, depthFeet: 8, lower: true }] }));
  near(lean.eaves[1], 10 - 1.5 - 4, "the lean-to's eave");
  assert(lean.notes.some((n) => /isn't measured/.test(n)), "said to be drawn, not measured");
  // Taped on a lot falling 4' to the back: 10' to the eave at the front, 14' at the back. The eave is the
  // middle reading (12'), so the front's ground stands 2' up and the back's 2' down, the sides sloping.
  const e = rect(40, 30, { pitch: 6 });
  const set = (id, l, r) => Object.assign(e.sides.find((s) => s.id === id), { eaveLeftFeet: l, eaveRightFeet: r });
  set("right", 10, 14);
  set("rear", 14, 14);
  set("left", 14, 10);
  const { m } = soundRoof(e, "sloping lot");
  near(m.eaves[0], 12, "the eave");
  near(wallNamed(m, "Front").grade[0].y, 2, "the front's ground");
  near(wallNamed(m, "Rear").grade[0].y, -2, "the back's");
  const right = wallNamed(m, "Right").grade;
  near(right[0].y, 2, "the right side's ground at the front");
  near(right[right.length - 1].y, -2, "and at the back");
  // A side tapped on the phone is read at its higher eave: a shape stopping short of the eave says nothing of the ground.
  const tapped = rect(40, 30, { pitch: 6 });
  Object.assign(tapped.sides[1], { heightsFrom: "level", eaveLeftFeet: ft(2, 8), eaveRightFeet: 10 });
  near(wallNamed(model3d(tapped), "Right").grade[0].y, 0, "a stray low eave moves nothing");
});

test("3D: cladding as the elevation has it, openings in place, and what can't be stood up says why", () => {
  const e = rect(40, 30, { pitch: 6 });
  e.sides[0].bands = [
    { id: "s", kind: "stone", top: 3 },
    { id: "v", kind: "vinyl", top: null },
  ];
  e.sides[0].openings = [{ id: "w", kind: "window", widthFeet: 4, heightFeet: 3, sillFeet: 3, fromLeftFeet: 5 }];
  const front = wallNamed(model3d(e), "Front");
  assert(front.faces.map((f) => f.kind).join() === "parging,stone,vinyl", front.faces.map((f) => f.kind).join());
  assert(front.background === "vinyl", front.background);
  const o = front.openings[0];
  assert(o.kind === "window" && o.x0 === 5 && o.x1 === 9 && o.y0 === 3 && o.y1 === 6, JSON.stringify(o));
  // No pitch typed and no gable measured: the roof stands at the assumed 4/12, and says so (10-13; 4/12 since 10-14).
  const walls = model3d(rect(40, 30));
  assert(walls.roof !== null && /assumed 4\/12/.test(walls.notes.join(" ")), walls.notes.join(" "));
  near(topOf(wallNamed(walls, "Left")), 15, "the gable end up to the assumed roof, as at a typed 4/12");
  near(topOf(wallNamed(walls, "Front")), 10, "the eave as measured");
  const open = x.exteriorModel(exterior([ownersSide()]));
  assert(!open.ok && /every side of the house/.test(open.reason), open.ok ? "built" : open.reason);
});

test("3D: the owner's own walk (14:53) stands up, the garage under its gable, the walls on the roof", () => {
  const file = JSON.parse(readFileSync(join(here, "fixtures", "scan-exterior-v2-walk-1453.json"), "utf8"));
  const r = x.parseScanExterior(file);
  assert(r.ok, r.error);
  const e = r.exterior;
  const id = (name) => e.sides.find((s) => s.name === name).id;
  // As the owner gave the roof on 10-13: the deck covered, the garage lower under a gable on the house, hipped at the street.
  e.roof = { ...e.roof, pitch: 5, eaveOverhangFeet: 2, rakeOverhangFeet: ft(1, 10), coveredNotches: [id("Rear 3")], lowerWings: [id("Front 2")], wingGables: [id("Front 2")], ends: { [id("Front 2")]: "hip" } };
  const { m } = soundRoof(e, "the owner's walk", [id("Left 4"), id("Rear 3")]);
  // The house's eave: every eave the walk read under it, in the middle - 10'4". The garage's: its drop under the house's, not
  // the middle of its own walls' readings, each from its own ground (2026-10-16) - here the assumed 1'6", as no corner where
  // the garage's walls meet the house's measures it; said in the notes.
  near(m.eaves[0], 10.348, "the house's eave", 0.01);
  near(m.eaves[1], m.eaves[0] - 1.5, "the garage's eave, 1'6\" under the house's", 1e-9);
  assert(m.notes.some((n) => /The roof out to Front 2 is drawn 1'6" under the eave of the roof it meets: assumed/.test(n)), m.notes.join(" | "));
  assert(m.walls.filter((w) => w.sideId === null).length === 2, "the wall over the garage and the strip over the deck");
  assert(m.walls.every((w) => w.sideId === null || w.background === "unclad"), "tapped as shapes: what no shape covers is left bare");
  assert(m.walls.filter((w) => w.sideId !== null).reduce((s, w) => s + w.openings.length, 0) === 20, "every opening the walk tapped");
});

console.log("\ndrawn on the plan, and walked round side by side (10-13)");

const P = (px, py) => ({ x: px, y: py });
const byName = (e, name) => e.sides.find((s) => s.name === name);
/** "Front 40~": each side's length, ~ where it is only drawn. */
const lengthsOf = (e) => e.sides.map((s) => `${s.name} ${Math.round(s.lengthFeet * 1000) / 1000}${s.lengthFrom === "drawn" ? "~" : ""}`).join(", ");
const drawnRect = () => x.exteriorFromOutline([P(0, 0), P(40, 0), P(40, 30), P(0, 30)]);
/** 40 x 30 with a 15 x 10 notch out of the rear right, tapped the other way round, from the rear left. */
const drawnEll = () => x.exteriorFromOutline([P(0, 30), P(25, 30), P(25, 20), P(40, 20), P(40, 0), P(0, 0)], 9);

test("drawing: each tap on the foot grid, square to the last wall; closing adds the corner the last wall turns at", () => {
  // The first wall goes whichever way the tap mostly does; each one after it runs across the one before.
  const a = x.snapOutlinePoint(P(10.4, 0.3), []);
  assert(a.x === 10 && a.y === 0, JSON.stringify(a));
  const b = x.snapOutlinePoint(P(30.2, 2.6), [P(0, 0)]);
  assert(b.x === 30 && b.y === 0, JSON.stringify(b));
  const c = x.snapOutlinePoint(P(37.7, 19.6), [P(0, 0), P(30, 0)]);
  assert(c.x === 30 && c.y === 20, `an upright wall after a level one, wherever the tap: ${JSON.stringify(c)}`);
  // Three corners close as a rectangle: the fourth is where the last wall turns to reach the first.
  const r = x.closeOutline([P(0, 0), P(30, 0), P(30, 20)]);
  assert(r && r.length === 4 && x.polygonArea(r) === 600, JSON.stringify(r));
  // A last corner 2' short of lining up with the first slides along its wall to line up, within reach of the snap...
  const snapped = x.closeOutline([P(0, 0), P(30, 0), P(30, 20), P(2, 20)], 3);
  assert(snapped && x.polygonArea(snapped) === 600, JSON.stringify(snapped));
  // ...and without it the left wall is where the last corner put it, the first corner then on a straight wall and taken out.
  const asTapped = x.closeOutline([P(0, 0), P(30, 0), P(30, 20), P(2, 20)]);
  assert(asTapped && asTapped.length === 4 && x.polygonArea(asTapped) === 560, JSON.stringify(asTapped));
  assert(x.closeOutline([P(0, 0), P(20, 0), P(20, 10), P(10, 10), P(10, -10), P(0, -10)]) === null, "an outline that crosses itself is none");
  assert(x.closeOutline([P(0, 0), P(20, 0)]) === null, "two corners are a wall, not a house");
});

test("an outline drawn on the plan: its walls are the sides round to the right from the front, named by the way they face", () => {
  const e = drawnEll();
  // The outermost wall facing each way has the plain name: "Rear" is the back of the house, "Rear 2" the back of the notch.
  assert(lengthsOf(e) === "Front 40~, Right 20~, Rear 2 15~, Right 2 10~, Rear 25~, Left 30~", lengthsOf(e));
  assert(e.sides.map((s) => s.turn).join() === "outside,outside,inside,outside,outside,outside", e.sides.map((s) => s.turn).join());
  assert(e.sides.every((s) => s.eaveLeftFeet === 9 && s.eaveRightFeet === 9), "the eave given");
  const f = x.exteriorFootprint(e);
  assert(f.closes && f.misclosureFeet < 1e-9, f.reason);
  near(f.areaSquareFeet, 40 * 30 - 15 * 10, "the L's area");
  // A U open to the rear: the arms' backs are the rear, the court's back after them; the court's sides after the house's.
  const u = x.exteriorFromOutline([P(0, 0), P(60, 0), P(60, 40), P(45, 40), P(45, 15), P(15, 15), P(15, 40), P(0, 40)]);
  assert(lengthsOf(u) === "Front 60~, Right 40~, Rear 15~, Left 2 25~, Rear 3 30~, Right 2 25~, Rear 2 15~, Left 40~", lengthsOf(u));
});

test("the footprint from typed sides: a drawn side's length typed moves its right-hand corner, the drawn side across follows, a typed one stands", () => {
  let e = drawnRect();
  const id = (name) => byName(e, name).id;
  e = x.withSideLength(e, id("Front"), 44);
  assert(lengthsOf(e) === "Front 44, Right 30~, Rear 44~, Left 30~", lengthsOf(e));
  let f = x.exteriorFootprint(e);
  assert(f.closes && f.misclosureFeet < 1e-9 && Math.abs(f.areaSquareFeet - 44 * 30) < 1e-6, `${f.areaSquareFeet}`);
  e = x.withSideLength(e, id("Right"), 32);
  assert(lengthsOf(e) === "Front 44, Right 32, Rear 44~, Left 32~", lengthsOf(e));
  // The rear taped 6" short of the front: both kept as typed, and the footprint shares the 6" as it does any two tapes.
  e = x.withSideLength(e, id("Rear"), 43.5);
  assert(lengthsOf(e) === "Front 44, Right 32, Rear 43.5, Left 32~", lengthsOf(e));
  f = x.exteriorFootprint(e);
  near(f.misclosureFeet, 0.5, "the half foot the tapes miss by");
  // 44 - 0.5 x 44/87.5 = 43.748571, and 43.5 + 0.5 x 43.5/87.5 the same.
  near(f.lengthsFeet[0], 43.748571, "the front as the footprint uses it", 1e-5);
  near(f.lengthsFeet[2], 43.748571, "the rear the same", 1e-5);
});

test("the footprint from typed sides: on an L the front typed moves its own arm out, and a rear typed after it takes up the notch", () => {
  let e = drawnEll();
  const id = (name) => byName(e, name).id;
  // The line just short of the front's right end crosses the front and the back of the notch, not the rear.
  e = x.withSideLength(e, id("Front"), 44);
  assert(lengthsOf(e) === "Front 44, Right 20~, Rear 2 19~, Right 2 10~, Rear 25~, Left 30~", lengthsOf(e));
  near(x.exteriorFootprint(e).areaSquareFeet, 1050 + 4 * 20, "the front arm 4' longer");
  // The rear typed 27: across it is the front, typed, so the drawn back of the notch takes up the 2'.
  e = x.withSideLength(e, id("Rear"), 27);
  assert(lengthsOf(e) === "Front 44, Right 20~, Rear 2 17~, Right 2 10~, Rear 27, Left 30~", lengthsOf(e));
  assert(x.exteriorFootprint(e).misclosureFeet < 1e-9, "and it closes exactly");
});

test("the footprint from typed sides: a U's arm typed shorter moves only that arm, and nothing typed ever crosses the outline", () => {
  // The review's U (10-13): the court at the rear, the right arm 40' out and the left 30'.
  const u0 = x.exteriorFromOutline([P(0, 0), P(30, 0), P(30, 40), P(20, 40), P(20, 10), P(10, 10), P(10, 30), P(0, 30)]);
  const id = (e, name) => byName(e, name).id;
  // Right 40' -> 28': the right arm's back comes in past the left arm's, which stays where it is.
  const a = x.withSideLength(u0, id(u0, "Right"), 28);
  assert(lengthsOf(a) === "Front 30~, Right 28, Rear 10~, Left 2 18~, Rear 3 10~, Right 2 20~, Rear 2 10~, Left 30~", lengthsOf(a));
  // Right -> 20': the arm's back stops 10' short of the court's floor, still an outline.
  const b = x.withSideLength(u0, id(u0, "Right"), 20);
  assert(lengthsOf(b) === "Front 30~, Right 20, Rear 10~, Left 2 10~, Rear 3 10~, Right 2 20~, Rear 2 10~, Left 30~", lengthsOf(b));
  const fb = x.exteriorFootprint(b);
  assert(fb.closes && fb.misclosureFeet < 1e-9, fb.reason);
  near(fb.areaSquareFeet, 600, "30 x 10, the left arm 10 x 20 and the right 10 x 10");
  // Right -> 5': no drawn side can take it without the outline crossing itself, so the 5' stands as typed and the plan says why.
  const c = x.withSideLength(u0, id(u0, "Right"), 5);
  assert(byName(c, "Right").lengthFeet === 5, "what was typed stands");
  const fc = x.exteriorFootprint(c);
  assert(fc.closes ? x.orthogonalRing(fc.corners) !== null : /cross over each other|shrink to nothing/.test(fc.reason), fc.reason ?? "closed");
});

test("a walk whose lengths take it across itself is no footprint, and says so", () => {
  // A U whose court wall runs 45' down from the 40' rear: through the front wall. It closes exactly, and crosses.
  const lengths = [30, 40, 10, 45, 10, 35, 10, 30];
  const turns = ["outside", "outside", "outside", "inside", "inside", "outside", "outside", "outside"];
  const e = exterior(lengths.map((l, k) => side({ id: `s${k}`, name: `S${k}`, lengthFeet: l, turn: turns[k] })));
  const f = x.exteriorFootprint(e);
  assert(!f.closes && /cross over each other/.test(f.reason), f.reason ?? "closed");
  assert(x.exteriorQuantities(e).roof === null, "and no roof on it");
});

test("a side put in after another breaks the outline open until its corners are put right", () => {
  const r = drawnRect();
  const f = x.withSideAfter(r, r.sides[0].id);
  assert(f.sides.length === 5 && f.sides[1].name === "Right 2" && f.sides[1].lengthFeet === 10, f.sides.map((s) => s.name).join());
  assert(!x.exteriorFootprint(f).closes && /corners don't go round/.test(x.exteriorFootprint(f).reason), x.exteriorFootprint(f).reason);
});

test("a side's openings after a length change: measured from its left corner they stay, and the far side's keep their place on the wall", () => {
  let e = drawnRect();
  const id = (name) => byName(e, name).id;
  const win = (oid, from, w = 3) => ({ id: oid, kind: "window", widthFeet: w, heightFeet: 4, sillFeet: 3, fromLeftFeet: from });
  e.sides[0].openings = [win("a", 10), win("b", 35)];
  e.sides[0].gable = { peakFeet: 16, atFeet: 20 };
  // The rear, seen from behind the house, starts at the plan's right: 5' in from its left corner is the plan's 31'-35'.
  e.sides[2].openings = [win("c", 5, 4)];
  e = x.withSideLength(e, id("Front"), 36);
  const front = byName(e, "Front");
  assert(front.openings[0].fromLeftFeet === 10, "the first window where it was taped");
  near(front.openings[1].fromLeftFeet, 33, "the second brought back inside the shorter wall");
  near(front.gable.atFeet, 20, "the peak where it was measured");
  // The rear is 4' shorter at its left end (the plan's right): its window keeps its place, 1' in from that end now.
  near(byName(e, "Rear").lengthFeet, 36, "the drawn rear follows");
  near(byName(e, "Rear").openings[0].fromLeftFeet, 1, "the rear window stays put");
  e = x.withSideLength(e, id("Front"), 44);
  near(byName(e, "Rear").openings[0].fromLeftFeet, 9, "and stays put the other way: 9' in");
  // The review's L: front windows at 22' and 30', the front typed 40' -> 20'. The arm past the notch (25') comes in 20';
  // the window caught where the wall closes up is kept on what is left, so the two stay in order.
  let l = drawnEll();
  l.sides[0].openings = [win("a", 22), win("b", 30)];
  l = x.withSideLength(l, l.sides[0].id, 20);
  const [first, second] = byName(l, "Front").openings;
  near(first.fromLeftFeet, 3.5, "the first pushed in with the wall");
  near(second.fromLeftFeet, 10, "the second moved with its arm");
  assert(first.fromLeftFeet < second.fromLeftFeet, "still in order");
  assert(x.exteriorFootprint(l).closes, x.exteriorFootprint(l).reason);
});

test("the footprint from typed sides: the front typed, each next side by its corner and length, and the last one offered", () => {
  let e = x.startWalk(40);
  assert(e.open && /Still going round/.test(x.exteriorFootprint(e).reason), x.exteriorFootprint(e).reason);
  e = x.withNextSide(e, "outside", 30);
  e = x.withNextSide(e, "outside", ft(39, 10));
  assert(e.sides.map((s) => s.name).join() === "Front,Right,Rear" && e.open, e.sides.map((s) => s.name).join());
  // From the rear's end the walk is 2" off the front's left corner across it and 30' short: one more side, round an outside corner.
  const w = x.walkState(e);
  assert(w.lastSide && w.lastSide.turn === "outside" && w.lastSide.name === "Left", JSON.stringify(w.lastSide));
  near(w.lastSide.lengthFeet, 30, "the left side's length");
  e = x.withNextSide(e, w.lastSide.turn, w.lastSide.lengthFeet);
  assert(!e.open && e.sides.every((s) => s.turn === "outside"), "back at the start: closed by itself");
  const f = x.exteriorFootprint(e);
  assert(f.closes, f.reason);
  // The 2" the rear is short is shared between front and rear, as for any taped rectangle: 40 - (2/12) x 40/79.833.
  near(f.lengthsFeet[0], 40 - (2 / 12) * (40 / (40 + ft(39, 10))), "the front as used", 1e-6);
  assert(e.sides.every((s) => s.lengthFrom === undefined), "every length typed");
});

test("going round a U side by side, the walk does not close on its own before it is back at the start", () => {
  let e = x.startWalk(40);
  e = x.withNextSide(e, "outside", 30);
  e = x.withNextSide(e, "outside", 10);
  e = x.withNextSide(e, "outside", 20);
  // Four outside corners so far, as a rectangle has, but 31'8" from the start: still open.
  assert(e.open && x.walkState(e).turnsClose, "the corners would go round, but the walk is nowhere near the start");
  e = x.withNextSide(e, "inside", 20);
  e = x.withNextSide(e, "inside", 20);
  e = x.withNextSide(e, "outside", 10);
  assert(e.open, "still open before the last side");
  e = x.withNextSide(e, "outside", 30);
  assert(!e.open, "closed at the start");
  assert(e.sides.map((s) => s.name).join() === "Front,Right,Rear,Left,Rear 2,Right 2,Rear 3,Left 2", e.sides.map((s) => s.name).join());
  near(x.exteriorFootprint(e).areaSquareFeet, 40 * 30 - 20 * 20, "the U's area");
  // The review's walk: four sides 5'10" off the start with a 3' x 5' jog still to come. A tape's error closes by itself; that does not.
  let j = x.startWalk(100);
  j = x.withNextSide(j, "outside", 50);
  j = x.withNextSide(j, "outside", 103);
  j = x.withNextSide(j, "outside", 45);
  assert(j.open, "still open: the jog is still to come");
});

test("the roof is there as soon as the outline closes, at an assumed 4/12 that is asked for until it is answered", () => {
  const e = drawnRect();
  e.scope = { roofing: true, sides: [e.sides[1].id], soffitFascia: false, eavestrough: false };
  const q = x.exteriorQuantities(e);
  assert(q.roof && q.pitch.source === "assumed" && q.roof.pitch === 4, `${q.pitch.source} ${q.roof?.pitch}`);
  assert(q.roofing.pitchAssumed && q.roofing.toAnswer.roofing[0] === "the pitch (4/12 is assumed)", q.roofing.toAnswer.roofing.join(" | "));
  const lines = x.exteriorScopeLines(e);
  assert(/^Remove & replace roofing – material to confirm – 4\/12 \(assumed, to confirm\) – /.test(lines.roofing[0]), lines.roofing[0]);
  // The Right side is a gable end: its gable is the roof's, so at the assumed pitch, and its line says so.
  assert(/^Remove & replace stucco – Right – [\d.]+ SF – gables at the assumed 4\/12, to confirm$/.test(lines.siding[0]), lines.siding[0]);
  e.roof.pitch = 5;
  const typed = x.exteriorQuantities(e);
  assert(typed.pitch.source === "typed" && !typed.roofing.pitchAssumed && !typed.roofing.toAnswer.roofing.some((t) => /pitch/.test(t)), "typed: nothing assumed");
  assert(!/assumed/.test([...x.exteriorScopeLines(e).roofing, ...x.exteriorScopeLines(e).siding].join(" ")), "and no line says so");
});

test("roof end toggles: a tap on an end turns a gable to a hip and back; a porch or cross gable goes on a side with one tap", () => {
  const e = drawnRect();
  e.roof.pitch = 6;
  const id = (name) => byName(e, name).id;
  const nameOf = (sideId) => e.sides.find((s) => s.id === sideId)?.name;
  const plan0 = x.exteriorQuantities(e).roof;
  // The ridge runs along the 40' front, so the ends stand over Left and Right, both gables.
  assert(plan0.ends.map((end) => `${nameOf(end.sideId)} ${end.kind}`).sort().join() === "Left gable,Right gable", JSON.stringify(plan0.ends));
  assert(x.toggledEnd(plan0, id("Front")) === null, "the front is no end");
  assert(x.toggledEnd(plan0, id("Left")) === "hip", "a gable taps to a hip");
  e.roof = x.withRoofEnd(e.roof, id("Left"), "hip");
  const plan1 = x.exteriorQuantities(e).roof;
  assert(plan1.ends.find((end) => end.sideId === id("Left")).kind === "hip", "now a hip");
  // The hip end's two rakes are gone and its two hips are there: 16'4" of run each at 6/12 is 16.333 x 1.5 = 24.5'.
  near(plan1.totals.hip, 2 * 16.3333 * x.hipValleyFactor(6), "two hips", 1e-3);
  near(plan0.totals.rake - plan1.totals.rake, plan0.totals.rake / 2, "half the rakes gone");
  assert(x.toggledEnd(plan1, id("Left")) === "gable", "and a hip taps back to a gable");
  e.roof = x.withAddition(e.roof, "porch", id("Front"), 40);
  const a = e.roof.additions[0];
  assert(a.kind === "porch" && a.sideId === id("Front") && a.fromFeet === 0 && a.toFeet === 40 && a.depthFeet === 6 && !a.lower, JSON.stringify(a));
  const plan2 = x.exteriorQuantities(e).roof;
  assert(plan2.planSquareFeet > plan1.planSquareFeet + 100 && !/left out/.test(plan2.note ?? ""), plan2.note ?? `${plan2.planSquareFeet}`);
  e.roof = x.withAddition(e.roof, "gable", id("Front"), 40);
  assert(e.roof.additions[1].kind === "gable" && e.roof.additions[1].fromFeet === 15 && e.roof.additions[1].toFeet === 25, JSON.stringify(e.roof.additions[1]));
});

console.log("\ntyped roof totals (10-14)");

/** The 40 x 30 gable at 6/12 worked by hand above: 15.34 SQ, ridge 42, eaves 84, rakes 2 x 32.666667 x 1.118034 = 73.045, no hips or valleys. */
const RAKES_40X30 = 2 * 32.666667 * 1.118034;

test("a typed total replaces the drawing's; a blank box keeps it", () => {
  const e = rect(40, 30, { pitch: 6, typed: { ridge: 45, hip: null } });
  const r = x.exteriorQuantities(e).roofing;
  near(r.ridgeFeet, 45, "ridge as typed");
  assert(r.from.ridge === "estimator" && r.typed, "and said to be typed");
  near(r.hipFeet, 0, "a blank hip box keeps the drawing's none");
  assert(r.from.hip === "drawing" && r.from.squareFeet === "drawing", "the rest from the drawing");
  near(r.areaSquareFeet, 1533.9426, "area the drawing's");
  near(r.drawing.ridge, 42, "the drawing's own ridge kept beside it");
  // Cleared, it is the drawing's again.
  e.roof.typed = { ridge: null };
  const back = x.exteriorQuantities(e).roofing;
  near(back.ridgeFeet, 42, "cleared: the drawing's 42'");
  assert(!back.typed, "nothing typed");
});

test("drip edge, starter and ice & water follow the eaves, rakes and valleys - typed or drawn - unless typed themselves", () => {
  const e = rect(40, 30, { pitch: 6, typed: { eave: 90 } });
  let r = x.exteriorQuantities(e).roofing;
  near(r.eaveFeet, 90, "eaves typed");
  near(r.starterFeet, 90, "starter is the typed eaves");
  assert(r.from.starter === "estimator", `starter from ${r.from.starter}`);
  near(r.dripEdgeFeet, 90 + RAKES_40X30, "drip edge: typed eaves + drawn rakes");
  assert(r.from.dripEdge === "both", `drip edge from ${r.from.dripEdge}`);
  // No valleys on a gable roof: ice & water is the typed eaves alone, and says so.
  near(r.iceWaterFeet, 90, "ice & water: eaves + no valleys");
  assert(r.from.iceWater === "estimator", `ice & water from ${r.from.iceWater}`);
  e.roof.typed = { eave: 90, dripEdge: 170, starter: 88, iceWater: 100 };
  r = x.exteriorQuantities(e).roofing;
  near(r.dripEdgeFeet, 170, "drip edge typed stands over eaves + rakes");
  near(r.starterFeet, 88, "starter typed");
  near(r.iceWaterFeet, 100, "ice & water typed");
  near(r.closureFeet, 90 + 2 * 42, "closure strips: typed eaves + 2 x drawn ridge");
});

test("typed squares are the roof being done, whatever slopes are picked", () => {
  const e = rect(40, 30, { pitch: 6 });
  const facets = x.exteriorQuantities(e).roof.facets;
  e.roof.slopes = [facets[0].key];
  near(x.exteriorQuantities(e).roofing.areaSquareFeet, 1533.9426 / 2, "one slope of two picked: half");
  e.roof.typed = { squareFeet: 2000 };
  const r = x.exteriorQuantities(e).roofing;
  near(r.areaSquareFeet, 2000, "typed area");
  near(r.squares, 20, "20 squares");
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const first = x.exteriorScopeLines(e).roofing[0];
  assert(first === "Remove & replace roofing – material to confirm – 6/12 – 20.00 SQ – from the estimator", first);
});

test("every measured line says where its number came from once anything is typed; nothing typed, the lines are as they were", () => {
  const scope = { roofing: true, sides: [], soffitFascia: true, eavestrough: true };
  const plain = rect(40, 30, { pitch: 6, dripEdge: true });
  plain.scope = scope;
  const before = x.exteriorScopeLines(plain);
  assert(!/from the (estimator|drawing)/.test([...before.roofing, ...before.siding].join(" ")), "untouched: no source words");
  const e = rect(40, 30, { pitch: 6, dripEdge: true, typed: { ridge: 45, eave: 90 } });
  e.scope = scope;
  const { roofing, siding } = x.exteriorScopeLines(e);
  const has = (list, line) => assert(list.includes(line), `missing "${line}" in:\n      ${list.join("\n      ")}`);
  has(roofing, "Remove & replace roofing – material to confirm – 6/12 – 15.34 SQ (all slopes) – from the drawing");
  has(roofing, "Hip & ridge cap – 45.0 LF – from the estimator");
  has(roofing, "Starter – 90.0 LF (eaves) – from the estimator");
  has(roofing, `Drip edge – ${(90 + RAKES_40X30).toFixed(1)} LF (eaves + rakes) – from the estimator and the drawing – photos required`);
  has(roofing, "Ice & water barrier – 90.0 LF (eaves + valleys) – from the estimator");
  // Every eave and rake is chosen, so the eavestrough and soffit run along the typed eaves; the rakes are the drawing's.
  has(siding, "Remove & replace eavestrough – 90.0 LF – from the estimator");
  has(siding, `Remove & replace soffit – material to confirm – 90.0 LF at 1'4" overhang (120.0 SF) – eaves – from the estimator`);
  has(siding, `Remove & replace soffit – material to confirm – ${RAKES_40X30.toFixed(1)} LF at 1' overhang (${RAKES_40X30.toFixed(1)} SF) – rakes – from the drawing`);
  has(siding, `Remove & replace fascia – material to confirm – ${(90 + RAKES_40X30).toFixed(1)} LF (eaves + rakes) – from the estimator and the drawing`);
  // Two runs of 42' drawn, scaled to 90' typed: 45' each, two downspouts each.
  has(siding, "Remove & replace downspouts – 4 – 46.0 LF (eave height + 15%)");
});

test("the eavestrough keeps to the eaves picked on the plan: typed eaves stand only when every eave and rake is chosen", () => {
  const e = rect(40, 30, { pitch: 6, typed: { eave: 150 } });
  const all = x.exteriorQuantities(e).roofing;
  near(all.gutter.feet, 150, "every edge chosen: the typed eaves");
  // Two runs of 42' scaled to 75' each: three downspouts each.
  assert(all.gutter.downspouts === 6, `downspouts ${all.gutter.downspouts}`);
  const plan = x.exteriorQuantities(e).roof;
  e.roof.edges = [plan.edges.find((g) => g.kind === "eave").key];
  const one = x.exteriorQuantities(e).roofing;
  near(one.gutter.feet, 42, "one eave picked: that eave as drawn");
  assert(one.edgesFrom.eave === "drawing", "and said to be the drawing's");
  near(one.eaveFeet, 150, "the roofing's eaves are still the typed ones");
});

test("no outline at all: the typed totals are the roof, and scope it", () => {
  const e = {
    sides: [],
    roof: { ...x.defaultRoof(), pitch: 7, typed: { squareFeet: 2430, ridge: 38, hip: 52, valley: 18, eave: 120, rake: 30 } },
    scope: { roofing: true, sides: [], soffitFascia: true, eavestrough: true },
  };
  const q = x.exteriorQuantities(e);
  assert(q.roof === null && q.roofing !== null && !q.roofing.drawn, "no roof drawn, and roofing priced");
  const { roofing, siding } = x.exteriorScopeLines(e);
  const has = (list, line) => assert(list.includes(line), `missing "${line}" in:\n      ${list.join("\n      ")}`);
  has(roofing, "Remove & replace roofing – material to confirm – 7/12 – 24.30 SQ – from the estimator");
  has(roofing, "Steep roof charge – 7/12 to 9/12 – 24.30 SQ – from the estimator");
  has(roofing, "Hip & ridge cap – 90.0 LF – from the estimator");
  has(roofing, "Starter – 120.0 LF (eaves) – from the estimator");
  has(roofing, "Ice & water barrier – 138.0 LF (eaves + valleys) – from the estimator");
  has(roofing, "Valleys – 18.0 LF – from the estimator");
  assert(!roofing.some((l) => /Ridge vent|Step flashing|Headwall/.test(l)), "nothing that was not typed");
  has(siding, "Remove & replace eavestrough – 120.0 LF – from the estimator");
  // 120' with no runs drawn: one downspout per 35', so four; no sides, so no eave height to size them by.
  has(siding, "Remove & replace downspouts – 4");
  has(siding, `Remove & replace soffit – material to confirm – 120.0 LF at 1'4" overhang (160.0 SF) – eaves – from the estimator`);
  has(siding, "Remove & replace fascia – material to confirm – 150.0 LF (eaves + rakes) – from the estimator");
  assert(!q.roofing.toAnswer.roofing.some((t) => /squares/.test(t)), "the squares are given");
  assert(!q.roofing.toAnswer.roofing.some((t) => /pitch/.test(t)), "and the pitch typed");
  // Squares not typed: asked for, and the line says so rather than pricing nothing.
  delete e.roof.typed.squareFeet;
  const r2 = x.exteriorQuantities(e).roofing;
  assert(r2.toAnswer.roofing[0] === "the roof's squares (type them, or draw the outline)", r2.toAnswer.roofing.join("; "));
  assert(x.exteriorScopeLines(e).roofing[0] === "Remove & replace roofing – material to confirm – 7/12 – squares to confirm", x.exteriorScopeLines(e).roofing[0]);
  // Nothing typed and nothing drawn: no roof to tick.
  e.roof.typed = {};
  assert(x.exteriorQuantities(e).roofing === null, "no totals, no roofing");
});

test("a walk still going round can be scoped from typed totals while its outline waits", () => {
  const e = x.startWalk(40, 10);
  assert(x.exteriorQuantities(e).roofing === null, "open walk, nothing typed: no roof");
  e.roof.typed = { squareFeet: 1800 };
  const r = x.exteriorQuantities(e).roofing;
  assert(r !== null && !r.drawn && Math.abs(r.squares - 18) < 1e-9, "18 typed squares");
  // Its downspouts take the sides' own eave: 1 x 10' x 1.15.
  e.roof.typed.eave = 30;
  near(x.exteriorQuantities(e).roofing.gutter.downspoutFeet, 11.5, "downspout length off the walk's eave");
});

console.log("\na pitch per section (10-14)");

/**
 * A 40 x 30 house (ridge along the 40) with a 20 x 20 garage out of its front at the right, flush
 * with the right wall: an L, no overhangs. Walked from the garage's front: [garage front 20, right
 * 50, rear 40, left 30, the house's front 20 to the inside corner, the garage's left 20].
 */
const houseAndGarage = (roof = {}) =>
  walked(
    [
      ["garageFront", 20, "outside"],
      ["right", 50, "outside"],
      ["rear", 40, "outside"],
      ["left", 30, "outside"],
      ["front", 20, "inside"],
      ["garageLeft", 20, "outside"],
    ],
    roof,
  );
const F6 = Math.sqrt(1 + 0.25);
const F4 = Math.sqrt(1 + 1 / 9);
const F3 = Math.sqrt(1 + 1 / 16);

test("a 6/12 house with a 4/12 garage tied in: its ridge runs further in, its valleys are not 45°, each slope at its own pitch", () => {
  const e = houseAndGarage({ pitch: 6, sectionPitches: { "wing:garageFront": 4 } });
  const q = roofOf(e);
  const plan = q.roof;
  const r = q.roofing;
  const wing = plan.sections.find((s) => s.role === "wing");
  assert(wing.key === "wing:garageFront" && wing.pitch === 4 && wing.layer === 0, `${wing.key} ${wing.pitch} layer ${wing.layer}`);
  // The garage's ridge, 10 x 1/3 = 3'4" up, meets the house's 6/12 front slope 3'4" / (6/12) = 6'8" in from its eave.
  const garageRidge = linesOf(plan, "ridge").find((l) => Math.abs(l.a.x - l.b.x) < 1e-9);
  near(garageRidge.feet, 20 + 20 / 3, "the garage's ridge: 20 over the garage and 6'8\" on into the house's slope");
  near(r.ridgeFeet, 40 + 20 + 20 / 3, "ridges: the house's 40 and the garage's");
  // Each valley from an inside corner of the drip line to the ridge's end: 10 across, 6'8" in, 3'4" up.
  const valleys = linesOf(plan, "valley");
  assert(valleys.length === 2, `${valleys.length} valleys`);
  for (const v of valleys) {
    near(Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y), Math.hypot(10, 20 / 3), "a valley's run in plan: not the 45° of one pitch");
    near(v.feet, 10 * Math.sqrt(14 / 9), "a valley: 10 x sqrt(1 + (2/3)^2 + (1/3)^2)");
  }
  near(r.hipFeet, 0, "no hips");
  // Rakes: the house's two gable ends 30 across at 6/12, the garage's front 20 across at 4/12.
  near(r.rakeFeet, 2 * 30 * F6 + 20 * F4, "rakes");
  near(r.eaveFeet, 20 + 40 + 20 + 20, "eaves: the house's front left of the garage, its rear, the garage's two sides");
  // The house's 1200 less the 20 x 6'8" triangle the garage's slopes take, at 6/12; the garage's 400 and that triangle at 4/12.
  const triangle = (20 * (20 / 3)) / 2;
  near(r.areaSquareFeet, (1200 - triangle) * F6 + (400 + triangle) * F4, "area, each slope at its own factor");
  const pitches = plan.facets.map((f) => `${f.sideId}:${f.pitch}`).sort();
  assert(pitches.join() === "front:6,garageLeft:4,rear:6,right:4", pitches.join());
  assert(r.byPitch.length === 2 && r.byPitch[0].pitch === 6 && r.byPitch[1].pitch === 4, JSON.stringify(r.byPitch));
  near(r.byPitch[0].areaSquareFeet, (1200 - triangle) * F6, "the 6/12 squares");
  near(r.byPitch[1].areaSquareFeet, (400 + triangle) * F4, "the 4/12 squares");
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const first = x.exteriorScopeLines(e).roofing[0];
  const sq6 = (((1200 - triangle) * F6) / 100).toFixed(2);
  const sq4 = (((400 + triangle) * F4) / 100).toFixed(2);
  assert(first === `Remove & replace roofing – material to confirm – 6/12 on ${sq6} SQ, 4/12 on ${sq4} SQ – ${r.squares.toFixed(2)} SQ (all slopes)`, first);
  // The garage's front gable climbs at its own 4/12: 10 across, 3'4" up, 33.3 SF.
  near(gableOf(q, "garageFront"), (20 * (10 / 3)) / 2, "the garage's gable at 4/12");
  near(gableOf(q, "left"), (30 * 7.5) / 2, "the house's at 6/12");
});

test("the same house and garage at one pitch is the roof it always was", () => {
  const one = roofOf(houseAndGarage({ pitch: 6 })).roofing;
  const said = roofOf(houseAndGarage({ pitch: 6, sectionPitches: { "wing:garageFront": 6 } })).roofing;
  near(one.areaSquareFeet, 1600 * F6, "1600 SF of plan at 6/12");
  near(said.areaSquareFeet, one.areaSquareFeet, "the garage said to be the roof's pitch changes nothing");
  near(one.valleyFeet, 2 * 10 * x.hipValleyFactor(6), "45° valleys at one pitch");
  assert(one.byPitch.length === 1, "one pitch");
});

test("a garage steeper than the house would carry its ridge over the house's: it is built lower, stopping at the wall", () => {
  // 20 wide at 12/12 is 10' up; the house's 30 at 6/12 is 7'6".
  const plan = roofOf(houseAndGarage({ pitch: 6, sectionPitches: { "wing:garageFront": 12 } })).roof;
  const wing = plan.sections.find((s) => s.role === "wing");
  assert(wing.layer === 1 && plan.wings[0].lower && plan.wings[0].forced, `layer ${wing.layer}, ${JSON.stringify(plan.wings)}`);
  assert(/would stand over the main roof's ridge/.test(plan.note ?? ""), plan.note ?? "no note");
  near(plan.totals.valley, 0, "no valleys: flashing instead");
  // Its two slopes up the house's wall: 10 run, 10 up each.
  near(plan.totals.step, 2 * 10 * Math.SQRT2, "step flashing up the garage's 12/12 slopes");
});

test("a 12/12 cross gable on a 6/12 roof: twice as deep into the slope, valleys at their true lengths", () => {
  const e = rect(40, 30, { pitch: 6, eaveOverhangFeet: 0, rakeOverhangFeet: 0, additions: [{ id: "cg", kind: "gable", sideId: "front", fromFeet: 15, toFeet: 25 }], sectionPitches: { cg: 12 } });
  const q = roofOf(e);
  const plan = q.roof;
  const r = q.roofing;
  assert(plan.note === null, plan.note);
  const gable = plan.sections.find((s) => s.role === "gable");
  assert(gable.key === "cg" && gable.pitch === 12, `${gable.key} ${gable.pitch}`);
  // Half its width (5) up at 12/12 is 5'; the 6/12 slope is 5' up 10' in. Its ridge runs those 10'.
  near(r.ridgeFeet, 40 + 10, "the house's ridge and the cross gable's");
  const valleys = linesOf(plan, "valley");
  assert(valleys.length === 2, `${valleys.length} valleys`);
  for (const v of valleys) {
    near(Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y), Math.hypot(5, 10), "a valley's run: 5 across, 10 in");
    near(v.feet, 5 * Math.sqrt(6), "a valley: 5 x sqrt(1 + 4 + 1)");
  }
  // The gable's face: 5 across and 5 up each side.
  near(r.rakeFeet, 2 * 30 * F6 + 2 * 5 * Math.SQRT2, "the house's rakes and the cross gable's");
  near(r.eaveFeet, 30 + 40, "eaves either side of it and the rear");
  // It takes two triangles of 5 x 10 / 2 from the front slope, at 12/12.
  near(r.areaSquareFeet, 1150 * F6 + 50 * Math.SQRT2, "area");
  assert(r.byPitch.map((b) => b.pitch).join() === "12,6", JSON.stringify(r.byPitch));
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const lines = x.exteriorScopeLines(e).roofing;
  assert(lines.includes(`Steep roof charge – 10/12 to 12/12 – ${((50 * Math.SQRT2) / 100).toFixed(2)} SQ`), lines.join(" | "));
  // At the roof's 6/12 it would be as before: 5 in, 45° valleys of 5 x 1.5.
  const same = roofOf(rect(40, 30, { pitch: 6, eaveOverhangFeet: 0, rakeOverhangFeet: 0, additions: [{ id: "cg", kind: "gable", sideId: "front", fromFeet: 15, toFeet: 25 }] })).roofing;
  near(same.valleyFeet, 2 * 5 * 1.5, "one pitch: two valleys of 7'6\"");
  near(same.areaSquareFeet, 1200 * F6, "one pitch: no more roof");
});

test("a lean-to at its own 3/12, and a porch breaking flatter off the slope above - no crease counted where it breaks", () => {
  const leanto = roofOf(rect(40, 30, { pitch: 6, eaveOverhangFeet: 0, rakeOverhangFeet: 0, additions: [{ id: "lt", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 40, depthFeet: 8, lower: true }], sectionPitches: { lt: 3 } })).roof;
  const lower = leanto.facets.find((f) => f.layer === 1);
  assert(lower.pitch === 3, `${lower.pitch}`);
  near(lower.areaSquareFeet, 320 * F3, "8 x 40 at 3/12");
  near(leanto.totals.headwall, 40, "headwall along the wall");
  // Its ends: 8 run, 2 up.
  near(leanto.edges.filter((g) => g.layer === 1 && g.kind === "rake").reduce((s, g) => s + g.feet, 0), 2 * Math.hypot(8, 2), "the lean-to's rakes at 3/12");
  const porch = (pitch) =>
    roofOf(rect(40, 30, { pitch: 6, eaveOverhangFeet: 1, rakeOverhangFeet: 0, additions: [{ id: "p", kind: "porch", sideId: "front", fromFeet: 0, toFeet: 40, depthFeet: 8 }], sectionPitches: pitch === null ? {} : { p: pitch } }));
  const carried = porch(null).roof;
  assert(carried.facets.length === 2, `at the slope's pitch the porch is that slope: ${carried.facets.length} slopes`);
  const broken = porch(3);
  assert(broken.roof.facets.length === 3, `broken flatter it is a slope of its own: ${broken.roof.facets.length}`);
  near(broken.roof.totals.valley + broken.roof.totals.hip, 0, "no valley or hip where the pitch changes");
  // The house 40 x 32 at 6/12, the porch 40 x 7 past the drip line at 3/12; its ends 7 run and 1'9" down.
  near(broken.roofing.areaSquareFeet, 1280 * F6 + 280 * F3, "area");
  near(broken.roof.totals.rake, 2 * 32 * F6 + 2 * Math.hypot(7, 1.75), "rakes");
});

test("a tap on a section sets its pitch; the roof's own is the main's, and a blank goes back to it", () => {
  let roof = x.defaultRoof();
  roof = x.withSectionPitch(roof, "wing:g", 4);
  assert(roof.sectionPitches["wing:g"] === 4, JSON.stringify(roof.sectionPitches));
  roof = x.withSectionPitch(roof, "main", 7);
  assert(roof.pitch === 7 && roof.sectionPitches.main === undefined, "the main's is the roof's pitch");
  roof = x.withSectionPitch(roof, "wing:g", null);
  assert(roof.sectionPitches["wing:g"] === undefined, "cleared");
  // A side taken away takes its wing's pitch with it.
  roof = x.withSectionPitch(roof, "wing:g", 4);
  assert(x.roofWithoutSides(roof, (id) => id === "g").sectionPitches["wing:g"] === undefined, "gone with its side");
});

test("3D: the house and its 4/12 garage, and the 12/12 cross gable, stand on their walls with no crack between slopes", () => {
  soundRoof(houseAndGarage({ pitch: 6, eaveOverhangFeet: ft(1, 4), rakeOverhangFeet: 1, sectionPitches: { "wing:garageFront": 4 } }), "6/12 house, 4/12 garage");
  // The cross gable's face closes the front wall under it, as at one pitch: 10 across, 5' up at 12/12.
  const { m } = soundRoof(rect(40, 30, { pitch: 6, additions: [{ id: "cg", kind: "gable", sideId: "front", fromFeet: 15, toFeet: 25 }], sectionPitches: { cg: 12 } }), "12/12 cross gable on 6/12", ["front"]);
  const ys = m.roof.gables.filter((_, i) => i % 3 === 1);
  near(Math.max(...ys) - Math.min(...ys), 5, "its face 5' high");
});

console.log("\ntwo storeys: an upper floor over the main floor (10-14)");

/** An upper floor walked as its sides, [id, length, the corner at its end] each, 9' from the floor line to its eave, its first corner at `at`. */
function upperOf(list, at = { sideId: "front", dx: 0, dy: 0 }) {
  return { sides: list.map(([id, lengthFeet, turn]) => side({ id, name: id, lengthFeet, turn: turn ?? "outside", base: "grade", eaveLeftFeet: 9, eaveRightFeet: 9 })), at };
}
const upperBox = (w, d, at) =>
  upperOf(
    [
      ["uFront", w],
      ["uRight", d],
      ["uRear", w],
      ["uLeft", d],
    ],
    at,
  );

/** A two-storey house 30 x 24 with a one-storey garage 22 x 24 at its right, flush front and back: the main floor 52 x 24, the upper 30 x 24 over the left. */
function boxAndGarage(roof = {}) {
  const e = walked(
    [
      ["front", 52, "outside"],
      ["right", 24, "outside"],
      ["rear", 52, "outside"],
      ["left", 24, "outside"],
    ],
    { pitch: 6, ...roof },
  );
  e.upper = upperBox(30, 24);
  return e;
}

/** A two-storey house 30 x 24 with a one-storey bump-out 16 wide and 10 deep on the middle of its back. */
function boxAndBumpOut(roof = {}) {
  const e = walked(
    [
      ["front", 30, "outside"],
      ["right", 24, "outside"],
      ["rearRight", 7, "inside"],
      ["bumpRight", 10, "outside"],
      ["bumpRear", 16, "outside"],
      ["bumpLeft", 10, "inside"],
      ["rearLeft", 7, "outside"],
      ["left", 24, "outside"],
    ],
    { pitch: 6, ...roof },
  );
  e.upper = upperBox(30, 24);
  return e;
}

test("a two-storey box with a one-storey garage: the house's roof over the upper floor, the garage's lower, stopping at its wall", () => {
  const q = roofOf(boxAndGarage());
  const plan = q.roof;
  const r = q.roofing;
  assert(plan.note === null, plan.note);
  const upper = plan.sections.filter((s) => s.floor === "upper");
  const lower = plan.sections.filter((s) => s.floor === "main");
  assert(upper.length === 1 && upper[0].layer === 0, `${upper.length} upper sections`);
  assert(lower.length === 1 && lower[0].layer === 1, `${lower.length} lower sections`);
  // The garage, 22 out from the wall and 24 along it, is deeper than a strip: its ridge runs out from the wall.
  assert(plan.lowerRoofs.length === 1 && plan.lowerRoofs[0].sideId === "right" && plan.lowerRoofs[0].kind === "tent", JSON.stringify(plan.lowerRoofs));
  // The house: 30 x 24 at 6/12, its ridge along the 30, 6' up. The garage: 22 x 24, its ridge 22 out from the wall, 6' up.
  near(r.ridgeFeet, 30 + 22, "two ridges");
  near(r.rakeFeet, 2 * 24 * F6 + 24 * F6, "the house's two gable ends and the garage's one");
  near(r.eaveFeet, 30 + 30 + 22 + 22, "eaves");
  // The garage's two slopes up the house's right wall: 12 run, 6 up each.
  near(r.stepFeet, 2 * Math.hypot(12, 6), "step flashing");
  near(r.valleyFeet + r.hipFeet + r.headwallFeet, 0, "no valleys, hips or headwall");
  near(r.areaSquareFeet, (720 + 528) * F6, "area");
  // The high-roof charge is the upper floor's roof's by itself, and nothing asks for it.
  assert(r.high && r.high.automatic, JSON.stringify(r.high));
  near(r.high.squares, (720 * F6) / 100, "high roof squares");
  assert(!r.toAnswer.roofing.some((t) => /two storeys/.test(t)), "not asked");
  // The main floor's sides stop at its eave: its left wall under the upper floor carries no gable; its right one the garage's.
  assert(!q.rises.left && !q.rises.front, "no gable on a main-floor wall under the upper floor");
  near(gableOf(q, "right"), (24 * 6) / 2, "the garage's gable on the right");
  near(gableOf(q, "uLeft"), (24 * 6) / 2, "the house's gable on the upper floor's left");
  // The upper right wall stands on the garage roof: its 9' wall and 6' gable, less the garage roof's 6' triangle.
  const uRight = q.sides.find((s) => s.sideId === "uRight");
  assert(q.bases.uRight && !q.bases.uFront, "the upper right stands on the garage roof; the upper front on the floor line");
  near(uRight.grossSquareFeet, 24 * 9 + (24 * 6) / 2 - (24 * 6) / 2, "the upper right's cladding");
  near(q.sides.find((s) => s.sideId === "uFront").grossSquareFeet, 30 * 9, "the upper front: 30 x 9");
  near(q.sides.find((s) => s.sideId === "front").grossSquareFeet, 52 * 10, "the main front: one storey");
  // The scope: the high charge said to be the upper floor's roof's.
  const e = boxAndGarage();
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  assert(x.exteriorScopeLines(e).roofing.includes(`High roof charge – two storeys or more – ${((720 * F6) / 100).toFixed(2)} SQ (the roof over the upper floor)`), x.exteriorScopeLines(e).roofing.join(" | "));
});

test("a two-storey with a one-storey bump-out on the back: its own roof against the back wall, as a gable or as a lean-to", () => {
  const tent = roofOf(boxAndBumpOut());
  assert(tent.roof.note === null, tent.roof.note);
  // 10 out and 16 along: deeper than half its width, so a ridge running out from the wall, 8 x 1/2 = 4' up.
  assert(tent.roof.lowerRoofs.map((l) => `${l.sideId}:${l.kind}`).join() === "bumpRear:tent", JSON.stringify(tent.roof.lowerRoofs));
  near(tent.roofing.ridgeFeet, 30 + 10, "the house's ridge and the bump-out's");
  near(tent.roofing.stepFeet, 2 * Math.hypot(8, 4), "its slopes flashed up the back wall");
  near(tent.roofing.rakeFeet, 2 * 24 * F6 + 16 * F6, "rakes");
  near(tent.roofing.eaveFeet, 60 + 20, "eaves: the house's front and back, the bump-out's two sides");
  near(tent.roofing.areaSquareFeet, (720 + 160) * F6, "area");
  // The upper rear stands on it: 0 either side, 4' at its ridge.
  near(Math.max(...tent.bases.uRear.map((b) => b.rise)), 4, "the bump-out's ridge on the upper rear wall");
  near(tent.sides.find((s) => s.sideId === "uRear").grossSquareFeet, 30 * 9 - (16 * 4) / 2, "the upper rear less the bump-out roof's triangle");
  assert(!tent.rises.rearLeft && !tent.rises.rearRight, "the main floor's rear either side is under the upper floor: no gable");
  near(gableOf(tent, "bumpRear"), (16 * 4) / 2, "the bump-out's gable end");

  const lean = roofOf(boxAndBumpOut({ lowerRoofs: { bumpRear: "leanto" } }));
  assert(lean.roof.lowerRoofs[0].kind === "leanto", "said to be a lean-to");
  // One slope from its eave at the back up 10 to the wall: 5' up; level against the wall, so headwall flashing.
  near(lean.roofing.headwallFeet, 16, "headwall along the back wall");
  near(lean.roofing.stepFeet, 0, "no step flashing");
  near(lean.roofing.ridgeFeet, 30, "only the house's ridge");
  near(lean.roofing.rakeFeet, 2 * 24 * F6 + 2 * Math.hypot(10, 5), "its two ends are rakes");
  near(lean.roofing.eaveFeet, 60 + 16, "its eave at the back");
  near(lean.roofing.areaSquareFeet, (720 + 160) * F6, "the same area");
  near(lean.sides.find((s) => s.sideId === "uRear").grossSquareFeet, 30 * 9 - 16 * 5, "the upper rear less the lean-to's 5' along 16'");
});

test("two storeys with overhangs: the upper floor's eaves overhang the lower roofs, and a strip along a wall is a lean-to by itself", () => {
  // A main floor 30 x 32 under an upper floor 30 x 24 at its front: the 8' strip at the back is a lean-to.
  const e = walked(
    [
      ["front", 30, "outside"],
      ["right", 32, "outside"],
      ["rear", 30, "outside"],
      ["left", 32, "outside"],
    ],
    { pitch: 6, eaveOverhangFeet: 1, rakeOverhangFeet: 1 },
  );
  e.upper = upperBox(30, 24);
  const q = roofOf(e);
  assert(q.roof.lowerRoofs.map((l) => `${l.sideId}:${l.kind}`).join() === "rear:leanto", JSON.stringify(q.roof.lowerRoofs));
  // The lean-to: 8 deep plus its 1' eave, 30 along plus a 1' rake each end, rising to the wall.
  const lower = q.roof.facets.filter((f) => f.layer > 0);
  near(lower.reduce((s, f) => s + f.planSquareFeet, 0), 9 * 32, "the lean-to's plan");
  // Against the wall along its 30'; its top past the house's corners, under the eave above, is no flashing.
  near(q.roof.totals.headwall, 30, "headwall along the wall");
  // The house's roof: 32 x 26 with its overhangs, at layer 0, over the lean-to's top.
  near(q.roof.facets.filter((f) => f.layer === 0).reduce((s, f) => s + f.planSquareFeet, 0), 32 * 26, "the upper floor's roof");
  // The upper rear stands on the lean-to: 8 x 1/2 = 4' above the floor line all along.
  near(Math.min(...q.bases.uRear.map((b) => b.rise)), 4, "the lean-to's top at the wall");
});

test("the upper floor is put on the main floor's plan: from a corner, its walls on the main floor's within a foot", () => {
  const e = boxAndGarage();
  // Drawn 6" short of the main floor's walls, and 6" in from the corner: snapped onto them.
  e.upper = upperOf(
    [
      ["uFront", 29.5, "outside"],
      ["uRight", 23.5, "outside"],
      ["uRear", 29.5, "outside"],
      ["uLeft", 23.5, "outside"],
    ],
    { sideId: "front", dx: 0.5, dy: 0.5 },
  );
  const fp = x.upperFootprint(e, x.exteriorFootprint(e));
  assert(fp.closes, fp.reason);
  const xs = [...new Set(fp.corners.map((c) => c.x))].sort((a, b) => a - b);
  const ys = [...new Set(fp.corners.map((c) => c.y))].sort((a, b) => a - b);
  assert(xs.join() === "0,30" && ys.join() === "0,24", `${xs} / ${ys}`);
  // Set 4' in from the main floor's walls, it stays where it is drawn: a floor set back, its roof lower all round.
  e.upper = upperOf(
    [
      ["uFront", 20, "outside"],
      ["uRight", 16, "outside"],
      ["uRear", 20, "outside"],
      ["uLeft", 16, "outside"],
    ],
    { sideId: "front", dx: 4, dy: 4 },
  );
  const back = x.upperFootprint(e, x.exteriorFootprint(e));
  assert(back.corners[0].x === 4 && back.corners[0].y === 4, JSON.stringify(back.corners[0]));
  const q = roofOf(e);
  assert(!/runs past|doesn't come apart/.test(q.roof.note ?? "") && q.roof.sections.some((s) => s.floor === "main"), q.roof.note);
  // Running past the main floor's walls, it is said, and the roof is the main floor's alone.
  e.upper = upperBox(60, 24);
  const past = roofOf(e).roof;
  assert(/runs past the main floor's walls/.test(past.note ?? ""), past.note ?? "no note");
});

test("one storey stays as it was: no upper floor, no high charge unless answered", () => {
  const q = roofOf(rect(40, 30, { pitch: 6 }));
  assert(q.upperFootprint === null && Object.keys(q.bases).length === 0, "no upper floor");
  assert(q.roofing.high === null && q.roofing.toAnswer.roofing.includes("two storeys or higher, yes or no"), "asked");
  const yes = roofOf(rect(40, 30, { pitch: 6, high: true })).roofing;
  assert(yes.high && !yes.high.automatic && Math.abs(yes.high.squares - yes.squares) < 1e-9, JSON.stringify(yes.high));
});

test("3D: a two-storey box and its garage stand up - main walls to the floor line, the upper walls on it and on the garage roof", () => {
  const e = boxAndGarage({ eaveOverhangFeet: ft(1, 4), rakeOverhangFeet: 1 });
  // The main floor's front, rear and left run on up as the upper floor's: checked below rather than against a roof.
  const { m } = soundRoof(e, "two storeys and a garage", ["front", "rear", "left"]);
  const wall = (id) => m.walls.find((w) => w.sideId === id);
  const bottomOf = (w) => w.outline.slice(0, w.bottomPoints ?? 2);
  near(m.eaves[0], 10 + 9, "the house's eave: the floor line and the upper sides' 9'");
  near(wallTopAt(wall("left"), 12), 10, "the main left wall stands to the floor line");
  near(wallTopAt(wall("front"), 10), 10, "so does the main front under the upper floor");
  near(Math.min(...bottomOf(wall("uLeft")).map((p) => p.y)), 10, "the upper left stands on it");
  // The upper right stands on the garage roof: 6' over the floor line at the garage's ridge, on the floor line at its eaves.
  const b = bottomOf(wall("uRight"));
  near(Math.max(...b.map((p) => p.y)), 10 + 6, "on the garage roof's ridge");
  near(Math.min(...b.map((p) => p.y)), 10, "and its eaves");
  // And that roof's underside meets it there.
  const u = wall("uRight");
  const mid = b.reduce((best, p) => (p.y > best.y ? p : best), b[0]);
  const hs = undersides(m, planOf(u, mid.x, -0.01));
  assert(hs.some((h) => Math.abs(h - mid.y) < 0.02), `the garage roof at the wall: ${hs.map((h) => h.toFixed(3)).join(" / ")}, the wall's foot ${mid.y.toFixed(3)}`);
});

test("3D: the bump-out's lean-to meets the upper rear wall along a level line", () => {
  const e = boxAndBumpOut({ lowerRoofs: { bumpRear: "leanto" } });
  const { m } = soundRoof(e, "two storeys and a lean-to", ["front", "right", "left", "rearLeft", "rearRight"]);
  const u = m.walls.find((w) => w.sideId === "uRear");
  const b = u.outline.slice(0, u.bottomPoints);
  // 10 deep at 6/12: 5' over the floor line, all along the 16' it is against.
  near(Math.max(...b.map((p) => p.y)), 10 + 5, "the lean-to's top on the wall");
});

console.log("\ntwo storeys, more of them right: wrap-arounds, lengths retyped, tall sides split, cantilevers (10-15)");

/** A main floor of [list] (walked, no overhangs) under an upper floor of [ups] set at [at], 6/12. */
function twoStorey(list, ups, at, roof = {}) {
  const e = walked(list, { pitch: 6, ...roof });
  e.upper = upperOf(ups, at);
  return e;
}
const box4 = (w, d, pre = "") => [
  [`${pre}front`, w, "outside"],
  [`${pre}right`, d, "outside"],
  [`${pre}rear`, w, "outside"],
  [`${pre}left`, d, "outside"],
];
const R5 = Math.sqrt(5);
const sideQ = (q, id) => q.sides.find((s) => s.sideId === id);
/** Main 38 x 32 under an upper floor 30 x 24 at its front left: the main floor's rear and right strips round the upper floor's rear right corner. */
/** An upper floor's four sides, uFront round to uLeft. */
const ubox = (w, d) => box4(w, d).map(([id, l, t]) => [`u${id.charAt(0).toUpperCase()}${id.slice(1)}`, l, t]);
const wrapped = (roof) => twoStorey(box4(38, 32), ubox(30, 24), undefined, roof);
/** The lower roofs: their sections, and their lines by kind. */
const lowerOf = (q) => ({ sections: q.roof.sections.filter((s) => s.floor === "main"), lines: (kind) => q.roof.lines.filter((l) => l.layer > 0 && l.kind === kind) });
/** The worst gap between a wall's top and the roof's underside just inside it, from u0 to u1 along it. */
function gapAlong(m, sideId, u0, u1) {
  const w = m.walls.find((v) => v.sideId === sideId);
  let worst = 0;
  for (let k = 0; k < 20; k++) {
    const u = u0 + ((k + 0.37) / 20) * (u1 - u0);
    const top = wallTopAt(w, u);
    const hs = undersides(m, planOf(w, u, 0.01));
    worst = Math.max(worst, hs.length === 0 ? Infinity : Math.min(...hs.map((h) => Math.abs(h - top))));
  }
  return worst;
}
/** The worst gap between an upper wall's foot, where it stands on a lower roof, and that roof's underside just outside it. */
function footGap(m, sideId) {
  const w = m.walls.find((v) => v.sideId === sideId);
  const foot = w.outline.slice(0, w.bottomPoints);
  let worst = 0;
  for (let k = 0; k < 20; k++) {
    const u = ((k + 0.37) / 20) * w.length;
    const i = foot.findIndex((p, j) => j + 1 < foot.length && u >= p.x - 1e-9 && u <= foot[j + 1].x + 1e-9);
    const p = foot[i];
    const q = foot[i + 1];
    const y = p.y + ((q.y - p.y) * (u - p.x)) / (q.x - p.x || 1);
    const hs = undersides(m, planOf(w, u, -0.01));
    worst = Math.max(worst, hs.length === 0 ? Infinity : Math.min(...hs.map((h) => Math.abs(h - y))));
  }
  return worst;
}

test("lean-tos round the upper floor's outside corner are one roof, hipped at the corner and flashed along both walls", () => {
  // The owner's repro (10-14): main 38 x 32, upper 30 x 24 at its front left, 6/12, no overhangs. Before: three
  // roofs, one forced lower. Now the rear strip (8 deep, 30 along) and the right one (8 out, 24 along) are lean-tos
  // run on over the 8 x 8 square past the corner, the lower of the two the roof: a hip from the main floor's
  // corner (38,32) in to the upper floor's (30,24), 8√2 across and 4' up - √(128 + 16) = 12.
  const q = roofOf(wrapped());
  const low = lowerOf(q);
  assert(q.roof.note === null, q.roof.note);
  assert(new Set(low.sections.map((s) => s.layer)).size === 1, `${new Set(low.sections.map((s) => s.layer)).size} lower roofs`);
  assert(q.roof.lowerRoofs.map((l) => `${l.sideId}:${l.kind}`).join() === "right:leanto,rear:leanto", JSON.stringify(q.roof.lowerRoofs));
  near(sum(low.lines("hip")), 12, "one hip at the corner");
  near(sum(low.lines("valley")) + sum(low.lines("step")) + sum(low.lines("ridge")), 0, "no valley, step flashing or ridge");
  // Both tops level against the upper walls at 8 x 1/2 = 4': headwall all along both.
  near(q.roofing.headwallFeet, 24 + 30, "headwall along the upper right and rear");
  near(q.roofing.eaveFeet, 30 + 30 + 32 + 38, "eaves: the house's two, the lean-tos' right and rear");
  // Each lean-to's open end a rake, 8 run and 4 up; the house's four, 12 run and 6 up.
  near(q.roofing.rakeFeet, 2 * 4 * R5 + 4 * 6 * R5, "rakes");
  near(q.roofing.areaSquareFeet, (38 * 32) * F6, "area: the main floor's plan, every slope 6/12");
  // The upper right and rear stand on the lean-to's top, 4' over the floor line all along.
  for (const id of ["uRight", "uRear"]) near(Math.min(...q.bases[id].map((b) => b.rise)), 4, `${id} on the lean-to`, 1e-3);
  // The main floor's front and left carry the lean-tos' end triangles (8 across, 4 up), nothing more.
  near(gableOf(q, "front"), 16, "the right lean-to's end over the front");
  near(gableOf(q, "left"), 16, "the rear lean-to's end over the left");
  // With 1' overhangs it is still one roof, its hip from the drip line's corner: 9√2 across, 4'6" up - 13'6".
  const oh = roofOf(wrapped({ eaveOverhangFeet: 1, rakeOverhangFeet: 1 }));
  assert(oh.roof.note === null && new Set(lowerOf(oh).sections.map((s) => s.layer)).size === 1, oh.roof.note ?? "two lower roofs");
  near(sum(lowerOf(oh).lines("hip")), 13.5, "the hip with overhangs");
});

test("lean-tos round three sides and all the way round: hipped at every corner, two drip lines when they close round", () => {
  // Main 40 x 32, upper 30 x 24 5' in from each side, flush at the front: strips 5 wide either side and 8 deep behind.
  // The hips run in from the main floor's corners at 45°: from (40,32) they reach the upper rear wall at (32,24), so
  // 3' of the right lean-to's slope runs up that wall from 2'6" to 4' - step flashing, √(9 + 2.25) - either side.
  const three = roofOf(twoStorey(box4(40, 32), ubox(30, 24), { sideId: "front", dx: 5, dy: 0 }));
  const low3 = lowerOf(three);
  assert(three.roof.note === null && new Set(low3.sections.map((s) => s.layer)).size === 1, three.roof.note ?? "more than one lower roof");
  near(sum(low3.lines("hip")), 2 * 12, "two hips");
  near(three.roofing.stepFeet, 2 * Math.hypot(3, 1.5), "step flashing where a side lean-to runs up the rear wall");
  near(three.roofing.headwallFeet, 24 + 24 + 24, "headwall: both upper sides at 2'6\", the rear's middle 24' at 4'");
  near(three.roofing.eaveFeet, 60 + 32 + 40 + 32, "eaves");
  near(three.roofing.rakeFeet, 2 * Math.hypot(5, 2.5) + 4 * Math.hypot(12, 6), "the side lean-tos' front ends, and the house's four rakes");
  // Main 38 x 30, upper 30 x 22 4' in all round: four lean-tos hipped at four corners, √(32 + 4) = 6 each, and
  // headwall all round the upper floor - the roof's second drip line, against its walls.
  const ring = roofOf(twoStorey(box4(38, 30), ubox(30, 22), { sideId: "front", dx: 4, dy: 4 }));
  const lowR = lowerOf(ring);
  assert(ring.roof.note === null && new Set(lowR.sections.map((s) => s.layer)).size === 1, ring.roof.note ?? "more than one lower roof");
  near(sum(lowR.lines("hip")), 4 * 6, "four hips");
  near(ring.roofing.headwallFeet, 2 * 30 + 2 * 22, "headwall all round the upper floor");
  near(sum(lowR.lines("rake")), 0, "no rakes: hipped all round");
  near(sum(lowR.lines("eave")), 2 * 38 + 2 * 30, "eaves all round the main floor");
  assert(new Set(ring.roof.edges.filter((e) => e.layer > 0).map((e) => e.loop)).size === 2, "two drip lines: the main floor's and the upper floor's");
  for (const id of ["uFront", "uRight", "uRear", "uLeft"]) near(Math.min(...ring.bases[id].map((b) => b.rise)), 2, `${id} on the lean-to, 4 x 1/2 up`, 1e-3);
});

test("round the upper floor's inside corner the lean-tos meet in a valley; a notch filling it is one roof rising to both walls", () => {
  // Main L (0,0)-(48,0)-(48,18)-(28,18)-(28,38)-(0,38) round an upper L (0,0)-(40,0)-(40,10)-(20,10)-(20,30)-(0,30):
  // an 8' strip all round its right and back. The short strip up the upper right (10 along, 8 out) is a lean-to run on
  // over the corner square. Hipped at (48,18) and (28,38), each 12; at the upper floor's inside corner (20,10) the
  // two strips meet in a valley out to the main floor's inside corner (28,18): 8√2 across, 4' down - 12.
  const e = twoStorey(
    [
      ["front", 48, "outside"],
      ["right", 18, "outside"],
      ["rightRear", 20, "inside"],
      ["inside", 20, "outside"],
      ["rear", 28, "outside"],
      ["left", 38, "outside"],
    ],
    [
      ["uFront", 40, "outside"],
      ["uRight", 10, "outside"],
      ["uRightRear", 20, "inside"],
      ["uInside", 20, "outside"],
      ["uRear", 20, "outside"],
      ["uLeft", 30, "outside"],
    ],
  );
  const q = roofOf(e);
  const low = lowerOf(q);
  assert(q.roof.note === null && new Set(low.sections.map((s) => s.layer)).size === 1, q.roof.note ?? "more than one lower roof");
  assert(q.roof.lowerRoofs.every((l) => l.kind === "leanto") && q.roof.lowerRoofs.length === 4, JSON.stringify(q.roof.lowerRoofs));
  near(sum(low.lines("valley")), 12, "the valley at the inside corner");
  near(sum(low.lines("hip")), 24, "a hip at each outside corner");
  near(q.roofing.headwallFeet, 20 + 20 + 10 + 20, "headwall along every upper wall it meets");
  near(q.roofing.stepFeet, 0, "no step flashing");
  // Main 40 x 30 under an upper L leaving its rear right 20 x 20: deeper than a strip either way, so no ridge running
  // out along one wall with a slope down into the other. One roof rising from the rear and right eaves to both walls:
  // a hip from (40,30) to (20,10), 20√2 across and 10' up - 30; each slope up its wall from 0 to 10, step flashing.
  const f = roofOf(
    twoStorey(box4(40, 30), [
      ["uFront", 40, "outside"],
      ["uRight", 10, "outside"],
      ["uRightRear", 20, "inside"],
      ["uInside", 20, "outside"],
      ["uRear", 20, "outside"],
      ["uLeft", 30, "outside"],
    ]),
  );
  const lowF = lowerOf(f);
  assert(f.roof.note === null && new Set(lowF.sections.map((s) => s.layer)).size === 1, f.roof.note ?? "more than one lower roof");
  near(sum(lowF.lines("hip")), 30, "one hip from the corner in");
  near(sum(lowF.lines("ridge")), 0, "no ridge");
  near(f.roofing.stepFeet, 2 * Math.hypot(20, 10), "step flashing up both walls");
  // Said to be a ridge running out from the wall, it is that, as before.
  const tent = roofOf(twoStorey(box4(40, 30), [["uFront", 40, "outside"], ["uRight", 10, "outside"], ["uRightRear", 20, "inside"], ["uInside", 20, "outside"], ["uRear", 20, "outside"], ["uLeft", 30, "outside"]], undefined, { lowerRoofs: { rear: "tent" } }));
  assert(sum(lowerOf(tent).lines("ridge")) > 0, "a ridge when said");
});

test("3D: the wrap-arounds stand up - walls under their eaves and rakes, the upper walls on the lean-tos' tops", () => {
  // The repro: the main front and left run on up as the upper floor's except past it, where they carry the lean-tos' ends.
  const { m } = soundRoof(wrapped({ eaveOverhangFeet: 1, rakeOverhangFeet: 1 }), "wrap-around", ["front", "left"]);
  assert(gapAlong(m, "front", 30.2, 38) < 0.02, "the main front under the right lean-to's end");
  assert(gapAlong(m, "left", 0, 7.8) < 0.02, "the main left under the rear lean-to's end");
  for (const id of ["uRight", "uRear"]) assert(footGap(m, id) < 0.02, `${id}'s foot on the lean-to`);
  near(m.eaves[0], 10 + 9, "the house's eave");
  // All the way round: every main wall is under the lean-tos' eaves, and every upper wall stands on them.
  const ring = twoStorey(box4(38, 30), ubox(30, 22), { sideId: "front", dx: 4, dy: 4 }, { eaveOverhangFeet: 1, rakeOverhangFeet: 1 });
  const r = soundRoof(ring, "all the way round").m;
  for (const id of ["uFront", "uRight", "uRear", "uLeft"]) assert(footGap(r, id) < 0.02, `${id}'s foot on the lean-to`);
});

test("a main-floor length typed moves the upper floor's walls flush with it: its sides stretch, a typed one stands", () => {
  // Drawn: main 40 x 30, an upper floor 30 x 24 flush at the front and right, set by the main floor's front-left corner.
  const main = x.exteriorFromOutline([P(0, 0), P(40, 0), P(40, 30), P(0, 30)]);
  const up = x.upperFromOutline([P(10, 0), P(40, 0), P(40, 24), P(10, 24)], x.exteriorFootprint(main));
  up.sides[0].openings = [{ id: "w", kind: "window", widthFeet: 3, heightFeet: 4, sillFeet: 3, fromLeftFeet: 5 }];
  const e = { ...main, upper: up };
  const corners = (ex) => x.upperFootprint(ex, x.exteriorFootprint(ex)).corners.map((c) => `${c.x},${c.y}`).join(" ");
  // The front typed 44: the right wall moves out 4, the upper floor's right with it; its front and rear 34, its left where it was.
  const wider = x.withSideLength(e, byName(e, "Front").id, 44);
  assert(corners(wider) === "10,0 44,0 44,24 10,24", corners(wider));
  assert(wider.upper.sides.map((s) => s.lengthFeet).join() === "34,24,34,24", wider.upper.sides.map((s) => s.lengthFeet).join());
  assert(wider.upper.sides[0].openings[0].fromLeftFeet === 5, "the window keeps its place from the left corner, which did not move");
  // Still flush: no strip of lower roof down the right.
  assert(!roofOf(wider).roof.sections.some((s) => s.floor === "main" && s.x0 > 40), "no roof between the walls");
  // The right typed 34: the rear moves back, and the upper floor - 24 deep, its rear on no line - stays.
  const deeper = x.withSideLength(wider, byName(wider, "Right").id, 34);
  assert(corners(deeper) === "10,0 44,0 44,24 10,24", corners(deeper));
  // Over the whole main floor, its rear follows the rear.
  const whole = { ...main, upper: x.upperFromOutline(x.exteriorFootprint(main).corners, x.exteriorFootprint(main)) };
  const back = x.withSideLength(whole, byName(whole, "Right").id, 34);
  assert(corners(back) === "0,0 40,0 40,34 0,34", corners(back));
  // An upper side typed is a measurement: the front typed 46 leaves the upper floor 34 wide, 2' short of the right wall.
  const typed = x.withUpperSideLength(wider, wider.upper.sides[0].id, 34);
  const off = x.withSideLength(typed, byName(typed, "Front").id, 46);
  assert(corners(off) === "10,0 44,0 44,24 10,24", corners(off));
});

test("tall sides split at the floor line: the eave down to it, what is above onto the upper side, nothing counted twice", () => {
  // A 30 x 24 two-storey box taped as tall sides: 19' to the upper eave, the right on a lot falling 1' to the back
  // (19' and 20'), the gables measured on the right and left 6' up (6/12), stone to 3' and vinyl over it on the front,
  // a door and an upstairs window (sill 13'). The upper floor drawn over the whole main floor.
  const e = exterior(
    [
      side({ baseLeftFeet: 0.5, baseRightFeet: 0.5, id: "front", name: "Front", eaveLeftFeet: 19, eaveRightFeet: 19, bands: [{ id: "st", kind: "stone", top: 3 }, { id: "v", kind: "vinyl", top: null }], openings: [{ id: "door", kind: "door", widthFeet: 3, heightFeet: 7, sillFeet: 0.5, fromLeftFeet: 5 }, { id: "up", kind: "window", widthFeet: 4, heightFeet: 4, sillFeet: 13, fromLeftFeet: 10 }] }),
      side({ baseLeftFeet: 0.5, baseRightFeet: 0.5, id: "right", name: "Right", lengthFeet: 24, eaveLeftFeet: 19, eaveRightFeet: 20, gable: { peakFeet: 25.5, atFeet: 12 } }),
      side({ baseLeftFeet: 0.5, baseRightFeet: 0.5, id: "rear", name: "Rear", eaveLeftFeet: 19, eaveRightFeet: 19 }),
      side({ baseLeftFeet: 0.5, baseRightFeet: 0.5, id: "left", name: "Left", lengthFeet: 24, eaveLeftFeet: 19, eaveRightFeet: 19, gable: { peakFeet: 25, atFeet: 12 } }),
    ],
    { pitch: null },
  );
  const tallOnly = x.exteriorQuantities(e);
  const fp = x.exteriorFootprint(e);
  e.upper = x.upperFromOutline(fp.corners, fp);
  const tall = x.tallSides(e);
  assert(tall.map((t) => t.name).join() === "Front,Right,Rear,Left", tall.map((t) => t.name).join());
  // Before the split the tall sides and the upper ones both count the upper storey.
  assert(x.exteriorQuantities(e).totals.grossSquareFeet > tallOnly.totals.grossSquareFeet + 900, "counted twice before");
  const s = x.splitTallSides(e, 10);
  const named = (n) => [...s.sides, ...s.upper.sides].find((v) => v.name === n);
  // The floor line 10' up: the front's eave there, the upper front's 9' above it, the window on it 3' up, the door below.
  assert(named("Front").eaveLeftFeet === 10 && named("Upper front").eaveLeftFeet === 9, `${named("Front").eaveLeftFeet} / ${named("Upper front").eaveLeftFeet}`);
  assert(named("Front").openings.map((o) => o.id).join() === "door", "the door stays");
  const w = named("Upper front").openings.find((o) => o.id === "up");
  assert(w && w.fromLeftFeet === 10 && w.sillFeet === 3, JSON.stringify(w));
  assert(named("Front").bands.map((b) => `${b.kind}:${b.top}`).join() === "stone:3,vinyl:null" && named("Upper front").bands.map((b) => `${b.kind}:${b.top}`).join() === "vinyl:null", "the stone below, vinyl on both");
  // On the falling lot the floor line is level: 9'6" and 10'6" over the ground at the right's two corners, the
  // upper right 9'6" over it, and the gable's peak (25' on the side's frame) 15'6".
  assert(named("Right").eaveLeftFeet === 9.5 && named("Right").eaveRightFeet === 10.5, `${named("Right").eaveLeftFeet} / ${named("Right").eaveRightFeet}`);
  near(named("Upper right").eaveLeftFeet, 9.5, "the upper right's eave");
  near(named("Upper right").gable.peakFeet, 15.5, "its gable, from the floor line");
  assert(named("Right").gable === null, "no gable left on the main right");
  const q = x.exteriorQuantities(s);
  // Nothing counted twice, nothing lost: the cladding is the tall sides' own, 2,154 SF - main 285 + 228 + 285 + 228
  // and upper 270 + (228 + 72) + 270 + (216 + 72) - less the door and the window.
  near(q.totals.grossSquareFeet, tallOnly.totals.grossSquareFeet, "the same cladding as the tall sides");
  near(q.totals.grossSquareFeet, 2154, "worked by hand");
  near(q.totals.netSquareFeet, tallOnly.totals.netSquareFeet, "less the same openings");
  near(q.pitch.value, 6, "the pitch off the gables, now the upper sides'");
  assert(x.tallSides(s).length === 0, "none tall now");
  // 3D: the main walls to the floor line at 10', the house's eave 9' over it.
  const m = model3d(s);
  near(m.eaves[-1], 10, "the floor line");
  near(m.eaves[0], 19, "the house's eave");
});

test("a tall side the phone walked splits its shapes at the floor line; parging and photos stay below", () => {
  // One level, a 30' front tapped as stucco from the parging's top (6") to 18'6" and the parging under it, a photo
  // and a door kept for sizes. Split at 10': stucco 30 x 9'6" below, 30 x 8'6" on the upper front - the same 540 SF.
  const e = rect(30, 24, { pitch: 6 }, 18.5);
  const f = e.sides[0];
  Object.assign(f, {
    heightsFrom: "level",
    shapes: [
      { id: "p", kind: "parging", closed: true, polygon: [P(0, 0), P(30, 0), P(30, 0.5), P(0, 0.5)] },
      { id: "s", kind: "stucco", closed: true, polygon: [P(0, 0.5), P(30, 0.5), P(30, 18.5), P(0, 18.5)] },
    ],
    roofline: [{ alongFeet: 0, upFeet: 18.5, outFeet: 1 }, { alongFeet: 30, upFeet: 18.5, outFeet: 1 }],
    pitchMeasured: 6,
    photos: [{ n: 900, scanId: null, camera: { width: 4, height: 3, fx: 1, fy: 1, cx: 2, cy: 1.5 }, toPhoto: [1, 0, 0, 0, 1, 0, 0, 0, 1], inView: null }],
  });
  const fp = x.exteriorFootprint(e);
  e.upper = x.upperFromOutline(fp.corners, fp);
  const before = sideQ(x.exteriorQuantities(e), "front").grossSquareFeet;
  near(before, 540, "the tall front: 30 x 18'");
  const s = x.splitTallSides(e, 10);
  const front = s.sides[0];
  const upFront = s.upper.sides[0];
  near(front.shapes.filter((v) => v.kind === "stucco").reduce((a, v) => a + x.polygonArea(v.polygon), 0), 30 * 9.5, "the main front's stucco");
  near(upFront.shapes.reduce((a, v) => a + x.polygonArea(v.polygon), 0), 30 * 8.5, "the upper front's");
  assert(front.shapes.some((v) => v.kind === "parging") && !upFront.shapes.some((v) => v.kind === "parging"), "the parging stays below");
  assert(front.photos.length === 1 && !upFront.photos, "the photo stays with the ground");
  assert(upFront.roofline.every((p) => p.upFeet === 8.5) && !front.roofline?.length, "the roofline goes up");
  assert(upFront.pitchMeasured === 6 && front.pitchMeasured === undefined, "the phone's pitch is the roof's, over the upper floor");
  const q = x.exteriorQuantities(s);
  near(sideQ(q, "front").grossSquareFeet + sideQ(q, upFront.id).grossSquareFeet, 540, "the same 540 SF");
});

test("an upper floor standing out 2' past the main floor's walls: built, its underside soffit; further out, said", () => {
  // The two-storey box and garage, its upper floor 30 x 26 standing 2' out over the front: the house's roof over
  // that, the garage's as before, and 30 x 2 = 60 SF of floor soffit.
  const e = boxAndGarage();
  e.upper = upperOf(
    [
      ["uFront", 30, "outside"],
      ["uRight", 26, "outside"],
      ["uRear", 30, "outside"],
      ["uLeft", 26, "outside"],
    ],
    { sideId: "front", dx: 0, dy: -2 },
  );
  const q = roofOf(e);
  assert(q.roof.note === null, q.roof.note);
  near(q.roof.facets.filter((f) => f.layer === 0).reduce((s, f) => s + f.planSquareFeet, 0), 30 * 26, "the house's roof over the upper floor as drawn");
  assert(q.roof.lowerRoofs.map((l) => `${l.sideId}:${l.kind}`).join() === "right:tent", JSON.stringify(q.roof.lowerRoofs));
  near(q.floorSoffitSquareFeet, 60, "the floor overhang's underside");
  // On the siding lines with the soffit, and only then.
  e.roof.soffitMaterial = "metal";
  e.scope = { roofing: false, sides: [], soffitFascia: true, eavestrough: false };
  const lines = x.exteriorScopeLines(e).siding;
  assert(lines.includes("Remove & replace soffit – metal – 60.0 SF – floor overhang (the upper floor's underside past the main floor's walls)"), lines.join(" | "));
  e.scope = { ...e.scope, soffitFascia: false };
  assert(!x.exteriorScopeLines(e).siding.some((l) => /floor overhang/.test(l)), "not unless the soffit is ticked");
  // 3D: it stands up, and the underside is a ceiling at the floor line, 60 SF of it.
  const { m } = soundRoof(e, "a cantilever", ["front", "rear", "left"]);
  const ys = m.ceilings.filter((_, i) => i % 3 === 1);
  assert(ys.length > 0 && ys.every((y) => Math.abs(y - 10) < 1e-9), "at the floor line");
  let area = 0;
  for (let i = 0; i < m.ceilings.length; i += 9) area += Math.abs((m.ceilings[i + 3] - m.ceilings[i]) * (m.ceilings[i + 8] - m.ceilings[i + 2]) - (m.ceilings[i + 6] - m.ceilings[i]) * (m.ceilings[i + 5] - m.ceilings[i + 2])) / 2;
  near(area, 60, "the soffit's area");
  // 3' out is more than a cantilever: said, and the roof is the main floor's alone, as before.
  e.upper.at = { sideId: "front", dx: 0, dy: -3 };
  e.upper.sides[1].lengthFeet = 27;
  e.upper.sides[3].lengthFeet = 27;
  const far = roofOf(e);
  assert(/runs past the main floor's walls/.test(far.roof.note ?? "") && far.floorSoffitSquareFeet === 0, far.roof.note ?? "no note");
});

console.log("\nthe roof from the photos: typed, then photos, then assumed (10-15)");

/** A roof read ticked off a side's photo. */
const photoRead = (pitch, over = "gable", more = {}) => ({ at: "2026-10-15T00:00:00Z", pitch, ...(pitch === null || pitch === undefined ? {} : { slopes: [pitch, pitch] }), over, ...more });
/** [e] with [read] on the side [id]. */
const withRead = (e, id, read) => ({ ...e, sides: e.sides.map((s) => (s.id === id ? { ...s, roofRead: read } : s)) });
const allScope = { roofing: true, sides: [], soffitFascia: true, eavestrough: false };

test("a gable's photo fills the pitch and the overhangs, and the scope says they are from photos", () => {
  // 40 x 30, its ridge along the 40: the left side is a gable end. Nothing typed.
  const e = { ...withRead(rect(40, 30), "left", photoRead(5, "gable", { rakeOverhangFeet: 22 / 12, eaveOverhangFeet: 2 })), scope: allScope };
  const q = roofOf(e);
  assert(q.pitch.source === "photos" && q.pitch.value === 5 && q.pitch.fromPhotos[0].name === "Left", JSON.stringify(q.pitch));
  assert(q.roofing.pitchFromPhotos && q.roofing.overhangs.rake.source === "photos" && q.roofing.overhangs.eave.source === "photos", "from photos");
  // The same roof as typed: 5/12, 2' eaves, 1'10" rakes.
  const typed = roofOf(rect(40, 30, { pitch: 5, eaveOverhangFeet: 2, rakeOverhangFeet: 22 / 12 }));
  near(q.roofing.squares, typed.roofing.squares, "the same squares as typed");
  near(q.roofing.rakeFeet, typed.roofing.rakeFeet, "and rakes");
  near(q.roofing.soffit.rakeSquareFeet, typed.roofing.soffit.rakeSquareFeet, "soffit at the photo's rake overhang");
  const lines = x.exteriorScopeLines(e);
  assert(/– 5\/12 \(from photos\) –/.test(lines.roofing[0]), lines.roofing[0]);
  assert(lines.siding.some((l) => /at 2' overhang \(from photos\).*eaves/.test(l)) && lines.siding.some((l) => /at 1'10" overhang \(from photos\).*rakes/.test(l)), lines.siding.join(" | "));
  // As typed, nothing is said: as it always was.
  const typedLines = x.exteriorScopeLines({ ...rect(40, 30, { pitch: 5, eaveOverhangFeet: 2, rakeOverhangFeet: 22 / 12 }), scope: allScope });
  assert(!typedLines.roofing[0].includes("from photos") && !typedLines.siding.some((l) => l.includes("from photos")), typedLines.roofing[0]);
});

test("what is typed wins over the photos; the photos over the phone's roofline and the defaults", () => {
  const base = withRead(rect(40, 30), "left", photoRead(5, "gable", { rakeOverhangFeet: 22 / 12, eaveOverhangFeet: 2 }));
  // The pitch typed: 6/12, and the plan says the photo read otherwise.
  const pitched = { ...base, roof: { ...base.roof, pitch: 6 } };
  assert(x.exteriorPitch(pitched).source === "typed" && x.exteriorPitch(pitched).value === 6, "typed pitch");
  assert(x.photoNotes(pitched).some((n) => /typed at 6\/12, and that is used; the photos read 5\/12 \(Left\)/.test(n)), x.photoNotes(pitched).join(" | "));
  // An overhang typed (said so) wins; so does one off the default from before 10-15, said nothing.
  const typedRake = { ...base, roof: { ...base.roof, rakeOverhangFeet: 1.5, overhangSource: { rake: "typed" } } };
  const r1 = x.resolvedOverhang(typedRake, "rake");
  assert(r1.source === "typed" && r1.feet === 1.5, JSON.stringify(r1));
  const legacy = { ...base, roof: { ...base.roof, rakeOverhangFeet: 1.5 } };
  assert(x.resolvedOverhang(legacy, "rake").source === "typed", "off the default and unsaid: typed");
  // The phone's roofline gives way to the photos, and stands where there are none.
  const scanned = { ...base, roof: { ...base.roof, rakeOverhangFeet: 0.5, overhangSource: { rake: "scan" } } };
  near(x.resolvedOverhang(scanned, "rake").feet, 22 / 12, "photos over the phone");
  const scanOnly = { ...rect(40, 30), roof: { ...rect(40, 30).roof, rakeOverhangFeet: 0.5, overhangSource: { rake: "scan" } } };
  const r2 = x.resolvedOverhang(scanOnly, "rake");
  assert(r2.source === "scan" && r2.feet === 0.5, JSON.stringify(r2));
  assert(x.exteriorScopeLines({ ...scanOnly, scope: allScope }).siding.some((l) => /at 0'6" overhang \(read by the phone\)/.test(l)), "said as the phone's");
  // Nothing anywhere: the defaults, unsaid.
  const plain = x.resolvedOverhang(rect(40, 30), "eave");
  assert(plain.source === "default" && plain.feet === x.DEFAULT_EAVE_OVERHANG_FEET, JSON.stringify(plain));
  // An Import of Scan's roofline marks its overhangs the phone's.
  const imported = x.parseScanExterior(fixture("scan-exterior-v2-photos.json"), { scanId: "s" }).exterior;
  // (This file's roofline has a peak on every side: rakes only.)
  assert(imported.roof.overhangSource?.rake === "scan" && imported.roof.overhangSource?.eave === undefined, JSON.stringify(imported.roof.overhangSource));
});

test("a gable's photo set aside gives no pitch - not even off the gable's own peak", () => {
  // The left gable measured by hand: up 7'6" over a half-span of 15', 6/12.
  const measured = { ...rect(40, 30), sides: rect(40, 30).sides.map((s) => (s.id === "left" ? { ...s, gable: { peakFeet: 17.5, atFeet: 15 } } : s)) };
  assert(x.exteriorPitch(measured).source === "sides" && Math.abs(x.exteriorPitch(measured).value - 6) < 1e-9, "the measured gable's 6/12");
  // Its photo read 5/12, ticked: the photo's, not both.
  const ticked = withRead(measured, "left", photoRead(5));
  assert(x.exteriorPitch(ticked).source === "photos" && x.exteriorPitch(ticked).value === 5 && x.exteriorPitch(ticked).fromSides.length === 0, JSON.stringify(x.exteriorPitch(ticked)));
  // Set aside: nothing from that side at all - assumed.
  const aside = withRead(measured, "left", photoRead(null));
  assert(x.exteriorPitch(aside).source === "assumed" && x.exteriorPitch(aside).value === x.ASSUMED_PITCH, JSON.stringify(x.exteriorPitch(aside)));
});

test("gable or hip at an end of the roof: the photo of that side, unless tapped on the plan", () => {
  const e = withRead(withRead(rect(40, 30, { pitch: 6 }), "left", photoRead(undefined, "hip")), "right", photoRead(undefined, "eave"));
  const plan = roofOf(e).roof;
  assert(plan.ends.find((end) => end.sideId === "left").kind === "hip" && plan.ends.find((end) => end.sideId === "right").kind === "hip", JSON.stringify(plan.ends));
  assert([...x.endsFromPhotos(e)].sort().join() === "left,right", "both from the photos");
  // Tapped: the plan's word.
  const tapped = { ...e, roof: { ...e.roof, ends: { left: "gable" } } };
  assert(roofOf(tapped).roof.ends.find((end) => end.sideId === "left").kind === "gable", "tapped back to a gable");
  assert([...x.endsFromPhotos(tapped)].join() === "right", "only the right from the photo now");
});

test("the garage's gable photo fills the garage's own pitch; the house's gable, the house's", () => {
  // houseAndGarage: the main roof's gable ends are over left and right, the garage wing's over its front.
  // (The helper types 12/12 unless told: nothing typed here.)
  const e = { ...withRead(withRead(houseAndGarage({ pitch: null }), "left", photoRead(6)), "garageFront", photoRead(4)), scope: allScope };
  const q = roofOf(e);
  assert(q.pitch.source === "photos" && q.pitch.value === 6, JSON.stringify(q.pitch));
  const wing = q.roof.sections.find((s) => s.key === "wing:garageFront");
  assert(wing && wing.pitch === 4, JSON.stringify(wing && { key: wing.key, pitch: wing.pitch }));
  // The same roof as typed part by part.
  const typed = roofOf(houseAndGarage({ pitch: 6, sectionPitches: { "wing:garageFront": 4 } }));
  near(q.roofing.squares, typed.roofing.squares, "the same squares as typed");
  near(q.roofing.valleyFeet, typed.roofing.valleyFeet, "the same valleys");
  const line = x.exteriorScopeLines(e).roofing[0];
  assert(/6\/12 \(from photos\) on [\d.]+ SQ, 4\/12 \(from photos\) on [\d.]+ SQ/.test(line), line);
  // The roof's pitch typed: every part's not set apart, the garage's photo too - and said.
  const typedRoof = { ...e, roof: { ...e.roof, pitch: 5 } };
  assert(roofOf(typedRoof).roof.sections.every((s) => s.pitch === 5), "typed over every part");
  assert(x.photoNotes(typedRoof).some((n) => /photos read 6\/12 \(left\), 4\/12 \(garageFront\)/.test(n)), x.photoNotes(typedRoof).join(" | "));
  // The garage's own pitch typed: that, over its photo.
  const typedPart = { ...e, roof: { ...e.roof, sectionPitches: { "wing:garageFront": 3 } } };
  assert(roofOf(typedPart).roof.sections.find((s) => s.key === "wing:garageFront").pitch === 3, "the part's typed pitch");
});

test("a gable photo off a side no ridge can put a gable end over: used for the main roof, and said", () => {
  // 40 x 30 with gables read over the Front and the Left: a rectangle's ends are opposite sides, so no
  // ridge fits both (since 10-15 the ridge turns to fit the photos, `ridgeFromPhotos`). Turned, it fits
  // one, as the outline's does: it stays along the 40, and the Front's read is said.
  const e = withRead(withRead(rect(40, 30), "front", photoRead(5)), "left", photoRead(5));
  assert(x.ridgeFromPhotos(e) === null, "no ridge fits better than the outline's");
  assert(x.photoPitches(e).unplaced.length === 1 && x.photoPitches(e).unplaced[0].sideId === "front" && x.exteriorPitch(e).value === 5, JSON.stringify(x.photoPitches(e)));
  assert(x.photoNotes(e).some((n) => /5\/12 \(Front\): the photo shows a gable, but the roof is drawn with no gable end over that side/.test(n)), x.photoNotes(e).join(" | "));
  // Two photos of one roof that disagree are said; two overhang reads apart, likewise.
  const two = withRead(withRead(rect(40, 30), "left", photoRead(5, "gable", { eaveOverhangFeet: 2 })), "right", photoRead(6, "gable", { eaveOverhangFeet: 1.5 }));
  const notes = x.photoNotes(two);
  assert(notes.some((n) => /gables' photos read 6\/12 \(Right\), 5\/12 \(Left\)/.test(n)) && notes.some((n) => /eave overhang 1'6" \(Right\), 2' \(Left\); the roof is drawn at 1'9"/.test(n)), notes.join(" | "));
});

console.log("\ntwo storeys from the photos (10-15): each read on the roof it shows");

/** The two-storey box and its garage (main 52 x 24, upper 30 x 24 over its left), nothing typed: the roof from the photos. */
const fromPhotos = () => twoStorey(box4(52, 24), ubox(30, 24), undefined, { pitch: null });
const F8 = Math.sqrt(1 + (8 / 12) ** 2);

test("an upper side's gable photo is the house roof's pitch; the main floor's walls under the upper floor give none of their own", () => {
  // The upper left is a gable end of the house's roof, 8/12 on its photo: the roof over the upper floor is 8/12,
  // and the garage, with no photo of its own, is at the roof's pitch too - 720 and 528 SF of plan, × F8.
  const e = fromPhotos();
  e.upper.sides[3].roofRead = photoRead(8);
  const pp = x.photoPitches(e);
  assert(pp.main.map((r) => r.sideId).join() === "uLeft" && pp.unplaced.length === 0, JSON.stringify(pp));
  const q = roofOf(e);
  assert(q.pitch.value === 8 && q.pitch.source === "photos", JSON.stringify(q.pitch));
  assert(q.roof.sections.every((s) => s.pitch === 8), q.roof.sections.map((s) => `${s.key} ${s.pitch}`).join(", "));
  near(q.roofing.areaSquareFeet, (720 + 528) * F8, "every slope at 8/12");
  // A tall main side's photo, before it is split, shows the same gable from the ground: no part of the roof has
  // a gable end over the main left (it is under the upper floor), so it goes to the house's roof, and is said.
  const tall = fromPhotos();
  tall.sides[3].roofRead = photoRead(8);
  const tp = x.photoPitches(tall);
  assert(tp.unplaced.map((r) => r.sideId).join() === "left" && roofOf(tall).pitch.value === 8, JSON.stringify(tp));
});

test("a garage's or bump-out's gable photo on a main side is that lower roof's own pitch", () => {
  // The garage's gable end is over the main right: 4/12 on its photo, its own pitch; the house stays at its
  // gable photo's 8/12. The roofing line has each: 720 × F8 = 865.3 SF (8.65 SQ), 528 × F4 = 556.6 SF (5.57 SQ).
  const e = fromPhotos();
  e.upper.sides[3].roofRead = photoRead(8);
  e.sides[1].roofRead = photoRead(4);
  assert(JSON.stringify(x.photoSectionPitches(e)) === '{"wing:right":4}', JSON.stringify(x.photoSectionPitches(e)));
  const q = roofOf(e);
  const garage = q.roof.sections.find((s) => s.key === "wing:right");
  assert(garage.floor === "main" && garage.pitch === 4, `${garage.floor} ${garage.pitch}`);
  assert(q.roof.sections.filter((s) => s.floor === "upper").every((s) => s.pitch === 8), "the house's roof at 8/12");
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const line = x.exteriorScopeLines(e).roofing[0];
  assert(line.includes("8/12 (from photos) on 8.65 SQ, 4/12 (from photos) on 5.57 SQ"), line);
  // The bump-out on the back of the other two-storey: its gable end over its rear, 5/12 on its photo.
  const b = boxAndBumpOut({ pitch: null });
  b.sides.find((s) => s.id === "bumpRear").roofRead = photoRead(5);
  const bq = roofOf(b);
  assert(bq.roof.sections.find((s) => s.key === "wing:bumpRear").pitch === 5, "the bump-out at its photo's pitch");
});

test("overhangs read off the photos reach the lower roofs as well as the house's", () => {
  // A 2' eave and an 18" rake read off the upper left's photo: the house's roof 2' out over its eaves and 18" past
  // its gable ends, the garage's 2' out over its front and rear and 18" past its gable at the right.
  // Nothing typed for them either: the defaults, which the photos' reads go over.
  const defaults = { eaveOverhangFeet: x.DEFAULT_EAVE_OVERHANG_FEET, rakeOverhangFeet: x.DEFAULT_RAKE_OVERHANG_FEET };
  const e = twoStorey(box4(52, 24), ubox(30, 24), undefined, { pitch: null, ...defaults });
  e.upper.sides[3].roofRead = photoRead(8, "gable", { eaveOverhangFeet: 2, rakeOverhangFeet: 1.5 });
  const q = roofOf(e);
  assert(q.roofing.overhangs.eave.source === "photos" && q.roofing.overhangs.rake.source === "photos", "from the photos");
  const house = q.roof.sections.find((s) => s.floor === "upper");
  const garage = q.roof.sections.find((s) => s.key === "wing:right");
  assert(house.x0 === -1.5 && house.x1 === 31.5 && house.y0 === -2 && house.y1 === 26, JSON.stringify([house.x0, house.x1, house.y0, house.y1]));
  assert(garage.x0 === 30 && garage.x1 === 53.5 && garage.y0 === -2 && garage.y1 === 26, JSON.stringify([garage.x0, garage.x1, garage.y0, garage.y1]));
  // And a lean-to wrapping the upper floor's corner: 2' past the main floor's rear and right walls.
  const w = wrapped({ pitch: null, ...defaults });
  w.upper.sides[3].roofRead = photoRead(6, "gable", { eaveOverhangFeet: 2, rakeOverhangFeet: 1.5 });
  const low = lowerOf(roofOf(w)).sections;
  assert(Math.max(...low.map((s) => s.y1)) === 34 && Math.max(...low.map((s) => s.x1)) === 40, JSON.stringify(low.map((s) => [s.x1, s.y1])));
});

/** A 30 x 24 two-storey box taped as tall sides, 19' to the upper eave, a gable on the left and right; the upper floor drawn over it all. */
function tallBox() {
  const e = exterior(
    ["Front", "Right", "Rear", "Left"].map((name, i) => side({ id: name.toLowerCase(), name, lengthFeet: i % 2 ? 24 : 30, base: "grade", eaveLeftFeet: 19, eaveRightFeet: 19, ...(i % 2 ? { gable: { peakFeet: 25, atFeet: 12 } } : {}) })),
    { pitch: null },
  );
  const fp = x.exteriorFootprint(e);
  e.upper = x.upperFromOutline(fp.corners, fp);
  return e;
}

test("a tall side split at the floor line: its photos go onto both storeys, each laid on its own wall; the roof read goes up", () => {
  // The left side's photo, from 10 m out and 1.6 m up, tilted up to take in both storeys and the gable; and one
  // aimed at the foot of the wall, which shows nothing over the floor line. The roof read off it: 8/12.
  const e = tallBox();
  const left = e.sides[3];
  const up = camera({ at: [3.66, -10, 1.6], pitch: 0.35, width: 1200, height: 1600, f: 1000 });
  const low = camera({ at: [3.66, -10, 1.2], pitch: -0.5, width: 1200, height: 1600, f: 3000 });
  left.photos = [{ ...up.photo, inView: { fromM: 0, toM: 24 * 0.3048, leftEnd: true, rightEnd: true, top: true } }, { ...low.photo, n: 901 }];
  left.roofRead = photoRead(8);
  left.roofline = [
    { alongFeet: 0, upFeet: 19, outFeet: 1 },
    { alongFeet: 12, upFeet: 25, outFeet: 1 },
    { alongFeet: 24, upFeet: 19, outFeet: 1 },
  ];
  // Before the split the read is off a main side under the upper floor: it goes to the house's roof unplaced.
  assert(x.photoPitches(e).unplaced.length === 1, "unplaced before");
  const s = x.splitTallSides(e, 10);
  const main = s.sides[3];
  const upper = s.upper.sides.find((v) => v.name === "Upper left");
  // Both photos stay with the main left, at the ground; the one that shows the upper storey goes up as well.
  assert(main.photos.map((p) => p.n).join() === "900,901", main.photos.map((p) => p.n).join());
  assert(upper.photos.map((p) => p.n).join() === "900", (upper.photos ?? []).map((p) => p.n).join());
  // Laid on the upper side's frame - up from the floor line, 10' = 3.048 m - every wall point is seen at the pixel
  // it was: 2 m along and 1 m up the upper wall is 2 m along and 4.048 m up the tall one.
  for (const [a, u] of [
    [2, 1],
    [6, 2.5],
    [0.5, 0.1],
  ]) {
    const got = x.projectToPhoto(upper.photos[0], a, u);
    const want = up.see(a, u + 3.048);
    near(got.x, want.x, `pixel x at ${a}, ${u}`, 1e-6);
    near(got.y, want.y, `pixel y at ${a}, ${u}`, 1e-6);
  }
  assert(JSON.stringify(upper.photos[0].inView) === JSON.stringify(left.photos[0].inView), "the whole side's view: its ends and top");
  // The roof read goes with the roof, onto the upper left: the house's gable end, so the photo's pitch is the house roof's.
  assert(upper.roofRead?.pitch === 8 && main.roofRead === undefined, "the read on the upper left");
  const pp = x.photoPitches(s);
  assert(pp.main.map((r) => r.sideId).join() === upper.id && pp.unplaced.length === 0, JSON.stringify(pp));
  assert(roofOf(s).pitch.value === 8, "the house's roof at 8/12");
  // 3D: the upper wall carries the photo.
  assert(model3d(s).walls.find((w) => w.sideId === upper.id).photos.length === 1, "on the upper wall in 3D");
});

test("split under two upper sides, the roof read goes onto the one its peak is over", () => {
  // Main 40 x 24, tall; the upper floor a U with a 10' notch in the middle of its front, so two upper sides stand
  // on the main front: 0-15 and 25-40. The roofline peaks at 32' along (a cross gable): the read goes to 25-40.
  const e = exterior(
    ["Front", "Right", "Rear", "Left"].map((name, i) => side({ id: name.toLowerCase(), name, lengthFeet: i % 2 ? 24 : 40, base: "grade", eaveLeftFeet: 19, eaveRightFeet: 19 })),
    { pitch: null },
  );
  const fp = x.exteriorFootprint(e);
  e.upper = x.upperFromOutline([P(0, 0), P(15, 0), P(15, 6), P(25, 6), P(25, 0), P(40, 0), P(40, 24), P(0, 24)], fp);
  e.sides[0].roofRead = photoRead(10);
  e.sides[0].roofline = [
    { alongFeet: 0, upFeet: 19, outFeet: 1 },
    { alongFeet: 29, upFeet: 19, outFeet: 1 },
    { alongFeet: 32, upFeet: 21.5, outFeet: 1 },
    { alongFeet: 35, upFeet: 19, outFeet: 1 },
    { alongFeet: 40, upFeet: 19, outFeet: 1 },
  ];
  const t = x.tallSides(e).find((v) => v.sideId === "front");
  assert(t.over.map((o) => o.fromFeet).join() === "0,25", JSON.stringify(t.over));
  const s = x.splitTallSides(e, 10);
  const right = s.upper.sides.find((v) => v.id === t.over[1].sideId);
  const left = s.upper.sides.find((v) => v.id === t.over[0].sideId);
  assert(right.roofRead?.pitch === 10 && !left.roofRead, `${right.name}: ${JSON.stringify(right.roofRead)}`);
  // The roofline is shared out by where each point is: 29-35 on the one at 25-40, from its own left corner.
  assert(right.roofline.map((p) => `${p.alongFeet}@${p.upFeet}`).join() === "4@9,7@11.5,10@9,15@9", right.roofline.map((p) => `${p.alongFeet}@${p.upFeet}`).join());
});

console.log("\nthe sizes: what they are from (2026-10-15, lib/exteriorScale.ts)");

test("Scan's tape comes in as what the sizes are from, the phone's own read of that side beside it; no tape, the phone's own measure", () => {
  // The Right taped at 8 m on the phone, which had read it 4.5% short: Scan has scaled every length by 1.045 already.
  const raw = { ...fixture("scan-exterior-sample.json"), scale: 1.045, taped: { side: 1, metres: 8 } };
  const r = x.parseScanExterior(raw);
  assert(r.ok, r.error);
  const e = r.exterior;
  const s = e.scale;
  assert(s.from === "tape" && s.factor === 1.045 && s.tape.sideId === e.sides[1].id && s.tape.by === "scan", JSON.stringify(s));
  near(s.tape.feet, 8 * M, "the tape, as Scan has it", 1e-9);
  near(s.tape.phoneFeet, (8 / 1.045) * M, "and the phone's own read of that side", 1e-9);
  assert(!r.notes.some((n) => /Scaled to a tape/.test(n)), "no note for it: the sizes line says it");
  // 8 m is 26'2.96": 26'3".
  assert(x.sizesLine(e) === `Sizes from the tape on the Right (26'3"), +4.5% on the phone's own measure.`, x.sizesLine(e));
  const flags = x.scaleFlags(e);
  assert(flags.length === 1 && /^The phone's own measure and the tape on the Right \(26'3"\) are 4\.5% apart: check the tape; if it holds, the phone read this house off, and the sizes stay from the tape\.$/.test(flags[0].text), flags.map((f) => f.text).join(" | "));
  // From the phone's own measure, the same two say to take the sizes from the tape.
  const fromPhone = x.scaleFlags(x.withScaleFrom(e, { from: "phone" }));
  assert(fromPhone.length === 1 && /: check the tape; if it holds, take the sizes from it\.$/.test(fromPhone[0].text), fromPhone.map((f) => f.text).join(" | "));
  // A tape within 3% of the phone is nothing to flag.
  const close = x.parseScanExterior({ ...raw, scale: 1.022 }).exterior;
  assert(x.scaleFlags(close).length === 0 && /, \+2\.2% on the phone's own measure\.$/.test(x.sizesLine(close)), x.sizesLine(close));
  const plain = x.parseScanExterior(fixture("scan-exterior-sample.json")).exterior;
  assert(plain.scale.from === "phone" && plain.scale.factor === 1 && x.sizesLine(plain) === "Sizes from the phone's own measure." && x.scaleFlags(plain).length === 0, JSON.stringify(plain.scale));
  assert(x.sizesFrom(plain) === "the phone's own measure (Scrivn Scan)", x.sizesFrom(plain));
});

test("an exterior read before 2026-10-15 kept its tape in a note: read from it; one drawn by hand has no scale at all", () => {
  const old = { ...rect(40, 30), source: { kind: "scan", captureId: null, scanId: null, receivedAt: null, notes: ["Exterior imported: 4 sides measured on the phone.", "Scaled to a tape by the phone (x1.023)."] } };
  const s = x.scaleOf(old);
  assert(s.from === "tape" && s.factor === 1.023 && s.tape === undefined, JSON.stringify(s));
  assert(x.isOldTapeNote(old.source.notes[1]) && !x.isOldTapeNote(old.source.notes[0]), "the old note is known, to be left off the screen");
  assert(x.sizesLine(old) === "Sizes from the tape typed on the phone, +2.3% on the phone's own measure.", x.sizesLine(old));
  // Back to the phone's own measure: every length over 1.023.
  near(x.withScaleFrom(old, { from: "phone" }).sides[0].lengthFeet, 40 / 1.023, "the Front as the phone read it", 1e-9);
  const hand = rect(40, 30);
  assert(x.scaleOf(hand) === null && x.sizesLine(hand) === null && x.scaleRefs(hand).length === 0 && x.scaleFlags(hand).length === 0, "drawn by hand: the estimator's own sizes");
  assert(x.withScaleFrom(hand, { from: "phone" }) === hand && x.rescaleExterior(hand, 1.1).scale === undefined, "nothing to take them from");
});

test("a tape typed here scales every length and height once; the phone's own measure puts them back, and the tape stays to take again", () => {
  const e0 = x.parseScanExterior(fixture("scan-exterior-sample.json")).exterior;
  const q0 = x.exteriorQuantities(e0);
  // The Front is 10 m by the phone, 10.25 m by the tape.
  const k = 1.025;
  const e1 = x.withScaleFrom(e0, { from: "tape", sideId: e0.sides[0].id, feet: 10.25 * M });
  assert(e1.scale.from === "tape" && e1.scale.tape.by === "scrivn" && e1.scale.tape.sideId === e0.sides[0].id, JSON.stringify(e1.scale));
  near(e1.scale.factor, k, "the tape over the phone's read", 1e-12);
  near(e1.sides[0].lengthFeet, 10.25 * M, "the Front, as taped", 1e-9);
  near(e1.sides[1].lengthFeet, e0.sides[1].lengthFeet * k, "the Right with it", 1e-9);
  near(e1.sides[1].eaveLeftFeet, e0.sides[1].eaveLeftFeet * k, "and its eave", 1e-9);
  const q1 = x.exteriorQuantities(e1);
  near(q1.footprint.areaSquareFeet, q0.footprint.areaSquareFeet * k * k, "the footprint by k squared", 1e-4);
  near(q1.totals.netSquareFeet, q0.totals.netSquareFeet * k * k, "the cladding by k squared", 1e-4);
  near(q1.pitch.value, q0.pitch.value, "a pitch is a ratio: the same", 1e-9);
  assert(x.scaleFlags(e1).length === 0 && x.sizesLine(e1) === `Sizes from the tape on the Front (33'8"), +2.5% on the phone's own measure.`, x.sizesLine(e1));
  const e2 = x.withScaleFrom(e1, { from: "phone" });
  for (let i = 0; i < 4; i++) near(e2.sides[i].lengthFeet, e0.sides[i].lengthFeet, `side ${i + 1} back as the phone read it`, 1e-9);
  assert(e2.scale.from === "phone" && e2.scale.factor === 1 && e2.scale.tape && x.scaleRefs(e2).map((r) => r.kind).join() === "phone,tape", JSON.stringify(e2.scale));
  near(x.withScaleFrom(e2, { from: "tape" }).sides[1].lengthFeet, e1.sides[1].lengthFeet, "to the tape again, by itself", 1e-9);
  // Not a side of the house, or no length: nothing changes.
  assert(x.withScaleFrom(e0, { from: "tape", sideId: "nowhere", feet: 30 }) === e0 && x.withScaleFrom(e0, { from: "tape", sideId: e0.sides[0].id, feet: 0 }) === e0, "nothing to scale to");
});

test("scaling the house: every length the phone measured and the photos laid on them; what was typed stays", () => {
  const cam = oblique();
  const base = side({
    id: "front",
    name: "Front",
    lengthFeet: 8 * M,
    gable: { peakFeet: 5 * M, atFeet: 4 * M, fromFeet: 1 * M, toFeet: 7 * M },
    bands: [{ id: "b1", kind: "stone", top: 1 * M }, { id: "b2", kind: "stucco", top: "eave" }, { id: "b3", kind: "vinyl", top: null }],
    openings: [{ id: "w", kind: "window", widthFeet: 1 * M, heightFeet: 1.2 * M, sillFeet: 1 * M, fromLeftFeet: 2 * M }],
    shapes: [{ id: "sh", kind: "stucco", closed: true, polygon: [{ x: 0, y: 0 }, { x: 8 * M, y: 0 }, { x: 8 * M, y: 3 * M }, { x: 0, y: 3 * M }] }],
    roofline: [{ alongFeet: -0.5 * M, upFeet: 3 * M, outFeet: 0.5 * M }, { alongFeet: 4 * M, upFeet: 5 * M, outFeet: null }],
    roofRead: { at: "t", pitch: 6, slopes: [6, 6], rakeOverhangFeet: 1.5, eaveOverhangFeet: null, over: "gable" },
    pitchMeasured: 6,
    photos: [{ ...cam.photo, inView: { fromM: 1, toM: 6, leftEnd: false, rightEnd: false, top: true } }],
    sizeDoors: [{ id: "d", kind: "garage", widthFeet: 16, heightFeet: 7, phone: { widthFeet: 15.5, heightFeet: 6.8, middleFeet: 12 } }],
  });
  const e0 = {
    ...exterior([base], { pitch: 6, eaveOverhangFeet: 1.25, rakeOverhangFeet: 2, overhangSource: { eave: "scan", rake: "typed" }, additions: [{ id: "p", kind: "porch", sideId: "front", fromFeet: 2, toFeet: 10, depthFeet: 6 }], typed: { ridge: 40 } }),
    upper: { sides: [side({ id: "up", lengthFeet: 20 })], at: { sideId: "front", dx: 2, dy: 3 } },
    source: { kind: "scan", captureId: null, scanId: "s", receivedAt: null, notes: [] },
    scale: { from: "phone", factor: 1 },
  };
  const k = 1.05;
  const e = x.rescaleExterior(e0, k);
  const s = e.sides[0];
  near(s.lengthFeet, 8 * M * k, "the length", 1e-9);
  near(s.eaveLeftFeet, 10 * k, "the eave", 1e-9);
  near(s.baseRightFeet, ft(0, 8) * k, "the parging", 1e-9);
  near(s.gable.peakFeet, 5 * M * k, "the peak", 1e-9);
  near(s.gable.toFeet, 7 * M * k, "where the gable stops", 1e-9);
  near(s.bands[0].top, 1 * M * k, "a band line", 1e-9);
  assert(s.bands[1].top === "eave" && s.bands[2].top === null, "the eave and all the way up are no lengths");
  near(s.openings[0].fromLeftFeet, 2 * M * k, "the window, from the left", 1e-9);
  near(s.openings[0].heightFeet, 1.2 * M * k, "and its height", 1e-9);
  near(s.shapes[0].polygon[2].y, 3 * M * k, "a shape's corner", 1e-9);
  near(s.roofline[0].alongFeet, -0.5 * M * k, "the roofline", 1e-9);
  near(s.roofline[0].outFeet, 0.5 * M * k, "and how far out it stands", 1e-9);
  assert(s.roofline[1].outFeet === null, "one aimed onto the face still has none");
  near(s.roofRead.rakeOverhangFeet, 1.5 * k, "the photo's rake overhang", 1e-9);
  assert(s.roofRead.eaveOverhangFeet === null && s.roofRead.pitch === 6 && s.pitchMeasured === 6, "a read set aside stays aside, and a pitch is a ratio");
  assert(s.sizeDoors === base.sizeDoors, "a door's are the phone's own and the door's: the same however the house is scaled");
  // A wall point k times as far along shows in the photo where the old one did; the phone stands k times as far off.
  for (const [a, u] of [[0, 0], [2, 1], [5.5, 3.7]]) {
    const was = x.projectToPhoto(base.photos[0], a, u);
    const now = x.projectToPhoto(s.photos[0], a * k, u * k);
    near(now.x, was.x, `x of (${a}, ${u})`, 1e-6);
    near(now.y, was.y, `y of (${a}, ${u})`, 1e-6);
  }
  near(s.photos[0].inView.toM, 6 * k, "what is in view", 1e-9);
  near(x.wallCamera(s.photos[0]).distanceM, x.wallCamera(base.photos[0]).distanceM * k, "the phone's distance", 1e-6);
  near(e.roof.eaveOverhangFeet, 1.25 * k, "the phone's eave overhang", 1e-9);
  assert(e.roof.rakeOverhangFeet === 2 && e.roof.typed.ridge === 40 && e.roof.pitch === 6, "the typed rake, totals and pitch as typed");
  near(e.roof.additions[0].toFeet, 10 * k, "the porch along its side", 1e-9);
  near(e.roof.additions[0].depthFeet, 6 * k, "and out", 1e-9);
  near(e.upper.sides[0].lengthFeet, 20 * k, "the upper floor", 1e-9);
  near(e.upper.at.dx, 2 * k, "and where it stands", 1e-9);
  near(e.scale.factor, k, "the factor goes with it", 1e-12);
  assert(e.scale.from === "phone", "what it is from does not change");
  // A default overhang is nobody's measure: it stays.
  assert(x.rescaleExterior({ ...e0, roof: x.defaultRoof() }, k).roof.eaveOverhangFeet === x.DEFAULT_EAVE_OVERHANG_FEET, "the default stays");
});

test("a garage door or a door's leaf is matched to the sizes doors are sold in, the likeliest first", () => {
  const [best] = x.standardMatches("garage", ft(15, 6), ft(6, 10));
  assert(best.size.widthFeet === 16 && best.size.heightFeet === 7, JSON.stringify(best));
  near(best.factor, 23 / (15.5 + ft(6, 10)), "width and height together", 1e-12);
  // 17' x 7'6" by the phone: a 16' x 7' read 6% large, or an 18' x 8' 6% small - whichever the house's scale makes likelier.
  const order = (near1) => x.standardMatches("garage", 17, 7.5, near1).map((m) => `${m.size.widthFeet}x${m.size.heightFeet}`).join();
  assert(order(1) === "18x8,16x7" && order(0.95) === "16x7,18x8", `${order(1)} | ${order(0.95)}`);
  // 8'6" x 7': its width says 9', its height 7' as read - no door is that.
  assert(x.standardMatches("garage", 8.5, 7).length === 0, JSON.stringify(x.standardMatches("garage", 8.5, 7)));
  const [leaf] = x.standardMatches("door", 35.4 / 12, 79.5 / 12);
  assert(leaf.size.widthFeet === 3 && Math.abs(leaf.size.heightFeet - 80 / 12) < 1e-12, JSON.stringify(leaf));
  assert(x.doorLabel("garage", { widthFeet: 16, heightFeet: 7 }) === "16' × 7' garage door" && x.doorLabel("door", leaf.size) === `36" × 80" door`, "said as sold");
});

test("the trace's doors become size checks: a garage door to the door itself, kept whole; a door by its leaf", () => {
  // At 100 px a metre, level at y = 600: a 16' x 7' garage door (4.877 x 2.134 m) whose foot is 0.1 m under the side's
  // level, and a door 1.0 x 2.1 m round its trim with a 36" x 80" leaf (0.9144 x 2.032 m) in it.
  const g = { kind: "garage_door", left: 150, right: 637.7, top: 396.6, bottom: 610, measured_to: "door_itself", leaf: [], partly_hidden_by: "" };
  const d = { kind: "door", left: 700, right: 800, top: 390, bottom: 600, measured_to: "outer_trim", leaf: [704.28, 396.8, 795.72, 600], partly_hidden_by: "" };
  const p = x.traceProposals({ ...wire, openings: [g, d, { ...d, kind: "window" }, { ...d, left: 820, right: 900, leaf: [700, 380, 800, 600] }] }, traceFrame, 10 * M);
  const [garage, door, win, stray] = p.openings;
  near(garage.heightFeet, 2.034 * M, "the garage door cut at the side's level", 1e-6);
  near(garage.box.y1 - garage.box.y0, 2.134 * M, "but kept whole as traced", 1e-6);
  near(door.leaf.x1 - door.leaf.x0, 0.9144 * M, "the leaf", 1e-6);
  assert(win.leaf === null && stray.leaf === null && garage.leaf === null, "a leaf only in a door, and only inside it");
  // The house already 5% over the phone: read back to the phone's own measure, they match it.
  const c = x.doorCandidates(p.openings, 1.05);
  assert(c.map((q) => q.kind).join() === "garage,door", c.map((q) => q.kind).join());
  near(c[0].phone.widthFeet, 4.877 * M / 1.05, "the garage door by the phone", 1e-9);
  // Its left edge at 150 px is 0.5 m along (the frame starts 1 m left of the side), its right 5.377 m.
  near(c[0].phone.middleFeet, ((0.5 + 5.377) / 2) * M / 1.05, "and where it is", 1e-9);
  assert(c[0].matches[0].size.widthFeet === 16 && c[1].matches[0].size.widthFeet === 3, JSON.stringify(c.map((q) => q.matches[0])));
  near(c[0].matches[0].factor, 1.05, "a factor of 1.05: the house as it is", 1e-3);
  // A garage door read to its trim says nothing of its size; a trace from before 10-15 has no box or leaf.
  assert(x.doorCandidates([{ ...garage, measuredTo: "outer trim" }], 1).length === 0, "trim is no size");
  assert(x.doorCandidates([{ ...door, leaf: undefined }, { ...garage, box: undefined }], 1).length === 0, "an old trace has none");
});

test("the trace asks for a door's leaf; an answer from before it still reads", () => {
  const items = x.TRACE_SCHEMA.properties.openings.items;
  assert(items.required.includes("leaf") && items.properties.leaf.type === "array", JSON.stringify(items.required));
  const message = x.traceUserMessage(traceFrame, { name: "Front", lengthM: 8, bottomLeftM: 0, bottomRightM: 0, leftEndInPhoto: true, rightEndInPhoto: true });
  assert(/also give leaf: the door leaf itself - the slab that swings/.test(message), "said in the message");
  const p = x.traceProposals(wire, traceFrame, 8 * M);
  assert(p.openings.every((o) => o.leaf === null && o.box), "no leaf; each opening's box kept");
});

test("a door kept again where it was takes the old one's place and keeps its id; elsewhere it is one more", () => {
  const d = (middleFeet, w = 16) => ({ kind: "garage", widthFeet: w, heightFeet: 7, phone: { widthFeet: 15.6, heightFeet: 6.8, middleFeet } });
  const s1 = x.withSizeDoors(side({ id: "front" }), [d(10)]);
  const id = s1.sizeDoors[0].id;
  const s2 = x.withSizeDoors(s1, [d(10.4, 18)]);
  assert(s2.sizeDoors.length === 1 && s2.sizeDoors[0].id === id && s2.sizeDoors[0].widthFeet === 18, JSON.stringify(s2.sizeDoors));
  const s3 = x.withSizeDoors(s2, [d(25)]);
  assert(s3.sizeDoors.length === 2 && s3.sizeDoors[1].id !== id, JSON.stringify(s3.sizeDoors));
  assert(x.withSizeDoors(s3, []) === s3, "none kept: the side as it was");
});

test("sizes from a door: references more than 3% apart are flagged each with what to check, and the door in use stays", () => {
  const e0 = x.parseScanExterior(fixture("scan-exterior-sample.json")).exterior;
  // A 16' x 7' garage door on the Front the phone read 15'1" x 6'7": 23 over 21'8", 6.15% small.
  const door = { kind: "garage", widthFeet: 16, heightFeet: 7, phone: { widthFeet: ft(15, 1), heightFeet: ft(6, 7), middleFeet: 15 } };
  const withDoor = { ...e0, sides: e0.sides.map((s, i) => (i === 0 ? x.withSizeDoors(s, [door]) : s)) };
  const id = withDoor.sides[0].sizeDoors[0].id;
  const k = 23 / (ft(15, 1) + ft(6, 7));
  const flags = x.scaleFlags(withDoor);
  assert(flags.length === 1 && /^The phone's own measure and the 16' × 7' garage door on the Front are 6\.2% apart: check the door's size/.test(flags[0].text), flags.map((f) => f.text).join(" | "));
  const e1 = x.withScaleFrom(withDoor, { from: "door", doorId: id });
  near(e1.scale.factor, k, "the door's factor", 1e-12);
  near(e1.sides[0].lengthFeet, e0.sides[0].lengthFeet * k, "the Front by it", 1e-9);
  assert(x.sizesLine(e1) === "Sizes from the 16' × 7' garage door on the Front, +6.2% on the phone's own measure.", x.sizesLine(e1));
  assert(x.sizesFrom(e1) === "the 16' × 7' garage door on the Front" && x.currentRef(e1).doorId === id, x.sizesFrom(e1));
  // The door the sizes are from stays; once they are from the phone again it can go.
  assert(x.withoutSizeDoor(e1, id) === e1, "kept while in use");
  const e2 = x.withoutSizeDoor(x.withScaleFrom(e1, { from: "phone" }), id);
  assert(e2.sides[0].sizeDoors === undefined && x.scaleRefs(e2).length === 1, JSON.stringify(e2.sides[0].sizeDoors));
  // The Right taped 1% over the phone: phone and tape agree, the door is 6.2% from one and 5.1% from the other.
  const taped = x.withScaleFrom(e1, { from: "tape", sideId: e1.sides[1].id, feet: e0.sides[1].lengthFeet * 1.01 });
  near(taped.sides[1].lengthFeet, e0.sides[1].lengthFeet * 1.01, "the Right, as taped", 1e-9);
  const texts = x.scaleFlags(taped).map((f) => f.text);
  assert(texts.length === 2 && texts.some((t) => /^The tape on the Right \([^)]+\) and the 16' × 7' garage door on the Front are 5\.1% apart: check the tape, and the door's size\.$/.test(t)), texts.join(" | "));
  // A door gone that the sizes were from (a side's doors replaced): the sizes stay, and say so.
  const gone = { ...e1, sides: e1.sides.map((s, i) => (i === 0 ? { ...s, sizeDoors: undefined } : s)) };
  assert(x.currentRef(gone) === null && x.sizesLine(gone) === "Sizes from a door no longer kept, +6.2% on the phone's own measure.", x.sizesLine(gone));
});

console.log("\na roof report read (10-15)");

/**
 * What the model answers for an EagleView report of the 40 x 30 gable at 6/12 worked by hand above
 * (15.34 SQ, ridge 42, eaves 84, rakes 73.045): the measured area a little more than the drawing's,
 * no starter given, and ice & water given only in square feet.
 */
const EAGLEVIEW_WIRE = {
  is_roof_report: true,
  vendor: "EagleView",
  report_date: "2026-09-30",
  address: "12 Elm St NW, Calgary AB",
  area_square_feet: 1612,
  ridge_feet: 44,
  hip_feet: 0,
  valley_feet: 0,
  eave_feet: 84.5,
  rake_feet: 73.4,
  step_flashing_feet: 0,
  headwall_flashing_feet: 0,
  drip_edge_feet: 157.9,
  starter_feet: -1,
  ice_water_feet: -1,
  predominant_pitch: 6,
  pitches: [{ pitch: 6, square_feet: 1612, percent: 100 }],
  notes: ["Ice & water was given as 840 SF, not as a length.", "  "],
};
const readAt = "2026-10-15T12:00:00.000Z";

test("the model's answer becomes the report's totals: what it gave, in range, and nothing it didn't", () => {
  const { report, problem } = x.roofReportFromWire(EAGLEVIEW_WIRE, "12 Elm - EagleView.pdf", readAt);
  assert(problem === null, problem);
  assert(report.vendor === "EagleView" && report.date === "2026-09-30" && report.address === "12 Elm St NW, Calgary AB", JSON.stringify(report));
  assert(report.fileName === "12 Elm - EagleView.pdf" && report.readAt === readAt, "the file and when");
  const want = { squareFeet: 1612, ridge: 44, hip: 0, valley: 0, eave: 84.5, rake: 73.4, step: 0, headwall: 0, dripEdge: 157.9 };
  assert(JSON.stringify(report.totals) === JSON.stringify(want), JSON.stringify(report.totals));
  // -1 is "not in the report": no starter or ice & water to offer, rather than a zero to take.
  assert(!("starter" in report.totals) && !("iceWater" in report.totals), "the sentinels are left out");
  assert(report.pitch === 6 && report.pitches.length === 1 && report.pitches[0].squareFeet === 1612, JSON.stringify(report.pitches));
  assert(report.notes.length === 1 && /840 SF/.test(report.notes[0]), "blank notes dropped");
  // Misreads and loose words: a date that is not one, a length no roof has, a pitch past 24, no vendor.
  const loose = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, vendor: " ", report_date: "Sept 30, 2026", ridge_feet: 99999, predominant_pitch: 40, pitches: [] }, "r.pdf", readAt).report;
  assert(loose.vendor === null && loose.date === null && loose.totals.ridge === undefined && loose.pitch === null, JSON.stringify(loose));
  assert(x.reportLabel(report) === "EagleView, 2026-09-30" && x.reportLabel(loose) === null, x.reportLabel(report));
  // Not a roof report at all: nothing to offer, and what it is.
  const invoice = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, is_roof_report: false, notes: ["This is an invoice for gutter cleaning."] }, "inv.pdf", readAt);
  assert(invoice.report === null && invoice.problem === "This is an invoice for gutter cleaning.", JSON.stringify(invoice));
  // The schema keeps to the sentinels: every field required, no union types.
  const s = x.ROOF_REPORT_SCHEMA;
  assert(s.required.length === Object.keys(s.properties).length && !JSON.stringify(s).includes("null"), "strict and union-free");
});

/** The 40 x 30 gable with the report read and the totals named taken off it, the rest as given. */
function withReport(roof, taken, extra = {}) {
  const { report } = x.roofReportFromWire(EAGLEVIEW_WIRE, "12 Elm - EagleView.pdf", readAt);
  const e = rect(40, 30, { pitch: 6, dripEdge: true, ...roof, report });
  e.roof.typed = { ...Object.fromEntries(taken.map((k) => [k, report.totals[k]])), ...extra };
  e.roof.typedFrom = Object.fromEntries(taken.map((k) => [k, "report"]));
  e.scope = { roofing: true, sides: [], soffitFascia: true, eavestrough: true };
  return e;
}

test("totals taken off the report say so on the scope lines; mixed with the estimator's or the drawing's, both are named", () => {
  const e = withReport({}, ["squareFeet", "ridge", "eave"], { rake: 75 });
  const r = x.exteriorQuantities(e).roofing;
  assert(r.from.squareFeet === "report" && r.from.ridge === "report" && r.from.rake === "estimator" && r.from.hip === "drawing", JSON.stringify(r.from));
  assert(r.from.dripEdge === "report+estimator" && r.from.starter === "report" && r.from.iceWater === "report", JSON.stringify(r.from));
  assert(r.report.label === "EagleView, 2026-09-30" && r.report.fileName === "12 Elm - EagleView.pdf", JSON.stringify(r.report));
  const { roofing, siding } = x.exteriorScopeLines(e);
  const has = (list, line) => assert(list.includes(line), `missing "${line}" in:\n      ${list.join("\n      ")}`);
  // The report named the first time each list says it, maker and date; "the roof report" after.
  has(roofing, "Remove & replace roofing – material to confirm – 6/12 – 16.12 SQ – from the roof report (EagleView, 2026-09-30)");
  has(roofing, "Hip & ridge cap – 44.0 LF – from the roof report");
  has(roofing, "Starter – 84.5 LF (eaves) – from the roof report");
  has(roofing, "Drip edge – 159.5 LF (eaves + rakes) – from the roof report and the estimator – photos required");
  // No valleys on a gable roof: the ice & water is the report's eaves alone.
  has(roofing, "Ice & water barrier – 84.5 LF (eaves + valleys) – from the roof report");
  has(siding, "Remove & replace eavestrough – 84.5 LF – from the roof report");
  has(siding, `Remove & replace fascia – material to confirm – 159.5 LF (eaves + rakes) – from the roof report and the estimator`);
  assert(![...roofing, ...siding].some((l) => /from the estimator$/.test(l) && /84\.5|44\.0|16\.12/.test(l)), "nothing taken is said to be the estimator's");
  // The rakes left to the drawing: the drip edge is the report's and the drawing's.
  const d = withReport({}, ["eave"]);
  assert(x.exteriorQuantities(d).roofing.from.dripEdge === "report+drawing", x.exteriorQuantities(d).roofing.from.dripEdge);
  has(x.exteriorScopeLines(d).roofing, `Drip edge – ${(84.5 + RAKES_40X30).toFixed(1)} LF (eaves + rakes) – from the roof report and the drawing – photos required`);
  // The words, and the report named where the documents name it.
  assert(x.sourceWords("report") === "from the roof report", x.sourceWords("report"));
  assert(x.sourceWords("report", "EagleView, 2026-09-30") === "from the roof report (EagleView, 2026-09-30)", x.sourceWords("report", "EagleView, 2026-09-30"));
  assert(x.sourceOfParts([1, "report"], [1, "estimator"], [1, "drawing"]) === "all" && x.sourceWords("all") === "from the roof report, the estimator and the drawing", "all three");
  assert(x.sourceOfParts([1, "estimator"], [1, "drawing"]) === "both" && x.sourceWords("both") === "from the estimator and the drawing", "the old mix is unchanged");
  // Read but nothing taken: the lines are the drawing's, untouched, with no source words.
  const untaken = withReport({}, []);
  assert(!/from the/.test(x.exteriorScopeLines(untaken).roofing.join(" ")) && x.exteriorQuantities(untaken).roofing.report === null, "a report read is not a report taken");
});

test("a total further from the drawing's than the drawing could be is flagged: squares past 5%, lengths past 10%", () => {
  const drawn = x.exteriorQuantities(rect(40, 30, { pitch: 6 })).roofing.drawing;
  near(drawn.squareFeet, 1533.9426, "the drawing's area");
  // The report's 1612 SF is 5.09% over the drawing's 1533.94.
  assert(x.totalDisagreement("squareFeet", 1612, drawn.squareFeet) === "5.1% more than the drawing's 15.34 SQ.", x.totalDisagreement("squareFeet", 1612, drawn.squareFeet));
  assert(x.totalDisagreement("squareFeet", 1610, drawn.squareFeet) === null, "4.96%: within");
  assert(x.totalDisagreement("squareFeet", 1300, drawn.squareFeet) === "15.3% less than the drawing's 15.34 SQ.", x.totalDisagreement("squareFeet", 1300, drawn.squareFeet));
  // Ridge 42 drawn: 44 is 4.8% over, 46.2 exactly 10%, 46.3 is 10.2% and 37.7 is 10.2% under.
  assert(x.totalDisagreement("ridge", 44, drawn.ridge) === null && x.totalDisagreement("ridge", 46.2, drawn.ridge) === null, "within 10%");
  assert(x.totalDisagreement("ridge", 46.3, drawn.ridge) === "10.2% more than the drawing's 42.0 LF.", x.totalDisagreement("ridge", 46.3, drawn.ridge));
  assert(x.totalDisagreement("ridge", 37.7, drawn.ridge) === "10.2% less than the drawing's 42.0 LF.", x.totalDisagreement("ridge", 37.7, drawn.ridge));
  assert(x.totalDisagreement("ridge", 84, drawn.ridge) === "100% more than the drawing's 42.0 LF.", "far apart, whole percent");
  // Valleys on a report for a roof drawn with none; none on both is no disagreement.
  assert(x.totalDisagreement("valley", 18, drawn.valley) === "The drawing has none." && x.totalDisagreement("valley", 0, drawn.valley) === null, "valleys");
  // Drip edge is checked against the drawing's eaves + rakes, typed by hand or taken alike.
  near(drawn.dripEdge, 84 + RAKES_40X30, "drawing's drip edge");
  assert(x.totalDisagreement("dripEdge", 157.9, drawn.dripEdge) === null, "157.9 against 157.0: within");
});

test("a report with no pitch: its totals still offered, the roof keeps its own pitch, and the table stands in when it has areas", () => {
  const none = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, predominant_pitch: -1, pitches: [] }, "r.pdf", readAt);
  assert(none.problem === null && none.report.pitch === null && none.report.pitches.length === 0, JSON.stringify(none));
  assert(none.report.totals.squareFeet === 1612, "the totals are there all the same");
  // Taken onto a roof with no outline and no pitch typed: the roof is at the assumed pitch, asked for.
  const e = { sides: [], roof: { ...x.defaultRoof(), report: none.report, typed: { squareFeet: 1612 }, typedFrom: { squareFeet: "report" } }, scope: { roofing: true, sides: [], soffitFascia: false, eavestrough: false } };
  const r = x.exteriorQuantities(e).roofing;
  assert(r.pitchAssumed && r.pitch === x.ASSUMED_PITCH && r.toAnswer.roofing.some((t) => /pitch/.test(t)), r.toAnswer.roofing.join("; "));
  const first = x.exteriorScopeLines(e).roofing[0];
  assert(first === "Remove & replace roofing – material to confirm – 4/12 (assumed, to confirm) – 16.12 SQ – from the roof report (EagleView, 2026-09-30)", first);
  // No pitch stated but a table of areas: the pitch with the most area; a table with no areas tells nothing.
  const table = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, predominant_pitch: -1, pitches: [{ pitch: 4, square_feet: 600, percent: 25 }, { pitch: 8, square_feet: 1800, percent: 75 }, { pitch: 8, square_feet: 1800, percent: 75 }] }, "r.pdf", readAt).report;
  assert(table.pitch === 8 && table.pitches.map((p) => p.pitch).join() === "8,4", JSON.stringify(table.pitches));
  const bare = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, predominant_pitch: -1, pitches: [{ pitch: 4, square_feet: -1, percent: -1 }, { pitch: 8, square_feet: -1, percent: -1 }] }, "r.pdf", readAt).report;
  assert(bare.pitch === null && bare.pitches.length === 2, JSON.stringify(bare));
  // Nothing to take at all: said.
  const empty = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, ...Object.fromEntries(Object.values(x.REPORT_LENGTH_FIELDS).map((f) => [f, -1])), area_square_feet: -1, predominant_pitch: -1, pitches: [] }, "r.pdf", readAt);
  assert(empty.problem === "No roof totals or pitch were found in this report.", empty.problem);
});

test("with no outline, the report's areas by pitch, taken, price the squares at each pitch and the steep charge on its own", () => {
  const { report } = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, area_square_feet: 2400, predominant_pitch: 8, pitches: [{ pitch: 8, square_feet: 1800, percent: 75 }, { pitch: 4, square_feet: 600, percent: 25 }] }, "r.pdf", readAt);
  const e = { sides: [], roof: { ...x.defaultRoof(), pitch: 8, report, typed: { squareFeet: 2400 }, typedFrom: { squareFeet: "report" } }, scope: { roofing: true, sides: [], soffitFascia: false, eavestrough: false } };
  // Not taken: one pitch on all of it, and steep on all of it.
  assert(x.exteriorScopeLines(e).roofing.includes("Steep roof charge – 7/12 to 9/12 – 24.00 SQ – from the roof report"), x.exteriorScopeLines(e).roofing.join(" | "));
  e.roof.report = { ...report, pitchesTaken: true };
  const r = x.exteriorQuantities(e).roofing;
  assert(r.byPitch.map((b) => `${b.pitch}:${b.squares.toFixed(2)}`).join() === "8:18.00,4:6.00", JSON.stringify(r.byPitch));
  const lines = x.exteriorScopeLines(e).roofing;
  assert(lines[0] === "Remove & replace roofing – material to confirm – 8/12 on 18.00 SQ, 4/12 on 6.00 SQ – 24.00 SQ – from the roof report (EagleView, 2026-09-30)", lines[0]);
  assert(lines.includes("Steep roof charge – 7/12 to 9/12 – 18.00 SQ – from the roof report"), lines.join(" | "));
  // A drawn roof has its own pitches: the table is not used there.
  const drawnRoof = withReport({}, ["squareFeet"]);
  drawnRoof.roof.report = { ...drawnRoof.roof.report, pitches: report.pitches, pitchesTaken: true };
  assert(x.exteriorQuantities(drawnRoof).roofing.byPitch.length === 1, "the drawing's one pitch");
});

console.log("\nthe roof report against the photos: the photos lead, the report checks (10-15)");

/** The 40 x 30 with its left gable's photo ticked - 5/12, 2' eaves, 1'10" rakes - and the EagleView report read. */
function photosAndReport(roof = {}, taken = [], wire = EAGLEVIEW_WIRE) {
  const { report } = x.roofReportFromWire(wire, "12 Elm - EagleView.pdf", readAt);
  const e = withRead(rect(40, 30, { dripEdge: true, ...roof, report }), "left", photoRead(5, "gable", { rakeOverhangFeet: 22 / 12, eaveOverhangFeet: 2 }));
  e.roof.typed = Object.fromEntries(taken.map((k) => [k, report.totals[k]]));
  e.roof.typedFrom = Object.fromEntries(taken.map((k) => [k, "report"]));
  e.scope = { roofing: true, sides: [], soffitFascia: true, eavestrough: true };
  return e;
}

test("what the photos read is the report's check: nothing typed over them, the drawing is the photos' roof", () => {
  assert(x.photoRoofCheck(rect(40, 30)) === null && x.reportPitchFlags(x.roofReportFromWire(EAGLEVIEW_WIRE, "r.pdf", readAt).report, null).length === 0, "no reads, no check");
  const e = photosAndReport();
  const check = x.photoRoofCheck(e);
  assert(check.mainPitch.value === 5 && check.mainPitch.reads[0].name === "Left" && check.sectionPitches.length === 0, JSON.stringify(check.mainPitch));
  near(check.overhangs.eave, 2, "eave overhang read");
  near(check.overhangs.rake, 22 / 12, "rake overhang read");
  assert(check.sameAsDrawing, "nothing typed: the drawing is built on the photos");
  assert(check.words === `5/12 (Left), eave overhang 2', rake overhang 1'10"`, check.words);
  // The photos' roof by hand: (40 + 2 x 1'10") x (30 + 2 x 2') = 43.667 x 34 = 1484.67 SF of plan, x 13/12 at 5/12 = 1608.39 SF.
  near(check.totals.squareFeet, (40 + 44 / 12) * 34 * (13 / 12), "the photos' squares");
  // The report's 6/12 is a pitch from the photos' 5/12: said, with where each came from.
  const flags = x.reportPitchFlags(e.roof.report, check);
  assert(flags.length === 1 && flags[0] === "The photos read 5/12 (Left); the report has 6/12.", flags.join(" | "));
  // Within half a pitch they agree.
  const close = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, predominant_pitch: 5.5 }, "r.pdf", readAt).report;
  assert(x.reportPitchFlags(close, check).length === 0, "5.5 against 5: agree");
  // A part's own gable photo is looked for among every pitch the report lists.
  const withWing = { ...check, sectionPitches: [{ key: "wing:front", value: 9, reads: [{ sideId: "g", name: "Garage left", value: 9 }] }] };
  assert(x.reportPitchFlags(close, withWing).includes("The photos read 9/12 (Garage left); the report lists no pitch near it."), x.reportPitchFlags(close, withWing).join(" | "));
  const listed = x.roofReportFromWire({ ...EAGLEVIEW_WIRE, predominant_pitch: 5, pitches: [{ pitch: 5, square_feet: 1200, percent: 75 }, { pitch: 9, square_feet: 400, percent: 25 }] }, "r.pdf", readAt).report;
  assert(x.reportPitchFlags(listed, withWing).length === 0, "the report lists 9/12: no flag");
});

test("taking the report's pitch types over the photos: its totals are then checked against the photos' roof as well as the drawing", () => {
  // The report's 6/12 taken: the drawing is at 6/12 now, the photos' roof still at their 5/12.
  const e = photosAndReport({ pitch: 6 });
  const check = x.photoRoofCheck(e);
  assert(!check.sameAsDrawing, "something typed stands over the photos");
  near(check.totals.squareFeet, (40 + 44 / 12) * 34 * (13 / 12), "the photos' squares, whatever is typed");
  const drawn = x.exteriorQuantities(e).roofing.drawing;
  near(drawn.squareFeet, (40 + 44 / 12) * 34 * Math.sqrt(1 + 0.25), "the drawing at the typed 6/12, still on the photos' overhangs");
  // 1612 against the photos' 1608.39 and the drawing's 1659.92: within both.
  assert(x.totalDisagreement("squareFeet", 1612, check.totals.squareFeet, "photos") === null && x.totalDisagreement("squareFeet", 1612, drawn.squareFeet) === null, "the report agrees with both");
  // 1800 is 11.9% over the photos' and 8.4% over the drawing's: said against each.
  assert(x.totalDisagreement("squareFeet", 1800, check.totals.squareFeet, "photos") === "11.9% more than the photos' 16.08 SQ.", x.totalDisagreement("squareFeet", 1800, check.totals.squareFeet, "photos"));
  assert(x.totalDisagreement("squareFeet", 1800, drawn.squareFeet) === "8.4% more than the drawing's 16.60 SQ.", x.totalDisagreement("squareFeet", 1800, drawn.squareFeet));
  assert(x.totalDisagreement("valley", 18, check.totals.valley, "photos") === "The photos' roof has none.", "valleys the photos' roof hasn't");
  // A rake overhang typed over the photos' counts the same: the check keeps the photos' 1'10".
  const typedRake = photosAndReport({ rakeOverhangFeet: 1, overhangSource: { rake: "typed" } });
  const c2 = x.photoRoofCheck(typedRake);
  assert(!c2.sameAsDrawing && Math.abs(c2.totals.squareFeet - check.totals.squareFeet) < 1e-6, "the photos' roof, not the typed overhang's");
  // Totals typed or taken never move the photos' roof: it is the drawing the photos make.
  const taken = photosAndReport({}, ["squareFeet", "ridge"]);
  assert(x.photoRoofCheck(taken).sameAsDrawing, "taken totals stand over the drawing's figures, not the photos' reads");
});

test("the scope says both: (from photos) for what the photos read, and the roof report named once in each list", () => {
  const e = photosAndReport({}, ["squareFeet", "ridge", "eave"]);
  const { roofing, siding } = x.exteriorScopeLines(e);
  const has = (list, line) => assert(list.includes(line), `missing "${line}" in:\n      ${list.join("\n      ")}`);
  has(roofing, "Remove & replace roofing – material to confirm – 5/12 (from photos) – 16.12 SQ – from the roof report (EagleView, 2026-09-30)");
  has(roofing, "Hip & ridge cap – 44.0 LF – from the roof report");
  has(roofing, "Starter – 84.5 LF (eaves) – from the roof report");
  // The siding crew's list names it again, on its first line from the report; the overhang is the photos'.
  has(siding, `Remove & replace soffit – material to confirm – 84.5 LF at 2' overhang (from photos) (169.0 SF) – eaves – from the roof report (EagleView, 2026-09-30)`);
  has(siding, "Remove & replace eavestrough – 84.5 LF – from the roof report");
  assert(roofing.filter((l) => l.includes("(EagleView, 2026-09-30)")).length === 1 && siding.filter((l) => l.includes("(EagleView, 2026-09-30)")).length === 1, "named once a list");
  // Read but nothing taken: the photos' words only, no report.
  const untaken = x.exteriorScopeLines(photosAndReport());
  assert(/5\/12 \(from photos\)/.test(untaken.roofing[0]) && !/roof report/.test([...untaken.roofing, ...untaken.siding].join(" ")), untaken.roofing[0]);
});

console.log("\nroof pieces on top of the drawing, and a second pitch above a break (10-15)");

const SQRT5 = Math.sqrt(5);

test("a gable dormer 8' wide and 6' out at 12/12 on a 6/12 slope, worked by hand", () => {
  const f = x.pieceFigures({ id: "d", kind: "gableDormer", widthFeet: 8, projectionFeet: 6, pitch: 12 }, 6);
  assert(f.missing.length === 0, f.missing.join());
  // m = 1/2, d = 1: its eaves stand mD = 3' over the slope at the face, its ridge runs dW/2m = 8' on past them.
  // In plan it covers DW + dW²/4m = 48 + 32 = 80 SF: 80·√2 of its own, less 80·√1.25 of the 6/12 it covers.
  near(f.areas[0].squareFeet, 80 * Math.SQRT2, "its own roof at 12/12");
  near(f.areas[1].squareFeet, -80 * F6, "less the slope it covers, at 6/12");
  assert(f.areas[0].pitch === 12 && f.areas[1].pitch === 6, JSON.stringify(f.areas));
  near(f.squareFeet, 80 * (Math.SQRT2 - F6), "net: +23.69 SF");
  near(f.lengths.ridge, 6 + 8, "ridge: the 6' projection and 8' on into the slope");
  // Each valley (W/2)·√(1 + (d/m)² + d²) = 4·√(1 + 4 + 1).
  near(f.lengths.valley, 2 * 4 * Math.sqrt(6), "two valleys");
  near(f.lengths.eave, 12, "two eaves along its cheeks, 6' each");
  near(f.lengths.rake, 2 * 4 * Math.SQRT2, "two rakes: 4 across and 4 up");
  near(f.lengths.step, 2 * 6 * F6, "step flashing: 6' of run up each cheek, at 6/12");
  near(f.apronFeet, 8, "apron across its face");
  near(f.lengths.headwall, 8, "counted with the headwall flashing");
  // Cheeks mD²/2 = 9 SF each; the face 8 x 3 under its eaves and the 8 x 4 / 2 gable over them.
  near(f.sidingSquareFeet, 18 + 24 + 16, "cheeks and face, gross");
  const two = x.pieceFigures({ id: "d", kind: "gableDormer", widthFeet: 8, projectionFeet: 6, pitch: 12, count: 2 }, 6);
  near(two.squareFeet, 2 * f.squareFeet, "two alike: twice the area");
  near(two.lengths.valley, 2 * f.lengths.valley, "and twice the valleys");
});

test("a dormer's valleys are a cross gable's at a different pitch: the 12/12 cross gable on 6/12 in lib/roof.ts gives the same", () => {
  // 10' wide: the cross gable test above has its valleys 5·√6 each, its ridge 10' into the slope, and 50 SF of plan at 12/12 for 6/12.
  const f = x.pieceFigures({ id: "d", kind: "gableDormer", widthFeet: 10, projectionFeet: 4, pitch: 12, onPitch: 6 }, 9);
  const e = rect(40, 30, { pitch: 6, eaveOverhangFeet: 0, rakeOverhangFeet: 0, additions: [{ id: "cg", kind: "gable", sideId: "front", fromFeet: 15, toFeet: 25 }], sectionPitches: { cg: 12 } });
  const r = roofOf(e).roofing;
  near(f.lengths.valley, r.valleyFeet, "the same valleys");
  near(f.lengths.ridge - 4, r.ridgeFeet - 40, "the same ridge past the face");
  // The cross gable's change in area is the dormer's net less its projection's strip, 4 x 10 at 12/12 for 6/12.
  near(f.squareFeet - 40 * (Math.SQRT2 - F6), r.areaSquareFeet - 1200 * F6, "the same change in area");
});

test("a shed dormer 12' wide and 8' out at 3/12 on a 10/12 slope, worked by hand", () => {
  const f = x.pieceFigures({ id: "s", kind: "shedDormer", widthFeet: 12, projectionFeet: 8, pitch: 3, onPitch: 10 }, 6);
  const m = 10 / 12;
  const s = 3 / 12;
  // 96 SF of plan: at 3/12 its own, less the 10/12 it covers - less roof than was there.
  near(f.squareFeet, 96 * (Math.sqrt(1 + s * s) - Math.sqrt(1 + m * m)), "net area, below nothing");
  assert(f.squareFeet < 0, "a shed dormer flatter than its slope takes roof away");
  near(f.lengths.headwall, 12 + 12, "its top against the slope and its apron, 12' each");
  near(f.apronFeet, 12, "the apron");
  near(f.lengths.step, 2 * 8 * Math.sqrt(1 + m * m), "step flashing up both cheeks");
  near(f.lengths.eave, 12, "one eave across its front");
  near(f.lengths.rake, 2 * 8 * Math.sqrt(1 + s * s), "two rakes along its cheeks");
  assert(f.lengths.valley === 0 && f.lengths.ridge === 0, "no valleys or ridge");
  // Its face stands D(m - s) = 4'8": cheeks (m - s)D²/2 each, the face 12 x 4'8".
  near(f.sidingSquareFeet, (m - s) * 64 + 12 * 8 * (m - s), "cheeks and face");
  const steep = x.pieceFigures({ id: "s", kind: "shedDormer", widthFeet: 12, projectionFeet: 8, pitch: 12, onPitch: 10 }, 6);
  assert(steep.missing.join() === "a pitch flatter than the slope it is on" && steep.squareFeet === 0, steep.missing.join());
});

test("turrets, a barrel, a flat roof and an Other piece, worked by hand", () => {
  // A cone 12' across at 24/12: r = 6, slant 6·√5, area π·6·6√5.
  const cone = x.pieceFigures({ id: "t", kind: "roundTurret", diameterFeet: 12, pitch: 24 }, 6);
  near(cone.squareFeet, Math.PI * 6 * 6 * SQRT5, "cone");
  near(cone.lengths.eave, 12 * Math.PI, "its eave, the circle");
  // Eight sides of 5' at 18/12: inradius 5 / 2tan(22.5°) = 6.0355, circumradius 5 / 2sin(22.5°) = 6.5328.
  const oct = x.pieceFigures({ id: "o", kind: "polygonTurret", sideCount: 8, sideFeet: 5, pitch: 18 }, 6);
  const ri = 5 / (2 * Math.tan(Math.PI / 8));
  const R = 5 / (2 * Math.sin(Math.PI / 8));
  near(ri, 6.03553, "inradius");
  near(oct.squareFeet, (8 * 5 * ri * Math.sqrt(1 + 1.5 * 1.5)) / 2, "eight triangles up the slant height");
  near(oct.lengths.hip, 8 * Math.hypot(R, ri * 1.5), "eight hips, corner to top");
  near(oct.lengths.eave, 40, "eaves round it");
  // A four-sided one is a hip roof on a square: its hips are a hip roof's, run x √(2 + k²).
  const four = x.pieceFigures({ id: "q", kind: "polygonTurret", sideCount: 4, sideFeet: 10, pitch: 6 }, 6);
  near(four.lengths.hip, 4 * 5 * x.hipValleyFactor(6), "a square's hips");
  near(four.squareFeet, 100 * F6, "and its area, plan x factor");
  // An arc of span 12 and rise 3: radius (36 + 9) / 6 = 7.5, half-angle asin(6 / 7.5), arc 15·asin(0.8).
  const barrel = x.pieceFigures({ id: "b", kind: "barrel", spanFeet: 12, lengthFeet: 20, riseFeet: 3 }, 6);
  const arc = 15 * Math.asin(0.8);
  near(barrel.squareFeet, arc * 20, "the arc times its length");
  assert(barrel.areas[0].pitch === null, "curved: no one pitch");
  near(barrel.lengths.eave, 40, "two eaves");
  near(barrel.lengths.rake, 2 * arc, "the two arcs as rakes");
  const half = x.pieceFigures({ id: "b", kind: "barrel", spanFeet: 12, lengthFeet: 1, riseFeet: 6 }, 6);
  near(half.squareFeet, 6 * Math.PI, "a half-round: π·r per foot");
  const flat = x.pieceFigures({ id: "f", kind: "flat", squareFeet: 120, perimeterFeet: 44, perimeterAs: "eave" }, 6);
  assert(flat.areas[0].pitch === 0 && flat.lengths.eave === 44 && flat.dripEdgeFeet === 0, JSON.stringify(flat));
  const dripOnly = x.pieceFigures({ id: "f", kind: "flat", squareFeet: 120, perimeterFeet: 44, perimeterAs: "dripEdge" }, 6);
  assert(dripOnly.lengths.eave === 0 && dripOnly.dripEdgeFeet === 44, JSON.stringify(dripOnly));
  const other = x.pieceFigures({ id: "x", kind: "other", squareFeet: 60, lengths: { valley: 7, step: 3 } }, 5);
  assert(other.areas[0].pitch === 5 && other.lengths.valley === 7 && other.lengths.step === 3, "at the roof's pitch, its lengths as typed");
  const blank = x.pieceFigures({ id: "g", kind: "gableDormer", widthFeet: 8 }, 6);
  assert(blank.missing.join() === "its projection,its pitch" && blank.squareFeet === 0 && blank.lengths.valley === 0, blank.missing.join());
});

test("a dormer on the drawing: its quantities add to the drawing's, and the lines say what came from it", () => {
  const dormer = { id: "d1", kind: "gableDormer", widthFeet: 8, projectionFeet: 6, pitch: 12 };
  const base = roofOf(rect(40, 30, { pitch: 6 })).roofing;
  const e = rect(40, 30, { pitch: 6, dripEdge: true, pieces: [dormer] });
  e.scope = { roofing: true, sides: ["front"], soffitFascia: false, eavestrough: false };
  const r = roofOf(e).roofing;
  const own = 80 * Math.SQRT2;
  const hole = 80 * F6;
  near(r.areaSquareFeet, base.areaSquareFeet + own - hole, "area: the drawing's and the dormer's net");
  near(r.ridgeFeet, 42 + 14, "ridge");
  near(r.valleyFeet, 8 * Math.sqrt(6), "valleys: the dormer's alone");
  near(r.eaveFeet, 84 + 12, "eaves");
  near(r.starterFeet, 96, "starter follows the eaves, the dormer's in them");
  near(r.iceWaterFeet, 96 + 8 * Math.sqrt(6), "ice & water: eaves + valleys");
  assert(r.pieces.added.valley > 0 && r.from.valley === "drawing", "worked out, not typed");
  assert(r.byPitch.map((b) => b.pitch).join() === "12,6", JSON.stringify(r.byPitch));
  const { roofing, siding } = x.exteriorScopeLines(e);
  const has = (list, line) => assert(list.includes(line), `missing "${line}" in:\n      ${list.join("\n      ")}`);
  has(roofing, `Remove & replace roofing – material to confirm – 12/12 on ${(own / 100).toFixed(2)} SQ, 6/12 on ${((base.areaSquareFeet - hole) / 100).toFixed(2)} SQ – ${((base.areaSquareFeet + own - hole) / 100).toFixed(2)} SQ (all slopes, with added pieces)`);
  has(roofing, "Added roof pieces – gable dormer, 8' wide, 6' out, 12/12 on a 6/12 slope (+23.7 SF net of the slope it covers) – added to the drawing's totals");
  has(roofing, `Steep roof charge – 10/12 to 12/12 – ${(own / 100).toFixed(2)} SQ`);
  has(roofing, "Hip & ridge cap – 56.0 LF (incl. 14.0 LF from added pieces)");
  has(roofing, "Starter – 96.0 LF (eaves; incl. 12.0 LF from added pieces)");
  has(roofing, `Drip edge – ${(96 + RAKES_40X30 + 8 * Math.SQRT2).toFixed(1)} LF (eaves + rakes; incl. ${(12 + 8 * Math.SQRT2).toFixed(1)} LF from added pieces) – photos required`);
  has(roofing, `Ice & water barrier – ${(96 + 8 * Math.sqrt(6)).toFixed(1)} LF (eaves + valleys; incl. ${(12 + 8 * Math.sqrt(6)).toFixed(1)} LF from added pieces)`);
  has(roofing, `Valleys – ${(8 * Math.sqrt(6)).toFixed(1)} LF (from added pieces)`);
  has(roofing, `Step flashing – ${(12 * F6).toFixed(1)} LF (from added pieces)`);
  has(roofing, "Headwall flashing – 8.0 LF (from added pieces)");
  has(siding, "Remove & replace siding – dormer cheeks & faces – 58.0 SF (added pieces, openings not taken off)");
  // Nothing put on: the lines are as they always were.
  const plain = rect(40, 30, { pitch: 6, dripEdge: true });
  plain.scope = e.scope;
  assert(!/added pieces|Added roof pieces/.test(x.exteriorScopeLines(plain).roofing.join(" ")), "no pieces, no words for them");
});

test("a typed total stands for the drawing and the pieces alike; a blank one is the two added", () => {
  const dormer = { id: "d1", kind: "gableDormer", widthFeet: 8, projectionFeet: 6, pitch: 12 };
  const e = rect(40, 30, { pitch: 6, pieces: [dormer], typed: { valley: 25, squareFeet: 2000 } });
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const r = roofOf(e).roofing;
  near(r.valleyFeet, 25, "the typed valleys, the dormer's not added");
  near(r.pieces.added.valley, 0, "nothing added to a typed total");
  near(r.areaSquareFeet, 2000, "the typed area");
  near(r.ridgeFeet, 56, "ridge left blank: the drawing's and the dormer's");
  // The typed area shared out by pitch as the drawing and the dormer have them.
  const total = roofOf(rect(40, 30, { pitch: 6, pieces: [dormer] })).roofing.areaSquareFeet;
  near(r.byPitch.find((b) => b.pitch === 12).areaSquareFeet, (80 * Math.SQRT2 * 2000) / total, "12/12's share");
  const lines = x.exteriorScopeLines(e).roofing;
  const has = (line) => assert(lines.includes(line), `missing "${line}" in:\n      ${lines.join("\n      ")}`);
  has("Valleys – 25.0 LF – from the estimator");
  has("Hip & ridge cap – 56.0 LF (incl. 14.0 LF from added pieces) – from the drawing");
  has("Added roof pieces – gable dormer, 8' wide, 6' out, 12/12 on a 6/12 slope (+23.7 SF net of the slope it covers) – added to the drawing's totals, not to those typed");
  assert(lines[0].endsWith("– 20.00 SQ – from the estimator"), lines[0]);
});

test("a piece with its numbers missing is asked for and counts nothing; a curved piece is its own band", () => {
  const e = rect(40, 30, { pitch: 6, pieces: [{ id: "g", kind: "gableDormer", widthFeet: 8 }] });
  const r = roofOf(e).roofing;
  assert(r.toAnswer.roofing.includes("the gable dormer: its projection and its pitch"), r.toAnswer.roofing.join("; "));
  near(r.areaSquareFeet, roofOf(rect(40, 30, { pitch: 6 })).roofing.areaSquareFeet, "nothing added");
  const b = rect(40, 30, { pitch: 6, pieces: [{ id: "b", kind: "barrel", spanFeet: 12, lengthFeet: 20, riseFeet: 3 }] });
  b.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const rb = roofOf(b).roofing;
  const arc = 15 * Math.asin(0.8) * 20;
  near(rb.curved.areaSquareFeet, arc, "curved squares apart");
  assert(rb.steepBands.length === 0, "no steep charge for a curve");
  const first = x.exteriorScopeLines(b).roofing[0];
  assert(first === `Remove & replace roofing – material to confirm – 6/12 on 15.34 SQ, curved on ${(arc / 100).toFixed(2)} SQ – ${((1533.9426 + arc) / 100).toFixed(2)} SQ (all slopes, with added pieces)`, first);
});

test("roof pieces with no outline: listed and asked for squares; the 3D view says they are not drawn", () => {
  const e = { sides: [], roof: { ...x.defaultRoof(), pitch: 6, pieces: [{ id: "t", kind: "roundTurret", diameterFeet: 12, pitch: 24 }] }, scope: { roofing: true, sides: [], soffitFascia: false, eavestrough: false } };
  const r = x.exteriorQuantities(e).roofing;
  assert(r !== null && !r.drawn, "roofing, with no drawing");
  near(r.eaveFeet, 12 * Math.PI, "its eaves are the roof's so far");
  const lines = x.exteriorScopeLines(e).roofing;
  assert(lines[0] === "Remove & replace roofing – material to confirm – 6/12 – squares to confirm", lines[0]);
  assert(lines[1] === `Added roof pieces – round turret, 12' across, 24/12 (${(Math.PI * 36 * SQRT5).toFixed(1)} SF)`, lines[1]);
  const d = rect(40, 30, { pitch: 6, pieces: [{ id: "a", kind: "gableDormer", count: 2, widthFeet: 8, projectionFeet: 6, pitch: 12 }, { id: "t", kind: "roundTurret" }] });
  const model = x.exteriorModel(d);
  assert(model.ok && model.model.notes.includes("Roof pieces not drawn: 2 × gable dormer, round turret. Their quantities are in the roof's totals."), JSON.stringify(model.ok && model.model.notes));
});

test("a gambrel: 24/12 up to a break 8' over the eave, 6/12 above it, gable ends - the break counts nothing", () => {
  const e = rect(40, 30, { pitch: 24, eaveOverhangFeet: 0, rakeOverhangFeet: 0, sectionBreaks: { main: { upperPitch: 6, breakFeet: 8 } } });
  const q = roofOf(e);
  const plan = q.roof;
  const r = q.roofing;
  assert(plan.note === null && plan.sections[0].break && plan.sections[0].break.pitch === 6, plan.note);
  // 8' up at 24/12 is 4' in; the 11' left to the ridge at 6/12 rises 5'6": the ridge 13'6" up.
  near(r.areaSquareFeet, 2 * 40 * 4 * SQRT5 + 2 * 40 * 11 * F6, "area: 4' strips at 24/12, 11' at 6/12, each side");
  assert(r.slopes.length === 4, `${r.slopes.length} slopes`);
  assert(r.byPitch.map((b) => b.pitch).join() === "24,6", JSON.stringify(r.byPitch));
  near(r.ridgeFeet, 40, "one ridge");
  near(r.eaveFeet, 80, "eaves");
  near(r.hipFeet + r.valleyFeet, 0, "no hips or valleys: the break is no line");
  // Each gable end: 4 in and 8 up, then 11 in and 5'6" up, both ways.
  near(r.rakeFeet, 2 * 2 * (Math.hypot(4, 8) + Math.hypot(11, 5.5)), "rakes, bent at the break");
  // The gable end's siding follows the bent roof.
  const left = q.rises.left;
  assert(left.some((p) => Math.abs(p.t - 4 / 30) < 1e-6 && Math.abs(p.rise - 8) < 1e-6) && left.some((p) => Math.abs(p.t - 0.5) < 1e-6 && Math.abs(p.rise - 13.5) < 1e-6), JSON.stringify(left));
  e.scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const lines = x.exteriorScopeLines(e).roofing;
  assert(lines.includes(`Steep roof charge – over 12/12 – ${((2 * 40 * 4 * SQRT5) / 100).toFixed(2)} SQ`), lines.join(" | "));
});

test("a mansard: hip ends, a flat top or a 4/12 one above the break", () => {
  const flatTop = roofOf(rect(40, 30, { pitch: 24, ends: { left: "hip", right: "hip" }, eaveOverhangFeet: 0, rakeOverhangFeet: 0, sectionBreaks: { main: { upperPitch: 0, breakFeet: 8 } } })).roofing;
  // The steep band 4' in all round: 1200 - 32 x 22 of plan at 24/12, the 704 SF top flat.
  near(flatTop.areaSquareFeet, 496 * SQRT5 + 704, "area");
  // Four hips, 4' in each way and 8' up: √(32 + 64).
  near(flatTop.hipFeet, 4 * Math.sqrt(96), "four hips to the top's corners");
  near(flatTop.ridgeFeet + flatTop.valleyFeet + flatTop.rakeFeet, 0, "no ridge, valleys or rakes: the top's edge is no line");
  near(flatTop.eaveFeet, 140, "eaves all round");
  assert(flatTop.byPitch.map((b) => b.pitch).join() === "24,0", JSON.stringify(flatTop.byPitch));
  const pitched = roofOf(rect(40, 30, { pitch: 24, ends: { left: "hip", right: "hip" }, eaveOverhangFeet: 0, rakeOverhangFeet: 0, sectionBreaks: { main: { upperPitch: 4, breakFeet: 8 } } })).roofing;
  // Above the break a 32 x 22 hip roof at 4/12: its ridge 32 - 22 = 10, its hips 11 of run each x √(2 + 1/9).
  near(pitched.ridgeFeet, 10, "the top's ridge");
  near(pitched.hipFeet, 4 * Math.sqrt(96) + 4 * 11 * x.hipValleyFactor(4), "the steep hips and the top's");
  near(pitched.areaSquareFeet, 496 * SQRT5 + 704 * F4, "area");
});

test("a break that is no break is left off; a wing tied into a gambrel needs the same break, or the break goes and says why", () => {
  const plain = roofOf(rect(40, 30, { pitch: 6 })).roofing;
  for (const brk of [
    { upperPitch: 8, breakFeet: 3 },
    { upperPitch: 3, breakFeet: 0 },
    { upperPitch: 3, breakFeet: 20 },
  ]) {
    const q = roofOf(rect(40, 30, { pitch: 6, sectionBreaks: { main: brk } }));
    assert(!q.roof.sections[0].break, JSON.stringify(brk));
    near(q.roofing.areaSquareFeet, plain.areaSquareFeet, `as plain: ${JSON.stringify(brk)}`);
  }
  // The 40 x 30 house and its 20 x 20 garage, both 24/12; the house a gambrel, 8' to its break.
  const brk = { upperPitch: 6, breakFeet: 8 };
  const one = roofOf(houseAndGarage({ pitch: 24, sectionBreaks: { main: brk } })).roof;
  assert(/^The second pitch on the main roof is left out: a part tied into it would leave a step/.test(one.note ?? ""), one.note);
  assert(one.sections.every((s) => !s.break), "no break kept");
  // Both bent alike: the garage's ridge 8 + 6/2 = 11' up meets the house's slope 4 + 3 x 2 = 10' in, its own half-span.
  const both = roofOf(houseAndGarage({ pitch: 24, sectionBreaks: { main: brk, "wing:garageFront": brk } }));
  assert(both.roof.note === null && both.roof.sections.every((s) => s.break), both.roof.note);
  // Two 45° valleys, each bent at the break: 4 in each way and 8 up, then 6 and 3.
  near(both.roofing.valleyFeet, 2 * (Math.sqrt(96) + Math.sqrt(72 + 9)), "valleys");
});

test("3D: a gambrel and a mansard stand on their walls with no crack, the gable end bent with the roof", () => {
  // Default 16" eaves at 24/12 put the drip line 2'8" under the eave; the ridge 13'6" over the eave with 0 overhangs.
  const { m } = soundRoof(rect(40, 30, { pitch: 24, eaveOverhangFeet: 0, rakeOverhangFeet: 0, sectionBreaks: { main: { upperPitch: 6, breakFeet: 8 } } }), "gambrel", [], 0.03);
  near(topOf(wallNamed(m, "Left")), 10 + 13.5, "the gable end's peak");
  near(wallTopAt(wallNamed(m, "Left"), 4), 10 + 8, "the gable end's top at the break, 4' in");
  soundRoof(rect(40, 30, { pitch: 24, ends: { left: "hip", right: "hip" }, sectionBreaks: { main: { upperPitch: 0, breakFeet: 8 } } }), "mansard, flat top", [], 0.03);
  soundRoof(houseAndGarage({ pitch: 24, sectionBreaks: { main: { upperPitch: 6, breakFeet: 8 }, "wing:garageFront": { upperPitch: 6, breakFeet: 8 } } }), "gambrel house and garage", [], 0.03);
});

console.log("\nroof pieces and breaks as slots the photos fill (10-15)");

test("a dormer proposed off the photos counts once ticked, says so on its lines, and is the estimator's once a number is changed", () => {
  const dormer = { id: "d1", kind: "gableDormer", widthFeet: 8, projectionFeet: 6, pitch: 12 };
  const scope = { roofing: true, sides: [], soffitFascia: false, eavestrough: false };
  const base = roofOf(rect(40, 30, { pitch: 6 })).roofing;
  const offered = rect(40, 30, { pitch: 6, pieces: [{ ...dormer, source: "photos" }] });
  offered.scope = scope;
  const r0 = roofOf(offered).roofing;
  near(r0.areaSquareFeet, base.areaSquareFeet, "not ticked: nothing added");
  assert(r0.pieces.list.length === 0 && r0.pieces.offered.length === 1 && r0.valleyFeet === 0, "offered, counted nowhere");
  assert(!/added pieces|Added roof pieces/.test(x.exteriorScopeLines(offered).roofing.join(" ")), "no words for it on the scope");
  assert(!x.exteriorModel(offered).model.notes.some((n) => /Roof pieces/.test(n)), "nor in 3D");
  const taken = rect(40, 30, { pitch: 6, pieces: [{ ...dormer, source: "photos", taken: true }] });
  taken.scope = scope;
  const lines = x.exteriorScopeLines(taken).roofing;
  const has = (line) => assert(lines.includes(line), `missing "${line}" in:\n      ${lines.join("\n      ")}`);
  assert(lines[0].endsWith("(all slopes, with added pieces from photos)"), lines[0]);
  has("Added roof pieces – gable dormer, 8' wide, 6' out, 12/12 on a 6/12 slope (+23.7 SF net of the slope it covers) (from photos) – added to the drawing's totals");
  has("Hip & ridge cap – 56.0 LF (incl. 14.0 LF from added pieces from photos)");
  has(`Valleys – ${(8 * Math.sqrt(6)).toFixed(1)} LF (from added pieces from photos)`);
  // A typed turret beside it: the photos' share of a line said apart.
  const both = rect(40, 30, { pitch: 6, pieces: [{ ...dormer, source: "photos", taken: true }, { id: "t", kind: "roundTurret", diameterFeet: 12, pitch: 24 }] });
  both.scope = scope;
  const starter = x.exteriorScopeLines(both).roofing.find((l) => l.startsWith("Starter"));
  assert(starter === `Starter – ${(84 + 12 + 12 * Math.PI).toFixed(1)} LF (eaves; incl. ${(12 + 12 * Math.PI).toFixed(1)} LF from added pieces, 12.0 LF of it from photos)`, starter);
  // A number changed by hand: the estimator's from then on.
  const edited = x.editedPiece({ ...dormer, source: "photos", taken: true }, { widthFeet: 9 });
  assert(edited.widthFeet === 9 && edited.source === undefined && edited.taken === undefined && x.pieceCounts(edited) && !x.pieceFromPhotos(edited), JSON.stringify(edited));
  assert(x.pieceCounts(dormer) && !x.pieceCounts({ ...dormer, source: "photos" }), "typed counts; a proposal waits");
});

test("a gambrel's break off its gable's photo fills its part, under one typed; the pitch below it is typed, photos, assumed as ever", () => {
  const read = photoRead(24, "gable", { upperPitch: 6, breakFeet: 8 });
  const e = withRead(rect(40, 30, { pitch: null, eaveOverhangFeet: 0, rakeOverhangFeet: 0 }), "left", read);
  const q = roofOf(e);
  assert(q.pitch.source === "photos" && q.pitch.value === 24, `the pitch below from the photo: ${q.pitch.source} ${q.pitch.value}`);
  assert(q.roof.sections[0].break && q.roof.sections[0].break.pitch === 6, "the break from the photo");
  near(q.roofing.areaSquareFeet, 2 * 40 * 4 * SQRT5 + 2 * 40 * 11 * F6, "the gambrel worked by hand above");
  assert(q.roofing.byPitch.every((b) => b.fromPhotos), JSON.stringify(q.roofing.byPitch));
  // A break typed in Pitch mode stands over the photo's.
  e.roof = { ...e.roof, sectionBreaks: { main: { upperPitch: 4, breakFeet: 8 } } };
  near(roofOf(e).roofing.areaSquareFeet, 2 * 40 * 4 * SQRT5 + 2 * 40 * 11 * F4, "the typed 4/12 above the break");
  assert(x.photoSectionBreaks(e).main === undefined, "the photo's set aside under it");
  // The pitch below typed over the photo's, the photo's break still in: 8' up at 20/12 is 4'9.6" in.
  e.roof = { ...e.roof, sectionBreaks: undefined, pitch: 20 };
  const k = 20 / 12;
  near(roofOf(e).roofing.areaSquareFeet, 2 * 40 * 4.8 * Math.sqrt(1 + k * k) + 2 * 40 * (15 - 4.8) * F6, "typed 20/12 below, the photo's 6/12 above");
  // No photo and nothing typed: the assumed pitch, and no break - a break is never assumed.
  const plain = roofOf(rect(40, 30, { pitch: null }));
  assert(plain.pitch.source === "assumed" && plain.roof.sections.every((s) => !s.break), "assumed, unbent");
});

test("a wing's gable photo with a break fills the wing's own: the house typed, the garage off its photo, tied in as one gambrel", () => {
  const brk = { upperPitch: 6, breakFeet: 8 };
  const e = withRead(houseAndGarage({ pitch: 24, sectionBreaks: { main: brk } }), "garageFront", photoRead(24, "gable", brk));
  assert(x.photoSectionBreaks(e)["wing:garageFront"]?.upperPitch === 6, JSON.stringify(x.photoSectionBreaks(e)));
  const q = roofOf(e);
  assert(q.roof.note === null && q.roof.sections.every((s) => s.break), q.roof.note);
  near(q.roofing.valleyFeet, 2 * (Math.sqrt(96) + Math.sqrt(72 + 9)), "the two bent valleys worked by hand above");
});

console.log("\nthe roof's shapes off the photos: dormers, turrets, two storeys, the ridge's direction (10-15)");

/*
  The dormer scene, metres (worked by hand, handwork.py beside the session's notes): an eave side 12 m long,
  its wall top 3.0 m up; the slope over it 10/12, the eave's fascia 1'6" out and the roof 8" over the soffit
  there, so the slope at the wall's face is z0 = 3.0 + 0.2032 + (10/12)(0.4572) = 3.5842 m up. A gable
  dormer 2.4 m wide (4.8 to 7.2 m along), its face 1.2 m back: its apron on the slope at 3.5842 + 1.0 =
  4.5842 m; projecting 1.5 m, so its eaves 1.25 m over that, at 5.8342 m; 12/12, its peak 1.2 m higher, 7.0342 m.
*/
const DORMER = { L: 12, top: 3.0, m: 10 / 12, eaveOut: 1.5, b: 1.2, a0: 4.8, a1: 7.2, apron: 4.5842, eave: 5.8342, peak: 7.0342 };
const dormerFrame = { alongMinM: -1, alongMaxM: 13, upMinM: -0.5, upMaxM: 8.5, ppm: 100, width: 1400, height: 900 };
const dormerCam = () => phone({ at: [5.0, -8.0, 1.6], yaw: 0.05, pitch: 0.25, width: 4000, height: 3000, f: 2400 });
/** A point [b] behind the wall as the squared image shows it, in its pixels. */
const dpx = (cam, a, u, b = 0) => {
  const s = seenOnWall(cam, a, u, -b);
  return [x.frameX(dormerFrame, s.alongM), x.frameY(dormerFrame, s.upM)];
};
/**
 * What a perfect trace of the eave side answers: the wall top level, the dormer's face top and apron where they show -
 * as the call answers them, points in flat runs [x1, y1, x2, y2, ...]. [pieces] in place of the dormer; [storeys] over "none".
 */
function dormerWire(cam, { apron = true, kind = "gable", pieces, storeys = {} } = {}) {
  const D = DORMER;
  const mid = (D.a0 + D.a1) / 2;
  const dormer = {
    kind: `${kind}_dormer`,
    outline: (kind === "gable" ? [dpx(cam, D.a0, D.eave, D.b), dpx(cam, mid, D.peak, D.b), dpx(cam, D.a1, D.eave, D.b)] : [dpx(cam, D.a0, D.eave, D.b), dpx(cam, D.a1, D.eave, D.b)]).flat(),
    foot: apron ? [dpx(cam, D.a0, D.apron, D.b), dpx(cam, D.a1, D.apron, D.b)].flat() : [],
    sides: 0,
  };
  return {
    materials: [],
    openings: [],
    wall_top: [dpx(cam, 0, D.top), dpx(cam, D.L, D.top)],
    off_wall: [],
    roof: { over_wall: "eave", rake_left: [], rake_right: [], eave_line: [], left_end: { kind: "hip_corner", point: [] }, right_end: { kind: "hip_corner", point: [] }, notes: "" },
    roof_shapes: { pieces: pieces ?? [dormer], upper_floor: "none", floor_line: [], lower_roof: "none", notes: "", ...storeys },
    notes: "",
  };
}
const dormerTrace = (opts) => {
  const cam = dormerCam();
  return x.traceProposals(dormerWire(cam, opts), dormerFrame, DORMER.L * M, x.camerasAt([cam.photo]));
};

test("a gable dormer off an eave side's photo: how far back it stands, its width, projection and pitch, worked by hand", () => {
  const p = dormerTrace();
  assert(p.pieces.length === 1, JSON.stringify(p.pieces));
  const q = p.pieces[0];
  assert(q.piece.kind === "gableDormer" && q.agree && q.piece.pitch === 12, JSON.stringify(q));
  // Seen 8/9.2 of its size from 8 m out with its face 1.2 m back: 2.4 x 8/9.2 = 2.0870 m across.
  near(q.piece.seen.widthFeet / M, 2.4 * (8 / 9.2), "seen narrower than it is", 0.002);
  near(q.piece.seen.wallTopFeet / M, DORMER.top, "the wall top under it", 1e-6);
  // On the 10/12 slope under a 1'6" eave: 1.2 m back (3'11.2"), 2.4 m wide (7'10.5"), projecting 1.5 m (4'11.1"), 12/12.
  const r = x.resolvePhotoPiece({ id: "d", taken: true, ...q.piece }, 10, DORMER.eaveOut);
  near(r.setBackFeet / M, DORMER.b, "how far back its face stands", 0.002);
  near(r.piece.widthFeet / M, 2.4, "its width", 0.002);
  near(r.piece.projectionFeet / M, 1.5, "its projection: the cheek 1.25 m over the slope, over 10/12", 0.002);
  assert(r.piece.pitch === 12 && r.piece.onPitch === null && r.piece.source === "photos" && r.piece.taken === true, JSON.stringify(r.piece));
  // The same read on a slope taken as 4/12: the face would stand 93.6 m back - no such dormer, so said and its width read as if on the wall.
  const flat = x.resolvePhotoPiece({ id: "d", taken: true, ...q.piece }, 4, DORMER.eaveOut);
  assert(flat.setBackFeet === null && flat.piece.projectionFeet === null && /didn't come out .* is the roof's pitch right/.test(flat.checks.join(" ")), flat.checks.join(" | "));
  near(flat.piece.widthFeet, q.piece.seen.widthFeet, "as seen");
});

test("a ticked dormer is a roof piece from photos on the roof as built: a pitch typed later carries in; set aside it is offered; changed by hand it is the estimator's", () => {
  const p = dormerTrace();
  const front = (e) => e.sides.find((s) => s.id === "front");
  // On the 40 x 30's front, its ridge along the 40: the front's slope is the roof's. Nothing typed for the pitch yet: assumed 4/12.
  const base = rect(40, 30, { pitch: null, eaveOverhangFeet: DORMER.eaveOut, overhangSource: { eave: "typed" } });
  const ticked = x.applyTrace(front(base), p, { shapes: [], openings: [], wallTop: false, roofShapes: x.shapePicksAtFirst(p) }, "2026-10-15T00:00:00Z");
  assert(ticked.roofRead.pieces.length === 1 && ticked.roofRead.pieces[0].taken === true && ticked.roofRead.at === "2026-10-15T00:00:00Z", JSON.stringify(ticked.roofRead));
  const e = { ...base, sides: base.sides.map((s) => (s.id === "front" ? ticked : s)), scope: allScope };
  const assumed = x.photoRoofPieces(e, roofOf(e).roof, 4)[0];
  assert(assumed.setBackFeet === null && /assumed 4\/12/.test(assumed.checks.join(" ")), assumed.checks.join(" | "));
  // The pitch typed at 10/12: the dormer is worked out on it, as in the case above - nothing on the side changed.
  e.roof = { ...e.roof, pitch: 10 };
  const q = roofOf(e);
  const list = q.roofing.pieces.list;
  assert(list.length === 1 && list[0].piece.source === "photos", JSON.stringify(list.map((l) => l.piece)));
  near(list[0].piece.widthFeet / M, 2.4, "its width on the 10/12", 0.002);
  near(list[0].piece.projectionFeet / M, 1.5, "its projection", 0.002);
  /*
    W 7.8740', D 4.9213', 12/12 on 10/12 (lib/roofPieces.ts): plan 4.9213 x 7.8740 + 1 x 7.8740² / (4 x 0.8333) = 57.350;
    at 12/12 x 1.414214 = 81.105, less the slope's 57.350 x 1.301708 = 74.653: +6.452 SF. Ridge 4.9213 + 7.8740/1.6667 =
    9.6457; valleys 7.8740 x √(1 + 1.44 + 1) = 14.6041; eaves 9.8425; rakes 11.1355; step 2 x 4.9213 x 1.301708 = 12.8121.
  */
  near(q.roofing.pieces.addedFromPhotos.squareFeet, 6.452, "its area, all from photos", 0.002);
  near(q.roofing.pieces.addedFromPhotos.valley, 14.6041, "valleys", 0.001);
  near(q.roofing.pieces.addedFromPhotos.step, 12.8121, "step flashing", 0.001);
  const typed = roofOf(rect(40, 30, { pitch: 10, eaveOverhangFeet: DORMER.eaveOut }));
  near(q.roofing.areaSquareFeet, typed.roofing.areaSquareFeet + 6.452, "the drawing's plus the dormer's", 0.002);
  const lines = x.exteriorScopeLines(e).roofing;
  assert(lines.some((l) => /^Added roof pieces – gable dormer, 7'10" wide, 4'11" out, 12\/12 on a 10\/12 slope .*\(from photos\)/.test(l)) && lines.some((l) => /incl\. .* from added pieces from photos/.test(l)), lines.join(" | "));
  // Set aside on its side: offered, counted nowhere.
  const id = ticked.roofRead.pieces[0].id;
  const aside = x.withPhotoPiece(e, "front", id, (pp) => ({ ...pp, taken: false }));
  const qa = roofOf(aside);
  assert(qa.roofing.pieces.list.length === 0 && qa.roofing.pieces.offered.length === 1, "offered, not counted");
  near(qa.roofing.areaSquareFeet, typed.roofing.areaSquareFeet, "the drawing's alone");
  // Changed by hand on the roof pane: the estimator's own 9' dormer stands in its place - counted once.
  const own = x.editedPiece(list[0].piece, { widthFeet: 9 });
  const mine = x.withPhotoPieceMadeOwn(e, "front", id, own);
  const qm = roofOf(mine);
  assert(qm.roofing.pieces.list.length === 1 && qm.roofing.pieces.list[0].piece.widthFeet === 9 && !x.pieceFromPhotos(qm.roofing.pieces.list[0].piece), JSON.stringify(qm.roofing.pieces.list.map((l) => l.piece)));
  assert(front(mine).roofRead.pieces[0].typedAs === mine.roof.pieces[0].id, "the photo's stands aside for it");
  // Traced again, the same dormer still has the estimator's in its place; their piece taken off, the photo's is back.
  const again = x.applyTrace(front(mine), p, { shapes: [], openings: [], wallTop: false, roofShapes: x.shapePicksAtFirst(p) });
  assert(again.roofRead.pieces[0].typedAs === mine.roof.pieces[0].id && again.roofRead.pieces[0].id !== id, "re-read, still theirs");
  const gone = { ...mine, roof: { ...mine.roof, pieces: [] } };
  assert(roofOf(gone).roofing.pieces.list[0].piece.source === "photos", "back to the photo's");
});

test("a dormer the photo can't place, a shed dormer, a hipped one: read as far as the photo goes, said, and not ticked", () => {
  // Its foot hidden: how far back is unknown, so its width is read as if on the wall, and its projection is left to type.
  const hidden = dormerTrace({ apron: false }).pieces[0];
  assert(!hidden.agree && /hidden/.test(hidden.checks.join(" ")), hidden.checks.join(" | "));
  const rh = x.resolvePhotoPiece({ id: "d", taken: true, ...hidden.piece }, 10, DORMER.eaveOut);
  assert(rh.setBackFeet === null && rh.piece.projectionFeet === null && x.pieceFigures(rh.piece, 10).missing.join() === "its projection", JSON.stringify(rh.piece));
  // A shed dormer: its width (the same 2.4 m), its projection and pitch to type - its slope runs away from the photo.
  const shed = dormerTrace({ kind: "shed" }).pieces[0];
  assert(shed.piece.kind === "shedDormer" && shed.piece.pitch === null && /type its projection and its pitch/.test(shed.checks.join(" ")), JSON.stringify(shed));
  const rs = x.resolvePhotoPiece({ id: "s", taken: true, ...shed.piece }, 10, DORMER.eaveOut);
  near(rs.piece.widthFeet / M, 2.4, "the shed dormer's width", 0.002);
  assert(x.pieceFigures(rs.piece, 10).missing.join() === "its projection,its pitch", x.pieceFigures(rs.piece, 10).missing.join());
  // Ticked, it is asked for in the roofing questions, as a piece typed with numbers missing is.
  const e = rect(40, 30, { pitch: 10 });
  e.sides[0].roofRead = { at: "t", pieces: [{ id: "s", taken: true, ...shed.piece }] };
  assert(roofOf(e).roofing.toAnswer.roofing.some((t) => /the shed dormer: its projection and its pitch/.test(t)), roofOf(e).roofing.toAnswer.roofing.join(" | "));
  // A hipped dormer: no piece to propose, said for the estimator to put in by hand.
  const hip = dormerTrace({ kind: "hipped" });
  assert(hip.pieces.length === 0 && hip.checks.some((c) => /hipped dormer it can't read/.test(c)), hip.checks.join(" | "));
});

test("a turret: its pitch off its roof's outline, its width as if on the wall's line; a many-sided one's side from its width", () => {
  // A round turret 3 m across at 1 to 4 m along, its eave 4 m up, 12/12: its cone's outline 1.5 m up over 1.5 m each way.
  const cam = dormerCam();
  const turret = (kind, sides) => ({ kind: `${kind}_turret`, outline: [dpx(cam, 1, 4), dpx(cam, 2.5, 5.5), dpx(cam, 4, 4)].flat(), foot: [dpx(cam, 1, 4), dpx(cam, 4, 4)].flat(), sides });
  const p = x.traceProposals(dormerWire(cam, { pieces: [turret("round", 0), turret("many_sided", 8)] }), dormerFrame, DORMER.L * M, x.camerasAt([cam.photo]));
  const [round, octagon] = p.pieces;
  assert(round.piece.kind === "roundTurret" && round.piece.pitch === 12 && round.agree && /as if it stood on the wall's line/.test(round.checks.join(" ")), JSON.stringify(round));
  const rr = x.resolvePhotoPiece({ id: "t", taken: true, ...round.piece }, 5, 1);
  // On the wall's line it shows as it is: 3 m, 9'10.1".
  near(rr.piece.diameterFeet / M, 3, "its diameter", 1e-6);
  // Eight sides, 3 m across the flats: each 3 x tan(22.5°) = 1.2426 m (4'0.9").
  const ro = x.resolvePhotoPiece({ id: "o", taken: true, ...octagon.piece }, 5, 1);
  assert(ro.piece.sideCount === 8 && octagon.piece.pitch === 12, JSON.stringify(ro.piece));
  near(ro.piece.sideFeet / M, 3 * Math.tan(Math.PI / 8), "each side", 1e-6);
  // Its sides not said: not ticked, asked.
  const unsure = x.traceProposals(dormerWire(cam, { pieces: [turret("many_sided", 0)] }), dormerFrame, DORMER.L * M, x.camerasAt([cam.photo])).pieces[0];
  assert(!unsure.agree && /How many sides/.test(unsure.checks.join(" ")), JSON.stringify(unsure));
});

test("what stands over a side: an upper floor flush with its floor line, or set back behind a lean-to or a ridge out; reads that disagree are flagged", () => {
  const cam = dormerCam();
  // Flush: a tall wall (its top 5.8 m, 19'0") with the floor line at 3.0 m (9'10.1").
  const tallWire = { ...dormerWire(cam, { pieces: [], storeys: { upper_floor: "flush", floor_line: [dpx(cam, 0, 3.0), dpx(cam, 12, 3.0)].flat() } }), wall_top: [dpx(cam, 0, 5.8), dpx(cam, 12, 5.8)] };
  const flush = x.traceProposals(tallWire, dormerFrame, DORMER.L * M, x.camerasAt([cam.photo])).storeys;
  assert(flush.upper === "flush" && flush.agree.upper && flush.lowerRoof === null, JSON.stringify(flush));
  near(flush.floorLineFeet / M, 3.0, "the floor line", 1e-6);
  // Flush, but the wall top one storey's (3.0 m): flagged, not ticked.
  const low = x.traceProposals({ ...tallWire, wall_top: [dpx(cam, 0, 3), dpx(cam, 12, 3)], roof_shapes: { ...tallWire.roof_shapes, floor_line: [] } }, dormerFrame, DORMER.L * M, x.camerasAt([cam.photo])).storeys;
  assert(!low.agree.upper && /one storey's/.test(low.checks.join(" ")), JSON.stringify(low));
  // Set back behind a lean-to, the roof over the side an eave: as one. Behind a ridge out, but the roof read as an eave: flagged.
  // Words read however written: "Set back", "lean-to".
  const set = (lower) => x.traceProposals(dormerWire(cam, { pieces: [], storeys: { upper_floor: "Set back", lower_roof: lower } }), dormerFrame, DORMER.L * M, x.camerasAt([cam.photo]));
  const lean = set("lean-to");
  assert(lean.storeys.upper === "setBack" && lean.storeys.lowerRoof === "leanto" && lean.storeys.agree.lowerRoof, JSON.stringify(lean.storeys));
  const out = set("ridge_out");
  assert(out.storeys.lowerRoof === "tent" && !out.storeys.agree.lowerRoof, JSON.stringify(out.storeys));
  const picks = x.shapePicksAtFirst(out);
  assert(picks.upper === true && picks.lowerRoof === false, JSON.stringify(picks));
  // Onto the side as ticked, the one set aside kept as set aside.
  const s = x.applyTrace(side({ id: "rear", name: "Rear" }), out, { shapes: [], openings: [], wallTop: false, roofShapes: picks });
  assert(s.roofRead.upper === "setBack" && s.roofRead.lowerRoof === null, JSON.stringify(s.roofRead));
});

test("two storeys from the photos: the high-roof charge until one is drawn, answers typed stand; the floor line to split at; a lower roof's kind under one picked", () => {
  const read = (more) => ({ at: "t", ...more });
  // An upper floor over the Front, none drawn: two storeys, from photos - charged on the whole roof, and not asked.
  const e = { ...withRead(rect(40, 30, { pitch: 6 }), "front", read({ upper: "flush" })), scope: allScope };
  const r = roofOf(e).roofing;
  assert(r.high && !r.high.automatic && r.high.fromPhotos && r.highFromPhotos.twoStoreys && r.highFromPhotos.sides.join() === "Front", JSON.stringify(r.high));
  assert(!r.toAnswer.roofing.some((t) => /two storeys/.test(t)), r.toAnswer.roofing.join(" | "));
  assert(x.exteriorScopeLines(e).roofing.some((l) => /^High roof charge – two storeys or more \(from photos\) – /.test(l)), x.exteriorScopeLines(e).roofing.join(" | "));
  // Answered no by the estimator: theirs stands.
  assert(roofOf({ ...e, roof: { ...e.roof, high: false } }).roofing.high === null, "typed no");
  // Two sides that show none: one storey, from photos - no charge and not asked. One side alone says nothing of the house.
  const none = withRead(withRead(rect(40, 30, { pitch: 6 }), "front", read({ upper: "none" })), "left", read({ upper: "none" }));
  const rn = roofOf(none).roofing;
  assert(rn.high === null && rn.highFromPhotos.twoStoreys === false && !rn.toAnswer.roofing.some((t) => /two storeys/.test(t)), JSON.stringify(rn.highFromPhotos));
  const one = roofOf(withRead(rect(40, 30, { pitch: 6 }), "front", read({ upper: "none" }))).roofing;
  assert(one.highFromPhotos === null && one.toAnswer.roofing.some((t) => /two storeys/.test(t)), "one side: still asked");
  // The floor line: the reads' median - 9'8", 9'10", 10'1" give 9'10".
  const lines = withRead(withRead(withRead(rect(40, 30), "front", read({ upper: "flush", floorLineFeet: ft(9, 8) })), "right", read({ upper: "flush", floorLineFeet: ft(10, 1) })), "rear", read({ upper: "flush", floorLineFeet: ft(9, 10) }));
  near(x.photoFloorLine(lines).feet, ft(9, 10), "the median floor line", 1e-9);
  // The bump-out behind the two-storey box is a ridge out by its shape (10 deep, 16 along); its photo says a lean-to, so it is one; picked a ridge out, it is.
  const bump = boxAndBumpOut();
  bump.sides = bump.sides.map((s) => (s.id === "bumpRear" ? { ...s, roofRead: read({ upper: "setBack", lowerRoof: "leanto" }) } : s));
  const q = roofOf(bump);
  assert(q.roof.lowerRoofs.map((l) => `${l.sideId}:${l.kind}`).join() === "bumpRear:leanto" && x.lowerRoofsFromPhotos(bump).has("bumpRear"), JSON.stringify(q.roof.lowerRoofs));
  // As a lean-to: one slope from its eave up 10 to the wall, headwall along the 16, as the lean-to picked on the plan (above) gives.
  near(q.roofing.headwallFeet, 16, "headwall along the back wall");
  const picked = roofOf({ ...bump, roof: { ...bump.roof, lowerRoofs: { bumpRear: "tent" } } });
  assert(picked.roof.lowerRoofs[0].kind === "tent" && !x.lowerRoofsFromPhotos({ ...bump, roof: { ...bump.roof, lowerRoofs: { bumpRear: "tent" } } }).has("bumpRear"), "picked stands");
  // A drawn upper floor answers the charge itself: the photos' read changes nothing.
  assert(q.roofing.high.automatic && q.roofing.highFromPhotos === null, "drawn");
});

test("the ridge's direction from the photos: a gable over a long side turns it, an eave over a short one too; picked on the plan, it stands", () => {
  // 40 x 30, nothing picked: the ridge along the 40, ends over Right and Left. The Front's photo shows a gable: turned
  // parallel to the Right, the ends are over Front and Rear, and the Front's pitch is the main roof's.
  const g = withRead(rect(40, 30), "front", photoRead(5));
  const ridge = x.ridgeFromPhotos(g);
  assert(ridge && ridge.ridgeAlong === "right" && ridge.agree.length === 1 && ridge.of === 1, JSON.stringify(ridge));
  const q = roofOf(g);
  assert(q.roof.ends.map((e) => e.sideId).sort().join() === "front,rear", JSON.stringify(q.roof.ends));
  assert(x.photoPitches(g).main.length === 1 && x.photoPitches(g).unplaced.length === 0, JSON.stringify(x.photoPitches(g)));
  // 5/12 with the default 1'4" eaves and 1' rakes, the ridge along the 30: eaves out past the 40's ends, rakes past the 30's -
  // (40 + 2'8") x (30 + 2') = 1,365.33 SF of plan x 1.083333 = 1,479.11 SF (along the 40 it was 42 x 32.6667 x 1.083333 = 1,486.33).
  near(q.roofing.areaSquareFeet, 1479.1111, "the roof turned", 0.001);
  assert(x.photoNotes(g).some((n) => /^The ridge is set from the photos: Front shows a roof end\. Pick the ridge below/.test(n)), x.photoNotes(g).join(" | "));
  // An eave read over the Left (a short side) says the same: the ridge runs along it.
  const eave = withRead(rect(40, 30), "left", photoRead(null, "eave"));
  assert(x.ridgeFromPhotos(eave)?.ridgeAlong === "right" && x.resolvedRidgeAlong(eave) === "right", JSON.stringify(x.ridgeFromPhotos(eave)));
  // A hip end read over the Right, where the outline puts an end already: nothing to turn.
  assert(x.ridgeFromPhotos(withRead(rect(40, 30), "right", photoRead(null, "hip"))) === null, "already fits");
  // Picked on the plan, it stands, and the Front's gable is said again.
  const picked = { ...g, roof: { ...g.roof, ridgeAlong: "front" } };
  assert(x.ridgeFromPhotos(picked) === null && x.photoPitches(picked).unplaced.length === 1, "picked");
  // Set aside on its side, the read turns nothing.
  assert(x.ridgeFromPhotos(withRead(rect(40, 30), "front", { ...photoRead(5), over: null, pitch: null })) === null, "set aside");
});

test("the owner's 14:53 walk: the photos' gables already fit the roof, so the ridge stays and the squares do too", () => {
  // The walk as Scrivn reads it, the test claim's roof set-up (session dd469594's squares.mjs), the west gable (Left 5) and the
  // bump-out (Rear) ticked as on 10-15: 5/12, rakes 25.6" and 27.1", the bump-out's eave 22.9".
  const read = x.parseScanExterior(fixture("scan-exterior-v2-walk-1453.json"), { scanId: null });
  assert(read.ok, read.error);
  const base = read.exterior;
  const id = (name) => base.sides.find((s) => s.name === name).id;
  const front = base.sides.find((s) => s.name === "Front");
  const sq = 6.963;
  const reads = {
    "Left 5": { at: "t", pitch: 5, slopes: [4.97, 5.06], rakeOverhangFeet: 25.6 / 12, over: "gable" },
    Rear: { at: "t", pitch: 5, slopes: [5.08, 5.09], rakeOverhangFeet: 27.1 / 12, eaveOverhangFeet: 22.9 / 12, over: "gable" },
  };
  const e = {
    ...base,
    sides: base.sides.map((s) => (reads[s.name] ? { ...s, roofRead: reads[s.name] } : s)),
    roof: {
      ...x.defaultRoof(),
      ...base.roof,
      pitch: null,
      eaveOverhangFeet: x.DEFAULT_EAVE_OVERHANG_FEET,
      rakeOverhangFeet: x.DEFAULT_RAKE_OVERHANG_FEET,
      ridgeAlong: null,
      ends: { [id("Front 2")]: "hip" },
      coveredNotches: [id("Rear 3")],
      lowerWings: [id("Front 2")],
      wingGables: [id("Front 2")],
      additions: [
        { id: "porch", kind: "porch", sideId: front.id, fromFeet: 0, toFeet: front.lengthFeet, depthFeet: ft(4, 10) },
        { id: "door-gable", kind: "gable", sideId: front.id, fromFeet: (2.9 / sq) * front.lengthFeet, toFeet: (6.4 / sq) * front.lengthFeet },
      ],
    },
  };
  assert(x.ridgeFromPhotos(e) === null, JSON.stringify(x.ridgeFromPhotos(e)));
  const q = roofOf(e);
  assert(q.pitch.source === "photos" && q.pitch.value === 5, JSON.stringify(q.pitch));
  // 34.0445 off this fixture, as main gives it before this change; the capture file the 10-15 read used (its corners
  // rounded a hair differently) gives 34.0464 - the 34.05 in docs/roof-from-photos.md.
  near(q.roofing.squares, 34.0445, "34.04 SQ, unchanged", 0.0005);
  assert(q.roofing.pieces.list.length === 0 && q.roofing.highFromPhotos === null, "no shapes read: nothing else changes");
});

test("a dormer's read scales with its side, and goes onto the upper side with the roof when a tall side is split", () => {
  const q = dormerTrace().pieces[0];
  const pp = { id: "d", taken: true, ...q.piece };
  const scaled = x.scaledRoofRead({ at: "t", pieces: [pp], floorLineFeet: 10 }, 1.1);
  const s = scaled.pieces[0];
  near(s.seen.widthFeet, pp.seen.widthFeet * 1.1, "width", 1e-9);
  near(s.camera.distanceFeet, pp.camera.distanceFeet * 1.1, "where the phone stood", 1e-9);
  near(scaled.floorLineFeet, 11, "the floor line", 1e-9);
  // Every length the phone measured times 1.1, the pitch a ratio: the dormer comes out about 1.1 times as big - not exactly, as
  // the fascia's 8" over the soffit is no measure of the phone's and stays (7'10.5" becomes 8'8.3", not 8'7.9").
  const a = x.resolvePhotoPiece(pp, 10, DORMER.eaveOut);
  const b = x.resolvePhotoPiece(s, 10, DORMER.eaveOut * 1.1);
  near(b.piece.widthFeet, a.piece.widthFeet * 1.1, "scaled width, within 1/2\"", 0.042);
  near(b.piece.projectionFeet, a.piece.projectionFeet * 1.1, "scaled projection, within 1/2\"", 0.042);
  // Moved onto a side 10' along and 9' up: the same dormer, worked out the same - and the floor line spent.
  const moved = x.shiftedRoofRead({ at: "t", pieces: [pp], floorLineFeet: 9 }, 10, 9);
  const c = x.resolvePhotoPiece({ ...moved.pieces[0], seen: { ...moved.pieces[0].seen } }, 10, DORMER.eaveOut);
  near(moved.pieces[0].alongFeet, pp.alongFeet - 10, "along", 1e-9);
  near(c.piece.widthFeet, a.piece.widthFeet, "the same width", 1e-6);
  near(c.piece.projectionFeet, a.piece.projectionFeet, "the same projection", 1e-6);
  assert(moved.floorLineFeet === undefined, "spent");
  // Split: the tall front's dormer goes up with its roof read, on the upper front's frame.
  const e = exterior([side({ id: "front", name: "Front", lengthFeet: 40, eaveLeftFeet: 19, eaveRightFeet: 19, roofRead: { at: "t", pieces: [pp] } }), side({ id: "right", name: "Right", eaveLeftFeet: 19, eaveRightFeet: 19 }), side({ id: "rear", name: "Rear", lengthFeet: 40, eaveLeftFeet: 19, eaveRightFeet: 19 }), side({ id: "left", name: "Left", eaveLeftFeet: 19, eaveRightFeet: 19 })], { pitch: 10 });
  const fp = x.exteriorFootprint(e);
  e.upper = x.upperFromOutline(fp.corners, fp);
  const split = x.splitTallSides(e, 10);
  const up = split.upper.sides.find((u) => u.name === "Upper front");
  assert(!split.sides.find((v) => v.id === "front").roofRead && up.roofRead.pieces.length === 1, "onto the upper front");
  near(up.roofRead.pieces[0].seen.apronFeet, pp.seen.apronFeet - 10, "its heights from the floor line", 1e-9);
  near(up.roofRead.pieces[0].camera.upFeet, pp.camera.upFeet - 10, "and the phone's", 1e-9);
});

test("a trace's answer recovered from the route's proposals reads back to them: what test:exterior:trace records and replays", () => {
  // The route sends proposals, not Claude's answer; test/exterior/traceRecord.mjs puts each pixel back through the frame.
  for (const [what, answer, frame, lengthFeet, at] of [
    ["the dormer's eave side", dormerWire(dormerCam()), dormerFrame, DORMER.L * M, x.camerasAt([dormerCam().photo])],
    ["a shed dormer with its foot hidden", dormerWire(dormerCam(), { kind: "shed", apron: false, storeys: { upper_floor: "set_back", lower_roof: "lean_to", notes: "a note" } }), dormerFrame, DORMER.L * M, x.camerasAt([dormerCam().photo])],
    ["the owner's gable", gableWire([phone({ at: [2.6, -6.5, 1.5], yaw: 0.05, pitch: 0.15, width: 1920, height: 1080, f: 1100 })]), roofFrame, G.L * M, null],
    ["the painted wall's materials, openings and boxes", wire, traceFrame, 8 * M, null],
  ]) {
    const p = x.traceProposals(answer, frame, lengthFeet, at);
    const back = rec.wireFromProposals(p, frame, x);
    const off = rec.proposalsDiffer(x.traceProposals(back, frame, lengthFeet, at), p);
    assert(off === null, `${what}: ${off}`);
  }
  // What a proposal does not keep is refused, not made up: a turret's wall edges, a floor line's ends.
  const cam = dormerCam();
  const turret = { kind: "round_turret", outline: [dpx(cam, 1, 4), dpx(cam, 2.5, 5.5), dpx(cam, 4, 4)].flat(), foot: [dpx(cam, 1, 4), dpx(cam, 4, 4)].flat(), sides: 0 };
  const withTurret = x.traceProposals(dormerWire(cam, { pieces: [turret] }), dormerFrame, DORMER.L * M, x.camerasAt([cam.photo]));
  let threw = "";
  try {
    rec.wireFromProposals(withTurret, dormerFrame, x);
  } catch (err) {
    threw = err.message;
  }
  assert(/turret keeps no wall edges/.test(threw), threw || "did not throw");
  // A difference past a millionth is found, and where.
  assert(/proposals\.roof\.pitch\.read/.test(rec.proposalsDiffer({ roof: { pitch: { read: 5 } } }, { roof: { pitch: { read: 5.001 } } }) ?? ""), "found");
});

test("the call is asked for the roof's shapes in the same one call: dormers, turrets, what stands over the wall", () => {
  const msg = x.traceUserMessage(traceFrame, { name: "Front", lengthM: 8, bottomLeftM: 0.5, bottomRightM: 0.5, leftEndInPhoto: true, rightEndInPhoto: true });
  assert(/6\. roof_shapes: what stands on the roof above this wall/.test(msg) && /each dormer on the roof above this wall whose front faces out the same way/.test(msg) && /stands back on the roof, so it shows smaller than it is/.test(msg), "dormers");
  assert(/"gable_dormer"/.test(msg) && /"many_sided_turret"/.test(msg) && /upper_floor: "none" .*"flush" .*"set_back"/.test(msg) && /dormers and a walk-out basement make no upper floor/.test(msg), "turrets and storeys");
  assert(/\[x1, y1, x2, y2, \.\.\.\]/.test(msg), "points as flat runs");
  // One small object, points as flat runs of numbers: the grammar the schema compiles to has no room for more (lib/roofPhotoShapes.ts).
  const props = x.TRACE_SCHEMA.properties;
  const rs = props.roof_shapes;
  assert(rs && x.TRACE_SCHEMA.required.includes("roof_shapes") && rs.properties.pieces.items.properties.outline.items.type === "number" && rs.properties.floor_line.items.type === "number", JSON.stringify(rs));
  assert(JSON.stringify(x.pointsOf([1, 2, 3, 4, 5])) === "[[1,2],[3,4]]" && JSON.stringify(x.pointsOf([[1, 2]])) === "[[1,2]]" && x.pointsOf(null).length === 0, "flat runs read as points; pairs too");
  // A trace from before 10-15 has none of them: no pieces, no storeys - nothing put on the side for them.
  const old = x.traceProposals({ materials: [], openings: [], wall_top: [], off_wall: [], notes: "" }, traceFrame, 8 * M);
  assert(old.pieces === undefined && old.storeys === undefined, JSON.stringify(old));
});

console.log("\nthe roof check: the owner's house off photos alone (10-16, lib/roofCheck.ts)");

/**
 * The owner's house as the photo route read it on 10-16 (Desktop/Claude - scope/photo-route-proof): 15 phone photos and three
 * tapes, nothing tapped on the phone, the photos read by eye for gable, hip or eave over each side. The footprint was right;
 * the roof (main, 9c42cc8) was "very wrong": one 72'7" ridge down the east strip from the garage's bay to the bump-out, no
 * lower garage, a hip over the French-door wall, the west part of the house forced lower - 32.83 SQ at the default overhangs.
 * The real roof, as the owner gives it and the 10-13 test claim drew it: 5/12; the deck under the main roof; the garage
 * hipped at the street, a gable over its east bay, tied in lower under a gable on the house; gable ends west and at the
 * bump-out; the porch the main roof's front slope carried on; a gable over the front door.
 */
function photoRouteHouse() {
  const read = x.parseScanExterior({ ...fixture("photos-only-1016.json"), finish: fixture("photos-only-1016-finish.json") }, { scanId: null });
  assert(read.ok, read.error);
  return read.exterior;
}
const sideStarting = (e, start) => e.sides.find((s) => s.name.startsWith(start));
const ridgesOf = (plan) => linesOf(plan, "ridge").map((l) => l.feet);

/**
 * His taps on the roof check: the garage "Lower, under a gable" (one tap - his walls can't say it, see below); + Porch roof
 * on the front wall, 4'10" out; + Cross gable on it (over its door); Looks right, keeping the garage's assumed 1'6" drop.
 */
function ownersTaps(e) {
  const front = sideStarting(e, "Front wall behind");
  const fp = x.exteriorFootprint(e);
  const feet = fp.lengthsFeet[fp.sideIds.indexOf(front.id)];
  let roof = x.withWingAnswer(e.roof, roofOf(e).roof, sideStarting(e, "Garage front, left").id, "gable");
  roof = x.withAddition(roof, "porch", front.id, feet);
  roof = { ...roof, additions: roof.additions.map((a) => ({ ...a, depthFeet: ft(4, 10) })) };
  roof = x.withAddition(roof, "gable", front.id, feet, front.openings.find((o) => o.kind === "door"));
  const tapped = { ...e, roof };
  const plan = roofOf(tapped).roof;
  const fromPhotos = x.endsFromPhotos(tapped, plan);
  const guessed = plan.ends.filter((en) => !(en.sideId in tapped.roof.ends) && !fromPhotos.has(en.sideId)).map((en) => en.sideId);
  return { ...tapped, roof: x.withRoofChecked(tapped.roof, plan, guessed, "2026-10-16T22:00:00.000Z", roofOf(tapped).wingDrops) };
}

test("his house off photos, nothing pressed: the deck under the roof, the house's ridge east-west, the garage left to him", () => {
  const e = photoRouteHouse();
  const q = roofOf(e);
  const plan = q.roof;
  const named = (start) => sideStarting(e, start).id;
  // The house is the main roof, deck and all: 48'11" across, its ridge the whole way and a 1' rake each end - no 72' ridge.
  assert(plan.shape === "wings" && plan.sections[0].axis === "x" && plan.note === null, `${plan.shape} ${plan.sections[0].axis}: ${plan.note}`);
  near(Math.max(...ridgesOf(plan)), 48.884 + 2, "the house's ridge, west gable to east gable", 0.01);
  assert(ridgesOf(plan).every((f) => f < 55), `no long ridge down the east strip: ${ridgesOf(plan).map((f) => f.toFixed(1))}`);
  // Each end as the photos show it; the east wall, eaves over the garage and bump-out either side of the house's gable, is no hip.
  const ends = Object.fromEntries(plan.ends.map((en) => [en.sideId, en.kind]));
  assert(
    ends[named("Left gable")] === "gable" && ends[named("Right side")] === "gable" && ends[named("Garage front, left")] === "hip" && ends[named("Garage front, right")] === "gable" && ends[named("Rear bump-out")] === "gable",
    JSON.stringify(plan.ends),
  );
  assert(!(named("Rear wall") in ends), "no end, and no hip, over the rear wall");
  near(plan.ends.find((en) => en.sideId === named("Right side")).share, 38.3 / 70.57, "the house's gable over half the east wall", 0.01);
  // The garage is not proposed lower (2026-10-16): its walls meet the house's only where the keystone wall meets the front wall,
  // and that wall's heights are from the porch deck - it reads the garage 9" HIGHER. The house's rear walls read 15'11" from the
  // back yard, 6'5" below the driveway: compared, they had put the garage 5'4" lower (the owner: "the gap between the roofs is
  // too great"). So every part ties in until he says otherwise.
  assert(plan.wings.every((w) => !w.lower), JSON.stringify(plan.wings));
  near(x.measuredDrop(x.roofInput(e, q.footprint, 5), named("Garage front, left"), { ends: x.measuredSideEnds(e) }), 8.6 - 9.35, "at the keystone corner, the porch deck's 8'7\" against the garage's 9'4\"", 0.01);
  assert(plan.notches.filter((k) => k.covered).map((k) => k.sideIds.join()).join("|") === [named("Covered-deck side"), named("Covered-deck back")].join(), "the deck alone under the roof");
  // Said so, part by part, on the check: proposed, with why.
  const p = x.roofProposal(e).proposed;
  assert(p.length === 1 && p[0].value === "covered" && /would have to sit lower/.test(p[0].why), JSON.stringify(p));
  // On the check, only the corners a deck could be: the deck, and the 15'3" x 5'6" behind the bump-out - not the step beside the
  // garage's bay, nor the 22' x 25' front corner (all four listed under the plan, as before).
  const nameOf = (id) => e.sides.find((s) => s.id === id).name;
  const rows = x.checkRows(plan, e.roof, x.roofProposal(e), nameOf, true);
  assert(rows.notches.length === 2 && rows.notches.filter((r) => r.proposed).length === 1 && rows.wings.every((r) => !r.proposed && r.drop === null), JSON.stringify(rows));
  assert(x.checkRows(plan, e.roof, x.roofProposal(e), nameOf).notches.length === 4, "every notch under the plan");
  // One roof, every part tied in.
  assert(new Set(plan.sections.map((s) => s.layer)).size === 1, "one roof");
});

test("his taps - the garage lower under a gable, a porch roof 4'10\" out, a gable over the door, Looks right: 33.49 SQ, the 10-13 claim's roof", () => {
  const e = ownersTaps(photoRouteHouse());
  const q = roofOf(e);
  const r = q.roofing;
  const plan = q.roof;
  // 5/12 off the three gables measured, the overhangs Scrivn's defaults (no overhang was read: said assumed on the report).
  assert(q.pitch.value === 5 && r.overhangs.eave.source === "default" && r.overhangs.rake.source === "default", JSON.stringify(q.pitch));
  // The lines, as the report lists them.
  near(r.ridgeFeet, 107.83, "ridge: the house 50'11\", the bump-out 17'7\", the gable over the garage 14'9\", the garage 11'5\", its bay 9'8\", the door's 3'7\"", 0.05);
  near(r.hipFeet, 31.6, "hips: the garage's street end", 0.05);
  near(r.valleyFeet, 101.5, "valleys: the bump-out's, the gable over the garage's, the bay's, the door gable's", 0.05);
  near(r.eaveFeet, 122.2, "eaves", 0.05);
  near(r.rakeFeet, 175.9, "rakes", 0.05);
  near(r.stepFeet, 34.3, "step flashing: the garage's slopes against the house's wall", 0.05);
  near(r.headwallFeet, 0, "no headwall");
  near(r.squares, 33.49, "squares", 0.005);
  // Near the 10-13 claim's 33.71 (next test): its footprint, the 14:53 walk's, is 133 SF smaller - this one's west side reads
  // long (+/-11%) - and the claim typed 2' eaves and 1'10" rakes, which here give 35.62.
  const typed = roofOf({ ...e, roof: { ...e.roof, eaveOverhangFeet: 2, rakeOverhangFeet: ft(1, 10), overhangSource: { eave: "typed", rake: "typed" } } });
  near(typed.roofing.squares, 35.62, "at the claim's overhangs", 0.005);
  // Looks right: every part answered as built, the guessed east gable the estimator's; nothing left to propose, the roof the same.
  assert(e.roof.checkedAt && e.roof.ends[sideStarting(e, "Right side").id] === "gable", JSON.stringify(e.roof.ends));
  assert(x.roofProposal(e).proposed.length === 0, JSON.stringify(x.roofProposal(e).proposed));
  assert(plan.wings.find((w) => w.sideId === sideStarting(e, "Garage front, left").id).gable, "the garage still under its gable");
  // The gable over the door: over the door and 2' either side of it, on the porch's slope.
  const door = sideStarting(e, "Front wall behind").openings.find((o) => o.kind === "door");
  const gable = e.roof.additions.find((a) => a.kind === "gable");
  near(gable.fromFeet, door.fromLeftFeet - 2, "from", 1e-9);
  near(gable.toFeet, door.fromLeftFeet + door.widthFeet + 2, "to", 1e-9);
  assert(plan.sections.some((s) => s.role === "porch") && plan.sections.some((s) => s.role === "gable" && s.key === gable.id), "a porch and the door's gable");
  // The garage's drop: nothing measured it, so the assumed 1'6", kept by Looks right as his.
  const garage = sideStarting(e, "Garage front, left").id;
  assert(e.roof.wingDrops?.[garage] === 1.5 && q.wingDrops[garage].source === "typed", JSON.stringify(q.wingDrops));
});

test("one level for the house's roofs: the garage 1'6\" under the house's eave in 3D and every elevation, not 6'5\"", () => {
  // Before (main e53e808): the house's eave at the middle of its walls' readings, 15'11" from the low back yard, the garage's at
  // 9'6" from the driveway - drawn 6'5" apart, and the South elevation read the house's eave 15'11" over the driveway.
  const e = ownersTaps(photoRouteHouse());
  const m = x.exteriorModel(e).model;
  near(m.eaves[0], 15.9, "the house's eave", 0.01);
  near(m.eaves[0] - m.eaves[1], 1.5, "the garage's 1'6\" under it", 1e-9);
  const south = x.houseView(m, "front");
  const levels = south.levels.filter((l) => l.label === "Eave").map((l) => l.y - south.groundY);
  // Over the driveway: the garage's eave 9'6"; the house's 11' - its porch eave 2' under that, about level with the garage's.
  assert(levels.length === 2, JSON.stringify(south.levels));
  near(levels[0], 9.5, "the garage's eave over the driveway", 0.01);
  near(levels[1], 11, "the house's eave over the driveway", 0.01);
  assert(levels.every((y) => y < 12), "no 15'11\" eave on the front");
  // Typed on the check as he measures it - 1'10" - and every view follows.
  const garage = sideStarting(e, "Garage front, left").id;
  const typed = { ...e, roof: x.withWingDrop(e.roof, garage, ft(1, 10)) };
  const t = x.exteriorModel(typed).model;
  near(t.eaves[0] - t.eaves[1], ft(1, 10), "1'10\" as typed", 1e-9);
  const ts = x.houseView(t, "front");
  near(Math.max(...ts.levels.filter((l) => l.label === "Eave").map((l) => l.y - ts.groundY)), 9.5 + ft(1, 10), "the house's eave 1'10\" over the garage's", 0.01);
  // The report says where the drop came from: assumed until typed.
  const said = (ex) => x.exteriorReport(ex, { title: "t", date: "d", madeWith: "m" });
  const assumedNow = { ...e, roof: { ...e.roof, wingDrops: {} } };
  assert(said(assumedNow).assumed.some((a) => a === "The roof out to Garage front, left bay sits 1'6\" under the eave of the roof it meets: Scrivn's assumption, as nothing measured it. Type it on the roof check."), said(assumedNow).assumed.join(" | "));
  assert(said(typed).sources.some((a) => a === "The roof out to Garage front, left bay: 1'10\" under the eave of the roof it meets, as set on the roof check."), said(typed).sources.join(" | "));
});

test("an answer stands over a proposal, and a roof from before the check is left as it was", () => {
  const e = photoRouteHouse();
  const plan = roofOf(e).roof;
  const garage = sideStarting(e, "Garage front, left").id;
  // Said to tie in: it ties in, and the deck stays proposed.
  const tied = { ...e, roof: x.withWingAnswer(e.roof, plan, garage, "tie") };
  const t = roofOf(tied).roof;
  assert(!t.wings.find((w) => w.sideId === garage).lower && t.notches.some((k) => k.covered), "tied in; the deck still under the roof");
  assert(x.roofProposal(tied).proposed.every((p) => p.key !== x.wingKey(garage)), "not proposed once answered");
  // The deck said to be open: open, and no other corner - the 22' x 25' front one - is proposed in its place.
  const deck = plan.notches.find((k) => k.covered);
  const open = { ...e, roof: x.withNotchAnswer(e.roof, plan, deck, "open") };
  assert(roofOf(open).roof.notches.every((k) => !k.covered), "nothing under the roof");
  // Lists set by hand before the check, nothing answered: nothing proposed.
  const legacy = { ...e, roof: { ...e.roof, lowerWings: [garage] } };
  assert(x.isLegacyRoof(legacy.roof) && x.roofProposal(legacy) === null && roofOf(legacy).roof.notches.every((k) => !k.covered), "as it was");
  // A house drawn by hand, no photos: nothing proposed either.
  const drawn = { ...e, sides: e.sides.map(({ photos, roofRead, ...s }) => s) };
  assert(x.roofProposal(drawn) === null, "no photos, no proposal");
});

test("on the photo route, a side still at the route's 10' says nothing, and only a garage is ever proposed lower", () => {
  // The route (lib/photoRouteExterior.ts) starts every side at a 10' eave and sets none itself; a read marks its own.
  const base = photoRouteHouse();
  const route = { ...base, source: { ...base.source, kind: "photos", by: "photos" }, sides: base.sides.map((s) => ({ ...s, eaveLeftFeet: 10, eaveRightFeet: 10, wallTopFrom: undefined })) };
  const id = (start) => sideStarting(route, start).id;
  const read = (e, start, feet) => ({ ...e, sides: e.sides.map((s) => (s.id === id(start) ? { ...s, eaveLeftFeet: feet, eaveRightFeet: feet, wallTopFrom: "photo" } : s)) });
  const wingsProposed = (e) => (x.roofProposal(e)?.proposed ?? []).filter((p) => p.key.startsWith("wing:")).map((p) => p.key.slice(5));
  // Nothing read: every wall at the route's 10' - no step to go on, nothing proposed lower; the deck still is, off the outline.
  assert(wingsProposed(route).length === 0 && x.roofProposal(route).proposed.some((p) => p.value === "covered"), JSON.stringify(x.roofProposal(route).proposed));
  // The garage read 9'2" against walls still at 10': no read of the house, nothing to compare.
  assert(wingsProposed(read(route, "Garage front, left", ft(9, 2))).length === 0, "the house unread");
  // Session A's partial reads (10-16): the west gable read 18'2", the bump-out 15'5", the garage 9'2" - walls that meet the
  // garage's at no corner, each from its own ground: nothing proposed. The bump-out is no garage, never lower.
  const partial = read(read(read(route, "Left gable", ft(18, 2)), "Rear bump-out", ft(15, 5)), "Garage front, left", ft(9, 2));
  assert(wingsProposed(partial).length === 0, JSON.stringify(x.roofProposal(partial).proposed));
  // The keystone wall (the garage's side) and the front wall it meets at a corner, both read over the one ground there: the
  // garage's eave 1'10" under the house's - proposed lower, under a gable on the house, that much under it.
  const corner = read(read(partial, "Keystone", ft(9, 4)), "Front wall behind", ft(11, 2));
  assert(wingsProposed(corner).join() === id("Garage front, left"), JSON.stringify(x.roofProposal(corner).proposed));
  const q = roofOf(corner);
  const garage = q.roof.wings.find((w) => w.sideId === id("Garage front, left"));
  assert(garage.lower && garage.gable, "the garage lower, under a gable on the house");
  assert(q.wingDrops[garage.sideId].source === "walls" && Math.abs(q.wingDrops[garage.sideId].feet - ft(1, 10)) < 1e-9, JSON.stringify(q.wingDrops));
});

test("the same check on the 14:53 walk the 10-13 claim was drawn on: proposed the same, the claim's taps give its 33.71 SQ", () => {
  const read = x.parseScanExterior(fixture("finish-1453/capture.json"), { scanId: null });
  assert(read.ok, read.error);
  const w = read.exterior;
  const id = (name) => w.sides.find((s) => s.name === name).id;
  const front = w.sides.find((s) => s.name === "Front");
  const sq = 6.963;
  // What the claim typed that the check doesn't ask: the pitch, the overhangs, the garage's street hip (no photo of it), the
  // porch and the door's gable where the claim put it.
  const typed = {
    ...x.defaultRoof(),
    ...w.roof,
    pitch: 5,
    eaveOverhangFeet: 2,
    rakeOverhangFeet: ft(1, 10),
    overhangSource: { eave: "typed", rake: "typed" },
    ends: { [id("Front 2")]: "hip" },
    additions: [
      { id: "porch", kind: "porch", sideId: front.id, fromFeet: 0, toFeet: front.lengthFeet, depthFeet: ft(4, 10) },
      { id: "door-gable", kind: "gable", sideId: front.id, fromFeet: (2.9 / sq) * front.lengthFeet, toFeet: (6.4 / sq) * front.lengthFeet },
    ],
  };
  // The deck proposed; the garage his tap - where its walls meet the house's, the walk's eaves don't put it lower.
  const p = x.roofProposal({ ...w, roof: typed }).proposed;
  assert(p.map((v) => `${v.key}=${v.value}`).join() === `notch:${id("Left 4")}=covered`, JSON.stringify(p));
  const answered = { ...w, roof: x.withWingAnswer(typed, roofOf({ ...w, roof: typed }).roof, id("Front 2"), "gable") };
  const checked = roofOf(answered);
  // The claim's own lists, typed: the same roof, line for line.
  const claim = roofOf({ ...w, roof: { ...typed, coveredNotches: [id("Rear 3")], lowerWings: [id("Front 2")], wingGables: [id("Front 2")] } });
  for (const k of ["squares", "ridgeFeet", "hipFeet", "valleyFeet", "eaveFeet", "rakeFeet", "stepFeet"]) near(checked.roofing[k], claim.roofing[k], k, 1e-6);
  near(checked.roofing.squares, 33.71, "the claim's 33.71 SQ", 0.005);
});

console.log("\nthe drawings and the report as a customer document (10-16)");

/**
 * The owner's house measured off photos and three tapes (10-16, the photos-only proof), with its East
 * side wall as read off photos #11-#14: the front walk down to the side door's landing, three 7" steps
 * just past the door, the lower walk past the basement windows, then down to the back gate - the parging
 * under the stucco stepping with it. Each side's ± is a field, not in its name.
 */
const photosOnly = fixture("photos-only-1016.json");
const owner = x.parseScanExterior(photosOnly).exterior;
const sideNamed = (e, n) => e.sides.find((s) => s.name === n);

test("the owner's side yard steps: the ground and the parging step down at the stairs past the side door, not one sloped band", () => {
  const east = sideStarting(owner, "Right side wall");
  const grade = x.elevationFaces(east).grade;
  // Three 7" risers, each upright: two points at one x.
  const risers = grade.map((p, i) => (i > 0 && Math.abs(p.x - grade[i - 1].x) < 1e-9 ? grade[i - 1].y - p.y : null)).filter((d) => d !== null);
  assert(risers.length === 3, JSON.stringify(grade));
  for (const d of risers) near(d, 7 / 12, 'a 7" riser', 1e-3);
  // A tape from the ground: 9'6" to the eave at the front (the proof's read off the garage front), 15'11" at the back.
  near(east.eaveLeftFeet - x.groundAt(east, 0), ft(9, 6), "eave over the front walk", 1 / 24);
  near(east.eaveRightFeet - x.groundAt(east, east.lengthFeet), ft(15, 11), "eave over the back", 1 / 24);
  // The side door stands on its landing.
  const door = east.openings.find((o) => o.kind === "door");
  near(x.groundAt(east, door.fromLeftFeet + door.widthFeet / 2), door.sillFeet, "the landing under the door", 1e-3);
  // The stucco's bottom steps too: down at the first basement window, where the parging's top meets it.
  const stucco = east.shapes.find((s) => s.kind === "stucco").polygon;
  assert(stucco.some((p, i) => i > 0 && Math.abs(p.x - stucco[i - 1].x) < 1e-9 && Math.abs(p.y - stucco[i - 1].y) > 1 && p.y < 10), JSON.stringify(stucco));
  // Drawn as shapes, counted as shapes: the parging is not cladding.
  const q = x.sideQuantities(east);
  assert(q.bands.length === 1 && q.bands[0].kind === "stucco", JSON.stringify(q.bands));
});

test("a parging bottom is the ground end to end, at the corners' own x: a slope stays a slope, a step stays upright", () => {
  // The west gable's parging was tapped sloping up 1'6" to the right; read at a rounded x, the corner was missed and the ground came out level.
  const west = sideStarting(owner, "Left gable wall");
  near(x.groundAt(west, west.lengthFeet), 0.4572 / 0.3048, "the ground rises 1'6\" to its right end", 1e-6);
  near(x.groundAt(west, west.lengthFeet / 2), 0.2286 / 0.3048, "and halfway along, halfway up", 1e-6);
  // A step at an x with more places than a millionth: still upright, and at that x.
  const at = 10 / 3;
  const s = side({ shapes: [{ id: "p", kind: "parging", closed: true, polygon: [{ x: 0, y: 2 }, { x: at, y: 2 }, { x: at, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 1 }, { x: 0, y: 3 }] }, { id: "c", kind: "stucco", closed: true, polygon: [{ x: 0, y: 3 }, { x: 30, y: 1 }, { x: 30, y: 10 }, { x: 0, y: 10 }] }], heightsFrom: "level" });
  const g = x.elevationFaces(s).grade;
  assert(JSON.stringify(g.map((p) => [Math.round(p.x * 1e4) / 1e4, p.y])) === JSON.stringify([[0, 2], [3.3333, 2], [3.3333, 0], [30, 0]]), JSON.stringify(g));
  near(x.groundAt(s, 1), 2, "on the top tread", 1e-9);
  near(x.groundAt(s, 20), 0, "below the step", 1e-9);
  // A side not tapped as shapes keeps its grade line: the eaves' fall.
  const plain = side({ eaveLeftFeet: 10, eaveRightFeet: 12 });
  near(x.groundAt(plain, 30), -2, "a taped side's grade falls as its eaves say", 1e-9);
});

test("the report of a photos-only house: walls read off the photos, the ± on the sides to tape, heights and sills from the ground under them", () => {
  const r = x.exteriorReport(owner, { title: "t", date: "d", madeWith: "m" });
  assert(r.sources.includes("Walls, heights, materials and openings: read off the photos, side by side round the house; nothing was tapped on the walls."), r.sources.join(" | "));
  assert(!r.sources.some((s) => /tapped on the phone/.test(s)), "nothing was tapped");
  const walls = r.tables.find((t) => t.caption === "Walls by side and material");
  assert(walls.rows.every((row) => row[2] === "photo" || row[2] === "-"), JSON.stringify(walls.rows.map((row) => row[2])));
  assert(r.tables.find((t) => t.caption === "Openings").rows.every((row) => row[2] === "photo"), "the openings too");
  // Only the three sides further out than 5% are to check, in the order round the house; the taped side has no ± at all.
  const check = r.notes.filter((n) => n.includes("worked out from the photos, not taped"));
  assert(
    JSON.stringify(check) ===
      JSON.stringify([
        "Right side wall: 70'7\" ±6%, worked out from the photos, not taped. Tape it to be sure.",
        "Covered-deck side: 9'1\" ±12%, worked out from the photos, not taped. Tape it to be sure.",
        "Left gable wall: 29'2\" ±11%, worked out from the photos, not taped. Tape it to be sure.",
      ]),
    JSON.stringify(check),
  );
  assert(sideStarting(owner, "Rear bump-out gable").lengthPlusMinusPct === undefined && sideStarting(owner, "Bay step").lengthPlusMinusPct === 4, "the field as the file gives it");
  const by = (n) => r.sides.find((s) => s.side.name === n);
  assert(by("Right side wall").heading.startsWith("Right side wall · 70'7\" ±6% · "), by("Right side wall").heading);
  assert(by("Bay step").heading === "Bay step · 2' · 19 SF net", by("Bay step").heading);
  const first = by("Right side wall").dims[0];
  assert(first.includes("±6% (worked out from the photos: to check)") && first.includes("eave 9'6\" above the ground at the left, 15'11\" at the right") && first.endsWith("the ground falls 6'5\" from left to right, in steps"), first);
  assert(by("Left gable wall").dims[0].includes("the ground rises 1'6\" from left to right") && !by("Left gable wall").dims[0].includes("in steps"), by("Left gable wall").dims[0]);
  // The side door on its landing is at the bottom, not 4'4" up; a basement window over the lower walk 1'5" up.
  const dims = by("Right side wall").dims;
  assert(dims.some((d) => d.startsWith("Door 1: 3' × 6'8\", at the bottom")) && dims.some((d) => d.startsWith("Window 2: 4'6\" × 2'6\", sill 1'5\" up")), dims.join(" | "));
  // A level side's heights are as they were.
  assert(by("Keystone wall").dims[0] === "24'10\" long · eave 9'4\" at the left, 9'4\" at the right", by("Keystone wall").dims[0]);
  // A walk tapped on the phone still says so.
  const tapped = x.parseScanExterior(fixture("scan-exterior-v2-walk-1453.json")).exterior;
  const rt = x.exteriorReport(tapped, { title: "t", date: "d", madeWith: "m" });
  assert(rt.sources.includes("Walls, heights, materials and openings: tapped on the phone, side by side round the house."), rt.sources.join(" | "));
});

test("every wall's name beside its own wall: none over another or across the house, a line back to the wall where one has to stand off", () => {
  const fp = x.exteriorQuantities(owner).footprint;
  // Lettering as the report sets it: 8 points at 3/32" = 1'-0".
  const em = (8 / 6.75) * 0.85;
  const n = fp.corners.length;
  const walls = fp.sideIds.map((id, i) => {
    const a = fp.corners[i];
    const b = fp.corners[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { id, a, b, out: { x: (b.y - a.y) / len, y: -(b.x - a.x) / len }, name: owner.sides.find((s) => s.id === id).name, length: x.formatFeetInches(fp.lengthsFeet[i]), clear: em * 0.3 };
  });
  const names = x.placeWallNames(walls, em, { boxes: [], polygons: [fp.corners] });
  assert(names.length === walls.length && names.every((m, i) => m.id === walls[i].id), "one each, in the walls' order");
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) assert(!x.labelsOverlap(names[i].box, names[j].box), `${walls[i].name} over ${walls[j].name}`);
    assert(!x.boxOnPolygon(names[i].box, fp.corners), `${walls[i].name} across the house`);
    const off = x.boxToSegment(names[i].box, walls[i].a, walls[i].b);
    assert(names[i].leader !== null || off <= walls[i].clear + em * 1.2, `${walls[i].name}: ${off.toFixed(2)} ft off its wall with no line back`);
  }
  // Most sit right beside their walls: the 5'6" bump-out side's name is three times its wall, and still beside it.
  assert(names.filter((m) => m.leader !== null).length <= 4, names.filter((m) => m.leader).map((m) => m.id).join(", "));
  const step = names[walls.findIndex((w) => w.name === "Bump-out left side")];
  assert(step.leader === null, JSON.stringify(step));
});

test("each cladding drawn as it looks, every mark on its face: lap lines at their exposure, brick courses, stucco's dots, parging's hatch", () => {
  // A gable end 20' wide, 9' to the eave, 14' to the peak.
  const face = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 9 }, { x: 10, y: 14 }, { x: 0, y: 9 }];
  const onFace = (p) => p.x >= -1e-9 && p.x <= 20 + 1e-9 && p.y >= -1e-9 && p.y <= 9 + Math.max(0, 5 * (1 - Math.abs(p.x - 10) / 10)) + 1e-9;
  const allOn = (segs) => segs.every(([a, b]) => onFace(a) && onFace(b));
  // Vinyl at 4": a line every 4" up, cut to the gable's slopes.
  const vinyl = x.textureMarks(face, x.textureOf("vinyl"), 0.5);
  const ys = [...new Set(vinyl.lines.map(([a]) => Math.round(a.y * 1e6) / 1e6))];
  assert(ys.length === 41 && ys.every((y) => Math.abs(y * 3 - Math.round(y * 3)) < 1e-5), `${ys.length} lines: ${ys.slice(0, 4)}`);
  assert(allOn(vinyl.lines), "on the face");
  const top = vinyl.lines.find(([a]) => Math.abs(a.y - 41 / 3) < 1e-6);
  near(top[1].x - top[0].x, 20 * (1 - (41 / 3 - 9) / 5), "cut to the gable at 13'8\"", 1e-6);
  // Lettered large (a small scale): 4" is too fine, so every second course.
  const small = x.textureMarks(face, x.textureOf("vinyl"), 2);
  const sy = [...new Set(small.lines.map(([a]) => Math.round(a.y * 1e6) / 1e6))];
  near(sy[1] - sy[0], 2 / 3, "every second 4\" course", 1e-6);
  // Fibre cement at 7", wood at 6".
  near(x.textureOf("fibre_cement").exposureFeet, 7 / 12, "fibre cement", 1e-9);
  near(x.textureOf("wood").exposureFeet, 0.5, "wood", 1e-9);
  // Brick: courses and head joints, each joint within its course.
  const brick = x.textureMarks(face, x.textureOf("brick"), 0.3);
  assert(brick.lines.length > 100 && allOn(brick.lines), `${brick.lines.length} brick marks`);
  // Stucco: rows of dots, each run on the face; stone, shakes, battens, ribs, parging: marks on the face.
  const stucco = x.textureMarks(face, x.textureOf("stucco"), 1);
  assert(stucco.dots.length > 10 && stucco.dots.every((d) => onFace(d.a) && onFace(d.b) && /^0\.01 /.test(d.dash)), "stucco's dots");
  for (const k of ["stone", "wood_shake", "metal", "parging", "eifs"]) {
    const m = x.textureMarks(face, x.textureOf(k), 1);
    assert(m.lines.length + m.fine.length + m.dots.length > 0 && allOn([...m.lines, ...m.fine]), k);
  }
  // "Other" by its name.
  assert(x.textureOf("other", "Board and batten").texture === "battens" && x.textureOf("other", "cedar shingles").texture === "shake" && x.textureOf("other", "Hardie plank").exposureFeet === 7 / 12 && x.textureOf("other", "glass block").texture === "plain", "by name");
  // A line through a corner of a diamond is inside once, from edge to edge.
  const diamond = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  const cut = x.clipSegment(diamond, { x: -2, y: 0 }, { x: 2, y: 0 });
  assert(cut.length === 1 && Math.abs(cut[0][0].x + 1) < 1e-9 && Math.abs(cut[0][1].x - 1) < 1e-9, JSON.stringify(cut));
});

test("the house from each side: a 40' x 30' gable at 6/12 - front and back square-on under their slopes, the gable ends under the roof's profile", () => {
  const m = x.exteriorModel(rect(40, 30, { pitch: 6 }));
  assert(m.ok, m.reason);
  const views = Object.fromEntries(x.VIEWS.map((c) => [c, x.houseView(m.model, c)]));
  // Each view shows its own side: the front, the right side, the back, the left side.
  assert(JSON.stringify(x.VIEWS.map((c) => views[c].sides.map((s) => s.name))) === JSON.stringify([["Front"], ["Right"], ["Rear"], ["Left"]]), JSON.stringify(x.VIEWS.map((c) => views[c].sides)));
  near(views.front.maxX - views.front.minX, 40, "the front's width", 1e-6);
  near(views.right.maxX - views.right.minX, 30, "the right gable's width", 1e-6);
  // The front: its one slope facing it, and the fascia along its eave. A gable end: both slopes edge-on, drawn as the roof's profile.
  const kinds = (v) => v.pieces.filter((p) => p.type === "roof").map((p) => p.kind);
  assert(kinds(views.front).filter((k) => k === "slope").length === 1 && kinds(views.front).includes("fascia"), kinds(views.front).join());
  assert(!kinds(views.right).includes("slope") && kinds(views.right).filter((k) => k === "edge").length === 2, kinds(views.right).join());
  // Heights from the ground: the eave 10'; the roof's top 15' of run at 6/12 over it, and the roof's 6" thickness: 18'.
  for (const c of x.VIEWS) {
    near(views[c].groundY, 0, `${c}: the ground`, 1e-6);
    near(views[c].topY, 18, `${c}: the roof's top`, 1e-6);
  }
  assert(JSON.stringify(views.front.levels.map((l) => [l.label, Math.round(l.y * 1e6) / 1e6])) === JSON.stringify([["Eave", 10], ["Top of roof", 18]]), JSON.stringify(views.front.levels));
  // The gable end's wall up to the roof's underside at the ridge: 17'6".
  const gable = views.right.pieces.find((p) => p.type === "wall");
  near(Math.max(...gable.outline.map((p) => p.y)), 17.5, "the gable's peak", 1e-6);
  // Drawn back to front.
  for (const c of x.VIEWS) for (let i = 1; i < views[c].pieces.length; i++) assert(views[c].pieces[i].depth <= views[c].pieces[i - 1].depth + 1e-9, `${c}: piece ${i} out of order`);
  // No bearing, no compass (2026-10-20): the front, the right side, the back and the left side - never a guess that the front is south.
  assert(JSON.stringify(x.VIEWS.map((c) => views[c].title)) === JSON.stringify(["Front elevation", "Right side elevation", "Back elevation", "Left side elevation"]), JSON.stringify(x.VIEWS.map((c) => views[c].title)));
  const r = x.exteriorReport(rect(40, 30, { pitch: 6 }), { title: "t", date: "d", madeWith: "m" });
  assert(JSON.stringify(r.views.map((v) => v.heading)) === JSON.stringify(["Front elevation", "Right side elevation", "Back elevation", "Left side elevation"]), JSON.stringify(r.views.map((v) => v.heading)));
});

test("which way the front faces names the four views: 16 gives North for the front, 100 East, 200 South; halfway, the one clockwise", () => {
  const e = rect(40, 30, { pitch: 6 });
  const m = x.exteriorModel(e).model;
  const titles = (deg) => x.VIEWS.map((c) => x.houseView(m, c, deg).title.replace(" elevation", ""));
  assert(titles(16).join() === "North,West,South,East", titles(16).join());
  assert(titles(100).join() === "East,North,West,South", titles(100).join());
  assert(titles(200).join() === "South,East,North,West", titles(200).join());
  assert(titles(180).join() === "South,East,North,West", "a front facing south: east to its right, as before");
  assert(titles(45).join() === "East,North,West,South" && titles(315).join() === "North,West,South,East", `${titles(45)} / ${titles(315)}`);
  // Only the names: the views are the same drawing, square to the house, whichever way it faces.
  const strip = (v) => JSON.stringify({ ...v, title: undefined });
  for (const c of x.VIEWS) assert(strip(x.houseView(m, c, 16)) === strip(x.houseView(m, c)) && strip(x.houseView(m, c, 100)) === strip(x.houseView(m, c)), `${c}: drawn the same`);
  // The report: its name, then where it is on the house.
  const r = x.exteriorReport({ ...e, frontFacesDeg: 100 }, { title: "t", date: "d", madeWith: "m" });
  assert(JSON.stringify(r.views.map((v) => v.heading)) === JSON.stringify(["East elevation · the front", "North elevation · to the right of the front", "West elevation · the back", "South elevation · to the left of the front"]), JSON.stringify(r.views.map((v) => v.heading)));
  // Every number the same as with none: the bearing names, it measures nothing.
  const q = (ex) => JSON.stringify(x.exteriorQuantities(ex));
  assert(q({ ...e, frontFacesDeg: 100 }) === q(e), "the quantities");
  assert(JSON.stringify(x.exteriorScopeLines({ ...e, frontFacesDeg: 100 })) === JSON.stringify(x.exteriorScopeLines(e)), "the scope lines");
  // The compass of any wall on the plan, and north on it, for a front facing 16: the front faces 16, its right 286, the back 196.
  near(x.planFacesDeg({ x: 0, y: -1 }, 16), 16, "the front", 1e-9);
  near(x.planFacesDeg({ x: 1, y: 0 }, 16), 286, "the right side", 1e-9);
  near(x.planFacesDeg({ x: 0, y: 1 }, 16), 196, "the back", 1e-9);
  near(x.planFacesDeg(x.northOnPlan(16), 16), 0, "north on the plan faces north", 1e-9);
  near(x.planFacesDeg(x.northOnPlan(100), 100), 0, "and for 100", 1e-9);
  // In words, for the report's Elevations page.
  const words = [16, 100, 200, 340, 45, 0].map(x.bearingWords);
  assert(JSON.stringify(words) === JSON.stringify(["16° east of north", "10° south of east", "20° west of south", "20° west of north", "northeast", "north"]), words.join(" | "));
  // Not set, or not a number: none; any number of turns, 0 up to 360.
  assert(x.frontFacesOf({}) === undefined && x.frontFacesOf({ frontFacesDeg: Number.NaN }) === undefined && x.frontFacesOf({ frontFacesDeg: -90 }) === 270 && x.frontFacesOf({ frontFacesDeg: 376 }) === 16, "absent is unknown");
});

test("a capture's front_faces_deg comes in as the exterior's frontFacesDeg; none, none", () => {
  const raw = fixture("scan-exterior-v2-sample.json");
  assert(x.parseScanExterior(raw).exterior.frontFacesDeg === undefined, "none");
  assert(x.parseScanExterior({ ...raw, front_faces_deg: 376 }).exterior.frontFacesDeg === 16, "turned into 0-360");
  assert(x.parseScanExterior({ ...raw, front_faces_deg: "north" }).exterior.frontFacesDeg === undefined, "a word is not a bearing");
});

test("the owner's house from each side: the front's three walls, the side yard's steps; his front faces north, so the side yard is the West", () => {
  const m = x.exteriorModel(owner);
  assert(m.ok, m.reason);
  assert(owner.frontFacesDeg === 16, "his front faces 16 degrees east of north (fitted to the open building footprint, 10-19)");
  const view = (c) => x.houseView(m.model, c, owner.frontFacesDeg);
  const front = view("front");
  assert(front.title === "North elevation" && JSON.stringify(front.sides.map((s) => s.name)) === JSON.stringify(["Front wall behind the porch", "Garage front, left bay", "Garage front, right bay"]), JSON.stringify([front.title, front.sides]));
  // The long side-yard wall, on the right as you face the front: the West elevation.
  const side = view("right");
  assert(side.title === "West elevation" && side.sides.map((s) => s.name).join() === "Right side wall", JSON.stringify([side.title, side.sides]));
  near(side.maxX - side.minX, sideNamed(owner, "Right side wall").lengthFeet, "the side-yard wall's whole length", 1e-6);
  // Its ground, front on the left, steps three times by the side door: three 7" risers.
  const risers = side.ground.filter((p, i) => i > 0 && p.x - side.ground[i - 1].x < 1e-3 && side.ground[i - 1].y - p.y > 0.4);
  assert(risers.length === 3, JSON.stringify(side.ground.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100])));
  for (const c of ["back", "left"]) assert(view(c).sides.length >= 3, `${c}: ${JSON.stringify(view(c).sides)}`);
  // The back the South; the porch's side, on the left, the East - the front wall behind the porch seen end-on from it.
  assert(view("back").title === "South elevation" && view("left").title === "East elevation", `${view("back").title} / ${view("left").title}`);
  assert(view("left").sides.some((s) => s.name === "Left gable wall"), JSON.stringify(view("left").sides));
  // The report gives them first, by compass point, each saying what it shows: the front is the North elevation.
  const r = x.exteriorReport(owner, { title: "t", date: "d", madeWith: "m" });
  assert(JSON.stringify(r.views.map((v) => v.heading)) === JSON.stringify(["North elevation · the front", "West elevation · to the right of the front", "South elevation · the back", "East elevation · to the left of the front"]), JSON.stringify(r.views.map((v) => v.heading)));
  assert(r.views[1].shows === "Shows Right side wall.", r.views[1].shows);
  // No name of his says a compass point, so none can contradict the compass.
  assert(owner.sides.every((s) => !/(north|south|east|west)/i.test(s.name)), owner.sides.map((s) => s.name).join(" | "));
  // No footprint, no views: the sides alone.
  const open = x.exteriorReport(exterior([ownersSide()]), { title: "t", date: "d", madeWith: "m" });
  assert(open.views.length === 0, "no views without a footprint");
});

test("the report: the roof's parts as proposed are assumed until checked - the deck under the roof, the garage lower under a gable; once it looks right, not", () => {
  const e = photoRouteHouse();
  const r = x.exteriorReport(e, { title: "t", date: "d", madeWith: "m" });
  const line = r.assumed.find((a) => a.startsWith("The roof's parts as proposed"));
  // Since 10-16 the garage is his to set lower (no corner where his walls meet measures it): the deck alone is proposed.
  assert(
    line === "The roof's parts as proposed off the outline and the photos, not yet checked: the corner at Covered-deck side and Covered-deck back wall under the roof. Check them on the roof plan.",
    line ?? r.assumed.join(" | "),
  );
  // Pressed "Looks right": answered, so not assumed.
  const checked = x.exteriorReport(ownersTaps(e), { title: "t", date: "d", madeWith: "m" });
  assert(!checked.assumed.some((a) => a.startsWith("The roof's parts as proposed")), checked.assumed.join(" | "));
  // The deck answered on the check and the garage set lower: nothing left proposed, the garage's drop said to be assumed.
  const plan = roofOf(e).roof;
  const deck = plan.notches.find((k) => k.covered);
  const half = { ...e, roof: x.withWingAnswer(x.withNotchAnswer(e.roof, plan, deck, "covered"), plan, sideStarting(e, "Garage front, left").id, "gable") };
  const said = x.exteriorReport(half, { title: "t", date: "d", madeWith: "m" }).assumed;
  assert(!said.some((a) => a.startsWith("The roof's parts as proposed")) && said.some((a) => a.startsWith("The roof out to Garage front, left bay sits 1'6\" under")), said.join(" | "));
  // A house drawn by hand proposes nothing.
  assert(!x.exteriorReport(rect(40, 30, { pitch: 6 }), { title: "t", date: "d", madeWith: "m" }).assumed.some((a) => a.startsWith("The roof's parts")), "nothing proposed");
});

test("the report of a house measured on the photo route: sizes from the photos, scaled by the tapes, each named", () => {
  // The owner's house as the photo route lands one (lib/photoRouteExterior.ts): source "photos", the route's tapes and its measure kept.
  const base = x.parseScanExterior(fixture("photos-only-1016.json")).exterior;
  const ids = base.sides.map((s) => s.id);
  const e = {
    ...base,
    scale: undefined,
    source: { kind: "photos", by: "photos", captureId: null, scanId: null, receivedAt: "2026-10-16T22:00:00.000Z", notes: ["Measured from 9 of 18 photos and 4 tapes."], walkClosed: true },
    photoRoute: {
      format: "scrivn-photo-route/1",
      photos: Array.from({ length: 18 }, (_, i) => ({ id: `p${i}` })),
      buildings: [
        {
          id: "main",
          outline: [],
          corners: [],
          tapes: [
            { id: "t1", kind: "line", photo: "p0", a: [0, 0], b: [1, 0], feet: 9, what: "garage" },
            { id: "t2", kind: "line", photo: "p1", a: [0, 0], b: [1, 0], feet: 9, what: "garage" },
            { id: "t3", kind: "side", from: 10, feet: ft(21, 11) },
            { id: "t4", kind: "side", from: 4, feet: ft(22, 2) },
          ],
        },
      ],
      measured: { cameras: Array.from({ length: 9 }, (_, i) => ({ photo: `p${i}` })), sideIds: ids },
    },
  };
  const r = x.exteriorReport(e, { title: "t", date: "d", madeWith: "m" });
  assert(r.sources[0] === "Sizes: from the photos (9 of 18 used), scaled by 4 tapes: a garage door 9', a garage door 9', the Front wall behind the porch 21'11\" and the Rear bump-out gable 22'2\".", r.sources[0]);
  assert(r.sources[1] === "Walls, heights, materials and openings: read off the photos, side by side round the house; nothing was tapped on the walls.", r.sources[1]);
  assert(r.facts.find((f) => f.label === "Sizes from")?.value === "the photos and 4 tapes", JSON.stringify(r.facts));
  // A scanned exterior's sizes are as they were: the photo route's words are only for its own.
  assert(!x.exteriorReport(base, { title: "t", date: "d", madeWith: "m" }).sources[0].includes("scaled by"), "the scan's own words");
});

console.log('\n"check these" after Measure (10-16)');

const reportOf = (e) => x.exteriorReport(e, { title: "t", date: "d", madeWith: "m" });

/**
 * His house as the trace reads it since 10-16: the back wall's tall glass unit a window, its foot hidden by the deck
 * railing (the owner: "Its a window not a door"); and the garage set lower on the roof check, one tap, nothing measuring
 * how much lower - so drawn at the assumed 1'6".
 */
function checkHouse() {
  const e = photoRouteHouse();
  const rear = sideStarting(e, "Rear wall");
  const sides = e.sides.map((s) => (s.id !== rear.id ? s : { ...s, openings: s.openings.map((o) => ({ ...o, hiddenBy: "deck railing" })) }));
  return { ...e, sides, roof: x.withWingAnswer(e.roof, roofOf(e).roof, sideStarting(e, "Garage front, left").id, "gable") };
}
const WINDOW_LINE = `Rear wall: a window 5'11" × 7'2", read off a photo that hid part of it (deck railing). Check it is a window.`;
const DROP_LINE = `The garage's eave is drawn 1'6" under the house's: assumed, as nothing measured it. Measure how much lower it is.`;

test("his house: two rows - the back wall's window behind the railing, and the garage's assumed drop - and the report names both", () => {
  const e = checkHouse();
  const rows = x.exteriorChecks(e, roofOf(e));
  assert(rows.length === 2, rows.map((r) => r.title).join(" | "));
  const [win, drop] = rows;
  assert(win.kind === "opening" && win.why === "hidden" && win.sideId === sideStarting(e, "Rear wall").id && win.openingKind === "window", JSON.stringify(win));
  assert(win.title === `Rear wall: window 5'11" × 7'2"` && win.words === "Part of it is hidden in the photo (deck railing).", `${win.title} / ${win.words}`);
  assert(drop.kind === "drop" && drop.garage && drop.sideId === sideStarting(e, "Garage front, left").id && drop.feet === 1.5, JSON.stringify(drop));
  assert(drop.question === "How much lower is the garage's eave than the house's?", drop.question);
  // Not asked: the side door, 4'4" over the level but at the top of the side yard's steps (on the ground there); the deck door
  // 7'6" up, the deck under the roof at its foot. Said open, the deck's door is asked: 7'6" up with nothing under it.
  const plan = roofOf(e).roof;
  const open = { ...e, roof: x.withNotchAnswer(e.roof, plan, plan.notches.find((k) => k.covered), "open") };
  const asked = x.exteriorChecks(open, roofOf(open)).filter((r) => r.why === "off_ground");
  assert(asked.length === 1 && asked[0].sideId === sideStarting(e, "Covered-deck back").id && /^7'6" up off the ground, with no step or deck seen at its foot\.$/.test(asked[0].words), JSON.stringify(asked));
  // The report's "To check" names the two, after the sides to tape.
  const notes = reportOf(e).notes;
  assert(notes.includes(WINDOW_LINE) && notes.includes(DROP_LINE), notes.join(" | "));
  assert(notes.indexOf(WINDOW_LINE) > notes.findIndex((n) => /Tape it to be sure/.test(n)), "after the sides to tape");
});

test("answered - Window, and 2' lower - it lands in the exterior, its 3D and the report; Door changes it", () => {
  const e = checkHouse();
  const [win, drop] = x.exteriorChecks(e, roofOf(e));
  const answered = x.withCheckDrop(x.withOpeningKind(e, win.sideId, win.openingId, "window"), drop.sideId, 2);
  const o = answered.sides.find((s) => s.id === win.sideId).openings.find((p) => p.id === win.openingId);
  assert(o.kind === "window" && o.confirmed === true && o.hiddenBy === "deck railing", JSON.stringify(o));
  // The drop through the roof check's own writer: typed, as the roof check would have it.
  const q = roofOf(answered);
  assert(answered.roof.wingDrops[drop.sideId] === 2 && q.wingDrops[drop.sideId].source === "typed" && q.wingDrops[drop.sideId].feet === 2, JSON.stringify(q.wingDrops));
  const m = x.exteriorModel(answered).model;
  near(m.eaves[0] - m.eaves[1], 2, "the garage's eave 2' under the house's in 3D", 1e-9);
  assert(x.exteriorChecks(answered, q).length === 0, "nothing left to check");
  const notes = reportOf(answered).notes;
  assert(!notes.includes(WINDOW_LINE) && !notes.some((n) => /garage's eave is drawn/.test(n)), notes.join(" | "));
  // Door: the kind as tapped.
  const door = x.withOpeningKind(e, win.sideId, win.openingId, "door").sides.find((s) => s.id === win.sideId).openings[0];
  assert(door.kind === "door" && door.confirmed, JSON.stringify(door));
  // Cleared, the drop goes back to the assumed 1'6" and is asked again.
  const cleared = x.withCheckDrop(answered, drop.sideId, null);
  assert(x.exteriorChecks(cleared, roofOf(cleared)).map((r) => r.kind).join() === "drop", "the drop asked again");
});

test("Looks right closes the list; what was not answered stays as read, and on the report's To check", () => {
  const e = { ...checkHouse(), photoRoute: { format: "scrivn-photo-route/1", photos: [], buildings: [] } };
  const shown = x.openChecks(e, roofOf(e));
  assert(shown.length === 2, "two to start");
  const closed = x.withChecksClosed(e, shown.map((r) => r.key));
  assert(x.openChecks(closed, roofOf(closed)).length === 0 && x.exteriorChecks(closed, roofOf(closed)).length === 2, "closed, still there to check");
  const o = closed.sides.find((s) => s.id === shown[0].sideId).openings[0];
  assert(o.kind === "window" && !o.confirmed && roofOf(closed).wingDrops[shown[1].sideId].source === "assumed", "as read");
  const notes = reportOf(closed).notes;
  assert(notes.includes(WINDOW_LINE) && notes.includes(DROP_LINE), notes.join(" | "));
  // Changing its kind on the side is saying what it is too (ExteriorSide.tsx sets `confirmed`): no longer asked.
  const said = { ...e, sides: e.sides.map((s) => (s.id !== shown[0].sideId ? s : { ...s, openings: s.openings.map((p) => ({ ...p, confirmed: true })) })) };
  assert(x.exteriorChecks(said, roofOf(said)).map((r) => r.kind).join() === "drop", "the window said");
});

test("a house with nothing hidden asks nothing: his, nothing set lower; a scanned house's tapped openings", () => {
  const e = photoRouteHouse();
  assert(x.exteriorChecks(e, roofOf(e)).length === 0, x.exteriorChecks(e, roofOf(e)).map((r) => r.title).join(" | "));
  assert(!reportOf(e).notes.some((n) => /Check it is a|Measure how much lower/.test(n)), reportOf(e).notes.join(" | "));
  // Scanned: a door tapped on the phone is no guess, wherever it is.
  const scan = x.parseScanExterior(fixture("scan-exterior-v2-sample.json")).exterior;
  assert(x.exteriorChecks(scan, x.exteriorQuantities(scan)).length === 0, "nothing on a scan");
});

test("the trace's 'partly hidden by' rides onto the opening, from the editor and from Finish; a door needs proof in the photo", () => {
  const side = x.parseScanExterior(fixture("scan-exterior-v2-photos.json"), { scanId: "s" }).exterior.sides[0];
  const hidden = { ...wire, openings: wire.openings.map((o, i) => (i === 2 ? { ...o, kind: "window", partly_hidden_by: "deck railing" } : o)) };
  const p = x.traceProposals(hidden, traceFrame, side.lengthFeet);
  const s = x.applyTrace(side, p, { shapes: [], openings: p.openings.map((o) => ({ key: o.key, kind: o.kind })), wallTop: false });
  assert(s.openings[2].hiddenBy === "deck railing" && !("hiddenBy" in s.openings[0]) && !("hiddenBy" in s.openings[1]), JSON.stringify(s.openings));
  const w = x.wallsFrom(p);
  assert(w.openings[2].hiddenBy === "deck railing" && !("hiddenBy" in w.openings[0]), JSON.stringify(w.openings));
  const msg = x.traceUserMessage(traceFrame, { name: "Rear", lengthM: 8, bottomLeftM: 0.5, bottomRightM: 0.5, leftEndInPhoto: true, rightEndInPhoto: true });
  assert(/only when the photo shows what makes it one: a handle, hinges, a threshold, or a step, deck, path or driveway meeting its foot\./.test(msg), "a door's proof");
  assert(/Tall glass whose foot is hidden - by a railing, a deck, plants, a car - is a window\. Say what hides any part of an opening/.test(msg), "a hidden foot is a window, and said");
});

console.log("\nattached homes: semi-detached and townhouses (10-17)");

/**
 * The owner, 10-17: "One tester at least will have a townhouse. Semi detached. We will need to be able to handle
 * different types of homes as well". A wall shared with the neighbour's home (`ExteriorSide.shared`) counts nothing
 * and the roof is cut by the party line over it. Three homes typed in, 18' to the eave (two storeys as tall walls),
 * 6/12, the default 1'4" eaves and 1' rakes, 8" of parging: each worked by hand. 6/12 is 1.118034 a foot of run.
 */
const K6 = Math.sqrt(1 + 0.25);
function attached(width, depth, ridgeAlong, shared, homeType) {
  const e = rect(width, depth, { pitch: 6, ridgeAlong }, 18);
  e.sides = e.sides.map((s) => (shared.includes(s.id) ? { ...s, shared: true } : s));
  e.homeType = homeType;
  e.scope = { roofing: true, sides: e.sides.map((s) => s.id), soffitFascia: true, eavestrough: true };
  return e;
}
const edgesOn = (plan, sideId) => plan.edges.filter((ed) => ed.sideId === sideId);
const said = (e) => x.exteriorReport(e, { title: "t", date: "d", madeWith: "m" });

test("semi-detached, 24' x 40', the ridge front to back, the Left wall shared: no eave or overhang there, a party line, its walls not counted", () => {
  const e = attached(24, 40, "left", ["left"], "semi");
  const q = roofOf(e);
  const r = q.roofing;
  const plan = q.roof;
  // Walls: the Front and Rear 24' x 17'4" (18' less 8" of parging) and their 72 SF gables (24' across, 6' up), the Right 40' x 17'4"; the Left nothing.
  const left = q.sides.find((s) => s.sideId === "left");
  assert(left.grossSquareFeet === 0 && left.netSquareFeet === 0 && left.bands.length === 0, JSON.stringify(left));
  near(q.totals.grossSquareFeet, 2 * (24 * ft(17, 4) + 72) + 40 * ft(17, 4), "walls: three sides");
  // Corners: only the two at the Right; the Left's are no corners of the outside.
  near(q.totals.outsideCornerFeet, 2 * ft(17, 4), "two outside corners");
  // The roof: 25'4" across (no overhang at the party wall) by 42' (1' rakes), at 6/12.
  near(plan.planSquareFeet, (24 + ft(1, 4)) * 42, "plan");
  near(r.squares, ((24 + ft(1, 4)) * 42 * K6) / 100, "squares");
  near(r.ridgeFeet, 42, "the ridge, rake to rake");
  near(r.eaveFeet, 42, "the Right's eave alone");
  // Each gable end: 12' of run from the party line up to the ridge, 13'4" down to the Right's drip line.
  near(r.rakeFeet, 2 * (12 + ft(13, 4)) * K6, "rakes");
  near(r.partyFeet, 42, "the party line: level, at the Left wall, rake to rake");
  near(r.hipFeet + r.valleyFeet, 0, "no hips or valleys");
  assert(edgesOn(plan, "left").every((ed) => ed.kind === "party") && edgesOn(plan, "left").length === 1, JSON.stringify(edgesOn(plan, "left")));
  assert(plan.ends.map((en) => en.sideId).sort().join() === "front,rear", "the ends front and back, none at the party wall");
  // Eavestrough, soffit and fascia: the Right's eave and the rakes - nothing at the party line.
  near(r.dripEdgeFeet, r.eaveFeet + r.rakeFeet, "drip edge: eaves + rakes, no party line");
  // The report: what the home is, the Left's line, the firewall to check.
  const rep = said(e);
  assert(rep.facts[0].label === "Home" && rep.facts[0].value === "Semi-detached: the Left wall is shared with the neighbour and not counted.", JSON.stringify(rep.facts[0]));
  const leftSide = rep.sides.find((s) => s.side.id === "left");
  assert(leftSide.shared && leftSide.heading === "Left · 40' · shared wall" && leftSide.dims.join() === "Shared with the neighbour – not counted.", JSON.stringify(leftSide.dims));
  assert(rep.notes[0] === "Check the firewall cap and flashing at the party line.", rep.notes.join(" | "));
  assert(rep.facts.find((f) => f.label === "Roof lines").value === "Ridge 42' · Eave 42' · Rake 56'8\" · Party line 42'", rep.facts.find((f) => f.label === "Roof lines").value);
  assert(rep.tables.find((t) => t.caption === "Roof lines").rows.some((row) => row[0] === "Party line" && row[1] === "42.0"), "the lines table");
  // Scope: the stucco of three sides, nothing of the Left's.
  const lines = x.exteriorScopeLines(e).siding;
  assert(lines[0] === `Remove & replace stucco – Front, Right, Rear – ${q.totals.netSquareFeet.toFixed(1)} SF`, lines[0]);
});

test("an end townhouse, 20' x 36', the ridge along the street running across the shared Left wall: it stops at the party line", () => {
  const e = attached(20, 36, "front", ["left"], "town_end");
  const q = roofOf(e);
  const r = q.roofing;
  // 21' along (a 1' rake at the Right only) by 38'8" (16" eaves front and back).
  near(q.roof.planSquareFeet, 21 * (36 + ft(2, 8)), "plan");
  near(r.squares, (21 * (36 + ft(2, 8)) * K6) / 100, "squares");
  near(r.ridgeFeet, 21, "the ridge, from the party line to the Right's rake");
  // Each slope 19'4" of run from the drip line to the ridge: the Right's gable two rakes of it, the party line two more.
  near(r.rakeFeet, 2 * ft(19, 4) * K6, "the Right's rakes alone");
  near(r.partyFeet, 2 * ft(19, 4) * K6, "the party line, up and over the roof at the Left wall");
  near(r.eaveFeet, 2 * 21, "eaves front and back");
  assert(q.roof.ends.map((en) => en.sideId).join() === "right", JSON.stringify(q.roof.ends));
  assert(edgesOn(q.roof, "left").every((ed) => ed.kind === "party"), "no rake at the Left");
  // Walls: no Left; the Right with its gable (36' across, 9' up: 162 SF).
  near(q.totals.grossSquareFeet, 2 * 20 * ft(17, 4) + 36 * ft(17, 4) + 162, "walls");
  assert(said(e).facts[0].value === "Townhouse, end unit: the Left wall is shared with the neighbour and not counted.", said(e).facts[0].value);
});

test("a middle townhouse, 18' x 36', both side walls shared: no rakes, a party line each side, front and back walls alone", () => {
  const e = attached(18, 36, "front", ["left", "right"], "town_middle");
  const q = roofOf(e);
  const r = q.roofing;
  near(q.roof.planSquareFeet, 18 * (36 + ft(2, 8)), "plan: no overhang either side");
  near(r.squares, (18 * (36 + ft(2, 8)) * K6) / 100, "squares");
  near(r.ridgeFeet, 18, "the ridge, party line to party line");
  near(r.rakeFeet, 0, "no rakes");
  near(r.partyFeet, 4 * ft(19, 4) * K6, "a party line up and over each side");
  near(r.eaveFeet, 36, "eaves front and back");
  assert(q.roof.ends.length === 0, "no end of the roof is this home's");
  near(q.totals.grossSquareFeet, 2 * 18 * ft(17, 4), "the front and the back");
  near(q.totals.outsideCornerFeet + q.totals.insideCornerFeet, 0, "no corner of the outside");
  assert(said(e).facts[0].value === "Townhouse, middle unit: the Left wall and the Right wall are shared with the neighbours and not counted." || said(e).facts[0].value === "Townhouse, middle unit: the Right wall and the Left wall are shared with the neighbours and not counted.", said(e).facts[0].value);
  // Soffit, fascia and eavestrough: the eaves alone.
  assert(!x.exteriorScopeLines(e).siding.some((l) => /rakes$/.test(l) && /soffit/.test(l)), "no rake soffit");
});

test("attached homes in 3D and on the elevations: the party wall bare, the cut a clean edge marked for the neighbour's home", () => {
  const e = attached(24, 40, "left", ["left"], "semi");
  const m = x.exteriorModel(e).model;
  const wall = m.walls.find((w) => w.sideId === "left");
  assert(wall.shared && wall.faces.length === 0 && wall.openings.length === 0, "bare");
  // From the front the Left wall is edge-on: the cut, the neighbour's home to the left.
  const south = x.houseView(m, "front");
  assert(south.party.length === 1 && south.party[0].side === -1 && Math.abs(south.party[0].x - south.minX) < 1e-6, JSON.stringify(south.party));
  // From the west it faces the viewer: drawn, marked shared.
  const west = x.houseView(m, "left");
  assert(west.pieces.some((p) => p.type === "wall" && p.shared), "the shared wall seen from the west");
  // A detached home: no cut, and no wall marked.
  const d = x.exteriorModel(attached(24, 40, "left", [], undefined)).model;
  assert(x.houseView(d, "front").party.length === 0 && d.walls.every((w) => !w.shared), "nothing for a detached home");
});

test("two storeys on a shared wall: the upper floor's side over it is shared with nothing more set, and the roof is cut the same", () => {
  // Drawn as a main floor 9' to its eave and an upper floor over the whole of it: the same 24' x 40' semi.
  const e = rect(24, 40, { pitch: 6, ridgeAlong: "left" }, 9);
  e.sides = e.sides.map((s) => (s.id === "left" ? { ...s, shared: true } : s));
  const fp = x.exteriorFootprint(e);
  e.upper = x.upperFromOutline(fp.corners, fp);
  const shared = x.sharedSideIds(e);
  const upperLeft = e.upper.sides.find((s) => s.name === "Upper left");
  assert(shared.has("left") && shared.has(upperLeft.id) && shared.size === 2, [...shared].join());
  const q = roofOf(e);
  near(q.roof.planSquareFeet, (24 + ft(1, 4)) * 42, "the roof over the upper floor, cut at the party line");
  near(q.roofing.partyFeet, 42, "the party line");
  assert(q.sides.find((s) => s.sideId === upperLeft.id).grossSquareFeet === 0, "the upper floor's shared side not counted");
  // Set back 6' from the front, the lower roof along the front is cut at the party line too.
  const back = rect(24, 40, { pitch: 6, ridgeAlong: "left" }, 9);
  back.sides = back.sides.map((s) => (s.id === "left" ? { ...s, shared: true } : s));
  const fp2 = x.exteriorFootprint(back);
  back.upper = x.upperFromOutline(fp2.corners.map((p) => ({ x: p.x, y: p.y < 1 ? p.y + 6 : p.y })), fp2);
  const b = roofOf(back);
  assert(b.roof.edges.filter((ed) => ed.kind === "party").length >= 2 && b.roof.edges.every((ed) => !(ed.sideId === "left" && (ed.kind === "eave" || ed.kind === "rake"))), JSON.stringify(b.roof.edges.map((ed) => [ed.kind, ed.sideId])));
  assert(x.sharedSideIds(back).size === 2, "the upper left, set back but on the same line, shared too");
});

test("a detached home's roof and quantities are as they were: no party line, nothing marked", () => {
  const e = rect(40, 30, { pitch: 6 });
  const q = roofOf(e);
  assert(q.roof.lines.every((l) => l.kind !== "party") && q.roofing.partyFeet === 0 && q.roof.totals.party === 0, "no party line");
  assert(x.homeTypeWords(e) === null && x.sharedOf(e) === undefined, "no words, nothing to draw");
  assert(!x.checkNotes(e, q).some((n) => /party line/.test(n)), "nothing to check");
});

/**
 * An attached home's ridge, with none picked and none off the photos (2026-10-17): across its shared walls. A deep
 * middle townhouse came off the photo route with its ridge front to back, the longer walls' way, and 37.9' of rakes
 * over its front and back that no row of townhouses has.
 */
test("an attached home's ridge, nothing picked: across its shared walls - no rakes on a middle townhouse deeper than wide", () => {
  const e = attached(18, 30, null, ["left", "right"], "town_middle");
  assert(x.ridgeAcrossParty(e) === "front" && x.resolvedRidgeAlong(e) === "front", `${x.ridgeAcrossParty(e)}`);
  const r = roofOf(e).roofing;
  near(r.ridgeFeet, 18, "the ridge, party line to party line");
  near(r.rakeFeet, 0, "no rakes");
  near(r.eaveFeet, 36, "eaves front and back");
  // Each slope 15' of run and the 1'4" eave: a party line up and over each side.
  near(r.partyFeet, 4 * ft(16, 4) * K6, "the party lines");
  near(r.squares, (18 * (30 + ft(2, 8)) * K6) / 100, "squares");
  // Picked on the plan, the ridge front to back stands: gables over the front and back, 9' of run each rake.
  const picked = { ...e, roof: { ...e.roof, ridgeAlong: "left" } };
  assert(x.resolvedRidgeAlong(picked) === "left", "picked");
  near(roofOf(picked).roofing.rakeFeet, 4 * 9 * K6, "rakes over the front and back, as picked");
});

test("a semi with nothing picked runs its ridge across the party wall, to a gable over its own end; a gable in the front's photo turns it", () => {
  const e = attached(24, 40, null, ["left"], "semi");
  assert(x.ridgeAcrossParty(e) === "front", `${x.ridgeAcrossParty(e)}`);
  const q = roofOf(e);
  near(q.roofing.ridgeFeet, 25, "the ridge, from the party line to the Right's 1' rake");
  assert(q.roof.ends.map((en) => en.sideId).join() === "right", JSON.stringify(q.roof.ends));
  near(q.roofing.partyFeet, 2 * ft(21, 4) * K6, "the party line, up and over");
  near(q.roofing.rakeFeet, 2 * ft(21, 4) * K6, "the Right's rakes");
  // The Front's photo shows a gable: the ridge turns front to back, the photos' way.
  const g = { ...e, sides: e.sides.map((s) => (s.id === "front" ? { ...s, roofRead: photoRead(6) } : s)) };
  assert(x.ridgeFromPhotos(g)?.ridgeAlong === "right", JSON.stringify(x.ridgeFromPhotos(g)));
  assert(roofOf(g).roof.ends.map((en) => en.sideId).sort().join() === "front,rear", JSON.stringify(roofOf(g).roof.ends));
});

test("two storeys on a shared wall, nothing picked: the house's roof over the upper floor runs across the party wall", () => {
  const e = rect(20, 36, { pitch: 6 }, 9);
  e.sides = e.sides.map((s) => (s.id === "left" ? { ...s, shared: true } : s));
  const fp = x.exteriorFootprint(e);
  e.upper = x.upperFromOutline(fp.corners, fp);
  const along = e.upper.sides.find((s) => s.id === x.ridgeAcrossParty(e));
  assert(along && along.name === "Upper front", along?.name);
  const r = roofOf(e).roofing;
  near(r.ridgeFeet, 21, "the ridge, the party line to the Right's rake");
  near(r.partyFeet, 2 * ft(19, 4) * K6, "the party line");
  // A detached home's ridge is the outline's to say, as ever.
  assert(x.ridgeAcrossParty(rect(40, 30)) === null && x.resolvedRidgeAlong(rect(40, 30)) === null, "detached");
});

console.log("\nwhat to take next on the photo route (10-17)");

/**
 * A clean four-sided house, 40' by 30', photographed as the checklist asks: each corner at 45 degrees from 45' out on
 * its bisector, each wall straight on from 50' out, the owner's lens (f/W 0.664, so 37 degrees either side).
 */
const RECT = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }];
const HALF = Math.atan(0.5 / 0.664);
const lookAt = (photo, from, to) => {
  const d = [to.x - from[0], to.y - from[1]];
  const L = Math.hypot(d[0], d[1]);
  return { photo, at: from, forward: [d[0] / L, d[1] / L], halfFov: HALF };
};
const cornerShots = RECT.map((P, k) => {
  const out = [P.x === 0 ? -1 : 1, P.y === 0 ? -1 : 1];
  return lookAt(`corner${k}`, [P.x + (45 * out[0]) / Math.SQRT2, P.y + (45 * out[1]) / Math.SQRT2], P);
});
const wallShots = RECT.map((A, i) => {
  const B = RECT[(i + 1) % 4];
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  const nrm = [(B.y - A.y) / L, -(B.x - A.x) / L];
  return lookAt(`wall${i}`, [mid.x + 50 * nrm[0], mid.y + 50 * nrm[1]], mid);
});

test("a clean four-sided house photographed to the checklist: no warnings", () => {
  const cov = x.routeCoverage({ ring: RECT, views: [...cornerShots, ...wallShots], taps: [], shots: [], measured: true });
  assert(cov.items.length === 0, cov.items.map((i) => i.words).join(" | "));
  assert(cov.corners.every((c) => c.photos.length >= 3 && c.at45), JSON.stringify(cov.corners));
  assert(cov.walls.every((w) => w.both.length >= 2 && w.straight), JSON.stringify(cov.walls));
});

test("before a measure the list is the photos to take, ticked off as they're taken from it", () => {
  const none = x.routeCoverage({ ring: RECT, views: [], taps: [], shots: [], measured: false });
  // Four corners at 45, four walls straight on, and (2026-10-20) the one tape front to back.
  assert(none.items.length === 9 && none.items.filter((i) => i.kind === "corner-45").length === 4 && none.items.filter((i) => i.kind === "wall-straight").length === 4, none.items.map((i) => i.words).join(" | "));
  assert(none.items[0].words === "Corner 1 (front left): stand at the front left, at 45° to its two walls, both walls in frame.", none.items[0].words);
  assert(none.items[8].key === "front-back-tape" && none.items[8].words === "One tape front to back: the long side wall, front corner to back corner. It holds the house's depth, which the photos alone can leave loose.", none.items[8].words);
  assert(none.items[4].words === "The wall from corner 1 to 2: straight on from the street, both corners in.", none.items[4].words);
  const shots = [...RECT.map((_, k) => ({ photo: `c${k}`, shot: { kind: "corner", index: k } })), ...RECT.map((_, i) => ({ photo: `w${i}`, shot: { kind: "wall", index: i } }))];
  assert(x.routeCoverage({ ring: RECT, views: [], taps: [], shots, measured: false, depthTaped: true }).items.length === 0, "all eight taken, and the depth taped");
  // Measured, the front-to-back tape is asked only while the depth is loose.
  const views = [...cornerShots, ...wallShots];
  assert(x.routeCoverage({ ring: RECT, views, taps: [], shots: [], measured: true, depthPlusMinusPct: 3 }).items.length === 0, "a depth to ±3% wants no tape");
  assert(x.routeCoverage({ ring: RECT, views, taps: [], shots: [], measured: true, depthPlusMinusPct: 17 }).items.map((i) => i.key).join() === "front-back-tape", "a depth to ±17% does");
  // A gable is asked square on, its peak in; a named wall by its name.
  const g = x.routeCoverage({ ring: RECT, views: [], taps: [], shots: [], measured: false, gables: [1], wallName: (i) => (i === 1 ? "Right" : null) });
  assert(g.items.some((i) => i.kind === "gable" && i.words === "The Right wall (corners 2 to 3), a gable: straight on from the right side, both corners and its peak in."), g.items.map((i) => i.words).join(" | "));
});

test("one photo left out: the checklist says which corner and from where; a photo the measure couldn't place counts for nothing", () => {
  // The 45-degree photo of the back-right corner (3) gone: it's still in three photos, but none looks at it at 45.
  const less = x.routeCoverage({ ring: RECT, views: [...cornerShots.filter((v) => v.photo !== "corner2"), ...wallShots], taps: [], shots: [], measured: true });
  assert(less.items.length === 1 && less.items[0].words === "No photo looks at corner 3 (back right) at 45°: take one from the back right, both walls in frame.", less.items.map((i) => i.words).join(" | "));
  // Only the front's two photos: the back corners in none, the back wall with no photo of both its ends.
  const front = x.routeCoverage({ ring: RECT, views: [cornerShots[0], wallShots[0]], taps: [{ photo: "unplaced", corner: 2 }], shots: [], measured: true });
  const words = front.items.map((i) => i.words);
  assert(words.includes("Corner 3 (back right) is in no photo yet: take one from the back right, at 45° to its two walls."), words.join(" | "));
  assert(words.includes("The wall from corner 3 to 4 has no photo with both its corners in: take one straight on from the back yard, both corners in."), words.join(" | "));
  // Corners and walls missing come before the 45s and the straight-ons.
  const kinds = front.items.map((i) => i.kind);
  assert(kinds.lastIndexOf("corner-seen") < kinds.indexOf("wall-both") && kinds.lastIndexOf("wall-both") < kinds.indexOf("corner-45"), kinds.join());
});

test("where a corner is, in words: front and back as seen from the street, an inside corner said so", () => {
  // An L: the back-left quarter cut out (counter-clockwise from the front left).
  const L = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 20, y: 40 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  assert(["front left", "front right", "back right", "back, middle", "middle", "left side"].every((w, k) => x.cornerPlace(L, k) === w), L.map((_, k) => x.cornerPlace(L, k)).join(" | "));
  const items = x.routeCoverage({ ring: L, views: [], taps: [], shots: [], measured: false }).items;
  assert(!items.some((i) => i.corner === 4) && items.filter((i) => i.kind === "corner-45").length === 5, "the inside corner is not asked at 45");
});

console.log("\nattached homes on the photo route (10-17)");

/**
 * Photos made up for a house of known shape, no pixels: each camera level, 5' up, the owner's lens (f/W 0.664) on an
 * 800 x 600 photo, and each corner it sees tapped where its foot falls. The grey is blank, so a tap stays where it is
 * (no edge to snap to), and no photo has wall edges: the corners and the tapes are all the solve has.
 */
const SYN = { W: 800, H: 600, f: 0.664 * 800 };
const GD = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function synPhoto(id, at, look) {
  const d = [look.x - at[0], look.y - at[1]];
  const L = Math.hypot(d[0], d[1]);
  const q = [0, 1, 2, 3].reduce((a, c) => (d[0] * GD[c][0] + d[1] * GD[c][1] > d[0] * GD[a][0] + d[1] * GD[a][1] ? c : a), 0);
  const Z = GD[q];
  const X = [Z[1], -Z[0]];
  const psi = Math.atan2((d[0] * X[0] + d[1] * X[1]) / L, (d[0] * Z[0] + d[1] * Z[1]) / L);
  const camera = { width: SYN.W, height: SYN.H, f: SYN.f, k: 0, R: [Math.cos(psi), 0, -Math.sin(psi), 0, -1, 0, Math.sin(psi), 0, Math.cos(psi)] };
  const tap = (P) => {
    const v = [P.x - at[0], P.y - at[1]];
    const off = Math.atan2(v[0] * X[0] + v[1] * X[1], v[0] * Z[0] + v[1] * Z[1]) - psi;
    const depth = Math.hypot(v[0], v[1]) * Math.cos(off);
    return { x: SYN.W / 2 + SYN.f * Math.tan(off), y: SYN.H / 2 + (SYN.f * 5) / depth };
  };
  return { id, at, data: { id, camera, gray: { data: new Float32Array(SYN.W * SYN.H), width: SYN.W, height: SYN.H }, edges: [] }, tap };
}
/** A route over made-up photos: [shots] as [id, at, look, corners seen (party ones flagged)]. */
function synRoute(truth, drawn, homeType, shots, tapes) {
  const photos = shots.map(([id, at, look]) => synPhoto(id, at, look));
  const corners = shots.flatMap(([id, , , seen], k) => seen.map(({ c, party }) => ({ photo: id, corner: c, by: "user", ...photos[k].tap(truth[c]), ...(party ? { party: true } : {}) })));
  const input = {
    photos: photos.map((p, i) => ({ id: p.id, width: SYN.W, height: SYN.H, takenAt: i * 10000 })),
    buildings: [{ id: "main", outline: drawn, homeType, shared: x.defaultShared(drawn, homeType), corners, tapes }],
  };
  return { input, data: photos.map((p) => p.data) };
}
const landOf = (input, data, sol) => {
  const m = x.measuredFrom(sol, data, "2026-10-17T12:00:00.000Z");
  const state = { format: "scrivn-photo-route/1", ...input, measured: null };
  return { m, ext: x.exteriorFromRoute(undefined, state, m) };
};

// A semi, 24' x 40', its right-hand wall shared; drawn rough at 26' x 36'. Photographed from the front, the front left at
// 45, the left, the back left at 45 and the back; where it ends tapped on the front and back photos; the front taped.
const SEMI = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 40 }, { x: 0, y: 40 }];
const SEMI_DRAWN = [{ x: 0, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 36 }, { x: 0, y: 36 }];
const semiShots = [
  ["front", [12, -50], { x: 12, y: 20 }, [{ c: 0 }, { c: 1, party: true }]],
  ["front-left", [-32, -32], { x: 0, y: 0 }, [{ c: 3 }, { c: 0 }, { c: 1, party: true }]],
  ["left", [-50, 20], { x: 0, y: 20 }, [{ c: 3 }, { c: 0 }]],
  ["back-left", [-32, 72], { x: 0, y: 40 }, [{ c: 2, party: true }, { c: 3 }, { c: 0 }]],
  ["back", [12, 90], { x: 12, y: 20 }, [{ c: 2, party: true }, { c: 3 }]],
];

test("a semi off photos: the right-hand wall shared by one tap, its depth from the open side, the party line where it ends", () => {
  assert(JSON.stringify(x.defaultShared(SEMI_DRAWN, "semi")) === "[1]" && JSON.stringify(x.defaultShared(SEMI_DRAWN, "detached")) === "[]", "the right-hand side wall");
  const { input, data } = synRoute(SEMI, SEMI_DRAWN, "semi", semiShots, [{ id: "front", kind: "side", from: 0, feet: 24 }]);
  const sol = x.solveRoute(input, "main", data);
  assert(sol.cameras.length === 5, `${sol.cameras.length} placed: ${JSON.stringify(sol.unplaced)}`);
  near(sol.sides[0].lengthFeet, 24, "the front, taped", 0.01);
  // The depth, seen from the open side: corners alone (made-up photos have no window edges), each photo free to turn a
  // degree, so within its own ±.
  for (const i of [1, 3]) assert(Math.abs(sol.sides[i].lengthFeet / 40 - 1) * 100 <= sol.sides[i].plusMinusPct && Math.abs(sol.sides[i].lengthFeet - 40) < 0.8, `side ${i}: ${sol.sides[i].lengthFeet.toFixed(2)} ±${sol.sides[i].plusMinusPct}%`);
  const { ext } = landOf(input, data, sol);
  const right = ext.sides.find((s) => s.shared);
  assert(ext.homeType === "semi" && ext.sides.filter((s) => s.shared).length === 1 && right && !right.photos, JSON.stringify(ext.sides.map((s) => [s.name, s.shared, s.photos?.length])));
  // The model, roof and report take it from there (session B's): nothing on it counted, the roof cut at the party line.
  const q = x.exteriorQuantities(ext);
  assert(q.roofing && q.roofing.partyFeet > 0, `party line ${q.roofing?.partyFeet}`);
  assert(/^Semi-detached: the .* wall is shared with the neighbour and not counted\.$/.test(x.homeTypeWords(ext) ?? ""), x.homeTypeWords(ext));
});

test("where this home ends is numbered only as a corner of the shared wall", () => {
  const { input, data } = synRoute(SEMI, SEMI_DRAWN, "semi", semiShots, []);
  // Every tap left to the app but the first on each photo; the party taps flagged.
  const b = input.buildings[0];
  const first = new Set();
  b.corners = b.corners.map((c) => {
    if (first.has(c.photo)) return { ...c, corner: -1, by: undefined };
    first.add(c.photo);
    return c;
  });
  const out = x.numberCorners(input, "main", data);
  const truth = synRoute(SEMI, SEMI_DRAWN, "semi", semiShots, []).input.buildings[0].corners;
  assert(out.every((c, i) => c.corner === truth[i].corner), out.map((c, i) => `${c.photo}:${c.corner}/${truth[i].corner}`).join(" "));
  const party = x.partyCorners(4, [1]);
  assert(out.filter((c) => c.party).every((c) => party.has(c.corner)), "party taps on the shared wall's ends");
});

test("the checklist never asks for the shared wall, nor a 45 where the home ends", () => {
  const { input, data } = synRoute(SEMI, SEMI_DRAWN, "semi", semiShots, [{ id: "front", kind: "side", from: 0, feet: 24 }]);
  const before = x.routeCoverage({ ring: SEMI_DRAWN, views: [], taps: [], shots: [], measured: false, shared: [1] });
  assert(!before.items.some((i) => i.wall === 1 || i.corner === 1 || i.corner === 2), before.items.map((i) => i.words).join(" | "));
  assert(before.items.filter((i) => i.kind === "corner-45").length === 2 && before.items.filter((i) => i.kind === "wall-straight").length === 3, before.items.map((i) => i.words).join(" | "));
  const sol = x.solveRoute(input, "main", data);
  const { m } = landOf(input, data, sol);
  const after = x.routeCoverage({ ring: m.corners, views: x.viewsFromMeasure(m), taps: input.buildings[0].corners, shots: [], measured: true, shared: [1] });
  assert(!after.items.some((i) => i.wall === 1 || (i.kind === "corner-45" && (i.corner === 1 || i.corner === 2))), after.items.map((i) => i.words).join(" | "));
  // The end unit's open side gives the depth: no depth tape asked.
  // The end unit's open side gives the depth: not the shared-wall tape, but the one tape front to back, asked as of any house.
  assert(!after.items.some((i) => i.key === "depth-tape") && !before.items.some((i) => i.key === "depth-tape"), "no shared-wall depth tape for a semi");
  assert(before.items.some((i) => i.key === "front-back-tape"), "the front-to-back tape asked");
});

// A middle townhouse, 18' x 36', both side walls shared; drawn rough at 20' x 30'. Only its front and back can be seen.
const TOWN = [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 36 }, { x: 0, y: 36 }];
const TOWN_DRAWN = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 0, y: 30 }];
const townShots = [
  ["front", [9, -45], { x: 9, y: 18 }, [{ c: 0, party: true }, { c: 1, party: true }]],
  ["front-oblique", [-6, -40], { x: 9, y: 0 }, [{ c: 0, party: true }, { c: 1, party: true }]],
  ["back", [9, 80], { x: 9, y: 18 }, [{ c: 2, party: true }, { c: 3, party: true }]],
  ["back-oblique", [24, 75], { x: 9, y: 36 }, [{ c: 2, party: true }, { c: 3, party: true }]],
];

test("a middle townhouse: both side walls shared; its depth no photo can see, so one tape of it is asked - and measures it", () => {
  assert(JSON.stringify(x.defaultShared(TOWN_DRAWN, "town_middle")) === "[1,3]", "both side walls");
  const tapes = [{ id: "front", kind: "side", from: 0, feet: 18 }];
  const { input, data } = synRoute(TOWN, TOWN_DRAWN, "town_middle", townShots, tapes);
  const sol = x.solveRoute(input, "main", data);
  near(sol.sides[0].lengthFeet, 18, "the front", 0.01);
  near(sol.sides[2].lengthFeet, 18, "the back, off its photos", 0.2);
  // The depth, untaped, is only the shape as drawn: its ± says so, and the advice names the tape.
  assert(sol.sides[1].plusMinusPct > 10 && sol.advice.some((a) => a.from === 1 && /Tape the depth once, front wall to back wall – along the fence or inside/.test(a.why)), JSON.stringify(sol.advice));
  const { m, ext } = landOf(input, data, sol);
  const cov = x.routeCoverage({ ring: m.corners, views: x.viewsFromMeasure(m), taps: input.buildings[0].corners, shots: [], measured: true, shared: [1, 3] });
  const depth = cov.items.filter((i) => i.kind === "depth-tape");
  assert(depth.length === 1 && depth[0].words.startsWith("Tape the depth once, front wall to back wall – along the fence or inside"), cov.items.map((i) => i.words).join(" | "));
  assert(!cov.items.some((i) => i.kind !== "depth-tape" && (i.wall === 1 || i.wall === 3)), "nothing asked of the shared walls but the tape");
  assert(ext.homeType === "town_middle" && ext.sides.filter((s) => s.shared).length === 2, JSON.stringify(ext.sides.map((s) => s.shared)));
  const q = x.exteriorQuantities(ext);
  // The roof cut at both party lines, its ridge across them as a row's runs (`ridgeAcrossParty`): deeper than wide, no rakes all the same.
  assert(q.roofing && q.roofing.partyFeet > 0 && q.roofing.rakeFeet === 0 && q.roof.ends.length === 0, `party ${q.roofing?.partyFeet}, rakes ${q.roofing?.rakeFeet}`);
  // Taped once, the depth is the tape's, and nothing more is asked.
  const taped = synRoute(TOWN, TOWN_DRAWN, "town_middle", townShots, [...tapes, { id: "depth", kind: "side", from: 1, feet: 36 }]);
  const sol2 = x.solveRoute(taped.input, "main", taped.data);
  near(sol2.sides[1].lengthFeet, 36, "the depth, taped", 0.01);
  near(sol2.sides[3].lengthFeet, 36, "the other shared wall with it", 0.05);
  const m2 = landOf(taped.input, taped.data, sol2).m;
  const cov2 = x.routeCoverage({ ring: m2.corners, views: x.viewsFromMeasure(m2), taps: taped.input.buildings[0].corners, shots: [], measured: true, shared: [1, 3], depthTaped: true });
  assert(!cov2.items.some((i) => i.kind === "depth-tape"), cov2.items.map((i) => i.words).join(" | "));
});

test("a detached house on the route is as it was: nothing shared, no party line, no home type", () => {
  const { input, data } = synRoute(SEMI, SEMI_DRAWN, undefined, semiShots.map(([id, at, look, seen]) => [id, at, look, seen.map(({ c }) => ({ c }))]), [{ id: "front", kind: "side", from: 0, feet: 24 }]);
  assert(JSON.stringify(input.buildings[0].shared) === "[]", "nothing shared");
  const { ext } = landOf(input, data, x.solveRoute(input, "main", data));
  assert(!ext.homeType && ext.sides.every((s) => !s.shared) && x.exteriorQuantities(ext).roofing.partyFeet === 0, "detached");
});

// ---------------------------------------------------------------------------------------------
// Trim: surrounds, keystones, columns and pilasters (10-17)
// ---------------------------------------------------------------------------------------------

console.log("\ntrim: surrounds, keystones, columns and pilasters (10-17)");

/**
 * A 20' x 10' stucco wall, level, no parging: a 3' x 4' window, sill 3', 6" from the left... worked by hand:
 *   the window 8.5..11.5 x 3..7, 12 SF; its surround 6" all round: (4 x 5) - 12 = 8 SF; its pieces as cut - two jambs
 *   5' each, a head and a sill 3' each - 16 LF; a keystone 1' across its top, 0.6' at its foot, 1' up from the window's
 *   top (7 to 8): past the head (7.5 to 8) it is (0.8 + 1) / 2 x 0.5 = 0.45 SF more.
 *   a pilaster 1' wide at 15', 10' high, standing out 4", a base and a cap 1' high standing out 3" each way: its face on
 *   the wall 1.5 + 8 + 1.5 = 11 SF; round its shaft 1 + 2 x 1/3 = 1.667', its wrap 16.67 SF.
 *   The field: 200 - 12 - (8 + 0.45 + 11) = 168.55 SF.
 */
function trimmedWall(extra = {}) {
  return side({
    lengthFeet: 20,
    base: "grade",
    baseLeftFeet: 0,
    baseRightFeet: 0,
    eaveLeftFeet: 10,
    eaveRightFeet: 10,
    bands: [{ id: "b", kind: "stucco", top: null }],
    openings: [
      {
        id: "w",
        kind: "window",
        widthFeet: 3,
        heightFeet: 4,
        sillFeet: 3,
        fromLeftFeet: 8.5,
        trim: { leftFeet: 0.5, rightFeet: 0.5, topFeet: 0.5, bottomFeet: 0.5, material: "stucco", keystone: { widthFeet: 1, heightFeet: 1 } },
      },
    ],
    columns: [{ id: "p", kind: "pilaster", fromLeftFeet: 15, widthFeet: 1, depthFeet: 1 / 3, outFeet: 1 / 3, footFeet: 0, heightFeet: 10, base: { heightFeet: 1, outFeet: 0.25 }, cap: { heightFeet: 1, outFeet: 0.25 }, material: "stucco" }],
    ...extra,
  });
}

test("a surround, its keystone and a pilaster: each its own quantity, and the field what is left once they and the window are off", () => {
  const q = x.sideQuantities(trimmedWall());
  near(q.grossSquareFeet, 200, "gross");
  near(q.openingSquareFeet, 12, "the window");
  const t = q.trim;
  assert(t && t.surrounds.length === 1 && t.columns.length === 1, JSON.stringify(t));
  near(t.surrounds[0].squareFeet, 8.45, "the surround's face, the keystone's part past the head in", 1e-9);
  near(t.surrounds[0].linearFeet, 16, "its pieces as cut");
  assert(t.surrounds[0].keystone, "a keystone");
  near(t.columns[0].perimeterFeet, 1 + 2 / 3, "round the pilaster's shaft", 1e-9);
  near(t.columns[0].wrapSquareFeet, (1 + 2 / 3) * 10, "its wrap", 1e-9);
  assert(t.columns[0].base && t.columns[0].cap, "base and cap");
  near(t.squareFeet, 8.45 + 11, "the trim taken off the wall, once", 1e-9);
  near(q.bands[0].trimSquareFeet, 19.45, "off the stucco band", 1e-9);
  near(q.netSquareFeet, 168.55, "the field", 1e-9);
});

test("trim that overlaps - a pilaster against a surround - comes off the wall once; a column standing clear takes none of it", () => {
  // The pilaster moved to 11.75: its left 0.25' over the window's right jamb (11.5-12), from 2.5' to 7.5' up... the jamb's
  // 0.25 x 5 = 1.25 SF the two share comes off once.
  const pil = { id: "p", kind: "pilaster", fromLeftFeet: 11.75, widthFeet: 1, depthFeet: 1 / 3, outFeet: 1 / 3, footFeet: 0, heightFeet: 10, material: "stucco" };
  const q = x.sideQuantities(trimmedWall({ columns: [pil] }));
  near(q.trim.squareFeet, 8.45 + 10 - 1.25, "surround + pilaster less what they share", 1e-9);
  // Standing clear of the wall, 4' out: counted, its wrap all round, the wall behind it whole.
  const col = { ...pil, kind: "column", fromLeftFeet: 15, depthFeet: 1, outFeet: 4 };
  const c = x.sideQuantities(trimmedWall({ columns: [col] }));
  near(c.trim.squareFeet, 8.45, "only the surround off the wall", 1e-9);
  near(c.trim.columns[0].wrapSquareFeet, 2 * (1 + 1) * 10, "a column's four faces", 1e-9);
});

test("a pilaster round an outside corner: its face, both its sides and its back past the corner are clad", () => {
  // 0.73' square, standing out 0.31' from this wall, 0.2' past its left end: 0.73 + (0.73 + 0.2) + 0.31.
  const s = trimmedWall({ openings: [], columns: [{ id: "p", kind: "pilaster", fromLeftFeet: -0.2, widthFeet: 0.73, depthFeet: 0.73, outFeet: 0.31, footFeet: 0, heightFeet: 9.5, material: "stucco" }] });
  near(x.columnPerimeter(s, s.columns[0]), 0.73 + 0.73 + 0.2 + 0.31, "perimeter", 1e-9);
  // Only its part on this wall's own length comes off it: 0.53 x 9.5.
  near(x.sideQuantities(s).trim.squareFeet, 0.53 * 9.5, "the wall under it, this side", 1e-9);
});

test("on a side of tapped shapes, trim comes off the shape on top only", () => {
  // Stone wainscot 0-4' over the stucco 0-10' (tapped after it): the window's sill band (8.5..11.5 x 2.5..3) lies on the stone.
  const stucco = { id: "st", kind: "stucco", closed: true, polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] };
  const stone = { id: "sn", kind: "stone", closed: true, polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 4 }, { x: 0, y: 4 }] };
  const q = x.sideQuantities(trimmedWall({ shapes: [stucco, stone], columns: [], heightsFrom: "level" }));
  const [qs, qn] = q.bands;
  // The surround below 4' (sill band 3 x 0.5, the jambs' 0.5 x 1.5 each) is on the stone: 1.5 + 1.5 = 3 SF.
  near(qn.trimSquareFeet, 3, "on the stone", 1e-9);
  near(qs.trimSquareFeet, 8.45 - 3, "on the stucco, less what the stone covers", 1e-9);
  near(q.trim.squareFeet, 8.45, "all of it once", 1e-9);
});

test("the trim's scope lines, each its own, and the field line says what came off it", () => {
  const e = { sides: [trimmedWall({ id: "a", name: "Front" })], roof: x.defaultRoof(), scope: { roofing: false, sides: ["a"], soffitFascia: false, eavestrough: false } };
  const lines = x.exteriorScopeLines(e).siding;
  assert(lines[0].startsWith("Remove & replace stucco – Front – 168.6 SF (200.0 SF less 12.0 SF of openings and 19.") && lines[0].endsWith(" SF of trim)"), lines[0]);
  for (const want of ["Stucco trim – window surrounds – 1 – 16.0 LF (8.5 SF)", "Stucco trim – keystones – 1", "Pilasters – stucco wrap – 1 – 16.7 SF (round the shaft × its height)", "Pilasters – stucco caps – 1", "Pilasters – stucco bases – 1"]) {
    assert(lines.includes(want), `${want}\n      in ${lines.join(" | ")}`);
  }
  // Out of scope, no line.
  assert(!x.exteriorScopeLines({ ...e, scope: { ...e.scope, sides: [] } }).siding.some((l) => /trim|Pilaster/.test(l)), "nothing out of scope");
});

test("a side with no trim is priced as it always was: no trim keys at all", () => {
  const s = trimmedWall({ openings: [{ id: "w", kind: "window", widthFeet: 3, heightFeet: 4, sillFeet: 3, fromLeftFeet: 8.5 }], columns: undefined });
  const q = x.sideQuantities(s);
  assert(!("trim" in q) && !("trimSquareFeet" in q.bands[0]), JSON.stringify(q).slice(0, 200));
  near(q.netSquareFeet, 188, "200 less the window");
  const all = x.exteriorQuantities({ sides: [s, { ...s, id: "b" }, { ...s, id: "c" }, { ...s, id: "d" }], roof: { ...x.defaultRoof(), pitch: 4 } });
  assert(!("trim" in all) && !("trimSquareFeet" in all.totals), "nor on the house");
});

test("the trace reads trim through off_wall: a surround on its opening, its keystone, a pilaster with base and cap; anything else stays in front of the wall", () => {
  // The window 250..350 x 380..470 px (1.5-2.5 m along, 1.3-2.2 m up); its surround 230..370 x 360..490 (0.2 m round).
  const trimWire = {
    ...wire,
    off_wall: [
      ...wire.off_wall,
      { what: "surround, white stucco", box: [230, 360, 370, 490] },
      { what: "keystone", box: [285, 345, 315, 380] },
      { what: "pilaster, stucco", box: [820, 300, 860, 600] },
      { what: "cap", box: [810, 300, 870, 320] },
      { what: "base", box: [812, 570, 868, 600] },
      { what: "deck post", box: [50, 400, 60, 600] },
    ],
  };
  const p = x.traceProposals(trimWire, traceFrame, 8 * M);
  assert(p.offWall.length === 7, "every box kept as the trace gave it");
  assert(p.trims?.length === 1 && p.columns?.length === 1, JSON.stringify({ t: p.trims, c: p.columns }));
  const t = p.trims[0];
  assert(t.openingKey === p.openings[0].key && t.trim.material === "stucco" && t.trim.from === "photo", JSON.stringify(t));
  for (const k of ["leftFeet", "rightFeet", "topFeet", "bottomFeet"]) near(t.trim[k], 0.2 * M, k, 1e-9);
  near(t.trim.keystone.widthFeet, 0.3 * M, "the keystone across", 1e-9);
  near(t.trim.keystone.heightFeet, 0.35 * M, "and up from the window's top", 1e-9);
  const c = p.columns[0].column;
  assert(c.kind === "pilaster" && c.cap && c.base, JSON.stringify(c));
  near(c.widthFeet, 0.4 * M, "its width", 1e-9);
  near(c.cap.outFeet, 0.1 * M, "the cap past it", 1e-9);
  near(c.base.heightFeet, 0.3 * M, "the base's height", 1e-9);
  // Ticked: the surround goes on with its window, the pilaster on the side; set aside, nothing.
  const s = side({ lengthFeet: 8 * M, openings: [] });
  const picks = { shapes: [], openings: p.openings.map((o) => ({ key: o.key, kind: o.kind })), wallTop: false, trims: x.trimPicksAtFirst(p) };
  const on = x.applyTrace(s, p, picks);
  assert(on.openings[0].trim && on.columns?.length === 1, JSON.stringify(on.columns));
  const off = x.applyTrace(s, p, { ...picks, trims: [] });
  assert(!off.openings.some((o) => o.trim) && !off.columns, "none ticked, none on");
  // An answer with no trim words reads as before: no trims, no columns.
  const plain = x.traceProposals(wire, traceFrame, 8 * M);
  assert(!("trims" in plain) && !("columns" in plain), "nothing added to a plain answer");
});

test("a surround partly hidden is asked on Check these: kept, it is said; taken away, it is gone", () => {
  const p = x.traceProposals({ ...wire, off_wall: [{ what: "surround, stucco, partly hidden by a railing", box: [230, 360, 370, 490] }] }, traceFrame, 8 * M);
  assert(p.trims[0].trim.unsure === "partly hidden by a railing", p.trims[0].trim.unsure);
  const s = x.applyTrace(side({ id: "a", lengthFeet: 8 * M, openings: [] }), p, { shapes: [], openings: [{ key: p.openings[0].key, kind: "window" }], wallTop: false, trims: x.trimPicksAtFirst(p) });
  const e = { sides: [s, side({ id: "b" }), side({ id: "c" }), side({ id: "d" })], roof: x.defaultRoof() };
  const rows = x.exteriorChecks(e, x.exteriorQuantities(e)).filter((r) => r.kind === "trim");
  assert(rows.length === 1 && rows[0].openingId === s.openings[0].id && /surround round the window/.test(rows[0].title), JSON.stringify(rows));
  assert(x.checkNotes(e, x.exteriorQuantities(e)).some((n) => /couldn't show it all \(partly hidden by a railing\)/.test(n)), "on the report's To check");
  const kept = x.withTrimAnswer(e, "a", { openingId: s.openings[0].id }, true);
  assert(kept.sides[0].openings[0].trim.confirmed && x.exteriorChecks(kept, x.exteriorQuantities(kept)).every((r) => r.kind !== "trim"), "kept: no longer asked");
  const gone = x.withTrimAnswer(e, "a", { openingId: s.openings[0].id }, false);
  assert(!gone.sides[0].openings[0].trim, "taken away");
});

test("each shape's and trim's colour off the squared photo: the wall's middle, the trim's lit quarter", () => {
  // A 1000 x 650 image: dark grey wall (60, 62, 66) everywhere, a white surround (235) round the window, the window glass blue.
  const W = 1000;
  const H = 650;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let px = 0; px < W; px++) {
      const o = (y * W + px) * 4;
      const inSur = px >= 230 && px < 370 && y >= 360 && y < 490;
      const inWin = px >= 250 && px < 350 && y >= 380 && y < 470;
      const c = inWin ? [90, 120, 160] : inSur ? [235, 235, 232] : [60, 62, 66];
      data.set([...c, 255], o);
    }
  }
  const p = x.traceProposals({ ...wire, off_wall: [{ what: "surround, stucco", box: [230, 360, 370, 490] }] }, traceFrame, 8 * M);
  const sw = x.withSwatches(p, { data, width: W, height: H, channels: 4 }, traceFrame);
  assert(sw.shapes[0].colour === "#3c3e42", `the wall ${sw.shapes[0].colour}`);
  assert(sw.trims[0].trim.colour === "#ebebe8", `the trim ${sw.trims[0].trim.colour}`);
});

test("trim read on the phone rides Finish's walls and goes on the tapped opening it is, its outer edges where the photo put them", () => {
  const p = x.traceProposals({ ...wire, off_wall: [{ what: "surround, stucco", box: [230, 360, 370, 490] }, { what: "column, stucco", box: [820, 300, 880, 600] }] }, traceFrame, 8 * M);
  const walls = x.wallsFrom(p);
  assert(walls.openings[0].trim && walls.columns?.length === 1, JSON.stringify(walls).slice(0, 300));
  const finish = { format: "scrivn-finish/1", sides: { 0: { at: "t", photos: [900], scaleAt: 1, roofRead: { at: "t" }, said: [], walls: JSON.parse(JSON.stringify(walls)) } } };
  // The same window tapped 2" wider on the left: the surround's left jamb 2" narrower, so its outer edge stays.
  const read = walls.openings[0];
  const tapped = side({ id: "a", lengthFeet: 8 * M, photos: [{ n: 900 }], openings: [{ id: "t", kind: "window", widthFeet: read.widthFeet + 2 / 12, heightFeet: read.heightFeet, sillFeet: read.sillFeet, fromLeftFeet: read.fromLeftFeet - 2 / 12 }] });
  const out = x.applyScanFinish([tapped], x.defaultRoof(), x.readScanFinish(finish), new Map([[0, "a"]]), 1);
  // The window is the tapped one, its surround on it; the read garage and patio doors, which nothing tapped, are put on as ever.
  const t = out.sides[0].openings.find((o) => o.id === "t")?.trim;
  assert(out.sides[0].openings.length === 3 && t, `on the tapped window, no second window: ${out.sides[0].openings.map((o) => o.kind).join(", ")}`);
  near(t.leftFeet, read.trim.leftFeet - 2 / 12, "the left jamb", 1e-9);
  near(t.rightFeet, read.trim.rightFeet, "the right", 1e-9);
  assert(out.sides[0].columns?.[0].kind === "column", "the column on the side");
});

// The owner's house (10-17): his 18 photos read by eye for the trim, no API (fixtures/photos-only-1016-trim.json).
const ownerTrimmed = () => x.parseScanExterior({ ...fixture("photos-only-1016.json"), finish: fixture("photos-only-1016-trim.json") }, { scanId: null }).exterior;
const ownerPlain = () => x.parseScanExterior({ ...fixture("photos-only-1016.json"), finish: fixture("photos-only-1016-finish.json") }, { scanId: null }).exterior;

test("the owner's house: the field stucco goes down by exactly the trim over it, and the rest is as it was", () => {
  const before = x.exteriorQuantities(ownerPlain());
  const after = x.exteriorQuantities(ownerTrimmed());
  const stucco = (q) => q.cladding.find((c) => c.kind === "stucco");
  const taken = after.totals.trimSquareFeet;
  assert(taken > 100 && taken < 250, `taken ${taken}`);
  near(stucco(before).netSquareFeet - stucco(after).netSquareFeet, taken, "the field down by the trim", 1e-6);
  near(stucco(after).trimSquareFeet, taken, "all of it off the stucco", 1e-6);
  near(after.totals.grossSquareFeet, before.totals.grossSquareFeet, "gross unchanged", 1e-9);
  near(after.totals.openingSquareFeet, before.totals.openingSquareFeet, "openings unchanged", 1e-9);
  near(after.roofing.squares, before.roofing.squares, "the roof unchanged", 1e-9);
  console.log(`    field stucco ${stucco(before).netSquareFeet.toFixed(1)} -> ${stucco(after).netSquareFeet.toFixed(1)} SF (${taken.toFixed(1)} SF of trim off it)`);
});

test("the owner's house: every surround counted - 9 windows, the side door, both garage doors - and 3 keystones", () => {
  const e = ownerTrimmed();
  const q = x.exteriorQuantities(e);
  const read = x.allSides(e).flatMap((s) => s.openings.filter((o) => o.trim).map((o) => o.id));
  const counted = q.sides.flatMap((s) => s.trim?.surrounds ?? []).map((g) => g.openingId);
  assert(read.length === 12 && counted.length === 12 && read.every((id) => counted.includes(id)), `${read.length} read, ${counted.length} counted`);
  const by = Object.fromEntries(q.trim.surrounds.map((g) => [g.openingKind, g.count]));
  assert(by.window === 9 && by.door === 1 && by.garage === 2, JSON.stringify(by));
  assert(q.trim.keystones === 3, `keystones ${q.trim.keystones}`);
  const lf = q.trim.surrounds.reduce((s, g) => s + g.linearFeet, 0);
  const sf = q.trim.surrounds.reduce((s, g) => s + g.squareFeet, 0);
  console.log(`    ${q.trim.surrounds.map((g) => `${g.count} ${g.openingKind} ${g.linearFeet.toFixed(1)} LF ${g.squareFeet.toFixed(1)} SF`).join("; ")}; all ${lf.toFixed(1)} LF, ${sf.toFixed(1)} SF`);
});

test("the owner's house: the columns as his photos show them - 3 by the garage doors, 3 at the porch - each with its base and cap", () => {
  const e = ownerTrimmed();
  const q = x.exteriorQuantities(e);
  const cols = q.trim.columns;
  const n = (kind) => cols.filter((c) => c.kind === kind).reduce((s, c) => s + c.count, 0);
  assert(n("pilaster") === 4 && n("column") === 2, JSON.stringify(cols));
  assert(cols.reduce((s, c) => s + c.caps, 0) === 6 && cols.reduce((s, c) => s + c.bases, 0) === 6, "six caps and six bases");
  const garage = e.sides.filter((s) => s.name.startsWith("Garage front")).flatMap((s) => s.columns ?? []);
  const porch = e.sides.find((s) => s.name.startsWith("Front wall behind")).columns ?? [];
  assert(garage.length === 3 && porch.length === 3, `${garage.length} at the garage, ${porch.length} at the porch`);
  // The porch stands on its real columns now: no posts guessed for it in 3D.
  const model = x.exteriorModel(e);
  assert(model.ok && model.model.walls.some((w) => (w.trim ?? []).some((t) => !t.onWall)), "the porch columns in 3D, clear of the wall");
  console.log(`    ${cols.map((c) => `${c.count} ${c.kind}${c.count === 1 ? "" : "s"} ${c.wrapSquareFeet.toFixed(1)} SF wrap`).join("; ")}`);
});

test("the owner's house on the report and the scope: its own facts, tables and lines; what the photos couldn't show on To check", () => {
  const e = ownerTrimmed();
  const r = x.exteriorReport(e, { title: "t", date: "d", madeWith: "m" });
  assert(r.facts.some((f) => f.label === "Trim" && /^12 surrounds .* · 3 keystones · 6 columns and pilasters/.test(f.value)), JSON.stringify(r.facts.find((f) => f.label === "Trim")));
  assert(/ of trim · /.test(r.facts.find((f) => f.label === "Walls").value), "the walls' fact");
  const captions = r.tables.map((t) => t.caption);
  assert(captions.includes("Trim by side") && captions.includes("Trim totals"), captions.join(" | "));
  assert(r.tables[0].columns.some((c) => c.title === "Trim SF"), "the walls table's Trim SF");
  const totals = r.tables.find((t) => t.caption === "Trim totals").rows.map((row) => row[0]);
  for (const want of ["Stucco trim – window surrounds", "Stucco trim – door surrounds", "Stucco trim – garage door surrounds", "Stucco trim – keystones", "Pilasters – stucco wrap", "Columns – stucco wrap", "Columns – caps", "Columns – bases"]) assert(totals.includes(want), `${want} in ${totals.join(" | ")}`);
  // The east wall's five, seen only edge-on, in one note; the porch window's band behind the railing in its own. Check these asks each.
  const notes = r.notes.filter((n) => /surrounds? round/.test(n));
  assert(notes.length === 2 && notes.some((n) => /^Right side wall: the surrounds round 5 openings - .* \(seen only edge-on/.test(n)) && notes.some((n) => /porch railing/.test(n)), notes.join(" | "));
  assert(x.exteriorChecks(e, x.exteriorQuantities(e)).filter((c) => c.kind === "trim").length === 6, "six to tap on Check these");
  const lines = x.exteriorScopeLines({ ...e, scope: { roofing: false, sides: e.sides.map((s) => s.id), soffitFascia: false, eavestrough: false } }).siding;
  assert(lines.some((l) => /^Stucco trim – window surrounds – 9 – /.test(l)) && lines.some((l) => /^Columns – stucco wrap – 2 – /.test(l)) && lines.some((l) => /^Pilasters – stucco caps – 4$/.test(l)), lines.join("\n"));
});

test("the owner's house drawn: one dark stucco and white trim round the house, the trim raised on the walls and the porch's columns in every view", () => {
  const e = ownerTrimmed();
  const c = x.houseColours(e);
  assert(c && x.colourLightness(c.faces.stucco) < 0.35 && x.colourLightness(c.trim.stucco) > 0.75, JSON.stringify(c));
  const model = x.exteriorModel(e).model;
  // Every stucco face one colour, the bay step's too - no photo read it.
  const faces = model.walls.flatMap((w) => w.faces.filter((f) => f.kind === "stucco"));
  assert(faces.length > 0 && faces.every((f) => f.colour === c.faces.stucco), "one stucco");
  const south = x.houseView(model, "front");
  const trimmedWalls = south.pieces.filter((p) => p.type === "wall" && p.trim?.length);
  assert(trimmedWalls.length >= 3, `${trimmedWalls.length} walls with trim on the front`);
  for (const from of ["front", "right", "left"]) {
    const v = x.houseView(model, from);
    assert(v.pieces.some((p) => p.type === "column"), `the porch's columns from the ${from}`);
  }
  // A house with no colour read is drawn as it always was.
  assert(x.houseColours(ownerPlain()) === null && x.exteriorModel(ownerPlain()).model.walls.every((w) => !w.backgroundColour && !w.trim), "nothing new on the plain house");
});

test("the roof on the elevations: shingles with their tab cuts, metal with its seams, anything else plain", () => {
  const slope = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 6 }, { x: 0, y: 6 }];
  const sh = x.textureMarks(slope, x.roofTextureOf("three_tab"), 0.5);
  // Courses 5" apart, every one drawn at this size; the cuts staggered half a tab, course to course.
  assert(sh.lines.length >= 10 && sh.fine.length > 50, `${sh.lines.length} courses, ${sh.fine.length} cuts`);
  const cutsAt = (y) => sh.fine.filter(([a]) => Math.abs(a.y - y) < 1e-6).map(([a]) => a.x % 1).map((v) => Math.round(((v + 1) % 1) * 100) / 100);
  assert(cutsAt(5 / 12).every((v) => v === 0.5) && cutsAt(10 / 12).every((v) => v === 0), "staggered");
  // Lap siding is lines alone: no cut on it.
  assert(x.textureMarks(slope, x.textureOf("vinyl"), 0.5).fine.length === 0, "siding has none");
  const metal = x.textureMarks(slope, x.roofTextureOf("metal"), 0.5);
  assert(metal.lines.length > 5 && metal.lines.every(([a, b]) => Math.abs(a.x - b.x) < 1e-9), "seams down the slope");
  assert(x.roofTextureOf("tile").texture === "plain" && x.roofTextureOf(null).texture === "shingles", "plain, and shingles when unsaid");
});

console.log("\nsplit-levels, up/down duplexes and roll-up doors (10-19)");

const F5 = 13 / 12;
/** A side clad in vinyl from the grade to its eave, level all along. */
const levelSide = (id, name, lengthFeet, turn, eave) => side({ id, name, lengthFeet, turn, base: "grade", baseLeftFeet: 0, baseRightFeet: 0, eaveLeftFeet: eave, eaveRightFeet: eave, bands: [{ id: `b-${id}`, kind: "vinyl", top: null }] });

/**
 * A side-split: the two-storey section 26 wide x 30 deep at the left, its main walls 9' to the floor line and its upper floor
 * 8'6" over it; the living section 24 wide x 22 deep at its right, 4' back from its front and from its back, half a level
 * up - its walls [living] to its eave (12'6": 3'6" over the floor line). 5/12, 1'4" eaves, 1' rakes; the house's ridge
 * front to back (along the 30); the living section's own gable roof running out from the two-storey section's right wall.
 */
function sideSplit(living = ft(12, 6)) {
  const e = exterior(
    [
      levelSide("front2", "Front, two-storey", 26, "outside", 9),
      levelSide("step", "Front step", 4, "inside", 9),
      levelSide("frontL", "Front, living", 24, "outside", living),
      levelSide("right", "Right", 22, "outside", living),
      levelSide("rearL", "Rear, living", 24, "inside", living),
      levelSide("rearStep", "Rear step", 4, "outside", 9),
      levelSide("rear2", "Rear, two-storey", 26, "outside", 9),
      levelSide("left", "Left", 30, "outside", 9),
    ],
    { pitch: 5, eaveOverhangFeet: ft(1, 4), rakeOverhangFeet: 1 },
  );
  e.homeType = "split";
  e.upper = {
    sides: [
      levelSide("uFront", "Upper front", 26, "outside", ft(8, 6)),
      levelSide("uRight", "Upper right", 30, "outside", ft(8, 6)),
      levelSide("uRear", "Upper rear", 26, "outside", ft(8, 6)),
      levelSide("uLeft", "Upper left", 30, "outside", ft(8, 6)),
    ],
    at: { sideId: "front2", dx: 0, dy: 0 },
  };
  e.scope = { roofing: true, sides: x.allSides(e).map((s) => s.id), soffitFascia: true, eavestrough: true };
  return e;
}

/** The levels a view says, as (label, feet over its ground). */
const levelsOf = (model, from) => {
  const v = x.houseView(model, from);
  return v.levels.map((l) => [l.label, Math.round((l.y - v.groundY) * 12) / 12]);
};

test("a side-split: the living section's roof half a level up, against the two-storey section's wall, and its walls their own height", () => {
  const e = sideSplit();
  const q = roofOf(e);
  const r = q.roofing;
  assert(q.roof.note === null, q.roof.note);
  // The living section, 24 out from the wall and 22 along it, is deeper than half its width: its ridge runs out from the wall.
  assert(q.roof.lowerRoofs.map((l) => `${l.sideId}:${l.kind}`).join() === "right:tent", JSON.stringify(q.roof.lowerRoofs));
  // Its walls read 12'6" against the floor line's 9': it stands 3'6" up.
  const levels = x.splitLevels(x.exteriorFootprint(e).corners, q.roof.sections, x.exteriorFootprint(e).sideIds.map((id) => { const s = e.sides.find((t) => t.id === id); return [s.eaveLeftFeet, s.eaveRightFeet]; }));
  near(levels.floorLine, 9, "the floor line");
  assert(JSON.stringify(levels.lifts) === JSON.stringify({ 1: 3.5 }), JSON.stringify(levels.lifts));
  // The roof: the house's 28'8" x 32' (eaves 1'4" past the 26, rakes 1' past the 30) = 917.33, and the living section's 25 x
  // 24'8" (its wall to its rake 1' past the right wall; eaves 1'4" past its front and back) = 616.67 - under the house's
  // eave overhang where they meet, as built - each x 13/12 at 5/12.
  near(r.areaSquareFeet, (28 + 2 / 3) * 32 * F5 + 25 * (24 + 2 / 3) * F5, "area");
  near(r.squares, 16.62, "squares", 0.005);
  near(r.ridgeFeet, 32 + 25, "the house's ridge and the living section's, out from the wall");
  near(r.eaveFeet, 2 * 32 + 2 * 25, "eaves");
  // Rakes: the house's two gable ends, 14'4" a slope; the living section's one, 12'4" a slope.
  near(r.rakeFeet, 4 * (14 + 1 / 3) * F5 + 2 * (12 + 1 / 3) * F5, "rakes");
  near(r.stepFeet, 2 * (12 + 1 / 3) * F5, "step flashing: the living roof's two slopes up the two-storey section's wall");
  near(r.valleyFeet + r.hipFeet + r.headwallFeet, 0, "no valleys, hips or headwall");
  // The walls: the main floor at its own heights - 9' under the upper floor, 12'6" the living section, its gable 22 x 4'7"/2.
  const sf = (id) => q.sides.find((s) => s.sideId === id).grossSquareFeet;
  near(sf("front2"), 26 * 9, "the two-storey front to the floor line");
  near(sf("frontL"), 24 * 12.5, "the living front to its own eave");
  near(sf("right"), 22 * 12.5 + (22 * (11 * 5 / 12)) / 2, "the living section's gable end");
  near(sf("uFront"), 26 * 8.5 + (26 * (13 * 5 / 12)) / 2, "the upper front and the house's gable");
  // The upper right stands on the floor line past the living section (its 4' steps) and on its roof over it: 3'6" up at its
  // walls and 3'6" + 4'7" at its ridge. Its 30 x 8'6" less 22 x 3'6" and the 22 x 4'7"/2 roof triangle.
  near(sf("uRight"), 30 * 8.5 - 22 * 3.5 - (22 * (11 * 5 / 12)) / 2, "the upper right over the living roof");
  const base = q.bases.uRight;
  near(Math.max(...base.map((b) => b.rise)), 3.5 + 11 * 5 / 12, "the living roof's ridge on the upper right wall");
  assert(base.some((b) => Math.abs(b.t - 4 / 30) < 1e-9 && Math.abs(b.rise - 3.5) < 1e-5) && base.some((b) => Math.abs(b.t - 4 / 30) < 1e-9 && Math.abs(b.rise) < 1e-9), "a step up at the living section's front wall");
  near(q.totals.grossSquareFeet, 2 * 26 * 9 + 2 * 4 * 9 + 2 * 24 * 12.5 + 22 * 12.5 + 30 * 9 + (22 * 55 / 12) / 2 + 2 * (26 * 8.5 + (26 * 65 / 12) / 2) + 30 * 8.5 + (30 * 8.5 - 77 - (22 * 55 / 12) / 2), "every wall");
  // The downspouts hang from each eave: the house's two runs at 9' + 8'6", the living section's at 12'6", by length.
  const lines = x.exteriorScopeLines(e);
  const eave = (64 * 17.5 + 50 * 12.5) / 114;
  assert(lines.siding.includes(`Remove & replace downspouts – 4 – ${(4 * eave * 1.15).toFixed(1)} LF (eave height + 15%)`), lines.siding.join(" | "));
  assert(lines.roofing.includes("Step flashing – 26.7 LF (a lower roof's slopes against the wall)"), lines.roofing.join(" | "));
  // The report's cover says what it is.
  const facts = x.exteriorReport(e, { title: "Split", date: "Oct 19, 2026", madeWith: "Scrivn" }).facts;
  assert(facts[0].label === "Home" && facts[0].value.startsWith("Split-level:"), JSON.stringify(facts[0]));
  // In 3D the upper right wall stands on the living roof: its foot at 12'6" + 4'7" at the ridge, its top the house's 17'6" eave.
  const model = x.exteriorModel(e).model;
  const uRight = model.walls.find((w) => w.id === "uRight");
  const foot = uRight.outline.slice(0, uRight.bottomPoints);
  const groundAt = Math.min(...model.walls.filter((w) => w.grade).flatMap((w) => w.grade.map((g) => g.y)));
  near(Math.max(...foot.map((p) => p.y)) - groundAt, 12.5 + 55 / 12, "its foot on the living roof's ridge", 1e-6);
  // Each view says each level for what it is: the floor line is no eave.
  assert(JSON.stringify(levelsOf(model, "front")) === JSON.stringify([["Floor line", 9], ["Eave", 12.5], ["Eave", 17.5], ["Top of roof", levelsOf(model, "front")[3][1]]]), JSON.stringify(levelsOf(model, "front")));
  assert(JSON.stringify(levelsOf(model, "right").slice(0, 3)) === JSON.stringify([["Floor line", 9], ["Eave", 12.5], ["Eave", 17.5]]), JSON.stringify(levelsOf(model, "right")));
});

test("a side-split read within a foot of the floor line is one floor: no lift", () => {
  const q = roofOf(sideSplit(ft(9, 6)));
  // The living roof from the floor line: the upper right less its triangle alone, from the living section's walls.
  near(q.sides.find((s) => s.sideId === "uRight").grossSquareFeet, 30 * 8.5 - (22 * (11 * 5 / 12)) / 2, "the upper right");
});

test("an up/down duplex: one building, two storeys, nothing split", () => {
  const e = exterior(
    [levelSide("front", "Front", 40, "outside", 9), levelSide("right", "Right", 28, "outside", 9), levelSide("rear", "Rear", 40, "outside", 9), levelSide("left", "Left", 28, "outside", 9)],
    { pitch: 6, eaveOverhangFeet: ft(1, 4), rakeOverhangFeet: 1 },
  );
  e.homeType = "duplex_updown";
  e.upper = {
    sides: [levelSide("uFront", "Upper front", 40, "outside", 9), levelSide("uRight", "Upper right", 28, "outside", 9), levelSide("uRear", "Upper rear", 40, "outside", 9), levelSide("uLeft", "Upper left", 28, "outside", 9)],
    at: { sideId: "front", dx: 0, dy: 0 },
  };
  e.scope = { roofing: true, sides: x.allSides(e).map((s) => s.id), soffitFascia: true, eavestrough: true };
  const q = roofOf(e);
  const r = q.roofing;
  assert(q.roof.lowerRoofs.length === 0 && q.roof.sections.length === 1, "one roof, over the upper floor");
  // 42 x 30'8" at 6/12: the ridge along the 40, 7' up over the 14.
  near(r.areaSquareFeet, 42 * (28 + 8 / 3) * F6, "area");
  near(r.squares, 14.4, "squares", 0.005);
  near(r.ridgeFeet, 42, "ridge");
  near(r.eaveFeet, 84, "eaves");
  near(r.rakeFeet, 4 * (14 + 4 / 3) * F6, "rakes");
  near(q.totals.grossSquareFeet, 2 * (40 * 9) * 2 + 2 * (28 * 9) * 2 + 2 * ((28 * 7) / 2), "two storeys of walls and the two gables");
  const lines = x.exteriorScopeLines(e);
  // The downspouts from the eave, 9' + 9' up - not the main floor's 9'.
  assert(lines.siding.includes(`Remove & replace downspouts – 4 – ${(4 * 18 * 1.15).toFixed(1)} LF (eave height + 15%)`), lines.siding.join(" | "));
  assert(lines.roofing.includes("High roof charge – two storeys or more – 14.40 SQ (the roof over the upper floor)"), lines.roofing.join(" | "));
  const facts = x.exteriorReport(e, { title: "Duplex", date: "Oct 19, 2026", madeWith: "Scrivn" }).facts;
  assert(facts[0].label === "Home" && facts[0].value === "Duplex (up/down): two units, one over the other, measured as one building.", JSON.stringify(facts[0]));
  const model = x.exteriorModel(e).model;
  for (const c of x.VIEWS) assert(JSON.stringify(levelsOf(model, c).slice(0, 2)) === JSON.stringify([["Floor line", 9], ["Eave", 18]]), `${c}: ${JSON.stringify(levelsOf(model, c))}`);
  // A duplex or a split-level shares no wall: none proposed on the photo route's shape, none asked on the plan.
  const box = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 28 }, { x: 0, y: 28 }];
  assert(x.defaultShared(box, "duplex_updown").length === 0 && x.defaultShared(box, "split").length === 0 && x.defaultShared(box, "semi").length === 1, "nothing shared");
  assert(x.homeTypeWords({ ...e, homeType: undefined }) === null, "a detached house has no Home fact");
});

test("a roll-up door: its own kind, named, drawn and read as one; nothing else about the openings changes", () => {
  assert(x.OPENING_LABEL.rollup === "Roll-up door" && x.SURROUND_WORDS.rollup === "roll-up door surrounds", "named");
  // The trace: a garage_door with a "roll-up" box round its hood over its head is a roll-up; the AC unit stays in front of the wall.
  const withHood = { ...wire, off_wall: [...wire.off_wall, { what: "roll-up hood, metal", box: [515, 310, 795, 345] }] };
  const p = x.traceProposals(withHood, traceFrame, 8 * M);
  const door = p.openings.find((o) => o.traced === "garage door");
  assert(door.kind === "rollup" && door.rollupFrom === 1, JSON.stringify(door));
  assert(p.openings.filter((o) => o.kind === "rollup").length === 1 && p.openings.find((o) => o.traced === "window").kind === "window", "only the door under it");
  // Its size is no garage door's: no size check off it.
  assert(x.doorCandidates(p.openings, 1).every((d) => d.key !== door.key), "not a size check");
  // Over a window it is nothing; without one, the garage door stays a garage door - the recorded answers' case.
  const overWindow = x.traceProposals({ ...wire, off_wall: [{ what: "roll-up shutter", box: [250, 360, 350, 380] }] }, traceFrame, 8 * M);
  assert(overWindow.openings.every((o) => o.kind !== "rollup"), "a window is not a roll-up door");
  assert(x.traceProposals(wire, traceFrame, 8 * M).openings.some((o) => o.kind === "garage"), "a garage door as before");
  // The recording round-trips: the box comes back in off_wall and reads as the roll-up again.
  const back = x.traceProposals(rec.wireFromProposals(p, traceFrame, x), traceFrame, 8 * M);
  assert(back.openings.find((o) => o.traced === "garage door").kind === "rollup", "recorded and read back");
  assert(/roll-up/.test(x.traceUserMessage(traceFrame, { name: "Front", lengthM: 8, bottomLeftM: 0, bottomRightM: 0, leftEndInPhoto: true, rightEndInPhoto: true })), "the prompt says how to tell one");
  // The report: named "Roll-up door 1", counted on the cover without a "0 garage doors".
  const shed = { ...rect(16, 12, { pitch: 3 }, 8), scope: { roofing: true, sides: [], soffitFascia: false, eavestrough: false } };
  shed.sides[0].openings = [{ id: "ru", kind: "rollup", widthFeet: 5, heightFeet: 6, sillFeet: 0, fromLeftFeet: 9 }];
  const rep = x.exteriorReport(shed, { title: "Shed", date: "Oct 19, 2026", madeWith: "Scrivn" });
  assert(rep.facts.find((f) => f.label === "Openings").value === "0 windows · 0 doors · 1 roll-up door", JSON.stringify(rep.facts.find((f) => f.label === "Openings")));
  assert(JSON.stringify(rep.tables).includes("Roll-up door 1"), "the openings table");
  // A roll-up off the ground with nothing at its foot is asked about, as a door is.
  shed.sides[0].openings[0] = { ...shed.sides[0].openings[0], sillFeet: 3, from: "photo" };
  assert(x.exteriorChecks(shed, x.exteriorQuantities(shed)).some((c) => c.key === "opening:ru"), "checked like a door");
});

console.log("\nsanity checks on a house measured from photos (10-20)");

/** The made-up 24' x 40' house above, detached, measured off its five photos: the front taped, and the depth when [depth]. */
function sanityHouse(depth) {
  const shots = semiShots.map(([id, at, look, seen]) => [id, at, look, seen.map(({ c }) => ({ c }))]);
  const tapes = [{ id: "front", kind: "side", from: 0, feet: 24 }, ...(depth ? [{ id: "depth", kind: "side", from: 3, feet: 40 }] : [])];
  const { input, data } = synRoute(SEMI, SEMI_DRAWN, undefined, shots, tapes);
  return landOf(input, data, x.solveRoute(input, "main", data)).ext;
}

test("a clean house measured from photos, its depth taped: nothing worth a look", () => {
  const flags = x.routeSanity(sanityHouse(true));
  assert(flags.length === 0, flags.map((f) => f.words).join(" | "));
});

test("each check names what to look at: the eaves at a corner, a door's size, a camera nobody could have stood at", () => {
  const ext = sanityHouse(true);
  const m = ext.photoRoute.measured;
  const ids = m.sideIds;
  // The eaves round corner 2 (the front wall's right end, the right wall's left end): 9'6" and 11'0". A door 3' x 5' on the front.
  const sides = ext.sides.map((s) =>
    s.id === ids[0]
      ? { ...s, eaveRightFeet: 9.5, openings: [...s.openings, { id: "d5", kind: "door", widthFeet: 3, heightFeet: 5, sillFeet: 0, fromLeftFeet: 10 }] }
      : s.id === ids[1]
        ? { ...s, eaveLeftFeet: 11 }
        : s,
  );
  // Photo 1 (the front) 1'2" under the ground; photo 3 (the left) inside the house.
  const cameras = m.cameras.map((c) => (c.photo === "front" ? { ...c, heightFeet: -1.2 } : c.photo === "left" ? { ...c, at: [10, 20] } : c));
  const flags = x.routeSanity({ ...ext, sides, photoRoute: { ...ext.photoRoute, measured: { ...m, cameras } } });
  const words = flags.map((f) => f.words);
  const name = (i) => ext.sides.find((s) => s.id === ids[i]).name;
  assert(words.includes(`Corner 2: the eaves either side disagree by 1'6" (9'6" on the ${name(0)} wall, 11' on the ${name(1)} wall). One of the photos is placed or read wrong: look at photo 1 and photo 5.`) || words.some((w) => /^Corner 2: the eaves either side disagree by 1'6" \(9'6" on the .* wall, 11' on the .* wall\)\. One of the photos is placed or read wrong/.test(w)), words.join(" | "));
  assert(words.some((w) => /^Door on the .* wall reads 3' wide by 5' tall: a door is about 6'8" tall\. Check the wall's photo is placed right/.test(w)), words.join(" | "));
  assert(words.includes("Photo 1 works out 1'2\" under the ground at the corners tapped on it: check each is tapped where the corner meets the ground (not on a deck or a step), and where it was placed."), words.join(" | "));
  assert(words.includes("Photo 3 works out to have been taken from inside the house: check the corners tapped on it and their numbers."), words.join(" | "));
  assert(flags.filter((f) => f.kind === "camera").every((f) => f.photo), "each camera flag names its photo");
});

test("an outline that won't close square, and a depth only loosely tied, are said - and Measure is never stopped", () => {
  const ext = sanityHouse(true);
  const m = ext.photoRoute.measured;
  // The front wall solved the wrong way round: its right-hand corner west of its left.
  const corners = m.corners.map((p, i) => (i === 1 ? { x: -5, y: p.y } : p));
  const flipped = x.routeSanity({ ...ext, photoRoute: { ...ext.photoRoute, measured: { ...m, corners } } });
  assert(flipped.some((f) => f.kind === "outline" && f.side === 0 && /came out the wrong way round\. Check the numbers of corners 1 and 2 on photo 1, photo 2/.test(f.words)), flipped.map((f) => f.words).join(" | "));
  // Untaped front to back, and the depth to ±18%: one tape of the long side wall is asked.
  const loose = { ...m, sides: m.sides.map((s) => (s.from === 3 || s.from === 1 ? { ...s, taped: false, plusMinusPct: 18 } : s)) };
  const depth = x.routeSanity({ ...ext, photoRoute: { ...ext.photoRoute, measured: loose } }).filter((f) => f.kind === "depth");
  assert(depth.length === 1 && /^The house's depth is only good to ±18% \(the .* wall, 40'\): too little ties its back to its front\. One tape of that side wall, front corner to back corner, measures it/.test(depth[0].words), JSON.stringify(depth));
  // A wall named as a wall is not called a "wall wall".
  const named = { ...ext, sides: ext.sides.map((s) => (s.id === m.sideIds[depth[0].side] ? { ...s, name: "Right side wall" } : s)), photoRoute: { ...ext.photoRoute, measured: loose } };
  const said = x.routeSanity(named).find((f) => f.kind === "depth")?.words ?? "";
  assert(said.includes("(the Right side wall, 40')") && !/wall wall/.test(said), said);
});

test("a size estimated on site the measure disagrees with is worth a look: the wall, both lengths, a tape (10-21, use \"check\")", () => {
  const ext = sanityHouse(true);
  const m = ext.photoRoute.measured;
  // The left wall (40' as measured) said "about 30'": 33% off, past its ±20%. The back said within it. The taped right wall said wrong: no check is made on a taped side.
  const at = (i) => m.sides.find((s) => s.from === i);
  const checks = { 1: { feet: 30, plusMinusPct: 20 }, 2: { feet: at(2).lengthFeet * 1.1, plusMinusPct: 20 } };
  const sides = m.sides.map((s) => (checks[s.from] && !s.taped ? { ...s, estimateCheck: x.checkEstimate(s.lengthFeet, checks[s.from]) } : s));
  const flags = x.routeSanity({ ...ext, photoRoute: { ...ext.photoRoute, measured: { ...m, sides } } }).filter((f) => f.kind === "estimate");
  const side = sides.find((s) => s.estimateCheck?.disagrees);
  assert(side && flags.length === 1 && flags[0].side === side.from, JSON.stringify(flags));
  assert(/^The .* wall was estimated on site at about 30', but the photos make it \d+'(\d+")?: \d+% longer, more than the estimate's ±20%\. Tape it to see which is right\.$/.test(flags[0].words), flags[0].words);
  assert(x.checkEstimate(36, { feet: 30, plusMinusPct: 20 }).disagrees === false && x.checkEstimate(36.1, { feet: 30, plusMinusPct: 20 }).disagrees === true && x.checkEstimate(23.9, { feet: 30, plusMinusPct: 0 }).disagrees === true, "±20% when none is said, past it disagrees");
});

test("a photo turned well off its own level lines to fit its corners is worth a look, naming them (10-21, house G)", () => {
  const ext = sanityHouse(true);
  const m = ext.photoRoute.measured;
  // Photo 3 (the left) turned 5 degrees by the solve; photo 1 a degree, as photos are.
  const cameras = m.cameras.map((c) => (c.photo === "left" ? { ...c, yawTweakDeg: -5.2 } : c.photo === "front" ? { ...c, yawTweakDeg: 1 } : c));
  const flags = x.routeSanity({ ...ext, photoRoute: { ...ext.photoRoute, measured: { ...m, cameras } } }).filter((f) => f.key.startsWith("camera:turn"));
  assert(flags.length === 1 && flags[0].photo === "left", JSON.stringify(flags));
  assert(/^Photo 3 had to be turned 5° off its own level lines to fit its corners \(corner 1, corner 4\): one of them is likely on the wrong edge/.test(flags[0].words), flags[0].words);
});

console.log("\ncorners on far-back photos (10-21)");

test("a photo's facing settles a two-corner photo's quarter-turn: from the walk, or from what it was taken for", () => {
  // The 24' x 40' box from the back-right at 45: its two back corners fit on two quarter-turns, one 100 ft round the house.
  const p = synPhoto("br", [50, 70], { x: 24, y: 40 });
  const mine = [1, 2].map((c) => {
    const t = p.tap(SEMI[c]);
    const [u, v] = x.toLevel(p.data.camera, t.x, t.y);
    return { photo: "br", corner: c, u, v, bearing: x.columnBearing(p.data.camera, u), onEdge: true, px: [t.x, t.y] };
  });
  const all = x.routeSteps.placementsFromCorners(mine, SEMI, new Set(), p.data.camera);
  assert(all.length === 2, JSON.stringify(all.map((q) => q.at)));
  const facing = x.facingOf({ shot: { kind: "corner", index: 2 } }, SEMI);
  near(facing[0], -Math.SQRT1_2, "corner 3's 45 looks in across it, south-west", 1e-9);
  near(facing[1], -Math.SQRT1_2, "and south", 1e-9);
  const one = x.routeSteps.placementsFromCorners(mine, SEMI, new Set(), p.data.camera, facing);
  assert(one.length === 1 && Math.hypot(one[0].at[0] - 50, one[0].at[1] - 70) < 0.01, JSON.stringify(one.map((q) => q.at)));
  // Said outright (the walk's step), the same; a wall straight on looks against its face; said nothing, nothing filtered.
  assert(x.routeSteps.placementsFromCorners(mine, SEMI, new Set(), p.data.camera, x.facingOf({ facing: [-1, -1] }, SEMI)).length === 1, "said");
  const front = x.facingOf({ shot: { kind: "wall", index: 0 } }, SEMI);
  assert(Math.abs(front[0]) < 1e-9 && Math.abs(front[1] - 1) < 1e-9 && x.facingOf({}, SEMI) === null, JSON.stringify(front));
});

test("a corner tapped on a deck says how high: the camera's height, and the ground under its squared sides, are the ground's (10-22)", () => {
  // The semi's left photo: its two corners tapped 3' up (on a deck), once said and once not.
  const { input, data } = synRoute(SEMI, SEMI_DRAWN, undefined, semiShots, [{ id: "front", kind: "side", from: 0, feet: 24 }]);
  const up = (said) => ({ ...input, buildings: [{ ...input.buildings[0], corners: input.buildings[0].corners.map((c) => (c.photo !== "left" ? c : { ...c, y: SYN.H / 2 + ((c.y - SYN.H / 2) * 2) / 5, ...(said ? { aboveGround: 3 } : {}) })) }] });
  const h = (sol) => sol.cameras.find((c) => c.photo === "left").heightFeet;
  near(h(x.solveRoute(up(false), "main", data)), 2, "tapped 3' up and not said: the camera reads 2' over them", 0.15);
  near(h(x.solveRoute(up(true), "main", data)), 5, "said: 5' over the ground", 0.15);
});

test("corner edges: the long step between two walls is one, put on its edge; a downspout, a fence post below the eye are not", () => {
  // An 800 x 600 level photo: sky over row 150, grass under 450; a wall in shade (90) left of column 400, one in sun (160)
  // right of it; a white downspout 6 px wide at 250 on the shaded wall; a dark window 520-600 on the sunlit one, rows
  // 220-320; a white fence post 8 px wide at 200, rows 380-470, all below the eye (row 300).
  const W = 800;
  const H = 600;
  const g = new Float32Array(W * H);
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      let c = v < 150 ? 200 : v >= 450 ? 70 : u < 400 ? 90 : 160;
      if (v >= 150 && v < 450 && u >= 250 && u < 256) c = 230;
      if (v >= 220 && v < 320 && u >= 520 && u < 600) c = 40;
      if (v >= 380 && v < 470 && u >= 200 && u < 208) c = 220;
      g[v * W + u] = c;
    }
  }
  const cam = { width: W, height: H, f: 0.664 * W, k: 0, R: [1, 0, 0, 0, -1, 0, 0, 0, 1] };
  const edges = x.cornerEdges({ data: g, width: W, height: H }, cam);
  const corner = edges.find((e) => Math.abs(e.u - 400) < 1.5);
  assert(corner && corner.sign === 1 && corner.vTop < 160 && corner.vBottom > 440, JSON.stringify(edges.slice(0, 4)));
  assert(edges[0] === corner, `the strongest: ${JSON.stringify(edges[0])}`);
  assert(!edges.some((e) => Math.abs(e.u - 253) < 8), "the downspout smoothed away");
  assert(!edges.some((e) => Math.abs(e.u - 204) < 10), "the fence post stops below the eye");
  // The window's jambs are long enough to offer, weaker than the corner.
  assert(edges.filter((e) => Math.abs(e.u - 520) < 3 || Math.abs(e.u - 600) < 3).every((e) => e.weight < corner.weight), "jambs weaker");
});

test("a wall whose shape starts a hair off its end keeps its ground there: no wall drawn cut off (10-22, house G's right garage bay)", () => {
  const e = rect(12.31, 20, { pitch: 5 }, 9.7);
  const s0 = e.sides[0];
  // As a read lays it: its corners a fraction of a thousandth of a foot in from the ends, a gable on top.
  const poly = [{ x: 0.00022006916713268333, y: 0.0004 }, { x: 0.00022006916713268333, y: 9.7 }, { x: 6.15, y: 14.2 }, { x: 12.309980269114973, y: 9.7 }, { x: 12.309980269114973, y: 0.0004 }];
  const ext = { ...e, sides: e.sides.map((s) => (s.id === s0.id ? { ...s, shapes: [{ id: "st", kind: "stucco", closed: true, polygon: poly }] } : s)) };
  const wall = x.exteriorModel(ext).model.walls.find((w) => w.sideId === s0.id);
  assert(wall.grade.length === 3 && Math.abs(wall.grade[0].x - 0.00022006916713268333) < 1e-12 && Math.abs(wall.grade[2].x - 12.309980269114973) < 1e-12, JSON.stringify(wall.grade));
});

test("a tape typed on a phone: feet, inches past 12 and an eighth, none of which needs a ' or \" (10-21)", () => {
  // His window, taped in inches alone: 70¾" = 0 ft, 70 in, 6 eighths = 5.8958'. His garage door, 9 ft. 5'10¾" the same window.
  near(x.feetFromParts("", "70", 6), 70.75 / 12, "70¾ in");
  near(x.feetFromParts("9", "", 0), 9, "9 ft");
  near(x.feetFromParts("5", "10", 6), 70.75 / 12, "5 ft 10¾ in");
  near(x.feetFromParts("", "", 4), 0.5 / 12, "½ in alone");
  assert(x.feetFromParts("", "", 0) === null, "nothing typed is nothing");
  assert(x.feetFromParts("5'", "", 0) === null && x.feetFromParts("-2", "", 0) === null, "not a number, or below zero, is nothing");
});

console.log("\nthe walk round the house (10-21)");

/** A walk driven as a tester would: each entry one step - a photo id to take, "skip", a turn ("inside", "joined"), "close". */
function walkThrough(steps) {
  let w = x.newWalk();
  const seen = [];
  for (const s of steps) {
    const at = x.walkStep(w);
    seen.push(at.kind === "measure" ? `measure:${at.role}${at.k}` : at.kind === "front" || at.kind === "finish" ? at.kind : `${at.kind}${at.k}`);
    if (s === "skip") w = x.walkSkip(w);
    else if (s === "measured") w = x.walkMeasured(w);
    else if (s === "inside" || s === "joined" || s === "outside") w = x.walkTurn(w, s);
    else if (s === "close") w = x.walkClose(w);
    else w = x.walkTake(w, s);
  }
  return { w, seen };
}

test("the walk's steps in order: the front and something on it measured, then corner, side, measurement round the house", () => {
  const { w, seen } = walkThrough(["front", "measured", "c1", "s1", "skip", "c2", "s2", "measured", "c3", "s3", "skip", "c4", "close"]);
  assert(seen.join(" ") === "front measure:front0 corner1 side1 measure:side1 corner2 side2 measure:side2 corner3 side3 measure:side3 corner4 side4", seen.join(" "));
  assert(x.walkStep(w).kind === "finish" && x.lapCloses(w) && x.lapTurns(w).join() === "1,1,1,1", JSON.stringify(x.walkStep(w)));
  // The front can't be passed by; the side the walk is at faces the way its turns say.
  assert(x.walkSkip(x.newWalk()).stops.length === 0, "no skipping the front");
  assert(["front", "right side", "back", "left side", "front"].every((f, h) => x.facingWords(h) === f), "facings");
  const photos = x.walkPhotos(w).map((p) => `${p.photo}=${p.tag.role}${p.tag.k}`);
  assert(photos.join() === "front=front0,c1=corner1,s1=side1,c2=corner2,s2=side2,c3=corner3,s3=side3,c4=corner4", photos.join());
});

test("passed by - a side too tight to get back from, a corner's 45, a measurement - and Back takes each back, photos with it", () => {
  const { w } = walkThrough(["front", "skip", "c1", "skip", "skip", "skip"]);
  // The right side too tight: no photo, its length asked and passed by; corner 2 then passed by too.
  assert(x.walkStep(w).kind === "side" && x.walkStep(w).k === 2, JSON.stringify(x.walkStep(w)));
  assert(w.stops[2].kind === "side" && w.stops[2].skipped.join() === "photo" && w.stops[3].skipped.join() === "photo", JSON.stringify(w.stops));
  const b1 = x.walkBack(w);
  assert(x.walkStep(b1.walk).kind === "corner" && x.walkStep(b1.walk).k === 2 && b1.dropped.length === 0, JSON.stringify(x.walkStep(b1.walk)));
  const b2 = x.walkBack(x.walkBack(x.walkBack(b1.walk).walk).walk);
  assert(x.walkStep(b2.walk).kind === "corner" && x.walkStep(b2.walk).k === 1 && b2.dropped.join() === "c1", `${JSON.stringify(x.walkStep(b2.walk))} ${b2.dropped}`);
  // A measurement passed by is asked again; the front taken back goes with its photo.
  const front = x.walkBack(x.walkBack(b2.walk).walk);
  assert(x.walkStep(front.walk).kind === "front" && front.dropped.join() === "front", JSON.stringify(front));
  // A closed lap opens again.
  const done = walkThrough(["front", "skip", "c1", "s1", "skip", "c2", "s2", "skip", "c3", "s3", "skip", "c4", "close"]).w;
  assert(x.walkStep(x.walkBack(done).walk).kind === "side", "back from the end");
  // A turn can't be changed once its photo is in.
  const turned = x.walkTurn(walkThrough(["front", "skip"]).w, "inside");
  assert(x.walkStep(turned).kind === "side" && turned.stops[1].turn === "inside", "an inside corner after the front, whose photo shows it");
  assert(x.walkTurn(x.walkTake(walkThrough(["front", "skip"]).w, "c1"), "inside").stops[1].turn === undefined, "turn not changed after the 45");
});

test("an L, six corners, one inside: its shape from the lap, numbered as walked; the inside corner asks a photo only when its wall had none", () => {
  // Front, right side, back, the left side's back part, the notch's back (inside corner 4), the left side's front part.
  const { w, seen } = walkThrough(["front", "skip", "c1", "s1", "skip", "c2", "s2", "skip", "c3", "s3", "skip", "inside", "s4", "skip", "c5", "s5", "skip", "c6", "close"]);
  assert(seen.slice(11).join(" ") === "corner4 side4 measure:side4 corner5 side5 measure:side5 corner6 side6", seen.slice(11).join(" "));
  const turns = x.lapTurns(w);
  assert(turns.join() === "1,1,1,-1,1,1" && x.lapCloses(w), turns.join());
  const ring = x.lapOutline(turns);
  // The outline's corner k - 1 is the walk's corner k, so the plan's numbers are the walk's; its turns are the walk's.
  assert(ring.length === 6 && x.ringTurns(ring).join() === turns.join(), JSON.stringify(ring));
  // Corner 1 the front's right-hand end; the front the last side, running east into it, at the bottom.
  const [A, B] = [ring[5], ring[0]];
  assert(B.x - A.x > 30 && A.y === B.y && ring.every((p) => p.y >= A.y), JSON.stringify(ring));
  // Sizes rough: a wall between outside corners long, a step to the notch short; never under 2'.
  const len = ring.map((p, i) => Math.hypot(ring[(i + 1) % 6].x - p.x, ring[(i + 1) % 6].y - p.y));
  assert(len.every((L) => L >= 2) && len[2] < 12 && len[3] < 12 && len[0] > 25, len.map((L) => L.toFixed(1)).join());
  // The left side's back part too tight: then the inside corner asks for that wall, from wherever it can be taken.
  const tight = walkThrough(["front", "skip", "c1", "s1", "skip", "c2", "s2", "skip", "c3", "skip", "skip", "inside"]).w;
  assert(JSON.stringify(x.walkStep(tight)) === JSON.stringify({ kind: "inside", k: 4, wall: "before" }), JSON.stringify(x.walkStep(tight)));
  const took = x.walkTake(tight, "w4");
  assert(x.walkStep(took).kind === "side" && JSON.stringify(x.walkPhotos(took).pop().tag) === JSON.stringify({ role: "corner", k: 4, corner: "inside", wall: "before" }), JSON.stringify(x.walkPhotos(took)));
  const back = x.walkBack(took);
  assert(back.dropped.join() === "w4" && x.walkStep(back.walk).kind === "inside", "Back takes the wall's photo back first");
  assert(x.walkStep(x.walkSkip(tight)).kind === "side", "or it's passed by");
});

test("eight corners with two inside, and other laps: each closes and turns as walked; one that doesn't is said, and draws nothing", () => {
  const laps = {
    "a U open to the back": [1, 1, 1, -1, -1, 1, 1, 1],
    "a T": [1, -1, 1, 1, 1, 1, -1, 1],
    "two notches": [1, 1, -1, 1, 1, -1, 1, 1],
    "inside corners first and last": [-1, 1, 1, 1, 1, 1, 1, -1],
    "the owner's twelve, from the garage's right-hand front corner": [1, 1, 1, -1, 1, -1, 1, 1, -1, 1, -1, 1],
  };
  for (const [name, turns] of Object.entries(laps)) {
    const ring = x.lapOutline(turns);
    assert(ring && ring.length === turns.length && x.ringTurns(ring).join() === turns.join(), `${name}: ${JSON.stringify(ring)}`);
    const n = ring.length;
    // Closed, counter-clockwise, no side crossing another.
    let area = 0;
    for (let i = 0; i < n; i++) area += ring[i].x * ring[(i + 1) % n].y - ring[(i + 1) % n].x * ring[i].y;
    assert(area > 0, `${name}: clockwise`);
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const [a, b, c, d] = [ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]];
        const apart = Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y);
        assert(apart, `${name}: sides ${i} and ${j} meet`);
      }
  }
  assert(x.lapOutline([1, 1, 1]) === null && x.lapOutline([1, 1, 1, -1, 1]) === null, "no shape from a lap that doesn't close");
  // Walked: 8 corners, the 4th and 5th inside, and back at the front.
  const steps = ["front", "skip"];
  [1, 1, 1, -1, -1, 1, 1, 1].forEach((t, i) => {
    if (t < 0) steps.push("inside");
    else steps.push(`c${i + 1}`);
    if (i < 7) steps.push(`s${i + 1}`, "skip");
  });
  steps.push("close");
  const { w } = walkThrough(steps);
  assert(x.walkStep(w).kind === "finish" && x.lapTurns(w).join() === "1,1,1,-1,-1,1,1,1", x.lapTurns(w).join());
  const route = x.withWalk({ format: "scrivn-photo-route/1", photos: x.walkPhotos(w).map((p) => ({ id: p.photo, width: 800, height: 600 })), buildings: [{ id: "main", outline: [], corners: [], tapes: [] }], measured: null }, w);
  const b = route.buildings[0];
  assert(b.outlineFrom === "walk" && b.outline.length === 8 && x.ringTurns(b.outline).join() === "1,1,1,-1,-1,1,1,1", JSON.stringify(b.outline));
  // Said when it doesn't close: a corner missed.
  const short = walkThrough(["front", "skip", "c1", "s1", "skip", "c2", "s2", "skip", "inside", "s3", "skip", "c4"]).w;
  assert(!x.lapCloses(short) && /^That's 3 outside corners and 1 inside: a lap round a house has four more outside corners than inside ones\. A corner may be missed/.test(x.lapProblem(short)), x.lapProblem(short));
  const open = x.withWalk({ format: "scrivn-photo-route/1", photos: [], buildings: [{ id: "main", outline: [], corners: [], tapes: [] }], measured: null }, { ...short, closed: true });
  assert(open.buildings[0].outline.length === 0, "finished anyway: no shape drawn from it");
});

test("one measurement at least: none until a tape is put in, and the walk's end counts what it has", () => {
  const { w } = walkThrough(["front", "skip", "c1", "s1", "skip", "c2", "skip", "skip", "c3", "s3", "skip", "c4", "close"]);
  const base = { format: "scrivn-photo-route/1", photos: x.walkPhotos(w).map((p) => ({ id: p.photo, width: 800, height: 600 })), buildings: [{ id: "main", outline: [], corners: [], tapes: [] }], measured: null };
  const route = x.withWalk(base, w);
  assert(!x.walkHasMeasure(route), "no tape yet");
  const taped = { ...route, buildings: [{ ...route.buildings[0], tapes: [{ id: "t", kind: "line", photo: "s1", a: [10, 10], b: [90, 10], feet: 3, what: "window" }] }] };
  assert(x.walkHasMeasure(taped), "a window across its frame");
  const sum = x.walkSummary(taped);
  assert(JSON.stringify(sum) === JSON.stringify({ photos: 7, corners: 4, inside: 0, joined: 0, sidesSkipped: 1, measures: 1 }), JSON.stringify(sum));
  // A photo taken back goes with its corner taps and its tapes.
  const gone = x.withoutPhotos({ ...taped, buildings: [{ ...taped.buildings[0], corners: [{ photo: "s1", corner: -1, x: 1, y: 1 }] }] }, ["s1"]);
  assert(!gone.photos.some((p) => p.id === "s1") && gone.buildings[0].corners.length === 0 && !x.walkHasMeasure(gone), JSON.stringify(gone.buildings[0]));
});

test("each photo tagged with its place on the walk; once round, its shot on the lap's shape - the whole front as a run when it has steps", () => {
  // The owner's twelve corners walked from the garage's right-hand front corner: the porch wall, the keystone wall and the
  // garage's west bay all face the street, and the walk goes on round them to the bay step before it's back.
  const turns = [1, 1, 1, -1, 1, -1, 1, 1, -1, 1, -1, 1];
  const steps = ["front", "skip"];
  turns.forEach((t, i) => {
    steps.push(t < 0 ? "inside" : `c${i + 1}`);
    if (i < 11) steps.push(`s${i + 1}`, "skip");
  });
  steps.push("close");
  const { w } = walkThrough(steps);
  const route = x.withWalk({ format: "scrivn-photo-route/1", photos: x.walkPhotos(w).map((p) => ({ id: p.photo, width: 800, height: 600 })), buildings: [{ id: "main", outline: [], corners: [], tapes: [] }], measured: null }, w);
  const shot = Object.fromEntries(route.photos.map((p) => [p.id, p.shot]));
  const tag = Object.fromEntries(route.photos.map((p) => [p.id, p.walk]));
  assert(JSON.stringify(tag.front) === '{"role":"front","k":0}' && JSON.stringify(tag.c1) === '{"role":"corner","k":1,"corner":"outside"}' && JSON.stringify(tag.s4) === '{"role":"side","k":4}', JSON.stringify(tag));
  // The walk's corner k is the plan's corner k (index k - 1); side k its wall from corner k; the front the run from the
  // corner where the walk first faced the street again (8, the porch's left end) round to corner 1.
  assert(JSON.stringify(shot.c1) === '{"kind":"corner","index":0}' && JSON.stringify(shot.c12) === '{"kind":"corner","index":11}', JSON.stringify(shot));
  assert(JSON.stringify(shot.s4) === '{"kind":"wall","index":3}' && JSON.stringify(shot.front) === '{"kind":"run","index":7,"to":0}', `${JSON.stringify(shot.s4)} ${JSON.stringify(shot.front)}`);
  assert(!("c4" in shot) && !("c6" in shot), "the inside corners took no photo: their sides' photos show them");
  // A rectangle's front is a plain wall shot: the last side, from corner 4 round to corner 1.
  const rect = walkThrough(["front", "skip", "c1", "s1", "skip", "c2", "s2", "skip", "c3", "s3", "skip", "c4", "close"]).w;
  assert(JSON.stringify(x.walkShot({ role: "front", k: 0 }, rect)) === '{"kind":"wall","index":3}', JSON.stringify(x.walkShot({ role: "front", k: 0 }, rect)));
  // Taken back off the end of the lap, the photos keep their places but lose their shots.
  const opened = x.withWalk(route, x.walkBack(w).walk);
  assert(opened.photos.every((p) => p.walk && !p.shot), "no shots on an open lap");
});

test("a semi walked: at corner 1, joined to the neighbour, the front at an angle from that end; the shared wall put in, the back at an angle from its far end", () => {
  const { w, seen } = walkThrough(["front", "skip", "joined", "a1", "a2", "s2", "skip", "c3", "s3", "skip", "c4", "close"]);
  assert(seen.slice(2).join(" ") === "corner1 corner1 corner2 side2 measure:side2 corner3 side3 measure:side3 corner4 side4", seen.slice(2).join(" "));
  assert(x.lapCloses(w) && x.lapTurns(w).join() === "1,1,1,1" && x.walkPhotos(w).length === 7, x.lapTurns(w).join());
  const route = x.withWalk({ format: "scrivn-photo-route/1", photos: x.walkPhotos(w).map((p) => ({ id: p.photo, width: 800, height: 600 })), buildings: [{ id: "main", homeType: "semi", outline: [], corners: [], tapes: [] }], measured: null }, w);
  const b = route.buildings[0];
  // The right side (corner 1 to 2) is the neighbour's party wall.
  assert(JSON.stringify(b.shared) === "[0]" && b.outline.length === 4, JSON.stringify(b));
  assert([...x.partyCorners(4, b.shared)].sort().join() === "0,1", "both its ends");
  // Each angled photo is its open wall's: the front (corner 4 round to 1), the back (corner 2 to 3).
  const p = Object.fromEntries(route.photos.map((q) => [q.id, q]));
  assert(JSON.stringify(p.a1.walk) === '{"role":"corner","k":1,"corner":"joined","wall":"before"}' && JSON.stringify(p.a1.shot) === '{"kind":"wall","index":3}', JSON.stringify(p.a1));
  assert(JSON.stringify(p.a2.walk) === '{"role":"corner","k":2,"corner":"joined","wall":"after"}' && JSON.stringify(p.a2.shot) === '{"kind":"wall","index":1}', JSON.stringify(p.a2));
  assert(x.walkPhotoWords(p.a1.walk, w) === "the front at an angle, from where it meets the neighbour's" && x.walkPhotoWords(p.a2.walk, w) === "the back at an angle, from where it meets the neighbour's", x.walkPhotoWords(p.a2.walk, w));
  // Back: the far end's photo, then the near end's with the shared wall, then the turn.
  const at = walkThrough(["front", "skip", "joined", "a1", "a2"]).w;
  const b1 = x.walkBack(at);
  assert(b1.dropped.join() === "a2" && JSON.stringify(x.walkStep(b1.walk)) === '{"kind":"corner","k":2}', JSON.stringify(x.walkStep(b1.walk)));
  const b2 = x.walkBack(b1.walk);
  assert(b2.dropped.join() === "a1" && b2.walk.stops.length === 2 && JSON.stringify(x.walkStep(b2.walk)) === '{"kind":"corner","k":1}', JSON.stringify(b2.walk.stops));
  const b3 = x.walkBack(b2.walk);
  assert(b3.walk.stops.length === 1 && x.walkStep(b3.walk).kind === "corner", JSON.stringify(b3.walk.stops));
  // Passed by, the angled photo still puts the shared wall in.
  const passed = x.walkSkip(walkThrough(["front", "skip", "joined"]).w);
  assert(passed.stops.length === 4 && passed.stops[2].shared && x.walkStep(passed).k === 2, JSON.stringify(passed.stops));
});

test("a middle townhouse walked: two angled photos of the front and two of the back, as Hover asks, both side walls shared", () => {
  const { w } = walkThrough(["front", "skip", "joined", "fR", "bR", "back", "skip", "joined", "bL", "fL", "close"]);
  assert(x.lapCloses(w) && x.lapTurns(w).join() === "1,1,1,1", x.lapTurns(w).join());
  const tags = x.walkPhotos(w).map((p) => `${p.photo}:${x.walkPhotoWords(p.tag, w)}`);
  assert(
    tags.join(" | ") ===
      "front:the front | fR:the front at an angle, from where it meets the neighbour's | bR:the back at an angle, from where it meets the neighbour's | back:the back (side 2) | bL:the back at an angle, from where it meets the neighbour's | fL:the front at an angle, from where it meets the neighbour's",
    tags.join(" | "),
  );
  const route = x.withWalk({ format: "scrivn-photo-route/1", photos: x.walkPhotos(w).map((p) => ({ id: p.photo, width: 800, height: 600 })), buildings: [{ id: "main", homeType: "town_middle", outline: [], corners: [], tapes: [] }], measured: null }, w);
  assert(JSON.stringify(route.buildings[0].shared) === "[0,2]", JSON.stringify(route.buildings[0].shared));
  const shots = route.photos.map((q) => `${q.id}=${q.shot.kind}${q.shot.index}`).join(" ");
  assert(shots === "front=wall3 fR=wall3 bR=wall1 back=wall1 bL=wall1 fL=wall3", shots);
});

test("a photo turned upright has the focal of one held sideways: f over the picture's long side", () => {
  // The same phone: 24 mm equivalent, 2000 x 1500 sideways, 1500 x 2000 upright.
  near(x.focalOverWidth(24, 1500, 2000), x.focalOverWidth(24, 2000, 1500), "upright as sideways", 1e-12);
  near(x.focalOverWidth(24, 2000, 1500) * 2000, (24 / 43.27) * 2500, "f in pixels from the diagonal", 1e-9);
  assert(x.longSide({ width: 1500, height: 2000 }) === 2000 && x.longSide({ width: 2000, height: 1500 }) === 2000, "the long side");
});

test("a shape drawn by hand: the lap laid on it where its turns and its front agree; a corner more and it isn't", () => {
  const turns = [1, 1, 1, -1, 1, 1];
  // An L drawn starting anywhere: the front-left corner first.
  const drawn = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 35 }, { x: 10, y: 35 }, { x: 10, y: 25 }, { x: 0, y: 25 }];
  const r = x.alignLap(turns, drawn);
  // The walk's corner 1 (the front's right end) is the drawing's corner 1, index 1.
  assert(r === 1, `shift ${r}`);
  assert(x.alignLap(turns, [...drawn.slice(0, 3), { x: 30, y: 35 }, { x: 30, y: 45 }, ...drawn.slice(3)]) === null, "a corner more");
  const { w } = walkThrough(["front", "skip", "c1", "s1", "skip", "c2", "s2", "skip", "c3", "s3", "skip", "inside", "s4", "skip", "c5", "s5", "skip", "c6", "close"]);
  const route = x.withWalk({ format: "scrivn-photo-route/1", photos: x.walkPhotos(w).map((p) => ({ id: p.photo, width: 800, height: 600 })), buildings: [{ id: "main", outline: drawn, corners: [], tapes: [] }], measured: null }, w);
  const shots = Object.fromEntries(route.photos.map((p) => [p.id, p.shot]));
  assert(route.buildings[0].outline === drawn && !route.buildings[0].outlineFrom, "the drawing kept");
  assert(JSON.stringify(shots.c1) === '{"kind":"corner","index":1}' && JSON.stringify(shots.c6) === '{"kind":"corner","index":0}' && JSON.stringify(shots.front) === '{"kind":"wall","index":0}', JSON.stringify(shots));
  // The lap's own shape, redrawn - here by the Scrivn team, a corner moved, the mark left on - is a drawing: the walk
  // doesn't put its rough shape back over it, and it isn't held loosely.
  const own = x.withWalk({ ...route, buildings: [{ id: "main", outline: [], corners: [], tapes: [] }] }, w);
  assert(x.isWalkShape(own.buildings[0]), "the lap's shape, as made");
  const moved = own.buildings[0].outline.map((p, i) => (i === 2 ? { x: p.x + 9, y: p.y } : i === 1 ? { x: p.x + 9, y: p.y } : p));
  const edited = { ...own, buildings: [{ ...own.buildings[0], outline: moved }] };
  assert(!x.isWalkShape(edited.buildings[0]), "redrawn");
  assert(x.withWalk(edited, w).buildings[0].outline === moved, "kept as redrawn");
});

test("what a photo of the walk names: a 45 its corner and its walls' far ends, a side its two, the front its ends (all, when as many), an inside wall by tap order", () => {
  // Taps at x, in the order tapped, on a 800-wide photo of a 6-cornered shape.
  const n = 6;
  assert(x.shotNumbers({ kind: "corner", index: 2 }, [{ x: 400 }, { x: 100 }, { x: 700 }], 800, n, true).join() === "2,1,3", "the corner in the middle, the far end of each wall either side");
  assert(x.shotNumbers({ kind: "corner", index: 0 }, [{ x: 420 }, { x: 760 }], 800, n, true).join() === "0,1", "and only those it shows");
  // Taken from the checklist, which asks for every corner in sight: only the one in the middle.
  assert(x.shotNumbers({ kind: "corner", index: 2 }, [{ x: 400 }, { x: 100 }, { x: 700 }], 800, n).join() === "2,-1,-1", "the checklist's 45");
  assert(x.shotNumbers({ kind: "wall", index: 5 }, [{ x: 600 }, { x: 150 }], 800, n).join() === "0,5", "a side: left end, right end");
  assert(x.shotNumbers({ kind: "run", index: 3, to: 0 }, [{ x: 50 }, { x: 300 }, { x: 500 }, { x: 750 }], 800, n).join() === "3,4,5,0", "the front: all its corners, as many as tapped");
  assert(x.shotNumbers({ kind: "run", index: 3, to: 0 }, [{ x: 50 }, { x: 500 }, { x: 750 }], 800, n).join() === "3,-1,0", "fewer: its ends");
  assert(x.shotNumbers({ kind: "inside", index: 3, wall: "before" }, [{ x: 700 }, { x: 100 }], 800, n).join() === "3,2", "the inside corner first, then the wall's other end");
});

/**
 * Made-up photos of a house of known shape, taken as the walk asks, the corners tapped as it asks (the photo route's
 * synthetic camera above: level, 5' up, the owner's lens; a blank grey, so taps stay put; no wall edges).
 */
function walkPhotosOf(truth, noisePx = 0) {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const noise = () => noisePx * Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const n = truth.length;
  const outwardOf = (A, B) => {
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    return { x: (B.y - A.y) / L, y: -(B.x - A.x) / L };
  };
  const crosses = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  const photos = [];
  const shoot = (id, at, look) => {
    const p = synPhoto(id, at, look);
    const C = { x: at[0], y: at[1] };
    // The corners it shows: in the frame, ahead, nothing of the house in the way, one of its walls facing the camera.
    const shows = (c) => {
      const P = truth[c];
      const t = p.tap(P);
      if (!(t.x > 0.05 * SYN.W && t.x < 0.95 * SYN.W) || !((P.x - at[0]) * (look.x - at[0]) + (P.y - at[1]) * (look.y - at[1]) > 0)) return false;
      for (let i = 0; i < n; i++) if (i !== c && (i + 1) % n !== c && crosses(C, P, truth[i], truth[(i + 1) % n])) return false;
      const faces = (A, B) => {
        const o = outwardOf(A, B);
        return (C.x - A.x) * o.x + (C.y - A.y) * o.y > 0;
      };
      return faces(truth[(c - 1 + n) % n], P) || faces(P, truth[(c + 1) % n]);
    };
    photos.push({ id, data: p.data, tap: (P) => ({ x: p.tap(P).x + noise(), y: p.tap(P).y + noise() }), shows });
  };
  const turns = x.ringTurns(truth);
  let w = x.newWalk();
  const xs = truth.map((p) => p.x);
  const ys = truth.map((p) => p.y);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  shoot("front", [mid, Math.min(...ys) - 1.1 * (Math.max(...xs) - Math.min(...xs))], { x: mid, y: Math.min(...ys) });
  w = x.walkSkip(x.walkTake(w, "front"));
  const straightOn = (id, i) => {
    const [a, b] = [truth[i], truth[(i + 1) % n]];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const o = outwardOf(a, b);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    shoot(id, [m.x + o.x * Math.max(20, 1.1 * L), m.y + o.y * Math.max(20, 1.1 * L)], m);
  };
  for (let k = 1; k <= n; k++) {
    const c = k - 1;
    if (turns[c] < 0) {
      w = x.walkTurn(w, "inside");
      if (x.walkStep(w).kind === "inside") {
        straightOn(`in${k}`, (c - 1 + n) % n);
        w = x.walkTake(w, `in${k}`);
      }
    } else {
      const P = truth[c];
      const n1 = outwardOf(truth[(c - 1 + n) % n], P);
      const n2 = outwardOf(P, truth[(c + 1) % n]);
      const bl = Math.hypot(n1.x + n2.x, n1.y + n2.y);
      shoot(`c${k}`, [P.x + (30 * (n1.x + n2.x)) / bl, P.y + (30 * (n1.y + n2.y)) / bl], P);
      w = x.walkTake(w, `c${k}`);
    }
    if (k === n) break;
    const [a, b] = [truth[c], truth[(c + 1) % n]];
    // A wall too short to stand back from (the 2' bay step, the bump-out's 5'6" side) passed by.
    if (Math.hypot(b.x - a.x, b.y - a.y) < 6) w = x.walkSkip(x.walkSkip(w));
    else {
      straightOn(`s${k}`, c);
      w = x.walkSkip(x.walkTake(w, `s${k}`));
    }
  }
  w = x.walkClose(w);
  // The corners tapped on each, as the walk asks: the front's; a corner and its walls' far ends; a side's two ends; an
  // inside corner's wall the inside corner first.
  const asked = (tag, shot) => {
    if (tag.role === "front") return shot.kind === "run" ? [...Array(n).keys()].filter((c) => inRun(shot, c, n)) : [shot.index, (shot.index + 1) % n];
    if (tag.role === "side") return [tag.k - 1, tag.k % n];
    if (tag.corner === "inside") return [tag.k - 1, (tag.k - 2 + n) % n];
    return [tag.k - 1, (tag.k - 2 + n) % n, tag.k % n];
  };
  const route0 = { format: "scrivn-photo-route/1", photos: photos.map((p, i) => ({ id: p.id, width: SYN.W, height: SYN.H, takenAt: i * 10000 })), buildings: [{ id: "main", outline: [], corners: [], tapes: [] }], measured: null };
  const route = x.withWalk(route0, w);
  const truthOf = [];
  const corners = route.photos.flatMap((rp) => {
    const p = photos.find((q) => q.id === rp.id);
    return asked(rp.walk, rp.shot)
      .filter((c) => p.shows(c))
      .map((c) => (truthOf.push(c), { photo: p.id, corner: -1, ...p.tap(truth[c]) }));
  });
  return { walk: w, route: { ...route, buildings: [{ ...route.buildings[0], corners }] }, data: photos.map((p) => p.data), truthOf };
}
const inRun = (shot, c, n) => {
  for (let k = shot.index, i = 0; i < n; k = (k + 1) % n, i++) {
    if (k === c) return true;
    if (k === shot.to) return false;
  }
  return false;
};

/** The owner's house as taped (README, 10-16), from the garage's right-hand front corner round: his twelve sides. */
const OWNER_SIDES = [70.58, 22.17, 5.5, 15.25, 9.08, 11.42, 29.17, 22.0, 24.83, 13.33, 2, 13.5];
const OWNER_WAYS = [1, 2, 3, 2, 3, 2, 3, 0, 3, 0, 3, 0];
const OWNER_TRUE = OWNER_SIDES.slice(0, -1).reduce(
  (ring, L, i) => {
    const p = ring[ring.length - 1];
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][OWNER_WAYS[i]];
    return [...ring, { x: p.x + dx * L, y: p.y + dy * L }];
  },
  [{ x: 26.83, y: -2 }],
);

test("the owner's house walked as the walk asks (made-up photos, its true shape): every tap named by its photo's role, every photo placed, the sides within 3% on average", () => {
  // Taps where the corners are, and 1.5 px off either way (about 4 px on a photo as Scrivn keeps it, 2,000 px wide).
  for (const noisePx of [0, 1.5]) {
    const { walk, route, data, truthOf } = walkPhotosOf(OWNER_TRUE, noisePx);
    const b = route.buildings[0];
    assert(x.lapCloses(walk) && b.outlineFrom === "walk" && b.outline.length === 12, "the lap closes, the shape is the walk's");
    // Taped as the walk asks: one thing on the front, here the garage's east bay corner to corner (13'6").
    const input = { ...route, buildings: [{ ...b, tapes: [{ id: "bay", kind: "side", from: 11, feet: 13.5 }] }] };
    const named = x.numberCorners(input, "main", data);
    const wrong = named.filter((c, i) => c.corner !== truthOf[i]);
    assert(wrong.length === 0, `${wrong.length} of ${named.length} named wrong`);
    const sol = x.solveRoute({ ...input, buildings: [{ ...input.buildings[0], corners: named }] }, "main", data);
    assert(sol.cameras.length === route.photos.length, `${sol.cameras.length} of ${route.photos.length} placed: ${JSON.stringify(sol.unplaced)}`);
    const off = sol.sides.map((s, i) => (s.lengthFeet / OWNER_SIDES[i] - 1) * 100);
    const mean = off.reduce((a, e) => a + Math.abs(e), 0) / off.length;
    // Corners alone (made-up photos have no window edges): within 5%, or 9" on a short wall, and 3% on average.
    const bad = sol.sides.filter((s, i) => Math.abs(off[i]) > 5 && Math.abs(s.lengthFeet - OWNER_SIDES[i]) > 0.75);
    assert(bad.length === 0 && mean < 3 && Math.abs(off[0]) < 4, `taps ${noisePx}px off: mean ${mean.toFixed(1)}%, the side-yard wall ${off[0].toFixed(1)}%: ${sol.sides.map((s, i) => `${s.lengthFeet.toFixed(2)} (${off[i].toFixed(1)}%)`).join(" ")}`);
    // Held to the lap's rough sizes as tightly as a shape drawn by hand (35%), it isn't: why a walk's shape is held loosely.
    const tight = x.solveRoute({ ...input, buildings: [{ ...input.buildings[0], corners: named }] }, "main", data, { holdPct: 0.35 });
    const tightMean = tight.sides.reduce((a, s, i) => a + Math.abs(s.lengthFeet / OWNER_SIDES[i] - 1) * 100, 0) / 12;
    assert(tightMean > 2 * mean && tightMean > 8, `held at 35%: mean ${tightMean.toFixed(1)}%`);
    console.log(`      taps ${noisePx}px off: ${sol.cameras.length} photos placed, sides off ${mean.toFixed(1)}% on average (held at 35%: ${tightMean.toFixed(1)}%), the side-yard wall ${off[0].toFixed(1)}%`);
  }
});

console.log("\nthe walk's measurements typed, not drawn (10-21, second build)");

const walkRoute = (w, main = {}) => x.withWalk({ format: "scrivn-photo-route/1", photos: x.walkPhotos(w).map((p) => ({ id: p.photo, width: 800, height: 600 })), buildings: [{ id: "main", outline: [], corners: [], tapes: [], ...main }], measured: null }, w);

test("did you measure anything here: asked at the front and every side, a side too tight for a photo asked its length; typed, one tap at most, never a line", () => {
  // The front: the step names its photo. A garage door typed with a rough tap on it.
  let w = x.walkTake(x.newWalk(), "front");
  assert(JSON.stringify(x.walkStep(w)) === '{"kind":"measure","stop":0,"role":"front","k":0,"photo":"front"}', JSON.stringify(x.walkStep(w)));
  w = x.walkAddMeasure(w, 0, { id: "walk-g", what: "garage", feet: 16, photo: "front", near: [412, 380] });
  assert(x.walkStep(w).kind === "measure", "still at it: something else can be measured here");
  w = x.walkMeasured(w);
  assert(w.stops[0].measure === "done" && x.walkStep(w).kind === "corner", JSON.stringify(w.stops[0]));
  // A side too tight to photograph: its length asked, with no photo to tap on.
  w = x.walkSkip(x.walkTake(w, "c1"));
  assert(JSON.stringify(x.walkStep(w)) === '{"kind":"measure","stop":2,"role":"side","k":1,"photo":null}', JSON.stringify(x.walkStep(w)));
  w = x.walkMeasured(x.walkAddMeasure(w, 2, { id: "walk-w", what: "wall", feet: 68.5 }));
  // Passed by with nothing in: "skipped", not "done".
  w = x.walkTake(w, "c2");
  w = x.walkMeasured(x.walkTake(w, "s2"));
  assert(w.stops[4].measure === "skipped" && x.walkStep(w).kind === "corner", JSON.stringify(w.stops[4]));
  // No size, no measurement.
  assert(x.walkAddMeasure(w, 4, { id: "walk-0", what: "window", feet: 0 }) === w, "a size of nothing is not put in");
  const all = x.walkMeasures(w).map(({ m, kind, k }) => `${kind}${k}:${x.measureWords(m)}`);
  assert(all.join() === "front0:Garage door 16',side1:Wall 68'6\"", all.join());
  assert(x.measureWords({ what: "window", feet: 70.75 / 12 }) === "Window 5'10¾\"" && x.measureWords({ what: "door", feet: 0.375 }) === "Door 0'4½\"", "to the eighth typed, not rounded to the inch");
  // Taken out, wherever it is; Back from the corner after it asks the side again, its measurement still there.
  assert(x.walkMeasures(x.walkRemoveMeasure(w, "walk-g")).length === 1, "removed");
  const back = x.walkBack(x.walkBack(x.walkBack(x.walkBack(w).walk).walk).walk).walk;
  assert(x.walkStep(back).kind === "measure" && x.walkStep(back).stop === 2 && back.stops[2].measures.length === 1, JSON.stringify(x.walkStep(back)));
  // Back past it takes the side and its measurement with it.
  assert(x.walkMeasures(x.walkBack(back).walk).length === 1, "the wall's length went with its side");
});

test("one measurement before finishing: a garage door typed counts; until its ends are placed it is no tape, and the walk says so", () => {
  const steps = ["front", "skip", "c1", "s1", "skip", "c2", "s2", "skip", "c3", "s3", "skip", "c4", "close"];
  const { w } = walkThrough(steps);
  assert(!x.walkHasMeasure(walkRoute(w)), "nothing measured");
  const typed = x.walkAddMeasure(w, 0, { id: "walk-g", what: "garage", feet: 9, photo: "front" });
  const route = walkRoute(typed);
  assert(x.walkHasMeasure(route) && route.buildings[0].tapes.length === 0, "the garage door counts, and is no tape yet");
  assert(x.walkUnplaced(route).map(({ m }) => m.id).join() === "walk-g", "its ends to place");
  assert(x.walkSummary(route).measures === 1, JSON.stringify(x.walkSummary(route)));
  // Placed on a bigger screen (the route's "Place it"): a line tape with the measurement's id, and nothing left to place.
  const placed = { ...route, buildings: [{ ...route.buildings[0], tapes: [{ id: "walk-g", kind: "line", photo: "front", a: [300, 400], b: [520, 400], feet: 9, what: "garage" }] }] };
  assert(x.walkUnplaced(placed).length === 0 && x.walkSummary(placed).measures === 1, "placed: counted once");
});

test("a wall's length typed on the walk is its side's tape once the lap closes: a side's own wall, a plain front; a front with steps waits to be placed", () => {
  // A rectangle: the right side (walk side 1) taped 68'6" with no photo, the front 40' corner to corner.
  let { w } = walkThrough(["front", "skip", "c1", "skip", "skip", "c2", "s2", "skip", "c3", "s3", "skip", "c4"]);
  w = x.walkAddMeasure(w, 0, { id: "walk-f", what: "wall", feet: 40, photo: "front" });
  w = x.walkAddMeasure(w, 2, { id: "walk-r", what: "wall", feet: 68.5 });
  const open = walkRoute(w);
  assert(open.buildings[0].tapes.length === 0, "lap not closed: no side yet");
  const closed = walkRoute(x.walkClose(w));
  const tapes = closed.buildings[0].tapes.map((t) => `${t.id}:${t.kind}:${t.from}:${t.feet}`).sort();
  // Walk side 1 is outline side 0 (corner 1 to 2); the front the last side, 3.
  assert(tapes.join() === "walk-f:side:3:40,walk-r:side:0:68.5", tapes.join());
  assert(x.walkUnplaced(closed).length === 0, "nothing to place");
  // Made again each time, not piled up; and gone when the lap opens again.
  const again = x.withWalk(closed, closed.walk);
  assert(again.buildings[0].tapes.length === 2, JSON.stringify(again.buildings[0].tapes));
  const reopened = x.withWalk(closed, x.walkBack(closed.walk).walk);
  assert(reopened.buildings[0].tapes.length === 0, "opened: no side tapes");
  // The owner's twelve: the front a run of walls, so its wall's length isn't put on any one of them.
  const turns = [1, 1, 1, -1, 1, -1, 1, 1, -1, 1, -1, 1];
  const steps = ["front", "skip"];
  turns.forEach((t, i) => {
    steps.push(t < 0 ? "inside" : `c${i + 1}`);
    if (i < 11) steps.push(`s${i + 1}`, "skip");
  });
  steps.push("close");
  const run = walkThrough(steps).w;
  const r12 = walkRoute(x.walkAddMeasure(run, 0, { id: "walk-f", what: "wall", feet: 48.9, photo: "front" }));
  assert(r12.buildings[0].tapes.length === 0 && x.walkUnplaced(r12).length === 1, "a front with steps: to place");
});

test("no home type asked: a corner said to join the neighbour's is a semi, two a middle townhouse, none detached", () => {
  const semi = walkThrough(["front", "skip", "joined", "a1", "a2", "s2", "skip", "c3", "s3", "skip", "c4", "close"]).w;
  const r1 = walkRoute(semi);
  assert(r1.buildings[0].homeType === "semi" && JSON.stringify(r1.buildings[0].shared) === "[0]", JSON.stringify(r1.buildings[0]));
  const middle = walkThrough(["front", "skip", "joined", "fR", "bR", "back", "skip", "joined", "bL", "fL", "close"]).w;
  const r2 = walkRoute(middle);
  assert(r2.buildings[0].homeType === "town_middle" && JSON.stringify(r2.buildings[0].shared) === "[0,2]", JSON.stringify(r2.buildings[0]));
  // Taken back to before the joined corner: no longer attached.
  const backed = x.withWalk(r1, walkThrough(["front", "skip"]).w);
  assert(backed.buildings[0].homeType === "semi", "no corner yet: as it was");
  const detached = x.withWalk(r1, walkThrough(["front", "skip", "c1", "s1"]).w);
  assert(detached.buildings[0].homeType === "detached", detached.buildings[0].homeType);
  // An end unit said so stays one; a split-level is the house's own say.
  assert(x.walkHomeType(semi, "town_end") === "town_end" && x.walkHomeType(walkThrough(["front", "skip", "c1"]).w, "split") === "split", "kept");
});

console.log("\nwalls no photo faces (10-21)");

/** A 40' x 30' house measured from photos: a photo laid on the front and the right side only. */
function photoHouse() {
  const e = x.exteriorFromOutline([P(0, 0), P(40, 0), P(40, 30), P(0, 30)]);
  const photo = { n: 900, scanId: null, claimPhotoId: "p1", camera: { width: 2000, height: 1500, fx: 1500, fy: 1500, cx: 1000, cy: 750 }, toPhoto: [1, 0, 0, 0, 1, 0, 0, 0, 1], inView: null };
  const front = e.sides.findIndex((s) => /front/i.test(s.name));
  const withPhoto = new Set([front, (front + 1) % 4]);
  return {
    ...e,
    source: { kind: "photos", by: "photos", captureId: null, scanId: null, receivedAt: null, notes: [], walkClosed: true },
    sides: e.sides.map((s, i) => (withPhoto.has(i) ? { ...s, eaveLeftFeet: 9, eaveRightFeet: 9, photos: [photo] } : { ...s, eaveLeftFeet: 9, eaveRightFeet: 9 })),
  };
}

test("a wall no photo faces is 'not photographed' on a house measured from photos - never on one from Scan or drawn, never a shared wall", () => {
  const e = photoHouse();
  const unseen = x.notPhotographedSides(e);
  assert(unseen.length === 2 && unseen.every((s) => !(s.photos ?? []).length), unseen.map((s) => s.name).join());
  assert(x.unseenState(e, unseen[0]) === "unknown" && x.unseenWords(e, unseen[0]) === "Not photographed: its windows and doors aren't known.", x.unseenWords(e, unseen[0]));
  assert(x.notPhotographedSides({ ...e, source: { ...e.source, kind: "scan", by: undefined } }).length === 0, "a scan's openings were put in at the house");
  assert(x.notPhotographedSides({ ...e, source: undefined }).length === 0, "nor one drawn by hand");
  const semi = { ...e, sides: e.sides.map((s) => (s.id === unseen[0].id ? { ...s, shared: true } : s)) };
  assert(x.notPhotographedSides(semi).length === 1, "a shared wall is the neighbour's, not unseen");
});

test("what the person at the house says is on it goes in: a common size, spaced along it, dashed and said to be not measured; None and 'not sure' too", () => {
  const e = photoHouse();
  const side = x.notPhotographedSides(e)[0];
  const said = x.withUnseenSaid(e, side.id, { windows: 2, doors: 1 });
  const s = said.sides.find((q) => q.id === side.id);
  const put = s.openings.filter((o) => o.from === "said");
  assert(put.length === 3 && put.map((o) => o.kind).join() === "door,window,window", put.map((o) => o.kind).join());
  assert(put.every((o) => o.fromLeftFeet >= 0 && o.fromLeftFeet + o.widthFeet <= s.lengthFeet) && put[1].fromLeftFeet > put[0].fromLeftFeet + put[0].widthFeet, JSON.stringify(put.map((o) => o.fromLeftFeet)));
  assert(put[0].heightFeet > 6.5 && put[0].sillFeet === 0 && put[1].sillFeet === 3 && put[1].widthFeet === 3, JSON.stringify(put[1]));
  assert(x.unseenState(said, s) === "said" && x.unseenWords(said, s) === "Not photographed: 2 windows and a door said on site, their sizes and places not measured.", x.unseenWords(said, s));
  // Said again, it replaces what was said; openings put in another way stay; null takes the answer back out.
  const own = { ...said, sides: said.sides.map((q) => (q.id === side.id ? { ...q, openings: [...q.openings, { id: "mine", kind: "window", widthFeet: 5, heightFeet: 4, sillFeet: 3, fromLeftFeet: 1 }] } : q)) };
  const again = x.withUnseenSaid(own, side.id, { windows: 1, doors: 0 }).sides.find((q) => q.id === side.id);
  assert(again.openings.length === 2 && again.openings.some((o) => o.id === "mine"), JSON.stringify(again.openings.map((o) => o.id)));
  const none = x.withUnseenSaid(e, side.id, { windows: 0, doors: 0 });
  assert(x.unseenState(none, none.sides.find((q) => q.id === side.id)) === "none" && x.unseenWords(none, none.sides.find((q) => q.id === side.id)) === "Not photographed: no windows or doors, said on site.", "none");
  const back = x.withUnseenSaid(said, side.id, null).sides.find((q) => q.id === side.id);
  assert(back.openings.length === 0 && back.unseenSaid === undefined, "unsure: back to not known");
  // Counted like any other opening: the wall's cladding comes down by them.
  const q0 = x.exteriorQuantities(e).sides.find((q) => q.sideId === side.id) ?? x.exteriorQuantities(e).sides[e.sides.indexOf(side)];
  const q1 = x.exteriorQuantities(said).sides[said.sides.findIndex((q) => q.id === side.id)];
  assert(q1.netSquareFeet < q0.netSquareFeet - 40, `${q0.netSquareFeet} -> ${q1.netSquareFeet}`);
});

test("the report and the house's views say 'not photographed' - a bare wall never reads as one with no windows", () => {
  const e = photoHouse();
  const side = x.notPhotographedSides(e)[0];
  const r = x.exteriorReport(e, { title: "t", date: "d", madeWith: "m" });
  const rs = r.sides.find((s) => s.side.id === side.id);
  assert(/not photographed$/.test(rs.heading) && rs.dims.includes("Not photographed: its windows and doors aren't known."), `${rs.heading} | ${rs.dims.join(" | ")}`);
  assert(r.notes.some((n) => n === `${side.name}: not photographed: its windows and doors aren't known. A photo of it straight on settles it.`), r.notes.join(" | "));
  assert(!r.sides.filter((s) => (s.side.photos ?? []).length).some((s) => /not photographed/.test(s.heading)), "the photographed sides say nothing");
  const said = x.exteriorReport(x.withUnseenSaid(e, side.id, { windows: 1, doors: 0 }), { title: "t", date: "d", madeWith: "m" });
  const line = said.sides.find((s) => s.side.id === side.id).dims.find((d) => /^Window/.test(d));
  assert(/\(said on site: size and place not measured\)/.test(line ?? ""), line);
  // The house from each side: the unseen walls marked on the views that show them.
  const m = x.exteriorModel(e);
  const walls = x.VIEWS.flatMap((v) => x.houseView(m.model, v).pieces.filter((p) => p.type === "wall"));
  const marked = new Set(walls.filter((w) => w.unseen).map((w) => w.sideId));
  assert(marked.size === 2 && marked.has(side.id) && walls.filter((w) => !w.unseen).every((w) => !x.notPhotographedSides(e).some((s) => s.id === w.sideId)), [...marked].join());
  // Said on site, the openings are on the views too, marked as said (drawn faint and dashed).
  const answered = x.exteriorModel(x.withUnseenSaid(e, side.id, { windows: 2, doors: 0 }));
  const onView = x.VIEWS.flatMap((v) => x.houseView(answered.model, v).pieces.filter((p) => p.type === "wall" && p.sideId === side.id));
  assert(onView.length > 0 && onView.every((w) => w.unseen === "said" && w.openings.length === 2 && w.openings.every((o) => o.said)), JSON.stringify(onView.map((w) => [w.unseen, w.openings])));
});

console.log("\nthe walk as a ring, in any order (10-22)");

test("the ring: corners said round from the front, photos on any wall or corner in any order, more of a wall as parts", () => {
  let w = x.withRingStart(x.newWalk());
  for (const t of ["outside", "outside", "outside", "outside"]) w = x.walkAddCorner(w, t);
  const labels = x.ringItems(w).map((i) => i.label);
  // Four outside corners close round: the wall after corner 4 is the front again, listed so (never hidden: 10-22).
  assert(labels.join(" | ") === "The front | Corner 1 | The right side | Corner 2 | The back | Corner 3 | The left side | Corner 4 | The front again, back to corner 1", labels.join(" | "));
  // Out of order: corner 3, the back twice (above and below the deck), then the front.
  const stopOf = (label) => x.ringItems(w).find((i) => i.label === label).stop;
  w = x.walkAddPhoto(w, stopOf("Corner 3"), "c3");
  w = x.walkAddPhoto(w, stopOf("The back"), "b1");
  w = x.walkAddPhoto(w, stopOf("The back"), "b2");
  w = x.walkAddPhoto(w, stopOf("The front"), "f");
  const tags = Object.fromEntries(x.walkPhotos(w).map((p) => [p.photo, p.tag]));
  assert(JSON.stringify(tags.b1) === '{"role":"side","k":2}' && JSON.stringify(tags.b2) === '{"role":"side","k":2,"part":true}' && tags.c3.k === 3, JSON.stringify(tags));
  assert(x.walkPhotoWords(tags.b2, w) === "more of the back (side 2)" && x.walkShot(tags.b2, w) === null && x.walkShot(tags.b1, w).kind === "wall", "a part names no corners");
  // What's missing, plainly; nothing forces the next step.
  assert(x.walkMissing({ walk: w, photos: [], buildings: [{ id: "main", outline: [], corners: [], tapes: [] }] }) === "No photo yet of the right side, the left side, corner 1, corner 2 and corner 4. No measurement yet: one sets the scale for everything, one a wall is better.", x.walkMissing({ walk: w, photos: [], buildings: [{ id: "main", outline: [], corners: [], tapes: [] }] }));
  // Finished: the ring closes round (a photo put on the wall after corner 4 is the front's), and the shape is the corners'.
  w = x.walkAddPhoto(w, w.stops.length - 1, "f2");
  const done = x.walkFinish(w);
  assert(done.closed && done.stops.length === 8 && done.stops[0].photos.join() === "f,f2", JSON.stringify(done.stops.map((s) => s.photos)));
  const route = x.withWalk({ format: "scrivn-photo-route/1", photos: ["c3", "b1", "b2", "f", "f2"].map((id) => ({ id, width: 800, height: 600 })), buildings: [{ id: "main", outline: [], corners: [], tapes: [] }], measured: null }, done);
  assert(route.buildings[0].outlineFrom === "walk" && route.buildings[0].outline.length === 4, JSON.stringify(route.buildings[0].outline));
  // Back to the walk: open again, the wall after the last corner there again.
  const again = x.walkReopen(done);
  assert(!again.closed && again.stops.length === 9 && again.stops[8].kind === "side", JSON.stringify(again.stops.map((s) => s.kind)));
});

test("the ring: a corner taken back takes its wall's photos; joining the neighbour puts in the shared wall; photos taken out; corners that don't close are said", () => {
  let w = x.walkAddCorner(x.withRingStart(x.newWalk()), "joined");
  assert(x.ringItems(w).map((i) => i.label).join(" | ") === "The front | Corner 1 (joins the neighbour) | The right side: shared with the neighbour | Corner 2 (the neighbour's far end) | The back", x.ringItems(w).map((i) => i.label).join(" | "));
  w = x.walkAddPhoto(w, w.stops.length - 1, "back");
  assert(x.walkAddPhoto(w, 2, "nope") === w, "nothing goes on a shared wall");
  const back = x.walkRemoveLastCorner(w);
  assert(back.walk.stops.length === 1 && back.dropped.join() === "back", JSON.stringify(back));
  // Three corners and back to the front: said, and Finish still there.
  let three = x.withRingStart(x.newWalk());
  for (const t of ["outside", "outside", "outside"]) three = x.walkAddCorner(three, t);
  assert(/Fewer than four corners so far/.test(x.walkMissing({ walk: three, photos: [], buildings: [{ id: "main", outline: [], corners: [], tapes: [{ id: "t", kind: "side", from: 0, feet: 9 }] }] })), "said");
  assert(x.walkFinish(three).closed && x.walkFinish(three).stops.length === 7, "finished anyway, as it stands");
  // A photo taken out leaves a measurement on it its size, not its place.
  let m = x.walkAddPhoto(x.withRingStart(x.newWalk()), 0, "f");
  m = x.walkAddMeasure(m, 0, { id: "walk-a", what: "garage", feet: 9, photo: "f", near: [1, 2], tapePhoto: "tape" });
  const out = x.walkRemovePhoto(m, "f");
  assert(out.stops[0].photos.length === 0 && JSON.stringify(out.stops[0].measures[0]) === '{"id":"walk-a","what":"garage","feet":9,"tapePhoto":"tape"}', JSON.stringify(out.stops[0]));
});

test("any number of corners (10-22): the owner's twelve said round, every wall named plainly; a corner put in partway along a wall, said again as another kind, or taken out anywhere", () => {
  // His house from the garage's right-hand front corner (the 10-22 walk stopped him at four: they closed round as said).
  const turns = ["outside", "outside", "outside", "inside", "outside", "inside", "outside", "outside", "inside", "outside", "inside", "outside"];
  let w = x.withRingStart(x.newWalk());
  for (const t of turns) w = x.walkAddCorner(w, t);
  const walls = x.ringItems(w).filter((i) => i.kind === "wall").map((i) => i.label);
  assert(
    walls.join(" | ") ===
      "The front | The right side | The back | A jog in the back (faces left) | The back, part 2 | A jog in the back (faces left) | The back, part 3 | The left side | The front, part 2 | A jog in the front (faces left) | The front, part 3 | A jog in the front (faces left) | The front again, back to corner 1",
    walls.join(" | "),
  );
  assert(x.lapCloses(w) && x.ringItems(w).filter((i) => i.kind === "corner").length === 12, "twelve corners, closing");
  // Every wall and corner takes photos, the last too.
  for (const it of x.ringItems(w)) w = x.walkAddPhoto(w, it.stop, `p${it.stop}`);
  assert(x.walkPhotos(w).length === x.ringItems(w).length, `${x.walkPhotos(w).length} photos`);
  // Said as four outside corners (what he did), then fixed: corner 4 said inside after all, and a corner put in partway along the back.
  let four = x.withRingStart(x.newWalk());
  for (let i = 0; i < 4; i++) four = x.walkAddCorner(four, "outside");
  four = x.walkAddPhoto(four, 6, "back");
  const c4 = x.ringItems(four).find((i) => i.label === "Corner 4").stop;
  const fixed = x.walkSetTurn(four, c4, "inside").walk;
  assert(x.lapTurns(fixed).join() === "1,1,1,-1" && fixed.stops[6].photos.join() === "back", JSON.stringify(x.lapTurns(fixed)));
  const ins = x.walkInsertCorner(fixed, 4, "inside");
  assert(ins.stops.length === fixed.stops.length + 2 && ins.stops[5].kind === "corner" && ins.stops[5].turn === "inside" && ins.stops[6].kind === "side", JSON.stringify(ins.stops.map((s) => s.kind)));
  // Taken out anywhere: the wall after joins the wall before, photos and all; the corner's own photos listed.
  const r = x.walkAddPhoto(x.walkAddPhoto(ins, 5, "c-in"), 6, "jog");
  const out = x.walkRemoveCorner(r, 5);
  assert(out.dropped.join() === "c-in" && out.walk.stops.length === fixed.stops.length && out.walk.stops[4].photos.join() === "jog", JSON.stringify(out.walk.stops.map((s) => s.photos)));
  // Joining the neighbour, said on a corner already there: its shared wall and far corner go in; said otherwise, out again.
  const joined = x.walkSetTurn(four, 1, "joined").walk;
  assert(joined.stops.length === four.stops.length + 2 && joined.stops[2].shared && joined.stops[3].auto, JSON.stringify(joined.stops.map((s) => s.kind)));
  assert(x.walkSetTurn(joined, 3, "outside").walk.stops.length === four.stops.length, "the far corner's owner said outside");
  assert(x.walkRemoveCorner(joined, 3).walk.stops.length === four.stops.length - 2, "removing the far corner removes the joined one");
});


console.log("\ncleaner input: measure photos size the house, detail photos are read (10-22)");

// A plain 40' x 30' box drawn 44' x 27', far-back photos at each corner and the front, the front taped; and a close photo of
// one corner from the right side, said to be taken from somewhere it wasn't (12 ft off).
const BOX = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }];
const BOX_DRAWN = [{ x: 0, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 27 }, { x: 0, y: 27 }];
const boxShots = [
  ["front", [20, -50], { x: 20, y: 15 }, [{ c: 0 }, { c: 1 }]],
  ["front-right", [62, -22], { x: 40, y: 0 }, [{ c: 0 }, { c: 1 }, { c: 2 }]],
  ["back-right", [62, 52], { x: 40, y: 30 }, [{ c: 1 }, { c: 2 }, { c: 3 }]],
  ["back-left", [-22, 52], { x: 0, y: 30 }, [{ c: 2 }, { c: 3 }, { c: 0 }]],
  ["front-left", [-22, -22], { x: 0, y: 0 }, [{ c: 3 }, { c: 0 }, { c: 1 }]],
];
const withDetail = (standAt) => {
  const r = synRoute(BOX, BOX_DRAWN, "detached", [...boxShots, ["detail", [60, 8], { x: 40, y: 4 }, [{ c: 1 }]]], [{ id: "front", kind: "side", from: 0, feet: 40 }]);
  r.input.photos = r.input.photos.map((p) => (p.id === "detail" ? { ...p, standAt } : p));
  return r;
};
const lengths = (sol) => sol.sides.map((s) => s.lengthFeet.toFixed(6)).join(" ");

test("a photo with one corner never sizes the house: placed where you stood, afterwards, to be read; the old way kept to compare", () => {
  const base = synRoute(BOX, BOX_DRAWN, "detached", boxShots, [{ id: "front", kind: "side", from: 0, feet: 40 }]);
  const without = x.solveRoute(base.input, "main", base.data);
  for (const spot of [[66, 8], [72, -2], [56, 18]]) {
    const { input, data } = withDetail(spot);
    const sol = x.solveRoute(input, "main", data);
    assert(lengths(sol) === lengths(without), `stood at ${spot}: ${lengths(sol)} against ${lengths(without)}`);
    const cam = sol.cameras.find((c) => c.photo === "detail");
    assert(cam && cam.role === "detail" && cam.placedBy === "stood", JSON.stringify(cam));
    assert(sol.cameras.filter((c) => c.role !== "detail").length === 5 && !sol.unplaced.some((u) => u.photo === "detail"), JSON.stringify(sol.unplaced));
  }
  // The old way: it is in the size solve with the rest.
  const { input, data } = withDetail([72, -2]);
  const old = x.solveRoute(input, "main", data, { sizePhotos: "all" });
  const oc = old.cameras.find((c) => c.photo === "detail");
  assert(oc && oc.placedBy === "stood" && !oc.role && old.solution.input.cameras.some((c) => c.id === "detail"), JSON.stringify(oc));
});

test("a photo left out of the size (the self-check's) is still placed by its corners, to be read", () => {
  const { input, data } = synRoute(BOX, BOX_DRAWN, "detached", boxShots, [{ id: "front", kind: "side", from: 0, feet: 40 }]);
  const all = x.solveRoute(input, "main", data);
  const out = x.solveRoute(input, "main", data, { outOfSize: ["back-right"] });
  const cam = out.cameras.find((c) => c.photo === "back-right");
  assert(cam && cam.role === "detail" && cam.placedBy === "corners" && !out.solution.input.cameras.some((c) => c.id === "back-right"), JSON.stringify(cam));
  const truth = all.cameras.find((c) => c.photo === "back-right");
  assert(Math.hypot(cam.at[0] - truth.at[0], cam.at[1] - truth.at[1]) < 2, `${cam.at} against ${truth.at}`);
  // Its corners are out of the size: the bearings there are the four other photos'.
  assert(out.counts.cornerBearings === all.counts.cornerBearings - 3, `${out.counts.cornerBearings} / ${all.counts.cornerBearings}`);
});

test("a tape on a detail photo sizes nothing: said, and with no other tape the house is unscaled", () => {
  const { input, data } = withDetail([66, 8]);
  const det = synPhoto("detail", [60, 8], { x: 40, y: 4 });
  const a = det.tap({ x: 40, y: 4 });
  const b = det.tap({ x: 40, y: 10 });
  input.buildings[0].tapes = [{ id: "window", kind: "line", photo: "detail", a: [a.x, 300], b: [b.x, 300], feet: 6, what: "window", exact: true }];
  const sol = x.solveRoute(input, "main", data);
  assert(sol.unscaled && JSON.stringify(sol.tapesOnDetail) === '["window"]', `${sol.unscaled} ${JSON.stringify(sol.tapesOnDetail)}`);
  const old = x.solveRoute(input, "main", data, { sizePhotos: "all" });
  assert(!old.unscaled, "the old way, it scaled the house");
});

test("the walk in words: turns make the walk and its shape; a role names the corner in a photo, far ones by fitting", () => {
  const turns = x.parseTurns("O O O I O I O O I O I O");
  assert(turns && turns.length === 12 && turns[3] === "inside", JSON.stringify(turns));
  assert(JSON.stringify(x.parseTurns("OOIO")) === '["outside","outside","inside","outside"]' && x.parseTurns("O X O O") === null, "letters run together; a word it can't read");
  const walk = x.walkFromTurns(turns);
  assert(x.lapCloses(walk) && x.lapTurns(walk).length === 12 && x.lapOutline(x.lapTurns(walk))?.length === 12, "closes, twelve corners, a shape");
  const c1 = x.roleShot("corner 1", walk);
  assert(c1.shot.kind === "corner" && c1.shot.index === 0 && !c1.shot.far && c1.tag?.role === "corner" && c1.tag.k === 1, JSON.stringify(c1));
  const far1 = x.roleShot("far corner 1", walk);
  assert(far1.shot.kind === "corner" && far1.shot.index === 0 && far1.shot.far && far1.tag === null, JSON.stringify(far1));
  const s2 = x.roleShot("side 2", walk);
  assert(s2.shot.kind === "wall" && s2.shot.index === 1 && s2.tag?.role === "side", JSON.stringify(s2));
  const back = x.roleShot("far back", walk);
  // The owner's house: the back runs from corner 2 (the bump-out's back right) round to corner 7 (the back left).
  assert(back.shot.kind === "run" && back.shot.index === 1 && back.shot.to === 6 && back.shot.far, JSON.stringify(back));
  assert(x.roleShot("front", walk).shot.kind === "run" && x.roleShot("corner 13", walk) === null && x.roleShot("garage", walk) === null, "front; no corner 13; no such role");
  const every = x.roleShot("corner 1", walk, 0, { farAlways: true });
  assert(every.shot.far && every.tag === null, "taken as far");
});

test("a far-back photo of a corner: that corner among its taps, named by fitting, none given", () => {
  const shots = [["fr", [62, -22], { x: 40, y: 0 }, [{ c: 0 }, { c: 1 }, { c: 2 }]], ["bl", [-22, 52], { x: 0, y: 30 }, [{ c: 2 }, { c: 3 }, { c: 0 }]]];
  const { input, data } = synRoute(BOX, BOX_DRAWN, "detached", shots, []);
  const truth = input.buildings[0].corners.map((c) => c.corner);
  input.buildings[0].corners = input.buildings[0].corners.map((c) => ({ ...c, corner: -1, by: undefined }));
  input.photos = input.photos.map((p) => ({ ...p, shot: { kind: "corner", index: p.id === "fr" ? 1 : 3, far: true } }));
  const named = x.numberCorners(input, "main", data);
  assert(named.every((c, i) => c.corner === truth[i]), named.map((c, i) => `${c.photo}:${c.corner}/${truth[i]}`).join(" "));
});


test("the self-check: a photo whose corners are tapped wrong makes the tapes disagree; left out, they agree, and it is said", () => {
  // A wider box's every corner photographed far back, three tapes; then the back-right photo's middle corner tapped on the
  // wrong edge (40 px off), as a reviewer does on a pilaster or a post.
  const tapes = [{ id: "front", kind: "side", from: 0, feet: 40 }, { id: "right", kind: "side", from: 1, feet: 30 }, { id: "back", kind: "side", from: 2, feet: 40 }];
  const groups = tapes.map((t) => ({ id: t.id, parts: [t.id] }));
  const good = synRoute(BOX, BOX_DRAWN, "detached", boxShots, tapes);
  const fine = x.selfCheck(good.input, "main", good.data, groups);
  assert(fine.dropped === null && x.worstPct(fine.before) <= 5 && /agree/.test(fine.words), fine.words);
  const bad = synRoute(BOX, BOX_DRAWN, "detached", boxShots, tapes);
  bad.input.buildings[0].corners = bad.input.buildings[0].corners.map((c) => (c.photo === "back-right" && c.corner === 2 ? { ...c, x: c.x + 40 } : c));
  const before = x.holdOutTapes(bad.input, "main", bad.data, groups);
  const sc = x.selfCheck(bad.input, "main", bad.data, groups, {}, (p) => `photo ${p}`);
  assert(x.worstPct(before) > 5, `the wrong tap makes them disagree: ${before.map((r) => `${r.id} ${r.errorPct?.toFixed(1)}%`).join(", ")}`);
  assert(sc.dropped?.photo === "back-right" && sc.dropped.worstPct <= 5, `${sc.words} | ${sc.tried.map((q) => `${q.photo} ${q.worstPct?.toFixed(1)}`).join(", ")}`);
  assert(/Without photo back-right they agree within/.test(sc.words) && /left out of the size/.test(sc.words), sc.words);
  // Left out, it is still placed by its corners, to be read.
  const sol = x.solveRoute(bad.input, "main", bad.data, { outOfSize: [sc.dropped.photo] });
  assert(sol.cameras.find((c) => c.photo === "back-right")?.role === "detail", JSON.stringify(sol.cameras.map((c) => [c.photo, c.role])));
});

test("a line on a placed photo measured on the solved house (lineFeet): a tape's own length back", () => {
  const det = synPhoto("front", [20, -50], { x: 20, y: 15 });
  const a = det.tap({ x: 10, y: 0 });
  const b = det.tap({ x: 18, y: 0 });
  const r = synRoute(BOX, BOX_DRAWN, "detached", boxShots, [{ id: "front", kind: "side", from: 0, feet: 40 }]);
  const sol = x.solveRoute(r.input, "main", r.data);
  const m = x.lineFeet(sol, r.data, "front", [a.x, a.y], [b.x, b.y]);
  near(m?.feet ?? 0, 8, "8' along the front, read back", 0.15);
});


test("honest sizes: a long wall whose far corner no photo shows is NOT measured, with the photo that would measure it; never printed as a size", () => {
  // The box from the front only: its back corners on no photo, the front taped. The drawing holds the depth; it is no measurement.
  const front = [
    ["front", [20, -50], { x: 20, y: 15 }, [{ c: 0 }, { c: 1 }]],
    ["front-right", [62, -22], { x: 40, y: 0 }, [{ c: 0 }, { c: 1 }]],
    ["front-left", [-22, -22], { x: 0, y: 0 }, [{ c: 0 }, { c: 1 }]],
  ];
  const { input, data } = synRoute(BOX, BOX_DRAWN, "detached", front, [{ id: "front", kind: "side", from: 0, feet: 40 }]);
  const sol = x.solveRoute(input, "main", data);
  const right = sol.sides[1];
  assert(right.notMeasured && right.plusMinusPct > 10 && /corner 3 is on no photo that sizes the house/.test(right.notMeasured.why) && /far back at 45° to corner 3/.test(right.notMeasured.fix), JSON.stringify(right));
  assert(!sol.sides[0].notMeasured, "the taped front is measured");
  // The old way said the drawing's depth as if measured.
  const old = x.solveRoute(input, "main", data, { sizePhotos: "all" });
  assert(!old.sides[1].notMeasured && old.sides[1].plusMinusPct < right.plusMinusPct, `old ±${old.sides[1].plusMinusPct}% against ±${right.plusMinusPct}%`);
  // Landed and reported: said NOT measured, about that long, with what would measure it - the side's heading too.
  const { ext } = landOf(input, data, sol);
  const s = ext.sides.find((q) => q.lengthNotMeasured);
  assert(s && /corner 3/.test(s.lengthNotMeasured), JSON.stringify(ext.sides.map((q) => [q.name, q.lengthNotMeasured])));
  const rep = x.exteriorReport(ext, { title: "Box", date: "2026-10-22", madeWith: "Scrivn" });
  const sec = rep.sides.find((q) => q.side.id === s.id);
  assert(/about .*NOT measured/.test(sec.heading) && /^NOT measured: about /.test(sec.dims[0]), `${sec.heading} | ${sec.dims[0]}`);
  assert(rep.notes.some((nn) => /^NOT measured: /.test(nn)) && rep.notes.some((nn) => /A photo from far back at 45° to corner 3/.test(nn)), rep.notes.join(" | "));
});

test("honest sizes: tapes that disagree make every untaped side not measured, one fix each - the tape most off, or a loose side's own; taped sides stand", () => {
  const { input, data } = synRoute(BOX, BOX_DRAWN, "detached", boxShots, [{ id: "front", kind: "side", from: 0, feet: 40 }]);
  const sol = x.solveRoute(input, "main", data);
  const marked = x.tapesDisagree(sol.sides, 8.4, "tape t1 (garage doors)", -8.4);
  // One fix each: a side loose by itself (the corners alone hold this box's depth only so well) keeps its own; the rest name the tape.
  assert(
    !marked[0].notMeasured &&
      marked.slice(1).every((q) => q.notMeasured && /disagree by up to 8.4%/.test(q.notMeasured.why)) &&
      marked.some((q) => /^Check tape t1 \(garage doors\) again: the others put it -8.4% off/.test(q.notMeasured?.fix ?? "")) &&
      marked.every((q, i) => !sol.sides[i].notMeasured || q.notMeasured.fix === sol.sides[i].notMeasured.fix),
    JSON.stringify(marked.map((q) => q.notMeasured ?? null)),
  );
});

console.log("\nthe map outline: the long dimension the photos can't fix (10-23)");

/** The map turned [deg] (counter-clockwise) and moved: how a footprint off a map comes, north up, nowhere near the plan. */
const onMap = (ring, deg, shift = [0, 0]) =>
  ring.map((p) => {
    const t = (deg * Math.PI) / 180;
    return { x: p.x * Math.cos(t) - p.y * Math.sin(t) + shift[0], y: p.x * Math.sin(t) + p.y * Math.cos(t) + shift[1] };
  });
const withMap = (input, map) => ({ ...input, buildings: [{ ...input.buildings[0], map }] });
// The box from the front only, its front taped: its back corners on no photo, so nothing measures its depth.
const boxFront = () =>
  synRoute(
    BOX,
    [{ x: 0, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 24 }, { x: 0, y: 24 }],
    "detached",
    [
      ["front", [20, -50], { x: 20, y: 15 }, [{ c: 0 }, { c: 1 }]],
      ["front-right", [62, -22], { x: 40, y: 0 }, [{ c: 0 }, { c: 1 }]],
      ["front-left", [-22, -22], { x: 0, y: 0 }, [{ c: 0 }, { c: 1 }]],
    ],
    [{ id: "front", kind: "side", from: 0, feet: 40 }],
  );

test("a map outline holds the depth the photos can't: the box from the front only, 24' drawn and NOT measured, 30' with its map", () => {
  const { input, data } = boxFront();
  const photos = x.solveRoute(input, "main", data);
  assert(photos.sides[1].notMeasured && Math.abs(photos.sides[1].lengthFeet - 24) < 0.5 && !photos.map, `photos alone: ${photos.sides[1].lengthFeet}`);
  // Off the map north up, the house's front facing 163° (south-south-east), a long way from the plan's origin.
  const sol = x.solveRoute(withMap(input, { corners: onMap(BOX, -163, [512, -340]), source: "a test map" }), "main", data);
  near(sol.sides[1].lengthFeet, 30, "the right side, held by the map", 0.1);
  near(sol.sides[3].lengthFeet, 30, "the left side", 0.1);
  assert(!sol.sides[1].notMeasured && sol.sides[1].fromMap && sol.sides[1].plusMinusPct <= 10, JSON.stringify(sol.sides[1]));
  near(sol.sides[0].lengthFeet, 40, "the taped front, as taped", 0.01);
  assert(!sol.sides[0].fromMap, "a taped side is the tape's, not the map's");
  near(sol.map.frontFacesDeg, 163, "the front's bearing, from the map's turn", 0.5);
  assert(sol.map.holds.length === 2 && sol.map.overlap > 0.97 && sol.map.cornersOffFeet < 0.5, JSON.stringify(sol.map.holds));
  // The photos alone, kept to compare; the map's distance against them: they don't hold the depth, so no disagreement.
  near(sol.map.photosOnly[1].lengthFeet, photos.sides[1].lengthFeet, "the photos alone, kept", 1e-6);
  assert(sol.map.holds.every((h) => !h.disagrees), "nothing the photos hold is against the map");
  // Measured from the photos alone when asked: as before.
  const off = x.solveRoute(withMap(input, { corners: onMap(BOX, -163) }), "main", data, { map: false });
  assert(lengths(off) === lengths(photos) && !off.map, "map: false is the photos alone");
});

// The owner's house as taped (OWNER_TRUE: C1 the garage's right front corner, C1-C2 the 70'7" walkway side), seen from
// the front and from the back with nothing tying the two - the depth loose, as his photos left it - and drawn 14' short.
// Its map as Microsoft's footprint has it: the bump-out at the walkway side's back missed (the map's back on the rear wall,
// C4-C5), the covered deck in the back-left notch taken in, the garage front one line on the right bay's.
const ownerMap = () => {
  const T = OWNER_TRUE;
  return [T[0], { x: T[0].x, y: T[3].y }, { x: T[7].x, y: T[3].y }, T[7], T[8], { x: T[8].x, y: T[0].y }];
};
const ownerLoose = () => {
  const T = OWNER_TRUE;
  return synRoute(
    T,
    T.map((p) => ({ x: p.x, y: p.y < 30 ? p.y : p.y - 14 })),
    "detached",
    [
      ["front", [5, -60], { x: 5, y: 10 }, [9, 10, 11, 0].map((c) => ({ c }))],
      ["front-right", [50, -25], T[0], [11, 0].map((c) => ({ c }))],
      ["front-left", [-45, -10], T[8], [7, 8, 9].map((c) => ({ c }))],
      ["back", [0, 120], { x: 0, y: 60 }, [1, 2, 3, 4].map((c) => ({ c }))],
      ["back-left", [-50, 100], T[6], [4, 5, 6].map((c) => ({ c }))],
    ],
    [
      { id: "bay", kind: "side", from: 11, feet: 13.5 },
      { id: "bump", kind: "side", from: 1, feet: 22.17 },
    ],
  );
};

test("the map misses the bump-out and takes in the covered deck: its back traces the rear wall, so the walkway side is the map's and the bump-out's", () => {
  const { input, data } = ownerLoose();
  const photos = x.solveRoute(input, "main", data);
  assert(photos.sides[0].notMeasured && photos.sides[0].lengthFeet < 60, `photos alone: the walkway side ${photos.sides[0].lengthFeet.toFixed(1)}`);
  // Laid at any turn: the same walls traced, the same house.
  const runs = [0, 17, -163, 107].map((deg) => x.solveRoute(withMap(input, { corners: onMap(ownerMap(), deg, [-30, 55]) }), "main", data));
  const sol = runs[1];
  const traced = sol.map.sides.map((s) => s.traces);
  // Map sides from C1 round: the walkway C1-C2, the back on the rear wall C4-C5 (not the bump-out C2-C3 nor the deck's
  // back C6-C7), the AC side C7-C8, the porch C8-C9, the garage's left side C9-C10, the garage front on the right bay C12-C1.
  assert(JSON.stringify(traced) === JSON.stringify([0, 3, 6, 7, 8, 11]), `traced ${JSON.stringify(traced)}`);
  for (const r of runs) assert(lengths(r) === lengths(sol), `at another turn: ${lengths(r)}`);
  // The walkway: the map's 65'1" side and the bump-out's 5'6" past it - 70'7" taped, not the map's side alone.
  const walkway = sol.sides[0].lengthFeet;
  assert(Math.abs(walkway - 70.58) < 1.2 && sol.sides[0].fromMap, `the walkway side ${walkway.toFixed(2)} (taped 70.58)`);
  near(sol.sides[8].lengthFeet, 24.83, "the garage's left side: the map from the right bay's front, which it traces", 0.6);
  near(sol.sides[7].lengthFeet, 22, "the porch wall", 0.6);
  // Said: the map's walkway side isn't the whole wall; the bump-out's corners stand outside it, the deck's inside corner in.
  const words = x.mapWords(sol.map, sol.sides.map((s) => s.lengthFeet));
  assert(words.some((w) => /^The map's side along the wall from corner 1 to corner 2 is 65'1"/.test(w) && /past corner 2 and 3/.test(w) && /not the whole wall/.test(w)), words.join(" | "));
  const off = new Map(sol.map.offMap.map((c) => [c.corner, c.feet]));
  assert(off.get(1) > 4 && off.get(2) > 4 && off.get(5) < -8, `off the map: ${JSON.stringify(sol.map.offMap)}`);
  assert(words.some((w) => /^Corner 6 stands .* inside the map's outline/.test(w)), words.join(" | "));
});

test("a quarter-turn the photos' sizes are against is not the map's; the compass, when known, picks it outright", () => {
  // A box 40 x 30 whose photos hold its width (taped) and its depth only loosely: the map turned a quarter would put its 30'
  // across a 40' tape.
  const { input, data } = boxFront();
  const map = { corners: onMap(BOX, 0) };
  const sol = x.solveRoute(withMap(input, map), "main", data);
  assert(Math.abs(sol.map.frontFacesDeg - 180) < 0.5 || Math.abs(sol.map.frontFacesDeg - 0) < 0.5, `front ${sol.map.frontFacesDeg}`);
  near(sol.sides[0].lengthFeet, 40, "the front", 0.05);
  near(sol.sides[1].lengthFeet, 30, "the depth", 0.15);
  // Said to face north: the map is laid with its front north (a box's front and back are alike to a map).
  const north = x.solveRoute(withMap(input, map), "main", data, { frontFacesDeg: 0 });
  assert(Math.abs(north.map.frontFacesDeg) < 0.5 || Math.abs(north.map.frontFacesDeg - 360) < 0.5, `front ${north.map.frontFacesDeg}`);
  near(north.sides[1].lengthFeet, 30, "the depth, facing north", 0.15);
});

test("where the map and the photos disagree it is said: a map 44' wide against a 40' tape, the tape standing", () => {
  const { input, data } = boxFront();
  const wide = [{ x: 0, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 30 }, { x: 0, y: 30 }];
  const sol = x.solveRoute(withMap(input, { corners: onMap(wide, 33) }), "main", data);
  const across = sol.map.holds.find((h) => h.axis === "E");
  assert(across && across.disagrees && Math.abs(across.feet - 44) < 0.01 && Math.abs(across.photosFeet - 40) < 0.1, JSON.stringify(sol.map.holds));
  near(sol.sides[0].lengthFeet, 40, "the taped front stands", 0.05);
  const words = x.mapWords(sol.map, sol.sides.map((s) => s.lengthFeet));
  assert(words.some((w) => /^The map and the photos disagree: .* is 44' on the map, 40'/.test(w)), words.join(" | "));
});

test("the shape as drawn never outweighs the map: a 9' notch drawn as a 2' step still gives the map's depth", () => {
  const { input, data } = ownerLoose();
  // The covered deck's 9'1" side drawn 2': the drawing says a step; the map says how deep the house is to its back.
  const drawn = input.buildings[0].outline.map((p, i) => (i === 5 || i === 6 ? { x: p.x, y: p.y + 7.08 } : p));
  const sol = x.solveRoute(withMap({ ...input, buildings: [{ ...input.buildings[0], outline: drawn }] }, { corners: onMap(ownerMap(), 17) }), "main", data);
  const toBack = sol.map.holds.find((h) => h.a === 7 && h.b === 3);
  assert(toBack && Math.abs(toBack.nowFeet - toBack.feet) < 1, JSON.stringify(sol.map.holds));
  assert(Math.abs(sol.sides[0].lengthFeet - 70.58) < 1.5, `the walkway side ${sol.sides[0].lengthFeet.toFixed(2)}`);
});

console.log(`\n${passed.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
