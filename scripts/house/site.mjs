/**
 * One customer report for a site measured house by house with the runner (scripts/house/run.mjs): the house and its
 * other buildings, each from its own folder's scrivn/exterior.json (the report step's), as one claim - Scrivn's own
 * siteReport and exteriorReportBytes, each building's side photos from its own folder. No API.
 *
 *   node scripts/house/site.mjs <out.pdf> <house folder> [<building folder>:<name> ...]
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scrivn } from "./code.mjs";
import { openHouse, readJson, statePath } from "./folder.mjs";

/** The side photos a report wants, as the PDF takes them: each building's from its own folder, keyed by the report's photo numbers. */
async function photosFor(x, h, made) {
  const out = {};
  for (const ph of made.photos) {
    const p = h.photos[ph.photo.n - 900];
    if (!p) continue;
    const jpeg = await sharp(join(h.dir, p.file)).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const b64 = jpeg.toString("base64");
    const size = x.jpegSize(b64);
    if (size) out[ph.photo.n] = { dataUrl: `data:image/jpeg;base64,${b64}`, width: size.width, height: size.height };
  }
  return out;
}

export async function siteReportPdf(outPdf, houseDir, buildings, { title, date } = {}) {
  const x = await scrivn();
  const house = await openHouse(houseDir);
  const houseExt = readJson(statePath(house, "exterior.json"));
  const others = [];
  for (const [i, b] of buildings.entries()) {
    const h = await openHouse(b.dir);
    others.push({ h, ext: x.asBuilding(readJson(statePath(h, "exterior.json")), b.name, `building-${i + 1}`) });
  }
  const meta = { title: title ?? readJson(statePath(house, "inputs.json")).house?.name ?? "The site", date: date ?? new Date().toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }), madeWith: "Scrivn" };
  const site = x.siteReport(houseExt, others.map((o) => o.ext), meta);
  if (!site) throw new Error("Nothing measured to report.");
  const bytes = Buffer.from(
    x.exteriorReportBytes({
      report: site.house,
      svgOf: (el) => x.renderToStaticMarkup(el),
      photos: site.house ? await photosFor(x, house, site.house) : {},
      buildings: await Promise.all(site.buildings.map(async (b, i) => ({ name: b.name, report: b.report, photos: await photosFor(x, others[i].h, b.report) }))),
      totals: site.totals,
      footer: meta.madeWith,
    }),
  );
  writeFileSync(outPdf, bytes);
  return { bytes, site, pages: Number(/\/Count (\d+)/.exec(bytes.toString("latin1"))?.[1] ?? 0) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [out, houseDir, ...rest] = process.argv.slice(2);
  try {
    if (!out || !houseDir) throw new Error("node scripts/house/site.mjs <out.pdf> <house folder> [<building folder>:<name> ...]");
    const buildings = rest.map((r) => {
      const at = r.lastIndexOf(":");
      return at > 2 ? { dir: resolve(r.slice(0, at)), name: r.slice(at + 1) } : { dir: resolve(r), name: "Building" };
    });
    const { bytes, pages, site } = await siteReportPdf(resolve(out), resolve(houseDir), buildings);
    console.log(`Wrote ${out}: ${(bytes.length / 1024).toFixed(0)} KB, ${pages} pages; ${site.buildings.length} other building${site.buildings.length === 1 ? "" : "s"}.`);
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
