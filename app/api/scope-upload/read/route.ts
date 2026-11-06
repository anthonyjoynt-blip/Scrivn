import { NextResponse } from "next/server";
import { estimateUsd } from "@/lib/aiPricing";
import { createStructuredMessage, ScopingApiError } from "@/lib/anthropic";
import { retryWords } from "@/lib/guardRules";
import { hashForGuard, hitLimit } from "@/lib/requestGuard";
import { SCOPE_READ_SCHEMA, SCOPE_READ_SYSTEM, scopeReadFromWire, scopeReadProblem, scopeReadUserMessage, type ScopeReadWire } from "@/lib/scopeUploadPrompt";
import {
  loadScopeDevFixture,
  SCOPE_READS_OFF,
  SCOPE_UPLOAD_MAX_BYTES,
  scopeDevFixtureName,
  scopeDevWithoutAuth,
  scopeReader,
  scopeReadsOn,
  scopeUploadKind,
} from "@/lib/scopeUploadRead";
import { checkUsageAllowed } from "@/lib/usage";

/**
 * Uploading a scope (2026-11-06): `POST /api/scope-upload/read` with one photo of a scope's page (shrunk in the
 * browser) or one PDF, as the form field `file`, and optionally `page` and `pages` (which page of how many the
 * estimator picked, so a page that carries on a room is read as such). One Claude call; the answer comes back as
 * `{ read }` (a ScopePageRead, lib/scopeUpload.ts) for the notes step to join and add to the notes, or `{ error }`.
 *
 * In order, nothing spent before the last step:
 *   400/413  no file, not a JPEG, PNG or PDF, or too big for a request;
 *            a dev fixture (SCOPE_UPLOAD_READ_FIXTURE, never in production): its recorded read, uncounted;
 *   403      reads are off (SCRIVN_SCOPE_READS), the default;
 *   401/402  nobody signed in, or the plan or trial does not allow it, as checkUsageAllowed says;
 *   429      past the account's pages for the day, or everyone's;
 *   502      the call failed, or nothing was read off the page.
 *
 * Gated by the plan and not counted against it: reading a scope is part of the claim's notes, and the claim is
 * counted when its documents are generated. The page is not stored anywhere, and not logged.
 */

export const maxDuration = 120;

/** A dense page is a few thousand tokens out; a PDF of several pages more. */
const SCOPE_READ_MAX_TOKENS = 16000;
/** Pages one account (its organization, or the person alone) may have read in a day. */
const PAGES_PER_ACCOUNT_PER_DAY = 60;
/** Pages everyone together may have read in a day. */
const PAGES_PER_DAY = 600;
const DAY = 86_400;

const ROUTE = "[/api/scope-upload/read]";

const whole = (v: FormDataEntryValue | null, fallback: number) => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 200 ? n : fallback;
};

export async function POST(request: Request) {
  let file: File | null = null;
  let page = 1;
  let pages = 1;
  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
    pages = whole(form.get("pages"), 1);
    page = Math.min(whole(form.get("page"), 1), pages);
  } catch {
    return NextResponse.json({ error: "Send the scope as a photo or a PDF." }, { status: 400 });
  }
  if (!file || file.size === 0) return NextResponse.json({ error: "Send the scope as a photo or a PDF." }, { status: 400 });
  if (file.size > SCOPE_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: `That file is ${(file.size / 1e6).toFixed(1)} MB; Scrivn reads files up to ${(SCOPE_UPLOAD_MAX_BYTES / 1e6).toFixed(1)} MB.` }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = scopeUploadKind(bytes);
  if (!kind) return NextResponse.json({ error: "That file isn't a photo or a PDF." }, { status: 400 });

  // Development reading a recorded answer back: no call, nothing counted.
  const fixture = scopeDevFixtureName();
  if (fixture) {
    try {
      return NextResponse.json({ read: await loadScopeDevFixture(fixture) });
    } catch (err) {
      console.error(ROUTE, err);
      return NextResponse.json({ error: `SCOPE_UPLOAD_READ_FIXTURE=${fixture}: no recorded read at test/scopeUpload/fixtures/${fixture}.model.json.` }, { status: 500 });
    }
  }

  if (!scopeReadsOn()) return NextResponse.json({ error: SCOPE_READS_OFF }, { status: 403 });

  const blocked = await checkUsageAllowed();
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  // With no Supabase in development there is nobody to count against, and nothing to count in.
  if (!scopeDevWithoutAuth()) {
    const reader = await scopeReader();
    if (!reader) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const mine = await hitLimit("scope-upload-org", hashForGuard("account", reader), DAY, PAGES_PER_ACCOUNT_PER_DAY);
    if (mine) {
      return NextResponse.json(
        { error: `Your account has had ${PAGES_PER_ACCOUNT_PER_DAY} scope pages read today, the most for a day. Try again ${retryWords(mine)}, or type or dictate the rest.` },
        { status: 429 },
      );
    }
    const all = await hitLimit("scope-upload-all", "all", DAY, PAGES_PER_DAY);
    if (all) {
      return NextResponse.json({ error: `Scrivn has read as many scope pages as it can today. Try again ${retryWords(all)}, or type or dictate the scope.` }, { status: 429 });
    }
  }

  const started = Date.now();
  const data = Buffer.from(bytes).toString("base64");
  try {
    const result = await createStructuredMessage<ScopeReadWire>({
      system: SCOPE_READ_SYSTEM,
      userMessage: scopeReadUserMessage(kind.kind, page, pages),
      schema: SCOPE_READ_SCHEMA,
      ...(kind.kind === "pdf" ? { documents: [{ mediaType: kind.mediaType, data }] } : { images: [{ mediaType: kind.mediaType, data }] }),
      effort: "medium",
      maxTokens: SCOPE_READ_MAX_TOKENS,
    });
    const read = scopeReadFromWire(result.output);
    const problem = scopeReadProblem(read);
    const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
    console.log(
      ROUTE,
      JSON.stringify({
        model,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        kind: kind.kind,
        megabytes: Math.round(file.size / 1e4) / 100,
        page,
        pages,
        rooms: read.rooms.length,
        lines: read.rooms.reduce((s, r) => s + r.items.length, 0) + read.general.length + read.continuing.length,
        problem,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        costUsd: Math.round(estimateUsd(model, result.usage, process.env) * 10000) / 10000,
      }),
    );
    if (problem) return NextResponse.json({ error: `Nothing could be read off that ${kind.kind === "pdf" ? "PDF" : "page"} as a scope (${problem}).` }, { status: 502 });
    return NextResponse.json({ read });
  } catch (err) {
    const message = err instanceof ScopingApiError ? err.message : "Reading the scope failed unexpectedly.";
    console.error(ROUTE, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
