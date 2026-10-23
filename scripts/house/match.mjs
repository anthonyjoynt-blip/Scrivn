/**
 * The house runner's close-ups laid on their walls (2026-10-23): `run.mjs <folder> match`, after measure. The owner's
 * capture is each wall's full photo, straight on, and a few close-ups of it ("Take more of this wall"); the close-ups size
 * nothing (since ad25ad1), but laid exactly on the full photo - a wall is flat, so one homography does it
 * (lib/photoRouteMatch.ts) - what they show lands at the wall's true scale and place, at the close-up's resolution.
 *
 *   match     each close-up laid on its wall's full photo, in code, or from 4 points tapped on both; a picture of each
 *             (scrivn/match/NN on MM.jpg: the two in a checkerboard, the points that agree in yellow); a tape whose ends
 *             are on a close-up checked against the wall as the measure scaled it - and again with that tape held out,
 *             the honest number; scrivn/match.json. `read` then adds each close-up to its side's sheet.
 *
 * inputs.json "details" (a pulled request's walk says them itself: each "more of this wall" photo with its wall's first):
 *
 *   "details": [{"photo": 22, "full": 33,                  the close-up and its wall's full photo (or a list to try: [33, 34])
 *                "side": "C2-C3",                           optional: else the side the matched points are on, seen from the full photo
 *                "taps": [[xd, yd, xf, yf], ...],           optional: 4 or more points on both (the close-up's, the full's), when code can't
 *                "tapes": [{"tape": "t5", "a": [x, y], "b": [x, y]}]}]   optional: a tape's ends read off the close-up, to check
 *
 * A tape already placed on a close-up (inputs.json tapes[].on) is checked too. Nothing here sizes anything, and nothing
 * here calls an API.
 */
import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { scrivn } from "./code.mjs";
import { loadPixels, photoOf, readJson, routeInput, statePath, writeJson } from "./folder.mjs";
import { photoOnSide } from "./read.mjs";
import { ftin, sideIndex, sideName } from "./words.mjs";

