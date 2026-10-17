/**
 * Send to Scrivn team (0016), our side and the server's: the routes a tester's browser calls, and the scripts we
 * run, against every migration in a Postgres in memory (test/db/supabaseLocal.mjs) with Storage stood in for. No
 * API, no network, nothing of production.
 *
 *   npm run test:exterior:team      (this, then test/exterior/teamClient.mjs: the tester's phone)
 *
 *   1. The routes (app/api/claims/[id]/exterior-requests): a member sends a house of their own organization's
 *      claim and nobody else can - not another organization, not signed out; sent twice it is one request; photos
 *      the claim does not list yet are "later" (409); withdraw and used only as the tester's own moves; we are told
 *      one came in.
 *   2. The scripts (scripts/exterior-request-common.mjs, what pull/measure/return run): listing, pulling, the sweep
 *      of our copies (withdrawn deleted, 30 days said), returning - checked, ready, our copy deleted, the tester
 *      emailed - and refusing a bad exterior or a withdrawn request.
 *   3. The round trip on the owner's 18 photos of 10-16 (C:/Users/Anthony/Desktop/House Photos, or
 *      PHOTO_ROUTE_PHOTOS): sent from his claim with the route's inputs, pulled into a folder laid out as his own,
 *      measured with the route's code, returned with test/exterior/fixtures/photos-only-1016.json as the result,
 *      used, and saved into the claim through the claim's own PUT.
 */
import sharp from "sharp";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { migrationFiles, startSupabaseLocal } from "../db/supabaseLocal.mjs";
import { supabaseJs } from "../db/supabaseJs.mjs";
import { bundleRoutes } from "../billing/bundleRoutes.mjs";
import { appCode, listWaiting, pullRequest, returnRequest, sweepFolders, sweepLines } from "../../scripts/exterior-request-common.mjs";
import { measureFolder } from "../../scripts/measure-exterior-request.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const PHOTOS = process.env.PHOTO_ROUTE_PHOTOS ?? "C:/Users/Anthony/Desktop/House Photos";

Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test", SCAN_REPORTS_TO: "team@scrivn.test" });

const { mod: routes, cleanup } = await bundleRoutes(
  `export { GET as list, POST as create } from "@/app/api/claims/[id]/exterior-requests/route";
   export { PATCH as act } from "@/app/api/claims/[id]/exterior-requests/[requestId]/route";
   export { GET as getClaim, PUT as putClaim } from "@/app/api/claims/[id]/route";
   export { sketchWithTeamMeasure, TEAM_NOTE, withTeamMeasure } from "@/lib/exteriorRequests";
   export { exteriorQuantities } from "@/lib/exterior";`,
  "exterior-requests",
);
const app = await appCode();

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${message}`);
  } else {
    failures.push(message);
    console.log(`  FAIL ${message}`);
  }
}
async function throwsWith(run, pattern, message) {
  try {
    await run();
    check(false, `${message} (it went through)`);
  } catch (err) {
    check(pattern.test(err.message), `${message} (${err.message})`);
  }
}

/* ── the world ────────────────────────────────────────────────────────────────────────────────── */

const s = await startSupabaseLocal();
for (const m of migrationFiles(root)) await s.applyMigration(m);

const emails = [];
const as = (userId, email) => (globalThis.__scrivnTest = { local: s, emails, userId, email });

const owen = await s.createUser({ email: "owen@acme.test", fullName: "Owen", companyName: "Acme" });
const xan = await s.createUser({ email: "xan@other.test", fullName: "Xan", companyName: "Other" });
const orgOf = async (u) => (await s.sql(`select organization_id from public.organization_members where user_id = $1`, [u]))[0].organization_id;
const acme = await orgOf(owen);

const photoRecord = (id, takenAt, width = 2000, height = 1500) => ({ id, room: "exterior", roomName: "Exterior", takenAt, caption: "", captionBy: null, width, height, source: "gallery", editedAt: takenAt });
async function newClaim(user, org, photos, sketch = { exterior: { sides: [], roof: {}, photoRoute: null } }) {
  const id = randomUUID();
  await s.sql(`insert into public.claims (id, organization_id, created_by, customer_name, payload) values ($1, $2, $3, 'Owner house', $4)`, [
    id,
    org,
    user,
    JSON.stringify({ photos: { items: photos, deleted: [], scopedNotes: null }, sketch: { levels: [], ...sketch } }),
  ]);
  return id;
}

/** Storage as the service role reads it: claim-photos/<org>/<claim>/<photo>.jpg. */
const stored = new Map();
const storage = {
  from: (bucket) => ({
    async download(path) {
      const bytes = stored.get(`${bucket}/${path}`);
      return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: "Object not found" } };
    },
  }),
};
const service = { ...supabaseJs(s, { role: "service_role" }), storage };

const params = (id, requestId) => ({ params: Promise.resolve(requestId ? { id, requestId } : { id }) });
const post = (claimId, body) => routes.create(new Request(`https://scrivn.test/api/claims/${claimId}/exterior-requests`, { method: "POST", body: JSON.stringify(body) }), params(claimId));
const list = async (claimId) => (await routes.list(new Request(`https://scrivn.test/api/claims/${claimId}/exterior-requests`), params(claimId))).json();
const act = (claimId, requestId, action) =>
  routes.act(new Request(`https://scrivn.test/api/claims/${claimId}/exterior-requests/${requestId}`, { method: "PATCH", body: JSON.stringify({ action }) }), params(claimId, requestId));
