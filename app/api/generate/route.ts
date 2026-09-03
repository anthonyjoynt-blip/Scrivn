import { NextResponse } from "next/server";
import { createStructuredMessage, GENERATION_MAX_TOKENS, ScopingApiError } from "@/lib/anthropic";
import { documentGenerationSchema, scopeOnlyGenerationSchema } from "@/lib/schema";
import { DOCUMENT_GENERATION_SYSTEM_PROMPT, SCOPE_ONLY_SYSTEM_PROMPT, documentGenerationUserMessage } from "@/lib/documentGenerationPrompt";
import type { GeneratedDocuments, WaterLossExtraction } from "@/lib/types";
import type { ClaimInfo } from "@/lib/claimInfo";
import type { DGIGData } from "@/lib/dgig";
import { checkUsageAllowed, incrementClaimUsage } from "@/lib/usage";

/**
 * Step 3 of the pipeline: the completed claim info + extraction tree (every gap-check question
 * already answered) in, the inspection report + scope document out — one Structured Outputs call,
 * matching the Android app's `ClaudeScopingClient.generateDocuments`.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { claim, extraction, transcript, contentsAssignmentNote, dgigData } = (body ?? {}) as {
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

  const blocked = await checkUsageAllowed();
  if (blocked) {
    return NextResponse.json({ error: blocked.error }, { status: blocked.status });
  }

  try {
    // Scope-only claims (see claimInfo.ts's `scopeOnly`) use a dedicated system prompt + schema
    // that never mentions an inspection report at all, rather than generating one and discarding
    // it — a claim in this mode never collected the fields (causeOfLoss, preExistingConditions,
    // the rest of Job Information) an inspection report would need, so asking for one anyway would
    // just invite the model to invent them.
    const documents = claim.scopeOnly
      ? await createStructuredMessage<GeneratedDocuments>({
          system: SCOPE_ONLY_SYSTEM_PROMPT,
          userMessage: documentGenerationUserMessage(claim, extraction, transcript, null, dgigData ?? null),
          schema: scopeOnlyGenerationSchema,
          maxTokens: GENERATION_MAX_TOKENS,
        })
      : await createStructuredMessage<GeneratedDocuments>({
          system: DOCUMENT_GENERATION_SYSTEM_PROMPT,
          userMessage: documentGenerationUserMessage(claim, extraction, transcript, contentsAssignmentNote ?? null, dgigData ?? null),
          schema: documentGenerationSchema,
          maxTokens: GENERATION_MAX_TOKENS,
        });
    // Counted only after generation actually succeeded — a failed call shouldn't consume a claim.
    // Deliberately not awaited-and-failed-on: if the increment errors, the user still gets the
    // documents they paid for, and an uncounted claim is a far better outcome than a 502 after the
    // expensive work already completed.
    try {
      await incrementClaimUsage();
    } catch (err) {
      console.error("[/api/generate] usage increment failed (documents still returned):", err);
    }

    return NextResponse.json({ documents });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const message = err instanceof ScopingApiError ? err.message : "Document generation failed unexpectedly.";
  console.error("[/api/generate]", err);
  return NextResponse.json({ error: message }, { status: 502 });
}
