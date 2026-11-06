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
const mod = await import(pathToFileURL(bundlePath).href);
const { parseLength, parseSize, feetInches, buildFromRead, readProblem } = mod;

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

/* ── A model's reading builds what the hand-written one does ────────────────────────────────── */

const sortedWalls = (b) => b.walls.map((w) => Math.round(w.inches * 4) / 4).sort((p, q) => p - q);
for (const [name, hand] of [["spare", spare], ["bathroom", bath]]) {
  const model = fixture(`${name}.model.json`).read;
  check(readProblem(model) === null, `the model's ${name} read is well formed`);
  const built = buildFromRead(model);
  const a = sortedWalls(built);
  const b = sortedWalls(hand);
  check(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 0.5), `the model's ${name} read builds the same walls as the hand-written read (${a.join(", ")} vs ${b.join(", ")})`);
}

/* ── Tracing by hand ───────────────────────────────────────────────────────────────────────── */

const { emptyTrace, tapCorner, undoTap, moveCorner, setLength, setName, sharedWith, lengthText, traceProblem, traceToRead, readToTrace, answerQuestion, openQuestions } = mod;
let t = emptyTrace(1400, 1050);
check(traceProblem(t) === "noRoom", "an empty trace has nothing to build");
// The bathroom traced: its four corners as the hand-written read has them, then back to the first.
for (const p of bathRead.rooms[0].corners) t = tapCorner(t, p, 20).state;
check(t.rooms[0].closed === false && t.rooms[0].corners.length === 4, "four taps make four corners");
t = tapCorner(t, { x: bathRead.rooms[0].corners[0].x + 8, y: bathRead.rooms[0].corners[0].y - 6 }, 20).state;
check(t.rooms[0].closed && t.rooms[0].corners.length === 4, "a tap near the first corner closes the room");
check(traceProblem(t) === "noLength", "a closed room with no length typed is not built");
t = setLength(t, 0, 1, "4'11");
t = setLength(t, 0, 2, lengthText(99));
check(traceProblem(t) === null, "with a length typed it is");
const traced = buildFromRead(traceToRead(t));
const tracedWalls = sortedWalls(traced);
check(JSON.stringify(tracedWalls) === JSON.stringify(sortedWalls(bath)), `the traced bathroom builds as the hand-written read does (${tracedWalls.join(", ")})`);

// Two rooms sharing a corner: a tap near one placed lands on it exactly; moving it moves both.
let two = emptyTrace(1000, 1000);
for (const p of [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 }, { x: 100, y: 400 }, { x: 100, y: 100 }]) two = tapCorner(two, p, 20).state;
for (const p of [{ x: 507, y: 104 }, { x: 800, y: 100 }, { x: 800, y: 400 }, { x: 496, y: 396 }, { x: 503, y: 103 }]) two = tapCorner(two, p, 20).state;
check(two.rooms.length === 2 && two.rooms[1].closed, "a second room closes on its own first corner");
check(two.rooms[1].corners[0].x === 500 && two.rooms[1].corners[0].y === 100 && two.rooms[1].corners[3].x === 500 && two.rooms[1].corners[3].y === 400, "its corners near the first room's land on them exactly");
const shared = sharedWith(two, 1, 3);
check(shared && shared.room === 0 && shared.wall === 1, `the wall both rooms have is found in the first room (got ${JSON.stringify(shared)})`);
const moved = moveCorner(two, { x: 500, y: 100 }, { x: 520, y: 90 }, 20);
check(moved.rooms[0].corners[1].x === 520 && moved.rooms[1].corners[0].x === 520 && moved.rooms[0].corners[1].y === 90, "moving a shared corner moves it in both rooms");

// What a tap may not do.
let bow = emptyTrace(1000, 1000);
for (const p of [{ x: 0, y: 0 }, { x: 400, y: 400 }, { x: 400, y: 0 }]) bow = tapCorner(bow, p, 20).state;
check(tapCorner(bow, { x: 0, y: 400 }, 20).problem === "crosses", "a wall crossing an earlier one is refused");
let short = emptyTrace(1000, 1000);
for (const p of [{ x: 0, y: 0 }, { x: 400, y: 0 }]) short = tapCorner(short, p, 20).state;
check(tapCorner(short, { x: 2, y: 2 }, 20).problem === "tooFew", "two corners cannot close a room");
const undone = undoTap(t);
check(undone.rooms[0].closed === false && undone.rooms[0].corners.length === 4, "undo reopens the room last closed");
check(undoTap(undone).rooms[0].corners.length === 3, "and then takes back its last corner");

