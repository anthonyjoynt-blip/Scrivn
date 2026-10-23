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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { scrivn } from "./code.mjs";
import { cornerAt, draftInputs, ensureDir, loadPixels, nn, photoOf, readJson, routeInput, statePath, writeJson } from "./folder.mjs";
import { contactSheet, griddedSide, measuredPlanPng, photoSheet, reviewPages, tapStrip, zoomPng } from "./sheets.mjs";
import { applyFixes, checkDoubts, measureDoubts, parseFixes, reviewLines } from "./review.mjs";
import { placeDecks } from "./decks.mjs";
import { cornerIndex, cornerName, ftin, sideIndex, sideName } from "./words.mjs";

/**
 * A corner's edge marked at its top and its foot: within this of one column of the levelled photo, or it is likely not one
 * edge. A photo's levelling is itself off by half a degree or so, which leans its uprights 5-10 px over a wall's height;
 * the measure reads each edge where it crosses the horizon, which that leaning moves least.
 */
const EDGE_TOLERANCE_PX = 15;

/**
 * The route's solve options inputs.json asks for: "sizePhotos": "all" measures the old way (10-20 to 10-22: a photo placed
 * where you stood sizes the house with the rest), to compare; absent, only photos with two corners or more size it.
 */
export const solveOptsOf = (inputs) => (inputs.sizePhotos === "all" ? { sizePhotos: "all" } : {});

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

