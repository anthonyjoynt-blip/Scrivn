/**
 * Teams, cross-organization isolation and invite tokens — against every migration, in a Postgres in
 * memory, before any of it is applied to the real project.
 *
 *   npm run test:rls:local
 *
 * test/rls/run.mjs asks the same kind of questions of the real project over the API, and can only do
 * so once a migration has been applied there. This applies supabase/migrations/* in order to a
 * Supabase-shaped PGlite (test/db/supabaseLocal.mjs) and probes the policies and the SECURITY DEFINER
 * functions directly, as `authenticated` with a user's JWT claims, as the bare `anon` key, and as the
 * service role — which is what PostgREST does underneath. Nothing leaves this machine.
 *
 * As in run.mjs, every check on the refused side passes on zero rows, `false` or an error, and every
 * check on the allowed side exists so a set of rules that simply refused everything could not pass.
 * Refusals are asserted by SQLSTATE where the function promises one (the codes are listed in
 * 0012_teams.sql and mapped to sentences in lib/teams.ts).
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationFiles, newToken, sha256Hex, splitMigrationsAt, startSupabaseLocal } from "../db/supabaseLocal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

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
const codeOf = (res) => res.error?.code ?? null;
const rows = (res) => res.data ?? [];
function refusedWith(res, code, message) {
  check(res.error !== null && res.error.code === code, `${message} (got ${res.error ? res.error.code + " " + res.error.message : "ACCEPTED " + JSON.stringify(res.data)})`);
}

const s = await startSupabaseLocal();
for (const m of migrationFiles(root)) await s.applyMigration(m);
console.log(`\n  Applied ${migrationFiles(root).length} migrations to a local Postgres.\n`);

/* ── Helpers ──────────────────────────────────────────────────────────────────────────────────── */

async function membership(userId) {
  const r = await s.sql(`select organization_id, role from public.organization_members where user_id = $1`, [userId]);
  return r.length === 1 ? r[0] : { organization_id: null, role: null, count: r.length };
}
async function memberCount(orgId) {
  return Number((await s.sql(`select count(*)::int as n from public.organization_members where organization_id = $1`, [orgId]))[0].n);
}
async function ownOrg(userId) {
  return (await s.sql(`select id from public.organizations where personal_for = $1`, [userId]))[0]?.id ?? null;
}
async function invite(asUser, email, role = "member") {
  const token = newToken();
  const res = await s.as(asUser, `select * from public.org_invite_create($1, $2, $3)`, [email, role, sha256Hex(token)]);
  return { token, res, id: res.data?.[0]?.invite_id ?? null };
}
const accept = (asUser, token) => s.as(asUser, `select * from public.org_invite_accept($1)`, [sha256Hex(token)]);
const preview = (asUser, token) => s.as(asUser, `select * from public.org_invite_preview($1)`, [sha256Hex(token)]);
async function newClaim(asUser, orgId, name) {
  const res = await s.as(asUser, `insert into public.claims (organization_id, created_by, customer_name, step, payload) values ($1, $2, $3, 'intake', '{}') returning id`, [
    orgId,
    asUser,
    name,
  ]);
  if (res.error) throw new Error(`could not create claim ${name}: ${res.error.message}`);
  return res.data[0].id;
}
async function claimExists(id) {
  return (await s.sql(`select 1 from public.claims where id = $1`, [id])).length === 1;
}
async function pairPhone(asUser, name) {
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  const token = newToken();
  const begin = await s.as(asUser, `select * from public.device_pairing_begin($1)`, [sha256Hex(code)]);
  if (begin.error) throw new Error(`pairing_begin: ${begin.error.message}`);
  const pair = await s.as(null, `select * from public.device_pair($1, $2, $3)`, [sha256Hex(code), sha256Hex(token), name]);
  if (pair.error || rows(pair).length !== 1) throw new Error(`device_pair: ${pair.error?.message ?? "no row"}`);
  return token;
}

/* ── The cast ─────────────────────────────────────────────────────────────────────────────────── */

const owen = await s.createUser({ email: "owen@acme.test", fullName: "Owen Owner", companyName: "Acme Restoration" });
const ada = await s.createUser({ email: "ada@acme.test", fullName: "Ada Admin" });
const mel = await s.createUser({ email: "Mel@Acme.test", fullName: "Mel Member" });
const xan = await s.createUser({ email: "xan@other.test", fullName: "Xan Outsider", companyName: "Other Co" });
const nia = await s.createUser({ email: "nia@acme.test", fullName: "Nia Newcomer" });

const acme = (await membership(owen)).organization_id;
const other = (await membership(xan)).organization_id;
const adaHome = (await membership(ada)).organization_id;

console.log("  Signup");
check((await membership(owen)).role === "owner" && acme === (await ownOrg(owen)), "a signup is the owner of an organization of their own, stamped as theirs (personal_for)");
check((await s.sql(`select name from public.organizations where id = $1`, [acme]))[0].name === "Acme Restoration", "named from the company field, as 0004 named it");

/* ── Building the team through the real functions ─────────────────────────────────────────────── */

console.log("\n  Building a team");
const adaInvite = await invite(owen, "ada@acme.test", "admin");
check(adaInvite.res.error === null && adaInvite.id, `the owner invites an admin (got ${adaInvite.res.error?.message ?? "ok"})`);
const melInvite = await invite(owen, "  mel@ACME.test ", "member");
check(melInvite.res.error === null, "and a member, the address trimmed and lower-cased");
check(
  (await s.sql(`select email from public.organization_invites where id = $1`, [melInvite.id]))[0]?.email === "mel@acme.test",
  "stored as mel@acme.test",
);

