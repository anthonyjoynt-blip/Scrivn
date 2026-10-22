/**
 * The house runner's reading pass (2026-10-22): `run.mjs <folder> read`, after measure. A blind test on the owner's 7-photo
 * house (house G) read every side off EVERY photo that shows it, not the one squared photo `measure` makes, and found what
 * the first pass missed: the openings on a side seen edge-on, the AC side's basement window, the deck's door and slider, the
 * garage roof lower with its own gable, the bump-out's eave level with the main one, the deck filling the corner.
 *
 *   read      each side squared from every placed photo that sees it (Scrivn's own sidePhotoFor + squareUp), one sheet a
 *             side in scrivn/read/ with a grid, the side's ends and ground and a foot ruler, the stretches the house hides
 *             hatched red; and scrivn/read.txt, the checklist to answer in scrivn/reading.json.
 *             With scrivn/reading.json there, its answers go in: reads.json (each side's openings and wall, laid on the
 *             squared photo `report` reads them from), roof.json (the roof check's answers), and inputs.json's decks.
 *             Then `report`.
 *
 * reading.json (every part optional; feet; "along" from the side's left end as you face it from outside):
 *
 *   "groundBySide": {"C2-C3": {"mainFloorFt": 5.5, "slabFt": 0}, ...}   the main floor's and the garage slab's height over
 *                    that side's ground (its squared photo's ground line), so heights read off the floor go on the wall
 *   "sides": {"C2-C3": {
 *     "openings": [{"kind": "window" | "door" | "patio_door" | "garage_door", "offsetFt": 0.5, "widthFt": 6, "heightFt": 5.5,
 *                   "sillFt": 7.5 | "sillAboveMainFloorFt": 2 | "sillAboveGarageSlabFt": 0, "photos": [3, 4],
 *                   "partlyHiddenBy": "deck railing"}],
 *     "wallTopFt": [[0, 13.8], [10.6, 18.3], [21.3, 13.8]],   the wall's top over its ground, along it (else the eave)
 *     "cladding": "stucco", "over": "gable" | "eave" | "hip_end"}}
 *   "roof": {"main": {"eaveAboveMainFloorFt": 8.3}, ...}        the reader's notes; the eave sets walls with no wallTopFt
 *   "roofAnswers": {...}                                         roof.json's own form, merged over it (pitch, wings, drops...)
 *   "decks": [...]                                               inputs.json's deck form (scripts/house/decks.mjs), in place of its decks
 *
 * The reader's own file from house G (blind-runs/house-g-reading/reading.json) is this form, with groundBySide, wallTopFt and
 * roofAnswers added by the session. Nothing here calls an API.
 */
import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { scrivn } from "./code.mjs";
import { loadPixels, readJson, statePath, writeJson } from "./folder.mjs";
import { griddedSide } from "./sheets.mjs";
import { wireOf } from "./finishReads.mjs";
import { ftin, sideName } from "./words.mjs";

const FOOT_M = 0.3048;
const STEPS = 60;
const KIND = { window: "window", door: "door", patio_door: "patio", patio: "patio", garage_door: "garage", garage: "garage", rollup: "rollup" };

/** Whether the line from camera C to P on the plan crosses a side of [ring] other than [side]. */
function crosses(ring, C, P, side) {
  const n = ring.length;
  for (let j = 0; j < n; j++) {
    if (j === side) continue;
    const a = ring[j];
    const b = ring[(j + 1) % n];
    const d1x = P.x - C.x;
    const d1y = P.y - C.y;
    const d2x = b.x - a.x;
    const d2y = b.y - a.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - C.x) * d2y - (a.y - C.y) * d2x) / den;
    const s = ((a.x - C.x) * d1y - (a.y - C.y) * d1x) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && s > 1e-6 && s < 1 - 1e-6) return true;
  }
  return false;
}

