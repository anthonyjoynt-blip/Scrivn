/**
 * Scrivn Scan standing on its own (2026-10-14): the free scans, the guards on new accounts and AI
 * spend, and deleting an account — the rules in TypeScript and the SQL in 0014_scan_accounts.sql,
 * against every migration in a Postgres in memory (test/db/supabaseLocal.mjs). No Supabase, no Stripe.
 *
 *   npm run test:scanaccounts
 *
 *   1. The rules: what a scan is, who is limited and when it bites, the sentences (the refusal names
 *      scrivn.ca/scan as plain text), email normalising for the one-trial rule, the guard limits and
 *      their fallbacks, the AI price arithmetic and the owner's day.
 *   2. The counter (org_use_scan): three a month on no plan, a capture counted once however it
 *      leaves, last month's not counted, a plan unlimited, two at once never both the third, and
 *      nobody but the service role can call it.
 *   3. The guards' SQL: request_limit_hit's windows, trial_email_seen, ai_spend_add's once-a-day alarm.
 *   4. Deleting (account_deletion_plan, account_close, and lib/accountDeletion.ts driven over the real
 *      SQL with Stripe and storage stood in for): alone, everything goes, the plan cancelled first and
 *      nothing deleted when Stripe refuses; on a team, the team keeps its claims; a team's owner is
 *      refused; a set-aside organization goes too; other people's data is untouched.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { migrationFiles, newToken, sha256Hex, startSupabaseLocal } from "../db/supabaseLocal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "scanaccounts-tests-"));
const bundlePath = join(outDir, "bundle.mjs");
await build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root, "server-only": join(root, "node_modules", "server-only", "empty.js") },
  jsx: "automatic",
  logLevel: "error",
});
const T = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── 1. The rules ──────────────────────────────────────────────────────────────────────────────── */

