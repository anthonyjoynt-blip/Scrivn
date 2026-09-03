"use client";

import type { Sketch, SketchRoom } from "@/lib/sketch";
import { SURFACE_LABEL, SURFACES, type Surface, containedLabel, surfaceLabel } from "@/lib/containment";
import {
  type AsbestosScope,
  type AsbestosType,
  type DeconChamber,
  ASBESTOS_TYPE_LABEL,
  DECON_CHAMBER_LABEL,
  DEFAULT_AIR_CHANGES,
  DEFAULT_NEGATIVE_AIR_SIZE,
  HEPA_FILTER_HOURS,
  NEGATIVE_AIR_ORDER,
  NEGATIVE_AIR_SIZES,
  type NegativeAirSize,
  RESPIRATOR_OPTIONS,
  SUIT_OPTIONS,
  asbestosCalculations,
  resolveSampleCount,
} from "@/lib/asbestos";

/**
 * The asbestos abatement form — see `lib/asbestos.ts` for why there is no dictation, no extraction
 * and no Claude call behind it.
 *
 * The panel at the bottom shows what the entries add up to as they are entered. That is the whole
 * argument for deriving the Type rather than asking for it: the PM states two facts they can
 * observe and immediately sees the classification, the containment and the machine count that
 * follow, with the reasoning written out beside them and an override one tap away.
 */
