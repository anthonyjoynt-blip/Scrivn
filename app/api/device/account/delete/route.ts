import { NextResponse } from "next/server";
import { deleteAccountFromPhone } from "@/lib/deviceAccount";
import { guardSignIn } from "@/lib/requestGuard";
import { clientIp } from "@/lib/guardRules";
import { deviceToken, errorResponse, notPaired } from "../../pair/route";

/**
 * Delete account, from Scrivn Scan's Account screen (sa-delete): the phone's token says whose
 * account, the password typed again says it is them. What goes is lib/accountDeletion.ts.
 *
 *   POST { password }   200 { deleted: true, organizationsDeleted, leftTeam }
 *                       400 wrong password · 409 owner of a team · 503 not possible right now
 *
 * The password check counts as a sign-in attempt for the throttle, so this cannot be used to guess it.
 */

export async function POST(request: Request) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  try {
    const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (password === "") return NextResponse.json({ error: "Enter your password to delete your account." }, { status: 400 });
    await guardSignIn(clientIp(request.headers), `token:${token.slice(0, 12)}`);
    const result = await deleteAccountFromPhone(token, password);
    return NextResponse.json({ deleted: true, organizationsDeleted: result.organizationsDeleted, leftTeam: result.leftTeam });
  } catch (err) {
    return errorResponse(err);
  }
}
