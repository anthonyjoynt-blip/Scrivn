/**
 * Can one organization reach another's claims? Asked directly, with two real accounts.
 *
 *   npm run test:rls
 *
 * ── Why this is a real script and not a unit test ────────────────────────────────────────────────
 *
 * Row Level Security is enforced by Postgres, not by this codebase. Nothing in TypeScript can test
 * it: the policies are the security boundary, and the only way to know they hold is to sign in as
 * two different people against the real database and try to cross it.
 *
 * It talks to Supabase with the ANON key and a real session — exactly what a browser has. That
 * matters: the anon key is public, shipped to every visitor, and anyone holding it can issue
 * arbitrary PostgREST queries. So the queries below are deliberately NOT limited to the ones the UI
 * happens to make. The UI is not the attack surface; the key is.
 *
 * ── Setup ───────────────────────────────────────────────────────────────────────────────────────
 *
 * Apply supabase/migrations/0004_organizations_and_claims.sql and 0005_letterhead.sql first, create two
 * throwaway accounts,
 * then:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=...       (already in .env.local)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=...  (already in .env.local)
 *   RLS_USER_A_EMAIL=...  RLS_USER_A_PASSWORD=...
 *   RLS_USER_B_EMAIL=...  RLS_USER_B_PASSWORD=...
 *
 * Use accounts created for this. The script writes and deletes a claim under A, and tries hard to
 * read and destroy it as B — point it at real customer data and a failing policy means a real
 * deletion.
 *
 * ── Reading the result ──────────────────────────────────────────────────────────────────────────
 *
 * Every check is phrased so that PASS means "B could not". A row count of zero is a pass; an error
 * from Postgres is also a pass. What fails is B getting data back, or a write succeeding.
 *
 * Note that RLS makes another organization's row INVISIBLE rather than forbidden — so a blocked read
 * looks like an empty result and a blocked update looks like zero rows changed, not like an error.
 * The checks below treat both as the pass, and specifically assert on the DATA, never on the absence
 * of an error, because "no error" alone would pass even if the row came back.
 *
 * ── Teams (0011_org_billing.sql, 0012_teams.sql) ────────────────────────────────────────────────
 *
 * Once those two are applied to the project, a last section runs: A invites B, B joins A's
 * organization as a member and is held to a member's rights, A makes B an admin and back, B leaves
 * and is checked to be back in their own organization. It is skipped, saying so, until then.
 * test/rls/local.mjs asks the same questions and many more of every migration in a local Postgres,
 * and can be run before anything is applied here.
 *
 * What it leaves behind, because nothing can be deleted from the browser: the invitations (accepted
 * or withdrawn) in A's organization, and B's paired phones revoked — joining a team unpairs a
 * person's phones from their own organization. Each run sends three invitations from A's
 * organization, against a limit of twenty a day.
 */

import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/* ── Config ─────────────────────────────────────────────────────────────────────────────────────── */

// .env.local is not loaded by node the way Next loads it; read it directly so the two Supabase
// values do not have to be repeated on the command line.
function envFromDotLocal() {
  const out = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      // Strip a UTF-8 BOM if the file has one — a BOM inside a value has broken sign-in here before.
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").replace(/^﻿/, "").trim();
    }
  } catch {
    /* no .env.local — everything must come from the environment instead */
  }
  return out;
}

const dotenv = envFromDotLocal();
const pick = (name) => process.env[name] ?? dotenv[name] ?? "";

const URL = pick("NEXT_PUBLIC_SUPABASE_URL");
const ANON = pick("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const A = { email: pick("RLS_USER_A_EMAIL"), password: pick("RLS_USER_A_PASSWORD") };
const B = { email: pick("RLS_USER_B_EMAIL"), password: pick("RLS_USER_B_PASSWORD") };

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", URL],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON],
  ["RLS_USER_A_EMAIL", A.email],
  ["RLS_USER_A_PASSWORD", A.password],
  ["RLS_USER_B_EMAIL", B.email],
  ["RLS_USER_B_PASSWORD", B.password],
].filter(([, v]) => !v);

if (missing.length > 0) {
  console.error(`\n  Missing: ${missing.map(([k]) => k).join(", ")}\n\n  See the header of this file for setup.\n`);
  process.exit(1);
}

/* ── Harness ────────────────────────────────────────────────────────────────────────────────────── */

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

/** A fresh client per user — one shared client would sign the second sign-in over the first. */
async function signIn({ email, password }, label) {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`could not sign in as ${label} (${email}): ${error?.message ?? "no user"}`);
  return { client, userId: data.user.id };
}

