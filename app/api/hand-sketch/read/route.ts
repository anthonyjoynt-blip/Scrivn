import { NextResponse } from "next/server";
import { estimateUsd } from "@/lib/aiPricing";
import { createStructuredMessage, ScopingApiError } from "@/lib/anthropic";
import { retryWords } from "@/lib/guardRules";
import { readProblem } from "@/lib/handSketch";
import { HAND_SKETCH_SCHEMA, HAND_SKETCH_SYSTEM, handSketchUserMessage, readFromWire, type HandSketchWire } from "@/lib/handSketchPrompt";
import {
  devFixtureName,
  handSketchDevWithoutAuth,
  handSketchReader,
  handSketchReadsOn,
  HAND_SKETCH_READS_OFF,
  loadDevFixture,
  readHandSketchRequest,
} from "@/lib/handSketchRead";
import { hashForGuard, hitLimit } from "@/lib/requestGuard";
import { checkUsageAllowed } from "@/lib/usage";

/**
 * "Read it for me" on the drop-a-sketch page (2026-11-05): `POST /api/hand-sketch/read` with the
 * photo shrunk in the browser to a JPEG (HAND_SKETCH_MAX_PX on its longest side) and its size in
 * pixels, which the model's coordinates are measured against. One Claude call; the answer comes back
 * as `{ read }` (a HandSketchRead, lib/handSketch.ts) for the page to build rooms from, or `{ error }`.
 *
 * In order, nothing spent before the last step:
 *   400  the body is not a JPEG and its size;
 *        a dev fixture (HAND_SKETCH_READ_FIXTURE, never in production): its recorded read, uncounted;
 *   403  reads are off (SCRIVN_HAND_SKETCH_READS) — the default;
 *   401  nobody signed in; 402 the plan or trial does not allow it, as checkUsageAllowed says;
 *   429  past the account's reads for the day, or everyone's — the second counted only once the
 *        first passes, so one account's refused tries never use up everyone else's;
 *   502  the call failed, or its answer is not rooms.
 *
 * Gated by the plan and not counted against it, as the exterior trace is: a read is part of drawing
 * a sketch, not a claim of its own. The photo is not stored anywhere, and not logged.
 */

export const maxDuration = 60;

/** The recorded reads used 2,200-2,600 tokens out at the default effort; room for a busy page. */
const HAND_SKETCH_MAX_TOKENS = 12000;
/** Reads one account (its organization, or the person alone) may have in a day. */
const READS_PER_ACCOUNT_PER_DAY = 20;
/** Reads everyone together may have in a day: about $15 at the recorded cost. */
const READS_PER_DAY = 300;
const DAY = 86_400;

const ROUTE = "[/api/hand-sketch/read]";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const checked = readHandSketchRequest(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { image, width, height } = checked.req;

  // Development reading a recorded answer back: no call, nothing counted.
  const fixture = devFixtureName();
  if (fixture) {
    try {
      return NextResponse.json({ read: await loadDevFixture(fixture) });
    } catch (err) {
      console.error(ROUTE, err);
      return NextResponse.json({ error: `HAND_SKETCH_READ_FIXTURE=${fixture}: no recorded read at test/handSketch/fixtures/${fixture}.model.json.` }, { status: 500 });
    }
  }

  if (!handSketchReadsOn()) return NextResponse.json({ error: HAND_SKETCH_READS_OFF }, { status: 403 });

  const blocked = await checkUsageAllowed();
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  // With no Supabase in development there is nobody to count against, and nothing to count in.
  if (!handSketchDevWithoutAuth()) {
    const reader = await handSketchReader();
    if (!reader) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const mine = await hitLimit("hand-sketch-org", hashForGuard("account", reader), DAY, READS_PER_ACCOUNT_PER_DAY);
    if (mine) {
      return NextResponse.json(
        { error: `Your account has had ${READS_PER_ACCOUNT_PER_DAY} sketches read today, the most for a day. Try again ${retryWords(mine)}, or trace this one yourself.` },
        { status: 429 },
      );
    }
    const all = await hitLimit("hand-sketch-all", "all", DAY, READS_PER_DAY);
    if (all) {
      return NextResponse.json({ error: `Scrivn has read as many sketches as it can today. Try again ${retryWords(all)}, or trace this one yourself.` }, { status: 429 });
    }
  }

  const started = Date.now();
  try {
    // Effort left at the model's default: the recorded reads in test/handSketch/fixtures were made so.
    const result = await createStructuredMessage<HandSketchWire>({
      system: HAND_SKETCH_SYSTEM,
      userMessage: handSketchUserMessage(width, height),
      schema: HAND_SKETCH_SCHEMA,
      images: [{ mediaType: "image/jpeg", data: image }],
      maxTokens: HAND_SKETCH_MAX_TOKENS,
    });
    const read = readFromWire(result.output);
    const problem = readProblem(read);
    const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
    console.log(
      ROUTE,
      JSON.stringify({
        model,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        image: `${width}x${height}`,
        rooms: read.rooms.length,
        problem,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        costUsd: Math.round(estimateUsd(model, result.usage, process.env) * 10000) / 10000,
      }),
    );
    if (problem) return NextResponse.json({ error: `The photo could not be read as rooms (${problem}). You can still trace it yourself.` }, { status: 502 });
    return NextResponse.json({ read });
  } catch (err) {
    const message = err instanceof ScopingApiError ? err.message : "Reading the sketch failed unexpectedly.";
    console.error(ROUTE, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
