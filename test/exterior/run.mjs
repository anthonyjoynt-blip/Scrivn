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
      `export * from "${lib("roofLabels.ts")}";`,
      `export { formatFeetInches } from "${lib("sketch.ts")}";`,
      `export { availableTrades, buildWorkOrders } from "${lib("workOrders.ts")}";`,
      `export { emptyClaimInfo } from "${lib("claimInfo.ts")}";`,
      `export { documentGenerationUserMessage, DOCUMENT_GENERATION_SYSTEM_PROMPT, SCOPE_ONLY_SYSTEM_PROMPT } from "${lib("documentGenerationPrompt.ts")}";`,
      `export * from "${lib("exteriorImport.ts")}";`,
      `export * from "${lib("exteriorPhoto.ts")}";`,
      `export * from "${lib("exteriorTrace.ts")}";`,
      `export * from "${lib("exterior3d.ts")}";`,
      `export * from "${lib("exteriorPlan.ts")}";`,
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
  assert(f.alongMinM >= -2.8 - 2.5 - 1e-9 && f.upMaxM <= 6.4 + 1.5 + 1e-9, "no more than the margin");
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
  // 1.5 m over 4 m: 4.5 in 12 each way.
  near(p.wallTop.slopes[0], 4.5, "left slope", 1e-9);
  near(p.wallTop.slopes[1], 4.5, "right slope", 1e-9);
  assert(p.checks.some((c) => /Both slopes of the gable read 4\.5 on 12/.test(c)), p.checks.join(" | "));
  const lopsided = x.traceProposals({ ...wire, wall_top: [[100, 300], [500, 150], [900, 260]] }, traceFrame, 8 * M);
  assert(lopsided.checks.some((c) => /two slopes read 4\.5 and 3\.3 on 12/.test(c)), lopsided.checks.join(" | "));
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
  });
  assert(all.shapes.length === 2 && all.shapes.every((s) => s.closed && s.id), "the two shapes, closed");
  assert(all.openings.length === 2 && all.openings[1].kind === "garage", "two openings");
  near(all.eaveLeftFeet, 3 * M, "eave", 1e-9);
  near(all.gable.peakFeet, 4.5 * M, "peak", 1e-9);
  near(all.pitchMeasured, 4.5, "the pitch from the slopes", 1e-9);
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
  const top = w.outline.slice(2).reverse();
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
function soundRoof(e, what, skip = []) {
  const m = model3d(e);
  const q = x.exteriorQuantities(e);
  const gap = worstGap(m, skip);
  assert(gap.worst < 0.02, `${what}: a gap between wall and roof - ${gap.where}`);
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
  // No pitch typed and no gable measured: the roof stands at the assumed 6/12, and says so (10-13).
  const walls = model3d(rect(40, 30));
  assert(walls.roof !== null && /assumed 6\/12/.test(walls.notes.join(" ")), walls.notes.join(" "));
  near(topOf(wallNamed(walls, "Left")), 17.5, "the gable end up to the assumed roof, as at a typed 6/12");
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
  // Every eave the walk read, in the middle: the house's 10'4", the garage's 8'9".
  near(m.eaves[0], 10.348, "the house's eave", 0.01);
  near(m.eaves[1], 8.757, "the garage's eave", 0.01);
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

test("the roof is there as soon as the outline closes, at an assumed 6/12 that is asked for until it is answered", () => {
  const e = drawnRect();
  e.scope = { roofing: true, sides: [e.sides[1].id], soffitFascia: false, eavestrough: false };
  const q = x.exteriorQuantities(e);
  assert(q.roof && q.pitch.source === "assumed" && q.roof.pitch === 6, `${q.pitch.source} ${q.roof?.pitch}`);
  assert(q.roofing.pitchAssumed && q.roofing.toAnswer.roofing[0] === "the pitch (6/12 is assumed)", q.roofing.toAnswer.roofing.join(" | "));
  const lines = x.exteriorScopeLines(e);
  assert(/^Remove & replace roofing – material to confirm – 6\/12 \(assumed, to confirm\) – /.test(lines.roofing[0]), lines.roofing[0]);
  // The Right side is a gable end: its gable is the roof's, so at the assumed pitch, and its line says so.
  assert(/^Remove & replace stucco – Right – [\d.]+ SF – gables at the assumed 6\/12, to confirm$/.test(lines.siding[0]), lines.siding[0]);
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

console.log(`\n${passed.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
