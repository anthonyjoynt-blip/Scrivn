import { NextResponse } from "next/server";
import { createStructuredMessage, ScopingApiError } from "@/lib/anthropic";
import { TRACE_PRICE_PER_MILLION, traceCostUsd } from "@/lib/exteriorTrace";
import {
  METER_PHOTO_SCHEMA,
  METER_PHOTO_SYSTEM_PROMPT,
  meterPhotoUserMessage,
  parseMeterPhoto,
  readMeterPhotoRequest,
  type MeterPhotoResponse,
  type MeterPhotoWire,
} from "@/lib/meterPhoto";
import { checkUsageAllowed } from "@/lib/usage";

/**
 * A photo of a meter's screen, read for the drying log (2026-10-14): `POST /api/drying/meter-photo`
 * with the photo shrunk in the browser to a JPEG (METER_PHOTO_MAX_PX on its longest side) and what it
 * is for. One Claude call; the answer comes back as the number for the field, or why there is none.
 *
 * The photo is not stored anywhere: it is in this request and the call, and nowhere after.
 *
 * Gated like the exterior trace (a plan or a trial) and not counted against the plan: reading a
 * meter is part of a claim, not a claim of its own. Each call's tokens and cost are logged, one line
 * a call, so what the drying log costs to run has numbers behind it. The price table is the trace's:
 * the same model, so one place to change it.
 */

/** Low effort: reading digits needs eyes, not deliberation. Room for the thinking low still does. */
const METER_PHOTO_MAX_TOKENS = 4000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const req = readMeterPhotoRequest(body);
  if (!req) return NextResponse.json({ error: "Send the photo as a JPEG under 2 MB, and say whether it is a moisture or an air reading." }, { status: 400 });

  const blocked = await checkUsageAllowed();
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const started = Date.now();
  try {
    const result = await createStructuredMessage<MeterPhotoWire>({
      system: METER_PHOTO_SYSTEM_PROMPT,
      userMessage: meterPhotoUserMessage(req.kind),
      schema: METER_PHOTO_SCHEMA,
      images: [{ mediaType: "image/jpeg", data: req.image }],
      effort: "low",
      maxTokens: METER_PHOTO_MAX_TOKENS,
    });
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const costUsd = traceCostUsd(result.usage);
    const model = process.env.ANTHROPIC_MODEL?.trim() || TRACE_PRICE_PER_MILLION.model;
    const reading = parseMeterPhoto(result.output, req.kind, req.tempUnit);
    console.log(
      "[/api/drying/meter-photo]",
      JSON.stringify({
        kind: req.kind,
        model,
        seconds,
        read: reading.problem === null,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        costUsd: Math.round(costUsd * 10000) / 10000,
      }),
    );
    const answer: MeterPhotoResponse = { reading, model, seconds, costUsd };
    return NextResponse.json(answer);
  } catch (err) {
    const message = err instanceof ScopingApiError ? err.message : "Reading the photo failed unexpectedly.";
    console.error("[/api/drying/meter-photo]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