{
  const res = await accept(ada, adaInvite.token);
  check(res.error === null && rows(res)[0]?.organization_id === acme && rows(res)[0]?.role === "admin", `Ada accepts and is Acme's admin (got ${res.error?.message ?? JSON.stringify(rows(res))})`);
}
{
  const res = await accept(mel, melInvite.token);
  check(res.error === null && rows(res)[0]?.role === "member", `Mel accepts — her login email's case does not matter (got ${res.error?.message ?? "ok"})`);
}
check((await membership(ada)).organization_id === acme, "Ada now belongs to Acme");
check((await memberCount(adaHome)) === 0, "and her own organization is set aside, with nobody in it");
check((await ownOrg(ada)) === adaHome, "still marked as hers, to come back to");

const claimOwen = await newClaim(owen, acme, "owen-claim");
const claimMel = await newClaim(mel, acme, "mel-claim");
const claimXan = await newClaim(xan, other, "xan-claim");

/* ── Another organization sees none of it ─────────────────────────────────────────────────────── */

console.log("\n  Cross-organization isolation");
check(!rows(await s.as(xan, `select id from public.claims`)).some((r) => r.id === claimOwen || r.id === claimMel), "Xan reads no Acme claim through an unfiltered select");
check(rows(await s.as(xan, `select id from public.claims where organization_id = $1`, [acme])).length === 0, "nor by naming Acme's id");
check(rows(await s.as(xan, `select id from public.organizations where id = $1`, [acme])).length === 0, "Xan cannot read Acme's organization row");
check(rows(await s.as(xan, `select user_id from public.organization_members where organization_id = $1`, [acme])).length === 0, "nor list its members");
check(
  rows(await s.as(xan, `select id from public.organization_invites`)).length === 0,
  "nor see its invites",
);
{
  const res = await s.as(xan, `select * from public.org_members()`);
  check(rows(res).length === 1 && rows(res)[0].user_id === xan, "org_members() lists only the caller's own organization");
}
{
  const res = await s.as(xan, `insert into public.claims (organization_id, customer_name, payload) values ($1, 'planted', '{}') returning id`, [acme]);
  check(res.error !== null, "Xan cannot plant a claim in Acme");
}
{
  const res = await s.as(xan, `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'member')`, [acme, xan]);
  check(res.error !== null, "nor add himself to Acme's membership");
}
{
  const res = await s.as(xan, `update public.claims set customer_name = 'x' where id = $1 returning id`, [claimOwen]);
  check(rows(res).length === 0, "nor update an Acme claim");
}
{
  const res = await s.as(xan, `delete from public.claims where id = $1 returning id`, [claimOwen]);
  check(rows(res).length === 0 && (await claimExists(claimOwen)), "nor delete one");
}
check(rows(await s.as(xan, `select public.org_member_remove($1) as ok`, [mel]))[0]?.ok === false, "org_member_remove on someone in another organization changes nothing (false)");
check(rows(await s.as(xan, `select public.org_member_set_role($1, 'admin') as ok`, [mel]))[0]?.ok === false, "nor does org_member_set_role");
check(rows(await s.as(xan, `select public.org_transfer_ownership($1) as ok`, [mel]))[0]?.ok === false, "nor org_transfer_ownership");
{
  const pending = await invite(owen, "pending@acme.test");
  check(rows(await s.as(xan, `select public.org_invite_revoke($1) as ok`, [pending.id]))[0]?.ok === false, "nor can Xan withdraw Acme's invite");
  check(rows(await s.as(xan, `select public.is_org_admin($1) as v`, [acme]))[0]?.v === false, "is_org_admin answers for the caller, not the argument");
  check(rows(await s.as(xan, `update public.organizations set name = 'hijacked' where id = $1 returning id`, [acme])).length === 0, "Xan cannot rewrite Acme's letterhead");
  await s.as(owen, `select public.org_invite_revoke($1)`, [pending.id]);
}

