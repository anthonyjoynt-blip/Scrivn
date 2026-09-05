"use client";

import type { SavedClaimState } from "./claimState";

/**
 * Saves the server has not accepted yet, kept on the device until it does.
 *
 * ── What this is for ─────────────────────────────────────────────────────────────────────────────
 *
 * Autosave already retries: any later edit triggers another write. The gap is that a PM who STOPS
 * editing never triggers one — and stopping is exactly what somebody does before closing the tab or
 * putting the phone in a pocket. So a save that failed on the last edit before a break was simply
 * lost, silently, with the screen still showing the work.
 *
 * This closes that. A failed write is written to the device instead, and pushed later: when the
 * network returns, when the app is next opened, or on a slow retry in the meantime. It helps with
 * ordinary flaky signal as much as with being properly offline, which is the commoner case in a
 * basement with one bar.
 *
 * ── What it deliberately is NOT ──────────────────────────────────────────────────────────────────
 *
 * Not an edit log. One record per claim, holding its LATEST state — the same last-write-wins rule
 * the server already uses, applied locally. Replaying a sequence of edits would mean reconstructing
 * intermediate states nobody asked to keep.
 *
 * Not conflict resolution. If a colleague changed the same claim while this device was offline, the
 * queued state still overwrites theirs on the way back, exactly as an online save would. Detecting
 * that needs a version on the row and a question for the PM, which is a separate piece of work — see
 * the note in `useClaimPersistence`.
 *
 * ── Why IndexedDB and not localStorage ───────────────────────────────────────────────────────────
 *
 * A claim carrying a sketch and a painted moisture map runs to hundreds of kilobytes; localStorage
 * caps at around five megabytes across the whole origin and writes synchronously on the main thread.
 * A PM with a few claims queued could hit that ceiling, and the failure mode is the write throwing —
 * which is to say, the data loss this exists to prevent, in the situation it was built for.
 */

const DB_NAME = "scrivn";
const DB_VERSION = 1;
const STORE = "pendingSaves";

export interface PendingSave {
  /**
   * The claim's server id, or a locally-generated draft id when it has never reached the server.
   *
   * A claim whose very FIRST save fails has no server id yet — there is nothing to key it by — and
   * that is precisely the case worth protecting, since everything typed so far exists only here.
   */
  key: string;
  /** Null means this has never been created server-side, so draining it POSTs rather than PUTs. */
  claimId: string | null;
  state: SavedClaimState;
  queuedAt: number;
}

/** False in a server render, and in a browser that has no IndexedDB (or has it disabled). */
export function pendingStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    /*
      Another tab holding an older version of the database open blocks the upgrade. Rejecting rather
      than hanging matters: every caller treats a storage failure as "carry on without the queue",
      and a promise that never settles would instead wedge the save path entirely.
    */
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    void open().then((db) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    }, reject);
  });
}

/**
 * Every function below swallows its own failure and reports it as "no queue".
 *
 * Storage can be unavailable for reasons that have nothing to do with this app — a private window,
 * a browser with site data blocked, a quota already full. In all of them the right behaviour is the
 * behaviour before this file existed: try to save over the network, and if that fails, say so. An
 * exception thrown out of here would take the ordinary save path down with it, which would make
 * things worse in exactly the conditions it was written for.
 */
export async function queuePendingSave(record: PendingSave): Promise<boolean> {
  if (!pendingStorageAvailable()) return false;
  try {
    await tx("readwrite", (store) => store.put(record) as unknown as IDBRequest<IDBValidKey>);
    return true;
  } catch (err) {
    console.warn("[pending] could not queue a save locally:", err);
    return false;
  }
}

export async function pendingSaves(): Promise<PendingSave[]> {
  if (!pendingStorageAvailable()) return [];
  try {
    const all = await tx<PendingSave[]>("readonly", (store) => store.getAll() as IDBRequest<PendingSave[]>);
    // Oldest first, so a claim that has been waiting longest is pushed first when signal returns.
    return (all ?? []).sort((a, b) => a.queuedAt - b.queuedAt);
  } catch (err) {
    console.warn("[pending] could not read queued saves:", err);
    return [];
  }
}

export async function dropPendingSave(key: string): Promise<void> {
  if (!pendingStorageAvailable()) return;
  try {
    await tx("readwrite", (store) => store.delete(key) as unknown as IDBRequest<undefined>);
  } catch (err) {
    console.warn("[pending] could not clear a queued save:", err);
  }
}

/**
 * A claim created on this device that the server has not seen.
 *
 * Random rather than sequential so two devices queuing a first save cannot collide on the key. It
 * never reaches the server — the server issues the real id when the draft is finally accepted — so
 * it only has to be unique within this browser.
 */
