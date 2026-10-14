/**
 * Reading a meter's screen from a photo: what the drying log does with the model's answer.
 *
 *   npm run test:meterphoto
 *
 * The model is not called here (that costs money and needs a key; `scripts/` has no runner for it).
 * What is checked is everything around it that would otherwise fail quietly:
 *
 *   * an unreadable photo, an "OL" screen or a number no meter shows fills nothing in
 *   * a hygrometer's Celsius becomes the Fahrenheit the log stores; no unit takes the log's own
 *   * half an air answer fills half the row and says what is missing
 *   * a photo reading says so, and a number typed over it is the tech's own again
 *   * a change of meter mode against the last reading at a point is caught
 *   * the request check refuses what is not a JPEG of a sane size
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "meterphoto-tests-"));
  const entry = join(outDir, "entry.ts");
  const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
  writeFileSync(entry, [`export * from "${lib("meterPhoto.ts")}";`, `export * from "${lib("dryingLog.ts")}";`].join("\n"));
  const outfile = join(outDir, "meterphoto.mjs");
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

/** A full answer with nothing on it; each test sets what the screen showed. */
const wire = (over = {}) => ({
  readable: true,
  problem: "",
  has_reading: false,
  reading: 0,
  unit: "none",
  mode: "unknown",
  scale: "",
  meter: "",
  has_temperature: false,
  temperature: 0,
  temperature_unit: "unknown",
  has_humidity: false,
  humidity: 0,
  notes: "",
  ...over,
});

/* ── moisture readings ────────────────────────────────────────────────────────────────────────── */

test("a clear moisture reading comes through with its mode, scale and meter", () => {
  const r = m.parseMeterPhoto(wire({ has_reading: true, reading: 14.2, unit: "percent_mc", mode: "pin", scale: "WOOD", meter: "Delmhorst BD-2100" }), "moisture");
  equal(r, { value: 14.2, tempF: null, tempUnitShown: null, rh: null, problem: null, notes: "", scale: "WOOD", meter: "Delmhorst BD-2100", mode: "pin" }, "reading");
});

test("an unreadable photo fills nothing in and says why", () => {
  const r = m.parseMeterPhoto(wire({ readable: false, problem: "glare covers the last digit; tilt the meter", has_reading: true, reading: 12 }), "moisture");
  assert(r.value === null, "no value from an unreadable photo, whatever number came with it");
  assert(r.problem === "glare covers the last digit; tilt the meter", "the model's reason is passed on");
});

test("an unreadable photo with no reason given still says something a tech can act on", () => {
  const r = m.parseMeterPhoto(wire({ readable: false }), "moisture");
  assert(r.value === null && typeof r.problem === "string" && r.problem.length > 10, r.problem);
});

test("OL and dashes are not readings", () => {
  const r = m.parseMeterPhoto(wire({ has_reading: false, problem: "the meter shows OL (over limit)", meter: "Tramex ME5" }), "moisture");
  assert(r.value === null && r.problem === "the meter shows OL (over limit)", "no reading");
  assert(r.meter === "Tramex ME5", "the meter is kept even with no number");
});

