import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * The signed-in identity strip in the site header: who you are, and a way out.
 *
 * A Server Component, so the session is read on the server and no auth state has to be shipped to
 * the browser or re-fetched on hydration. Renders nothing at all when signed out, which is what
 * keeps it invisible on `/login`, `/signup`, and the rest of the public auth pages that share this
 * layout.
 *
 * The sign-out control is a real form POST rather than an onClick handler, so it works with no
 * client JavaScript and this file never has to become a Client Component.
 */
export async function UserMenu() {
  // This renders in the root layout, so it runs on every page — including in a local checkout with
  // no Supabase project set up, where `middleware.ts` deliberately lets requests through. Throwing
  // here would crash all of those pages and undo that. See `isSupabaseConfigured`.
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;

  const email = typeof claims.email === "string" ? claims.email : null;

  return (
    <div className="user-menu">
      {email && <span className="user-menu-email">{email}</span>}
      {/* First, because resuming a claim is the commonest reason to be up here at all. */}
      <Link href="/claims" className="user-menu-link">
        Claims
      </Link>
      <Link href="/account" className="user-menu-link">
        Account
      </Link>
      <form action="/api/logout" method="post">
        <button type="submit" className="user-menu-signout">
          Sign out
        </button>
      </form>
    </div>
  );
}
