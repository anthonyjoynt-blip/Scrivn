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

test("a corner both runs stop short of fills itself in", () => {
  // The kitchen of 2026-09-24 07:06, in feet: one run stopped 1'5" short of the corner, the run
  // round it stopped 1'9" short, and a base cabinet is 2' deep. Neither reached, so nothing used
  // to happen - and what sits in that gap is a corner unit, which has no ends to tap.
  const gapLong = 1.4;
  const gapShort = 1.75;
  const long = run("long", 0, (20 - gapLong - 10 / 2) / 20, 10);
  const short = run("short", 1, (gapShort + 2 / 2) / 16, 2);
  const room = kitchen([long, short]);
  near(s.symbolWidthFeet(long, room, [room]), 10 + gapLong, "the longer run reaches through to the corner", 0.02);
  near(s.symbolWidthFeet(short, room, [room]), 2 - (2 - gapShort), "and the shorter stands off by the keeper's depth", 0.02);
});

test("the filled corner leaves no hole and no overlap", () => {
  const gapLong = 1.4;
  const gapShort = 1.75;
  const long = run("long", 0, (20 - gapLong - 10 / 2) / 20, 10);
  const short = run("short", 1, (gapShort + 2 / 2) / 16, 2);
  const room = kitchen([long, short]);
  // The keeper's far edge is ON the corner...
  const lw = s.symbolWidthFeet(long, room, [room]);
  const lc = s.symbolCentrePx(long, room, [room]) / FT;
  near(lc + lw / 2, 20, "the keeper ends on the corner", 0.02);
  // ...and the other run begins exactly where the keeper's depth ends, so they touch and no more.
  const sw = s.symbolWidthFeet(short, room, [room]);
  const sc = s.symbolCentrePx(short, room, [room]) / FT;
  near(sc - sw / 2, 2, "the other starts at the keeper's depth", 0.02);
});

test("a gap wider than a cabinet is deep is an appliance, not a corner unit", () => {
  // A fridge, a dishwasher, a doorway. Filling this would invent three feet of cabinet.
  const long = run("long", 0, (20 - 1.4 - 10 / 2) / 20, 10);
  const far = run("far", 1, (3.5 + 2 / 2) / 16, 2);
  const room = kitchen([long, far]);
  near(s.symbolWidthFeet(long, room, [room]), 10, "the keeper is not stretched to meet it", 1e-6);
  near(s.symbolWidthFeet(far, room, [room]), 2, "and the far run is left where it was tapped", 1e-6);
});

test("a run alone near a corner is not stretched to it", () => {
  // Nothing on the next wall at all: there is no corner unit, just a run that stops short.
  const lone = run("lone", 0, (20 - 1.4 - 10 / 2) / 20, 10);
  const room = kitchen([lone]);
  near(s.symbolWidthFeet(lone, room, [room]), 10, "left exactly as tapped", 1e-6);
});

