"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedClaimState } from "./claimState";
import { extractionRequest, generationRequest, withExtraction, withGeneratedDocuments } from "./claimGeneration";
import { syncClaim } from "./claimSync";
import { connection, isNetworkFailure, netFetch } from "./connectivity";
import { AI_JOBS, changeDeviceClaim, deviceChanged, deviceStorageWorks, deviceUser, newClaimId, onDeviceChange, readDeviceClaim, transact } from "./deviceClaims";
import type { TraceRequest, TraceResponse } from "./exteriorTrace";
import type { GeneratedDocuments, WaterLossExtraction } from "./types";

/**
 * The Claude steps, waiting for signal instead of failing (2026-10-13).
 *
 * Reading a transcript into a scope, generating the documents and tracing a side's photo are calls
 * to Claude on the server, so they cannot happen in a basement. Before this, pressing Generate there
 * failed and the estimator had to remember to press it again upstairs. Now it is written down here
 * and run the moment the signal is back — from whichever Scrivn page is open — while the claim stays
 * usable: the sketch, the moisture map and everything else carry on as normal.
 *
 * ── What a waiting step holds ────────────────────────────────────────────────────────────────────
 *
 * For the claim steps, only WHICH claim and WHICH step. The request is built when it runs, from the
 * claim as it is then (lib/claimGeneration.ts), so whatever was added while waiting — a sketch drawn,
 * a reading taken — is in it. A trace holds its request, because its photo is the thing being traced.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Nothing is counted while a step waits: a claim is counted by /api/generate when a generation
 * actually succeeds (lib/usage.ts), and a waiting step has not reached it.
 *
 * Nor is anything counted twice (2026-10-14). A generation carries one id, `jobId`, from the moment
 * it is first sent — by the page, or from here — to its last retry. The server counts each id once
 * and answers a repeat with the documents it already made (`beginGeneration` in lib/usage.ts,
 * 0013), so an answer lost on the way back, which leaves the step waiting and sends it again when
 * the signal returns, costs nothing the second time. A repeat that arrives while the first is still
 * being generated is told so (409, `running`) and simply waits for the next run.
 *
 * ── Where the answer goes ────────────────────────────────────────────────────────────────────────
 *
 * If the claim is open, to the page (`onScreen`), which applies it exactly as if the call had
 * answered there and then. If not, into the claim on the device, which then syncs like any other
 * change — so a generation that ran while the estimator was on another claim is there, finished,
 * when they come back to it.
 */

export type ClaimStep = "extract" | "generate";

export interface ClaimJob {
  key: string;
  kind: ClaimStep;
  claimId: string;
  user: string | null;
  queuedAt: number;
  /** Why the server would not do it. The step then waits for the estimator — Try again, or set it aside. */
  error: string | null;
  /**
   * The generation's id, sent as `jobId`: the same on every retry, so the server counts it once. A
   * step queued before ids existed is given one when it first runs.
   */
  id?: string;
}

export interface TraceJob {
  key: string;
  kind: "trace";
  /** The exterior side the trace is of. */
  sideId: string;
  user: string | null;
  queuedAt: number;
  request: TraceRequest;
  /** The answer, kept until the side's elevation is on screen to take it. */
  result: TraceResponse | null;
  error: string | null;
}

type AiJob = ClaimJob | TraceJob;

const claimKey = (claimId: string, kind: ClaimStep) => `${claimId}:${kind}`;
const traceKey = (sideId: string) => `trace:${sideId}`;

/* ── Storage ────────────────────────────────────────────────────────────────────────────────────── */

const memory = new Map<string, AiJob>();

async function allJobs(): Promise<AiJob[]> {
  if (deviceStorageWorks()) {
    try {
      return await transact<AiJob[]>(AI_JOBS, "readonly", (store, done) => {
        const all = store.getAll();
        all.onsuccess = () => done((all.result as AiJob[]) ?? []);
      });
    } catch {
      /* fall through to memory, as lib/deviceClaims.ts does */
    }
  }
  return [...memory.values()];
}

