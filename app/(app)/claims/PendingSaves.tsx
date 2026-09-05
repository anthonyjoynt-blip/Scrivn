"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { drainPendingSaves, pendingSaves } from "@/lib/pendingSaves";

/**
 * Says so when this device is holding work the server has never seen.
 *
 * ── Why this belongs on the claims list specifically ─────────────────────────────────────────────
 *
 * The list is built from server rows, so a claim that only ever got as far as this device does not
 * appear on it at all. Somebody who scoped a job in a basement with no signal comes back, opens
 * Claims, and finds nothing — at which point the reasonable conclusion is that the work is gone and
 * the reasonable response is to do it again. This is the one screen where the queue's existence has
 * to be visible, because it is the one screen whose emptiness is otherwise a lie.
 *
 * ── Why it pushes rather than only reporting ─────────────────────────────────────────────────────
 *
 * Opening the list means the app has a connection, which is exactly the moment the queue should
 * clear. The claim page does the same on its own mount; a PM who goes straight to the list after
 * regaining signal would otherwise have to open each claim to get it saved.
 *
 * Renders nothing at all when the queue is empty, which is almost always. A permanent "everything is
 * synced" badge would train people to ignore the space this needs when it matters.
 */
export function PendingSaves() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [pushing, setPushing] = useState(false);

  const push = useCallback(async () => {
    setPushing(true);
    try {
      /*
        No `decide` or `onCreated` here, unlike the claim page. Nothing is being edited on this
        screen, so there is no draft to protect from being sent twice and no id for the page to
        adopt — every record is simply owed to the server.
      */
      const { pushed, remaining } = await drainPendingSaves();
      setCount(remaining);
      // A claim that has just been created server-side is not in the list this page rendered with.
      if (pushed > 0) router.refresh();
    } finally {
      setPushing(false);
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Read first, so the count is right even when the push cannot get through.
      const queued = await pendingSaves();
      if (cancelled || queued.length === 0) return;
      setCount(queued.length);
      await push();
    })();

    const onOnline = () => void push();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [push]);

  if (count === 0) return null;

  return (
    <div className="pending-banner" role="status">
      <p>
        <strong>
          {count} claim{count === 1 ? "" : "s"} saved on this device only
        </strong>{" "}
        — {count === 1 ? "it has" : "they have"} not reached the server yet, so {count === 1 ? "it is" : "they are"} not
        in the list below and cannot be opened on another device. Nothing has been lost.
      </p>
      <button type="button" className="btn-secondary" onClick={() => void push()} disabled={pushing}>
        {pushing ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}
