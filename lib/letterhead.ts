/**
 * The one place a document's branding lives.
 *
 * `lib/pdf.ts` draws a `Letterhead` into every PDF and `components/LetterheadBanner.tsx` renders the
 * same object for the on-screen preview, so the two can never disagree about what a company's
 * documents look like. Everything here is pure: the same code runs in the browser (the preview,
 * the PDF), on the server (validating what an owner saves) and in the test suite.
 *
 * ── Where a letterhead comes from ────────────────────────────────────────────────────────────────
 *
 * Each organization has one, stored on its row (0005_letterhead.sql) and edited on the account
 * page. Until an owner has saved it, documents carry `DEFAULT_LETTERHEAD` — the Scrivn brand — so
 * nothing about anyone's documents changes until they choose to change it.
 */

/** RGB triple, 0-255 — jsPDF's colour APIs take this shape directly. */
export type RGB = [number, number, number];

export interface LetterheadLogo {
  /** A PNG, as a data URL — what both `<img src>` and jsPDF's `addImage` accept without conversion. */
  dataUrl: string;
  /** Natural pixel size, used to lay the logo out without decoding it first. */
  width: number;
  height: number;
}

export interface Letterhead {
  companyName: string;
  /** Empty when the company has none; the line is simply not drawn. */
  tagline: string;
  primaryColor: RGB;
  accentColor: RGB;
  logo: LetterheadLogo | null;
}

/** Scrivn brand — deep navy primary, warm amber accent. Matches the on-screen design system (globals.css). */
export const DEFAULT_LETTERHEAD: Letterhead = {
  companyName: "Scrivn",
  tagline: "Restoration Documentation",
  primaryColor: [27, 58, 92], // #1B3A5C
  accentColor: [240, 169, 62], // #F0A93E
  logo: null,
};

/*
  ── Colours ───────────────────────────────────────────────────────────────────────────────────────
*/

/** `#rrggbb` (either case) to RGB, or null for anything else — no guessing at `#abc` or `rgb(...)`. */
export function hexToRgb(hex: string): RGB | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1] ?? "0", 16), parseInt(m[2] ?? "0", 16), parseInt(m[3] ?? "0", 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: RGB): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: RGB = [255, 255, 255];
const INK: RGB = [26, 26, 26];

/**
 * The colour for text drawn ON the primary colour — the company name in the banner.
 *
 * White on navy, near-black on cream: whichever reads better against what the owner chose. A
 * company whose logo sits on a white ground can pick a white banner and the name stays legible,
 * which is the whole reason this is computed rather than fixed at white.
 */
export function letterheadTextColor(primary: RGB): RGB {
  return contrastRatio(primary, WHITE) >= contrastRatio(primary, INK) ? WHITE : INK;
}

/**
 * The colour for text drawn IN the primary colour on white paper — the document title, the Job
 * Information group headings.
 *
 * The primary itself while it reads on paper; near-black once it is too pale to. 3:1 is the
 * threshold for large text, and every use of this is bold and at least 8.5pt against white.
 */
export function letterheadInkColor(primary: RGB): RGB {
  return contrastRatio(primary, WHITE) >= 3 ? primary : INK;
}

/*
  ── The logo's place in the banner ────────────────────────────────────────────────────────────────
*/

/**
 * The box a logo is fitted into, in PDF points, inside the 64pt banner. The preview mirrors it in px.
 *
 * Wider than it is tall by a good margin, because restoration company logos usually are: a 4:1
 * wordmark gets the full height here, and even a 10:1 one stays readable at 18pt.
 */
export const LOGO_BOX = { maxWidth: 180, maxHeight: 44 } as const;

/** Scales a logo to fit `LOGO_BOX` by the tighter of the two ratios, so a wordmark stays a wordmark. */
export function fitLogo(width: number, height: number, box: { maxWidth: number; maxHeight: number } = LOGO_BOX): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(box.maxWidth / width, box.maxHeight / height);
  return { width: width * scale, height: height * scale };
}

/*
  ── What an owner may save ────────────────────────────────────────────────────────────────────────
*/

/** The editable half of a letterhead — everything but the logo, which has its own upload. */
export interface LetterheadSettings {
  companyName: string;
  tagline: string;
  /** `#rrggbb`, lower case — the form's colour inputs produce exactly this. */
  primaryColor: string;
  accentColor: string;
}

export const LETTERHEAD_LIMITS = { companyName: 80, tagline: 120 } as const;

export const DEFAULT_LETTERHEAD_SETTINGS: LetterheadSettings = {
  companyName: DEFAULT_LETTERHEAD.companyName,
  tagline: DEFAULT_LETTERHEAD.tagline,
  primaryColor: rgbToHex(DEFAULT_LETTERHEAD.primaryColor),
  accentColor: rgbToHex(DEFAULT_LETTERHEAD.accentColor),
};

export type SettingsResult = { ok: true; settings: LetterheadSettings } | { ok: false; error: string };

