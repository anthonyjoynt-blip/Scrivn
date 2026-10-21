/**
 * A test house's folder for the runner (scripts/house/run.mjs): its photos, its tapes in words, and the runner's own
 * state in <folder>/scrivn/ - the photos themselves are never written. Two kinds of folder:
 *
 *   a folder of photos      dropped on this machine, with tapes.txt (and house.txt) beside them;
 *   a pulled request        exterior-requests/<id>/ from scripts/pull-exterior-request.mjs: request.json carries the
 *                           tester's photos, their shape, corner taps and tapes, which the draft starts from.
 *
 * The session's work is inputs.json (see docs/house-runner.md): the shape, the corners on each photo, where each tape
 * lies. `routeInput` turns it into the photo route's own input (lib/photoRoute.ts PhotoRouteInput).
 */
import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cornerIndex, cornerName, parseHouse, parseTapes, sideIndex, sideName } from "./words.mjs";

export const INPUTS_FORMAT = "scrivn-house-runner/1";
const PHOTO = /\.(jpe?g|png|webp|tiff?)$/i;
/** As Scrivn keeps a site photo (lib/photoImage.ts): at most 2,000 px a side, upright. */
const STORED_PX = 2000;

const p2 = (n) => String(n).padStart(2, "0");

/** When a photo was taken, from its name as a phone names it (20261016_124948), else its EXIF date, else the file's time. */
async function takenAtOf(file) {
  const named = /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/.exec(file.split(/[\\/]/).pop());
  if (named) return new Date(+named[1], +named[2] - 1, +named[3], +named[4], +named[5], +named[6]).getTime();
  try {
    const { exif } = await sharp(file).metadata();
    const m = exif ? /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(exif.toString("latin1")) : null;
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  } catch {
    // no EXIF to read
  }
  return statSync(file).mtimeMs;
}

/** The folder: what kind it is, its photos in walk order (n from 1), and the words beside them. */
export async function openHouse(dirArg) {
  const dir = resolve(dirArg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`No folder at ${dir}.`);
  const state = join(dir, "scrivn");
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : existsSync(join(state, f)) ? readFileSync(join(state, f), "utf8") : null);
  let request = null;
  let photos;
  if (existsSync(join(dir, "request.json"))) {
    request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
    const routePhotos = new Map((request.route?.photos ?? []).map((p) => [p.id, p]));
    photos = request.photos
      .filter((p) => existsSync(join(dir, p.file)))
      .map((p, i) => ({ n: i + 1, file: p.file, id: p.id, takenAt: routePhotos.get(p.id)?.takenAt ?? (p.takenAt ? Date.parse(p.takenAt) : null), focalPrior: routePhotos.get(p.id)?.focalPrior ?? null }));
  } else {
    const files = readdirSync(dir).filter((f) => PHOTO.test(f) && statSync(join(dir, f)).isFile());
    const timed = await Promise.all(files.map(async (f) => ({ file: f, takenAt: await takenAtOf(join(dir, f)) })));
    timed.sort((a, b) => a.takenAt - b.takenAt || a.file.localeCompare(b.file));
    photos = timed.map((p, i) => ({ n: i + 1, file: p.file, id: `p${i + 1}`, takenAt: p.takenAt, focalPrior: null }));
  }
  if (photos.length === 0) throw new Error(`No photos in ${dir} (jpg, png, webp or tiff).`);
  const tapesText = read("tapes.txt");
  const houseText = read("house.txt");
  return { dir, state, kind: request ? "request" : "folder", request, photos, tapesText, houseText, house: parseHouse(houseText ?? "") };
}

export const statePath = (h, ...parts) => join(h.state, ...parts);

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
}

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${path}.`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`);
  }
}

/**
 * Each photo's pixels as the app keeps it (2,000 px at most, upright), and its lens prior from the file's 35 mm focal
 * when it has one. Sizes are put on the photos as read.
 */
