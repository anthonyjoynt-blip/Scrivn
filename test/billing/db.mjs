/**
 * The plan, the counter and the trial on the organization (0011_org_billing.sql), against every
 * migration in a Postgres in memory.
 *
 *   npm run test:billing      (test/billing/run.mjs first, then this)
 *
 * Three questions, asked of the real SQL (test/db/supabaseLocal.mjs) rather than of a description
 * of it:
 *
 *   1. Does applying 0011 to a database full of people mid-trial and mid-plan leave every one of
 *      them with exactly the allowance they had? Accounts are made and given billing state on the
 *      PROFILE with the migrations before 0011, then 0011 runs, and the numbers lib/usage.ts computes
 *      from the organization are compared with the ones it used to compute from the profile.
 *   2. Does the counter count — on the trial and on a plan, once per call, shared by a team, and
 *      only through the service role?
 *   3. While the previous build is still live after 0011 runs, do its profile writes reach the
 *      organization (the cutover mirror), without ever touching a team?
 *   4. A declined card (0013): is the first failure's time kept, the owner told once per invoice, the
 *      failure cleared only by a payment that came after it — and all of it out of the browser's
 *      reach?
 *   5. A generation counted once (0013): does an id finished twice count once? (The route around it
 *      is tested in test/billing/routes.mjs.)
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { newToken, sha256Hex, splitMigrationsAt, startSupabaseLocal } from "../db/supabaseLocal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "billing-db-tests-"));
const bundlePath = join(outDir, "bundle.mjs");
await build({
  stdin: { contents: `export * from "@/lib/usageState"; export * from "@/lib/plans";`, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root },
  logLevel: "error",
});
const { usageFromBilling } = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}
const rows = (res) => res.data ?? [];

const BILLING = "subscription_tier, claims_used_this_period, period_reset_at, trial_started_at, trial_claims_used, trial_ending_email_sent_at, stripe_customer_id";
const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
const sameBilling = (a, b) =>
  a.subscription_tier === b.subscription_tier &&
  a.claims_used_this_period === b.claims_used_this_period &&
  iso(a.period_reset_at) === iso(b.period_reset_at) &&
  iso(a.trial_started_at) === iso(b.trial_started_at) &&
  a.trial_claims_used === b.trial_claims_used &&
  iso(a.trial_ending_email_sent_at) === iso(b.trial_ending_email_sent_at) &&
  a.stripe_customer_id === b.stripe_customer_id;
/** The row as lib/usage.ts receives it from PostgREST: timestamps as ISO strings. */
const asApi = (r) => ({ ...r, period_reset_at: iso(r.period_reset_at), trial_started_at: iso(r.trial_started_at) });

const s = await startSupabaseLocal();
const { before, from } = splitMigrationsAt(root, "_org_billing.sql");
for (const m of before) await s.applyMigration(m);

/* ── Before 0011: people with billing on their profiles ───────────────────────────────────────── */

const day = 86_400_000;
const now = Date.now();
const people = {
  paid: await s.createUser({ email: "paid@x.test", fullName: "Paid Growth" }),
  trial: await s.createUser({ email: "trial@x.test", fullName: "On Trial" }),
  spent: await s.createUser({ email: "spent@x.test", fullName: "Trial Spent" }),
  scan: await s.createUser({ email: "scan@x.test", fullName: "Scan Only" }),
  fresh: await s.createUser({ email: "fresh@x.test", fullName: "Just Signed Up" }),
};
const legacy = {
  paid: { subscription_tier: "growth", claims_used_this_period: 61, period_reset_at: "2026-11-01T00:00:00Z", trial_started_at: new Date(now - 90 * day).toISOString(), trial_claims_used: 5, trial_ending_email_sent_at: new Date(now - 80 * day).toISOString(), stripe_customer_id: "cus_paid" },
  trial: { subscription_tier: null, claims_used_this_period: 0, period_reset_at: null, trial_started_at: new Date(now - 10 * day).toISOString(), trial_claims_used: 3, trial_ending_email_sent_at: null, stripe_customer_id: null },
  spent: { subscription_tier: null, claims_used_this_period: 0, period_reset_at: null, trial_started_at: new Date(now - 40 * day).toISOString(), trial_claims_used: 2, trial_ending_email_sent_at: null, stripe_customer_id: "cus_lapsed" },
  scan: { subscription_tier: "scan", claims_used_this_period: 0, period_reset_at: "2026-11-05T00:00:00Z", trial_started_at: new Date(now - 5 * day).toISOString(), trial_claims_used: 1, trial_ending_email_sent_at: null, stripe_customer_id: "cus_scan" },
};
for (const [who, b] of Object.entries(legacy)) {
  await s.sql(
    `update public.profiles set subscription_tier = $2, claims_used_this_period = $3, period_reset_at = $4, trial_started_at = $5, trial_claims_used = $6, trial_ending_email_sent_at = $7, stripe_customer_id = $8 where id = $1`,
    [people[who], b.subscription_tier, b.claims_used_this_period, b.period_reset_at, b.trial_started_at, b.trial_claims_used, b.trial_ending_email_sent_at, b.stripe_customer_id],
  );
}
const profileBefore = {};
for (const [who, id] of Object.entries(people)) profileBefore[who] = (await s.sql(`select ${BILLING} from public.profiles where id = $1`, [id]))[0];

