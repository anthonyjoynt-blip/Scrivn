import { readFileSync } from "node:fs";

/**
 * Starting a new claim must leave nothing of the old one behind.
 *
 * Reported from the field: a sketch was deleted and a room from it kept appearing in gap-check, then
 * in the finished documents, as a real section with its own line items. Data that outlived the claim
 * it belonged to and reached something a PM would hand to a customer.
 *
 * There is no persistence anywhere in this app — no localStorage, no IndexedDB, no server-side draft.
 * Claim state lives only in the page's `useState` hooks. So the only mechanism by which deleted data
 * can come back is `reset()` forgetting one of them, which makes that function a single point of
 * failure that five separate values had already slipped past: the entire asbestos abatement form,
 * the sketch markings, which plans were attached to which document, the rendered sketch images, and
 * the open mark picker.
 *
 * Checked against the source rather than by exercising the component, because the failure is an
 * ABSENCE — a setter that was never called. No amount of driving the UI shows you the line that
 * isn't there, but a list of hooks compared against a list of setters does.
 */

const STATE = /const \[([a-zA-Z][a-zA-Z0-9]*), set([A-Za-z][a-zA-Z0-9]*)\] = useState/g;

/**
 * State that legitimately survives a reset, each with the reason.
 *
 * Deliberately tiny, and nothing claim-specific may ever go in it: the whole point of the rule is
 * that claim data does not outlive its claim. An entry here is a claim that the value describes the
 * SESSION or the USER, not the job being scoped.
 */
const SURVIVES_RESET = new Map([
  ["step", "reset() sets this explicitly to the intake step — it is the thing being navigated, not claim data"],
]);

export function checkResetClearsEveryState(pagePath) {
  const source = readFileSync(pagePath, "utf8");

  const declared = new Map();
  for (const match of source.matchAll(STATE)) declared.set(match[1], match[2]);

  const resetBody = source.match(/function reset\(\)\s*\{([\s\S]*?)\n  \}/);
  if (!resetBody) return ["could not find reset() in the page — the rule cannot check what it cannot read"];

  const cleared = new Set();
  for (const match of resetBody[1].matchAll(/set([A-Za-z][a-zA-Z0-9]*)\s*\(/g)) cleared.add(match[1]);

  const missed = [];
  for (const [name, setter] of declared) {
    if (cleared.has(setter) || SURVIVES_RESET.has(name)) continue;
    missed.push(`${name} (reset() never calls set${setter})`);
  }
  return missed;
}
