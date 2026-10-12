/**
 * The drying plan: equipment counts and where the equipment goes.
 *
 *   npm run test:drying
 *
 * lib/dryingPlan.ts is the engine behind the public drying calculator, and the one Scan's moisture
 * maps are meant to drive next. It must not be a second set of maths. So the first thing checked here
 * is that its counts are the sketch equipment panel's counts, room for room, for a rectangle typed in
 * and for a sketch marked up — and only then that the layout keeps to its rules:
 *
 *   * movers stand a foot off the wet walls, inside the room, aimed into the wall and all the same
 *     way round, whatever way the outline was drawn
 *   * they keep out of doorways, spill onto dry walls only when the wet ones are full, and any the
 *     walls cannot take are reported rather than crammed in
 *   * dehumidifiers stand in the middle, clear of walls and doors, inside even an L, and the job's
 *     total is dealt to rooms without a single unit gained or lost
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "drying-tests-"));
  const entry = join(outDir, "entry.ts");
  const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
  writeFileSync(
    entry,
    [
      `export * from "${lib("dryingPlan.ts")}";`,
      `export * from "${lib("dryingPlanSketch.ts")}";`,
      `export { claimEquipment, roomEquipment, DEFAULT_EQUIPMENT_SETTINGS } from "${lib("equipment.ts")}";`,
      `export { PIXELS_PER_FOOT, isInsideRoom } from "${lib("sketch.ts")}";`,
      `export { emptyMoistureMap, emptyRoomMoisture } from "${lib("moisture.ts")}";`,
    ].join("\n"),
  );
  const outfile = join(outDir, "drying.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const m = await load();

let passed = 0;
const failures = [];

function test(name, run) {
  try {
    run();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const equal = (actual, expected, message) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n      expected ${e}\n      actual   ${a}`);
};

const near = (actual, expected, tolerance, message) => {
  if (!(Math.abs(actual - expected) <= tolerance)) throw new Error(`${message}\n      expected ${expected} ± ${tolerance}\n      actual   ${actual}`);
};

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

const LGR = { waterClass: 2, dehumidifierType: "lgr", dehumidifierSize: "medium" };
const PX = m.PIXELS_PER_FOOT;

/** A typed-in rectangle: every wall wet to 2 ft and the whole floor, unless told otherwise. */
function rect(over = {}) {
  return m.rectangleRoom({
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
  });
}