async function putJob(job: AiJob): Promise<void> {
  memory.set(job.key, job);
  if (deviceStorageWorks()) {
    try {
      await transact<void>(AI_JOBS, "readwrite", (store) => void store.put(job));
    } catch {
      /* kept in memory */
    }
  }
  deviceChanged();
}

async function dropJob(key: string): Promise<void> {
  memory.delete(key);
  if (deviceStorageWorks()) {
    try {
      await transact<void>(AI_JOBS, "readwrite", (store) => void store.delete(key));
    } catch {
      /* kept in memory */
    }
  }
  deviceChanged();
}

function mine(job: AiJob): boolean {
  const user = deviceUser();
  return user !== undefined && (job.user === null || job.user === user);
}

/** What is waiting on the signal for this person, oldest first. */
export async function waitingJobs(): Promise<AiJob[]> {
  return (await allJobs()).filter(mine).sort((a, b) => a.queuedAt - b.queuedAt);
}

/* ── The claim on screen ────────────────────────────────────────────────────────────────────────── */

export interface ClaimOnScreen {
  /** The claim as the page holds it right now — newer than the device's copy by up to a debounce. */
  state: () => SavedClaimState;
  /** Put an answer in, as the page would had the call answered there — with the photo notes it was made from. */
  extracted: (extraction: WaterLossExtraction, warnings: string[], scopedNotes: string[]) => void;
  generated: (documents: GeneratedDocuments) => void;
}

const onScreen = new Map<string, ClaimOnScreen>();

export function claimOnScreen(claimId: string, page: ClaimOnScreen): () => void {
  onScreen.set(claimId, page);
  return () => {
    if (onScreen.get(claimId) === page) onScreen.delete(claimId);
  };
}

/* ── Asking ─────────────────────────────────────────────────────────────────────────────────────── */

/** A new generation's id — see "Usage" above. */
export function newJobId(): string {
  return newClaimId();
}

/**
 * Write a claim step down to run when there is signal, and try it now if there might be.
 *
 * `id` is the id the page already sent this generation under, when its answer did not come back. A
 * step already waiting keeps its own: it is still the same request, and the server may have run it.
 */
export async function waitForSignal(claimId: string, kind: ClaimStep, id?: string): Promise<void> {
  const user = deviceUser();
  const key = claimKey(claimId, kind);
  const waiting = (await allJobs()).find((j): j is ClaimJob => j.key === key && j.kind !== "trace");
  await putJob({ key, kind, claimId, user: user ?? null, queuedAt: Date.now(), error: null, id: id ?? waiting?.id ?? newJobId() });
  if (connection() === "online") void runWaitingJobs();
}

export function setAside(claimId: string, kind: ClaimStep): Promise<void> {
  return dropJob(claimKey(claimId, kind));
}

/** Try a step again that the server refused — it goes back to waiting and runs if it can. */
export function tryAgain(claimId: string, kind: ClaimStep): Promise<void> {
  return waitForSignal(claimId, kind);
}

export async function waitForSignalToTrace(sideId: string, request: TraceRequest): Promise<void> {
  const user = deviceUser();
  await putJob({ key: traceKey(sideId), kind: "trace", sideId, user: user ?? null, queuedAt: Date.now(), request, result: null, error: null });
  if (connection() === "online") void runWaitingJobs();
}

/** The trace's answer, taken by the side's elevation — and removed, since it is now on screen. */
export async function takeTrace(sideId: string): Promise<TraceJob | null> {
  const job = (await allJobs()).find((j): j is TraceJob => j.key === traceKey(sideId));
  if (!job || (!job.result && !job.error)) return null;
  await dropJob(job.key);
  return job;
}

export function setTraceAside(sideId: string): Promise<void> {
  return dropJob(traceKey(sideId));
}

/* ── Running ────────────────────────────────────────────────────────────────────────────────────── */

