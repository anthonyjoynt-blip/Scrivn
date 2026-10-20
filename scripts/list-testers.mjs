/**
 * The testers scripts/add-tester.mjs has made: email, company, when made, and whether they have signed
 * in yet (opening the Forgot password email counts: it signs them in).
 *
 *   node scripts/list-testers.mjs
 *
 * Reads only. Found by the mark add-tester leaves in each account's app_metadata (lib/testerAccounts.ts).
 */
import { day, serviceClient, testerCode } from "./testers-common.mjs";

try {
  const app = await testerCode();
  const { db, host } = await serviceClient();
  console.log(`Supabase: ${host}`);
  const rows = await app.listTesters(db);
  if (rows.length === 0) {
    console.log("No testers made with add-tester yet.");
    process.exit(0);
  }
  console.log(`${rows.length} ${rows.length === 1 ? "tester" : "testers"} made with add-tester:\n`);
  const table = [["Email", "Company", "Made", "Signed in"], ...rows.map((r) => [r.email, r.company || r.fullName || "–", day(r.createdAt), r.lastSignInAt ? day(r.lastSignInAt) : "not yet"])];
  const widths = table[0].map((_, c) => Math.max(...table.map((row) => row[c].length)));
  for (const row of table) console.log(`  ${row.map((cell, c) => (c === row.length - 1 ? cell : cell.padEnd(widths[c]))).join("   ")}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
