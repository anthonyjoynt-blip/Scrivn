/**
 * Whether team accounts are switched on. OFF.
 *
 * The owner, 2026-10-13: "team accounts we should at least have an infrastructure to employ later
 * for when it becomes necessary." Everything is built — the plan on the organization
 * (0011_org_billing.sql), roles and invites (0012_teams.sql), the /api/team routes, the Team section
 * of the Account page, the invite page and its email — and all of it waits behind this. While it is
 * off, every /api/team route answers 404 before it reads anything, the Team section is not rendered,
 * the invite page is a 404, and no invite email can be sent. TEAMS.md lists what else turning it on
 * involves.
 *
 * Fails CLOSED, like BILLING_ENABLED (lib/billingGate.ts): on only for the exact string "true". A
 * missing or misspelt value leaves teams off, which costs nothing; the other way round would put
 * invitations in front of people the first time someone forgot a variable.
 *
 * Not `server-only`, because middleware.ts reads it to open the invite page to signed-out visitors —
 * and only then. It reads a server variable, so in a browser bundle it is always false.
 */
export function isTeamsEnabled(): boolean {
  return process.env.TEAMS_ENABLED === "true";
}

/** The path of the page an invitation email links to. */
export const TEAM_INVITE_PATH = "/team/invite";
