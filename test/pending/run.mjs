/**
 * Claims on the device and how they reach the server — what offline mode stands on.
 *
 *   npm run test:pending
 *
 * This is what stands between an estimator scoping a job in a basement with no signal and that job
 * being gone, or quietly written over the top of what the office did meanwhile. Every way it can be
 * wrong is silent:
 *
 *   * work kept and then never sent, or sent twice so one job is two half-filled claims
 *   * a save that landed with its answer lost, then reported as a clash with the estimator's own work
 *   * a real clash written over without anyone being asked
 *   * a refused save retried for ever, or dropped — it is the only copy there is
 *   * one person's unsynced work sent from a shared phone while another is signed in
 *   * a Claude step that waited for signal run twice, run against stale state, or counted early
 *   * the old save queue's records lost on the upgrade to this one
 *
 * The real modules run (lib/deviceClaims.ts, lib/claimSync.ts, lib/aiJobs.ts) against a fake
 * IndexedDB (see fakeIndexedDB.mjs for why that is the honest choice under Node) and a scripted
 * server that answers as the real routes do — versions, 409 with the claim as it stands, ids chosen
 * on the device — and that can drop the line, or drop only the answer.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installFakeIndexedDB } from "./fakeIndexedDB.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "pending-tests-"));
const bundlePath = join(outDir, "bundle.mjs");

await build({
  entryPoints: [join(here, "entry.ts")],
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

// Who is signed in, as the header marker says — see `deviceUser`.
let signedIn = "user-a";
globalThis.document = {
  querySelector: (selector) => (selector === "[data-scrivn-user]" && signedIn !== undefined ? { getAttribute: () => signedIn } : null),
  visibilityState: "visible",
  addEventListener() {},
};

/* ── the scripted server ──────────────────────────────────────────────────────────────────────── */

const calls = [];
const server = {
  claims: new Map(),
  /** "online", "offline" (nothing gets through), or "lose-answer" (the next request lands, its answer does not). */
  mode: "online",
  override: null,
  extracts: [],
  generations: [],
  traces: [],
  /** Claims counted, and the documents each generation id was answered with — as lib/usage.ts keeps them (0013). */
  counted: 0,
  answered: new Map(),
  tick: 0,
  version() {
    this.tick += 1;
    return `2026-10-13T12:00:00.${String(this.tick).padStart(6, "0")}+00:00`;
  },
};

function respond(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Reverse every object's keys: jsonb does not keep key order, so a fingerprint must not depend on it. */
function reorder(value) {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).reverse().map((k) => [k, reorder(value[k])]));
  return value;
}

/** What the real route stores for a sent state: parsed, through jsonb. */
const stored = (state) => reorder(mod.parseSavedClaimState(JSON.parse(JSON.stringify(state))));

function handle(path, method, body) {
  if (path === "/api/claims" && method === "POST") {
    const id = body.id;
    const row = server.claims.get(id);
    if (row) return respond(200, { id, version: row.version, existed: true });
    const version = server.version();
    server.claims.set(id, { state: stored(body.state), version });
    return respond(200, { id, version, existed: false });
  }
  const one = /^\/api\/claims\/([^/]+)$/.exec(path);
  if (one) {
    const row = server.claims.get(one[1]);
    if (method === "GET") return row ? respond(200, { state: row.state, version: row.version }) : respond(404, { error: "Claim not found." });
    if (method === "PUT") {
      if (!row) return respond(404, { error: "Claim not found." });
      if (body.base && body.base !== row.version) return respond(409, { error: "Changed.", conflict: { state: row.state, version: row.version } });
      row.state = stored(body.state);
      row.version = server.version();
      return respond(200, { ok: true, version: row.version });
    }
  }
  if (path === "/api/extract") {
    server.extracts.push(body);
    return respond(200, { extraction: mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] }), warnings: [] });
  }
  if (path === "/api/generate") {
    server.generations.push(body);
    // As the real route does (beginGeneration): an id already answered gets the same documents, uncounted.
    if (body.jobId && server.answered.has(body.jobId)) return respond(200, { documents: server.answered.get(body.jobId), usage: [], repeated: true });
    server.counted += 1;
    const documents = { inspectionReport: "INSPECTION", scopeDocument: `SCOPE ${server.counted}` };
    if (body.jobId) server.answered.set(body.jobId, documents);
    return respond(200, { documents });
  }
  if (path === "/api/exterior/trace") {
    server.traces.push(body);
    return respond(200, { proposals: { shapes: [], openings: [], wallTop: null, offWall: [], checks: [], notes: "" }, model: "m", seconds: 1, usage: {}, costUsd: 0.05 });
  }
  if (path === "/manifest.webmanifest") return respond(200, {});
  return respond(404, { error: "No such route." });
}

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method, body });
  if (server.mode === "offline") throw new TypeError("Failed to fetch");
  const path = String(url).split("?")[0];
  const overridden = server.override?.(path, method, body);
  if (overridden instanceof Error) throw overridden;
  if (overridden) return overridden;
  const answer = handle(path, method, body);
  if (server.mode === "lose-answer") {
    server.mode = "online";
    throw new TypeError("Failed to fetch");
  }
  return answer;
};