/** Side [i] squared from each placed photo that sees any of it: the views, best face-on first. */
async function sideViews(x, m, pixelsOf, nOf, i) {
  const ring = m.corners;
  const n = ring.length;
  const A = ring[i];
  const B = ring[(i + 1) % n];
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  const nrm = { x: (B.y - A.y) / L, y: -(B.x - A.x) / L };
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const views = [];
  for (const rc of m.cameras) {
    const lens = m.lenses[rc.photo];
    const pn = nOf(rc.photo);
    const v = { x: rc.at[0] - mid.x, y: rc.at[1] - mid.y };
    const facing = (v.x * nrm.x + v.y * nrm.y) / (Math.hypot(v.x, v.y) || 1);
    if (!lens || facing <= 0.02) continue;
    // Which stretches of the side it sees: in front of it there, nothing of the house in the way.
    const C = { x: rc.at[0], y: rc.at[1] };
    const vis = [];
    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS;
      const P = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
      vis.push((C.x - P.x) * nrm.x + (C.y - P.y) * nrm.y > 0 && !crosses(ring, C, P, i));
    }
    const seen = vis.filter(Boolean).length / vis.length;
    if (seen === 0) continue;
    let sp = x.sidePhotoFor(lens, rc, A, B, 900 + pn - 1, rc.photo);
    if (!sp) {
      // Its middle out of the picture: laid on the part it sees, then shifted back to the side's own frame.
      const ks = vis.map((b, k) => (b ? k : -1)).filter((k) => k >= 0);
      const t0 = ks[0] / STEPS;
      const t1 = ks[ks.length - 1] / STEPS;
      const A2 = { x: A.x + (B.x - A.x) * t0, y: A.y + (B.y - A.y) * t0 };
      const B2 = { x: A.x + (B.x - A.x) * t1, y: A.y + (B.y - A.y) * t1 };
      const sp2 = t1 > t0 ? x.sidePhotoFor(lens, rc, A2, B2, 900 + pn - 1, rc.photo) : null;
      if (sp2) sp = x.photoOnPart(sp2, -t0 * L, 0, L, (t1 - t0) * L);
    }
    if (!sp) continue;
    const cov = x.photoCoverageM(sp);
    if (!cov) continue;
    const Lm = L * FOOT_M;
    const alongMin = Math.max(cov.alongMin, -0.6);
    const alongMax = Math.min(cov.alongMax, Lm + 0.6);
    const upMin = Math.max(cov.upMin, -1);
    const upMax = Math.min(cov.upMax, 7.5);
    if (!(alongMax - alongMin > 0.3 && upMax - upMin > 0.3)) continue;
    const ppm = 1400 / Math.max(alongMax - alongMin, upMax - upMin);
    const frame = { alongMinM: alongMin, alongMaxM: alongMax, upMinM: upMin, upMaxM: upMax, ppm, width: Math.round((alongMax - alongMin) * ppm), height: Math.round((upMax - upMin) * ppm) };
    const rgba = x.squareUp([{ photo: sp, pixels: await pixelsOf(rc.photo) }], frame);
    const png = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer();
    let grid = await griddedSide(png, frame, L, x);
    let hatch = "";
    for (let k = 0; k < STEPS; k++) {
      if (vis[k] && vis[k + 1]) continue;
      const x0 = x.frameX(frame, (k / STEPS) * Lm);
      const x1 = x.frameX(frame, ((k + 1) / STEPS) * Lm);
      hatch += `<rect x="${x0.toFixed(1)}" y="0" width="${(x1 - x0).toFixed(1)}" height="${frame.height}" fill="rgba(255,0,0,0.2)"/>`;
    }
    if (hatch) grid = await sharp(grid).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}">${hatch}</svg>`), left: 0, top: 0 }]).png().toBuffer();
    const p0 = x.projectToPhoto(sp, Lm / 2, 0.5);
    const p1 = x.projectToPhoto(sp, Lm / 2 + FOOT_M, 0.5);
    views.push({ sidePhoto: sp, photo: pn, angleDeg: Math.round((Math.acos(Math.min(1, facing)) * 180) / Math.PI), seen, pxPerFt: p0 && p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : null, frame, grid });
  }
  return { lengthFeet: L, views: views.sort((a, b) => a.angleDeg - b.angleDeg) };
}

