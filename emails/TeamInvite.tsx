import { Button, Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * An invitation to join an organization on Scrivn (team accounts, 0012_teams.sql). Sent by
 * POST /api/team/invites, which answers 404 while TEAMS_ENABLED is off — so while teams are dormant
 * this is never sent.
 *
 * The link carries the invitation's token. It is no use to anyone but the person invited: accepting
 * also needs them signed in with this address, which the last paragraph tells them.
 */
export function TeamInviteEmail({
  organizationName,
  inviterName,
  role,
  acceptUrl,
  expiresOn,
}: {
  organizationName: string;
  inviterName?: string | null;
  role: "admin" | "member";
  acceptUrl: string;
  expiresOn: string;
}) {
  const who = inviterName?.trim() || "Someone";
  const as = role === "admin" ? "an admin" : "a member";

  return (
    <EmailLayout preview={`${who} invited you to join ${organizationName} on Scrivn.`} heading={`Join ${organizationName} on Scrivn`}>
      <Text style={emailStyles.paragraph}>
        {who} has invited you to join {organizationName} on Scrivn as {as}.
      </Text>
      <Text style={emailStyles.paragraph}>
        Scrivn turns a site walkthrough into an inspection report and a scope document. On a team, everyone works from the same claims, the same letterhead and the same plan.
      </Text>
      <Section style={{ margin: "24px 0 8px" }}>
        <Button href={acceptUrl} style={emailStyles.button}>
          Accept the invitation
        </Button>
      </Section>
      <Text style={emailStyles.muted}>
        Sign in with this email address to accept. The link works until {expiresOn}. If you weren’t expecting this, you can ignore it and nothing will change.
      </Text>
    </EmailLayout>
  );
}

export default TeamInviteEmail;
