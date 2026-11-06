/**
 * The hand-sketch read route (app/api/hand-sketch/read/route.ts), with Next, Supabase, the usage
 * gate, the request guard and Claude stood in for (routeShims.mjs). No network, no paid call: the
 * model's answer is a recorded one from fixtures/.
 *
 *   node test/handSketch/route.mjs
 *
 * Checks the order nothing is spent before: 400, the dev fixture, 403 (reads off), 401/402 (the
 * plan), 429 (the account's day, then everyone's), then the call, and 200 or 502 on its answer.
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
process.chdir(root);

const outDir = join(root, "node_modules", ".cache", "hand-sketch-route");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, `route-${process.pid}.mjs`);
const shims = join(here, "routeShims.mjs");
await build({
  stdin: {
    contents: `
      export { POST, maxDuration } from "@/app/api/hand-sketch/read/route";
      export { handSketchReadAvailable, HAND_SKETCH_READS_OFF } from "@/lib/handSketchRead";
      export { HAND_SKETCH_SYSTEM, HAND_SKETCH_SCHEMA, readFromWire } from "@/lib/handSketchPrompt";
      export { ScopingApiError } from "@/lib/anthropic";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  alias: { "@": root },
  packages: "external",
  logLevel: "error",
  plugins: [
    {
      name: "hand-sketch-route-shims",
      setup(b) {
        const shimmed = new Set(["lib/usage", "lib/requestGuard", "lib/anthropic", "lib/supabase/server"].map((m) => join(root, m)));
        b.onResolve({ filter: /^next\/server$/ }, () => ({ path: shims }));
        b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
        b.onLoad({ filter: /^server-only$/, namespace: "stub" }, () => ({ contents: "", loader: "js" }));
        b.onResolve({ filter: /^(@\/|\.{1,2}\/)/ }, (args) => {
          const target = args.path.startsWith("@/") ? join(root, args.path.slice(2)) : join(args.resolveDir, args.path);
          return shimmed.has(target.replace(/\.tsx?$/, "")) ? { path: shims } : undefined;
        });
      },
    },
  ],
});
const m = await import(pathToFileURL(outfile).href);
rmSync(outfile, { force: true });

let passed = 0;
const failures = [];
async function test(name, run) {
  try {
    await run();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function equal(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n      expected ${b}\n      got      ${a}`);
}

/* ── the world ────────────────────────────────────────────────────────────────────────────────── */

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu";
const spare = JSON.parse(readFileSync(join(here, "fixtures", "spare.model.json"), "utf8"));
const IMAGE = "/9j/" + "A".repeat(400);
const good = { image: `data:image/jpeg;base64,${IMAGE}`, width: 1050, height: 1400 };
const ENV = ["SCRIVN_HAND_SKETCH_READS", "HAND_SKETCH_READ_FIXTURE", "NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

/** A signed-in account its plan allows, reads off, Supabase configured, development. */
function world(over = {}) {
  for (const k of ENV) delete process.env[k];
  process.env.NODE_ENV = "development";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  const { env = {}, ...rest } = over;
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  globalThis.__hsWorld = { blocked: null, organizationId: ORG, userId: USER, usageChecks: 0, hits: [], limitsAllowed: false, over: {}, calls: [], callAllowed: false, answer: spare.wire, ...rest };
  return globalThis.__hsWorld;
}
const on = { SCRIVN_HAND_SKETCH_READS: "on" };
const post = (body) =>
  m.POST(new Request("https://scrivn.test/api/hand-sketch/read", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } }));
async function answer(body) {
  const res = await post(body);
  return [res.status, await res.json()];
}
function nothingSpent(w, what) {
  equal(w.calls.length, 0, `${what}: no Claude call`);
  equal(w.hits.length, 0, `${what}: nothing counted`);
}

console.log("\n  Hand-sketch read route");
// The route's own log lines and the errors it is made to meet are noise here; the summary uses `say`.
const say = console.log;
console.log = () => {};
console.error = () => {};

await test("maxDuration is 60", async () => equal(m.maxDuration, 60, "maxDuration"));

