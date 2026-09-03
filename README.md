# Scope Assistant (Phase 1 prototype)

Paste a water-loss damage transcript, answer a few follow-up questions, get back an inspection
report and a scope document. Next.js (App Router) for both the page and the API routes — no
separate backend, no database, no accounts. This is a proof of the end-to-end flow, not a
finished product; see **Explicitly not in Phase 1** below.

## Setup

**0. Install Node.js, if you haven't already.** This machine didn't have `node`/`npm` on PATH
when this project was scaffolded, so that's the one thing to check before anything else here will
run. Install Node 20 LTS or newer from [nodejs.org](https://nodejs.org) (or via `winget install
OpenJS.NodeJS.LTS` in PowerShell), then open a **new** terminal so PATH picks it up, and confirm:

```bash
node --version
```

**1. Install dependencies:**

```bash
npm install
```

**2. Add your API key:**

```bash
copy .env.local.example .env.local
```

Edit `.env.local` and set `ANTHROPIC_API_KEY` to a real key. `.env.local` is gitignored — it never
gets committed.

**3. Run it:**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Paste a transcript, click Generate.

A ready-made test transcript is included at [`sample-transcript.txt`](./sample-transcript.txt)
(copied from `transcript.txt` in the workspace root) — a category 3 basement loss across three
rooms, good for exercising flooring, baseboard, wall, and asbestos logic in one pass.

## The API key never reaches the browser

Both Claude calls happen in Next.js Route Handlers (`app/api/extract/route.ts`,
`app/api/generate/route.ts`) — server-side code that never ships to the client bundle.
`lib/anthropic.ts` additionally imports the `server-only` package specifically to make it a
**build error** if any client component ever tries to import it directly. The browser only ever
calls `/api/extract` and `/api/generate` on this same app; it never talks to `api.anthropic.com`.

## How the pipeline works

1. **Paste transcript** (`app/page.tsx`) — a textarea and a Generate button.
2. **Extraction** (`app/api/extract/route.ts`) — sends the transcript to Claude using Structured
   Outputs (a JSON Schema passed as `output_config.format`, not a "please return JSON" request) to
   get back a `WaterLossExtraction`: loss info + a list of rooms, each with flooring, baseboard,
   walls, doors, cabinetry, countertops, ceilings, equipment, and contents records.
3. **Gap-check** (`lib/gapCheck.ts`, `lib/claimInfo.ts`) — plain TypeScript, no API call. Compares
   the extracted tree against the required-fields rules and produces follow-up questions. This
   runs **iteratively**: some questions only make sense once an earlier one is answered (e.g. "are
   baseboards present?" before "what's being done to them?"), so the UI shows one batch, applies
   the answers, and re-runs gap-check for the next batch, until none remain.
4. **Answer questions** (`app/page.tsx`, `components/`) — shown grouped: **Claim Info** (customer
   name, job number, address, insurer, PM name, water class/category, cause of loss — see the note
   below), **Loss Details** (asbestos, HVAC), then one group per room, in the order rooms were
   mentioned in the transcript.
5. **Document generation** (`app/api/generate/route.ts`) — one Structured Outputs call sends the
   completed data to Claude and gets back `{ inspectionReport, scopeDocument }`, using the exact
   document templates below.
6. **Display results** — both documents rendered as plain formatted text.

## Where this logic came from

This isn't a from-scratch design — it's a direct port of the working pipeline in
`RestorationDocsAndroid` (the Kotlin/Android app in this same workspace), file-for-file:

| This project | Ported from (Android) |
|---|---|
| `lib/types.ts` | `model/waterloss/WaterLossExtraction.kt` |
| `lib/schema.ts` | `service/scoping/WaterLossJsonSchemas.kt` |
| `lib/extractionPrompt.ts` | `service/scoping/ExtractionPrompt.kt` |
| `lib/extractionWire.ts` | `service/scoping/ExtractionResponseWire.kt` |
| `lib/gapCheck.ts` | `service/scoping/GapCheckEngine.kt` |
| `lib/claimInfo.ts` | `service/scoping/ReportFieldsCheck.kt` + `ScopingClaimContext.kt` (adapted — see below) |
| `lib/documentGenerationPrompt.ts` | `service/scoping/DocumentGenerationPrompt.kt` |
| `lib/anthropic.ts` | `service/scoping/ClaudeScopingClient.kt` |

If the Android app's rules or prompts change, this port needs to be updated by hand to match —
there's no shared source of truth between the two codebases.

**One deliberate adaptation:** the Android app collects customer name, job number, address,
insurer, and PM name on a separate "New Claim" screen *before* scoping ever starts, so its gap-check
(`ReportFieldsCheck.kt`) never has to ask for them. This Phase 1 web app has no claim-creation step
(no accounts, no database — see below), so `lib/claimInfo.ts` folds those five fields into the same
follow-up-questions flow as everything else, under a "Claim Info" group. Flagging this because it's
an interpretation, not something the Android source dictated.

**Schema size note:** `lib/schema.ts` is *not* the full data model in `lib/types.ts` — it's
deliberately smaller. The Android team hit two separate Structured Outputs limits while building
this (a 16-union-type-field cap, worked around with sentinel values instead of nullable typing; and
then a "compiled grammar is too large" cap on total schema size, worked around by dropping several
whole categories — electrical panel, outlets/switches, toe kicks, wall tile, light fixtures,
plumbing fixtures, stairs — from what extraction currently sends/receives). The full types and
gap-check question logic for those categories are ported here too, dormant, ready to re-enable by
editing `lib/schema.ts` and `lib/extractionWire.ts` alone if headroom is ever freed up. See the
comments at the top of `lib/schema.ts` for the full history.

## Project structure

```
app/
  page.tsx              — the whole UI: paste → questions → results (client component)
  layout.tsx, globals.css
  api/
    extract/route.ts    — POST { transcript } -> { extraction }
    generate/route.ts   — POST { claim, extraction, transcript } -> { documents }
lib/
  types.ts               — WaterLossExtraction domain model
  schema.ts               — JSON Schemas for both Structured Outputs calls
  extractionPrompt.ts      — system + user prompt for step 2
  extractionWire.ts        — sentinel-valued wire shape <-> nullable domain model
  gapCheck.ts               — the rules engine (evaluate + applyAnswer)
  claimInfo.ts              — claim-identity + report-level fields and their questions
  documentGenerationPrompt.ts — system + user prompt for step 5
  anthropic.ts               — server-only Claude client + Structured Outputs helper
  questions.ts                — shared GapCheckQuestion/Kind/Result types
components/
  QuestionField.tsx  — renders one question by kind (yes/no, choice, text, number)
  QuestionGroup.tsx  — one labeled group ("Claim Info" / room name / etc.)
```

## Explicitly not in Phase 1

No login, no payment, no saved history between visits, no PDF generation, no letterhead, no
support for loss types beyond water. Also not ported from the Android app: revisions/re-dictation
(`ScopeRevisionEngine`/`ScopeRevisionPrompt`/`DeltaExtractionPrompt`), the on-demand work order
document (`WorkOrderPrompt`), and photo attachments — none of those are part of the single-pass
flow described for this prototype.
