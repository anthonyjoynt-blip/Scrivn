/**
 * The one place a PDF's branding lives. Swapping letterheads later — a different company, a
 * client-specific template — is meant to be "point `generatePdf.ts` at a different object shaped
 * like this," not a code change scattered across the PDF generator. Phase 1 has exactly one
 * letterhead, used unconditionally, standing in for whichever real restoration company ends up
 * using this once the per-company/profile system exists (round 9) — it's a placeholder value, not
 * a claim about who that will be.
 */
export interface Letterhead {
  companyName: string;
  tagline: string;
  /** RGB triples, 0-255 — jsPDF's color APIs take this shape directly. */
  primaryColor: [number, number, number];
  accentColor: [number, number, number];
}

/** Scrivn brand (round 9 — dropped "Fieldscope") — deep navy primary, warm amber accent. Matches the on-screen design system (globals.css). */
export const DEFAULT_LETTERHEAD: Letterhead = {
  companyName: "Scrivn",
  tagline: "Restoration Documentation",
  primaryColor: [27, 58, 92], // #1B3A5C
  accentColor: [240, 169, 62], // #F0A93E
};
