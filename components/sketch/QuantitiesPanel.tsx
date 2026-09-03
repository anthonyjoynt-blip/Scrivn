"use client";

import type { Sketch } from "@/lib/sketch";
import { formatFeetInches } from "@/lib/sketch";
import { type QuantityOptions, formatQuantity, roomQuantities } from "@/lib/sketchQuantities";

/**
 * The measured quantities, per room — the numbers someone actually estimates from.
 *
 * Every deduction is a toggle, because every one of them is contested by somebody. What differs is
 * where the sensible default sits: the cabinetry ones start OFF, since whether finish behind
 * cabinetry gets replaced varies by carrier and by job, while doors, openings and windows start ON,
 * since there is genuinely no wall in a doorway — see `openingSquareFeetOnWall`.
 *
 * Whatever came off, the gross figure stays visible beside the net one: a number that changed
 * without showing its working is a number nobody will trust enough to put on a claim.
 */
export function QuantitiesPanel({
  sketch,
  options,
  onOptionsChange,
}: {
  sketch: Sketch;
  options: QuantityOptions;
  onOptionsChange: (next: QuantityOptions) => void;
}) {
  if (sketch.rooms.length === 0) return null;

  const toggles: { key: keyof QuantityOptions; label: string; hint: string }[] = [
    { key: "deductCabinetsFromFloorPerimeter", label: "PF less cabinet runs", hint: "Takes the running feet of lower cabinets out of the floor perimeter." },
    { key: "deductFromFloorArea", label: "F less cabinets & showers", hint: "Takes the footprint of lowers and built-in fixtures out of the floor area." },
    { key: "deductFromWallArea", label: "W less cabinets & showers", hint: "Takes the wall face behind lowers, uppers and built-ins out of the wall area." },
    {
      key: "deductOpeningsFromWallArea",
      label: "W less doors & windows",
      hint: "Takes doors, cased openings and windows out of the wall area. On by default — there is no wall in a doorway.",
    },
  ];

  return (
    <div className="sketch-quantities">
      <h3>Quantities</h3>

      <div className="sketch-deduction-toggles" role="group" aria-label="Deductions">
        {toggles.map((toggle) => (
          <button
            key={toggle.key}
            type="button"
            className={`option-btn${options[toggle.key] ? " selected" : ""}`}
            aria-pressed={options[toggle.key]}
            title={toggle.hint}
            onClick={() => onOptionsChange({ ...options, [toggle.key]: !options[toggle.key] })}
          >
            {toggle.label}
          </button>
        ))}
      </div>

      <div className="sketch-qty-scroll">
        <table className="sketch-qty-table">
          <thead>
            <tr>
              <th scope="col">Room</th>
              <th scope="col" title="Perimeter at the floor">
                PF
              </th>
              <th scope="col" title="Perimeter at the ceiling">
                PC
              </th>
              <th scope="col" title="Floor area">
                F
              </th>
              <th scope="col" title="Wall surface area">
                W
              </th>
              <th scope="col" title="Ceiling area">
                C
              </th>
            </tr>
          </thead>
          <tbody>
            {sketch.rooms.map((room) => {
              const q = roomQuantities(room, sketch, options);
              const name = room.name.trim() || "Unnamed room";
              const parent = room.parentRoomId ? sketch.rooms.find((r) => r.id === room.parentRoomId) : null;

              return (
                <tr key={room.id}>
                  <th scope="row">
                    {name}
                    {parent && <span className="sketch-qty-parent">in {parent.name.trim() || "another room"}</span>}
                  </th>
                  <Cell value={q.perimeterFloor} gross={q.gross.perimeterFloor} unit="LF" />
                  <Cell value={q.perimeterCeiling} gross={q.perimeterCeiling} unit="LF" />
                  <Cell value={q.floorArea} gross={q.gross.floorArea} unit="SF" />
                  {q.ceilingHeightFeet == null ? <td className="sketch-qty-note">set ceiling</td> : <Cell value={q.wallArea} gross={q.gross.wallArea} unit="SF" />}
                  <Cell value={q.ceilingArea} gross={q.ceilingArea} unit="SF" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="field-note">
        LF = linear feet, SF = square feet. A struck-through figure is the gross before deductions. Wall area uses each room&rsquo;s ceiling height
        {sketch.rooms.some((r) => r.ceilingHeightFeet != null) ? ` (${formatFeetInches(sketch.rooms.find((r) => r.ceilingHeightFeet != null)?.ceilingHeightFeet ?? 8)} unless changed)` : ""}. A sub-room&rsquo;s
        floor and ceiling are taken out of its parent&rsquo;s, so nothing is counted twice; perimeters are not, since a closet&rsquo;s walls exist in addition to the
        room&rsquo;s. Doors, openings and windows come out of the wall area by default, since there is no wall there to finish; switch that off
        above to compare against a gross figure. A window with no height recorded is not deducted, because a height nobody entered is not a
        measurement.
      </p>
    </div>
  );
}

/** A number, with the pre-deduction figure struck through beside it when the two differ. */
function Cell({ value, gross, unit }: { value: number; gross: number; unit: string }) {
  const reduced = Math.abs(gross - value) > 0.05;
  return (
    <td>
      <span className="sketch-qty-value">{formatQuantity(value)}</span>
      <span className="sketch-qty-unit">{unit}</span>
      {reduced && <s className="sketch-qty-gross">{formatQuantity(gross)}</s>}
    </td>
  );
}
