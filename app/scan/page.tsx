import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { PlanSheet } from "@/components/marketing/PlanSheet";
import { ScanPlanCards } from "@/components/marketing/ScanPlanCards";
import { HowtoArt } from "@/components/scanGuide/Figures";
import { configuredScanIntervals } from "@/lib/stripe/prices";
import { isBillingEnabled } from "@/lib/billingGate";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SCAN_PLAN } from "@/lib/plans";
import { SCAN_GET_HREF, SCAN_GET_LABEL } from "@/lib/scanApp";
import "./scan.css";

/**
 * Scrivn Scan as a product of its own (owner, 2026-10-08): the page someone lands on after finding
 * Scan on Google Play and reading "plans at scrivn.ca/scan" in the app — a flooring or renovation
 * contractor, an estimator — so it sells measured floor plans, not restoration estimating, and has
 * the Scan plan and its price up front. Scrivn comes in as the next step, not the subject.
 *
 * Every claim here is something the app does today (the tester guide at /scan-guide is the long
 * version). The free tier's few scans a month is the decided model (2026-10-01) and is counted once
 * Scan signs in; until then nothing on the phone is limited, so the page promises less than it gives.
 */
export const metadata = {
  title: "Scrivn Scan — Measured floor plans from your phone",
  description:
    "Tap each corner, tape one wall, and get a floor plan PDF and a to-scale JPG for Xactimate or any sketch tool. Free for 3 scans a month; unlimited for $19 CAD a month.",
};

