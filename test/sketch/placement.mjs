/**
 * Where a cabinet is allowed to be.
 *
 *   node test/sketch/placement.mjs        (also runs first as part of npm run test:sketch)
 *
 * Reported from the field: a cabinet drawn 8'11" long on a wall shorter than that, hanging out of
 * the room into the notch of an L. Three separate holes let a block leave the room, and none of them
 * announces itself — the drawing simply shows something that does not exist, and the quantities read
 * off it are wrong in the same direction:
 *
 *   * a wall symbol had no upper bound on its width, so it could be longer than its own wall — most
 *     often because the wall was SHORTENED after the cabinet was placed on it
 *   * an island's containment tested only its centre point, so a long block could hang most of its
 *     length outside the floor
 *   * resizing an island wrote the new size before checking it, so a handle dragged outward pushed
 *     the block through a wall
 *
 * Pure geometry, so this runs in Node rather than in the browser suite next door.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "placement-tests-"));
  const outfile = join(outDir, "sketch.mjs");
  await build({
    entryPoints: [join(root, "lib", "sketch.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

const FT = 12; // PIXELS_PER_FOOT — one pixel is one inch.

function room(vertices, extra = {}) {
  return {
    id: "room-1",
    name: "Kitchen",
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

/** A plain 12' x 10' box, corners clockwise from the top left. */
const box = (w = 12, h = 10) => room([[0, 0], [w * FT, 0], [w * FT, h * FT], [0, h * FT]]);

/**
 * An L, 12' x 10' with a 6' x 4' bite out of the bottom left — the shape in the report.
 *
 *   (0,0) ─────────────── (144,0)
 *     │                      │
 *     │                      │
 *   (0,72) ──── (72,72)      │
 *                 │          │
 *              (72,120) ─ (144,120)
 */
const lRoom = () => room([[0, 0], [144, 0], [144, 120], [72, 120], [72, 72], [0, 72]]);

/**
 * A 12' x 10' room with a 2' slot cut into it from the top, reaching down to y=90 — a chimney
 * breast, or the back of a closet belonging to the next room.
 *
 * Here to catch what an L cannot. Any rectangle straddling an L's inside corner already has one of
 * its own corners off the floor, so a corners-only containment test passes that shape by luck. A
 * slot can sit in the MIDDLE of a rectangle with all four of its corners on floor, so it is the
 * shape that proves the walls themselves are being checked.
 *
 *   (0,0) ─── (60,0)   (84,0) ─────── (144,0)
 *     │          │       │               │
 *     │       (60,90)─(84,90)            │
 *     │                                  │
 *   (0,120) ───────────────────────── (144,120)
 */
const slotRoom = () =>
  room([[0, 0], [60, 0], [60, 90], [84, 90], [84, 0], [144, 0], [144, 120], [0, 120]]);

function cabinet(wallId, { widthFeet, t = 0.5, depthFeet = 2 }) {
  return {
    id: "sym-1",
    wallId,
    t,
    widthFraction: 0.5,
    widthFeet,
    type: "cabinet",
    label: "Cabinet",
    tier: "base",
    depthFeet,
    heightFeet: 3,
  };
}

function door(wallId, { widthFeet, t = 0.5 }) {
  return {
    id: "sym-2",
    wallId,
    t,
    widthFraction: 0.5,
    widthFeet,
    type: "door",
    doorType: "standard",
    leaves: "single",
    heightFeet: 6.67,
    flipX: false,
    flipY: false,
  };
}

function island({ x, y, widthFeet, depthFeet }) {
  return {
    id: "isl-1",
    x,
    y,
    widthPx: widthFeet * FT,
    depthPx: depthFeet * FT,
    widthFeet,
    depthFeet,
    label: "Island",
    tier: "base",
  };
}

/* ── the checks ───────────────────────────────────────────────────────────────────────────────── */

