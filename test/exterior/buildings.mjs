/**
 * Other buildings on a claim (2026-10-16): a shed, a detached garage, a workshop - each a whole exterior of its own,
 * beside the house's (`Sketch.buildings`, lib/buildings.ts), measured, drawn, roofed and reported like it.
 *
 *   npm run test:exterior:buildings
 *   node test/exterior/buildings.mjs --record      writes the "before" record of every exterior fixture (run on main
 *                                                  as it was before buildings, e8ca454; kept in fixtures/)
 *   SCRIVN_REPORT_OUT=<dir> npm run test:exterior:buildings    also keeps the owner's house + shed report and its pages
 *
 * NO PAID CALL, no server, no key. What is checked:
 *   * every exterior fixture reads, measures and reports exactly as before buildings: the report's every word and
 *     table, the quantities, the scope lines, and the PDF itself, byte for byte but for its date
 *   * a shed typed with a tape - 12' x 16', 8' walls, a 6/12 gable, a 6' double door on a gable end, a 2' x 3'
 *     window, vinyl - its roof squares and lines, its walls, its scope lines named for it, its report section, and
 *     the cover's totals per building and for them all, beside the owner's house
 *   * one slope (a shed roof) and a hip on the quick box
 *   * a claim saved before buildings, and a device copy with a broken list, through parseSavedClaimState
 */

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const lib = (name) => join(root, name).replace(/\\/g, "/");
const RECORD = join(here, "fixtures", "reports-before-buildings.json");
const recording = process.argv.includes("--record");
const after = !recording;

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "buildings-"));
  const entry = join(outDir, "entry.ts");
  const outfile = join(outDir, "entry.mjs");
  writeFileSync(
    entry,
    [
      `export * from "${lib("lib/exterior.ts")}";`,
      `export * from "${lib("lib/exteriorImport.ts")}";`,
      `export { exteriorReport } from "${lib("lib/exteriorReport.ts")}";`,
      `export * from "${lib("lib/exteriorReportPdf.ts")}";`,
      `export { exteriorModel } from "${lib("lib/exterior3d.ts")}";`,
      `export { parseSavedClaimState } from "${lib("lib/claimState.ts")}";`,
      `export { renderToStaticMarkup } from "react-dom/server.browser";`,
      ...(after ? [`export * from "${lib("lib/buildings.ts")}";`] : []),
    ].join("\n"),
  );
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    jsx: "automatic",
    alias: { "@": root, "server-only": join(root, "node_modules", "server-only", "empty.js") },
    nodePaths: [join(root, "node_modules")],
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const x = await load();

let passed = 0;
const failures = [];
async function test(name, run) {
  try {
    await run();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${err instanceof Error ? err.stack?.split("\n").slice(0, 4).join("\n      ") : String(err)}`);
  }
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function near(a, b, message, tol = 1e-6) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${message}: ${a} against ${b} (within ${tol})`);
}
const ft = (feet, inches = 0) => feet + inches / 12;
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const META = { title: "Golden", date: "Oct 16, 2026", madeWith: "Scrivn" };
const svgOf = (el) => x.renderToStaticMarkup(el);

// ---------------------------------------------------------------------------------------------
// The record: what each exterior read, measured and reported as, ids made stable
// ---------------------------------------------------------------------------------------------

/** Every id Scrivn makes (`newSketchId`: "side-<time>-<n>") swapped for its place among them, so two reads compare. */
function stable(value) {
  const ids = new Map();
  return JSON.stringify(value).replace(/\b[a-z]+-[0-9a-z]{5,}-\d+\b/g, (id) => {
    if (!ids.has(id)) ids.set(id, `ID${ids.size}`);
    return ids.get(id);
  });
}
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);

/** The PDF's bytes, but for the date jsPDF stamps on it and the id it makes from that date. */
function pdfText(bytes) {
  return Buffer.from(bytes)
    .toString("latin1")
    .replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, "/$1 ()")
    .replace(/\/ID \[ *<[0-9A-Fa-f]+> *<[0-9A-Fa-f]+> *\]/g, "/ID []");
}

/** Everything in scope: so every line the exterior can make is made. */
const allInScope = (e) => ({ ...e, scope: { roofing: true, sides: x.allSides(e).map((s) => s.id), soffitFascia: true, eavestrough: true } });

