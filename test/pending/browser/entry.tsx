/**
 * The claim page's save path, offline and back — in a real browser, against real IndexedDB.
 *
 * The Node suite next door covers the device store and the sync rules thoroughly, but it cannot
 * cover the wiring in `useClaimPersistence`, which is where the mistakes in this feature would be:
 * a save has to land on the device before anything else, the status has to say "on this phone"
 * rather than "Saved", a claim started offline has to be reopenable by its id, a reload with no
 * signal has to open the device's copy, and a clash has to be shown and resolved rather than written
 * over.
 *
 * None of that runs without React effects, a real event loop, and a store that survives between
 * them — including a remount, which is what a reload is to the hook. So it runs here, against a
 * scripted server that answers as the real routes do.
 */

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useClaimPersistence, type ClaimPersistence } from "@/lib/useClaimPersistence";
import { emptySavedClaimState, parseSavedClaimState, type SavedClaimState } from "@/lib/claimState";

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

// Whose claims these are, as the header says on a real page — see `deviceUser`.
document.body.insertAdjacentHTML("afterbegin", '<span hidden data-scrivn-user="user-a"></span>');

/* ── the scripted server ──────────────────────────────────────────────────────────────────────── */

let mode: "offline" | "online" = "offline";
const requests: { url: string; method: string; body: { id?: string; base?: string; state?: SavedClaimState } | null }[] = [];
const claims = new Map<string, { state: SavedClaimState; version: string }>();
let tick = 0;
const nextVersion = () => `2026-10-13T12:00:00.${String(++tick).padStart(6, "0")}+00:00`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const path = url.split("?")[0]!;
  if (!path.startsWith("/api/claims") && !path.startsWith("/manifest")) return realFetch(input as RequestInfo, init);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  requests.push({ url, method, body });
  if (mode === "offline") throw new TypeError("Failed to fetch");
  if (path.startsWith("/manifest")) return json(200, {});
  if (path === "/api/claims" && method === "POST") {
    const existing = claims.get(body.id);
    if (existing) return json(200, { id: body.id, version: existing.version, existed: true });
    const version = nextVersion();
    claims.set(body.id, { state: parseSavedClaimState(body.state), version });
    return json(200, { id: body.id, version, existed: false });
  }
  const id = path.slice("/api/claims/".length);
  const row = claims.get(id);
  if (method === "GET") return row ? json(200, { state: row.state, version: row.version }) : json(404, { error: "Claim not found." });
  if (method === "PUT") {
    if (!row) return json(404, { error: "Claim not found." });
    if (body.base && body.base !== row.version) return json(409, { error: "Changed.", conflict: { state: row.state, version: row.version } });
    row.state = parseSavedClaimState(body.state);
    row.version = nextVersion();
    return json(200, { ok: true, version: row.version });
  }
  return json(404, { error: "No such route." });
}) as typeof window.fetch;

/** Signal comes back the way it does on a phone: the interface event, then the app's own probe. */
async function goOnline() {
  mode = "online";
  window.dispatchEvent(new Event("online"));
}

/* ── the harness ──────────────────────────────────────────────────────────────────────────────── */

type Handle = ClaimPersistence & { state: SavedClaimState; setState: (s: SavedClaimState) => void };

let handle: Handle | null = null;

function Harness() {
  const [state, setState] = useState<SavedClaimState>(() => emptySavedClaimState());
  const persistence = useClaimPersistence({ state, apply: setState, enabled: true });

  // Kept in a ref so the driver below always reads the CURRENT render's values, not a stale closure.
  const latest = useRef<Handle | null>(null);
  latest.current = { ...persistence, state, setState };
  handle = latest.current;
  useEffect(() => {
    handle = latest.current;
  });

  return (
    <p>
      status: <b>{persistence.status}</b> · id: {persistence.claimId ?? "—"} · on server: {String(persistence.onServer)}
      {persistence.clash ? " · CLASH" : ""}
    </p>
  );
}

