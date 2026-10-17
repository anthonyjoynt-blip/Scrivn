/**
 * A house we measured, back to the tester who sent it (migration 0016).
 *
 *   node scripts/return-exterior-request.mjs 3f9a exterior-requests/<id>/exterior.json [--no-email]
 *
 * The file is the measure script's exterior.json (Scrivn's own Exterior), or a Scan exterior capture written by
 * hand (format arcapture-exterior/*, as test/exterior/fixtures/photos-only-1016.json). It is checked the way the
 * claim will open it, stored as the request's result, and the request marked ready: the tester's Exterior then
 * says "Measured – Use it". Then our copy, exterior-requests/<id>/, is deleted, and the tester is emailed that it
 * is ready (Scrivn's own email code; skipped with --no-email, or with no RESEND_API_KEY here).
 *
 * Returned again while the tester has not used it yet, the new one replaces the old. Refused once they have
 * used it or withdrawn it.
 */
import { appCode, readyMailer, returnRequest, serviceClient, short } from "./exterior-request-common.mjs";

const args = process.argv.slice(2);
const noEmail = args.includes("--no-email");
const [id, file] = args.filter((a) => !a.startsWith("--"));
if (!id || !file) {
  console.error("node scripts/return-exterior-request.mjs <id> <exterior.json> [--no-email]");
  process.exit(1);
}

try {
  const db = await serviceClient();
  const app = await appCode();
  const notify = noEmail ? null : await readyMailer();
  const done = await returnRequest(db, app, id, file, { notify });
  console.log(`${short(done.id)} returned${done.replaced ? " again (replacing the one before)" : ""}: ${done.sides} sides, from ${done.from}; marked ready.`);
  for (const n of done.notes) console.log(`  read: ${n}`);
  for (const w of done.warnings) console.log(`  warning: ${w}`);
  console.log(done.deleted ? `  our copy deleted: ${done.deleted}` : "  no copy of ours to delete.");
  console.log(`  ${done.told === "emailed" ? `emailed ${done.to} that it is ready` : done.told ? `${done.told} (${done.to})` : noEmail ? "not emailed (--no-email)" : done.to ? "not emailed (no RESEND_API_KEY here)" : "not emailed (no address for the sender)"}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
