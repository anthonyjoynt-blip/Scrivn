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
import { cornerIndex, cornerName, parseHouse, parseMap, parseTapes, sideIndex, sideName } from "./words.mjs";

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
  let photoDir = dir;
  if (existsSync(join(dir, "request.json"))) {
    request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
    const routePhotos = new Map((request.route?.photos ?? []).map((p) => [p.id, p]));
    photos = request.photos
      .filter((p) => existsSync(join(dir, p.file)))
      .map((p, i) => ({ n: i + 1, file: p.file, id: p.id, takenAt: routePhotos.get(p.id)?.takenAt ?? (p.takenAt ? Date.parse(p.takenAt) : null), focalPrior: routePhotos.get(p.id)?.focalPrior ?? null }));
  } else {
    // The photos beside the words, or in a photos/ folder of their own (2026-10-23: the test-house repo's layout, houses/<house>/photos/).
    const photosIn = (d) => readdirSync(d).filter((f) => PHOTO.test(f) && statSync(join(d, f)).isFile());
    const sub = join(dir, "photos");
    if (photosIn(dir).length === 0 && existsSync(sub) && statSync(sub).isDirectory()) photoDir = sub;
    const files = photosIn(photoDir);
    const timed = await Promise.all(files.map(async (f) => ({ file: f, takenAt: await takenAtOf(join(photoDir, f)) })));
    timed.sort((a, b) => a.takenAt - b.takenAt || a.file.localeCompare(b.file));
    // Once numbered (scrivn/photos.json), each photo keeps its number and its time: a photo with no date in its name or EXIF
    // takes the file's time, which a fresh clone or copy changes - and inputs.json names photos by number, and the measure
    // orders the walk by time (10-23: a copy of a blind run's folder measured differently until it kept them). New photos go after.
    const before = new Map((readJsonQuiet(join(state, "photos.json"))?.photos ?? []).filter((p) => p?.file && Number.isInteger(p.n)).map((p) => [p.file, p]));
    const kept = timed.filter((p) => before.has(p.file)).sort((a, b) => before.get(a.file).n - before.get(b.file).n);
    let next = Math.max(0, ...kept.map((p) => before.get(p.file).n));
    const was = (p) => ({ ...p, n: before.get(p.file).n, takenAt: Number.isFinite(before.get(p.file).takenAt) ? before.get(p.file).takenAt : p.takenAt });
    photos = [...kept.map(was), ...timed.filter((p) => !before.has(p.file)).map((p) => ({ ...p, n: ++next }))].map((p) => ({ n: p.n, file: p.file, id: `p${p.n}`, takenAt: p.takenAt, focalPrior: null }));
  }
  if (photos.length === 0) throw new Error(`No photos in ${dir}${photoDir === dir ? " or its photos/ folder" : ""} (jpg, png, webp or tiff).`);
  const tapesText = read("tapes.txt");
  const houseText = read("house.txt");
  const walkText = read("walk.txt");
  // The walk's corners in order, "corner 4 inside" a line (2026-10-23: the test-house repo keeps them apart from walk.txt).
  const cornersText = read("corners.txt");
  // The building's outline off a map, when one is beside the photos (2026-10-23): it holds the long walls it traces.
  const mapText = read("map.txt");
  // The roof answers (scrivn/roof.json): what the roof covers past the walls, which a map's outline runs along (2026-10-23).
  const roofText = read("roof.json");
  return { dir, state, photoDir, kind: request ? "request" : "folder", request, photos, tapesText, houseText, walkText, cornersText, mapText, roofText, house: parseHouse(houseText ?? "") };
}

/** A photo's file on disk: beside the words, or in the folder's photos/. */
export const photoPath = (h, p) => join(h.photoDir ?? h.dir, p.file);

