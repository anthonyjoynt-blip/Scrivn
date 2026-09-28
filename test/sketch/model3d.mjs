/**
 * The house in 3D (lib/sketch3d.ts): what the walk-through draws, checked as geometry.
 *
 *   node test/sketch/model3d.mjs        (also runs as part of npm run test:sketch)
 *
 * Asked for from the field on 2026-09-27: "some form of virtual walk-through" of a scanned house,
 * viewable in Scrivn. The renderer only draws prisms; every decision about where a wall stands,
 * where a doorway cuts it and how high a storey sits lives in lib/sketch3d.ts and is checked here.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "model3d-tests-"));
  const entry = join(outDir, "entry.ts");
  writeFileSync(entry, `export * from "${join(root, "lib", "sketch.ts").replace(/\\/g, "/")}";\nexport * from "${join(root, "lib", "sketch3d.ts").replace(/\\/g, "/")}";\n`);
  const outfile = join(outDir, "sketch3d.mjs");
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
  return { id, type: "door", wallId, t: 0.5, widthFraction: 0.25, widthFeet: 3, doorType: "swing", leaves: "single", heightFeet: 6 + 8 / 12, flipX: false, flipY: false, ...extra };
}

/** Whether (x, z) lies inside the polygon [points]. */
function inside(points, x, z) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** The wall prisms standing at plan point (x, z) and height y. */
const wallsAt = (model, x, y, z, kind = "wall") => model.prisms.filter((p) => p.kind === kind && p.y0 <= y && y <= p.y1 && inside(p.points, x, z));

