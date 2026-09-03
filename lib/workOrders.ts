import type { ClaimInfo } from "./claimInfo";
import type { BricABracData } from "./bricABrac";
import { BOX_ITEMS, CONTENT_SIZE_OPTIONS } from "./bricABrac";
import type { ContentsTM } from "./contentsTM";
import { CONSUMABLE_ITEMS, DISPOSAL_OPTIONS } from "./contentsTM";
import { buildContentCleaningSection } from "./contentCleaning";
import type { DGIGData } from "./dgig";
import { DRYING_CLASS_OPTIONS } from "./dgig";
import { isDGIG } from "./insurers";
import { lossTypeLabel } from "./claimInfo";
import { baseboardFinishLine, ceilingPaintLine, ceilingQuantity, fractionLabel, primingLine } from "./paintDerivation";
import type { CeilingRecord, FlooringRecord, Room, WaterLossExtraction } from "./types";
import { WINDOW_CLEANING_SIZE_LABEL, WINDOW_CLEANING_SIZES } from "./types";

/**
 * Trade work orders — the crew-facing counterpart to the estimator-facing scope document.
 *
 * Rendered entirely client-side from data that already exists (the completed extraction, the
 * contents models, the DGIG form). There is deliberately no API call here: every line is a
 * re-presentation of something already captured, so generating a work order can never re-run
 * extraction or cost a claim against the usage cap.
 *
 * Trade assignment is a static lookup below, NOT an extracted field. Adding a `trade` property to
 * the record types would mean growing the extraction schema, which is already at Structured
 * Outputs' compiled-grammar ceiling — see lib/schema.ts.
 *
 * Categories with no live extraction path (outlets, light fixtures, electrical panel, wall tile,
 * stairs, most plumbing fixtures) simply produce no lines. That's expected: extraction never
 * populates them, so there is nothing to route.
 */
export type Trade = "MITIGATION_DEMO" | "DRYWALL" | "PAINTING" | "FINISH_CARPENTRY" | "CONTENTS_PACK_OUT" | "CONTENTS_PACK_BACK";

export const TRADE_LABEL: Record<Trade, string> = {
  MITIGATION_DEMO: "Mitigation & Demo",
  DRYWALL: "Drywall",
  PAINTING: "Painting",
  FINISH_CARPENTRY: "Finish Carpentry",
  CONTENTS_PACK_OUT: "Contents Pack Out",
  CONTENTS_PACK_BACK: "Contents Pack Back",
};

/** Which contents model the claim used — decides whether Pack Back is offerable at all. */
export type ContentsApproach = "TM" | "BRIC_A_BRAC";

/**
 * The trades worth offering for this claim, filtered by which phases are actually being scoped.
 *
 * Pack Back is the one conditional that isn't purely phase-based: the Time & Material model has an
 * explicit `packBackHours` field, so a pack-back order has real content. The bric-a-brac model has
 * no equivalent — it counts boxes and rooms, with nothing describing the return trip. Offering it
 * there would mean inventing hours, so it isn't offered.
 */
export function availableTrades(claim: ClaimInfo, contentsApproach: ContentsApproach): Trade[] {
  const phases = claim.scopePhases;
  const trades: Trade[] = [];
  if (phases.includes("EMERGENCY")) trades.push("MITIGATION_DEMO");
  if (phases.includes("REPAIR")) trades.push("DRYWALL", "PAINTING", "FINISH_CARPENTRY");
  if (phases.includes("CONTENTS")) {
    trades.push("CONTENTS_PACK_OUT");
    if (contentsApproach === "TM") trades.push("CONTENTS_PACK_BACK");
  }
  return trades;
}

/** Why a trade the PM might expect isn't listed — shown under the selector rather than leaving a silent gap. */
export function unavailableTradeNote(claim: ClaimInfo, contentsApproach: ContentsApproach): string | null {
  if (claim.scopePhases.includes("CONTENTS") && contentsApproach === "BRIC_A_BRAC") {
    return "Contents Pack Back isn’t offered for a bric-a-brac contents scope — that model records boxes and room sizes, with no pack-back hours to build an order from. Use the Time & Material contents approach if you need one.";
  }
  return null;
}

