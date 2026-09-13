import { NextResponse } from "next/server";
import { LOGO_LIMITS } from "@/lib/letterhead";
import { InvalidLetterheadError, removeLogo, setLogo } from "@/lib/organizationRepo";
import { errorResponse } from "../letterhead/route";

/**
 * The logo: upload one (replacing any there is), or remove it.
 *
 * Multipart rather than JSON, so the bytes arrive as bytes — a base64 field would inflate a 1 MB
 * limit into a 1.4 MB request body for no reason. The repo checks that what arrived is a PNG of an
 * acceptable size; the browser is meant to have normalised it to one already.
 */

export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("logo");
    if (!(file instanceof File)) throw new InvalidLetterheadError("Choose an image to upload.");
    // Checked before the bytes are read, so an oversized upload is refused without buffering it.
    if (file.size > LOGO_LIMITS.maxBytes) throw new InvalidLetterheadError("That logo is over 1 MB. Try a smaller image.");
    return NextResponse.json({ state: await setLogo(new Uint8Array(await file.arrayBuffer())) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  try {
    return NextResponse.json({ state: await removeLogo() });
  } catch (err) {
    return errorResponse(err);
  }
}