export default async function ScanPage() {
  let signedIn = false;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    signedIn = data?.claims != null;
  }

  return (
    <MarketingShell page="scan">
      <div className="sc-hero wrap">
        <div className="sc-hero-copy">
          <p className="sc-eyebrow">Scrivn Scan for Android</p>
          <h1>Measured floor plans from your phone.</h1>
          <p className="sub">
            Stand in the room, tap each corner, and Scan draws it to size: walls, doors, windows, closets, cabinets and stairs. Share a floor plan PDF, or a JPG drawn to
            scale for tracing in Xactimate or any sketch tool.
          </p>
          <div className="mk-hero-ctas">
            <a href={SCAN_GET_HREF} className="mk-btn-primary">
              {SCAN_GET_LABEL}
            </a>
            <Link href="/scan-guide" className="mk-btn-secondary">
              How to use it
            </Link>
          </div>
          <p className="sc-fine">
            Free for {SCAN_PLAN.freeScansPerMonth} scans a month. Unlimited for {SCAN_PLAN.monthlyLabel} a month.
          </p>
        </div>
        <div className="sc-hero-art">
          <PlanSheet />
        </div>
      </div>

      <div className="mk-band">
        <div className="wrap mk-band-inner">
          <div className="mk-band-step">
            <div className="label">Today</div>
            <div className="val">Tape measure, a pad of graph paper, and drawing it up again at the office</div>
          </div>
          <div className="mk-band-arrow" aria-hidden="true">
            →
          </div>
          <div className="mk-band-step">
            <div className="label">With Scan</div>
            <div className="val">Tap the corners, tape one wall, and the plan is done before you leave the room</div>
          </div>
        </div>
      </div>

      <section className="sc-section wrap">
        <div className="sc-head">
          <h2>Three steps a room</h2>
          <p>No laser, no sketching. The phone&rsquo;s camera finds each corner; you tell it which.</p>
        </div>
        <div className="sc-steps">
          <div className="sc-step">
            <div className="sc-step-art">
              <HowtoArt name="corner" />
            </div>
            <h3>
              <span className="sc-step-num" aria-hidden="true">
                1
              </span>
              Tap the corners
            </h3>
            <p>Stand near the middle of the room and put the ring on each corner in turn. Doors, windows and cabinets are a tap or two each.</p>
          </div>
          <div className="sc-step">
            <div className="sc-step-art">
              <HowtoArt name="review" />
            </div>
            <h3>
              <span className="sc-step-num" aria-hidden="true">
                2
              </span>
              Tape one wall
            </h3>
            <p>Type in a wall you measured with your tape and have Scan scale the whole room to it. Every wall you tape after that brings it closer.</p>
          </div>
          <div className="sc-step">
            <div className="sc-step-art">
              <PlanSheet />
            </div>
            <h3>
              <span className="sc-step-num" aria-hidden="true">
                3
              </span>
              Share the plan
            </h3>
            <p>A floor plan PDF with every room&rsquo;s size, and a JPG drawn to scale — saved on your phone and ready to send.</p>
          </div>
        </div>
      </section>

      <section className="sc-section tint">
        <div className="wrap">
          <div className="sc-head">
            <h2>What it measures</h2>
            <p>More than four walls: the things a quote or an estimate actually needs.</p>
          </div>
          <div className="sc-grid">
            <div className="sc-card">
              <h3>Whole floors</h3>
              <p>Room after room in one scan, joined at their doorways, with walls drawn 4&Prime; thick the way a plan should be.</p>
            </div>
            <div className="sc-card">
              <h3>Doors, windows and openings</h3>
              <p>Each one placed on its wall at its width, closet doors included — and the closet behind them when you want it.</p>
            </div>
            <div className="sc-card">
              <h3>Cabinets, tubs and showers</h3>
              <p>Base and upper runs along a wall, islands standing free, and the tub or shower in its alcove.</p>
            </div>
            <div className="sc-card">
              <h3>Stairs</h3>
              <p>A flight tapped at its corners, with its rise, run and width, placed where it climbs.</p>
            </div>
            <div className="sc-card">
              <h3>Ceilings</h3>
              <p>Height read at every corner, and sloped or vaulted ceilings measured rather than guessed.</p>
            </div>
            <div className="sc-card">
              <h3>Your tape, kept</h3>
              <p>Any wall you measure by hand wins over the phone&rsquo;s reading, and the room fits itself to it.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sc-section wrap">
        <div className="sc-head">
          <h2>Built for the trades</h2>
          <p>Anyone who needs a measured plan before the work starts.</p>
        </div>
        <div className="sc-grid">
          <div className="sc-card">
            <span className="sc-tag">Flooring and renovation</span>
            <h3>Quote from real numbers</h3>
            <p>Every room&rsquo;s size and floor area on the plan, measured on the first visit instead of guessed and re-measured later.</p>
          </div>
          <div className="sc-card">
            <span className="sc-tag">Estimators</span>
            <h3>An underlay, to scale</h3>
            <p>The JPG is drawn to a known scale, so it drops into Xactimate or any sketch tool as an underlay to trace over.</p>
          </div>
          <div className="sc-card">
            <span className="sc-tag">Restoration</span>
            <h3>Straight into a claim</h3>
            <p>
              Pair Scan with <Link href="/">Scrivn</Link> and the rooms land in the claim&rsquo;s sketch, ready for the scope and inspection report.
            </p>
          </div>
        </div>
      </section>

      <section className="sc-section tint sc-pricing" id="pricing">
        <div className="wrap">
          <div className="sc-head">
            <h2>Start free. Pay when it&rsquo;s part of the job.</h2>
            <p>Prices in Canadian dollars. Cancel anytime from your account.</p>
          </div>
          <div className="mk-tiers">
            <ScanPlanCards signedIn={signedIn} billingOpen={isBillingEnabled()} available={configuredScanIntervals()} returnPath="/scan" showFree />
          </div>
          <p className="sc-included">
            Doing restoration? Every <Link href="/pricing">Scrivn plan</Link> includes Scan, plus the scope and inspection report written from your walkthrough.
          </p>
        </div>
      </section>

      <section className="sc-section wrap">
        <div className="sc-head">
          <h2>Questions</h2>
        </div>
        <div className="sc-faq">
          <details>
            <summary>Which phones does it work on?</summary>
            <p>
              Android phones that run Google&rsquo;s ARCore with its depth feature — most recent Samsung Galaxy S and Google Pixel phones. If yours can&rsquo;t, the app
              says so when it opens.
            </p>
          </details>
          <details>
            <summary>How accurate is it?</summary>
            <p>
              As good as the corners it can see. Tape one wall and Scan scales the whole room to it; good light and a clear view of each corner do the rest. The{" "}
              <Link href="/scan-guide#tips">tips in the guide</Link> are what we&rsquo;ve learned measuring real houses.
            </p>
          </details>
          <details>
            <summary>Can I use the plan in Xactimate?</summary>
            <p>Yes, as an underlay: the JPG is drawn to scale for tracing, and the PDF prints to scale with a scale bar on the page.</p>
          </details>
          <details>
            <summary>Do I need an account?</summary>
            <p>Not to try it: install it and start measuring. You need a Scrivn account to buy the Scan plan, which you do here on scrivn.ca.</p>
          </details>
          <details>
            <summary>Where do my scans go?</summary>
            <p>
              They stay on your phone until you share a plan or send it to Scrivn. If a scan goes wrong you can choose to send it to us from the app, and we use it only
              to fix the problem.
            </p>
          </details>
        </div>
      </section>

      <div className="mk-finalcta wrap">
        <h2>Measure your next room with Scan.</h2>
        <a href={SCAN_GET_HREF} className="mk-btn-primary">
          {SCAN_GET_LABEL}
        </a>
      </div>
    </MarketingShell>
  );
}