/** A JSON file's contents, or null when it is missing or not JSON. */
function readJsonQuiet(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) : null;
  } catch {
    return null;
  }
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
    const path = photoPath(h, p);
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
  // Measured on the walk round the house, typed on the phone (2026-10-21, lib/photoRouteWalk.ts WalkMeasure): what and how
  // long, the photo it's on, and maybe one rough tap on it ("near") - never its ends, which are ours to place
  // (`tape w1 3 = x,y x,y`). A wall's length the walk laid on its side is a tape of the route already, above.
  const taped = new Set((main?.tapes ?? []).map((t) => t.id));
  // A close-up of a tape (2026-10-22) shows the tape, not the house: read off, never measured as a photo of the house.
  const tapeShots = new Set();
  let w = 0;
  for (const s of route?.walk?.stops ?? []) {
    for (const m of s.measures ?? []) {
      if (taped.has(m.id) || !(Number(m.feet) > 0)) continue;
      w += 1;
      const n = m.photo ? nOf.get(m.photo) : undefined;
      const near = n && Array.isArray(m.near) ? { photo: n, x: round1(m.near[0]), y: round1(m.near[1]) } : null;
      const tapeN = m.tapePhoto ? nOf.get(m.tapePhoto) : undefined;
      if (tapeN) tapeShots.add(tapeN);
      const said = `the tester's measurement, typed on the walk: ${m.what === "wall" ? "a wall's length, corner to corner" : `a ${m.what === "garage" ? "garage door" : m.what}`}${n ? ` on photo ${n}` : ", on its wall's photos"}${near ? `, tapped roughly at ${near.x},${near.y}` : ""}${tapeN ? `; the tape close up on photo ${tapeN}` : ""}`;
      if (m.what === "wall") tapes.push({ id: `w${w}`, walk: m.id, said, feet: m.feet, what: "wall", kind: "side", side: null });
      else tapes.push({ id: `w${w}`, walk: m.id, said, feet: m.feet, what: m.what, kind: "line", on: [], ...(near ? { near } : {}) });
    }
  }
  for (const t of tapesRead.tapes) {
    const id = tapes.some((q) => q.id === t.id) ? `${t.id}-words` : t.id;
    if (t.kind === "side") tapes.push({ id, said: t.said, feet: round4(t.feet), what: t.what, kind: "side", side: null });
    else tapes.push({ id, said: t.said, feet: round4(t.feet), what: t.what, kind: "line", count: t.count, on: [], ...(t.alsoFeet ? { alsoFeet: t.alsoFeet.map(round4) } : {}) });
  }
  // Sizes judged by eye at the house ("about 6'"): each a side, checked against the measure (or held loosely) - never a tape.
  const estimates = (tapesRead.estimates ?? []).map((e) => ({ id: e.id, said: e.said, feet: round4(e.feet), plusMinusPct: e.plusMinusPct, side: null, use: "check" }));
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
    ...(estimates.length ? { estimates } : {}),
    ...(tapesRead.unread.length ? { unread: tapesRead.unread } : {}),
    ...walkDraft(h),
    checks: [],
    leaveOut: [...tapeShots].sort((a, b) => a - b),
    keepProposed: false,
    dropProposed: [],
  };
}

/** The corners said in order in [text] ("corner 1 outside", "corner 4 inside" a line) as turns O / I / J; null with fewer than four, or one missing. */
function turnsIn(text) {
  const turns = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = /^\s*corner\s+(\d+)\s+(outside|inside|joins|joined)\b/i.exec(line);
    if (m) turns[Number(m[1]) - 1] = m[2].toLowerCase().startsWith("o") ? "O" : m[2].toLowerCase().startsWith("i") ? "I" : "J";
  }
  return turns.length < 4 || turns.some((t) => !t) ? null : turns;
}

/**
 * The walk's corners in words and where they were said: corners.txt beside the photos (2026-10-23, the test-house repo's
 * layout: the walk's corners kept apart from what each photo is), else walk.txt's corner lines (2026-10-22). Null: neither says them.
 */
export function walkTurnsOf(h) {
  const fromCorners = turnsIn(h.cornersText);
  if (fromCorners) return { turns: fromCorners, from: "corners.txt" };
  const fromWalk = turnsIn(h.walkText);
  return fromWalk ? { turns: fromWalk, from: "walk.txt" } : null;
}

/**
 * The walk round the house in words (`walkTurnsOf`): its corners in order as `walk.turns`, and each photo's role from its name
 * where the name says one ("02 corner 1", "07 side 2", "01 front", "far 4 back"). The shape is then the walk's, nobody's
 * guess; each role names the photo's corners. With corners.txt the photos' names are the tester's own labels, not its
 * numbering (owner-1022's "10 corner 3" was the house's back-left, C7, and its "side 3" the AC side, C7-C8): only a front or
 * a back, which no numbering changes, is taken from a name there.
 */
function walkDraft(h) {
  const said = walkTurnsOf(h);
  if (!said) return {};
  const photos = {};
  for (const p of h.photos) {
    const role = roleFromName(p.file);
    if (role && (said.from !== "corners.txt" || /^(far )?(front|back)$/.test(role))) photos[p.n] = role;
  }
  return { walk: { turns: said.turns.join(" "), photos } };
}