await test("400: not JSON, not a JPEG, too big, a size that is not a whole number from 1 to 1600", async () => {
  const w = world({ env: on, limitsAllowed: false });
  const bad = [
    "not json",
    { ...good, image: "iVBORw0KGgo" + "A".repeat(50) },
    { ...good, image: "/9j/" + "A".repeat(2_500_000) },
    { ...good, image: "" },
    { ...good, width: 0 },
    { ...good, width: 1601 },
    { ...good, height: 12.5 },
    { ...good, height: "1400" },
    { image: good.image, width: 1050 },
    null,
  ];
  for (const body of bad) equal((await post(body)).status, 400, `400 for ${JSON.stringify(body)?.slice(0, 60)}`);
  equal(w.usageChecks, 0, "the plan is not checked");
  nothingSpent(w, "400s");
});

await test("200 from the dev fixture: its recorded read, with reads off, nothing checked or counted", async () => {
  const w = world({ env: { HAND_SKETCH_READ_FIXTURE: "spare" } });
  const [status, body] = await answer(good);
  equal(status, 200, "200");
  equal(body.read, spare.read, "the fixture's read");
  equal(w.usageChecks, 0, "the plan is not checked");
  nothingSpent(w, "fixture");
});

await test("the dev fixture: a name that is not plain, or production, is ignored; a missing one is a 500", async () => {
  let w = world({ env: { HAND_SKETCH_READ_FIXTURE: "../spare" } });
  equal((await post(good)).status, 403, "a path is not a name: on to the flag");
  nothingSpent(w, "path");
  w = world({ env: { HAND_SKETCH_READ_FIXTURE: "spare", NODE_ENV: "production" } });
  equal((await post(good)).status, 403, "never in production");
  nothingSpent(w, "production");
  w = world({ env: { ...on, HAND_SKETCH_READ_FIXTURE: "nope" } });
  equal((await post(good)).status, 500, "a fixture that is not there");
  nothingSpent(w, "missing fixture");
});

await test("403: reads off unless SCRIVN_HAND_SKETCH_READS=on, before the plan is checked", async () => {
  for (const flag of [undefined, "off", "yes", ""]) {
    const w = world({ env: { SCRIVN_HAND_SKETCH_READS: flag } });
    const [status, body] = await answer(good);
    equal([status, body.error], [403, m.HAND_SKETCH_READS_OFF], `403 with ${flag}`);
    equal(w.usageChecks, 0, "the plan is not checked");
    nothingSpent(w, `flag ${flag}`);
  }
});

await test("401 and 402, as checkUsageAllowed gives them, before anything is counted", async () => {
  for (const blocked of [{ error: "Not authenticated.", status: 401 }, { error: "You’ve used all 5 claims in your free trial.", status: 402 }]) {
    const w = world({ env: { SCRIVN_HAND_SKETCH_READS: "ON" }, blocked });
    equal(await answer(good), [blocked.status, { error: blocked.error }], `${blocked.status}`);
    nothingSpent(w, `${blocked.status}`);
  }
});

await test("429: the account's day, counted against its organization; everyone's not counted then", async () => {
  const w = world({ env: on, limitsAllowed: true, over: { "hand-sketch-org": new Date(Date.now() + 3 * 3600_000) } });
  const [status, body] = await answer(good);
  equal(status, 429, "429");
  if (!/20 sketches/.test(body.error)) throw new Error(`a plain sentence: ${body.error}`);
  equal(w.hits, [{ bucket: "hand-sketch-org", key: `account:${ORG}`, windowSeconds: 86400, max: 20 }], "only the account counted");
  equal(w.calls.length, 0, "no Claude call");
});

await test("429: everyone's day, once the account's passes", async () => {
  const w = world({ env: on, limitsAllowed: true, over: { "hand-sketch-all": new Date(Date.now() + 3600_000) } });
  equal((await post(good)).status, 429, "429");
  equal(w.hits.map((h) => [h.bucket, h.key, h.windowSeconds, h.max]), [["hand-sketch-org", `account:${ORG}`, 86400, 20], ["hand-sketch-all", "all", 86400, 300]], "account, then everyone");
  equal(w.calls.length, 0, "no Claude call");
});

