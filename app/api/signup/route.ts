import { NextResponse } from "next/server";
import { createAccount, SignupEmailFailedError, SignupInvalidError, SignupsClosedError } from "@/lib/signup";
import { TooManyAttemptsError } from "@/lib/requestGuard";
import { clientIp } from "@/lib/guardRules";

/**
 * The website's sign-up form posts here (lib/signup.ts: the gate, the guards, the account and its
 * confirmation email). Public, like the form: middleware.ts lists it in PUBLIC_ROUTES.
 *
 *   POST { email, password, fullName, companyName?, next? }
 *        200 { ok: true }   "check your email", whether or not the address already had an account
 */

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const text = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : "");
    await createAccount({
      email: text("email"),
      password: text("password"),
      fullName: text("fullName"),
      companyName: text("companyName"),
      next: text("next") || undefined,
      ip: clientIp(request.headers),
      origin: new URL(request.url).origin,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SignupsClosedError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof SignupInvalidError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof TooManyAttemptsError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof SignupEmailFailedError) return NextResponse.json({ error: err.message }, { status: 502 });
    console.error("[/api/signup]", err);
    return NextResponse.json({ error: "Your account couldn't be made just now. Try again in a minute." }, { status: 500 });
  }
}
