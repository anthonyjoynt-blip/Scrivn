import { NextResponse } from "next/server";
import { deleteClaim, loadClaim, saveClaim } from "@/lib/claimsRepo";
import { parseSavedClaimState } from "@/lib/claimState";
import { claimFolders, removeClaimFolders } from "@/lib/claimPhotos";
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
 *
 * ── Versions ─────────────────────────────────────────────────────────────────────────────────────
 *
 * GET answers with the claim's `version`, and a PUT may name the version it was made from as `base`.
 * A PUT whose base is stale is refused with 409 and the claim as it now stands, so the device can
 * keep both copies and ask which to keep — see `saveClaim`. A PUT with no base saves regardless, as
 * every save did before offline mode.
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const stored = await loadClaim(id);
    if (!stored) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
    return NextResponse.json({ state: stored.state, version: stored.version });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { state?: unknown; base?: unknown } | null;
    const state = parseSavedClaimState(body?.state);
    /*
      Checked as a time before it reaches the query, so a malformed one is a 400 here rather than a
      database error the route would report as a 500.
    */
    const base = body?.base;
    if (base !== undefined && base !== null && (typeof base !== "string" || base.length > 64 || Number.isNaN(Date.parse(base)))) {
      return NextResponse.json({ error: "base must be the version the claim was loaded at." }, { status: 400 });
    }
    const saved = await saveClaim(id, state, typeof base === "string" ? base : undefined);
    if (saved.ok) return NextResponse.json({ ok: true, version: saved.version });
    if (saved.reason === "conflict") {
      return NextResponse.json(
        { error: "This claim was changed somewhere else since it was opened here.", conflict: { state: saved.current.state, version: saved.current.version } },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Deleting a claim deletes its pictures too: its site photos and its scans' walk photos (2026-10-14 —
 * the scan photos were left in storage before). Where they are is read first, because the scans'
 * rows go with the claim's, and with them the list of scan folders.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const folders = await claimFolders(id);
    const deleted = await deleteClaim(id);
    if (!deleted) return NextResponse.json({ error: "Claim not found." }, { status: 404 });
    if (folders) await removeClaimFolders(folders);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
