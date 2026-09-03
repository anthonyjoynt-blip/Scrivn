import type { Trade } from "./workOrders";
import { type SurfaceThumbnail, thumbnailFor } from "./surfaceThumbnails";
import { levelLabel } from "./sketch";

/**
 * Which rendering of the sketch goes on which document.
 *
 * The sketch is drawn once and renders two ways — geometry alone, or the same geometry with the
 * moisture layer over it (see `lib/moisture.ts`). Both are attachable, independently, because they
 * answer different questions: a scope reader wants the room, an adjuster arguing about drying wants
 * the damage. Forcing one to stand for both would mean the clean plan carried mark-up nobody asked
 * for, or the moisture map was unavailable where it is the whole point.
 *
 * This is a selection, not a derivation: the defaults below are a sensible starting point and the PM
 * can change any of them. Nothing here inspects the claim to decide what "should" be attached.
 */

/**
 * Two whole-plan renders, plus one per surface getting drywall work — see `surfaceThumbnails.ts`.
 *
 * The surface ids are open rather than enumerated because they are derived from the claim: a room
 * named on a plan the PM just drew cannot be a member of a union written here. That is why the two
 * label lookups below are functions and not `Record`s.
 */
export type SketchRender = "clean" | "moisture" | (string & {});

const WHOLE_PLAN_LABEL: Record<string, string> = {
  clean: "Sketch",
  moisture: "Moisture map",
};

const WHOLE_PLAN_DESCRIPTION: Record<string, string> = {
  clean: "The plan as drawn — rooms, doors, windows and cabinetry.",
  moisture: "The same plan with affected walls, floor and ceiling marked.",
};

/**
 * A render id, split into what it draws and which storey — `clean:1` is the plan of the level above.
 * A bare `clean` means every level there is, which on a single-storey claim is the only one.
 */
export function parseRender(render: SketchRender): { base: string; level: number | null } {
  const [base, level] = render.split(":");
  if (base === undefined) return { base: render, level: null };
  const parsed = level === undefined ? null : Number(level);
  return { base, level: parsed !== null && Number.isFinite(parsed) ? parsed : null };
}

/** `thumbnails` supplies the names for per-surface renders; the two whole-plan ones are fixed. */
export function sketchRenderLabel(render: SketchRender, thumbnails: SurfaceThumbnail[] = []): string {
  const direct = WHOLE_PLAN_LABEL[render];
  if (direct) return direct;
  const { base, level } = parseRender(render);
  const wholePlan = WHOLE_PLAN_LABEL[base];
  if (wholePlan && level !== null) return `${wholePlan} — ${levelLabel(level)}`;
  return thumbnailFor(thumbnails, render)?.label ?? render;
}

export function sketchRenderDescription(render: SketchRender, thumbnails: SurfaceThumbnail[] = []): string {
  const whole = WHOLE_PLAN_DESCRIPTION[render] ?? WHOLE_PLAN_DESCRIPTION[parseRender(render).base];
  if (whole) return whole;
  const thumbnail = thumbnailFor(thumbnails, render);
  if (!thumbnail) return "";
  return thumbnail.surface === "ceiling"
    ? "The plan with this room's ceiling shaded."
    : "The plan with these walls picked out.";
}

export interface SketchAttachments {
  inspectionReport: SketchRender[];
  scopeDocument: SketchRender[];
  /** Per trade, since a work order's audience is narrower than a document's. */
  workOrders: Partial<Record<Trade, SketchRender[]>>;
}

/**
 * What gets attached unless the PM says otherwise.
 *
 * Both renders go on the inspection report and the scope document: those are the two the carrier
 * reads, and between them they carry the whole story of the loss.
 *
 * Work orders default to almost nothing, because a work order is a page a crew works from and every
 * sheet that is not instructions competes with the ones that are. Mitigation is the exception — it
 * is the trade that places the equipment and cuts to the wet line, so the moisture map is not
 * reference material for them, it is the job. The clean plan is not included there: they are
 * standing in the building.
 */
export function defaultSketchAttachments(): SketchAttachments {
  return {
    inspectionReport: ["clean", "moisture"],
    scopeDocument: ["clean", "moisture"],
    workOrders: { MITIGATION_DEMO: ["moisture"] },
  };
}

export type AttachmentTarget = { kind: "inspectionReport" } | { kind: "scopeDocument" } | { kind: "workOrder"; trade: Trade };

export function attachmentsFor(selection: SketchAttachments, target: AttachmentTarget): SketchRender[] {
  switch (target.kind) {
    case "inspectionReport":
      return selection.inspectionReport;
    case "scopeDocument":
      return selection.scopeDocument;
    case "workOrder":
      return selection.workOrders[target.trade] ?? [];
  }
}

export function toggleAttachment(
  selection: SketchAttachments,
  target: AttachmentTarget,
  render: SketchRender,
): SketchAttachments {
  const current = attachmentsFor(selection, target);
  const next = current.includes(render) ? current.filter((r) => r !== render) : [...current, render];

  switch (target.kind) {
    case "inspectionReport":
      return { ...selection, inspectionReport: next };
    case "scopeDocument":
      return { ...selection, scopeDocument: next };
    case "workOrder":
      return { ...selection, workOrders: { ...selection.workOrders, [target.trade]: next } };
  }
}

/**
 * A render is only offerable if there is something to render.
 *
 * A claim with no sketch has neither; a sketch with no moisture data has the clean plan only. This
 * keeps the selection honest rather than letting a PM tick a box that produces a blank page.
 */
export function availableRenders(
  hasSketch: boolean,
  hasMoisture: boolean,
  thumbnails: SurfaceThumbnail[] = [],
  levels: number[] = [],
): SketchRender[] {
  if (!hasSketch) return [];
  const base: ("clean" | "moisture")[] = hasMoisture ? ["clean", "moisture"] : ["clean"];
  /*
    One image per storey once there is more than one.

    Levels share a coordinate space — that is what makes the tracing underlay work — so a single
    image of "the plan" would print an upper floor on top of the one below it. A claim with one
    level keeps the plain "clean"/"moisture" ids it has always had, so nothing about a single-storey
    claim changes; only a building with storeys grows a render each.
  */
  const whole: SketchRender[] =
    levels.length > 1 ? levels.flatMap((level) => base.map((b) => `${b}:${level}`)) : base;
  // Surface thumbnails are derived from the claim, so they appear and disappear as the scope changes
  // — `pruneAttachments` is what drops a selection whose surface has stopped being worked on.
  return [...whole, ...thumbnails.map((t) => t.id)];
}

/** Drops any selection that can no longer be produced — a moisture map deleted after being ticked. */
export function pruneAttachments(selection: SketchAttachments, available: SketchRender[]): SketchAttachments {
  const keep = (list: SketchRender[]) => list.filter((r) => available.includes(r));
  const workOrders: Partial<Record<Trade, SketchRender[]>> = {};
  for (const [trade, list] of Object.entries(selection.workOrders) as [Trade, SketchRender[]][]) {
    const kept = keep(list);
    if (kept.length > 0) workOrders[trade] = kept;
  }
  return {
    inspectionReport: keep(selection.inspectionReport),
    scopeDocument: keep(selection.scopeDocument),
    workOrders,
  };
}
