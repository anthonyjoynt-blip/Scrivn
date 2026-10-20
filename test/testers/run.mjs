/**
 * Giving a tester an account (scripts/add-tester.mjs, scripts/list-testers.mjs, lib/testerAccounts.ts),
 * run as the owner runs them — the real scripts as child processes — against the local Supabase
 * stand-in (test/e2e/fakeSupabase.mjs: GoTrue + PostgREST over PGlite with every migration) and a
 * stand-in for Resend on 127.0.0.1. No network, no real account, no email.
 *
 *   npm run test:testers
 *
 *   1. The same account as a sign-up: a normal sign-up (lib/signup.ts createAccount, confirmed by its
 *      link) and a tester with the same name and company leave the same rows in the same tables —
 *      profile, own organization, owner membership, the trial hash — column for column, but for ids,
 *      times, the password and the tester's mark.
 *   2. A dry run writes nothing and sends nothing, and says what a real run then makes.
 *   3. The email: plain text only, from no-reply@scrivn.ca, no links; --no-email sends nothing; an email
 *      that fails leaves the account made and prints the words to send.
 *   4. Run again (any spelling of the address, or an address that signed up itself): nothing changes.
 *   5. Refusals with nothing written: no service-role key, a malformed address, a mistyped option, no
 *      email key without --no-email.
 *   6. Forgot password gets the tester in: no password works before; the site's own calls (the forgot
 *      page's resetPasswordForEmail, /auth/confirm's verifyOtp, /reset-password's updateUser) set one.
 *   7. list-testers: the testers, not the sign-up, and who has signed in.
 *   8. A mailbox that has had a trial gets an account with it spent, as on sign-up.
 *
 * SAFETY: the scripts read settings from the environment, then from SCRIVN_ENV_FILE; this points that at
 * its own file and strips the real names from the children's environment, so nothing here can reach the
 * project in .env.local. Every run's output must name the stand-in's 127.0.0.1 address, or the suite stops.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { startFakeSupabase } from "../e2e/fakeSupabase.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "testers-tests-"));

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── The stand-ins ─────────────────────────────────────────────────────────────────────────────── */

const port = 54500 + Math.floor(Math.random() * 400);
const fake = await startFakeSupabase({ port });
const db = fake.local.db;

/** Resend on 127.0.0.1: records each send; `failNext` makes the next one refused. */
const mail = { sent: [], failNext: false };
const resend = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (req.method === "POST" && req.url === "/emails") {
    if (mail.failNext) {
      mail.failNext = false;
      res.writeHead(422, { "content-type": "application/json" });
      return res.end(JSON.stringify({ name: "validation_error", statusCode: 422, message: "The stand-in refused this one." }));
    }
    mail.sent.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ id: randomUUID() }));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => resend.listen(0, "127.0.0.1", r));
const resendUrl = `http://127.0.0.1:${resend.address().port}`;

const GUARD_SALT = "testers-suite-salt";
const settings = {
  NEXT_PUBLIC_SUPABASE_URL: fake.url,
  SUPABASE_SERVICE_ROLE_KEY: fake.keys.service,
  RESEND_API_KEY: "re_stand_in_not_a_key",
  GUARD_HASH_SECRET: GUARD_SALT,
};
function envFile(name, values) {
  const file = join(tmp, name);
  writeFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  return file;
}
const FULL_ENV = envFile("full.env", settings);

const REAL_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "RESEND_BASE_URL", "GUARD_HASH_SECRET", "SCRIVN_ENV_FILE"];
function childEnv(file) {
  const env = { ...process.env };
  for (const name of REAL_NAMES) delete env[name];
  return { ...env, SCRIVN_ENV_FILE: file, RESEND_BASE_URL: resendUrl };
}

