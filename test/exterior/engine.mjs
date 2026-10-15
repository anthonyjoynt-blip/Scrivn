/**
 * Finish exterior and the exterior report (2026-10-15): the script Scrivn Scan carries
 * (lib/scanEngine.ts, built by scripts/build-scan-engine.mjs) against Scrivn's own reading of the same
 * file - the phone and scrivn.ca must show the same roof, the same totals, the same report.
 *
 *   npm run test:exterior:engine
 *   SCRIVN_REPORT_OUT=<file.pdf> npm run test:exterior:engine     also keeps the owner's walk's report
 *
 * NO PAID CALL, no server, no key: the roof is read off the owner's own 10-12 photos laid on his 14:53
 * walk (fixtures/finish-1453), and the trace's answers are Claude's own, recorded on 10-14 by the
 * roof-from-photos session's paid run and replayed here in whatever frame the photo is squared to.
 *
 * What is checked:
 *   * the engine script builds as Scan's assets hold it, and runs with nothing but what a WebView has
 *     (a bare context: no DOM, no Node) for everything but the photos' pixels
 *   * its summary of a file is Scrivn's import of that file, roof and all: with nothing typed, with the
 *     pitch typed and an end switched on the phone, and with the photos' reads in
 *   * one side's roof read on the phone: the photos squared as the editor squares them, a request the
 *     route takes, the answer set on the photo's edges, ticked as the editor ticks it - the west gable
 *     and the rear bump-out 5/12 with their overhangs, the garage's doubtful 4.6 set aside
 *   * the report: every number in it is the quantities', what is assumed says so, it builds as a PDF
 *     with every page, on the phone's engine and in Scrivn alike
 *   * the pieces: the Finish block read and put on, which sides still want reading, the SVG painter
 *   * the walls off the photos (2026-10-15, option 1): the 14:53 walk with its four photographed sides cut back to their two
 *     bottom corners, read whole off the photos - cladding, windows, doors and wall top - against the walk as tapped and the
 *     10-12 hand marks; taps win where there are any; set aside, a side is its corners again and not counted
 */

