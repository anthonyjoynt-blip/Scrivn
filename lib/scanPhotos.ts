import "server-only";
import { NotSignedInError } from "./claimsRepo";
import { ClaimNotFoundError, deviceIdentity } from "./deviceRepo";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";

/**
 * The photos a phone takes on its walk (2026-09-27, the walk-through), stored against the scan they
 * came with: `scan-photos/<organization id>/<scan id>/<n>.jpg` (migration 0007).
 *
 * The phone sends them one at a time after the scan itself, so a walk's photos never ride in the
 * scan's 2 MB body and one lost on a bad connection is sent again on its own. Where each was taken is
 * in the scan body (`walk.photos`); this module only stores and serves the pictures.
 *
 * WRITES USE THE SERVICE ROLE, after the device token has named the organization and the scan has
 * been found to be that organization's - storage policies cannot see a device token, and a policy
 * that let the anon key write would let any page's JavaScript write. READS use the member's own
 * session, so RLS on `claim_scans` and on the bucket decides what they may see.
 */

export const SCAN_PHOTO_BUCKET = "scan-photos";
/** A keyframe JPEG is a few hundred kilobytes; two megabytes is a ceiling, the bucket's own limit too. */
export const MAX_SCAN_PHOTO_BYTES = 2 * 1024 * 1024;
/**
 * Photo numbers run under this. The walk's own photos are numbered from 0 and stay under a few
 * hundred; its 360° spots' frames are numbered from 500 (2026-09-28), 24 a spot.
 */
export const MAX_SCAN_PHOTOS = 1000;
/** How long a link to a photo works: long enough to look round a house. */
const SIGNED_SECONDS = 60 * 60;

/** A photo the route will not store, with the sentence to send back. */
export class ScanPhotoRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanPhotoRejectedError";
  }
}

/** Where photo [n] of a scan is kept. */
export function scanPhotoPath(organizationId: string, scanId: string, n: number): string {
  return `${organizationId}/${scanId}/${n}.jpg`;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Photo [n] of scan [scanId] from the phone holding [token]. Sent again it replaces itself, so a
 * retry after a lost answer is harmless. A scan of another organization reads as no scan at all.
 */
export async function storeScanPhoto(token: string, scanId: string, n: number, bytes: Uint8Array): Promise<void> {
  if (!Number.isInteger(n) || n < 0 || n >= MAX_SCAN_PHOTOS) throw new ScanPhotoRejectedError("That photo number is out of range.");
  if (bytes.length === 0 || bytes.length > MAX_SCAN_PHOTO_BYTES || !isJpeg(bytes)) {
    throw new ScanPhotoRejectedError("Send each photo as a JPEG under 2 MB.");
  }
  const identity = await deviceIdentity(token);
  const admin = createAdminClient();
  const { data: scan, error } = await admin.from("claim_scans").select("id, organization_id").eq("id", scanId).maybeSingle();
  if (error) throw new Error(`Could not look the scan up: ${error.message}`);
  if (!scan || scan.organization_id !== identity.organizationId) throw new ClaimNotFoundError();
  const { error: stored } = await admin.storage
    .from(SCAN_PHOTO_BUCKET)
    .upload(scanPhotoPath(identity.organizationId, scanId, n), bytes, { contentType: "image/jpeg", upsert: true });
  if (stored) throw new Error(`Could not store the photo: ${stored.message}`);
}

/**
 * Links to every photo stored for [scanId], signed for an hour, for the member signed in. Empty when
 * the scan is not theirs to see or has no photos - the 3D view then simply has no pins to open.
 */
export async function scanPhotoUrls(scanId: string): Promise<{ n: number; url: string }[]> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new NotSignedInError();
  const { data: scan } = await supabase.from("claim_scans").select("organization_id").eq("id", scanId).maybeSingle();
  if (!scan) return [];
  const folder = `${scan.organization_id}/${scanId}`;
  const { data: files, error } = await supabase.storage.from(SCAN_PHOTO_BUCKET).list(folder, { limit: MAX_SCAN_PHOTOS });
  if (error || !files) return [];
  const names = files.map((f) => f.name).filter((name) => /^\d+\.jpg$/.test(name));
  if (names.length === 0) return [];
  const { data: signed, error: signError } = await supabase.storage
    .from(SCAN_PHOTO_BUCKET)
    .createSignedUrls(names.map((name) => `${folder}/${name}`), SIGNED_SECONDS);
  if (signError || !signed) return [];
  return signed.flatMap((s) => {
    const name = s.path?.split("/").pop() ?? "";
    const n = Number(name.replace(/\.jpg$/, ""));
    return s.signedUrl && Number.isInteger(n) ? [{ n, url: s.signedUrl }] : [];
  });
}
