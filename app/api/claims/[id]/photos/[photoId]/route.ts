import { NextResponse } from "next/server";
import {
  ClaimPhotoClaimMissingError,
  ClaimPhotoRejectedError,
  MAX_CLAIM_PHOTO_BYTES,
  PhotoNotInClaimError,
  removeClaimPhoto,
  storeClaimPhoto,
  type PhotoPart,
} from "@/lib/claimPhotos";
import { devClaimsMode } from "@/lib/devClaimsStore";
import { devPhotos } from "@/lib/devPhotoStore";
import { isPhotoId } from "@/lib/photos";
import { errorResponse } from "../../../route";

/**
 * One site photo's picture (2026-10-14).
 *
 *   POST   /api/claims/<id>/photos/<photo id>[?part=thumb]   the JPEG as the body, 2 MB at most
 *   DELETE /api/claims/<id>/photos/<photo id>                 both parts
 *
 * Safe to send twice: a POST replaces whatever is there, so the phone's queue (lib/devicePhotos.ts)
 * can send a picture again after a lost answer without making a second one. The photo must be listed
 * in its claim — 409 until the claim's own save has landed, which the queue treats as "later". The
 * size is refused from the declared length before a byte is read, as the scan photo route does.
 *
 * Only Scrivn's server writes to the bucket, after the member's own session has found the claim; see
 * lib/claimPhotos.ts.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function partOf(request: Request): PhotoPart {
  return new URL(request.url).searchParams.get("part") === "thumb" ? "thumb" : "full";
}

function photoError(err: unknown) {
  if (err instanceof ClaimPhotoRejectedError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof ClaimPhotoClaimMissingError) return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof PhotoNotInClaimError) return NextResponse.json({ error: err.message, code: "not-in-claim" }, { status: 409 });
  return errorResponse(err);
}

async function ids(params: Promise<{ id: string; photoId: string }>): Promise<{ id: string; photoId: string } | null> {
  const { id, photoId } = await params;
  return UUID.test(id) && isPhotoId(photoId) ? { id: id.toLowerCase(), photoId } : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const named = await ids(params);
    if (!named) return NextResponse.json({ error: "That is not a photo of a claim." }, { status: 400 });
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_CLAIM_PHOTO_BYTES) {
      return NextResponse.json({ error: "That photo is over 2 MB." }, { status: 413 });
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    await storeClaimPhoto(named.id, named.photoId, partOf(request), bytes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return photoError(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const named = await ids(params);
    if (!named) return NextResponse.json({ error: "That is not a photo of a claim." }, { status: 400 });
    await removeClaimPhoto(named.id, named.photoId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return photoError(err);
  }
}

/**
 * Local development only, where there is no bucket to sign links into: the picture itself, from the
 * file lib/devPhotoStore.ts keeps. Not found anywhere else — the real links come from storage.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  if (!devClaimsMode()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const named = await ids(params);
  const bytes = named ? devPhotos.read(named.id, named.photoId, partOf(request)) : null;
  if (!bytes) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
}
