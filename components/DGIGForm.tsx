import type { AntimicrobialExtent, DGIGData, DisposalType, DryingClass } from "@/lib/dgig";
import { ANTIMICROBIAL_EXTENT_OPTIONS, DISPOSAL_OPTIONS, DRYING_CLASS_OPTIONS } from "@/lib/dgig";

type Props = {
  data: DGIGData;
  onGeneralHoursChange: (field: "pmInspectionHours" | "travelHours" | "equipmentMonitoringHours", value: string) => void;
  onDisposalTypeChange: (value: DisposalType | null) => void;
  onAddRoom: () => void;
  onRemoveRoom: (id: string) => void;
  onRoomNameChange: (id: string, value: string) => void;
  onRoomTearOutHoursChange: (id: string, value: string) => void;
  onRoomTearOutDescriptionChange: (id: string, value: string) => void;
  onRoomContentManipulationHoursChange: (id: string, value: string) => void;
  onRoomWaterExtractionHoursChange: (id: string, value: string) => void;
  onRoomCleaningHoursChange: (id: string, value: string) => void;
  onRoomDryingClassChange: (id: string, value: DryingClass) => void;
  onRoomAntimicrobialChange: (id: string, value: boolean) => void;
  onRoomAntimicrobialSFChange: (id: string, value: string) => void;
  onRoomAntimicrobialExtentChange: (id: string, value: AntimicrobialExtent | null) => void;
  onRoomOtherNotesChange: (id: string, value: string) => void;
};

/**
 * DGIG's labor-hour-based Emergency form — see lib/dgig.ts's doc comment. Filled in FIRST, before
 * any transcript/dictation — every field here is a direct selector/hours entry, nothing needs to be
 * gleaned from a walkthrough. "What was torn out" per room does double duty: it's the F9 note on
 * that room's Emergency line, and it's also the text the repair scope gets built from next (see
 * app/page.tsx's handleContinueFromDGIGForm) — the follow-up questions after this step (if any) are
 * about that repair detail, not about anything on this form.
 */
