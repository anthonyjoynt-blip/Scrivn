"use client";

import { useState } from "react";

/**
 * Accept or decline, on the invite page. The page has already checked that the person signed in is
 * the one invited; the database checks it again, and everything else (org_invite_accept,
 * 0012_teams.sql). A refusal comes back as a sentence that says what to do first — leave another
 * team, hand theirs over, cancel their own plan — and is shown as it comes.
 */
export function TeamInviteAnswer({ token, organizationName }: { token: string; organizationName: string }) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  async function answer(kind: "accept" | "decline") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/team/invites/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "That didn’t work just now. Please try again.");
      if (kind === "accept") {
        // A different organization from here on: its claims, letterhead and plan.
        window.location.assign("/claims");
        return;
      }
      setDeclined(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn’t work just now. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (declined) {
    return <p className="subtitle">Declined. Nothing has changed, and {organizationName} won’t see you on the team.</p>;
  }

  return (
    <>
      {error && <p className="letterhead-status">{error}</p>}
      <div className="actions-row" style={{ justifyContent: "center" }}>
        <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void answer("decline")}>
          {busy === "decline" ? "Declining…" : "Decline"}
        </button>
        <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void answer("accept")}>
          {busy === "accept" ? "Joining…" : `Join ${organizationName}`}
        </button>
      </div>
    </>
  );
}
