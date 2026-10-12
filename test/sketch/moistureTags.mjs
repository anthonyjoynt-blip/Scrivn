/**
 * The water-drop tags of the walk-through (lib/moistureTags.ts): where each wet stretch, floor region and ceiling region
 * pins its tag, whether a wall stands between it and the eye, and where it lands on a photo (lib/walkView.ts
 * `photoPixelOf`). Checked as numbers.
 *
 *   node test/sketch/moistureTags.mjs        (also runs as part of npm run test:sketch)
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "moisturetags-tests-"));
  const entry = join(outDir, "entry.ts");
  const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
  writeFileSync(
    entry,
    `export * from "${lib("moistureTags.ts")}";\n` +
      `export { houseModel } from "${lib("sketch3d.ts")}";\n` +
      `export { viewpoints, photoPlane, photoPixelOf } from "${lib("walkView.ts")}";\n`,
  );
  const outfile = join(outDir, "moisturetags.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const FT = 12;

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

/** A 12' x 10' room at [x0], clockwise on the page: top wall v0, right v1, bottom v2, left v3. */
const box = (id, x0 = 0, extra = {}) => room(id, [[x0, 0], [x0 + 12 * FT, 0], [x0 + 12 * FT, 10 * FT], [x0, 10 * FT]], extra);

function door(id, wallId, extra = {}) {
  return { id, type: "door", wallId, t: 0.5, widthFraction: 0.3, widthFeet: 3, doorType: "swing", leaves: "single", heightFeet: 6 + 8 / 12, flipX: false, flipY: false, ...extra };
}

function reading(id, wallId, extra = {}) {
  return { id, wallId, startT: 0.25, endT: 0.75, affectedHeightFeet: 2, material: "drywall", reading: 3.2, dryStandard: 0.75, ...extra };
}

const roomMoisture = (extra = {}) => ({ wallReadings: [], floorCells: [], ceilingCells: [], insetsOver18Inches: 0, ...extra });

/** Every "col,row" in a block of cells. */
function block(c0, r0, cols, rows) {
  const out = [];
  for (let c = c0; c < c0 + cols; c++) for (let r = r0; r < r0 + rows; r++) out.push(`${c},${r}`);
  return out;
}

