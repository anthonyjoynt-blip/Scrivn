"use client";

import { parseSavedClaimState, SAVED_CLAIM_KEYS, type SavedClaimState } from "./claimState";
import { netFetch, isNetworkFailure } from "./connectivity";
import { allDeviceClaims, changeDeviceClaim, deviceUser, isMine, readDeviceClaim, type DeviceClaim } from "./deviceClaims";

/**
 * Sending what this device holds to the server, without overwriting what somebody else did
 * (2026-10-13).
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Every save names the server version it was made from. If the claim is still at that version the
 * save lands; if it has moved on — the office changed it while this phone was in a basement — the
 * server refuses and sends back what it has, and BOTH copies are kept: the server's stays on the
 * server, this one stays on the device with the server's beside it, and the estimator is asked
 * which to keep (see `ClashBanner`). Nothing is merged and nothing is chosen for them: a wrong merge
 * of a sketch or a set of gap-check answers produces a claim that reads as correct.
 *
 * ── The one refusal that is not a clash ──────────────────────────────────────────────────────────
 *
 * On one bar, a save can land and its answer never come back. The device still holds the old
 * version, so its next save is refused — by its own earlier write. Telling the estimator "somebody
 * else changed this" would be false and would ask them to choose between two copies of their own
 * work. So every state is fingerprinted before it is sent (`sent`), and a refusal whose server copy
 * is one of them is recognised as ours: the device moves on to that version and carries on.
 *
 * ── One send per claim at a time ─────────────────────────────────────────────────────────────────
 *
 * The page, the header and the Claims list can all decide to send the same claim. Two sends of one
 * state from one version would refuse each other, so sends of a claim queue behind each other, across
 * tabs as well where the browser offers Web Locks.
 */

/* ── Fingerprints ───────────────────────────────────────────────────────────────────────────────── */

/** JSON with every object's keys in order, so two equal states always print the same. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

/** cyrb53: a fast 53-bit string hash. Only ever compared for equality, never trusted for security. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A claim's fingerprint, as the SERVER would store it: through JSON (which is what the request does
 * to it) and `parseSavedClaimState` (which is what the route does), with key order taken out
 * (which is what Postgres's jsonb does). So a state and the server's copy of it always match.
 */
export function stateFingerprint(state: SavedClaimState): string {
  return cyrb53(stableStringify(parseSavedClaimState(JSON.parse(JSON.stringify(state)))));
}

/** The parts of a claim, as an estimator would name them, for saying what two copies disagree on. */
const PART: Partial<Record<keyof SavedClaimState, string>> = {
  claim: "the claim details",
  transcript: "the transcript",
  extraction: "the scope read from the transcript",
  answers: "the follow-up answers",
  questionLog: "the follow-up answers",
  documents: "the documents",
  contentsApproach: "the contents",
  contentsTM: "the contents",
  bricABrac: "the contents",
  dgigData: "the DGIG form",
  asbestos: "the asbestos form",
  selectedTrades: "the work orders",
  workOrders: "the work orders",
  sketch: "the sketch",
  sketchAttachments: "what each document carries",
  moisture: "the moisture map",
  scopeMarks: "the markings on the sketch",
  resolvedSuggestions: "the equipment answers",
  // `step` is left out: which screen each copy was last on is not a difference in the claim.
};

/**
 * What differs between this device's copy and the server's, in words, without repeats.
 *
 * Every saved key is compared, not only the ones `PART` names: a field added to the claim later (the
 * drying log, on its way) is still a difference the estimator is told about — as "other details"
 * until it is given a name of its own here — rather than a clash that names nothing.
 */
export function clashDifferences(mine: SavedClaimState, theirs: SavedClaimState | null): string[] {
  if (!theirs) return [];
  const a = parseSavedClaimState(JSON.parse(JSON.stringify(mine))) as unknown as Record<string, unknown>;
  const b = parseSavedClaimState(JSON.parse(JSON.stringify(theirs))) as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const key of SAVED_CLAIM_KEYS) {
    if (key === "step") continue;
    if (stableStringify(a[key]) === stableStringify(b[key])) continue;
    const label = PART[key] ?? "other details";
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/* ── Locks ──────────────────────────────────────────────────────────────────────────────────────── */

const chains = new Map<string, Promise<unknown>>();

function withClaimLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks) return locks.request(`scrivn-claim-${id}`, run) as Promise<T>;
  const previous = chains.get(id) ?? Promise.resolve();
  const next = previous.then(run, run);
  chains.set(
    id,
    next.catch(() => undefined),
  );
  return next;
}

/* ── One claim ──────────────────────────────────────────────────────────────────────────────────── */

