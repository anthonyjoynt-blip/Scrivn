import { Button, Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * Sent once, after Supabase's email confirmation succeeds — not instead of it. The confirmation
 * email proves the address; this one welcomes them and points at the first useful action.
 */
export function WelcomeEmail({ fullName, appUrl }: { fullName?: string | null; appUrl: string }) {
  const firstName = fullName?.trim().split(/\s+/)[0];

  return (
    <EmailLayout preview="Your Scrivn account is ready — start your first claim." heading={firstName ? `Welcome, ${firstName}` : "Welcome to Scrivn"}>
      <Text style={emailStyles.paragraph}>Your email is confirmed and your account is ready to use.</Text>
      <Text style={emailStyles.paragraph}>
        Scrivn turns a walkthrough into an inspection report and a scope document — paste or dictate what you saw on site, answer a short set of follow-up questions, and the
        documents come back ready to review and export.
      </Text>
      <Section style={{ margin: "24px 0 8px" }}>
        <Button href={appUrl} style={emailStyles.button}>
          Start your first claim
        </Button>
      </Section>
      <Text style={emailStyles.muted}>If you have questions or something doesn’t look right, just reply to this email.</Text>
    </EmailLayout>
  );
}

export default WelcomeEmail;
