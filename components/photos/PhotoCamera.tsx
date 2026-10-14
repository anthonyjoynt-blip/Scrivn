"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomChips } from "@/components/RoomChips";
import { preparePhoto, type PreparedPhoto } from "@/lib/photoImage";
import { MAX_CLAIM_PHOTOS, photoRoomOptions, roomNameFor, type CaptionBy, type ClaimPhoto } from "@/lib/photos";
import type { Sketch } from "@/lib/sketch";
import { appendDictation, useDictation } from "@/lib/useDictation";

/**
 * The camera, full screen, in the claim (2026-10-14). Point, tap, talk, next.
 *
 *   * Room chips along the top, with the last room still picked and its name shown large — the
 *     common slip is forgetting to change room, and a name that size is hard to miss.
 *   * Tap the shutter: the photo drops to a thumbnail and a Listening bar opens by itself. What is
 *     said appears under it as it is heard; about two seconds of quiet saves it as the caption.
 *     Saying nothing saves the photo with no caption. Taking the next photo saves what was heard.
 *   * Tap the words to fix them by typing.
 *
 * Nothing recorded but text: speech is the browser's own (lib/useDictation.ts), and Scrivn gets the
 * words. The photo is kept on the phone the moment it is taken (lib/devicePhotos.ts) and uploads on
 * its own, so none of this needs signal except, on some phones, the speech — and then the caption
 * box is there to type in.
 */

export interface TakenPhoto {
  record: ClaimPhoto;
  prepared: PreparedPhoto;
}

interface Shot {
  id: string;
  thumb: string;
  caption: string;
}

/** A shot's caption ends after this much quiet, or this long with nothing said at all. */
const QUIET_MS = 2000;
const NOTHING_SAID_MS = 7000;

type ImageCaptureLike = { takePhoto: () => Promise<Blob> };

