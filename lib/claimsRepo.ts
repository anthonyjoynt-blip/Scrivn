import "server-only";
import { createClient } from "./supabase/server";
import { withClockSkewRetry } from "./supabase/clockSkew";
import { CLAIM_STATUS_ORDER, claimSummary, parseSavedClaimState, type ClaimStatus, type SavedClaimState } from "./claimState";
import { isOrgRole, seesWholeOrganization, type OrgRole } from "./teams";
import { devClaims, devClaimsMode } from "./devClaimsStore";

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
  address: string;
  insurer: string;
  step: string;
  status: string;
  updatedAt: string;
  /** The claim's version — `updated_at` exactly as stored; see `StoredClaim`. */
  version: string;
  createdAt: string;
  createdBy: string | null;
  /** True when this session's user started it — drives the "mine" filter and the list's own labelling. */
  mine: boolean;
}

export type ClaimSort = "updated" | "status" | "customer";
export type ClaimScope = "mine" | "all";

export interface ClaimListOptions {
  /** Matched against customer name, job number, address and insurer together. */
  search?: string;
  sort?: ClaimSort;
  scope?: ClaimScope;
}

export interface ClaimListResult {
  claims: ClaimListItem[];
  /** What was actually applied — `scope` may be forced back to "mine" for a member. */
  scope: ClaimScope;
  /** Whether this user may switch to the whole organization at all. */
  canSeeAll: boolean;
}

/**
 * The searchable text, as one expression.
 *
 * Must stay character-for-character identical to the index in 0005_claim_list_columns.sql. If the
 * two drift the query still WORKS — it just stops using the index and quietly becomes a sequential
 * scan over every claim in the organization, which is the kind of regression nobody notices until
 * there are enough claims for it to hurt.
 */
const SEARCH_EXPRESSION =
  "coalesce(customer_name, '') || ' ' || coalesce(job_number, '') || ' ' || coalesce(address, '') || ' ' || coalesce(insurer, '')";

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
 * The organization this session belongs to, and the role they hold in it.
 *
 * `.limit(1)` and take the first: a person belongs to exactly one organization at a time — a unique
 * index holds it since 0012_teams.sql, and a person joining a team leaves their own (TEAMS.md).
 * Throwing on none is deliberate — every account gets an organization at signup and the 0004
 * backfill covered the ones that predate it, so no organization means something is wrong that
 * silently saving nowhere would hide.
 */
export async function currentMembership(): Promise<{ userId: string; organizationId: string; role: OrgRole }> {
  const supabase = await createClient();
  const userId = await currentUserId();
  // The first query of most requests, so the one that meets a just-refreshed token — see clockSkew.ts.
  const { data, error } = await withClockSkewRetry(() => supabase.from("organization_members").select("organization_id, role").eq("user_id", userId).limit(1));
  if (error) throw new Error(`Could not read organization membership: ${error.message}`);
  const first = data?.[0];
  if (!first) throw new NoOrganizationError();
  return { userId, organizationId: first.organization_id as string, role: isOrgRole(first.role) ? first.role : "member" };
}

export async function currentOrganizationId(): Promise<string> {
  return (await currentMembership()).organizationId;
}

/** This session's role in their organization. Owner and admins may view the whole organization's claims. */
export async function currentRole(): Promise<OrgRole> {
  const supabase = await createClient();
  const userId = await currentUserId();
  const { data, error } = await withClockSkewRetry(() => supabase.from("organization_members").select("role").eq("user_id", userId).limit(1));
  if (error) throw new Error(`Could not read organization role: ${error.message}`);
  const role = data?.[0]?.role;
  return isOrgRole(role) ? role : "member";
}

