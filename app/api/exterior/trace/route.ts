import { NextResponse } from "next/server";
import { createStructuredMessage, ScopingApiError } from "@/lib/anthropic";
import { MAX_SQUARED_PX, type SquareFrame } from "@/lib/exteriorPhoto";
import { TRACE_PRICE_PER_MILLION, TRACE_SCHEMA, TRACE_SYSTEM_PROMPT, traceCostUsd, traceProposals, type TraceResponse, type TraceSide, traceUserMessage, type TraceWire } from "@/lib/exteriorTrace";
import { checkUsageAllowed } from "@/lib/usage";

/**
 * The AI trace of one side (2026-10-12): `POST /api/exterior/trace` with the side's photo squared up
 * in the browser (lib/exteriorPhoto.ts) - the same image the estimator sees behind the elevation -
 * and the frame it was squared to. One Claude call; the answer comes back as proposals in the side's
 * own feet for the estimator to tick (lib/exteriorTrace.ts).
 *
 * Checked against the plan, as extraction is, and not counted: a trace is part of measuring a claim,
 * and what a scan should cost is the owner's conversation to have. Each call's tokens and its cost at
 * Opus 5.5's price are logged, one line a call, so that conversation has numbers to start from.
 */

/** A squared JPEG is well under a megabyte; base64 adds a third. */
const MAX_IMAGE_BASE64 = 4_000_000;
/** The owner's test: 800-2,700 tokens out at high effort. Room to think, and no streaming needed. */
const TRACE_MAX_TOKENS = 16000;

function finite(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

function readFrame(raw: unknown): SquareFrame | null {
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as Record<string, unknown>;
  const frame = {
    alongMinM: finite(f.alongMinM, -300, 300),
    alongMaxM: finite(f.alongMaxM, -300, 300),
    upMinM: finite(f.upMinM, -100, 100),
    upMaxM: finite(f.upMaxM, -100, 100),
    ppm: finite(f.ppm, 1, 5000),
    width: finite(f.width, 1, MAX_SQUARED_PX + 1),
    height: finite(f.height, 1, MAX_SQUARED_PX + 1),
  };
  return Object.values(frame).every((v) => v !== null) ? (frame as SquareFrame) : null;
}

function readSide(raw: unknown): TraceSide | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const lengthM = finite(s.lengthM, 0.01, 200);
  const bottomLeftM = finite(s.bottomLeftM, -10, 60);
  const bottomRightM = finite(s.bottomRightM, -10, 60);
  if (lengthM === null || bottomLeftM === null || bottomRightM === null) return null;
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 60) : "Side";
  return { name, lengthM, bottomLeftM, bottomRightM, leftEndInPhoto: s.leftEndInPhoto !== false, rightEndInPhoto: s.rightEndInPhoto !== false };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const image = typeof body?.image === "string" ? body.image.replace(/^data:image\/jpeg;base64,/, "") : "";
  const frame = readFrame(body?.frame);
  const side = readSide(body?.side);
  if (!image || image.length > MAX_IMAGE_BASE64 || !image.startsWith("/9j/")) {
    return NextResponse.json({ error: "Send the squared photo as a JPEG under 3 MB." }, { status: 400 });
  }
  if (!frame || !side) return NextResponse.json({ error: "The photo's frame and the side are needed to trace it." }, { status: 400 });

  const blocked = await checkUsageAllowed();
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const started = Date.now();
  try {
    const result = await createStructuredMessage<TraceWire>({
      system: TRACE_SYSTEM_PROMPT,
      userMessage: traceUserMessage(frame, side),
      schema: TRACE_SCHEMA,
      images: [{ mediaType: "image/jpeg", data: image }],
      // The owner's test: high put windows and peaks within 1/2"; medium within 2/3", for $0.025 less.
      effort: "high",
      maxTokens: TRACE_MAX_TOKENS,
    });
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const costUsd = traceCostUsd(result.usage);
    const model = process.env.ANTHROPIC_MODEL?.trim() || TRACE_PRICE_PER_MILLION.model;
    console.log(
      "[/api/exterior/trace]",
      JSON.stringify({
        side: side.name,
        model,
        seconds,
        image: `${frame.width}x${frame.height}`,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        costUsd: Math.round(costUsd * 10000) / 10000,
        priced: `${TRACE_PRICE_PER_MILLION.model} at $${TRACE_PRICE_PER_MILLION.input}/$${TRACE_PRICE_PER_MILLION.output} per million`,
      }),
    );
    const answer: TraceResponse = { proposals: traceProposals(result.output, frame, side.lengthM / 0.3048), model, seconds, usage: result.usage, costUsd };
    return NextResponse.json(answer);
  } catch (err) {
    const message = err instanceof ScopingApiError ? err.message : "The trace failed unexpectedly.";
    console.error("[/api/exterior/trace]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
