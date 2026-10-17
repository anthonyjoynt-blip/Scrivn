import { Button, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * To the tester who sent a house to measure (0016), when we return it (scripts/return-exterior-request.mjs). It
 * says only that it is ready and where: nothing of the claim is in the email.
 */
export function ExteriorReadyMessage(props: { what: string; claimUrl: string }) {
  const { what, claimUrl } = props;
  const named = what && what.toLowerCase() !== "the house" ? ` (${what})` : "";
  return (
    <EmailLayout preview="Your exterior measurements are ready" heading="Your exterior measurements are ready">
      <Text style={emailStyles.paragraph}>
        The Scrivn team has measured the exterior you sent{named}. Open the claim, go to the Exterior and tap Use it to put the measurements in. You can change anything after.
      </Text>
      <Button href={claimUrl} style={emailStyles.button}>
        Open the claim
      </Button>
      <Text style={{ ...emailStyles.muted, margin: "20px 0 0" }}>Our working copy of your photos has been deleted.</Text>
    </EmailLayout>
  );
}
