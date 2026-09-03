import { Button, Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * Sent once per billing period, when the last included claim is consumed.
 *
 * Deliberately mirrors the wording of the in-app blocking message (`blockedMessage` in lib/usage.ts)
 * — a PM who sees one and then the other should read the same explanation and the same two options,
 * not two differently-worded accounts of the same situation.
 */
export function UsageCapReachedEmail({ limit, planName, resetDate, pricingUrl }: { limit: number; planName: string; resetDate: string | null; pricingUrl: string }) {
  return (
    <EmailLayout preview={`You've used all ${limit} claims on your ${planName} plan this period.`} heading="You've reached your claim limit">
      <Section style={emailStyles.statBox}>
        <Text style={emailStyles.statValue}>
          {limit} of {limit} claims used
        </Text>
        <Text style={{ ...emailStyles.muted, margin: 0 }}>Your {planName} plan is fully used for this billing period.</Text>
      </Section>
      <Text style={emailStyles.paragraph}>
        Generating new documents is paused until your limit resets. Nothing has been charged beyond your plan price — this is a hard cap, not overage billing.
      </Text>
      <Text style={emailStyles.paragraph}>There are two ways forward:</Text>
      <Text style={emailStyles.paragraph}>
        <strong>Wait for the reset.</strong> {resetDate ? `Your limit refreshes on ${resetDate}.` : "Your limit refreshes at the start of your next billing period."} Claims
        already generated stay available.
      </Text>
      <Text style={emailStyles.paragraph}>
        <strong>Upgrade your plan.</strong> A higher limit applies immediately, and you can carry on straight away.
      </Text>
      <Section style={{ margin: "24px 0 8px" }}>
        <Button href={pricingUrl} style={emailStyles.button}>
          Upgrade your plan
        </Button>
      </Section>
    </EmailLayout>
  );
}

export default UsageCapReachedEmail;
