import { NextResponse } from "next/server";
import { NoOrganizationError, NotSignedInError } from "@/lib/claimsRepo";
import { TeamError, TeamsUnavailableError } from "@/lib/teamRepo";

/**
 * Shared by every /api/team route. Not a route itself — only `route.ts` files are.
 *
 * `teamsOff` is the whole answer while TEAMS_ENABLED is off (lib/teamsGate.ts): a bare 404, the same
 * status a path that does not exist gets, given before anything is read, so the routes neither do
 * anything nor say that they exist.
 */
export function teamsOff() {
  return new NextResponse("Not Found", { status: 404 });
}

/** The JSON body a route reads, or null for one that is missing or not JSON. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function teamErrorResponse(err: unknown) {
  if (err instanceof TeamError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof NotSignedInError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof NoOrganizationError) return NextResponse.json({ error: err.message }, { status: 409 });
  // A migration not yet applied lands here — a real 500, but with a sentence rather than a stack.
  if (err instanceof TeamsUnavailableError) return NextResponse.json({ error: err.message }, { status: 500 });
  console.error("[/api/team]", err);
  return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error." }, { status: 500 });
}