{
  const oct = new Date("2026-10-14T18:00:00Z");
  const free = T.scanAllowance({ tier: null, used: 2, enforced: true, now: oct });
  check(free.limit === 3 && !free.unlimited && free.plan === null, `no plan, enforced: 3 a month (${JSON.stringify(free)})`);
  check(free.monthStart === "2026-10-01T00:00:00.000Z" && free.resetsAt === "2026-11-01T00:00:00.000Z", `the month is October UTC (${free.monthStart} → ${free.resetsAt})`);
  check(free.summary === "Free plan: 2 of 3 free scans used this month. They start again on November 1.", `summary: ${free.summary}`);
  const spent = T.scanAllowance({ tier: null, used: 3, enforced: true, now: oct });
  check(/all 3 free scans used/.test(spent.summary), `spent summary: ${spent.summary}`);

  const testing = T.scanAllowance({ tier: null, used: 5, enforced: false, now: oct });
  check(testing.unlimited && testing.limit === null && /in testing \(5 scans this month\)/.test(testing.summary), `not enforced: unlimited, counted (${testing.summary})`);
  check(T.scanAllowance({ tier: null, used: 1, enforced: false, now: oct }).summary.includes("1 scan this month"), "one scan is singular");

  for (const tier of ["starter", "growth", "unlimited"]) {
    const a = T.scanAllowance({ tier, used: 40, enforced: true, now: oct });
    check(a.plan === "scrivn" && a.unlimited && a.limit === null, `${tier} includes unlimited scans`);
  }
  const scan = T.scanAllowance({ tier: "scan", used: 40, enforced: true, now: oct });
  check(scan.plan === "scan" && scan.unlimited && scan.summary === "Scrivn Scan plan: unlimited scans.", `scan plan: ${scan.summary}`);
  check(T.freeLimitFor("bogus", true) === 3, "an unknown tier is no plan");

  check(T.freeTierEnforced({}) === false, "billing off: not enforced");
  check(T.freeTierEnforced({ BILLING_ENABLED: "true" }) === true, "billing on: enforced");
  check(T.freeTierEnforced({ BILLING_ENABLED: "TRUE" }) === false, "billing flag fails closed on spelling");
  check(T.freeTierEnforced({ SCAN_FREE_TIER: "on" }) === true && T.freeTierEnforced({ BILLING_ENABLED: "true", SCAN_FREE_TIER: " Off " }) === false, "SCAN_FREE_TIER overrides both ways");

  const december = T.scanAllowance({ tier: null, used: 0, enforced: true, now: new Date("2026-12-31T23:59:59Z") });
  check(december.resetsAt === "2027-01-01T00:00:00.000Z", `December rolls into January (${december.resetsAt})`);

  const message = T.scanLimitMessage(spent);
  check(message.includes("scrivn.ca/scan") && !/https?:\/\//.test(message) && !/<a\b/.test(message), `refusal names the page in plain text, no link: ${message}`);
  check(/3 free scans/.test(message) && /November 1/.test(message), "refusal says how many and when they come back");

  check(T.captureKey("  cap-1 ", "s") === "cap-1", "a capture id is its key");
  check(T.captureKey("", "abc") === "scan:abc" && T.captureKey(null, "abc") === "scan:abc", "no capture id: the scan's own");
  check(T.captureKey("x".repeat(300), "s").length === 200, "a capture id is capped at 200");
}

{
  check(T.normaliseEmail(" Jo.Smith+scrivn@GoogleMail.com ") === "josmith@gmail.com", "gmail: dots, tag and googlemail folded");
  check(T.normaliseEmail("jo.smith+x@shaw.ca") === "jo.smith@shaw.ca", "elsewhere: the tag goes, the dots stay");
  check(T.normaliseEmail("no-at-sign") === "no-at-sign", "not an address: lower-cased as is");
  check(T.looksLikeEmail("a@b.ca") && !T.looksLikeEmail("a@b") && !T.looksLikeEmail("a b@c.ca"), "email shape");

  const d = T.DEFAULT_GUARD_LIMITS;
  check(same(T.guardLimits({}), d), "no settings: the defaults");
  const set = T.guardLimits({ SIGNUP_LIMIT_PER_IP_PER_DAY: " 5 ", SIGNUP_LIMIT_PER_DAY: "0", SIGNIN_LIMIT_PER_IP_PER_HOUR: "lots", SIGNIN_LIMIT_PER_EMAIL_PER_HOUR: "-2" });
  check(set.signupPerIpPerDay === 5 && set.signupPerDay === 0, "numbers are read, 0 allowed");
  check(set.signinPerIpPerHour === d.signinPerIpPerHour && set.signinPerEmailPerHour === d.signinPerEmailPerHour, "a typo keeps the default, never opens the door");
  check(T.guardLimits({ SIGNUP_LIMIT_PER_DAY: "﻿7" }).signupPerDay === 7, "a byte-order mark is ignored");

  const h = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  check(T.clientIp(h) === "203.0.113.9", "the first forwarded address");
  check(T.clientIp(new Headers({ "x-real-ip": "198.51.100.2" })) === "198.51.100.2", "x-real-ip");
  check(T.clientIp(new Headers()) === "unknown", "no address");
  const a = T.guardHash("ip", "203.0.113.9", undefined);
  check(/^[0-9a-f]{64}$/.test(a) && !a.includes("203"), "a guard hash is a hash");
  check(a !== T.guardHash("email", "203.0.113.9", undefined) && a !== T.guardHash("ip", "203.0.113.9", "s3cret"), "purpose and secret change it");

  const now = new Date("2026-10-14T10:00:00Z");
  check(T.retryWords(new Date("2026-10-14T10:14:10Z"), now) === "in 15 minutes", "minutes");
  check(T.retryWords(new Date("2026-10-14T10:00:20Z"), now) === "in a minute", "a minute");
  check(T.retryWords(new Date("2026-10-15T00:00:00Z"), now) === "in about 14 hours", "hours");
  check(T.retryWords(new Date("2026-10-15T09:00:00Z"), now) === "tomorrow", "tomorrow");
}

{
  const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheCreationTokens: 200_000, cacheReadTokens: 2_000_000 };
  const opus = T.estimateUsd("claude-opus-5-5", usage);
  check(Math.abs(opus - (4 + 2 + 1 + 0.4)) < 1e-9, `Opus 5.5: 4 + 2 + 1 + 0.4 = ${opus}`);
  check(Math.abs(T.estimateUsd("some-new-model", usage) - opus) < 1e-9, "an unknown model is priced as Opus 5.5");
  check(Math.abs(T.estimateUsd("claude-haiku-5-5", { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }) - 0.1) < 1e-9, "Haiku 5.5 input");
  const overridden = T.estimateUsd("claude-opus-5-5", usage, { AI_PRICE_INPUT_PER_MTOK: "10", AI_PRICE_OUTPUT_PER_MTOK: "x" });
  check(Math.abs(overridden - (10 + 2 + 1 + 0.4)) < 1e-9, `AI_PRICE_* overrides, a bad one is ignored (${overridden})`);
  check(T.estimateUsd("claude-opus-5-5", { inputTokens: -5, outputTokens: NaN, cacheCreationTokens: 0, cacheReadTokens: 0 }) === 0, "nonsense counts as nothing");

  check(T.alarmThreshold({}) === null && T.alarmThreshold({ AI_SPEND_ALARM_USD: "0" }) === null && T.alarmThreshold({ AI_SPEND_ALARM_USD: "abc" }) === null, "no alarm unless a positive number");
  check(T.alarmThreshold({ AI_SPEND_ALARM_USD: " 25.5 " }) === 25.5, "the alarm threshold");

  // 05:30 UTC on the 15th is still the 14th in Alberta (MDT, UTC-6).
  const at = new Date("2026-10-15T05:30:00Z");
  check(T.spendDay(at, undefined) === "2026-10-14", `the owner's day by default (${T.spendDay(at, undefined)})`);
  check(T.spendDay(at, "UTC") === "2026-10-15", "another zone");
  check(T.spendDay(at, "Not/AZone") === "2026-10-15", "a bad zone falls back to UTC");
}

