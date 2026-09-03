# Scrivn / Scope Assistant — Project State

This is a ground-truth snapshot of what's actually implemented in `ScopeAssistantWeb` as of 2026-08-28, written by re-reading the current source rather than from memory of how it was planned. Anything not mentioned here doesn't exist in the code. The on-screen product name is "Scrivn"; the main page's own `<h1>` still literally reads "Scope Assistant" — kept intentionally, not an inconsistency to fix.

---

## 1. Data schema

A claim's data lives in several separate, unconnected state objects (all just `useState` in `app/page.tsx` — see §6). There is no single "Claim" object; `ClaimInfo` plus a `WaterLossExtraction` plus (conditionally) one of the contents models plus (conditionally) a DGIG model together make up what the app calls a claim.

### `ClaimInfo` (`lib/claimInfo.ts`)

Collected entirely at intake (step 1), never gap-checked.

| Field | Type | Notes |
|---|---|---|
| `customerName`, `jobNumber`, `insurer`, `pmName` | `string` | Required (insurer is a free-text `<input list>` combobox — see §7) |
| `claimNumber` | `string` | Optional |
| `address` | `string` | Required unless reduced intake |
| `lossType` | `"WATER" \| "FIRE" \| "WIND" \| "HAIL" \| "REMEDIATION" \| null` | Required. Only `WATER` has any downstream effect — see §7 |
| `waterCategory` | `number \| null` | IICRC 1–3. Required only when `lossType === "WATER"`; otherwise never collected, renders as omitted (not "N/A") in documents |
| `waterClass` | `number \| null` | IICRC 1–4. Same conditionality as category |
| `dateOfLoss` | `string \| null` | ISO `yyyy-MM-dd`, native `<input type="date">` |
| `yearOfBuilding` | `number \| null` | Also copied onto `WaterLossExtraction.loss.yearOfBuilding` after extraction (drives asbestos) |
| `causeOfLoss`, `preExistingConditions` | `string` | Required unless reduced intake |
| `dateTimeInspected` | `string` | Optional, native `<input type="datetime-local">` |
| `scopeOnly` | `boolean` | Skips the inspection report entirely; trims intake to the reduced field set |
| `scopePhases` | `("EMERGENCY" \| "REPAIR" \| "CONTENTS")[]` | Independent multi-select, any non-empty combination — see §7 for how this replaced an earlier 5-value enum |

`pmPhone`/`pmEmail` are not modeled at all (always render blank in Job Information) — explicitly deferred pending real accounts.

### `WaterLossExtraction` (`lib/types.ts`) — `{ loss: Loss, rooms: Room[] }`

This is the full TypeScript domain model, ported from an Android app's Kotlin model. **Important**: the model is bigger than what the extraction API can actually populate — `lib/schema.ts`'s hand-authored JSON Schema was trimmed twice after hitting Anthropic Structured Outputs size limits, so several categories below exist as real types with full gap-check logic but are **dormant** (extraction's schema has no slot for them, so they're never populated, same as if a transcript never mentioned them). Each table row is marked.

**`Loss`**: `category` (1-3), `lossClass` (1-4), `source`, `dateOfLoss`, `yearOfBuilding`, `asbestosTestingRequired` (derived: `yearOfBuilding <= 1990`, never extracted), `asbestosSamplesTaken`, `asbestosSampleCount`, `isBasementLoss` (always extracted directly), `hvacInspectionRequired`. All live in the schema.

