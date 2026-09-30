/**
 * Turning a room or a block on the plan (lib/sketchTurn.ts, and the turn geometry in lib/sketch.ts).
 *
 *   node test/sketch/turn.mjs        (also runs as part of npm run test:sketch)
 *
 * Asked for from the field on 2026-09-30: "give me a rotate button in scrivn on the sketch pad.
 * similar to door flip so when i select a room or block i can rotate it. in 15 degree increments or
 * something". Pure geometry, so this runs in Node; the buttons themselves are driven through the
 * editor in turnButtons.tsx.
 *
 * What is checked is what would be wrong without anyone noticing on screen: a turn that is not quite
 * undone by the turn back, a wall a hair shorter after going round, a door that flips as its wall
 * passes 45 degrees, a closet or a partition left behind, paint that stays where the floor was, a
 * sloped ceiling that prices differently because the room it is over was turned.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "turn-tests-"));
  const entry = join(outDir, "entry.ts");
  const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
  // As namespaces: several of these modules export the same helper names, and a star export of two
  // modules that both export a name leaves that name out without a word.
  writeFileSync(
    entry,
    [
      `export * as s from "${lib("sketch.ts")}";`,
      `export * as t from "${lib("sketchTurn.ts")}";`,
      `export * as q from "${lib("sketchQuantities.ts")}";`,
      `export * as m from "${lib("moisture.ts")}";`,
      `export * as d3 from "${lib("sketch3d.ts")}";`,
    ].join("\n"),
  );
  const outfile = join(outDir, "turn.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const FT = 12;

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

function room(id, corners, extra = {}) {
  return {
    id,
    name: id,
    vertices: corners.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
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

/** A box at (x, y), w x h pixels, clockwise: top wall v0, right v1, bottom v2, left v3. */
const box = (id, x, y, w, h, extra = {}) => room(id, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], extra);

function door(id, wallId, t, extra = {}) {
  return { id, type: "door", wallId, t, widthFraction: 0.2, widthFeet: 3, doorType: "swing", leaves: "single", heightFeet: 6 + 8 / 12, flipX: false, flipY: false, ...extra };
}
function windowOn(id, wallId, t) {
  return { id, type: "window", wallId, t, widthFraction: 0.2, widthFeet: 3, heightFeet: 4, sillFeet: 3 };
}
function cabinetOn(id, wallId, t) {
  return { id, type: "cabinet", wallId, t, widthFraction: 0.3, widthFeet: 4, label: "Base", tier: "base", depthFeet: 2, heightFeet: 3 };
}
function block(id, x, y, wFt, dFt, extra = {}) {
  return { id, x, y, widthPx: wFt * FT, depthPx: dFt * FT, widthFeet: wFt, depthFeet: dFt, label: "Island", tier: "base", ...extra };
}

/** A 16' x 12' bedroom with a door, a window, a cabinet run, an island, a closet in its corner and a partition off its side. */
function bedroomSketch(s) {
  const bed = box("bed", 100, 100, 16 * FT, 12 * FT, {
    symbols: [door("d", "bed-v0", 0.7, { flipX: true }), windowOn("w", "bed-v1", 0.5), cabinetOn("c", "bed-v2", 0.3)],
    freeCabinets: [block("isl", 7 * FT, 5 * FT, 6, 3)],
  });
  const closet = box("closet", 100, 100, 4 * FT, 3 * FT);
  const hall = box("hall", 600, 600, 10 * FT, 4 * FT);
  const partition = { id: "fw", vertices: [{ id: "fw-a", x: 100 + 16 * FT, y: 160 }, { id: "fw-b", x: 100 + 16 * FT + 60, y: 160 }], heightFeet: null };
  return { rooms: s.withDerivedParents([bed, closet, hall]), freeWalls: [partition] };
}

/** A flight of stairs, as the editor makes one. */
function flight(id, x, y, extra = {}) {
  return box(id, x, y, 11 * FT, 3 * FT, {
    name: "Stairs",
    ceilingType: "sloped",
    stairs: { orientation: 0, direction: "up", treadDepthFeet: 10.5 / 12, riseFeet: null },
    ...extra,
  });
}

/* ── the checks ───────────────────────────────────────────────────────────────────────────────── */