/** As many candidates as a photo's sheet letters: a to z. */
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * A photo's corner candidates: its corner edges (lib/photoRouteFind.ts cornerEdges: upright edges that run long between two
 * broad surfaces, a downspout or a thin trim smoothed away first, each put on the photo's own sharp edge), the strongest 26,
 * lettered left to right. Each is the edge's top and foot, exact: a corner picked from them is put on that edge to the
 * pixel, with no close-up needed. A guess list for the session, never taken as a corner by itself (2026-10-21: on the far-back
 * house G they hold 17 of the 20 hand corners within 10 px, the old long-edge letters 12; which edge is a corner, and which
 * corner, Scrivn can't tell by itself - porch posts, garage trim and pilasters look the same).
 */
function candidatesOf(x, cam, gray) {
  if (!cam) return [];
  const kept = x.cornerEdges(gray, cam).slice(0, LETTERS.length).sort((a, b) => a.u - b.u);
  return kept.flatMap((e, i) => {
    const foot = x.fromLevel(cam, e.u, e.vBottom);
    const top = x.fromLevel(cam, e.u, e.vTop);
    return foot && top ? [{ pick: LETTERS[i], x: Math.round(foot[0] * 10) / 10, y: Math.round(foot[1] * 10) / 10, top: top.map((v) => Math.round(v * 10) / 10), lengthPx: Math.round(e.vBottom - e.vTop), exact: true }] : [];
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
  const checks = [];
  for (const c of own) {
    const xy = cornerAt(c, candidates[p.n]);
    if (!xy) continue;
    const given = c.corner === undefined || c.corner === null ? -1 : (cornerIndex(c.corner, n) ?? -1);
    const app = numbered?.find((q) => q.photo === p.id && Math.abs(q.x - xy[0]) < 1e-6 && Math.abs(q.y - xy[1]) < 1e-6);
    taps.push({ x: xy[0], y: xy[1], corner: given >= 0 ? given : (app?.corner ?? -1), named: given >= 0 && !c.kept });
    if (Array.isArray(c.edge)) checks.push({ a: c.edge[0], b: c.edge[1], text: "" });
  }
  for (const q of proposals.filter((q) => q.photo === p.id)) taps.push({ x: q.x, y: q.y, corner: q.corner, proposed: true });
  const tapes = (inputs.tapes ?? []).flatMap((t) => (t.on ?? []).filter((o) => photoOf(h, o.photo)?.n === p.n && o.a && o.b).map((o) => ({ a: o.a, b: o.b, text: `${t.id} ${ftin(Number(t.feet))}` })));
  checks.push(...(inputs.checks ?? []).filter((k) => photoOf(h, k.photo)?.n === p.n && k.a && k.b).map((k) => ({ a: k.a, b: k.b, text: `${k.what ?? "check"}${k.feet ? ` ${ftin(Number(k.feet))}?` : ""}` })));
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

/**
 * A point on the shape as solved carried back onto the shape as drawn, axis by axis between the corners (the inverse of
 * the route's own drawn-to-solved carry, which standAt goes through).
 */
function solvedToDrawn(solved, drawn) {
  const axis = (pick) => {
    const pairs = solved.map((q, i) => [pick(q), pick(drawn[i])]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [a, d] of pairs) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last[0] - a) < 0.05) last[1] = (last[1] + d) / 2;
      else merged.push([a, d]);
    }
    return (v) => {
      if (merged.length === 1) return v - merged[0][0] + merged[0][1];
      let k = 1;
      while (k < merged.length - 1 && merged[k][0] < v) k++;
      const [a0, d0] = merged[k - 1];
      const [a1, d1] = merged[k];
      return d0 + ((v - a0) * (d1 - d0)) / (a1 - a0 || 1);
    };
  };
  const fx = axis((q) => q.x);
  const fy = axis((q) => q.y);
  return (p) => [fx(p[0]), fy(p[1])];
}

/**
 * The review written: review.png (review-2.png ...) and review.txt, the items in doubt; the old pages taken away first.
 * Returns the lines for the console.
 */
async function writeReview(h, items, pixelsAll, marksOf, title) {
  for (const f of readdirSync(h.state)) if (/^review(-\d+)?\.png$/.test(f)) rmSync(statePath(h, f));
  const pixelsOf = async (n) => pixelsAll[h.photos.findIndex((p) => p.n === n)];
  const pages = await reviewPages(items, pixelsOf, marksOf, title);
  pages.forEach((png, i) => writeFileSync(statePath(h, i === 0 ? "review.png" : `review-${i + 1}.png`), png));
  const lines = reviewLines(items);
  writeFileSync(statePath(h, "review.txt"), `${title}\n${lines.join("\n")}\n`);
  return lines;
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
  const { input } = routeInput(h, inputs, {}, x);
  const { data, level } = levelFor(x, input, pixels, lines);
  const candFile = statePath(h, "candidates.json");
  let candidates = !fresh && existsSync(candFile) ? readJson(candFile).photos : null;
  if (!candidates) {
    candidates = Object.fromEntries(h.photos.map((p, i) => [p.n, candidatesOf(x, data[i].camera, data[i].gray)]));
    writeJson(candFile, { about: "Each photo's corner candidates: its corner edges (upright edges running long between two broad surfaces, eave to ground), the strongest 26, lettered left to right. x, y is the edge's foot and top its top, in the photo's pixels; exact: a corner picked from one is put on that edge to the pixel. A corner may be given as one: {\"photo\": n, \"pick\": \"c\"}.", photos: candidates });
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
    `Corner candidates: ${Object.values(candidates).reduce((s, c) => s + c.length, 0)} on ${Object.values(candidates).filter((c) => c.length).length} photos (orange, lettered: each an exact edge, top to foot).`,
    kept ? `Kept inputs.json as it is (prepare --fresh starts it again).` : `Draft inputs.json: shape ${inputs.shape.from === "tester" ? "the tester's" : "a placeholder 40' x 30' rectangle - draw the real one"}; ${inputs.corners.length} corners${inputs.corners.length ? " (the tester's)" : ""}; ${inputs.tapes.length} tapes.`,
    ...inputs.tapes.map((t) => `  ${t.id}: "${t.said}" -> ${ftin(Number(t.feet))}, ${t.kind === "side" ? `a wall's length (${t.side ? `on ${t.side}` : "set its side"})` : `a line on a photo across ${t.count > 1 ? `each of ${t.count}` : "it"} (${t.on?.length ? `on ${t.on.map((o) => `#${o.photo}`).join(", ")}` : "place its ends"})`}`),
    ...(inputs.estimates ?? []).map((e) => `  ${e.id}: "${e.said}" -> about ${ftin(Number(e.feet))} ±${e.plusMinusPct}%, estimated on site by eye: never a tape, ${useWords(e)} (${e.side ? `on ${e.side}` : "set its side"})`),
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
  const { input, problems, n } = routeInput(h, inputs, candidates, x);
  const out = [];
  const shapeBad = problems.filter((p) => p.startsWith("shape") || / is not square /.test(p));
  if (shapeBad.length) return [...shapeBad.map((p) => `✗ ${p}`), "Fix the shape first; nothing else can be checked on it."];
  const walkShape = !!inputs.walk?.turns && (inputs.shape?.from === "placeholder" || inputs.shape?.from === "walk") && !problems.some((p) => p.startsWith("walk"));
  if (walkShape) out.push(`Shape: the walk's ${n} corners as turned (walk.turns), its sizes rough and held loosely. Drawn to rough scale (shape.outline, the same corners in order, shape.from "session") it holds the measure better; the walk then checks it.`);
  else if (inputs.shape?.from === "placeholder") out.push("✗ The shape is still the placeholder rectangle: draw the house's own (shape.outline), then set shape.from to \"session\" - or give the walk's corners (walk.turns) and it is the walk's.");
  // The photos the walk says what they were taken for: their corners named by fitting, the corner it was for among them.
  const roles = Object.entries(inputs.walk?.photos ?? {});
  if (roles.length) out.push(`Roles from the walk: ${roles.map(([k, v]) => `#${k} ${v}`).join(", ")}. A photo's corners you name nothing on are named by fitting it on the shape, the corner it was for among them: confirm each on the review.`);
  const pixels = await loadPixels(h, x);
  const lines = pixels.map(x.photoLines);
  const prepared = x.preparePhotos(input, pixels, lines);
  const b = input.buildings[0];
  const numbered = x.numberCorners(input, "main", prepared.data);
  const withNumbers = { ...input, buildings: [{ ...b, corners: numbered }] };
  // The corners alone (no wall edges): quick, and enough to say which photos the shape places.
  const quick = x.solveRoute(withNumbers, "main", prepared.data, { ...solveOptsOf(inputs), wallEdges: false });
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
    if (placed.has(p.id)) words.push(inputs.sizePhotos === "all" || mine.length >= 2 ? "placed" : "placed (a detail photo: read, never sized from)");
    else if (mine.length === 1) words.push(inputs.sizePhotos === "all" ? "one corner: placed later off its wall edges, or not at all" : "one corner: a detail photo - read, never sized from; placed where you stood for it (standAt)");
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
  for (const e of inputs.estimates ?? []) {
    if (e.skip) continue;
    const i = sideIndex(e.side, n);
    if (i !== null) out.push(`  estimate ${e.id} "${e.said}": ${sideName(i, n)}, about ${ftin(Number(e.feet))} ±${e.plusMinusPct ?? 20}% (estimated on site, not a tape, ${useWords(e)}; the shape drew it ${ftin(Math.hypot(inputs.shape.outline[(i + 1) % n][0] - inputs.shape.outline[i][0], inputs.shape.outline[(i + 1) % n][1] - inputs.shape.outline[i][1]))})`);
  }
  const scaled = b.tapes.length > 0;
  if (!scaled) out.push(`✗ No tape is in yet: without one the sizes are the shape's as drawn${b.estimates?.some((e) => e.use === "hold") ? " and the sizes estimated on site" : ""}, not to scale.`);
  for (const p of problems.filter((q) => !q.startsWith("tape"))) out.push(`${p.startsWith("estimate") && / is taped;/.test(p) ? "  " : "✗ "}${p}`);
  for (const k of inputs.checks ?? []) if (!photoOf(h, k.photo) || !k.a || !k.b) out.push(`✗ check "${k.what ?? ""}": needs photo, a and b.`);
  await writeSheets(h, x, inputs, pixels, { candidates, numbered });
  // What Scrivn numbered each tap, for the fixes to name them by; and the review: only what is in doubt.
  writeJson(statePath(h, "numbered.json"), numbered.map((c) => ({ photo: h.photos.find((p) => p.id === c.photo)?.n, x: c.x, y: c.y, corner: c.corner >= 0 ? cornerName(c.corner) : null })));
  const doubts = checkDoubts(x, h, inputs, { candidates, numbered, quick, data: prepared.data, n });
  const review = await writeReview(h, doubts, pixels, (pn) => marksFor(h, inputs, h.photos.find((p) => p.n === pn), { candidates, numbered }), "Check: the corners and tape ends in doubt");
  out.push(`Review: ${doubts.length} in doubt of ${numbered.length} corners and ${(inputs.tapes ?? []).filter((t) => t.kind === "line").reduce((s2, t) => s2 + 2 * (t.on ?? []).length, 0)} tape ends - review.png${doubts.length > 18 ? ` (and ${Math.ceil(doubts.length / 18) - 1} more)` : ""}; the rest on contact.png. Answer in scrivn/fixes.txt, then: run.mjs <folder> fix`);
  out.push(...review.map((l) => `  ${l}`));
  // Each photo's corners close up: a corner given as its edge at its top and its foot (both on the line marked: one upright
  // edge in the levelled photo, or said); a tap at its foot, with where the snap puts it. The corners' places at a glance.
  const tapsDir = ensureDir(statePath(h, "taps"));
  for (const f of readdirSync(tapsDir)) if (f.endsWith(".png")) rmSync(join(tapsDir, f));
  for (const [i, p] of h.photos.entries()) {
    const d = prepared.data[i];
    const mine = (inputs.corners ?? []).filter((c) => photoOf(h, c.photo)?.n === p.n && !(inputs.leaveOut ?? []).some((r) => photoOf(h, r)?.n === p.n));
    if (!mine.length || !d.camera) continue;
    const looks = [];
    for (const c of mine) {
      const at = cornerAt(c, candidates[p.n]);
      if (!at) continue;
      const app = numbered.find((q) => q.photo === p.id && Math.abs(q.x - at[0]) < 1e-6 && Math.abs(q.y - at[1]) < 1e-6);
      const k = c.corner != null ? cornerIndex(c.corner, n) : (app?.corner ?? -1);
      const name = k != null && k >= 0 ? cornerName(k) : "?";
      const named = c.corner != null;
      if (Array.isArray(c.edge)) {
        const [top, foot] = c.edge[0][1] <= c.edge[1][1] ? c.edge : [c.edge[1], c.edge[0]];
        const lt = x.toLevel(d.camera, top[0], top[1]);
        const lf = x.toLevel(d.camera, foot[0], foot[1]);
        const du = lf[0] - lt[0];
        if (Math.abs(du) > EDGE_TOLERANCE_PX) {
          // Where each end would be, upright from the other: one of them is on the corner.
          const footFromTop = x.fromLevel(d.camera, lt[0], lf[1]);
          const topFromFoot = x.fromLevel(d.camera, lf[0], lt[1]);
          out.push(`✗ #${p.n} ${name}: its edge's top and foot are ${Math.abs(du).toFixed(1)} px apart in the levelled photo - likely not one upright edge. Upright from the top, the foot is at x ${footFromTop ? footFromTop[0].toFixed(0) : "?"}; from the foot, the top at x ${topFromFoot ? topFromFoot[0].toFixed(0) : "?"}. Look at both ends again.`);
        }
        looks.push({ x: top[0], y: top[1], corner: k ?? -1, named, line: [top, foot], words: `${name} top` });
        looks.push({ x: foot[0], y: foot[1], corner: k ?? -1, named, line: [top, foot], words: `${name} foot · ${du >= 0 ? "+" : ""}${du.toFixed(1)} px off upright` });
      } else if (c.exact) {
        looks.push({ x: at[0], y: at[1], corner: k ?? -1, named, words: `${name} exact` });
      } else {
        const sn = x.snapToEdge(d.gray, d.camera, at[0], at[1]);
        looks.push({ x: at[0], y: at[1], corner: k ?? -1, named, snapped: sn.onEdge ? [sn.x, sn.y] : null, words: `${name} ${sn.onEdge ? `snaps ${sn.x - at[0] >= 0 ? "+" : ""}${(sn.x - at[0]).toFixed(1)} px` : "no edge: as tapped"}` });
      }
    }
    writeFileSync(join(tapsDir, `${nn(p.n)}.png`), await tapStrip(pixels[i], looks, `#${p.n} ${p.file}: each corner close up - red where put, green where a tap snaps, violet an edge marked`));
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
  return x.lineFeet(sol, data, photoId, a, b, snap);
}

// ── measure ──────────────────────────────────────────────────────────────────────────────────────

/** Whether a mark names this proposed corner: "14:C9" is C9 on photo 14. */
function names(h, list, q) {
  const p = h.photos.find((ph) => ph.id === q.photo);
  return (list ?? []).some((s) => {
    const m = /^#?(\d+)\s*:\s*(C?\d+)$/i.exec(String(s).trim());
    return m && Number(m[1]) === p?.n && cornerIndex(m[2]) === q.corner;
  });
}

/** The corners Scrivn marked that the session keeps: those it listed ("9:C7"), or with true every one (the app's "Looks right") less those set aside. */
function kept(h, inputs, q) {
  if (Array.isArray(inputs.keepProposed)) return names(h, inputs.keepProposed, q);
  return inputs.keepProposed === true && !names(h, inputs.dropProposed, q);
}

/**
 * Each tape held out in turn: the house solved from the others, and the tape's length predicted from that solve - a
 * wall's from its side, a line's from its own photo's view (lineOnPhoto) - against the tape.
 */
function holdOuts(x, h, inputs, routeIn, corners, data, tapeParts, n, solveOpts = {}, rowsIn = null) {
  const withCorners = { ...routeIn, buildings: [{ ...routeIn.buildings[0], corners }] };
  const live = (inputs.tapes ?? []).filter((t) => tapeParts[t.id]?.length);
  // Sizes estimated on site and held stay in every hold-out: one tape can be held out against them alone. (Checked ones scale nothing.)
  const est = (routeIn.buildings[0].estimates ?? []).filter((e) => e.use === "hold").map((e) => e.id);
  if (live.length < 2 && !(live.length === 1 && est.length)) return { rows: [], note: live.length === 1 ? "One tape: it is the only scale, so there is nothing to hold it out against. The checks below (door heights, if given) are a sanity check only." : "No tape: the sizes are the shape's as drawn, not to scale." };
  const t0 = Date.now();
  // lib/photoRouteCheck.ts: each held out, predicted from the rest - a wall's from its side, a line's from its own photo's view.
  const got = rowsIn ?? x.holdOutTapes(withCorners, "main", data, live.map((t) => ({ id: t.id, parts: tapeParts[t.id] })), solveOpts);
  const seconds = (Date.now() - t0) / 1000 / Math.max(1, got.length);
  const rows = got.map((r) => {
    const t = live.find((q) => q.id === r.id);
    const each = r.each.map((e) => (e.side !== undefined ? { feet: e.feet, where: `${sideName(e.side, n)}, ±${e.plusMinusPct}%` } : { feet: e.feet, where: e.feet !== null ? `photo #${photoOf(h, e.photo)?.n}` : `photo #${photoOf(h, e.photo)?.n} not placed without it` }));
    return { id: r.id, said: t?.said ?? "", taped: Number(t?.feet ?? r.taped), predicted: r.predicted, errorPct: r.errorPct, each, from: [...r.from, ...(est.length ? [`the estimates (${est.join(", ")})`] : [])], seconds, sizes: r.sizes };
  });
  return { rows, note: null };
}

/** Which photos sized the house and which were only placed to be read, in a line for results.md. */
function roleWords(sol, solveOpts, fileOf) {
  const sized = sol.cameras.filter((c) => c.role !== "detail");
  const detail = sol.cameras.filter((c) => c.role === "detail");
  const list = (cs) => cs.map((c) => `#${fileOf(c.photo).n}`).join(", ");
  if (solveOpts.sizePhotos === "all") return `- Sized the old way (sizePhotos "all"): every photo placed sizes the house, ${sized.filter((c) => c.placedBy === "stood").length} of them by where you stood.`;
  return `- The size from ${sized.length} measure photo${sized.length === 1 ? "" : "s"} (two corners or more: ${list(sized) || "none"})${detail.length ? `; ${detail.length} detail photo${detail.length === 1 ? "" : "s"} placed on the house as measured, to be read only (${list(detail)})` : ""}. Where you stood never sizes it.`;
}

/** A side's ± in results.md: taped, or the measure's ±, and "estimated on site" when someone at the house judged it by eye. */
function plusMinusWords(s) {
  if (s.taped) return "taped";
  if (s.notMeasured) return `**NOT measured** (${s.notMeasured.why}): ${s.notMeasured.fix}`;
  if (s.estimated) return `${s.plusMinusPct}%, estimated on site (about ${ftin(s.estimated.feet)} ±${s.estimated.plusMinusPct}%)`;
  if (s.estimateCheck) return `${s.plusMinusPct}%; estimated on site about ${ftin(s.estimateCheck.feet)}: ${s.estimateCheck.disagrees ? "**disagrees, tape it**" : "agrees"}`;
  return `${s.plusMinusPct}%`;
}

/** What a size estimated on site does: only checks the measure (the default), or holds its side loosely. */
const useWords = (e) => (e.use === "hold" ? "held loosely" : "checked against the measure, which it never moves");

/** A side's measure against the size estimated on site, in a line: "about 7' ±20%: +71%, disagrees - tape it". */
const estimateCheckWords = (c) => `about ${ftin(c.feet)} ±${c.plusMinusPct}%: ${pct(c.offPct)}, ${c.disagrees ? "disagrees - tape it" : "agrees"}`;

export async function measure(h) {
  const t0 = Date.now();
  const x = await scrivn();
  const inputs = readJson(statePath(h, "inputs.json"));
  const candidates = readJson(statePath(h, "candidates.json"), { photos: {} }).photos;
  const { input, problems, tapeParts, n } = routeInput(h, inputs, candidates, x);
  const blocking = problems.filter((p) => p.startsWith("shape") || / is not square /.test(p) || p.startsWith("corners") || p.startsWith("walk.turns"));
  if (blocking.length) throw new Error(`inputs.json is not ready:\n${blocking.join("\n")}\nRun check.`);
  const pixels = await loadPixels(h, x);
  const lines = pixels.map(x.photoLines);
  let solveOpts = solveOptsOf(inputs);
  let keptMarks = [];
  const runMeasure = () => {
    let mm = x.measureRoute(input, "main", pixels, { lines, solve: solveOpts });
    keptMarks = [];
    // "Looks right": the corners Scrivn marked on the placed photos kept (less those set aside), and measured again.
    if (inputs.keepProposed === true || (Array.isArray(inputs.keepProposed) && inputs.keepProposed.length)) {
      keptMarks = mm.proposals.filter((q) => kept(h, inputs, q));
      const again = { ...input, buildings: [{ ...input.buildings[0], corners: [...mm.corners.filter((c) => !c.proposed), ...keptMarks.map((q) => ({ photo: q.photo, x: q.x, y: q.y, corner: q.corner, by: "app" }))] }] };
      mm = x.measureRoute(again, "main", pixels, { lines, solve: solveOpts });
    }
    return mm;
  };
  /** The session's own corners of a measure: a kept mark was made with every tape in, and would carry a held-out tape back in. */
  const ownOf = (mm) => mm.corners.filter((c) => !keptMarks.some((k) => k.photo === c.photo && Math.abs(k.x - c.x) < 1e-6 && Math.abs(k.y - c.y) < 1e-6));
  let m = runMeasure();
  // The self-check (lib/photoRouteCheck.ts, 2026-10-22): the tapes disagreeing by more than 5% held out, the one measure photo
  // whose leaving brings them back within 5% is left out of the size. Not the old way (sizePhotos "all"), unless asked.
  const tapeGroups = (inputs.tapes ?? []).filter((t) => tapeParts[t.id]?.length).map((t) => ({ id: t.id, parts: tapeParts[t.id] }));
  const doCheck = inputs.selfCheck === true || (inputs.selfCheck !== false && solveOpts.sizePhotos !== "all");
  const tCheck = Date.now();
  const self = doCheck ? x.selfCheck({ ...input, buildings: [{ ...input.buildings[0], corners: ownOf(m) }] }, "main", m.prepared.data, tapeGroups, solveOpts, (id) => `#${photoOf(h, id)?.n}`) : null;
  const checkSeconds = (Date.now() - tCheck) / 1000;
  if (self?.dropped) {
    solveOpts = { ...solveOpts, outOfSize: [self.dropped.photo] };
    m = runMeasure();
  }
  const tMeasure = Date.now();
  const { prepared, solution: sol, corners, proposals } = m;
  // Accuracy: each tape held out in turn (and the checks, door heights, as a sanity check with every tape in, below).
  const t1 = Date.now();
  // On the session's own corners only: a kept mark is where the measure with every tape put that corner, so it would
  // carry the tape held out into the solve meant to predict it.
  const own = corners.filter((c) => !keptMarks.some((k) => k.photo === c.photo && Math.abs(k.x - c.x) < 1e-6 && Math.abs(k.y - c.y) < 1e-6));
  // Hold-outs the self-check made on these same corners are kept; after a photo is left out they are made again.
  const hold = holdOuts(x, h, inputs, input, own, prepared.data, tapeParts, n, solveOpts, self && !self.dropped ? self.before : null);
  // Honest sizes (2026-10-22): the tapes that size the house disagreeing by more than 5% held out, no untaped side is
  // measured to better than that - each is said not measured, with the tape most off named to check. (Not the old way.)
  const worstHeld = x.worstPct(hold.rows);
  const mostOff = hold.rows.filter((r) => r.sizes !== false && r.errorPct !== null).sort((a, b) => Math.abs(b.errorPct) - Math.abs(a.errorPct))[0];
  if (solveOpts.sizePhotos !== "all" && worstHeld !== null && worstHeld > x.TAPES_AGREE_PCT && mostOff) {
    sol.sides = x.tapesDisagree(sol.sides, worstHeld, `tape ${mostOff.id} (${mostOff.said.split(/[(,;]/)[0].trim()}, taped ${ftin(mostOff.taped)})`, mostOff.errorPct);
  }
  const now = new Date().toISOString();
  const rec = x.measuredFrom(sol, prepared.data, now);
  const state = { format: x.PHOTO_ROUTE_FORMAT, photos: input.photos, buildings: [{ ...input.buildings[0], corners }], measured: null };
  let ext = x.exteriorFromRoute(undefined, state, rec);
  if (!ext) throw new Error("The corners as numbered do not make the shape drawn (a side solved to nothing): look at each photo's numbers on the sheets and run check.");
  const sideIds = ext.photoRoute.measured.sideIds;
  // The session's names for the sides, the home's type and which way its front faces.
  const names = inputs.shape?.names ?? {};
  // What the building is clad in and stands on, when said (a metal shed on a slab: no parging): every side, till its walls are read.
  const cladding = inputs.house?.cladding;
  const onGrade = inputs.house?.base === "grade";
  ext = {
    ...ext,
    sides: ext.sides.map((s) => {
      const i = sideIds.indexOf(s.id);
      const named = names[sideName(i, n)];
      let side = named ? { ...s, name: named } : s;
      if (cladding) side = { ...side, bands: side.bands.map((b) => ({ ...b, kind: cladding })) };
      if (onGrade) side = { ...side, base: "grade", baseLeftFeet: 0, baseRightFeet: 0 };
      return side;
    }),
    ...(Number.isFinite(inputs.house?.frontFacesDeg) ? { frontFacesDeg: inputs.house.frontFacesDeg } : {}),
  };
  // The decks, on the house as measured.
  const deckRun = placeDecks(x, h, inputs, ext, n);
  ext = deckRun.exterior;
  const placedDecks = deckRun.placed.filter((d) => d.deck).map((d) => ({ name: d.name, placing: d.placing, taps: d.taps }));
  writeJson(statePath(h, "measured.json"), ext);
  // What the pane says is worth a look (lib/photoRouteSanity.ts): its "photo N" is #N here, route.photos being the folder's.
  const sanity = x.routeSanity(ext);
  // The photos waiting for where the user stood, their best guesses carried back onto the shape as drawn (standAt's frame).
  const toDrawn = solvedToDrawn(sol.corners, input.buildings[0].outline);
  const leftOutIds = new Set((inputs.leaveOut ?? []).map((ref) => photoOf(h, ref)?.id).filter(Boolean));
  const doubtful = (sol.doubtful ?? []).filter((d) => !leftOutIds.has(d.photo)).map((d) => ({
    photo: h.photos.find((p) => p.id === d.photo)?.n,
    guesses: d.spots.slice(0, 3).map((g) => toDrawn(g.at).map((v) => Math.round(v * 2) / 2)),
  }));
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
  // The corners Scrivn marks and nobody has kept, each close up: the checkpoint before keeping any.
  const open = proposals.filter((q) => !keptMarks.some((k) => k.photo === q.photo && k.corner === q.corner));
  await writeSheets(h, x, inputsShown, pixels, { candidates, numbered: corners, proposals: open, solution: sol, data: prepared.data, dir: "measured", outline: sol.corners });
  const marksDir = ensureDir(statePath(h, "marks"));
  for (const f of readdirSync(marksDir)) if (f.endsWith(".png")) rmSync(join(marksDir, f));
  for (const [i, p] of h.photos.entries()) {
    const mine = open.filter((q) => q.photo === p.id);
    if (!mine.length) continue;
    const looks = mine.map((q) => ({ x: q.x, y: q.y, corner: q.corner, proposed: true, words: `${p.n}:${cornerName(q.corner)}?` }));
    writeFileSync(join(marksDir, `${nn(p.n)}.png`), await tapStrip(pixels[i], looks, `#${p.n} ${p.file}: corners Scrivn marks - keep only one on its corner ("${p.n}:C#" in keepProposed)`, { half: 110 }));
  }

  // The checks (door heights) as a sanity check, with every tape in. (The review of the measure is written once the hold-outs are in, below.)
  const checks = (inputs.checks ?? []).flatMap((k) => {
    const p = photoOf(h, k.photo);
    if (!p || !k.a || !k.b) return [];
    const got = lineOnPhoto(x, sol, prepared.data, p.id, k.a, k.b);
    return [{ what: k.what ?? "check", photo: p.n, expect: Number(k.feet) || null, got: got?.feet ?? null }];
  });
  // What the sizes estimated on site and held changed: the same corners solved again without them. Checked ones change nothing.
  const estimates = input.buildings[0].estimates ?? [];
  const held = estimates.filter((e) => e.use === "hold");
  const checked = sol.sides.filter((s) => s.estimateCheck);
  const without = held.length ? x.solveRoute({ ...input, buildings: [{ ...input.buildings[0], corners }] }, "main", prepared.data, { ...solveOpts, withoutEstimates: true }) : null;
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

  // The review of the measure: what it disagrees with, Scrivn's marks, photos not placed, tapes the others don't agree with.
  const mDoubts = measureDoubts(x, h, inputs, { sol, corners, proposals: open, hold, decks: placedDecks, sanity, doubtful });
  const mReview = await writeReview(h, mDoubts, pixels, (pn) => marksFor(h, inputsShown, h.photos.find((p) => p.n === pn), { candidates, numbered: corners }), "Measure: what to look at");

  // results.md
  const tapes = input.buildings[0].tapes;
  const md = [];
  md.push(`# ${inputs.house?.name ?? basename(h.dir)}: measured from photos`, "");
  md.push(`${now.slice(0, 16).replace("T", " ")} UTC. Scrivn's photo route (lib/photoRoute*.ts) on this machine, no API.`, "");
  md.push(`- Photos: ${h.photos.length}; placed ${sol.cameras.length} (${sol.cameras.filter((c) => c.placedBy === "stood").length} where you stood). Corner taps ${corners.filter((c) => !c.proposed).length}${keptMarks.length ? ` (${keptMarks.length} of them Scrivn's marks, kept)` : ""}; wall edges tied ${sol.counts.edgePoints}.`);
  md.push(roleWords(sol, solveOpts, fileOf));
  for (const id of sol.tapesOnDetail ?? []) {
    const t = input.buildings[0].tapes.find((q) => q.id === id);
    if (t) md.push(`- Tape ${id} is on #${fileOf(t.photo).n}, a detail photo: it placed that photo and sizes nothing. Put it on a photo showing two corners or more, if one shows it.`);
  }
  md.push(`- Lens: f/W ${rec.focalOverWidth.toFixed(4)}, k ${rec.k.toFixed(4)}; rms ${sol.rms.toFixed(2)} sd.`);
  md.push(`- Tapes: ${(inputs.tapes ?? []).filter((t) => tapeParts[t.id]?.length).map((t) => `${t.id} "${t.said}"`).join("; ") || "none"}.`);
  const saidOf = (list) => (inputs.estimates ?? []).filter((e) => !e.skip && list.some((q) => q.id === String(e.id))).map((e) => `${e.id} "${e.said}" about ${ftin(Number(e.feet))} ±${e.plusMinusPct ?? 20}% on ${e.side}`).join("; ");
  if (held.length) md.push(`- Estimated on site and held (by eye, held loosely, never a tape): ${saidOf(held)}.`);
  if (estimates.length > held.length) md.push(`- Estimated on site to check the measure (by eye, never a tape; the measure is not moved): ${saidOf(estimates.filter((e) => e.use !== "hold"))}.`);
  if (sol.unscaled) md.push(`- **No tape: the sizes follow the shape as drawn${held.length ? " and the sizes estimated on site" : ""} and are not to scale.**`);
  md.push("", "## The outline", "", "| Side | Name | Length | ± | Photos along it |", "|---|---|---|---|---|");
  for (const s of sol.sides) md.push(`| ${sideName(s.from, n)} | ${nameOf(s.from)} | ${ftin(s.lengthFeet)} | ${plusMinusWords(s)} | ${s.photos} |`);
  const xs = sol.corners.map((p) => p.x);
  const ys = sol.corners.map((p) => p.y);
  md.push("", `Across ${ftin(Math.max(...xs) - Math.min(...xs))}, deep ${ftin(Math.max(...ys) - Math.min(...ys))}.`);
  const notMeasured = sol.sides.filter((s) => s.notMeasured);
  if (notMeasured.length) {
    md.push("", "## Not measured", "", "Sizes the photos and tapes don't hold: drawn from the photos to lay the house out, said as NOT measured in the report, never as a size. The one thing that would measure each:", "");
    for (const s of notMeasured) md.push(`- ${sideName(s.from, n)} ${nameOf(s.from)}: about ${ftin(s.lengthFeet)}, ${s.notMeasured.why}. ${s.notMeasured.fix}`);
  }
  if (checked.length) {
    const off = checked.filter((s) => s.estimateCheck.disagrees);
    md.push("", "## Sizes estimated on site, checked", "", `Each against the measure, which they do not move. Off by more than the estimate's ±, one of the two is wrong: tape that side. ${off.length ? `${off.length} of ${checked.length} disagree${off.length === 1 ? "s" : ""}.` : `All ${checked.length} agree.`}`, "", "| Side | Name | Estimated on site | Measured | Off | |", "|---|---|---|---|---|---|");
    for (const s of checked) md.push(`| ${sideName(s.from, n)} | ${nameOf(s.from)} | about ${ftin(s.estimateCheck.feet)} ±${s.estimateCheck.plusMinusPct}% | ${ftin(s.lengthFeet)} ±${s.plusMinusPct}% | ${pct(s.estimateCheck.offPct)} | ${s.estimateCheck.disagrees ? "**disagrees: tape it**" : "agrees"} |`);
  }
  if (without) {
    const wx = without.corners.map((p) => p.x);
    const wy = without.corners.map((p) => p.y);
    md.push("", "## What the estimates changed", "", "The same corners and tapes solved again without the sizes estimated on site.", "", "| Side | Name | Estimated on site | With them | Without them |", "|---|---|---|---|---|");
    for (const s of sol.sides) {
      const w = without.sides[s.from];
      md.push(`| ${sideName(s.from, n)} | ${nameOf(s.from)} | ${s.estimated ? `about ${ftin(s.estimated.feet)} ±${s.estimated.plusMinusPct}%` : "-"} | ${ftin(s.lengthFeet)} ${s.taped ? "taped" : `±${s.plusMinusPct}%`} | ${ftin(w.lengthFeet)} ${w.taped ? "taped" : `±${w.plusMinusPct}%`} |`);
    }
    md.push("", `Without them: across ${ftin(Math.max(...wx) - Math.min(...wx))}, deep ${ftin(Math.max(...wy) - Math.min(...wy))}.`);
  }
  md.push("", "## Accuracy: each tape held out in turn", "");
  if (hold.note) md.push(hold.note);
  else {
    if (keptMarks.length) md.push(`On the session's own corners: the ${keptMarks.length} kept mark${keptMarks.length === 1 ? " was" : "s were"} made with every tape in, so ${keptMarks.length === 1 ? "it is" : "they are"} left out here.`, "");
    md.push("| Tape held out | Taped | Predicted from the rest | Error | How |", "|---|---|---|---|---|");
    for (const r of hold.rows) md.push(`| ${r.id} ${r.said}${r.sizes === false ? " (on a detail photo: checks where that photo was put, sizes nothing)" : ""} | ${ftin(r.taped)} | ${r.predicted !== null ? ftin(r.predicted) : "-"} | ${r.errorPct !== null ? pct(r.errorPct) : "-"} | ${r.each.map((e) => `${e.feet !== null ? ftin(e.feet) : "-"} (${e.where})`).join("; ")}; scaled by ${r.from.join(", ")} |`);
    const errs = hold.rows.filter((r) => r.errorPct !== null && r.sizes !== false).map((r) => Math.abs(r.errorPct));
    if (errs.length) md.push("", `Mean |error| ${(errs.reduce((s, v) => s + v, 0) / errs.length).toFixed(1)}%, worst ${Math.max(...errs).toFixed(1)}%${hold.rows.some((r) => r.sizes === false) ? " (the tapes that size the house)" : ""}.`);
  }
  if (depthNote) md.push("", `**${depthNote}**`);
  if (self) {
    md.push("", "## Self-check: a photo the tapes disagree with", "", self.words);
    if (self.tried.length) md.push("", `Each measure photo left out in turn, the worst disagreement left: ${self.tried.map((q) => `${`#${photoOf(h, q.photo)?.n}`} ${q.worstPct === null ? "too few tapes left" : `${q.worstPct.toFixed(1)}%`}`).join(", ")}.`);
  }
  if (checks.length) {
    md.push("", "## Checks (a sanity check, not a tape: doors and windows vary)", "", "| Check | Photo | Expected | Measured | Off |", "|---|---|---|---|---|");
    for (const k of checks) md.push(`| ${k.what} | #${k.photo} | ${k.expect ? ftin(k.expect) : "-"} | ${k.got !== null ? ftin(k.got) : "not placed"} | ${k.expect && k.got !== null ? pct((k.got / k.expect - 1) * 100) : "-"} |`);
  } else if (hold.note && tapes.length === 1) md.push("", "No checks given: add a door's height on a photo to inputs.json `checks` (a door is usually 6'8\") for a sanity check.");
  md.push("", "## Advice", "");
  for (const a of sol.advice) md.push(`- ${sideName(a.from, n)} ${nameOf(a.from)}: ${a.why}`);
  if (!sol.advice.length) md.push("- None: every side is held well enough.");
  const leftOut = (inputs.leaveOut ?? []).map((ref) => photoOf(h, ref)).filter(Boolean);
  if (deckRun.placed.length) {
    md.push("", "## Decks", "");
    for (const d of deckRun.placed) md.push(`- ${d.deck ? d.words : `${d.name}: not placed`}${d.why.length ? ` (${d.why.join("; ")})` : ""}`);
  }
  if (sanity.length) {
    md.push("", "## Worth a look", "");
    for (const f of sanity) md.push(`- ${f.words}`);
  }
  if (doubtful.length) {
    md.push("", "## Waiting for where you stood", "", 'Each shows one corner or none, and its edges point to more than one place. Say where you stood, in feet on the shape as drawn: "standAt": {"3": [x, y]}, or "3 stood = 1" in fixes.txt for its first guess.', "");
    for (const d of doubtful) md.push(`- #${d.photo}: best guesses ${d.guesses.map((g, i) => `${i + 1}: (${g[0]}, ${g[1]})`).join(", ")}`);
  }
  if (sol.unplaced.length || leftOut.length) {
    md.push("", "## Photos not used", "");
    for (const p of leftOut) md.push(`- #${p.n} ${p.file}: left out by the session (inputs.json leaveOut).`);
    for (const u of sol.unplaced) md.push(`- #${fileOf(u.photo).n} ${fileOf(u.photo).file}: ${u.why}`);
  }
  if (open.length) md.push("", `## Corners Scrivn marks (${open.length}, close up in marks/NN.png)`, "", `${open.map((q) => `${fileOf(q.photo).n}:${cornerName(q.corner)}`).join(", ")}. Each is where the measure puts that corner, so a wrong measure marks it wrong. Look at each close up, list those on their corner in "keepProposed" and measure again.`);
  if (keptMarks.length) md.push("", `Kept marks: ${keptMarks.map((q) => `${fileOf(q.photo).n}:${cornerName(q.corner)}`).join(", ")}.`);
  const timesNow = { measure: (tMeasure - t0) / 1000, holdOuts: (tHold - t1) / 1000 };
  md.push("", "## Files", "", "- plan.png: the measured plan, every placed photo; measured/NN.png: each photo with its corners and where it stood.", `- sides/: ${Object.keys(frames).length} sides squared up for reading (and a grid copy each); frames.json.`, "- measured.json: the exterior as measured (no walls read yet).");
  md.push("", `Machine time: measure ${timesNow.measure.toFixed(1)} s, hold-outs ${timesNow.holdOuts.toFixed(1)} s.`);
  writeFileSync(statePath(h, "results.md"), `${md.join("\n")}\n`);
  writeJson(statePath(h, "results.json"), { at: now, sides: sol.sides.map((s) => ({ side: sideName(s.from, n), name: nameOf(s.from), lengthFeet: s.lengthFeet, plusMinusPct: s.plusMinusPct, taped: s.taped, ...(s.notMeasured ? { notMeasured: s.notMeasured } : {}), ...(s.estimated ? { estimated: s.estimated } : {}), ...(s.estimateCheck ? { estimateCheck: s.estimateCheck } : {}) })), estimateChecks: checked.map((s) => ({ side: sideName(s.from, n), name: nameOf(s.from), lengthFeet: s.lengthFeet, ...s.estimateCheck })), ...(without ? { withoutEstimates: without.sides.map((s) => ({ side: sideName(s.from, n), lengthFeet: s.lengthFeet, plusMinusPct: s.plusMinusPct })) } : {}), holdOuts: hold.rows, holdNote: hold.note, depthNote, selfCheck: self ? { words: self.words, dropped: self.dropped ? { photo: photoOf(h, self.dropped.photo)?.n, worstPct: self.dropped.worstPct, tapes: self.dropped.tapes } : null, before: x.worstPct(self.before), tried: self.tried.map((q) => ({ photo: photoOf(h, q.photo)?.n, worstPct: q.worstPct })) } : null, checks, advice: sol.advice, unplaced: sol.unplaced, doubtful, sanity: sanity.map((f) => ({ kind: f.kind, words: f.words })), stood: sol.cameras.filter((c) => c.placedBy === "stood").length, sizePhotos: solveOpts.sizePhotos ?? "measure", sized: sol.cameras.filter((c) => c.role !== "detail").length, detail: sol.cameras.filter((c) => c.role === "detail").length, tapesOnDetail: sol.tapesOnDetail ?? [], proposals: proposals.map((q) => ({ photo: fileOf(q.photo).n, corner: cornerName(q.corner), x: q.x, y: q.y })), kept: keptMarks.length, lens: { focalOverWidth: rec.focalOverWidth, k: rec.k }, rms: sol.rms, cameras: sol.cameras.length });

  const out = [`Measured from ${sol.cameras.length} of ${h.photos.length} photos and ${tapes.length} tape${tapes.length === 1 ? "" : "s"}; rms ${sol.rms.toFixed(2)}; lens f/W ${rec.focalOverWidth.toFixed(3)}.`, `  ${roleWords(sol, solveOpts, fileOf).replace(/^- /, "")}`];
  for (const s of sol.sides) out.push(`  ${sideName(s.from, n).padEnd(8)} ${nameOf(s.from).slice(0, 28).padEnd(28)} ${ftin(s.lengthFeet).padStart(8)}  ${s.taped ? "taped" : `±${s.plusMinusPct}%`}${s.notMeasured ? "  NOT measured" : ""}${s.estimated ? `  (estimated on site: about ${ftin(s.estimated.feet)}${without ? `; without the estimates ${ftin(without.sides[s.from].lengthFeet)}` : ""})` : ""}${s.estimateCheck ? `  (estimated on site ${estimateCheckWords(s.estimateCheck)})` : ""}`);
  out.push("Each tape held out in turn:");
  if (hold.note) out.push(`  ${hold.note}`);
  for (const r of hold.rows) out.push(`  ${r.id.padEnd(4)} ${r.said.slice(0, 34).padEnd(34)} taped ${ftin(r.taped).padStart(7)}  predicted ${r.predicted !== null ? ftin(r.predicted).padStart(7) : "      -"}  ${r.errorPct !== null ? pct(r.errorPct) : ""}${r.sizes === false ? "  (detail photo: sizes nothing)" : ""}`);
  if (depthNote) out.push(`  ${depthNote}`);
  if (self) out.push(`  Self-check (${checkSeconds.toFixed(0)} s): ${self.words}`);
  for (const s of sol.sides.filter((q) => q.notMeasured)) out.push(`  NOT measured: ${sideName(s.from, n)} ${nameOf(s.from)} (about ${ftin(s.lengthFeet)}): ${s.notMeasured.why}. ${s.notMeasured.fix}`);
  for (const k of checks) out.push(`  check: ${k.what} on #${k.photo}: ${k.got !== null ? ftin(k.got) : "not placed"}${k.expect ? ` (expected ${ftin(k.expect)}${k.got !== null ? `, ${pct((k.got / k.expect - 1) * 100)}` : ""})` : ""}`);
  for (const a of sol.advice) out.push(`  a tape would help: ${sideName(a.from, n)} ${nameOf(a.from)}: ${a.why}`);
  for (const p of (inputs.leaveOut ?? []).map((ref) => photoOf(h, ref)).filter(Boolean)) out.push(`  not used: #${p.n}: left out (leaveOut).`);
  const waiting = new Set(doubtful.map((d) => d.photo));
  for (const u of sol.unplaced) if (!waiting.has(fileOf(u.photo).n)) out.push(`  not used: #${fileOf(u.photo).n}: ${u.why}`);
  for (const d of doubtful) out.push(`  #${d.photo} waits for where you stood; best guesses ${d.guesses.map((g, i) => `${i + 1}: (${g[0]}, ${g[1]})`).join(", ")} (feet on the shape as drawn): "${d.photo} stood = 1" in fixes.txt, or x,y.`);
  for (const f of sanity) out.push(`  worth a look: ${f.words}`);
  if (open.length) out.push(`  Scrivn marks ${open.length} more corners (close up in marks/NN.png): list each on its corner in keepProposed.`);
  for (const d of deckRun.placed) out.push(`  deck: ${d.deck ? d.words : `${d.name}: not placed`}${d.why.length ? ` (${d.why.join("; ")})` : ""}`);
  out.push(`Review: ${mDoubts.length} to look at - review.png${mDoubts.length > 18 ? ` (and ${Math.ceil(mDoubts.length / 18) - 1} more)` : ""}; answer in scrivn/fixes.txt.`, ...mReview.map((l) => `  ${l}`));
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
  const deckRead = p.deck ?? null;
  const ops = next.openings.map((o) => `${o.kind} ${ftin(o.widthFeet)} x ${ftin(o.heightFeet)}${o.trim ? " (trim)" : ""}`).join(", ");
  return { side: next, deckRead, cams, words: `${(next.shapes ?? []).map((s) => s.kind).join("+") || "no cladding"}; eaves ${ftin(next.eaveLeftFeet)} / ${ftin(next.eaveRightFeet)}${next.gable ? `, peak ${ftin(next.gable.peakFeet)}` : ""}; ${ops || "no openings"}${next.columns?.length ? `; ${next.columns.length} column${next.columns.length === 1 ? "" : "s"}` : ""}` };
}

/** A "Check these" row in a line, as the pane words it: what, and why it is asked. */
const checkWords = (c) => (c.kind === "drop" ? `${c.title}: ${c.question}` : `${c.title} - ${c.words}`);

/**
 * A side with its eave over its left and/or right end set (null: as it was), its faces' tops stretched to them: a face
 * read off the photo up to the old eave reaches the new one, in proportion along the side.
 */
function withEaves(side, left, right) {
  const L0 = side.eaveLeftFeet;
  const R0 = side.eaveRightFeet;
  const sl = left !== null && L0 > 0 ? left / L0 : 1;
  const sr = right !== null && R0 > 0 ? right / R0 : 1;
  const at = (xFt) => sl + (sr - sl) * Math.max(0, Math.min(1, xFt / (side.lengthFeet || 1)));
  return {
    ...side,
    eaveLeftFeet: left ?? L0,
    eaveRightFeet: right ?? R0,
    ...(side.shapes ? { shapes: side.shapes.map((sh) => ({ ...sh, polygon: sh.polygon.map((pt) => ({ x: pt.x, y: pt.y * at(pt.x) })) })) } : {}),
  };
}

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
    let side = sideOf(key);
    if (!side) {
      out.push(`  read ${key}: no such side on this shape - left out`);
      continue;
    }
    if (r.skip || !r.wire) continue;
    // A side measure squared no photo of (seen edge-on), read off a view the read step made: that view's photo goes on it.
    if (!side.photos?.length && r.photo) {
      side = { ...side, photos: [r.photo] };
      ext = { ...ext, sides: ext.sides.map((s) => (s.id === side.id ? side : s)) };
    }
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
    // Openings counted off a photo that sees the side edge-on: not measured, and said so (2026-10-22).
    let read = r.notMeasured ? { ...done.side, openings: done.side.openings.map((o) => ({ ...o, notMeasured: String(r.notMeasured) })) } : done.side;
    // The trim's colour as the reader saw it, over the one sampled off a photo (white trim reads grey in the shade).
    if (r.trimColour) read = { ...read, openings: read.openings.map((o) => (o.trim ? { ...o, trim: { ...o.trim, colour: String(r.trimColour) } } : o)), ...(read.columns ? { columns: read.columns.map((c) => ({ ...c, colour: String(r.trimColour) })) } : {}) };
    ext = { ...ext, sides: ext.sides.map((s) => (s.id === read.id ? read : s)) };
    out.push(`  read ${key} ${side.name}: ${done.words}`);
    // A deck in front of it, read off the same photo (the trace's deck words): onto the deck against this side.
    if (done.deckRead && x.decksOf(ext).some((d) => d.sideId === side.id)) {
      const dr = x.withDeckRead(ext, side.id, done.deckRead, done.cams);
      ext = dr.exterior;
      out.push(`  deck read off ${key}: ${dr.words.join("; ") || "on"}`);
    }
  }
  // Walls' heights taped (a level wall's top over the ground): that side's top, and the ends of the sides either side.
  for (const t of inputs.heights ?? []) {
    const i = sideIndex(t.side, n);
    const feet = Number(t.feet);
    if (i === null || !(feet > 0)) {
      out.push(`  height "${t.said ?? t.side}": no side ${t.side} or no length - left out`);
      continue;
    }
    const set = { [sideIds[i]]: [feet, feet], [sideIds[(i - 1 + n) % n]]: [null, feet], [sideIds[(i + 1) % n]]: [feet, null] };
    ext = { ...ext, sides: ext.sides.map((sd) => (sd.id in set ? withEaves(sd, set[sd.id][0], set[sd.id][1]) : sd)) };
    out.push(`  height ${sideName(i, n)} set to ${ftin(feet)} ("${t.said ?? ""}")`);
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
  const scoped = { ...ext, scope: { roofing: true, sides: ext.sides.map((s) => s.id), soffitFascia: true, eavestrough: true, decks: x.decksOf(ext).map((d) => d.id) } };
  const scope = x.exteriorScopeLines(scoped);
  const deckLines = x.decksQuantities(scoped, q.roof).flatMap((dq) => x.deckLines(dq));
  const lineWords = (l) => (typeof l === "string" ? l : [l.description ?? l.label ?? l.text, l.quantity !== undefined ? `${l.quantity} ${l.unit ?? ""}` : ""].filter(Boolean).join(" - "));
  const r = q.roofing;
  const md = [
    `# ${meta.title}: exterior`,
    "",
    `Walls ${q.totals.grossSquareFeet.toFixed(1)} SF gross, ${q.totals.netSquareFeet.toFixed(1)} SF net${q.totals.trimSquareFeet ? `, ${q.totals.trimSquareFeet.toFixed(1)} SF of trim` : ""}; roof ${r ? `${r.squares.toFixed(2)} SQ at ${x.formatPitch(q.pitch.value)} (${q.pitch.source})` : "none"}.`,
    "",
    // Each side's length as the PDF says it: taped, worked out from the photos (±), or estimated on site.
    "## Sides",
    "",
    ...made.sides.map((s) => `- ${s.heading}: ${(s.dims[0] ?? "").split(" · ")[0]}`),
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
    ...(deckLines.length ? ["", "## Decks", "", ...deckLines.map((l) => `- ${l}`)] : []),
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

// ── fix ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every answer at once: the fixes (scrivn/fixes.txt, or [lines]) put into inputs.json, the file kept in fixes-done/, and
 * then check again (or measure, with [then] "measure").
 */
export async function fix(h, lines = [], { then = "check" } = {}) {
  const file = statePath(h, "fixes.txt");
  const text = lines.length ? lines.join("\n") : existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!text.trim()) return ["No fixes: write them in scrivn/fixes.txt, a line each (scripts/house/review.mjs says how), or give them as arguments."];
  const fixes = parseFixes(text);
  const inputs = readJson(statePath(h, "inputs.json"));
  const numbered = readJson(statePath(h, "numbered.json"), []);
  const candidates = readJson(statePath(h, "candidates.json"), { photos: {} }).photos;
  const doubtful = readJson(statePath(h, "results.json"), {}).doubtful ?? [];
  const { inputs: next, said } = applyFixes(h, inputs, fixes, { numbered, candidates, doubtful });
  if (said.some((l) => l.startsWith("✗"))) return [...said, "Nothing changed: put the lines marked ✗ right and run fix again."];
  writeJson(statePath(h, "inputs.json"), next);
  if (!lines.length) {
    const done = ensureDir(statePath(h, "fixes-done"));
    writeFileSync(join(done, `${new Date().toISOString().replace(/[:.]/g, "-")}.txt`), text);
    rmSync(file);
  }
  const after = then === "measure" ? await measure(h) : await check(h);
  return [`Fixed ${fixes.length}: ${said.join("; ")}.`, ...after];
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
