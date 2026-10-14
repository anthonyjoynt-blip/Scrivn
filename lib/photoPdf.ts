"use client";

import { netFetch } from "./connectivity";
import { photoFile } from "./devicePhotos";
import { pdfImage } from "./photoImage";
import type { PdfPhoto } from "./pdf";
import { captioned, photosByRoom, type ClaimPhotos } from "./photos";
import type { Sketch } from "./sketch";

/**
 * The Initial Site Report's photo pages, made at the moment the report is (2026-10-14).
 *
 * Which photos: the captioned ones, grouped by room in the sketch's order (the owner's choice — an
 * uncaptioned photo stays in Scrivn, marked in the Photos panel). That is also what keeps the report
 * small enough to email: Send documents posts through a function that refuses a body over 4.5 MB, so
 * each photo goes in at about 1,200 px and medium quality, a hundred-odd kilobytes.
 *
 * From where: this phone's own copy when the photo is still waiting to upload, Scrivn's otherwise —
 * which needs signal. A photo that cannot be had either way is left out and counted, so the page can
 * say so rather than print a report quietly missing photos.
 */

/** By photo id: a picture never changes once taken, so one made for a download serves the email too. */
const made = new Map<string, { dataUrl: string; width: number; height: number }>();

export function photoWhen(ms: number): string {
  return new Date(ms).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

/** The captioned photos, the ones the report prints. */
export function printablePhotoCount(photos: ClaimPhotos): number {
  return photos.items.filter(captioned).length;
}

export async function pdfPhotosFor(
  claimId: string | null,
  photos: ClaimPhotos,
  sketch: Pick<Sketch, "rooms" | "levelNames">,
): Promise<{ photos: PdfPhoto[]; missing: number }> {
  const groups = photosByRoom({ ...photos, items: photos.items.filter(captioned) }, sketch);
  let links: Map<string, string> | null = null;
  const linkFor = async (id: string): Promise<string | null> => {
    if (!claimId) return null;
    if (!links) {
      links = new Map();
      try {
        const res = await netFetch(`/api/claims/${claimId}/photos`, { timeoutMs: 20_000 });
        if (res.ok) {
          const body = (await res.json()) as { photos?: { id: string; full: string | null }[] };
          for (const p of body.photos ?? []) if (p.full) links.set(p.id, p.full);
        }
      } catch {
        /* no signal: only this phone's own photos can go in */
      }
    }
    return links.get(id) ?? null;
  };

  const out: PdfPhoto[] = [];
  let missing = 0;
  for (const group of groups) {
    for (const photo of group.photos) {
      let image = made.get(photo.id) ?? null;
      if (!image) {
        try {
          const local = await photoFile(photo.id);
          let blob: Blob | null = local?.full ?? null;
          if (!blob) {
            const url = await linkFor(photo.id);
            if (url) {
              const res = await fetch(url);
              if (res.ok) blob = await res.blob();
            }
          }
          if (blob) {
            image = await pdfImage(blob);
            made.set(photo.id, image);
          }
        } catch {
          image = null;
        }
      }
      if (!image) {
        missing += 1;
        continue;
      }
      out.push({ ...image, label: `${group.label} · ${photoWhen(photo.takenAt)}`, caption: photo.caption.trim() });
    }
  }
  return { photos: out, missing };
}
