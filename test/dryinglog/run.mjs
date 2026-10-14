/**
 * The drying log: visits, points, standards, goals, and what a saved claim does with them.
 *
 *   npm run test:dryinglog
 *
 * A drying log is read by the next person on the job and handed to an insurer, so what it says has to
 * follow from what was typed, and an old or damaged saved claim has to open rather than throw. The
 * things checked here are the ones that would otherwise fail quietly:
 *
 *   * a log is never "dry" by default: no reading, no standard, or a skipped point all say so
 *   * "complete" needs every point still being read to be read, and at its goal, at the LATEST visit
 *   * the standard a reading is judged against is the job's measured reference, and says when it is not
 *   * a saved claim from before the log, or with a damaged one, loads as a usable log
 *   * the moisture map's points become the log's points once, in the numbering the panel shows
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "dryinglog-tests-"));
  const entry = join(outDir, "entry.ts");
  const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
  writeFileSync(
    entry,
    [
      `export * from "${lib("dryingLog.ts")}";`,
      `export { SAVED_CLAIM_KEYS, emptySavedClaimState, parseSavedClaimState } from "${lib("claimState.ts")}";`,
      `export { emptySketch, PIXELS_PER_FOOT, wallsOf } from "${lib("sketch.ts")}";`,
      `export { emptyMoistureMap, emptyRoomMoisture, setReferenceReading, defaultDryStandard } from "${lib("moisture.ts")}";`,
    ].join("\n"),
  );
  const outfile = join(outDir, "dryinglog.mjs");
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

const PX = m.PIXELS_PER_FOOT;

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

const wallReading = (id, wallId, { material = "drywall", reading = 3, dryStandard = 0.75 } = {}) => ({
  id,
  wallId,
  startT: 0,
  endT: 1,
  affectedHeightFeet: 2,
  material,
  reading,
  dryStandard,
});

function mapOf(rooms, reference = {}) {
  const map = { rooms: {}, reference };
  for (const [id, data] of Object.entries(rooms)) map.rooms[id] = { ...m.emptyRoomMoisture(), ...data };
  return map;
}

function sketchOf(rooms, extra = {}) {
  return { ...m.emptySketch(), rooms, ...extra };
}

/** A kitchen with two wet walls, and a bedroom with one wall and a painted floor. */
function loss() {
  const kitchen = box("kitchen", 0, 0, 12, 10, { name: "Kitchen" });
  const bedroom = box("bedroom", 20 * PX, 0, 10, 10, { name: "Bedroom" });
  const map = mapOf(
    {
      kitchen: { wallReadings: [wallReading("w-a", "kitchen-v0", { reading: 4.2 }), wallReading("w-b", "kitchen-v2", { reading: null })] },
      bedroom: { wallReadings: [wallReading("w-c", "bedroom-v1", { material: "woodFraming", reading: 18, dryStandard: 11 })], floorCells: ["0,0", "1,0"], ceilingCells: ["0,0"] },
    },
    { drywall: 0.8 },
  );
  return { sketch: sketchOf([kitchen, bedroom]), map };
}

/** A log with a point per material and visits on given dates, readings by point index. */
function logWith(points, visits, over = {}) {
  const log = { ...m.emptyDryingLog(), ...over };
  log.points = points.map((p, i) => ({ id: `p${i}`, label: `Point ${i}`, roomId: null, surface: "wall", material: "drywall", origin: "added", standard: null, active: true, ...p }));
  log.visits = visits.map((v, i) => ({
    id: `v${i}`,
    at: v.at,
    by: "",
    meter: "",
    air: m.emptyAir(),
    readings: Object.fromEntries((v.readings ?? []).map((value, pi) => (value === null || value === undefined ? [] : [`p${pi}`, { value }])).filter((e) => e.length)),
    equipment: m.emptyEquipment(),
    notes: "",
  }));
  return log;
}

const REF = { drywall: 0.8, woodFraming: 11 };
const refMap = () => ({ rooms: {}, reference: { ...REF } });

/* ── loading a saved log ──────────────────────────────────────────────────────────────────────── */

