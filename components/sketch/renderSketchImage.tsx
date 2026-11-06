"use client";

import type Konva from "konva";
import { PIXELS_PER_FOOT, type Sketch, freeWallsOf, freeWallsOnLevel, roomBounds, roomsOnLevel } from "@/lib/sketch";
import type { MoistureMap } from "@/lib/moisture";
import { mountPlan } from "./planStage";
import { type SketchRender, parseBuildingRender, parseRender } from "@/lib/sketchAttachments";
import { type SurfaceThumbnail, thumbnailFor } from "@/lib/surfaceThumbnails";
import { type ExteriorRender, renderExteriorImage } from "./exteriorImages";

/**
 * Renders a sketch to a PNG, off screen, for attaching to a document.
 *
 * It mounts the REAL `SketchCanvas` into a detached container rather than redrawing the plan with
 * its own code. A second drawing routine would be a copy that drifts: the day a door symbol changes,
 * the sketch on the claim document would quietly stop matching the sketch on the screen, and nobody
 * would notice until an adjuster did. Whatever the editor shows is what gets attached, by
 * construction.
 *
 * The moisture layer is the only difference between the two renders — same geometry, `showMoisture`
 * off or on — which is what makes "the clean sketch still exists" true at the point of export too.
 */

/** Padding around the drawing, in world pixels, so nothing touches the edge of the image. */
const MARGIN = 40;
/** Upscale, so the plan is still crisp when a PDF page is printed. */
const PIXEL_RATIO = 2;
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 1200;

export interface SketchImage {
  render: SketchRender;
  dataUrl: string;
  /** Natural size in CSS pixels, for laying the image out without distorting it. */
  width: number;
  height: number;
}

/**
 * The view that fits every room on one image.
 *
 * Documents are not scrollable, so the export cannot inherit the editor's pan and zoom — whatever
 * the PM happened to be looking at would decide what the carrier sees. This frames the whole sketch
 * instead, at whatever scale makes it fit.
 */
