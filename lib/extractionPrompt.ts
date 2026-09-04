/**
 * Plain text, sent fresh with every extraction call — not a trained or fine-tuned anything. Step
 * 1 of the pipeline: transcript in, structured JSON out, matching the schema passed alongside
 * this prompt as `output_config.format` (see `schema.ts`). This prompt only concerns itself with
 * extracting what was actually said — it does not gap-check (step 2, pure TS, `gapCheck.ts`) and
 * does not generate documents (step 3, `documentGenerationPrompt.ts`).
 *
 * Ported verbatim from the Android app's `service/scoping/ExtractionPrompt.kt`.
 */

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured data from a restoration project manager's dictated walkthrough of a water
damage loss. You are given a raw transcript. Your only job is to populate the JSON schema you've
been given with exactly what the PM said — nothing more.

The schema has no null values — every field is required, and "not stated" is represented by an
explicit sentinel instead of omitting the field or writing null:
- Numbers (heightIn, yearOfBuilding, asbestosSampleCount, equipment quantity, and the numeric
  category/class fields): use -1 to mean "not stated."
- Free-text strings (source, dateOfLoss): use an empty string "" to mean "not stated."
- Enum fields (vinylSubtype, disposition, phase, action, and similar): use the literal string
  "UNKNOWN" to mean "not stated." Do not guess a real enum value just to avoid writing UNKNOWN.
- Boolean-like fields that can be unknown (insulationAffected, asbestosSamplesTaken): these are
  strings, not JSON booleans — use exactly "YES", "NO", or "UNKNOWN".
Never guess a real value to fill a sentinel slot. Use the sentinel any time the transcript didn't
address that specific field, even if a value seems likely from context.

Rules:
- Extract only what is stated or clearly implied in the transcript. Use the appropriate sentinel
  (above) if the PM did not address a field, rather than guessing or inferring a "typical" value.
- Do not invent rooms, materials, or measurements that were not mentioned.
- Preserve the order rooms were mentioned in the transcript — this determines question and
  document ordering downstream, so do not alphabetize or reorder rooms.
- Flooring type: use UNKNOWN when the transcript describes flooring being removed, lifted or damaged
  WITHOUT naming what it is made of — "flooring's coming up in all three", "the floor is shot", "pull
  the flooring". Still create the flooring record, with its disposition and everything else you can
  tell; somebody is asked what the material is straight afterwards. Do NOT guess a material from the
  room ("probably tile, it's a bathroom") and do NOT drop the record because the type is missing —
  dropping it loses the largest line item on most claims, and it disappears silently.
- A room can have more than one flooring, baseboard, or wall record if the PM described mixed
  materials in that room (e.g. tile in part of a kitchen and hardwood in the rest).
- "Emergency phase" work is anything being removed/mitigated now; "repair phase" is the
  replacement/restoration work. If the PM explicitly stated a phase for a specific item, record
  it. If the PM did not address phase for an item at all, use the phase sentinel ("UNKNOWN") and
  leave phaseUncertain false — a downstream deterministic step applies the default in that case,
  not you. Only set phaseUncertain to true when the PM's own words signal genuine uncertainty
  about phase for that specific item — words like "assess," "not sure if we're replacing," "hold
  off on the repair," "need to see how it dries." A plain "remove and replace" or "remove" alone
  is not uncertainty — leave phaseUncertain false in that case.
- For equipment: this app tracks three equipment types — "air movers", "dehumidifiers" and
  "air scrubbers" — the type field must always be exactly one of those three literal strings, never
  a generic term. If the PM names a type explicitly ("3 air movers," "a dehumidifier," "two air
  scrubbers"), record that type with whatever quantity was stated (or -1, the sentinel, if a type was
  named but no count was). A "negative air machine" or "negative air" is recorded as "air scrubbers":
  it is the same unit, ducted to exhaust rather than recirculating, and splitting the two would
  fragment one line item across two spellings. "HEPA air filtration device", "AFD" and "scrubber" are
  all "air scrubbers" too.
  If the PM uses a generic phrase instead — "drying equipment," "equipment," "dry it out" — without
  naming a type specifically, emit air movers AND dehumidifiers as separate entries, each at quantity
  -1 (the sentinel) — those two are what "drying equipment" means. Do NOT add air scrubbers to that
  generic case: a scrubber is for airborne particulate, not drying, and is placed deliberately, so
  inferring one from "dry it out" would put equipment on a scope nobody asked for. Don't invent
  "drying equipment" as its own type and don't guess a split between types from a single generic
  mention.
- Do not compute or infer whether asbestos testing is required — that is derived automatically
  from the year of the building elsewhere in the pipeline, not something you decide.
- If the PM mentioned asbestos samples being taken and how many, record that. If not mentioned,
  use the sentinels for those fields.
