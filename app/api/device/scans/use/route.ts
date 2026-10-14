import { NextResponse } from "next/server";
import { deviceIdentity, ScanLimitError } from "@/lib/deviceRepo";
import { takeScan } from "@/lib/scanAllowance";
import { captureKey } from "@/lib/scanAllowanceRules";
import { deviceToken, errorResponse, notPaired } from "../../pair/route";

/**
 * A scan leaving the phone some other way than Send (sa-free): Share, which saves the plan as a PDF
 * and a JPG on the phone. The phone asks here first, and makes the plan only when the answer is yes.
 * A capture counted before — sent, or shared before — is always yes and costs nothing.
 *
 *   POST { captureId }    200 { allowed: true, counted, allowance }
 *                         402 { error, allowance }   the free scans are spent; the sentence names
 *                                                    scrivn.ca/scan in plain text for the phone to show
 *
 * The phone does not ask when it has no account (signed out, never paired): Share works there as it
 * always has. See lib/scanAllowanceRules.ts.
 */

export async function POST(request: Request) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  try {
    const body = (await request.json().catch(() => null)) as { captureId?: unknown } | null;
    const id = typeof body?.captureId === "string" ? body.captureId.trim() : "";
    if (id === "" || id.length > 200) return NextResponse.json({ error: "Send the capture's id." }, { status: 400 });
    const identity = await deviceIdentity(token);
    const use = await takeScan({
      organizationId: identity.organizationId,
      userId: identity.userId,
      tokenId: identity.tokenId,
      captureKey: captureKey(id, ""),
      how: "saved",
    });
    if (!use.allowed) throw new ScanLimitError(use.allowance);
    return NextResponse.json({ allowed: true, counted: use.counted, allowance: use.allowance });
  } catch (err) {
    return errorResponse(err);
  }
}
