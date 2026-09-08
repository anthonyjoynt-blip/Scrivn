/**
 * Shown when a navigation fails and there is no cached copy of that page — see public/sw.js.
 *
 * Reached far less often than it used to be. The worker now keeps the pages you have visited, so a
 * PM who has opened a claim before gets the real app with no signal rather than this. What is left
 * here is the genuinely new visitor, or a corner of the app nobody has been to on this device.
 *
 * Says what does and does not work rather than "you are offline", which the browser could have said.
 * Somebody in a basement needs to know whether to keep going or come back up, and the answer is now
 * "most of it works, two things do not" rather than "come back up".
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
          Scoping itself works without a connection once you have opened Scrivn here at least once — intake, the
          transcript, the sketch and the moisture map all run on the device, and anything you enter is held here and
          saved on its own when you have signal again.
        </p>
        <p className="field-note">
          Two things genuinely need a connection: reading a transcript into a scope, and generating the documents. Both
          are done by Claude, on a server. Opening a claim you started on another device needs one too.
        </p>
        <p className="field-note">
          <a href="/claim">Try the claim page</a> — if you have used it on this device, it will open.
        </p>
      </div>
    </main>
  );
}
