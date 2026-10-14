"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { connection, isNetworkFailure, netFetch, onConnectionChange } from "@/lib/connectivity";
import { METER_PHOTO_MAX_PX, type MeterPhotoKind, type MeterPhotoReading, type MeterPhotoResponse } from "@/lib/meterPhoto";

/**
 * A camera button beside a reading (2026-10-14): one photo of the meter's screen, and the number is in
 * the field. The phone opens its camera straight away (`capture`); a computer opens a file picker.
 *
 * The photo is shrunk here before it goes anywhere (a phone photo is 3-5 MB, the meter's digits need
 * a fraction of that), sent once, and dropped. With no signal the camera does not open at all: the
 * tech would take a photo nobody can read, so it says to type the number instead.
 */
export function MeterPhotoButton({
  kind,
  tempUnit,
  label,
  onRead,
}: {
  kind: MeterPhotoKind;
  tempUnit: "F" | "C";
  /** What is being read, for the button's accessible name ("Kitchen wall"). */
  label: string;
  /** A usable answer. Called with what was read; `problem` set when only part of it was. */
  onRead: (reading: MeterPhotoReading) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const online = useSyncExternalStore(onConnectionChange, () => connection() === "online", () => true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "problem" } | null>(null);

  function open() {
    if (!online) {
      setMessage({ text: "Reading a photo needs signal. Type the number for now.", tone: "problem" });
      return;
    }
    setMessage(null);
    input.current?.click();
  }

  async function read(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const image = await shrinkToJpeg(file, METER_PHOTO_MAX_PX);
      const response = await netFetch("/api/drying/meter-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, kind, tempUnit }),
        timeoutMs: 40_000,
      });
      const body = (await response.json().catch(() => null)) as (MeterPhotoResponse & { error?: string }) | null;
      if (!response.ok || !body?.reading) {
        setMessage({ text: body?.error || "The photo could not be read just now. Type the number, or try again.", tone: "problem" });
        return;
      }
      const r = body.reading;
      const usable = kind === "moisture" ? r.value !== null : r.tempF !== null || r.rh !== null;
      if (!usable) {
        setMessage({ text: r.problem || "The screen could not be read. Try again closer, without glare.", tone: "problem" });
        return;
      }
      onRead(r);
      const notes: string[] = [];
      if (r.problem) notes.push(r.problem);
      if (kind === "air" && r.tempF !== null && r.tempUnitShown === null) notes.push(`No unit showed on the screen, so the temperature was taken as °${tempUnit}.`);
      setMessage(notes.length > 0 ? { text: notes.join(" "), tone: r.problem ? "problem" : "info" } : null);
    } catch (err) {
      setMessage({
        text: isNetworkFailure(err) ? "No signal reached Scrivn. Type the number, or try the photo again with signal." : err instanceof Error ? err.message : "The photo could not be read.",
        tone: "problem",
      });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <button
        type="button"
        className="dlog-photo-btn"
        onClick={open}
        disabled={busy}
        aria-label={`Read ${label} from a photo of the meter`}
        aria-busy={busy}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M9 4.5 7.6 6.5H5A2.5 2.5 0 0 0 2.5 9v8.5A2.5 2.5 0 0 0 5 20h14a2.5 2.5 0 0 0 2.5-2.5V9A2.5 2.5 0 0 0 19 6.5h-2.6L15 4.5H9Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        <span>{busy ? "Reading…" : "Photo"}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
        }}
      />
      {message && (
        <span className={`dlog-photo-msg${message.tone === "problem" ? " problem" : ""}`} role="status">
          {message.text}
        </span>
      )}
    </>
  );
}

/**
 * A photo as a JPEG no larger than [maxPx] on its longest side, base64 with no data: prefix.
 * `createImageBitmap` honours the photo's orientation; an <img> is the fallback for a browser that
 * cannot decode the file that way (some HEIC photos on iPhones).
 */
async function shrinkToJpeg(file: File, maxPx: number): Promise<string> {
  let source: ImageBitmap | HTMLImageElement;
  let release = () => {};
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    release = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(file);
    release = () => URL.revokeObjectURL(url);
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("This photo could not be opened. Try taking it again."));
      };
      img.src = url;
    });
  }
  try {
    const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!w || !h) throw new Error("This photo could not be opened. Try taking it again.");
    const scale = Math.min(1, maxPx / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot read the photo.");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85).replace(/^data:image\/jpeg;base64,/, "");
  } finally {
    release();
  }
}
