"use client";

import { useEffect, useMemo, useState } from "react";
import "./photos.css";
import { onDeviceChange } from "@/lib/deviceClaims";
import { keepPhotoFile, photoFilesOf, sendWaitingPhotos } from "@/lib/devicePhotos";
import { connection } from "@/lib/connectivity";
import { exifTakenAt } from "@/lib/exifTime";
import { preparePhoto } from "@/lib/photoImage";
import { addPhoto, captionPhoto, MAX_CLAIM_PHOTOS, movePhoto, photoRoomKey, roomNameFor, UNSORTED_ROOM, type ClaimPhoto, type ClaimPhotos } from "@/lib/photos";
import type { Sketch } from "@/lib/sketch";
import { PhotoCamera, type TakenPhoto } from "./PhotoCamera";
import { PhotosPanel, type PhotosChange } from "./PhotosPanel";

/**
 * Photos on the claim (2026-10-14): a Photos button beside the sketch's and the drying log's, which
 * opens the camera; the Photos panel, by room, once there are some. Not a step the claim passes
 * through — a claim with no photos is a complete claim.
 */

export type PhotosView = "closed" | "panel" | "camera";

/** How many of this claim's pictures are still on this phone, kept current. */
function useWaitingCount(claimId: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!claimId) {
      setCount(0);
      return;
    }
    let alive = true;
    const read = () => void photoFilesOf(claimId).then((files) => alive && setCount(files.length));
    read();
    const off = onDeviceChange(read);
    return () => {
      alive = false;
      off();
    };
  }, [claimId]);
  return count;
}

export function PhotosSection({
  photos,
  onChange,
  sketch,
  claimId,
  claimIdNow,
  onServer,
  view,
  onViewChange,
  onCheckpoint,
}: {
  photos: ClaimPhotos;
  onChange: PhotosChange;
  sketch: Sketch;
  /** The claim's id, or null before it has one. */
  claimId: string | null;
  /** The claim's id, given one now if it has none — a photo is stored under it the moment it is taken. */
  claimIdNow: () => string;
  onServer: boolean;
  view: PhotosView;
  onViewChange: (view: PhotosView) => void;
  /** Save the claim now, rather than on the timer. */
  onCheckpoint: () => void;
}) {
  const waiting = useWaitingCount(claimId);
  /*
    The room the next photo goes to: the last one picked, kept while the claim is open. Until one is
    picked, the room of the newest photo, so coming back to the camera carries on where it left off.
    A room deleted from the sketch since is Unsorted.
  */
  const [picked, setPicked] = useState<string | null>(null);
  const room = useMemo(() => {
    if (picked !== null) return photoRoomKey({ room: picked }, sketch);
    const newest = [...photos.items].sort((a, b) => a.takenAt - b.takenAt).pop();
    return newest ? photoRoomKey(newest, sketch) : (sketch.rooms[0]?.id ?? UNSORTED_ROOM);
  }, [picked, photos.items, sketch]);

  async function taken({ record, prepared }: TakenPhoto): Promise<{ durable: boolean }> {
    // The picture on the phone first: from here on it survives the tab closing, signal or not.
    const kept = await keepPhotoFile(claimIdNow(), record.id, prepared.full, prepared.thumb);
    onChange((p) => addPhoto(p, record));
    onCheckpoint();
    return kept;
  }

  /**
   * Photos already on the phone, from its gallery (stage 3): each kept and filed like one just taken,
   * with the time the camera took it (lib/exifTime.ts) rather than the time it was picked — and,
   * failing that, the file's own date. No listening: several at once have nothing to caption them by.
   */
  async function addFromGallery(files: File[], room: string) {
    const filedTo = photoRoomKey({ room }, sketch);
    let spaceLeft = MAX_CLAIM_PHOTOS - photos.items.length;
    let notStored = 0;
    for (const file of files) {
      if (spaceLeft <= 0) throw new Error(`This claim has ${MAX_CLAIM_PHOTOS} photos, the most one claim can hold.`);
      const head = await file.slice(0, 256 * 1024).arrayBuffer();
      const takenAt = exifTakenAt(head) ?? (file.lastModified || Date.now());
      const prepared = await preparePhoto(file);
      const now = Date.now();
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      const record: ClaimPhoto = {
        id,
        room: filedTo,
        roomName: roomNameFor(filedTo, sketch),
        takenAt,
        caption: "",
        captionBy: null,
        width: prepared.width,
        height: prepared.height,
        source: "gallery",
        editedAt: now,
      };
      const kept = await taken({ record, prepared });
      if (!kept.durable) notStored += 1;
      spaceLeft -= 1;
    }
    if (notStored > 0) {
      throw new Error(`This phone would not store ${notStored === 1 ? "that photo" : `${notStored} of them`} — its storage may be full. ${notStored === 1 ? "It is" : "They are"} kept while Scrivn stays open and upload when there is signal.`);
    }
    if (connection() === "online") void sendWaitingPhotos();
  }

  const count = photos.items.length;

  return (
    <>
      {view === "panel" || view === "camera" ? (
        <PhotosPanel
          claimId={claimId}
          onServer={onServer}
          photos={photos}
          sketch={sketch}
          onChange={onChange}
          onOpenCamera={() => onViewChange("camera")}
          onGallery={(files) => addFromGallery(files, UNSORTED_ROOM)}
          onClose={() => {
            onViewChange("closed");
            onCheckpoint();
          }}
        />
      ) : (
        <div className="photos-launch">
          <button type="button" className="btn-secondary" onClick={() => onViewChange("camera")}>
            Photos
          </button>
          {count > 0 ? (
            <button type="button" className="link-button" onClick={() => onViewChange("panel")}>
              {count} photo{count === 1 ? "" : "s"} by room
              {waiting > 0 ? ` · ${waiting} waiting to upload` : ""}
            </button>
          ) : (
            <span className="field-note">Optional — take photos and say what each shows; they are filed by room.</span>
          )}
        </div>
      )}
      {view === "camera" && (
        <PhotoCamera
          sketch={sketch}
          photoCount={count}
          room={room}
          onRoomChange={setPicked}
          onTaken={taken}
          onCaption={(id, caption, by) => onChange((p) => captionPhoto(p, id, caption, by))}
          onMove={(id, to, name) => onChange((p) => movePhoto(p, id, to, name))}
          onGallery={addFromGallery}
          onDone={() => {
            onViewChange("panel");
            onCheckpoint();
            if (connection() === "online") void sendWaitingPhotos();
          }}
        />
      )}
    </>
  );
}
