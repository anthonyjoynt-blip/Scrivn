import type { WaterLossExtraction } from "./types";
import type { ClaimInfo, ScopePhase } from "./claimInfo";
import { lossTypeLabel } from "./claimInfo";
import type { DGIGData } from "./dgig";
// The painting/finishing numbers and phrases below are interpolated from this module rather than
// written out here, so the scope document and the client-rendered Painting work order cannot state
// different multipliers or different wording. See lib/paintDerivation.ts's doc comment.
import { BASEBOARD_FINISH_PHRASE, PRIMING_SF_PER_LF } from "./paintDerivation";

/**
 * Plain text, sent fresh with every generation call — not a trained or fine-tuned anything. Step
 * 3 of the pipeline: the completed JSON (extraction + every gap-check answer applied) in, the two
 * documents out in one call, matching the exact formats below. This step does no extraction and
 * no gap-checking — by the time it runs, `gapCheck.ts`'s `evaluate()` (plus `claimInfo.ts`'s
 * `claimInfoQuestions()`) has already reported no questions remaining.
 *
 * The SYSTEM prompt text below is ported verbatim from the Android app's
 * `service/scoping/DocumentGenerationPrompt.kt` — including the SKETCH section instructions,
 * which key off `hasSketch` in the claim-context JSON. Phase 1 web has no sketch feature, so
 * `userMessage` below sends `hasSketch: false` whenever an inspection report is being generated at
 * all, which the existing (unedited) instructions already handle correctly — the SKETCH section is
 * simply never emitted. (Scope-only mode omits the field entirely — see below — since there's no
 * inspection report, and therefore no SKETCH section, to omit it from.)
 */

/**
 * "Initial Site Report" and JOB INFORMATION (Insured/Address/Claim Number/Category/Class/Date of
 * Loss/etc.) are deliberately NOT part of what this call generates — every one of those 13 fields
 * is already known client-side from `ClaimInfo` before generation ever runs (see claimInfo.ts).
 * `components/JobInformationSection.tsx` renders that whole block as a real HTML grid straight
 * from `claim` state, and `app/page.tsx` places it above this generated text. Do NOT re-add a JOB
 * INFORMATION section here — round-tripping data the app already has with full fidelity through
 * the model's text output is exactly how bugs like "Date of Loss never reached the document"
 * (round 6) kept happening. `lib/jobInformation.ts` is the one place that field list now lives.
 */
const INSPECTION_REPORT_SECTION = `===== INSPECTION REPORT FORMAT (match exactly) =====

CAUSE OF LOSS:
{one to two sentences}

AREAS DAMAGED:
{room list}

MATERIALS DAMAGE:
{room name}
  - {material item}
  - {material item}
  ... (one short bullet per damaged material/item per room, see notes below)

DRYING STRATEGY/APPROACH:
{flood cut heights, antimicrobial, equipment as stated}

CONTENTS:
{as captured, or "To be confirmed with PM" if not mentioned}

PRE-EXISTING CONDITIONS:
{one sentence, from CLAIM CONTEXT's preExistingConditions field}

ASBESTOS:
{"Testing required — building predates 1990." or "Testing not required — building built after 1990." State requirement status only, not the sample count.}

SKETCH:
{only present when CLAIM CONTEXT's hasSketch is true — see the notes below}

Notes on the inspection report:
- CAUSE OF LOSS MUST be built from CLAIM CONTEXT's causeOfLoss field — that's the PM's own
  claim-level answer to "what caused this loss," entered on the claim itself, not something
  inferred from the transcript. It is never blank by the time this runs (a gap-check question
  backstops it). Render it as one to two sentences: causeOfLoss is usually terse ("Supply line
  failure," "Roof leak"), so turn it into a real sentence and, if the transcript adds relevant
  detail (where, how it started), fold that in — but the core fact must always be causeOfLoss's
  content, never invented from the transcript alone and never left as "not described" when
  causeOfLoss has an answer.
- CONTENTS is one short sentence, not a room-by-room narrative.
  If CLAIM CONTEXT's contentsAssignmentNote is present (non-empty), use it — verbatim, or with only
  the lightest grammar adjustment to fit as a sentence — as the entire CONTENTS line. It's
  authoritative, the same "claim context wins" rule as every other field sourced from there: it
  means a separate contents assignment already exists (round 8), so there is no "confirm with PM"
  left to do, even though the transcript itself may say nothing about contents at all — that
  silence is expected in this case, not a gap. Do NOT fall back to the rules below when this field
  is present, and do not blend it with anything the transcript says about contents.
  Otherwise (contentsAssignmentNote absent), synthesize from two sources: anything the transcript
  says about contents, AND the structured data's per-room contents field (rooms[].contents). If any
  room's contents.affected == true, or the transcript otherwise indicates contents are involved, a
  line like "Contents manipulation required on site as needed to complete repairs." is enough —
  don't enumerate which rooms or restate the PM's reasoning at length. Fall back to "To be
  confirmed with PM" only when NEITHER the transcript NOR any room's contents field indicates
  anything about contents at all. If manipulation was explicitly declined everywhere contents came
  up, say that instead, just as briefly. Don't mention contents.size here — that's operational
  detail, not inspection-report narrative.
- PRE-EXISTING CONDITIONS MUST be built from CLAIM CONTEXT's preExistingConditions field — a
  gap-check question backstops it, so it's never blank by the time this runs (round 5 review: this
  used to be silently inferred from the transcript with a hardcoded "None noted" fallback — that
  was an unasked assumption, not something the PM actually confirmed, so it's now an explicit
  answer like causeOfLoss). If the PM's answer was effectively "none" ("None", "N/A", "none
  noted," etc.), render that as "None noted at time of inspection." Otherwise turn their answer
  into one plain sentence — don't invent additional detail from the transcript that the PM didn't
  actually put in this specific answer.
- MATERIALS DAMAGE is a short bulleted list per room, not prose — one line per damaged
  material/item, naming just the material and, if relevant, its disposition ("vinyl flooring,"
  "baseboards to be detached and reset," "toilet detached to allow for flooring removal"). Leave
  out anything that isn't itself a materials fact: no substrate/subfloor detail, no floor register
  counts (that's equipment/operational detail, not a damaged material), no installation method. A
  reader should be able to scan this in a few seconds, not read a paragraph.
- DRYING STRATEGY/APPROACH normally draws "flood cut heights, antimicrobial, equipment as stated"
  from the transcript and the completed water loss data's wall cutHeight fields. For a claim with
  CLAIM CONTEXT's dgigData present (see DGIG_SCOPE_RULES), antimicrobial and drying-equipment
  intensity are NOT going to be described in the transcript the way they would be for any other
  claim — pull them from dgigData instead: state which room(s) had antimicrobial applied
  (dgigData.rooms[].antimicrobial) and each room's drying class
  (dgigData.rooms[].dryingClass, "1"–"4"), in plain language rather than quoting the raw field name.
  Flood cut heights still come from the completed water loss data's wall cutHeight fields exactly as
  usual — dgigData has no cut-height field of its own, that detail still comes from extraction.
- SKETCH: this is the one section that isn't always present. Include the "SKETCH:" header and a
  line noting a sketch is attached only when CLAIM CONTEXT's hasSketch field is true. When it's
  false, omit the header and the line entirely — don't print a placeholder like "pending" or "not
  available." A field that's never going to be filled in shouldn't appear at all.
- There is deliberately no PHOTOS section in this format — this pipeline has no photo capture.`;

/**
 * Rules for deciding whether a record has an Emergency portion, a Repair portion, or both, and
 * what to auto-include beyond copying records verbatim.
 */