/* ── A member ─────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  A member's rights");
check(rows(await s.as(mel, `select id from public.claims where id = $1`, [claimOwen])).length === 1, "Mel reads the owner's claim — teammates cover for each other");
check(rows(await s.as(mel, `update public.claims set step = 'transcript' where id = $1 returning id`, [claimOwen])).length === 1, "and edits it");
check(rows(await s.as(mel, `delete from public.claims where id = $1 returning id`, [claimOwen])).length === 0 && (await claimExists(claimOwen)), "but cannot delete a claim she did not start");
{
  const mine = await newClaim(mel, acme, "mel-throwaway");
  check(rows(await s.as(mel, `delete from public.claims where id = $1 returning id`, [mine])).length === 1, "and can delete one she did");
}
refusedWith(await s.as(mel, `update public.claims set created_by = $2 where id = $1`, [claimOwen, mel]), "42501", "Mel cannot make herself the creator of the owner's claim (42501)");
check(rows(await s.as(mel, `delete from public.claims where id = $1 returning id`, [claimOwen])).length === 0 && (await claimExists(claimOwen)), "so that cannot become a way to delete it");
check(
  (await s.as(mel, `insert into public.claims (organization_id, created_by, customer_name, payload) values ($1, $2, 'forged', '{}') returning id`, [acme, owen])).error !== null,
  "nor start a claim in the owner's name",
);
check(rows(await s.as(mel, `update public.claims set created_by = $2, step = 'intake' where id = $1 returning id`, [claimMel, mel])).length === 1, "setting it to what it already is changes nothing and is allowed");
refusedWith((await invite(mel, "friend@x.test")).res, "42501", "Mel cannot invite (42501)");
check(rows(await s.as(mel, `select id from public.organization_invites`)).length === 0, "nor see the pending invites");
refusedWith(await s.as(mel, `select public.org_member_set_role($1, 'member')`, [ada]), "42501", "nor change a role");
refusedWith(await s.as(mel, `select public.org_member_remove($1)`, [ada]), "42501", "nor remove anyone");
refusedWith(await s.as(mel, `select public.org_transfer_ownership($1)`, [mel]), "42501", "nor take the organization");
check(rows(await s.as(mel, `update public.organizations set tagline = 'mel' where id = $1 returning id`, [acme])).length === 0, "nor change the letterhead (owner-only, 0005)");
refusedWith(await s.as(mel, `update public.organizations set subscription_tier = 'unlimited' where id = $1`, [acme]), "42501", "nor write the plan (column lockdown, 0011)");
{
  const res = await s.as(mel, `select * from public.org_members()`);
  const list = rows(res);
  check(res.error === null && list.length === 3, `org_members() lists the three of them to a member (got ${res.error?.message ?? list.length})`);
  check(list[0]?.user_id === owen && list[0]?.role === "owner" && list[0]?.email === "owen@acme.test" && list[0]?.full_name === "Owen Owner", "owner first, with name and address");
  check(list.map((r) => r.role).join(",") === "owner,admin,member", "then admins, then members");
}
{
  const res = await s.as(mel, `select subscription_tier, claims_used_this_period, trial_claims_used from public.organizations where id = $1`, [acme]);
  check(rows(res).length === 1, "a member can read the plan and the shared counter (the usage banner needs them)");
}

/* ── An admin ─────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  An admin's rights");
const niaFirst = await invite(ada, "nia@acme.test", "member");
check(niaFirst.res.error === null, `Ada invites a member (got ${niaFirst.res.error?.message ?? "ok"})`);
refusedWith((await invite(ada, "boss@acme.test", "admin")).res, "42501", "but not an admin — only the owner invites admins");
check(rows(await s.as(ada, `select id, email from public.organization_invites where id = $1`, [niaFirst.id])).length === 1, "Ada sees the pending invite");
refusedWith(await s.as(ada, `select token_hash from public.organization_invites`), "42501", "but never its hash (column grant)");
check(rows(await s.as(ada, `select public.org_invite_revoke($1) as ok`, [niaFirst.id]))[0]?.ok === true, "Ada withdraws it");
check(rows(await preview(null, niaFirst.token))[0]?.status === "revoked", "after which the link previews as withdrawn");
refusedWith(await accept(nia, niaFirst.token), "P0002", "and cannot be accepted (P0002)");
{
  const doomed = await newClaim(owen, acme, "owen-doomed");
  check(rows(await s.as(ada, `delete from public.claims where id = $1 returning id`, [doomed])).length === 1, "Ada can delete a claim someone else started");
}
refusedWith(await s.as(ada, `select public.org_member_set_role($1, 'admin')`, [mel]), "42501", "Ada cannot promote anyone — the owner manages admins");
refusedWith(await s.as(ada, `select public.org_member_remove($1)`, [owen]), "42501", "nor remove the owner");
check(rows(await s.as(ada, `update public.organizations set tagline = 'ada' where id = $1 returning id`, [acme])).length === 0, "nor change the letterhead");
refusedWith(await s.as(ada, `update public.organizations set claims_used_this_period = 0 where id = $1`, [acme]), "42501", "nor reset the claim counter");
refusedWith(await s.as(ada, `select public.org_member_remove($1)`, [ada]), "22023", "nor remove herself — that is leaving (22023)");

/* ── The owner ────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  The owner's rights");
check(rows(await s.as(owen, `select public.org_member_set_role($1, 'admin') as ok`, [mel]))[0]?.ok === true && (await membership(mel)).role === "admin", "Owen makes Mel an admin");
check(rows(await s.as(owen, `select public.org_member_set_role($1, 'member') as ok`, [mel]))[0]?.ok === true && (await membership(mel)).role === "member", "and a member again");
refusedWith(await s.as(owen, `select public.org_member_set_role($1, 'admin')`, [owen]), "22023", "but not himself (22023)");
refusedWith(await s.as(owen, `select public.org_member_set_role($1, 'owner')`, [mel]), "22023", "and never to owner — ownership is handed over (22023)");
check(rows(await s.as(owen, `update public.organizations set tagline = 'Water. Fire. Mould.' where id = $1 returning tagline`, [acme]))[0]?.tagline === "Water. Fire. Mould.", "Owen changes the letterhead");
for (const column of ["subscription_tier = 'unlimited'", "claims_used_this_period = 0", "trial_claims_used = 0", "seat_limit = 999", "stripe_customer_id = 'cus_mine'", "personal_for = null"]) {
  refusedWith(await s.as(owen, `update public.organizations set ${column} where id = $1`, [acme]), "42501", `even the owner cannot write ${column.split(" ")[0]} from the browser`);
}
refusedWith(await s.as(owen, `select public.org_leave()`), "P0411", "the owner cannot leave (P0411) — an organization always has one");

/* ── Invite tokens ────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Invite tokens");
const niaInvite = await invite(owen, "nia@acme.test", "member");
{
  const p = rows(await preview(null, niaInvite.token))[0];
  check(p?.status === "open" && p.organization_name === "Acme Restoration" && p.email === "nia@acme.test" && p.role === "member" && p.invited_by_name === "Owen Owner", "the bare anon key previews an invite from its token alone");
}
check(rows(await preview(null, newToken())).length === 0, "an unknown token previews nothing");
refusedWith(await accept(null, niaInvite.token), "42501", "the bare anon key cannot accept (no execute)");
refusedWith(await accept(xan, niaInvite.token), "P0414", "someone signed in with another address cannot accept it (P0414)");
refusedWith(await accept(nia, newToken()), "P0002", "a made-up token is no invite (P0002)");
{
  const unconfirmed = await s.createUser({ email: "late@acme.test", confirmed: false });
  const lateInvite = await invite(owen, "late@acme.test");
  refusedWith(await accept(unconfirmed, lateInvite.token), "P0414", "an account whose address is not confirmed cannot accept (P0414)");
}
const niaAgain = await invite(owen, "nia@acme.test", "member");
check(niaAgain.res.error === null, "inviting the same address again works");
check(rows(await preview(null, niaInvite.token))[0]?.status === "revoked", "and withdraws the earlier link");
refusedWith(await accept(nia, niaInvite.token), "P0002", "which can no longer be accepted");
{
  const exp = await invite(owen, "expired@acme.test");
  await s.sql(`update public.organization_invites set expires_at = now() - interval '1 minute' where id = $1`, [exp.id]);
  const expUser = await s.createUser({ email: "expired@acme.test" });
  check(rows(await preview(null, exp.token))[0]?.status === "expired", "an invite past its seven days previews as expired");
  refusedWith(await accept(expUser, exp.token), "P0002", "and cannot be accepted");
}
{
  const decliner = await s.createUser({ email: "decliner@acme.test" });
  const dec = await invite(owen, "decliner@acme.test");
  refusedWith(await s.as(null, `select public.org_invite_decline($1)`, [sha256Hex(dec.token)]), "42501", "declining needs a session");
  check(rows(await s.as(decliner, `select public.org_invite_decline($1) as ok`, [sha256Hex(dec.token)]))[0]?.ok === true, "the invited person declines");
  check(rows(await preview(null, dec.token))[0]?.status === "declined", "which the link then says");
  refusedWith(await accept(decliner, dec.token), "P0002", "and a declined invite cannot be accepted afterwards");
}
refusedWith((await invite(owen, "mel@acme.test")).res, "23505", "inviting someone already in the team is refused (23505)");
refusedWith((await invite(owen, "not-an-email")).res, "22023", "an address that is not one is refused (22023)");
refusedWith((await invite(owen, "boss@acme.test", "owner")).res, "22023", "nobody is invited as owner (22023)");
refusedWith(await s.as(owen, `select * from public.org_invite_create('x@acme.test', 'member', 'not-a-hash')`), "22023", "a token hash that is not 64 hex characters is refused (22023)");
check(
  (await s.sql(`select token_hash from public.organization_invites where id = $1`, [niaAgain.id]))[0].token_hash === sha256Hex(sha256Hex(niaAgain.token)),
  "what is stored is a hash of the hash the app sends — never the token, never what travels",
);

/* ── Joining from your own organization ───────────────────────────────────────────────────────── */

