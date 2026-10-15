"use client";

import { type ReactNode, useRef, useState, useSyncExternalStore } from "react";
import { connection, isNetworkFailure, netFetch, onConnectionChange } from "@/lib/connectivity";
import {
  type ExteriorRoof,
  formatPitch,
  hasTypedTotals,
  type PhotoRoofCheck,
  type PitchReading,
  reportPitchFlags,
  reportLabel,
  type RoofReport,
  ROOF_TOTAL_KEYS,
  ROOF_TOTAL_LABEL,
  type RoofingQuantities,
  type RoofTotalKey,
  totalDisagreement,
  typedSource,
  typedTotal,
} from "@/lib/exterior";
import { ROOF_REPORT_MAX_BYTES, type RoofReportResponse } from "@/lib/roofReport";
import { parseFeetInches } from "@/lib/sketch";
import { formatQuantity } from "@/lib/sketchQuantities";
import { NumberField } from "./exteriorFields";

/**
 * "Enter roof totals yourself" (2026-10-14): any roof can be scoped, whatever the drawing can make
 * of it. The estimator types what a roof report says, or what was measured by hand - a dormer, a
 * turret, a curved roof - and each total typed replaces the drawing's on the scope, the quantities
 * and the documents, which say where each number came from. A box left blank keeps the drawing's,
 * shown in it, so only what differs needs typing. With no outline drawn, the typed totals are the
 * whole roof. The model is lib/exterior.ts (`ExteriorRoof.typed`).
 *
 * "Read a roof report" (2026-10-15): the report's PDF is read by Claude (lib/roofReport.ts) and what
 * it says is offered beside each box, to take or set aside one at a time - never applied by itself. A
 * total taken is said to be from the roof report. Where a drawing is there to check against, a total
 * further from it than the drawing could be (5% on squares, 10% on a length) says so beside its box.
 */

type Update = (f: (roof: ExteriorRoof) => ExteriorRoof) => void;

/** The lengths, in the order a roof report lists them. */
const LENGTHS: RoofTotalKey[] = ["ridge", "hip", "valley", "eave", "rake", "step", "headwall", "dripEdge", "starter", "iceWater"];
/** What a total that follows others is made of, while it is left blank. */
const MADE_OF: Partial<Record<RoofTotalKey, string>> = { dripEdge: "eaves + rakes", starter: "eaves", iceWater: "eaves + valleys" };
/** Where each length is in the quantities, typed or not. */
const FEET_OF: Record<Exclude<RoofTotalKey, "squareFeet">, (r: RoofingQuantities) => number> = {
  ridge: (r) => r.ridgeFeet,
  hip: (r) => r.hipFeet,
  valley: (r) => r.valleyFeet,
  eave: (r) => r.eaveFeet,
  rake: (r) => r.rakeFeet,
  step: (r) => r.stepFeet,
  headwall: (r) => r.headwallFeet,
  dripEdge: (r) => r.dripEdgeFeet,
  starter: (r) => r.starterFeet,
  iceWater: (r) => r.iceWaterFeet,
};

const parseNumber = (raw: string): number | null => {
  const n = Number(raw.replace(/,/g, "").replace(/\s*(sq|squares?|sf|ft|lf)\.?$/i, ""));
  return Number.isFinite(n) ? n : null;
};
/** Decimal feet as a report gives them, or feet and inches as a tape does: 45.3, 45'3". */
const parseLength = (raw: string): number | null => parseFeetInches(raw.replace(/\s*lf\.?$/i, "")) ?? parseNumber(raw);

/** A total as the boxes show it: squares to the hundredth, lengths to the tenth. */
const shownTotal = (key: RoofTotalKey, v: number) => (key === "squareFeet" ? `${(v / 100).toFixed(2)} SQ` : `${formatQuantity(Math.round(v * 10) / 10)} LF`);

