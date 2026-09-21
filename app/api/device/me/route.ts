import { NextResponse } from "next/server";
import { deviceIdentity } from "@/lib/deviceRepo";
import { deviceToken, errorResponse, notPaired } from "../pair/route";

/**
 * Who am I paired as? What the phone shows on its own settings screen, and what it calls first
 * after pairing to confirm the token it holds still works.
 */

export async function GET(request: Request) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  try {
    const identity = await deviceIdentity(token);
    return NextResponse.json({
      organization: { id: identity.organizationId, name: identity.organizationName },
      user: { id: identity.userId, name: identity.userName },
      role: identity.role,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
