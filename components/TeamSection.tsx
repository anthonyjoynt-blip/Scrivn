"use client";

import { useEffect, useState } from "react";
import type { TeamInvite, TeamMember, TeamState } from "@/lib/teamRepo";
import { INVITE_TTL_DAYS, canChangeRole, canInvite, canLeave, canManageInvites, canRemove, canTransferTo, roleLabel, type InviteRole } from "@/lib/teams";

/**
 * The Team section of the Account page: who is in the organization, inviting more, and the few
 * things an owner or admin may do to them. Rendered only while TEAMS_ENABLED is on — see the
 * account page — so dormant, nobody sees it.
 *
 * It offers only what the person's role allows (lib/teams.ts), and the database checks every one of
 * those again (0012_teams.sql). Two-step buttons for the things that are hard to undo — removing
 * someone, handing the organization over, leaving — as Paired phones does for revoking a phone.
 *
 * Built from the classes Paired phones already uses, so it adds nothing to the stylesheet.
 */

type Confirm = { kind: "remove" | "transfer"; userId: string } | { kind: "leave" } | null;
type Notice = { kind: "ok" | "error"; text: string; link?: string } | null;

const SELECT_STYLE: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.88rem",
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "var(--surface)",
  color: "var(--text)",
};

async function send(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "That didn’t work just now. Please try again.");
  return json ?? {};
}

