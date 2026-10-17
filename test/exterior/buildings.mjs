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
      ...(after
        ? [
            `export * from "${lib("lib/buildings.ts")}";`,
            `export { withOneSlope, withRoofEnd } from "${lib("lib/exteriorPlan.ts")}";`,
            `export { adoptScan } from "${lib("lib/scanInbox.ts")}";`,
            `export { generationRequest } from "${lib("lib/claimGeneration.ts")}";`,
            `export { pdfSafe } from "${lib("lib/svgPdf.ts")}";`,
          ]
        : []),
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

/**
 * Every exterior the fixtures hold, read as a claim reads them - on a stopped clock. An id is "<what>-<time>-<n>", and
 * some of the roof's keys list slopes in the order of their sides' ids, so a millisecond ticking over between two
 * sides' ids can swap a valley's two slopes from one run to the next: with the clock stopped, every run makes the
 * same ids, and the record compares.
 */
function fixtureExteriors() {
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 9, 16, 12);
  try {
    return readFixtures();
  } finally {
    Date.now = realNow;
  }
}

function readFixtures() {
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

// ---------------------------------------------------------------------------------------------
// The owner's shed, typed with a tape, beside his house
// ---------------------------------------------------------------------------------------------

console.log("\nthe owner's house and a shed typed on the quick box");

/** His house as the photo route lands it on 10-16 (the photos-only proof and its Finish): the claim's house. */
function ownersHouse() {
  const read = x.parseScanExterior({ ...fixture("photos-only-1016.json"), finish: fixture("photos-only-1016-finish.json") }, { scanId: null });
  assert(read.ok, read.error);
  return read.exterior;
}

/**
 * The shed as typed on the quick box: 12' across the front, 16' deep, 8' walls, a 6/12 gable, vinyl, a 6' double
 * door on the front - a gable end, the ridge running front to back along the longer walls - and a 2' x 3' window on
 * the right. Under a minute with a tape: four numbers, three taps for the roof and siding, two for the openings.
 */
const SHED_BOX = {
  widthFeet: 12,
  depthFeet: 16,
  wallFeet: 8,
  roof: "gable",
  pitch: 6,
  cladding: "vinyl",
  openings: [
    { id: "door", kind: "door", wall: 0, widthFeet: 6, heightFeet: ft(6, 8) },
    { id: "window", kind: "window", wall: 1, widthFeet: 2, heightFeet: 3 },
  ],
};
const shed = x.asBuilding(x.quickBoxExterior(SHED_BOX), "Shed", "building-shed");
const house = ownersHouse();
const shedQ = x.exteriorQuantities(shed);
const lineFeet = (plan, kind) => plan.lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.feet, 0);
const PF6 = Math.sqrt(1 + 0.25); // the 6/12 pitch factor, 1.118034

await test("the shed's roof: 2.95 SQ, an 18' ridge, two 18' eaves, four rakes, no hip or valley", () => {
  const plan = shedQ.roof;
  const r = shedQ.roofing;
  assert(plan && r && plan.shape === "rectangle", "a rectangle's roof");
  // The ridge front to back, over the 16' sides, run on a 1' rake overhang each end: 18'. The eaves the same, one down each side.
  near(lineFeet(plan, "ridge"), 18, "ridge");
  near(lineFeet(plan, "eave"), 36, "eaves, 2 x 18'");
  // Each rake from the eave's drip line (1'4" out) up to the ridge: 6' + 1'4" = 7'4" of run, x 1.118 on the slope; four of them.
  // (The outline's corners are kept to a millionth of a foot: a rake's length to a ten-thousandth.)
  near(lineFeet(plan, "rake"), 4 * ft(7, 4) * PF6, "rakes, 4 x 8'2.4\"", 1e-4);
  near(lineFeet(plan, "hip") + lineFeet(plan, "valley") + lineFeet(plan, "step") + lineFeet(plan, "headwall"), 0, "no hip, valley or flashing");
  // Inside the drip line: (16' + 2 x 1') x (12' + 2 x 1'4") = 18' x 14'8" = 264 SF of plan, x 1.118 = 295.16 SF.
  near(plan.planSquareFeet, 264, "plan inside the drip line", 1e-4);
  near(r.areaSquareFeet, 264 * PF6, "roof SF", 1e-4);
  near(r.squares, 2.9516, "squares", 5e-5);
  assert(r.squares.toFixed(2) === "2.95" && formatPitch6(r) && !r.pitchAssumed, `${r.squares} at ${r.pitch}`);
  // What runs along them: drip edge eaves + rakes; starter the eaves; the eavestrough one run down each side.
  near(r.dripEdgeFeet, 36 + 4 * ft(7, 4) * PF6, "drip edge", 1e-4);
  near(r.starterFeet, 36, "starter");
  near(r.gutter.feet, 36, "eavestrough");
  assert(r.gutter.downspouts === 2 && r.gutter.endCaps === 4, `${r.gutter.downspouts} downspouts, ${r.gutter.endCaps} end caps`);
  // The roof's ends, each over a 12' gable wall: gables, as typed on the box.
  assert(plan.ends.length === 2 && plan.ends.every((e) => e.kind === "gable"), JSON.stringify(plan.ends));
});
function formatPitch6(r) {
  return Math.abs(r.pitch - 6) < 1e-9;
}

