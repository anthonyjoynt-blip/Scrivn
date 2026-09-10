/**
 * Reads the finished scope back against the dictation it was built from.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 *
 * The pipeline has a lossy step. Extraction maps free-form speech onto a fixed schema, and anything
 * with no field disappears — silently, with nothing in the output looking wrong. Batch 3 found eight
 * such items, and it found them because somebody hand-wrote transcripts aimed at suspected gaps and
 * then read six traces by eye. That does not scale and it does not catch what nobody suspected.
 *
 * So this asks a model to do the reading. It is deliberately a TEST tool: it calls the API directly
 * rather than through an app route, adds no production surface, and its output is a report for a
 * person rather than a pass/fail. Nothing here decides anything.
 *
 * ── The three shapes it looks for ────────────────────────────────────────────────────────────────
 *
 *   MISSING      — the PM said it, the scope does not have it. The silent drop.
 *   MISDESCRIBED — the scope has it as something materially different. WORSE than missing: a jamb
 *                  written up as a pre-hung door reads as complete and prices a strip of wood as a
 *                  whole unit, so nobody goes looking.
 *   UNSUPPORTED  — the scope has a line the dictation does not support. The other direction of the
 *                  same fault, and the one that inflates an estimate.
 *
 * ── What it is not ───────────────────────────────────────────────────────────────────────────────
 *
 * Not a judge of scope quality, and not a gate. A model reading for omissions produces false
 * positives, and in a report that costs a minute of reading; wired to a build it would cost trust.
 * Read it as a list of things to look at, in the order it thinks they matter.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The key, read straight out of `.env.local`.
 *
 * This runs outside Next, so nothing has loaded that file. Values are stripped of a leading U+FEFF
 * and of surrounding quotes for a specific reason: a byte-order mark inside a key in this project
 * once broke sign-in in production with an error that named a character index and nothing else. It
 * costs one line to be immune to it here.
 */
function envFromLocal(name) {
  if (process.env[name]) return process.env[name].replace(/^﻿/, "").trim();
  try {
    const file = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local"), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at === -1) continue;
      if (line.slice(0, at).replace(/^﻿/, "").trim() !== name) continue;
      return line.slice(at + 1).replace(/^﻿/, "").trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local — the caller gets a clear "no API key" failure below rather than a stack trace.
  }
  return "";
}

const MODEL = envFromLocal("ANTHROPIC_MODEL") || "claude-opus-5";

/**
 * Lines the app adds on its own, listed so they are not reported as unsupported on every claim.
 *
 * Kept here rather than derived from `documentGenerationPrompt.ts`: this is a description of the
 * app for a reader that has never seen it, and pointing it at the prompt would let the auditor
 * inherit the prompt's own blind spots — which is exactly what it is meant to find.
 */
const AUTO_INCLUDED = `
- "Disposal charge", "Equipment pickup and monitoring" — General items on every claim with work.
- "Final clean" — on every room with repair work.
- "Manipulate contents" / "Reset contents" — added from a room's contents size, not from words.
- "Extract water" — added when a room needs extraction, sometimes from a moisture map.
- Priming, painting and finishing lines — derived from what is being replaced, not dictated.
- "Furnace/hot water tank inspection", "Asbestos sample collection" — derived from the loss.
- A room heading of "Not stated" or "None" when the PM never named the room.
`.trim();

const SYSTEM = `You audit a water-damage restoration SCOPE DOCUMENT against the project manager's dictated
walkthrough that produced it. You are checking one thing: does the document account for the work the
PM described, and nothing else?

Report three kinds of finding, and nothing else:

MISSING — the PM described work and the scope has no line for it. Quote the PM.
MISDESCRIBED — the scope has a line for it, but as something materially different: a different item,
  a different action, or a bigger job than was described. Say what was said and what the scope made
  of it. This kind matters most. A document that is wrong in a way that reads as complete is one
  nobody re-checks, and it is how an estimate gets inflated.
UNSUPPORTED — the scope has a line the dictation does not support at all.

RULES:
- Report WORK only. Not pleasantries, not the loss category, not the address, not the PM's name.
- These lines are added by the app itself and must NEVER be reported as UNSUPPORTED:
${AUTO_INCLUDED}
- A quantity the PM did not state is not a finding. The app asks for those separately, and a line
  carrying no number is expected.
- Wording does not have to match. "Pull the carpet" and "Remove carpet – 200 SF" are the same thing.
- An Emergency line whose Repair counterpart is absent (or the reverse) IS a finding — report it as
  MISSING and say which half is gone.
- If the document accounts for everything, return an empty list. That is a real and common answer;
  do not manufacture a finding to seem useful.

Order findings by how much they would cost somebody: a misdescription that inflates a price first,
then a missing line, then a small omission.`;

const SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["MISSING", "MISDESCRIBED", "UNSUPPORTED"] },
          said: { type: "string" },
          scope: { type: "string" },
          why: { type: "string" },
        },
        required: ["kind", "said", "scope", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

/**
 * Audits one claim. Returns `{ findings, usage }`, or throws — the caller decides whether an audit
 * failure should fail the run (it should not: the trace is still worth having).
 */
export async function auditScope({ transcript, scopeDocument }) {
  const apiKey = envFromLocal("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("no ANTHROPIC_API_KEY in the environment or .env.local");
  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `WHAT THE PM DICTATED:\n${transcript}\n\nTHE SCOPE DOCUMENT THAT WAS PRODUCED:\n${scopeDocument}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  if (response.stop_reason === "refusal") throw new Error("the auditor declined this request");

  return {
    findings: response.parsed_output?.findings ?? [],
    usage: {
      call: "audit",
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

/** The audit section of a trace, or a line saying why there isn't one. */
export function auditSection(audit) {
  if (audit?.error) return `  (the audit could not run: ${audit.error})\n`;
  const findings = audit?.findings ?? [];
  if (findings.length === 0) return "  Nothing flagged — the document accounts for what was dictated.\n";

  const lines = [];
  for (const f of findings) {
    lines.push(`  ${f.kind}`);
    lines.push(`    said:  ${f.said}`);
    lines.push(`    scope: ${f.scope}`);
    lines.push(`    why:   ${f.why}`);
    lines.push("");
  }
  return lines.join("\n");
}
