import { NextResponse } from "next/server";
import { createClaim, listClaims, NoOrganizationError, NotSignedInError } from "@/lib/claimsRepo";
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
  const message = err instanceof Error ? err.message : "Unexpected error.";
  console.error("[/api/claims]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ claims: await listClaims() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    /*
      Parsed through `parseSavedClaimState` rather than stored as sent. It fills in anything the
      client omitted and drops anything it does not recognise, so a stored payload always has the
      shape the app can render — a browser posting a half-built object cannot leave a row that
      throws on load for everybody who opens it afterwards.
    */
    const state = parseSavedClaimState((body as { state?: unknown } | null)?.state);
    return NextResponse.json({ id: await createClaim(state) });
  } catch (err) {
    return errorResponse(err);
  }
}
