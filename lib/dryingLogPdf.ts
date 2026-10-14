import type { JobInfoGroup } from "./jobInformation";
import type { Letterhead } from "./letterhead";
import type { DocumentPdfParams, PdfTable } from "./pdf";
import { MATERIAL_LABEL, type MoistureMap } from "./moisture";
import {
  airFigures,
  dayNumber,
  formatVisitDate,
  formatVisitDateLong,
  formatVisitTime,
  gppGap,
  logStatus,
  pointsOnGuidedStandard,
  readingMatrix,
  STANDARD_FROM_LABEL,
  standardFor,
  tempForDisplay,
  tempLabel,
  trimNumber,
  type AirReading,
  type DryingLog,
  type DryingVisit,
  type MatrixRow,
  type TempUnit,
} from "./dryingLog";

/**
 * The drying log as a document (2026-10-13): the page an adjuster reads to see that the building was
 * monitored every visit until it was dry.
 *
 * Its own document, not a section of the inspection report. The report is written once, on day one, and
 * the log is not finished for days; a section baked into the report would be a copy of the log as it stood
 * that morning. This is built from the log at the moment it is downloaded or sent, so it is never stale.
 *
 * Everything in it is typed or arithmetic on what was typed. There is no Claude call and so no cost
 * and no model deciding what a reading means. It says plainly what the standard was and whether anybody
 * measured it, which is the first thing a reviewer asks of a "dry" claim.
 *
 * Characters stay inside what a PDF's standard fonts hold: no check marks and no less-than-or-equal
 * signs, which print as blanks. Words do that work instead.
 */

/** Visits per table across the page before the matrix continues in a second table. */
export const VISITS_PER_TABLE = 6;

function visitHeading(log: DryingLog, visit: DryingVisit): string {
  const day = dayNumber(log, visit);
  return day === null ? "Visit" : `Day ${day}`;
}

function airCell(air: AirReading, unit: TempUnit): string {
  const f = airFigures(air);
  if (!f) {
    // Say what was typed even when GPP cannot be worked out: half a reading is still a reading.
    const parts: string[] = [];
    const t = tempForDisplay(air.tempF, unit);
    if (t !== null) parts.push(`${trimNumber(t, 1)}${tempLabel(unit)}`);
    if (air.rh !== null) parts.push(`${trimNumber(air.rh, 1)}% RH`);
    return parts.length > 0 ? parts.join(", ") : "–";
  }
  const t = tempForDisplay(f.tempF, unit) as number;
  return `${trimNumber(t, 1)}${tempLabel(unit)}, ${trimNumber(f.rh, 1)}% RH\n${Math.round(f.gpp)} GPP, dew ${trimNumber(tempForDisplay(f.dewPointF, unit) as number, 0)}${tempLabel(unit)}`;
}

function equipmentCell(visit: DryingVisit): string {
  const e = visit.equipment;
  const parts: string[] = [];
  if (e.airMovers !== null) parts.push(`${e.airMovers} air mover${e.airMovers === 1 ? "" : "s"}`);
  if (e.dehumidifiers !== null) parts.push(`${e.dehumidifiers} dehumidifier${e.dehumidifiers === 1 ? "" : "s"}`);
  if (e.notes.trim()) parts.push(e.notes.trim());
  return parts.length > 0 ? parts.join("\n") : "–";
}

function visitLabel(log: DryingLog, visit: DryingVisit): string {
  const when = [formatVisitDate(visit.at), formatVisitTime(visit.at)].filter(Boolean).join(", ");
  return `${visitHeading(log, visit)}\n${when}`;
}

/** A matrix column's heading: the day and the date, without the time, which is in the air table beside it. */
function visitColumnLabel(log: DryingLog, visit: DryingVisit): string {
  return `${visitHeading(log, visit)}\n${formatVisitDate(visit.at)}`;
}