test("anything that is not a log loads as an empty one", () => {
  for (const junk of [undefined, null, 5, "log", [], true]) {
    const log = m.normalizeDryingLog(junk);
    equal(log.points, [], `points for ${JSON.stringify(junk)}`);
    equal(log.visits, [], `visits for ${JSON.stringify(junk)}`);
    assert(log.goalMarginPercent === 10 && log.tempUnit === "F" && log.version === 1, "defaults");
  }
});

test("a partial log is filled in with today's defaults", () => {
  const log = m.normalizeDryingLog({ points: [{ id: "a", label: "Wall" }], visits: [{ id: "v", at: "2026-10-13T09:00" }] });
  const v = log.visits[0];
  equal(v.air, m.emptyAir(), "air");
  equal(v.equipment, m.emptyEquipment(), "equipment");
  assert(v.by === "" && v.meter === "" && v.notes === "", "text fields");
  assert(log.points[0].material === "drywall" && log.points[0].active === true && log.points[0].standard === null, "point defaults");
});

test("numbers that are not numbers become empty, and typed numbers survive", () => {
  const log = m.normalizeDryingLog({
    goalMarginPercent: "abc",
    points: [{ id: "a", standard: "0.8" }, { id: "b", standard: Number.NaN }, { id: "c", standard: 3 }],
    visits: [{ id: "v", at: "2026-10-13T09:00", air: { outside: { tempF: "50", rh: "x" } }, readings: { a: { value: "4.5" }, b: { value: "n/a" } } }],
  });
  assert(log.goalMarginPercent === 10, "margin falls back");
  equal(log.points.map((p) => p.standard), [0.8, null, 3], "standards");
  const v = log.visits[0];
  assert(v.air.outside.tempF === 50 && v.air.outside.rh === null, "air");
  assert(v.readings.a.value === 4.5 && v.readings.b.value === null, "readings");
});

test("an out-of-range goal margin falls back to the default", () => {
  assert(m.normalizeDryingLog({ goalMarginPercent: -5 }).goalMarginPercent === 10, "negative");
  assert(m.normalizeDryingLog({ goalMarginPercent: 400 }).goalMarginPercent === 10, "400");
  assert(m.normalizeDryingLog({ goalMarginPercent: 0 }).goalMarginPercent === 0, "zero is a real choice");
  assert(m.normalizeDryingLog({ goalMarginPercent: 15 }).goalMarginPercent === 15, "15");
});

test("duplicate ids are dropped, readings for missing points are pruned, an unknown material becomes drywall", () => {
  const log = m.normalizeDryingLog({
    points: [{ id: "a", material: "marble" }, { id: "a", label: "dupe" }, { id: "b", material: "concrete", surface: "ceiling" }],
    visits: [
      { id: "v1", at: "2026-10-13T09:00", readings: { a: { value: 1 }, gone: { value: 9 } } },
      { id: "v1", at: "2026-10-14T09:00" },
    ],
  });
  equal(log.points.map((p) => p.id), ["a", "b"], "points");
  assert(log.points[0].material === "drywall" && log.points[1].surface === "ceiling", "enums");
  equal(log.visits.length, 1, "visits");
  equal(Object.keys(log.visits[0].readings), ["a"], "pruned readings");
});

test("visits come back oldest first, and an undated visit is kept, last", () => {
  const log = m.normalizeDryingLog({
    visits: [{ id: "c", at: "2026-10-15T09:00" }, { id: "x", at: "garbage" }, { id: "a", at: "2026-10-13T08:00" }, { id: "b", at: "2026-10-13T16:00" }],
  });
  equal(log.visits.map((v) => v.id), ["a", "b", "c", "x"], "order");
  assert(log.visits[3].at === "", "bad date emptied");
});

test("loading is idempotent and survives a trip through JSON", () => {
  const { sketch, map } = loss();
  const started = m.startDryingLog({ sketch, map, now: "2026-10-13T14:00", by: "Sam", equipment: { airMovers: 4, dehumidifiers: 1 } });
  const once = m.normalizeDryingLog(JSON.parse(JSON.stringify(started)));
  equal(m.normalizeDryingLog(once), once, "normalising twice");
  equal(once, started, "a normalised log equals the one that was saved");
});

