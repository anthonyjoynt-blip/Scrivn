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
  writeFileSync(entry, `export * from "${lib("sketch.ts")}";\nexport * from "${lib("roomPlacement.ts")}";\n`);
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
    assert(pulled.ceilingHeightFeet === 8 && pulled.name === "" && pulled.stairs === null, "an ordinary room");
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

  test("the doors in the wall come with it, as openings, at the same place along the wall", () => {
    const source = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(source)[2];
    source.symbols = [door(bottom.id, 0.25)]; // 60px from the wall's start, which is the right-hand corner
    const pulled = s.pullRoomFromWall(source, bottom.id, 120);
    assert(pulled.symbols.length === 1, `one symbol, got ${pulled.symbols.length}`);
    const copy = pulled.symbols[0];
    assert(copy.type === "door" && copy.doorType === "opening", `an opening on the far side, got ${copy.type}/${copy.doorType}`);
    assert(copy.widthFeet === 2.5 && copy.heightFeet === 6.67, "same size");
    const shared = s.wallById(pulled, copy.wallId);
    const at = s.pointOnWall(shared, copy.t);
    near(at.x, 180, "same place in the world — 60px from the right-hand corner");
    near(at.y, 192, "on the shared wall");
    assert(copy.id !== "d", "its own id");
  });

  test("windows come too; cabinets stay on their own side", () => {
    const source = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(source)[2];
    const other = s.wallsOf(source)[0];
    source.symbols = [windowOn(bottom.id, 0.5), cabinetOn(bottom.id, 0.75), door(other.id, 0.5)];
    const pulled = s.pullRoomFromWall(source, bottom.id, 120);
    assert(pulled.symbols.length === 1 && pulled.symbols[0].type === "window", `just the window, got ${pulled.symbols.map((x) => x.type)}`);
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

  return { passed, failures };
}

/* ── standalone ───────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runRoomChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
