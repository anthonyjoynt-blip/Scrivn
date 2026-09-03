import { MarketingShell } from "@/components/marketing/MarketingShell";
import { ContactForm } from "@/components/marketing/ContactForm";
import { CONTACT_REASONS, DEFAULT_CONTACT_REASON } from "@/lib/contact";

/**
 * Copy and layout from design-reference/scrivn-contact-mockup.html, kept as approved.
 *
 * `?reason=` pre-selects the dropdown — /pricing's "Get a custom quote" button arrives with
 * `?reason=enterprise`. Validated against the known list here rather than passed through, so a
 * crafted URL can't put arbitrary text into the form.
 */
export const metadata = {
  title: "Contact — Scrivn",
  description: "Questions, a custom multi-office quote, or a look at the product first — this goes to a real person.",
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const initialReason = CONTACT_REASONS.some((r) => r.value === reason) ? (reason as string) : DEFAULT_CONTACT_REASON;

  return (
    <MarketingShell page="contact">
      <div className="mk-pagehead wrap">
        <h1>Get in touch</h1>
        <p>Questions, a custom multi-office quote, or just want to see it first — this goes straight to a real person.</p>
      </div>

      <ContactForm initialReason={initialReason} />

      <div className="narrow">
        <div className="mk-altcontact">
          <p>
            <b>Looking for a multi-office quote?</b> Select that as your reason above and include your approximate office count and monthly claim volume — it&rsquo;ll save a
            round trip.
          </p>
        </div>
      </div>
    </MarketingShell>
  );
}
