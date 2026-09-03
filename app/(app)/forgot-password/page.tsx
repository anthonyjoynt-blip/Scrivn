"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * Step one of the password reset: enter an address, get a reset link emailed.
 *
 * The emailed link lands on `/auth/confirm`, which exchanges its token for a (recovery) session and
 * forwards to `/reset-password` — that session is what lets the next page set a new password, and
 * why `/reset-password` is a protected route rather than a public one.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    // Shown whether or not that address has an account — same reasoning as the signup form: a
    // different message for "no such user" would turn this into an account-enumeration oracle.
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <main className="login-main">
        <div className="card login-card">
          <h1>Check your email</h1>
          <p className="subtitle">
            If an account exists for <strong>{email.trim()}</strong>, we’ve sent it a link to reset the password.
          </p>
          <p className="field-note">The link can only be used once, and expires after a while.</p>
          <div className="auth-links">
            <Link href="/login">Back to sign in</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="login-main">
      <div className="card login-card">
        <h1>Reset your password</h1>
        <p className="subtitle">Enter the email address on your account and we’ll send you a reset link.</p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="prompt" htmlFor="forgot-email">
              Email
            </label>
            <input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="actions-row login-actions-row">
            <button type="submit" className="btn-primary" disabled={loading || email.trim() === ""}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </div>
        </form>
        <div className="auth-links">
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    </main>
  );
}
