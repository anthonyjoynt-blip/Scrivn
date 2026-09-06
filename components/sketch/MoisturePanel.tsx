"use client";

import { useState } from "react";
import { formatFeetInches, parseFeetInches, type SketchRoom, wallsOf } from "@/lib/sketch";
import {
  BAND_COLOR,
  BAND_LABEL,
  type ConcernBand,
  DRY_STANDARD_GUIDE,
  MATERIAL_LABEL,
  WALL_MATERIALS,
  type MoistureMaterial,
  type RoomMoisture,
  UNKNOWN_BAND_COLOR,
  UNKNOWN_BAND_LABEL,
  type WallReading,
  bandColor,
  bandLabel,
  readingBand,
  defaultDryStandard,
  dryStandardSource,
  paintedFloorSquareFeet,
} from "@/lib/moisture";

/**
 * The moisture readings for one room.
 *
 * Readings live here rather than in a floating box on the canvas. A wall length is one number and
 * fits over the drawing; a reading is four fields, one of them a dropdown — on a phone that popup
 * would cover the room it describes and sit under the keyboard. Tapping the wall still creates the
 * reading, which is the part that has to feel direct; filling it in happens where there is room.
 */
export function MoisturePanel({
  room,
  data,
  onChange,
  highlightReadingId,
  reference,
  onSetReference,
}: {
  room: SketchRoom;
  data: RoomMoisture;
  onChange: (next: RoomMoisture) => void;
  /** The reading just created by tapping a wall, so the PM can see which row to fill in. */
  highlightReadingId: string | null;
  /** The job's dry standards, measured on unaffected material. Claim-level, not this room's. */
  reference: Partial<Record<MoistureMaterial, number>> | undefined;
  onSetReference: (material: MoistureMaterial, value: number | null) => void;
}) {
  const walls = wallsOf(room);
  const wallNumber = new Map(walls.map((w, i) => [w.id, i + 1]));

  function updateReading(id: string, patch: Partial<WallReading>) {
    onChange({ ...data, wallReadings: data.wallReadings.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }

  function removeReading(id: string) {
    onChange({ ...data, wallReadings: data.wallReadings.filter((r) => r.id !== id) });
  }

  const floorArea = paintedFloorSquareFeet(data.floorCells);
  const ceilingArea = paintedFloorSquareFeet(data.ceilingCells);

  return (
    <div className="sketch-panel">
      <div className="question">
        <h3>Moisture — {room.name.trim() || "Unnamed room"}</h3>
        <p className="field-note">
          Tap a wall on the sketch to add a reading there. The sketch itself is not editable in this mode — switch back to
          Sketch to change the room&rsquo;s shape.
        </p>
      </div>

      <DryStandardSection reference={reference} onSet={onSetReference} />

      {data.wallReadings.length === 0 ? (
        <p className="field-note">No wall readings yet.</p>
      ) : (
        <div className="moisture-readings">
          {data.wallReadings.map((reading) => (
            <ReadingCard
              key={reading.id}
              reference={reference}
              reading={reading}
              wallLabel={`Wall ${wallNumber.get(reading.wallId) ?? "?"}`}
              wallLengthFeet={walls.find((w) => w.id === reading.wallId)?.lengthFeet ?? null}
              highlighted={reading.id === highlightReadingId}
              onChange={(patch) => updateReading(reading.id, patch)}
              onRemove={() => removeReading(reading.id)}
            />
          ))}
        </div>
      )}

      <div className="question">
        <label htmlFor={`insets-${room.id}`}>Wall insets / offsets over 18 inches</label>
        <input
          id={`insets-${room.id}`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={data.insetsOver18Inches === 0 ? "" : data.insetsOver18Inches}
          placeholder="0"
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ ...data, insetsOver18Inches: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 });
          }}
        />
        <p className="field-note">
          Counted by you, not measured off the sketch — a plan does not reliably show which offsets the drying plan has to
          treat separately.
        </p>
      </div>

      {/*
        Both surfaces, always, whether or not either is marked.

        The ceiling had no readout at all: it could be highlighted, the area was computed, and it
        fed the air-mover count — but the only number on screen was the floor's, so there was no way
        to tell a marked ceiling from an unmarked one without hunting for the wash on the plan.
        Showing the pair, empty state and all, is also what says the ceiling is markable.
      */}
      <PaintedSurfaceReadout
        label="Affected floor"
        squareFeet={floorArea}
        emptyHint="Nothing highlighted yet. Choose Highlight, then Floor, and drag across the room."
        onClear={() => onChange({ ...data, floorCells: [] })}
      />
      <PaintedSurfaceReadout
        label="Affected ceiling"
        squareFeet={ceilingArea}
        emptyHint="Nothing highlighted yet. Choose Highlight, then Ceiling, and drag across the room."
        onClear={() => onChange({ ...data, ceilingCells: [] })}
      />
    </div>
  );
}