test("optional reading fields are carried through, junk ones dropped", () => {
  const log = m.normalizeDryingLog({
    points: [{ id: "a" }],
    visits: [{ id: "v", at: "2026-10-13T09:00", readings: { a: { value: 3, mode: "pinless", source: "photo", scale: "%MC", meter: "Tramex ME5", extra: 1 } } }],
  });
  equal(log.visits[0].readings.a, { value: 3, mode: "pinless", source: "photo", scale: "%MC", meter: "Tramex ME5" }, "reading");
  const bad = m.normalizeDryingLog({ points: [{ id: "a" }], visits: [{ id: "v", at: "2026-10-13T09:00", readings: { a: { value: 3, mode: "x", source: "carrier pigeon" } } }] });
  equal(bad.visits[0].readings.a, { value: 3 }, "junk modes removed");
});

/* ── a saved claim ────────────────────────────────────────────────────────────────────────────── */

test("the log is one of the saved keys, blank on a new claim", () => {
  assert(m.SAVED_CLAIM_KEYS.includes("dryingLog"), "SAVED_CLAIM_KEYS");
  equal(m.emptySavedClaimState().dryingLog, m.emptyDryingLog(), "a new claim");
});

test("a claim saved before the log existed opens with an empty one", () => {
  const old = { ...m.emptySavedClaimState() };
  delete old.dryingLog;
  const parsed = m.parseSavedClaimState(JSON.parse(JSON.stringify(old)));
  equal(parsed.dryingLog, m.emptyDryingLog(), "old claim");
});

test("a saved log round-trips through a claim, and a damaged one is repaired rather than thrown", () => {
  const { sketch, map } = loss();
  const log = m.startDryingLog({ sketch, map, now: "2026-10-13T14:00", by: "Sam" });
  const state = { ...m.emptySavedClaimState(), dryingLog: log };
  equal(m.parseSavedClaimState(JSON.parse(JSON.stringify(state))).dryingLog, log, "round trip");
  const damaged = JSON.parse(JSON.stringify(state));
  damaged.dryingLog.visits = "not an array";
  damaged.dryingLog.points = null;
  const parsed = m.parseSavedClaimState(damaged);
  equal(parsed.dryingLog.visits, [], "visits repaired");
  equal(parsed.dryingLog.points, [], "points repaired");
});

/* ── days ─────────────────────────────────────────────────────────────────────────────────────── */

test("the first visit is Day 1, and days are calendar days from it", () => {
  const log = logWith([], [{ at: "2026-10-13T22:30" }, { at: "2026-10-14T07:00" }, { at: "2026-10-16T12:00" }, { at: "2026-10-13T23:50" }]);
  // Sorted by the caller's order here: use the log as given, but days are by date.
  const sorted = m.normalizeDryingLog(log);
  equal(sorted.visits.map((v) => m.dayNumber(sorted, v)), [1, 1, 2, 4], "days");
});

test("a visit across a month end is counted by the calendar", () => {
  const log = logWith([], [{ at: "2026-01-30T09:00" }, { at: "2026-02-02T09:00" }]);
  equal(log.visits.map((v) => m.dayNumber(log, v)), [1, 4], "days");
});

test("an undated visit has no day", () => {
  const log = m.normalizeDryingLog({ visits: [{ id: "a", at: "2026-10-13T09:00" }, { id: "b", at: "" }] });
  assert(m.dayNumber(log, log.visits[1]) === null, "undated");
  assert(m.dayNumber(log, log.visits[0]) === 1, "dated");
});

/* ── standards and goals ──────────────────────────────────────────────────────────────────────── */

