/**
 * Just enough of a ServiceWorkerGlobalScope to run `public/sw.js` under Node.
 *
 * The worker is the piece of this app with the least visible failure mode. It sits in front of every
 * request, its mistakes look like "the app is being weird", and the classic ones — a stale page that
 * survives a refresh, a login form cached under a claim URL, an asset evicted out from under the
 * document that needs it — do not throw anything. Running the real file against a fake cache is the
 * only way to assert on them without a browser and a way to unplug it.
 *
 * Faithful on the details the worker actually depends on:
 *
 *   * `cache.keys()` returns entries in INSERTION order, which is what makes trimming from the front
 *     evict the oldest. A Map preserves that.
 *   * matching is by URL, and a `Request` for "/claim" and one for "/claim" are the same key even
 *     though they are different objects.
 *   * `response.clone()` can be read after the original has been returned.
 *   * a network failure REJECTS; a 404 resolves with a response. The worker distinguishes them, and
 *     a fake that conflated the two would pass a broken worker.
 */

class FakeResponse {
  constructor(body = "", { status = 200, type = "basic", redirected = false, url = "" } = {}) {
    this.body = body;
    this.status = status;
    this.type = type;
    this.redirected = redirected;
    this.url = url;
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  clone() {
    return new FakeResponse(this.body, {
      status: this.status,
      type: this.type,
      redirected: this.redirected,
      url: this.url,
    });
  }
}

class FakeRequest {
  constructor(input, { method = "GET", mode = "no-cors" } = {}) {
    this.url = typeof input === "string" ? new URL(input, "https://scrivn.ca").href : input.url;
    this.method = method;
    this.mode = mode;
  }
}

class FakeCache {
  constructor() {
    this.entries = new Map();
  }

  async put(request, response) {
    const key = typeof request === "string" ? new FakeRequest(request).url : request.url;
    // A re-put must not change insertion order — the entry is refreshed, not made newest, which is
    // what the real Cache API does.
    this.entries.set(key, response);
  }

  async match(request) {
    const key = typeof request === "string" ? new FakeRequest(request).url : request.url;
    return this.entries.get(key);
  }

  async add(request) {
    const response = await globalThis.fetch(request);
    if (!response.ok) throw new Error(`add() failed: ${response.status}`);
    await this.put(request, response);
  }

  async delete(request) {
    const key = typeof request === "string" ? new FakeRequest(request).url : request.url;
    return this.entries.delete(key);
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new FakeRequest(url));
  }
}

class FakeCacheStorage {
  constructor() {
    this.caches = new Map();
  }

  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async delete(name) {
    return this.caches.delete(name);
  }

  async match(request) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

/**
 * Installs the fake scope and returns the handles a test needs: the worker's registered listeners,
 * the cache store to inspect, and the network to script.
 */
export async function loadWorker(source) {
  const listeners = new Map();
  const cacheStorage = new FakeCacheStorage();
  const network = {
    /** Set to a function of (url, request) returning a FakeResponse, or throwing for "no network". */
    handler: () => new FakeResponse("ok"),
    calls: [],
  };

  const scope = {
    location: { origin: "https://scrivn.ca" },
    addEventListener: (type, fn) => listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };

  /*
    Timers the test fires by hand. The worker's navigation timeout is a real setTimeout; letting it
    run would make the hanging-network tests wait eight seconds each, and stubbing it lets a test say
    "the network has now been silent for long enough" as a single call.
  */
  const pendingTimers = [];
  const timers = {
    fire: () => {
      const due = pendingTimers.splice(0);
      for (const t of due) t.fn();
      return due.length;
    },
    pending: () => pendingTimers.length,
  };
  globalThis.setTimeout = (fn, ms) => {
    pendingTimers.push({ fn, ms });
    return pendingTimers.length;
  };
  globalThis.clearTimeout = () => {};

  globalThis.self = scope;
  globalThis.caches = cacheStorage;
  globalThis.Request = FakeRequest;
  globalThis.Response = { error: () => new FakeResponse("", { status: 0, type: "error" }) };
  globalThis.fetch = async (request) => {
    const url = typeof request === "string" ? new URL(request, "https://scrivn.ca").href : request.url;
    network.calls.push(url);
    return network.handler(url, request);
  };

  // eslint-disable-next-line no-new-func
  new Function(source)();

  /** Runs the fetch listener and returns what it responded with, or null if it passed the request through. */
  async function fetchEvent(request) {
    let responded = null;
    const waits = [];
    const event = {
      request,
      respondWith: (promise) => {
        responded = promise;
      },
      waitUntil: (promise) => waits.push(promise),
    };
    listeners.get("fetch")(event);
    await Promise.all(waits);
    return responded === null ? null : await responded;
  }

  async function lifecycle(type) {
    const waits = [];
    listeners.get(type)({ waitUntil: (promise) => waits.push(promise) });
    await Promise.all(waits);
  }

  return { listeners, cacheStorage, network, fetchEvent, lifecycle, timers, FakeRequest, FakeResponse };
}

export { FakeRequest, FakeResponse };
