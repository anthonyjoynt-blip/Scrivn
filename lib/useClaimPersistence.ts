"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasAnyContent, type SavedClaimState } from "./claimState";
import { clashDifferences, stableStringify, syncAll, syncClaim, withPhotosMerged, type SyncOutcome } from "./claimSync";
import { mergeClaimPhotos, type ClaimPhotos } from "./photos";
import { forgetClaimPhotoFiles } from "./devicePhotos";
import { connection, isNetworkFailure, netFetch, onReconnect } from "./connectivity";
import {
  blankDeviceClaim,
  changeDeviceClaim,
  deviceStorageWorks,
  deviceUser,
  forgetDeviceClaim,
  isMine,
  newClaimId,
  onDeviceChange,
  pruneDeviceClaims,
  readDeviceClaim,
  type DeviceClaim,
} from "./deviceClaims";

/**
 * Saves the claim as the PM works — to this device first, then to the server — and loads one back
 * when the URL names it, from the device when there is no signal.
 *
 * ── Device first (2026-10-13, offline mode) ───────────────────────────────────────────────────────
 *
 * Every save is written to the device before it is sent (lib/deviceClaims.ts), and a claim opened
 * here opens from the device's copy at once, then checks the server. So a claim keeps working with
 * no signal at all: it reopens, it changes, it survives the tab closing, and it is sent when the
 * signal is back (lib/claimSync.ts) — by this page, by the header, or by the Claims list, whichever
 * is open then. A claim started offline is given its id here, so even it can be reopened.
 *
 * Each save names the server version it was made from, so a phone that worked offline for a day
 * cannot silently overwrite what the office did to the claim in that day. When both changed, both
 * are kept and the PM is asked (`clash`, `resolveClash`).
 *
 * ── Photos from another phone ────────────────────────────────────────────────────────────────────
 *
 * The one part of a claim merged rather than asked about (see lib/claimSync.ts). A merge happens on
 * the device's copy, so it is brought onto the screen here (`applyPhotos`), and every write folds the
 * device's photos into the page's before it goes — a photo that arrived from the other phone a moment
 * ago must not be saved away by a page that has not shown it yet.
 *
 * ── Why saving is debounced and not on every change ──────────────────────────────────────────────
 *
 * Typing a customer name fires a state change per keystroke, and dragging a sketch wall fires one
 * per animation frame. A save per change would be hundreds of writes a minute carrying a payload
 * that includes the whole sketch. The delay is long enough that a burst of edits becomes one write
 * and short enough that a PM who puts the phone down mid-sentence loses at most that much.
 *
 * ── Why the last save is also flushed on the way out ─────────────────────────────────────────────
 *
 * A debounce alone drops whatever was typed in the final seconds when the tab closes, which is
 * precisely when somebody has stopped working — the most likely moment to close it. `pagehide`
 * covers that, and covers the mobile case a `beforeunload` handler does not: on iOS a tab that is
 * backgrounded and later discarded never fires `beforeunload` at all.
 */

/** Long enough to collapse a burst of typing, short enough not to lose a paragraph. */
const SAVE_DELAY_MS = 1500;

export type SaveStatus =
  | "idle"
  | "saving"
  /** The server has it. */
  | "saved"
  /** Safe on this device, not yet on the server — no signal. */
  | "pending"
  /** Changed here AND on the server; both kept, the PM to choose. */
  | "clash"
  /** Safe on this device; the session has gone, so it waits for a sign-in. */
  | "signed-out"
  /** Safe on this device; the server will not take it, and said why. */
  | "refused"
  /** Not saved anywhere that survives a reload. */
  | "error";

export interface Clash {
  /** The server's copy; null when the claim was deleted there. */
  theirs: SavedClaimState | null;
  at: number;
  /** Which parts of the claim differ, in words. */
  differs: string[];
}

