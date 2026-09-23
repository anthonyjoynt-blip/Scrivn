/**
 * Squaring a corner back to its neighbours — see `lib/sketchSquare.ts`.
 *
 *   node test/sketch/square.mjs
 *
 * The case that asked for it is the kitchen of 2026-09-22: ten corners at exactly 90 degrees and a
 * jog at 74.4, where the fix an estimator described was "grab that corner and straighten it out".
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
  const outDir = mkdtempSync(join(tmpdir(), "square-"));
  const entry = join(outDir, "entry.ts");
  const outfile = join(outDir, "entry.mjs");
  writeFileSync(entry, `export * from "${lib("sketch.ts")}";\nexport * from "${lib("sketchSquare.ts")}";\n`);
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
function near(actual, expected, what, tol = 1e-6) {
  assert(Math.abs(actual - expected) <= tol, `${what}\n      expected ~${expected}\n      actual    ${actual}`);
}

const s = await load();

/** A room from [x, y] pairs, in world pixels. */
function room(points, extra = {}) {
  return {
    id: "r",
    name: "Room 1",
    vertices: points.map(([x, y], i) => ({ id: `v${i}`, x, y })),
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    ...extra,
  };
}

console.log("\n  squaring a corner\n");

test("a square room has nothing to square", () => {
  const r = room([[0, 0], [120, 0], [120, 90], [0, 90]]);
  for (let i = 0; i < 4; i++) near(s.cornerAngleDeg(r, i), 90, `corner ${i + 1}`, 1e-9);
  assert(s.leaningCorners(r).length === 0, "nothing leaning");
  const out = s.squareUpRoom(r);
  assert(out.moved.length === 0, "nothing moved");
  assert(out.room === r, "the room itself is handed back untouched");
});

test("the kitchen's jog: the longer wall keeps its direction and the corner slides along it", () => {
  // Walls 11, 12 and 1 of room_20260922_201320, to scale in pixels (12 px = 1 ft, 1 m = 39.37 in).
  // v11 (-3.12,-0.79) → v12 (-0.57,-0.79) → v1 (0.02,-2.89) → v2 (4.85,-2.89), metres.
  const m = 39.3701; // px per metre
  const r = room([
    [-3.12 * m, -0.79 * m],
    [-0.57 * m, -0.79 * m],
    [0.02 * m, -2.89 * m],
    [4.85 * m, -2.89 * m],
    [4.85 * m, 1.5 * m],
    [-3.12 * m, 1.5 * m],
  ]);
  // The jog leans by about 15.6 degrees, which is inside the tolerance.
  const off = s.offSquareDeg(r, 1);
  assert(Math.abs(off - 15.66) < 0.2, `off square by ${off}`);

  const target = s.squaredCorner(r, 1);
  assert(target !== null, "it should be squared");
  // The longer wall is the horizontal one it came in on, so the corner slides along it — its y is
  // unchanged and its x lands under the corner after it.
  near(target.y, -0.79 * m, "stayed on the wall it came in on", 1e-6);
  near(target.x, 0.02 * m, "slid to under the next corner", 1e-6);

  const out = s.squareUpRoom(r);
  assert(out.moved.length >= 1, `expected a move, got ${out.moved.length}`);
  near(s.cornerAngleDeg(out.room, 1), 90, "the jog stands up straight", 1e-6);
  // And the corner after it came square for free: the wall on its far side was parallel to the
  // one that was kept. That is the whole reason this rule was chosen over the nearest-point one.
  near(s.cornerAngleDeg(out.room, 2), 90, "its neighbour too", 1e-6);
});

test("a deliberate chamfer is left alone", () => {
  // A 45 degree cut across a corner is a shape somebody drew, not a slip.
  const r = room([[0, 0], [90, 0], [120, 30], [120, 90], [0, 90]]);
  const off = s.offSquareDeg(r, 1);
  assert(off > s.SQUARE_TOLERANCE_DEG, `a chamfer is ${off} off square, past the tolerance`);
  assert(s.squaredCorner(r, 1) === null, "not offered");
  assert(s.squareUpRoom(r).moved.length === 0, "and not moved");
});

test("the tolerance is the line between a slip and a shape", () => {
  // 15 degrees off: squared. 25: left. The kitchen's 15.6 is on the near side, a chamfer far past.
  const lean = (deg) => {
    const rad = (deg * Math.PI) / 180;
    // A corner pulled off the vertical by `deg`.
    return room([[0, 0], [120, 0], [120 + 90 * Math.sin(rad), 90 * Math.cos(rad)], [0, 90]]);
  };
  assert(s.squaredCorner(lean(15), 1) !== null, "15 degrees is a slip");
  assert(s.squaredCorner(lean(25), 1) === null, "25 degrees is a shape");
});

test("a corner already square is not moved by a hair", () => {
  const r = room([[0, 0], [120, 0], [120, 90], [0, 90]]);
  assert(s.squaredCorner(r, 1) === null, "nothing to do");
  // A tenth of a degree is noise, not a correction.
  const hair = room([[0, 0], [120, 0], [120.1, 90], [0, 90]]);
  assert(s.offSquareDeg(hair, 1) < 0.5, "a hair off");
  assert(s.squaredCorner(hair, 1) === null, "left alone");
});

test("squaring never folds the room over itself", () => {
  // A very short wall beside a long one: squaring would put the corner on its neighbour.
  const r = room([[0, 0], [120, 0], [124, 3], [124, 90], [0, 90]]);
  const out = s.squareUpRoom(r);
  assert(!sketchDegenerate(out.room), "the room is still a room");
  for (const v of out.room.vertices) {
    assert(Number.isFinite(v.x) && Number.isFinite(v.y), "every corner is a number");
  }
});

function sketchDegenerate(r) {
  return s.isDegenerate(r.vertices);
}

test("an L keeps its reflex corner", () => {
  // The inside corner of an L is 270 degrees of turn, which reads as 90 here — and it IS square.
  const l = room([[0, 0], [120, 0], [120, 60], [60, 60], [60, 120], [0, 120]]);
  for (let i = 0; i < l.vertices.length; i++) near(s.cornerAngleDeg(l, i), 90, `corner ${i + 1}`, 1e-9);
  assert(s.squareUpRoom(l).moved.length === 0, "an L is already square everywhere");
});

test("a room with too few corners has no angles to read", () => {
  const two = room([[0, 0], [100, 0]]);
  assert(Number.isNaN(s.cornerAngleDeg(two, 0)), "no angle");
  assert(s.squareUpRoom(two).moved.length === 0, "and nothing to do");
});

test("only the corners that moved are reported", () => {
  const m = 39.3701;
  const r = room([
    [-3.12 * m, -0.79 * m],
    [-0.57 * m, -0.79 * m],
    [0.02 * m, -2.89 * m],
    [4.85 * m, -2.89 * m],
    [4.85 * m, 1.5 * m],
    [-3.12 * m, 1.5 * m],
  ]);
  const out = s.squareUpRoom(r);
  for (const id of out.moved) {
    const before = r.vertices.find((v) => v.id === id);
    const after = out.room.vertices.find((v) => v.id === id);
    assert(before.x !== after.x || before.y !== after.y, `${id} is listed but did not move`);
  }
  // The room handed back is a new object; the one passed in is untouched.
  near(r.vertices[1].x, -0.57 * m, "the original is unchanged", 1e-9);
});

console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