/* ── 2-4. The SQL ──────────────────────────────────────────────────────────────────────────────── */

const s = await startSupabaseLocal();
for (const m of migrationFiles(root)) await s.applyMigration(m);
// Twice, as the owner might.
for (const m of migrationFiles(root).filter((f) => f.name.includes("_scan_accounts"))) await s.applyMigration(m);
const rows = (res) => res.data ?? [];
const orgOf = async (userId) => (await s.sql("select organization_id from organization_members where user_id = $1", [userId]))[0]?.organization_id ?? null;
const use = (org, key, limit, how = "saved", person = null) =>
  s.service("select * from public.org_use_scan($1, $2, $3, null, $4, $5)", [org, key, person, how, limit]).then((r) => (r.error ? { error: r.error } : rows(r)[0]));

{
  const alone = await s.createUser({ email: "free@x.test", fullName: "Free Scanner" });
  const org = await orgOf(alone);
  const first = await use(org, "cap-1", 3, "saved", alone);
  check(first.allowed && first.counted && first.used === 1, `first scan counted (${JSON.stringify(first)})`);
  const again = await use(org, "cap-1", 3, "sent", alone);
  check(again.allowed && !again.counted && again.used === 1, "the same capture sent after sharing costs nothing");
  await use(org, "cap-2", 3);
  const third = await use(org, "cap-3", 3);
  check(third.allowed && third.used === 3, "the third is allowed");
  const fourth = await use(org, "cap-4", 3);
  check(!fourth.allowed && !fourth.counted && fourth.used === 3, `the fourth is refused (${JSON.stringify(fourth)})`);
  const reshare = await use(org, "cap-2", 3);
  check(reshare.allowed && !reshare.counted, "a capture counted before still goes after the limit");
  const n = (await s.sql("select count(*)::int as n from scan_uses where organization_id = $1", [org]))[0].n;
  check(n === 3, `three rows, the refusal recorded nothing (${n})`);
  const how = (await s.sql("select how from scan_uses where organization_id = $1 and capture_key = 'cap-1'", [org]))[0]?.how;
  check(how === "saved", "the first way out is kept");

  // Last month's do not count.
  await s.sql("update scan_uses set used_at = date_trunc('month', now(), 'UTC') - interval '1 day' where organization_id = $1", [org]);
  const fresh = await use(org, "cap-5", 3);
  check(fresh.allowed && fresh.used === 1, `a new month starts at nothing (${JSON.stringify(fresh)})`);
  const oldOne = await use(org, "cap-1", 3);
  check(oldOne.allowed && !oldOne.counted && oldOne.used === 1, "a capture counted last month is not counted again");

  // A plan: unlimited, still recorded.
  const paid = await s.createUser({ email: "paid@x.test", fullName: "Paid" });
  const paidOrg = await orgOf(paid);
  for (let i = 0; i < 6; i++) await use(paidOrg, `p-${i}`, null);
  const seventh = await use(paidOrg, "p-6", null);
  check(seventh.allowed && seventh.counted && seventh.used === 7, "a plan is unlimited and still counted");

  // Two at once for the last free scan: one wins.
  const racer = await s.createUser({ email: "race@x.test", fullName: "Race" });
  const raceOrg = await orgOf(racer);
  await use(raceOrg, "r-1", 3);
  await use(raceOrg, "r-2", 3);
  const [x, y] = await Promise.all([use(raceOrg, "r-3", 3), use(raceOrg, "r-4", 3)]);
  check([x, y].filter((r) => r.allowed).length === 1, `two at once for the third: one wins (${JSON.stringify([x, y])})`);

  // Organizations are separate.
  check((await use(raceOrg, "cap-1", 3)).allowed === false, "another organization's capture id is still a new scan for this one");

  // Only the server.
  const asAnon = await s.as(null, "select * from public.org_use_scan($1, 'z', null, null, 'saved', 3)", [org]);
  const asUser = await s.as(alone, "select * from public.org_use_scan($1, 'z', null, null, 'saved', null)", [org]);
  check(asAnon.error && asUser.error, "anon and a signed-in person cannot call org_use_scan");
  const write = await s.as(alone, "insert into public.scan_uses (organization_id, capture_key, how) values ($1, 'forged', 'saved')", [org]);
  check(write.error, "a person cannot write scan_uses");
  const mine = await s.as(alone, "select count(*)::int as n from public.scan_uses");
  const theirs = await s.as(racer, "select count(*)::int as n from public.scan_uses where organization_id = $1", [org]);
  check(rows(mine)[0]?.n >= 1 && rows(theirs)[0]?.n === 0, "a member reads their organization's scans, nobody else's");
  const bad = await use(org, "", 3);
  check(bad.error?.code === "22023", "an empty capture key is refused");
}

