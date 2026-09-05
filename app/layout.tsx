import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

/**
 * The root layout is deliberately bare — <html>, <body>, fonts, nothing else.
 *
 * It used to render the signed-in app header and usage banner directly. That stopped working once
 * the marketing site moved in: a root layout applies to every route, so the public pages would have
 * carried the app's chrome above their own nav. The chrome now lives in app/(app)/layout.tsx, which
 * covers exactly the routes that should have it, and the marketing pages bring their own via
 * components/marketing/MarketingShell.tsx.
 *
 * Anything added here shows up on the public marketing site too — check that's what you want.
 */

// UI typeface — labels, buttons, questions.
const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
// Document typeface — the generated inspection report / scope document render as a serif so they
// read as "a document," not "a text box" (see the round-5 design brief).
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-document", display: "swap" });

export const metadata: Metadata = {
  title: "Scrivn",
  description: "Paste a water-loss transcript, answer a few follow-up questions, get an inspection report and scope document.",
  /*
    iOS reads none of the web app manifest for installed behaviour — it has its own meta tags, which
    these produce. Without them, "Add to Home Screen" gives a bookmark that opens in Safari with the
    address bar still there, which is the difference between something that feels like an app and
    something that plainly is not.

    `statusBarStyle: "default"` keeps the status bar its own height with dark text on the app's white
    ground. The alternative, "black-translucent", pulls the page up UNDER the clock and battery, which
    needs safe-area padding on every screen — a real change to the layout, not a colour choice, and
    not worth it for a tool whose first screen is a form.
  */
  appleWebApp: {
    capable: true,
    title: "Scrivn",
    statusBarStyle: "default",
  },
  // The address is a moving target across preview deploys; the canonical host is not.
  metadataBase: new URL("https://scrivn.ca"),
};

/**
 * Separated from `metadata` because Next requires it — theme colour and viewport moved out of the
 * metadata export, and leaving them there is silently ignored rather than an error.
 *
 * `themeColor` paints the browser chrome and the Android task-switcher card. It is not conditional on
 * a colour scheme because the app is committed to a single light palette (see globals.css); a dark
 * variant here would promise a dark mode that does not exist.
 */
export const viewport: Viewport = {
  themeColor: "#1b3a5c",
  width: "device-width",
  initialScale: 1,
  /*
    Zoom is deliberately NOT disabled. A PM reading a wall dimension on a phone in a dim basement will
    pinch to zoom, and taking that away to make the app feel more "native" would be trading a real
    need for a cosmetic one.
  */
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: scoped to just this element, for exactly one known cause — some
    // browser extensions (e.g. Scribe, a step-recorder) stamp an attribute like
    // data-scribe-recorder-ready onto <html> before React hydrates, which is a real client/server
    // mismatch but not a bug in this app (see https://nextjs.org/docs/messages/react-hydration-error).
    // Doesn't hide mismatches anywhere else in the tree.
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      {/*
        Apple's own tag, alongside the standard one Next emits.

        Next writes `mobile-web-app-capable`, which is correct — Apple's prefixed version is
        deprecated — and iOS honours the manifest's `display: standalone` from 15.4 onward. Older
        iPhones read neither, and "Add to Home Screen" gives them a Safari bookmark with the address
        bar still showing. One tag covers those phones, and it is inert on every browser that does
        not need it.

        Rendered here rather than through `metadata` because Next has no field for it any more.
        React hoists it into <head>.
      */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <body>
        {children}
        {/* Registers /sw.js after load — see components/ServiceWorker.tsx for why Chrome needs it. */}
        <ServiceWorker />
      </body>
    </html>
  );
}
