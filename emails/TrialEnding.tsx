import { Button, Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * Sent when a free trial is nearly used up. The trial is 5 claims within 30 days, no card — see
 * lib/plans.ts's TRIAL_* constants and supabase/migrations/0003_trial.sql.
 *
 * LIVE for the claims half: `sendTrialNotifications` in lib/usage.ts fires this on the generation
 * that takes someone to 4 of 5, guarded by `trial_ending_email_sent_at` so it only ever sends once.
 *
 * NOT YET WIRED for the time half ("30-day window closing with claims still unused"). That can't be
 * triggered by user activity, because the people who need it are precisely the ones not generating
 * anything. It needs a scheduled job calling `sendTrialEndingEmail` — see that function's note.
 * `daysRemaining` is already in the props for exactly that caller.
 */
export function TrialEndingEmail({
  generationsUsed,
  generationsAllowed,
  daysRemaining,
  pricingUrl,
}: {
  generationsUsed: number;
  generationsAllowed: number;
  daysRemaining: number | null;
  pricingUrl: string;
}) {
  const remaining = Math.max(0, generationsAllowed - generationsUsed);

  return (
    <EmailLayout preview="Your Scrivn trial is nearly over — choose a plan to keep going." heading="Your trial is nearly over">
      <Section style={emailStyles.statBox}>
        <Text style={emailStyles.statValue}>
          {generationsUsed} of {generationsAllowed} trial claims used
        </Text>
        <Text style={{ ...emailStyles.muted, margin: 0 }}>
          {remaining === 0 ? "No trial claims remaining." : `${remaining} remaining`}
          {daysRemaining !== null ? ` · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left in your trial` : ""}.
        </Text>
      </Section>
      <Text style={emailStyles.paragraph}>
        Choosing a plan now means no interruption — your work carries on exactly where it is, and everything you’ve already generated stays available.
      </Text>
      <Section style={{ margin: "24px 0 8px" }}>
        <Button href={pricingUrl} style={emailStyles.button}>
          Choose a plan
        </Button>
      </Section>
    </EmailLayout>
  );
}

export default TrialEndingEmail;
