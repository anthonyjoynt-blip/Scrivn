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
 * ── The three sources a line can come from ──────────────────────────────────────────────────────
 *
 * A scope line is supported by the DICTATION, by an ANSWER, or by nothing. The auditor is handed
 * the question log alongside the transcript for exactly that reason. The harness's stand-in PM
 * answers deterministically and without reading the dictation (see answers.mjs — that is its job,
 * so the engine's branches get exercised), which means a batch's documents are full of work no
 * transcript mentioned: a full run of solid wood baseboard, a floor register, a premium cabinet
 * grade. Its first run flagged all three of those on one claim, and every one traced to an answer.
 * Findings like that are about the harness, and an auditor that cannot tell them apart is an
 * auditor nobody reads.
 *
 * ── The four shapes it looks for ─────────────────────────────────────────────────────────────────
 *
 *   MISSING      — the PM said it, the scope does not have it. The silent drop.
 *   MISDESCRIBED — the scope has it as something materially different. WORSE than missing: a jamb
 *                  written up as a pre-hung door reads as complete and prices a strip of wood as a
 *                  whole unit, so nobody goes looking.
 *   UNSUPPORTED  — the scope has a line that neither the dictation nor an answer supports. The
 *                  other direction of the same fault, and the one that inflates an estimate.
 *   ASKED_ANYWAY — the app asked for something the PM had plainly already said. Not a document
 *                  error (a real PM answers and the document comes out right) but a drop on the
 *                  way in, which is the class of fault test/gapcheck/extractable.mjs exists to
 *                  prevent — and this is the one place it can be seen happening on real prose.
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
- "Disposal – {size} (est. … t; not weighed: …)" — computed by the app from the weight of every
  removal, on every claim with work, in each phase. The size, tonnage and "not weighed" note are all
  the app's; never report any of them.
- "Equipment pickup and monitoring" — a General item on every claim with work.
- "Final clean" — on every room with repair work.
- "Manipulate contents" / "Reset contents" — added from a room's contents size, not from words.
- "Extract water" — added when a room needs extraction, sometimes from a moisture map.
- Priming, painting and finishing lines — derived from what is being replaced, not dictated.
- "Furnace/hot water tank inspection", "Asbestos sample collection" — derived from the loss.
- A room heading of "Not stated" or "None" when the PM never named the room.
- "Detach sink – vanity" / "Reset sink – vanity" — on every bathroom vanity, whatever happens to
  the vanity itself. It is the plumbing disconnect and reconnect, which a new unit needs as much as
  a reset one; it says nothing about whether the old sink is reused, and the estimator settles
  that from the photos.
`.trim();

const SYSTEM = `You audit a water-damage restoration SCOPE DOCUMENT against what produced it. You are given
three things:

1. WHAT THE PM DICTATED — the walkthrough transcript. The only source of what the job actually is.
2. THE FOLLOW-UP QUESTIONS AND ANSWERS — after reading the dictation, the app asked about anything it
   could not settle, and the answers were folded into the document. IMPORTANT: in this test run the
   answers were given by an automated stand-in that answers plausibly but WITHOUT reading the
   dictation. So an answer can add work the PM never mentioned, and can even contradict the PM.
3. THE SCOPE DOCUMENT that came out.

A line in the document is supported by the dictation, by an answer, or by neither. Your one job is to
tell those apart. Report four kinds of finding, and nothing else:

MISSING — the PM described work and the scope has no line for it. Quote the PM. If the PM said it and
  a stand-in answer then contradicted it (the PM said the floor was extracted, the app asked "was water
  extraction required?", the stand-in said no), that is STILL a finding: the app should not have needed
  to ask. Report it as MISSING and say in "why" that the dictation was overridden by an answer.
MISDESCRIBED — the scope has a line for the PM's item, but as something materially different: a
  different item, a different action, or a bigger job than was described — AND the difference does not
  come from an answer. A cabinet the PM described with no grade, written up as premium because an
  answer said premium, is NOT misdescribed. A jamb the PM described, written up as a whole pre-hung
  door with no answer saying so, IS. This kind matters most: a document that is wrong in a way that
  reads as complete is one nobody re-checks.
UNSUPPORTED — the scope has a line that neither the dictation nor any answer supports. Before reporting
  one, look for the answer that produced it; work that traces to an answer is the stand-in's doing,
  not the app's, and is not a finding.
ASKED_ANYWAY — the app asked a question whose answer the PM had already plainly given in the
  dictation. Quote the PM and the question. Only when the dictation genuinely stated it — a PM who
  said "the carpet's coming out" did not state its square footage, and asking that is fine. NEVER
  for a question beginning "Not in the scope yet": those are deliberate — the app found work it had
  no field for and is asking the PM to confirm it and place it in a phase, which is the confirmation
  step, not a failure to listen.

RULES:
- Report WORK only. Not pleasantries, not the loss category, not the address, not the PM's name.
- These lines are added by the app itself and must NEVER be reported as UNSUPPORTED:
${AUTO_INCLUDED}
- A quantity the PM did not state is not a finding, and neither is the number an answer supplied for
  it.
- Wording does not have to match. "Pull the carpet" and "Remove carpet – 200 SF" are the same thing.
- An Emergency line whose Repair counterpart is absent (or the reverse) IS a finding — report it as
  MISSING and say which half is gone.
- If the document accounts for everything the PM said and adds nothing that is not from an answer,
  return an empty list. That is a real and common answer; do not manufacture a finding to seem useful.

Order findings by how much they would cost somebody: a misdescription that inflates a price first,
then a missing line, then an unsupported one, then anything asked anyway.`;

const SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["MISSING", "MISDESCRIBED", "UNSUPPORTED", "ASKED_ANYWAY"] },
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
 * The question log as the auditor reads it: one line per question, grouped by room, answers shown
 * exactly as the stand-in gave them. A question that was shown and then withdrawn in the same round
 * never reached the document and is left out — it can support nothing.
 */
export function answersForAudit(log) {
  const applied = (log ?? []).filter((e) => e.applied);
  if (applied.length === 0) return "(nothing was asked — the dictation settled everything)";
  const lines = [];
  let lastRoom;
  for (const e of applied) {
    const room = e.roomName ?? "Claim-level";
    if (room !== lastRoom) {
      lines.push(`${room}:`);
      lastRoom = room;
    }
    lines.push(`  Q: ${e.prompt}`);
    lines.push(`  A: ${e.answer === "" ? "(not answered)" : e.answer}`);
  }
  return lines.join("\n");
}

/**
 * Audits one claim. Returns `{ findings, usage }`, or throws — the caller decides whether an audit
 * failure should fail the run (it should not: the trace is still worth having).
 *
 * `questionLog` is the round-by-round record `recordRound` produces (lib/questionLog.ts). Without
 * it the auditor cannot tell an answer's work from an invention, and reports the stand-in's answers
 * as the app's mistakes.
 */
export async function auditScope({ transcript, scopeDocument, questionLog = [] }) {
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
        content: [
          `WHAT THE PM DICTATED:\n${transcript}`,
          `THE FOLLOW-UP QUESTIONS AND THE STAND-IN'S ANSWERS:\n${answersForAudit(questionLog)}`,
          `THE SCOPE DOCUMENT THAT WAS PRODUCED:\n${scopeDocument}`,
        ].join("\n\n"),
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
  if (findings.length === 0) return "  Nothing flagged — every line traces to the dictation or to an answer, and nothing dictated is missing.\n";

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