/* ── Run ────────────────────────────────────────────────────────────────────────────────────────── */

console.log(`\n  RLS check against ${URL}\n`);

const alice = await signIn(A, "A");
const bob = await signIn(B, "B");
check(alice.userId !== bob.userId, "the two accounts are genuinely different users");

// Each user's own organization.
const orgOf = async ({ client }, label) => {
  const { data, error } = await client.from("organization_members").select("organization_id").limit(1);
  if (error) throw new Error(`could not read ${label}'s organization: ${error.message}`);
  if (!data?.[0]) throw new Error(`${label} has no organization — has 0004 been applied?`);
  return data[0].organization_id;
};
const aliceOrg = await orgOf(alice, "A");
const bobOrg = await orgOf(bob, "B");
check(aliceOrg !== bobOrg, `the two accounts are in different organizations (${aliceOrg} vs ${bobOrg})`);

// A creates a claim carrying something recognisable.
const SECRET = `rls-probe-${Date.now()}`;
const { data: created, error: createError } = await alice.client
  .from("claims")
  .insert({
    organization_id: aliceOrg,
    created_by: alice.userId,
    customer_name: SECRET,
    job_number: SECRET,
    step: "intake",
    payload: { claim: { customerName: SECRET } },
  })
  .select("id")
  .single();
if (createError) throw new Error(`A could not create a claim: ${createError.message}`);
const claimId = created.id;
console.log(`  (A created claim ${claimId})\n`);