/** The moisture standard, in words a reviewer can check: the number, and what it rests on. */
function standardSentence(log: DryingLog, map: MoistureMap): string[] {
  const materials = [...new Set(log.points.map((p) => p.material))];
  if (materials.length === 0) return [];
  const rows = materials.map((material) => {
    const point = log.points.find((p) => p.material === material);
    const s = point ? standardFor(point, map) : { value: null, from: "unset" as const };
    return { material, ...s };
  });
  const lines = rows.map((r) =>
    r.value === null ? `${MATERIAL_LABEL[r.material]}: no standard set` : `${MATERIAL_LABEL[r.material]}: ${trimNumber(r.value, 2)} (${STANDARD_FROM_LABEL[r.from]})`,
  );
  return [`Dry standards: ${lines.join("; ")}.`];
}

/** The plain-language lines above the tables. */
export function dryingLogBodyLines(log: DryingLog, map: MoistureMap): string[] {
  const status = logStatus(log, map);
  const lines: string[] = [];

  lines.push("Moisture and air readings taken at each visit, to show the building was monitored until the affected materials reached their drying goal.");
  lines.push("");

  if (status.latest) {
    const when = formatVisitDateLong(status.latest.at);
    const day = status.day === null ? "the latest visit" : `Day ${status.day}`;
    if (status.complete) {
      lines.push(`Status: complete. At ${day} (${when}) all ${status.activePoints} points still being monitored were at their drying goal.`);
    } else if (status.activePoints === 0) {
      lines.push(`Status: ${log.visits.length} visit${log.visits.length === 1 ? "" : "s"} recorded, to ${day} (${when}). No moisture points have been set up to judge.`);
    } else {
      const parts = [`${status.atGoal} of ${status.activePoints} points at their goal`];
      if (status.wet > 0) parts.push(`${status.wet} above it`);
      if (status.unread > 0) parts.push(`${status.unread} not read at that visit`);
      if (status.noStandard > 0) parts.push(`${status.noStandard} with no dry standard to compare against`);
      lines.push(`Status: drying in progress. At ${day} (${when}): ${parts.join(", ")}.`);
    }
  }

  const stopped = log.points.filter((p) => !p.active).length;
  if (stopped > 0) lines.push(`${stopped} point${stopped === 1 ? " was" : "s were"} dry and no longer read; the history is kept below.`);

  lines.push(
    `Goal: a reading at or below the dry standard plus ${trimNumber(log.goalMarginPercent, 1)}%, a variance set for this job. The dry standard is the reading of the same material in an unaffected area of the building, taken with the same meter.`,
  );
  lines.push(...standardSentence(log, map));

  const guided = pointsOnGuidedStandard(log, map);
  if (guided.length > 0) {
    lines.push(
      `Not measured on this job: ${[...new Set(guided.map((p) => MATERIAL_LABEL[p.material]))].join(", ")}. Readings of ${guided.length === 1 ? "this point are" : "these points are"} compared with a published typical range, which is a starting point and not a measurement of this building.`,
    );
  }
  return lines;
}

