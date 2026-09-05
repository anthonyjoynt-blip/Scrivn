/**
 * Where the legal documents live.
 *
 * Hosted by TermsFeed rather than served from this app, so it is a plain external URL. In one place
 * because it appears in three: the marketing footer, the signed-in footer, and the signup form. A URL
 * copied into three files is a URL that gets updated in two of them — and the one left pointing at a
 * dead policy is the one somebody is reading when they hand over a customer's address.
 *
 * If this ever moves to a page inside the app, only this file changes.
 */
export const PRIVACY_POLICY_URL = "https://www.termsfeed.com/live/dc332ded-da29-4e05-84bf-10b29d394efe";

/**
 * Terms and conditions, hosted the same way.
 *
 * Both footers render this conditionally rather than unconditionally — the marketing footer has
 * carried a note since it was built that a footer link to a 404 is worse than no link, and that
 * reasoning outlives the gap it was written for. Setting either constant back to null hides its link
 * again rather than shipping a dead one.
 */
export const TERMS_URL: string | null = "https://www.termsfeed.com/live/16811010-fcb1-4a70-9878-d7aaabf851e6";
