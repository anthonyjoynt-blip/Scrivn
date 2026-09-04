/**
 * The whole dictation-to-documents path, end to end, with nobody answering the questions.
 *
 *   npm run test:pipeline                 the whole batch
 *   npm run test:pipeline -- 02 05        only transcripts whose name contains "02" or "05"
 *
 * REQUIREMENTS
 *   1. The dev server must be running on :3000 (`npm run dev`), because extraction and generation
 *      are real API calls — that is the point. A mocked model would test the plumbing and none of
 *      the behaviour anybody actually reports bugs about.
 *   2. Those two routes sit behind auth. In development, blanking NEXT_PUBLIC_SUPABASE_URL and
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY in `.env.development.local` takes middleware's dev fail-open;
 *      delete that file when you are done. The script says so if it gets a 401.
 *
 * This produces NO pass/fail. It cannot: whether a scope document is right is a judgement about
 * restoration work, and a script that scored itself would only ever check the things somebody
 * already thought to encode. What it produces is a trace per claim — transcript, extraction, every
 * question and answer in order, and the finished documents — laid out so the documents can be read
 * against the transcript by eye. Reviewing is the deliverable; running is just what makes it cheap.
 *
 * Deliberately out of scope: sketches, moisture mapping, and the quantities derived from them. Those
 * need drawing this cannot do, so every quantity here is either stated in the transcript or asked
 * for. A sketch-derived pre-fill is therefore never exercised — worth remembering when a report
 * looks clean.
 */

import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TRANSCRIPTS } from "./transcripts.mjs";
import { answerFor } from "./answers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const reportDir = join(here, "reports");
const BASE = process.env.SCRIVN_BASE_URL ?? "http://localhost:3000";

const buildDir = mkdtempSync(join(tmpdir(), "pipeline-"));
const bundlePath = join(buildDir, "bundle.mjs");
await build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root },
  logLevel: "error",
});
const { resolveRound, recordRound } = await import(pathToFileURL(bundlePath).href);

/* ── The two real calls ─────────────────────────────────────────────────────────────────────────── */

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new Error(`could not reach ${BASE}${path} — is the dev server running? (${cause.message})`);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned ${res.status} with a non-JSON body: ${text.slice(0, 200)}`);
  }
  if (!res.ok || json.error) {
    const hint =
      res.status === 401 || res.status === 403
        ? " — blank the two NEXT_PUBLIC_SUPABASE_* values in .env.development.local to take the dev fail-open, and delete the file afterwards"
        : "";
    throw new Error(`${path} returned ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}${hint}`);
  }
  return json;
}

/* ── One claim, all the way through ─────────────────────────────────────────────────────────────── */

/** How many commit rounds before giving up — a real claim finishes in one or two. */
const MAX_ROUNDS = 12;

async function runOne(entry) {
  const started = Date.now();
  const usage = [];
  const extractResponse = await post("/api/extract", { transcript: entry.transcript });
  const extracted = extractResponse.extraction;
  usage.push(...(extractResponse.usage ?? []));

  let claim = entry.claim;
  let extraction = extracted;
  const log = [];
  let rounds = 0;
  let stalled = null;

  /*
    Mirrors the claim page exactly: answer everything open, let `resolveRound` fold it in and reveal
    whatever that unlocks, and only then commit. Answering against the real engine rather than a
    replica of it is what makes this worth running — a copy of the question flow would agree with
    itself and disagree with the app.
  */
  for (rounds = 1; rounds <= MAX_ROUNDS; rounds += 1) {
    const answers = {};
    let round = resolveRound(claim, extraction, answers);
    if (round.questions.length === 0) break;

    // Inner loop: answering can reveal more, so keep going until nothing is open.
    for (let pass = 0; pass < 24; pass += 1) {
      const open = round.questions.filter((q) => answers[q.id] === undefined);
      if (open.length === 0) break;
      for (const q of open) answers[q.id] = answerFor(q, entry.name);
      round = resolveRound(claim, extraction, answers);
    }

    log.push(...recordRound(rounds, round.display, round.applied, answers));

    if (round.questions.length > 0) {
      // Something is open that answering cannot close. Recording it beats looping in silence.
      stalled = round.questions.map((q) => `${q.roomName ?? "claim-level"} — ${q.prompt}`);
      break;
    }
    claim = round.claim;
    extraction = round.extraction;
  }

  const generateResponse = await post("/api/generate", { claim, extraction, transcript: entry.transcript });
  usage.push(...(generateResponse.usage ?? []));

  return {
    usage,
    entry,
    extraction,
    rawExtraction: extracted,
    log,
    // Rounds that actually asked something — the loop counter includes the pass that found nothing
    // left, which is not a round anybody sat through.
    rounds: log.length === 0 ? 0 : Math.max(...log.map((e) => e.round)),
    stalled,
    documents: generateResponse.documents ?? generateResponse,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

/* ── The report ─────────────────────────────────────────────────────────────────────────────────── */

function rule(title) {
  return `\n${"═".repeat(96)}\n${title}\n${"═".repeat(96)}\n`;
}

function questionSection(log) {
  if (log.length === 0) return "  (nothing was asked — the transcript covered everything)\n";
  const lines = [];
  let lastRoom;
  let lastRound;
  for (const e of log) {
    if (e.round !== lastRound) {
      lines.push(`\n  ── Round ${e.round} ──`);
      lastRound = e.round;
      lastRoom = undefined;
    }
    const room = e.roomName ?? "Claim-level";
    if (room !== lastRoom) {
      lines.push(`\n  ${room}`);
      lastRoom = room;
    }
    lines.push(`    Q: ${e.prompt}`);
    lines.push(`    A: ${e.answer === "" ? "(not answered)" : e.answer}${e.applied ? "" : "   [not applied]"}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The tree as a scannable outline. The raw JSON follows it; this is what gets read. */
