"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LETTERHEAD, type Letterhead } from "./letterhead";
import { isSupabaseConfigured } from "./supabase/env";

/**
 * The organization's letterhead, for drawing documents.
 *
 * Starts as the default and swaps to the organization's own once it has loaded. That ordering is
 * fine because nothing draws a document at mount: extraction, the gap-check and generation all
 * come first, and by then the fetch has long finished. If it fails — offline, or the migration not
 * applied — documents carry the default rather than not rendering, which is the same rule
 * `lib/organizationRepo.ts` applies on the server.
 *
 * ── Not claim state ──────────────────────────────────────────────────────────────────────────────
 *
 * This is deliberately a hook in its own file rather than a `useState` on the claim page. The page
 * has two guards over its state — every piece is cleared by `reset()` and saved with the claim, or
 * documented as neither — and the letterhead is neither: it belongs to the organization, outlives
 * every claim, and must survive starting a new one. Keeping it out of the page keeps it out of
 * those rules, correctly.
 */
export function useLetterhead(): Letterhead {
  const [letterhead, setLetterhead] = useState<Letterhead>(DEFAULT_LETTERHEAD);

  useEffect(() => {
    // The dev fail-open has nobody signed in and no organization to read — see `isSupabaseConfigured`.
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    void fetch("/api/organization/letterhead")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { letterhead?: Letterhead } | null) => {
        if (!cancelled && body?.letterhead) setLetterhead(body.letterhead);
      })
      .catch(() => {
        // The default is already in place; there is nothing better to do with the failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return letterhead;
}
