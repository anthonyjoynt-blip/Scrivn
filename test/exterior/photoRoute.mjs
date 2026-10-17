/**
 * The photo route on the owner's house (2026-10-16): his 18 photos and 3 tapes, the corners a user
 * taps and the shape drawn rough (fixtures/photo-route/owner-1016.json), through lib/photoRoute*.ts
 * exactly as the browser runs it - lines, lens, levelling, snapping, the plan solve and the wall
 * edges tied across photos. No API and no network.
 *
 *   npm run test:exterior:photos
 *
 * The photos are the owner's own (17 MB), kept out of the repo: they are read from
 * C:/Users/Anthony/Desktop/House Photos, or the folder in PHOTO_ROUTE_PHOTOS. Each is drawn as the app
 * keeps a site photo (lib/photoImage.ts: at most 2,000 px a side, upright).
 *
 * What it shows, beside the proof's own table (photo-route-proof/README.md):
 *   * every side's length and ± with all the tapes;
 *   * the hold-outs: the porch (263") and the rear bump-out (22'2") predicted from the 9' garage doors;
 *   * how many inputs the user made.
 */

import { build } from "esbuild";
import sharp from "sharp";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const lib = (name) => join(root, "lib", name).replace(/\\/g, "/");
const PHOTOS = process.env.PHOTO_ROUTE_PHOTOS ?? "C:/Users/Anthony/Desktop/House Photos";
const FIXTURE = join(here, "fixtures", "photo-route", "owner-1016.json");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "photo-route-"));
  const entry = join(outDir, "entry.ts");
  writeFileSync(entry, ["photoRoute.ts", "photoRouteLens.ts", "photoRouteLines.ts", "photoRouteEdges.ts", "photoRouteSolve.ts", "photoRouteData.ts", "photoRouteExterior.ts", "exteriorPhoto.ts", "exterior.ts", "exteriorTrace.ts", "exteriorReport.ts", "exteriorCheck.ts", "photoRouteCoverage.ts"].map((f) => `export * from "${lib(f)}";`).join("\n"));
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: join(outDir, "entry.mjs"), alias: { "@": root }, logLevel: "silent" });
  const mod = await import(pathToFileURL(join(outDir, "entry.mjs")).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const passed = [];
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed.push(name);
  else failures.push(name);
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `\n      ${detail}` : ""}`);
}

if (!existsSync(PHOTOS)) {
  console.log(`The owner's photos are not at ${PHOTOS}. Set PHOTO_ROUTE_PHOTOS to the folder holding the 18 photos of 2026-10-16.`);
  process.exit(1);
}

const x = await load();
const fx = JSON.parse(readFileSync(FIXTURE, "utf8"));
const t0 = Date.now();

// The photos as the app keeps them, and their grey for the lines.
const pixels = [];
for (const p of fx.photos) {
  const { data, info } = await sharp(join(PHOTOS, p.file)).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== p.width || info.height !== p.height) throw new Error(`${p.file} is ${info.width}x${info.height}, the fixture says ${p.width}x${p.height}`);
  pixels.push({ id: `p${p.n}`, data, width: info.width, height: info.height, channels: info.channels });
}
const input = {
  photos: fx.photos.map((p) => ({ id: `p${p.n}`, width: p.width, height: p.height, focalPrior: null, takenAt: Date.parse(p.takenAt.replace(/^(\d+):(\d+):(\d+) /, "$1-$2-$3T")) })),
  buildings: fx.buildings.map((b) => ({
    id: b.id,
    outline: b.outline.map(([px, py]) => ({ x: px, y: py })),
    corners: b.corners.map((c) => ({ photo: `p${c.photo}`, corner: c.corner, x: c.x, y: c.y, by: "user" })),
    tapes: b.tapes.map((t) => (t.kind === "line" ? { ...t, photo: `p${t.photo}` } : t)),
  })),
};
const lines = pixels.map(x.photoLines);
const measured = x.measureRoute(input, "main", pixels, { lines });
const prepared = measured.prepared;
console.log(`  lines, lens and two solves: ${((Date.now() - t0) / 1000).toFixed(1)} s; f/W ${prepared.level.focalOverWidth.toFixed(4)} (proof 0.6632), k ${measured.firstK.toFixed(4)} from the vanishing points, ${prepared.level.k.toFixed(4)} from the plan solve (proof -0.022)`);
prepared.level.notes.forEach((n, i) => n && console.log(`    ${input.photos[i].id}: ${n}`));