/** A side's views stacked into one sheet, each under its own line of words. */
async function sideSheet(title, views) {
  const W = Math.max(...views.map((v) => v.frame.width));
  const HEAD = 34;
  const parts = [];
  let top = 0;
  const head = (text) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEAD}"><rect width="100%" height="100%" fill="#101316"/><text x="10" y="23" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="#ffffff">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`);
  parts.push({ input: head(title), left: 0, top });
  top += HEAD;
  for (const v of views) {
    parts.push({ input: head(`photo ${v.photo}: ${v.angleDeg}° off face-on, ${Math.round(v.seen * 100)}% of the side in view${v.pxPerFt ? `, ${v.pxPerFt.toFixed(0)} px a foot in the photo` : ""}`), left: 0, top });
    top += HEAD;
    parts.push({ input: v.grid, left: 0, top });
    top += v.frame.height + 8;
  }
  return sharp({ create: { width: W, height: top, channels: 3, background: "#101316" } }).composite(parts).png({ compressionLevel: 9 }).toBuffer();
}

/** One side read: its openings and wall in feet, as finishReads' walls, for wireOf. */
function wallsOf(key, r, reading) {
  const g = reading.groundBySide?.[key] ?? {};
  const mf = Number(g.mainFloorFt) || 0;
  const slab = Number(g.slabFt) || 0;
  const sillOf = (o) => (Number.isFinite(o.sillFt) ? o.sillFt : Number.isFinite(o.sillAboveGarageSlabFt) ? o.sillAboveGarageSlabFt + slab : Number.isFinite(o.sillAboveMainFloorFt) ? o.sillAboveMainFloorFt + mf : 0);
  const openings = (r.openings ?? [])
    .filter((o) => KIND[o.kind] && o.widthFt > 0 && o.heightFt > 0)
    .map((o) => ({ kind: KIND[o.kind], fromLeftFeet: Number(o.offsetFt) || 0, widthFeet: Number(o.widthFt), heightFeet: Number(o.heightFt), sillFeet: sillOf(o), ...(o.partlyHiddenBy ? { hiddenBy: String(o.partlyHiddenBy) } : {}) }));
  return { openings, mf, eave: Number(reading.roof?.main?.eaveAboveMainFloorFt) };
}

