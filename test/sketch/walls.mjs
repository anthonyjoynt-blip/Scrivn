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

  test("a run along one wall encloses nothing and stays a run", () => {
    const r = box();
    const draft = [pt(100, 0, { roomId: r.id, wallId: wall(r, 0), t: 100 / 240 })];
    const step = s.addDraftPoint(draft, pt(150, 0, { roomId: r.id, wallId: wall(r, 0), t: 150 / 240 }), sketchWith([r]), 0, 12);
    assert(step.kind === "extend", `expected extend, got ${step.kind}`);
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

  test("Done keeps the run as a free wall, corners and all", () => {
    const w = s.finishDraftAsWall([pt(300, 300), pt(420, 300), pt(420, 396)], 0);
    assert(w && w.vertices.length === 3 && w.heightFeet === null, `got ${JSON.stringify(w)}`);
    assert(w.level === undefined, "the main level is not written");
    const up = s.finishDraftAsWall([pt(300, 300), pt(420, 300)], 1);
    assert(up.level === 1, "an upper storey is");
  });

  test("Done with one corner keeps nothing", () => {
    assert(s.finishDraftAsWall([pt(300, 300)], 0) === null, "expected null");
    assert(s.finishDraftAsWall([pt(300, 300), pt(300, 300)], 0) === null, "and the same corner twice is one corner");
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
