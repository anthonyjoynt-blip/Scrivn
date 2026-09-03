import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * The Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Note `await cookies()` — `next/headers`' `cookies()` is asynchronous as of Next.js 15, and this
 * project is on 16. Several published Supabase examples still show the older synchronous form;
 * copying those verbatim here would be a type error at best and a silently empty cookie jar at
 * worst.
 *
 * The `setAll` try/catch is not defensive hand-waving: writing a cookie is genuinely illegal inside
 * a Server Component render (only Route Handlers, Server Actions, and middleware may set cookies),
 * and Supabase calls `setAll` whenever it refreshes a token. Swallowing it is correct *specifically
 * because* `middleware.ts` refreshes the session on every request anyway — the write that fails
 * here has already happened there. If the middleware were ever removed, this swallow would start
 * hiding real dropped refreshes.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — see this function's doc comment.
        }
      },
    },
  });
}
