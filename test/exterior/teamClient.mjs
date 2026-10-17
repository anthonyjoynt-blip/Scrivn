/**
 * Send to Scrivn team (0016), on the tester's phone: the queue that sends a request once its photos are up, and
 * "Use it" putting a returned exterior into the house or a building through the claim's own save.
 *
 *   npm run test:exterior:team      (test/exterior/teamRequests.mjs first: the server and our scripts)
 *
 * The real modules run - lib/exteriorRequestQueue.ts, lib/exteriorRequests.ts, the device store and the claim's
 * sync (lib/deviceClaims.ts, lib/claimSync.ts), the photo queue (lib/devicePhotos.ts) and the editor's own
 * updaters (lib/buildings.ts withHouseChange / withBuildingChange, which SketchEditor and ExteriorSite call) -
 * against the fake IndexedDB test:pending uses and a scripted server that answers as the real routes do. No API,
 * no network.
 *
 * What "Use it" must never be: a write to the claim from anywhere but the claim's own save. So every check below
 * that puts a result in follows it to the server through one PUT naming the version it was made from.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installFakeIndexedDB } from "../pending/fakeIndexedDB.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "team-client-"));
const bundlePath = join(outDir, "bundle.mjs");
await build({
  stdin: {
    contents: `
      export * from "@/lib/exteriorRequestQueue";
      export * from "@/lib/exteriorRequests";
      export * from "@/lib/deviceClaims";
      export * from "@/lib/claimSync";
      export { keepPhotoFile, sendWaitingPhotos, photoFile } from "@/lib/devicePhotos";
      export { emptySavedClaimState, parseSavedClaimState } from "@/lib/claimState";
      export { parseScanExterior } from "@/lib/exteriorImport";
      export { exteriorQuantities } from "@/lib/exterior";
      export { quickBoxExterior, asBuilding, withHouseChange, withBuildingsChange, withBuildingChange } from "@/lib/buildings";
      export { emptyPhotoRoute } from "@/lib/photoRoute";
      export { connection } from "@/lib/connectivity";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: bundlePath,
  alias: { "@": root },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "error",
});

const db = installFakeIndexedDB();

/* ── the page around the modules ──────────────────────────────────────────────────────────────── */

let signedIn = "user-a";
globalThis.document = {
  querySelector: (selector) => (selector === "[data-scrivn-user]" && signedIn !== undefined ? { getAttribute: () => signedIn } : null),
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
};
const local = new Map();
globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
};

/* ── the scripted server ──────────────────────────────────────────────────────────────────────── */

const calls = [];
const server = {
  claims: new Map(),
  requests: new Map(),
  pictures: new Set(),
  mode: "online",
  tick: 0,
  version() {
    this.tick += 1;
    return `2026-10-17T12:00:00.${String(this.tick).padStart(6, "0")}+00:00`;
  },
};
const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const stored = (state) => mod.parseSavedClaimState(JSON.parse(JSON.stringify(state)));
const listedPhotos = (claimId) => new Set((server.claims.get(claimId)?.state.photos.items ?? []).map((p) => p.id));
const view = (r) => ({ id: r.id, building: r.building, buildingName: r.buildingName, status: r.status, note: r.note, createdAt: r.createdAt, readyAt: r.readyAt ?? null, result: r.status === "ready" ? r.result : null });