// ---- shared rendering helpers ----------------------------------------------------------------

/** Non-empty lines only — keeps every builder from repeating the same filter. */
function lines(...parts: (string | null | undefined)[]): string[] {
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "");
}

/**
 * Generic enum → prose. Fine for values that are ordinary words (VINYL, CARPET, FIBERGLASS_BATT);
 * anything containing an acronym needs an explicit label below, since this would render MDF as
 * "Mdf" on a sheet a trade actually reads.
 */
function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Explicit labels where title-casing would mangle an acronym or read awkwardly. */
const BASEBOARD_MATERIAL_LABEL: Record<string, string> = {
  MDF: "MDF",
  SOLID_WOOD: "Solid wood",
  VINYL_PVC_COMPOSITE: "Vinyl/PVC composite",
};

const CEILING_TYPE_LABEL: Record<string, string> = {
  DRYWALL_PLASTER: "Drywall/plaster",
  SUSPENDED_TILE: "Suspended tile",
};

/** Qualitative extent for a flooring record — the crew needs scale, not the estimator's exact spec. */
function flooringExtent(f: FlooringRecord): string | null {
  if (f.carpetLiftSF !== null) return `${f.carpetLiftSF} SF`;
  const fraction = fractionLabel(f.carpetLiftFraction);
  return fraction ? `${fraction} of the room` : null;
}

/*
  Shared with the scope document via `ceilingQuantity` — a bare "120 SF" on a line that never names
  its surface is the one an estimator has to come back and ask about, and the fraction branch had
  always said "of the ceiling" while the measured branch did not.
*/
function ceilingExtent(c: CeilingRecord): string | null {
  if (c.replaceSF === null && c.replaceFraction === null) return null;
  return ceilingQuantity(c);
}

/** "Action – detail – extent", skipping whichever parts are unknown. */
function bullet(...parts: (string | null | undefined)[]): string {
  return `    - ${parts.filter((p) => p && p !== "").join(" – ")}`;
}

/**
 * The header every work order carries. PM phone has no data source yet — it's slated to come from
 * the user profile (profiles.phone) once that's wired through to the claim, and renders as a blank
 * line for now rather than being silently dropped, so a crew can see it's missing rather than
 * assume there was never a number.
 */
function header(claim: ClaimInfo, trade: Trade): string {
  const lossType = lossTypeLabel(claim) ?? "—";
  const catClass =
    claim.lossType === "WATER" ? `Category ${claim.waterCategory ?? "—"} / Class ${claim.waterClass ?? "—"}` : "Category N/A / Class N/A";

  return [
    `WORK ORDER — ${TRADE_LABEL[trade].toUpperCase()}`,
    "",
    `Job: ${claim.jobNumber || "—"} – ${claim.customerName || "—"}`,
    `Address: ${claim.address || "—"}`,
    `Loss type: ${lossType}`,
    `${catClass}`,
    `Project manager: ${claim.pmName || "—"}`,
    `PM phone: —`,
    "",
  ].join("\n");
}

/**
 * Identical on every work order, unconditionally. These are safety and process instructions for the
 * crew, not scope — they don't vary by trade and must never be filtered out by a builder that
 * happens to produce no line items.
 */
const STANDING_NOTES = [
  "Contact the PM before doing any work outside what's listed here, and immediately if unexpected conditions or additional damage are found.",
  "Wear appropriate PPE at all times.",
  "Take photos before and after work.",
  "Complete all required paperwork.",
];

/**
 * Notes that belong to one trade, added under the standing ones.
 *
 * These are the things a crew is expected to do that no scoped line item says out loud —
 * protection, clean-up, and the checks that have to happen before an install rather than after it.
 * They live here rather than being repeated per room because they are true of the whole visit.
 *
 * Some are conditional on the work actually containing what they describe: a carpentry order for
 * doors only should not carry notes about baseboard. `rooms` is what decides that — rooms rather
 * than the whole extraction because the contents trades have no extraction to hand at all.
 */
