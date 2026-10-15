/**
 * The AI trace end to end, on a wall whose every measure is known - lib/exteriorPhoto.ts,
 * lib/exteriorTrace.ts and POST /api/exterior/trace.
 *
 *   npm run dev            (with ANTHROPIC_API_KEY, signed in or on the dev fail-open - see test/pipeline)
 *   npm run test:exterior:trace
 *
 * ONE REAL CLAUDE CALL, about $0.05-0.08. Nothing here is mocked: the wall is painted and
 * photographed through a phone camera standing off to one side and tipped up, the camera's
 * `to_photo` is built the way Scan builds it, the side is read through `parseScanExterior` as a
 * phone's send would be, the photo is squared up by the code the editor runs and posted to the
 * route the editor posts to. What comes back is held to the painted wall:
 *
 *   * the window and the door, each edge within 1.5" (the owner's test: within 1/2" on his house)
 *   * the eaves at each end and the gable's peak within 2", and both slopes alike
 *   * stucco and parging as shapes, the stucco's area within 3%
 *   * the AC unit standing in front of the wall boxed as such, not traced as wall
 *   * the roof (2026-10-15): a gable whose fascia stands 0.55 m out and hangs 1" below the soffit,
 *     the eave returning 0.5 m past each corner - read, once the editor has set the lines on the
 *     photo's edges (snapTrace), as 5/12, the rake overhang within 1" and the eave within 1.5"
 *
 * SCRIVN_BASE_URL points it at another server; SCRIVN_TRACE_SAVE=<folder> keeps the photo, the
 * squared image and the answer for a look.
 */

import { build } from "esbuild";
import sharp from "sharp";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
const BASE = process.env.SCRIVN_BASE_URL ?? "http://localhost:3000";
const SAVE = process.env.SCRIVN_TRACE_SAVE ?? "";

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "exterior-trace-"));
  const entry = join(outDir, "entry.ts");
  const outfile = join(outDir, "entry.mjs");
  writeFileSync(
    entry,
    [
      `export * from "${lib("exteriorImport.ts")}";`,
      `export * from "${lib("exteriorPhoto.ts")}";`,
      `export * from "${lib("exterior.ts")}";`,
      `export { snapTrace } from "${lib("exteriorTrace.ts")}";`,
      `export { camerasAt, grayOf } from "${lib("roofPhotoRead.ts")}";`,
    ].join("\n"),
  );
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, alias: { "@": root }, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}
const x = await load();
const M = 1 / 0.3048;
const inches = (m) => m * 39.37;

// ---------------------------------------------------------------------------------------------
// The wall, in metres: the plane y = 0, x along from its left end, z up from the ground
// ---------------------------------------------------------------------------------------------

const L = 8.4;
const EAVE = 2.9;
const PEAK = { along: 4.2, up: 4.65 };
const PARGING = 0.45;
const WINDOW = { a0: 1.3, a1: 2.5, u0: 1.0, u1: 2.4, trim: 0.08 };
const DOOR = { a0: 5.6, a1: 6.6, u0: PARGING, u1: 2.55, trim: 0.07 };
/** In front of the wall: 0.15 to 0.85 m out from it. */
const AC = { a0: 6.9, a1: 7.7, out0: 0.15, out1: 0.85, u1: 0.85 };
/** The roof's edge, in 3D: the rake 0.55 m out, the eave 0.5 m past each corner, the fascia 0.18 m deep and hanging 1" below the soffit. */
const ROOF = { rake: 0.55, eave: 0.5, fascia: 0.18, hang: 0.0254, depth: 12 };

/** The wall top over x: the eave at both ends, rising to the peak; the rakes run on past the ends. */
function wallTop(a) {
  return EAVE + (PEAK.up - EAVE) * (a <= PEAK.along ? a / PEAK.along : (L - a) / (L - PEAK.along));
}

