import { NextResponse } from "next/server";
import { transferOwnership } from "@/lib/teamRepo";
import { isTeamsEnabled } from "@/lib/teamsGate";
import { jsonBody, teamErrorResponse, teamsOff } from "../respond";

/**
 * The owner hands the organization to someone already on the team: `{ userId }`. They become the
 * owner — the plan, its billing and the letterhead are theirs to manage from then on — and the
 * previous owner becomes an admin (org_transfer_ownership, 0012_teams.sql). The Stripe customer's
 * email stays the previous owner's until it is changed in the billing portal (STRIPE.md).
 *
 * 404 while TEAMS_ENABLED is off.
 */
export async function POST(request: Request) {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    const body = await jsonBody(request);
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!(await transferOwnership(userId))) return NextResponse.json({ error: "Team member not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
