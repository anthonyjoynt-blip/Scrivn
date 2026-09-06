/**
 * The dry standard — where it comes from, and what happens when it changes.
 *
 *   npm run test:moisture
 *
 * A dry standard is the moisture content of UNAFFECTED material of the same type in the same
 * building, metered on the day. It is not a published figure: what a material reads when it is dry
 * moves with species, season, regional climate and the meter in your hand, which is why there is no
 * table to look one up in. `lib/moisture.ts` carried a table anyway, as a convenience, and every
 * colour a PM reads damage severity from — and then the equipment sizing that follows — rested on it
 * without saying so.
 *
 * `MoistureMap.reference` is the measurement. These checks cover the three things that have to hold
 * for it to be worth having:
 *
 *   * a reading says which of the two it was judged against, and never claims the wrong one
 *   * setting a reference reaches the walls that were still on a guess, and leaves alone the ones
 *     somebody deliberately typed
 *   * a claim saved before any of this existed still opens
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "moisture-tests-"));
const outfile = join(outDir, "moisture.mjs");

await build({
  entryPoints: [join(root, "lib", "moisture.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const m = await import(pathToFileURL(outfile).href);
rmSync(outDir, { recursive: true, force: true });

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

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

const GUIDE_DRYWALL = m.defaultDryStandard("drywall");

function reading(id, { material = "drywall", dryStandard = GUIDE_DRYWALL, value = 3 } = {}) {
  return { id, wallId: `w-${id}`, startT: 0, endT: 1, affectedHeightFeet: 2, material, reading: value, dryStandard };
}

function mapWith(readings, reference) {
  const base = m.emptyMoistureMap();
  return {
    ...base,
    ...(reference === undefined ? {} : { reference }),
    rooms: { "room-1": { ...m.emptyRoomMoisture(), wallReadings: readings } },
  };
}

const walls = (map) => map.rooms["room-1"].wallReadings;

/* ── where a number came from ─────────────────────────────────────────────────────────────────── */

test("a blank map has no reference readings", () => {
  equal(m.emptyMoistureMap().reference, {}, "reference");
});

test("a wall still on the published range says so", () => {
  equal(m.dryStandardSource({}, "drywall", GUIDE_DRYWALL), "guide", "source");
});

test("a wall matching the job's reference says so instead", () => {
  // Same number, different meaning — and the meaning is the point.
  equal(m.dryStandardSource({ drywall: GUIDE_DRYWALL }, "drywall", GUIDE_DRYWALL), "reference", "source");
});

test("a number the PM typed for one wall is neither", () => {
  equal(m.dryStandardSource({ drywall: 0.9 }, "drywall", 1.4), "wall", "source");
});

test("no number at all is unset, not a guess", () => {
  equal(m.dryStandardSource({ drywall: 0.9 }, "drywall", null), "unset", "source");
});

test("a reference for one material does not classify another", () => {
  equal(m.dryStandardSource({ drywall: 0.9 }, "woodFraming", 0.9), "wall", "source");
});

/* ── what a new reading starts with ───────────────────────────────────────────────────────────── */

test("a new reading takes the job's reference when there is one", () => {
  // Otherwise the PM re-enters the same measurement on every mark, and one of them eventually differs.
  equal(m.startingDryStandard(mapWith([], { drywall: 0.9 }), "drywall"), 0.9, "starting value");
});

test("and falls back to the published range when there is not", () => {
  equal(m.startingDryStandard(mapWith([], {}), "drywall"), GUIDE_DRYWALL, "starting value");
});

test("concrete still starts empty, reference or no reference", () => {
  // Pin meters give a relative number on concrete, so there is nothing honest to prefill.
  equal(m.startingDryStandard(mapWith([], {}), "concrete"), null, "starting value");
});

/* ── setting a reference reaches the right walls ──────────────────────────────────────────────── */

test("setting a reference records it", () => {
  const next = m.setReferenceReading(mapWith([]), "drywall", 0.9);
  equal(next.reference.drywall, 0.9, "stored reference");
});

test("walls still on the published range follow it", () => {
  /*
    The heart of it. A wall sitting on the guide is not a decision anybody made, and leaving it
    behind a newly measured reference would mean one job quietly using two standards for the same
    material — with the colours to match.
  */
  const next = m.setReferenceReading(mapWith([reading("a"), reading("b")]), "drywall", 0.9);
  equal(walls(next).map((r) => r.dryStandard), [0.9, 0.9], "wall dry standards");
});

test("a wall the PM typed a number on is left alone", () => {
  const next = m.setReferenceReading(mapWith([reading("a", { dryStandard: 1.4 })]), "drywall", 0.9);
  equal(walls(next)[0].dryStandard, 1.4, "a deliberately set wall");
});

test("walls of another material are left alone", () => {
  const wood = reading("w", { material: "woodFraming", dryStandard: m.defaultDryStandard("woodFraming") });
  const next = m.setReferenceReading(mapWith([wood]), "drywall", 0.9);
  equal(walls(next)[0].dryStandard, m.defaultDryStandard("woodFraming"), "the wood wall");
});