/** A photo's role from its file name, when it plainly says one: "far 4 back" -> "far back", "13 corner 4" -> "corner 4". */
export function roleFromName(file) {
  const name = file.replace(/\.[a-z]+$/i, "").toLowerCase();
  const far = /^far\b/.test(name) ? "far " : "";
  const m = /(?:^|\s)(corner|side)\s+(\d+)(?=$|[\s-])/.exec(name);
  if (m) return `${far}${m[1]} ${Number(m[2])}`;
  const w = /(?:^|\s)(front|back)(?=$|\s)/.exec(name);
  return w ? `${far}${w[1]}` : null;
}

const round1 = (v) => Math.round(v * 10) / 10;
const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * inputs.json as the photo route's input, and what is wrong or missing with it, in plain words. [candidates]: each
 * photo's lettered upright edges from prepare (a corner may be given as one of them).
 */
export function routeInput(h, inputs, candidates = {}, x = null) {
  const problems = [];
  let outline = (inputs.shape?.outline ?? []).map((p) => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x), y: Number(p.y) }));
  // The walk round the house in words (inputs.walk, 2026-10-22): with no shape drawn its corners make it; drawn, they must fit it.
  const walk = walkOf(x, inputs, outline, problems);
  if (walk?.lap) outline = walk.lap;
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
    // Put on the edge from a close-up (an edge, or said exact), or picked from an exact candidate: taken as placed, not
    // snapped onto a rib beside it.
    const picked = pickedEdge(c, candidates[p.n]);
    const exact = c.exact === true || Array.isArray(c.edge) || !!picked;
    const top = Array.isArray(c.edge) ? (c.edge[0][1] < c.edge[1][1] ? c.edge[0] : c.edge[1]).map(Number) : picked ? picked.top : null;
    corners.push({ photo: p.id, corner, x: at[0], y: at[1], ...(by ? { by } : {}), ...(c.party ? { party: true } : {}), ...(exact ? { exact: true } : {}), ...(top ? { top } : {}), ...(Number(c.aboveGroundFeet) > 0 ? { aboveGround: Number(c.aboveGroundFeet) } : {}), ...(typeof c.behind === "string" && c.behind.trim() ? { behind: c.behind.trim() } : c.behind === true ? { behind: "something in front of the wall" } : {}) });
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
  // Sizes estimated on site, by eye: "estimates": [{"id": "e1", "said": "...", "feet": 6, "plusMinusPct": 20, "side": "C8-C9", "use": "check"}].
  // "use": "check" (the default) only compares the measure with it; "hold" holds the side to it loosely.
  const estimates = [];
  for (const e of inputs.estimates ?? []) {
    if (e.skip) continue;
    if (!(Number(e.feet) > 0)) {
      problems.push(`estimate ${e.id} (${e.said ?? ""}): no length.`);
      continue;
    }
    if (e.use !== undefined && e.use !== "check" && e.use !== "hold") {
      problems.push(`estimate ${e.id} (${e.said}): "use" is "check" (compare with the measure, the default) or "hold" (hold the side to it loosely), not "${e.use}".`);
      continue;
    }
    const from = sideIndex(e.side, n);
    if (from === null) problems.push(`estimate ${e.id} (${e.said}): which side? Set "side" to the wall it is the length of, corner to corner, e.g. "C8-C9".`);
    else if (tapes.some((t) => t.kind === "side" && t.from === from)) problems.push(`estimate ${e.id} (${e.said}): ${sideName(from, n)} is taped; the tape stands and the estimate is not used.`);
    else estimates.push({ id: String(e.id), from, feet: Number(e.feet), plusMinusPct: Number(e.plusMinusPct) > 0 ? Number(e.plusMinusPct) : 20, use: e.use === "hold" ? "hold" : "check" });
  }
  // Where the user stood for a photo the measure couldn't place for sure ("standAt": {"3": [x, y]}, feet on the shape as drawn).
  const standAt = {};
  for (const [ref, at] of Object.entries(inputs.standAt ?? {})) {
    const p = photoOf(h, ref);
    if (!p) problems.push(`standAt: no photo ${ref}.`);
    else if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => Number.isFinite(Number(v)))) problems.push(`standAt ${ref}: two numbers [x, y], feet on the shape as drawn.`);
    else standAt[p.id] = [Number(at[0]), Number(at[1])];
  }
  // Which way each photo looked: from the walk's step it was taken at (a pulled request), or said in inputs.json
  // ("facing": {"3": "NE"} or {"3": [x, y]}, the plan's x east, y north). It settles a two-corner photo's quarter-turn.
  const facing = walkFacing(h);
  for (const [ref, said] of Object.entries(inputs.facing ?? {})) {
    const p = photoOf(h, ref);
    const v = facingWords(said);
    if (!p) problems.push(`facing: no photo ${ref}.`);
    else if (!v) problems.push(`facing ${ref}: N, NE, E, SE, S, SW, W or NW (the way the camera looked), or [x, y].`);
    else facing[p.id] = v;
  }
  const shared = (inputs.house?.shared ?? []).map((s) => sideIndex(s, n)).filter((i) => i !== null);
  const homeType = inputs.house?.homeType && inputs.house.homeType !== "detached" ? inputs.house.homeType : undefined;
  const map = mapOf(h, inputs, problems);
  const roofOver = map ? roofOverOf(h, n) : null;
  const input = {
    photos: h.photos.map((p) => ({ id: p.id, width: p.width, height: p.height, focalPrior: p.focalPrior ?? null, takenAt: p.takenAt ?? null, ...(standAt[p.id] ? { standAt: standAt[p.id] } : {}), ...(facing[p.id] ? { facing: facing[p.id] } : {}), ...(walk?.roles[p.n] ?? {}) })),
    buildings: [{ id: "main", ...(inputs.house?.name ? { name: inputs.house.name } : {}), ...(homeType ? { homeType } : {}), ...(shared.length ? { shared } : {}), outline, corners, tapes, ...(estimates.length ? { estimates } : {}), ...(walk?.lap ? { outlineFrom: "walk" } : {}), ...(map ? { map } : {}), ...(roofOver ? { roofOver } : {}) }],
  };
  return { input, problems, tapeParts, n };
}