export async function runPlacementChecks() {
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

  const near = (actual, expected, message, tolerance = 0.05) => {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}\n      expected ~${expected}\n      actual    ${actual}`);
    }
  };

  /* A wall symbol can never be wider than its wall. */

  test("a cabinet longer than its wall is drawn only as long as the wall", () => {
    // The report: 8'11" of cabinet on a 6' wall.
    const r = box(6, 10);
    const wall = s.wallsOf(r)[0];
    near(s.symbolWidthPx(cabinet(wall.id, { widthFeet: 8.917 }), r), 6 * FT, "drawn width");
  });

  test("and reports that same width, so the label and the quantities agree with the drawing", () => {
    // Not cosmetic: the wall-area deduction is taken from this. A 9' cabinet on a 6' wall would
    // deduct more wall than the wall has.
    const r = box(6, 10);
    const wall = s.wallsOf(r)[0];
    near(s.symbolWidthFeet(cabinet(wall.id, { widthFeet: 8.917 }), r), 6, "reported width in feet");
  });

  test("a cabinet that fits is left exactly as it is", () => {
    const r = box(12, 10);
    const wall = s.wallsOf(r)[0];
    near(s.symbolWidthPx(cabinet(wall.id, { widthFeet: 4 }), r), 4 * FT, "drawn width");
    near(s.symbolWidthFeet(cabinet(wall.id, { widthFeet: 4 }), r), 4, "reported width");
  });

  test("shortening a wall shortens the cabinet on it", () => {
    // The commonest way into the bug: place the cabinet, then pull the wall in.
    const wide = box(12, 10);
    const wall = s.wallsOf(wide)[0];
    const c = cabinet(wall.id, { widthFeet: 10 });
    near(s.symbolWidthFeet(c, wide), 10, "before");

    const narrowed = room([[0, 0], [7 * FT, 0], [7 * FT, 120], [0, 120]]);
    const sameWall = s.wallsOf(narrowed)[0];
    near(s.symbolWidthFeet({ ...c, wallId: sameWall.id }, narrowed), 7, "after");
  });

  test("dragging the width handle past the corner stores the capped width", () => {
    // Capped on write as well as on read, so the stored number does not drift past the drawing.
    const r = box(6, 10);
    const wall = s.wallsOf(r)[0];
    const grown = s.withSymbolWidthPx(cabinet(wall.id, { widthFeet: 3 }), r, 20 * FT);
    near(grown.widthFeet, 6, "stored width in feet");
  });

  /* A wall symbol also cannot hang off the END of its wall. */

  test("a cabinet whose fraction puts it past the corner is drawn inside the wall", () => {
    /*
      The second report, and a hole left by the width cap alone. `t` is a FRACTION, so it pins the
      symbol's MIDDLE. A 10'9" cabinet is a legal width on a 12' wall — the cap never fires — and at
      t = 0.9 its centre sits at 10'10", putting more than five feet of it past the far corner and
      out of the room. That is the drawing in the report: a cabinet hanging below the room.
    */
    const r = box(12, 12);
    const wall = s.wallsOf(r)[0];
    const c = cabinet(wall.id, { widthFeet: 10.75, t: 0.9 });
    const half = s.symbolWidthPx(c, r) / 2;
    const centre = s.symbolCentrePx(c, r);
    assert(centre + half <= wall.lengthPx + 0.05, `the far end is past the corner by ${centre + half - wall.lengthPx}px`);
    assert(centre - half >= -0.05, `the near end is before the corner by ${-(centre - half)}px`);
  });

  test("and is pushed only as far as it has to be", () => {
    // Flush to the far corner, not recentred — a cabinet run ends where the wall does.
    const r = box(12, 12);
    const wall = s.wallsOf(r)[0];
    const c = cabinet(wall.id, { widthFeet: 10.75, t: 0.9 });
    near(s.symbolCentrePx(c, r), wall.lengthPx - (10.75 * FT) / 2, "centre");
  });

  test("the same at the near corner", () => {
    const r = box(12, 12);
    const wall = s.wallsOf(r)[0];
    const c = cabinet(wall.id, { widthFeet: 10.75, t: 0.05 });
    near(s.symbolCentrePx(c, r), (10.75 * FT) / 2, "centre");
  });

  test("a cabinet that already fits where it sits is not moved", () => {
    const r = box(12, 12);
    const wall = s.wallsOf(r)[0];
    const c = cabinet(wall.id, { widthFeet: 4, t: 0.5 });
    near(s.symbolCentrePx(c, r), wall.lengthPx / 2, "centre");
  });

  test("shortening a wall pulls the cabinet on it back inside", () => {
    // Nothing re-clamps a stored position when the room changes shape, so this has to hold on read
    // or a sketch stays wrong until somebody happens to drag that cabinet again.
    const wide = box(20, 12);
    const wall = s.wallsOf(wide)[0];
    // t = 0.7 puts an 8' cabinet's far end at 18' on a 20' wall, comfortably inside it.
    const c = cabinet(wall.id, { widthFeet: 8, t: 0.7 });
    near(s.symbolCentrePx(c, wide), 0.7 * 20 * FT, "before, where it fits");

    const narrow = box(12, 12);
    const sameWall = s.wallsOf(narrow)[0];
    const moved = { ...c, wallId: sameWall.id };
    assert(
      s.symbolCentrePx(moved, narrow) + s.symbolWidthPx(moved, narrow) / 2 <= 12 * FT + 0.05,
      "expected the cabinet to be brought back within the shortened wall",
    );
  });

  test("the wall's free space accounts for where a cabinet really is", () => {
    /*
      `wallGripSpan` decides where the handle for dragging a wall goes: the middle of the longest
      stretch no symbol stands on. Measuring that from the raw fraction would reserve space out past
      the corner and leave the grip sitting on top of the cabinet.
    */
    const r = box(12, 12);
    const wall = s.wallsOf(r)[0];
    const withCabinet = { ...r, symbols: [cabinet(wall.id, { widthFeet: 10.75, t: 0.9 })] };
    const grip = s.wallGripSpan(withCabinet, s.wallsOf(withCabinet)[0]);
    // The cabinet is flush to the far end, so the only clear stretch is the 1'3" at the near end.
    assert(grip === null || grip.t * wall.lengthPx < (12 - 10.75) * FT + 1, `grip landed at t=${grip?.t}`);
  });

  /* Ends snap flush to the corners — cabinets and fixtures only. */

  test("a cabinet slid near a corner goes flush to it", () => {
    const r = box(12, 10);
    const wall = s.wallsOf(r)[0];
    const c = cabinet(wall.id, { widthFeet: 4 });
    const moved = s.moveSymbolAlongWall(c, r, 4 * FT / 2 + 4); // 4px shy of flush
    near(moved.t * wall.lengthPx, (4 * FT) / 2, "centre, which should sit half a cabinet from the corner");
  });

  test("and the same at the far end", () => {
    const r = box(12, 10);
    const wall = s.wallsOf(r)[0];
    const c = cabinet(wall.id, { widthFeet: 4 });
    const moved = s.moveSymbolAlongWall(c, r, wall.lengthPx - (4 * FT) / 2 - 4);
    near(moved.t * wall.lengthPx, wall.lengthPx - (4 * FT) / 2, "centre near the far corner");
  });

  test("a cabinet in the middle of a wall is left where it was put", () => {
    const r = box(12, 10);
    const wall = s.wallsOf(r)[0];
    const moved = s.moveSymbolAlongWall(cabinet(wall.id, { widthFeet: 4 }), r, 70);
    near(moved.t * wall.lengthPx, 70, "centre");
  });

  test("a door near a corner does NOT snap flush", () => {
    // There is a jamb and usually a stud. Snapping a door into the corner would fight the PM.
    const r = box(12, 10);
    const wall = s.wallsOf(r)[0];
    const asked = (3 * FT) / 2 + 4;
    const moved = s.moveSymbolAlongWall(door(wall.id, { widthFeet: 3 }), r, asked);
    near(moved.t * wall.lengthPx, asked, "centre");
  });

  /* An island has to fit entirely on floor. */

  test("an island well inside the room can be placed", () => {
    const r = box(12, 10);
    const moved = s.moveFreeCabinet(island({ x: 0, y: 0, widthFeet: 6, depthFeet: 3 }), r, 40, 40);
    near(moved.x, 40, "x");
    near(moved.y, 40, "y");
  });

  test("an island cannot be parked in the notch of an L", () => {
    const r = lRoom();
    const before = island({ x: 100, y: 20, widthFeet: 3, depthFeet: 2 });
    const moved = s.moveFreeCabinet(before, r, 12, 84); // squarely in the missing corner
    assert(moved.x === before.x && moved.y === before.y, `expected the move to be refused, got ${moved.x},${moved.y}`);
  });

  test("an island cannot hang out of the room with only its middle on floor", () => {
    /*
      THE REPORTED BUG. Containment used to test the centre point alone, so a long block could sit
      with its centre on floor and most of its length out in the notch, which is exactly what the
      screenshot showed.
    */
    const r = lRoom();
    const before = island({ x: 90, y: 10, widthFeet: 2, depthFeet: 8 });
    // Centre would land at (12+12, 24+48) = inside the floor; the bottom half would not.
    const moved = s.moveFreeCabinet(before, r, 12, 24);
    assert(moved.y === before.y, `expected the move to be refused, got y=${moved.y}`);
  });

  test("an island cannot straddle the inside corner of an L", () => {
    /*
      All four corners can be on floor while the block swallows the concave corner between them, so
      the walls are checked for crossing it as well as the corners for being inside.
    */
    const r = lRoom();
    const before = island({ x: 90, y: 10, widthFeet: 4, depthFeet: 4 });
    const moved = s.moveFreeCabinet(before, r, 60, 60);
    assert(moved.x === before.x && moved.y === before.y, `expected the move to be refused, got ${moved.x},${moved.y}`);
  });

  test("an island cannot be laid across a slot in the room", () => {
    /*
      Every corner of this block is on floor and the middle of it is not — the chimney breast passes
      straight through it. Corners alone would wave it through, so the room's walls are checked for
      crossing the block as well.
    */
    const r = slotRoom();
    const before = island({ x: 40, y: 92, widthFeet: 64 / FT, depthFeet: 28 / FT });
    const moved = s.moveFreeCabinet(before, r, 40, 80);
    assert(moved.y === before.y, `expected the move to be refused, got y=${moved.y}`);
  });

  test("but the same island fits beside that slot", () => {
    // The check above must reject the block for spanning the slot, not for being large.
    const r = slotRoom();
    const moved = s.moveFreeCabinet(island({ x: 40, y: 92, widthFeet: 64 / FT, depthFeet: 28 / FT }), r, 40, 92);
    near(moved.x, 40, "x");
    near(moved.y, 92, "y");
  });

  test("an island can sit flush against a wall", () => {
    // The placement the snapping exists to produce, so it must not read as out of the room.
    const r = box(12, 10);
    const moved = s.moveFreeCabinet(island({ x: 40, y: 40, widthFeet: 6, depthFeet: 3 }), r, 0, 0);
    near(moved.x, 0, "x");
    near(moved.y, 0, "y");
  });

  /* Edges snap flush to nearby walls. */

  test("an island dropped near a wall goes flush to it", () => {
    const r = box(12, 10);
    const moved = s.moveFreeCabinet(island({ x: 60, y: 60, widthFeet: 6, depthFeet: 3 }), r, 4, 50);
    near(moved.x, 0, "x, which should have snapped to the left wall");
    near(moved.y, 50, "y, which is nowhere near a wall and should not have moved");
  });

  test("an island near the far wall snaps by its far edge", () => {
    const r = box(12, 10);
    const width = 6 * FT;
    const moved = s.moveFreeCabinet(island({ x: 10, y: 60, widthFeet: 6, depthFeet: 3 }), r, 144 - width - 4, 50);
    near(moved.x, 144 - width, "x, which should have put its right edge on the right wall");
  });

  test("an island is not pulled sideways to a wall it does not run alongside", () => {
    /*
      In an L, the short wall at x=72 only exists below y=72. A block up in the top right must not
      jump to line up with it.
    */
    const r = lRoom();
    const moved = s.moveFreeCabinet(island({ x: 100, y: 10, widthFeet: 2, depthFeet: 2 }), r, 76, 10);
    near(moved.x, 76, "x");
  });

  /* Resizing stops at the wall rather than growing through it. */

  test("growing an island into a wall stops at the wall", () => {
    const r = box(12, 10);
    const at = island({ x: 100, y: 40, widthFeet: 2, depthFeet: 2 });
    const grown = s.withFreeCabinetSizePx(at, r, 20 * FT, 2 * FT);
    assert(grown.widthPx <= 144 - 100 + 0.5, `expected the width to stop at the wall, got ${grown.widthPx}`);
    assert(grown.widthPx > 2 * FT, `expected it to grow at all, got ${grown.widthPx}`);
  });

  test("growing an island with room to spare gets the size asked for", () => {
    const r = box(12, 10);
    const at = island({ x: 10, y: 10, widthFeet: 2, depthFeet: 2 });
    const grown = s.withFreeCabinetSizePx(at, r, 6 * FT, 3 * FT);
    near(grown.widthPx, 6 * FT, "width");
    near(grown.depthPx, 3 * FT, "depth");
  });

  return { passed, failures };
}

/* ── standalone ───────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runPlacementChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