export function AsbestosForm({
  scope,
  sketch,
  sampleCount,
  onChange,
}: {
  scope: AsbestosScope;
  /** Optional throughout — a mechanical room or crawlspace may never be drawn. */
  sketch: Sketch | null;
  /** Read from the claim's existing asbestos field; shown here, never re-asked. */
  sampleCount: number | null;
  onChange: (next: AsbestosScope) => void;
}) {
  const set = <K extends keyof AsbestosScope>(key: K, value: AsbestosScope[K]) => onChange({ ...scope, [key]: value });

  const sketchRoom: SketchRoom | null = scope.sketchRoomId ? (sketch?.rooms.find((r) => r.id === scope.sketchRoomId) ?? null) : null;
  const calc = asbestosCalculations(scope, sketchRoom);
  const sketchRooms = sketch?.rooms ?? [];

  return (
    <>
      <h3 className="intake-subheading">The Material</h3>
      <div className="question">
        <label className="prompt" htmlFor="asb-material">
          What is the material?
        </label>
        <input
          id="asb-material"
          type="text"
          placeholder="e.g. 9x9 floor tile and black mastic"
          value={scope.material}
          onChange={(e) => set("material", e.target.value)}
        />
      </div>

      <div className="question">
        <label className="prompt">Which surface is it coming off?</label>
        <div className="option-group" role="group" aria-label="Surface being removed">
          {SURFACES.map((s: Surface) => (
            <button
              key={s}
              type="button"
              className={`option-btn${scope.surface === s ? " selected" : ""}`}
              aria-pressed={scope.surface === s}
              onClick={() => set("surface", s)}
            >
              {SURFACE_LABEL[s]}
            </button>
          ))}
        </div>
        <p className="field-note">This drives the containment: at Type 3 every surface is sealed except the one being removed.</p>
      </div>

      {/* Walls are scoped by area like everything else; the count containment needs is worked out
          from it, and only shown so it can be corrected. */}
      {scope.surface === "wall" && (
        <>
          <NumberField
            id="asb-wall-sf"
            label="Wall area being removed (SF)"
            value={scope.wallRemovalSqFt}
            onChange={(v) => set("wallRemovalSqFt", v)}
          />
          <NumberField
            id="asb-walls-override"
            label={`How many of the room's ${4} walls that spans`}
            value={scope.wallsRemovedOverride}
            onChange={(v) => set("wallsRemovedOverride", v)}
            note={
              calc.wallRemovalSqFt === null
                ? "Leave blank to work it out from the area above. The walls that stay get contained."
                : `Blank works out to ${calc.containment.wallsRemoved} from the area and the room size. Override it if that's wrong — the walls that stay get contained.`
            }
          />
        </>
      )}

      <h3 className="intake-subheading">Classification</h3>
      <p className="field-note">
        Answer these two and the Type follows, per O. Reg. 278/05. You can override it below if the job turns on something these
        questions don&rsquo;t capture.
      </p>

      <div className="question">
        <label className="prompt">Is the material friable?</label>
        <div className="option-group" role="group" aria-label="Friable">
          <button type="button" className={`option-btn${scope.friable ? " selected" : ""}`} aria-pressed={scope.friable} onClick={() => set("friable", true)}>
            Friable
          </button>
          <button type="button" className={`option-btn${!scope.friable ? " selected" : ""}`} aria-pressed={!scope.friable} onClick={() => set("friable", false)}>
            Non-friable
          </button>
        </div>
        <p className="field-note">Friable means it can be crumbled by hand pressure when dry.</p>
      </div>

      <NumberField
        id="asb-area"
        label="Roughly how much is being disturbed? (SF)"
        value={scope.areaDisturbedSqFt}
        onChange={(v) => set("areaDisturbedSqFt", v)}
        note="Converted to square metres for the regulation's 1 m² threshold."
      />

      {/* Area alone cannot answer the dust question — a small amount of bound material still makes
          dust if the method grinds it. Only asked where it can change the answer. */}
      {!scope.friable && (
        <div className="question">
          <label className="prompt">Will the work generate more than trivial dry dust?</label>
          <div className="option-group" role="group" aria-label="Dust">
            <button
              type="button"
              className={`option-btn${scope.minimalDisturbance ? " selected" : ""}`}
              aria-pressed={scope.minimalDisturbance}
              onClick={() => set("minimalDisturbance", true)}
            >
              No — minimal
            </button>
            <button
              type="button"
              className={`option-btn${!scope.minimalDisturbance ? " selected" : ""}`}
              aria-pressed={!scope.minimalDisturbance}
              onClick={() => set("minimalDisturbance", false)}
            >
              Yes — more than trivial
            </button>
          </div>
        </div>
      )}

      <div className="question">
        <label className="prompt">Type</label>
        <div className="option-group" role="group" aria-label="Asbestos type">
          <button
            type="button"
            className={`option-btn${scope.typeOverride === null ? " selected" : ""}`}
            aria-pressed={scope.typeOverride === null}
            onClick={() => set("typeOverride", null)}
          >
            Derived — {ASBESTOS_TYPE_LABEL[calc.derivedType]}
          </button>
          {([1, 2, 3] as AsbestosType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`option-btn${scope.typeOverride === t ? " selected" : ""}`}
              aria-pressed={scope.typeOverride === t}
              onClick={() => set("typeOverride", t)}
            >
              Type {t}
            </button>
          ))}
        </div>
        <p className="field-note">{calc.typeReason}</p>
      </div>

      <h3 className="intake-subheading">The Room</h3>
      {sketchRooms.length > 0 && (
        <div className="question">
          <label className="prompt">Use a room from the sketch?</label>
          <div className="option-group" role="group" aria-label="Sketch room">
            <button
              type="button"
              className={`option-btn${scope.sketchRoomId === null ? " selected" : ""}`}
              aria-pressed={scope.sketchRoomId === null}
              onClick={() => set("sketchRoomId", null)}
            >
              Type the dimensions
            </button>
            {sketchRooms.map((room, i) => (
              <button
                key={room.id}
                type="button"
                className={`option-btn${scope.sketchRoomId === room.id ? " selected" : ""}`}
                aria-pressed={scope.sketchRoomId === room.id}
                onClick={() => set("sketchRoomId", room.id)}
              >
                {room.name.trim() || `Room ${i + 1}`}
              </button>
            ))}
          </div>
          <p className="field-note">Optional. A sketch is measured rather than remembered, but plenty of abated spaces never get drawn.</p>
        </div>
      )}

      {sketchRoom === null && (
        <div className="intake-grid">
          <NumberField id="asb-length" label="Length (ft)" value={scope.roomLengthFt} onChange={(v) => set("roomLengthFt", v)} />
          <NumberField id="asb-width" label="Width (ft)" value={scope.roomWidthFt} onChange={(v) => set("roomWidthFt", v)} />
          <NumberField id="asb-height" label="Height (ft)" value={scope.roomHeightFt} onChange={(v) => set("roomHeightFt", v)} />
        </div>
      )}

      <h3 className="intake-subheading">Crew &amp; Duration</h3>
      <div className="intake-grid">
        <NumberField id="asb-crew" label="Crew size" value={scope.crewSize} onChange={(v) => set("crewSize", v)} />
        <NumberField id="asb-days" label="Duration (days)" value={scope.durationDays} onChange={(v) => set("durationDays", v)} />
        <NumberField id="asb-hours-day" label="Hours per day" value={scope.hoursPerDay} onChange={(v) => set("hoursPerDay", v)} />
        <NumberField
          id="asb-total-hours"
          label="Or total job hours"
          value={scope.totalHoursOverride}
          onChange={(v) => set("totalHoursOverride", v)}
          note="Overrides days x hours/day."
        />
      </div>

      <h3 className="intake-subheading">Decontamination &amp; PPE</h3>
      <div className="question">
        <label className="prompt">Decon chamber</label>
        <div className="option-group" role="group" aria-label="Decon chamber">
          <button
            type="button"
            className={`option-btn${scope.deconChamber === null ? " selected" : ""}`}
            aria-pressed={scope.deconChamber === null}
            onClick={() => set("deconChamber", null)}
          >
            Default for Type {calc.type}
          </button>
          {(Object.keys(DECON_CHAMBER_LABEL) as DeconChamber[]).map((c) => (
            <button
              key={c}
              type="button"
              className={`option-btn${scope.deconChamber === c ? " selected" : ""}`}
              aria-pressed={scope.deconChamber === c}
              onClick={() => set("deconChamber", c)}
            >
              {c === "three_stage" ? "Three-stage" : "Single chamber"}
            </button>
          ))}
        </div>
        <p className="field-note">{DECON_CHAMBER_LABEL[calc.deconChamber]}</p>
      </div>

      <NumberField
        id="asb-ppe-changes"
        label="How many PPE changes?"
        value={scope.ppeChanges}
        onChange={(v) => set("ppeChanges", v)}
        note="Entered, not calculated — there is no sourced decon-cycle figure to derive it from."
      />

      <ChoiceField
        id="asb-respirator"
        label="Respiratory protection"
        options={RESPIRATOR_OPTIONS}
        value={scope.respirator}
        onChange={(v) => set("respirator", v)}
      />
      <ChoiceField id="asb-suit" label="Protective clothing" options={SUIT_OPTIONS} value={scope.suit} onChange={(v) => set("suit", v)} />
      <p className="field-note">
        Your call, not the app&rsquo;s — no verified asbestos-specific PPE tier table exists to derive this from, so nothing here is
        picked for you by Type.
      </p>

      <h3 className="intake-subheading">Equipment</h3>
      <div className="intake-grid">
        <NumberField
          id="asb-ach"
          label="Air changes per hour"
          value={scope.airChangesPerHour}
          onChange={(v) => set("airChangesPerHour", v)}
          note={`Starting value of ${DEFAULT_AIR_CHANGES} — confirm against the abatement plan and your jurisdiction.`}
        />
        <NumberField
          id="asb-ducting"
          label="Exhaust ducting (LF)"
          value={scope.ductingLinearFeet}
          onChange={(v) => set("ductingLinearFeet", v)}
          note="The run out of the containment to a window, door or shaft."
        />
        <NumberField
          id="asb-other-equipment"
          label="Other equipment units"
          value={scope.otherEquipmentUnits}
          onChange={(v) => set("otherEquipmentUnits", v)}
          note="Added to the negative air machines for the decontamination line."
        />
      </div>

      <div className="question">
        <label className="prompt">Negative air machine size</label>
        <div className="option-group" role="group" aria-label="Negative air machine size">
          <button
            type="button"
            className={`option-btn${scope.negativeAirSize === null ? " selected" : ""}`}
            aria-pressed={scope.negativeAirSize === null}
            onClick={() => set("negativeAirSize", null)}
          >
            Default — {NEGATIVE_AIR_SIZES[DEFAULT_NEGATIVE_AIR_SIZE].label}
          </button>
          {NEGATIVE_AIR_ORDER.map((size: NegativeAirSize) => (
            <button
              key={size}
              type="button"
              className={`option-btn${scope.negativeAirSize === size ? " selected" : ""}`}
              aria-pressed={scope.negativeAirSize === size}
              onClick={() => set("negativeAirSize", size)}
            >
              {NEGATIVE_AIR_SIZES[size].label}
            </button>
          ))}
        </div>
        {/* The suggestion is offered, never applied — one tap to take it, and taking it is recorded
            as the PM's own selection rather than as the app having decided. */}
        {calc.negativeAir?.suggestion ? (
          <p className="field-note">
            {calc.negativeAir.units} x {calc.negativeAir.band.label} covers this. One{" "}
            {calc.negativeAir.suggestion.units === 1 ? "" : `set of ${calc.negativeAir.suggestion.units} `}
            {calc.negativeAir.suggestion.band.label} unit{calc.negativeAir.suggestion.units === 1 ? "" : "s"} would too —{" "}
            <button type="button" className="link-button" onClick={() => set("negativeAirSize", calc.negativeAir!.suggestion!.size)}>
              use that instead
            </button>
            .
          </p>
        ) : (
          <p className="field-note">Sized from the room volume and the air changes above. The small unit is an adjustable 200–750 CFM machine.</p>
        )}
      </div>

      <h3 className="intake-subheading">Testing &amp; Fees</h3>
      <NumberField
        id="asb-samples"
        label="Asbestos samples taken"
        value={scope.sampleCount}
        onChange={(v) => set("sampleCount", v)}
        note={
          sampleCount !== null
            ? `This claim already records ${sampleCount}. Enter a figure here to use it instead.`
            : "Nothing recorded on this claim — enter it here."
        }
      />
      <div className="intake-grid">
        <NumberField
          id="asb-pre-fee"
          label="Pre-abatement inspection fee ($)"
          value={scope.preAbatementFee}
          onChange={(v) => set("preAbatementFee", v)}
          note="Containment/hoarding inspection by a hygienist. Leave blank and it prints as an open item."
        />
        <NumberField
          id="asb-post-fee"
          label="Post-abatement clearance fee ($)"
          value={scope.postAbatementFee}
          onChange={(v) => set("postAbatementFee", v)}
          note="Air clearance testing. Leave blank and it prints as an open item."
        />
      </div>
      <p className="field-note">
        Neither is usually priced when the scope is written. Left blank they still appear on the document, marked TBD, so they don&rsquo;t
        get forgotten once the quotes come in.
      </p>

      <h3 className="intake-subheading">Anything Else</h3>
      <div className="question">
        <label className="prompt" htmlFor="asb-notes">
          Notes
        </label>
        <textarea id="asb-notes" placeholder="One per line — each becomes its own scope line" value={scope.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      <CalculatedPanel scope={scope} calc={calc} sampleCount={sampleCount} />
    </>
  );
}

