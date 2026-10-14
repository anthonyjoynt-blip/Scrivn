"use client";

import type { SavedClaimState } from "./claimState";

/**
 * Claims kept on this device, so they open, change and wait to sync with no signal (2026-10-13).
 *
 * ── What is kept ─────────────────────────────────────────────────────────────────────────────────
 *
 * One record per claim, holding its LATEST state on this device and the server version that state
 * was last in step with. A record is either:
 *
 *   * clean — a copy of what the server has, kept so the claim opens in a basement. Claims opened
 *     here recently and the top of the Claims list are kept like this; old ones are pruned.
 *   * dirty — changed here and not yet accepted by the server. Never pruned, never dropped: this is
 *     work that exists nowhere else.
 *
 * It replaced `pendingSaves`, a queue that only held a claim whose save had FAILED. That covered a
 * flaky save but not offline work: a claim opened before the signal went had no copy to reopen from,
 * and one started offline had no id to be reopened by. Its records are carried over the first time
 * this opens (see `open`).
 *
 * ── Not an edit log ──────────────────────────────────────────────────────────────────────────────
 *
 * The latest state only, as before. What makes that safe now is the version: a save names the
 * version it was made from, and the server refuses it if the claim has moved on — see
 * lib/claimSync.ts and `saveClaim` in lib/claimsRepo.ts.
 *
 * ── Why IndexedDB and not localStorage ───────────────────────────────────────────────────────────
 *
 * A claim carrying a sketch and a painted moisture map runs to hundreds of kilobytes; localStorage
 * caps at around five megabytes across the whole origin and writes synchronously on the main thread.
 *
 * ── When storage is not there at all ─────────────────────────────────────────────────────────────
 *
 * A private window, site data blocked, quota full. The records are then kept in memory instead, so
 * saving still works exactly as it did before any of this — straight to the server — and the page is
 * told the device is not holding anything (`deviceStorageWorks`), so it never says "saved on this
 * phone" about work that would not survive a reload.
 */

const DB_NAME = "scrivn";
/** 3 since 2026-10-14: site photos waiting to upload (lib/devicePhotos.ts). */
const DB_VERSION = 3;
export const CLAIMS = "claims";
export const AI_JOBS = "aiJobs";
export const PHOTO_FILES = "photoFiles";
/** The store `pendingSaves.ts` used, read once and removed by the upgrade to version 2. */
const LEGACY = "pendingSaves";

export interface DeviceClaim {
  /** A UUID. Chosen on the device for a claim started here, so it can be reopened before the server has it. */
  id: string;
  state: SavedClaimState;
  /** The server version this state was last in step with. Null when there is none to name. */
  version: string | null;
  /** The server has a row under this id. */
  created: boolean;
  /** Changed here and not yet accepted by the server. */
  dirty: boolean;
  /** When the state last changed on this device. */
  changedAt: number;
  /** When it was last opened, saved or fetched here — what pruning goes by. */
  touchedAt: number;
  /** Whose claim it is, so a shared device never shows or sends one person's work as another's. */
  user: string | null;
  /**
   * States sent under `version` whose answer never came back, by hash. If one of them landed, the
   * server is now ahead of `version` with OUR work, and a refusal on the next save is not a clash
   * with anybody — see `syncClaim`.
   */
  sent: string[];
  /** The server's copy, when it changed while this one was changed here. `state: null` = deleted there. */
  clash: { state: SavedClaimState | null; version: string | null; at: number } | null;
  /** Why the server refused this save on its merits, until the claim next changes. */
  refused: string | null;
}

/** A fresh claim id. */
export function newClaimId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ── Opening ────────────────────────────────────────────────────────────────────────────────────── */

let broken = false;

/** False in a server render, and once storage has failed in this tab — see the file's note. */
export function deviceStorageWorks(): boolean {
  return typeof indexedDB !== "undefined" && !broken;
}

export function openDeviceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const upgrade = request.transaction!;
      if (!db.objectStoreNames.contains(CLAIMS)) db.createObjectStore(CLAIMS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(AI_JOBS)) db.createObjectStore(AI_JOBS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(PHOTO_FILES)) db.createObjectStore(PHOTO_FILES, { keyPath: "id" });
      /*
        Carry the old queue over, then remove it. Every record in it was work the server had not
        accepted, so each comes across dirty. Their saves predate versions, so they carry none and are
        sent the way they always were: last write wins. A draft that never reached the server gets
        its id now.
      */
      if (db.objectStoreNames.contains(LEGACY)) {
        const legacy = upgrade.objectStore(LEGACY).getAll();
        legacy.onsuccess = () => {
          const claims = upgrade.objectStore(CLAIMS);
          for (const old of (legacy.result ?? []) as { key: string; claimId: string | null; state: SavedClaimState; queuedAt: number }[]) {
            claims.put({
              id: old.claimId ?? newClaimId(),
              state: old.state,
              version: null,
              created: old.claimId !== null,
              dirty: true,
              changedAt: old.queuedAt,
              touchedAt: old.queuedAt,
              user: null,
              sent: [],
              clash: null,
              refused: null,
            } satisfies DeviceClaim);
          }
          db.deleteObjectStore(LEGACY);
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    /*
      Another tab holding an older version open blocks the upgrade. Rejecting rather than hanging
      matters: a promise that never settles would wedge the save path entirely.
    */
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
}

/**
 * One transaction, resolved once it has COMMITTED — not when its last request succeeded, which is
 * earlier, and a page that went away in between would have lost the write it was told had happened.
 */
export function transact<T>(store: string, mode: IDBTransactionMode, body: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  return openDeviceDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let value: T;
        const tx = db.transaction(store, mode);
        tx.oncomplete = () => {
          db.close();
          resolve(value);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction aborted"));
        };
        body(tx.objectStore(store), (v) => {
          value = v;
        });
      }),
  );
}

