import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import SketchCanvas, { type SketchCanvasProps } from "./SketchCanvas";
import { type Sketch, freeWallsOf } from "@/lib/sketch";
import { type MoistureMap, emptyMoistureMap } from "@/lib/moisture";

/**
 * The plan drawn off screen by the REAL `SketchCanvas`, for a picture of it (renderSketchImage.tsx's documents, and Scrivn
 * Scan's to-scale plan PDF, lib/scanEditorPdf.ts).
 *
 * Moved out of renderSketchImage.tsx on 2026-10-28, unchanged, so the phone app's editor can draw its plan without that
 * file's exterior drawings. There is still exactly one mount: a second drawing routine would be a copy that drifts.
 */

/** Where the plan sits on the picture: its size in CSS pixels, and the view (world pixels to picture pixels). */
export interface PlanFrame {
  width: number;
  height: number;
  view: { x: number; y: number; scale: number };
}

const noop = () => {};

/**
 * Mounts the real canvas off screen with [frame], hands the painted stage to `use`, and cleans up after it. [sketch] is the
 * rooms to draw (one storey's, when a picture is of one); null when there is no document to draw into.
 */
export async function mountPlan<T>(
  sketch: Sketch,
  frame: PlanFrame,
  layer: { moisture?: MoistureMap; showMoisture?: boolean; highlight?: SketchCanvasProps["highlight"] },
  use: (stage: Konva.Stage, frame: PlanFrame) => T,
): Promise<T | null> {
  if (typeof document === "undefined") return null;
  // Off screen rather than hidden: `display: none` gives a canvas no size to draw into, and
  // `visibility: hidden` still reserves layout. Positioning it far off the page does neither.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;pointer-events:none;";
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    root.render(
      createElement(SketchCanvas, {
        rooms: sketch.rooms,
        freeWalls: freeWallsOf(sketch),
        width: frame.width,
        height: frame.height,
        view: frame.view,
        tool: "select" as const,
        showSizes: true,
        // A picture, not an editor — see `showGrid`.
        showGrid: false,
        moisture: layer.showMoisture ? layer.moisture ?? emptyMoistureMap() : emptyMoistureMap(),
        showMoisture: layer.showMoisture === true,
        /*
          A surface thumbnail is the same plan with one surface picked out — see
          `lib/surfaceThumbnails.ts`. Null for the two whole-plan renders, which is every render
          that existed before thumbnails.
        */
        highlight: layer.highlight ?? null,
        moistureTool: null,
        paintSurface: "floor" as const,
        selectedReadingId: null,
        // Nothing is selected in an export: handles are for editing, and this is a picture.
        selectedRoomId: null,
        selectedSymbolId: null,
        onViewChange: noop,
        onSelectRoom: noop,
        onSelectSymbol: noop,
        onMoveRoom: noop,
        onTapWall: noop,
        onTapWallForReading: noop,
        onSelectReading: noop,
        onResizeReading: noop,
        onPaintFloor: noop,
        onPlaceSymbol: noop,
        onSplitWall: noop,
        onDragWall: noop,
        onDragWallEnd: noop,
        onRenameRoom: noop,
        onMoveVertex: noop,
        onRemoveVertex: noop,
        onMoveSymbol: noop,
        onResizeSymbol: noop,
        onPlaceIsland: noop,
        onMoveIsland: noop,
        onResizeIsland: noop,
      }),
    );

    // React renders asynchronously and Konva paints on a frame after that.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const stage = Konva.stages.find((s) => host.contains(s.container()));
    if (!stage) return null;

    // Draw synchronously before reading the pixels: batchDraw waits for a frame, and a frame never
    // comes in a background tab.
    stage.draw();
    return use(stage, frame);
  } finally {
    // Unmount on a later tick — React refuses to unmount a root while it is still rendering.
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  }
}
