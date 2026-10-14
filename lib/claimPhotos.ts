import "server-only";
import { NotSignedInError } from "./claimsRepo";
import { devClaimsMode, devClaims } from "./devClaimsStore";
import { devPhotos } from "./devPhotoStore";
import { normalizeClaimPhotos } from "./photos";
import { SCAN_PHOTO_BUCKET } from "./scanPhotos";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";

/**
 * The pictures of a claim's site photos (2026-10-14): `claim-photos/<organization>/<claim>/<photo>.jpg`
 * and a small `<photo>.thumb.jpg` beside it (migration 0015). The records — room, time, caption — are
 * in the claim itself; see lib/photos.ts.
 *
 * Same arrangement as the scan photos (lib/scanPhotos.ts), for the same reasons:
 *
 *   * WRITES AND DELETES USE THE SERVICE ROLE, and only after the member's OWN session has found the
 *     claim. The bucket has no write policy at all, so the anon key in every page's JavaScript can do
 *     nothing to it; a policy that let a browser write would let any script on the page write.
 *   * READS USE THE MEMBER'S SESSION, so the bucket's select policy — members of the organization —
 *     decides what they see. A claim of another organization is not found, the same 404 a claim that
 *     does not exist gets (see app/api/claims/[id]/route.ts for why the two are not told apart).
 *
 * A picture is stored only for a photo its claim lists. That keeps the bucket to what claims know
 * about — a photo deleted before its picture arrived does not leave one behind — and holds the
 * claim's photo limit on the server too.
 */

export const CLAIM_PHOTO_BUCKET = "claim-photos";
/** A 2,000 px JPEG is well under this; the bucket's own limit is the same (0015). */
export const MAX_CLAIM_PHOTO_BYTES = 2 * 1024 * 1024;
/** A thumbnail is a few tens of kilobytes. */
export const MAX_THUMB_BYTES = 300 * 1024;
/** How long a link to a photo works — long enough to go through a claim's photos. */
const SIGNED_SECONDS = 60 * 60;
const PAGE = 1000;

export type PhotoPart = "full" | "thumb";

export class ClaimPhotoRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimPhotoRejectedError";
  }
}

/** The claim is not there, or not this person's organization's — never told apart. */
export class ClaimPhotoClaimMissingError extends Error {
  constructor() {
    super("Claim not found.");
    this.name = "ClaimPhotoClaimMissingError";
  }
}

/** The claim does not list this photo: its save has not landed yet, or the photo was deleted. */
export class PhotoNotInClaimError extends Error {
  constructor() {
    super("That claim does not list this photo.");
    this.name = "PhotoNotInClaimError";
  }
}

