import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { LetterheadForm } from "@/components/LetterheadForm";
import { PairedPhones } from "@/components/PairedPhones";
import { ProfileForm } from "@/components/ProfileForm";
import { loadProfile, type Profile } from "@/lib/profileRepo";
import { NotSignedInError, currentRole } from "@/lib/claimsRepo";
import { listDeviceTokens, type DeviceTokenItem } from "@/lib/deviceRepo";
import { loadOrganizationLetterhead, type OrganizationLetterheadState } from "@/lib/organizationRepo";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getUsageState } from "@/lib/usage";
import { TRIAL_CLAIM_LIMIT, TRIAL_DAYS, planForTier } from "@/lib/plans";

/** The person's details, or null for no card — nobody signed in, which here only happens in the dev fail-open. */
async function profileCard(): Promise<Profile | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    return await loadProfile();
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof NotSignedInError) return null;
    console.error("[account] profile unavailable:", err);
    return null;
  }
}

/**
 * The letterhead card's data, or why there is none.
 *
 * Null means "no card": nobody is signed in, which on this page only happens in the dev fail-open.
 * An error means the card renders with the reason instead of the form — the likeliest one being
 * the 0005 migration not yet applied to the database this build is pointed at, which should read
 * as one sentence on the page rather than take the whole account page down with it.
 */
async function letterheadCard(): Promise<{ state: OrganizationLetterheadState } | { error: string } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    return { state: await loadOrganizationLetterhead() };
  } catch (err) {
    // Next signals "this page reads cookies, render it per request" by THROWING from `cookies()`
    // during the build's prerender pass. Swallowing that here would bake the error card into a
    // static page; rethrowing lets the route go dynamic, which is what it is.
    unstable_rethrow(err);
    if (err instanceof NotSignedInError) return null;
    console.error("[account] letterhead unavailable:", err);
    return { error: "Letterhead settings aren’t available right now. Your documents will carry the Scrivn letterhead until they are." };
  }
}

/**
 * The paired phones card's data, or why there is none — the same three outcomes as `letterheadCard`,
 * for the same reasons. The likeliest error is again a migration not yet applied (0006 this time),
 * which should read as one sentence in the card rather than take the account page down.
 */
async function devicesCard(): Promise<{ devices: DeviceTokenItem[]; canRevokeAll: boolean } | { error: string } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const [devices, role] = await Promise.all([listDeviceTokens(), currentRole()]);
    // An owner may revoke anyone's phone, a member only their own; the SQL function enforces both
    // regardless of which buttons the page shows.
    return { devices, canRevokeAll: role === "owner" };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof NotSignedInError) return null;
    console.error("[account] paired phones unavailable:", err);
    return { error: "Phone pairing isn’t available right now." };
  }
}

/**
 * Account and subscription settings.
 *
 * Everything billing-related — card, invoices, plan changes, cancellation — is a single link out to
 * Stripe's hosted Customer Portal (`/api/portal`) rather than custom UI. Rebuilding that would mean
 * reimplementing proration, dunning, and invoice history against an API that keeps moving, for no
 * gain over a page Stripe already maintains and keeps PCI-compliant.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ portal?: string }> }) {
  const [usage, letterhead, profile, devices] = await Promise.all([getUsageState(), letterheadCard(), profileCard(), devicesCard()]);
  const params = await searchParams;
  const plan = planForTier(usage?.tier);

  return (
    <main>
      <h1>Account</h1>
      <p className="subtitle">Your subscription, usage, details, letterhead and paired phones.</p>

      {profile && (
        <div className="card">
          <h2>Your details</h2>
          <p className="subtitle">Copied onto each claim as it starts — the project manager and the number on every document.</p>
          <ProfileForm initial={profile} />
        </div>
      )}

      {params.portal === "error" && <div className="error-banner">Couldn’t open the billing portal just now. Please try again in a moment.</div>}

      <div className="card">
        <h2>Subscription</h2>
        {plan && usage ? (
          <>
            <div className="account-row">
              <span className="account-label">Plan</span>
              <span className="account-value">{plan.name}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Claims used this period</span>
              <span className="account-value">
                {usage.used} of {usage.limit}
              </span>
            </div>
            {usage.periodResetAt && (
              <div className="account-row">
                <span className="account-label">Resets on</span>
                <span className="account-value">{new Date(usage.periodResetAt).toLocaleDateString()}</span>
              </div>
            )}
            <div className="actions-row">
              <Link href="/pricing" className="btn-secondary">
                Change plan
              </Link>
              {/* A plain link, not a form — /api/portal is a GET with no side effects on our data. */}
              <a href="/api/portal" className="btn-primary">
                Manage billing
              </a>
            </div>
            <p className="field-note">Manage billing opens Stripe, where you can update your card, download invoices, or cancel.</p>
          </>
        ) : usage?.onTrial ? (
          <>
            <div className="account-row">
              <span className="account-label">Plan</span>
              <span className="account-value">Free trial</span>
            </div>
            <div className="account-row">
              <span className="account-label">Trial claims used</span>
              <span className="account-value">
                {usage.trialClaimsUsed} of {TRIAL_CLAIM_LIMIT}
              </span>
            </div>
            {usage.trialEndsAt && (
              <div className="account-row">
                <span className="account-label">Trial ends</span>
                <span className="account-value">{new Date(usage.trialEndsAt).toLocaleDateString()}</span>
              </div>
            )}
            <p className="field-note" style={{ marginTop: 16 }}>
              Your trial ends when you’ve used {TRIAL_CLAIM_LIMIT} claims or after {TRIAL_DAYS} days, whichever comes first. No card is needed until you choose a plan.
            </p>
            <div className="actions-row">
              <Link href="/pricing" className="btn-primary">
                View plans
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="subtitle">
              {usage?.trialExpiredReason === "time"
                ? `Your ${TRIAL_DAYS}-day free trial has ended. Choose a plan to keep generating documents.`
                : usage?.trialExpiredReason === "claims"
                  ? `You’ve used all ${TRIAL_CLAIM_LIMIT} claims in your free trial. Choose a plan to keep generating documents.`
                  : "You don’t have an active subscription. Choose a plan to start generating documents."}
            </p>
            <div className="actions-row">
              <Link href="/pricing" className="btn-primary">
                View plans
              </Link>
            </div>
          </>
        )}
      </div>

      {letterhead && (
        <div className="card">
          <h2>Company letterhead</h2>
          <p className="subtitle">What every downloaded or emailed document carries across the top.</p>
          {"error" in letterhead ? <p className="field-note">{letterhead.error}</p> : <LetterheadForm initial={letterhead.state} />}
        </div>
      )}

      {devices && (
        <div className="card">
          <h2>Paired phones</h2>
          <p className="subtitle">Phones running Scrivn Scan that can send room scans into your claims.</p>
          {"error" in devices ? <p className="field-note">{devices.error}</p> : <PairedPhones initial={devices.devices} canRevokeAll={devices.canRevokeAll} />}
        </div>
      )}
    </main>
  );
}