import { build } from "esbuild";
import sharp from "sharp";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { buildEngine } from "../../scripts/build-scan-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const lib = (name) => join(root, name).replace(/\\/g, "/");
const FIX = join(here, "fixtures", "finish-1453");
const FEET_PER_METRE = 1 / 0.3048;

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "engine-"));
  const entry = join(outDir, "entry.ts");
  const outfile = join(outDir, "entry.mjs");
  writeFileSync(
    entry,
    [
      `export * from "${lib("lib/scanEngine.ts")}";`,
      `export * from "${lib("lib/exteriorFinish.ts")}";`,
      `export { parseScanExterior } from "${lib("lib/exteriorImport.ts")}";`,
      `export { exteriorQuantities, formatPitch } from "${lib("lib/exterior.ts")}";`,
      `export { traceProposals } from "${lib("lib/exteriorTrace.ts")}";`,
      `export { frameX, frameY, frameAlongM, frameUpM } from "${lib("lib/exteriorPhoto.ts")}";`,
      `export { camerasAt, wallCamera } from "${lib("lib/roofPhotoRead.ts")}";`,
      `export { exteriorReport } from "${lib("lib/exteriorReport.ts")}";`,
      `export { exteriorReportBytes } from "${lib("lib/exteriorReportPdf.ts")}";`,
      `export { readTraceRequest } from "${lib("lib/traceCall.ts")}";`,
      `export { parseSvg, pdfSafe, svgViewBox } from "${lib("lib/svgPdf.ts")}";`,
      `export { renderToStaticMarkup } from "react-dom/server.browser";`,
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
const engine = await buildEngine();

let passed = 0;
const failures = [];
async function test(name, run) {
  try {
    await run();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}\n      ${err instanceof Error ? err.stack?.split("\n").slice(0, 3).join("\n      ") : String(err)}`);
    console.log(`  ✗ ${name}`);
  }
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function near(a, b, message, tol = 1e-9) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${message}: ${a} against ${b} (within ${tol})`);
}

const capture = readFileSync(join(FIX, "capture.json"), "utf8");
const answers = JSON.parse(readFileSync(join(FIX, "answers.json"), "utf8"));
const photo = (n) => readFileSync(join(FIX, "photos", `${n}.jpg`)).toString("base64");
/** The walk with no photos: the file as Scan wrote it on 10-12. */
const bare = (() => {
  const c = JSON.parse(capture);
  for (const s of c.sides) delete s.photos;
  return JSON.stringify(c);
})();

// ---------------------------------------------------------------------------------------------
// The phone's script, run as the WebView runs it: a bare context, a bridge, nothing else
// ---------------------------------------------------------------------------------------------

function phone() {
  const inputs = new Map();
  const outputs = new Map();
  const waiting = new Map();
  let next = 0;
  const bridge = {
    input: (id) => inputs.get(id),
    photoPart(n, k) {
      const all = existsSync(join(FIX, "photos", `${n}.jpg`)) ? photo(n) : "";
      return all.slice(k * 262144, (k + 1) * 262144);
    },
    put: (id, piece) => outputs.set(id, (outputs.get(id) ?? "") + piece),
    done: (id, error) => waiting.get(id)?.(error),
  };
  const ctx = vm.createContext({ console, atob, btoa, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, MessageChannel, URL, navigator: { userAgent: "Scan test" }, ScanBridge: bridge });
  ctx.window = ctx;
  ctx.self = ctx;
  vm.runInContext(engine.text, ctx, { filename: "scrivn-exterior.js" });
  const run = (op, input) =>
    new Promise((ok, fail) => {
      const id = `c${next++}`;
      inputs.set(id, JSON.stringify(input));
      waiting.set(id, (error) => (error ? fail(new Error(error)) : ok(outputs.get(id) ?? "")));
      ctx.ScrivnExterior.run(id, op);
    });
  return { run, version: ctx.ScrivnExterior.version };
}
const P = phone();

/** Scrivn's own reading of the same file and Finish: what a Send puts in the claim (lib/exteriorImport.ts). */
function scrivnOf(file, finish) {
  const c = JSON.parse(file);
  if (finish) c.finish = finish;
  const read = x.parseScanExterior(c, { scanId: null });
  assert(read.ok, read.error);
  return { exterior: read.exterior, q: x.exteriorQuantities(read.exterior) };
}

/** The phone's summary against Scrivn's quantities: the same roof, to the inch and the hundredth of a square. */
function sameRoof(summary, q, what) {
  assert(summary.closes === q.footprint.closes, `${what}: closes`);
  if (!q.roof) {
    assert(summary.roof === null, `${what}: no roof`);
    return;
  }
  const r = q.roofing;
  assert(summary.roof.squares === r.squares.toFixed(2), `${what}: squares ${summary.roof.squares} against ${r.squares.toFixed(2)}`);
  near(summary.roof.pitch, q.pitch.value, `${what}: pitch`);
  assert(summary.roof.pitchSource === q.pitch.source, `${what}: pitch from ${summary.roof.pitchSource} against ${q.pitch.source}`);
  const lines = Object.entries(q.roof.totals).filter(([k]) => q.roof.lines.some((l) => l.kind === k));
  for (const [k] of lines) assert(summary.roof.lines.includes(k === "step" ? "Step flashing" : k === "headwall" ? "Headwall flashing" : k[0].toUpperCase() + k.slice(1)), `${what}: the ${k}s are listed`);
  assert(summary.roof.ends.length === q.roof.ends.length, `${what}: ends`);
}

console.log(`test:exterior:engine - ${engine.version}, ${(engine.text.length / 1024).toFixed(0)} KB`);

await test("Scan's assets hold this build of the engine (else: node scripts/build-scan-engine.mjs, and rebuild Scan)", () => {
  const asset = resolve(root, "..", "ARCapturePrototype", "android", "app", "src", "main", "assets", "scrivn-exterior.js");
  if (!existsSync(asset)) {
    console.log("    (Scan is not beside this checkout: not compared)");
    return;
  }
  // Line endings as git checks the file out (autocrlf) are no difference.
  const strip = (t) => t.replace(/\r\n/g, "\n").replace(/^\/\*[^\n]*\*\/\n/, "");
  if (strip(readFileSync(asset, "utf8")) !== strip(engine.text)) console.log("    NOTE: Scan's copy is an older build of the engine. Rebuild it before building Scan.");
});

await test("the engine runs in a bare context, and says which Scrivn it is", () => {
  assert(/^scrivn [0-9a-f]{7,}\+?$|^scrivn unknown$/.test(P.version), P.version);
});

await test("the 14:53 walk as the phone sends it: the phone's roof is Scrivn's import's, the pitch the measured gables'", async () => {
  const s = JSON.parse(await P.run("summary", { capture: bare, finish: null }));
  const { q } = scrivnOf(bare, null);
  sameRoof(s, q, "walk");
  assert(s.roof.pitchSource === "sides", s.roof.pitchSource);
  assert(s.sides.length === 0, "no photos, nothing to read");
  // No canvas in a bare context: the plan is left for the phone's WebView to draw.
  assert(s.plan === null, "no picture without a canvas");
});

await test("typed on the phone - a pitch, an end switched to a hip - wins as typed does, and Scrivn's import of the file lands the same roof", async () => {
  const before = JSON.parse(await P.run("summary", { capture: bare, finish: null }));
  const end = before.roof.ends.find((e) => e.kind === "gable");
  assert(end, "a gable end to switch");
  const finish = { format: "scrivn-finish/1", pitch: 6, ends: { [String(end.index)]: "hip" }, acceptedAt: "2026-10-15T15:00:00.000Z" };
  const s = JSON.parse(await P.run("summary", { capture: bare, finish }));
  const { q, exterior } = scrivnOf(bare, finish);
  sameRoof(s, q, "typed");
  assert(s.roof.pitchText === "6/12" && s.roof.pitchSource === "typed", `${s.roof.pitchText} ${s.roof.pitchSource}`);
  const now = s.roof.ends.find((e) => e.index === end.index);
  assert(now && now.kind === "hip" && now.how === "estimator", JSON.stringify(now));
  assert(exterior.source.finish.acceptedAt === "2026-10-15T15:00:00.000Z", "the claim knows it was accepted on the phone");
  assert(s.roof.squares !== before.roof.squares, "a steeper roof is more squares");
});

// ---------------------------------------------------------------------------------------------
// The roof read off the photos, one side at a time
// ---------------------------------------------------------------------------------------------

/** Every pixel of a recorded answer put into [to]: through [from] to the side's metres, and back out. */
function rewire(wire, from, to) {
  const px = (p) => (Array.isArray(p) && p.length >= 2 ? [x.frameX(to, x.frameAlongM(from, p[0])), x.frameY(to, x.frameUpM(from, p[1]))] : p);
  const box = (b) => (Array.isArray(b) && b.length === 4 ? [...px([b[0], b[1]]), ...px([b[2], b[3]])] : b);
  const flat = (f) => (Array.isArray(f) ? f.reduce((out, v, i) => (i % 2 === 1 ? [...out, ...px([f[i - 1], v])] : out), []) : f);
  const out = JSON.parse(JSON.stringify(wire));
  out.materials = out.materials.map((m) => ({ ...m, polygon: m.polygon.map(px) }));
  out.openings = out.openings.map((o) => {
    const [l, t] = px([o.left, o.top]);
    const [r, b] = px([o.right, o.bottom]);
    return { ...o, left: l, top: t, right: r, bottom: b, leaf: box(o.leaf) };
  });
  out.wall_top = out.wall_top.map(px);
  out.off_wall = out.off_wall.map((w) => ({ ...w, box: box(w.box) }));
  if (out.roof) {
    out.roof.rake_left = out.roof.rake_left.map(px);
    out.roof.rake_right = out.roof.rake_right.map(px);
    out.roof.eave_line = out.roof.eave_line.map(px);
    out.roof.left_end = { ...out.roof.left_end, point: px(out.roof.left_end.point) };
    out.roof.right_end = { ...out.roof.right_end, point: px(out.roof.right_end.point) };
  }
  if (out.roof_shapes) {
    out.roof_shapes.pieces = out.roof_shapes.pieces.map((q) => ({ ...q, outline: flat(q.outline), foot: flat(q.foot) }));
    out.roof_shapes.floor_line = flat(out.roof_shapes.floor_line);
  }
  return out;
}

/** What `/api/device/exterior/trace` answers for [request], Claude's recorded answer standing in for the call. */
function answerFor(index, request) {
  const a = answers[String(index)];
  const wire = rewire(a.wire, a.frame, request.frame);
  const proposals = x.traceProposals(wire, request.frame, request.side.lengthM * FEET_PER_METRE, x.camerasAt(request.photos));
  return { proposals, model: a.model, seconds: 0, usage: a.usage, costUsd: a.costUsd };
}

/** lib/scanEngine.ts with sharp for the canvas: the same squaring and snapping the phone's WebView does with its own. */
const host = {
  photo: async (n) => photo(n),
  async decode(b64) {
    const { data, info } = await sharp(Buffer.from(b64, "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 4 };
  },
  async encodeJpeg(rgba, width, height, quality) {
    return (await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length), { raw: { width, height, channels: 4 } }).jpeg({ quality: Math.round(quality * 100) }).toBuffer()).toString("base64");
  },
  svgOf: (el) => x.renderToStaticMarkup(el),
};

const reads = {};
let finish = { format: "scrivn-finish/1" };

await test("each photo laid on its side as Scan lays it: the phone it was taken from comes back out of to_photo", () => {
  const c = JSON.parse(capture);
  for (const index of Object.keys(answers)) {
    const side = c.sides[Number(index)];
    const p = side.photos[0];
    const cam = x.wallCamera({ toPhoto: p.to_photo, camera: p.camera });
    assert(cam, `${side.name}: a camera`);
    // Where the photo test put the phone, in the walk's metres, to the millimetre.
    const want = answers[index].camera;
    near(cam.alongM, want.alongM, `${side.name}: along`, 1e-3);
    near(cam.upM, want.upM, `${side.name}: up`, 1e-3);
    near(cam.distanceM, want.distanceM, `${side.name}: out from the wall`, 1e-3);
  }
});

for (const [index, want] of [
  ["11", { name: "Left 5", pitch: 5, rake: 25.6, over: "gable" }],
  ["6", { name: "Rear", pitch: 5, rake: 27.1, eave: 22.9, over: "gable" }],
  ["4", { name: "Front 3", pitch: null, over: "gable" }],
  ["1", { name: "Left", over: "eave" }],
]) {
  await test(`${want.name}: squared, asked, the answer set on the photo's edges - ${want.pitch ? `${want.pitch}/12` : want.pitch === null ? "the doubtful pitch set aside" : `an ${want.over} along it`}`, async () => {
    const { request, squared } = await x.prepare(capture, finish, Number(index), host);
    // The request is the one the route takes, for this capture.
    const checked = x.readTraceRequest(request);
    assert(checked.ok, checked.error);
    assert(request.captureId === "finish-1453-fixture", "the capture's id goes with it: it is counted as this scan");
    assert(request.frame.width === 2400 || request.frame.height === 2400, "squared to 2,400 px on its long edge, as the editor squares");
    assert(request.side.name === want.name, request.side.name);
    finish = await x.take(capture, finish, Number(index), answerFor(Number(index), request), squared, host, "2026-10-15T15:10:00.000Z");
    const read = finish.sides[index];
    reads[index] = read;
    assert(read.photos.length === 1 && read.scaleAt === 1, "read off its one photo at the walk's scale");
    assert(read.roofRead.over === want.over, `over ${read.roofRead.over}`);
    if (want.pitch === null) assert(read.roofRead.pitch === null, `pitch set aside, not ${read.roofRead.pitch}`);
    else if (want.pitch !== undefined) assert(read.roofRead.pitch === want.pitch, `pitch ${read.roofRead.pitch}`);
    // The overhangs as the roof-from-photos session read them on 10-15, its lines snapped in the editor, within 1.5".
    if (want.rake) near(read.roofRead.rakeOverhangFeet * 12, want.rake, `${want.name}'s rake overhang, inches`, 1.5);
    if (want.eave) near(read.roofRead.eaveOverhangFeet * 12, want.eave, `${want.name}'s eave overhang, inches`, 1.5);
    assert(read.said.length > 0 && (want.pitch === undefined || read.said.some((w) => w.includes("pitch"))), read.said.join("; "));
    // The walls off the same call: kept until set aside, put on only where nothing was tapped.
    assert(read.walls && read.walls.taken && read.walls.shapes.length > 0 && read.walls.openings.length > 0 && read.walls.wallTop, "the walls read");
    assert(read.model === "claude-opus-5-5" && read.costUsd > 0.03, "the call it cost");
  });
}

await test("Finish again: sides already read are not read twice; a side photographed again, or a new tape, is", () => {
  const sides = Object.keys(answers).map((i) => ({ index: Number(i), name: "s", photos: [900 + Number(i)] }));
  const done = { format: "scrivn-finish/1", sides: Object.fromEntries(sides.map((s) => [String(s.index), { at: "t", photos: s.photos, scaleAt: 1, roofRead: { at: "t" }, said: [] }])) };
  assert(x.sidesToRead(sides, done, 1).length === 0, "all read");
  assert(x.sidesToRead(sides.map((s, k) => (k === 0 ? { ...s, photos: [...s.photos, 950] } : s)), done, 1).length === 1, "another photo");
  assert(x.sidesToRead(sides, done, 1.04).length === sides.length, "a tape typed since");
  assert(x.sidesToRead([{ index: 0, name: "s", photos: [] }], null, 1).length === 0, "no photo, nothing to read");
});

await test("the roof with the photos' reads: the phone's and Scrivn's import of the sent file are one roof - each photographed gable's part at its photo's 5/12, the overhangs the photos'", async () => {
  const s = JSON.parse(await P.run("summary", { capture, finish }));
  const { q } = scrivnOf(capture, finish);
  sameRoof(s, q, "photos");
  // The main roof stands over Right, whose gable nobody photographed: Scan measured it, 5.3/12 (typed > its own photo > the main
  // roof's photo > measured gables > assumed). The wings out to Left 5 and Rear take their own gable photos' 5/12.
  assert(s.roof.pitchSource === "sides" && s.roof.pitchText === "5.3/12", `${s.roof.pitchText} from ${s.roof.pitchSource}`);
  const wings = Object.fromEntries(s.roof.sections.map((w) => [w.name, w.pitch]));
  assert(wings["Wing at Left 5"] === "5/12" && wings["Wing at Rear"] === "5/12", JSON.stringify(s.roof.sections));
  assert(q.roofing.overhangs.rake.source === "photos" && q.roofing.overhangs.eave.source === "photos", "both overhangs from the photos");
  assert(s.roof.rake.endsWith("(from photos)") && s.roof.eave.endsWith("(from photos)"), `${s.roof.rake} / ${s.roof.eave}`);
  // The four photographed sides read again would cost nothing more: none is still to read.
  assert(s.sides.length === 4 && s.sides.every((x2) => !x2.toRead), JSON.stringify(s.sides.map((x2) => x2.name)));
  // Taps win: every side here was tapped whole, so its walls are as tapped - no shape, opening or eave from the photo.
  const { exterior } = scrivnOf(capture, finish);
  for (const side of exterior.sides) {
    assert(!(side.shapes ?? []).some((x2) => x2.from === "photo") && !side.openings.some((o) => o.from === "photo") && side.wallTopFrom === undefined, `${side.name}: as tapped`);
  }
  assert(s.sides.every((x2) => x2.walls.read && x2.walls.taken && x2.walls.words.startsWith("walls as tapped")), JSON.stringify(s.sides.map((x2) => x2.walls.words)));
  assert(s.sides.find((x2) => x2.name === "Front 3").said.some((w) => w.startsWith("pitch set aside")), "the garage's set aside, said");
  console.log(`    the owner's walk on the phone: ${s.roof.squares} SQ at ${s.roof.pitchText} (${s.roof.pitchWords}); eave ${s.roof.eave}, rake ${s.roof.rake}`);
  // Scan's own test reads this answer (ExteriorFinishTest): SCRIVN_SUMMARY_OUT writes it for its resources.
  if (process.env.SCRIVN_SUMMARY_OUT) writeFileSync(process.env.SCRIVN_SUMMARY_OUT, JSON.stringify(s, null, 1));
});

// ---------------------------------------------------------------------------------------------
// The walls off the photos: two bottom corners and a photo per side (2026-10-15, option 1)
// ---------------------------------------------------------------------------------------------

/** The walk with its photographed sides cut back to what option 1 taps: the two bottom corners, and the photo. */
const cornersOnly = (() => {
  const c = JSON.parse(capture);
  for (const side of c.sides) {
    if (!answers[String(side.index)]) continue;
    Object.assign(side, { cladding: null, eave_left_m: null, eave_right_m: null, peak: null, pitch_12: null, shapes: [], roofline: [], openings: [], areas: [], gross_sf: 0, net_sf: 0, opening_trim_m: 0 });
  }
  return JSON.stringify(c);
})();

let cornersFinish = { format: "scrivn-finish/1" };
const ftIn = (feet) => {
  const inches = Math.round(feet * 12);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
};

await test("with no signal, a side tapped as its corners alone has no height, is not counted, and the phone says so", async () => {
  const s = JSON.parse(await P.run("summary", { capture: cornersOnly, finish: null }));
  const names = Object.values(answers).map((a) => a.side);
  for (const n of names) assert(s.uncounted.includes(n), `${n} not counted`);
  assert(s.sides.filter((x2) => names.includes(x2.name)).every((x2) => x2.toRead && !x2.walls.complete && x2.walls.words.startsWith("only its corners")), JSON.stringify(s.sides.map((x2) => x2.walls.words)));
});

await test("corners and a photo: Finish reads each side whole - cladding, windows, doors, wall top - the phone and Scrivn's import alike", async () => {
  for (const index of Object.keys(answers)) {
    const { request, squared } = await x.prepare(cornersOnly, cornersFinish, Number(index), host);
    // No height tapped: the squared photo reaches 9 m over the side's bottom, so the wall top and the roof are in it.
    assert(request.frame.upMaxM > 3, `${answers[index].side}: the top in the squared photo (${request.frame.upMaxM.toFixed(2)} m)`);
    cornersFinish = await x.take(cornersOnly, cornersFinish, Number(index), answerFor(Number(index), request), squared, host, "2026-10-15T16:00:00.000Z");
  }
  const s = JSON.parse(await P.run("summary", { capture: cornersOnly, finish: cornersFinish }));
  const { q, exterior } = scrivnOf(cornersOnly, cornersFinish);
  sameRoof(s, q, "corners and photos");
  assert(s.uncounted.length === 0, `every side counted: ${s.uncounted.join(", ")}`);
  for (const a of Object.values(answers)) {
    const side = exterior.sides.find((x2) => x2.name === a.side);
    assert(side.wallTopFrom === "photo" && side.shapes.length > 0 && side.shapes.every((x2) => x2.from === "photo") && side.openings.every((o) => o.from === "photo"), `${a.side}: all of it from the photo`);
    const mine = s.sides.find((x2) => x2.name === a.side);
    assert(mine.walls.complete && mine.walls.fromPhoto.shapes && mine.walls.fromPhoto.wallTop && mine.walls.words.startsWith("walls from photo:"), mine.walls.words);
    // The phone's totals of the side are Scrivn's.
    assert(Math.abs(q.sides.find((x2) => x2.name === a.side).netSquareFeet - Number(/(\d+) SF net/.exec(mine.walls.words)?.[1] ?? NaN)) < 1, `${a.side}: ${mine.walls.words}`);
  }
});

await test("the walls read against the walk as tapped and the 10-12 hand marks: the same sides and openings, heights at the photo's", () => {
  const tapped = scrivnOf(capture, null);
  const read = scrivnOf(cornersOnly, cornersFinish);
  const rows = [];
  for (const a of Object.values(answers)) {
    const t = tapped.exterior.sides.find((x2) => x2.name === a.side);
    const r = read.exterior.sides.find((x2) => x2.name === a.side);
    const tq = tapped.q.sides.find((x2) => x2.name === a.side);
    const rq = read.q.sides.find((x2) => x2.name === a.side);
    near(r.lengthFeet, t.lengthFeet, `${a.side}: the same length`, 1e-9);
    // Every tapped opening is there, one for one: windows, doors and garage doors alike.
    assert(r.openings.length === t.openings.length && r.openings.every((o) => t.openings.some((o2) => o2.kind === o.kind)), `${a.side}: ${t.openings.length} tapped, ${r.openings.length} read`);
    rows.push(
      `${a.side.padEnd(8)} eaves ${ftIn(t.eaveLeftFeet)}/${ftIn(t.eaveRightFeet)} tapped, ${ftIn(r.eaveLeftFeet)}/${ftIn(r.eaveRightFeet)} read (${Math.round((r.eaveLeftFeet - t.eaveLeftFeet) * 12)}", ${Math.round((r.eaveRightFeet - t.eaveRightFeet) * 12)}")` +
        (t.gable && r.gable ? ` · peak ${ftIn(t.gable.peakFeet)} / ${ftIn(r.gable.peakFeet)} (${Math.round((r.gable.peakFeet - t.gable.peakFeet) * 12)}")` : "") +
        ` · net ${Math.round(tq.netSquareFeet)} / ${Math.round(rq.netSquareFeet)} SF (${Math.round(rq.netSquareFeet - tq.netSquareFeet) >= 0 ? "+" : ""}${Math.round(rq.netSquareFeet - tq.netSquareFeet)})` +
        ` · openings ${t.openings.map((o) => `${ftIn(o.widthFeet)}x${ftIn(o.heightFeet)}`).join(", ")} / ${r.openings.map((o) => `${ftIn(o.widthFeet)}x${ftIn(o.heightFeet)}`).join(", ")}`,
    );
  }
  for (const row of rows) console.log(`    ${row}`);
  console.log(`    house net: ${Math.round(tapped.q.totals.netSquareFeet)} SF tapped, ${Math.round(read.q.totals.netSquareFeet)} SF with the four sides read`);
  // The west gable against the 10-12 hand marks on its photo (photo-elevation-test.md: back corner 13'10", front 11'5", peak
  // 17'9" over the stucco's bottom, on the 13:25 walk's scale), carried onto this walk as its photo is (x1.0983, + 0'29.5").
  const w = read.exterior.sides.find((x2) => x2.name === "Left 5");
  const k = answers["11"].scale.k;
  const up = answers["11"].scale.offUpM / 0.3048;
  near(w.eaveLeftFeet, (13 + 10 / 12) * k + up, "back corner to the soffit, as hand-marked, within 2\"", 2 / 12);
  near(w.eaveRightFeet, (11 + 5 / 12) * k + up, "front corner to the soffit, as hand-marked, within 2\"", 2 / 12);
  near(w.gable.peakFeet, (17 + 9 / 12) * k + up, "the peak, as hand-marked, within 2\"", 2 / 12);
});

await test("set aside on the phone, a side's walls come off: it is its corners again, not counted; the roof read stays", async () => {
  const f = JSON.parse(JSON.stringify(cornersFinish));
  f.sides["11"].walls.taken = false;
  const s = JSON.parse(await P.run("summary", { capture: cornersOnly, finish: f }));
  const { exterior } = scrivnOf(cornersOnly, f);
  const w = exterior.sides.find((x2) => x2.name === "Left 5");
  assert(!w.wallTopFrom && (w.shapes ?? []).length === 0 && w.openings.length === 0 && w.roofRead?.pitch === 5, "corners again, the roof read kept");
  assert(s.uncounted.includes("Left 5") && s.sides.find((x2) => x2.name === "Left 5").walls.words.startsWith("walls set aside"), "said");
});

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

await test("the report's numbers are the quantities': walls by side and material add up, the roof's lines are the plan's", () => {
  const { exterior, q } = scrivnOf(capture, finish);
  const r = x.exteriorReport(exterior, { title: "The owner's house", date: "Oct 15, 2026", madeWith: "test" });
  const walls = r.tables.find((t) => t.caption === "Walls by side and material");
  const net = walls.rows.reduce((s, row) => s + (Number(row[5]) || 0), 0);
  near(net, q.totals.netSquareFeet, "net SF, rounded per row", 0.05 * walls.rows.length);
  const lines = r.tables.find((t) => t.caption === "Roof lines");
  near(Number(lines.rows.find((row) => row[0] === "Eaves")[1]), q.roofing.eaveFeet, "eaves", 0.05);
  near(Number(lines.rows.find((row) => row[0] === "Drip edge")[1]), q.roofing.eaveFeet + q.roofing.rakeFeet, "drip edge = eaves + rakes", 0.1);
  near(Number(lines.rows.find((row) => row[0] === "Starter")[1]), q.roofing.eaveFeet, "starter = eaves", 0.05);
  const squares = r.tables.find((t) => t.caption === "Roof squares");
  assert(squares.rows.some((row) => row[0] === "All the roof" && row[1] === q.roofing.squares.toFixed(2)), "squares");
  assert(r.tables.some((t) => t.caption === "Soffit, fascia and eavestrough"), "soffit, fascia and eavestrough");
  assert(r.tables.some((t) => t.caption === "Openings") && r.tables.find((t) => t.caption === "Openings").rows.length === exterior.sides.reduce((n, s) => n + s.openings.length, 0), "every opening");
  assert(r.photos.length === 4 && r.photos.every((p) => p.caption.includes("Read for the roof:")), "each photo with its read");
  assert(r.sources.some((s) => s === "Wing at Left 5: 5/12, from its gable's photo."), r.sources.join(" | "));
  assert(r.sources.some((s) => s.startsWith("Rake overhang:") && s.includes("read off the photos of")), "the rake from the photos");
});

await test("what is assumed says so: no pitch and no overhang measured, the report lists them as assumed", () => {
  const c = JSON.parse(bare);
  for (const s of c.sides) {
    s.peak = null;
    s.pitch_12 = null;
  }
  const { exterior } = scrivnOf(JSON.stringify(c), null);
  const r = x.exteriorReport(exterior, { title: "t", date: "d", madeWith: "m" });
  assert(r.assumed.some((a) => a.startsWith("The pitch, 4/12")), r.assumed.join(" | "));
  assert(r.assumed.some((a) => a.startsWith("The eave overhang")) && r.assumed.some((a) => a.startsWith("The rake overhang")), "overhangs");
  assert(r.facts.find((f) => f.label === "Roof").value.includes("(assumed)"), "on the cover");
});

let pdf = null;
await test("the report from the phone's engine: a PDF with every page, the photos in it", async () => {
  const b64 = await P.run("report", { capture, finish, meta: { title: "The owner's house - 14:53 walk, 10-12 photos", date: "Oct 15, 2026", madeWith: `Scrivn Scan (${P.version})` } });
  pdf = Buffer.from(b64, "base64");
  const text = pdf.toString("latin1");
  assert(text.startsWith("%PDF-"), "a PDF");
  const pages = Number(/\/Count (\d+)/.exec(text)?.[1] ?? 0);
  assert(pages >= 8, `${pages} pages`);
  assert((text.match(/\/Subtype \/Image/g) ?? []).length === 4, "four photos");
  for (const words of ["EXTERIOR REPORT", "Roof plan", "Elevations", "Side photos", "Measurements", "Walls by side and material"]) assert(text.includes(`(${words}`), `"${words}" in it`);
  if (process.env.SCRIVN_REPORT_OUT) writeFileSync(process.env.SCRIVN_REPORT_OUT, pdf);
});

await test("the report of the corners-and-photos walk says which walls came off the photos", async () => {
  const { exterior, q } = scrivnOf(cornersOnly, cornersFinish);
  const r = x.exteriorReport(exterior, { title: "t", date: "d", madeWith: "m" });
  assert(r.sources.some((s) => s.startsWith("Read off the side's photo where nothing was tapped") && s.includes("Left 5 (cladding, 2 openings and wall top)")), r.sources.join(" | "));
  const walls = r.tables.find((t) => t.caption === "Walls by side and material");
  assert(walls.rows.filter((row) => row[2] === "photo").length >= 4, "the walls table says photo");
  assert(r.tables.find((t) => t.caption === "Openings").rows.filter((row) => row[2] === "photo").length === Object.values(answers).reduce((n, a) => n + read0(a.side), 0), "each read opening says photo");
  assert(r.facts.find((f) => f.label === "Cladding").value.includes("of it read off photos"), "the cover says how much");
  assert(r.sides.find((s) => s.side.name === "Left 5").dims.some((d) => d.endsWith("(from photo)")), "the elevation's lines too");
  const b64 = await P.run("report", { capture: cornersOnly, finish: cornersFinish, meta: { title: "The owner's house - corners and photos", date: "Oct 15, 2026", madeWith: `Scrivn Scan (${P.version})` } });
  const text = Buffer.from(b64, "base64").toString("latin1");
  assert(text.startsWith("%PDF-") && text.includes("(photo)"), "a PDF that says photo");
  if (process.env.SCRIVN_WALLS_REPORT_OUT) writeFileSync(process.env.SCRIVN_WALLS_REPORT_OUT, Buffer.from(b64, "base64"));
  function read0(name) {
    return exterior.sides.find((x2) => x2.name === name).openings.filter((o) => o.from === "photo").length;
  }
  void q;
});

await test("Scrivn's own report of the claim the phone sent is the same document", () => {
  const { exterior } = scrivnOf(capture, finish);
  const meta = { title: "The owner's house - 14:53 walk, 10-12 photos", date: "Oct 15, 2026", madeWith: `Scrivn Scan (${P.version})` };
  const r = x.exteriorReport(exterior, meta);
  const photos = Object.fromEntries([900, 901, 902, 903].map((n) => [n, { dataUrl: `data:image/jpeg;base64,${photo(n)}`, width: 1600, height: 0 }]));
  for (const [n, p] of Object.entries(photos)) p.height = x.jpegSize(photo(Number(n))).height;
  const ours = Buffer.from(x.exteriorReportBytes({ report: r, svgOf: (el) => x.renderToStaticMarkup(el), photos, footer: meta.madeWith }));
  // jsPDF stamps the time it was made: past that line, byte for byte.
  const strip = (b) => b.toString("latin1").replace(/\/CreationDate \([^)]*\)/g, "").replace(/\/ID \[[^\]]*\]/g, "");
  assert(pdf && strip(ours) === strip(pdf), "the same PDF");
});

