"use client";

import { useEffect, useMemo, useState } from "react";
import "./photos.css";
import { onDeviceChange } from "@/lib/deviceClaims";
import { keepPhotoFile, photoFilesOf, sendWaitingPhotos } from "@/lib/devicePhotos";
import { connection } from "@/lib/connectivity";
import { addPhoto, captionPhoto, photoRoomKey, UNSORTED_ROOM, type ClaimPhotos } from "@/lib/photos";
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

  async function taken({ record, prepared }: TakenPhoto) {
    setPicked(record.room);
    // The picture on the phone first: from here on it survives the tab closing, signal or not.
    await keepPhotoFile(claimIdNow(), record.id, prepared.full, prepared.thumb);
    onChange((p) => addPhoto(p, record));
    onCheckpoint();
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
