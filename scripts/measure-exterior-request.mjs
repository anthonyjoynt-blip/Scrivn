/**
 * Measuring a house a tester sent us, on this machine, with the photo route's own code (lib/photoRoute*.ts, as
 * the browser runs it) - no API, nothing sent anywhere. The step between pulling a request and returning it.
 *
 *   node scripts/measure-exterior-request.mjs 3f9a [--reads reads.json]
 *
 * Reads exterior-requests/<id>/request.json and the photos beside it (scripts/pull-exterior-request.mjs put them
 * there). Its `route` is the tester's input as they left it: the shape drawn, the corners tapped on each photo, the
 * tapes. Where that is short - no shape, too few corners, a corner numbered wrong - a Claude session reading the
 * photos fills it in, in request.json, the way test/exterior/fixtures/photo-route/owner-1016.json was made (see
 * send-to-team-handover.md), and this is run again.
 *
 * Writes, beside them:
 *   exterior.json       the measured exterior, as the photo route lands it in a claim - what the return script sends
 *   squared/*.png       each side's photo squared up face-on, for reading the walls by eye; squared/frames.json says
 *                       which pixels are where
 * With --reads, the walls read off those squared photos (the AI trace's wire format, written by a session looking at
 * them - test/exterior/fixtures/photo-route/owner-1016-reads.json is one) are put on their sides, as the trace's
 * "Use these" would.
 */
import { build } from "esbuild";
import sharp from "sharp";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FOLDER, ROOT, short } from "./exterior-request-common.mjs";

async function routeCode() {
  const outDir = mkdtempSync(join(tmpdir(), "measure-request-"));
  const entry = join(outDir, "entry.ts");
  const lib = (f) => join(ROOT, "lib", f).replace(/\\/g, "/");
  writeFileSync(entry, ["photoRoute.ts", "photoRouteData.ts", "photoRouteExterior.ts", "exteriorPhoto.ts", "exteriorTrace.ts", "exteriorRequests.ts"].map((f) => `export * from "${lib(f)}";`).join("\n"));
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: join(outDir, "entry.mjs"), alias: { "@": ROOT }, logLevel: "silent" });
  const mod = await import(pathToFileURL(join(outDir, "entry.mjs")).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

/** The folder of a request: its id or the start of it, among those pulled; or a folder named outright. */
export function requestFolder(arg, dir = join(ROOT, FOLDER)) {
  if (existsSync(join(arg, "request.json"))) return resolve(arg);
  const hits = existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith(String(arg).toLowerCase())) : [];
  if (hits.length !== 1) throw new Error(hits.length ? `${hits.length} pulled requests start ${arg}: give more of the id.` : `No pulled request starts ${arg}. Pull it first: node scripts/pull-exterior-request.mjs ${arg}`);
  return join(dir, hits[0]);
}