export async function runMoistureTagChecks() {
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
  const near = (actual, expected, message, tolerance = 1e-6) => {
    if (Math.abs(actual - expected) > tolerance) throw new Error(`${message}\n      expected ~${expected}\n      actual    ${actual}`);
  };

  // ---- Where a tag is pinned ---------------------------------------------------------------------

  test("a wet stretch's tag sits at its middle, halfway up the wet, an inch off the wall into the room", () => {
    const a = box("a");
    const tags = s.moistureTags({ rooms: [a] }, { rooms: { a: roomMoisture({ wallReadings: [reading("r1", "a-v0", { startT: 0.5, endT: 1 })] }) } });
    assert(tags.length === 1, `one tag, got ${tags.length}`);
    const [t] = tags;
    assert(t.id === "wall:r1" && t.surface === "wall" && t.roomId === "a" && t.level === 0, "a wall tag of room a, by its reading");
    // The top wall runs (0,0) -> (12',0); its stretch from 6' to 12' has its middle at 9'.
    near(t.position[0], 9, "x at the middle of the stretch");
    near(t.position[1], 1, "halfway up 2' of wet");
    near(t.position[2], 1 / 12, "an inch off the top wall, down the page into the room");
    assert(t.normal[2] > 0.99, "facing into the room");
    near(t.areaSquareFeet, 12, "6' of run, 2' up");
  });

  test("a room drawn the other way round still has its tags on the room's side of the wall", () => {
    // Anticlockwise: the right wall is now v2 -> v3 running up the page at x = 12'.
    const a = room("a", [[0, 0], [0, 10 * FT], [12 * FT, 10 * FT], [12 * FT, 0]]);
    const [t] = s.moistureTags({ rooms: [a] }, { rooms: { a: roomMoisture({ wallReadings: [reading("r", "a-v2", { startT: 0, endT: 1 })] }) } });
    near(t.position[0], 12 - 1 / 12, "an inch in from x = 12'");
    near(t.position[2], 5, "at the middle of the wall");
    assert(t.normal[0] < -0.99, "facing back into the room");
  });

  test("a tag never sits on the floor line or in the ceiling: 6 in up at least, 6 in under the ceiling at most", () => {
    const a = box("a");
    const tags = s.moistureTags(
      { rooms: [a] },
      { rooms: { a: roomMoisture({ wallReadings: [reading("low", "a-v0", { affectedHeightFeet: 0.3 }), reading("high", "a-v1", { affectedHeightFeet: 30 })] }) } },
    );
    near(tags.find((t) => t.id === "wall:low").position[1], 0.5, "a 4 in wick still puts the tag 6 in up");
    near(tags.find((t) => t.id === "wall:high").position[1], 7.5, "wet past the ceiling: 6 in under the 8' ceiling");
  });

  test("a wet stretch on a wall the room no longer has gets no tag", () => {
    const tags = s.moistureTags({ rooms: [box("a")] }, { rooms: { a: roomMoisture({ wallReadings: [reading("gone", "a-v9")] }) } });
    assert(tags.length === 0, "nothing pinned to a wall that is not there");
  });

  test("a room upstairs pins its tags on its own storey's floor", () => {
    const up = box("up", 0, { level: 1 });
    const tags = s.moistureTags(
      { rooms: [box("down"), up] },
      { rooms: { up: roomMoisture({ wallReadings: [reading("r", "up-v0")], floorCells: block(0, 0, 4, 4) }) } },
    );
    // The main floor's 8' ceiling plus a foot of floor structure.
    near(tags.find((t) => t.surface === "wall").position[1], 9 + 1, "the wall's tag 1' above the upstairs floor at 9'");
    assert(tags.every((t) => t.level === 1), "both on level 1");
    assert(tags.find((t) => t.surface === "floor").position[1] > 9 && tags.find((t) => t.surface === "floor").position[1] < 9.1, "the floor's tag on the upstairs floor");
  });

  // ---- Painted regions ---------------------------------------------------------------------------

  test("painted cells a foot apart or nearer are one region; further apart, two", () => {
    const near1 = s.paintedRegions([...block(0, 0, 4, 4), ...block(8, 0, 4, 4)]);
    assert(near1.length === 1, `blocks with a 1' gap are one region, got ${near1.length}`);
    const apart = s.paintedRegions([...block(0, 0, 4, 4), ...block(9, 0, 4, 4)]);
    assert(apart.length === 2, `blocks 15 in apart are two, got ${apart.length}`);
    assert(apart[0].length === 16 && apart[1].length === 16, "each region keeps all its cells");
    assert(s.paintedRegions(["0,0", "0,0", "nonsense", "1,x"]).length === 1, "a repeated key counts once and junk is skipped");
    assert(s.paintedRegions([]).length === 0, "no paint, no regions");
  });

  test("a region's tag is on a painted cell nearest its middle, even when the middle itself is dry", () => {
    // A ring 9 cells across, one cell thick: its middle (4,4) is not painted.
    const ring = [];
    for (let k = 0; k < 9; k++) ring.push(`${k},0`, `${k},8`, `0,${k}`, `8,${k}`);
    const [region] = s.paintedRegions(ring, 1);
    const m = s.regionMiddleCell(region);
    assert(ring.includes(`${m.col},${m.row}`), `the tag's cell ${m.col},${m.row} is painted`);
    const solid = s.regionMiddleCell(s.paintedRegions(block(10, 20, 5, 3))[0]);
    assert(solid.col === 12 && solid.row === 21, `a solid block's middle cell is its centre, got ${solid.col},${solid.row}`);
    assert(s.regionMiddleCell([]) === null, "no cells, no middle");
  });

  test("floor and ceiling paint each pin one tag per region, at the cell's centre, on the floor or under the ceiling", () => {
    const a = box("a");
    const tags = s.moistureTags(
      { rooms: [a] },
      { rooms: { a: roomMoisture({ floorCells: [...block(0, 0, 5, 5), ...block(30, 20, 4, 4)], ceilingCells: block(10, 10, 5, 5) }) } },
    );
    const floors = tags.filter((t) => t.surface === "floor");
    const ceilings = tags.filter((t) => t.surface === "ceiling");
    assert(floors.length === 2 && ceilings.length === 1, `two floor regions and one ceiling, got ${floors.length} and ${ceilings.length}`);
    // Cells are 3 in from the room's top left; the first block (5 x 5) has its middle cell at (2,2), centre 7.5 in in each way.
    const first = floors.find((t) => t.id === "floor:a:0");
    near(first.position[0], 7.5 / 12, "x at the middle cell's centre");
    near(first.position[2], 7.5 / 12, "z at the middle cell's centre");
    assert(first.position[1] > 0 && first.position[1] < 0.1, "just off the floor");
    assert(first.normal[1] > 0.99, "facing up");
    near(first.areaSquareFeet, 25 / 16, "25 cells of 3 in, 16 to the square foot");
    const c = ceilings[0];
    near(c.position[0], (12 * 3 + 1.5) / 12, "the ceiling's middle cell (12,12)");
    assert(c.position[1] < 8 && c.position[1] > 7.9, "just under the 8' ceiling");
    assert(c.normal[1] < -0.99, "facing down");
  });

  test("a claim with no moisture, or moisture on a room that is gone, pins nothing", () => {
    assert(s.moistureTags({ rooms: [box("a")] }, { rooms: {} }).length === 0, "empty map");
    assert(s.moistureTags({ rooms: [box("a")] }, { rooms: { gone: roomMoisture({ floorCells: block(0, 0, 4, 4) }) } }).length === 0, "a deleted room's paint");
  });

  // ---- Seen from where the camera stands ---------------------------------------------------------

  /** Two rooms side by side, a 4.5 in partition between them, with or without a door through it. */
  const pair = (withDoor) => {
    const P = 4.5;
    const a = box("a");
    const b = box("b", 12 * FT + P);
    if (withDoor) a.symbols = [door("d", "a-v1")];
    return { rooms: [a, b] };
  };
  // A tag low on b's far wall (x = 24' 4.5"), half way along it.
  const farWallTag = { position: [24 + 4.5 / 12 - 1 / 12, 1, 5], normal: [-1, 0, 0] };

  test("a wall between the eye and a tag hides it; a doorway on the line of sight does not", () => {
    const eye = [6, 5, 5];
    assert(!s.tagSeenFrom(s.houseModel(pair(false)), eye, farWallTag), "behind the partition: hidden");
    assert(s.tagSeenFrom(s.houseModel(pair(true)), eye, farWallTag), "through the doorway: seen");
    // Off to the side, the line of sight meets the partition beside the door.
    assert(!s.tagSeenFrom(s.houseModel(pair(true)), [6, 5, 1], { ...farWallTag, position: [farWallTag.position[0], 1, 1] }), "beside the doorway: hidden");
  });

  test("a tag is seen from inside its own room, and never from behind its wall", () => {
    const model = s.houseModel(pair(false));
    const [t] = s.moistureTags(pair(false), { rooms: { a: roomMoisture({ wallReadings: [reading("r", "a-v1")] }) } });
    assert(s.tagSeenFrom(model, [3, 5, 2], t), "from across the room");
    assert(!s.tagSeenFrom(model, [18, 5, 5], t), "from the room next door it faces away");
  });

  test("Low walls lets a tag be seen over a wall cut at 4'", () => {
    const model = s.houseModel(pair(false));
    const eye = [6, 7, 5];
    const tag = { position: [farWallTag.position[0], 5, 5], normal: [-1, 0, 0] };
    assert(!s.tagSeenFrom(model, eye, tag), "a full-height partition hides it");
    assert(s.tagSeenFrom(model, eye, tag, { wallTop: () => 4 }), "cut at 4' it shows over the top");
  });

  test("a floor upstairs hides the storey under it, unless that floor is not drawn", () => {
    const sketch = { rooms: [box("down"), box("up", 0, { level: 1 })] };
    const model = s.houseModel(sketch);
    const [t] = s.moistureTags(sketch, { rooms: { down: roomMoisture({ floorCells: block(20, 20, 4, 4) }) } });
    const above = [6, 40, 5];
    assert(!s.tagSeenFrom(model, above, t), "under the upstairs floor: hidden");
    assert(s.tagSeenFrom(model, above, t, { levels: new Set([0]) }), "the main floor shown alone: seen");
    // A ceiling's tag faces down: never seen from over it, as the dollhouse looks.
    const [c] = s.moistureTags(sketch, { rooms: { down: roomMoisture({ ceilingCells: block(20, 20, 4, 4) }) } });
    assert(!s.tagSeenFrom(model, above, c, { levels: new Set([0]) }), "a ceiling's tag from above: not seen");
    assert(s.tagSeenFrom(model, [6, 5, 5], c), "from under it: seen");
  });

  // ---- On a photo --------------------------------------------------------------------------------

  /** A photo at (6', 5', 5') looking along +x (heading 0 on the page), level, through a 1440 x 1920 lens. */
  const camera = { width: 1440, height: 1920, fx: 1200, fy: 1200, cx: 700, cy: 980 };
  const photo = (headingDeg = 0, pitchDeg = 0) => {
    const h = (headingDeg * Math.PI) / 180;
    const p = (pitchDeg * Math.PI) / 180;
    const forward = [Math.cos(p) * Math.cos(h), Math.cos(p) * Math.sin(h), Math.sin(p)];
    const up = [-Math.sin(p) * Math.cos(h), -Math.sin(p) * Math.sin(h), Math.cos(p)];
    const walk = { scanId: "s", level: 0, camera, photos: [{ n: 1, tS: 0, x: 6 * FT, y: 5 * FT, heightFeet: 5, headingDeg, pitchDeg, forward, up }] };
    return s.viewpoints([walk], () => 0)[0];
  };

  test("a point lands on the photo where the photo, hung in the model, shows it", () => {
    for (const [heading, pitch] of [[0, 0], [37, -20], [200, 25]]) {
      const v = photo(heading, pitch);
      const plane = s.photoPlane(v, 7);
      const mid = s.photoPixelOf(v, plane.center);
      near(mid.x, camera.width / 2, `heading ${heading}: the plane's middle is the photo's middle across`, 1e-6);
      near(mid.y, camera.height / 2, `heading ${heading}: and down`, 1e-6);
      // Its top-left corner: half the plane left of the middle and half up.
      const corner = [0, 1, 2].map((i) => plane.center[i] - (v.right[i] * plane.width) / 2 + (v.up[i] * plane.height) / 2);
      const px = s.photoPixelOf(v, corner);
      near(px.x, 0, `heading ${heading}: the top-left corner is pixel 0 across`, 1e-6);
      near(px.y, 0, `heading ${heading}: and 0 down`, 1e-6);
    }
  });

  test("a point to the right and below lands right and down on the photo; one behind the camera lands nowhere", () => {
    const v = photo(0, 0);
    // Looking along +x on a y-down page, the photo's right is +z (down the page).
    const p = s.photoPixelOf(v, [6 + 5, 4, 5 + 1]);
    assert(p.x > camera.cx && p.y > camera.cy, `right and down of the middle, got ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`);
    near(p.x, camera.cx + (camera.fx * 1) / 5, "1' right at 5' is fx/5 pixels");
    assert(s.photoPixelOf(v, [6 - 3, 5, 5]) === null, "behind it: null");
  });

  // ---- In words ----------------------------------------------------------------------------------

  test("a tag says what is wet, and for a wall its material, its reading and how high", () => {
    const sketch = { rooms: [box("a")] };
    const tags = s.moistureTags(sketch, {
      rooms: { a: roomMoisture({ wallReadings: [reading("r", "a-v0"), reading("n", "a-v1", { reading: null, material: "paneling", affectedHeightFeet: 1.5 })], floorCells: block(0, 0, 40, 30) }) },
    });
    const w = s.tagWords(tags.find((t) => t.id === "wall:r"));
    assert(w.title === "Wet wall" && w.detail === "Drywall · 3.2% · wet to 2'", `got "${w.title}" / "${w.detail}"`);
    const n = s.tagWords(tags.find((t) => t.id === "wall:n"));
    assert(n.detail === "Paneling · not metered · wet to 1'6\"", `got "${n.detail}"`);
    const f = s.tagWords(tags.find((t) => t.surface === "floor"));
    assert(f.title === "Wet floor" && f.detail === "75 sq ft", `got "${f.title}" / "${f.detail}"`);
  });

  return { passed, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runMoistureTagChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