const EMERGENCY_DERIVATION_RULES = `Deciding whether a record has an Emergency portion and/or a Repair portion — apply this before
anything else, since it determines both "does this line appear, and in which phase(s)" and "does
this room appear in the document at all":
- Flooring and baseboard have their own phase field (EMERGENCY, REPAIR, BOTH, or not stated) —
  this is how they signal which portion(s) they belong in (the shared-action-field categories
  further below have no phase field; their action alone determines both portions instead).
    - Emergency portion: phase EMERGENCY, BOTH, or not stated all have one. Only phase explicitly
      REPAIR has no Emergency portion. Unstated phase means the PM didn't specify which phase, not
      that no work is happening; silently dropping the item because phase was never asked about is
      wrong every time.
    - Repair portion: phase REPAIR or BOTH has one. Phase explicitly EMERGENCY (and nothing else)
      has none — trust that the PM meant emergency-only work. Phase not stated: for flooring with
      disposition REMOVE_AND_DISPOSE, and for baseboard with action REMOVE_AND_REPLACE, treat
      not-stated the same as BOTH and include a Repair portion too — removing material now almost
      always means new material goes in later, so default to assuming replacement rather than
      silently dropping the room's repair-phase work. This default does NOT extend to flooring's
      REMOVE_AND_ASSESS (a genuine "not decided yet" signal from the PM — stay Emergency-only
      unless phase says otherwise) or to LIFT_AND_REINSTALL/DRY_IN_PLACE, whose Repair-side
      behavior is already fully covered by the carpet-cleaning/underpad auto-includes below and by
      the fact that the same material is going back down, not a default guess about new material.
- Baseboard specifically, when its action is DETACH_AND_RESET: this is always a two-phase job
  regardless of what the phase field says — the baseboard comes off now to protect it and allow
  drying/flooring work (Emergency), and goes back down once things are dry (Repair). Render it as
  two separate bullets, not one combined "detach and reset" line: Emergency "Detach baseboard"
  (just that — do NOT append "salvage and dry" or any disposition detail; salvage is implied by
  DETACH_AND_RESET itself, no need to say so) and Repair "Reset baseboard". This is the one case
  where baseboard's phase field doesn't drive Emergency/Repair inclusion — the action itself does.
  REMOVE_AND_REPLACE baseboard keeps using the phase field as described above. When material is
  MDF, name whether it's flat or has a profile in the material detail (e.g., "MDF baseboard,
  profiled" / "MDF baseboard, flat"). Read this from THAT record's own mdfProfile field —
  "FLAT" means flat, "PROFILE" means profiled — and never from another room's. Two rooms are
  routinely finished differently: one bedroom in flat MDF and one bathroom in profiled MDF is an
  ordinary claim, and the two lines must differ accordingly. If a record's mdfProfile is null, say
  "MDF baseboard" with no flat/profiled word at all rather than borrowing one from elsewhere. This
  is called out because it has gone wrong: a bathroom was written up as flat because a bedroom
  earlier in the same claim was.
- Baseboard with action REMOVE_AND_REPLACE renders as a PAIR of bullets — Emergency "Remove
  baseboard – {material detail} – {extent}" and Repair "Replace baseboard – {material detail} –
  {extent}" — in every case where it has both portions, which per the phase rules above is
  everything except phase explicitly EMERGENCY. Never write one half without the other. A room whose
  Emergency section says the baseboard came off and whose Repair section says nothing about it reads
  as a baseboard that is never going back on, which is not what a remove-and-replace record says.
  Before you finish the document, check every "Remove baseboard" line you have written has its
  matching "Replace baseboard" line in the same room's Repair section — this has been reported from
  the field, in a claim where one room's baseboard was removed and never replaced while another
  room's, identical but for one captured field, was both.
    - heightIn is a DETAIL OF THAT REPAIR BULLET, never a condition on it. Non-null: state it in the
      Repair bullet's material detail, after the flat/profiled word — e.g. MDF baseboard, profiled,
      3.25". Null: write exactly the same Repair bullet with the height left out — MDF baseboard,
      profiled. Do NOT drop, weaken or qualify the "Replace baseboard" line because no height was
      captured; a height nobody stated is a missing spec on a line that still belongs in the
      document, not evidence that no new baseboard is going in. The Emergency "Remove baseboard"
      bullet never carries a height either way — nothing is being specified to take something out.
    - action not stated at all (null): render the same pair, treating it as REMOVE_AND_REPLACE. A
      baseboard record exists because the PM described work on that baseboard, so an unstated action
      means nobody was asked, not that nothing is happening — and an Emergency removal with no Repair
      line is the worst of the three readings. (Gap-check asks for this field now, so it should be
      non-null on every claim; this is here for anything that slips through.)
- Walls have no phase or action field. Emergency/Repair rendering for a wall record with
  drywallBeingRemoved == true is entirely driven by cutHeight — see auto-included item 9 below for
  the full breakdown (phrasing differs by height, and priming/painting is NOT always included).
  Walls never get a Repair bullet copied from the Emergency record itself, only what item 9
  produces.
- Doors, cabinetry, toe kicks, countertops, ceilings, outlets/switches, light fixtures, and
  plumbing fixtures all use the shared action field (DETACH_AND_RESET or REMOVE_AND_REPLACE).
  Every record in these categories always has an Emergency portion regardless of which action it
  is: DETACH_AND_RESET is itself the Emergency action; REMOVE_AND_REPLACE's "remove" half is the
  Emergency action (its "replace" half is Repair-phase). DETACH_AND_RESET also always has a Repair
  portion (the "reset") — see CATEGORY_PHASE_RULES below for exactly how both actions bucket into
  Emergency/Repair items.
- Wall tile and stairs have no action field at all — every record in these categories is
  implicitly a remove/tear-out job, so every record has an Emergency portion.
- Electrical panel: only ever produced when requiresInspection is true. If includedInScope is
  true it has a real Emergency portion (a room-level item). If includedInScope is false it has no
  room-level Emergency portion at all — it becomes a non-room General note instead (see below).
- Contents: has an Emergency portion whenever manipulationDeclined is false (declined means
  nothing for anyone to do). It has a matching Repair portion in that same case too — anything
  moved out for mitigation needs to come back once repair work is done. A short bullet is enough
  for each, exact wording: Emergency "Manipulate contents", Repair "Reset contents" — no size or
  other qualifier appended to either bullet. Never render the affected flag anywhere — it has no
  rendering behavior, same as it has no gap-check behavior.
  Exception (round 7, generalized round 12): skip this rule entirely — no "Manipulate
  contents"/"Reset contents" bullet at all, regardless of manipulationDeclined — whenever CLAIM
  CONTEXT's scopePhases includes "CONTENTS" alongside EMERGENCY and/or REPAIR. A separate contents
  assignment is being scoped in its own Contents section in that case (see SCOPE_PHASE_RULES), so
  content handling belongs there, not duplicated here.
  (scopePhases containing ONLY "CONTENTS" never reaches this prompt at all — it's built client-side
  with no structural scope or Claude call whatsoever, so there's nothing to worry about suppressing.)

Auto-included items — apply these yourself, they are never spelled out per-item in the input data:
1. Water extraction, per room, Emergency — two independent sources, never double-counted for the
   same room:
     a. If any flooring record in that room has disposition LIFT_AND_REINSTALL, include "Extract
        water – from carpet." Carpet holds standing water in a way a hard surface doesn't, which is
        exactly why this narrow case is always assumed true with no quantity needed.
     b. Otherwise (round 12, water claims only — this data is never present for a non-water claim),
        if that room's waterExtractionRequired is true, include "Extract water – from {surface} –
        {quantity}": derive {surface} from that room's flooring records — "carpet" if any of them
        has type CARPET, otherwise "hard surface" (vinyl/laminate/hardwood/tile/concrete), or omit
        the surface phrase entirely if the room has no flooring record at all. {quantity} comes from
        waterExtractionSF (a real number, "{N} SF") when present, else waterExtractionFraction (a
        qualitative share, e.g. "half the room") when only that's present — same real-number-or-
        fraction convention as everywhere else in this document. Omit this bullet entirely when
        waterExtractionRequired is false or not present — do NOT add a water-extraction line just
        because a hard-surface floor is being removed; removal alone doesn't imply extraction was
        needed. (This gap-checked path and the LIFT_AND_REINSTALL-carpet path above are mutually
        exclusive by construction — gap-check never asks (a)'s question when a room already has a
        LIFT_AND_REINSTALL carpet record, so a room is never eligible for both.)
1b. Flooring removal extent, per flooring record, EVERY flooring type: when a record's disposition
   is REMOVE_AND_DISPOSE or REMOVE_AND_ASSESS, its own bullet states the extent from removalSF (a
   real number — "Remove vinyl plank – 48 SF") when that is non-null, else from removalFraction (a
   qualitative share — "half the room") when only that is present. This is NOT carpet-only: vinyl,
   laminate, hardwood, tile and concrete removals all carry it and all must show the number when
   there is one. Only when BOTH are null does the extent fall back to the ordinary qualitative
   phrasing, and in that case describe the area in the PM's own words from the transcript rather
   than inventing a figure. Never turn a removalFraction into an exact number, and never restate a
   qualitative phrase as though it were measured — "a small area at the dishwasher" is what the tool
   says when nobody gave a size, so writing it over a real 48 SF is the specific bug this rule fixes.
1c. Flooring that STAYS and gets cleaned, per flooring record, Emergency: when a record's
   cleaningRequired is true, include "Clean & treat {type} floor – {extent}" ("Clean & treat concrete
   floor – floor area"). Say "Clean" alone rather than "Clean & treat" for a category 1 loss, where
   there is nothing to treat. This is separate from the universal Final clean and from carpet
   cleaning — a floor being scrubbed and treated is work in its own right, and it is the only work a
   room may have, so omitting it can empty a room's scope entirely. Omit when cleaningRequired is
   false or null.
1d. NEVER write "dry in place" for a CONCRETE floor. In this trade "dry in place" means saving a
   material you would otherwise tear out, and nobody tears out a slab — so the phrase tells an
   estimator nothing and reads as though the floor was left alone. A concrete floor with disposition
   DRY_IN_PLACE produces NO disposition bullet of its own; what is actually happening to it is the
   cleaning line above and the drying equipment placed in that room, both of which have their own
   bullets already. If a concrete floor has neither cleaningRequired nor any equipment in its room,
   write nothing for it rather than inventing a line. For every OTHER flooring type, DRY_IN_PLACE
   keeps its ordinary bullet — a hardwood floor being dried rather than pulled is a real decision
   worth stating.
1e. A flooring record whose type is null is a floor whose material nobody stated — it still gets its
   ordinary bullet, worded without a material ("Remove flooring – 140 SF" rather than naming one).
   Never guess the material from the room or from another record; a floor called tile on an insurer's
   scope because the room was a bathroom is a wrong line nobody will re-check.
2. Carpet + pad, per flooring record, Emergency: when a flooring record has disposition
   LIFT_AND_REINSTALL AND padRemoved == true, include two bullets in that room: one for lifting
   the carpet, one for removing the pad underneath. Each states its quantity from
   carpetLiftSF/padRemovedSF (a real count, e.g. "120 SF") when that number is non-null, or from
   carpetLiftFraction/padRemovedFraction (a qualitative share, e.g. "half the room") when the
   number is null but the fraction isn't — exactly one of each pair is ever set. Omit either
   individual bullet only if BOTH its SF and its fraction were never captured. The
   LIFT_AND_REINSTALL requirement matters: padRemoved can also be true on a REMOVE_AND_DISPOSE
   record (the PM stated the pad is coming out along with a full tear-out, not that anything is
   being lifted-and-saved) — do NOT apply this "lift the carpet" auto-include there. A
   REMOVE_AND_DISPOSE record with padRemoved == true needs no separate pad bullet at all — the
   record's own "remove and dispose" bullet already covers the whole assembly coming out, pad
   included; inventing a second, contradictory "lift the carpet" line for the same record is a
   real bug this note exists to prevent (found round 6).
3. Floor registers, per room: for any room where floorRegistersDetached is a positive number,
   include the same bullet in BOTH phases — Emergency AND Repair each get "Detach & reset floor
   registers – {N}" (real count, stated as a number, not qualitative extent) — don't split it into
   a separate detach-only/reset-only line per phase; the count needs to stay visible in the repair
   scope too, not only in emergency. Omit from both phases if floorRegistersDetached is null or
   zero.
4. Furnace/hot water tank inspection, General (not tied to a room), Emergency: if
   loss.hvacInspectionRequired is true, include "Furnace/hot water tank inspection – sub-trade."
   Omit entirely if hvacInspectionRequired is null or false.
5. Tub/shower faucet, per room, Emergency: any room with a plumbing fixture of type TUB_SHOWER
   gets an automatic "Detach & reset faucet – tub/shower," regardless of that fixture's own
   action — every time a tub/shower is in scope at all, in addition to whatever its own action and
   includesSurround produce.
6. Toilet: a plumbing fixture of type TOILET never produces more than its own single bucketed
   item, phrased plainly — "Detach toilet" (Emergency) / "Reset toilet" (Repair), or "Remove
   toilet" / "Replace toilet" for REMOVE_AND_REPLACE. Never add "floor mounted" or any similar
   descriptive qualifier — every toilet is floor mounted, it's implied, don't say it. Never add a
   separate wax-ring item either — replacing the wax ring is implied by the toilet action itself.
7. Bathroom vanity sink, per room: ANY plumbing fixture of type BATHROOM_VANITY — regardless of
   its own action (DETACH_AND_RESET or REMOVE_AND_REPLACE) — automatically gets a sink line in
   both phases, in addition to the vanity's own item(s): Emergency "Detach sink – vanity", Repair
   "Reset sink – vanity". This is unconditional — always include it whenever a BATHROOM_VANITY
   record exists at all, never gated on any other field.
   Countertop, same room, only when the vanity record's data says so (this is separate from the
   sink, and only sometimes present):
     - topDetached == true (DETACH_AND_RESET vanities) or topKept == true (REMOVE_AND_REPLACE
       vanities): include a matching pair — Emergency "Detach countertop – {topMaterial} – vanity",
       Repair "Reset countertop – {topMaterial} – vanity".
     - Otherwise (topDetached/topKept false or not applicable): no separate countertop line — for
       DETACH_AND_RESET this means the countertop stays in place untouched; for REMOVE_AND_REPLACE
       it means the countertop is being replaced as part of the new vanity unit, already covered by
       the vanity's own remove/replace item.
8. Electrical panel, Emergency: only ever produced when electricalPanel is present and
   requiresInspection == true.
     - includedInScope == false → no room-level item. Instead, a General (non-room) note:
       "Electrical panel inspection – sub-trade (not included in this scope)."
     - includedInScope == true → a real room-level item: "Electrical panel – inspection & work –
       {amperage}A" (amperage only if non-null), plus a second item "Electrical panel – meter
       work – included" if includeMeterWork == true.
9. Drywall replacement, per room, Repair — whenever any wall record in that room has
   drywallBeingRemoved == true, add Repair bullet(s) based on that record's cutHeight (fires once
   per room; don't repeat per wall record if more than one shares the same cutHeight in that room):
     - cutHeight BASE: exactly one bullet, "Replace drywall at base height (up to 4")" — no
       quantity needed. Do NOT add a priming/painting bullet for this case at all — standard
       practice is to replace and let the baseboard cover the seam, left unfinished.
     - cutHeight TWO_FOOT or FOUR_FOOT: two bullets. First, "Replace drywall at 2'" or "Replace
       drywall at 4'" (match the actual height) with a quantity — cutRunFt (a real linear-feet
       number) if present ("– {cutRunFt} LF"), else cutRunFraction if present ("– {fraction} of the
       wall run"), else "– perimeter" as the last-resort default. Second, a priming bullet: if
       cutRunFt (the real number) is present, compute priming SF yourself — cutRunFt × ${PRIMING_SF_PER_LF.TWO_FOOT} for 2',
       cutRunFt × ${PRIMING_SF_PER_LF.FOUR_FOOT} for 4' — and state the computed number ("Prime & paint walls – {computed} SF" — name the surface, so the
       line cannot be read as a ceiling's); if
       only cutRunFraction is present, skip the multiplier math and state priming qualitatively
       instead ("Prime & paint – {fraction} of the wall run") — never invent a number from a
       fraction.
     - cutHeight FULL_WALL: two bullets, "Replace drywall – full wall" and "Prime & paint – full
       wall" (same qualitative extent for both, no multiplier — priming covers exactly what the
       drywall bullet covers).
     - cutHeight not yet known (null): treat the same as BASE for now — one "Replace drywall"
       bullet, no priming — rather than guessing a height or skipping the room's drywall entirely.
   This item only adds Repair-side bullets — Emergency for these walls is unaffected, already
   covered by the drywallBeingRemoved Emergency portion described in the walls bullet above.
10. Baseboard paint/finish, per baseboard record, Repair — fires whenever the baseboard has a
    Repair portion at all (REMOVE_AND_REPLACE's "replace" half, or DETACH_AND_RESET's "Reset
    baseboard" bullet — see the baseboard bullet in the rules above), keyed on material and action:
      - material MDF, REMOVE_AND_REPLACE: "${BASEBOARD_FINISH_PHRASE.MDF_REMOVE_AND_REPLACE}"
      - material MDF, DETACH_AND_RESET: "${BASEBOARD_FINISH_PHRASE.MDF_DETACH_AND_RESET}"
      - material SOLID_WOOD, REMOVE_AND_REPLACE: "${BASEBOARD_FINISH_PHRASE.SOLID_WOOD_REMOVE_AND_REPLACE}"
      - material SOLID_WOOD, DETACH_AND_RESET: "${BASEBOARD_FINISH_PHRASE.SOLID_WOOD_DETACH_AND_RESET}"
      - material VINYL_PVC_COMPOSITE: no paint/finish bullet at all, either action.
      - material not yet known (null): no bullet — don't guess.
    SHOE_MOLD_ONLY baseboards never get this — they have no Repair portion at all (see the baseboard
    bullet above), so there's nothing to paint/finish.
11. Ceiling-triggered electrical fixtures, per room — fires only in rooms with at least one ceiling
    record where type is DRYWALL_PLASTER and action is REMOVE_AND_REPLACE (i.e. wherever the
    drywall-replacement rules in CATEGORY_PHASE_RULES/the ceiling material-detail note below
    already apply). Two independent items, both keyed off room-level fields (not the ceiling
    record itself).

    WHICH PHASES these go in depends on ceilingFixturesInRemovalArea, which applies to both items
    below equally:
      - true, or null: the fixture is inside the ceiling actually coming out, so it has to come down
        before the drywall does — detach is Emergency, reset is Repair, split across the two phases
        as written below. Null means the question was never asked, and this split is the long-
        standing default, so keep it.
      - false: the fixture is outside the removal area and is only coming down for the retexturing,
        which is Repair work. Put BOTH the detach and the reset in Repair, and write nothing at all
        in Emergency for it. Splitting it would send a crew out in the emergency phase for a fixture
        nobody needs to touch yet.
    When both halves land in Repair and the document has a single combined section (see
    SCOPE_PHASE_RULES), they combine into one "Detach & reset ..." bullet like any other pair.
      - ceilingLightFixturesPresent == true: "Detach light fixture – {type}" / "Reset light fixture
        – {type}", phased per the rule just above. When ceilingLightFixtureCount is a number greater
        than one, lead with it and pluralise — "Detach 6 light fixtures – Recessed". A count of one,
        or null, reads as the singular above. Where {type} is
        ceilingLightFixtureType rendered in natural case ("Regular fixture," "Recessed," "Recessed
        trim only," "Chandelier"). Omit entirely if ceilingLightFixturesPresent is false or null.
      - otherCeilingFixtures: whenever it's a non-empty string and not an effectively-"none" answer
        ("None", "N/A," "none," etc. — case-insensitive), phased per the rule above, using the PM's own words
        verbatim as the item description: "Detach – {otherCeilingFixtures}" (Emergency) / "Reset –
        {otherCeilingFixtures}" (Repair). Do not rephrase, summarize, or add detail to what the PM
        typed — the whole point of this field is that their own words become the scope line as-is.
        Omit entirely if the field is empty, null, or an effectively-"none" answer.
12. Ceiling insulation, per ceiling record, Emergency — whenever a DRYWALL_PLASTER ceiling with
    action REMOVE_AND_REPLACE has aboveInsulationAffected == true, add "Remove wet insulation above
    ceiling – {type}", where {type} is aboveInsulationType in natural case ("Fiberglass batt",
    "Cellulose", "Foam") and is omitted entirely when null. This mirrors how a wall record's
    insulationAffected/insulationType already render — water coming through a ceiling soaks what is
    above it, and that insulation comes out with the drywall. Write nothing when
    aboveInsulationAffected is false or null.
13. Drying equipment, per room, Emergency — for every entry in that room's "equipment" array with a
    quantity greater than zero, one bullet: "Place {quantity} {type}" ("Place 3 air movers", "Place
    1 dehumidifier"). Singularise the type when the quantity is 1. These are Emergency-phase and
    single-phase: equipment goes in during mitigation and its removal is already covered by the
    General "Equipment pickup and monitoring" line, so never write a Repair-phase counterpart.
    Equipment is the one record type with neither an action nor a phase field, which is why it needs
    this rule spelled out rather than being derived like the others — without it these lines get
    dropped from the scope entirely even though the inspection report renders them from the same
    data.
    A quantity of ZERO is not missing data: it means the PM was asked and said none was needed in
    that room. Write no "Place" bullet for it — see the zero-quantity rule further below for what to
    say instead.
14. Antimicrobial, per room, Emergency — for every room whose antimicrobialApplied is true, one
    bullet: "Antimicrobial application". Emergency-phase and single-phase; never write a Repair
    counterpart. Like equipment above, this is a room-level fact with no action or phase field of its
    own, which is exactly why it needs spelling out — and exactly how it was being lost: a claim
    stating "antimicrobial throughout both spaces" produced an inspection report that said so and a
    scope with no antimicrobial line in either room, because the report is written with the
    transcript in hand and these bullets are built only from the data above. Write nothing when
    antimicrobialApplied is false or null — do NOT add the line because the loss is a category 3 and
    it seems likely. (A DGIG claim renders antimicrobial from dgigData instead, with its own quantity
    — see DGIG_SCOPE_RULES. Never write both.)
15. Containment, per room, Emergency — for every room whose containmentRequired is true, one bullet:
    "Containment – poly barrier – {containmentSF} SF" when containmentSF is a real number, or just
    "Containment – poly barrier" when it is null. Priced per square foot of BARRIER, so never
    substitute the room's floor area for a missing containmentSF — a barrier hangs across an opening
    and its size has nothing to do with the size of the room. Emergency-phase and single-phase: the
    barrier coming down is covered by the General equipment/teardown line, so write no Repair
    counterpart. Omit entirely when containmentRequired is false or null.
16. HEPA vacuuming, per room — for every room whose hepaVacuumingRequired is true, one bullet:
    "HEPA vacuuming – {extent}", where {extent} is that room's floor area the same way any other
    floor-area extent is derived (a real SF figure where one is known, otherwise the qualitative
    "floor area"). It is priced per SF of floor, which is why it carries no quantity of its own.
    Omit entirely when hepaVacuumingRequired is false or null.
17. Appliances, per room — for every entry in that room's "appliances" array, a PAIR of bullets:
    Emergency "Detach {appliance}" and Repair "Reset {appliance}", where {appliance} is the type in
    ordinary words — WASHER "washer", DRYER "dryer", FRIDGE "fridge", RANGE "range", DISHWASHER
    "dishwasher", BUILT_IN_OVEN "built-in oven", COOKTOP "cooktop", RANGE_HOOD "range hood",
    BUILT_IN_MICROWAVE "built-in microwave". Never write one half without the other, exactly as with
    baseboard's detach/reset pair. There is no action field and no remove-and-replace form: a
    restoration contractor detaches and resets appliances and does not replace them, so never write
    "Remove" or "Replace" for one.`;

