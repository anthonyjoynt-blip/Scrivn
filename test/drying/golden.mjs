/**
 * The drying plan's golden file, for Scrivn Scan's Kotlin port of lib/dryingPlan.ts.
 *
 *   node test/drying/golden.mjs <out.json>
 *
 * Scan's DryingPlan.kt is the same engine on the phone, and the phone and the website must give the
 * same counts and the same spots. So this runs `dryingPlan` here over a set of rooms and writes what
 * it gave, input and output together; the app's DryingPlanGoldenTest feeds the very same rooms to
 * the Kotlin and holds it to every count exactly and every spot and heading to within 1e-6.
 *
 * Its home in the app is android/app/src/test/resources/drying_golden.json. Run this again after any
 * change to lib/dryingPlan.ts or lib/equipment.ts, copy the change into DryingPlan.kt, and the app's
 * test says whether the two still agree.
 */

import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const target = process.argv[2];
if (!target) {
  console.error("usage: node test/drying/golden.mjs <out.json>");
  process.exit(2);
}

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "drying-golden-"));
  const entry = join(outDir, "entry.ts");
  const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
  writeFileSync(
    entry,
    [
      `export * from "${lib("dryingPlan.ts")}";`,
      `export { WALL_BASE_FEET, LGR_FACTOR, DESICCANT_ACH, DEHUMIDIFIER_SIZES, DEFAULT_EQUIPMENT_SETTINGS } from "${lib("equipment.ts")}";`,
    ].join("\n"),
  );
  const outfile = join(outDir, "drying.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const m = await load();

/* ── settings ─────────────────────────────────────────────────────────────────────────────────── */

const settings = (waterClass, dehumidifierType, dehumidifierSize) => ({ waterClass, dehumidifierType, dehumidifierSize });
const LGR = settings(2, "lgr", "medium");

/* ── rooms ────────────────────────────────────────────────────────────────────────────────────── */

/** A typed-in rectangle: every wall wet to 2 ft and the whole floor, unless told otherwise. */
function rect(over = {}) {
  return {
    id: "r1",
    name: "Bedroom",
    lengthFeet: 12,
    widthFeet: 10,
    heightFeet: 8,
    wetWalls: [true, true, true, true],
    wetHeightFeet: 2,
    wetFloorShare: 1,
    wetCeilingShare: 0,
    insetsOver18Inches: 0,
    ...over,
  };
}

/** Half the shoelace sum: the floor area the caller would hand in for a drawn room. */
function area(outline) {
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

const pts = (list) => list.map(([x, y]) => ({ x, y }));
const span = (wall, fromFeet, toFeet) => ({ wall, fromFeet, toFeet });

/** A room drawn or scanned rather than typed: its own outline, doorways and wet stretches. */
function drawn(id, corners, { openings = [], wetWalls = [], height = 8, floor = 0, upper = 0, insets = 0, name = id } = {}) {
  const outline = pts(corners);
  return {
    id,
    name,
    outline,
    openings,
    wetWalls,
    floorSquareFeet: area(outline),
    ceilingHeightFeet: height,
    wet: { affectedFloorSquareFeet: floor, affectedUpperSquareFeet: upper, insetsAndOffsetsOver18Inches: insets },
  };
}

/** The same room with its outline run the other way round, wall `i` renumbered to match. */
function reversed(room) {
  const n = room.outline.length;
  // Reversed, corner k is the old corner n-1-k, so the old wall i (corner i to i+1) runs from new corner
  // n-2-i to n-1-i: new wall n-2-i, measured from the other end.
  const flip = (s) => {
    const wall = (((n - 2 - s.wall) % n) + n) % n;
    const old = room.outline;
    const a = old[s.wall];
    const b = old[(s.wall + 1) % n];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return { wall, fromFeet: length - s.toFeet, toFeet: length - s.fromFeet };
  };
  return { ...room, outline: [...room.outline].reverse(), openings: room.openings.map(flip), wetWalls: room.wetWalls.map(flip) };
}

/* ── cases ────────────────────────────────────────────────────────────────────────────────────── */

const cases = [];

/** A case of typed-in rectangles: the inputs go in the file too, so the port's rectangleRoom is checked. */
function typed(name, inputs, using = LGR) {
  const rooms = inputs.map((input) => m.rectangleRoom(input));
  cases.push({ name, settings: using, rectangles: inputs, rooms });
}

/** A case of rooms given as they are. */
function given(name, rooms, using = LGR) {
  cases.push({ name, settings: using, rectangles: rooms.map(() => null), rooms });
}

// Walls and floors.
typed("rectangle, one wall wet to 4 ft", [rect({ lengthFeet: 20, widthFeet: 12, wetWalls: [true, false, false, false], wetHeightFeet: 4, wetFloorShare: 0 })]);
typed("rectangle, every wall wet to 2 ft and the whole floor", [rect()]);
typed("rectangle, every wall wet to 3.5 ft and half the ceiling", [rect({ wetHeightFeet: 3.5, wetCeilingShare: 0.5 })]);
typed("one wall wet only below 2 ft", [rect({ wetHeightFeet: 1.5, wetFloorShare: 0, wetWalls: [true, false, false, false] })]);
typed("two walls wet to 6 in: the base mover goes on the longer", [
  rect({ lengthFeet: 14, widthFeet: 9, wetHeightFeet: 0.5, wetFloorShare: 0, wetWalls: [false, true, true, false] }),
]);
typed("walls ticked but nothing up them, floor dry", [rect({ wetHeightFeet: 0, wetFloorShare: 0 })]);
typed("floor only", [rect({ wetWalls: [false, false, false, false] })]);
typed("part of the floor only, odd sizes", [rect({ lengthFeet: 17.25, widthFeet: 11.5, wetWalls: [false, false, false, false], wetFloorShare: 0.37 })]);
typed("ceiling wet, nothing else", [rect({ lengthFeet: 14, widthFeet: 12, heightFeet: 9, wetWalls: [false, false, false, false], wetFloorShare: 0, wetCeilingShare: 1 })]);
typed("walls to 5.25 ft, part of the ceiling and floor, tall", [
  rect({ lengthFeet: 16, widthFeet: 13, heightFeet: 10, wetHeightFeet: 5.25, wetCeilingShare: 0.4, wetFloorShare: 0.6 }),
]);
typed("shares out of range are clamped", [rect({ wetFloorShare: 1.7, wetCeilingShare: -0.3, wetWalls: [false, true, false, false], wetHeightFeet: 6 })]);

// Insets.
typed("insets over 18 in", [rect({ insetsOver18Inches: 3 })]);
typed("a fractional inset count alone", [rect({ wetWalls: [false, false, false, false], wetFloorShare: 0, insetsOver18Inches: 2.6 })]);

// More movers than the wet walls take, and more than any wall takes.
typed("movers spill onto dry walls once the wet one is full", [rect({ lengthFeet: 30, widthFeet: 20, wetWalls: [true, false, false, false], wetHeightFeet: 4 })]);
typed("a big wet room", [rect({ lengthFeet: 30, widthFeet: 22, wetCeilingShare: 1 })]);
typed("too small for its movers", [rect({ lengthFeet: 6, widthFeet: 6, wetHeightFeet: 4, insetsOver18Inches: 10 })]);
typed("a corridor narrower than the mover offset", [rect({ lengthFeet: 20, widthFeet: 0.8, wetHeightFeet: 3 })]);
typed("a 2.5 ft hall: the dehumidifier clearances relax", [rect({ lengthFeet: 24, widthFeet: 2.5, wetFloorShare: 1 })]);
typed("a closet: no wall long enough for a mover", [rect({ lengthFeet: 3, widthFeet: 2.5, wetHeightFeet: 3 })]);
typed("a room with no height", [rect({ heightFeet: 0 })]);

// Names.
typed("names are trimmed, an empty one named", [
  rect({ id: "a", name: "﻿ Den   " }),
  rect({ id: "b", name: "   ", lengthFeet: 9, widthFeet: 8 }),
  rect({ id: "c", name: "", lengthFeet: 7, widthFeet: 6 }),
]);

// Shapes and windings.
const square16 = m.rectangleRoom(rect({ id: "cw", name: "Clockwise", lengthFeet: 16, widthFeet: 12, wetWalls: [true, true, false, false], wetHeightFeet: 3 }));
given("rectangle drawn clockwise, two walls wet", [square16]);
given("the same rectangle drawn counter-clockwise", [{ ...reversed(square16), id: "ccw", name: "Counter-clockwise" }]);
given("counter-clockwise, floor only: movers still chase clockwise", [
  { ...m.rectangleRoom(rect({ lengthFeet: 16, widthFeet: 12 })), outline: pts([[0, 12], [16, 12], [16, 0], [0, 0]]), wetWalls: [] },
]);

const L = drawn("L", [[0, 0], [20, 0], [20, 4], [4, 4], [4, 20], [0, 20]], {
  wetWalls: [span(0, 0, 20), span(3, 2, 16), span(2, 0, 9)],
  floor: 100,
  upper: 60,
  insets: 1,
});
given("an L whose middle is outside it", [L]);
given("the L drawn counter-clockwise", [{ ...reversed(L), id: "L-ccw" }]);

const L2 = drawn("L2", [[0, 0], [12, 0], [12, 16], [7, 16], [7, 9], [0, 9]], {
  openings: [span(4, 2, 5)],
  wetWalls: [span(1, 0, 16), span(3, 0, 7), span(4, 0, 7)],
  floor: 140,
  upper: 135,
});
given("a second L, a door on its inside wall", [L2]);
given("the second L counter-clockwise", [{ ...reversed(L2), id: "L2-ccw" }]);

given("an angled corner: a 45 degree wall", [
  drawn("bay", [[0, 0], [14, 0], [14, 8], [10, 12], [0, 12]], { wetWalls: [span(1, 0, 8), span(2, 0, 6)], floor: 80, upper: 40, insets: 1 }),
]);
given("an outline off square, as a scan draws one", [
  drawn("scan", [[0.3, 0.7], [13.37, 1.1], [12.9, 10.45], [-0.2, 9.8]], {
    openings: [span(2, 4.1, 6.9)],
    wetWalls: [span(0, 0, 13.08), span(1, 0.5, 9.4), span(3, 1, 8.8)],
    height: 8.25,
    floor: 61.7,
    upper: 143.2,
  }),
]);
given("a repeated corner: a wall of no length", [
  drawn("dup", [[0, 0], [10, 0], [10, 0], [10, 8], [0, 8]], { wetWalls: [span(0, 0, 10), span(1, 0, 1), span(2, 0, 8)], floor: 80, upper: 30 }),
]);

// Doorways.
given("doorways with wet walls running through them", [
  drawn("hall", [[0, 0], [16, 0], [16, 12], [0, 12]], {
    openings: [span(0, 5, 8), span(2, 3, 6), span(1, 9.5, 12.5), span(7, 0, 3)],
    // Wall 2 past both its ends, wall 1 in two overlapping pieces, wall 3 backwards (nothing).
    wetWalls: [span(0, 0, 16), span(2, -1, 20), span(1, 2, 5), span(1, 4, 8), span(3, 6, 4)],
    floor: 96,
    upper: 260,
    insets: 2,
  }),
]);
given("a door beside the middle pushes the dehumidifier off it", [{ ...m.rectangleRoom(rect({ lengthFeet: 12, widthFeet: 7 })), openings: [span(2, 4.5, 7.5)] }]);
given("a missing wall end to end", [{ ...m.rectangleRoom(rect({ lengthFeet: 14, widthFeet: 10, wetHeightFeet: 3.5 })), openings: [span(1, 0, 10)] }]);
given("a doorway in every wall", [
  {
    ...m.rectangleRoom(rect({ lengthFeet: 13, widthFeet: 11, wetCeilingShare: 1, insetsOver18Inches: 3 })),
    openings: [span(0, 1, 4), span(1, 7, 10), span(2, 5, 8), span(3, 0.5, 3.25)],
  },
]);

// Dehumidifiers in one room.
typed("two LGRs in a long room are spread along it", [rect({ lengthFeet: 40, widthFeet: 12 })], settings(3, "lgr", "small"));
typed("two LGRs in a deep room are spread down it", [rect({ lengthFeet: 12, widthFeet: 40 })], settings(3, "lgr", "small"));
typed("a warehouse: the grid coarsens", [
  rect({ id: "w", name: "Warehouse", lengthFeet: 120, widthFeet: 90, heightFeet: 10, wetFloorShare: 0.2, wetHeightFeet: 2.5 }),
], settings(1, "lgr", "large"));

// Dehumidifiers shared by volume.
typed("two rooms: the small one gets the remainder", [
  rect({ id: "a", name: "Living", lengthFeet: 25, widthFeet: 25 }),
  rect({ id: "b", name: "Den", lengthFeet: 12.5, widthFeet: 20 }),
]);
typed("two equal rooms, one unit: the earlier room gets it", [rect({ id: "a", name: "Left" }), rect({ id: "b", name: "Right" })]);
typed("two rooms, remainders tied: the bigger room gets it", [
  rect({ id: "a", name: "Small", lengthFeet: 10, widthFeet: 15 }),
  rect({ id: "b", name: "Big", lengthFeet: 15, widthFeet: 30 }),
]);
typed("three rooms, two units", [
  rect({ id: "r1" }),
  rect({ id: "r2", name: "Family", lengthFeet: 30, widthFeet: 20 }),
  rect({ id: "r3", name: "Bath", lengthFeet: 5, widthFeet: 8 }),
]);
typed("three rooms, three units", [
  rect({ id: "r1" }),
  rect({ id: "r2", name: "Family", lengthFeet: 30, widthFeet: 20 }),
  rect({ id: "r3", name: "Bath", lengthFeet: 5, widthFeet: 8 }),
], settings(3, "lgr", "small"));
typed("three equal rooms, two units", [rect({ id: "a" }), rect({ id: "b" }), rect({ id: "c" })], settings(4, "lgr", "small"));
given("a drawn room and a typed one, with a room of no height", [
  L2,
  m.rectangleRoom(rect({ id: "t", name: "Typed", lengthFeet: 18, widthFeet: 14 })),
  m.rectangleRoom(rect({ id: "z", name: "Flat", heightFeet: 0 })),
], settings(3, "lgr", "medium"));
given("no rooms", []);

// Water classes, unit sizes, types.
for (const waterClass of [1, 2, 3, 4]) {
  typed(`water class ${waterClass}, LGR`, [rect({ lengthFeet: 40, widthFeet: 30, heightFeet: 10 })], settings(waterClass, "lgr", "medium"));
}
for (const size of ["small", "medium", "large"]) {
  typed(`LGR ${size}`, [rect({ lengthFeet: 36, widthFeet: 24 })], settings(2, "lgr", size));
}
for (const size of ["small", "medium", "large"]) {
  typed(`desiccant ${size}: counted, not placed`, [rect({ lengthFeet: 40, widthFeet: 30 })], settings(3, "desiccant", size));
}
for (const waterClass of [1, 2, 3, 4]) {
  typed(`water class ${waterClass}, desiccant, two big rooms`, [
    rect({ id: "a", name: "Hall A", lengthFeet: 150, widthFeet: 100, heightFeet: 12, wetFloorShare: 0.05 }),
    rect({ id: "b", name: "Hall B", lengthFeet: 60, widthFeet: 40, heightFeet: 12, wetFloorShare: 0.1 }),
  ], settings(waterClass, "desiccant", "small"));
}
typed("the default settings", [rect({ lengthFeet: 22, widthFeet: 15 })], m.DEFAULT_EQUIPMENT_SETTINGS);

/* ── shareByVolume on its own ─────────────────────────────────────────────────────────────────── */

const shareInputs = [
  [[1000, 400], 2],
  [[1000, 400, 300], 1],
  [[500, 500], 1],
  [[0, 0], 3],
  [[3600, 1200], 2],
  [[960, 288, 1400, 75], 1],
  [[960, 288, 1400, 75], 2],
  [[960, 288, 1400, 75], 3],
  [[960, 288, 1400, 75], 5],
  [[960, 288, 1400, 75], 8],
  [[-50, 100, 100], 1],
  [[100, 200], 0],
  [[123.45, 678.9, 10.11, 345.67, 345.67], 7],
  [[1, 1, 1], 2],
  [[0.1, 0.2, 0.3], 1],
];
const shares = shareInputs.map(([volumes, total]) => ({ volumes, total, out: m.shareByVolume(volumes, total) }));

/* ── write ────────────────────────────────────────────────────────────────────────────────────── */

for (const c of cases) {
  c.hasWetArea = c.rooms.map((room) => m.hasWetArea(room));
  c.plan = m.dryingPlan(c.rooms, c.settings);
}

const constants = {
  MOVER_OFF_WALL_FEET: m.MOVER_OFF_WALL_FEET,
  MOVER_AIM_DEG: m.MOVER_AIM_DEG,
  MOVER_SPACING_FEET: m.MOVER_SPACING_FEET,
  CORNER_CLEARANCE_FEET: m.CORNER_CLEARANCE_FEET,
  DOORWAY_MARGIN_FEET: m.DOORWAY_MARGIN_FEET,
  DEHU_WALL_CLEARANCE_FEET: m.DEHU_WALL_CLEARANCE_FEET,
  DEHU_DOOR_CLEARANCE_FEET: m.DEHU_DOOR_CLEARANCE_FEET,
  DEHU_SEPARATION_FEET: m.DEHU_SEPARATION_FEET,
  WALL_BASE_FEET: m.WALL_BASE_FEET,
  LGR_FACTOR: m.LGR_FACTOR,
  DESICCANT_ACH: m.DESICCANT_ACH,
  DEHUMIDIFIER_SIZES: m.DEHUMIDIFIER_SIZES,
  DEFAULT_EQUIPMENT_SETTINGS: m.DEFAULT_EQUIPMENT_SETTINGS,
};

const out = resolve(target);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ source: "ScopeAssistantWeb test/drying/golden.mjs", constants, cases, shares }, null, 1)}\n`);
const movers = cases.reduce((s, c) => s + c.plan.rooms.reduce((t, r) => t + r.airMoverSpots.length, 0), 0);
const dehus = cases.reduce((s, c) => s + c.plan.rooms.reduce((t, r) => t + r.dehumidifierSpots.length, 0), 0);
console.log(`drying golden: ${cases.length} cases, ${movers} mover spots, ${dehus} dehumidifier spots, ${shares.length} shares -> ${out}`);