/**
 * What the roof covers past the walls, from the roof answers (scrivn/roof.json, as `report` takes them), for a map outline
 * (lib/photoRouteMap.ts MapRoofOver): the overhangs, the gable ends ("ends"), the notches said "covered" and the porches
 * ("additions" of kind "porch", with their depth). Null with no roof answers.
 */
function roofOverOf(h, n) {
  if (!h.roofText) return null;
  let r;
  try {
    r = JSON.parse(String(h.roofText).replace(/^﻿/, ""));
  } catch {
    return null;
  }
  const sides = (keys) => keys.map((k) => sideIndex(k, n)).filter((i) => i !== null);
  const over = {};
  if (Number.isFinite(r.overhangs?.eave)) over.eaveFeet = r.overhangs.eave;
  if (Number.isFinite(r.overhangs?.rake)) over.rakeFeet = r.overhangs.rake;
  const gables = sides(Object.entries(r.ends ?? {}).filter(([, v]) => v === "gable").map(([k]) => k));
  if (gables.length) over.gableSides = gables;
  const notches = sides(Object.entries(r.notches ?? {}).filter(([, v]) => v === "covered").map(([k]) => k));
  if (notches.length) over.coveredNotches = notches;
  const porches = (r.additions ?? []).filter((a) => a?.kind === "porch").map((a) => ({ side: sideIndex(a.side, n), ...(Number(a.depthFeet) > 0 ? { depthFeet: Number(a.depthFeet) } : {}) })).filter((p) => p.side !== null);
  if (porches.length) over.porches = porches;
  return over;
}

/**
 * The map outline the measure lays on the house (lib/photoRouteMap.ts): inputs.json "map" as {"corners": [[x, y], ...]}
 * (feet, x east, y north), else map.txt beside the photos; "map": false measures from the photos alone.
 */
function mapOf(h, inputs, problems) {
  if (inputs.map === false) return null;
  if (inputs.map && typeof inputs.map === "object") {
    const corners = (inputs.map.corners ?? []).map((p) => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x), y: Number(p.y) }));
    if (corners.length < 3 || corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      problems.push(`map.corners: the outline's corners in order round it, [x, y] each in feet (x east, y north), three at least - or "map": false.`);
      return null;
    }
    return { corners, source: inputs.map.source ?? "a map outline", ...(Number(inputs.map.sdFeet) > 0 ? { sdFeet: Number(inputs.map.sdFeet) } : {}) };
  }
  const { map, problem } = parseMap(h.mapText ?? "");
  if (problem) problems.push(problem);
  return map;
}

/**
 * inputs.walk read with Scrivn's walk code ([x], the runner's bundle): the turns as a walk, the lap's shape when no shape is
 * drawn (shape.from "placeholder" or "walk"), the shift putting the walk's corner k at the drawn shape's corner, and each
 * photo's role as its shot and walk tag (lib/photoRouteWalk.ts roleShot). Problems are said into [problems].
 */