/** Keys running in this tab right now, for "Reading the transcript…" rather than "Waiting". */
const runningHere = new Set<string>();

export function isRunning(key: string): boolean {
  return runningHere.has(key);
}

async function postStep(url: string, body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; offline: boolean; busy?: boolean; message: string }> {
  try {
    /*
      Longer than the server can take (Vercel stops a function at 300 s), so giving up here only ever
      means the connection died — never that a slow answer was abandoned and then paid for twice.
    */
    const res = await netFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 330_000 });
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    // Signed out (the session lapsed while offline): keep waiting, as for no signal — signing in lets it run.
    if (res.status === 401) return { ok: false, offline: true, message: "Signed out." };
    // The same generation is still being made from an earlier send: wait for it, as for no signal.
    if (res.status === 409 && data && (data as { running?: unknown }).running === true) return { ok: false, offline: false, busy: true, message: "Still generating." };
    if (!res.ok) return { ok: false, offline: false, message: (data && typeof data.error === "string" && data.error) || `Request failed (${res.status})` };
    return { ok: true, data };
  } catch (err) {
    if (isNetworkFailure(err)) return { ok: false, offline: true, message: "No signal." };
    return { ok: false, offline: false, message: err instanceof Error ? err.message : "The request failed." };
  }
}

/**
 * Run one job. Returns false when the signal is gone, so the caller stops.
 *
 * Under a cross-tab lock, taken only if free: two tabs must never send the same generation, which
 * would cost twice and count twice.
 */
async function runOne(job: AiJob): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  const run = () => (job.kind === "trace" ? runTrace(job) : runClaimStep(job));
  if (!locks) return run();
  const outcome = await locks.request(`scrivn-ai-${job.key}`, { ifAvailable: true }, (lock) => (lock ? run() : true));
  return outcome as boolean;
}

async function runClaimStep(waiting: ClaimJob): Promise<boolean> {
  // Re-read: another tab may have run it, or the estimator set it aside, since the list was taken.
  const current = (await allJobs()).find((j): j is ClaimJob => j.key === waiting.key && j.kind !== "trace" && !j.error);
  if (!current) return true;
  // Its id is written down BEFORE it is sent, so that if the answer is lost the retry is the same request.
  const job: ClaimJob = current.id ? current : { ...current, id: newJobId() };
  if (!current.id) await putJob(job);
  const page = onScreen.get(job.claimId);
  const state = page?.state() ?? (await readDeviceClaim(job.claimId))?.state;
  if (!state) {
    await dropJob(job.key);
    return true;
  }

  // The photo notes are built here, at the moment it runs, from the photos as they are now (lib/claimGeneration.ts).
  const extract = job.kind === "extract" ? extractionRequest(state) : null;
  const request = job.kind === "extract" ? (extract?.body ?? null) : generationRequest(state);
  const body = request && job.kind === "generate" ? { ...request, jobId: job.id } : request;
  if (!body) {
    await putJob({ ...job, error: job.kind === "extract" ? "There is no transcript to read." : "There is nothing to generate from yet." });
    return true;
  }

  runningHere.add(job.key);
  deviceChanged();
  try {
    const answer = await postStep(job.kind === "extract" ? "/api/extract" : "/api/generate", body);
    if (!answer.ok) {
      if (answer.offline) return false;
      if (answer.busy) return true;
      await putJob({ ...job, error: answer.message });
      return true;
    }

    // Set aside while it was running? Then the answer is not wanted.
    if (!(await allJobs()).some((j) => j.key === job.key)) return true;
    const page = onScreen.get(job.claimId);
    if (job.kind === "extract") {
      const { extraction, warnings } = answer.data as { extraction: WaterLossExtraction; warnings?: string[] };
      const scopedNotes = extract?.scopedNotes ?? [];
      if (page) page.extracted(extraction, warnings ?? [], scopedNotes);
      else await intoDeviceCopy(job.claimId, (s) => withExtraction(s, extraction, scopedNotes));
    } else {
      const { documents } = answer.data as { documents: GeneratedDocuments };
      if (page) page.generated(documents);
      else await intoDeviceCopy(job.claimId, (s) => withGeneratedDocuments(s, documents));
    }
    await dropJob(job.key);
    return true;
  } finally {
    runningHere.delete(job.key);
    deviceChanged();
  }
}