await test("a person with no organization is counted as themself", async () => {
  const w = world({ env: on, limitsAllowed: true, callAllowed: true, organizationId: null });
  equal((await post(good)).status, 200, "200");
  equal(w.hits[0].key, `account:${USER}`, "the person's own key");
});

await test("200 from the call: the recorded answer, read back; one call with the photo, size and 12000 tokens; nothing logged of the photo", async () => {
  const w = world({ env: on, limitsAllowed: true, callAllowed: true });
  const logged = [];
  const log = console.log;
  console.log = (...a) => logged.push(a.join(" "));
  let status, body;
  try {
    [status, body] = await answer(good);
  } finally {
    console.log = log;
  }
  equal(status, 200, "200");
  equal(body.read, m.readFromWire(spare.wire), "the read from the wire");
  equal(body.read, spare.read, "the same read live.mjs saved");
  equal(w.calls.length, 1, "one call");
  const c = w.calls[0];
  equal([c.system === m.HAND_SKETCH_SYSTEM, c.schema === m.HAND_SKETCH_SCHEMA, c.maxTokens, c.images], [true, true, 12000, [{ mediaType: "image/jpeg", data: IMAGE }]], "the call");
  if (!c.userMessage.includes("1050 x 1400")) throw new Error(`the size in the message: ${c.userMessage}`);
  if (logged.some((l) => l.includes(IMAGE.slice(0, 40)))) throw new Error("the photo was logged");
});

await test("502: an answer that is not rooms, a ScopingApiError, anything else", async () => {
  const room = spare.wire.rooms[0];
  for (const [answerWith, says] of [
    [{ ...spare.wire, rooms: [] }, /no rooms/],
    [{ ...spare.wire, rooms: [{ ...room, corners: room.corners.slice(0, 2), walls: room.walls.slice(0, 2), openings: [], items: [] }] }, /fewer than 3 corners/],
  ]) {
    world({ env: on, limitsAllowed: true, callAllowed: true, answer: answerWith });
    const [status, body] = await answer(good);
    equal(status, 502, "502");
    if (!says.test(body.error)) throw new Error(`says why: ${body.error}`);
  }
  world({ env: on, limitsAllowed: true, callAllowed: true, answer: new m.ScopingApiError("Rate limited by the Claude API — wait a moment and try again.") });
  equal(await answer(good), [502, { error: "Rate limited by the Claude API — wait a moment and try again." }], "its message");
  world({ env: on, limitsAllowed: true, callAllowed: true, answer: new Error("socket hang up") });
  equal(await answer(good), [502, { error: "Reading the sketch failed unexpectedly." }], "a plain sentence");
});

await test("handSketchReadAvailable: a fixture; dev without Supabase with reads on; signed in, allowed and on", async () => {
  world({ env: { HAND_SKETCH_READ_FIXTURE: "spare" }, blocked: { error: "x", status: 401 } });
  equal(await m.handSketchReadAvailable(), true, "a fixture");
  world({ env: { NEXT_PUBLIC_SUPABASE_URL: undefined, SCRIVN_HAND_SKETCH_READS: "on" } });
  equal(await m.handSketchReadAvailable(), true, "dev without Supabase, reads on");
  world({ env: { NEXT_PUBLIC_SUPABASE_URL: undefined } });
  equal(await m.handSketchReadAvailable(), false, "dev without Supabase, reads off: the free path instead");
  world({ env: { NEXT_PUBLIC_SUPABASE_URL: undefined, NODE_ENV: "production" }, blocked: { error: "x", status: 401 } });
  equal(await m.handSketchReadAvailable(), false, "never so in production");
  world({});
  equal(await m.handSketchReadAvailable(), false, "reads off");
  world({ env: on });
  equal(await m.handSketchReadAvailable(), true, "on and allowed");
  world({ env: on, blocked: { error: "x", status: 402 } });
  equal(await m.handSketchReadAvailable(), false, "402");
  world({ env: on, blocked: { error: "x", status: 401 } });
  equal(await m.handSketchReadAvailable(), false, "signed out");
});

for (const f of failures) say(`  FAIL ${f}`);
say(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) process.exit(1);