test("a point's own standard wins, then the job's measured reference, then the published range", () => {
  const point = { material: "drywall", standard: null };
  equal(m.standardFor({ ...point, standard: 1.2 }, refMap()), { value: 1.2, from: "point" }, "own");
  equal(m.standardFor(point, refMap()), { value: 0.8, from: "reference" }, "reference");
  equal(m.standardFor(point, { rooms: {}, reference: {} }), { value: m.defaultDryStandard("drywall"), from: "guide" }, "guide");
});

test("concrete has no published range, so with no reference there is no standard", () => {
  equal(m.standardFor({ material: "concrete", standard: null }, { rooms: {}, reference: {} }), { value: null, from: "unset" }, "concrete");
});

test("the reference is read live: correcting it corrects the judgement", () => {
  const point = { material: "drywall", standard: null };
  const map = refMap();
  assert(m.pointState(0.95, m.standardFor(point, map).value, 10) === "wet", "wet at 0.8 + 10%");
  const corrected = m.setReferenceReading(map, "drywall", 0.9);
  assert(m.pointState(0.95, m.standardFor(point, corrected).value, 10) === "dry", "dry once the reference is 0.9");
});

test("at the goal counts as dry, one step over does not, and the margin is the log's to set", () => {
  assert(m.goalLimit(11, 10) > 12.09 && m.goalLimit(11, 10) < 12.11, "11 + 10% is 12.1");
  // 8 + 25% is exactly 10 in binary floating point, so this one cannot pass by rounding luck.
  assert(m.goalLimit(8, 25) === 10, "8 + 25% is exactly 10");
  assert(m.pointState(10, 8, 25) === "dry", "a reading exactly at the limit is dry");
  assert(m.pointState(10.01, 8, 25) === "wet", "a hundredth over is wet");
  assert(m.pointState(12.1, 11, 10) === "dry", "exactly the limit");
  assert(m.pointState(12.2, 11, 10) === "wet", "over");
  assert(m.pointState(0.825, 0.75, 10) === "dry", "the floating-point case");
  assert(m.pointState(12.2, 11, 12) === "dry", "a 12% variance lets 12.2 through");
  assert(m.pointState(11.0001, 11, 0) === "wet", "no variance means at the standard");
});

test("a reading with nothing to compare to says so, and no reading says that", () => {
  assert(m.pointState(5, null, 10) === "no-standard", "no standard");
  assert(m.pointState(null, 11, 10) === "unread", "no reading");
  assert(m.pointState(null, null, 10) === "unread", "neither");
});

/* ── trends and history ───────────────────────────────────────────────────────────────────────── */

test("trend is to the hundredth, so a small real change is a change", () => {
  equal(m.trend(18.4, 15.1), { direction: "down", delta: -3.3 }, "down");
  equal(m.trend(11, 12.5), { direction: "up", delta: 1.5 }, "up");
  equal(m.trend(11, 11), { direction: "same", delta: 0 }, "same");
  // Found in the browser: drywall at 0.9 then 0.85 was reported as "no change" when the trend rounded to a tenth.
  equal(m.trend(0.9, 0.85), { direction: "down", delta: -0.05 }, "0.9 to 0.85 is a drop");
  equal(m.trend(0.8, 0.82), { direction: "up", delta: 0.02 }, "0.8 to 0.82 is a rise");
  equal(m.trend(0.1 + 0.2, 0.3), { direction: "same", delta: 0 }, "floating point is not a trend");
  assert(m.trend(null, 5) === null && m.trend(5, null) === null, "needs both");
});

test("the previous reading is the last one actually taken, skipping visits that did not read the point", () => {
  const log = logWith([{}], [{ at: "2026-10-13T09:00", readings: [18] }, { at: "2026-10-14T09:00", readings: [null] }, { at: "2026-10-15T09:00", readings: [14] }]);
  assert(m.previousReading(log, "v2", "p0").value === 18, "skips the empty visit");
  assert(m.previousReading(log, "v0", "p0") === null, "nothing before the first");
  assert(m.previousReading(log, "v1", "p0").visit.id === "v0", "its visit");
});

/* ── status ───────────────────────────────────────────────────────────────────────────────────── */

