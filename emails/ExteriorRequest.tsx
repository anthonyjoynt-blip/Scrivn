import { Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * A tester sent a house to measure ("Send to Scrivn team to measure", 0016), to whoever SCAN_REPORTS_TO (else
 * CONTACT_EMAIL) points at, as a scan report is. The photos and the request stay where they are; this only says
 * one came in and how to pull it. What the tester typed is rendered as text through React, never as markup.
 */
export function ExteriorRequestMessage(props: { id: string; from: string; what: string; photos: number; tapes: number; note: string }) {
  const { id, from, what, photos, tapes, note } = props;
  return (
    <EmailLayout preview={`${what} to measure`} heading={`${what} to measure`}>
      <div style={emailStyles.statBox}>
        <Text style={{ ...emailStyles.muted, margin: "0 0 6px" }}>
          <strong>From:</strong> {from || "not given"}
        </Text>
        <Text style={{ ...emailStyles.muted, margin: "0 0 6px" }}>
          <strong>Sent:</strong> {photos} photo{photos === 1 ? "" : "s"}, {tapes} tape{tapes === 1 ? "" : "s"}
        </Text>
        <Text style={{ ...emailStyles.muted, margin: 0 }}>
          <strong>Request:</strong> {id}
        </Text>
      </div>
      <Text style={{ ...emailStyles.paragraph, whiteSpace: "pre-wrap" }}>{note || "(no note)"}</Text>
      <Text style={emailStyles.muted}>Pull it with: node scripts/pull-exterior-request.mjs {id.slice(0, 8)}</Text>
    </EmailLayout>
  );
}
