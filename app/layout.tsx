import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: scoped to just this element, for exactly one known cause — some
    // browser extensions (e.g. Scribe, a step-recorder) stamp an attribute like
    // data-scribe-recorder-ready onto <html> before React hydrates, which is a real client/server
    // mismatch but not a bug in this app (see https://nextjs.org/docs/messages/react-hydration-error).
    // Doesn't hide mismatches anywhere else in the tree.
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
