import { NextResponse } from "next/server";
import { disposalLines, type RoomAreasByName } from "@/lib/debris";
import { createStructuredMessage, GENERATION_MAX_TOKENS, ScopingApiError } from "@/lib/anthropic";
import { documentGenerationSchema, scopeOnlyGenerationSchema } from "@/lib/schema";
import { DOCUMENT_GENERATION_SYSTEM_PROMPT, SCOPE_ONLY_SYSTEM_PROMPT, documentGenerationUserMessage } from "@/lib/documentGenerationPrompt";
import type { GeneratedDocuments, WaterLossExtraction } from "@/lib/types";
import type { ClaimInfo } from "@/lib/claimInfo";
import type { DGIGData } from "@/lib/dgig";
import { beginGeneration, checkUsageAllowed, incrementClaimUsage, releaseGeneration } from "@/lib/usage";

/**
 * Step 3 of the pipeline: the completed claim info + extraction tree (every gap-check question
 * already answered) in, the inspection report + scope document out — one Structured Outputs call,
 * matching the Android app's `ClaudeScopingClient.generateDocuments`.
 *
 * `jobId` (2026-10-14): the device's id for this generation, the same on every retry (lib/aiJobs.ts).
 * A retry after a lost answer gets the documents already made, without a second Claude call or a
 * second count; one that arrives while the first is still running is told to wait (409, `running`).
 * See `beginGeneration` in lib/usage.ts. A request without one is generated and counted as before.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { claim, extraction, transcript, contentsAssignmentNote, dgigData, roomAreas, exterior, jobId } = (body ?? {}) as {
    /** The device's id for this generation, kept for every retry. Optional: the pipeline harness sends none. */
    jobId?: unknown;
    /** What the sketch knows about each room, keyed by normalised name — see lib/debris.ts. Optional: the pipeline harness sends none. */
    roomAreas?: RoomAreasByName;
    /** The exterior's ready-made scope lines — see lib/exterior.ts's `exteriorScopeLines`. Optional: absent means none. */
    exterior?: unknown;
    claim?: ClaimInfo;
    extraction?: WaterLossExtraction;
    transcript?: string;
    /** See documentGenerationPrompt.ts's documentGenerationUserMessage doc comment — computed client-side, sent only when Contents is selected alongside structural scope. */
    contentsAssignmentNote?: string | null;
    /** See dgig.ts's doc comment — computed client-side, sent only for a DGIG claim whose DGIG form has content (lib/dgig.ts's hasDGIGContent). */
    dgigData?: DGIGData | null;
  };

  if (!claim || typeof claim !== "object") {
    return NextResponse.json({ error: "A \"claim\" object is required." }, { status: 400 });
  }
  if (!extraction || typeof extraction !== "object" || !Array.isArray(extraction.rooms)) {
    return NextResponse.json({ error: "An \"extraction\" object (with a rooms array) is required." }, { status: 400 });
  }
  if (typeof transcript !== "string") {
    return NextResponse.json({ error: "A \"transcript\" string is required." }, { status: 400 });
  }

  // Strings only, and not many: these are copied onto the document word for word.
  const exteriorLines = Array.isArray(exterior) ? exterior.filter((l): l is string => typeof l === "string" && l.length <= 300).slice(0, 40) : [];

  // Before the gate: a repeat of the generation that used the last claim still gets its documents.
  const start = await beginGeneration(jobId);
  if (start.state === "done") {
    return NextResponse.json({ documents: start.documents, usage: [], repeated: true });
  }
  if (start.state === "running") {
    return NextResponse.json({ error: "These documents are still being generated from an earlier try.", running: true }, { status: 409 });
  }

  const blocked = await checkUsageAllowed();
  if (blocked) {
    await releaseGeneration(start);
    return NextResponse.json({ error: blocked.error }, { status: blocked.status });
  }

  try {
    // Scope-only claims (see claimInfo.ts's `scopeOnly`) use a dedicated system prompt + schema
    // that never mentions an inspection report at all, rather than generating one and discarding
    // it — a claim in this mode never collected the fields (causeOfLoss, preExistingConditions,
    // the rest of Job Information) an inspection report would need, so asking for one anyway would
    // just invite the model to invent them.
    const generated = claim.scopeOnly
      ? await createStructuredMessage<GeneratedDocuments>({
          system: SCOPE_ONLY_SYSTEM_PROMPT,
          userMessage: documentGenerationUserMessage(claim, extraction, transcript, null, dgigData ?? null, disposalLines(extraction, roomAreas ?? {}), exteriorLines),
          schema: scopeOnlyGenerationSchema,
          maxTokens: GENERATION_MAX_TOKENS,
        })
      : await createStructuredMessage<GeneratedDocuments>({
          system: DOCUMENT_GENERATION_SYSTEM_PROMPT,
          userMessage: documentGenerationUserMessage(claim, extraction, transcript, contentsAssignmentNote ?? null, dgigData ?? null, disposalLines(extraction, roomAreas ?? {}), exteriorLines),
          schema: documentGenerationSchema,
          maxTokens: GENERATION_MAX_TOKENS,
        });
    // Counted only after generation actually succeeded — a failed call shouldn't consume a claim.
    // Deliberately not awaited-and-failed-on: if the increment errors, the user still gets the
    // documents they paid for, and an uncounted claim is a far better outcome than a 502 after the
    // expensive work already completed.
    try {
      await incrementClaimUsage(start.state === "new" ? { id: start.id, documents: generated.output } : undefined);
    } catch (err) {
      console.error("[/api/generate] usage increment failed (documents still returned):", err);
    }

    // See the extract route: counts travel with the result so a caller can see what a claim cost.
    return NextResponse.json({ documents: generated.output, usage: [{ call: "generate", ...generated.usage }] });
  } catch (err) {
    await releaseGeneration(start);
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const message = err instanceof ScopingApiError ? err.message : "Document generation failed unexpectedly.";
  console.error("[/api/generate]", err);
  return NextResponse.json({ error: message }, { status: 502 });
}
