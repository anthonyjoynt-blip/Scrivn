/**
 * A source rule: never call a setState inside a state updater callback.
 *
 * ── Why this is static and not a runtime test ────────────────────────────────────────────────
 * This shipped once. `setNewReadingId` sat inside the updater handed to `onMoistureChange`, and an
 * updater does not run when it is handed over — React runs it later, while rendering the component
 * that OWNS that state. So it became a setState on the editor during the claim page's render, which
 * React reports as "Cannot update a component while rendering a different component".
 *
 * The obvious fix is a test that watches `console.error` for that warning. It does not work. React
 * eagerly evaluates an updater inside the event handler when the fiber has no other pending update,
 * so in a small harness the callback never runs during a render and the warning never fires — the
 * test passes with the bug present, which is worse than having no test. Reproducing it needs a
 * parent busy enough to defer the update, which is contriving the harness until it agrees.
 *
 * The rule itself is syntactic, so check it syntactically. No browser, no heuristics, no React
 * version to track: a setState inside an updater is wrong whether or not a given render happens to
 * expose it.
 *
 * Only names bound by `useState` in the same file count as a setState, which is what keeps pure
 * helpers like `setRoomMoisture` from being flagged.
 */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

/** Every `setX` bound by a `useState` destructure in this source. */
function stateSetters(source) {
  const names = new Set();
  const pattern = /const\s*\[\s*[\w$]+\s*,\s*([\w$]+)\s*\]\s*=\s*useState/g;
  let match;
  while ((match = pattern.exec(source)) !== null) names.add(match[1]);
  return names;
}

/** Spans of `(...)` that begin at an updater-shaped argument: `foo((prev) => ...)`. */
function updaterSpans(source) {
  const spans = [];
  const opener = /([\w$.]+)\(\s*\(?\s*([\w$]*)\s*\)?\s*=>/g;
  let match;
  while ((match = opener.exec(source)) !== null) {
    const callee = match[1];
    // Updaters are passed to setters and to change handlers that forward to one.
    if (!/^(set[A-Z]|on[A-Z]\w*Change$)/.test(callee) && !/\.(set[A-Z])/.test(callee)) continue;

    const open = source.indexOf("(", match.index + callee.length - 1);
    let depth = 0;
    let i = open;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    spans.push({ callee, start: open, end: i, argStart: match.index + match[0].length });
  }
  return spans;
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

export function checkFile(path) {
  const source = readFileSync(path, "utf8");
  const setters = stateSetters(source);
  if (setters.size === 0) return [];

  const violations = [];
  for (const span of updaterSpans(source)) {
    const body = source.slice(span.argStart, span.end);
    for (const setter of setters) {
      const call = new RegExp(`\\b${setter}\\s*\\(`, "g");
      let hit;
      while ((hit = call.exec(body)) !== null) {
        violations.push({
          path,
          line: lineOf(source, span.argStart + hit.index),
          setter,
          callee: span.callee,
        });
      }
    }
  }
  return violations;
}

export function checkDirectory(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (![".tsx", ".ts"].includes(extname(name))) continue;
    out.push(...checkFile(path));
  }
  return out;
}
