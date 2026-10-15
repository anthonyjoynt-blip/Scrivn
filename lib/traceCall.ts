import "server-only";
import { createStructuredMessage } from "./anthropic";
import { MAX_SQUARED_PX, type SquareFrame } from "./exteriorPhoto";
import { TRACE_PRICE_PER_MILLION, TRACE_SCHEMA, TRACE_SYSTEM_PROMPT, traceCostUsd, traceProposals, type TraceRequest, type TraceResponse, type TraceSide, traceUserMessage, type TraceWire } from "./exteriorTrace";
import { camerasAt } from "./roofPhotoRead";

/**
 * The AI trace of one side's squared photo, as both routes make it (2026-10-15): the editor's
 * `/api/exterior/trace` and the phone's `/api/device/exterior/trace`, which Finish exterior calls. One
 * reading of the request and one call, so the phone's roof read is the editor's to the byte.
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

/** The photos the image was squared from: each a 3x3 and its camera, finite. Null when absent or not that. */
function readPhotos(raw: unknown): TraceRequest["photos"] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null;
  const photos: NonNullable<TraceRequest["photos"]> = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null) return null;
    const { toPhoto, camera } = p as { toPhoto?: unknown; camera?: Record<string, unknown> };
    if (!Array.isArray(toPhoto) || toPhoto.length !== 9 || !toPhoto.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    if (typeof camera !== "object" || camera === null) return null;
    const c = { width: finite(camera.width, 1, 20000), height: finite(camera.height, 1, 20000), fx: finite(camera.fx, 1, 1e6), fy: finite(camera.fy, 1, 1e6), cx: finite(camera.cx, -1e5, 1e5), cy: finite(camera.cy, -1e5, 1e5) };
    if (Object.values(c).some((v) => v === null)) return null;
    photos.push({ toPhoto: toPhoto as number[], camera: c as NonNullable<TraceRequest["photos"]>[number]["camera"] });
  }
  return photos;
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

export interface ReadTrace {
  image: string;
  frame: SquareFrame;
  side: TraceSide;
  /** Where each phone stood, for the roof's overhangs; without it the pitch is still read. */
  photos: TraceRequest["photos"] | null;
}

/** The request's body read and checked: what to trace, or the sentence saying what is wrong with it (a 400). */
export function readTraceRequest(body: Record<string, unknown> | null): { ok: true; trace: ReadTrace } | { ok: false; error: string } {
  const image = typeof body?.image === "string" ? body.image.replace(/^data:image\/jpeg;base64,/, "") : "";
  if (!image || image.length > MAX_IMAGE_BASE64 || !image.startsWith("/9j/")) return { ok: false, error: "Send the squared photo as a JPEG under 3 MB." };
  const frame = readFrame(body?.frame);
  const side = readSide(body?.side);
  if (!frame || !side) return { ok: false, error: "The photo's frame and the side are needed to trace it." };
  return { ok: true, trace: { image, frame, side, photos: readPhotos(body?.photos) } };
}

/**
 * The one Claude call, its log line (tokens and cost at Opus 5.5's price, so what a scan should cost
 * has numbers to start from), and its answer as proposals in the side's own feet. [route] names the
 * route in the log. Throws `ScopingApiError` as `createStructuredMessage` does.
 */
export async function runTrace(t: ReadTrace, route: string): Promise<TraceResponse> {
  const started = Date.now();
  const result = await createStructuredMessage<TraceWire>({
    system: TRACE_SYSTEM_PROMPT,
    userMessage: traceUserMessage(t.frame, t.side),
    schema: TRACE_SCHEMA,
    images: [{ mediaType: "image/jpeg", data: t.image }],
    // The owner's test: high put windows and peaks within 1/2"; medium within 2/3", for $0.025 less.
    effort: "high",
    maxTokens: TRACE_MAX_TOKENS,
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const costUsd = traceCostUsd(result.usage);
  const model = process.env.ANTHROPIC_MODEL?.trim() || TRACE_PRICE_PER_MILLION.model;
  console.log(
    route,
    JSON.stringify({
      side: t.side.name,
      model,
      seconds,
      image: `${t.frame.width}x${t.frame.height}`,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheCreationTokens: result.usage.cacheCreationTokens,
      costUsd: Math.round(costUsd * 10000) / 10000,
      priced: `${TRACE_PRICE_PER_MILLION.model} at $${TRACE_PRICE_PER_MILLION.input}/$${TRACE_PRICE_PER_MILLION.output} per million`,
    }),
  );
  return { proposals: traceProposals(result.output, t.frame, t.side.lengthM / 0.3048, t.photos ? camerasAt(t.photos) : null), model, seconds, usage: result.usage, costUsd };
}
