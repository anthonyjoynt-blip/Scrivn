"use client";

import { createContext, useContext } from "react";
import { netFetch } from "@/lib/connectivity";
import { photoFile } from "@/lib/devicePhotos";
import type { ClaimPhotos } from "@/lib/photos";
import type { SidePhoto } from "@/lib/exterior";

/**
 * The claim's site photos, for the exterior (2026-10-16, the photo route): the photos a house is
 * measured from are site photos filed to Exterior (lib/photos.ts), kept on the phone and sent like any
 * other, so the PWA measures with no signal. The claim page hands them down to the sketch; the photo
 * route adds to them, and SidePhotos.tsx squares a side's photo from them.
 */
export interface ExteriorPhotoAccess {
  claimId: string | null;
  /** The claim's id, given one now if it has none: a photo is stored under it the moment it is added. */
  claimIdNow: () => string;
  onServer: boolean;
  photos: ClaimPhotos;
  onPhotosChange: (change: (photos: ClaimPhotos) => ClaimPhotos) => void;
  /** Save the claim now, rather than on the timer. */
  onCheckpoint?: () => void;
}

export const ExteriorPhotoContext = createContext<ExteriorPhotoAccess | null>(null);

export function useExteriorPhotos(): ExteriorPhotoAccess | null {
  return useContext(ExteriorPhotoContext);
}

/** Links to a claim's photos, one request a claim an hour (they are signed for an hour). */
const links = new Map<string, { at: number; got: Promise<Map<string, string>> }>();
function claimLinks(claimId: string): Promise<Map<string, string>> {
  const kept = links.get(claimId);
  if (kept && Date.now() - kept.at < 50 * 60 * 1000) return kept.got;
  const got = netFetch(`/api/claims/${claimId}/photos`, { timeoutMs: 20_000 })
    .then((r) => (r.ok ? r.json() : { photos: [] }))
    .then((body: { photos?: { id: string; full: string | null }[] }) => new Map((body.photos ?? []).filter((p) => p.full).map((p) => [p.id, p.full as string])));
  got.catch(() => links.delete(claimId));
  links.set(claimId, { at: Date.now(), got });
  return got;
}

/** A claim photo's full picture, to draw: this phone's own copy while it waits to upload, else Scrivn's. Null when neither is to hand. */
export async function claimPhotoUrl(claimId: string | null, id: string): Promise<string | null> {
  const local = await photoFile(id).catch(() => null);
  if (local?.full) return URL.createObjectURL(local.full);
  if (!claimId) return null;
  const got = (await claimLinks(claimId).catch(() => new Map<string, string>())).get(id);
  if (got) return got;
  // Just uploaded, after the links were asked for: ask again, once, if they are more than a few seconds old.
  const kept = links.get(claimId);
  if (kept && Date.now() - kept.at > 3000) {
    links.delete(claimId);
    return (await claimLinks(claimId).catch(() => new Map<string, string>())).get(id) ?? null;
  }
  return null;
}

/** The claim id a side photo's picture is read under, set by the editor that shows it (SidePhotos.tsx reads it). */
let currentClaim: string | null = null;
export function setSidePhotoClaim(claimId: string | null): void {
  currentClaim = claimId;
}

/** Where a side photo's picture is: a claim photo's (the photo route), or null for SidePhotos to look in the scan's. */
export function claimSidePhotoUrl(photo: SidePhoto): Promise<string | null> | null {
  return photo.claimPhotoId ? claimPhotoUrl(currentClaim, photo.claimPhotoId) : null;
}
