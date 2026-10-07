/**
 * Puts a Scrivn Scan build where testers download it (2026-10-07): before the Play listing, testers
 * install the release APK from scrivn.ca/scan-download (app/scan-download/route.ts), which sends them
 * to the newest build named in latest.json.
 *
 *   node scripts/publish-scan-apk.mjs [path/to/app-release.apk]
 *
 * Defaults to the release build in ../ARCapturePrototype. The version is read from the APK itself
 * (aapt2 from the Android SDK), so the file name always says what is in it. Uploads to the public
 * Storage bucket `scan-builds` (made here on first run) as scrivn-scan-<version>.apk, then rewrites
 * latest.json. Uses SUPABASE_SERVICE_ROLE_KEY from .env.local and never prints it.
 *
 * Public on purpose: a tester has no account to sign in with. The bucket holds builds and nothing
 * else - only the service role writes to it.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BUCKET = "scan-builds";
const APK_TYPE = "application/vnd.android.package-archive";

function env(name) {
  if (process.env[name]) return process.env[name].replace(/^﻿/, "").trim();
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line.replace(/^﻿/, ""));
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").replace(/﻿/g, "").trim();
  }
  throw new Error(`${name} is not in .env.local`);
}

function versionOf(apk) {
  const sdk = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
  const tools = join(sdk, "build-tools");
  const newest = readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  const aapt2 = join(tools, newest, process.platform === "win32" ? "aapt2.exe" : "aapt2");
  const badging = execFileSync(aapt2, ["dump", "badging", apk], { encoding: "utf8" });
  const m = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
  if (!m) throw new Error("Could not read the APK's version.");
  if (m[1] !== "ca.scrivn.scan") throw new Error(`That APK is ${m[1]}, not ca.scrivn.scan (a debug build?).`);
  return { code: Number(m[2]), name: m[3] };
}

const apk = process.argv[2] ?? join("..", "ARCapturePrototype", "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!existsSync(apk)) throw new Error(`No APK at ${apk}`);
const version = versionOf(apk);
const bytes = readFileSync(apk);

const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

const { data: buckets, error: listError } = await db.storage.listBuckets();
if (listError) throw new Error(listError.message);
if (!buckets.some((b) => b.id === BUCKET)) {
  const { error } = await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: "30MB", allowedMimeTypes: [APK_TYPE, "application/json"] });
  if (error) throw new Error(`Could not make the ${BUCKET} bucket: ${error.message}`);
  console.log(`made the public bucket ${BUCKET}`);
}

const file = `scrivn-scan-${version.name}.apk`;
const up = await db.storage.from(BUCKET).upload(file, bytes, { contentType: APK_TYPE, upsert: true, cacheControl: "3600" });
if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

const latest = { version: version.name, versionCode: version.code, file, bytes: statSync(apk).size, publishedAt: new Date().toISOString() };
const meta = await db.storage
  .from(BUCKET)
  .upload("latest.json", Buffer.from(JSON.stringify(latest, null, 2)), { contentType: "application/json", upsert: true, cacheControl: "0" });
if (meta.error) throw new Error(`latest.json failed: ${meta.error.message}`);

const url = db.storage.from(BUCKET).getPublicUrl(file).data.publicUrl;
console.log(`published Scrivn Scan ${version.name} (${(latest.bytes / 1048576).toFixed(1)} MB)`);
console.log(url);
