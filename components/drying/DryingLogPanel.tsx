"use client";

import { useMemo, useState } from "react";
import "./drying-log.css";
import { NumberField } from "./NumberField";
import { BAND_COLOR, concernBand, MATERIAL_LABEL, MATERIAL_ORDER, setReferenceReading, type MoistureMap, type MoistureMaterial } from "@/lib/moisture";
import type { Sketch } from "@/lib/sketch";
import {
  airFigures,
  dayNumber,
  formatVisitDate,
  formatVisitTime,
  goalLimit,
  gppGap,
  localNow,
  logStatus,
  newPoint,
  newVisit,
  pointState,
  pointsFromMoisture,
  previousReading,
  readingMatrix,
  readingValue,
  standardFor,
  startDryingLog,
  STANDARD_FROM_LABEL,
  tempForDisplay,
  tempFromEntry,
  tempLabel,
  trend,
  trimNumber,
  withoutPoint,
  withoutVisit,
  withPoint,
  withReading,
  withVisit,
  type AirReading,
  type DryingLog,
  type DryingPoint,
  type DryingVisit,
  type EquipmentCounts,
  type LogStatus,
  type StandardFrom,
  type TempUnit,
  type VisitAir,
} from "@/lib/dryingLog";
import { canPrintDryingLog } from "@/lib/dryingLogPdf";

/**
 * The drying log, as the person on site uses it (2026-10-13).
 *
 * Built around one habit: a tech comes back to the same places every day and types a number at each.
 * So a visit is a form, not a document. Everything that does not change is already filled in (who, the
 * meter, the equipment, the points), everything that is measured is left blank so a stale number can never
 * pass for today's, and the previous reading sits beside each field so the tech can see at once whether the
 * wall is drying. Nothing here is computed in the component: the judgement of a reading, the day number and
 * the status all come from `lib/dryingLog.ts`, which is what the printed log uses as well, so the screen and
 * the page cannot disagree.
 */

export interface DryingLogPanelProps {
  log: DryingLog;
  onChange: (next: DryingLog) => void;
  sketch: Sketch;
  moisture: MoistureMap;
  /** The dry standards live on the moisture map (one per material for the claim), so editing one changes that. */
  onMoistureChange: (next: MoistureMap) => void;
  /** Who is signed in, to name on a new visit. */
  defaultBy: string;
  /** What the drying plan calls for: the first visit's equipment starts here. */
  equipment: EquipmentCounts | null;
  onDownload: () => void;
  onClose: () => void;
}

