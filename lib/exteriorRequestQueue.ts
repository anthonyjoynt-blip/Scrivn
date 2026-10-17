import { isNetworkFailure, netFetch } from "./connectivity";
import { deviceUser, readDeviceClaim } from "./deviceClaims";
import { photoFile } from "./devicePhotos";
import type { ExteriorRequestInput, ExteriorRequestView } from "./exteriorRequests";

/**
 * Send to Scrivn team, on the phone (2026-10-17, lib/exteriorRequests.ts): what the tester asked for, kept here
 * until Scrivn has it, so the tap never waits on anything.
 *
 * A send goes once the photos it names have left this phone (lib/devicePhotos.ts) and the claim is on Scrivn -
 * the server takes a request only for photos its claim lists, as it takes a photo's picture. Until then it waits
 * here and the Exterior says so ("3 photos are still to upload"). Withdraw and Use it wait the same way with no
 * signal. Each is sent by whichever page is open: the header's sync (components/SyncStatus.tsx) every minute and
 * when the signal comes back, and the Exterior the moment a photo uploads.
 *
 * Kept in localStorage, beside the photos it waits for: a few KB each (the route's inputs), and if the browser
 * clears this site's storage the photos it was waiting for went with it. A send names the id it was given when
 * tapped, so one repeated after a lost answer is the same request on the server, never two.
 */

export interface WaitingRequest {
  kind: "send" | "withdraw" | "applied";
  /** The request's id: chosen here for a send. */
  id: string;
  claimId: string;
  /** Whose, so a shared phone never sends one person's request under another's sign-in. */
  user: string | null;
  /** What a send sends. */
  input?: ExteriorRequestInput;
  at: number;
  /** Why Scrivn would not take it, said on the Exterior with a way to let it go. */
  refused?: string | null;
}

const KEY = "scrivn-exterior-requests";
/** A claim Scrivn has never heard of after a day is a claim deleted elsewhere, not a save behind. */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

let memory: WaitingRequest[] = [];
const listeners = new Set<() => void>();

function read(): WaitingRequest[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw === null) return memory;
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as WaitingRequest[]).filter((w) => w && typeof w.id === "string" && typeof w.claimId === "string") : [];
  } catch {
    return memory;
  }
}

function write(list: WaitingRequest[]): void {
  memory = list;
  try {
    if (typeof localStorage !== "undefined") {
      if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
      else localStorage.removeItem(KEY);
    }
  } catch {
    /* in memory for this page, as the device store falls back */
  }
  changed();
}

function changed(): void {
  listeners.forEach((l) => l());
}

export function onTeamChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** As the photos' rule (lib/devicePhotos.ts): nobody signed in, nothing is theirs; one kept with no owner goes with whoever is. */
const mine = (w: WaitingRequest, user = deviceUser()) => user !== undefined && (w.user === null || w.user === user);

/** What waits on this phone, this person's: for one claim, or all of them. */
export function waitingRequests(claimId?: string): WaitingRequest[] {
  return read().filter((w) => mine(w) && (claimId === undefined || w.claimId === claimId));
}

/** The tester tapped Send: kept, then sent as soon as it can be. */
export function sendToTeam(claimId: string, input: ExteriorRequestInput): void {
  write([...read().filter((w) => w.id !== input.id), { kind: "send", id: input.id, claimId, user: deviceUser() ?? null, input, at: Date.now() }]);
  void sendWaitingRequests();
}

/** Withdraw: a send still on this phone simply goes; one Scrivn has is withdrawn there. */
export function withdrawRequest(claimId: string, id: string): void {
  const list = read();
  const unsent = list.find((w) => w.id === id && w.kind === "send");
  const rest = list.filter((w) => w.id !== id);
  write(unsent ? rest : [...rest, { kind: "withdraw", id, claimId, user: deviceUser() ?? null, at: Date.now() }]);
  forget(claimId, id);
  if (!unsent) void sendWaitingRequests();
}

/** Use it: the measurement is in the claim now, so Scrivn stops offering it. */
export function markApplied(claimId: string, id: string): void {
  write([...read().filter((w) => w.id !== id), { kind: "applied", id, claimId, user: deviceUser() ?? null, at: Date.now() }]);
  forget(claimId, id);
  void sendWaitingRequests();
}

