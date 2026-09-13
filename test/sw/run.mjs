/**
 * The service worker: what it caches, what it refuses to cache, and what it does with no network.
 *
 *   npm run test:sw
 *
 * This file sits in front of every request the app makes, and every way it can be wrong is quiet:
 *
 *   * a stale page served after a deploy, surviving a hard refresh
 *   * the LOGIN form cached under /claim, because fetch follows redirects — so a signed-in PM with
 *     no signal is shown a sign-in screen for a session they already have
 *   * an API response answered from a cache, so a save looks like it worked
 *   * the previous user's email address left in a cached page on a shared device
 *   * a chunk evicted out from under the document that names it, turning an offline boot into the
 *     offline page for no visible reason
 *
 * None of those throw. The real `public/sw.js` runs here against a fake cache and a scripted
 * network — see fakeServiceWorker.mjs for what the fake is careful to get right.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorker } from "./fakeServiceWorker.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "..", "public", "sw.js"), "utf8");

let passed = 0;
const failures = [];

async function test(name, run) {
  const w = await loadWorker(source);
  try {
    await run(w);
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const equal = (actual, expected, message) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n      expected ${e}\n      actual   ${a}`);
};

/* ── helpers ──────────────────────────────────────────────────────────────────────────────────── */

const NO_NETWORK = () => {
  throw new TypeError("Failed to fetch");
};

function navigation(w, path) {
  return new w.FakeRequest(path, { mode: "navigate" });
}

function asset(w, path) {
  return new w.FakeRequest(path, { mode: "no-cors" });
}

/** Install and activate, with the network up, so the worker starts from a real steady state. */
async function boot(w) {
  w.network.handler = (url) => new w.FakeResponse(`body of ${url}`);
  await w.lifecycle("install");
  await w.lifecycle("activate");
}

const pageEntries = async (w) => [...(await w.cacheStorage.open("scrivn-pages-v2")).entries.keys()];
const assetEntries = async (w) => [...(await w.cacheStorage.open("scrivn-assets-v2")).entries.keys()];

/* ── install ──────────────────────────────────────────────────────────────────────────────────── */

await test("the offline page is cached at install", async (w) => {
  await boot(w);
  equal(await pageEntries(w), ["https://scrivn.ca/offline"], "cached pages");
});

await test("activating drops caches from an older shape", async (w) => {
  const stale = await w.cacheStorage.open("scrivn-shell-v1");
  await stale.put("/offline", new w.FakeResponse("old wording"));
  await boot(w);
  assert(!(await w.cacheStorage.keys()).includes("scrivn-shell-v1"), "expected the v1 cache to be deleted");
});

/* ── documents ────────────────────────────────────────────────────────────────────────────────── */

await test("a page is served from the network and kept for later", async (w) => {
  await boot(w);
  const response = await w.fetchEvent(navigation(w, "/claim"));
  equal(response.body, "body of https://scrivn.ca/claim", "what the browser got");
  assert((await pageEntries(w)).includes("https://scrivn.ca/claim"), "expected /claim to be cached");
});

await test("the network's answer always wins while there is one", async (w) => {
  /*
    The whole reason documents are network-first. If the cache could win, a deploy would not be
    picked up and the fix would be missing in a way a hard refresh does not cure.
  */
  await boot(w);
  await w.fetchEvent(navigation(w, "/claim"));
  w.network.handler = () => new w.FakeResponse("the new deploy");
  const response = await w.fetchEvent(navigation(w, "/claim"));
  equal(response.body, "the new deploy", "what the browser got");
});

await test("with no network, the page you were last served comes back", async (w) => {
  await boot(w);
  await w.fetchEvent(navigation(w, "/claim"));
  w.network.handler = NO_NETWORK;
  const response = await w.fetchEvent(navigation(w, "/claim"));
  equal(response.body, "body of https://scrivn.ca/claim", "what the browser got offline");
});

/*
  A DYING network, as opposed to a dead one. `fetch` neither answers nor throws, and before the
  timeout the PM sat on a blank tab with a good copy of the page in the cache. The timer is the
  fake worker's, fired by hand — see fakeServiceWorker.mjs — so these do not wait eight seconds.
*/
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const hanging = () => {
  let release;
  const handler = () => new Promise((resolve) => {
    release = resolve;
  });
  return { handler, release: (response) => release(response) };
};

await test("a network that hangs gives way to the cached page once the timeout passes", async (w) => {
  await boot(w);
  await w.fetchEvent(navigation(w, "/claim"));
  // The warm-up navigation armed a timer of its own that the network beat; drain it so the count below is exact.
  w.timers.fire();
  w.network.handler = hanging().handler;
  const pending = w.fetchEvent(navigation(w, "/claim"));
  await flush();
  equal(w.timers.pending(), 1, "a timeout armed once the request went out");
  w.timers.fire();
  const response = await pending;
  equal(response.body, "body of https://scrivn.ca/claim", "the cached copy, rather than a blank tab");
});

