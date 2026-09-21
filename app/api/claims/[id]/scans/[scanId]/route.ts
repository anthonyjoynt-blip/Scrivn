import { NextResponse } from "next/server";
import { resolveScan } from "@/lib/deviceRepo";
import { errorResponse } from "../../../route";

/**
 * One pending scan: the editor says what became of it.
 *
 * "adopted" after it has applied the rooms and saved; "discarded" when the estimator declined. Either
 * way the row stops being pending and stops being offered — the body is kept, because a scan the
 * estimator discarded on a Tuesday is still the record of what the phone saw.
 *
 * The claim id in the path addresses the scan the way the editor thinks of it; the function decides
 * by the scan's own organization and the caller's membership in it, which is the check that matters.
 * 404 for nothing changed — already resolved, not this organization's, or never there — for the
 * reason the claims routes give.
 */

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; scanId: string }> }) {
  try {
    const { scanId } = await params;
    const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
    const status = body?.status;
    if (status !== "adopted" && status !== "discarded") {
      return NextResponse.json({ error: "status must be adopted or discarded." }, { status: 400 });
    }
    const resolved = await resolveScan(scanId, status);
    if (!resolved) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
