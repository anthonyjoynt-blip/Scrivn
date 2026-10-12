"use client";

import type { Sketch } from "@/lib/sketch";
import type { MoistureMap } from "@/lib/moisture";
import type { DryingPlan } from "@/lib/dryingPlan";
import {
  DEHUMIDIFIER_SIZES,
  DEHUMIDIFIER_TYPE_LABEL,
  type DehumidifierType,
  type EquipmentSettings,
  type UnitSize,
  type WaterClass,
  claimEquipment,
} from "@/lib/equipment";

/**
 * Suggested equipment, from the moisture map.
 *
 * A readout, not a decision. These are IICRC formulas run over what the PM marked, offered so the
 * number on the scope has something to be checked against — the PM's own count always stands unless
 * they choose otherwise, which is what the confirm-or-suggest question in gap-check is for.
 *
 * Shown only when a moisture map exists. With no map there is nothing to calculate from and this
 * renders nothing at all, rather than a row of zeroes that look like a recommendation of none.
 */
export function EquipmentPanel({
  sketch,
  moisture,
  settings,
  plan,
  showOnSketch,
  onShowOnSketchChange,
  statedEquipment,
  onSettingsChange,
  onResolveEquipment,
}: {
  sketch: Sketch;
  moisture: MoistureMap;
  settings: EquipmentSettings;
  /** The same counts laid out (`sketchDryingPlan`): where the canvas draws them, and what the walls had no room for. */
  plan?: DryingPlan | null;
  /** Whether the canvas draws the plan, and the switch for it. */
  showOnSketch?: boolean;
  onShowOnSketchChange?: (show: boolean) => void;
  /**
   * What the claim already says is being placed, by room name then equipment type.
   *
   * Present so the comparison can happen HERE, the moment a room's map is finished, rather than
   * waiting for a later gap-check round. A PM who has just marked out a room is thinking about that
   * room; asking them about its air movers twenty minutes later, in a batch with every other room,
   * is the same question asked at the worst possible moment.
   */
  statedEquipment?: Record<string, Partial<Record<string, number>>>;
  onSettingsChange: (next: EquipmentSettings) => void;
  /** Adopt the recommendation (a number) or stand by what was stated (null). Either resolves it. */
  onResolveEquipment?: (roomName: string, equipmentType: string, adopt: number | null) => void;
}) {
  const result = claimEquipment(sketch, moisture, settings);
  if (result.rooms.length === 0) return null;

  const normalise = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

  const dehu = result.totalDehumidifiers;
  const band = DEHUMIDIFIER_SIZES[settings.dehumidifierType][settings.dehumidifierSize];

  return (
    <div className="sketch-panel">
      <div className="question">
        <h3>Suggested equipment</h3>
        <p className="field-note">
          Calculated from the moisture map using IICRC guidance. A starting point to check your own count against — your
          number stands unless you change it.
        </p>
      </div>

      <div className="equipment-settings">
        <label>
          <span>Water class</span>
          <select
            value={settings.waterClass}
            onChange={(e) => onSettingsChange({ ...settings, waterClass: Number(e.target.value) as WaterClass })}
          >
            {([1, 2, 3, 4] as WaterClass[]).map((c) => (
              <option key={c} value={c}>
                Class {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Dehumidifier</span>
          <select
            value={settings.dehumidifierType}
            onChange={(e) => onSettingsChange({ ...settings, dehumidifierType: e.target.value as DehumidifierType })}
          >
            {(Object.keys(DEHUMIDIFIER_TYPE_LABEL) as DehumidifierType[]).map((type) => (
              <option key={type} value={type}>
                {DEHUMIDIFIER_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Unit size</span>
          <select
            value={settings.dehumidifierSize}
            onChange={(e) => onSettingsChange({ ...settings, dehumidifierSize: e.target.value as UnitSize })}
          >
            {(["small", "medium", "large"] as UnitSize[]).map((size) => (
              <option key={size} value={size}>
                {DEHUMIDIFIER_SIZES[settings.dehumidifierType][size].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="equipment-totals">
        <div className="equipment-total">
          <span className="equipment-count">{result.totalAirMovers}</span>
          <span className="equipment-label">air movers</span>
          <span className="field-note">across {result.rooms.length} affected {result.rooms.length === 1 ? "room" : "rooms"}</span>
        </div>
        <div className="equipment-total">
          <span className="equipment-count">{dehu.units}</span>
          <span className="equipment-label">
            {DEHUMIDIFIER_TYPE_LABEL[settings.dehumidifierType]} {dehu.units === 1 ? "unit" : "units"}
          </span>
          {/*
            The working, not just the answer. A PM defending this number to an adjuster needs to be
            able to point at where it came from, and the band's LOWER bound is the rating used —
            worth stating, since it is the conservative choice rather than the obvious one.
          */}
          <span className="field-note">
            {Math.round(dehu.cubicFeet).toLocaleString()} cu ft → {Math.round(dehu.required).toLocaleString()} {dehu.unit} ÷{" "}
            {band.low.toLocaleString()} {dehu.unit} per unit
          </span>
        </div>
      </div>

      {/* The drying calculator's glyphs, so the key and the plan read the same. */}
      {plan && onShowOnSketchChange && (
        <div className="equipment-show">
          <button
            type="button"
            className={`option-btn${showOnSketch ? " selected" : ""}`}
            aria-pressed={showOnSketch}
            onClick={() => onShowOnSketchChange(!showOnSketch)}
          >
            Show on sketch
          </button>
          {showOnSketch && (
            <span className="equipment-key" aria-hidden="true">
              <span>
                <svg viewBox="-8 -7 17 14" width="14" height="12">
                  <path d="M 8 0 L -5 -5.5 L -2.5 0 L -5 5.5 Z" fill="#1b3a5c" />
                </svg>{" "}
                Air mover
              </span>
              {plan.dehumidifiersPlaced ? (
                <span>
                  <svg viewBox="0 0 14 10" width="14" height="10">
                    <rect width="14" height="10" rx="2" fill="#c97a0e" />
                  </svg>{" "}
                  Dehumidifier
                </span>
              ) : (
                <span>Desiccants stand outside and duct in, so none are drawn.</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Only where the claim already states a count AND it is below what the map suggests. */}
      {onResolveEquipment &&
        result.rooms.flatMap((room) => {
          const stated = statedEquipment?.[normalise(room.roomName)] ?? {};
          return (
            [
              ["air movers", room.airMovers.units] as const,
              ["dehumidifiers", room.dehumidifiers.units] as const,
            ]
              .map(([type, suggested]) => {
                const have = stated[type];
                if (have === undefined || have >= suggested) return null;
                return (
                  <div className="equipment-confirm" key={`${room.roomId}:${type}`}>
                    <p>
                      <strong>{room.roomName}</strong> — you stated {have} {type}; this map suggests {suggested}.
                    </p>
                    <div className="option-group" role="group" aria-label={`${type} for ${room.roomName}`}>
                      <button type="button" className="option-btn" onClick={() => onResolveEquipment(room.roomName, type, null)}>
                        Keep {have}
                      </button>
                      <button type="button" className="option-btn" onClick={() => onResolveEquipment(room.roomName, type, suggested)}>
                        Use {suggested}
                      </button>
                    </div>
                  </div>
                );
              })
              .filter((node) => node !== null)
          );
        })}

      <div className="sketch-qty-scroll">
        <table className="sketch-qty-table">
          <thead>
            <tr>
              <th scope="col">Room</th>
              <th scope="col" title="Air movers suggested for this room">
                Air movers
              </th>
              <th scope="col">How it adds up</th>
            </tr>
          </thead>
          <tbody>
            {result.rooms.map((room) => {
              // Movers the walls had no room for: the sketch draws the rest, so these are said here.
              const unplaced = plan?.rooms.find((r) => r.roomId === room.roomId)?.airMoversUnplaced ?? 0;
              return (
                <tr key={room.roomId}>
                  <th scope="row">{room.roomName}</th>
                  <td>
                    <span className="sketch-qty-value">{room.airMovers.units}</span>
                    {unplaced > 0 && <span className="equipment-working equipment-unplaced">+{unplaced} on the open floor</span>}
                  </td>
                  <td className="equipment-working">
                    1 base + {room.airMovers.breakdown.floor} floor + {room.airMovers.breakdown.upper} walls &amp; ceiling
                    {room.airMovers.breakdown.insets > 0 && <> + {room.airMovers.breakdown.insets} insets</>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="field-note">
        Air movers are per room: 1 + affected floor ÷ 50 + affected wall above 2 ft and ceiling ÷ 100 + insets over 18&quot;, always
        rounded up. Dehumidifiers are sized once over the whole affected volume rather than summed per room, since the air
        moves between them.
      </p>
    </div>
  );
}
