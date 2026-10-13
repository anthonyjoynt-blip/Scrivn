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

test("a T is not built yet: area and eaves only, and it says so", () => {
  // 30 x 10 bar with a 10 x 10 stem out the front middle.
  const lengths = [10, 10, 10, 10, 30, 10, 10, 10];
  const turns = ["outside", "inside", "outside", "outside", "outside", "outside", "inside", "outside"];
  const e = exterior(
    lengths.map((len, i) => side({ id: `t${i}`, name: `t${i}`, lengthFeet: len, turn: turns[i] })),
    { eaveOverhangFeet: 1, pitch: 6 },
  );
  const q = x.exteriorQuantities(e);
  assert(q.footprint.closes, q.footprint.reason ?? "closes");
  assert(q.roof.shape === "other" && q.roof.note, "says what is missing");
  // Grown by 1' all round: perimeter 100 -> plan 400 + 100 x 1 + 4 x 1 (outside corners net of inside) = 504
  near(q.roof.planSquareFeet, 400 + 100 + 4, "plan grown by the overhang");
  near(q.roofing.areaSquareFeet, 504 * 1.118034, "area");
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
      assert(t.onLine && off < 1e-6, `${name}: ${t.key} (${t.text}) is off its line by ${off.toFixed(2)}'`);
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

console.log(`\n${passed.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