function extractionSummary(extraction) {
  const lines = [];
  const loss = extraction.loss ?? {};
  lines.push(`  Loss: category ${loss.category ?? "—"}, class ${loss.lossClass ?? "—"}${loss.isBasementLoss ? ", basement" : ""}`);
  if (loss.source) lines.push(`  Source: ${loss.source}`);
  for (const room of extraction.rooms ?? []) {
    lines.push(`\n  ${room.roomName}`);
    for (const f of room.flooring ?? []) {
      // A record with no material and no disposition is a real state — "flooring's coming up" and
      // nothing else — so it says so rather than rendering as a blank line that reads like a bug here.
      const bits = [
        f.type ?? "material not stated",
        f.disposition ?? "disposition not stated",
        f.removalSF !== null ? `${f.removalSF} SF` : null,
        f.cleaningRequired ? "cleaned" : null,
      ];
      lines.push(`    flooring    ${bits.filter(Boolean).join(" / ")}`);
    }
    for (const b of room.baseboard ?? []) {
      // An all-null record is a real state — extraction knows there IS baseboard and nothing else —
      // and rendering it as a blank line reads as a bug in this report rather than a gap in the data.
      const detail = [b.material, b.action, b.heightIn ? `${b.heightIn}"` : null].filter(Boolean).join(" / ");
      lines.push(`    baseboard   ${detail || "(present, no detail stated)"}`);
    }
    for (const w of room.walls ?? []) if (w.drywallBeingRemoved) lines.push(`    wall        drywall out / ${w.cutHeight ?? "height not stated"}${w.insulationAffected ? " / insulation affected" : ""}`);
    for (const c of room.ceilings ?? []) lines.push(`    ceiling     ${[c.type, c.action, c.finish, c.textureStyle].filter(Boolean).join(" / ")}`);
    for (const d of room.doors ?? []) lines.push(`    door        ${[d.location, d.action].filter(Boolean).join(" / ")}`);
    for (const c of room.cabinetry ?? []) lines.push(`    cabinetry   ${[c.location, c.action, c.extent].filter(Boolean).join(" / ")}`);
    for (const p of room.plumbingFixtures ?? []) lines.push(`    plumbing    ${[p.fixtureType, p.action].filter(Boolean).join(" / ")}`);
    for (const e of room.equipment ?? []) lines.push(`    equipment   ${e.type} × ${e.quantity ?? "not stated"}`);
    for (const a of room.appliances ?? []) lines.push(`    appliance   ${a.type}`);
    const flags = [
      room.antimicrobialApplied ? "antimicrobial" : null,
      room.hepaVacuumingRequired ? "HEPA vacuuming" : null,
      room.containmentRequired ? `containment${room.containmentSF ? ` ${room.containmentSF} SF` : ""}` : null,
      room.waterExtractionRequired ? "water extraction" : null,
      room.contents ? `contents ${room.contents.size ?? "size not stated"}` : null,
    ].filter(Boolean);
    if (flags.length) lines.push(`    room        ${flags.join(", ")}`);
    /*
      A room the transcript described but that carries no surface work at all.

      Called out because it is the shape of a whole class of bug and it is nearly invisible on
      review: the finished scope simply has fewer lines than it should, and nothing about the
      document looks wrong. The first run of this batch found one — "flooring's coming up in all
      three" produced no flooring record in any of the three, because a flooring record cannot exist
      without a type and the PM never named one, so the biggest line item on the claim vanished.
    */
    const surfaces =
      (room.flooring?.length ?? 0) + (room.baseboard?.length ?? 0) + (room.walls?.length ?? 0) +
      (room.ceilings?.length ?? 0) + (room.doors?.length ?? 0) + (room.cabinetry?.length ?? 0) +
      (room.countertops?.length ?? 0) + (room.plumbingFixtures?.length ?? 0);
    if (surfaces === 0) lines.push("    !! no surface work recorded — check the transcript for work that was dropped");
    if ((room.flooring?.length ?? 0) === 0 && surfaces > 0) {
      lines.push("    !! no flooring record — check whether the transcript described flooring work");
    }
  }
  return `${lines.join("\n")}\n`;
}