export function newDraftKey(): string {
  return `draft-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/* ───────────────────────────────────────────────────────────────────────────────────────────────
   Pushing the queue.

   Here rather than in `useClaimPersistence` because the claim page is not the only place it needs
   to happen. A claim held on the device does not appear on the Claims list at all — the list shows
   server rows — so somebody looking for yesterday's job finds nothing, which is the exact moment
   they conclude the work is gone. That page therefore pushes too, and both need the same rules.
   ─────────────────────────────────────────────────────────────────────────────────────────────── */

export interface DrainOptions {
  /**
   * Consulted before each record.
   *
   * `"wait"` leaves it for a later pass; `"drop"` deletes it unsent. The claim page uses both for
   * the draft it is currently editing — see the call there for why each is needed.
   */
  decide?: (record: PendingSave) => "send" | "wait" | "drop";
  /** A queued draft has just been created server-side under `id`. */
  onCreated?: (record: PendingSave, id: string) => void;
}

/**
 * What to do with a record while a claim page is open and editing.
 *
 * Pure, and separate from the drain, because it is the part that is easy to get wrong and expensive
 * when it is: both this and the page's own save can create a claim, and getting the order wrong puts
 * one job on the list twice with half the work in each copy.
 *
 * Only the record belonging to the page's own unsaved draft is special. Anything else — another
 * claim, or one from a previous session — is simply owed to the server.
 */
export function draftVerdict({
  recordKey,
  draftKey,
  claimId,
  saving,
}: {
  recordKey: string;
  /** The key this page files its own not-yet-created claim under. */
  draftKey: string;
  /** The page's claim id, or null if the server has never accepted it. */
  claimId: string | null;
  /** True while the page has a save of its own in flight. */
  saving: boolean;
}): "send" | "wait" | "drop" {
  if (recordKey !== draftKey) return "send";
  // The page's save already got through and the server issued an id, so this record's work is
  // there under that id. Sending it would create a second claim by a slower route.
  if (claimId !== null) return "drop";
  // A save in flight is a POST of this same work. Wait; the next pass will find it settled.
  return saving ? "wait" : "send";
}

export interface DrainResult {
  /** Accepted by the server on this pass. */
  pushed: number;
  /** Still on the device afterwards — non-zero means no signal, or nothing to send. */
  remaining: number;
}

let running: Promise<DrainResult> | null = null;

/**
 * Push everything the device is holding, oldest first.
 *
 * One record is one claim's latest state, so this is a plain write rather than a replay of edits.
 * A record whose `claimId` is null has never reached the server and is POSTed; the rest are PUT.
 *
 * A record the server REJECTS on its merits — a claim someone deleted, a payload it will never
 * accept — is dropped rather than retried for ever. Keeping it would mean a warning that can never
 * be cleared and a request repeated on every app open, neither of which brings the work back. A 401
 * or a 5xx is different and is kept: a session can be refreshed and a server can recover.
 */
export function drainPendingSaves(options: DrainOptions = {}): Promise<DrainResult> {
  /*
    Coalesce rather than refuse, and hand the same promise to everyone.

    Reconnecting can fire `online` and land on an interval tick at the same moment. More importantly
    a caller that AWAITS this needs the real answer: "a drain is already happening, carry on" would
    let the claim page read the server before the queue had cleared, which is the stale read this
    exists to prevent.
  */
  if (running) return running;
  running = runDrain(options).finally(() => {
    running = null;
  });
  return running;
}

/** The push currently in progress, for a caller that must not act until it has finished. */
export function drainInProgress(): Promise<DrainResult> | null {
  return running;
}

async function runDrain({ decide, onCreated }: DrainOptions): Promise<DrainResult> {
  let pushed = 0;
  const queue = await pendingSaves();

  for (const record of queue) {
    const verdict = decide?.(record) ?? "send";
    if (verdict === "wait") continue;
    if (verdict === "drop") {
      await dropPendingSave(record.key);
      continue;
    }

    try {
      const res = record.claimId
        ? await fetch(`/api/claims/${record.claimId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: record.state }),
          })
        : await fetch("/api/claims", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: record.state }),
          });

      if (res.ok) {
        if (!record.claimId && onCreated) {
          const { id } = await res.json();
          if (typeof id === "string") onCreated(record, id);
        }
        await dropPendingSave(record.key);
        pushed += 1;
        continue;
      }
      if (res.status !== 401 && res.status >= 400 && res.status < 500) {
        console.warn(`[pending] dropping a queued save the server refused (${res.status})`);
        await dropPendingSave(record.key);
      }
    } catch {
      // Still no network. Leave it and stop — the rest would fail the same way.
      break;
    }
  }

  return { pushed, remaining: (await pendingSaves()).length };
}
