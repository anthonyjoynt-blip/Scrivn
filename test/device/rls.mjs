/**
 * Can a paired phone reach only the account that paired it? Asked directly, with two real accounts.
 *
 *   npm run test:device:rls
 *
 * ── Why this is a real script and not a unit test ────────────────────────────────────────────────
 *
 * 0006_device_tokens_and_scans.sql moves the security boundary for phones out of RLS policies and
 * into SECURITY DEFINER functions: the phone has no session, calls them as `anon`, and each function
 * resolves the token's hash itself. Nothing in TypeScript can test that. The functions are the
 * boundary, and the only way to know they hold is to call them against the real database — once as
 * the phone (the bare anon key, no session), once as the person who paired it, and once as somebody
 * else.
 *
 * As in test/rls/run.mjs, the anon key is public and anyone holding it can call any function it has
 * been granted, with any arguments. So the calls below are deliberately NOT limited to the ones the
 * app makes: wrong codes, spent codes, other people's scan ids, a valid token from another
 * organization pointed at a claim it can see the id of.
 *
 * ── Setup ───────────────────────────────────────────────────────────────────────────────────────
 *
 * Apply supabase/migrations/0006_device_tokens_and_scans.sql (and everything before it) first,
 * create two throwaway accounts, then:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=...       (already in .env.local)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=...  (already in .env.local)
 *   RLS_USER_A_EMAIL=...  RLS_USER_A_PASSWORD=...
 *   RLS_USER_B_EMAIL=...  RLS_USER_B_PASSWORD=...
 *
 * Use accounts created for this. The script pairs a phone to each account, writes a claim and two
 * scans under A, and tries as B to resolve, revoke and post into them — point it at real accounts
 * and a failing function means a real write. The claim is deleted at the end; the two probe tokens
 * are revoked but stay in each account's Paired phones list as "rls probe phone (revoked)", because
 * there is deliberately no way to delete a token row from the browser.
 *
 * ── Reading the result ──────────────────────────────────────────────────────────────────────────
 *
 * Every check on B's side is phrased so that PASS means "B could not": zero rows, `false`, or an
 * error from Postgres all pass; data coming back or a write succeeding fails. The checks on A's side
 * and the phone's side are the opposite — they exist so a set of functions that simply refused
 * everything could not pass. As in test/rls/run.mjs, assertions are on the DATA, not on the absence
 * of an error.
 */

import { readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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

/* ── The secrets, as lib/deviceCodes.ts makes them ──────────────────────────────────────────────── */

// This script cannot import TypeScript, so the three things it needs from lib/deviceCodes.ts are
// restated here. The database never sees a code or a token, only these hashes, so all that matters
// is that begin and pair hash the same string — which is the eight letters, what
// `normalisePairingCode` returns.
const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const hashSecret = (secret) => createHash("sha256").update(secret, "utf8").digest("hex");
const newPairingLetters = () =>
  Array.from(randomBytes(8), (b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join("");
const newDeviceToken = () => randomBytes(32).toString("base64url");

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

/** What the phone has: the anon key and nothing else. */
const phone = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

/** `rpc` on a `returns table` function gives an array; this reads it as such whatever came back. */
const rows = (data) => (Array.isArray(data) ? data : []);

/** A PostgREST error's SQLSTATE and message in one string, for the FAIL line. */
const describe = (error) => (error ? `${error.code ?? "?"} ${error.message ?? ""}`.trim() : "no error");

/**
 * JSON with object keys in a fixed order, so a value can be compared with what jsonb hands back —
 * jsonb stores keys in its own order, not the order they were written in.
 */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/**
 * Pair a phone to whoever `user` is: they begin a pairing over their session, the phone exchanges
 * the code as anon. Returns what the phone would keep.
 */
async function pairPhone(user, label) {
  const letters = newPairingLetters();
  const token = newDeviceToken();
  const { data: begun, error: beginError } = await user.client.rpc("device_pairing_begin", { code_hash: hashSecret(letters) });
  if (beginError) throw new Error(`${label} could not begin a pairing: ${describe(beginError)} — has 0006 been applied?`);
  const { data: paired, error: pairError } = await phone().rpc("device_pair", {
    code_hash: hashSecret(letters),
    token_hash: hashSecret(token),
    device_name: "rls probe phone",
  });
  if (pairError) throw new Error(`the phone could not pair to ${label}: ${describe(pairError)}`);
  const row = rows(paired)[0];
  if (!row) throw new Error(`the phone got no row back pairing to ${label}`);
  return { token, tokenHash: hashSecret(token), tokenId: row.token_id, begun: rows(begun)[0], letters, row };
}

/* ── Run ────────────────────────────────────────────────────────────────────────────────────────── */

console.log(`\n  Device function check against ${URL}\n`);

const alice = await signIn(A, "A");
const bob = await signIn(B, "B");
check(alice.userId !== bob.userId, "the two accounts are genuinely different users");

// Each user's own organization.
const orgOf = async ({ client }, label) => {
  const { data, error } = await client.from("organization_members").select("organization_id, role").limit(1);
  if (error) throw new Error(`could not read ${label}'s organization: ${error.message}`);
  if (!data?.[0]) throw new Error(`${label} has no organization — has 0004 been applied?`);
  return data[0];
};
const aliceMembership = await orgOf(alice, "A");
const bobMembership = await orgOf(bob, "B");
const aliceOrg = aliceMembership.organization_id;
const bobOrg = bobMembership.organization_id;
check(aliceOrg !== bobOrg, `the two accounts are in different organizations (${aliceOrg} vs ${bobOrg})`);

/* ── Pairing ─────────────────────────────────────────────────────────────────────────────────────── */

{
  // Nobody signed in may not even ask for a code: the function is granted to `authenticated` only.
  const { data, error } = await phone().rpc("device_pairing_begin", { code_hash: hashSecret("anon probe") });
  check(error !== null || rows(data).length === 0, `the bare anon key cannot begin a pairing (got ${describe(error)})`);
}

// A begins a pairing; the phone exchanges it.
const letters = newPairingLetters();
const codeHash = hashSecret(letters);
const token = newDeviceToken();
const tokenHash = hashSecret(token);

const { data: begun, error: beginError } = await alice.client.rpc("device_pairing_begin", { code_hash: codeHash });
if (beginError) throw new Error(`A could not begin a pairing: ${describe(beginError)} — has 0006 been applied?`);
{
  const row = rows(begun)[0];
  check(Boolean(row?.id), "A can begin a pairing and gets the row id back");
  const expires = row ? new Date(row.expires_at).getTime() - Date.now() : 0;
  check(expires > 8 * 60_000 && expires < 12 * 60_000, `and the code expires about ten minutes out (${Math.round(expires / 1000)} s)`);
}
{
  // The person who minted the code sees no pairing rows: the table has no browser policies at all.
  const { data } = await alice.client.from("device_pairings").select("*");
  check(rows(data).length === 0, "A cannot read device_pairings, not even their own row");
}

let tokenId = null;
{
  const { data, error } = await phone().rpc("device_pair", { code_hash: codeHash, token_hash: tokenHash, device_name: "rls probe phone" });
  const row = rows(data)[0];
  check(error === null && Boolean(row), `the phone can exchange the code for a token (got ${describe(error)})`);
  check(row?.organization_id === aliceOrg, "and the token belongs to A's organization");
  check(row?.user_id === alice.userId, "and to A");
  check(typeof row?.organization_name === "string" && typeof row?.user_name === "string", "with the organization's name and A's name (or an empty string) alongside");
  tokenId = row?.token_id ?? null;
}
if (!tokenId) throw new Error("no token was minted; nothing below can run");
console.log(`  (the phone holds token ${tokenId})\n`);

// These four say "no rows, and no error": the app turns an empty result into 400/401, and a
// function that RAISED instead would reach the phone as a 500 with a SQL message in it. A check
// that read only the data would pass on that error too — the data is null then — so the error is
// asserted as well.
{
  const { data, error } = await phone().rpc("device_pair", { code_hash: codeHash, token_hash: hashSecret(newDeviceToken()), device_name: "second phone, same code" });
  check(error === null && rows(data).length === 0, `the same code cannot be exchanged twice — no rows, no error (got ${describe(error)})`);
}
{
  const { data, error } = await phone().rpc("device_pair", { code_hash: hashSecret(newPairingLetters()), token_hash: hashSecret(newDeviceToken()), device_name: "guess" });
  check(error === null && rows(data).length === 0, `a code that was never issued pairs nothing — no rows, no error (got ${describe(error)})`);
}

/* ── Identity ────────────────────────────────────────────────────────────────────────────────────── */

{
  const { data, error } = await phone().rpc("device_identity", { token_hash: tokenHash });
  const row = rows(data)[0];
  check(error === null && Boolean(row), `device_identity resolves the token (got ${describe(error)})`);
  check(row?.organization_id === aliceOrg && row?.user_id === alice.userId, "to A in A's organization");
  check(row?.token_id === tokenId, "and names the token row");
  check(row?.role === aliceMembership.role, `with A's role in the organization (${row?.role})`);
}
{
  const { data, error } = await phone().rpc("device_identity", { token_hash: hashSecret(newDeviceToken()) });
  check(error === null && rows(data).length === 0, `an unknown token resolves to nothing — no rows, no error (got ${describe(error)})`);
}
{
  const { data } = await alice.client.from("device_tokens").select("id, name, user_id, revoked_at").eq("id", tokenId);
  check(data?.[0]?.name === "rls probe phone" && data?.[0]?.user_id === alice.userId && data?.[0]?.revoked_at === null, "A can see the paired phone in their organization's device_tokens");
}
{
  // The one column the browser must never read. 42501 is "permission denied": the column grant
  // in 0006 leaves token_hash out, so even the row's own organization cannot select it.
  const { data, error } = await alice.client.from("device_tokens").select("token_hash").eq("id", tokenId);
  check(error?.code === "42501" && rows(data).length === 0, `A cannot read token_hash, not even on their own phone (got ${describe(error)})`);
}
{
  // And even if a hash leaked, it is not the argument the functions accept: what the table holds
  // is the hash of what the app sends, so presenting it resolves nothing.
  const { data: viaApp } = await alice.client.rpc("device_identity", { token_hash: tokenHash });
  check(rows(viaApp).length === 1, "the value the app sends still resolves (a sanity check on the next line)");
  const { data, error } = await phone().rpc("device_identity", { token_hash: hashSecret(tokenHash) });
  check(error === null && rows(data).length === 0, `the STORED value — the hash of what the app sends — resolves nothing when presented (got ${describe(error)})`);
}

/* ── A scan that creates a claim ─────────────────────────────────────────────────────────────────── */

const SECRET = `device-probe-${Date.now()}`;
// The capture as the phone would send it. Nothing in the database interprets it, so a marker is enough.
const probeBody = { probe: SECRET, rooms: [] };
// What the app builds for a new claim: the whole state as payload, and the list columns beside it.
// The room names are chosen so `room_names` has something to trim, drop and de-duplicate.
const newClaim = {
  payload: {
    step: "intake",
    claim: { customerName: SECRET, jobNumber: "", address: "", insurer: "" },
    sketch: { rooms: [{ name: "Kitchen" }, { name: " Kitchen " }, { name: "" }, { name: "   " }] },
    extraction: { rooms: [{ roomName: "Bath" }, { roomName: "Kitchen" }] },
  },
  customer_name: SECRET,
  job_number: "",
  address: "",
  insurer: "",
  step: "intake",
  status: "intake",
};

const scanId1 = randomUUID();
const receivedAt1 = new Date().toISOString();
let claimId = null;
{
  const { data, error } = await phone().rpc("device_receive_scan", {
    token_hash: tokenHash,
    target_claim_id: null,
    new_scan_id: scanId1,
    received_at: receivedAt1,
    body: probeBody,
    capture_id: "probe-capture-1",
    captured_at: receivedAt1,
    scan_level: 0,
    new_claim: newClaim,
  });
  const row = rows(data)[0];
  check(error === null && Boolean(row), `the phone can send a scan for a new claim (got ${describe(error)})`);
  check(row?.created === true, "and the function reports the claim as created");
  check(row?.scan_id === scanId1, "under the scan id the app chose");
  claimId = row?.claim_id ?? null;
}
if (!claimId) throw new Error("no claim was created; nothing below can run");
console.log(`  (the phone created claim ${claimId})\n`);

try {
  {
    const { data } = await alice.client.from("claims").select("organization_id, created_by, customer_name, status, payload").eq("id", claimId);
    const row = data?.[0];
    check(Boolean(row), "A can read the claim the phone created");
    check(row?.organization_id === aliceOrg, "it is in A's organization");
    check(row?.created_by === alice.userId, "and A started it, as far as the claims list can tell");
    check(row?.customer_name === SECRET && row?.payload?.claim?.customerName === SECRET, "with the summary columns and the payload the app supplied");
  }
  {
    const { data } = await alice.client.from("claim_scans").select("id, status, resolved_at, device_token_id, level, capture_id, body").eq("claim_id", claimId);
    const row = rows(data)[0];
    check(rows(data).length === 1 && row?.id === scanId1, "A can see exactly one scan row for it, under the same id");
    check(row?.status === "adopted" && row?.resolved_at !== null, "already adopted, since there was no browser state to protect");
    check(row?.device_token_id === tokenId, "and attributed to the phone that sent it");
    check(row?.body?.probe === SECRET && row?.capture_id === "probe-capture-1", "with the capture stored as sent");
  }

  /* ── The claims list the phone sees ─────────────────────────────────────────────────────────────── */

  {
    const { data, error } = await phone().rpc("device_claims", { token_hash: tokenHash });
    const mine = rows(data).find((r) => r.id === claimId);
    check(error === null && Boolean(mine), `device_claims lists the new claim (got ${describe(error)})`);
    check(mine?.mine === true, "marked as the phone's own person's claim");
    check(mine?.customer_name === SECRET && mine?.status === "intake", "with the list columns");
    check(
      JSON.stringify(mine?.room_names) === JSON.stringify(["Bath", "Kitchen"]),
      `and room_names trimmed, de-duplicated and emptied of blanks (got ${JSON.stringify(mine?.room_names)})`,
    );
  }
  {
    const { data, error } = await phone().rpc("device_claims", { token_hash: hashSecret(newDeviceToken()) });
    check(error?.code === "28000" && rows(data).length === 0, `device_claims with an unknown token raises 28000, not an empty list (got ${describe(error)})`);
  }

  /* ── A scan into the existing claim ─────────────────────────────────────────────────────────────── */

  const scanId2 = randomUUID();
  {
    const receivedAt2 = new Date().toISOString();
    const { data, error } = await phone().rpc("device_receive_scan", {
      token_hash: tokenHash,
      target_claim_id: claimId,
      new_scan_id: scanId2,
      received_at: receivedAt2,
      body: probeBody,
      capture_id: "probe-capture-2",
      captured_at: null,
      scan_level: 1,
      new_claim: null,
    });
    const row = rows(data)[0];
    check(error === null && row?.claim_id === claimId && row?.created === false, `the phone can send a scan into the existing claim (got ${describe(error)})`);
    check(row?.scan_id === scanId2, "under the scan id the app chose");
  }
  {
    const { data } = await alice.client.from("claim_scans").select("id, status, resolved_at, level, captured_at").eq("claim_id", claimId).eq("status", "pending");
    const row = rows(data)[0];
    check(rows(data).length === 1 && row?.id === scanId2, "A sees exactly one pending scan, the second one");
    check(row?.resolved_at === null && row?.level === 1 && row?.captured_at === null, "unresolved, on the storey the phone said, with no captured_at since none was sent");
  }
  {
    const { data: before } = await alice.client.from("claims").select("payload").eq("id", claimId).single();
    check(canonical(before?.payload) === canonical(newClaim.payload), "and the claim's payload was NOT touched by the pending scan");
  }
  {
    const { data, error } = await phone().rpc("device_receive_scan", {
      token_hash: tokenHash,
      target_claim_id: randomUUID(),
      new_scan_id: randomUUID(),
      received_at: new Date().toISOString(),
      body: probeBody,
      capture_id: null,
      captured_at: null,
      scan_level: 0,
      new_claim: null,
    });
    check(error?.code === "P0002" && rows(data).length === 0, `a scan into a claim that does not exist raises P0002 (got ${describe(error)})`);
  }
  {
    const { data, error } = await phone().rpc("device_receive_scan", {
      token_hash: tokenHash,
      target_claim_id: null,
      new_scan_id: randomUUID(),
      received_at: new Date().toISOString(),
      body: probeBody,
      capture_id: null,
      captured_at: null,
      scan_level: 0,
      new_claim: { payload: {} },
    });
    check(error?.code === "22023" && rows(data).length === 0, `a new-claim scan without the summary columns raises 22023 (got ${describe(error)})`);
  }
  {
    const { data, error } = await phone().rpc("device_receive_scan", {
      token_hash: hashSecret(newDeviceToken()),
      target_claim_id: claimId,
      new_scan_id: randomUUID(),
      received_at: new Date().toISOString(),
      body: probeBody,
      capture_id: null,
      captured_at: null,
      scan_level: 0,
      new_claim: null,
    });
    check(error?.code === "28000" && rows(data).length === 0, `an unknown token cannot post a scan even into a real claim (got ${describe(error)})`);
  }

  /* ── B, signed in, from the browser ─────────────────────────────────────────────────────────────── */

  {
    const { data } = await bob.client.from("claim_scans").select("*").eq("claim_id", claimId);
    check(rows(data).length === 0, "B cannot read the scans on A's claim by claim id");
  }
  {
    const { data } = await bob.client.from("claim_scans").select("*");
    check(!rows(data).some((r) => r.organization_id === aliceOrg || r.id === scanId1 || r.id === scanId2), "nor through an unfiltered select of claim_scans");
  }
  {
    const { data } = await bob.client.from("device_tokens").select("*");
    check(!rows(data).some((r) => r.id === tokenId || r.organization_id === aliceOrg), "B cannot see A's paired phone in device_tokens");
  }
  {
    const { data } = await bob.client.from("device_pairings").select("*");
    check(rows(data).length === 0, "B reads nothing from device_pairings");
  }
  {
    const { data, error } = await bob.client.rpc("claim_scan_resolve", { scan_id: scanId2, new_status: "adopted" });
    check(error !== null || data === false, `B cannot resolve A's pending scan (got ${error ? describe(error) : JSON.stringify(data)})`);
    const { data: still } = await alice.client.from("claim_scans").select("status").eq("id", scanId2);
    check(still?.[0]?.status === "pending", "and the scan is still pending afterwards");
  }
  {
    const { data, error } = await bob.client.rpc("device_token_revoke", { token_id: tokenId });
    check(error !== null || data === false, `B cannot revoke A's phone (got ${error ? describe(error) : JSON.stringify(data)})`);
    const { data: identity } = await phone().rpc("device_identity", { token_hash: tokenHash });
    check(rows(identity).length === 1, "and A's phone still works afterwards");
  }
  {
    // Writing directly, which no policy permits: the only way in is the functions.
    const { error } = await bob.client.from("claim_scans").insert({
      claim_id: claimId,
      organization_id: aliceOrg,
      body: { planted: "by B" },
    });
    check(error !== null, `B cannot insert a scan row directly (got ${error ? "refused" : "ACCEPTED"})`);
  }
  {
    const { error } = await alice.client.from("claim_scans").update({ status: "adopted" }).eq("id", scanId2);
    const { data: still } = await alice.client.from("claim_scans").select("status").eq("id", scanId2);
    check(still?.[0]?.status === "pending", `not even A can resolve a scan by writing the row directly (got ${error ? "refused" : "no error, but no change"})`);
  }

  /* ── B, with a phone of their own ───────────────────────────────────────────────────────────────── */

  // A valid token from another organization is the realistic attacker: paired, trusted, and holding
  // a claim id it saw somewhere.
  const bobPhone = await pairPhone(bob, "B");
  try {
    check(bobPhone.row.organization_id === bobOrg && bobPhone.row.user_id === bob.userId, "B can pair a phone to their own account");
    {
      const { data, error } = await phone().rpc("device_receive_scan", {
        token_hash: bobPhone.tokenHash,
        target_claim_id: claimId,
        new_scan_id: randomUUID(),
        received_at: new Date().toISOString(),
        body: probeBody,
        capture_id: null,
        captured_at: null,
        scan_level: 0,
        new_claim: null,
      });
      check(error?.code === "P0002" && rows(data).length === 0, `B's phone cannot post a scan into A's claim (got ${describe(error)})`);
      const { data: scans } = await alice.client.from("claim_scans").select("id").eq("claim_id", claimId);
      check(rows(scans).length === 2, "and A's claim still has exactly the two scans A's phone sent");
    }
    {
      const { data } = await phone().rpc("device_claims", { token_hash: bobPhone.tokenHash });
      check(!rows(data).some((r) => r.id === claimId), "B's phone does not see A's claim in its list");
    }
  } finally {
    const { data } = await bob.client.rpc("device_token_revoke", { token_id: bobPhone.tokenId });
    check(data === true, "B can revoke their own phone");
  }

  /* ── With no session and no token ───────────────────────────────────────────────────────────────── */

  {
    const anon = phone();
    const { data: scans } = await anon.from("claim_scans").select("*").limit(50);
    check(rows(scans).length === 0, "the bare anon key, with nobody signed in, reads no scans");
    const { data: tokens } = await anon.from("device_tokens").select("*").limit(50);
    check(rows(tokens).length === 0, "and no tokens");
    const { data: pairings } = await anon.from("device_pairings").select("*").limit(50);
    check(rows(pairings).length === 0, "and no pairings");
    const { data, error } = await anon.rpc("claim_scan_resolve", { scan_id: scanId2, new_status: "adopted" });
    check(error !== null || data === false, `and cannot resolve a scan (got ${error ? describe(error) : JSON.stringify(data)})`);
  }

  /* ── A can still do all of it ────────────────────────────────────────────────────────────────────── */

  {
    const { data, error } = await alice.client.rpc("claim_scan_resolve", { scan_id: scanId2, new_status: "bogus" });
    check(error?.code === "22023" && data !== true, `a status other than adopted or discarded raises 22023 (got ${describe(error)})`);
  }
  {
    const { data, error } = await alice.client.rpc("claim_scan_resolve", { scan_id: scanId2, new_status: "adopted" });
    check(error === null && data === true, `A can adopt the pending scan (got ${error ? describe(error) : JSON.stringify(data)})`);
    const { data: row } = await alice.client.from("claim_scans").select("status, resolved_at").eq("id", scanId2);
    check(row?.[0]?.status === "adopted" && row?.[0]?.resolved_at !== null, "and the row is adopted with a resolved_at");
  }
  {
    const { data } = await alice.client.rpc("claim_scan_resolve", { scan_id: scanId2, new_status: "discarded" });
    check(data === false, "resolving it a second time changes nothing and says so");
  }
  {
    const { data } = await alice.client.rpc("claim_scan_resolve", { scan_id: scanId1, new_status: "discarded" });
    check(data === false, "nor can the scan that created the claim be un-adopted");
  }
  {
    const { data, error } = await alice.client.rpc("device_token_revoke", { token_id: tokenId });
    check(error === null && data === true, `A can revoke their own phone (got ${error ? describe(error) : JSON.stringify(data)})`);
    const { data: again } = await alice.client.rpc("device_token_revoke", { token_id: tokenId });
    check(again === false, "revoking it again changes nothing and says so");
    const { data: row } = await alice.client.from("device_tokens").select("revoked_at").eq("id", tokenId);
    check(row?.[0]?.revoked_at !== null, "and A still sees the row, now revoked, in their list");
  }
  {
    const { data, error } = await phone().rpc("device_identity", { token_hash: tokenHash });
    check(error === null && rows(data).length === 0, `after revocation the phone resolves to nothing — no rows, no error (got ${describe(error)})`);
  }
  {
    const { data, error } = await phone().rpc("device_claims", { token_hash: tokenHash });
    check(error?.code === "28000" && rows(data).length === 0, `and cannot list claims (got ${describe(error)})`);
  }
  {
    const { data, error } = await phone().rpc("device_receive_scan", {
      token_hash: tokenHash,
      target_claim_id: claimId,
      new_scan_id: randomUUID(),
      received_at: new Date().toISOString(),
      body: probeBody,
      capture_id: null,
      captured_at: null,
      scan_level: 0,
      new_claim: null,
    });
    check(error?.code === "28000" && rows(data).length === 0, `nor post a scan (got ${describe(error)})`);
  }
} finally {
  // Always clean up, including after a failed assertion — a probe claim left behind would show up in
  // A's real claims list.
  const { data: gone } = await alice.client.from("claims").delete().eq("id", claimId).select("id");
  check(rows(gone).length === 1, "A can delete the claim the phone created, permanently");
  const { data: after } = await alice.client.from("claims").select("id").eq("id", claimId);
  check(rows(after).length === 0, "after which the row is genuinely gone, not hidden");
  const { data: scans } = await alice.client.from("claim_scans").select("id").eq("claim_id", claimId);
  check(rows(scans).length === 0, "and its scans went with it");
}

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  console.error("  A FAILURE HERE IS A DATA LEAK OR A PHONE THAT CAN ACT FOR THE WRONG ACCOUNT. Do not deploy until every check passes.\n");
  process.exit(1);
}
