/**
 * Just enough IndexedDB for the device store (lib/deviceClaims.ts, lib/aiJobs.ts) — and the
 * service worker's sign-out sweep — to run under Node.
 *
 * Node has no IndexedDB, and the alternative to a fake is not testing the store at all — which for
 * the one mechanism whose entire job is not losing a PM's work is not a trade worth making.
 *
 * Deliberately faithful on the behaviours the code depends on, because a fake that got any of them
 * wrong would pass tests the real browser fails:
 *
 *   * Handlers are attached AFTER the call returns (`store.put(x)` on one line, `onsuccess` on the
 *     next), so every callback fires on a later turn of the loop, never synchronously.
 *   * A transaction completes only once every request in it has finished — including requests made
 *     from inside another request's `onsuccess` (a read-then-write) — and `oncomplete` fires after
 *     the last of their callbacks.
 *   * Opening at a higher version runs `onupgradeneeded` with the old version and a versionchange
 *     transaction that can read the stores that already exist, then `onsuccess` once it is done.
 *     Aborting that transaction on a database that did not exist leaves no database behind.
 *   * Values are copied in and out (structuredClone), so a caller mutating what it got back cannot
 *     reach what is stored.
 *
 * It is NOT a general IndexedDB: no indexes, no cursors, no key ranges, one connection's worth of
 * locking. It supports exactly what those modules call.
 */

/*
  The real timer, taken when this module loads. The service-worker suite swaps `setTimeout` for one
  it fires by hand (test/sw/fakeServiceWorker.mjs); the database must keep running on its own there.
*/
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const setTimeout = (fn, ms) => realSetTimeout(fn, ms);

class FakeRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
    this.onblocked = null;
    this.result = undefined;
    this.error = null;
    this.transaction = null;
  }
}

class FakeTransaction {
  constructor(db, names, mode) {
    this.db = db;
    this.names = names;
    this.mode = mode;
    this.pending = 0;
    this.finished = false;
    this.aborted = false;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.error = null;
    // A transaction nobody issues a request in still completes.
    setTimeout(() => this.settle(), 0);
  }

  objectStore(name) {
    if (!this.names.includes(name) || !this.db.data.stores.has(name)) throw new Error(`NotFoundError: no store ${name} in this transaction`);
    return new FakeStore(this, name);
  }

  /** Queue one operation; it runs, and its callback fires, on a later turn. */
  request(run) {
    if (this.finished) throw new Error("TransactionInactiveError");
    this.pending += 1;
    const request = new FakeRequest();
    setTimeout(() => {
      if (this.aborted) return;
      try {
        request.result = run();
        request.onsuccess?.({ target: request });
      } catch (err) {
        request.error = err;
        request.onerror?.({ target: request });
      }
      this.pending -= 1;
      this.settle();
    }, 0);
    return request;
  }

  settle() {
    if (this.pending > 0 || this.finished || this.aborted) return;
    this.finished = true;
    setTimeout(() => this.oncomplete?.(), 0);
  }

  abort() {
    if (this.finished) return;
    this.aborted = true;
    this.finished = true;
    this.error = new Error("AbortError");
    setTimeout(() => this.onabort?.(), 0);
  }
}

class FakeStore {
  constructor(tx, name) {
    this.tx = tx;
    this.name = name;
  }

  get records() {
    return this.tx.db.data.stores.get(this.name).records;
  }

  get keyPath() {
    return this.tx.db.data.stores.get(this.name).keyPath;
  }

  put(value) {
    if (this.tx.mode === "readonly") throw new Error("ReadOnlyError");
    const copy = structuredClone(value);
    return this.tx.request(() => {
      // A put on an existing key REPLACES it: one record per claim, not a log of every save.
      this.records.set(copy[this.keyPath], copy);
      return copy[this.keyPath];
    });
  }

  get(key) {
    return this.tx.request(() => {
      const found = this.records.get(key);
      return found === undefined ? undefined : structuredClone(found);
    });
  }

  getAll() {
    return this.tx.request(() => [...this.records.values()].map((r) => structuredClone(r)));
  }