{
  const hit = (bucket, key, win, max) => s.service("select * from public.request_limit_hit($1, $2, $3, $4)", [bucket, key, win, max]).then((r) => rows(r)[0]);
  const a = await hit("signup-ip", "k1", 86400, 2);
  const b = await hit("signup-ip", "k1", 86400, 2);
  const c = await hit("signup-ip", "k1", 86400, 2);
  check(a.allowed && b.allowed && !c.allowed && c.hits === 3, "two a day, the third refused");
  check(new Date(c.retry_at).getTime() - Date.now() <= 86400_000 && new Date(c.retry_at) > new Date(), "retry at the end of the window");
  check((await hit("signup-ip", "k2", 86400, 2)).allowed, "another address has its own count");
  check(!(await hit("zero", "k", 60, 0)).allowed, "a limit of 0 refuses");
  const asAnon = await s.as(null, "select * from public.request_limit_hit('x', 'y', 60, 5)");
  check(asAnon.error, "anon cannot call request_limit_hit");
  const peek = await s.as(null, "select * from public.request_limits");
  check(peek.error || rows(peek).length === 0, "nobody but the server reads request_limits");

  const seen1 = rows(await s.service("select public.trial_email_seen($1) as seen", ["f".repeat(64)]))[0].seen;
  const seen2 = rows(await s.service("select public.trial_email_seen($1) as seen", ["f".repeat(64)]))[0].seen;
  check(seen1 === false && seen2 === true, "an address's second trial is seen");
  check((await s.as(null, "select public.trial_email_seen($1)", ["e".repeat(64)])).error, "anon cannot call trial_email_seen");

  const add = (usd, alarm) => s.service("select * from public.ai_spend_add('2026-10-14', 1000, 100, 0, 0, $1, $2)", [usd, alarm]).then((r) => rows(r)[0]);
  const s1 = await add(4, 10);
  const s2 = await add(7, 10);
  const s3 = await add(1, 10);
  check(!s1.alarm && s2.alarm && !s3.alarm, `the alarm goes once, on the call that crosses (${[s1, s2, s3].map((r) => r.alarm)})`);
  check(Number(s3.total_usd) === 12 && s3.calls === 3, `the day's total (${s3.total_usd}, ${s3.calls} calls)`);
  await s.service("select public.ai_spend_alarm_unsent('2026-10-14')");
  check((await add(0.5, 10)).alarm === true, "given back when the email failed, the next call claims it");
  check((await add(0.5, null)).alarm === false, "no threshold, no alarm");
  const other = await s.service("select * from public.ai_spend_add('2026-10-15', 1, 1, 0, 0, 0.01, 10)");
  check(rows(other)[0].calls === 1, "a new day starts at nothing");
  check((await s.as(null, "select * from public.ai_spend_add('2026-10-14', 1, 1, 0, 0, 1, null)")).error, "anon cannot add spend");
}