function tradeNotes(trade: Trade, rooms: Room[]): string[] {
  const installsBaseboard = rooms.some((room) =>
    room.baseboard.some((b) => b.action === "REMOVE_AND_REPLACE" || b.action === "SHOE_MOLD_ONLY"),
  );

  switch (trade) {
    case "DRYWALL":
      return [
        "Mask and protect flooring, contents and adjacent finishes from drywall dust before starting.",
        "Clean up thoroughly at the end of each day.",
      ];

    case "PAINTING":
      return [
        "Mask and protect flooring, contents and adjacent finishes before starting.",
        "Confirm colours with the PM before starting, and check whether samples are needed. Pick up materials if required.",
        "Clean up thoroughly at the end of each day.",
      ];

    case "FINISH_CARPENTRY":
      return [
        ...(installsBaseboard
          ? [
              "Confirm the exact baseboard profile and colour with the PM before installing — check samples where the existing profile is not obvious.",
              "Fill nail holes.",
            ]
          : []),
        "Clean up thoroughly at the end of each day.",
      ];

    default:
      return [];
  }
}

/** Wraps a trade's room sections into a finished document, or a clear "nothing scoped" body. */
function assemble(claim: ClaimInfo, trade: Trade, body: string[], rooms: Room[] = []): string {
  const content = body.length > 0 ? body.join("\n") : "    (No items scoped for this trade on this claim.)";
  const notes = ["", "Notes", ...[...STANDING_NOTES, ...tradeNotes(trade, rooms)].map((n) => `    - ${n}`)].join("\n");
  return `${header(claim, trade)}${content}\n${notes}\n`;
}

