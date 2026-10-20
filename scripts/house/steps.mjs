/**
 * The house runner's steps (scripts/house/run.mjs; the checklist is docs/house-runner.md). Each takes the folder
 * (folder.mjs `openHouse`), writes what it made into <folder>/scrivn/, and returns its lines for the console. All of it
 * is Scrivn's own code (code.mjs) on this machine: no API, nothing sent anywhere.
 *
 *   prepare  every photo levelled and the lens estimated; each photo's corner candidates (its long upright edges reaching
 *            low, lettered); a review sheet per photo and a contact sheet; a draft inputs.json.
 *   check    inputs.json read as the route would: the corners numbered by Scrivn, each photo placed on the shape (or why
 *            not), the tapes; what is missing, plainly; the sheets drawn again with the numbers.
 *   measure  the route's measure; the outline with ± per side, the advice, each side squared for reading, the plan, the
 *            accuracy table (each tape held out in turn), results.md.
 *   report   the walls read off the squared sides (reads.json) and the roof check's answers (roof.json) put on, the roof
 *            check and Check these said, the customer report PDF, exterior.json.
 */
import sharp from "sharp";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { scrivn } from "./code.mjs";
import { cornerAt, draftInputs, ensureDir, loadPixels, nn, photoOf, readJson, routeInput, statePath, writeJson } from "./folder.mjs";
import { contactSheet, griddedSide, measuredPlanPng, photoSheet, tapStrip, zoomPng } from "./sheets.mjs";
import { cornerIndex, cornerName, ftin, sideIndex, sideName } from "./words.mjs";

const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const hhmmss = (ms) => (ms ? new Date(ms).toTimeString().slice(0, 8) : "?");

/** Each step's machine time, kept beside the results. */
function timed(h, step, t0) {
  const file = statePath(h, "times.json");
  const times = readJson(file, {});
  times[step] = { seconds: Math.round((Date.now() - t0) / 100) / 10, at: new Date().toISOString() };
  writeJson(file, times);
  return times[step].seconds;
}

// ── Corner candidates ────────────────────────────────────────────────────────────────────────────

/**
 * A photo's corner candidates: its upright edges (lib/photoRouteEdges.ts, as the route finds them) that are long and
 * reach below the horizon - a corner meets the ground below eye level - the longest eight, one per stretch of the photo,
 * lettered left to right. A guess list for the session, never taken as a corner by itself.
 */
function candidatesOf(x, cam, edges) {
  if (!cam) return [];
  const below = cam.height / 2 + 0.02 * cam.f;
  const long = edges.filter((e) => e.vBottom > below && e.length >= 0.1 * cam.height).sort((a, b) => b.length - a.length);
  const kept = [];
  for (const e of long) {
    if (kept.some((k) => Math.abs(k.u - e.u) < 0.025 * cam.width)) continue;
    kept.push(e);
    if (kept.length === 8) break;
  }
  kept.sort((a, b) => a.u - b.u);
  return kept.flatMap((e, i) => {
    const foot = x.fromLevel(cam, e.u, e.vBottom);
    const top = x.fromLevel(cam, e.u, e.vTop);
    return foot ? [{ pick: "abcdefgh"[i], x: Math.round(foot[0] * 10) / 10, y: Math.round(foot[1] * 10) / 10, top: top ? top.map((v) => Math.round(v)) : null, lengthPx: Math.round(e.length) }] : [];
  });
}

/** The photos levelled for the sheets: with the route's own regions once corners are tapped, else every edge in them. */
function levelFor(x, input, pixels, lines) {
  const tapped = new Set(input.buildings[0].corners.map((c) => c.photo));
  if (tapped.size >= 2) return x.preparePhotos(input, pixels, lines);
  const level = x.levelPhotos(
    pixels.map((p, i) => ({ width: p.width, height: p.height, segments: lines[i].segments, focalPrior: input.photos[i].focalPrior ?? null, regions: null })),
    { k: x.DEFAULT_RADIAL_K },
  );
  const data = pixels.map((p, i) => {
    const cam = level.cameras[i] ?? null;
    return { id: p.id, camera: cam, gray: lines[i].gray, edges: cam ? x.uprightEdges(lines[i].gray, cam, lines[i].segments) : [] };
  });
  return { data, level };
}

// ── The marks on a photo ─────────────────────────────────────────────────────────────────────────

/** What a photo's sheet shows: its candidates, its corners (numbered as given or as Scrivn numbered them), its tapes and checks. */
function marksFor(h, inputs, p, { candidates = {}, numbered = null, proposals = [], withCandidates = true } = {}) {
  const n = inputs.shape?.outline?.length ?? 0;
  const own = (inputs.corners ?? []).filter((c) => photoOf(h, c.photo)?.n === p.n);
  const taps = [];
  for (const c of own) {
    const xy = cornerAt(c, candidates[p.n]);
    if (!xy) continue;
    const given = c.corner === undefined || c.corner === null ? -1 : (cornerIndex(c.corner, n) ?? -1);
    const app = numbered?.find((q) => q.photo === p.id && Math.abs(q.x - xy[0]) < 1e-6 && Math.abs(q.y - xy[1]) < 1e-6);
    taps.push({ x: xy[0], y: xy[1], corner: given >= 0 ? given : (app?.corner ?? -1), named: given >= 0 && !c.kept });
  }
  for (const q of proposals.filter((q) => q.photo === p.id)) taps.push({ x: q.x, y: q.y, corner: q.corner, proposed: true });
  const tapes = (inputs.tapes ?? []).flatMap((t) => (t.on ?? []).filter((o) => photoOf(h, o.photo)?.n === p.n && o.a && o.b).map((o) => ({ a: o.a, b: o.b, text: `${t.id} ${ftin(Number(t.feet))}` })));
  const checks = (inputs.checks ?? []).filter((k) => photoOf(h, k.photo)?.n === p.n && k.a && k.b).map((k) => ({ a: k.a, b: k.b, text: `${k.what ?? "check"}${k.feet ? ` ${ftin(Number(k.feet))}?` : ""}` }));
  return { candidates: withCandidates ? (candidates[p.n] ?? []) : [], taps, tapes, checks };
}

/** Where a placed photo stood and what it saw, for the plan beside it. */
function cameraOnPlan(x, rc, cam, here) {
  const yaw = (rc.yawTweakDeg * Math.PI) / 180;
  const edge = (u) => x.planDirection(x.columnBearing(cam, u), rc.quadrant, yaw);
  return { at: rc.at, view: [edge(0), edge(cam.width)], here, label: here ? "here" : null };
}

async function writeSheets(h, x, inputs, pixels, { candidates, numbered = null, proposals = [], solution = null, data = null, dir = "sheets", outline = null, notesOf = () => [] }) {
  const out = ensureDir(statePath(h, dir));
  for (const f of readdirSync(out)) if (f.endsWith(".png")) rmSync(join(out, f));
  const ring = outline ?? (inputs.shape?.outline ?? []).map(([px, py]) => ({ x: px, y: py }));
  const shared = (inputs.house?.shared ?? []).map((s) => sideIndex(s, ring.length)).filter((i) => i !== null);
  const items = [];
  for (const [i, p] of h.photos.entries()) {
    const marks = marksFor(h, inputs, p, { candidates, numbered, proposals, withCandidates: !solution });
    const seen = marks.taps.filter((t) => t.corner >= 0 && !t.proposed).map((t) => t.corner);
    const rc = solution?.cameras.find((c) => c.photo === p.id);
    const cam = data?.find((d) => d.id === p.id)?.camera;
    const cameras = rc && cam ? [cameraOnPlan(x, rc, cam, true)] : [];
    const title = `#${p.n}  ${p.file}  ${p.width}x${p.height}  taken ${hhmmss(p.takenAt)}${rc ? `  · placed by ${rc.placedBy}` : solution ? "  · not placed" : ""}`;
    const png = await photoSheet(pixels[i], { title, marks, outline: ring, seen, cameras, notes: notesOf(p), shared });
    writeFileSync(join(out, `${nn(p.n)}.png`), png);
    items.push({ n: p.n, px: pixels[i], marks: { ...marks, candidates: [] }, caption: `${p.file} · ${marks.taps.filter((t) => !t.proposed).length} corners` });
  }
  writeFileSync(statePath(h, dir === "sheets" ? "contact.png" : `${dir}-contact.png`), await contactSheet(items, ring));
  return out;
}

