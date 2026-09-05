"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasAnyContent, type SavedClaimState } from "./claimState";
import {
  draftVerdict,
  drainInProgress,
  drainPendingSaves,
  dropPendingSave,
  newDraftKey,
  pendingSaves,
  queuePendingSave,
} from "./pendingSaves";

/**
 * Saves the claim as the PM works, and loads one back when the URL names it.
 *
 * ── Why saving is debounced and not on every change ──────────────────────────────────────────────
 *
 * Typing a customer name fires a state change per keystroke, and dragging a sketch wall fires one
 * per animation frame. A save per change would be hundreds of requests a minute carrying a payload
 * that includes the whole sketch. The delay is long enough that a burst of edits becomes one write
 * and short enough that a PM who puts the phone down mid-sentence loses at most that much.
 *
 * ── Why the last save is also flushed on the way out ─────────────────────────────────────────────
 *
 * A debounce alone drops whatever was typed in the final seconds when the tab closes, which is
 * precisely when somebody has stopped working — the most likely moment to close it. `pagehide`
 * covers that, and covers the mobile case a `beforeunload` handler does not: on iOS a tab that is
 * backgrounded and later discarded never fires `beforeunload` at all.
 *
 * ── What is deliberately not attempted ───────────────────────────────────────────────────────────
 *
 * No conflict resolution. Two devices editing one claim at once will have the later save win
 * outright, and the earlier device's screen will still show its own version until it reloads. Real
 * merging would mean reconciling an extraction tree against gap-check answers folded into a
 * different version of it, and a wrong merge produces a claim that reads as correct — a worse
 * outcome than the one this has, which is visible and recoverable by reloading. The request was to
 * move a claim BETWEEN devices, which this does.
 */

/** Long enough to collapse a burst of typing, short enough not to lose a paragraph. */
const SAVE_DELAY_MS = 1500;

export type SaveStatus = "idle" | "saving" | "saved" | "pending" | "error";

export interface ClaimPersistence {
  claimId: string | null;
  status: SaveStatus;
  /** How many claims are written to this device but not yet accepted by the server. */
  pendingCount: number;
  /** Set while a claim named in the URL is being fetched, so the page can hold off rendering it. */
  loading: boolean;
  /** Non-null when a load failed — a claim that is gone, or one belonging to somebody else. */
  loadError: string | null;
  /** Forget the current row, so the next save starts a new claim. Used by "Start Over". */
  forget: () => void;
  /** Write now rather than waiting for the debounce. */
  saveNow: () => Promise<void>;
}