/** Groups per-room output, dropping rooms that produced nothing for this trade. */
function roomSections(extraction: WaterLossExtraction, perRoom: (room: Room) => string[]): string[] {
  const out: string[] = [];
  for (const room of extraction.rooms) {
    const items = perRoom(room);
    if (items.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(`  ${room.roomName}`, ...items);
  }
  return out;
}

// ---- Mitigation & Demo ------------------------------------------------------------------------

/**
 * For a DGIG claim this reads `dgigData` rather than the extraction, matching the scope document's
 * Emergency section — that insurer's emergency work is captured as labour hours on its own form,
 * and the extracted records describe the repair side only.
 */
function buildMitigationDemo(claim: ClaimInfo, extraction: WaterLossExtraction, dgigData: DGIGData | null): string {
  if (isDGIG(claim.insurer) && dgigData) {
    const body: string[] = [];
    const general = lines(
      dgigData.pmInspectionHours && `    - Labor – PM inspection – ${dgigData.pmInspectionHours} hrs`,
      dgigData.travelHours && `    - Labor – travel – ${dgigData.travelHours} hrs`,
      dgigData.equipmentMonitoringHours && `    - Labor – equipment monitoring – ${dgigData.equipmentMonitoringHours} hrs`,
      dgigData.disposalType && `    - Disposal – ${DISPOSAL_OPTIONS.find((o) => o.value === dgigData.disposalType)?.label ?? ""}`,
    );
    if (general.length > 0) body.push("  General", ...general);

    for (const room of dgigData.rooms) {
      const items = lines(
        room.tearOutHours && `    - Tear out – ${room.tearOutHours} hrs${room.tearOutDescription ? ` – ${room.tearOutDescription}` : ""}`,
        !room.tearOutHours && room.tearOutDescription ? `    - Tear out – ${room.tearOutDescription}` : null,
        room.contentManipulationHours && `    - Content manipulation – ${room.contentManipulationHours} hrs`,
        room.waterExtractionHours && `    - Water extraction – ${room.waterExtractionHours} hrs`,
        room.cleaningHours && `    - Cleaning – ${room.cleaningHours} hrs`,
        room.dryingClass && `    - Drying class ${room.dryingClass} – ${DRYING_CLASS_OPTIONS.find((o) => o.value === room.dryingClass)?.description ?? ""}`,
        room.antimicrobial
          ? `    - Antimicrobial application${room.antimicrobialSF ? ` – ${room.antimicrobialSF} SF` : room.antimicrobialExtent === "FULL_FLOOR" ? " – full floor" : room.antimicrobialExtent === "PARTIAL_FLOOR" ? " – partial area of the floor" : ""}`
          : null,
        room.otherNotes && `    - ${room.otherNotes}`,
      );
      if (items.length === 0) continue;
      if (body.length > 0) body.push("");
      body.push(`  ${room.roomName || "Room"}`, ...items);
    }
    return assemble(claim, "MITIGATION_DEMO", body);
  }

  const body = roomSections(extraction, (room) => {
    const items: string[] = [];

    for (const f of room.flooring) {
      // Phase EMERGENCY or BOTH or unstated all have an emergency portion; only explicit REPAIR doesn't.
      if (f.phase === "REPAIR") continue;
      if (f.disposition === "REMOVE_AND_DISPOSE" || f.disposition === "REMOVE_AND_ASSESS") {
        items.push(bullet("Remove flooring", titleCase(f.type), flooringExtent(f) ?? "floor area"));
      } else if (f.disposition === "LIFT_AND_REINSTALL") {
        items.push(bullet("Lift carpet", null, flooringExtent(f) ?? "floor area"));
        if (f.padRemoved) items.push(bullet("Remove underpad", null, flooringExtent(f) ?? "floor area"));
      }
    }

    for (const b of room.baseboard) {
      if (b.phase === "REPAIR") continue;
      if (b.action === "DETACH_AND_RESET") items.push(bullet("Detach baseboard", null, "perimeter"));
      else if (b.action === "REMOVE_AND_REPLACE") items.push(bullet("Remove baseboard", null, "perimeter"));
    }

    for (const w of room.walls) {
      if (!w.drywallBeingRemoved) continue;
      const height = w.cutHeight ? `cut at ${w.cutHeight === "FULL_WALL" ? "full wall" : w.cutHeight === "BASE" ? 'base height (up to 4")' : w.cutHeight === "TWO_FOOT" ? "2'" : "4'"}` : "flood cut";
      items.push(bullet("Remove drywall", height, w.cutRunFt !== null ? `${w.cutRunFt} LF` : fractionLabel(w.cutRunFraction) ?? "perimeter"));
      if (w.insulationAffected) items.push(bullet("Remove affected insulation", w.insulationType ? titleCase(w.insulationType) : null, null));
    }

    for (const c of room.ceilings) {
      items.push(bullet(c.action === "DETACH_AND_RESET" ? "Detach ceiling" : "Remove ceiling", CEILING_TYPE_LABEL[c.type] ?? titleCase(c.type), ceilingExtent(c)));
    }
    for (const d of room.doors) items.push(bullet(d.action === "DETACH_AND_RESET" ? "Detach door" : "Remove door", d.location, null));
    for (const c of room.cabinetry) items.push(bullet(c.action === "DETACH_AND_RESET" ? "Detach cabinetry" : "Remove cabinetry", c.location, null));
    for (const c of room.countertops) items.push(bullet(c.action === "DETACH_AND_RESET" ? "Detach countertop" : "Remove countertop", null, null));

    if (room.floorRegistersDetached && room.floorRegistersDetached > 0) items.push(bullet("Detach floor registers", `${room.floorRegistersDetached}`, null));
    if (room.contents && !room.contents.manipulationDeclined) items.push(bullet("Manipulate contents", null, null));
    if (room.waterExtractionRequired) {
      const qty = room.waterExtractionSF !== null ? `${room.waterExtractionSF} SF` : fractionLabel(room.waterExtractionFraction) ?? null;
      items.push(bullet("Extract water", room.flooring.some((f) => f.type === "CARPET") ? "from carpet" : "from hard surface", qty));
    }
    for (const e of room.equipment) items.push(bullet("Place equipment", e.type, e.quantity !== null ? `${e.quantity}` : null));

    return items;
  });

  return assemble(claim, "MITIGATION_DEMO", body);
}

// ---- Drywall ----------------------------------------------------------------------------------

function buildDrywall(claim: ClaimInfo, extraction: WaterLossExtraction): string {
  const body = roomSections(extraction, (room) => {
    const items: string[] = [];
    // Fires once per distinct cut height in a room — matching the scope document, which explicitly
    // avoids repeating the line per wall record when several share a height.
    const seen = new Set<string>();
    for (const w of room.walls) {
      if (!w.drywallBeingRemoved) continue;
      const key = w.cutHeight ?? "UNKNOWN";
      if (seen.has(key)) continue;
      seen.add(key);
      const label = w.cutHeight === "FULL_WALL" ? "full wall" : w.cutHeight === "TWO_FOOT" ? "at 2'" : w.cutHeight === "FOUR_FOOT" ? "at 4'" : 'at base height (up to 4")';
      items.push(bullet("Replace drywall", label, w.cutRunFt !== null ? `${w.cutRunFt} LF` : fractionLabel(w.cutRunFraction) ?? "perimeter"));
    }
    /*
      Named on the drywall order because that is the trade whose dust is being cleaned off.

      One line per size band, since that is what the tally now records and what each band prices at.
      A room with two 10–20 SF and one 41–60 SF window is three windows at two rates, and a single
      line naming one band would price all three at whichever band happened to be picked.
    */
    for (const band of WINDOW_CLEANING_SIZES) {
      const count = room.windowCleaningCounts?.[band] ?? 0;
      if (count === 0) continue;
      items.push(bullet(`Clean ${count} window${count === 1 ? "" : "s"} after drywall work`, WINDOW_CLEANING_SIZE_LABEL[band], null));
    }
    for (const c of room.ceilings) {
      if (c.type !== "DRYWALL_PLASTER" || c.action !== "REMOVE_AND_REPLACE") continue;
      if (c.finish === "TEXTURE") {
        items.push(bullet("Replace ceiling drywall ready for texture", null, ceilingExtent(c) ?? "partial"));
        items.push(
          bullet(c.textureStyle === "POPCORN" ? "Scrape & skim coat, prime and spray new texture" : "Skim coat x2, prime and apply new knockdown texture", null, null),
        );
      } else {
        items.push(bullet("Replace ceiling drywall", null, ceilingExtent(c) ?? "partial"));
      }
    }
    return items;
  });

  return assemble(claim, "DRYWALL", body, extraction.rooms);
}

// ---- Painting ---------------------------------------------------------------------------------

/** Every line here comes from lib/paintDerivation.ts — the same module the scope-document prompt draws its numbers and wording from. */
function buildPainting(claim: ClaimInfo, extraction: WaterLossExtraction, paintableWallSF?: PaintableWallAreas): string {
  const body = roomSections(extraction, (room) => {
    const items: string[] = [];
    const seen = new Set<string>();
    room.walls.forEach((w, wallIndex) => {
      // Measured off the sketch where the PM marked the walls out; null everywhere else, and the
      // estimate below stands.
      const marked = paintableWallSF?.[`${room.roomName ?? ""}:${wallIndex}`] ?? null;
      const line = primingLine(w, marked);
      if (!line || seen.has(line)) return;
      seen.add(line);
      items.push(`    - ${line}`);
    });
    for (const b of room.baseboard) {
      const line = baseboardFinishLine(b);
      if (!line || seen.has(line)) continue;
      seen.add(line);
      items.push(`    - ${line}`);
    }
    // Ceilings were missing from this order entirely — see `ceilingPaintLine`.
    for (const c of room.ceilings) {
      const line = ceilingPaintLine(c);
      if (!line || seen.has(line)) continue;
      seen.add(line);
      items.push(`    - ${line}`);
    }
    return items;
  });

  return assemble(claim, "PAINTING", body, extraction.rooms);
}

// ---- Finish Carpentry -------------------------------------------------------------------------

function buildFinishCarpentry(claim: ClaimInfo, extraction: WaterLossExtraction): string {
  const body = roomSections(extraction, (room) => {
    const items: string[] = [];
    for (const b of room.baseboard) {
      if (b.action === "SHOE_MOLD_ONLY") {
        items.push(bullet("Install shoe mold / quarter round", null, "perimeter"));
      } else if (b.action === "DETACH_AND_RESET") {
        items.push(bullet("Reset baseboard", b.material ? BASEBOARD_MATERIAL_LABEL[b.material] ?? titleCase(b.material) : null, "perimeter"));
      } else if (b.action === "REMOVE_AND_REPLACE") {
        // Material only — height and profile are estimator spec, not something a crew installs by.
        items.push(bullet("Install new baseboard", b.material ? BASEBOARD_MATERIAL_LABEL[b.material] ?? titleCase(b.material) : null, "perimeter"));
      }
    }
    for (const d of room.doors) items.push(bullet(d.action === "DETACH_AND_RESET" ? "Reset door" : "Install new door", d.location, null));
    for (const c of room.cabinetry) items.push(bullet(c.action === "DETACH_AND_RESET" ? "Reset cabinetry" : "Install new cabinetry", c.location, null));
    for (const c of room.countertops) items.push(bullet(c.action === "DETACH_AND_RESET" ? "Reset countertop" : "Install new countertop", c.material ? titleCase(c.material) : null, null));
    for (const t of room.toeKicks) items.push(bullet(t.action === "DETACH_AND_RESET" ? "Reset toe kick" : "Install new toe kick", null, null));
    return items;
  });

  return assemble(claim, "FINISH_CARPENTRY", body, extraction.rooms);
}

// ---- Contents ---------------------------------------------------------------------------------

function buildContentsPackOut(claim: ClaimInfo, approach: ContentsApproach, tm: ContentsTM, bric: BricABracData): string {
  const body: string[] = [];

  if (approach === "TM") {
    const labor = lines(
      tm.onSiteManipulationHours && `    - Labor – on-site manipulation – ${tm.onSiteManipulationHours} hrs`,
      tm.packOutHours && `    - Labor – pack out – ${tm.packOutHours} hrs`,
    );
    if (labor.length > 0) body.push("  Labor", ...labor);

    const consumables = CONSUMABLE_ITEMS.map((item) => {
      const qty = tm.consumables[item.id];
      return qty && Number.parseFloat(qty) > 0 ? `    - ${item.label} – ${qty} ${item.unit}` : null;
    }).filter((l): l is string => l !== null);
    if (consumables.length > 0) {
      if (body.length > 0) body.push("");
      body.push("  Consumables", ...consumables);
    }

    const equipment = lines(
      tm.truckChargeCount && `    - Moving van/truck – ${tm.truckChargeCount}`,
      tm.disposalType && `    - Disposal – ${DISPOSAL_OPTIONS.find((o) => o.value === tm.disposalType)?.label ?? ""}`,
    );
    if (equipment.length > 0) {
      if (body.length > 0) body.push("");
      body.push("  Equipment", ...equipment);
    }
    if (tm.otherAdditions.trim() !== "") {
      if (body.length > 0) body.push("");
      body.push("  Other", `    - ${tm.otherAdditions.trim()}`);
    }
  } else {
    for (const room of bric.rooms) {
      const boxes = BOX_ITEMS.map((item) => {
        const qty = room.boxes[item.id];
        return qty && Number.parseFloat(qty) > 0 ? `${qty} ${item.label}` : null;
      }).filter((b): b is string => b !== null);
      const unboxable = room.unboxableItems
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "");

      const items = lines(
        room.contentSize && `    - Content size – ${CONTENT_SIZE_OPTIONS.find((o) => o.value === room.contentSize)?.label ?? ""}`,
        unboxable.length > 0 ? `    - Unboxable items (${unboxable.length}) – ${unboxable.join(", ")}` : null,
        boxes.length > 0 ? `    - Boxes – ${boxes.join(", ")}` : null,
        room.otherConsumables.trim() !== "" ? `    - Other consumables – ${room.otherConsumables.trim()}` : null,
        room.movingBlankets && Number.parseFloat(room.movingBlankets) > 0 ? `    - Moving blankets – ${room.movingBlankets}` : null,
      );
      if (items.length === 0) continue;
      if (body.length > 0) body.push("");
      body.push(`  ${room.roomName.trim() || "Room"}`, ...items);
    }

    const cleaning = buildContentCleaningSection(bric.cleaning);
    if (cleaning) {
      if (body.length > 0) body.push("");
      body.push(cleaning);
    }

    const general = lines(
      bric.nonRestorableCount && Number.parseFloat(bric.nonRestorableCount) > 0 ? `    - Non-restorable items – ${bric.nonRestorableCount}` : null,
      bric.truckChargeCount && `    - Moving van/truck – ${bric.truckChargeCount}`,
      bric.disposalType && `    - Disposal – ${DISPOSAL_OPTIONS.find((o) => o.value === bric.disposalType)?.label ?? ""}`,
    );
    if (general.length > 0) {
      if (body.length > 0) body.push("");
      body.push("  General", ...general);
    }
  }

  return assemble(claim, "CONTENTS_PACK_OUT", body);
}

