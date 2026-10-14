/**
 * The photo notes rule, proven against the real model (2026-10-14, stage 2). COSTS MONEY: two claims,
 * each read by the four extraction calls and written up by the documents call — about $0.25 in all.
 *
 *   SCRIVN_BASE_URL=http://localhost:3006 node test/photos/notesLive.mjs
 *
 * Needs a dev server with the dev fail-open (blank NEXT_PUBLIC_SUPABASE_* in .env.development.local,
 * as test/pipeline does) and ANTHROPIC_API_KEY in .env.local.
 *
 * The two cases the plan says must hold before release:
 *
 *   A. The same item said in the walkthrough AND under a photo is ONE item: one baseboard record in
 *      the bathroom, four feet of it, not two records and not eight feet.
 *   B. An item said ONLY under a photo is still scope: a kitchen that the walkthrough never mentions
 *      gets its laminate removal, from the caption alone.
 *
 * The gap-check is answered the way the pipeline harness answers it (test/pipeline/answers.mjs), so
 * the documents call sees a finished tree as the app would send it. The trace — notes sent, records
 * read, document lines — is written next to this file's output for reading, and the checks print.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { answerFor } from "../pipeline/answers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const BASE = process.env.SCRIVN_BASE_URL ?? "http://localhost:3006";
const OUT = process.env.SCRIVN_NOTES_OUT ?? join(tmpdir(), "photo-notes-live.md");

const dir = mkdtempSync(join(tmpdir(), "notes-live-"));
await build({
  stdin: {
    contents: `export { resolveRound } from "@/lib/questionRound";
export { photoNotes, photoNotesText, normalizeClaimPhotos } from "@/lib/photos";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(dir, "bundle.mjs"),
  alias: { "@": root },
  logLevel: "error",
});
const lib = await import(pathToFileURL(join(dir, "bundle.mjs")).href);
rmSync(dir, { recursive: true, force: true });

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json?.error ?? "no body"}`);
  return json;
}

const intake = (over) => ({
  customerName: "Photo notes test",
  jobNumber: "PN-0001",
  claimNumber: "",
  address: "",
  insurer: "Wawanesa",
  pmName: "",
  lossType: "WATER",
  lossTypeOther: "",
  waterCategory: 1,
  waterCategoryNote: null,
  waterClass: 2,
  dateOfLoss: null,
  yearOfBuilding: 2004,
  causeOfLoss: "",
  preExistingConditions: "",
  dateTimeInspected: "",
  scopeOnly: true,
  scopePhases: ["EMERGENCY", "REPAIR"],
  ...over,
});

const T = Date.UTC(2026, 9, 14, 16, 40);
const SKETCH = {
  rooms: [
    { id: "bath", name: "Main Bathroom" },
    { id: "kitchen", name: "Kitchen" },
  ],
};
const notesFor = (captions) =>
  lib.photoNotesText(
    lib.photoNotes(
      lib.normalizeClaimPhotos({
        items: captions.map(([room, caption], i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, room, roomName: "", takenAt: T + i * 120_000, caption, captionBy: "voice", width: 2000, height: 1500, source: "camera", editedAt: T })),
      }),
      SKETCH,
    ),
    (ms) => new Date(ms).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Edmonton" }),
  );

const CASES = [
  {
    name: "A. said in both places",
    claim: intake({ customerName: "Notes test A" }),
    transcript:
      "Supply line to the vanity in the main bathroom let go overnight. Main bathroom only. The baseboard behind the vanity is wet, " +
      "about four linear feet of it, MDF, it's coming off and getting replaced. Vinyl plank floor is dry, leaving it. " +
      "Drywall is fine. One air mover and one dehumidifier in the bathroom.",
    notes: notesFor([["bath", "Baseboard wet behind the vanity, about four feet, MDF, remove and replace."]]),
  },
  {
    name: "B. said only under a photo",
    claim: intake({ customerName: "Notes test B" }),
    transcript:
      "Supply line to the vanity in the main bathroom let go overnight. The baseboard behind the vanity is wet, about four linear feet, " +
      "MDF, coming off and getting replaced. One air mover and one dehumidifier in the bathroom.",
    notes: notesFor([
      ["bath", "Baseboard behind the vanity, the wet section."],
      ["kitchen", "Water ran under the wall into the kitchen. Laminate floor in front of the sink is cupped and wet, about forty square feet, remove and dispose."],
    ]),
  },
];

function answerAll(claim, extraction, name) {
  for (let round = 0; round < 8; round++) {
    const answers = {};
    let r = lib.resolveRound(claim, extraction, answers);
    if (r.questions.length === 0) return { claim, extraction };
    for (let pass = 0; pass < 24; pass++) {
      const open = r.questions.filter((q) => answers[q.id] === undefined);
      if (open.length === 0) break;
      for (const q of open) answers[q.id] = answerFor(q, name);
      r = lib.resolveRound(claim, extraction, answers);
    }
    claim = r.claim;
    extraction = r.extraction;
  }
  return { claim, extraction };
}

const norm = (s) => (s ?? "").toLowerCase();
const results = [];
const report = ["# Photo notes, proven on the model", "", `Run ${new Date().toISOString()} against ${BASE}.`, ""];
let usage = [];

for (const c of CASES) {
  const extracted = await post("/api/extract", { transcript: c.transcript, photoNotes: c.notes });
  usage.push(...(extracted.usage ?? []));
  const done = answerAll(c.claim, extracted.extraction, "photo-notes");
  const generated = await post("/api/generate", { claim: done.claim, extraction: done.extraction, transcript: c.transcript, photoNotes: c.notes });
  usage.push(...(generated.usage ?? []));
  const doc = generated.documents.scopeDocument;
  const rooms = extracted.extraction.rooms;
  const bath = rooms.filter((r) => /bath/i.test(r.roomName ?? ""));
  const kitchen = rooms.filter((r) => /kitchen/i.test(r.roomName ?? ""));
  const baseboardLines = doc.split("\n").filter((l) => /baseboard/i.test(l));

  if (c.name.startsWith("A")) {
    results.push(["A: one bathroom", bath.length === 1, rooms.map((r) => r.roomName).join(", ")]);
    results.push(["A: one baseboard record in it, not two", bath[0]?.baseboard.length === 1, `${bath[0]?.baseboard.length ?? 0} records`]);
    results.push(["A: no kitchen invented", kitchen.length === 0, rooms.map((r) => r.roomName).join(", ")]);
    /*
      The scope document names a baseboard by where it is ("behind the vanity"), not by its feet, so a
      doubled item shows as a second line: one removal and one replacement is the single item.
    */
    const removals = baseboardLines.filter((l) => /remove baseboard/i.test(l)).length;
    const replacements = baseboardLines.filter((l) => /replace baseboard/i.test(l)).length;
    results.push([
      "A: the document carries it once — one removal, one replacement, never eight feet",
      removals === 1 && replacements === 1 && !baseboardLines.some((l) => /\b8(\.0)?\s*(lf|linear|ft|feet)/i.test(l)),
      baseboardLines.join(" | "),
    ]);
  } else {
    const laminate = kitchen[0]?.flooring.find((f) => f.type === "LAMINATE");
    results.push(["B: the kitchen, named only under a photo, is in the scope", kitchen.length === 1, rooms.map((r) => r.roomName).join(", ")]);
    results.push(["B: with its laminate taken out", !!laminate && /REMOVE/.test(laminate.disposition ?? ""), JSON.stringify(laminate ?? null)]);
    results.push(["B: the document lists the kitchen laminate", doc.split("\n").some((l) => /laminate/i.test(l)) && /kitchen/i.test(doc), doc.split("\n").filter((l) => /laminate|kitchen/i.test(l)).join(" | ")]);
    results.push(["B: and still one bathroom baseboard record, though the bathroom photo names it too", bath[0]?.baseboard.length === 1, `${bath[0]?.baseboard.length ?? 0} records`]);
  }

  report.push(`## ${c.name}`, "", "Transcript:", "", `> ${c.transcript}`, "", "Photo notes sent:", "", "```", c.notes, "```", "");
  report.push("Rooms read:", "");
  for (const r of rooms) {
    report.push(`- ${r.roomName}: ${r.flooring.length} flooring (${r.flooring.map((f) => `${f.type} ${f.disposition}`).join(", ") || "none"}), ${r.baseboard.length} baseboard`);
  }
  report.push("", "Scope document:", "", "```", doc, "```", "");
}

// Opus 5.5 list prices (Anthropic's model table, 6 October 2026): $4/M input, $20/M output, cache reads a tenth, writes 1.25x.
const cost = usage.reduce((sum, u) => {
  const input = (u.inputTokens ?? 0) * 4;
  const output = (u.outputTokens ?? 0) * 20;
  const read = (u.cacheReadTokens ?? 0) * 0.4;
  const write = (u.cacheCreationTokens ?? 0) * 5;
  return sum + (input + output + read + write) / 1_000_000;
}, 0);

report.push("## Checks", "");
for (const [name, ok, detail] of results) report.push(`- ${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
report.push("", `Calls: ${usage.length}. Estimated cost: $${cost.toFixed(3)}.`);
writeFileSync(OUT, report.join("\n"));

for (const [name, ok, detail] of results) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n         ${detail}`}`);
console.log(`\n  ${usage.length} calls, about $${cost.toFixed(3)}. Trace: ${OUT}\n`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
