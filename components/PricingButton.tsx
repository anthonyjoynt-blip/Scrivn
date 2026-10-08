"use client";

import { useEffect, useRef, useState } from "react";
import type { BillingTier, ScanInterval } from "@/lib/plans";

/**
 * The Subscribe / Start free trial button.
 *
 * Signed out, this doesn't dead-end: it sends the visitor to sign-up carrying a `next` that returns
 * them here with `?checkout=<tier>`, and the effect below resumes checkout automatically once
 * they're back. Clicking Subscribe and landing on a login form that forgets why you were there is
 * the classic version of this flow, and it loses the sale.
 *
 * The label follows `trialDays` rather than being hardcoded — a button that says "Start free trial"
 * when the checkout session creates no trial would be a false promise to someone about to enter a
 * card.
 */
export function PricingButton({
  tier,
  interval,
  trialDays,
  signedIn,
  available,
  /** False while the deployment is not taking subscriptions at all — see `isBillingEnabled`. */
  billingOpen,
  /**
   * The button's class. Defaults to the app's own button style; the marketing pricing page passes
   * `mk-tier-btn` so the button matches the approved tier card. Only the appearance changes — the
   * checkout behaviour below is identical either way.
   */
  buttonClassName = "btn-primary",
  /** The page this button sits on, which a signed-out visitor comes back to after signing up. */
  returnPath = "/pricing",
}: {
  tier: BillingTier;
  /** The Scan plan's billing period; the Scrivn plans are monthly only and leave it out. */
  interval?: ScanInterval;
  trialDays: number;
  signedIn: boolean;
  available: boolean;
  billingOpen: boolean;
  buttonClassName?: string;
  returnPath?: "/pricing" | "/scan";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // React runs effects twice in development's strict mode; without this the resume below would fire
  // two checkout sessions for one return trip.
  const resumed = useRef(false);
  // Which button the return trip belongs to: the Scan plan has two on one page, monthly and yearly.
  const checkoutKey = interval === "year" ? `${tier}-yearly` : tier;

  // Resumes the checkout the visitor started before signing in. They clicked Subscribe while signed
  // out, went through signup/login, and came back to `<page>?checkout=<key>` — this picks that
  // intent back up so they don't have to find the button and click it a second time.
  useEffect(() => {
    if (!signedIn || !available || !billingOpen || resumed.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== checkoutKey) return;
    resumed.current = true;
    // Drop the parameter so a later refresh doesn't relaunch checkout.
    window.history.replaceState({}, "", returnPath);
    startCheckout();
    // startCheckout is stable for this component's lifetime; re-running on identity changes would
    // risk duplicate sessions, which is the one thing this effect must not do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, available, checkoutKey]);

  async function startCheckout() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval, from: returnPath === "/scan" ? "scan" : "pricing" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? "Could not start checkout.");
      }
      window.location.href = data.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setLoading(false);
    }
  }

  function handleClick() {
    if (!signedIn) {
      // Round-trip through signup and come back ready to check out — see the resume effect above.
      const next = encodeURIComponent(`${returnPath}?checkout=${checkoutKey}`);
      window.location.href = `/signup?next=${next}`;
      return;
    }
    startCheckout();
  }

  /*
    Two different reasons a plan can't be bought, and they are not the same thing to say.

    "Not selling yet" is a statement about the product and is true of every plan at once; "no price
    configured" is a deployment fault and is true of one. Collapsing them would have told a visitor
    the product was misconfigured when it is simply not on sale.
  */
  if (!billingOpen) {
    return (
      <div className="pricing-cta">
        <button type="button" className={buttonClassName} disabled>
          Coming soon
        </button>
        <p className="field-note">Not taking subscriptions yet.</p>
      </div>
    );
  }

  if (!available) {
    return (
      <div className="pricing-cta">
        <button type="button" className={buttonClassName} disabled>
          Unavailable
        </button>
        <p className="field-note">No Stripe price configured for this plan yet.</p>
      </div>
    );
  }

  return (
    <div className="pricing-cta">
      {error && <div className="error-banner">{error}</div>}
      {/*
        Label follows what the click actually does. Signed out, it starts the app's no-card free
        trial (sign-up), so "Start free trial" is literally true. Signed in, the trial is already
        running or spent and the click goes to Stripe Checkout, so it reads "Subscribe".

        The Scan plan always reads "Subscribe": its free tier is in the app, not a sign-up here, so
        a signed-out click is a sign-up on the way to paying, not the start of a trial.

        `trialDays` is Stripe's own trial-on-a-paid-subscription and is separate from this — it
        stays 0 and is kept in the condition so that turning it on later still labels correctly.
      */}
      <button type="button" className={buttonClassName} onClick={handleClick} disabled={loading}>
        {loading ? "Starting…" : !signedIn && !interval ? "Start free trial" : trialDays > 0 ? `Start ${trialDays}-day free trial` : "Subscribe"}
      </button>
    </div>
  );
}