function handle(path, method, body) {
  if (path === "/api/claims" && method === "POST") {
    const row = server.claims.get(body.id);
    if (row) return respond(200, { id: body.id, version: row.version, existed: true });
    const version = server.version();
    server.claims.set(body.id, { state: stored(body.state), version });
    return respond(200, { id: body.id, version, existed: false });
  }
  let m = /^\/api\/claims\/([^/]+)$/.exec(path);
  if (m) {
    const row = server.claims.get(m[1]);
    if (method === "GET") return row ? respond(200, { state: row.state, version: row.version }) : respond(404, { error: "Claim not found." });
    if (method === "PUT") {
      if (!row) return respond(404, { error: "Claim not found." });
      if (body.base && body.base !== row.version) return respond(409, { error: "Changed.", conflict: { state: row.state, version: row.version } });
      row.state = stored(body.state);
      row.version = server.version();
      return respond(200, { ok: true, version: row.version });
    }
  }
  m = /^\/api\/claims\/([^/]+)\/photos\/([^/]+)$/.exec(path);
  if (m && method === "POST") {
    if (!server.claims.has(m[1])) return respond(404, { error: "Claim not found." });
    if (!listedPhotos(m[1]).has(m[2])) return respond(409, { error: "Not listed.", code: "not-in-claim" });
    server.pictures.add(m[2]);
    return respond(200, { ok: true });
  }
  m = /^\/api\/claims\/([^/]+)\/exterior-requests$/.exec(path);
  if (m) {
    const claimId = m[1];
    if (method === "GET") return respond(200, { requests: [...server.requests.values()].filter((r) => r.claimId === claimId).reverse().map(view) });
    if (method === "POST") {
      if (!server.claims.has(claimId)) return respond(404, { error: "Claim not found." });
      const had = server.requests.get(body.id);
      if (had) return respond(200, { request: view(had), created: false });
      const missing = body.photoIds.filter((id) => !listedPhotos(claimId).has(id));
      if (missing.length) return respond(409, { error: "That claim does not list these photos yet.", code: "not-in-claim", missing });
      const r = { ...body, claimId, status: "sent", createdAt: new Date().toISOString(), result: null };
      server.requests.set(body.id, r);
      return respond(200, { request: view(r), created: true });
    }
  }
  m = /^\/api\/claims\/([^/]+)\/exterior-requests\/([^/]+)$/.exec(path);
  if (m && method === "PATCH") {
    const r = server.requests.get(m[2]);
    if (!r || r.claimId !== m[1]) return respond(404, { error: "Request not found." });
    const to = body.action === "withdraw" ? "withdrawn" : "applied";
    const allowed = body.action === "withdraw" ? ["sent", "measuring", "ready"].includes(r.status) : r.status === "ready";
    if (r.status !== to && !allowed) return respond(409, { error: "Not now." });
    r.status = to;
    return respond(200, { request: view(r) });
  }
  if (path === "/manifest.webmanifest") return respond(200, {});
  return respond(404, { error: "No such route." });
}

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body ? "<picture>" : null;
  calls.push({ url: String(url), method, body });
  if (server.mode === "offline") throw new TypeError("Failed to fetch");
  const answer = handle(String(url).split("?")[0], method, body);
  if (server.mode === "lose-answer") {
    server.mode = "online";
    throw new TypeError("Failed to fetch");
  }
  return answer;
};

const mod = await import(pathToFileURL(bundlePath).href);
rmSync(outDir, { recursive: true, force: true });

/* ── harness ──────────────────────────────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];
async function test(name, run) {
  db.reset();
  local.clear();
  calls.length = 0;
  server.claims.clear();
  server.requests.clear();
  server.pictures.clear();
  server.mode = "online";
  signedIn = "user-a";
  try {
    await run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n         expected ${e}\n         actual   ${a}`);
}

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const P = ["11111111-1111-4111-8111-000000000001", "11111111-1111-4111-8111-000000000002", "11111111-1111-4111-8111-000000000003"];
const record = (id, i) => ({ id, room: "exterior", roomName: "Exterior", takenAt: 1_760_000_000_000 + i * 1000, caption: "", captionBy: null, width: 2000, height: 1500, source: "gallery", editedAt: 1 });
const AT = "2026-10-17T12:30:00.000Z";

/** The owner's house as the team returned it: the capture written from his 18 photos (test/exterior/fixtures/photos-only-1016.json). */
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "photos-only-1016.json"), "utf8"));
const parsed = mod.parseScanExterior(fixture, { scanId: null, receivedAt: AT });
assert(parsed.ok, "the fixture parses");
const RESULT = parsed.exterior;

function routeWith(ids) {
  return { ...mod.emptyPhotoRoute(), photos: ids.map((id, i) => ({ id, width: 2000, height: 1500, takenAt: 1_760_000_000_000 + i * 1000, focalPrior: null })) };
}
/** A claim with its exterior photos, the house started on the photo route, and a shed measured with the quick box. */
function claimState({ photos = P, house, buildings } = {}) {
  const s = mod.emptySavedClaimState();
  s.claim.customerName = "Owner";
  s.photos = { items: photos.map(record), deleted: [], scopedNotes: null };
  s.sketch = { ...s.sketch, exterior: house ?? { sides: [], roof: RESULT.roof, photoRoute: routeWith(photos), scope: { roofing: true, sides: [], soffitFascia: false, eavestrough: true } } };
  if (buildings) s.sketch.buildings = buildings;
  return s;
}
const shedBox = { widthFeet: 12, depthFeet: 16, wallFeet: 8, roof: "gable", pitch: 6, cladding: "vinyl", openings: [] };

