/**
 * Creates Scrivn Scan's own plan in Stripe — one product, two prices — and prints the two
 * `.env.local` lines that point the app at them (STRIPE.md, section 3b).
 *
 *   node scripts/stripe-scan-plan.mjs          in the account STRIPE_SECRET_KEY points at (test)
 *   node scripts/stripe-scan-plan.mjs --live   the same against a live key, on purpose
 *
 * Safe to run again: the prices carry lookup keys (scan_monthly, scan_yearly), and whatever already
 * exists is reused rather than duplicated. The amounts are SCAN_PLAN's in lib/plans.ts, in cents.
 * Reads the key from the environment or .env.local and never prints it.
 */
import Stripe from "stripe";
import { readFileSync } from "node:fs";

function env(name) {
  if (process.env[name]) return process.env[name].replace(/^﻿/, "").trim();
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line.replace(/^﻿/, ""));
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").replace(/﻿/g, "").trim();
  }
  throw new Error(`${name} is not in .env.local`);
}

const PRODUCT = {
  name: "Scrivn Scan",
  description: "Measured floor plans from your phone: unlimited scans.",
  // The same SaaS tax code as the three Scrivn products (STRIPE.md, Known gaps).
  tax_code: "txcd_10103001",
  metadata: { scrivn_plan: "scan" },
};

const PRICES = [
  { lookup_key: "scan_monthly", nickname: "Scan monthly", unit_amount: 1900, interval: "month", env: "STRIPE_PRICE_SCAN_MONTHLY" },
  { lookup_key: "scan_yearly", nickname: "Scan yearly", unit_amount: 19000, interval: "year", env: "STRIPE_PRICE_SCAN_YEARLY" },
];

const key = env("STRIPE_SECRET_KEY");
const live = /^(sk|rk)_live_/.test(key);
if (live && !process.argv.includes("--live")) {
  console.error("STRIPE_SECRET_KEY is a LIVE key. Run again with --live if that is what you mean.");
  process.exit(1);
}
const stripe = new Stripe(key);

const existing = await stripe.prices.list({ lookup_keys: PRICES.map((p) => p.lookup_key), limit: 10 });
const byKey = new Map(existing.data.map((p) => [p.lookup_key, p]));

let productId = existing.data.find((p) => p.active)?.product;
if (typeof productId === "object" && productId) productId = productId.id;
if (!productId) {
  const product = await stripe.products.create(PRODUCT);
  productId = product.id;
  console.log(`created product ${product.name} (${productId})`);
} else {
  console.log(`reusing product ${productId}`);
}

const lines = [];
for (const p of PRICES) {
  let price = byKey.get(p.lookup_key);
  if (price) {
    console.log(`reusing ${p.nickname}: ${price.id} (${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()} / ${price.recurring?.interval})`);
  } else {
    price = await stripe.prices.create({
      product: productId,
      currency: "cad",
      unit_amount: p.unit_amount,
      recurring: { interval: p.interval },
      lookup_key: p.lookup_key,
      nickname: p.nickname,
      tax_behavior: "exclusive",
    });
    console.log(`created ${p.nickname}: ${price.id} (${(p.unit_amount / 100).toFixed(2)} CAD / ${p.interval})`);
  }
  lines.push(`${p.env}=${price.id}`);
}

console.log(`\n${live ? "LIVE" : "test"} mode. For .env.local (and Vercel):\n${lines.join("\n")}`);
