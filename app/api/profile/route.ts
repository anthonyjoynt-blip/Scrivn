import { NextResponse } from "next/server";
import { NotSignedInError } from "@/lib/claimsRepo";
import { InvalidProfileError, loadProfile, updateProfile } from "@/lib/profileRepo";

/** The person's own details: read them for a new claim, or save them from the account page. */

function errorResponse(err: unknown) {
  if (err instanceof NotSignedInError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof InvalidProfileError) return NextResponse.json({ error: err.message }, { status: 400 });
  const message = err instanceof Error ? err.message : "Unexpected error.";
  console.error("[/api/profile]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ profile: await loadProfile() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json({ profile: await updateProfile((body as { profile?: unknown } | null)?.profile) });
  } catch (err) {
    return errorResponse(err);
  }
}
