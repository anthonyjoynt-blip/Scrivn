/**
 * Supabase on this machine, for running Scrivn end to end without the real project: GoTrue (sign-in,
 * sign-up links, the admin API), PostgREST (tables and RPC, with Row Level Security) and Storage
 * (list, upload, remove), each the subset this app uses, over PGlite with every migration applied
 * (test/db/supabaseLocal.mjs). No Docker, nothing downloaded.
 *
 * Why it exists: the project in .env.local is production, and migrations there are applied by hand.
 * A new migration could only be tried through the app after it had gone to production. With this, a
 * dev server pointed at it runs the new SQL behind the real routes and pages.
 *
 *   node test/e2e/fakeSupabase.mjs [--port 54329] [--write-env <path>]
 *
 * --write-env writes the four variables a dev server needs (URL, anon key, service key, and the
 * cookie-name-friendly settings) to that file, e.g. `.env.development.local`, which Next.js reads
 * before .env.local. Delete it afterwards. Test helpers live under /__test (127.0.0.1 only):
 *   GET  /__test/links?email=…   the confirmation and recovery links GoTrue would have emailed
 *   POST /__test/sql {sql, params}   SQL as the database owner, for arranging a test
 *
 * NOT a faithful GoTrue or PostgREST. What it does, it does the way they do (the same JSON shapes,
 * the same SQL run as the same role with the same JWT claims, so RLS and grants decide exactly as
 * they would); what it does not do, it answers 501, so a page that needs more says so plainly.
 */
import { createServer } from "node:http";
import { createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationFiles, startSupabaseLocal } from "../db/supabaseLocal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

export const FAKE_JWT_SECRET = "scrivn-fake-supabase-not-a-secret-0123456789";

