import { type DropDraft, parseDraft } from "./dropPages";

/**
 * The Drop a sketch or scope page's work in progress, kept in this browser (2026-11-12): in IndexedDB, because several
 * pages' photos are more than localStorage holds. Its own small database, apart from the claims' ("scrivn",
 * lib/deviceClaims.ts), so neither's version ever waits on the other's.
 *
 * Nothing here throws: storage refused (a locked-down private window) or full just means the work would not survive a
 * reload, and the page says nothing about it, as before.
 */

const DB_NAME = "scrivn-drop";
const STORE = "drafts";
const KEY = "draft";

/** Where the page kept its one sketch before it took scopes (2026-11-05). Read once, then moved here. */
export const V1_DRAFT_KEY = "scrivn.dropASketch.draft.v1";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result ?? null);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

function readV1(): unknown {
  try {
    const raw = localStorage.getItem(V1_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function dropV1() {
  try {
    localStorage.removeItem(V1_DRAFT_KEY);
  } catch {
    // Nothing to do.
  }
}

/** The kept draft, or one from before pages taken in as its one page; null when there is none. */
export async function loadDropDraft(): Promise<DropDraft | null> {
  const kept = parseDraft(await run("readonly", (s) => s.get(KEY)));
  if (kept) return kept;
  const old = parseDraft(readV1());
  if (old && (await saveDropDraft(old))) dropV1();
  return old;
}

/** Keep it, or clear it with null. False when this browser would not. */
export async function saveDropDraft(draft: DropDraft | null): Promise<boolean> {
  if (!draft) {
    dropV1();
    await run("readwrite", (s) => s.delete(KEY));
    return true;
  }
  return (await run("readwrite", (s) => s.put(draft, KEY))) !== null;
}
