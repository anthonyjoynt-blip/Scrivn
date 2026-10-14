import { NextResponse } from "next/server";
import { createAccount, signupsOpen, SignupsClosedError } from "@/lib/signup";
import { clientIp } from "@/lib/guardRules";
import { errorResponse } from "../pair/route";

/**
 * "Create an account" in Scrivn Scan: the same door as the website's sign-up page (lib/signup.ts),
 * so the same gate — invite-only until NEXT_PUBLIC_SIGNUPS_OPEN is "true" — and the same guards.
 *
 *   GET   { open, message? }      whether to show the form, or the sentence to show instead
 *   POST  { email, password, fullName, companyName? }
 *         200 { ok: true }        a confirmation email is on its way (said whether or not the address
 *                                 already had an account, so this cannot be used to find out)
 *         400 a field · 403 closed · 429 too many today · 502 the email could not be sent
 *
 * The confirmation link lands on /scan/ready, which says to go back to the app and sign in.
 */

export async function GET() {
  if (signupsOpen()) return NextResponse.json({ open: true });
  return NextResponse.json({ open: false, message: new SignupsClosedError().message });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const text = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : "");
    await createAccount({
      email: text("email"),
      password: text("password"),
      fullName: text("fullName"),
      companyName: text("companyName"),
      forScan: true,
      next: "/scan/ready",
      ip: clientIp(request.headers),
      origin: new URL(request.url).origin,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
