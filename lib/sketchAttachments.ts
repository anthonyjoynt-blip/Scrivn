import type { Trade } from "./workOrders";
import { type SurfaceThumbnail, thumbnailFor } from "./surfaceThumbnails";
import { levelName, type Sketch } from "./sketch";

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
  roof: "Roof plan",
  elevations: "Elevations",
};

const WHOLE_PLAN_DESCRIPTION: Record<string, string> = {
  clean: "The plan as drawn — rooms, doors, windows and cabinetry.",
  moisture: "The same plan with affected walls, floor and ceiling marked.",
  roof: "The roof to scale, lettered by slope, with the slopes being roofed shaded and the ridge vent marked.",
  elevations: "Every side of the house to scale: cladding, openings, gables and heights.",
};

/**
 * The outside of the house's two pictures (2026-10-12, components/sketch/exteriorImages.tsx). Kept
 * apart from the plans because they come from the exterior, not the rooms, and because the claim's
 * selection starts them ticked the first time there is one to draw (`withExteriorDefaults`).
 */
export const EXTERIOR_RENDERS: SketchRender[] = ["roof", "elevations"];

/**
 * Another building's two pictures (2026-10-19, lib/buildings.ts): `roof@<its id>` and `elevations@<its id>`, named for it
 * ("Shed – roof plan"). The house's keep their plain ids, so a claim with no other building attaches what it always has.
 */
export function buildingRender(render: "roof" | "elevations", buildingId: string): SketchRender {
  return `${render}@${buildingId}`;
}

export function parseBuildingRender(render: SketchRender): { render: "roof" | "elevations"; buildingId: string } | null {
  const m = /^(roof|elevations)@(.+)$/.exec(render);
  return m ? { render: m[1] as "roof" | "elevations", buildingId: m[2] as string } : null;
}

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

/** `thumbnails` supplies the names for per-surface renders, and `sketch` the storeys' and the other buildings'; the whole-plan ones are fixed. */
export function sketchRenderLabel(
  render: SketchRender,
  thumbnails: SurfaceThumbnail[] = [],
  sketch: (Pick<Sketch, "levelNames"> & Partial<Pick<Sketch, "buildings">>) | null = null,
): string {
  const direct = WHOLE_PLAN_LABEL[render];
  if (direct) return direct;
  const building = parseBuildingRender(render);
  if (building) {
    const name = sketch?.buildings?.find((b) => b.id === building.buildingId)?.name?.trim() || "Building";
    return `${name} – ${building.render === "roof" ? "roof plan" : "elevations"}`;
  }
  const { base, level } = parseRender(render);
  const wholePlan = WHOLE_PLAN_LABEL[base];
  if (wholePlan && level !== null) return `${wholePlan} — ${levelName(sketch, level)}`;
  return thumbnailFor(thumbnails, render)?.label ?? render;
}

export function sketchRenderDescription(render: SketchRender, thumbnails: SurfaceThumbnail[] = []): string {
  const building = parseBuildingRender(render);
  if (building) return building.render === "roof" ? (WHOLE_PLAN_DESCRIPTION.roof as string) : "Every side of the building to scale: cladding, openings, gables and heights.";
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
  /**
   * Set once the exterior's pictures have been ticked by default, so a picture the PM then unticks
   * stays unticked rather than coming back with the next drawing. Absent until there is an exterior.
   */
  exteriorDefaulted?: boolean;
  /**
   * True when the estimator has taken the site photos out of the Initial Site Report — to email it
   * under the size limit, most often. Absent means the captioned photos print there (2026-10-14: the
   * Initial Site Report only, by the owner's choice; the other documents never carry photos).
   */
  photosLeftOut?: boolean;
  /** The other buildings' pictures already ticked by default (2026-10-19), by render id: each is ticked once, as the house's are. */
  buildingsDefaulted?: SketchRender[];
}

/**
 * The exterior's pictures ticked the first time there are any to draw: the owner (10-12) wants the
 * roof plan "included in the scope doc", and "everything should make it onto the sketch book and
 * other docs". So both go on the inspection report and the scope document, the roof plan on the
 * Roofing order and both on the Siding order - once. After that the ticks are the PM's. Each other
 * building's pictures the same, once each, the first time it has them (2026-10-19).
 */
export function withExteriorDefaults(selection: SketchAttachments, available: SketchRender[]): SketchAttachments {
  const add = (list: SketchRender[] | undefined, renders: SketchRender[]) => [...(list ?? []), ...renders.filter((r) => !(list ?? []).includes(r))];
  const tick = (s: SketchAttachments, renders: SketchRender[]): SketchAttachments => ({
    ...s,
    inspectionReport: add(s.inspectionReport, renders),
    scopeDocument: add(s.scopeDocument, renders),
    workOrders: {
      ...s.workOrders,
      ROOFING: add(s.workOrders.ROOFING, renders.filter((r) => r === "roof" || parseBuildingRender(r)?.render === "roof")),
      SIDING: add(s.workOrders.SIDING, renders),
    },
  });
  let next = selection;
  const exterior = EXTERIOR_RENDERS.filter((r) => available.includes(r));
  if (!selection.exteriorDefaulted && exterior.length > 0) next = { ...tick(next, exterior), exteriorDefaulted: true };
  const done = selection.buildingsDefaulted ?? [];
  const fresh = available.filter((r) => parseBuildingRender(r) && !done.includes(r));
  if (fresh.length > 0) next = { ...tick(next, fresh), buildingsDefaulted: [...done, ...fresh] };
  return next;
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
  exterior: SketchRender[] = [],
): SketchRender[] {
  // The exterior's pictures, whatever the rooms: a hail claim can have an outside and no inside.
  if (!hasSketch) return [...exterior];
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
  return [...whole, ...thumbnails.map((t) => t.id), ...exterior];
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
    ...(selection.exteriorDefaulted ? { exteriorDefaulted: true } : {}),
    ...(selection.photosLeftOut ? { photosLeftOut: true } : {}),
    ...(selection.buildingsDefaulted ? { buildingsDefaulted: selection.buildingsDefaulted } : {}),
  };
}