export function DryingLogPanel({ log, onChange, sketch, moisture, onMoistureChange, defaultBy, equipment, onDownload, onClose }: DryingLogPanelProps) {
  const status = useMemo(() => logStatus(log, moisture), [log, moisture]);
  // A visit id, "summary", or "latest" (whichever visit is newest, so the form follows a visit added elsewhere).
  const [view, setView] = useState<string>("latest");

  const latest = log.visits.length > 0 ? (log.visits[log.visits.length - 1] as DryingVisit) : null;
  const activeVisit = view === "summary" ? null : (log.visits.find((v) => v.id === view) ?? latest);
  const showingSummary = view === "summary" && log.visits.length > 0;

  function start() {
    onChange(startDryingLog({ sketch, map: moisture, now: localNow(), by: defaultBy, equipment, existing: log }));
    setView("latest");
  }

  function addVisit() {
    const visit = newVisit(log, { now: localNow(), by: defaultBy, equipment });
    onChange(withVisit(log, visit));
    setView(visit.id);
  }

  return (
    <section className="dlog" aria-label="Drying log">
      <div className="dlog-head">
        <h2>Drying log</h2>
        <div className="dlog-head-actions">
          <button type="button" className="btn-secondary" onClick={onDownload} disabled={!canPrintDryingLog(log)}>
            Download PDF
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {log.visits.length === 0 ? (
        <StartCard log={log} sketch={sketch} moisture={moisture} onStart={start} />
      ) : (
        <>
          <StatusStrip status={status} />

          <div className="dlog-tabs" role="tablist" aria-label="Visits">
            {log.visits.map((visit) => {
              const day = dayNumber(log, visit);
              const selected = !showingSummary && activeVisit?.id === visit.id;
              return (
                <button key={visit.id} type="button" role="tab" aria-selected={selected} className="dlog-tab" onClick={() => setView(visit.id)}>
                  {day === null ? "Visit" : `Day ${day}`} · {formatVisitDate(visit.at)}
                </button>
              );
            })}
            <button type="button" role="tab" aria-selected={showingSummary} className="dlog-tab" onClick={() => setView("summary")}>
              Summary
            </button>
            <button type="button" className="dlog-tab dlog-tab-add" onClick={addVisit}>
              + Visit
            </button>
          </div>

          {showingSummary ? (
            <Summary log={log} onChange={onChange} sketch={sketch} moisture={moisture} onMoistureChange={onMoistureChange} />
          ) : activeVisit ? (
            <VisitEditor
              key={activeVisit.id}
              log={log}
              map={moisture}
              visit={activeVisit}
              sketch={sketch}
              onLog={onChange}
              onDeleted={() => setView("latest")}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

/* ── starting ───────────────────────────────────────────────────────────────────────────────────── */

function StartCard({ log, sketch, moisture, onStart }: { log: DryingLog; sketch: Sketch; moisture: MoistureMap; onStart: () => void }) {
  const fromMap = pointsFromMoisture(sketch, moisture, log.points).length;
  const total = log.points.length + fromMap;
  return (
    <div className="dlog-start">
      <p>
        {total > 0
          ? `Day 1 starts with ${total} point${total === 1 ? "" : "s"}${fromMap > 0 ? ", the moisture map's among them, and the readings already taken" : ""}.`
          : "Add the places you will read each visit, then type a reading at each, every day, until they are dry."}
      </p>
      <button type="button" className="btn-primary" onClick={onStart}>
        Start Day 1
      </button>
    </div>
  );
}

/* ── where the job stands ───────────────────────────────────────────────────────────────────────── */

function StatusStrip({ status }: { status: LogStatus }) {
  if (status.visitCount === 0) return null;
  const pct = status.activePoints === 0 ? 0 : Math.round((status.atGoal / status.activePoints) * 100);
  let text: string;
  if (status.complete) text = `Complete: all ${status.activePoints} points are at their goal`;
  else if (status.activePoints === 0) text = "No points yet. Add the places you read each visit.";
  else {
    const extra: string[] = [];
    if (status.wet > 0) extra.push(`${status.wet} above goal`);
    if (status.unread > 0) extra.push(`${status.unread} not read`);
    if (status.noStandard > 0) extra.push(`${status.noStandard} with no dry standard`);
    text = `${status.day === null ? "Latest visit" : `Day ${status.day}`}: ${status.atGoal} of ${status.activePoints} points at goal${extra.length > 0 ? ` · ${extra.join(" · ")}` : ""}`;
  }
  return (
    <div className={`dlog-status${status.complete ? " complete" : ""}`} role="status">
      <span>{text}</span>
      {status.activePoints > 0 && (
        <span className="dlog-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}

/* ── one visit ──────────────────────────────────────────────────────────────────────────────────── */

/** The same four sources as `STANDARD_FROM_LABEL`, short enough for a narrow table cell. */
const STANDARD_SHORT: Record<StandardFrom, string> = {
  point: "typed for this point",
  reference: "measured here",
  guide: "published range, not measured",
  unset: "",
};

const AIR_ROWS: { key: keyof VisitAir; label: string }[] = [
  { key: "outside", label: "Outside" },
  { key: "unaffected", label: "Unaffected area" },
  { key: "affected", label: "Affected area" },
];

function VisitEditor({
  log,
  map,
  visit,
  sketch,
  onLog,
  onDeleted,
}: {
  log: DryingLog;
  map: MoistureMap;
  visit: DryingVisit;
  sketch: Sketch;
  onLog: (next: DryingLog) => void;
  onDeleted: () => void;
}) {
  const [editingPoints, setEditingPoints] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showStopped, setShowStopped] = useState(false);

  const setVisit = (patch: Partial<DryingVisit>) => onLog(withVisit(log, { ...visit, ...patch }));
  const index = log.visits.findIndex((v) => v.id === visit.id);
  const before = index > 0 ? (log.visits[index - 1] as DryingVisit) : null;
  const unit = log.tempUnit;
  const day = dayNumber(log, visit);
  const active = log.points.filter((p) => p.active);
  const stopped = log.points.filter((p) => !p.active);
  const fromMap = pointsFromMoisture(sketch, map, log.points);
  const gap = gppGap(visit.air);
  const atGoal = active.filter((p) => pointState(readingValue(visit, p.id), standardFor(p, map).value, log.goalMarginPercent) === "dry").length;

  return (
    <div>
      <div className="dlog-fields">
        <label className="dlog-field">
          {day === null ? "Visit" : `Day ${day}`}: date and time
          <input
            type="datetime-local"
            value={visit.at}
            onChange={(e) => {
              // A cleared field would leave a visit with no date; keep the one it had.
              if (e.target.value) setVisit({ at: e.target.value.slice(0, 16) });
            }}
          />
        </label>
        <label className="dlog-field">
          Readings taken by
          <input type="text" value={visit.by} onChange={(e) => setVisit({ by: e.target.value })} autoComplete="off" />
        </label>
        <label className="dlog-field">
          Meter (make and model)
          <input type="text" value={visit.meter} onChange={(e) => setVisit({ meter: e.target.value })} autoComplete="off" placeholder={before?.meter || ""} />
        </label>
      </div>

      <div className="dlog-section">
        <h3>Air</h3>
        <div className="dlog-air">
          {AIR_ROWS.map(({ key, label }) => (
            <AirRow
              key={key}
              label={label}
              air={visit.air[key]}
              previous={before ? before.air[key] : null}
              unit={unit}
              onChange={(next) => setVisit({ air: { ...visit.air, [key]: next } })}
            />
          ))}
        </div>
        {gap !== null && (
          <p className="dlog-hint">
            {gap > 0
              ? `The affected air holds ${gap} GPP more moisture than the unaffected air.`
              : gap < 0
                ? `The affected air is ${Math.abs(gap)} GPP drier than the unaffected air.`
                : "The affected air matches the unaffected air."}
          </p>
        )}
      </div>

      <div className="dlog-section">
        <h3>
          Moisture points
          <span className="dlog-aside">
            {active.length === 0 ? "none yet" : `${atGoal} of ${active.length} at goal`}
            {" · "}
            <button type="button" className="dlog-link" onClick={() => setEditingPoints((v) => !v)}>
              {editingPoints ? "Done editing" : "Edit points"}
            </button>
          </span>
        </h3>

        {fromMap.length > 0 && (
          <p className="dlog-hint" style={{ marginBottom: 10 }}>
            The moisture map has {fromMap.length} point{fromMap.length === 1 ? "" : "s"} that {fromMap.length === 1 ? "is" : "are"} not in this log.{" "}
            <button type="button" className="dlog-link" onClick={() => onLog({ ...log, points: [...log.points, ...fromMap] })}>
              Add {fromMap.length === 1 ? "it" : "them"}
            </button>
          </p>
        )}

        {active.length === 0 ? (
          <p className="dlog-hint">No points are being read. Add the places you read each visit.</p>
        ) : (
          <div className="dlog-points">
            {active.map((point) => (
              <PointRow
                key={point.id}
                log={log}
                map={map}
                point={point}
                visit={visit}
                editing={editingPoints}
                onVisit={(next) => onLog(withVisit(log, next))}
                onPoint={(next) => onLog(withPoint(log, next))}
                onRemove={() => onLog(withoutPoint(log, point.id))}
              />
            ))}
          </div>
        )}

        {stopped.length > 0 && (
          <div className="dlog-stopped">
            <button type="button" className="dlog-link" onClick={() => setShowStopped((v) => !v)} aria-expanded={showStopped}>
              {showStopped ? "Hide" : "Show"} {stopped.length} point{stopped.length === 1 ? "" : "s"} no longer read
            </button>
            {showStopped && (
              <ul>
                {stopped.map((point) => (
                  <li key={point.id}>
                    <span>{point.label}</span>
                    <button type="button" className="dlog-link" onClick={() => onLog(withPoint(log, { ...point, active: true }))}>
                      Read it again
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {adding ? (
          <AddPoint
            onAdd={(label, material) => {
              onLog(withPoint(log, newPoint({ label, material })));
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <div className="dlog-actions">
            <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
              + Add a point
            </button>
          </div>
        )}
      </div>

      <div className="dlog-section">
        <h3>Equipment</h3>
        <div className="dlog-fields">
          <label className="dlog-field">
            Air movers
            <NumberField
              value={visit.equipment.airMovers}
              onChange={(n) => setVisit({ equipment: { ...visit.equipment, airMovers: n === null ? null : Math.round(n) } })}
              placeholder={before?.equipment.airMovers == null ? "" : String(before.equipment.airMovers)}
              ariaLabel="Air movers running"
            />
          </label>
          <label className="dlog-field">
            Dehumidifiers
            <NumberField
              value={visit.equipment.dehumidifiers}
              onChange={(n) => setVisit({ equipment: { ...visit.equipment, dehumidifiers: n === null ? null : Math.round(n) } })}
              placeholder={before?.equipment.dehumidifiers == null ? "" : String(before.equipment.dehumidifiers)}
              ariaLabel="Dehumidifiers running"
            />
          </label>
          <label className="dlog-field">
            Equipment notes
            <input
              type="text"
              value={visit.equipment.notes}
              onChange={(e) => setVisit({ equipment: { ...visit.equipment, notes: e.target.value } })}
              autoComplete="off"
              placeholder="moved, added, removed"
            />
          </label>
        </div>
      </div>

      <div className="dlog-section">
        <h3>Notes</h3>
        <textarea value={visit.notes} onChange={(e) => setVisit({ notes: e.target.value })} aria-label="Visit notes" />
      </div>

      {confirmDelete ? (
        <div className="dlog-confirm" role="alertdialog" aria-label="Delete this visit">
          <span>Delete {day === null ? "this visit" : `Day ${day}`} and everything entered at it?</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              onLog(withoutVisit(log, visit.id));
              onDeleted();
            }}
          >
            Yes, delete it
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <div className="dlog-actions">
          <button type="button" className="dlog-link danger" onClick={() => setConfirmDelete(true)}>
            Delete this visit
          </button>
        </div>
      )}
    </div>
  );
}

function AirRow({
  label,
  air,
  previous,
  unit,
  onChange,
}: {
  label: string;
  air: AirReading;
  previous: AirReading | null;
  unit: TempUnit;
  onChange: (next: AirReading) => void;
}) {
  const figures = airFigures(air);
  const typedBoth = air.tempF !== null && air.rh !== null;
  const previousTemp = tempForDisplay(previous?.tempF ?? null, unit);
  return (
    <div className="dlog-air-row">
      <div className="dlog-air-name">
        <span>{label}</span>
        <span className="dlog-air-figures">
          {figures
            ? `${Math.round(figures.gpp)} GPP · dew point ${trimNumber(tempForDisplay(figures.dewPointF, unit) as number, 0)}${tempLabel(unit)}`
            : typedBoth
              ? "check these two numbers"
              : "type both for GPP"}
        </span>
      </div>
      <label className="dlog-field">
        Temperature ({tempLabel(unit)})
        <NumberField
          allowNegative
          value={tempForDisplay(air.tempF, unit)}
          onChange={(n) => onChange({ ...air, tempF: tempFromEntry(n, unit) })}
          placeholder={previousTemp === null ? "" : String(previousTemp)}
          ariaLabel={`${label} temperature`}
        />
      </label>
      <label className="dlog-field">
        Humidity (% RH)
        <NumberField
          value={air.rh}
          onChange={(n) => onChange({ ...air, rh: n })}
          placeholder={previous?.rh == null ? "" : String(previous.rh)}
          ariaLabel={`${label} relative humidity`}
        />
      </label>
    </div>
  );
}

function PointRow({
  log,
  map,
  point,
  visit,
  editing,
  onVisit,
  onPoint,
  onRemove,
}: {
  log: DryingLog;
  map: MoistureMap;
  point: DryingPoint;
  visit: DryingVisit;
  editing: boolean;
  onVisit: (next: DryingVisit) => void;
  onPoint: (next: DryingPoint) => void;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const standard = standardFor(point, map);
  const value = readingValue(visit, point.id);
  const state = pointState(value, standard.value, log.goalMarginPercent);
  const last = previousReading(log, visit.id, point.id);
  const change = trend(last?.value ?? null, value);
  const lastDay = last ? dayNumber(log, last.visit) : null;
  // How warm an above-goal chip is comes from the moisture map's own bands, so the log and the map agree on "very
  // wet". But the map calls a reading within 5% of the way from dry to soaked "at dry standard" (grey), which can
  // still be over this log's goal, and a grey "Above goal" would say two things at once: never colder than "slight".
  const mapBand = value !== null && state === "wet" ? concernBand(value, standard.value, point.material) : null;
  const band = mapBand === null || mapBand === "dry" ? "slight" : mapBand;

  return (
    <div className="dlog-point">
      <div className="dlog-point-head">
        <div>
          <div className="dlog-point-name">{point.label}</div>
          <div className="dlog-point-meta">
            {MATERIAL_LABEL[point.material]}
            {standard.value === null
              ? " · no dry standard yet"
              : // Three places, not two: 0.75 plus 10% is 0.825, and "0.83 or less" would call a reading of 0.83 dry when the log calls it wet.
                ` · standard ${trimNumber(standard.value, 2)} (${STANDARD_FROM_LABEL[standard.from]}) · goal ${trimNumber(goalLimit(standard.value, log.goalMarginPercent), 3)} or less`}
          </div>
        </div>
        {state === "dry" && <span className="dlog-chip dry">✓ At goal</span>}
        {state === "wet" && (
          <span className="dlog-chip" style={{ background: BAND_COLOR[band] }}>
            Above goal
          </span>
        )}
        {state === "no-standard" && <span className="dlog-chip muted">No standard</span>}
      </div>

      <div className="dlog-point-entry">
        <label className="dlog-field">
          Reading
          <NumberField
            value={value}
            onChange={(n) => onVisit(withReading(visit, point.id, n))}
            placeholder={last ? String(last.value) : ""}
            ariaLabel={`${point.label} reading`}
          />
        </label>
        {last && (
          <span className="dlog-prev">
            Last {trimNumber(last.value, 2)}
            {lastDay !== null ? ` (Day ${lastDay})` : ""}
            {change && change.direction !== "same" && (
              <>
                {" "}
                <span className={change.direction === "down" ? "dlog-trend-down" : "dlog-trend-up"}>
                  {change.direction === "down" ? "▼" : "▲"} {trimNumber(Math.abs(change.delta), 2)}
                </span>
              </>
            )}
            {change && change.direction === "same" && " · no change"}
          </span>
        )}
      </div>

      {state === "dry" && !editing && (
        <div className="dlog-row-actions">
          <button type="button" className="dlog-link" onClick={() => onPoint({ ...point, active: false })}>
            Dry: stop reading this point
          </button>
        </div>
      )}

      {editing && (
        <div className="dlog-point-edit">
          <label className="dlog-field">
            Name
            <input type="text" value={point.label} onChange={(e) => onPoint({ ...point, label: e.target.value })} autoComplete="off" />
          </label>
          <label className="dlog-field">
            Material
            <select value={point.material} onChange={(e) => onPoint({ ...point, material: e.target.value as MoistureMaterial })}>
              {MATERIAL_ORDER.map((m) => (
                <option key={m} value={m}>
                  {MATERIAL_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="dlog-field">
            Dry standard for this point only
            <NumberField
              value={point.standard}
              onChange={(n) => onPoint({ ...point, standard: n })}
              placeholder={standard.from === "point" ? "" : standard.value === null ? "none" : `job: ${trimNumber(standard.value, 2)}`}
              ariaLabel={`${point.label} own dry standard`}
            />
          </label>
          <div className="dlog-row-actions" style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="dlog-link" onClick={() => onPoint({ ...point, active: false })}>
              Stop reading it
            </button>
            {confirmRemove ? (
              <>
                <span className="dlog-prev">Remove it and every reading taken at it?</span>
                <button type="button" className="dlog-link danger" onClick={onRemove}>
                  Yes, remove
                </button>
                <button type="button" className="dlog-link" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="dlog-link danger" onClick={() => setConfirmRemove(true)}>
                Remove point
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddPoint({ onAdd, onCancel }: { onAdd: (label: string, material: MoistureMaterial) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [material, setMaterial] = useState<MoistureMaterial>("drywall");
  return (
    <div className="dlog-add-point">
      <label className="dlog-field">
        Where
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Hall, subfloor by the tub" autoComplete="off" />
      </label>
      <label className="dlog-field">
        Material
        <select value={material} onChange={(e) => setMaterial(e.target.value as MoistureMaterial)}>
          {MATERIAL_ORDER.map((m) => (
            <option key={m} value={m}>
              {MATERIAL_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="dlog-row-actions">
        <button type="button" className="btn-secondary" onClick={() => onAdd(label, material)} disabled={label.trim() === ""}>
          Add point
        </button>
        <button type="button" className="dlog-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── the summary ────────────────────────────────────────────────────────────────────────────────── */

function Summary({
  log,
  onChange,
  sketch,
  moisture,
  onMoistureChange,
}: {
  log: DryingLog;
  onChange: (next: DryingLog) => void;
  sketch: Sketch;
  moisture: MoistureMap;
  onMoistureChange: (next: MoistureMap) => void;
}) {
  const rows = readingMatrix(log, moisture);
  const materials = MATERIAL_ORDER.filter((m) => log.points.some((p) => p.material === m));
  const fromMap = pointsFromMoisture(sketch, moisture, log.points);
  const unit = log.tempUnit;

  return (
    <div>
      <div className="dlog-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
        <h3>Readings by visit</h3>
        {rows.length === 0 ? (
          <p className="dlog-hint">No points yet.</p>
        ) : (
          <div className="dlog-scroll">
            <table className="dlog-table">
              <thead>
                <tr>
                  <th>Point</th>
                  {log.visits.map((v) => (
                    <th key={v.id} className="num">
                      {dayNumber(log, v) === null ? "Visit" : `Day ${dayNumber(log, v)}`}
                      <span className="sub">{formatVisitDate(v.at)}</span>
                    </th>
                  ))}
                  <th className="num">Dry on</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.point.id}>
                    <td>
                      {row.point.label}
                      {!row.point.active && " (stopped)"}
                      <span className="sub">
                        {MATERIAL_LABEL[row.point.material]} · {row.standard.value === null ? "no standard" : `standard ${trimNumber(row.standard.value, 2)}`}
                      </span>
                      <span className="sub">{STANDARD_SHORT[row.standard.from]}</span>
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.visitId} className={`num ${cell.state === "dry" ? "dlog-cell-dry" : cell.value === null ? "dlog-cell-none" : ""}`}>
                        {cell.value === null ? "–" : `${cell.state === "dry" ? "✓ " : ""}${trimNumber(cell.value, 2)}`}
                      </td>
                    ))}
                    <td className="num">{row.dryOnDay === null ? "–" : `Day ${row.dryOnDay}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dlog-hint">✓ means at or below the goal: the dry standard plus {trimNumber(log.goalMarginPercent, 1)}%.</p>
      </div>

      <div className="dlog-section">
        <h3>Air and equipment</h3>
        <div className="dlog-scroll">
          <table className="dlog-table">
            <thead>
              <tr>
                <th>Visit</th>
                <th>Outside</th>
                <th>Unaffected</th>
                <th>Affected</th>
                <th className="num">GPP gap</th>
                <th>Equipment</th>
              </tr>
            </thead>
            <tbody>
              {log.visits.map((v) => {
                const gap = gppGap(v.air);
                return (
                  <tr key={v.id}>
                    <td>
                      {dayNumber(log, v) === null ? "Visit" : `Day ${dayNumber(log, v)}`}
                      <span className="sub">
                        {formatVisitDate(v.at)} {formatVisitTime(v.at)}
                      </span>
                    </td>
                    {(["outside", "unaffected", "affected"] as const).map((key) => {
                      const f = airFigures(v.air[key]);
                      return (
                        <td key={key}>
                          {f ? `${trimNumber(tempForDisplay(f.tempF, unit) as number, 1)}${tempLabel(unit)} · ${trimNumber(f.rh, 1)}%` : "–"}
                          {f && <span className="sub">{Math.round(f.gpp)} GPP</span>}
                        </td>
                      );
                    })}
                    <td className="num">{gap === null ? "–" : `${gap > 0 ? "+" : ""}${gap}`}</td>
                    <td>
                      {v.equipment.airMovers === null && v.equipment.dehumidifiers === null
                        ? "–"
                        : `${v.equipment.airMovers ?? "?"} air mover${v.equipment.airMovers === 1 ? "" : "s"}, ${v.equipment.dehumidifiers ?? "?"} dehumidifier${v.equipment.dehumidifiers === 1 ? "" : "s"}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dlog-section">
        <h3>Settings</h3>
        <div className="dlog-settings">
          <div className="dlog-setting">
            <span>Dry goal: the dry standard plus</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <NumberField
                value={log.goalMarginPercent}
                onChange={(n) => onChange({ ...log, goalMarginPercent: n === null ? 0 : Math.min(100, n) })}
                ariaLabel="Goal variance in percent"
              />
              %
            </span>
          </div>
          <p className="dlog-hint" style={{ margin: 0 }}>
            IICRC S500 is cited as recommending a goal within 10% of the dry standard. Change it if your company works to another figure; it is printed on the log.
          </p>
          <div className="dlog-setting">
            <span>Temperature</span>
            <span className="dlog-seg" role="group" aria-label="Temperature unit">
              {(["F", "C"] as const).map((u) => (
                <button key={u} type="button" aria-pressed={unit === u} onClick={() => onChange({ ...log, tempUnit: u })}>
                  {tempLabel(u)}
                </button>
              ))}
            </span>
          </div>

          {materials.length > 0 && (
            <div>
              <div className="dlog-setting" style={{ marginBottom: 8 }}>
                <span>Dry standard for this job</span>
              </div>
              <div className="dlog-settings">
                {materials.map((material) => {
                  const measured = moisture.reference?.[material];
                  return (
                    <label key={material} className="dlog-standard-row">
                      <span>{MATERIAL_LABEL[material]}</span>
                      <NumberField
                        value={measured ?? null}
                        onChange={(n) => onMoistureChange(setReferenceReading(moisture, material, n))}
                        placeholder="–"
                        ariaLabel={`${MATERIAL_LABEL[material]} dry standard`}
                      />
                      <span className="dlog-hint">{measured != null ? "measured on unaffected material" : "not measured: a published range is used"}</span>
                    </label>
                  );
                })}
              </div>
              <p className="dlog-hint">Meter an unaffected area of each material in this building, with the same meter, and enter it here.</p>
            </div>
          )}
        </div>
      </div>

      {fromMap.length > 0 && (
        <div className="dlog-actions">
          <button type="button" className="btn-secondary" onClick={() => onChange({ ...log, points: [...log.points, ...fromMap] })}>
            Add {fromMap.length} point{fromMap.length === 1 ? "" : "s"} from the moisture map
          </button>
        </div>
      )}
    </div>
  );
}
