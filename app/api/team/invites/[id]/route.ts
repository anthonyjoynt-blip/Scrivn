import { NextResponse } from "next/server";
import { revokeInvite } from "@/lib/teamRepo";
import { isTeamsEnabled } from "@/lib/teamsGate";
import { teamErrorResponse, teamsOff } from "../../respond";

/**
 * Withdraw an open invitation. Its link stops working. An owner or admin of the organization it is
 * for; anyone else, an invitation already answered, and an id never issued all get the same 404, so
 * the answer confirms nothing about which ids are real.
 *
 * 404 while TEAMS_ENABLED is off.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    const { id } = await params;
    if (!(await revokeInvite(id))) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
