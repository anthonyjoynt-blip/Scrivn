/**
 * The offline save queue — what happens to work the server has not accepted.
 *
 *   npm run test:pending
 *
 * This is the mechanism that stands between a PM scoping a job in a basement with no signal and
 * that job being gone. The failure modes it has to be right about are all silent ones:
 *
 *   * work queued and then never sent
 *   * work sent twice, so one job appears on the list as two half-filled claims
 *   * work dropped because a request came back non-200, whatever the reason
 *   * a record retried for ever against a claim that no longer exists, so the warning never clears
 *
 * None of those announce themselves in the UI, which is why they are tested here rather than left
 * to be noticed. The real module runs — see fakeIndexedDB.mjs for why a fake store is the honest
 * choice under Node — with `fetch` scripted per test.
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
  entryPoints: [join(root, "lib", "pendingSaves.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: bundlePath,
  logLevel: "silent",
});

const store = installFakeIndexedDB();
const mod = await import(pathToFileURL(bundlePath).href);
const { queuePendingSave, pendingSaves, dropPendingSave, drainPendingSaves, drainInProgress, draftVerdict, newDraftKey } =
  mod;

let passed = 0;
const failures = [];

async function test(name, run) {
  store.reset();
  calls.length = 0;
  responder = () => ok({ id: "server-id" });
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

/* ── the scripted network ─────────────────────────────────────────────────────────────────────── */

const calls = [];
let responder = () => ok({ id: "server-id" });

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

function status(code) {
  return { ok: false, status: code, json: async () => ({ error: `HTTP ${code}` }) };
}

globalThis.fetch = async (url, init) => {
  calls.push({ url, method: init?.method, body: JSON.parse(init?.body ?? "{}") });
  const result = responder(calls.length, url, init);
  if (result instanceof Error) throw result;
  return result;
};

/** A claim state stub — the queue treats it as an opaque blob, so its shape does not matter here. */
const stateFor = (name) => ({ customerName: name });

async function queue(key, claimId, name, queuedAt = Date.now()) {
  const done = await queuePendingSave({ key, claimId, state: stateFor(name), queuedAt });
  assert(done, `queuePendingSave reported failure for ${key}`);
}

/* ── storing ──────────────────────────────────────────────────────────────────────────────────── */

await test("a queued save is written to the device", async () => {
  await queue("claim-1", "claim-1", "Bell");
  const held = await pendingSaves();
  equal(held.length, 1, "expected exactly one queued record");
  equal(held[0].state, stateFor("Bell"), "the queued record should hold the state it was given");
});

await test("re-queuing a claim replaces it rather than adding a second copy", async () => {
  // The case this protects: a save failing on every keystroke while there is no signal. An
  // append-only queue would fill the device with near-identical copies of one claim.
  await queue("claim-1", "claim-1", "Bell", 1);
  await queue("claim-1", "claim-1", "Bell — second floor too", 2);
  const held = await pendingSaves();
  equal(held.length, 1, "expected one record per claim, not one per failure");
  equal(held[0].state, stateFor("Bell — second floor too"), "the latest state should win");
});

await test("queued saves come back oldest first", async () => {
  await queue("b", "b", "second", 2000);
  await queue("a", "a", "first", 1000);
  await queue("c", "c", "third", 3000);
  equal(
    (await pendingSaves()).map((r) => r.key),
    ["a", "b", "c"],
    "a claim that has been waiting longest should be pushed first",
  );
});

await test("dropping a save removes it", async () => {
  await queue("claim-1", "claim-1", "Bell");
  await dropPendingSave("claim-1");
  equal((await pendingSaves()).length, 0, "expected the record to be gone");
});

/* ── pushing ──────────────────────────────────────────────────────────────────────────────────── */

await test("a record with a claim id is PUT to that claim and then cleared", async () => {
  await queue("claim-1", "claim-1", "Bell");
  const result = await drainPendingSaves();
  equal(calls.length, 1, "expected exactly one request");
  equal(calls[0].method, "PUT", "an existing claim should be updated, not created again");
  equal(calls[0].url, "/api/claims/claim-1", "the request should address the claim by id");
  equal(calls[0].body.state, stateFor("Bell"), "the queued state should be what is sent");
  equal(result, { pushed: 1, remaining: 0 }, "expected the record to be reported pushed and gone");
  equal((await pendingSaves()).length, 0, "an accepted record must not be sent again later");
});

await test("a record with no claim id is POSTed and its new id handed back", async () => {
  await queue("draft-x", null, "Bell");
  const created = [];
  await drainPendingSaves({ onCreated: (record, id) => created.push([record.key, id]) });
  equal(calls[0].method, "POST", "a claim the server has never seen has to be created");
  equal(calls[0].url, "/api/claims", "creation posts to the collection");
  equal(created, [["draft-x", "server-id"]], "the caller must learn the id, or it will POST again");
  equal((await pendingSaves()).length, 0, "expected the draft to be cleared once created");
});

await test("everything held is pushed, not just the claim on screen", async () => {
  await queue("claim-1", "claim-1", "Bell", 1);
  await queue("claim-2", "claim-2", "Okafor", 2);
  const result = await drainPendingSaves();
  equal(calls.length, 2, "expected both claims to be sent");
  equal(result.pushed, 2, "both should be reported pushed");
});