function framing(sketch: Sketch): { width: number; height: number; view: { x: number; y: number; scale: number } } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of sketch.rooms) {
    const b = roomBounds(room);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  // Free walls are part of the picture too — a partition drawn past a room's edge would be cut off.
  for (const wall of freeWallsOf(sketch)) {
    for (const v of wall.vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  const worldWidth = maxX - minX + MARGIN * 2;
  const worldHeight = maxY - minY + MARGIN * 2;
  const scale = Math.min(1, MAX_WIDTH / worldWidth, MAX_HEIGHT / worldHeight);

  return {
    width: Math.ceil(worldWidth * scale),
    height: Math.ceil(worldHeight * scale),
    view: { x: (-minX + MARGIN) * scale, y: (-minY + MARGIN) * scale, scale },
  };
}

/**
 * Mounts the real canvas off screen, hands the painted stage to `use`, and cleans up after it.
 *
 * Extracted so the PDF's PNG and the estimator's JPEG come off the same mount rather than two
 * near-identical copies of the mounting dance — the whole point of rendering through the real
 * component is that there is exactly one drawing routine, and two mounts would be one and a half.
 */
async function withStage<T>(
  sketch: Sketch,
  moisture: MoistureMap,
  render: SketchRender,
  use: (stage: Konva.Stage, frame: NonNullable<ReturnType<typeof framing>>) => T,
  thumbnails: SurfaceThumbnail[] = [],
): Promise<T | null> {
  if (typeof document === "undefined") return null;
  /*
    A render draws ONE storey when the id names one — see `availableRenders`. Framing has to see the
    same rooms the canvas will, or the image is centred on a bounding box that includes floors it is
    not drawing, and a single upper room comes out marooned in the corner of a whole-building frame.
  */
  const { base, level } = parseRender(render);
  const scoped: Sketch = level === null ? sketch : { ...sketch, rooms: roomsOnLevel(sketch, level), freeWalls: freeWallsOnLevel(sketch, level) };
  const frame = framing(scoped);
  if (!frame) return null;
  // The mount itself is planStage.tsx's (2026-10-28), shared with Scrivn Scan's plan PDF.
  return mountPlan(scoped, frame, { moisture, showMoisture: base === "moisture", highlight: thumbnailFor(thumbnails, render) ?? null }, use);
}

/** Another building's picture (2026-10-19), by its `buildingRender` id; null for any other render, or a building gone. */
async function buildingImage(sketch: Sketch, render: SketchRender, format: "png" | "jpeg"): Promise<SketchImage | null | undefined> {
  const which = parseBuildingRender(render);
  if (!which) return undefined;
  const building = sketch.buildings?.find((b) => b.id === which.buildingId);
  const image = await renderExteriorImage(building, which.render, format, building?.name?.trim() || "Building");
  return image ? { ...image, render } : null;
}

/** Renders one sketch image. Returns null when there is nothing to draw. */
export async function renderSketchImage(
  sketch: Sketch,
  moisture: MoistureMap,
  render: SketchRender,
  thumbnails: SurfaceThumbnail[] = [],
): Promise<SketchImage | null> {
  // The outside of the house is drawn by its own drawings, not the plan's canvas.
  if (render === "roof" || render === "elevations") return renderExteriorImage(sketch.exterior, render as ExteriorRender);
  const building = await buildingImage(sketch, render, "png");
  if (building !== undefined) return building;
  return withStage(
    sketch,
    moisture,
    render,
    (stage, frame) => ({
      render,
      dataUrl: stage.toDataURL({ pixelRatio: PIXEL_RATIO, mimeType: "image/png" }),
      width: frame.width,
      height: frame.height,
    }),
    thumbnails,
  );
}

/**
 * The plan as a JPEG, for tracing over in Xactimate.
 *
 * Two things separate this from the PNG above, and both come from what the file is FOR.
 *
 * JPEG has no alpha, and a transparent pixel encodes as black — the stage is transparent everywhere
 * outside a room, so a direct `toDataURL("image/jpeg")` would hand the estimator a plan drawn in
 * navy on a black field. Compositing onto white first is not a nicety here, it is the difference
 * between a usable image and an unusable one.
 *
 * And an underlay is calibrated before it is traced: Xactimate asks for two points and the real
 * distance between them. A stamped scale bar makes that a two-click job instead of a hunt for
 * something of known length. It is always drawable because the whole sketch is at one scale — see
 * `PIXELS_PER_FOOT`; there was a period when rooms could disagree and the bar had to be withheld.
 */
export async function renderSketchJpeg(sketch: Sketch, moisture: MoistureMap, render: SketchRender): Promise<SketchImage | null> {
  if (render === "roof" || render === "elevations") return renderExteriorImage(sketch.exterior, render as ExteriorRender, "jpeg");
  const building = await buildingImage(sketch, render, "jpeg");
  if (building !== undefined) return building;
  return withStage(sketch, moisture, render, (stage, frame) => {
    const width = Math.round(frame.width * PIXEL_RATIO);
    const height = Math.round(frame.height * PIXEL_RATIO);

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(stage.toCanvas({ pixelRatio: PIXEL_RATIO }), 0, 0, width, height);

    drawScaleBar(ctx, width, height, PIXELS_PER_FOOT * frame.view.scale * PIXEL_RATIO);

    return { render, dataUrl: out.toDataURL("image/jpeg", JPEG_QUALITY), width: frame.width, height: frame.height };
  });
}

/** JPEG quality. High: this is line art, and JPEG ringing around a thin dark line is what smudges a trace. */
const JPEG_QUALITY = 0.94;

/** Bar lengths worth printing, in feet. The first that lands in the target pixel range is used. */
const SCALE_BAR_FEET = [1, 2, 5, 10, 20, 50, 100];

/**
 * A labelled scale bar in the bottom-left of the exported image.
 *
 * Drawn in image pixels, not world pixels — it annotates the file, so it should be the same size
 * whatever scale the plan came out at.
 */
function drawScaleBar(ctx: CanvasRenderingContext2D, width: number, height: number, pixelsPerFoot: number): void {
  // The LONGEST bar that still fits, not the first that qualifies: calibration is two clicks and a
  // typed distance, and the further apart those two clicks are, the less a pixel of slop costs.
  const feet = SCALE_BAR_FEET.filter((f) => f * pixelsPerFoot >= 90 && f * pixelsPerFoot <= width * 0.3).pop();
  if (feet == null) return;

  const barPx = feet * pixelsPerFoot;
  const x = 24;
  const y = height - 30;

  ctx.save();
  ctx.strokeStyle = "#1b3a5c";
  ctx.fillStyle = "#1b3a5c";
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + barPx, y);
  // End ticks, so the two points to click on are unambiguous — the ends of a plain line are not.
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x, y + 8);
  ctx.moveTo(x + barPx, y - 8);
  ctx.lineTo(x + barPx, y + 8);
  ctx.stroke();

  ctx.font = "600 22px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${feet} ft`, x, y - 14);
  ctx.restore();
}

/**
 * Decodes a base64 data URL to a Blob, for posting as a file.
 *
 * Decoded by hand rather than with `fetch(dataUrl)` — that route works, but it makes a network-stack
 * call for bytes already in memory and is the sort of thing a tightened CSP quietly breaks later.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const mime = /:(.*?);/.exec(dataUrl.slice(0, comma))?.[1] ?? "application/octet-stream";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Hands the browser a file. Same-origin data URL, so no fetch and nothing to revoke. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Renders each requested view, skipping any that produced nothing. */
export async function renderSketchImages(
  sketch: Sketch,
  moisture: MoistureMap,
  renders: SketchRender[],
  thumbnails: SurfaceThumbnail[] = [],
): Promise<SketchImage[]> {
  const out: SketchImage[] = [];
  for (const render of renders) {
    const image = await renderSketchImage(sketch, moisture, render, thumbnails);
    if (image) out.push(image);
  }
  return out;
}