/** Time & Material only — see availableTrades for why bric-a-brac has no pack-back order. */
function buildContentsPackBack(claim: ClaimInfo, tm: ContentsTM): string {
  const body = lines(tm.packBackHours && `    - Labor – pack back – ${tm.packBackHours} hrs`);
  const withHeading = body.length > 0 ? ["  Labor", ...body] : [];
  return assemble(claim, "CONTENTS_PACK_BACK", withHeading);
}

// ---- entry point ------------------------------------------------------------------------------

/**
 * Paintable wall area measured off the sketch, keyed by "<room name>:<wall index>".
 *
 * Supplied by the caller rather than computed here: the sketch and its markings live in the page's
 * state, and work-order building has always been a pure function of data it is handed. Absent for
 * every wall the PM did not mark, which is the normal case.
 */
export type PaintableWallAreas = Record<string, number | null>;

export interface WorkOrder {
  trade: Trade;
  label: string;
  text: string;
}

/** Builds every selected work order. Pure — no API calls, no state mutation. */
export function buildWorkOrders(params: {
  trades: Trade[];
  claim: ClaimInfo;
  extraction: WaterLossExtraction | null;
  contentsApproach: ContentsApproach;
  contentsTM: ContentsTM;
  bricABrac: BricABracData;
  dgigData: DGIGData | null;
  /** Wall areas marked out on the sketch — see `PaintableWallAreas`. */
  paintableWallSF?: PaintableWallAreas;
}): WorkOrder[] {
  const { trades, claim, extraction, contentsApproach, contentsTM, bricABrac, dgigData, paintableWallSF } = params;
  // A contents-only claim has no extraction at all — the contents builders don't need one.
  const empty: WaterLossExtraction = extraction ?? { loss: { category: null, lossClass: null, source: null, dateOfLoss: null, yearOfBuilding: null, asbestosTestingRequired: false, asbestosSamplesTaken: null, asbestosSampleCount: null, isBasementLoss: false, hvacInspectionRequired: null }, rooms: [] };

  return trades.map((trade) => {
    let text: string;
    switch (trade) {
      case "MITIGATION_DEMO":
        text = buildMitigationDemo(claim, empty, dgigData);
        break;
      case "DRYWALL":
        text = buildDrywall(claim, empty);
        break;
      case "PAINTING":
        text = buildPainting(claim, empty, paintableWallSF);
        break;
      case "FINISH_CARPENTRY":
        text = buildFinishCarpentry(claim, empty);
        break;
      case "CONTENTS_PACK_OUT":
        text = buildContentsPackOut(claim, contentsApproach, contentsTM, bricABrac);
        break;
      case "CONTENTS_PACK_BACK":
        text = buildContentsPackBack(claim, contentsTM);
        break;
    }
    return { trade, label: TRADE_LABEL[trade], text };
  });
}
