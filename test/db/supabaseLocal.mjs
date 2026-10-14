/**
 * A Supabase-shaped Postgres in memory, for testing migrations and RLS without touching the real
 * project.
 *
 * The migrations in supabase/migrations are applied by hand in the Supabase SQL editor, and the
 * project in .env.local is production. So until now a new policy could only be tested AFTER it had
 * been applied there. This stands up PGlite (real Postgres, compiled to WebAssembly, no server and no
 * Docker) and dresses it as Supabase closely enough for the migrations to run unchanged:
 *
 *   * the three API roles — `anon`, `authenticated`, `service_role` (the last with BYPASSRLS) — and
 *     Supabase's default privileges, under which every new table AND FUNCTION in `public` is granted
 *     to all three. That last part matters: `revoke all on function f from public` leaves the
 *     explicit grant to `anon` in place on Supabase, and a test that ran without it would miss a
 *     function still reachable with the public key;
 *   * `auth.users`, with the columns the migrations read, and `auth.uid()` / `auth.jwt()` /
 *     `auth.role()` reading `request.jwt.claims` the way PostgREST sets it;
 *   * `extensions` (pgcrypto) and pg_trgm;
 *   * `storage.buckets` and `storage.objects`, with RLS on, so the bucket policies compile and can be
 *     probed.
 *
 * What it is NOT: PostgREST, GoTrue or Storage. Queries here are SQL run as a role with a JWT claim
 * set, which is what PostgREST does underneath — so a policy or a definer function behaves as it
 * would behind the API. The HTTP-level checks stay in test/rls/run.mjs, against the real project,
 * once a migration has been applied there.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const SUPABASE_SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

-- Supabase's default privileges in public: everything new is granted to the three API roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- varchar(255), as on Supabase: a function returning it as text must cast, and this catches one that forgets.
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email character varying(255),
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
`;

/** The migration files, in the order the owner applies them (by name; 0005's two sort claim list first). */
export function migrationFiles(root) {
  const dir = join(root, "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
}

/**
 * The migrations split around one of them, found by the end of its name rather than its number —
 * numbers move when two sessions write a migration at once, names do not.
 */
export function splitMigrationsAt(root, suffix) {
  const all = migrationFiles(root);
  const at = all.findIndex((m) => m.name.endsWith(suffix));
  if (at === -1) throw new Error(`no migration ending in ${suffix}`);
  return { before: all.slice(0, at), from: all.slice(at) };
}

/** SHA-256 hex — what the app hands the database for a pairing code, device token or invite token. */
export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A fresh 256-bit token, as lib/deviceCodes.ts makes them. */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

export async function startSupabaseLocal() {
  const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(SUPABASE_SHIM);
  return new LocalSupabase(db);
}

export class LocalSupabase {
  constructor(db) {
    this.db = db;
  }

  /** Runs a migration file as the SQL editor would: the whole script, as the owning role. */
  async applyMigration({ name, sql }) {
    try {
      await this.db.exec(sql);
    } catch (err) {
      throw new Error(`${name} failed to apply: ${err.message}`);
    }
  }

  /** A confirmed auth user, as signing up and clicking the link would leave one. Fires the signup trigger. */
  async createUser({ email, fullName = null, companyName = null, confirmed = true } = {}) {
    const id = randomUUID();
    const meta = {};
    if (fullName) meta.full_name = fullName;
    if (companyName) meta.company_name = companyName;
    await this.db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3, $4)`, [
      id,
      email ?? `${id.slice(0, 8)}@example.test`,
      confirmed ? new Date().toISOString() : null,
      JSON.stringify(meta),
    ]);
    return id;
  }

  /** Superuser SQL — the SQL editor, or a definer function's view of the world. */
  async sql(text, params = []) {
    const res = await this.db.query(text, params);
    return res.rows;
  }

  /**
   * SQL as a PostgREST request would run it: inside a transaction, as `role`, with the JWT claims set.
   * `userId` null runs as the bare anon key. Errors come back as `{ error }` rather than throwing, the
   * way supabase-js reports them, so a check can assert on the data and the refusal alike.
   */
  async as(userId, text, params = [], { role } = {}) {
    const useRole = role ?? (userId ? "authenticated" : "anon");
    const claims = JSON.stringify(userId ? { sub: userId, role: useRole } : { role: useRole });
    try {
      const rows = await this.db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
        await tx.exec(`set local role ${useRole}`);
        const res = await tx.query(text, params);
        return res.rows;
      });
      return { data: rows, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  /** The service-role key: bypasses RLS, as the webhook and the server routes' admin client do. */
  async service(text, params = []) {
    return this.as(null, text, params, { role: "service_role" });
  }

  async close() {
    await this.db.close();
  }
}