console.log("\n  Joining a team from your own organization");
const niaHome = (await membership(nia)).organization_id;
const niaClaim = await newClaim(nia, niaHome, "nia-own-claim");
const niaPhone = await pairPhone(nia, "Nia's phone");
const niaOutgoing = await invite(nia, "niasfriend@x.test");
{
  const res = await accept(nia, niaAgain.token);
  check(res.error === null && rows(res)[0]?.organization_id === acme, `Nia, alone in her own organization with no plan, accepts (got ${res.error?.message ?? "ok"})`);
}
check((await membership(nia)).organization_id === acme && (await membership(nia)).role === "member", "and is now an Acme member");
check((await memberCount(niaHome)) === 0, "her own organization is set aside");
check(rows(await s.as(nia, `select id from public.claims where id = $1`, [niaClaim])).length === 0, "her own claims stay behind it, out of her sight while she is on the team");
check(rows(await s.as(owen, `select id from public.claims where id = $1`, [niaClaim])).length === 0, "and out of the team's — they do not come into Acme");
check(rows(await s.as(null, `select * from public.device_identity($1)`, [sha256Hex(niaPhone)])).length === 0, "the phone she paired to her own organization no longer speaks for it (device_identity: not paired)");
refusedWith(await s.as(null, `select * from public.device_claims($1)`, [sha256Hex(niaPhone)]), "28000", "and lists no claims (28000)");
check((await s.sql(`select revoked_at from public.device_tokens where organization_id = $1`, [niaHome]))[0]?.revoked_at !== null, "it is revoked, not merely unreachable");
check(rows(await preview(null, niaOutgoing.token))[0]?.status === "revoked", "and the invite she had sent from her own organization is withdrawn");
refusedWith(await accept(nia, niaAgain.token), "P0002", "the accepted invite is spent (P0002)");
{
  const left = await s.as(nia, `select public.org_leave() as home`);
  check(left.error === null && rows(left)[0]?.home === niaHome, `Nia leaves and is back in her own organization (got ${left.error?.message ?? rows(left)[0]?.home})`);
  check((await membership(nia)).role === "owner", "as its owner");
  check(rows(await s.as(nia, `select id from public.claims where id = $1`, [niaClaim])).length === 1, "with her claims exactly as she left them");
}

console.log("\n  When joining is refused");
{
  await s.sql(`update public.organizations set subscription_tier = 'starter' where id = $1`, [other]);
  const xanInvite = await invite(owen, "xan@other.test");
  refusedWith(await accept(xan, xanInvite.token), "P0412", "someone whose own organization has a live plan must cancel it first (P0412)");
  await s.sql(`update public.organizations set subscription_tier = 'scan' where id = $1`, [other]);
  refusedWith(await accept(xan, xanInvite.token), "P0412", "the Scan plan too — it would go on billing an empty organization");
  await s.sql(`update public.organizations set subscription_tier = null where id = $1`, [other]);
  check((await membership(xan)).organization_id === other, "and nothing moved");
  await s.as(owen, `select public.org_invite_revoke($1)`, [xanInvite.id]);
}
{
  const toOther = await invite(xan, "mel@acme.test");
  refusedWith(await accept(mel, toOther.token), "P0410", "someone on another team must leave it first (P0410)");
  const ownerOut = await invite(xan, "owen@acme.test");
  refusedWith(await accept(owen, ownerOut.token), "P0411", "the owner of a team must hand it over first (P0411)");
  check((await membership(mel)).organization_id === acme && (await membership(owen)).organization_id === acme, "and both are still in Acme");
}

