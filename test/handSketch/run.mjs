/**
 * Hand-drawn sketch photos to Scrivn rooms: the build from a read, against the owner's tape.
 *
 *   npm run test:hand-sketch            checks, then the score against the tape
 *   npm run test:hand-sketch -- --out d  also writes each built sketch to d/<name>.sketch.json
 *
 * The reads in fixtures/ were written by hand from the owner's photos of his own drawings of two
 * rooms he has taped (no model call): what a reading pass should return. The tape is his Scrivn
 * sketch of the same rooms. So this measures the build alone — given a correct read, how close to
 * the tape do the rooms come — and keeps it from getting worse.
 */
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { score } from "./score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "hand-sketch-tests-"));
const bundlePath = join(outDir, "bundle.mjs");
await build({ entryPoints: [join(here, "entry.ts")], bundle: true, format: "esm", platform: "node", outfile: bundlePath, alias: { "@": root }, logLevel: "error" });
const { parseLength, parseSize, feetInches, buildFromRead, readProblem } = await import(pathToFileURL(bundlePath).href);

let passed = 0;
let failed = 0;
const check = (ok, message) => {
  if (ok) passed++;
  else {
    failed++;
    console.log(`  FAIL ${message}`);
  }
};
const near = (a, b, within) => Math.abs(a - b) <= within;
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const outArg = process.argv.indexOf("--out");
const writeTo = outArg >= 0 ? process.argv[outArg + 1] : null;

/* ── Lengths as people write them ───────────────────────────────────────────────────────────── */

for (const [text, inches] of [
  ["14'3", 171], ["14'3\"", 171], ["14' 3\"", 171], ["14'-3\"", 171], ["4'11", 59], ["16'", 192], ["8'5-C", 101],
  ["144 1/2\"", 144.5], ["374\"", 374], ["5'9 1/2\"", 69.5], ["14’3”", 171], ["2.4m", 2.4 / 0.0254],
]) check(near(parseLength(text), inches, 0.01), `"${text}" reads as ${inches}" (got ${parseLength(text)})`);
for (const text of ["12", "", null, "vanity"]) check(parseLength(text) === null, `"${text}" is not taken as a length`);
const [ww, wh] = parseSize("5'9 w x 2'9 window");
check(ww === 69 && wh === 33, `"5'9 w x 2'9 window" is 5'9" by 2'9" (got ${ww}, ${wh})`);
check(feetInches(59) === "4'11\"" && feetInches(96) === "8'", "feet and inches read back");

/* ── The spare room: every wall written, the angled one a little off ────────────────────────── */

const spareRead = fixture("spare.read.json");
check(readProblem(spareRead) === null, `the spare room read is well formed (${readProblem(spareRead)})`);
const spare = buildFromRead(spareRead);
const wall = (b, room, i) => b.walls.find((w) => w.room === room && w.wall === i);
for (const [i, inches] of [[0, 171], [1, 52], [3, 59], [4, 199], [5, 141]]) {
  const w = wall(spare, 0, i);
  check(w.source === "written" && near(w.inches, inches, 0.05), `a written square wall stands exactly: ${feetInches(inches)} (got ${w.inches.toFixed(2)}", ${w.source})`);
}
const diagonal = wall(spare, 0, 2);
// 16'7" less 14'3" across and 11'9" less 4'4" and 4'11" down: 28" by 30", 41" on the angle.
check(diagonal.source === "written-differs" && near(diagonal.inches, Math.hypot(28, 30), 0.3), `the angled wall closes the room at 3'5", not the written 3'4" (got ${diagonal.inches.toFixed(2)}", ${diagonal.source})`);
check(spare.questions.some((q) => q.kind === "wallDiffers" && q.room === 0 && q.wall === 2), "and the difference is asked about");
const closetTop = wall(spare, 1, 0);
const closetLeft = wall(spare, 1, 3);
check(closetTop.source === "closed" && near(closetTop.inches, 28, 0.3), `the closet's unwritten top is what the room leaves: 2'4" (got ${closetTop.inches.toFixed(2)}", ${closetTop.source})`);
check(closetLeft.source === "closed" && near(closetLeft.inches, 82, 0.3), `and its unwritten side, 4'4" plus 2'6" (got ${closetLeft.inches.toFixed(2)}", ${closetLeft.source})`);
check(spare.rooms.length === 2 && spare.rooms[1].name === "Closet", "the closet comes out as a room of its own");
check(near(spare.rooms[0].ceilingHeightFeet, 101 / 12, 1e-6), "the written ceiling height is used");
check(spare.questions.some((q) => q.kind === "isOpening"), "the heavily drawn angled wall is asked about, not taken as a door");
check(!spare.questions.some((q) => q.kind === "tapeWall"), "no wall is left to the drawing's proportions");

/* ── The bathroom: two numbers, a vanity with none ──────────────────────────────────────────── */

const bathRead = fixture("bathroom.read.json");
check(readProblem(bathRead) === null, `the bathroom read is well formed (${readProblem(bathRead)})`);
const bath = buildFromRead(bathRead);
const top = wall(bath, 0, 0);
const left = wall(bath, 0, 3);
check(top.source === "closed" && near(top.inches, 99, 0.1), `the unwritten top is the bottom's 8'3" (got ${top.inches.toFixed(2)}", ${top.source})`);
check(left.source === "closed" && near(left.inches, 59, 0.1), `the unwritten side is the other side's 4'11" (got ${left.inches.toFixed(2)}", ${left.source})`);
check(bath.questions.some((q) => q.kind === "doorWall"), "the door drawn at a corner asks which wall it is on");
const tub = bath.rooms[0].symbols.find((s) => s.type === "fixture" && s.fixtureType === "tub");
check(tub && near(tub.widthFeet * 12, 59, 0.1) && near(tub.depthFeet * 12, 30, 0.01), `the tub drawn wall to wall is the wall's length, at a standard depth (got ${tub && (tub.widthFeet * 12).toFixed(1)} x ${tub && (tub.depthFeet * 12).toFixed(1)})`);
check(bath.placed.some((p) => p.what === "Vanity" && p.source === "drawing"), "the vanity's size is marked as from the drawing");

/* ── Against the tape ───────────────────────────────────────────────────────────────────────── */

const tape = fixture("tape.json");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("\nAgainst the owner's tape (the build from a correct read):");
score("Spare room", spare.rooms[0], tape.spare, feetInches);
score("Bathroom", bath.rooms[0], tape.bathroom, feetInches);
for (const [label, b] of [["Spare room", spare], ["Bathroom", bath]]) {
  console.log(`\n  ${label}: ${b.questions.length} questions: ${b.questions.map((q) => q.kind).join(", ")}`);
  console.log(`  placed: ${b.placed.map((p) => `${p.what} ${p.size} (${p.source})`).join("; ")}`);
}

if (writeTo) {
  mkdirSync(writeTo, { recursive: true });
  writeFileSync(join(writeTo, "spare.sketch.json"), JSON.stringify({ rooms: spare.rooms }, null, 1));
  writeFileSync(join(writeTo, "bathroom.sketch.json"), JSON.stringify({ rooms: bath.rooms }, null, 1));
  console.log(`\nWrote the built sketches to ${writeTo}`);
}
if (failed) process.exit(1);
