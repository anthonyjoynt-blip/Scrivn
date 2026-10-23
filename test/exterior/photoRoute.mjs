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
  writeFileSync(entry, ["photoRoute.ts", "photoRouteLens.ts", "photoRouteLines.ts", "photoRouteEdges.ts", "photoRouteSolve.ts", "photoRouteData.ts", "photoRouteExterior.ts", "exteriorPhoto.ts", "exterior.ts", "exteriorTrace.ts", "exteriorReport.ts", "exteriorCheck.ts", "photoRouteCoverage.ts", "photoRouteSanity.ts", "photoRouteMatch.ts", "photoRouteCloseUps.ts"].map((f) => `export * from "${lib(f)}";`).join("\n"));
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

// ── 10-20: every photo counts (lib/photoRoute.ts placeByEdges, standAt; lib/photoRouteSanity.ts) ─────────────────────
// Two blind runs of the house runner came out 22-24% short front to back: 8-10 of the 18 photos never placed. Here: the
// 9' garage doors the only tape; which photos are placed, and how deep the house comes out against the truth (70'7");
// then with where he stood for the six one-corner photos (fixtures/photo-route/owner-1016-stood.json, one tap each on
// the shape as drawn); then the blind runs' likely slip - the far corners of the side yard untapped - and what is said.
console.log("\n  Every photo counts (doors only):");
const STOOD = JSON.parse(readFileSync(join(here, "fixtures", "photo-route", "owner-1016-stood.json"), "utf8")).standAt;
const DEPTH = 70 + 7 / 12;
const depthOf = (sol) => {
  const ys = sol.corners.map((p) => p.y);
  return Math.max(...ys) - Math.min(...ys);
};
const sayRun = (name, sol) => {
  const side = sol.sides[3].lengthFeet;
  const depth = depthOf(sol);
  console.log(`    ${name}: ${sol.cameras.length} of ${input.photos.length} placed (${sol.cameras.map((c) => `${c.photo}${c.placedBy === "corners" ? "" : ` ${c.placedBy}`}`).join(", ")}); side-yard wall ${ftin(side)} ±${sol.sides[3].plusMinusPct}% (${((side / DEPTH - 1) * 100).toFixed(1)}%), depth ${ftin(depth)} (${((depth / DEPTH - 1) * 100).toFixed(1)}%) against 70'7"`);
  for (const d of sol.doubtful) console.log(`      ${d.photo} waits for where he stood; best guesses ${d.spots.map((s) => `(${s.at.map((v) => v.toFixed(0)).join(", ")})`).join(" ")}`);
  return { side, depth };
};
const sanityOf = (sol, inp) => {
  const st = { format: "scrivn-photo-route/1", ...inp, measured: null };
  const e = x.exteriorFromRoute(undefined, st, x.measuredFrom(sol, prepared.data, "2026-10-20T13:00:00.000Z"));
  return e ? x.routeSanity(e) : [];
};
const tStood = Date.now();
const plain = sayRun("his taps, no stand spots", doors);
const stoodInput = { ...input, photos: input.photos.map((p) => (STOOD[p.id.slice(1)] ? { ...p, standAt: STOOD[p.id.slice(1)] } : p)) };
const stood = x.measureRoute(stoodInput, "main", pixels, { lines, solve: HOLD }).solution;
const withStood = sayRun("and where he stood for the six one-corner photos", stood);
// The blind runs' likely slip: corner 5 not tapped on #14, nor corner 4 on #11 - the far ends of the side yard.
const blindInput = { ...input, buildings: input.buildings.map((bb) => ({ ...bb, corners: bb.corners.filter((c) => !((c.photo === "p14" && c.corner === 4) || (c.photo === "p11" && c.corner === 3))) })) };
const blind = x.measureRoute(blindInput, "main", pixels, { lines, solve: HOLD }).solution;
const blindRun = sayRun("the side yard's far corners untapped (corner 5 on #14, 4 on #11)", blind);
const blindFlags = sanityOf(blind, blindInput);
const hisFlags = sanityOf(doors, input);
console.log(`    worth a look, his taps: ${hisFlags.map((f) => f.words).join(" | ") || "nothing"}`);
console.log(`    worth a look, far corners untapped: ${blindFlags.map((f) => f.words).join(" | ") || "nothing"}`);
console.log(`    (${((Date.now() - tStood) / 1000).toFixed(0)} s)`);
check("doors only, the depth and the side-yard wall within 3% of 70'7\"", Math.abs(plain.depth / DEPTH - 1) < 0.03 && Math.abs(plain.side / DEPTH - 1) < 0.03, `${ftin(plain.depth)}, ${ftin(plain.side)}`);
check("no one-corner photo is placed by itself - each waits for where he stood, named", doors.cameras.every((c) => c.placedBy === "corners" || c.placedBy === "stood") && singlesIds.every((id) => doors.unplaced.some((u) => u.photo === id && /Tap where you stood for it on the plan/.test(u.why))), doors.unplaced.map((u) => u.photo).join(", "));
check("where he stood places all six one-corner photos", Object.keys(STOOD).every((n) => stood.cameras.some((c) => c.photo === `p${n}` && c.placedBy === "stood")), stood.cameras.map((c) => `${c.photo} ${c.placedBy}`).join(", "));
check("with them, the depth and the side-yard wall still within 3%", Math.abs(withStood.depth / DEPTH - 1) < 0.03 && Math.abs(withStood.side / DEPTH - 1) < 0.03, `${ftin(withStood.depth)}, ${ftin(withStood.side)}`);
check("with them, the porch and bump-out hold-outs still within 5%", Math.abs((stood.sides[10].lengthFeet * 12) / 263 - 1) < 0.05 && Math.abs(stood.sides[4].lengthFeet / 22.1667 - 1) < 0.05, `${(stood.sides[10].lengthFeet * 12).toFixed(1)}", ${ftin(stood.sides[4].lengthFeet)}`);
check(
  "with the side yard's far corners untapped, the loose depth is said on that wall, with the tape that fixes it - and nothing is stopped",
  blindFlags.some((f) => f.kind === "depth" && f.side === 3),
  `${ftin(blindRun.depth)}; ${blindFlags.map((f) => f.kind).join(", ")}`,
);
// Where the user stood moves nothing Scrivn works out before it (2026-10-20, the runner's taps, numbered as the pane
// numbers them): not the lens, nor the numbers it gives the corners left unnumbered. With #3 stood, the shape those were
// numbered on once moved enough to call the garage photo's far corner the bay step's, and the house came out 65% big.
const bareStood = { ...bare, photos: bare.photos.map((p) => (STOOD[p.id.slice(1)] ? { ...p, standAt: STOOD[p.id.slice(1)] } : p)) };
const bareRun = x.measureRoute(bare, "main", pixels, { lines, solve: HOLD });
const bareStoodRun = x.measureRoute(bareStood, "main", pixels, { lines, solve: HOLD });
const numsOf = (r) => r.corners.filter((c) => !c.proposed).map((c) => `${c.photo}:${c.corner}`).join(" ");
const frontOf = (s) => [0, 2].map((i) => s.sides[i].lengthFeet);
console.log(`    the corners numbered by Scrivn, where he stood or not: lens ${bareRun.prepared.level.k.toFixed(4)} / ${bareStoodRun.prepared.level.k.toFixed(4)}; garage bays ${frontOf(bareRun.solution).map(ftin).join(", ")} / ${frontOf(bareStoodRun.solution).map(ftin).join(", ")}; depth ${ftin(depthOf(bareRun.solution))} / ${ftin(depthOf(bareStoodRun.solution))}; ${bareStoodRun.solution.cameras.length} placed`);
check("where he stood moves neither the lens nor the numbers Scrivn gives the corners", numsOf(bareRun) === numsOf(bareStoodRun) && bareRun.prepared.level.k === bareStoodRun.prepared.level.k, `${numsOf(bareRun)}\n      ${numsOf(bareStoodRun)}`);
// (Its own numbers are wrong here either way - #15's far corner called the bay step's, the bays read twice their size -
// which is the shot list's and Looks right's to put right; what is checked is that where he stood changes none of it.)
check("and the garage bays move under 2% for it", frontOf(bareRun.solution).every((v, i) => Math.abs(frontOf(bareStoodRun.solution)[i] / v - 1) < 0.02), `${frontOf(bareRun.solution).map(ftin).join(", ")} -> ${frontOf(bareStoodRun.solution).map(ftin).join(", ")}`);
check("his own measure: each flag names a photo, corner or wall", hisFlags.every((f) => /photo \d+|corner \d+|wall/i.test(f.words)), hisFlags.map((f) => f.words).join(" | "));

