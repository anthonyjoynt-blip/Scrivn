import type { BoxCleanFamily, BoxCleanSize, CleanIntensity, ContentCleaning, Density } from "@/lib/contentCleaning";
import { BOX_CLEAN_FAMILY_OPTIONS, BOX_CLEAN_SIZE_OPTIONS, CLEAN_INTENSITY_OPTIONS, DENSITY_OPTIONS } from "@/lib/contentCleaning";

type Props = {
  cleaning: ContentCleaning;
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
};

/**
 * The content-cleaning branch of the bric-a-brac form — see lib/contentCleaning.ts's doc comment.
 * Box entries are fully deterministic (no Claude call); individually-listed items print as a plain
 * list for the estimator until line-item matching exists (see the "Automatic matching..." note
 * below, which is the one thing that changes once that's built).
 */
export function ContentCleaningSection({
  cleaning,
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
}: Props) {
  return (
    <>
      <h3 className="intake-subheading">Content Cleaning</h3>
      <div className="question scope-only-toggle">
        <label className="checkbox-label">
          <input type="checkbox" checked={cleaning.isCleaningContent} onChange={(e) => onToggleCleaning(e.target.checked)} />
          Are we cleaning content?
        </label>
      </div>

      {cleaning.isCleaningContent && (
        <>
          <div className="question">
            <label className="checkbox-label">
              <input type="checkbox" checked={cleaning.isCleaningBoxes} onChange={(e) => onToggleBoxCleaning(e.target.checked)} />
              Cleaning and repacking boxes?
            </label>
          </div>

          {cleaning.isCleaningBoxes &&
            cleaning.boxEntries.map((entry, index) => (
              <div className="bric-a-brac-room" key={entry.id}>
                <div className="bric-a-brac-room-header">
                  <h4 className="intake-subheading bric-a-brac-room-title">Box entry {index + 1}</h4>
                  {cleaning.boxEntries.length > 1 && (
                    <button type="button" className="btn-secondary" onClick={() => onRemoveBoxEntry(entry.id)}>
                      Remove
                    </button>
                  )}
                </div>
                <div className="intake-grid">
                  <div className="question">
                    <label className="prompt">Box type</label>
                    <div className="option-group" role="radiogroup" aria-label={`Box type — entry ${index + 1}`}>
                      {BOX_CLEAN_FAMILY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`option-btn${entry.family === opt.value ? " selected" : ""}`}
                          aria-pressed={entry.family === opt.value}
                          onClick={() => onBoxEntryFamilyChange(entry.id, opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="question">
                    <label className="prompt">Size</label>
                    <div className="option-group" role="radiogroup" aria-label={`Box size — entry ${index + 1}`}>
                      {BOX_CLEAN_SIZE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`option-btn${entry.size === opt.value ? " selected" : ""}`}
                          aria-pressed={entry.size === opt.value}
                          onClick={() => onBoxEntrySizeChange(entry.id, opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="question">
                    <label className="prompt" htmlFor={`box-${entry.id}-count`}>
                      How many
                    </label>
                    <input
                      id={`box-${entry.id}-count`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={entry.count}
                      onChange={(e) => onBoxEntryCountChange(entry.id, e.target.value)}
                    />
                  </div>
                  <div className="question">
                    <label className="prompt">Clean intensity</label>
                    <div className="option-group" role="radiogroup" aria-label={`Clean intensity — entry ${index + 1}`}>
                      {CLEAN_INTENSITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`option-btn${entry.intensity === opt.value ? " selected" : ""}`}
                          aria-pressed={entry.intensity === opt.value}
                          onClick={() => onBoxEntryIntensityChange(entry.id, opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="question">
                    <label className="prompt">Density</label>
                    <div className="option-group" role="radiogroup" aria-label={`Density — entry ${index + 1}`}>
                      {DENSITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`option-btn${entry.density === opt.value ? " selected" : ""}`}
                          aria-pressed={entry.density === opt.value}
                          onClick={() => onBoxEntryDensityChange(entry.id, opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}

          {cleaning.isCleaningBoxes && (
            <div className="actions-row bric-a-brac-add-row">
              <button type="button" className="btn-secondary" onClick={onAddBoxEntry}>
                + Add Box Entry
              </button>
            </div>
          )}

          <div className="question">
            <label className="prompt" htmlFor="cleaning-individual-items">
              Items requiring individual cleaning <span className="field-hint">(one per line; pre-filled from each room’s unboxable items, edit as needed)</span>
            </label>
            <textarea id="cleaning-individual-items" value={cleaning.individualItemsText} onChange={(e) => onIndividualItemsChange(e.target.value)} />
          </div>
          <p className="field-note">These items print in the scope as a plain list, in your own words — the estimator assigns the line item.</p>
        </>
      )}
    </>
  );
}