/* ── Change notices ─────────────────────────────────────────────────────────────────────────────── */

/*
  Told about every change, here and in other tabs, so the header count and the Claims list move the
  moment a claim saves rather than on a timer. A BroadcastChannel does not deliver to its own sender,
  hence the local listeners as well.
*/
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
function ensureChannel() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel("scrivn-device");
  channel.onmessage = () => listeners.forEach((l) => l());
}

export function onDeviceChange(listener: () => void): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function deviceChanged(): void {
  ensureChannel();
  listeners.forEach((l) => l());
  channel?.postMessage("changed");
}

/* ── Records ────────────────────────────────────────────────────────────────────────────────────── */

/** Where records go when IndexedDB will not take them — see the file's note. */
const memory = new Map<string, DeviceClaim>();

function fallBack(err: unknown) {
  if (!broken) console.warn("[device] storage unavailable; keeping claims in memory for this page:", err);
  broken = true;
}

export async function readDeviceClaim(id: string): Promise<DeviceClaim | null> {
  if (deviceStorageWorks()) {
    try {
      return await transact<DeviceClaim | null>(CLAIMS, "readonly", (store, done) => {
        const get = store.get(id);
        get.onsuccess = () => done((get.result as DeviceClaim | undefined) ?? null);
      });
    } catch (err) {
      fallBack(err);
    }
  }
  return memory.get(id) ?? null;
}

export async function allDeviceClaims(): Promise<DeviceClaim[]> {
  if (deviceStorageWorks()) {
    try {
      return await transact<DeviceClaim[]>(CLAIMS, "readonly", (store, done) => {
        const all = store.getAll();
        all.onsuccess = () => done((all.result as DeviceClaim[]) ?? []);
      });
    } catch (err) {
      fallBack(err);
    }
  }
  return [...memory.values()];
}

/**
 * Read, change and write one record in a single transaction, so two writers cannot interleave and
 * lose each other's change. `change` gets the record (or null) and returns the new one, null to
 * delete it, or undefined to leave it as it is. Resolves with what is stored afterwards.
 */
export async function changeDeviceClaim(id: string, change: (current: DeviceClaim | null) => DeviceClaim | null | undefined): Promise<DeviceClaim | null> {
  let result: DeviceClaim | null = null;
  if (deviceStorageWorks()) {
    try {
      result = await transact<DeviceClaim | null>(CLAIMS, "readwrite", (store, done) => {
        const get = store.get(id);
        get.onsuccess = () => {
          const current = (get.result as DeviceClaim | undefined) ?? null;
          const next = change(current);
          if (next === undefined) return done(current);
          if (next === null) store.delete(id);
          else store.put(next);
          done(next);
        };
      });
      deviceChanged();
      return result;
    } catch (err) {
      fallBack(err);
    }
  }
  const next = change(memory.get(id) ?? null);
  if (next === undefined) return memory.get(id) ?? null;
  if (next === null) memory.delete(id);
  else memory.set(id, next);
  deviceChanged();
  return next;
}

export function forgetDeviceClaim(id: string): Promise<DeviceClaim | null> {
  return changeDeviceClaim(id, () => null);
}

/** A record for a claim this device has not held before. */
export function blankDeviceClaim(id: string, state: SavedClaimState, user: string | null): DeviceClaim {
  const now = Date.now();
  return { id, state, version: null, created: false, dirty: false, changedAt: now, touchedAt: now, user, sent: [], clash: null, refused: null };
}

/* ── Whose claims ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The signed-in person, as the page was rendered for them: `components/UserMenu.tsx` writes it into
 * the header, so it is there in a page the service worker served from its cache with no signal.
 *
 * Null in the dev fail-open, which has no accounts (the marker is there, empty). Undefined when
 * nobody is signed in (no marker).
 */
export function deviceUser(): string | null | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.querySelector("[data-scrivn-user]");
  if (!el) return undefined;
  return el.getAttribute("data-scrivn-user") || null;
}

/**
 * Whether a record is this person's to see and send. A record from before the owner was kept (null)
 * goes with whoever is signed in, which is what happened to it before.
 */
export function isMine(record: DeviceClaim, user: string | null | undefined): boolean {
  if (user === undefined) return false;
  return record.user === null || record.user === user;
}

/* ── Pruning ────────────────────────────────────────────────────────────────────────────────────── */

/** How many clean copies to keep. Each is a whole claim — a sketch, readings, documents. */
export const KEEP_CLEAN = 30;

/**
 * Drop the oldest clean copies beyond `KEEP_CLEAN`. Never a dirty record or one with a clash: those
 * are work the server does not have.
 */
export async function pruneDeviceClaims(keep = KEEP_CLEAN): Promise<void> {
  const clean = (await allDeviceClaims()).filter((r) => !r.dirty && !r.clash).sort((a, b) => b.touchedAt - a.touchedAt);
  for (const old of clean.slice(keep)) {
    await changeDeviceClaim(old.id, (current) => (current && !current.dirty && !current.clash ? null : undefined));
  }
}
