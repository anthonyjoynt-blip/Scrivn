"use client";

import {
  type SketchRoom,
  type WallCap,
  type WallDetail,
  WALL_CAP_LABEL,
  formatFeetInches,
  halfWallRuns,
  wallDetailOf,
} from "@/lib/sketch";
import { MeasureField } from "./SymbolPanel";

/**
 * What one tapped wall is beyond its length (`WallDetail`, 2026-10-21): a half wall's height and cap.
 * Under the wall's length and its Missing wall tick, in the same sheet, because it is about the same
 * wall. Every field can be left empty, which is a plain wall to the ceiling.
 *
 * A wall whose height changes part-way is two walls: Break it there and give each piece its own.
 */
export function WallDetailFields({
  room,
  wallId,
  rooms,
  onPatch,
}: {
  room: SketchRoom;
  wallId: string;
  rooms: SketchRoom[];
  onPatch: (patch: Partial<WallDetail>) => void;
}) {
  const detail = wallDetailOf(room, wallId);
  // Half because the room across a partition marked it: one wall, so it is said here too.
  const fromAcross = detail.heightFeet == null ? halfWallRuns(room, wallId, rooms)[0] : undefined;
  return (
    <>
      <MeasureField
        id="wall-half-height"
        label="Half wall height"
        hint={
          fromAcross
            ? `Half wall from the other side: ${formatFeetInches(fromAcross.heightFeet)} high. Set it here to change it for this room.`
            : "Empty for a wall to the ceiling. For a stair rail wall or a pony wall, its height: the face counts to it and no ceiling line runs along it. If the height changes part-way, Break the wall there first."
        }
        valueFeet={detail.heightFeet ?? null}
        onCommit={(feet) => onPatch({ heightFeet: feet })}
        onClear={() => onPatch({ heightFeet: null, cap: undefined })}
      />
      {detail.heightFeet != null && (
        <div className="question">
          <label className="prompt" htmlFor="wall-cap">
            Cap on top
          </label>
          <select id="wall-cap" value={detail.cap ?? ""} onChange={(e) => onPatch({ cap: e.target.value === "" ? undefined : (e.target.value as WallCap) })}>
            <option value="">Not said</option>
            {(Object.keys(WALL_CAP_LABEL) as WallCap[]).map((cap) => (
              <option key={cap} value={cap}>
                {WALL_CAP_LABEL[cap]}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
