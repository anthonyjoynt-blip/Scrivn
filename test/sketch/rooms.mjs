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
  writeFileSync(entry, `export * from "${lib("sketch.ts")}";\nexport * from "${lib("roomPlacement.ts")}";\nexport * from "${lib("sketchQuantities.ts")}";\n`);
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

  test("a door in any wall the new room lands along comes with it — not only the wall it was pulled from", () => {
    // The stub in the picture: the room the new one is pulled beside has a door in the wall the new
    // room's side comes to lie along.
    const src = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(src)[2];
    // A neighbour to the right whose left wall (240,192)->(240,312) will be the pulled room's right side.
    const neighbour = room([[240, 192], [360, 192], [360, 312], [240, 312]], { id: "nb" });
    const left = s.wallsOf(neighbour)[3]; // (240,312) -> (240,192)
    neighbour.symbols = [door(left.id, 0.5)];
    const pulled = s.pullRoomFromWall(src, bottom.id, 120, { obstacles: [], rooms: [src, neighbour] });
    const inherited = pulled.symbols.filter((x) => x.type === "door");
    assert(inherited.length === 1 && inherited[0].doorType === "opening", `expected the neighbour's door as an opening, got ${JSON.stringify(pulled.symbols)}`);
    const w = s.wallById(pulled, inherited[0].wallId);
    const at = s.pointOnWall(w, inherited[0].t);
    near(at.x, 240, "on the shared side");
    near(at.y, 252, "at the same place along it");
  });

  test("inheriting is idempotent: a door already there is not copied again", () => {
    const src = box(0, 0, 240, 192, { id: "src" });
    const bottom = s.wallsOf(src)[2];
    src.symbols = [door(bottom.id, 0.25)];
    const once = s.pullRoomFromWall(src, bottom.id, 120, { obstacles: [], rooms: [src] });
    const twice = s.inheritOpenings(once, [src, once]);
    assert(once.symbols.length === 1 && twice.symbols.length === 1, `expected one opening either way, got ${once.symbols.length}/${twice.symbols.length}`);
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

  test("and the door in the wall the room came to lie along comes in as an opening", () => {
    const r = box(0, 0, 240, 192, { id: "r" });
    const right = s.wallsOf(r)[1];
    // The angled wall belongs to a neighbour, with a door in it.
    const nb = room([[240, 0], [330, 90], [400, 90], [400, 0]], { id: "nb" });
    const angled = s.wallsOf(nb)[0]; // (240,0) -> (330,90)
    nb.symbols = [door(angled.id, 0.5)];
    const moved = s.conformedDragWall(r, right.id, 60, 0, s.wallsOf(nb).map((w) => seg(w.x1, w.y1, w.x2, w.y2)), [r, nb]);
    const inherited = moved.symbols.filter((x) => x.type === "door");
    assert(inherited.length === 1 && inherited[0].doorType === "opening", `expected the door as an opening, got ${JSON.stringify(moved.symbols)}`);
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
    nb.symbols = [door(angled.id, 0.5)]; // centred at (285,45): only wholly on the side once it runs the whole diagonal
    r.symbols = [door(side.id, 0.5, { id: "mine" }), door(side.id, 0.1, { id: "high" })]; // (300,126) and (300,73) on the dragged wall
    const moved = s.conformedDragWall(r, side.id, 30, 0, s.wallsOf(nb).map((w) => seg(w.x1, w.y1, w.x2, w.y2)), [r, nb]);
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
    const inherited = moved.symbols.filter((x) => x.type === "door" && x.id !== "mine" && x.id !== "high");
    assert(inherited.length === 1 && inherited[0].doorType === "opening", `the neighbour's door, now wholly along the side, comes in as an opening: ${JSON.stringify(moved.symbols)}`);
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

  return { passed, failures };
}

/* ── standalone ───────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runRoomChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