for (const m of from) await s.applyMigration(m);

/* ── 1. The copy ──────────────────────────────────────────────────────────────────────────────── */

const orgOf = async (id) => (await s.sql(`select organization_id from public.organization_members where user_id = $1`, [id]))[0].organization_id;
const orgBilling = async (id) => (await s.sql(`select ${BILLING}, seat_limit from public.organizations where id = $1`, [await orgOf(id)]))[0];
const profileBilling = async (id) => (await s.sql(`select ${BILLING} from public.profiles where id = $1`, [id]))[0];

for (const [who, id] of Object.entries(people)) {
  const org = await orgBilling(id);
  check(sameBilling(org, profileBefore[who]), `0011 copies ${who}'s plan, counter, trial and Stripe customer onto the organization they own (got ${JSON.stringify(org)})`);
  check(sameBilling(await profileBilling(id), profileBefore[who]), `and leaves ${who}'s profile columns as they were, for the build before`);
  // One person on the Scan plan (owner, 2026-10-14), no limit on anything else.
  const scanAlone = profileBefore[who].subscription_tier === "scan";
  check(org.seat_limit === (scanAlone ? 1 : null), `${who}'s organization ${scanAlone ? "covers one person, as a Scan plan does" : "has no seat limit"} (got ${org.seat_limit})`);
  const was = usageFromBilling(asApi(profileBefore[who]), { organizationId: null, role: "owner" }, now);
  const is = usageFromBilling(asApi(org), { organizationId: null, role: "owner" }, now);
  // The seat limit is the one thing the organization adds (a profile has none); the allowance must not move.
  const { seatLimit: _wasSeats, ...wasAllowance } = was;
  const { seatLimit: isSeats, ...isAllowance } = is;
  check(JSON.stringify(wasAllowance) === JSON.stringify(isAllowance), `lib/usage.ts gives ${who} the same allowance from the organization as from the profile (${is.noPlan ? (is.onTrial ? "trial" : `trial over: ${is.trialExpiredReason}`) : `${is.used} of ${is.limit}`})`);
  check(isSeats === (scanAlone ? 1 : null), `and reads ${who}'s seat limit from the organization (got ${isSeats})`);
}
{
  const paid = usageFromBilling(asApi(await orgBilling(people.paid)), { organizationId: null, role: "owner" }, now);
  check(!paid.noPlan && paid.used === 61 && paid.limit === 75 && paid.remaining === 14, "Growth, 61 of 75, is still 61 of 75");
  const spent = usageFromBilling(asApi(await orgBilling(people.spent)), { organizationId: null, role: "owner" }, now);
  check(spent.noPlan && !spent.onTrial && spent.trialExpiredReason === "time", "a trial whose 30 days ran out is still over, for the same reason");
  const scan = usageFromBilling(asApi(await orgBilling(people.scan)), { organizationId: null, role: "owner" }, now);
  check(scan.tier === "scan" && scan.noPlan && scan.onTrial && scan.trialClaimsUsed === 1, "Scan alone is still Scan, with its four trial claims left");
}

/* ── 2. The counter ───────────────────────────────────────────────────────────────────────────── */

