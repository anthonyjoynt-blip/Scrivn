/**
 * One retry for a query refused as "JWT issued at future".
 *
 * ── What that error is ───────────────────────────────────────────────────────────────────────────
 *
 * The session token is refreshed by whichever request happens to run first after it expires, and
 * carries an issued-at time from the auth server's clock. If a second request on the same page
 * uses the new token within about a second, PostgREST — checking it against the DATABASE's clock —
 * can find it dated slightly in the future and refuse it. Seen on scrivn.ca on 2026-09-13: the
 * account page's three concurrent reads, the first request after a deploy, and the letterhead
 * card fell back to "settings aren't available right now". A reload was fine.
 *
 * ── Why it is worth a retry ──────────────────────────────────────────────────────────────────────
 *
 * Every read of the organization and profile is fail-soft — deliberately, so a document never fails
 * to render over its branding. The cost of that is that this transient becomes a SILENT wrong
 * answer: a claim page fetching its letterhead in that second gets the Scrivn default, and the PDF
 * goes out with the wrong company on it, and nothing anywhere says so. A one-second wait and one
 * more try closes the window for the price of a second, once an hour at most.
 *
 * Only this error, only once. Anything else propagates exactly as before.
 */

const SKEW_MESSAGE = /issued at future/i;
const SKEW_WAIT_MS = 1100;

/** Whether a Supabase/PostgREST error is the clock-skew refusal and nothing else. */
export function isClockSkewError(error: { message?: string } | null | undefined): boolean {
  return typeof error?.message === "string" && SKEW_MESSAGE.test(error.message);
}

/**
 * Runs `query`, and once more after a short wait if its error was the clock-skew refusal.
 *
 * Takes the Supabase result shape as-is — `{ data, error }` — so a call site changes from
 * `await supabase.from(...)` to `await withClockSkewRetry(() => supabase.from(...))` and nothing
 * else, and keeps reading `error` exactly as it did. `wait` is injectable for the tests.
 */
export async function withClockSkewRetry<T extends { error: { message?: string } | null }>(
  query: () => PromiseLike<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  const first = await query();
  if (!isClockSkewError(first.error)) return first;
  await wait(SKEW_WAIT_MS);
  return query();
}
