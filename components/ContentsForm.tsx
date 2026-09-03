import type { ContentsTM, DisposalType } from "@/lib/contentsTM";
import { CONSUMABLE_ITEMS, DISPOSAL_OPTIONS } from "@/lib/contentsTM";

type HoursField = "onSiteManipulationHours" | "packOutHours" | "packBackHours";

type Props = {
  tm: ContentsTM;
  onHoursChange: (field: HoursField, value: string) => void;
  onConsumableChange: (itemId: string, value: string) => void;
  onTruckChargeChange: (value: string) => void;
  onDisposalTypeChange: (value: DisposalType | null) => void;
  onOtherAdditionsChange: (value: string) => void;
};

/**
 * The Time & Material contents form — see lib/contentsTM.ts's doc comment for why this has no
 * gap-check and no Claude call behind it. Every field is optional; leaving a whole group blank
 * (e.g. no consumables at all) is expected, not an error — buildContentsScopeSection just omits
 * whatever subheading would otherwise have nothing under it.
 */
export function ContentsForm({ tm, onHoursChange, onConsumableChange, onTruckChargeChange, onDisposalTypeChange, onOtherAdditionsChange }: Props) {
  return (
    <>
      <div className="intake-grid">
        <NumberField id="onSiteManipulationHours" label="Labor hours – on-site manipulation" value={tm.onSiteManipulationHours} onChange={(v) => onHoursChange("onSiteManipulationHours", v)} />
        <NumberField id="packOutHours" label="Labor hours – pack out" value={tm.packOutHours} onChange={(v) => onHoursChange("packOutHours", v)} />
        <NumberField id="packBackHours" label="Labor hours – pack back" value={tm.packBackHours} onChange={(v) => onHoursChange("packBackHours", v)} />
      </div>

      <h3 className="intake-subheading">Consumables Used on Pack Out</h3>
      <div className="intake-grid">
        {CONSUMABLE_ITEMS.map((item) => (
          <NumberField
            key={item.id}
            id={`consumable-${item.id}`}
            label={`${item.label} (${item.unit})`}
            value={tm.consumables[item.id] ?? ""}
            onChange={(v) => onConsumableChange(item.id, v)}
          />
        ))}
      </div>

      <h3 className="intake-subheading">Equipment &amp; Other Charges</h3>
      <div className="intake-grid">
        <NumberField
          id="truckChargeCount"
          label="Moving van/truck charges"
          placeholder="Usually 1 for pack out + 1 for pack back"
          value={tm.truckChargeCount}
          onChange={onTruckChargeChange}
        />
        <div className="question">
          <label className="prompt">Disposal</label>
          <div className="option-group" role="radiogroup" aria-label="Disposal">
            {DISPOSAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`option-btn${tm.disposalType === opt.value ? " selected" : ""}`}
                aria-pressed={tm.disposalType === opt.value}
                onClick={() => onDisposalTypeChange(tm.disposalType === opt.value ? null : opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <h3 className="intake-subheading">Anything Else</h3>
      <div className="question">
        <label className="prompt" htmlFor="contents-other">
          Other additions
        </label>
        <textarea
          id="contents-other"
          placeholder="Sub-trade items or anything else not listed above — goes into the scope exactly as typed"
          value={tm.otherAdditions}
          onChange={(e) => onOtherAdditionsChange(e.target.value)}
        />
      </div>
    </>
  );
}

function NumberField({ id, label, placeholder, value, onChange }: { id: string; label: string; placeholder?: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="question">
      <label className="prompt" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="number" inputMode="decimal" min={0} step="any" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
