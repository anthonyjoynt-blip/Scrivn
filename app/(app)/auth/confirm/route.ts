import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { WelcomeEmail } from "@/emails/Welcome";

/**
 * Where every emailed auth link lands — both the "confirm your email" link from signup and the
 * "reset your password" link from the forgot-password flow. Supabase puts a single-use
 * `token_hash` in the link; `verifyOtp` exchanges it for a real session and sets the auth cookies.
 *
 * For this to be the URL Supabase actually sends, the project's email templates must point here
 * rather than at the default `{{ .ConfirmationURL }}` — see `supabase/README.md` for the exact
 * template bodies and the redirect-allowlist entries this needs.
 *
 * `next` decides where the user ends up afterwards: `/` for a signup confirmation (straight into
 * the app, already signed in), `/reset-password` for a recovery link. It's constrained to a
 * same-site path below — taking it raw would make this an open redirect, since the value arrives
 * from a URL anyone can edit.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // The welcome email fires here because this is the moment a user becomes confirmed, and only
      // for `type === "email"`: a password-recovery link also lands on this route and verifies
      // successfully, and welcoming someone who just reset their password would be nonsense.
      //
      // Naturally once-only without any "already sent" flag — verifyOtp tokens are single-use, so a
      // second visit to the same link fails above and never reaches this branch.
      if (type === "email") {
        // The trial clock starts when the account becomes usable, not when the form was submitted.
        // Someone who signs up and confirms a fortnight later should still get a full 30 days.
        await startTrialWindow(data.user?.id ?? null);
        await sendWelcomeEmail(data.user?.email ?? null, (data.user?.user_metadata?.full_name as string | undefined) ?? null, new URL(request.url).origin);
      }
      // `redirect` throws internally to unwind — it must not sit inside a try/catch here.
      redirect(next);
    }
  }

  redirect("/auth/auth-code-error");
}

/**
 * Restarts the 30-day trial window at confirmation time.
 *
 * The column already defaults to now() at signup, so this is a correction rather than the only
 * write — which is why a failure here is survivable and deliberately swallowed: the worst outcome
 * is a trial measured from signup instead of confirmation, not a broken account. Uses the admin
 * client because trial columns are not user-writable (migration 0003).
 */
async function startTrialWindow(userId: string | null): Promise<void> {
  if (!userId) return;
  try {
    await createAdminClient().from("profiles").update({ trial_started_at: new Date().toISOString() }).eq("id", userId);
  } catch (err) {
    console.error("[auth/confirm] could not set trial start (confirmation still succeeded):", err);
  }
}

/**
 * Best-effort welcome. Never allowed to break confirmation: if Resend is down or unconfigured, the
 * user is still confirmed and signed in — an email they don't strictly need must not cost them
 * their account setup. `sendEmail` already swallows and logs its own failures; this guards the
 * render step too.
 */
async function sendWelcomeEmail(email: string | null, fullName: string | null, origin: string): Promise<void> {
  if (!email) return;
  try {
    await sendEmail({
      to: email,
      subject: "Welcome to Scrivn",
      // /claim, not the origin — the site root is the public marketing page, and the button says
      // "Start your first claim".
      react: WelcomeEmail({ fullName, appUrl: `${origin}/claim` }),
    });
  } catch (err) {
    console.error("[auth/confirm] welcome email failed (confirmation still succeeded):", err);
  }
}

/**
 * Only ever a path on this site: must start with exactly one "/" (a value like "//evil.example"
 * is a protocol-relative URL that browsers happily treat as another origin).
 */
function safeNext(value: string | null): string {
  // Default is /claim, not / — / is the public marketing home; a just-confirmed account lands on
  // the tool.
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/claim";
  return value;
}