await test("the shed's walls: 484 SF gross with its two 18 SF gables, 46 SF of openings, 438 SF of vinyl net", () => {
  const by = (n) => shedQ.sides[shed.sides.findIndex((s) => s.name === n)];
  // The front and rear: 12' x 8' and a gable 12' wide rising 3' (6' of run at 6/12) - 96 + 18 = 114 SF.
  near(by("Front").grossSquareFeet, 114, "front gross");
  near(by("Rear").grossSquareFeet, 114, "rear gross");
  near(by("Right").grossSquareFeet, 128, "right gross, 16' x 8'");
  near(by("Left").grossSquareFeet, 128, "left gross");
  near(shedQ.totals.gableSquareFeet, 36, "the two gables");
  // Off them: the double door 6' x 6'8" (40 SF) and the window 2' x 3' (6 SF).
  near(by("Front").openingSquareFeet, 40, "the door");
  near(by("Right").openingSquareFeet, 6, "the window");
  near(shedQ.totals.grossSquareFeet, 484, "gross");
  near(shedQ.totals.openingSquareFeet, 46, "openings");
  near(shedQ.totals.netSquareFeet, 438, "net");
  assert(shedQ.cladding.length === 1 && shedQ.cladding[0].kind === "vinyl", JSON.stringify(shedQ.cladding));
  // Trim round them: a door on three sides (6'8" + 6'8" + 6'), a window on four (2 x (2' + 3')).
  near(shedQ.totals.openingTrimFeet, 2 * ft(6, 8) + 6 + 10, "trim");
  // The door at the ground, in the middle of the front; the window topped at 6'8", in the middle of the right.
  const door = shed.sides[0].openings[0];
  const win = shed.sides[1].openings[0];
  assert(door.kind === "door" && door.sillFeet === 0 && near0(door.fromLeftFeet, 3), JSON.stringify(door));
  assert(win.kind === "window" && near0(win.sillFeet, ft(3, 8)) && near0(win.fromLeftFeet, 7), JSON.stringify(win));
  // Clad to the ground: an outbuilding has no parging.
  assert(shed.sides.every((s) => s.base === "grade" && s.bands.length === 1 && s.bands[0].kind === "vinyl"), "vinyl to the ground");
});
function near0(a, b) {
  return Math.abs(a - b) < 1e-9;
}

/** The shed with every part ticked for the scope, as the estimator would tick it. */
const shedInScope = { ...shed, scope: { roofing: true, sides: shed.sides.map((s) => s.id), soffitFascia: true, eavestrough: true } };

