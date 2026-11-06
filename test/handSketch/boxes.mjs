/**
 * The no-AI room finder (lib/handSketchBoxes.ts) on photos of hand-drawn sketches, scored against the rooms a reading
 * of the same photo gave (fixtures/<name>.model.json: corners in a 1050 x 1400 copy of the photo).
 *
 *   node test/handSketch/boxes.mjs <photo folder> [--out <folder>]
 *
 * The folder holds <name>.jpg / .webp / .png for each fixture name; photos are not kept in the repo. With --out, each
 * photo is written with what was found drawn over it (ink in red, strokes in orange, rooms in green).
 */
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const args = process.argv.slice(2);
const folder = args[0];
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : null;
if (!folder) {
  console.log("Usage: node test/handSketch/boxes.mjs <photo folder> [--out <folder>]");
  process.exit(1);
}
if (out) mkdirSync(out, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), "hand-sketch-boxes-"));
const bundle = join(tmp, "boxes.mjs");
await build({ entryPoints: [join(root, "lib", "handSketchBoxes.ts")], bundle: true, format: "esm", platform: "node", outfile: bundle, alias: { "@": root }, logLevel: "error" });
const { findBoxes, inkMask } = await import(pathToFileURL(bundle).href);

/** Share of the two shapes' combined area that both cover, on a coarse grid. */
function iou(a, b, w, h) {
  const step = 4;
  const inside = (p, x, y) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if (p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) c = !c;
    }
    return c;
  };
  let both = 0;
  let either = 0;
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const ia = inside(a, x, y);
      const ib = inside(b, x, y);
      if (ia && ib) both++;
      if (ia || ib) either++;
    }
  return either ? both / either : 0;
}

const inPoly = (p, x, y) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) c = !c;
  }
  return c;
};
/** Share of shape a that lies inside shape b. */
function inside(a, b, w, h) {
  let n = 0;
  let both = 0;
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4)
      if (inPoly(a, x, y)) {
        n++;
        if (inPoly(b, x, y)) both++;
      }
  return n ? both / n : 0;
}
/** Overlap of a with the union of the shapes in list: shared area over combined area. */
function iouUnion(a, list, w, h) {
  let both = 0;
  let either = 0;
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4) {
      const ia = inPoly(a, x, y);
      const ib = list.some((p) => inPoly(p, x, y));
      if (ia && ib) both++;
      if (ia || ib) either++;
    }
  return either ? both / either : 0;
}

let worst = 1;
for (const name of ["spare", "bathroom"]) {
  const file = ["jpg", "jpeg", "webp", "png"].map((e) => join(folder, `${name}.${e}`)).find(existsSync);
  if (!file) {
    console.log(`${name}: no photo in ${folder}`);
    continue;
  }
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
  const t0 = performance.now();
  const found = findBoxes(px);
  const ms = Math.round(performance.now() - t0);
  const model = JSON.parse(readFileSync(join(here, "fixtures", `${name}.model.json`), "utf8"));
  const s = info.width / model.image.width;
  const want = model.wire.rooms.map((r) => ({ name: r.name || r.guess, corners: r.corners.map((c) => ({ x: c.x * s, y: c.y * s })) }));
  const span = Math.max(info.width, info.height);
  console.log(`\n${name}: ${info.width}x${info.height}, ${ms} ms, ${found.strokes.length} strokes, ${found.rooms.length} shapes found`);
  found.rooms.forEach((r, i) => console.log(`  found ${i}: ${r.corners.length} corners ${JSON.stringify(r.corners.map((c) => [c.x, c.y]))}`));
  for (const w of want) {
    // The shapes that are this room once the person has joined the parts that are not rooms (a tub, a vanity) back in:
    // those mostly inside it.
    const parts = found.rooms.map((r, i) => ({ r, i })).filter(({ r }) => inside(r.corners, w.corners, info.width, info.height) >= 0.7);
    const v = parts.length ? iouUnion(w.corners, parts.map((p) => p.r.corners), info.width, info.height) : 0;
    const outline = parts.flatMap((p) => p.r.corners);
    const miss = w.corners.map((c) => (outline.length ? Math.min(...outline.map((g) => Math.hypot(g.x - c.x, g.y - c.y))) : Infinity));
    const far = Math.max(...miss);
    worst = Math.min(worst, v);
    console.log(
      `  ${w.name}: shapes [${parts.map((p) => p.i).join(", ")}] (joins needed: ${Math.max(0, parts.length - 1)}), overlap ${(v * 100).toFixed(1)}%, ` +
        `farthest reading corner from a found one ${far.toFixed(0)} px (${((far / span) * 100).toFixed(1)}% of the photo)`,
    );
  }
  if (out) {
    const { w, h, k, ink } = inkMask(px);
    const maskImg = Buffer.alloc(w * h);
    for (let i = 0; i < w * h; i++) maskImg[i] = ink[i] ? 0 : 255;
    await sharp(maskImg, { raw: { width: w, height: h, channels: 1 } }).png().toFile(join(out, `${name}-ink.png`));
    const dots = [];
    for (let i = 0; i < w * h; i++) if (ink[i]) dots.push(`<rect x="${((i % w) * k).toFixed(0)}" y="${(Math.floor(i / w) * k).toFixed(0)}" width="${k.toFixed(1)}" height="${k.toFixed(1)}" fill="#ef4444" opacity="0.35"/>`);
    const strokes = found.strokes.map((st) => `<line x1="${st.a.x}" y1="${st.a.y}" x2="${st.b.x}" y2="${st.b.y}" stroke="#f97316" stroke-width="4"/>`);
    const rooms = found.rooms.map((r, i) => {
      const pts = r.corners.map((c) => `${c.x},${c.y}`).join(" ");
      const cx = r.corners.reduce((a, c) => a + c.x, 0) / r.corners.length;
      const cy = r.corners.reduce((a, c) => a + c.y, 0) / r.corners.length;
      return `<polygon points="${pts}" fill="#22c55e" fill-opacity="0.18" stroke="#15803d" stroke-width="6"/>${r.corners.map((c) => `<circle cx="${c.x}" cy="${c.y}" r="12" fill="#15803d"/>`).join("")}<text x="${cx}" y="${cy}" font-size="60" fill="#14532d" font-family="sans-serif">${i}</text>`;
    });
    const gr = found.graph.edges.map(([u, v]) => `<line x1="${found.graph.nodes[u].x}" y1="${found.graph.nodes[u].y}" x2="${found.graph.nodes[v].x}" y2="${found.graph.nodes[v].y}" stroke="#2563eb" stroke-width="3"/>`).concat(found.graph.nodes.map((n) => `<circle cx="${n.x}" cy="${n.y}" r="9" fill="#2563eb"/>`));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}">${dots.join("")}${strokes.join("")}${gr.join("")}${rooms.join("")}</svg>`;
    await sharp(file).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 80 }).toFile(join(out, `${name}-boxes.jpg`));
  }
}
console.log(`\nLowest overlap with a reading's room: ${(worst * 100).toFixed(1)}%`);
