import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-only Claude client + the shared "structured outputs call" helper both API routes use.
 * `import "server-only"` makes it a build error to ever import this from client code — belt and
 * suspenders alongside the fact that Next.js Route Handlers already never ship their module code
 * to the browser. The API key (`ANTHROPIC_API_KEY`, from `.env.local`) never leaves this process.
 *
 * Mirrors the Android app's `service/scoping/ClaudeScopingClient.kt`: same default model
 * (`claude-opus-5`), same Structured Outputs shape (`output_config.format` with a JSON Schema —
 * see `schema.ts`), same stop-reason error handling (refusal / max_tokens).
 */

export class ScopingApiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ScopingApiError";
  }
}

const DEFAULT_MODEL = "claude-opus-5";
/** Matches ClaudeScopingClient.DEFAULT_MAX_TOKENS — plenty for one extraction's structured JSON. */
const EXTRACTION_MAX_TOKENS = 8000;
/**
 * Matches ClaudeScopingClient.generateDocuments' explicit override: both documents come back in
 * one response, and a claim with several rooms can produce a lot of text across the two — the
 * Android app observed the smaller default cutting the scope document off mid-list on a real test
 * claim. Generous headroom here rather than trying to predict exactly how much a given claim needs.
 */
export const GENERATION_MAX_TOKENS = 16000;

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ScopingApiError(
      "ANTHROPIC_API_KEY is not set. Copy .env.local.example to .env.local and fill in your API key, then restart `npm run dev`.",
    );
  }
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function model(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * One Structured Outputs call: system + user message in, a JSON Schema-constrained object out.
 * `T` is trusted, not verified against the schema at the type level — the caller knows what shape
 * the schema they passed in describes (same as the Kotlin version trusting its `decodeFromString`
 * target type).
 */
export async function createStructuredMessage<T>(params: {
  system: string;
  userMessage: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const anthropic = getClient();

  let response;
  try {
    response = await anthropic.messages.parse({
      model: model(),
      max_tokens: params.maxTokens ?? EXTRACTION_MAX_TOKENS,
      system: params.system,
      messages: [{ role: "user", content: params.userMessage }],
      output_config: {
        format: { type: "json_schema", schema: params.schema },
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ScopingApiError("Claude API rejected the API key — check ANTHROPIC_API_KEY in .env.local.", { cause: err });
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ScopingApiError("Rate limited by the Claude API — wait a moment and try again.", { cause: err });
    }
    if (err instanceof Anthropic.APIError) {
      throw new ScopingApiError(`Claude API call failed: ${err.message}`, { cause: err });
    }
    throw new ScopingApiError(`Claude API call failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  if (response.stop_reason === "refusal") {
    throw new ScopingApiError("Claude declined this request.");
  }
  // A response cut off by the token budget can still be well-formed JSON (constrained decoding
  // closes the structure gracefully) — it would decode without error but silently contain a
  // truncated document. Catch this explicitly rather than let it through as a seemingly
  // successful, incomplete result.
  if (response.stop_reason === "max_tokens") {
    throw new ScopingApiError("Claude's response was cut off before it finished (hit the token limit) — try again, or shorten the transcript.");
  }

  if (response.parsed_output == null) {
    throw new ScopingApiError("Claude's response didn't match the expected schema.");
  }

  // `parsed_output`'s static type comes from the SDK's own inference (we're passing a raw JSON
  // Schema, not a Zod schema, so the SDK can't narrow it further) — go through `unknown` so this
  // assertion compiles regardless of what that type turns out to be.
  return response.parsed_output as unknown as T;
}
