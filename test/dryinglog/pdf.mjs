/**
 * The drying log as a printed document.
 *
 *   npm run test:dryinglog:pdf
 *
 * Renders real PDFs through jsPDF and reads the bytes back, the way the letterhead test does: a call
 * having been made proves nothing about what landed on the page. What is checked is what a reviewer
 * relies on:
 *
 *   * the status line says "complete" only when it is, and says what is still open when it is not
 *   * the standard is stated with what it rests on, and a standard nobody measured is called out
 *   * every visit's air, readings and equipment are on the page, with GPP worked out
 *   * a long log continues onto more pages with its header row repeated, and across more visits
 *     than fit one table width it continues in a second table
 *   * nothing in it needs a character the PDF's standard fonts cannot draw
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "dryinglog-pdf-tests-"));
const bundlePath = join(outDir, "bundle.mjs");

await build({ entryPoints: [join(here, "entry.ts")], bundle: true, format: "esm", platform: "node", outfile: bundlePath, alias: { "@": root }, logLevel: "error" });
const m = await import(pathToFileURL(bundlePath).href);
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

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

const REF = { drywall: 0.8, woodFraming: 11 };
const refMap = (reference = REF) => ({ rooms: {}, reference: { ...reference } });

function point(i, over = {}) {
  return { id: `p${i}`, label: `Point ${i}`, roomId: null, surface: "wall", material: "drywall", origin: "added", standard: null, active: true, ...over };
}

function visit(i, at, readings = {}, over = {}) {
  return {
    id: `v${i}`,
    at,
    by: "",
    meter: "",
    air: m.emptyAir(),
    readings: Object.fromEntries(Object.entries(readings).map(([k, value]) => [k, { value }])),
    equipment: m.emptyEquipment(),
    notes: "",
    ...over,
  };
}

function logOf(points, visits, over = {}) {
  return { ...m.emptyDryingLog(), points, visits, ...over };
}

/** Every string drawn with the text operator, unescaped. */
function drawnText(pdfBytes) {
  const pdf = Buffer.from(pdfBytes).toString("latin1");
  return [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((x) => x[1].replace(/\\([()\\])/g, "$1"));
}

function render(log, map, ctx = {}) {
  const params = m.dryingLogPdfParams(log, map, { jobNumber: "J-100", customerName: "Pat Smith", ...ctx });
  const bytes = m.documentPdfBytes(params);
  return { params, text: drawnText(bytes), pages: (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length };
}

const has = (text, needle) => text.some((t) => t.includes(needle));

/* ── status ───────────────────────────────────────────────────────────────────────────────────── */

test("a finished job says complete, with the day and the date", () => {
  const log = logOf([point(0), point(1, { material: "woodFraming" })], [visit(0, "2026-10-13T09:00", { p0: 4, p1: 18 }), visit(1, "2026-10-16T09:00", { p0: 0.8, p1: 11.4 })]);
  const lines = m.dryingLogBodyLines(log, refMap());
  assert(lines.some((l) => l.startsWith("Status: complete. At Day 4 (Oct 16, 2026) all 2 points")), `status in: ${lines.join(" | ")}`);
});

test("an unfinished job says how many are still above the goal, and what was not read", () => {
  const log = logOf([point(0), point(1), point(2)], [visit(0, "2026-10-13T09:00", { p0: 4, p1: 5, p2: 6 }), visit(1, "2026-10-14T09:00", { p0: 0.8, p1: 2 })]);
  const line = m.dryingLogBodyLines(log, refMap()).find((l) => l.startsWith("Status:"));
  assert(line.includes("drying in progress") && line.includes("Day 2") && line.includes("1 of 3 points at their goal"), line);
  assert(line.includes("1 above it") && line.includes("1 not read at that visit"), line);
});

test("a log that has points but no readings is not called complete", () => {
  const line = m.dryingLogBodyLines(logOf([point(0)], [visit(0, "2026-10-13T09:00")]), refMap()).find((l) => l.startsWith("Status:"));
  assert(!line.includes("complete") && line.includes("not read"), line);
});

test("stopped points are mentioned, and the goal and its variance are stated", () => {
  const log = logOf([point(0, { active: false }), point(1)], [visit(0, "2026-10-13T09:00", { p0: 0.8, p1: 0.8 })], { goalMarginPercent: 12 });
  const lines = m.dryingLogBodyLines(log, refMap());
  assert(lines.some((l) => l.includes("1 point was dry and no longer read")), "stopped");
  assert(lines.some((l) => l.includes("dry standard plus 12%")), "variance");
});

/* ── the standard ─────────────────────────────────────────────────────────────────────────────── */

test("the standard is stated with what it rests on", () => {
  const log = logOf([point(0), point(1, { material: "woodFraming" })], [visit(0, "2026-10-13T09:00", { p0: 1, p1: 12 })]);
  const lines = m.dryingLogBodyLines(log, refMap());
  const line = lines.find((l) => l.startsWith("Dry standards:"));
  assert(line.includes("Drywall: 0.8 (measured on unaffected material)") && line.includes("Wood framing: 11 (measured on unaffected material)"), line);
  assert(!lines.some((l) => l.startsWith("Not measured on this job")), "nothing to confess");
});

test("a standard nobody measured is called out, by material", () => {
  const log = logOf([point(0), point(1, { material: "woodFraming" })], [visit(0, "2026-10-13T09:00", { p0: 1, p1: 12 })]);
  const lines = m.dryingLogBodyLines(log, refMap({ drywall: 0.8 }));
  const line = lines.find((l) => l.startsWith("Not measured on this job"));
  assert(line && line.includes("Wood framing") && !line.includes("Drywall") && line.includes("not a measurement of this building"), `line: ${line}`);
  assert(lines.find((l) => l.startsWith("Dry standards:")).includes("published range, not measured"), "the standards line says so too");
});

/* ── what is on the page ──────────────────────────────────────────────────────────────────────── */

test("each visit's air, GPP, equipment, readings and who took them are on the page", () => {
  const log = logOf(
    [point(0, { label: "Kitchen, Wall 1" })],
    [
      visit(0, "2026-10-13T14:15", { p0: 4.25 }, { by: "Sam Tech", meter: "Tramex ME5", notes: "Pulled baseboard", equipment: { airMovers: 6, dehumidifiers: 2, notes: "" }, air: { outside: { tempF: 41, rh: 60 }, unaffected: { tempF: 70, rh: 50 }, affected: { tempF: 80, rh: 60 } } }),
      visit(1, "2026-10-14T09:30", { p0: 0.8 }, { equipment: { airMovers: 5, dehumidifiers: 2, notes: "" } }),
    ],
  );
  const { text } = render(log, refMap());
  for (const needle of ["Air readings and equipment", "Moisture readings by visit", "Who, with what, and notes", "Day 1", "Day 2", "Oct 13, 2:15 PM", "Kitchen, Wall 1", "Drywall", "4.25", "0.8 *", "6 air movers", "2 dehumidifiers", "5 air movers", "Sam Tech", "Tramex ME5", "Pulled baseboard", "92 GPP", "54 GPP"]) {
    assert(has(text, needle), `missing "${needle}"`);
  }
  assert(has(text, "+38") || has(text, "+37") || has(text, "+39"), "GPP gap printed with a sign");
});

test("temperatures print in the unit the log was kept in", () => {
  const air = { ...m.emptyAir(), outside: { tempF: 68, rh: 50 } };
  const log = logOf([point(0)], [visit(0, "2026-10-13T09:00", { p0: 1 }, { air })], { tempUnit: "C" });
  const { text } = render(log, refMap());
  assert(has(text, "20°C") || has(text, "20\xb0C"), `no 20 C in ${text.filter((t) => t.includes("C,")).join(" | ")}`);
  assert(!has(text, "68\xb0F"), "no Fahrenheit leaking through");
});

test("a visit with half an air reading still prints what was typed", () => {
  const air = { ...m.emptyAir(), outside: { tempF: 50, rh: null } };
  const { text } = render(logOf([point(0)], [visit(0, "2026-10-13T09:00", { p0: 1 }, { air })]), refMap());
  assert(has(text, "50\xb0F"), "temperature alone");
});

test("a point that was not read at a visit prints a dash, and a stopped point is labelled", () => {
  const log = logOf([point(0), point(1, { active: false, label: "Done wall" })], [visit(0, "2026-10-13T09:00", { p0: 5, p1: 4 }), visit(1, "2026-10-14T09:00", { p0: 3 })]);
  const { text } = render(log, refMap());
  assert(has(text, "–") || has(text, "\x96"), "a dash for the unread cell");
  assert(has(text, "Done wall (stopped)"), "stopped label");
});

test("the day each point came in dry is on the last table", () => {
  const log = logOf([point(0)], [visit(0, "2026-10-13T09:00", { p0: 4 }), visit(1, "2026-10-15T09:00", { p0: 0.85 })]);
  const { text } = render(log, refMap());
  assert(has(text, "Dry on") && has(text, "Day 3"), "dry on Day 3");
});

test("the job information and letterhead come through like any other document", () => {
  const groups = [{ title: "Property & Claim", fields: [{ label: "Insured", value: "Pat Smith" }] }];
  const { text } = render(logOf([point(0)], [visit(0, "2026-10-13T09:00", { p0: 1 })]), refMap(), { jobInformation: groups });
  assert(has(text, "Drying Log") && has(text, "Pat Smith") && has(text, "PROPERTY & CLAIM"), "label and job info");
});

/* ── a long log ───────────────────────────────────────────────────────────────────────────────── */

test("more visits than fit across the page continue in a second table", () => {
  const visits = Array.from({ length: 8 }, (_, i) => visit(i, `2026-10-${String(13 + i).padStart(2, "0")}T09:00`, { p0: 8 - i }));
  const tables = m.dryingLogTables(logOf([point(0)], visits), refMap());
  const matrices = tables.filter((t) => t.caption && t.caption.startsWith("Moisture readings"));
  assert(matrices.length === 2, `expected two matrices, got ${matrices.map((t) => t.caption)}`);
  assert(matrices[0].caption.includes("Day 1") && matrices[0].caption.includes("Day 6") && matrices[1].caption.includes("Day 7"), `captions ${matrices.map((t) => t.caption)}`);
  assert(matrices[0].columns.length === 2 + m.VISITS_PER_TABLE && matrices[1].columns.length === 2 + 2 + 1, "columns, and 'Dry on' only on the last");
});

test("a table that runs past the page continues on the next with its header repeated", () => {
  const points = Array.from({ length: 40 }, (_, i) => point(i));
  const log = logOf(points, [visit(0, "2026-10-13T09:00", Object.fromEntries(points.map((p, i) => [p.id, 2 + (i % 3)])))]);
  const { text, pages } = render(log, refMap());
  assert(pages >= 2, `${pages} page(s)`);
  assert(text.filter((t) => t === "Dry standard").length >= 2, "the header row is drawn again on the next page");
  assert(has(text, "Point 39"), "the last row got printed");
});

test("a log with no visits has nothing to print", () => {
  assert(m.canPrintDryingLog(m.emptyDryingLog()) === false, "empty");
  assert(m.canPrintDryingLog(logOf([point(0)], [visit(0, "2026-10-13T09:00")])) === true, "with a visit");
  assert(m.dryingLogTables(m.emptyDryingLog(), refMap()).length === 0, "no tables");
});

/* ── characters ───────────────────────────────────────────────────────────────────────────────── */

test("nothing printed needs a character the standard fonts cannot draw", () => {
  const air = { outside: { tempF: 41, rh: 60 }, unaffected: { tempF: 70, rh: 50 }, affected: { tempF: 80, rh: 60 } };
  const log = logOf([point(0), point(1, { material: "concrete", active: false })], [visit(0, "2026-10-13T09:00", { p0: 4 }, { air, by: "Sam", notes: "ok" }), visit(1, "2026-10-14T09:00", { p0: 0.8 })]);
  const params = m.dryingLogPdfParams(log, refMap(), { jobNumber: "1", customerName: "x" });
  const everything = [params.bodyText, ...params.tables.flatMap((t) => [t.caption ?? "", t.note ?? "", ...t.columns.map((c) => c.title), ...t.rows.flat()])].join("\n");
  // Latin-1, plus the en dash and middle dot the typography already relies on (jsPDF maps both).
  const allowed = new Set(["–", "—", "·"]);
  const bad = [...everything].filter((ch) => ch.charCodeAt(0) > 255 && !allowed.has(ch));
  assert(bad.length === 0, `characters outside the fonts: ${[...new Set(bad)].join(" ")}`);
  assert(!everything.includes("✓") && !everything.includes("≤"), "no check marks or less-than-or-equal signs");
});

/* ── result ───────────────────────────────────────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${passed} passed`);
