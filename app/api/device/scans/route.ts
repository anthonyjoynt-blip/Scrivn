import { NextResponse } from "next/server";
import { receiveScan } from "@/lib/deviceRepo";
import { deviceToken, errorResponse, notPaired } from "../pair/route";

/**
 * A scan arrives from the phone: into the claim it names, or as a brand-new claim when it names none.
 *
 * The body is checked for SHAPE here — is there a capture, does `claimId` look like an id, is `level`
 * a whole number — and for MEANING in the repo, where the importer decides whether the capture will
 * draw. The split keeps this file to what a route can know from the wire alone.
 *
 * ── The size limit ───────────────────────────────────────────────────────────────────────────────
 *
 * A taps capture is a few kilobytes — the multi-room fixture in test/sketch/fixtures is five. Two
 * megabytes is a ceiling nothing legitimate approaches, and it is applied BEFORE the body is parsed:
 * `JSON.parse` on tens of megabytes of hostile input is the expensive step, and the declared length
 * is refused before a byte is read when the client sends one.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function tooLarge() {
  return NextResponse.json({ error: "That scan is over 2 MB." }, { status: 413 });
}

export async function POST(request: Request) {
  const token = deviceToken(request);
  if (!token) return notPaired();
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
    const text = await request.text();
    // The header is the client's word; the bytes are the fact.
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return tooLarge();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return bad("Send the scan as JSON.");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return bad("Send the scan as a JSON object.");
    const body = parsed as Record<string, unknown>;

    // Null is as missing as absent: neither can be a capture, and storing one would only give the
    // estimator a scan that cannot be adopted.
    if (body.capture === undefined || body.capture === null) return bad("Send the capture.");

    let claimId: string | null = null;
    if (body.claimId !== undefined && body.claimId !== null) {
      if (typeof body.claimId !== "string" || !UUID.test(body.claimId)) return bad("claimId must be a claim id.");
      claimId = body.claimId;
    }

    let level = 0;
    if (body.level !== undefined) {
      if (typeof body.level !== "number" || !Number.isSafeInteger(body.level)) return bad("level must be a whole number.");
      level = body.level;
    }

    const captureId = typeof body.captureId === "string" && body.captureId.trim() !== "" ? body.captureId.trim() : null;
    /*
      Normalised to ISO or dropped, never passed through. The column is timestamptz and Postgres
      refuses a string it cannot read — which would fail the whole scan over the least important
      thing in it. When the phone said happened is worth keeping; it is not worth losing the scan.
    */
    const capturedAt =
      typeof body.capturedAt === "string" && !Number.isNaN(Date.parse(body.capturedAt)) ? new Date(body.capturedAt).toISOString() : null;

    const received = await receiveScan(token, {
      claimId,
      body: body.capture,
      captureId,
      capturedAt,
      level,
      customerName: typeof body.customerName === "string" ? body.customerName : undefined,
      address: typeof body.address === "string" ? body.address : undefined,
    });
    return NextResponse.json({
      id: received.claimId,
      url: received.url,
      created: received.created,
      scanId: received.scanId,
      roomCount: received.roomCount,
      notes: received.notes,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
