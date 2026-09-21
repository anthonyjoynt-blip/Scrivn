import { NextResponse } from "next/server";
import { revokeDeviceToken } from "@/lib/deviceRepo";
import { errorResponse } from "../../device/pair/route";

/**
 * One paired phone: revoke it.
 *
 * Revoking, not deleting. The row stays so the Account page can still say the phone existed and
 * when it was cut off, and so a `claim_scans` row it sent keeps pointing at a name. What changes is
 * that `device_identity` stops answering for its hash, which is what makes the phone's next request
 * a 401 — there is no other copy of the token to chase.
 *
 * 404 for "nothing changed", whether that is a phone that is not this user's (and they are not an
 * owner), one already revoked, or an id that was never issued — for the reason the claims routes
 * give: telling those apart would confirm which ids are real.
 */

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const revoked = await revokeDeviceToken(id);
    if (!revoked) return NextResponse.json({ error: "Paired phone not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