export function useClaimPersistence({
  state,
  apply,
  enabled,
}: {
  /** The claim as it stands right now. Recomputed on every render; compared by value below. */
  state: SavedClaimState;
  /** Push a loaded claim back into the page's state. */
  apply: (loaded: SavedClaimState) => void;
  /**
   * False while the app has no signed-in user to save for. Without this the page would POST on
   * every keystroke and collect 401s.
   */
  enabled: boolean;
}): ClaimPersistence {
  const [claimId, setClaimId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /*
    Refs rather than state for everything the save path reads.

    The save runs from a timer and from an event listener, both of which capture whatever they saw
    when they were created. A ref is read at call time, so the write is of the claim as it is NOW
    rather than as it was when the timer was set — which is the difference between saving the last
    keystroke and saving the one before it.
  */
  const stateRef = useRef(state);
  stateRef.current = state;
  const claimIdRef = useRef<string | null>(null);
  claimIdRef.current = claimId;
  const lastSaved = useRef<string>("");
  const inFlight = useRef(false);
  /** Set while `apply` is pushing a loaded claim in, so the resulting change does not save it back. */
  const applying = useRef(false);
  /*
    The key this claim's queued save is filed under, before the server has given it a real id.

    Generated once per mount rather than per failure, so repeated failures overwrite one record
    instead of filling the device with a copy per keystroke.
  */
  const draftKey = useRef(newDraftKey());

  const refreshPendingCount = useCallback(async () => {
    setPendingCount((await pendingSaves()).length);
  }, []);

  /**
   * Push everything the device is holding, including claims that are not the one on screen.
   *
   * A record left from a previous session — a different claim, on a day with no signal — is exactly
   * the work most at risk of being forgotten, and the moment the app next has a connection is the
   * moment to clear it.
   */
  const drain = useCallback(async () => {
    if (!enabled) return;
    await drainPendingSaves({
      // The record for this page's own not-yet-created claim needs rules the others do not — see
      // `draftVerdict`, where they live so they can be tested on their own.
      decide: (record) =>
        draftVerdict({
          recordKey: record.key,
          draftKey: draftKey.current,
          claimId: claimIdRef.current,
          saving: inFlight.current,
        }),
      /*
        The claim on screen has just been created server-side. Adopt the id it was given, exactly as
        a successful save would, or the page would carry on believing it had never been saved and
        POST a second copy on the next edit.
      */
      onCreated: (record, id) => {
        if (record.key !== draftKey.current) return;
        claimIdRef.current = id;
        setClaimId(id);
        lastSaved.current = JSON.stringify(record.state);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("id", id);
          window.history.replaceState(null, "", url.toString());
        }
        setStatus("saved");
      },
    });
    await refreshPendingCount();
  }, [enabled, refreshPendingCount]);

  const write = useCallback(async () => {
    if (!enabled) return;
    /*
      Let a running drain finish first.

      Both paths can create a claim, and if this one POSTs while the drain is POSTing the same queued
      draft, the job ends up on the list twice with half the work in each. Waiting costs nothing —
      the drain either adopts an id, in which case what follows is a PUT to it, or it fails and
      leaves the queue alone. Everything below reads through refs, so the wait cannot make it write a
      stale copy: it reads the state as it is afterwards, not as it was when the timer fired.
    */
    const inFlightDrain = drainInProgress();
    if (inFlightDrain) await inFlightDrain;

    const current = stateRef.current;
    const serialised = JSON.stringify(current);
    // Nothing changed since the last successful write — the commonest case once a PM stops typing.
    if (serialised === lastSaved.current) return;
    if (!hasAnyContent(current)) return;
    if (inFlight.current) return;

    inFlight.current = true;
    setStatus("saving");
    try {
      const id = claimIdRef.current;
      if (id === null) {
        const res = await fetch("/api/claims", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state: current }),
        });
        if (!res.ok) throw new Error(await describe(res));
        const { id: created } = await res.json();
        claimIdRef.current = created;
        setClaimId(created);
        /*
          Put the id in the URL without a navigation. It makes the address the PM is looking at the
          one that reopens this claim — which is what makes "email myself the link" work, and what
          stops a reload starting a second empty claim.
        */
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("id", created);
          window.history.replaceState(null, "", url.toString());
        }
      } else {
        const res = await fetch(`/api/claims/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state: current }),
        });
        if (!res.ok) throw new Error(await describe(res));
      }
      lastSaved.current = serialised;
      /*
        Accepted, so anything queued for this claim is stale by definition — the server now holds
        something newer. Leaving it would push an older state back over this one on the next drain.
      */
      await dropPendingSave(claimIdRef.current ?? draftKey.current);
      await dropPendingSave(draftKey.current);
      void refreshPendingCount();
      setStatus("saved");
    } catch (err) {
      console.error("[claim autosave]", err);
      /*
        Keep it on the device rather than only reporting the failure.

        This is the whole point: autosave already retries on the next edit, but a PM who has STOPPED
        editing never triggers one — and stopping is what happens right before a tab is closed or a
        phone goes in a pocket. Written here, the work survives that and is pushed when signal
        returns.
      */
      const queued = await queuePendingSave({
        key: claimIdRef.current ?? draftKey.current,
        claimId: claimIdRef.current,
        state: current,
        queuedAt: Date.now(),
      });
      void refreshPendingCount();
      // "pending" says the work is safe on this device; "error" says it may not be. The difference
      // matters to somebody deciding whether they can close the tab.
      setStatus(queued ? "pending" : "error");
    } finally {
      inFlight.current = false;
    }
  }, [enabled, refreshPendingCount]);

  /*
    Keep watching for a chance to push what the device is holding.

    Two triggers here, and a third inside the load below:

      * `online` — the moment signal returns, which is the case this whole file exists for. Note it
        fires on regaining a network INTERFACE, which is not the same as reaching the internet; a
        drain that still fails simply leaves the records where they are.
      * an interval — for the connection that is technically up and carrying nothing, where no
        `online` event ever fires. Slow on purpose: this is a backstop, not a poll.
  */
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onOnline = () => void drain();
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => void drain(), 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [enabled, drain]);

  // Load, when the URL names a claim.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const id = new URL(window.location.href).searchParams.get("id");
    let cancelled = false;
    if (id) setLoading(true);
    void (async () => {
      try {
        /*
          Clear the queue before reading, and AWAIT it — this is the mount-time drain, deliberately
          not a separate effect. Effects fire in order but their async bodies interleave, so a drain
          started alongside this fetch would routinely lose the race: the server would answer with
          the copy it already had, `apply` would put that older claim on screen, and the next edit
          would save it back over the newer state the drain had just pushed. Losing work here would
          be losing exactly the work this whole mechanism exists to protect.

          The drain runs even with no `id` in the URL — a record queued in a previous session, on
          some other claim, is the one most likely to be forgotten otherwise.
        */
        await drain();
        if (cancelled || !id) return;
        const res = await fetch(`/api/claims/${id}`);
        if (!res.ok) throw new Error(res.status === 404 ? "That claim could not be found." : await describe(res));
        const { state: loaded } = await res.json();
        if (cancelled) return;
        applying.current = true;
        apply(loaded);
        claimIdRef.current = id;
        setClaimId(id);
        /*
          Recorded as the baseline BEFORE the page has re-rendered with it. Without this the first
          debounce after a load would see a difference and write the claim straight back — harmless
          but pointless, and it would bump `updated_at` on every claim merely opened, reordering the
          list by what was looked at rather than what was worked on.
        */
        lastSaved.current = JSON.stringify(loaded);
        setStatus("saved");
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not open that claim.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          applying.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once, on mount. `apply` changes identity on every render of the page and is not a reason to
    // re-fetch; re-running this would re-load the claim over the PM's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Save, after the edits stop.
  useEffect(() => {
    if (!enabled || loading || applying.current) return;
    const timer = setTimeout(() => void write(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, enabled, loading, write]);

  // And on the way out, so the last few seconds are not lost.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const flush = () => void write();
    window.addEventListener("pagehide", flush);
    // Backgrounding, which on mobile is the last event before a tab may be discarded outright.
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [enabled, write]);

  const forget = useCallback(() => {
    claimIdRef.current = null;
    setClaimId(null);
    lastSaved.current = "";
    setStatus("idle");
    setLoadError(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("id");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  return { claimId, status, pendingCount, loading, loadError, forget, saveNow: write };
}

async function describe(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}
