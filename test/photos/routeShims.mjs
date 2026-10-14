/**
 * What test/photos/routes.mjs bundles in place of Supabase and Next: a small world of organizations,
 * claims, scans and storage that answers the way Row Level Security and the storage policies would
 * (0004, 0007, 0015) — a member's own client sees only their organization's claims and files; the
 * service role sees and writes everything. Each test sets `globalThis.__photoWorld`.
 *
 * Only what the photo routes call is here; anything else throws, so a route that starts needing more
 * fails loudly rather than passing.
 */

const w = () => {
  if (!globalThis.__photoWorld) throw new Error("routeShims: globalThis.__photoWorld is not set");
  return globalThis.__photoWorld;
};

/* next/server */
export class NextResponse extends Response {
  static json(body, init) {
    return Response.json(body, typeof init === "number" ? { status: init } : init);
  }
}

/* ── a query, as far as the routes take it ─────────────────────────────────────────────────────── */

function query(table, viewer) {
  const world = w();
  const visibleClaims = () => [...world.claims.entries()].filter(([, c]) => viewer.service || c.org === world.members.get(viewer.userId));
  let filters = [];
  let op = "select";
  let columns = "*";
  const rows = () => {
    if (table === "claims") {
      return visibleClaims()
        .filter(([id]) => filters.every(([col, val]) => (col === "id" ? id === val : true)))
        .map(([id, c]) => {
          const row = { id, organization_id: c.org };
          if (columns.includes("payload->photos")) row.photos = c.payload.photos ?? null;
          return row;
        });
    }
    if (table === "claim_scans") {
      const claimId = filters.find(([col]) => col === "claim_id")?.[1];
      const visible = new Set(visibleClaims().map(([id]) => id));
      return [...world.scans.entries()].filter(([, s]) => s.claim === claimId && visible.has(s.claim)).map(([id]) => ({ id }));
    }
    throw new Error(`routeShims: no table ${table}`);
  };
  const builder = {
    select(cols = "*") {
      if (op === "delete") {
        const gone = rows();
        for (const r of gone) world.claims.delete(r.id);
        return Promise.resolve({ data: gone.map((r) => ({ id: r.id })), error: null });
      }
      columns = cols;
      return builder;
    },
    delete() {
      op = "delete";
      return builder;
    },
    eq(col, val) {
      filters = [...filters, [col, val]];
      return builder;
    },
    maybeSingle() {
      const r = rows();
      return Promise.resolve({ data: r[0] ?? null, error: null });
    },
    then(resolve, reject) {
      return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    },
  };
  return builder;
}

/* ── storage, as the bucket policies decide it ─────────────────────────────────────────────────── */

function storage(bucket, viewer) {
  const world = w();
  const files = () => {
    if (!world.storage.has(bucket)) world.storage.set(bucket, new Map());
    return world.storage.get(bucket);
  };
  const readable = (path) => viewer.service || path.split("/")[0] === world.members.get(viewer.userId);
  return {
    async upload(path, bytes, options) {
      if (!viewer.service) return { data: null, error: { message: "new row violates row-level security policy" } };
      if (files().has(path) && !options?.upsert) return { data: null, error: { message: "The resource already exists" } };
      files().set(path, bytes);
      world.writes += 1;
      return { data: { path }, error: null };
    },
    async remove(paths) {
      if (!viewer.service) return { data: [], error: null };
      for (const p of paths) files().delete(p);
      return { data: paths.map((name) => ({ name })), error: null };
    },
    async list(folder, options = {}) {
      const prefix = `${folder}/`;
      const names = [...files().keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/") && readable(p)).map((p) => p.slice(prefix.length));
      const offset = options.offset ?? 0;
      return { data: names.slice(offset, offset + (options.limit ?? 100)).map((name) => ({ name, id: name })), error: null };
    },
    async createSignedUrls(paths, seconds) {
      return { data: paths.filter(readable).map((path) => ({ path, signedUrl: `https://storage.test/${bucket}/${path}?for=${seconds}` })), error: null };
    },
  };
}

function client(viewer) {
  return {
    from: (table) => query(table, viewer),
    storage: { from: (bucket) => storage(bucket, viewer) },
    auth: {
      async getUser() {
        return viewer.userId ? { data: { user: { id: viewer.userId } }, error: null } : { data: { user: null }, error: { message: "no session" } };
      },
    },
  };
}

/* lib/supabase/server — the signed-in person's own session. */
export async function createClient() {
  return client({ userId: w().userId, service: false });
}

/* lib/supabase/admin */
export function createAdminClient() {
  return client({ userId: null, service: true });
}