export async function listClaims(options: ClaimListOptions = {}): Promise<ClaimListResult> {
  if (devClaimsMode()) return devClaims.list(options);
  const supabase = await createClient();
  const userId = await currentUserId();
  const role = await currentRole();
  const canSeeAll = seesWholeOrganization(role);

  /*
    A member asking for "all" gets "mine" instead, rather than an error.

    Enforced HERE and not only by hiding the toggle, because the toggle is a URL parameter and
    anybody can type one. It is still not a security boundary — RLS in 0004 permits any member to
    read any claim in their own organization, deliberately, so teammates can cover for each other.
    This is the default and what the UI offers, and it is the reason nobody is handed the whole
    company's claims by accident.
  */
  const scope: ClaimScope = options.scope === "all" && canSeeAll ? "all" : "mine";

  // No organization filter — RLS already restricts this to the caller's organizations, and a filter
  // would only duplicate it. What matters is not selecting the payload, which is explicit below.
  let query = supabase
    .from("claims")
    .select("id, customer_name, job_number, address, insurer, step, status, updated_at, created_at, created_by");

  if (scope === "mine") query = query.eq("created_by", userId);

  const search = options.search?.trim();
  if (search) {
    /*
      One `ilike` against the four fields concatenated, matching the trigram index in 0005. The
      alternative — four `or`-ed ilikes — reads more naturally and cannot use that index, so it would
      scan the table.

      Commas and parentheses are stripped from the term because PostgREST's filter grammar uses them
      as separators; a customer named "Smith, J" would otherwise be parsed as two filters rather than
      searched for.
    */
    const safe = search.replace(/[,()]/g, " ").trim();
    if (safe) query = query.filter(SEARCH_EXPRESSION, "ilike", `%${safe}%`);
  }

  const sort = options.sort ?? "updated";
  switch (sort) {
    case "status":
      /*
        Ordered by updated_at here and re-ordered by pipeline position below.

        Sorting on the column itself would be alphabetical, which puts "contents_pending" above
        "intake" and "documents" above "gap_check" — an order that looks deliberate and means
        nothing. The real order is CLAIM_STATUS_ORDER, which SQL has no way to know. Doing it in
        memory is fine at this size and honest about where the ordering actually lives; if these
        lists ever get big enough for that to matter, the fix is a numeric column, not a guess here.
      */
      query = query.order("updated_at", { ascending: false });
      break;
    case "customer":
      query = query.order("customer_name", { ascending: true }).order("updated_at", { ascending: false });
      break;
    default:
      query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not list claims: ${error.message}`);

  const claims = (data ?? []).map((row) => ({
      id: row.id as string,
      customerName: (row.customer_name as string) ?? "",
      jobNumber: (row.job_number as string) ?? "",
      address: (row.address as string) ?? "",
      insurer: (row.insurer as string) ?? "",
      step: (row.step as string) ?? "intake",
      status: (row.status as string) ?? "intake",
      updatedAt: row.updated_at as string,
      version: row.updated_at as string,
      createdAt: row.created_at as string,
      createdBy: (row.created_by as string | null) ?? null,
      mine: row.created_by === userId,
  }));

  if (sort === "status") {
    // Unknown statuses sort last rather than first, so a label nobody recognises does not head the
    // list — see the deliberate absence of a CHECK constraint in 0005.
    const rank = (s: string) => {
      const i = CLAIM_STATUS_ORDER.indexOf(s as ClaimStatus);
      return i === -1 ? CLAIM_STATUS_ORDER.length : i;
    };
    claims.sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt));
  }

  return { scope, canSeeAll, claims };
}

/**
 * A claim as stored, with the version it is at.
 *
 * The version is the row's `updated_at`, exactly as the database wrote it (2026-10-13, offline mode).
 * The database sets it on every write — `claims_touch_updated_at` in 0004 — so it changes whenever
 * the claim does and no caller can forget to move it on, which is all a version has to do. It is
 * passed around as the database's own string and never parsed: a JavaScript Date keeps
 * milliseconds and the column keeps microseconds, and a version that had been through one would
 * never match again.
 */
export interface StoredClaim {
  state: SavedClaimState;
  version: string;
}

/** One claim's full state, or null when it does not exist OR belongs to another organization. */
export async function loadClaim(id: string): Promise<StoredClaim | null> {
  if (devClaimsMode()) return devClaims.load(id);
  const supabase = await createClient();
  const { data, error } = await supabase.from("claims").select("payload, updated_at").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load claim: ${error.message}`);
  if (!data) return null;
  return { state: parseSavedClaimState(data.payload), version: data.updated_at as string };
}

/** A claim id chosen on the device that the server will not take. See `createClaim`. */
export class ClaimIdTakenError extends Error {
  constructor() {
    super("That claim id cannot be used.");
    this.name = "ClaimIdTakenError";
  }
}

