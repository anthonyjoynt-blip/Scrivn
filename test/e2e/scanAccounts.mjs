/**
 * Scrivn Scan standing on its own, end to end: the real routes of a running dev server, over the
 * local Supabase stand-in (test/e2e/fakeSupabase.mjs) with every migration applied. Plays the phone
 * exactly as ScrivnApi.kt does (the same paths, bodies and bearer token) and a browser by its cookies.
 *
 *   1. node test/e2e/fakeSupabase.mjs --write-env .env.development.local     (leave it running)
 *   2. a dev server on 3005 with, besides that file:
 *        NEXT_PUBLIC_SIGNUPS_OPEN=true SCAN_FREE_TIER=on SIGNUP_LIMIT_PER_IP_PER_DAY=3
 *      (put them in the same .env.development.local; RESEND_API_KEY empty, so no email leaves)
 *   3. npm run test:e2e:scan            (SCRIVN_BASE_URL and FAKE_SUPABASE_URL to point elsewhere)
 *
 * Delete .env.development.local afterwards.
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const BASE = process.env.SCRIVN_BASE_URL ?? "http://127.0.0.1:3005";
const FAKE = process.env.FAKE_SUPABASE_URL ?? "http://127.0.0.1:54329";

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${message}`);
  } else {
    failures.push(message);
    console.log(`  FAIL ${message}`);
  }
}

/** A tiny cookie jar, enough for Supabase's auth cookies. */
class Jar {
  constructor() {
    this.cookies = new Map();
  }
  take(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0/i.test(line) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function call(method, path, { body, token, jar, ip, redirect = "manual" } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
  if (token) headers.authorization = `Bearer ${token}`;
  if (jar?.cookies.size) headers.cookie = jar.header();
  if (ip) headers["x-forwarded-for"] = ip;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect });
  jar?.take(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* a page */
  }
  return { status: res.status, json, text, location: res.headers.get("location") };
}

