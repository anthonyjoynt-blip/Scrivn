import { NextResponse } from "next/server";
import { ScopingApiError } from "@/lib/anthropic";
import { deviceIdentity, ScanLimitError } from "@/lib/deviceRepo";
import { takeScan } from "@/lib/scanAllowance";
import { captureKey } from "@/lib/scanAllowanceRules";
import { EXTERIOR_READS_OFF, exteriorReadsOn, readTraceRequest, runTrace } from "@/lib/traceCall";
import { deviceToken, errorResponse, notPaired } from "../../pair/route";

/**
 * Finish exterior's roof read (2026-10-15): one side's squared photo from Scrivn Scan, traced by the
 * same call the editor makes (`/api/exterior/trace`, lib/traceCall.ts). The phone squares the photo
 * and sets the answer's lines on its edges itself, with Scrivn's own code (lib/scanEngine.ts), so what
 * comes back here is exactly what the editor would show.
 *
 *   POST { captureId, image, frame, side, photos }   200 { proposals, model, seconds, usage, costUsd, allowance }
 *                                                     402 { error, allowance }   the free scans are spent
 *
 * A trace is part of the scan it is read for: the capture is counted here as Share counts it
 * (`takeScan`, "saved" - the two ways a capture is recorded leaving the phone), once, so a capture
 * read here and sent later is one scan. With a device token only: a phone with no account reads no
 * roof, and keeps the assumed one.
 */

export async function POST(request: Request) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  let body: Record<string, unknown> | null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const read = readTraceRequest(body);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
  const id = typeof body?.captureId === "string" ? body.captureId.trim() : "";
  if (id === "" || id.length > 200) return NextResponse.json({ error: "Send the capture's id." }, { status: 400 });
  // Off while the owner tests (2026-10-16): no call and no scan counted. 402 stops the phone asking for the other sides.
  if (!exteriorReadsOn()) return NextResponse.json({ error: EXTERIOR_READS_OFF }, { status: 402 });

  let allowance;
  try {
    const identity = await deviceIdentity(token);
    const use = await takeScan({ organizationId: identity.organizationId, userId: identity.userId, tokenId: identity.tokenId, captureKey: captureKey(id, ""), how: "saved" });
    if (!use.allowed) throw new ScanLimitError(use.allowance);
    allowance = use.allowance;
  } catch (err) {
    return errorResponse(err);
  }

  try {
    return NextResponse.json({ ...(await runTrace(read.trace, "[/api/device/exterior/trace]")), allowance });
  } catch (err) {
    const message = err instanceof ScopingApiError ? err.message : "The trace failed unexpectedly.";
    console.error("[/api/device/exterior/trace]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
