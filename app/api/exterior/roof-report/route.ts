import { NextResponse } from "next/server";
import { createStructuredMessage, ScopingApiError } from "@/lib/anthropic";
import { TRACE_PRICE_PER_MILLION, traceCostUsd } from "@/lib/exteriorTrace";
import {
  pdfPageCount,
  ROOF_REPORT_MAX_BYTES,
  ROOF_REPORT_SCHEMA,
  ROOF_REPORT_SYSTEM_PROMPT,
  roofReportFromWire,
  type RoofReportResponse,
  roofReportUserMessage,
  type RoofReportWire,
} from "@/lib/roofReport";
import { checkUsageAllowed } from "@/lib/usage";

/**
 * A roof report read (2026-10-15): `POST /api/exterior/roof-report` with the PDF as the form field
 * `file`. One Claude call; the answer comes back as what the report says, for the estimator to take
 * box by box (lib/roofReport.ts). Nothing is applied here.
 *
 * The PDF is not stored anywhere: it is in this request and the call, and nowhere after.
 *
 * Gated like the exterior trace (a plan or a trial) and not counted against the plan: reading a
 * report is part of measuring a claim. Each call's tokens and its cost at Opus 5.5's price are
 * logged, one line a call, with the pages, so what a report costs has numbers behind it.
 */

/** Medium effort reads the tables without pondering them; room for a long report's thinking. */
const ROOF_REPORT_MAX_TOKENS = 16000;

export async function POST(request: Request) {
  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: "Send the roof report as a PDF file." }, { status: 400 });
  }
  if (!file || file.size === 0) return NextResponse.json({ error: "Send the roof report as a PDF file." }, { status: 400 });
  if (file.size > ROOF_REPORT_MAX_BYTES) {
    return NextResponse.json({ error: `The report is ${(file.size / 1e6).toFixed(1)} MB; Scrivn reads reports up to ${(ROOF_REPORT_MAX_BYTES / 1e6).toFixed(1)} MB.` }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 5)) !== "%PDF-") return NextResponse.json({ error: "That file isn't a PDF." }, { status: 400 });

  const blocked = await checkUsageAllowed();
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const started = Date.now();
  const pages = pdfPageCount(bytes);
  try {
    const result = await createStructuredMessage<RoofReportWire>({
      system: ROOF_REPORT_SYSTEM_PROMPT,
      userMessage: roofReportUserMessage(),
      schema: ROOF_REPORT_SCHEMA,
      documents: [{ mediaType: "application/pdf", data: Buffer.from(bytes).toString("base64") }],
      effort: "medium",
      maxTokens: ROOF_REPORT_MAX_TOKENS,
    });
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const costUsd = traceCostUsd(result.usage);
    const model = process.env.ANTHROPIC_MODEL?.trim() || TRACE_PRICE_PER_MILLION.model;
    const { report, problem } = roofReportFromWire(result.output, file.name || "roof report.pdf", new Date().toISOString());
    console.log(
      "[/api/exterior/roof-report]",
      JSON.stringify({
        model,
        seconds,
        pages,
        megabytes: Math.round(file.size / 1e4) / 100,
        vendor: report?.vendor ?? null,
        totals: report ? Object.keys(report.totals).length : 0,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        costUsd: Math.round(costUsd * 10000) / 10000,
      }),
    );
    const answer: RoofReportResponse = { report, problem, model, seconds, pages, usage: result.usage, costUsd };
    return NextResponse.json(answer);
  } catch (err) {
    const message = err instanceof ScopingApiError ? err.message : "Reading the report failed unexpectedly.";
    console.error("[/api/exterior/roof-report]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