async function onServerAndDevice(id, state) {
  const version = server.version();
  server.claims.set(id, { state: stored(state), version });
  await mod.changeDeviceClaim(id, () => ({ ...mod.blankDeviceClaim(id, state, "user-a"), created: true, version }));
  return version;
}
/** What the claim page's save does with a change (lib/useClaimPersistence.ts writeNow): on the device first, owed, then sent. */
async function save(id, state) {
  await mod.changeDeviceClaim(id, (r) => ({ ...r, state, dirty: true, refused: null, changedAt: Date.now(), touchedAt: Date.now() }));
  return mod.syncClaim(id);
}
const puts = () => calls.filter((c) => c.method === "PUT");
const requestPosts = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/exterior-requests"));
const patches = () => calls.filter((c) => c.method === "PATCH");
const input = (id, building = "house", extra = {}) => ({ id, building, buildingName: "", photoIds: P, route: routeWith(P), note: "Hose on the right", ...extra });
const returned = (id, building = "house", result = RESULT) => server.requests.set(id, { id, claimId: ID, building, buildingName: building === "house" ? "" : "Shed", photoIds: P, note: "", status: "ready", createdAt: AT, readyAt: AT, result });

/* ── Use it ───────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Use it");

await test("Use it puts the team's measurement into the house, through the claim's own save, from the version it was opened at", async () => {
  const shed = mod.asBuilding(mod.quickBoxExterior(shedBox), "Shed", "building-shed-1");
  const before = claimState({ buildings: [shed] });
  const v1 = await onServerAndDevice(ID, before);
  const R = "aaaaaaaa-0000-4000-8000-000000000001";
  returned(R);
  assert(await mod.refreshRequests(ID, { force: true }), "the Exterior asks Scrivn");
  const known = mod.knownRequests(ID)?.find((r) => r.id === R);
  assert(known?.status === "ready" && known.result?.sides?.length === 12, "and hears it is measured, with the result");
  const checked = mod.checkTeamResult(known.result);
  assert(checked.ok, "the result opens");

  // The tap: TeamMeasure's apply runs through ExteriorEditor's onChange, which is SketchEditor's onHouse.
  const sketch = mod.withHouseChange(before.sketch, (prev) => mod.withTeamMeasure(prev, checked.value, AT));
  equal((await save(ID, { ...before, sketch })).kind, "synced", "the claim saves");
  mod.markApplied(ID, R);
  await mod.sendWaitingRequests();

  equal(puts().length, 1, "one save");
  equal(puts()[0].body.base, v1, "naming the version it was opened at: offline mode's versioned save, never a server write");
  const house = server.claims.get(ID).state.sketch.exterior;
  equal(house.sides.length, 12, "the house has the 12 measured sides");
  assert(house.source.kind === "photos" && house.source.by === "photos" && house.source.notes.at(-1) === mod.TEAM_NOTE && house.source.edited === false, "says it was measured from photos, by the Scrivn team (not 'with Scrivn Scan', though we wrote it as a capture), and is not marked changed since");
  equal(house.scope.roofing && house.scope.eavestrough, true, "the tester's scope ticks stay");
  equal([house.photoRoute.photos.length, house.photoRoute.measured], [3, null], "their photos stay on the route, with no old measure to contradict the sides");
  assert(house.sides.every((s) => (s.photos ?? []).every((p) => p.claimPhotoId || p.scanId)), "no side photo the claim could not show");
  assert(house.id === undefined && house.name === undefined, "the house is no building");
  equal(server.claims.get(ID).state.sketch.buildings, stored(before).sketch.buildings, "the shed is untouched");
  assert(mod.exteriorQuantities(house).roofing, "and the roof and quantities work it out");
  equal(server.requests.get(R).status, "applied", "the request is marked used");
  equal(mod.waitingRequests(ID).length, 0, "nothing waits on the phone");
  assert(!mod.knownRequests(ID).some((r) => r.id === R && mod.isOpenRequest(r.status)), "and the Exterior stops offering it");
});

await test("Use it puts it into another building, keeping its id and name, and leaves the house alone", async () => {
  const house = mod.quickBoxExterior({ ...shedBox, widthFeet: 40, depthFeet: 30, wallFeet: 9 });
  const shed = mod.asBuilding({ sides: [], roof: RESULT.roof, photoRoute: routeWith(P) }, "Shed", "building-shed-1");
  const before = claimState({ house, buildings: [shed] });
  const v1 = await onServerAndDevice(ID, before);
  const R = "aaaaaaaa-0000-4000-8000-000000000002";
  returned(R, "building-shed-1");
  await mod.refreshRequests(ID, { force: true });
  const result = mod.knownRequests(ID).find((r) => r.id === R).result;
  // As SketchEditor's onBuildings and ExteriorSite's updateBuilding run it.
  const sketch = mod.withBuildingsChange(before.sketch, (list) => mod.withBuildingChange(list, "building-shed-1", (prev) => mod.withTeamMeasure(prev, result, AT)));
  equal(sketch, mod.sketchWithTeamMeasure(before.sketch, "building-shed-1", result, AT), "the same as the shared helper makes it");
  await save(ID, { ...before, sketch });
  equal(puts()[0].body.base, v1, "through the claim's own save");
  const saved = server.claims.get(ID).state.sketch;
  equal([saved.buildings[0].id, saved.buildings[0].name, saved.buildings[0].sides.length], ["building-shed-1", "Shed", 12], "the shed has the measured sides, its id and name");
  equal(saved.exterior, stored(before).sketch.exterior, "the house is untouched");
});

await test("a building removed since it was sent is left removed", async () => {
  const before = claimState();
  equal(mod.sketchWithTeamMeasure(before.sketch, "building-gone", RESULT, AT), before.sketch, "nothing to put it in, nothing changes");
});

await test("the team's own route comes with its measure; photos the tester added since stay on it", async () => {
  const P4 = "11111111-1111-4111-8111-000000000004";
  const prev = { sides: [], roof: RESULT.roof, photoRoute: routeWith([...P, P4]), scope: { roofing: false, sides: ["gone-side"], soffitFascia: false, eavestrough: false } };
  const teamRoute = { ...routeWith(P), buildings: [{ id: "main", outline: [{ x: 0, y: 0 }], corners: [], tapes: [] }], measured: { at: AT, building: "main" } };
  const next = mod.withTeamMeasure(prev, { ...RESULT, photoRoute: teamRoute }, AT);
  equal(next.photoRoute.photos.map((p) => p.id), [...P, P4], "the team's photos, then the one added since");
  equal(next.photoRoute.measured.at, AT, "the team's measure, which matches the sides");
  equal(next.scope.sides, [], "a scope tick on a side that is not there any more goes");
});

await test("a result that would not open is not offered as one", async () => {
  for (const [bad, why] of [
    [null, "nothing"],
    [{ sides: [] }, "no sides"],
    [{ ...RESULT, roof: null }, "no roof"],
    [{ ...RESULT, sides: RESULT.sides.map((s, i) => (i === 2 ? { ...s, lengthFeet: -1 } : s)) }, "a side with no length"],
    [{ ...RESULT, sides: RESULT.sides.map((s, i) => (i === 3 ? { ...s, openings: undefined } : s)) }, "a side missing its openings"],
  ]) {
    assert(!mod.checkTeamResult(bad).ok, `refused: ${why}`);
  }
  assert(mod.checkTeamResult(RESULT).ok, "and the real one is not");
});

/* ── sending ──────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Sending");

await test("a send waits on the phone for its photos, says how many, and goes once they are up", async () => {
  await onServerAndDevice(ID, claimState());
  const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: "image/jpeg" });
  await mod.keepPhotoFile(ID, P[1], blob, blob);
  const R = "bbbbbbbb-0000-4000-8000-000000000001";
  mod.sendToTeam(ID, input(R));
  await mod.sendWaitingRequests();
  equal(requestPosts().length, 0, "nothing sent while a photo is still on the phone");
  equal(await mod.photosStillToUpload(P), 1, "the Exterior can say one is still to upload");
  equal(mod.waitingRequests(ID).map((w) => [w.kind, w.id]), [["send", R]], "it waits here");

  await mod.sendWaitingPhotos();
  assert(server.pictures.has(P[1]), "the photo goes");
  await mod.sendWaitingRequests();
  equal(requestPosts().length, 1, "then the request, once");
  const sent = server.requests.get(R);
  equal([sent.building, sent.note, sent.photoIds.length, sent.route.photos.length], ["house", "Hose on the right", 3, 3], "with its photos, the route's inputs and the note");
  equal(mod.waitingRequests(ID).length, 0, "nothing waits");
  equal(mod.knownRequests(ID)?.[0]?.status, "sent", "and the Exterior knows it is with us");
});

await test("with no signal it waits; sent again after a lost answer it is still one request", async () => {
  await onServerAndDevice(ID, claimState());
  const R = "bbbbbbbb-0000-4000-8000-000000000002";
  server.mode = "offline";
  mod.sendToTeam(ID, input(R));
  await mod.sendWaitingRequests();
  equal(mod.waitingRequests(ID).length, 1, "kept with no signal");
  server.mode = "lose-answer";
  await mod.sendWaitingRequests();
  assert(server.requests.has(R) && mod.waitingRequests(ID).length === 1, "it landed, but the phone could not know");
  await mod.sendWaitingRequests();
  equal([server.requests.size, requestPosts().length, mod.waitingRequests(ID).length], [1, 3, 0], "the retry names the same id: one request");
});

await test("a claim started on the phone waits for its first save; one whose save is behind waits for it", async () => {
  const state = claimState();
  await mod.changeDeviceClaim(ID, () => ({ ...mod.blankDeviceClaim(ID, state, "user-a"), created: false, dirty: true }));
  const R = "bbbbbbbb-0000-4000-8000-000000000003";
  mod.sendToTeam(ID, input(R));
  await mod.sendWaitingRequests();
  equal(requestPosts().length, 0, "Scrivn has no claim to file it under yet");
  // The claim lands without its photos listed yet (an older save): the request is a 409 and waits, not refused.
  await mod.syncClaim(ID);
  server.claims.get(ID).state.photos.items = [];
  await mod.sendWaitingRequests();
  equal(requestPosts().length, 1, "sent once the claim is there");
  assert(mod.waitingRequests(ID)[0] && !mod.waitingRequests(ID)[0].refused, "the 409 is 'later', not a refusal");
  server.claims.get(ID).state.photos.items = P.map(record);
  await mod.sendWaitingRequests();
  equal([server.requests.size, mod.waitingRequests(ID).length], [1, 0], "and goes when the save has caught up");
});

await test("withdraw: one still on the phone simply goes; one Scrivn has is withdrawn there, with signal or later", async () => {
  await onServerAndDevice(ID, claimState());
  server.mode = "offline";
  const A = "cccccccc-0000-4000-8000-000000000001";
  mod.sendToTeam(ID, input(A));
  await mod.sendWaitingRequests();
  mod.withdrawRequest(ID, A);
  server.mode = "online";
  calls.length = 0;
  await mod.sendWaitingRequests();
  equal([server.requests.has(A), calls.length, mod.waitingRequests(ID).length], [false, 0, 0], "never sent, nothing to tell Scrivn");

  const B = "cccccccc-0000-4000-8000-000000000002";
  mod.sendToTeam(ID, input(B));
  await mod.sendWaitingRequests();
  server.mode = "offline";
  mod.withdrawRequest(ID, B);
  await mod.sendWaitingRequests();
  equal(mod.waitingRequests(ID).map((w) => w.kind), ["withdraw"], "with no signal the withdrawal waits");
  server.mode = "online";
  await mod.sendWaitingRequests();
  equal([server.requests.get(B).status, mod.waitingRequests(ID).length], ["withdrawn", 0], "and is made when the signal is back");
});

await test("on a shared phone, one person's request is never sent under another's sign-in", async () => {
  await onServerAndDevice(ID, claimState());
  const R = "dddddddd-0000-4000-8000-000000000001";
  server.mode = "offline";
  mod.sendToTeam(ID, input(R));
  await mod.sendWaitingRequests();
  server.mode = "online";
  signedIn = "user-b";
  calls.length = 0;
  await mod.sendWaitingRequests();
  equal([requestPosts().length, mod.waitingRequests(ID).length], [0, 0], "user-b neither sends nor sees it");
  signedIn = "user-a";
  await mod.sendWaitingRequests();
  equal(requestPosts().length, 1, "user-a's goes when user-a is back");
});

console.log(`\n  exterior requests (the phone): ${passed} passed, ${failures.length} failed`);
// The device store's BroadcastChannel (lib/deviceClaims.ts) would keep Node waiting.
process.exit(failures.length ? 1 : 0);
