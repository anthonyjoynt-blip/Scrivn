import "server-only";
import { createClient } from "./supabase/server";
import { claimSummary, parseSavedClaimState, type SavedClaimState } from "./claimState";

/**
 * Every read and write of a saved claim, in one place.
 *
 * ── The security posture ─────────────────────────────────────────────────────────────────────────
 *
 * Nothing here is what stops one organization reading another's claims. Row Level Security is
 * (0004_organizations_and_claims.sql), and it holds regardless of what this file does — including if
 * a future caller forgets a `.eq("organization_id", ...)`, which is exactly the mistake that would
 * otherwise leak a claim.
 *
 * What this file adds is that every query runs through the USER'S OWN client, carrying their
 * session, so the policies apply. The service-role client in `supabase/admin.ts` bypasses RLS
 * entirely and is deliberately not imported here — it exists for the Stripe webhook, which has no
 * user session at all. Using it for claim access would silently switch the protection off.
 *
 * ── On not passing an organization id in from the caller ─────────────────────────────────────────
 *
 * `currentOrganizationId` resolves the organization from the session rather than accepting one as a
 * parameter. A parameter would be attacker-supplied on any route that took it from a request body,
 * and while RLS would still refuse the write, the failure would be a confusing error rather than a
 * request that never had a chance of naming someone else's tenant.
 */

/** The claims list needs none of the payload; a hundred rows must not mean a hundred sketches. */
export interface ClaimListItem {
  id: string;
  customerName: string;
  jobNumber: string;
  step: string;
  updatedAt: string;
  createdAt: string;
}

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "NotSignedInError";
  }
}

export class NoOrganizationError extends Error {
  constructor() {
    super("This account has no organization yet.");
    this.name = "NoOrganizationError";
  }
}

async function currentUserId(): Promise<string> {
  const supabase = await createClient();
  // getUser(), never getSession(): getSession reads the cookie without verifying it, so a forged
  // cookie would satisfy it. getUser() checks with the auth server.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new NotSignedInError();
  return data.user.id;
}

/**
 * The organization this session belongs to.
 *
 * `.limit(1)` and take the first: a user has exactly one organization today, and when teams arrive
 * this becomes "the one they have selected". Throwing on none is deliberate — every account gets an
 * organization at signup and the 0004 backfill covered the ones that predate it, so no organization
 * means something is wrong that silently saving nowhere would hide.
 */
export async function currentOrganizationId(): Promise<string> {
  const supabase = await createClient();
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw new Error(`Could not read organization membership: ${error.message}`);
  const first = data?.[0];
  if (!first) throw new NoOrganizationError();
  return first.organization_id as string;
}

export async function listClaims(): Promise<ClaimListItem[]> {
  const supabase = await createClient();
  // No organization filter here on purpose — RLS already restricts this to the caller's
  // organizations, and a filter would only duplicate it. Selecting the payload is what is being
  // avoided, and that is explicit in the column list.
  const { data, error } = await supabase
    .from("claims")
    .select("id, customer_name, job_number, step, updated_at, created_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not list claims: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    customerName: (row.customer_name as string) ?? "",
    jobNumber: (row.job_number as string) ?? "",
    step: (row.step as string) ?? "intake",
    updatedAt: row.updated_at as string,
    createdAt: row.created_at as string,
  }));
}

/** One claim's full state, or null when it does not exist OR belongs to another organization. */
export async function loadClaim(id: string): Promise<SavedClaimState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("claims").select("payload").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load claim: ${error.message}`);
  if (!data) return null;
  return parseSavedClaimState(data.payload);
}

/**
 * Create a claim, returning its id.
 *
 * `organization_id` comes from the session, never from the caller — see this file's doc comment.
 */
export async function createClaim(state: SavedClaimState): Promise<string> {
  const supabase = await createClient();
  const organizationId = await currentOrganizationId();
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("claims")
    .insert({ organization_id: organizationId, created_by: userId, ...claimSummary(state), payload: state })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create claim: ${error.message}`);
  return data.id as string;
}

/**
 * Overwrite a claim.
 *
 * Whole-payload replacement rather than a patch. The state is one coherent object — an extraction
 * tree and the answers folded into it have to agree — and merging two partial saves from two devices
 * would produce a claim that never existed on either. Last write wins, which is the honest behaviour
 * for a tool one person uses at a time.
 *
 * Returns false when nothing was updated, which is what RLS refusing the row looks like: the policy
 * makes another organization's claim invisible rather than raising, so an update matches zero rows.
 */
export async function saveClaim(id: string, state: SavedClaimState): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("claims")
    .update({ ...claimSummary(state), payload: state })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`Could not save claim: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Delete a claim outright.
 *
 * A real DELETE, not a flag. Everything about the claim lives in this row — the sketch geometry, the
 * extraction, the generated documents — so removing it removes all of it. That matters because the
 * data is about people who never signed up for this system: "deleted" has to mean the row is gone,
 * not hidden from a list while still sitting in the table.
 *
 * Returns false when nothing was deleted, which again is what RLS refusing looks like.
 */
export async function deleteClaim(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("claims").delete().eq("id", id).select("id");
  if (error) throw new Error(`Could not delete claim: ${error.message}`);
  return (data ?? []).length > 0;
}