const README = [
  ["Garage front, west bay", 13 + 4 / 12, "2%"],
  ["Bay step", 2, "4%"],
  ["Garage front, east bay", 13.5, "4%"],
  ["East side wall (side yard)", 70 + 7 / 12, "6%"],
  ["Rear bump-out gable", 22 + 2 / 12, "tape"],
  ["Bump-out west side", 5.5, "5%"],
  ["Rear wall", 15.25, "2%"],
  ["Covered-deck side", 9 + 1 / 12, "12%"],
  ["Covered-deck back wall", 11 + 5 / 12, "3%"],
  ["West gable wall", 29 + 2 / 12, "11%"],
  ["Front wall at the porch", 22 + 1 / 12, "3%"],
  ["Keystone wall", 24 + 10 / 12, "3%"],
];
const ftin = (f) => {
  let ft = Math.floor(f);
  let inch = Math.round((f - ft) * 12);
  if (inch === 12) {
    ft++;
    inch = 0;
  }
  return `${ft}'${inch}"`;
};
const t1 = Date.now();
const all = x.solveRoute(input, "main", prepared.data);
console.log(`  lens k in the plan solve: ${all.solution.k.toFixed(4)}`);
console.log(`  solve: ${((Date.now() - t1) / 1000).toFixed(1)} s; ${all.cameras.length} photos placed (${all.cameras.filter((c) => c.placedBy === "one-corner").length} by one corner), ${all.counts.cornerBearings} corner bearings + ${all.counts.edgeBearings} wall-edge bearings on ${all.counts.edgePoints} points; rms ${all.rms.toFixed(2)} sd`);
for (const u of all.unplaced) console.log(`    not placed: ${u.photo}: ${u.why}`);
if (process.env.DEBUG_OBS) {
  const sol = all.solution;
  const ring = all.corners;
  const placed = new Map(all.cameras.map((c) => [c.photo, { quadrant: c.quadrant, at: c.at }]));
  const byId = new Map(prepared.data.map((d) => [d.id, d]));
  const hOf = (id) => all.cameras.find((c) => c.photo === id)?.heightFeet ?? null;
  const obs = x.routeSteps.wallObservations(placed, byId, ring, sol, hOf);
  const bySide = {};
  for (const o of obs) ((bySide[o.side] ??= {})[o.photo] ??= []).push(o);
  for (const [side, per] of Object.entries(bySide)) {
    console.log("side", Number(side) + 1, README[side][0]);
    for (const [ph, list] of Object.entries(per)) console.log("   ", ph, list.sort((a, b) => a.along - b.along).map((o) => o.along.toFixed(2) + (o.polarity > 0 ? "+" : "-") + "[" + o.zLow.toFixed(1) + "," + o.zHigh.toFixed(1) + "]").join(" "));
  }
  console.log("cameras", all.cameras.map((c) => c.photo + ":" + c.at.map((v) => v.toFixed(1)).join(",") + " h" + (c.heightFeet ?? NaN).toFixed(1) + " q" + c.quadrant + " yaw" + c.yawTweakDeg.toFixed(2)).join("  "));
  sol.input.bearings.forEach((bb, i) => { if (/^c\d+$/.test(bb.point) && Math.abs(sol.residuals[i]) > 1.5) console.log("corner residual", bb.camera, "C" + (Number(bb.point.slice(1)) + 1), sol.residuals[i].toFixed(1), "sd"); });
  for (let k = 0; k < 12; k++) { const pts = all.edgePoints.filter((q) => q.side === k); if (pts.length) console.log("tied on side", k + 1, README[k][0], pts.map((q) => q.along.toFixed(2) + "(" + q.photos.join(",") + ")").join(" ")); }
  const SPEC = process.env.SPEC ? JSON.parse(readFileSync(process.env.SPEC, "utf8")) : null;
  if (SPEC) console.log("proof cams", Object.entries(SPEC.answer.cams).map(([n, c]) => "p" + n + ":" + c[0].toFixed(1) + "," + c[1].toFixed(1)).join("  "));
  console.log("edges per photo", prepared.data.map((d) => d.id + ":" + d.edges.length).join(" "));
}
const EXP = process.env.EXP ? JSON.parse(process.env.EXP) : {};
const expOpts = { skipSides: EXP.skipSides, skipTap: EXP.skipTaps ? (t) => EXP.skipTaps.includes(t.photo + ":" + t.corner) : undefined };
const doors = x.solveRoute(input, "main", prepared.data, { withoutTapes: ["porch", "bump-out"], ...expOpts });
const corners = x.solveRoute(input, "main", prepared.data, { wallEdges: false });

