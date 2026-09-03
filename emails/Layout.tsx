import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import { DEFAULT_LETTERHEAD } from "@/lib/letterhead";

/**
 * The one place Scrivn's email letterhead is defined. Every template wraps its body in this, so the
 * banner, palette, and footer are described once rather than restated per email.
 *
 * Colours come from `lib/letterhead.ts` — the same object the on-screen banner and the PDF export
 * read — so a brand change propagates to email without a second edit. `Letterhead` stores RGB
 * triples for jsPDF, hence the small conversion below.
 *
 * Everything is inline-styled on purpose. Email clients strip <style> blocks and ignore most
 * external CSS; inline attributes are the only reliably-supported styling, which is also why this
 * looks nothing like the app's stylesheet.
 */
function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

const NAVY = rgb(DEFAULT_LETTERHEAD.primaryColor);
const AMBER = rgb(DEFAULT_LETTERHEAD.accentColor);
const TEXT = "#1a1d23";
const MUTED = "#5b6472";

export const emailStyles = {
  paragraph: { color: TEXT, fontSize: "15px", lineHeight: "1.6", margin: "0 0 16px" },
  muted: { color: MUTED, fontSize: "13px", lineHeight: "1.5", margin: "0 0 12px" },
  button: {
    backgroundColor: AMBER,
    color: NAVY,
    fontSize: "15px",
    fontWeight: 700,
    textDecoration: "none",
    padding: "12px 24px",
    borderRadius: "8px",
    display: "inline-block",
  },
  statBox: {
    backgroundColor: "#f5f7fa",
    borderRadius: "8px",
    padding: "16px 20px",
    margin: "0 0 20px",
  },
  statValue: { color: NAVY, fontSize: "22px", fontWeight: 700, margin: "0 0 4px" },
};

export function EmailLayout({ preview, heading, children }: { preview: string; heading: string; children: React.ReactNode }) {
  return (
    <Html>
      <Head />
      {/* The grey line clients show beside the subject — worth writing deliberately, since the
          fallback is a scrape of whatever text comes first. */}
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f5f7fa", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: "12px", maxWidth: "560px", margin: "0 auto", overflow: "hidden" }}>
          <Section style={{ backgroundColor: NAVY, padding: "24px 32px" }}>
            <Text style={{ color: "#ffffff", fontSize: "20px", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{DEFAULT_LETTERHEAD.companyName}</Text>
            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: "13px", margin: "4px 0 0" }}>{DEFAULT_LETTERHEAD.tagline}</Text>
          </Section>
          {/* The amber rule under the banner, mirroring the PDF and the on-screen header. */}
          <Section style={{ backgroundColor: AMBER, height: "4px", lineHeight: "4px", fontSize: "4px" }}>&nbsp;</Section>

          <Section style={{ padding: "32px" }}>
            <Text style={{ color: TEXT, fontSize: "19px", fontWeight: 700, margin: "0 0 20px", letterSpacing: "-0.01em" }}>{heading}</Text>
            {children}
          </Section>

          <Hr style={{ borderColor: "#e1e5ea", margin: 0 }} />
          <Section style={{ padding: "20px 32px" }}>
            <Text style={{ ...emailStyles.muted, margin: 0 }}>
              Sent by {DEFAULT_LETTERHEAD.companyName} · <Link href="https://scrivn.ca" style={{ color: MUTED }}>scrivn.ca</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