// ── prepare ──────────────────────────────────────────────────────────────────────────────────────

export async function prepare(h, { fresh = false } = {}) {
  const t0 = Date.now();
  ensureDir(h.state);
  const x = await scrivn();
  const pixels = await loadPixels(h, x);
  writeJson(statePath(h, "photos.json"), { about: "The photos in walk order: n is the number on the sheets.", photos: h.photos });
  const inputsFile = statePath(h, "inputs.json");
  const kept = existsSync(inputsFile) && !fresh;
  const inputs = kept ? readJson(inputsFile) : draftInputs(h);
  if (!kept) writeJson(inputsFile, inputs);
  const lines = pixels.map(x.photoLines);
  const { input } = routeInput(h, inputs);
  const { data, level } = levelFor(x, input, pixels, lines);
  const candFile = statePath(h, "candidates.json");
  let candidates = !fresh && existsSync(candFile) ? readJson(candFile).photos : null;
  if (!candidates) {
    candidates = Object.fromEntries(h.photos.map((p, i) => [p.n, candidatesOf(x, data[i].camera, data[i].edges)]));
    writeJson(candFile, { about: "Each photo's corner candidates: its long upright edges reaching below the horizon, lettered left to right. x, y is the foot of the edge, in the photo's pixels. A corner may be given as one: {\"photo\": n, \"pick\": \"c\"}.", photos: candidates });
  }
  const notesOf = (p) => {
    const i = h.photos.indexOf(p);
    const why = level.notes[i];
    return why ? [`Not levelled: ${why} It can still carry a tape's photo, not a corner.`] : [];
  };
  await writeSheets(h, x, inputs, pixels, { candidates, notesOf });
  const levelled = level.cameras.filter(Boolean).length;
  const out = [
    `${h.kind === "request" ? "Pulled request" : "Folder"} ${h.dir}: ${h.photos.length} photos.`,
    `Lens: f/W ${level.focalOverWidth.toFixed(4)} (an S25 Ultra's 1x is 0.664), k ${level.k.toFixed(3)}; ${levelled} of ${h.photos.length} photos levelled.`,
    ...h.photos.flatMap((p, i) => (level.notes[i] ? [`  #${p.n} ${p.file}: ${level.notes[i]}`] : [])),
    `Corner candidates: ${Object.values(candidates).reduce((s, c) => s + c.length, 0)} on ${Object.values(candidates).filter((c) => c.length).length} photos (orange, lettered).`,
    kept ? `Kept inputs.json as it is (prepare --fresh starts it again).` : `Draft inputs.json: shape ${inputs.shape.from === "tester" ? "the tester's" : "a placeholder 40' x 30' rectangle - draw the real one"}; ${inputs.corners.length} corners${inputs.corners.length ? " (the tester's)" : ""}; ${inputs.tapes.length} tapes.`,
    ...inputs.tapes.map((t) => `  ${t.id}: "${t.said}" -> ${ftin(Number(t.feet))}, ${t.kind === "side" ? `a wall's length (${t.side ? `on ${t.side}` : "set its side"})` : `a line on a photo across ${t.count > 1 ? `each of ${t.count}` : "it"} (${t.on?.length ? `on ${t.on.map((o) => `#${o.photo}`).join(", ")}` : "place its ends"})`}`),
    ...(inputs.unread ?? []).map((u) => `  not read as a tape (no length in it): "${u}"`),
    !h.tapesText && h.kind === "folder" ? "No tapes.txt: put one beside the photos, a tape a line (\"garage door 9'\"), and run prepare --fresh." : "",
    `Sheets: ${relative(h.dir, statePath(h, "sheets"))}/NN.png, contact sheet: ${relative(h.dir, statePath(h, "contact.png"))}.`,
    `Next: look at the sheets, then fill in ${relative(h.dir, inputsFile)} (docs/house-runner.md, step 2) and run check.`,
  ].filter(Boolean);
  out.push(`Machine time: ${timed(h, "prepare", t0)} s.`);
  return out;
}

// ── check ────────────────────────────────────────────────────────────────────────────────────────

/** Placed photos best facing side [i] of [ring] (the photos most square to it first), from a solve's cameras. */
function facing(ring, i, cameras) {
  const n = ring.length;
  const A = ring[i];
  const B = ring[(i + 1) % n];
  const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const nrm = { x: (B.y - A.y) / L, y: -(B.x - A.x) / L };
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  return cameras
    .map((c) => {
      const v = { x: c.at[0] - mid.x, y: c.at[1] - mid.y };
      return { photo: c.photo, f: (v.x * nrm.x + v.y * nrm.y) / (Math.hypot(v.x, v.y) || 1) };
    })
    .filter((q) => q.f > 0.3)
    .sort((a, b) => b.f - a.f);
}

export async function check(h) {
  const t0 = Date.now();
  const x = await scrivn();
  const inputs = readJson(statePath(h, "inputs.json"));
  const candidates = readJson(statePath(h, "candidates.json"), { photos: {} }).photos;
  const { input, problems, n } = routeInput(h, inputs, candidates);
  const out = [];
  const shapeBad = problems.filter((p) => p.startsWith("shape") || / is not square /.test(p));
  if (shapeBad.length) return [...shapeBad.map((p) => `✗ ${p}`), "Fix the shape first; nothing else can be checked on it."];
  if (inputs.shape?.from === "placeholder") out.push("✗ The shape is still the placeholder rectangle: draw the house's own (shape.outline), then set shape.from to \"session\".");
  const pixels = await loadPixels(h, x);
  const lines = pixels.map(x.photoLines);
  const prepared = x.preparePhotos(input, pixels, lines);
  const b = input.buildings[0];
  const numbered = x.numberCorners(input, "main", prepared.data);
  const withNumbers = { ...input, buildings: [{ ...b, corners: numbered }] };
  // The corners alone (no wall edges): quick, and enough to say which photos the shape places.
  const quick = x.solveRoute(withNumbers, "main", prepared.data, { wallEdges: false });
  const placed = new Set(quick.cameras.map((c) => c.photo));
  out.push(`Shape: ${n} corners, ${(inputs.shape.outline ?? []).map((p) => `(${p.join(", ")})`).join(" ")}.`);
  out.push(`Corners: ${numbered.length} taps on ${new Set(numbered.map((c) => c.photo)).size} photos; ${quick.cameras.length} photos placed on the shape.`);
  for (const p of h.photos) {
    const mine = numbered.filter((c) => c.photo === p.id);
    if (mine.length === 0) continue;
    const named = (inputs.corners ?? []).filter((c) => photoOf(h, c.photo)?.n === p.n && c.corner != null).length;
    const nums = [...mine].sort((a, c) => a.x - c.x).map((c) => (c.corner >= 0 ? cornerName(c.corner) : "?")).join(" ");
    const dup = mine.filter((c) => c.corner >= 0).map((c) => c.corner).filter((k, i, all) => all.indexOf(k) !== i);
    const why = quick.unplaced.find((u) => u.photo === p.id)?.why;
    const words = [`  #${String(p.n).padStart(2)} ${nums.padEnd(18)} ${named ? `${named} named` : "none named"}`];
    if (placed.has(p.id)) words.push("placed");
    else if (mine.length === 1) words.push("one corner: placed later off its wall edges, or not at all");
    else words.push(`NOT placed: ${why ?? "?"}`);
    if (mine.length >= 2 && !named) words.push("- name one of its corners (corner: \"C#\"), Scrivn numbers the rest from it");
    if (mine.some((c) => c.corner < 0) && mine.length > 1) words.push("- some taps got no number: name them");
    if (dup.length) words.push(`- ${dup.map(cornerName).join(", ")} twice on one photo`);
    out.push(words.join(" "));
  }
  if (numbered.length && quick.cameras.length < 2) out.push("✗ Fewer than two photos placed: the measure needs two at least, each with two corners or more.");
  // The tapes: what each still needs, and for a line not yet placed, the photos that face its wall.
  const ring = quick.corners;
  for (const t of inputs.tapes ?? []) {
    if (t.skip) {
      out.push(`  tape ${t.id} "${t.said}": skipped`);
      continue;
    }
    if (t.kind === "side") {
      const i = sideIndex(t.side, n);
      out.push(i === null ? `✗ tape ${t.id} "${t.said}": set "side" to the wall it runs along, e.g. "C5-C6".` : `  tape ${t.id} "${t.said}": ${sideName(i, n)}, ${ftin(Number(t.feet))} (the shape drew it ${ftin(Math.hypot(inputs.shape.outline[(i + 1) % n][0] - inputs.shape.outline[i][0], inputs.shape.outline[(i + 1) % n][1] - inputs.shape.outline[i][1]))})`);
      continue;
    }
    const on = (t.on ?? []).filter((o) => o?.a && o?.b);
    // Its wall, said or (a garage) the front: the photos facing it best.
    const walls = t.side ? [sideIndex(t.side, n)].filter((i) => i !== null) : t.what === "garage" || t.what === "door" ? ring.map((_, i) => i).filter((i) => ring[(i + 1) % n].x - ring[i].x > 0.5 && Math.abs(ring[(i + 1) % n].y - ring[i].y) < 0.5 && Math.min(ring[i].y, ring[(i + 1) % n].y) <= Math.min(...ring.map((q) => q.y)) + 8) : [];
    const best = [...new Map(walls.flatMap((i) => facing(ring, i, quick.cameras)).sort((a, c) => c.f - a.f).map((q) => [q.photo, q])).values()].slice(0, 5).map((q) => `#${photoOf(h, q.photo).n}`);
    if (on.length === 0) out.push(`✗ tape ${t.id} "${t.said}": not placed yet. Drag it on a photo: "on": [{"photo": n, "a": [x, y], "b": [x, y]}].${best.length ? ` Photos facing ${t.side ? t.side : "the front"}: ${best.join(", ")}.` : " Look on the contact sheet for the photos that show it square-on."}`);
    else {
      const unplacedOn = on.filter((o) => !placed.has(photoOf(h, o.photo)?.id));
      out.push(`  tape ${t.id} "${t.said}": on ${on.map((o) => `#${o.photo}`).join(", ")}${unplacedOn.length ? ` - photo ${unplacedOn.map((o) => `#${o.photo}`).join(", ")} is not placed, so the tape there counts for nothing` : ""}`);
    }
  }
  const scaled = b.tapes.length > 0;
  if (!scaled) out.push("✗ No tape is in yet: without one the sizes are the shape's as drawn, not to scale.");
  for (const p of problems.filter((q) => !q.startsWith("tape"))) out.push(`✗ ${p}`);
  for (const k of inputs.checks ?? []) if (!photoOf(h, k.photo) || !k.a || !k.b) out.push(`✗ check "${k.what ?? ""}": needs photo, a and b.`);
  await writeSheets(h, x, inputs, pixels, { candidates, numbered });
  // Each photo's corners close up, with where the snap puts them: the corners' places at a glance.
  const tapsDir = ensureDir(statePath(h, "taps"));
  for (const f of readdirSync(tapsDir)) if (f.endsWith(".png")) rmSync(join(tapsDir, f));
  for (const [i, p] of h.photos.entries()) {
    const d = prepared.data[i];
    const mine = numbered.filter((c) => c.photo === p.id).sort((a, c) => a.x - c.x);
    if (!mine.length || !d.camera) continue;
    const given = (c) => (inputs.corners ?? []).some((q) => photoOf(h, q.photo)?.n === p.n && q.corner != null && cornerIndex(q.corner, n) === c.corner);
    const taps = mine.map((c) => {
      const s = x.snapToEdge(d.gray, d.camera, c.x, c.y);
      return { x: c.x, y: c.y, corner: c.corner, named: given(c), snapped: s.onEdge ? [s.x, s.y] : null, words: `${c.corner >= 0 ? cornerName(c.corner) : "?"} ${s.onEdge ? `snaps ${s.x - c.x >= 0 ? "+" : ""}${(s.x - c.x).toFixed(1)} px` : "no edge: as tapped"}` };
    });
    writeFileSync(join(tapsDir, `${nn(p.n)}.png`), await tapStrip(pixels[i], taps, `#${p.n} ${p.file}: each corner close up - red where tapped, green where it snaps`));
  }
  const ready = !out.some((l) => l.startsWith("✗"));
  out.push(ready ? "Ready to measure. Look at the sheets first: each C-number where Scrivn put it (cyan), each tape on its jambs." : "Fix what is marked ✗, then check again (the sheets are drawn with Scrivn's numbers: cyan = numbered by Scrivn, green = named by you, red = no number).");
  writeFileSync(statePath(h, "check.txt"), `${out.join("\n")}\n`);
  out.push(`Machine time: ${timed(h, "check", t0)} s.`);
  return out;
}

// ── A line on a photo, measured ──────────────────────────────────────────────────────────────────

/**
 * How long the line a-b on photo [photoId] is, in feet, on the solved house: each end's column cast from where the
 * photo was placed onto the wall its ray meets first, its height from its row and the distance (a level camera). With
 * [snap], each end moved onto the upright edge nearest it first, as a tape's ends are in the solve. Null when the photo
 * was not placed, or an end's ray meets no wall.
 */
export function lineOnPhoto(x, sol, data, photoId, a, b, { snap = false } = {}) {
  const d = data.find((q) => q.id === photoId);
  const rc = sol.cameras.find((c) => c.photo === photoId);
  const cam = d?.camera;
  if (!rc || !cam) return null;
  const yaw = (rc.yawTweakDeg * Math.PI) / 180;
  const { zl } = x.levelAxes(cam);
  const zg = x.planDirection(Math.atan2(zl[0], zl[2]), rc.quadrant, yaw);
  const ends = [a, b].map(([px, py]) => {
    const [u0, v] = x.toLevel(cam, px, py);
    const u = snap ? x.snapToEdge(d.gray, cam, px, py, { above: 60, below: 60 }).u : u0;
    const dir = x.planDirection(x.columnBearing(cam, u), rc.quadrant, yaw);
    const hit = x.routeSteps.castRay({ x: rc.at[0], y: rc.at[1] }, dir, sol.corners);
    if (!hit) return null;
    const P = [rc.at[0] + dir[0] * hit.t, rc.at[1] + dir[1] * hit.t];
    const depth = (P[0] - rc.at[0]) * zg[0] + (P[1] - rc.at[1]) * zg[1];
    return { P, z: -((v - cam.height / 2) / cam.f) * depth, side: hit.side };
  });
  if (!ends[0] || !ends[1]) return null;
  const [e, f] = ends;
  return { feet: Math.hypot(f.P[0] - e.P[0], f.P[1] - e.P[1], f.z - e.z), across: Math.hypot(f.P[0] - e.P[0], f.P[1] - e.P[1]), up: Math.abs(f.z - e.z), sides: [e.side, f.side] };
}

// ── measure ──────────────────────────────────────────────────────────────────────────────────────

/** The proposed corners the session set aside: "14:C9" is C9 on photo 14. */
function dropped(h, inputs, q) {
  const p = h.photos.find((ph) => ph.id === q.photo);
  return (inputs.dropProposed ?? []).some((s) => {
    const m = /^#?(\d+)\s*:\s*(C?\d+)$/i.exec(String(s).trim());
    return m && Number(m[1]) === p?.n && cornerIndex(m[2]) === q.corner;
  });
}

/**
 * Each tape held out in turn: the house solved from the others, and the tape's length predicted from that solve - a
 * wall's from its side, a line's from its own photo's view (lineOnPhoto) - against the tape.
 */
function holdOuts(x, h, inputs, routeIn, corners, data, tapeParts, n) {
  const withCorners = { ...routeIn, buildings: [{ ...routeIn.buildings[0], corners }] };
  const rows = [];
  const live = (inputs.tapes ?? []).filter((t) => tapeParts[t.id]?.length);
  if (live.length < 2) return { rows, note: live.length === 1 ? "One tape: it is the only scale, so there is nothing to hold it out against. The checks below (door heights, if given) are a sanity check only." : "No tape: the sizes are the shape's as drawn, not to scale." };
  for (const t of live) {
    const parts = tapeParts[t.id];
    const t0 = Date.now();
    const sol = x.solveRoute(withCorners, "main", data, { withoutTapes: parts });
    const feet = Number(t.feet);
    let predicted = [];
    if (t.kind === "side") {
      const i = sideIndex(t.side, n);
      const s = sol.sides[i];
      predicted = [{ feet: s.lengthFeet, where: `${sideName(i, n)}, ±${s.plusMinusPct}%` }];
    } else {
      for (const id of parts) {
        const rt = routeIn.buildings[0].tapes.find((q) => q.id === id);
        const m = lineOnPhoto(x, sol, data, rt.photo, rt.a, rt.b, { snap: true });
        const p = h.photos.find((ph) => ph.id === rt.photo);
        predicted.push(m ? { feet: m.feet, where: `photo #${p.n}` } : { feet: null, where: `photo #${p.n} not placed without it` });
      }
    }
    const got = predicted.filter((q) => q.feet !== null);
    const mean = got.length ? got.reduce((s, q) => s + q.feet, 0) / got.length : null;
    rows.push({ id: t.id, said: t.said, taped: feet, predicted: mean, errorPct: mean !== null ? (mean / feet - 1) * 100 : null, each: predicted, from: live.filter((q) => q !== t).map((q) => q.id), seconds: (Date.now() - t0) / 1000 });
  }
  return { rows, note: null };
}

export async function measure(h) {
  const t0 = Date.now();
  const x = await scrivn();
  const inputs = readJson(statePath(h, "inputs.json"));
  const candidates = readJson(statePath(h, "candidates.json"), { photos: {} }).photos;
  const { input, problems, tapeParts, n } = routeInput(h, inputs, candidates);
  const blocking = problems.filter((p) => p.startsWith("shape") || / is not square /.test(p) || p.startsWith("corners"));
  if (blocking.length) throw new Error(`inputs.json is not ready:\n${blocking.join("\n")}\nRun check.`);
  const pixels = await loadPixels(h, x);
  const lines = pixels.map(x.photoLines);
  let m = x.measureRoute(input, "main", pixels, { lines });
  let keptMarks = [];
  // "Looks right": the corners Scrivn marked on the placed photos kept (less those set aside), and measured again.
  if (inputs.keepProposed) {
    keptMarks = m.proposals.filter((q) => !dropped(h, inputs, q));
    const again = { ...input, buildings: [{ ...input.buildings[0], corners: [...m.corners.filter((c) => !c.proposed), ...keptMarks.map((q) => ({ photo: q.photo, x: q.x, y: q.y, corner: q.corner, by: "app" }))] }] };
    m = x.measureRoute(again, "main", pixels, { lines });
  }
  const tMeasure = Date.now();
  const { prepared, solution: sol, corners, proposals } = m;
  const now = new Date().toISOString();
  const rec = x.measuredFrom(sol, prepared.data, now);
  const state = { format: x.PHOTO_ROUTE_FORMAT, photos: input.photos, buildings: [{ ...input.buildings[0], corners }], measured: null };
  let ext = x.exteriorFromRoute(undefined, state, rec);
  if (!ext) throw new Error("The corners as numbered do not make the shape drawn (a side solved to nothing): look at each photo's numbers on the sheets and run check.");
  const sideIds = ext.photoRoute.measured.sideIds;
  // The session's names for the sides, the home's type and which way its front faces.
  const names = inputs.shape?.names ?? {};
  ext = {
    ...ext,
    sides: ext.sides.map((s) => {
      const i = sideIds.indexOf(s.id);
      const named = names[sideName(i, n)];
      return named ? { ...s, name: named } : s;
    }),
    ...(Number.isFinite(inputs.house?.frontFacesDeg) ? { frontFacesDeg: inputs.house.frontFacesDeg } : {}),
  };
  writeJson(statePath(h, "measured.json"), ext);
  const nameOf = (i) => ext.sides.find((s) => s.id === sideIds[i])?.name ?? sideName(i, n);
  const fileOf = (id) => h.photos.find((p) => p.id === id);

  // Each side's photo squared up, for reading its walls: plain (what reads.json is in) and with a grid.
  const sidesDir = ensureDir(statePath(h, "sides"));
  for (const f of readdirSync(sidesDir)) if (f.endsWith(".png")) rmSync(join(sidesDir, f));
  const frames = {};
  for (let i = 0; i < n; i++) {
    const side = ext.sides.find((s) => s.id === sideIds[i]);
    if (!side?.photos?.length) continue;
    const frame = x.squareFrame(side, side.photos, 1600);
    const sources = side.photos.map((photo) => ({ photo, pixels: pixels.find((q) => q.id === photo.claimPhotoId) })).filter((q) => q.pixels);
    if (!frame || !sources.length) continue;
    const rgba = x.squareUp(sources, frame);
    const key = sideName(i, n);
    const file = `${key} ${side.name.replace(/[^A-Za-z0-9 ]/g, "")}.png`;
    const png = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer();
    writeFileSync(join(sidesDir, file), png);
    writeFileSync(join(sidesDir, file.replace(/\.png$/, " grid.png")), await griddedSide(png, frame, side.lengthFeet, x));
    frames[key] = { file, side: side.name, sideId: side.id, lengthFeet: side.lengthFeet, photos: side.photos.map((ph) => fileOf(ph.claimPhotoId)?.n), frame };
  }
  writeJson(join(sidesDir, "frames.json"), { about: "Each side's squared photo: its PNG's pixels are the frame's. reads.json is written in those pixels, keyed by the side (C1-C2); the grid copy has the same pixels, a grid every 100 px, the side's ends and ground dashed green and a foot ruler.", sides: frames });

  // The plan, and the sheets with where each photo stood and the corners Scrivn marks.
  const advice = sol.advice.map((a) => a.from);
  const shared = (inputs.house?.shared ?? []).map((s) => sideIndex(s, n)).filter((i) => i !== null);
  const camsOnPlan = sol.cameras.flatMap((rc) => {
    const cam = prepared.data.find((d) => d.id === rc.photo)?.camera;
    return cam ? [{ ...cameraOnPlan(x, rc, cam, false), label: `#${fileOf(rc.photo).n}` }] : [];
  });
  writeFileSync(statePath(h, "plan.png"), await measuredPlanPng(sol.corners, sol.sides, camsOnPlan, advice, `${inputs.house?.name ?? basename(h.dir)} - measured from ${sol.cameras.length} of ${h.photos.length} photos and ${input.buildings[0].tapes.length} tapes`, shared));
  const inputsShown = { ...inputs, corners: (inputs.corners ?? []).concat(keptMarks.map((q) => ({ photo: fileOf(q.photo).n, x: q.x, y: q.y, corner: cornerName(q.corner), kept: true }))) };
  await writeSheets(h, x, inputsShown, pixels, { candidates, numbered: corners, proposals: inputs.keepProposed ? [] : proposals, solution: sol, data: prepared.data, dir: "measured", outline: sol.corners });

  // Accuracy: each tape held out in turn; and the checks (door heights) as a sanity check, with every tape in.
  const t1 = Date.now();
  const hold = holdOuts(x, h, inputs, input, corners, prepared.data, tapeParts, n);
  const checks = (inputs.checks ?? []).flatMap((k) => {
    const p = photoOf(h, k.photo);
    if (!p || !k.a || !k.b) return [];
    const got = lineOnPhoto(x, sol, prepared.data, p.id, k.a, k.b);
    return [{ what: k.what ?? "check", photo: p.n, expect: Number(k.feet) || null, got: got?.feet ?? null }];
  });
  const tHold = Date.now();
  // Which way each tape runs: across the house (along its front) or front to back. The hold-outs check only the ways taped.
  const across = (i) => Math.abs(sol.corners[(i + 1) % n].x - sol.corners[i].x) >= Math.abs(sol.corners[(i + 1) % n].y - sol.corners[i].y);
  const ways = new Set(
    input.buildings[0].tapes.flatMap((t) => {
      if (t.kind === "side") return [across(t.from) ? "across" : "deep"];
      const m = lineOnPhoto(x, sol, prepared.data, t.photo, t.a, t.b, { snap: true });
      return m ? [across(m.sides[0]) ? "across" : "deep"] : [];
    }),
  );
  // One tape checks nothing either way: the one-tape note says so.
  const depthNote =
    ways.size === 1 && input.buildings[0].tapes.length > 1 && n >= 4
      ? ways.has("across")
        ? "Every tape runs across the house (along its front): none runs front to back, so nothing here checks its depth. A tape along a side running front to back would."
        : "Every tape runs front to back: none runs across the house, so nothing here checks its width. A tape along the front or back would."
      : null;

  // results.md
  const tapes = input.buildings[0].tapes;
  const md = [];
  md.push(`# ${inputs.house?.name ?? basename(h.dir)}: measured from photos`, "");
  md.push(`${now.slice(0, 16).replace("T", " ")} UTC. Scrivn's photo route (lib/photoRoute*.ts) on this machine, no API.`, "");
  md.push(`- Photos: ${h.photos.length}; placed ${sol.cameras.length} (${sol.cameras.filter((c) => c.placedBy === "one-corner").length} by one corner). Corner taps ${corners.filter((c) => !c.proposed).length}${keptMarks.length ? ` (${keptMarks.length} of them Scrivn's marks, kept)` : ""}; wall edges tied ${sol.counts.edgePoints}.`);
  md.push(`- Lens: f/W ${rec.focalOverWidth.toFixed(4)}, k ${rec.k.toFixed(4)}; rms ${sol.rms.toFixed(2)} sd.`);
  md.push(`- Tapes: ${(inputs.tapes ?? []).filter((t) => tapeParts[t.id]?.length).map((t) => `${t.id} "${t.said}"`).join("; ") || "none"}.`);
  if (sol.unscaled) md.push("- **No tape: the sizes follow the shape as drawn and are not to scale.**");
  md.push("", "## The outline", "", "| Side | Name | Length | ± | Photos along it |", "|---|---|---|---|---|");
  for (const s of sol.sides) md.push(`| ${sideName(s.from, n)} | ${nameOf(s.from)} | ${ftin(s.lengthFeet)} | ${s.taped ? "taped" : `${s.plusMinusPct}%`} | ${s.photos} |`);
  const xs = sol.corners.map((p) => p.x);
  const ys = sol.corners.map((p) => p.y);
  md.push("", `Across ${ftin(Math.max(...xs) - Math.min(...xs))}, deep ${ftin(Math.max(...ys) - Math.min(...ys))}.`);
  md.push("", "## Accuracy: each tape held out in turn", "");
  if (hold.note) md.push(hold.note);
  else {
    md.push("| Tape held out | Taped | Predicted from the rest | Error | How |", "|---|---|---|---|---|");
    for (const r of hold.rows) md.push(`| ${r.id} ${r.said} | ${ftin(r.taped)} | ${r.predicted !== null ? ftin(r.predicted) : "-"} | ${r.errorPct !== null ? pct(r.errorPct) : "-"} | ${r.each.map((e) => `${e.feet !== null ? ftin(e.feet) : "-"} (${e.where})`).join("; ")}; scaled by ${r.from.join(", ")} |`);
    const errs = hold.rows.filter((r) => r.errorPct !== null).map((r) => Math.abs(r.errorPct));
    if (errs.length) md.push("", `Mean |error| ${(errs.reduce((s, v) => s + v, 0) / errs.length).toFixed(1)}%, worst ${Math.max(...errs).toFixed(1)}%.`);
  }
  if (depthNote) md.push("", `**${depthNote}**`);
  if (checks.length) {
    md.push("", "## Checks (a sanity check, not a tape: doors and windows vary)", "", "| Check | Photo | Expected | Measured | Off |", "|---|---|---|---|---|");
    for (const k of checks) md.push(`| ${k.what} | #${k.photo} | ${k.expect ? ftin(k.expect) : "-"} | ${k.got !== null ? ftin(k.got) : "not placed"} | ${k.expect && k.got !== null ? pct((k.got / k.expect - 1) * 100) : "-"} |`);
  } else if (hold.note && tapes.length === 1) md.push("", "No checks given: add a door's height on a photo to inputs.json `checks` (a door is usually 6'8\") for a sanity check.");
  md.push("", "## Advice", "");
  for (const a of sol.advice) md.push(`- ${sideName(a.from, n)} ${nameOf(a.from)}: ${a.why}`);
  if (!sol.advice.length) md.push("- None: every side is held well enough.");
  const leftOut = (inputs.leaveOut ?? []).map((ref) => photoOf(h, ref)).filter(Boolean);
  if (sol.unplaced.length || leftOut.length) {
    md.push("", "## Photos not used", "");
    for (const p of leftOut) md.push(`- #${p.n} ${p.file}: left out by the session (inputs.json leaveOut).`);
    for (const u of sol.unplaced) md.push(`- #${fileOf(u.photo).n} ${fileOf(u.photo).file}: ${u.why}`);
  }
  if (!inputs.keepProposed && proposals.length) md.push("", `## Corners Scrivn marks (${proposals.length}, pink dashed on measured/NN.png)`, "", `${proposals.map((q) => `#${fileOf(q.photo).n}:${cornerName(q.corner)}`).join(", ")}. Look at each; set "keepProposed": true to keep them ("Looks right"), with any wrong one in "dropProposed" ("14:C9"), and measure again.`);
  const timesNow = { measure: (tMeasure - t0) / 1000, holdOuts: (tHold - t1) / 1000 };
  md.push("", "## Files", "", "- plan.png: the measured plan, every placed photo; measured/NN.png: each photo with its corners and where it stood.", `- sides/: ${Object.keys(frames).length} sides squared up for reading (and a grid copy each); frames.json.`, "- measured.json: the exterior as measured (no walls read yet).");
  md.push("", `Machine time: measure ${timesNow.measure.toFixed(1)} s, hold-outs ${timesNow.holdOuts.toFixed(1)} s.`);
  writeFileSync(statePath(h, "results.md"), `${md.join("\n")}\n`);
  writeJson(statePath(h, "results.json"), { at: now, sides: sol.sides.map((s) => ({ side: sideName(s.from, n), name: nameOf(s.from), lengthFeet: s.lengthFeet, plusMinusPct: s.plusMinusPct, taped: s.taped })), holdOuts: hold.rows, holdNote: hold.note, depthNote, checks, advice: sol.advice, unplaced: sol.unplaced, proposals: proposals.map((q) => ({ photo: fileOf(q.photo).n, corner: cornerName(q.corner), x: q.x, y: q.y })), kept: keptMarks.length, lens: { focalOverWidth: rec.focalOverWidth, k: rec.k }, rms: sol.rms, cameras: sol.cameras.length });

  const out = [`Measured from ${sol.cameras.length} of ${h.photos.length} photos and ${tapes.length} tape${tapes.length === 1 ? "" : "s"}; rms ${sol.rms.toFixed(2)}; lens f/W ${rec.focalOverWidth.toFixed(3)}.`];
  for (const s of sol.sides) out.push(`  ${sideName(s.from, n).padEnd(8)} ${nameOf(s.from).slice(0, 28).padEnd(28)} ${ftin(s.lengthFeet).padStart(8)}  ${s.taped ? "taped" : `±${s.plusMinusPct}%`}`);
  out.push("Each tape held out in turn:");
  if (hold.note) out.push(`  ${hold.note}`);
  for (const r of hold.rows) out.push(`  ${r.id.padEnd(4)} ${r.said.slice(0, 34).padEnd(34)} taped ${ftin(r.taped).padStart(7)}  predicted ${r.predicted !== null ? ftin(r.predicted).padStart(7) : "      -"}  ${r.errorPct !== null ? pct(r.errorPct) : ""}`);
  if (depthNote) out.push(`  ${depthNote}`);
  for (const k of checks) out.push(`  check: ${k.what} on #${k.photo}: ${k.got !== null ? ftin(k.got) : "not placed"}${k.expect ? ` (expected ${ftin(k.expect)}${k.got !== null ? `, ${pct((k.got / k.expect - 1) * 100)}` : ""})` : ""}`);
  for (const a of sol.advice) out.push(`  a tape would help: ${sideName(a.from, n)} ${nameOf(a.from)}: ${a.why}`);
  for (const p of (inputs.leaveOut ?? []).map((ref) => photoOf(h, ref)).filter(Boolean)) out.push(`  not used: #${p.n}: left out (leaveOut).`);
  for (const u of sol.unplaced) out.push(`  not used: #${fileOf(u.photo).n}: ${u.why}`);
  if (!inputs.keepProposed && proposals.length) out.push(`  Scrivn marks ${proposals.length} more corners (pink on measured/NN.png): keepProposed to keep them.`);
  out.push(`Wrote results.md, plan.png, measured/ sheets, ${Object.keys(frames).length} sides in sides/, measured.json.`);
  out.push(`Machine time: ${timed(h, "measure", t0)} s (the measure ${timesNow.measure.toFixed(1)} s, hold-outs ${timesNow.holdOuts.toFixed(1)} s).`);
  return out;
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────

/** A side's photo squared up again as the side is now, and its pixels: what a read is snapped to and coloured from. */
async function squaredNow(x, side, pixelsOf) {
  const frame = x.squareFrame(side, side.photos, 1600);
  if (!frame) return null;
  const sources = [];
  for (const photo of side.photos) {
    const px = await pixelsOf(photo.claimPhotoId);
    if (px) sources.push({ photo, pixels: px });
  }
  if (!sources.length) return null;
  return { frame, rgba: x.squareUp(sources, frame) };
}

/**
 * The walls read off a squared side, put on it as the trace's "Use these" does with everything ticked (SidePhotos.tsx
 * `allPicked`): the read laid on the side as squared now, set on the photo's own edges, coloured, applied.
 */
async function withRead(x, side, r, was, pixelsOf, at) {
  const now = await squaredNow(x, side, pixelsOf);
  if (!now) return { side, words: "no photo to read it on" };
  const { frame, rgba } = now;
  const re = (p) => [x.frameX(frame, x.frameAlongM(was, p[0])), x.frameY(frame, x.frameUpM(was, p[1]))];
  const flat = (pts) => {
    const outPts = [];
    for (let i = 0; i + 1 < pts.length; i += 2) outPts.push(...re([pts[i], pts[i + 1]]));
    return outPts;
  };
  const w = r.wire;
  const wire = {
    ...w,
    materials: (w.materials ?? []).map((mm) => ({ partly_hidden_by: "", ...mm, polygon: mm.polygon.map(re) })),
    openings: (w.openings ?? []).map((o) => {
      const [l, t] = re([o.left, o.top]);
      const [rr, bb] = re([o.right, o.bottom]);
      return { measured_to: o.kind === "garage_door" ? "door_itself" : "trim", partly_hidden_by: "", ...o, left: l, top: t, right: rr, bottom: bb, ...(o.leaf?.length === 4 ? { leaf: [...re([o.leaf[0], o.leaf[1]]), ...re([o.leaf[2], o.leaf[3]])] } : { leaf: [] }) };
    }),
    wall_top: (w.wall_top ?? []).map(re),
    off_wall: (w.off_wall ?? []).map((o) => ({ ...o, box: [...re([o.box[0], o.box[1]]), ...re([o.box[2], o.box[3]])] })),
    notes: w.notes ?? "",
  };
  if (w.roof) {
    const end = (e) => (e ? { ...e, point: e.point?.length === 2 ? re(e.point) : [] } : { kind: "hidden", point: [] });
    wire.roof = { over_wall: "unclear", notes: "", ...w.roof, rake_left: (w.roof.rake_left ?? []).map(re), rake_right: (w.roof.rake_right ?? []).map(re), eave_line: (w.roof.eave_line ?? []).map(re), left_end: end(w.roof.left_end), right_end: end(w.roof.right_end) };
  }
  if (w.roof_shapes) wire.roof_shapes = { ...w.roof_shapes, pieces: (w.roof_shapes.pieces ?? []).map((q) => ({ ...q, outline: flat(q.outline ?? []), foot: flat(q.foot ?? []) })), floor_line: flat(w.roof_shapes.floor_line ?? []) };
  const cams = x.camerasAt(side.photos);
  let p = x.traceProposals(wire, frame, side.lengthFeet, cams);
  const g = x.grayOf({ data: rgba, width: frame.width, height: frame.height, channels: 4 });
  p = x.withSwatches(x.snapTrace(p, frame, g, side.lengthFeet, cams), { data: rgba, width: frame.width, height: frame.height, channels: 4 }, frame);
  const picks = {
    shapes: p.shapes.map((s) => ({ key: s.key, kind: s.kind })),
    openings: p.openings.map((o) => ({ key: o.key, kind: o.kind })),
    wallTop: p.wallTop !== null,
    roof: x.roofPicksAtFirst(p.roof),
    roofShapes: x.shapePicksAtFirst(p),
    trims: x.trimPicksAtFirst(p),
  };
  const next = x.applyTrace(side, p, picks, at);
  const ops = next.openings.map((o) => `${o.kind} ${ftin(o.widthFeet)} x ${ftin(o.heightFeet)}${o.trim ? " (trim)" : ""}`).join(", ");
  return { side: next, words: `${(next.shapes ?? []).map((s) => s.kind).join("+") || "no cladding"}; eaves ${ftin(next.eaveLeftFeet)} / ${ftin(next.eaveRightFeet)}${next.gable ? `, peak ${ftin(next.gable.peakFeet)}` : ""}; ${ops || "no openings"}${next.columns?.length ? `; ${next.columns.length} column${next.columns.length === 1 ? "" : "s"}` : ""}` };
}

/** A "Check these" row in a line, as the pane words it: what, and why it is asked. */
const checkWords = (c) => (c.kind === "drop" ? `${c.title}: ${c.question}` : `${c.title} - ${c.words}`);

const PITCH = (v) => {
  if (typeof v === "number") return v;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*12)?\s*$/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
};

/** The roof check's answers (roof.json, as the session gives them on the check) put on the roof, in the pane's order. */
function withRoofAnswers(x, ext, ans, sideOf, at) {
  let e = ext;
  const plan = () => x.exteriorQuantities(e).roof;
  const said = [];
  const id = (key) => {
    const s = sideOf(key);
    if (!s) throw new Error(`roof.json: no side ${key}.`);
    return s;
  };
  let roof = { ...e.roof };
  const pitch = PITCH(ans.pitch);
  if (pitch !== null) {
    roof.pitch = pitch;
    said.push(`pitch ${pitch}/12 typed`);
  }
  if (ans.overhangs) {
    if (Number.isFinite(ans.overhangs.eave)) roof = { ...roof, eaveOverhangFeet: ans.overhangs.eave, overhangSource: { ...(roof.overhangSource ?? {}), eave: "typed" } };
    if (Number.isFinite(ans.overhangs.rake)) roof = { ...roof, rakeOverhangFeet: ans.overhangs.rake, overhangSource: { ...(roof.overhangSource ?? {}), rake: "typed" } };
    said.push("overhangs typed");
  }
  if (ans.material) {
    roof.material = ans.material;
    said.push(`${ans.material} roof`);
  }
  e = { ...e, roof };
  for (const [key, how] of Object.entries(ans.wings ?? {})) {
    e = { ...e, roof: x.withWingAnswer(e.roof, plan(), id(key).id, how) };
    said.push(`the part out to ${key}: ${how}`);
  }
  for (const [key, how] of Object.entries(ans.notches ?? {})) {
    const s = id(key);
    const notch = plan().notches.find((k) => k.sideIds.includes(s.id));
    if (!notch) throw new Error(`roof.json: no notch at ${key} on the roof as built.`);
    e = { ...e, roof: x.withNotchAnswer(e.roof, plan(), notch, how) };
    said.push(`the notch at ${key}: ${how}`);
  }
  for (const a of ans.additions ?? []) {
    const s = id(a.side);
    const fp = x.exteriorFootprint(e);
    const feet = fp.lengthsFeet[fp.sideIds.indexOf(s.id)];
    const door = a.overDoor ? s.openings.find((o) => o.kind === "door") : undefined;
    if (a.overDoor && !door) throw new Error(`roof.json: a gable over the door on ${a.side}, but no door is read on it (reads.json).`);
    const before = new Set((e.roof.additions ?? []).map((q) => q.id));
    let r2 = x.withAddition(e.roof, a.kind, s.id, feet, door);
    if (Number.isFinite(a.depthFeet)) r2 = { ...r2, additions: r2.additions.map((q) => (before.has(q.id) ? q : { ...q, depthFeet: a.depthFeet })) };
    e = { ...e, roof: r2 };
    said.push(`a ${a.kind} on ${a.side}${a.depthFeet ? ` ${ftin(a.depthFeet)} out` : ""}`);
  }
  for (const [key, kind] of Object.entries(ans.ends ?? {})) {
    e = { ...e, roof: x.withRoofEnd(e.roof, id(key).id, kind) };
    said.push(`the end over ${key}: ${kind}`);
  }
  for (const [key, feet] of Object.entries(ans.drops ?? {})) {
    e = { ...e, roof: x.withWingDrop(e.roof, id(key).id, feet) };
    said.push(`${key} drops ${ftin(feet)}`);
  }
  if (ans.oneSlopeTo) {
    e = { ...e, roof: x.withOneSlope(e.roof, id(ans.oneSlopeTo).id) };
    said.push(`one slope draining to ${ans.oneSlopeTo}`);
  }
  if (ans.looksRight) {
    const p = plan();
    const fromPhotos = x.endsFromPhotos(e, p);
    const guessed = p.ends.filter((en) => !(en.sideId in e.roof.ends) && !fromPhotos.has(en.sideId)).map((en) => en.sideId);
    e = { ...e, roof: x.withRoofChecked(e.roof, p, guessed, at, x.exteriorQuantities(e).wingDrops) };
    said.push("Looks right");
  }
  return { exterior: e, said };
}

export async function report(h) {
  const t0 = Date.now();
  const x = await scrivn();
  const inputs = readJson(statePath(h, "inputs.json"));
  let ext = readJson(statePath(h, "measured.json"));
  const frames = readJson(statePath(h, "sides", "frames.json"), { sides: {} }).sides;
  const sideIds = ext.photoRoute.measured.sideIds;
  const n = sideIds.length;
  const sideOf = (key) => {
    const i = sideIndex(key, n);
    return i === null ? null : ext.sides.find((s) => s.id === sideIds[i]);
  };
  const keyOf = (id) => sideName(sideIds.indexOf(id), n);
  const at = new Date().toISOString();
  const cache = new Map();
  const pixelsOf = async (id) => {
    if (cache.has(id)) return cache.get(id);
    const p = h.photos.find((q) => q.id === id);
    if (!p) return null;
    const { data, info } = await sharp(join(h.dir, p.file)).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const px = { data, width: info.width, height: info.height, channels: info.channels };
    cache.set(id, px);
    return px;
  };
  const out = [];
  // The walls, read off the squared sides by the session.
  const readsFile = statePath(h, "reads.json");
  const reads = existsSync(readsFile) ? readJson(readsFile) : null;
  if (!reads) out.push("No reads.json: the walls are as measured (10' eaves, no openings). Read each side in sides/ and write it (docs/house-runner.md, step 5).");
  for (const [key, r] of Object.entries(reads?.sides ?? {})) {
    const side = sideOf(key);
    if (!side) {
      out.push(`  read ${key}: no such side on this shape - left out`);
      continue;
    }
    if (r.skip || !r.wire) continue;
    if (!side.photos?.length) {
      out.push(`  read ${key}: that side has no photo now - left out`);
      continue;
    }
    const was = r.frame ?? frames[key]?.frame;
    if (!was) {
      out.push(`  read ${key}: no frame (sides/frames.json has none for it) - left out`);
      continue;
    }
    const done = await withRead(x, side, r, was, pixelsOf, at);
    ext = { ...ext, sides: ext.sides.map((s) => (s.id === done.side.id ? done.side : s)) };
    out.push(`  read ${key} ${side.name}: ${done.words}`);
  }
  // The home, as said.
  if (inputs.house?.homeType && inputs.house.homeType !== "detached") ext = { ...ext, homeType: inputs.house.homeType };
  // The roof check's answers.
  const roofFile = statePath(h, "roof.json");
  if (existsSync(roofFile)) {
    const done = withRoofAnswers(x, ext, readJson(roofFile), sideOf, at);
    ext = done.exterior;
    out.push(`Roof answers: ${done.said.join("; ") || "none"}.`);
  }
  const q = x.exteriorQuantities(ext);
  const nameOf = (id) => ext.sides.find((s) => s.id === id)?.name ?? "that side";
  // The roof check as the pane shows it: what is proposed, and each part's choices, by side.
  const proposal = x.roofProposal(ext);
  const rows = x.checkRows(q.roof, ext.roof, proposal, nameOf, true, q.wingDrops);
  const checkLines = [];
  for (const r of rows.notches) checkLines.push(`notch ${keyOf(r.notch.sideId)} (${r.label}): ${r.value}${r.proposed ? ` - proposed: ${r.proposed}` : ""} [${r.options.map((o) => o[0]).join(" | ")}]`);
  for (const r of rows.wings) checkLines.push(`wing ${keyOf(r.sideId)} (${r.label}): ${r.value}${r.drop ? `, ${ftin(r.drop.feet)} under (${r.drop.source})` : ""}${r.proposed ? ` - proposed: ${r.proposed}` : ""}${r.fixed ? ` - ${r.fixed}` : ` [${r.options.map((o) => o[0]).join(" | ")}]`}`);
  for (const e of q.roof?.ends ?? []) checkLines.push(`end over ${keyOf(e.sideId)} ${nameOf(e.sideId)}: ${e.kind}${e.sideId in (ext.roof.ends ?? {}) ? " (said)" : ""}`);
  const checks = x.exteriorChecks(ext, q);
  // The report, as the phone's engine and scrivn.ca make it.
  const meta = { title: inputs.house?.name ?? basename(h.dir), date: new Date().toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }), madeWith: "Scrivn" };
  const made = x.exteriorReport(ext, meta);
  if (!made) throw new Error("Nothing measured to report: run measure first.");
  const photos = {};
  for (const ph of made.photos) {
    const p = h.photos[ph.photo.n - 900];
    if (!p) continue;
    const jpeg = await sharp(join(h.dir, p.file)).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const b64 = jpeg.toString("base64");
    const size = x.jpegSize(b64);
    if (size) photos[ph.photo.n] = { dataUrl: `data:image/jpeg;base64,${b64}`, width: size.width, height: size.height };
  }
  const bytes = Buffer.from(x.exteriorReportBytes({ report: made, svgOf: (el) => x.renderToStaticMarkup(el), photos, footer: meta.madeWith }));
  writeFileSync(statePath(h, "report.pdf"), bytes);
  const ok = x.checkTeamResult(ext);
  if (!ok.ok) throw new Error(`Made, but it would not open in a claim: ${ok.error}`);
  writeJson(statePath(h, "exterior.json"), ext);
  const scoped = { ...ext, scope: { roofing: true, sides: ext.sides.map((s) => s.id), soffitFascia: true, eavestrough: true } };
  const scope = x.exteriorScopeLines(scoped);
  const lineWords = (l) => (typeof l === "string" ? l : [l.description ?? l.label ?? l.text, l.quantity !== undefined ? `${l.quantity} ${l.unit ?? ""}` : ""].filter(Boolean).join(" - "));
  const r = q.roofing;
  const md = [
    `# ${meta.title}: exterior`,
    "",
    `Walls ${q.totals.grossSquareFeet.toFixed(1)} SF gross, ${q.totals.netSquareFeet.toFixed(1)} SF net${q.totals.trimSquareFeet ? `, ${q.totals.trimSquareFeet.toFixed(1)} SF of trim` : ""}; roof ${r ? `${r.squares.toFixed(2)} SQ at ${x.formatPitch(q.pitch.value)} (${q.pitch.source})` : "none"}.`,
    "",
    "## The roof check",
    "",
    ...checkLines.map((l) => `- ${l}`),
    "",
    `Proposed and not answered: ${proposal?.proposed.length ? proposal.proposed.map((p) => `${p.key.replace(/^(wing|notch):(.+)$/, (_, k, id) => `${k} ${keyOf(id)}`)} ${p.value} (${p.why})`).join("; ") : "nothing"}.`,
    "",
    "## Check these",
    "",
    ...(checks.length ? checks.map((c) => `- ${checkWords(c)}`) : ["- Nothing."]),
    "",
    "## Roof lines",
    "",
    r ? `Ridge ${r.ridgeFeet.toFixed(1)} LF, hips ${r.hipFeet.toFixed(1)}, valleys ${r.valleyFeet.toFixed(1)}, eaves ${r.eaveFeet.toFixed(1)}, rakes ${r.rakeFeet.toFixed(1)}, step flashing ${r.stepFeet.toFixed(1)}.` : "No roof.",
    "",
    "## Scope lines",
    "",
    ...[...(scope.roofing ?? []), ...(scope.siding ?? [])].map((l) => `- ${lineWords(l)}`),
  ];
  writeFileSync(statePath(h, "report.md"), `${md.join("\n")}\n`);
  out.push(`Walls ${q.totals.netSquareFeet.toFixed(1)} SF net of ${q.totals.grossSquareFeet.toFixed(1)}; roof ${r ? `${r.squares.toFixed(2)} SQ at ${x.formatPitch(q.pitch.value)} (${q.pitch.source})` : "none"}.`);
  out.push("The roof check:", ...checkLines.map((l) => `  ${l}`));
  if (proposal?.proposed.length) out.push(`  proposed, not answered: ${proposal.proposed.map((p) => p.why).join(" | ")}`);
  out.push(`Check these: ${checks.length ? checks.map(checkWords).join(" | ") : "nothing"}`);
  out.push(`Wrote report.pdf (${(bytes.length / 1024).toFixed(0)} KB, ${/\/Count (\d+)/.exec(bytes.toString("latin1"))?.[1] ?? "?"} pages), report.md and exterior.json.`);
  if (h.kind === "request") out.push(`Return it: node scripts/return-exterior-request.mjs ${h.request.request.id.slice(0, 8)} "${relative(process.cwd(), statePath(h, "exterior.json")).replace(/\\/g, "/")}"`);
  out.push(`Machine time: ${timed(h, "report", t0)} s.`);
  return out;
}

// ── zoom ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A close look at photo [ref] round each of [points] ([x, y] in its pixels): crops with a 10 px grid in one picture, and
 * where Scrivn's snap would put a corner tapped at each. One point and [half] makes one big crop instead.
 */
export async function zoom(h, ref, points, half = 120) {
  const x = await scrivn();
  const p = photoOf(h, ref);
  if (!p) throw new Error(`No photo ${ref}.`);
  const [px] = await loadPixels({ ...h, photos: [p] }, x);
  const inputs = readJson(statePath(h, "inputs.json"), null);
  const candidates = readJson(statePath(h, "candidates.json"), { photos: {} }).photos;
  const marks = inputs ? marksFor(h, inputs, p, { candidates }) : { candidates: candidates[p.n] ?? [] };
  // Where a tap there snaps: the photo levelled on its own with the default lens.
  const lines = x.photoLines(px);
  const level = x.levelPhotos([{ width: px.width, height: px.height, segments: lines.segments, focalPrior: p.focalPrior ?? null, regions: null }], { fitLens: false, k: x.DEFAULT_RADIAL_K });
  const cam = level.cameras[0];
  const words = [];
  const looks = points.map(([cx, cy]) => {
    const s = cam ? x.snapToEdge(lines.gray, cam, cx, cy) : null;
    const said = s?.onEdge ? `snaps ${s.x - cx >= 0 ? "+" : ""}${(s.x - cx).toFixed(1)} px to x ${s.x.toFixed(1)}` : `no edge within ${x.SNAP_RADIUS_PX} px`;
    words.push(`(${cx}, ${cy}): ${said}${s?.onEdge ? ` (${s.strength.toFixed(0)} grey levels, ${s.polarity > 0 ? "lighter" : "darker"} to its right)` : ""}.`);
    return { x: cx, y: cy, corner: 0, named: true, snapped: s?.onEdge ? [s.x, s.y] : null, words: `(${cx}, ${cy}) ${s?.onEdge ? `snaps ${(s.x - cx).toFixed(1)}` : "no edge"}` };
  });
  const dir = ensureDir(statePath(h, "zoom"));
  const file = join(dir, `${nn(p.n)}_${points.map(([a, b]) => `${Math.round(a)}-${Math.round(b)}`).join("_")}.png`.slice(0, 120));
  const png =
    points.length === 1
      ? await zoomPng(px, points[0][0], points[0][1], half, { ...marks, points: [{ x: points[0][0], y: points[0][1], text: `(${points[0][0]}, ${points[0][1]})`, colour: "#ff3355" }, ...(looks[0].snapped ? [{ x: looks[0].snapped[0], y: looks[0].snapped[1], text: "snaps here", colour: "#39ff14" }] : [])] })
      : await tapStrip(px, looks, `#${p.n} ${p.file}: red the point, green where a corner tapped there snaps`, { half, marks });
  writeFileSync(file, png);
  return [...words, `Wrote ${relative(h.dir, file)}.`];
}
