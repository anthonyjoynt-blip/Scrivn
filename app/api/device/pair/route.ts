import { NextResponse } from "next/server";
import { NoOrganizationError, NotSignedInError } from "@/lib/claimsRepo";
import { bearerToken, looksLikeDeviceToken } from "@/lib/deviceCodes";
import {
  ClaimNotFoundError,
  DeviceUnavailableError,
  InvalidDeviceTokenError,
  InvalidPairingCodeError,
  ScanRejectedError,
  pairDevice,
} from "@/lib/deviceRepo";

/**
 * Pairing: the phone posts the code from the QR (or typed in) and leaves with its device token.
 *
 * Thin on purpose, like the claims routes — `lib/deviceRepo.ts` holds every query and the reasoning
 * about who may do what. Nothing here decides access; it converts errors into status codes. This
 * route is reachable with no session (see `middleware.ts`): the code IS the credential, and the
 * function that spends it is what checks it.
 */

/** Shared by every route under /api/device and /api/devices — one mapping, so a phone and the Account page read the same codes. */
export function errorResponse(err: unknown) {
  if (err instanceof InvalidDeviceTokenError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof NotSignedInError) return NextResponse.json({ error: err.message }, { status: 401 });
  if (err instanceof InvalidPairingCodeError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof ScanRejectedError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof ClaimNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof NoOrganizationError) return NextResponse.json({ error: err.message }, { status: 409 });
  // The migration not being applied yet lands here — a real 500, but with a sentence rather than a stack.
  if (err instanceof DeviceUnavailableError) return NextResponse.json({ error: err.message }, { status: 500 });
  const message = err instanceof Error ? err.message : "Unexpected error.";
  console.error("[/api/device]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * The answer to a bearer route called with no bearer at all — or with one that could not be a device
 * token. Decided from the header alone, before a body is read or a client is built, so an
 * unauthenticated probe costs nothing but this response.
 */
export function notPaired() {
  return NextResponse.json({ error: "Not paired." }, { status: 401 });
}

/** The bearer token when the request carries one of the right shape; null means `notPaired()`. */
export function deviceToken(request: Request): string | null {
  const token = bearerToken(request);
  return token !== null && looksLikeDeviceToken(token) ? token : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { code?: unknown; deviceName?: unknown } | null;
    if (!body || typeof body.code !== "string" || body.code.trim() === "") {
      return NextResponse.json({ error: "Send the pairing code." }, { status: 400 });
    }
    const deviceName = typeof body.deviceName === "string" ? body.deviceName : "";
    const { token, identity } = await pairDevice(body.code, deviceName);
    return NextResponse.json({
      token,
      organization: { id: identity.organizationId, name: identity.organizationName },
      user: { id: identity.userId, name: identity.userName },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
