import Link from "next/link";
import { SCAN_PLAN, TRIAL_CLAIM_LIMIT, TRIAL_DAYS } from "@/lib/plans";
import { ASSUMED_PITCH } from "@/lib/exterior";
import { PRIVACY_POLICY_URL } from "@/lib/legal";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { FaqAccordion, type FaqEntry } from "@/components/marketing/FaqAccordion";

/**
 * Copy and layout from design-reference/scrivn-faq-mockup.html.
 *
 * FOUR ANSWERS WERE CHANGED because the approved copy stated things the product does not do. Each
 * is marked ACCURACY below with what the mockup claimed and what's actually true. An FAQ is read as
 * a set of promises — a wrong answer here is a support ticket at best and a refund at worst — so
 * these were corrected rather than shipped as approved. Everything else is verbatim.
 *
 * The Scrivn Scan section (2026-10-14) is not from the mockup: the questions a tester or a buyer
 * asks about the phone app, each answered from the code — offline mode (lib/deviceClaims.ts, Scan's
 * SendQueue), the exterior (since 2026-10-19 photos only, in Scrivn: components/sketch/PhotoRoute.tsx,
 * Send to Scrivn team in TeamMeasure.tsx, other buildings in lib/buildings.ts; lib/exterior.ts's
 * ASSUMED_PITCH), the free scans
 * (lib/scanAllowanceRules.ts), deleting (lib/accountDeletion.ts) — and where the data lives word for
 * word from PRIVACY.md. Keep them true when any of those change.
 */
export const metadata = {
  title: "FAQ — Scrivn",
  description: "What Scrivn and Scrivn Scan do, how they work, what happens to your data, and how billing works.",
};

