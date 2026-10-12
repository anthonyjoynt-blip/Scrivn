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
      `export { availableTrades, buildWorkOrders } from "${lib("workOrders.ts")}";`,
      `export { emptyClaimInfo } from "${lib("claimInfo.ts")}";`,
      `export { documentGenerationUserMessage, DOCUMENT_GENERATION_SYSTEM_PROMPT, SCOPE_ONLY_SYSTEM_PROMPT } from "${lib("documentGenerationPrompt.ts")}";`,
      `export * from "${lib("exteriorImport.ts")}";`,
      `export { adoptScan, exteriorScanDecision, sketchFromScan } from "${lib("scanInbox.ts")}";`,
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
  // The peak, 5.613 m up: 1.701 m over the eave, over the 5 m half span.
  near(x.sideQuantities(left).pitchFromGable, (1.701 / 5) * 12, "pitch from the peak", 1e-3);
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

console.log(`\n${passed.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
