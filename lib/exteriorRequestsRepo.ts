import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ExteriorRequestMessage } from "@/emails/ExteriorRequest";
import { NotSignedInError } from "./claimsRepo";
import { devClaims, devClaimsMode } from "./devClaimsStore";
import { cleanEnv } from "./env";
import { isEmailConfigured, sendEmail } from "./email/send";
import { type ExteriorRequestInput, type ExteriorRequestView, requestView } from "./exteriorRequests";
import { normalizeClaimPhotos } from "./photos";
import { createClient } from "./supabase/server";

/**
 * Every read and write of an exterior request (0016) from the web app, through the MEMBER'S OWN session: the
 * policies decide, so a claim of another organization is simply not found, and a request is filed under the
 * organization its claim belongs to as that session sees it - never one named in the request body.
 *
 * The service role is not used here. Measuring, ready and the result are written by our scripts, and the
 * member's own two moves (withdraw, used) are the definer functions 0016 grants them.
 */

export class RequestClaimMissingError extends Error {
  constructor() {
    super("Claim not found.");
    this.name = "RequestClaimMissingError";
  }
}

/** The claim does not list these photos: its save has not landed yet. The device sends again later. */
export class RequestPhotosNotInClaimError extends Error {
  constructor(readonly missing: string[]) {
    super("That claim does not list these photos yet.");
    this.name = "RequestPhotosNotInClaimError";
  }
}

export class RequestMissingError extends Error {
  constructor() {
    super("Request not found.");
    this.name = "RequestMissingError";
  }
}

/** Withdrawn or used already, or not measured yet: said plainly, nothing changed. */
export class RequestStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestStateError";
  }
}

export class RequestsUnavailableError extends Error {
  constructor() {
    super("Sending to the Scrivn team is not set up on this server yet.");
    this.name = "RequestsUnavailableError";
  }
}

/** The listing's columns; the result is read only for the ones ready to use. */
const VIEW = "id, claim_id, building, building_name, status, note, created_at, ready_at";
const LIST_LIMIT = 20;

function missingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /relation .*exterior_requests.* does not exist|could not find the table/i.test(error.message ?? ""));
}

async function session() {
  const supabase = await createClient();
  // getUser(), never getSession(): see lib/claimsRepo.ts.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new NotSignedInError();
  return { supabase, user: { id: data.user.id, email: data.user.email ?? "" } };
}

