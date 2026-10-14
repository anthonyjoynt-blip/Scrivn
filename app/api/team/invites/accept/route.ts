import { NextResponse } from "next/server";
import { acceptInvite } from "@/lib/teamRepo";
import { isTeamsEnabled } from "@/lib/teamsGate";
import { jsonBody, teamErrorResponse, teamsOff } from "../../respond";

/**
 * The invited person accepts: `{ token }`, from the link in their email.
 *
 * Signed in, with the confirmed address the invitation was sent to. Alone in their own organization
 * with no plan, they join and their own organization is set aside, claims and all; anywhere else the
 * answer says what to do first (leave the other team, hand theirs over, cancel their plan). The
 * rules are org_invite_accept's, 0012_teams.sql, and the sentences lib/teams.ts's.
 *
 * 404 while TEAMS_ENABLED is off.
 */
export async function POST(request: Request) {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    const body = await jsonBody(request);
    return NextResponse.json({ joined: await acceptInvite(body?.token) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
