/**
 * Where a room's name goes on the plan (lib/roomNamePlace.ts): inside its room when it fits, smaller if it must, else
 * beside it with a line to it - "the room names on these small rooms cover the entire room" (the owner, 2026-10-05).
 * Checked as numbers, y down.
 *
 *   node test/sketch/roomNamePlace.mjs        (also runs as part of npm run test:sketch)
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "roomnameplace-tests-"));
  const entry = join(outDir, "entry.ts");
  writeFileSync(entry, `export * from "${join(root, "lib", "roomNamePlace.ts").replace(/\\/g, "/")}";\n`);
  const outfile = join(outDir, "roomnameplace.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

export async function runRoomNamePlaceChecks() {
  const p = await load();
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

  const rect = (l, t, r, b) => [l, t, r, t, r, b, l, b];
  /** A name 80 x 24 at full size, and [scale] of that. */
  const size = (scale, w = 80, h = 24) => ({ scale, hw: (w / 2) * scale, hh: (h / 2) * scale });
  const steps = [size(1), size(0.85), size(0.7)];
  // The walk of 07:26: the rec room big, the hall and the bathroom small beside it, the bedroom above them.
  const rec = rect(160, 100, 380, 240);
  const hall = rect(110, 180, 150, 220);
  const bath = rect(20, 180, 106, 230);
  const bedroom = rect(20, 80, 150, 176);
  const all = [rec, hall, bath, bedroom];
  const place = (room, x, y, extra = {}) =>
    p.placeName({ room, obstacles: all, taken: [], x, y, inside: steps, outside: size(0.85), margin: 4, gap: 8, ...extra });

  test("a name that fits its room stays at its spot, at its own size", () => {
    const s = place(rec, 270, 170);
    assert(!s.outside && s.size.scale === 1 && s.x === 270 && s.y === 170, JSON.stringify(s));
  });

  test("a name too big for its room shrinks to fit inside it", () => {
    // The bathroom is 86 wide: 80 + 2 x 4 does not fit, 68 + 8 does.
    const s = place(bath, 63, 205);
    assert(!s.outside && Math.abs(s.size.scale - 0.85) < 1e-9, JSON.stringify(s));
    assert(p.boxInsidePolygon(bath, p.nameBox(s)), "inside the bathroom");
  });

  test("a name that fits nowhere inside goes beside its room, clear of every room, with a line to it", () => {
    const s = place(hall, 130, 200);
    assert(s.outside, JSON.stringify(s));
    const box = p.nameBox(s);
    for (const room of all) assert(!p.boxHitsPolygon(room, box), `clear of every room: ${JSON.stringify(box)}`);
    const [ex, ey] = p.edgeToward(s, 130, 200);
    const onEdge = [box.l, box.r].some((v) => Math.abs(ex - v) < 1e-6) || [box.t, box.b].some((v) => Math.abs(ey - v) < 1e-6);
    assert(onEdge, `the line leaves the box's edge: ${ex}, ${ey} ${JSON.stringify(box)}`);
  });

  test("its line is drawn across no other room when a place for it can be found", () => {
    const s = place(hall, 130, 200, { others: [rec, bath, bedroom] });
    assert(s.outside, JSON.stringify(s));
    const [ex, ey] = p.edgeToward(s, 130, 200);
    for (const room of [rec, bath, bedroom]) assert(!p.segmentHitsPolygon(room, ex, ey, 130, 200), `the line crosses a room: ${JSON.stringify(s)}`);
  });

  test("a name beside its room keeps off the names placed already", () => {
    const first = place(hall, 130, 200);
    const closet = rect(110, 224, 150, 236);
    const second = p.placeName({ room: closet, obstacles: [...all, closet], taken: [p.nameBox(first)], x: 130, y: 230, inside: steps, outside: size(0.85), margin: 4, gap: 8 });
    assert(second.outside && !p.boxesHit(p.nameBox(second), p.nameBox(first)), "not over the hall's name");
  });

  test("with nowhere beside it on the canvas, the smallest size stays at the room's spot", () => {
    const tiny = rect(5, 5, 45, 45);
    const s = p.placeName({ room: tiny, obstacles: [tiny], taken: [], x: 25, y: 25, inside: steps, outside: size(0.85), margin: 4, gap: 8, bounds: { l: 0, t: 0, r: 50, b: 50 } });
    assert(!s.outside && Math.abs(s.size.scale - 0.7) < 1e-9, JSON.stringify(s));
  });

  test("a wall across the box keeps a name off a notch, though all four corners are in the room", () => {
    const notched = [0, 0, 40, 0, 40, 30, 60, 30, 60, 0, 100, 0, 100, 100, 0, 100];
    assert(p.boxInsidePolygon(notched, { l: 10, t: 50, r: 90, b: 90 }), "below the notch");
    const across = { l: 20, t: 10, r: 80, b: 50 };
    for (const [x, y] of [[across.l, across.t], [across.r, across.t], [across.l, across.b], [across.r, across.b]]) {
      assert(p.pointInPolygon(notched, x, y), `corner (${x}, ${y}) in the room`);
    }
    assert(!p.boxInsidePolygon(notched, across), "the notch's walls cross it");
  });

  test("a name wraps only at its spaces: never 'Ro / o / m / 3'", () => {
    const measure = (line) => line.length * 10;
    const one = p.wrapAtSpaces("Room 3", 100, measure);
    assert(one && one.lines.length === 1 && one.width === 60, JSON.stringify(one));
    const two = p.wrapAtSpaces("Primary Bedroom Closet", 120, measure);
    assert(two && two.lines.join("|") === "Primary|Bedroom|Closet" && two.width === 70, JSON.stringify(two));
    const pairs = p.wrapAtSpaces("Primary Bedroom Closet", 160, measure);
    assert(pairs && pairs.lines.join("|") === "Primary Bedroom|Closet", JSON.stringify(pairs));
    assert(p.wrapAtSpaces("Room 3", 30, measure) === null, "a word wider than the room: no fit at that size");
  });

  return { passed, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runRoomNamePlaceChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
