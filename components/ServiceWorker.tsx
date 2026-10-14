"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, which is what makes Chrome offer a real install.
 *
 * Chrome will not treat a site as installable without a registered worker carrying a fetch handler —
 * it offers "create shortcut" instead, which is a bookmark in a window rather than an app. iOS Safari
 * needs none of this and reads the manifest by itself.
 *
 * Registered from a client component rather than a script tag so it runs after hydration, off the
 * critical path: nothing on the first paint depends on it, and a worker registering during load would
 * compete with the page for the same connection.
 *
 * A failure here is logged and otherwise ignored, deliberately. The worker provides the install
 * prompt and the offline boot; if it cannot register — a private window, a browser that does not
 * support it, an enterprise policy — the app still works with signal and still keeps claims on the
 * device, it just cannot open with none, and an error banner about it would be noise about something
 * the user did not ask for and cannot fix.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    /*
      Dev is excluded. Next serves modules differently under `next dev`, and a worker holding onto
      anything across a hot reload is a confusing failure to debug — this one caches only the offline
      page, but the registration itself would still outlive a restart and shadow later changes.
    */
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => warmOfflinePages())
        .catch((err) => {
          console.warn("[sw] registration failed — the app still works, it just will not offer to install:", err);
        });
    };

    // After load, so the worker never competes with the page it is meant to support.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

/** How often the worker is asked to fetch the offline pages again — see `warm` in public/sw.js. */
const WARM_EVERY_MS = 15 * 60_000;

/**
 * Ask the worker to keep a fresh copy of the claim page and the Claims list, with every build file
 * they need, so either can boot with no signal even if it was only ever reached by a link (2026-10-13).
 *
 * Only for somebody signed in (the pages are theirs), only with signal, and not on every page load:
 * once a quarter of an hour is plenty to follow a deploy, and a phone on one bar should not spend it
 * on this.
 */
async function warmOfflinePages() {
  if (!navigator.onLine || !document.querySelector("[data-scrivn-user]")) return;
  try {
    const last = Number(localStorage.getItem("scrivn-warmed-at") ?? 0);
    if (Date.now() - last < WARM_EVERY_MS) return;
    localStorage.setItem("scrivn-warmed-at", String(Date.now()));
  } catch {
    // No storage: warm anyway, the throttle is a courtesy.
  }
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: "warm" });
}
