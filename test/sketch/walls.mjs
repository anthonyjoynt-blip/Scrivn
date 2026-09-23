/**
 * The wall tool: what a tapped corner snaps to, and what a run of walls becomes.
 *
 *   node test/sketch/walls.mjs        (also runs as part of npm run test:sketch)
 *
 * Asked for from the field: "the ability to also just draw walls — either free, extending into a
 * room, or if they connect it would form a room". The canvas only draws and snaps; every decision
 * about what a run IS lives in lib/sketchWalls.ts, and those decisions are what is checked here.
 *
 * Pure geometry, so this runs in Node rather than in the browser suite next door.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "wall-tests-"));
  // One bundle over both modules, so they share a single copy of the sketch module.
  const entry = join(outDir, "entry.ts");
  writeFileSync(entry, `export * from "${join(root, "lib", "sketch.ts").replace(/\\/g, "/")}";\nexport * from "${join(root, "lib", "sketchWalls.ts").replace(/\\/g, "/")}";\nexport * from "${join(root, "lib", "sketchQuantities.ts").replace(/\\/g, "/")}";\n`);
  const outfile = join(outDir, "sketch.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

const FT = 12;

function room(vertices, extra = {}) {
  return {
    id: "room-1",
    name: "Bedroom",
    vertices: vertices.map(([x, y], i) => ({ id: `${extra.id ?? "room-1"}-v${i}`, x, y })),
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

/** A 20' x 16' box at the origin: top wall 0, right 1, bottom 2, left 3 (bottom to top). */
const box = (extra = {}) => room([[0, 0], [240, 0], [240, 192], [0, 192]], extra);

const wall = (r, index) => r.vertices[index].id;

function freeWall(id, points, extra = {}) {
  return { id, vertices: points.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })), heightFeet: null, ...extra };
}

const pt = (x, y, on = null) => ({ x, y, on });

/* ── the checks ───────────────────────────────────────────────────────────────────────────────── */

