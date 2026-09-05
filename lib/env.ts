/**
 * Environment values, cleaned before anything tries to use them.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 *
 * Twice now a production value has arrived with a leading U+FEFF — a byte-order mark, invisible in
 * every dashboard, editor and log. The first time it broke sign-in. The second time it broke email,
 * with this in the Vercel logs:
 *
 *   TypeError: Cannot convert argument to a ByteString because the character at index 7
 *   has a value of 65279 which is greater than 255
 *
 * 65279 is U+FEFF, and index 7 is the first character after "Bearer " — so the API key itself
 * carried the mark. The failure surfaces nowhere near the cause: not as "bad key", but as a type
 * error inside `fetch` building a header, from a value that looks perfectly correct everywhere a
 * human can see it.
 *
 * A BOM gets in whenever a value is copied out of a file some Windows tool saved as UTF-8-with-BOM,
 * which is most of them. It will happen again, and re-pasting the value is a fix that lasts until
 * the next paste.
 *
 * So every secret is read through here instead. Stripping is safe in a way that guessing never is:
 * no credential, URL or key this app uses may legitimately begin with a byte-order mark or end in
 * whitespace, so removing them cannot destroy a valid value — it can only rescue an invalid one.
 *
 * ── A note on NEXT_PUBLIC_ ───────────────────────────────────────────────────────────────────────
 *
 * Those are substituted into the bundle at build time, and only when written as a literal
 * `process.env.NEXT_PUBLIC_X` member expression. Passing the NAME to a function here would leave the
 * build nothing to replace and the value undefined in the browser. So callers pass the VALUE —
 * `clean(process.env.NEXT_PUBLIC_SUPABASE_URL)` — never the name.
 */

/** U+FEFF anywhere it can hide: at the start, at the end, and around surrounding whitespace. */
const BOM = /﻿/g;

/**
 * A value with byte-order marks removed and whitespace trimmed. `undefined` stays `undefined`, and
 * a value that was only ever whitespace comes back as an empty string, so the existing "is this
 * configured" checks keep working unchanged.
 */
export function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(BOM, "").trim();
}

/** The same, read by name. For server-side values only — see the NEXT_PUBLIC_ note above. */
export function cleanEnv(name: string): string | undefined {
  return clean(process.env[name]);
}