/**
 * How to bucket the "shared action field" categories into Emergency vs. Repair bullets/items, and
 * how to phrase them.
 */
const CATEGORY_PHASE_RULES = `Phase bucketing for the categories with a shared action field (doors, cabinetry, toe kicks,
countertops, wall tile, ceilings, outlets/switches, light fixtures, electrical panel, plumbing
fixtures, stairs) — these have no phase/phaseUncertain field of their own (unlike flooring/
baseboard), so derive phase from action instead:
  - action DETACH_AND_RESET → two items, same treatment as baseboard's DETACH_AND_RESET above: an
    Emergency "detach" item and a matching Repair "reset" item, both for the same room. It comes
    off now (to protect it, or get it out of the way for other work) and goes back once the room
    is ready — e.g. "Detach cabinetry – {location}" (Emergency) / "Reset cabinetry – {location}"
    (Repair).
  - action REMOVE_AND_REPLACE → two items: an Emergency "remove" item and a matching Repair
    "replace" item, both for the same room.
  - Wall tile has no action field at all (it's always implicitly remove-and-replace per the data
    model) — always bucket it as the REMOVE_AND_REPLACE case above. Stairs also has no action
    field — treat it the same way (a removal/prep item in Emergency, a refinish/replace item in
    Repair) using whatever flooring/riser/nosing detail was captured.`;