export async function loadPixels(h, x) {
  const out = [];
  for (const p of h.photos) {
    const path = join(h.dir, p.file);
    const { data, info } = await sharp(path).rotate().resize({ width: STORED_PX, height: STORED_PX, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    p.width = info.width;
    p.height = info.height;
    if (p.focalPrior == null) {
      const buf = readFileSync(path);
      const f35 = x.exifFocal35(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      p.focalPrior = f35 ? x.focalOverWidth(f35, info.width, info.height) : null;
    }
    out.push({ id: p.id, data, width: info.width, height: info.height, channels: info.channels });
  }
  return out;
}

/** A photo by its number on the sheets (1-based), or its file name, or its id. */
export function photoOf(h, ref) {
  return h.photos.find((p) => p.n === Number(ref)) ?? h.photos.find((p) => p.file === ref || p.id === ref) ?? null;
}

/** A rectangle to start from when nothing better is known: a shape to edit, not a guess at the house. */
const PLACEHOLDER = [
  [0, 0],
  [40, 0],
  [40, 30],
  [0, 30],
];

/**
 * The first inputs.json: the shape (the tester's when they drew one, else a placeholder rectangle), the corners (the
 * tester's taps, numbered as they were), and the tapes (the tester's, or tapes.txt's words, each still to be placed).
 */
export function draftInputs(h) {
  const tapesRead = parseTapes(h.tapesText ?? "");
  const route = h.request?.route ?? null;
  const main = route?.buildings?.find((b) => b.id === h.request?.request?.building) ?? route?.buildings?.[0] ?? null;
  const outline = main?.outline?.length >= 4 ? main.outline.map((p) => [round1(p.x), round1(p.y)]) : PLACEHOLDER;
  const n = outline.length;
  const nOf = new Map(h.photos.map((p) => [p.id, p.n]));
  const corners = (main?.corners ?? [])
    .filter((c) => !c.proposed && nOf.has(c.photo))
    .map((c) => ({ photo: nOf.get(c.photo), x: round1(c.x), y: round1(c.y), ...(c.corner >= 0 && c.corner < n ? { corner: cornerName(c.corner) } : {}), by: c.by === "user" ? "tester" : "tester's phone", ...(c.party ? { party: true } : {}) }));
  const tapes = [];
  for (const t of main?.tapes ?? []) {
    if (t.kind === "side") tapes.push({ id: t.id, said: `the tester's tape: ${sideName(t.from, n)}`, feet: t.feet, what: "wall", kind: "side", side: sideName(t.from, n) });
    else if (nOf.has(t.photo)) tapes.push({ id: t.id, said: `the tester's tape: a ${t.what} on photo ${nOf.get(t.photo)}`, feet: t.feet, what: t.what, kind: "line", on: [{ photo: nOf.get(t.photo), a: t.a.map(round1), b: t.b.map(round1) }] });
  }
  for (const t of tapesRead.tapes) {
    const id = tapes.some((q) => q.id === t.id) ? `${t.id}-words` : t.id;
    if (t.kind === "side") tapes.push({ id, said: t.said, feet: round4(t.feet), what: t.what, kind: "side", side: null });
    else tapes.push({ id, said: t.said, feet: round4(t.feet), what: t.what, kind: "line", count: t.count, on: [], ...(t.alsoFeet ? { alsoFeet: t.alsoFeet.map(round4) } : {}) });
  }
  return {
    format: INPUTS_FORMAT,
    help: "docs/house-runner.md says what each part is and how to fill it in. Corners are C1, C2... as the sheets number them; a side is C5-C6.",
    house: {
      name: h.house.name ?? h.request?.request?.buildingName ?? null,
      homeType: h.house.homeType ?? main?.homeType ?? "detached",
      shared: (main?.shared ?? []).map((i) => sideName(i, n)),
      frontFacesDeg: h.house.frontFacesDeg,
      cladding: null,
      base: null,
      notes: [...h.house.notes, ...(h.request?.request?.note ? [`The tester's note: ${h.request.request.note}`] : [])],
    },
    shape: { from: main?.outline?.length >= 4 ? "tester" : "placeholder", outline, names: {} },
    corners,
    tapes,
    ...(tapesRead.unread.length ? { unread: tapesRead.unread } : {}),
    checks: [],
    leaveOut: [],
    keepProposed: false,
    dropProposed: [],
  };
}

const round1 = (v) => Math.round(v * 10) / 10;
const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * inputs.json as the photo route's input, and what is wrong or missing with it, in plain words. [candidates]: each
 * photo's lettered upright edges from prepare (a corner may be given as one of them).
 */
export function routeInput(h, inputs, candidates = {}) {
  const problems = [];
  const outline = (inputs.shape?.outline ?? []).map((p) => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x), y: Number(p.y) }));
  const n = outline.length;
  if (n < 4) problems.push("shape.outline needs the house's corners in order round it (4 at least).");
  if (outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) problems.push("shape.outline has a corner that is not two numbers [x, y].");
  const area = outline.reduce((s, p, i) => s + p.x * outline[(i + 1) % n].y - outline[(i + 1) % n].x * p.y, 0) / 2;
  if (n >= 4 && area < 0) problems.push("shape.outline runs clockwise: list the corners the other way round (counter-clockwise from above, the street at the bottom).");
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) problems.push(`${sideName(i, n)} is not square to the plan: each side runs across or up and down (right angles everywhere).`);
  }
  // Photos the session left out (one placed where it was not taken, a close-up that misleads): no corner or tape on them counts.
  const out = new Set((inputs.leaveOut ?? []).map((ref) => photoOf(h, ref)?.id).filter(Boolean));
  const corners = [];
  for (const [k, c] of (inputs.corners ?? []).entries()) {
    const p = photoOf(h, c.photo);
    if (!p) {
      problems.push(`corners[${k}]: no photo ${c.photo}.`);
      continue;
    }
    if (out.has(p.id)) continue;
    const at = cornerAt(c, candidates[p.n]);
    if (!at && c.pick && !Number.isFinite(c.x)) problems.push(`corners[${k}]: photo ${p.n} has no candidate "${c.pick}".`);
    if (!at) {
      if (c.pick === undefined) problems.push(`corners[${k}] on photo ${p.n}: give x and y (photo pixels) or a candidate's letter as pick.`);
      continue;
    }
    const corner = c.corner === undefined || c.corner === null ? -1 : cornerIndex(c.corner, n);
    if (corner === null) {
      problems.push(`corners[${k}] on photo ${p.n}: "${c.corner}" is no corner of a ${n}-corner shape.`);
      continue;
    }
    const by = c.by === "tester's phone" ? "app" : corner >= 0 ? "user" : undefined;
    // Put on the edge from a close-up (an edge, or said exact): taken as placed, not snapped onto a rib beside it.
    const exact = c.exact === true || Array.isArray(c.edge);
    const top = Array.isArray(c.edge) ? (c.edge[0][1] < c.edge[1][1] ? c.edge[0] : c.edge[1]).map(Number) : null;
    corners.push({ photo: p.id, corner, x: at[0], y: at[1], ...(by ? { by } : {}), ...(c.party ? { party: true } : {}), ...(exact ? { exact: true } : {}), ...(top ? { top } : {}) });
  }
  const tapes = [];
  const tapeParts = {};
  for (const t of inputs.tapes ?? []) {
    if (!(Number(t.feet) > 0)) {
      problems.push(`tape ${t.id} (${t.said ?? ""}): no length.`);
      continue;
    }
    if (t.skip) continue;
    if (t.kind === "side") {
      const from = sideIndex(t.side, n);
      if (from === null) problems.push(`tape ${t.id} (${t.said}): which side? Set "side" to the wall it runs along, corner to corner, e.g. "C5-C6".`);
      else {
        tapes.push({ id: t.id, kind: "side", from, feet: Number(t.feet) });
        tapeParts[t.id] = [t.id];
      }
      continue;
    }
    const on = (t.on ?? []).filter((o) => o && o.a && o.b);
    if (on.length === 0) {
      problems.push(`tape ${t.id} (${t.said}): not placed. Put each end on a photo: "on": [{"photo": n, "a": [x, y], "b": [x, y]}]${t.count > 1 ? ` (it says ${t.count} alike: one entry each)` : ""}.`);
      continue;
    }
    if (t.count > 1 && on.length < t.count) problems.push(`tape ${t.id} (${t.said}) says ${t.count} alike, ${on.length} placed: fine if the rest show on no photo.`);
    tapeParts[t.id] = [];
    on.forEach((o, k) => {
      const p = photoOf(h, o.photo);
      if (!p) {
        problems.push(`tape ${t.id}: no photo ${o.photo}.`);
        return;
      }
      if (out.has(p.id)) return;
      const id = on.length === 1 ? t.id : `${t.id}#${k + 1}`;
      const exact = t.exact === true || o.exact === true;
      tapes.push({ id, kind: "line", photo: p.id, a: o.a.map(Number), b: o.b.map(Number), feet: Number(t.feet), what: ["garage", "door", "window", "wall", "other"].includes(t.what) ? t.what : "other", ...(exact ? { exact: true } : {}) });
      tapeParts[t.id].push(id);
    });
  }
  // Where the user stood for a photo the measure couldn't place for sure ("standAt": {"3": [x, y]}, feet on the shape as drawn).
  const standAt = {};
  for (const [ref, at] of Object.entries(inputs.standAt ?? {})) {
    const p = photoOf(h, ref);
    if (!p) problems.push(`standAt: no photo ${ref}.`);
    else if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => Number.isFinite(Number(v)))) problems.push(`standAt ${ref}: two numbers [x, y], feet on the shape as drawn.`);
    else standAt[p.id] = [Number(at[0]), Number(at[1])];
  }
  const shared = (inputs.house?.shared ?? []).map((s) => sideIndex(s, n)).filter((i) => i !== null);
  const homeType = inputs.house?.homeType && inputs.house.homeType !== "detached" ? inputs.house.homeType : undefined;
  const input = {
    photos: h.photos.map((p) => ({ id: p.id, width: p.width, height: p.height, focalPrior: p.focalPrior ?? null, takenAt: p.takenAt ?? null, ...(standAt[p.id] ? { standAt: standAt[p.id] } : {}) })),
    buildings: [{ id: "main", ...(inputs.house?.name ? { name: inputs.house.name } : {}), ...(homeType ? { homeType } : {}), ...(shared.length ? { shared } : {}), outline, corners, tapes }],
  };
  return { input, problems, tapeParts, n };
}

