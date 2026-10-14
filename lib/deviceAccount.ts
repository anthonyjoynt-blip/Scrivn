import "server-only";
import { createAdminClient } from "./supabase/admin";
import { deviceIdentity } from "./deviceRepo";
import { BadCredentialsError, endSession, signInWithPassword } from "./passwordSignIn";
import { deleteAccount, type DeletionResult } from "./accountDeletion";

/**
 * The account behind a phone's token, for Scrivn Scan's Account screen (2026-10-14): whose email it
 * is, and deleting it from the phone. The token says who; the password, typed again, says it is them.
 */

/** The account's email, or null when it cannot be read (a pairing whose person has gone). */
export async function accountEmail(userId: string): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
    if (error) return null;
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Deletes the account the phone's token belongs to, once `password` proves it is theirs. A token
 * alone is not enough: a phone left unlocked on a job site must not be able to delete the company's
 * claims. The password is checked as a sign-in would check it, then that session is ended.
 */
export async function deleteAccountFromPhone(token: string, password: string): Promise<DeletionResult> {
  const identity = await deviceIdentity(token);
  const email = await accountEmail(identity.userId);
  if (!email) throw new BadCredentialsError();
  const session = await signInWithPassword(email, password);
  await endSession(session);
  if (session.userId !== identity.userId) throw new BadCredentialsError();
  return deleteAccount(identity.userId, email);
}