const mod = await import(pathToFileURL(bundlePath).href);

/* ── harness ──────────────────────────────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];

async function test(name, run) {
  db.reset();
  calls.length = 0;
  server.claims.clear();
  server.mode = "online";
  server.override = null;
  server.extracts.length = 0;
  server.generations.length = 0;
  server.traces.length = 0;
  server.counted = 0;
  server.answered.clear();
  signedIn = "user-a";
  try {
    await run();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n      expected ${e}\n      actual   ${a}`);
}

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const ID2 = "7a2b3c4d-5e6f-4a70-8b81-92a3b4c5d6e7";

function claimState(name, extra = {}) {
  const s = mod.emptySavedClaimState();
  s.claim.customerName = name;
  return { ...s, ...extra };
}

/** A claim as the page writes it: changed on the device, owed to the server. */
async function edit(id, state, { created = true, version = null, user = "user-a", changedAt = Date.now() } = {}) {
  return mod.changeDeviceClaim(id, (r) => ({ ...(r ?? mod.blankDeviceClaim(id, state, user)), state, dirty: true, refused: null, created: r ? r.created : created, version: r ? r.version : version, changedAt }));
}

/** A claim the server has, as the device last saw it. */
async function onServerAndDevice(id, state) {
  const version = server.version();
  server.claims.set(id, { state: stored(state), version });
  await mod.changeDeviceClaim(id, () => ({ ...mod.blankDeviceClaim(id, state, "user-a"), created: true, version }));
  return version;
}

const record = (id) => mod.readDeviceClaim(id);
const puts = () => calls.filter((c) => c.method === "PUT");
const posts = () => calls.filter((c) => c.method === "POST" && c.url === "/api/claims");
const settle = () => new Promise((r) => setTimeout(r, 30));

/* ── fingerprints ─────────────────────────────────────────────────────────────────────────────── */

await test("a state and the server's copy of it have the same fingerprint", async () => {
  const state = claimState("Bell", { transcript: "Water in the basement." });
  equal(mod.stateFingerprint(state), mod.stateFingerprint(stored(state)), "key order and the route's parsing must not change the fingerprint");
  assert(mod.stateFingerprint(state) !== mod.stateFingerprint(claimState("Bell", { transcript: "Water upstairs." })), "different claims must differ");
});

await test("what two copies disagree on is named in words", async () => {
  // One claim, two copies — a blank claim seeds rooms with fresh ids, so build one from the other.
  const mine = claimState("Bell", { transcript: "A" });
  const theirs = { ...structuredClone(mine), transcript: "B", step: "ready" };
  theirs.moisture = { ...theirs.moisture, readings: [{ id: "r1" }] };
  equal(mod.clashDifferences(mine, theirs), ["the transcript", "the moisture map"], "the step alone is not a difference worth naming");
});

/* ── the device store ─────────────────────────────────────────────────────────────────────────── */

