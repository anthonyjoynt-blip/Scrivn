"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isRunning, runWaitingJobs } from "@/lib/aiJobs";
import { syncAll } from "@/lib/claimSync";
import { connection, onReconnect, probe } from "@/lib/connectivity";
import { pruneDeviceClaims } from "@/lib/deviceClaims";
import { sendWaitingPhotos } from "@/lib/devicePhotos";
import { claimName, useDeviceWork } from "@/lib/useDeviceWork";

/**
 * Online or not, and what is waiting to sync — in the header of every page (2026-10-13).
 *
 * Says nothing while online with nothing waiting, which is almost always: a permanent "all synced"
 * badge trains people to stop looking at the space it needs when it matters. Offline it always says
 * so, because that is when an estimator needs to know that Generate will wait and a save is only on
 * the phone. Tapping it lists what is waiting, each with a way to it.
 *
 * It is also what SENDS the waiting work, from whichever page is open: when the page loads, the
 * moment the signal is back, and on a slow backstop timer. The claim page sends its own claim too;
 * the two cannot collide (see lib/claimSync.ts).
 */
export function SyncStatus() {
  const work = useDeviceWork();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const send = async () => {
      if (connection() !== "online") return;
      setBusy(true);
      try {
        await syncAll();
        // After the claims: Scrivn takes a photo's picture only once its claim lists it.
        await sendWaitingPhotos();
        await runWaitingJobs();
      } finally {
        if (alive) setBusy(false);
      }
    };
    /*
      Ask once on load whether there is any signal at all. A page that has nothing to send makes no
      request of its own, so without this it would not know it was offline until the estimator's
      first change failed to save — and "Offline" is most useful before they start, not after.
    */
    void probe().then((reachable) => {
      if (reachable) void send();
    });
    void pruneDeviceClaims();
    const off = onReconnect(() => void send());
    // A backstop for a connection that is technically up and carrying nothing, where no event fires.
    const timer = setInterval(() => void send(), 60_000);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, []);

  // Close the list on a tap anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const offline = work.connection === "offline";
  const clashes = work.claims.filter((c) => c.clash).length;
  // A trace that has come back is not waiting on anything but being looked at; it is listed, not counted.
  const count = work.claims.length + work.jobs.filter((j) => !(j.kind === "trace" && j.result)).length;
  // Photos counted on their own: "12 waiting" for twelve photos and no claim would read as twelve claims.
  const photoCount = work.photos.reduce((sum, p) => sum + p.count, 0);
  const photosLabel = photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"}` : "";

  if (work.signedOutWaiting > 0) {
    return (
      <div className="sync-status">
        <span className="sync-pill sync-pill-waiting">
          {work.signedOutWaiting} claim{work.signedOutWaiting === 1 ? "" : "s"} on this device waiting — sign in to sync
        </span>
      </div>
    );
  }
  if (!offline && count === 0 && work.jobs.length === 0 && photoCount === 0) return null;

  const label = offline
    ? count > 0 || photoCount > 0
      ? `Offline · ${[count > 0 ? `${count} waiting` : "", photosLabel].filter(Boolean).join(" · ")}${count === 0 ? " waiting" : ""}`
      : "Offline"
    : clashes > 0
      ? `${clashes} need${clashes === 1 ? "s" : ""} your choice`
      : count === 0 && photoCount > 0
        ? busy
          ? `Uploading ${photosLabel}…`
          : `${photosLabel} waiting to upload`
        : count === 0
          ? "AI trace ready"
          : busy
            ? `Syncing ${count}…`
            : `${count} waiting to sync${photoCount > 0 ? ` · ${photosLabel}` : ""}`;

  return (
    <div className="sync-status" ref={box}>
      <button
        type="button"
        className={`sync-pill${offline ? " sync-pill-offline" : ""}${clashes > 0 ? " sync-pill-clash" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sync-dot" aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div className="sync-panel" role="dialog" aria-label="Waiting to sync">
          <p className="sync-panel-head">
            {offline
              ? "No signal. Everything below is saved on this device and goes to Scrivn on its own when the signal is back."
              : "Saved on this device and on its way to Scrivn."}
          </p>
          {work.claims.length + work.jobs.length + work.photos.length === 0 ? (
            <p className="field-note">Nothing is waiting. You can keep working — claims save on this device and sync later.</p>
          ) : (
            <ul className="sync-list">
              {work.claims.map((c) => (
                <li key={c.id}>
                  <Link href={`/claim?id=${c.id}`} onClick={() => setOpen(false)}>
                    {claimName(c.state)}
                  </Link>
                  <span className={c.clash ? "sync-item-clash" : undefined}>
                    {c.clash
                      ? c.clash.state
                        ? "Changed in two places — choose which to keep"
                        : "Deleted from Scrivn — choose whether to keep it"
                      : c.refused
                        ? `Scrivn would not take it: ${c.refused}`
                        : "Saved on this phone, not yet synced"}
                  </span>
                </li>
              ))}
              {work.photos.map((p) => (
                <li key={`photos-${p.claimId}`}>
                  <Link href={`/claim?id=${p.claimId}`} onClick={() => setOpen(false)}>
                    {work.names[p.claimId] ?? "A claim"}
                  </Link>
                  <span className={p.refused > 0 ? "sync-item-clash" : undefined}>
                    {p.count} photo{p.count === 1 ? "" : "s"} waiting to upload
                    {p.refused > 0 ? ` — Scrivn would not take ${p.refused}; open the claim's photos to see why` : ""}
                  </span>
                </li>
              ))}
              {work.jobs.map((j) => (
                <li key={j.key}>
                  {j.kind === "trace" ? (
                    <span>AI trace of a side photo</span>
                  ) : (
                    <Link href={`/claim?id=${j.claimId}`} onClick={() => setOpen(false)}>
                      {work.names[j.claimId] ?? "A claim"}
                    </Link>
                  )}
                  <span>
                    {j.error
                      ? `Could not ${j.kind === "extract" ? "read the transcript" : j.kind === "generate" ? "generate the documents" : "trace"}: ${j.error}`
                      : j.kind === "trace" && j.result
                        ? "Traced — open the side's elevation to see it"
                        : isRunning(j.key)
                          ? j.kind === "extract"
                            ? "Reading the transcript…"
                            : j.kind === "generate"
                              ? "Generating the documents…"
                              : "Tracing…"
                          : j.kind === "extract"
                            ? "Transcript waiting to be read"
                            : j.kind === "generate"
                              ? "Documents waiting to be generated"
                              : "Waiting for signal"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
