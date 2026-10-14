/**
 * A photo taken with no signal, in a real browser: the camera, the caption heard, the picture kept
 * on the phone, and — when the signal comes back — the claim saved, the picture uploaded and let go
 * from the phone's store. Against real IndexedDB, a real canvas and the real React components, with
 * two things stood in for: the camera (a canvas's own video stream, which is a real MediaStream) and
 * the speech recognizer (a scripted one that "hears" a sentence, because the test cannot talk).
 */

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PhotosSection, type PhotosView } from "@/components/photos/PhotosSection";
import { useClaimPersistence, type ClaimPersistence } from "@/lib/useClaimPersistence";
import { emptySavedClaimState, parseSavedClaimState, type SavedClaimState } from "@/lib/claimState";
import { syncAll } from "@/lib/claimSync";
import { onReconnect } from "@/lib/connectivity";
import { sendWaitingPhotos, waitingPhotoFiles } from "@/lib/devicePhotos";
import { preparePhoto } from "@/lib/photoImage";
import { pdfPhotosFor } from "@/lib/photoPdf";
import { useDeviceWork } from "@/lib/useDeviceWork";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

document.body.insertAdjacentHTML("afterbegin", '<span hidden data-scrivn-user="user-a"></span>');

/* ── the scripted server ──────────────────────────────────────────────────────────────────────── */

let mode: "offline" | "online" = "offline";
const requests: { path: string; method: string }[] = [];
const claims = new Map<string, { state: SavedClaimState; version: string }>();
const files = new Map<string, Blob>();
let tick = 0;
const nextVersion = () => `2026-10-14T12:00:00.${String(++tick).padStart(6, "0")}+00:00`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const path = url.split("?")[0]!;
  if (!path.startsWith("/api/claims") && !path.startsWith("/manifest")) return realFetch(input as RequestInfo, init);
  const method = init?.method ?? "GET";
  requests.push({ path, method });
  if (mode === "offline") throw new TypeError("Failed to fetch");
  if (path.startsWith("/manifest")) return json(200, {});
  const photo = /^\/api\/claims\/([^/]+)\/photos\/([^/]+)$/.exec(path);
  if (photo) {
    const row = claims.get(photo[1]!);
    if (!row) return json(404, { error: "Claim not found." });
    if (!row.state.photos.items.some((p) => p.id === photo[2])) return json(409, { error: "not listed", code: "not-in-claim" });
    files.set(`${photo[2]}:${url.includes("part=thumb") ? "thumb" : "full"}`, init?.body as Blob);
    return json(200, { ok: true });
  }
  if (/^\/api\/claims\/[^/]+\/photos$/.test(path)) return json(200, { photos: [] });
  const body = init?.body ? JSON.parse(String(init.body)) : null;
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

/* ── the camera and the speech, stood in for ──────────────────────────────────────────────────── */

const scene = document.createElement("canvas");
scene.width = 1600;
scene.height = 1200;
const paint = () => {
  const ctx = scene.getContext("2d")!;
  ctx.fillStyle = "#c9b28a";
  ctx.fillRect(0, 0, scene.width, scene.height);
  ctx.fillStyle = "#6e4a2a";
  ctx.fillRect(0, 980, scene.width, 220);
  ctx.fillStyle = "#2d5b8a";
  ctx.font = "120px sans-serif";
  ctx.fillText("vanity", 520, 600);
};
paint();
const fakeStream = (scene as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(10);
setInterval(paint, 100);
Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => fakeStream }, configurable: true });

