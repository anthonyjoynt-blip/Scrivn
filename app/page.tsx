import Link from "next/link";
import { PLANS } from "@/lib/plans";
import { MarketingShell, marketingNavVisible } from "@/components/marketing/MarketingShell";

/**
 * The public home page.
 *
 * `/` used to be the claim tool; that now lives at /claim, inside the (app) route group. Anything
 * linking a signed-in user "home" should point at /claim, not here.
 *
 * Copy and layout come from design-reference/scrivn-homepage-mockup.html and are kept as approved.
 * The two exceptions are both places where the mockup asserted something the product doesn't do —
 * see the note on the pricing teaser below.
 *
 * With NEXT_PUBLIC_SHOW_MARKETING_NAV off, the page drops everything that points elsewhere on the
 * marketing site (the "see how it works" links and the pricing teaser) and reads as a plain landing
 * page rather than a storefront.
 *
 * COMING SOON while sign-up is shut (owner, 2026-10-27: "something more attune to coming soon and the
 * features"). Its "Try it free" buttons led to the sign-up page's "invite-only" panel, so while
 * NEXT_PUBLIC_SIGNUPS_OPEN is not "true" - the switch that page and the server read (lib/signup.ts) - the
 * page says Coming soon, lists what Scrivn does, and asks for early access through the contact form
 * (reason early-access), with Sign in for the accounts already made. Every feature listed is one the
 * product does today, in the words the FAQ already uses. Opened, the page is as it was.
 */
export const metadata = {
  title: "Scrivn — From on-site notes to submitted scope",
  description: "Write up or dictate your walkthrough, paste it in, and get a complete scope and inspection report the same day.",
};

/** Whether this deployment takes sign-ups: the switch the sign-up page and the server read. Fails closed. */
function signupsOpen(): boolean {
  return process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "true";
}

const EARLY_ACCESS_HREF = "/contact?reason=early-access";

/** What Scrivn does today, for the coming-soon page. Each line is in the FAQ already, said shorter. */
const FEATURES: { icon: string; title: string; text: string; more?: { href: string; label: string } }[] = [
  {
    icon: "📝",
    title: "Scope and report from your notes",
    text: "Write up or dictate your walkthrough and paste it in. Scrivn asks what a thorough estimator would — baseboard size, insulation, asbestos testing — then writes the scope and inspection report.",
  },
  {
    icon: "📐",
    title: "Floor plans from your phone",
    text: "Scrivn Scan for Android: stand in the room, tap each corner, and it draws it to size — walls, doors, windows, closets, cabinets and stairs — straight into the claim’s sketch.",
    more: { href: "/scan", label: "More about Scan" },
  },
  {
    icon: "🏠",
    title: "The outside, from photos",
    text: "Walk round the house with your phone’s camera. Scrivn works out each wall’s length, the roof in squares with its ridges, hips and valleys, and an exterior report.",
  },
  {
    icon: "💧",
    title: "Drying, visit by visit",
    text: "Moisture readings, GPP and the dry standard at every visit, the equipment to set, and a drying log PDF for the file.",
    more: { href: "/drying-calculator", label: "Try the drying calculator" },
  },
  {
    icon: "📷",
    title: "Photos that explain themselves",
    text: "Say a caption as you photograph each room, and the notes go into the scope.",
  },
  {
    icon: "📶",
    title: "No signal? Keep working",
    text: "Open claims, start new ones and take photos with no signal. Everything syncs on its own when you’re back in range.",
  },
];