await test("the shed's scope lines come after the house's, each named for it; the house's are as they always were", () => {
  const houseAll = allInScope(house);
  const lines = x.siteScopeLines(houseAll, [shedInScope]);
  const own = x.exteriorScopeLines(houseAll);
  // The house's first, untouched, then the shed's.
  assert(JSON.stringify(lines.roofing.slice(0, own.roofing.length)) === JSON.stringify(own.roofing), "the house's roofing lines first, as they were");
  assert(JSON.stringify(lines.siding.slice(0, own.siding.length)) === JSON.stringify(own.siding), "the house's siding lines first, as they were");
  const shedRoofing = lines.roofing.slice(own.roofing.length);
  const shedSiding = lines.siding.slice(own.siding.length);
  assert(
    JSON.stringify(shedRoofing) ===
      JSON.stringify([
        "Shed – Remove & replace roofing – material to confirm – 6/12 – 2.95 SQ (all slopes)",
        "Shed – Hip & ridge cap – 18.0 LF",
        "Shed – Starter – 36.0 LF (eaves)",
        "Shed – Ice & water barrier – 36.0 LF (eaves + valleys)",
      ]),
    JSON.stringify(shedRoofing),
  );
  assert(
    JSON.stringify(shedSiding) ===
      JSON.stringify([
        "Shed – Remove & replace vinyl siding – Front, Right, Rear, Left – 438.0 SF (484.0 SF less 46.0 SF of openings)",
        "Shed – House wrap – 438.0 SF",
        "Shed – Trim & J-channel round openings – 29.3 LF",
        `Shed – Remove & replace soffit – material to confirm – 36.0 LF at 1'4" overhang (48.0 SF) – eaves`,
        `Shed – Remove & replace soffit – material to confirm – 32.8 LF at 1' overhang (32.8 SF) – rakes`,
        "Shed – Remove & replace fascia – material to confirm – 68.8 LF (eaves + rakes)",
        "Shed – Remove & replace eavestrough – 36.0 LF",
        "Shed – End caps – 4",
        "Shed – Drops – 2",
        "Shed – Elbows – 6",
        "Shed – Remove & replace downspouts – 2 – 18.4 LF (eave height + 15%)",
      ]),
    JSON.stringify(shedSiding),
  );
  // Nothing ticked on the shed: nothing of it on the scope - measuring it is not deciding to replace it.
  const untouched = x.siteScopeLines(houseAll, [shed]);
  assert(untouched.roofing.length === own.roofing.length && untouched.siding.length === own.siding.length, "an unticked shed adds nothing");
  // No buildings: exactly the house's.
  assert(JSON.stringify(x.siteScopeLines(houseAll, undefined)) === JSON.stringify(own), "the house alone");
  // And they reach the document request, which copies each line exactly.
  const claim = fixture("claim-saved-1016.json");
  const state = x.parseSavedClaimState({ ...claim, extraction: { rooms: [] }, sketch: { ...claim.sketch, exterior: houseAll, buildings: [shedInScope] } });
  const req = x.generationRequest(state);
  assert(req && JSON.stringify(req.exterior) === JSON.stringify([...lines.roofing, ...lines.siding]), JSON.stringify(req?.exterior?.slice(-3)));
});

const META2 = { title: "The owner's house", date: "Oct 16, 2026", madeWith: "Scrivn" };
const site = x.siteReport(house, [shedInScope], META2);

