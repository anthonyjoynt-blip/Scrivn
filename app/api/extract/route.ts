import { NextResponse } from "next/server";
import { createStructuredMessage, ScopingApiError, type CallUsage } from "@/lib/anthropic";
import { extractionDetailSchema, extractionSchema } from "@/lib/schema";
import { EXTRACTION_SYSTEM_PROMPT, extractionUserMessage } from "@/lib/extractionPrompt";
import { wireToDomain, type ExtractionResponseWire } from "@/lib/extractionWire";
import { EXTRACTION_DETAIL_SYSTEM_PROMPT, extractionDetailUserMessage } from "@/lib/extractionDetailPrompt";
import { mergeDetail, needsDetailPass, type ExtractionDetailWire } from "@/lib/extractionDetailWire";
import { withDerivedFields, type WaterLossExtraction } from "@/lib/types";
import { checkUsageAllowed } from "@/lib/usage";

/**
 * Step 1 of the pipeline: raw transcript in, structured `WaterLossExtraction` out. Server-side
 * only — this is the only place the transcript and `ANTHROPIC_API_KEY` ever meet; the browser
 * calls this route, never the Anthropic API directly.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const transcript = (body as { transcript?: unknown } | null)?.transcript;
  if (typeof transcript !== "string" || transcript.trim() === "") {
    return NextResponse.json({ error: "A non-empty \"transcript\" string is required." }, { status: 400 });
  }

  // Checked but NOT counted here — a claim is counted once, on generation (see lib/usage.ts).
  // Refusing early matters anyway: extraction is the expensive call, and spending it on a claim the
  // user can't finish generating would burn both their time and an API call for nothing.
  const blocked = await checkUsageAllowed();
  if (blocked) {
    return NextResponse.json({ error: blocked.error }, { status: blocked.status });
  }

  try {
    const structure = await createStructuredMessage<ExtractionResponseWire>({
      system: EXTRACTION_SYSTEM_PROMPT,
      userMessage: extractionUserMessage(transcript),
      schema: extractionSchema,
    });
    const extraction = withDerivedFields(wireToDomain(structure.output));
    const detailed = await withDetail(transcript, extraction);
    /*
      Token usage travels back with the result so a caller can see what a claim cost. The UI ignores
      it; `test/pipeline` reports it. Counts only — a dollar figure needs a rate that changes without
      this code changing, so pricing stays with whoever is asking.
    */
    return NextResponse.json({
      extraction: detailed.extraction,
      usage: [
        { call: "extract:structure", ...structure.usage },
        ...(detailed.usage ? [{ call: "extract:detail", ...detailed.usage }] : []),
      ],
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * The detail pass — a second, smaller call carrying the spec fields the main schema has no room for.
 * See `schema.ts`'s detail-pass block for why it exists and `extractionDetailWire.ts` for the merge.
 *
 * Best-effort by construction, and that is the point of the try/catch rather than an oversight: this
 * pass can only ADD detail that gap-check would otherwise ask for. Letting it fail the request would
 * trade a handful of saved questions for losing the claim, which is a bad trade in every direction.
 * A failure here lands the PM exactly where they are today — asked, rather than told.
 */
async function withDetail(
  transcript: string,
  extraction: WaterLossExtraction,
): Promise<{ extraction: WaterLossExtraction; usage: CallUsage | null }> {
  if (!needsDetailPass(extraction)) return { extraction, usage: null };
  try {
    const detail = await createStructuredMessage<ExtractionDetailWire>({
      system: EXTRACTION_DETAIL_SYSTEM_PROMPT,
      userMessage: extractionDetailUserMessage(transcript, extraction),
      schema: extractionDetailSchema,
    });
    return { extraction: withDerivedFields(mergeDetail(extraction, detail.output)), usage: detail.usage };
  } catch (err) {
    console.error("[/api/extract] detail pass failed, continuing without it", err);
    return { extraction, usage: null };
  }
}

function errorResponse(err: unknown) {
  const message = err instanceof ScopingApiError ? err.message : "Extraction failed unexpectedly.";
  console.error("[/api/extract]", err);
  return NextResponse.json({ error: message }, { status: 502 });
}
