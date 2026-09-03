import Link from "next/link";

/**
 * Where `/auth/confirm` sends anyone whose emailed link didn't verify. That's almost always one of
 * three ordinary things rather than anything alarming — the link was already used, it expired, or
 * only part of it survived being copied out of an email client — so this says so plainly and
 * offers the two ways forward instead of showing an error code.
 */
export default function AuthCodeErrorPage() {
  return (
    <main className="login-main">
      <div className="card login-card">
        <h1>This link didn’t work</h1>
        <p className="subtitle">
          It may have already been used, expired, or been cut short when it was copied. Signing in again will send you a fresh one.
        </p>
        <div className="auth-links">
          <Link href="/login">Back to sign in</Link>
          <Link href="/forgot-password">Send a new password reset link</Link>
        </div>
      </div>
    </main>
  );
}