function walkOf(x, inputs, outline, problems) {
  if (!x || !inputs.walk?.turns) return null;
  const turns = x.parseTurns(inputs.walk.turns);
  if (!turns) {
    problems.push(`walk.turns: each corner O (outside), I (inside) or J (joins the neighbour), in order from corner 1 - not "${inputs.walk.turns}".`);
    return null;
  }
  const walk = x.walkFromTurns(turns);
  const t = x.lapTurns(walk);
  const drawn = outline.length >= 4 && !["placeholder", "walk"].includes(inputs.shape?.from);
  let lap = null;
  let shift = 0;
  if (!drawn) {
    lap = x.lapOutline(t);
    if (!lap) {
      problems.push(`walk.turns: ${turns.length} corners that don't close a lap round a house (four more outside than inside).`);
      return null;
    }
  } else {
    shift = x.alignLap(t, outline);
    if (shift === null) {
      problems.push("walk.turns don't fit the shape drawn: its corners, outside and inside, in order from the front's right-hand one, should be the walk's. Fix one, or set shape.from to \"walk\" to take the walk's.");
      return null;
    }
  }
  const roles = {};
  for (const [ref, said] of Object.entries(inputs.walk.photos ?? {})) {
    // Every role as a far one: it says which corner is in the photo, and its taps are named by fitting, for the review to confirm.
    const r = x.roleShot(String(said), walk, shift, { farAlways: true });
    if (!r) problems.push(`walk.photos ${ref}: "${said}" is no role on this walk ("corner 3", "side 2", "front", "back", "far corner 1").`);
    else roles[Number(ref)] = { shot: r.shot, ...(r.tag ? { walk: r.tag } : {}) };
  }
  return { lap, shift, roles };
}

const COMPASS = { N: [0, 1], NE: [1, 1], E: [1, 0], SE: [1, -1], S: [0, -1], SW: [-1, -1], W: [-1, 0], NW: [-1, 1] };

/** A way the camera looked, said as a compass point or [x, y]: a unit vector on the plan, or null. */
function facingWords(said) {
  const v = Array.isArray(said) ? said.map(Number) : COMPASS[String(said).trim().toUpperCase()];
  if (!v || v.length !== 2 || !v.every(Number.isFinite)) return null;
  const L = Math.hypot(v[0], v[1]);
  return L > 0 ? [v[0] / L, v[1] / L] : null;
}

/**
 * Which way each photo of a pulled request looked, from the step of the walk it was taken at (its shot on the walk's own
 * lap-made shape: a wall straight on looks against its outward face, a corner's 45 in across the corner). The session's
 * shape may have more corners than the lap's, but north is north on both. Photo id -> unit vector.
 */
export function walkFacing(h) {
  const route = h.request?.route;
  const lap = route?.buildings?.find((b) => b.id === h.request?.request?.building)?.outline ?? route?.buildings?.[0]?.outline;
  const out = {};
  if (!lap || lap.length < 3) return out;
  const n = lap.length;
  const nrm = (i) => {
    const a = lap[((i % n) + n) % n];
    const b = lap[(((i + 1) % n) + n) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return [(b.y - a.y) / L, -(b.x - a.x) / L];
  };
  for (const p of route.photos ?? []) {
    if (!p.shot) continue;
    let d;
    if (p.shot.kind === "wall") d = nrm(p.shot.index).map((v) => -v);
    else {
      const a = nrm(p.shot.index - 1);
      const b = nrm(p.shot.index);
      d = [-(a[0] + b[0]), -(a[1] + b[1])];
    }
    const L = Math.hypot(d[0], d[1]);
    if (L > 1e-9) out[p.id] = [d[0] / L, d[1] / L];
  }
  return out;
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

/**
 * The candidate a corner was picked from, when that candidate is an exact edge (prepare's corner edges, 2026-10-21): its
 * top, the corner then read along it. Null for a corner given otherwise, or picked from an older candidates.json.
 */
export function pickedEdge(c, cands = []) {
  if (!c.pick || Array.isArray(c.edge) || (Number.isFinite(c.x) && Number.isFinite(c.y))) return null;
  const cand = cands.find((q) => q.pick === String(c.pick).toLowerCase());
  return cand?.exact && Array.isArray(cand.top) ? { top: cand.top.map(Number) } : null;
}

/** Of two points along an upright edge, the one lower in the photo: where it meets the ground. */
export const lowerEnd = (edge) => (edge[0][1] >= edge[1][1] ? edge[0] : edge[1]).map(Number);

/** A two-digit name for a photo's files: 03 for photo 3. */
export const nn = (n) => p2(n);