/**
 * Which phase(s) of the scope document actually get rendered (round 7, generalized to an
 * any-combination multi-select round 12 — per direct feedback: "have emergency, repair, contents
 * there and the user can select one or multiple so they arent constrained if they need a repair and
 * a contents") — layered on top of every rule above rather than replacing them:
 * EMERGENCY_DERIVATION_RULES, CATEGORY_PHASE_RULES, and the ceiling/drywall sequences in
 * SCOPE_DOCUMENT_SECTION all still decide *what a record's Emergency and Repair portions would be*;
 * this only decides which of those portions makes it into the final document, and how to fold a
 * record's two portions into one when Repair is selected without Emergency. See claimInfo.ts's
 * ScopePhase doc comment for the option set.
 */
/**
 * The phases the MODEL is told about.
 *
 * "REMEDIATION" is removed. An abatement scope is calculated from a form and appended to the
 * document afterwards — the same arrangement Contents already has — so passing the phase through
 * would invite the model to write a Remediation heading of its own that the real section then
 * duplicates.
 */
function modelScopePhases(claim: ClaimInfo): ScopePhase[] {
  return claim.scopePhases.filter((phase) => phase !== "REMEDIATION");
}

const SCOPE_PHASE_RULES = `CLAIM CONTEXT's scopePhases is an array containing any combination of "EMERGENCY", "REPAIR", and
"CONTENTS" — the PM can select any subset (e.g. Repair and Contents with no Emergency at all). This
controls which section(s) of the scope document render, on top of every rule above:
- "REMEDIATION" is stripped before this prompt is built and will never appear here. If one ever does,
  ignore it: an abatement scope is calculated from a form and appended after your output, never
  written by you.
- scopePhases includes "EMERGENCY": render an "Emergency" heading, following every rule above
  exactly. Not included: omit the "Emergency" heading and every Emergency bullet entirely, for every
  room and for General.
- scopePhases includes "REPAIR": render a "Repair" heading, following every rule above exactly. Not
  included: omit the "Repair" heading and every Repair bullet entirely, for every room. Also, when
  Repair is omitted, do not apply any "phase not stated" default described above (the ones that
  otherwise assume a Repair portion for REMOVE_AND_DISPOSE flooring or REMOVE_AND_REPLACE baseboard
  with no stated phase) — there is no Repair scope being produced at all, so don't reason about what
  it would eventually contain.
- REPAIR selected but EMERGENCY not selected: omit the "Emergency" heading entirely, including
  General (General's items move under Repair instead, same items, just sitting under the one
  heading that exists). Do NOT simply drop every Emergency-only bullet: for any record that would
  normally split into a separate Emergency "detach/remove" bullet and Repair "reset/replace"
  bullet — baseboard DETACH_AND_RESET, every shared-action-field category (doors, cabinetry,
  countertops, wall tile, ceilings, plumbing fixtures, stairs), and the vanity sink/countertop and
  floor-register auto-includes — COMBINE the pair into one bullet describing the whole job instead
  of listing either half alone: "Detach & reset {item} – {material detail} – {extent}" for the
  DETACH_AND_RESET pair, "Remove & replace {item} – {material detail} – {extent}" for the
  REMOVE_AND_REPLACE pair. Contents follows the same combining rule: "Manipulate & reset contents"
  instead of the two separate bullets (unless CONTENTS is also separately selected — see below, in
  which case neither bullet renders at all, combined or not). Items that are inherently single-phase
  already — Disposal charge, Equipment pickup and monitoring, asbestos sample collection,
  furnace/hot water tank inspection, the electrical panel inspection note, the ceiling texture
  sequence, the drywall replacement sequence, baseboard paint/finish, carpet cleaning, underpad +
  carpet — are unaffected by this combining rule; render them exactly as their own rule above
  describes, just now sitting under a document that has no separate Emergency heading above them.
- Both EMERGENCY and REPAIR selected: render exactly as every rule above describes, full normal
  derivation for both sections, no combining.
- scopePhases includes "CONTENTS" ALONGSIDE at least one of EMERGENCY/REPAIR: skip the "Manipulate
  contents"/"Reset contents" (or the combined "Manipulate & reset contents") auto-include entirely,
  regardless of manipulationDeclined — a separate contents assignment is being scoped in its own
  Contents section in that case, appended to this document after you generate it (you never need to
  produce that section yourself), so content handling belongs there instead of duplicated in
  Emergency/Repair. CONTENTS not selected, or selected alone: the auto-include applies normally
  (and if selected alone, see the next line — you never even see this prompt in that case).
- scopePhases containing ONLY "CONTENTS" (neither EMERGENCY nor REPAIR) never reaches this prompt at
  all — a pure contents assignment has no structural scope and is built entirely client-side with no
  Claude call whatsoever.`;

