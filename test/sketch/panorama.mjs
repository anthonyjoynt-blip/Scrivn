/**
 * A 360° spot's panorama, as numbers (lib/panorama.ts): the panorama's map, a frame's camera, the
 * proxy's warp, and the two solves - one small turn per frame from where its overlaps disagree, and
 * one gain per frame from where their brightness does - checked on a made-up room whose true turns are
 * known: frames rendered from it, put out by a few degrees as the phone's sensor puts them out, and
 * the alignment asked to find the truth again.
 *
 *   node test/sketch/panorama.mjs        (also runs as part of npm run test:sketch)
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "panorama-tests-"));
  const entry = join(outDir, "entry.ts");
  writeFileSync(
    entry,
    `export * from "${join(root, "lib", "panorama.ts").replace(/\\/g, "/")}";\n` +
      `export { navigable } from "${join(root, "lib", "walkView.ts").replace(/\\/g, "/")}";\n`,
  );
  const outfile = join(outDir, "panorama.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const DEG = Math.PI / 180;

/** A seeded random number, so a failure is the same failure every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function runPanoramaChecks() {
  const P = await load();
  const passed = [];
  const failures = [];
  const test = async (name, run) => {
    try {
      await run();
      passed.push(name);
    } catch (err) {
      failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const near = (a, b, message, tol = 1e-9) => {
    if (Math.abs(a - b) > tol) throw new Error(`${message}\n      expected ~${b}\n      actual    ${a}`);
  };
  const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, P.dot(P.norm(a), P.norm(b))))) / DEG;

  // The phone's camera, upright: 1080 x 1920, about 45 x 73 degrees.
  const camera = { width: 1080, height: 1920, fx: 1290, fy: 1290, cx: 540, cy: 960 };
  /** A frame looking at [yawDeg] (0 down -z, turning right) and [pitchDeg], level-topped. */
  const frameAt = (yawDeg, pitchDeg, offset = [0, 0, 0]) => {
    const forward = P.dirOfEquirect(0.5 + yawDeg / 360, 0.5 + pitchDeg / 180);
    const up0 = [0, 1, 0];
    const k = P.dot(up0, forward);
    const up = P.norm([up0[0] - forward[0] * k, up0[1] - forward[1] * k, up0[2] - forward[2] * k]);
    return { forward, up, right: P.norm(P.cross(forward, up)), offset, camera };
  };
  /** The spot's 28 frames as the phone takes them: 12 level, 8 at -40, 8 at +30, the tilted rings offset 22.5 degrees. */
  const spotFrames = () => [
    ...Array.from({ length: 12 }, (_, k) => frameAt(k * 30, 0)),
    ...Array.from({ length: 8 }, (_, k) => frameAt(22.5 + k * 45, -40)),
    ...Array.from({ length: 8 }, (_, k) => frameAt(22.5 + k * 45, 30)),
  ];

  await test("the panorama's map: straight ahead in the middle, turning right to the right, up at the top", () => {
    const ahead = P.dirOfEquirect(0.5, 0.5);
    near(ahead[2], -1, "the middle looks down -z", 1e-12);
    const right = P.dirOfEquirect(0.75, 0.5);
    near(right[0], 1, "three quarters across looks along +x", 1e-12);
    near(P.dirOfEquirect(0.3, 1)[1], 1, "the top row is straight up", 1e-12);
    const r = rng(7);
    for (let k = 0; k < 200; k++) {
      const d = P.norm([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]);
      const [u, v] = P.equirectOf(d);
      const back = P.dirOfEquirect(u, v);
      assert(angleDeg(back, d) < 1e-4, `round trip off by ${angleDeg(back, d)} degrees`);
    }
  });

  await test("a frame's camera: a pixel's ray lands back on the pixel; the middle of the picture is where it looks", () => {
    const f = frameAt(37, -12);
    for (const [px, py] of [[540, 960], [10, 20], [1070, 1900], [300, 1500]]) {
      const p = P.projectToFrame(f, P.rayOfPixel(f, px, py));
      assert(p && Math.abs(p[0] - px) < 1e-6 && Math.abs(p[1] - py) < 1e-6, `pixel ${px},${py} came back as ${p}`);
    }
    assert(angleDeg(P.rayOfPixel(f, 540, 960), f.forward) < 1e-4, "the principal point looks along forward");
    // The top of the picture is up: a pixel above the middle looks higher.
    assert(P.rayOfPixel(f, 540, 100)[1] > f.forward[1], "a row near the top looks higher than the middle");
    assert(P.projectToFrame(f, [-f.forward[0], -f.forward[1], -f.forward[2]]) === null, "behind the camera is nowhere on it");
  });

  await test("the proxy's warp: a frame a foot to the side looks at the wall's point from where it stood", () => {
    const warp = P.warpThrough(() => 10);
    const f = { ...frameAt(0, 0), offset: [1, 0, 0] };
    const d = [0, 0, -1];
    const w = warp(f, d);
    // The point 10' ahead, seen from a foot to its right: a little to the left.
    assert(angleDeg(w, P.norm([-1, 0, -10])) < 1e-9, `warped ${w}`);
    assert(angleDeg(P.warpThrough(() => Number.NaN)(f, d), d) < 1e-12, "no distance, no warp");
  });

  await test("solving the turns: exact overlaps of a perturbed spot give back the perturbation, to a hundredth of a degree", () => {
    const frames = spotFrames();
    const r = rng(11);
    // The sensor's errors, up to 3 degrees about every axis, adding up to nothing (the solve keeps the whole spot put).
    let truth = frames.map(() => [(r() * 2 - 1) * 3 * DEG, (r() * 2 - 1) * 3 * DEG, (r() * 2 - 1) * 3 * DEG]);
    const mean = [0, 1, 2].map((a) => truth.reduce((s, t) => s + t[a], 0) / truth.length);
    truth = truth.map((t) => [t[0] - mean[0], t[1] - mean[1], t[2] - mean[2]]);
    const pairs = [];
    for (const [i, j] of P.overlappingPairs(frames)) {
      const c = P.norm([frames[i].forward[0] + frames[j].forward[0], frames[i].forward[1] + frames[j].forward[1], frames[i].forward[2] + frames[j].forward[2]]);
      const e1 = P.norm(P.cross(Math.abs(c[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], c));
      const e2 = P.cross(c, e1);
      // The correction is minus the error, so (w_i - w_j) x c = (t_j - t_i) x c.
      const dt = [truth[j][0] - truth[i][0], truth[j][1] - truth[i][1], truth[j][2] - truth[i][2]];
      const s = P.cross(dt, c);
      pairs.push({ i, j, c, e1, e2, dx: P.dot(s, e1), dy: P.dot(s, e2), r: 0.9, n: 9000, weight: 1 });
    }
    const w = P.solveRotations(frames.length, pairs, 4, 0);
    let worst = 0;
    w.forEach((wk, k) => {
      for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(wk[a] + truth[k][a]) / DEG);
    });
    assert(worst < 0.05, `worst axis off by ${worst.toFixed(3)} degrees over ${pairs.length} pairs`);
    assert(P.residualDeg(pairs, w) < 0.01, `residual ${P.residualDeg(pairs, w)}`);
  });

  await test("solving the turns: a few bad matches among good ones are weighed down, not believed", () => {
    const frames = spotFrames();
    const pairs = [];
    for (const [i, j] of P.overlappingPairs(frames)) {
      const c = P.norm([frames[i].forward[0] + frames[j].forward[0], frames[i].forward[1] + frames[j].forward[1], frames[i].forward[2] + frames[j].forward[2]]);
      const e1 = P.norm(P.cross(Math.abs(c[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], c));
      pairs.push({ i, j, c, e1, e2: P.cross(c, e1), dx: 0, dy: 0, r: 0.9, n: 9000, weight: 1 });
    }
    // Three matches that landed on the wrong thing: 6 degrees out.
    for (const k of [2, 17, 31]) pairs[k].dx = 6 * DEG;
    const w = P.solveRotations(frames.length, pairs);
    const worst = Math.max(...w.map((v) => Math.hypot(...v) / DEG));
    assert(worst < 0.6, `a frame turned ${worst.toFixed(2)} degrees for three bad matches`);
  });

  await test("solving the gains: frames exposed differently come out even", () => {
    const n = 12;
    const r = rng(5);
    const exposure = Array.from({ length: n }, () => 0.75 + r() * 0.5);
    const overlaps = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const L = 0.2 + r() * 0.5;
      const ch = [L, L * 0.9, L * 0.8];
      overlaps.push({ i: Math.min(i, j), j: Math.max(i, j), n: 3000, a: ch.map((c) => c * exposure[Math.min(i, j)]), b: ch.map((c) => c * exposure[Math.max(i, j)]) });
    }
    const g = P.solveGains(n, overlaps);
    const seen = g.map((gk, k) => gk[0] * exposure[k]);
    const spread = (Math.max(...seen) - Math.min(...seen)) / Math.min(...seen);
    // From 50% apart to a few: the pull of every gain towards 1 (sigmaG) keeps a little, by design - it is what
    // stops a frame being darkened or brightened to match a bad overlap.
    assert(spread < 0.06, `exposures still ${(spread * 100).toFixed(1)}% apart after the gains: ${seen.map((s) => s.toFixed(3)).join(" ")}`);
    const before = (Math.max(...exposure) - Math.min(...exposure)) / Math.min(...exposure);
    assert(before > 0.2, "the test starts uneven");
  });

  // A made-up room: soft spots of light and dark scattered over the sphere, so every overlap has edges to match.
  const scene = (() => {
    const r = rng(42);
    const spots = Array.from({ length: 700 }, () => ({
      d: P.norm([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]),
      s: (1.5 + r() * 4) * DEG,
      a: r() * 2 - 1,
    }));
    return (d) => {
      let v = 0.5;
      for (const sp of spots) {
        const c = P.dot(d, sp.d);
        if (c < 0.98) continue;
        const ang = Math.acos(Math.min(1, c));
        v += 0.4 * sp.a * Math.exp(-(ang * ang) / (2 * sp.s * sp.s));
      }
      return v;
    };
  })();
  /** Frame [f]'s picture of the made-up room, a quarter size. */
  const render = (f) => {
    const scale = 0.25;
    const w = Math.round(f.camera.width * scale);
    const h = Math.round(f.camera.height * scale);
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = scene(P.rayOfPixel(f, (x + 0.5) / scale, (y + 0.5) / scale));
    return { w, h, scale, data };
  };

  await test("measuring an overlap: a frame turned 2 degrees by the sensor shows its content 2 degrees off, where it should", () => {
    const fi = frameAt(0, 0);
    const fj = frameAt(30, 0);
    const grays = [render(fi), render(fj)];
    const omega = [0, 2 * DEG, 1.5 * DEG];
    const assumed = P.applyRotations([fi, fj], [[0, 0, 0], omega]);
    const p = P.measurePair(assumed, grays, 0, 1);
    assert(p && p.weight > 0, `no usable match: ${JSON.stringify(p && { r: p.r, n: p.n })}`);
    const s = P.cross(omega, p.c);
    near(p.dx / DEG, P.dot(s, p.e1) / DEG, "shift along e1, degrees", 0.15);
    near(p.dy / DEG, P.dot(s, p.e2) / DEG, "shift along e2, degrees", 0.15);
  });

  await test("aligning a whole spot: frames put out by up to 3 degrees come back to within a third of a degree", async () => {
    const truth = spotFrames();
    const grays = truth.map(render);
    const r = rng(3);
    let errs = truth.map(() => [(r() * 2 - 1) * 3 * DEG, (r() * 2 - 1) * 3 * DEG, (r() * 2 - 1) * 1.5 * DEG]);
    const mean = [0, 1, 2].map((a) => errs.reduce((s, t) => s + t[a], 0) / errs.length);
    errs = errs.map((t) => [t[0] - mean[0], t[1] - mean[1], t[2] - mean[2]]);
    const sensor = P.applyRotations(truth, errs);
    const before = Math.max(...sensor.map((f, k) => angleDeg(f.forward, truth[k].forward)));
    const out = await P.alignFrames(sensor, grays, null, { rounds: 2 });
    assert(out, "the alignment ran");
    const after = out.frames.map((f, k) => Math.max(angleDeg(f.forward, truth[k].forward), angleDeg(f.up, truth[k].up)));
    const worst = Math.max(...after);
    assert(worst < 0.35, `worst frame still ${worst.toFixed(2)} degrees off (it started ${before.toFixed(2)}); residual ${out.before.toFixed(2)} -> ${out.after.toFixed(2)}, ${out.used} overlaps`);
  });

  await test("where walk mode goes: a storey's spots when it has any, its photos when it has none", () => {
    const pt = (level, spot) => ({ key: { walk: 0, photo: spot ? -1 : 1, spot }, level, position: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0], right: [1, 0, 0], camera, scanId: "s", n: 1, tS: 0, ...(spot ? { frames: [] } : {}) });
    const pts = [pt(0), pt(0), pt(0, 1), pt(1), pt(1), pt(-1, 2), pt(-1, 3)];
    const nav = P.navigable(pts);
    assert(nav.filter((p) => p.level === 0).length === 1 && nav.find((p) => p.level === 0).frames, "the main floor: its one spot, not its photos");
    assert(nav.filter((p) => p.level === 1).length === 2 && nav.every((p) => p.level !== 1 || !p.frames), "upstairs, with no spot: its photos");
    assert(nav.filter((p) => p.level === -1).length === 2, "the basement: both its spots");
  });

  return { passed, failures };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { passed, failures } = await runPanoramaChecks();
  for (const p of passed) console.log(`  ok   ${p}`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`\n${passed.length} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
