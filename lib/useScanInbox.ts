"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingScan } from "./scanInbox";

/**
 * The scans a paired phone has sent into the open claim, waiting for the page to apply them.
 *
 * ── Why the page has to come and get them ────────────────────────────────────────────────────────
 *
 * A scan for a claim that already exists is never written into the claim by the server: the page
 * autosaves the whole payload after every edit, so anything the server slipped in would be erased
 * by the next keystroke (see lib/scanInbox.ts). The server files it as a pending row instead, and
 * this hook is how the page finds out. It asks as soon as the claim is known, again whenever the tab
 * comes back into view or into focus — the estimator has just put the phone down and looked up at
 * the laptop, which is exactly when the scan should be there — and once a minute as a backstop for
 * a tab that never left the front. No push channel: the message is small, a minute is fine, and a
 * socket is one more thing to keep alive on a job site with poor signal.
 *
 * ── Not claim state ──────────────────────────────────────────────────────────────────────────────
 *
 * A hook in its own file rather than a `useState` on the claim page, for the reason `useLetterhead`
 * gives: the page's guards demand that every state is saved with the claim or documented as not,
 * and a scan that has not been applied is neither — it belongs to the server until the estimator
 * says what becomes of it. Failures are swallowed after one warning because there is nothing for
 * the estimator to do about them: the scan is safe on the server and the next poll tries again.
 */

/** How often to ask when nothing else has prompted it. Slow on purpose: a backstop, not a poll. */
const POLL_INTERVAL_MS = 60_000;

export type ScanResolution = "adopted" | "discarded";

export interface ScanInbox {
  /** Oldest first, as the server lists them, and only ever for `claimId` — the page deals with `pending[0]` and the rest follow. */
  pending: PendingScan[];
  /** Ask the server again now. */
  refresh: () => Promise<void>;
  /** Tell the server what became of a scan, and stop offering it here. */
  resolve: (scanId: string, status: ScanResolution) => Promise<void>;
}

export function useScanInbox({
  claimId,
  enabled,
}: {
  /** The claim on screen, or null while it has no saved row — there is nothing to have scans yet. */
  claimId: string | null;
  /** False in the dev fail-open and while a claim is still loading, when asking would be premature or a 401. */
  enabled: boolean;
}): ScanInbox {
  const [pending, setPending] = useState<PendingScan[]>([]);
  /*
    The claim id as it is NOW, read after a fetch returns. Start Over forgets the claim while a
    request may be in flight, and a list of scans for the claim that was just left must not land on
    the blank one that replaced it.
  */
  const claimIdRef = useRef(claimId);
  claimIdRef.current = claimId;
  /** One warning per page, not one per minute — the console is for the first failure, not a log of them. */
  const warned = useRef(false);

  const warn = useCallback((what: string, err: unknown) => {
    if (warned.current) return;
    warned.current = true;
    console.warn(`[scan inbox] ${what}`, err);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || claimId === null) return;
    try {
      const res = await fetch(`/api/claims/${claimId}/scans`);
      if (!res.ok) throw new Error(`Request failed (${res.status}).`);
      const body = (await res.json()) as { scans?: PendingScan[] } | null;
      if (claimIdRef.current !== claimId) return;
      if (Array.isArray(body?.scans)) setPending(body.scans);
    } catch (err) {
      warn("could not check for scans from the phone:", err);
    }
  }, [enabled, claimId, warn]);

  useEffect(() => {
    if (!enabled || claimId === null || typeof window === "undefined") {
      // Nothing to offer without a claim; and a scan left over from the previous claim least of all.
      setPending((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [enabled, claimId, refresh]);

  const resolve = useCallback(
    async (scanId: string, status: ScanResolution) => {
      // Off the screen at once: the estimator has answered, and the answer should not wait on the
      // network. If the server never hears it, the row comes back on the next poll and the page,
      // which remembers what it did with each scan, answers again rather than applying it twice.
      setPending((prev) => prev.filter((scan) => scan.id !== scanId));
      const id = claimIdRef.current;
      if (id === null) return;
      try {
        const res = await fetch(`/api/claims/${id}/scans/${scanId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        });
        // 404 is "nothing changed" — already resolved from another tab — which is the outcome wanted.
        if (!res.ok && res.status !== 404) throw new Error(`Request failed (${res.status}).`);
      } catch (err) {
        warn("could not record what became of a scan:", err);
      }
    },
    [warn],
  );

  /*
    Only the claim on screen, decided at read time. The list is emptied by an effect when the claim
    changes, which is one render late: Start Over clears the sketch and forgets the claim in the same
    batch, and in the render that follows the old claim's scan would still be here — against an empty
    sketch, which the rule reads as "nothing to lose". A scan filtered by the claim it was sent to
    cannot be offered to a claim it was not.
  */
  const forThisClaim = claimId === null ? [] : pending.filter((scan) => scan.claimId === claimId);
  return { pending: forThisClaim, refresh, resolve };
}
