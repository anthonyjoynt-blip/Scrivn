import type { MetadataRoute } from "next";

/**
 * What makes Scrivn installable to a home screen.
 *
 * Stage 1 of the PWA work, and deliberately only stage 1: this adds the icon, the name and the
 * full-screen shell. It adds NO offline capability — there is no service worker, and every route
 * still needs the network. That separation is on purpose. Installing is a day's work with almost no
 * risk; offline is weeks, mostly because two devices editing one claim while one of them is offline
 * turns a rare last-write-wins collision into an ordinary one. Shipping the cheap half first means
 * testers get a home-screen app for the rollout without waiting on the hard half.
 *
 * ── start_url ────────────────────────────────────────────────────────────────────────────────────
 *
 * The claims LIST, not a blank claim. A PM opening this is about as likely to be resuming yesterday's
 * job as starting a new one, and the list serves both — it is the whole reason claims save
 * incrementally. Starting a new claim from there is one tap, and the long-press shortcut below makes
 * it zero.
 *
 * ── id ───────────────────────────────────────────────────────────────────────────────────────────
 *
 * Pinned explicitly so the install identity does not follow start_url. Without it, changing where the
 * app opens would read as a DIFFERENT app to the browser, and an already-installed icon would be
 * orphaned rather than updated.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Scrivn",
    short_name: "Scrivn",
    description: "From on-site notes to a submitted scope.",
    start_url: "/claims",
    scope: "/",
    display: "standalone",
    // Matches --bg and --color-navy in globals.css. The background shows during launch, before the
    // first paint, so a value that differs from the page's own background produces a visible flash.
    background_color: "#ffffff",
    theme_color: "#1b3a5c",
    /*
      Orientation is deliberately unset. Sketching a wide room is far easier in landscape, and a PM
      holding a phone sideways over a floor plan should not be fought by the app.
    */
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /*
        A separate drawing, not the same file relabelled. Android crops a maskable icon to the
        launcher's shape and only the middle 80% is safe, so this one carries the mark smaller on a
        full-bleed ground — see scripts/build-icons.mjs. Reusing the "any" icon here is what produces
        the clipped-corner look on Android.
      */
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "New claim",
        short_name: "New claim",
        description: "Start a new claim",
        url: "/claim",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