// ── 10-21: sizes estimated on site (lib/photoRoute.ts RouteEstimate) ─────────────────────────────────────────────────
// "The bump-out sticks out about 7'": held ("use": "hold"), a side held loosely to what someone at the house judged by eye,
// never a tape. Doors only, as above: an estimate 17% over his 6'0" bump-out side; one 19% under on the side-yard wall the
// photos hold.
console.log("\n  Sizes estimated on site, held (doors only):");
const withEstimates = (list) => ({ ...input, buildings: input.buildings.map((bb) => ({ ...bb, estimates: list })) });
const bumpEst = x.solveRoute(withEstimates([{ id: "e1", from: 5, feet: 7, plusMinusPct: 20, use: "hold" }]), "main", prepared.data, HOLD);
const yardEst = x.solveRoute(withEstimates([{ id: "e1", from: 3, feet: 57, plusMinusPct: 20, use: "hold" }]), "main", prepared.data, HOLD);
const tapedEst = x.solveRoute(withEstimates([{ id: "e1", from: 4, feet: 26, plusMinusPct: 20, use: "hold" }]), "main", prepared.data);
const sB = bumpEst.sides[5];
console.log(`    bump-out side, about 7': ${ftin(doors.sides[5].lengthFeet)} ±${doors.sides[5].plusMinusPct}% -> ${ftin(sB.lengthFeet)} ±${sB.plusMinusPct}%; the rest moved at most ${Math.max(...bumpEst.sides.map((s, i) => (i === 5 ? 0 : Math.abs(s.lengthFeet / doors.sides[i].lengthFeet - 1) * 100))).toFixed(1)}%`);
console.log(`    side-yard wall, about 57': ${ftin(doors.sides[3].lengthFeet)} ±${doors.sides[3].plusMinusPct}% -> ${ftin(yardEst.sides[3].lengthFeet)} ±${yardEst.sides[3].plusMinusPct}%`);
check(
  "an estimate holds its side loosely: never taped, still with a ±, said as estimated, and pulled toward it",
  !sB.taped && sB.plusMinusPct !== null && sB.estimated?.feet === 7 && Math.abs(sB.lengthFeet - 7) <= Math.abs(doors.sides[5].lengthFeet - 7) + 1e-6 && bumpEst.unscaled === false,
  `${ftin(doors.sides[5].lengthFeet)} -> ${ftin(sB.lengthFeet)}, ${JSON.stringify(sB.estimated)}`,
);
// Not "the photos outweigh it": here they hold the side-yard wall to ±17% though it is right to 0.1%, and a guess 19% short
// drags it most of the way (70'6" -> 60'3", 2026-10-21). An estimate helps only where the photos are further out than it is.
check(
  "an estimate lands between what the photos say and the guess, never past the guess",
  [[yardEst.sides[3], doors.sides[3], 57], [sB, doors.sides[5], 7]].every(([s, d, g]) => (s.lengthFeet - d.lengthFeet) * (s.lengthFeet - g) <= 1e-6),
  `${ftin(doors.sides[3].lengthFeet)} -> ${ftin(yardEst.sides[3].lengthFeet)} (about 57'); ${ftin(doors.sides[5].lengthFeet)} -> ${ftin(sB.lengthFeet)} (about 7')`,
);
check("a tape on the same side stands: the estimate is not used", tapedEst.sides[4].taped && !tapedEst.sides[4].estimated && Math.abs(tapedEst.sides[4].lengthFeet - all.sides[4].lengthFeet) < 0.01, `${ftin(tapedEst.sides[4].lengthFeet)}`);
const estExt = x.exteriorFromRoute(undefined, { format: "scrivn-photo-route/1", ...withEstimates([{ id: "e1", from: 5, feet: 7, plusMinusPct: 20, use: "hold" }]), measured: null }, x.measuredFrom(bumpEst, prepared.data, "2026-10-21T13:00:00.000Z"));
const estSideId = estExt?.photoRoute?.measured?.sideIds?.[5];
const estSide = estExt?.sides.find((s) => s.id === estSideId);
const estReport = estExt ? JSON.stringify(x.exteriorReport(estExt, { title: "The owner's house", date: "Oct 21, 2026", madeWith: "Scrivn" })) : "";
check(
  "the exterior keeps it as estimated on site, and the report says so beside that side and in its notes",
  estSide?.lengthEstimatedFeet === 7 && estSide.lengthPlusMinusPct !== undefined && /estimated on site at about 7'/.test(estReport) && /1 side estimated on site/.test(estExt.source.notes.join(" ")),
  `${estSide?.name}: ${estSide?.lengthEstimatedFeet}; ${estExt?.source.notes.join(" ")}`,
);

