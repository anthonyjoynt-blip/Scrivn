import { NextResponse } from "next/server";
import { signInDevice } from "@/lib/deviceRepo";
import { allowanceFor } from "@/lib/scanAllowance";
import { guardSignIn } from "@/lib/requestGuard";
import { clientIp } from "@/lib/guardRules";
import { errorResponse } from "../pair/route";

/**
 * Scrivn Scan signs in with an email and password (sa-signin) and leaves with a device token — the
 * same thing pairing hands it (`signInDevice` in lib/deviceRepo.ts), in the same shape as
 * /api/device/pair's answer, plus the email and this month's scans.
 *
 * Reachable with no session (middleware.ts lets /api/device/ through): the password is the credential.
 * Throttled per address and per email (lib/requestGuard.ts) before Supabase is asked anything, since
 * every attempt from every phone reaches Supabase from this server's address, where its own
 * per-address limit cannot tell one phone from another.
 *
 *   POST { email, password, deviceName? }
 *   200  { token, organization: {id, name}, user: {id, name}, email, allowance? }
 *   400  wrong email or password · 403 email not confirmed · 429 too many attempts
 */

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown; deviceName?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (email === "" || password === "") return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    if (email.length > 254 || password.length > 200) return NextResponse.json({ error: "That email and password don't match a Scrivn account." }, { status: 400 });
    const deviceName = typeof body?.deviceName === "string" ? body.deviceName : "";

    await guardSignIn(clientIp(request.headers), email);
    const { token, identity, email: signedInAs } = await signInDevice(email, password, deviceName);
    const allowance = await allowanceFor(identity.organizationId).catch((err) => {
      console.error("[/api/device/signin] allowance unavailable:", err);
      return null;
    });
    return NextResponse.json({
      token,
      organization: { id: identity.organizationId, name: identity.organizationName },
      user: { id: identity.userId, name: identity.userName },
      email: signedInAs,
      ...(allowance ? { allowance } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
