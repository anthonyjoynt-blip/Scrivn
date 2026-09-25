import "server-only";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { supabaseAnonKey, supabaseUrl } from "./supabase/env";
import { withClockSkewRetry } from "./supabase/clockSkew";
import { NoOrganizationError, NotSignedInError } from "./claimsRepo";
import { claimSummary, emptySavedClaimState } from "./claimState";
import { PAIRING_CODE_TTL_SECONDS, claimSketchUrl, hashSecret, newDeviceToken, newPairingCode, normalisePairingCode, pairingUrl } from "./deviceCodes";
import { SCAN_DROP, convertScan, scanTooBig, sketchFromScan, type PendingScan } from "./scanInbox";

/**
 * Every read and write behind a paired phone, in one place: minting a pairing code, trading it for
 * a token, and everything a phone does with that token afterwards.
 *
 * ── Two sides, two clients ───────────────────────────────────────────────────────────────────────
 *
 * The COOKIE side is the Account page and the claim editor — a signed-in person. Those functions run
 * through the user's own client exactly as `claimsRepo.ts` does, so Row Level Security applies to
 * every select, and the writes go through SQL functions that read `auth.uid()` themselves.
 *
 * The PHONE side has no session at all. A phone arrives with one thing, `Authorization: Bearer
 * <token>`, and there is no cookie for RLS to key on. The tempting answer is the service-role client
 * in `supabase/admin.ts`, and it is the wrong one: that key switches off every rule in the database
 * for a caller whose only credential is a header we have not checked yet. Instead the phone side
 * uses a client built with the ANON key and no session — Postgres role `anon`, which can read no
 * table here — and reaches the database ONLY through the SECURITY DEFINER functions in
 * 0006_device_tokens_and_scans.sql. Each takes the token's hash, looks it up itself, and does the
 * one thing it is for. `claims` is never touched from this file through anything but those
 * functions, so the posture `claimsRepo.ts` describes still holds: nothing in TypeScript is the
 * boundary.
 *
 * ── What is stored ───────────────────────────────────────────────────────────────────────────────
 *
 * Neither secret is stored in clear — see `deviceCodes.ts`. The pairing code is hashed as its eight
 * letters, never the dashed form, so a code typed with spaces and a code scanned from the QR hash
 * the same; `beginPairing` and `pairDevice` both go through `normalisePairingCode` for that reason.
 *
 * ── Why a scan into an existing claim is stored and not applied ──────────────────────────────────
 *
 * A browser with the claim open autosaves the WHOLE payload after every edit. A row the server wrote
 * into `payload.sketch` would be erased by the next save from a page that never saw it. So the first
 * scan of a brand-new claim is applied here — nothing can have that row open yet — and every later
 * scan becomes a pending `claim_scans` row that the editor reads and adopts itself (`scanInbox.ts`).
 *
 * ── How SQL talks back ───────────────────────────────────────────────────────────────────────────
 *
 * The functions raise with fixed SQLSTATE codes and this file reads `error.code`, never the message:
 * 28000 is "the token or session is not valid", P0002 is "the thing you named does not exist",
 * 22023 is "the argument is malformed". A function that does not exist at all means the migration
 * has not been run, which is worth its own sentence rather than a stack trace.
 */

export class InvalidDeviceTokenError extends Error {
  constructor() {
    super("That phone is not paired.");
    this.name = "InvalidDeviceTokenError";
  }
}

export class InvalidPairingCodeError extends Error {
  constructor() {
    super("That code is not valid or has expired.");
    this.name = "InvalidPairingCodeError";
  }
}

/** The importer's own sentence about why the capture will not draw. */
export class ScanRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanRejectedError";
  }
}

export class ClaimNotFoundError extends Error {
  constructor() {
    super("Claim not found.");
    this.name = "ClaimNotFoundError";
  }
}

export class DeviceUnavailableError extends Error {
  constructor(message = "Phone pairing is not available yet — the 0006 migration has not been applied to this database.") {
    super(message);
    this.name = "DeviceUnavailableError";
  }
}

export interface DeviceIdentity {
  tokenId: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  role: "owner" | "member";
}

