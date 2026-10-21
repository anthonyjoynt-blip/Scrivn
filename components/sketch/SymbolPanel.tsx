"use client";

import { useEffect, useState } from "react";
import {
  type CabinetSymbol,
  type CabinetTier,
  type FixtureSymbol,
  type FixtureType,
  blockAngleDeg,
  type BlockShape,
  blockShape,
  type FreeCabinet,
  type ShowerShape,
  type DoorLeaves,
  type DoorSymbol,
  type DoorType,
  type DoorStyle,
  type OpeningTop,
  type SketchRoom,
  type SketchSymbol,
  type WindowSymbol,
  type WindowType,
  DOOR_STYLE_LABEL,
  OPENING_TOP_LABEL,
  WINDOW_TYPE_LABEL,
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
 *
 * `onAddCloset` is a button, not a behaviour: a door in a wall is not evidence of a closet behind
 * it, and the PM asked that closets never appear on their own. The editor passes it only for doors;
 * the panel hides it for anything else, so a window never offers a closet. See `closetBehindDoor`
 * in lib/sketch.ts for what gets drawn — the space behind the door: a notch or a cut-off corner out
 * to the room's own walls, else a rectangle to the room behind it or 2'0" deep — and
 * `closetShapeBehindDoor` for which of the two a given door would get.
 */
export function SymbolPanel({
  room,
  symbol,
  onChange,
  onDelete,
  onAddCloset,
}: {
  room: SketchRoom;
  symbol: SketchSymbol;
  onChange: (next: SketchSymbol) => void;
  onDelete: () => void;
  onAddCloset?: () => void;
}) {
  const offersCloset = symbol.type === "door" && onAddCloset != null;
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
        {offersCloset && (
          <button className="btn-secondary" onClick={onAddCloset}>
            Add closet behind this door
          </button>
        )}
        <button className="btn-secondary" onClick={onDelete}>
          Delete
        </button>
      </div>
      {offersCloset && (
        <p className="field-note">{"Draws a closet in the space behind the door: in a notch or a cut-off corner, out to the room's own walls; behind a straight wall, to the room behind it, or 2'0\" deep. Drag or type its walls to fit."}</p>
      )}
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
              // A sill belongs to a pass-through: a door hung in the hole goes to the floor again.
              onClick={() => onChange(type === "opening" ? { ...door, doorType: type } : withoutField({ ...door, doorType: type }, "sillFeet"))}
            >
              {DOOR_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </div>

      {/*
        Single or double, straight under the type: together they name the door ("Double bifold door"). It was
        "Leaves", under the height, and on 2026-10-03 the estimator looked for a double door and did not find it.
      */}
      {door.doorType !== "opening" && (
      <div className="question">
        <label className="prompt">Single or double</label>
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

      {/*
        Head height. Every door has one; an opening is described by little else - for an opening, the case that most
        needs it, it comes straight after the type, the rest of the panel hidden.
      */}
      <MeasureField
        id="door-height"
        label={door.doorType === "opening" ? "Opening height" : "Door height"}
        hint={door.doorType === "opening" ? "Head height of the opening. Standard door head is 6'8\"." : undefined}
        valueFeet={door.heightFeet}
        onCommit={(feet) => onChange({ ...door, heightFeet: feet })}
      />

      {/*
        A PASS-THROUGH is an opening with wall under it (2026-10-21): the owner's arched openings off the living room
        start about 3'2" up. Left empty, the opening runs to the floor, as it always did.
      */}
      {door.doorType === "opening" && (
        <MeasureField
          id="door-sill"
          label="Sill height (pass-through)"
          hint="Leave empty for an opening to the floor. Set it for a pass-through - the wall under it stays wall."
          valueFeet={door.sillFeet ?? null}
          onCommit={(feet) => onChange({ ...door, sillFeet: feet })}
          onClear={() => onChange(withoutField(door, "sillFeet"))}
        />
      )}
      <TopShapeFields symbol={door} onChange={onChange} />

      {door.doorType !== "opening" && <DoorStyleFields door={door} onChange={onChange} />}

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
      {/* How it opens, how many units, grids - what Xactimate prices a window by besides its size (2026-10-21). */}
      <div className="question">
        <label className="prompt" htmlFor="win-type">
          Window type
        </label>
        <select
          id="win-type"
          value={win.windowType ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? withoutField(win, "windowType") : { ...win, windowType: e.target.value as WindowType })}
        >
          <option value="">Not said</option>
          {(Object.keys(WINDOW_TYPE_LABEL) as WindowType[]).map((type) => (
            <option key={type} value={type}>
              {WINDOW_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </div>
      <CountField
        id="win-units"
        label="Units in the frame"
        hint="A triple casement is 3: three units, two mullions between them."
        value={win.units ?? null}
        onCommit={(count) => onChange(count == null || count <= 1 ? withoutField(win, "units") : { ...win, units: count })}
      />
      <ChoiceRow
        label="Grids in the glass"
        choices={[
          [true, "Grids"],
          [false, "None"],
        ]}
        value={win.grids}
        onChange={(grids) => onChange(grids === undefined ? withoutField(win, "grids") : { ...win, grids })}
      />
      <TopShapeFields symbol={win} onChange={onChange} />
    </>
  );
}

/**
 * The top of a door, an opening or a window: flat, a segmental arch, or a half round - and where its
 * curve starts, which is left empty unless somebody measured it (`openingTopRiseFeet` assumes).
 */
function TopShapeFields({ symbol, onChange }: { symbol: DoorSymbol | WindowSymbol; onChange: (next: SketchSymbol) => void }) {
  const shape = symbol.topShape ?? "flat";
  return (
    <>
      <div className="question">
        <label className="prompt">Top</label>
        <div className="option-group" role="group" aria-label="Top shape">
          {(Object.keys(OPENING_TOP_LABEL) as OpeningTop[]).map((top) => (
            <button
              key={top}
              type="button"
              className={`option-btn${shape === top ? " selected" : ""}`}
              aria-pressed={shape === top}
              onClick={() => onChange(top === "flat" ? withoutField(withoutField(symbol, "topShape"), "springFeet") : { ...symbol, topShape: top })}
            >
              {OPENING_TOP_LABEL[top]}
            </button>
          ))}
        </div>
      </div>
      {shape !== "flat" && (
        <MeasureField
          id="top-spring"
          label="Curve starts at"
          hint={`Height off the floor where the ${shape === "round" ? "half round" : "arch"} springs from the sides. Empty: ${shape === "round" ? "half the width below the top" : "a sixth of the width below the top"}.`}
          valueFeet={symbol.springFeet ?? null}
          onCommit={(feet) => onChange({ ...symbol, springFeet: feet })}
          onClear={() => onChange(withoutField(symbol, "springFeet"))}
        />
      )}
    </>
  );
}

/** A door's leaf: its style, its panes of glass, and whether it is an outside door. Each can be left unsaid. */
function DoorStyleFields({ door, onChange }: { door: DoorSymbol; onChange: (next: SketchSymbol) => void }) {
  const glazed = door.doorStyle === "half-lite" || door.doorStyle === "full-lite" || door.doorStyle === "french";
  return (
    <>
      <ChoiceRow
        label="Door style"
        choices={(Object.keys(DOOR_STYLE_LABEL) as DoorStyle[]).map((style) => [style, DOOR_STYLE_LABEL[style]])}
        value={door.doorStyle}
        onChange={(doorStyle) => onChange(doorStyle === undefined ? withoutField(withoutField(door, "doorStyle"), "lites") : { ...door, doorStyle })}
      />
      {glazed && (
        <CountField
          id="door-lites"
          label="Lites (panes of glass per leaf)"
          value={door.lites ?? null}
          onCommit={(count) => onChange(count == null ? withoutField(door, "lites") : { ...door, lites: count })}
        />
      )}
      <ChoiceRow
        label="Inside or outside"
        choices={[
          [false, "Interior"],
          [true, "Exterior"],
        ]}
        value={door.exterior}
        onChange={(exterior) => onChange(exterior === undefined ? withoutField(door, "exterior") : { ...door, exterior })}
      />
    </>
  );
}

/** The symbol without one of its optional fields: "not said", which saves as nothing at all. */
function withoutField<T extends object, K extends keyof T>(value: T, key: K): T {
  const next = { ...value };
  delete next[key];
  return next;
}

/**
 * A row of choices where the chosen one can be tapped again to unsay it - for the details that are
 * optional, so that "not said" stays possible and is never confused with a choice.
 */
export function ChoiceRow<V extends string | boolean>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: [V, string][];
  value: V | undefined;
  onChange: (next: V | undefined) => void;
}) {
  return (
    <div className="question">
      <label className="prompt">{label}</label>
      <div className="option-group" role="group" aria-label={label}>
        {choices.map(([choice, text]) => (
          <button
            key={String(choice)}
            type="button"
            className={`option-btn${value === choice ? " selected" : ""}`}
            aria-pressed={value === choice}
            onClick={() => onChange(value === choice ? undefined : choice)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A whole number - lites, units, waterfall ends. Empty is "not said". */
export function CountField({ id, label, hint, value, onCommit }: { id: string; label: string; hint?: string; value: number | null; onCommit: (count: number | null) => void }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  function commit() {
    const raw = draft.trim();
    if (raw === "") {
      onCommit(null);
      return;
    }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    onCommit(n);
  }
  return (
    <div className="question">
      <label className="prompt" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {hint && <p className="field-note">{hint}</p>}
    </div>
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

      {/*
        SHAPE. A corner unit — a fireplace, a corner shower, a corner pantry — is a right triangle
        with its legs on the two walls, and drawing it as a rectangle set across the corner prices
        the two triangles of floor either side of it that are still there. The room stays square and
        the unit stands in it, which is how Xactimate draws a cabinet and what the estimator asked
        for on 2026-09-24: "I would rather the walls remain as square corners and then the corner
        unit gets placed in much like a cabinet might, just a block."
      */}
      <div className="question">
        <label className="prompt">Shape</label>
        <div className="option-group" role="group" aria-label="Block shape">
          {(["rectangle", "triangle"] as BlockShape[]).map((shape) => (
            <button
              key={shape}
              type="button"
              className={`option-btn${blockShape(cabinet) === shape ? " selected" : ""}`}
              aria-pressed={blockShape(cabinet) === shape}
              onClick={() => onChange({ ...cabinet, shape })}
            >
              {shape === "rectangle" ? "Rectangle" : "Corner (triangle)"}
            </button>
          ))}
        </div>
        {blockShape(cabinet) === "triangle" && (
          <p className="field-note">
            The right angle sits at the back, so the two legs lie along the walls of the corner and the long face looks into
            the room. Turn it to pick which corner.
          </p>
        )}
      </div>

      {/*
        TURN, in quarters and in eighths. Quarters walk a corner unit round the four corners of a
        room; 45 is where a fireplace set across a square corner actually stands. A free field would
        be more general and much worse under a thumb — these are the angles anything built in
        actually sits at.
      */}
      <div className="question">
        <label className="prompt">Turn</label>
        <div className="option-group" role="group" aria-label="Block turn">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <button
              key={deg}
              type="button"
              className={`option-btn${blockAngleDeg(cabinet) === deg ? " selected" : ""}`}
              aria-pressed={blockAngleDeg(cabinet) === deg}
              onClick={() => onChange({ ...cabinet, angleDeg: deg })}
            >
              {deg}&deg;
            </button>
          ))}
        </div>
      </div>

      {/*
        HEIGHT, and it is allowed to be empty. Nothing is seeded from the tier the way a wall
        cabinet's height is: a seeded height is a measurement nobody took, presented as one, and the
        wall behind a block is deducted only when somebody says how tall it is.
      */}
      <MeasureField
        id="island-height"
        label="Height"
        valueFeet={cabinet.heightFeet ?? null}
        onCommit={(feet) => onChange({ ...cabinet, heightFeet: feet })}
      />
      <p className="field-note">
        Only used to take the wall behind the block out of the wall area, and only when that deduction is switched on. Leave
        it empty if nobody measured it.
      </p>

      <div className="actions-row">
        <button className="btn-secondary" onClick={onDelete}>
          Delete
        </button>
      </div>
      <p className="field-note">Drag the block to move it anywhere inside the room, or drag the handle beside it to resize.</p>
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
export function MeasureField({
  id,
  label,
  hint,
  valueFeet,
  onCommit,
  onClear,
}: {
  id: string;
  label: string;
  hint?: string;
  valueFeet: number | null;
  onCommit: (feet: number) => void;
  /** When given, an emptied field means "not said" and calls this; without it, emptying puts the value back. */
  onClear?: () => void;
}) {
  const [draft, setDraft] = useState(valueFeet == null ? "" : formatFeetInches(valueFeet));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(valueFeet == null ? "" : formatFeetInches(valueFeet));
    setInvalid(false);
  }, [valueFeet]);

  function commit() {
    if (draft.trim() === "") {
      if (onClear && valueFeet != null) {
        setInvalid(false);
        onClear();
        return;
      }
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
