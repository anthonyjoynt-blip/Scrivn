import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanEnv } from "./env";
import type { HandSketchRead } from "./handSketch";
import { isSupabaseConfigured } from "./supabase/env";
import { createClient } from "./supabase/server";
import { checkUsageAllowed, getUsageState } from "./usage";

/**
 * "Read it for me" on the public drop-a-sketch page (2026-11-05): the server half of having Claude
 * read a photo of a hand-drawn floor sketch. Anyone may trace a photo by hand for free; the read is
 * a paid call (about $0.05), so it is for signed-in accounts only, and capped per account per day
 * and for everyone together (app/api/hand-sketch/read/route.ts).
 *
 * The photo is not kept: it is in the request and the call, and nowhere after.
 */

/** Longest side of the photo sent, in pixels: the live test sent 1400, with room either side. */
export const HAND_SKETCH_MAX_PX = 1600;
/** A 1600 px JPEG at 0.85 is well under 2 MB; base64 adds a third. */
export const HAND_SKETCH_MAX_BASE64 = 2_500_000;

/**
 * Reads are OFF until the owner turns them on with SCRIVN_HAND_SKETCH_READS=on, as the exterior's
 * photo reads are (lib/traceCall.ts): while Scrivn is being tested, every read is development, and
 * development does not spend the owner's API balance. The route refuses before any call.
 */
export function handSketchReadsOn(): boolean {
  return cleanEnv("SCRIVN_HAND_SKETCH_READS")?.toLowerCase() === "on";
}

export const HAND_SKETCH_READS_OFF = "Reading sketches is off while Scrivn is being tested, so nothing is spent. You can still trace the photo yourself.";

export interface HandSketchReadRequest {
  /** Base64 JPEG, no data: prefix. */
  image: string;
  width: number;
  height: number;
}

const side = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= HAND_SKETCH_MAX_PX ? v : null);

/** The request's body read and checked: the photo and its size, or the sentence saying what is wrong (a 400). */
export function readHandSketchRequest(body: unknown): { ok: true; req: HandSketchReadRequest } | { ok: false; error: string } {
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const image = typeof b?.image === "string" ? b.image.replace(/^data:image\/jpeg;base64,/, "") : "";
  if (!image || image.length > HAND_SKETCH_MAX_BASE64 || !image.startsWith("/9j/")) return { ok: false, error: "Send the photo as a JPEG under 2 MB." };
  const width = side(b?.width);
  const height = side(b?.height);
  if (width === null || height === null) return { ok: false, error: `Send the photo's width and height in pixels, each from 1 to ${HAND_SKETCH_MAX_PX}.` };
  return { ok: true, req: { image, width, height } };
}

/**
 * The recorded answer to read back in development instead of a call: HAND_SKETCH_READ_FIXTURE=spare
 * reads test/handSketch/fixtures/spare.model.json (a real model answer, saved by live.mjs). Null in
 * production, and when unset or not a plain name, so it can never reach outside that folder.
 */
export function devFixtureName(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const name = cleanEnv("HAND_SKETCH_READ_FIXTURE");
  return name && /^[a-z0-9-]+$/.test(name) ? name : null;
}

/** That fixture's read. Throws, with the path, when the file is missing or has no read in it. */
export async function loadDevFixture(name: string): Promise<HandSketchRead> {
  const path = join(process.cwd(), "test", "handSketch", "fixtures", `${name}.model.json`);
  const saved = JSON.parse(await readFile(path, "utf8")) as { read?: HandSketchRead };
  if (!saved.read) throw new Error(`${path} has no read in it.`);
  return saved.read;
}

/**
 * Development with no Supabase project standing, as `unauthenticatedDevMode` in lib/usage.ts: there
 * is nobody to sign in, and nobody to count.
 */
export function handSketchDevWithoutAuth(): boolean {
  return process.env.NODE_ENV !== "production" && !isSupabaseConfigured();
}

/**
 * Who a read is counted against for the day: the organization, or the person when they have none.
 * Null when nobody is signed in.
 */
export async function handSketchReader(): Promise<string | null> {
  const usage = await getUsageState();
  if (usage?.organizationId) return usage.organizationId;
  const { data } = await (await createClient()).auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

/**
 * Whether the page reads the photo: a dev fixture is set, or development has no Supabase and reads are on
 * (the route then answers with the fixture or makes the call: the paid-call guard still applies), or someone
 * is signed in, their plan or trial allows it, and reads are on. The day's limits
 * are not checked here, since checking one counts it: past them, the button answers with a 429.
 */
export async function handSketchReadAvailable(): Promise<boolean> {
  if (devFixtureName()) return true;
  // Development with nobody to sign in: offered when reads are on (the free path, finding the rooms, otherwise).
  if (handSketchDevWithoutAuth()) return handSketchReadsOn();
  if (!handSketchReadsOn()) return false;
  try {
    return (await checkUsageAllowed()) === null;
  } catch (err) {
    console.error("[handSketchReadAvailable]", err);
    return false;
  }
}
