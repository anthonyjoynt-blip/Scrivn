import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";
import { cleanEnv } from "../env";

/**
 * The service-role Supabase client — bypasses Row Level Security entirely.
 *
 * It exists for the profile and billing columns that users are deliberately not allowed to write
 * themselves (`subscription_tier`, `claims_used_this_period`, the trial stamps — see
 * `supabase/migrations/0002_billing.sql` and `0003_trial.sql`, which grant `authenticated` an update
 * on three descriptive columns and nothing else). The Stripe webhook (`app/api/webhooks/stripe/route.ts`)
 * was the first caller and is the clearest case: that request arrives from Stripe's servers with no
 * user session and no cookies, so there is no "current user" whose RLS policies could authorize the
 * write. The same columns are also touched by `lib/usage.ts`, checkout, the billing portal and
 * `auth/confirm`, all for the same reason — a privileged client is the only way to write them.
 *
 * What has never been true, and must stay untrue, is this client touching `claims`. The paired-phone
 * routes (`app/api/device/*`) are the other caller with no session, and they do NOT use it: they run
 * as `anon` through SECURITY DEFINER functions that check the device token themselves
 * (`lib/deviceRepo.ts`). A bearer header is not a reason to switch RLS off.
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
