/**
 * The closet behind a door lands outside the room, on the wall, sized from the door.
 *
 *   node test/sketch/closet.mjs        (also runs as part of npm run test:sketch)
 *
 * `closetBehindDoor` is pure geometry with one judgement in it — which side of a wall is outside —
 * and that judgement is the thing worth checking on every wall of a box, on an angled wall, and on
 * a room wound the wrong way, because a closet drawn INTO its room is wrong in a way nobody looks
 * for. The rest is arithmetic a tape can check: 3'6" for a 2'6" door, 2'0" deep, a wall (4") off
 * the room's wall - the wall between them stands there - flush to the corner when the door is in
 * it, never wider than the wall. On a chamfer the closet is the corner
 * the chamfer cut off instead, and the second half of the file is each of the four conditions
 * that decide it, one at a time — each with a room that passes the other three, so that dropping
 * any one of them fails a check of its own. Runs in Node like the placement, dimension and
 * scan-import checks next door.
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "closet-tests-"));
  await build({
    entryPoints: [join(root, "lib", "scanImport.ts"), join(root, "lib", "sketch.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "silent",
  });
  const scan = await import(pathToFileURL(join(outDir, "scanImport.mjs")).href);
  const sketch = await import(pathToFileURL(join(outDir, "sketch.mjs")).href);
  rmSync(outDir, { recursive: true, force: true });
  return { scan, sketch };
}

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

const FT = 12; // PIXELS_PER_FOOT — one pixel is one inch.

function room(vertices, extra = {}) {
  return {
    id: "room-1",
    name: "Bedroom",
    vertices: vertices.map(([x, y], i) => ({ id: `v${i}`, x, y })),
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

/** A plain box, corners clockwise from the top left: walls v0 top, v1 right, v2 bottom, v3 left. */
const box = (w = 12, h = 10, extra = {}) => room([[0, 0], [w * FT, 0], [w * FT, h * FT], [0, h * FT]], extra);

function door(wallId, { widthFeet = 2.5, t = 0.5, doorType = "swing", leaves = "single", id = "door-1" } = {}) {
  return {
    id,
    wallId,
    t,
    widthFraction: 0.2,
    widthFeet,
    type: "door",
    doorType,
    leaves,
    heightFeet: 6 + 8 / 12,
    flipX: false,
    flipY: false,
  };
}

function windowSymbol(wallId) {
  return { id: "window-1", wallId, t: 0.5, widthFraction: 0.24, widthFeet: 3, type: "window", heightFeet: 4, sillFeet: 3 };
}

/** Rotates a ring about a point, in degrees, y down. */
function rotated(vertices, degrees, cx, cy) {
  const a = (degrees * Math.PI) / 180;
  return vertices.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
}

/**
 * A box with its top-right corner cut off at 45 degrees, `legFeet` each way: five corners, clockwise.
 * Wall v1 is the chamfer, between the top wall v0 and the right wall v2; v4 is the straight left wall.
 */
const chamfered = (w = 12, h = 10, legFeet = 3, extra = {}) =>
  room([[0, 0], [(w - legFeet) * FT, 0], [w * FT, legFeet * FT], [w * FT, h * FT], [0, h * FT]], extra);

/** Where the walls of `kinked` would have met: 16' along the top, on its line. */
const KINK_X = { x: 16 * FT, y: 0 };

/**
 * A room whose top wall bends by `turnDeg` at `KINK_X`, with a short wall cut straight across the
 * bend `legFeet` either side of it — the sort of thing a house on a slight angle leaves in a plan.
 * Six corners, clockwise: the level top wall v0 ends `legFeet` short of the bend, the cut v1
 * crosses it, the turned wall v2 carries on 8' beyond, and the room squares off below. The cut's
 * neighbours meet at `KINK_X`, outward of it, and its legs are `legFeet` each, so nothing but the
 * size of the turn decides whether the cut is a chamfer.
 */
function kinked(turnDeg, legFeet = 4) {
  const a = (turnDeg * Math.PI) / 180;
  const leg = legFeet * FT;
  const end = [KINK_X.x + leg * Math.cos(a), KINK_X.y + leg * Math.sin(a)];
  const far = [end[0] + 8 * FT * Math.cos(a), end[1] + 8 * FT * Math.sin(a)];
  return room([[0, 0], [KINK_X.x - leg, KINK_X.y], end, far, [far[0], 10 * FT], [0, 10 * FT]]);
}

const officeTaps = readFileSync(join(here, "fixtures", "scan-taps-office.json"), "utf8");
const office = readFileSync(join(here, "fixtures", "scan-office.json"), "utf8");
const officeChamfer = readFileSync(join(here, "fixtures", "scan-office-chamfer.json"), "utf8");

/* ── geometry helpers, the same arithmetic the sketch uses ────────────────────────────────────── */