test("the floor is deducted for the corner unit once, now that it is drawn", () => {
  const gapLong = 1.4;
  const gapShort = 1.75;
  const long = run("long", 0, (20 - gapLong - 10 / 2) / 20, 10);
  const short = run("short", 1, (gapShort + 2 / 2) / 16, 2);
  const room = kitchen([long, short]);
  const q = s.roomQuantities(room, { rooms: [room] }, DEDUCTING);
  // 20 x 16 = 320, less the keeper (11.4 x 2) and the stand-off run (1.75 x 2).
  near(q.floorArea, 320 - (10 + gapLong) * 2 - gapShort * 2, "the corner square is deducted, once", 0.05);
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

/* ── what the SCOPE is priced from ───────────────────────────────────────────────────────────── */

/*
  Until 2026-09-24 none of the above reached a price. The claim page worked the estimate's areas out
  itself, from the room's own outline and the sum of its walls, and the deduction toggles fed only
  the panel on screen - so an estimator could take a kitchen run out of the floor, watch the number
  fall, send the claim, and have the disposal weighed on the gross floor anyway.
*/

const key = (name) => name.trim().toLowerCase();

test("a deducted cabinet run reaches the estimate, and the gross floor no longer does", () => {
  const long = run("long", 0, 1 - 5 / 20, 10);
  const room = kitchen([long]);
  const gross = s.roomAreasForEstimate({ rooms: [room] }, key);
  near(gross.kitchen.floorSquareFeet, 320, "with no deduction chosen, the whole floor", 0.01);

  const deducted = s.roomAreasForEstimate({ rooms: [room], quantities: DEDUCTING }, key);
  near(deducted.kitchen.floorSquareFeet, 320 - 20, "the 10' run at 2' deep comes off", 0.01);
  assert(deducted.kitchen.floorSquareFeet < gross.kitchen.floorSquareFeet, "the estimate sees the difference");
});

test("the choice travels with the sketch, not with whoever has the editor open", () => {
  const room = kitchen([run("long", 0, 1 - 5 / 20, 10)]);
  const saved = JSON.parse(JSON.stringify({ rooms: [room], quantities: DEDUCTING }));
  near(s.roomAreasForEstimate(saved, key).kitchen.floorSquareFeet, 300, "loaded back from JSON, still deducted", 0.01);
  const before = JSON.parse(JSON.stringify({ rooms: [room] }));
  near(s.roomAreasForEstimate(before, key).kitchen.floorSquareFeet, 320, "a sketch saved before the field reads as no deduction", 0.01);
});

test("a cabinet does not shorten the ceiling above it", () => {
  const room = kitchen([run("long", 0, 1 - 5 / 20, 10)]);
  const a = s.roomAreasForEstimate({ rooms: [room], quantities: DEDUCTING }, key);
  near(a.kitchen.ceilingSquareFeet, 320, "the ceiling runs over the top of it", 0.01);
  assert(a.kitchen.ceilingSquareFeet !== a.kitchen.floorSquareFeet, "floor and ceiling are no longer one number");
});

test("a closet inside a bedroom is no longer weighed twice", () => {
  /*
    `grossFloorArea` is a room's OWN outline and takes no notice of what is nested in it, so the
    closet's floor was disposed of once as the closet and again as part of the bedroom around it.
  */
  const bedroom = {
    ...kitchen([]),
    id: "bed",
    name: "Bedroom",
    vertices: [
      { id: "b0", x: 0, y: 0 },
      { id: "b1", x: 20 * FT, y: 0 },
      { id: "b2", x: 20 * FT, y: 16 * FT },
      { id: "b3", x: 0, y: 16 * FT },
    ],
  };
  const closet = {
    ...kitchen([]),
    id: "cl",
    name: "Closet",
    parentRoomId: "bed",
    vertices: [
      { id: "c0", x: 2 * FT, y: 2 * FT },
      { id: "c1", x: 8 * FT, y: 2 * FT },
      { id: "c2", x: 8 * FT, y: 5 * FT },
      { id: "c3", x: 2 * FT, y: 5 * FT },
    ],
  };
  const areas = s.roomAreasForEstimate({ rooms: [bedroom, closet] }, key);
  near(areas.closet.floorSquareFeet, 18, "the closet is 6 x 3", 0.01);
  near(areas.bedroom.floorSquareFeet, 320 - 18, "and the bedroom is what is left of it", 0.01);
  near(areas.bedroom.floorSquareFeet + areas.closet.floorSquareFeet, 320, "together they are the room once", 0.01);
});

test("with nothing chosen, nothing moves", () => {
  /*
    The promise this change has to keep. Switching the estimate onto `roomQuantities` corrects three
    things, and only two of them should happen without the estimator asking:

      - a SUB-ROOM stops being counted twice (a correction, and it applies whether or not any
        toggle is on, because counting a closet's floor in two rooms was never a choice);
      - a PARTITION starts contributing its wall run (the same);
      - a CABINET comes off only when the toggle says so.

    A plain room with a cabinet in it and no toggle on must read exactly as it did before, to the
    square foot, or every saved claim quietly reprices itself.
  */
  const cab = run("long", 0, 1 - 5 / 20, 10);
  const room = kitchen([cab]);
  const plain = s.roomAreasForEstimate({ rooms: [room] }, key).kitchen;
  const wallRun = s.wallsOf(room).reduce((sum, w) => sum + w.lengthFeet, 0);
  near(plain.floorSquareFeet, s.grossFloorArea(room), "the floor is what it always was", 0.001);
  near(plain.wallRunFeet, wallRun, "and so is the wall run", 0.001);
  near(plain.ceilingSquareFeet, s.grossFloorArea(room), "and the ceiling", 0.001);
});

test("a partition standing in a room is wall, and now counts as it", () => {
  const room = kitchen([]);
  const partition = { id: "f1", vertices: [{ id: "fa", x: 4 * FT, y: 0 }, { id: "fb", x: 4 * FT, y: 8 * FT }], heightFeet: null };
  const bare = s.roomAreasForEstimate({ rooms: [room] }, key).kitchen;
  const withIt = s.roomAreasForEstimate({ rooms: [room], freeWalls: [partition] }, key).kitchen;
  near(bare.wallRunFeet, 72, "the outline alone", 0.01);
  near(withIt.wallRunFeet, 72 + 16, "plus both faces of an 8' partition", 0.01);
});

test("a room nobody drew is absent rather than zero", () => {
  const empty = { ...kitchen([]), vertices: [] };
  const areas = s.roomAreasForEstimate({ rooms: [empty] }, key);
  assert(areas.kitchen.floorSquareFeet === null, "null, so `resolve` records it unweighed");
  assert(areas.kitchen.wallRunFeet === null, "and the same for the run");
});

console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