/** An answer folded into the claim on the device, which then syncs as any change does. */
async function intoDeviceCopy(claimId: string, change: (state: SavedClaimState) => Partial<SavedClaimState>): Promise<void> {
  await changeDeviceClaim(claimId, (r) =>
    r ? { ...r, state: { ...r.state, ...change(r.state) }, dirty: true, refused: null, changedAt: Date.now(), touchedAt: Date.now() } : undefined,
  );
  void syncClaim(claimId);
}

async function runTrace(job: TraceJob): Promise<boolean> {
  if (job.result || job.error) return true;
  runningHere.add(job.key);
  deviceChanged();
  try {
    const answer = await postStep("/api/exterior/trace", job.request);
    if (!answer.ok) {
      if (answer.offline) return false;
      await putJob({ ...job, error: answer.message });
      return true;
    }
    const result = answer.data as Partial<TraceResponse>;
    if (!result.proposals) {
      await putJob({ ...job, error: "The trace did not come back." });
      return true;
    }
    if ((await allJobs()).some((j) => j.key === job.key)) await putJob({ ...job, result: result as TraceResponse });
    return true;
  } finally {
    runningHere.delete(job.key);
    deviceChanged();
  }
}

let running: Promise<void> | null = null;

/** Run what is waiting, oldest first, one at a time. Coalesced like `syncAll`. */
export function runWaitingJobs(): Promise<void> {
  if (running) return running;
  running = (async () => {
    for (const job of await waitingJobs()) {
      if (job.kind !== "trace" && job.error) continue;
      if (!(await runOne(job))) break;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/* ── For the page ───────────────────────────────────────────────────────────────────────────────── */

/**
 * A side's trace waiting for signal: whether one is waiting or running, and its answer handed to
 * `deliver` once — when it comes back while the side is on screen, or the next time it is.
 */
export function useSideTrace(sideId: string, deliver: (job: TraceJob) => void): { waiting: boolean; running: boolean } {
  const [state, setState] = useState({ waiting: false, running: false });
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const job = (await waitingJobs()).find((j): j is TraceJob => j.key === traceKey(sideId));
      if (!alive) return;
      if (job && (job.result || job.error)) {
        const taken = await takeTrace(sideId);
        if (alive && taken) deliverRef.current(taken);
        setState({ waiting: false, running: false });
        return;
      }
      setState({ waiting: !!job, running: !!job && isRunning(job.key) });
    };
    void refresh();
    const off = onDeviceChange(() => void refresh());
    return () => {
      alive = false;
      off();
    };
  }, [sideId]);
  return state;
}

export interface StepState {
  /** Waiting for signal, or running now. */
  waiting: boolean;
  running: boolean;
  error: string | null;
}

/** What is waiting for one claim, kept current as jobs come and go. */
export function useClaimSteps(claimId: string | null): Record<ClaimStep, StepState | null> {
  const [steps, setSteps] = useState<Record<ClaimStep, StepState | null>>({ extract: null, generate: null });
  const refresh = useCallback(async () => {
    if (!claimId) return setSteps({ extract: null, generate: null });
    const jobs = await waitingJobs();
    const of = (kind: ClaimStep): StepState | null => {
      const job = jobs.find((j) => j.key === claimKey(claimId, kind)) as ClaimJob | undefined;
      return job ? { waiting: !job.error, running: isRunning(job.key), error: job.error } : null;
    };
    setSteps({ extract: of("extract"), generate: of("generate") });
  }, [claimId]);
  useEffect(() => {
    void refresh();
    return onDeviceChange(() => void refresh());
  }, [refresh]);
  return steps;
}
