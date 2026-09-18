/**
 * What a wall's dimension label says when a sub-room stands against part of it.
 *
 *   node test/sketch/dimensions.mjs        (also runs as part of npm run test:sketch)
 *
 * Reported from the field: a bedroom with a closet drawn into its top-left corner read 15' on its
 * left wall — the whole wall, closet and all. From inside the bedroom that wall stops at the closet;
 * from inside the closet the closet's own wall is already labelled. Nobody with a tape can find 15'
 * anywhere in the house. The label should measure the stretch the PM can see, and typing over it
 * should set that stretch, with the closet staying where it was put.
 *
 * Pure geometry, so this runs in Node rather than in the browser suite next door. The label's
 * placement on the canvas is a few lines of Konva that read `WallDimension` straight; the numbers
 * are what can go wrong, and the numbers are here.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "dimension-tests-"));
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

/** A plain box, corners clockwise from the top left, in feet. */
const box = (w, h, extra = {}) => room([[0, 0], [w * FT, 0], [w * FT, h * FT], [0, h * FT]], extra);

/**
 * A 20' x 16' bedroom with a 4' x 8' closet in a corner, flush with two of its walls.
 *
 * Walls in ring order for a clockwise box: 0 top (left to right), 1 right (top to bottom), 2 bottom
 * (right to left), 3 left (BOTTOM to top). So on the left wall a closet at the top covers the END
 * of the wall and the exposed stretch starts at zero, and a closet at the bottom is the other way
 * round — which is exactly the difference the resize has to get right.
 */
function withCloset(corner) {
  const parent = box(20, 16, { id: "parent" });
  const closet =
    corner === "top-left"
      ? room([[0, 0], [48, 0], [48, 96], [0, 96]], { id: "closet", name: "Closet", parentRoomId: "parent" })
      : corner === "bottom-left"
        ? room([[0, 96], [48, 96], [48, 192], [0, 192]], { id: "closet", name: "Closet", parentRoomId: "parent" })
        : room([[192, 96], [240, 96], [240, 192], [192, 192]], { id: "closet", name: "Closet", parentRoomId: "parent" }); // bottom-right
  return { parent, closet, rooms: [parent, closet] };
}

const wall = (r, index) => wallsOf(r)[index];
let wallsOf;

/* ── the checks ───────────────────────────────────────────────────────────────────────────────── */

