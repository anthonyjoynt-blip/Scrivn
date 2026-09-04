import type { WaterLossExtraction } from "./types";

/**
 * Step 1b: the detail pass.
 *
 * Runs after `extractionPrompt.ts` has established the rooms and the records in them, and describes
 * those records — nothing new. See `schema.ts`'s detail-pass block for why this is a second call at
 * all rather than more fields on the first.
 *
 * The whole design rests on position: this returns a parallel array, so it never has to repeat a
 * room name or an action, which is exactly what keeps its grammar small enough to compile. The cost
 * is that alignment has to be right, so the counts are stated per room below and `mergeDetail`
 * discards anything that comes back a different shape.
 */

export const EXTRACTION_DETAIL_SYSTEM_PROMPT = `You are completing a second pass over a restoration project manager's dictated walkthrough of a
water damage loss. A first pass has already identified the rooms and the items in them. Your only
job is to fill in specification detail for those items — what material, what finish, how high — for
the items you are told exist. You are not finding new rooms or new items.

The schema has no null values. "Not stated" is an explicit sentinel, never an omission or a guess:
- Enum fields: the literal string "UNKNOWN".
- Boolean-like fields (aboveInsulationAffected): exactly "YES", "NO", or "UNKNOWN".
Use the sentinel any time the transcript did not address that specific detail. Never guess a value
because it seems typical — a PM who did not say is a question somebody asks them later, and a guess
here is indistinguishable from something they actually said.

STRUCTURE — this is what makes the answer usable at all:
- Return exactly one entry in "rooms" per room listed below, in the SAME ORDER as that list.
- Within each room, return exactly one entry per record, in the same order, for each of flooring,
  baseboard, walls, ceilings, doors and cabinetry. The counts are given per room below. A room with
  zero of something gets an empty array for it.
- lightFixturesPresent, lightFixtureCount, antimicrobialApplied, containmentRequired, containmentSF,
  hepaVacuumingRequired and appliances are room-level: one value each per room entry, not
  arrays and not per record.
- If a count does not match, the whole room's detail is discarded rather than misapplied, so match
  the counts exactly even where every field in an entry is UNKNOWN.

WHAT EACH FIELD MEANS:
- flooring.hardwoodConstruction — only for hardwood: SOLID, ENGINEERED, PREFINISHED, or OTHER.
  "Prefinished" is its own construction, not a finish on solid or engineered. Use OTHER only when the
  transcript names a construction that is genuinely none of the three — never as a catch-all for
  something you are unsure about, which is what UNKNOWN is for.
- flooring.hardwoodInstallation — only for hardwood: FLOATING, GLUED or NAILED. "Glued down" is
  GLUED; "nailed down" or "nail down" is NAILED; "floating" is FLOATING.
- flooring.vinylInstallation — only for vinyl PLANK: GLUED or SNAPLOCK_FLOATING. "Click-lock",
  "floating" and "snap together" are all SNAPLOCK_FLOATING. UNKNOWN for sheet vinyl, which is glued
  by definition and is never asked about.
- flooring.removalSF — how much of that floor is being taken out, in square feet, for EVERY
  flooring type. Two forms count as stated, and both must be captured:
    · an area given directly — "about 120 square feet of laminate", "200 SF of tile" — use the number.
    · dimensions given for the affected area — "six by eight feet", "a 10' x 12' section",
      "roughly 6 by 8" — MULTIPLY them and return the product (6 by 8 → 48). Return the area, never
      one of the dimensions, and never the pair.
  Applies only to a floor being removed, not one being lifted and reinstalled. Use the sentinel
  (-1) when the transcript describes the area only in words — "a small area at the dishwasher",
  "the wet part by the door", "most of the room" — with no number and no dimensions behind it.
  A qualitative phrase is NOT an area: do not estimate one from it, and do not infer the whole
  room's floor from a removal described as partial. Somebody asks the PM for the figure later,
  which is a far better outcome than a number nobody said appearing in an insurer's scope.
- flooring.cleaningRequired — YES when the transcript says that floor is being CLEANED, treated,
  scrubbed, washed down or sanitised rather than removed. "The concrete just needs to be cleaned and
  treated" is YES; "wipe down the tile" is YES. NO only when it says the floor needs no cleaning.
  UNKNOWN when the transcript does not address it. This is about the floor SURFACE itself, not the
  final clean at the end of a job and not carpet cleaning after a lift-and-reinstall, both of which
  are added automatically elsewhere — do not set YES just because a job will obviously be tidied up.
- antimicrobialApplied — room-level, one value per room, not per record. YES when the transcript says
  antimicrobial, anti-microbial, biocide or a sanitising agent is being applied in this room.
  "Antimicrobial throughout both spaces" is YES for BOTH rooms — a phrase covering the whole job
  applies to every affected room, not only the one named nearest to it. NO only when it says
  antimicrobial is not being used. UNKNOWN when the transcript never raises it: a category 3 loss
  usually gets antimicrobial, but "usually" is not "stated", and a line nobody asked for on an
  insurer's scope is worse than one somebody has to add.
  On a WATER loss, "deodorising", "deodorization" and "odour treatment" mean this — applying an
  antimicrobial — so record them as YES here. (They mean something genuinely different on a fire or
  trauma job, which this schema does not cover; if the transcript plainly describes a fire, leave
  this UNKNOWN rather than recording a treatment that is not what was meant.)
- containmentRequired — room-level. YES when the transcript describes containment, a poly barrier, a
  zip wall, sealing a room or area off, or hanging plastic to separate the work area. NO when it says
  none is needed. UNKNOWN when it never comes up.
- containmentSF — the square feet of BARRIER, where a size is stated. Dimensions are multiplied out
  the same way as flooring: "an 8 by 10 poly wall" is 80. Sentinel (-1) when containment is described
  with no size, which is the ordinary case — somebody asks for the figure later. Never estimate
  barrier area from a room's dimensions: a barrier is hung across an opening, and its size has
  nothing to do with how big the room is.
- hepaVacuumingRequired — room-level. YES when the transcript says HEPA vacuuming, HEPA vac, or
  vacuuming with a HEPA unit is being done in this room. NO when it says it is not. UNKNOWN
  otherwise. Do not infer it from a category 3 loss or from cleaning generally, and do not confuse it
  with an air scrubber, which is equipment and is captured separately.
- appliances — room-level, and the ONE list you produce outright rather than one entry per existing
  record: return an entry for each appliance the transcript says is being moved, pulled out, detached,
  or taken out to work behind or under, and an empty array when it names none. Allowed types:
  WASHER, DRYER, FRIDGE, RANGE, DISHWASHER, BUILT_IN_OVEN, COOKTOP, RANGE_HOOD, BUILT_IN_MICROWAVE.
  "Stove" is RANGE; "refrigerator" is FRIDGE; a wall oven is BUILT_IN_OVEN; an over-the-range
  microwave is BUILT_IN_MICROWAVE. Only appliances actually being handled — an appliance merely
  mentioned as being in the room ("the washer is in the corner") is not one being detached. There is
  no action to record: a restoration contractor detaches and resets these, never replaces them.
- doors.doorType — COLONIAL, SOLID_CORE, HOLLOW_CORE or OTHER, where the transcript names it.
- doors.unitType — PRE_HUNG or SLAB_ONLY. "Just the slab" is SLAB_ONLY; "pre-hung unit" is PRE_HUNG.
- cabinetry.extent — UPPERS, LOWERS or FULL_HEIGHT. "Upper cabinets" is UPPERS, "the base run" or
  "lowers" is LOWERS, a floor-to-ceiling pantry or tall unit is FULL_HEIGHT.
- lightFixturesPresent — YES when the transcript describes ANY ceiling light fixture in this room
  being taken down, reset, replaced or affected — "there's a light fixture on the bedroom ceiling to
  take down and put back" is YES. NO only when it says there are none. This is room-level, one value
  for the whole room, not per record.
- lightFixtureCount — how many of them, where a number is stated. Sentinel (-1) otherwise; do not
  infer "one" from a singular noun, since a PM saying "the light fixture" may mean the only one they
  happened to mention.
- flooring.carpetStyle — only for carpet. "Berber" is BERBER, "plush"/"cut pile"/"pile" is PILE,
  a glue-down rubber-backed commercial carpet is RUBBER_BACKED_GLUE_DOWN. UNKNOWN for any
  non-carpet flooring, and for carpet whose style was never named.
- baseboard.material — SOLID_WOOD, MDF, or VINYL_PVC_COMPOSITE. "Vinyl baseboard" and
  "PVC base" are VINYL_PVC_COMPOSITE.
- baseboard.mdfProfile — only when the material is MDF: FLAT for a plain flat stock, PROFILE for a
  moulded or colonial profile. UNKNOWN otherwise.
- walls.cutHeight — how high the drywall flood cut runs. BASE for a base-height cut (up to about
  4 inches), TWO_FOOT for roughly two feet, FOUR_FOOT for roughly four feet, FULL_WALL for floor to
  ceiling. "Flood cut, going up about two feet" is TWO_FOOT. UNKNOWN if a cut was described with no
  height, or if no drywall is being removed from that wall.
- walls.insulationType — the insulation in the wall cavity, where the transcript names it.
  BLOWN_IN is loose fill blown into the cavity; CELLULOSE only when cellulose is named specifically.
- ceilings.textureStyle — POPCORN or KNOCKDOWN, only where the transcript names the texture.
- ceilings.aboveInsulationAffected — whether the insulation ABOVE the ceiling (in the attic, joist
  bay or space above) is wet or being removed. "Insulation above is soaked, all of that's coming out
  too" is YES. NO only when the transcript says the space above was checked and is dry. This is a
  DIFFERENT thing from the wall cavity insulation — a transcript can state one and not the other, so
  never carry an answer across between them.
- ceilings.aboveInsulationType — the type of that insulation above the ceiling, where named.`;

/**
 * The per-room record counts, written out so the model has an explicit target to match rather than
 * inferring the shape from the transcript a second time.
 */
export function extractionDetailUserMessage(transcript: string, extraction: WaterLossExtraction): string {
  const rooms = extraction.rooms
    .map((room, i) => {
      const counts = [
        `${room.flooring.length} flooring`,
        `${room.baseboard.length} baseboard`,
        `${room.walls.length} wall`,
        `${room.ceilings.length} ceiling`,
        `${room.doors.length} door`,
        `${room.cabinetry.length} cabinetry`,
      ].join(", ");
      return `${i + 1}. ${room.roomName} — ${counts}`;
    })
    .join("\n");

  return `Rooms already identified, in order. Return exactly this many entries, in exactly this order, with exactly these per-record counts:

${rooms}

Transcript:

${transcript}`;
}