/** Signed area, doubled. Non-negative is clockwise in screen space — `ensureClockwise`'s own test. */
function signedArea(vertices) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

function centroid(vertices) {
  const n = vertices.length;
  return { x: vertices.reduce((s, v) => s + v.x, 0) / n, y: vertices.reduce((s, v) => s + v.y, 0) / n };
}

/** Perpendicular distance from the wall's infinite line. */
function offWall(p, wall) {
  return Math.abs((wall.x2 - wall.x1) * (p.y - wall.y1) - (wall.y2 - wall.y1) * (p.x - wall.x1)) / wall.lengthPx;
}

/** Distance along the wall from its start, in pixels — negative or past `lengthPx` means beyond an end. */
function alongWall(p, wall) {
  return ((p.x - wall.x1) * (wall.x2 - wall.x1) + (p.y - wall.y1) * (wall.y2 - wall.y1)) / wall.lengthPx;
}

/* ── the checks ───────────────────────────────────────────────────────────────────────────────── */

export async function runClosetChecks() {
  const { scan, sketch } = await load();
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

  const near = (actual, expected, message, tolerance) => {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}\n      expected ~${expected}\n      actual    ${actual}`);
    }
  };

  /**
   * Everything a closet must be, whatever wall it came off: four corners wound clockwise, standing
   * wholly outside the room, its near edge a wall's thickness off the wall's line centred on the
   * door and its far edge its depth beyond that.
   */
  const expectCloset = (parent, closet, wallId, { widthFeet, depthFeet, doorT = 0.5 }) => {
    assert(closet !== null, "closetBehindDoor returned null for a door");
    assert(closet.vertices.length === 4, `expected 4 vertices, got ${closet.vertices.length}`);
    assert(signedArea(closet.vertices) >= 0, "closet is not wound clockwise");
    assert(sketch.ensureClockwise(closet.vertices) === closet.vertices, "ensureClockwise would reverse the closet");
    const c = centroid(closet.vertices);
    assert(!sketch.isInsideRoom(parent, c.x, c.y), `closet centroid (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) is inside the room`);

    const wall = sketch.wallById(parent, wallId);
    const T = sketch.WALL_THICKNESS_PX;
    const onWall = closet.vertices.filter((v) => Math.abs(offWall(v, wall) - T) < 0.01);
    assert(onWall.length === 2, `expected two corners a wall (${T}) off the wall's line, got ${onWall.length}: ${closet.vertices.map((v) => offWall(v, wall).toFixed(2))}`);
    const [p, q] = onWall.map((v) => alongWall(v, wall)).sort((a, b) => a - b);
    near(q - p, widthFeet * FT, `closet width ${widthFeet}'`, 0.01);
    const doorCentre = sketch.pointOnWall(wall, doorT);
    const centreAlong = alongWall(doorCentre, wall);
    assert(offWall(doorCentre, wall) < 0.01, "door centre is off its own wall (test bug)");
    assert(centreAlong >= p - 0.01 && centreAlong <= q + 0.01, `door centre at ${centreAlong.toFixed(2)} px is not on the closet's near edge [${p.toFixed(2)}, ${q.toFixed(2)}]`);

    const offTheWall = closet.vertices.filter((v) => Math.abs(offWall(v, wall) - T) >= 0.01);
    assert(offTheWall.length === 2, `expected two corners off the wall, got ${offTheWall.length}`);
    for (const v of offTheWall) near(offWall(v, wall), T + depthFeet * FT, `closet depth ${depthFeet}' beyond the wall between`, 0.01);

    assert(closet.name === "Closet", `expected the name Closet, got ${JSON.stringify(closet.name)}`);
    assert(Array.isArray(closet.symbols) && closet.symbols.length === 0, "a new closet has no symbols");
    assert(closet.freeCabinets.length === 0, "a new closet has no islands");
    assert(closet.parentRoomId === null && closet.nestingOptOut === false, "nesting is derived later, not declared here");
    assert(closet.stairs === null && closet.ceilingType === "flat" && closet.ceilingPeakFeet === null, "a closet is a flat-ceilinged room");
    assert(closet.id !== parent.id && closet.id.startsWith("room-"), `closet needs a room id of its own, got ${closet.id}`);
    return { wall, p, q, centreAlong };
  };

  const wallNames = ["top", "right", "bottom", "left"];
  for (let i = 0; i < 4; i++) {
    test(`a 2'6" door mid-way along the ${wallNames[i]} wall gets a 3'6" x 2'0" closet outside, centred on it`, () => {
      const parent = box(12, 10, { level: 1 });
      parent.symbols = [door(`v${i}`)];
      const closet = sketch.closetBehindDoor(parent, "door-1");
      const { p, q, centreAlong } = expectCloset(parent, closet, `v${i}`, { widthFeet: 3.5, depthFeet: 2 });
      near((p + q) / 2, centreAlong, "closet centred on the door", 0.01);
      assert(closet.level === 1, `level should be copied from the room, got ${closet.level}`);
      assert(closet.ceilingHeightFeet === 8, `ceiling should be the room's 8', got ${closet.ceilingHeightFeet}`);
    });
  }

  test("a room with no level makes a closet with no level; a null ceiling becomes the 8' default", () => {
    const parent = box();
    parent.ceilingHeightFeet = null;
    parent.symbols = [door("v0")];
    const closet = sketch.closetBehindDoor(parent, "door-1");
    assert(closet !== null, "expected a closet");
    assert(!("level" in closet), `a room without a level must not write one, got ${JSON.stringify(closet.level)}`);
    assert(sketch.roomLevel(closet) === sketch.roomLevel(parent), "roomLevel still agrees with the parent");
    assert(closet.ceilingHeightFeet === sketch.DEFAULT_CEILING_HEIGHT_FEET, `expected the 8' default, got ${closet.ceilingHeightFeet}`);
    // And a real ceiling is carried across as is.
    parent.ceilingHeightFeet = 9.5;
    assert(sketch.closetBehindDoor(parent, "door-1").ceilingHeightFeet === 9.5, "a 9'6\" ceiling should come across");
  });

  test("a door in the corner gets a closet that lines up with the corner, still 3'6\" wide", () => {
    const parent = box(12, 10);
    // t = 0.05 on the 10' right wall: the door's centre would be 6" from the corner, which the
    // door's own clamp already moves to 15" — and a closet centred there would still overhang.
    parent.symbols = [door("v1", { t: 0.05 })];
    const closet = sketch.closetBehindDoor(parent, "door-1");
    const { wall, p } = expectCloset(parent, closet, "v1", { widthFeet: 3.5, depthFeet: 2, doorT: 0.05 });
    for (const v of closet.vertices) {
      const a = alongWall(v, wall);
      assert(a >= -0.01 && a <= wall.lengthPx + 0.01, `corner at ${a.toFixed(2)} px along a ${wall.lengthPx} px wall is beyond its end`);
    }
    near(p, 0, "closet flush to the corner the door is in", 0.01);
  });

  test("a 9' double sliding door on a 4' wall gets a closet the width of the wall", () => {
    const parent = box(4, 10);
    parent.symbols = [door("v0", { widthFeet: 9, doorType: "sliding", leaves: "double" })];
    const closet = sketch.closetBehindDoor(parent, "door-1");
    const { p, q } = expectCloset(parent, closet, "v0", { widthFeet: 4, depthFeet: 2 });
    near(p, 0, "closet starts at the wall's start", 0.01);
    near(q, 48, "closet ends at the wall's end", 0.01);
  });

  test("a narrow door still gets the 2'6\" minimum; options set the width and depth", () => {
    const parent = box(12, 10);
    parent.symbols = [door("v2", { widthFeet: 1 })];
    expectCloset(parent, sketch.closetBehindDoor(parent, "door-1"), "v2", { widthFeet: sketch.CLOSET_MIN_WIDTH_FEET, depthFeet: 2 });
    parent.symbols = [door("v2")];
    expectCloset(parent, sketch.closetBehindDoor(parent, "door-1", { depthFeet: 3, widthFeet: 5 }), "v2", { widthFeet: 5, depthFeet: 3 });
    // An option is clamped to the wall like the default is.
    expectCloset(parent, sketch.closetBehindDoor(parent, "door-1", { widthFeet: 40 }), "v2", { widthFeet: 12, depthFeet: 2 });
  });

  test("on a room turned 30 degrees the closet is square to its wall and still outside", () => {
    const parent = room(rotated([[0, 0], [144, 0], [144, 120], [0, 120]], 30, 72, 60));
    parent.symbols = [door("v0")];
    const closet = sketch.closetBehindDoor(parent, "door-1");
    const { wall } = expectCloset(parent, closet, "v0", { widthFeet: 3.5, depthFeet: 2 });
    near(Math.abs(wall.rotation), 30, "the wall really is at 30 degrees (test bug otherwise)", 0.01);
    for (const edge of sketch.wallsOf(closet)) {
      const diff = (((edge.rotation - wall.rotation) % 90) + 90) % 90;
      assert(diff < 0.01 || diff > 89.99, `closet edge at ${edge.rotation.toFixed(3)} deg is not square to a wall at ${wall.rotation.toFixed(3)} deg`);
    }
    // Every corner is on the far side of the wall's line from the room, not merely the centroid.
    const inward = centroid(parent.vertices);
    const side = (p) => Math.sign((wall.x2 - wall.x1) * (p.y - wall.y1) - (wall.y2 - wall.y1) * (p.x - wall.x1));
    for (const v of closet.vertices) {
      if (offWall(v, wall) < 0.01) continue;
      assert(side(v) === -side(inward), "a closet corner is on the room's side of the wall");
    }
  });

  test("a room wound counter-clockwise still gets its closet outside, not drawn into the floor", () => {
    // `ensureClockwise` exists because polygons arrive either way; the probe must not trust the
    // winding. Reversed ring: v0 top-left, v1 bottom-left, so wall v0 is the LEFT wall going down.
    const parent = room([[0, 0], [0, 120], [144, 120], [144, 0]]);
    assert(signedArea(parent.vertices) < 0, "fixture should be counter-clockwise (test bug otherwise)");
    parent.symbols = [door("v0")];
    const closet = sketch.closetBehindDoor(parent, "door-1");
    expectCloset(parent, closet, "v0", { widthFeet: 3.5, depthFeet: 2 });
    assert(closet.vertices.every((v) => v.x <= 0.01), `closet should stand left of the left wall, got xs ${closet.vertices.map((v) => v.x.toFixed(1))}`);
  });

  test("a window, an unknown id and a door on another room give null", () => {
    const parent = box();
    parent.symbols = [door("v0"), windowSymbol("v1")];
    assert(sketch.closetBehindDoor(parent, "window-1") === null, "a window is not a door");
    assert(sketch.closetBehindDoor(parent, "no-such-symbol") === null, "an unknown id is not a door");
    const other = box(12, 10, { id: "room-2" });
    assert(sketch.closetBehindDoor(other, "door-1") === null, "the door is on room-1, not room-2");
    assert(sketch.closetBehindDoor(parent, "door-1") !== null, "the real door still works");
  });

  test("a tapped closet door comes through the importer as a closet door, and a closet fits behind it", () => {
    // The fixture as shipped has no closet_door (the office's closet is the notch, and its door
    // was never tapped), so one is added on edge 0 — the 4'2" closet face — the way the
    // scan-import kinds check does, plus a second on the near wall tapped FIRST to prove the ids
    // come out in wall order rather than tap order.
    const fixture = JSON.parse(officeTaps);
    fixture.outline_openings.push({ edge: 5, from_m: 2.5, width_m: 0.762, kind: "closet_door", sill_m: null, head_m: null });
    fixture.outline_openings.push({ edge: 0, from_m: 0.1, width_m: 0.762, kind: "closet_door", sill_m: null, head_m: null });
    const result = scan.importScanRoom(JSON.stringify(fixture), { x: 60, y: 60 }, 1);
    assert(result.ok, `import failed: ${result.ok ? "" : result.error}`);
    const { room: imported, closetDoorIds } = result;
    const closetDoors = imported.symbols.filter((s) => closetDoorIds.includes(s.id));
    assert(closetDoorIds.length === 2 && closetDoors.length === 2, `expected both closet doors' ids, got ${JSON.stringify(closetDoorIds)}`);
    const edges = closetDoorIds.map((id) => sketch.wallById(imported, imported.symbols.find((s) => s.id === id).wallId).index);
    assert(edges[0] === 0 && edges[1] === 5, `ids should be in wall order (0 then 5), got walls ${edges}`);
    assert(closetDoors.every((s) => s.type === "door" && s.doorType === "swing"), "a closet door is still an ordinary swing door on the sketch");
    // The ordinary door and the window are not closet doors.
    assert(imported.symbols.length === 4, `expected 4 symbols, got ${imported.symbols.length}`);
    assert(!closetDoorIds.includes(imported.symbols.find((s) => s.type === "window").id), "the window is not a closet door");

    const onFace = imported.symbols.find((s) => s.id === closetDoorIds[0]);
    const closet = sketch.closetBehindDoor(imported, onFace.id);
    expectCloset(imported, closet, onFace.wallId, { widthFeet: 3.5, depthFeet: 2, doorT: onFace.t });
    assert(closet.level === 1, `closet should join the storey the room was imported on, got ${closet.level}`);
    near(closet.ceilingHeightFeet, 8.5, "closet takes the scanned 8'6\" ceiling", 1e-9);
    // Edge 0 is the closet face with the notch above it: the closet lands in the notch.
    const c = centroid(closet.vertices);
    assert(c.y < 60 + 0.635 * (12 / 0.3048) && c.x >= 60 && c.x <= 60 + 1.27 * (12 / 0.3048), `closet should sit in the notch above the face, centroid (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`);
  });

  test("a scan with no closet door tapped reports none — tapped or lapped", () => {
    const taps = scan.importScanRoom(officeTaps, { x: 0, y: 0 }, 0);
    assert(taps.ok && Array.isArray(taps.closetDoorIds) && taps.closetDoorIds.length === 0, `expected [], got ${JSON.stringify(taps.ok && taps.closetDoorIds)}`);
    const lap = scan.importScanRoom(office, { x: 0, y: 0 }, 0);
    assert(lap.ok && Array.isArray(lap.closetDoorIds) && lap.closetDoorIds.length === 0, `expected [], got ${JSON.stringify(lap.ok && lap.closetDoorIds)}`);
  });

  /* ── the corner behind a chamfer ────────────────────────────────────────────────────────────── */

  /** Area in square feet, whichever way the ring is wound. */
  const squareFeet = (vertices) => Math.abs(signedArea(vertices)) / 2 / (FT * FT);

  /**
   * The corner closet's share of a wall between it and the room: how far its base corners are drawn
   * in from the chamfer's ends toward the apex - a wall's thickness off the chamfer, over the
   * apex's height above it - so that its area is the whole corner's times (1 - k) squared.
   */
  const cornerShrink = (parent, wallId, apex) => sketch.WALL_THICKNESS_PX / offWall(apex, sketch.wallById(parent, wallId));

  /**
   * Everything a corner closet must be: three corners wound clockwise - the chamfer's own ends drawn
   * in toward the apex, a wall's thickness off the chamfer, and the apex - standing outside the
   * room, plus everything any closet is.
   */
  const expectCorner = (parent, closet, wallId, apex) => {
    assert(closet !== null, "closetBehindDoor returned null for a door");
    assert(closet.vertices.length === 3, `expected 3 vertices, got ${closet.vertices.length}`);
    assert(signedArea(closet.vertices) >= 0, "corner closet is not wound clockwise");
    assert(sketch.ensureClockwise(closet.vertices) === closet.vertices, "ensureClockwise would reverse the corner closet");
    const wall = sketch.wallById(parent, wallId);
    const k = cornerShrink(parent, wallId, apex);
    const inFrom = (x, y) => [x + (apex.x - x) * k, y + (apex.y - y) * k];
    for (const [x, y, what] of [[...inFrom(wall.x1, wall.y1), "the chamfer's start, a wall in"], [...inFrom(wall.x2, wall.y2), "the chamfer's end, a wall in"], [apex.x, apex.y, "the apex"]]) {
      assert(closet.vertices.some((v) => Math.hypot(v.x - x, v.y - y) < 0.01), `no corner at ${what} (${x.toFixed(2)}, ${y.toFixed(2)}); got ${closet.vertices.map((v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)})`).join(" ")}`);
    }
    const c = centroid(closet.vertices);
    assert(!sketch.isInsideRoom(parent, c.x, c.y), `corner closet centroid (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) is inside the room`);
    assert(closet.name === "Closet", `expected the name Closet, got ${JSON.stringify(closet.name)}`);
    assert(closet.symbols.length === 0 && closet.freeCabinets.length === 0, "a new closet has no symbols and no islands");
    assert(closet.parentRoomId === null && closet.nestingOptOut === false, "nesting is derived later, not declared here");
    assert(closet.stairs === null && closet.ceilingType === "flat" && closet.ceilingPeakFeet === null, "a closet is a flat-ceilinged room");
    assert(closet.id !== parent.id && closet.id.startsWith("room-"), `closet needs a room id of its own, got ${closet.id}`);
  };

  test("a door in a 45-degree chamfer with 3' legs gets the cut-off corner: to where the walls would have met, less the chamfer wall", () => {
    const parent = chamfered(12, 10, 3, { level: 1 });
    parent.symbols = [door("v1")];
    assert(sketch.closetShapeBehindDoor(parent, "door-1") === "corner", `expected "corner", got ${JSON.stringify(sketch.closetShapeBehindDoor(parent, "door-1"))}`);
    const closet = sketch.closetBehindDoor(parent, "door-1");
    // The apex is the box's own top-right corner, the one the chamfer cut off.
    expectCorner(parent, closet, "v1", { x: 12 * FT, y: 0 });
    // The whole corner is a 3' x 3' right triangle, 4.5 sq ft; the chamfer wall takes 4" of its
    // 25.5" height, leaving legs of 2'6.3" and 3.2 sq ft inside the walls.
    near(squareFeet(closet.vertices), 4.5 * (1 - 4 / (36 / Math.SQRT2)) ** 2, "the corner less the chamfer wall", 0.01);
    assert(closet.level === 1, `level should be copied from the room, got ${closet.level}`);
    assert(closet.ceilingHeightFeet === 8, `ceiling should be the room's 8', got ${closet.ceilingHeightFeet}`);
    // The corner has its own size: the options that size a rectangle change nothing here.
    const sized = sketch.closetBehindDoor(parent, "door-1", { depthFeet: 5, widthFeet: 6 });
    expectCorner(parent, sized, "v1", { x: 12 * FT, y: 0 });
    near(squareFeet(sized.vertices), squareFeet(closet.vertices), "options are ignored on a chamfer", 0.01);
  });

  test("a door on the chamfered room's straight left wall still gets the rectangle — its neighbours run opposite ways", () => {
    const parent = chamfered();
    parent.symbols = [door("v4")];
    assert(sketch.closetShapeBehindDoor(parent, "door-1") === "rectangle", `expected "rectangle", got ${JSON.stringify(sketch.closetShapeBehindDoor(parent, "door-1"))}`);
    const closet = sketch.closetBehindDoor(parent, "door-1");
    const { p, q, centreAlong } = expectCloset(parent, closet, "v4", { widthFeet: 3.5, depthFeet: 2 });
    near((p + q) / 2, centreAlong, "closet centred on the door", 0.01);
  });

  test("a door on the connecting wall of an L (a jog: neighbours run the same way) gets the rectangle", () => {
    // Clockwise: top, right side down to the step, the 4' step going left, then down the inner
    // wall. Wall v2 is the step; v1 and v3 both run straight down, so their lines never meet.
    const parent = room([[0, 0], [144, 0], [144, 60], [96, 60], [96, 120], [0, 120]]);
    parent.symbols = [door("v2")];
    assert(sketch.closetShapeBehindDoor(parent, "door-1") === "rectangle", `expected "rectangle", got ${JSON.stringify(sketch.closetShapeBehindDoor(parent, "door-1"))}`);
    const closet = sketch.closetBehindDoor(parent, "door-1");
    expectCloset(parent, closet, "v2", { widthFeet: 3.5, depthFeet: 2 });
    // Outside the L means into the notch: x past the inner wall, y past the step.
    for (const v of closet.vertices) assert(v.x >= 96 - 0.01 && v.y >= 60 - 0.01, `corner (${v.x.toFixed(1)}, ${v.y.toFixed(1)}) is not in the notch`);
  });

  test("a short wall across a gentle kink in a wall run gets the rectangle; the same cut across a turn past the threshold is a chamfer", () => {
    // The parallel checks above have a turn of exactly zero, which any threshold passes. This one
    // pins `CHAMFER_MIN_TURN_DEG` from both sides: the kink's walls DO meet, outward and close by,
    // with 4' legs and the cut its longest side, so (b), (c) and (d) all say chamfer. A wall that
    // bends 20 degrees is still a wall, and a 4' sliver drawn behind its kink is not a closet.
    for (const turn of [20, sketch.CHAMFER_MIN_TURN_DEG - 1]) {
      const parent = kinked(turn);
      parent.symbols = [door("v1")];
      const shape = sketch.closetShapeBehindDoor(parent, "door-1");
      assert(shape === "rectangle", `a ${turn}-degree kink: expected "rectangle", got ${JSON.stringify(shape)}`);
      const closet = sketch.closetBehindDoor(parent, "door-1");
      const { p, q, centreAlong } = expectCloset(parent, closet, "v1", { widthFeet: 3.5, depthFeet: 2 });
      near((p + q) / 2, centreAlong, `a ${turn}-degree kink: closet centred on the door`, 0.01);
    }
    // One degree past the threshold and the cut is a chamfer: the closet is the corner, apex at the bend.
    const bent = kinked(sketch.CHAMFER_MIN_TURN_DEG + 1);
    bent.symbols = [door("v1")];
    const shape = sketch.closetShapeBehindDoor(bent, "door-1");
    assert(shape === "corner", `a ${sketch.CHAMFER_MIN_TURN_DEG + 1}-degree turn: expected "corner", got ${JSON.stringify(shape)}`);
    expectCorner(bent, sketch.closetBehindDoor(bent, "door-1"), "v1", KINK_X);
  });

  test("a diagonal across an INSIDE corner (X on the room's own floor) gets the rectangle, not a triangle drawn on the floor", () => {
    // The L from the jog check with its inner corner (96, 60) filled in by a 3' cut at 45 degrees:
    // the same cut `chamfered` makes, across a corner that points into the room instead of out of
    // it. Its neighbours turn a clean 90 degrees, both legs are 3' and the cut is the longest side,
    // so (a), (c) and (d) all say chamfer; only (b) sees that where the walls would have met is on
    // the floor. Without it the closet would be drawn on the floor — the failure this file exists
    // to look for, and the one nobody else does.
    const parent = room([[0, 0], [144, 0], [144, 60], [132, 60], [96, 96], [96, 120], [0, 120]]);
    assert(sketch.isInsideRoom(parent, 100, 62), "the filled-in corner should be floor (test bug otherwise)");
    parent.symbols = [door("v3")];
    assert(sketch.closetShapeBehindDoor(parent, "door-1") === "rectangle", `expected "rectangle", got ${JSON.stringify(sketch.closetShapeBehindDoor(parent, "door-1"))}`);
    const closet = sketch.closetBehindDoor(parent, "door-1");
    expectCloset(parent, closet, "v3", { widthFeet: 3.5, depthFeet: 2 });
    // Outside the cut is into what is left of the notch: past the inner wall's line and the step's.
    for (const v of closet.vertices) assert(v.x >= 96 - 0.01 && v.y >= 60 - 0.01, `corner (${v.x.toFixed(1)}, ${v.y.toFixed(1)}) is not in the notch`);
  });

  test("a 20' diagonal between square neighbours meeting 14' away is a wall, not a chamfer: the rectangle", () => {
    // 30' x 25' with the top-right corner cut by legs of 20/sqrt(2) = 14.14', so the diagonal is
    // 20'0" and the neighbours are a clean 90 degrees apart — only the 8' leg limit says no.
    const leg = 20 / Math.SQRT2;
    const parent = chamfered(30, 25, leg);
    const diagonal = sketch.wallById(parent, "v1");
    near(diagonal.lengthFeet, 20, "the diagonal really is 20' (test bug otherwise)", 0.01);
    parent.symbols = [door("v1")];
    assert(sketch.closetShapeBehindDoor(parent, "door-1") === "rectangle", `expected "rectangle", got ${JSON.stringify(sketch.closetShapeBehindDoor(parent, "door-1"))}`);
    expectCloset(parent, sketch.closetBehindDoor(parent, "door-1"), "v1", { widthFeet: 3.5, depthFeet: 2 });
    // And with legs just inside the limit, the same shape of room is a chamfer after all.
    const small = chamfered(30, 25, sketch.CHAMFER_FILL_MAX_FEET - 0.5);
    small.symbols = [door("v1")];
    assert(sketch.closetShapeBehindDoor(small, "door-1") === "corner", "7'6\" legs are within the limit");
  });

  test("a door on the short straight wall beside a chamfer gets the rectangle, not the corner its line makes with the far wall", () => {
    // 8' x 8' with 3' legs: the right wall v2 is 5'0", and the chamfer's line meets the bottom
    // wall's 5' beyond it — outward, turning 45 degrees, both legs under 8'. But the triangle has
    // its right angle at the room's own corner, so the far leg (7'1") is longer than the wall it
    // would stand on: the cut is not across a corner, and a straight wall gets the rectangle.
    const parent = chamfered(8, 8, 3);
    const wall = sketch.wallById(parent, "v2");
    near(wall.lengthFeet, 5, "the right wall is 5' (test bug otherwise)", 0.01);
    parent.symbols = [door("v2")];
    assert(sketch.closetShapeBehindDoor(parent, "door-1") === "rectangle", `expected "rectangle", got ${JSON.stringify(sketch.closetShapeBehindDoor(parent, "door-1"))}`);
    expectCloset(parent, sketch.closetBehindDoor(parent, "door-1"), "v2", { widthFeet: 3.5, depthFeet: 2 });
    // The chamfer itself, in the same small room, is still the corner.
    parent.symbols = [door("v1")];
    assert(sketch.closetShapeBehindDoor(parent, "door-1") === "corner", "the chamfer in the same room is still a chamfer");
  });

  test("the scanned office's chamfer, with the 4'3\" door the phone put in it, gets the corner", () => {
    const result = scan.importScanRoom(officeChamfer, { x: 60, y: 60 }, 1);
    assert(result.ok, `import failed: ${result.ok ? "" : result.error}`);
    const { room: imported } = result;
    const diagonal = sketch.wallsOf(imported).find((w) => w.x1 !== w.x2 && w.y1 !== w.y2);
    assert(diagonal, "expected one angled wall (test bug otherwise)");
    // The importer moves the door reported past the end of the right wall onto the chamfer; see
    // scanImport.mjs. If that ever changes, put one there by hand so this stays about the closet.
    let doorOnChamfer = imported.symbols.find((s) => s.type === "door" && s.wallId === diagonal.id);
    if (!doorOnChamfer) {
      doorOnChamfer = sketch.newSymbol("door", diagonal.id, 0.5, imported);
      imported.symbols = [...imported.symbols, doorOnChamfer];
    }
    assert(sketch.closetShapeBehindDoor(imported, doorOnChamfer.id) === "corner", `expected "corner", got ${JSON.stringify(sketch.closetShapeBehindDoor(imported, doorOnChamfer.id))}`);
    const closet = sketch.closetBehindDoor(imported, doorOnChamfer.id);
    // The apex is the corner the chamfer cut off: where the far wall (least y) meets the right
    // wall (greatest x), whichever way the importer wound the ring.
    const xs = imported.vertices.map((v) => v.x);
    const ys = imported.vertices.map((v) => v.y);
    const apex = { x: Math.max(...xs), y: Math.min(...ys) };
    expectCorner(imported, closet, diagonal.id, apex);
    // 3'0" legs at 45 degrees, give or take the inch each leg was rounded to: the whole corner.
    const whole = (diagonal.lengthPx * offWall(apex, diagonal)) / 2 / (FT * FT);
    near(whole, 4.5, "a 3' x 3' corner", 0.15);
    near(squareFeet(closet.vertices), whole * (1 - cornerShrink(imported, diagonal.id, apex)) ** 2, "less the chamfer wall", 0.01);
    assert(closet.level === 1, `closet should join the storey the room was imported on, got ${closet.level}`);
    near(closet.ceilingHeightFeet, 2.591 / 0.3048, "closet takes the scanned ceiling", 0.01);
  });

  test("closetExistsBehind: false before, true once the closet is in the sketch, false for the same closet on another storey", () => {
    const parent = box(12, 10, { level: 1 });
    parent.symbols = [door("v0"), door("v1", { id: "door-2" })];
    assert(sketch.closetExistsBehind([parent], parent, "door-1") === false, "nothing behind the door yet");
    const closet = sketch.closetBehindDoor(parent, "door-1");
    assert(sketch.closetExistsBehind([parent, closet], parent, "door-1") === true, "the closet just drawn is behind the door");
    assert(sketch.closetExistsBehind([parent, closet], parent, "door-2") === false, "the other door has no closet");
    assert(sketch.closetExistsBehind([parent, { ...closet, level: 2 }], parent, "door-1") === false, "a closet upstairs is not behind this door");
    assert(sketch.closetExistsBehind([parent, { ...closet, level: 1 }], parent, "door-1") === true, "spelling the storey out changes nothing");
    // A closet the PM has since deepened still counts: only the wall-side pair is compared.
    const deepened = { ...closet, vertices: closet.vertices.map((v) => (v.y < -(sketch.WALL_THICKNESS_PX + 1) ? { ...v, y: v.y - 36 } : v)) };
    assert(sketch.closetExistsBehind([parent, deepened], parent, "door-1") === true, "a deepened closet is still the closet");
    // One dragged clear of the wall does not: it has moved further than an inch.
    const moved = sketch.translateRoom(closet, 0, -2);
    assert(sketch.closetExistsBehind([parent, moved], parent, "door-1") === false, "a closet dragged 2\" further off the wall is a different closet");
    // One drawn before closets stood a wall off - on the wall's line, flush - is still the closet:
    // the importer must not offer a second behind the same door.
    const flush = sketch.translateRoom(closet, 0, sketch.WALL_THICKNESS_PX);
    assert(Math.max(...flush.vertices.map((v) => v.y)) === 0, "the flush closet's near edge is on the wall's line (test bug otherwise)");
    assert(sketch.closetExistsBehind([parent, flush], parent, "door-1") === true, "a closet drawn flush is still the closet behind the door");
    // The room is never its own closet, whatever its corners; a window and an unknown id are false.
    assert(sketch.closetExistsBehind([parent], parent, "no-such-symbol") === false, "an unknown id has nothing behind it");
    // And the corner: the chamfer's ends are the pair.
    const cut = chamfered(12, 10, 3, { level: 1 });
    cut.symbols = [door("v1")];
    const corner = sketch.closetBehindDoor(cut, "door-1");
    assert(sketch.closetExistsBehind([cut], cut, "door-1") === false, "no corner closet yet");
    assert(sketch.closetExistsBehind([cut, corner], cut, "door-1") === true, "the corner closet is behind the chamfer's door");
    const chamfer = sketch.wallById(cut, "v1");
    const flushCorner = { ...corner, vertices: [{ id: "a", x: chamfer.x1, y: chamfer.y1 }, { id: "b", x: 12 * FT, y: 0 }, { id: "c", x: chamfer.x2, y: chamfer.y2 }] };
    assert(sketch.closetExistsBehind([cut, flushCorner], cut, "door-1") === true, "and so is one drawn flush on the chamfer, as they were");
    // Two doors on one chamfer want the same corner — the corner has one shape whatever the door's
    // position — so once the first door's closet is in, the second door's is already there. This
    // is why the importer's "Add closets" checks each door against the closets it has just added.
    cut.symbols = [door("v1", { t: 0.3 }), door("v1", { t: 0.7, id: "door-2" })];
    assert(sketch.closetExistsBehind([cut], cut, "door-2") === false, "no closet behind the second chamfer door yet");
    assert(sketch.closetExistsBehind([cut, sketch.closetBehindDoor(cut, "door-1")], cut, "door-2") === true, "the first door's corner is the second door's corner too");
  });

  return { passed, failures };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const { passed, failures } = await runClosetChecks();
  for (const name of passed) console.log(`  ✓ ${name}`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.log(`\n  ${passed.length} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
}
