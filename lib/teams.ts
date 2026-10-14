/**
 * Team accounts: the roles, who may do what to whom, and what the database's refusals mean.
 *
 * Client-safe and pure, so the Team section can offer only the buttons that will work and
 * `npm run test:billing` can hold these rules to the SQL. The DATABASE decides — the org_* functions
 * in supabase/migrations/0012_teams.sql check every one of these again, with the caller read from the
 * session — so a rule wrong here costs a button that errors, never an action that should have been
 * refused. TEAMS.md says the same rules in plain words.
 *
 * Dormant: nothing reaches any of this while TEAMS_ENABLED is off (lib/teamsGate.ts), except
 * `canManageBilling`, which is true for every account today because everyone owns their own
 * organization.
 */

export type OrgRole = "owner" | "admin" | "member";
/** Ownership is handed over (org_transfer_ownership), never invited into. */
export type InviteRole = Exclude<OrgRole, "owner">;

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];
export const INVITE_ROLES: readonly InviteRole[] = ["member", "admin"];

/** How long an invite link works. Must equal `interval '7 days'` in org_invite_create. */
export const INVITE_TTL_DAYS = 7;
/** Invites one organization may send in a rolling day. Must equal the limit in org_invite_create. */
export const INVITES_PER_DAY = 20;

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === "string" && (INVITE_ROLES as readonly string[]).includes(value);
}

export function roleLabel(role: OrgRole): string {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}

/** The plan, the card and the invoices: the owner's alone. Alone in an organization, that is you. */
export function canManageBilling(role: OrgRole | null | undefined): boolean {
  return role === "owner";
}

/** Owner and admins see every claim by default; a member sees their own (a view rule, not a boundary). */
export function seesWholeOrganization(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Who may send, list and withdraw invites. */
export function canManageInvites(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** An admin invites members; only the owner invites admins. */
export function canInvite(actor: OrgRole | null | undefined, as: InviteRole): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return as === "member";
  return false;
}

/** Only the owner changes roles, never their own, never anyone's to or from owner. */
export function canChangeRole(actor: OrgRole | null | undefined, target: OrgRole, isSelf: boolean): boolean {
  return actor === "owner" && !isSelf && target !== "owner";
}

/** Admins remove members; the owner removes admins too; nobody removes the owner or themselves. */
export function canRemove(actor: OrgRole | null | undefined, target: OrgRole, isSelf: boolean): boolean {
  if (isSelf || target === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member";
  return false;
}

/** The owner hands the organization over before leaving; everyone else may simply go. */
export function canLeave(role: OrgRole | null | undefined): boolean {
  return role === "admin" || role === "member";
}

/** The owner hands the organization to anyone else already in it. */
export function canTransferTo(actor: OrgRole | null | undefined, isSelf: boolean): boolean {
  return actor === "owner" && !isSelf;
}

/**
 * The address an invite goes to, as org_invite_create stores it — trimmed and lower-cased — or null
 * when it is not an address at all. The same shape test as the SQL, so the form refuses what the
 * database would.
 */
export function normaliseInviteEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/**
 * The org_* functions' SQLSTATEs (0012_teams.sql, HOW SQL TALKS BACK) as an HTTP status and a
 * sentence. The app reads the code, never Postgres's message, which is written for whoever reads the
 * migration.
 */
export const TEAM_ERRORS: Record<string, { status: number; message: string }> = {
  "28000": { status: 401, message: "Not signed in." },
  "42501": { status: 403, message: "Your role in this organization doesn’t allow that." },
  P0002: { status: 404, message: "That invitation is no longer valid. Ask for a new one." },
  "22023": { status: 400, message: "That request wasn’t understood." },
  "23505": { status: 409, message: "That person is already on the team." },
  P0402: { status: 409, message: "Every seat on the plan is taken. Free one, or add seats to the plan." },
  P0429: { status: 429, message: `That’s ${INVITES_PER_DAY} invitations today. Try again tomorrow.` },
  P0410: { status: 409, message: "You’re on another team. Leave it from your Account page, then open this invitation again." },
  P0411: { status: 409, message: "You own an organization with other people in it. Make one of them the owner first." },
  P0412: { status: 409, message: "Your own account has a plan. Cancel it from Manage billing first — the team’s plan covers you." },
  P0414: { status: 403, message: "This invitation was sent to a different email address. Sign in with that address to accept it." },
};

export function teamErrorFor(code: string | null | undefined): { status: number; message: string } | null {
  return code ? (TEAM_ERRORS[code] ?? null) : null;
}

export type InviteStatus = "open" | "accepted" | "declined" | "revoked" | "expired";

/** What the invite page says about an invitation that cannot be accepted any more. */
export function inviteStatusMessage(status: InviteStatus): string | null {
  switch (status) {
    case "open":
      return null;
    case "accepted":
      return "This invitation has already been accepted.";
    case "declined":
      return "This invitation was declined.";
    case "revoked":
      return "This invitation was withdrawn. Ask whoever sent it for a new one.";
    case "expired":
      return `This invitation has expired — they last ${INVITE_TTL_DAYS} days. Ask whoever sent it for a new one.`;
  }
}