export function DGIGForm({
  data,
  onGeneralHoursChange,
  onDisposalTypeChange,
  onAddRoom,
  onRemoveRoom,
  onRoomNameChange,
  onRoomTearOutHoursChange,
  onRoomTearOutDescriptionChange,
  onRoomContentManipulationHoursChange,
  onRoomWaterExtractionHoursChange,
  onRoomCleaningHoursChange,
  onRoomDryingClassChange,
  onRoomAntimicrobialChange,
  onRoomAntimicrobialSFChange,
  onRoomAntimicrobialExtentChange,
  onRoomOtherNotesChange,
}: Props) {
  return (
    <>
      <h3 className="intake-subheading">General</h3>
      <div className="intake-grid">
        <div className="question">
          <label className="prompt" htmlFor="dgig-pmInspectionHours">
            PM inspection <span className="field-hint">(hours)</span>
          </label>
          <input
            id="dgig-pmInspectionHours"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={data.pmInspectionHours}
            onChange={(e) => onGeneralHoursChange("pmInspectionHours", e.target.value)}
          />
        </div>
        <div className="question">
          <label className="prompt" htmlFor="dgig-travelHours">
            Travel <span className="field-hint">(hours)</span>
          </label>
          <input id="dgig-travelHours" type="number" inputMode="decimal" min={0} step="any" value={data.travelHours} onChange={(e) => onGeneralHoursChange("travelHours", e.target.value)} />
        </div>
        <div className="question">
          <label className="prompt" htmlFor="dgig-equipmentMonitoringHours">
            Equipment monitoring <span className="field-hint">(hours — setup, takedown &amp; monitoring)</span>
          </label>
          <input
            id="dgig-equipmentMonitoringHours"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={data.equipmentMonitoringHours}
            onChange={(e) => onGeneralHoursChange("equipmentMonitoringHours", e.target.value)}
          />
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
              <label className="prompt" htmlFor={`dgig-room-${room.id}-name`}>
                Room name
              </label>
              <input id={`dgig-room-${room.id}-name`} type="text" value={room.roomName} onChange={(e) => onRoomNameChange(room.id, e.target.value)} />
            </div>
            <div className="question">
              <label className="prompt" htmlFor={`dgig-room-${room.id}-tearOutHours`}>
                Tear out <span className="field-hint">(hours)</span>
              </label>
              <input
                id={`dgig-room-${room.id}-tearOutHours`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={room.tearOutHours}
                onChange={(e) => onRoomTearOutHoursChange(room.id, e.target.value)}
              />
            </div>
            <div className="question">
              <label className="prompt" htmlFor={`dgig-room-${room.id}-contentManipulationHours`}>
                Content manipulation <span className="field-hint">(hours)</span>
              </label>
              <input
                id={`dgig-room-${room.id}-contentManipulationHours`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={room.contentManipulationHours}
                onChange={(e) => onRoomContentManipulationHoursChange(room.id, e.target.value)}
              />
            </div>
            <div className="question">
              <label className="prompt" htmlFor={`dgig-room-${room.id}-waterExtractionHours`}>
                Water extraction <span className="field-hint">(hours)</span>
              </label>
              <input
                id={`dgig-room-${room.id}-waterExtractionHours`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={room.waterExtractionHours}
                onChange={(e) => onRoomWaterExtractionHoursChange(room.id, e.target.value)}
              />
            </div>
            <div className="question">
              <label className="prompt" htmlFor={`dgig-room-${room.id}-cleaningHours`}>
                Cleaning <span className="field-hint">(hours)</span>
              </label>
              <input
                id={`dgig-room-${room.id}-cleaningHours`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={room.cleaningHours}
                onChange={(e) => onRoomCleaningHoursChange(room.id, e.target.value)}
              />
            </div>
          </div>

          <div className="question">
            <label className="prompt" htmlFor={`dgig-room-${room.id}-tearOutDescription`}>
              What was torn out <span className="field-hint">(becomes an F9 note here, and drives the repair scope for this room next)</span>
            </label>
            <input
              id={`dgig-room-${room.id}-tearOutDescription`}
              type="text"
              placeholder="e.g. carpet and pad, baseboards"
              value={room.tearOutDescription}
              onChange={(e) => onRoomTearOutDescriptionChange(room.id, e.target.value)}
            />
          </div>

          <div className="question">
            <label className="checkbox-label">
              <input type="checkbox" checked={room.antimicrobial} onChange={(e) => onRoomAntimicrobialChange(room.id, e.target.checked)} />
              Antimicrobial
            </label>
          </div>
          <div className="intake-grid">
            <div className="question">
              <label className="prompt" htmlFor={`dgig-room-${room.id}-antimicrobialSF`}>
                Antimicrobial area <span className="field-hint">(exact SF)</span>
              </label>
              <input
                id={`dgig-room-${room.id}-antimicrobialSF`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={room.antimicrobialSF}
                onChange={(e) => onRoomAntimicrobialSFChange(room.id, e.target.value)}
              />
            </div>
            <div className="question">
              <label className="prompt">Or extent</label>
              <div className="option-group" role="radiogroup" aria-label={`Antimicrobial extent — Room ${index + 1}`}>
                {ANTIMICROBIAL_EXTENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`option-btn${room.antimicrobialExtent === opt.value ? " selected" : ""}`}
                    aria-pressed={room.antimicrobialExtent === opt.value}
                    onClick={() => onRoomAntimicrobialExtentChange(room.id, room.antimicrobialExtent === opt.value ? null : opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="question">
            <label className="prompt" htmlFor={`dgig-room-${room.id}-otherNotes`}>
              Anything else not captured above <span className="field-hint">(goes into the scope as typed)</span>
            </label>
            <input id={`dgig-room-${room.id}-otherNotes`} type="text" value={room.otherNotes} onChange={(e) => onRoomOtherNotesChange(room.id, e.target.value)} />
          </div>

          <div className="question">
            <label className="prompt">Drying class</label>
            <div className="option-group" role="radiogroup" aria-label={`Drying class — Room ${index + 1}`}>
              {DRYING_CLASS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`option-btn${room.dryingClass === opt.value ? " selected" : ""}`}
                  aria-pressed={room.dryingClass === opt.value}
                  onClick={() => onRoomDryingClassChange(room.id, opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="field-note">
              {DRYING_CLASS_OPTIONS.map((opt) => `${opt.label} – ${opt.description}`).join(" ")}
            </p>
          </div>
        </div>
      ))}

      <div className="actions-row bric-a-brac-add-row">
        <button type="button" className="btn-secondary" onClick={onAddRoom}>
          + Add Room
        </button>
      </div>
    </>
  );
}