/**
 * How much of one surface is marked, and the way to undo it.
 *
 * One component for both surfaces rather than two blocks side by side, because two blocks side by
 * side is how the ceiling came to be missing a readout in the first place — the floor's was written,
 * the ceiling's was meant to follow, and nothing failed when it didn't.
 */
function PaintedSurfaceReadout({
  label,
  squareFeet,
  emptyHint,
  onClear,
}: {
  label: string;
  squareFeet: number;
  emptyHint: string;
  onClear: () => void;
}) {
  return (
    <div className="question">
      <h4>{label}</h4>
      {squareFeet > 0 ? (
        <>
          <p className="moisture-surface-area">
            <strong>{squareFeet.toFixed(1)} SF</strong> highlighted
          </p>
          <button type="button" className="btn-secondary" onClick={onClear}>
            Clear
          </button>
        </>
      ) : (
        <p className="field-note">{emptyHint}</p>
      )}
    </div>
  );
}

/**
 * The job's dry standards, taken from unaffected material in this building.
 *
 * At the top, above the readings, because this is the measurement every reading below is judged
 * against and it belongs at the start of a job rather than buried in the fourth field of a wall
 * card. The published ranges underneath each box are a fallback, and now say so plainly: they are
 * numbers about materials in general, and a dry standard is a fact about THIS building — its
 * species, its season, its meter.
 *
 * Collapsed by default once anything is set, because it is a beginning-of-job step and not something
 * to scroll past on every wall.
 */
function DryStandardSection({
  reference,
  onSet,
}: {
  reference: Partial<Record<MoistureMaterial, number>> | undefined;
  onSet: (material: MoistureMaterial, value: number | null) => void;
}) {
  const measured = WALL_MATERIALS.filter((m) => reference?.[m] != null);
  const [open, setOpen] = useState(measured.length === 0);

  return (
    <div className="dry-standard-section">
      <button type="button" className="dry-standard-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Dry standard for this job</span>
        <span className="dry-standard-status">
          {measured.length === 0
            ? "not measured"
            : measured.map((m) => `${MATERIAL_LABEL[m]} ${reference?.[m]}`).join(" · ")}
        </span>
      </button>

      {open && (
        <div className="dry-standard-body">
          <p className="field-note">
            Meter an <strong>unaffected</strong> area of each material in this building and enter it here — somewhere
            the water did not reach. That reading is the dry standard, and every wall below is compared against it.
          </p>
          {WALL_MATERIALS.map((material) => {
            const guide = DRY_STANDARD_GUIDE[material];
            return (
              <label key={material} className="dry-standard-row">
                <span>{MATERIAL_LABEL[material]}</span>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  inputMode="decimal"
                  // The note beside it already says what happens when this is empty, and "Not
                  // measured" does not fit the box at this width — it clipped to "Not mea".
                  placeholder="—"
                  value={reference?.[material] ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") {
                      onSet(material, null);
                      return;
                    }
                    const n = Number(raw);
                    if (Number.isFinite(n)) onSet(material, n);
                  }}
                />
                <span className="field-note">
                  {reference?.[material] != null
                    ? "measured here"
                    : guide.prefill === null
                      ? "no fallback — must be measured"
                      : `falls back to ${guide.prefill}`}
                </span>
              </label>
            );
          })}
          <p className="field-note">
            Without one, readings fall back to a published range for the material. Those are a starting point for
            triage, not a measurement of this building.
          </p>
        </div>
      )}
    </div>
  );
}

