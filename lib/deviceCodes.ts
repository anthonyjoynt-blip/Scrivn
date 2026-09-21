import { createHash, randomBytes } from "node:crypto";
import { clean } from "./env";

/**
 * The secrets a paired phone and Scrivn exchange, and nothing else: how they are made, checked and
 * hashed. Pure, so `test/device/run.mjs` can exercise them; the queries live in `deviceRepo.ts`.
 *
 * ── Two secrets, deliberately different ─────────────────────────────────────────────────────────
 *
 * The PAIRING CODE is short, typed or scanned once, and dies in minutes. It exists so the long
 * secret never has to be shown on a screen or squeezed into a QR: the phone trades the code for a
 * token over HTTPS, and the code is spent the moment it is used. Short means guessable in
 * principle — eight characters from a 31-letter alphabet is nearly forty bits — which is why it is
 * single-use, expires in ten minutes, and buys nothing but the right to be paired to the account
 * that minted it. Guessing one live code in its ten minutes at any rate PostgREST would serve is not
 * a practical attack; guessing it AFTER it has been used is worth nothing.
 *
 * The DEVICE TOKEN is what the phone keeps: 256 random bits, shown to nobody, sent as a bearer
 * header on every request. Only its SHA-256 is stored, so a read of the table does not hand out the
 * tokens in it — the same reason passwords are hashed, though there is no salt because there is no
 * dictionary to defend against a 256-bit random value.
 */

/** No 0/O, 1/I/L: the code is read aloud and typed as often as it is scanned. */
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 8;
/** How long a code stays exchangeable. Long enough to unlock a phone and find the app; not longer. */
export const PAIRING_CODE_TTL_SECONDS = 600;

/** A fresh code as it is shown: `XXXX-XXXX`. */
export function newPairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    // 31 letters and a byte of 256 values: a slight bias toward the first letters (8/256 vs 9/256 per
    // letter) that costs well under a bit of the forty. Rejection sampling would remove it and is not
    // worth a loop here.
    out += PAIRING_ALPHABET[bytes[i]! % PAIRING_ALPHABET.length];
  }
  return formatPairingCode(out);
}

/** `XXXXXXXX` → `XXXX-XXXX`. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * What the phone or a person typed, reduced to the eight letters — spaces, dashes and case do not
 * matter — or null when it cannot be a code at all. Ambiguous letters are refused rather than
 * corrected: a code containing an O was never issued, and mapping it to something we did issue
 * would make a typo occasionally pair the wrong phone.
 */
export function normalisePairingCode(input: string): string | null {
  const letters = input.toUpperCase().replace(/[\s-]/g, "");
  if (letters.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of letters) if (!PAIRING_ALPHABET.includes(ch)) return null;
  return letters;
}

/** 256 random bits, base64url — 43 characters, safe in a header and in a text field. */
export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Whether a bearer value has the shape `newDeviceToken` produces. Decided from the string alone, so
 * a request carrying anything else is refused before a body is read or a query made — the phone
 * routes are public, and the one thing an unpaired caller must not get is work.
 */
export function looksLikeDeviceToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** SHA-256, hex. What the database stores for both secrets. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** The bearer token on a request, or null when the header is missing or is not a bearer scheme. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1]! : null;
}

/** Where this deployment lives, for links that leave it — the same default `lib/usage.ts` uses. */
export function appUrl(): string {
  return (clean(process.env.NEXT_PUBLIC_APP_URL) || "https://scrivn.ca").replace(/\/+$/, "");
}

/**
 * What the QR carries: a URL, not a bare code, so a phone camera with no companion installed lands
 * somewhere sensible, and so the companion learns which server to talk to from the same scan — a
 * dev server and production pair the same way.
 */
export function pairingUrl(code: string): string {
  return `${appUrl()}/pair?code=${encodeURIComponent(code)}`;
}

/** The deep link the phone opens after a scan lands: the claim, with its sketch open. */
export function claimSketchUrl(claimId: string): string {
  return `${appUrl()}/claim?id=${encodeURIComponent(claimId)}&sketch=1`;
}
