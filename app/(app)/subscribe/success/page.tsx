import Link from "next/link";
import { getUsageState } from "@/lib/usage";

/**
 * Where Stripe returns the customer after a completed checkout.
 *
 * Deliberately does NOT grant the subscription — that's the webhook's job, and only the webhook's.
 * This page is reached by a browser redirect that anyone could navigate to directly, so treating
 * arrival here as proof of payment would hand out plans for free. Fulfilment belongs behind a
 * signature-verified event, not a success URL.
 *
 * That does mean this page can briefly load before the webhook has landed, so it reads whatever
 * state exists and words itself to be true either way rather than asserting the plan is live.
 */
export default async function SubscribeSuccessPage() {
  const usage = await getUsageState();
  const active = usage != null && !usage.noPlan;

  return (
    <main className="login-main">
      <div className="card login-card">
        <h1>You’re all set</h1>
        {active ? (
          <p className="subtitle">
            Your subscription is active, with <strong>{usage.limit} claims</strong> included this billing period.
          </p>
        ) : (
          <p className="subtitle">
            Payment received — thanks. Your plan is being activated, which usually takes a few seconds. Refresh this page if it doesn’t show up shortly.
          </p>
        )}
        <div className="auth-links">
          <Link href="/claim">Start a claim</Link>
          <Link href="/account">Manage your subscription</Link>
        </div>
      </div>
    </main>
  );
}
