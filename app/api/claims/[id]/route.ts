import { NextResponse } from "next/server";
import { deleteClaim, loadClaim, saveClaim } from "@/lib/claimsRepo";
import { parseSavedClaimState } from "@/lib/claimState";
import { errorResponse } from "../route";

/**
 * One claim: load it, overwrite it, or delete it.
 *
 * ── Why a missing claim and someone else's claim both return 404 ─────────────────────────────────
 *
 * RLS makes another organization's row invisible rather than forbidden, so a query for it returns
 * nothing — indistinguishable, here, from an id that never existed. That is the right answer to send
 * back as well: a 403 would confirm the claim exists, which tells an attacker enumerating ids
 * exactly which ones are real. So both are 404, and the code below never has to decide which case it
 * is looking at because it genuinely cannot tell.
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const state = await loadClaim(id);
    if (!state) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
    return NextResponse.json({ state });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const state = parseSavedClaimState((body as { state?: unknown } | null)?.state);
    const saved = await saveClaim(id, state);
    if (!saved) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await deleteClaim(id);
    if (!deleted) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
