/**
 * Pulls the scan reports testers sent from Scrivn Scan ("Send to Scrivn team", 0008) - ours to read
 * with the service role, which is why this runs here and nowhere a browser reaches.
 *
 *   node scripts/pull-scan-report.mjs              the latest 20, newest first
 *   node scripts/pull-scan-report.mjs latest [dir] the newest one into dir (default ./scan-reports)
 *   node scripts/pull-scan-report.mjs 3f9a [dir]   the one whose id starts 3f9a
 *
 * A pulled report is the files a walk pulled off the phone would be - room_<stamp>_taps.json and
 * room_<stamp>_log.txt - with room_<stamp>_report.txt beside them (who, which phone, what they said),
 * and it is marked 'seen'. Since Scan 0.1.116 the log is the app's recent log, earlier runs and all, and
 * each run a Start ended is in it whole; those come out as room_<stamp>_earlier<k>_taps.json, oldest first. Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local
 * and never prints them.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

function env(name) {
  if (process.env[name]) return process.env[name].replace(/^﻿/, "").trim();
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line.replace(/^﻿/, ""));
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").replace(/﻿/g, "").trim();
  }
  throw new Error(`${name} is not in .env.local`);
}

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const LIST = "id, created_at, status, contact, device, android, app_version, note, organization_id, captured_at";

function stampOf(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function firstLine(s, n = 60) {
  const line = (s ?? "").split(/\r?\n/)[0].trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
}

const [arg, outArg] = process.argv.slice(2);

if (!arg || arg === "list") {
  const { data, error } = await db.from("scan_reports").select(LIST).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  if (!data.length) console.log("No reports yet.");
  for (const r of data) {
    console.log(`${r.id.slice(0, 8)}  ${stampOf(r.created_at)}  ${r.status.padEnd(4)}  ${(r.contact || "-").slice(0, 28).padEnd(28)}  ${(r.device || "?").slice(0, 18).padEnd(18)}  ${r.app_version || "?"}  ${firstLine(r.note)}`);
  }
  process.exit(0);
}

let id;
if (arg === "latest") {
  const { data, error } = await db.from("scan_reports").select("id").order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error("No reports yet.");
  id = data[0].id;
} else {
  const { data, error } = await db.from("scan_reports").select("id").order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const hits = data.filter((r) => r.id.startsWith(arg.toLowerCase()));
  if (hits.length !== 1) throw new Error(hits.length ? `${hits.length} reports start ${arg} - give more of the id.` : `No report starts ${arg}.`);
  id = hits[0].id;
}

const { data: r, error } = await db.from("scan_reports").select("*").eq("id", id).single();
if (error) throw new Error(error.message);

const out = outArg ?? "scan-reports";
if (!existsSync(out)) mkdirSync(out, { recursive: true });
const stamp = stampOf(r.captured_at ?? r.created_at);
const written = [];
if (r.capture) {
  writeFileSync(join(out, `room_${stamp}_taps.json`), JSON.stringify(r.capture, null, 2));
  written.push(`room_${stamp}_taps.json`);
}
/** What starts the line holding a capture Start ended (MainActivity.CAPTURE_JSON_MARK in Scan). */
const EARLIER_MARK = "capture json, as Start found it: ";
if (r.log_gz) {
  const log = gunzipSync(Buffer.from(r.log_gz, "base64")).toString("utf8");
  writeFileSync(join(out, `room_${stamp}_log.txt`), log);
  written.push(`room_${stamp}_log.txt`);
  let k = 0;
  for (const line of log.split("\n")) {
    const at = line.indexOf(EARLIER_MARK);
    if (at < 0) continue;
    try {
      const earlier = JSON.parse(line.slice(at + EARLIER_MARK.length));
      k++;
      const name = `room_${stamp}_earlier${k}_taps.json`;
      writeFileSync(join(out, name), JSON.stringify(earlier, null, 2));
      written.push(`${name} (ended ${line.slice(0, 18)})`);
    } catch {
      // A line cut short (a log trimmed to fit) is not a capture.
    }
  }
}
const meta = [
  `report ${r.id}`,
  `sent ${r.created_at}`,
  `captured ${r.captured_at ?? "-"}`,
  `from ${r.contact || "not given"}${r.organization_id ? ` (organization ${r.organization_id})` : " (not paired)"}`,
  `phone ${r.device || "?"}, Android ${r.android || "?"}, Scan ${r.app_version || "?"}, install ${r.install_id}`,
  "",
  r.note || "(no note)",
  "",
].join("\n");
writeFileSync(join(out, `room_${stamp}_report.txt`), meta);
written.push(`room_${stamp}_report.txt`);
if (r.status === "new") await db.from("scan_reports").update({ status: "seen" }).eq("id", id);
console.log(`${id.slice(0, 8)} -> ${out}: ${written.join(", ")}`);
console.log(firstLine(r.note, 200) || "(no note)");
