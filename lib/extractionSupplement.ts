import type { AreaFraction, FlooringRecord, Room, WaterLossExtraction } from "./types";

/**
 * The fourth extraction call: spec fields the detail pass has no room for.
 *
 * ── Why a fourth call ────────────────────────────────────────────────────────────────────────────
 *
 * Call 1 has been full since 2026-09-02. Call 2 was proved full on 2026-09-13 twice in one day:
 * first by a string array (the unscoped sweep, now call 3), then by the four fields below — three
 * enums and a bool, the cheapest shapes there are. Both times the failure was the detail pass dying
 * soft, which is why the route now reports a failed pass and the harness shouts about it.
 *
 * So this is the second detail pass, and the place the NEXT spec field goes. It has the same shape
 * as call 2 — one entry per room in call 1's order, one entry per flooring record in its order —
 * and the same rule: a reply whose counts do not match is discarded whole rather than misapplied.
 * It runs in parallel with the sweep, so it costs money but not time.
 *
 * ── What it carries today ────────────────────────────────────────────────────────────────────────
 *
 * Both are the auditor's ASKED_ANYWAY findings on the control transcript: the app asked "how much
 * vinyl is being removed?" after the PM said "the whole room", and asked "was water extraction
 * required?" and "how much?" after the PM said "we extracted standing water off the whole floor".
 * A number goes in the SF field, words go in the fraction, never both — exactly one of the pair is
 * ever set, which is what AreaFraction has always meant.
 */

export const EXTRACTION_SUPPLEMENT_SYSTEM_PROMPT = `You are completing a further pass over a restoration project manager's dictated walkthrough of a
water loss. Earlier passes have already identified the rooms and their flooring records. You fill in
a small set of fields about extent that those passes had no room for.

RULES:
- Return exactly one entry per room, in the order given, and within each room exactly one entry per
  flooring record, in the order given. The counts are stated below. If a count does not match, the
  whole reply is discarded, so match them exactly even where every field is UNKNOWN.
- Only what the transcript says. Never estimate, never infer an extent from damage, never infer the
  whole room from a removal described as partial.
- A number and a fraction are alternatives, never both. Dimensions ("six by eight") are multiplied
  out into the SF field. Words ("the whole room") go in the fraction field. When a number was given,
  the fraction is UNKNOWN.

WHAT EACH FIELD MEANS:
- flooring.removalFraction — the extent of THAT floor's removal when the PM states it in words:
  "the whole room", "all of it", "the full floor", "wall to wall" → FULL; "about half", "half the
  room" → HALF; "most of it", "three quarters" → THREE_QUARTERS; "a corner", "a quarter of it",
  "a small area" → QUARTER. UNKNOWN when a number or dimensions were given, and when nothing about
  extent was said. Only for a floor being removed.
- waterExtractionRequired — room-level. YES when the transcript says water was extracted, pulled,
  vacuumed or pumped off the floor in this room: "we extracted standing water", "extracted the
  carpet", "pulled about forty gallons". NO when it says there was nothing to extract: "no standing
  water", "dry by the time we got there". UNKNOWN when extraction never comes up, which is common —
  a wet floor is not evidence it was extracted.
- waterExtractionSF and waterExtractionFraction — the extent of that extraction, on the same terms:
  a number or dimensions → SF (multiplied out); words → fraction ("the whole floor", "the entire
  room" → FULL, and so on); the sentinel (-1) and UNKNOWN when only "extracted" was said with no
  extent. Only meaningful with waterExtractionRequired YES.`;

/** The per-room counts written out, so the model has an explicit target rather than a second reading of the transcript. */
export function extractionSupplementUserMessage(transcript: string, extraction: WaterLossExtraction): string {
  const rooms = extraction.rooms.map((room, i) => `${i + 1}. ${room.roomName} — ${room.flooring.length} flooring`).join("\n");
  return `Rooms already identified, in order. Return exactly this many entries, in exactly this order, with exactly these flooring counts:

${rooms}

Transcript:

${transcript}`;
}