// ── 10-21: sizes estimated on site, checked (RouteEstimate use "check", the default) ───────────────────────────────────
// Held, a wrong guess drags a side the photos had right (above). Checked, the measure is left exactly as it is and a side
// further from what was said than its ± is named, with a tape asked for. The same four wrong guesses as held on 10-21 (each
// 15-20% off the truth), two right ones, and one on a taped side. Doors only.
console.log("\n  Sizes estimated on site, checked (doors only):");
const CHECKS = [
  { id: "c1", from: 3, feet: 57, plusMinusPct: 20, said: "side-yard wall about 57' (true 70'7\")" },
  { id: "c2", from: 8, feet: 13.5, plusMinusPct: 20, use: "check", said: "covered-deck back wall about 13'6\" (true 11'5\")" },
  { id: "c3", from: 9, feet: 24, plusMinusPct: 20, said: "west gable about 24' (true 29'2\")" },
  { id: "c4", from: 5, feet: 7, plusMinusPct: 20, said: "bump-out side about 7' (true 6'0\")" },
];
const checkInput = withEstimates(CHECKS.map(({ said: _s, ...e }) => e));
const checked = x.solveRoute(checkInput, "main", prepared.data, HOLD);
const checkFlags = sanityOf(checked, checkInput);
for (const c of CHECKS) {
  const s = checked.sides[c.from];
  console.log(`    ${c.said}: measured ${ftin(s.lengthFeet)} ±${s.plusMinusPct}%, ${s.estimateCheck.offPct >= 0 ? "+" : ""}${s.estimateCheck.offPct}% off it: ${s.estimateCheck.disagrees ? "DISAGREES" : "agrees"}`);
}
for (const f of checkFlags.filter((q) => q.kind === "estimate")) console.log(`    worth a look: ${f.words}`);
const sameAs = (a, b) => a.sides.every((s, i) => s.lengthFeet === b.sides[i].lengthFeet && s.plusMinusPct === b.sides[i].plusMinusPct) && a.corners.every((p, k) => p.x === b.corners[k].x && p.y === b.corners[k].y) && a.rms === b.rms;
check("checked (the default, said or not), the measure is exactly as with no estimates: every side, its ±, every corner", sameAs(checked, doors) && checked.sides.every((s) => !s.estimated), checked.sides.map((s) => ftin(s.lengthFeet)).join(" "));
const yardCheck = checked.sides[3].estimateCheck;
const yardFlag = checkFlags.find((f) => f.kind === "estimate" && f.side === 3);
// A false alarm: the photos have this wall right to 0.1%; the flag asks for the tape that shows the guess was wrong.
check(
  "a wrong \"about 57'\" on the side-yard wall the photos have right (70'6\") disagrees: worth a look names the wall, both lengths and the tape",
  yardCheck?.disagrees === true && Math.abs(yardCheck.offPct - (checked.sides[3].lengthFeet / 57 - 1) * 100) < 0.06 && /^The \S.* wall was estimated on site/.test(yardFlag?.words ?? "") && /about 57'/.test(yardFlag?.words ?? "") && yardFlag?.words.includes(ftin(checked.sides[3].lengthFeet).replace(/'0"$/, "'")) && /Tape it/.test(yardFlag?.words ?? ""),
  yardFlag?.words ?? JSON.stringify(yardCheck),
);
check(
  "and the advice asks for that tape, saying why",
  checked.advice.some((a) => a.from === 3 && /estimated on site at about 57'/.test(a.why) && /Tape it to see which is right/.test(a.why)),
  checked.advice.find((a) => a.from === 3)?.why,
);
check(
  "a guess within its ± of the measure agrees: no flag, nothing added to the advice",
  [8, 9].every((i) => checked.sides[i].estimateCheck && !checked.sides[i].estimateCheck.disagrees && !checkFlags.some((f) => f.kind === "estimate" && f.side === i) && !checked.advice.some((a) => a.from === i && /estimated on site/.test(a.why))),
  [8, 9].map((i) => `${ftin(checked.sides[i].lengthFeet)} vs about ${ftin(checked.sides[i].estimateCheck?.feet ?? 0)}: ${checked.sides[i].estimateCheck?.offPct}%`).join("; "),
);
const rightGuess = x.solveRoute(withEstimates([{ id: "r1", from: 3, feet: 70, plusMinusPct: 20 }, { id: "r2", from: 5, feet: 6, plusMinusPct: 20 }]), "main", prepared.data, HOLD);
check("right guesses (about 70', about 6') agree", rightGuess.sides[3].estimateCheck?.disagrees === false && rightGuess.sides[5].estimateCheck?.disagrees === false, `${rightGuess.sides[3].estimateCheck?.offPct}%, ${rightGuess.sides[5].estimateCheck?.offPct}%`);
const checkedTaped = x.solveRoute(withEstimates([{ id: "t1", from: 4, feet: 26, plusMinusPct: 20 }]), "main", prepared.data);
check("a check on a taped side is not made: the tape stands", checkedTaped.sides[4].taped && !checkedTaped.sides[4].estimateCheck && !sanityOf(checkedTaped, withEstimates([{ id: "t1", from: 4, feet: 26, plusMinusPct: 20 }])).some((f) => f.kind === "estimate"));
const checkExt = x.exteriorFromRoute(undefined, { format: "scrivn-photo-route/1", ...checkInput, measured: null }, x.measuredFrom(checked, prepared.data, "2026-10-21T13:00:00.000Z"));
// What the report says (its sides, notes, sources), not the exterior it carries, whose measure keeps the advice.
const checkReport = checkExt ? JSON.stringify({ ...x.exteriorReport(checkExt, { title: "The owner's house", date: "Oct 21, 2026", madeWith: "Scrivn" }), exterior: null }) : "";
check(
  "a checked size is not put on the exterior or in the report as \"estimated on site\": the measure is the photos' alone",
  checkExt && checkExt.sides.every((s) => s.lengthEstimatedFeet === undefined) && !/estimated on site/.test(checkReport) && !/estimated on site/.test(checkExt.source.notes.join(" ")) && checkExt.photoRoute.measured.sides[3].estimateCheck?.disagrees === true,
  checkExt ? `${checkExt.sides.filter((s) => s.lengthEstimatedFeet !== undefined).length} sides estimated; report: ${checkReport.match(/.{80}estimated on site.{80}/g)?.join(" | ") ?? "-"}; notes: ${checkExt.source.notes.join(" ")}; kept: ${JSON.stringify(checkExt.photoRoute.measured.sides[3].estimateCheck)}` : "no exterior",
);


// ── 10-23: a close-up laid exactly on its wall's full photo (lib/photoRouteMatch.ts) ───────────────────────────────────
// A wall is flat: one homography takes the close-up's pixels to the full photo's, found in code (each squared from its
// levelling, the scale and shift searched, made exact on patches that agree) or from 4 taps. Laid so, what the close-up
// shows is read at the wall's scale; it sizes nothing.
console.log("\n  Close-ups laid on their wall's full photo:");
{
  const tMatch = Date.now();
  const H0 = [1.3, 0.05, 40, -0.02, 1.25, -15, 0.0001, -0.00005, 1];
  const through = (h, [px, py]) => {
    const w = h[6] * px + h[7] * py + h[8];
    return [(h[0] * px + h[1] * py + h[2]) / w, (h[3] * px + h[4] * py + h[5]) / w];
  };
  const src = [
    [100, 120],
    [900, 80],
    [880, 700],
    [140, 760],
  ];
  const four = x.homographyFrom(
    src,
    src.map((q) => through(H0, q)),
  );
  check("the homography from 4 points is the one they came from", four && four.every((v, i) => Math.abs(v - H0[i]) < 1e-6 * Math.max(1, Math.abs(H0[i]))), JSON.stringify(four?.map((v) => +v.toPrecision(6))));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.6;
  const many = Array.from({ length: 30 }, (_, i) => [60 + ((i * 397) % 900), 50 + ((i * 211) % 700)]);
  const fitted = x.homographyFrom(
    many,
    many.map((q) => through(H0, q).map((v) => v + rnd())),
  );
  const rms = Math.sqrt(many.reduce((a, q) => a + Math.hypot(...through(fitted, q).map((v, k) => v - through(H0, q)[k])) ** 2, 0) / many.length);
  check("from 30 points off by up to 0.3 px, least squares lands within half a pixel", rms < 0.5, `${rms.toFixed(3)} px rms`);
  check(
    "four points in a line fix none",
    x.homographyFrom(
      [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ],
    ) === null,
  );
  // The taps: as taken, the lens's radial term on both; the match is between straight-camera pixels.
  const camA = { width: 1600, height: 1200, k: -0.02 };
  const camB = { width: 2000, height: 1500, k: -0.02 };
  const tapsAB = src.concat([[500, 500]]).map((q) => {
    const d = x.distort(camA, q[0], q[1]);
    const f = x.distort(camB, ...through(H0, q));
    return [d[0], d[1], f[0], f[1]];
  });
  const byTaps = x.matchFromTaps(tapsAB, camA, camB);
  check("4 or more points tapped on both photos, the lens taken off each, give the plane between them", byTaps && byTaps.by === "taps" && byTaps.rmsPx < 1e-6 && byTaps.h.every((v, i) => Math.abs(v - H0[i]) < 1e-6 * Math.max(1, Math.abs(H0[i]))), byTaps ? `${byTaps.rmsPx.toExponential(1)} px` : "none");
  check("fewer than 4 taps: no match", x.matchFromTaps(tapsAB.slice(0, 3), camA, camB) === null);
  // Laid on a side: through the full photo's own to_photo, a line drawn on the close-up is on the wall as long as the same
  // line drawn on the full photo. A close-up 2.5x nearer, straight on, of the middle of the side's first photo.
  const sideWith = ext?.sides.find((sd) => sd.photos?.length);
  const fullSp = sideWith?.photos[0];
  const camF = fullSp ? { width: fullSp.camera.width, height: fullSp.camera.height, k: fullSp.camera.k ?? 0 } : null;
  const zoomIn = fullSp ? [0.4, 0, fullSp.camera.width * 0.3, 0, 0.4, fullSp.camera.height * 0.3, 0, 0, 1] : null;
  const closeSp = fullSp ? x.detailSidePhoto(fullSp, { h: zoomIn }, { width: 2000, height: 1500, k: 0 }, 950, "close", sideWith.lengthFeet * 0.3048) : null;
  const onFull = (q) => x.distort(camF, ...through(zoomIn, q));
  const lineClose = closeSp ? x.wallLine(closeSp, [400, 900], [1700, 880]) : null;
  const lineFull = fullSp ? x.wallLine(fullSp, onFull([400, 900]), onFull([1700, 880])) : null;
  check(
    "a line on a close-up laid on a side is as long on the wall as the same line on the side's full photo",
    lineClose && lineFull && Math.abs(lineClose.feet - lineFull.feet) < 1e-6 && Math.abs(lineClose.from[0] - lineFull.from[0]) < 1e-6,
    lineClose && lineFull ? `${lineClose.feet.toFixed(4)}' and ${lineFull.feet.toFixed(4)}'` : "none",
  );
  const chk = closeSp && lineFull ? x.checkOnWall(closeSp, [400, 900], [1700, 880], lineFull.feet * 1.08) : null;
  check(
    "a tape 8% off what the wall makes it is worth a look (over 5%); one 2% off agrees",
    chk && !chk.agrees && Math.abs(chk.offPct + 7.41) < 0.05 && x.checkOnWall(closeSp, [400, 900], [1700, 880], lineFull.feet * 1.02)?.agrees === true,
    chk ? `${chk.offPct.toFixed(2)}%` : "none",
  );
  // His photos: #10, the rear bump-out from close and to its left, on #9, the same wall from further back and to its right.
  // Hand-read corners of its two windows' white surrounds on both, at 10x (the upper window's top two and bottom right;
  // the basement slider's top two - its bottom ones are behind stones and a shrub).
  const D = prepared.data.find((q) => q.id === "p10");
  const F = prepared.data.find((q) => q.id === "p9");
  const real = x.matchDetail({ gray: D.gray, camera: D.camera }, { gray: F.gray, camera: F.camera });
  const HAND = [
    { d: [565.8, 493.3], f: [633.0, 487.8] },
    { d: [834.8, 505.2], f: [829.5, 444.5] },
    { d: [846.5, 664.8], f: [832.2, 620.8] },
    { d: [256.3, 940.8], f: [487.5, 842.0] },
    { d: [604.8, 909.8], f: [651.5, 847.0] },
  ];
  const off = real.match
    ? HAND.map(({ d, f }) => {
        const u = x.undistort(D.camera, d[0], d[1]);
        const q = x.distort(F.camera, ...through(real.match.h, u));
        return Math.hypot(q[0] - f[0], q[1] - f[1]);
      })
    : [];
  console.log(`    #10 on #9: ${real.words} Hand-read corners off by ${off.map((v) => v.toFixed(1)).join(", ")} px.`);
  check("his close-up of the bump-out is laid on his other photo of it in code: 8 points or more agree, and its window corners land within 5 px of where they are", !!real.match && real.match.inliers >= 8 && off.length === HAND.length && Math.max(...off) < 5, real.words);
  const G = prepared.data.find((q) => q.id === "p15");
  const wrong = x.matchDetail({ gray: D.gray, camera: D.camera }, { gray: G.gray, camera: G.camera });
  check("laid on a photo of another wall (the garage front), it finds no place", wrong.match === null, wrong.words);
  // Through the app's path (2026-10-23): kept on the measure, the close-up is one more photo of the wall its points are on -
  // found among all of them, no walk to say - and its window corners land on that wall where #9's own photo puts them.
  if (real.match) {
    const withMatch = { ...measuredRec, matches: [x.routeMatch({ photo: "p10", full: "p9" }, real.match, real.words, measuredRec.k)] };
    const laid = x.closeUpsOnSides(state, withMatch).laid[0];
    const again = ext ? x.exteriorFromRoute(ext, ext.photoRoute, withMatch) : null;
    const side = laid && again ? again.sides.find((sd) => sd.id === again.photoRoute.measured.sideIds[laid.side]) : null;
    const rc9 = measuredRec.cameras.find((c) => c.photo === "p9");
    const view9 = laid && rc9 ? x.sideView(measuredRec, rc9, laid.side, 909) : null;
    const apart = laid && view9
      ? HAND.map(({ d, f }) => {
          const a = x.onWall(laid.sp, d[0], d[1]);
          const q = x.onWall(view9.sp, f[0], f[1]);
          return a && q ? (Math.hypot(a[0] - q[0], a[1] - q[1]) / 0.3048) * 12 : Infinity;
        })
      : [];
    console.log(`    #10 laid on side ${laid ? laid.side + 1 : "-"} (${laid ? README[laid.side][0] : "not laid"}); its window corners on the wall ${apart.map((v) => v.toFixed(1)).join(", ")}" from #9's`);
    check(
      "laid through the measure, his close-up is one more photo of the rear bump-out, and its window corners are within 2\" of #9's on that wall",
      laid?.side === 4 && !!side?.photos?.some((p) => p.claimPhotoId === "p10") && apart.length === HAND.length && Math.max(...apart) < 2,
      laid ? `side ${laid.side + 1}, ${side?.photos?.map((p) => p.claimPhotoId).join(", ")}` : JSON.stringify(x.closeUpsOnSides(state, withMatch).not),
    );
  }
  console.log(`    (${((Date.now() - tMatch) / 1000).toFixed(1)} s)`);
}

console.log(`\n${passed.length} passed, ${failures.length} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(failures.length ? 1 : 0);