await test("the shed's report section: its own plan, roof plan, four elevations, sides, photos and To check", () => {
  assert(site && site.house && site.buildings.length === 1, "the house and one building");
  const { name, report: r } = site.buildings[0];
  assert(name === "Shed", name);
  const fact = (label) => r.facts.find((f) => f.label === label)?.value;
  assert(fact("Footprint") === "192 SF · perimeter 56' · 4 sides", fact("Footprint"));
  assert(fact("Walls") === "484 SF gross · 46 SF of openings · 438 SF net", fact("Walls"));
  assert(fact("Cladding") === "Vinyl siding 438 SF net", fact("Cladding"));
  assert(fact("Openings") === "1 window · 1 door · 0 garage doors", fact("Openings"));
  assert(fact("Roof") === "2.95 SQ (295 SF) · 6/12", fact("Roof"));
  assert(fact("Roof lines") === `Ridge 18' · Eave 36' · Rake 32'10"`, fact("Roof lines"));
  // Typed on the box, so said as typed: the pitch and the gable ends. Only the overhangs (not on the box) are assumed.
  assert(r.sources.includes("Pitch: 6/12, typed.") && r.sources.includes("Roof ends: Front gable (set by the estimator), Rear gable (set by the estimator)."), r.sources.join(" | "));
  assert(r.sources[0] === "Sizes: as drawn and typed in Scrivn." && r.sources[1] === "Walls, heights, materials and openings: as entered in Scrivn.", r.sources.join(" | "));
  assert(!r.assumed.some((a) => /roof ends|pitch/i.test(a)) && r.assumed.some((a) => a.startsWith("The eave overhang, 1'4\": Scrivn's default.")), r.assumed.join(" | "));
  // The four sides, each with every dimension; the four compass views; the roof plan's words.
  assert(JSON.stringify(r.sides.map((s) => s.heading)) === JSON.stringify(["Front · 12' · 74 SF net", "Right · 16' · 122 SF net", "Rear · 12' · 114 SF net", "Left · 16' · 128 SF net"]), JSON.stringify(r.sides.map((s) => s.heading)));
  assert(r.sides[0].dims.some((d) => d.startsWith("Door 1: 6' × 6'8\", at the bottom, 3' from the left end")), r.sides[0].dims.join(" | "));
  assert(r.sides[1].dims.some((d) => d.startsWith("Window 1: 2' × 3', sill 3'8\" up, 7' from the left end")), r.sides[1].dims.join(" | "));
  assert(r.views.length === 4 && r.views.map((v) => v.view.compass).join() === "south,east,north,west", r.views.map((v) => v.heading).join(" | "));
  assert(r.roof && r.roof.title === "6/12 · 2.95 SQ (295 SF) · eave overhang 1'4\", rake 1' · front at the bottom" && r.roof.slopes === "A 148 SF at 6/12 (Right) · B 148 SF at 6/12 (Left)", JSON.stringify(r.roof));
  // Typed with a tape: no photos, nothing to check.
  assert(r.photos.length === 0 && r.notes.length === 0, JSON.stringify(r.notes));
  // Its tables are its own: the walls by side, the openings, the roof's lines.
  const walls = r.tables.find((t) => t.caption === "Walls by side and material");
  assert(walls.rows.map((row) => row[0]).filter(Boolean).join() === "Front,Right,Rear,Left" && walls.rows.every((row) => row[2] === "entered"), JSON.stringify(walls.rows));
  const roofLines = r.tables.find((t) => t.caption === "Roof lines");
  assert(roofLines.rows.find((row) => row[0] === "Ridge")[1] === "18.0" && roofLines.rows.find((row) => row[0] === "Rakes")[1] === "32.8", JSON.stringify(roofLines.rows));
  // The house's own report is untouched by the shed beside it.
  assert(stable(site.house.facts) === stable(x.exteriorReport(house, META2).facts) && stable(site.house.tables) === stable(x.exteriorReport(house, META2).tables), "the house's report as on its own");
});

await test("the cover: each building's totals and all of them together", () => {
  const [h, s, all] = site.rows.concat(site.combined);
  const hq = x.exteriorQuantities(house);
  assert(h.name === "House" && s.name === "Shed" && all.name === "All buildings", site.rows.map((r) => r.name).join());
  near(h.wallsNetSquareFeet, hq.totals.netSquareFeet, "the house's walls");
  near(h.roofSquares, hq.roofing.squares, "the house's roof");
  near(s.footprintSquareFeet, 192, "the shed's footprint");
  near(s.wallsGrossSquareFeet, 484, "the shed's walls gross");
  near(s.wallsNetSquareFeet, 438, "the shed's walls net");
  near(s.roofSquares, 2.9516, "the shed's roof", 5e-5);
  assert(s.openings === 2, "two openings");
  near(all.footprintSquareFeet, hq.footprint.areaSquareFeet + 192, "footprints together");
  near(all.wallsGrossSquareFeet, hq.totals.grossSquareFeet + 484, "walls gross together", 1e-4);
  near(all.wallsNetSquareFeet, hq.totals.netSquareFeet + 438, "walls net together", 1e-4);
  near(all.roofSquares, hq.roofing.squares + s.roofSquares, "squares together");
  // As the cover prints them.
  const rows = site.totals.rows;
  assert(site.totals.caption === "The buildings on this claim" && rows.length === 3, JSON.stringify(rows));
  assert(JSON.stringify(rows[1]) === JSON.stringify(["Shed", "192.0", "484.0", "438.0", "2", "2.95"]), JSON.stringify(rows[1]));
  assert(rows[2][0] === "All buildings" && rows[2][5] === (hq.roofing.squares + s.roofSquares).toFixed(2) && rows[2][3] === (Math.round((hq.totals.netSquareFeet + 438) * 10) / 10).toFixed(1), JSON.stringify(rows[2]));
  // Only the house: no table, the report as it always was.
  const alone = x.siteReport(house, [], META2);
  assert(alone.totals === null && alone.buildings.length === 0, "no table without another building");
});

