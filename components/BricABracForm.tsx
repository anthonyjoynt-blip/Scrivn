import type { BricABracData, ContentSize } from "@/lib/bricABrac";
import { BOX_ITEMS, CONTENT_SIZE_OPTIONS } from "@/lib/bricABrac";
import type { BoxCleanFamily, BoxCleanSize, CleanIntensity, Density } from "@/lib/contentCleaning";
import { emptyContentCleaning } from "@/lib/contentCleaning";
import type { DisposalType } from "@/lib/contentsTM";
import { DISPOSAL_OPTIONS } from "@/lib/contentsTM";
import { ContentCleaningSection } from "./ContentCleaningSection";

type Props = {
  data: BricABracData;
  onAddRoom: () => void;
  onRemoveRoom: (id: string) => void;
  onRoomNameChange: (id: string, value: string) => void;
  onRoomSizeChange: (id: string, value: ContentSize) => void;
  onRoomItemsChange: (id: string, value: string) => void;
  onRoomBoxChange: (id: string, itemId: string, value: string) => void;
  onRoomOtherConsumablesChange: (id: string, value: string) => void;
  onRoomBlanketsChange: (id: string, value: string) => void;
  onToggleCleaning: (value: boolean) => void;
  onToggleBoxCleaning: (value: boolean) => void;
  onAddBoxEntry: () => void;
  onRemoveBoxEntry: (id: string) => void;
  onBoxEntryFamilyChange: (id: string, value: BoxCleanFamily) => void;
  onBoxEntrySizeChange: (id: string, value: BoxCleanSize) => void;
  onBoxEntryCountChange: (id: string, value: string) => void;
  onBoxEntryIntensityChange: (id: string, value: CleanIntensity) => void;
  onBoxEntryDensityChange: (id: string, value: Density) => void;
  onIndividualItemsChange: (value: string) => void;
  onNonRestorableChange: (value: string) => void;
  onTruckChargeChange: (value: string) => void;
  onDisposalTypeChange: (value: DisposalType | null) => void;
};

/**
 * The bric-a-brac contents form — see lib/bricABrac.ts's doc comment for the overall approach.
 * Rooms are repeatable — a claim can have as many as it needs, each independent. Content cleaning
 * (see ContentCleaningSection) is a claim-level add-on rendered after the rooms.
 */
