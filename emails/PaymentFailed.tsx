import { Button, Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * Sent to the organization's owner when a plan's card is declined — once per unpaid invoice, not
 * once per retry (2026-10-14, the Stripe webhook's `invoice.payment_failed`).
 *
 * Plain about the three things the owner needs: nothing stops today, the date it would, and the one
 * thing to do. Mirrors the in-app banner (components/UsageBanner.tsx) and the refusal once the date
 * passes (`blockedMessage` in lib/usage.ts), so the three read as one account of the same thing.
 *
 * `updateUrl` is /billing: a page, so a signed-out reader is sent through sign-in and on to Stripe's
 * billing portal, where the card is changed.
 */
export function PaymentFailedEmail({ planName, amount, graceEndDate, updateUrl }: { planName: string; amount: string | null; graceEndDate: string; updateUrl: string }) {
  return (
    <EmailLayout preview={`Your card was declined for your ${planName} plan. Update it by ${graceEndDate} to keep generating.`} heading="Your card payment didn't go through">
      <Text style={emailStyles.paragraph}>{`We tried to take ${amount ?? "the payment"} for your Scrivn ${planName} plan, and the card was declined.`}</Text>
      <Section style={emailStyles.statBox}>
        <Text style={emailStyles.statValue}>{`Scrivn keeps working until ${graceEndDate}`}</Text>
        <Text style={{ ...emailStyles.muted, margin: 0 }}>Nothing changes for your team in the meantime, and the card will be tried again over the next few days.</Text>
      </Section>
      <Text style={emailStyles.paragraph}>To sort it out now, update your card. Stripe takes the payment from the new card on its next try, and this goes away.</Text>
      <Section style={{ margin: "24px 0 8px" }}>
        <Button href={updateUrl} style={emailStyles.button}>
          Update your card
        </Button>
      </Section>
      <Text style={emailStyles.muted}>{`If the payment still hasn't gone through by ${graceEndDate}, generating new documents pauses until it does. Your claims and documents stay saved either way.`}</Text>
    </EmailLayout>
  );
}

export default PaymentFailedEmail;
