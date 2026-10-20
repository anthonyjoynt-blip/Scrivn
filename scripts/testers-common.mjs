/**
 * What add-tester.mjs and list-testers.mjs share: the settings, the service-role client, and Scrivn's
 * own code for it (lib/testerAccounts.ts, lib/accountMaking.ts, lib/email/send.ts), bundled as
 * scripts/exterior-request-common.mjs bundles the email code.
 *
 * Settings come from the environment, else from .env.local, cleaned of a byte-order mark (lib/env.ts
 * says why). SCRIVN_ENV_FILE names another file instead of .env.local: the tests point it at one of
 * their own, so a test can never reach the real project through this checkout's .env.local.
 */
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const envFile = () => process.env.SCRIVN_ENV_FILE || join(ROOT, ".env.local");

/** A setting, or null. Never printed. */
export function setting(name) {
  if (process.env[name]) return process.env[name].replace(/^﻿/, "").trim() || null;
  const file = envFile();
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line.replace(/^﻿/, ""));
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").replace(/﻿/g, "").trim() || null;
  }
  return null;
}

/** Which Supabase this talks to, by host, so every run says where it went. */
export function supabaseHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The service-role client and where it points. Refuses, naming what is missing, without either value:
 * making accounts needs the key that bypasses every rule, and only this machine has it.
 */
export async function serviceClient() {
  const url = setting("NEXT_PUBLIC_SUPABASE_URL");
  const key = setting("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not in .env.local, so there is no Supabase to talk to. Nothing was done.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not in .env.local. Giving someone an account needs the service-role key. Nothing was done.");
  const { createClient } = await import("@supabase/supabase-js");
  return { db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), host: supabaseHost(url) };
}

/**
 * Scrivn's code for this. The settings it reads itself (the email key, the trial hash's salt) are put
 * in the environment first, from .env.local, so the account is hashed and emailed as the site would.
 */
export async function testerCode() {
  for (const name of ["RESEND_API_KEY", "GUARD_HASH_SECRET"]) {
    const value = setting(name);
    if (value) process.env[name] = value;
  }
  const outDir = join(ROOT, "node_modules", ".cache", "testers");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `testers-${process.pid}.mjs`);
  const empty = join(outDir, "server-only.mjs");
  writeFileSync(empty, "export {};\n");
  await build({
    stdin: { contents: `export * from "@/lib/testerAccounts"; export { sendEmail, isEmailConfigured } from "@/lib/email/send";`, resolveDir: ROOT, loader: "ts" },
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
  return mod;
}

/** 2026-10-20, or "–". */
export const day = (iso) => (iso ? String(iso).slice(0, 10) : "–");