const count = (orgId, onTrial) => s.service(`select * from public.org_count_claim($1, $2)`, [orgId, onTrial]);
{
  const trialOrg = await orgOf(people.trial);
  const r = await count(trialOrg, true);
  check(r.error === null && rows(r)[0]?.used_before === 3 && rows(r)[0]?.used_after === 4, `a trial claim counts 3 → 4 and says so (got ${r.error?.message ?? JSON.stringify(rows(r))})`);
  check((await orgBilling(people.trial)).claims_used_this_period === 0, "on the trial counter only");
  const r2 = await count(trialOrg, true);
  check(rows(r2)[0]?.used_after === 5, "the fifth");
  const u = usageFromBilling(asApi(await orgBilling(people.trial)), { organizationId: trialOrg, role: "owner" });
  check(!u.onTrial && u.trialExpiredReason === "claims" && u.atLimit, "after which the trial is over for claims, and generation is refused");
}
{
  const paidOrg = await orgOf(people.paid);
  for (let i = 0; i < 14; i++) await count(paidOrg, false);
  const org = await orgBilling(people.paid);
  check(org.claims_used_this_period === 75 && org.trial_claims_used === 5, "fourteen plan claims take Growth from 61 to exactly 75, the trial counter untouched");
  const u = usageFromBilling(asApi(org), { organizationId: paidOrg, role: "owner" });
  check(u.atLimit && u.remaining === 0, "where the hard cap stops it");
}
{
  const r = await s.as(people.fresh, `select * from public.org_count_claim($1, true)`, [await orgOf(people.fresh)]);
  check(r.error !== null && (await orgBilling(people.fresh)).trial_claims_used === 0, "a signed-in person cannot call the counter (it would let them not call it)");
  const a = await s.as(null, `select * from public.org_count_claim($1, true)`, [await orgOf(people.fresh)]);
  check(a.error !== null, "nor can the bare anon key");
  const nobody = await count("00000000-0000-0000-0000-000000000000", true);
  check(nobody.error === null && rows(nobody).length === 0, "an organization that does not exist counts nothing and returns no row");
}

/* ── The columns are the service role's ───────────────────────────────────────────────────────── */

{
  const freshOrg = await orgOf(people.fresh);
  for (const set of ["subscription_tier = 'unlimited'", "claims_used_this_period = 0", "period_reset_at = now()", "trial_started_at = now()", "trial_claims_used = 0", "trial_ending_email_sent_at = null", "stripe_customer_id = 'cus_x'", "seat_limit = 50"]) {
    const r = await s.as(people.fresh, `update public.organizations set ${set} where id = $1`, [freshOrg]);
    check(r.error?.code === "42501", `the owner cannot set ${set.split(" ")[0]} from the browser (got ${r.error?.code ?? "ACCEPTED"})`);
  }
  check(rows(await s.as(people.fresh, `update public.organizations set tagline = 'ok' where id = $1 returning id`, [freshOrg])).length === 1, "but can still set the letterhead");
  const tier = await s.service(`update public.organizations set subscription_tier = 'platinum' where id = $1`, [freshOrg]);
  check(tier.error !== null, "even the webhook cannot store a tier that does not exist");
  const seats = await s.service(`update public.organizations set seat_limit = 0 where id = $1`, [freshOrg]);
  check(seats.error !== null, "nor a seat limit below one");
  const dup = await s.service(`update public.organizations set stripe_customer_id = 'cus_paid' where id = $1`, [freshOrg]);
  check(dup.error !== null, "and one Stripe customer belongs to one organization");
}

/* ── 3. The cutover mirror ────────────────────────────────────────────────────────────────────── */

{
  const id = people.fresh;
  await s.sql(`update public.organizations set claims_used_this_period = 7 where id = $1`, [await orgOf(id)]);
  // What the previous build's webhook and lib/usage.ts write, after 0011 has run.
  await s.sql(`update public.profiles set subscription_tier = 'starter', period_reset_at = '2026-12-01T00:00:00Z', stripe_customer_id = 'cus_fresh' where id = $1`, [id]);
  let org = await orgBilling(id);
  check(org.subscription_tier === "starter" && iso(org.period_reset_at) === "2026-12-01T00:00:00.000Z" && org.stripe_customer_id === "cus_fresh", "a plan granted to the profile by the previous build reaches the organization");
  check(org.claims_used_this_period === 7, "without copying the columns that did not change over the organization's own");
  await s.sql(`update public.profiles set trial_claims_used = trial_claims_used + 1 where id = $1`, [id]);
  org = await orgBilling(id);
  check(org.trial_claims_used === 1, "a trial claim the previous build counts on the profile is counted on the organization");
  await s.sql(`update public.profiles set full_name = 'Renamed' where id = $1`, [id]);
  check((await orgBilling(id)).trial_claims_used === 1, "an ordinary profile edit leaves the organization alone");
}

