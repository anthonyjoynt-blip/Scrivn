/**
 * Builds the offline photo test into a page and serves it.
 *
 *   npm run test:photos:browser        then open http://localhost:4612
 *
 * Same shape as the save-queue harness (test/pending/browser), for the same reason: the code under
 * test is React, IndexedDB, a canvas and a media stream together, and a stub of any of them would be
 * a stub of the thing being tested. Results render on the page and are left on `window.__photoTests`.
 * Rebuilt on every request, so a reload picks up an edit.
 */

import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const port = Number(process.env.PORT ?? 4612);
const outDir = mkdtempSync(join(tmpdir(), "photos-browser-"));
const bundlePath = join(outDir, "tests.js");
const cssPath = join(outDir, "tests.css");

async function render() {
  await build({
    entryPoints: [join(here, "entry.tsx")],
    bundle: true,
    format: "iife",
    outfile: bundlePath,
    alias: { "@": root },
    define: { "process.env.NODE_ENV": '"development"' },
    jsx: "automatic",
    loader: { ".css": "css" },
    logLevel: "error",
  });
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  const appCss = readFileSync(join(root, "app", "globals.css"), "utf8");

  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Photo tests</title>
<style>${appCss}</style>
<style>${css}</style>
<style>
  #report { margin: 24px; font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6; }
  #report h1 { font-size: 15px; margin: 0 0 4px; }
  #summary { font-weight: 700; margin: 12px 0; }
  .ok { color: #1a7f37; }
  .bad { color: #9c2626; font-weight: 700; }
  #report i { color: #5b6472; font-style: normal; }
  #harness { margin: 24px; }
</style>
<div id="report"><h1>Photos — a photo taken with no signal, uploaded when it is back</h1><div id="summary">running…</div><div id="results"></div></div>
<div id="harness"></div>
<script>${readFileSync(bundlePath, "utf8")}</script>`;
}

createServer((_req, res) => {
  void render().then(
    (page) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
    },
    (err) => {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(String(err?.message ?? err));
    },
  );
}).listen(port, () => {
  console.log(`\n  Photo tests: http://localhost:${port}\n`);
});

process.on("exit", () => rmSync(outDir, { recursive: true, force: true }));