/** One wall's reading. Every field is editable, including the dry standard — see `DRY_STANDARD_GUIDE`. */
function ReadingCard({
  reference,
  reading,
  wallLabel,
  wallLengthFeet,
  highlighted,
  onChange,
  onRemove,
}: {
  reference: Partial<Record<MoistureMaterial, number>> | undefined;
  reading: WallReading;
  wallLabel: string;
  wallLengthFeet: number | null;
  highlighted: boolean;
  onChange: (patch: Partial<WallReading>) => void;
  onRemove: () => void;
}) {
  const [heightDraft, setHeightDraft] = useState<string | null>(null);
  const band = readingBand(reading);
  const guide = DRY_STANDARD_GUIDE[reading.material];
  const source = dryStandardSource(reference, reading.material, reading.dryStandard);

  /*
    The affected area follows the marked RUN, not the whole wall.

    This read the full wall length and multiplied by the height, so dragging a mark down to half a
    wall left the figure below it unchanged — it disagreed with both the plan above it and with the
    equipment count derived from the same data. The run is the only length that means anything here.
  */
  const affectedRun = Math.max(0, Math.min(1, reading.endT) - Math.max(0, reading.startT));
  const affectedLengthFeet = wallLengthFeet == null ? null : wallLengthFeet * affectedRun;
  const affectedArea = affectedLengthFeet == null ? null : affectedLengthFeet * reading.affectedHeightFeet;

  return (
    <div className={`moisture-reading${highlighted ? " highlighted" : ""}`}>
      <div className="moisture-reading-head">
        <strong>
          {wallLabel}
          {wallLengthFeet != null && <span className="moisture-wall-length"> · {formatFeetInches(wallLengthFeet)}</span>}
        </strong>
        <BandChip band={band} />
        <button type="button" className="moisture-remove" onClick={onRemove} aria-label={`Remove the reading on ${wallLabel}`}>
          Remove
        </button>
      </div>

      <div className="moisture-reading-fields">
        <label>
          <span>Affected height</span>
          {/* Same notation as a wall length: 2'6" or 2.5 both work. */}
          <input
            type="text"
            inputMode="text"
            placeholder={`2'6" or 2.5`}
            value={heightDraft ?? formatFeetInches(reading.affectedHeightFeet)}
            onChange={(e) => setHeightDraft(e.target.value)}
            onBlur={() => {
              if (heightDraft === null) return;
              const feet = parseFeetInches(heightDraft);
              if (feet !== null && feet >= 0) onChange({ affectedHeightFeet: feet });
              setHeightDraft(null);
            }}
          />
        </label>

        <label>
          <span>Material</span>
          <select
            value={reading.material}
            onChange={(e) => {
              const material = e.target.value as MoistureMaterial;
              // The standard follows the material, unless the PM has already set their own.
              /*
                A wall still on a number nobody chose follows the material; one the PM typed does
                not. "Nobody chose" now includes the job's reference reading as well as the published
                range — both are the app's answer rather than a decision about this wall.
              */
              const chosen = dryStandardSource(reference, reading.material, reading.dryStandard) === "wall";
              const next = reference?.[material] ?? defaultDryStandard(material);
              onChange({ material, ...(chosen ? {} : { dryStandard: next }) });
            }}
          >
            {WALL_MATERIALS.map((m) => (
              <option key={m} value={m}>
                {MATERIAL_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Reading %</span>
          <input
            type="number"
            step="0.1"
            min={0}
            inputMode="decimal"
            placeholder="Not measured"
            value={reading.reading ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                onChange({ reading: null });
                return;
              }
              const n = Number(raw);
              if (Number.isFinite(n)) onChange({ reading: n });
            }}
          />
        </label>

        <label>
          <span>Dry standard</span>
          <input
            type="number"
            step="0.1"
            min={0}
            inputMode="decimal"
            placeholder={guide.prefill === null ? "Enter yours" : String(guide.prefill)}
            value={reading.dryStandard ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                onChange({ dryStandard: null });
                return;
              }
              const n = Number(raw);
              if (Number.isFinite(n)) onChange({ dryStandard: n });
            }}
          />
        </label>
      </div>

      {reading.reading == null && <p className="field-note">Shown as significantly elevated until you enter a reading.</p>}

      {/*
        Where this wall's dry standard came from, in the PM's words rather than the code's.

        The number alone cannot say whether it was measured in this building or copied off a table,
        and that difference is the whole reason the section above exists. A figure the PM measured
        needs no caveat; one from the published range gets the caveat every time it is shown.
      */}
      <p className="field-note moisture-guide">
        {source === "reference"
          ? "From your reference reading for this job."
          : source === "wall"
            ? "Set for this wall."
            : source === "unset"
              ? guide.note
              : `Not measured — falls back to a published range. ${guide.note}`}
      </p>

      {affectedArea != null && affectedLengthFeet != null && (
        <p className="field-note">
          Affected wall area {affectedArea.toFixed(1)} SF ({formatFeetInches(affectedLengthFeet)} ×{" "}
          {formatFeetInches(reading.affectedHeightFeet)})
          {affectedRun < 0.995 && <> — {Math.round(affectedRun * 100)}% of a {formatFeetInches(wallLengthFeet ?? 0)} wall</>}.
        </p>
      )}
    </div>
  );
}

