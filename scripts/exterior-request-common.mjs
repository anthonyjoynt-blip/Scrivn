/**
 * What the Send to Scrivn team scripts share (0016, lib/exteriorRequests.ts):
 *
 *   node scripts/pull-exterior-request.mjs            the requests waiting for us
 *   node scripts/pull-exterior-request.mjs 3f9a       that one: marked measuring, its photos and inputs pulled
 *   node scripts/measure-exterior-request.mjs 3f9a    the photo route's own code run on what was pulled (no API)
 *   node scripts/return-exterior-request.mjs 3f9a exterior-requests/<id>/exterior.json
 *                                                     checked, stored as the result, marked ready; our copy deleted
 *
 * Each step is a function here taking the database client (supabase-js with the service role, or the tests'
 * PGlite one), so the tests run exactly what the scripts run. The service-role key is read from .env.local as
 * scripts/pull-scan-report.mjs reads it, and never printed.
 *
 * Our copies live in exterior-requests/<id>/ (gitignored) and are deleted when the request is returned, or when
 * the tester withdraws it - PRIVACY.md promises within 30 days, so every pull says which are older than that.
 */
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FOLDER = "exterior-requests";
export const KEEP_DAYS = 30;
export const PHOTO_BUCKET = "claim-photos";
export const REQUEST_FORMAT = "scrivn-exterior-request/1";
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A value from the environment, else from .env.local, cleaned of a byte-order mark (lib/env.ts says why). */
export function env(name, { root = ROOT, optional = false } = {}) {
  if (process.env[name]) return process.env[name].replace(/^\uFEFF/, "").trim();
  const file = join(root, ".env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line.replace(/^\uFEFF/, ""));
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").replace(/\uFEFF/g, "").trim();
    }
  }
  if (optional) return null;
  throw new Error(`${name} is not in .env.local`);
}

/** The service-role client: ours to use from this machine and nowhere a browser reaches. */
export async function serviceClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Scrivn's own code for checking and reading an exterior, bundled as the tests bundle it. */
export async function appCode() {
  const outDir = mkdtempSync(join(tmpdir(), "exterior-request-"));
  const entry = join(outDir, "entry.ts");
  const lib = (f) => join(ROOT, "lib", f).replace(/\\/g, "/");
  writeFileSync(entry, [`export { checkTeamResult, requestView, HOUSE_KEY } from "${lib("exteriorRequests.ts")}";`, `export { parseScanExterior } from "${lib("exteriorImport.ts")}";`].join("\n"));
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: join(outDir, "entry.mjs"), alias: { "@": ROOT }, logLevel: "silent" });
  const mod = await import(pathToFileURL(join(outDir, "entry.mjs")).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

export const short = (id) => String(id).slice(0, 8);

/** A request by its id or the start of it, among the latest 500. */
export async function findRequest(db, prefix) {
  const p = String(prefix ?? "").toLowerCase();
  if (!/^[0-9a-f-]{4,36}$/.test(p)) throw new Error("Give a request's id, or its first few characters.");
  const { data, error } = await db.from("exterior_requests").select("id").order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const hits = (data ?? []).filter((r) => r.id.startsWith(p));
  if (hits.length !== 1) throw new Error(hits.length ? `${hits.length} requests start ${p}: give more of the id.` : `No request starts ${p}.`);
  const { data: row, error: rowError } = await db.from("exterior_requests").select("*").eq("id", hits[0].id).maybeSingle();
  if (rowError || !row) throw new Error(rowError?.message ?? "The request went as it was read.");
  return row;
}

async function emailOf(db, userId) {
  if (!userId) return "";
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data?.user?.email ?? "";
  } catch {
    return "";
  }
}

const p2 = (n) => String(n).padStart(2, "0");
/** As a phone names a photo, by the time it was taken here: 20261016_124948. */
export function stampOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