export interface ClaimPersistence {
  /** The claim's id — chosen here for a claim started here — or null before it has any content. */
  claimId: string | null;
  /** The server has a row under `claimId`. Things that live on the server (scans) need one. */
  onServer: boolean;
  status: SaveStatus;
  /** The server's reason, when `status` is "refused". */
  refusedReason: string | null;
  /** Set while a claim named in the URL is being opened, so the page can hold off rendering it. */
  loading: boolean;
  /** Non-null when a load failed — a claim that is gone, one belonging to somebody else, or none here offline. */
  loadError: string | null;
  /** When the claim was opened from this device's copy because the server could not be reached: that copy's last change. */
  openedFromDevice: number | null;
  clash: Clash | null;
  /** Keep this device's copy, the server's, or both (this device's becomes a new claim). */
  resolveClash: (keep: "mine" | "theirs" | "both") => Promise<void>;
  /**
   * The claim's id now, giving it one if it has none yet — for something that must name the claim
   * before its first save has happened, as a Claude step waiting for signal does. The save itself
   * still goes through the page's checkpoint.
   */
  claimIdNow: () => string;
  /** Forget the current claim, so the next save starts a new one. Used by "Start Over". */
  forget: () => void;
  /** Write now rather than waiting for the debounce. */
  saveNow: () => Promise<void>;
}

function statusOf(outcome: SyncOutcome): SaveStatus | null {
  switch (outcome.kind) {
    case "synced":
      return "saved";
    case "clash":
      return "clash";
    case "signed-out":
      return deviceStorageWorks() ? "signed-out" : "error";
    case "refused":
      return deviceStorageWorks() ? "refused" : "error";
    case "offline":
    case "failed":
      // "pending" says the work is safe on this device; "error" says it may not be. The difference
      // matters to somebody deciding whether they can close the tab.
      return deviceStorageWorks() ? "pending" : "error";
    case "none":
      return null;
  }
}

/** The status a stored record stands at, when nothing is in flight. */
function statusOfRecord(record: DeviceClaim): SaveStatus {
  if (record.clash) return "clash";
  if (record.refused) return "refused";
  return record.dirty ? (deviceStorageWorks() ? "pending" : "error") : "saved";
}

function putIdInUrl(id: string | null) {
  /*
    The id goes in the URL without a navigation. It makes the address the PM is looking at the one
    that reopens this claim — on this device with no signal too — and stops a reload starting a
    second empty claim.
  */
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  window.history.replaceState(null, "", url.toString());
}

function copyOf(state: SavedClaimState): SavedClaimState {
  const name = state.claim.customerName.trim();
  return { ...state, claim: { ...state.claim, customerName: `${name || "Claim"} (copy)` } };
}

