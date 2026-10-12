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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  writeFileSync(entry, `export * from "${lib("exterior.ts")}";\nexport * from "${lib("roof.ts")}";\n`);
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
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
  near(r.squaresWithWaste, 16.873369, "squares + 10%");
  near(r.eaveFeet, 84, "eaves 2 x 42");
  // Rakes: two ends, each 32.666667 plan across at 1.118034 = 36.522
  near(r.rakeFeet, 2 * 32.666667 * 1.118034, "rakes");
  near(r.ridgeFeet, 42, "ridge the whole outline");
  near(r.hipFeet + r.valleyFeet, 0, "no hips or valleys");
  near(r.dripEdgeFeet, 84 + 73.04489, "drip edge");
  // Soffit: 2 x 42 x 16" flat under the eaves + 2 x 30 x 12" up the rakes x 1.118034
  near(q.roof.soffit.eaveSquareFeet, 112, "eave soffit");
  near(q.roof.soffit.rakeSquareFeet, 60 * 1.118034, "rake soffit");
  assert(r.downspouts.count === 4 && r.downspouts.auto, "two 42' runs, two downspouts each");
  near(r.downspouts.feet, 40, "each the 10' eave");
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
  near(q.roof.soffit.rakeSquareFeet, 0, "no rake soffit");
  near(q.roof.soffit.eaveSquareFeet, 1393.7778 - 1200, "all the overhang is eave soffit");
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
  near(r.squaresWithWaste, (1550.5 * 1.0540926 * 1.1) / 100, "squares + 10%");
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

console.log(`\n${passed.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