await test("but a page never visited keeps waiting rather than showing the offline page", async (w) => {
  await boot(w);
  const net = hanging();
  w.network.handler = net.handler;
  let settled = false;
  const pending = w.fetchEvent(navigation(w, "/claims")).then((r) => {
    settled = true;
    return r;
  });
  await flush();
  w.timers.fire();
  await flush();
  assert(!settled, "expected the worker to still be waiting on the network — the offline page is a worse answer than a slow one");
  net.release(new w.FakeResponse("late, but the real page"));
  equal((await pending).body, "late, but the real page", "what the browser eventually got");
});

await test("a network that answers in time is never pre-empted by the timer", async (w) => {
  await boot(w);
  w.network.handler = () => new w.FakeResponse("fresh from the server");
  const response = await w.fetchEvent(navigation(w, "/claim"));
  equal(response.body, "fresh from the server", "what the browser got");
  // The timer may still be armed; firing it now must change nothing already answered.
  w.timers.fire();
  await flush();
  equal(response.body, "fresh from the server", "still the network's answer");
});

await test("a late arrival after the cached copy was served still refreshes the cache", async (w) => {
  await boot(w);
  await w.fetchEvent(navigation(w, "/claim"));
  const net = hanging();
  w.network.handler = net.handler;
  const pending = w.fetchEvent(navigation(w, "/claim"));
  await flush();
  w.timers.fire();
  equal((await pending).body, "body of https://scrivn.ca/claim", "served from the cache");
  net.release(new w.FakeResponse("the new deploy"));
  await flush();
  const cached = await (await w.cacheStorage.open("scrivn-pages-v2")).match("https://scrivn.ca/claim");
  equal(cached.body, "the new deploy", "the cache holds the late answer for next time");
});

await test("a 404 for a page that was cached earlier still reaches the app, not the stale copy", async (w) => {
  /*
    The timeout path reads the cache when the network is silent. It must never read it when the
    network has ANSWERED with something the cache would not store — a 404 or a redirect — or a page
    that once existed would be served from the cache for ever after it was removed.
  */
  await boot(w);
  await w.fetchEvent(navigation(w, "/claim"));
  w.network.handler = () => new w.FakeResponse("gone", { status: 404 });
  const response = await w.fetchEvent(navigation(w, "/claim"));
  equal(response.status, 404, "status the app sees, with a stale copy sitting in the cache");
});

await test("a claim's id does not need its own cache entry", async (w) => {
  /*
    /claim?id=abc and /claim are the same HTML — the page is a client component and its data arrives
    later from the API. Keying on the full URL would store a copy per claim and still miss on the
    next one, which is the case that matters.
  */
  await boot(w);
  await w.fetchEvent(navigation(w, "/claim"));
  w.network.handler = NO_NETWORK;
  const response = await w.fetchEvent(navigation(w, "/claim?id=abc123"));
  equal(response.body, "body of https://scrivn.ca/claim", "what a claim URL got offline");
  equal(await pageEntries(w), ["https://scrivn.ca/offline", "https://scrivn.ca/claim"], "cached pages");
});

await test("a page never visited falls back to the offline page", async (w) => {
  await boot(w);
  w.network.handler = NO_NETWORK;
  const response = await w.fetchEvent(navigation(w, "/account"));
  equal(response.body, "body of https://scrivn.ca/offline", "what the browser got");
});

await test("a redirect is NOT stored under the address that was asked for", async (w) => {
  /*
    `fetch` follows redirects, so a navigation to /claim while signed out arrives here as the LOGIN
    page's HTML. Filing that under /claim would show a sign-in form, offline, for ever, to somebody
    who is signed in — and no amount of signing in would clear it.
  */
  await boot(w);
  w.network.handler = () =>
    new w.FakeResponse("the login form", { redirected: true, url: "https://scrivn.ca/login" });
  await w.fetchEvent(navigation(w, "/claim"));
  equal(await pageEntries(w), ["https://scrivn.ca/offline"], "cached pages");
});

await test("a 404 or a 500 is a real answer and is neither cached nor replaced", async (w) => {
  await boot(w);
  w.network.handler = () => new w.FakeResponse("not found", { status: 404 });
  const response = await w.fetchEvent(navigation(w, "/nope"));
  equal(response.status, 404, "status the app sees");
  equal(await pageEntries(w), ["https://scrivn.ca/offline"], "cached pages");
});

/* ── build assets ─────────────────────────────────────────────────────────────────────────────── */

