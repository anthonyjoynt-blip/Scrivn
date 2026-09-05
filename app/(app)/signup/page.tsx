"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PRIVACY_POLICY_URL, TERMS_URL } from "@/lib/legal";

/** Supabase's own default floor is 6; 8 is a small, free improvement and the server stays authoritative. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Whether this deployment invites the public to create an account.
 *
 * Fails CLOSED: open only when the variable is exactly "true", so a missing or misspelt value shows
 * the invite-only panel rather than throwing the doors open. `NEXT_PUBLIC_` because this page is a
 * Client Component and the value is a display decision, not a secret — the real gate is Supabase's,
 * as the panel's comment explains.
 */
const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "true";

/**
 * The post-signup destination from this page's `?next=`, constrained to a same-site path.
 * Taking it raw would make the confirmation email a redirect to anywhere — the link is attacker-
 * composable, so `//evil.example` (a protocol-relative URL browsers treat as another origin) has to
 * be rejected as firmly as `https://evil.example`.
 */
function safeNext(): string {
  // Default is /claim, not / — / is the public marketing home, and someone who just signed up is
  // here to use the tool.
  if (typeof window === "undefined") return "/claim";
  const value = new URLSearchParams(window.location.search).get("next");
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/claim";
  return value;
}

/**
 * Email + password sign-up, with Supabase's email-confirmation step enabled — so a successful
 * submit does NOT sign the user in. It creates an unconfirmed account and sends a verification
 * link, and this page switches to a "check your email" state instead of redirecting anywhere.
 *
 * `full_name` and `company_name` ride along in `options.data`, which Supabase stores on the auth
 * user's `raw_user_meta_data`. A database trigger copies them into `public.profiles` when the row
 * is created — see `supabase/migrations/0001_profiles.sql`. That's why there's no "create the
 * profile" call anywhere in this file: doing it here would leave a hole for accounts created any
 * other way (an admin invite, a future social login), and would need elevated permissions to write
 * a row for a user who isn't signed in yet.
 */
export default function SignUpPage() {
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Where the emailed link comes back to. `/auth/confirm` verifies the token and then sends
        // them on, already signed in.
        //
        // `next` is carried through from this page's own query string so an interrupted intent
        // survives the whole signup round trip — someone who clicked Subscribe while signed out
        // lands back on `/pricing?checkout=<tier>` after confirming, and checkout resumes by
        // itself. Without this the confirmation link would always dump them on the home page with
        // no memory of what they were trying to buy.
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(safeNext())}`,
        data: { full_name: fullName.trim(), company_name: companyName.trim() },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Deliberately not branching on whether this address already had an account. Supabase returns a
    // success-shaped response either way precisely so this form can't be used to enumerate who has
    // one; showing the same message keeps that property intact. A real existing user gets an email
    // telling them so.
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <main className="login-main">
        <div className="card login-card">
          <h1>Check your email</h1>
          <p className="subtitle">
            We sent a confirmation link to <strong>{email.trim()}</strong>. Click it to finish setting up your account — you’ll be signed in automatically.
          </p>
          <p className="field-note">Nothing arrived? Check spam, or give it a minute before trying again.</p>
          <div className="auth-links">
            <Link href="/login">Back to sign in</Link>
          </div>
        </div>
      </main>
    );
  }

  /*
    Invite-only, while Scrivn is deployed but not yet a product anyone can buy.

    This panel is HONESTY, not enforcement. Sign-up runs in the browser against Supabase's public
    anon key, so anyone who can read this page's JavaScript can call `auth.signUp` directly whatever
    this component renders. The switch that actually refuses a new account is Supabase's own
    "Allow new users to sign up", in the project dashboard — see SIGNUPS.md.

    What this does is stop the app inviting someone to fill in a form that the backend will reject,
    and stop a stranger who wandered in from spending five trial claims of Anthropic credit.
  */
  if (!SIGNUPS_OPEN) {
    return (
      <main className="login-main">
        <div className="card login-card">
          <h1>Scrivn is invite-only right now</h1>
          <p className="subtitle">
            We&rsquo;re not opening accounts to everyone yet. If you&rsquo;ve been given an account, sign in below — otherwise get in touch and
            we&rsquo;ll let you know when it opens up.
          </p>
          <div className="auth-links">
            <Link href="/login">Sign in</Link>
            <Link href="/contact">Get in touch</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="login-main">
      <div className="card login-card">
        <h1>Create your account</h1>
        <p className="subtitle">Set up a Scrivn account to start building scopes.</p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="prompt" htmlFor="signup-name">
              Full name
            </label>
            <input id="signup-name" type="text" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
          </div>
          <div className="auth-field">
            <label className="prompt" htmlFor="signup-company">
              Company <span className="field-hint">(optional)</span>
            </label>
            <input id="signup-company" type="text" autoComplete="organization" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="auth-field">
            <label className="prompt" htmlFor="signup-email">
              Email
            </label>
            <input id="signup-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="auth-field">
            <label className="prompt" htmlFor="signup-password">
              Password
            </label>
            <input id="signup-password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="field-note">At least {MIN_PASSWORD_LENGTH} characters.</p>
          </div>
          {/*
            Stated at the point of signing up, not buried in a footer.

            A tick-box would be worse here, not better: it is one more thing to click past, and it
            implies the policy is a hurdle rather than something to read. A plain sentence next to the
            button says what happens and links to it, which is what somebody actually needs — and this
            product goes on to store the personal information of THEIR customers, who never see this
            screen at all.
          */}
          <p className="field-note signup-legal">
            By creating an account you agree to our{" "}
            {TERMS_URL && (
              <>
                <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
                  Terms and Conditions
                </a>
                {" and "}
              </>
            )}
            <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
            .
          </p>
          <div className="actions-row login-actions-row">
            <button type="submit" className="btn-primary" disabled={loading || fullName.trim() === "" || email.trim() === "" || password === ""}>
              {loading ? "Creating account…" : "Create account"}
            </button>
          </div>
        </form>
        <div className="auth-links">
          <span>
            Already have an account? <Link href="/login">Sign in</Link>
          </span>
        </div>
      </div>
    </main>
  );
}