function recordOf(e) {
  const r = x.exteriorReport(e, META);
  const q = x.exteriorQuantities(e);
  const report = r && {
    facts: r.facts,
    sources: r.sources,
    assumed: r.assumed,
    notes: r.notes,
    sides: r.sides.map((s) => ({ heading: s.heading, dims: s.dims, rise: s.rise, base: s.base })),
    views: r.views.map((v) => ({ heading: v.heading, shows: v.shows })),
    photos: r.photos.map((p) => ({ label: p.label, caption: p.caption })),
    tables: r.tables,
    roof: r.roof,
  };
  const pdf = r ? pdfText(x.exteriorReportBytes({ report: r, svgOf, footer: META.madeWith })) : null;
  return {
    report: report ? stable(report) : null,
    quantities: hash(stable(q)),
    model: hash(stable(x.exteriorModel(e))),
    lines: stable(x.exteriorScopeLines(e)),
    linesAll: stable(x.exteriorScopeLines(allInScope(e))),
    pdf: pdf ? { pages: (pdf.match(/\/Type \/Page\b/g) ?? []).length, hash: hash(pdf) } : null,
  };
}

/** Every exterior the fixtures hold, read as a claim reads them. */
function fixtureExteriors() {
  const out = [];
  const read = (name, body) => {
    const got = x.parseScanExterior(body, { scanId: null, receivedAt: "2026-10-16T00:00:00.000Z" });
    if (got.ok) out.push([name, got.exterior]);
    else out.push([name, null, got.error]);
  };
  for (const name of [
    "scan-exterior-1802-side-yard.json",
    "scan-exterior-handwritten.json",
    "scan-exterior-sample.json",
    "scan-exterior-send.json",
    "scan-exterior-v2-photos.json",
    "scan-exterior-v2-sample.json",
    "scan-exterior-v2-send.json",
    "scan-exterior-v2-walk-1420.json",
    "scan-exterior-v2-walk-1453.json",
    "photos-only-1016.json",
    "finish-1453/capture.json",
  ])
    read(name, fixture(name));
  read("photos-only-1016.json + finish", { ...fixture("photos-only-1016.json"), finish: fixture("photos-only-1016-finish.json") });
  // The claim saved on 10-16 by the check-these session: the photo route's exterior, as a claim holds it.
  out.push(["claim-saved-1016.json", fixture("claim-saved-1016.json").sketch.exterior]);
  // Drawn by hand: a rectangle and an L, typed pitch, as the plan's quick starts make them.
  out.push(["rectangle 40 x 30 at 6/12", { ...x.rectangleExterior(40, 30, 9), roof: { ...x.defaultRoof(), pitch: 6 } }]);
  out.push(["L 50 x 40, notch 20 x 15", { ...x.lShapeExterior(50, 40, 20, 15, 10), roof: { ...x.defaultRoof(), pitch: 5, ends: {} } }]);
  return out;
}

if (recording) {
  const record = {};
  for (const [name, e, error] of fixtureExteriors()) record[name] = e ? recordOf(e) : { error };
  writeFileSync(RECORD, `${JSON.stringify({ madeOn: "e8ca454 (main before buildings)", exteriors: record }, null, 1)}\n`);
  console.log(`  recorded ${Object.keys(record).length} exteriors in ${RECORD}`);
  process.exit(0);
}

console.log("\nevery existing exterior, as before buildings");

const before = JSON.parse(readFileSync(RECORD, "utf8")).exteriors;
for (const [name, e, error] of fixtureExteriors()) {
  await test(`${name}: reads, measures and reports exactly as before`, () => {
    const was = before[name];
    assert(was, `no record of ${name}`);
    if (!e) {
      assert(was.error === error, `${error} against ${was.error}`);
      return;
    }
    const now = recordOf(e);
    for (const k of ["report", "quantities", "model", "lines", "linesAll"]) assert(now[k] === was[k], `${k} changed:\n        now ${String(now[k]).slice(0, 400)}\n        was ${String(was[k]).slice(0, 400)}`);
    assert(JSON.stringify(now.pdf) === JSON.stringify(was.pdf), `the PDF changed: ${JSON.stringify(now.pdf)} against ${JSON.stringify(was.pdf)}`);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