/** A script, as the owner runs it, without blocking this process (the stand-ins live here). */
function run(script, args, { file = FULL_ENV } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, "scripts", script), ...args], { cwd: root, env: childEnv(file) });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      // Any run that got as far as a connection says where; it must be the stand-in.
      const where = /^Supabase: (.+)$/m.exec(out)?.[1];
      if (where && where !== `127.0.0.1:${port}`) {
        console.error(`STOPPED: a script talked to ${where}, not the stand-in.`);
        process.exit(2);
      }
      resolve({ code, out, err, where });
    });
  });
}

/** Every row of every public table, and the auth users, as text: "nothing changed" means this is equal. */
async function snapshot() {
  const tables = (await db.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map((r) => r.tablename);
  const out = {};
  for (const t of tables) out[t] = (await db.query(`select * from public."${t}"`)).rows.map((r) => JSON.stringify(r)).sort();
  out["auth.users"] = (await db.query(`select * from auth.users`)).rows.map((r) => JSON.stringify(r)).sort();
  out.links = fake.links.length;
  out.mail = mail.sent.length;
  return out;
}
/** Which tables gained rows between two snapshots, and how many. */
function added(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (!Array.isArray(after[k])) continue;
    const n = after[k].length - (before[k]?.length ?? 0);
    if (n !== 0) out[k] = n;
  }
  return out;
}

const userByEmail = async (email) => (await db.query(`select * from auth.users where lower(email) = lower($1)`, [email])).rows[0] ?? null;
/** A row without the columns that are its identity or a moment in time. */
const shape = (row, extra = []) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id" && !k.endsWith("_at") && !k.endsWith("_id") && k !== "personal_for" && k !== "user_id" && !extra.includes(k)));
async function accountRows(userId) {
  const profile = (await db.query(`select * from public.profiles where id = $1`, [userId])).rows;
  const members = (await db.query(`select * from public.organization_members where user_id = $1`, [userId])).rows;
  const orgs = (await db.query(`select o.* from public.organizations o join public.organization_members m on m.organization_id = o.id where m.user_id = $1`, [userId])).rows;
  return { profile, members, orgs };
}

/* ── 1. The same account as a sign-up ──────────────────────────────────────────────────────────── */

const run8 = randomUUID().slice(0, 8);
const NAME = "Sam Field";
const COMPANY = "Field Restoration Ltd";

// A normal sign-up, through lib/signup.ts itself, confirmed by the link it emails.
const signupBundle = join(tmp, "signup.mjs");
await build({
  stdin: { contents: `export { createAccount } from "@/lib/signup";`, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: signupBundle,
  alias: { "@": root, "server-only": join(root, "node_modules", "server-only", "empty.js") },
  jsx: "automatic",
  logLevel: "error",
});
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: fake.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: fake.keys.anon,
  SUPABASE_SERVICE_ROLE_KEY: fake.keys.service,
  NEXT_PUBLIC_SIGNUPS_OPEN: "true",
  GUARD_HASH_SECRET: GUARD_SALT,
});
delete process.env.RESEND_API_KEY; // sign-up then logs its link instead of emailing it
const { createAccount } = await import(pathToFileURL(signupBundle).href);
const { createClient } = await import("@supabase/supabase-js");
const anon = () => createClient(fake.url, fake.keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });

const signupEmail = `signup-${run8}@example.test`;
const beforeSignup = await snapshot();
const quiet = console.warn;
console.warn = () => {};
await createAccount({ email: signupEmail, password: "correct horse battery", fullName: NAME, companyName: COMPANY, ip: "203.0.113.7", origin: "http://127.0.0.1:3000" });
console.warn = quiet;
const confirmLink = fake.links.filter((l) => l.email === signupEmail && l.kind === "confirmation").at(-1);
const confirmed = await anon().auth.verifyOtp({ type: "email", token_hash: confirmLink?.hashed_token ?? "" });
check(!confirmed.error, `the sign-up confirms by its link (${confirmed.error?.message ?? "ok"})`);
const afterSignup = await snapshot();
const signupUser = await userByEmail(signupEmail);

