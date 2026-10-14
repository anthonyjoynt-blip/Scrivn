import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = {
  title: "Delete your Scrivn account",
  description: "How to delete your Scrivn or Scrivn Scan account, and what is deleted with it.",
};

/** The signed-in person and whether anyone else is in their organization; null when signed out. */
async function whoIsAsking(): Promise<{ email: string; alone: boolean } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) return null;
    const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", user.id).limit(1).maybeSingle();
    let alone = true;
    if (typeof membership?.organization_id === "string") {
      const { count } = await supabase.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", membership.organization_id);
      alone = (count ?? 1) <= 1;
    }
    return { email: user.email ?? "", alone };
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/**
 * How to delete an account (sa-delete) — scrivn.ca/account/delete, the URL given to Google Play.
 *
 * Google requires a web page that explains deletion to someone who is NOT signed in, besides the
 * button in the app; so the page is public (middleware.ts), says what deleting does and the ways to
 * do it, and, signed in, has the form. What actually goes is lib/accountDeletion.ts; the words here
 * must stay true to it and to PRIVACY.md.
 */
export default async function DeleteAccountPage() {
  const person = await whoIsAsking();

  return (
    <main>
      <h1>Delete your account</h1>
      <p className="subtitle">For Scrivn and Scrivn Scan: they share one account.</p>

      <div className="card">
        <h2>What is deleted</h2>
        <ul className="plain-list">
          <li>Your sign-in, your name and contact details, and the phones paired to your account. They are deleted at once and can&rsquo;t be recovered.</li>
          <li>
            If nobody else is in your company&rsquo;s account: its claims, scans, photos, letterhead and logo, all deleted at once, and any plan cancelled straight away (the time
            already paid for is not refunded).
          </li>
          <li>If you&rsquo;re on a team: you leave it. The claims stay with the team, because they belong to the company.</li>
          <li>Problem reports you sent from Scrivn Scan while signed in.</li>
        </ul>
        <h2>What is kept</h2>
        <ul className="plain-list">
          <li>Payment records, which Stripe keeps as tax law requires.</li>
          <li>A one-way scrambled copy of your email address, so the free trial can&rsquo;t be claimed again. It can&rsquo;t be turned back into your address.</li>
        </ul>
      </div>

      {person ? (
        <div className="card">
          <h2>Delete your account now</h2>
          <DeleteAccountForm email={person.email} alone={person.alone} />
        </div>
      ) : (
        <div className="card">
          <h2>How to delete it</h2>
          <ul className="plain-list">
            <li>
              <strong>On the web:</strong> <Link href="/login?next=/account/delete">sign in</Link> and come back to this page, or open Account and choose Delete account.
            </li>
            <li>
              <strong>In Scrivn Scan:</strong> tap Account, then Delete account.
            </li>
            <li>
              <strong>By email:</strong> write to privacy@scrivn.ca from the address on the account, and we&rsquo;ll delete it within 30 days.
            </li>
          </ul>
          <p className="field-note">You&rsquo;ll be asked for your password. Forgotten it? <Link href="/forgot-password">Choose a new one</Link> first.</p>
        </div>
      )}
    </main>
  );
}
