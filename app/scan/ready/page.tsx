import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import "../scan.css";

export const metadata = {
  title: "Your Scrivn account is ready",
  description: "Your email is confirmed. Go back to Scrivn Scan and sign in.",
};

/**
 * Where the confirmation link of an account made in Scrivn Scan lands (lib/signup.ts, `forScan`):
 * the email is confirmed and this browser is signed in, but the person is here for the app, so the
 * page says to go back to it and sign in there. Public (middleware.ts), and it shows nothing of the
 * account, so a link opened on another device says the same thing.
 */
export default function ScanReadyPage() {
  return (
    <MarketingShell page="scan">
      <section className="sc-section wrap">
        <div className="sc-head">
          <h2>Your account is ready</h2>
          <p>Your email is confirmed. Go back to Scrivn Scan, tap Account, then Sign in with this email and your password.</p>
          <p>
            Scans you send from Scan go into your account here at scrivn.ca. <Link href="/scan-guide">How to use Scan</Link>
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
