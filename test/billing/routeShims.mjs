/**
 * What test/billing/routes.mjs bundles in place of the modules that reach outside the process:
 * Supabase (the in-memory Postgres, through test/db/supabaseJs.mjs), Stripe's API, Claude and
 * Resend. Everything else in the routes is the real code. Each test sets `globalThis.__scrivnTest`.
 */
import { supabaseJs } from "../db/supabaseJs.mjs";

const t = () => {
  if (!globalThis.__scrivnTest) throw new Error("routeShims: globalThis.__scrivnTest is not set");
  return globalThis.__scrivnTest;
};

/* lib/supabase/admin */
export function createAdminClient() {
  return supabaseJs(t().local, { role: "service_role" });
}

/* lib/supabase/server — the signed-in person's own session. */
export async function createClient() {
  const { local, userId, email } = t();
  return supabaseJs(local, { userId, email });
}

/* lib/email/send */
export const SENDING_DOMAIN = "scrivn.ca";
export function isEmailConfigured() {
  return true;
}
export async function sendEmail(params) {
  t().emails.push(params);
  return { ok: true };
}

/* lib/stripe/server — only what the routes call. */
export function getStripe() {
  return t().stripe;
}
export function isStripeConfigured() {
  return true;
}

/* next/server — Next's own needs its build; the routes only answer JSON and redirects. */
export const NextResponse = {
  json: (body, init) => Response.json(body, typeof init === "number" ? { status: init } : init),
  redirect: (url, init) => Response.redirect(String(url), typeof init === "number" ? init : (init?.status ?? 307)),
};

/* lib/anthropic */
export const GENERATION_MAX_TOKENS = 32000;
export class ScopingApiError extends Error {}
export async function createStructuredMessage(params) {
  return t().claude(params);
}