const testerEmail = `tester-${run8}@example.test`;
const beforeTester = await snapshot();
const made = await run("add-tester.mjs", [testerEmail, "--name", NAME, "--company", COMPANY]);
const afterTester = await snapshot();
const testerUser = await userByEmail(testerEmail);
check(made.code === 0 && made.where === `127.0.0.1:${port}`, `add-tester runs against the stand-in (exit ${made.code}): ${made.err}`);
check(/^Made a Scrivn account for tester-/m.test(made.out), `it says it made the account:\n${made.out}`);
check(made.out.includes(`Organization:  ${COMPANY} (they are its owner)`), "it names the organization and says they own it");
check(testerUser !== null, "the auth user is there");

{
  const s = added(beforeSignup, afterSignup);
  const t = added(beforeTester, afterTester);
  delete s.request_limits; // sign-up's per-address guard; the owner's script is not a web request
  check(same(Object.keys(s).sort(), Object.keys(t).sort()), `the same tables gain rows (sign-up ${JSON.stringify(s)}, tester ${JSON.stringify(t)})`);
  for (const k of Object.keys(s)) check(s[k] === t[k], `${k}: sign-up added ${s[k]}, tester ${t[k]}`);
  check(t.profiles === 1 && t.organizations === 1 && t.organization_members === 1 && t.trial_emails === 1, `tester: one profile, organization, membership and trial hash (${JSON.stringify(t)})`);

  const a = await accountRows(signupUser.id);
  const b = await accountRows(testerUser.id);
  check(same(a.profile.map((r) => shape(r)), b.profile.map((r) => shape(r))), `profiles alike: ${JSON.stringify(a.profile.map((r) => shape(r)))} vs ${JSON.stringify(b.profile.map((r) => shape(r)))}`);
  check(same(a.orgs.map((r) => shape(r)), b.orgs.map((r) => shape(r))), `organizations alike, column for column: ${JSON.stringify(a.orgs.map((r) => shape(r)))} vs ${JSON.stringify(b.orgs.map((r) => shape(r)))}`);
  check(same(a.members.map((r) => shape(r)), b.members.map((r) => shape(r))), "memberships alike");
  check(b.orgs[0]?.name === COMPANY && b.orgs[0]?.personal_for === testerUser.id && b.members[0]?.role === "owner", "their own organization, named after the company, with them its owner");
  check(b.profile[0]?.full_name === NAME && b.profile[0]?.company_name === COMPANY, "the profile carries the name and company");

  check(same(signupUser.raw_user_meta_data, testerUser.raw_user_meta_data), `the same user metadata (${JSON.stringify(testerUser.raw_user_meta_data)})`);
  check(testerUser.email_confirmed_at !== null && signupUser.email_confirmed_at !== null, "both confirmed");
  check(testerUser.encrypted_password === null && signupUser.encrypted_password !== null, "the tester has no password; the sign-up has the one they chose");
  check(testerUser.raw_app_meta_data?.invited_by === "add-tester" && typeof testerUser.raw_app_meta_data?.invited_at === "string", `the tester carries the mark (${JSON.stringify(testerUser.raw_app_meta_data)})`);
  check(!signupUser.raw_app_meta_data?.invited_by, "the sign-up carries no mark");
  check(b.orgs[0]?.trial_claims_used === 0, "a new mailbox: the trial is not spent");
}

/* ── 2. A dry run ──────────────────────────────────────────────────────────────────────────────── */

