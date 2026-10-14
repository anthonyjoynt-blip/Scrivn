import { NextResponse } from "next/server";
import { TeamInviteEmail } from "@/emails/TeamInvite";
import { sendEmail } from "@/lib/email/send";
import { loadProfile } from "@/lib/profileRepo";
import { createInvite, inviteUrl } from "@/lib/teamRepo";
import { isTeamsEnabled } from "@/lib/teamsGate";
import { jsonBody, teamErrorResponse, teamsOff } from "../respond";

/**
 * An owner or admin invites someone: `{ email, role }`, role "member" or "admin".
 *
 * The database decides whether they may (an admin invites members, only the owner invites admins),
 * whether there is a seat, and whether the day's 20 are used up — org_invite_create, 0012_teams.sql.
 * Then the email goes out through the app's own Resend sender. If it does not go, the invitation
 * still stands and the answer says why, with the link, so it can be passed on another way: the link
 * is no use to anyone not signed in as the address invited.
 *
 * 404 while TEAMS_ENABLED is off — and so no invitation email can be sent while teams are dormant.
 */
export async function POST(request: Request) {
  if (!isTeamsEnabled()) return teamsOff();
  try {
    const body = await jsonBody(request);
    const { invite, organizationName, token } = await createInvite(body?.email, body?.role);
    const url = inviteUrl(token);

    const inviter = await loadProfile().catch(() => null);
    const sent = await sendEmail({
      to: invite.email,
      subject: `You’re invited to join ${organizationName} on Scrivn`,
      react: TeamInviteEmail({
        organizationName,
        inviterName: inviter?.fullName ?? null,
        role: invite.role,
        acceptUrl: url,
        expiresOn: new Date(invite.expiresAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }),
      }),
    });

    return NextResponse.json({ invite, url, emailed: sent.ok, ...(sent.ok ? {} : { emailError: sent.reason }) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
