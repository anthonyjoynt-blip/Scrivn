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
- lightFixturesPresent and lightFixtureCount are room-level: one value each per room entry, not
  arrays and not per record.
- If a count does not match, the whole room's detail is discarded rather than misapplied, so match
  the counts exactly even where every field in an entry is UNKNOWN.

WHAT EACH FIELD MEANS:
- flooring.hardwoodConstruction — only for hardwood: SOLID or ENGINEERED, where the transcript says.
- flooring.hardwoodInstallation — only for hardwood: FLOATING or GLUED. "Glued down" is GLUED.
- flooring.vinylInstallation — only for vinyl PLANK: GLUED or SNAPLOCK_FLOATING. "Click-lock",
  "floating" and "snap together" are all SNAPLOCK_FLOATING. UNKNOWN for sheet vinyl, which is glued
  by definition and is never asked about.
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