/*
  Rates are supplied, never assumed.

  Token counts are a fact this script measures; a price per million is not, it changes without this
  code changing, and a made-up figure would be worse than none — somebody would budget against it.
  So set SCRIVN_PRICE_IN and SCRIVN_PRICE_OUT (dollars per million tokens, from the Anthropic
  console) and the dollar columns appear. Without them the report shows tokens alone, which is still
  the number that matters when comparing one claim against another.
*/
const PRICE_IN = Number.parseFloat(process.env.SCRIVN_PRICE_IN ?? "");
const PRICE_OUT = Number.parseFloat(process.env.SCRIVN_PRICE_OUT ?? "");
const HAS_PRICES = Number.isFinite(PRICE_IN) && Number.isFinite(PRICE_OUT);

function usageSection(usage) {
  const lines = [];
  lines.push(`  ${"call".padEnd(20)}${"input".padStart(9)}${"output".padStart(9)}${"cache wr".padStart(10)}${"cache rd".padStart(10)}`);
  for (const u of usage) {
    lines.push(
      `  ${u.call.padEnd(20)}${String(u.inputTokens).padStart(9)}${String(u.outputTokens).padStart(9)}${String(u.cacheCreationTokens).padStart(10)}${String(u.cacheReadTokens).padStart(10)}`,
    );
  }
  const total = usage.reduce(
    (a, u) => ({
      inputTokens: a.inputTokens + u.inputTokens,
      outputTokens: a.outputTokens + u.outputTokens,
      cacheCreationTokens: a.cacheCreationTokens + u.cacheCreationTokens,
      cacheReadTokens: a.cacheReadTokens + u.cacheReadTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  );
  lines.push(`  ${"".padEnd(20)}${"—".padStart(9)}${"—".padStart(9)}${"—".padStart(10)}${"—".padStart(10)}`);
  lines.push(
    `  ${"TOTAL".padEnd(20)}${String(total.inputTokens).padStart(9)}${String(total.outputTokens).padStart(9)}${String(total.cacheCreationTokens).padStart(10)}${String(total.cacheReadTokens).padStart(10)}`,
  );
  /*
    One number that folds the cache multipliers in: what this claim would have cost in ORDINARY input
    tokens. A write is billed at 1.25x a plain input token and a read at 0.1x, so a claim reading a
    31k-token cache is paying for about 3.1k. Without this line the raw columns look alarming and
    are mostly a cache read costing a tenth of what it appears to.

    The multipliers are Anthropic's published ratios and are stable; the base rate per million is the
    part that moves, which is why it comes from you rather than from here.
  */
  const effectiveInput = Math.round(total.inputTokens + total.cacheCreationTokens * 1.25 + total.cacheReadTokens * 0.1);
  lines.push("");
  lines.push(`  Effective input: ${effectiveInput.toLocaleString()} tokens (cache write 1.25x, read 0.1x) + ${total.outputTokens.toLocaleString()} output`);

  if (HAS_PRICES) {
    /*
      Priced with the standard cache multipliers: a write costs 1.25x a plain input token and a read
      0.1x. Those multipliers are Anthropic's published ratios and are stable; the base rate is the
      part that moves, which is why it comes from you rather than from here.
    */
    const cost = (effectiveInput / 1e6) * PRICE_IN + (total.outputTokens / 1e6) * PRICE_OUT;
    lines.push(`  Cost at $${PRICE_IN} in / $${PRICE_OUT} out per Mtok: $${cost.toFixed(4)}`);
  }
  if (!HAS_PRICES) {
    lines.push("");
    lines.push("  (set SCRIVN_PRICE_IN and SCRIVN_PRICE_OUT — dollars per million tokens — for a cost column)");
  }
  if (total.cacheReadTokens === 0 && total.cacheCreationTokens === 0) {
    lines.push("");
    lines.push("  Prompt caching is off for this run (SCRIVN_PROMPT_CACHE=off), so the system prompts");
    lines.push("  were paid for in full — see lib/anthropic.ts for when that is the cheaper choice.");
  } else if (total.cacheReadTokens === 0) {
    lines.push("");
    lines.push("  Cache written but nothing read back: this claim paid the write premium and no claim");
    lines.push("  reused it. That is the cold case — caching only pays when calls are close together.");
  }
  return `${lines.join("\n")}\n`;
}

function report(result) {
  const { entry, log, documents, rawExtraction, extraction, stalled } = result;
  const parts = [];
  parts.push(`SCRIVN PIPELINE TRACE — ${entry.name}`);
  parts.push(`${entry.claim.customerName} · ${entry.claim.jobNumber} · ${entry.claim.insurer} · ${entry.claim.lossType}`);
  parts.push(`Questions asked: ${log.length}   ·   Rounds: ${result.rounds}   ·   ${result.seconds}s`);
  parts.push(`\nWhy this claim is in the batch:\n  ${entry.note}`);

  parts.push(rule("1. TRANSCRIPT — everything below has to be traceable to this"));
  parts.push(entry.transcript.replace(/(.{1,94})(\s|$)/g, "$1\n"));

  parts.push(rule("2. WHAT THIS CLAIM COST"));
  parts.push(usageSection(result.usage));

  parts.push(rule("3. WHAT EXTRACTION UNDERSTOOD"));
  parts.push(extractionSummary(rawExtraction));

  parts.push(rule("4. WHAT GAP-CHECK ASKED, AND WHAT THE STAND-IN PM ANSWERED"));
  parts.push(questionSection(log));
  if (stalled) {
    parts.push(`\n  !! STILL OPEN AFTER ANSWERING — the flow could not be completed:\n${stalled.map((s) => `     - ${s}`).join("\n")}\n`);
  }

  parts.push(rule("5. SCOPE DOCUMENT"));
  parts.push(documents.scopeDocument ?? "(none returned)");

  if (documents.inspectionReport) {
    parts.push(rule("6. INSPECTION REPORT"));
    parts.push(documents.inspectionReport);
  }

  parts.push(rule("7. FINAL EXTRACTION TREE (raw, for when a line above looks wrong)"));
  parts.push(JSON.stringify(extraction, null, 1));

  return parts.join("\n");
}

/* ── Run the batch ──────────────────────────────────────────────────────────────────────────────── */

const filters = process.argv.slice(2);
const batch = filters.length === 0 ? TRANSCRIPTS : TRANSCRIPTS.filter((t) => filters.some((f) => t.name.includes(f)));

if (batch.length === 0) {
  console.error(`No transcripts match ${filters.join(", ")}. Available:\n  ${TRANSCRIPTS.map((t) => t.name).join("\n  ")}`);
  process.exit(1);
}

rmSync(reportDir, { recursive: true, force: true });
mkdirSync(reportDir, { recursive: true });

console.log(`\n  Running ${batch.length} transcript${batch.length === 1 ? "" : "s"} against ${BASE}\n`);

const summary = [];
for (const entry of batch) {
  process.stdout.write(`  ${entry.name.padEnd(30)}`);
  try {
    const result = await runOne(entry);
    writeFileSync(join(reportDir, `${entry.name}.txt`), report(result), "utf8");
    const flag = result.stalled ? "  !! STILL OPEN" : "";
    console.log(`${String(result.log.length).padStart(3)} questions  ${String(result.seconds).padStart(5)}s${flag}`);
    summary.push({ name: entry.name, questions: result.log.length, seconds: result.seconds, stalled: result.stalled, note: entry.note });
  } catch (error) {
    console.log(`FAILED — ${error.message}`);
    writeFileSync(join(reportDir, `${entry.name}.FAILED.txt`), `${entry.name}\n\n${error.stack ?? error.message}\n`, "utf8");
    summary.push({ name: entry.name, error: error.message });
  }
}

const index = [
  "SCRIVN PIPELINE BATCH",
  `Run against ${BASE}`,
  "",
  "Read each trace against its own transcript. Nothing here judges correctness — that is the review.",
  "",
  ...summary.map((s) =>
    s.error
      ? `  ${s.name.padEnd(30)} FAILED — ${s.error}`
      : `  ${s.name.padEnd(30)} ${String(s.questions).padStart(3)} questions  ${String(s.seconds).padStart(5)}s${s.stalled ? "  !! STILL OPEN" : ""}\n${" ".repeat(34)}${s.note}`,
  ),
  "",
].join("\n");
writeFileSync(join(reportDir, "000-index.txt"), index, "utf8");

rmSync(buildDir, { recursive: true, force: true });
console.log(`\n  Reports written to test/pipeline/reports/\n`);
if (summary.some((s) => s.error)) process.exit(1);