/* ── what happens when the push fails ─────────────────────────────────────────────────────────── */

await test("a claim the server says is gone is dropped, not retried for ever", async () => {
  // Otherwise the "waiting to save" warning can never be cleared and the request repeats on every
  // app open, neither of which brings the claim back.
  await queue("claim-1", "claim-1", "Bell");
  responder = () => status(404);
  const result = await drainPendingSaves();
  equal(result, { pushed: 0, remaining: 0 }, "expected the record to be dropped without counting as pushed");
});

await test("an expired session keeps the work queued", async () => {
  // A 401 is recoverable — signing in again should not have cost the PM the claim.
  await queue("claim-1", "claim-1", "Bell");
  responder = () => status(401);
  const result = await drainPendingSaves();
  equal(result.remaining, 1, "a 401 must not throw work away");
});

await test("a server error keeps the work queued", async () => {
  await queue("claim-1", "claim-1", "Bell");
  responder = () => status(503);
  equal((await drainPendingSaves()).remaining, 1, "a 5xx is worth trying again later");
});

await test("no network keeps the work and stops trying the rest", async () => {
  await queue("claim-1", "claim-1", "Bell", 1);
  await queue("claim-2", "claim-2", "Okafor", 2);
  responder = () => new Error("Failed to fetch");
  const result = await drainPendingSaves();
  equal(calls.length, 1, "once one request fails for want of a network the rest will too");
  equal(result.remaining, 2, "nothing should be lost");
});

await test("a claim already sent is not sent twice when a later one fails", async () => {
  await queue("claim-1", "claim-1", "Bell", 1);
  await queue("claim-2", "claim-2", "Okafor", 2);
  responder = (n) => (n === 1 ? ok({}) : new Error("Failed to fetch"));
  await drainPendingSaves();
  equal(
    (await pendingSaves()).map((r) => r.key),
    ["claim-2"],
    "the accepted claim should be cleared even though the pass ended badly",
  );
});

/* ── not sending the same claim twice ─────────────────────────────────────────────────────────── */

await test("a record can be held back for a later pass", async () => {
  await queue("draft-x", null, "Bell");
  const result = await drainPendingSaves({ decide: () => "wait" });
  equal(calls.length, 0, "a held-back record must not be sent");
  equal(result.remaining, 1, "and must still be there afterwards");
});

await test("a record can be discarded without being sent", async () => {
  await queue("draft-x", null, "Bell");
  const result = await drainPendingSaves({ decide: () => "drop" });
  equal(calls.length, 0, "a discarded record must not be sent");
  equal(result.remaining, 0, "and must be gone");
});

await test("two pushes at once make one pass, not two", async () => {
  // `online` firing at the same moment as the interval tick is the real case. Two passes would
  // POST the same queued draft twice and create the job twice.
  await queue("draft-x", null, "Bell");
  const both = await Promise.all([drainPendingSaves(), drainPendingSaves()]);
  equal(calls.length, 1, "expected the second caller to join the first pass");
  equal(both[0], both[1], "both callers should get the same result");
});

await test("a caller can wait for a push that is already running", async () => {
  await queue("claim-1", "claim-1", "Bell");
  assert(drainInProgress() === null, "nothing should be in progress before a push starts");
  const running = drainPendingSaves();
  assert(drainInProgress() !== null, "a push in progress must be visible to a caller that has to wait for it");
  await running;
  assert(drainInProgress() === null, "and must clear once it has finished");
});

/* ── the rules for the claim being edited right now ───────────────────────────────────────────── */

const DRAFT = "draft-abc";

await test("another claim's record is always sent", async () => {
  equal(
    draftVerdict({ recordKey: "claim-9", draftKey: DRAFT, claimId: null, saving: true }),
    "send",
    "the rules for the page's own draft must not touch anyone else's claim",
  );
});

await test("the page's own draft waits while its save is in flight", async () => {
  // Both would POST the same work. The result would be one job on the list as two claims.
  equal(
    draftVerdict({ recordKey: DRAFT, draftKey: DRAFT, claimId: null, saving: true }),
    "wait",
    "expected the queue to defer to the save already going out",
  );
});

await test("the page's own draft is sent when nothing else is saving it", async () => {
  equal(draftVerdict({ recordKey: DRAFT, draftKey: DRAFT, claimId: null, saving: false }), "send", "expected it to go");
});

await test("a draft record is discarded once the page has a real claim id", async () => {
  // Its work reached the server under that id. Sending it would create a second claim.
  equal(
    draftVerdict({ recordKey: DRAFT, draftKey: DRAFT, claimId: "claim-1", saving: false }),
    "drop",
    "expected a superseded draft record to be discarded rather than sent",
  );
});

await test("draft keys are unique per page", async () => {
  const keys = new Set(Array.from({ length: 200 }, () => newDraftKey()));
  equal(keys.size, 200, "two devices queuing a first save must not collide on one key");
});

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

rmSync(outDir, { recursive: true, force: true });

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const failure of failures) console.log(`  ✗ ${failure}\n`);
process.exit(failures.length === 0 ? 0 : 1);
