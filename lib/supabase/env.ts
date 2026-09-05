import { clean } from "../env";
/**
 * The two public Supabase settings, read in one place so a missing/misspelled variable fails with a
 * sentence that says what to do instead of `createBrowserClient` throwing something cryptic about
 * an undefined URL.
 *
 * Both of these are deliberately `NEXT_PUBLIC_` — they are compiled into the browser bundle and are
 * meant to be. The anon (publishable) key is not a secret: it identifies the project and carries no
 * privileges of its own, so every table it can reach is governed by Row Level Security (see
 * `supabase/migrations/0001_profiles.sql`). RLS is what actually protects the data; the key is just
 * the front door.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is the opposite in every respect and is deliberately NOT read here —
 * see `.env.local.example` for the full note on it. It bypasses RLS entirely, so it must never be
 * imported into anything that can reach the browser. Nothing in the current auth flow needs it.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.local.example to .env.local and fill in your Supabase project's URL and anon key (Supabase dashboard → Project Settings → API), then restart the dev server.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", clean(process.env.NEXT_PUBLIC_SUPABASE_URL));
}

export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
}

/**
 * Whether Supabase is configured at all — for the one caller that has to tolerate it not being
 * (`components/UserMenu.tsx`, which renders inside the root layout on *every* page).
 *
 * Without this, `middleware.ts`'s deliberate fail-open-in-development behaviour would be undone
 * from the other direction: the middleware would wave the request through, and then the layout
 * would throw while rendering the header, crashing every page anyway. Callers that only ever run
 * behind an authenticated route can keep using the throwing accessors above — by the time they run,
 * config is guaranteed present.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(clean(process.env.NEXT_PUBLIC_SUPABASE_URL) && clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
}