/** A hash noise in 0..1, for the stucco's texture. */
function noise(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(a, u, cell) {
  const fa = a / cell;
  const fu = u / cell;
  const i = Math.floor(fa);
  const j = Math.floor(fu);
  const s = fa - i;
  const t = fu - j;
  return (noise(i, j) * (1 - s) + noise(i + 1, j) * s) * (1 - t) + (noise(i, j + 1) * (1 - s) + noise(i + 1, j + 1) * s) * t;
}

const SKY = [150, 190, 232];
/** The colour of the wall's plane at (a, u). */
function wallColour(a, u) {
  const top = wallTop(a);
  if (u > top || a < 0 || a > L) return SKY;
  const inside = (r, m = 0) => a >= r.a0 + m && a <= r.a1 - m && u >= r.u0 + (r === DOOR ? 0 : m) && u <= r.u1 - m;
  if (inside(WINDOW)) {
    if (!inside(WINDOW, WINDOW.trim)) return [246, 246, 246];
    if (Math.abs(a - (WINDOW.a0 + WINDOW.a1) / 2) < 0.025) return [240, 240, 240];
    return [70 + 30 * smooth(a, u, 0.4), 90 + 30 * smooth(a, u, 0.4), 105];
  }
  if (inside(DOOR)) {
    if (!inside(DOOR, DOOR.trim)) return [246, 246, 246];
    return Math.abs(a - 6.45) < 0.03 && Math.abs(u - 1.5) < 0.03 ? [200, 170, 60] : [112, 46, 40];
  }
  if (u < PARGING) {
    const g = 132 + 14 * smooth(a, u, 0.2);
    return [g, g, g - 4];
  }
  const s = 0.6 * smooth(a, u, 0.05) + 0.4 * smooth(a, u, 0.17);
  return [150 + 40 * s, 142 + 38 * s, 130 + 34 * s];
}

// ---------------------------------------------------------------------------------------------
// The phone: 7.5 m out, off to the left of the middle, turned right and tipped up
// ---------------------------------------------------------------------------------------------

// Off to the left of the peak, so the two rakes stand differently high above it and tell the fascia's hang from its overhang.
const CAM = { at: [1.6, -7.5, 1.6], yaw: 0.33, pitch: 0.17, width: 1920, height: 1080, f: 1250 };
const fwd = [Math.sin(CAM.yaw) * Math.cos(CAM.pitch), Math.cos(CAM.yaw) * Math.cos(CAM.pitch), Math.sin(CAM.pitch)];
const right = [Math.cos(CAM.yaw), -Math.sin(CAM.yaw), 0];
const down = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

/** Scan's SidePhoto.homography: K times the camera's rows against (along, up, 1), over its last entry. */
function toPhoto() {
  const q = CAM.at.map((v) => -v);
  const m = [right, down, fwd].map((r) => [r[0], r[2], dot(r, q)]);
  const K = [
    [CAM.f, 0, CAM.width / 2],
    [0, CAM.f, CAM.height / 2],
    [0, 0, 1],
  ];
  const H = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H.push(K[i][0] * m[0][j] + K[i][1] * m[1][j] + K[i][2] * m[2][j]);
  return H.map((v) => v / H[8]);
}

/**
 * Where a ray from [C] along [d] meets the roof's edge, nearest first: the rake's fascia face, the
 * soffit under the rake, and past each corner the eave's fascia and soffit running back along the
 * house. Null when it meets none of them.
 */
function roofHit(C, d) {
  const s = (PEAK.up - EAVE) / PEAK.along;
  const at = (t) => [C[0] + t * d[0], C[1] + t * d[1], C[2] + t * d[2]];
  const hits = [];
  // The rake's fascia: the face out at the rake, from below the soffit by the hang to the fascia's depth above that.
  if (Math.abs(d[1]) > 1e-12) {
    const t = (-ROOF.rake - C[1]) / d[1];
    const [a, , u] = at(t);
    const bottom = wallTop(a) - ROOF.hang;
    if (t > 0 && a >= -ROOF.eave && a <= L + ROOF.eave && u >= bottom && u <= bottom + ROOF.fascia) hits.push({ t, colour: [240, 240, 236] });
  }
  // The soffit under each rake: level going out, at the wall top's height.
  for (const [k, side] of [
    [s, -1],
    [-s, 1],
  ]) {
    // u = EAVE + s a (left) or u = PEAK.up - s (a - PEAK.along) (right): u - k a = c.
    const c = k > 0 ? EAVE : PEAK.up + s * PEAK.along;
    const den = d[2] - k * d[0];
    if (Math.abs(den) < 1e-12) continue;
    const t = (c + k * C[0] - C[2]) / den;
    const [a, y] = at(t);
    const onSide = side < 0 ? a >= -ROOF.eave && a <= PEAK.along : a >= PEAK.along && a <= L + ROOF.eave;
    if (t > 0 && onSide && y >= -ROOF.rake && y <= 0) hits.push({ t, colour: [196, 198, 196] });
  }
  // Past each corner: the eave's fascia face and its soffit, running back from the rake along the house.
  for (const x of [-ROOF.eave, L + ROOF.eave]) {
    if (Math.abs(d[0]) < 1e-12) continue;
    const t = (x - C[0]) / d[0];
    const [, y, u] = at(t);
    if (t > 0 && y >= -ROOF.rake && y <= ROOF.depth && u >= EAVE - ROOF.hang && u <= EAVE - ROOF.hang + ROOF.fascia) hits.push({ t, colour: [240, 240, 236] });
  }
  if (Math.abs(d[2]) > 1e-12) {
    const t = (EAVE - C[2]) / d[2];
    const [a, y] = at(t);
    if (t > 0 && y >= -ROOF.rake && y <= ROOF.depth && ((a >= -ROOF.eave && a <= 0) || (a >= L && a <= L + ROOF.eave))) hits.push({ t, colour: [196, 198, 196] });
  }
  return hits.sort((p, q) => p.t - q.t)[0] ?? null;
}

/** The photo: each pixel's ray meets the AC unit, the ground, the roof's edge or the wall, whichever is nearest. */
function shoot() {
  const { width: W, height: H } = CAM;
  const data = Buffer.alloc(W * H * 3);
  const C = CAM.at;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const d = [0, 1, 2].map((k) => right[k] * ((i + 0.5 - W / 2) / CAM.f) + down[k] * ((j + 0.5 - H / 2) / CAM.f) + fwd[k]);
      let colour = SKY;
      let best = Infinity;
      const tw = d[1] > 0 ? -C[1] / d[1] : Infinity;
      if (tw < best) {
        const c = wallColour(C[0] + tw * d[0], C[2] + tw * d[2]);
        if (c !== SKY) {
          best = tw;
          colour = c;
        }
      }
      const roof = roofHit(C, d);
      if (roof && roof.t < best) {
        best = roof.t;
        colour = roof.colour;
      }
      const tg = d[2] < 0 ? -C[2] / d[2] : Infinity;
      if (tg < best) {
        best = tg;
        const g = 0.5 + 0.5 * smooth(C[0] + tg * d[0], C[1] + tg * d[1], 0.3);
        colour = [90 + 30 * g, 120 + 25 * g, 60];
      }
      // The AC unit, a box: the slab method.
      let t0 = 0;
      let t1 = Infinity;
      for (const [k, lo, hi] of [
        [0, AC.a0, AC.a1],
        [1, -AC.out1, -AC.out0],
        [2, 0, AC.u1],
      ]) {
        if (Math.abs(d[k]) < 1e-12) {
          if (C[k] < lo || C[k] > hi) t0 = Infinity;
          continue;
        }
        const ta = (lo - C[k]) / d[k];
        const tb = (hi - C[k]) / d[k];
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      if (t0 <= t1 && t0 < best) {
        const top = Math.abs(C[2] + t0 * d[2] - AC.u1) < 1e-6;
        const grille = Math.floor((C[2] + t0 * d[2]) / 0.04) % 2 === 0;
        colour = top ? [150, 152, 150] : grille ? [70, 72, 70] : [92, 94, 92];
      }
      data[(j * W + i) * 3] = colour[0];
      data[(j * W + i) * 3 + 1] = colour[1];
      data[(j * W + i) * 3 + 2] = colour[2];
    }
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// The side as the phone sends it: taps a few centimetres out, as taps are
// ---------------------------------------------------------------------------------------------

const H = toPhoto();
const sideJson = {
  format: "arcapture-exterior/2",
  closed: false,
  walk: "right",
  sides: [
    {
      index: 0,
      name: "Gable end",
      cladding: "stucco",
      length_m: L,
      grade: "ground",
      bottom_left_m: 0.02,
      bottom_right_m: 0.0,
      eave_left_m: 2.86,
      eave_right_m: 2.95,
      peak: { along_m: 4.15, height_m: 4.6 },
      pitch_12: 4.9,
      bands: [],
      shapes: [
        { material: "stucco", label: "Stucco", closed: true, polygon: [[0, 0.47], [L, 0.43], [L, 2.95], [4.15, 4.6], [0, 2.86]] },
        { material: "parging", label: "Parging", closed: true, polygon: [[0, 0.02], [L, 0], [L, 0.43], [0, 0.47]] },
      ],
      roofline: [],
      openings: [
        { kind: "window", from_m: 1.33, width_m: 1.15, sill_m: 1.03, head_m: 2.37 },
        { kind: "door", from_m: 5.63, width_m: 0.95, sill_m: 0.47, head_m: 2.5 },
      ],
      photos: [{ n: 900, file: "side_1_photo_1.jpg", camera: { width: CAM.width, height: CAM.height, fx: CAM.f, fy: CAM.f, cx: CAM.width / 2, cy: CAM.height / 2 }, to_photo: H, in_view: null }],
    },
  ],
};

const failures = [];
function check(ok, what) {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
}

console.log("\nthe AI trace, end to end on a painted wall");
const read = x.parseScanExterior(sideJson, { scanId: "fixture" });
if (!read.ok) throw new Error(read.error);
const side = read.exterior.sides[0];

const raw = shoot();
const jpeg = await sharp(raw, { raw: { width: CAM.width, height: CAM.height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
const decoded = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
const frame = x.squareFrame(side, side.photos);
const squaredRgba = x.fillOutside(x.squareUp([{ photo: side.photos[0], pixels: { data: decoded.data, width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels } }], frame));
const squared = await sharp(Buffer.from(squaredRgba), { raw: { width: frame.width, height: frame.height, channels: 4 } }).removeAlpha().jpeg({ quality: 90 }).toBuffer();
console.log(`  photo ${CAM.width}x${CAM.height}, squared ${frame.width}x${frame.height} at ${frame.ppm.toFixed(1)} px/m, ${(squared.length / 1024).toFixed(0)} KB`);

if (SAVE) {
  mkdirSync(SAVE, { recursive: true });
  writeFileSync(join(SAVE, "photo.jpg"), jpeg);
  writeFileSync(join(SAVE, "squared.jpg"), squared);
  writeFileSync(join(SAVE, "side.json"), JSON.stringify(sideJson, null, 1));
}
const body = {
  image: squared.toString("base64"),
  frame,
  side: { name: side.name, lengthM: side.lengthFeet / M, bottomLeftM: side.baseLeftFeet / M, bottomRightM: side.baseRightFeet / M, leftEndInPhoto: true, rightEndInPhoto: true },
  // As the editor sends it: the photos the image was squared from, for where the phone stood.
  photos: side.photos.map((ph) => ({ toPhoto: ph.toPhoto, camera: ph.camera })),
};
let response;
try {
  response = await fetch(`${BASE}/api/exterior/trace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
} catch (err) {
  console.error(`\nCould not reach ${BASE}: start it with \`npm run dev\` first. (${err.message})`);
  process.exit(1);
}
const answer = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(`\nThe route answered ${response.status}: ${answer.error ?? "no reason given"}`);
  process.exit(1);
}
if (SAVE) writeFileSync(join(SAVE, "answer.json"), JSON.stringify({ frame, ...answer }, null, 1));
const p = answer.proposals;
console.log(`  ${answer.model}: ${answer.seconds} s, ${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out, $${answer.costUsd.toFixed(3)}`);

/** Each edge of the proposal against the painted rectangle, inches. */
function edges(o, r) {
  return [
    ["left", inches(o.fromLeftFeet / M - r.a0)],
    ["right", inches((o.fromLeftFeet + o.widthFeet) / M - r.a1)],
    ["bottom", inches(o.sillFeet / M - r.u0)],
    ["top", inches((o.sillFeet + o.heightFeet) / M - r.u1)],
  ];
}
for (const [name, r, kind] of [
  ["window", WINDOW, "window"],
  ["door", DOOR, "door"],
]) {
  const o = p.openings.find((q) => q.kind === kind && Math.abs(q.fromLeftFeet / M - r.a0) < 0.5);
  if (!o) {
    check(false, `the ${name} is traced`);
    continue;
  }
  const off = edges(o, r);
  check(off.every(([, d]) => Math.abs(d) <= 1.5), `the ${name}, each edge within 1.5": ${off.map(([e, d]) => `${e} ${d >= 0 ? "+" : ""}${d.toFixed(1)}"`).join(", ")}`);
}
check(p.openings.length === 2, `two openings, no more (${p.openings.map((o) => o.traced).join(", ")})`);
const top = p.wallTop;
if (top) {
  const eL = top.eaveLeftFeet === null ? NaN : inches(top.eaveLeftFeet / M - EAVE);
  const eR = top.eaveRightFeet === null ? NaN : inches(top.eaveRightFeet / M - EAVE);
  check(Math.abs(eL) <= 2 && Math.abs(eR) <= 2, `the eaves within 2": left ${eL.toFixed(1)}", right ${eR.toFixed(1)}"`);
  const pk = top.peak ? inches(top.peak.peakFeet / M - PEAK.up) : NaN;
  const at = top.peak ? inches(top.peak.atFeet / M - PEAK.along) : NaN;
  check(Math.abs(pk) <= 2 && Math.abs(at) <= 4, `the peak within 2" up and 4" along: ${pk.toFixed(1)}", ${at.toFixed(1)}"`);
  const pitch = ((PEAK.up - EAVE) / PEAK.along) * 12;
  check(top.slopes !== null && top.slopes.every((s) => Math.abs(s - pitch) <= 0.25), `both slopes ${pitch.toFixed(2)}/12 within 1/4: ${top.slopes?.map((s) => s.toFixed(2)).join(" and ")}`);
} else {
  check(false, "a wall top");
}
const stucco = p.shapes.filter((s) => s.kind === "stucco").reduce((sum, s) => sum + s.squareFeet, 0);
const want = (L * (EAVE - PARGING) + (L * (PEAK.up - EAVE)) / 2) * M * M;
check(Math.abs(stucco - want) / want <= 0.03, `the stucco ${stucco.toFixed(0)} SF gross, painted ${want.toFixed(0)} SF (${(((stucco - want) / want) * 100).toFixed(1)}%)`);
check(p.shapes.some((s) => s.kind === "parging"), "the parging traced as parging");
check(p.offWall.some((b) => /\b(ac|a\/c|air|condens|hvac|unit)\b/i.test(b.what)), `the AC unit in front of the wall: ${p.offWall.map((b) => b.what).join("; ") || "nothing boxed"}`);
if (p.checks.length) console.log(`  checks: ${p.checks.join(" ")}`);
if (p.notes) console.log(`  its notes: ${p.notes}`);

// The roof: as the route reads it, and as the editor reads it once the lines are set on the photo's edges.
const ftIn = (feet) => (feet === null || feet === undefined ? "-" : `${(feet * 12).toFixed(1)}"`);
const roofLine = (r) =>
  r
    ? `${r.over ?? "?"}; pitch ${r.pitch ? `${r.pitch.value}/12 (${r.pitch.slopes.map((v) => v.toFixed(2)).join(", ")})` : "-"}; rake ${ftIn(r.rakeOverhang?.feet)}${r.rakeOverhang?.hangFeet != null ? ` (hang ${ftIn(r.rakeOverhang.hangFeet)})` : ""}; eave ${ftIn(r.eaveOverhang?.feet)}; ends ${r.ends.left} / ${r.ends.right}`
    : "none";
console.log(`  roof, as traced: ${roofLine(p.roof)}`);
const g = x.grayOf({ ...(await sharp(squared).raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({ data, width: info.width, height: info.height, channels: info.channels }))) });
const snapped = x.snapTrace(p, frame, g, side.lengthFeet, x.camerasAt(side.photos)).roof;
console.log(`  roof, set on the photo's edges: ${roofLine(snapped)}`);
if (snapped?.checks.length) console.log(`  roof checks: ${snapped.checks.join(" ")}`);
if (snapped?.notes) console.log(`  its roof notes: ${snapped.notes}`);
const pitch12 = ((PEAK.up - EAVE) / PEAK.along) * 12;
check(snapped?.over === "gable", `the roof over the side: a gable (${snapped?.over})`);
check(snapped?.snapped !== null && snapped?.snapped !== undefined, "the lines set on the photo's own edges");
check(snapped?.pitch?.value === Math.round(pitch12) && snapped.pitch.slopes.every((v) => Math.abs(v - pitch12) <= 0.15), `pitch ${pitch12.toFixed(1)}/12, each slope within 0.15: ${snapped?.pitch?.slopes.map((v) => v.toFixed(2)).join(", ")}`);
const rakeOff = snapped?.rakeOverhang ? inches(snapped.rakeOverhang.feet / M - ROOF.rake) : NaN;
check(Math.abs(rakeOff) <= 1, `the rake overhang within 1": ${rakeOff >= 0 ? "+" : ""}${rakeOff.toFixed(1)}"`);
// The eave at the rakes' feet: within 1.5", or - where Claude puts a foot off it - flagged and left unticked, never ticked wrong.
const eaveOff = snapped?.eaveOverhang ? inches(snapped.eaveOverhang.feet / M - ROOF.eave) : NaN;
const eaveRight = Math.abs(eaveOff) <= 1.5;
const eaveFlagged = snapped?.eaveOverhang ? !snapped.eaveOverhang.agree : false;
check(eaveRight || eaveFlagged, `the eave overhang within 1.5", or flagged: ${eaveOff >= 0 ? "+" : ""}${eaveOff.toFixed(1)}"${eaveFlagged ? " (flagged, not ticked)" : ""}`);

console.log(`\n${failures.length === 0 ? "all held" : `${failures.length} did not hold`}`);
if (failures.length > 0) process.exit(1);
