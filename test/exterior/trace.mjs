/**
 * The AI trace end to end, on a wall whose every measure is known - lib/exteriorPhoto.ts,
 * lib/exteriorTrace.ts and POST /api/exterior/trace.
 *
 *   npm run test:exterior:trace
 *
 * ON CLAUDE'S RECORDED ANSWERS: no call, no server, no key (2026-10-15 - the owner's API balance ran
 * out on development calls, so tests spend none of it). The wall is painted and photographed
 * through a phone camera standing off to one side and tipped up, the camera's `to_photo` is built
 * the way Scan builds it, the side is read through `parseScanExterior` as a phone's send would be,
 * and the photo is squared up by the code the editor runs. Then Claude's answer for that very
 * squared image, recorded from a real call (fixtures/trace-recorded-<scene>.json), is read as the
 * route reads it (`traceProposals`, where each phone stood out of `to_photo`) and set on the photo's
 * edges as the editor does (`snapTrace`). A recording made of a squared image other than the one the
 * scene makes now - the scene or the squaring changed - fails, asking for it to be recorded again.
 *
 * Live, against a running dev server and the route itself - three real calls, about $0.06-0.09
 * each, ONLY with the owner's OK:
 *
 *   SCRIVN_ALLOW_PAID_API=yes npm run dev        (the server's guard, lib/anthropic.ts)
 *   SCRIVN_TRACE_LIVE=1 npm run test:exterior:trace
 *
 * and with SCRIVN_TRACE_RECORD=1 each answer becomes its scene's recording: recovered from the
 * route's proposals (test/exterior/traceRecord.mjs) and kept only when it reads back to them exactly.
 * SCRIVN_TRACE_SCENES=gable,dormer,storeys picks the scenes. What comes back is held to the painted wall:
 *
 *   * the window and the door, each edge within 1.5" (the owner's test: within 1/2" on his house)
 *   * the door's leaf (2026-10-15) inside its trim, each edge within 1.5", and taken for a 34" x 80"
 *     door: a check on the house's sizes (lib/exteriorScale.ts)
 *   * the eaves at each end and the gable's peak within 2", and both slopes alike
 *   * stucco and parging as shapes, the stucco's area within 3%
 *   * the AC unit standing in front of the wall boxed as such, not traced as wall
 *   * the roof (2026-10-15): a gable whose fascia stands 0.55 m out and hangs 1" below the soffit,
 *     the eave returning 0.5 m past each corner - read, once the editor has set the lines on the
 *     photo's edges (snapTrace), as 5/12, the rake overhang within 1" and the eave within 1.5"; and
 *     no dormer, turret or upper floor on it (2026-10-15)
 *   * the roof's shapes (2026-10-15, lib/roofPhotoShapes.ts), on two more sides painted in 3D:
 *       - an eave side with a gable dormer on its 10/12 slope, 1.1 m back: read as one 12/12 gable
 *         dormer, how far back it stands within 0.25 m, its width within 3" and its projection within
 *         6" once worked out on the 10/12, and no upper floor;
 *       - an eave side with the upper floor set back 1.8 m behind a 4/12 lean-to: read as an upper
 *         floor set back behind a lean-to, the roof over the side an eave, and no dormer
 *
 * SCRIVN_BASE_URL points a live run at another server; SCRIVN_TRACE_SAVE=<folder> keeps the photo, the
 * squared image and the answer for a look; SCRIVN_TRACE_DRY=1 paints and squares them, and reads nothing.
 */

import { build } from "esbuild";
import sharp from "sharp";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { proposalsDiffer, wireFromProposals } from "./traceRecord.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
const BASE = process.env.SCRIVN_BASE_URL ?? "http://localhost:3000";
const SAVE = process.env.SCRIVN_TRACE_SAVE ?? "";
const DRY = process.env.SCRIVN_TRACE_DRY === "1";
const LIVE = process.env.SCRIVN_TRACE_LIVE === "1";
const RECORD = LIVE && process.env.SCRIVN_TRACE_RECORD === "1";
/** A scene's recorded answer. */
const recordingOf = (name) => join(here, "fixtures", `trace-recorded-${name}.json`);

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
      `export { snapTrace, traceProposals } from "${lib("exteriorTrace.ts")}";`,
      `export { camerasAt, grayOf } from "${lib("roofPhotoRead.ts")}";`,
      `export { doorCandidates, doorLabel } from "${lib("exteriorScale.ts")}";`,
      `export { resolvePhotoPiece } from "${lib("roofPhotoShapes.ts")}";`,
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
let spent = 0;

