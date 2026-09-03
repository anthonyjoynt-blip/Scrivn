import type { ClaimInfo, LossType, ScopePhase } from "@/lib/claimInfo";
import { LOSS_TYPE_OPTIONS, availableScopePhases, usesReducedIntake } from "@/lib/claimInfo";
import { KNOWN_INSURERS } from "@/lib/insurers";

type TextField = "customerName" | "jobNumber" | "claimNumber" | "address" | "insurer" | "pmName" | "causeOfLoss" | "preExistingConditions" | "lossTypeOther";

/**
 * `scopeOnlyRelevant` fields are the only ones shown at all when `usesReducedIntake(claim)` is true
 * — see `isClaimIdentityComplete`, which requires the same subset. Insurer is listed here (so
 * `isClaimIdentityComplete`'s field set and this list stay in sync) but rendered separately, below
 * the grid — see the dedicated insurer block in the component body — since it needs the quick-fill
 * dropdown + free-text pair rather than the plain `<TextField>` every other entry here gets.
 */
const IDENTITY_FIELDS: { field: TextField; label: string; scopeOnlyRelevant?: boolean }[] = [
  { field: "customerName", label: "Customer name", scopeOnlyRelevant: true },
  { field: "jobNumber", label: "Job number", scopeOnlyRelevant: true },
  { field: "claimNumber", label: "Claim number" },
  { field: "address", label: "Property address" },
  { field: "insurer", label: "Insurer", scopeOnlyRelevant: true },
  { field: "pmName", label: "Project manager" },
];

type Props = {
  claim: ClaimInfo;
  onTextChange: (field: TextField, value: string) => void;
  onLossTypeChange: (value: LossType) => void;
  onCategoryChange: (value: number | null) => void;
  onClassChange: (value: number | null) => void;
  onYearOfBuildingChange: (value: string) => void;
  onDateOfLossChange: (value: string) => void;
  onDateTimeInspectedChange: (value: string) => void;
  onScopeOnlyChange: (value: boolean) => void;
  onScopePhaseToggle: (value: ScopePhase) => void;
};

/**
 * Step 1: everything the report needs that isn't derived from the transcript — identity fields
 * plus (as of round 6) the report-level fields that used to be gap-checked after extraction, plus
 * (round 7) the scope-only toggle and the phase question, plus (round 10) the loss-type question.
 * See claimInfo.ts's file doc comment for why the report-level fields live here, `ScopePhase`'s doc
 * comment for the phases, and `ClaimInfo.lossType`'s doc comment for the loss-type question.
 */