export function TeamSection({ initial }: { initial: TeamState }) {
  const [team, setTeam] = useState<TeamState>(initial);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirm>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // Dates are the viewer's, not the server's: drawn once mounted, as Paired phones does.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const manages = canManageInvites(team.role);
  const seatsUsed = team.members.length + team.invites.length;

  async function refresh() {
    const body = await send("/api/team", "GET");
    if (body.team) setTeam(body.team as TeamState);
  }

  async function act(key: string, work: () => Promise<Notice | void>) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await work();
      if (result) setNotice(result);
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "That didn’t work just now. Please try again." });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    void act("invite", async () => {
      const body = await send("/api/team/invites", "POST", { email, role: inviteRole });
      setEmail("");
      await refresh();
      const to = (body.invite as TeamInvite | undefined)?.email ?? email;
      if (body.emailed) return { kind: "ok", text: `Invitation sent to ${to}. The link works for ${INVITE_TTL_DAYS} days.` };
      return {
        kind: "error",
        text: `The invitation to ${to} is ready, but the email didn’t send (${String(body.emailError ?? "unknown reason")}). Send them this link another way — it only works for someone signed in as ${to}:`,
        link: typeof body.url === "string" ? body.url : undefined,
      };
    });
  }

  function handleWithdraw(invite: TeamInvite) {
    void act(`withdraw:${invite.id}`, async () => {
      await send(`/api/team/invites/${invite.id}`, "DELETE");
      setTeam((t) => ({ ...t, invites: t.invites.filter((i) => i.id !== invite.id) }));
      return { kind: "ok", text: `Invitation to ${invite.email} withdrawn.` };
    });
  }

  function handleRole(member: TeamMember, role: InviteRole) {
    void act(`role:${member.userId}`, async () => {
      await send(`/api/team/members/${member.userId}`, "PATCH", { role });
      setTeam((t) => ({ ...t, members: t.members.map((m) => (m.userId === member.userId ? { ...m, role } : m)) }));
      return { kind: "ok", text: `${member.fullName || member.email} is now ${role === "admin" ? "an admin" : "a member"}.` };
    });
  }

  function handleRemove(member: TeamMember) {
    void act(`remove:${member.userId}`, async () => {
      await send(`/api/team/members/${member.userId}`, "DELETE");
      setTeam((t) => ({ ...t, members: t.members.filter((m) => m.userId !== member.userId) }));
      return { kind: "ok", text: `${member.fullName || member.email} is off the team. The claims they started stay here.` };
    });
  }

  function handleTransfer(member: TeamMember) {
    void act(`transfer:${member.userId}`, async () => {
      await send("/api/team/transfer", "POST", { userId: member.userId });
      // Everything this page shows depends on being the owner; draw it again as an admin.
      window.location.reload();
    });
  }

  function handleLeave() {
    void act("leave", async () => {
      await send("/api/team/leave", "POST");
      // A different organization now: its claims, letterhead and plan. Start from the claims list.
      window.location.assign("/claims");
    });
  }

  return (
    <div className="paired-phones">
      <p className="field-note" style={{ margin: "0 0 16px" }}>
        {team.organizationName || "Your organization"} — you are {team.role === "owner" ? "the owner" : team.role === "admin" ? "an admin" : "a member"}.
        {team.scanOnly
          ? " The Scan plan covers one person. To bring others in, move to a Scrivn plan: it covers the whole team and includes Scan."
          : team.seatLimit !== null
            ? ` ${seatsUsed} of ${team.seatLimit} seats used, counting open invitations.`
            : ""}
      </p>

      <ul className="paired-phones-list">
        {team.members.map((member) => {
          const changeable = canChangeRole(team.role, member.role, member.isYou);
          const removable = canRemove(team.role, member.role, member.isYou);
          const transferable = canTransferTo(team.role, member.isYou);
          const confirmingThis = confirming !== null && confirming.kind !== "leave" && confirming.userId === member.userId ? confirming.kind : null;
          return (
            <li key={member.userId} className="paired-phone">
              <div className="paired-phone-main">
                <span className="paired-phone-name">
                  {member.fullName || member.email}
                  {member.isYou ? " (you)" : ""}
                </span>
                <span className="paired-phone-meta">
                  <span>{member.email}</span>
                  <span className="paired-phone-used">{roleLabel(member.role)}</span>
                </span>
              </div>
              {confirmingThis ? (
                <span className="paired-phone-actions">
                  <span className="field-note">{confirmingThis === "remove" ? "Remove from the team?" : "Make them the owner? You become an admin."}</span>
                  <button type="button" className="btn-secondary" onClick={() => setConfirming(null)} disabled={busy !== null}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => (confirmingThis === "remove" ? handleRemove(member) : handleTransfer(member))}
                    disabled={busy !== null}
                  >
                    {busy?.endsWith(member.userId) ? "Working…" : confirmingThis === "remove" ? "Remove" : "Make owner"}
                  </button>
                </span>
              ) : changeable || removable || transferable ? (
                <span className="paired-phone-actions">
                  {changeable && (
                    <select
                      style={SELECT_STYLE}
                      value={member.role}
                      disabled={busy !== null}
                      aria-label={`Role for ${member.fullName || member.email}`}
                      onChange={(e) => handleRole(member, e.target.value as InviteRole)}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                  {transferable && (
                    <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => setConfirming({ kind: "transfer", userId: member.userId })}>
                      Make owner
                    </button>
                  )}
                  {removable && (
                    <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => setConfirming({ kind: "remove", userId: member.userId })}>
                      Remove
                    </button>
                  )}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {manages && team.invites.length > 0 && (
        <>
          <p className="field-note" style={{ margin: "16px 0 8px" }}>
            Waiting for an answer
          </p>
          <ul className="paired-phones-list">
            {team.invites.map((invite) => (
              <li key={invite.id} className="paired-phone">
                <div className="paired-phone-main">
                  <span className="paired-phone-name">{invite.email}</span>
                  <span className="paired-phone-meta">
                    <span>{roleLabel(invite.role)}</span>
                    {mounted && <span className="paired-phone-used">Link works until {new Date(invite.expiresAt).toLocaleDateString()}</span>}
                  </span>
                </div>
                <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => handleWithdraw(invite)}>
                  {busy === `withdraw:${invite.id}` ? "Withdrawing…" : "Withdraw"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* On the Scan plan an invitation could only be refused (one person, SCAN_SEATS): the sentence above says why instead. */}
      {manages && !team.scanOnly && (
        <form className="letterhead-form" onSubmit={handleInvite} style={{ marginTop: 16 }}>
          <div className="auth-field">
            <label className="prompt" htmlFor="team-invite-email">
              Invite someone
            </label>
            <input
              id="team-invite-email"
              type="text"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              maxLength={254}
              placeholder="name@company.ca"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="field-note">They’ll get an email with a link. To accept, they sign in to Scrivn with that address.</p>
          </div>
          <div className="actions-row">
            {canInvite(team.role, "admin") ? (
              <select style={SELECT_STYLE} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as InviteRole)} aria-label="Invite as">
                <option value="member">As a member</option>
                <option value="admin">As an admin</option>
              </select>
            ) : null}
            <button type="submit" className="btn-primary" disabled={busy !== null || email.trim() === ""}>
              {busy === "invite" ? "Sending…" : "Send invitation"}
            </button>
          </div>
        </form>
      )}

      {notice && (
        <p className={`letterhead-status${notice.kind === "ok" ? " is-saved" : ""}`}>
          {notice.text}
          {notice.link && (
            <>
              {" "}
              <code style={{ wordBreak: "break-all" }}>{notice.link}</code>
            </>
          )}
        </p>
      )}

      {canLeave(team.role) && (
        <div className="actions-row">
          {confirming?.kind === "leave" ? (
            <>
              <span className="field-note">Leave {team.organizationName || "the team"}? You go back to your own account; the claims you started stay here.</span>
              <button type="button" className="btn-secondary" onClick={() => setConfirming(null)} disabled={busy !== null}>
                Cancel
              </button>
              <button type="button" className="btn-danger" onClick={handleLeave} disabled={busy !== null}>
                {busy === "leave" ? "Leaving…" : "Leave team"}
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setConfirming({ kind: "leave" })} disabled={busy !== null}>
              Leave team
            </button>
          )}
        </div>
      )}

      <p className="field-note">
        Everyone on the team sees and edits the team’s claims and shares its plan. Admins invite and remove members; only the owner manages admins, billing and the
        letterhead.
      </p>
    </div>
  );
}