export default function HomePage() {
  const showNav = marketingNavVisible();
  if (!signupsOpen()) return <ComingSoon />;

  return (
    <MarketingShell page="home">
      <div className="mk-hero wrap">
        <h1>
          From on-site notes
          <br />
          to submitted scope — in minutes.
        </h1>
        <p className="sub">
          Write it up or dictate it on your phone, then paste it in. Scrivn asks what&rsquo;s missing, then generates a complete scope and inspection report — ready for your
          estimator, not days later.
        </p>
        <div className="mk-hero-ctas">
          <Link href="/signup" className="mk-btn-primary">
            Try it free
          </Link>
          {showNav && (
            <Link href="/how-it-works" className="mk-btn-secondary">
              See how it works
            </Link>
          )}
        </div>
      </div>

      <div className="mk-band">
        <div className="wrap mk-band-inner">
          <div className="mk-band-step">
            <div className="label">Today</div>
            <div className="val">Site visit, then write it up back at the office — days or weeks later</div>
          </div>
          <div className="mk-band-arrow" aria-hidden="true">
            →
          </div>
          <div className="mk-band-step">
            <div className="label">With Scrivn</div>
            <div className="val">Write up or dictate on-site, paste it in, answer a few questions, documents generated the same day</div>
          </div>
        </div>
      </div>

      <div className="mk-benefits wrap">
        <h2>Built around what actually slows a claim down</h2>
        <div className="mk-benefit-grid">
          <div className="mk-benefit-card">
            <div className="mk-benefit-icon" aria-hidden="true">
              ⚡
            </div>
            <h3>Same-day documentation</h3>
            <p>No more writing up the scope days later from memory and notes. Generate it the same day you walked the property.</p>
          </div>
          <div className="mk-benefit-card">
            <div className="mk-benefit-icon" aria-hidden="true">
              ✓
            </div>
            <h3>Catches what&rsquo;s missing</h3>
            <p>
              Scrivn asks the follow-up questions a thorough estimator would — baseboard size, insulation, asbestos-testing requirements — before it&rsquo;s too late to ask.
            </p>
          </div>
          <div className="mk-benefit-card">
            <div className="mk-benefit-icon" aria-hidden="true">
              💳
            </div>
            <h3>Priced for what it does</h3>
            <p>
              Built around the piece that actually slows a claim down — the write-up — and priced for exactly that. Starting well under $100/month, not $500+.
            </p>
          </div>
        </div>
      </div>

      <div className="mk-sample">
        <div className="wrap mk-sample-inner">
          <div className="mk-sample-copy">
            <h2>See real output, not a promise</h2>
            <p>Every generated scope follows the same format an estimator already expects — headed by phase, organized by room, with the material detail Xactimate needs.</p>
            {showNav && (
              <Link href="/how-it-works" className="mk-btn-primary">
                See the full example
              </Link>
            )}
          </div>
          <div className="mk-sample-doc">
            <div className="mk-doctitle">Scope — Emergency</div>
            <div className="mk-amber-rule" />
            <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>Basement Bedroom</div>
            <div className="mk-docline">Tear out baseboards — MDF, 3.25″ — perimeter</div>
            <div className="mk-docline">Tear out carpet &amp; pad, berber — floor area</div>
            <div className="mk-docline">Antimicrobial</div>
            <div className="mk-docline">Drying equipment — 4 air movers, 1 dehu</div>
          </div>
        </div>
      </div>

      {showNav && (
        <div className="mk-pricing-teaser wrap">
          <h2>Simple pricing, no full-platform price tag</h2>
          <p>Start free. Upgrade when you&rsquo;re actually using it.</p>
          <div className="mk-tier-row">
            {/*
              Read from PLANS rather than hardcoded, so the teaser can't drift away from the caps the
              app actually enforces. This is also why Unlimited reads "300 claims included" and not
              the mockup's "~300": 300 is an exact hard cap in lib/plans.ts, and a tilde reads as
              "roughly, we won't count closely" — which is the opposite of what happens at the limit.
            */}
            {PLANS.map((plan) => (
              <div className={`mk-tier-card${plan.tier === "growth" ? " featured" : ""}`} key={plan.tier}>
                <div className="mk-tname">{plan.name}</div>
                <div className="mk-tprice">
                  {plan.priceLabel}
                  <span>/mo</span>
                </div>
                <div className="mk-tclaims">{plan.claimLimit} claims included</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mk-finalcta wrap">
        <h2>Try Scrivn on your next claim.</h2>
        <Link href="/signup" className="mk-btn-primary">
          Get started free
        </Link>
      </div>
    </MarketingShell>
  );
}

/** The home page while sign-up is shut: Coming soon, what Scrivn does, and early access. */
function ComingSoon() {
  return (
    <MarketingShell page="home">
      <div className="mk-hero wrap">
        <p className="mk-soon">Coming soon</p>
        <h1>
          From on-site notes
          <br />
          to submitted scope — in minutes.
        </h1>
        <p className="sub">
          Scrivn turns your walkthrough into a complete scope and inspection report, with the floor plan, the outside of the house and the drying log alongside. We&rsquo;re
          opening it up soon.
        </p>
        <div className="mk-hero-ctas">
          <Link href={EARLY_ACCESS_HREF} className="mk-btn-primary">
            Get early access
          </Link>
          <Link href="/login" className="mk-btn-secondary">
            Sign in
          </Link>
        </div>
        <p className="mk-hero-fine">In testing now. Ask for early access and we&rsquo;ll let you know the day it opens.</p>
      </div>

      <div className="mk-band">
        <div className="wrap mk-band-inner">
          <div className="mk-band-step">
            <div className="label">Today</div>
            <div className="val">Site visit, then write it up back at the office — days or weeks later</div>
          </div>
          <div className="mk-band-arrow" aria-hidden="true">
            →
          </div>
          <div className="mk-band-step">
            <div className="label">With Scrivn</div>
            <div className="val">Write up or dictate on-site, paste it in, answer a few questions, documents generated the same day</div>
          </div>
        </div>
      </div>

      <div className="mk-benefits wrap">
        <h2>Everything the file needs, from one site visit</h2>
        <div className="mk-benefit-grid">
          {FEATURES.map((f) => (
            <div className="mk-benefit-card" key={f.title}>
              <div className="mk-benefit-icon" aria-hidden="true">
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              {f.more && (
                <Link href={f.more.href} className="mk-feature-more">
                  {f.more.label} →
                </Link>
              )}
            </div>
          ))}
        </div>
        <p className="mk-features-note">Water losses today, with more loss types to come. Every document goes out on your company&rsquo;s letterhead.</p>
      </div>

      <div className="mk-sample">
        <div className="wrap mk-sample-inner">
          <div className="mk-sample-copy">
            <h2>See real output, not a promise</h2>
            <p>Every generated scope follows the same format an estimator already expects — headed by phase, organized by room, with the material detail Xactimate needs.</p>
          </div>
          <div className="mk-sample-doc">
            <div className="mk-doctitle">Scope — Emergency</div>
            <div className="mk-amber-rule" />
            <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>Basement Bedroom</div>
            <div className="mk-docline">Tear out baseboards — MDF, 3.25″ — perimeter</div>
            <div className="mk-docline">Tear out carpet &amp; pad, berber — floor area</div>
            <div className="mk-docline">Antimicrobial</div>
            <div className="mk-docline">Drying equipment — 4 air movers, 1 dehu</div>
          </div>
        </div>
      </div>

      <div className="mk-finalcta wrap">
        <h2>Be first in when Scrivn opens.</h2>
        <Link href={EARLY_ACCESS_HREF} className="mk-btn-primary">
          Get early access
        </Link>
      </div>
    </MarketingShell>
  );
}