console.log("\n  Side                              ours (all tapes)   ±     README   ±     diff    | doors only");
all.sides.forEach((s, i) => {
  const [name, ref, pm] = README[i];
  const d = doors.sides[i];
  console.log(
    `  ${String(i + 1).padStart(2)} ${name.padEnd(30)} ${ftin(s.lengthFeet).padStart(8)} ${(s.taped ? "tape" : `${s.plusMinusPct}%`).padStart(6)}   ${ftin(ref).padStart(7)} ${pm.padStart(5)}  ${(((s.lengthFeet - ref) / ref) * 100).toFixed(1).padStart(5)}%  | ${ftin(d.lengthFeet).padStart(7)} ±${d.plusMinusPct}%`,
  );
});
const porch = doors.sides[10].lengthFeet * 12;
const bump = doors.sides[4].lengthFeet;
console.log(`\n  Hold-outs, scaled from the two 9' garage doors only:`);
console.log(`    porch (front wall at the porch, corner to corner): ${porch.toFixed(1)}" against the tape's 263" (${(((porch - 263) / 263) * 100).toFixed(1)}%); proof +3.0% (270.9")`);
console.log(`    rear bump-out: ${ftin(bump)} against 22'2" (${(((bump - 22.1667) / 22.1667) * 100).toFixed(1)}%); proof -2.4% (21'8")`);
console.log(`    corners alone, no wall edges, all tapes: ${corners.sides.map((s) => s.lengthFeet.toFixed(1)).join(" ")} (rms ${corners.rms.toFixed(2)})`);
console.log(`\n  Advice after the solve:`);
for (const a of all.advice) console.log(`    ${README[a.from][0]}: ${a.why}`);

// How much the answer moves (SENSITIVITY=1): the shape drawn another way, and every tap 6 px off where it was.
if (process.env.SENSITIVITY) {
  const variant = (name, f) => {
    const inp = f(structuredClone(input));
    const s = x.measureRoute(inp, "main", pixels, { lines, solve: { withoutTapes: ["porch", "bump-out"] } }).solution;
    const p = s.sides[10].lengthFeet * 12;
    const bo = s.sides[4].lengthFeet;
    console.log(`  sensitivity, ${name}: porch ${p.toFixed(1)}" (${((p / 263 - 1) * 100).toFixed(1)}%), bump-out ${ftin(bo)} (${((bo / 22.1667 - 1) * 100).toFixed(1)}%), ${s.cameras.length} photos placed`);
  };
  variant("the shape drawn 15% bigger", (inp) => ((inp.buildings[0].outline = inp.buildings[0].outline.map((p) => ({ x: p.x * 1.15, y: p.y * 1.15 }))), inp));
  variant("the shape drawn 10% deeper, 10% narrower", (inp) => ((inp.buildings[0].outline = inp.buildings[0].outline.map((p) => ({ x: p.x * 0.9, y: p.y * 1.1 }))), inp));
  variant("every tap 6 px right", (inp) => ((inp.buildings[0].corners = inp.buildings[0].corners.map((c) => ({ ...c, x: c.x + 6 }))), inp));
  variant("every tap 6 px left", (inp) => ((inp.buildings[0].corners = inp.buildings[0].corners.map((c) => ({ ...c, x: c.x - 6 }))), inp));
}

const b = fx.buildings[0];
const inputs = { outline: b.outline.length, corners: b.corners.length, lineTapes: b.tapes.filter((t) => t.kind === "line").length, sideTapes: b.tapes.filter((t) => t.kind === "side").length };
console.log(`\n  The user's inputs: ${fx.photos.length} photos added; the shape drawn with ${inputs.outline} taps; ${inputs.corners} corner taps on ${new Set(b.corners.map((c) => c.photo)).size} photos; ${inputs.lineTapes} tapes as a line on a photo (a drag and a pick each); ${inputs.sideTapes} typed (a pick and a number each)`);

