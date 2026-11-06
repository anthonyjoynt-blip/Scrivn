/**
 * The scope-upload read route (app/api/scope-upload/read/route.ts), with Next, Supabase, the usage gate, the request
 * guard and Claude stood in for (the hand-sketch route's shims, test/handSketch/routeShims.mjs). No network, no paid
 * call: the model's answer is the hand-written sample in fixtures/.
 *
 *   node test/scopeUpload/route.mjs
 *
 * Checks the order nothing is spent before: 400/413, the dev fixture, 403 (reads off), 401/402 (the plan), 429 (the
 * account's day, then everyone's), then the call (a photo as an image, a PDF as a document), and 200 or 502.
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
process.chdir(root);

const outDir = join(root, "node_modules", ".cache", "scope-upload-route");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, `route-${process.pid}.mjs`);
const shims = join(root, "test", "handSketch", "routeShims.mjs");
await build({
  stdin: {
    contents: `
      export { POST, maxDuration } from "@/app/api/scope-upload/read/route";
      export { SCOPE_READS_OFF, SCOPE_UPLOAD_MAX_BYTES } from "@/lib/scopeUploadRead";
      export { SCOPE_READ_SYSTEM, SCOPE_READ_SCHEMA } from "@/lib/scopeUploadPrompt";
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
      name: "scope-upload-route-shims",
      setup(b) {
        const shimmed = new Set(["lib/usage", "lib/requestGuard", "lib/anthropic", "lib/supabase/server"].map((p) => join(root, p)));
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
const sample = JSON.parse(readFileSync(join(here, "fixtures", "sample.model.json"), "utf8"));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(400).fill(7)]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(400).fill(7)]);
const PDF = new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(400));
const ENV = ["SCRIVN_SCOPE_READS", "SCOPE_UPLOAD_READ_FIXTURE", "NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

/** A signed-in account its plan allows, reads off, Supabase configured, development. */
function world(over = {}) {
  for (const k of ENV) delete process.env[k];
  process.env.NODE_ENV = "development";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  const { env = {}, ...rest } = over;
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  globalThis.__hsWorld = { blocked: null, organizationId: ORG, userId: USER, usageChecks: 0, hits: [], limitsAllowed: false, over: {}, calls: [], callAllowed: false, answer: sample.wire, ...rest };
  return globalThis.__hsWorld;
}
const on = { SCRIVN_SCOPE_READS: "on" };
/** A form with the file and, when given, which page of how many. */
function post({ bytes = JPEG, name = "page.jpg", type = "image/jpeg", page, pages, noFile = false, raw } = {}) {
  let body;
  if (raw !== undefined) body = raw;
  else {
    body = new FormData();
    if (!noFile) body.append("file", new File([bytes], name, { type }));
    if (page !== undefined) body.append("page", String(page));
    if (pages !== undefined) body.append("pages", String(pages));
  }
  return m.POST(new Request("https://scrivn.test/api/scope-upload/read", { method: "POST", body, ...(raw !== undefined ? { headers: { "content-type": "text/plain" } } : {}) }));
}
async function answer(opts) {
  const res = await post(opts);
  return [res.status, await res.json()];
}
function nothingSpent(w, what) {
  equal(w.calls.length, 0, `${what}: no Claude call`);
  equal(w.hits.length, 0, `${what}: nothing counted`);
}

console.log("\n  Scope-upload read route");
const say = console.log;
console.log = () => {};
console.error = () => {};

await test("maxDuration is 120", async () => equal(m.maxDuration, 120, "maxDuration"));