/**
 * DGIG (round 10, reworked round 11) bills Emergency almost entirely in labor hours rather than the
 * item-based format every other insurer uses — see dgig.ts's doc comment. This whole block only
 * applies when CLAIM CONTEXT's dgigData is present, which app/page.tsx only ever sends for a DGIG
 * claim, and only once that claim's DGIG form actually has something in it (see dgig.ts's
 * hasDGIGContent) — a DGIG claim whose PM hasn't filled that step in yet renders with the standard
 * derivation below instead, never an empty Emergency section.
 *
 * Round 11 changed the flow this data comes from, not just the rendering: the DGIG form is now
 * filled in BEFORE the transcript step, and each room's "what was torn out" field (
 * dgigData.rooms[].tearOutDescription) IS the transcript that then gets run through the normal
 * extraction/gap-check pipeline — see app/page.tsx's handleContinueFromDGIGForm. That means, unlike
 * round 10, Repair for a DGIG claim is no longer composed by you from free text — it comes from
 * genuinely-extracted, gap-checked structured data, same as any other claim's Repair section. Only
 * Emergency is still built from dgigData directly.
 */
const DGIG_SCOPE_RULES = `CLAIM CONTEXT's dgigData (present only for this insurer, and only once its own form has content —
see the note on that field below) changes how the Emergency section is built for this claim, but NOT
how Repair is built. Repair still follows EMERGENCY_DERIVATION_RULES, CATEGORY_PHASE_RULES, and
every other rule in this whole SCOPE DOCUMENT FORMAT section exactly as written, applied to the
completed water loss data exactly like any other claim — that data is genuinely real for a DGIG
claim too: it comes from running each room's tearOutDescription text through the same
extraction/gap-check pipeline as a normal dictated transcript, so baseboard height, flooring type,
wall cut height, and everything else Repair needs is actually known by the time this runs, not
guessed or composed from the raw descriptor.

Emergency: IGNORE EMERGENCY_DERIVATION_RULES and CATEGORY_PHASE_RULES entirely for this section only
— do not render the completed water loss data's flooring/baseboard/wall/etc. records as Emergency
bullets. dgigData is the ONLY source for Emergency content on this claim.
  General (claim-level, not tied to a room) — each line only when its value is non-empty:
    - "Labor – PM inspection – {pmInspectionHours} hrs"
    - "Labor – travel – {travelHours} hrs"
    - "Labor – equipment monitoring – {equipmentMonitoringHours} hrs"
    - "Disposal charge – {disposalType label}" when disposalType is not null — render the plain
      English label (e.g. disposalType DUMPSTER_12YD is "Dumpster – 12 yd", PICK_UP is "Pick up"),
      never the raw enum constant. Omit this line entirely when disposalType is null — unlike the
      standard (non-DGIG) scope format, a DGIG claim's disposal line is never a generic unqualified
      "Disposal charge"; it's either this specific line or nothing.
  Per room (dgigData.rooms — use each room's own roomName as the heading; skip a room entirely if
  every field below is blank/null/false for it):
    - Tear-out line: when tearOutHours is non-empty, "Labor – tear out – {tearOutHours} hrs" — and if
      tearOutDescription is also non-empty, append it as an F9 note: "Labor – tear out –
      {tearOutHours} hrs (F9 note: {tearOutDescription})". If tearOutHours is blank but
      tearOutDescription is filled in, still render the descriptor on its own: "Tear out – F9 note:
      {tearOutDescription}" (worth keeping even with no hours figure). If both are blank, no
      tear-out line at all.
    - "Labor – content manipulation – {contentManipulationHours} hrs" when non-empty.
    - "Labor – water extraction – {waterExtractionHours} hrs" when non-empty.
    - "Labor – cleaning – {cleaningHours} hrs" when non-empty.
    - "Drying class {dryingClass}" when dryingClass is not null (a "1"/"2"/"3"/"4" value).
    - Antimicrobial, only when antimicrobial is true (omit entirely when false): "Antimicrobial
      application – {antimicrobialSF} SF" if antimicrobialSF is a real number; otherwise
      "Antimicrobial application – full floor" or "Antimicrobial application – partial area of the
      floor" if antimicrobialExtent is FULL_FLOOR or PARTIAL_FLOOR respectively; otherwise (neither
      given) just the bare "Antimicrobial application" with no quantity.
    - "{otherNotes}" verbatim, exactly as the PM typed it, when non-empty — a discretionary
      catch-all for anything not covered by the fields above. Do not rephrase, summarize, or add
      detail to it, same treatment as any other "PM's own words" field elsewhere in this document.

Repair: render it normally — the per-category derivation, every auto-include, the
ceiling/drywall/baseboard sequences, all of it — exactly as this document already describes for any
non-DGIG claim, using the completed water loss data. The only thing different about a DGIG claim is
where that data came from (a tear-out description instead of a freely dictated walkthrough); that
doesn't change how you render it. SCOPE_PHASE_RULES's "combine into one bullet" instruction (for
when REPAIR is selected without EMERGENCY) is the one exception — skip it specifically for a DGIG
claim, since there is no Emergency-derived-from-this-data to combine a Repair bullet with (Emergency
comes entirely from dgigData above, never from these records): for a DGIG claim with REPAIR selected
and EMERGENCY not selected, render Repair bullets the same uncombined way you would if both were
selected, just with no Emergency heading above them.`;

