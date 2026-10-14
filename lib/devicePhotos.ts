"use client";

import { netFetch, isNetworkFailure } from "./connectivity";
import { deviceChanged, deviceStorageWorks, deviceUser, PHOTO_FILES, readDeviceClaim, transact } from "./deviceClaims";

/**
 * Site photos kept on this phone until Scrivn has them (2026-10-14).
 *
 * A photo is two things that travel separately. Its RECORD — room, time, caption — goes into the
 * claim at once (lib/photos.ts) and syncs with it. Its PICTURE, a JPEG of about 2,000 px and a small
 * thumbnail, is written here first and uploaded on its own, one photo at a time, whenever the claims
 * sync: when a page loads, when the signal comes back, and every minute (components/SyncStatus.tsx).
 * A basement full of photos is therefore safe the moment each is taken, and none of them rides in the
 * claim's own save, which must stay small.
 *
 * ── Order matters ────────────────────────────────────────────────────────────────────────────────
 *
 * The server stores a picture only for a photo its claim lists (`app/api/claims/[id]/photos/[photoId]`),
 * so the claim's save goes first and the pictures after it. A picture sent before its record landed
 * is simply tried again on the next run. One whose photo was deleted meanwhile is let go.
 *
 * ── Deleting ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Deleting a photo already uploaded is a request too, and it can be made with no signal, so it waits
 * here like an upload (`kind: "delete"`). A photo deleted before its picture ever left the phone is
 * simply dropped.
 *
 * ── Not lost to the browser ──────────────────────────────────────────────────────────────────────
 *
 * A browser short of space may clear a site's storage, which here would be photos that exist nowhere
 * else. The first photo kept asks the browser to keep Scrivn's storage (`navigator.storage.persist`),
 * and signing out with photos waiting asks first (components/SignOutButton.tsx).
 */

export interface PhotoFile {
  /** The photo's id — the same as its record in the claim. */
  id: string;
  claimId: string;
  /** Whose photo, so a shared phone never sends one person's pictures under another's sign-in. */
  user: string | null;
  kind: "upload" | "delete";
  full: Blob | null;
  thumb: Blob | null;
  addedAt: number;
  /** Which parts Scrivn already has. */
  sent: { thumb: boolean; full: boolean };
  /** Why Scrivn would not take it, until it is tried again. */
  refused: string | null;
}

/* ── Storage ────────────────────────────────────────────────────────────────────────────────────── */

const memory = new Map<string, PhotoFile>();

async function all(): Promise<PhotoFile[]> {
  if (deviceStorageWorks()) {
    try {
      return await transact<PhotoFile[]>(PHOTO_FILES, "readonly", (store, done) => {
        const req = store.getAll();
        req.onsuccess = () => done((req.result as PhotoFile[]) ?? []);
      });
    } catch {
      /* in memory, as lib/deviceClaims.ts falls back */
    }
  }
  return [...memory.values()];
}

async function put(file: PhotoFile): Promise<void> {
  memory.set(file.id, file);
  if (deviceStorageWorks()) {
    try {
      await transact<void>(PHOTO_FILES, "readwrite", (store) => void store.put(file));
      memory.delete(file.id);
    } catch {
      /* kept in memory for this page */
    }
  }
  deviceChanged();
}

async function drop(id: string): Promise<void> {
  memory.delete(id);
  if (deviceStorageWorks()) {
    try {
      await transact<void>(PHOTO_FILES, "readwrite", (store) => void store.delete(id));
    } catch {
      /* nothing kept there */
    }
  }
  deviceChanged();
}

function mine(file: PhotoFile, user = deviceUser()): boolean {
  return user !== undefined && (file.user === null || file.user === user);
}

let askedToKeep = false;

/** Ask once a page to keep Scrivn's storage through a shortage — see the file's note. Best effort. */
export function askToKeepStorage(): void {
  if (askedToKeep || typeof navigator === "undefined") return;
  askedToKeep = true;
  void navigator.storage?.persist?.().catch(() => false);
}

/* ── For the camera and the panel ───────────────────────────────────────────────────────────────── */

/** A photo just taken: kept here until it is uploaded. Resolves once it is safely written. */
export async function keepPhotoFile(claimId: string, id: string, full: Blob, thumb: Blob): Promise<void> {
  askToKeepStorage();
  await put({ id, claimId, user: deviceUser() ?? null, kind: "upload", full, thumb, addedAt: Date.now(), sent: { thumb: false, full: false }, refused: null });
}

/** The picture of a photo still on this phone, or null once uploaded (or taken on another phone). */
export async function photoFile(id: string): Promise<PhotoFile | null> {
  return (await all()).find((f) => f.id === id && f.kind === "upload" && mine(f)) ?? null;
}

/** Every picture of one claim still on this phone. */
export async function photoFilesOf(claimId: string): Promise<PhotoFile[]> {
  return (await all()).filter((f) => f.claimId === claimId && f.kind === "upload" && mine(f));
}