try {
  /* ── Reads ───────────────────────────────────────────────────────────────────────────────────── */

  {
    const { data } = await bob.client.from("claims").select("*").eq("id", claimId);
    check((data ?? []).length === 0, "B cannot read A's claim by id");
  }
  {
    // The query the UI never makes: everything, unfiltered.
    const { data } = await bob.client.from("claims").select("*");
    check(!(data ?? []).some((r) => r.id === claimId), "B cannot reach A's claim through an unfiltered select");
    check(
      !(data ?? []).some((r) => r.organization_id === aliceOrg),
      "and sees nothing at all belonging to A's organization",
    );
  }
  {
    // Naming A's organization explicitly, which is the thing an attacker would try once they had an id.
    const { data } = await bob.client.from("claims").select("*").eq("organization_id", aliceOrg);
    check((data ?? []).length === 0, "B cannot read A's claims by naming A's organization id");
  }
  {
    // Searching by the payload, in case a policy covered id lookups and not filters.
    const { data } = await bob.client.from("claims").select("id, customer_name").ilike("customer_name", `%${SECRET}%`);
    check((data ?? []).length === 0, "B cannot find A's claim by searching its customer name");
  }
  {
    // Ordering and paging, in case a policy were bypassed by a different plan shape.
    const { data } = await bob.client.from("claims").select("id").order("updated_at", { ascending: false }).limit(1000);
    check(!(data ?? []).some((r) => r.id === claimId), "nor through an ordered, paged scan of the whole table");
  }
  {
    // Counting: a count leaks existence even when the rows do not come back.
    const { count } = await bob.client.from("claims").select("id", { count: "exact", head: true }).eq("id", claimId);
    check((count ?? 0) === 0, "and cannot even count A's claim");
  }

  /* ── The organization tables themselves ──────────────────────────────────────────────────────── */

  {
    const { data } = await bob.client.from("organizations").select("*").eq("id", aliceOrg);
    check((data ?? []).length === 0, "B cannot read A's organization row");
  }
  {
    const { data } = await bob.client.from("organization_members").select("*").eq("organization_id", aliceOrg);
    check((data ?? []).length === 0, "B cannot list the members of A's organization");
  }
  {
    const { data } = await bob.client.from("organization_members").select("*");
    check(
      !(data ?? []).some((r) => r.user_id === alice.userId),
      "and cannot discover A's user id through the membership table",
    );
  }

  /* ── Writes ──────────────────────────────────────────────────────────────────────────────────── */

  {
    const { data } = await bob.client.from("claims").update({ customer_name: "overwritten by B" }).eq("id", claimId).select("id");
    check((data ?? []).length === 0, "B cannot update A's claim");
  }
  {
    const { data } = await bob.client.from("claims").delete().eq("id", claimId).select("id");
    check((data ?? []).length === 0, "B cannot delete A's claim");
  }
  {
    // Planting a row inside A's organization — how a hostile user would put data where A would read it.
    const { error } = await bob.client
      .from("claims")
      .insert({ organization_id: aliceOrg, customer_name: "planted by B", job_number: "x", step: "intake", payload: {} });
    check(error !== null, `B cannot insert a claim into A's organization (got ${error ? "refused" : "ACCEPTED"})`);
  }
  {
    // Joining A's organization, which would defeat every policy above at once.
    const { error } = await bob.client
      .from("organization_members")
      .insert({ organization_id: aliceOrg, user_id: bob.userId, role: "member" });
    check(error !== null, `B cannot add themselves to A's organization (got ${error ? "refused" : "ACCEPTED"})`);
  }
  {
    // Moving their own claim into A's organization, the `with check` half of the update policy.
    const { data: mine } = await bob.client
      .from("claims")
      .insert({ organization_id: bobOrg, customer_name: "B's own", job_number: "b1", step: "intake", payload: {} })
      .select("id")
      .single();
    if (mine) {
      const { data, error } = await bob.client
        .from("claims")
        .update({ organization_id: aliceOrg })
        .eq("id", mine.id)
        .select("id");
      check(error !== null || (data ?? []).length === 0, "B cannot move their own claim into A's organization");
      await bob.client.from("claims").delete().eq("id", mine.id);
    }
  }
  {
    // The membership helper, called directly. It reads auth.uid() itself, so B asking about A's
    // organization must come back false rather than answering for whoever is named.
    const { data, error } = await bob.client.rpc("is_org_member", { org_id: aliceOrg });
    check(error !== null || data === false, `is_org_member answers for the caller, not the argument (got ${JSON.stringify(data)})`);
  }

  /* ── The letterhead (0005_letterhead.sql) ────────────────────────────────────────────────────── */

  /*
    Requires 0005 to have been applied. Two things it adds: owners may update their own
    organization row, and a private `logos` bucket keyed on the organization id in each object's
    path. Both are probed from B's side, and the storage half from no session at all.
  */
  {
    const { data } = await bob.client.from("organizations").update({ name: "hijacked by B", tagline: "probe" }).eq("id", aliceOrg).select("id");
    check((data ?? []).length === 0, "B cannot rewrite A's letterhead");
  }
  {
    const { data, error } = await bob.client.rpc("is_org_owner", { org_id: aliceOrg });
    check(error !== null || data === false, `is_org_owner answers for the caller, not the argument (got ${JSON.stringify(data)})`);
  }

  // A 1 × 1 transparent PNG — the smallest thing the bucket's type limit admits.
  const PROBE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  // Its own name inside A's folder, so the probe never touches a real logo at `<org>/logo.png`.
  const probePath = `${aliceOrg}/rls-probe.png`;
  {
    const { error } = await alice.client.storage.from("logos").upload(probePath, PROBE_PNG, { contentType: "image/png", upsert: true });
    check(error === null, `A can upload into their own organization's folder (got ${error?.message ?? "ok"})`);
  }
  try {
    {
      const { error } = await bob.client.storage.from("logos").upload(`${aliceOrg}/logo.png`, PROBE_PNG, { contentType: "image/png", upsert: true });
      check(error !== null, `B cannot upload a logo into A's folder (got ${error ? "refused" : "ACCEPTED"})`);
    }
    {
      const { data, error } = await bob.client.storage.from("logos").download(probePath);
      check(error !== null || !data, `B cannot download A's logo (got ${error ? "refused" : "FILE RETURNED"})`);
    }
    {
      const { data } = await bob.client.storage.from("logos").list(aliceOrg);
      check((data ?? []).length === 0, "B cannot list A's folder");
    }
    {
      const { data, error } = await bob.client.storage.from("logos").remove([probePath]);
      // Storage reports a refused delete as an empty result rather than an error, so check the data.
      check(error !== null || (data ?? []).length === 0, `B cannot delete A's logo (got ${error ? "refused" : JSON.stringify(data)})`);
      const { data: still } = await alice.client.storage.from("logos").download(probePath);
      check(Boolean(still), "and A's file is still there afterwards");
    }
    {
      const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await anon.storage.from("logos").download(probePath);
      check(error !== null || !data, "the bare anon key, with nobody signed in, downloads no logo");
    }
    {
      // A can still change their own letterhead — and the probe restores what was there, since
      // this may be a real account with a real tagline.
      const { data: before } = await alice.client.from("organizations").select("tagline").eq("id", aliceOrg).single();
      const { data } = await alice.client.from("organizations").update({ tagline: "rls probe tagline" }).eq("id", aliceOrg).select("tagline");
      check(data?.[0]?.tagline === "rls probe tagline", "A can update their own letterhead (owner-only is not owner-none)");
      const { data: restored } = await alice.client.from("organizations").update({ tagline: before?.tagline ?? null }).eq("id", aliceOrg).select("tagline");
      check((restored?.[0]?.tagline ?? null) === (before?.tagline ?? null), "and the probe put the tagline back");
    }
  } finally {
    const { data: removed } = await alice.client.storage.from("logos").remove([probePath]);
    check((removed ?? []).length === 1, "A can delete their own probe file");
  }

  /* ── With no session at all ──────────────────────────────────────────────────────────────────── */

  {
    const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await anon.from("claims").select("*").limit(50);
    check((data ?? []).length === 0, "the bare anon key, with nobody signed in, reads no claims at all");
    const { data: orgs } = await anon.from("organizations").select("*").limit(50);
    check((orgs ?? []).length === 0, "and no organizations");
    const { data: members } = await anon.from("organization_members").select("*").limit(50);
    check((members ?? []).length === 0, "and no memberships");
  }

  /* ── A can still do all of it ────────────────────────────────────────────────────────────────── */

  {
    const { data } = await alice.client.from("claims").select("customer_name").eq("id", claimId);
    check(data?.[0]?.customer_name === SECRET, "A can still read their own claim (the policies are not simply denying everything)");
  }
  {
    const { data } = await alice.client.from("claims").update({ step: "transcript" }).eq("id", claimId).select("step");
    check(data?.[0]?.step === "transcript", "and update it");
  }
} finally {
  // Always clean up, including after a failed assertion — a probe claim left behind would show up in
  // A's real claims list.
  const { data: gone } = await alice.client.from("claims").delete().eq("id", claimId).select("id");
  check((gone ?? []).length === 1, "and delete it, permanently");
  const { data: after } = await alice.client.from("claims").select("id").eq("id", claimId);
  check((after ?? []).length === 0, "after which the row is genuinely gone, not hidden");
}