test("a log with no points is not complete, however empty", () => {
  const status = m.logStatus(logWith([], [{ at: "2026-10-13T09:00" }]), refMap());
  assert(status.complete === false && status.activePoints === 0, "empty");
  assert(m.logStatus(m.emptyDryingLog(), refMap()).complete === false, "no visits");
});

test("complete needs every active point read, and at its goal, at the latest visit", () => {
  const map = refMap();
  const points = [{ material: "drywall" }, { material: "woodFraming" }];
  const base = (readings) => logWith(points, [{ at: "2026-10-13T09:00", readings: [4, 18] }, { at: "2026-10-14T09:00", readings: [0.8, 11.5] }, { at: "2026-10-15T09:00", readings }]);
  assert(m.logStatus(base([0.7, 11.9]), map).complete === true, "both at goal");
  const skipped = m.logStatus(base([0.7, null]), map);
  assert(skipped.complete === false && skipped.unread === 1 && skipped.atGoal === 1, "a skipped point is unread, not dry");
  const wet = m.logStatus(base([0.7, 13]), map);
  assert(wet.complete === false && wet.wet === 1, "one still wet");
  equal([wet.visitCount, wet.day], [3, 3], "visit count and day");
});

test("a point that is at goal on an earlier visit but wet on the latest is wet", () => {
  const log = logWith([{ material: "woodFraming" }], [{ at: "2026-10-13T09:00", readings: [11] }, { at: "2026-10-14T09:00", readings: [16] }]);
  const status = m.logStatus(log, refMap());
  assert(status.wet === 1 && status.atGoal === 0 && !status.complete, "latest counts");
});

test("a point the tech stopped reading no longer holds the job open", () => {
  const log = logWith(
    [{ material: "drywall", active: false }, { material: "woodFraming" }],
    [{ at: "2026-10-13T09:00", readings: [0.8, 18] }, { at: "2026-10-14T09:00", readings: [null, 11.2] }],
  );
  const status = m.logStatus(log, refMap());
  assert(status.activePoints === 1 && status.complete === true, "only the active point counts");
});

test("a point with no standard blocks completion and is counted as such", () => {
  const log = logWith([{ material: "concrete" }], [{ at: "2026-10-13T09:00", readings: [30] }]);
  const status = m.logStatus(log, { rooms: {}, reference: {} });
  assert(status.noStandard === 1 && status.complete === false, "concrete without a reference");
});

test("the matrix says which day each point first came in at its goal", () => {
  const log = logWith(
    [{ material: "woodFraming" }, { material: "drywall" }],
    [{ at: "2026-10-13T09:00", readings: [18, 4] }, { at: "2026-10-15T09:00", readings: [12, 2] }, { at: "2026-10-16T09:00", readings: [11.4, 0.85] }],
  );
  const rows = m.readingMatrix(log, refMap());
  equal(rows.map((r) => r.dryOnDay), [3, 4], "dry days (Oct 15 is Day 3, Oct 16 is Day 4)");
  equal(rows[0].cells.map((c) => c.state), ["wet", "dry", "dry"], "wood states");
  assert(rows[1].standard.from === "reference", "standard provenance travels with the row");
  const never = m.readingMatrix(logWith([{}], [{ at: "2026-10-13T09:00", readings: [4] }]), refMap());
  assert(never[0].dryOnDay === null, "never dry is null");
});

test("points on a standard nobody measured are listed", () => {
  const log = logWith([{ material: "drywall" }, { material: "woodFraming" }, { material: "concrete" }], []);
  const onGuide = m.pointsOnGuidedStandard(log, { rooms: {}, reference: { drywall: 0.8 } });
  equal(onGuide.map((p) => p.material), ["woodFraming", "concrete"], "unmeasured materials");
  equal(m.pointsOnGuidedStandard(log, { rooms: {}, reference: { drywall: 0.8, woodFraming: 11, concrete: 40 } }), [], "all measured");
});

/* ── the moisture map becomes points ──────────────────────────────────────────────────────────── */

