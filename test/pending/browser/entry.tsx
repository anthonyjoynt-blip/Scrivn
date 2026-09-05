/**
 * The save queue as the claim page actually uses it — in a real browser, against real IndexedDB.
 *
 * The Node suite next door covers the queue module thoroughly, but it cannot cover the wiring in
 * `useClaimPersistence`, which is where the mistakes in this feature were: a failed save has to be
 * written to the device, the status has to say so rather than saying "Saved", and when signal comes
 * back the record has to be pushed AND the id it comes back with adopted — or the page carries on
 * believing it was never saved and creates the same job a second time.
 *
 * None of that runs without React effects, a real event loop, and a store that survives between
 * them. So it runs here rather than under a stub of the parts under test.
 */

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useClaimPersistence } from "@/lib/useClaimPersistence";
import { emptySavedClaimState, type SavedClaimState } from "@/lib/claimState";

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

/* ── the scripted network ─────────────────────────────────────────────────────────────────────── */

let mode: "offline" | "online" = "offline";
const requests: { url: string; method: string }[] = [];
let nextId = 1;

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("/api/claims")) return realFetch(input as RequestInfo, init);
  requests.push({ url, method: init?.method ?? "GET" });
  if (mode === "offline") throw new TypeError("Failed to fetch");
  const body = init?.method === "POST" ? { id: `claim-${nextId++}` } : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof window.fetch;

/* ── the harness ──────────────────────────────────────────────────────────────────────────────── */

type Handle = {
  status: string;
  claimId: string | null;
  pendingCount: number;
  setState: (s: SavedClaimState) => void;
  saveNow: () => Promise<void>;
};

let handle: Handle | null = null;

function Harness() {
  const [state, setState] = useState<SavedClaimState>(() => emptySavedClaimState());
  const persistence = useClaimPersistence({ state, apply: setState, enabled: true });

  // Kept in a ref so the driver below always reads the CURRENT render's values, not a stale closure.
  const latest = useRef<Handle | null>(null);
  latest.current = {
    status: persistence.status,
    claimId: persistence.claimId,
    pendingCount: persistence.pendingCount,
    setState,
    saveNow: persistence.saveNow,
  };
  handle = latest.current;

  useEffect(() => {
    handle = latest.current;
  });

  return (
    <p>
      status: <b>{persistence.status}</b> · id: {persistence.claimId ?? "—"} · held: {persistence.pendingCount}
    </p>
  );
}

/* ── driving it ───────────────────────────────────────────────────────────────────────────────── */

const settle = () => new Promise((r) => setTimeout(r, 120));

async function until(predicate: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await settle();
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Everything IndexedDB is holding, read directly rather than through the module under test. */
function stored(): Promise<{ key: string; claimId: string | null; state: SavedClaimState }[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("scrivn", 1);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("pendingSaves", "readonly").objectStore("pendingSaves").getAll();
      request.onsuccess = () => {
        resolve(request.result ?? []);
        db.close();
      };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  });
}

async function run() {
  // `hasAnyContent` refuses to save an untouched claim, so every scenario has to put something real
  // in — a customer name is the smallest thing that counts.
  const named = (name: string): SavedClaimState => {
    const base = emptySavedClaimState();
    return { ...base, claim: { ...base.claim, customerName: name } };
  };

  await until(() => handle !== null, "the harness to mount");
  const h = () => handle!;

  /* A — a save that cannot get through is kept on the device, and says so. */
  h().setState(named("Bell"));
  await settle();
  await h().saveNow();
  await until(() => h().status === "pending", "the save to be reported as held on the device");
  check("a failed save reports as held on this device, not as an error", h().status === "pending", h().status);

  let held = await stored();
  check("a failed save is written to the device", held.length === 1, `${held.length} records`);
  check("the queued record holds what was on screen", held[0]?.state.claim.customerName === "Bell", held[0]?.state.claim.customerName);
  check(
    "a claim that never reached the server is queued without an id",
    held[0]?.claimId === null,
    String(held[0]?.claimId),
  );

  /* B — failing again overwrites, rather than piling up a copy per attempt. */
  h().setState(named("Bell — second floor too"));
  await settle();
  await h().saveNow();
  await until(() => h().status === "pending", "the second failure");
  held = await stored();
  check("repeated failures leave one record, not one per attempt", held.length === 1, `${held.length} records`);
  check(
    "and that record holds the latest work",
    held[0]?.state.claim.customerName === "Bell — second floor too",
    held[0]?.state.claim.customerName,
  );

  /* C — signal returns. The work goes, and the page adopts the id it comes back with. */
  const before = requests.length;
  mode = "online";
  window.dispatchEvent(new Event("online"));
  await until(() => h().status === "saved", "the queued work to be pushed once signal returns");

  check("the queued claim is created on the server", requests.slice(before).some((r) => r.method === "POST"));
  check("the page adopts the id it was given", h().claimId !== null, String(h().claimId));
  check(
    "and puts it in the address, so a reload reopens this claim",
    new URL(window.location.href).searchParams.get("id") === h().claimId,
    window.location.search,
  );
  check("the device stops holding it", (await stored()).length === 0);
  check("nothing is reported as still waiting", h().pendingCount === 0, String(h().pendingCount));

  /* D — the adopted claim is updated in place, never created a second time. */
  const afterAdopt = requests.length;
  h().setState(named("Bell — and the hallway"));
  await settle();
  await h().saveNow();
  await until(() => h().status === "saved", "the follow-up save");
  const follow = requests.slice(afterAdopt);
  check(
    "a later save updates that claim rather than creating another",
    follow.length > 0 && follow.every((r) => r.method === "PUT"),
    follow.map((r) => `${r.method} ${r.url}`).join(", "),
  );

  /* E — losing signal again queues under the server id, so the drain will PUT rather than POST. */
  mode = "offline";
  h().setState(named("Bell — and the stairs"));
  await settle();
  await h().saveNow();
  await until(() => h().status === "pending", "the claim to be held again");
  held = await stored();
  check("a known claim is queued under its server id", held[0]?.claimId === h().claimId, String(held[0]?.claimId));
  check("so it will be updated, not duplicated, when signal returns", held[0]?.key === h().claimId, held[0]?.key);

  /*
    F — a save that gets through on its own, with no push in between, must clear what is queued.

    This is the flaky-signal case rather than the offline one, and it is the one that loses work
    quietly: one save fails and is queued, the PM carries on typing, the next save succeeds. If the
    queued copy is left behind it is older than what the server now holds, and the next push writes
    it straight back over the newer work. Nothing on screen would say so.
  */
  mode = "online";
  h().setState(named("Bell — and the basement"));
  await settle();
  await h().saveNow();
  await until(() => h().status === "saved", "the save to get through");
  check(
    "a save that gets through clears what was queued before it",
    (await stored()).length === 0,
    `${(await stored()).length} records left`,
  );
  check("and nothing is reported as still waiting", h().pendingCount === 0, String(h().pendingCount));
}

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

const mount = document.getElementById("harness")!;
createRoot(mount).render(<Harness />);

void (async () => {
  try {
    await run();
  } catch (err) {
    check("the run completed", false, err instanceof Error ? err.message : String(err));
  }
  // Leave nothing behind: a record surviving this page would be pushed for real on the next load.
  const open = indexedDB.deleteDatabase("scrivn");
  open.onsuccess = open.onerror = () => {};

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
