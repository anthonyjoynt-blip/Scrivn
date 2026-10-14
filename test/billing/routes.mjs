/**
 * The billing routes themselves, run against every migration in memory.
 *
 *   npm run test:billing      (run.mjs and db.mjs first, then this)
 *
 * app/api/webhooks/stripe/route.ts is bundled as it is, with Supabase pointed at the in-memory
 * Postgres (test/db/supabaseLocal.mjs, through test/db/supabaseJs.mjs), Stripe's API and Resend
 * replaced by recorders (test/billing/routeShims.mjs), and fed signed events the way Stripe sends
 * them. Questions:
 *
 *   1. A declined card (0013): is the plan kept through the grace period and then let go, the owner
 *      emailed once per invoice with a link to update the card, and everything cleared by a payment —
 *      but never by an event from before the failure?
 *   2. On a database without 0013, does the webhook behave exactly as before: the plan goes at the
 *      first failure, and nothing errors?
 *   3. The banner and the email say it in words.
 *   4. A generation is counted once (0013): app/api/generate/route.ts, sent twice under one id because
 *      the first answer was lost, generates once, counts once and answers the retry with the same
 *      documents — including when the first used the last claim, when the retry comes while the
 *      first is still running, and when the first failed. Without 0013, and before 0011, it counts
 *      as it always did.
 *   5. Stripe Tax at checkout follows STRIPE_AUTOMATIC_TAX, off unless it is exactly "true".
 *
 * (The "signature verification failed" line in the output is the forged event being refused.)
 *
 * test/billing/stripe-e2e.mjs runs the same webhook against Stripe's own test mode.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@react-email/components";
import { splitMigrationsAt, startSupabaseLocal } from "../db/supabaseLocal.mjs";
import { bundleRoutes } from "./bundleRoutes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const { mod: routes, cleanup } = await bundleRoutes(
  `export { POST as webhook } from "@/app/api/webhooks/stripe/route"; export { POST as generate } from "@/app/api/generate/route"; export { POST as checkout } from "@/app/api/checkout/route";
   export { UsageBanner } from "@/components/UsageBanner"; export { emptyClaimInfo } from "@/lib/claimInfo"; export { emptyLoss, withDerivedFields } from "@/lib/types";`,
  "routes",
);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}

/* ── Stripe, as the webhook sees it ───────────────────────────────────────────────────────────── */

const SECRET = "whsec_routes_test";
const PRICES = { starter: "price_test_starter", growth: "price_test_growth", unlimited: "price_test_unlimited", scanMonthly: "price_test_scan_m", scanYearly: "price_test_scan_y" };
Object.assign(process.env, {
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_PRICE_STARTER: PRICES.starter,
  STRIPE_PRICE_GROWTH: PRICES.growth,
  STRIPE_PRICE_UNLIMITED: PRICES.unlimited,
  STRIPE_PRICE_SCAN_MONTHLY: PRICES.scanMonthly,
  STRIPE_PRICE_SCAN_YEARLY: PRICES.scanYearly,
  NEXT_PUBLIC_APP_URL: "https://scrivn.ca",
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
});

const signer = new Stripe("sk_test_routes_only");
/** Subscriptions as Stripe holds them now — what `stripe.subscriptions.retrieve` answers. */
const subscriptions = new Map();
const fakeStripe = {
  webhooks: signer.webhooks,
  subscriptions: {
    retrieve: async (id) => {
      const sub = subscriptions.get(id);
      if (!sub) throw new Error(`no such subscription ${id}`);
      return sub;
    },
    list: async () => ({ data: [] }),
    cancel: async () => ({}),
  },
};