/** A `device_tokens` row as the Account page lists it. Never the hash. */
export interface DeviceTokenItem {
  id: string;
  name: string;
  userId: string;
  /** True when this session's user paired it — a member may revoke their own phones, an owner anyone's. */
  mine: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** A claim as the phone lists it: enough to pick one and to offer its room names, none of the payload. */
export interface DeviceClaimItem {
  id: string;
  customerName: string;
  jobNumber: string;
  address: string;
  insurer: string;
  status: string;
  updatedAt: string;
  mine: boolean;
  roomNames: string[];
}

export interface ReceiveScanInput {
  /** The claim to add to, or null to create one from this scan. */
  claimId: string | null;
  /** The taps JSON as the phone sent it — either shape the importer reads. */
  body: unknown;
  captureId: string | null;
  capturedAt: string | null;
  level: number;
  /** For a new claim only: what the phone knows about whose house this is. */
  customerName?: string;
  address?: string;
}

export interface ReceivedScan {
  claimId: string;
  scanId: string;
  /** True when this scan created the claim (and was applied to it); false when it is pending in one. */
  created: boolean;
  /** The deep link the phone offers: the claim, sketch open. */
  url: string;
  roomCount: number;
  notes: string[];
}

/* ── Talking to Postgres ───────────────────────────────────────────────────────────────────────── */

/** What a Supabase query or rpc reports when it fails. Only `code` is read for decisions. */
interface QueryError {
  code?: string;
  message: string;
}

/**
 * Whether the error is the database not having the 0006 objects at all.
 *
 * PostgREST answers a call to a function it has never heard of with its own code (PGRST202, "Could
 * not find the function ... in the schema cache") and a select from a missing table with PGRST205;
 * Postgres itself says 42883 and 42P01 for the same two. All four mean the same thing here.
 */
function isMissingSchema(error: QueryError): boolean {
  if (error.code === "42883" || error.code === "42P01" || error.code === "PGRST202" || error.code === "PGRST205") return true;
  return /function .* does not exist|could not find the (function|table)/i.test(error.message);
}

/** The errors a function raises on purpose, by SQLSTATE, for the side that called it. */
type RaisedErrors = Partial<Record<string, () => Error>>;

/** The token was not recognised, or the claim it named is not in the token's organization. */
const PHONE_ERRORS: RaisedErrors = {
  "28000": () => new InvalidDeviceTokenError(),
  P0002: () => new ClaimNotFoundError(),
};

/** The same two codes mean something else when the caller is a session: no session, no organization. */
const SESSION_ERRORS: RaisedErrors = {
  "28000": () => new NotSignedInError(),
  P0002: () => new NoOrganizationError(),
};

function failure(error: QueryError, what: string, raised: RaisedErrors = {}): Error {
  if (isMissingSchema(error)) return new DeviceUnavailableError();
  const known = error.code ? raised[error.code] : undefined;
  if (known) return known();
  return new Error(`${what}: ${error.message}`);
}

/**
 * The phone's client: the anon key and no session, so every request runs as Postgres role `anon`.
 *
 * Built per call like `createAdminClient`, and for the same reason — there is no browser session to
 * persist or refresh, and holding one client across requests would only share state between phones
 * that have nothing to do with each other.
 */
function phoneClient() {
  return createSupabaseClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function currentUserId(): Promise<string> {
  const supabase = await createClient();
  // getUser(), never getSession() — the same rule as claimsRepo.ts: a forged cookie satisfies
  // getSession, and only getUser checks with the auth server.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new NotSignedInError();
  return data.user.id;
}

/* ── Cookie side: the Account page and the claim editor ────────────────────────────────────────── */

interface PairingBeginRow {
  id: string;
  expires_at: string;
}

/**
 * A fresh pairing code for this session's user, recorded so a phone can claim it.
 *
 * The code is generated here and only its hash goes to the database, so the row is worth nothing
 * to anyone who reads it. Its ten-minute life is set by the SQL function (interval '600 seconds'),
 * which must agree with `PAIRING_CODE_TTL_SECONDS`. Both the row's own `expires_at` and the TTL
 * come back: the deadline as the database has it, and the number of seconds for the browser to
 * count down from the moment it received the code — a browser's clock is nobody's reference, and a
 * countdown measured against it would show minutes left on a code the database had already refused.
 */
export async function beginPairing(): Promise<{ code: string; expiresAt: string; url: string; ttlSeconds: number }> {
  const supabase = await createClient();
  const code = newPairingCode();
  // Hashed as the eight letters — see the file comment. A code this module just made always normalises.
  const letters = normalisePairingCode(code);
  if (!letters) throw new Error("A freshly minted pairing code did not normalise.");
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("device_pairing_begin", { code_hash: hashSecret(letters) }));
  if (error) throw failure(error, "Could not start pairing", SESSION_ERRORS);
  const row = (data as PairingBeginRow[] | null)?.[0];
  if (!row) throw new Error("Could not start pairing: no pairing row came back.");
  return { code, expiresAt: row.expires_at, url: pairingUrl(code), ttlSeconds: PAIRING_CODE_TTL_SECONDS };
}

interface DeviceTokenRow {
  id: string;
  name: string | null;
  user_id: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * Every phone paired to this session's organization, newest first, revoked ones included.
 *
 * No organization filter — RLS restricts the select to organizations the caller belongs to, and a
 * filter here would only duplicate it. Revoked rows are returned rather than hidden so the list can
 * say "Revoked" against a phone somebody remembers pairing, instead of it silently vanishing.
 */
export async function listDeviceTokens(): Promise<DeviceTokenItem[]> {
  const supabase = await createClient();
  const userId = await currentUserId();
  /*
    REVOKED PHONES ARE NOT LISTED. The row stays — the token has to remain on record to stay
    refused, and it is the only evidence of who paired what — but a revoked phone is finished
    business and there is nothing left to do with it on this screen.

    Listing them was worse than untidy. A phone is re-paired every time the app is reinstalled, so
    the list grew by one on every install and never shrank by anything: revoking, the only control
    offered, turned a row grey and left it where it was. The estimator's words on 2026-09-24: "can
    you also get rid of the old paired phones on scrivn. they just list there forever every time i
    need to re-pair." Revoke now means the phone goes.
  */
  const { data, error } = await withClockSkewRetry(() =>
    supabase
      .from("device_tokens")
      .select("id, name, user_id, created_at, last_used_at, revoked_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  );
  if (error) throw failure(error, "Could not list paired phones");
  return ((data ?? []) as DeviceTokenRow[]).map((row) => ({
    id: row.id,
    name: row.name ?? "",
    userId: row.user_id,
    mine: row.user_id === userId,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

/**
 * Revoke a phone. Returns false when nothing changed, which is what the function says for a token
 * that is not this user's (and they are not an owner), one already revoked, or one that never
 * existed — the route reports all three as 404, for the same reason the claims routes do.
 */
export async function revokeDeviceToken(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("device_token_revoke", { token_id: id }));
  if (error) throw failure(error, "Could not revoke the phone");
  return data === true;
}

interface ClaimScanRow {
  id: string;
  claim_id: string;
  device_token_id: string | null;
  capture_id: string | null;
  captured_at: string | null;
  level: number;
  received_at: string;
  body: unknown;
}

/**
 * The scans waiting on a claim, oldest first — the order they arrived is the order the editor
 * should offer them, since a later scan of the same storey supersedes an earlier one.
 *
 * The phone's name comes from a second select over `device_tokens` rather than an embedded join,
 * because the editor's notice needs one string and RLS on `device_tokens` already lets a member read
 * it. A blank name reads as null so the notice can say "your phone" instead of an empty quote.
 */
export async function pendingScans(claimId: string): Promise<PendingScan[]> {
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() =>
    supabase
      .from("claim_scans")
      .select("id, claim_id, device_token_id, capture_id, captured_at, level, received_at, body")
      .eq("claim_id", claimId)
      .eq("status", "pending")
      .order("received_at", { ascending: true }),
  );
  if (error) throw failure(error, "Could not read pending scans");
  const rows = (data ?? []) as ClaimScanRow[];

  const names = new Map<string, string>();
  const tokenIds = [...new Set(rows.map((r) => r.device_token_id).filter((id): id is string => id !== null))];
  if (tokenIds.length > 0) {
    const tokens = await supabase.from("device_tokens").select("id, name").in("id", tokenIds);
    if (tokens.error) throw failure(tokens.error, "Could not read the phones behind pending scans");
    for (const t of (tokens.data ?? []) as { id: string; name: string | null }[]) names.set(t.id, t.name ?? "");
  }

  return rows.map((row) => {
    const name = row.device_token_id ? (names.get(row.device_token_id) ?? "").trim() : "";
    return {
      id: row.id,
      claimId: row.claim_id,
      captureId: row.capture_id,
      capturedAt: row.captured_at,
      receivedAt: row.received_at,
      level: row.level,
      body: row.body,
      deviceName: name === "" ? null : name,
    };
  });
}

/**
 * Mark a pending scan adopted or discarded. False when nothing changed: already resolved, not this
 * organization's, or not there at all — indistinguishable on purpose, like everything else RLS hides.
 */
export async function resolveScan(scanId: string, status: "adopted" | "discarded"): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.rpc("claim_scan_resolve", { scan_id: scanId, new_status: status }));
  if (error) throw failure(error, "Could not resolve the scan");
  return data === true;
}

/* ── Phone side: bearer token, anon client, SECURITY DEFINER functions only ─────────────────────── */

interface IdentityRow {
  token_id: string;
  organization_id: string;
  organization_name: string | null;
  user_id: string;
  user_name: string | null;
  role?: string | null;
}

function identityFromRow(row: IdentityRow): DeviceIdentity {
  return {
    tokenId: row.token_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name ?? "",
    userId: row.user_id,
    userName: row.user_name ?? "",
    role: row.role === "owner" ? "owner" : "member",
  };
}

/**
 * Trade a pairing code for a device token.
 *
 * The token is minted HERE and returned exactly once; the database sees only its hash, so this
 * return value is the sole copy that ever exists outside the phone. `device_pair` spends the code as
 * it reads it (claimed_at, under a row lock), so a second phone with the same code gets no row, and
 * no row is reported as an invalid code — the same answer as a typo or an expired one, because
 * telling them apart would tell a guesser which codes are live.
 *
 * The role is not part of what `device_pair` returns, so the identity is completed with the token's
 * first `device_identity` lookup — the phone leaves with exactly what `/api/device/me` would say.
 */
export async function pairDevice(code: string, deviceName: string): Promise<{ token: string; identity: DeviceIdentity }> {
  const letters = normalisePairingCode(code);
  if (!letters) throw new InvalidPairingCodeError();
  const token = newDeviceToken();
  const { data, error } = await phoneClient().rpc("device_pair", {
    code_hash: hashSecret(letters),
    token_hash: hashSecret(token),
    device_name: deviceName.trim(),
  });
  if (error) throw failure(error, "Could not pair the phone", PHONE_ERRORS);
  const row = (data as IdentityRow[] | null)?.[0];
  if (!row) throw new InvalidPairingCodeError();
  return { token, identity: await deviceIdentity(token) };
}

/** Who a token is: its organization, the person who paired it, and their role. */
export async function deviceIdentity(token: string): Promise<DeviceIdentity> {
  const { data, error } = await phoneClient().rpc("device_identity", { token_hash: hashSecret(token) });
  if (error) throw failure(error, "Could not identify the phone", PHONE_ERRORS);
  const row = (data as IdentityRow[] | null)?.[0];
  if (!row) throw new InvalidDeviceTokenError();
  return identityFromRow(row);
}

interface DeviceClaimRow {
  id: string;
  customer_name: string | null;
  job_number: string | null;
  address: string | null;
  insurer: string | null;
  status: string | null;
  updated_at: string;
  mine: boolean;
  room_names: unknown;
}

/**
 * The claims a phone may send a scan into: what `listClaims` would show this token's user (owners
 * the whole organization, members their own), with each claim's room names so the phone can offer
 * them as labels. The function decides the scope from the token; nothing is chosen here.
 */
export async function deviceClaims(token: string): Promise<DeviceClaimItem[]> {
  const { data, error } = await phoneClient().rpc("device_claims", { token_hash: hashSecret(token) });
  if (error) throw failure(error, "Could not list claims for the phone", PHONE_ERRORS);
  return ((data ?? []) as DeviceClaimRow[]).map((row) => ({
    id: row.id,
    customerName: row.customer_name ?? "",
    jobNumber: row.job_number ?? "",
    address: row.address ?? "",
    insurer: row.insurer ?? "",
    status: row.status ?? "intake",
    updatedAt: row.updated_at,
    mine: row.mine === true,
    // The function guards the payload shape and hands back '[]' for anything odd; this guards the
    // wire, so a row can never put a non-string into the phone's picker.
    roomNames: Array.isArray(row.room_names) ? row.room_names.filter((n): n is string => typeof n === "string") : [],
  }));
}

interface ReceiveScanRow {
  claim_id: string;
  scan_id: string;
  created: boolean;
}

/**
 * A scan from the phone, into a claim.
 *
 * The token is checked FIRST, before the body is looked at. The route is public and the importer is
 * real work — its cost grows with corners times openings — so an unpaired caller must be turned away
 * before it can make this server draw anything; `device_receive_scan` checks the token again when it
 * writes, which is the check that matters, and this one is what keeps the work behind it. Then the
 * body's size (`scanTooBig`), so even a paired phone cannot hand the importer a capture no room ever
 * produced.
 *
 * Converted before anything is stored: a body the importer cannot draw is refused with the
 * importer's own sentence rather than saved as a pending row the estimator can only fail to adopt.
 * The same conversion then either becomes the new claim's sketch (`sketchFromScan`) or is thrown
 * away, and the raw body is what gets stored — the editor re-converts it at adoption time, at the
 * drop point of whatever is on that storey then, which this server cannot know.
 *
 * A new claim is built the way the browser builds one: a blank `SavedClaimState` with the sketch in
 * it and the summary columns derived by `claimSummary`, so the row is indistinguishable from one the
 * page saved. It is inserted by `device_receive_scan` in the same transaction as its adopted
 * `claim_scans` row, so a claim never exists without the provenance of the scan that made it.
 */
export async function receiveScan(token: string, input: ReceiveScanInput): Promise<ReceivedScan> {
  await deviceIdentity(token);
  const tooBig = scanTooBig(input.body);
  if (tooBig !== null) throw new ScanRejectedError(tooBig);
  const checked = convertScan(input.body, SCAN_DROP, input.level);
  if (!checked.ok) throw new ScanRejectedError(checked.error);
  let roomCount = 1 + checked.extraRooms.length;
  let notes = checked.notes;

  const scanId = randomUUID();
  const receivedAt = new Date().toISOString();

  let newClaim: Record<string, unknown> | null = null;
  if (input.claimId === null) {
    const built = sketchFromScan(input.body, { scanId, captureId: input.captureId, receivedAt, level: input.level });
    // Cannot fail after the check above — same body, same importer — but the type says it can.
    if (!built.ok) throw new ScanRejectedError(built.error);
    const state = emptySavedClaimState();
    state.sketch = built.sketch;
    if (input.customerName !== undefined) state.claim = { ...state.claim, customerName: input.customerName.trim() };
    if (input.address !== undefined) state.claim = { ...state.claim, address: input.address.trim() };
    newClaim = { payload: state, ...claimSummary(state) };
    roomCount = built.roomCount;
    notes = built.notes;
  }

  const { data, error } = await phoneClient().rpc("device_receive_scan", {
    token_hash: hashSecret(token),
    target_claim_id: input.claimId,
    new_scan_id: scanId,
    received_at: receivedAt,
    body: input.body,
    capture_id: input.captureId,
    captured_at: input.capturedAt,
    scan_level: input.level,
    new_claim: newClaim,
  });
  if (error) throw failure(error, "Could not receive the scan", PHONE_ERRORS);
  const row = (data as ReceiveScanRow[] | null)?.[0];
  if (!row) throw new Error("Could not receive the scan: no row came back.");
  return {
    claimId: row.claim_id,
    scanId: row.scan_id,
    created: row.created === true,
    url: claimSketchUrl(row.claim_id),
    roomCount,
    notes,
  };
}
