/**
 * What test/handSketch/route.mjs bundles in place of Next, Supabase, the usage gate, the request
 * guard and Claude. Each test sets `globalThis.__hsWorld`; every call is recorded on it, and a
 * Claude call the world does not allow throws.
 */
const w = () => {
  if (!globalThis.__hsWorld) throw new Error("routeShims: globalThis.__hsWorld is not set");
  return globalThis.__hsWorld;
};

/* next/server */
export class NextResponse extends Response {
  static json(body, init) {
    return Response.json(body, typeof init === "number" ? { status: init } : init);
  }
}

/* lib/usage */
export async function checkUsageAllowed() {
  w().usageChecks += 1;
  return w().blocked;
}
export async function getUsageState() {
  return w().organizationId ? { organizationId: w().organizationId } : w().userId ? { organizationId: null } : null;
}

/* lib/supabase/server */
export async function createClient() {
  return { auth: { getClaims: async () => ({ data: w().userId ? { claims: { sub: w().userId } } : null }) } };
}

/* lib/requestGuard */
export function hashForGuard(purpose, value) {
  return `${purpose}:${value}`;
}
export async function hitLimit(bucket, key, windowSeconds, max) {
  const world = w();
  world.hits.push({ bucket, key, windowSeconds, max });
  if (!world.limitsAllowed) throw new Error(`routeShims: hitLimit(${bucket}) reached on a path that must not count`);
  return world.over[bucket] ?? null;
}

/* lib/anthropic */
export class ScopingApiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ScopingApiError";
  }
}
export async function createStructuredMessage(params) {
  const world = w();
  world.calls.push(params);
  if (!world.callAllowed) throw new Error("routeShims: createStructuredMessage reached on a path that must not call");
  if (world.answer instanceof Error) throw world.answer;
  return { output: world.answer, usage: { inputTokens: 1935, outputTokens: 2206, cacheCreationTokens: 2566, cacheReadTokens: 0 } };
}
