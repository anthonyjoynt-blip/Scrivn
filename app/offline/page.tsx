/**
 * Shown when a navigation fails and there is no cached copy of that page — see public/sw.js.
 *
 * Reached far less often than it used to be. The worker keeps the claim page and the Claims list
 * ready (it fetches them ahead of need while there is signal), and claims themselves are kept on the
 * device, so a PM who has used Scrivn here before gets the real app with no signal rather than this.
 * What is left is the genuinely new visitor, or a corner of the app nobody has been to on this device.
 *
 * Says what does and does not work rather than "you are offline", which the browser could have said.
 * Somebody in a basement needs to know whether to keep going or come back up, and the answer is
 * "keep going".
 *
 * Static on purpose: the worker caches it at install, and a page that needed the server could not be
 * the page shown when the server cannot be reached.
 */
export const metadata = { title: "Offline · Scrivn" };

export default function OfflinePage() {
  return (
    <main className="page">
      <div className="card">
        <h1>No connection</h1>
        <p className="subtitle">
          This page has not been opened on this device before, so there is no copy of it to show. Nothing has been lost.
        </p>
        <p className="field-note">
          Scrivn works without a connection once it has been opened on this device: claims you have opened here open from
          the device, and new claims, the sketch, the moisture map and everything you enter are saved on the device and
          synced on their own when you have signal.
        </p>
        <p className="field-note">
          Reading a transcript into a scope and generating the documents are done by Claude, on a server — with no signal
          they wait, and run on their own as soon as there is signal.
        </p>
        <p className="field-note">
          <a href="/claims">Your claims</a> · <a href="/claim">New claim</a>
        </p>
      </div>
    </main>
  );
}
