import { NextResponse } from "next/server";
import { deviceClaims } from "@/lib/deviceRepo";
import { deviceToken, errorResponse, notPaired } from "../pair/route";

/**
 * The claims a phone may send a scan into — the phone's "which job is this?" list.
 *
 * Which claims those are is decided in SQL from the token (owners see the organization, members
 * their own), mirroring `listClaims`. Nothing here filters.
 */

export async function GET(request: Request) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  try {
    return NextResponse.json({ claims: await deviceClaims(token) });
  } catch (err) {
    return errorResponse(err);
  }
}
