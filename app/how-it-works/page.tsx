import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";

/**
 * Copy and layout from design-reference/scrivn-howitworks-mockup.html, kept as approved.
 *
 * The numbered steps are genuinely sequential — you can't answer the gap-check questions before
 * pasting the notes in — so the numbering encodes real order rather than decorating the list.
 */
export const metadata = {
  title: "How It Works — Scrivn",
  description: "Write up or dictate your walkthrough however you already do, paste it in, answer what's missing, and get your documents.",
};

const STEPS = [
  {
    title: "Write it up or dictate it, on your phone",
    body: "Use whatever you're already comfortable with — type notes, or dictate using your phone's own voice-to-text. Scrivn doesn't record anything itself; it works from the text you already have.",
  },
  {
    title: "Paste it in",
    body: 'Drop the text into Scrivn. Describe the actual work required — what’s being torn out, replaced, or repaired in each room — not just that damage exists. "The carpet is damaged" won’t make it into the scope; "tear out the carpet" will.',
  },
  {
    title: "Answer what's missing",
    body: "Scrivn checks what you described against what a complete scope actually needs — material types, sizes, installation methods — and only asks about the specific gaps, not everything all over again.",
  },
  {
    title: "Get your documents",
    body: "A scope organized by phase and room, and an inspection report — formatted so it's easy to estimate from, and ready to hand off to your claim rep or team.",
  },
];

export default function HowItWorksPage() {
  return (
    <MarketingShell page="how-it-works">
      <div className="mk-pagehead wrap">
        <h1>From notes on-site to a finished scope</h1>
        <p>No new habits to learn — write it up or dictate however you already do, then let Scrivn handle the rest.</p>
      </div>

      <div className="mk-steps wrap">
        {STEPS.map((step, index) => (
          <div className="mk-step-row" key={step.title}>
            <div className="mk-step-num" aria-hidden="true">
              {index + 1}
            </div>
            <div className="mk-step-copy">
              <h3>
                <span className="sr-only">{`Step ${index + 1}: `}</span>
                {step.title}
              </h3>
              <p>{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mk-example">
        <div className="wrap">
          <h2>A real example, start to finish</h2>
          <p className="lead">Taken directly from actual testing — nothing staged for this page.</p>
          <div className="mk-example-flow">
            <div className="mk-flow-card input">
              <div className="tag">What was written</div>
              <p>&ldquo;In the bedroom we&rsquo;re tearing out and replacing the baseboards.&rdquo;</p>
            </div>
            <div className="mk-flow-arrow" aria-hidden="true">
              →
            </div>
            <div className="mk-flow-card question">
              <div className="tag">Scrivn asks</div>
              <p>&ldquo;What material and size are the baseboards?&rdquo;</p>
            </div>
            <div className="mk-flow-arrow" aria-hidden="true">
              →
            </div>
            <div className="mk-output-pair">
              <div className="mk-flow-card output">
                <div className="mk-phase-label">Emergency</div>
                <div className="mk-amber-rule" />
                <div className="l">Tear out baseboards — perimeter</div>
              </div>
              <div className="mk-flow-card output">
                <div className="mk-phase-label">Repair</div>
                <div className="mk-amber-rule" />
                <div className="l">Replace baseboards — MDF, 3.25″ — perimeter</div>
              </div>
            </div>
          </div>
          <p style={{ textAlign: "center", color: "var(--muted)", fontSize: "13px", marginTop: "26px" }}>
            One answer, two documents done right — the material and size only had to be said once, and it shows up exactly where each phase needs it.
          </p>
        </div>
      </div>

      <div className="mk-finalcta wrap">
        <h2>Try it on your next claim.</h2>
        <Link href="/signup" className="mk-btn-primary">
          Get started free
        </Link>
      </div>
    </MarketingShell>
  );
}
