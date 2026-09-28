/**
 * Walk mode's geometry (lib/walkView.ts): where each photo's camera stood, how its photo hangs over
 * the model, and where a tap or an arrow key goes. Checked as numbers.
 *
 *   node test/sketch/walkView.mjs        (also runs as part of npm run test:sketch)
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "walkview-tests-"));
  const entry = join(outDir, "entry.ts");
  writeFileSync(
    entry,
    `export * from "${join(root, "lib", "walkView.ts").replace(/\\/g, "/")}";\n` +
      `export * from "${join(root, "lib", "sketch3d.ts").replace(/\\/g, "/")}";\n` +
      `export { walkFromScan } from "${join(root, "lib", "scanInbox.ts").replace(/\\/g, "/")}";\n`,
  );
  const outfile = join(outDir, "walkview.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const FT = 12;

/** A photo at page (x', y') feet, heading on the page, pitch; optionally the camera's own axes. */
function photo(n, xFeet, yFeet, headingDeg, extra = {}) {
  return { n, tS: n, x: xFeet * FT, y: yFeet * FT, heightFeet: 5, headingDeg, pitchDeg: 0, ...extra };
}

export async function runWalkViewChecks() {
  const w = await load();
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
  const nearVec = (a, b, message, tolerance = 1e-6) => {
    for (let i = 0; i < 3; i++) near(a[i], b[i], `${message} [${i}]`, tolerance);
  };

  test("a scan's walk brings its lens and each photo's axes onto the sketch", () => {
    const body = {
      walk: {
        format: "arcapture-walkplan/1",
        camera: { width: 480, height: 640, fx: 501, fy: 500, cx: 239.5, cy: 320.5 },
        photos: [
          { n: 3, t_s: 2, u: 1, v: 2, height_m: 1.5, heading_deg: 0, pitch_deg: 0, forward: [2, 0, 0], up: [0, 0, 1], epoch: 0 },
          { n: 4, t_s: 3, u: 1, v: 2, height_m: 1.5, heading_deg: 0, pitch_deg: 0, forward: [1, 0], up: [0, 0, 1], epoch: 0 },
        ],
      },
    };
    const walk = w.walkFromScan(JSON.stringify(body), { u: 0, v: 0 }, { x: 0, y: 0 }, "scan-1", 0);
    assert(walk && walk.camera && walk.camera.fx === 501 && walk.camera.cy === 320.5, `the lens: ${JSON.stringify(walk?.camera)}`);
    const [a, b] = walk.photos;
    nearVec(a.forward, [1, 0, 0], "axes come in unit length");
    nearVec(a.up, [0, 0, 1], "and the top edge as sent");
    assert(b.forward === undefined && b.up === undefined, "a photo with a broken axis keeps neither, and falls back to its heading");
    const old = w.walkFromScan(JSON.stringify({ walk: { photos: [{ n: 1, t_s: 0, u: 0, v: 0, heading_deg: 90 }] } }), { u: 0, v: 0 }, { x: 0, y: 0 }, "scan-2", 0);
    assert(old && !("camera" in old), "an older file has no lens on record");
  });

  test("a photo from an older file stands where it was taken, looking the way it was headed", () => {
    // Heading 90 on the page is down the page: the model's +z. No axes on file, so its top is up.
    const [v] = w.viewpoints([{ scanId: "s", level: 0, photos: [photo(1, 10, 6, 90)] }], () => 0);
    nearVec(v.position, [10, 5, 6], "where it stood, 5' up");
    nearVec(v.forward, [0, 0, 1], "facing down the page", 1e-9);
    nearVec(v.up, [0, 1, 0], "top edge up", 1e-9);
    // Facing down the page, the camera's right hand is towards -x (the page's left).
    nearVec(v.right, [-1, 0, 0], "right is the page's left", 1e-9);
    assert(v.camera.width === 480 && v.camera.height === 640, "and the phone's usual lens");
  });

  test("a photo with its own axes takes them, turned from the page's into the model's", () => {
    // Looking across the page (+x), rolled 10 degrees: the top edge leans towards down-the-page.
    const s = Math.sin((10 * Math.PI) / 180);
    const c = Math.cos((10 * Math.PI) / 180);
    const walk = { scanId: "s", level: 0, camera: { width: 480, height: 640, fx: 500, fy: 500, cx: 240, cy: 320 }, photos: [photo(1, 0, 0, 0, { forward: [1, 0, 0], up: [0, s, c] })] };
    const [v] = w.viewpoints([walk], () => 0);
    nearVec(v.forward, [1, 0, 0], "across the page");
    nearVec(v.up, [0, c, s], "up in the model's y, the lean in its z");
    assert(v.camera.fx === 500, "the file's own lens");
  });

  test("the photo hangs square in front of its camera, as wide as its lens sees at that distance", () => {
    const [v] = w.viewpoints([{ scanId: "s", level: 0, photos: [photo(1, 0, 0, 0)] }], () => 0);
    const plane = w.photoPlane(v, 10);
    nearVec(plane.center, [10, 5, 0], "10' straight ahead, at the camera's height");
    near(plane.width, (480 / 495) * 10, "as wide as 480 px at 495 px of focal length");
    near(plane.height, (640 / 495) * 10, "as tall");
    // A principal point off the middle moves the picture, not the camera.
    const off = w.viewpoints([{ scanId: "s", level: 0, camera: { width: 480, height: 640, fx: 500, fy: 500, cx: 230, cy: 330 }, photos: [photo(1, 0, 0, 0)] }], () => 0)[0];
    const moved = w.photoPlane(off, 10);
    near(moved.center[1], 5 + (10 / 500) * 10, "the middle of the picture sits 10 px of its height up");
  });

  test("the view is wide enough to show the whole photo whatever the screen", () => {
    const lens = { width: 480, height: 640, fx: 495, fy: 495, cx: 240, cy: 320 };
    const tall = (2 * Math.atan(320 / 495) * 180) / Math.PI;
    near(w.fitFovDeg(lens, 16 / 9, 1), tall, "a wide screen: fitted by the photo's height");
    const narrow = w.fitFovDeg(lens, 0.4, 1);
    assert(narrow > tall, `a phone held upright: fitted by the photo's width (${narrow} > ${tall})`);
  });

  test("a tap on the floor goes to the nearest viewpoint, facing the way the view does if it can", () => {
    const walk = { scanId: "s", level: 0, photos: [photo(1, 0, 0, 0), photo(2, 10, 0, 0), photo(3, 10.5, 0, 180), photo(4, 20, 0, 0)] };
    const points = w.viewpoints([walk], () => 0);
    const facingRight = w.yawPitchOf(points[0].forward).yaw;
    assert(w.destinationFor(points, 0, 10.4, 0, facingRight).key.photo === 1, "the one facing on, not the one half a foot nearer facing back");
    assert(w.destinationFor(points, 0, 10.4, 0, null).key.photo === 2, "with no view to keep, simply the nearest");
    assert(w.destinationFor(points, 1, 10, 0, null) === null, "nothing on another storey");
  });

  test("the arrow keys step forward and back along the way the view faces", () => {
    const walk = { scanId: "s", level: 0, photos: [photo(1, 0, 0, 0), photo(2, 6, 0.5, 0), photo(3, -5, 0, 0), photo(4, 0, 8, 90), photo(5, 30, 0, 0)] };
    const points = w.viewpoints([walk], () => 0);
    const yaw = w.yawPitchOf(points[0].forward).yaw;
    assert(w.stepFrom(points, points[0], yaw, 1).key.photo === 1, "forward: the one ahead, not the one off to the side");
    assert(w.stepFrom(points, points[0], yaw, -1).key.photo === 2, "back: the one behind");
    assert(w.stepFrom(points, points[1], yaw, 1) === null, "nothing within 15' ahead of the second");
  });

  test("the floor is marked at viewpoints a few feet apart, not at every photo", () => {
    const walk = { scanId: "s", level: 0, photos: [photo(1, 0, 0, 0), photo(2, 1, 0, 0), photo(3, 2, 0, 0), photo(4, 5, 0, 0), photo(5, 5.5, 0, 0)] };
    const marked = w.spacedOut(w.viewpoints([walk], () => 0), 4);
    assert(marked.map((v) => v.key.photo).join(",") === "0,3", `marked ${marked.map((v) => v.key.photo)}`);
  });

  test("a room's ceiling covers its floor, level when flat and following a vault", () => {
    const room = (extra = {}) => ({
      id: "a", name: "a", vertices: [{ id: "1", x: 0, y: 0 }, { id: "2", x: 12 * FT, y: 0 }, { id: "3", x: 12 * FT, y: 10 * FT }, { id: "4", x: 0, y: 10 * FT }],
      ceilingHeightFeet: 8, ceilingType: "flat", ceilingPeakFeet: null, stairs: null, parentRoomId: null, nestingOptOut: false, symbols: [], freeCabinets: [], ...extra,
    });
    const area = (pos) => {
      let a = 0;
      for (let i = 0; i < pos.length; i += 9) {
        const [x0, , z0, x1, , z1, x2, , z2] = pos.slice(i, i + 9);
        a += Math.abs((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / 2;
      }
      return a;
    };
    const flat = w.houseModel({ rooms: [room()] }).ceilings[0];
    near(area(flat.positions), 120, "the whole 12' x 10'", 1e-6);
    assert(flat.positions.filter((_, i) => i % 3 === 1).every((y) => Math.abs(y - 8) < 1e-9), "all at 8'");
    const vault = w.houseModel({ rooms: [room({ ceilingType: "vaulted", ceilingPeakFeet: 12, ceilingRiseDeg: 0 })] }).ceilings[0];
    near(area(vault.positions), 120, "a vault covers the same floor", 1e-6);
    const heights = vault.positions.filter((_, i) => i % 3 === 1);
    near(Math.max(...heights), 12, "up to the ridge");
    near(Math.min(...heights), 8, "down to the eaves");
    // Every corner at the ridge line (x = 6') is at the peak.
    for (let i = 0; i < vault.positions.length; i += 3) if (Math.abs(vault.positions[i] - 6) < 1e-9) near(vault.positions[i + 1], 12, "on the ridge");
  });

  test("an L-shaped room is triangulated without spilling outside it", () => {
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const tris = w.triangulate(L);
    let a = 0;
    for (const [i, j, k] of tris) a += Math.abs((L[j].x - L[i].x) * (L[k].y - L[i].y) - (L[k].x - L[i].x) * (L[j].y - L[i].y)) / 2;
    near(a, 64, "the L's own area and no more");
    assert(tris.length === 4, `four triangles (${tris.length})`);
  });

  return { passed, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runWalkViewChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