{
  const email = `dry-${run8}@example.test`;
  const before = await snapshot();
  const dry = await run("add-tester.mjs", [email, "--name", "Dana Dry", "--dry-run"]);
  const after = await snapshot();
  check(dry.code === 0, `the dry run exits 0 (${dry.err})`);
  check(same(before, after), `the dry run writes nothing and sends nothing (${JSON.stringify(added(before, after))})`);
  check(/^Dry run: nothing is made and nothing is sent\./m.test(dry.out) && dry.out.includes(`Would make a Scrivn account for ${email}`), `it says it is a dry run:\n${dry.out}`);
  check(dry.out.includes("Organization:  Dana Dry (they would be its owner)"), "with no company it names the organization after them, as sign-up does");
  check(dry.out.includes("Subject: You've been set up on Scrivn") && dry.out.includes("scrivn.ca/forgot-password"), "it shows the email that would go");

  const dryNoEmail = await run("add-tester.mjs", [email, "--dry-run", "--no-email"]);
  check(dryNoEmail.code === 0 && dryNoEmail.out.includes("none (--no-email)") && dryNoEmail.out.includes("Organization:  My organization"), `a dry run with --no-email and no name:\n${dryNoEmail.out}`);
  check(same(before, await snapshot()), "still nothing written");

  const real = await run("add-tester.mjs", [email, "--name", "Dana Dry"]);
  const org = (await accountRows((await userByEmail(email)).id)).orgs[0];
  check(real.code === 0 && org?.name === "Dana Dry", `the real run makes what the dry run said (${org?.name})`);
}

/* ── 3. The email ──────────────────────────────────────────────────────────────────────────────── */

{
  const sent = mail.sent.filter((m) => same(m.body.to, [testerEmail]));
  check(sent.length === 1, `one email to the tester (${sent.length})`);
  const m = sent[0]?.body ?? {};
  check(m.from === "Scrivn <no-reply@scrivn.ca>", `from no-reply@scrivn.ca (${m.from})`);
  check(m.subject === "You've been set up on Scrivn", `subject: ${m.subject}`);
  check(typeof m.text === "string" && m.html === undefined && m.react === undefined, `plain text only, no HTML part (${Object.keys(m).join(", ")})`);
  const text = m.text ?? "";
  check(!/https?:|:\/\/|www\.|href|mailto|<|>|\]\(/i.test(text), `no links of any kind in:\n${text}`);
  check(text.includes("scrivn.ca/forgot-password") && text.includes(`(${testerEmail})`), "it says where to set the password, and with which address");
  check(text.startsWith("Hi Sam,") && /Exterior, then From photos/.test(text) && /Scrivn Scan on Android/.test(text) && /Ask the person who invited you/.test(text), "it greets them and says what to try and whom to ask");
  check(made.out.includes(`sent from no-reply@scrivn.ca ("You've been set up on Scrivn")`), "the script says it went");
  check(sent[0]?.headers.authorization === "Bearer re_stand_in_not_a_key", "sent with the key from the settings file");

  const quietEmail = `quiet-${run8}@example.test`;
  const before = mail.sent.length;
  const q = await run("add-tester.mjs", [quietEmail, "--name", "Quinn Quiet", "--no-email"]);
  check(q.code === 0 && (await userByEmail(quietEmail)) !== null, `--no-email makes the account (${q.err})`);
  check(mail.sent.length === before, "--no-email sends nothing");
  check(q.out.includes("not sent (--no-email). Tell them: Go to scrivn.ca/forgot-password"), `--no-email says what to tell them:\n${q.out}`);

  const failEmail = `bounce-${run8}@example.test`;
  mail.failNext = true;
  const f = await run("add-tester.mjs", [failEmail, "--name", "Bo Bounce"]);
  check(f.code === 1 && (await userByEmail(failEmail)) !== null, `an email that fails: the account stays made, exit 1 (${f.code})`);
  check(f.out.includes("DID NOT GO (The stand-in refused this one.)") && f.out.includes("Send them this yourself:") && f.out.includes("    Hi Bo,"), `and the words to send are printed:\n${f.out}`);
  const again = await run("add-tester.mjs", [failEmail, "--name", "Bo Bounce"]);
  check(again.code === 0 && /already has a Scrivn account/.test(again.out), "running it again then changes nothing");
}

/* ── 4. Run again ──────────────────────────────────────────────────────────────────────────────── */