/** The PDF's page headings, as drawn: each page's text in order (jsPDF writes its text unencoded). */
function pagesOf(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  const pages = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const words = [...m[1].matchAll(/\((.*?)\) Tj/g)].map((w) => w[1]);
    if (words.length > 0) pages.push(words);
  }
  return pages;
}

await test("the report PDF: the house's pages, then the shed's section, every page of it headed Shed, and the totals on the cover", () => {
  const pdfOf = (s) => x.exteriorReportBytes({ report: s.house, svgOf, buildings: s.buildings.map((b) => ({ name: b.name, report: b.report })), totals: s.totals, footer: "Scrivn" });
  const bytes = pdfOf(site);
  const pages = pagesOf(bytes);
  const housePages = pagesOf(x.exteriorReportBytes({ report: site.house, svgOf, footer: "Scrivn" })).length;
  const firstShed = pages.findIndex((p) => p.includes("Shed") && p.some((w) => w.startsWith("Measured, drawn and roofed on its own")));
  assert(firstShed >= housePages, `the shed's section after the house's ${housePages} pages: at ${firstShed}`);
  const shedPages = pages.slice(firstShed);
  const heads = shedPages.map((p) => p.find((w) => /^Shed( \xb7 |$)/.test(w)) ?? "");
  // Its own page (plan), its roof plan, its elevations (the four views and the sides), its measurements.
  for (const h of ["Shed", "Shed \xb7 Roof plan", "Shed \xb7 Elevations", "Shed \xb7 Measurements"]) assert(heads.includes(h), `no page headed ${h}: ${JSON.stringify(heads)}`);
  // Every page of it says whose it is at its foot - a table run on to a page of its own too; the house's pages don't.
  const foot = (p) => p.find((w) => w.startsWith("Exterior report · ")) ?? "";
  assert(shedPages.every((p) => foot(p).startsWith("Exterior report · The owner's house · Shed · page ")), JSON.stringify(shedPages.map(foot)));
  assert(pages.slice(0, firstShed).every((p) => /^Exterior report · The owner's house · page \d+ of \d+$/.test(foot(p))), JSON.stringify(pages.slice(0, firstShed).map(foot)));
  const all = shedPages.flat();
  for (const w of ["South elevation \xb7 the front", "East elevation \xb7 to the right of the front", "North elevation \xb7 the back", "West elevation \xb7 to the left of the front", "Each side", "Footprint", "Walls by side and material", "Roof lines"]) assert(all.includes(w), `the shed's section has no "${w}"`);
  // The cover lists the buildings, and their totals.
  const cover = pages[0];
  assert(cover.includes("The buildings on this claim") && cover.includes("All buildings") && cover.includes("Shed") && cover.includes("2.95"), JSON.stringify(cover.slice(0, 60)));
  // Every page's foot counts them all.
  assert(all.some((w) => new RegExp(`page ${pages.length} of ${pages.length}$`).test(w)), "the footers count every page");
  if (process.env.SCRIVN_REPORT_OUT) {
    mkdirSync(process.env.SCRIVN_REPORT_OUT, { recursive: true });
    writeFileSync(join(process.env.SCRIVN_REPORT_OUT, "house-and-shed.pdf"), Buffer.from(bytes));
    writeFileSync(join(process.env.SCRIVN_REPORT_OUT, "house-and-shed-pages.json"), JSON.stringify({ housePages, firstShed: firstShed + 1, pages: pages.length }, null, 1));
  }
  // A claim with only the shed measured: a cover with the table, then the shed's section.
  const only = x.siteReport(undefined, [shedInScope], META2);
  const onlyPages = pagesOf(pdfOf(only));
  assert(onlyPages[0].includes("The buildings on this claim") && onlyPages[1].includes("Shed"), JSON.stringify(onlyPages[1]?.slice(0, 5)));
});

console.log("\nthe quick box's other roofs");

await test("a hip on the quick box: a 4' ridge and four 11' hips over 12' x 16' at 6/12, eaves all round", () => {
  const e = x.quickBoxExterior({ ...SHED_BOX, roof: "hip" });
  const q = x.exteriorQuantities(e);
  // Hip ends take the eave's overhang: drip line 14'8" x 18'8". The ridge is the difference, 4'.
  near(lineFeet(q.roof, "ridge"), 4, "ridge", 1e-4);
  // Each hip runs 7'4" in each way from its corner; along it, x sqrt(2 + (6/12)^2) = 1.5: 11'.
  near(lineFeet(q.roof, "hip"), 4 * ft(7, 4) * 1.5, "hips", 1e-4);
  near(lineFeet(q.roof, "eave"), 2 * (ft(14, 8) + ft(18, 8)), "eaves all round", 1e-4);
  assert(lineFeet(q.roof, "rake") === 0 && q.roofing.gutter.endCaps === 0, "no rake: the eavestrough all the way round, no end");
  near(q.roofing.areaSquareFeet, ft(14, 8) * ft(18, 8) * PF6, "roof SF", 1e-3);
  // No gables, so the walls are 8' all round: 448 SF less the same 46.
  near(q.totals.grossSquareFeet, 448, "walls gross");
  const r = x.exteriorReport(e, META);
  assert(r.sources.includes("Roof ends: Front hip (set by the estimator), Rear hip (set by the estimator)."), r.sources.join(" | "));
});

await test("one slope on the quick box: low at the rear, its high edge at the front counted with the rakes, no eavestrough there", () => {
  const e = x.quickBoxExterior({ ...SHED_BOX, roof: "one", pitch: 3 });
  const rear = e.sides[2];
  assert(e.roof.oneSlopeTo === rear.id, "draining to the rear");
  const q = x.exteriorQuantities(e);
  const k = 3 / 12;
  const run = 16 + ft(1, 4) + 1; // the rear's eave overhang out, the front's rake overhang past the high wall
  const pf3 = Math.sqrt(1 + k * k);
  // One plane: no ridge, hip or valley. The eave along the rear, 12' + two 1' rake overhangs; the high edge the same, level.
  near(lineFeet(q.roof, "ridge") + lineFeet(q.roof, "hip") + lineFeet(q.roof, "valley"), 0, "one plane");
  near(lineFeet(q.roof, "eave"), 14, "the eave, at the rear", 1e-4);
  near(lineFeet(q.roof, "rake"), 14 + 2 * run * pf3, "the two sloped rakes and the high edge", 1e-4);
  const eave = q.roof.edges.find((x) => x.kind === "eave");
  assert(eave.sideId === rear.id, `the eave is the rear's: ${eave.sideId}`);
  assert(q.roof.facets.length === 1 && q.roof.ends.length === 0, "one slope, no end to pick gable or hip for");
  near(q.roofing.areaSquareFeet, 14 * run * pf3, "roof SF", 1e-3);
  // The eavestrough is only the low eave: one run, one downspout.
  near(q.roofing.gutter.feet, 14, "eavestrough");
  assert(q.roofing.gutter.downspouts === 1, `${q.roofing.gutter.downspouts} downspouts`);
  // The walls: the rear 8', the front 8' + 16' x 3/12 = 12', the sides sloping from one to the other.
  near(q.totals.grossSquareFeet, 12 * 8 + 12 * 12 + 2 * 16 * ((8 + 12) / 2), "walls gross", 1e-4);
  assert(/One slope, draining to Rear: its high edge is counted with the rakes/.test(q.roof.note ?? ""), q.roof.note);
  // Stood up in 3D: its walls up to the slope, the front one 4' taller than the rear, the roof one plane with its fascia round.
  const m = x.exteriorModel(e);
  assert(m.ok && m.model.roof && m.model.walls.length === 4 && m.model.roof.fasciaFaces.length === 4, m.ok ? "a roof, four walls, four fascia" : m.reason);
  const topOf = (name) => Math.max(...m.model.walls.find((w) => w.name === name).outline.map((p) => p.y));
  near(topOf("Front") - topOf("Rear"), 16 * k, "the high wall over the low", 1e-6);
  // Back to two slopes: the box's gables again, the ends as set.
  const two = { ...e, roof: x.withOneSlope(e.roof, null) };
  assert(x.exteriorQuantities(two).roof.facets.length === 2 && !("oneSlopeTo" in two.roof), "gable again");
  // On a house that isn't a rectangle it is not read: the owner's twelve corners keep their roof.
  const odd = { ...house, roof: { ...house.roof, oneSlopeTo: house.sides[0].id } };
  near(x.exteriorQuantities(odd).roofing.squares, x.exteriorQuantities(house).roofing.squares, "not a rectangle: as it was");
});

console.log("\nclaims saved before buildings, and a device copy gone wrong");

await test("a claim saved before buildings comes back from parseSavedClaimState exactly as saved, and opens", () => {
  const stored = fixture("claim-saved-1016.json");
  assert(!("buildings" in stored.sketch), "saved before there were any");
  const once = x.parseSavedClaimState(JSON.parse(JSON.stringify(stored)));
  assert(JSON.stringify(once.sketch) === JSON.stringify(stored.sketch), "the sketch as saved");
  assert(!("buildings" in once.sketch), "no list added");
  const twice = x.parseSavedClaimState(JSON.parse(JSON.stringify(once)));
  assert(JSON.stringify(twice) === JSON.stringify(once), "the same answer run twice (the sync check)");
  // What the claim page and the editor read off it: no list, no crash.
  assert(x.buildingsOf(once.sketch).length === 0 && x.hasAnyExterior(once.sketch), "the house only");
  const lines = x.siteScopeLines(once.sketch.exterior, once.sketch.buildings);
  assert(JSON.stringify(lines) === JSON.stringify(x.exteriorScopeLines(once.sketch.exterior)), "its lines as before");
  const s = x.siteReport(once.sketch.exterior, once.sketch.buildings, META);
  assert(s && s.buildings.length === 0 && s.totals === null && stable(s.house.tables) === stable(x.exteriorReport(stored.sketch.exterior, META).tables), "its report as before");
});

await test("a device copy with a broken list keeps what can be opened, names and ids the rest, and is the same run twice", () => {
  const stored = fixture("claim-saved-1016.json");
  const half = { ...shed };
  delete half.id;
  delete half.name;
  const broken = { ...stored, sketch: { ...stored.sketch, buildings: [null, 7, { sides: "no" }, { sides: [] }, shedInScope, half] } };
  const once = x.parseSavedClaimState(JSON.parse(JSON.stringify(broken)));
  const kept = once.sketch.buildings;
  assert(kept.length === 2 && kept[0].id === "building-shed" && kept[0].name === "Shed", JSON.stringify(kept.map((b) => [b.id, b.name])));
  assert(kept[1].id === "building-saved-5" && kept[1].name === "Building" && kept[1].sides.length === 4, JSON.stringify([kept[1].id, kept[1].name]));
  assert(JSON.stringify(x.parseSavedClaimState(JSON.parse(JSON.stringify(once)))) === JSON.stringify(once), "the same answer run twice");
  // Not a list at all: dropped, the claim as it was.
  const junk = x.parseSavedClaimState({ ...stored, sketch: { ...stored.sketch, buildings: "shed" } });
  assert(!("buildings" in junk.sketch) && JSON.stringify(junk.sketch) === JSON.stringify(stored.sketch), "a list that isn't one");
  // And what opens it doesn't throw: the lines and the report of everything kept.
  x.siteScopeLines(once.sketch.exterior, kept);
  assert(x.siteReport(once.sketch.exterior, kept, META).buildings.length === 2, "both reported");
});

await test("a scan lands on the house; the shed stays as it was", () => {
  const before = { rooms: [], exterior: undefined, buildings: [shedInScope] };
  const adopted = x.adoptScan(before, { id: "scan-1", claimId: "c", captureId: null, capturedAt: null, receivedAt: "2026-10-16T12:00:00.000Z", level: 0, body: fixture("scan-exterior-v2-sample.json"), deviceName: null });
  assert(adopted.sketch, adopted.error);
  assert(adopted.sketch.exterior && adopted.sketch.exterior.source.kind === "scan", "the house is the scan's");
  assert(adopted.sketch.buildings.length === 1 && adopted.sketch.buildings[0] === shedInScope, "the shed untouched");
});

await test("names: unique among the claim's, never House; a name in a sentence", () => {
  assert(x.uniqueName("Shed", ["Shed"]) === "Shed 2" && x.uniqueName("shed", ["Shed", "Shed 2"]) === "shed 3" && x.uniqueName("House", []) === "House 2", "unique");
  assert(x.uniqueName("  ", []) === "Building", "blank");
  assert(x.subjectWords(null) === "the house" && x.subjectWords("Shed") === "the shed" && x.subjectWords("Detached garage") === "the detached garage" && x.subjectWords("Barn B") === "the Barn B", "in a sentence");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
// Something the bundle opens keeps Node waiting after the last test: done is done.
process.exit(failures.length > 0 ? 1 : 0);
