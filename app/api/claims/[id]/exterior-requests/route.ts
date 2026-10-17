import { NextResponse } from "next/server";
import { parseExteriorRequestInput } from "@/lib/exteriorRequests";
import {
  createExteriorRequest,
  listExteriorRequests,
  RequestClaimMissingError,
  RequestMissingError,
  RequestPhotosNotInClaimError,
  RequestsUnavailableError,
} from "@/lib/exteriorRequestsRepo";
import { errorResponse } from "../../route";

/**
 * Send to Scrivn team (0016): a claim's exterior sent for us to measure from its photos and tapes.
 *
 *   GET  /api/claims/<id>/exterior-requests   { requests: [...] } newest first; the result only on one ready to use
 *   POST /api/claims/<id>/exterior-requests   { id, building, buildingName, photoIds, route, note } -> { request }
 *
 * Over the member's own session (lib/exteriorRequestsRepo.ts), so a claim of another organization is not found -
 * the same 404 as a claim that does not exist. A POST names its own id, chosen on the device, and is safe to send
 * twice. Photos the claim does not list yet are a 409 the device treats as "later": its save is behind.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ requests: [] });
    return NextResponse.json({ requests: await listExteriorRequests(id.toLowerCase()) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
    const parsed = parseExteriorRequestInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { request: sent, created } = await createExteriorRequest(id.toLowerCase(), parsed.value);
    return NextResponse.json({ request: sent, created });
  } catch (err) {
    if (err instanceof RequestClaimMissingError || err instanceof RequestMissingError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof RequestPhotosNotInClaimError) return NextResponse.json({ error: err.message, code: "not-in-claim", missing: err.missing }, { status: 409 });
    if (err instanceof RequestsUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    return errorResponse(err);
  }
}