/** The scope-of-work document's format and rules. */
const SCOPE_DOCUMENT_SECTION = `===== SCOPE DOCUMENT FORMAT (match exactly) =====

{jobNumber} – {customerName}
Category of loss: {category}
Class of loss: {class}
Insurer: {insurer}

Emergency
  {room name}
    - {action} – {material detail} – {qualitative extent}
    ... (one bullet per record with an Emergency portion, per EMERGENCY_DERIVATION_RULES below)
  General
    - Disposal charge
    - Equipment pickup and monitoring
    - Asbestos sample collection – {N} samples   (only when loss.asbestosSamplesTaken is true; {N} is
      loss.asbestosSampleCount, omitted along with the word "samples" when that count is null)
    ... (plus any non-room Emergency auto-included items — see the rules below)

Repair
  {room name}
    - {action} – {material detail} – {qualitative extent}
    ... (one bullet per record with a Repair portion)

Notes on the scope document — tone and format matter as much as content here:
- Bullets are short dashes, not full sentences: "{action} – {material detail} – {extent}".
- Extent is always qualitative: "perimeter," "floor area," "half the room," "all," never a number
  pulled from the underlying measurements — except the specific fields below that carry a real
  quantity (floor registers; FLOORING REMOVAL SF; carpet-lift/pad-removal/underpad SF; wall drywall
  cut-run LF/priming SF; ceiling drywall replacement SF). Several of these accept EITHER an exact number OR a
  qualitative fraction (quarter/half/three-quarters/full) — when only the fraction was captured,
  render it as a qualitative phrase ("half the room," "a quarter of the wall run"), not a number;
  never invent an exact figure from a fraction.
- Window cleaning: windowCleaningCounts is a tally of windows per size band. Write ONE Repair-phase
  bullet per band with a count above zero, naming that band ("Clean 2 windows – 10–20 SF", then
  "Clean 1 window – 41–60 SF"). Do NOT sum the bands into a single bullet: each band prices
  differently, so a combined line prices the whole room at one band. This is post-construction
  cleaning of glass coated by drywall dust, so it belongs with the repair work, not with emergency
  mitigation. An EMPTY map means the PM was asked and said none — write no bullet, and do not treat
  it as missing data. A null means the question never applied to that room; also write nothing.
- Never write "per IICRC" or any other standards-attribution phrase on an equipment line —
  equipment is PM-stated, not standards-derived, and the document must not imply otherwise. This
  holds even when a quantity came from the moisture-map recommendation: the PM confirmed it, which
  makes it their number, and the document must not cite a standard the PM did not cite.
- An equipment record with a quantity of ZERO is a decision, not a blank. It means the PM was asked
  and answered that none was required in that room, so SAY SO — in the inspection report's DRYING
  STRATEGY/APPROACH section, and in the scope document as an Emergency-phase note under that room
  ("No drying equipment required in this room"). Omitting it would make a deliberate answer
  indistinguishable from a question nobody got round to, which is the exact ambiguity the question
  was added to close. A record that is simply absent stays absent; only an explicit zero gets a
  line. This rule is ONLY about zero — equipment with a real quantity is rendered by auto-included
  item 13 above, in both documents.
- Carpet cleaning, Repair: add a "Carpet cleaning" bullet to a room's Repair section automatically
  whenever any flooring record in that room has disposition LIFT_AND_REINSTALL — the same carpet
  is going back down, so it gets cleaned. Do NOT trigger this off padRemoved alone (see the
  underpad rule right below for why REMOVE_AND_DISPOSE + padRemoved is a different, unrelated
  case). Only one "Carpet cleaning" bullet per room even if more than one flooring record qualifies.
- Underpad + carpet, Repair: whenever a flooring record has disposition LIFT_AND_REINSTALL AND
  padRemoved == true, add two Repair bullets to that same room automatically: "Replace underpad"
  and "Re-kick carpet" (re-kick needs no measurement). Both bullets are specifically about the
  SAME carpet going back down over a new pad — they do not apply to a REMOVE_AND_DISPOSE record
  (a torn-out carpet isn't "re-kicked," a brand new one is simply installed, already covered by
  that record's own Repair bullet — see auto-include 2's note on this same distinction). The
  underpad bullet's quantity follows the same real-number-or-fraction rule as everywhere else:
  "Replace underpad – {padRemovedSF} SF" if that number is present, else "Replace underpad –
  {padRemovedFraction} of the room" if only the fraction is present.
- Final clean, Repair: every room that has at least one Repair-phase bullet at all gets a "Final
  clean" bullet added as the last item in that room's Repair list — this is universal, not tied to
  any specific record type or category.
- Room headings are the room's actual name from the data (roomName), exactly as given — e.g.
  "Living Room," "Kitchen," "Bathroom." Never invent a category-style heading like "Ceiling area,"
  "Flooring," or "Drywall" — every bullet for a room, regardless of which category it came from
  (flooring, walls, ceiling, cabinetry, etc.), goes under that same one room heading alongside
  everything else for that room.
- Only include a room heading in Emergency or Repair if that room actually has at least one
  bullet for that phase.
- Leave one blank line between rooms within a phase (Emergency or Repair) — the room heading plus
  its bullets, a blank line, the next room heading plus its bullets, and so on. Without it every
  room runs directly into the next with no visual break, which reads as cluttered. No blank line
  is needed between a phase's last room and its "General" heading, or between phases.
- Only include the "Asbestos sample collection" line under General if samples were taken.
- Disposal charge stays generic — just "Disposal charge," no dumpster/trailer/container type or
  amount — that's an estimator's call, not something to imply from the data. Only get specific if
  the PM actually stated a type or size in the transcript; otherwise leave it exactly as shown.
- waterCategoryNote, when present, explains why the category is what it is — normally that enough
  days passed between the loss and the inspection for the water to have degraded, and that the PM
  confirmed it. Carry it into the document verbatim as its own sentence in the loss description, so
  a Category 3 on an otherwise clean-water loss arrives with its reason attached rather than as an
  unexplained number an adjuster has to query. When it is absent, say nothing — do not invent a
  rationale for a category that was simply stated.
- Category of loss and Class of loss come from CLAIM CONTEXT's waterCategory/waterClass fields,
  not the completed data's loss.category/loss.class — the claim context values are the
  authoritative, PM-confirmed ones. For a WATER lossType claim these two fields are never blank in
  the output. For any other lossType (FIRE/WIND/HAIL/REMEDIATION/OTHER), waterCategory/waterClass are
  not collected at intake at all and will be null — omit the "Category of loss" and "Class of loss"
  lines from the header entirely in that case, rather than printing them blank or as "N/A".
- Wherever the type of loss is named, use CLAIM CONTEXT's lossTypeDescribed, never the raw lossType
  enum. They differ for one value: lossType OTHER carries the PM's own description in
  lossTypeDescribed ("impact", "vehicle into the building"), and writing the word "Other" on a
  document tells the reader nothing about what happened.

${CATEGORY_PHASE_RULES}

Material detail for the shared-action-field categories above should name the specific item type
and, where captured, the distinguishing detail the data gives you (door type/unit type, cabinetry
grade, countertop material, ceiling finish or tile size, outlet voltage, fixture type, panel
amperage, etc.) — same short-dash format as every other bullet, extent still qualitative.

Ceiling drywall specifically (type DRYWALL_PLASTER, action REMOVE_AND_REPLACE), Repair — this
replaces the generic "{action} – {material detail} – {extent}" pattern with the actual trade
sequence, since a plain "replace ceiling drywall" line hides real, separately-priced steps. First
work out the quantity the normal way: replaceSF ("{replaceSF} SF of ceiling") when present, else
replaceFraction ("{replaceFraction} of the ceiling") when only that's present, else "partial" only
if genuinely neither was captured. The quantity ALWAYS names the ceiling — a bare "120 SF" on a
drywall line does not say which surface it measures, and the estimator cannot tell a ceiling from a
wall run by the number alone. Then:
  - finish SMOOTH (no texture): TWO Repair bullets, in this order:
    1. "Replace drywall – {quantity}" (the drywall install itself).
    2. "Prime & paint ceiling – {quantity}" — a replaced ceiling is primed and painted, exactly as a
       replaced wall is. Use the SAME quantity as the bullet above it; do not apply the wall
       priming multipliers, which are a feather-out allowance for a patch band and have nothing to
       do with a ceiling replaced corner to corner.
  - finish TEXTURE: TWO Repair bullets, always in this order:
    1. "Replace drywall ready for texture – {quantity}" (the drywall install itself — installed
       and prepped, not yet textured).
    2. A second bullet keyed on textureStyle, exact wording:
       - POPCORN: "Scrape & skim coat, prime and spray new texture"
       - KNOCKDOWN: "Skim coat x2, prime and apply new knockdown texture" — note this is
         deliberately NOT a scrape step: unlike popcorn, an existing knockdown ceiling isn't
         scraped first (skim-coating directly over it is the more cost-effective standard
         practice), so never write "scrape" for a knockdown texture bullet.
  Do NOT add a separate priming bullet in the TEXTURE case — its texture bullet already says
  "prime and spray new texture" / "prime and apply new knockdown texture", so a second one would
  bill the same priming twice. Only the SMOOTH case needs its own.

  Emergency for this record is unaffected by any of this — it's still the plain "Remove ceiling
  drywall – {quantity}" from the general shared-action-field rule above; this whole sequence is
  Repair-only.

${EMERGENCY_DERIVATION_RULES}

${SCOPE_PHASE_RULES}

${DGIG_SCOPE_RULES}`;

