import { NextResponse } from "next/server";
import { deviceIdentity } from "@/lib/deviceRepo";
import { accountEmail } from "@/lib/deviceAccount";
import { allowanceFor } from "@/lib/scanAllowance";
import { deviceToken, errorResponse, notPaired } from "../pair/route";

/**
 * Who am I paired as? What the phone shows on its own settings screen, and what it calls first
 * after pairing to confirm the token it holds still works.
 *
 * Since 2026-10-14 also the account's email and its scans this month (`allowance`, see
 * lib/scanAllowanceRules.ts), for Scrivn Scan's Account screen. An allowance that cannot be read is
 * left out rather than failing the call: "am I still paired?" is the question that matters here.
 */

export async function GET(request: Request) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  try {
    const identity = await deviceIdentity(token);
    const [email, allowance] = await Promise.all([
      accountEmail(identity.userId),
      allowanceFor(identity.organizationId).catch((err) => {
        console.error("[/api/device/me] allowance unavailable:", err);
        return null;
      }),
    ]);
    return NextResponse.json({
      organization: { id: identity.organizationId, name: identity.organizationName },
      user: { id: identity.userId, name: identity.userName },
      role: identity.role,
      email,
      ...(allowance ? { allowance } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
