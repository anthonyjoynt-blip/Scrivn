"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { netFetch } from "@/lib/connectivity";
import { onDeviceChange } from "@/lib/deviceClaims";
import { photoFilesOf, type PhotoFile } from "@/lib/devicePhotos";

/**
 * Where to show each of a claim's photos from: this phone's own copy while it waits to upload, or a
 * link from Scrivn once it is there (signed for an hour, so asked for again before then). A photo
 * taken on another phone and not yet uploaded, or one Scrivn holds while there is no signal here,
 * has neither — the panel shows its caption and room without the picture.
 */

export interface PhotoImage {
  thumb: string | null;
  full: string | null;
  /** Still on this phone, waiting to upload. */
  waiting: boolean;
  /** Why Scrivn would not take it, when it would not. */
  refused: string | null;
}

const LINKS_FOR_MS = 50 * 60 * 1000;

export function usePhotoImages(claimId: string | null, onServer: boolean): { images: Map<string, PhotoImage>; waiting: PhotoFile[]; refresh: () => void } {
  const [local, setLocal] = useState<{ files: PhotoFile[]; urls: Map<string, { thumb: string; full: string | null }> }>({ files: [], urls: new Map() });
  const [links, setLinks] = useState<Map<string, { thumb: string | null; full: string | null }>>(new Map());
  const fetchedAt = useRef(0);
  const localIds = useRef<string>("");

  // This phone's copies, as object URLs, renewed when the store changes and let go when they leave it.
  useEffect(() => {
    if (!claimId) return;
    let alive = true;
    let current = new Map<string, { thumb: string; full: string | null }>();
    const read = async () => {
      const files = await photoFilesOf(claimId);
      if (!alive) return;
      const ids = files.map((f) => `${f.id}:${f.sent.full}:${f.refused ?? ""}`).join(",");
      if (ids === localIds.current) return;
      const gone = localIds.current
        .split(",")
        .map((e) => e.split(":")[0])
        .filter((id) => id && !files.some((f) => f.id === id));
      localIds.current = ids;
      const next = new Map<string, { thumb: string; full: string | null }>();
      for (const f of files) {
        const kept = current.get(f.id);
        if (kept) next.set(f.id, kept);
        else if (f.thumb) next.set(f.id, { thumb: URL.createObjectURL(f.thumb), full: f.full ? URL.createObjectURL(f.full) : null });
      }
      for (const [id, urls] of current) {
        if (next.has(id)) continue;
        URL.revokeObjectURL(urls.thumb);
        if (urls.full) URL.revokeObjectURL(urls.full);
      }
      current = next;
      setLocal({ files, urls: next });
      // Something just finished uploading: Scrivn has it now, so ask for its link.
      if (gone.length > 0) fetchedAt.current = 0;
    };
    void read();
    const off = onDeviceChange(() => void read());
    return () => {
      alive = false;
      off();
      for (const urls of current.values()) {
        URL.revokeObjectURL(urls.thumb);
        if (urls.full) URL.revokeObjectURL(urls.full);
      }
      localIds.current = "";
    };
  }, [claimId]);

  const loadLinks = useCallback(async () => {
    if (!claimId || !onServer) return;
    if (Date.now() - fetchedAt.current < LINKS_FOR_MS) return;
    try {
      const res = await netFetch(`/api/claims/${claimId}/photos`, { timeoutMs: 20_000 });
      if (!res.ok) return;
      const body = (await res.json()) as { photos?: { id: string; thumb: string | null; full: string | null }[] };
      fetchedAt.current = Date.now();
      setLinks(new Map((body.photos ?? []).map((p) => [p.id, { thumb: p.thumb, full: p.full }])));
    } catch {
      /* no signal: what this phone holds is what shows */
    }
  }, [claimId, onServer]);

  useEffect(() => {
    void loadLinks();
    const timer = setInterval(() => void loadLinks(), 60_000);
    return () => clearInterval(timer);
  }, [loadLinks, local]);

  const images = new Map<string, PhotoImage>();
  for (const [id, l] of links) images.set(id, { thumb: l.thumb, full: l.full, waiting: false, refused: null });
  for (const f of local.files) {
    const urls = local.urls.get(f.id);
    images.set(f.id, { thumb: urls?.thumb ?? null, full: urls?.full ?? null, waiting: true, refused: f.refused });
  }
  return {
    images,
    waiting: local.files,
    refresh: () => {
      fetchedAt.current = 0;
      void loadLinks();
    },
  };
}
