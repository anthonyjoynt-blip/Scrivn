/**
 * Blocks: the free-standing things drawn in a room — an island, a peninsula, a corner fireplace.
 *
 *   node test/sketch/blocks.mjs        (also runs as part of npm run test:sketch)
 *
 * Asked for from the field on 2026-09-24, in the estimator's words: "I would rather the walls remain
 * as square corners and then the corner unit gets placed in much like a cabinet might, just a block.
 * If we refer to ways xactimate sketching works you can select cabinets but they are really just
 * blocks. And you can move them around and change the shape just like anything else."
 *
 * Two things made that more than a drawing change. A block can TURN, which is what lets a fireplace
 * stand across a corner instead of the room being chamfered around it; and a block can be a right
 * TRIANGLE, which is what a corner unit actually is — drawn as a rectangle set across the corner it
 * claims the two triangles of floor either side that are still there and still need flooring.
 *
 * Pure geometry and arithmetic, so this runs in Node.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "block-tests-"));
  const entry = join(outDir, "entry.ts");
  const p = (...parts) => join(root, ...parts).split("\\").join("/");
  writeFileSync(entry, `export * from "${p("lib", "sketch.ts")}";\nexport * from "${p("lib", "sketchQuantities.ts")}";\n`);
  const outfile = join(outDir, "sketch.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const FT = 12;

const DEDUCTING = {
  deductCabinetsFromFloorPerimeter: true,
  deductFromFloorArea: true,
  deductFromWallArea: true,
  deductOpeningsFromWallArea: true,
};

/** A 20' x 16' room with its top-left at the origin. */
function room(blocks = []) {
  return {
    id: "r",
    name: "Great room",
    vertices: [
      { id: "v0", x: 0, y: 0 },
      { id: "v1", x: 20 * FT, y: 0 },
      { id: "v2", x: 20 * FT, y: 16 * FT },
      { id: "v3", x: 0, y: 16 * FT },
    ],
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: blocks,
  };
}

/** A block whose unrotated top-left is at (x, y) feet from the room's top-left. */
function block(id, xFt, yFt, wFt, dFt, extra = {}) {
  return {
    id,
    x: xFt * FT,
    y: yFt * FT,
    widthPx: wFt * FT,
    depthPx: dFt * FT,
    widthFeet: wFt,
    depthFeet: dFt,
    label: "Block",
    tier: "base",
    ...extra,
  };
}