const firstLine = (s, n = 60) => {
  const line = String(s ?? "").split(/\r?\n/)[0].trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

/** The requests still with us (sent or being measured), newest first, one line each. */
export async function listWaiting(db) {
  const { data, error } = await db
    .from("exterior_requests")
    .select("id, created_at, status, building, building_name, photo_ids, note, user_id")
    .in("status", ["sent", "measuring"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const lines = [];
  for (const r of data ?? []) {
    const who = await emailOf(db, r.user_id);
    const what = r.building_name || (r.building === "house" ? "House" : r.building);
    lines.push(`${short(r.id)}  ${stampOf(Date.parse(r.created_at))}  ${r.status.padEnd(9)}  ${what.slice(0, 16).padEnd(16)}  ${String(r.photo_ids?.length ?? 0).padStart(3)} photos  ${(who || "-").slice(0, 28).padEnd(28)}  ${firstLine(r.note)}`);
  }
  return lines;
}

/**
 * A photo's place on the walk round the house (2026-10-21, lib/photoRouteWalk.ts `WalkTag`), as the tester was asked for
 * it: "the front", "corner 3 at 45°", "side 2 straight on", "the wall before inside corner 4". Corner k is the shape's
 * corner k as the plan numbers them; side k runs from corner k to the next; the front from the last corner to corner 1.
 */
export function walkWords(tag) {
  if (!tag || typeof tag !== "object") return null;
  if (tag.role === "front") return "the front";
  if (tag.role === "side") return `side ${tag.k} straight on (corner ${tag.k} to the next)`;
  if (tag.role === "corner" && tag.corner === "joined") return `${tag.wall === "after" ? "the wall on from" : "the wall walked up to"} corner ${tag.k}, at an angle from where the home meets the neighbour's there`;
  if (tag.role === "corner") return tag.corner === "inside" ? `the wall before inside corner ${tag.k}` : `corner ${tag.k} at 45°`;
  return null;
}

/**
 * The measurements typed on the walk (2026-10-21, lib/photoRouteWalk.ts WalkMeasure) that are no tape of the route yet:
 * what, how long, the photo it is on and maybe one rough tap on it - ours to place exactly.
 */
export function typedMeasures(route, fileOf = new Map()) {
  const taped = new Set((route?.buildings ?? []).flatMap((b) => (b.tapes ?? []).map((t) => t.id)));
  return (route?.walk?.stops ?? []).flatMap((s) =>
    (s.measures ?? [])
      .filter((m) => !taped.has(m.id))
      .map((m) => ({ building: "main", what: m.what, feet: m.feet, typed: true, ...(m.photo ? { onPhoto: fileOf.get(m.photo) ?? m.photo } : {}), ...(Array.isArray(m.near) ? { near: m.near } : {}) })),
  );
}

/**
 * One request pulled to dir/<id>/: its photos at the size Scrivn keeps them, named as the phone names a photo
 * (as C:/Users/Anthony/Desktop/House Photos is), and request.json with the route's inputs, the tapes and the note.
 * Marked measuring, unless it is past that. A photo Scrivn does not have yet is said, not fatal: pull again later.
 */
export async function pullRequest(db, prefix, { dir = join(ROOT, FOLDER), now = new Date() } = {}) {
  const row = await findRequest(db, prefix);
  if (row.status === "withdrawn") throw new Error(`${short(row.id)} was withdrawn by the tester: nothing to measure.`);
  if (row.status === "applied") throw new Error(`${short(row.id)} was returned and used already.`);
  const { data: claim, error } = await db.from("claims").select("organization_id, photos:payload->photos").eq("id", row.claim_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!claim) throw new Error(`The claim of ${short(row.id)} is not there any more.`);
  const records = new Map((Array.isArray(claim.photos?.items) ? claim.photos.items : []).map((p) => [p.id, p]));
  const routePhotos = new Map((Array.isArray(row.route?.photos) ? row.route.photos : []).map((p) => [p.id, p]));

  const folder = join(dir, row.id);
  mkdirSync(folder, { recursive: true });
  const photos = [];
  const missing = [];
  const used = new Set();
  for (const [i, id] of (row.photo_ids ?? []).entries()) {
    const rec = records.get(id);
    const taken = typeof rec?.takenAt === "number" ? rec.takenAt : typeof routePhotos.get(id)?.takenAt === "number" ? routePhotos.get(id).takenAt : null;
    let name = taken ? stampOf(taken) : `photo_${p2(i + 1)}`;
    for (let k = 2; used.has(name); k++) name = `${taken ? stampOf(taken) : `photo_${p2(i + 1)}`}_${k}`;
    const { data: blob, error: downloadError } = await db.storage.from(PHOTO_BUCKET).download(`${claim.organization_id}/${row.claim_id}/${id}.jpg`);
    if (downloadError || !blob) {
      missing.push(id);
      continue;
    }
    used.add(name);
    const file = `${name}.jpg`;
    writeFileSync(join(folder, file), Buffer.from(await blob.arrayBuffer()));
    const walked = walkWords(routePhotos.get(id)?.walk);
    photos.push({ n: photos.length + 1, file, id, width: rec?.width ?? routePhotos.get(id)?.width ?? null, height: rec?.height ?? routePhotos.get(id)?.height ?? null, takenAt: taken ? new Date(taken).toISOString() : null, ...(walked ? { walk: walked } : {}) });
  }
  const fileOf = new Map(photos.map((p) => [p.id, p.file]));
  const tapes = (row.route?.buildings ?? []).flatMap((b) =>
    (b.tapes ?? []).map((t) => (t.kind === "line" ? { building: b.id, what: t.what, feet: t.feet, onPhoto: fileOf.get(t.photo) ?? t.photo, a: t.a, b: t.b } : { building: b.id, what: "side", feet: t.feet, fromCorner: t.from + 1 })),
  ).concat(typedMeasures(row.route, fileOf));
  const sentBy = await emailOf(db, row.user_id);
  const doc = {
    format: REQUEST_FORMAT,
    pulledAt: now.toISOString(),
    request: {
      id: row.id,
      claimId: row.claim_id,
      organizationId: row.organization_id,
      building: row.building,
      buildingName: row.building_name,
      status: row.status === "sent" ? "measuring" : row.status,
      sentAt: row.created_at,
      sentBy,
      note: row.note,
    },
    photos,
    missing,
    tapes,
    route: row.route ?? null,
    next: [`node scripts/measure-exterior-request.mjs ${short(row.id)}`, `node scripts/return-exterior-request.mjs ${short(row.id)} ${FOLDER}/${row.id}/exterior.json`],
  };
  writeFileSync(join(folder, "request.json"), JSON.stringify(doc, null, 2));
  if (row.status === "sent") {
    const { error: markError } = await db.from("exterior_requests").update({ status: "measuring", measuring_at: now.toISOString() }).eq("id", row.id).eq("status", "sent");
    if (markError) throw new Error(`Pulled, but not marked measuring: ${markError.message}`);
  }
  return { id: row.id, folder, photos, missing, tapes, note: row.note, sentBy, wasStatus: row.status };
}

/**
 * Our copies looked over (every pull does it): a request withdrawn, used, or gone with its claim has its folder
 * deleted; one kept past 30 days is said, loudly - return it or delete it.
 */
export async function sweepFolders(db, { dir = join(ROOT, FOLDER), now = new Date() } = {}) {
  const removed = [];
  const old = [];
  if (!existsSync(dir)) return { removed, old };
  for (const name of readdirSync(dir)) {
    const folder = join(dir, name);
    if (!UUID.test(name) || !statSync(folder).isDirectory()) continue;
    let pulledAt = statSync(folder).mtimeMs;
    try {
      const doc = JSON.parse(readFileSync(join(folder, "request.json"), "utf8"));
      if (doc.pulledAt) pulledAt = Date.parse(doc.pulledAt);
    } catch {
      /* the folder's own time, then */
    }
    const { data } = await db.from("exterior_requests").select("id, status").eq("id", name).maybeSingle();
    if (!data || data.status === "withdrawn" || data.status === "applied") {
      rmSync(folder, { recursive: true, force: true });
      removed.push({ id: name, why: !data ? "its claim was deleted" : data.status === "withdrawn" ? "the tester withdrew it" : "it was returned and used" });
      continue;
    }
    const days = Math.floor((now.getTime() - pulledAt) / DAY_MS);
    if (days > KEEP_DAYS) old.push({ id: name, days, status: data.status });
  }
  return { removed, old };
}

/** What the sweep found, for the console. */
export function sweepLines({ removed, old }) {
  return [
    ...removed.map((r) => `deleted our copy of ${short(r.id)}: ${r.why}`),
    ...old.map((o) => `WARNING: our copy of ${short(o.id)} is ${o.days} days old (${o.status}). PRIVACY.md promises 30: return it, or delete ${FOLDER}/${o.id}.`),
  ];
}

/** An exterior file as we write it: Scrivn's Exterior (the measure script's exterior.json), or a Scan exterior capture. */
export function readExteriorFile(app, text, now) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`That file is not JSON: ${err.message}`);
  }
  if (json && typeof json.format === "string" && json.format.startsWith("arcapture-exterior/")) {
    const read = app.parseScanExterior(json, { scanId: null, receivedAt: now.toISOString() });
    if (!read.ok) throw new Error(`That capture cannot be read: ${read.error}`);
    return { exterior: read.exterior, from: `a Scan exterior capture (${json.format})`, notes: read.notes };
  }
  const exterior = json && json.exterior && Array.isArray(json.exterior.sides) ? json.exterior : json;
  return { exterior, from: "an exterior", notes: [] };
}

