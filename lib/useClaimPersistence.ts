"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasAnyContent, type SavedClaimState } from "./claimState";

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

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface ClaimPersistence {
  claimId: string | null;
  status: SaveStatus;
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

  const write = useCallback(async () => {
    if (!enabled) return;
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
      setStatus("saved");
    } catch (err) {
      console.error("[claim autosave]", err);
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  // Load, when the URL names a claim.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const id = new URL(window.location.href).searchParams.get("id");
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
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

  return { claimId, status, loading, loadError, forget, saveNow: write };
}

async function describe(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}
