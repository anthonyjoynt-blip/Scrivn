"use client";

import { useState } from "react";

/**
 * The form on /account/delete: the password again, a box that says what goes, and one button.
 * Posts to /api/account/delete (lib/accountDeletion.ts). On success the browser's session is gone
 * with the account, so the page says so and offers nothing that needs one.
 */
export function DeleteAccountForm({ email, alone }: { email: string; alone: boolean }) {
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Your account couldn't be deleted just now. Try again, or email privacy@scrivn.ca.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't reach Scrivn. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="delete-account-done" role="status">
        <p>
          <strong>Your account has been deleted.</strong> You&rsquo;re signed out, and an email confirming it is on its way to {email || "your address"}.
        </p>
        <p>
          <a href="/">Back to scrivn.ca</a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="delete-account-form">
      <p>
        Signed in as <strong>{email}</strong>.{" "}
        {alone
          ? "You're the only person in your company's account, so its claims, scans and photos are deleted too."
          : "Other people are in your company's account: you'll leave it, and its claims stay with them."}
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="auth-field">
        <label className="prompt" htmlFor="delete-password">
          Your password
        </label>
        <input id="delete-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <label className="delete-account-check">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        <span>I understand this can&rsquo;t be undone.</span>
      </label>
      <div className="actions-row">
        <button type="submit" className="btn-danger" disabled={busy || !understood || password === ""}>
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </form>
  );
}