await test("the old save queue is carried over on the upgrade, every record still owed", async () => {
  db.seed("scrivn", 1, {
    pendingSaves: {
      keyPath: "key",
      records: [
        { key: ID, claimId: ID, state: claimState("Bell"), queuedAt: 100 },
        { key: "draft-x1", claimId: null, state: claimState("Draft"), queuedAt: 200 },
      ],
    },
  });
  const all = (await mod.allDeviceClaims()).sort((a, b) => a.changedAt - b.changedAt);
  equal(db.shape(), { version: 2, stores: ["aiJobs", "claims"] }, "the old store should be gone and the new ones there");
  equal(all.length, 2, "both queued saves should come across");
  equal([all[0].id, all[0].created, all[0].dirty, all[0].version], [ID, true, true, null], "a saved claim's record keeps its id and is still owed");
  assert(/^[0-9a-f-]{36}$/.test(all[1].id) && !all[1].created && all[1].dirty, "a draft gets an id and is still to be created");

  await mod.syncAll();
  const put = puts()[0];
  assert(put && put.url === `/api/claims/${ID}` && put.body.base === undefined, "a record from before versions is sent as saves always were, with no base");
  assert(posts().some((c) => c.body.id === all[1].id), "the draft is created under its new id");
});

await test("a change on a claim replaces its record rather than adding another", async () => {
  await edit(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — upstairs too"));
  const all = await mod.allDeviceClaims();
  equal(all.length, 1, "one record per claim");
  equal(all[0].state.claim.customerName, "Bell — upstairs too", "the latest state wins");
});

await test("old clean copies are pruned; work the server has not got never is", async () => {
  for (let i = 0; i < 5; i++) {
    const id = `00000000-0000-4000-8000-00000000000${i}`;
    await mod.changeDeviceClaim(id, () => ({ ...mod.blankDeviceClaim(id, claimState(`C${i}`), "user-a"), created: true, version: "v", touchedAt: i }));
  }
  await edit(ID, claimState("Unsynced"), { changedAt: 0 });
  await mod.changeDeviceClaim(ID, (r) => ({ ...r, touchedAt: -1 }));
  await mod.pruneDeviceClaims(2);
  const ids = (await mod.allDeviceClaims()).map((r) => r.id).sort();
  equal(ids, ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004", ID].sort(), "the two newest copies and the unsynced claim remain");
});

/* ── sending ──────────────────────────────────────────────────────────────────────────────────── */

await test("a claim started on the device is created under its own id", async () => {
  await edit(ID, claimState("Bell"), { created: false });
  equal((await mod.syncClaim(ID)).kind, "synced", "it should go");
  equal(posts().map((c) => c.body.id), [ID], "POSTed once, with the device's id");
  const r = await record(ID);
  assert(r.created && !r.dirty && r.version === server.claims.get(ID).version, "the device should now be in step with the server");
});

await test("a create whose answer was lost is not a second claim", async () => {
  await edit(ID, claimState("Bell"), { created: false });
  server.mode = "lose-answer";
  equal((await mod.syncClaim(ID)).kind, "offline", "the device cannot know it landed");
  equal(server.claims.size, 1, "it did land");
  await edit(ID, claimState("Bell — more"));
  equal((await mod.syncClaim(ID)).kind, "synced", "the retry should go");
  equal(server.claims.size, 1, "still one claim");
  equal(server.claims.get(ID).state.claim.customerName, "Bell — more", "and it holds the latest");
});

await test("an existing claim is saved from the version it was opened at", async () => {
  const version = await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — basement"));
  await mod.syncClaim(ID);
  equal(puts()[0].body.base, version, "the save names the version it was made from");
  const r = await record(ID);
  equal([r.dirty, r.version], [false, server.claims.get(ID).version], "and moves on to the new version");
});

await test("with no signal the work stays on the device, owed", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — offline"));
  server.mode = "offline";
  equal((await mod.syncClaim(ID)).kind, "offline", "no signal");
  equal(mod.connection(), "offline", "and the app now knows it");
  const r = await record(ID);
  assert(r.dirty && r.sent.length === 1, "still owed, with what was sent written down");
  server.mode = "online";
  equal((await mod.syncClaim(ID)).kind, "synced", "it goes when the signal is back");
  equal(mod.connection(), "online", "and the app knows that too");
});

await test("a save that landed with its answer lost is not reported as a clash", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — saved once"));
  server.mode = "lose-answer";
  await mod.syncClaim(ID);
  equal((await mod.syncClaim(ID)).kind, "synced", "the server's copy is our own write: no clash");
  const r = await record(ID);
  assert(!r.clash && !r.dirty, "in step, nothing to choose");
});

