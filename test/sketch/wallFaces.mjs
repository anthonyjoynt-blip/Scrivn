/**
 * Walls as Xactimate draws them (2026-09-25, step 1): 4" OUTWARD from a room's inside faces,
 * never over another room's floor, one wall where two rooms share one.
 *
 * The drawing is Konva's and the browser's; what is checked here is the geometry it is drawn from -
 * where the outer faces are (`outerWallFaces`), which rooms a wall must keep off
 * (`roomsWallsMayNotCover`), where two rooms share a line (`sharedCentrelineStretches`), and where
 * the wall a door is cut through stands (`wallBandAt`).
 *
 *   node test/sketch/wallFaces.mjs
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "wall-face-tests-"));
  const entry = join(outDir, "entry.ts");
  const p = (...parts) => join(root, ...parts).split("\\").join("/");
  writeFileSync(entry, `export * from "${p("lib", "sketch.ts")}";\n`);
  const outfile = join(outDir, "sketch.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const FT = 12;

/** A room from clockwise corners in feet, with an id prefix for its vertices. */
function room(id, corners, extra = {}) {
  return {
    id,
    name: id,
    vertices: corners.map(([x, y], i) => ({ id: `${id}${i}`, x: x * FT, y: y * FT })),
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    blocks: [],
    ...extra,
  };
}

