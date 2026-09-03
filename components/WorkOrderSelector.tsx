import type { Trade } from "@/lib/workOrders";
import { TRADE_LABEL } from "@/lib/workOrders";

/**
 * The trade picker shown after the scope and inspection report exist. Multi-select — a claim
 * usually needs several trades, and generating them one at a time would mean repeating the step.
 *
 * Only trades relevant to this claim's `scopePhases` are passed in (see `availableTrades`), so this
 * component renders whatever it's given rather than deciding relevance itself.
 */
export function WorkOrderSelector({
  available,
  selected,
  unavailableNote,
  onToggle,
  onGenerate,
}: {
  available: Trade[];
  selected: Trade[];
  unavailableNote: string | null;
  onToggle: (trade: Trade) => void;
  onGenerate: () => void;
}) {
  return (
    <div className="card">
      <h2>Work orders</h2>
      <p className="subtitle" style={{ marginBottom: 20 }}>
        Optional crew-facing sheets, one per trade. Built from the scope you’ve already generated — nothing is re-extracted, and generating them doesn’t count against your claim limit.
      </p>

      <div className="question">
        <label className="prompt">Which trades need a work order?</label>
        <div className="option-group" role="group" aria-label="Trades">
          {available.map((trade) => (
            <button
              key={trade}
              type="button"
              className={`option-btn${selected.includes(trade) ? " selected" : ""}`}
              aria-pressed={selected.includes(trade)}
              onClick={() => onToggle(trade)}
            >
              {TRADE_LABEL[trade]}
            </button>
          ))}
        </div>
        {unavailableNote && <p className="field-note">{unavailableNote}</p>}
      </div>

      <div className="actions-row">
        <button className="btn-primary" onClick={onGenerate} disabled={selected.length === 0}>
          {selected.length === 0 ? "Select a trade" : `Generate ${selected.length} work order${selected.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
