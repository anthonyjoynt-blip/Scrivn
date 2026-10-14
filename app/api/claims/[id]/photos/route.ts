import { NextResponse } from "next/server";
import { claimPhotoLinks } from "@/lib/claimPhotos";
import { errorResponse } from "../../route";

/**
 * The pictures Scrivn holds for a claim's site photos: `GET /api/claims/<id>/photos` returns
 * `{ photos: [{ id, thumb, full }] }`, each link signed for an hour — the way a scan's walk photos
 * are served (app/api/scans/[scanId]/photos).
 *
 * Read over the member's own session, so a claim of another organization is simply an empty list.
 * A photo still on the phone that took it is not here yet; that phone shows it from its own copy.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ photos: [] });
    return NextResponse.json({ photos: await claimPhotoLinks(id.toLowerCase()) });
  } catch (err) {
    return errorResponse(err);
  }
}