await test("…nor when more was changed after the lost answer", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — first"));
  server.mode = "lose-answer";
  await mod.syncClaim(ID);
  await edit(ID, claimState("Bell — second"));
  equal((await mod.syncClaim(ID)).kind, "synced", "recognised as our own, then the newer state sent on top");
  equal(server.claims.get(ID).state.claim.customerName, "Bell — second", "the server ends with the latest");
  assert(!(await record(ID)).clash, "and no clash was raised");
});

await test("a real clash keeps both copies and sends nothing over the other", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  // The office changes it while the phone is in the basement.
  const office = claimState("Bell", { transcript: "Office notes." });
  server.claims.set(ID, { state: stored(office), version: server.version() });
  await edit(ID, claimState("Bell", { transcript: "Basement notes." }));
  equal((await mod.syncClaim(ID)).kind, "clash", "refused, and recognised as somebody else's change");
  equal(server.claims.get(ID).state.transcript, "Office notes.", "the office's copy is untouched");
  const r = await record(ID);
  equal([r.state.transcript, r.clash.state.transcript, r.dirty], ["Basement notes.", "Office notes.", true], "the device holds both");
  calls.length = 0;
  equal((await mod.syncClaim(ID)).kind, "clash", "and waits for a decision");
  equal(puts().length, 0, "without sending again");
});

await test("a claim deleted on the server while changed here is kept and asked about", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  server.claims.delete(ID);
  await edit(ID, claimState("Bell — changed"));
  equal((await mod.syncClaim(ID)).kind, "clash", "kept, and asked");
  equal((await record(ID)).clash.state, null, "with nothing on the other side");
});

await test("a save the server refuses is kept, said why, and not retried until it changes", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — too big"));
  server.override = (path, method) => (method === "PUT" ? respond(413, { error: "Too large." }) : undefined);
  equal(await mod.syncClaim(ID), { kind: "refused", message: "Too large." }, "refused with the reason");
  calls.length = 0;
  await mod.syncAll();
  equal(puts().length, 0, "not retried for ever");
  server.override = null;
  await edit(ID, claimState("Bell — smaller"));
  equal((await mod.syncClaim(ID)).kind, "synced", "a change gets its own try");
});

await test("a lost session keeps the work and says so", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — later"));
  server.override = () => respond(401, { error: "Not signed in." });
  equal((await mod.syncClaim(ID)).kind, "signed-out", "signed out");
  assert((await record(ID)).dirty, "still owed");
});

await test("a server failure is tried again later", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — later"));
  server.override = () => respond(503, { error: "Down." });
  equal((await mod.syncClaim(ID)).kind, "failed", "failed");
  server.override = null;
  equal((await mod.syncClaim(ID)).kind, "synced", "and goes next time");
});

await test("edits made while a save is on the wire are sent straight after it", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — one"));
  let first = true;
  server.override = (path, method) => {
    if (method !== "PUT" || !first) return undefined;
    first = false;
    // The page writes a newer state while this save is still out.
    const r = db.records("claims").find((x) => x.id === ID);
    db.put("claims", { ...r, state: claimState("Bell — two"), dirty: true });
    return undefined;
  };
  equal((await mod.syncClaim(ID)).kind, "synced", "both go");
  equal(puts().length, 2, "two saves");
  equal(server.claims.get(ID).state.claim.customerName, "Bell — two", "the newer one last");
  assert(!(await record(ID)).dirty, "and nothing is left owed");
});

await test("two sends of one claim at once do not refuse each other", async () => {
  await onServerAndDevice(ID, claimState("Bell"));
  await edit(ID, claimState("Bell — once"));
  const [a, b] = await Promise.all([mod.syncClaim(ID), mod.syncClaim(ID)]);
  equal([a.kind, b.kind], ["synced", "synced"], "both report it synced");
  equal(puts().length, 1, "one save");
});