export async function runDimensionChecks() {
  const s = await load();
  wallsOf = s.wallsOf;
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
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}\n      expected ~${expected}\n      actual    ${actual}`);
    }
  };

  const labels = (r, index, rooms) => s.wallDimensions(r, wall(r, index), rooms);

  /* What the label says. */

  test("a wall with nothing against it has one label, for the whole wall, at its middle", () => {
    const r = box(12, 10);
    const dims = labels(r, 0, [r]);
    assert(dims.length === 1, `expected one label, got ${dims.length}`);
    near(dims[0].lengthFeet, 12, "length");
    near(dims[0].t, 0.5, "position");
    assert(dims[0].run[0] === 0 && dims[0].run[1] === 1, `run should be the whole wall, got ${dims[0].run}`);
  });

  test("the report: the wall beside a corner closet reads to the closet, not past it", () => {
    // 16' of left wall, 8' of it behind the closet. The PM sees 8' and should read 8'.
    const { parent, rooms } = withCloset("top-left");
    const dims = labels(parent, 3, rooms);
    assert(dims.length === 1, `expected one label, got ${dims.length}`);
    near(dims[0].lengthFeet, 8, "the exposed stretch");
  });

  test("and the label sits on the exposed stretch, not at the middle of the wall", () => {
    // The wall runs bottom to top and the closet is at the top, so the label is in the bottom half.
    const { parent, rooms } = withCloset("top-left");
    const [dim] = labels(parent, 3, rooms);
    near(dim.t, 0.25, "position along the wall");
  });

  test("the wall the closet shares along its other side is measured the same way", () => {
    // The top wall: 20' with the closet's 4' at its start. Its old label sat under the closet.
    const { parent, rooms } = withCloset("top-left");
    const dims = labels(parent, 0, rooms);
    assert(dims.length === 1, `expected one label, got ${dims.length}`);
    near(dims[0].lengthFeet, 16, "the exposed stretch");
    near(dims[0].t, 0.6, "centred on the stretch right of the closet");
  });

  test("a wall the closet does not touch is unchanged", () => {
    const { parent, rooms } = withCloset("top-left");
    const dims = labels(parent, 1, rooms);
    assert(dims.length === 1 && Math.abs(dims[0].lengthFeet - 16) < 0.01 && dims[0].t === 0.5, `right wall should read 16' at its middle, got ${JSON.stringify(dims)}`);
  });

  test("a closet part-way along a wall leaves a label on each side of it", () => {
    // 20' wall, closet from 5' to 10' measured from the wall's start: 5' below it, 10' above.
    const parent = box(20, 20, { id: "parent" });
    const closet = room([[0, 120], [48, 120], [48, 180], [0, 180]], { id: "closet", name: "Closet", parentRoomId: "parent" });
    const dims = labels(parent, 3, [parent, closet]);
    assert(dims.length === 2, `expected two labels, got ${dims.length}`);
    near(dims[0].lengthFeet, 5, "first stretch");
    near(dims[0].t, 0.125, "first label position");
    near(dims[1].lengthFeet, 10, "second stretch");
    near(dims[1].t, 0.75, "second label position");
  });

  test("a wall a sub-room covers end to end has no label of its own", () => {
    // The sub-room's label is drawn on the same line; two figures there would say the same thing twice.
    const parent = box(20, 16, { id: "parent" });
    const strip = room([[0, 0], [240, 0], [240, 48], [0, 48]], { id: "strip", name: "Hall", parentRoomId: "parent" });
    assert(labels(parent, 0, [parent, strip]).length === 0, "expected no label on the covered wall");
    assert(labels(parent, 2, [parent, strip]).length === 1, "and the opposite wall still has its label");
  });

  test("a room drawn beside another takes nothing off its label", () => {
    // Only genuine sub-rooms occlude — same rule as readings and cabinets.
    const { parent, closet } = withCloset("top-left");
    const neighbour = { ...closet, parentRoomId: null };
    const [dim] = labels(parent, 3, [parent, neighbour]);
    near(dim.lengthFeet, 16, "the whole wall");
    near(dim.t, 0.5, "at its middle");
  });

  test("the closet's own walls are labelled in full — they are its walls", () => {
    const { closet, rooms } = withCloset("top-left");
    const dims = labels(closet, 3, rooms);
    assert(dims.length === 1, `expected one label, got ${dims.length}`);
    near(dims[0].lengthFeet, 8, "the closet's left wall");
  });

  test("wallRunFeet measures a stretch of the wall", () => {
    const r = box(12, 10);
    near(s.wallRunFeet(wall(r, 0), [0, 1]), 12, "whole wall");
    near(s.wallRunFeet(wall(r, 0), [0.25, 0.75]), 6, "the middle half");
  });

  /* What typing over the label does. */

  test("typing over a whole-wall label is the plain resize", () => {
    const r = box(12, 10);
    const id = wall(r, 0).id;
    const viaRun = s.withWallRunLength(r, id, [0, 1], 20);
    const direct = s.withWallLength(r, id, 20);
    assert(JSON.stringify(viaRun.vertices) === JSON.stringify(direct.vertices), "expected the same room either way");
    near(s.wallById(viaRun, id).lengthFeet, 20, "length");
  });

  test("typing over the stretch beside a closet sets that stretch, and the whole wall grows by the closet", () => {
    // 8' showing, 8' behind the closet. Typing 10' should make the wall 18' and the label 10'.
    const { parent, closet, rooms } = withCloset("top-left");
    const id = wall(parent, 3).id;
    const [dim] = labels(parent, 3, rooms);
    const resized = s.withWallRunLength(parent, id, dim.run, 10);
    near(s.wallById(resized, id).lengthFeet, 18, "the whole wall");
    const [after] = labels(resized, 3, [resized, closet]);
    near(after.lengthFeet, 10, "the label afterwards");
  });

  test("the closet's corner is held, so the closet stays flush — closet at the top", () => {
    // The top-left corner is the closet's here, and it is also the corner the top-left rule holds.
    const { parent, rooms } = withCloset("top-left");
    const id = wall(parent, 3).id;
    const [dim] = labels(parent, 3, rooms);
    const resized = s.withWallRunLength(parent, id, dim.run, 10);
    const b = s.roomBounds(resized);
    near(b.minY, 0, "top edge stays");
    near(b.maxY, 18 * FT, "bottom edge moves");
  });

  test("the closet's corner is held, so the closet stays flush — closet at the BOTTOM", () => {
    /*
      Now the closet is in the bottom-left corner. The top-left rule would hold the top and move the
      bottom wall away from the closet, leaving it standing 2' clear of the wall it was drawn against.
      The bottom is held instead and the room grows upward.
    */
    const { parent, rooms } = withCloset("bottom-left");
    const id = wall(parent, 3).id;
    const [dim] = labels(parent, 3, rooms);
    near(dim.lengthFeet, 8, "the exposed stretch is above the closet");
    near(dim.t, 0.75, "and its label is in the top half");
    const resized = s.withWallRunLength(parent, id, dim.run, 10);
    const b = s.roomBounds(resized);
    near(b.maxY, 16 * FT, "bottom edge stays");
    near(b.minY, -2 * FT, "top edge moves up");
    near(s.wallById(resized, id).lengthFeet, 18, "the whole wall");
  });

  test("and the same on the right wall, which runs the other way", () => {
    // Right wall runs top to bottom; a closet at the bottom covers its END, so the end is held.
    const { parent, rooms } = withCloset("bottom-right");
    const id = wall(parent, 1).id;
    const [dim] = labels(parent, 1, rooms);
    near(dim.lengthFeet, 8, "the exposed stretch");
    near(dim.t, 0.25, "label in the top half");
    const resized = s.withWallRunLength(parent, id, dim.run, 12);
    const b = s.roomBounds(resized);
    near(b.maxY, 16 * FT, "bottom edge stays");
    near(b.minY, -4 * FT, "top edge moves up");
  });

  test("a closet at each end leaves no corner to prefer, so the top-left rule stands", () => {
    const parent = box(20, 20, { id: "parent" });
    const top = room([[0, 0], [48, 0], [48, 48], [0, 48]], { id: "c1", name: "Closet", parentRoomId: "parent" });
    const bottom = room([[0, 192], [48, 192], [48, 240], [0, 240]], { id: "c2", name: "Closet", parentRoomId: "parent" });
    const id = wall(parent, 3).id;
    const [dim] = labels(parent, 3, [parent, top, bottom]);
    near(dim.lengthFeet, 12, "the stretch between them");
    const resized = s.withWallRunLength(parent, id, dim.run, 14);
    const b = s.roomBounds(resized);
    near(b.minY, 0, "top edge stays");
    near(b.maxY, 22 * FT, "bottom edge moves");
  });

  test("a stretch that cannot be drawn leaves the room untouched, so the prompt can say so", () => {
    const { parent, rooms } = withCloset("top-left");
    const id = wall(parent, 3).id;
    const [dim] = labels(parent, 3, rooms);
    const resized = s.withWallRunLength(parent, id, dim.run, -3);
    assert(resized === parent, "expected the same room back");
  });

  /*
    Whether the closet counts as a sub-room in the first place — which every label above depends on.

    Found while looking at the labels: a closet snapped flush into the BOTTOM-RIGHT corner was not
    nesting at all. The point-in-polygon test puts a boundary point on one side or the other, and it
    happened to count the top and left edges in and the bottom and right edges out, so the same
    closet nested in two corners of the room and not in the other two.
  */

  test("a closet flush in the top-left corner is inside its room", () => {
    const { parent, closet } = withCloset("top-left");
    assert(s.isRoomInside({ ...closet, parentRoomId: null }, parent), "expected inside");
    assert(s.containingRoomId([parent, { ...closet, parentRoomId: null }], "closet") === "parent", "and derived as its sub-room");
  });

  test("and so is one flush in the bottom-right corner — every edge counts, not just two of them", () => {
    const { parent, closet } = withCloset("bottom-right");
    const loose = { ...closet, parentRoomId: null };
    assert(s.isRoomInside(loose, parent), "expected inside");
    const derived = s.withDerivedParents([parent, loose]);
    assert(derived[1].parentRoomId === "parent", `expected the closet nested, got ${derived[1].parentRoomId}`);
    // Which is what makes the right wall read 8' beside it instead of 16'.
    const [dim] = labels(parent, 1, derived);
    near(dim.lengthFeet, 8, "the right wall beside the closet");
  });

  test("a room drawn beside another, sharing a wall, is still not inside it", () => {
    const parent = box(20, 16, { id: "parent" });
    const beside = room([[240, 0], [300, 0], [300, 192], [240, 192]], { id: "beside", name: "Hall" });
    assert(!s.isRoomInside(beside, parent), "expected not inside");
    assert(s.containingRoomId([parent, beside], "beside") === null, "and no parent derived");
  });

  test("a room a hair outside its neighbour is still not inside it", () => {
    // Half a pixel is the allowance. A full pixel out is out.
    const parent = box(20, 16, { id: "parent" });
    const poking = room([[192, 96], [241, 96], [241, 192], [192, 192]], { id: "poking", name: "Closet" });
    assert(!s.isRoomInside(poking, parent), "expected not inside");
    // The nudge is towards the room's own middle, so on a long flat strip it is almost entirely
    // sideways — the case that would let an over-generous allowance pull a corner back in.
    const strip = room([[96, 180], [241, 180], [241, 192], [96, 192]], { id: "strip", name: "Ledge" });
    assert(!s.isRoomInside(strip, parent), "expected the strip a pixel past the wall not inside either");
  });

  test("two rooms of one size on top of each other are not each inside the other", () => {
    // Every edge counting would otherwise make a cycle of them. Neither is anyone's closet.
    const a = box(12, 10, { id: "a" });
    const b = box(12, 10, { id: "b" });
    assert(!s.isRoomInside(a, b) && !s.isRoomInside(b, a), "expected neither inside the other");
    const derived = s.withDerivedParents([a, b]);
    assert(derived.every((r) => r.parentRoomId === null), "and no parents derived");
  });

  /*
    Where along the wall an opening sits — the dimensions shown from each jamb to the end of the
    wall while a door, opening or window is selected or slid.
  */

  const door = (wallId, t, widthFeet = 3) => ({
    id: "door-1",
    wallId,
    t,
    widthFraction: 0.25,
    widthFeet,
    type: "door",
    doorType: "swing",
    leaves: "single",
    heightFeet: 6.67,
    flipX: false,
    flipY: false,
  });

  test("a door in the middle of a 12' wall is 4'6\" from either corner", () => {
    const r = box(12, 10);
    const o = s.symbolOffsetsPx(door(wall(r, 0).id, 0.5), r, [r]);
    near(o.from, 0, "measured from the wall's start");
    near(o.to, 144, "to its end");
    near(o.x0 - o.from, 54, "near jamb to the corner");
    near(o.to - o.x1, 54, "far jamb to the corner");
  });

  test("a door slid towards a corner reads the smaller distance on that side", () => {
    const r = box(12, 10);
    // Centre at 2' along: jambs at 6\" and 3'6\".
    const o = s.symbolOffsetsPx(door(wall(r, 0).id, 2 / 12), r, [r]);
    near(o.x0 - o.from, 6, "6\" to the near corner");
    near(o.to - o.x1, 144 - 42, "10'6\" to the far one");
  });

  test("beside a closet the distance is to the closet's wall, the corner a tape would hook on", () => {
    // 20' top wall, 4' of it the closet's. A door centred on the wall is 4'6\" from the closet.
    const { parent, rooms } = withCloset("top-left");
    const o = s.symbolOffsetsPx(door(wall(parent, 0).id, 0.5), parent, rooms);
    near(o.from, 48, "measured from the closet's wall");
    near(o.to, 240, "to the room's far corner");
    near(o.x0 - o.from, 120 - 18 - 48, "door to closet");
  });

  test("a closet door on the covered stretch is measured against the whole wall", () => {
    // Its centre is behind the closet; the closet's ends are not this door's ends.
    const { parent, rooms } = withCloset("top-left");
    const o = s.symbolOffsetsPx(door(wall(parent, 0).id, 0.1, 2), parent, rooms);
    near(o.from, 0, "from the wall's start");
    near(o.to, 240, "to its end");
  });

  test("a wall the symbol is not on gives nothing to measure", () => {
    const r = box(12, 10);
    assert(s.symbolOffsetsPx(door("no-such-wall", 0.5), r, [r]) === null, "expected null");
  });

  return { passed, failures };
}

/* ── standalone ───────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runDimensionChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
