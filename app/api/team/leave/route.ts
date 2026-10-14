import { NextResponse } from "next/server";
import { leaveTeam } from "@/lib/teamRepo";
import { isTeamsEnabled } from "@/lib/teamsGate";
import { teamErrorResponse, teamsOff } from "../respond";

/**
 * An admin or member leaves the team and goes back to their own organization — the one they set
 * aside to join, claims as they left them, or a new one if theirs became a team someone else owns.
 * The owner cannot leave until they have handed the organization over (org_leave, 0012_teams.sql).
 *
 * 404 while TEAMS_ENABLED is off.
 */
export async function POST() {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    return NextResponse.json({ organizationId: await leaveTeam() });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
