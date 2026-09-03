/**
 * The contact form's "Reason for contact" options.
 *
 * Shared between the form (components/marketing/ContactForm.tsx) and the route that emails the
 * submission (app/api/contact/route.ts), so the server validates against exactly the list the
 * browser offered rather than trusting whatever string arrives.
 *
 * Labels are the approved copy from design-reference/scrivn-contact-mockup.html. The `value` is
 * what travels over the wire and what /pricing's "Get a custom quote" link puts in `?reason=`, so
 * changing one is a URL change — the labels are free to reword, the values are not.
 */
export interface ContactReason {
  value: string;
  label: string;
}

export const CONTACT_REASONS = [
  { value: "general", label: "General question" },
  { value: "sales", label: "Sales & pricing" },
  { value: "enterprise", label: "Multi-office / enterprise quote" },
  { value: "support", label: "Support" },
] as const satisfies readonly ContactReason[];

export const DEFAULT_CONTACT_REASON = CONTACT_REASONS[0].value;
