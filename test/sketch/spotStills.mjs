/**
 * A 360° spot one still at a time (lib/spotStills.ts): its stills sorted into rings, gone round to the
 * right and left, up and down to the nearest still, and the zoom kept where it makes sense. Checked as
 * numbers.
 *
 *   node test/sketch/spotStills.mjs        (also runs as part of npm run test:sketch)
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "spotstills-tests-"));
  const entry = join(outDir, "entry.ts");
  writeFileSync(
    entry,
    `export * from "${join(root, "lib", "spotStills.ts").replace(/\\/g, "/")}";\n` +
      `export * from "${join(root, "lib", "walkView.ts").replace(/\\/g, "/")}";\n`,
  );
  const outfile = join(outDir, "spotstills.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const FT = 12;
const rad = (deg) => (deg * Math.PI) / 180;

/** A still facing [headingDeg] on the page (0 right, 90 down the page) and [pitchDeg] up, as the phone sends it. */
function still(n, headingDeg, pitchDeg) {
  const h = rad(headingDeg);
  const p = rad(pitchDeg);
  const forward = [Math.cos(p) * Math.cos(h), Math.cos(p) * Math.sin(h), Math.sin(p)];
  // The top edge: as near straight up as a camera looking that way can have it.
  const up = [-Math.sin(p) * Math.cos(h), -Math.sin(p) * Math.sin(h), Math.cos(p)];
  return { n, tS: n, x: 10 * FT, y: 10 * FT, heightFeet: 5, headingDeg, pitchDeg, forward, up };
}

