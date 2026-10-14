import { NextResponse } from "next/server";
import { ClaimIdTakenError, createClaim, listClaims, NoOrganizationError, NotSignedInError } from "@/lib/claimsRepo";
import { parseSavedClaimState } from "@/lib/claimState";

/**
 * The claims collection: list them, or create one.
 *
 * Thin on purpose — `lib/claimsRepo.ts` holds every query and the reasoning about who may see what.
 * Nothing here decides access; it converts errors into status codes.
 */

export function errorResponse(err: unknown) {
  if (err instanceof NotSignedInError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof NoOrganizationError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof ClaimIdTakenError) return NextResponse.json({ error: err.message }, { status: 400 });
  const message = err instanceof Error ? err.message : "Unexpected error.";
  console.error("[/api/claims]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** A version-4-shaped UUID, which is what `crypto.randomUUID()` on the device makes. */
const CLAIM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    return NextResponse.json({ claims: await listClaims() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { state?: unknown; id?: unknown } | null;
    /*
      Parsed through `parseSavedClaimState` rather than stored as sent. It fills in anything the
      client omitted and drops anything it does not recognise, so a stored payload always has the
      shape the app can render — a browser posting a half-built object cannot leave a row that
      throws on load for everybody who opens it afterwards.
    */
    const state = parseSavedClaimState(body?.state);
    /*
      The id the device gave a claim it started offline — see `createClaim` for why honouring it is
      what makes this request safe to repeat. Absent from a browser on the previous build.
    */
    const id = body?.id;
    if (id !== undefined && (typeof id !== "string" || !CLAIM_ID.test(id))) {
      return NextResponse.json({ error: "A claim id must be a UUID." }, { status: 400 });
    }
    return NextResponse.json(await createClaim(state, id?.toLowerCase()));
  } catch (err) {
    return errorResponse(err);
  }
}