export type SyncOutcome =
  /** The server has exactly what the device has. */
  | { kind: "synced" }
  /** No connection; it waits on the device. */
  | { kind: "offline" }
  /** The server changed too; both are kept and the estimator must choose. */
  | { kind: "clash" }
  /** The session has gone; it waits until they sign in again. */
  | { kind: "signed-out" }
  /** The server would not take it (and says why); it waits on the device until it changes. */
  | { kind: "refused"; message: string }
  /** The server failed; tried again later. */
  | { kind: "failed"; message: string }
  /** Nothing to send: not held here, or not this person's. */
  | { kind: "none" };

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body?.error === "string" ? body.error : `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

/**
 * Send one claim if it has anything unsent, and record what came of it.
 *
 * Loops while there is something newer to send — edits made during a slow save are sent straight
 * after it, rather than waiting for the next edit to notice them.
 */
export function syncClaim(id: string): Promise<SyncOutcome> {
  return withClaimLock(id, async () => {
    for (let round = 0; round < 4; round++) {
      const record = await readDeviceClaim(id);
      if (!record || !isMine(record, deviceUser())) return { kind: "none" };
      if (record.clash) return { kind: "clash" };
      if (!record.dirty) return { kind: "synced" };
      if (record.refused) return { kind: "refused", message: record.refused };
      const outcome = await sendOnce(record);
      if (outcome !== "again") return outcome;
    }
    return { kind: "synced" };
  });
}

async function sendOnce(record: DeviceClaim): Promise<SyncOutcome | "again"> {
  const fingerprint = stateFingerprint(record.state);
  // Written down BEFORE it goes, so a save that lands with its answer lost is still recognised.
  await changeDeviceClaim(record.id, (r) => (r && !r.sent.includes(fingerprint) ? { ...r, sent: [...r.sent.slice(-4), fingerprint] } : undefined));

  let res: Response;
  try {
    res = record.created
      ? await netFetch(`/api/claims/${record.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(record.version ? { state: record.state, base: record.version } : { state: record.state }),
        })
      : await netFetch("/api/claims", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: record.id, state: record.state }),
        });
  } catch (err) {
    if (isNetworkFailure(err)) return { kind: "offline" };
    throw err;
  }

  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { version?: string; existed?: boolean };
    const version = typeof body.version === "string" ? body.version : null;
    if (!record.created && body.existed) {
      /*
        The claim was already there: an earlier attempt from this device created it and its answer
        was lost. It holds that attempt's state, not necessarily this one, so this goes again as an
        ordinary save from the version it is at.
      */
      await changeDeviceClaim(record.id, (r) => (r ? { ...r, created: true, version } : undefined));
      return "again";
    }
    let more = false;
    await changeDeviceClaim(record.id, (r) => {
      if (!r) return undefined;
      // Edited while this was on the wire: the newer state is still owed, from the new version.
      more = stateFingerprint(r.state) !== fingerprint;
      return { ...r, created: true, version, dirty: more, sent: [], refused: null, touchedAt: Date.now() };
    });
    return more ? "again" : { kind: "synced" };
  }

  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as { conflict?: { state?: SavedClaimState; version?: string } } | null;
    const theirs = body?.conflict;
    if (!theirs?.state || typeof theirs.version !== "string") return { kind: "failed", message: "The server refused the save without saying why." };
    const theirsPrint = stateFingerprint(theirs.state);
    if (theirsPrint === fingerprint || record.sent.includes(theirsPrint)) {
      // Our own earlier write, its answer lost — see the file's note. Move on to its version.
      let more = false;
      await changeDeviceClaim(record.id, (r) => {
        if (!r) return undefined;
        more = stateFingerprint(r.state) !== theirsPrint;
        return { ...r, version: theirs.version!, dirty: more, sent: [] };
      });
      return more ? "again" : { kind: "synced" };
    }
    await changeDeviceClaim(record.id, (r) => (r ? { ...r, clash: { state: theirs.state!, version: theirs.version!, at: Date.now() } } : undefined));
    return { kind: "clash" };
  }

  if (res.status === 404 && record.created) {
    /*
      Gone from the server — deleted, most likely by someone in the office, while this device held
      changes to it. Kept and asked about like any other clash, with nothing on the other side.
    */
    await changeDeviceClaim(record.id, (r) => (r ? { ...r, clash: { state: null, version: null, at: Date.now() } } : undefined));
    return { kind: "clash" };
  }

  if (res.status === 401) return { kind: "signed-out" };

  const message = await errorText(res);
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    /*
      Refused on its merits. Kept — it is still the only copy of this work — but not sent again
      until it changes, so it is not retried for ever, and the reason is shown.
    */
    await changeDeviceClaim(record.id, (r) => (r ? { ...r, refused: message } : undefined));
    return { kind: "refused", message };
  }
  return { kind: "failed", message };
}

/* ── Everything ─────────────────────────────────────────────────────────────────────────────────── */

let running: Promise<SyncSummary> | null = null;

export interface SyncSummary {
  sent: number;
  waiting: number;
}

/**
 * Send every claim this person has waiting on the device, oldest change first. Stops at the first
 * sign of no connection — the rest would only fail the same way.
 *
 * Coalesced: called from the page, the header and the list, possibly all at once when the signal
 * comes back, and every caller is handed the same run.
 */
export function syncAll(): Promise<SyncSummary> {
  if (running) return running;
  running = (async () => {
    let sent = 0;
    const user = deviceUser();
    const owed = (await allDeviceClaims())
      .filter((r) => r.dirty && !r.clash && !r.refused && isMine(r, user))
      .sort((a, b) => a.changedAt - b.changedAt);
    for (const record of owed) {
      const outcome = await syncClaim(record.id).catch(() => ({ kind: "failed" }) as SyncOutcome);
      if (outcome.kind === "synced") sent += 1;
      if (outcome.kind === "offline" || outcome.kind === "signed-out") break;
    }
    const waiting = (await allDeviceClaims()).filter((r) => (r.dirty || r.clash) && isMine(r, user)).length;
    return { sent, waiting };
  })().finally(() => {
    running = null;
  });
  return running;
}
