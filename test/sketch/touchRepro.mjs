/** Serves the phone-layout repro page — see touchRepro.tsx. */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "repro-"));
const bundlePath = join(outDir, "repro.js");

await build({
  entryPoints: [join(here, "touchRepro.tsx")],
  bundle: true,
  format: "iife",
  outfile: bundlePath,
  alias: { "@": root },
  define: { "process.env.NODE_ENV": '"development"' },
  jsx: "automatic",
  logLevel: "error",
});

const page = `<!doctype html><meta charset="utf-8"><title>Touch repro</title>
<link rel="stylesheet" href="/globals.css"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#fff"><div id="root"></div>
<script>${readFileSync(bundlePath, "utf8")}</script>`;
rmSync(outDir, { recursive: true, force: true });

const css = readFileSync(join(root, "app", "globals.css"), "utf8");
createServer((req, res) => {
  if (req.url === "/globals.css") {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    res.end(css);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
}).listen(4622, () => console.log("  repro on http://localhost:4622"));
