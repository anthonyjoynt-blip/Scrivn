import { Button, Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * Sent once per billing period, on the generation that crosses 80% of the plan's cap — early enough
 * that a PM part-way through a caseload can act, rather than finding out when generation refuses.
 */
export function UsageWarningEmail({ used, limit, planName, resetDate, pricingUrl }: { used: number; limit: number; planName: string; resetDate: string | null; pricingUrl: string }) {
  const remaining = Math.max(0, limit - used);

  return (
    <EmailLayout preview={`${remaining} claims left on your ${planName} plan this period.`} heading="You're approaching your claim limit">
      <Section style={emailStyles.statBox}>
        <Text style={emailStyles.statValue}>
          {used} of {limit} claims used
        </Text>
        <Text style={{ ...emailStyles.muted, margin: 0 }}>
          {remaining} remaining on your {planName} plan{resetDate ? `, resetting ${resetDate}` : ""}.
        </Text>
      </Section>
      <Text style={emailStyles.paragraph}>
        Nothing changes yet — you can keep generating as normal. When you reach the limit, generation pauses until your next billing period, and nothing is ever charged beyond
        your plan price.
      </Text>
      <Text style={emailStyles.paragraph}>If you expect to need more claims this period, upgrading takes effect immediately.</Text>
      <Section style={{ margin: "24px 0 8px" }}>
        <Button href={pricingUrl} style={emailStyles.button}>
          View plans
        </Button>
      </Section>
    </EmailLayout>
  );
}

export default UsageWarningEmail;
