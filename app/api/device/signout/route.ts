import { NextResponse } from "next/server";
import { revokeOwnToken } from "@/lib/deviceRepo";
import { deviceToken, errorResponse, notPaired } from "../pair/route";

/**
 * Sign out, from Scrivn Scan's Account screen: the phone's token is revoked on Scrivn as well as
 * forgotten on the phone, so a signed-out phone holds nothing that still works. The Account page's
 * Revoke does the same from the other end.
 *
 *   POST (bearer)   200 { signedOut: true }   whether or not the token was still live
 */

export async function POST(request: Request) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  try {
    await revokeOwnToken(token);
    return NextResponse.json({ signedOut: true });
  } catch (err) {
    return errorResponse(err);
  }
}