const FOOT_M = 0.3048;
const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** The close-ups to lay, each with the full photos to try: inputs.json's, else the walk's ("more of this wall" with its wall's first photo). */
export function detailsOf(h, inputs, x) {
  const out = [];
  for (const d of inputs.details ?? []) {
    const p = photoOf(h, d.photo);
    const fulls = (Array.isArray(d.full) ? d.full : [d.full]).map((f) => photoOf(h, f)).filter(Boolean);
    if (!p || fulls.length === 0) continue;
    out.push({ photo: p, fulls, side: d.side ?? null, taps: Array.isArray(d.taps) && d.taps.length >= 4 ? d.taps.map((t) => t.map(Number)) : null, tapes: d.tapes ?? [] });
  }
  if (out.length || !h.request?.route?.walk) return out;
  const byId = (id) => h.photos.find((p) => p.id === id);
  for (const c of x.wallCloseUps(h.request.route.walk)) {
    const p = byId(c.photo);
    const f = byId(c.full);
    if (p && f) out.push({ photo: p, fulls: [f], side: null, taps: null, tapes: [] });
  }
  return out;
}

/** A photo's lens and level: as the measure placed it, else levelled with the measure's lens (as a detail photo is). */
function cameraOf(x, m, p, lines) {
  const lens = m.lenses?.[p.id];
  if (lens) return { width: lens.width, height: lens.height, f: lens.f, k: lens.k, R: lens.R };
  const level = x.levelPhotos([{ width: p.width, height: p.height, segments: lines.segments, focalPrior: null, regions: null }], { fitLens: false, focalOverWidth: m.focalOverWidth, k: m.k });
  return level.cameras[0] ?? null;
}

/** Which side the matched points are on, seen from the full photo's camera: each point's ray cast on the plan, the side most hit first. */
function sideOfPoints(x, m, rc, points) {
  const lens = m.lenses[rc.photo];
  if (!lens) return null;
  const yaw = (rc.yawTweakDeg * Math.PI) / 180;
  const votes = new Map();
  for (const [px, py] of points) {
    const [u] = x.toLevel(lens, px, py);
    const dir = x.planDirection(x.columnBearing(lens, u), rc.quadrant, yaw);
    const hit = x.castRayToSides({ x: rc.at[0], y: rc.at[1] }, dir, m.corners);
    if (hit) votes.set(hit.side, (votes.get(hit.side) ?? 0) + 1);
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/** The close-up as a photo of side [i] of measure [m], through full photo [full] and the match: null when the full photo is not placed or does not see the side. */
export function detailOnSide(x, m, h, detail, full, matchH, i) {
  const rc = m.cameras.find((c) => c.photo === full.id);
  if (!rc) return null;
  const on = photoOnSide(x, m, rc, i, full.n);
  if (!on) return null;
  const dl = m.lenses[detail.id];
  const sp = x.detailSidePhoto(on.sp, { h: matchH }, { width: detail.width, height: detail.height, f: dl?.f ?? m.focalOverWidth * Math.max(detail.width, detail.height), k: dl?.k ?? m.k }, 900 + detail.n - 1, detail.id, on.lengthFeet * FOOT_M);
  return sp ? { sp, lengthFeet: on.lengthFeet } : null;
}

/** A picture of a match: the full photo round where the close-up lies, the two in a checkerboard, the points that agree in yellow. */
async function matchPicture(x, pxF, pxD, camF, camD, match) {
  const hi = invert(match.h);
  const corners = [
    [0, 0],
    [camD.width, 0],
    [0, camD.height],
    [camD.width, camD.height],
  ].map(([a, b]) => {
    const [u, v] = x.undistort(camD, a, b);
    const w = match.h[6] * u + match.h[7] * v + match.h[8];
    return w > 0 ? x.distort(camF, (match.h[0] * u + match.h[1] * v + match.h[2]) / w, (match.h[3] * u + match.h[4] * v + match.h[5]) / w) : null;
  });
  const ok = corners.filter(Boolean);
  const xs = ok.map((p) => p[0]);
  const ys = ok.map((p) => p[1]);
  const mx = (Math.max(...xs) - Math.min(...xs)) * 0.15;
  const my = (Math.max(...ys) - Math.min(...ys)) * 0.15;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - mx));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - my));
  const x1 = Math.min(pxF.width, Math.ceil(Math.max(...xs) + mx));
  const y1 = Math.min(pxF.height, Math.ceil(Math.max(...ys) + my));
  const W = Math.max(1, x1 - x0);
  const H = Math.max(1, y1 - y0);
  const cell = Math.max(16, Math.round(Math.max(W, H) / 24));
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const fx = xx + x0;
      const fy = y + y0;
      const o = (fy * pxF.width + fx) * pxF.channels;
      let rgb = [pxF.data[o], pxF.data[o + 1], pxF.data[o + 2]];
      if (((xx / cell) | 0) % 2 === ((y / cell) | 0) % 2) {
        const [u, v] = x.undistort(camF, fx, fy);
        const w = hi[6] * u + hi[7] * v + hi[8];
        if (w > 0) {
          const [dx, dy] = x.distort(camD, (hi[0] * u + hi[1] * v + hi[2]) / w, (hi[3] * u + hi[4] * v + hi[5]) / w);
          const ix = Math.round(dx);
          const iy = Math.round(dy);
          if (ix >= 0 && iy >= 0 && ix < pxD.width && iy < pxD.height) {
            const q = (iy * pxD.width + ix) * pxD.channels;
            rgb = [pxD.data[q], pxD.data[q + 1], pxD.data[q + 2]];
          }
        }
      }
      buf[(y * W + xx) * 3] = rgb[0];
      buf[(y * W + xx) * 3 + 1] = rgb[1];
      buf[(y * W + xx) * 3 + 2] = rgb[2];
    }
  }
  const dots = match.pairs.map((p) => `<circle cx="${(p.f[0] - x0).toFixed(1)}" cy="${(p.f[1] - y0).toFixed(1)}" r="${Math.max(3, W / 300).toFixed(1)}" fill="none" stroke="#ffe600" stroke-width="2"/>`).join("");
  const scale = Math.min(1, 1400 / Math.max(W, H));
  const drawn = await sharp(buf, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${dots}</svg>`), left: 0, top: 0 }])
    .png()
    .toBuffer();
  return sharp(drawn).resize(Math.round(W * scale), Math.round(H * scale)).jpeg({ quality: 85 }).toBuffer();
}

function invert(m) {
  const [a, b, c, d, e, f, g, hh, i] = m;
  const A = e * i - f * hh;
  const B = -(d * i - f * g);
  const C = d * hh - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * hh) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * hh - b * g) / det, (a * e - b * d) / det];
}

/** The tapes to check on a close-up: one placed on it (tapes[].on), and its own "tapes" (a tape's ends read off it). */
function tapesOn(h, inputs, d) {
  const out = [];
  for (const t of inputs.tapes ?? []) {
    if (t.kind === "side" || !(Number(t.feet) > 0)) continue;
    for (const o of t.on ?? []) if (photoOf(h, o.photo)?.id === d.photo.id && o.a && o.b) out.push({ tape: t.id, said: t.said ?? "", feet: Number(t.feet), a: o.a.map(Number), b: o.b.map(Number) });
  }
  for (const r of d.tapes) {
    const t = (inputs.tapes ?? []).find((q) => q.id === r.tape);
    const feet = Number(r.feet ?? t?.feet);
    if (!(feet > 0) || !r.a || !r.b) continue;
    out.push({ tape: r.tape ?? null, said: r.said ?? t?.said ?? "", feet, a: r.a.map(Number), b: r.b.map(Number) });
  }
  return out;
}

export async function match(h) {
  const t0 = Date.now();
  const x = await scrivn();
  const inputs = readJson(statePath(h, "inputs.json"));
  const measuredFile = statePath(h, "measured.json");
  if (!existsSync(measuredFile)) throw new Error("No measured.json: run measure first.");
  const ext = readJson(measuredFile);
  const m = ext.photoRoute.measured;
  const n = m.sideIds.length;
  const list = detailsOf(h, inputs, x);
  if (list.length === 0) return ['No close-ups to lay on a wall: inputs.json "details" lists none, and there is no walk that says them.'];
  const pixels = await loadPixels(h, x);
  const pxOf = (p) => pixels[h.photos.findIndex((q) => q.id === p.id)];
  const lines = new Map();
  const linesOf = (p) => {
    if (!lines.has(p.id)) lines.set(p.id, x.photoLines(pxOf(p)));
    return lines.get(p.id);
  };
  const dir = statePath(h, "match");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".jpg")) rmSync(join(dir, f));
  const nameOf = (i) => ext.sides.find((s) => s.id === m.sideIds[i])?.name ?? sideName(i, n);
  const results = [];
  const out = [];
  for (const d of list) {
    const camD = cameraOf(x, m, d.photo, linesOf(d.photo));
    let best = null;
    const tried = [];
    for (const f of d.fulls) {
      const camF = cameraOf(x, m, f, linesOf(f));
      let r;
      if (d.taps) {
        const mt = camD && camF ? x.matchFromTaps(d.taps, camD, camF) : null;
        r = { match: mt, words: mt ? `From ${d.taps.length} points tapped on both: ${mt.rmsPx.toFixed(1)} px off a plane.` : "The taps don't fix a plane (4 or more, not in a line)." };
      } else if (!camD || !camF) r = { match: null, words: `${!camD ? "The close-up" : "The full photo"} could not be levelled: tap 4 points on both ("taps").` };
      else r = x.matchDetail({ gray: linesOf(d.photo).gray, camera: camD }, { gray: linesOf(f).gray, camera: camF });
      tried.push({ full: f.n, words: r.words });
      if (r.match && (!best || r.match.inliers * Math.max(0.01, r.match.ncc) > best.match.inliers * Math.max(0.01, best.match.ncc))) best = { match: r.match, full: f, camF, words: r.words };
    }
    const head = `#${d.photo.n} ${d.photo.file}`;
    if (!best) {
      out.push(`  ${head}: not laid on a wall - ${tried.map((t) => `on #${t.full}: ${t.words}`).join("; ")}`);
      results.push({ photo: d.photo.n, file: d.photo.file, laid: false, tried });
      continue;
    }
    const rc = m.cameras.find((c) => c.photo === best.full.id);
    const side = d.side ? sideIndex(d.side, n) : rc ? sideOfPoints(x, m, rc, best.match.pairs.map((p) => p.f)) : null;
    const pic = `${String(d.photo.n).padStart(2, "0")} on ${String(best.full.n).padStart(2, "0")}.jpg`;
    await sharp(await matchPicture(x, pxOf(best.full), pxOf(d.photo), best.camF, camD, best.match)).toFile(join(dir, pic));
    const on = side !== null ? detailOnSide(x, m, h, d.photo, best.full, best.match.h, side) : null;
    const row = {
      photo: d.photo.n,
      file: d.photo.file,
      laid: true,
      full: best.full.n,
      fullFile: best.full.file,
      side: side !== null ? sideName(side, n) : null,
      sideName: side !== null ? nameOf(side) : null,
      by: best.match.by,
      points: best.match.points,
      inliers: best.match.inliers,
      rmsPx: Math.round(best.match.rmsPx * 100) / 100,
      ncc: Math.round(best.match.ncc * 100) / 100,
      zoom: Math.round(best.match.zoom * 100) / 100,
      h: best.match.h,
      picture: `match/${pic}`,
      words: best.words,
      checks: [],
    };
    out.push(`  ${head} on #${best.full.n} ${best.full.file}${row.side ? ` (${row.side} ${row.sideName})` : rc ? " (no side: its points are on none)" : " (the full photo is not placed: no wall to read it on)"}: ${best.words}`);
    if (on) {
      for (const t of tapesOn(h, inputs, d)) {
        const l = x.wallLine(on.sp, t.a, t.b);
        if (!l) continue;
        row.checks.push({ tape: t.tape, said: t.said, taped: t.feet, a: t.a, b: t.b, feet: Math.round(l.feet * 1000) / 1000, offPct: Math.round(((l.feet - t.feet) / t.feet) * 1000) / 10 });
      }
    }
    row.lengthFeet = on?.lengthFeet ?? null;
    results.push(row);
  }
  // Each tape checked again with that tape held out: the house sized by the rest, the close-up laid on the wall as they
  // put it. The honest number: with it in, the tape set the wall's scale it is checked against.
  const checked = results.filter((r) => r.laid && r.checks.some((c) => c.tape));
  if (checked.length) {
    const t1 = Date.now();
    const candidates = readJson(statePath(h, "candidates.json"), { photos: {} }).photos;
    const { input, tapeParts } = routeInput(h, inputs, candidates, x);
    const allLines = h.photos.map((p) => linesOf(p));
    const dropped = readJson(statePath(h, "results.json"), {}).selfCheck?.dropped?.photo;
    const solveOpts = { ...(inputs.sizePhotos === "all" ? { sizePhotos: "all" } : {}), ...(dropped ? { outOfSize: [photoOf(h, dropped)?.id].filter(Boolean) } : {}) };
    const mm = x.measureRoute(input, "main", pixels, { lines: allLines, solve: solveOpts });
    const withCorners = { ...input, buildings: [{ ...input.buildings[0], corners: mm.corners }] };
    const heldBy = new Map();
    for (const r of checked) {
      for (const c of r.checks) {
        if (!c.tape || !tapeParts[c.tape]?.length) continue;
        if (!heldBy.has(c.tape)) {
          const sol = x.solveRoute(withCorners, "main", mm.prepared.data, { ...solveOpts, withoutTapes: tapeParts[c.tape], guesses: false });
          heldBy.set(c.tape, x.measuredFrom(sol, mm.prepared.data, new Date().toISOString()));
        }
        const held = heldBy.get(c.tape);
        const detail = photoOf(h, r.photo);
        const full = photoOf(h, r.full);
        const i = sideIndex(r.side, n);
        const on = i !== null ? detailOnSide(x, held, h, detail, full, r.h, i) : null;
        const l = on ? x.wallLine(on.sp, c.a, c.b) : null;
        if (l) {
          c.heldOut = { feet: Math.round(l.feet * 1000) / 1000, offPct: Math.round(((l.feet - c.taped) / c.taped) * 1000) / 10 };
        } else c.heldOut = null;
      }
    }
    out.push(`  (each tape held out: the house measured again without it, ${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  }
  for (const r of results) {
    for (const c of r.checks ?? []) {
      out.push(`  check ${c.tape ?? ""} ${c.said.split(/[(,;]/)[0].trim()}, taped ${ftin(c.taped)}: on #${r.photo} laid on #${r.full}, ${ftin(c.feet)} on ${r.side} (${pct(c.offPct)})${c.heldOut ? `; with ${c.tape} held out ${ftin(c.heldOut.feet)} (${pct(c.heldOut.offPct)})` : c.heldOut === null ? `; with ${c.tape} held out: the full photo is not placed` : ""}`);
    }
  }
  const laid = results.filter((r) => r.laid);
  writeJson(statePath(h, "match.json"), {
    about: "Each close-up laid on its wall's full photo (run.mjs match, lib/photoRouteMatch.ts): h takes the close-up's pixel to the full photo's, both with the lens's radial term taken out. Checks: a tape on the close-up, as long as the wall the measure scaled makes it, and with that tape held out. Nothing here sizes anything.",
    details: results,
  });
  return [
    `Close-ups laid on their walls: ${laid.length} of ${results.length} (${laid.filter((r) => r.by === "code").length} in code, ${laid.filter((r) => r.by === "taps").length} from taps).`,
    ...out,
    `Pictures: ${relative(h.dir, dir)}/ (the two photos in a checkerboard: the wall's lines run straight through where they agree). match.json; read adds each to its side's sheet.`,
    `Machine time: ${((Date.now() - t0) / 1000).toFixed(1)} s.`,
  ];
}