const GENERAL: FaqEntry[] = [
  {
    q: "What is Scrivn?",
    a: "Scrivn takes the notes or dictation from a property walkthrough and turns them into a complete, formatted scope and inspection report — asking about anything missing before generating the final documents. Its phone app, Scrivn Scan, measures the rooms for the sketch, and Scrivn measures the outside of the house from photos.",
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
  {
    // Offline mode (2026-10-13): Scrivn's device store and waiting AI steps, and Scan's send queue.
    q: "Does it need a signal?",
    a: "Not to keep working. Scrivn keeps the claims you've opened on your device: open them, start new ones and make changes with no signal, and they sync on their own when it's back. Photos wait on the device and upload by themselves. Reading the walkthrough and generating the documents wait for signal, then run by themselves. Scrivn Scan measures with no signal at all, and a scan sent with none is kept on the phone and goes to Scrivn on its own later.",
  },
];

const SCAN: FaqEntry[] = [
  {
    // Scan is Android only (ARCore with its Depth API); iPhone is the owner's next platform, no date.
    q: "Is there an iPhone version of Scrivn Scan?",
    a: "Not yet. Scrivn Scan is Android first: it needs a phone that runs Google's ARCore with its depth feature, as most recent Samsung Galaxy S and Google Pixel phones do. An iPhone version is planned after. Scrivn itself runs in the browser on any phone or computer, iPhone included.",
  },
  {
    q: "Can I measure the outside of a house?",
    a: (
      <>
        Yes, in Scrivn, from photos. Take a photo of each wall straight on and each outside corner at 45&deg;, and tape a wall. Then in the
        claim&rsquo;s sketch, Exterior, then From photos: tap the corners on the photos, and Scrivn works out every wall&rsquo;s length, the roof
        and the exterior report. The <Link href="/scan-guide#exterior">guide</Link> shows how.
      </>
    ),
  },
  {
    q: "Do I need Scrivn Scan for the outside?",
    a: "No, just the phone's camera. The outside is measured in Scrivn, which runs in the browser on any phone, iPhone included. Scan is for the rooms inside.",
  },
  {
    // lib/photoRoute.ts: each side's ± (lengthPlusMinusPct), and tapeAdvice for any side over 5%. The 2-4% is the owner's house, 10-16.
    q: "How accurate is the outside?",
    a: "About ±2–4% on walls the photos see well. Scrivn shows each wall's ± and flags the rest for a tape: one tape along that wall fixes it.",
  },
  {
    // PRIVACY.md, "Sending an exterior to the Scrivn team", said plainly.
    q: "What does Send to Scrivn team do with my photos?",
    a: "Our staff use them to measure the outside for you. They see that claim's exterior photos, the tapes and other inputs you entered with them, and your note, and nothing else of the claim. The measurements come back to the claim, where you choose whether to use them. Our working copies are deleted once the measurements are returned, or within 30 days. The request itself, with the measurements returned, is kept with the claim and deleted with it.",
  },
  {
    q: "Can I add a shed or garage?",
    a: "Yes. + Add building in the Exterior: a shed, a detached garage or a workshop, measured from photos or as a quick box (two lengths, the wall height, the roof). Each is roofed like the house, with its own lines on the scope and its own pages in the exterior report.",
  },
  {
    q: "Does Scrivn make roof reports?",
    a: `It makes a roof estimate, not an aerial roof report. From the house's footprint and the pitch, Scrivn works out the roof area in squares (no waste added), the ridge, hips, valleys, eaves, rakes and flashing, and the eavestrough. Nothing is measured from satellite or drone images. Gable or hip at each end, porches and lower roofs are set with a few taps on the roof check. Until the pitch is typed, the roof is drawn at an assumed ${ASSUMED_PITCH}/12, and it says so on the scope and the documents. If you have a roof measurement report, upload it on the exterior sketch and Scrivn reads its totals for you to accept. The exterior report, a PDF from the claim, has every elevation, the roof plan, the side photos and every measurement.`,
  },
  {
    q: "Can Scrivn export an ESX file for Xactimate?",
    a: "Not yet. Today the scope and report are PDFs, and Scrivn Scan shares each floor plan as a PDF and a JPG drawn to scale, which you can set as an underlay in Xactimate and trace over.",
  },
  {
    // lib/scanAllowanceRules.ts: counted per capture, once, when it first leaves the phone; refused only once BILLING_ENABLED.
    q: "How many free scans do I get?",
    a: `With a Scrivn account and no plan, ${SCAN_PLAN.freeScansPerMonth} scans a month; any Scrivn plan, or the Scan plan, has unlimited scans. A scan is one capture — all its rooms and levels — counted once, the first time it's sent to Scrivn or shared. A phone with no account isn't counted. While Scrivn Scan is in testing, scans are counted but none are refused.`,
  },
];

const DATA: FaqEntry[] = [
  {
    q: "Is my data secure?",
    a: "Your data is encrypted in transit and never sold to third parties. As a newer product, we're upfront that we don't yet hold formal security certifications — if that's a requirement for your company, reach out and we'll walk through exactly what's in place today.",
  },
  {
    // ACCURACY: when the mockup was approved there was no claim storage, so this said a claim lived
    // only in the browser session. Claims have been saved to the organization since 0004 (September
    // 2026) and kept on the device for offline use since offline mode (October 2026), so that answer
    // became the false one. Every fact below is in PRIVACY.md: stored in Canada, the claim's text and
    // its photo captions sent to Anthropic (possibly processed in the US, not used for training), the
    // photos themselves not sent except a side photo on AI trace or Finish exterior, a meter photo read
    // in the drying log and an uploaded roof measurement report, the device copies cleared at sign-out
    // once they have reached Scrivn, and the 24 months after an account closes.
    q: "What happens to the claim information I paste in?",
    a: "It's saved to your company's Scrivn account, stored in Canada, so you can come back to any claim. To write your documents, the claim's text, with your photos' captions, is sent to the AI model (Anthropic's Claude), which may process it in the United States and doesn't use it for training. The photos themselves aren't sent, except a side of the house when you press AI trace or Finish exterior, and a meter's screen when you read it in the drying log. A roof measurement report you upload is sent too, so its numbers can be read. It's never sold. So Scrivn works with no signal, the claims you've opened recently are also kept on your device; signing out clears them once they've reached Scrivn. Claims are kept until you delete them, or for 24 months after your account closes.",
  },
  {
    // PRIVACY.md, Service providers, Scrivn Scan and Keeping and deleting claim data, said plainly.
    q: "Where is my data kept?",
    a: (
      <>
        Your account, and your claims, photos and scans, are stored in Canada. Some of the providers Scrivn uses are in the United States, so
        information they handle — for example a claim&rsquo;s text during AI processing, or an email being sent — may be processed there.
        Scrivn Scan sends measurements and photos to Scrivn only when you send a scan to a claim; until then they stay on your phone. The one
        exception is Finish exterior, which sends each side&rsquo;s photo to read the roof and doesn&rsquo;t keep it. Claims,
        photos and scans are kept until your company deletes them, or for 24 months after its account closes. The details are in our{" "}
        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">
          privacy policy
        </a>
        .
      </>
    ),
  },
  {
    // PRIVACY.md, Deleting your account; lib/accountDeletion.ts and account_close (0014).
    q: "How do I delete my account?",
    a: (
      <>
        In Scrivn Scan, tap Account, then Delete account; or go to <Link href="/account/delete">scrivn.ca/account/delete</Link>; or email
        privacy@scrivn.ca from the address on the account. You&rsquo;ll be asked for your password. It deletes your sign-in, your details and
        the phones linked to your account. If nobody else is in your company&rsquo;s account, the company&rsquo;s claims, photos and scans are
        deleted too and its subscription is cancelled straight away; if others are, you leave it and the claims stay with the company.
      </>
    ),
  },
];

const BILLING: FaqEntry[] = [
  {
    // A contents-only claim never calls /api/generate (lib/claimGeneration.ts), so it is never counted: free by the owner's word, 2026-10-14.
    q: 'What counts as "a claim" for billing?',
    a: "One generated scope-and-report pair, for one property loss. A contents-only claim isn't counted: its documents are built in Scrivn without the AI step.",
  },
  {
    // ACCURACY: the mockup answered a bare "Yes — try Scrivn on a real claim before subscribing to
    // anything." True, but the trial now has definite limits worth stating up front rather than
    // discovering at claim six.
    q: "Is there a free trial?",
    a: `Yes — ${TRIAL_CLAIM_LIMIT} claims within ${TRIAL_DAYS} days, no credit card required. Try it on a real claim before subscribing to anything. Accounts are by invitation for now (see below).`,
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
    // Sign-up is shut (NEXT_PUBLIC_SIGNUPS_OPEN, lib/signup.ts) until paid plans open: the owner, 2026-10-14.
    q: "Can I sign up now?",
    a: (
      <>
        Accounts are by invitation for now, until paid plans open. If you&rsquo;ve been given one, <Link href="/login">sign in</Link>; to ask for
        one, <Link href="/contact">get in touch</Link>.
      </>
    ),
  },
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
  { heading: "Scrivn Scan & measuring", id: "scan", items: SCAN },
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
          <section className="mk-faq-section" key={section.id} id={section.id}>
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
