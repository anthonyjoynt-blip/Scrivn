/**
 * Just enough IndexedDB for `lib/pendingSaves.ts` to run under Node.
 *
 * Node has no IndexedDB, and the alternative to a fake is not testing the queue at all — which for
 * the one mechanism whose entire job is not losing a PM's work is not a trade worth making.
 *
 * Deliberately faithful on the two behaviours the module depends on, because a fake that got either
 * wrong would pass tests the real browser fails:
 *
 *   * Handlers are attached AFTER the call returns (`store.put(x)` on one line, `onsuccess` on the
 *     next), so every callback fires on a later turn of the loop, never synchronously.
 *   * A request's `onsuccess` runs before its transaction's `oncomplete` — `tx()` closes the
 *     database in `oncomplete` and resolves in `onsuccess`, so the wrong order would resolve
 *     against a closed handle.
 *
 * It is NOT a general IndexedDB implementation: no indexes, no cursors, no versioning beyond the
 * single upgrade, no real key ranges. It supports exactly what the module calls.
 */

class FakeRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
    this.result = undefined;
    this.error = null;
  }

  succeed(result) {
    this.result = result;
    setTimeout(() => this.onsuccess?.(), 0);
  }

  fail(error) {
    this.error = error;
    setTimeout(() => this.onerror?.(), 0);
  }
}

class FakeStore {
  constructor(records, keyPath) {
    this.records = records;
    this.keyPath = keyPath;
  }

  put(value) {
    const request = new FakeRequest();
    const key = value[this.keyPath];
    // A put on an existing key REPLACES it. This is what makes the queue one-record-per-claim
    // rather than an ever-growing log of every failed keystroke.
    this.records.set(key, structuredClone(value));
    request.succeed(key);
    return request;
  }

  getAll() {
    const request = new FakeRequest();
    request.succeed([...this.records.values()].map((r) => structuredClone(r)));
    return request;
  }

  delete(key) {
    const request = new FakeRequest();
    this.records.delete(key);
    request.succeed(undefined);
    return request;
  }
}

class FakeDatabase {
  constructor(state) {
    this.state = state;
    this.closed = false;
    this.objectStoreNames = { contains: (name) => state.stores.has(name) };
  }

  createObjectStore(name, { keyPath }) {
    state_set(this.state, name, keyPath);
    return new FakeStore(this.state.stores.get(name), keyPath);
  }

  transaction(name) {
    if (this.closed) throw new Error("database is closed");
    const records = this.state.stores.get(name);
    if (!records) throw new Error(`no such store: ${name}`);
    const tx = { oncomplete: null, onerror: null, objectStore: () => new FakeStore(records, this.state.keyPaths.get(name)) };
    // After the request callbacks queued above it — same relative order as the real thing.
    setTimeout(() => tx.oncomplete?.(), 0);
    return tx;
  }

  close() {
    this.closed = true;
  }
}

function state_set(state, name, keyPath) {
  state.stores.set(name, new Map());
  state.keyPaths.set(name, keyPath);
}

/**
 * Install the fake on `globalThis`, and hand back the raw contents so a test can look at what is
 * actually stored rather than only at what the module says is stored.
 */
export function installFakeIndexedDB() {
  const state = { stores: new Map(), keyPaths: new Map(), upgraded: false };

  globalThis.indexedDB = {
    open() {
      const request = new FakeRequest();
      const db = new FakeDatabase(state);
      request.result = db;
      setTimeout(() => {
        if (!state.upgraded) {
          state.upgraded = true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
  globalThis.structuredClone ??= (v) => JSON.parse(JSON.stringify(v));

  return {
    /** Everything currently stored, as plain records. */
    records(store = "pendingSaves") {
      return [...(state.stores.get(store)?.values() ?? [])];
    },
    reset() {
      for (const records of state.stores.values()) records.clear();
    },
  };
}
