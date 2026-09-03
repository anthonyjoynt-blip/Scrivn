"use client";

import { useEffect, useState } from "react";
import {
  type CabinetSymbol,
  type CabinetTier,
  type FixtureSymbol,
  type FixtureType,
  type FreeCabinet,
  type ShowerShape,
  type DoorLeaves,
  type DoorSymbol,
  type DoorType,
  type SketchRoom,
  type SketchSymbol,
  type WindowSymbol,
  CABINET_DEFAULT_DEPTH_FEET,
  PIXELS_PER_FOOT,
  CABINET_DEFAULT_HEIGHT_FEET,
  CABINET_TIER_LABEL,
  FIXTURE_IS_BUILT_IN,
  FIXTURE_LABEL,
  DOOR_LEAVES_LABEL,
  DOOR_TYPE_LABEL,
  formatFeetInches,
  parseFeetInches,
  symbolWidthFeet,
  withFixtureType,
} from "@/lib/sketch";

/**
 * Properties for whichever symbol is selected.
 *
 * Every dimension field goes through `MeasureField`, which accepts the same two notations as the
 * wall-length input — a PM reading a tape measure shouldn't have to convert 3'6" to 3.5 in one
 * place and not another.
 *
 * Dimension fields are disabled until the room has a scale. Before that there is no relationship
 * between drawn pixels and feet, so "3 feet wide" has nothing to be three feet of; the field says
 * so rather than silently accepting a number that would be reinterpreted later.
 */
export function SymbolPanel({
  room,
  symbol,
  onChange,
  onDelete,
}: {
  room: SketchRoom;
  symbol: SketchSymbol;
  onChange: (next: SketchSymbol) => void;
  onDelete: () => void;
}) {
  return (
    <div className="sketch-panel-body">
      {symbol.type === "door" && <DoorFields door={symbol} onChange={onChange} />}
      {symbol.type === "window" && <WindowFields window={symbol} onChange={onChange} />}
      {symbol.type === "cabinet" && <CabinetFields cabinet={symbol} onChange={onChange} />}
      {symbol.type === "fixture" && <FixtureFields fixture={symbol} room={room} onChange={onChange} />}

      <MeasureField
        id="sym-width"
        label="Width"
        valueFeet={symbolWidthFeet(symbol, room)}
        onCommit={(feet) => onChange({ ...symbol, widthFeet: feet })}
      />

      <div className="actions-row">
        <button className="btn-secondary" onClick={onDelete}>
          Delete
        </button>
      </div>
      <p className="field-note">Drag the symbol to slide it along its wall, or drag either end handle to resize it. To move it to a different wall, delete it and place a new one.</p>
    </div>
  );
}