// The app numbering the corners itself: the same taps with no numbers, numbered as the pane does.
// The user says which corner the leftmost tap on each photo is (one tap on the plan); the app numbers the rest.
const leftmost = new Map();
for (const c of input.buildings[0].corners) if (!leftmost.has(c.photo) || c.x < leftmost.get(c.photo).x) leftmost.set(c.photo, c);
const bare = { ...input, buildings: input.buildings.map((bb) => ({ ...bb, corners: bb.corners.map((c) => (leftmost.get(c.photo) === c ? { photo: c.photo, x: c.x, y: c.y, corner: c.corner, by: "user" } : { photo: c.photo, x: c.x, y: c.y, corner: -1 })) })) };
const numbered = x.measureRoute(bare, "main", pixels, { lines });
const truth = input.buildings[0].corners;
let right = 0;
let asked = 0;
const wrong = [];
numbered.corners.forEach((c, i) => {
  if (c.corner < 0) asked++;
  else if (c.corner === truth[i].corner) right++;
  else wrong.push(`${c.photo} C${truth[i].corner + 1} as C${c.corner + 1}`);
});
const singles = new Set(truth.map((c) => c.photo).filter((p) => truth.filter((c) => c.photo === p).length === 1)).size;
console.log(`\n  The app's own numbers for the ${truth.length} corner taps: ${right} right, ${wrong.length} wrong${wrong.length ? ` (${wrong.join(", ")})` : ""}, ${asked} left to ask (one tap alone on ${singles} photos)`);
console.log(`    measured from the app's numbers (wrong ones not fixed): porch hold-out n/a; sides ${numbered.solution.sides.map((s) => s.lengthFeet.toFixed(1)).join(" ")}`);

