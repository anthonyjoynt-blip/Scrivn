import Link from "next/link";
import { TRIAL_CLAIM_LIMIT, TRIAL_DAYS } from "@/lib/plans";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { FaqAccordion, type FaqEntry } from "@/components/marketing/FaqAccordion";

/**
 * Copy and layout from design-reference/scrivn-faq-mockup.html.
 *
 * FOUR ANSWERS WERE CHANGED because the approved copy stated things the product does not do. Each
 * is marked ACCURACY below with what the mockup claimed and what's actually true. An FAQ is read as
 * a set of promises — a wrong answer here is a support ticket at best and a refund at worst — so
 * these were corrected rather than shipped as approved. Everything else is verbatim.
 */
export const metadata = {
  title: "FAQ — Scrivn",
  description: "What Scrivn does, how it works, what happens to your data, and how billing works.",
};

const GENERAL: FaqEntry[] = [
  {
    q: "What is Scrivn?",
    a: "Scrivn takes the notes or dictation from a property walkthrough and turns them into a complete, formatted scope and inspection report — asking about anything missing before generating the final documents.",
  },
  {
    q: "What types of losses does Scrivn support?",
    a: "Water losses today. Additional loss types are on the roadmap — each one gets built and tested properly before it's added, not rushed out half-working.",
  },
  {
    q: "Does Scrivn replace Xactimate or my estimating software?",
    a: "No. Scrivn produces the scope your estimator uses to build the actual estimate — it's the documentation step before estimating, not a replacement for it.",
  },
];

const HOW_IT_WORKS: FaqEntry[] = [
  {
    q: "Do I need to record anything through Scrivn?",
    a: "No. Write up or dictate your notes however you already do — on your phone, in a notes app, whatever's natural — then paste the result into Scrivn.",
  },
  {
    q: "How accurate is the generated document — do I still need to check it?",
    a: "Always review it before it goes out, the same as you would with anything a team member drafted for you. Scrivn is built to catch the specific gaps that cause rework — not to remove the need for a final look.",
  },
  {
    q: "Can I edit the generated scope or report?",
    a: "Yes — edit directly, or use it as a strong first draft and adjust from there.",
  },
];

const DATA: FaqEntry[] = [
  {
    q: "Is my data secure?",
    a: "Your data is encrypted in transit and never sold to third parties. As a newer product, we're upfront that we don't yet hold formal security certifications — if that's a requirement for your company, reach out and we'll walk through exactly what's in place today.",
  },
  {
    // ACCURACY: the mockup said "stored to your account so you can access past claims." There is no
    // claim storage — the only table is `profiles` (supabase/migrations/), and claim state lives in
    // React state on /claim for the length of the session. Saved claim history is a deliberate later
    // addition, so promising it here would have been a straightforwardly false claim.
    q: "What happens to the claim information I paste in?",
    a: "It's sent to the AI model that generates your documents, and it's never sold or shared. Saved claim history isn't built yet — a claim lives only in your browser session while you're working on it, and nothing is kept once you leave the page. Download or email your documents before you close the tab.",
  },
];

const BILLING: FaqEntry[] = [
  {
    q: 'What counts as "a claim" for billing?',
    a: "One generated scope-and-report pair, for one property loss.",
  },
  {
    // ACCURACY: the mockup answered a bare "Yes — try Scrivn on a real claim before subscribing to
    // anything." True, but the trial now has definite limits worth stating up front rather than
    // discovering at claim six.
    q: "Is there a free trial?",
    a: `Yes — ${TRIAL_CLAIM_LIMIT} claims within ${TRIAL_DAYS} days, no credit card required. Try it on a real claim before subscribing to anything.`,
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes — no long-term contract on the self-serve plans.",
  },
  {
    // ACCURACY: the mockup said "Additional claims are billed at a per-claim overage rate rather
    // than blocked." The opposite is true and deliberately so — lib/usage.ts enforces a hard cap and
    // nothing bills beyond the subscription price. Promising overage would mean a customer expects
    // to keep working at the limit and instead finds generation refused.
    q: "What happens if I go over my plan's claim limit?",
    a: "Generation pauses for the rest of the billing period — there's no per-claim overage charge, so you're never billed beyond your plan price without choosing to be. Upgrading takes effect immediately if you need to keep going before the period resets.",
  },
  {
    q: "Do you offer pricing for companies with multiple offices?",
    a: "Yes — reach out for a custom quote based on your office count and expected volume.",
  },
];

const TEAM: FaqEntry[] = [
  {
    // ACCURACY: the mockup said "your whole team can work from one account." Shared/team accounts
    // don't exist — `profiles` is one row per Supabase auth user and there's no org structure. The
    // honest version keeps the true half (plans are priced on claim volume, not seats).
    q: "Can multiple people on my team use one account?",
    a: "Not yet — each person signs in with their own account today, and team accounts with a shared claim pool are on the roadmap. Plans are priced on claim volume rather than per seat, so that's the direction this is heading.",
  },
];

const SECTIONS: { heading: string; id: string; items: FaqEntry[] }[] = [
  { heading: "General", id: "general", items: GENERAL },
  { heading: "How it works", id: "how", items: HOW_IT_WORKS },
  { heading: "Data & security", id: "data", items: DATA },
  { heading: "Pricing & billing", id: "billing", items: BILLING },
  { heading: "Team & accounts", id: "team", items: TEAM },
];

export default function FaqPage() {
  return (
    <MarketingShell page="faq">
      <div className="mk-pagehead wrap-narrow">
        <h1>Frequently asked questions</h1>
      </div>

      <div className="wrap-narrow">
        {SECTIONS.map((section) => (
          <section className="mk-faq-section" key={section.id}>
            <h2>{section.heading}</h2>
            <FaqAccordion id={section.id} items={section.items} />
          </section>
        ))}
      </div>

      <div className="mk-finalcta wrap" style={{ marginTop: "40px" }}>
        <h2>Still have a question?</h2>
        <Link href="/contact" className="mk-btn-primary">
          Contact us
        </Link>
      </div>
    </MarketingShell>
  );
}