/* ── A team shares one allowance ──────────────────────────────────────────────────────────────── */

{
  const paidOrg = await orgOf(people.paid);
  await s.sql(`update public.organizations set claims_used_this_period = 10 where id = $1`, [paidOrg]);
  const token = newToken();
  const inv = await s.as(people.paid, `select * from public.org_invite_create($1, 'member', $2)`, [`teammate@x.test`, sha256Hex(token)]);
  const mate = await s.createUser({ email: "teammate@x.test", fullName: "Team Mate" });
  const mateHome = await orgOf(mate);
  const acc = await s.as(mate, `select * from public.org_invite_accept($1)`, [sha256Hex(token)]);
  check(inv.error === null && acc.error === null && (await orgOf(mate)) === paidOrg, `a teammate joins the Growth organization (got ${inv.error?.message ?? acc.error?.message ?? "ok"})`);

  await count(paidOrg, false);
  const seenByOwner = rows(await s.as(people.paid, `select claims_used_this_period from public.organizations where id = $1`, [paidOrg]))[0];
  const seenByMate = rows(await s.as(mate, `select claims_used_this_period from public.organizations where id = $1`, [paidOrg]))[0];
  check(seenByOwner?.claims_used_this_period === 11 && seenByMate?.claims_used_this_period === 11, "a claim either of them generates comes off one counter both of them see");
  const mateUsage = usageFromBilling(asApi(await orgBilling(people.paid)), { organizationId: paidOrg, role: "member" });
  check(mateUsage.used === 11 && mateUsage.limit === 75 && !mateUsage.canManageBilling, "the teammate's usage is the team's, and the billing is not theirs to manage");
  const homeTrial = (await s.sql(`select trial_claims_used, trial_started_at from public.organizations where id = $1`, [mateHome]))[0];
  check(homeTrial.trial_claims_used === 0, "their own organization, set aside, keeps its unused trial for if they leave");

  await s.sql(`update public.profiles set claims_used_this_period = 0, subscription_tier = null where id = $1`, [people.paid]);
  const after = await orgBilling(people.paid);
  check(after.claims_used_this_period === 11 && after.subscription_tier === "growth", "a stray write to the owner's old profile columns never moves a team's plan");
}

/* ── 4. A declined card (0013) ─────────────────────────────────────────────────────────────────── */

