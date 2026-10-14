"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { syncAll } from "@/lib/claimSync";
import { connection, netFetch } from "@/lib/connectivity";
import { blankDeviceClaim, changeDeviceClaim, deviceUser, readDeviceClaim } from "@/lib/deviceClaims";
import type { SavedClaimState } from "@/lib/claimState";
import { claimName, useDeviceWork } from "@/lib/useDeviceWork";

/**
 * The claims this device is holding that the server has not got — and the top of the list, kept on
 * the device so it opens with no signal.
 *
 * ── Why the held claims belong on the claims list specifically ───────────────────────────────────
 *
 * The list is built from server rows, so a claim that only ever got as far as this device does not
 * appear on it at all. Somebody who scoped a job in a basement with no signal comes back, opens
 * Claims, and finds nothing — at which point the reasonable conclusion is that the work is gone and
 * the reasonable response is to do it again. So they are listed here, by name, each one a link that
 * opens it from the device. Renders nothing when there are none, which is almost always.
 *
 * ── Why it sends rather than only reporting ──────────────────────────────────────────────────────
 *
 * Opening the list with signal is exactly the moment held work should go (and the header sends it
 * too — components/SyncStatus.tsx). A claim created on the server by that is not in the list this
 * page rendered with, so the page refreshes when anything went.
 *
 * ── Keeping the top of the list (2026-10-13, offline mode) ───────────────────────────────────────
 *
 * The estimator who looks at their claims in the office and then drives to a site with no signal
 * expects today's claims to open there. So the claims at the top of this list are copied to the
 * device while there is signal — only those that changed since the device last had them, and not on
 * a connection the phone has asked to save data on.
 */
export function PendingSaves({ keep }: { keep: { id: string; version: string }[] }) {
  const router = useRouter();
  const work = useDeviceWork();
  const [pushing, setPushing] = useState(false);

  const push = useCallback(async () => {
    setPushing(true);
    try {
      const { sent } = await syncAll();
      if (sent > 0) router.refresh();
    } finally {
      setPushing(false);
    }
  }, [router]);

  useEffect(() => {
    void push();
    void keepForOffline(keep);
    // `keep` is the list as rendered; a refresh renders a new one and remounts nothing, so compare by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, JSON.stringify(keep)]);

  /*
    Fewer held than a moment ago: something reached the server — sent from here, from the header when
    the signal came back, or from another tab. A claim created by that is not in the list this page
    rendered with, so ask the server for the list again.
  */
  const heldBefore = useRef(work.claims.length);
  useEffect(() => {
    if (work.claims.length < heldBefore.current && work.connection === "online") router.refresh();
    heldBefore.current = work.claims.length;
  }, [work.claims.length, work.connection, router]);

  const held = work.claims;
  if (held.length === 0) return null;

  return (
    <div className="pending-banner" role="status">
      <p>
        <strong>
          {held.length} claim{held.length === 1 ? "" : "s"} saved on this device, not yet synced
        </strong>{" "}
        — {held.length === 1 ? "it goes" : "they go"} to Scrivn on {held.length === 1 ? "its" : "their"} own when there is signal. Until
        then {held.length === 1 ? "it is" : "they are"} only on this device{work.connection === "offline" ? " (no signal now)" : ""}. Nothing
        has been lost.
      </p>
      {work.connection === "online" && (
        <button type="button" className="btn-secondary" onClick={() => void push()} disabled={pushing}>
          {pushing ? "Sending…" : "Send now"}
        </button>
      )}
      <ul className="pending-list">
        {held.map((c) => (
          <li key={c.id}>
            <Link href={`/claim?id=${c.id}`}>{claimName(c.state)}</Link>
            <span>
              {c.clash
                ? "changed in two places — open it to choose which to keep"
                : c.refused
                  ? `Scrivn would not take it: ${c.refused}`
                  : c.created
                    ? "changes not yet synced"
                    : "new — not on Scrivn yet"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Copy the claims at the top of the list to the device, so they open with no signal. */
async function keepForOffline(rows: { id: string; version: string }[]): Promise<void> {
  if (connection() === "offline") return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const user = deviceUser();
  if (user === undefined) return;
  for (const row of rows) {
    const local = await readDeviceClaim(row.id);
    // Already current, or holding changes of its own that a copy from the server must not replace.
    if (local && (local.dirty || local.clash || local.version === row.version)) continue;
    let fetched: { state: SavedClaimState; version: string };
    try {
      const res = await netFetch(`/api/claims/${row.id}`, { timeoutMs: 20_000 });
      if (!res.ok) continue;
      fetched = (await res.json()) as { state: SavedClaimState; version: string };
    } catch {
      return;
    }
    await changeDeviceClaim(row.id, (r) =>
      r && (r.dirty || r.clash)
        ? undefined
        : {
            ...(r ?? blankDeviceClaim(row.id, fetched.state, user)),
            state: fetched.state,
            version: fetched.version,
            created: true,
            dirty: false,
            sent: [],
            clash: null,
            refused: null,
            touchedAt: Date.now(),
          },
    );
  }
}