const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);
function subscription(id, customer, price, status, periodEnd = "2026-12-01T00:00:00Z") {
  const sub = { id, object: "subscription", customer, status, items: { data: [{ price: { id: price }, quantity: 1, current_period_end: epoch(periodEnd) }] } };
  subscriptions.set(id, sub);
  return sub;
}
function invoice(id, customer, sub, { attempt = 1, amount = 9345 } = {}) {
  return {
    id,
    object: "invoice",
    customer,
    customer_email: "stripe-copy@x.test",
    amount_due: amount,
    currency: "cad",
    attempt_count: attempt,
    parent: sub ? { type: "subscription_details", subscription_details: { subscription: sub } } : null,
  };
}
let seq = 0;
function event(type, object, at, id = `evt_${++seq}`) {
  return { id, object: "event", type, created: epoch(at), livemode: false, api_version: "2026-08-26.dahlia", data: { object } };
}
async function deliver(evt) {
  const payload = JSON.stringify(evt);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await routes.webhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header }, body: payload }));
  return { status: res.status, body: await res.json().catch(() => null) };
}

/* ── 1. A declined card, on a database with every migration ──────────────────────────────────── */

const s = await startSupabaseLocal();
const all = splitMigrationsAt(root, "_payment_grace_and_counted_once.sql");
for (const m of [...all.before, ...all.from]) await s.applyMigration(m);

const emails = [];
globalThis.__scrivnTest = { local: s, emails, stripe: fakeStripe, userId: null, email: null };

const owner = await s.createUser({ email: "owner@x.test", fullName: "Owner" });
const org = (await s.sql(`select organization_id from public.organization_members where user_id = $1`, [owner]))[0].organization_id;
await s.sql(`update public.organizations set subscription_tier = 'growth', claims_used_this_period = 12, period_reset_at = '2026-11-01T00:00:00Z', stripe_customer_id = 'cus_A' where id = $1`, [org]);
const orgRow = async () => {
  const r = (await s.sql(`select subscription_tier, payment_failed_at, payment_failed_invoice, claims_used_this_period from public.organizations where id = $1`, [org]))[0];
  return { ...r, payment_failed_at: r.payment_failed_at ? new Date(r.payment_failed_at).toISOString() : null };
};

