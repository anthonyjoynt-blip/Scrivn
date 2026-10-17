/**
 * The houses testers sent us to measure ("Send to Scrivn team to measure", migration 0016) - ours to read with the
 * service role, which is why this runs here and nowhere a browser reaches.
 *
 *   node scripts/pull-exterior-request.mjs           the requests waiting for us (sent, or being measured)
 *   node scripts/pull-exterior-request.mjs 3f9a      the one whose id starts 3f9a: marked measuring, and pulled into
 *                                                    exterior-requests/<id>/ - its photos at the size Scrivn keeps
 *                                                    them, named as a phone names them, and request.json (the route's
 *                                                    inputs: the shape drawn, the corners tapped, the tapes; the note)
 *
 * Every run also looks over our copies: one withdrawn by the tester, used, or gone with its claim is deleted, and
 * one older than 30 days is said. Then measure it (scripts/measure-exterior-request.mjs) and return it
 * (scripts/return-exterior-request.mjs). Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * .env.local and never prints them.
 */
import { relative } from "node:path";
import { listWaiting, pullRequest, ROOT, serviceClient, short, sweepFolders, sweepLines } from "./exterior-request-common.mjs";

const [arg] = process.argv.slice(2);
const db = await serviceClient();

try {
  if (!arg || arg === "list") {
    const lines = await listWaiting(db);
    console.log(lines.length ? lines.join("\n") : "Nothing waiting to be measured.");
  } else {
    const got = await pullRequest(db, arg);
    console.log(`${short(got.id)} -> ${relative(ROOT, got.folder)}: ${got.photos.length} photo${got.photos.length === 1 ? "" : "s"}, request.json${got.wasStatus === "sent" ? "; marked measuring" : ` (it was ${got.wasStatus})`}`);
    if (got.missing.length) console.log(`  ${got.missing.length} photo${got.missing.length === 1 ? " is" : "s are"} not on Scrivn yet (still on the tester's phone): pull again later. ${got.missing.join(", ")}`);
    console.log(`  from ${got.sentBy || "?"}; ${got.tapes.length} tape${got.tapes.length === 1 ? "" : "s"}${got.tapes.length ? `: ${got.tapes.map((t) => `${t.what} ${t.feet.toFixed(2)} ft`).join(", ")}` : ""}`);
    console.log(`  note: ${got.note || "(none)"}`);
  }
  for (const line of sweepLines(await sweepFolders(db))) console.log(line);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
