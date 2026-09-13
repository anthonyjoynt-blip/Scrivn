import "server-only";
import { createClient } from "./supabase/server";
import { withClockSkewRetry } from "./supabase/clockSkew";
import { NotSignedInError } from "./claimsRepo";

/**
 * The person's own details — `profiles.full_name` and `profiles.phone`, the two the documents use.
 *
 * Per person, not per organization (0001_profiles.sql draws that line), read and written through
 * the session so the profile RLS applies. A claim copies these at the moment it starts — see
 * `useProfile` and the claim page — so editing them here changes the next claim, never one already
 * written.
 */

export interface Profile {
  fullName: string;
  phone: string;
}

export const PROFILE_LIMITS = { fullName: 80, phone: 40 } as const;

async function userId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new NotSignedInError();
  return data.user.id;
}

export async function loadProfile(): Promise<Profile> {
  const supabase = await createClient();
  const id = await userId();
  const { data, error } = await withClockSkewRetry(() => supabase.from("profiles").select("full_name, phone").eq("id", id).maybeSingle());
  if (error) throw new Error(`Could not read the profile: ${error.message}`);
  return { fullName: (data?.full_name as string | null) ?? "", phone: (data?.phone as string | null) ?? "" };
}

export class InvalidProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProfileError";
  }
}

/** Tidies and checks what the form sent, or says in one sentence what is wrong with it. */
export function normaliseProfile(input: unknown): { ok: true; profile: Profile } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save." };
  const raw = input as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const fullName = text(raw.fullName);
  if (fullName.length > PROFILE_LIMITS.fullName) return { ok: false, error: `Name is limited to ${PROFILE_LIMITS.fullName} characters.` };
  const phone = text(raw.phone);
  if (phone.length > PROFILE_LIMITS.phone) return { ok: false, error: `Phone number is limited to ${PROFILE_LIMITS.phone} characters.` };
  return { ok: true, profile: { fullName, phone } };
}

export async function updateProfile(input: unknown): Promise<Profile> {
  const parsed = normaliseProfile(input);
  if (!parsed.ok) throw new InvalidProfileError(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.profile.fullName === "" ? null : parsed.profile.fullName, phone: parsed.profile.phone === "" ? null : parsed.profile.phone })
    .eq("id", await userId());
  if (error) throw new Error(`Could not save the profile: ${error.message}`);
  return parsed.profile;
}