/**
 * Where a corner given in inputs.json is on its photo: its x and y; or a candidate's foot ({"pick": "c"}); or a
 * candidate's edge at a row of its own ({"pick": "c", "y": 1000}: the edge followed down to where the corner meets the
 * ground). Null when neither is there.
 */
export function cornerAt(c, cands = []) {
  // The corner's edge, its top and its foot: the foot is the tap.
  if (Array.isArray(c.edge) && c.edge.length === 2) return lowerEnd(c.edge);
  if (Number.isFinite(c.x) && Number.isFinite(c.y)) return [c.x, c.y];
  if (!c.pick) return null;
  const cand = cands.find((q) => q.pick === String(c.pick).toLowerCase());
  if (!cand) return null;
  if (!Number.isFinite(c.y) || !cand.top || Math.abs(cand.top[1] - cand.y) < 1) return [cand.x, Number.isFinite(c.y) ? c.y : cand.y];
  return [cand.x + ((c.y - cand.y) * (cand.top[0] - cand.x)) / (cand.top[1] - cand.y), c.y];
}

/** Of two points along an upright edge, the one lower in the photo: where it meets the ground. */
export const lowerEnd = (edge) => (edge[0][1] >= edge[1][1] ? edge[0] : edge[1]).map(Number);

/** A two-digit name for a photo's files: 03 for photo 3. */
export const nn = (n) => p2(n);