/** A sketch room, in world pixels, clockwise. */
function sketchRoom(id, vertices, extra = {}) {
  return {
    id,
    name: id,
    vertices: vertices.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
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

const box = (id, x, y, wFeet, hFeet, extra = {}) =>
  sketchRoom(id, [[x, y], [x + wFeet * PX, y], [x + wFeet * PX, y + hFeet * PX], [x, y + hFeet * PX]], extra);

function door(id, wallId, t, widthFeet = 3) {
  return { id, type: "door", wallId, t, widthFraction: 0.25, widthFeet, doorType: "swing", leaves: "single", heightFeet: 6 + 8 / 12, flipX: false, flipY: false };
}

function reading(id, wallId, { startT = 0, endT = 1, height = 2 } = {}) {
  return { id, wallId, startT, endT, affectedHeightFeet: height, material: "drywall", reading: 3, dryStandard: 0.75 };
}

/** Every cell of a w x h ft floor, or the first `rows` rows of it. */
function paint(wFeet, hFeet, rows = hFeet * 4) {
  const cells = [];
  for (let col = 0; col < wFeet * 4; col++) for (let row = 0; row < rows; row++) cells.push(`${col},${row}`);
  return cells;
}

function moisture(rooms) {
  const map = m.emptyMoistureMap();
  for (const [id, data] of Object.entries(rooms)) map.rooms[id] = { ...m.emptyRoomMoisture(), ...data };
  return map;
}

function inside(outline, x, y) {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function segmentGap(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

const wallGap = (outline, p) => Math.min(...outline.map((a, i) => segmentGap(p, a, outline[(i + 1) % outline.length])));

/**
 * For a spot a foot inside an L x W rectangle at the origin: whether its heading runs along its wall
 * clockwise on screen (top rightwards, right down, bottom leftwards, left up) and into that wall.
 */
function aimedClockwiseIntoWall(spot, length, width) {
  const rad = (spot.headingDeg * Math.PI) / 180;
  const h = { x: Math.cos(rad), y: Math.sin(rad) };
  const sides = [
    { gap: spot.y, along: { x: 1, y: 0 }, out: { x: 0, y: -1 } },
    { gap: length - spot.x, along: { x: 0, y: 1 }, out: { x: 1, y: 0 } },
    { gap: width - spot.y, along: { x: -1, y: 0 }, out: { x: 0, y: 1 } },
    { gap: spot.x, along: { x: 0, y: -1 }, out: { x: -1, y: 0 } },
  ];
  const side = sides.reduce((best, s) => (s.gap < best.gap ? s : best));
  return h.x * side.along.x + h.y * side.along.y > 0.5 && h.x * side.out.x + h.y * side.out.y > 0.5;
}

/* ── counts: the panel's numbers, not new ones ────────────────────────────────────────────────── */

test("a 12 x 10 x 8 room, walls wet to 2 ft and the whole floor: 5 movers, 1 medium LGR", () => {
  const plan = m.dryingPlan([rect()], LGR);
  // 1 base + 120 / 50 -> 3 + (44 ft x 2 ft) / 100 -> 1.
  equal(plan.rooms[0].airMovers.breakdown, { base: 1, floor: 3, upper: 1, insets: 0 }, "breakdown");
  equal(plan.totalAirMovers, 5, "movers");
  // 960 cu ft / 50 = 19.2 PPD, one 70 PPD unit.
  near(plan.dehumidifiers.required, 19.2, 1e-9, "PPD");
  equal(plan.dehumidifiers.units, 1, "dehumidifiers");
});

test("a typed rectangle gives what the same room marked up on a sketch gives", () => {
  const room = box("bed", 0, 0, 12, 10);
  const walls = room.vertices.map((v) => v.id);
  const map = moisture({
    bed: { wallReadings: walls.map((id, i) => reading(`r${i}`, id)), floorCells: paint(12, 10), ceilingCells: paint(12, 10, 20) },
  });
  const panel = m.roomEquipment(room, map, LGR);
  const typed = m.dryingPlan([rect({ wetCeilingShare: 0.5 })], LGR).rooms[0];
  equal(typed.airMovers.breakdown, panel.airMovers.breakdown, "air mover breakdown");
  equal(typed.airMovers.units, panel.airMovers.units, "air movers");
});

test("the sketch plan matches claimEquipment room for room, and in total", () => {
  const living = box("living", 0, 0, 20, 14, { ceilingHeightFeet: 9 });
  const hall = box("hall", 20 * PX, 0, 4, 14);
  const bath = box("bath", 24 * PX, 0, 8, 6);
  const dry = box("dry", 24 * PX, 6 * PX, 8, 8);
  const sketch = { rooms: [living, hall, bath, dry] };
  const map = moisture({
    // Two walls read, part of one of them, the floor half painted, a bit of ceiling, two insets.
    living: {
      wallReadings: [reading("a", living.vertices[0].id, { startT: 0.2, endT: 0.7, height: 3 }), reading("b", living.vertices[1].id, { height: 1.5 })],
      floorCells: paint(20, 14, 28),
      ceilingCells: paint(4, 4),
      insetsOver18Inches: 2,
    },
    // No readings: every wall assumed wet to ceiling less 2 ft, as the panel does.
    hall: { floorCells: paint(4, 14) },
    // Only an inset counted.
    bath: { insetsOver18Inches: 1 },
  });
  for (const settings of [LGR, { waterClass: 3, dehumidifierType: "desiccant", dehumidifierSize: "small" }, { waterClass: 1, dehumidifierType: "lgr", dehumidifierSize: "small" }]) {
    const panel = m.claimEquipment(sketch, map, settings);
    const plan = m.sketchDryingPlan(sketch, map, settings);
    equal(
      plan.rooms.map((r) => [r.roomId, r.airMovers.units, r.airMovers.breakdown]),
      panel.rooms.map((r) => [r.roomId, r.airMovers.units, r.airMovers.breakdown]),
      `rooms and air movers (${settings.dehumidifierType})`,
    );
    equal(plan.totalAirMovers, panel.totalAirMovers, "total air movers");
    equal(plan.dehumidifiers, panel.totalDehumidifiers, `dehumidifiers (${settings.dehumidifierType})`);
  }
});

test("a room with walls ticked but nothing wet up them has nothing to dry", () => {
  assert(!m.hasWetArea(rect({ wetHeightFeet: 0, wetFloorShare: 0 })), "walls at 0 ft and a dry floor is not a wet room");
  assert(m.hasWetArea(rect({ wetWalls: [false, false, false, false], wetFloorShare: 0, insetsOver18Inches: 1 })), "an inset alone still gets its mover");
});

/* ── air movers ───────────────────────────────────────────────────────────────────────────────── */

test("every mover stands inside the room, a foot off a wall, and none goes missing", () => {
  for (const room of [rect(), rect({ lengthFeet: 30, widthFeet: 22, wetCeilingShare: 1 }), rect({ wetWalls: [true, false, false, false] })]) {
    const [plan] = m.dryingPlan([room], LGR).rooms;
    equal(plan.airMoverSpots.length + plan.airMoversUnplaced, plan.airMovers.units, `placed + unplaced = count (${room.outline[2].x} x ${room.outline[2].y})`);
    for (const spot of plan.airMoverSpots) {
      assert(inside(room.outline, spot.x, spot.y), `inside: ${spot.x}, ${spot.y}`);
      near(wallGap(room.outline, spot), m.MOVER_OFF_WALL_FEET, 1e-9, "off the wall");
    }
  }
});

test("movers are aimed into their wall and all chase each other clockwise, however the outline was drawn", () => {
  const room = rect({ lengthFeet: 16, widthFeet: 12 });
  const backwards = { ...room, outline: [...room.outline].reverse(), wetWalls: [] };
  for (const r of [room, backwards]) {
    const [plan] = m.dryingPlan([r], LGR).rooms;
    assert(plan.airMoverSpots.length > 3, "several movers");
    for (const spot of plan.airMoverSpots) {
      assert(aimedClockwiseIntoWall(spot, 16, 12), `clockwise and into the wall at ${spot.x}, ${spot.y} heading ${spot.headingDeg}`);
    }
  }
  // On the top wall, running left to right: right and up, 45 degrees into the wall.
  const top = m.dryingPlan([rect({ wetWalls: [true, false, false, false], wetFloorShare: 0 })], LGR).rooms[0].airMoverSpots;
  assert(top.length > 0 && top.every((s) => s.wall === 0), "on the top wall");
  for (const s of top) near(s.headingDeg, -45, 1e-9, "heading on the top wall");
});

test("with one wet wall the movers go on it, evenly spaced", () => {
  // 20 ft wall wet to 2 ft = 40 sq ft -> 1, plus the base: 2 movers.
  const room = rect({ lengthFeet: 20, widthFeet: 12, wetWalls: [true, false, false, false], wetFloorShare: 0 });
  const spots = m.dryingPlan([room], LGR).rooms[0].airMoverSpots;
  equal(spots.length, 2, "two movers");
  assert(spots.every((s) => s.wall === 0 && Math.abs(s.y - 1) < 1e-9), "both on the top wall, a foot in");
  // Usable stretch 1.5 to 18.5: quarter points.
  equal(spots.map((s) => s.x), [5.75, 14.25], "spread along it");
});

test("one mover goes on the longest wet wall", () => {
  // Two wet walls, 9 ft and 14 ft, with their area taken out of the count so only the base mover is left.
  const room = rect({ lengthFeet: 14, widthFeet: 9, wetHeightFeet: 0.5, wetFloorShare: 0, wetWalls: [false, true, true, false] });
  const one = m.dryingPlan([{ ...room, wet: { ...room.wet, affectedUpperSquareFeet: 0 } }], LGR).rooms[0];
  equal(one.airMovers.units, 1, "the base mover only");
  equal(one.airMoverSpots.map((s) => s.wall), [2], "on the bottom wall, the longer of the two wet ones");
});

test("no mover stands in a doorway", () => {
  // 1 + 3 floor + 3 walls and ceiling + 2 insets = 9, enough to fill every free stretch, the door wall's too.
  const room = { ...rect({ lengthFeet: 12, widthFeet: 10, wetCeilingShare: 1, insetsOver18Inches: 2 }), openings: [{ wall: 2, fromFeet: 4, toFeet: 7 }] };
  const spots = m.dryingPlan([room], LGR).rooms[0].airMoverSpots;
  // Wall 2 runs right to left from (12, 10): 4..7 ft along it is x 8..5, plus the margin.
  const inDoor = spots.filter((s) => s.wall === 2 && s.x > 5 - m.DOORWAY_MARGIN_FEET && s.x < 8 + m.DOORWAY_MARGIN_FEET);
  equal(inDoor.length, 0, "clear of the door");
  assert(spots.some((s) => s.wall === 2), "the rest of that wall still gets movers");
});

test("movers spill onto dry walls only once the wet walls are full", () => {
  // 1 + 600 / 50 -> 12 + (30 ft x 2 ft) / 100 -> 1 = 14; the top wall takes 27 ft / 3 = 9.
  const room = rect({ lengthFeet: 30, widthFeet: 20, wetWalls: [true, false, false, false] });
  const plan = m.dryingPlan([room], LGR).rooms[0];
  equal(plan.airMovers.units, 14, "count");
  equal(plan.airMoverSpots.filter((s) => s.wall === 0).length, 9, "the wet wall full");
  equal(plan.airMoverSpots.length, 14, "the rest on the dry walls");
  equal(plan.airMoversUnplaced, 0, "nothing left over");
});

test("a floor-only room is ringed by movers", () => {
  const plan = m.dryingPlan([rect({ wetWalls: [false, false, false, false] })], LGR).rooms[0];
  equal(plan.airMovers.units, 4, "1 + 120 / 50 -> 3");
  equal([...new Set(plan.airMoverSpots.map((s) => s.wall))], [0, 1, 2, 3], "one to a wall");
});

test("movers the walls cannot take are reported, not crammed in", () => {
  // A 6 x 6 room: each wall has 3 ft between its corner clearances, room for one. Ten insets.
  const plan = m.dryingPlan([rect({ lengthFeet: 6, widthFeet: 6, insetsOver18Inches: 10 })], LGR).rooms[0];
  equal(plan.airMovers.units, 13, "1 + 1 floor + 1 walls + 10 insets");
  equal(plan.airMoverSpots.length, 4, "one to a wall");
  equal(plan.airMoversUnplaced, 9, "the rest said");
});

/* ── dehumidifiers ────────────────────────────────────────────────────────────────────────────── */

test("one LGR stands in the middle of a plain room", () => {
  const [spot] = m.dryingPlan([rect()], LGR).rooms[0].dehumidifierSpots;
  equal([spot.x, spot.y], [6, 5], "dead centre");
  equal(spot.headingDeg, 0, "along the long side");
});

test("and moves off the middle to keep clear of a door, but not into a wall", () => {
  // The middle of a 12 x 7 room is 3.5 ft from a door centred in the bottom wall.
  const room = { ...rect({ lengthFeet: 12, widthFeet: 7 }), openings: [{ wall: 2, fromFeet: 4.5, toFeet: 7.5 }] };
  const [spot] = m.dryingPlan([room], LGR).rooms[0].dehumidifierSpots;
  const doorGap = segmentGap(spot, { x: 7.5, y: 7 }, { x: 4.5, y: 7 });
  assert(doorGap >= m.DEHU_DOOR_CLEARANCE_FEET, `4 ft from the door: ${doorGap}`);
  assert(wallGap(room.outline, spot) >= m.DEHU_WALL_CLEARANCE_FEET, `2 ft from the walls: ${wallGap(room.outline, spot)}`);
  near(spot.x, 6, 0.25, "still centred along the room");
});

test("in an L whose middle is outside it, the dehumidifier still lands inside", () => {
  const outline = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 20 },
    { x: 0, y: 20 },
  ];
  const room = { ...rect(), outline, wetWalls: [], floorSquareFeet: 144 };
  const [spot] = m.dryingPlan([room], LGR).rooms[0].dehumidifierSpots;
  assert(inside(outline, spot.x, spot.y), `inside the L: ${spot.x}, ${spot.y}`);
});

test("two dehumidifiers in a long room are spread along it", () => {
  // 40 x 12 x 8 = 3,840 cu ft, class 3: 96 PPD over 69 PPD units = 2.
  const plan = m.dryingPlan([rect({ lengthFeet: 40, widthFeet: 12 })], { waterClass: 3, dehumidifierType: "lgr", dehumidifierSize: "small" });
  const spots = plan.rooms[0].dehumidifierSpots;
  equal(plan.dehumidifiers.units, 2, "two units");
  equal(spots.length, 2, "both placed");
  assert(spots[0].x < 20 && spots[1].x > 20, `one each half: ${spots.map((s) => s.x)}`);
  assert(Math.hypot(spots[0].x - spots[1].x, spots[0].y - spots[1].y) >= m.DEHU_SEPARATION_FEET, "apart");
});

test("the job's dehumidifiers are dealt to rooms by volume without gaining or losing one", () => {
  equal(m.shareByVolume([1000, 400], 2), [1, 1], "the small room gets the remainder");
  equal(m.shareByVolume([1000, 400, 300], 1), [1, 0, 0], "one unit, the biggest room");
  equal(m.shareByVolume([500, 500], 1), [1, 0], "a tie goes to the earlier room");
  equal(m.shareByVolume([0, 0], 3), [0, 0], "no volume, nothing to deal");
  for (const total of [1, 2, 3, 5, 8]) {
    const shares = m.shareByVolume([960, 288, 1400, 75], total);
    equal(shares.reduce((s, n) => s + n, 0), total, `sums to ${total}`);
  }
  const plan = m.dryingPlan([rect(), rect({ id: "r2", lengthFeet: 30, widthFeet: 20 }), rect({ id: "r3", lengthFeet: 5, widthFeet: 8 })], LGR);
  equal(plan.rooms.reduce((s, r) => s + r.dehumidifierUnits, 0), plan.dehumidifiers.units, "rooms hold the whole total");
  equal(plan.rooms.reduce((s, r) => s + r.dehumidifierSpots.length, 0), plan.dehumidifiers.units, "every unit placed");
});

test("desiccants are counted but not placed: they stand outside and duct in", () => {
  const plan = m.dryingPlan([rect({ lengthFeet: 40, widthFeet: 30 })], { waterClass: 3, dehumidifierType: "desiccant", dehumidifierSize: "small" });
  assert(plan.dehumidifiers.units >= 1, "still sized");
  equal(plan.dehumidifiersPlaced, false, "not placed");
  equal(plan.rooms[0].dehumidifierUnits, 0, "no room's share");
  equal(plan.rooms[0].dehumidifierSpots, [], "no spot");
});

/* ── the sketch adapter ───────────────────────────────────────────────────────────────────────── */

test("a sketched room's doors, shared doors and missing walls become openings", () => {
  const bed = box("bed", 0, 0, 12, 10);
  // A 3 ft door on the bottom wall, centred: wall 2 runs right to left, so 4.5..7.5 ft along it.
  bed.symbols = [door("d1", bed.vertices[2].id, 0.5)];
  // The closet beside it shares the bed's right wall; the door in it is the bed's, seen from here.
  bed.symbols.push(door("d2", bed.vertices[1].id, 0.5, 2.5));
  const closet = box("closet", 12 * PX, 0, 4, 10, { missingWalls: [] });
  const den = box("den", 0, 10 * PX, 12, 10);
  den.missingWalls = [den.vertices[1].id];
  const rooms = [bed, closet, den];
  const map = moisture({ bed: { floorCells: paint(12, 10) } });

  const fromBed = m.dryingRoomFromSketch(bed, map, rooms).openings;
  equal(fromBed.map((o) => [o.wall, +o.fromFeet.toFixed(3), +o.toFeet.toFixed(3)]), [[2, 4.5, 7.5], [1, 3.75, 6.25]], "the bed's own doors");

  const fromCloset = m.dryingRoomFromSketch(closet, map, rooms).openings;
  // The closet's left wall (wall 3) runs bottom to top, so the bed's door at 3.75..6.25 down is 3.75..6.25 up too.
  equal(fromCloset.map((o) => [o.wall, +o.fromFeet.toFixed(3), +o.toFeet.toFixed(3)]), [[3, 3.75, 6.25]], "the door seen from the closet");

  const fromDen = m.dryingRoomFromSketch(den, map, rooms).openings;
  equal(fromDen.filter((o) => o.wall === 1).map((o) => [o.fromFeet, o.toFeet]), [[0, 10]], "the missing wall, end to end");
});

test("a sketched room's spots land inside it on the sketch, times PIXELS_PER_FOOT", () => {
  const living = sketchRoom("living", [[120, 60], [120 + 22 * PX, 60], [120 + 22 * PX, 60 + 16 * PX], [120 + 10 * PX, 60 + 16 * PX], [120 + 10 * PX, 60 + 24 * PX], [120, 60 + 24 * PX]]);
  const map = moisture({ living: { wallReadings: [reading("a", living.vertices[0].id), reading("b", living.vertices[5].id)], floorCells: paint(10, 20) } });
  const plan = m.sketchDryingPlan({ rooms: [living] }, map, LGR);
  const room = plan.rooms[0];
  assert(room.airMoverSpots.length > 0 && room.dehumidifierSpots.length === 1, "something placed");
  for (const s of [...room.airMoverSpots, ...room.dehumidifierSpots]) {
    assert(m.isInsideRoom(living, s.x * PX, s.y * PX), `on the sketch, inside the room: ${s.x * PX}, ${s.y * PX}`);
  }
  // The read walls take the movers first.
  assert(room.airMoverSpots.filter((s) => s.wall === 0 || s.wall === 5).length >= 2, "movers on the read walls");
});

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`drying plan: ${passed} passed`);