export function BricABracForm({
  data,
  onAddRoom,
  onRemoveRoom,
  onRoomNameChange,
  onRoomSizeChange,
  onRoomItemsChange,
  onRoomBoxChange,
  onRoomOtherConsumablesChange,
  onRoomBlanketsChange,
  onToggleCleaning,
  onToggleBoxCleaning,
  onAddBoxEntry,
  onRemoveBoxEntry,
  onBoxEntryFamilyChange,
  onBoxEntrySizeChange,
  onBoxEntryCountChange,
  onBoxEntryIntensityChange,
  onBoxEntryDensityChange,
  onIndividualItemsChange,
  onNonRestorableChange,
  onTruckChargeChange,
  onDisposalTypeChange,
}: Props) {
  return (
    <>
      {data.rooms.map((room, index) => (
        <div className="bric-a-brac-room" key={room.id}>
          <div className="bric-a-brac-room-header">
            <h3 className="intake-subheading bric-a-brac-room-title">Room {index + 1}</h3>
            {data.rooms.length > 1 && (
              <button type="button" className="btn-secondary" onClick={() => onRemoveRoom(room.id)}>
                Remove
              </button>
            )}
          </div>

          <div className="intake-grid">
            <div className="question">
              <label className="prompt" htmlFor={`room-${room.id}-name`}>
                Room name
              </label>
              <input id={`room-${room.id}-name`} type="text" value={room.roomName} onChange={(e) => onRoomNameChange(room.id, e.target.value)} />
            </div>
            <div className="question">
              <label className="prompt">Content size</label>
              <div className="option-group" role="radiogroup" aria-label={`Content size — Room ${index + 1}`}>
                {CONTENT_SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`option-btn${room.contentSize === opt.value ? " selected" : ""}`}
                    aria-pressed={room.contentSize === opt.value}
                    onClick={() => onRoomSizeChange(room.id, opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="question">
            <label className="prompt" htmlFor={`room-${room.id}-items`}>
              Larger unboxable items <span className="field-hint">(one per line; the count comes from the list)</span>
            </label>
            <textarea
              id={`room-${room.id}-items`}
              placeholder={"e.g.\nGrandfather clock\nArea rug"}
              value={room.unboxableItems}
              onChange={(e) => onRoomItemsChange(room.id, e.target.value)}
            />
          </div>

          <div className="intake-grid">
            {BOX_ITEMS.map((item) => (
              <div className="question" key={item.id}>
                <label className="prompt" htmlFor={`room-${room.id}-box-${item.id}`}>
                  {item.label}
                </label>
                <input
                  id={`room-${room.id}-box-${item.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={room.boxes[item.id] ?? ""}
                  onChange={(e) => onRoomBoxChange(room.id, item.id, e.target.value)}
                />
              </div>
            ))}
            <div className="question">
              <label className="prompt" htmlFor={`room-${room.id}-other-consumables`}>
                Other consumables <span className="field-hint">(anything not listed above, goes into the scope as typed)</span>
              </label>
              <input
                id={`room-${room.id}-other-consumables`}
                type="text"
                value={room.otherConsumables}
                onChange={(e) => onRoomOtherConsumablesChange(room.id, e.target.value)}
              />
            </div>
            <div className="question">
              <label className="prompt" htmlFor={`room-${room.id}-blankets`}>
                Moving blankets used
              </label>
              <input
                id={`room-${room.id}-blankets`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={room.movingBlankets}
                onChange={(e) => onRoomBlanketsChange(room.id, e.target.value)}
              />
            </div>
          </div>
        </div>
      ))}

      <div className="actions-row bric-a-brac-add-row">
        <button type="button" className="btn-secondary" onClick={onAddRoom}>
          + Add Room
        </button>
      </div>

      <ContentCleaningSection
        // Defensive: React Fast Refresh can preserve a component's existing state across a dev-mode
        // edit that adds a new field to that state's shape, leaving `cleaning` undefined until a
        // fresh page load — this crashed exactly that way once (round 8). Can't happen for a real
        // user (there's no persistence — a fresh session always gets emptyBricABracData()'s full
        // shape), but costs nothing to guard here too.
        cleaning={data.cleaning ?? emptyContentCleaning()}
        onToggleCleaning={onToggleCleaning}
        onToggleBoxCleaning={onToggleBoxCleaning}
        onAddBoxEntry={onAddBoxEntry}
        onRemoveBoxEntry={onRemoveBoxEntry}
        onBoxEntryFamilyChange={onBoxEntryFamilyChange}
        onBoxEntrySizeChange={onBoxEntrySizeChange}
        onBoxEntryCountChange={onBoxEntryCountChange}
        onBoxEntryIntensityChange={onBoxEntryIntensityChange}
        onBoxEntryDensityChange={onBoxEntryDensityChange}
        onIndividualItemsChange={onIndividualItemsChange}
      />

      <h3 className="intake-subheading">General</h3>
      <div className="intake-grid">
        <div className="question">
          <label className="prompt" htmlFor="nrCount">
            Non-restorable content <span className="field-hint">(number of items)</span>
          </label>
          <input id="nrCount" type="number" inputMode="decimal" min={0} step="any" value={data.nonRestorableCount} onChange={(e) => onNonRestorableChange(e.target.value)} />
        </div>
        <div className="question">
          <label className="prompt" htmlFor="truckCount">
            Moving van/truck charges
          </label>
          <input id="truckCount" type="number" inputMode="decimal" min={0} step="any" value={data.truckChargeCount} onChange={(e) => onTruckChargeChange(e.target.value)} />
        </div>
        <div className="question">
          <label className="prompt">Disposal</label>
          <div className="option-group" role="radiogroup" aria-label="Disposal">
            {DISPOSAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`option-btn${data.disposalType === opt.value ? " selected" : ""}`}
                aria-pressed={data.disposalType === opt.value}
                onClick={() => onDisposalTypeChange(data.disposalType === opt.value ? null : opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