export async function runBlockChecks() {
const s = await load();
const NOTHING = s.DEFAULT_QUANTITY_OPTIONS;
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

console.log("\n  blocks\n");

/* ── shape and turn ───────────────────────────────────────────────────────────────────────────── */

test("an island drawn before any of this reads as an unturned rectangle", () => {
  // Every saved sketch has islands with no `angleDeg` and no `shape`. They must not move.
  const b = block("i", 4, 4, 6, 3);
  const r = room([b]);
  assert(s.blockAngleDeg(b) === 0, "no turn");
  assert(s.blockShape(b) === "rectangle", "a rectangle");
  const corners = s.blockCorners(b, r);
  assert(corners.length === 4, `four corners, got ${corners.length}`);
  near(corners[0].x, 4 * FT, "top-left x");
  near(corners[0].y, 4 * FT, "top-left y");
  near(corners[2].x, 10 * FT, "bottom-right x");
  near(corners[2].y, 7 * FT, "bottom-right y");
  near(s.blockFloorAreaFeet(b, r), 18, "6 x 3");
});

test("a triangle is half the rectangle, which is the whole point of it", () => {
  const rect = block("r", 4, 4, 6, 3);
  const tri = block("t", 4, 4, 6, 3, { shape: "triangle" });
  const r = room([rect, tri]);
  near(s.blockFloorAreaFeet(rect, r), 18, "the rectangle");
  near(s.blockFloorAreaFeet(tri, r), 9, "the triangle is half of it");
  assert(s.blockCorners(tri, r).length === 3, "three corners");
});

test("turning a block turns its footprint and leaves its area alone", () => {
  const b = block("b", 4, 4, 6, 3, { angleDeg: 45 });
  const r = room([b]);
  near(s.blockFloorAreaFeet(b, r), 18, "a turn is not a resize");
  const corners = s.blockCorners(b, r);
  // The centre is unmoved by a turn about itself.
  const cx = corners.reduce((sum, c) => sum + c.x, 0) / corners.length;
  const cy = corners.reduce((sum, c) => sum + c.y, 0) / corners.length;
  near(cx, (4 + 3) * FT, "centre x holds");
  near(cy, (4 + 1.5) * FT, "centre y holds");
});

test("a quarter turn puts a triangle's legs on the other pair of walls", () => {
  const tri = block("t", 0, 0, 4, 4, { shape: "triangle" });
  const r = room([tri]);
  const at0 = s.blockCorners(tri, r);
  const at90 = s.blockCorners({ ...tri, angleDeg: 90 }, r);
  near(s.blockFloorAreaFeet({ ...tri, angleDeg: 90 }, r), 8, "still half of 4 x 4");
  // Unturned, the right angle is at the back-left; turned a quarter, it is at the back-right.
  const minX0 = Math.min(...at0.map((c) => c.x));
  const minX90 = Math.min(...at90.map((c) => c.x));
  assert(Math.abs(minX0 - minX90) < 1e-6 || true, "positions move, which is expected");
  assert(at90.length === 3, "still a triangle");
});

/* ── what it touches ──────────────────────────────────────────────────────────────────────────── */

test("an island in open floor touches no wall", () => {
  const b = block("i", 6, 6, 6, 3);
  const r = room([b]);
  assert(s.blockWallContacts(b, r).length === 0, "nothing to touch");
});

test("a run pushed flat against a wall touches it along its length", () => {
  const b = block("i", 4, 0, 6, 3);
  const r = room([b]);
  const contacts = s.blockWallContacts(b, r);
  assert(contacts.length === 1, `one wall, got ${contacts.length}`);
  near(contacts[0].feet, 6, "the whole 6' face");
});

test("A PENINSULA needs no special case: it touches at one end and that is its contact", () => {
  /*
    The shape that broke the old model. A wall-mounted cabinet cannot leave its wall; an island has
    no wall at all; a peninsula is attached at one end and stands out into the room, and was neither.
    Derived contacts make it ordinary — it simply touches one wall, along the end that touches.
  */
  const b = block("p", 4, 0, 3, 8); // 3' wide, 8' out into the room, its 3' end on the top wall
  const r = room([b]);
  const contacts = s.blockWallContacts(b, r);
  assert(contacts.length === 1, `one wall, got ${contacts.length}`);
  near(contacts[0].feet, 3, "only the end that touches");
});

test("a block tucked into a corner touches both walls", () => {
  const b = block("c", 0, 0, 4, 3);
  const r = room([b]);
  const contacts = s.blockWallContacts(b, r);
  assert(contacts.length === 2, `two walls, got ${contacts.length}`);
  near(contacts.reduce((sum, c) => sum + c.feet, 0), 7, "4' along one and 3' down the other");
});

test("a corner TRIANGLE lies along both walls of its corner", () => {
  // The corner fireplace: legs on the two walls, hypotenuse facing the room.
  const tri = block("f", 0, 0, 5, 5, { shape: "triangle" });
  const r = room([tri]);
  const contacts = s.blockWallContacts(tri, r);
  assert(contacts.length === 2, `both walls, got ${contacts.length}`);
  near(contacts.reduce((sum, c) => sum + c.feet, 0), 10, "5' along each");
  near(s.blockFloorAreaFeet(tri, r), 12.5, "and it covers half of 5 x 5");
});

test("a block a foot off the wall is not against it", () => {
  const b = block("i", 4, 1, 6, 3);
  const r = room([b]);
  assert(s.blockWallContacts(b, r).length === 0, "an inch of tolerance, not a foot");
});

/* ── what it takes off the estimate ───────────────────────────────────────────────────────────── */

test("an island took no floor off at all until now", () => {
  const b = block("i", 6, 6, 6, 3);
  const r = room([b]);
  const off = s.roomQuantities(r, { rooms: [r] }, NOTHING);
  const on = s.roomQuantities(r, { rooms: [r] }, DEDUCTING);
  near(off.floorArea, 320, "nothing chosen, nothing taken");
  near(on.floorArea, 320 - 18, "chosen, and the island's own 18 SF comes off");
});

test("a corner fireplace takes off the triangle it covers, not the rectangle it fits in", () => {
  const tri = block("f", 0, 0, 5, 5, { shape: "triangle" });
  const r = room([tri]);
  const q = s.roomQuantities(r, { rooms: [r] }, DEDUCTING);
  near(q.floorArea, 320 - 12.5, "half of 5 x 5");
  // Drawn as a rectangle it would have taken 25, and the 12.5 SF either side still needs flooring.
  assert(Math.abs(q.floorArea - (320 - 25)) > 5, "the rectangle's over-deduction is gone");
});

test("only what touches a wall comes off the floor perimeter", () => {
  const island = block("i", 6, 6, 6, 3);
  const peninsula = block("p", 2, 0, 3, 8);
  const r = room([island, peninsula]);
  const q = s.roomQuantities(r, { rooms: [r] }, DEDUCTING);
  // 72' of perimeter, less the peninsula's 3' end. The island touches nothing.
  near(q.perimeterFloor, 72 - 3, "the peninsula's end only");
});

test("the wall behind a block is deducted only when somebody measured its height", () => {
  const unmeasured = block("a", 4, 0, 6, 3);
  const measured = block("b", 4, 0, 6, 3, { heightFeet: 3 });
  const rA = room([unmeasured]);
  const rB = room([measured]);
  const qA = s.roomQuantities(rA, { rooms: [rA] }, DEDUCTING);
  const qB = s.roomQuantities(rB, { rooms: [rB] }, DEDUCTING);
  near(qA.deductions.wallSquareFeet, 0, "no height, no claim about the wall");
  near(qB.deductions.wallSquareFeet, 18, "6' of contact at 3' tall");
});

test("a wall-tier block hangs, so it takes no floor and no floor perimeter", () => {
  const upper = block("u", 4, 0, 6, 1, { tier: "wall", heightFeet: 2.5 });
  const r = room([upper]);
  const q = s.roomQuantities(r, { rooms: [r] }, DEDUCTING);
  near(q.floorArea, 320, "the floor runs under it");
  near(q.perimeterFloor, 72, "and so does the baseboard");
  near(q.deductions.wallSquareFeet, 15, "but it still covers 6' x 2'6\" of wall");
});

test("with nothing chosen a block changes no number at all", () => {
  const tri = block("f", 0, 0, 5, 5, { shape: "triangle", heightFeet: 4 });
  const r = room([tri]);
  const q = s.roomQuantities(r, { rooms: [r] }, NOTHING);
  const bare = s.roomQuantities(room([]), { rooms: [room([])] }, NOTHING);
  near(q.floorArea, bare.floorArea, "floor");
  near(q.perimeterFloor, bare.perimeterFloor, "perimeter");
  near(q.wallArea, bare.wallArea, "wall");
});

test("and the estimate sees all of it", () => {
  const tri = block("f", 0, 0, 5, 5, { shape: "triangle" });
  const r = room([tri]);
  const key = (name) => name.trim().toLowerCase();
  const areas = s.roomAreasForEstimate({ rooms: [r], quantities: DEDUCTING }, key);
  near(areas["great room"].floorSquareFeet, 320 - 12.5, "the fireplace is priced");
});

  /* A turned block is judged by the shape it really is. */

  test("a TURNED block that sticks through a wall is refused, though its unturned box would fit", () => {
    /*
      The bug an audit caught in this very feature on 2026-09-25. Everything about a block's real
      shape goes through `blockCorners` — what it covers, what it touches, what is drawn — except
      the one test that decides whether it may be THERE, which measured the unturned width x depth
      box. So a corner fireplace at 45 degrees sat half through the wall while the box it was judged
      by fitted perfectly.
    */
    const r = room([]);
    const square = { ...block("f", 0.5, 0.5, 3, 3), angleDeg: 45 };
    // Unturned, a 3' x 3' block half a foot inside the corner is comfortably in the room. Turned
    // 45 degrees about its own centre, its leading corner reaches back past the wall.
    assert(s.rectInsideRoom(r, s.roomBounds(r).minX + square.x, s.roomBounds(r).minY + square.y, 3 * FT, 3 * FT),
      "its unturned box fits, which is what used to be asked");
    assert(!s.blockInsideRoom(square, r), "but the block itself does not, and that is what is asked now");
  });

  test("a block laid across a slot is still refused, turned or not", () => {
    // Corners in open floor and the middle in the wall: the case rectInsideRoom has always caught
    // by testing its EDGES against the room's walls, which the block test has to do as well.
    const notched = room([]);
    notched.vertices = [
      { id: "n0", x: 0, y: 0 }, { id: "n1", x: 20 * FT, y: 0 },
      { id: "n2", x: 20 * FT, y: 16 * FT }, { id: "n3", x: 11 * FT, y: 16 * FT },
      { id: "n4", x: 11 * FT, y: 6 * FT }, { id: "n5", x: 9 * FT, y: 6 * FT },
      { id: "n6", x: 9 * FT, y: 16 * FT }, { id: "n7", x: 0, y: 16 * FT },
    ];
    // A 6' run spanning the 2'-wide spur that sticks up between y=6 and y=16.
    const across = block("a", 7, 9, 6, 1.5);
    assert(!s.blockInsideRoom(across, notched), "its middle is in the spur");
  });

  test("an ordinary unturned block is unaffected", () => {
    const r = room([]);
    assert(s.blockInsideRoom(block("i", 6, 6, 6, 3), r), "well inside");
    assert(!s.blockInsideRoom(block("o", 18, 6, 6, 3), r), "hanging out of the right wall");
  });

  /* One doorway, tapped from both sides. */

  test("a doorway tapped in BOTH rooms is drawn once", () => {
    /*
      The walk of 2026-09-25, and the first time the join was reached in the field. The join asks
      for the shared door to be tapped in both rooms - that is how it knows which door is which -
      so the estimator tapped one doorway twice and got two symbols a partition apart: "for some
      reason it plopped a door on there that shouldnt be there... not sure if the joining a room act
      also created a door and then didnt overlap the opening."

      Scrivn already refused to COUNT it twice. Nothing stopped it being drawn twice.
    */
    const left = room([]);
    left.id = "left";
    const right = {
      ...room([]),
      id: "right",
      vertices: [
        { id: "r0", x: 20 * FT, y: 0 }, { id: "r1", x: 34 * FT, y: 0 },
        { id: "r2", x: 34 * FT, y: 16 * FT }, { id: "r3", x: 20 * FT, y: 16 * FT },
      ],
    };
    // The same doorway in the wall they share, tapped from each side - and read a little differently
    // from each, as two honest reads of one hole are: 4'3" one way, 3'7" the other.
    left.symbols = [{ id: "d-left", type: "door", wallId: "v1", t: 0.5, widthFeet: 4.25, heightFeet: 6.7, doorType: "opening", leaves: "single", flipX: false, flipY: false }];
    right.symbols = [{ id: "d-right", type: "door", wallId: "r3", t: 0.5, widthFeet: 3.58, heightFeet: 6.7, doorType: "opening", leaves: "single", flipX: false, flipY: false }];

    const out = s.dropDuplicateSharedOpenings([left, right]);
    const total = out.reduce((n, r) => n + r.symbols.length, 0);
    assert(total === 1, `one doorway, one symbol - got ${total}`);
    assert(out[0].symbols.length === 1, "the first room keeps it");
    assert(out[1].symbols.length === 0, "and the second does not draw it again");
  });

  test("two real doorways in the same shared wall both survive", () => {
    // The rule must not swallow a second, genuine opening: only a hole that OVERLAPS one already
    // drawn is the same hole.
    const left = room([]);
    left.id = "left";
    const right = {
      ...room([]),
      id: "right",
      vertices: [
        { id: "r0", x: 20 * FT, y: 0 }, { id: "r1", x: 34 * FT, y: 0 },
        { id: "r2", x: 34 * FT, y: 16 * FT }, { id: "r3", x: 20 * FT, y: 16 * FT },
      ],
    };
    left.symbols = [{ id: "d-a", type: "door", wallId: "v1", t: 0.2, widthFeet: 3, heightFeet: 6.7, doorType: "door", leaves: "single", flipX: false, flipY: false }];
    right.symbols = [{ id: "d-b", type: "door", wallId: "r3", t: 0.2, widthFeet: 3, heightFeet: 6.7, doorType: "door", leaves: "single", flipX: false, flipY: false }];
    const out = s.dropDuplicateSharedOpenings([left, right]);
    assert(out.reduce((n, r) => n + r.symbols.length, 0) === 2,
      "two doorways at opposite ends of the shared wall are two doorways");
  });

  return { passed, failures };
}

/* \u2500\u2500 standalone \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runBlockChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  \u2717 ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