export function ClaimIntakeForm({
  claim,
  onTextChange,
  onLossTypeChange,
  onCategoryChange,
  onClassChange,
  onYearOfBuildingChange,
  onDateOfLossChange,
  onDateTimeInspectedChange,
  onScopeOnlyChange,
  onScopePhaseToggle,
}: Props) {
  const reducedIntake = usesReducedIntake(claim);
  const identityFields = (reducedIntake ? IDENTITY_FIELDS.filter((f) => f.scopeOnlyRelevant) : IDENTITY_FIELDS).filter((f) => f.field !== "insurer");

  return (
    <>
      <div className="question scope-only-toggle">
        <label className="checkbox-label">
          <input type="checkbox" checked={claim.scopeOnly} onChange={(e) => onScopeOnlyChange(e.target.checked)} />
          Scope document only — skip the inspection report
        </label>
        {claim.scopeOnly && (
          <p className="field-note">
            This won’t generate an inspection report summarizing insured information and damages — just the scope document. Only customer name, job number, insurer, category, and class are needed below.
          </p>
        )}
      </div>

      <div className="intake-grid">
        {identityFields.map(({ field, label }) => (
          <TextField key={field} field={field} label={label} value={claim[field] ?? ""} onChange={onTextChange} />
        ))}
      </div>

      <div className="question">
        <label className="prompt" htmlFor="intake-insurer">
          Insurer
        </label>
        {/* One field, not two — native <input list> gives browser-driven autocomplete against
            KNOWN_INSURERS as they type, while still accepting anything else they type as-is (no
            dropdown chrome, no separate text field). Per direct feedback on the earlier <select> +
            text-input pair: "are we able to do this in one box somehow where we can type it out and
            we can autofill into the insurer that is being typed or if they type something different
            then fine thats how itll go." */}
        <input id="intake-insurer" type="text" list="intake-insurer-options" placeholder="Start typing…" value={claim.insurer} onChange={(e) => onTextChange("insurer", e.target.value)} />
        <datalist id="intake-insurer-options">
          {KNOWN_INSURERS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      <h3 className="intake-subheading">Loss Details</h3>
      <div className="question">
        <label className="prompt">Type of loss</label>
        <div className="option-group" role="radiogroup" aria-label="Type of loss">
          {LOSS_TYPE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`option-btn${claim.lossType === value ? " selected" : ""}`}
              aria-pressed={claim.lossType === value}
              onClick={() => onLossTypeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* "Other" on its own says nothing — what it actually was has to be recorded. */}
        {claim.lossType === "OTHER" && (
          <input
            type="text"
            className="loss-type-other"
            placeholder="What kind of loss? e.g. impact, vehicle, vandalism"
            aria-label="Describe the type of loss"
            value={claim.lossTypeOther}
            onChange={(e) => onTextChange("lossTypeOther", e.target.value)}
          />
        )}
      </div>
      <div className="intake-grid">
        <div className="question">
          <label className="prompt">IICRC water category</label>
          <div className="option-group" role="radiogroup" aria-label="IICRC water category">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={`option-btn${claim.waterCategory === n ? " selected" : ""}`} aria-pressed={claim.waterCategory === n} onClick={() => onCategoryChange(n)}>
                {n}
              </button>
            ))}
            <button type="button" className={`option-btn${claim.waterCategory === null ? " selected" : ""}`} aria-pressed={claim.waterCategory === null} onClick={() => onCategoryChange(null)}>
              N/A
            </button>
          </div>
        </div>
        <div className="question">
          <label className="prompt">IICRC water class</label>
          <div className="option-group" role="radiogroup" aria-label="IICRC water class">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" className={`option-btn${claim.waterClass === n ? " selected" : ""}`} aria-pressed={claim.waterClass === n} onClick={() => onClassChange(n)}>
                {n}
              </button>
            ))}
            <button type="button" className={`option-btn${claim.waterClass === null ? " selected" : ""}`} aria-pressed={claim.waterClass === null} onClick={() => onClassChange(null)}>
              N/A
            </button>
          </div>
        </div>
        {!reducedIntake && (
          <>
            <div className="question">
              <label className="prompt" htmlFor="intake-yearOfBuilding">
                Year building was built
              </label>
              <input
                id="intake-yearOfBuilding"
                type="number"
                inputMode="numeric"
                step={1}
                value={claim.yearOfBuilding ?? ""}
                onChange={(e) => onYearOfBuildingChange(e.target.value)}
              />
            </div>
            <div className="question">
              <label className="prompt" htmlFor="intake-dateOfLoss">
                Date of loss
              </label>
              <input id="intake-dateOfLoss" type="date" value={claim.dateOfLoss ?? ""} onChange={(e) => onDateOfLossChange(e.target.value)} />
            </div>
            <TextField field="causeOfLoss" label="Cause of loss" value={claim.causeOfLoss} onChange={onTextChange} />
            <TextField field="preExistingConditions" label="Pre-existing conditions" placeholder='Enter "None" if there aren’t any' value={claim.preExistingConditions} onChange={onTextChange} />
            <div className="question">
              <label className="prompt" htmlFor="intake-dateTimeInspected">
                Date/time inspected
              </label>
              <input id="intake-dateTimeInspected" type="datetime-local" value={claim.dateTimeInspected} onChange={(e) => onDateTimeInspectedChange(e.target.value)} />
            </div>
          </>
        )}
      </div>

      <h3 className="intake-subheading">Scope Details</h3>
      <div className="question">
        <label className="prompt">What would you like to scope?</label>
        <div className="option-group" role="group" aria-label="What would you like to scope?">
          {availableScopePhases(claim).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`option-btn${claim.scopePhases.includes(value) ? " selected" : ""}`}
              aria-pressed={claim.scopePhases.includes(value)}
              onClick={() => onScopePhaseToggle(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="field-note">
          Select any combination — e.g. Repair and Contents without Emergency, if that’s all this claim needs.
          {claim.lossType === "REMEDIATION" && " Remediation can stand on its own: it’s a form, so there’s nothing to dictate."}
        </p>
      </div>
    </>
  );
}

function TextField({
  field,
  label,
  placeholder,
  value,
  onChange,
}: {
  field: TextField;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (field: TextField, value: string) => void;
}) {
  return (
    <div className="question">
      <label className="prompt" htmlFor={`intake-${field}`}>
        {label}
      </label>
      <input id={`intake-${field}`} type="text" placeholder={placeholder} value={value} onChange={(e) => onChange(field, e.target.value)} />
    </div>
  );
}
