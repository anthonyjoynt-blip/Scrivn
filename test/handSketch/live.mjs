/**
 * A REAL model read of the owner's sketch photos — a paid call per photo — then the build from it,
 * scored against the tape like run.mjs's hand-written reads. Only with the owner's OK for the run:
 *
 *   SCRIVN_ALLOW_PAID_API=yes node test/handSketch/live.mjs <photo dir> [spare|bathroom ...] [--out dir]
 *   node test/handSketch/live.mjs --replay [spare|bathroom ...] [--out dir]    the saved answers, no call
 *
 * <photo dir> holds spare.* and bathroom.* (the photos are his and are not committed). Each answer
 * is saved to fixtures/<name>.model.json, so it can be built from again without another call.
 * The day's-spend table the app keeps is not written to: this is development, not the product.
 */
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { score } from "./score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const writeTo = outArg >= 0 ? args[outArg + 1] : null;
const replay = args.includes("--replay");
const positional = args.filter((a, i) => !a.startsWith("--") && !(outArg >= 0 && i === outArg + 1));
const [photoDir, ...only] = replay ? [null, ...positional] : positional;
if (!photoDir && !replay) throw new Error("usage: live.mjs <photo dir> [spare|bathroom ...] [--out dir], or --replay");
if (!replay && process.env.SCRIVN_ALLOW_PAID_API !== "yes") throw new Error("this makes paid calls: set SCRIVN_ALLOW_PAID_API=yes for the run, with the owner's OK");

if (!replay) {
  // The API key from the main checkout's .env.local; the switch above must come from the command.
  const envFile = ["ScopeAssistantWeb", "ScopeAssistantWeb-hand-sketch"].map((d) => join(root, "..", d, ".env.local")).find(existsSync);
  for (const line of readFileSync(envFile, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const kv = line.match(/^(ANTHROPIC_API_KEY|ANTHROPIC_MODEL)=(.*)$/);
    if (kv && !process.env[kv[1]]) process.env[kv[1]] = kv[2].trim().replace(/^"|"$/g, "");
  }
}

const outDir = mkdtempSync(join(tmpdir(), "hand-sketch-live-"));
const bundlePath = join(outDir, "bundle.mjs");
await build({
  entryPoints: [join(here, "live-entry.ts")], bundle: true, format: "esm", platform: "node", outfile: bundlePath, alias: { "@": root }, logLevel: "error",
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
const sharp = createRequire(join(root, "package.json"))("sharp");
const tape = JSON.parse(readFileSync(join(here, "fixtures", "tape.json"), "utf8"));
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

let total = 0;
for (const name of only.length ? only : ["spare", "bathroom"]) {
  let output;
  let usage;
  if (replay) {
    const saved = JSON.parse(readFileSync(join(here, "fixtures", `${name}.model.json`), "utf8"));
    ({ wire: output, usage } = saved);
    console.log(`\n${name}: the saved answer from ${saved.model}, ${saved.at}`);
  } else {
    const file = readdirSync(photoDir).find((f) => f.startsWith(`${name}.`));
    if (!file) throw new Error(`no ${name}.* in ${photoDir}`);
    // Sent at most 1400 px on its long side, as a JPEG: the model's own working size, and what the
    // coordinates it answers in are measured against.
    const { data, info } = await sharp(join(photoDir, file)).rotate().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const started = Date.now();
    ({ output, usage } = await m.createStructuredMessage({
      system: m.HAND_SKETCH_SYSTEM,
      userMessage: m.handSketchUserMessage(info.width, info.height),
      schema: m.HAND_SKETCH_SCHEMA,
      images: [{ mediaType: "image/jpeg", data: data.toString("base64") }],
    }));
    const usd = m.estimateUsd(MODEL, usage, process.env);
    total += usd;
    writeFileSync(join(here, "fixtures", `${name}.model.json`), JSON.stringify({ model: MODEL, at: new Date().toISOString(), image: { width: info.width, height: info.height }, usage, usd, wire: output, read: m.readFromWire(output) }, null, 1));
    console.log(`\n${name}: ${((Date.now() - started) / 1000).toFixed(1)} s, ${usage.inputTokens} in / ${usage.outputTokens} out, about $${usd.toFixed(3)}`);
  }
  const read = m.readFromWire(output);
  const problem = m.readProblem(read);
  if (problem) {
    console.log(`  the read is not usable: ${problem}`);
    continue;
  }
  read.rooms.forEach((r, i) => console.log(`  room ${i}: ${r.name ?? `(${r.guess ?? "?"})`}, ${r.corners.length} corners, walls ${r.walls.map((w) => w.length ?? "—").join(" / ")}, ceiling ${r.ceiling ?? "—"}; openings ${r.openings.map((o) => `${o.kind}@w${o.wall}${o.orWall !== null ? `|w${o.orWall}` : ""}${o.sure ? "" : "?"}${o.size ? ` ${o.size}` : ""}`).join(", ") || "none"}; items ${r.items.map((it) => `${it.kind}@w${it.wall}`).join(", ") || "none"}`));
  if (read.ignored.length) console.log(`  ignored: ${read.ignored.join("; ")}`);
  const built = m.buildFromRead(read);
  score(name === "spare" ? "Spare room" : "Bathroom", built.rooms[0], tape[name], m.feetInches);
  console.log(`  ${built.questions.length} questions: ${built.questions.map((q) => q.kind).join(", ")}`);
  console.log(`  placed: ${built.placed.map((p) => `${p.what} ${p.size} (${p.source})`).join("; ")}`);
  if (writeTo) {
    mkdirSync(writeTo, { recursive: true });
    writeFileSync(join(writeTo, `${name}-model.sketch.json`), JSON.stringify({ rooms: built.rooms }, null, 1));
  }
}
if (!replay) console.log(`\nTotal about $${total.toFixed(3)}`);
