/**
 * A supabase-js client over LocalSupabase (test/db/supabaseLocal.mjs): the part of its query builder
 * the billing routes use, so those routes run unchanged against every migration in memory.
 *
 *   const admin = supabaseJs(local, { role: "service_role" });
 *   const user = supabaseJs(local, { userId, email });
 *
 * Covers from(table) with select (plain columns, and a to-one embed such as
 * `organizations (subscription_tier)` through its `organization_id`), update, insert, delete, eq,
 * neq, is, limit, maybeSingle and single; rpc() with named arguments; auth.getClaims() and
 * auth.admin.getUserById(). Errors come back as `{ data: null, error: { code, message } }`, as
 * supabase-js reports Postgres's own codes, so `isBillingSchemaMissing` reads them the same way.
 * Anything else throws, so a route that starts needing more fails loudly rather than passing.
 */

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`supabaseJs: unsupported identifier ${JSON.stringify(name)}`);
  return `"${name}"`;
};
const value = (v) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);
const asError = (err) => ({ code: err?.code ?? "", message: err?.message ?? String(err) });

/** Splits a select list on its top-level commas: `a, b, organizations (c, d)` → three items. */
function selectItems(columns) {
  const items = [];
  let depth = 0;
  let current = "";
  for (const ch of columns) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items.map((item) => {
    const embed = /^([a-z_]+)\s*\((.*)\)$/s.exec(item);
    return embed ? { embed: embed[1], columns: embed[2] } : { column: item };
  });
}

class Query {
  constructor(run, table) {
    this.run = run;
    this.table = table;
    this.op = null;
    this.columns = "*";
    this.values = null;
    this.filters = [];
    this.limitTo = null;
    this.returning = null;
    this.single = null;
  }

  select(columns = "*", options = {}) {
    if (options.count || options.head) throw new Error("supabaseJs: select with count/head is not supported");
    if (this.op) this.returning = columns;
    else {
      this.op = "select";
      this.columns = columns;
    }
    return this;
  }
  update(values) {
    this.op = "update";
    this.values = values;
    return this;
  }
  insert(values) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column, v) {
    this.filters.push({ column, op: "=", v });
    return this;
  }
  neq(column, v) {
    this.filters.push({ column, op: "<>", v });
    return this;
  }
  is(column, v) {
    if (v !== null) throw new Error("supabaseJs: is() supports null only");
    this.filters.push({ column, op: "is null" });
    return this;
  }
  limit(n) {
    this.limitTo = n;
    return this;
  }
  maybeSingle() {
    this.single = "maybe";
    return this;
  }
  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  where(params) {
    if (this.filters.length === 0) return "";
    return (
      " where " +
      this.filters
        .map((f) => {
          if (f.op === "is null") return `${ident(f.column)} is null`;
          params.push(value(f.v));
          return `${ident(f.column)} ${f.op} $${params.length}`;
        })
        .join(" and ")
    );
  }

  async exec() {
    const params = [];
    const table = `public.${ident(this.table)}`;
    let sql;
    let embeds = [];
    if (this.op === "select") {
      const items = selectItems(this.columns);
      embeds = items.filter((i) => i.embed);
      const plain = items.filter((i) => i.column).map((i) => (i.column === "*" ? "*" : ident(i.column)));
      // The embed is found through the row's `<name>_id`, so fetch that too.
      for (const e of embeds) plain.push(ident(`${e.embed.replace(/s$/, "")}_id`));
      sql = `select ${[...new Set(plain)].join(", ")} from ${table}${this.where(params)}${this.limitTo ? ` limit ${Number(this.limitTo)}` : ""}`;
    } else if (this.op === "update") {
      const sets = Object.entries(this.values).map(([k, v]) => {
        params.push(value(v));
        return `${ident(k)} = $${params.length}`;
      });
      sql = `update ${table} set ${sets.join(", ")}${this.where(params)}${this.returning ? ` returning ${this.returning === "*" ? "*" : this.returning.split(",").map((c) => ident(c.trim())).join(", ")}` : ""}`;
    } else if (this.op === "insert") {
      const rows = Array.isArray(this.values) ? this.values : [this.values];
      const keys = Object.keys(rows[0]);
      const tuples = rows.map((r) => `(${keys.map((k) => (params.push(value(r[k])), `$${params.length}`)).join(", ")})`);
      sql = `insert into ${table} (${keys.map(ident).join(", ")}) values ${tuples.join(", ")}${this.returning ? " returning *" : ""}`;
    } else if (this.op === "delete") {
      sql = `delete from ${table}${this.where(params)}`;
    } else throw new Error("supabaseJs: no operation");

    const res = await this.run(sql, params);
    if (res.error) return { data: null, error: asError(res.error) };
    let rows = res.data.map(isoDates);
    for (const e of embeds) {
      const key = `${e.embed.replace(/s$/, "")}_id`;
      const out = [];
      for (const row of rows) {
        const columns = selectItems(e.columns).map((i) => ident(i.column)).join(", ");
        const sub = row[key] == null ? { data: [], error: null } : await this.run(`select ${columns} from public.${ident(e.embed)} where "id" = $1`, [row[key]]);
        if (sub.error) return { data: null, error: asError(sub.error) };
        out.push({ ...row, [e.embed]: sub.data.map(isoDates)[0] ?? null });
      }
      rows = out;
    }
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    if (this.single === "maybe") {
      if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "more than one row" } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }
}

/** PostgREST sends timestamps as ISO strings; PGlite hands back Dates. */
function isoDates(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

export function supabaseJs(local, { userId = null, email = null, role = null } = {}) {
  const run = (text, params) => (role === "service_role" ? local.service(text, params) : local.as(userId, text, params));
  return {
    from: (table) => new Query(run, table),
    async rpc(fn, args = {}) {
      const params = [];
      const named = Object.entries(args).map(([k, v]) => {
        params.push(value(v));
        return `${ident(k)} => $${params.length}`;
      });
      const res = await run(`select * from public.${ident(fn)}(${named.join(", ")})`, params);
      if (res.error) return { data: null, error: asError(res.error) };
      const rows = res.data.map(isoDates);
      // A function returning one value comes back from PostgREST as that value, not as a row.
      if (rows.length === 1 && Object.keys(rows[0]).length === 1 && fn in rows[0]) return { data: rows[0][fn], error: null };
      return { data: rows, error: null };
    },
    auth: {
      async getClaims() {
        return { data: userId ? { claims: { sub: userId, email } } : null, error: null };
      },
      admin: {
        async getUserById(id) {
          const rows = await local.sql(`select id, email from auth.users where id = $1`, [id]);
          return { data: { user: rows[0] ?? null }, error: rows[0] ? null : { message: "User not found" } };
        },
      },
    },
  };
}