export async function runWallFaceChecks() {
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
  const T = s.WALL_THICKNESS_PX;

  test("the wall is 4 inches, and built outward: a 12' square's outer faces are 12'8\" across", () => {
    near(T, 4, "4 in, in world pixels");
    const sq = room("a", [[0, 0], [12, 0], [12, 12], [0, 12]]);
    const outer = s.outerWallFaces(sq.vertices, T);
    near(outer[0].x, -4, "top-left out 4 in, x");
    near(outer[0].y, -4, "top-left out 4 in, y");
    near(outer[2].x, 12 * FT + 4, "bottom-right out, x");
    near(outer[2].y, 12 * FT + 4, "bottom-right out, y");
    // The inside is untouched: the room is still 12' x 12', which is what every figure is worked from.
    const b = s.roomBounds(sq);
    near(b.width, 12 * FT, "the room itself is still 12'");
  });

  test("an L's re-entrant corner mitres INSIDE the angle, not across the room", () => {
    // 0,0 - 12,0 - 12,6 - 6,6 - 6,12 - 0,12: the corner at (6,6) is re-entrant.
    const l = room("l", [[0, 0], [12, 0], [12, 6], [6, 6], [6, 12], [0, 12]]);
    const outer = s.outerWallFaces(l.vertices, T);
    // Outward at the re-entrant corner is down and right, into the notch: (6'4", 6'4").
    near(outer[3].x, 6 * FT + 4, "re-entrant corner, x");
    near(outer[3].y, 6 * FT + 4, "re-entrant corner, y");
    // And every outer corner of the convex ones is 4 in out both ways.
    near(outer[1].x, 12 * FT + 4, "convex corner, x");
    near(outer[1].y, -4, "convex corner, y");
  });

  test("a sharp corner's miter is clamped rather than thrown across the plan", () => {
    // A sliver of a triangle: its sharp tip would mitre far out.
    const tri = room("t", [[0, 0], [20, 0], [0, 1]]);
    const outer = s.outerWallFaces(tri.vertices, T);
    for (let i = 0; i < 3; i++) {
      const d = Math.hypot(outer[i].x - tri.vertices[i].x, outer[i].y - tri.vertices[i].y);
      assert(d <= 4 * T + 1e-6, `corner ${i} thrown ${d} px out`);
    }
  });

  test("a wall with no neighbour stands outside its face", () => {
    const a = room("a", [[0, 0], [12, 0], [12, 12], [0, 12]]);
    const top = s.wallsOf(a)[0];
    const band = s.wallBandAt(a, top, top.lengthPx / 2, [a]);
    near(band.centrePx, -2, "centred 2 in out");
    near(band.thicknessPx, 4, "4 in thick");
  });

  test("a scan's partition: the door is cut through BOTH rooms' walls, 4 1/2 in", () => {
    // The phone lays a joined room a partition (4 1/2 in) beyond its neighbour.
    const a = room("a", [[0, 0], [12, 0], [12, 12], [0, 12]]);
    const b = room("b", [[12 + 4.5 / FT, 0], [24, 0], [24, 12], [12 + 4.5 / FT, 12]]);
    const right = s.wallsOf(a)[1];
    const band = s.wallBandAt(a, right, right.lengthPx / 2, [a, b]);
    near(band.thicknessPx, 4.5, "the whole partition", 0.05);
    near(band.centrePx, -2.25, "its middle, outward", 0.05);
    // No wall of either room is drawn on one line with the other's: they are a partition apart.
    assert(s.sharedCentrelineStretches(a, right, [a, b]).length === 0, "no shared centreline across a partition");
  });

  test("two rooms dragged flush share the line: centred there, and only there", () => {
    const a = room("a", [[0, 0], [12, 0], [12, 12], [0, 12]]);
    // b is 8' tall, flush against a's right wall: they share the top 8' of it.
    const b = room("b", [[12, 0], [20, 0], [20, 8], [12, 8]]);
    const right = s.wallsOf(a)[1];
    const shared = s.sharedCentrelineStretches(a, right, [a, b]);
    assert(shared.length === 1, `one shared stretch, got ${shared.length}`);
    near(shared[0].from, 0, "from the top");
    near(shared[0].to, 8 * FT, "for 8'");
    const at = (ft) => s.wallBandAt(a, right, ft * FT, [a, b]);
    near(at(4).centrePx, 0, "centred on the shared line");
    near(at(10).centrePx, -2, "outward below it, where nothing is next door");
  });

  test("a closet inside a bedroom builds its walls into the bedroom; its back wall is the bedroom's", () => {
    const bed = room("bed", [[0, 0], [12, 0], [12, 12], [0, 12]]);
    // A 3' x 4' closet in the bedroom's top-right corner, nested in it.
    const closet = room("cl", [[8, 0], [12, 0], [12, 3], [8, 3]], { parentRoomId: "bed" });
    // The closet may build over the bedroom's floor - it stands inside it - but not the other way.
    assert(s.roomsWallsMayNotCover(closet, [bed, closet]).length === 0, "the closet keeps off nothing: it stands in the bedroom");
    assert(s.roomsWallsMayNotCover(bed, [bed, closet]).length === 1, "the bedroom keeps off the closet");
    // The closet's back wall runs WITH the bedroom's (same side), so it is not a shared line:
    // the bedroom's outside wall stays outward all along, closet or no closet.
    const bedTop = s.wallsOf(bed)[0];
    assert(s.sharedCentrelineStretches(bed, bedTop, [bed, closet]).length === 0, "no jog in the bedroom's outside wall");
    near(s.wallBandAt(bed, bedTop, 10 * FT, [bed, closet]).centrePx, -2, "outward over the closet too");
    // The closet's front wall stands out into the bedroom, outward from the closet.
    const front = s.wallsOf(closet)[2];
    near(s.wallBandAt(closet, front, front.lengthPx / 2, [bed, closet]).centrePx, -2, "the closet's front wall, outward");
  });

  test("walls a foot apart are two walls, each outward", () => {
    const a = room("a", [[0, 0], [12, 0], [12, 12], [0, 12]]);
    const b = room("b", [[13, 0], [24, 0], [24, 12], [13, 12]]);
    const right = s.wallsOf(a)[1];
    const band = s.wallBandAt(a, right, right.lengthPx / 2, [a, b]);
    near(band.centrePx, -2, "its own wall");
    near(band.thicknessPx, 4, "4 in");
  });

  return { passed, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runWallFaceChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  \u2717 ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