export async function runWallChecks() {
  const s = await load();
  const passed = [];
  const failures = [];

  const test = (name, run) => {
    try {
      run();
      passed.push(name);
    } catch (err) {
      failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const near = (actual, expected, message, tolerance = 0.01) => {
    if (Math.abs(actual - expected) > tolerance) throw new Error(`${message}\n      expected ~${expected}\n      actual    ${actual}`);
  };
  const bounds = (r) => s.roomBounds(r);
  const ctx = (over = {}) => ({ rooms: [], freeWalls: [], draft: [], radiusPx: 12, ...over });

  /* Snapping. */

  test("a tap in open space lands where it was made", () => {
    const p = s.snapDraftPoint({ x: 500, y: 300 }, ctx({ rooms: [box()] }));
    assert(p.x === 500 && p.y === 300 && p.on === null, `got ${JSON.stringify(p)}`);
  });

  test("a tap near a room corner snaps onto the corner, and knows the wall it starts", () => {
    const r = box();
    const p = s.snapDraftPoint({ x: 244, y: -5 }, ctx({ rooms: [r] }));
    assert(p.x === 240 && p.y === 0, `expected the top-right corner, got ${p.x},${p.y}`);
    assert(p.on && p.on.roomId === r.id && p.on.wallId === wall(r, 1) && p.on.t === 0, `expected the right wall at its start, got ${JSON.stringify(p.on)}`);
  });

  test("a tap near a room wall snaps onto the wall, at the place along it", () => {
    const r = box();
    const p = s.snapDraftPoint({ x: 100, y: 5 }, ctx({ rooms: [r] }));
    assert(p.x === 100 && p.y === 0, `expected on the top wall, got ${p.x},${p.y}`);
    assert(p.on && p.on.wallId === wall(r, 0), "on the top wall");
    near(p.on.t, 100 / 240, "the fraction along it");
  });

  test("a tap further than the radius from a wall stays off it", () => {
    const p = s.snapDraftPoint({ x: 100, y: 20 }, ctx({ rooms: [box()] }));
    assert(p.y === 20 && p.on === null, `expected untouched, got ${JSON.stringify(p)}`);
  });

  test("a tap past the end of a wall does not snap onto the line the wall would continue along", () => {
    // 20" past the top-right corner, 3" below the top wall's line: near the line, not near the wall.
    const p = s.snapDraftPoint({ x: 260, y: 3 }, ctx({ rooms: [box()] }));
    assert(p.x === 260 && p.y === 3 && p.on === null, `expected untouched, got ${JSON.stringify(p)}`);
  });

  test("a tap nearly level with the previous corner is squared to it", () => {
    const p = s.snapDraftPoint({ x: 104, y: 200 }, ctx({ draft: [pt(100, 100)] }));
    assert(p.x === 100 && p.y === 200, `expected x squared to 100, got ${p.x},${p.y}`);
  });

  test("squaring and a wall together: the closet wall lands on the top wall directly above its corner", () => {
    // Previous corner at x=108, tap a little right of that and a little below the top wall.
    const r = box();
    const p = s.snapDraftPoint({ x: 110, y: 4 }, ctx({ rooms: [r], draft: [pt(0, 96), pt(108, 96)] }));
    assert(p.x === 108 && p.y === 0, `expected 108,0 — got ${p.x},${p.y}`);
    assert(p.on && p.on.wallId === wall(r, 0), "and it is on the top wall");
  });

  test("a corner beats a wall when both are in reach", () => {
    const p = s.snapDraftPoint({ x: 6, y: 5 }, ctx({ rooms: [box()] }));
    assert(p.x === 0 && p.y === 0, `expected the corner, got ${p.x},${p.y}`);
  });

  test("the run's own first corner is a target — that is how a loop closes by tapping near it", () => {
    const draft = [pt(100, 100), pt(200, 100), pt(200, 200)];
    const p = s.snapDraftPoint({ x: 103, y: 97 }, ctx({ draft }));
    assert(p.x === 100 && p.y === 100, `expected the first corner, got ${p.x},${p.y}`);
  });

  test("free walls are targets too: their corners and their length", () => {
    const f = freeWall("f", [[300, 300], [400, 300]]);
    const corner = s.snapDraftPoint({ x: 404, y: 296 }, ctx({ freeWalls: [f] }));
    assert(corner.x === 400 && corner.y === 300 && corner.on === null, `corner: got ${JSON.stringify(corner)}`);
    const along = s.snapDraftPoint({ x: 350, y: 306 }, ctx({ freeWalls: [f] }));
    assert(along.x === 350 && along.y === 300 && along.on === null, `along: got ${JSON.stringify(along)}`);
  });

  /* What a run becomes. */

  const sketchWith = (rooms = [], freeWalls = []) => ({ rooms, freeWalls });

  test("a run that comes back to its first corner is a room", () => {
    const draft = [pt(300, 300), pt(420, 300), pt(420, 396)];
    const step = s.addDraftPoint(draft, pt(300, 396), sketchWith(), 0, 12);
    assert(step.kind === "extend", "three corners and a fourth is still a run");
    const closed = s.addDraftPoint(step.draft, pt(300, 300), sketchWith(), 0, 12);
    assert(closed.kind === "room", `expected a room, got ${closed.kind}`);
    assert(closed.room.vertices.length === 4, `four corners, got ${closed.room.vertices.length}`);
    const b = bounds(closed.room);
    assert(b.minX === 300 && b.maxX === 420 && b.minY === 300 && b.maxY === 396, `bounds ${JSON.stringify(b)}`);
    near(s.grossFloorArea(closed.room), 80, "10' x 8'");
    assert(closed.usedFreeWallIds.length === 0, "nothing else used");
    assert(closed.room.name === "Room 1", `a drawn room is named like any other new room, got "${closed.room.name}"`);
    // With a "Room 1" already on the plan the next is "Room 2".
    const existing = { ...closed.room, id: "r1" };
    const again = s.addDraftPoint([pt(500, 300), pt(620, 300), pt(620, 396), pt(500, 396)], pt(500, 300), sketchWith([existing]), 0, 12);
    assert(again.kind === "room" && again.room.name === "Room 2", `next one is Room 2, got ${again.kind === "room" ? again.room.name : again.kind}`);
  });

  test("the room is wound clockwise whichever way it was tapped", () => {
    // Anticlockwise on screen: right, down, left, back up.
    const draft = [pt(300, 300), pt(300, 396), pt(420, 396)];
    const closed = s.addDraftPoint([...draft, pt(420, 300)], pt(300, 300), sketchWith(), 0, 12);
    assert(closed.kind === "room", "a room");
    const top = s.wallsOf(closed.room).find((w) => w.y1 === 300 && w.y2 === 300);
    assert(top && top.x2 > top.x1, "the top wall runs left to right, as a clockwise ring has it");
  });

  test("a corner tapped straight between two others is not kept", () => {
    const draft = [pt(300, 300), pt(360, 300), pt(420, 300), pt(420, 396)];
    const closed = s.addDraftPoint([...draft, pt(300, 396)], pt(300, 300), sketchWith(), 0, 12);
    assert(closed.kind === "room" && closed.room.vertices.length === 4, `expected four corners, got ${closed.kind === "room" ? closed.room.vertices.length : closed.kind}`);
  });

  test("tapping the last corner again adds nothing, and says so — it is how a run is finished", () => {
    const step = s.addDraftPoint([pt(300, 300), pt(420, 300)], pt(420, 300), sketchWith(), 0, 12);
    assert(step.kind === "ignore" && step.reason === "last", `expected ignore/last, got ${JSON.stringify(step)}`);
  });

  test("two corners and the first again is a line, not a room", () => {
    const step = s.addDraftPoint([pt(300, 300), pt(420, 300)], pt(300, 300), sketchWith(), 0, 12);
    assert(step.kind === "ignore", `expected ignore, got ${step.kind}`);
  });

  test("three corners in a line closed on the first enclose nothing, and are not finished either", () => {
    const step = s.addDraftPoint([pt(300, 300), pt(360, 300), pt(420, 300)], pt(300, 300), sketchWith(), 0, 12);
    assert(step.kind === "ignore" && step.reason === "degenerate", `expected ignore/degenerate, got ${JSON.stringify(step)}`);
  });

  test("a run that starts and ends on a room's walls cuts a sub-room out of the corner", () => {
    // From the left wall, across 4', up to the top wall: a 4' x 8' closet in the top-left corner.
    const r = box();
    const draft = [pt(0, 96, { roomId: r.id, wallId: wall(r, 3), t: 0.5 }), pt(48, 96)];
    const step = s.addDraftPoint(draft, pt(48, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.2 }), sketchWith([r]), 0, 12);
    assert(step.kind === "room", `expected a room, got ${step.kind}`);
    const b = bounds(step.room);
    assert(b.minX === 0 && b.maxX === 48 && b.minY === 0 && b.maxY === 96, `bounds ${JSON.stringify(b)}`);
    assert(step.room.vertices.length === 4, `four corners, got ${step.room.vertices.length}`);
    const derived = s.withDerivedParents([r, step.room]);
    assert(derived[1].parentRoomId === r.id, "and it nests in the room it was cut from");
    assert(step.room.name === "Room 1", `a room cut from a corner is named like any other new room, got "${step.room.name}"`);
  });

  test("the piece kept is the smaller one — the closet, not the rest of the bedroom", () => {
    const r = box();
    const draft = [pt(0, 96, { roomId: r.id, wallId: wall(r, 3), t: 0.5 }), pt(48, 96)];
    const step = s.addDraftPoint(draft, pt(48, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.2 }), sketchWith([r]), 0, 12);
    near(s.grossFloorArea(step.room), 32, "4' x 8'");
  });

  test("a partition wall to wall splits the room, and the smaller side is the new room", () => {
    // Left wall to right wall at 5' down: a 20' x 5' strip across the top.
    const r = box();
    const draft = [pt(0, 60, { roomId: r.id, wallId: wall(r, 3), t: (192 - 60) / 192 })];
    const step = s.addDraftPoint(draft, pt(240, 60, { roomId: r.id, wallId: wall(r, 1), t: 60 / 192 }), sketchWith([r]), 0, 12);
    assert(step.kind === "room", `expected a room, got ${step.kind}`);
    const b = bounds(step.room);
    assert(b.minY === 0 && b.maxY === 60 && b.minX === 0 && b.maxX === 240, `bounds ${JSON.stringify(b)}`);
  });

  test("a run along one wall encloses nothing — and, lying along a wall, is nothing", () => {
    // Both points on the top wall. Neither piece of the room is cut off, and the piece itself is
    // all overlap — see the checks on overlap below.
    const r = box();
    const draft = [pt(100, 0, { roomId: r.id, wallId: wall(r, 0), t: 100 / 240 })];
    const step = s.addDraftPoint(draft, pt(150, 0, { roomId: r.id, wallId: wall(r, 0), t: 150 / 240 }), sketchWith([r]), 0, 12);
    assert(step.kind !== "room", `expected no room, got ${step.kind}`);
    assert(step.kind === "ignore" && step.reason === "covered", `expected ignore/covered, got ${JSON.stringify(step)}`);
  });

  test("a run out from a wall and back to it is a room outside — a bay, standing beside the room", () => {
    const r = box();
    const draft = [pt(60, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.25 }), pt(60, -48), pt(120, -48)];
    const step = s.addDraftPoint(draft, pt(120, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.5 }), sketchWith([r]), 0, 12);
    assert(step.kind === "room", `expected a room, got ${step.kind}`);
    const b = bounds(step.room);
    assert(b.minY === -48 && b.maxY === 0 && b.minX === 60 && b.maxX === 120, `bounds ${JSON.stringify(b)}`);
    assert(s.withDerivedParents([r, step.room])[1].parentRoomId === null, "not inside the room it hangs off");
  });

  test("a run from one room's wall to another room's wall is a run", () => {
    const a = box({ id: "a" });
    const b = room([[300, 0], [540, 0], [540, 192], [300, 192]], { id: "b" });
    const draft = [pt(240, 96, { roomId: "a", wallId: wall(a, 1), t: 0.5 })];
    const step = s.addDraftPoint(draft, pt(300, 96, { roomId: "b", wallId: wall(b, 3), t: 0.5 }), sketchWith([a, b]), 0, 12);
    assert(step.kind === "extend", `expected extend, got ${step.kind}`);
  });

  test("a run that closes a loop with a free wall already drawn makes a room of both", () => {
    // An L of free wall, and a run from its far end back to its start.
    const f = freeWall("f", [[300, 300], [420, 300], [420, 396]]);
    const draft = [pt(420, 396), pt(300, 396)];
    const step = s.addDraftPoint(draft, pt(300, 300), sketchWith([], [f]), 0, 12);
    assert(step.kind === "room", `expected a room, got ${step.kind}`);
    assert(step.room.vertices.length === 4, `four corners, got ${step.room.vertices.length}`);
    near(s.grossFloorArea(step.room), 80, "10' x 8'");
    assert(step.usedFreeWallIds.length === 1 && step.usedFreeWallIds[0] === "f", "and the free wall is used up");
  });

  test("through two free walls end to end", () => {
    const f1 = freeWall("f1", [[300, 300], [420, 300]]);
    const f2 = freeWall("f2", [[420, 300], [420, 396]]);
    const step = s.addDraftPoint([pt(420, 396), pt(300, 396)], pt(300, 300), sketchWith([], [f1, f2]), 0, 12);
    assert(step.kind === "room", `expected a room, got ${step.kind}`);
    assert(step.usedFreeWallIds.length === 2, `both used, got ${step.usedFreeWallIds}`);
    near(s.grossFloorArea(step.room), 80, "10' x 8'");
  });

  test("a free wall that does not lead back to the start closes nothing", () => {
    const f = freeWall("f", [[300, 300], [420, 300]]);
    const step = s.addDraftPoint([pt(420, 396), pt(300, 396)], pt(420, 300), sketchWith([], [f]), 0, 12);
    assert(step.kind === "extend", `expected extend, got ${step.kind}`);
  });

  test("Done keeps the run as free walls, one straight piece each", () => {
    const done = s.finishDraft([pt(300, 300), pt(420, 300), pt(420, 396)], 0, []);
    assert(done && done.freeWalls.length === 2, `expected two walls, got ${done && done.freeWalls.length}`);
    assert(done.freeWalls.every((w) => w.vertices.length === 2 && w.heightFeet === null), "each a straight piece at full height");
    assert(done.freeWalls.every((w) => w.level === undefined), "the main level is not written");
    assert(done.selectIds.length === 2 && done.selectIds[1] === done.freeWalls[1].id, "and both are the ones to select");
    const up = s.finishDraft([pt(300, 300), pt(420, 300)], 1, []);
    assert(up.freeWalls[0].level === 1, "an upper storey is");
  });

  test("Done with one corner keeps nothing", () => {
    assert(s.finishDraft([pt(300, 300)], 0, []) === null, "expected null");
    assert(s.finishDraft([pt(300, 300), pt(300, 300)], 0, []) === null, "and the same corner twice is one corner");
  });

  test("three taps along one line make one wall, not two", () => {
    const done = s.finishDraft([pt(300, 300), pt(360, 300), pt(420, 300)], 0, []);
    assert(done.freeWalls.length === 1, `expected one wall, got ${done.freeWalls.length}`);
    near(s.freeWallSegments(done.freeWalls[0])[0].lengthFeet, 10, "of the full length");
  });

  test("a piece that carries straight on from a free wall's end becomes part of that wall", () => {
    // The report: a wall drawn from the end of another along the same line read as two measurements.
    const f = freeWall("f", [[300, 300], [366, 300]]);
    const done = s.finishDraft([pt(366, 300), pt(407, 300)], 0, [f]);
    assert(done.freeWalls.length === 1, `expected one wall, got ${done.freeWalls.length}`);
    const [w] = done.freeWalls;
    assert(w.id === "f", "the existing wall, extended");
    near(s.freeWallSegments(w)[0].lengthFeet, 107 / 12, "8'11\" — one measurement");
    assert(done.selectIds[0] === "f", "and it is the one selected");
  });

  test("and a piece drawn back onto the wall's START extends it that way too", () => {
    const f = freeWall("f", [[300, 300], [366, 300]]);
    const done = s.finishDraft([pt(300, 300), pt(240, 300)], 0, [f]);
    assert(done.freeWalls.length === 1, `expected one wall, got ${done.freeWalls.length}`);
    const [a, b] = done.freeWalls[0].vertices;
    assert(Math.min(a.x, b.x) === 240 && Math.max(a.x, b.x) === 366, `expected 240..366, got ${a.x}..${b.x}`);
  });

  test("a piece bridging two walls in one line makes one wall of all three", () => {
    const f1 = freeWall("f1", [[300, 300], [340, 300]]);
    const f2 = freeWall("f2", [[380, 300], [420, 300]]);
    const done = s.finishDraft([pt(340, 300), pt(380, 300)], 0, [f1, f2]);
    assert(done.freeWalls.length === 1, `expected one wall, got ${done.freeWalls.length}`);
    near(s.freeWallSegments(done.freeWalls[0])[0].lengthFeet, 10, "300 to 420");
  });

  test("two walls in one line with a gap between them stay two walls — the gap is a doorway", () => {
    const f = freeWall("f", [[300, 300], [340, 300]]);
    const done = s.finishDraft([pt(380, 300), pt(420, 300)], 0, [f]);
    assert(done.freeWalls.length === 2, `expected two walls, got ${done.freeWalls.length}`);
  });

  test("a piece meeting a wall at a corner, or part-way along it, stays its own wall", () => {
    const f = freeWall("f", [[300, 300], [420, 300]]);
    const corner = s.finishDraft([pt(420, 300), pt(420, 396)], 0, [f]);
    assert(corner.freeWalls.length === 2, "a corner is two walls");
    const tee = s.finishDraft([pt(360, 300), pt(360, 396)], 0, [f]);
    assert(tee.freeWalls.length === 2, "a tee is two walls");
    assert(tee.freeWalls[0].vertices.every((v) => v.y === 300), "and the wall it meets is untouched");
  });

  test("a merged wall keeps its height", () => {
    const f = freeWall("f", [[300, 300], [366, 300]], { heightFeet: 3.5 });
    const done = s.finishDraft([pt(366, 300), pt(407, 300)], 0, [f]);
    assert(done.freeWalls[0].heightFeet === 3.5, "the pony wall is still a pony wall");
  });

  /* Not along a wall that is already there. */

  test("a piece started on a room's wall and carried past its corner keeps only the part beyond", () => {
    // Start in the middle of the top wall, tap out past the top-left corner: the wall begins at the corner.
    const r = box();
    const draft = [pt(120, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.5 })];
    const step = s.addDraftPoint(draft, pt(-60, 0), sketchWith([r]), 0, 12);
    assert(step.kind === "extend", `expected extend, got ${step.kind}`);
    assert(step.draft.length === 2, `two corners, got ${step.draft.length}`);
    assert(step.draft[0].x === 0 && step.draft[0].y === 0, `expected to start at the corner, got ${step.draft[0].x},${step.draft[0].y}`);
    assert(step.draft[0].on && step.draft[0].on.roomId === r.id, "and to know it is on the room");
    assert(step.draft[1].x === -60, "ending where the finger did");
  });

  test("a piece ending along a wall stops where that wall begins", () => {
    const r = box();
    const step = s.addDraftPoint([pt(-60, 0)], pt(120, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.5 }), sketchWith([r]), 0, 12);
    assert(step.kind === "extend", `expected extend, got ${step.kind}`);
    assert(step.draft[1].x === 0 && step.draft[1].y === 0, `expected to stop at the corner, got ${step.draft[1].x},${step.draft[1].y}`);
  });

  test("a piece lying wholly along a wall draws nothing, and says why", () => {
    const r = box();
    const step = s.addDraftPoint([pt(60, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.25 })], pt(180, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.75 }), sketchWith([r]), 0, 12);
    assert(step.kind === "ignore" && step.reason === "covered", `expected ignore/covered, got ${JSON.stringify(step)}`);
  });

  test("the same along a free wall", () => {
    const f = freeWall("f", [[300, 300], [420, 300]]);
    const step = s.addDraftPoint([pt(330, 300)], pt(390, 300), sketchWith([], [f]), 0, 12);
    assert(step.kind === "ignore" && step.reason === "covered", `expected ignore/covered, got ${JSON.stringify(step)}`);
    const past = s.addDraftPoint([pt(330, 300)], pt(480, 300), sketchWith([], [f]), 0, 12);
    assert(past.kind === "extend" && past.draft[0].x === 420, `expected to begin at the wall's end, got ${JSON.stringify(past)}`);
  });

  test("a piece across a wall, not along it, is left alone", () => {
    const r = box();
    const step = s.addDraftPoint([pt(120, -60)], pt(120, 60), sketchWith([r]), 0, 12);
    assert(step.kind === "extend" && step.draft[1].y === 60, `expected untouched, got ${JSON.stringify(step)}`);
  });

  test("the start of a piece is not moved when a piece before it ends there", () => {
    // Second piece of a run starts on the wall: the corner stays, the overlap is tolerated.
    const r = box();
    const draft = [pt(120, -60), pt(120, 0, { roomId: r.id, wallId: wall(r, 0), t: 0.5 })];
    const step = s.addDraftPoint(draft, pt(-60, 0), sketchWith([r]), 0, 12);
    assert(step.kind === "extend" && step.draft[1].x === 120, `expected the corner kept, got ${JSON.stringify(step.draft)}`);
  });

  /* One wall, one measurement — across a room's corner too. */

  test("a free wall carrying straight on from a room's corner is measured with that wall, corner to corner", () => {
    // The report: the room's bottom wall read 5'8", the wall carrying on past its corner 3'6",
    // and the PM's tape said 9'2".
    const r = box();
    const on = freeWall("on", [[240, 192], [282, 192]]); // 3'6" carrying on from the bottom-right corner
    const bottom = s.wallsOf(r)[2];
    const { dimensions, absorbed } = s.wallDimensionsWithExtensions(r, bottom, [r], [on]);
    assert(dimensions.length === 1, `one label, got ${dimensions.length}`);
    near(dimensions[0].lengthFeet, 20 + 3.5, "the whole run");
    assert(absorbed.includes("on"), "and the free wall's own label is not drawn");
    // Centred over the whole run: the bottom wall runs right to left, so the extension is below 0.
    near(dimensions[0].run[0], -42 / 240, "the run reaches past the wall's start");
    near(dimensions[0].t, (1 - 42 / 240) / 2, "label at the middle of the whole run");
  });

  test("and from the other corner, and through two free walls in line", () => {
    const r = box();
    const a = freeWall("a", [[0, 192], [-24, 192]]);
    const b = freeWall("b", [[-24, 192], [-60, 192]]);
    const bottom = s.wallsOf(r)[2];
    const { dimensions, absorbed } = s.wallDimensionsWithExtensions(r, bottom, [r], [a, b]);
    near(dimensions[0].lengthFeet, 25, "20' plus 5'");
    assert(absorbed.includes("a") && absorbed.includes("b"), `both absorbed, got ${absorbed}`);
  });

  test("a free wall off the corner at an angle, or on another storey, is its own wall", () => {
    const r = box();
    // Off the corner and outward, but 38" off the line by the time it ends: not this wall.
    const angled = freeWall("angled", [[240, 192], [282, 230]]);
    const upstairs = freeWall("up", [[240, 192], [282, 192]], { level: 1 });
    const bottom = s.wallsOf(r)[2];
    const { dimensions, absorbed } = s.wallDimensionsWithExtensions(r, bottom, [r], [angled, upstairs]);
    near(dimensions[0].lengthFeet, 20, "the wall alone");
    assert(absorbed.length === 0, "nothing absorbed");
  });

  test("a free wall lying back along the room's wall from its corner is not an extension", () => {
    // Nothing draws one now (see the overlap checks), but a sketch may still carry one.
    const r = box();
    const back = freeWall("back", [[240, 192], [200, 192]]);
    const bottom = s.wallsOf(r)[2];
    const { dimensions, absorbed } = s.wallDimensionsWithExtensions(r, bottom, [r], [back]);
    near(dimensions[0].lengthFeet, 20, "the wall alone");
    assert(absorbed.length === 0, "and the wall keeps its own label");
  });

  test("another room's wall in line is never counted in — each room's wall is typed for its room", () => {
    const a = box({ id: "a" });
    const b = room([[240, 0], [480, 0], [480, 192], [240, 192]], { id: "b" });
    const top = s.wallsOf(a)[0];
    near(s.wallDimensionsWithExtensions(a, top, [a, b], []).dimensions[0].lengthFeet, 20, "the room's own wall");
  });

  test("absorbedFreeWallIds gathers them across every room", () => {
    const r = box();
    const on = freeWall("on", [[240, 192], [282, 192]]);
    const loose = freeWall("loose", [[400, 400], [460, 400]]);
    const ids = s.absorbedFreeWallIds([r], [on, loose]);
    assert(ids.has("on") && !ids.has("loose"), `got ${[...ids]}`);
  });

  test("typing over the whole-run label sizes the room's wall, holding the corner the free wall is on", () => {
    // 20' of room wall plus a 3'6" free wall = 23'6". Typed 24': the room wall becomes 20'6", and
    // the corner the free wall stands on stays put.
    const r = box();
    const bottom = s.wallsOf(r)[2];
    const run = [-42 / 240, 1];
    const resized = s.withWallRunLength(r, bottom.id, run, 24);
    near(s.wallById(resized, bottom.id).lengthFeet, 20.5, "the room's wall");
    const b = s.roomBounds(resized);
    near(b.maxX, 240, "the right side, where the free wall stands, stays");
    near(b.minX, -6, "the left side moves");
  });

  /* Rooms landing flush with each other. */

  test("a dragged room snaps its corners to the walls of an L, not just to its box", () => {
    // An L with a notch top-left, and a 5' x 4' room dragged into the notch a little short of flush.
    //   (60,0) ─── (240,0)          the notch's inside walls are x=60 and y=48
    //     │           │
    // (0,48)──(60,48)  │
    //     │           │
    //   (0,192) ─── (240,192)
    const l = room([[60, 0], [240, 0], [240, 192], [0, 192], [0, 48], [60, 48]], { id: "l" });
    // 5'6" x 3'4" — NOT the notch's own size, so lining its far edges up with the L's box would put
    // its near edges somewhere else, which is what the old box-only snapping did.
    const small = room([[-100, -100], [-34, -100], [-34, -60], [-100, -60]], { id: "small" });
    // Dragged into the notch so its right edge lands 4px shy of x=60 and its bottom 3px past y=48.
    const snapped = s.snapRoomTranslation([l, small], "small", 90, 111, []);
    near(-34 + snapped.dx, 60, "right edge onto the notch's wall");
    near(-60 + snapped.dy, 48, "bottom edge onto the notch's wall");
  });

  test("an L being dragged snaps by its inside corner too, which its box does not have", () => {
    const l = room([[60, 0], [240, 0], [240, 192], [0, 192], [0, 48], [60, 48]], { id: "l" });
    const small = room([[300, 300], [340, 300], [340, 330], [300, 330]], { id: "small" });
    // Dragged so the L's inside corner (60,48) lands 3px from the small room's corner (300,300).
    const snapped = s.snapRoomTranslation([l, small], "l", 243, 249, []);
    near(60 + snapped.dx, 300, "inside corner x onto the small room's corner");
    near(48 + snapped.dy, 300, "inside corner y onto it");
  });

  test("and to the end of a free wall", () => {
    const r = box({ id: "r" });
    const f = freeWall("f", [[300, 300], [360, 300]]);
    const small = room([[0, 400], [60, 400], [60, 448], [0, 448]], { id: "small" });
    const snapped = s.snapRoomTranslation([r, small], "small", 303, -104, [f]);
    near(0 + snapped.dx, 300, "left edge onto the wall's end");
    near(400 + snapped.dy, 300, "top edge onto the wall's line");
  });

  test("a room on another storey is not something to line up with", () => {
    const r = box({ id: "r", level: 1 });
    const small = room([[0, 400], [60, 400], [60, 448], [0, 448]], { id: "small" });
    const snapped = s.snapRoomTranslation([r, small], "small", 243, -200, []);
    assert(snapped.dx === 243 && snapped.dy === -200, `expected untouched, got ${JSON.stringify(snapped)}`);
  });

  /* The snap radius. */

  test("the snap radius is a fingertip on screen, and never thinner than the wall", () => {
    near(s.wallSnapRadiusPx(1), 16, "at 100%");
    near(s.wallSnapRadiusPx(2), 8, "half the world pixels at 200%");
    // Zoomed right in, a fingertip is a sliver of the world: the radius has to stay a bit wider than
    // the drawn wall, or a tap on the wall's own stroke misses it.
    assert(s.wallSnapRadiusPx(8) >= s.wallStrokePx(8) * 0.75 + 2, `at 800% still covers the wall's own stroke: ${s.wallSnapRadiusPx(8)} vs ${s.wallStrokePx(8)}`);
  });

  /* What moves together. */

  test("walls joined end to end move as one, however many are in the chain", () => {
    const f1 = freeWall("f1", [[300, 300], [420, 300]]);
    const f2 = freeWall("f2", [[420, 300], [420, 396]]);
    const f3 = freeWall("f3", [[420, 396], [300, 396]]);
    const loose = freeWall("loose", [[500, 500], [560, 500]]);
    const ids = s.connectedFreeWallIds("f1", [f1, f2, f3, loose]);
    assert(ids.includes("f1") && ids.includes("f2") && ids.includes("f3") && !ids.includes("loose"), `got ${ids}`);
  });

  test("a wall standing against a room goes with the room, and brings what is joined to it", () => {
    const r = box();
    const off = freeWall("off", [[120, 0], [120, 96]]); // from the top wall into the room
    const joined = freeWall("joined", [[120, 96], [180, 96]]);
    const loose = freeWall("loose", [[400, 400], [460, 400]]);
    const ids = s.freeWallsAttachedToRoom(r, [off, joined, loose]);
    assert(ids.includes("off") && ids.includes("joined") && !ids.includes("loose"), `got ${ids}`);
  });

  test("dragging a shared corner moves every wall end that shares it", () => {
    const f1 = freeWall("f1", [[300, 300], [420, 300]]);
    const f2 = freeWall("f2", [[420, 300], [420, 396]]);
    const moved = s.moveSharedFreeWallVertex([f1, f2], "f1", "f1-v1", 430, 310);
    assert(moved[0].vertices[1].x === 430 && moved[1].vertices[0].x === 430 && moved[1].vertices[0].y === 310, "both ends moved");
    assert(moved[1].vertices[1].y === 396, "the far end of the other wall stayed");
  });

  test("and refuses for all of them when any would be left too short", () => {
    const f1 = freeWall("f1", [[300, 300], [420, 300]]);
    const f2 = freeWall("f2", [[420, 300], [420, 306]]);
    const moved = s.moveSharedFreeWallVertex([f1, f2], "f1", "f1-v1", 420, 305);
    assert(moved === [f1, f2] || (moved[0] === f1 && moved[1] === f2), "expected untouched");
  });

  test("a moved wall lands flush with the nearest corner or wall", () => {
    const r = box();
    const f = freeWall("f", [[300, 300], [360, 300]]);
    // Dragged to within reach of the room's top-right corner (240, 0): the near end lands on it.
    const snapped = s.snapFreeWallTranslation(["f"], [f], [r], -55, -296, 12);
    near(300 + snapped.dx, 240, "x onto the corner");
    near(300 + snapped.dy, 0, "y onto the corner");
    const far = s.snapFreeWallTranslation(["f"], [f], [r], 100, 100, 12);
    assert(far.dx === 100 && far.dy === 100, "and is left alone when nothing is near");
  });

  /* Editing a free wall. */

  test("a corner can be moved, but not onto its neighbour", () => {
    const f = freeWall("f", [[300, 300], [420, 300]]);
    const moved = s.moveFreeWallVertex(f, "f-v1", 420, 350);
    assert(moved.vertices[1].y === 350, "moved");
    const refused = s.moveFreeWallVertex(f, "f-v1", 302, 300);
    assert(refused === f, "refused when it would leave no wall");
  });

  test("typing a length moves the far corner along the piece and leaves the rest where it was", () => {
    const f = freeWall("f", [[300, 300], [420, 300], [420, 396]]);
    const longer = s.withFreeWallSegmentLength(f, "f-v0", 12);
    assert(longer.vertices[1].x === 444 && longer.vertices[1].y === 300, `expected 444,300 — got ${longer.vertices[1].x},${longer.vertices[1].y}`);
    assert(longer.vertices[2].x === 420 && longer.vertices[2].y === 396, "the corner after it stays");
    near(s.freeWallSegments(longer)[0].lengthFeet, 12, "and the piece is 12'");
  });

  test("the whole wall slides", () => {
    const f = freeWall("f", [[300, 300], [420, 300]]);
    const slid = s.translateFreeWall(f, 10, -5);
    assert(slid.vertices.every((v, i) => v.x === f.vertices[i].x + 10 && v.y === f.vertices[i].y - 5), "every corner moved by the same amount");
  });

  /* What a free wall is worth. */

  test("a partition in a room adds two faces and two runs of base to that room", () => {
    const r = box();
    const f = freeWall("f", [[120, 0], [120, 96]]); // 8' partition off the top wall
    const q = s.roomQuantities(r, { rooms: [r], freeWalls: [f] }, s.DEFAULT_QUANTITY_OPTIONS);
    near(q.perimeterFloor, 72 + 16, "PF: perimeter plus both sides");
    near(q.perimeterCeiling, 72 + 16, "PC: full height meets the ceiling on both sides");
    near(q.wallArea, 72 * 8 + 2 * 8 * 8, "W: both faces at ceiling height");
    near(q.gross.wallArea, 72 * 8 + 2 * 8 * 8, "and in the gross figure");
  });

  test("a pony wall has faces to its own height and no ceiling line", () => {
    const r = box();
    const f = freeWall("f", [[120, 0], [120, 96]], { heightFeet: 3.5 });
    const q = s.roomQuantities(r, { rooms: [r], freeWalls: [f] }, s.DEFAULT_QUANTITY_OPTIONS);
    near(q.perimeterFloor, 88, "base along both sides still");
    near(q.perimeterCeiling, 72, "nothing at the ceiling");
    near(q.wallArea, 576 + 2 * 8 * 3.5, "faces 3'6\" high");
  });

  test("a wall standing clear of every room is credited to none", () => {
    const r = box();
    const f = freeWall("f", [[400, 0], [400, 96]]);
    const q = s.roomQuantities(r, { rooms: [r], freeWalls: [f] }, s.DEFAULT_QUANTITY_OPTIONS);
    near(q.perimeterFloor, 72, "unchanged");
    near(q.wallArea, 576, "unchanged");
    assert(s.freeWallRunsIn(r, { rooms: [r], freeWalls: [f] }).length === 0, "not in the room");
  });

  test("a wall inside a closet is the closet's, not the bedroom's", () => {
    const r = box();
    const closet = room([[0, 0], [48, 0], [48, 96], [0, 96]], { id: "closet", name: "Closet", parentRoomId: r.id });
    const f = freeWall("f", [[24, 0], [24, 48]]);
    const sketch = { rooms: [r, closet], freeWalls: [f] };
    assert(s.freeWallRunsIn(closet, sketch).length === 1, "in the closet");
    assert(s.freeWallRunsIn(r, sketch).length === 0, "not the bedroom");
  });

  test("a wall on another storey is not in a room on this one", () => {
    const r = box();
    const f = freeWall("f", [[120, 0], [120, 96]], { level: 1 });
    assert(s.freeWallRunsIn(r, { rooms: [r], freeWalls: [f] }).length === 0, "different storey");
    assert(s.levelsOf({ rooms: [r], freeWalls: [f] }).includes(1), "but its storey exists");
  });

  test("the sketch data lists the free walls", () => {
    const r = box();
    const f = freeWall("f", [[120, 0], [120, 96], [180, 96]], { heightFeet: 3.5 });
    const text = s.sketchSummaryText({ rooms: [r], freeWalls: [f] });
    assert(text.includes("Free walls"), "has the section");
    assert(text.includes("Wall 1 — 8' + 5' (2 pieces), 3'6\" high in Bedroom"), `line: ${text.split("\n").slice(-1)[0]}`);
    assert(s.sketchSummaryText({ rooms: [], freeWalls: [f] }).includes("Wall 1"), "and with no rooms at all");
  });

  test("the sketch opens on the main level when anything is drawn there", () => {
    const main = box();
    const below = room([[0, 0], [96, 0], [96, 96], [0, 96]], { id: "below", name: "Rec room", level: -1 });
    assert(s.openingLevel({ rooms: [below, main] }) === 0, "main has a room");
    assert(s.openingLevel({ rooms: [below], freeWalls: [freeWall("f", [[0, 0], [60, 0]])] }) === 0, "main has a wall");
    assert(s.openingLevel({ rooms: [] }) === 0, "empty sketch");
    assert(s.openingLevel({ rooms: [], levels: [-1] }) === 0, "an added storey with nothing on it");
  });

  test("otherwise it opens on the storey last worked on", () => {
    const below = room([[0, 0], [96, 0], [96, 96], [0, 96]], { id: "below", name: "Rec room", level: -1 });
    const above = room([[0, 0], [96, 0], [96, 96], [0, 96]], { id: "above", name: "Bedroom", level: 1 });
    assert(s.openingLevel({ rooms: [below] }) === -1, "a basement-only scan opens on the basement");
    assert(s.openingLevel({ rooms: [below, above] }) === 1, "the last room drawn decides");
    assert(s.openingLevel({ rooms: [above, below] }) === -1, "in either order");
    assert(s.openingLevel({ rooms: [], freeWalls: [freeWall("f", [[0, 0], [60, 0]], { level: 2 })] }) === 2, "a wall alone decides too");
  });

  test("the view frames what is on the storey, centred", () => {
    // The 20' x 16' box: 240 x 192 world pixels at the origin.
    const r = box();
    const view = s.fitView(s.levelBounds({ rooms: [r] }, 0), 400, 300);
    // The short way decides: (300 - 48) / 192.
    assert(Math.abs(view.scale - 252 / 192) < 0.001, `scale ${view.scale}`);
    // The room's middle lands in the canvas's middle, both ways.
    const middleX = view.x + 120 * view.scale;
    const middleY = view.y + 96 * view.scale;
    assert(Math.abs(middleX - 200) < 0.001, `x centre ${middleX}`);
    assert(Math.abs(middleY - 150) < 0.001, `y centre ${middleY}`);
  });

  test("one small room is framed but not blown up past the fit's ceiling", () => {
    const closet = room([[0, 0], [48, 0], [48, 60], [0, 60]], { id: "closet" });
    const view = s.fitView(s.levelBounds({ rooms: [closet] }, 0), 400, 300);
    assert(view.scale === s.FIT_MAX_ZOOM, `a 4' closet would otherwise open at ${view.scale}x`);
  });

  test("a big plan is scaled down to fit, and never below the zoom floor", () => {
    const wide = room([[0, 0], [600, 0], [600, 300], [0, 300]], { id: "wide" });
    const view = s.fitView(s.levelBounds({ rooms: [wide] }, 0), 400, 300);
    assert(Math.abs(view.scale - 352 / 600) < 0.001, `scale ${view.scale}`);

    const huge = room([[0, 0], [4000, 0], [4000, 3000], [0, 3000]], { id: "huge" });
    const floored = s.fitView(s.levelBounds({ rooms: [huge] }, 0), 400, 300);
    assert(floored.scale === s.MIN_ZOOM, `the zoom floor still applies: ${floored.scale}`);
  });

  test("an empty storey is left at the origin, and so is a canvas with no size yet", () => {
    assert(s.levelBounds({ rooms: [] }, 0) === null, "nothing on it");
    const origin = s.fitView(null, 400, 300);
    assert(origin.x === 0 && origin.y === 0 && origin.scale === 1, "the default view");
    const unmeasured = s.fitView({ minX: 0, minY: 0, maxX: 96, maxY: 96 }, 0, 0);
    assert(unmeasured.scale === 1, "a canvas that has not been measured cannot be fitted to");
  });

  test("the bounds are the storey's own, walls included", () => {
    const r = box();
    const far = room([[0, 0], [96, 0], [96, 96], [0, 96]], { id: "up", level: 1 });
    const wall = freeWall("f", [[400, 400], [460, 400]]);
    const b = s.levelBounds({ rooms: [r, far], freeWalls: [wall] }, 0);
    assert(b.maxX === 460, `maxX ${b.maxX} — the free wall counts`);
    const upstairs = s.levelBounds({ rooms: [r, far], freeWalls: [wall] }, 1);
    assert(upstairs.maxX === 96, `the storey above is on its own: ${upstairs.maxX}`);
  });

  test("a scanned ceiling's measured run is what the quantities use", () => {
    // A 20' x 16' room with a ceiling falling 8' to 10'. The assumption takes the run to be the
    // room's LONGER side; the phone measures it across the way the ceiling actually falls. The
    // shorter run is the steeper slope, so more ceiling surface — the number that reaches a scope.
    const shed = (extra) => box({ ceilingHeightFeet: 8, ceilingType: "sloped", ceilingPeakFeet: 10, ...extra });
    const assumed = s.roomQuantities(shed({}), { rooms: [shed({})] }, s.DEFAULT_QUANTITY_OPTIONS);
    const measured = shed({ ceilingRunFeet: 16 });
    const read = s.roomQuantities(measured, { rooms: [measured] }, s.DEFAULT_QUANTITY_OPTIONS);
    assert(read.ceilingArea > assumed.ceilingArea + 0.5, `measured ${read.ceilingArea} vs assumed ${assumed.ceilingArea}`);
    // The floor never changes with the ceiling, whatever the slope does.
    assert(Math.abs(read.floorArea - assumed.floorArea) < 1e-9, "the floor is the floor");
  });

  test("a run of zero or none falls back to the room's own span", () => {
    const shed = (extra) => box({ ceilingHeightFeet: 8, ceilingType: "sloped", ceilingPeakFeet: 10, ...extra });
    const none = s.roomQuantities(shed({}), { rooms: [shed({})] }, s.DEFAULT_QUANTITY_OPTIONS);
    const zero = shed({ ceilingRunFeet: 0 });
    const zeroed = s.roomQuantities(zero, { rooms: [zero] }, s.DEFAULT_QUANTITY_OPTIONS);
    assert(Math.abs(none.ceilingArea - zeroed.ceilingArea) < 1e-9, "a zero run is not a run");
  });

  test("a sketch with only free walls still counts as a sketch", () => {
    assert(s.hasSketchContent({ rooms: [], freeWalls: [freeWall("f", [[0, 0], [60, 0]])] }), "has content");
    assert(!s.hasSketchContent({ rooms: [] }), "an empty one does not");
    assert(!s.hasSketchContent({ rooms: [], freeWalls: [] }), "nor one with an empty list");
  });

  return { passed, failures };
}

/* ── standalone ───────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runWallChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