const rowOf = async (id) => (await s.sql(`select * from public.exterior_requests where id = $1`, [id]))[0];
const route1 = (ids) => ({ format: "scrivn-photo-route/1", photos: ids.map((id) => ({ id, width: 2000, height: 1500, takenAt: 1 })), buildings: [{ id: "main", outline: [], corners: [], tapes: [{ id: "t1", kind: "side", from: 0, feet: 30 }] }] });

const P = [randomUUID(), randomUUID(), randomUUID()];
const claim = await newClaim(owen, acme, P.map((id, i) => photoRecord(id, Date.UTC(2026, 9, 16, 12, 49, i))));
const xanClaim = await newClaim(xan, await orgOf(xan), []);

/* ── 1. the routes ────────────────────────────────────────────────────────────────────────────── */

console.log("\n  The routes");
const R1 = randomUUID();
{
  as(owen, "owen@acme.test");
  const res = await post(claim, { id: R1, building: "house", photoIds: P, route: route1(P), note: "The side yard is too tight to photograph." });
  const body = await res.json();
  const row = await rowOf(R1);
  check(res.status === 200 && body.created === true && body.request?.status === "sent", `a member sends the house of her claim (got ${res.status} ${JSON.stringify(body).slice(0, 120)})`);
  check(row?.organization_id === acme && row?.user_id === owen && row?.claim_id === claim && row?.photo_ids.length === 3 && row?.route?.buildings?.[0]?.tapes?.length === 1, "filed under the claim's organization, as her, with its photos and the route's inputs");
  check(emails.length === 1 && emails[0].to === "team@scrivn.test" && /A house to measure: 3 photos from owen@acme.test/.test(emails[0].subject) && emails[0].replyTo === "owen@acme.test", `we are told one came in (${emails[0]?.subject})`);

  const again = await post(claim, { id: R1, building: "house", photoIds: P, route: route1(P), note: "The side yard is too tight to photograph." });
  const againBody = await again.json();
  check(again.status === 200 && againBody.created === false && (await s.sql(`select count(*)::int as n from public.exterior_requests`))[0].n === 1 && emails.length === 1, "sent again after a lost answer, it is the same request, and we are not told twice");

  const notListed = await post(claim, { id: randomUUID(), building: "house", photoIds: [...P, "not-yet-saved"], route: null, note: "" });
  const nl = await notListed.json();
  check(notListed.status === 409 && nl.code === "not-in-claim" && nl.missing?.[0] === "not-yet-saved", "a photo the claim does not list yet is a 409 the phone sends again later");

  as(xan, "xan@other.test");
  const cross = await post(claim, { id: randomUUID(), building: "house", photoIds: P, route: null, note: "" });
  check(cross.status === 404 && (await s.sql(`select count(*)::int as n from public.exterior_requests`))[0].n === 1, "another organization cannot send it: the claim is not found (404), and nothing is filed");
  check((await list(claim)).requests?.length === 0, "nor see its requests");
  check((await act(claim, R1, "withdraw")).status === 404 && (await rowOf(R1)).status === "sent", "nor withdraw one");
  const ownClaimForeignPhotos = await post(xanClaim, { id: randomUUID(), building: "house", photoIds: P, route: null, note: "" });
  check(ownClaimForeignPhotos.status === 409, "nor send Acme's photos under a claim of his own (his claim does not list them)");

  as(null, null);
  check((await post(claim, { id: randomUUID(), building: "house", photoIds: P, route: null, note: "" })).status === 401, "signed out, nothing is sent (401)");
  check((await routes.list(new Request("https://scrivn.test/x"), params(claim))).status === 401, "or listed");

  as(owen, "owen@acme.test");
  for (const [body, why] of [
    [{ id: "nope", photoIds: P }, "an id that is not a UUID"],
    [{ id: randomUUID(), photoIds: [] }, "no photos"],
    [{ id: randomUUID(), photoIds: ["../x"] }, "a photo id that is not one"],
    [{ id: randomUUID(), photoIds: P, building: "../../etc" }, "a building that is not one"],
    [{ id: randomUUID(), photoIds: P, note: "x".repeat(2001) }, "a note over 2,000 characters"],
  ]) {
    check((await post(claim, body)).status === 400, `refused before anything is looked up: ${why} (400)`);
  }

  const listed = await list(claim);
  check(listed.requests?.length === 1 && listed.requests[0].id === R1 && listed.requests[0].status === "sent" && listed.requests[0].result === null, "the claim's Exterior lists it as sent, no result");
  const early = await act(claim, R1, "applied");
  check(early.status === 409 && /not measured yet/.test((await early.json()).error), "it cannot be marked used before it is measured (409, in words)");
  check((await act(claim, R1, "measure")).status === 400, "an action that is neither is refused (400)");

  // Ours: measured and returned, with the service role.
  await s.service(`update public.exterior_requests set status = 'ready', ready_at = now(), result = $2 where id = $1`, [R1, JSON.stringify({ sides: [{ id: "a" }], roof: {} })]);
  const ready = await list(claim);
  check(ready.requests[0].status === "ready" && ready.requests[0].result?.sides?.length === 1, "once returned, the listing carries the result");
  const used = await act(claim, R1, "applied");
  check(used.status === 200 && (await rowOf(R1)).status === "applied", "Use it marks it used");
  check((await act(claim, R1, "applied")).status === 200, "asked twice, the second answers as the first");
  check((await list(claim)).requests[0].result === null, "and the listing stops carrying the result");
  check((await act(claim, R1, "withdraw")).status === 409, "a used one cannot be withdrawn");

  const R2 = randomUUID();
  await post(claim, { id: R2, building: "building-mq1-2", buildingName: "Shed", photoIds: [P[0]], route: null, note: "" });
  check((await rowOf(R2)).building === "building-mq1-2" && (await rowOf(R2)).building_name === "Shed" && /Shed to measure: 1 photo/.test(emails.at(-1).subject), "another building on the claim is sent by its id, named");
  check((await act(claim, R2, "withdraw")).status === 200 && (await rowOf(R2)).status === "withdrawn", "and withdrawn");
}

