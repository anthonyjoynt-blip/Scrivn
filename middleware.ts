import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/**
 * Runs in front of every request this app serves (see `config.matcher` at the bottom), pages and
 * API routes alike, and does two jobs in this order:
 *
 *  1. Refresh the Supabase auth session. Access tokens are short-lived; without a refresh on each
 *     request, a logged-in user gets silently logged out mid-session. This is why the middleware
 *     runs on every route, not only the protected ones.
 *  2. Gate the request. Exactly the same set of routes is protected as under the old shared-password
 *     gate this replaced — only the proof of admission changed (a real per-user Supabase session
 *     instead of one HMAC'd cookie everybody shared).
 *
 * Two things here are easy to get subtly wrong and are called out at their line:
 * - `getClaims()`, never `getSession()`, is what authorizes a request server-side.
 * - Any response returned from here must carry the cookies Supabase just set, or the refreshed
 *   token never reaches the browser and the user is logged out on the next request.
 */

/**
 * Pages whose whole purpose is signing in. Reachable signed out — and redirected AWAY from when
 * already signed in, since showing a login form to someone who's logged in is just a dead end.
 *
 * `/reset-password` is deliberately NOT in here. Clicking the emailed reset link runs through
 * `/auth/confirm`, which exchanges the token for a real (recovery) session before redirecting on —
 * so by the time the user lands on `/reset-password` they are signed in and pass the normal check.
 * Anyone reaching it without having gone through that link has no session and gets bounced to
 * `/login`, which is exactly right: without it, that page would let a signed-out visitor set a
 * password.
 */
const AUTH_PAGES = new Set(["/login", "/signup", "/forgot-password"]);

/**
 * Pages open to everyone, signed in or out, with no redirect either way.
 *
 * The five marketing pages are the public face of the site — they have to be readable by strangers,
 * which is the entire point of them, and equally must not bounce a signed-in customer away. That
 * second half matters for `/pricing` in particular: a subscriber reaching it to change plans can't
 * be redirected home, or upgrading becomes impossible.
 *
 * NEXT_PUBLIC_SHOW_MARKETING_NAV hides the links to these pages; it deliberately has no effect
 * here. The pages stay directly reachable by URL whether or not the site advertises them.
 */
const PUBLIC_PAGES = new Set(["/", "/how-it-works", "/pricing", "/faq", "/contact", "/auth/auth-code-error"]);
/**
 * Route Handlers reachable while signed out: the email-confirmation landing point, sign-out
 * (harmless, and must work even if the session is already half-gone), and the Stripe webhook.
 *
 * The webhook has to be here because Stripe's servers call it with no cookies and no session —
 * gating it on a login would simply break billing. It is NOT unauthenticated in effect: it verifies
 * Stripe's cryptographic signature on every request and rejects anything unsigned, which is a
 * stronger check than a session cookie. See app/api/webhooks/stripe/route.ts.
 *
 * `/api/contact` is the marketing contact form's endpoint. It has to accept requests with no
 * session for the same reason the page does — a contact form exists for people who don't have an
 * account. It does its own validation, size-capping, bot filtering and per-IP throttling; see
 * app/api/contact/route.ts.
 */
const PUBLIC_ROUTES = new Set(["/auth/confirm", "/api/logout", "/api/webhooks/stripe", "/api/contact"]);

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Same fail-open-in-dev / fail-closed-in-production split the shared-password gate used: local
    // work on the scoping pipeline shouldn't require standing up a Supabase project first, but a
    // deploy that's missing its env vars must never silently serve an unprotected app.
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.next();
    }
    return new NextResponse("Site is not configured.", { status: 503 });
  }

  // `supabaseResponse` accumulates any auth cookies Supabase refreshes below. Whatever this
  // function ultimately returns has to carry those cookies — see `withAuthCookies`.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not put other code between creating the client above and this call. `getClaims()` is what
  // triggers the token refresh, and anything in between can end up running against a stale session.
  //
  // `getClaims()` rather than `getSession()` is deliberate and load-bearing: `getSession()` only
  // reads the cookie and trusts it, and a cookie is attacker-controllable, so it cannot authorize
  // anything server-side. `getClaims()` verifies the JWT's signature against the project's public
  // keys before returning, which is what makes the check below meaningful.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = data?.claims != null;

  const { pathname } = request.nextUrl;

  /** Copies the refreshed auth cookies onto a response that isn't `supabaseResponse` itself. */
  function withAuthCookies(response: NextResponse): NextResponse {
    for (const cookie of supabaseResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    return response;
  }

  if (PUBLIC_ROUTES.has(pathname) || PUBLIC_PAGES.has(pathname)) {
    return supabaseResponse;
  }

  if (isSignedIn) {
    // Nothing to do on a sign-in page once you're already in. Sent to /claim rather than / —
    // / is the public marketing home now, and someone who just signed in wants the tool.
    if (AUTH_PAGES.has(pathname)) {
      return withAuthCookies(NextResponse.redirect(new URL("/claim", request.url)));
    }
    return supabaseResponse;
  }

  if (AUTH_PAGES.has(pathname)) {
    return supabaseResponse;
  }

  // Signed out, on something protected. API routes get a status code a fetch() can act on; pages
  // get sent to the login form, remembering where they were headed.
  if (pathname.startsWith("/api/")) {
    return withAuthCookies(NextResponse.json({ error: "Not authenticated." }, { status: 401 }));
  }

  // Every path that reaches here is protected (the public ones returned above), so there's always
  // somewhere worth sending them back to after they sign in.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return withAuthCookies(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
