import { NextResponse } from "next/server";
import { removeMember, setMemberRole } from "@/lib/teamRepo";
import { isTeamsEnabled } from "@/lib/teamsGate";
import { jsonBody, teamErrorResponse, teamsOff } from "../../respond";

/**
 * One person on the team.
 *
 *   PATCH  { role: "admin" | "member" }   the owner changes their role
 *   DELETE                                an owner or admin takes them off the team
 *
 * Who may do which to whom is org_member_set_role's and org_member_remove's to decide (0012_teams.sql):
 * admins remove members, only the owner promotes, demotes or removes admins, nobody removes the owner.
 * Someone removed goes back to their own organization; the claims they started stay with the team.
 * 404 when the person is not on the caller's team.
 *
 * 404 while TEAMS_ENABLED is off.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    const { userId } = await params;
    const body = await jsonBody(request);
    if (!(await setMemberRole(userId, body?.role))) return NextResponse.json({ error: "Team member not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return teamErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    const { userId } = await params;
    if (!(await removeMember(userId))) return NextResponse.json({ error: "Team member not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
