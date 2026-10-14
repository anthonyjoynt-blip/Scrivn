import { Button, Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * Someone signed up with an address that already has a confirmed account. The form says "check your
 * email" either way, so it cannot be used to find out who has an account; this is the email they
 * find, as Supabase's own sign-up did.
 */
export function AccountExistsEmail({ loginUrl, resetUrl }: { loginUrl: string; resetUrl: string }) {
  return (
    <EmailLayout preview="You already have a Scrivn account." heading="You already have an account">
      <Text style={emailStyles.paragraph}>Someone, probably you, tried to make a new Scrivn account with this email address. It already has one, so nothing was changed.</Text>
      <Section style={{ margin: "24px 0 8px" }}>
        <Button href={loginUrl} style={emailStyles.button}>
          Sign in
        </Button>
      </Section>
      <Text style={emailStyles.muted}>Forgotten the password? Choose a new one at {resetUrl}. If this wasn&rsquo;t you, ignore this email.</Text>
    </EmailLayout>
  );
}

export default AccountExistsEmail;