export async function listExteriorRequests(claimId: string): Promise<ExteriorRequestView[]> {
  if (devClaimsMode()) return dev.list(claimId);
  const { supabase } = await session();
  const { data, error } = await supabase.from("exterior_requests").select(VIEW).eq("claim_id", claimId).order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (missingTable(error)) return [];
  if (error) throw new Error(`Could not read the requests: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  const ready = rows.filter((r) => r.status === "ready").map((r) => String(r.id));
  const results = new Map<string, unknown>();
  for (const id of ready) {
    const { data: one } = await supabase.from("exterior_requests").select("id, result").eq("id", id).maybeSingle();
    if (one) results.set(id, (one as { result?: unknown }).result ?? null);
  }
  return rows.map((r) => requestView({ ...r, result: results.get(String(r.id)) ?? null }));
}

export async function createExteriorRequest(claimId: string, input: ExteriorRequestInput): Promise<{ request: ExteriorRequestView; created: boolean }> {
  if (devClaimsMode()) return dev.create(claimId, input);
  const { supabase, user } = await session();
  const { data: claim, error: claimError } = await supabase.from("claims").select("organization_id, photos:payload->photos").eq("id", claimId).maybeSingle();
  if (claimError) throw new Error(`Could not look the claim up: ${claimError.message}`);
  if (!claim) throw new RequestClaimMissingError();
  const listed = new Set(normalizeClaimPhotos((claim as { photos?: unknown }).photos).items.map((p) => p.id));
  const missing = input.photoIds.filter((id) => !listed.has(id));
  if (missing.length) throw new RequestPhotosNotInClaimError(missing);

  // Sent again after a lost answer: the same request, answered as it stands.
  const again = async () => {
    const { data } = await supabase.from("exterior_requests").select(VIEW).eq("id", input.id).maybeSingle();
    if (!data) return null;
    if ((data as { claim_id?: unknown }).claim_id !== claimId) throw new RequestMissingError();
    return { request: requestView(data as Record<string, unknown>), created: false };
  };
  const before = await again();
  if (before) return before;

  const { data, error } = await supabase
    .from("exterior_requests")
    .insert({
      id: input.id,
      claim_id: claimId,
      organization_id: (claim as { organization_id: string }).organization_id,
      building: input.building,
      building_name: input.buildingName,
      photo_ids: input.photoIds,
      route: input.route,
      note: input.note,
    })
    .select(VIEW)
    .maybeSingle();
  if (missingTable(error)) throw new RequestsUnavailableError();
  if (error?.code === "23505") {
    const after = await again();
    if (after) return after;
    throw new RequestMissingError();
  }
  if (error || !data) throw new Error(`Could not send it: ${error?.message ?? "no row came back"}`);
  const request = requestView(data as Record<string, unknown>);
  await tellUs(request, input, user.email);
  return { request, created: true };
}

/** "withdraw": the tester takes it back. "applied": they tapped Use it, so it is not offered again. */
export async function actOnExteriorRequest(claimId: string, requestId: string, action: "withdraw" | "applied"): Promise<ExteriorRequestView> {
  if (devClaimsMode()) return dev.act(claimId, requestId, action);
  const { supabase } = await session();
  const { data: row, error } = await supabase.from("exterior_requests").select(VIEW).eq("id", requestId).eq("claim_id", claimId).maybeSingle();
  if (missingTable(error)) throw new RequestMissingError();
  if (error) throw new Error(`Could not look the request up: ${error.message}`);
  if (!row) throw new RequestMissingError();
  const current = requestView(row as Record<string, unknown>);
  // Asked twice (a retry after a lost answer): already done is done.
  if ((action === "withdraw" && current.status === "withdrawn") || (action === "applied" && current.status === "applied")) return current;
  const fn = action === "withdraw" ? "exterior_request_withdraw" : "exterior_request_applied";
  const { data: ok, error: rpcError } = await supabase.rpc(fn, { request_id: requestId });
  if (rpcError) throw new Error(`Could not change the request: ${rpcError.message}`);
  if (ok !== true) {
    throw new RequestStateError(
      action === "withdraw"
        ? current.status === "applied"
          ? "It has been used already."
          : "It cannot be withdrawn now."
        : current.status === "withdrawn"
          ? "It was withdrawn."
          : "It is not measured yet.",
    );
  }
  return { ...current, status: action === "withdraw" ? "withdrawn" : "applied", result: null };
}

/** The notice to us that a house is waiting to be measured. A side effect: the request stands whatever the email does. */
async function tellUs(request: ExteriorRequestView, input: ExteriorRequestInput, from: string): Promise<void> {
  const to = cleanEnv("SCAN_REPORTS_TO") ?? cleanEnv("CONTACT_EMAIL");
  if (!to || !isEmailConfigured()) {
    console.warn("[exterior requests] no SCAN_REPORTS_TO / CONTACT_EMAIL or email not configured; request filed:", request.id);
    return;
  }
  const tapes = (input.route?.buildings ?? []).reduce((n, b) => n + (b.tapes?.length ?? 0), 0);
  const what = input.buildingName || "A house";
  const sent = await sendEmail({
    to,
    subject: `${what} to measure: ${input.photoIds.length} photo${input.photoIds.length === 1 ? "" : "s"}${from ? ` from ${from}` : ""}`,
    react: ExteriorRequestMessage({ id: request.id, from, what, photos: input.photoIds.length, tapes, note: input.note }),
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) ? { replyTo: from } : {}),
  });
  if (!sent.ok) console.error("[exterior requests] notice not sent:", sent.reason, request.id);
}

/* ── Local development, with no Supabase project (lib/devClaimsStore.ts) ─────────────────────────── */

type DevRow = Record<string, unknown> & { id: string; claim_id: string; status: string };
const DEV_FILE = join(process.cwd(), ".next", "dev-exterior-requests.json");

function devRead(): Record<string, DevRow> {
  try {
    return JSON.parse(readFileSync(DEV_FILE, "utf8")) as Record<string, DevRow>;
  } catch {
    return {};
  }
}

function devWrite(rows: Record<string, DevRow>): void {
  mkdirSync(dirname(DEV_FILE), { recursive: true });
  writeFileSync(`${DEV_FILE}.tmp`, JSON.stringify(rows, null, 1));
  renameSync(`${DEV_FILE}.tmp`, DEV_FILE);
}

/**
 * The same answers as the table, kept in a file under .next: a request is marked measuring or ready, with a result,
 * by editing the file - what the scripts do to the real table.
 */
const dev = {
  list(claimId: string): ExteriorRequestView[] {
    return Object.values(devRead())
      .filter((r) => r.claim_id === claimId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, LIST_LIMIT)
      .map((r) => requestView(r));
  },
  create(claimId: string, input: ExteriorRequestInput): { request: ExteriorRequestView; created: boolean } {
    const claim = devClaims.load(claimId);
    if (!claim) throw new RequestClaimMissingError();
    const listed = new Set(claim.state.photos.items.map((p) => p.id));
    const missing = input.photoIds.filter((id) => !listed.has(id));
    if (missing.length) throw new RequestPhotosNotInClaimError(missing);
    const rows = devRead();
    const had = rows[input.id];
    if (had) {
      if (had.claim_id !== claimId) throw new RequestMissingError();
      return { request: requestView(had), created: false };
    }
    const row: DevRow = {
      id: input.id || randomUUID(),
      claim_id: claimId,
      organization_id: "dev",
      building: input.building,
      building_name: input.buildingName,
      photo_ids: input.photoIds,
      route: input.route,
      note: input.note,
      status: "sent",
      result: null,
      created_at: new Date().toISOString(),
      ready_at: null,
    };
    rows[row.id] = row;
    devWrite(rows);
    return { request: requestView(row), created: true };
  },
  act(claimId: string, requestId: string, action: "withdraw" | "applied"): ExteriorRequestView {
    const rows = devRead();
    const row = rows[requestId];
    if (!row || row.claim_id !== claimId) throw new RequestMissingError();
    const to = action === "withdraw" ? "withdrawn" : "applied";
    if (row.status === to) return requestView(row);
    const allowed = action === "withdraw" ? ["sent", "measuring", "ready"].includes(row.status) : row.status === "ready";
    if (!allowed) throw new RequestStateError(action === "withdraw" ? "It cannot be withdrawn now." : "It is not measured yet.");
    row.status = to;
    row[action === "withdraw" ? "withdrawn_at" : "applied_at"] = new Date().toISOString();
    devWrite(rows);
    return requestView(row);
  },
};