/* ── 4. Deleting ───────────────────────────────────────────────────────────────────────────────── */

/** Storage as a set of paths per bucket, listed one level at a time the way Supabase lists. */
function fakeStorage() {
  const files = new Map();
  const bucket = (name) => {
    if (!files.has(name)) files.set(name, new Set());
    return files.get(name);
  };
  return {
    files,
    put: (name, path) => bucket(name).add(path),
    from: (name) => ({
      list: async (prefix) => {
        const seen = new Map();
        for (const p of bucket(name)) {
          if (!p.startsWith(`${prefix}/`)) continue;
          const rest = p.slice(prefix.length + 1);
          const slash = rest.indexOf("/");
          if (slash === -1) seen.set(rest, { name: rest, id: randomUUID() });
          else seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
        }
        return { data: [...seen.values()], error: null };
      },
      remove: async (paths) => {
        for (const p of paths) bucket(name).delete(p);
        return { data: [], error: null };
      },
    }),
  };
}

/** The admin client lib/accountDeletion.ts needs, over the PGlite database and the fake storage. */
function fakeAdmin(storage) {
  return {
    rpc: async (fn, args) => {
      const keys = Object.keys(args);
      const res = await s.service(`select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, keys.map((k) => args[k]));
      return res.error ? { data: null, error: { code: res.error.code, message: res.error.message } } : { data: res.data, error: null };
    },
    storage,
    auth: {
      admin: {
        deleteUser: async (id) => {
          await s.sql("delete from auth.users where id = $1", [id]);
          return { error: null };
        },
      },
    },
  };
}

function fakeStripe({ fail = false } = {}) {
  const cancelled = [];
  const subs = new Map();
  return {
    cancelled,
    subs,
    list: async (customer) => {
      if (fail) throw new Error("Stripe is down");
      return subs.get(customer) ?? [];
    },
    cancel: async (id) => {
      cancelled.push(id);
    },
  };
}

/** A person with a claim, a pending scan, a paired phone, a counted scan, a problem report and photos. */
async function personWithData(email, storage) {
  const id = await s.createUser({ email, fullName: email.split("@")[0] });
  const org = await orgOf(id);
  const claim = rows(await s.service("insert into public.claims (organization_id, created_by, payload) values ($1, $2, '{}'::jsonb) returning id", [org, id]))[0].id;
  const tokenHash = sha256Hex(newToken());
  const token = rows(await s.service("insert into public.device_tokens (organization_id, user_id, token_hash) values ($1, $2, $3) returning id", [org, id, tokenHash]))[0].id;
  const scan = rows(await s.service("insert into public.claim_scans (claim_id, organization_id, device_token_id, body) values ($1, $2, $3, '{}'::jsonb) returning id", [claim, org, token]))[0].id;
  await use(org, `c-${email}`, 3, "sent", id);
  await s.service("insert into public.scan_reports (install_id, ip_hash, user_id, organization_id) values ('inst', 'h', $1, $2)", [id, org]).then((r) => {
    if (r.error) throw r.error;
  });
  storage?.put("scan-photos", `${org}/${scan}/1.jpg`);
  storage?.put("scan-photos", `${org}/${scan}/2.jpg`);
  storage?.put("logos", `${org}/logo.png`);
  return { id, org, claim, scan, token };
}

const countIn = async (table, column, value) => (await s.sql(`select count(*)::int as n from public.${table} where ${column} = $1`, [value]))[0].n;

{
  const storage = fakeStorage();
  const bystander = await personWithData("bystander@x.test", storage);
  const alone = await personWithData("alone@x.test", storage);
  await s.sql("update organizations set stripe_customer_id = 'cus_alone' where id = $1", [alone.org]);
  const stripe = fakeStripe();
  stripe.subs.set("cus_alone", [
    { id: "sub_live", status: "active" },
    { id: "sub_old", status: "canceled" },
    { id: "sub_late", status: "past_due" },
  ]);

  // Stripe down: nothing deleted.
  const down = fakeStripe({ fail: true });
  let refused = null;
  try {
    await T.deleteAccount(alone.id, "alone@x.test", { admin: fakeAdmin(storage), stripe: down, notify: async () => {} });
  } catch (err) {
    refused = err;
  }
  check(refused instanceof T.DeletionUnavailableError, `Stripe refusing stops the deletion (${refused?.name})`);
  check((await countIn("claims", "organization_id", alone.org)) === 1 && (await s.sql("select 1 from auth.users where id = $1", [alone.id])).length === 1, "and nothing was deleted");

  // No Stripe configured but a customer on record: refused too.
  let noStripe = null;
  try {
    await T.deleteAccount(alone.id, "alone@x.test", { admin: fakeAdmin(storage), stripe: null, notify: async () => {} });
  } catch (err) {
    noStripe = err;
  }
  check(noStripe instanceof T.DeletionUnavailableError, "a plan that cannot be cancelled is never left running");

  const notified = [];
  const result = await T.deleteAccount(alone.id, "alone@x.test", { admin: fakeAdmin(storage), stripe, notify: async (to) => notified.push(to) });
  check(result.organizationsDeleted === 1 && !result.leftTeam && result.subscriptionsCancelled === 2, `alone: one organization, two live subscriptions (${JSON.stringify(result)})`);
  check(same(stripe.cancelled.sort(), ["sub_late", "sub_live"]), `the live ones cancelled, the cancelled one left (${stripe.cancelled})`);
  for (const [table, column, value] of [
    ["organizations", "id", alone.org],
    ["claims", "organization_id", alone.org],
    ["claim_scans", "organization_id", alone.org],
    ["device_tokens", "user_id", alone.id],
    ["scan_uses", "organization_id", alone.org],
    ["scan_reports", "user_id", alone.id],
    ["profiles", "id", alone.id],
    ["organization_members", "user_id", alone.id],
  ]) {
    check((await countIn(table, column, value)) === 0, `alone: ${table} gone`);
  }
  check((await s.sql("select 1 from auth.users where id = $1", [alone.id])).length === 0, "alone: the sign-in gone");
  check([...storage.files.get("scan-photos")].every((p) => !p.startsWith(alone.org)) && !storage.files.get("logos").has(`${alone.org}/logo.png`), "alone: photos and logo gone");
  check(same(notified, ["alone@x.test"]), "alone: told by email");

  // The bystander is untouched.
  check((await countIn("claims", "organization_id", bystander.org)) === 1 && (await countIn("device_tokens", "user_id", bystander.id)) === 1, "someone else's claims and phones are untouched");
  check(storage.files.get("scan-photos").has(`${bystander.org}/${bystander.scan}/1.jpg`) && storage.files.get("logos").has(`${bystander.org}/logo.png`), "someone else's files are untouched");
  check((await countIn("scan_reports", "user_id", bystander.id)) === 1, "someone else's reports are untouched");

  // Again: nothing left to do, and no error.
  const twice = await T.deleteAccount(alone.id, null, { admin: fakeAdmin(storage), stripe, notify: async () => {} });
  check(twice.organizationsDeleted === 0, "a second deletion finds nothing and does not fail");
}

{
  // A team of three: an owner, a member who leaves by deleting, and the team keeps its claims.
  const storage = fakeStorage();
  const owner = await personWithData("owner@x.test", storage);
  const member = await s.createUser({ email: "member@x.test", fullName: "Member" });
  const memberHome = await orgOf(member);
  // Joining sets their own organization aside (0012): empty, still personal_for them, with a claim.
  await s.sql("delete from organization_members where user_id = $1", [member]);
  await s.sql("insert into organization_members (organization_id, user_id, role) values ($1, $2, 'member')", [owner.org, member]);
  await s.service("insert into public.claims (organization_id, created_by, payload) values ($1, $2, '{}'::jsonb)", [memberHome, member]);
  const teamClaim = rows(await s.service("insert into public.claims (organization_id, created_by, payload) values ($1, $2, '{}'::jsonb) returning id", [owner.org, member]))[0].id;
  await s.sql("update organizations set stripe_customer_id = 'cus_team' where id = $1", [owner.org]);
  const third = await s.createUser({ email: "third@x.test", fullName: "Third" });
  await s.sql("delete from organization_members where user_id = $1", [third]);
  await s.sql("insert into organization_members (organization_id, user_id, role) values ($1, $2, 'admin')", [owner.org, third]);

  const plan = rows(await s.service("select * from public.account_deletion_plan($1)", [member]));
  check(
    plan.length === 2 && plan.some((p) => p.organization_id === owner.org && p.action === "leave") && plan.some((p) => p.organization_id === memberHome && p.action === "delete"),
    `member's plan: leave the team, delete their own set aside (${JSON.stringify(plan)})`,
  );

  const stripe = fakeStripe();
  stripe.subs.set("cus_team", [{ id: "sub_team", status: "active" }]);
  const result = await T.deleteAccount(member, "member@x.test", { admin: fakeAdmin(storage), stripe, notify: async () => {} });
  check(result.leftTeam && result.organizationsDeleted === 1 && stripe.cancelled.length === 0, `member: left the team, its plan untouched (${JSON.stringify(result)})`);
  const kept = (await s.sql("select created_by from claims where id = $1", [teamClaim]))[0];
  check(kept && kept.created_by === null, "the claim they started stays with the team, with no name on it");
  check((await countIn("organizations", "id", memberHome)) === 0, "their own set-aside organization is gone");
  check((await countIn("organization_members", "organization_id", owner.org)) === 2, "the team still has the owner and the admin");

  // The owner of a team with people in it is refused, and nothing changes.
  let refused = null;
  try {
    await T.deleteAccount(owner.id, "owner@x.test", { admin: fakeAdmin(storage), stripe, notify: async () => {} });
  } catch (err) {
    refused = err;
  }
  check(refused instanceof T.TeamOwnerCannotDeleteError, `a team's owner is refused (${refused?.name})`);
  check((await countIn("claims", "organization_id", owner.org)) === 2 && (await countIn("device_tokens", "user_id", owner.id)) === 1, "and nothing of the team changed");
  check(/hand it to one of them first/i.test(refused?.message ?? ""), "with a sentence that says what to do");

  // Nobody but the server can plan or close.
  check((await s.as(owner.id, "select * from public.account_close($1)", [third])).error, "a person cannot call account_close");
  check((await s.as(null, "select * from public.account_deletion_plan($1)", [third])).error, "anon cannot call account_deletion_plan");
}

{
  // A phone's token stops the moment the account closes, even before the sign-in is deleted.
  const person = await personWithData("phone@x.test", null);
  const tokenHash = sha256Hex(newToken());
  await s.service("insert into public.device_tokens (organization_id, user_id, token_hash) values ($1, $2, $3)", [person.org, person.id, sha256Hex(tokenHash)]);
  await s.service("select * from public.account_close($1)", [person.id]);
  const who = await s.as(null, "select * from public.device_identity($1)", [tokenHash]);
  check(!who.error && rows(who).length === 0, "after account_close the phone's token resolves to nobody");
}

{
  // Sign out from the phone: the token revokes itself, and only itself.
  const person = await personWithData("signout@x.test", null);
  const mine = newToken();
  const other = newToken();
  for (const t of [mine, other]) {
    await s.service("insert into public.device_tokens (organization_id, user_id, token_hash) values ($1, $2, $3)", [person.org, person.id, sha256Hex(sha256Hex(t))]);
  }
  const out = await s.as(null, "select public.device_token_revoke_self($1) as ok", [sha256Hex(mine)]);
  check(!out.error && rows(out)[0].ok === true, "a phone signs itself out with only its token");
  const again = await s.as(null, "select public.device_token_revoke_self($1) as ok", [sha256Hex(mine)]);
  check(rows(again)[0].ok === false, "signing out twice is harmless");
  const gone = await s.as(null, "select * from public.device_identity($1)", [sha256Hex(mine)]);
  const still = await s.as(null, "select * from public.device_identity($1)", [sha256Hex(other)]);
  check(rows(gone).length === 0 && rows(still).length === 1, "that phone stops; the account's other phone does not");
  const guess = await s.as(null, "select public.device_token_revoke_self($1) as ok", [sha256Hex("not a token")]);
  check(rows(guess)[0].ok === false, "a token nobody holds revokes nothing");
}

await s.close();
rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
