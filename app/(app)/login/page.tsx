"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * Email + password sign-in.
 *
 * When social providers get added later, they slot in as a divider plus a row of provider buttons
 * directly beneath this form — the form itself doesn't change shape to accommodate them, which is
 * why it's a self-contained block rather than something interleaved with the links below it.
 *
 * The post-sign-in `next` path is read from `window.location` at submit time rather than through
 * `useSearchParams`, which would force this page (and every page sharing its layout) behind a
 * Suspense boundary purely to read one optional string.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (signInError) {
      // Supabase deliberately returns the same "Invalid login credentials" for a wrong password and
      // an address that was never registered, so an attacker can't use this form to discover which
      // emails have accounts. Pass it through as-is rather than "helpfully" distinguishing them.
      setError(signInError.message === "Email not confirmed" ? "Check your email and confirm your address before signing in." : signInError.message);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    // Falls back to /claim rather than /, which is the public marketing home.
    const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/claim";
    // A full navigation rather than client-side routing, so the middleware re-reads the freshly-set
    // auth cookies before the app renders.
    window.location.href = destination;
  }

  return (
    <main className="login-main">
      <div className="card login-card">
        <h1>Sign in</h1>
        <p className="subtitle">Sign in to Scrivn to build a scope.</p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="prompt" htmlFor="login-email">
              Email
            </label>
            <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="auth-field">
            <label className="prompt" htmlFor="login-password">
              Password
            </label>
            <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="actions-row login-actions-row">
            <button type="submit" className="btn-primary" disabled={loading || email.trim() === "" || password === ""}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
        <div className="auth-links">
          <Link href="/forgot-password">Forgot your password?</Link>
          <span>
            Don’t have an account? <Link href="/signup">Create one</Link>
          </span>
        </div>
      </div>
    </main>
  );
}