export interface FlooringSupplementWire {
  removalFraction: string;
}
export interface RoomSupplementWire {
  flooring: FlooringSupplementWire[];
  waterExtractionRequired: string;
  waterExtractionSF: number;
  waterExtractionFraction: string;
}
export interface ExtractionSupplementWire {
  rooms: RoomSupplementWire[];
}

function fractionOrNull(value: string | undefined): AreaFraction | null {
  return value === "QUARTER" || value === "HALF" || value === "THREE_QUARTERS" || value === "FULL" ? value : null;
}

function toTriState(s: string | undefined): boolean | null {
  if (s === "YES") return true;
  if (s === "NO") return false;
  return null;
}

/** An area — fractional allowed, zero and the negative sentinel are "not stated". Same rule as the detail pass. */
function areaOrNull(n: number | undefined): number | null {
  return n === undefined || !Number.isFinite(n) || n <= 0 ? null : n;
}

/**
 * A flooring record's stated extent in words: only onto a floor being removed, only where no number
 * has landed, and never over a value already there. The SF gate looks at the record's merged number,
 * because a transcript giving both "six by eight" and "the whole room" for one floor is
 * contradictory and the number is the one an estimator can use.
 */
function removalFractionFor(f: FlooringRecord, detail: FlooringSupplementWire | undefined): AreaFraction | null {
  const removing = f.disposition === "REMOVE_AND_DISPOSE" || f.disposition === "REMOVE_AND_ASSESS";
  if (!removing || f.removalSF !== null) return f.removalFraction;
  return f.removalFraction ?? fractionOrNull(detail?.removalFraction);
}

/**
 * Water extraction as one decision across three fields. The extent lands only once extraction is
 * known to have happened — an area for extraction nobody did is a number about nothing — and the
 * number wins over the fraction, as with flooring.
 */
function waterExtractionFor(room: Room, d: RoomSupplementWire | undefined): Pick<Room, "waterExtractionRequired" | "waterExtractionSF" | "waterExtractionFraction"> {
  const required = room.waterExtractionRequired ?? toTriState(d?.waterExtractionRequired);
  if (required !== true) return { waterExtractionRequired: required, waterExtractionSF: room.waterExtractionSF, waterExtractionFraction: room.waterExtractionFraction };
  const sf = room.waterExtractionSF ?? areaOrNull(d?.waterExtractionSF);
  const fraction = sf !== null ? null : room.waterExtractionFraction ?? fractionOrNull(d?.waterExtractionFraction);
  return { waterExtractionRequired: true, waterExtractionSF: sf, waterExtractionFraction: fraction };
}

/**
 * Attaches the reply, positionally. `existing ?? fromSupplement` throughout — nothing here ever
 * overwrites a value call 1, call 2 or the PM has already set — and a room whose flooring count
 * came back wrong is left exactly as it was.
 */
export function mergeSupplement(extraction: WaterLossExtraction, wire: ExtractionSupplementWire): WaterLossExtraction {
  if (!wire || !Array.isArray(wire.rooms) || wire.rooms.length !== extraction.rooms.length) return extraction;
  return {
    ...extraction,
    rooms: extraction.rooms.map((room, i) => {
      const d = wire.rooms[i];
      const flooring = Array.isArray(d?.flooring) ? d.flooring : [];
      if (!d || flooring.length !== room.flooring.length) return room;
      return {
        ...room,
        flooring: room.flooring.map((f, j) => ({ ...f, removalFraction: removalFractionFor(f, flooring[j]) })),
        ...waterExtractionFor(room, d),
      };
    }),
  };
}

/** Nothing to fill in for a claim with no rooms. */
export function needsSupplementPass(extraction: WaterLossExtraction): boolean {
  return extraction.rooms.length > 0;
}