// Where it lands: the claim's exterior, each side with its ± and its photos laid on it by the solved cameras.
const state = { format: "scrivn-photo-route/1", ...input, measured: null };
const measuredRec = x.measuredFrom(all, prepared.data, "2026-10-16T13:00:00.000Z");
const ext = x.exteriorFromRoute(undefined, state, measuredRec);
console.log(`\n  The exterior: ${ext ? ext.sides.length : 0} sides, ${ext ? ext.sides.filter((s) => s.photos?.length).length : 0} with photos; source ${ext?.source?.kind}; ${ext?.source?.notes.join(" ")}`);
// Each side photo's to_photo puts the side's ends (at the ground) where its corners were tapped on that photo.
const tapsBy = new Map(input.buildings[0].corners.map((c) => [`${c.photo}:${c.corner}`, c]));
const ring = measuredRec.corners;
const nRing = ring.length;
const frontAt = (() => { let f = -1; for (let i = 0; i < nRing; i++) { const a = ring[i], b = ring[(i + 1) % nRing]; if (!(b.x - a.x > 1e-6 && Math.abs(b.y - a.y) < 1e-6)) continue; if (f < 0 || a.y < ring[f].y - 1e-6 || (Math.abs(a.y - ring[f].y) < 1e-6 && b.x - a.x > ring[(f + 1) % nRing].x - ring[f].x)) f = i; } return f; })();
const errs = [];
ext?.sides.forEach((side, k) => {
  const i = (frontAt + k) % nRing;
  for (const p of side.photos ?? []) {
    for (const [end, corner] of [[0, i], [side.lengthFeet * 0.3048, (i + 1) % nRing]]) {
      const t = tapsBy.get(`${p.claimPhotoId}:${corner}`);
      if (!t) continue;
      const q = x.projectToPhoto(p, end, 0);
      if (q) errs.push(Math.abs(q.x - t.x));
    }
  }
});
errs.sort((a, b) => a - b);
console.log(`  side photos against the corners tapped: ${errs.length} corners, across error median ${errs[Math.floor(errs.length / 2)]?.toFixed(1)} px, worst ${errs[errs.length - 1]?.toFixed(1)} px`);
// Walls per side: each side's photo squared from its solved camera, and read as the AI trace reads it - here from
// the reads a Claude session wrote by looking at the squared photos (fixtures/photo-route/owner-1016-reads.json), no API.
const READS = JSON.parse(readFileSync(join(here, "fixtures", "photo-route", "owner-1016-reads.json"), "utf8"));
const sideIds = ext?.photoRoute?.measured?.sideIds ?? [];
const readOut = {};
for (const [key, r] of Object.entries(READS.sides)) {
  const from = Number(key.split("-")[0].slice(1)) - 1;
  const side = ext?.sides.find((s) => s.id === sideIds[from]);
  if (!side?.photos?.length) {
    readOut[key] = null;
    continue;
  }
  const frame = x.squareFrame(side, side.photos, 1600);
  // The read is in the pixels of the image it was read off; laid on the side as squared now.
  const re = (p) => [x.frameX(frame, x.frameAlongM(r.frame, p[0])), x.frameY(frame, x.frameUpM(r.frame, p[1]))];
  const box = (o) => { const [l, t] = re([o.left, o.top]); const [rr, b] = re([o.right, o.bottom]); return { ...o, left: l, top: t, right: rr, bottom: b }; };
  const wire = {
    ...r.wire,
    materials: r.wire.materials.map((m) => ({ ...m, polygon: m.polygon.map(re) })),
    openings: r.wire.openings.map(box),
    wall_top: r.wire.wall_top.map(re),
    off_wall: r.wire.off_wall.map((o) => { const [a, b] = re([o.box[0], o.box[1]]); const [c, d] = re([o.box[2], o.box[3]]); return { ...o, box: [a, b, c, d] }; }),
  };
  const p = x.traceProposals(wire, frame, side.lengthFeet);
  const picks = { shapes: p.shapes.map((s) => ({ key: s.key, kind: s.kind })), openings: p.openings.map((o) => ({ key: o.key, kind: o.kind })), wallTop: true };
  const next = x.applyTrace(side, p, picks, "2026-10-16T13:00:00.000Z");
  readOut[key] = next;
  const ops = next.openings.map((o) => `${o.kind} ${ftin(o.widthFeet)} x ${ftin(o.heightFeet)}`).join(", ");
  console.log(`  read ${key} (${side.name}): ${next.shapes?.map((s) => s.kind).join("+")}; eave ${ftin(next.eaveLeftFeet)} / ${ftin(next.eaveRightFeet)}${next.gable ? `, peak ${ftin(next.gable.peakFeet)}` : ""}; ${ops}`);
}
const doorsRead = ["C1-C2", "C3-C4"].map((k) => readOut[k]?.openings.find((o) => o.kind === "garage")?.widthFeet).filter((v) => v);
console.log(`  garage doors read off their squared photos: ${doorsRead.map(ftin).join(", ")} (taped 9'0")`);
check("the walls read off the squared photos land on their sides (shapes, openings, wall top)", Object.values(readOut).filter((s) => s && s.shapes?.length && s.openings.length).length >= 3);
check("each garage door read off its squared photo is within 6% of its 9' tape", doorsRead.length === 2 && doorsRead.every((w) => Math.abs(w / 9 - 1) < 0.06), doorsRead.map(ftin).join(", "));
// The report and the roof work from it unchanged: the exterior with the walls read on it.
const withReads = ext ? { ...ext, sides: ext.sides.map((s) => Object.values(readOut).find((r) => r && r.id === s.id) ?? s) } : null;
const report = withReads ? x.exteriorReport(withReads, { title: "The owner's house", date: "Oct 16, 2026", madeWith: "Scrivn" }) : null;
const q = withReads ? x.exteriorQuantities(withReads) : null;
console.log(`  the report: ${report ? `${report.sides.length} sides, ${report.views.length} views; ${report.sides.filter((s) => s.heading.includes("±")).length} sides marked ± to check` : "none"}; the roof: ${q?.roofing ? `${q.roofing.squares.toFixed(1)} SQ` : "none"}`);
// "Check these" (10-16, lib/exteriorCheck.ts): only what the photos couldn't settle. Here the rear wall's three-pane unit,
// read a window with its foot behind the deck's glass railing (the owner: "Its a window not a door").
const checks = withReads && q ? x.exteriorChecks(withReads, q) : [];
console.log(`  check these: ${checks.map((c) => (c.kind === "opening" ? `${c.title} - ${c.words}` : c.question)).join("; ") || "nothing"}`);
check(
  "Check these asks about the rear wall's window behind the deck railing, and no opening the photos settled",
  checks.filter((c) => c.kind === "opening").length === 1 && checks[0].why === "hidden" && checks[0].sideId === sideIds[6] && checks[0].openingKind === "window",
  checks.map((c) => c.title).join(" | "),
);
check(
  "the report's To check names the window the railing hid",
  !!report && report.notes.some((n) => /^Rear 2: a window .*, read off a photo that hid part of it \(deck railing and a planter\)\. Check it is a window\.$/.test(n)),
  report?.notes.join(" | "),
);
check("the report and the roof build from the photo-measured exterior, its ± sides marked", !!report && report.sides.length === 12 && report.sides.some((s) => s.heading.includes("±")) && !!q?.roofing);
check("the measure lands as the claim's exterior, from photos", !!ext && ext.sides.length === 12 && ext.source?.kind === "photos" && ext.sides.filter((s) => s.lengthPlusMinusPct !== undefined).length === 10);
check("each side photo puts the side's ends where its corners were tapped (median within 12 px)", errs.length >= 6 && (errs[Math.floor(errs.length / 2)] ?? 99) < 12);
check("every photo with two or more corners is placed", all.unplaced.every((u) => !/fit the shape/.test(u.why)));
check("the porch hold-out from the doors is within 5%", Math.abs(porch / 263 - 1) < 0.05, `${porch.toFixed(1)}"`);
check("the bump-out hold-out from the doors is within 5%", Math.abs(bump / 22.1667 - 1) < 0.05, ftin(bump));
check("with all tapes, the taped sides come out as taped", Math.abs(all.sides[10].lengthFeet * 12 - 263) < 1 && Math.abs(all.sides[4].lengthFeet - 22.1667) < 0.1);
// ── 10-17: what to take next, and the corners Scrivn marks (lib/photoRouteCoverage.ts, proposeCorners) ──────────────
// The same photos and tapes; what the user does, counted, and what it measures, against today's route and the README.
const HOLD = { withoutTapes: ["porch", "bump-out"] };
const used = [...new Set(b.corners.map((c) => `p${c.photo}`))].filter((id) => input.buildings[0].corners.filter((c) => c.photo === id).length >= 2);
const singlesIds = [...new Set(b.corners.map((c) => `p${c.photo}`))].filter((id) => !used.includes(id));
// Inputs, each tap or keystroke-entry once: the shape (its corners and the tap that closes it); a tape on a photo (its
// drag and its pick, the "Draw a tape" mode once for all); a wall's length (pick the side, type it, add it; the mode once).
const lineTapes = b.tapes.filter((t) => t.kind === "line").length;
const sideTapes = b.tapes.filter((t) => t.kind === "side").length;
const tapeInputs = (withSides) => (lineTapes ? 1 + 2 * lineTapes : 0) + (withSides && sideTapes ? 1 + 3 * sideTapes : 0);
const shapeInputs = b.outline.length + 1;
const beforeFixes = wrong.length;
const before = (withSides) => shapeInputs + b.corners.length + new Set(b.corners.map((c) => c.photo)).size + beforeFixes + tapeInputs(withSides) + 1;