/** Pictures waiting to upload, this person's, oldest first. */
export async function waitingPhotoFiles(): Promise<PhotoFile[]> {
  return (await all()).filter((f) => f.kind === "upload" && mine(f)).sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * A photo deleted from its claim. Its picture goes from this phone; if any part of it ever reached
 * Scrivn, the copy there is deleted too — now, or when there is signal.
 */
export async function forgetPhotoFile(claimId: string, id: string): Promise<void> {
  const here = (await all()).find((f) => f.id === id);
  const reachedScrivn = !here || here.kind === "delete" || here.sent.thumb || here.sent.full;
  if (!reachedScrivn) return drop(id);
  await put({ id, claimId, user: here?.user ?? deviceUser() ?? null, kind: "delete", full: null, thumb: null, addedAt: Date.now(), sent: { thumb: false, full: false }, refused: null });
  void sendWaitingPhotos();
}

/** Try one Scrivn refused again. */
export async function retryPhotoFile(id: string): Promise<void> {
  const file = (await all()).find((f) => f.id === id);
  if (file) await put({ ...file, refused: null });
  void sendWaitingPhotos();
}

/** A claim deleted: everything of it waiting here goes too — Scrivn has already removed its pictures. */
export async function forgetClaimPhotoFiles(claimId: string): Promise<void> {
  for (const f of await all()) if (f.claimId === claimId) await drop(f.id);
}

/** Let go of a picture that will not upload — the record stays in the claim, without its picture. */
export function discardPhotoFile(id: string): Promise<void> {
  return drop(id);
}

/* ── Sending ────────────────────────────────────────────────────────────────────────────────────── */

export interface PhotoSendSummary {
  sent: number;
  waiting: number;
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body?.error === "string" ? body.error : `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

type Step = "done" | "wait-claim" | "stop" | "next";

/** Whether the claim still lists the photo — the device's copy of it is the only one to ask offline. */
async function photoStillInClaim(claimId: string, id: string): Promise<boolean | null> {
  const record = await readDeviceClaim(claimId);
  if (!record) return null;
  if (record.state.photos?.deleted?.some((d) => d.id === id)) return false;
  return true;
}

async function sendPart(file: PhotoFile, part: "thumb" | "full"): Promise<Step> {
  const blob = part === "thumb" ? file.thumb : file.full;
  if (!blob) return "next";
  let res: Response;
  try {
    res = await netFetch(`/api/claims/${file.claimId}/photos/${file.id}${part === "thumb" ? "?part=thumb" : ""}`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: blob,
      // A 2 MB picture on one bar takes a while; this only gives up on a dead line.
      timeoutMs: 120_000,
    });
  } catch (err) {
    if (isNetworkFailure(err)) return "stop";
    throw err;
  }
  if (res.ok) {
    await put({ ...file, sent: { ...file.sent, [part]: true } });
    return "done";
  }
  if (res.status === 401) return "stop";
  if (res.status === 404) return "wait-claim";
  if (res.status === 409) {
    // The claim does not list this photo yet (its save is behind), or no longer does.
    const listed = await photoStillInClaim(file.claimId, file.id);
    if (listed === false) {
      await drop(file.id);
      if (file.sent.thumb || file.sent.full) await forgetPhotoFile(file.claimId, file.id);
      return "next";
    }
    return "wait-claim";
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    await put({ ...file, refused: await errorText(res) });
    return "next";
  }
  return "next";
}

async function sendDelete(file: PhotoFile): Promise<Step> {
  let res: Response;
  try {
    res = await netFetch(`/api/claims/${file.claimId}/photos/${file.id}`, { method: "DELETE", timeoutMs: 30_000 });
  } catch (err) {
    if (isNetworkFailure(err)) return "stop";
    throw err;
  }
  // Gone, or the claim is gone with it: either way nothing of it is left to delete.
  if (res.ok || res.status === 404) {
    await drop(file.id);
    return "done";
  }
  if (res.status === 401) return "stop";
  return "next";
}

let running: Promise<PhotoSendSummary> | null = null;

/**
 * Send every picture waiting on this phone, and every deletion. Coalesced like `syncAll`: the header,
 * the page and the camera may all ask at once, and they share one run. Stops at the first sign of no
 * signal. A claim the server does not have yet (started offline, its first save still to land) is
 * passed over until it does.
 */
export function sendWaitingPhotos(): Promise<PhotoSendSummary> {
  if (running) return running;
  running = (async () => {
    let sent = 0;
    const user = deviceUser();
    const passOver = new Set<string>();
    const queue = (await all()).filter((f) => mine(f, user) && !f.refused).sort((a, b) => a.addedAt - b.addedAt);
    for (const queued of queue) {
      if (passOver.has(queued.claimId)) continue;
      const claim = await readDeviceClaim(queued.claimId);
      if (claim && !claim.created) {
        passOver.add(queued.claimId);
        continue;
      }
      // Re-read: deleted, sent or refused since the queue was taken.
      let file = (await all()).find((f) => f.id === queued.id);
      if (!file || file.refused) continue;

      if (file.kind === "delete") {
        const step = await sendDelete(file);
        if (step === "stop") break;
        continue;
      }

      let stop = false;
      for (const part of ["thumb", "full"] as const) {
        if (file.sent[part]) continue;
        const step = await sendPart(file, part);
        if (step === "stop") stop = true;
        if (step === "wait-claim") passOver.add(file.claimId);
        if (step !== "done") break;
        file = (await all()).find((f) => f.id === queued.id);
        if (!file) break;
      }
      if (stop) break;
      if (file && file.kind === "upload" && file.sent.thumb && file.sent.full) {
        await drop(file.id);
        sent += 1;
      }
    }
    const waiting = (await waitingPhotoFiles()).length;
    return { sent, waiting };
  })().finally(() => {
    running = null;
  });
  return running;
}