/**
 * A measured exterior returned: checked as the claim will open it (lib/exteriorRequests.ts checkTeamResult),
 * stored as the result, the request marked ready - unless the tester withdrew it meanwhile - and our copy
 * deleted. Returned again while still ready, the new one replaces the old. `notify` is told who to tell.
 */
export async function returnRequest(db, app, prefix, file, { dir = join(ROOT, FOLDER), now = new Date(), notify = null } = {}) {
  const row = await findRequest(db, prefix);
  if (row.status === "withdrawn") throw new Error(`${short(row.id)} was withdrawn by the tester: not returned.`);
  if (row.status === "applied") throw new Error(`${short(row.id)} was returned and used already.`);
  const { exterior, from, notes } = readExteriorFile(app, readFileSync(file, "utf8"), now);
  const checked = app.checkTeamResult(exterior);
  if (!checked.ok) throw new Error(`Not returned: ${checked.error}`);
  const { data: updated, error } = await db
    .from("exterior_requests")
    .update({ status: "ready", ready_at: now.toISOString(), result: checked.value })
    .eq("id", row.id)
    .neq("status", "withdrawn")
    .neq("status", "applied")
    .select("id, status");
  if (error) throw new Error(`Not returned: ${error.message}`);
  if (!updated?.length) throw new Error(`${short(row.id)} was withdrawn while it was being returned: not returned.`);
  const folder = join(dir, row.id);
  const hadFolder = existsSync(folder);
  if (hadFolder) rmSync(folder, { recursive: true, force: true });
  const to = await emailOf(db, row.user_id);
  let told = null;
  if (notify && to) told = await notify({ to, request: row, sides: checked.value.sides.length });
  return { id: row.id, from, notes, warnings: checked.warnings ?? [], sides: checked.value.sides.length, deleted: hadFolder ? folder : null, to, told, replaced: row.status === "ready" };
}

