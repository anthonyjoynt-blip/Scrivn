import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanEnv } from "./env";
import { SCOPE_UPLOAD_MAX_BYTES, type ScopePageRead } from "./scopeUpload";
import { isSupabaseConfigured } from "./supabase/env";
import { createClient } from "./supabase/server";
import { getUsageState } from "./usage";

export { SCOPE_UPLOAD_MAX_BYTES };

/**
 * The server half of uploading a scope (2026-11-06): the switch, what a request may carry, and the recorded answer
 * read back in development instead of a call. The route is app/api/scope-upload/read/route.ts.
 *
 * The page or PDF is not kept: it is in the request and the call, and nowhere after. What is kept is the text read,
 * in the claim's notes, where the estimator checks it.
 */

/**
 * Reads are OFF until the owner turns them on with SCRIVN_SCOPE_READS=on, as the hand-sketch and exterior reads are:
 * while Scrivn is being tested, every read is development, and development does not spend the owner's API balance.
 */
export function scopeReadsOn(): boolean {
  return cleanEnv("SCRIVN_SCOPE_READS")?.toLowerCase() === "on";
}

export const SCOPE_READS_OFF = "Reading uploaded scopes is off while Scrivn is being tested, so nothing is spent. You can still type or dictate the scope into the notes.";

export type ScopeUploadFile = { kind: "photo"; mediaType: "image/jpeg" | "image/png" } | { kind: "pdf"; mediaType: "application/pdf" };

/** What the bytes are, from their first few, or null when they are not a JPEG, PNG or PDF. */
export function scopeUploadKind(bytes: Uint8Array): ScopeUploadFile | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: "photo", mediaType: "image/jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { kind: "photo", mediaType: "image/png" };
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return { kind: "pdf", mediaType: "application/pdf" };
  return null;
}

/**
 * The recorded answer to read back in development instead of a call: SCOPE_UPLOAD_READ_FIXTURE=sample reads
 * test/scopeUpload/fixtures/sample.model.json. Null in production, and when unset or not a plain name, so it can never
 * reach outside that folder.
 */
export function scopeDevFixtureName(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const name = cleanEnv("SCOPE_UPLOAD_READ_FIXTURE");
  return name && /^[a-z0-9-]+$/.test(name) ? name : null;
}

/** That fixture's read. Throws, with the path, when the file is missing or has no read in it. */
export async function loadScopeDevFixture(name: string): Promise<ScopePageRead> {
  const path = join(process.cwd(), "test", "scopeUpload", "fixtures", `${name}.model.json`);
  const saved = JSON.parse(await readFile(path, "utf8")) as { read?: ScopePageRead };
  if (!saved.read) throw new Error(`${path} has no read in it.`);
  return saved.read;
}

/** Development with no Supabase project standing: nobody to sign in, and nobody to count. */
export function scopeDevWithoutAuth(): boolean {
  return process.env.NODE_ENV !== "production" && !isSupabaseConfigured();
}

/** Who a read is counted against for the day: the organization, or the person when they have none. */
export async function scopeReader(): Promise<string | null> {
  const usage = await getUsageState();
  if (usage?.organizationId) return usage.organizationId;
  const { data } = await (await createClient()).auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}
