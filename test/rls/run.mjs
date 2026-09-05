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
 * Apply supabase/migrations/0004_organizations_and_claims.sql first, create two throwaway accounts,
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
 */

import { readFileSync } from "node:fs";
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

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  console.error("  A FAILURE HERE IS A DATA LEAK. Do not deploy until every check passes.\n");
  process.exit(1);
}
