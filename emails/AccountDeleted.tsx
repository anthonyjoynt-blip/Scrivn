import { Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/** Sent once an account has been deleted (lib/accountDeletion.ts), to the address it had. */
export function AccountDeletedEmail() {
  return (
    <EmailLayout preview="Your Scrivn account and its data have been deleted." heading="Your account has been deleted">
      <Text style={emailStyles.paragraph}>
        As you asked, your Scrivn account has been deleted: your sign-in and details, your paired phones, and the claims, scans and photos of a company account you were the
        only person in. Any plan it had was cancelled.
      </Text>
      <Text style={emailStyles.paragraph}>If you were part of a team, the team&rsquo;s claims stay with the team.</Text>
      <Text style={emailStyles.muted}>
        Payment records are kept by Stripe as tax law requires. If you didn&rsquo;t ask for this, reply to this email or write to privacy@scrivn.ca.
      </Text>
    </EmailLayout>
  );
}

export default AccountDeletedEmail;
