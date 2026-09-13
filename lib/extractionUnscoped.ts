import type { Room, UnscopedItem, WaterLossExtraction } from "./types";
import { APPLIANCE_LABEL, DOOR_STYLE_LABEL, SUBFLOOR_LABEL, TRIM_KIND_LABEL, WINDOW_COVERING_LABEL, isInjectionEquipment } from "./types";

/**
 * The third extraction call: what did the first two miss?
 *
 * ── Why a call of its own ────────────────────────────────────────────────────────────────────────
 *
 * It was going to be one more list on the detail pass. One string array tipped call 2 over the
 * compiled-grammar ceiling — the same ceiling call 1 hit long ago — and because that pass is
 * fail-soft, the failure was a trace with no trim, no appliances, no subfloor and no error. So call
 * 2 is now full too, and this is a separate call with a schema of one string array, which no
 * ceiling will mind.
 *
 * It is the better shape anyway. Asking a pass to fill fields AND notice what it could not fill is
 * asking it to do two jobs at once. This call does one: it is shown the transcript and a plain list
 * of everything the first two calls captured, room by room, and asked for the work that is not on
 * the list. It cannot duplicate what it can see, which is the failure the old design had to be
 * warned against in prose.
 *
 * ── What comes back ──────────────────────────────────────────────────────────────────────────────
 *
 * Per room, in the PM's own words, every piece of work with no home in the tree. Each arrives with
 * no disposition: the gap-check shows it to the PM, who places it in a phase or drops it. See
 * `UnscopedItem` in types.ts for why the item exists and `unscopedQuestions` in gapCheck.ts for the
 * question.
 */

export const EXTRACTION_UNSCOPED_SYSTEM_PROMPT = `You are the last pass over a restoration project manager's dictated walkthrough of a water loss.

Two earlier passes have already turned the walkthrough into structured records — flooring, walls,
doors, cabinetry, equipment and so on. You will be shown, room by room, a plain list of EVERYTHING
those passes captured. Your one job: find the WORK the PM described that is NOT on that list, and
return it, room by room, in the PM's own words.

WHAT COUNTS AS WORK: something a crew does, that the PM said is to be done. Removing tile and the
backer board behind it. Replacing outlets. Sanding and refinishing stair treads. Rebuilding a
built-in bench. Pressure washing a deck. Any task, on any material, in any trade.

WHAT DOES NOT COUNT:
- Anything already on the captured list for that room, in any form. If the list says the vinyl is
  coming out, "remove the vinyl" is not missing. If the list has a subfloor coming out, the sleepers
  are not missing. Read the list carefully before deciding something is absent.
- Observations, readings and history: how wet something is, where the water came from, what the
  PM saw, the category and class, what happened last week.
- Equipment, contents and drying — those have fields and are on the list when present.
- Anything the PM did not say. Never infer work from damage; the PM decides what is done.

HOW TO WRITE EACH ITEM: one short line per piece of work, in the PM's terms, with the location if
they gave one. "Remove tub-surround tile and the soaked backer board behind it". "Replace two outlets
on the wet wall". Do not add quantities the PM did not state, do not split one job into several,
do not merge two jobs into one.

Return exactly one entry per room, in the order given, with an empty array for a room where
everything the PM said had a home — which is most rooms on most claims. An empty array is the
normal answer, not a failure.`;

