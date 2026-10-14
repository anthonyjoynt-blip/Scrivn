import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PhotoPart } from "./claimPhotos";

/**
 * Claim photos kept in files, beside lib/devClaimsStore.ts and for the same reason: so the camera,
 * the upload queue and the photo pages can be run end to end locally with no Supabase project and no
 * sign-in. Only ever used where that store is (`devClaimsMode`) — never in production, never beside a
 * real project.
 */

const DIR = join(process.cwd(), ".next", "dev-photos");
const SAFE = /^[A-Za-z0-9:_-]{1,80}$/;

function file(claimId: string, photoId: string, part: PhotoPart): string {
  if (!SAFE.test(claimId) || !SAFE.test(photoId)) throw new Error("bad id");
  return join(DIR, claimId, `${photoId}${part === "thumb" ? ".thumb" : ""}.jpg`);
}

export const devPhotos = {
  store(claimId: string, photoId: string, part: PhotoPart, bytes: Uint8Array): void {
    mkdirSync(join(DIR, claimId), { recursive: true });
    writeFileSync(file(claimId, photoId, part), bytes);
  },

  read(claimId: string, photoId: string, part: PhotoPart): Uint8Array | null {
    const path = file(claimId, photoId, part);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  },

  list(claimId: string): { id: string; parts: PhotoPart[] }[] {
    if (!SAFE.test(claimId) || !existsSync(join(DIR, claimId))) return [];
    const byId = new Map<string, PhotoPart[]>();
    for (const name of readdirSync(join(DIR, claimId))) {
      const m = /^(.+?)(\.thumb)?\.jpg$/.exec(name);
      if (!m) continue;
      byId.set(m[1]!, [...(byId.get(m[1]!) ?? []), m[2] ? "thumb" : "full"]);
    }
    return [...byId.entries()].map(([id, parts]) => ({ id, parts }));
  },

  remove(claimId: string, photoId: string): void {
    for (const part of ["full", "thumb"] as const) rmSync(file(claimId, photoId, part), { force: true });
  },

  removeClaim(claimId: string): void {
    if (SAFE.test(claimId)) rmSync(join(DIR, claimId), { recursive: true, force: true });
  },
};
