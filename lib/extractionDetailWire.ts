import type {
  BaseboardMdfProfile,
  BaseboardMaterial,
  CarpetStyle,
  CeilingTextureStyle,
  InsulationType,
  WaterLossExtraction,
  WallDrywallCutHeight,
} from "./types";

/**
 * Merges the detail pass back onto the tree call 1 produced.
 *
 * Everything here is positional — see `extractionDetailPrompt.ts` for why — so the one thing that
 * can go wrong is misalignment, and the one rule is that misalignment must never be papered over. A
 * cut height attached to the wrong wall, or a berber style attached to the vinyl in the next room,
 * is a wrong figure in an insurer's scope that nobody will re-check, because nothing about it looks
 * wrong. A MISSING figure gets asked by gap-check thirty seconds later.
 *
 * So a room whose record counts come back different from what was asked for is discarded entirely,
 * and the whole pass is best-effort: nothing here can fail the extraction, only decline to improve it.
 */

export interface FlooringDetailWire {
  carpetStyle: string;
}
export interface BaseboardDetailWire {
  material: string;
  mdfProfile: string;
}
export interface WallDetailWire {
  cutHeight: string;
  insulationType: string;
}
export interface CeilingDetailWire {
  textureStyle: string;
  aboveInsulationAffected: string;
  aboveInsulationType: string;
}
export interface RoomDetailWire {
  flooring: FlooringDetailWire[];
  baseboard: BaseboardDetailWire[];
  walls: WallDetailWire[];
  ceilings: CeilingDetailWire[];
}
export interface ExtractionDetailWire {
  rooms: RoomDetailWire[];
}

function enumOrNull<T extends string>(value: string | undefined): T | null {
  return value === undefined || value === "UNKNOWN" || value === "" ? null : (value as T);
}

function toTriState(s: string | undefined): boolean | null {
  if (s === "YES") return true;
  if (s === "NO") return false;
  return null;
}

/**
 * `existing ?? fromDetail` throughout, never the other way round.
 *
 * Call 1 is the authority wherever the two overlap. They are not supposed to overlap at all — the
 * detail schema deliberately carries nothing call 1 carries — but a field that migrates between the
 * two later should not silently change which call wins.
 */
export function mergeDetail(extraction: WaterLossExtraction, detail: ExtractionDetailWire): WaterLossExtraction {
  const rooms = extraction.rooms.map((room, roomIndex) => {
    const d = detail.rooms?.[roomIndex];
    if (!d) return room;

    // Counts must match exactly, or position means nothing and the whole room is left alone.
    const aligned =
      d.flooring?.length === room.flooring.length &&
      d.baseboard?.length === room.baseboard.length &&
      d.walls?.length === room.walls.length &&
      d.ceilings?.length === room.ceilings.length;
    if (!aligned) return room;

    return {
      ...room,
      flooring: room.flooring.map((f, i) => ({
        ...f,
        carpetStyle: f.carpetStyle ?? enumOrNull<CarpetStyle>(d.flooring[i]?.carpetStyle),
      })),
      baseboard: room.baseboard.map((b, i) => ({
        ...b,
        material: b.material ?? enumOrNull<BaseboardMaterial>(d.baseboard[i]?.material),
        mdfProfile: b.mdfProfile ?? enumOrNull<BaseboardMdfProfile>(d.baseboard[i]?.mdfProfile),
      })),
      walls: room.walls.map((w, i) => ({
        ...w,
        cutHeight: w.cutHeight ?? enumOrNull<WallDrywallCutHeight>(d.walls[i]?.cutHeight),
        insulationType: w.insulationType ?? enumOrNull<InsulationType>(d.walls[i]?.insulationType),
      })),
      ceilings: room.ceilings.map((c, i) => ({
        ...c,
        textureStyle: c.textureStyle ?? enumOrNull<CeilingTextureStyle>(d.ceilings[i]?.textureStyle),
        aboveInsulationAffected: c.aboveInsulationAffected ?? toTriState(d.ceilings[i]?.aboveInsulationAffected),
        aboveInsulationType: c.aboveInsulationType ?? enumOrNull<InsulationType>(d.ceilings[i]?.aboveInsulationType),
      })),
    };
  });

  return { ...extraction, rooms };
}

/**
 * Whether the detail pass has anything to ask about — decided from call 1's own output, so there is
 * no keyword scan of the transcript and nothing to get wrong.
 *
 * The trigger for each field is simply the record it describes existing in a state where the field
 * could apply. A claim with none of these (a single vinyl floor and nothing else, a contents-only
 * job) skips the call entirely and stays as fast as it is today.
 */
export function needsDetailPass(extraction: WaterLossExtraction): boolean {
  return extraction.rooms.some(
    (room) =>
      // Carpet has a style; nothing else does.
      room.flooring.some((f) => f.type === "CARPET" && f.carpetStyle === null) ||
      // Every baseboard has a material, and call 1 never carries it.
      room.baseboard.some((b) => b.material === null) ||
      // A cut height and cavity insulation only exist where drywall is coming off.
      room.walls.some((w) => w.drywallBeingRemoved && (w.cutHeight === null || w.insulationType === null)) ||
      // Texture and the insulation above only apply to drywall ceilings being taken out.
      room.ceilings.some(
        (c) =>
          c.type === "DRYWALL_PLASTER" &&
          c.action === "REMOVE_AND_REPLACE" &&
          (c.aboveInsulationAffected === null || (c.finish === "TEXTURE" && c.textureStyle === null)),
      ),
  );
}
