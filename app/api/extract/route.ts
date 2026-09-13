import { NextResponse } from "next/server";
import { createStructuredMessage, ScopingApiError, type CallUsage } from "@/lib/anthropic";
import { extractionDetailSchema, extractionSchema } from "@/lib/schema";
import { EXTRACTION_SYSTEM_PROMPT, extractionUserMessage } from "@/lib/extractionPrompt";
import { wireToDomain, type ExtractionResponseWire } from "@/lib/extractionWire";
import { EXTRACTION_DETAIL_SYSTEM_PROMPT, extractionDetailUserMessage } from "@/lib/extractionDetailPrompt";
import { mergeDetail, needsDetailPass, type ExtractionDetailWire } from "@/lib/extractionDetailWire";
import { EXTRACTION_UNSCOPED_SYSTEM_PROMPT, extractionUnscopedUserMessage, mergeUnscoped, needsUnscopedPass, type ExtractionUnscopedWire } from "@/lib/extractionUnscoped";
import { extractionUnscopedSchema } from "@/lib/schema";
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
    const swept = await withUnscoped(transcript, detailed.extraction);
    /*
      Token usage travels back with the result so a caller can see what a claim cost. The UI ignores
      it; `test/pipeline` reports it. Counts only — a dollar figure needs a rate that changes without
      this code changing, so pricing stays with whoever is asking.

      Warnings travel back too. The two later passes are fail-soft, and a pass that fails quietly is
      a claim missing everything that pass carries with nothing to say so — which is how the detail
      pass hitting the grammar ceiling went unnoticed for a whole run. The page shows them; the
      pipeline harness prints them at the top of the trace.
    */
    return NextResponse.json({
      extraction: swept.extraction,
      usage: [
        { call: "extract:structure", ...structure.usage },
        ...(detailed.usage ? [{ call: "extract:detail", ...detailed.usage }] : []),
        ...(swept.usage ? [{ call: "extract:unscoped", ...swept.usage }] : []),
      ],
      warnings: [...(detailed.warning ? [detailed.warning] : []), ...(swept.warning ? [swept.warning] : [])],
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
): Promise<{ extraction: WaterLossExtraction; usage: CallUsage | null; warning: string | null }> {
  if (!needsDetailPass(extraction)) return { extraction, usage: null, warning: null };
  try {
    const detail = await createStructuredMessage<ExtractionDetailWire>({
      system: EXTRACTION_DETAIL_SYSTEM_PROMPT,
      userMessage: extractionDetailUserMessage(transcript, extraction),
      schema: extractionDetailSchema,
    });
    return { extraction: withDerivedFields(mergeDetail(extraction, detail.output)), usage: detail.usage, warning: null };
  } catch (err) {
    console.error("[/api/extract] detail pass failed, continuing without it", err);
    return { extraction, usage: null, warning: `The detail pass did not run (${reason(err)}). Spec such as trim, appliances and door types will need to be answered rather than read from the transcript.` };
  }
}

/**
 * The third call: what did the first two miss? See `extractionUnscoped.ts`.
 *
 * Fail-soft on the same reasoning as the detail pass, with one difference in what a failure costs:
 * this pass is the guarantee that nothing the PM said vanishes silently, so its failure is reported
 * rather than merely logged — a warning the page shows, so the PM knows to read the transcript
 * against the questions themselves this once.
 */
async function withUnscoped(
  transcript: string,
  extraction: WaterLossExtraction,
): Promise<{ extraction: WaterLossExtraction; usage: CallUsage | null; warning: string | null }> {
  if (!needsUnscopedPass(extraction)) return { extraction, usage: null, warning: null };
  try {
    const sweep = await createStructuredMessage<ExtractionUnscopedWire>({
      system: EXTRACTION_UNSCOPED_SYSTEM_PROMPT,
      userMessage: extractionUnscopedUserMessage(transcript, extraction),
      schema: extractionUnscopedSchema,
    });
    return { extraction: mergeUnscoped(extraction, sweep.output), usage: sweep.usage, warning: null };
  } catch (err) {
    console.error("[/api/extract] unscoped pass failed, continuing without it", err);
    return { extraction, usage: null, warning: `The check for work with no field did not run (${reason(err)}). Anything the transcript mentions that the questions do not cover will need adding by hand.` };
  }
}

/** The API's own sentence where there is one, so a grammar ceiling reads as a grammar ceiling and not as "failed". */
function reason(err: unknown): string {
  return err instanceof Error ? err.message.replace(/^Claude API call failed: /, "").slice(0, 200) : "unknown error";
}

function errorResponse(err: unknown) {
  const message = err instanceof ScopingApiError ? err.message : "Extraction failed unexpectedly.";
  console.error("[/api/extract]", err);
  return NextResponse.json({ error: message }, { status: 502 });
}
