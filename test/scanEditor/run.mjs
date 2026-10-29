/**
 * Scrivn's sketch editor inside Scrivn Scan (2026-10-28): lib/scanEditor.ts, lib/scanEditorPdf.ts and the bundle
 * scripts/build-scan-editor.mjs makes of them.
 *
 *   npm run test:scan-editor
 *
 * NO PAID CALL, no server. What is checked:
 *   * the bundle builds with nothing it must not have: no exterior, no 3D, no "/api/", only the allowed packages, every
 *     stand-in used, under the size budget, and its page carries the CSP with no network (connect-src 'none')
 *   * a scan made into a sketch as a Send of it would land: the owner's taped Medicine Hat basement layout, every room's
 *     walls to the inch and its floor to the square foot of the file's own outline
 *   * a capture of two levels lands on two storeys, named as the phone named them, with the closets of both offered
 *   * a sketch read from the phone: anything that is not one is said, never thrown
 *   * the scales are Scan's PlanPdf.kt's, case for case (its PlanPdfTest's)
 *   * the import reads as the phone's own until edited, and edited after
 *   * the plan's files: a PDF of a page per storey and the rooms, and a JPG per storey, with a stand-in for the pictures
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

let failures = 0;
let passes = 0;
function ok(cond, what) {
  if (cond) passes++;
  else {
    failures++;
    console.log(`FAIL ${what}`);
  }
}
function near(a, b, tol, what) {
  ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
}

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "scan-editor-tests-"));
  await build({
    entryPoints: [join(root, "lib", "scanEditor.ts"), join(root, "lib", "scanEditorPdf.ts"), join(root, "lib", "sketch.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    alias: { "@": root },
    external: ["html2canvas", "dompurify", "canvg"],
    logLevel: "silent",
  });
  const editor = await import(pathToFileURL(join(outDir, "scanEditor.mjs")).href);
  const pdf = await import(pathToFileURL(join(outDir, "scanEditorPdf.mjs")).href);
  const sketch = await import(pathToFileURL(join(outDir, "sketch.mjs")).href);
  rmSync(outDir, { recursive: true, force: true });
  return { editor, pdf, sketch };
}

const { editor, pdf, sketch: S } = await load();
const target = readFileSync(join(root, "..", "Medicine Hat basement - target layout.json"), "utf8");

// ---- The bundle --------------------------------------------------------------------------------------------------
{
  const { buildEditor, CSP, MAX_JS_BYTES } = await import(pathToFileURL(join(root, "scripts", "build-scan-editor.mjs")).href);
  const built = await buildEditor();
  ok(built.problems.length === 0, `the bundle builds clean: ${built.problems.join("; ")}`);
  ok(Buffer.byteLength(built.js) <= MAX_JS_BYTES, `editor.js within the budget (${(built.js.length / 1024).toFixed(0)} KB)`);
  ok(/^\/\* scrivn-editor scrivn [0-9a-f]+\+? \d{4}-\d\d-\d\d/.test(built.js), "editor.js names the Scrivn commit it was built from");
  ok(built.html.includes(CSP) && CSP.includes("connect-src 'none'"), "the page's CSP allows no network");
  ok(built.html.includes('<script src="editor.js"></script>') && !built.html.includes("dev-bridge"), "the page loads editor.js and no pretend phone");
  ok(!built.js.includes("/api/"), "nothing in the bundle talks to scrivn.ca");
  ok(!built.ours.some((f) => /ExteriorEditor\.tsx|Sketch3D|PhotoRoute|exteriorDrawings/.test(f)), "no exterior or 3D code in it");
  ok(built.packages.every((p) => !/^three/.test(p)), "no three.js");
  ok(built.css.includes(".sketch-card") && built.css.includes("overscroll-behavior: none"), "editor.css is globals.css and the app's own rules");
}

// ---- A scan made into a sketch, to the inch ----------------------------------------------------------------------
{
  const made = editor.importCapture(target, { captureId: "mh-target", capturedAt: null, now: "2026-10-28T12:00:00Z" });
  ok(made.ok, `the taped layout imports${made.ok ? "" : `: ${made.error}`}`);
  const file = JSON.parse(target);
  const sk = made.imported.sketch;
  const edges = (pts) => pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
  const area = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  for (const room of file.rooms) {
    const got = sk.rooms.find((r) => r.name === room.name && !r.stairs);
    ok(got, `${room.name} is in the sketch`);
    if (!got) continue;
    // Twelve pixels a foot: a pixel is an inch.
    const want = edges(room.outline).map((m) => m / 0.0254).sort((a, b) => a - b);
    const have = edges(got.vertices.map((v) => [v.x, v.y])).sort((a, b) => a - b);
    ok(want.length === have.length, `${room.name}: ${have.length} walls, the file's ${want.length}`);
    want.forEach((w, k) => near(have[k] ?? 0, w, 1, `${room.name} wall ${k + 1} (in)`));
    near(area(got.vertices.map((v) => [v.x, v.y])) / 144, area(room.outline) * 10.7639, 1, `${room.name} floor (sq ft)`);
  }
  ok(sk.exterior === undefined, "no exterior on the sketch");
  const summary = editor.sketchSummary(sk);
  ok(summary.edited === false, "the import reads as the phone's own (not edited)");
  ok(summary.rooms === file.rooms.length, `the summary counts ${summary.rooms} rooms, the file's ${file.rooms.length}, stairs aside`);
  // Moved a corner: edited, and the phone holds the sketch as the truth from then on.
  const moved = { ...sk, rooms: sk.rooms.map((r, i) => (i === 0 ? { ...r, vertices: r.vertices.map((v, j) => (j === 0 ? { ...v, x: v.x - 6 } : v)) } : r)) };
  ok(editor.sketchSummary(moved).edited === true, "a moved corner is an edit");
  ok(editor.sketchSummary(S.emptySketch()).edited === false && editor.sketchSummary(S.emptySketch()).rooms === 0, "an empty sketch by hand is not edited yet");

  // ---- Two levels: two storeys, named, the closets of both offered ----
  const two = JSON.parse(target);
  const upstairs = ["Bedroom 1", "Closet", "Bedroom 2", "Closet 2"];
  two.rooms = two.rooms.map((r) => (upstairs.includes(r.name) ? { ...r, level: 1 } : r));
  two.levels = [{ level: 1, name: "Upstairs" }];
  const both = editor.importCapture(JSON.stringify(two), { captureId: "mh-two", capturedAt: null, now: "2026-10-28T12:00:00Z" });
  ok(both.ok, `a two-level capture imports${both.ok ? "" : `: ${both.error}`}`);
  if (both.ok) {
    const levels = [...new Set(both.imported.sketch.rooms.map(S.roomLevel))].sort();
    ok(levels.join(",") === "0,1", `on storeys ${levels.join(",")}`);
    ok(both.imported.sketch.rooms.filter((r) => S.roomLevel(r) === 1).map((r) => r.name).sort().join(",") === [...upstairs].sort().join(","), "the upstairs rooms on the storey above");
    ok(S.levelName(both.imported.sketch, 1) === "Upstairs", `the storey named as the phone named it (${S.levelName(both.imported.sketch, 1)})`);
    ok(editor.sketchSummary(both.imported.sketch).edited === false, "a two-level import reads as the phone's own too");
    ok(editor.storeys(both.imported.sketch).map((s) => s.level).join(",") === "1,0", "the plan's storeys top down");
  }
  const bad = editor.importCapture("{not json", { captureId: null, now: "2026-10-28T12:00:00Z" });
  ok(!bad.ok, "a scan that is not JSON is said, not thrown");

  // ---- The plan's files, the pictures stood in for ----
  const png1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const calls = [];
  const host = {
    async plan(level, unitsPerFoot, pad, ratio) {
      calls.push({ kind: "plan", level, unitsPerFoot, pad, ratio });
      const e = pdf.storeyExtentFt(sk, level);
      return { dataUrl: png1, width: Math.ceil(e.widthFt * unitsPerFoot + 2 * pad) * ratio, height: Math.ceil(e.heightFt * unitsPerFoot + 2 * pad) * ratio };
    },
    async jpeg(level, pxPerFoot, heading) {
      calls.push({ kind: "jpeg", level, pxPerFoot, heading });
      return { dataUrl: "data:image/jpeg;base64,/9j/2wBDAP////8=", width: 10, height: 10 };
    },
  };
  const files = await pdf.buildPlanFiles(sk, { title: "Medicine Hat basement", subtitle: "Scrivn Scan test", jpg: true }, host);
  ok(files.files.map((f) => f.name).join(",") === "plan.pdf,level-0.jpg", `the files: ${files.files.map((f) => f.name).join(",")}`);
  const doc = Buffer.from(files.files[0].base64, "base64").toString("latin1");
  ok(doc.startsWith("%PDF-"), "plan.pdf is a PDF");
  ok((doc.match(/\/Type \/Page\b(?!s)/g) ?? []).length === 2, `two pages: the plan and the rooms (${(doc.match(/\/Type \/Page\b(?!s)/g) ?? []).length})`);
  ok(doc.includes(`Scale 1/8" = 1'-0" when printed at 100%`), "the plan at 1/8\" a foot, said on the page");
  ok(calls[0]?.unitsPerFoot === 9 && calls[0]?.ratio === pdf.PICTURE_RATIO && calls[0]?.pad === pdf.PLAN_PAD_PT, "the plan's picture asked for at 9 pt a foot");
  ok(calls[1]?.kind === "jpeg" && calls[1]?.pxPerFoot === 48, `the JPG at 48 px a foot (${calls[1]?.pxPerFoot})`);
  ok(doc.includes("(Rec Room)") && doc.includes("(Bedroom 1)"), "the rooms table lists the rooms");
  ok(!/[–—]/.test(doc), "no character the PDF's font cannot draw");
  let threw = false;
  try {
    await pdf.buildPlanFiles(S.emptySketch(), { title: "x", subtitle: "", jpg: false }, host);
  } catch {
    threw = true;
  }
  ok(threw, "a plan with no room says so");
}

// ---- A sketch from the phone ---------------------------------------------------------------------------------------
{
  for (const bad of ["", "nope", "[]", "{}", '{"rooms":{}}', '{"rooms":[{"id":"a"}]}', null, 3]) {
    const r = editor.readSketch(bad);
    ok(!r.ok && typeof r.error === "string", `refused: ${JSON.stringify(bad)}`);
  }
  ok(editor.readSketch('{"rooms":[{"id":"a","vertices":[]}]}').ok, "a sketch with a room reads");
  ok(editor.readSketch({ rooms: [] }).ok, "an empty sketch reads");
}

// ---- The scales are PlanPdf.kt's (its PlanPdfTest, in feet) ------------------------------------------------------------
{
  const ft = (m) => m / 0.3048;
  const a = editor.architecturalScale(ft(3), ft(4), 532, 628, 30);
  ok(a.ptPerFt === 36 && a.label === '1/2" = 1\'-0"', `a room at 1/2" (${a.label})`);
  ok(editor.architecturalScale(ft(18.3), ft(12.2), 532, 628, 30).label === '1/16" = 1\'-0"', "a house at 1/16\"");
  ok(editor.jpegPxPerFt(ft(5), ft(6)) === 48, "the JPG: 48 px a foot for a room");
  ok(editor.jpegPxPerFt(ft(25), ft(20)) === 36, "the JPG: fewer for a house");
  ok(editor.architecturalScale(1000, 1000, 532, 628, 30).label === '1/32" = 1\'-0"', "never past the smallest");
  ok(editor.feetInches(12.5) === "12' 6\"" && editor.feetInches(8) === "8'", "lengths written as the plan writes them");
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
