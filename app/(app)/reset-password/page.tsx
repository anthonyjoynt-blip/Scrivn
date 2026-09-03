"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Matches the signup form's floor — the two should never disagree about what a valid password is. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Step two of the password reset: set the new password.
 *
 * Reached only via the emailed link, which passes through `/auth/confirm` and establishes a real
 * recovery session first. That session is the authorization for `updateUser` below — there's no
 * token handling in this file because it already happened. It's also why this page is NOT in
 * `middleware.ts`'s public list: someone arriving here without that session has nothing proving
 * they own the account, and gets sent to `/login`.
 */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Those passwords don’t match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // Full navigation so the middleware re-reads the updated session cookies.
    window.location.href = "/claim";
  }

  return (
    <main className="login-main">
      <div className="card login-card">
        <h1>Set a new password</h1>
        <p className="subtitle">Choose a new password for your account.</p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="prompt" htmlFor="reset-password">
              New password
            </label>
            <input id="reset-password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <p className="field-note">At least {MIN_PASSWORD_LENGTH} characters.</p>
          </div>
          <div className="auth-field">
            <label className="prompt" htmlFor="reset-password-confirm">
              Confirm new password
            </label>
            <input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="actions-row login-actions-row">
            <button type="submit" className="btn-primary" disabled={loading || password === "" || confirmPassword === ""}>
              {loading ? "Saving…" : "Save new password"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
