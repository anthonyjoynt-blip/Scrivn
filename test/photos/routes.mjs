/**
 * The photo routes themselves, with Supabase stood in for (test/photos/routeShims.mjs) — who may
 * store, list and delete a claim's pictures, and what deleting a claim takes with it.
 *
 *   npm run test:photos:routes
 *
 * The bucket's own policy is tested against the migration in test/rls/local.mjs. This checks the
 * other half: that the server, which writes with the service role, only does so for a member whose
 * own session can see the claim, for a photo the claim lists, and that sending a picture twice leaves
 * one picture.
 */

import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
// A configured project, so the dev fail-open stays out of it.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const outDir = join(root, "node_modules", ".cache", "photo-routes");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, `routes-${process.pid}.mjs`);
const shims = join(here, "routeShims.mjs");
await build({
  stdin: {
    contents: `
      export { POST as postPhoto, DELETE as deletePhoto } from "@/app/api/claims/[id]/photos/[photoId]/route";
      export { GET as listPhotos } from "@/app/api/claims/[id]/photos/route";
      export { DELETE as deleteClaimRoute } from "@/app/api/claims/[id]/route";
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
      name: "photo-route-shims",
      setup(b) {
        const shimmed = new Set(["lib/supabase/admin", "lib/supabase/server"].map((m) => join(root, m)));
        b.onResolve({ filter: /^(server-only|next\/server)$/ }, () => ({ path: shims }));
        b.onResolve({ filter: /^(@\/|\.{1,2}\/)/ }, (args) => {
          const target = args.path.startsWith("@/") ? join(root, args.path.slice(2)) : join(args.resolveDir, args.path);
          return shimmed.has(target.replace(/\.tsx?$/, "")) ? { path: shims } : undefined;
        });
        b.onResolve({ filter: /^next\/(link|headers|navigation)$/ }, (args) => ({ path: `${args.path}.js`, external: true }));
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

const ACME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLAIM = "11111111-1111-4111-8111-111111111111";
const OTHER_CLAIM = "22222222-2222-4222-8222-222222222222";
const SCAN = "33333333-3333-4333-8333-333333333333";
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const listed = (...ids) => ({ photos: { items: ids.map((id) => ({ id, room: "", takenAt: 1 })), deleted: [], scopedNotes: null } });

function world(userId) {
  globalThis.__photoWorld = {
    userId,
    members: new Map([
      ["ada", ACME],
      ["xan", OTHER],
    ]),
    claims: new Map([
      [CLAIM, { org: ACME, payload: listed(P1) }],
      [OTHER_CLAIM, { org: ACME, payload: listed(P2) }],
    ]),
    scans: new Map([[SCAN, { claim: CLAIM }]]),
    storage: new Map(),
    writes: 0,
  };
  return globalThis.__photoWorld;
}
const files = (bucket) => [...(globalThis.__photoWorld.storage.get(bucket)?.keys() ?? [])].sort();
const jpeg = (size = 64) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const params = (id, photoId) => ({ params: Promise.resolve(photoId ? { id, photoId } : { id }) });
const post = (id, photoId, body, query = "") =>
  m.postPhoto(new Request(`https://scrivn.test/api/claims/${id}/photos/${photoId}${query}`, { method: "POST", body, headers: { "content-length": String(body.length) } }), params(id, photoId));

/* ── storing ──────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Storing a picture");

await test("a member stores both parts of a photo the claim lists, under the claim's organization", async () => {
  world("ada");
  equal((await post(CLAIM, P1, jpeg())).status, 200, "the full picture");
  equal((await post(CLAIM, P1, jpeg(32), "?part=thumb")).status, 200, "the thumbnail");
  equal(files("claim-photos"), [`${ACME}/${CLAIM}/${P1}.jpg`, `${ACME}/${CLAIM}/${P1}.thumb.jpg`], "where they went");
});

await test("sent twice, one picture", async () => {
  const w = world("ada");
  await post(CLAIM, P1, jpeg());
  equal((await post(CLAIM, P1, jpeg(80))).status, 200, "the second send is accepted");
  equal(files("claim-photos").length, 1, "and replaces the first");
  equal(w.storage.get("claim-photos").get(`${ACME}/${CLAIM}/${P1}.jpg`).length, 80, "with the newer bytes");
});

await test("a photo the claim does not list is not stored yet — 409, for the queue to try later", async () => {
  world("ada");
  const res = await post(CLAIM, P2, jpeg());
  equal([res.status, (await res.json()).code], [409, "not-in-claim"], "refused as not listed");
  equal(files("claim-photos"), [], "nothing stored");
});

await test("another organization's member is told the claim is not there, and stores nothing", async () => {
  world("xan");
  equal((await post(CLAIM, P1, jpeg())).status, 404, "404, the same as no claim at all");
  equal(files("claim-photos"), [], "nothing stored");
});

await test("nobody signed in, a picture that is not a JPEG, one over 2 MB, a path that is not an id", async () => {
  world(null);
  equal((await post(CLAIM, P1, jpeg())).status, 401, "signed out");
  world("ada");
  equal((await post(CLAIM, P1, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).status, 400, "a PNG");
  equal((await post(CLAIM, P1, new Uint8Array(2 * 1024 * 1024 + 1))).status, 413, "over 2 MB, refused from its declared length");
  equal((await post(CLAIM, P1, jpeg(400 * 1024), "?part=thumb")).status, 400, "a thumbnail over 300 KB");
  equal((await post("not-a-claim", P1, jpeg())).status, 400, "a claim id that is not a UUID");
  equal((await post(CLAIM, "../../logos/x", jpeg())).status, 400, "a photo id that climbs out of its folder");
  equal(files("claim-photos"), [], "and none of it stored");
});

/* ── reading ──────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Links to the pictures");

await test("a member gets an hour's links to both parts; another organization gets none", async () => {
  world("ada");
  await post(CLAIM, P1, jpeg());
  await post(CLAIM, P1, jpeg(), "?part=thumb");
  const mine = await (await m.listPhotos(new Request("https://scrivn.test"), params(CLAIM))).json();
  equal(mine.photos.length, 1, "one photo");
  equal([!!mine.photos[0].full, !!mine.photos[0].thumb, mine.photos[0].full.includes("for=3600")], [true, true, true], "both parts, signed for an hour");
  globalThis.__photoWorld.userId = "xan";
  equal((await (await m.listPhotos(new Request("https://scrivn.test"), params(CLAIM))).json()).photos, [], "none for another organization");
});

/* ── deleting ─────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Deleting");

await test("a photo deleted: both parts go; another organization cannot delete it", async () => {
  world("ada");
  await post(CLAIM, P1, jpeg());
  await post(CLAIM, P1, jpeg(), "?part=thumb");
  globalThis.__photoWorld.userId = "xan";
  equal((await m.deletePhoto(new Request("https://scrivn.test", { method: "DELETE" }), params(CLAIM, P1))).status, 404, "not theirs");
  equal(files("claim-photos").length, 2, "still there");
  globalThis.__photoWorld.userId = "ada";
  equal((await m.deletePhoto(new Request("https://scrivn.test", { method: "DELETE" }), params(CLAIM, P1))).status, 200, "the member deletes it");
  equal(files("claim-photos"), [], "both parts gone");
});

await test("a claim deleted takes its site photos and its scans' photos with it, and nothing of another claim", async () => {
  const w = world("ada");
  await post(CLAIM, P1, jpeg());
  await post(OTHER_CLAIM, P2, jpeg());
  w.storage.set("scan-photos", new Map([[`${ACME}/${SCAN}/0.jpg`, jpeg()], [`${ACME}/${SCAN}/1.jpg`, jpeg()], [`${ACME}/other-scan/0.jpg`, jpeg()]]));
  equal((await m.deleteClaimRoute(new Request("https://scrivn.test", { method: "DELETE" }), params(CLAIM))).status, 200, "deleted");
  equal(w.claims.has(CLAIM), false, "the row is gone");
  equal(files("claim-photos"), [`${ACME}/${OTHER_CLAIM}/${P2}.jpg`], "its photos gone, the other claim's kept");
  equal(files("scan-photos"), [`${ACME}/other-scan/0.jpg`], "its scan's walk photos gone, another scan's kept");
});

await test("another organization deleting a claim deletes nothing at all", async () => {
  const w = world("ada");
  await post(CLAIM, P1, jpeg());
  w.userId = "xan";
  equal((await m.deleteClaimRoute(new Request("https://scrivn.test", { method: "DELETE" }), params(CLAIM))).status, 404, "not found");
  equal([w.claims.has(CLAIM), files("claim-photos").length], [true, 1], "claim and photo both still there");
});

for (const f of failures) console.error(`  FAIL ${f}`);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length > 0 ? 1 : 0);
