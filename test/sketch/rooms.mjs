/**
 * Where a new room lands, and how a flight of stairs turns.
 *
 *   node test/sketch/rooms.mjs        (also runs as part of npm run test:sketch)
 *
 * Both from the field on the same day: "when stairs rotate they are just rotating the treads — we
 * should rotate the full thing", and "when adding another room it can get lost if you are zoomed in
 * working on one already". Pure geometry, so this runs in Node rather than in the browser suite.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "room-tests-"));
  const entry = join(outDir, "entry.ts");
  const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
  writeFileSync(
    entry,
    `export * from "${lib("sketch.ts")}";\nexport * from "${lib("roomPlacement.ts")}";\nexport * from "${lib("sketchQuantities.ts")}";\nexport * from "${lib("scopeMarks.ts")}";\nexport { findDerived } from "${lib("gapCheck.ts")}";\n`,
  );
  const outfile = join(outDir, "sketch.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

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

/** A box at (x, y), w x h pixels, clockwise. */
const box = (x, y, w, h, extra = {}) => room([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], extra);

/** A 600 x 460 canvas at 100% looking at the origin. */
const viewport = (over = {}) => ({ view: { x: 0, y: 0, scale: 1 }, width: 600, height: 460, ...over });

/* ── the checks ───────────────────────────────────────────────────────────────────────────────── */

