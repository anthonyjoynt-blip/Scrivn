/**
 * Builds Scrivn's exterior engine for Scrivn Scan (2026-10-15, lib/scanEngine.ts): one script, run in
 * the phone's off-screen WebView, so the roof and the exterior report on the phone are Scrivn's own.
 *
 *   node scripts/build-scan-engine.mjs            writes ../ARCapturePrototype/android/app/src/main/assets/scrivn-exterior.js
 *   node scripts/build-scan-engine.mjs --out DIR  writes DIR/scrivn-exterior.js
 *   node scripts/build-scan-engine.mjs --check    builds it in memory and says whether Scan's copy is this build (exit 1 if not)
 *
 * Build it again, and rebuild Scan, whenever the exterior, the roof or the report changes here: the
 * phone runs the copy it was built with. The script names the Scrivn commit it was made from, and
 * the phone and the report say it.
 */

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const check = args.includes("--check");
const scanAssets = resolve(root, "..", "ARCapturePrototype", "android", "app", "src", "main", "assets");
const outDir = outArg >= 0 ? resolve(args[outArg + 1]) : scanAssets;
const FILE = "scrivn-exterior.js";

/** The commit the engine is built from, and whether the tree has changes past it. */
function commit() {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
    const dirty = execSync("git status --porcelain -- lib components/sketch/exteriorDrawings.tsx", { cwd: root }).toString().trim() !== "";
    return `${sha}${dirty ? "+" : ""}`;
  } catch {
    return "unknown";
  }
}

export async function buildEngine() {
  const version = `scrivn ${commit()}`;
  const result = await build({
    entryPoints: [join(root, "lib", "scanEngineWebView.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    jsx: "automatic",
    alias: { "@": root },
    define: { __SCRIVN_ENGINE__: JSON.stringify(version), "process.env.NODE_ENV": '"production"' },
    // jsPDF's optional pieces for HTML and SVG-as-picture: the report draws neither.
    external: ["html2canvas", "dompurify", "canvg"],
    legalComments: "none",
    logLevel: "error",
  });
  const text = `/* Scrivn's exterior engine for Scrivn Scan, ${version}. Built by ScopeAssistantWeb/scripts/build-scan-engine.mjs: do not edit. */\n${result.outputFiles[0].text}`;
  return { version, text };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version, text } = await buildEngine();
  const target = join(outDir, FILE);
  if (check) {
    const same = existsSync(target) && readFileSync(target, "utf8").replace(/^\/\*[^\n]*\*\/\n/, "") === text.replace(/^\/\*[^\n]*\*\/\n/, "");
    console.log(same ? `Scan's engine is this build (${version}).` : `Scan's engine is not this build: run node scripts/build-scan-engine.mjs.`);
    process.exit(same ? 0 : 1);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(target, text);
  console.log(`${target}: ${(text.length / 1024).toFixed(0)} KB, ${version}`);
}