test("each wet wall, painted floor and painted ceiling becomes a point, named as the panel names them", () => {
  const { sketch, map } = loss();
  const points = m.pointsFromMoisture(sketch, map);
  equal(
    points.map((p) => [p.label, p.surface, p.material, p.origin]),
    [
      ["Kitchen, Wall 1", "wall", "drywall", "wall:w-a"],
      ["Kitchen, Wall 3", "wall", "drywall", "wall:w-b"],
      ["Bedroom, Wall 2", "wall", "woodFraming", "wall:w-c"],
      ["Bedroom, Floor", "floor", "subfloor", "floor:bedroom"],
      ["Bedroom, Ceiling", "ceiling", "drywall", "ceiling:bedroom"],
    ],
    "points",
  );
  assert(new Set(points.map((p) => p.id)).size === points.length, "ids are unique");
});

test("a room with nothing marked in it gets no points", () => {
  const { sketch, map } = loss();
  const withDry = { ...sketch, rooms: [...sketch.rooms, box("hall", 40 * PX, 0, 5, 5, { name: "Hall" })] };
  assert(!m.pointsFromMoisture(withDry, map).some((p) => p.label.startsWith("Hall")), "hall");
});

test("a standard typed on a wall stays with its point; the job's reference and the guide are followed live", () => {
  const kitchen = box("kitchen", 0, 0, 12, 10, { name: "Kitchen" });
  const map = mapOf(
    {
      kitchen: {
        wallReadings: [
          wallReading("typed", "kitchen-v0", { dryStandard: 1.3 }),
          wallReading("ref", "kitchen-v1", { dryStandard: 0.8 }),
          wallReading("guide", "kitchen-v2", { dryStandard: m.defaultDryStandard("drywall") }),
        ],
      },
    },
    { drywall: 0.8 },
  );
  const points = m.pointsFromMoisture(sketchOf([kitchen]), map);
  equal(points.map((p) => p.standard), [1.3, null, null], "standards");
});

test("asking for the map's points again adds only the new ones", () => {
  const { sketch, map } = loss();
  const first = m.pointsFromMoisture(sketch, map);
  equal(m.pointsFromMoisture(sketch, map, first), [], "nothing new");
  const more = { ...map, rooms: { ...map.rooms, kitchen: { ...map.rooms.kitchen, wallReadings: [...map.rooms.kitchen.wallReadings, wallReading("w-d", "kitchen-v3")] } } };
  const added = m.pointsFromMoisture(sketch, more, first);
  equal(added.map((p) => p.label), ["Kitchen, Wall 4"], "only the new wall");
});

test("on a sketch with several levels the room's level is in the name", () => {
  const upstairs = box("bed", 0, 0, 10, 10, { name: "Bed", level: 1 });
  const downstairs = box("rec", 20 * PX, 0, 10, 10, { name: "Rec room", level: -1 });
  const map = mapOf({ bed: { wallReadings: [wallReading("a", "bed-v0")] }, rec: { wallReadings: [wallReading("b", "rec-v0")] } });
  const sketch = sketchOf([upstairs, downstairs], { levelNames: { "-1": "Basement" } });
  const labels = m.pointsFromMoisture(sketch, map).map((p) => p.label);
  assert(labels.some((l) => l.startsWith("Rec room (Basement)")), `basement label in ${labels.join(" | ")}`);
  assert(labels.every((l) => l.includes("(")), "every label names its level");
});

test("Day 1 holds the map's readings, and a wall with no reading yet starts empty", () => {
  const { sketch, map } = loss();
  const log = m.startDryingLog({ sketch, map, now: "2026-10-13T14:00", by: "Sam", equipment: { airMovers: 6, dehumidifiers: 2 } });
  const day1 = log.visits[0];
  const byLabel = Object.fromEntries(log.points.map((p) => [p.label, day1.readings[p.id]?.value ?? null]));
  equal(byLabel, { "Kitchen, Wall 1": 4.2, "Kitchen, Wall 3": null, "Bedroom, Wall 2": 18, "Bedroom, Floor": null, "Bedroom, Ceiling": null }, "readings");
  assert(day1.by === "Sam" && day1.at === "2026-10-13T14:00", "who and when");
  equal([day1.equipment.airMovers, day1.equipment.dehumidifiers], [6, 2], "equipment from the plan");
  equal(day1.air, m.emptyAir(), "no air numbers invented");
});

