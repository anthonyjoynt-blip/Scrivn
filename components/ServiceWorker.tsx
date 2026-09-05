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
 * A failure here is logged and otherwise ignored, deliberately. The worker only provides an offline
 * message and an install prompt; if it cannot register — a private window, a browser that does not
 * support it, an enterprise policy — the app works exactly as it does today, and an error banner
 * about it would be noise about something the user did not ask for and does not need.
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
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
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
