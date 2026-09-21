import Link from "next/link";

/**
 * Where the pairing QR on the Account page points.
 *
 * The QR is meant to be scanned from inside Scrivn Scan, which reads the code out of the URL and
 * never opens this page. A phone's own camera app reads the same QR and does open it — that is the
 * most common way anyone scans a QR — so this is what they see: the one thing to do instead, in a
 * sentence, rather than the login form (the page is public in `middleware.ts`) and then a 404.
 *
 * Deliberately reads nothing from the address. The code in the query is a live, single-use secret
 * for the next ten minutes; the person holding the phone already has it on the screen they scanned
 * it from, and a page that echoed it would only put it in one more place. Static, so it needs no
 * session and no data.
 */
export const metadata = { title: "Pair a phone · Scrivn" };

export default function PairPage() {
  return (
    <main className="page">
      <div className="card">
        <h1>Pair a phone</h1>
        <p className="subtitle">This code pairs a phone with Scrivn — but it has to be read by the Scrivn Scan app, not the camera.</p>
        <p className="field-note">
          Open <strong>Scrivn Scan</strong> on this phone, tap <strong>Pair</strong>, and point it at the same code on your Scrivn screen —
          or type the eight letters shown under it. The code works once and for ten minutes; if it has run out, press{" "}
          <em>New code</em> on the Account page.
        </p>
        <p className="field-note">
          <Link href="/account">Back to the Account page</Link>
        </p>
      </div>
    </main>
  );
}