/* ── Seats ────────────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Seats");
{
  const before = await memberCount(acme);
  await s.sql(`update public.organization_invites set revoked_at = now() where organization_id = $1 and accepted_at is null and declined_at is null and revoked_at is null`, [acme]);
  await s.sql(`update public.organizations set seat_limit = $2 where id = $1`, [acme, before + 1]);
  const seatA = await invite(owen, "seat-a@acme.test");
  check(seatA.res.error === null, `with one seat free, an invite goes out (got ${seatA.res.error?.message ?? "ok"})`);
  refusedWith((await invite(owen, "seat-b@acme.test")).res, "P0402", "a second is refused while the first holds the last seat (P0402)");
  const seatAUser = await s.createUser({ email: "seat-a@acme.test" });
  check((await accept(seatAUser, seatA.token)).error === null, "the first is accepted into the last seat");
  await s.sql(`update public.organizations set seat_limit = null where id = $1`, [acme]);
  const seatC = await invite(owen, "seat-c@acme.test");
  await s.sql(`update public.organizations set seat_limit = $2 where id = $1`, [acme, await memberCount(acme)]);
  const seatCUser = await s.createUser({ email: "seat-c@acme.test" });
  refusedWith(await accept(seatCUser, seatC.token), "P0402", "an invite sent before the limit fell cannot be accepted past it");
  await s.sql(`update public.organizations set seat_limit = null where id = $1`, [acme]);
  check((await memberCount(acme)) === before + 1, "Acme has exactly the one extra person");
  check(rows(await s.as(owen, `select public.org_member_remove($1) as ok`, [seatAUser]))[0]?.ok === true, "(who the owner then removes)");
}

/* ── The daily limit ──────────────────────────────────────────────────────────────────────────── */

console.log("\n  Twenty invites a day");
{
  // Xan has sent some today already; withdrawn ones count too, or withdrawing would reset the limit.
  const sent = (await s.sql(`select count(*)::int as n from public.organization_invites where organization_id = $1`, [other]))[0].n;
  let firstRefusal = null;
  for (let i = sent + 1; i <= 21 && firstRefusal === null; i++) {
    const r = await invite(xan, `spam${i}@x.test`);
    if (r.res.error) firstRefusal = { i, code: r.res.error.code };
    else if (i % 2 === 0) await s.as(xan, `select public.org_invite_revoke($1)`, [r.id]);
  }
  check(firstRefusal?.i === 21 && firstRefusal.code === "P0429", `the 21st invite in a day is refused (P0429), withdrawn ones counted (got ${JSON.stringify(firstRefusal)})`);
}

/* ── Removal, phones and the claims list rule ─────────────────────────────────────────────────── */

console.log("\n  Removal and paired phones");
const melPhone = await pairPhone(mel, "Mel's phone");
const adaPhone = await pairPhone(ada, "Ada's phone");
{
  const ident = rows(await s.as(null, `select * from public.device_identity($1)`, [sha256Hex(melPhone)]))[0];
  check(ident?.organization_id === acme && ident?.role === "member", "Mel's phone speaks for her in Acme");
  const melList = rows(await s.as(null, `select id, mine from public.device_claims($1)`, [sha256Hex(melPhone)]));
  check(melList.length > 0 && melList.every((c) => c.mine), "on the phone a member sees the claims she started");
  const adaList = rows(await s.as(null, `select id from public.device_claims($1)`, [sha256Hex(adaPhone)]));
  check(adaList.some((c) => c.id === claimOwen) && adaList.some((c) => c.id === claimMel), "an admin's phone sees the whole organization, like the owner's");
}
{
  const res = await s.as(ada, `select public.org_member_remove($1) as ok`, [mel]);
  check(rows(res)[0]?.ok === true, `Ada removes Mel (got ${res.error?.message ?? "ok"})`);
  const melNow = await membership(mel);
  check(melNow.organization_id === (await ownOrg(mel)) && melNow.role === "owner", "Mel is back in her own organization, as its owner");
  check(rows(await s.as(null, `select * from public.device_identity($1)`, [sha256Hex(melPhone)])).length === 0, "her phone no longer speaks for her in Acme");
  refusedWith(await s.as(null, `select * from public.device_claims($1)`, [sha256Hex(melPhone)]), "28000", "nor lists Acme's claims (28000)");
  check(rows(await s.as(owen, `select created_by from public.claims where id = $1`, [claimMel]))[0]?.created_by === mel, "the claims she started stay with Acme, still hers by name");
  check(rows(await s.as(mel, `select id from public.claims where id = $1`, [claimMel])).length === 0, "and out of her reach now");
}
{
  // Owen invites Mel back as an admin, and Ada (an admin) may not remove her.
  const back = await invite(owen, "mel@acme.test", "admin");
  check((await accept(mel, back.token)).error === null && (await membership(mel)).role === "admin", "Mel comes back as an admin");
  refusedWith(await s.as(ada, `select public.org_member_remove($1)`, [mel]), "42501", "an admin cannot remove another admin");
  check(rows(await s.as(owen, `select public.org_member_remove($1) as ok`, [mel]))[0]?.ok === true, "the owner can");
}

/* ── Handing over ─────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Handing the organization over");
{
  const owenCreated = (await s.sql(`select created_at from public.profiles where id = $1`, [owen]))[0].created_at;
  check(rows(await s.as(owen, `select public.org_transfer_ownership($1) as ok`, [ada]))[0]?.ok === true, "Owen hands Acme to Ada");
  check((await membership(ada)).role === "owner" && (await membership(owen)).role === "admin", "Ada is the owner; Owen an admin");
  check((await s.sql(`select count(*)::int as n from public.organization_members where organization_id = $1 and role = 'owner'`, [acme]))[0].n === 1, "and Acme still has exactly one owner");
  refusedWith(await s.as(owen, `select public.org_transfer_ownership($1)`, [ada]), "42501", "Owen cannot hand back what is no longer his");
  const left = await s.as(owen, `select public.org_leave() as home`);
  const home = rows(left)[0]?.home;
  check(left.error === null && home && home !== acme, `Owen leaves — Acme, which he founded, is the team's now — into a new organization (got ${left.error?.message ?? home})`);
  check((await s.sql(`select personal_for from public.organizations where id = $1`, [acme]))[0].personal_for === null, "Acme stops being marked as Owen's own");
  const fresh = (await s.sql(`select personal_for, trial_started_at, trial_claims_used, subscription_tier from public.organizations where id = $1`, [home]))[0];
  check(fresh.personal_for === owen && (await membership(owen)).role === "owner", "the new one is his, and he owns it");
  check(new Date(fresh.trial_started_at).getTime() === new Date(owenCreated).getTime() && fresh.trial_claims_used === 0 && fresh.subscription_tier === null, "its trial window counts from when his account was made, not from today");
  check(rows(await s.as(owen, `select id from public.claims where id = $1`, [claimOwen])).length === 0, "and Acme's claims stay with Acme");
}

/* ── Alone, as before ─────────────────────────────────────────────────────────────────────────── */