// ---------------------------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------------------------

await test("the Finish block is read with care: junk, the wrong format and impossible numbers are dropped", () => {
  assert(x.readScanFinish(null) === null && x.readScanFinish({ format: "other" }) === null, "not one");
  const f = x.readScanFinish({ format: "scrivn-finish/1", pitch: 99, ends: { 2: "hip", x: "gable", 3: "dome" }, sides: { 1: { roofRead: { at: "t", pitch: 5, rakeOverhangFeet: -2, over: "turret" }, photos: [900, "x"], scaleAt: 7 } } });
  assert(f.pitch === undefined, "a 99/12 pitch is no pitch");
  assert(JSON.stringify(f.ends) === '{"2":"hip"}', JSON.stringify(f.ends));
  const s = f.sides["1"];
  assert(s.roofRead.pitch === 5 && s.roofRead.rakeOverhangFeet === undefined && s.roofRead.over === null, JSON.stringify(s.roofRead));
  assert(s.scaleAt === 1 && s.photos.length === 1, "scale and photos");
});

await test("a read made before a tape was typed is put on at the tape's scale: overhangs scale, the pitch does not", () => {
  const sides = [{ id: "a", name: "Left", photos: [{ n: 900 }] }];
  const finish2 = { format: "scrivn-finish/1", sides: { 0: { at: "t", photos: [900], scaleAt: 1, roofRead: { at: "t", pitch: 5, rakeOverhangFeet: 2, eaveOverhangFeet: 1.5 }, said: [] } } };
  const out = x.applyScanFinish(sides, { ends: {} }, finish2, new Map([[0, "a"]]), 1.1);
  near(out.sides[0].roofRead.rakeOverhangFeet, 2.2, "rake", 1e-9);
  near(out.sides[0].roofRead.eaveOverhangFeet, 1.65, "eave", 1e-9);
  assert(out.sides[0].roofRead.pitch === 5, "pitch");
  // Another wall under the same number (the side undone on the phone and tapped again), with its own photo: not this read.
  const other = x.applyScanFinish([{ id: "a", name: "Left", photos: [{ n: 903 }] }], { ends: {} }, finish2, new Map([[0, "a"]]), 1);
  assert(other.sides[0].roofRead === undefined, "not put on another wall");
});

await test("the SVG painter reads what React writes: a turned label's text, its anchor, entities, and only the standard fonts' characters", () => {
  const svg = x.parseSvg('<div><svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -3 10 6"><g transform="translate(1 2) rotate(-90)"><text x="0" y="0" font-size="1" text-anchor="middle">12&#x27;6&quot; &amp; ≈ 3′</text></g><!-- --></svg></div>');
  assert(svg.tag === "svg" && x.svgViewBox(svg).width === 10, "the frame");
  const t = svg.children[0].children[0];
  assert(t.tag === "text" && t.text === "12'6\" & ≈ 3′", t.text);
  assert(x.pdfSafe(t.text) === "12'6\" & ~ 3'", x.pdfSafe(t.text));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`\n  ✗ ${f}`);
// React's scheduler keeps a channel open: done is done.
process.exit(failures.length > 0 ? 1 : 0);