{
  const before = await snapshot();
  const again = await run("add-tester.mjs", [testerEmail, "--name", "Someone Else", "--company", "Other Co"]);
  check(again.code === 0, `a repeat exits 0 (${again.err})`);
  check(again.out.includes(`${testerEmail} already has a Scrivn account (made with add-tester `) && again.out.includes("not signed in yet). Nothing changed."), `it says so:\n${again.out}`);
  const upper = await run("add-tester.mjs", [`  ${testerEmail.toUpperCase()} `]);
  check(upper.code === 0 && /already has a Scrivn account/.test(upper.out), "in capitals and with spaces it is the same address");
  const theirs = await run("add-tester.mjs", [signupEmail, "--name", NAME]);
  check(theirs.code === 0 && theirs.out.includes(`${signupEmail} already has a Scrivn account (made `) && !theirs.out.includes("made with add-tester"), "an address that signed up itself is left alone, and said to be theirs");
  const dryAgain = await run("add-tester.mjs", [testerEmail, "--dry-run"]);
  check(/already has a Scrivn account/.test(dryAgain.out), "a dry run says so too");
  const noMailAgain = await run("add-tester.mjs", [testerEmail], { file: envFile("nomail-again.env", { ...settings, RESEND_API_KEY: "" }) });
  check(noMailAgain.code === 0 && /already has a Scrivn account/.test(noMailAgain.out), `with no email key, a repeat still just says so (${noMailAgain.err.trim()})`);
  check(same(before, await snapshot()), `a repeat changes nothing anywhere (${JSON.stringify(added(before, await snapshot()))})`);
}

/* ── 5. Refusals ───────────────────────────────────────────────────────────────────────────────── */

