import { Button, Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * "Confirm your email", sent by Scrivn itself since sign-up runs on the server (lib/signup.ts): the
 * account is made with Supabase's admin API, so Supabase sends nothing, and this carries the same
 * /auth/confirm link its own template did (supabase/README.md §4).
 */
export function ConfirmSignupEmail({ fullName, confirmUrl, forScan }: { fullName?: string | null; confirmUrl: string; forScan: boolean }) {
  const firstName = fullName?.trim().split(/\s+/)[0];
  return (
    <EmailLayout preview="Confirm your email to finish setting up your Scrivn account." heading={firstName ? `Confirm your email, ${firstName}` : "Confirm your email"}>
      <Text style={emailStyles.paragraph}>
        {forScan
          ? "Confirm this address to finish setting up your Scrivn account. Then go back to Scrivn Scan and sign in."
          : "Confirm this address to finish setting up your Scrivn account. You'll be signed in when you do."}
      </Text>
      <Section style={{ margin: "24px 0 8px" }}>
        <Button href={confirmUrl} style={emailStyles.button}>
          Confirm your email
        </Button>
      </Section>
      <Text style={emailStyles.muted}>If you didn&rsquo;t sign up for Scrivn, ignore this email: an account nobody confirms can&rsquo;t be signed in to.</Text>
    </EmailLayout>
  );
}

export default ConfirmSignupEmail;