// The flow now, on the photos as he took them: the corners tapped as today, but only on the photos that show two or more
// (a photo with one corner can't be placed - the checklist says so - and today's route places none of them from it); the
// leftmost named, Scrivn numbering the rest, its mistakes put right by the user (each a tap on the shape, counted);
// Measure; then "Looks right" keeps every corner Scrivn marked on the placed photos, and measures again.
const truthOfTap = (c) => input.buildings[0].corners.find((t) => t.photo === c.photo && Math.abs(t.x - c.x) < 1e-6 && Math.abs(t.y - c.y) < 1e-6)?.corner;
const tapsOn = (id) => input.buildings[0].corners.filter((c) => c.photo === id);
const flowInput = (named) => ({
  ...input,
  buildings: input.buildings.map((bb) => ({
    ...bb,
    corners: used.flatMap((id) => {
      const mine = tapsOn(id);
      const left = mine.reduce((a, c) => (c.x < a.x ? c : a));
      return mine.map((c) => (named && c === left ? { photo: c.photo, x: c.x, y: c.y, corner: c.corner, by: "user" } : { photo: c.photo, x: c.x, y: c.y, corner: -1 }));
    }),
  })),
});
/** Numbered as the pane does, then each wrong number put right by the user; then Measure, Looks right, Measure. */
const flow = (inp) => {
  const numbered = x.numberCorners(inp, "main", prepared.data);
  const fixes = numbered.filter((c) => c.corner !== truthOfTap(c)).length;
  const fixed = { ...inp, buildings: inp.buildings.map((bb) => ({ ...bb, corners: numbered.map((c) => (c.corner === truthOfTap(c) ? c : { photo: c.photo, x: c.x, y: c.y, corner: truthOfTap(c), by: "user" })) })) };
  const m1 = x.measureRoute(fixed, "main", pixels, { lines, solve: HOLD });
  const kept = { ...fixed, buildings: fixed.buildings.map((bb) => ({ ...bb, corners: [...m1.corners.filter((c) => !c.proposed), ...m1.proposals.map((c) => ({ photo: c.photo, x: c.x, y: c.y, corner: c.corner, by: "app" }))] })) };
  const m2 = x.measureRoute(kept, "main", pixels, { lines, solve: HOLD });
  return { m1, m2, marks: m1.proposals.length, fixes, right: numbered.length - fixes, taps: numbered.length };
};
const usedTaps = used.reduce((s, id) => s + tapsOn(id).length, 0);
const now = flow(flowInput(true));
const after = (withSides, names, fixes) => shapeInputs + usedTaps + names + fixes + 1 + 1 + tapeInputs(withSides);
console.log(`\n  The flow of 10-17 on his photos as taken: the ${usedTaps} corners tapped on the ${used.length} photos that show two or more, the leftmost named; the ${singlesIds.length} with one corner (${singlesIds.join(", ")}) left alone; ${now.fixes} numbers put right; Measure; Scrivn marked ${now.marks} more corners; Looks right.`);
console.log(`    inputs, the two garage doors as the tapes: before ${before(false)}, now ${after(false, used.length, now.fixes)}; with the porch and bump-out tapes too: before ${before(true)}, now ${after(true, used.length, now.fixes)}`);
console.log(`      (before: shape ${shapeInputs}, ${b.corners.length} corner taps, ${new Set(b.corners.map((c) => c.photo)).size} names, ${beforeFixes} fixes, tapes ${tapeInputs(true)}, Measure 1; now: shape ${shapeInputs}, ${usedTaps} taps, ${used.length} names, ${now.fixes} fixes, Measure 1, Looks right 1, tapes ${tapeInputs(false)} or ${tapeInputs(true)})`);