test("a number no moisture meter shows is refused, not clamped", () => {
  for (const reading of [-1, 1001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert(m.parseMeterPhoto(wire({ has_reading: true, reading }), "moisture").value === null, `refused ${reading}`);
  }
  assert(m.parseMeterPhoto(wire({ has_reading: true, reading: 999 }), "moisture").value === 999, "a pinless relative 999 is a reading");
  assert(m.parseMeterPhoto(wire({ has_reading: true, reading: 0 }), "moisture").value === 0, "zero is a reading");
});

test("readings keep the meter's own precision, to the hundredth", () => {
  assert(m.parseMeterPhoto(wire({ has_reading: true, reading: 0.85 }), "moisture").value === 0.85, "0.85");
  assert(m.parseMeterPhoto(wire({ has_reading: true, reading: 12.3456 }), "moisture").value === 12.35, "rounded");
});

test("an RH-probe number is marked as RH mode", () => {
  const r = m.parseMeterPhoto(wire({ has_reading: true, reading: 78, unit: "percent_rh" }), "moisture");
  assert(r.value === 78 && r.mode === "rh", JSON.stringify(r));
});

test("junk from the model is an unreadable photo, not a crash", () => {
  for (const junk of [null, undefined, "14.2", 14.2, [], { readable: "yes" }]) {
    const r = m.parseMeterPhoto(junk, "moisture");
    assert(r.value === null && r.problem, `junk ${JSON.stringify(junk)}`);
  }
});

/* ── air readings ─────────────────────────────────────────────────────────────────────────────── */

test("a hygrometer in Fahrenheit comes through as it reads", () => {
  const r = m.parseMeterPhoto(wire({ has_temperature: true, temperature: 72.4, temperature_unit: "F", has_humidity: true, humidity: 48 }), "air");
  assert(r.tempF === 72.4 && r.rh === 48 && r.tempUnitShown === "F" && r.problem === null, JSON.stringify(r));
});

test("Celsius on the screen becomes Fahrenheit, as the log stores it", () => {
  const r = m.parseMeterPhoto(wire({ has_temperature: true, temperature: 21.5, temperature_unit: "C", has_humidity: true, humidity: 55.5 }), "air");
  assert(r.tempF === 70.7 && r.tempUnitShown === "C" && r.rh === 55.5, JSON.stringify(r));
});

test("no unit on the screen takes the log's own unit, and says it did", () => {
  const asC = m.parseMeterPhoto(wire({ has_temperature: true, temperature: 20, has_humidity: true, humidity: 50 }), "air", "C");
  assert(asC.tempF === 68 && asC.tempUnitShown === null, "taken as C");
  const asF = m.parseMeterPhoto(wire({ has_temperature: true, temperature: 68, has_humidity: true, humidity: 50 }), "air", "F");
  assert(asF.tempF === 68 && asF.tempUnitShown === null, "taken as F");
});

test("half an air answer fills half the row and says what is missing", () => {
  const onlyRh = m.parseMeterPhoto(wire({ has_humidity: true, humidity: 61 }), "air");
  assert(onlyRh.rh === 61 && onlyRh.tempF === null && /temperature/i.test(onlyRh.problem ?? ""), JSON.stringify(onlyRh));
  const onlyTemp = m.parseMeterPhoto(wire({ has_temperature: true, temperature: 70, temperature_unit: "F" }), "air");
  assert(onlyTemp.tempF === 70 && onlyTemp.rh === null && /humidity/i.test(onlyTemp.problem ?? ""), JSON.stringify(onlyTemp));
});

test("humidity over 100 or a temperature no room has is refused", () => {
  const r = m.parseMeterPhoto(wire({ has_temperature: true, temperature: 400, temperature_unit: "F", has_humidity: true, humidity: 140 }), "air");
  assert(r.tempF === null && r.rh === null && r.problem, JSON.stringify(r));
  const c = m.parseMeterPhoto(wire({ has_temperature: true, temperature: 90, temperature_unit: "C", has_humidity: true, humidity: 40 }), "air");
  assert(c.tempF === null && c.rh === 40, "90 C is no room's air");
});

test("a moisture photo asked for air gives no air, and the other way round", () => {
  const moistureOnly = wire({ has_reading: true, reading: 14 });
  assert(m.parseMeterPhoto(moistureOnly, "air").tempF === null && m.parseMeterPhoto(moistureOnly, "air").rh === null, "no air from a moisture screen");
  const airOnly = wire({ has_temperature: true, temperature: 70, temperature_unit: "F", has_humidity: true, humidity: 40 });
  assert(m.parseMeterPhoto(airOnly, "moisture").value === null, "no moisture reading from a hygrometer");
});

/* ── the log ──────────────────────────────────────────────────────────────────────────────────── */

const visit = (id, at, readings = {}) => ({ ...m.newVisit(m.emptyDryingLog(), { now: at, by: "", equipment: null }), id, at, readings });

test("a photo reading is marked as one, with what the screen showed", () => {
  const v = m.withPhotoReading(visit("v", "2026-10-14T09:00"), "p", { value: 14.2, mode: "pin", scale: "WOOD", meter: "Delmhorst" });
  equal(v.readings.p, { value: 14.2, source: "photo", mode: "pin", scale: "WOOD", meter: "Delmhorst" }, "reading");
});

test("a number typed over a photo reading is the tech's own, and keeps the mode the screen showed", () => {
  const read = m.withPhotoReading(visit("v", "2026-10-14T09:00"), "p", { value: 14.2, mode: "pin", scale: "WOOD" });
  const typed = m.withReading(read, "p", 12.4);
  equal(typed.readings.p, { value: 12.4, source: "typed", mode: "pin", scale: "WOOD" }, "corrected");
});

test("the same number reported again leaves a photo reading alone", () => {
  const read = m.withPhotoReading(visit("v", "2026-10-14T09:00"), "p", { value: 14.2 });
  assert(m.withReading(read, "p", 14.2) === read, "unchanged visit");
});

test("clearing a photo reading clears it", () => {
  const read = m.withPhotoReading(visit("v", "2026-10-14T09:00"), "p", { value: 14.2 });
  assert(!("p" in m.withReading(read, "p", null).readings), "cleared");
});

test("a typed reading is still typed", () => {
  equal(m.withReading(visit("v", "2026-10-14T09:00"), "p", 3).readings.p, { value: 3, source: "typed" }, "typed");
});

test("a photo reading survives saving and loading", () => {
  const log = { ...m.emptyDryingLog(), points: [m.newPoint({ label: "Wall", material: "drywall" })] };
  const id = log.points[0].id;
  const saved = { ...log, visits: [m.withPhotoReading(visit("v", "2026-10-14T09:00"), id, { value: 0.9, mode: "pinless", scale: "GYP", meter: "Tramex" })] };
  const loaded = m.normalizeDryingLog(JSON.parse(JSON.stringify(saved)));
  equal(loaded.visits[0].readings[id], { value: 0.9, mode: "pinless", source: "photo", scale: "GYP", meter: "Tramex" }, "loaded");
});

test("a change of mode against the last reading at the point is caught, and only then", () => {
  const log = {
    ...m.emptyDryingLog(),
    visits: [
      visit("a", "2026-10-13T09:00", { p: { value: 20, mode: "pin", source: "photo" }, q: { value: 5, source: "typed" } }),
      visit("b", "2026-10-14T09:00", { p: { value: 300, mode: "pinless", source: "photo" }, q: { value: 4, mode: "pin", source: "photo" } }),
      visit("c", "2026-10-15T09:00", { p: { value: 280, mode: "pinless", source: "photo" } }),
    ],
  };
  equal(m.modeChange(log, log.visits[1], "p"), { was: "pin", now: "pinless" }, "pin to pinless");
  assert(m.modeChange(log, log.visits[2], "p") === null, "pinless after pinless");
  assert(m.modeChange(log, log.visits[1], "q") === null, "the last reading said no mode");
  assert(m.modeChange(log, log.visits[0], "p") === null, "nothing before the first visit");
  assert(m.MODE_LABEL.rh === "RH probe", "label");
});

/* ── the request ──────────────────────────────────────────────────────────────────────────────── */

test("the request check takes a JPEG of a sane size and a kind, and nothing else", () => {
  const jpeg = "/9j/" + "A".repeat(100);
  equal(m.readMeterPhotoRequest({ image: jpeg, kind: "moisture" }), { image: jpeg, kind: "moisture", tempUnit: "F" }, "moisture");
  equal(m.readMeterPhotoRequest({ image: `data:image/jpeg;base64,${jpeg}`, kind: "air", tempUnit: "C" }), { image: jpeg, kind: "air", tempUnit: "C" }, "data URL prefix dropped");
  assert(m.readMeterPhotoRequest({ image: "iVBORw0KGgo", kind: "moisture" }) === null, "a PNG is refused");
  assert(m.readMeterPhotoRequest({ image: jpeg, kind: "roof" }) === null, "an unknown kind is refused");
  assert(m.readMeterPhotoRequest({ image: "/9j/" + "A".repeat(m.METER_PHOTO_MAX_BASE64), kind: "moisture" }) === null, "too large");
  assert(m.readMeterPhotoRequest(null) === null && m.readMeterPhotoRequest("x") === null, "not an object");
});

test("the schema asks for every field it describes, and no more", () => {
  const props = Object.keys(m.METER_PHOTO_SCHEMA.properties);
  equal([...m.METER_PHOTO_SCHEMA.required].sort(), [...props].sort(), "required = properties");
  assert(m.METER_PHOTO_SCHEMA.additionalProperties === false, "closed");
  equal(Object.keys(wire()).sort(), [...props].sort(), "the test's answer has the schema's fields");
});

test("the model is never told the last reading", () => {
  for (const kind of ["moisture", "air"]) assert(!/\d/.test(m.meterPhotoUserMessage(kind)), `${kind} message has no numbers`);
});

/* ── result ───────────────────────────────────────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${passed} passed`);