/** What the scripted recognizer "hears", one script per photo: the first session after it is queued takes it. */
const speech: string[][] = [["Baseboard wet", "Baseboard wet behind the vanity about four feet"]];
class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  private stopped = false;
  start() {
    const script = speech.shift() ?? [];
    const [interim, final] = script;
    if (interim) setTimeout(() => !this.stopped && this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: interim } }] }), 150);
    if (final) setTimeout(() => !this.stopped && this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: final } }] }), 400);
    // Android ends a session on a pause; the hook starts another while it still wants to listen.
    setTimeout(() => !this.stopped && this.end(), 600);
  }
  private end() {
    if (this.stopped) return;
    this.stopped = true;
    setTimeout(() => this.onend?.(), 10);
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }
}
(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;

/* ── the harness ──────────────────────────────────────────────────────────────────────────────── */

const SKETCH = {
  rooms: [
    { id: "bath", name: "Bathroom", vertices: [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 96 }], ceilingHeightFeet: 8, ceilingType: "FLAT" },
    { id: "kitchen", name: "Kitchen", vertices: [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 96 }], ceilingHeightFeet: 8, ceilingType: "FLAT" },
  ],
} as unknown as SavedClaimState["sketch"];

type Handle = ClaimPersistence & { state: SavedClaimState; view: PhotosView; photosWaiting: number };
let handle: Handle | null = null;

function Harness() {
  const [state, setState] = useState<SavedClaimState>(() => {
    const s = emptySavedClaimState();
    return { ...s, claim: { ...s.claim, customerName: "Bell" }, sketch: SKETCH };
  });
  const [view, setView] = useState<PhotosView>("closed");
  const persistence = useClaimPersistence({ state, apply: setState, applyPhotos: (photos) => setState((s) => ({ ...s, photos })), enabled: true });
  const work = useDeviceWork();
  const persistenceRef = useRef(persistence);
  persistenceRef.current = persistence;
  const latest = useRef<Handle | null>(null);
  latest.current = { ...persistence, state, view, photosWaiting: work.photos.reduce((n, p) => n + p.count, 0) };
  handle = latest.current;
  useEffect(() => {
    handle = latest.current;
  });
  // As the header does: when the signal is back, the claims first, then the pictures.
  useEffect(() => onReconnect(() => void syncAll().then(() => sendWaitingPhotos())), []);
  // As the claim page does: each save that lands sends what is waiting.
  useEffect(() => {
    if (persistence.status === "saved" && state.photos.items.length > 0) void sendWaitingPhotos();
  }, [persistence.status, state.photos]);
  return (
    <PhotosSection
      photos={state.photos}
      onChange={(change) => setState((s) => ({ ...s, photos: change(s.photos) }))}
      sketch={state.sketch}
      claimId={persistence.claimId}
      claimIdNow={persistence.claimIdNow}
      onServer={persistence.onServer}
      view={view}
      onViewChange={setView}
      onCheckpoint={() => setTimeout(() => void persistenceRef.current.saveNow(), 0)}
    />
  );
}

const settle = () => new Promise((r) => setTimeout(r, 120));
async function until(predicate: () => boolean | Promise<boolean>, what: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await settle();
  }
  throw new Error(`timed out waiting for ${what}`);
}
const button = (text: string) => {
  const all = [...document.querySelectorAll("button")];
  return (all.find((b) => b.getAttribute("aria-label") === text) ?? all.find((b) => (b.textContent ?? "").trim() === text) ?? all.find((b) => (b.textContent ?? "").trim().startsWith(text))) as HTMLButtonElement | undefined;
};
const photoStore = (): Promise<{ id: string; full: Blob | null }[]> =>
  new Promise((resolve) => {
    const open = indexedDB.open("scrivn");
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("photoFiles")) {
        db.close();
        resolve([]);
        return;
      }
      const req = db.transaction("photoFiles", "readonly").objectStore("photoFiles").getAll();
      req.onsuccess = () => {
        resolve(req.result ?? []);
        db.close();
      };
    };
    open.onerror = () => resolve([]);
  });