/**
 * One side through the code the editor runs and the route it posts to: read as a phone's send would
 * be, its photo squared up, posted. [raw] is the photo, RGB, [cam] its camera; [name] names the saved
 * files under SCRIVN_TRACE_SAVE.
 */
async function postTrace(name, sideJson, raw, cam) {
  const read = x.parseScanExterior(sideJson, { scanId: "fixture" });
  if (!read.ok) throw new Error(read.error);
  const side = read.exterior.sides[0];
  const jpeg = await sharp(raw, { raw: { width: cam.width, height: cam.height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
  const decoded = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const frame = x.squareFrame(side, side.photos);
  const squaredRgba = x.fillOutside(x.squareUp([{ photo: side.photos[0], pixels: { data: decoded.data, width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels } }], frame));
  const squared = await sharp(Buffer.from(squaredRgba), { raw: { width: frame.width, height: frame.height, channels: 4 } }).removeAlpha().jpeg({ quality: 90 }).toBuffer();
  console.log(`  photo ${cam.width}x${cam.height}, squared ${frame.width}x${frame.height} at ${frame.ppm.toFixed(1)} px/m, ${(squared.length / 1024).toFixed(0)} KB`);
  const saveAs = (file) => join(SAVE, name === "gable" ? file : `${name}_${file}`);
  if (SAVE) {
    mkdirSync(SAVE, { recursive: true });
    writeFileSync(saveAs("photo.jpg"), jpeg);
    writeFileSync(saveAs("squared.jpg"), squared);
    writeFileSync(saveAs("side.json"), JSON.stringify(sideJson, null, 1));
  }
  const body = {
    image: squared.toString("base64"),
    frame,
    side: { name: side.name, lengthM: side.lengthFeet / M, bottomLeftM: side.baseLeftFeet / M, bottomRightM: side.baseRightFeet / M, leftEndInPhoto: true, rightEndInPhoto: true },
    // As the editor sends it: the photos the image was squared from, for where the phone stood.
    photos: side.photos.map((ph) => ({ toPhoto: ph.toPhoto, camera: ph.camera })),
  };
  // SCRIVN_TRACE_DRY=1: painted, squared and saved, not read - no call made.
  if (DRY) return null;
  if (!LIVE) {
    // Claude's recorded answer for this squared image, read as the route reads it: where each phone stood out of to_photo.
    const rec = JSON.parse(readFileSync(recordingOf(name), "utf8"));
    const moved = proposalsDiffer(rec.frame, frame, "frame");
    if (moved) {
      console.error(`\nThe ${name} scene no longer squares to the image its answer was recorded for (${moved}). Record it again - a live run with SCRIVN_TRACE_RECORD=1, with the owner's OK.`);
      process.exit(1);
    }
    const p = JSON.parse(JSON.stringify(x.traceProposals(rec.wire, frame, side.lengthFeet, x.camerasAt(side.photos))));
    if (SAVE) writeFileSync(saveAs("answer.json"), JSON.stringify({ frame, proposals: p, recorded: rec.recordedAt }, null, 1));
    console.log(`  Claude's answer recorded ${rec.recordedAt} (${rec.model}, ${rec.usage.inputTokens} in / ${rec.usage.outputTokens} out, $${rec.costUsd.toFixed(3)} then), read as the route reads it - no call`);
    return { side, frame, squared, answer: null, p };
  }
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
  if (SAVE) writeFileSync(saveAs("answer.json"), JSON.stringify({ frame, ...answer }, null, 1));
  spent += answer.costUsd;
  console.log(`  ${answer.model}: ${answer.seconds} s, ${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out, $${answer.costUsd.toFixed(3)}`);
  if (RECORD) record(name, frame, side, answer);
  return { side, frame, squared, answer, p: answer.proposals };
}

/**
 * A live answer kept as its scene's recording: Claude's answer recovered from the route's proposals,
 * and kept only when it reads back to them exactly (test/exterior/traceRecord.mjs).
 */
function record(name, frame, side, answer) {
  let wire;
  try {
    wire = wireFromProposals(answer.proposals, frame, x);
  } catch (err) {
    console.error(`  not recorded: ${err.message}`);
    return;
  }
  const off = proposalsDiffer(x.traceProposals(wire, frame, side.lengthFeet, x.camerasAt(side.photos)), answer.proposals);
  if (off) {
    console.error(`  not recorded: the answer does not read back to what the route gave (${off})`);
    return;
  }
  const keep = { scene: name, recordedAt: new Date().toISOString().slice(0, 10), model: answer.model, usage: answer.usage, costUsd: answer.costUsd, frame, wire };
  writeFileSync(recordingOf(name), `${JSON.stringify(keep, null, 1)}\n`);
  console.log(`  recorded as fixtures/trace-recorded-${name}.json`);
}

/** The roof's shapes as the trace read them, in a line. */
const shapesLine = (p) =>
  `pieces ${(p.pieces ?? []).map((q) => `${q.piece.kind}${q.piece.pitch != null ? ` ${q.piece.pitch}/12` : ""}${q.agree ? "" : " (flagged)"}`).join(", ") || "none"}; storeys ${p.storeys ? `${p.storeys.upper ?? "?"}${p.storeys.lowerRoof ? `, ${p.storeys.lowerRoof}` : ""}${p.storeys.floorLineFeet != null ? `, floor line ${(p.storeys.floorLineFeet / M).toFixed(2)} m` : ""}` : "-"}`;

async function gableScene() {
  console.log("\nthe AI trace, end to end on a painted wall");
  const got = await postTrace("gable", sideJson, shoot(), CAM);
  if (!got) return;
  const { side, frame, squared, p } = got;

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
  // The door's leaf (2026-10-15): the painted door inside its trim - no trim along the bottom - is 0.86 x 2.03 m, a 34" x 80" leaf.
  const LEAF = { a0: DOOR.a0 + DOOR.trim, a1: DOOR.a1 - DOOR.trim, u0: DOOR.u0, u1: DOOR.u1 - DOOR.trim };
  const door = p.openings.find((q) => q.kind === "door");
  if (door?.leaf) {
    const off = edges({ fromLeftFeet: door.leaf.x0, widthFeet: door.leaf.x1 - door.leaf.x0, sillFeet: door.leaf.y0, heightFeet: door.leaf.y1 - door.leaf.y0 }, LEAF);
    check(off.every(([, d]) => Math.abs(d) <= 1.5), `the door's leaf, each edge within 1.5": ${off.map(([e, d]) => `${e} ${d >= 0 ? "+" : ""}${d.toFixed(1)}"`).join(", ")}`);
    const [c] = x.doorCandidates(p.openings, 1);
    check(c?.kind === "door" && c.matches[0]?.size.widthFeet === 34 / 12, `a check on the sizes: ${c ? `${x.doorLabel(c.kind, c.matches[0].size)}, the phone ${((c.matches[0].factor - 1) * 100).toFixed(1)}% off it` : "none"}`);
  } else {
    check(false, "the door's leaf is traced");
  }
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
  // The roof's shapes (2026-10-15): a one-storey gable wall with nothing on its roof - none read.
  console.log(`  shapes: ${shapesLine(p)}`);
  check((p.pieces ?? []).length === 0, "no dormer or turret on a plain gable");
  check(p.storeys?.upper === "none", `no upper floor over it (${p.storeys?.upper ?? "not read"})`);
}

// ---------------------------------------------------------------------------------------------
// The roof's shapes (2026-10-15): a dormer on an eave side, an upper floor set back behind a lean-to
// ---------------------------------------------------------------------------------------------

/** A phone camera as Scan describes it: where it stands, turned [yaw] right and tipped [pitch] up. */
function phoneCam(c) {
  const fwd = [Math.sin(c.yaw) * Math.cos(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch)];
  const right = [Math.cos(c.yaw), -Math.sin(c.yaw), 0];
  const down = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  const q = c.at.map((v) => -v);
  const m = [right, down, fwd].map((r) => [r[0], r[2], dot(r, q)]);
  const K = [
    [c.f, 0, c.width / 2],
    [0, c.f, c.height / 2],
    [0, 0, 1],
  ];
  const H = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H.push(K[i][0] * m[0][j] + K[i][1] * m[1][j] + K[i][2] * m[2][j]);
  return { ...c, fwd, right, down, toPhoto: H.map((v) => v / H[8]) };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const n = Math.hypot(...a);
  return a.map((v) => v / n);
};

/**
 * A flat face of the scene: a planar polygon [pts] (x along the wall, y back from it, z up, metres),
 * coloured by [colour](point) where a ray meets it.
 */
function face(pts, colour) {
  const n = unit(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  const u = unit(sub(pts[1], pts[0]));
  const v = cross(n, u);
  const flat = pts.map((p) => [dot(sub(p, pts[0]), u), dot(sub(p, pts[0]), v)]);
  return { n, d: dot(n, pts[0]), o: pts[0], u, v, flat, colour };
}
function inside(poly, a, b) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > b !== yj > b && a < ((xj - xi) * (b - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
/** Each pixel's ray meets the nearest face, the ground or the sky. */
function render(cam, faces) {
  const { width: W, height: Hh } = cam;
  const data = Buffer.alloc(W * Hh * 3);
  const C = cam.at;
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) {
      const d = [0, 1, 2].map((k) => cam.right[k] * ((i + 0.5 - W / 2) / cam.f) + cam.down[k] * ((j + 0.5 - Hh / 2) / cam.f) + cam.fwd[k]);
      let colour = SKY;
      let best = Infinity;
      for (const f of faces) {
        const den = dot(f.n, d);
        if (Math.abs(den) < 1e-12) continue;
        const t = (f.d - dot(f.n, C)) / den;
        if (!(t > 0 && t < best)) continue;
        const p = [C[0] + t * d[0], C[1] + t * d[1], C[2] + t * d[2]];
        const r = sub(p, f.o);
        if (!inside(f.flat, dot(r, f.u), dot(r, f.v))) continue;
        best = t;
        colour = f.colour(p);
      }
      const tg = d[2] < 0 ? -C[2] / d[2] : Infinity;
      if (tg < best) {
        const g = 0.5 + 0.5 * smooth(C[0] + tg * d[0], C[1] + tg * d[1], 0.3);
        colour = [90 + 30 * g, 120 + 25 * g, 60];
      }
      data[(j * W + i) * 3] = colour[0];
      data[(j * W + i) * 3 + 1] = colour[1];
      data[(j * W + i) * 3 + 2] = colour[2];
    }
  }
  return data;
}

const STUCCO = (p) => {
  const s = 0.6 * smooth(p[0], p[2], 0.05) + 0.4 * smooth(p[0], p[2], 0.17);
  return [150 + 40 * s, 142 + 38 * s, 130 + 34 * s];
};
const PARGING_GREY = (p) => {
  const g = 132 + 14 * smooth(p[0], p[2], 0.2);
  return [g, g, g - 4];
};
/** Shingles: dark courses 0.14 m apart up the slope, a little grain. */
const SHINGLES = (p) => {
  const g = 62 + 10 * smooth(p[0], p[1], 0.07) - (((p[1] + p[2]) / 0.14) % 1 < 0.12 ? 14 : 0);
  return [g, g + 2, g + 6];
};
/** Lap siding: courses 0.15 m apart. */
const SIDING = (p) => {
  const shade = (p[2] / 0.15) % 1 < 0.1 ? 176 : 214;
  return [shade, shade - 6, shade - 22];
};
const WHITE = () => [242, 242, 238];
const SOFFIT = () => [196, 198, 196];
const GLASS = (p) => [70 + 30 * smooth(p[0], p[2], 0.4), 90 + 30 * smooth(p[0], p[2], 0.4), 105];

/** A wall in the plane y = [y] from [a0] to [a1] along and [z0] to [z1] up, [clad] on it, with windows ({a0, a1, z0, z1}) trimmed white 7 cm. */
function wallFace(y, a0, a1, z0, z1, clad, windows = []) {
  return face(
    [
      [a0, y, z0],
      [a1, y, z0],
      [a1, y, z1],
      [a0, y, z1],
    ],
    (p) => {
      for (const w of windows) {
        if (p[0] >= w.a0 && p[0] <= w.a1 && p[2] >= w.z0 && p[2] <= w.z1) return p[0] - w.a0 < 0.07 || w.a1 - p[0] < 0.07 || p[2] - w.z0 < 0.07 || w.z1 - p[2] < 0.07 ? WHITE() : GLASS(p);
      }
      return clad(p);
    },
  );
}

/** An eave along a wall at y = 0 from [a0] to [a1]: its soffit at [top], out [out], and its fascia [fascia] deep. */
function eaveFaces(a0, a1, top, out, fascia, y = 0) {
  return [
    face(
      [
        [a0, y - out, top],
        [a1, y - out, top],
        [a1, y, top],
        [a0, y, top],
      ],
      SOFFIT,
    ),
    face(
      [
        [a0, y - out, top],
        [a1, y - out, top],
        [a1, y - out, top + fascia],
        [a0, y - out, top + fascia],
      ],
      WHITE,
    ),
  ];
}

/** A slope rising back from [y0] at [z0] to [y1] at [m] in 1, from [a0] to [a1] along. */
function slopeFace(a0, a1, y0, z0, y1, m) {
  return face(
    [
      [a0, y0, z0],
      [a1, y0, z0],
      [a1, y1, z0 + m * (y1 - y0)],
      [a0, y1, z0 + m * (y1 - y0)],
    ],
    SHINGLES,
  );
}

/** The side as the phone sends it: an eave side, its eave at [eave] along its whole [length]. */
function eaveSideJson(name, length, eave, cam, windows) {
  return {
    format: "arcapture-exterior/2",
    closed: false,
    walk: "right",
    sides: [
      {
        index: 0,
        name,
        cladding: "stucco",
        length_m: length,
        grade: "ground",
        bottom_left_m: 0.0,
        bottom_right_m: 0.0,
        eave_left_m: eave,
        eave_right_m: eave,
        bands: [],
        shapes: [
          { material: "stucco", label: "Stucco", closed: true, polygon: [[0, 0.45], [length, 0.45], [length, eave], [0, eave]] },
          { material: "parging", label: "Parging", closed: true, polygon: [[0, 0], [length, 0], [length, 0.45], [0, 0.45]] },
        ],
        roofline: [],
        openings: windows.map((w) => ({ kind: "window", from_m: w.a0, width_m: w.a1 - w.a0, sill_m: w.z0, head_m: w.z1 })),
        photos: [{ n: 900, file: "side_1_photo_1.jpg", camera: { width: cam.width, height: cam.height, fx: cam.f, fy: cam.f, cx: cam.width / 2, cy: cam.height / 2 }, to_photo: cam.toPhoto, in_view: null }],
      },
    ],
  };
}

/** The eave sides' own: a 10 m wall, its top 2.9 m up, its eave's fascia 0.45 m out and 8" deep, as Scrivn takes the roof over the soffit. */
const EAVE_SIDE = { L: 10, top: 2.9, out: 0.45, fascia: 0.2032 };
const lowerWalls = (windows) => [wallFace(0, 0, EAVE_SIDE.L, 0, 0.45, PARGING_GREY), wallFace(0, 0, EAVE_SIDE.L, 0.45, EAVE_SIDE.top, STUCCO, windows)];

/*
  A gable dormer on a 10/12 slope (worked by hand): the slope rises from the fascia's top, 3.1032 m up 0.45 m
  out, so 3.4782 m at the wall and 4.3949 m at the dormer's face 1.1 m back - its apron. The face 2.4 m wide
  (3.8 to 6.2 m along), projecting 1.4 m, so its eaves 1.4 x 10/12 = 1.1667 m over the apron, 5.5616 m up;
  12/12, its peak 1.2 m higher, 6.7616 m. Its rakes stand 0.2 m out from its face with a 0.15 m fascia.
*/
const DORM = { b: 1.1, a0: 3.8, a1: 6.2, P: 1.4, m: 10 / 12, k: 1 };
DORM.apron = EAVE_SIDE.top + EAVE_SIDE.fascia + DORM.m * (DORM.b + EAVE_SIDE.out);
DORM.eave = DORM.apron + DORM.m * DORM.P;
DORM.peak = DORM.eave + (DORM.k * (DORM.a1 - DORM.a0)) / 2;

async function dormerScene() {
  console.log("\nthe roof's shapes (10-15): a gable dormer on an eave side's 10/12 slope");
  const D = DORM;
  const mid = (D.a0 + D.a1) / 2;
  const half = (D.a1 - D.a0) / 2;
  const top = (a) => D.eave + D.k * (half - Math.abs(a - mid));
  const o = 0.2;
  const f = 0.15;
  const window = { a0: 1.2, a1: 2.4, z0: 1.0, z1: 2.3 };
  const faces = [
    ...lowerWalls([window]),
    ...eaveFaces(-0.3, EAVE_SIDE.L + 0.3, EAVE_SIDE.top, EAVE_SIDE.out, EAVE_SIDE.fascia),
    slopeFace(-0.3, EAVE_SIDE.L + 0.3, -EAVE_SIDE.out, EAVE_SIDE.top + EAVE_SIDE.fascia, 4.5, D.m),
    // The dormer's face, siding, a window in it.
    face(
      [
        [D.a0, D.b, D.apron],
        [D.a1, D.b, D.apron],
        [D.a1, D.b, D.eave],
        [mid, D.b, D.peak],
        [D.a0, D.b, D.eave],
      ],
      (p) => (p[0] >= mid - 0.4 && p[0] <= mid + 0.4 && p[2] >= D.apron + 0.35 && p[2] <= D.eave - 0.1 ? (Math.min(p[0] - (mid - 0.4), mid + 0.4 - p[0], p[2] - D.apron - 0.35, D.eave - 0.1 - p[2]) < 0.06 ? WHITE() : GLASS(p)) : SIDING(p)),
    ),
    // Its rakes: the fascia 0.2 m out, its soffit back to the face, its roof back into the main slope.
    ...[-1, 1].flatMap((s) => {
      const end = mid + s * (half + o);
      const zEnd = top(end);
      return [
        face(
          [
            [end, D.b - o, zEnd],
            [mid, D.b - o, D.peak],
            [mid, D.b - o, D.peak + f],
            [end, D.b - o, zEnd + f],
          ],
          WHITE,
        ),
        face(
          [
            [end, D.b - o, zEnd],
            [mid, D.b - o, D.peak],
            [mid, D.b, D.peak],
            [end, D.b, zEnd],
          ],
          SOFFIT,
        ),
        face(
          [
            [end, D.b - o, zEnd + f],
            [mid, D.b - o, D.peak + f],
            [mid, 4.5, D.peak + f],
            [end, 4.5, zEnd + f],
          ],
          SHINGLES,
        ),
      ];
    }),
    // Its cheeks, down to the slope.
    ...[D.a0, D.a1].map((a) =>
      face(
        [
          [a, D.b, D.apron],
          [a, D.b, D.eave],
          [a, D.b + D.P, D.eave],
        ],
        SIDING,
      ),
    ),
  ];
  const cam = phoneCam({ at: [5.5, -7.5, 1.6], yaw: 0.03, pitch: 0.26, width: 1920, height: 1440, f: 1250 });
  const got = await postTrace("dormer", eaveSideJson("Front", EAVE_SIDE.L, EAVE_SIDE.top, cam, [window]), render(cam, faces), cam);
  if (!got) return;
  const { p } = got;
  console.log(`  roof over it: ${p.roof?.over ?? "-"}; shapes: ${shapesLine(p)}`);
  for (const c of p.checks) console.log(`  check: ${c}`);
  const dormers = (p.pieces ?? []).filter((q) => q.piece.kind === "gableDormer");
  check(dormers.length === 1 && (p.pieces ?? []).length === 1, `one gable dormer read, nothing else (${(p.pieces ?? []).map((q) => q.piece.kind).join(", ") || "none"})`);
  const q = dormers[0];
  if (q) {
    check(q.agree && q.piece.pitch === 12, `its own pitch 12/12, both slopes alike, ticked: ${q.piece.slopes?.map((v) => v.toFixed(2)).join(" and ") ?? "-"}${q.agree ? "" : " (flagged)"}`);
    // On the roof as built: the 10/12 slope under the 0.45 m eave.
    const r = x.resolvePhotoPiece({ id: "d", taken: true, ...q.piece }, 10, EAVE_SIDE.out * M);
    const back = r.setBackFeet === null ? NaN : r.setBackFeet / M - D.b;
    check(Math.abs(back) <= 0.25, `its face ${D.b} m back, within 0.25 m: ${back >= 0 ? "+" : ""}${back.toFixed(2)} m`);
    const w = inches((r.piece.widthFeet ?? NaN) / M - (D.a1 - D.a0));
    check(Math.abs(w) <= 3, `its width 2.4 m within 3": ${w >= 0 ? "+" : ""}${w.toFixed(1)}"`);
    const proj = inches((r.piece.projectionFeet ?? NaN) / M - D.P);
    check(Math.abs(proj) <= 6, `its projection 1.4 m within 6": ${proj >= 0 ? "+" : ""}${proj.toFixed(1)}"`);
    if (r.checks.length) console.log(`  on the roof: ${r.checks.join(" ")}`);
  }
  check(p.storeys?.upper === "none", `no upper floor: a dormer is not one (${p.storeys?.upper ?? "not read"})`);
}

/*
  Two storeys, the upper floor set back 1.8 m behind a 4/12 lean-to: the lean-to rises from the fascia's top,
  3.1032 m up 0.45 m out, to 3.8532 m at the upper wall; the upper wall in vinyl to 6.3 m, its own eave 0.45 m
  out, its roof 6/12 back from there.
*/
const UPPER = { y: 1.8, top: 6.3, lean: 4 / 12 };
UPPER.foot = EAVE_SIDE.top + EAVE_SIDE.fascia + UPPER.lean * (UPPER.y + EAVE_SIDE.out);

async function storeysScene() {
  console.log("\nthe roof's shapes (10-15): an upper floor set back behind a lean-to");
  const windows = [
    { a0: 1.2, a1: 2.4, z0: 1.0, z1: 2.3 },
    { a0: 7.0, a1: 8.2, z0: 1.0, z1: 2.3 },
  ];
  const faces = [
    ...lowerWalls(windows),
    ...eaveFaces(-0.3, EAVE_SIDE.L + 0.3, EAVE_SIDE.top, EAVE_SIDE.out, EAVE_SIDE.fascia),
    slopeFace(-0.3, EAVE_SIDE.L + 0.3, -EAVE_SIDE.out, EAVE_SIDE.top + EAVE_SIDE.fascia, UPPER.y, UPPER.lean),
    wallFace(UPPER.y, 0, EAVE_SIDE.L, UPPER.foot - 0.05, UPPER.top, SIDING, [
      { a0: 2.0, a1: 3.2, z0: 4.3, z1: 5.6 },
      { a0: 6.8, a1: 8.0, z0: 4.3, z1: 5.6 },
    ]),
    ...eaveFaces(-0.3, EAVE_SIDE.L + 0.3, UPPER.top, EAVE_SIDE.out, EAVE_SIDE.fascia, UPPER.y),
    slopeFace(-0.3, EAVE_SIDE.L + 0.3, UPPER.y - EAVE_SIDE.out, UPPER.top + EAVE_SIDE.fascia, 6.5, 0.5),
  ];
  const cam = phoneCam({ at: [5.0, -8.0, 1.6], yaw: 0.0, pitch: 0.24, width: 1920, height: 1440, f: 1250 });
  const got = await postTrace("storeys", eaveSideJson("Front", EAVE_SIDE.L, EAVE_SIDE.top, cam, windows), render(cam, faces), cam);
  if (!got) return;
  const { p } = got;
  console.log(`  roof over it: ${p.roof?.over ?? "-"}; shapes: ${shapesLine(p)}`);
  for (const c of p.storeys?.checks ?? []) console.log(`  check: ${c}`);
  check(p.storeys?.upper === "setBack" && p.storeys.agree.upper, `an upper floor set back over it (${p.storeys?.upper ?? "not read"})`);
  check(p.storeys?.lowerRoof === "leanto" && p.storeys.agree.lowerRoof, `the roof up to it a lean-to (${p.storeys?.lowerRoof ?? "not read"})`);
  check(p.roof?.over === "eave", `the roof over the side an eave (${p.roof?.over ?? "-"})`);
  check((p.pieces ?? []).length === 0, "no dormer or turret: the upper wall is not one");
}

const SCENES = (process.env.SCRIVN_TRACE_SCENES ?? "gable,dormer,storeys").split(",").map((s) => s.trim());
if (SCENES.includes("gable")) await gableScene();
if (SCENES.includes("dormer")) await dormerScene();
if (SCENES.includes("storeys")) await storeysScene();

console.log(`\n${SCENES.join(", ")}: ${LIVE ? `$${spent.toFixed(3)} in all` : "Claude's recorded answers, no call made"}`);
console.log(`${failures.length === 0 ? "all held" : `${failures.length} did not hold`}`);
if (failures.length > 0) process.exit(1);
