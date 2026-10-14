import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { TeamInviteAnswer } from "@/components/TeamInviteAnswer";
import { createClient } from "@/lib/supabase/server";
import { loadTeam, previewInvite, ownClaimCount, type InvitePreview } from "@/lib/teamRepo";
import { inviteStatusMessage } from "@/lib/teams";
import { TEAM_INVITE_PATH, isTeamsEnabled } from "@/lib/teamsGate";

/**
 * Where an invitation email lands: who invited you to what, and Join or Decline.
 *
 * A 404 while TEAMS_ENABLED is off — the same page a path that does not exist gets. When teams are
 * on, middleware.ts lets a signed-out visitor reach it (an invitation is often opened before signing
 * in) and the page asks them to sign in as the address invited; it reads nothing of anyone's account
 * until they have.
 *
 * The token in the link is the only thing that finds the invitation (org_invite_preview,
 * 0012_teams.sql). It is never echoed into the page except inside the sign-in link that brings the
 * visitor back here.
 */
export default async function TeamInvitePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  if (!isTeamsEnabled()) notFound();

  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";

  let preview: InvitePreview | null = null;
  let unavailable = false;
  try {
    preview = await previewInvite(token);
  } catch (err) {
    unstable_rethrow(err);
    console.error("[team/invite] preview failed:", err);
    unavailable = true;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedInEmail = typeof data?.claims?.email === "string" ? data.claims.email.trim().toLowerCase() : null;

  if (unavailable) {
    return <Shell heading="Invitation">Invitations can’t be opened right now. Please try the link again in a few minutes.</Shell>;
  }
  if (!preview) {
    return <Shell heading="Invitation not found">This invitation link isn’t valid. Check that the whole link was copied, or ask whoever sent it for a new one.</Shell>;
  }

  const stopped = inviteStatusMessage(preview.status);
  if (stopped) {
    return <Shell heading={`Joining ${preview.organizationName}`}>{stopped}</Shell>;
  }

  const who = preview.invitedByName || "Someone";
  const as = preview.role === "admin" ? "an admin" : "a member";
  const until = new Date(preview.expiresAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const here = `${TEAM_INVITE_PATH}?token=${encodeURIComponent(token)}`;

  if (!signedInEmail) {
    return (
      <Shell heading={`Join ${preview.organizationName}`}>
        <p className="subtitle">
          {who} invited <strong>{preview.email}</strong> to join {preview.organizationName} on Scrivn as {as}.
        </p>
        <p className="subtitle">Sign in with that address to accept. The invitation is open until {until}.</p>
        <div className="actions-row" style={{ justifyContent: "center" }}>
          <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn-primary">
            Sign in to accept
          </Link>
        </div>
        <p className="field-note">No Scrivn account yet? One needs making for {preview.email} first — ask {preview.invitedByName || "whoever invited you"} if you can’t sign up — then open this link again.</p>
      </Shell>
    );
  }

  if (signedInEmail !== preview.email) {
    return (
      <Shell heading={`Join ${preview.organizationName}`}>
        <p className="subtitle">
          This invitation is for <strong>{preview.email}</strong>, and you’re signed in as <strong>{signedInEmail}</strong>.
        </p>
        <p className="subtitle">Sign out, sign in as {preview.email}, and open the link again.</p>
        <form action="/api/logout" method="post" className="actions-row" style={{ justifyContent: "center" }}>
          <button type="submit" className="btn-secondary">
            Sign out
          </button>
        </form>
      </Shell>
    );
  }

  // Alone in their own organization: say plainly what happens to it. Anywhere else, accepting will
  // say what to do first, in the database's words (lib/teams.ts).
  let ownClaims: number | null = null;
  try {
    const current = await loadTeam();
    if (current.members.length === 1) ownClaims = await ownClaimCount();
  } catch (err) {
    unstable_rethrow(err);
  }

  return (
    <Shell heading={`Join ${preview.organizationName}`}>
      <p className="subtitle">
        {who} invited you to join {preview.organizationName} on Scrivn as {as}. Everyone on the team works from the same claims, letterhead and plan.
      </p>
      {ownClaims !== null && (
        <p className="field-note">
          {ownClaims > 0
            ? `Your own ${ownClaims} saved claim${ownClaims === 1 ? "" : "s"} stay${ownClaims === 1 ? "s" : ""} with your own account, out of the team’s sight, and come back if you leave the team.`
            : "Your own account is set aside while you’re on the team, and comes back if you leave."}
        </p>
      )}
      <TeamInviteAnswer token={token} organizationName={preview.organizationName} />
    </Shell>
  );
}

function Shell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="login-main">
      <div className="card login-card">
        <h1>{heading}</h1>
        {typeof children === "string" ? <p className="subtitle">{children}</p> : children}
        <div className="auth-links">
          <Link href="/claims">Go to Scrivn</Link>
        </div>
      </div>
    </main>
  );
}