async function run() {
  window.history.replaceState(null, "", window.location.pathname);
  const root: Root = createRoot(document.getElementById("harness")!);
  root.render(<Harness />);
  await until(() => handle !== null && !handle.loading, "the page to load");
  const h = () => handle!;

  /* A — the size a photo is kept at, from a phone-sized frame. */
  const big = document.createElement("canvas");
  big.width = 4032;
  big.height = 3024;
  const bctx = big.getContext("2d")!;
  const noise = bctx.createImageData(big.width, 1);
  for (let y = 0; y < big.height; y += 1) {
    for (let i = 0; i < noise.data.length; i += 4) {
      noise.data[i] = (i * 7 + y * 13) % 255;
      noise.data[i + 1] = (Math.random() * 255) | 0;
      noise.data[i + 2] = (y * 3) % 255;
      noise.data[i + 3] = 255;
    }
    bctx.putImageData(noise, 0, y);
  }
  const prepared = await preparePhoto(big);
  check("a 12-megapixel frame is kept at 2,000 px on its long side", prepared.width === 2000 && prepared.height === 1500, `${prepared.width}×${prepared.height}`);
  check("under the 2 MB limit, even a scene that compresses badly", prepared.full.size < 2 * 1024 * 1024, `${Math.round(prepared.full.size / 1024)} KB`);
  const thumbBitmap = await createImageBitmap(prepared.thumb);
  check("with a thumbnail of a few hundred pixels", Math.max(thumbBitmap.width, thumbBitmap.height) === 360, `${thumbBitmap.width}×${thumbBitmap.height}`);

  /* B — offline: open the camera, take a photo, hear its caption. */
  button("Photos")!.click();
  await until(() => !!document.querySelector(".pcam") && !(button("Take photo")?.disabled ?? true), "the camera to be live");
  check("the camera opens full screen with the rooms as chips and the room's name large", document.querySelector(".pcam-room")?.textContent === "Bathroom", document.querySelector(".pcam-room")?.textContent ?? "");
  button("Take photo")!.click();
  await until(() => h().state.photos.items.length === 1, "the photo to be in the claim");
  await until(() => !!document.querySelector(".pcam-listening"), "the Listening bar to open by itself");
  check("after the shutter, the Listening bar opens without a tap", !!document.querySelector(".pcam-listening"));
  await until(() => h().state.photos.items[0]?.caption === "Baseboard wet behind the vanity about four feet", "the caption to be heard");
  check("what is said becomes the caption, marked as spoken", h().state.photos.items[0]?.captionBy === "voice", h().state.photos.items[0]?.captionBy ?? "");
  await until(() => !document.querySelector(".pcam-listening"), "quiet to end the listening", 6000);
  check("about two seconds of quiet ends it on its own", !document.querySelector(".pcam-listening"));
  check("the photo is filed to the room picked", h().state.photos.items[0]?.room === "bath", h().state.photos.items[0]?.room);
  const kept = await photoStore();
  check("its picture is kept on the phone", kept.length === 1 && (kept[0]?.full?.size ?? 0) > 1000, `${kept.length} kept`);
  check("nothing has reached the server with no signal", files.size === 0 && claims.size === 0, `${files.size} pictures, ${claims.size} claims`);

  /* C — Done: the panel, saying what waits. */
  button("Done")!.click();
  await until(() => !!document.querySelector(".photos-summary"), "the Photos panel");
  await until(() => (document.querySelector(".photos-summary")?.textContent ?? "").includes("1 photo waiting to upload"), "the waiting count in the panel");
  check("the panel lists it by room, with the waiting count", (document.querySelector(".photos-room h3")?.textContent ?? "").startsWith("Bathroom"), document.querySelector(".photos-summary")?.textContent ?? "");
  await until(() => h().photosWaiting === 1, "the header's count");
  check("the header counts it as waiting", h().photosWaiting === 1, String(h().photosWaiting));
  await until(() => h().status === "pending", "the claim to be saved on the phone");

  /* D — the report, with no signal: from the phone's own copy. */
  const offlinePdf = await pdfPhotosFor(h().claimId, h().state.photos, h().state.sketch);
  check("the report's photo pages can be made with no signal, from the phone's copy", offlinePdf.photos.length === 1 && offlinePdf.missing === 0, JSON.stringify({ n: offlinePdf.photos.length, missing: offlinePdf.missing }));
  check("at 1,200 px for the PDF", offlinePdf.photos[0]?.width === 1200, String(offlinePdf.photos[0]?.width));

  /* E — the signal comes back: the claim first, then the picture, then gone from the phone. */
  mode = "online";
  window.dispatchEvent(new Event("online"));
  await until(async () => (await photoStore()).length === 0, "the picture to upload and leave the phone", 15000);
  const id = h().claimId!;
  check("the claim reached the server with the photo's record", claims.get(id)?.state.photos.items[0]?.caption === "Baseboard wet behind the vanity about four feet");
  const photoId = h().state.photos.items[0]!.id;
  const full = files.get(`${photoId}:full`);
  const thumb = files.get(`${photoId}:thumb`);
  check("its picture and thumbnail were uploaded", !!full && !!thumb, `${full?.size} / ${thumb?.size}`);
  const fullHead = full ? new Uint8Array(await full.slice(0, 3).arrayBuffer()) : new Uint8Array();
  check("as a JPEG", fullHead[0] === 0xff && fullHead[1] === 0xd8 && fullHead[2] === 0xff);
  const order = requests.filter((r) => r.method !== "GET" && r.path.startsWith("/api/claims")).map((r) => (r.path.includes("/photos/") ? "photo" : "claim"));
  check("the claim was saved before any picture went", order.indexOf("claim") < order.indexOf("photo"), order.join(","));
  await until(() => h().photosWaiting === 0, "the header's count to clear");
  check("and the waiting count is gone", (await waitingPhotoFiles()).length === 0 && h().photosWaiting === 0);

  /* F — with no signal again, a photo only on Scrivn cannot go in the report, and is counted. */
  mode = "offline";
  const missing = await pdfPhotosFor(id, { ...h().state.photos, items: h().state.photos.items.map((p) => ({ ...p, id: "00000000-0000-4000-8000-0000000000ff" })) }, h().state.sketch);
  check("a photo on Scrivn with no signal here is left out and counted", missing.photos.length === 0 && missing.missing === 1, JSON.stringify(missing));

  /* G — the next room, and words the recognizer never made final: kept all the same. */
  speech.push(["Cabinet floor under the sink is swollen"]);
  button("Take photos")!.click();
  await until(() => !!document.querySelector(".pcam") && !(button("Take photo")?.disabled ?? true), "the camera again");
  check("the camera opens on the room last used", document.querySelector(".pcam-room")?.textContent === "Bathroom", document.querySelector(".pcam-room")?.textContent ?? "");
  [...document.querySelectorAll(".pcam-chips button")].find((b) => b.textContent === "Kitchen")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await until(() => document.querySelector(".pcam-room")?.textContent === "Kitchen", "the Kitchen chip");
  button("Take photo")!.click();
  await until(() => h().state.photos.items.length === 2, "the second photo");
  await until(() => !document.querySelector(".pcam-listening") && (h().state.photos.items[1]?.caption ?? "") !== "", "the second caption", 8000);
  check("words heard but never made final are still the caption", h().state.photos.items[1]?.caption === "Cabinet floor under the sink is swollen", h().state.photos.items[1]?.caption);
  check("and the photo is in the room the chip was changed to", h().state.photos.items[1]?.room === "kitchen", h().state.photos.items[1]?.room);
  button("Done")!.click();
  root.unmount();
}

void (async () => {
  await new Promise<void>((resolve) => {
    const del = indexedDB.deleteDatabase("scrivn");
    del.onsuccess = del.onerror = del.onblocked = () => resolve();
  });
  try {
    await run();
  } catch (err) {
    check("the run completed", false, err instanceof Error ? err.message : String(err));
  }
  const del = indexedDB.deleteDatabase("scrivn");
  del.onsuccess = del.onerror = () => {};
  const failed = results.filter((r) => !r.ok);
  document.getElementById("results")!.innerHTML = results
    .map((r) => `<div class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — <i>${r.detail}</i>` : ""}</div>`)
    .join("");
  document.getElementById("summary")!.textContent = `${results.length - failed.length} passed, ${failed.length} failed`;
  (window as unknown as { __photoTests: unknown }).__photoTests = { done: true, passed: results.length - failed.length, failed: failed.length, results };
})();
