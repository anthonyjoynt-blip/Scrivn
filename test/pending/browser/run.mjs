/**
 * Builds the save-queue browser tests into a page and serves it.
 *
 *   npm run test:pending:browser
 *
 * Same shape as the sketch harness next door, and for the same reason: the code under test is React
 * effects driving IndexedDB, and running it under a stub would mean stubbing the parts under test.
 * A real browser has both.
 *
 * Results render on the page and are also left on `window.__pendingTests`, so this can be driven
 * programmatically as well as read by a person.
 */

import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const port = Number(process.env.PORT ?? 4600);
const outDir = mkdtempSync(join(tmpdir(), "pending-browser-"));
const bundlePath = join(outDir, "tests.js");

/*
  Rebuilt on every request rather than once at startup, so a reload picks up an edit to the hook.
  That is what makes it possible to check these tests can FAIL: mutate the source, reload, watch the
  right ones break. A build takes a fraction of a second, and nothing else is served from here.
*/
async function render() {
  await build({
    entryPoints: [join(here, "entry.tsx")],
    bundle: true,
    format: "iife",
    outfile: bundlePath,
    // The hook is written for Next, which resolves "@/..." to the project root.
    alias: { "@": root },
    define: { "process.env.NODE_ENV": '"development"' },
    jsx: "automatic",
    logLevel: "error",
  });

  return `<!doctype html><meta charset="utf-8"><title>Save queue tests</title>
<style>
  body { margin: 24px; font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  #summary { font-weight: 700; margin: 12px 0; }
  .ok { color: #1a7f37; }
  .bad { color: #9c2626; font-weight: 700; }
  i { color: #5b6472; font-style: normal; }
  #harness { color: #5b6472; border-bottom: 1px solid #e1e5ea; padding-bottom: 8px; }
</style>
<h1>Save queue — the claim page's offline wiring</h1>
<div id="harness"></div>
<div id="summary">running…</div>
<div id="results"></div>
<script>${readFileSync(bundlePath, "utf8")}</script>`;
}

createServer((_req, res) => {
  void render().then(
    (page) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
    },
    (err) => {
      // A compile error is a result too — showing it beats an empty page and a silent server.
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(String(err?.message ?? err));
    },
  );
}).listen(port, () => {
  console.log(`\n  Save queue tests: http://localhost:${port}\n`);
});

process.on("exit", () => rmSync(outDir, { recursive: true, force: true }));