/* ── 2. the scripts ───────────────────────────────────────────────────────────────────────────── */

console.log("\n  The scripts");
const work = mkdtempSync(join(tmpdir(), "exterior-requests-"));
const dir = join(work, "exterior-requests");
const jpeg = (n) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]);
{
  const claim2 = await newClaim(owen, acme, P.map((id, i) => photoRecord(id, new Date(2026, 9, 16, 12, 50, i).getTime())));
  stored.set(`claim-photos/${acme}/${claim2}/${P[0]}.jpg`, jpeg(1));
  stored.set(`claim-photos/${acme}/${claim2}/${P[1]}.jpg`, jpeg(2));
  const R3 = randomUUID();
  as(owen, "owen@acme.test");
  await post(claim2, { id: R3, building: "house", photoIds: P, route: { ...route1(P), buildings: [{ id: "main", outline: [], corners: [], tapes: [{ id: "g", kind: "line", photo: P[1], a: [1, 2], b: [3, 4], feet: 9, what: "garage" }] }] }, note: "Hose on the right" });

  const lines = await listWaiting(service);
  check(lines.length === 1 && lines[0].startsWith(R3.slice(0, 8)) && /sent/.test(lines[0]) && /owen@acme\.test/.test(lines[0]) && /Hose on the right/.test(lines[0]), `the list says what waits: ${lines[0]}`);

  const got = await pullRequest(service, R3.slice(0, 6), { dir });
  const folder = join(dir, R3);
  const doc = JSON.parse(readFileSync(join(folder, "request.json"), "utf8"));
  check(got.photos.length === 2 && got.missing.length === 1 && got.missing[0] === P[2], "pulled by the start of its id: the two photos Scrivn has, the third said to be missing");
  check(readdirSync(folder).sort().join(",") === "20261016_125000.jpg,20261016_125001.jpg,request.json", `named as the phone names them, when they were taken (${readdirSync(folder).join(", ")})`);
  check(readFileSync(join(folder, "20261016_125001.jpg")).equals(jpeg(2)), "at the size Scrivn keeps them, byte for byte");
  check(doc.request.note === "Hose on the right" && doc.request.sentBy === "owen@acme.test" && doc.route.buildings[0].tapes.length === 1 && doc.tapes[0].onPhoto === "20261016_125001.jpg" && doc.tapes[0].feet === 9, "request.json: the note, who sent it, the route's inputs, the tapes by photo file");
  check((await rowOf(R3)).status === "measuring" && (await rowOf(R3)).measuring_at !== null, "and the request is marked measuring");
  check(!JSON.stringify(doc).includes("Owner house"), "nothing of the claim but its exterior photos comes with it (not the customer's name)");
  check((await listWaiting(service))[0].includes("measuring"), "the list shows it being measured");
  await pullRequest(service, R3, { dir });
  check((await rowOf(R3)).status === "measuring", "pulled again, it stays measuring");

  // The sweep.
  const R4 = randomUUID();
  await post(claim2, { id: R4, building: "house", photoIds: [P[0]], route: null, note: "" });
  await pullRequest(service, R4, { dir });
  as(owen, "owen@acme.test");
  await act(claim2, R4, "withdraw");
  const old = JSON.parse(readFileSync(join(folder, "request.json"), "utf8"));
  writeFileSync(join(folder, "request.json"), JSON.stringify({ ...old, pulledAt: new Date(Date.now() - 31 * 864e5).toISOString() }));
  const swept = await sweepFolders(service, { dir });
  check(swept.removed.length === 1 && swept.removed[0].id === R4 && !existsSync(join(dir, R4)), "our copy of one the tester withdrew is deleted at the next pull");
  check(swept.old.length === 1 && swept.old[0].id === R3 && swept.old[0].days === 31 && /WARNING: our copy of .* is 31 days old .*PRIVACY\.md promises 30/.test(sweepLines(swept).at(-1)), `one kept past 30 days is said: ${sweepLines(swept).at(-1)}`);

  // Returning.
  const bad = join(work, "bad.json");
  writeFileSync(bad, JSON.stringify({ sides: [{ id: "a", name: "Front", lengthFeet: 10, openings: [], bands: [] }], roof: {} }));
  await throwsWith(() => returnRequest(service, app, R3, bad, { dir }), /three at least/, "an exterior that would not open in a claim is not returned");
  check((await rowOf(R3)).status === "measuring" && existsSync(folder), "and nothing changed");
  await throwsWith(() => returnRequest(service, app, R4, join(here, "fixtures", "photos-only-1016.json"), { dir }), /withdrawn/, "a withdrawn request is not returned");

  const told = [];
  const done = await returnRequest(service, app, R3.slice(0, 8), join(here, "fixtures", "photos-only-1016.json"), { dir, notify: async (m) => (told.push(m), "emailed") });
  const row = await rowOf(R3);
  check(row.status === "ready" && row.ready_at !== null && row.result?.sides?.length === 12 && done.sides === 12, "returned: checked, stored as the result, marked ready");
  check(done.deleted === folder && !existsSync(folder), "our copy is deleted");
  check(told.length === 1 && told[0].to === "owen@acme.test" && told[0].request.id === R3, "and the tester is told it is ready");
  check(done.warnings.some((w) => /neither a claim photo nor a scan's/.test(w)), "a hand-written capture's side photos, which no claim could show, are warned of");
  const again = await returnRequest(service, app, R3, join(here, "fixtures", "photos-only-1016.json"), { dir });
  check(again.replaced && (await rowOf(R3)).status === "ready", "returned again before it is used, it replaces the one before");
  check((await listWaiting(service)).length === 0, "and nothing waits for us now");
}

/* ── 3. the round trip on the owner's photos ──────────────────────────────────────────────────── */

console.log("\n  The round trip, on the owner's 18 photos");
if (!existsSync(PHOTOS)) {
  failures.push(`the owner's photos are not at ${PHOTOS} (set PHOTO_ROUTE_PHOTOS)`);
} else {
  const fx = JSON.parse(readFileSync(join(here, "fixtures", "photo-route", "owner-1016.json"), "utf8"));
  const idOf = new Map(fx.photos.map((p) => [p.n, randomUUID()]));
  const takenAt = (t) => {
    const [d, tm] = t.split(" ");
    const [y, mo, da] = d.split(":").map(Number);
    const [h, mi, se] = tm.split(":").map(Number);
    return new Date(y, mo - 1, da, h, mi, se).getTime();
  };
  // The claim as the app keeps it: each photo a site photo filed to Exterior, its picture as lib/photoImage.ts stores it.
  const records = fx.photos.map((p) => photoRecord(idOf.get(p.n), takenAt(p.takenAt), p.width, p.height));
  const route = {
    format: "scrivn-photo-route/1",
    photos: fx.photos.map((p) => ({ id: idOf.get(p.n), width: p.width, height: p.height, takenAt: takenAt(p.takenAt), focalPrior: null })),
    buildings: fx.buildings.map((b) => ({
      id: b.id,
      outline: b.outline.map(([x, y]) => ({ x, y })),
      corners: b.corners.map((c) => ({ photo: idOf.get(c.photo), corner: c.corner, x: c.x, y: c.y, by: "user" })),
      tapes: b.tapes.map((t) => (t.kind === "line" ? { ...t, photo: idOf.get(t.photo) } : { id: t.id, kind: "side", from: t.from, feet: t.feet })),
    })),
    measured: null,
  };
  const house = { sides: [], roof: { pitch: null }, photoRoute: route, scope: { roofing: true, sides: [], soffitFascia: false, eavestrough: false } };
  const claim3 = await newClaim(owen, acme, records, { exterior: house });
  for (const p of fx.photos) {
    const full = await sharp(join(PHOTOS, p.file)).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    stored.set(`claim-photos/${acme}/${claim3}/${idOf.get(p.n)}.jpg`, full);
  }

  as(owen, "owen@acme.test");
  const R5 = randomUUID();
  const sent = await post(claim3, { id: R5, building: "house", photoIds: route.photos.map((p) => p.id), route, note: "Porch tape is keystone wall to the west post." });
  check(sent.status === 200, "the owner sends his house: 18 photos, the shape, 30 corner taps and 4 tapes");

  const got = await pullRequest(service, R5.slice(0, 8), { dir });
  const folder = join(dir, R5);
  const pulled = readdirSync(folder).filter((f) => f.endsWith(".jpg")).sort();
  const his = readdirSync(PHOTOS).filter((f) => /\.jpe?g$/i.test(f)).sort();
  // His phone names a file when it is saved, a second after the camera's time now and then; ours go by the camera's.
  const secondsOf = (f) => {
    const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(f);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() / 1000 : NaN;
  };
  const same = pulled.filter((f, i) => f === his[i]).length;
  check(
    got.missing.length === 0 && pulled.length === 18 && pulled.every((f) => /^\d{8}_\d{6}\.jpg$/.test(f)) && pulled.every((f, i) => Math.abs(secondsOf(f) - secondsOf(his[i])) <= 1),
    `pulled into a folder laid out as his own House Photos: 18 photos named as his phone names them (${same} of 18 the very names, the rest a second off: the camera's time, not the save's)`,
  );
  const doc5 = JSON.parse(readFileSync(join(folder, "request.json"), "utf8"));
  check(doc5.photos.length === 18 && doc5.photos.every((p) => readFileSync(join(folder, p.file)).equals(stored.get(`claim-photos/${acme}/${claim3}/${p.id}.jpg`))), "each the picture Scrivn keeps, byte for byte");

  const t0 = Date.now();
  const measured = await measureFolder(folder, { now: new Date("2026-10-17T12:00:00Z") });
  const ext = JSON.parse(readFileSync(join(folder, "exterior.json"), "utf8"));
  const sidePhotoIds = ext.sides.flatMap((side) => (side.photos ?? []).map((p) => p.claimPhotoId));
  check(ext.sides.length === 12 && ext.source?.kind === "photos" && sidePhotoIds.length > 0 && sidePhotoIds.every((id) => route.photos.some((p) => p.id === id)), `measured here with the route's code: 12 sides, its photos the claim's own (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const porch = ext.photoRoute.measured.sides[10].lengthFeet * 12;
  check(Math.abs(porch - 263) < 1, `the taped porch comes out as taped (${porch.toFixed(1)}")`);
  check(Object.keys(measured.frames).length >= 6 && Object.values(measured.frames).every((f) => existsSync(join(folder, "squared", f.file))), `each side's photo squared up to read the walls off (${Object.keys(measured.frames).length} PNGs)`);
  console.log(measured.lines.map((l) => `      ${l}`).join("\n"));

  const told = [];
  const done = await returnRequest(service, app, R5, join(here, "fixtures", "photos-only-1016.json"), { dir, notify: async (m) => (told.push(m), "emailed") });
  check(done.sides === 12 && !existsSync(folder) && told.length === 1, "returned with photos-only-1016.json as the result; our copy deleted; the owner told");

  // His phone: the Exterior lists it ready; Use it puts it in through the claim's own save.
  const listed = (await list(claim3)).requests.find((r) => r.id === R5);
  check(listed?.status === "ready" && listed.result?.sides?.length === 12, "his claim's Exterior shows it measured, the result with it");
  const opened = await (await routes.getClaim(new Request(`https://scrivn.test/api/claims/${claim3}`), params(claim3))).json();
  const before = await s.sql(`select payload from public.claims where id = $1`, [claim3]);
  check(JSON.stringify(before[0].payload.sketch.exterior.sides) === "[]", "nothing on the server has touched the claim: its house still has no sides");
  const sketch = routes.sketchWithTeamMeasure(opened.state.sketch, "house", listed.result, "2026-10-17T12:30:00.000Z");
  const put = await routes.putClaim(new Request(`https://scrivn.test/api/claims/${claim3}`, { method: "PUT", body: JSON.stringify({ state: { ...opened.state, sketch } }) }), params(claim3));
  check(put.status === 200, "Use it: the claim saved through its own PUT, as every change to it is");
  const after = (await s.sql(`select payload from public.claims where id = $1`, [claim3]))[0].payload.sketch.exterior;
  check(after.sides.length === 12 && after.source.notes.includes(routes.TEAM_NOTE) && after.scope?.roofing === true && after.photoRoute?.photos?.length === 18, "the house has the 12 measured sides, says who measured it, and keeps his scope ticks and his 18 photos on the route");
  const q = routes.exteriorQuantities(after);
  check(q.sides.length === 12 && q.totals.grossSquareFeet > 1000 && !!q.roofing, `its quantities and roof work it out (${Math.round(q.totals.grossSquareFeet)} SF of walls, ${q.roofing?.squares.toFixed(1)} SQ)`);
  check((await act(claim3, R5, "applied")).status === 200 && (await rowOf(R5)).status === "applied", "and the request is marked used");
  const swept = await sweepFolders(service, { dir });
  check(swept.removed.length === 0 && swept.old.length === 0 && readdirSync(dir).length === 0, "nothing of his is left on our machine");
}

rmSync(work, { recursive: true, force: true });
cleanup();
await s.close();
console.log(`\n  exterior requests (server and scripts): ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
