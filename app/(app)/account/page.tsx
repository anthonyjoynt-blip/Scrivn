import Link from "next/link";
import { getUsageState } from "@/lib/usage";
import { TRIAL_CLAIM_LIMIT, TRIAL_DAYS, planForTier } from "@/lib/plans";

/**
 * Account and subscription settings.
 *
 * Everything billing-related — card, invoices, plan changes, cancellation — is a single link out to
 * Stripe's hosted Customer Portal (`/api/portal`) rather than custom UI. Rebuilding that would mean
 * reimplementing proration, dunning, and invoice history against an API that keeps moving, for no
 * gain over a page Stripe already maintains and keeps PCI-compliant.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ portal?: string }> }) {
  const usage = await getUsageState();
  const params = await searchParams;
  const plan = planForTier(usage?.tier);

  return (
    <main>
      <h1>Account</h1>
      <p className="subtitle">Your subscription and usage.</p>

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
    </main>
  );
}
