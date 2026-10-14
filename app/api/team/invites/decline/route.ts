import { NextResponse } from "next/server";
import { declineInvite } from "@/lib/teamRepo";
import { isTeamsEnabled } from "@/lib/teamsGate";
import { jsonBody, teamErrorResponse, teamsOff } from "../../respond";

/**
 * The invited person says no: `{ token }`. Signed in, so the page has someone to show the answer to;
 * someone who does not want an account can simply ignore the email, and the invitation lapses after
 * seven days. 404 for an invitation that was not open.
 *
 * 404 while TEAMS_ENABLED is off.
 */
export async function POST(request: Request) {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    const body = await jsonBody(request);
    if (!(await declineInvite(body?.token))) return NextResponse.json({ error: "That invitation is no longer open." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
