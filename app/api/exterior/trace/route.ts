import { NextResponse } from "next/server";
import { ScopingApiError } from "@/lib/anthropic";
import { readTraceRequest, runTrace } from "@/lib/traceCall";
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
 *
 * The request and the call are lib/traceCall.ts, shared with the phone's `/api/device/exterior/trace`
 * (2026-10-15, Finish exterior), so the two read the roof alike.
 */

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const read = readTraceRequest(body);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });

  const blocked = await checkUsageAllowed();
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  try {
    return NextResponse.json(await runTrace(read.trace, "[/api/exterior/trace]"));
  } catch (err) {
    const message = err instanceof ScopingApiError ? err.message : "The trace failed unexpectedly.";
    console.error("[/api/exterior/trace]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