/** How many of these photos are still on this phone waiting to upload (refused ones never will, so are not counted). */
export async function photosStillToUpload(ids: string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const f = await photoFile(id).catch(() => null);
    if (f && !f.refused) n += 1;
  }
  return n;
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body?.error === "string" ? body.error : `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

function update(id: string, f: (w: WaitingRequest) => WaitingRequest | null): void {
  const list = read();
  const at = list.findIndex((w) => w.id === id);
  if (at < 0) return;
  const next = f(list[at] as WaitingRequest);
  write(next ? list.map((w, i) => (i === at ? next : w)) : list.filter((_, i) => i !== at));
}

type Step = "done" | "later" | "stop";

async function sendOne(w: WaitingRequest): Promise<Step> {
  const claim = await readDeviceClaim(w.claimId).catch(() => null);
  // A claim started offline, its first save still to land: Scrivn has nothing to file it under yet.
  if (claim && !claim.created) return "later";
  if (w.kind === "send" && w.input && (await photosStillToUpload(w.input.photoIds)) > 0) return "later";
  let res: Response;
  try {
    res =
      w.kind === "send"
        ? await netFetch(`/api/claims/${w.claimId}/exterior-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(w.input), timeoutMs: 60_000 })
        : await netFetch(`/api/claims/${w.claimId}/exterior-requests/${w.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: w.kind }), timeoutMs: 30_000 });
  } catch (err) {
    if (isNetworkFailure(err)) return "stop";
    throw err;
  }
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { request?: ExteriorRequestView } | null;
    update(w.id, () => null);
    if (body?.request) remember(w.claimId, body.request);
    return "done";
  }
  if (res.status === 401) return "stop";
  if (w.kind !== "send") {
    // Withdrawn or used already, or gone with its claim: nothing left to ask for.
    if (res.status === 404 || res.status === 409 || res.status === 400) update(w.id, () => null);
    return "later";
  }
  const stale = Date.now() - w.at > GIVE_UP_AFTER_MS;
  // 409: the claim does not list the photos yet, its save is behind. 404: the claim is not on Scrivn yet.
  if (res.status === 409 || res.status === 404) {
    if (stale) {
      const why = await errorText(res);
      update(w.id, (cur) => ({ ...cur, refused: why }));
    }
    return "later";
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    const why = await errorText(res);
    update(w.id, (cur) => ({ ...cur, refused: why }));
  }
  return "later";
}

let running: Promise<{ sent: number; waiting: number }> | null = null;

/** Send what waits, this person's, oldest first; stops at the first sign of no signal. Coalesced, as the photos' run is. */
export function sendWaitingRequests(): Promise<{ sent: number; waiting: number }> {
  if (running) return running;
  running = (async () => {
    let sent = 0;
    const queue = waitingRequests()
      .filter((w) => !w.refused)
      .sort((a, b) => a.at - b.at);
    for (const w of queue) {
      const step = await sendOne(w).catch((err) => {
        console.error("[exterior requests]", err);
        return "later" as const;
      });
      if (step === "stop") break;
      if (step === "done") sent += 1;
    }
    return { sent, waiting: waitingRequests().length };
  })().finally(() => {
    running = null;
  });
  return running;
}

/* ── What Scrivn has: the claim's requests, as last heard ─────────────────────────────────────────── */

const known = new Map<string, ExteriorRequestView[]>();

function remember(claimId: string, view: ExteriorRequestView): void {
  const list = known.get(claimId) ?? [];
  known.set(claimId, [view, ...list.filter((r) => r.id !== view.id)]);
  changed();
}

function forget(claimId: string, id: string): void {
  const list = known.get(claimId);
  if (list?.some((r) => r.id === id)) {
    known.set(
      claimId,
      list.filter((r) => r.id !== id),
    );
    changed();
  }
}

/** The claim's requests as Scrivn last said, newest first; null before it has been asked (or with no signal since). */
export function knownRequests(claimId: string): ExteriorRequestView[] | null {
  return known.get(claimId) ?? null;
}

const asking = new Map<string, Promise<boolean>>();
const askedAt = new Map<string, number>();

/**
 * Ask Scrivn again. False with no answer (no signal, signed out): what was known stays. The Exterior's two places
 * that show a request ask at once; they share one question, and one asked in the last few seconds is answer enough.
 */
export function refreshRequests(claimId: string, { force = false } = {}): Promise<boolean> {
  const inFlight = asking.get(claimId);
  if (inFlight) return inFlight;
  if (!force && Date.now() - (askedAt.get(claimId) ?? 0) < 5000 && known.has(claimId)) return Promise.resolve(true);
  const ask = (async () => {
    try {
      const res = await netFetch(`/api/claims/${claimId}/exterior-requests`, { timeoutMs: 20_000 });
      if (!res.ok) return false;
      const body = (await res.json()) as { requests?: ExteriorRequestView[] };
      known.set(claimId, Array.isArray(body.requests) ? body.requests : []);
      askedAt.set(claimId, Date.now());
      changed();
      return true;
    } catch {
      return false;
    } finally {
      asking.delete(claimId);
    }
  })();
  asking.set(claimId, ask);
  return ask;
}
