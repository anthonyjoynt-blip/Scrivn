import "server-only";
import { createClient } from "./supabase/server";
import { withClockSkewRetry } from "./supabase/clockSkew";
import { currentMembership } from "./claimsRepo";
import { appUrl, hashSecret, looksLikeDeviceToken, newDeviceToken } from "./deviceCodes";
import { TEAM_INVITE_PATH } from "./teamsGate";
import { isBillingSchemaMissing as isSchemaMissing } from "./usageState";
import { isScanTier } from "./plans";
import { canManageInvites, isInviteRole, isOrgRole, normaliseInviteEmail, teamErrorFor, type InviteRole, type InviteStatus, type OrgRole } from "./teams";

/**
 * Every read and write behind team accounts, in one place — the posture of `claimsRepo.ts` and
 * `deviceRepo.ts`: nothing here is the boundary. Each call runs through the signed-in person's own
 * client, so RLS applies to every select, and every change goes through an org_* SECURITY DEFINER
 * function in 0012_teams.sql that reads the caller from `auth.uid()` and checks their role itself.
 * The service-role client is not imported.
 *
 * Dormant: only the /api/team routes and the invite page call this, and they answer 404 while
 * TEAMS_ENABLED is off (lib/teamsGate.ts).
 *
 * ── Invite tokens ────────────────────────────────────────────────────────────────────────────────
 *
 * Made here (256 random bits, `newDeviceToken`), emailed in a link, and handed to the database only
 * as their SHA-256 (`hashSecret`), which the database hashes again before storing — the same
 * arrangement as a paired phone's token. The token comes back to the inviter in the response too,
 * so a link can be copied when email is not configured; that gives nothing away, because accepting
 * also needs a session whose confirmed address is the one invited.
 *
 * ── How SQL talks back ───────────────────────────────────────────────────────────────────────────
 *
 * The functions raise fixed SQLSTATEs and this file reads `error.code`, never the message; lib/teams.ts
 * turns each code into a status and a sentence. A function or column that does not exist means 0011
 * or 0012 has not been applied, which gets its own sentence rather than a stack trace.
 */

export class TeamError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "TeamError";
  }
}

export class TeamsUnavailableError extends Error {
  constructor() {
    super("Team accounts aren’t set up on this database yet (migrations 0011 and 0012).");
    this.name = "TeamsUnavailableError";
  }
}

export interface TeamMember {
  userId: string;
  fullName: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
  isYou: boolean;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: InviteRole;
  createdAt: string;
  expiresAt: string;
}

export interface TeamState {
  organizationId: string;
  organizationName: string;
  /** The signed-in person's role. */
  role: OrgRole;
  members: TeamMember[];
  /** Open invites — only for an owner or admin, empty for a member. */
  invites: TeamInvite[];
  /** People the plan covers; null = no limit. */
  seatLimit: number | null;
  /** On the Scan plan alone, which covers one person (SCAN_SEATS): the section says so instead of offering invitations. */
  scanOnly: boolean;
}

export interface InvitePreview {
  organizationName: string;
  email: string;
  role: InviteRole;
  invitedByName: string;
  expiresAt: string;
  status: InviteStatus;
}