/** What the entries add up to, shown as they are entered rather than only at the end. */
function CalculatedPanel({
  scope,
  calc,
  sampleCount,
}: {
  scope: AsbestosScope;
  calc: ReturnType<typeof asbestosCalculations>;
  sampleCount: number | null;
}) {
  const g = calc.geometry;
  return (
    <div className="asbestos-summary">
      <h3>What this works out to</h3>
      <dl className="asbestos-summary-grid">
        <Row label="Classification" value={ASBESTOS_TYPE_LABEL[calc.type] + (calc.typeIsOverridden ? " (overridden)" : "")} />
        <Row
          label="Containment"
          value={calc.containment.level === "entry" ? "Entry/doorway seal only" : `${calc.containment.notation} — ${containedLabel(calc.containment.contained)}`}
        />
        <Row label="HEPA-vac, detailed" value={calc.hepaVac.detailed.map(surfaceLabel).join(", ")} />
        <Row label="HEPA-vac, light" value={calc.hepaVac.light.length > 0 ? containedLabel(calc.hepaVac.light) : "None — nothing was contained"} />
        <Row label="Decon chamber" value={DECON_CHAMBER_LABEL[calc.deconChamber]} />
        <Row label="Room volume" value={g ? `${Math.round(g.cubicFt)} CF${g.source === "sketch" ? " (from the sketch)" : ""}` : "Enter the dimensions"} />
        <Row
          label="Negative air"
          value={
            calc.negativeAir
              ? `${calc.negativeAir.units} x ${calc.negativeAir.band.label} — ${Math.round(calc.negativeAir.required)} CFM required`
              : "Needs the room dimensions"
          }
        />
        <Row label="Exhaust ducting" value={calc.ductingLinearFeet !== null ? `${calc.ductingLinearFeet} LF` : "—"} />
        <Row label="Job hours" value={calc.jobHours !== null ? `${calc.jobHours} hrs` : "Needs a duration"} />
        <Row label="Labour hours" value={calc.labourHours !== null ? `${calc.labourHours} hrs` : "Needs a crew size and duration"} />
        <Row
          label="HEPA filter"
          value={calc.filterUsage ? `${(Math.round(calc.filterUsage.filters * 100) / 100).toFixed(2)} of a filter` : "Needs a duration"}
        />
        <Row label="Equipment to decontaminate" value={calc.equipmentUnits > 0 ? `${calc.equipmentUnits} units` : "—"} />
        <Row label="Asbestos samples" value={sampleSummary(scope, sampleCount)} />
        <Row label="Pre-abatement fee" value={calc.preAbatementFee !== null ? `$${calc.preAbatementFee.toFixed(2)}` : "Open item — TBD"} />
        <Row label="Post-abatement clearance" value={calc.postAbatementFee !== null ? `$${calc.postAbatementFee.toFixed(2)}` : "Open item — TBD"} />
      </dl>
      {scope.surface === "wall" && calc.containment.level === "full" && (
        <p className="field-note">
          Removing {calc.containment.wallsRemoved} of {4} walls, so the other {4 - calc.containment.wallsRemoved} are contained along with the
          floor and ceiling.
        </p>
      )}
    </div>
  );
}

/** Which sample figure will actually be used, and where it came from. */
function sampleSummary(scope: AsbestosScope, claimCount: number | null): string {
  const resolved = resolveSampleCount(scope, claimCount);
  if (resolved === null) return "Not recorded";
  const entered = Number.parseFloat(scope.sampleCount);
  return Number.isFinite(entered) ? `${resolved} (entered here)` : `${resolved} (from the claim)`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  note,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  note?: string;
}) {
  return (
    <div className="question">
      <label className="prompt" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => onChange(e.target.value)} />
      {note && <p className="field-note">{note}</p>}
    </div>
  );
}

/** A list of real options plus free text — the PM's kit may not be on the list. */
function ChoiceField({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="question">
      <label className="prompt" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="text" list={`${id}-options`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Select or type" />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}
