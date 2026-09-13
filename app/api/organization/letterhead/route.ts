import { NextResponse } from "next/server";
import { NoOrganizationError, NotSignedInError } from "@/lib/claimsRepo";
import { InvalidLetterheadError, LetterheadUnavailableError, NotOwnerError, loadLetterhead, updateLetterheadSettings } from "@/lib/organizationRepo";

/**
 * The organization's letterhead: read it for a document, or save the editable half of it.
 *
 * Thin on purpose, like the claims routes — `lib/organizationRepo.ts` holds every query and the
 * reasoning about who may change what. Nothing here decides access; it converts errors into
 * status codes.
 */

export function errorResponse(err: unknown) {
  if (err instanceof NotSignedInError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof NotOwnerError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof NoOrganizationError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof InvalidLetterheadError) return NextResponse.json({ error: err.message }, { status: 400 });
  // The migration not being applied yet lands here — a real 500, but with a sentence rather than a stack.
  if (err instanceof LetterheadUnavailableError) return NextResponse.json({ error: err.message }, { status: 500 });
  const message = err instanceof Error ? err.message : "Unexpected error.";
  console.error("[/api/organization]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** What documents draw. The default, never an error, when the organization has not set one up. */
export async function GET() {
  try {
    return NextResponse.json({ letterhead: await loadLetterhead() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json({ state: await updateLetterheadSettings((body as { settings?: unknown } | null)?.settings) });
  } catch (err) {
    return errorResponse(err);
  }
}