// The shot list: the same photos as if each had been taken from the checklist for the corner nearest its middle - so it
// names its own, and nobody names any.
const shotInput = flowInput(false);
shotInput.photos = input.photos.map((p) => {
  if (!used.includes(p.id)) return p;
  const d = prepared.data.find((q) => q.id === p.id);
  const mid = tapsOn(p.id).reduce((a, c) => (Math.abs(c.x - d.camera.width / 2) < Math.abs(a.x - d.camera.width / 2) ? c : a));
  return { ...p, shot: { kind: "corner", index: mid.corner } };
});
const shot = flow(shotInput);
console.log(`    the same photos taken from the checklist (each for the corner nearest its middle): ${shot.right} of ${shot.taps} taps numbered right with no name given, ${shot.fixes} put right; inputs ${after(false, 0, shot.fixes)} with the doors as the tapes, ${after(true, 0, shot.fixes)} with all four`);

// Accuracy: the sides against the README, today's route with the doors only, and the flow now.
const pctOff = (sides) => sides.map((s, i) => (README[i][2] === "tape" ? null : Math.abs(s.lengthFeet / README[i][1] - 1) * 100)).filter((v) => v !== null);
const mean = (v) => v.reduce((s, q) => s + q, 0) / v.length;
console.log("\n  Side                              README   today (doors)        now (doors)");
doors.sides.forEach((s, i) => {
  const q = now.m2.solution.sides[i];
  console.log(`  ${String(i + 1).padStart(2)} ${README[i][0].padEnd(30)} ${ftin(README[i][1]).padStart(7)}   ${ftin(s.lengthFeet).padStart(7)} ±${String(s.plusMinusPct).padEnd(3)}  ${ftin(q.lengthFeet).padStart(7)} ±${q.plusMinusPct}`);
});
const porchNow = now.m2.solution.sides[10].lengthFeet * 12;
const bumpNow = now.m2.solution.sides[4].lengthFeet;
console.log(`    hold-outs from the doors: porch ${porch.toFixed(1)}" today, ${porchNow.toFixed(1)}" now (263"); bump-out ${ftin(bump)} today, ${ftin(bumpNow)} now (22'2")`);
console.log(`    mean |off the README| (untaped sides): today ${mean(pctOff(doors.sides)).toFixed(1)}%, now ${mean(pctOff(now.m2.solution.sides)).toFixed(1)}%`);
check("the flow of 10-17: the hold-outs from the doors within 5%", Math.abs(porchNow / 263 - 1) < 0.05 && Math.abs(bumpNow / 22.1667 - 1) < 0.05, `${porchNow.toFixed(1)}", ${ftin(bumpNow)}`);
check("the flow of 10-17: no further off the README on the whole than today", mean(pctOff(now.m2.solution.sides)) <= mean(pctOff(doors.sides)) + 0.5);
check("the flow of 10-17 asks fewer inputs", after(true, used.length, now.fixes) < before(true) && after(false, 0, shot.fixes) < after(false, used.length, now.fixes), `${before(true)} -> ${after(true, used.length, now.fixes)}; from the checklist ${after(true, 0, shot.fixes)}`);
check("photos taken from the checklist name their own corners, nine in ten at least", shot.right >= 0.9 * shot.taps, `${shot.right}/${shot.taps}`);