const T0 = "2026-11-01T09:30:00.000Z";
const plus = (iso, days) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();
{
  // The renewal is declined. Stripe sends the subscription turning past due and the failed invoice,
  // in either order; here the subscription first.
  subscription("sub_A", "cus_A", PRICES.growth, "past_due");
  const pastDue = await deliver(event("customer.subscription.updated", subscriptions.get("sub_A"), plus(T0, 1 / 1440)));
  let row = await orgRow();
  check(pastDue.status === 200 && row.subscription_tier === "growth", `a renewal the card did not pay keeps the plan (got ${pastDue.status}, ${row.subscription_tier})`);
  check(row.payment_failed_at === plus(T0, 1 / 1440), "and starts the grace period at once, in case the invoice event is late");
  check(emails.length === 0, "nobody is emailed by the subscription event alone");

  const failedEvent = event("invoice.payment_failed", invoice("in_1", "cus_A", "sub_A"), T0);
  const failed = await deliver(failedEvent);
  row = await orgRow();
  check(failed.status === 200 && row.payment_failed_at === T0 && row.payment_failed_invoice === "in_1", `the failed invoice is recorded, its earlier time the start of the grace (got ${failed.status}, ${row.payment_failed_at})`);
  check(emails.length === 1 && emails[0].to === "owner@x.test", `the organization's owner is emailed (got ${JSON.stringify(emails.map((e) => e.to))})`);
  const mail = emails[0];
  check(/didn't go through/.test(mail.subject), `in plain words (subject: ${mail.subject})`);
  const html = (await render(mail.react)).replace(/<!-- -->/g, "");
  check(/href="https:\/\/scrivn.ca\/billing"/.test(html) && /Update your card/.test(html) && /Scrivn Growth plan/.test(html) && /\$93.45 CAD/.test(html), "with the plan, the amount and a link to update the card");
  check(/keeps working until November 8, 2026/.test(html), "and the day Scrivn stops if nothing changes, 7 days after the first failure");

  const again = await deliver(failedEvent);
  check(again.status === 200 && emails.length === 1, "Stripe delivering the same event twice sends no second email");
  await deliver(event("invoice.payment_failed", invoice("in_1", "cus_A", "sub_A", { attempt: 2 }), plus(T0, 3)));
  row = await orgRow();
  check(emails.length === 1 && row.payment_failed_at === T0, "nor does Stripe's next try failing, which leaves the grace running from the first failure");

  // Banner, as the owner sees it on day 3.
  globalThis.__scrivnTest.userId = owner;
  globalThis.__scrivnTest.email = "owner@x.test";
  const realNow = Date.now;
  Date.now = () => Date.parse(plus(T0, 3));
  const during = renderToStaticMarkup(await routes.UsageBanner());
  check(/Your last card payment didn’t go through/.test(during) && /keeps working until/.test(during) && /href="\/api\/portal"/.test(during) && !/usage-banner-blocked/.test(during), `on day 3 every page says the card failed, until when it keeps working, and links to update it (got ${during})`);
  Date.now = () => Date.parse(plus(T0, 8));
  const overdue = renderToStaticMarkup(await routes.UsageBanner());
  check(/so generating new documents is paused/.test(overdue) && /usage-banner-blocked/.test(overdue), `on day 8, with the tier still stored, it says generating is paused (got ${overdue})`);
  Date.now = realNow;

  // A week later Stripe sends another subscription change (here: still past due).
  const late = await deliver(event("customer.subscription.updated", subscriptions.get("sub_A"), plus(T0, 8)));
  row = await orgRow();
  check(late.status === 200 && row.subscription_tier === null && row.payment_failed_at === T0, "past the grace, past due takes the plan away as it always did, and the failure stays to say why");

  // The owner updates the card; Stripe takes the payment.
  subscription("sub_A", "cus_A", PRICES.growth, "active", "2026-12-01T00:00:00Z");
  const paid = await deliver(event("invoice.paid", invoice("in_1", "cus_A", "sub_A", { attempt: 3 }), plus(T0, 9)));
  row = await orgRow();
  check(paid.status === 200 && row.payment_failed_at === null && row.payment_failed_invoice === null, "the payment going through clears the failure");
  await deliver(event("customer.subscription.updated", subscriptions.get("sub_A"), plus(T0, 9.0001)));
  row = await orgRow();
  check(row.subscription_tier === "growth", "and the subscription active again gives the plan back");
}
{
  // Out of order: an "active" snapshot from before the card failed arrives after the failure.
  const T1 = "2026-12-01T09:00:00.000Z";
  subscription("sub_A", "cus_A", PRICES.growth, "past_due", "2027-01-01T00:00:00Z");
  await deliver(event("invoice.payment_failed", invoice("in_2", "cus_A", "sub_A"), T1));
  check(emails.length === 2, "a later invoice that fails is news, and the owner hears about it");
  const staleActive = { ...subscriptions.get("sub_A"), status: "active" };
  await deliver(event("customer.subscription.updated", staleActive, plus(T1, -0.04)));
  let row = await orgRow();
  check(row.subscription_tier === "growth" && row.payment_failed_at === T1, "an active snapshot from before the failure, delivered late, does not clear it");
  await deliver(event("customer.subscription.deleted", { ...subscriptions.get("sub_A"), status: "canceled" }, plus(T1, 7.5)));
  row = await orgRow();
  check(row.subscription_tier === null && row.payment_failed_at === null, "Stripe cancelling after its last try ends the plan, and the failure with it");
}
{
  // Someone on a Scrivn plan whose old Scan subscription's invoice fails (checkout cancels it, but a
  // last invoice can still be out there), and invoices that bill no subscription at all.
  await s.sql(`update public.organizations set subscription_tier = 'starter' where id = $1`, [org]);
  subscription("sub_scan", "cus_A", PRICES.scanMonthly, "past_due");
  const before = emails.length;
  await deliver(event("invoice.payment_failed", invoice("in_scan", "cus_A", "sub_scan"), "2027-01-05T00:00:00Z"));
  let row = await orgRow();
  check(row.payment_failed_at === null && emails.length === before, "a Scan invoice failing never touches a Scrivn plan, nor emails about it");
  await deliver(event("invoice.payment_failed", invoice("in_oneoff", "cus_A", null), "2027-01-05T00:00:00Z"));
  row = await orgRow();
  check(row.payment_failed_at === null && emails.length === before, "a one-off invoice is not about a plan");
  const stranger = await deliver(event("invoice.payment_failed", invoice("in_x", "cus_nobody", "sub_A"), "2027-01-05T00:00:00Z"));
  check(stranger.status === 200 && emails.length === before, "a customer this deployment does not know is acknowledged and left alone");
  const forged = await routes.webhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": "t=1,v1=bad" }, body: JSON.stringify(event("invoice.paid", invoice("in_1", "cus_A", "sub_A"), T0)) }));
  check(forged.status === 400, "and an unsigned event is still refused");
}
await s.close();

/* ── 2. The same events on a database without 0013 ──────────────────────────────────────────── */

{
  const old = await startSupabaseLocal();
  for (const m of all.before) await old.applyMigration(m);
  emails.length = 0;
  globalThis.__scrivnTest = { local: old, emails, stripe: fakeStripe, userId: null, email: null };
  const who = await old.createUser({ email: "before@x.test" });
  const theirs = (await old.sql(`select organization_id from public.organization_members where user_id = $1`, [who]))[0].organization_id;
  await old.sql(`update public.organizations set subscription_tier = 'growth', stripe_customer_id = 'cus_B' where id = $1`, [theirs]);
  const tier = async () => (await old.sql(`select subscription_tier from public.organizations where id = $1`, [theirs]))[0].subscription_tier;

  subscription("sub_B", "cus_B", PRICES.growth, "past_due");
  const failed = await deliver(event("invoice.payment_failed", invoice("in_b", "cus_B", "sub_B"), T0));
  check(failed.status === 200 && emails.length === 0, `without 0013 a failed invoice is acknowledged, with no grace to tell anyone about (got ${failed.status})`);
  const pastDue = await deliver(event("customer.subscription.updated", subscriptions.get("sub_B"), T0));
  check(pastDue.status === 200 && (await tier()) === null, "and past due takes the plan away at once, exactly as before 0013");
  subscription("sub_B", "cus_B", PRICES.growth, "active");
  const paid = await deliver(event("invoice.paid", invoice("in_b", "cus_B", "sub_B"), plus(T0, 1)));
  const active = await deliver(event("customer.subscription.updated", subscriptions.get("sub_B"), plus(T0, 1)));
  check(paid.status === 200 && active.status === 200 && (await tier()) === "growth", "the payment and the subscription active again give it back, as before");

  globalThis.__scrivnTest.userId = who;
  const banner = renderToStaticMarkup(await routes.UsageBanner());
  check(!/card payment/.test(banner), "and the banner reads the plan without the failure columns, showing no failure");
  await old.close();
}

/* ── 4. A generation is counted once ──────────────────────────────────────────────────────────── */

let claudeCalls = 0;
/** Claude, answering with a numbered document — or held until `release()`, or failing once. */
let claudeGate = null;
let claudeFails = false;
const claude = async () => {
  claudeCalls += 1;
  const n = claudeCalls;
  if (claudeGate) await claudeGate.promise;
  if (claudeFails) {
    claudeFails = false;
    throw new Error("Claude did not answer");
  }
  return { output: { inspectionReport: `REPORT ${n}`, scopeDocument: `SCOPE ${n}` }, usage: { input_tokens: 1, output_tokens: 1 } };
};
const generationBody = (jobId) => ({ claim: routes.emptyClaimInfo(), extraction: routes.withDerivedFields({ loss: routes.emptyLoss(), rooms: [] }), transcript: "Water in the basement.", ...(jobId ? { jobId } : {}) });
async function generate(jobId) {
  const res = await routes.generate(new Request("http://localhost/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(generationBody(jobId)) }));
  return { status: res.status, body: await res.json() };
}
const J = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

{
  const db = await startSupabaseLocal();
  for (const m of [...all.before, ...all.from]) await db.applyMigration(m);
  const pm = await db.createUser({ email: "pm@x.test", fullName: "Project Manager" });
  const pmOrg = (await db.sql(`select organization_id from public.organization_members where user_id = $1`, [pm]))[0].organization_id;
  await db.sql(`update public.organizations set subscription_tier = 'growth', claims_used_this_period = 73, period_reset_at = '2099-01-01T00:00:00Z' where id = $1`, [pmOrg]);
  const used = async () => (await db.sql(`select claims_used_this_period from public.organizations where id = $1`, [pmOrg]))[0].claims_used_this_period;
  emails.length = 0;
  globalThis.__scrivnTest = { local: db, emails, stripe: fakeStripe, claude, userId: pm, email: "pm@x.test" };

  // The answer to the first send is lost on the way back: the device only knows it did not arrive.
  const first = await generate(J(1));
  check(first.status === 200 && first.body.documents?.scopeDocument === "SCOPE 1" && (await used()) === 74, `a generation runs and counts once (got ${first.status}, ${await used()})`);
  const retry = await generate(J(1));
  check(retry.status === 200 && retry.body.repeated === true && retry.body.documents?.scopeDocument === "SCOPE 1", `sent again under the same id, it gets the same documents back (got ${retry.status}, ${JSON.stringify(retry.body.documents)})`);
  check(claudeCalls === 1 && (await used()) === 74, `without a second Claude call or a second count: a lost answer plus a retry counts once (calls ${claudeCalls}, used ${await used()})`);

  // The last claim: the retry must not be refused for the claim it already used.
  const last = await generate(J(2));
  check(last.status === 200 && (await used()) === 75, "the generation that uses the last claim counts it");
  const lastRetry = await generate(J(2));
  check(lastRetry.status === 200 && lastRetry.body.documents?.scopeDocument === "SCOPE 2" && (await used()) === 75, `its retry still gets its documents at the cap, not a refusal (got ${lastRetry.status})`);
  const over = await generate(J(3));
  const kept = await db.sql(`select count(*)::int as n from public.generation_jobs where id = $1`, [J(3)]);
  check(over.status === 402 && kept[0].n === 0, `a new generation past the cap is refused, and its id given back for when the plan allows it (got ${over.status}, rows ${kept[0].n})`);

  // A retry while the first is still being generated.
  await db.sql(`update public.organizations set claims_used_this_period = 10 where id = $1`, [pmOrg]);
  let release;
  claudeGate = { promise: new Promise((r) => (release = r)) };
  const slow = generate(J(4));
  await new Promise((r) => setTimeout(r, 50));
  const meanwhile = await generate(J(4));
  check(meanwhile.status === 409 && meanwhile.body.running === true, `a retry that arrives while the first is still running is told to wait (got ${meanwhile.status})`);
  claudeGate = null;
  release();
  const slowDone = await slow;
  check(slowDone.status === 200 && (await used()) === 11, "the first finishes and counts once");
  const afterSlow = await generate(J(4));
  check(afterSlow.body.repeated === true && afterSlow.body.documents?.scopeDocument === slowDone.body.documents?.scopeDocument && (await used()) === 11, "and the waiting retry then gets the same documents, uncounted");

  // The first send fails: nothing counted, and the retry runs.
  claudeFails = true;
  const failed = await generate(J(5));
  check(failed.status === 502 && (await used()) === 11, "a generation that fails counts nothing");
  const callsBefore = claudeCalls;
  const recovered = await generate(J(5));
  check(recovered.status === 200 && !recovered.body.repeated && claudeCalls === callsBefore + 1 && (await used()) === 12, "and its retry is generated and counted once");

  // A send that died without finishing (the function was stopped) is taken over after six minutes.
  await db.sql(`insert into public.generation_jobs (user_id, id, organization_id, started_at) values ($1, $2, $3, now() - interval '10 minutes')`, [pm, J(6), pmOrg]);
  const takeover = await generate(J(6));
  check(takeover.status === 200 && !takeover.body.repeated && (await used()) === 13, "an id left running by a send that died is taken over and counted once");

  // Ids are each person's own.
  const other = await db.createUser({ email: "other@x.test" });
  globalThis.__scrivnTest.userId = other;
  globalThis.__scrivnTest.email = "other@x.test";
  const theirs = await generate(J(1));
  check(theirs.status === 200 && !theirs.body.repeated && theirs.body.documents?.scopeDocument !== "SCOPE 1", "someone else sending the same id gets their own generation, never another person's documents");
  globalThis.__scrivnTest.userId = pm;
  globalThis.__scrivnTest.email = "pm@x.test";

  // Without an id (the pipeline harness, an old page): counted every time, as before.
  await generate(null);
  await generate(null);
  check((await used()) === 15, "a generation sent without an id is counted every time, as before");

  for (const call of [`select * from public.generation_job_begin($1, $2, $3)`, `select * from public.generation_job_finish($1, $2, false, '{}'::jsonb)`]) {
    const params = call.includes("begin") ? [J(9), pm, pmOrg] : [J(1), pm];
    const r = await db.as(pm, call, params);
    check(r.error !== null, `a signed-in person cannot call ${call.match(/generation_job_\w+/)[0]} (it would let them count nothing)`);
  }
  const peek = await db.as(pm, `select * from public.generation_jobs`);
  check(peek.error !== null || peek.data.length === 0, "nor read the table");
  await db.close();
}
{
  // A database without 0013, then one without 0011: the id is ignored and every generation counts.
  for (const [label, migrations, read] of [
    ["without 0013", all.before, async (d, org) => (await d.sql(`select claims_used_this_period as n from public.organizations where id = $1`, [org]))[0].n],
    ["before 0011", splitMigrationsAt(root, "_org_billing.sql").before, async (d, _org, who) => (await d.sql(`select claims_used_this_period as n from public.profiles where id = $1`, [who]))[0].n],
  ]) {
    const db = await startSupabaseLocal();
    for (const m of migrations) await db.applyMigration(m);
    const who = await db.createUser({ email: `${label.replace(/\s/g, "")}@x.test` });
    const org = (await db.sql(`select organization_id from public.organization_members where user_id = $1`, [who]))[0].organization_id;
    const table = label === "before 0011" ? "profiles" : "organizations";
    await db.sql(`update public.${table} set subscription_tier = 'starter', claims_used_this_period = 2, period_reset_at = '2099-01-01T00:00:00Z' where id = $1`, [table === "profiles" ? who : org]);
    globalThis.__scrivnTest = { local: db, emails, stripe: fakeStripe, claude, userId: who, email: `${who}@x.test` };
    const a = await generate(J(1));
    const b = await generate(J(1));
    check(a.status === 200 && b.status === 200 && !b.body.repeated && (await read(db, org, who)) === 4, `${label}: a generation sent twice runs and counts twice, exactly as before (got ${a.status}/${b.status}, ${await read(db, org, who)})`);
    await db.close();
  }
}

/* ── 5. Stripe Tax at checkout ────────────────────────────────────────────────────────────────── */

{
  const db = await startSupabaseLocal();
  for (const m of [...all.before, ...all.from]) await db.applyMigration(m);
  const buyer = await db.createUser({ email: "buyer@x.test", fullName: "Buyer" });
  const sessions = [];
  const stripe = {
    ...fakeStripe,
    customers: { create: async () => ({ id: `cus_buyer_${sessions.length}` }) },
    checkout: { sessions: { create: async (params) => (sessions.push(params), { url: "https://checkout.stripe.test/s" }) } },
  };
  globalThis.__scrivnTest = { local: db, emails, stripe, claude, userId: buyer, email: "buyer@x.test" };
  process.env.BILLING_ENABLED = "true";
  const buy = () => routes.checkout(new Request("http://localhost/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier: "starter" }) }));
  for (const [value, on] of [[undefined, false], ["", false], ["yes", false], ["true", true]]) {
    if (value === undefined) delete process.env.STRIPE_AUTOMATIC_TAX;
    else process.env.STRIPE_AUTOMATIC_TAX = value;
    const res = await buy();
    const params = sessions.at(-1);
    const taxed = params?.automatic_tax?.enabled === true && params?.customer_update?.address === "auto";
    check(res.status === 200 && taxed === on && (on || params?.automatic_tax === undefined), `STRIPE_AUTOMATIC_TAX=${JSON.stringify(value)} ${on ? "turns Stripe Tax on, saving the address it taxes on" : "leaves it off"} (got ${res.status}, ${JSON.stringify(params?.automatic_tax)})`);
  }
  delete process.env.STRIPE_AUTOMATIC_TAX;
  delete process.env.BILLING_ENABLED;
  await db.close();
}

cleanup();
delete globalThis.__scrivnTest;

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  billing (routes): ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
