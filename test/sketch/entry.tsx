/**
 * Browser entry point for the sketch tests. Bundled by `run.mjs`; not imported by the app.
 *
 * A real file rather than a string built inside the runner: the suites are ordinary imports here,
 * so there are no escaped newlines or path separators to get wrong, and this typechecks with
 * everything else.
 */

import { run as runDragGestures } from "./dragGestures";
import { run as runEditorState } from "./editorState";
import { run as runScopePicker } from "./scopePicker";
import { run as runExportAndShortcuts } from "./exportAndShortcuts";
import { renderShowcase, run as runMoistureGestures } from "./moistureGestures";

interface SuiteResult {
  passed: number;
  failed: number;
  results: { ok: boolean; message: string }[];
}

declare global {
  interface Window {
    __sketchTests?: SuiteResult & { text: string };
  }
}

const SUITES: [string, () => Promise<SuiteResult>][] = [
  ["Sketch gestures", runDragGestures],
  ["Moisture mapping", runMoistureGestures],
  ["Editor state", runEditorState],
  ["Add from sketch", runScopePicker],
  ["Shortcuts and export", runExportAndShortcuts],
];

async function main() {
  const out = document.getElementById("out");
  if (!out) return;

  const lines: string[] = [];
  let passed = 0;
  let failed = 0;
  const results: { ok: boolean; message: string }[] = [];

  // Sequential, not parallel: each suite mounts its own canvas into the same stage container.
  for (const [name, run] of SUITES) {
    const suite = await run();
    lines.push(`── ${name} ──`);
    lines.push(...suite.results.map((r) => (r.ok ? "ok   " : "FAIL ") + r.message));
    lines.push("");
    passed += suite.passed;
    failed += suite.failed;
    results.push(...suite.results);
  }

  const text = lines.join("\n");
  window.__sketchTests = { passed, failed, results, text };
  out.textContent = `${text}\n${passed} passed, ${failed} failed`;
  out.className = failed ? "fail" : "pass";

  // Last, so the page is left showing a marked-up room to look at — see `renderShowcase`.
  await renderShowcase();
}

main().catch((error: unknown) => {
  const out = document.getElementById("out");
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  window.__sketchTests = { passed: 0, failed: 1, results: [{ ok: false, message }], text: message };
  if (out) {
    out.textContent = `threw: ${message}`;
    out.className = "fail";
  }
});
