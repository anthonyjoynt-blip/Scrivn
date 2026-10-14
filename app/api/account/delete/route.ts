import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BadCredentialsError, EmailNotConfirmedError, endSession, signInWithPassword } from "@/lib/passwordSignIn";
import { deleteAccount, DeletionUnavailableError, TeamOwnerCannotDeleteError } from "@/lib/accountDeletion";
import { guardSignIn, TooManyAttemptsError } from "@/lib/requestGuard";
import { clientIp } from "@/lib/guardRules";

/**
 * Delete account, on the website (sa-delete; the page is app/(app)/account/delete). The signed-in
 * session says whose account; the password typed again says it is them. What goes is
 * lib/accountDeletion.ts. The browser's own session is signed out at the end, so its cookies go too.
 *
 *   POST { password }   200 { deleted: true } · 400 wrong password · 401 not signed in · 409 team owner
 */

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "Sign in to delete your account." }, { status: 401 });

  try {
    const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (password === "") return NextResponse.json({ error: "Enter your password to delete your account." }, { status: 400 });
    if (!user.email) throw new BadCredentialsError();

    await guardSignIn(clientIp(request.headers), user.email);
    const session = await signInWithPassword(user.email, password);
    await endSession(session);
    if (session.userId !== user.id) throw new BadCredentialsError();

    const result = await deleteAccount(user.id, user.email);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return NextResponse.json({ deleted: true, organizationsDeleted: result.organizationsDeleted, leftTeam: result.leftTeam });
  } catch (err) {
    if (err instanceof BadCredentialsError || err instanceof EmailNotConfirmedError) {
      return NextResponse.json({ error: "That password isn't right." }, { status: 400 });
    }
    if (err instanceof TooManyAttemptsError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof TeamOwnerCannotDeleteError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof DeletionUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("[/api/account/delete]", err);
    return NextResponse.json({ error: "Your account couldn't be deleted just now. Try again, or email privacy@scrivn.ca." }, { status: 500 });
  }
}
