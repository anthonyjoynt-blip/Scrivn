import { NextResponse } from "next/server";
import { loadTeam } from "@/lib/teamRepo";
import { isTeamsEnabled } from "@/lib/teamsGate";
import { teamErrorResponse, teamsOff } from "./respond";

/**
 * The signed-in person's team: the organization, its people with their roles, and — for an owner or
 * admin — the invitations still open. Any member may list the team; the database decides what each
 * role sees (org_members, and the invites table's owner-and-admin policy, 0012_teams.sql).
 *
 * 404 while TEAMS_ENABLED is off.
 */
export async function GET() {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    return NextResponse.json({ team: await loadTeam() });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