export async function runTurnChecks() {
  const { s, t, q, m, d3 } = await load();
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
  const near = (actual, expected, message, tolerance = 1e-6) => {
    if (!(Math.abs(actual - expected) <= tolerance)) throw new Error(`${message}\n      expected ~${expected}\n      actual    ${actual}`);
  };
  const nearPoint = (a, b, message, tolerance = 1e-6) => {
    near(a.x, b.x, `${message} (x)`, tolerance);
    near(a.y, b.y, `${message} (y)`, tolerance);
  };
  const byId = (sketch, id) => sketch.rooms.find((r) => r.id === id);
  const turnBy = (sketch, id, deg, times = 1) => {
    let out = sketch;
    for (let i = 0; i < times; i++) {
      const turned = t.turnRoomInSketch(out, id, deg);
      if (!turned) throw new Error(`turn ${i + 1} of ${id} by ${deg} was refused`);
      out = turned.sketch;
    }
    return out;
  };
  const middleOf = (points) => ({ x: points.reduce((a, p) => a + p.x, 0) / points.length, y: points.reduce((a, p) => a + p.y, 0) / points.length });
  const onAxes = (r) => s.wallsOf(r).every((w) => Math.abs(w.x2 - w.x1) < 1e-9 || Math.abs(w.y2 - w.y1) < 1e-9);

  /* The step a press takes. */

  test("a press turns a whole step from a step, and onto the next step from anywhere else", () => {
    near(s.turnStepDeg(0, 1), 15, "clockwise from square");
    near(s.turnStepDeg(0, -1), -15, "anticlockwise from square");
    near(s.turnStepDeg(30, 1), 15, "from one step to the next");
    near(s.turnStepDeg(3, -1), -3, "a scan 3 degrees off comes square the short way");
    near(s.turnStepDeg(3, 1), 12, "or goes on to the next step the long way");
    near(s.turnStepDeg(-3, 1), 3, "and the same the other side of square");
    near(s.turnStepDeg(-3, -1), -12, "both ways");
    near(s.turnStepDeg(44.99999999, 1), 15, "a hair off a step is on it: a turn's own rounding is not a crooked room");
    near(s.turnStepDeg(0, 1, 90), 90, "a flight's step is a quarter");
    near(s.turnStepDeg(30, -1, 90), -30, "and a room with a flight comes square before it turns by quarters");
    assert(s.TURN_STEP_DEG === 15, "the step asked for is 15 degrees");
  });

  test("a room's frame is the way its walls run, to the nearest quarter", () => {
    const sk = bedroomSketch(s);
    near(s.roomFrameDeg(byId(sk, "bed")), 0, "square to the page");
    near(s.roomFrameDeg(byId(turnBy(sk, "bed", 15), "bed")), 15, "turned 15");
    // The diagonal is always read as 45, never as -45: the rounding a turn leaves must not decide
    // which way round a room is.
    assert(s.roomFrameDeg(byId(turnBy(sk, "bed", 15, 3), "bed")) === 45, "turned 45 reads exactly 45");
    assert(s.roomFrameDeg(byId(turnBy(sk, "bed", -15, 3), "bed")) === 45, "and so does turned -45");
    near(s.roomFrameDeg(byId(turnBy(sk, "bed", 15, 4), "bed")), -30, "turned 60 reads as -30: a rectangle has no way round", 1e-6);
    near(s.roomFrameDeg(byId(turnBy(sk, "bed", -15, 2), "bed")), -30, "anticlockwise");
  });

  // The review of 2026-09-30: three walls square to the page and one longer wall, 22'4", sloping at
  // 26.57 degrees. Read by its longest wall, it was a room turned 26.57.
  const slopedQuad = () => room("quad", [[0, 0], [240, 0], [240, 120], [0, 240]]);
  // Two walls square to the page and two longer ones sloping the same way: the slopes are the most
  // wall, and still not what the room is squared to.
  const parallelogram = () => room("para", [[0, 0], [120, 0], [360, 120], [240, 120]]);
  /** What one press of ↻ (+1) or ↺ (-1) does, exactly as the editor works it out. */
  const press = (sketch, id, direction) => {
    const deg = t.roomTurnForPress(sketch, id, direction);
    const turned = t.turnRoomInSketch(sketch, id, deg);
    if (!turned) throw new Error(`the press on ${id} was refused`);
    return { deg, sketch: turned.sketch };
  };

  test("a room with a long sloping wall is framed by the walls square to the page, not by the slope", () => {
    near(s.roomFrameDeg(slopedQuad()), 0, "the quadrilateral from the review");
    near(s.roomFrameDeg(parallelogram()), 0, "and the parallelogram, whose slopes are most of its walls");
    // A scan crooked everywhere: the walls square to each other decide, not the longest one.
    const crooked = s.turnRoomAbout(slopedQuad(), 3.2, { x: 0, y: 0 });
    near(s.roomFrameDeg(crooked), 3.2, "a scan 3.2 degrees off reads 3.2, not its diagonal's -23.37", 1e-6);
  });

  test("a hand-drawn room with a long sloping wall turns exactly 15 a press, and back", () => {
    for (const make of [slopedQuad, parallelogram]) {
      const start = { rooms: [make()] };
      const id = start.rooms[0].id;
      const r = press(start, id, 1);
      near(r.deg, 15, `${id}: R turns it 15, as the button says`);
      const back = press(r.sketch, id, -1);
      near(back.deg, -15, `${id}: Shift+R turns it 15 back`);
      byId(back.sketch, id).vertices.forEach((v, i) => nearPoint(v, start.rooms[0].vertices[i], `${id}: back where it was, corner ${i}`, 1e-8));
      // All the way round, one press at a time, and every press exactly a step.
      let now = start;
      for (let i = 1; i <= 24; i++) {
        const step = press(now, id, -1);
        near(step.deg, -15, `${id}: press ${i} turns 15`, 1e-6);
        now = step.sketch;
      }
      byId(now, id).vertices.forEach((v, i) => nearPoint(v, start.rooms[0].vertices[i], `${id}: 24 presses round, corner ${i}`, 1e-6));
    }
  });

  test("a scan crooked everywhere still comes square with one press, by the walls square to each other", () => {
    const crooked = { rooms: [s.turnRoomAbout(slopedQuad(), 3.2, s.roomCentroid(slopedQuad()))] };
    const squared = press(crooked, "quad", -1);
    near(squared.deg, -3.2, "↺ takes it the short way onto square", 1e-6);
    const walls = s.wallsOf(byId(squared.sketch, "quad"));
    for (const k of [0, 1, 3]) {
      const w = walls[k];
      assert(Math.abs(w.x2 - w.x1) < 1e-6 || Math.abs(w.y2 - w.y1) < 1e-6, `wall ${k} is square to the page again`);
    }
    near(press(squared.sketch, "quad", 1).deg, 15, "and from there a press is 15");
  });

  test("the step is 15 for a room or a block, and a quarter for a flight or a room with one in it", () => {
    const sk = bedroomSketch(s);
    assert(t.roomTurnStepDeg(sk, "bed") === 15, "a bedroom");
    const withFlight = { rooms: s.withDerivedParents([box("hall", 0, 0, 20 * FT, 10 * FT), flight("st", 12, 12)]) };
    assert(byId(withFlight, "st").parentRoomId === "hall", "the fixture's flight is in the hall");
    assert(t.roomTurnStepDeg(withFlight, "st") === 90, "a flight turns by quarters");
    assert(t.roomTurnStepDeg(withFlight, "hall") === 90, "and so does the room it stands in");
  });

  /* Turning a room and what is part of it. */

  test("24 turns of 15 degrees bring everything back where it started, to a millionth of a pixel", () => {
    const sk = bedroomSketch(s);
    const round = turnBy(sk, "bed", 15, 24);
    for (const before of sk.rooms) {
      const after = byId(round, before.id);
      before.vertices.forEach((v, i) => nearPoint(after.vertices[i], v, `${before.id} corner ${i}`));
      assert(after.vertices.every((v, i) => v.id === before.vertices[i].id), `${before.id} keeps its corner ids in order`);
    }
    const isl = byId(round, "bed").freeCabinets[0];
    near(isl.x, 7 * FT, "island x");
    near(isl.y, 5 * FT, "island y");
    assert(isl.angleDeg === 0, `island back to no turn, got ${isl.angleDeg}`);
    const d = byId(round, "bed").symbols.find((x) => x.id === "d");
    assert(d.flipX === true && d.flipY === false, `the door is flipped as it was, got ${d.flipX}/${d.flipY}`);
    round.freeWalls[0].vertices.forEach((v, i) => nearPoint(v, sk.freeWalls[0].vertices[i], `partition end ${i}`));
    assert(byId(round, "hall") === byId(sk, "hall"), "a room not part of it is not touched at all");
    // And 24 the other way.
    const back = turnBy(sk, "bed", -15, 24);
    byId(back, "bed").vertices.forEach((v, i) => nearPoint(v, byId(sk, "bed").vertices[i], `anticlockwise corner ${i}`));
  });

  test("a turn back undoes a turn", () => {
    const sk = bedroomSketch(s);
    const there = turnBy(sk, "bed", 15);
    const back = turnBy(there, "bed", -15);
    byId(back, "bed").vertices.forEach((v, i) => nearPoint(v, byId(sk, "bed").vertices[i], `corner ${i}`, 1e-8));
    byId(back, "closet").vertices.forEach((v, i) => nearPoint(v, byId(sk, "closet").vertices[i], `closet corner ${i}`, 1e-8));
    const isl = byId(back, "bed").freeCabinets[0];
    near(isl.x, 7 * FT, "island x", 1e-8);
    assert(isl.angleDeg === 0, "island square again");
  });

  test("every wall keeps its length and the floor its area, at every step", () => {
    const sk = bedroomSketch(s);
    const lengths = s.wallsOf(byId(sk, "bed")).map((w) => w.lengthPx);
    const area = q.roomQuantities(byId(sk, "bed"), sk, q.DEFAULT_QUANTITY_OPTIONS).floorArea;
    let now = sk;
    for (let i = 1; i <= 24; i++) {
      now = turnBy(now, "bed", 15);
      const bed = byId(now, "bed");
      s.wallsOf(bed).forEach((w, k) => near(w.lengthPx, lengths[k], `step ${i}, wall ${k}`));
      near(q.roomQuantities(bed, now, q.DEFAULT_QUANTITY_OPTIONS).floorArea, area, `step ${i}, floor area`);
      assert(s.ensureClockwise(bed.vertices) === bed.vertices, `step ${i}: still wound clockwise`);
    }
  });

  test("doors, windows and cabinets stay on their walls: same wall, same place along it", () => {
    const sk = bedroomSketch(s);
    const turned = byId(turnBy(sk, "bed", 15, 5), "bed");
    for (const before of byId(sk, "bed").symbols) {
      const after = turned.symbols.find((x) => x.id === before.id);
      assert(after.wallId === before.wallId, `${before.id} on the same wall`);
      assert(after.t === before.t, `${before.id} at the same place along it`);
      near(s.symbolWidthPx(after, turned), s.symbolWidthPx(before, byId(sk, "bed")), `${before.id} the same width`);
    }
  });

  test("a door keeps its hinge and swing as its wall turns past 45 degrees", () => {
    const sk = bedroomSketch(s);
    const bed0 = byId(sk, "bed");
    const want = s.doorOrientation(bed0.symbols[0], bed0);
    let now = sk;
    for (let i = 1; i <= 24; i++) {
      now = turnBy(now, "bed", 15);
      const bed = byId(now, "bed");
      const got = s.doorOrientation(bed.symbols[0], bed);
      assert(got.hingeAtEnd === want.hingeAtEnd && got.swingReversed === want.swingReversed, `step ${i}: hinge ${got.hingeAtEnd}, swing ${got.swingReversed}`);
    }
  });

  test("the room turns about the middle of its floor, which stays put", () => {
    const sk = bedroomSketch(s);
    const centre = s.roomCentroid(byId(sk, "bed"));
    nearPoint(centre, { x: 100 + 8 * FT, y: 100 + 6 * FT }, "a rectangle's centroid is its middle");
    const turn = t.turnRoomInSketch(sk, "bed", 15);
    nearPoint(turn.centre, centre, "it turned about that point");
    nearPoint(s.roomCentroid(byId(turn.sketch, "bed")), centre, "and the floor's middle has not moved");
    // An L's middle is not its box's: the box centre of this one sits out in the notch.
    const ell = room("ell", [[0, 0], [240, 0], [240, 96], [96, 96], [96, 240], [0, 240]]);
    const c = s.roomCentroid(ell);
    assert(s.isInsideRoom(ell, c.x, c.y), "an L's centroid is on its floor");
    near(c.x, c.y, "symmetric about the diagonal");
  });

  test("the island turns about the same centre and by the same amount", () => {
    const sk = bedroomSketch(s);
    const bed0 = byId(sk, "bed");
    const centre = s.roomCentroid(bed0);
    const turned = byId(turnBy(sk, "bed", 15), "bed");
    const isl = turned.freeCabinets[0];
    assert(isl.angleDeg === 15, `turned 15 on its own angle, got ${isl.angleDeg}`);
    const was = s.blockCorners(bed0.freeCabinets[0], bed0);
    const is = s.blockCorners(isl, turned);
    was.forEach((p, i) => nearPoint(is[i], s.turnedPoint(p, centre, 15), `island corner ${i}`));
    assert(s.blockInsideRoom(isl, turned), "still inside the room");
  });

  test("the closet inside it goes round with it, about the bedroom's centre, and is still its closet", () => {
    const sk = bedroomSketch(s);
    assert(byId(sk, "closet").parentRoomId === "bed", "the fixture's closet is the bedroom's");
    const centre = s.roomCentroid(byId(sk, "bed"));
    const turned = turnBy(sk, "bed", 15);
    const closet = byId(turned, "closet");
    byId(sk, "closet").vertices.forEach((v, i) => nearPoint(closet.vertices[i], s.turnedPoint(v, centre, 15), `closet corner ${i}`));
    assert(closet.parentRoomId === "bed", "still nested");
    assert(s.isRoomInside(closet, byId(turned, "bed")), "and still inside it");
  });

  test("the partition off its wall goes round with it too, and a room turned on its own leaves the bedroom alone", () => {
    const sk = bedroomSketch(s);
    const centre = s.roomCentroid(byId(sk, "bed"));
    const turned = turnBy(sk, "bed", 15);
    sk.freeWalls[0].vertices.forEach((v, i) => nearPoint(turned.freeWalls[0].vertices[i], s.turnedPoint(v, centre, 15), `partition end ${i}`));
    // The closet turned by itself turns about its own middle, and carries nothing.
    const closetOnly = turnBy(sk, "closet", 15);
    assert(byId(closetOnly, "bed") === byId(sk, "bed"), "the bedroom is untouched");
    assert(closetOnly.freeWalls[0] === sk.freeWalls[0], "and so is its partition");
    nearPoint(s.roomCentroid(byId(closetOnly, "closet")), s.roomCentroid(byId(sk, "closet")), "the closet turned about its own middle");
  });

  test("a quarter turn is exact: a square room comes back square to the page, walls exactly across and down", () => {
    const sk = bedroomSketch(s);
    const quarter = byId(turnBy(sk, "bed", 15, 6), "bed");
    assert(s.wallsOf(quarter).every((w) => w.x1 === w.x2 || w.y1 === w.y2), `six turns of 15 leave every wall exactly square: ${quarter.vertices.map((v) => `${v.x},${v.y}`).join(" ")}`);
    const b = s.roomBounds(quarter);
    near(b.width, 12 * FT, "now 12' across");
    near(b.height, 16 * FT, "and 16' down");
  });

  /* Flights. */

  test("a flight turned by the turn buttons turns a quarter, exactly as its own rotation does", () => {
    const st = flight("st", 100, 100);
    const sk = { rooms: [st] };
    const turned = byId(turnBy(sk, "st", 90), "st");
    const own = s.rotateStairs(st);
    assert(turned.stairs.orientation === 90, `pointing down the page, got ${turned.stairs.orientation}`);
    turned.vertices.forEach((v, i) => nearPoint(v, own.vertices[i], `corner ${i}`, 1e-9));
    const back = byId(turnBy({ rooms: [turned] }, "st", -90), "st");
    assert(back.stairs.orientation === 0, "and back");
    back.vertices.forEach((v, i) => nearPoint(v, st.vertices[i], `back, corner ${i}`, 1e-9));
    // Less than a quarter is nothing: a flight can only stand square to the page.
    const nudged = byId(turnBy(sk, "st", 15), "st");
    assert(nudged.stairs.orientation === 0 && nudged.vertices.every((v, i) => v.x === st.vertices[i].x && v.y === st.vertices[i].y), "15 degrees leaves a flight as it was");
  });

  test("a room with a flight in it turns by quarters, and the flight comes round with it exactly", () => {
    const hall = box("hall", 0, 0, 20 * FT, 10 * FT);
    const sk = { rooms: s.withDerivedParents([hall, flight("st", 12, 12)]) };
    const centre = s.roomCentroid(hall);
    const turned = turnBy(sk, "hall", 90);
    const st = byId(turned, "st");
    assert(st.stairs.orientation === 90, `the flight turned a quarter with the room, got ${st.stairs.orientation}`);
    const b0 = s.roomBounds(byId(sk, "st"));
    const b1 = s.roomBounds(st);
    nearPoint({ x: b1.minX + b1.width / 2, y: b1.minY + b1.height / 2 }, s.turnedPoint({ x: b0.minX + b0.width / 2, y: b0.minY + b0.height / 2 }, centre, 90), "its middle went round with the room");
    const f0 = s.stairFlight(byId(sk, "st"));
    const f1 = s.stairFlight(st);
    near(f1.runFeet, f0.runFeet, "the same run");
    near(f1.widthFeet, f0.widthFeet, "the same width");
    assert(st.parentRoomId === "hall", "still in the hall");
    const round = turnBy(sk, "hall", 90, 4);
    byId(round, "st").vertices.forEach((v, i) => nearPoint(v, byId(sk, "st").vertices[i], `four quarters, flight corner ${i}`, 1e-9));
  });

  test("turned by less than a quarter, a flight keeps square to the page, rides along, and turns at the diagonal", () => {
    // Not what the buttons do to a room with a flight in it — they step by quarters — but what a
    // room a scan left off square does when it is brought square, and what the function promises.
    const hall = box("hall", 0, 0, 20 * FT, 20 * FT);
    const sk = { rooms: s.withDerivedParents([hall, flight("st", 48, 96)]) };
    const centre = s.roomCentroid(hall);
    const b0 = s.roomBounds(byId(sk, "st"));
    const middle0 = { x: b0.minX + b0.width / 2, y: b0.minY + b0.height / 2 };
    let now = sk;
    const orientations = [];
    for (let i = 1; i <= 6; i++) {
      now = turnBy(now, "hall", 15);
      const st = byId(now, "st");
      assert(onAxes(st), `step ${i}: the flight is square to the page`);
      const b = s.roomBounds(st);
      nearPoint({ x: b.minX + b.width / 2, y: b.minY + b.height / 2 }, s.turnedPoint(middle0, centre, 15 * i), `step ${i}: its middle rode along`, 1e-6);
      orientations.push(st.stairs.orientation);
    }
    assert(orientations.join(",") === "0,0,90,90,90,90", `turns a quarter once, at 45: ${orientations.join(",")}`);
    for (let i = 0; i < 6; i++) now = turnBy(now, "hall", -15);
    byId(now, "st").vertices.forEach((v, i) => nearPoint(v, byId(sk, "st").vertices[i], `back where it stood, corner ${i}`, 1e-6));
    assert(byId(now, "st").stairs.orientation === 0, "and pointing the way it did");
  });

  /* Blocks. */

  test("a block in open floor turns 15 degrees about its own middle", () => {
    const r = box("r", 0, 0, 20 * FT, 16 * FT);
    const b = block("b", 7 * FT, 6 * FT, 6, 3);
    const turned = s.turnBlock(b, r, 15);
    assert(turned.angleDeg === 15, "15 on its angle");
    assert(turned.x === b.x && turned.y === b.y, "and nothing else moved: it turns about its middle");
    nearPoint(middleOf(s.blockCorners(turned, r)), middleOf(s.blockCorners(b, r)), "same middle");
    const round = [...Array(24)].reduce((acc) => s.turnBlock(acc, r, 15), b);
    assert(round.angleDeg === 0, `24 steps come round to none, got ${round.angleDeg}`);
    assert(s.turnBlock(s.turnBlock(b, r, 15), r, -15).angleDeg === 0, "and a turn back undoes one");
  });

  test("a block against a wall is turned and nudged back off the wall its corner swung through", () => {
    const r = box("r", 0, 0, 20 * FT, 16 * FT);
    const peninsula = block("p", 7 * FT, 0, 6, 3); // flush against the top wall
    const turned = s.turnBlock(peninsula, r, 15);
    assert(turned !== null, "it turns");
    assert(s.blockInsideRoom(turned, r), "inside the room");
    assert(turned.angleDeg === 15, "by 15");
    const top = Math.min(...s.blockCorners(turned, r).map((p) => p.y));
    near(top, 0, "and brought back to touch the wall it stood against, not left off it", 1);
    assert(Math.hypot(turned.x - peninsula.x, turned.y - peninsula.y) < 3 * FT, "moving no further than it had to");
  });

  test("a peninsula flush on a wall, turned and turned back, is flush on it again", () => {
    // The review of 2026-09-30: R then Shift+R left this one 9.2 px off its wall and touching nothing.
    const r = box("r", 0, 0, 20 * FT, 16 * FT);
    const peninsula = block("p", 7 * FT, 0, 6, 3);
    const contacts = JSON.stringify(s.blockWallContacts(peninsula, r));
    assert(contacts === JSON.stringify([{ wallId: "r-v0", feet: 6 }]), `the fixture is flush on the top wall: ${contacts}`);
    const pressBlock = (b, direction) => s.turnBlock(b, r, s.turnStepDeg(s.blockAngleDeg(b), direction));
    const back = pressBlock(pressBlock(peninsula, 1), -1);
    assert(back.angleDeg === 0, "square again");
    assert(back.x === peninsula.x && back.y === peninsula.y, `exactly where it stood: ${back.x},${back.y}`);
    assert(JSON.stringify(s.blockWallContacts(back, r)) === contacts, "and against the same wall, all along its back");
    // Round to 45 and back a press at a time, touching the wall at every step.
    let now = peninsula;
    for (const direction of [1, 1, 1, -1, -1, -1]) {
      now = pressBlock(now, direction);
      near(Math.min(...s.blockCorners(now, r).map((p) => p.y)), 0, `at ${now.angleDeg}: still on the wall`, 1e-6);
    }
    assert(now.x === peninsula.x && now.y === peninsula.y && now.angleDeg === 0, `45 and back: ${now.x},${now.y} at ${now.angleDeg}`);
    // Tucked in the corner, against two walls: kept against both, going and coming back.
    const corner = block("c", 0, 0, 6, 3);
    let c = corner;
    for (const direction of [1, 1, -1, -1]) {
      c = pressBlock(c, direction);
      const pts = s.blockCorners(c, r);
      near(Math.min(...pts.map((p) => p.x)), 0, `at ${c.angleDeg}: on the left wall`, 1e-6);
      near(Math.min(...pts.map((p) => p.y)), 0, `at ${c.angleDeg}: on the top wall`, 1e-6);
    }
    assert(c.x === 0 && c.y === 0 && c.angleDeg === 0, `back in the corner: ${c.x},${c.y}`);
    // In a room turned 15, flush on its turned wall: the same, square to that wall.
    const r15 = s.turnRoomAbout({ ...r, freeCabinets: [peninsula] }, 15, s.roomCentroid(r));
    const p15 = r15.freeCabinets[0];
    const c15 = s.blockWallContacts(p15, r15);
    assert(c15.length === 1 && c15[0].wallId === "r-v0" && Math.abs(c15[0].feet - 6) < 1e-6, `turned with its room, still flush: ${JSON.stringify(c15)}`);
    const back15 = s.turnBlock(s.turnBlock(p15, r15, 15), r15, -15);
    nearPoint(back15, p15, "turned and back in the turned room, where it stood", 1e-8);
    const again = s.blockWallContacts(back15, r15);
    assert(again.length === 1 && again[0].wallId === "r-v0" && Math.abs(again[0].feet - 6) < 1e-6, `and flush on the same wall: ${JSON.stringify(again)}`);
    // Flush along a wall a break has split in two: one wall to the block.
    const split = room("split", [[0, 0], [96, 0], [240, 0], [240, 192], [0, 192]]);
    const across = block("a", 60, 0, 6, 3); // its back runs over the break at x = 96
    const splitBack = s.turnBlock(s.turnBlock(across, split, 15), split, -15);
    assert(splitBack.x === across.x && splitBack.y === across.y, `across the break, back where it stood: ${splitBack.x},${splitBack.y}`);
  });

  test("a block turned back within a run of presses goes back to exactly where it stood", () => {
    // An island a foot off the counter, turned 30: the turn pushes it off the wall it swings into,
    // and the drawing alone cannot say it stood a foot off. The editor's run of presses can.
    const r = box("r", 0, 0, 20 * FT, 16 * FT);
    const island = block("i", 7 * FT, 1 * FT, 6, 3);
    const pressRun = (state, direction) => {
      const out = t.turnBlockInRun(state.run, state.block, r, s.turnStepDeg(s.blockAngleDeg(state.block), direction));
      if (!out) throw new Error("a press was refused");
      return out;
    };
    let state = { run: null, block: island };
    for (const direction of [1, 1]) state = pressRun(state, direction);
    assert(state.block.angleDeg === 30, "turned 30");
    near(Math.min(...s.blockCorners(state.block, r).map((p) => p.y)), 0, "pushed off the wall it swung into", 1);
    for (const direction of [-1, -1]) state = pressRun(state, direction);
    assert(state.block === island, `the island as it was, a foot off the wall: ${state.block.x},${state.block.y} at ${state.block.angleDeg}`);
    // Worked out twice from the same block, as React may do with an update, it comes out the same.
    const once = pressRun(state, 1);
    const twice = pressRun({ run: once.run, block: state.block }, 1);
    assert(JSON.stringify(once) === JSON.stringify(twice), "the same press twice is the same press");
    // Moved in between, it is a new run: the turn back is `turnBlock`'s, from where it now is.
    const there = pressRun(pressRun(state, 1), 1);
    const moved = { ...there.block, x: there.block.x + 12 };
    const after = pressRun({ run: there.run, block: moved }, -1);
    assert(after.block.x !== island.x || after.block.y !== island.y, "a block moved since is not put back where it was before the move");
    assert(after.run.steps.length === 2, `a new run starts from the moved block (${after.run.steps.length} steps)`);
  });

  test("the sketch data measures an island from the room's own walls, turned or not", () => {
    const sk = bedroomSketch(s);
    const island = (sketch) => s.sketchOutput(sketch).find((r) => r.name === "bed").freeCabinets[0];
    const square = island(sk);
    assert(square.fromLeftFeet === 7 && square.fromTopFeet === 5, `square to the page, as it always was: ${square.fromLeftFeet}, ${square.fromTopFeet}`);
    // Up to the diagonal either way. Past it the room reads as turned the other way from a quarter
    // turn — a rectangle has no way round — and its left wall is the one that is then on the left.
    for (const [deg, times] of [[15, 1], [15, 2], [15, 3], [-15, 1], [-15, 2]]) {
      const turned = island(turnBy(sk, "bed", deg, times));
      assert(turned.fromLeftFeet === 7 && turned.fromTopFeet === 5, `turned ${deg * times}: ${turned.fromLeftFeet}, ${turned.fromTopFeet}`);
    }
  });

  test("a block with no room to turn where it stands is refused, not squeezed", () => {
    const nook = box("n", 0, 0, 6 * FT + 2, 3 * FT + 2); // an island that just fits
    const b = block("b", 1, 1, 6, 3);
    assert(s.turnBlock(b, nook, 15) === null, "nothing fits a 6' x 3' turned 15 degrees in a 6'2\" x 3'2\" space");
  });

  test("a turned block dragged to its room's turned wall lands flush against it", () => {
    const r0 = box("r", 0, 0, 20 * FT, 16 * FT);
    const r = s.turnRoomAbout({ ...r0, freeCabinets: [block("b", 7 * FT, 6 * FT, 6, 3)] }, 15, s.roomCentroid(r0));
    const b = r.freeCabinets[0];
    assert(b.angleDeg === 15, "the block turned with the room");
    // Towards the top wall, stopping 4 px short of it along the wall's normal.
    const top = s.wallById(r, "r-v0");
    const inward = { x: -(top.y2 - top.y1) / top.lengthPx, y: (top.x2 - top.x1) / top.lengthPx };
    const back = s.blockCorners(b, r)[0];
    const gap = (back.x - top.x1) * inward.x + (back.y - top.y1) * inward.y;
    const travel = gap - 4;
    const moved = s.moveFreeCabinet(b, r, b.x - inward.x * travel, b.y - inward.y * travel);
    const contacts = s.blockWallContacts(moved, r);
    const onTop = contacts.find((c) => c.wallId === "r-v0");
    assert(onTop !== undefined, `snapped flush to the turned top wall: ${JSON.stringify(contacts)}`);
    near(onTop.feet, 6, "along its whole 6' back", 0.01);
  });

  test("a block turned a quarter is kept in the room by where it really is, not by its unturned box", () => {
    const r = box("r", 0, 0, 20 * FT, 16 * FT);
    const b = block("b", 7 * FT, 6 * FT, 6, 3, { angleDeg: 90 }); // 3' across, 6' down as drawn
    // Dragged well past the right wall: it should come to rest against it.
    const moved = s.moveFreeCabinet(b, r, 30 * FT, 6 * FT);
    assert(moved !== b, "the move is not refused outright");
    const right = Math.max(...s.blockCorners(moved, r).map((p) => p.x));
    near(right, 20 * FT, "its right side is on the right wall", 1e-6);
    assert(s.blockInsideRoom(moved, r), "and it is inside");
  });

  test("resizing a turned block keeps its back-left corner still", () => {
    const r = box("r", 0, 0, 20 * FT, 16 * FT);
    const b = block("b", 7 * FT, 6 * FT, 6, 3, { angleDeg: 30 });
    const corner = s.blockCorners(b, r)[0];
    const grown = s.withFreeCabinetSizePx(b, r, 7 * FT, 3 * FT);
    near(grown.widthFeet, 7, "it grew");
    nearPoint(s.blockCorners(grown, r)[0], corner, "and the corner it grows from did not move", 1e-9);
    // Square to the page, nothing changes about how it always worked.
    const square = block("q", 7 * FT, 6 * FT, 6, 3);
    const squareGrown = s.withFreeCabinetSizePx(square, r, 7 * FT, 3 * FT);
    assert(squareGrown.x === square.x && squareGrown.y === square.y, "a square block keeps its stored corner exactly");
  });

  /* Editing a turned room as if it were square. */

  test("a corner of a turned rectangle drags as a rectangle's does: square, opposite corner still", () => {
    const r0 = box("r", 0, 0, 16 * FT, 12 * FT);
    const r = s.turnRoomAbout(r0, 30, s.roomCentroid(r0));
    const corner = r.vertices[2];
    const target = { x: corner.x + 10, y: corner.y + 14 };
    const moved = s.moveVertex(r, corner.id, target.x, target.y);
    assert(moved !== r, "the drag is taken");
    nearPoint(moved.vertices[0], r.vertices[0], "the opposite corner has not moved", 1e-9);
    nearPoint(moved.vertices[2], target, "the dragged corner is where it was dragged", 1e-6);
    const walls = s.wallsOf(moved);
    for (let i = 0; i < 4; i++) {
      const a = walls[i];
      const b = walls[(i + 1) % 4];
      const dot = ((a.x2 - a.x1) * (b.x2 - b.x1) + (a.y2 - a.y1) * (b.y2 - b.y1)) / (a.lengthPx * b.lengthPx);
      near(dot, 0, `corner ${i + 1} is still square`, 1e-9);
    }
    near(s.roomFrameDeg(moved), 30, "still turned 30", 1e-6);
  });

  test("a wall dragged in a turned room snaps to the room's own lines, as it does in a square one", () => {
    // An L, whose inside wall is pulled to within 6 px of the line of the corner beyond it: square
    // to the page it latches onto that line and the jog folds away. Turned 30 degrees, the same
    // drag must do the same thing, turned — not snap to a page axis nothing in the room runs along.
    const ell = room("ell", [[0, 0], [240, 0], [240, 96], [126, 96], [126, 192], [0, 192]]);
    const right = "ell-v3"; // (126,96) -> (126,192)
    const pull = (r, dx, dy) => s.snapWallToNeighbours(s.dragWall(r, right, dx, dy), right);
    const square = pull(ell, 108, 0);
    const centre = s.roomCentroid(ell);
    const turnedEll = s.turnRoomAbout(ell, 30, centre);
    const drag = s.turnedPoint({ x: 108, y: 0 }, { x: 0, y: 0 }, 30);
    const turned = pull(turnedEll, drag.x, drag.y);
    assert(square.vertices.length === turned.vertices.length, `the same outline: ${square.vertices.length} corners vs ${turned.vertices.length}`);
    for (const v of square.vertices) {
      const w = turned.vertices.find((x) => x.id === v.id);
      assert(w !== undefined, `corner ${v.id} is in both`);
      nearPoint(w, s.turnedPoint(v, centre, 30), `corner ${v.id} is the square one turned`, 1e-6);
    }
  });

  /* What the room is priced and drawn by. */

  test("a sloped ceiling prices the same however the room is turned, and rises the same way in 3D", () => {
    const shed = box("shed", 0, 0, 20 * FT, 16 * FT, { ceilingType: "sloped", ceilingPeakFeet: 10 });
    const before = q.roomQuantities(shed, { rooms: [shed] }, q.DEFAULT_QUANTITY_OPTIONS);
    const centre = s.roomCentroid(shed);
    for (const deg of [15, 30, 45, 90, 180, 285]) {
      const turned = s.turnRoomAbout(shed, deg, centre);
      const after = q.roomQuantities(turned, { rooms: [turned] }, q.DEFAULT_QUANTITY_OPTIONS);
      near(after.ceilingArea, before.ceilingArea, `${deg}: ceiling area`);
      near(after.wallArea, before.wallArea, `${deg}: wall area`);
      near(after.floorArea, before.floorArea, `${deg}: floor area`);
      const was = d3.ceilingModel(shed);
      const is = d3.ceilingModel(turned);
      for (const p of [{ x: 12, y: 12 }, { x: 200, y: 40 }, { x: 120, y: 150 }]) {
        const tp = s.turnedPoint(p, centre, deg);
        near(is.at(tp.x, tp.y), was.at(p.x, p.y), `${deg}: the ceiling over (${p.x},${p.y}) is as high as it was`);
      }
    }
    // Untouched by any of this: a room nobody turned has no direction written on it.
    assert(shed.ceilingRiseDeg === undefined, "the fixture never had one");
    near(s.ceilingSpanPx(shed), 20 * FT, "and its span is its larger side, as always");
  });

  test("the 3D view builds the turned island turned, where the plan draws it", () => {
    const sk = bedroomSketch(s);
    const turned = turnBy(sk, "bed", 15, 2);
    const bed = byId(turned, "bed");
    const model = d3.houseModel(turned);
    const corners = s.blockCorners(bed.freeCabinets[0], bed);
    const prism = model.prisms.find((p) => p.kind === "cabinet" && p.roomId === "bed" && p.points.length === corners.length && corners.every((c, i) => Math.abs(p.points[i].x - c.x / FT) < 1e-9 && Math.abs(p.points[i].z - c.y / FT) < 1e-9));
    assert(prism !== undefined, "a cabinet prism stands exactly on the island's turned corners");
    const walls = (mdl) => mdl.prisms.filter((p) => p.kind === "wall").length;
    assert(walls(model) === walls(d3.houseModel(sk)), "and the room stands the same walls it did");
  });

  test("the paint on a turned floor goes round with the floor", () => {
    const sk = bedroomSketch(s);
    const bed = byId(sk, "bed");
    // A 3' x 2' wet patch near the bedroom's far corner.
    const cells = [];
    const size = m.cellSizePx();
    for (let col = 44; col < 56; col++) for (let row = 30; row < 38; row++) cells.push(m.cellKey(col, row));
    const data = { wallReadings: [], floorCells: cells, ceilingCells: [], insetsOver18Inches: 0 };
    const worldOf = (r, keys) => {
      const b = s.roomBounds(r);
      return middleOf(keys.map((k) => m.parseCellKey(k)).map(({ col, row }) => ({ x: b.minX + (col + 0.5) * size, y: b.minY + (row + 0.5) * size })));
    };
    for (const deg of [15, 45, 90]) {
      const turn = t.turnRoomInSketch(sk, "bed", deg);
      const moved = turn.moved.find((x) => x.before.id === "bed");
      const out = m.turnedRoomMoisture(data, moved.before, moved.after, moved.motion);
      const ratio = out.floorCells.length / cells.length;
      assert(ratio > 0.85 && ratio < 1.15, `${deg}: about the same area painted (${out.floorCells.length} cells for ${cells.length})`);
      nearPoint(worldOf(moved.after, out.floorCells), s.turnedPoint(worldOf(bed, cells), turn.centre, deg), `${deg}: and in the same place on the floor`, size * 1.5);
      assert(m.pruneMoisture({ rooms: { bed: out } }, turn.sketch).rooms.bed.floorCells.length === out.floorCells.length, `${deg}: none of it off the floor`);
    }
    assert(m.turnedRoomMoisture({ ...data, floorCells: [] }, bed, bed, { deg: 15, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }).floorCells.length === 0, "no paint is no work");
  });

  return { passed, failures };
}

/* ── standalone ───────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runTurnChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