/* ── JWTs ──────────────────────────────────────────────────────────────────────────────────────── */

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", FAKE_JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return null;
  const sig = createHmac("sha256", FAKE_JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (sig !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The two project keys, fixed so a dev server and this process agree without talking. */
export function fakeKeys() {
  const iat = 1_760_000_000;
  const exp = iat + 10 * 365 * 86_400;
  return {
    anon: signJwt({ iss: "supabase", ref: "fakelocal", role: "anon", iat, exp }),
    service: signJwt({ iss: "supabase", ref: "fakelocal", role: "service_role", iat, exp }),
  };
}

/* ── The server ────────────────────────────────────────────────────────────────────────────────── */

export async function startFakeSupabase({ port = 54329, log = false } = {}) {
  const s = await startSupabaseLocal();
  for (const m of migrationFiles(root)) await s.applyMigration(m);
  await s.sql(`alter table auth.users add column if not exists encrypted_password text`);
  await s.sql(`alter table auth.users add column if not exists last_sign_in_at timestamptz`);

  const db = s.db;
  let queue = Promise.resolve();
  /** PGlite is one connection: one request's SQL at a time. */
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const sessions = new Map(); // refresh token -> { userId, sessionId }
  const otps = new Map(); // hashed token -> { userId, kind: 'confirmation' | 'recovery', email, at }
  const links = []; // what would have been emailed
  const storage = new Map(); // bucket -> Map(path -> { bytes, contentType, id, created })

  /* ── Schema knowledge, read once ── */

  const fks = (
    await db.query(`
      select cl.relname as tbl, ref.relname as ref_tbl,
        (select array_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols,
        (select array_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as ref_cols
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_class ref on ref.oid = con.confrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_namespace rn on rn.oid = ref.relnamespace
      where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'`)
  ).rows;

  async function functionInfo(name) {
    const { rows } = await db.query(
      `select p.proretset as retset, format_type(p.prorettype, null) as rettype, t.typtype,
              coalesce(p.proargnames, '{}') as names, coalesce(p.proargmodes::text[], '{}') as modes,
              array(select format_type(x, null) from unnest(p.proargtypes) x) as intypes
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
       where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    return rows[0] ?? null;
  }

  /* ── Users ── */

  async function userRow(id) {
    const { rows } = await db.query(`select id, email, email_confirmed_at, raw_user_meta_data, created_at, last_sign_in_at, encrypted_password from auth.users where id = $1`, [id]);
    return rows[0] ?? null;
  }
  async function userByEmail(email) {
    const { rows } = await db.query(`select id from auth.users where lower(email) = lower($1)`, [email]);
    return rows[0] ? userRow(rows[0].id) : null;
  }
  const hashPassword = (pw) => createHash("sha256").update(`fake:${pw}`).digest("hex");
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  function userJson(u) {
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: iso(u.email_confirmed_at),
      confirmed_at: iso(u.email_confirmed_at),
      phone: "",
      last_sign_in_at: iso(u.last_sign_in_at),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: u.raw_user_meta_data ?? {},
      identities: [],
      created_at: iso(u.created_at),
      updated_at: iso(u.created_at),
      is_anonymous: false,
    };
  }
  async function createUserRow({ email, password, confirmed, meta }) {
    const id = randomUUID();
    await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, encrypted_password) values ($1, $2, $3, $4, $5)`, [
      id,
      email,
      confirmed ? new Date().toISOString() : null,
      JSON.stringify(meta ?? {}),
      password ? hashPassword(password) : null,
    ]);
    return userRow(id);
  }
  async function sessionFor(u) {
    await db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [u.id]);
    const fresh = await userRow(u.id);
    const sessionId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt({
      sub: u.id,
      role: "authenticated",
      aud: "authenticated",
      email: u.email,
      session_id: sessionId,
      is_anonymous: false,
      app_metadata: { provider: "email" },
      user_metadata: u.raw_user_meta_data ?? {},
      iat: now,
      exp: now + 3600,
    });
    const refresh = randomBytes(24).toString("base64url");
    sessions.set(refresh, { userId: u.id, sessionId });
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(fresh) };
  }
  function newOtp(u, kind) {
    const hashed = randomBytes(28).toString("hex");
    otps.set(hashed, { userId: u.id, kind, email: u.email, at: Date.now() });
    return hashed;
  }

  /* ── HTTP plumbing ── */

  const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, range, x-supabase-api-version, accept, x-upsert, cache-control",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS",
    "access-control-expose-headers": "content-range, x-total-count",
  };
  function send(res, status, body, headers = {}) {
    const text = body === undefined || body === null ? "" : typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, { ...CORS, ...(text ? { "content-type": "application/json; charset=utf-8" } : {}), ...headers });
    res.end(res.req.method === "HEAD" ? undefined : text);
  }
  const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });
  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
  }
  const jsonOf = (buf) => {
    if (!buf.length) return null;
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      return undefined;
    }
  };
  function bearer(req) {
    const h = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1].trim() : (req.headers.apikey ?? null);
  }

  /* ── GoTrue ── */

  async function auth(req, res, path, url, body) {
    const claims = verifyJwt(bearer(req));
    if (path === "/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = body?.email ? await userByEmail(String(body.email)) : null;
        if (!u || !u.encrypted_password || u.encrypted_password !== hashPassword(String(body.password ?? ""))) {
          return authError(res, 400, "invalid_credentials", "Invalid login credentials");
        }
        if (!u.email_confirmed_at) return authError(res, 400, "email_not_confirmed", "Email not confirmed");
        return send(res, 200, await sessionFor(u));
      }
      if (grant === "refresh_token") {
        const found = sessions.get(String(body?.refresh_token ?? ""));
        if (!found) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        sessions.delete(String(body.refresh_token));
        const u = await userRow(found.userId);
        if (!u) return authError(res, 400, "user_not_found", "User not found");
        return send(res, 200, await sessionFor(u));
      }
      return authError(res, 400, "unsupported_grant_type", "unsupported grant type");
    }
    if (path === "/user" && req.method === "GET") {
      if (!claims?.sub) return authError(res, 401, "bad_jwt", "invalid JWT");
      const u = await userRow(claims.sub);
      if (!u) return authError(res, 403, "user_not_found", "User from sub claim in JWT does not exist");
      return send(res, 200, userJson(u));
    }
    if (path === "/user" && req.method === "PUT") {
      if (!claims?.sub) return authError(res, 401, "bad_jwt", "invalid JWT");
      if (typeof body?.password === "string") await db.query(`update auth.users set encrypted_password = $2 where id = $1`, [claims.sub, hashPassword(body.password)]);
      return send(res, 200, userJson(await userRow(claims.sub)));
    }
    if (path === "/logout") {
      for (const [k, v] of sessions) if (claims?.session_id && v.sessionId === claims.session_id) sessions.delete(k);
      return send(res, 204, null);
    }
    if (path === "/signup") return authError(res, 422, "signup_disabled", "Signups not allowed for this instance");
    if (path === "/verify" && req.method === "POST") {
      const hashed = String(body?.token_hash ?? "");
      const otp = otps.get(hashed);
      if (!otp) return authError(res, 403, "otp_expired", "Email link is invalid or has expired");
      otps.delete(hashed);
      await db.query(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1`, [otp.userId]);
      const u = await userRow(otp.userId);
      return send(res, 200, await sessionFor(u));
    }
    if (path === "/recover") {
      const u = body?.email ? await userByEmail(String(body.email)) : null;
      if (u) {
        const hashed = newOtp(u, "recovery");
        links.push({ email: u.email, kind: "recovery", hashed_token: hashed, redirect_to: url.searchParams.get("redirect_to"), at: Date.now() });
      }
      return send(res, 200, {});
    }
    if (path.startsWith("/admin/")) {
      if (claims?.role !== "service_role") return authError(res, 403, "not_admin", "User not allowed");
      const rest = path.slice("/admin/".length);
      if (rest === "users" && req.method === "POST") {
        const email = String(body?.email ?? "").trim();
        if (!email) return authError(res, 400, "validation_failed", "email required");
        if (await userByEmail(email)) return authError(res, 422, "email_exists", "A user with this email address has already been registered");
        const u = await createUserRow({ email, password: body?.password, confirmed: body?.email_confirm === true, meta: body?.user_metadata });
        return send(res, 200, userJson(u));
      }
      const m = /^users\/([0-9a-f-]{36})$/.exec(rest);
      if (m && req.method === "GET") {
        const u = await userRow(m[1]);
        return u ? send(res, 200, userJson(u)) : authError(res, 404, "user_not_found", "User not found");
      }
      if (m && req.method === "DELETE") {
        const u = await userRow(m[1]);
        if (!u) return authError(res, 404, "user_not_found", "User not found");
        await db.query(`delete from auth.users where id = $1`, [m[1]]);
        for (const [k, v] of sessions) if (v.userId === m[1]) sessions.delete(k);
        return send(res, 200, userJson(u));
      }
      if (m && req.method === "PUT") {
        if (typeof body?.password === "string") await db.query(`update auth.users set encrypted_password = $2 where id = $1`, [m[1], hashPassword(body.password)]);
        if (body?.email_confirm === true) await db.query(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1`, [m[1]]);
        return send(res, 200, userJson(await userRow(m[1])));
      }
      if (rest === "generate_link" && req.method === "POST") {
        const type = String(body?.type ?? "");
        const email = String(body?.email ?? "").trim();
        let u = await userByEmail(email);
        let kind;
        if (type === "signup") {
          if (u?.email_confirmed_at) return authError(res, 422, "email_exists", "A user with this email address has already been registered");
          if (!u) u = await createUserRow({ email, password: body?.password, confirmed: false, meta: body?.data });
          kind = "confirmation";
        } else if (type === "magiclink" || type === "recovery") {
          if (!u) return authError(res, 404, "user_not_found", "User not found");
          kind = "recovery";
        } else {
          return send(res, 501, { msg: `generate_link ${type} is not in the fake` });
        }
        const hashed = newOtp(u, kind);
        const redirect = body?.redirect_to ?? url.searchParams.get("redirect_to") ?? null;
        links.push({ email: u.email, kind, hashed_token: hashed, redirect_to: redirect, at: Date.now() });
        return send(res, 200, {
          ...userJson(u),
          action_link: `http://127.0.0.1:${port}/auth/v1/verify?token=${hashed}&type=${type}`,
          email_otp: "000000",
          hashed_token: hashed,
          redirect_to: redirect,
          verification_type: type,
        });
      }
    }
    return send(res, 501, { msg: `auth ${req.method} ${path} is not in the fake` });
  }

  /* ── PostgREST ── */

  const ident = (name) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw Object.assign(new Error(`bad identifier ${name}`), { code: "PGRST100" });
    return `"${name}"`;
  };

  /** "a, b, rel (c, d), alias:col" -> items, splitting on top-level commas. */
  function parseSelect(text) {
    const items = [];
    let depth = 0;
    let cur = "";
    for (const ch of text ?? "*") {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        items.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    return items.map((raw) => {
      const open = raw.indexOf("(");
      if (open > 0 && raw.endsWith(")")) {
        let head = raw.slice(0, open).trim();
        let alias = null;
        if (head.includes(":")) [alias, head] = head.split(":").map((x) => x.trim());
        const rel = head.split("!")[0].trim();
        return { kind: "embed", alias: alias ?? rel, rel, inner: raw.slice(open + 1, -1) };
      }
      let alias = null;
      let col = raw;
      if (raw.includes(":") && !raw.includes("::")) [alias, col] = raw.split(":").map((x) => x.trim());
      const cast = col.includes("::") ? col.split("::")[1] : null;
      col = col.split("::")[0].trim();
      return { kind: "col", alias: alias ?? col, col, cast };
    });
  }

  let aliasN = 0;
  function selectSql(table, items, t) {
    const parts = [];
    for (const it of items) {
      if (it.kind === "col") {
        if (it.col === "*") parts.push(`${t}.*`);
        else parts.push(`${t}.${ident(it.col)}${it.cast ? `::${it.cast.replace(/[^a-z0-9_ ]/gi, "")}` : ""} as ${ident(it.alias)}`);
        continue;
      }
      const t2 = `t${++aliasN}`;
      const inner = selectSql(it.rel, parseSelect(it.inner), t2);
      const down = fks.find((f) => f.tbl === table && f.ref_tbl === it.rel);
      const up = fks.find((f) => f.tbl === it.rel && f.ref_tbl === table);
      if (down) {
        const on = down.cols.map((c, i) => `${t2}.${ident(down.ref_cols[i])} = ${t}.${ident(c)}`).join(" and ");
        parts.push(`(select to_jsonb(x) from (select ${inner} from public.${ident(it.rel)} ${t2} where ${on} limit 1) x) as ${ident(it.alias)}`);
      } else if (up) {
        const on = up.cols.map((c, i) => `${t2}.${ident(c)} = ${t}.${ident(up.ref_cols[i])}`).join(" and ");
        parts.push(`coalesce((select jsonb_agg(to_jsonb(x)) from (select ${inner} from public.${ident(it.rel)} ${t2} where ${on}) x), '[]'::jsonb) as ${ident(it.alias)}`);
      } else {
        throw Object.assign(new Error(`no relationship between ${table} and ${it.rel}`), { code: "PGRST200" });
      }
    }
    return parts.join(", ") || `${t}.*`;
  }

  const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
  /** The query string's filters as SQL against alias t0, with their parameters. */
  function whereSql(url, params) {
    const clauses = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    const one = (col, expr) => {
      let negate = false;
      let rest = expr;
      if (rest.startsWith("not.")) {
        negate = true;
        rest = rest.slice(4);
      }
      const dot = rest.indexOf(".");
      const op = rest.slice(0, dot);
      const value = rest.slice(dot + 1);
      const c = `t0.${ident(col)}`;
      let sql;
      switch (op) {
        case "eq": sql = `${c} = ${p(value)}`; break;
        case "neq": sql = `${c} <> ${p(value)}`; break;
        case "gt": sql = `${c} > ${p(value)}`; break;
        case "gte": sql = `${c} >= ${p(value)}`; break;
        case "lt": sql = `${c} < ${p(value)}`; break;
        case "lte": sql = `${c} <= ${p(value)}`; break;
        case "like": sql = `${c}::text like ${p(value.replace(/\*/g, "%"))}`; break;
        case "ilike": sql = `${c}::text ilike ${p(value.replace(/\*/g, "%"))}`; break;
        case "is": sql = `${c} is ${value === "null" ? "null" : value === "true" ? "true" : value === "false" ? "false" : "unknown"}`; break;
        case "in": {
          const list = value.replace(/^\(|\)$/g, "").split(",").map((v) => v.trim().replace(/^"|"$/g, "")).filter((v) => v !== "");
          sql = list.length ? `${c} in (${list.map((v) => p(v)).join(", ")})` : "false";
          break;
        }
        default:
          throw Object.assign(new Error(`filter ${op} is not in the fake`), { code: "PGRST100" });
      }
      return negate ? `not (${sql})` : sql;
    };
    for (const [key, value] of url.searchParams) {
      if (RESERVED.has(key)) continue;
      if (key === "or" || key === "and") throw Object.assign(new Error(`${key}= is not in the fake`), { code: "PGRST100" });
      clauses.push(one(key, value));
    }
    return clauses.length ? `where ${clauses.join(" and ")}` : "";
  }
  function orderSql(url) {
    const order = url.searchParams.get("order");
    if (!order) return "";
    return (
      "order by " +
      order
        .split(",")
        .map((part) => {
          const [col, ...mods] = part.split(".");
          const dir = mods.includes("desc") ? "desc" : "asc";
          const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
          return `t0.${ident(col)} ${dir}${nulls}`;
        })
        .join(", ")
    );
  }

  /** SQL as PostgREST would run it: in a transaction, as the JWT's role, with its claims set. */
  async function asRole(claims, fn) {
    const role = ["anon", "authenticated", "service_role"].includes(claims?.role) ? claims.role : "anon";
    return serial(() =>
      db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: "anon" })]);
        await tx.exec(`set local role ${role}`);
        return fn(tx);
      }),
    );
  }

  function pgError(res, err, claims) {
    const code = err.code ?? "XX000";
    const status =
      code === "42501" ? (claims?.role === "anon" ? 401 : 403)
      : code === "23505" || code === "23503" ? 409
      : code === "42883" || code === "PGRST202" ? 404
      : code === "PGRST200" || code === "PGRST100" ? 400
      : code.startsWith("P0") || code.startsWith("22") || code.startsWith("28") || code.startsWith("23") || code.startsWith("42") ? 400
      : 500;
    if (log) console.error(`[fake supabase] ${status} ${code} ${err.message}`);
    return send(res, status, { code, message: err.message, details: err.detail ?? null, hint: err.hint ?? null });
  }

  async function rest(req, res, path, url, body) {
    const claims = verifyJwt(bearer(req));
    if (!claims) return send(res, 401, { code: "PGRST301", message: "JWT could not be verified" });
    const prefer = req.headers.prefer ?? "";
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");

    if (path.startsWith("/rpc/")) {
      const name = path.slice(5);
      const info = await serial(() => functionInfo(name));
      if (!info) return send(res, 404, { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` });
      const args = body && typeof body === "object" ? body : Object.fromEntries(url.searchParams);
      const inputs = info.names
        .map((n, i) => ({ name: n, mode: info.modes[i] ?? "i" }))
        .filter((a) => a.mode === "i" || a.mode === "b")
        .map((a, i) => ({ ...a, type: info.intypes[i] }));
      const params = [];
      const call = inputs
        .filter((a) => Object.prototype.hasOwnProperty.call(args, a.name))
        .map((a) => {
          const v = args[a.name];
          params.push(v === null || v === undefined ? null : a.type === "jsonb" || a.type === "json" ? JSON.stringify(v) : typeof v === "object" ? JSON.stringify(v) : String(v));
          return `${ident(a.name)} => $${params.length}::${a.type}`;
        })
        .join(", ");
      const scalar = !info.retset && info.typtype !== "c";
      const sql = info.rettype === "void"
        ? `select count(*) as v from (select public.${ident(name)}(${call})) x`
        : info.retset || info.typtype === "c"
          ? `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as v from public.${ident(name)}(${call}) x`
          : `select to_jsonb(public.${ident(name)}(${call})) as v`;
      try {
        const out = await asRole(claims, (tx) => tx.query(sql, params));
        let v = out.rows[0]?.v ?? null;
        if (info.rettype === "void") return send(res, 204, null);
        if (!scalar && !info.retset && Array.isArray(v)) v = v[0] ?? null;
        if (wantsObject && Array.isArray(v)) {
          if (v.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
          v = v[0];
        }
        return send(res, 200, v);
      } catch (err) {
        return pgError(res, err, claims);
      }
    }

    const table = path.slice(1);
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) return send(res, 404, { code: "PGRST205", message: `Could not find the table public.${table}` });
    const params = [];
    try {
      if (req.method === "GET" || req.method === "HEAD") {
        aliasN = 0;
        const items = parseSelect(url.searchParams.get("select") ?? "*");
        const where = whereSql(url, params);
        const limit = url.searchParams.get("limit");
        const offset = url.searchParams.get("offset");
        const lim = limit && /^\d+$/.test(limit) ? ` limit ${limit}` : "";
        const off = offset && /^\d+$/.test(offset) ? ` offset ${offset}` : "";
        const countWanted = /count=(exact|planned|estimated)/.test(prefer);
        const result = await asRole(claims, async (tx) => {
          const rows = req.method === "HEAD" ? [] : (await tx.query(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as v from (select ${selectSql(table, items, "t0")} from public.${ident(table)} t0 ${where} ${orderSql(url)}${lim}${off}) x`, params)).rows[0].v;
          const count = countWanted ? (await tx.query(`select count(*)::int as n from public.${ident(table)} t0 ${where}`, params)).rows[0].n : null;
          return { rows, count };
        });
        const range = `${result.rows.length ? `0-${result.rows.length - 1}` : "*"}/${result.count ?? "*"}`;
        if (wantsObject) {
          if (result.rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
          return send(res, 200, result.rows[0], { "content-range": range });
        }
        return send(res, 200, result.rows, { "content-range": range });
      }

      const returning = prefer.includes("return=representation");
      if (req.method === "POST") {
        const list = Array.isArray(body) ? body : [body];
        const cols = [...new Set(list.flatMap((o) => Object.keys(o ?? {})))];
        params.push(JSON.stringify(list));
        const colSql = cols.map(ident).join(", ");
        const conflict = url.searchParams.get("on_conflict");
        const upsert = prefer.includes("resolution=merge-duplicates") && conflict;
        const onConflict = upsert ? ` on conflict (${conflict.split(",").map((c) => ident(c.trim())).join(", ")}) do update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}` : prefer.includes("resolution=ignore-duplicates") ? " on conflict do nothing" : "";
        const sql = `insert into public.${ident(table)} as t0 (${colSql}) select ${colSql} from jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb)${onConflict} returning to_jsonb(t0) as v`;
        const out = await asRole(claims, (tx) => tx.query(sql, params));
        const rows = out.rows.map((r) => r.v);
        if (!returning) return send(res, 201, null);
        return send(res, 201, wantsObject ? rows[0] ?? null : rows);
      }
      if (req.method === "PATCH") {
        const cols = Object.keys(body ?? {});
        params.push(JSON.stringify(body ?? {}));
        const where = whereSql(url, params);
        const sql = `update public.${ident(table)} as t0 set ${cols.map((c) => `${ident(c)} = r.${ident(c)}`).join(", ")} from jsonb_populate_record(null::public.${ident(table)}, $1::jsonb) r ${where} returning to_jsonb(t0) as v`;
        const out = await asRole(claims, (tx) => tx.query(sql, params));
        const rows = out.rows.map((r) => r.v);
        if (!returning) return send(res, 204, null);
        return send(res, 200, wantsObject ? rows[0] ?? null : rows);
      }
      if (req.method === "DELETE") {
        const where = whereSql(url, params);
        const out = await asRole(claims, (tx) => tx.query(`delete from public.${ident(table)} t0 ${where} returning to_jsonb(t0) as v`, params));
        const rows = out.rows.map((r) => r.v);
        if (!returning) return send(res, 204, null);
        return send(res, 200, rows);
      }
      return send(res, 405, { message: "method not allowed" });
    } catch (err) {
      return pgError(res, err, claims);
    }
  }

  /* ── Storage ── */

  const bucket = (name) => {
    if (!storage.has(name)) storage.set(name, new Map());
    return storage.get(name);
  };
  async function storageRoute(req, res, path, url, raw) {
    const claims = verifyJwt(bearer(req));
    if (!claims) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "invalid jwt" });
    const isService = claims.role === "service_role";
    let m = /^\/object\/list\/([^/]+)$/.exec(path);
    if (m && req.method === "POST") {
      const body = jsonOf(raw) ?? {};
      const prefix = String(body.prefix ?? "").replace(/\/+$/, "");
      const seen = new Map();
      for (const [p, f] of bucket(m[1])) {
        if (prefix && !p.startsWith(`${prefix}/`)) continue;
        const restPath = prefix ? p.slice(prefix.length + 1) : p;
        const slash = restPath.indexOf("/");
        if (slash === -1) seen.set(restPath, { name: restPath, id: f.id, created_at: f.created, updated_at: f.created, last_accessed_at: f.created, metadata: { size: f.bytes.length, mimetype: f.contentType } });
        else seen.set(restPath.slice(0, slash), { name: restPath.slice(0, slash), id: null, created_at: null, updated_at: null, last_accessed_at: null, metadata: null });
      }
      return send(res, 200, [...seen.values()].slice(0, Number(body.limit ?? 100)));
    }
    m = /^\/object\/([^/]+)$/.exec(path);
    if (m && req.method === "DELETE") {
      if (!isService) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "only the service role in the fake" });
      const body = jsonOf(raw) ?? {};
      const removed = [];
      for (const p of body.prefixes ?? []) {
        if (bucket(m[1]).delete(p)) removed.push({ name: p, bucket_id: m[1] });
      }
      return send(res, 200, removed);
    }
    m = /^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(path);
    if (m && (req.method === "POST" || req.method === "PUT")) {
      bucket(m[1]).set(decodeURIComponent(m[2]), { bytes: raw, contentType: req.headers["content-type"] ?? "application/octet-stream", id: randomUUID(), created: new Date().toISOString() });
      return send(res, 200, { Key: `${m[1]}/${m[2]}`, Id: randomUUID() });
    }
    if (m && req.method === "GET") {
      const f = bucket(m[1]).get(decodeURIComponent(m[2]));
      if (!f) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      res.writeHead(200, { ...CORS, "content-type": f.contentType });
      return res.end(f.bytes);
    }
    return send(res, 501, { message: `storage ${req.method} ${path} is not in the fake` });
  }

  /* ── Test helpers ── */

  async function testRoute(req, res, path, url, body) {
    const remote = req.socket.remoteAddress ?? "";
    if (!remote.includes("127.0.0.1") && remote !== "::1") return send(res, 403, { message: "local only" });
    if (path === "/links") {
      const email = (url.searchParams.get("email") ?? "").toLowerCase();
      return send(res, 200, links.filter((l) => !email || l.email.toLowerCase() === email));
    }
    if (path === "/sql" && req.method === "POST") {
      try {
        const out = await serial(() => db.query(String(body?.sql ?? ""), body?.params ?? []));
        return send(res, 200, out.rows);
      } catch (err) {
        return send(res, 400, { code: err.code, message: err.message });
      }
    }
    if (path === "/storage") return send(res, 200, Object.fromEntries([...storage].map(([b, files]) => [b, [...files.keys()]])));
    return send(res, 404, {});
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, null);
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const raw = await readBody(req);
      if (log) console.log(`[fake supabase] ${req.method} ${url.pathname}${url.search}`);
      if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url.pathname.slice(8), url, jsonOf(raw));
      if (url.pathname.startsWith("/rest/v1")) {
        const body = jsonOf(raw);
        if (body === undefined) return send(res, 400, { code: "PGRST102", message: "Empty or invalid json" });
        return await rest(req, res, url.pathname.slice(8), url, body);
      }
      if (url.pathname.startsWith("/storage/v1")) return await storageRoute(req, res, url.pathname.slice(11), url, raw);
      if (url.pathname.startsWith("/__test")) return await testRoute(req, res, url.pathname.slice(7), url, jsonOf(raw));
      return send(res, 404, { message: "not found" });
    } catch (err) {
      console.error("[fake supabase]", err);
      if (!res.headersSent) send(res, 500, { message: String(err?.message ?? err) });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${port}`,
    keys: fakeKeys(),
    local: s,
    links,
    storage,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await s.close();
    },
  };
}

/* ── Command line ──────────────────────────────────────────────────────────────────────────────── */

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const port = Number(arg("--port", "54329"));
  const envFile = arg("--write-env", null);
  const fake = await startFakeSupabase({ port, log: process.argv.includes("--log") });
  if (envFile) {
    writeFileSync(
      envFile,
      [
        "# Written by test/e2e/fakeSupabase.mjs: a dev server pointed at the local fake Supabase. Delete when done.",
        `NEXT_PUBLIC_SUPABASE_URL=${fake.url}`,
        `NEXT_PUBLIC_SUPABASE_ANON_KEY=${fake.keys.anon}`,
        `SUPABASE_SERVICE_ROLE_KEY=${fake.keys.service}`,
        "",
      ].join("\n"),
    );
  }
  console.log(`fake Supabase on ${fake.url}${envFile ? `; wrote ${envFile}` : ""}`);
}