for (const [inches, text] of [[41, "3'5\""], [171.5, "14'3 1/2\""], [5.375, "0'5 3/8\""], [96, "8'"]]) {
  check(lengthText(inches) === text && Math.abs(parseLength(text) - inches) < 1e-9, `${inches}" is written ${text} and read back (got ${lengthText(inches)})`);
}

// A model's reading corrected in the tracer keeps its doors and fixtures, and its corners are fixed in number.
const fromModel = readToTrace(fixture("bathroom.model.json").read, { width: 1050, height: 1400 });
check(fromModel.locked && tapCorner(fromModel, { x: 10, y: 10 }, 20).state === fromModel, "a model's reading takes no new corners");
check(traceToRead(fromModel).rooms[0].items.length === 3, "and keeps its fixtures through the tracer");

/* ── The build's questions, answered ───────────────────────────────────────────────────────── */

let read = bathRead;
let dismissed = [];
const ask = () => buildFromRead(read).questions;
const byKind = (k) => openQuestions(ask(), dismissed).find((q) => q.kind === k);
({ read, dismissed } = answerQuestion(read, byKind("roomName"), { kind: "roomName", name: "Main bath" }, dismissed));
check(!byKind("roomName") && buildFromRead(read).rooms[0].name === "Main bath", "naming the room answers it");
const doorQ = byKind("doorWall");
({ read, dismissed } = answerQuestion(read, doorQ, { kind: "doorWall", wall: doorQ.walls[1] }, dismissed));
const door = read.rooms[0].openings[0];
check(!byKind("doorWall") && door.wall === doorQ.walls[1] && door.orWall === null && door.at === 1, `choosing the other wall moves the door to that corner's end of it (wall ${door.wall}, at ${door.at})`);
let spareRead2 = spareRead;
let spareDismissed = [];
const spareQ = (k) => openQuestions(buildFromRead(spareRead2).questions, spareDismissed).find((q) => q.kind === k);
({ read: spareRead2, dismissed: spareDismissed } = answerQuestion(spareRead2, spareQ("isOpening"), { kind: "isOpening", yes: false }, spareDismissed));
check(!spareQ("isOpening") && spareRead2.rooms[0].openings.length === 2, "saying the heavy wall is no door takes the door away");
const differs = spareQ("wallDiffers");
({ read: spareRead2, dismissed: spareDismissed } = answerQuestion(spareRead2, differs, { kind: "wallDiffers", length: lengthText(differs.closes) }, spareDismissed));
check(!spareQ("wallDiffers"), "taking the length the room closes at answers the angled wall");
// One wall typed in a rectangle leaves the other way to the drawing: asked, and left alone when asked to.
let rough = { ...bathRead, rooms: [{ ...bathRead.rooms[0], walls: [{ length: null }, { length: null }, { length: "8'3" }, { length: null }] }] };
let roughDismissed = [];
const tape1 = openQuestions(buildFromRead(rough).questions, roughDismissed).filter((q) => q.kind === "tapeWall");
check(tape1.length === 2, `with one wall typed, the two the drawing sets are asked to be taped (got ${tape1.length})`);
({ read: rough, dismissed: roughDismissed } = answerQuestion(rough, tape1[0], { kind: "tapeWall", length: null }, roughDismissed));
check(openQuestions(buildFromRead(rough).questions, roughDismissed).filter((q) => q.kind === "tapeWall").length === 1, "leaving one as drawn stops it being asked");
({ read: rough, dismissed: roughDismissed } = answerQuestion(rough, tape1[1], { kind: "tapeWall", length: "4'11" }, roughDismissed));
check(openQuestions(buildFromRead(rough).questions, roughDismissed).filter((q) => q.kind === "tapeWall").length === 0, "and typing the other settles both");

/* ── Rooms found in a photo without AI (lib/handSketchBoxes.ts), and joining what is not a room ─ */

