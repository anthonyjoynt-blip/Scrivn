/**
 * Going live with Stripe, as one command (STRIPE.md, "Go-live day").
 *
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-go-live.mjs --live
 *
 * With a LIVE secret key in the environment it:
 *
 *   1. makes the four products, Scrivn Starter, Growth and Unlimited and Scrivn Scan, with their five
 *      CAD prices: the amounts in lib/plans.ts (what the pricing page shows), tax code
 *      txcd_10103001 (SaaS) and tax behaviour exclusive, as in the sandbox;
 *   2. checks what it cannot set itself: Stripe Tax active with a registration, and the account's
 *      currency;
 *   3. prints the webhook endpoint to register with its events, and the lines to paste into Vercel.
 *
 * Safe to run again. Every price carries a lookup key, and a product or price that already exists
 * (found by its lookup key, or by name and amount if it was made by hand in the Dashboard) is reused
 * and never duplicated.
 *
 * It refuses a live key without --live. With no key in the environment it reads .env.local, which
 * holds the sandbox key: that is how it is tried before the day. It never prints a key.
 *
 *   --url https://scrivn.ca   the site the webhook endpoint is for (default https://scrivn.ca)
 *   --prefix NAME             sandbox only: makes "NAME Scrivn Starter" and so on with their own
 *                             lookup keys, to try the creating half without touching the real ones
 */
import Stripe from "stripe";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function env(name) {
  if (process.env[name]) return process.env[name].replace(/^﻿/, "").trim();
  try {
    for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line.replace(/^﻿/, ""));
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").replace(/﻿/g, "").trim();
    }
  } catch {
    /* no .env.local: the environment is all there is */
  }
  return "";
}

const key = env("STRIPE_SECRET_KEY");
if (!key) {
  console.error("Set STRIPE_SECRET_KEY to the live secret key (Dashboard, live mode: Developers, API keys).");
  process.exit(1);
}
const live = /^(sk|rk)_live_/.test(key);
if (live && !flag("--live")) {
  console.error("STRIPE_SECRET_KEY is a LIVE key. Run again with --live if that is what you mean.");
  process.exit(1);
}
const prefix = option("--prefix") ?? "";
if (live && prefix) {
  console.error("--prefix is for trying the script in the sandbox, never with a live key.");
  process.exit(1);
}
const siteUrl = (option("--url") ?? "https://scrivn.ca").replace(/\/+$/, "");

/* ── What to sell, from the app's own source ──────────────────────────────────────────────────── */