export function claimPhotoPath(organizationId: string, claimId: string, photoId: string, part: PhotoPart): string {
  return `${organizationId}/${claimId}/${photoId}${part === "thumb" ? ".thumb" : ""}.jpg`;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function checkPhotoBytes(bytes: Uint8Array, part: PhotoPart): void {
  const max = part === "thumb" ? MAX_THUMB_BYTES : MAX_CLAIM_PHOTO_BYTES;
  if (bytes.length === 0 || bytes.length > max || !isJpeg(bytes)) {
    throw new ClaimPhotoRejectedError(part === "thumb" ? "Send a thumbnail as a JPEG under 300 KB." : "Send each photo as a JPEG under 2 MB.");
  }
}

/** The claim as the member's own session sees it: its organization and the photos it lists. */
async function visibleClaim(claimId: string): Promise<{ organizationId: string; photoIds: Set<string> } | null> {
  if (devClaimsMode()) {
    const row = devClaims.load(claimId);
    return row ? { organizationId: "dev", photoIds: new Set(row.state.photos.items.map((p) => p.id)) } : null;
  }
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new NotSignedInError();
  const { data, error } = await supabase.from("claims").select("organization_id, photos:payload->photos").eq("id", claimId).maybeSingle();
  if (error) throw new Error(`Could not look the claim up: ${error.message}`);
  if (!data) return null;
  const photos = normalizeClaimPhotos((data as { photos?: unknown }).photos);
  return { organizationId: data.organization_id as string, photoIds: new Set(photos.items.map((p) => p.id)) };
}

/**
 * One part of a photo, from the browser that took it. Sent again it replaces itself (`upsert`), so a
 * retry after a lost answer is harmless.
 */
export async function storeClaimPhoto(claimId: string, photoId: string, part: PhotoPart, bytes: Uint8Array): Promise<void> {
  checkPhotoBytes(bytes, part);
  const claim = await visibleClaim(claimId);
  if (!claim) throw new ClaimPhotoClaimMissingError();
  if (!claim.photoIds.has(photoId)) throw new PhotoNotInClaimError();
  if (devClaimsMode()) return devPhotos.store(claimId, photoId, part, bytes);
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(CLAIM_PHOTO_BUCKET)
    .upload(claimPhotoPath(claim.organizationId, claimId, photoId, part), bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Could not store the photo: ${error.message}`);
}

/** A photo deleted from its claim: both parts go. Nothing there is not an error. */
export async function removeClaimPhoto(claimId: string, photoId: string): Promise<void> {
  if (devClaimsMode()) {
    if (!devClaims.load(claimId)) throw new ClaimPhotoClaimMissingError();
    return devPhotos.remove(claimId, photoId);
  }
  const claim = await visibleClaim(claimId);
  if (!claim) throw new ClaimPhotoClaimMissingError();
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(CLAIM_PHOTO_BUCKET)
    .remove([claimPhotoPath(claim.organizationId, claimId, photoId, "full"), claimPhotoPath(claim.organizationId, claimId, photoId, "thumb")]);
  if (error) throw new Error(`Could not delete the photo: ${error.message}`);
}

export interface ClaimPhotoLinks {
  id: string;
  thumb: string | null;
  full: string | null;
}

/** Every file in a folder, a page at a time. */
async function listAll(list: (offset: number) => Promise<{ data: { name: string }[] | null; error: unknown }>): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await list(offset);
    if (error || !data) break;
    names.push(...data.map((f) => f.name));
    if (data.length < PAGE) break;
  }
  return names;
}

/**
 * Links to every picture Scrivn holds for a claim, signed for an hour, for the member signed in.
 * Empty when the claim is not theirs to see or has none uploaded yet.
 */
export async function claimPhotoLinks(claimId: string): Promise<ClaimPhotoLinks[]> {
  if (devClaimsMode()) {
    if (!devClaims.load(claimId)) return [];
    return devPhotos.list(claimId).map(({ id, parts }) => ({
      id,
      thumb: parts.includes("thumb") ? `/api/claims/${claimId}/photos/${id}?part=thumb` : null,
      full: parts.includes("full") ? `/api/claims/${claimId}/photos/${id}` : null,
    }));
  }
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new NotSignedInError();
  const { data: claim } = await supabase.from("claims").select("organization_id").eq("id", claimId).maybeSingle();
  if (!claim) return [];
  const folder = `${claim.organization_id}/${claimId}`;
  const bucket = supabase.storage.from(CLAIM_PHOTO_BUCKET);
  const names = (await listAll((offset) => bucket.list(folder, { limit: PAGE, offset }))).filter((n) => /^[A-Za-z0-9:_-]+(\.thumb)?\.jpg$/.test(n));
  if (names.length === 0) return [];
  const { data: signed, error } = await bucket.createSignedUrls(
    names.map((n) => `${folder}/${n}`),
    SIGNED_SECONDS,
  );
  if (error || !signed) return [];
  const byId = new Map<string, ClaimPhotoLinks>();
  for (const s of signed) {
    const name = s.path?.split("/").pop() ?? "";
    if (!s.signedUrl) continue;
    const thumb = name.endsWith(".thumb.jpg");
    const id = name.replace(/(\.thumb)?\.jpg$/, "");
    const entry = byId.get(id) ?? { id, thumb: null, full: null };
    if (thumb) entry.thumb = s.signedUrl;
    else entry.full = s.signedUrl;
    byId.set(id, entry);
  }
  return [...byId.values()];
}

/* ── A claim deleted ────────────────────────────────────────────────────────────────────────────── */

export interface ClaimFolders {
  claimId: string;
  organizationId: string;
  scanIds: string[];
}

/**
 * Where a claim's pictures are, read BEFORE the claim is deleted — its scans' rows go with it
 * (`on delete cascade`, 0006), and with them the only record of which scan folders were its. Null
 * when the claim is not this person's to see; the delete will find nothing either.
 */
export async function claimFolders(claimId: string): Promise<ClaimFolders | null> {
  if (devClaimsMode()) return devClaims.load(claimId) ? { claimId, organizationId: "dev", scanIds: [] } : null;
  const supabase = await createClient();
  const { data: claim } = await supabase.from("claims").select("organization_id").eq("id", claimId).maybeSingle();
  if (!claim) return null;
  const { data: scans } = await supabase.from("claim_scans").select("id").eq("claim_id", claimId);
  return { claimId, organizationId: claim.organization_id as string, scanIds: (scans ?? []).map((s) => s.id as string) };
}

/**
 * Every picture of a deleted claim: its site photos and its scans' walk photos (which were left in
 * storage before 2026-10-14). The claim's row is already gone, so a failure here cannot be undone by
 * keeping it — it is logged, and the claim stays deleted.
 */
export async function removeClaimFolders(folders: ClaimFolders): Promise<void> {
  if (devClaimsMode()) return devPhotos.removeClaim(folders.claimId);
  try {
    const admin = createAdminClient();
    const emptyFolder = async (bucket: string, folder: string) => {
      const store = admin.storage.from(bucket);
      // Listed again after each removal rather than paged: removing shifts what an offset points at.
      for (let round = 0; round < 50; round++) {
        const { data, error } = await store.list(folder, { limit: PAGE });
        if (error || !data || data.length === 0) return;
        const { error: removeError } = await store.remove(data.map((f) => `${folder}/${f.name}`));
        if (removeError) throw new Error(removeError.message);
        if (data.length < PAGE) return;
      }
    };
    await emptyFolder(CLAIM_PHOTO_BUCKET, `${folders.organizationId}/${folders.claimId}`);
    for (const scanId of folders.scanIds) await emptyFolder(SCAN_PHOTO_BUCKET, `${folders.organizationId}/${scanId}`);
  } catch (err) {
    console.error(`[claim photos] claim ${folders.claimId} deleted, but its pictures could not all be removed:`, err);
  }
}