await test("everything owed goes oldest first, and stops at the first sign of no signal", async () => {
  await onServerAndDevice(ID, claimState("A"));
  await onServerAndDevice(ID2, claimState("B"));
  await edit(ID2, claimState("B — older"), { changedAt: 1 });
  await edit(ID, claimState("A — newer"), { changedAt: 2 });
  await mod.syncAll();
  equal(puts().map((c) => c.url), [`/api/claims/${ID2}`, `/api/claims/${ID}`], "oldest change first");

  await edit(ID2, claimState("B — offline"), { changedAt: 3 });
  await edit(ID, claimState("A — offline"), { changedAt: 4 });
  server.mode = "offline";
  calls.length = 0;
  const summary = await mod.syncAll();
  equal([calls.length, summary.waiting], [1, 2], "one attempt, then it stops; both still waiting");
});

await test("on a shared device, another person's work is neither sent nor shown", async () => {
  await edit(ID, claimState("Someone else's"), { created: false, user: "user-b" });
  await mod.syncAll();
  equal(posts().length, 0, "not sent while user-a is signed in");
  equal((await mod.syncClaim(ID)).kind, "none", "not theirs to send");
  signedIn = "user-b";
  await mod.syncAll();
  equal(posts().length, 1, "sent once its owner signs in");
  signedIn = undefined;
  equal((await mod.syncClaim(ID)).kind, "none", "and nobody's while signed out");
});

/* ── Claude steps that wait for signal ────────────────────────────────────────────────────────── */

await test("a transcript read with no signal waits, and runs on the claim as it is then", async () => {
  await onServerAndDevice(ID, claimState("Bell", { transcript: "First draft." }));
  server.mode = "offline";
  await mod.waitForSignal(ID, "extract");
  await mod.runWaitingJobs();
  equal(server.extracts.length, 0, "nothing reached the server");
  equal((await mod.waitingJobs()).map((j) => j.kind), ["extract"], "it waits");

  // More is dictated while waiting: the read must use it.
  await edit(ID, claimState("Bell", { transcript: "First draft. And the hallway." }));
  server.mode = "online";
  await mod.runWaitingJobs();
  await settle();
  equal(server.extracts.map((b) => b.transcript), ["First draft. And the hallway."], "read once, from the latest transcript");
  equal((await mod.waitingJobs()).length, 0, "and no longer waiting");
  const r = await record(ID);
  assert(r.state.extraction !== null, "the answer is in the claim on the device");
  assert(server.claims.get(ID).state.extraction !== null, "and synced to the server");
});

await test("documents waiting for signal are not generated — or counted — until it is back", async () => {
  const extraction = mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] });
  await onServerAndDevice(ID, claimState("Bell", { extraction, step: "ready" }));
  server.mode = "offline";
  await mod.waitForSignal(ID, "generate");
  await mod.runWaitingJobs();
  equal(server.generations.length, 0, "no generation reached the server, so none was counted (lib/usage.ts counts on success)");
  server.mode = "online";
  await mod.runWaitingJobs();
  await settle();
  equal(server.generations.length, 1, "generated once");
  const r = await record(ID);
  equal([r.state.documents?.scopeDocument, r.state.step], ["SCOPE 1", "results"], "the documents are on the claim, opened at the results");
});

await test("a generation whose answer is lost is sent again under the same id, and counted once", async () => {
  const extraction = mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] });
  await onServerAndDevice(ID, claimState("Bell", { extraction, step: "ready" }));
  await mod.waitForSignal(ID, "generate");
  const id = (await mod.waitingJobs())[0]?.id;
  assert(typeof id === "string" && id.length === 36, "the waiting generation has its id before it is sent");
  // The server generates and counts; the answer never arrives.
  server.mode = "lose-answer";
  await mod.runWaitingJobs();
  equal([server.generations.length, server.counted], [1, 1], "it reached the server, which counted it");
  equal((await mod.waitingJobs()).map((j) => [j.kind, j.id, j.error]), [["generate", id, null]], "the device still has it waiting, under the same id");
  // Signal back: sent again.
  await mod.runWaitingJobs();
  await settle();
  equal(server.generations.map((b) => b.jobId), [id, id], "the retry carries the same id");
  equal(server.counted, 1, "so the server counted the claim once");
  equal((await record(ID)).state.documents?.scopeDocument, "SCOPE 1", "and the documents it made the first time are on the claim");
  equal((await mod.waitingJobs()).length, 0, "nothing left waiting");
});