export const DOCUMENT_GENERATION_SYSTEM_PROMPT = `You generate two documents for a water damage restoration claim from completed structured data:
an inspection report and a scope-of-work document. Match the target formats below EXACTLY —
section headers, field labels, and structure. Do not add sections that aren't in the templates,
and do not omit any section even if its content is thin (use the stated fallback text instead).

${INSPECTION_REPORT_SECTION}

${SCOPE_DOCUMENT_SECTION}`;

/**
 * "Scope document only" mode (see claimInfo.ts's `scopeOnly`) — the same scope-document rules
 * above, minus the inspection report entirely. Used instead of DOCUMENT_GENERATION_SYSTEM_PROMPT
 * whenever `claim.scopeOnly` is true; paired with `scopeOnlyGenerationSchema` (schema.ts) so the
 * model isn't even given an `inspectionReport` property to fill in.
 */
export const SCOPE_ONLY_SYSTEM_PROMPT = `You generate a scope-of-work document for a water damage restoration claim from completed
structured data. Match the target format below EXACTLY — section headers, field labels, and
structure. Do not add sections that aren't in the template, and do not omit any section even if
its content is thin (use the stated fallback text instead).

${SCOPE_DOCUMENT_SECTION}`;

/**
 * `contentsAssignmentNote` (round 8): a client-computed sentence for the inspection report's
 * CONTENTS line, sent only when CONTENTS is selected alongside EMERGENCY and/or REPAIR (see
 * claimInfo.ts's `hasSeparateContents`) — see app/page.tsx's `buildContentsAssignmentNote` for
 * exactly when/how it's built (from the bric-a-brac/T&M contents data, not the transcript). Fixes a
 * real bug: a PM correctly following the "don't mention contents in the transcript, it's handled
 * separately" guidance (also round 8) left the transcript with literally nothing to say about
 * contents, so the model fell back to "To be confirmed with PM" — wrong, since a separate contents
 * assignment already existing IS the confirmed answer. Every other combination passes `null` — a
 * pure CONTENTS selection never reaches this function at all (no inspection report), and the
 * remaining combinations have no separate contents assignment to note in the first place.
 */