{
  const owner = await s.createUser({ email: "card@x.test", fullName: "Card Declined" });
  const org = await orgOf(owner);
  await s.sql(`update public.organizations set subscription_tier = 'growth', claims_used_this_period = 12, stripe_customer_id = 'cus_card' where id = $1`, [org]);
  const failed = (invoice, at) => s.service(`select * from public.org_payment_failed($1, $2, $3)`, [org, invoice, at]);
  const settled = (at) => s.service(`select public.org_payment_settled($1, $2) as cleared`, [org, at]);
  const state = async () => (await s.sql(`select payment_failed_at, payment_failed_invoice, subscription_tier from public.organizations where id = $1`, [org]))[0];

  const first = await failed("in_1", "2026-11-01T09:30:00Z");
  check(first.error === null && iso(rows(first)[0]?.failed_since) === "2026-11-01T09:30:00.000Z" && rows(first)[0]?.first_notice === true, `the first failure is recorded, and is the one the owner hears about (got ${first.error?.message ?? JSON.stringify(rows(first))})`);
  const retry = await failed("in_1", "2026-11-03T09:30:00Z");
  check(iso(rows(retry)[0]?.failed_since) === "2026-11-01T09:30:00.000Z" && rows(retry)[0]?.first_notice === false, "Stripe's retry of the same invoice fails again: the grace still runs from the first, and nobody is emailed twice");
  const twice = await failed("in_1", "2026-11-01T09:30:00Z");
  check(rows(twice)[0]?.first_notice === false, "nor when Stripe delivers the same event twice");
  const pastDue = await failed(null, "2026-10-31T23:00:00Z");
  check(iso(rows(pastDue)[0]?.failed_since) === "2026-10-31T23:00:00.000Z" && rows(pastDue)[0]?.first_notice === false, "a past-due event with an earlier time (events arrive in any order) moves the start back, and is no notice on its own");
  check((await state()).payment_failed_invoice === "in_1", "and leaves the invoice as it was");
  const next = await failed("in_2", "2026-12-01T09:30:00Z");
  check(rows(next)[0]?.first_notice === true && iso(rows(next)[0]?.failed_since) === "2026-10-31T23:00:00.000Z", "a different invoice is news, but the grace still runs from the first failure");

  const u = usageFromBilling(asApi(await s.sql(`select subscription_tier, claims_used_this_period, payment_failed_at from public.organizations where id = $1`, [org]).then((r) => ({ ...r[0], payment_failed_at: iso(r[0].payment_failed_at) }))), { organizationId: org, role: "owner" }, Date.parse("2026-11-03T00:00:00Z"));
  check(u.paymentFailedAt === "2026-10-31T23:00:00.000Z" && !u.paymentOverdue && !u.atLimit, "lib/usage.ts reads the failure from the organization, inside the grace");

  const stale = await settled("2026-10-30T00:00:00Z");
  check(rows(stale)[0]?.cleared === false && (await state()).payment_failed_at !== null, "an 'active' event from before the card failed does not clear the failure");
  const paid = await settled("2026-11-04T10:00:00Z");
  const after = await state();
  check(rows(paid)[0]?.cleared === true && after.payment_failed_at === null && after.payment_failed_invoice === null && after.subscription_tier === "growth", "a payment after it clears both columns and nothing else");
  check(rows(await settled("2026-11-05T00:00:00Z"))[0]?.cleared === false, "and with nothing failed there is nothing to clear");

  for (const set of ["payment_failed_at = null", "payment_failed_invoice = null"]) {
    const r = await s.as(owner, `update public.organizations set ${set} where id = $1`, [org]);
    check(r.error?.code === "42501", `the owner cannot set ${set.split(" ")[0]} from the browser, so cannot end their own grace early or hide a failure (got ${r.error?.code ?? "ACCEPTED"})`);
  }
  const seen = await s.as(owner, `select payment_failed_at from public.organizations where id = $1`, [org]);
  check(seen.error === null && rows(seen).length === 1, "but can read it, which is what the banner does");
  for (const call of [`select * from public.org_payment_failed($1, 'in_x', now())`, `select public.org_payment_settled($1, now())`]) {
    const r = await s.as(owner, call, [org]);
    check(r.error !== null, `a signed-in person cannot call ${call.match(/org_payment_\w+/)[0]}`);
    const a = await s.as(null, call, [org]);
    check(a.error !== null, "nor can the anon key");
  }
  const nobody = await s.service(`select * from public.org_payment_failed('00000000-0000-0000-0000-000000000000', 'in_1', now())`);
  check(nobody.error === null && rows(nobody).length === 0, "an organization that does not exist records nothing and returns no row");
}

/* ── 5. A generation counted once (0013) ───────────────────────────────────────────────────────── */

{
  const pm = await s.createUser({ email: "once@x.test" });
  const org = await orgOf(pm);
  const job = "0f0f0f0f-0000-4000-8000-000000000001";
  const usedNow = async () => (await s.sql(`select trial_claims_used from public.organizations where id = $1`, [org]))[0].trial_claims_used;
  const begin = async () => rows(await s.service(`select * from public.generation_job_begin($1, $2, $3)`, [job, pm, org]))[0];
  const finish = (doc) => s.service(`select * from public.generation_job_finish($1, $2, true, $3::jsonb)`, [job, pm, JSON.stringify(doc)]);

  check((await begin())?.outcome === "new", "a new id begins");
  check((await begin())?.outcome === "running", "the same id again while it runs is running");
  const first = await finish({ scopeDocument: "first" });
  check(rows(first)[0]?.used_before === 0 && rows(first)[0]?.used_after === 1, "finishing it counts the claim");
  // The answer is lost; the device sends the same id again.
  const again = await begin();
  check(again?.outcome === "done" && again?.saved?.scopeDocument === "first", "begun again, it is done, with the documents kept");
  const second = await finish({ scopeDocument: "second" });
  check(rows(second).length === 0 && (await usedNow()) === 1, "and finishing it a second time counts nothing: a lost answer plus a retry counts once");
}

await s.close();
rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  billing (database): ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
