/**
 * Team accounts: the rules the Team section offers, held to the database that enforces them.
 *
 *   npm run test:teams
 *
 * Three parts:
 *
 *   1. lib/teams.ts as the decisions it makes — who may invite, change roles, remove, hand over and
 *      leave; what an address must look like.
 *   2. lib/teams.ts against the text of 0012_teams.sql — every SQLSTATE the functions raise has a
 *      sentence, and the 7 days and 20 a day are the same numbers on both sides.
 *   3. The whole matrix, actor by target by action, against the real functions in a Postgres in
 *      memory (test/db/supabaseLocal.mjs), each probe rolled back: the buttons the Team section
 *      shows are exactly the actions the database allows — no button that will be refused, and no
 *      action allowed that the page would not offer.
 *
 * Isolation between organizations and the invite-token rules are test/rls/local.mjs's.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrationFiles, newToken, sha256Hex, startSupabaseLocal } from "../db/supabaseLocal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "teams-tests-"));
const bundlePath = join(outDir, "bundle.mjs");
await build({
  stdin: { contents: `export * from "@/lib/teams";`, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root },
  logLevel: "error",
});
const T = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}

/* ── 1. The rules ─────────────────────────────────────────────────────────────────────────────── */

check(T.canInvite("owner", "admin") && T.canInvite("owner", "member"), "the owner invites admins and members");
check(T.canInvite("admin", "member") && !T.canInvite("admin", "admin"), "an admin invites members, not admins");
check(!T.canInvite("member", "member") && !T.canInvite(null, "member"), "a member invites nobody");
check(T.canChangeRole("owner", "admin", false) && T.canChangeRole("owner", "member", false), "the owner changes an admin's or a member's role");
check(!T.canChangeRole("owner", "owner", true) && !T.canChangeRole("admin", "member", false) && !T.canChangeRole("member", "member", false), "nobody else changes roles, and the owner not their own");
check(T.canRemove("owner", "admin", false) && T.canRemove("owner", "member", false) && T.canRemove("admin", "member", false), "the owner removes admins and members; an admin removes members");
check(!T.canRemove("admin", "admin", false) && !T.canRemove("admin", "owner", false) && !T.canRemove("owner", "owner", true) && !T.canRemove("member", "member", false), "and nobody removes the owner, an admin removes no admin, a member removes nobody");
check(!T.canRemove("owner", "member", true) && !T.canRemove("admin", "admin", true), "removing yourself is leaving, not removing");
check(T.canLeave("admin") && T.canLeave("member") && !T.canLeave("owner"), "admins and members may leave; the owner hands over first");
check(T.canTransferTo("owner", false) && !T.canTransferTo("owner", true) && !T.canTransferTo("admin", false), "only the owner hands over, and not to themselves");
check(T.canManageBilling("owner") && !T.canManageBilling("admin") && !T.canManageBilling("member") && !T.canManageBilling(null), "only the owner manages billing");
check(T.seesWholeOrganization("owner") && T.seesWholeOrganization("admin") && !T.seesWholeOrganization("member"), "owner and admins see every claim by default; a member their own");
check(T.canManageInvites("owner") && T.canManageInvites("admin") && !T.canManageInvites("member"), "owner and admins manage invitations");

check(T.normaliseInviteEmail("  Pat@Acme.CA ") === "pat@acme.ca", "an address is trimmed and lower-cased, as the database stores it");
for (const bad of ["", "pat", "pat@", "@acme.ca", "pat@acme", "pat smith@acme.ca", "a@b@c.ca", 42, null, `${"x".repeat(250)}@acme.ca`]) {
  check(T.normaliseInviteEmail(bad) === null, `${JSON.stringify(bad).slice(0, 30)} is not an address`);
}
check(T.isInviteRole("member") && T.isInviteRole("admin") && !T.isInviteRole("owner") && !T.isInviteRole("boss"), "nobody is invited as owner");
check(T.isOrgRole("owner") && T.isOrgRole("admin") && T.isOrgRole("member") && !T.isOrgRole("guest"), "the three roles, and no others");
for (const status of ["accepted", "declined", "revoked", "expired"]) check(typeof T.inviteStatusMessage(status) === "string", `the invite page has words for an invitation ${status}`);
check(T.inviteStatusMessage("open") === null, "and none for one still open");

/* ── 2. The same numbers and codes as the SQL ─────────────────────────────────────────────────── */

const teamsSql = migrationFiles(root).find((m) => m.name.endsWith("_teams.sql"))?.sql ?? "";
check(teamsSql.length > 0, "the teams migration is there to read");
const raised = new Set([...teamsSql.matchAll(/errcode = '([0-9A-Z]{5})'/g)].map((m) => m[1]));
check(raised.size >= 10, `the functions raise their codes as documented (found ${[...raised].join(", ")})`);
for (const code of raised) check(T.teamErrorFor(code) !== null, `SQLSTATE ${code}, raised in 0012, has a sentence and a status in lib/teams.ts`);
check(new RegExp(`now\\(\\) \\+ interval '${T.INVITE_TTL_DAYS} days'`).test(teamsSql), `INVITE_TTL_DAYS (${T.INVITE_TTL_DAYS}) is the expiry org_invite_create sets`);
check(new RegExp(`interval '1 day'\\) >= ${T.INVITES_PER_DAY}`).test(teamsSql), `INVITES_PER_DAY (${T.INVITES_PER_DAY}) is the limit org_invite_create holds`);