/** A total's box: blank to take the drawing's, which it shows. */
function TotalBox({
  id,
  label,
  unit,
  value,
  placeholder,
  note,
  readOnly,
  parse,
  onCommit,
  children,
}: {
  id: string;
  label: string;
  unit: string;
  value: number | null;
  placeholder: string;
  note?: string;
  readOnly: boolean;
  parse: (raw: string) => number | null;
  onCommit: (v: number | null) => void;
  /** Under the box: what the roof report offers for it, and how far it is from the drawing. */
  children?: ReactNode;
}) {
  const shown = value == null ? "" : String(unit === "SQ" ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10);
  return (
    <div className="exterior-field">
      <label className="exterior-field-label" htmlFor={id}>
        {label} <span className="roof-total-unit">{unit}</span>
      </label>
      <input
        id={id}
        className={`exterior-feet${value != null ? " roof-total-typed" : ""}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        key={`${id}-${shown}`}
        defaultValue={shown}
        placeholder={placeholder}
        disabled={readOnly}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") {
            if (value !== null) onCommit(null);
            return;
          }
          const v = parse(raw);
          if (v === null || v < 0) {
            e.target.value = shown;
            return;
          }
          if (value === null || Math.abs(v - value) > 1e-9) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      {note && <span className="field-note">{note}</span>}
      {children}
    </div>
  );
}

/** A flag beside a box: this number and the drawing's are further apart than the drawing could be. */
function Flag({ text }: { text: string | null }) {
  return text ? <span className="roof-total-flag">{text}</span> : null;
}

/**
 * The PDF picked, sent, and what it says handed back: a button, and a line saying how it went. With
 * no signal it does not open the picker at all.
 */
function ReadReportButton({ label, readOnly, onRead }: { label: string; readOnly: boolean; onRead: (report: RoofReport) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const online = useSyncExternalStore(onConnectionChange, () => connection() === "online", () => true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (readOnly) return null;

  async function read(file: File) {
    setMessage(null);
    if (file.size > ROOF_REPORT_MAX_BYTES) {
      setMessage(
        `This PDF is ${(file.size / 1e6).toFixed(1)} MB, and Scrivn reads reports up to ${(ROOF_REPORT_MAX_BYTES / 1e6).toFixed(1)} MB. Print it to PDF with only its pages of totals and pitches, and upload that.`,
      );
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const response = await netFetch("/api/exterior/roof-report", { method: "POST", body: form, timeoutMs: 150_000 });
      const body = (await response.json().catch(() => null)) as (RoofReportResponse & { error?: string }) | null;
      if (!response.ok || !body) {
        setMessage(body?.error || "The report could not be read just now. Try again, or type its totals.");
        return;
      }
      if (body.report) onRead(body.report);
      setMessage(body.problem);
    } catch (err) {
      setMessage(isNetworkFailure(err) ? "No signal reached Scrivn, or the read took too long. Try again with signal." : err instanceof Error ? err.message : "The report could not be read.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          if (!online) {
            setMessage("Reading a report needs signal. Type its totals for now, or read it later.");
            return;
          }
          setMessage(null);
          input.current?.click();
        }}
      >
        {busy ? "Reading the report…" : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
        }}
      />
      {busy && <span className="field-note">Reading every page: this takes about half a minute.</span>}
      {message && (
        <span className="field-note roof-total-flag" role="status">
          {message}
        </span>
      )}
    </>
  );
}

export function RoofTotalsPanel({
  roof,
  r,
  pitch,
  showPitch,
  photoCheck,
  readOnly,
  onUpdate,
}: {
  roof: ExteriorRoof;
  r: RoofingQuantities | null;
  pitch: PitchReading;
  /** The pitch is typed here only with no roof drawn: with one it is the roof's own, set under The roof. */
  showPitch: boolean;
  /** The roof as the photos read it (`photoRoofCheck`), for the report to be checked against; null with no reads. */
  photoCheck: PhotoRoofCheck | null;
  readOnly: boolean;
  onUpdate: Update;
}) {
  const typedAny = hasTypedTotals(roof);
  const report = roof.report ?? null;
  const [open, setOpen] = useState(false);
  const drawing = r?.drawing ?? null;
  const setTotal = (key: RoofTotalKey, v: number | null, fromReport = false) =>
    onUpdate((x) => {
      const typed = { ...(x.typed ?? {}) };
      const typedFrom = { ...(x.typedFrom ?? {}) };
      if (v === null) delete typed[key];
      else typed[key] = v;
      // Typed over by hand, a total taken off the report is the estimator's own.
      if (v !== null && fromReport) typedFrom[key] = "report";
      else delete typedFrom[key];
      return { ...x, typed, typedFrom };
    });
  const setAside = (what: RoofTotalKey | "pitch" | "pitches") =>
    onUpdate((x) => (x.report ? { ...x, report: { ...x.report, setAside: [...(x.report.setAside ?? []).filter((k) => k !== what), what] } } : x));
  /** A new report in place of any before it: what was taken off the old one goes, so nothing claims the wrong report. */
  const takeReport = (next: RoofReport) => {
    onUpdate((x) => ({ ...withoutReportTotals(x), report: next }));
    setOpen(true);
  };

  if (!open && !typedAny && !report && drawing !== null) {
    return (
      <div className="exterior-rows roof-totals">
        {!readOnly && (
          <div className="exterior-row">
            <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
              Enter roof totals yourself
            </button>
            <ReadReportButton label="Read a roof report (PDF)" readOnly={readOnly} onRead={takeReport} />
          </div>
        )}
        <p className="field-note">
          For a roof the drawing can&rsquo;t make, or the totals off a roof report: each one typed or taken replaces the drawing&rsquo;s, and a box left blank keeps it.
        </p>
      </div>
    );
  }

  const area = typedTotal(roof, "squareFeet");
  // Blank, a box shows what stands there now: the drawing's, or what a total that follows others adds up to.
  const placeholderOf = (key: Exclude<RoofTotalKey, "squareFeet">): string => {
    if (!r || (!drawing && !MADE_OF[key])) return "";
    const made = MADE_OF[key];
    // A roof piece's share is in it until the box is typed (lib/roofPieces.ts).
    return `${formatQuantity(FEET_OF[key](r))} ${made ? `(${made})` : Math.abs(r.pieces.added[key]) > 0.005 ? (drawing ? "drawn + pieces" : "pieces") : "drawn"}`;
  };
  const named = (keys: RoofTotalKey[]) => keys.map((k) => ROOF_TOTAL_LABEL[k].toLowerCase());
  const typedKeys = ROOF_TOTAL_KEYS.filter((k) => typedTotal(roof, k) !== null);
  const ownKeys = typedKeys.filter((k) => typedSource(roof, k) === "estimator");
  const takenKeys = typedKeys.filter((k) => typedSource(roof, k) === "report");

  /**
   * Under a box: the report's figure to take or set aside (or that it was taken), and any flag against
   * the drawing - and against the photos' roof, where something typed stands over what they read.
   */
  const under = (key: RoofTotalKey): ReactNode => {
    const typed = typedTotal(roof, key);
    const fromReport = typed !== null && typedSource(roof, key) === "report";
    const drawn = drawing?.[key] ?? null;
    const photos = photoCheck && !photoCheck.sameAsDrawing ? (photoCheck.totals?.[key] ?? null) : null;
    const typedFlag = typed !== null && drawn !== null ? totalDisagreement(key, typed, drawn) : null;
    const offered = report && !report.setAside?.includes(key) ? (report.totals[key] ?? null) : null;
    const taken = offered !== null && fromReport && Math.abs((typed as number) - offered) < 1e-9;
    return (
      <>
        {fromReport && <span className="field-note">From the roof report.</span>}
        <Flag text={typedFlag} />
        {fromReport && photos !== null && <Flag text={totalDisagreement(key, typed as number, photos, "photos")} />}
        {offered !== null && !taken && (
          <span className="roof-total-offer">
            <span>
              Report: <strong>{shownTotal(key, offered)}</strong>
            </span>
            {!readOnly && (
              <span className="roof-total-offer-actions">
                <button type="button" className="btn-secondary" onClick={() => setTotal(key, offered, true)} aria-label={`Take the report's ${ROOF_TOTAL_LABEL[key].toLowerCase()}, ${shownTotal(key, offered)}`}>
                  Take
                </button>
                <button type="button" className="btn-secondary" onClick={() => setAside(key)} aria-label={`Set the report's ${ROOF_TOTAL_LABEL[key].toLowerCase()} aside`}>
                  Set aside
                </button>
              </span>
            )}
            {drawn !== null && <Flag text={totalDisagreement(key, offered, drawn)} />}
            {photos !== null && <Flag text={totalDisagreement(key, offered, photos, "photos")} />}
          </span>
        )}
      </>
    );
  };

  return (
    <div className="exterior-rows roof-totals">
      {report && (
        <ReportSummary
          report={report}
          roof={roof}
          pitch={pitch}
          drawn={drawing !== null}
          photoCheck={photoCheck}
          readOnly={readOnly}
          onUpdate={onUpdate}
          onSetAside={setAside}
          onRead={takeReport}
        />
      )}
      <h4 className="exterior-subhead">{report ? "Roof totals" : "Roof totals typed by you"}</h4>
      <p className="field-note">
        {report
          ? "Take each of the report's totals you want, box by box: it is said to be from the roof report. A box left blank keeps the drawing's, shown in grey."
          : drawing
            ? "Each total typed replaces the drawing's, and any roof piece's below, on the scope and the documents, which say it came from you. A box left blank keeps the drawing's, shown in grey."
            : "No outline is drawn, so these totals are the roof. Type what the roof report says, or what you measured: a box left blank is not counted."}
      </p>
      <div className="exterior-grid">
        <TotalBox
          id="roof-total-squares"
          label="Squares"
          unit="SQ"
          value={area === null ? null : area / 100}
          placeholder={drawing ? `${(drawing.squareFeet / 100).toFixed(2)} drawn` : ""}
          readOnly={readOnly}
          parse={parseNumber}
          onCommit={(v) => setTotal("squareFeet", v === null ? null : v * 100)}
        >
          {under("squareFeet")}
        </TotalBox>
        <TotalBox
          id="roof-total-sf"
          label="or area"
          unit="SF"
          value={area}
          placeholder={drawing ? `${formatQuantity(drawing.squareFeet)} drawn` : ""}
          note="On the slope, no waste."
          readOnly={readOnly}
          parse={parseNumber}
          onCommit={(v) => setTotal("squareFeet", v)}
        />
        {showPitch && (
          <NumberField
            id="roof-total-pitch"
            label="Pitch (rise in 12)"
            value={roof.pitch}
            placeholder={pitch.source !== "typed" && pitch.value !== null ? `${Math.round(pitch.value * 100) / 100}${pitch.source === "assumed" ? " assumed" : pitch.source === "photos" ? " from photos" : ""}` : ""}
            readOnly={readOnly}
            max={24}
            onCommit={(v) => onUpdate((x) => ({ ...x, pitch: v }))}
            note={roof.pitch === null && pitch.source === "assumed" ? `Blank: ${formatPitch(pitch.value ?? 0)} is assumed, and asked for.` : "For the steep charge and the scope line."}
          />
        )}
        {LENGTHS.map((key) => (
          <TotalBox
            key={key}
            id={`roof-total-${key}`}
            label={ROOF_TOTAL_LABEL[key]}
            unit="LF"
            value={typedTotal(roof, key)}
            placeholder={key === "squareFeet" ? "" : placeholderOf(key)}
            readOnly={readOnly}
            parse={parseLength}
            onCommit={(v) => setTotal(key, v)}
          >
            {under(key)}
          </TotalBox>
        ))}
      </div>
      <p className="field-note">
        {typedKeys.length > 0
          ? [ownKeys.length > 0 ? `Typed: ${named(ownKeys).join(", ")}.` : "", takenKeys.length > 0 ? `From the roof report: ${named(takenKeys).join(", ")}.` : "", drawing ? "The rest are the drawing's." : ""]
              .filter(Boolean)
              .join(" ")
          : drawing
            ? "Nothing typed or taken yet: every total is the drawing's."
            : "Nothing typed yet."}
        {r && drawing && r.typed && !r.allEdges ? " The eavestrough, soffit and fascia follow the eaves and rakes picked on the plan." : ""}
      </p>
      {!readOnly && (
        <div className="exterior-row">
          {!report && <ReadReportButton label="Read a roof report (PDF)" readOnly={readOnly} onRead={takeReport} />}
          {typedAny && (
            <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, typed: {}, typedFrom: {} }))}>
              Clear what is typed
            </button>
          )}
          {drawing && !typedAny && !report && (
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The roof without the report, or anything taken off it. */
function withoutReportTotals(x: ExteriorRoof): ExteriorRoof {
  const typed = { ...(x.typed ?? {}) };
  const typedFrom = { ...(x.typedFrom ?? {}) };
  for (const k of ROOF_TOTAL_KEYS) {
    if (typedFrom[k] !== "report") continue;
    delete typed[k];
    delete typedFrom[k];
  }
  const rest = { ...x, typed, typedFrom };
  delete rest.report;
  return rest;
}

/**
 * Which report this is - maker, date, address, file - with what it says the estimator should know, its
 * pitch to take, and its areas by pitch. Above the boxes, so what the numbers are from is read first.
 */
function ReportSummary({
  report,
  roof,
  pitch,
  drawn,
  photoCheck,
  readOnly,
  onUpdate,
  onSetAside,
  onRead,
}: {
  report: RoofReport;
  roof: ExteriorRoof;
  pitch: PitchReading;
  drawn: boolean;
  photoCheck: PhotoRoofCheck | null;
  readOnly: boolean;
  onUpdate: Update;
  onSetAside: (what: "pitch" | "pitches") => void;
  onRead: (report: RoofReport) => void;
}) {
  const label = reportLabel(report);
  const pitchOffered = report.pitch !== null && !report.setAside?.includes("pitch");
  const pitchTaken = report.pitch !== null && roof.pitch !== null && Math.abs(roof.pitch - report.pitch) < 1e-9;
  const withArea = report.pitches.filter((p) => p.squareFeet !== null);
  // The areas by pitch price the squares at each pitch only with no outline: a drawn roof has its own.
  const pitchesUsable = !drawn && withArea.length > 1;
  const nothing = Object.keys(report.totals).length === 0;
  // The photos are the route and the report the cross-check: its pitch is said against theirs, and taking it is typing over them.
  const photoPitch = photoCheck?.mainPitch ?? null;
  const overPhotos = photoPitch !== null && report.pitch !== null && Math.abs(photoPitch.value - report.pitch) > 1e-9;
  const pitchFlags = reportPitchFlags(report, photoCheck);
  return (
    <div className="roof-report">
      <h4 className="exterior-subhead">Roof report</h4>
      <p className="roof-report-name">
        <strong>{label ?? "No maker or date given"}</strong>
        {report.address ? ` · ${report.address}` : ""}
      </p>
      <span className="field-note">Read from {report.fileName}</span>
      {report.notes.length > 0 && (
        <ul className="roof-report-notes">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {nothing && <p className="field-note roof-total-flag">The report gave no totals to take.</p>}
      {photoCheck && (
        <p className="field-note">
          Checked against what the photos read: {photoCheck.words}.{" "}
          {photoCheck.sameAsDrawing
            ? "The drawing is built on those reads, so its figures are the photos'."
            : "Something typed stands over them, so each box is checked against the photos' roof as well as the drawing."}{" "}
          Nothing from the report is used until you take it.
        </p>
      )}
      <div className="exterior-row">
        <span className="exterior-row-label">
          Pitch: <strong>{report.pitch === null ? "not given" : formatPitch(report.pitch)}</strong>
        </span>
        {report.pitch === null ? (
          <span className="field-note">The report gives no pitch: the roof stays at {pitch.value === null ? "its own" : formatPitch(pitch.value)}{pitch.source === "assumed" ? ", assumed" : ""}.</span>
        ) : pitchTaken ? (
          <span className="field-note">
            Taken: the roof is at {formatPitch(report.pitch)}
            {overPhotos ? `, typed over the photos' ${formatPitch(photoPitch.value)}` : ""}.
          </span>
        ) : pitchOffered && !readOnly ? (
          <>
            <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, pitch: report.pitch }))}>
              Take
            </button>
            <button type="button" className="btn-secondary" onClick={() => onSetAside("pitch")}>
              Set aside
            </button>
            {pitch.value !== null && (
              <span className="field-note">
                The roof is at {formatPitch(pitch.value)}
                {pitch.source === "assumed" ? ", assumed" : pitch.source === "photos" ? ", from photos: taking the report's types over them" : ""}.
              </span>
            )}
          </>
        ) : null}
      </div>
      {pitchFlags.map((f) => (
        <span key={f} className="roof-total-flag">
          {f}
        </span>
      ))}
      {report.pitches.length > 1 && (
        <div className="exterior-rows">
          <span className="field-note">
            Areas by pitch:{" "}
            {report.pitches
              .map((p) => `${formatPitch(p.pitch)}${p.squareFeet !== null ? ` on ${formatQuantity(Math.round(p.squareFeet))} SF` : ""}${p.percent !== null ? ` (${Math.round(p.percent)}%)` : ""}`)
              .join(" · ")}
            {drawn ? ". The drawing's own pitches stand: set a part's pitch in Pitch mode." : ""}
          </span>
          {pitchesUsable && !readOnly && !report.setAside?.includes("pitches") && (
            <div className="exterior-row">
              {report.pitchesTaken ? (
                <>
                  <span className="field-note">Taken: the squares are priced at each pitch.</span>
                  <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => (x.report ? { ...x, report: { ...x.report, pitchesTaken: false } } : x))}>
                    Undo
                  </button>
                </>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => (x.report ? { ...x, report: { ...x.report, pitchesTaken: true } } : x))}>
                  Take the squares at each pitch
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {!readOnly && (
        <div className="exterior-row">
          <ReadReportButton label="Read another report" readOnly={readOnly} onRead={onRead} />
          <button type="button" className="btn-secondary" onClick={() => onUpdate(withoutReportTotals)}>
            Remove the report
          </button>
        </div>
      )}
      {!readOnly && <p className="field-note">Reading another report, or removing this one, clears the totals taken from it.</p>}
    </div>
  );
}