export async function runRoomChecks() {
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
  const b = (r) => s.roomBounds(r);

  /* Turning a flight. */

  test("a quarter turn turns the whole flight, not just its treads: 11' x 3' stays 11' long", () => {
    const flight = s.newStairRoom(100, 100); // 132 x 36
    const turned = s.rotateStairs(flight);
    assert(turned.stairs.orientation === 90, `direction of travel turned, got ${turned.stairs.orientation}`);
    const bounds = b(turned);
    near(bounds.width, 36, "now 3' across");
    near(bounds.height, 132, "and 11' tall");
    const f = s.stairFlight(turned);
    near(f.runFeet, 11, "the run is still 11'");
    near(f.widthFeet, 3, "and the flight is still 3' wide");
    assert(f.treadCount === s.stairFlight(flight).treadCount, "same number of treads");
  });

  test("it turns about its centre, so it comes to rest across where it stood", () => {
    const flight = s.newStairRoom(100, 100);
    const before = b(flight);
    const after = b(s.rotateStairs(flight));
    near(after.minX + after.width / 2, before.minX + before.width / 2, "centre x");
    near(after.minY + after.height / 2, before.minY + before.height / 2, "centre y");
  });

  test("four quarter turns bring it back exactly, and a turn the other way undoes one", () => {
    const flight = s.newStairRoom(100, 100);
    const around = s.rotateStairs(s.rotateStairs(s.rotateStairs(s.rotateStairs(flight))));
    assert(around.vertices.every((v, i) => v.x === flight.vertices[i].x && v.y === flight.vertices[i].y), "back where it started, to the pixel");
    const back = s.rotateStairs(s.rotateStairs(flight), -1);
    assert(back.vertices.every((v, i) => v.x === flight.vertices[i].x && v.y === flight.vertices[i].y) && back.stairs.orientation === 0, "a turn back undoes a turn");
  });

  test("the corners keep their ids and their clockwise order, so nothing on the walls moves", () => {
    const flight = s.newStairRoom(100, 100);
    const turned = s.rotateStairs(flight);
    assert(turned.vertices.every((v, i) => v.id === flight.vertices[i].id), "same corners, same order");
    // `ensureClockwise` hands back the very same array when the winding is already clockwise.
    assert(s.ensureClockwise(turned.vertices) === turned.vertices, "still wound clockwise");
  });

  test("an island turns with the flight, swapping its width and depth", () => {
    const flight = { ...s.newStairRoom(100, 100), freeCabinets: [{ id: "i", x: 10, y: 6, widthPx: 24, depthPx: 12, widthFeet: 2, depthFeet: 1, label: "Block", tier: "base" }] };
    const turned = s.rotateStairs(flight);
    const [island] = turned.freeCabinets;
    near(island.widthPx, 12, "width is the old depth");
    near(island.depthPx, 24, "depth is the old width");
    near(island.widthFeet, 1, "in feet too");
    // The block's centre turned with the room: from bounds-relative (22, 12) in a 132 x 36 room...
    const bounds = b(turned);
    const cx = bounds.minX + island.x + island.widthPx / 2;
    const cy = bounds.minY + island.y + island.depthPx / 2;
    // ...about the room's centre (166, 118): (122, 112) -> (172, 74).
    near(cx, 172, "island centre x");
    near(cy, 74, "island centre y");
  });

  test("a room that is not a flight does not turn", () => {
    const r = box(0, 0, 120, 60);
    assert(s.rotateStairs(r) === r, "unchanged");
  });

  /* What a new room is called. */

  test("new rooms are numbered on from the highest number in use, whatever else the plan holds", () => {
    assert(s.nextRoomName([]) === "Room 1", "an empty plan starts at 1");
    const named = (name) => ({ ...box(0, 0, 10, 10), name });
    assert(s.nextRoomName([named("Room 1"), named("Kitchen"), named("Stairs")]) === "Room 2", "only numbered names count");
    assert(s.nextRoomName([named("Room 1"), named("Room 5")]) === "Room 6", "one past the highest, not the count");
    assert(s.nextRoomName([named("room 3"), named(" Room 2 ")]) === "Room 4", "case and spaces do not matter");
    assert(s.nextRoomName([named("Room 2b"), named("Rooms 4"), named("")]) === "Room 1", "a number with letters after it is a name of its own");
    assert(s.nextRoomName([{ ...named("Room 7"), level: -1 }]) === "Room 8", "numbers are shared across storeys");
  });

  test("a pulled room is named on from the plan it joins", () => {
    const src = { ...box(0, 0, 240, 192, { id: "src" }), name: "Room 1" };
    const other = { ...box(400, 0, 100, 100, { id: "o" }), name: "Room 4" };
    const pulled = s.pullRoomFromWall(src, s.wallsOf(src)[2].id, 120, { obstacles: [], rooms: [src, other] });
    assert(pulled.name === "Room 5", `got "${pulled.name}"`);
  });

  /* Sub-rooms by choice. */

  test("the report: a closet pulled off the bedroom's wall can be made its sub-room, and stays one when dragged", () => {
    const bedroom = { ...box(0, 0, 240, 192, { id: "bed" }), name: "Bedroom" };
    const closet = { ...box(0, 192, 60, 40, { id: "cl" }), name: "Closet", chosenParentRoomId: "bed" };
    const derived = s.withDerivedParents([bedroom, closet]);
    assert(derived[1].parentRoomId === "bed", "the choice is the parent, outside or not");
    assert(!s.isRoomInside(closet, bedroom), "and it is not inside");
    // Dragged away and re-derived, as every move is: still the bedroom's.
    const moved = s.withDerivedParents([bedroom, s.translateRoom(derived[1], 500, 500)]);
    assert(moved[1].parentRoomId === "bed", "a chosen parent survives a move");
    assert(moved[0].parentRoomId === null, "the bedroom is nobody's");
  });

  test("a chosen parent is set aside while it is missing, on another storey, or would make a loop — never lost", () => {
    const bedroom = { ...box(0, 0, 240, 192, { id: "bed" }), name: "Bedroom" };
    const closet = { ...box(0, 192, 60, 40, { id: "cl" }), chosenParentRoomId: "bed" };
    const alone = s.withDerivedParents([closet]);
    assert(alone[0].parentRoomId === null && alone[0].chosenParentRoomId === "bed", "no bedroom on the plan: no parent, choice kept");
    const back = s.withDerivedParents([bedroom, ...alone]);
    assert(back[1].parentRoomId === "bed", "and it is honoured again the moment the bedroom is back — undo brings the link with it");
    const upstairs = s.withDerivedParents([{ ...bedroom, level: 1 }, closet]);
    assert(upstairs[1].parentRoomId === null, "another storey is not a parent");
    const a = { ...box(0, 0, 100, 100, { id: "a" }), chosenParentRoomId: "b" };
    const b = { ...box(300, 0, 100, 100, { id: "b" }), chosenParentRoomId: "a" };
    const loop = s.withDerivedParents([a, b]);
    assert(loop[0].parentRoomId === null && loop[1].parentRoomId === null, "a loop honours neither");
    const self = s.withDerivedParents([{ ...box(0, 0, 100, 100, { id: "me" }), chosenParentRoomId: "me" }]);
    assert(self[0].parentRoomId === null, "a room is not its own parent");
    // A ring of three honours none; a chain of three is honoured all the way, and the last of it
    // may be nobody's sub-room but the first's.
    const ring = s.withDerivedParents([
      { ...box(0, 0, 100, 100, { id: "a" }), chosenParentRoomId: "b" },
      { ...box(300, 0, 100, 100, { id: "b" }), chosenParentRoomId: "c" },
      { ...box(600, 0, 100, 100, { id: "c" }), chosenParentRoomId: "a" },
    ]);
    assert(ring.every((r) => r.parentRoomId === null), `a ring of three: ${ring.map((r) => r.parentRoomId)}`);
    const chainRooms = [
      { ...box(0, 0, 100, 100, { id: "a" }), chosenParentRoomId: "b" },
      { ...box(300, 0, 100, 100, { id: "b" }), chosenParentRoomId: "c" },
      box(600, 0, 100, 100, { id: "c" }),
    ];
    const chain = s.withDerivedParents(chainRooms);
    assert(chain.map((r) => r.parentRoomId).join(",") === "b,c,", `a chain of three: ${chain.map((r) => r.parentRoomId)}`);
    assert(s.possibleParents(chain[2], chain).length === 0, "the last of the chain may not be made a sub-room of anything above it");
  });

  test("a choice pointing up the drawing cannot close a loop through the rooms between", () => {
    // A big room chosen to be the sub-room of a small one drawn two rooms deep inside it:
    // A chooses B; B is drawn inside C; C is drawn inside A. Geometry taken all at once against
    // a snapshot made A -> B, B -> C, C -> A — a loop, flipping back on the next pass.
    const a = { ...box(0, 0, 400, 400, { id: "A" }), chosenParentRoomId: "B" };
    const c = box(50, 50, 200, 200, { id: "C" });
    const bb = box(80, 80, 40, 40, { id: "B" });
    const once = s.withDerivedParents([a, bb, c]);
    const links = (rs) => rs.map((r) => `${r.id}->${r.parentRoomId}`).join(" ");
    assert(links(once) === "A->B B->C C->null", `no loop: ${links(once)}`);
    const twice = s.withDerivedParents(once);
    assert(links(twice) === links(once), `and it holds still on the next pass: ${links(twice)}`);
  });

  test("a choice beats the drawing, and beats the old opt-out; the drawing still decides for the rest", () => {
    const big = box(0, 0, 240, 192, { id: "big" });
    const inside = box(10, 10, 60, 40, { id: "in" });
    const other = box(400, 0, 100, 100, { id: "other" });
    // Drawn inside `big`, chosen to be `other`'s: the choice wins.
    const chosen = s.withDerivedParents([big, { ...inside, chosenParentRoomId: "other", nestingOptOut: true }, other]);
    assert(chosen[1].parentRoomId === "other", `chosen over drawn and over opt-out, got ${chosen[1].parentRoomId}`);
    // Nothing chosen: drawn inside `big`, so `big`'s — as it always was.
    const plain = s.withDerivedParents([big, inside, other]);
    assert(plain[1].parentRoomId === "big", "derived when nothing is chosen");
    // Opted out with nothing chosen: nobody's.
    const out = s.withDerivedParents([big, { ...inside, nestingOptOut: true }, other]);
    assert(out[1].parentRoomId === null, "the explicit no still holds");
  });

  test("a big room chosen to be its own small room's sub-room is not, in the same pass, made that room's parent", () => {
    // `small` is drawn inside `big`; the PM makes `big` a sub-room of `small` (odd, but allowed).
    // The drawing would make `small` a sub-room of `big` — a loop — so it must not.
    const big = { ...box(0, 0, 240, 192, { id: "big" }), chosenParentRoomId: "small" };
    const small = box(10, 10, 60, 40, { id: "small" });
    const derived = s.withDerivedParents([big, small]);
    assert(derived[0].parentRoomId === "small", "the choice holds");
    assert(derived[1].parentRoomId === null, "and the drawing does not close the loop");
  });

  test("the list of possible parents: the others on this storey that are not already under this one", () => {
    const bed = box(0, 0, 240, 192, { id: "bed" });
    const closet = { ...box(10, 10, 60, 40, { id: "cl" }), parentRoomId: "bed" };
    const shelf = { ...box(400, 0, 20, 20, { id: "shelf" }), chosenParentRoomId: "cl" };
    const hall = box(300, 0, 100, 100, { id: "hall" });
    const up = { ...box(0, 0, 100, 100, { id: "up" }), level: 1 };
    const ids = s.possibleParents(bed, [bed, closet, shelf, hall, up]).map((r) => r.id);
    assert(ids.join(",") === "hall", `not itself, not its closet, not the shelf under the closet, not upstairs: ${ids}`);
    const forCloset = s.possibleParents(closet, [bed, closet, shelf, hall, up]).map((r) => r.id);
    assert(forCloset.join(",") === "bed,hall", `the closet may have the bedroom or the hall: ${forCloset}`);
  });

  test("a sub-room beside its parent hides none of the parent's wall, and takes nothing off its floor", () => {
    const bedroom = { ...box(0, 0, 240, 192, { id: "bed" }), name: "Bedroom" };
    const beside = { ...box(60, 192, 60, 40, { id: "cl" }), name: "Closet", chosenParentRoomId: "bed" };
    const rooms = s.withDerivedParents([bedroom, beside]);
    const bottom = s.wallsOf(rooms[0])[2]; // (240,192) -> (0,192): the wall the closet stands against
    const runs = s.exposedWallRuns(rooms[0], bottom.id, rooms);
    assert(runs.length === 1 && runs[0][0] === 0 && runs[0][1] === 1, `the whole wall is still the bedroom's: ${JSON.stringify(runs)}`);
    assert(s.wallDimensions(rooms[0], bottom, rooms).length === 1, "one label, the full 20'");
    assert(!s.isNestedWithin(rooms[1], rooms[0]), "linked, not within");
    const q = s.roomQuantities(rooms[0], { rooms }, s.DEFAULT_QUANTITY_OPTIONS);
    near(q.floorArea, 320, "20' x 16' — the closet's floor is its own");
    near(q.ceilingArea, 320, "and so is its ceiling");
    // The same closet drawn INSIDE the bedroom, linked the same way: now it does.
    const within = { ...beside, vertices: box(60, 152, 60, 40).vertices };
    const nested = s.withDerivedParents([bedroom, within]);
    assert(s.isNestedWithin(nested[1], nested[0]), "within");
    assert(s.exposedWallRuns(nested[0], bottom.id, nested).length === 2, "the closet's share of the wall is hidden from the bedroom");
    near(s.roomQuantities(nested[0], { rooms: nested }, s.DEFAULT_QUANTITY_OPTIONS).floorArea, 320 - (60 * 40) / 144, "and its floor comes out of the bedroom's");
  });

  test("the summary says sub-room of, which is true beside the parent as well as inside it", () => {
    const bedroom = { ...box(0, 0, 240, 192, { id: "bed" }), name: "Bedroom" };
    const beside = { ...box(60, 192, 60, 40, { id: "cl" }), name: "Closet", chosenParentRoomId: "bed" };
    const text = s.sketchSummaryText({ rooms: s.withDerivedParents([bedroom, beside]) });
    assert(text.includes("Closet — sub-room of Bedroom"), `got:\n${text}`);
  });

  /* Where a new room lands. */

  test("a new room lands beside the selected room — to its right first", () => {
    const anchor = box(100, 100, 144, 144, { id: "a" });
    const spot = s.placeNewRoom({ rooms: [anchor], anchor, width: 144, height: 144, gap: 30, viewport: viewport() });
    assert(spot.x === 100 + 144 + 30 && spot.y === 100, `expected to the right, got ${spot.x},${spot.y}`);
    assert(spot.visible, "and on screen");
  });

  test("when the right is taken, below; then left; then above", () => {
    const anchor = box(200, 100, 144, 144, { id: "a" });
    const right = box(374, 100, 144, 144, { id: "r" });
    const below = s.placeNewRoom({ rooms: [anchor, right], anchor, width: 144, height: 144, gap: 30, viewport: viewport({ height: 600 }) });
    assert(below.x === 200 && below.y === 274, `expected below, got ${below.x},${below.y}`);
    const under = box(200, 274, 144, 144, { id: "u" });
    const left = s.placeNewRoom({ rooms: [anchor, right, under], anchor, width: 144, height: 144, gap: 30, viewport: viewport({ height: 600 }) });
    assert(left.x === 200 - 30 - 144 && left.y === 100, `expected left, got ${left.x},${left.y}`);
  });

  test("beside the selected room only when that spot is on screen; otherwise anywhere on screen", () => {
    // The anchor sits at the right edge of the view: its right side is off screen, below fits.
    const anchor = box(400, 40, 144, 144, { id: "a" });
    const spot = s.placeNewRoom({ rooms: [anchor], anchor, width: 144, height: 144, gap: 30, viewport: viewport() });
    assert(spot.visible, "on screen");
    assert(spot.x === 400 && spot.y === 214, `expected below, got ${spot.x},${spot.y}`);
  });

  test("zoomed in on the far end of a plan, the new room still lands in view", () => {
    // Looking at world (1000..1400, 500..807) at 150% — the old scan from the origin would have put
    // the room a thousand pixels off screen.
    const view = { x: -1500, y: -750, scale: 1.5 };
    const anchor = box(1000, 500, 144, 144, { id: "a" });
    const spot = s.placeNewRoom({ rooms: [anchor], anchor, width: 144, height: 144, gap: 30, viewport: viewport({ view }) });
    assert(spot.visible, `expected on screen, got ${JSON.stringify(spot)}`);
    const shown = s.visibleWorld(viewport({ view }));
    assert(spot.x >= shown.minX && spot.x + 144 <= shown.maxX && spot.y >= shown.minY && spot.y + 144 <= shown.maxY, "wholly within the view");
    assert(spot.x === 1174 && spot.y === 500, `beside the room being worked on, got ${spot.x},${spot.y}`);
  });

  test("zoomed in too far for another room to fit on screen, it lands beside the room anyway and the view follows", () => {
    // Looking at world (1000..1300, 500..730) at 200%: no 12' x 12' fits beside a 12' x 12'.
    const view = { x: -2000, y: -1000, scale: 2 };
    const anchor = box(1000, 500, 144, 144, { id: "a" });
    const spot = s.placeNewRoom({ rooms: [anchor], anchor, width: 144, height: 144, gap: 30, viewport: viewport({ view }) });
    assert(!spot.visible && spot.x === 1174 && spot.y === 500, `expected beside, off screen — got ${JSON.stringify(spot)}`);
  });

  test("with no room selected, anywhere on screen that is clear", () => {
    const taken = box(30, 30, 144, 144, { id: "t" });
    const spot = s.placeNewRoom({ rooms: [taken], anchor: null, width: 144, height: 144, gap: 30, viewport: viewport() });
    assert(spot.visible, "on screen");
    const overlaps = spot.x < 30 + 144 + 30 && spot.x + 144 + 30 > 30 && spot.y < 30 + 144 + 30 && spot.y + 144 + 30 > 30;
    assert(!overlaps, `clear of the room already there, got ${spot.x},${spot.y}`);
  });

  test("a view too full for another room places it off screen and says so", () => {
    // A 300 x 200 view at 100%, holding one room that fills it.
    const full = box(0, 0, 280, 180, { id: "f" });
    const spot = s.placeNewRoom({ rooms: [full], anchor: full, width: 144, height: 144, gap: 30, viewport: viewport({ width: 300, height: 200 }) });
    assert(!spot.visible, "off screen");
    assert(spot.x === 280 + 30 && spot.y === 0, `beside the anchor all the same, got ${spot.x},${spot.y}`);
  });

  test("the view that shows a room puts it in the middle of the canvas at the same zoom", () => {
    const v = s.viewCentredOn({ x: 1000, y: 500, width: 144, height: 144 }, viewport({ view: { x: 0, y: 0, scale: 2 } }));
    assert(v.scale === 2, "zoom kept");
    // Centre (1072, 572) at scale 2 should land at the canvas centre (300, 230).
    near(v.x + 1072 * 2, 300, "x");
    near(v.y + 572 * 2, 230, "y");
  });

  /* Pulling a room off a wall. */

  const door = (wallId, t, extra = {}) => ({ id: "d", wallId, t, widthFraction: 0.25, widthFeet: 2.5, type: "door", doorType: "swing", leaves: "single", heightFeet: 6.67, flipX: false, flipY: false, ...extra });
  const windowOn = (wallId, t) => ({ id: "w", wallId, t, widthFraction: 0.25, widthFeet: 3, type: "window", heightFeet: 4, sillFeet: 3 });
  const cabinetOn = (wallId, t) => ({ id: "c", wallId, t, widthFraction: 0.25, widthFeet: 3, type: "cabinet", label: "Cabinet", tier: "base", depthFeet: 2, heightFeet: 3 });

  test("a room pulled off a wall shares that wall exactly and goes straight out from it", () => {
    const source = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(source)[2]; // runs (240,192) -> (0,192); outside is below
    const pulled = s.pullRoomFromWall(source, bottom.id, 120);
    assert(pulled && pulled.vertices.length === 4, "a four-cornered room");
    const bb = b(pulled);
    assert(bb.minX === 0 && bb.maxX === 240 && bb.minY === 192 && bb.maxY === 312, `bounds ${JSON.stringify(bb)}`);
    assert(s.ensureClockwise(pulled.vertices) === pulled.vertices, "wound clockwise");
    assert(pulled.ceilingHeightFeet === 8 && pulled.name === "Room 1" && pulled.stairs === null, "an ordinary room, named as new rooms are");
  });

  test("off an angled wall the new room keeps the wall's angle", () => {
    // A diamond: its lower-right wall runs from (240,120) to (120,240), outside is down and right.
    const diamond = room([[120, 0], [240, 120], [120, 240], [0, 120]], { id: "dia" });
    const wall = s.wallsOf(diamond)[1];
    const pulled = s.pullRoomFromWall(diamond, wall.id, 60);
    const corners = pulled.vertices.map((v) => [Math.round(v.x), Math.round(v.y)].join(","));
    assert(corners.includes("240,120") && corners.includes("120,240"), `shares both corners, got ${corners}`);
    // The far wall is 60 out along the outward normal (1/√2, 1/√2): (240+42, 120+42) and (120+42, 240+42).
    assert(corners.includes("282,162") && corners.includes("162,282"), `far corners 60 out along the wall's normal, got ${corners}`);
  });

  test("the doors and windows in the wall are seen from the new room, in the wall it shares; cabinets are not", () => {
    // One door, one symbol: the new room draws it, deducts it and can slide it, but never holds a
    // copy — a copy drifted from the door the first time either was moved.
    const source = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(source)[2];
    const other = s.wallsOf(source)[0];
    source.symbols = [door(bottom.id, 0.25), windowOn(bottom.id, 0.5), cabinetOn(bottom.id, 0.75), door(other.id, 0.5, { id: "far" })];
    const pulled = s.pullRoomFromWall(source, bottom.id, 120);
    assert(pulled.symbols.length === 0, `nothing of its own, got ${pulled.symbols.map((x) => x.type)}`);
    const shared = s.openingsSharedWith(pulled, [source, pulled]);
    assert(shared.map((x) => x.symbol.type).sort().join(",") === "door,window", `the door and the window in the shared wall, not the cabinet nor the door in another wall: ${shared.map((x) => x.symbol.id)}`);
    const top = s.wallsOf(pulled).find((w) => Math.abs(w.y1 - 192) < 0.01 && Math.abs(w.y2 - 192) < 0.01);
    assert(shared.every((x) => x.wallId === top.id), "both in the pulled room's top wall, the one it was pulled from");
  });

  test("a tap pulls a room of the default depth; nothing shallower than a foot is pulled", () => {
    const source = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(source)[2];
    near(b(s.pullRoomFromWall(source, bottom.id, s.PULLED_ROOM_DEFAULT_DEPTH_PX)).height, 144, "12' by default");
    near(b(s.pullRoomFromWall(source, bottom.id, 3)).height, 12, "a foot at least");
  });

  test("it joins the storey it was pulled from", () => {
    const source = box(0, 0, 240, 192, { id: "src", level: 1 });
    const pulled = s.pullRoomFromWall(source, s.wallsOf(source)[2].id, 120);
    assert(pulled.level === 1, "upstairs");
    assert(s.pullRoomFromWall(box(0, 0, 240, 192), s.wallsOf(box(0, 0, 240, 192))[2].id, 120).level === undefined, "the main level is not written");
  });

  test("the pull depth is how far out from the wall the finger is, positive outside", () => {
    const source = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(source)[2];
    near(s.pullDepthPx(bottom, { x: 100, y: 250 }), 58, "58px below the bottom wall");
    assert(s.pullDepthPx(bottom, { x: 100, y: 100 }) < 0, "negative inside the room");
  });

  /*
    Rooms do not overlap: a wall pushed out follows the walls in its way. The pictures that reported
    this: a room pulled off a wall ran straight across the angled wall and door hanging off that
    wall's corner; widening it ran its side over them; and a pulled room's side that landed along a
    stub with a door hid the door.
  */

  const seg = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
  const pts = (list) => list.map((p) => [Math.round(p.x), Math.round(p.y)].join(",")).join(" ");

  test("with nothing in the way a wall pushes out into a plain rectangle", () => {
    const r = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(r)[2]; // (240,192) -> (0,192), out is +y
    const band = s.extrudeWall(bottom, 120, []);
    assert(pts(band.far) === "240,192 240,312 0,312 0,192", `got ${pts(band.far)}`);
    assert(!band.limited, "nothing limited it");
  });

  test("a wall across the way stops the band short there, and the band steps down past its end", () => {
    // A wall 60 out, covering the right half of the span: the band is 60 deep there, 120 deep past it.
    const r = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(r)[2];
    const band = s.extrudeWall(bottom, 120, [seg(120, 252, 240, 252)]);
    assert(pts(band.far) === "240,192 240,252 120,252 120,312 0,312 0,192", `got ${pts(band.far)}`);
    assert(band.limited, "and says so");
  });

  test("the report: an angled wall off the corner is followed, angle and all", () => {
    // The wall runs (0,192)->(240,192) as the TOP wall of a room below; out is -y. An angled wall
    // hangs off its right corner going up and right — outside the span — and one off its left
    // corner going up and LEFT is outside too. Neither is in the way: the band is plain.
    const below = room([[0, 192], [240, 192], [240, 300], [0, 300]], { id: "below" });
    const top = s.wallsOf(below)[0];
    const plain = s.extrudeWall(top, 100, [seg(240, 192, 300, 132)]);
    assert(pts(plain.far) === "0,192 0,92 240,92 240,192", `an angled wall outside the span shapes nothing: ${pts(plain.far)}`);
    // But an angled wall coming INTO the span from the right corner — up and to the left — bounds
    // the band along its length: the far side follows it from the corner.
    const shaped = s.extrudeWall(top, 100, [seg(240, 192, 180, 132)]);
    assert(pts(shaped.far) === "0,192 0,92 180,92 180,132 240,192", `expected the far side to follow the angled wall, got ${pts(shaped.far)}`);
  });

  test("walls behind the wall, or beyond its reach, are no obstacle", () => {
    const r = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(r)[2];
    const behind = s.extrudeWall(bottom, 120, [seg(0, 100, 240, 100)]); // inside the room, above the wall
    assert(pts(behind.far) === "240,192 240,312 0,312 0,192" && !behind.limited, `behind: ${pts(behind.far)}`);
    const beyond = s.extrudeWall(bottom, 120, [seg(0, 400, 240, 400)]);
    assert(pts(beyond.far) === "240,192 240,312 0,312 0,192" && !beyond.limited, `beyond: ${pts(beyond.far)}`);
  });

  test("a wall square to the band, or lying along it, shapes nothing of the far side", () => {
    const r = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(r)[2];
    const square = s.extrudeWall(bottom, 120, [seg(120, 192, 120, 300)]);
    assert(pts(square.far) === "240,192 240,312 0,312 0,192", `a partition standing across the band is left standing: ${pts(square.far)}`);
  });

  test("a wall coming in a hair past the corner shapes the band from the corner — no sliver spiking out in front of it", () => {
    // The angled wall's far end is a fiftieth of a pixel off, so in the band it starts 0.013px
    // past the corner instead of at it. Taken literally that left a full-depth sliver there and the
    // far side going out and straight back: "300,60 330,60 300,60 330,90 ...".
    const r = room([[0, 0], [240, 0], [300, 60], [300, 192], [0, 192]], { id: "r" });
    const side = s.wallsOf(r)[2]; // (300,60) -> (300,192)
    const band = s.extrudeWall(side, 30, [seg(240, 0, 330, 90.02)]);
    assert(pts(band.far) === "300,60 330,90 330,192 300,192", `got ${pts(band.far)}`);
  });

  test("a wall met in two pieces gives one straight far side — the outline the canvas previews has no corner mid-wall", () => {
    const r = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(r)[2];
    const band = s.extrudeWall(bottom, 120, [seg(120, 252, 180, 252), seg(180, 252, 240, 252)]);
    assert(pts(band.far) === "240,192 240,252 120,252 120,312 0,312 0,192", `got ${pts(band.far)}`);
  });

  test("a closet inside the room, flush to the wall, is behind it — not a room standing in front", () => {
    // The closet's top wall runs along the bedroom's top wall from inside. Taken as an obstacle it
    // read as a room already there, and the pull off that wall started only past the closet.
    const bedroom = box(60, 40, 192, 144, { id: "bed" });
    const closet = { ...box(60, 40, 48, 30, { id: "cl" }), parentRoomId: "bed" };
    const sketch = { rooms: [bedroom, closet] };
    const top = s.wallsOf(bedroom)[0]; // (60,40) -> (252,40), out is -y
    const obstacles = s.obstaclesFor(sketch, 0, { wall: { roomId: "bed", wallId: top.id } });
    assert(obstacles.length === 3, `the bedroom's other three walls and nothing of the closet's: ${obstacles.length}`);
    const pulled = s.pullRoomFromWall(bedroom, top.id, 100, { obstacles, rooms: sketch.rooms });
    const bb = b(pulled);
    assert(bb.minX === 60 && bb.maxX === 252 && bb.minY === -60 && bb.maxY === 40, `the whole wall's width: ${JSON.stringify(bb)}`);
    // Dragging the bedroom's wall outward is the same: its closet is not in the way.
    assert(s.obstaclesFor(sketch, 0, { roomId: "bed" }).length === 0, "nothing in the way of the bedroom's own walls");
    // A closet inside some OTHER room still counts, as any wall does.
    assert(s.obstaclesFor(sketch, 0, { roomId: "cl" }).length === 4, "from the closet's side the bedroom's walls are walls");
  });

  test("a negative depth pulls INTO the room: a closet off that wall, a sub-room the moment it lands", () => {
    const bedroom = box(60, 40, 192, 144, { id: "bed" });
    const top = s.wallsOf(bedroom)[0]; // (60,40) -> (252,40), out is -y
    const sketch = { rooms: [bedroom] };
    const closet = s.pullRoomFromWall(bedroom, top.id, -24, { obstacles: s.obstaclesFor(sketch, 0, { wall: { roomId: "bed", wallId: top.id }, inward: true }), rooms: sketch.rooms });
    const bb = b(closet);
    assert(bb.minX === 60 && bb.maxX === 252 && bb.minY === 40 && bb.maxY === 64, `2' deep, inside, along the whole wall: ${JSON.stringify(bb)}`);
    assert(s.ensureClockwise(closet.vertices) === closet.vertices, "wound clockwise like every room");
    const derived = s.withDerivedParents([bedroom, closet]);
    assert(derived[1].parentRoomId === "bed", "and it is the bedroom's sub-room by geometry");
    assert(closet.name === "Room 1", "named like any new room");
    // Too deep is bounded by the far wall: the band stops at the bottom wall, 12' in.
    const deep = s.pullRoomFromWall(bedroom, top.id, -300, { obstacles: s.obstaclesFor(sketch, 0, { wall: { roomId: "bed", wallId: top.id }, inward: true }), rooms: sketch.rooms });
    near(b(deep).maxY, 184, "no deeper than the room");
  });

  test("pulling in meets the closets already inside; pulling out does not", () => {
    const bedroom = box(60, 40, 192, 144, { id: "bed" });
    const top = s.wallsOf(bedroom)[0];
    // A closet standing against the bottom wall, under the right half of the room.
    const existing = { ...box(156, 154, 96, 30, { id: "cl" }), parentRoomId: "bed" };
    const sketch = { rooms: [bedroom, existing] };
    const inward = s.obstaclesFor(sketch, 0, { wall: { roomId: "bed", wallId: top.id }, inward: true });
    const outward = s.obstaclesFor(sketch, 0, { wall: { roomId: "bed", wallId: top.id } });
    assert(inward.length === 3 + 4 && outward.length === 3, `in: the room's other walls and the closet's; out: the room's other walls only (${inward.length}/${outward.length})`);
    // Pulled in to the bottom: the new room stops at the closet over its stretch, and reaches the
    // bottom wall past it.
    const pulled = s.pullRoomFromWall(bedroom, top.id, -144, { obstacles: inward, rooms: sketch.rooms });
    const corners = pulled.vertices.map((v) => [Math.round(v.x), Math.round(v.y)].join(",")).join(" ");
    assert(pulled.vertices.length === 6, `steps around the closet: ${corners}`);
    assert(corners.includes("252,154") && corners.includes("156,154") && corners.includes("156,184"), `down to the closet's top on the right, to the bottom wall on the left: ${corners}`);
  });

  test("a wall walked the other way", () => {
    const r = box(0, 0, 240, 192, { id: "r" });
    const top = s.wallsOf(r)[0];
    const back = s.reversedWall(top);
    assert(back.x1 === 240 && back.y1 === 0 && back.x2 === 0 && back.y2 === 0 && back.id === top.id, "same wall, ends swapped, same id");
    const n = s.outwardNormal(back);
    near(n.y, 1, "its outside is the room's inside");
    near(s.pullDepthPx(top, { x: 100, y: 30 }), -30, "a point inside the room is a negative depth off the wall");
  });

  test("the report: a room already standing against part of the wall leaves only the rest of it to pull from", () => {
    // A 3'6" x 2'9" room against the top part of the bedroom's right wall, and a room pulled off
    // that wall came out the full 16' — over the room already there. Its near wall was a hair
    // inside the line (a pixel: snapped flush, as far as anyone could see), which read as "wholly
    // behind the wall" and dropped it from the band.
    const bedroom = box(0, 0, 240, 192, { id: "bed" });
    const right = s.wallsOf(bedroom)[1]; // (240,0) -> (240,192), out is +x
    for (const [dx, note] of [[0, "exactly on the line"], [-1, "a pixel inside it"], [3, "three pixels off it"]]) {
      const already = box(240 + dx, 0, 42, 33, { id: "top" });
      const sketch = { rooms: [bedroom, already] };
      const obstacles = s.obstaclesFor(sketch, 0, { wall: { roomId: "bed", wallId: right.id } });
      const pulled = s.pullRoomFromWall(bedroom, right.id, 33, { obstacles, rooms: sketch.rooms });
      const bb = b(pulled);
      assert(bb.minY >= 33 - 0.01 && bb.maxY === 192 && bb.minX === 240 && bb.maxX === 273, `${note}: only below the room already there — ${JSON.stringify(bb)}`);
      assert(pulled.vertices.length === 4, `${note}: a plain rectangle, ${pulled.vertices.length} corners`);
    }
    // The whole wall taken: nothing to pull.
    const whole = box(239, 0, 42, 192, { id: "top" });
    const sketch = { rooms: [bedroom, whole] };
    assert(s.pullRoomFromWall(bedroom, right.id, 33, { obstacles: s.obstaclesFor(sketch, 0, { wall: { roomId: "bed", wallId: right.id } }), rooms: sketch.rooms }) === null, "a room along the whole wall, a pixel inside it, leaves nothing");
  });

  test("a room already standing against the wall leaves nothing to pull", () => {
    const r = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(r)[2];
    // Its near wall lies along ours, at v = 0, the whole way.
    assert(s.extrudeWall(bottom, 120, [seg(0, 192, 240, 192), seg(0, 312, 240, 312)]) === null, "nothing in front of the wall");
    assert(s.pullRoomFromWall(r, bottom.id, 120, { obstacles: [seg(0, 192, 240, 192)], rooms: [r] }) === null, "and no room is pulled");
  });

  test("a pulled room takes the shape the walls around it allow", () => {
    const r = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(r)[2];
    const pulled = s.pullRoomFromWall(r, bottom.id, 120, { obstacles: [seg(120, 252, 240, 252)], rooms: [r] });
    assert(pulled && pulled.vertices.length === 6, `six corners, got ${pulled && pulled.vertices.length}`);
    near(s.grossFloorArea(pulled), (120 * 60 + 120 * 120) / 144, "the area of the stepped band");
  });

  test("a door in any wall the new room lands along is seen from it — never copied into it", () => {
    // The stub in the picture: the room the new one is pulled beside has a door in the wall the new
    // room's side comes to lie along. A first version copied that door into the pulled room as an
    // opening of its own; the copy then drifted from the door (see the drift test below).
    const src = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(src)[2];
    src.symbols = [door(bottom.id, 0.25, { id: "in-src" })];
    // A neighbour to the right whose left wall (240,192)->(240,312) will be the pulled room's right side.
    const neighbour = room([[240, 192], [360, 192], [360, 312], [240, 312]], { id: "nb" });
    const left = s.wallsOf(neighbour)[3]; // (240,312) -> (240,192)
    neighbour.symbols = [door(left.id, 0.5, { id: "in-nb" })];
    const pulled = s.pullRoomFromWall(src, bottom.id, 120, { obstacles: [], rooms: [src, neighbour] });
    assert(pulled.symbols.length === 0, `nothing copied in: ${JSON.stringify(pulled.symbols)}`);
    const seen = s.openingsSharedWith(pulled, [src, neighbour, pulled]).map((x) => x.symbol.id).sort();
    assert(seen.join(",") === "in-nb,in-src", `both doors are seen from the new room: ${seen}`);
  });

  test("a shared door straddling the corner counts for the stretch in each wall; the grip keeps clear of it; its label yields only there", () => {
    // Bedroom 20' bottom wall, door centred at 10'; a 10' flight against the right half and a 10'
    // room against the left half: the door is half in each of their top walls.
    const src = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(src)[2];
    src.symbols = [door(bottom.id, 0.5)];
    const flightRight = box(120, 192, 120, 36, { id: "fr" });
    const roomLeft = box(0, 192, 120, 120, { id: "rl" });
    const rooms = [src, flightRight, roomLeft];
    const doorArea = 2.5 * (20 / 3);
    near(s.openingSquareFeet(flightRight, rooms), doorArea / 2, "half the hole in the flight's wall");
    near(s.openingSquareFeet(roomLeft, rooms), doorArea / 2, "half in the room's");
    near(s.openingSquareFeet(src, rooms), doorArea, "the whole of it in the bedroom's, once");
    const [shared] = s.openingsSharedWith(flightRight, rooms);
    near(shared.toPx - shared.fromPx, 15, "the stretch it covers of that wall");
    // The flight's top wall (120,192)->(240,192) holds the shared door's half at its start; the
    // grip goes to the clear stretch, not the middle of the wall where it would sit under the door.
    const flightTop = s.wallsOf(flightRight).find((w) => w.y1 === 192 && w.y2 === 192);
    const bare = s.wallGripSpan(flightRight, flightTop);
    const aware = s.wallGripSpan(flightRight, flightTop, rooms);
    near(bare.t, 0.5, "as if the wall were empty: dead centre");
    assert(aware.t !== 0.5 && aware.clearPx < bare.clearPx, `clear of the door: ${JSON.stringify(aware)}`);
    // A window at the far right end of the bedroom's wall shares its stretch with the flight...
    src.symbols.push(windowOn(bottom.id, 0.1)); // 24px from the wall's start, the right-hand corner
    const win = src.symbols[1];
    const wc = s.symbolCentrePx(win, src);
    const ww = s.symbolWidthPx(win, src);
    assert(s.stretchSharedWithAnother(src, bottom, wc - ww / 2, wc + ww / 2, rooms), "the window's stretch is shared with the flight");
    // ...but with the flight gone that end of the wall is nobody else's, whatever the left half is.
    assert(!s.stretchSharedWithAnother(src, bottom, wc - ww / 2, wc + ww / 2, [src, roomLeft]), "not shared: its label may show");
  });

  test("the sketch data lists what a room sees in its walls, labelled and numbered for that room", () => {
    const src = { ...box(0, 0, 240, 192, { id: "src" }), name: "  " }; // no name to speak of
    const bottom = s.wallsOf(src)[2];
    src.symbols = [door(bottom.id, 0.25, { id: "d1" }), { ...door(bottom.id, 0.5, { id: "o1" }), doorType: "opening" }, windowOn(bottom.id, 0.8)];
    const pulled = s.pullRoomFromWall(src, bottom.id, 120);
    const out = s.sketchOutput({ rooms: [src, pulled] });
    const wallNo = s.wallsOf(pulled).findIndex((w) => Math.abs(w.y1 - 192) < 0.01 && Math.abs(w.y2 - 192) < 0.01) + 1;
    const seen = out[1].sharedOpenings.map((o) => `${o.label}@${o.wall}:${o.widthFeet}:${o.withRoom}`).sort();
    assert(
      seen.join(" | ") === [`Opening (no door)@${wallNo}:2.5:Unnamed room`, `Single swing door@${wallNo}:2.5:Unnamed room`, `Window@${wallNo}:3:Unnamed room`].join(" | "),
      `got ${seen.join(" | ")}`,
    );
    assert(out[0].sharedOpenings.length === 0, "the owner lists nothing as shared: they are its own");
  });

  test("a painting scope line on the pulled room's wall leaves out the door it shares", () => {
    const src = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(src)[2];
    src.symbols = [door(bottom.id, 0.5)];
    const pulled = s.pullRoomFromWall(src, bottom.id, 120);
    const top = s.wallsOf(pulled).find((w) => Math.abs(w.y1 - 192) < 0.01 && Math.abs(w.y2 - 192) < 0.01);
    const mark = { walls: [{ roomId: pulled.id, wallId: top.id, startT: 0, endT: 1 }], floorCells: {} };
    near(s.fullWallSquareFeet(mark, { rooms: [src, pulled] }), 20 * 8 - 2.5 * (20 / 3), "20' x 8' less the door");
  });

  test("a placeholder name matches an extraction room exactly, never by containment", () => {
    assert(s.isPlaceholderRoomName("Room 3") && s.isPlaceholderRoomName(" room 12 ") && !s.isPlaceholderRoomName("Living Room 1") && !s.isPlaceholderRoomName(""), "what counts as one");
    const suggestions = { "room 1": { equipment: {}, floorSquareFeet: 1, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: null }, "master bedroom": { equipment: {}, floorSquareFeet: 2, wallRunFeet: null, ceilingSquareFeet: null, parentRoomKey: null } };
    assert(s.findDerived(suggestions, "Living Room 1") === undefined, "a room nobody has named is not the living room");
    assert(s.findDerived(suggestions, "Room 1")?.floorSquareFeet === 1, "but it is Room 1 when the extraction says Room 1");
    assert(s.findDerived(suggestions, "Bedroom")?.floorSquareFeet === 2, "a typed name still matches by containment");
  });

  test("a sketch saved with a copy of the door in the pulled room still has one hole there, not two", () => {
    // Saved while doors were being copied into pulled rooms: the source's door and, in the pulled
    // room's own wall, an opening at the same place. Drawn once, deducted once — through the copy.
    const src = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(src)[2];
    src.symbols = [door(bottom.id, 0.25)];
    const pulled = s.pullRoomFromWall(src, bottom.id, 120);
    const top = s.wallsOf(pulled).find((w) => Math.abs(w.y1 - 192) < 0.01 && Math.abs(w.y2 - 192) < 0.01);
    // The copy sits at the same world point: 60px from the source wall's start, (180,192).
    const at = s.pointOnWall(bottom, 0.25);
    const u = ((at.x - top.x1) * (top.x2 - top.x1) + (at.y - top.y1) * (top.y2 - top.y1)) / top.lengthPx;
    const withCopy = { ...pulled, symbols: [{ ...door(top.id, u / top.lengthPx, { id: "copy" }), doorType: "opening" }] };
    assert(s.openingsSharedWith(withCopy, [src, withCopy]).length === 0, "the source's door is not shared in on top of its copy");
    near(s.openingSquareFeet(withCopy, [src, withCopy]), 2.5 * (20 / 3), "deducted once");
    // A copy nudged along, still overlapping the door, is that hole — two doorways cannot overlap
    // in a wall; one slid clear of it (three feet, past its own width) is not, and the door shows
    // through again beside it — two holes, honestly.
    const nudged = { ...withCopy, symbols: [{ ...withCopy.symbols[0], t: withCopy.symbols[0].t + 20 / top.lengthPx }] };
    assert(s.openingsSharedWith(nudged, [src, nudged]).length === 0, "nudged, still overlapping: the same hole");
    const slid = { ...withCopy, symbols: [{ ...withCopy.symbols[0], t: withCopy.symbols[0].t + 36 / top.lengthPx }] };
    assert(s.openingsSharedWith(slid, [src, slid]).length === 1, "a copy moved clear is no longer the same hole");
  });

  test("the report: a door in a shared wall is drawn by both rooms — whichever is on top shows it", () => {
    // A door in the source's bottom wall; the room pulled below shares that wall and draws the door
    // over its own wall and floor, so the leaf is not lost under them. A flight of stairs dragged
    // against the same wall shares it just the same, pulled or not.
    const src = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(src)[2];
    src.symbols = [door(bottom.id, 0.5), windowOn(s.wallsOf(src)[0].id, 0.5), cabinetOn(bottom.id, 0.1)];
    const below = box(0, 192, 240, 120, { id: "below" });
    const shared = s.openingsSharedWith(below, [src, below]);
    assert(shared.length === 1 && shared[0].symbol.type === "door" && shared[0].room.id === "src", `the door and only the door: ${JSON.stringify(shared.map((x) => x.symbol.type))}`);
    // Half a wall: a flight of stairs against the right half of the wall still shares the door, but
    // one against the left half, clear of it, does not.
    const flightRight = box(120, 192, 120, 36, { id: "fr" });
    const flightLeft = box(0, 192, 100, 36, { id: "fl" });
    assert(s.openingsSharedWith(flightRight, [src, flightRight]).length === 1, "the door is half in the flight's wall");
    assert(s.openingsSharedWith(flightLeft, [src, flightLeft]).length === 0, "and not at all in a wall that stops short of it");
    // Not across storeys, and not from a wall that merely runs parallel some way off.
    const upstairs = { ...box(0, 192, 240, 120, { id: "up" }), level: 1 };
    assert(s.openingsSharedWith(upstairs, [src, upstairs]).length === 0, "another storey shares nothing");
    const apart = box(0, 230, 240, 120, { id: "apart" });
    assert(s.openingsSharedWith(apart, [src, apart]).length === 0, "a wall a few feet off is not the same wall");
  });

  test("a shared door comes off the wall area of both rooms, and the summary says whose it is", () => {
    // A 2'6" x 6'8" door in the source's bottom wall: 16.67 SF of no wall, from either side.
    const src = { ...box(0, 0, 240, 192, { id: "src" }), name: "Main" };
    const bottom = s.wallsOf(src)[2];
    src.symbols = [door(bottom.id, 0.5)];
    const pulled = { ...s.pullRoomFromWall(src, bottom.id, 120, { obstacles: [], rooms: [src] }), name: "Room 1" };
    const rooms = [src, pulled];
    const doorArea = 2.5 * (20 / 3);
    near(s.openingSquareFeet(pulled), 0, "the pulled room has no openings of its own");
    near(s.openingSquareFeet(pulled, rooms), doorArea, "but the door in its top wall is no wall, seen from its side too");
    near(s.openingSquareFeet(src, rooms), doorArea, "and the source counts it once, not once more for having a neighbour");
    const q = s.roomQuantities(pulled, { rooms }, s.DEFAULT_QUANTITY_OPTIONS);
    near(q.deductions.openingSquareFeet, doorArea, "the quantities table takes it off the pulled room's wall area");
    const text = s.sketchSummaryText({ rooms });
    const wallNo = s.wallsOf(pulled).findIndex((w) => Math.abs(w.y1 - 192) < 0.01 && Math.abs(w.y2 - 192) < 0.01) + 1;
    assert(text.includes(`Single swing door — wall ${wallNo}, shared with Main, 2'6" wide`), `the pulled room's data names the door it shares:\n${text}`);
  });

  test("dragging a wall that crosses nothing is the plain drag, angles kept", () => {
    const r = box(0, 0, 240, 192, { id: "r" });
    const right = s.wallsOf(r)[1]; // (240,0) -> (240,192), out is +x
    const moved = s.conformedDragWall(r, right.id, 60, 0, []);
    assert(moved.vertices.length === 4 && b(moved).maxX === 300, `a 4-cornered room 60 wider, got ${JSON.stringify(b(moved))}`);
  });

  test("the report: widening a room into an angled wall makes the room follow the wall instead", () => {
    // The right wall (240,0)->(240,192) dragged 60 right; an angled wall hangs off its top corner
    // going down and right, (240,0)->(330,90), with the rest of that space open below it.
    const r = box(0, 0, 240, 192, { id: "r" });
    const right = s.wallsOf(r)[1];
    const angled = seg(240, 0, 330, 90);
    const plain = s.dragWall(r, right.id, 60, 0);
    assert(s.crossesAny(plain, [angled]), "the plain drag would cross the angled wall");
    const moved = s.conformedDragWall(r, right.id, 60, 0, [angled]);
    assert(!s.crossesAny(moved, [angled]), "the reshaped room crosses nothing");
    const corners = moved.vertices.map((v) => [Math.round(v.x), Math.round(v.y)].join(","));
    assert(corners.includes("300,60"), `the side follows the angled wall out to 60 and then turns down: ${corners}`);
    assert(corners.includes("300,192") && corners.includes("240,0"), `and runs to the bottom-right corner: ${corners}`);
    near(b(moved).maxX, 300, "60 wider at the bottom");
    assert(moved.vertices.length === 5, `five corners and no more — the old bottom-right corner now lies flat along the bottom: ${corners}`);
  });

  test("and the door in the wall the room came to lie along is seen from the reshaped room, not copied in", () => {
    const r = box(0, 0, 240, 192, { id: "r" });
    const right = s.wallsOf(r)[1];
    // The angled wall belongs to a neighbour, with a door in it.
    const nb = room([[240, 0], [330, 90], [400, 90], [400, 0]], { id: "nb" });
    const angled = s.wallsOf(nb)[0]; // (240,0) -> (330,90)
    nb.symbols = [door(angled.id, 0.5)];
    const moved = s.conformedDragWall(r, right.id, 60, 0, s.wallsOf(nb).map((w) => seg(w.x1, w.y1, w.x2, w.y2)));
    assert(moved.symbols.length === 0, `nothing copied in: ${JSON.stringify(moved.symbols)}`);
    assert(s.openingsSharedWith(moved, [moved, nb]).length === 1, "the door is seen from the reshaped room");
  });

  test("the dragged wall keeps its id when its start corner comes to lie flat — the drag must not stop dead", () => {
    // The room from the picture after one widening: its right side already follows the angled wall
    // (240,0)->(300,60) and then drops straight down. Now the straight piece (300,60)->(300,192) is
    // dragged 30 further right; the angled wall goes on to (330,90), so the side follows it there
    // and the corner at (300,60) lies flat on the diagonal. In the canvas the grip being dragged is
    // that wall's, keyed by its start corner's id: were that id to go, the grip would unmount and
    // the drag end a frame in (seen in the harness).
    const r = room([[0, 0], [240, 0], [300, 60], [300, 192], [0, 192]], { id: "r" });
    const side = s.wallsOf(r)[2]; // (300,60) -> (300,192), out is +x
    const nb = room([[240, 0], [330, 90], [400, 90], [400, 0]], { id: "nb" });
    const angled = s.wallsOf(nb)[0];
    r.symbols = [door(side.id, 0.5, { id: "mine" }), door(side.id, 0.1, { id: "high" })]; // (300,126) and (300,73) on the dragged wall
    const moved = s.conformedDragWall(r, side.id, 30, 0, s.wallsOf(nb).map((w) => seg(w.x1, w.y1, w.x2, w.y2)));
    const corners = moved.vertices.map((v) => [Math.round(v.x), Math.round(v.y)].join(","));
    assert(corners.join(" ") === "0,0 240,0 330,90 330,192 0,192", `the side runs the whole diagonal then straight down, five corners: ${corners}`);
    const kept = moved.vertices.find((v) => v.id === side.id);
    assert(kept && Math.round(kept.x) === 330 && Math.round(kept.y) === 90, `the wall's own corner moved up to the turn, same id: ${JSON.stringify(kept)}`);
    const mine = moved.symbols.find((x) => x.id === "mine");
    const at = s.pointOnWall(s.wallById(moved, mine.wallId), mine.t);
    near(at.x, 330, "the door in the dragged wall is on the new straight piece");
    near(at.y, 126, "at the height it was");
    const high = moved.symbols.find((x) => x.id === "high");
    const highAt = s.pointOnWall(s.wallById(moved, high.wallId), high.t);
    near(highAt.y, 73.2, "the door near the top keeps its height too");
    near(highAt.x, 313.2, "on the diagonal, which is what the side is there now — the wall before the moved corner");
    assert(moved.symbols.length === 2, `only the room's own two doors: ${JSON.stringify(moved.symbols)}`);
  });

  test("the report: an opening on the wall the corner slides along stays put", () => {
    // The room after one widening has an opening on its diagonal, centred at (270,30). Widening
    // again slides the corner along the diagonal, which gets longer; the opening's place is a
    // fraction of that wall, so left alone it slid too — reported as two openings overlapping,
    // back when the neighbour's door was also copied in where it really was.
    const r = room([[0, 0], [240, 0], [300, 60], [300, 192], [0, 192]], { id: "r" });
    const diagonal = s.wallsOf(r)[1]; // (240,0) -> (300,60)
    const side = s.wallsOf(r)[2];
    r.symbols = [{ ...door(diagonal.id, 0.5, { id: "own" }), doorType: "opening" }]; // centred at (270,30)
    const moved = s.conformedDragWall(r, side.id, 30, 0, [seg(240, 0, 330, 90)]);
    const openings = moved.symbols.filter((x) => x.type === "door");
    assert(openings.length === 1 && openings[0].id === "own", `the one opening: ${JSON.stringify(moved.symbols)}`);
    const at = s.pointOnWall(s.wallById(moved, openings[0].wallId), openings[0].t);
    near(at.x, 270, "still where it was");
    near(at.y, 30, "not slid along the longer wall");
    // The same rule as the plain drag (`reflowContents`): an opening keeps its distance from the
    // corner it is nearer. By the fixed corner it stays put; by the sliding corner it goes with it.
    const place = (t) => {
      const rr = { ...r, symbols: [{ ...r.symbols[0], t }] };
      const m = s.conformedDragWall(rr, side.id, 30, 0, [seg(240, 0, 330, 90)]);
      return s.pointOnWall(s.wallById(m, m.symbols[0].wallId), m.symbols[0].t);
    };
    near(place(0.25).x, 255, "by the fixed corner: stays");
    near(place(0.75).x, 315, "by the sliding corner: 30px further along, with it");
  });

  test("a door near the moving corner travels with it the same whether or not the band meets a wall", () => {
    // The plain drag keeps a door the same distance from the corner it is nearer (`reflowContents`).
    // A drag that meets a wall part-way through must not move the doors differently from the
    // frames before it, or the door jumps the moment the band touches something.
    const r = box(0, 0, 240, 192, { id: "r" });
    const right = s.wallsOf(r)[1];
    const top = s.wallsOf(r)[0];
    r.symbols = [door(top.id, 0.9)]; // centred at x=216, 24px from the moving corner
    const at = (room) => s.pointOnWall(s.wallById(room, room.symbols[0].wallId), room.symbols[0].t).x;
    const plain = s.conformedDragWall(r, right.id, 100, 0, []);
    const met = s.conformedDragWall(r, right.id, 100, 0, [seg(300, 100, 300, 192)]); // a wall in the lower half of the band only
    near(at(plain), 316, "plain: still 24px from the corner, now at 340");
    near(at(met), 316, "met a wall: the same");
  });

  test("at a reflex corner the wall before the moved corner gets shorter, and its door stays on it", () => {
    // An L: the inner wall (240,100)->(120,100) runs back over the band when the wall below it is
    // dragged right, so the corner slides back along it and the wall shrinks from 120 to 50. The
    // door centred on it is kept on the wall it is on, not stored past its end.
    const l = room([[0, 0], [240, 0], [240, 100], [120, 100], [120, 192], [0, 192]], { id: "l" });
    const inner = s.wallsOf(l)[2]; // (240,100) -> (120,100)
    const lower = s.wallsOf(l)[3]; // (120,100) -> (120,192)
    l.symbols = [door(inner.id, 0.5)];
    const moved = s.conformedDragWall(l, lower.id, 80, 0, [seg(190, 100, 190, 192)]);
    const corners = moved.vertices.map((v) => [Math.round(v.x), Math.round(v.y)].join(",")).join(" ");
    assert(corners === "0,0 240,0 240,100 190,100 190,192 0,192", `the corner slid back to the wall in the way: ${corners}`);
    const d = moved.symbols[0];
    assert(d.t >= 0 && d.t <= 1, `on its wall, t=${d.t}`);
    const w = s.wallById(moved, d.wallId);
    near(w.lengthPx, 50, "the wall it is on is the shortened one");
    const p = s.pointOnWall(w, d.t);
    assert(p.x >= 190 + 15 - 0.01 && p.x <= 240 - 15 + 0.01 && Math.abs(p.y - 100) < 0.01, `wholly on it: ${JSON.stringify(p)}`);
  });

  test("the report: a wall widened a hair into an angled wall is not then snapped askew", () => {
    // A room pulled down off a horizontal wall, 7'2" wide, its right wall at the corner where the
    // neighbour's angled wall (4'3", with a door) sets off down and right. The right grip pulled 7px:
    // the side follows the angled wall for 10" then drops straight. The editor used to snap the
    // dragged wall to the room's own corners on release — by the wall's id, which after the reshape
    // names that 10" sliver — and the "snap" shoved the sliver off the angled wall and the top
    // wall up askew with it, over the door.
    const pulled = box(85, 60, 173, 245, { id: "p" });
    const right = s.wallsOf(pulled)[1]; // (258,60) -> (258,305)
    const angled = [seg(258, 60, 320, 130)];
    const moved = s.conformedDragWall(pulled, right.id, 7, 0, angled);
    const top = s.wallsOf(moved)[0];
    near(top.y1, 60, "the top wall's left end is where it was");
    near(top.y2, 60, "and so is its right: level");
    const sliver = s.wallById(moved, right.id);
    near(sliver.lengthPx, Math.hypot(7, 7 * (70 / 62)), "the id now names the sliver along the angled wall");
    assert(s.wallDragMeetsWall(pulled, right.id, 7, 0, angled), "so the editor must not snap it");
    assert(!s.wallDragMeetsWall(pulled, right.id, 7, 0, []), "a freehand drag is snapped as before");
    assert(!s.wallDragMeetsWall(pulled, right.id, -7, 0, angled), "and so is an inward one");
    // What the snap did to it, for the record: the sliver slid 7px off the wall it was following.
    const snapped = s.snapWallToNeighbours(moved, right.id);
    const skewed = s.wallsOf(snapped)[0];
    assert(Math.abs(skewed.y2 - skewed.y1) > 5, `snapping the sliver skews the top wall: ${skewed.y1} -> ${skewed.y2}`);
  });

  test("flat is judged to the half degree, as corners are — a wall drawn a hair off the line is still one line", () => {
    // Same room; the angled wall's far end is a fiftieth of a pixel off the true diagonal, as any
    // wall traced by hand will be. The corner at (300,60) still lies flat on it.
    const r = room([[0, 0], [240, 0], [300, 60], [300, 192], [0, 192]], { id: "r" });
    const side = s.wallsOf(r)[2];
    const moved = s.conformedDragWall(r, side.id, 30, 0, [seg(240, 0, 330, 90.02)]);
    assert(moved.vertices.length === 5, `five corners, got ${moved.vertices.map((v) => [Math.round(v.x), Math.round(v.y)].join(",")).join(" ")}`);
    assert(moved.vertices.some((v) => v.id === side.id), "and the wall keeps its id");
  });

  test("only the dragged wall's own corners are tidied — a break elsewhere on the room is left for later", () => {
    // A break (an unused collinear corner) sits on the top wall at (120,0). Widening the right wall
    // into the angled wall must not sweep it away: it goes when the room is left, as it always did.
    const r = room([[0, 0], [120, 0], [240, 0], [240, 192], [0, 192]], { id: "r" });
    const right = s.wallsOf(r)[2]; // (240,0) -> (240,192)
    const moved = s.conformedDragWall(r, right.id, 60, 0, [seg(240, 0, 330, 90)]);
    assert(moved.vertices.some((v) => v.id === "r-v1"), "the break is still there");
    assert(!moved.vertices.some((v) => v.id === "r-v3"), "while the old bottom-right corner, now flat along the bottom, is gone");
  });

  test("an inward drag is the plain drag, whatever stands outside", () => {
    const r = box(0, 0, 240, 192, { id: "r" });
    const right = s.wallsOf(r)[1];
    const moved = s.conformedDragWall(r, right.id, -60, 0, [seg(240, 0, 330, 90)]);
    near(b(moved).maxX, 180, "60 narrower");
    assert(moved.vertices.length === 4, "still a box");
  });

  test("a door in the dragged wall moves out with it onto the new side", () => {
    const r = box(0, 0, 240, 192, { id: "r" });
    const right = s.wallsOf(r)[1];
    r.symbols = [door(right.id, 0.75)]; // 144px down the right wall
    const moved = s.conformedDragWall(r, right.id, 60, 0, [seg(240, 0, 330, 90)]);
    const d = moved.symbols[0];
    const w = s.wallById(moved, d.wallId);
    const at = s.pointOnWall(w, d.t);
    near(at.x, 300, "on the new right side");
    near(at.y, 144, "at the same height");
  });

  test("dragging a wall into a neighbouring room stops at that room's wall", () => {
    const r = box(0, 0, 240, 192, { id: "r" });
    const right = s.wallsOf(r)[1];
    const neighbour = room([[300, 0], [420, 0], [420, 192], [300, 192]], { id: "nb" });
    const obstacles = s.wallsOf(neighbour).map((w) => seg(w.x1, w.y1, w.x2, w.y2));
    const moved = s.conformedDragWall(r, right.id, 100, 0, obstacles);
    near(b(moved).maxX, 300, "flush with the neighbour, not over it");
    assert(!s.crossesAny(moved, obstacles), "crossing nothing");
  });

  /* ── The room's name on the drawing ─────────────────────────────────────────────────────────────
   *
   * From the field: "the room labels are getting hidden behind fixtures and doors and they should
   * be remaining visible, as well as the option to hide a room label." The drawing order is a
   * source rule (see labelRules.mjs); this is the data side — a field that old sketches do not
   * have and new ones must keep.
   */

  test("a room's name shows unless it is hidden — a sketch saved before the field existed shows every name", () => {
    const old = box(0, 0, 240, 192, { id: "old" });
    assert(!("labelHidden" in old), "the fixture has no such field, like every room saved before it existed");
    assert(s.labelShown(old) === true, "and its name shows");
    assert(s.labelShown({ ...old, labelHidden: false }) === true, "shown when the field says so");
    assert(s.labelShown({ ...old, labelHidden: true }) === false, "hidden when the field says so");
  });

  test("a hidden name stays hidden through a save — the field round-trips with the sketch", () => {
    const hall = box(0, 0, 38, 45, { id: "hall", name: "Hall", labelHidden: true });
    const bath = box(60, 0, 99, 60, { id: "bath", name: "Bathroom" });
    const sketch = { rooms: [hall, bath] };
    const back = JSON.parse(JSON.stringify(sketch));
    assert(back.rooms[0].labelHidden === true, "the hall comes back hidden");
    assert(s.labelShown(back.rooms[0]) === false, "and reads as hidden");
    assert(!("labelHidden" in back.rooms[1]), "the bathroom, never touched, gains no field on the way through");
    assert(s.labelShown(back.rooms[1]) === true, "and still shows its name");
  });

  return { passed, failures };
}

/* ── standalone ───────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runRoomChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