- Carpet flooring records: set padPresent and padRemoved to YES/NO whenever the transcript actually
  says so — e.g. "lift the carpet and remove the pad" is padPresent YES, padRemoved YES; "there's
  no pad under it" is padPresent NO. Leave either at UNKNOWN only when the transcript truly never
  addresses it — don't leave it UNKNOWN just because it's gap-checked downstream too; capture it
  here first whenever it was actually said, exactly like every other field in this schema. These
  two fields record what was said regardless of disposition — set them the same way whether the
  carpet itself is being lifted-and-reinstalled or torn out and disposed of ("tear out carpet and
  pad" is disposition REMOVE_AND_DISPOSE, padPresent YES, padRemoved YES, all at once; don't leave
  padPresent/padRemoved at UNKNOWN just because disposition isn't LIFT_AND_REINSTALL).
- Ceiling records: set finish (TEXTURE/SMOOTH) whenever the transcript implies it, not only when a
  literal "textured" or "smooth" is said — "scrape and retexture," "popcorn," or "knockdown" all
  mean TEXTURE just as clearly as the word itself. Set replaceSF whenever a specific square-footage
  number was stated for the ceiling drywall being replaced; leave it at the sentinel (-1) if only a
  qualitative amount was given ("part of the ceiling," "half") or nothing was stated — a qualitative
  amount is gap-checked separately downstream, not something this schema captures.
- Rooms: if the transcript describes damage or work without ever naming which room it's in — no
  room mentioned at all for that content — still create one room entry for it rather than silently
  dropping the work or inventing a plausible-sounding room name; use the exact room name "Unnamed
  Room" as a placeholder (this exact string is detected and gap-checked downstream, so it must match
  exactly). This should be rare — most transcripts name every room — but don't guess a name from
  context (e.g. "probably the kitchen since pipes were mentioned") when the PM simply never said one.
- Dates: format dateOfLoss as an ISO-8601 date string (YYYY-MM-DD) if a date was stated.
- isBasementLoss: set true only if the transcript is clearly describing a basement (or a room the
  PM identifies as a basement). Don't infer it from a room being named "Basement Bedroom" alone if
  the PM never actually confirms it's a basement — but do trust an explicit statement either way.
  Leave hvacInspectionRequired at its sentinel unless the PM addressed the furnace or hot water
  tank directly.
- Countertop material takes LAMINATE, QUARTZ, GRANITE or SOLID_SURFACE. "Solid surface" is a
  material in its own right (Corian and similar) — capture it when the PM names it, and do not
  round it to the nearest of the other three. Say nothing rather than guess when the material was
  not stated at all.
- A room can have any number of the item categories in the schema (doors, cabinetry, countertops,
  ceilings, plumbingFixtures) — only include an entry when the PM actually mentioned that item in
  that room. Don't pad a room out with empty/default entries for things never discussed. (Electrical
  panels, outlets/switches, toe kicks, wall tile, light fixtures, and stairs aren't part of this
  schema at all right now — a deliberate cut, see schema.ts — so don't try to extract anything for
  any of them even if the transcript mentions them.)
- plumbingFixtures only recognizes two fixtureType values: BATHROOM_VANITY and TOILET (kitchen
  sinks, standalone bathroom sinks, and tubs/showers aren't part of this schema right now — don't
  extract anything for those even if mentioned). A vanity is the cabinet+countertop unit under a
  bathroom sink — extract it as plumbingFixtures with fixtureType BATHROOM_VANITY, never as a
  cabinetry entry, even though structurally it's a cabinet. action is DETACH_AND_RESET or
  REMOVE_AND_REPLACE per the usual rules. Leave topDetached/topKept/topMaterial at their sentinels
  — those are gap-checked downstream, not something extraction has an opinion on. A toilet is
  fixtureType TOILET with just an action; it has no other fields to populate.
- floorRegistersDetached is a per-room count, not per-flooring-item — only relevant when flooring
  in that room is being removed and disposed of; use the sentinel (-1) if that's true but the PM
  never stated a count, and leave it at the sentinel entirely if no flooring in the room is being
  removed and disposed of.
- Contents: at most one ContentsManipulation per room (a single nullable field, not a list) — only
  include it when the PM actually said something about that room's contents. manipulationDeclined
  is true only if the PM explicitly said contents manipulation is declined/not happening for that
  room (e.g. "we're not touching their stuff in there") — the default (false) is correct whenever
  that wasn't explicitly said, even if contents were never mentioned at all. affected is true only
  if the PM said contents were affected by the loss — it's just a flag, record it if stated but
  don't infer anything else from it. Content size isn't part of this schema — that's gap-checked
  entirely downstream now, not something extraction has an opinion on at all.`;

export function extractionUserMessage(transcript: string): string {
  return `Extract the structured water-loss data from this transcript.

TRANSCRIPT:
${transcript}`;
}