await test("400 and 413: not a form, no file, an empty one, not a photo or PDF, too big", async () => {
  const w = world({ env: on });
  equal((await post({ raw: "not a form" })).status, 400, "not a form");
  equal((await post({ noFile: true })).status, 400, "no file");
  equal((await post({ bytes: new Uint8Array(0) })).status, 400, "an empty file");
  equal((await post({ bytes: new TextEncoder().encode("GIF89a" + "x".repeat(50)), name: "a.gif", type: "image/gif" })).status, 400, "a GIF");
  equal((await post({ bytes: new TextEncoder().encode("PK\u0003\u0004 a word file"), name: "a.docx", type: "application/octet-stream" })).status, 400, "a Word file");
  const big = new Uint8Array(m.SCOPE_UPLOAD_MAX_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  equal((await post({ bytes: big })).status, 413, "too big");
  equal(w.usageChecks, 0, "the plan is not checked");
  nothingSpent(w, "400s");
});

await test("200 from the dev fixture: its recorded read, with reads off, nothing checked or counted", async () => {
  const w = world({ env: { SCOPE_UPLOAD_READ_FIXTURE: "sample" } });
  const [status, body] = await answer({});
  equal(status, 200, "200");
  equal(body.read, sample.read, "the recorded read");
  equal(w.usageChecks, 0, "the plan is not checked");
  nothingSpent(w, "the fixture");
});

await test("the dev fixture is never read in production, and a name that is not plain is ignored", async () => {
  let w = world({ env: { SCOPE_UPLOAD_READ_FIXTURE: "sample", NODE_ENV: "production" } });
  equal((await post({})).status, 403, "production: reads off");
  nothingSpent(w, "production");
  w = world({ env: { SCOPE_UPLOAD_READ_FIXTURE: "../../etc/passwd" } });
  equal((await post({})).status, 403, "a path: reads off");
  nothingSpent(w, "a path");
  w = world({ env: { SCOPE_UPLOAD_READ_FIXTURE: "missing" } });
  equal((await post({})).status, 500, "a missing fixture says so");
  nothingSpent(w, "a missing fixture");
});

await test("403 while reads are off: nothing checked, counted or called", async () => {
  const w = world();
  const [status, body] = await answer({});
  equal(status, 403, "403");
  equal(body.error, m.SCOPE_READS_OFF, "the reads-off sentence");
  equal(w.usageChecks, 0, "the plan is not checked");
  nothingSpent(w, "reads off");
});

await test("401 and 402 from the plan: nothing counted or called", async () => {
  for (const status of [401, 402]) {
    const w = world({ env: on, blocked: { error: "x", status } });
    equal((await post({})).status, status, `${status}`);
    nothingSpent(w, `${status}`);
  }
  const w = world({ env: on, organizationId: null, userId: null });
  equal((await post({})).status, 401, "nobody to count against");
  nothingSpent(w, "nobody");
});

await test("429 past the account's day, then everyone's; the second only once the first passes", async () => {
  let w = world({ env: on, limitsAllowed: true, over: { "scope-upload-org": new Date(Date.now() + 3 * 3600_000) } });
  equal((await post({})).status, 429, "the account");
  equal(w.hits.map((h) => h.bucket), ["scope-upload-org"], "only the account's bucket counted");
  equal(w.hits[0].max, 60, "60 pages an account a day");
  equal(w.calls.length, 0, "no call");
  w = world({ env: on, limitsAllowed: true, over: { "scope-upload-all": new Date(Date.now() + 3600_000) } });
  equal((await post({})).status, 429, "everyone");
  equal(w.hits.map((h) => [h.bucket, h.max]), [["scope-upload-org", 60], ["scope-upload-all", 600]], "both counted, in order");
  equal(w.calls.length, 0, "no call");
});

await test("200: a photo goes as an image, which page of how many is said, and the read comes back", async () => {
  const w = world({ env: on, limitsAllowed: true, callAllowed: true });
  const [status, body] = await answer({ page: 2, pages: 3 });
  equal(status, 200, "200");
  equal(body.read, sample.read, "the read");
  equal(w.calls.length, 1, "one call");
  const c = w.calls[0];
  equal(c.system, m.SCOPE_READ_SYSTEM, "the scope reader's system prompt");
  equal(c.schema, m.SCOPE_READ_SCHEMA, "its schema");
  equal(c.images?.map((i) => i.mediaType), ["image/jpeg"], "the photo as a JPEG image");
  equal(c.documents, undefined, "no document");
  equal(c.userMessage.includes("page 2 of the 3"), true, "the page and the count");
  equal(c.effort, "medium", "medium effort");
});

await test("200: a PNG is sent as one; a PDF as a document; a page past the count is the last", async () => {
  let w = world({ env: on, limitsAllowed: true, callAllowed: true });
  equal((await post({ bytes: PNG, name: "p.png", type: "image/png" })).status, 200, "PNG");
  equal(w.calls[0].images.map((i) => i.mediaType), ["image/png"], "as a PNG");
  w = world({ env: on, limitsAllowed: true, callAllowed: true });
  equal((await post({ bytes: PDF, name: "scope.pdf", type: "application/pdf", page: 9, pages: 2 })).status, 200, "PDF");
  equal(w.calls[0].documents.map((d) => d.mediaType), ["application/pdf"], "as a PDF document");
  equal(w.calls[0].images, undefined, "no image");
  equal(w.calls[0].userMessage.includes("page 2 of the 2"), true, "page 9 of 2 is read as the last");
});

await test("502: nothing read off the page, and the call failing", async () => {
  let w = world({ env: on, limitsAllowed: true, callAllowed: true, answer: { pageKind: "other", continuing: [], rooms: [], general: [], notes: [], unreadable: ["all of it"] } });
  equal((await post({})).status, 502, "an empty read");
  w = world({ env: on, limitsAllowed: true, callAllowed: true, answer: new m.ScopingApiError("Rate limited by the Claude API — wait a moment and try again.") });
  equal(await answer({}), [502, { error: "Rate limited by the Claude API — wait a moment and try again." }], "its message");
  w = world({ env: on, limitsAllowed: true, callAllowed: true, answer: new Error("socket hang up") });
  equal(await answer({}), [502, { error: "Reading the scope failed unexpectedly." }], "a plain sentence");
});

console.log = say;
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
