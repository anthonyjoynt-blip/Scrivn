/**
 * Two cabinet runs meeting at an inside corner — see `cornerYieldPx` in lib/sketch.ts.
 *
 *   node test/sketch/cornerCabinets.mjs
 *
 * From the kitchen of 2026-09-22: run 1 along wall 1 and run 2 along wall 2, the second starting
 * 1'2" BEFORE its wall began. Drawn as two full rectangles they cross in a square as deep as both
 * of them, and the floor deduction counts that square twice.
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
  const outDir = mkdtempSync(join(tmpdir(), "corner-cab-"));
  const entry = join(outDir, "entry.ts");
  const outfile = join(outDir, "entry.mjs");
  writeFileSync(entry, `export * from "${lib("sketch.ts")}";\nexport * from "${lib("sketchQuantities.ts")}";\n`);
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
const FT = 12; // PIXELS_PER_FOOT
/** The cabinet deductions are a scoping choice and off by default; this suite is about them. */
const DEDUCTING = {
  deductCabinetsFromFloorPerimeter: true,
  deductFromFloorArea: true,
  deductFromWallArea: false,
  deductOpeningsFromWallArea: true,
};

/** A 20' x 16' room: wall 0 along the top (left to right), wall 1 down the right side. */
function kitchen(symbols) {
  return {
    id: "k",
    name: "Kitchen",
    vertices: [
      { id: "v0", x: 0, y: 0 },
      { id: "v1", x: 20 * FT, y: 0 },
      { id: "v2", x: 20 * FT, y: 16 * FT },
      { id: "v3", x: 0, y: 16 * FT },
    ],
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols,
    freeCabinets: [],
  };
}

/** A base run of [widthFeet] whose far end sits at [t] along wall [wallIndex]. */
function run(id, wallIndex, t, widthFeet, extra = {}) {
  return {
    id,
    wallId: `v${wallIndex}`,
    t,
    widthFraction: 0.3,
    widthFeet,
    type: "cabinet",
    label: "Cabinet",
    tier: "base",
    depthFeet: 2,
    heightFeet: 3,
    ...extra,
  };
}

console.log("\n  cabinet runs meeting at a corner\n");

test("a run on its own keeps its whole width", () => {
  const room = kitchen([run("a", 0, 0.5, 10)]);
  near(s.symbolWidthFeet(room.symbols[0], room, [room]), 10, "10' run", 1e-6);
});

test("the shorter run stops short of the corner by the longer one's depth", () => {
  // Wall 0 runs from the corner at v0 to v1 (20'), wall 1 from v1 down (16').
  // The long run ends AT v1; the short one starts there.
  const long = run("long", 0, 1 - 5 / 20, 10); // centre 5' from the far end: ends exactly at v1
  const short = run("short", 1, 4 / 16, 8); // centre 4' along wall 1: starts exactly at v1
  const room = kitchen([long, short]);
  near(s.symbolWidthFeet(long, room, [room]), 10, "the longer run is untouched", 1e-6);
  near(s.symbolWidthFeet(short, room, [room]), 6, "the shorter yields the corner square (2' deep)", 1e-6);
});

test("neither yields when they do not both reach the corner", () => {
  // The same pair, but the short run starts 3' along its wall — there is no corner unit.
  const long = run("long", 0, 1 - 5 / 20, 10);
  const short = run("short", 1, 7 / 16, 8);
  const room = kitchen([long, short]);
  near(s.symbolWidthFeet(short, room, [room]), 8, "no overlap, no trim", 1e-6);
});

test("a wall cabinet over a base run is not a corner unit", () => {
  // Different heights: they share nothing, and nothing about the floor depends on it.
  const long = run("long", 0, 1 - 5 / 20, 10);
  const upper = run("upper", 1, 4 / 16, 8, { tier: "wall", depthFeet: 1 });
  const room = kitchen([long, upper]);
  near(s.symbolWidthFeet(upper, room, [room]), 8, "an upper is left alone", 1e-6);
});

test("the floor is not deducted twice for the corner", () => {
  const long = run("long", 0, 1 - 5 / 20, 10);
  const short = run("short", 1, 4 / 16, 8);
  const room = kitchen([long, short]);
  const sketch = { rooms: [room] };
  const q = s.roomQuantities(room, sketch, DEDUCTING);
  // 20 x 16 = 320 SF, less 10x2 and (8-2)x2 = 20 + 12 = 32.
  near(q.floorArea, 320 - 32, "floor less both runs, the corner counted once", 0.01);
  // Counted the old way it would have been 320 - 36: four square feet of floor the room has.
  assert(Math.abs(q.floorArea - (320 - 36)) > 3, "the double count is gone");
});

test("the perimeter follows the trimmed run", () => {
  const long = run("long", 0, 1 - 5 / 20, 10);
  const short = run("short", 1, 4 / 16, 8);
  const room = kitchen([long, short]);
  const q = s.roomQuantities(room, { rooms: [room] }, DEDUCTING);
  // 72' of perimeter less 10' and 6': the corner square belongs to the long run's feet, not both.
  near(q.perimeterFloor, 72 - 16, "perimeter less both runs", 0.01);
});

test("a run that stops short of the corner yields only what it actually overlaps", () => {
  // The kitchen of 2026-09-23 13:16. Wall 0 carries a run filling it end to end, so it owns the
  // corner; wall 1's run starts 1'6" from that corner. Both are 2' deep, so they overlap by the
  // 6" the short run reaches INTO the corner square - and no more.
  const long = run("long", 0, 0.5, 20);            // fills the 20' wall, both ends on corners
  const short = run("short", 1, (1.5 + 1.75 / 2) / 16, 1.75);
  const room = kitchen([long, short]);
  near(s.symbolWidthFeet(long, room, [room]), 20, "the keeper is untouched", 1e-6);
  near(s.symbolWidthFeet(short, room, [room]), 1.75 - 0.5, "yields the 6in it overlaps, not the whole 2ft", 0.02);
});

test("a run already clear of the corner square is not touched at all", () => {
  const long = run("long", 0, 0.5, 20);
  const short = run("short", 1, (3 + 2 / 2) / 16, 2);   // starts 3' along, past the 2' deep keeper
  const room = kitchen([long, short]);
  near(s.symbolWidthFeet(short, room, [room]), 2, "nothing to yield", 1e-6);
});

test("a tie goes to whichever was drawn first, and stays there", () => {
  const first = run("first", 0, 1 - 4 / 20, 8);
  const second = run("second", 1, 4 / 16, 8);
  const room = kitchen([first, second]);
  near(s.symbolWidthFeet(first, room, [room]), 8, "the first keeps the corner", 1e-6);
  near(s.symbolWidthFeet(second, room, [room]), 6, "the second yields", 1e-6);
  // And the answer does not depend on which one is asked about first.
  near(s.symbolWidthFeet(second, room, [room]), 6, "asked again", 1e-6);
  near(s.symbolWidthFeet(first, room, [room]), 8, "and again", 1e-6);
});

console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