export function documentGenerationUserMessage(
  claim: ClaimInfo,
  completedExtraction: WaterLossExtraction,
  transcript: string,
  contentsAssignmentNote: string | null = null,
  /** Only ever non-null for a DGIG claim whose DGIG form has content — see dgig.ts's hasDGIGContent and DGIG_SCOPE_RULES above for what this does to the scope document. */
  dgigData: DGIGData | null = null,
): string {
  // claimNumber/address/pmName/dateOfLoss/yearOfBuilding/dateTimeInspected are deliberately NOT
  // sent here — they only ever fed the JOB INFORMATION section, which this call no longer
  // generates (see INSPECTION_REPORT_SECTION's doc comment). Sending fields the prompt below never
  // references would just be dead payload weight. scopeOnly additionally drops
  // causeOfLoss/preExistingConditions/hasSketch — neither is collected at intake in that mode (see
  // ClaimIntakeForm.tsx), and there's no inspection report being generated to use them anyway.
  const claimContext = claim.scopeOnly
    ? {
        customerName: claim.customerName,
        jobNumber: claim.jobNumber,
        insurer: claim.insurer,
        lossType: claim.lossType,
        // "OTHER" alone means nothing to a reader — see `lossTypeLabel`.
        lossTypeDescribed: lossTypeLabel(claim),
        waterClass: claim.waterClass,
        waterCategory: claim.waterCategory,
        waterCategoryNote: claim.waterCategoryNote,
        scopePhases: modelScopePhases(claim),
        // null unless this is a DGIG claim whose DGIG form has content — see DGIG_SCOPE_RULES.
        dgigData,
      }
    : {
        customerName: claim.customerName,
        jobNumber: claim.jobNumber,
        insurer: claim.insurer,
        lossType: claim.lossType,
        // "OTHER" alone means nothing to a reader — see `lossTypeLabel`.
        lossTypeDescribed: lossTypeLabel(claim),
        causeOfLoss: claim.causeOfLoss,
        preExistingConditions: claim.preExistingConditions,
        waterClass: claim.waterClass,
        waterCategory: claim.waterCategory,
        waterCategoryNote: claim.waterCategoryNote,
        scopePhases: modelScopePhases(claim),
        // Phase 1 web has no sketch feature — always false, same as the Android app's today
        // (Create Sketch is a mocked/demo feature there too). The instructions above already
        // handle this correctly: the SKETCH section is only emitted when this is true.
        hasSketch: false,
        // null unless CONTENTS is selected alongside EMERGENCY/REPAIR — see this function's doc comment.
        contentsAssignmentNote,
        // null unless this is a DGIG claim whose DGIG form has content — see DGIG_SCOPE_RULES.
        dgigData,
      };

  if (claim.scopeOnly) {
    return `Generate the scope document only, from this data — there is no inspection report to generate.

CLAIM CONTEXT — every field here is the authoritative source for its corresponding scope-document
field, never inferred or overridden from the transcript or the completed data: waterClass/
waterCategory for "Category of loss"/"Class of loss" (not the completed data's
loss.category/loss.class; null for a non-WATER lossType — see the header notes), lossType for
whether this is a water claim at all, scopePhases for which phase(s) to render (see
SCOPE_PHASE_RULES), and dgigData (when present) for overriding the Emergency section (see
DGIG_SCOPE_RULES):
${JSON.stringify(claimContext)}

COMPLETED WATER LOSS DATA (the scope's structured data — flooring/baseboard/wall/equipment per
room, gap-check already resolved):
${JSON.stringify(completedExtraction)}

ORIGINAL TRANSCRIPT (supplementary detail — specifics the PM stated that the structured data above
has no dedicated field for, e.g. a disposal container type or size):
${transcript}`;
  }

  return `Generate both documents from this data.

CLAIM CONTEXT — every field here is the authoritative source for its corresponding report field,
never inferred or overridden from the transcript or the completed data: waterClass/waterCategory
for the scope document's "Category of loss"/"Class of loss" (not the completed data's
loss.category/loss.class; null for a non-WATER lossType — see the header notes), lossType for
whether this is a water claim at all, scopePhases for which phase(s) the scope document renders
(see SCOPE_PHASE_RULES), dgigData (when present) for overriding the Emergency section (see
DGIG_SCOPE_RULES), causeOfLoss for CAUSE OF LOSS, preExistingConditions for
PRE-EXISTING CONDITIONS, and contentsAssignmentNote (when present) for the inspection report's
CONTENTS line — see the note on that field in INSPECTION_REPORT_SECTION above. (Job Information —
insured, address, claim number, PM, year of building, date of loss, date/time inspected — is
rendered directly from claim state in the UI now, not generated here; see
components/JobInformationSection.tsx.)
${JSON.stringify(claimContext)}

COMPLETED WATER LOSS DATA (the scope's structured data — flooring/baseboard/wall/equipment per
room, gap-check already resolved):
${JSON.stringify(completedExtraction)}

ORIGINAL TRANSCRIPT (supplementary detail for CAUSE OF LOSS, plus the only source for CONTENTS'
prose — that's the one section left with no dedicated field in the structured data above, aside
from also drawing on rooms[].contents where present):
${transcript}`;
}