async function sql(text, params = []) {
  const res = await fetch(`${FAKE}/__test/sql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: text, params }) });
  const out = await res.json();
  if (!res.ok) throw new Error(`sql failed: ${out.message}`);
  return out;
}

async function lastLink(email) {
  const res = await fetch(`${FAKE}/__test/links?email=${encodeURIComponent(email)}`);
  const all = await res.json();
  return all[all.length - 1] ?? null;
}

/** Sign up through the phone's door, confirm through the emailed link, and keep the browser's cookies. */
async function signUpAndConfirm(email, password, fullName, ip) {
  const made = await call("POST", "/api/device/signup", { body: { email, password, fullName }, ip });
  const link = await lastLink(email);
  const jar = new Jar();
  const confirmed = link ? await call("GET", `/auth/confirm?next=%2Fscan%2Fready&token_hash=${link.hashed_token}&type=email`, { jar }) : null;
  return { made, link, confirmed, jar };
}

const capture = JSON.parse(readFileSync(join(root, "test", "sketch", "fixtures", "scan-taps-office.json"), "utf8"));
const run = randomUUID().slice(0, 8);
const password = "correct horse battery";

console.log(`Scrivn at ${BASE}, Supabase stand-in at ${FAKE}`);

/* ── The gate and the form ───────────────────────────────────────────────────────────────────── */

const open = await call("GET", "/api/device/signup");
check(open.status === 200 && open.json?.open === true, `the phone asks whether sign-up is open: ${JSON.stringify(open.json)}`);

const badSignup = await call("POST", "/api/device/signup", { body: { email: "not-an-email", password, fullName: "X" }, ip: "203.0.113.50" });
check(badSignup.status === 400 && /email/i.test(badSignup.json?.error ?? ""), `a bad email is refused with a sentence: ${badSignup.json?.error}`);

/* ── sa-signin: make an account in the app, confirm it, sign in ─────────────────────────────── */

const email = `scan-e2e-${run}@example.test`;
const { made, link, confirmed } = await signUpAndConfirm(email, password, "Sam Scanner", "203.0.113.10");
check(made.status === 200 && made.json?.ok === true, `Create an account answers ok (${made.status})`);
check(link?.kind === "confirmation", "a confirmation link was made for the address");

const early = await call("POST", "/api/device/signin", { body: { email, password, deviceName: "E2E Phone" }, ip: "203.0.113.10" });
// (This one ran after the confirm above, so it should succeed; the not-confirmed path is checked with a second account below.)
check(confirmed?.status === 307 && /\/scan\/ready$/.test(confirmed.location ?? ""), `the emailed link confirms and lands on /scan/ready (${confirmed?.status} → ${confirmed?.location})`);

const unconfirmedEmail = `scan-e2e-unconfirmed-${run}@example.test`;
await call("POST", "/api/device/signup", { body: { email: unconfirmedEmail, password, fullName: "Not Yet" }, ip: "203.0.113.11" });
const notYet = await call("POST", "/api/device/signin", { body: { email: unconfirmedEmail, password }, ip: "203.0.113.11" });
check(notYet.status === 403 && /confirm your email/i.test(notYet.json?.error ?? ""), `an unconfirmed account is told to confirm first: ${notYet.json?.error}`);

const wrong = await call("POST", "/api/device/signin", { body: { email, password: "nope nope nope" }, ip: "203.0.113.10" });
check(wrong.status === 400 && /don't match/.test(wrong.json?.error ?? ""), `a wrong password: ${wrong.json?.error}`);

check(early.status === 200 && typeof early.json?.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(early.json.token), `signed in: a device token like pairing's (${early.status})`);
const token = early.json?.token;
check(early.json?.email === email && early.json?.user?.name === "Sam Scanner" && early.json?.organization?.name === "Sam Scanner", `the phone learns who it is: ${JSON.stringify({ email: early.json?.email, user: early.json?.user?.name, org: early.json?.organization?.name })}`);
check(early.json?.allowance?.limit === 3 && early.json?.allowance?.used === 0 && early.json?.allowance?.enforced === true, `free plan, 0 of 3: ${early.json?.allowance?.summary}`);

const me = await call("GET", "/api/device/me", { token });
check(me.status === 200 && me.json?.email === email && me.json?.allowance?.summary?.startsWith("Free plan: 0 of 3"), `/api/device/me: ${me.json?.allowance?.summary}`);

const orgId = early.json?.organization?.id;
const phones = await sql("select name, revoked_at from public.device_tokens where organization_id = $1", [orgId]);
check(phones.length === 1 && phones[0].name === "E2E Phone" && phones[0].revoked_at === null, "the signed-in phone is a device token on the account, as a paired one is");

/* ── sa-free: three scans a month, counted on the server ─────────────────────────────────────── */

const c = (n) => `cap-${run}-${n}`;
const use1 = await call("POST", "/api/device/scans/use", { token, body: { captureId: c(1) } });
check(use1.status === 200 && use1.json?.counted === true && use1.json?.allowance?.used === 1, `Share counts a capture: ${use1.json?.allowance?.summary}`);
const use1again = await call("POST", "/api/device/scans/use", { token, body: { captureId: c(1) } });
check(use1again.status === 200 && use1again.json?.counted === false && use1again.json?.allowance?.used === 1, "sharing the same capture again costs nothing");

const send2 = await call("POST", "/api/device/scans", { token, body: { claimId: null, capture, captureId: c(2), capturedAt: new Date().toISOString(), level: 0 } });
check(send2.status === 200 && send2.json?.created === true && send2.json?.allowance?.used === 2, `Send counts a capture and makes a claim (${send2.status}, ${send2.json?.allowance?.summary ?? send2.json?.error})`);
const claimId = send2.json?.id;
const send2again = await call("POST", "/api/device/scans", { token, body: { claimId: null, capture, captureId: c(2), capturedAt: new Date().toISOString(), level: 0 } });
check(send2again.status === 200 && send2again.json?.duplicate === true && send2again.json?.allowance?.used === 2, "sending it again is the same claim and no second scan");

const use3 = await call("POST", "/api/device/scans/use", { token, body: { captureId: c(3) } });
check(use3.status === 200 && use3.json?.allowance?.used === 3, `the third: ${use3.json?.allowance?.summary}`);

const use4 = await call("POST", "/api/device/scans/use", { token, body: { captureId: c(4) } });
check(use4.status === 402, `the fourth Share is refused (${use4.status})`);
check(/scrivn\.ca\/scan/.test(use4.json?.error ?? "") && !/https?:\/\//.test(use4.json?.error ?? ""), `naming scrivn.ca/scan in plain text: "${use4.json?.error}"`);
const send5 = await call("POST", "/api/device/scans", { token, body: { claimId, capture, captureId: c(5), capturedAt: new Date().toISOString(), level: 0 } });
check(send5.status === 402 && send5.json?.allowance?.used === 3, `the fourth Send is refused too (${send5.status})`);
const pendingIn = await sql("select count(*)::int as n from public.claim_scans where claim_id = $1 and capture_id = $2", [claimId, c(5)]);
check(pendingIn[0].n === 0, "and nothing of it was stored");
const resendOld = await call("POST", "/api/device/scans/use", { token, body: { captureId: c(2) } });
check(resendOld.status === 200, "a capture already counted still goes after the limit");

await sql("update public.organizations set subscription_tier = 'scan' where id = $1", [orgId]);
const onPlan = await call("POST", "/api/device/scans/use", { token, body: { captureId: c(6) } });
check(onPlan.status === 200 && onPlan.json?.allowance?.unlimited === true && onPlan.json?.allowance?.summary === "Scrivn Scan plan: unlimited scans.", `the Scan plan: ${onPlan.json?.allowance?.summary}`);
await sql("update public.organizations set subscription_tier = null where id = $1", [orgId]);

/* ── b-guard: new accounts per address, sign-ins ─────────────────────────────────────────────── */

const flood = [];
for (let i = 0; i < 4; i++) {
  flood.push(await call("POST", "/api/device/signup", { body: { email: `flood-${run}-${i}@example.test`, password, fullName: "Flood" }, ip: "198.51.100.77" }));
}
check(flood.slice(0, 3).every((r) => r.status === 200) && flood[3].status === 429, `three new accounts from one address, the fourth refused (${flood.map((r) => r.status)})`);
check(/Too many new accounts/.test(flood[3].json?.error ?? ""), `with a sentence: ${flood[3].json?.error}`);
const elsewhere = await call("POST", "/api/device/signup", { body: { email: `other-${run}@example.test`, password, fullName: "Other" }, ip: "198.51.100.78" });
check(elsewhere.status === 200, "another address is not held back");

const guesses = [];
for (let i = 0; i < 11; i++) guesses.push(await call("POST", "/api/device/signin", { body: { email: `guess-${run}@example.test`, password: `guess ${i}` }, ip: `192.0.2.${i}` }));
check(guesses.slice(0, 10).every((r) => r.status === 400) && guesses[10].status === 429, `sign-ins to one email: ten, then 429 (${guesses.map((r) => r.status).join(",")})`);

/* ── Scrivn shows where a signed-in phone's scans go ─────────────────────────────────────────── */

const webJar = new Jar();
const browserSession = await fetch(`${FAKE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: "x" },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
check(typeof browserSession.access_token === "string", "the same email and password sign in to the website");
const claimRow = await sql("select created_by, organization_id from public.claims where id = $1", [claimId]);
check(claimRow[0]?.organization_id === orgId, "the scan's claim is in the signed-in account's organization, where the claims list shows it");

/* ── Sign out from the phone revokes its token on Scrivn ─────────────────────────────────────── */

const second = await call("POST", "/api/device/signin", { body: { email, password, deviceName: "Second Phone" }, ip: "203.0.113.10" });
const out = await call("POST", "/api/device/signout", { token: second.json?.token });
const outMe = await call("GET", "/api/device/me", { token: second.json?.token });
const stillMe = await call("GET", "/api/device/me", { token });
check(second.status === 200 && out.status === 200 && outMe.status === 401 && stillMe.status === 200, `Sign out revokes that phone's token, not the other's (${second.status}, ${out.status}, ${outMe.status}, ${stillMe.status})`);

/* ── sa-delete, from the phone ───────────────────────────────────────────────────────────────── */

const delWrong = await call("POST", "/api/device/account/delete", { token, body: { password: "not it at all" }, ip: "203.0.113.10" });
check(delWrong.status === 400, `deleting needs the password (${delWrong.status}: ${delWrong.json?.error})`);
const userId = early.json?.user?.id;
const del = await call("POST", "/api/device/account/delete", { token, body: { password }, ip: "203.0.113.10" });
check(del.status === 200 && del.json?.deleted === true && del.json?.organizationsDeleted === 1, `Delete account from the phone (${del.status}: ${JSON.stringify(del.json)})`);
const after = await call("GET", "/api/device/me", { token });
check(after.status === 401, `the phone's token no longer works (${after.status})`);
const left = await sql(
  `select (select count(*) from auth.users where id = $1)::int as users, (select count(*) from public.organizations where id = $2)::int as orgs,
          (select count(*) from public.claims where organization_id = $2)::int as claims, (select count(*) from public.scan_uses where organization_id = $2)::int as uses,
          (select count(*) from public.device_tokens where user_id = $1)::int as phones`,
  [userId, orgId],
);
check(JSON.stringify(left[0]) === JSON.stringify({ users: 0, orgs: 0, claims: 0, uses: 0, phones: 0 }), `everything of the account is gone: ${JSON.stringify(left[0])}`);

/* ── One free trial per mailbox ──────────────────────────────────────────────────────────────── */

const again = `scan-e2e-${run}+again@example.test`;
const back = await signUpAndConfirm(again, password, "Sam Again", "203.0.113.12");
check(back.made.status === 200, "the same mailbox can make a new account");
const trial = await sql("select o.trial_claims_used from public.organizations o join auth.users u on o.personal_for = u.id where u.email = $1", [again]);
check(trial[0]?.trial_claims_used === 5, `but its free trial starts spent (${trial[0]?.trial_claims_used} of 5 used)`);

/* ── sa-delete, on the website ───────────────────────────────────────────────────────────────── */

const pub = await call("GET", "/account/delete");
check(pub.status === 200 && /What is deleted/.test(pub.text) && /How to delete it/.test(pub.text) && /privacy@scrivn\.ca/.test(pub.text), "scrivn.ca/account/delete explains deletion to someone signed out");

const webEmail = `web-e2e-${run}@example.test`;
const webUser = await signUpAndConfirm(webEmail, password, "Wendy Web", "203.0.113.13");
check(webUser.confirmed?.status === 307 && webUser.jar.cookies.size > 0, "a website account, signed in by its confirmation link");
const signedInPage = await call("GET", "/account/delete", { jar: webUser.jar });
check(signedInPage.status === 200 && /Delete my account/.test(signedInPage.text) && signedInPage.text.includes(webEmail), "signed in, the page has the form and says whose account");
const webWrong = await call("POST", "/api/account/delete", { jar: webUser.jar, body: { password: "wrong one here" }, ip: "203.0.113.13" });
check(webWrong.status === 400, `the website asks for the password too (${webWrong.status})`);
const webDel = await call("POST", "/api/account/delete", { jar: webUser.jar, body: { password }, ip: "203.0.113.13" });
check(webDel.status === 200 && webDel.json?.deleted === true, `deleted on the website (${webDel.status}: ${JSON.stringify(webDel.json)})`);
const webGone = await sql("select count(*)::int as n from auth.users where email = $1", [webEmail]);
check(webGone[0].n === 0, "the website account is gone");
const webAfter = await call("GET", "/account", { jar: webUser.jar });
check(webAfter.status === 307 && /\/login/.test(webAfter.location ?? ""), `and the browser is signed out (${webAfter.status} → ${webAfter.location})`);

/* ── The AI spending alarm, through the real module ──────────────────────────────────────────── */

{
  const out = mkdtempSync(join(tmpdir(), "aispend-e2e-"));
  const bundle = join(out, "bundle.mjs");
  await build({
    stdin: { contents: `export { recordAiSpend } from "@/lib/aiSpend";`, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: bundle,
    alias: { "@": root, "server-only": join(root, "node_modules", "server-only", "empty.js") },
    jsx: "automatic",
    logLevel: "error",
  });
  const env = readFileSync(join(root, ".env.development.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && m[1].includes("SUPABASE")) process.env[m[1]] = m[2];
  }
  process.env.AI_SPEND_ALARM_USD = "0.5";
  process.env.AI_SPEND_ALARM_EMAIL = "owner@example.test";
  delete process.env.RESEND_API_KEY;
  const { recordAiSpend } = await import(pathToFileURL(bundle).href);
  const day = new Date("2026-03-01T18:00:00Z");
  await recordAiSpend("claude-opus-5-5", { inputTokens: 50_000, outputTokens: 5_000, cacheCreationTokens: 0, cacheReadTokens: 0 }, day);
  await recordAiSpend("claude-opus-5-5", { inputTokens: 50_000, outputTokens: 5_000, cacheCreationTokens: 0, cacheReadTokens: 0 }, day);
  const spend = await sql("select calls, usd::float8 as usd, alarm_sent_at from public.ai_spend_days where day = '2026-03-01'");
  check(spend[0]?.calls === 2 && Math.abs(spend[0].usd - 0.6) < 1e-6, `two calls priced and totalled for the owner's day: US$${spend[0]?.usd}`);
  check(spend[0]?.alarm_sent_at === null, "over the alarm with no email set up: the alarm is given back, to go when email works");
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
