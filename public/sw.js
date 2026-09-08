/*
 * The service worker: makes Scrivn installable, and makes it open with no signal.
 *
 * ── What changed, and why it was safe to change ──────────────────────────────────────────────────
 *
 * This used to cache no application code at all. That was right at the time: a worker holding app
 * assets needs a story for how it stops — how it notices a deploy, how it discards the old bundle,
 * how it avoids serving a three-week-old page to somebody who cannot work out why their fix is
 * missing. Getting that wrong produces a bug that survives a hard refresh.
 *
 * The story turned out to be short, because Next does most of it. Everything under `/_next/static`
 * is content-hashed: a URL there names one exact build of one exact file and can never mean anything
 * else, so caching it forever is not a staleness risk. The only thing that CAN go stale is the HTML
 * document, and that is served network-first — the cached copy is a fallback for when there is no
 * network at all, never a substitute for one.
 *
 * The point of it is the save queue in `lib/pendingSaves.ts`. That holds work when a save fails, but
 * only for somebody already inside the app when the signal went. A PM who opened Scrivn in a
 * basement got the offline page and could do nothing — the queue was ready and there was no way to
 * reach the form. Now the app boots: intake, transcript, sketch and moisture all run client-side,
 * and the queue takes the result.
 *
 * ── What still cannot work offline ───────────────────────────────────────────────────────────────
 *
 * Extraction and document generation are calls to Claude. Opening an EXISTING claim needs
 * `/api/claims/:id`. Both fail honestly rather than being faked from a cache — a worker that served
 * a cached answer to a POST would be worse than no worker at all.
 */

/*
 * Bumped only when the shape of what is stored changes, NOT per deploy. Content-hashed asset URLs
 * make a per-deploy bump unnecessary: two builds' assets coexist under different URLs, and the trim
 * below is what stops that growing forever.
 */
const VERSION = "v2";
const PAGES = `scrivn-pages-${VERSION}`;
const ASSETS = `scrivn-assets-${VERSION}`;
const KEEP = new Set([PAGES, ASSETS]);

const OFFLINE_URL = "/offline";

/**
 * How many hashed asset files to keep.
 *
 * Generous on purpose. A cached HTML document names the exact chunks of the build it came from, so
 * trimming one of those is what turns an offline boot into the offline page. Several builds' worth
 * of chunks fit well inside this.
 */
const MAX_ASSETS = 240;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      // `reload` so a new worker cannot pick the offline page out of the HTTP cache and keep
      // serving last month's wording.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (!KEEP.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * The key a document is stored under: its path, with the query dropped.
 *
 * `/claim?id=abc123` and `/claim` are the same HTML — the claim page is a client component and its
 * data arrives later from the API. Keying on the full URL would fill the cache with a copy per claim
 * and still miss on the next one, which is the case that matters: opening the app with no signal.
 */
function pageKey(url) {
  return new Request(new URL(url).pathname);
}

function isStaticAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

/** Keep the newest entries. `cache.keys()` returns them in insertion order, so trim from the front. */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  /*
    Signing out clears the cached pages.

    The signed-in header carries the user's email address, so it is in the HTML this worker stores.
    On a shared device that would otherwise outlive the session: the next person to open Scrivn with
    no signal would be shown the last person's address. Done here rather than on the page because
    sign-out is a plain form POST that runs no JavaScript, and because this still works when the
    sign-out itself cannot reach the server.

    The request is not intercepted — it goes to the network as usual. Only the cache is dropped.
  */
  if (request.method === "POST" && url.pathname === "/api/logout") {
    event.waitUntil(caches.delete(PAGES));
    return;
  }

  if (request.method !== "GET") return;

  /*
    Hashed build assets: cache first.

    A URL under /_next/static names one exact file from one exact build and can never mean something
    else, so there is nothing to revalidate and no staleness to reason about.
  */
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(request);
        if (hit) return hit;

        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          await cache.put(request, response.clone());
          /*
            After the put, so the cache settles at exactly the cap rather than one above it.

            Note what this is NOT: an LRU. A cache hit does not move an entry to the back, so a chunk
            that is old but still in daily use can age out behind newer ones. That is why the cap is
            generous rather than tight — the cost of getting it wrong is an offline boot falling back
            to the offline page, and the cost of keeping too much is a few hundred kilobytes.
          */
          await trim(cache, MAX_ASSETS);
        }
        return response;
      })(),
    );
    return;
  }

  /*
    Documents: network first, always.

    The network's answer is what gets shown whenever there is one, so a deploy is picked up on the
    next navigation and no stale page can survive a refresh. The cache is only consulted when the
    fetch throws, which means the network is genuinely gone — a 404 or a 500 is a real answer and
    reaches the app untouched.
  */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          /*
            Store it, unless it is a redirect. `fetch` follows redirects, so a navigation to /claim
            while signed out arrives here as the LOGIN page's HTML — filing that under /claim would
            serve the login form offline for ever, to a user who is signed in.
          */
          if (response.ok && response.type === "basic" && !response.redirected) {
            const cache = await caches.open(PAGES);
            await cache.put(pageKey(request.url), response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(PAGES);
          return (await cache.match(pageKey(request.url))) ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  /*
    Everything else — the API above all — is left entirely alone and behaves exactly as it would
    with no worker installed. Extraction, generation and every claim save must fail honestly when
    there is no connection, so the app can say so and the queue can hold the work.
  */
});
