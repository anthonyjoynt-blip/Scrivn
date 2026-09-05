/**
 * Shown when a navigation fails because the device is offline — see public/sw.js.
 *
 * Deliberately says what does and does not work rather than "you are offline", which the browser
 * could have said. A PM in a basement needs to know whether to keep going or come back up, and the
 * honest answer today is that Scrivn needs a connection for all of it. When stage 2 lands and
 * capture works offline, this page changes rather than being deleted.
 *
 * Static on purpose: the service worker caches it at install, and a page that needed the server
 * could not be the page shown when the server cannot be reached.
 */
export const metadata = { title: "Offline · Scrivn" };

export default function OfflinePage() {
  return (
    <main className="page">
      <div className="card">
        <h1>No connection</h1>
        <p className="subtitle">
          Scrivn needs a connection to open a claim. Your saved claims are safe — nothing has been lost.
        </p>
        <p className="field-note">
          Anything you had already entered was saved as you worked, so it will be exactly where you left it once
          you have signal again. Move somewhere with a connection and reload this page.
        </p>
      </div>
    </main>
  );
}