export async function runSpotStillsChecks() {
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

  /** A walk with one spot of [frames], as the 3D view takes it. */
  const spotOf = (frames) => {
    const walk = { scanId: "scan-1", level: 0, photos: [], camera: { width: 1440, height: 1920, fx: 795, fy: 793, cx: 720, cy: 960 }, spots: [{ spot: 1, frames }] };
    const points = s.viewpoints([walk], () => 0);
    const spot = points.find((p) => p.frames);
    assert(spot, "the spot comes in as a viewpoint");
    return spot;
  };
  // The ultra-wide's turn (2026-10-05): twelve level stills 30 degrees apart from -12, then six down at -55 from -12, 60 apart.
  const ultraWide = () =>
    spotOf([
      ...Array.from({ length: 12 }, (_, k) => still(500 + k, -12 + 30 * k, k % 3 === 0 ? -1.3 : 0.2)),
      ...Array.from({ length: 6 }, (_, k) => still(512 + k, -12 + 60 * k, -54.5)),
    ]);

  test("the ultra-wide's stills are a level ring of twelve and a ring of six looking down", () => {
    const rings = s.stillRings(ultraWide());
    assert(rings.length === 2, `two rings (${rings.length})`);
    assert(rings[0].kind === "level" && rings[0].stills.length === 12, `level first, of 12: ${rings[0].kind} ${rings[0].stills.length}`);
    assert(rings[1].kind === "down" && rings[1].stills.length === 6, `then down, of 6: ${rings[1].kind} ${rings[1].stills.length}`);
  });

  test("a ring goes round to the right: each still 30 degrees on clockwise on the plan, all the way round", () => {
    const [level] = s.stillRings(ultraWide());
    assert(level.stills.map((v) => v.n).join(",") === "500,501,502,503,504,505,506,507,508,509,510,511", `taken turning right, kept in that order: ${level.stills.map((v) => v.n)}`);
    assert(s.turnIndex(level, 11, 1) === 0, "right from the last is the first again");
    assert(s.turnIndex(level, 0, -1) === 11, "and left from the first is the last");
    assert(s.turnIndex(level, 3, -2) === 1, "two to the left");
  });

  test("a turn taken to the left still goes round to the right", () => {
    // The phone was turned the other way: the stills in the order taken run anticlockwise.
    const spot = spotOf(Array.from({ length: 6 }, (_, k) => still(600 + k, 90 - 60 * k, 0)));
    const [ring] = s.stillRings(spot);
    const headings = ring.stills.map((v) => v.n);
    assert(headings.join(",") === "600,605,604,603,602,601", `turning right from the first: ${headings}`);
  });

  test("the main lens's turn has three rings, top to bottom", () => {
    const spot = spotOf([
      ...Array.from({ length: 12 }, (_, k) => still(k, 30 * k, -1)),
      ...Array.from({ length: 8 }, (_, k) => still(20 + k, 45 * k, -40)),
      ...Array.from({ length: 8 }, (_, k) => still(40 + k, 45 * k, 28)),
    ]);
    const rings = s.stillRings(spot);
    assert(rings.map((r) => `${r.kind}:${r.stills.length}`).join(" ") === "up:8 level:12 down:8", rings.map((r) => `${r.kind}:${r.stills.length}`).join(" "));
  });

  test("a level still leaning a little is level; a floor still is down however it leans", () => {
    const spot = spotOf([still(1, 0, -13), still(2, 30, 9), still(3, 60, -47), still(4, 90, -55)]);
    const rings = s.stillRings(spot);
    assert(rings.map((r) => `${r.kind}:${r.stills.map((v) => v.n)}`).join(" ") === "level:1,2 down:3,4", rings.map((r) => `${r.kind}:${r.stills.map((v) => v.n)}`).join(" "));
  });

  test("down from a level still goes to the floor's still facing nearest the same way, and back up", () => {
    const [level, down] = s.stillRings(ultraWide());
    // Level still 3 (n 503) faces -12 + 90 = 78 degrees on the page; the floor's face -12, 48, 108...: 48 and 108 are both 30 off.
    const lookOf = (v) => s.lookOfStill(v).yaw;
    const i = s.nearestStill(down, lookOf(level.stills[3]));
    assert([513, 514].includes(down.stills[i]?.n), `the floor's still at 48 or 108 (n ${down.stills[i]?.n})`);
    // Level still 4 (n 504) faces 108: the floor's still at 108 exactly (n 514).
    const j = s.nearestStill(down, lookOf(level.stills[4]));
    assert(down.stills[j]?.n === 514, `the one facing the same way (n ${down.stills[j]?.n})`);
    // And from the floor's still at 168 (n 515), up to the level still at 168 (n 506).
    const k = s.nearestStill(level, lookOf(down.stills[3]));
    assert(level.stills[k]?.n === 506, `back up the same way (n ${level.stills[k]?.n})`);
  });

  test("the plan's wedge turns with the still: its yaw is the view's for looking that way", () => {
    const [level] = s.stillRings(ultraWide());
    const yaw = s.lookOfStill(level.stills[0]).yaw;
    // Heading -12 on the page is a little up from right (east); the view at yaw 0 looks up the page (north), and a
    // larger yaw turns it left: east is a yaw of -90 degrees.
    near((yaw * 180) / Math.PI, -78, "a quarter turn right of north, less 12", 1e-6);
  });

  test("a spot keeps the kind of ring it was shown: down where it has one, else level", () => {
    const rings = s.stillRings(ultraWide());
    assert(s.ringFor(rings, "down") === 1, "down");
    assert(s.ringFor(rings, "up") === 0, "no ring up: level");
    assert(s.ringFor(rings, "level") === 0, "level");
  });

  // ---- Zoom ----
  const stage = { width: 1000, height: 700, fit: { left: 8, top: 8, width: 984, height: 616 } };
  const W = 1440;
  const H = 1920;

  test("a still is fitted whole into the fit box: a portrait one by its height", () => {
    const size = s.fittedSize(stage, W, H);
    near(size.height, 616, "as tall as the box");
    near(size.width, 462, "and three quarters as wide");
    const box = s.placeStill(stage, W, H, s.FIT);
    near(box.left, 500 - 231, "in the middle across");
    near(box.top, 8, "at the top of the box");
  });

  test("zooming about a point keeps what was under it there", () => {
    const fit = s.placeStill(stage, W, H, s.FIT);
    // A point a little left of and above the middle of the still.
    const px = fit.left + fit.width * 0.4;
    const py = fit.top + fit.height * 0.45;
    const z = s.zoomAbout(stage, W, H, s.FIT, 3, px, py);
    near(z.scale, 3, "three times the size");
    const box = s.placeStill(stage, W, H, z);
    near((px - box.left) / box.width, 0.4, "still 40% across", 1e-9);
    near((py - box.top) / box.height, 0.45, "and 45% down", 1e-9);
    // And on in from there, about another point: what is under that one stays too.
    const qx = 700;
    const qy = 200;
    const u = (qx - box.left) / box.width;
    const v = (qy - box.top) / box.height;
    const box2 = s.placeStill(stage, W, H, s.zoomAbout(stage, W, H, z, 5, qx, qy));
    near((qx - box2.left) / box2.width, u, "the second point across", 1e-9);
    near((qy - box2.top) / box2.height, v, "and down", 1e-9);
  });

  test("zoomed in near a still's edge, its edge stays at the stage's rather than coming in", () => {
    const fit = s.placeStill(stage, W, H, s.FIT);
    const z = s.zoomAbout(stage, W, H, s.FIT, 3, fit.left + 5, fit.top + fit.height / 2);
    const box = s.placeStill(stage, W, H, z);
    near(box.left, 0, "the still's left edge at the stage's left");
  });

  test("the zoom stays between the whole still and eight times it", () => {
    assert(s.zoomAbout(stage, W, H, s.FIT, 0.3, 500, 300).scale === 1, "no smaller than the fit");
    assert(s.zoomAbout(stage, W, H, s.FIT, 40, 500, 300).scale === s.MAX_ZOOM, "no larger than the most");
    const back = s.zoomAbout(stage, W, H, { scale: 3, tx: 120, ty: -80 }, 1, 200, 200);
    assert(back.scale === 1 && back.tx === 0 && back.ty === 0, `all the way out, the still back in the middle: ${JSON.stringify(back)}`);
  });

  test("a still zoomed past the stage can be moved only until its edge meets the stage's", () => {
    // At 3x it is 1386 x 1848: wider and taller than the stage.
    const far = s.clampZoom(stage, W, H, { scale: 3, tx: 5000, ty: -5000 });
    const box = s.placeStill(stage, W, H, far);
    near(box.left, 0, "its left edge at the stage's");
    near(box.top + box.height, 700, "its bottom at the stage's");
    const back = s.clampZoom(stage, W, H, { scale: 3, tx: -5000, ty: 5000 });
    const box2 = s.placeStill(stage, W, H, back);
    near(box2.left + box2.width, 1000, "the other way, its right edge at the stage's");
    near(box2.top, 0, "and its top at the stage's");
  });

  test("a still zoomed but still narrower than the stage stays on it", () => {
    // At 1.5x it is 693 wide: narrower than the stage's 1000.
    const z = s.clampZoom(stage, W, H, { scale: 1.5, tx: 900, ty: 0 });
    const box = s.placeStill(stage, W, H, z);
    near(box.left + box.width, 1000, "no further right than the stage's edge");
  });

  return { passed, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runSpotStillsChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