export function useClaimPersistence({
  state,
  apply,
  applyPhotos,
  enabled,
}: {
  /** The claim as it stands right now. Recomputed on every render; compared by value below. */
  state: SavedClaimState;
  /** Push a loaded claim back into the page's state. */
  apply: (loaded: SavedClaimState) => void;
  /** Bring photos merged in from another phone onto the page — see the file's note. Given the merged set. */
  applyPhotos?: (photos: ClaimPhotos) => void;
  /**
   * False while there is nowhere to save to — a production build with no Supabase project, where
   * there is nobody to save for and the page would only collect 401s. See `claimsCanSave`.
   */
  enabled: boolean;
}): ClaimPersistence {
  const [claimId, setClaimId] = useState<string | null>(null);
  const [onServer, setOnServer] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [refusedReason, setRefusedReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openedFromDevice, setOpenedFromDevice] = useState<number | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);

  /*
    Refs rather than state for everything the save path reads.

    The save runs from a timer and from an event listener, both of which capture whatever they saw
    when they were created. A ref is read at call time, so the write is of the claim as it is NOW
    rather than as it was when the timer was set — which is the difference between saving the last
    keystroke and saving the one before it.
  */
  const stateRef = useRef(state);
  stateRef.current = state;
  const applyPhotosRef = useRef(applyPhotos);
  applyPhotosRef.current = applyPhotos;
  const claimIdRef = useRef<string | null>(null);
  /**
   * What was last written to the device, or put on screen from it — the baseline a change is
   * measured against, which is also what stops a claim just loaded being saved straight back.
   */
  const lastWritten = useRef<string>("");
  /** A write in progress, so a flush on the way out does not start a second one beside it. */
  const writing = useRef<Promise<void> | null>(null);

  const reflect = useCallback((record: DeviceClaim) => {
    setOnServer(record.created);
    setRefusedReason(record.refused);
    setClash(record.clash ? { theirs: record.clash.state, at: record.clash.at, differs: clashDifferences(record.state, record.clash.state) } : null);
  }, []);

  const putOnScreen = useCallback(
    (id: string, loaded: SavedClaimState) => {
      apply(loaded);
      claimIdRef.current = id;
      setClaimId(id);
      /*
        Recorded as the baseline BEFORE the page has re-rendered with it. Without this the first
        debounce after a load would see a difference and write the claim straight back — harmless
        but pointless, and it would bump the version on every claim merely opened.
      */
      lastWritten.current = JSON.stringify(loaded);
    },
    [apply],
  );

  /** After a send of the claim on screen, by anybody: show where it stands. */
  const settle = useCallback(
    async (id: string, outcome?: SyncOutcome) => {
      if (claimIdRef.current !== id) return;
      const record = await readDeviceClaim(id);
      if (claimIdRef.current !== id || !record) return;
      reflect(record);
      /*
        Photos merged into the device's copy from another phone: onto the screen. Merged with what the
        page holds rather than put over it, so a photo taken here a moment ago is not lost either.
      */
      const onPage = stateRef.current.photos;
      if (onPage && record.state.photos && stableStringify(onPage) !== stableStringify(record.state.photos)) {
        const merged = mergeClaimPhotos(onPage, record.state.photos);
        if (stableStringify(merged) !== stableStringify(onPage)) applyPhotosRef.current?.(merged);
      }
      setStatus((outcome && statusOf(outcome)) ?? statusOfRecord(record));
    },
    [reflect],
  );

  const claimIdNow = useCallback((): string => {
    if (claimIdRef.current) return claimIdRef.current;
    const id = newClaimId();
    claimIdRef.current = id;
    setClaimId(id);
    putIdInUrl(id);
    return id;
  }, []);

  const writeNow = useCallback(async () => {
    const current = stateRef.current;
    const serialised = JSON.stringify(current);
    // Nothing changed since the last write — the commonest case once a PM stops typing.
    if (serialised === lastWritten.current) return;
    if (!hasAnyContent(current)) return;

    const id = claimIdNow();
    lastWritten.current = serialised;

    // On the device first: from here on the work survives the tab closing, signal or not.
    const user = deviceUser() ?? null;
    let unchanged = false;
    const record = await changeDeviceClaim(id, (r) => {
      // Photos another phone added since this page last showed them stay — see the file's note.
      const next = r ? withPhotosMerged(current, r.state) : current;
      if (r && !r.dirty && !r.clash && r.created && stableStringify(next) === stableStringify(r.state)) {
        // What the device already holds and the server already has: nothing to send.
        unchanged = true;
        return undefined;
      }
      return {
        ...(r ?? blankDeviceClaim(id!, next, user)),
        state: next,
        dirty: true,
        // Changed, so a refusal of the previous state no longer stands: this one gets its own try.
        refused: null,
        changedAt: Date.now(),
        touchedAt: Date.now(),
      };
    });
    if (unchanged) return settle(id);
    if (claimIdRef.current !== id) return;
    if (record?.clash) return settle(id);

    setStatus(connection() === "offline" && deviceStorageWorks() ? "pending" : "saving");
    const outcome = await syncClaim(id).catch((err): SyncOutcome => {
      console.error("[claim save]", err);
      return { kind: "failed", message: err instanceof Error ? err.message : "Could not save." };
    });
    await settle(id, outcome);
  }, [settle, claimIdNow]);

  const write = useCallback(async () => {
    if (!enabled) return;
    // One at a time; one asked for while another runs goes after it, and reads the state as it is then.
    const previous = writing.current;
    const next = (previous ?? Promise.resolve()).then(writeNow, writeNow);
    writing.current = next;
    try {
      await next;
    } finally {
      if (writing.current === next) writing.current = null;
    }
  }, [enabled, writeNow]);

  // Load, when the URL names a claim.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const id = new URL(window.location.href).searchParams.get("id");
    let cancelled = false;
    if (!id) {
      // Nothing to open, but the device may be holding other claims that are owed to the server.
      void syncAll();
      void pruneDeviceClaims();
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const user = deviceUser();
        let local = await readDeviceClaim(id);
        if (local && !isMine(local, user)) local = null;
        if (cancelled) return;

        // Straight from the device when it has a copy: instant, and the only way with no signal.
        if (local) {
          putOnScreen(id, local.state);
          reflect(local);
          setStatus(statusOfRecord(local));
          setLoading(false);
          void changeDeviceClaim(id, (r) => (r ? { ...r, touchedAt: Date.now() } : undefined));
        }

        /*
          This device has work on it the server has not seen: send that, rather than reading the
          server and putting an older claim on screen over it. The version it carries is what
          catches the server having moved on meanwhile — a clash, kept and asked about.
        */
        if (local && (local.dirty || !local.created)) {
          if (local.clash) return;
          const outcome = await syncClaim(id);
          if (cancelled) return;
          await settle(id, outcome);
          if (outcome.kind === "offline") setOpenedFromDevice(local.changedAt);
          return;
        }

        let res: Response;
        try {
          res = await netFetch(`/api/claims/${id}`, { timeoutMs: 20_000 });
        } catch (err) {
          if (!isNetworkFailure(err)) throw err;
          if (local) {
            setOpenedFromDevice(local.changedAt);
            return;
          }
          throw new Error("There is no signal, and this claim has not been opened on this device before, so there is no copy of it here. It will open when you have signal.");
        }
        if (cancelled) return;
        if (res.status === 404) {
          if (!local) throw new Error("That claim could not be found.");
          /*
            Deleted on the server while this device held a clean copy — so nothing here is lost by
            letting go of it. What is on screen stays, but as nobody's claim: a change to it starts a
            new one rather than quietly bringing the deleted one back.
          */
          await forgetDeviceClaim(id);
          // Its pictures went with it on the server; any still waiting here have nowhere to go.
          await forgetClaimPhotoFiles(id);
          claimIdRef.current = null;
          setClaimId(null);
          setStatus("idle");
          putIdInUrl(null);
          throw new Error("That claim has been deleted from Scrivn. What is on screen is this device's last copy of it; changing it will save it as a new claim.");
        }
        if (!res.ok) {
          // The server is there but failing. A copy on the device is a better answer than an error.
          if (local) return;
          throw new Error(await describe(res));
        }
        const { state: loaded, version } = (await res.json()) as { state: SavedClaimState; version?: string };
        if (cancelled) return;

        if (!local || local.version !== (version ?? null)) {
          /*
            The server has moved on from the copy on screen (or there was none). Show the server's —
            unless the PM has already started changing the device's copy, in which case that is saved
            as an edit of the version it was, and the version check decides whether it is a clash.
          */
          const latest = local ? await readDeviceClaim(id) : null;
          if (latest?.dirty) {
            void write();
            return;
          }
          putOnScreen(id, loaded);
          await changeDeviceClaim(id, (r) => ({
            ...(r ?? blankDeviceClaim(id, loaded, user ?? null)),
            state: loaded,
            version: version ?? null,
            created: true,
            dirty: false,
            sent: [],
            clash: null,
            refused: null,
            touchedAt: Date.now(),
          }));
        }
        setOnServer(true);
        setStatus("saved");
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not open that claim.");
      } finally {
        if (!cancelled) setLoading(false);
        void pruneDeviceClaims();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once, on mount. `apply` changes identity on every render of the page and is not a reason to
    // re-fetch; re-running this would re-load the claim over the PM's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  /*
    Keep the status true when somebody else sends this claim — the header on reconnect, another tab —
    and when the signal is back, bring the claim on screen into step: send it if it has changes, or
    pick up the server's newer copy if it has none (the office may have worked on it meanwhile).
  */
  useEffect(() => {
    if (!enabled) return;
    const offChange = onDeviceChange(() => {
      const id = claimIdRef.current;
      if (id && !writing.current) void settle(id);
    });
    const offReconnect = onReconnect(() => {
      const id = claimIdRef.current;
      if (!id) return;
      void (async () => {
        const record = await readDeviceClaim(id);
        if (record && !record.dirty && record.created && JSON.stringify(stateRef.current) === lastWritten.current) {
          try {
            const res = await netFetch(`/api/claims/${id}`, { timeoutMs: 20_000 });
            if (res.ok && claimIdRef.current === id) {
              const { state: fresh, version } = (await res.json()) as { state: SavedClaimState; version?: string };
              // Only if nothing was changed here while it was on the wire — then this is simply newer.
              if (version && version !== record.version && JSON.stringify(stateRef.current) === lastWritten.current) {
                putOnScreen(id, fresh);
                await changeDeviceClaim(id, (r) => (r && !r.dirty ? { ...r, state: fresh, version, touchedAt: Date.now() } : undefined));
              }
            }
          } catch {
            return; // The signal went again; the next reconnect tries again.
          }
          setOpenedFromDevice(null);
          return settle(id);
        }
        const outcome = await syncClaim(id);
        if (outcome.kind !== "offline") setOpenedFromDevice(null);
        await settle(id, outcome);
      })();
    });
    return () => {
      offChange();
      offReconnect();
    };
  }, [enabled, settle, putOnScreen]);

  // Save, after the edits stop.
  useEffect(() => {
    if (!enabled || loading) return;
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
    setOnServer(false);
    lastWritten.current = "";
    setStatus("idle");
    setRefusedReason(null);
    setLoadError(null);
    setOpenedFromDevice(null);
    setClash(null);
    putIdInUrl(null);
  }, []);

  const resolveClash = useCallback(
    async (keep: "mine" | "theirs" | "both") => {
      const id = claimIdRef.current;
      if (!id) return;
      const record = await readDeviceClaim(id);
      const theirs = record?.clash;
      if (!record || !theirs) return;

      if (keep === "mine") {
        // Sent again from the server's version, so it lands — over theirs, as asked. A claim deleted
        // there is created again under the same id. Their photos come too (lib/claimSync.ts).
        await changeDeviceClaim(id, (r) =>
          r
            ? { ...r, state: withPhotosMerged(r.state, theirs.state), clash: null, version: theirs.version, created: theirs.state !== null, sent: [], dirty: true, refused: null }
            : undefined,
        );
        // And whatever the page took in the last moments before the choice, not yet written.
        const merged = await changeDeviceClaim(id, (r) => (r ? { ...r, state: { ...r.state, photos: mergeClaimPhotos(r.state.photos, stateRef.current.photos) } } : undefined));
        if (merged) applyPhotosRef.current?.(merged.state.photos);
        setClash(null);
        setStatus("saving");
        await settle(id, await syncClaim(id));
        return;
      }

      if (keep === "theirs") {
        if (theirs.state === null) {
          // Deleted there, and the PM agrees: gone from here too, its waiting pictures with it.
          await forgetDeviceClaim(id);
          await forgetClaimPhotoFiles(id);
          window.location.assign("/claims");
          return;
        }
        /*
          Theirs, with this phone's photos merged in: a photo taken here is not part of the choice. When
          that adds nothing, the claim is exactly the server's and nothing needs sending.
        */
        // Theirs, with this phone's photos — the device's copy and anything the page took since it.
        const kept = withPhotosMerged(withPhotosMerged(theirs.state, record.state), stateRef.current);
        const same = stableStringify(kept.photos) === stableStringify(theirs.state.photos);
        putOnScreen(id, kept);
        await changeDeviceClaim(id, (r) =>
          r ? { ...r, state: kept, version: theirs.version, created: true, dirty: !same, clash: null, sent: [], refused: null } : undefined,
        );
        setClash(null);
        if (same) {
          setStatus("saved");
          return;
        }
        setStatus("saving");
        await settle(id, await syncClaim(id));
        return;
      }

      /*
        Both: the server's stays as it is, and this device's becomes a claim of its own, named so the
        two can be told apart on the list. The page carries on with this device's.

        The photos stay with the claim they were taken on: every picture is stored under that claim's
        id, and a copy pointing at another claim's pictures would lose them when either is deleted. So
        the original keeps both phones' photos, and the copy starts with none.
      */
      const copyId = newClaimId();
      const mine = { ...copyOf(record.state), photos: { ...record.state.photos, items: [], deleted: [] } };
      await changeDeviceClaim(copyId, () => ({ ...blankDeviceClaim(copyId, mine, record.user), dirty: true }));
      if (theirs.state) {
        const kept = withPhotosMerged(theirs.state, record.state);
        const same = stableStringify(kept.photos) === stableStringify(theirs.state.photos);
        await changeDeviceClaim(id, (r) =>
          r ? { ...r, state: kept, version: theirs.version, created: true, dirty: !same, clash: null, sent: [], refused: null } : undefined,
        );
        if (!same) void syncClaim(id);
      } else {
        await forgetDeviceClaim(id);
      }
      putOnScreen(copyId, mine);
      putIdInUrl(copyId);
      setClash(null);
      setOnServer(false);
      setStatus("saving");
      await settle(copyId, await syncClaim(copyId));
    },
    [putOnScreen, settle],
  );

  return { claimId, onServer, status, refusedReason, loading, loadError, openedFromDevice, clash, resolveClash, claimIdNow, forget, saveNow: write };
}

async function describe(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}
