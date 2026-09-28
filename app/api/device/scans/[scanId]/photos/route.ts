import { NextResponse } from "next/server";
import { MAX_SCAN_PHOTO_BYTES, ScanPhotoRejectedError, storeScanPhoto } from "@/lib/scanPhotos";
import { deviceToken, errorResponse, notPaired } from "../../../pair/route";

/**
 * One photo of a scan's walk, from the phone: `POST /api/device/scans/<scan id>/photos?n=<number>`
 * with the JPEG as the body and the device token as the bearer (2026-09-27, the walk-through).
 *
 * The phone sends the scan first and its photos after, one at a time, each small enough for any
 * connection and each retried on its own. Where the photo was taken is already in the scan body; this
 * only stores the picture (`storeScanPhoto`). The size is refused from the declared length before a
 * byte is read, as the scan route does.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  try {
    const { scanId } = await params;
    if (!UUID.test(scanId)) return NextResponse.json({ error: "That is not a scan." }, { status: 400 });
    const raw = new URL(request.url).searchParams.get("n");
    const n = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_SCAN_PHOTO_BYTES) {
      return NextResponse.json({ error: "That photo is over 2 MB." }, { status: 413 });
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    await storeScanPhoto(token, scanId, n, bytes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ScanPhotoRejectedError) return NextResponse.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
