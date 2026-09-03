import { Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * A contact-form submission, sent to whoever CONTACT_EMAIL points at.
 *
 * Reply-To is set to the sender's address by the route, so hitting reply in a mail client goes to
 * the person who filled the form rather than to the no-reply sender.
 *
 * Everything here is text a stranger typed into a public form. It's rendered as plain text through
 * React (which escapes it) and never as markup — a contact form is the classic way to get HTML or a
 * script into someone's inbox.
 */
export function ContactMessage({ name, email, company, reason, message }: { name: string; email: string; company: string; reason: string; message: string }) {
  return (
    <EmailLayout preview={`${reason} — ${name}`} heading="New contact form submission">
      <div style={emailStyles.statBox}>
        <Text style={{ ...emailStyles.muted, margin: "0 0 6px" }}>
          <strong>From:</strong> {name} &lt;{email}&gt;
        </Text>
        {company && (
          <Text style={{ ...emailStyles.muted, margin: "0 0 6px" }}>
            <strong>Company:</strong> {company}
          </Text>
        )}
        <Text style={{ ...emailStyles.muted, margin: 0 }}>
          <strong>Reason:</strong> {reason}
        </Text>
      </div>
      {/* preserves the submitter's own line breaks without rendering their input as HTML */}
      <Text style={{ ...emailStyles.paragraph, whiteSpace: "pre-wrap" }}>{message}</Text>
    </EmailLayout>
  );
}
