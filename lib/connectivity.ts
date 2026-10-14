"use client";

/**
 * Whether Scrivn can reach its server right now — as far as this page can tell (2026-10-13).
 *
 * ── Why not just `navigator.onLine` ──────────────────────────────────────────────────────────────
 *
 * `onLine` says the phone has a network interface, not that anything gets through it. In a basement
 * with one bar, or on a site's Wi-Fi with no internet behind it, it says true while every request
 * hangs and fails. So the answer here comes mostly from what actually happened: a request that got
 * an answer — any answer, a 500 included — means the server is reachable; one that failed without
 * one means it is not. `onLine` going false is still believed at once, because when the phone says
 * it has no network it is right.
 *
 * While offline, it asks again on its own (`probe`), so work waiting on the signal goes the moment
 * it is back rather than on the next thing somebody happens to press.
 */

export type Connection = "online" | "offline";

let state: Connection = typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online";
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();

function set(next: Connection) {
  if (next === state) return;
  const was = state;
  state = next;
  listeners.forEach((l) => l());
  if (was === "offline" && next === "online") reconnectListeners.forEach((l) => l());
  schedule();
}

export function connection(): Connection {
  return state;
}

/** For `useSyncExternalStore`. */
export function onConnectionChange(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called when the server is reachable again after it was not — the moment to send what waited. */
export function onReconnect(listener: () => void): () => void {
  start();
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

/** A fetch that got no answer: no network, refused, timed out. */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "NetworkError");
}

/**
 * `fetch`, reporting what happened to the connection, with a time limit.
 *
 * The limit matters as much as the reporting: on one bar a request can sit for minutes, holding up
 * every save queued behind it. Give up, call it offline, and let the probe find the signal again.
 */
export async function netFetch(input: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 45_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(input, { ...rest, signal: controller.signal });
    set("online");
    return response;
  } catch (err) {
    if (isNetworkFailure(err)) set("offline");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Finding the signal again ───────────────────────────────────────────────────────────────────── */

/** How often to look while offline and the page is in front. A request a quarter-minute is nothing. */
const PROBE_EVERY_MS = 15_000;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/**
 * One small request. The manifest, because it is tiny, public and never cached here (`no-store`, and
 * the service worker does not touch it) — so an answer means the network carried it.
 */
export async function probe(): Promise<boolean> {
  try {
    await netFetch(`/manifest.webmanifest?probe=${Date.now()}`, { cache: "no-store", timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function schedule() {
  if (typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  timer = null;
  if (state !== "offline" || document.visibilityState !== "visible") return;
  timer = setTimeout(() => {
    timer = null;
    void probe().finally(schedule);
  }, PROBE_EVERY_MS);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("offline", () => set("offline"));
  // The interface is back; whether the internet is behind it is for the probe to say.
  window.addEventListener("online", () => void probe());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state === "offline") void probe();
    schedule();
  });
  schedule();
}