{
  const { findBoxes, foundToTrace, joinRoom } = mod;
  // A drawing on graph paper: blue grid every 40 px, a hand's shadow over the left third, a big room with a closet in
  // its top right corner, and a tub's edge drawn across the bottom of the closet-less side. Pen lines 3 px, slightly
  // off square, one wall bowed.
  const W = 900;
  const H = 700;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const shade = x < 300 ? 0.62 : 1;
      let [R, G, B] = [235 * shade, 228 * shade, 215 * shade];
      if (x % 40 === 0 || y % 40 === 0) [R, G, B] = [R * 0.55, G * 0.62, B * 0.8];
      data[i] = R;
      data[i + 1] = G;
      data[i + 2] = B;
      data[i + 3] = 255;
    }
  const pen = (a, b, bow = 0) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (let s = 0; s <= len; s += 0.5) {
      const t = s / len;
      const off = bow * Math.sin(Math.PI * t);
      const cx = a.x + (b.x - a.x) * t + nx * off;
      const cy = a.y + (b.y - a.y) * t + ny * off;
      for (let oy = -1.5; oy <= 1.5; oy += 0.5)
        for (let ox = -1.5; ox <= 1.5; ox += 0.5) {
          const x = Math.round(cx + ox);
          const y = Math.round(cy + oy);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = (y * W + x) * 4;
          const k = x < 300 ? 0.62 : 1;
          data[i] = 25 * k;
          data[i + 1] = 22 * k;
          data[i + 2] = 20 * k;
        }
    }
  };
  const A = { x: 120, y: 110 }; // big room, top left
  const B = { x: 780, y: 104 };
  const C = { x: 786, y: 600 };
  const D = { x: 126, y: 606 };
  pen(A, B);
  pen(B, C);
  pen(C, D);
  pen(D, A, 9); // the bowed wall
  pen({ x: 560, y: 106 }, { x: 562, y: 300 }); // the closet's side
  pen({ x: 562, y: 300 }, { x: 783, y: 298 }); // the closet's front
  pen({ x: 124, y: 480 }, { x: 785, y: 476 }); // a tub's edge, wall to wall
  const found = findBoxes({ width: W, height: H, data });
  check(found.rooms.length === 3, `a drawing of a room, a closet and a tub's edge gives three shapes (got ${found.rooms.length})`);
  const near = (p, q, d) => Math.hypot(p.x - q.x, p.y - q.y) <= d;
  const hasCorner = (pt) => found.rooms.some((r) => r.corners.some((c) => near(c, pt, 12)));
  check([A, B, C, D].every(hasCorner), "the room's four corners are found within 12 px, the bowed wall taken straight");
  const counts = found.rooms.map((r) => r.corners.length).sort().join(",");
  check(counts === "4,4,6", `the closet and the tub four corners each, the room round them six (got ${counts})`);

  let ft = foundToTrace(found.rooms, { width: W, height: H });
  check(ft.found && !ft.locked && ft.rooms.every((r) => r.closed && r.lengths.every((l) => l === null)), "found rooms come in closed, with no numbers yet");
  // The tub's shape is the one along the bottom; joined, the room below the closet is one outline again.
  const tub = ft.rooms.findIndex((r) => r.corners.every((c) => c.y > 440));
  check(tub >= 0, "the tub's edge made a shape of its own");
  const below = ft.rooms.findIndex((r, i) => i !== tub && r.corners.some((c) => c.y > 440));
  ft = setLength(ft, below, 0, "9'");
  const joined = joinRoom(ft, tub);
  check(!!joined && joined.state.rooms.length === 2, "joining the tub's shape leaves two rooms");
  const into = joined.state.rooms[joined.into];
  check(into.corners.some((c) => near(c, D, 12)) && into.corners.some((c) => near(c, C, 12)), "the joined room runs down to the room's bottom corners");
  check(!into.corners.some((c) => c.y > 440 && c.y < 520), "the tub's edge leaves no corners on the walls");
  check(into.lengths.filter((l) => l !== null).length <= 1, "only walls that are still the same keep their numbers");
  check(joinRoom(foundToTrace([{ corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }], { width: 20, height: 20 }), 0) === null, "a shape with no room beside it is not joined");
}

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
