/**
 * A declined card, end to end against Stripe's TEST mode (2026-10-14).
 *
 *   npm run test:billing:stripe
 *
 * Needs the Stripe CLI logged in to the same test account as STRIPE_SECRET_KEY in .env.local, and
 * refuses a live key. Takes a minute or two: Stripe's test clock has to move a month on.
 *
 * The real webhook (app/api/webhooks/stripe/route.ts) runs on a local port, bundled as in
 * test/billing/routes.mjs: Supabase is the in-memory Postgres with every migration, and Resend a
 * recorder. Stripe is real: `stripe listen` forwards its events, signed, and the webhook calls
 * Stripe's API. So this checks what the offline tests cannot — the events Stripe actually sends for
 * a declined renewal, in its own order and shape.
 *
 *   1. A customer on a test clock subscribes to Starter with a good card.
 *   2. The card is swapped for one that is always declined, and the clock moves past the renewal.
 *   3. The renewal fails: the plan must stay, the failure be recorded, the owner emailed once.
 *   4. A good card goes back on and the invoice is paid: everything must clear.
 *
 * Everything made in Stripe hangs off the test clock, and deleting the clock at the end deletes it.
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { migrationFiles, startSupabaseLocal } from "../db/supabaseLocal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

/** A value from the environment or .env.local, never printed. */
function env(name) {
  if (process.env[name]) return process.env[name].replace(/^﻿/, "").trim();
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line.replace(/^﻿/, ""));
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").replace(/﻿/g, "").trim();
  }
  return "";
}

const key = env("STRIPE_SECRET_KEY");
if (!/^sk_test_/.test(key)) {
  console.error("STRIPE_SECRET_KEY is not a test key. This runs against Stripe's test mode only.");
  process.exit(1);
}
const starterPrice = env("STRIPE_PRICE_STARTER");
if (!starterPrice) {
  console.error("STRIPE_PRICE_STARTER is not set (STRIPE.md §3).");
  process.exit(1);
}
const stripe = new Stripe(key);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${message}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, test, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/* ── The webhook, on a local port ─────────────────────────────────────────────────────────────── */

const secret = execFileSync("stripe", ["listen", "--print-secret"], { encoding: "utf8" }).trim();
Object.assign(process.env, {
  STRIPE_WEBHOOK_SECRET: secret,
  STRIPE_PRICE_STARTER: starterPrice,
  STRIPE_PRICE_GROWTH: env("STRIPE_PRICE_GROWTH"),
  STRIPE_PRICE_UNLIMITED: env("STRIPE_PRICE_UNLIMITED"),
  STRIPE_PRICE_SCAN_MONTHLY: env("STRIPE_PRICE_SCAN_MONTHLY"),
  STRIPE_PRICE_SCAN_YEARLY: env("STRIPE_PRICE_SCAN_YEARLY"),
  NEXT_PUBLIC_APP_URL: "https://scrivn.ca",
});

const { bundleRoutes } = await import("./bundleRoutes.mjs");
const { mod: routes, cleanup } = await bundleRoutes(`export { POST as webhook } from "@/app/api/webhooks/stripe/route";`, "stripe-e2e");

const s = await startSupabaseLocal();
for (const m of migrationFiles(root)) await s.applyMigration(m);
const emails = [];
const seen = [];
globalThis.__scrivnTest = { local: s, emails, stripe, userId: null, email: null };

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed = JSON.parse(body);
    seen.push(`${parsed.type} (${parsed.api_version})`);
  } catch {
    /* the route reports a body it cannot read */
  }
  const answer = await routes.webhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": req.headers["stripe-signature"] ?? "" }, body }));
  res.writeHead(answer.status, { "content-type": "application/json" });
  res.end(await answer.text());
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const EVENTS = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed", "invoice.paid"];
const listener = spawn("stripe", ["listen", "--forward-to", `http://127.0.0.1:${port}/api/webhooks/stripe`, "--events", EVENTS.join(",")], { stdio: ["ignore", "pipe", "pipe"] });
let listenerLog = "";
listener.stdout.on("data", (d) => (listenerLog += d));
listener.stderr.on("data", (d) => (listenerLog += d));
await until("stripe listen to be ready", () => /Ready!/.test(listenerLog), 30_000);

