import { NextResponse } from "next/server";
import { pendingScans } from "@/lib/deviceRepo";
import { errorResponse } from "../../route";

/**
 * The scans waiting on a claim — what the editor polls to find out a phone has sent something.
 *
 * Read over the cookie session like the claim itself, so RLS on `claim_scans` decides what is
 * visible: another organization's scans are not there, and a claim id that is not this
 * organization's yields an empty list rather than an error, exactly as its claim would yield 404.
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ scans: await pendingScans(id) });
  } catch (err) {
    return errorResponse(err);
  }
}