// What to take next: on all 18, and without the three photos at 45 degrees to a corner (#6, #7, #14).
const coverageOf = (sol, corners) => {
  const rec = x.measuredFrom(sol, prepared.data, "t");
  return x.routeCoverage({ ring: rec.corners, views: x.viewsFromMeasure(rec), taps: corners.filter((c) => !c.proposed), shots: [], measured: true });
};
const fullCov = coverageOf(doors, input.buildings[0].corners);
console.log(`\n  What to take next, all 18 photos (${fullCov.items.length}):`);
fullCov.items.forEach((it) => console.log(`    - ${it.words}`));
const drop = ["p6", "p7", "p14"];
const less = { photos: input.photos.filter((p) => !drop.includes(p.id)), buildings: input.buildings.map((bb) => ({ ...bb, corners: bb.corners.filter((c) => !drop.includes(c.photo)), tapes: bb.tapes.filter((t) => t.kind !== "line" || !drop.includes(t.photo)) })) };
const lessRun = x.measureRoute(less, "main", pixels.filter((p) => !drop.includes(p.id)), { lines: lines.filter((_, i) => !drop.includes(pixels[i].id)), solve: HOLD });
const lessCov = coverageOf(lessRun.solution, lessRun.corners);
console.log(`  Without #6, #7 and #14 (${lessCov.items.length}):`);
lessCov.items.forEach((it) => console.log(`    - ${it.words}`));
const thinNow = lessCov.corners.filter((c, k) => c.photos.length < 2 && fullCov.corners[k].photos.length >= 2).map((c) => c.index);
const wallsLost = lessCov.walls.filter((w, k) => w.both.length === 0 && fullCov.walls[k].both.length > 0).map((w) => w.from);
const named = (kind, k) => lessCov.items.some((it) => it.kind === kind && (kind === "corner-seen" ? it.corner === k : it.wall === k));
console.log(`    corners now thin: ${thinNow.map((k) => k + 1).join(", ")}; walls with no photo of both corners now: ${wallsLost.map((k) => `${k + 1}-${((k + 1) % 12) + 1}`).join(", ")}`);
console.log(`    ± with and without them: ${doors.sides.map((s, i) => `${i + 1}: ${s.plusMinusPct}->${lessRun.solution.sides[i].plusMinusPct}`).join(", ")}`);
check("without the 45-degree photos the checklist names each corner and wall now thin", thinNow.length > 0 && wallsLost.length > 0 && thinNow.every((k) => named("corner-seen", k)) && wallsLost.every((k) => named("wall-both", k)), `corners ${thinNow.map((k) => k + 1)}, walls ${wallsLost}`);
check("and the ± widens on the walls they held", wallsLost.every((k) => (lessRun.solution.sides[k].plusMinusPct ?? 0) > (doors.sides[k].plusMinusPct ?? 0)), wallsLost.map((k) => `${doors.sides[k].plusMinusPct}->${lessRun.solution.sides[k].plusMinusPct}`).join(", "));

console.log(`\n${passed.length} passed, ${failures.length} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(failures.length ? 1 : 0);
