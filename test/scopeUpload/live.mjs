/**
 * A REAL model read of a scope page (a paid call per page), sent as the app sends it, then set beside the hand reading
 * in fixtures/<name>.read.json line by line. Only with the owner's OK for the run:
 *
 *   SCRIVN_ALLOW_PAID_API=yes node test/scopeUpload/live.mjs <photo> <name>
 *   node test/scopeUpload/live.mjs --replay <name>        the saved answer, no call
 *
 * The photo is his and is not committed. The answer is saved to fixtures/<name>.model.json. The day's-spend table the
 * app keeps is not written to: this is development, not the product.
 */
import { build } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const args = process.argv.slice(2);
const replay = args.includes("--replay");
const [photo, name] = replay ? [null, args.find((a) => a !== "--replay")] : args;
if (!name) throw new Error("usage: live.mjs <photo> <name>, or --replay <name>");
if (!replay && process.env.SCRIVN_ALLOW_PAID_API !== "yes") throw new Error("this makes a paid call: set SCRIVN_ALLOW_PAID_API=yes for the run, with the owner's OK");

if (!replay) {
  // The API key from the main checkout's .env.local; the switch above must come from the command.
  const envFile = ["ScopeAssistantWeb"].map((d) => join(root, "..", d, ".env.local")).find(existsSync);
  for (const line of readFileSync(envFile, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const kv = line.match(/^(ANTHROPIC_API_KEY|ANTHROPIC_MODEL)=(.*)$/);
    if (kv && !process.env[kv[1]]) process.env[kv[1]] = kv[2].trim().replace(/^"|"$/g, "");
  }
}

const outDir = mkdtempSync(join(tmpdir(), "scope-upload-live-"));
const bundlePath = join(outDir, "bundle.mjs");
await build({
  stdin: {
    contents: [
      'export { createStructuredMessage } from "@/lib/anthropic";',
      'export { estimateUsd } from "@/lib/aiPricing";',
      'export { SCOPE_READ_SCHEMA, SCOPE_READ_SYSTEM, scopeReadFromWire, scopeReadProblem, scopeReadUserMessage } from "@/lib/scopeUploadPrompt";',
      'export { mergePages, scopeToNotes } from "@/lib/scopeUpload";',
    ].join("\n"),
    resolveDir: here,
    loader: "ts",
  },
  bundle: true, format: "esm", platform: "node", outfile: bundlePath, alias: { "@": root }, logLevel: "error",
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
      b.onResolve({ filter: /\/aiSpend$/ }, () => ({ path: "aiSpend", namespace: "stub" }));
      b.onLoad({ filter: /^server-only$/, namespace: "stub" }, () => ({ contents: "", loader: "js" }));
      b.onLoad({ filter: /^aiSpend$/, namespace: "stub" }, () => ({ contents: "export async function recordAiSpend() {}", loader: "js" }));
    },
  }],
});
const m = await import(pathToFileURL(bundlePath).href);
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const modelFile = join(here, "fixtures", `${name}.model.json`);

let wire;
let file = `${name}.jpg`;
if (replay) {
  const saved = JSON.parse(readFileSync(modelFile, "utf8"));
  wire = saved.wire;
  console.log(`${name}: the saved answer from ${saved.model}, ${saved.at}`);
} else {
  // As the notes step sends a photo (components/ScopeUploadButton.tsx): 2000 px on its long side, a JPEG at 0.85.
  const sharp = createRequire(join(root, "package.json"))("sharp");
  const data = await sharp(photo).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  file = basename(photo);
  const started = Date.now();
  const result = await m.createStructuredMessage({
    system: m.SCOPE_READ_SYSTEM,
    userMessage: m.scopeReadUserMessage("photo", 1, 1),
    schema: m.SCOPE_READ_SCHEMA,
    images: [{ mediaType: "image/jpeg", data: data.toString("base64") }],
    effort: "medium",
    maxTokens: 16000,
  });
  wire = result.output;
  const usd = m.estimateUsd(MODEL, result.usage, process.env);
  writeFileSync(modelFile, JSON.stringify({ model: MODEL, at: new Date().toISOString(), bytes: data.length, usage: result.usage, usd, wire, read: m.scopeReadFromWire(wire) }, null, 1));
  console.log(`${name}: ${((Date.now() - started) / 1000).toFixed(1)} s, ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, about $${usd.toFixed(3)}`);
}

const read = m.scopeReadFromWire(wire);
console.log(m.scopeReadProblem(read) ?? "usable");
console.log("\n--- the model's notes block ---");
console.log(m.scopeToNotes(m.mergePages([{ read, file }])));
const handFile = join(here, "fixtures", `${name}.read.json`);
if (existsSync(handFile)) {
  const hand = JSON.parse(readFileSync(handFile, "utf8")).read;
  console.log("\n--- the hand reading's notes block ---");
  console.log(m.scopeToNotes(m.mergePages([{ read: hand, file }])));
}
console.log("\n--- the raw answer ---");
console.log(JSON.stringify(wire, null, 1));