const ftin = (f) => {
  let ft = Math.floor(f);
  let inch = Math.round((f - ft) * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return `${ft}'${inch}"`;
};

/** Measures the request in [folder]; writes exterior.json and the squared photos. Returns what it found, for the console and the tests. */
export async function measureFolder(folder, { reads = null, now = new Date(), squared = true } = {}) {
  const x = await routeCode();
  const doc = JSON.parse(readFileSync(join(folder, "request.json"), "utf8"));
  const route = doc.route;
  const main = route?.buildings?.find((b) => b.id === "main");
  if (!route || !main) throw new Error("request.json has no route to measure: give it the shape and the corners (see send-to-team-handover.md).");
  if ((main.outline ?? []).length < 4) throw new Error("No shape drawn: put the house's outline in route.buildings[0].outline, corners in order round it, rough sizes in feet.");
  const fileOf = new Map(doc.photos.map((p) => [p.id, p.file]));

  const pixels = [];
  for (const p of route.photos) {
    const file = fileOf.get(p.id);
    if (!file || !existsSync(join(folder, file))) continue;
    const { data, info } = await sharp(join(folder, file)).rotate().raw().toBuffer({ resolveWithObject: true });
    pixels.push({ id: p.id, data, width: info.width, height: info.height, channels: info.channels });
  }
  const have = new Set(pixels.map((p) => p.id));
  const input = {
    photos: route.photos.filter((p) => have.has(p.id)).map((p) => {
      const px = pixels.find((q) => q.id === p.id);
      return { ...p, width: px.width, height: px.height };
    }),
    buildings: route.buildings,
  };
  const tapped = new Set(main.corners.filter((c) => have.has(c.photo)).map((c) => c.photo));
  if (tapped.size < 2) throw new Error("Too few corners tapped: two photos at least need two corners each (route.buildings[0].corners).");

  const { prepared, solution, corners } = x.measureRoute(input, "main", pixels);
  const m = x.measuredFrom(solution, prepared.data, now.toISOString());
  const state = { ...route, format: x.PHOTO_ROUTE_FORMAT, buildings: route.buildings.map((b) => (b.id === "main" ? { ...b, corners } : b)), measured: null };
  let ext = x.exteriorFromRoute(undefined, state, m);
  if (!ext) throw new Error("The corners as numbered do not make the shape drawn: check the numbers on each photo (route.buildings[0].corners[].corner).");

  // Each side's photo squared up face-on, to read the walls off by eye.
  const n = m.corners.length;
  const sideIds = ext.photoRoute?.measured?.sideIds ?? [];
  const keyOf = (i) => `C${i + 1}-C${((i + 1) % n) + 1}`;
  const frames = {};
  const squaredDir = join(folder, "squared");
  if (squared) {
    mkdirSync(squaredDir, { recursive: true });
    for (let i = 0; i < n; i++) {
      const side = ext.sides.find((s) => s.id === sideIds[i]);
      if (!side?.photos?.length) continue;
      const frame = x.squareFrame(side, side.photos, 1600);
      if (!frame) continue;
      const sources = side.photos.map((photo) => ({ photo, pixels: pixels.find((p) => p.id === photo.claimPhotoId) })).filter((s) => s.pixels);
      if (!sources.length) continue;
      const rgba = x.squareUp(sources, frame);
      const name = `${keyOf(i)} ${side.name.replace(/[^A-Za-z0-9 ]/g, "")}.png`;
      await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toFile(join(squaredDir, name));
      frames[keyOf(i)] = { file: name, side: side.name, sideId: side.id, photo: fileOf.get(side.photos[0].claimPhotoId) ?? side.photos[0].claimPhotoId, frame };
    }
    writeFileSync(join(squaredDir, "frames.json"), JSON.stringify({ about: "Each side's squared photo: the pixels of its PNG are the frame's. A read of the walls (the AI trace's wire format) is in those pixels.", sides: frames }, null, 2));
  }

  // The walls read off the squared photos, put on their sides as the trace's "Use these" does.
  const applied = [];
  if (reads) {
    for (const [key, r] of Object.entries(reads.sides ?? {})) {
      const i = Number(key.split("-")[0].slice(1)) - 1;
      const side = ext.sides.find((s) => s.id === sideIds[i]);
      if (!side?.photos?.length) {
        applied.push(`${key}: no photo on that side now, not read`);
        continue;
      }
      const frame = x.squareFrame(side, side.photos, 1600);
      const was = r.frame ?? frames[key]?.frame;
      if (!frame || !was) continue;
      const re = (p) => [x.frameX(frame, x.frameAlongM(was, p[0])), x.frameY(frame, x.frameUpM(was, p[1]))];
      const box = (o) => {
        const [l, t] = re([o.left, o.top]);
        const [rr, b] = re([o.right, o.bottom]);
        return { ...o, left: l, top: t, right: rr, bottom: b };
      };
      const wire = {
        ...r.wire,
        materials: (r.wire.materials ?? []).map((mm) => ({ ...mm, polygon: mm.polygon.map(re) })),
        openings: (r.wire.openings ?? []).map(box),
        wall_top: (r.wire.wall_top ?? []).map(re),
        off_wall: (r.wire.off_wall ?? []).map((o) => {
          const [a, b] = re([o.box[0], o.box[1]]);
          const [c, d] = re([o.box[2], o.box[3]]);
          return { ...o, box: [a, b, c, d] };
        }),
      };
      const p = x.traceProposals(wire, frame, side.lengthFeet);
      const picks = { shapes: p.shapes.map((s) => ({ key: s.key, kind: s.kind })), openings: p.openings.map((o) => ({ key: o.key, kind: o.kind })), wallTop: true };
      const next = x.applyTrace(side, p, picks, now.toISOString());
      ext = { ...ext, sides: ext.sides.map((s) => (s.id === next.id ? next : s)) };
      applied.push(`${key} ${side.name}: ${next.openings.map((o) => `${o.kind} ${ftin(o.widthFeet)} x ${ftin(o.heightFeet)}`).join(", ") || "no openings"}`);
    }
  }

  const checked = x.checkTeamResult(ext);
  if (!checked.ok) throw new Error(`Measured, but it would not open in a claim: ${checked.error}`);
  writeFileSync(join(folder, "exterior.json"), JSON.stringify(ext, null, 1));
  const name = (from) => ext.sides.find((s) => s.id === sideIds[from])?.name ?? `Side ${from + 1}`;
  return {
    exterior: ext,
    lines: [
      `Measured from ${m.cameras.length} of ${route.photos.length} photos and ${main.tapes.length} tape${main.tapes.length === 1 ? "" : "s"}; rms ${m.rms.toFixed(2)}; lens f/W ${m.focalOverWidth.toFixed(3)}.`,
      ...m.sides.map((s) => `  ${keyOf(s.from).padEnd(8)} ${name(s.from).padEnd(14)} ${ftin(s.lengthFeet).padStart(8)}  ${s.taped ? "taped" : `±${s.plusMinusPct}%`}`),
      ...m.advice.map((a) => `  a tape would help: ${name(a.from)}: ${a.why}`),
      ...m.unplaced.map((u) => `  not used: ${fileOf.get(u.photo) ?? u.photo}: ${u.why}`),
      ...applied.map((a) => `  walls read: ${a}`),
    ],
    frames,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--reads");
  const readsFile = at >= 0 ? args[at + 1] : null;
  const id = args.filter((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1))[0];
  try {
    if (!id) throw new Error("node scripts/measure-exterior-request.mjs <id> [--reads reads.json]");
    const folder = requestFolder(id);
    const reads = readsFile ? JSON.parse(readFileSync(readsFile, "utf8")) : null;
    const done = await measureFolder(folder, { reads });
    console.log(done.lines.join("\n"));
    console.log(`\nWrote ${relative(ROOT, join(folder, "exterior.json"))}${Object.keys(done.frames).length ? ` and ${Object.keys(done.frames).length} squared photos in ${relative(ROOT, join(folder, "squared"))}` : ""}.`);
    console.log(`Return it: node scripts/return-exterior-request.mjs ${short(folder.split(/[\\/]/).pop())} ${relative(ROOT, join(folder, "exterior.json")).replace(/\\/g, "/")}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