let root: Root | null = null;
let mounts = 0;

/** A page load, as far as the hook can tell: a fresh mount reading the address. */
async function load() {
  root?.unmount();
  handle = null;
  root = createRoot(document.getElementById("harness")!);
  mounts += 1;
  root.render(<Harness key={mounts} />);
  await until(() => handle !== null && !handle.loading, "the page to load");
}

/* ── driving it ───────────────────────────────────────────────────────────────────────────────── */

const settle = () => new Promise((r) => setTimeout(r, 120));

async function until(predicate: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await settle();
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Everything IndexedDB is holding, read directly rather than through the module under test. */
function stored(): Promise<{ id: string; created: boolean; dirty: boolean; version: string | null; state: SavedClaimState }[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("scrivn");
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("claims")) {
        db.close();
        resolve([]);
        return;
      }
      const request = db.transaction("claims", "readonly").objectStore("claims").getAll();
      request.onsuccess = () => {
        resolve(request.result ?? []);
        db.close();
      };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  });
}

const named = (name: string, from?: SavedClaimState): SavedClaimState => {
  const base = from ?? emptySavedClaimState();
  return { ...base, claim: { ...base.claim, customerName: name } };
};

async function type(state: SavedClaimState) {
  handle!.setState(state);
  await settle();
  await handle!.saveNow();
}