  delete(key) {
    if (this.tx.mode === "readonly") throw new Error("ReadOnlyError");
    return this.tx.request(() => {
      this.records.delete(key);
      return undefined;
    });
  }
}

class FakeConnection {
  constructor(data) {
    this.data = data;
    this.closed = false;
    this.objectStoreNames = { contains: (name) => data.stores.has(name) };
  }

  createObjectStore(name, { keyPath }) {
    this.data.stores.set(name, { keyPath, records: new Map() });
  }

  deleteObjectStore(name) {
    this.data.stores.delete(name);
  }

  transaction(names, mode = "readonly") {
    if (this.closed) throw new Error("InvalidStateError: the database is closed");
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) if (!this.data.stores.has(name)) throw new Error(`NotFoundError: no store ${name}`);
    return new FakeTransaction(this, list, mode);
  }

  close() {
    this.closed = true;
  }
}

/**
 * Install the fake on `globalThis` (or on `scope`, for a worker's global), and hand back a handle
 * for looking at what is actually stored rather than only at what the module says is stored.
 */
export function installFakeIndexedDB(scope = globalThis) {
  /** name -> { version, stores: Map<name, { keyPath, records: Map }> } */
  const databases = new Map();

  scope.indexedDB = {
    open(name, version) {
      const request = new FakeRequest();
      setTimeout(() => {
        const existed = databases.has(name);
        const data = databases.get(name) ?? { version: 0, stores: new Map() };
        const target = version ?? (data.version || 1);
        if (target < data.version) {
          request.error = new Error("VersionError");
          request.onerror?.({ target: request });
          return;
        }
        const connection = new FakeConnection(data);
        request.result = connection;
        if (target === data.version) {
          request.onsuccess?.({ target: request });
          return;
        }
        // An upgrade: every store that exists now is reachable from the versionchange transaction.
        const oldVersion = data.version;
        if (!existed) databases.set(name, data);
        const upgrade = new FakeTransaction(connection, [...data.stores.keys()], "versionchange");
        // Stores created during the upgrade are reachable from it too.
        upgrade.objectStore = (storeName) => {
          if (!data.stores.has(storeName)) throw new Error(`NotFoundError: no store ${storeName}`);
          return new FakeStore(upgrade, storeName);
        };
        request.transaction = upgrade;
        upgrade.oncomplete = () => {
          data.version = target;
          request.onsuccess?.({ target: request });
        };
        upgrade.onabort = () => {
          if (!existed) databases.delete(name);
          request.error = new Error("AbortError");
          request.onerror?.({ target: request });
        };
        try {
          request.onupgradeneeded?.({ target: request, oldVersion, newVersion: target });
        } catch (err) {
          upgrade.abort();
          throw err;
        }
      }, 0);
      return request;
    },
  };
  scope.structuredClone ??= (v) => JSON.parse(JSON.stringify(v));

  return {
    /** Everything currently in one store, as plain records. */
    records(store, db = "scrivn") {
      return [...(databases.get(db)?.stores.get(store)?.records.values() ?? [])].map((r) => structuredClone(r));
    },
    /** Store names and version, for checking an upgrade. */
    shape(db = "scrivn") {
      const data = databases.get(db);
      return data ? { version: data.version, stores: [...data.stores.keys()].sort() } : null;
    },
    exists(db = "scrivn") {
      return databases.has(db);
    },
    /** Put a database in place as an older version of the app would have left it. */
    seed(db, version, stores) {
      const data = { version, stores: new Map() };
      for (const [name, { keyPath, records }] of Object.entries(stores)) {
        data.stores.set(name, { keyPath, records: new Map(records.map((r) => [r[keyPath], structuredClone(r)])) });
      }
      databases.set(db, data);
    },
    /** Write straight into a store, as another tab would. */
    put(store, record, db = "scrivn") {
      const data = databases.get(db).stores.get(store);
      data.records.set(record[data.keyPath], structuredClone(record));
    },
    reset() {
      databases.clear();
    },
  };
}