function matrixTables(log: DryingLog, map: MoistureMap): PdfTable[] {
  const rows = readingMatrix(log, map);
  if (rows.length === 0 || log.visits.length === 0) return [];
  const goalNote = `* At or below the goal (the dry standard plus ${trimNumber(log.goalMarginPercent, 1)}%).  – Not read at that visit.`;

  const chunks: DryingVisit[][] = [];
  for (let i = 0; i < log.visits.length; i += VISITS_PER_TABLE) chunks.push(log.visits.slice(i, i + VISITS_PER_TABLE));

  return chunks.map((visits, chunkIndex) => {
    const columns = [
      { title: "Point", weight: 2.6 },
      { title: "Dry standard", weight: 1.5 },
      ...visits.map((v) => ({ title: visitColumnLabel(log, v), weight: 1.25, align: "center" as const })),
      ...(chunkIndex === chunks.length - 1 ? [{ title: "Dry on", weight: 0.9, align: "center" as const }] : []),
    ];
    const body = rows.map((row: MatrixRow) => {
      const label = `${row.point.label}${row.point.active ? "" : " (stopped)"}\n${MATERIAL_LABEL[row.point.material]}`;
      const standard =
        row.standard.value === null ? "not set" : `${trimNumber(row.standard.value, 2)}\n${row.standard.from === "reference" ? "measured" : row.standard.from === "point" ? "typed" : "published"}`;
      const cells = visits.map((v) => {
        const cell = row.cells.find((c) => c.visitId === v.id);
        if (!cell || cell.value === null) return "–";
        return `${trimNumber(cell.value, 2)}${cell.state === "dry" ? " *" : ""}`;
      });
      const dryOn = chunkIndex === chunks.length - 1 ? [row.dryOnDay === null ? "–" : `Day ${row.dryOnDay}`] : [];
      return [label, standard, ...cells, ...dryOn];
    });
    const first = visits[0] as DryingVisit;
    const last = visits[visits.length - 1] as DryingVisit;
    return {
      caption: chunks.length === 1 ? "Moisture readings by visit" : `Moisture readings, ${visitHeading(log, first)} to ${visitHeading(log, last)}`,
      columns,
      rows: body,
      note: goalNote,
    };
  });
}

function airTable(log: DryingLog): PdfTable | null {
  if (log.visits.length === 0) return null;
  const unit = log.tempUnit;
  const rows = log.visits.map((v) => {
    const gap = gppGap(v.air);
    return [visitLabel(log, v), airCell(v.air.outside, unit), airCell(v.air.unaffected, unit), airCell(v.air.affected, unit), gap === null ? "–" : `${gap > 0 ? "+" : ""}${gap}`, equipmentCell(v)];
  });
  return {
    caption: "Air readings and equipment",
    columns: [
      { title: "Visit", weight: 1.2 },
      { title: "Outside", weight: 1.6 },
      { title: "Unaffected area", weight: 1.6 },
      { title: "Affected area", weight: 1.6 },
      { title: "GPP gap", weight: 0.8, align: "center" },
      { title: "Equipment", weight: 1.5 },
    ],
    rows,
    note: "GPP is grains of moisture per pound of dry air, worked out from the temperature and relative humidity read. GPP gap is the affected area minus the unaffected area: the moisture still to be taken out of the air.",
  };
}

function visitsTable(log: DryingLog): PdfTable | null {
  if (log.visits.length === 0) return null;
  const any = log.visits.some((v) => v.by.trim() || v.meter.trim() || v.notes.trim());
  if (!any) return null;
  return {
    caption: "Who, with what, and notes",
    columns: [
      { title: "Visit", weight: 1.2 },
      { title: "Readings by", weight: 1.3 },
      { title: "Meter", weight: 1.5 },
      { title: "Notes", weight: 3.2 },
    ],
    rows: log.visits.map((v) => [visitLabel(log, v), v.by.trim() || "–", v.meter.trim() || "–", v.notes.trim() || "–"]),
  };
}

export function dryingLogTables(log: DryingLog, map: MoistureMap): PdfTable[] {
  return [airTable(log), ...matrixTables(log, map), visitsTable(log)].filter((t): t is PdfTable => t !== null);
}

export interface DryingLogDocumentContext {
  jobNumber: string;
  customerName: string;
  letterhead?: Letterhead;
  jobInformation?: JobInfoGroup[];
}

/** Everything the PDF renderer needs, for download or for an email attachment. */
export function dryingLogPdfParams(log: DryingLog, map: MoistureMap, ctx: DryingLogDocumentContext): DocumentPdfParams {
  return {
    docLabel: "Drying Log",
    bodyText: dryingLogBodyLines(log, map).join("\n"),
    tables: dryingLogTables(log, map),
    jobNumber: ctx.jobNumber,
    customerName: ctx.customerName,
    letterhead: ctx.letterhead,
    jobInformation: ctx.jobInformation,
  };
}

/** Whether the log has a first visit to print: a log with nothing in it is not a document. */
export function canPrintDryingLog(log: DryingLog): boolean {
  return log.visits.length > 0;
}