test("starting over an emptied log keeps its points, names and settings, and adds only the map's new ones", () => {
  const { sketch, map } = loss();
  const first = m.startDryingLog({ sketch, map, now: "2026-10-13T14:00", by: "Sam" });
  // The tech deleted the only visit, renamed a point, added their own, and changed the settings.
  const renamed = first.points.map((p, i) => (i === 0 ? { ...p, label: "Kitchen, north wall" } : p));
  const mine = m.newPoint({ label: "Hall subfloor", material: "subfloor" });
  const emptied = { ...first, points: [...renamed, mine], visits: [], goalMarginPercent: 15, tempUnit: "C" };
  const more = { ...map, rooms: { ...map.rooms, kitchen: { ...map.rooms.kitchen, wallReadings: [...map.rooms.kitchen.wallReadings, wallReading("w-d", "kitchen-v3")] } } };
  const again = m.startDryingLog({ sketch, map: more, now: "2026-10-14T09:00", by: "Sam", existing: emptied });
  equal(again.points.slice(0, 6).map((p) => p.label), ["Kitchen, north wall", "Kitchen, Wall 3", "Bedroom, Wall 2", "Bedroom, Floor", "Bedroom, Ceiling", "Hall subfloor"], "the kept points, in order");
  equal(again.points.slice(6).map((p) => p.label), ["Kitchen, Wall 4"], "and only the new map point");
  equal([again.goalMarginPercent, again.tempUnit, again.visits.length], [15, "C", 1], "settings kept, one fresh visit");
  assert(again.visits[0].readings[again.points[0].id].value === 4.2, "Day 1 still takes the map's reading for a renamed map point");
});

test("a log can be started with no sketch and no map at all", () => {
  const log = m.startDryingLog({ sketch: m.emptySketch(), map: m.emptyMoistureMap(), now: "2026-10-13T14:00", by: "" });
  equal(log.points, [], "no points");
  equal(log.visits.length, 1, "one empty visit");
});

/* ── adding visits and changing the log ───────────────────────────────────────────────────────── */

test("a new visit carries who, the meter and the equipment, and nothing that was measured", () => {
  const { sketch, map } = loss();
  let log = m.startDryingLog({ sketch, map, now: "2026-10-13T14:00", by: "Sam", equipment: { airMovers: 6, dehumidifiers: 2 } });
  log = m.withVisit(log, { ...log.visits[0], meter: "Tramex ME5", air: { ...m.emptyAir(), outside: { tempF: 41, rh: 60 } }, equipment: { airMovers: 5, dehumidifiers: 2, notes: "moved one" } });
  const next = m.newVisit(log, { now: "2026-10-14T09:00", by: "" });
  assert(next.by === "Sam" && next.meter === "Tramex ME5", "carried");
  equal([next.equipment.airMovers, next.equipment.dehumidifiers, next.equipment.notes], [5, 2, ""], "equipment counts, not notes");
  equal(next.air, m.emptyAir(), "air is blank");
  equal(next.readings, {}, "readings are blank");
});

test("visits stay in date order whatever order they are added in", () => {
  let log = m.emptyDryingLog();
  for (const at of ["2026-10-15T09:00", "2026-10-13T09:00", "2026-10-14T09:00"]) log = m.withVisit(log, { ...m.newVisit(log, { now: at, by: "" }), id: at });
  equal(log.visits.map((v) => v.at), ["2026-10-13T09:00", "2026-10-14T09:00", "2026-10-15T09:00"], "order");
  const edited = m.withVisit(log, { ...log.visits[0], notes: "changed" });
  equal([edited.visits.length, edited.visits[0].notes], [3, "changed"], "replacing keeps the count");
  equal(m.withoutVisit(edited, edited.visits[1].id).visits.length, 2, "removing");
});