export async function runModel3dChecks() {
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

  test("a room's walls stand 4 in outward from its inside faces, floor to ceiling", () => {
    const m = s.houseModel({ rooms: [box("a")] });
    assert(m.prisms.filter((p) => p.kind === "wall").length === 4, "four walls");
    // Just outside the top wall's inside face, half way along, at head height: a wall.
    assert(wallsAt(m, 6, 5, -0.15).length === 1, "the top wall is there, outside the face");
    assert(wallsAt(m, 6, 5, 0.15).length === 0, "and not inside the room");
    assert(wallsAt(m, 6, 5, -0.5).length === 0, "and only 4 in thick");
    near(Math.max(...m.prisms.map((p) => p.y1)), 8, "walls reach the 8' ceiling");
    // The corner outside is filled: the walls are mitred, as the plan draws them.
    assert(wallsAt(m, -0.15, 5, -0.15).length >= 1, "the outside corner is wall");
    assert(m.floors.length === 1 && m.floors[0].points.length === 4, "one floor, the room's outline");
  });

  test("a door cuts its wall from the floor to its head", () => {
    const a = box("a");
    a.symbols = [door("d", "a-v2")];
    const m = s.houseModel({ rooms: [a] });
    // The bottom wall runs from (12', 10') to (0, 10'); the door is its middle 3'.
    assert(wallsAt(m, 6, 3, 10.15).length === 0, "nothing in the doorway at 3' up");
    assert(wallsAt(m, 6, 7.5, 10.15).length === 1, "the wall carries on over the head");
    assert(wallsAt(m, 4, 3, 10.15).length === 1, "and either side of the door");
    assert(wallsAt(m, 8, 3, 10.15).length === 1, "on both sides");
    const lintel = wallsAt(m, 6, 7.5, 10.15)[0];
    near(lintel.y0, 6 + 8 / 12, "the head is 6'8\"");
  });

  test("a window leaves the wall below its sill and above its head, with glass between", () => {
    const a = box("a");
    a.symbols = [{ id: "w", type: "window", wallId: "a-v1", t: 0.5, widthFraction: 0.3, widthFeet: 3, heightFeet: 4, sillFeet: 3 }];
    const m = s.houseModel({ rooms: [a] });
    // The right wall runs down x = 12'.
    assert(wallsAt(m, 12.15, 1.5, 5).length === 1, "wall under the sill");
    assert(wallsAt(m, 12.15, 5, 5).length === 0, "no wall through the window");
    assert(wallsAt(m, 12.15, 7.5, 5).length === 1, "wall over the head");
    assert(wallsAt(m, 12.17, 5, 5, "glass").length === 1, "glass in it");
  });

  test("a doorway in one room's wall cuts the neighbour's too, across the partition", () => {
    // The phone lays joined rooms a partition apart; the door is tapped in one of them.
    const P = 4.5;
    const a = box("a");
    const b = box("b", 12 * FT + P);
    a.symbols = [door("d", "a-v1")];
    const m = s.houseModel({ rooms: [a, b] });
    const mid = 12 + P / 2 / FT;
    assert(wallsAt(m, 12.1, 3, 5).length === 0, "a's wall is open at the door");
    assert(wallsAt(m, mid + 0.1, 3, 5).length === 0, "and b's wall across the partition is open too");
    assert(wallsAt(m, mid + 0.1, 3, 2).length >= 1, "b's wall stands away from the door");
  });

  test("two rooms flush, insides touching, build ONE wall between them", () => {
    const a = box("a");
    const b = box("b", 12 * FT);
    const m = s.houseModel({ rooms: [a, b] });
    // Along x = 12' the one wall is 4" thick and belongs to one of the two; the other builds nothing.
    const onLine = m.prisms.filter((p) => p.kind === "wall" && p.points.every((q) => Math.abs(q.x - 12) < 0.34 + 1e-6));
    assert(onLine.length === 1, `one wall on the shared line - got ${onLine.length}`);
  });

  test("an upper storey stands on the ceiling below plus the floor, a basement below", () => {
    const main = box("main");
    const up = box("up", 0, { level: 1, ceilingHeightFeet: 9 });
    const down = box("down", 0, { level: -1, ceilingHeightFeet: 7 });
    const m = s.houseModel({ rooms: [main, up, down] });
    const base = (level) => m.levels.find((l) => l.level === level).baseY;
    near(base(0), 0, "main floor at 0");
    near(base(1), 9, "upstairs on 8' plus 1'");
    near(base(-1), -8, "the basement 7' plus 1' down");
    near(Math.max(...m.prisms.filter((p) => p.roomId === "up").map((p) => p.y1)), 18, "upstairs walls reach its 9' ceiling");
  });

  test("a flight is steps, climbing the way it is drawn, and has no walls", () => {
    const stairs = room("st", [[0, 0], [10 * FT, 0], [10 * FT, 3 * FT], [0, 3 * FT]], {
      stairs: { orientation: 0, direction: "up", treadDepthFeet: 10.5 / 12, riseFeet: null },
    });
    const m = s.houseModel({ rooms: [stairs] });
    const steps = m.prisms.filter((p) => p.kind === "step");
    const flight = s.stairFlight(stairs);
    assert(steps.length === flight.treadCount, `a block per tread - ${steps.length} of ${flight.treadCount}`);
    assert(m.prisms.every((p) => p.kind !== "wall"), "no walls round a flight");
    const first = steps[0];
    const last = steps[steps.length - 1];
    assert(Math.min(...first.points.map((q) => q.x)) < Math.min(...last.points.map((q) => q.x)), "it climbs to the right");
    near(last.y1, flight.treadCount * flight.riserFeet, "the last tread one riser short of the floor above");
  });

  test("cabinets stand against their wall, base on the floor and wall ones up high", () => {
    const a = box("a");
    a.symbols = [
      { id: "c1", type: "cabinet", wallId: "a-v0", t: 0.3, widthFraction: 0.3, widthFeet: 4, label: "Base", tier: "base", depthFeet: 2, heightFeet: 3 },
      { id: "c2", type: "cabinet", wallId: "a-v0", t: 0.3, widthFraction: 0.3, widthFeet: 4, label: "Uppers", tier: "wall", depthFeet: 1, heightFeet: 2.5 },
    ];
    const m = s.houseModel({ rooms: [a] });
    const cabinets = m.prisms.filter((p) => p.kind === "cabinet");
    assert(cabinets.length === 2, "two runs");
    const base = cabinets.find((c) => c.y0 === 0);
    const upper = cabinets.find((c) => c.y0 > 0);
    near(base.y1, 3, "base cabinets 3' tall");
    near(upper.y1, 7, "uppers top out at 7'");
    near(Math.max(...base.points.map((q) => q.z)), 2, "base runs 2' into the room from the top wall");
  });

  test("an empty sketch is an empty model", () => {
    const m = s.houseModel({ rooms: [] });
    assert(m.prisms.length === 0 && m.floors.length === 0, "nothing");
    assert(m.bounds === null, "and no bounds");
  });

  return { passed, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runModel3dChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