/** Everything a room holds, as a list a reader can scan — the "already captured" half of the question. */
export function capturedSummary(room: Room): string[] {
  const out: string[] = [];
  const nat = (v: string | null | undefined) => (v ? v.toLowerCase().replace(/_/g, " ") : null);
  const push = (...parts: (string | null | undefined)[]) => out.push(parts.filter(Boolean).join(" — "));

  for (const f of room.flooring) push("flooring", nat(f.type) ?? "type not stated", nat(f.disposition) ?? "disposition not stated", f.cleaningRequired ? "cleaned" : null);
  for (const s of room.subfloor) push("subfloor", s.type ? SUBFLOOR_LABEL[s.type] : "kind not stated", nat(s.disposition));
  for (const b of room.baseboard) push("baseboard", nat(b.material), nat(b.action), b.shoeMold ? "with shoe mold" : null);
  for (const w of room.walls) push("wall", w.drywallBeingRemoved ? "drywall coming out" : "drywall staying", w.insulationAffected ? "insulation affected" : null);
  for (const c of room.ceilings) push("ceiling", nat(c.type), nat(c.action), c.aboveInsulationAffected ? "insulation above affected" : null);
  for (const d of room.doors) push("door", d.location, d.doorStyle ? DOOR_STYLE_LABEL[d.doorStyle] : null, nat(d.action), d.saveHardware ? "hardware saved and reset" : null);
  for (const t of room.trim) push("trim", TRIM_KIND_LABEL[t.kind].toLowerCase(), t.location, nat(t.action));
  for (const c of room.cabinetry) push("cabinetry", c.location, nat(c.action), c.shoringRequired ? "shoring" : null);
  for (const h of room.cabinetHardware) push("cabinet hardware", h.location, nat(h.action));
  for (const c of room.countertops) push("countertop", nat(c.material), nat(c.action));
  for (const t of room.toeKicks) push("toe kick", nat(t.action));
  for (const p of room.plumbingFixtures) {
    push(
      "plumbing fixture", nat(p.fixtureType), nat(p.action),
      p.topDetached || p.topKept ? "countertop detached and reset" : null,
      p.sinkFaucetSaved ? "sink and faucet saved" : null,
      p.includesSurround ? "with surround" : null,
    );
  }
  for (const t of room.wallTile) push("wall tile", nat(t.surface), "remove and replace");
  for (const o of room.outlets) push("outlet or switch", nat(o.action));
  for (const l of room.lightFixtures) push("light fixture", nat(l.action));
  if (room.electricalPanel) push("electrical panel");
  if (room.stairs) push("stairs");
  for (const w of room.windowCoverings) push("window covering", WINDOW_COVERING_LABEL[w.type], w.location, nat(w.action));
  for (const a of room.appliances) push("appliance", APPLIANCE_LABEL[a.type], nat(a.action));
  for (const e of room.equipment) push("equipment", e.type, e.quantity !== null ? `× ${e.quantity}` : null, e.holeCount !== null ? `${e.holeCount} injection holes drilled and filled` : isInjectionEquipment(e.type) ? "injection holes drilled and filled" : null);
  if (room.floorRegistersDetached) push("floor registers", `× ${room.floorRegistersDetached}`);
  if (room.windowCleaningCounts) push("windows cleaned after drywall work");
  if (room.ceilingLightFixturesPresent) push("ceiling light fixtures");
  if (room.contents) push("contents", room.contents.manipulationDeclined ? "left in place" : "moved");
  if (room.waterExtractionRequired) push("water extraction");
  if (room.antimicrobialApplied) push("antimicrobial");
  if (room.containmentRequired) push("containment");
  if (room.hepaVacuumingRequired) push("HEPA vacuuming");
  if (room.temporaryPowerRequired) push("temporary power");
  return out;
}

/**
 * The rooms in order, each with its captured list, then the transcript. The order matters: the
 * reply is positional, and `mergeUnscoped` trusts it only when the count matches.
 */
export function extractionUnscopedUserMessage(transcript: string, extraction: WaterLossExtraction): string {
  const rooms = extraction.rooms
    .map((room, i) => {
      const captured = capturedSummary(room);
      const list = captured.length === 0 ? "    (nothing captured for this room)" : captured.map((line) => `    - ${line}`).join("\n");
      return `${i + 1}. ${room.roomName}\n${list}`;
    })
    .join("\n\n");

  return `Rooms in order, each with everything already captured. Return exactly ${extraction.rooms.length} entries, in this order.

${rooms}

Transcript:

${transcript}`;
}

export interface ExtractionUnscopedWire {
  rooms: { unscoped: string[] }[];
}

/** The PM's words, tidied of whitespace and nothing else, blanks and duplicates gone. */
function tidy(items: unknown): string[] {
  const list = Array.isArray(items) ? items : [];
  return Array.from(new Set(list.map((u) => (typeof u === "string" ? u.replace(/\s+/g, " ").trim() : "")).filter((u) => u !== "")));
}

/**
 * Attaches what came back, room by room.
 *
 * Positional, like the detail pass, and with the same rule: a reply with the wrong number of rooms
 * is discarded whole rather than attaching one room's missed work to another. A room that already
 * carries items keeps them — a re-run never resets a decision the PM has made.
 */
export function mergeUnscoped(extraction: WaterLossExtraction, wire: ExtractionUnscopedWire): WaterLossExtraction {
  if (!wire || !Array.isArray(wire.rooms) || wire.rooms.length !== extraction.rooms.length) return extraction;
  return {
    ...extraction,
    rooms: extraction.rooms.map((room, i) => {
      if (room.unscoped.length > 0) return room;
      const items: UnscopedItem[] = tidy(wire.rooms[i]?.unscoped).map((description) => ({ description, disposition: null }));
      return items.length === 0 ? room : { ...room, unscoped: items };
    }),
  };
}

/** Nothing to compare against for a claim with no rooms. */
export function needsUnscopedPass(extraction: WaterLossExtraction): boolean {
  return extraction.rooms.length > 0;
}
