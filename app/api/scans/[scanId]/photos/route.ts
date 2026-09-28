import { NextResponse } from "next/server";
import { scanPhotoUrls } from "@/lib/scanPhotos";
import { errorResponse } from "../../../claims/route";

/**
 * The photos of a scan's walk, for the 3D view: `GET /api/scans/<scan id>/photos` returns
 * `{ photos: [{ n, url }] }`, each link signed for an hour.
 *
 * Read over the member's own session, so a scan of another organization - or one with no photos -
 * is simply an empty list, the way a claim that is not theirs has no scans.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const { scanId } = await params;
    if (!UUID.test(scanId)) return NextResponse.json({ photos: [] });
    return NextResponse.json({ photos: await scanPhotoUrls(scanId) });
  } catch (err) {
    return errorResponse(err);
  }
}
