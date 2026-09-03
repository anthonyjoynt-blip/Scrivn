import { Section, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * The covering message for documents a PM sends from a completed claim. The documents themselves
 * are PDF attachments; this just says who it's about and what's enclosed, so a recipient opening it
 * on a phone knows what they've got before downloading anything.
 */
export function DocumentsDeliveryEmail({
  customerName,
  jobNumber,
  documentNames,
  senderName,
  message,
}: {
  customerName: string;
  jobNumber: string;
  documentNames: string[];
  senderName: string | null;
  message: string | null;
}) {
  return (
    <EmailLayout preview={`Documents for ${jobNumber} – ${customerName}`} heading={`Documents for ${jobNumber || "this claim"}`}>
      <Text style={emailStyles.paragraph}>
        {senderName ? `${senderName} has sent you` : "Please find"} documentation for <strong>{customerName || "this claim"}</strong>
        {jobNumber ? ` (job ${jobNumber})` : ""}.
      </Text>

      {message && (
        <Section style={emailStyles.statBox}>
          {/* The PM's own words, shown as written. */}
          <Text style={{ ...emailStyles.paragraph, margin: 0, whiteSpace: "pre-wrap" }}>{message}</Text>
        </Section>
      )}

      <Text style={emailStyles.paragraph}>Attached:</Text>
      {documentNames.map((name) => (
        <Text key={name} style={{ ...emailStyles.paragraph, margin: "0 0 6px" }}>
          • {name}
        </Text>
      ))}

      <Text style={{ ...emailStyles.muted, marginTop: "20px" }}>Reply to this email to reach the sender directly.</Text>
    </EmailLayout>
  );
}

export default DocumentsDeliveryEmail;