**`Room`** (top-level per-room container): `roomName`, then arrays/fields for every category below, plus:
- `floorRegistersDetached: number | null` — extracted (only meaningful when flooring in the room is REMOVE_AND_DISPOSE'd)
- `equipment: EquipmentRecord[]` — extracted, `{ type: string, quantity: number | null }`, extraction prompt restricts `type` to exactly `"air movers"` or `"dehumidifiers"`
- `waterExtractionRequired: boolean | null`, `waterExtractionSF: number | null`, `waterExtractionFraction: AreaFraction | null` — **gap-check-only**, added this round, never extracted
- `contents: ContentsManipulation | null` — extracted (see below)
- `baseboardPresenceConfirmed`, `baseboardConfirmedAbsent`, `equipmentAsked` — pure gap-check bookkeeping booleans, never read anywhere else
- `ceilingLightFixturesPresent`, `ceilingLightFixtureType`, `otherCeilingFixtures` — gap-check-only, triggered by ceiling drywall work

Per-category records, **live** (extraction populates these):
| Category | Type | Key fields |
|---|---|---|
| Flooring | `FlooringRecord[]` | `type` (CARPET/VINYL/HARDWOOD/LAMINATE/TILE/CONCRETE), `vinylSubtype`, `hardwoodConstruction`/`Installation`, `disposition` (DRY_IN_PLACE/LIFT_AND_REINSTALL/REMOVE_AND_DISPOSE/REMOVE_AND_ASSESS), `phase`, `phaseUncertain`, `padPresent`/`padRemoved` (+ SF/fraction pairs, gap-check only) |
| Baseboard | `BaseboardRecord[]` | `material` (SOLID_WOOD/MDF/VINYL_PVC_COMPOSITE), `mdfProfile` (FLAT/PROFILE, gap-check only), `action` (DETACH_AND_RESET/REMOVE_AND_REPLACE/SHOE_MOLD_ONLY), `disposition`, `phase`, `heightIn` (gap-check only) |
| Walls | `WallRecord[]` | `wallMaterial`, `drywallBeingRemoved`, `insulationAffected` — all extracted. `insulationType`, `floodCutHeightIn`, `cutHeight`, `cutRunFt`/`cutRunFraction` are **gap-check only** (a round-12 attempt to extract `cutHeight` directly broke extraction outright — see §7) |
| Doors | `DoorRecord[]` | `location`, `action` extracted; `slabOnly`/`doorType`/`unitType`/`saveHardware` gap-check only |
| Cabinetry | `CabinetryRecord[]` | `location`, `action` extracted; `extent`/`grade` gap-check only |
| Countertops | `CountertopRecord[]` | `action` extracted; `material` gap-check only |
| Ceilings | `CeilingRecord[]` | `type` (DRYWALL_PLASTER/SUSPENDED_TILE), `action`, `finish`, `replaceSF` extracted; `textureStyle`, `spaceAboveHasInsulation`/`aboveInsulationAffected`, `detachScope`, `tileSize`, `mountMethod`, `replaceFraction` gap-check only |
| Plumbing fixtures | `PlumbingFixtureRecord[]` | **Narrowed on purpose**: only `fixtureType` BATHROOM_VANITY or TOILET are extractable (kitchen sink, standalone bathroom sink, tub/shower stay in the type but are dormant). `action`, `topDetached`/`topKept`/`topMaterial` gap-check only |

Per-category records, **dormant** (typed and gap-checked in code, but extraction's schema has no property for them at all — never populated regardless of transcript content): `ElectricalOutletRecord` (outlets/switches), `LightFixtureRecord`, `ElectricalPanelRecord`, `ToeKickRecord`, `WallTileRecord`, `StairRecord`, and `PlumbingFixtureRecord` variants for KITCHEN_SINK/BATHROOM_SINK/TUB_SHOWER.

**`ContentsManipulation`** (`Room.contents`): `size` (SMALL/MEDIUM/LARGE/EXTRA_LARGE, gap-checked), `manipulationDeclined` (extracted), `affected` (extracted, flag only, no rendering behavior).

**`AreaFraction`** = `"QUARTER" | "HALF" | "THREE_QUARTERS" | "FULL"` — the qualitative alternative used everywhere a real quantity is gap-checked (carpet lift, pad removal, wall cut run, ceiling replacement SF, water extraction SF): exactly one of a `...SF`/`...Ft` numeric field or its `...Fraction` sibling is ever set.

### Contents models (independent of `WaterLossExtraction`, no gap-check, no Claude call)

- **`ContentsTM`** (`lib/contentsTM.ts`) — Time & Material approach: `onSiteManipulationHours`, `packOutHours`, `packBackHours`, `consumables` (17-item fixed list: box sizes, wardrobe boxes, mattress bags ×4 sizes, garbage/laundry bags, bubble wrap, 2 shrink-wrap sizes, poly), `truckChargeCount`, `disposalType` (5-option enum: pickup/dump trailer/3 dumpster sizes), `otherAdditions`.
- **`BricABracData`** (`lib/bricABrac.ts`) — per-room approach: `rooms: BricABracRoom[]` (`roomName`, `contentSize`, `unboxableItems` free-text list, `boxes` keyed by the box-type subset of the same consumables list, `otherConsumables`, `movingBlankets`), plus claim-level `cleaning: ContentCleaning`, `nonRestorableCount`, `truckChargeCount`, `disposalType`.
- **`ContentCleaning`** (`lib/contentCleaning.ts`) — `isCleaningContent`, `isCleaningBoxes`, `boxEntries: BoxCleaningEntry[]` (`family` MISC/BRIC_A_BRAC, `size` S/M/L/XL, `count`, `intensity` STANDARD/LIGHT/HEAVY, `density` STANDARD/LOW/HIGH), `individualItemsText` (free list, pre-filled from bric-a-brac rooms' unboxable items). **No Xactimate code anywhere** — see §7.

### DGIG model (insurer-specific, independent of everything else)

**`DGIGData`** (`lib/dgig.ts`) — only used when the insurer field matches DGIG/Desjardins: `pmInspectionHours`, `travelHours`, `equipmentMonitoringHours`, `disposalType` (same 5-option enum as contents), `rooms: DGIGRoom[]` — each room: `roomName`, `tearOutHours`, `tearOutDescription` (free text — doubles as the synthetic transcript sent to extraction, see §7), `contentManipulationHours`, `waterExtractionHours`, `cleaningHours`, `dryingClass` (1–4, with fixed descriptions), `antimicrobial` (bool), `antimicrobialSF`/`antimicrobialExtent` (FULL_FLOOR/PARTIAL_FLOOR, mutually exclusive with the SF number), `otherNotes` (verbatim catch-all).

---

## 2. Gap-check rules (`lib/gapCheck.ts`)

Pure deterministic TypeScript, zero API calls. `evaluate(extraction)` walks the whole tree and returns every currently-unanswered question; `applyAnswer(extraction, id, answer)` mutates a copy; the UI loops evaluate → answer → evaluate until `isComplete`. A question can be filtered out one layer up in `app/page.tsx`'s `nextQuestions()` based on claim context (phase selection, insurer, loss type) — `evaluate()` itself has no awareness of any of that.

**Always asked once per claim** (claim-level, `roomName: null`):
- Asbestos samples taken? (only if `asbestosTestingRequired` AND any removal work exists anywhere) → if yes, how many?
- Furnace/hot water tank inspection required? (only if `isBasementLoss`)

**Asked once per room, unconditionally when relevant** (fires the moment a room exists with the triggering condition, not repeatable once answered):
- What room does this work belong to? — only if `roomName === "Unnamed Room"` (the extraction-side placeholder for work with no room ever named)
- Are baseboards present? → detached-only / removed-and-replaced / shoe-mold-only? — only when the room has REMOVE_AND_DISPOSE'd or REMOVE_AND_ASSESS'd flooring and no baseboard record exists yet
- How many floor registers need to be detached/reset? — only when the room has REMOVE_AND_DISPOSE'd/REMOVE_AND_ASSESS'd flooring
- Was drying equipment used in this room? — only when the room has any work at all AND zero equipment records exist yet (filtered out entirely for non-WATER claims)
- Was water extraction required in this room? → how much? — only when the room has work AND no LIFT_AND_REINSTALL carpet record already implies it (filtered out for non-WATER claims)
- What size are the contents in this room? — only when the room has work and manipulation wasn't declined (filtered out whenever Contents is selected as its own phase, or the insurer is DGIG, since both capture content-handling elsewhere)
- Light fixtures to detach/reset? What type? Any other fixtures (smoke detectors etc.)? — only when the room has ceiling drywall REMOVE_AND_REPLACE work

**Conditionally asked per record**, gated on a specific field state (representative examples — the full set covers every live category in §1's table):
- Flooring: hardwood solid/engineered + floating/glued; vinyl sheet/plank + glued/snaplock (plank only); carpet pad present/removed + how much lifted/removed (LIFT_AND_REINSTALL only); phase (only when the PM's own words signalled genuine uncertainty)
- Baseboard: detached-only/removed-and-replaced/shoe-mold-only (whenever extraction left the action unstated — asked on its own, since every other baseboard question is gated on the answer); material/profile (always, once the action is known); height + phase (REMOVE_AND_REPLACE only)
- Walls: insulation affected → type; drywall cut height (Base/2ft/4ft/Full) → linear footage (2ft/4ft only)
- Doors/cabinetry/countertops/ceilings: type, grade, material, finish, texture style, quantities — each gated on the record's own action/type, listed in full in the source
- Dormant categories (outlets, light fixtures, electrical panel, toe kicks, wall tile, stairs, non-vanity plumbing): full question logic still exists and would fire correctly, but never does because no record of these types is ever created (§1)

**Auto-included, never asked** — computed entirely at generation time from data that's already known, listed in `documentGenerationPrompt.ts`'s `EMERGENCY_DERIVATION_RULES` (11 numbered rules) plus a few more in `SCOPE_DOCUMENT_SECTION`'s own notes:
1. Water extraction — "from carpet" whenever any LIFT_AND_REINSTALL carpet record exists (assumed, no question); "from {carpet/hard surface} – {quantity}" from the new gap-checked field otherwise
2. Carpet + pad lift/removal quantities
3. Floor registers (same count, both phases)
4. Furnace/HWT inspection note
5. Tub/shower faucet
6. Toilet handling (no wax-ring line)
7. Vanity sink (unconditional) + countertop (conditional)
8. Electrical panel inspection/work note
9. Drywall replacement trade sequence by cut height (+ computed priming SF)
10. Baseboard paint/finish by material+action
11. Ceiling-triggered light fixtures / other fixtures
12. Carpet cleaning, underpad replacement, final clean — all Repair-side, keyed off flooring disposition

---

## 3. Document generation pipeline

**Two Claude API calls total**, both server-side only (`lib/anthropic.ts`, model `claude-opus-5` by default, overridable via `ANTHROPIC_MODEL`), both Structured Outputs (`output_config.format` with a hand-authored JSON Schema from `lib/schema.ts`, no `anyOf`/unions anywhere — Claude's schema compiler caps those at 16 and separately caps total property count, both limits this app has hit and designed around):

1. **`POST /api/extract`** — transcript (or a DGIG-synthesized one, see §7) in, `WaterLossExtraction` out. `max_tokens: 8000`. This is the *only* call that ever runs on freeform text.
2. **`POST /api/generate`** — completed `WaterLossExtraction` + `ClaimInfo` + original transcript (+ optional `contentsAssignmentNote` and `dgigData`) in; `{ inspectionReport?, scopeDocument }` out in one response. `max_tokens: 16000`. Two schema variants: full (`documentGenerationSchema`) or `scopeOnlyGenerationSchema` (no `inspectionReport` property at all when `claim.scopeOnly`).

**Zero-call paths**: a claim with only `CONTENTS` selected skips both calls — `lib/contentsTM.ts`/`lib/bricABrac.ts` build the whole scope document client-side from form state. A DGIG claim whose tear-out descriptions are all blank skips the extract call specifically (seeds an empty extraction client-side) but still calls generate.

**Inspection report** (omitted entirely in scope-only mode) — fixed sections, in order: CAUSE OF LOSS (from `claim.causeOfLoss`, never the transcript alone), AREAS DAMAGED (room list), MATERIALS DAMAGE (bulleted per room), DRYING STRATEGY/APPROACH (cut heights + antimicrobial/equipment — for a DGIG claim this pulls antimicrobial/drying-class from `dgigData` instead of the transcript), CONTENTS (one sentence — either the client-computed `contentsAssignmentNote` verbatim, or synthesized from transcript+`rooms[].contents`, or "To be confirmed with PM"), PRE-EXISTING CONDITIONS, ASBESTOS (requirement status only), SKETCH (omitted — no sketch feature exists in this build at all).

**Scope document** — header (`{jobNumber} – {customerName}`, Category/Class of loss [omitted entirely for a non-WATER claim], Insurer), then `Emergency` and/or `Repair` sections depending on `scopePhases` (room headings with short-dash bullets, a `General` block under Emergency for disposal/equipment-pickup/asbestos-sample-count/etc.), governed by the phase-combination rules in §7. For a DGIG claim, Emergency is built *only* from `dgigData` (ignoring the extracted structural data entirely); Repair still uses the normal per-category derivation against genuinely-extracted data. Job Information (insured/address/claim number/PM/dates/etc.) is **not** generated by Claude at all — `components/JobInformationSection.tsx` renders it directly from `ClaimInfo` on screen, and `lib/pdf.ts` draws the same grouped data into the PDF.

---

## 4. Work-order feature

**Does not exist, in any form.** The domain model this was ported from (`GeneratedDocuments`) explicitly excludes it — `lib/types.ts`'s own comment: *"minus `inspectionReportPhotoIds` and `workOrder` — photo attachments and the on-demand work order document are both out of scope for Phase 1."* This was a deliberate scoping decision from before this build started, not something dropped along the way. There is no work-order type, schema, prompt section, UI, or stub anywhere in the codebase. The two documents produced are exactly: inspection report and scope document.

---

## 5. Account / profile / authentication

**One shared password gates the entire app — not per-user accounts.**

- `lib/siteAuth.ts` + `middleware.ts`: an HMAC-SHA256-signed session cookie (`site_auth`, 30-day expiry, Web Crypto so it works on Next's Edge runtime) checked in front of *every* route, pages and API alike. No password configured → fails open in dev, fails closed (503) in production.
- `POST /api/login` checks the submitted password against one env var (`SITE_PASSWORD`) and sets the cookie. There is no username, no per-person identity, no database of any kind behind this — one password, shared by everyone who has it.
- `POST /api/logout` exists and correctly clears the cookie, but **is not wired to any button in the UI** — its own doc comment says why: "one shared password across every tester makes 'log out' of limited value until real per-person accounts exist."
- `/login` is a plain client-side password form.

**Does not exist**: individual user accounts, sign-up, per-user data isolation, roles/permissions, password reset, PM phone/email (hardcoded blank in Job Information — explicitly deferred to "once a user profile exists"), and any per-company branding — `lib/letterhead.ts` has exactly one hardcoded `Letterhead` object (Scrivn navy/amber), explicitly documented as a placeholder standing in for whichever real company ends up using a future multi-profile system.

This whole area is tracked as deliberately deferred — see the `scope-assistant-profiles-login-deferred` memory note referenced in this project's history.

---

## 6. Beyond document generation

- **Edit/Save on generated documents**: each document has an Edit/Save toggle that swaps a read-only `<pre>` for a `<textarea>` bound directly to the in-memory `documents` state. "Save" just flips back to the read-only view — **this is not persistence**, it's a UI-mode toggle over React state that already existed. A page refresh loses it exactly like everything else.
- **PDF export**: client-side only (`lib/pdf.ts`, jsPDF) — draws the letterhead, an optional Job Information grid, and the (possibly hand-edited) body text, paginated, downloaded as `{jobNumber} - {customerName} - {docLabel}.pdf`. No server round-trip.
- **On-screen letterhead banner**: `components/LetterheadBanner.tsx` renders the same `Letterhead` object as HTML above each document preview, so the screen and the PDF show matching branding.
- **No history, no versioning, no persistence layer of any kind.** Confirmed by grep: no database client, no ORM, no `localStorage`/`sessionStorage`/`indexedDB` usage anywhere, no save-claim/load-claim mechanism. Every piece of claim state is a `useState` hook in `app/page.tsx`; "Start Over" resets all of it to empty, and there is no other way to get back to a previous claim once you navigate away or refresh.
- **No team or multi-user features** — no shared workspace, no assignment, no comments, nothing beyond the single shared password in §5.

---

## 7. Where the build ended up differing from what was described earlier

- **Phase selection was redesigned from a fixed enum to a free multi-select.** It originally shipped as one `scopePhaseMode` value picked from five named options (`EMERGENCY_AND_REPAIR`, `EMERGENCY_ONLY`, `REPAIR_ONLY`, `CONTENTS`, `ALL_THREE_PHASES`). That's gone — `ClaimInfo.scopePhases` is now an array of independent `EMERGENCY`/`REPAIR`/`CONTENTS` toggles that can combine in any way (e.g. Repair + Contents with no Emergency, which the old five-value enum couldn't express at all). Every place that used to branch on the named enum (intake form, `app/page.tsx`'s step routing, the generation prompt's `SCOPE_PHASE_MODE_RULES`) was rewritten around `.includes()` checks and three small helper functions (`isContentsOnly`, `hasStructuralScope`, `hasSeparateContents`).
- **DGIG went through three materially different designs, not incremental tweaks.** First version: a free-text Claude call composing both Emergency and Repair narratively from a bric-a-brac-style intake, filled in *after* the transcript step. That was reworked so the DGIG form runs **first**, before any dictation, and each room's "what was torn out" text is fed to the *same* extraction endpoint as a synthesized transcript — meaning Repair for a DGIG claim now comes from genuinely-extracted, gap-checked structured data, not composed prose. Individual fields also flipped mid-build: a water-extraction-equipment text field was removed then reinstated as an hours field; a dust-protection checkbox was removed in favor of a free-text "anything else" catch-all; disposal went from a plain boolean to the same typed selector used elsewhere; antimicrobial gained a quantity it didn't originally have.
- **Xactimate code matching was built, then deliberately removed.** A 2,429-row reference dataset was imported and used to deterministically derive and validate real Xactimate codes for bric-a-brac's box-cleaning shortcut. After a data-provenance/licensing concern (raised by the user, about whether that spreadsheet was theirs to import), both the dataset file and its accessor module were deleted, and box-cleaning now prints a plain description instead of a code — the same "estimator assigns it" treatment individually-listed items always had. **There is no Xactimate integration anywhere in the app now**, by explicit reversal, not because it was never attempted.
- **Wall `cutHeight` is still gap-check-only, despite a real attempt to fix that.** A reported bug ("I already said the height in the transcript, why am I still being asked") was traced to `cutHeight` never having existed in the extraction JSON Schema at all — it was gap-check-only from the start, so no amount of prompt wording could have made the model fill it in. Adding it to the schema was tried and immediately reproduced Anthropic's "compiled grammar is too large" error, breaking extraction for every claim outright. It was reverted. The question is still asked every time a wall's drywall is being removed; a real fix would mean splitting extraction into two smaller API calls, which hasn't been done.
- **The insurer field went through three UI iterations.** Plain text input → a native `<select>` dropdown sitting next to a separate free-text input (two elements, mismatched styling) → the current single `<input list>` combobox with a `<datalist>` of common insurers, which both looks identical to every other text field and still accepts anything typed. `KNOWN_INSURERS`/`isDGIG`/`isTD` (`lib/insurers.ts`) are unchanged underneath all three.
- **The rebrand from "Fieldscope" to "Scrivn"** touched the letterhead, page title, and wordmark, but the main page's `<h1>` was deliberately left reading "Scope Assistant" rather than being swept up in the rename.
- **The extraction schema's category cuts predate this session** but are easy to miss if you're reading `types.ts`/`gapCheck.ts` in isolation: outlets/electrical panel were cut first, then stairs/wall tile/light fixtures/most plumbing fixtures/toe kicks in a second round, purely for Structured Outputs size limits. All of that code is real and would work immediately if re-added to `schema.ts`/`extractionWire.ts` — it's just currently inert, which section 1's tables call out per-category so it doesn't read as "missing" when it's actually "built, disconnected."