function fromPostgres(error: { code?: string | null; message: string }): Error {
  if (isSchemaMissing(error)) return new TeamsUnavailableError();
  const known = teamErrorFor(error.code);
  if (known) return new TeamError(known.status, known.message, error.code ?? null);
  return new Error(error.message);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(id: string, what: string): string {
  if (!UUID.test(id)) throw new TeamError(404, `${what} not found.`);
  return id;
}

/** A token of the shape `newDeviceToken` makes, or a refusal that names no reason — the same one an unknown token gets. */
function requireToken(token: unknown): string {
  if (typeof token !== "string" || !looksLikeDeviceToken(token)) {
    const invalid = teamErrorFor("P0002")!;
    throw new TeamError(invalid.status, invalid.message, "P0002");
  }
  return token;
}

/** The link an invitation email carries. Built from the configured address, never a request's Host header. */
export function inviteUrl(token: string): string {
  return `${appUrl()}${TEAM_INVITE_PATH}?token=${encodeURIComponent(token)}`;
}

/** Everything the Team section shows: the organization, its people, and — for an owner or admin — its open invites. */
export async function loadTeam(): Promise<TeamState> {
  const { userId, organizationId, role } = await currentMembership();
  const supabase = await createClient();

  const [orgResult, membersResult, invitesResult] = await Promise.all([
    withClockSkewRetry(() => supabase.from("organizations").select("name, seat_limit, subscription_tier").eq("id", organizationId).maybeSingle()),
    supabase.rpc("org_members"),
    canManageInvites(role)
      ? supabase
          .from("organization_invites")
          .select("id, email, role, created_at, expires_at")
          .eq("organization_id", organizationId)
          .is("accepted_at", null)
          .is("declined_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [orgResult, membersResult, invitesResult]) {
    if (result.error) throw fromPostgres(result.error);
  }

  const members = ((membersResult.data ?? []) as { user_id: string; full_name: string; email: string; role: string; joined_at: string }[]).map((m) => ({
    userId: m.user_id,
    fullName: m.full_name ?? "",
    email: m.email ?? "",
    role: isOrgRole(m.role) ? m.role : "member",
    joinedAt: m.joined_at,
    isYou: m.user_id === userId,
  }));
  const invites = ((invitesResult.data ?? []) as { id: string; email: string; role: string; created_at: string; expires_at: string }[]).map((i) => ({
    id: i.id,
    email: i.email,
    role: isInviteRole(i.role) ? i.role : "member",
    createdAt: i.created_at,
    expiresAt: i.expires_at,
  }));

  return {
    organizationId,
    organizationName: (orgResult.data?.name as string | undefined) ?? "",
    role,
    members,
    invites,
    seatLimit: (orgResult.data?.seat_limit as number | null | undefined) ?? null,
    scanOnly: isScanTier(orgResult.data?.subscription_tier as string | null | undefined),
  };
}

/** Invites an address. The database checks the inviter's role, seats and the daily limit. */
export async function createInvite(emailInput: unknown, roleInput: unknown): Promise<{ invite: TeamInvite; organizationName: string; token: string }> {
  const email = normaliseInviteEmail(emailInput);
  if (!email) throw new TeamError(400, "Enter the email address to invite.");
  if (!isInviteRole(roleInput)) throw new TeamError(400, "Choose member or admin.");

  const token = newDeviceToken();
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_invite_create", { invite_email: email, invite_role: roleInput, token_hash: hashSecret(token) }));
  if (error) throw fromPostgres(error);
  const row = (Array.isArray(data) ? data[0] : data) as { invite_id: string; organization_name: string; expires_at: string } | null;
  if (!row) throw new Error("The invitation was not created.");
  return {
    invite: { id: row.invite_id, email, role: roleInput, createdAt: new Date().toISOString(), expiresAt: row.expires_at },
    organizationName: row.organization_name,
    token,
  };
}

/** Withdraws an open invite. False when there was none to withdraw (the route says 404). */
export async function revokeInvite(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_invite_revoke", { invite_id: requireUuid(id, "Invitation") }));
  if (error) throw fromPostgres(error);
  return data === true;
}

/** What the invite page shows, from the token alone — signed in or not. Null for a token that is no invitation. */
export async function previewInvite(token: unknown): Promise<InvitePreview | null> {
  if (typeof token !== "string" || !looksLikeDeviceToken(token)) return null;
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_invite_preview", { token_hash: hashSecret(token) }));
  if (error) throw fromPostgres(error);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { organization_name: string; email: string; role: string; invited_by_name: string; expires_at: string; status: string }
    | null
    | undefined;
  if (!row) return null;
  return {
    organizationName: row.organization_name,
    email: row.email,
    role: isInviteRole(row.role) ? row.role : "member",
    invitedByName: row.invited_by_name ?? "",
    expiresAt: row.expires_at,
    status: (["open", "accepted", "declined", "revoked", "expired"] as const).find((s) => s === row.status) ?? "revoked",
  };
}

/** Accepts for the signed-in person. Their own organization is set aside if they were alone in it (TEAMS.md). */
export async function acceptInvite(token: unknown): Promise<{ organizationId: string; organizationName: string; role: OrgRole }> {
  const hash = hashSecret(requireToken(token));
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_invite_accept", { token_hash: hash }));
  if (error) throw fromPostgres(error);
  const row = (Array.isArray(data) ? data[0] : data) as { organization_id: string; organization_name: string; role: string } | null;
  if (!row) throw new Error("The invitation was not accepted.");
  return { organizationId: row.organization_id, organizationName: row.organization_name, role: isOrgRole(row.role) ? row.role : "member" };
}

/** Declines. False for an invitation that was not open. */
export async function declineInvite(token: unknown): Promise<boolean> {
  const hash = hashSecret(requireToken(token));
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_invite_decline", { token_hash: hash }));
  if (error) throw fromPostgres(error);
  return data === true;
}

/** The owner makes someone an admin or a member. False when they are not in the organization. */
export async function setMemberRole(userId: string, role: unknown): Promise<boolean> {
  if (!isInviteRole(role)) throw new TeamError(400, "Choose member or admin.");
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_member_set_role", { member_id: requireUuid(userId, "Team member"), new_role: role }));
  if (error) throw fromPostgres(error);
  return data === true;
}

/** An owner or admin takes someone off the team; they go back to their own organization. */
export async function removeMember(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_member_remove", { member_id: requireUuid(userId, "Team member") }));
  if (error) throw fromPostgres(error);
  return data === true;
}

/** The signed-in admin or member leaves, back to their own organization, whose id comes back. */
export async function leaveTeam(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_leave"));
  if (error) throw fromPostgres(error);
  return data as string;
}

/** The owner hands the organization to someone already in it, and becomes an admin. */
export async function transferOwnership(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("org_transfer_ownership", { new_owner: requireUuid(userId, "Team member") }));
  if (error) throw fromPostgres(error);
  return data === true;
}

/** How many claims the signed-in person's organization holds — what the invite page says stays behind. */
export async function ownClaimCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await withClockSkewRetry(() => supabase.from("claims").select("id", { count: "exact", head: true }));
  if (error) return 0;
  return count ?? 0;
}
