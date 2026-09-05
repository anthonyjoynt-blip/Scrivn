/**
 * Builds the sketch gesture tests into a page and serves it.
 *
 *   npm run test:sketch
 *
 * These need a real browser: they drive the actual `SketchCanvas` through Konva's event and
 * hit-testing machinery, which is where every bug they cover lived. Running them under jsdom would
 * mean stubbing exactly the parts under test, and node-canvas is a native build this project has no
 * other reason to carry — so the runner serves a page and you open it. Results render on the page
 * and are also left on `window.__sketchTests` for anything driving a browser programmatically.
 */

import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { checkDirectory } from "./stateRules.mjs";
import { runPlacementChecks } from "./placement.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const port = Number(process.env.PORT ?? 4599);
const outDir = mkdtempSync(join(tmpdir(), "sketch-tests-"));
const bundlePath = join(outDir, "tests.js");

/*
  The source rules run first, in Node, because they need no browser and catch a class the browser
  suites provably cannot — see `stateRules.mjs`. A violation fails the run outright rather than
  printing a note nobody reads.
*/
const violations = checkDirectory(join(root, "components", "sketch"));
if (violations.length > 0) {
  console.error("\n  Source rule failed: setState called inside a state updater\n");
  for (const v of violations) {
    console.error(`    ${v.path}:${v.line}  ${v.setter}() inside the updater passed to ${v.callee}()`);
  }
  console.error("\n  React runs an updater while rendering the component that OWNS that state, so this");
  console.error("  is a setState during another component's render. Decide before queueing the update.\n");
  process.exit(1);
}
console.log("  Source rules: ok (no setState inside a state updater)");

/*
  Placement is pure geometry, so it runs here in Node too rather than in the browser. A cabinet
  hanging out of the room is a bug about numbers, not about gestures — see placement.mjs.
*/
const placement = await runPlacementChecks();
if (placement.failures.length > 0) {
  console.error(`\n  Placement: ${placement.passed.length} passed, ${placement.failures.length} FAILED\n`);
  for (const failure of placement.failures) console.error(`    ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`  Placement: ok (${placement.passed.length} checks — cabinets stay inside their room)`);

await build({
  entryPoints: [join(here, "entry.tsx")],
  bundle: true,
  format: "iife",
  outfile: bundlePath,
  // The component is written for Next, which resolves "@/..." to the project root.
  alias: { "@": root },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "error",
});

const page = `<!doctype html><meta charset="utf-8"><title>Sketch gesture tests</title>
<style>
  body { margin: 0; font: 13px ui-monospace, monospace; }
  /* The stage must be at a known, unscrolled position: gestures convert world to client
     coordinates through its bounding box. */
  #stage { position: absolute; left: 0; top: 0; }
  #out { position: absolute; left: 720px; top: 8px; white-space: pre; }
  .pass { color: #0a7c2f; } .fail { color: #b00020; }
</style>
<div id="stage"></div><pre id="out">running…</pre>
<script>${readFileSync(bundlePath, "utf8")}</script>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(page);
});

server.listen(port, () => {
  console.log(`\n  Sketch gesture tests: http://localhost:${port}/\n  Open it in a browser. Ctrl-C to stop.\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    rmSync(outDir, { recursive: true, force: true });
    server.close(() => process.exit(0));
  });
}