test("a reading is set, replaced and cleared, and clearing removes it altogether", () => {
  let visit = m.newVisit(m.emptyDryingLog(), { now: "2026-10-13T09:00", by: "" });
  visit = m.withReading(visit, "p1", 12.5);
  assert(visit.readings.p1.value === 12.5 && visit.readings.p1.source === "typed", "set");
  visit = m.withReading(visit, "p1", 11);
  assert(visit.readings.p1.value === 11, "replaced");
  visit = m.withReading(visit, "p1", null);
  assert(!("p1" in visit.readings), "cleared entirely");
});

test("removing a point removes its readings from every visit", () => {
  const log = logWith([{}, {}], [{ at: "2026-10-13T09:00", readings: [5, 6] }, { at: "2026-10-14T09:00", readings: [4, 5] }]);
  const less = m.withoutPoint(log, "p0");
  equal(less.points.map((p) => p.id), ["p1"], "points");
  assert(less.visits.every((v) => !("p0" in v.readings) && "p1" in v.readings), "readings");
});

test("a tech's own point gets a name and a material", () => {
  const point = m.newPoint({ label: "  Hall subfloor  ", material: "subfloor" });
  assert(point.label === "Hall subfloor" && point.origin === "added" && point.active && point.standard === null, "point");
  assert(m.newPoint({ label: "", material: "concrete" }).label === "Concrete", "blank label falls back to the material");
  const replaced = m.withPoint(m.withPoint(m.emptyDryingLog(), point), { ...point, active: false });
  equal([replaced.points.length, replaced.points[0].active], [1, false], "replace, not duplicate");
});

/* ── the air ──────────────────────────────────────────────────────────────────────────────────── */

test("an air reading gives GPP and dew point, and nothing until both numbers are there", () => {
  const f = m.airFigures({ tempF: 70, rh: 50 });
  near(f.gpp, 54.5, 0.5, "GPP");
  near(f.dewPointF, 50.4, 0.4, "dew point");
  assert(m.airFigures({ tempF: 70, rh: null }) === null && m.airFigures({ tempF: null, rh: 50 }) === null, "half a reading");
  assert(m.airFigures({ tempF: 70, rh: 140 }) === null, "an impossible reading");
});

test("the gap between affected and unaffected air is in whole grains, and needs both", () => {
  const air = { ...m.emptyAir(), affected: { tempF: 80, rh: 60 }, unaffected: { tempF: 70, rh: 50 } };
  const gap = m.gppGap(air);
  near(gap, 38, 2, "92 - 54");
  assert(Number.isInteger(gap), "whole grains");
  assert(m.gppGap({ ...air, unaffected: { tempF: null, rh: null } }) === null, "needs both");
});

test("temperature is stored in Fahrenheit and shown in either unit", () => {
  assert(m.tempForDisplay(68, "F") === 68 && m.tempForDisplay(68, "C") === 20, "display");
  assert(m.tempFromEntry(20, "C") === 68 && m.tempFromEntry(68, "F") === 68, "entry");
  assert(m.tempForDisplay(null, "C") === null && m.tempFromEntry(null, "C") === null, "empty stays empty");
  near(m.tempForDisplay(m.tempFromEntry(21.7, "C"), "C"), 21.7, 0.05, "round trip to the tenth");
});

/* ── words ────────────────────────────────────────────────────────────────────────────────────── */

test("dates and times read the same in every locale", () => {
  assert(m.formatVisitDate("2026-10-13T14:15") === "Oct 13", "short date");
  assert(m.formatVisitDateLong("2026-10-03T14:15") === "Oct 3, 2026", "long date");
  assert(m.formatVisitTime("2026-10-13T14:15") === "2:15 PM", "afternoon");
  assert(m.formatVisitTime("2026-10-13T00:05") === "12:05 AM", "just after midnight");
  assert(m.formatVisitTime("2026-10-13T12:00") === "12:00 PM", "noon");
  assert(m.formatVisitDate("") === "No date" && m.formatVisitTime("") === "", "undated");
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(m.localNow()), "localNow is datetime-local shaped");
});

/* ── result ───────────────────────────────────────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${passed} passed`);