/** reading.json's answers into reads.json, roof.json and inputs.json's decks. Returns the lines to say. */
async function applyReading(x, h, reading, sheets) {
  const out = [];
  const frames = readJson(statePath(h, "sides", "frames.json"), { sides: {} }).sides;
  const n = readJson(statePath(h, "measured.json")).photoRoute.measured.sideIds.length;
  const reads = { format: "scrivn-house-runner-reads/1", about: "Each side's walls in the AI trace's wire format (lib/exteriorTrace.ts TraceWire), in the pixels of its squared photo (frame). From scrivn/reading.json by run.mjs read: openings and wall in feet laid on the frame.", sides: {} };
  for (const [key, r] of Object.entries(reading.sides ?? {})) {
    // Its squared photo from measure; or, for a side measure squares none of (seen edge-on), its best view here, the
    // photo carried with the read so report can put it on the side.
    const best = sheets.find((q) => q.key === key)?.views[0];
    const fr = frames[key] ?? (best ? { frame: best.frame, lengthFeet: sheets.find((q) => q.key === key).lengthFeet, side: sheets.find((q) => q.key === key).name, photo: best.sidePhoto } : null);
    if (!fr) {
      out.push(`  ${key}: no photo shows it - not read on`);
      continue;
    }
    const { openings, mf, eave } = wallsOf(key, r, reading);
    const L = fr.lengthFeet;
    const top = Array.isArray(r.wallTopFt) && r.wallTopFt.length >= 2 ? r.wallTopFt.map(([a, u]) => ({ x: Number(a), y: Number(u) })) : Number.isFinite(eave) ? [{ x: 0, y: mf + eave }, { x: L, y: mf + eave }] : null;
    const shapes = top ? [{ kind: r.cladding ?? "stucco", polygon: [{ x: top[0].x, y: 0 }, ...top, { x: top[top.length - 1].x, y: 0 }] }] : [];
    const wire = wireOf(x, { openings, shapes, columns: [] }, r.over ? { over: r.over === "hip_end" ? "hip" : r.over } : null, fr.frame, 1);
    wire.notes = `Read from every photo of it (run.mjs read, reading.json)${r.readability ? `: ${r.readability}` : ""}.`;
    reads.sides[key] = { frame: fr.frame, wire, ...(fr.photo ? { photo: fr.photo } : {}) };
    out.push(`  ${key} ${fr.side ?? ""}: ${openings.length} opening${openings.length === 1 ? "" : "s"} (${["window", "door", "patio", "garage"].map((k) => [k, openings.filter((o) => o.kind === k).length]).filter(([, c]) => c).map(([k, c]) => `${c} ${k}`).join(", ") || "none"})${top ? `, wall top ${top.map((p) => ftin(p.y)).join(" / ")}` : ""}`);
  }
  const readsFile = statePath(h, "reads.json");
  if (existsSync(readsFile)) writeJson(statePath(h, "reads-before-read.json"), readJson(readsFile));
  writeJson(readsFile, reads);
  out.push(`reads.json: ${Object.keys(reads.sides).length} of ${n} sides${existsSync(statePath(h, "reads-before-read.json")) ? " (the one before kept as reads-before-read.json)" : ""}.`);
  if (reading.roofAnswers) {
    const roofFile = statePath(h, "roof.json");
    const before = readJson(roofFile, {});
    const merged = { ...before, ...reading.roofAnswers };
    for (const k of ["wings", "notches", "ends", "drops", "overhangs"]) if (before[k] || reading.roofAnswers[k]) merged[k] = { ...(before[k] ?? {}), ...(reading.roofAnswers[k] ?? {}) };
    writeJson(roofFile, merged);
    out.push(`roof.json: ${Object.keys(reading.roofAnswers).join(", ")} from the reading.`);
  }
  if (Array.isArray(reading.decks) && reading.decks.length && reading.decks.every((d) => d.side)) {
    const inputs = readJson(statePath(h, "inputs.json"));
    writeJson(statePath(h, "inputs.json"), { ...inputs, decks: reading.decks });
    out.push(`inputs.json: ${reading.decks.length} deck${reading.decks.length === 1 ? "" : "s"} from the reading - measure again to place ${reading.decks.length === 1 ? "it" : "them"}.`);
  }
  return out;
}

/** The checklist for reading every side off every photo, written to read.txt. */
function checklist(ext, sheets, h) {
  const m = ext.photoRoute.measured;
  const n = m.sideIds.length;
  const q = [];
  q.push("Reading checklist (run.mjs read). Look at each sheet in scrivn/read/ and answer in scrivn/reading.json (its form is at the top of scripts/house/read.mjs); then run read again and report.");
  q.push("");
  for (const s of sheets) q.push(`${s.key} ${s.name}, ${ftin(s.lengthFeet)}: ${s.views.length ? `photos ${s.views.map((v) => `${v.photo} (${v.angleDeg}°)`).join(", ")}` : "NO PHOTO SEES IT"} - read/${s.file}`);
  q.push("");
  q.push("Each side:");
  q.push("  [ ] every window, door, patio door and garage door: kind, offset from its left end, width, height, sill (over the floor or the slab, and say which), the photos it is on, what hides part of it");
  q.push("  [ ] its wall top: the eave at each end, a gable's peak and where along; the cladding");
  q.push("  [ ] the ground: where each photo's squared ground line sits (grade, a deck, a porch floor) - groundBySide");
  q.push("");
  q.push("The roof, part by part (the main roof, and each wing, bump-out, porch or garage roof):");
  q.push("  [ ] its eave lower than the main one? by how much (roofAnswers.drops)");
  q.push("  [ ] an upper gable over it, or a hip (roofAnswers.ends)");
  q.push("  [ ] its ridge carried through, or dropped below the main one (roofAnswers.wings: tie | lower | gable)");
  q.push("  [ ] its pitch, off a gable seen face-on");
  q.push("");
  q.push("Porch and decks:");
  q.push("  [ ] the porch: depth, floor height, steps, posts, rail (roofAnswers.additions)");
  q.push("  [ ] each deck: the wall it is against, how far out, its height, whether it fills a corner (runs into the notch beside it), rails, stairs, screens, posts");
  q.push("");
  q.push("Photo by photo - anything seen but not placed (a door edge-on, a window behind a rail, a vent, a meter):");
  for (const p of h.photos) {
    const placed = m.cameras.some((c) => c.photo === p.id);
    q.push(`  [ ] #${p.n} ${p.file}${placed ? "" : " (not placed: its views are not in the sheets)"}`);
  }
  void n;
  return q.join("\n");
}

