/*
 * The smallest service worker that makes Chrome treat Scrivn as an app.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────────────────────────
 *
 * Chrome will not offer a real install without a registered service worker carrying a fetch handler.
 * Without one it offers "create shortcut" instead, which is a bookmark that opens in a window — not
 * an installed app. iOS Safari needs no service worker and honours the manifest on its own, which is
 * why the iPhone half worked and the Chrome half did not.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────────────────────────
 *
 * It caches no application code. Not the HTML, not the JavaScript, not the CSS.
 *
 * That is a decision, not an omission. A service worker that caches app assets has to be told how to
 * stop — how to notice a new deploy, how to discard the old bundle, how not to serve a three-week-old
 * page to somebody who cannot work out why their fix is missing. Getting that wrong produces a class
 * of bug that survives a hard refresh and cannot be diagnosed from the outside, and it is the single
 * commonest way a PWA goes bad. Offline caching is stage 2, where it can be designed properly with a
 * versioning and sync story rather than smuggled in to satisfy an install prompt.
 *
 * So the only thing cached here is one page, shown when a NAVIGATION fails. It is not offline
 * support. It is the app telling the truth about needing a connection, instead of the browser's dinosaur.
 */

const CACHE = "scrivn-shell-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` so installing a new worker cannot pick the offline page out of the HTTP cache and
      // keep serving last month's wording.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    })(),
  );
  // Take over without waiting for every existing tab to close. Safe precisely because nothing here
  // caches app code — there is no old bundle for a new worker to be inconsistent with.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop any cache from an earlier version of this file, so a rename cannot leave one orphaned
      // and unreachable forever.
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  /*
    Navigations only. Everything else — API calls, JS, CSS, images — is left entirely alone and goes
    straight to the network exactly as it would with no service worker installed.

    That matters for the API in particular: extraction, generation and every claim save must fail
    honestly when there is no connection, so the app can say so. A worker that quietly served a
    cached answer to a POST would be worse than no worker at all.
  */
  if (request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        // The network is genuinely gone — not a 404, not a 500, which reach the app normally.
        const cache = await caches.open(CACHE);
        return (await cache.match(OFFLINE_URL)) ?? Response.error();
      }
    })(),
  );
});