test("even when it happens to be sitting on the same number", () => {
  /*
    The check above passes on its own by luck: drywall reads under 1% and wood reads in the teens, so
    "same material" and "same number" agree there and either test alone would let the other's rule be
    dropped. Wood, paneling and subfloor all read in single and low double figures and overlap
    completely — so a paneling wall typed at 11 sits exactly on wood's fallback, and only the
    material check keeps it from following a wood reference.
  */
  const paneling = reading("p", { material: "paneling", dryStandard: m.defaultDryStandard("woodFraming") });
  const next = m.setReferenceReading(mapWith([paneling]), "woodFraming", 12);
  equal(walls(next)[0].dryStandard, m.defaultDryStandard("woodFraming"), "the paneling wall");
});

test("changing a reference moves the walls that were following the old one", () => {
  const once = m.setReferenceReading(mapWith([reading("a")]), "drywall", 0.9);
  const twice = m.setReferenceReading(once, "drywall", 1.1);
  equal(walls(twice)[0].dryStandard, 1.1, "wall dry standard after a correction");
});

test("clearing a reference drops it and returns those walls to the range", () => {
  const set = m.setReferenceReading(mapWith([reading("a")]), "drywall", 0.9);
  const cleared = m.setReferenceReading(set, "drywall", null);
  assert(!("drywall" in cleared.reference), "expected the reference to be removed entirely");
  equal(walls(cleared)[0].dryStandard, null, "wall dry standard");
});

/* ── it reaches the calculation, not just the label ───────────────────────────────────────────── */

test("a reference changes the concern band, not only the wording", () => {
  /*
    The whole reason this matters. The same meter reading against a drier building reads as worse
    damage, and that band drives the colour, the summary and the equipment sizing.
  */
  const low = m.concernBand(3, 0.5, "drywall");
  const high = m.concernBand(3, 2.5, "drywall");
  assert(low !== high, `expected the band to move with the standard, got ${low} for both`);
});

test("a reading judged against the published range is counted as such", () => {
  // Surfaced downstream rather than hidden inside a colour — "elevated relative to a figure for
  // drywall in general" is a different claim from "elevated in this house".
  const room = { id: "room-1", name: "Kitchen", vertices: [], ceilingHeightFeet: 8, ceilingType: "flat", ceilingPeakFeet: null, stairs: null, parentRoomId: null, nestingOptOut: false, symbols: [], freeCabinets: [] };
  const guided = m.roomMoistureSummary(room, mapWith([reading("a")]));
  equal(guided.readingsOnGuidedStandard, 1, "count on a guessed standard");
  equal(guided.readings[0].dryStandardFrom, "guide", "provenance");

  const measured = m.roomMoistureSummary(room, m.setReferenceReading(mapWith([reading("a")]), "drywall", 0.9));
  equal(measured.readingsOnGuidedStandard, 0, "count once a reference exists");
  equal(measured.readings[0].dryStandardFrom, "reference", "provenance");
});

/* ── a claim from before any of this ──────────────────────────────────────────────────────────── */

test("a map saved without a reference key still works", () => {
  /*
    `parseSavedClaimState` merges stored values onto a blank claim one TOP-LEVEL key at a time, so
    `moisture` arrives whole and a nested addition is never filled in. Every reader has to cope with
    the key simply not being there, or a claim from last month throws on open.
  */
  const old = { rooms: { "room-1": { ...m.emptyRoomMoisture(), wallReadings: [reading("a")] } } };
  equal(m.startingDryStandard(old, "drywall"), GUIDE_DRYWALL, "starting value");
  equal(m.dryStandardSource(old.reference, "drywall", GUIDE_DRYWALL), "guide", "source");
  const next = m.setReferenceReading(old, "drywall", 0.9);
  equal(next.reference.drywall, 0.9, "reference after setting one on an old map");
  equal(walls(next)[0].dryStandard, 0.9, "the wall follows");
});

test("pruning a sketch does not discard the reference readings", () => {
  // `pruneMoisture` rebuilds the map, and a rebuild that forgets a field silently loses the job's
  // measurement the next time a room is reshaped.
  const map = m.setReferenceReading(mapWith([]), "drywall", 0.9);
  const pruned = m.pruneMoisture(map, { rooms: [] });
  equal(pruned.reference.drywall, 0.9, "reference after pruning");
});

test("storing a room's data does not discard them either", () => {
  const map = m.setReferenceReading(mapWith([]), "drywall", 0.9);
  const stored = m.setRoomMoisture(map, "room-2", { ...m.emptyRoomMoisture(), insetsOver18Inches: 1 });
  equal(stored.reference.drywall, 0.9, "reference after a room write");
  const removed = m.setRoomMoisture(stored, "room-2", m.emptyRoomMoisture());
  equal(removed.reference.drywall, 0.9, "reference after a room is emptied");
});

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const failure of failures) console.log(`  ✗ ${failure}\n`);
process.exit(failures.length === 0 ? 0 : 1);