console.log("\n  Alone in an organization, nothing changed");
check(rows(await s.as(xan, `delete from public.claims where id = $1 returning id`, [claimXan])).length === 1, "Xan, alone, deletes his own claim as he always could");
{
  const theirs = await newClaim(xan, other, "xan-two");
  await s.sql(`update public.claims set created_by = null where id = $1`, [theirs]);
  check(rows(await s.as(xan, `delete from public.claims where id = $1 returning id`, [theirs])).length === 1, "and one whose creator is gone, because he is the owner");
}

/* ── An account deleted ───────────────────────────────────────────────────────────────────────── */

console.log("\n  An account deleted");
{
  const temp = await s.createUser({ email: "temp@acme.test", fullName: "Temp" });
  const tempInvite = await invite(ada, "temp@acme.test");
  check((await accept(temp, tempInvite.token)).error === null, "a temporary member joins Acme");
  const tempClaim = await newClaim(temp, acme, "temp-claim");
  let deleteError = null;
  try {
    await s.sql(`delete from auth.users where id = $1`, [temp]);
  } catch (err) {
    deleteError = err;
  }
  check(deleteError === null, `deleting their account works, though it clears who started their claims (got ${deleteError?.message ?? "ok"})`);
  const left = (await s.sql(`select created_by from public.claims where id = $1`, [tempClaim]))[0];
  check(left && left.created_by === null, "their claim stays with Acme, its creator now nobody");
  check(rows(await s.as(ada, `delete from public.claims where id = $1 returning id`, [tempClaim])).length === 1, "and an admin can still delete it");
}

/* ── Claim photos (0015) ──────────────────────────────────────────────────────────────────────── */

