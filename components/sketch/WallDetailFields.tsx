"use client";

import {
  type CeilingFinish,
  type SketchRoom,
  type WainscotType,
  type WallCap,
  type WallDetail,
  CEILING_FINISH_LABEL,
  WAINSCOT_TYPE_LABEL,
  WALL_CAP_LABEL,
  formatFeetInches,
  halfWallRuns,
  wallDetailOf,
  wallUnfinished,
  wallsOf,
  withWallDetail,
} from "@/lib/sketch";
import { MeasureField } from "./SymbolPanel";

/**
 * What one tapped wall is beyond its length (`WallDetail`, 2026-10-21): a half wall's height and cap,
 * crown, a plant ledge, wainscot, a ledge along the bottom, and whether it is unfinished. Under the
 * wall's length and its Missing wall tick, in the same sheet, because it is about the same wall.
 * Every field can be left empty, which is a plain wall to the ceiling.
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

      {/* Trim and finish on this wall: crown, a plant ledge, wainscot, a ledge along the bottom, unfinished. */}
      <div className="question">
        <label className="checkbox-label">
          <input type="checkbox" checked={detail.crown === true} onChange={(e) => onPatch({ crown: e.target.checked })} />
          Crown moulding
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={wallUnfinished(room, wallId)}
            // Said only where it differs from the room: matching it again leaves the wall to follow the room.
            onChange={(e) => onPatch({ unfinished: e.target.checked === (room.unfinished === true) ? undefined : e.target.checked })}
          />
          Unfinished wall (open studs, bare block)
        </label>
      </div>
      <MeasureField
        id="wall-plant-ledge"
        label="Plant ledge at"
        hint="Height of a plant ledge along this wall - the flat top of a wall open above it. Empty for none."
        valueFeet={detail.plantLedgeFeet ?? null}
        onCommit={(feet) => onPatch({ plantLedgeFeet: feet })}
        onClear={() => onPatch({ plantLedgeFeet: null })}
      />
      <MeasureField
        id="wall-wainscot"
        label="Wainscot height"
        hint="Empty for none. It stops at the doors and at any window whose sill is below its top."
        valueFeet={detail.wainscot?.heightFeet ?? null}
        onCommit={(feet) => onPatch({ wainscot: { ...detail.wainscot, heightFeet: feet } })}
        onClear={() => onPatch({ wainscot: undefined })}
      />
      {detail.wainscot && (
        <div className="question">
          <label className="prompt" htmlFor="wall-wainscot-type">
            Wainscot type
          </label>
          <select
            id="wall-wainscot-type"
            value={detail.wainscot.type ?? ""}
            onChange={(e) => onPatch({ wainscot: { heightFeet: detail.wainscot!.heightFeet, ...(e.target.value === "" ? {} : { type: e.target.value as WainscotType }) } })}
          >
            <option value="">Not said</option>
            {(Object.keys(WAINSCOT_TYPE_LABEL) as WainscotType[]).map((type) => (
              <option key={type} value={type}>
                {WAINSCOT_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
      )}
      <MeasureField
        id="wall-ledge-height"
        label="Ledge along the bottom, top at"
        hint="A foundation ledge or knee-wall step: the height of its top. Empty for none."
        valueFeet={detail.ledge?.heightFeet ?? null}
        onCommit={(feet) => onPatch({ ledge: { depthFeet: detail.ledge?.depthFeet ?? DEFAULT_LEDGE_DEPTH_FEET, heightFeet: feet } })}
        onClear={() => onPatch({ ledge: undefined })}
      />
      {detail.ledge && (
        <MeasureField
          id="wall-ledge-depth"
          label="Ledge depth"
          hint="How far it stands out from the wall above it."
          valueFeet={detail.ledge.depthFeet}
          onCommit={(feet) => onPatch({ ledge: { heightFeet: detail.ledge!.heightFeet, depthFeet: feet } })}
        />
      )}
    </>
  );
}

/** A ledge's depth when one is first said: four inches, a foundation wall's step. */
const DEFAULT_LEDGE_DEPTH_FEET = 4 / 12;

/**
 * The room's finish (2026-10-21): what its ceiling is finished with, whether its walls are unfinished,
 * and crown on every wall at once - a tick that sets each wall's own (`WallDetail.crown`), ticked when
 * every wall has it.
 */
export function RoomFinishFields({ room, onChange }: { room: SketchRoom; onChange: (update: (room: SketchRoom) => SketchRoom) => void }) {
  const walls = wallsOf(room);
  const allCrown = walls.length > 0 && walls.every((w) => room.wallDetails?.[w.id]?.crown === true);
  return (
    <>
      <div className="question">
        <label className="prompt" htmlFor="sketch-ceiling-finish">
          Ceiling finish
        </label>
        <select
          id="sketch-ceiling-finish"
          value={room.ceilingFinish ?? ""}
          onChange={(e) =>
            onChange((r) => {
              if (e.target.value !== "") return { ...r, ceilingFinish: e.target.value as CeilingFinish };
              const rest = { ...r };
              delete rest.ceilingFinish;
              return rest;
            })
          }
        >
          <option value="">Not said</option>
          {(Object.keys(CEILING_FINISH_LABEL) as CeilingFinish[]).map((finish) => (
            <option key={finish} value={finish}>
              {CEILING_FINISH_LABEL[finish]}
            </option>
          ))}
        </select>
      </div>
      <div className="question">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={room.unfinished === true}
            onChange={(e) =>
              onChange((r) => {
                if (e.target.checked) return { ...r, unfinished: true };
                const rest = { ...r };
                delete rest.unfinished;
                return rest;
              })
            }
          />
          Unfinished room (open studs, bare foundation)
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={allCrown}
            onChange={(e) => onChange((r) => wallsOf(r).reduce((acc, w) => withWallDetail(acc, w.id, { crown: e.target.checked }), r))}
          />
          Crown moulding on every wall
        </label>
        <p className="field-note">Tap a wall for its own trim: crown, a plant ledge, wainscot, a ledge, a half wall.</p>
      </div>
    </>
  );
}