await test("a generation the page sent keeps its id when it has to wait", async () => {
  await onServerAndDevice(ID, claimState("Bell", { extraction: mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] }), step: "ready" }));
  server.mode = "offline";
  await mod.waitForSignal(ID, "generate", "11111111-2222-4333-8444-555555555555");
  equal((await mod.waitingJobs())[0]?.id, "11111111-2222-4333-8444-555555555555", "the page's id is the one kept");
  await mod.waitForSignal(ID, "generate");
  equal((await mod.waitingJobs())[0]?.id, "11111111-2222-4333-8444-555555555555", "and asking again for a step already waiting keeps it");
  await mod.setAside(ID, "generate");
  await mod.waitForSignal(ID, "generate");
  assert((await mod.waitingJobs())[0]?.id !== "11111111-2222-4333-8444-555555555555", "a new generation after one set aside is a new id");
});

await test("a retry that finds the first still running waits, rather than failing", async () => {
  const extraction = mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] });
  await onServerAndDevice(ID, claimState("Bell", { extraction, step: "ready" }));
  let busy = true;
  server.override = (path) => (path === "/api/generate" && busy ? ((busy = false), respond(409, { error: "Still being generated.", running: true })) : undefined);
  await mod.waitForSignal(ID, "generate");
  await mod.runWaitingJobs();
  equal((await mod.waitingJobs()).map((j) => j.error), [null], "still waiting, with no error for the estimator to deal with");
  await mod.runWaitingJobs();
  await settle();
  equal([(await mod.waitingJobs()).length, server.counted], [0, 1], "the next run gets it");
});

await test("a step the server refuses waits for the estimator instead of looping", async () => {
  const extraction = mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] });
  await onServerAndDevice(ID, claimState("Bell", { extraction }));
  server.override = (path) => (path === "/api/generate" ? respond(402, { error: "Plan limit reached." }) : undefined);
  await mod.waitForSignal(ID, "generate");
  await mod.runWaitingJobs();
  equal((await mod.waitingJobs())[0]?.error, "Plan limit reached.", "the reason is kept");
  calls.length = 0;
  await mod.runWaitingJobs();
  equal(calls.filter((c) => c.url === "/api/generate").length, 0, "not tried again by itself");
  server.override = null;
  await mod.tryAgain(ID, "generate");
  await mod.runWaitingJobs();
  equal(server.generations.length, 1, "Try again runs it");
});

await test("a step for the claim on screen is handed to the page, not written behind its back", async () => {
  await onServerAndDevice(ID, claimState("Bell", { transcript: "Device copy." }));
  let got = null;
  const off = mod.claimOnScreen(ID, {
    state: () => claimState("Bell", { transcript: "What the page holds." }),
    extracted: (extraction) => (got = extraction),
    generated: () => {},
  });
  await mod.waitForSignal(ID, "extract");
  await mod.runWaitingJobs();
  off();
  equal(server.extracts.map((b) => b.transcript), ["What the page holds."], "read from the page's state, which may be newer than the device's");
  assert(got !== null, "the page was given the answer");
  equal((await record(ID)).state.extraction, null, "and the device copy was left for the page's own save");
});

await test("a set-aside step does not run", async () => {
  await onServerAndDevice(ID, claimState("Bell", { transcript: "Words." }));
  server.mode = "offline";
  await mod.waitForSignal(ID, "extract");
  await mod.setAside(ID, "extract");
  server.mode = "online";
  await mod.runWaitingJobs();
  equal(server.extracts.length, 0, "nothing sent");
});

await test("a trace waits for signal and its answer is kept until the side is on screen", async () => {
  server.mode = "offline";
  await mod.waitForSignalToTrace("side-1", { image: "abc", frame: {}, side: { name: "Front" } });
  await mod.runWaitingJobs();
  equal(server.traces.length, 0, "not traced with no signal");
  server.mode = "online";
  await mod.runWaitingJobs();
  equal(server.traces.length, 1, "traced once the signal is back");
  const taken = await mod.takeTrace("side-1");
  assert(taken?.result?.proposals, "the answer is there to take");
  equal(await mod.takeTrace("side-1"), null, "and only once");
});

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

rmSync(outDir, { recursive: true, force: true });

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const failure of failures) console.log(`  ✗ ${failure}\n`);
process.exit(failures.length === 0 ? 0 : 1);