/* ── Teams (0011_org_billing.sql + 0012_teams.sql) ───────────────────────────────────────────────── */

const teamsProbe = await alice.client.rpc("org_members");
if (teamsProbe.error && ["PGRST202", "42883"].includes(teamsProbe.error.code)) {
  console.log("\n  Teams: skipped — 0011_org_billing.sql and 0012_teams.sql are not applied to this project yet.");
  console.log("  (npm run test:rls:local checks them against a local Postgres.)\n");
} else {
  console.log("\n  Teams\n");
  const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const invite = async (email, role = "member") => {
    const token = randomBytes(32).toString("base64url");
    const { data, error } = await alice.client.rpc("org_invite_create", { invite_email: email, invite_role: role, token_hash: sha(token) });
    return { token, error, id: (Array.isArray(data) ? data[0] : data)?.invite_id ?? null };
  };
  const membershipOf = async ({ client }) => (await client.from("organization_members").select("organization_id, role").limit(1)).data?.[0] ?? null;

  const { data: teamClaimRow } = await alice.client
    .from("claims")
    .insert({ organization_id: aliceOrg, created_by: alice.userId, customer_name: `${SECRET}-team`, job_number: "t1", step: "intake", payload: {} })
    .select("id")
    .single();
  const teamClaim = teamClaimRow?.id ?? null;
  let bobJoined = false;

  try {
    {
      const { error } = await alice.client.from("organizations").update({ subscription_tier: "unlimited" }).eq("id", aliceOrg);
      check(error !== null, `A, the owner, cannot write their own plan from the browser (got ${error ? "refused" : "ACCEPTED"})`);
    }
    const stranger = await invite(`rls-probe-${Date.now()}@example.invalid`);
    check(stranger.error === null && stranger.id, `A can invite an address (got ${stranger.error?.message ?? "ok"})`);
    {
      const { data } = await bob.client.from("organization_invites").select("id, email").eq("organization_id", aliceOrg);
      check((data ?? []).length === 0, "B cannot see A's invitations");
      const { data: revoked } = await bob.client.rpc("org_invite_revoke", { invite_id: stranger.id });
      check(revoked !== true, "nor withdraw one");
      const { error } = await bob.client.rpc("org_invite_accept", { token_hash: sha(stranger.token) });
      check(error?.code === "P0414", `nor accept one sent to another address (P0414) (got ${error?.code ?? "ACCEPTED"})`);
      const { data: hashes, error: hashError } = await alice.client.from("organization_invites").select("token_hash").limit(1);
      check(hashError !== null || (hashes ?? []).length === 0, "and even A cannot read an invitation's token hash");
      await alice.client.rpc("org_invite_revoke", { invite_id: stranger.id });
    }

    const forBob = await invite(B.email, "member");
    check(forBob.error === null, `A invites B (got ${forBob.error?.message ?? "ok"})`);
    {
      const { data } = await anon.rpc("org_invite_preview", { token_hash: sha(forBob.token) });
      const row = Array.isArray(data) ? data[0] : data;
      check(row?.status === "open" && row?.email === B.email.trim().toLowerCase(), "the bare anon key can preview it from the token");
      const { data: none } = await anon.rpc("org_invite_preview", { token_hash: sha("not the token") });
      check(!none || (Array.isArray(none) && none.length === 0), "and nothing from a wrong one");
      const { error } = await anon.rpc("org_invite_accept", { token_hash: sha(forBob.token) });
      check(error !== null, "the bare anon key cannot accept it");
    }
    {
      const { data, error } = await bob.client.rpc("org_invite_accept", { token_hash: sha(forBob.token) });
      const row = Array.isArray(data) ? data[0] : data;
      bobJoined = error === null;
      check(error === null && row?.organization_id === aliceOrg && row?.role === "member", `B accepts and joins A's organization as a member (got ${error?.code ?? ""} ${error?.message ?? ""})`);
    }
    if (bobJoined) {
      check((await membershipOf(bob))?.organization_id === aliceOrg, "B's session now resolves to A's organization");
      const { data: read } = await bob.client.from("claims").select("id").eq("id", teamClaim);
      check((read ?? []).length === 1, "B reads A's claim — teammates cover for each other");
      const { data: edited } = await bob.client.from("claims").update({ step: "transcript" }).eq("id", teamClaim).select("id");
      check((edited ?? []).length === 1, "and edits it");
      const { data: deleted } = await bob.client.from("claims").delete().eq("id", teamClaim).select("id");
      check((deleted ?? []).length === 0, "but cannot delete a claim B did not start");
      const { error: reassignError } = await bob.client.from("claims").update({ created_by: bob.userId }).eq("id", teamClaim);
      check(reassignError !== null, `nor make it B's by rewriting who started it (got ${reassignError ? "refused" : "ACCEPTED"})`);
      const { error: inviteError } = await bob.client.rpc("org_invite_create", { invite_email: "x@example.invalid", invite_role: "member", token_hash: sha("x") });
      check(inviteError?.code === "42501", `a member cannot invite (42501) (got ${inviteError?.code ?? "ACCEPTED"})`);
      const { error: roleError } = await bob.client.rpc("org_member_set_role", { member_id: alice.userId, new_role: "member" });
      check(roleError?.code === "42501", "nor change anyone's role");
      const { data: members } = await bob.client.rpc("org_members");
      check((members ?? []).some((m) => m.user_id === alice.userId && m.role === "owner"), "B sees the team: A, as owner");
      const { data: promoted } = await alice.client.rpc("org_member_set_role", { member_id: bob.userId, new_role: "admin" });
      check(promoted === true && (await membershipOf(bob))?.role === "admin", "A makes B an admin");
      const { error: invitesError } = await bob.client.from("organization_invites").select("id").eq("organization_id", aliceOrg);
      check(invitesError === null, "and as an admin B may list the invitations");
      const { data: demoted } = await alice.client.rpc("org_member_set_role", { member_id: bob.userId, new_role: "member" });
      check(demoted === true, "and back to a member");
      const { data: home, error: leaveError } = await bob.client.rpc("org_leave");
      bobJoined = leaveError !== null;
      check(leaveError === null && home === bobOrg, `B leaves, back to B's own organization (got ${leaveError?.message ?? home})`);
      const { error: ownerLeave } = await alice.client.rpc("org_leave");
      check(ownerLeave?.code === "P0411", "and the owner cannot leave (P0411)");
    }
  } finally {
    if (bobJoined) {
      const { error } = await bob.client.rpc("org_leave");
      if (error) await alice.client.rpc("org_member_remove", { member_id: bob.userId });
    }
    check((await membershipOf(bob))?.organization_id === bobOrg, "B is in B's own organization at the end, whatever happened above");
    if (teamClaim) await alice.client.from("claims").delete().eq("id", teamClaim);
  }
}

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  console.error("  A FAILURE HERE IS A DATA LEAK. Do not deploy until every check passes.\n");
  process.exit(1);
}