/* ── The run ──────────────────────────────────────────────────────────────────────────────────── */

let clock = null;
try {
  const owner = await s.createUser({ email: "e2e-owner@x.test", fullName: "E2E Owner" });
  const org = (await s.sql(`select organization_id from public.organization_members where user_id = $1`, [owner]))[0].organization_id;
  const row = async () => {
    const r = (await s.sql(`select subscription_tier, payment_failed_at, payment_failed_invoice from public.organizations where id = $1`, [org]))[0];
    return { ...r, payment_failed_at: r.payment_failed_at ? new Date(r.payment_failed_at).toISOString() : null };
  };

  clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: "scrivn billing e2e" });
  const customer = await stripe.customers.create({ email: "e2e-owner@x.test", name: "Scrivn e2e", test_clock: clock.id, metadata: { organization_id: org } });
  const good = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: good.id } });
  // What checkout.session.completed would have stored: the plan and the customer.
  await s.sql(`update public.organizations set subscription_tier = 'starter', stripe_customer_id = $2 where id = $1`, [org, customer.id]);

  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: starterPrice }] });
  check(sub.status === "active", `a Starter subscription on a good card is active (got ${sub.status})`);

  // From now on every charge is declined (Stripe's test card 4000 0000 0000 0341).
  const bad = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: bad.id } });

  const periodEnd = sub.items.data[0].current_period_end;
  console.log("  … moving the test clock past the renewal");
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: periodEnd + 2 * 3600 });
  await until("the test clock", async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status === "ready", 180_000);

  const failed = await until("the failure to reach the webhook", async () => {
    const r = await row();
    return r.payment_failed_invoice ? r : null;
  });
  const renewal = await stripe.subscriptions.retrieve(sub.id);
  check(renewal.status === "past_due", `Stripe marks the renewal past due (got ${renewal.status})`);
  check(failed.subscription_tier === "starter", `the plan is kept through the grace period (got ${failed.subscription_tier})`);
  check(failed.payment_failed_at !== null && failed.payment_failed_invoice === renewal.latest_invoice, "the failure is recorded against the renewal invoice");
  await sleep(3000);
  check(emails.length === 1 && emails[0].to === "e2e-owner@x.test" && /didn't go through/.test(emails[0].subject), `the owner is emailed once (got ${emails.length}: ${JSON.stringify(emails.map((e) => e.to))})`);

  // The owner updates the card in the portal; Stripe takes the payment.
  const fixed = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: fixed.id } });
  const paid = await stripe.invoices.pay(String(renewal.latest_invoice), { payment_method: fixed.id });
  check(paid.status === "paid", `the invoice is paid with the new card (got ${paid.status})`);
  const cleared = await until("the payment to reach the webhook", async () => {
    const r = await row();
    return r.payment_failed_at === null ? r : null;
  });
  check(cleared.payment_failed_invoice === null && cleared.subscription_tier === "starter", "the payment clears the failure and the plan stays");
  await sleep(3000);
  check((await row()).subscription_tier === "starter" && (await stripe.subscriptions.retrieve(sub.id)).status === "active", "and the subscription is active again");
  check(emails.length === 1, "with no further email");
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
  console.error(err);
} finally {
  if (clock) await stripe.testHelpers.testClocks.del(clock.id).catch((err) => console.error("could not delete the test clock:", err.message));
  listener.kill();
  server.close();
  await s.close();
  cleanup();
}

console.log(`\n  events the webhook received: ${[...new Set(seen)].join(", ")}`);
for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  billing (Stripe test mode): ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