{
  const before = await snapshot();
  const fresh = `refused-${run8}@example.test`;

  const noKey = await run("add-tester.mjs", [fresh, "--name", "No Key"], { file: envFile("nokey.env", { ...settings, SUPABASE_SERVICE_ROLE_KEY: "" }) });
  check(noKey.code === 1 && /SUPABASE_SERVICE_ROLE_KEY is not in \.env\.local/.test(noKey.err) && /Nothing was done/.test(noKey.err) && !noKey.where, `no service-role key: refused before connecting (${noKey.err.trim()})`);

  const noFile = await run("list-testers.mjs", [], { file: join(tmp, "missing.env") });
  check(noFile.code === 1 && /NEXT_PUBLIC_SUPABASE_URL is not in/.test(noFile.err), `list-testers with no settings: refused (${noFile.err.trim()})`);

  for (const bad of ["not-an-email", "jane@example", "jane smith@example.com", "@example.com", ""]) {
    const r = await run("add-tester.mjs", [bad, "--name", "Bad Address"]);
    check(r.code === 1 && (/doesn't look right/.test(r.err) || /Give the tester's email/.test(r.err)) && !r.where, `"${bad}" refused before connecting (${r.err.split("\n")[0]})`);
  }
  const badNoKey = await run("add-tester.mjs", ["nope"], { file: join(tmp, "missing.env") });
  check(badNoKey.code === 1 && /doesn't look right/.test(badNoKey.err), "a bad address is refused even with no settings at all");

  for (const args of [[fresh, "--dryrun"], [fresh, "--no-mail"], [fresh, "--name"], [fresh, "other@example.test"], [fresh, "--dry-run=yes"]]) {
    const r = await run("add-tester.mjs", args);
    check(r.code === 1 && /Unknown option|needs a value|One email address at a time/.test(r.err) && !r.where, `${args.slice(1).join(" ")} refused (${r.err.split("\n")[0]})`);
  }

  const noMailKey = await run("add-tester.mjs", [fresh, "--name", "No Mail"], { file: envFile("nomail.env", { ...settings, RESEND_API_KEY: "" }) });
  check(noMailKey.code === 1 && /RESEND_API_KEY is not in \.env\.local.*--no-email/.test(noMailKey.err), `no email key: refused, pointing at --no-email (${noMailKey.err.trim()})`);

  check(same(before, await snapshot()), `no refusal wrote anything (${JSON.stringify(added(before, await snapshot()))})`);
  check((await userByEmail(fresh)) === null, "the refused address has no account");
}

/* ── 6. Forgot password gets the tester in ─────────────────────────────────────────────────────── */

{
  const tryPassword = async (password) => (await anon().auth.signInWithPassword({ email: testerEmail, password })).error;
  check((await tryPassword("")) !== null && (await tryPassword("correct horse battery")) !== null, "before: no password signs the tester in");

  // app/(app)/forgot-password: the same call, with the page's redirect.
  const asked = await anon().auth.resetPasswordForEmail(testerEmail, { redirectTo: "http://127.0.0.1:3000/auth/confirm?next=/reset-password" });
  check(!asked.error, `Forgot password accepts the address (${asked.error?.message ?? "ok"})`);
  const link = fake.links.filter((l) => l.email === testerEmail && l.kind === "recovery").at(-1);
  check(link && link.redirect_to === "http://127.0.0.1:3000/auth/confirm?next=/reset-password", `a recovery link goes to /auth/confirm, on to /reset-password (${link?.redirect_to})`);

  // app/(app)/auth/confirm: verifyOtp makes the session; app/(app)/reset-password: updateUser sets the password.
  const browser = anon();
  const verified = await browser.auth.verifyOtp({ type: "recovery", token_hash: link?.hashed_token ?? "" });
  check(!verified.error && verified.data.session?.user?.email === testerEmail, `the link signs them in (${verified.error?.message ?? "ok"})`);
  const set = await browser.auth.updateUser({ password: "tester chose this" });
  check(!set.error, `they set a password (${set.error?.message ?? "ok"})`);
  check((await tryPassword("tester chose this")) === null, "after: their password signs them in");
  check((await tryPassword("something else")) !== null, "and no other");
}

/* ── 7. list-testers ───────────────────────────────────────────────────────────────────────────── */

{
  const before = await snapshot();
  const listed = await run("list-testers.mjs", []);
  check(listed.code === 0 && listed.where === `127.0.0.1:${port}`, `list-testers runs (${listed.err})`);
  check(/^4 testers made with add-tester:/m.test(listed.out), `it counts the four testers made:\n${listed.out}`);
  const today = new Date().toISOString().slice(0, 10);
  const line = (email) => listed.out.split("\n").find((l) => l.includes(email)) ?? "";
  check(line(testerEmail).includes(COMPANY) && line(testerEmail).includes(today) && line(testerEmail).trimEnd().endsWith(today), `the tester who set a password: company, made, signed in (${line(testerEmail)})`);
  check(line(`quiet-${run8}`).includes("Quinn Quiet") && line(`quiet-${run8}`).trimEnd().endsWith("not yet"), `with no company, their name; not signed in yet (${line(`quiet-${run8}`)})`);
  check(!listed.out.includes(signupEmail), "the account that signed up itself is not a tester");
  check(same(before, await snapshot()), "listing writes nothing");
}

/* ── 8. One trial per mailbox ──────────────────────────────────────────────────────────────────── */

{
  const email = `Seen.Before+scrivn-${run8}@gmail.com`;
  // lib/guardRules.ts normaliseEmail: lower case, +tag dropped, Gmail dots dropped.
  const normalised = "seenbefore@gmail.com";
  const hash = createHash("sha256").update(`scrivn-guard:trial-email:${GUARD_SALT}:${normalised}`, "utf8").digest("hex");
  await db.query(`insert into public.trial_emails (email_hash) values ($1) on conflict do nothing`, [hash]);
  const r = await run("add-tester.mjs", [email, "--name", "Seen Before", "--no-email"]);
  const org = (await accountRows((await userByEmail(email))?.id)).orgs[0];
  check(r.code === 0 && org?.trial_claims_used === 5, `a mailbox that had a trial starts with it spent, hashed with the settings' salt (${org?.trial_claims_used})`);
}

/* ── Done ──────────────────────────────────────────────────────────────────────────────────────── */

await fake.close();
await new Promise((r) => resend.close(r));
rmSync(tmp, { recursive: true, force: true });

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`\n${passed}/${passed + failures.length} checks passed`);
process.exit(failures.length ? 1 : 0);