/**
 * "Your exterior measurements are ready", through Scrivn's own email code (lib/email/send.ts, Resend), bundled
 * here as the tests bundle the routes. Null when email is not set up on this machine: the request is ready
 * either way, and the Exterior says so when the tester next opens it.
 */
export async function readyMailer() {
  const key = env("RESEND_API_KEY", { optional: true });
  if (!key) return null;
  process.env.RESEND_API_KEY = key;
  const outDir = join(ROOT, "node_modules", ".cache", "exterior-requests");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `mail-${process.pid}.mjs`);
  const empty = join(outDir, "server-only.mjs");
  writeFileSync(empty, "export {};\n");
  await build({
    stdin: { contents: `export { sendEmail } from "@/lib/email/send"; export { ExteriorReadyMessage } from "@/emails/ExteriorReady";`, resolveDir: ROOT, loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    alias: { "@": ROOT },
    jsx: "automatic",
    packages: "external",
    logLevel: "error",
    plugins: [{ name: "server-only", setup: (b) => b.onResolve({ filter: /^server-only$/ }, () => ({ path: empty })) }],
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outfile, { force: true });
  const base = (env("NEXT_PUBLIC_APP_URL", { optional: true }) || "https://scrivn.ca").replace(/\/+$/, "");
  return async ({ to, request }) => {
    const what = request.building_name || "the house";
    const sent = await mod.sendEmail({
      to,
      subject: "Your exterior measurements are ready",
      react: mod.ExteriorReadyMessage({ what, claimUrl: `${base}/claim?id=${request.claim_id}` }),
    });
    return sent.ok ? "emailed" : `not emailed: ${sent.reason}`;
  };
}
