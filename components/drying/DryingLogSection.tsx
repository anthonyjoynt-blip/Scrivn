"use client";

import { useMemo } from "react";
import "./drying-log.css";
import { DryingLogPanel } from "./DryingLogPanel";
import { logStatus, type DryingLog } from "@/lib/dryingLog";
import { dryingLogPdfParams } from "@/lib/dryingLogPdf";
import { claimEquipment, DEFAULT_EQUIPMENT_SETTINGS } from "@/lib/equipment";
import type { JobInfoGroup } from "@/lib/jobInformation";
import type { Letterhead } from "@/lib/letterhead";
import type { MoistureMap } from "@/lib/moisture";
import { downloadDocumentPdf } from "@/lib/pdf";
import type { Sketch } from "@/lib/sketch";

/**
 * The drying log's door on the claim page: a button beside the sketch's, and the panel when it is open
 * (2026-10-13).
 *
 * Outside the claim's steps, for the sketch's reason: a log is an optional record kept for days, not a
 * stage the claim passes through, so it neither advances the step nor waits for one. It works on a claim
 * at any stage, including one whose documents were generated on day one and which is now being read
 * again on day three.
 *
 * The page hands this the state and one setter each; everything about the log itself is in
 * `lib/dryingLog.ts`, and everything about printing it in `lib/dryingLogPdf.ts`. This file only joins them.
 */
export function DryingLogSection({
  log,
  onChange,
  open,
  onOpenChange,
  sketch,
  moisture,
  onMoistureChange,
  defaultBy,
  jobNumber,
  customerName,
  jobInformation,
  letterhead,
  onCheckpoint,
}: {
  log: DryingLog;
  onChange: (next: DryingLog) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sketch: Sketch;
  moisture: MoistureMap;
  onMoistureChange: (next: MoistureMap) => void;
  defaultBy: string;
  jobNumber: string;
  customerName: string;
  jobInformation: JobInfoGroup[];
  letterhead: Letterhead;
  /** A write now, rather than after the debounce: closing the log ends a stretch of typing in the field. */
  onCheckpoint: () => void;
}) {
  const status = useMemo(() => logStatus(log, moisture), [log, moisture]);

  // What the drying plan calls for, from the same engine as everywhere else, to start Day 1's equipment from.
  const equipment = useMemo(() => {
    const result = claimEquipment(sketch, moisture, DEFAULT_EQUIPMENT_SETTINGS);
    if (result.rooms.length === 0) return null;
    return { airMovers: result.totalAirMovers, dehumidifiers: result.totalDehumidifiers.units };
  }, [sketch, moisture]);

  if (!open) {
    return (
      <div className="dlog-launch">
        <button type="button" className="btn-secondary" onClick={() => onOpenChange(true)}>
          Drying log
        </button>
        {log.visits.length > 0 ? (
          <span className={`dlog-launch-status${status.complete ? " complete" : ""}`}>
            {status.complete
              ? `Complete: all ${status.activePoints} points at goal`
              : `${status.day === null ? "Latest visit" : `Day ${status.day}`} · ${status.atGoal} of ${status.activePoints} points at goal`}
          </span>
        ) : (
          <span className="field-note">Optional — record each visit&rsquo;s readings until everything is dry.</span>
        )}
      </div>
    );
  }

  return (
    <DryingLogPanel
      log={log}
      onChange={onChange}
      sketch={sketch}
      moisture={moisture}
      onMoistureChange={onMoistureChange}
      defaultBy={defaultBy}
      equipment={equipment}
      onDownload={() => downloadDocumentPdf(dryingLogPdfParams(log, moisture, { jobNumber, customerName, letterhead, jobInformation }))}
      onClose={() => {
        onOpenChange(false);
        onCheckpoint();
      }}
    />
  );
}