console.log("\n  Claim photos");
{
  const bucket = (await s.sql(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'claim-photos'`))[0];
  check(bucket && bucket.public === false && Number(bucket.file_size_limit) === 2097152 && JSON.stringify(bucket.allowed_mime_types) === '["image/jpeg"]', "the claim-photos bucket is private, 2 MB, JPEG only");

  const path = `${acme}/${claimOwen}/00000000-0000-4000-8000-000000000001.jpg`;
  const thumb = `${acme}/${claimOwen}/00000000-0000-4000-8000-000000000001.thumb.jpg`;
  const insert = (asUser, name) => s.as(asUser, `insert into storage.objects (bucket_id, name) values ('claim-photos', $1) returning id`, [name], { rollback: true });
  // Ada owns Acme by now; Owen handed it over and left, and Mel was removed (above).
  check((await insert(ada, path)).error !== null, "a member cannot write a photo into the bucket with their own key — only the server can");
  check((await insert(xan, path)).error !== null, "nor can another organization's");
  check((await insert(null, path)).error !== null, "nor the anon key");
  check((await s.service(`insert into storage.objects (bucket_id, name) values ('claim-photos', $1), ('claim-photos', $2)`, [path, thumb])).error === null, "the service role stores both parts");

  const visible = async (asUser) => rows(await s.as(asUser, `select name from storage.objects where bucket_id = 'claim-photos' order by name`)).map((r) => r.name);
  check(JSON.stringify(await visible(ada)) === JSON.stringify([path, thumb].sort()), "the claim's organization reads them");
  const pia = await s.createUser({ email: "pia@acme.test", fullName: "Pia Photographer" });
  const piaInvite = await invite(ada, "pia@acme.test");
  check((await accept(pia, piaInvite.token)).error === null && (await visible(pia)).length === 2, "every member of it does, a new one included, not only whoever took them");
  check((await visible(mel)).length === 0, "and a member who was removed from it reads none");
  check((await visible(owen)).length === 0, "someone who has left the organization reads none of them");
  check((await visible(xan)).length === 0, "another organization reads none of them");
  check((await visible(null)).length === 0, "and the anon key none");
  check(
    rows(await s.as(xan, `select name from storage.objects where bucket_id = 'claim-photos' and name like $1`, [`${acme}/%`])).length === 0,
    "not even by naming Acme's folder",
  );

  const removed = await s.as(ada, `delete from storage.objects where bucket_id = 'claim-photos' returning name`, [], { rollback: true });
  check(rows(removed).length === 0, `a member cannot delete them with their own key — deletes go through the server (got ${removed.error?.message ?? rows(removed).length})`);
  const moved = await s.as(ada, `update storage.objects set name = $1 where bucket_id = 'claim-photos' returning name`, [`${other}/x.jpg`], { rollback: true });
  check(rows(moved).length === 0, "nor rename one into another organization's folder");
  const stray = await s.service(`insert into storage.objects (bucket_id, name) values ('claim-photos', 'not-a-uuid/x/y.jpg') returning id`);
  check(stray.error === null && (await visible(ada)).length === 2, "a picture in a folder that is no organization is nobody's");
}

/* ── Exterior requests (0016): Send to Scrivn team ────────────────────────────────────────────── */

console.log("\n  Exterior requests");
{
  // Ada owns Acme by now; Mel was removed and Owen left (above). Rae joins Acme for this.
  const rae = await s.createUser({ email: "rae@acme.test", fullName: "Rae Roofer" });
  check((await accept(rae, (await invite(ada, "rae@acme.test")).token)).error === null, "Rae joins Acme");
  const acmeClaim = await newClaim(ada, acme, "exterior-claim");
  const xanClaim = await newClaim(xan, other, "xan-exterior");
  const route = { format: "scrivn-photo-route/1", photos: [{ id: "p1", width: 2000, height: 1500 }], buildings: [{ id: "main", outline: [], corners: [], tapes: [] }] };
  /** An insert as the browser would send it: only the columns it names. */
  const file = (asUser, cols, opts) =>
    s.as(
      asUser,
      `insert into public.exterior_requests (${Object.keys(cols).join(", ")}) values (${Object.keys(cols).map((_, i) => `$${i + 1}`).join(", ")}) returning id, user_id, status, organization_id`,
      Object.values(cols).map((v) => (v && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v)),
      opts,
    );
  const inputs = (claimId, orgId, extra = {}) => ({ claim_id: claimId, organization_id: orgId, building: "house", photo_ids: ["p1"], route, note: "Side yard is tight", ...extra });

  const sent = await file(rae, inputs(acmeClaim, acme));
  const req = rows(sent)[0];
  check(sent.error === null && req?.user_id === rae && req?.status === "sent" && req?.organization_id === acme, `a member sends a house of her organization's claim, as herself, as sent (got ${sent.error?.message ?? JSON.stringify(req)})`);
  const shed = await file(rae, inputs(acmeClaim, acme, { building: "building-mq1x-3", building_name: "Shed" }));
  check(shed.error === null, "and another building on it");

  refusedWith(await file(rae, inputs(acmeClaim, acme, { user_id: ada }), { rollback: true }), "42501", "she cannot send one in someone else's name (column not granted)");
  refusedWith(await file(rae, inputs(acmeClaim, acme, { status: "ready" }), { rollback: true }), "42501", "nor send one already ready");
  refusedWith(await file(rae, inputs(acmeClaim, acme, { result: { sides: [] } }), { rollback: true }), "42501", "nor plant a result");
  check((await file(rae, inputs(xanClaim, acme), { rollback: true })).error !== null, "nor file another organization's claim under her own");
  check((await file(xan, inputs(acmeClaim, acme), { rollback: true })).error !== null, "Xan cannot send Acme's claim, naming Acme");
  check((await file(xan, inputs(acmeClaim, other), { rollback: true })).error !== null, "nor naming his own organization");
  check((await file(null, inputs(acmeClaim, acme), { rollback: true })).error !== null, "nor can the anon key send one");

  const read = async (asUser) => rows(await s.as(asUser, `select id from public.exterior_requests`)).map((r) => r.id);
  check((await read(ada)).includes(req.id) && (await read(rae)).length === 2, "Acme's members read Acme's requests, whoever sent them");
  check((await read(xan)).length === 0, "another organization reads none of them");
  check(rows(await s.as(xan, `select id from public.exterior_requests where id = $1`, [req.id])).length === 0, "not even by naming one");
  check((await read(mel)).length === 0, "a member who was removed reads none");
  check((await read(null)).length === 0, "nor does the anon key");

  refusedWith(await s.as(rae, `update public.exterior_requests set status = 'ready' where id = $1`, [req.id], { rollback: true }), "42501", "a member cannot set a status herself");
  refusedWith(await s.as(rae, `update public.exterior_requests set result = '{}'::jsonb where id = $1`, [req.id], { rollback: true }), "42501", "nor write a result");
  refusedWith(await s.as(rae, `delete from public.exterior_requests where id = $1`, [req.id], { rollback: true }), "42501", "nor delete a request");

  const withdraw = (asUser, id) => s.as(asUser, `select public.exterior_request_withdraw($1) as ok`, [id]);
  const applied = (asUser, id) => s.as(asUser, `select public.exterior_request_applied($1) as ok`, [id]);
  const statusOf = async (id) => (await s.sql(`select status, result, withdrawn_at, applied_at from public.exterior_requests where id = $1`, [id]))[0];

  check(rows(await withdraw(xan, req.id))[0]?.ok === false && (await statusOf(req.id)).status === "sent", "Xan cannot withdraw Acme's request (false, unchanged)");
  check(rows(await applied(rae, req.id))[0]?.ok === false, "a request not measured yet cannot be marked used");
  refusedWith(await withdraw(null, req.id), "42501", "the anon key cannot call withdraw");
  refusedWith(await applied(null, req.id), "42501", "nor applied");

  // Ours: the scripts, with the service role.
  const result = { sides: [{ id: "s1", name: "Front", lengthFeet: 30 }], roof: {} };
  check((await s.service(`update public.exterior_requests set status = 'measuring', measuring_at = now() where id = $1`, [req.id])).error === null, "the service role marks it measuring");
  check(
    (await s.service(`update public.exterior_requests set status = 'ready', ready_at = now(), result = $2 where id = $1`, [req.id, JSON.stringify(result)])).error === null &&
      (await statusOf(req.id)).result?.sides?.[0]?.lengthFeet === 30,
    "and returns the measured exterior as ready",
  );
  check(rows(await s.as(ada, `select status, result from public.exterior_requests where id = $1`, [req.id]))[0]?.status === "ready", "which the organization reads");
  check(rows(await applied(xan, req.id))[0]?.ok === false && (await statusOf(req.id)).status === "ready", "Xan cannot mark it used");
  check(rows(await applied(rae, req.id))[0]?.ok === true && (await statusOf(req.id)).status === "applied" && (await statusOf(req.id)).applied_at !== null, "Rae marks it used after Use it");
  check(rows(await withdraw(rae, req.id))[0]?.ok === false && (await statusOf(req.id)).status === "applied", "a used one cannot be withdrawn after");
  check(rows(await applied(rae, req.id))[0]?.ok === false, "nor marked used twice");

  const shedId = rows(shed)[0].id;
  check(rows(await withdraw(ada, shedId))[0]?.ok === true && (await statusOf(shedId)).status === "withdrawn" && (await statusOf(shedId)).withdrawn_at !== null, "any member withdraws one still waiting");
  check(rows(await withdraw(ada, shedId))[0]?.ok === false, "once");
  check((await s.service(`update public.exterior_requests set status = 'lost' where id = $1`, [shedId])).error !== null, "a status that is none of the five is refused, even to the service role");
  check((await file(rae, inputs(acmeClaim, acme, { note: "x".repeat(2001) }), { rollback: true })).error !== null, "a note over 2,000 characters is refused");
  check((await file(rae, inputs(acmeClaim, acme, { photo_ids: [] }), { rollback: true })).error !== null, "and a request with no photos");

  const doomed = await newClaim(ada, acme, "exterior-doomed");
  const gone = rows(await file(rae, inputs(doomed, acme)))[0]?.id;
  check(rows(await s.as(ada, `delete from public.claims where id = $1 returning id`, [doomed])).length === 1 && (await s.sql(`select 1 from public.exterior_requests where id = $1`, [gone])).length === 0, "deleting a claim deletes its requests");
}

/* ── Who can call what ────────────────────────────────────────────────────────────────────────── */

console.log("\n  Function grants");
const privileged = [
  ["org_invite_create(text, text, text)", false, true],
  ["org_invite_accept(text)", false, true],
  ["org_invite_decline(text)", false, true],
  ["org_invite_revoke(uuid)", false, true],
  ["org_invite_preview(text)", true, true],
  ["org_members()", false, true],
  ["org_member_set_role(uuid, text)", false, true],
  ["org_member_remove(uuid)", false, true],
  ["org_leave()", false, true],
  ["org_transfer_ownership(uuid)", false, true],
  ["is_org_admin(uuid)", false, true],
  ["org_depart(uuid, uuid)", false, false],
  ["org_return_home(uuid)", false, false],
  ["org_count_claim(uuid, boolean)", false, false],
  ["mirror_profile_billing()", false, false],
  ["claims_keep_creator()", false, false],
  ["exterior_request_withdraw(uuid)", false, true],
  ["exterior_request_applied(uuid)", false, true],
  ["exterior_requests_touch()", false, false],
];
for (const [fn, anon, authed] of privileged) {
  const r = (await s.sql(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a, has_function_privilege('authenticated', 'public.${fn}', 'execute') as b`))[0];
  check(r.a === anon && r.b === authed, `${fn}: anon ${anon ? "may" : "may not"}, authenticated ${authed ? "may" : "may not"} (got anon ${r.a}, authenticated ${r.b})`);
}

/* ── Invariants ───────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Invariants after all of that");
check((await s.sql(`select user_id from public.organization_members group by user_id having count(*) > 1`)).length === 0, "nobody belongs to two organizations");
check(
  (await s.sql(`select m.organization_id from public.organization_members m group by m.organization_id having count(*) filter (where m.role = 'owner') <> 1`)).length === 0,
  "every organization with people in it has exactly one owner",
);
check(
  (await s.sql(`select u.id from auth.users u where not exists (select 1 from public.organization_members m where m.user_id = u.id)`)).length === 0,
  "and everyone belongs to one",
);

/* ── Running the migrations again ─────────────────────────────────────────────────────────────── */

console.log("\n  Re-running the new migrations");
{
  const { from } = splitMigrationsAt(root, "_org_billing.sql");
  const snapshot = JSON.stringify(await s.sql(`select organization_id, user_id, role from public.organization_members order by user_id`));
  await s.sql(`update public.organizations set trial_claims_used = 4 where id = $1`, [other]);
  let ok = true;
  for (const m of from) {
    try {
      await s.applyMigration(m);
    } catch (err) {
      ok = false;
      console.log(`    ${err.message}`);
    }
  }
  check(ok, `${from.map((m) => m.name).join(" and ")} run a second time without error`);
  check(JSON.stringify(await s.sql(`select organization_id, user_id, role from public.organization_members order by user_id`)) === snapshot, "leaving every membership as it was");
  check((await s.sql(`select trial_claims_used from public.organizations where id = $1`, [other]))[0].trial_claims_used === 4, "and not copying the old profile counters over the organization's again");
}

await s.close();

/* ── 0015 on what production has ────────────────────────────────────────────────────────── */

/*
  Production has 0001-0010; 0011-0014 (teams, billing, Scan accounts) are written but not applied. So
  the photo bucket must stand on 0004 and 0005 alone: pasted straight after 0010, it has to work the same.
*/
console.log("\n  Claim photos on what production has");
{
  const p = await startSupabaseLocal();
  const without = migrationFiles(root).filter((m) => Number(m.name.slice(0, 4)) <= 10 || m.name.endsWith("_claim_photos.sql"));
  let applied = true;
  for (const m of without) {
    try {
      await p.applyMigration(m);
    } catch (err) {
      applied = false;
      console.log(`    ${err.message}`);
    }
  }
  check(applied && without.some((m) => m.name.endsWith("_claim_photos.sql")), `the photo migration applies straight after 0010, with 0011-0014 left out (${without.length} migrations)`);
  const a = await p.createUser({ email: "a@one.test", companyName: "One" });
  const b = await p.createUser({ email: "b@two.test", companyName: "Two" });
  const orgOf = async (u) => (await p.sql(`select organization_id from public.organization_members where user_id = $1`, [u]))[0]?.organization_id;
  const name = `${await orgOf(a)}/22222222-2222-4222-8222-222222222222/00000000-0000-4000-8000-000000000009.jpg`;
  check((await p.service(`insert into storage.objects (bucket_id, name) values ('claim-photos', $1)`, [name])).error === null, "the server stores a photo");
  const reads = async (u) => (await p.as(u, `select name from storage.objects where bucket_id = 'claim-photos'`)).data?.length ?? 0;
  check((await reads(a)) === 1 && (await reads(b)) === 0, "its organization reads it, another does not");
  check((await p.as(a, `insert into storage.objects (bucket_id, name) values ('claim-photos', $1)`, [name.replace("9.jpg", "8.jpg")], { rollback: true })).error !== null, "and nobody writes with their own key");
  await p.close();
}

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  console.error("  A FAILURE HERE IS A DATA LEAK OR A BROKEN TEAM RULE. Do not apply these migrations until every check passes.\n");
  process.exit(1);
}
