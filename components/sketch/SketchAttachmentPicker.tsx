"use client";

import {
  type AttachmentTarget,
  type SketchAttachments,
  type SketchRender,
  attachmentsFor,
  sketchRenderDescription,
  sketchRenderLabel,
  toggleAttachment,
} from "@/lib/sketchAttachments";
import type { SurfaceThumbnail } from "@/lib/surfaceThumbnails";
import type { Trade } from "@/lib/workOrders";

/**
 * Which plans ride along with which documents.
 *
 * Presented as toggles rather than a wizard step: the defaults are right most of the time, and the
 * PM's interest is in the exception — the work order that does want the moisture map, or the report
 * that does not. Anything ticked here appears as a full page at the back of that document's PDF,
 * both on download and on the emailed copy.
 *
 * Renders nothing when there is no sketch. There is no useful empty state for a picker whose whole
 * subject does not exist yet, and an always-present panel offering nothing reads as broken.
 */
export function SketchAttachmentPicker({
  available,
  selection,
  thumbnails,
  workOrderTrades,
  workOrderLabels,
  onChange,
}: {
  /** Which renders can actually be produced — see `availableRenders`. */
  available: SketchRender[];
  selection: SketchAttachments;
  /** Names the per-surface renders; the two whole-plan ones name themselves. */
  thumbnails: SurfaceThumbnail[];
  workOrderTrades: Trade[];
  workOrderLabels: Record<Trade, string>;
  onChange: (next: SketchAttachments) => void;
}) {
  if (available.length === 0) return null;

  const targets: { target: AttachmentTarget; label: string }[] = [
    { target: { kind: "inspectionReport" }, label: "Inspection report" },
    { target: { kind: "scopeDocument" }, label: "Scope document" },
    ...workOrderTrades.map((trade) => ({
      target: { kind: "workOrder" as const, trade },
      label: `Work order — ${workOrderLabels[trade]}`,
    })),
  ];

  return (
    <div className="card">
      <div className="question">
        <h2>Attach the sketch</h2>
        <p className="field-note">
          Each plan you tick is added as its own page at the back of that document, on the PDF you download and the one you
          email.
          {available.length === 1 && " Mark up a moisture map to attach that too."}
        </p>
      </div>

      <div className="attachment-grid">
        {targets.map(({ target, label }) => {
          const chosen = attachmentsFor(selection, target);
          return (
            <div className="attachment-row" key={label}>
              <span className="attachment-doc">{label}</span>
              <div className="option-group" role="group" aria-label={`Plans to attach to the ${label}`}>
                {available.map((render) => (
                  <button
                    key={render}
                    type="button"
                    className={`option-btn${chosen.includes(render) ? " selected" : ""}`}
                    aria-pressed={chosen.includes(render)}
                    title={sketchRenderDescription(render, thumbnails)}
                    onClick={() => onChange(toggleAttachment(selection, target, render))}
                  >
                    {sketchRenderLabel(render, thumbnails)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/**
 * The same choice, for one document, sitting with that document.
 *
 * The grouped picker above put every document's attachments in one panel below the documents
 * themselves, which meant scrolling past the thing you were deciding about to find the decision.
 * This goes in the document's own header, where "does this one carry the plan?" is answered while
 * looking at it.
 */
export function SketchAttachmentToggle({
  available,
  selection,
  thumbnails,
  target,
  onChange,
}: {
  available: SketchRender[];
  selection: SketchAttachments;
  thumbnails: SurfaceThumbnail[];
  target: AttachmentTarget;
  onChange: (next: SketchAttachments) => void;
}) {
  if (available.length === 0) return null;
  const chosen = attachmentsFor(selection, target);

  return (
    <div className="attachment-inline">
      <span className="attachment-inline-label">Attach</span>
      <div className="option-group" role="group" aria-label="Plans to attach to this document">
        {available.map((render) => (
          <button
            key={render}
            type="button"
            className={`option-btn${chosen.includes(render) ? " selected" : ""}`}
            aria-pressed={chosen.includes(render)}
            title={sketchRenderDescription(render, thumbnails)}
            onClick={() => onChange(toggleAttachment(selection, target, render))}
          >
            {sketchRenderLabel(render, thumbnails)}
          </button>
        ))}
      </div>
    </div>
  );
}