function newPhotoId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function PhotoCamera({
  sketch,
  photoCount,
  room,
  onRoomChange,
  onTaken,
  onCaption,
  onDone,
}: {
  sketch: Sketch;
  /** How many photos the claim has, for the limit. */
  photoCount: number;
  room: string;
  onRoomChange: (room: string) => void;
  /** Keep the photo — its picture on the phone, its record in the claim. Resolves once it is safe. */
  onTaken: (photo: TakenPhoto) => Promise<void>;
  onCaption: (id: string, caption: string, by: CaptionBy) => void;
  onDone: () => void;
}) {
  const options = useMemo(() => photoRoomOptions(sketch), [sketch]);
  const roomLabel = options.find((o) => o.value === room)?.label ?? "Unsorted";

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const capture = useRef<ImageCaptureLike | null>(null);
  const [camera, setCamera] = useState<"starting" | "live" | "failed">("starting");
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [listeningFor, setListeningFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const listening = useRef<string | null>(null);
  const finals = useRef(new Map<string, string>());
  const onCaptionRef = useRef(onCaption);
  onCaptionRef.current = onCaption;

  const setShotCaption = (id: string, caption: string) => setShots((prev) => prev.map((s) => (s.id === id ? { ...s, caption } : s)));

  const dictation = useDictation({
    endAfterQuietMs: QUIET_MS,
    giveUpAfterMs: NOTHING_SAID_MS,
    onFinal: (text) => {
      const id = listening.current;
      if (!id) return;
      const next = appendDictation(finals.current.get(id) ?? "", text);
      finals.current.set(id, next);
      setShotCaption(id, next);
      onCaptionRef.current(id, next, "voice");
    },
    onEnd: () => {
      listening.current = null;
      setListeningFor(null);
    },
  });
  const interim = useRef("");
  interim.current = dictation.interim;

  /** The caption being spoken, saved with whatever was heard so far, and the microphone let go. */
  const finishListening = useCallback(async () => {
    const id = listening.current;
    if (!id) return;
    const heard = interim.current.trim();
    if (heard) {
      const next = appendDictation(finals.current.get(id) ?? "", heard);
      finals.current.set(id, next);
      setShotCaption(id, next);
      onCaptionRef.current(id, next, "voice");
    }
    listening.current = null;
    setListeningFor(null);
    await dictation.abort();
  }, [dictation]);

  // The camera: the back one, at a size worth keeping. Let go when the screen closes.
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera("failed");
        setCameraNote("This browser cannot show the camera here. Use the phone's camera instead, below.");
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (!alive) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        const track = s.getVideoTracks()[0];
        const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
        // Full-size stills where Chrome offers them, rather than a frame of the preview.
        if (IC && track) {
          try {
            capture.current = new IC(track);
          } catch {
            capture.current = null;
          }
        }
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setCamera("live");
      } catch (err) {
        setCamera("failed");
        const name = err instanceof DOMException ? err.name : "";
        setCameraNote(
          name === "NotAllowedError"
            ? "The camera is blocked for Scrivn. Allow it in the browser's site settings, or use the phone's camera instead, below."
            : "The camera would not start here. Use the phone's camera instead, below.",
        );
      }
    })();
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, []);

  // Thumbnails made for this screen are let go with it.
  const thumbs = useRef<string[]>([]);
  useEffect(() => () => thumbs.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const full = photoCount >= MAX_CLAIM_PHOTOS;

  async function frame(): Promise<Blob | HTMLCanvasElement> {
    if (capture.current) {
      try {
        // Some cameras never answer a still request; the preview frame is a better answer than waiting.
        return await Promise.race([
          capture.current.takePhoto(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("still timed out")), 4000)),
        ]);
      } catch {
        // Not again on this screen: a camera that failed once will make every shot wait.
        capture.current = null;
      }
    }
    const v = video.current;
    // A stream that has not delivered a real frame yet reports a size of a pixel or two.
    if (!v || v.videoWidth < 320 || v.videoHeight < 240) throw new Error("The camera has no picture yet — try again in a moment.");
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    return canvas;
  }

  /** One photo kept and filed, then listened to for its caption. */
  async function keep(source: () => Promise<Blob | HTMLCanvasElement>) {
    if (busy || full) return;
    setBusy(true);
    setProblem(null);
    const takenAt = Date.now();
    try {
      await finishListening();
      setEditing(null);
      const prepared = await preparePhoto(await source());
      const id = newPhotoId();
      const record: ClaimPhoto = {
        id,
        room,
        roomName: roomNameFor(room, sketch),
        takenAt,
        caption: "",
        captionBy: null,
        width: prepared.width,
        height: prepared.height,
        source: "camera",
        editedAt: takenAt,
      };
      await onTaken({ record, prepared });
      const thumb = URL.createObjectURL(prepared.thumb);
      thumbs.current.push(thumb);
      setShots((prev) => [...prev, { id, thumb, caption: "" }]);
      if (dictation.supported) {
        finals.current.set(id, "");
        listening.current = id;
        setListeningFor(id);
        void dictation.start();
      }
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The photo could not be kept.");
    } finally {
      setBusy(false);
    }
  }

  async function startTyping(id: string) {
    await finishListening();
    setEditing(id);
    setDraft(shots.find((s) => s.id === id)?.caption ?? "");
  }

  function saveTyping() {
    if (!editing) return;
    finals.current.set(editing, draft);
    setShotCaption(editing, draft);
    onCaption(editing, draft, "typed");
    setEditing(null);
  }

  async function done() {
    if (editing) saveTyping();
    await finishListening();
    stream.current?.getTracks().forEach((t) => t.stop());
    onDone();
  }

  const last = shots[shots.length - 1] ?? null;
  const lastListening = last !== null && listeningFor === last.id;

  return (
    <div className="pcam" role="dialog" aria-modal="true" aria-label="Camera">
      <div className="pcam-top">
        <RoomChips className="pcam-chips" ariaLabel="Room for the next photo" options={options} value={room} onChange={onRoomChange} />
        <div className="pcam-room" aria-live="polite">
          {roomLabel}
        </div>
      </div>

      <div className="pcam-view">
        <video ref={video} className="pcam-video" playsInline muted autoPlay />
        {camera !== "live" && (
          <div className="pcam-fallback">
            {camera === "starting" ? <p>Starting the camera…</p> : <p>{cameraNote}</p>}
            {camera === "failed" && (
              <button type="button" className="btn-primary" onClick={() => fileInput.current?.click()} disabled={busy || full}>
                Use the phone&rsquo;s camera
              </button>
            )}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void keep(async () => file);
          }}
        />
      </div>

      <div className="pcam-bottom">
        {(problem || full) && <p className="pcam-problem">{full ? `This claim has ${MAX_CLAIM_PHOTOS} photos, the most one claim can hold.` : problem}</p>}
        {last && (
          <div className="pcam-last">
            <img src={last.thumb} alt="" className="pcam-thumb" />
            <div className="pcam-words">
              {editing === last.id ? (
                <div className="pcam-edit">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={3} placeholder="Type the caption" aria-label="Caption" />
                  <button type="button" className="btn-primary" onClick={saveTyping}>
                    Save
                  </button>
                </div>
              ) : (
                <button type="button" className="pcam-caption" onClick={() => void startTyping(last.id)}>
                  {lastListening && (
                    <span className="pcam-listening">
                      <span className="pcam-dot" aria-hidden="true" /> {dictation.status === "preparing" ? "Getting speech ready…" : "Listening"}
                    </span>
                  )}
                  <span className="pcam-text">
                    {[last.caption, lastListening ? dictation.interim : ""].filter(Boolean).join(" ") ||
                      (lastListening ? "Say what the photo shows…" : dictation.supported ? "No caption — tap to type one" : "Tap to type a caption")}
                  </span>
                </button>
              )}
              {dictation.note && <span className="pcam-note">{dictation.note}</span>}
            </div>
          </div>
        )}
        <div className="pcam-controls">
          <span className="pcam-count">
            {shots.length === 0 ? "" : `${shots.length} photo${shots.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            className="pcam-shutter"
            aria-label="Take photo"
            onClick={() => void keep(frame)}
            disabled={busy || full || camera !== "live"}
          >
            <span />
          </button>
          <button type="button" className="pcam-done" onClick={() => void done()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