export async function read(h) {
  const t0 = Date.now();
  const x = await scrivn();
  const measuredFile = statePath(h, "measured.json");
  if (!existsSync(measuredFile)) throw new Error("No measured.json: run measure first.");
  const ext = readJson(measuredFile);
  const m = ext.photoRoute.measured;
  const n = m.sideIds.length;
  const pixels = await loadPixels(h, x);
  const pixelsOf = async (id) => pixels[h.photos.findIndex((p) => p.id === id)];
  const nOf = (id) => h.photos.find((p) => p.id === id)?.n;
  const dir = statePath(h, "read");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".png")) rmSync(join(dir, f));
  const sheets = [];
  const index = {};
  for (let i = 0; i < n; i++) {
    const key = sideName(i, n);
    const side = ext.sides.find((s) => s.id === m.sideIds[i]);
    const { lengthFeet, views } = await sideViews(x, m, pixelsOf, nOf, i);
    const file = `${key} ${(side?.name ?? "").replace(/[^\w ()-]+/g, "")}.png`.replace(/ +\.png$/, ".png");
    if (views.length) writeFileSync(join(dir, file), await sideSheet(`${key} ${side?.name ?? ""} - ${ftin(lengthFeet)}, from every photo that shows it`, views));
    sheets.push({ key, name: side?.name ?? "", lengthFeet, views, file });
    index[key] = { name: side?.name ?? "", lengthFeet, views: views.map((v) => ({ photo: v.photo, angleDeg: v.angleDeg, seen: Math.round(v.seen * 100) / 100, pxPerFt: v.pxPerFt && Math.round(v.pxPerFt * 10) / 10, frame: v.frame })) };
  }
  writeJson(join(dir, "views.json"), { about: "Each side squared from every placed photo that sees it (run.mjs read): its frame per photo, best face-on first.", sides: index });
  writeFileSync(statePath(h, "read.txt"), `${checklist(ext, sheets, h)}\n`);
  const out = [
    `Read sheets: ${sheets.filter((s) => s.views.length).length} sides in ${relative(h.dir, dir)}/, ${sheets.reduce((s2, s) => s2 + s.views.length, 0)} views from ${new Set(sheets.flatMap((s) => s.views.map((v) => v.photo))).size} photos.`,
    ...sheets.map((s) => `  ${s.key} ${s.name}: ${s.views.length ? s.views.map((v) => `#${v.photo} ${v.angleDeg}°`).join(", ") : "no photo sees it"}`),
    `Checklist: ${relative(h.dir, statePath(h, "read.txt"))}.`,
  ];
  const readingFile = statePath(h, "reading.json");
  if (existsSync(readingFile)) {
    out.push(`Applying ${relative(h.dir, readingFile)}:`);
    out.push(...(await applyReading(x, h, readJson(readingFile), sheets)));
    out.push("Next: run report (or measure first, if the decks changed).");
  } else out.push(`Next: answer it in ${relative(h.dir, readingFile)}, then read again.`);
  out.push(`Machine time: ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  return out;
}
