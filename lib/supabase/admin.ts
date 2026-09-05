import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";
import { cleanEnv } from "../env";

/**
 * The service-role Supabase client — bypasses Row Level Security entirely.
 *
 * This exists for exactly one caller: the Stripe webhook (`app/api/webhooks/stripe/route.ts`).
 * That request arrives from Stripe's servers with no user session and no cookies, so there is no
 * "current user" whose RLS policies could authorize the write — and the columns it needs to write
 * (`subscription_tier`, `claims_used_this_period`) are deliberately not writable by users at all
 * (see `supabase/migrations/0002_billing.sql`). A privileged client is the only way to do it.
 *
 * `server-only` makes importing this from client code a build error. That guard matters more here
 * than anywhere else in the project: this key bypasses every access rule in the database, so a leak
 * is full read/write access to every user's data, not just an expensive API bill.
 *
 * Never import this to "make a query work" — if RLS is blocking a legitimate user action, the fix
 * is a policy, not this client.
 */
export function createAdminClient() {
  const serviceRoleKey = cleanEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. The Stripe webhook needs it to update subscription state (Supabase dashboard → Project Settings → API → service_role / secret key).",
    );
  }
  return createClient(supabaseUrl(), serviceRoleKey, {
    // No session to persist or refresh — this client is used for one-off privileged writes from a
    // server request, never on behalf of a signed-in browser.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
