import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * The Supabase client for Client Components (the login and signup forms). `createBrowserClient`
 * already returns a singleton internally, so calling this repeatedly is fine — it does not open a
 * new connection per call.
 *
 * This client reads and writes the auth cookies the middleware and server client also read, which
 * is the whole point of using `@supabase/ssr` rather than the plain `supabase-js` client: a session
 * established here in the browser is immediately visible to server-side code on the next request.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