function BandChip({ band }: { band: ConcernBand | null }) {
  return (
    <span
      className="moisture-band-chip"
      style={{ background: bandColor(band) }}
      title={band === null ? UNKNOWN_BAND_LABEL : BAND_LABEL[band]}
    >
      {bandLabel(band)}
    </span>
  );
}

/**
 * What the marks on the map mean. Without this the sketch is decorative.
 *
 * Covers both halves, because the plan carries two different kinds of mark: walls coloured by how
 * wet they are, and surfaces washed or hatched to show extent. A key that explained only the colours
 * would leave the floor and ceiling — which occupy the same footprint in plan and are told apart
 * purely by treatment — as something the reader has to guess at. This travels with the sketch
 * wherever it is shown, so it has to stand on its own for someone who was not on site.
 */
export function MoistureLegend() {
  const bands: (ConcernBand | null)[] = ["dry", "slight", "elevated", "high", null];
  return (
    <div className="moisture-legend" role="group" aria-label="Moisture map key">
      <span className="moisture-legend-group">
        <span className="moisture-legend-heading">Walls</span>
        {bands.map((band) => (
          <span key={band ?? "unknown"} className="moisture-legend-item">
            {/* Dashed border mirrors the dashed wall on the plan — see AffectedWalls. */}
            <span
              className="moisture-legend-swatch"
              style={{
                background: band === null ? UNKNOWN_BAND_COLOR : BAND_COLOR[band],
                borderStyle: band === null ? "dashed" : "solid",
              }}
              aria-hidden="true"
            />
            {bandLabel(band)}
          </span>
        ))}
      </span>

      <span className="moisture-legend-group">
        <span className="moisture-legend-heading">Extent</span>
        <span className="moisture-legend-item">
          <span className="moisture-legend-swatch moisture-legend-floor" aria-hidden="true" />
          Affected floor
        </span>
        <span className="moisture-legend-item">
          <span className="moisture-legend-swatch moisture-legend-ceiling" aria-hidden="true" />
          Affected ceiling
        </span>
      </span>
    </div>
  );
}
