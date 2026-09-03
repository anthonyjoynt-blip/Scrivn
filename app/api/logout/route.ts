import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Signs the current user out and returns them to the sign-in page.
 *
 * Unlike the version this replaced — which cleared one shared-password cookie and was never wired
 * to anything, because logging out of a password everybody knew accomplished nothing — this is
 * reachable from the header on every page (see `components/UserMenu.tsx`).
 *
 * POST rather than GET on purpose: a GET would let any page on the internet sign a user out by
 * embedding `<img src="https://scrivn.ca/api/logout">`. The 303 is what makes the browser follow up
 * with a GET for `/login` instead of re-POSTing to it.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  // Ends the session server-side and clears the auth cookies via the client's cookie adapter.
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
