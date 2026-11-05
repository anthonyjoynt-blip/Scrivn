import { NextResponse } from "next/server";
import { ClaimIdTakenError, NoOrganizationError, NotSignedInError } from "@/lib/claimsRepo";

/**
 * The status codes every route under /api/claims (and the scan photos route) answers with.
 *
 * Its own file, not an export of `route.ts`: a route file may export only its HTTP handlers and
 * route config, and Next's generated route types reject anything else.
 */
export function errorResponse(err: unknown) {
  if (err instanceof NotSignedInError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof NoOrganizationError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof ClaimIdTakenError) return NextResponse.json({ error: err.message }, { status: 400 });
  const message = err instanceof Error ? err.message : "Unexpected error.";
  console.error("[/api/claims]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}
