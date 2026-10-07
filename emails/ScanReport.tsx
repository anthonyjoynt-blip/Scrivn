import { Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "./Layout";

/**
 * A tester sent a scan from Scrivn Scan ("Send to Scrivn team"), to whoever SCAN_REPORTS_TO (else
 * CONTACT_EMAIL) points at. The scan and its log stay in the database; this only says one came in
 * and how to pull it. Everything the tester typed is rendered as text through React, never as markup.
 */
export function ScanReportMessage(props: {
  id: string;
  who: string;
  contact: string;
  note: string;
  appVersion: string;
  device: string;
  android: string;
  roomCount: number;
  logKb: number;
  organization: string;
}) {
  const { id, who, contact, note, appVersion, device, android, roomCount, logKb, organization } = props;
  return (
    <EmailLayout preview={`Scan report from ${who}`} heading="A tester sent a scan">
      <div style={emailStyles.statBox}>
        <Text style={{ ...emailStyles.muted, margin: "0 0 6px" }}>
          <strong>From:</strong> {contact || "not given"}
          {organization ? ` (${organization})` : ""}
        </Text>
        <Text style={{ ...emailStyles.muted, margin: "0 0 6px" }}>
          <strong>Phone:</strong> {device || "unknown"}
          {android ? `, Android ${android}` : ""}
          {appVersion ? `, Scan ${appVersion}` : ""}
        </Text>
        <Text style={{ ...emailStyles.muted, margin: "0 0 6px" }}>
          <strong>Scan:</strong> {roomCount === 0 ? "none sent" : `${roomCount} room${roomCount === 1 ? "" : "s"}`}, log {logKb > 0 ? `${logKb} KB` : "none"}
        </Text>
        <Text style={{ ...emailStyles.muted, margin: 0 }}>
          <strong>Report:</strong> {id}
        </Text>
      </div>
      <Text style={{ ...emailStyles.paragraph, whiteSpace: "pre-wrap" }}>{note || "(no note)"}</Text>
      <Text style={emailStyles.muted}>
        Pull it with: node scripts/pull-scan-report.mjs {id.slice(0, 8)}
      </Text>
    </EmailLayout>
  );
}