/* ── 3. The matrix, against the database ──────────────────────────────────────────────────────── */

const s = await startSupabaseLocal();
for (const m of migrationFiles(root)) await s.applyMigration(m);

const owner = await s.createUser({ email: "owner@t.test", fullName: "Owner", companyName: "Matrix Co" });
const people = { owner };
async function joinTeam(email, role) {
  const token = newToken();
  const inv = await s.as(owner, `select * from public.org_invite_create($1, $2, $3)`, [email, role, sha256Hex(token)]);
  if (inv.error) throw new Error(`invite ${email}: ${inv.error.message}`);
  const id = await s.createUser({ email, fullName: email.split("@")[0] });
  const acc = await s.as(id, `select * from public.org_invite_accept($1)`, [sha256Hex(token)]);
  if (acc.error) throw new Error(`accept ${email}: ${acc.error.message}`);
  return id;
}
people.admin = await joinTeam("admin@t.test", "admin");
people.admin2 = await joinTeam("admin2@t.test", "admin");
people.member = await joinTeam("member@t.test", "member");
people.member2 = await joinTeam("member2@t.test", "member");

const roleOf = { owner: "owner", admin: "admin", admin2: "admin", member: "member", member2: "member" };
/** Did the call do the thing? A row, true, or an id — not an error, not false. */
const allowed = (res) => res.error === null && rows0(res) !== false && rows0(res) !== null;
const rows0 = (res) => {
  const r = res.data?.[0];
  if (!r) return null;
  const v = Object.values(r)[0];
  return v === undefined ? null : v;
};

let probes = 0;
for (const actor of ["owner", "admin", "member"]) {
  for (const target of ["owner", "admin2", "member2", actor]) {
    const isSelf = target === actor;
    const targetRole = roleOf[target];
    const id = people[target];

    const remove = await s.as(people[actor], `select public.org_member_remove($1)`, [id], { rollback: true });
    check(allowed(remove) === T.canRemove(roleOf[actor], targetRole, isSelf), `${actor} removing ${isSelf ? "themselves" : target}: database ${allowed(remove) ? "allows" : "refuses"}, page ${T.canRemove(roleOf[actor], targetRole, isSelf) ? "offers" : "does not offer"}`);

    for (const to of ["admin", "member"]) {
      const res = await s.as(people[actor], `select public.org_member_set_role($1, $2)`, [id, to], { rollback: true });
      const offered = T.canChangeRole(roleOf[actor], targetRole, isSelf);
      check(allowed(res) === offered, `${actor} making ${isSelf ? "themselves" : target} ${to}: database ${allowed(res) ? "allows" : "refuses"}, page ${offered ? "offers" : "does not offer"}`);
    }

    const transfer = await s.as(people[actor], `select public.org_transfer_ownership($1)`, [id], { rollback: true });
    const offersTransfer = T.canTransferTo(roleOf[actor], isSelf) && targetRole !== "owner";
    check(allowed(transfer) === offersTransfer, `${actor} handing over to ${isSelf ? "themselves" : target}: database ${allowed(transfer) ? "allows" : "refuses"}, page ${offersTransfer ? "offers" : "does not offer"}`);
    probes += 4;
  }

  for (const as of ["member", "admin"]) {
    const res = await s.as(people[actor], `select * from public.org_invite_create($1, $2, $3)`, [`probe-${actor}-${as}@t.test`, as, sha256Hex(newToken())], { rollback: true });
    check(allowed(res) === T.canInvite(roleOf[actor], as), `${actor} inviting an ${as}: database ${allowed(res) ? "allows" : "refuses"}, page ${T.canInvite(roleOf[actor], as) ? "offers" : "does not offer"}`);
    probes += 1;
  }

  const leave = await s.as(people[actor], `select public.org_leave()`, [], { rollback: true });
  check(allowed(leave) === T.canLeave(roleOf[actor]), `${actor} leaving: database ${allowed(leave) ? "allows" : "refuses"}, page ${T.canLeave(roleOf[actor]) ? "offers" : "does not offer"}`);
  probes += 1;
}
check(probes === 57, `every probe ran (${probes})`);
{
  const memberships = await s.sql(`select count(*)::int as n from public.organization_members where organization_id = (select organization_id from public.organization_members where user_id = $1)`, [owner]);
  check(memberships[0].n === 5, "and every probe was rolled back: the team is as it was built");
}

await s.close();
rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  teams: ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
