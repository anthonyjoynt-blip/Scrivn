# Supabase setup

One-time configuration for the auth system. Everything here is done in the Supabase dashboard —
the app code is already in place and needs no further changes once these steps are done.

## 1. Create the project and collect the keys

Supabase dashboard → **Project Settings → API**. Copy three values into `.env.local`
(see `.env.local.example` for the exact variable names and the warning on the third one):

| Dashboard label | Variable | Exposure |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | Public — compiled into the browser bundle |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public — safe only because Row Level Security governs every table |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY` | **Secret — bypasses RLS entirely. Server-side only, never in a `NEXT_PUBLIC_` variable.** |

Newer Supabase projects label these "publishable" and "secret" rather than "anon" and
"service_role", and their values look like `sb_publishable_…` / `sb_secret_…` rather than the older
`eyJ…` JWTs. They're the same two keys and both formats work; the variable names above are what
this app reads regardless of which format your project issues.

The one thing to get right is which of the two goes in `NEXT_PUBLIC_SUPABASE_ANON_KEY`: it must be
the **publishable** one. A `sb_secret_…` value in a `NEXT_PUBLIC_` variable would be compiled into
the browser bundle and hand every visitor unrestricted database access.

## 2. Run the migration

**SQL Editor** → paste the contents of `migrations/0001_profiles.sql` → Run.

That creates the `profiles` table, its Row Level Security policies, and the trigger that creates a
profile row whenever an account is created. Re-running it is safe (every statement is written to be
idempotent).

Verify: **Table Editor → profiles** should exist, with a green **RLS enabled** badge. If that badge
says RLS is disabled, stop and re-run — the anon key is public, so an un-protected table here is
readable by anyone.

## 3. Require email confirmation

**Authentication → Sign In / Providers → Email**:

- **Enable email provider** — on
- **Confirm email** — on

With this on, `signUp()` creates an unconfirmed account and sends a verification link rather than
signing the person straight in. The app already expects this: the signup form switches to a "check
your email" state instead of redirecting.

## 4. Point the email templates at `/auth/confirm`

**Authentication → Emails → Templates.** The default templates use `{{ .ConfirmationURL }}`, which
goes to Supabase's own endpoint. This app verifies the token itself (`app/auth/confirm/route.ts`),
so both templates below need their link replaced:

**Confirm signup:**

```html
<h2>Confirm your email</h2>
<p>Follow this link to confirm your account:</p>
<p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Confirm your email address</a></p>
```

**Reset password:**

```html
<h2>Reset your password</h2>
<p>Follow this link to choose a new password:</p>
<p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Reset your password</a></p>
```

Two things about these that are easy to get wrong:

**`{{ .RedirectTo }}` rather than `{{ .SiteURL }}`.** `RedirectTo` expands to the full URL the app
itself asked for — `signUp()` and `resetPasswordForEmail()` both pass
`${window.location.origin}/auth/confirm?next=…`. That means the same template produces a
`localhost:3000` link when you're testing locally and a `scrivn.ca` link in production, with nothing
to switch between environments. `SiteURL` is a single fixed value and would always point at
whichever one it's set to, breaking the other.

It also means the `&` at the start is deliberate, not a typo: `RedirectTo` already ends in
`?next=…`, so these are additional query parameters on a URL that already has one.

The tradeoff to know about: `RedirectTo` is only populated when the calling code passes a redirect.
Both of this app's flows always do. But the dashboard's own **Invite user** button does not — if
invites are ever used, that template needs the `{{ .SiteURL }}`-based form instead.

**The `type` values differ** (`email` vs `recovery`) and are not interchangeable — `verifyOtp` uses
them to decide what the token is allowed to do.

## 5. Set the site URL and redirect allowlist

**Authentication → URL Configuration:**

- **Site URL**: `https://scrivn.ca` (this is what `{{ .SiteURL }}` expands to in the templates above)
- **Redirect URLs** — add both, so local development and production both work:
  - `http://localhost:3000/**`
  - `https://scrivn.ca/**`

Anything not on this list is rejected as a redirect target, which is what stops a crafted link from
bouncing a freshly-authenticated user off to another site.

## 6. Production environment variables

`.env.local` is local only. For the deployed site, add `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` to the Vercel project (Settings → Environment Variables) and
redeploy.

The old `SITE_PASSWORD` variable is no longer read by anything and can be deleted from Vercel once
the new auth is confirmed working there.

## Local testing note

With no Supabase variables set, `middleware.ts` deliberately fails **open in development** and
**closed in production** — so the scoping pipeline can still be worked on locally without standing
up a project, while a misconfigured deploy serves a 503 rather than an unprotected app.