await test("a hashed asset is cached and then served without touching the network", async (w) => {
  await boot(w);
  const before = w.network.calls.length;
  await w.fetchEvent(asset(w, "/_next/static/chunks/main-abc123.js"));
  await w.fetchEvent(asset(w, "/_next/static/chunks/main-abc123.js"));
  equal(w.network.calls.length - before, 1, "network requests for two loads of one asset");
});

await test("and is still there with no network", async (w) => {
  await boot(w);
  await w.fetchEvent(asset(w, "/_next/static/chunks/main-abc123.js"));
  w.network.handler = NO_NETWORK;
  const response = await w.fetchEvent(asset(w, "/_next/static/chunks/main-abc123.js"));
  equal(response.body, "body of https://scrivn.ca/_next/static/chunks/main-abc123.js", "what the page got");
});

await test("two builds' assets coexist, since a hashed URL means one exact file", async (w) => {
  await boot(w);
  await w.fetchEvent(asset(w, "/_next/static/chunks/main-abc123.js"));
  await w.fetchEvent(asset(w, "/_next/static/chunks/main-def456.js"));
  equal((await assetEntries(w)).length, 2, "cached assets");
});

await test("the asset cache is trimmed, oldest first", async (w) => {
  // Otherwise it grows by a build's worth of chunks on every deploy, for ever.
  await boot(w);
  for (let i = 0; i < 250; i++) await w.fetchEvent(asset(w, `/_next/static/chunks/c-${i}.js`));
  const entries = await assetEntries(w);
  equal(entries.length, 240, "cached assets after the cap");
  assert(!entries.includes("https://scrivn.ca/_next/static/chunks/c-0.js"), "expected the oldest to be evicted");
  assert(entries.includes("https://scrivn.ca/_next/static/chunks/c-249.js"), "expected the newest to be kept");
});

await test("a failed asset fetch is not cached as if it had worked", async (w) => {
  await boot(w);
  w.network.handler = () => new w.FakeResponse("gone", { status: 404 });
  await w.fetchEvent(asset(w, "/_next/static/chunks/missing.js"));
  equal(await assetEntries(w), [], "cached assets");
});

/* ── what must never be cached ────────────────────────────────────────────────────────────────── */

await test("API requests are passed straight through, untouched", async (w) => {
  /*
    Load-bearing. A save, an extraction or a generation answered from a cache would look like it
    worked — which is precisely the silent data loss the pending-save queue exists to prevent.
  */
  await boot(w);
  const response = await w.fetchEvent(asset(w, "/api/claims/abc"));
  equal(response, null, "the worker should not respond to an API request at all");
});

await test("a POST is never intercepted", async (w) => {
  await boot(w);
  const post = new w.FakeRequest("/api/claims", { method: "POST" });
  equal(await w.fetchEvent(post), null, "the worker should not respond to a POST");
});

await test("another origin is left alone", async (w) => {
  await boot(w);
  const external = new w.FakeRequest("https://api.stripe.com/v1/x");
  equal(await w.fetchEvent(external), null, "the worker should not respond for a third party");
});

/* ── signing out ──────────────────────────────────────────────────────────────────────────────── */

await test("signing out clears the cached pages", async (w) => {
  /*
    The signed-in header carries the user's email, so it is in the HTML stored above. On a shared
    device that would outlive the session: the next person to open Scrivn with no signal would be
    shown the last person's address.
  */
  await boot(w);
  await w.fetchEvent(navigation(w, "/claim"));
  assert((await pageEntries(w)).includes("https://scrivn.ca/claim"), "expected /claim cached first");

  await w.fetchEvent(new w.FakeRequest("/api/logout", { method: "POST" }));
  assert(!(await w.cacheStorage.keys()).includes("scrivn-pages-v2"), "expected the page cache to be dropped");
});

await test("and the sign-out itself still reaches the server", async (w) => {
  // Clearing the cache must not swallow the request — the session has to end server-side too.
  await boot(w);
  const response = await w.fetchEvent(new w.FakeRequest("/api/logout", { method: "POST" }));
  equal(response, null, "the worker should not respond to the sign-out itself");
});

await test("signing out does not throw away the build assets", async (w) => {
  // They contain nothing about anybody, and dropping them would make the next offline open fail
  // for a reason that has nothing to do with signing out.
  await boot(w);
  await w.fetchEvent(asset(w, "/_next/static/chunks/main-abc123.js"));
  await w.fetchEvent(new w.FakeRequest("/api/logout", { method: "POST" }));
  equal((await assetEntries(w)).length, 1, "cached assets after signing out");
});

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const failure of failures) console.log(`  ✗ ${failure}\n`);
process.exit(failures.length === 0 ? 0 : 1);
