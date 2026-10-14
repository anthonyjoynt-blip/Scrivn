"use client";

import { useEffect, useMemo, useState } from "react";
import { discardPhotoFile, forgetPhotoFile, retryPhotoFile } from "@/lib/devicePhotos";
import { photoWhen } from "@/lib/photoPdf";
import {
  captioned,
  captionPhoto,
  deletePhoto,
  movePhoto,
  photoRoomKey,
  photoRoomOptions,
  photosByRoom,
  roomNameFor,
  UNSORTED_ROOM,
  type ClaimPhoto,
  type ClaimPhotos,
} from "@/lib/photos";
import type { Sketch } from "@/lib/sketch";
import { usePhotoImages, type PhotoImage } from "./usePhotoImages";

/**
 * The claim's photos, by room (2026-10-14): each with its time and caption, to fix a caption, move a
 * photo to another room, or delete it. Unsorted first when there is any — photos taken before the
 * sketch existed land there, and filing them is the job left to do.
 *
 * A photo with no caption is kept and shown, marked as not printing: the Initial Site Report prints
 * captioned photos only (the owner's choice), which is also what keeps it small enough to email.
 */

export type PhotosChange = (change: (photos: ClaimPhotos) => ClaimPhotos) => void;

export function PhotosPanel({
  claimId,
  onServer,
  photos,
  sketch,
  onChange,
  onOpenCamera,
  onClose,
}: {
  claimId: string | null;
  onServer: boolean;
  photos: ClaimPhotos;
  sketch: Sketch;
  onChange: PhotosChange;
  onOpenCamera: () => void;
  onClose: () => void;
}) {
  const { images, waiting } = usePhotoImages(claimId, onServer);
  const groups = useMemo(() => {
    const all = photosByRoom(photos, sketch);
    // Unsorted to the top: it is the work still to do.
    return [...all.filter((g) => g.key === UNSORTED_ROOM), ...all.filter((g) => g.key !== UNSORTED_ROOM)];
  }, [photos, sketch]);
  const options = useMemo(() => photoRoomOptions(sketch), [sketch]);
  const printing = photos.items.filter(captioned).length;
  const [enlarged, setEnlarged] = useState<ClaimPhoto | null>(null);
  const refused = waiting.filter((f) => f.refused).length;

  return (
    <section className="photos" aria-label="Photos">
      <div className="photos-head">
        <h2>Photos</h2>
        <div className="photos-head-actions">
          <button type="button" className="btn-primary" onClick={onOpenCamera}>
            Take photos
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <p className="photos-summary">
        {photos.items.length === 0
          ? "No photos yet. Take photos tells you the room as you go; say what each one shows and it becomes the caption."
          : `${photos.items.length} photo${photos.items.length === 1 ? "" : "s"} · ${printing} with a caption, printed in the Initial Site Report`}
        {waiting.length > 0 && (
          <span className="photos-waiting">
            {" "}
            · {waiting.length} photo{waiting.length === 1 ? "" : "s"} waiting to upload
            {refused > 0 ? ` (${refused} refused)` : ""}
          </span>
        )}
      </p>

      {groups.map((group) => (
        <div className={`photos-room${group.key === UNSORTED_ROOM ? " photos-unsorted" : ""}`} key={group.key || "unsorted"}>
          <h3>
            {group.label} <span className="photos-room-count">{group.photos.length}</span>
          </h3>
          {group.key === UNSORTED_ROOM && sketch.rooms.length > 0 && <p className="field-note">Not filed to a room yet. Pick each one&rsquo;s room below.</p>}
          <ul className="photos-grid">
            {group.photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                image={images.get(photo.id) ?? null}
                roomKey={photoRoomKey(photo, sketch)}
                options={options}
                onCaption={(text) => onChange((p) => captionPhoto(p, photo.id, text, "typed"))}
                onMove={(room) => onChange((p) => movePhoto(p, photo.id, room, roomNameFor(room, sketch)))}
                onDelete={() => {
                  onChange((p) => deletePhoto(p, photo.id));
                  if (claimId) void forgetPhotoFile(claimId, photo.id);
                }}
                onEnlarge={() => setEnlarged(photo)}
              />
            ))}
          </ul>
        </div>
      ))}

      {enlarged && (
        <div className="photos-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setEnlarged(null)}>
          {images.get(enlarged.id)?.full || images.get(enlarged.id)?.thumb ? (
            <img src={images.get(enlarged.id)?.full ?? images.get(enlarged.id)?.thumb ?? ""} alt={enlarged.caption || "Site photo"} />
          ) : (
            <p>This photo shows here once there is signal.</p>
          )}
          <p className="photos-viewer-caption">{enlarged.caption || "No caption"}</p>
          <button type="button" className="btn-secondary" onClick={() => setEnlarged(null)}>
            Close
          </button>
        </div>
      )}
    </section>
  );
}

function PhotoCard({
  photo,
  image,
  roomKey,
  options,
  onCaption,
  onMove,
  onDelete,
  onEnlarge,
}: {
  photo: ClaimPhoto;
  image: PhotoImage | null;
  roomKey: string;
  options: { value: string; label: string }[];
  onCaption: (text: string) => void;
  onMove: (room: string) => void;
  onDelete: () => void;
  onEnlarge: () => void;
}) {
  const [draft, setDraft] = useState(photo.caption);
  const [confirming, setConfirming] = useState(false);
  // A caption changed elsewhere — spoken on the camera, or merged from another phone — shows here.
  useEffect(() => setDraft(photo.caption), [photo.caption]);

  return (
    <li className="photo-card">
      <button type="button" className="photo-card-image" onClick={onEnlarge} aria-label="Show the photo larger">
        {image?.thumb ? <img src={image.thumb} alt="" loading="lazy" /> : <span className="photo-card-blank">Shows with signal</span>}
      </button>
      <div className="photo-card-body">
        <div className="photo-card-meta">
          <span>{photoWhen(photo.takenAt)}</span>
          {!captioned(photo) && <span className="photo-card-flag">Not printed — no caption</span>}
          {image?.waiting && !image.refused && <span className="photo-card-flag">Waiting to upload</span>}
        </div>
        {image?.refused && (
          <p className="photo-card-refused">
            Scrivn would not take this photo: {image.refused}{" "}
            <button type="button" className="link-button" onClick={() => void retryPhotoFile(photo.id)}>
              Try again
            </button>{" "}
            <button type="button" className="link-button" onClick={() => void discardPhotoFile(photo.id)}>
              Remove the picture
            </button>
          </p>
        )}
        <textarea
          className="photo-card-caption"
          value={draft}
          rows={2}
          placeholder="Caption — what the photo shows"
          aria-label="Caption"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== photo.caption) onCaption(draft);
          }}
        />
        <div className="photo-card-actions">
          <label className="photo-card-room">
            <span>Room</span>
            <select value={roomKey} onChange={(e) => onMove(e.target.value)}>
              {options.map((o) => (
                <option key={o.value || "unsorted"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {confirming ? (
            <span className="photo-card-confirm">
              <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
                Keep
              </button>
              <button type="button" className="btn-danger" onClick={onDelete}>
                Delete photo
              </button>
            </span>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
