import { Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/** To the owner, once a day at most, when the day's estimated Claude spend crosses AI_SPEND_ALARM_USD (lib/aiSpend.ts). */
export function AiSpendAlarmEmail({ day, totalUsd, thresholdUsd, calls }: { day: string; totalUsd: number; thresholdUsd: number; calls: number }) {
  return (
    <EmailLayout preview={`Scrivn's AI spend today is about US$${totalUsd.toFixed(2)}.`} heading="AI spend is over today's alarm">
      <Section style={emailStyles.statBox}>
        <Text style={emailStyles.statValue}>US${totalUsd.toFixed(2)}</Text>
        <Text style={{ ...emailStyles.muted, margin: 0 }}>
          estimated for {day}, from {calls} Claude {calls === 1 ? "call" : "calls"}. The alarm is set at US${thresholdUsd.toFixed(2)}.
        </Text>
      </Section>
      <Text style={emailStyles.paragraph}>
        This is Scrivn&rsquo;s own estimate from the tokens each call reported. The Anthropic console has the real figure, and its spend limits are what actually stop
        spending.
      </Text>
      <Text style={emailStyles.muted}>You won&rsquo;t get another of these today. Change the threshold with AI_SPEND_ALARM_USD in Vercel.</Text>
    </EmailLayout>
  );
}

export default AiSpendAlarmEmail;
