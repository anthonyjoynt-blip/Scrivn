import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "./supabase/env";

/**
 * An email and password checked against Supabase from the server, for the two things that need it
 * outside a browser: Scrivn Scan signing in (lib/deviceRepo.ts `signInDevice`) and confirming a
 * deletion (the password again, so a phone left unlocked, or a browser left signed in, cannot delete
 * the account by itself).
 *
 * The session it makes lives in this client's memory only — never a cookie, never stored — and is
 * signed out again by `endSession` (scope local: this session, not the person's others).
 */

export class BadCredentialsError extends Error {
  constructor() {
    super("That email and password don't match a Scrivn account.");
    this.name = "BadCredentialsError";
  }
}

export class EmailNotConfirmedError extends Error {
  constructor() {
    super("Confirm your email first: open the link we sent you, then sign in.");
    this.name = "EmailNotConfirmedError";
  }
}

export interface PasswordSession {
  /** A client acting as the person, for the one or two calls that need them. */
  client: SupabaseClient;
  userId: string;
  email: string;
}

export async function signInWithPassword(email: string, password: string): Promise<PasswordSession> {
  const client = createSupabaseClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session || !data.user) {
    if (error?.code === "email_not_confirmed") throw new EmailNotConfirmedError();
    if (error && error.status !== undefined && error.status >= 500) throw new Error(`could not sign in: ${error.message}`);
    throw new BadCredentialsError();
  }
  return { client, userId: data.user.id, email: data.user.email ?? email.trim() };
}

/** Signs that one session out; a failure is only logged, since the session expires on its own within the hour. */
export async function endSession(session: PasswordSession): Promise<void> {
  try {
    await session.client.auth.signOut({ scope: "local" });
  } catch (err) {
    console.error("[password sign-in] could not end the session:", err);
  }
}