/**
 * Checks and tidies what the form sent, or says in one sentence what is wrong with it.
 *
 * Runs on the server before anything is written and in the form before anything is sent, so the
 * message a PM sees is the same one the database would have been protected by.
 */
export function normaliseLetterheadSettings(input: unknown): SettingsResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save." };
  const raw = input as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

  const companyName = text(raw.companyName);
  if (companyName === "") return { ok: false, error: "Enter your company name." };
  if (companyName.length > LETTERHEAD_LIMITS.companyName) return { ok: false, error: `Company name is limited to ${LETTERHEAD_LIMITS.companyName} characters.` };

  const tagline = text(raw.tagline);
  if (tagline.length > LETTERHEAD_LIMITS.tagline) return { ok: false, error: `Tagline is limited to ${LETTERHEAD_LIMITS.tagline} characters.` };

  const primary = typeof raw.primaryColor === "string" ? hexToRgb(raw.primaryColor) : null;
  if (!primary) return { ok: false, error: "Choose a primary colour." };
  const accent = typeof raw.accentColor === "string" ? hexToRgb(raw.accentColor) : null;
  if (!accent) return { ok: false, error: "Choose an accent colour." };

  return { ok: true, settings: { companyName, tagline, primaryColor: rgbToHex(primary), accentColor: rgbToHex(accent) } };
}

/*
  ── The logo file ─────────────────────────────────────────────────────────────────────────────────
*/

/**
 * What the server accepts. The browser normalises whatever was chosen to a PNG no bigger than
 * `LOGO_NORMALISE` before uploading, so these are a backstop against a client that skipped that —
 * and they match the bucket's own limits in 0005_letterhead.sql, which are the real enforcement.
 */
export const LOGO_LIMITS = { maxBytes: 1_048_576, maxWidth: 1200, maxHeight: 600 } as const;

/** The size the browser scales a chosen image down to. Enough for print at the banner's size, small enough to embed in every PDF. */
export const LOGO_NORMALISE = { maxWidth: 800, maxHeight: 400 } as const;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The pixel size of a PNG from its header, or null if the bytes are not a PNG at all.
 *
 * Reads the eight-byte signature and the IHDR chunk that the format requires to come first — no
 * decoder, no dependency, and the same check that tells a PNG from a renamed JPEG.
 */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  // Bytes 12-15 must spell IHDR; 16-19 and 20-23 are width and height, big-endian.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/*
  ── What the account page edits ───────────────────────────────────────────────────────────────────
*/

/**
 * Everything the account page needs to render and edit the letterhead. Assembled by
 * `lib/organizationRepo.ts` on the server; declared here so the form, a Client Component, can
 * name the shape without touching a server-only module.
 */
export interface OrganizationLetterheadState {
  organizationId: string;
  /** Whether this session may change anything. Members see the letterhead; owners edit it. */
  canEdit: boolean;
  /** False until the first save — while false, documents carry the Scrivn default. */
  configured: boolean;
  /** The form's values: prefilled from the row, defaults where nothing has been saved. */
  settings: LetterheadSettings;
  logo: LetterheadLogo | null;
  /** What documents actually use right now. */
  letterhead: Letterhead;
}

/*
  ── From the database row ─────────────────────────────────────────────────────────────────────────
*/

/** The letterhead columns of an `organizations` row, as PostgREST returns them. */
export interface OrganizationLetterheadRow {
  name: string;
  tagline: string | null;
  primary_color: string | null;
  accent_color: string | null;
  letterhead_configured_at: string | null;
}

/** The form's starting values for a row: the company name is prefilled, everything else defaults. */
export function settingsFromRow(row: OrganizationLetterheadRow): LetterheadSettings {
  return {
    companyName: row.name,
    tagline: row.tagline ?? "",
    primaryColor: row.primary_color && hexToRgb(row.primary_color) ? row.primary_color : DEFAULT_LETTERHEAD_SETTINGS.primaryColor,
    accentColor: row.accent_color && hexToRgb(row.accent_color) ? row.accent_color : DEFAULT_LETTERHEAD_SETTINGS.accentColor,
  };
}

/**
 * The letterhead documents use for a row: the default until the organization has configured one,
 * then its own. See the migration for why the gate exists.
 */
export function letterheadFromRow(row: OrganizationLetterheadRow, logo: LetterheadLogo | null): Letterhead {
  if (!row.letterhead_configured_at) return DEFAULT_LETTERHEAD;
  return letterheadFromSettings(settingsFromRow(row), logo);
}

/** Settings plus a logo make a letterhead. Also what the form's live preview draws. */
export function letterheadFromSettings(settings: LetterheadSettings, logo: LetterheadLogo | null): Letterhead {
  return {
    companyName: settings.companyName,
    tagline: settings.tagline,
    primaryColor: hexToRgb(settings.primaryColor) ?? DEFAULT_LETTERHEAD.primaryColor,
    accentColor: hexToRgb(settings.accentColor) ?? DEFAULT_LETTERHEAD.accentColor,
    logo,
  };
}