async function run() {
  window.history.replaceState(null, "", window.location.pathname);
  await load();
  const h = () => handle!;

  /* A — a claim started with no signal: saved on the device, under an id of its own, and said so. */
  await type(named("Bell"));
  await until(() => h().status === "pending", "the save to be reported as on this phone");
  check("with no signal, a save reports as saved on this phone, not as an error", h().status === "pending", h().status);
  let held = await stored();
  check("it is written to the device", held.length === 1, `${held.length} records`);
  check("under an id chosen on the device", /^[0-9a-f-]{36}$/.test(held[0]?.id ?? "") && held[0]?.id === h().claimId, held[0]?.id);
  check(
    "which is in the address already, so a reload with no signal reopens it",
    new URL(window.location.href).searchParams.get("id") === h().claimId,
    window.location.search,
  );
  check("and it is marked as not yet on the server", held[0]?.created === false && held[0]?.dirty === true);

  /* B — more changes, still no signal: one record, the latest. */
  await type(named("Bell — second floor too"));
  await until(() => h().status === "pending", "the second save");
  held = await stored();
  check("repeated saves leave one record, not one per attempt", held.length === 1, `${held.length} records`);
  check("holding the latest work", held[0]?.state.claim.customerName === "Bell — second floor too", held[0]?.state.claim.customerName);

  /* C — a reload with no signal opens the device's copy. */
  const id = h().claimId!;
  await load();
  check("a reload with no signal opens the claim from the device", h().state.claim.customerName === "Bell — second floor too", h().state.claim.customerName);
  check("and says that is where it came from", h().openedFromDevice !== null || h().status === "pending", `${h().status}, ${h().openedFromDevice}`);
  check("under the same id", h().claimId === id, String(h().claimId));

  /* D — signal returns: the claim is created under the device's id, once. */
  await goOnline();
  await until(() => h().status === "saved", "the claim to sync when signal returns");
  // Every attempt — the ones that failed offline included — carried the device's id, so the server has one claim.
  const created = requests.filter((r) => r.method === "POST");
  check(
    "the claim is created on the server under the device's id, once",
    claims.size === 1 && claims.has(id) && created.every((r) => r.body?.id === id),
    `${claims.size} on the server; ids sent: ${[...new Set(created.map((r) => r.body?.id))].join(", ")}`,
  );
  check("it is on the server now", h().onServer && claims.get(id)?.state.claim.customerName === "Bell — second floor too");
  held = await stored();
  check("the device copy is in step", held[0]?.dirty === false && held[0]?.version === claims.get(id)?.version, JSON.stringify(held[0] && { dirty: held[0].dirty, v: held[0].version }));

  /* E — a later save names the version it was made from. */
  const before = requests.length;
  await type(named("Bell — and the hallway", h().state));
  await until(() => h().status === "saved" && claims.get(id)?.state.claim.customerName === "Bell — and the hallway", "the follow-up save");
  const put = requests.slice(before).find((r) => r.method === "PUT");
  check("a later save updates that claim, from the version it had", put?.url === `/api/claims/${id}` && typeof put?.body?.base === "string", JSON.stringify(put?.body?.base));

  /* F — offline again; meanwhile the office changes the claim. Back online: a clash, both kept. */
  mode = "offline";
  await type(named("Bell — basement notes", h().state));
  await until(() => h().status === "pending", "the offline change");
  const office = { ...claims.get(id)!.state, transcript: "Office: adjuster says one room only." };
  claims.set(id, { state: office, version: nextVersion() });
  await goOnline();
  await until(() => h().status === "clash", "the clash to be caught");
  check("a change made here and one made elsewhere is caught as a clash", h().status === "clash" && h().clash !== null, h().status);
  check("the server's copy is not written over", claims.get(id)?.state.transcript === "Office: adjuster says one room only." && claims.get(id)?.state.claim.customerName === "Bell — and the hallway");
  check("this device's copy is still what is on screen", h().state.claim.customerName === "Bell — basement notes", h().state.claim.customerName);
  check("and what differs is named", (h().clash?.differs ?? []).includes("the claim details") && (h().clash?.differs ?? []).includes("the transcript"), (h().clash?.differs ?? []).join(", "));

  /* G — Keep both: the server's stays, this device's becomes a claim of its own. */
  await h().resolveClash("both");
  await until(() => h().status === "saved" && h().claimId !== id, "the copy to be saved as a claim of its own");
  const copyId = h().claimId!;
  check("keeping both leaves the office's version as it was", claims.get(id)?.state.transcript === "Office: adjuster says one room only.");
  check("and saves this device's as a new claim, named as a copy", claims.get(copyId)?.state.claim.customerName === "Bell — basement notes (copy)", claims.get(copyId)?.state.claim.customerName);
  check("which is what the page now shows", new URL(window.location.href).searchParams.get("id") === copyId && h().clash === null);

  /* H — Keep mine: a second clash, resolved the other way. */
  mode = "offline";
  await type(named("Bell — basement notes, final", h().state));
  await until(() => h().status === "pending", "another offline change");
  claims.set(copyId, { state: { ...claims.get(copyId)!.state, transcript: "Changed elsewhere again." }, version: nextVersion() });
  await goOnline();
  await until(() => h().status === "clash", "the second clash");
  await h().resolveClash("mine");
  await until(() => h().status === "saved", "mine to be saved over theirs");
  check("keep mine replaces the other version, as asked", claims.get(copyId)?.state.claim.customerName === "Bell — basement notes, final" && claims.get(copyId)?.state.transcript === "");
}

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

void (async () => {
  // Start clean: a database left by an earlier run would be read as this device's claims.
  await new Promise<void>((resolve) => {
    const del = indexedDB.deleteDatabase("scrivn");
    del.onsuccess = del.onerror = del.onblocked = () => resolve();
  });
  try {
    await run();
  } catch (err) {
    check("the run completed", false, err instanceof Error ? err.message : String(err));
  }
  (root as Root | null)?.unmount();
  // Leave nothing behind: a record surviving this page would be pushed for real on the next load.
  const del = indexedDB.deleteDatabase("scrivn");
  del.onsuccess = del.onerror = () => {};

  const failed = results.filter((r) => !r.ok);
  const out = document.getElementById("results")!;
  out.innerHTML = results
    .map((r) => `<div class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — <i>${r.detail}</i>` : ""}</div>`)
    .join("");
  document.getElementById("summary")!.textContent = `${results.length - failed.length} passed, ${failed.length} failed`;
  (window as unknown as { __pendingTests: unknown }).__pendingTests = {
    done: true,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
})();
