import { NextResponse } from "next/server";
import { currentRole } from "@/lib/claimsRepo";
import { beginPairing, listDeviceTokens } from "@/lib/deviceRepo";
import { errorResponse } from "../device/pair/route";

/**
 * The Account page's side of pairing: list the phones paired to this organization, or mint a code
 * for a new one.
 *
 * Plural `/api/devices`, cookie-gated like every other page endpoint — this is a signed-in person at
 * a screen. The singular `/api/device/...` is the phone's side and carries a bearer token instead;
 * `middleware.ts` says why the two are gated differently.
 */

export async function GET() {
  try {
    const devices = await listDeviceTokens();
    // An owner may revoke anyone's phone; a member only their own. The rows carry `mine` for the
    // second case, and the SQL function enforces both regardless of what the page shows.
    return NextResponse.json({ devices, canRevokeAll: (await currentRole()) === "owner" });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    return NextResponse.json(await beginPairing());
  } catch (err) {
    return errorResponse(err);
  }
}