function DoorFields({ door, onChange }: { door: DoorSymbol; onChange: (next: SketchSymbol) => void }) {
  return (
    <>
      <div className="question">
        <label className="prompt">Door type</label>
        <div className="option-group" role="group" aria-label="Door type">
          {(Object.keys(DOOR_TYPE_LABEL) as DoorType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={`option-btn${door.doorType === type ? " selected" : ""}`}
              aria-pressed={door.doorType === type}
              onClick={() => onChange({ ...door, doorType: type })}
            >
              {DOOR_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </div>

      {/*
        Head height. Every door has one; an opening is described by little else.

        Placed above Leaves rather than below the orientation flips because for an opening — the
        case that most needs it — the flips are hidden and this would otherwise be the only field
        after the type, marooned at the bottom of an otherwise empty panel.
      */}
      <MeasureField
        id="door-height"
        label={door.doorType === "opening" ? "Opening height" : "Door height"}
        hint={door.doorType === "opening" ? "Head height of the opening. Standard door head is 6'8\"." : undefined}
        valueFeet={door.heightFeet}
        onCommit={(feet) => onChange({ ...door, heightFeet: feet })}
      />

      {door.doorType !== "opening" && (
      <div className="question">
        <label className="prompt">Leaves</label>
        <div className="option-group" role="group" aria-label="Single or double">
          {(Object.keys(DOOR_LEAVES_LABEL) as DoorLeaves[]).map((leaves) => (
            <button
              key={leaves}
              type="button"
              className={`option-btn${door.leaves === leaves ? " selected" : ""}`}
              aria-pressed={door.leaves === leaves}
              onClick={() => onChange({ ...door, leaves })}
            >
              {DOOR_LEAVES_LABEL[leaves]}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* An opening has no leaf, so nothing to hand or swing. */}
      {door.doorType !== "opening" && (
      <>
      {/*
        Orientation as two world-space mirrors rather than "hand" and "swing". Which of those two a
        given flip changes depends on the wall — horizontal on a side wall moves the swing, on a top
        wall it moves the hinge — so the buttons describe the action (mirror this way) rather than
        the outcome, which is the only description that stays true on all four walls and after rooms
        are joined. See `doorOrientation` in lib/sketch.ts.

        Both flips are offered for every door type: a pocket or slider has no swing, but it does have
        a side it retracts towards, and that's what the second mirror moves.
      */}
      <div className="question">
        <label className="prompt">Orientation</label>
        <div className="actions-row" style={{ marginTop: 0, justifyContent: "flex-start" }}>
          <button className="btn-secondary" onClick={() => onChange({ ...door, flipX: !door.flipX })}>
            Flip horizontal
          </button>
          <button className="btn-secondary" onClick={() => onChange({ ...door, flipY: !door.flipY })}>
            Flip vertical
          </button>
        </div>
        <p className="field-note">On a desktop keyboard, ← → and ↑ ↓ do the same thing to the selected door.</p>
      </div>
      </>
      )}
    </>
  );
}

function FixtureFields({
  fixture,
  room,
  onChange,
}: {
  fixture: FixtureSymbol;
  room: SketchRoom;
  onChange: (next: SketchSymbol) => void;
}) {
  return (
    <>
      <div className="question">
        <label className="prompt" htmlFor="fixture-type">
          Fixture
        </label>
        {/* A dropdown rather than buttons: seven options in a row would wrap into a wall of chips. */}
        <select id="fixture-type" value={fixture.fixtureType} onChange={(e) => onChange(withFixtureType(fixture, room, e.target.value as FixtureType))}>
          {(Object.keys(FIXTURE_LABEL) as FixtureType[]).map((type) => (
            <option key={type} value={type}>
              {FIXTURE_LABEL[type]}
            </option>
          ))}
        </select>
        {FIXTURE_IS_BUILT_IN[fixture.fixtureType] && (
          <p className="field-note">Built in against the wall, so it can be deducted from floor and wall areas — see the toggles under Sketch data.</p>
        )}
      </div>

      {fixture.fixtureType === "shower" && (
        <div className="question">
          <label className="prompt">Shower shape</label>
          <div className="option-group" role="group" aria-label="Shower shape">
            {(["rectangular", "corner"] as ShowerShape[]).map((shape) => (
              <button
                key={shape}
                type="button"
                className={`option-btn${fixture.showerShape === shape ? " selected" : ""}`}
                aria-pressed={fixture.showerShape === shape}
                onClick={() => onChange({ ...fixture, showerShape: shape })}
              >
                {shape === "rectangular" ? "Rectangular" : "Corner"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="question">
        <label className="prompt" htmlFor="fixture-label">
          Label
        </label>
        <input id="fixture-label" type="text" value={fixture.label} placeholder={FIXTURE_LABEL[fixture.fixtureType]} onChange={(e) => onChange({ ...fixture, label: e.target.value })} />
      </div>

      <MeasureField
        id="fixture-depth"
        label="Depth"
        valueFeet={fixture.depthFeet}
        onCommit={(feet) => onChange({ ...fixture, depthFeet: feet })}
      />
      {FIXTURE_IS_BUILT_IN[fixture.fixtureType] && (
        <MeasureField
          id="fixture-height"
          label="Height"
          hint="How far up the wall it covers. Used for the wall-area deduction."
          valueFeet={fixture.heightFeet}
          onCommit={(feet) => onChange({ ...fixture, heightFeet: feet })}
        />
      )}
    </>
  );
}

function WindowFields({ window: win, onChange }: { window: WindowSymbol; onChange: (next: SketchSymbol) => void }) {
  return (
    <>
      <MeasureField
        id="win-height"
        label="Height"
        valueFeet={win.heightFeet}
        onCommit={(feet) => onChange({ ...win, heightFeet: feet })}
      />
      <MeasureField
        id="win-sill"
        label="Sill height"
        hint="How far up from the floor the opening starts."
        valueFeet={win.sillFeet}
        onCommit={(feet) => onChange({ ...win, sillFeet: feet })}
      />
    </>
  );
}

function CabinetFields({ cabinet, onChange }: { cabinet: CabinetSymbol; onChange: (next: SketchSymbol) => void }) {
  return (
    <>
      <div className="question">
        <label className="prompt" htmlFor="cab-label">
          Label
        </label>
        <input id="cab-label" type="text" value={cabinet.label} placeholder="e.g. Sink base" onChange={(e) => onChange({ ...cabinet, label: e.target.value })} />
      </div>

      <div className="question">
        <label className="prompt">Cabinet type</label>
        <div className="option-group" role="group" aria-label="Cabinet tier">
          {(Object.keys(CABINET_TIER_LABEL) as CabinetTier[]).map((tier) => (
            <button
              key={tier}
              type="button"
              className={`option-btn${cabinet.tier === tier ? " selected" : ""}`}
              aria-pressed={cabinet.tier === tier}
              // Switching tier also moves the depth to that tier's standard, but only when the
              // current depth is still the *other* tier's default — an edited depth is the user's
              // number and gets left alone.
              onClick={() =>
                onChange({
                  ...cabinet,
                  tier,
                  depthFeet: cabinet.depthFeet === CABINET_DEFAULT_DEPTH_FEET[cabinet.tier] ? CABINET_DEFAULT_DEPTH_FEET[tier] : cabinet.depthFeet,
                  heightFeet: cabinet.heightFeet === CABINET_DEFAULT_HEIGHT_FEET[cabinet.tier] ? CABINET_DEFAULT_HEIGHT_FEET[tier] : cabinet.heightFeet,
                })
              }
            >
              {CABINET_TIER_LABEL[tier]}
            </button>
          ))}
        </div>
        <p className="field-note">Uppers draw as a dashed outline over lowers on the same run, so both stay visible.</p>
      </div>

      <MeasureField
        id="cab-depth"
        label="Depth"
        hint={`Standard is ${formatFeetInches(CABINET_DEFAULT_DEPTH_FEET.base)} for lowers, ${formatFeetInches(CABINET_DEFAULT_DEPTH_FEET.wall)} for uppers.`}
        valueFeet={cabinet.depthFeet}
        onCommit={(feet) => onChange({ ...cabinet, depthFeet: feet })}
      />
      <MeasureField
        id="cab-height"
        label="Height"
        hint={`How far up the wall it covers — used for the wall-area deduction. Standard is ${formatFeetInches(CABINET_DEFAULT_HEIGHT_FEET.base)} for lowers, ${formatFeetInches(CABINET_DEFAULT_HEIGHT_FEET.wall)} for uppers.`}
        valueFeet={cabinet.heightFeet}
        onCommit={(feet) => onChange({ ...cabinet, heightFeet: feet })}
      />
    </>
  );
}

/**
 * Properties for a free-standing island.
 *
 * Same fields as a wall cabinet minus anything wall-relative, plus a depth that means "front to
 * back" rather than "how far it projects from the wall".
 */
export function FreeCabinetPanel({
  room,
  cabinet,
  onChange,
  onDelete,
}: {
  room: SketchRoom;
  cabinet: FreeCabinet;
  onChange: (next: FreeCabinet) => void;
  onDelete: () => void;
}) {
  return (
    <div className="sketch-panel-body">
      <div className="question">
        <label className="prompt" htmlFor="island-label">
          Label
        </label>
        <input id="island-label" type="text" value={cabinet.label} placeholder="e.g. Island" onChange={(e) => onChange({ ...cabinet, label: e.target.value })} />
      </div>

      <div className="question">
        <label className="prompt">Cabinet type</label>
        <div className="option-group" role="group" aria-label="Cabinet tier">
          {(Object.keys(CABINET_TIER_LABEL) as CabinetTier[]).map((tier) => (
            <button
              key={tier}
              type="button"
              className={`option-btn${cabinet.tier === tier ? " selected" : ""}`}
              aria-pressed={cabinet.tier === tier}
              onClick={() => onChange({ ...cabinet, tier })}
            >
              {CABINET_TIER_LABEL[tier]}
            </button>
          ))}
        </div>
      </div>

      <MeasureField
        id="island-width"
        label="Width"
        valueFeet={cabinet.widthFeet}
        onCommit={(feet) => onChange({ ...cabinet, widthFeet: feet, widthPx: feet * PIXELS_PER_FOOT })}
      />
      <MeasureField
        id="island-depth"
        label="Depth"
        valueFeet={cabinet.depthFeet}
        onCommit={(feet) => onChange({ ...cabinet, depthFeet: feet, depthPx: feet * PIXELS_PER_FOOT })}
      />

      <div className="actions-row">
        <button className="btn-secondary" onClick={onDelete}>
          Delete
        </button>
      </div>
      <p className="field-note">Drag the block to move it anywhere inside the room, or drag its right/bottom handle to resize.</p>
    </div>
  );
}

/**
 * A length field that shows feet and inches and accepts either notation.
 *
 * Local draft state rather than writing on every keystroke: committing mid-type would reformat the
 * field under the user (typing "12" in "12'6\"" would briefly commit 12' and rewrite what they were
 * halfway through). It commits on blur and on Enter, and re-syncs whenever the underlying value
 * changes from elsewhere — dragging a handle, for instance.
 */
function MeasureField({
  id,
  label,
  hint,
  valueFeet,
  onCommit,
}: {
  id: string;
  label: string;
  hint?: string;
  valueFeet: number | null;
  onCommit: (feet: number) => void;
}) {
  const [draft, setDraft] = useState(valueFeet == null ? "" : formatFeetInches(valueFeet));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(valueFeet == null ? "" : formatFeetInches(valueFeet));
    setInvalid(false);
  }, [valueFeet]);

  function commit() {
    if (draft.trim() === "") {
      setDraft(valueFeet == null ? "" : formatFeetInches(valueFeet));
      setInvalid(false);
      return;
    }
    const feet = parseFeetInches(draft);
    if (feet == null || feet <= 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(feet);
  }

  return (
    <div className="question">
      <label className="prompt" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        value={draft}
        placeholder={`3'6" or 3.5`}
        aria-invalid={invalid}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {invalid && <p className="sketch-length-error">Enter a length like 3&#39;6&quot; or 3.5</p>}
      {hint && <p className="field-note">{hint}</p>}
    </div>
  );
}