// lib/plans.ts sets what the pricing page says; reading it here means the page and the charge
// cannot disagree. lib/billingTiers.ts lists the events the webhook acts on.
const bundled = await build({
  stdin: { contents: `export { PLANS, SCAN_PLAN } from "./lib/plans"; export { WEBHOOK_EVENTS } from "./lib/billingTiers";`, resolveDir: root, loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "error",
});
const { PLANS, SCAN_PLAN, WEBHOOK_EVENTS } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

/** "$39" → 3900. */
function cents(label) {
  const amount = Number(String(label).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`cannot read a price from ${JSON.stringify(label)} in lib/plans.ts`);
  return Math.round(amount * 100);
}

const TAX_CODE = "txcd_10103001";
const named = (name) => (prefix ? `${prefix} ${name}` : name);
const lookup = (k) => (prefix ? `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${k}` : k);

const PRODUCTS = [
  ...PLANS.map((plan) => ({
    plan: plan.tier,
    name: named(`Scrivn ${plan.name}`),
    description: `Scrivn, ${plan.claimLimit} claims a month.`,
    prices: [{ lookup_key: lookup(`scrivn_${plan.tier}_monthly`), nickname: `${plan.name} monthly`, unit_amount: cents(plan.priceLabel), interval: "month", env: `STRIPE_PRICE_${plan.tier.toUpperCase()}` }],
  })),
  {
    plan: "scan",
    name: named(SCAN_PLAN.name),
    description: "Measured floor plans from your phone: unlimited scans.",
    prices: [
      { lookup_key: lookup("scan_monthly"), nickname: "Scan monthly", unit_amount: cents(SCAN_PLAN.monthlyLabel), interval: "month", env: "STRIPE_PRICE_SCAN_MONTHLY" },
      { lookup_key: lookup("scan_yearly"), nickname: "Scan yearly", unit_amount: cents(SCAN_PLAN.yearlyLabel), interval: "year", env: "STRIPE_PRICE_SCAN_YEARLY" },
    ],
  },
];

/* ── Make them ────────────────────────────────────────────────────────────────────────────────── */

const stripe = new Stripe(key);
const account = await stripe.accounts.retrieveCurrent();
console.log(`\n${live ? "LIVE" : "Sandbox (test)"} mode, account ${account.id}${account.settings?.dashboard?.display_name ? ` (${account.settings.dashboard.display_name})` : ""}.\n`);

const warnings = [];
const money = (p) => `$${(p.unit_amount / 100).toFixed(2)} ${p.currency.toUpperCase()} / ${p.recurring?.interval}`;

const activeProducts = [];
for await (const p of stripe.products.list({ active: true, limit: 100 })) activeProducts.push(p);
const trialRun = (p) => p.metadata?.scrivn_trial_run ?? "";
/** "Scrivn — Starter", "Scrivn - Starter" and "Scrivn Starter" are one name: hand-made ones vary. */
const sameName = (a, b) => {
  const plain = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return plain(a) === plain(b);
};

const envLines = [];
for (const spec of PRODUCTS) {
  // The product: by its plan, or by the name if it was made by hand.
  let product =
    activeProducts.find((p) => p.metadata?.scrivn_plan === spec.plan && trialRun(p) === prefix) ??
    activeProducts.find((p) => sameName(p.name, spec.name) && (!p.metadata?.scrivn_plan || p.metadata.scrivn_plan === spec.plan) && trialRun(p) === prefix);
  if (!product) {
    product = await stripe.products.create({
      name: spec.name,
      description: spec.description,
      tax_code: TAX_CODE,
      metadata: { scrivn_plan: spec.plan, ...(prefix ? { scrivn_trial_run: prefix } : {}) },
    });
    console.log(`  created product ${product.name} (${product.id})`);
  } else {
    console.log(`  reusing product ${product.name} (${product.id})`);
    const taxCode = typeof product.tax_code === "string" ? product.tax_code : product.tax_code?.id;
    const fixes = {};
    if (taxCode !== TAX_CODE) fixes.tax_code = TAX_CODE;
    if (product.metadata?.scrivn_plan !== spec.plan) fixes.metadata = { scrivn_plan: spec.plan };
    if (Object.keys(fixes).length) {
      product = await stripe.products.update(product.id, fixes);
      console.log(`    set ${Object.keys(fixes).join(" and ")}${fixes.tax_code ? ` (tax code was ${taxCode ?? "none"})` : ""}`);
    }
  }

  for (const want of spec.prices) {
    let price = (await stripe.prices.list({ lookup_keys: [want.lookup_key], active: true, limit: 1 })).data[0];
    let how = "reusing";
    if (price && (typeof price.product === "string" ? price.product : price.product.id) !== product.id) {
      warnings.push(`${want.nickname}: the lookup key ${want.lookup_key} belongs to a price on another product (${price.id}). Check the Dashboard before going on.`);
    }
    if (!price) {
      // Made by hand: the same amount and interval in CAD on this product. Given the lookup key so
      // the next run finds it directly, taking it from any archived price that still holds it.
      const existing = (await stripe.prices.list({ product: product.id, active: true, currency: "cad", type: "recurring", limit: 100 })).data.find(
        (p) => p.unit_amount === want.unit_amount && p.recurring?.interval === want.interval && p.recurring?.interval_count === 1,
      );
      if (existing) {
        price = await stripe.prices.update(existing.id, { lookup_key: want.lookup_key, transfer_lookup_key: true, ...(existing.nickname ? {} : { nickname: want.nickname }) });
        how = "adopted";
      } else {
        price = await stripe.prices.create({
          product: product.id,
          currency: "cad",
          unit_amount: want.unit_amount,
          recurring: { interval: want.interval },
          lookup_key: want.lookup_key,
          nickname: want.nickname,
          tax_behavior: "exclusive",
        });
        how = "created";
      }
    }
    if (price.tax_behavior === "unspecified") {
      price = await stripe.prices.update(price.id, { tax_behavior: "exclusive" });
      console.log(`    set ${want.nickname} to tax behaviour exclusive`);
    } else if (price.tax_behavior !== "exclusive") {
      warnings.push(`${want.nickname} (${price.id}) is tax-${price.tax_behavior}, not exclusive, and Stripe cannot change that: archive it and run this again to make a new one.`);
    }
    if (price.currency !== "cad" || price.unit_amount !== want.unit_amount || price.recurring?.interval !== want.interval || !price.active) {
      warnings.push(`${want.nickname} (${price.id}) is ${money(price)}${price.active ? "" : ", archived"}, but lib/plans.ts sells it at $${(want.unit_amount / 100).toFixed(2)} CAD / ${want.interval}. A price's amount cannot change: archive it, and run this again.`);
    }
    console.log(`    ${how} ${want.nickname}: ${price.id} (${money(price)})`);
    envLines.push(`${want.env}=${price.id}`);
  }
}

/* ── What it cannot set ───────────────────────────────────────────────────────────────────────── */

const checks = [];
async function checkThat(label, run) {
  try {
    checks.push(await run());
  } catch (err) {
    checks.push({ ok: false, text: `${label}: could not check (${err instanceof Error ? err.message : err})` });
  }
}
await checkThat("Stripe Tax", async () => {
  const settings = await stripe.tax.settings.retrieve();
  const registrations = (await stripe.tax.registrations.list({ status: "active", limit: 100 })).data;
  const where = registrations.map((r) => [r.country, r.country_options?.[r.country.toLowerCase()]?.province].filter(Boolean).join("-")).join(", ");
  const ok = settings.status === "active" && registrations.length > 0;
  return {
    ok,
    text: ok
      ? `Stripe Tax is active, registered in ${where}. Set STRIPE_AUTOMATIC_TAX=true.`
      : `Stripe Tax is ${settings.status} with ${registrations.length} registration(s). Leave STRIPE_AUTOMATIC_TAX unset until the accountant has answered and Dashboard, Tax shows it active with a registration: with it on before then, checkout refuses to open, and with it off no tax is collected (STRIPE.md, Known gaps).`,
  };
});
await checkThat("Currency", async () => ({
  ok: true,
  text: `The account's default currency is ${(account.default_currency ?? "unknown").toUpperCase()}; Scrivn's prices are CAD whatever it is.`,
}));

console.log("\nChecks");
for (const c of checks) console.log(`  ${c.ok ? "ok " : "!! "} ${c.text}`);
for (const w of warnings) console.log(`  !!  ${w}`);

/* ── What to do with it ───────────────────────────────────────────────────────────────────────── */

console.log(`
1. Register the webhook. Dashboard${live ? " (live mode)" : ""}, Developers, Webhooks, Add endpoint:
     URL          ${siteUrl}/api/webhooks/stripe
     API version  ${Stripe.API_VERSION}
     Events       ${WEBHOOK_EVENTS.join("\n                  ")}
   Then reveal its signing secret (whsec_...) for step 2.

2. Paste into Vercel, Production environment, then redeploy:
     STRIPE_SECRET_KEY=<the ${live ? "live " : ""}secret key you ran this with>
     NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<${live ? "pk_live_" : "pk_test_"}... from Developers, API keys>
     STRIPE_WEBHOOK_SECRET=<the signing secret from step 1>
${envLines.map((l) => `     ${l}`).join("\n")}
     STRIPE_AUTOMATIC_TAX=true   <- only if the Stripe Tax check above is ok
     BILLING_ENABLED=true

3. Dashboard, Billing, Revenue recovery, Retries: Smart Retries within 1 week, then cancel the
   subscription. Scrivn's grace period is 7 days to match (PAYMENT_GRACE_DAYS, STRIPE.md section 7).
`);
if (!live) console.log("This was the sandbox. Nothing live was touched.\n");