/**
 * Create a claim, returning its id and version.
 *
 * `organization_id` comes from the session, never from the caller — see this file's doc comment.
 *
 * ── The id, when the device chose it ─────────────────────────────────────────────────────────────
 *
 * A claim started with no signal is given its id ON THE PHONE (a random UUID), because it has to be
 * opened, reloaded and worked on for hours before the server hears of it. Sending that id here is
 * what makes creating it safe to repeat: the request that creates a claim is exactly the one most
 * likely to lose its answer on one bar, and with a server-chosen id the retry made a second claim.
 * With the device's, the retry finds the first.
 *
 * So an id that already exists is answered with that row's version and `existed`, when the row is
 * visible to this user — it is this device's own claim, created by an attempt whose answer never
 * arrived. The caller then saves over it as an ordinary save. An id that exists but is NOT visible
 * belongs to another organization (or is a guess); that is refused with the same error a bad id
 * gets, so it says nothing about anyone else's claims.
 */
export async function createClaim(state: SavedClaimState, id?: string): Promise<{ id: string; version: string; existed: boolean }> {
  if (devClaimsMode()) return devClaims.create(state, id);
  const supabase = await createClient();
  const organizationId = await currentOrganizationId();
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("claims")
    .insert({ ...(id ? { id } : {}), organization_id: organizationId, created_by: userId, ...claimSummary(state), payload: state })
    .select("id, updated_at")
    .single();
  if (error) {
    // 23505: unique_violation — the id is already a row.
    if (id && error.code === "23505") {
      const { data: existing } = await supabase.from("claims").select("id, updated_at").eq("id", id).maybeSingle();
      if (existing) return { id, version: existing.updated_at as string, existed: true };
      throw new ClaimIdTakenError();
    }
    throw new Error(`Could not create claim: ${error.message}`);
  }
  return { id: data.id as string, version: data.updated_at as string, existed: false };
}

export type SaveResult =
  | { ok: true; version: string }
  /** No such claim, or one RLS hides — see the route's note on why the two are not told apart. */
  | { ok: false; reason: "missing" }
  /** The claim moved on since `base`; `current` is what it is now. */
  | { ok: false; reason: "conflict"; current: StoredClaim };

/**
 * Overwrite a claim.
 *
 * Whole-payload replacement rather than a patch. The state is one coherent object — an extraction
 * tree and the answers folded into it have to agree — and merging two partial saves from two devices
 * would produce a claim that never existed on either.
 *
 * ── `base`: the version this save was made from ──────────────────────────────────────────────────
 *
 * Given, the write only lands if the claim is still at that version — one UPDATE with both
 * conditions in its WHERE, so there is no gap between checking and writing for another save to slip
 * into (Postgres re-checks the condition against the row a concurrent writer left). If it has moved
 * on, nothing is written and the claim as it now stands comes back, so the device can keep both and
 * ask. This is what stops a phone that worked offline for a day silently overwriting what the office
 * did to the same claim in that day.
 *
 * Without `base` the write is unconditional, last write wins, as every save was before offline mode
 * — kept for a browser still running the previous build, which sends none.
 *
 * Zero rows updated is also what RLS refusing the row looks like: the policy makes another
 * organization's claim invisible rather than raising.
 */
export async function saveClaim(id: string, state: SavedClaimState, base?: string): Promise<SaveResult> {
  if (devClaimsMode()) return devClaims.save(id, state, base);
  const supabase = await createClient();
  let update = supabase
    .from("claims")
    .update({ ...claimSummary(state), payload: state })
    .eq("id", id);
  if (base) update = update.eq("updated_at", base);
  const { data, error } = await update.select("updated_at");
  if (error) throw new Error(`Could not save claim: ${error.message}`);
  const row = (data ?? [])[0];
  if (row) return { ok: true, version: row.updated_at as string };
  if (!base) return { ok: false, reason: "missing" };
  const current = await loadClaim(id);
  return current ? { ok: false, reason: "conflict", current } : { ok: false, reason: "missing" };
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
  if (devClaimsMode()) return devClaims.remove(id);
  const supabase = await createClient();
  const { data, error } = await supabase.from("claims").delete().eq("id", id).select("id");
  if (error) throw new Error(`Could not delete claim: ${error.message}`);
  return (data ?? []).length > 0;
}
