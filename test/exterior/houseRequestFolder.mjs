/**
 * A pulled Send-to-team request folder made from the owner's photos of 10-16, as scripts/pull-exterior-request.mjs
 * writes one (exterior-requests/<id>/: the photos at Scrivn's stored size named by camera time, and request.json with
 * the tester's route) - without the database: the route is the owner's own (fixtures/photo-route/owner-1016.json: his
 * shape, 30 corner taps and 4 tapes, as test/exterior/teamRequests.mjs sends them). For the house runner's tests.
 *
 *   node test/exterior/houseRequestFolder.mjs <out dir> [photos dir]
 */
import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REQUEST_FORMAT, stampOf } from "../../scripts/exterior-request-common.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** The folder, written into [dir]; returns its path. Ids are fixed so a test can name them. */
export async function makeRequestFolder(dir, photosDir) {
  const fx = JSON.parse(readFileSync(join(here, "fixtures", "photo-route", "owner-1016.json"), "utf8"));
  const id = "3f9a0c1e-5b7d-4e2a-9c61-0d8e7f6a5b4c";
  const idOf = (n) => `9b1e${String(n).padStart(4, "0")}-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;
  const takenAt = (t) => {
    const [d, tm] = t.split(" ");
    const [y, mo, da] = d.split(":").map(Number);
    const [h, mi, se] = tm.split(":").map(Number);
    return new Date(y, mo - 1, da, h, mi, se).getTime();
  };
  const folder = join(dir, id);
  mkdirSync(folder, { recursive: true });
  const photos = [];
  for (const p of fx.photos) {
    const file = `${stampOf(takenAt(p.takenAt))}.jpg`;
    // As Scrivn stores a site photo (lib/photoImage.ts): at most 2,000 px a side, upright, JPEG.
    await sharp(join(photosDir, p.file)).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(join(folder, file));
    photos.push({ n: p.n, file, id: idOf(p.n), width: p.width, height: p.height, takenAt: new Date(takenAt(p.takenAt)).toISOString() });
  }
  const route = {
    format: "scrivn-photo-route/1",
    photos: fx.photos.map((p) => ({ id: idOf(p.n), width: p.width, height: p.height, takenAt: takenAt(p.takenAt), focalPrior: null })),
    buildings: fx.buildings.map((b) => ({
      id: b.id,
      outline: b.outline.map(([x, y]) => ({ x, y })),
      corners: b.corners.map((c) => ({ photo: idOf(c.photo), corner: c.corner, x: c.x, y: c.y, by: "user" })),
      tapes: b.tapes.map((t) => (t.kind === "line" ? { ...t, photo: idOf(t.photo) } : { id: t.id, kind: "side", from: t.from, feet: t.feet })),
    })),
    measured: null,
  };
  const fileOf = new Map(photos.map((p) => [p.id, p.file]));
  const doc = {
    format: REQUEST_FORMAT,
    pulledAt: "2026-10-17T12:00:00.000Z",
    request: { id, claimId: "c1a10000-0000-4000-8000-000000000001", organizationId: "0a9a0000-0000-4000-8000-000000000001", building: "house", buildingName: null, status: "measuring", sentAt: "2026-10-17T11:55:00.000Z", sentBy: "owen@acme.test", note: "Porch tape is keystone wall to the west post." },
    photos,
    missing: [],
    tapes: route.buildings.flatMap((b) => b.tapes.map((t) => (t.kind === "line" ? { building: b.id, what: t.what, feet: t.feet, onPhoto: fileOf.get(t.photo), a: t.a, b: t.b } : { building: b.id, what: "side", feet: t.feet, fromCorner: t.from + 1 }))),
    route,
    next: [`node scripts/measure-exterior-request.mjs ${id.slice(0, 8)}`, `node scripts/return-exterior-request.mjs ${id.slice(0, 8)} exterior-requests/${id}/exterior.json`],
  };
  writeFileSync(join(folder, "request.json"), JSON.stringify(doc, null, 2));
  return folder;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [out, photos = process.env.PHOTO_ROUTE_PHOTOS ?? "C:/Users/Anthony/Desktop/House Photos"] = process.argv.slice(2);
  if (!out) {
    console.error("node test/exterior/houseRequestFolder.mjs <out dir> [photos dir]");
    process.exit(1);
  }
  console.log(await makeRequestFolder(out, photos));
}
