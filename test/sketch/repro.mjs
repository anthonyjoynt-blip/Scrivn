/** Serves the cabinet repro page — see repro.tsx. */
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
  entryPoints: [join(here, "repro.tsx")],
  bundle: true,
  format: "iife",
  outfile: bundlePath,
  alias: { "@": root },
  define: { "process.env.NODE_ENV": '"development"' },
  jsx: "automatic",
  logLevel: "error",
});

const page = `<!doctype html><meta charset="utf-8"><title>Cabinet repro</title>
<body style="margin:24px;background:#fff"><div id="root"></div>
<script>${readFileSync(bundlePath, "utf8")}</script>`;
rmSync(outDir, { recursive: true, force: true });

createServer((_q, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
}).listen(4620, () => console.log("  repro on http://localhost:4620"));
