import { mountPlan } from "./planStage";
import { PIXELS_PER_FOOT, type Sketch, freeWallsOnLevel, roomBounds, roomsOnLevel } from "@/lib/sketch";
import { JPEG_FOOT, JPEG_HEAD, JPEG_PAD } from "@/lib/scanEditor";
import { type PlanHost, type PlanPicture, storeyExtentFt } from "@/lib/scanEditorPdf";

/**
 * The plan's pictures for lib/scanEditorPdf.ts's buildPlanFiles, drawn by the real sketch canvas (mountPlan) at an exact
 * scale. Shared by Scan's own editor page (lib/scanEditorWebView.tsx) and the drop-a-sketch page (2026-11-05), so the PDF
 * and JPG either one makes are the same drawing.
 */

/** One storey of [sketch], for a picture of it. */
export function storeyOf(sketch: Sketch, level: number): Sketch {
  return { ...sketch, rooms: roomsOnLevel(sketch, level), freeWalls: freeWallsOnLevel(sketch, level) };
}

function boundsOf(sketch: Sketch): { minX: number; minY: number } {
  let minX = Infinity;
  let minY = Infinity;
  for (const room of sketch.rooms) {
    const b = roomBounds(room);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
  }
  for (const wall of sketch.freeWalls ?? []) for (const v of wall.vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
  }
  return { minX, minY };
}

export function planHost(sketch: Sketch): PlanHost {
  const picture = async (level: number, unitsPerFoot: number, pad: number, ratio: number, mime: "image/png" | "image/jpeg") => {
    const extent = storeyExtentFt(sketch, level);
    if (!extent) return null;
    const scoped = storeyOf(sketch, level);
    const { minX, minY } = boundsOf(scoped);
    const scale = unitsPerFoot / PIXELS_PER_FOOT;
    const frame = {
      width: Math.ceil(extent.widthFt * unitsPerFoot + 2 * pad),
      height: Math.ceil(extent.heightFt * unitsPerFoot + 2 * pad),
      view: { x: -minX * scale + pad, y: -minY * scale + pad, scale },
    };
    return mountPlan(scoped, frame, {}, (stage) => ({ canvas: stage.toCanvas({ pixelRatio: ratio }), mime, frame }));
  };
  return {
    async plan(level, unitsPerFoot, pad, ratio): Promise<PlanPicture | null> {
      const got = await picture(level, unitsPerFoot, pad, ratio, "image/png");
      if (!got) return null;
      return { dataUrl: got.canvas.toDataURL("image/png"), width: got.canvas.width, height: got.canvas.height };
    },
    async jpeg(level, pxPerFoot, heading): Promise<PlanPicture | null> {
      // Drawn as the editor draws it, a foot to PIXELS_PER_FOOT, then enlarged to [pxPerFoot]: the canvas writes its labels
      // at one size whatever the zoom, so drawn straight at 48 px a foot they came out a tenth of a room wide. The plan's
      // scale is exact either way (view scale times pixel ratio).
      const k = pxPerFoot / PIXELS_PER_FOOT;
      const got = await picture(level, PIXELS_PER_FOOT, JPEG_PAD / k, k, "image/jpeg");
      if (!got) return null;
      const plan = got.canvas;
      const out = document.createElement("canvas");
      out.width = plan.width;
      out.height = plan.height + JPEG_HEAD + JPEG_FOOT;
      const ctx = out.getContext("2d");
      if (!ctx) return null;
      // JPEG has no alpha: white, or the plan is navy on black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.fillStyle = "#1b3a5c";
      ctx.font = "bold 44px Roboto, Arial, sans-serif";
      ctx.fillText(heading, JPEG_PAD, 90);
      ctx.drawImage(plan, 0, JPEG_HEAD);
      drawBar(ctx, JPEG_PAD, JPEG_HEAD + plan.height + 50, pxPerFoot, `${pxPerFoot} px = 1 ft`);
      return { dataUrl: out.toDataURL("image/jpeg", 0.94), width: out.width, height: out.height };
    },
  };
}

/** A bar 10 ft long at [pxPerFt], solid and open every 2 ft (PlanPdf.kt's drawScaleBar), what an underlay is set to scale by. */
function drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, pxPerFt: number, note: string) {
  const h = 14;
  ctx.fillStyle = "#1b3a5c";
  ctx.strokeStyle = "#1b3a5c";
  ctx.lineWidth = 3;
  for (let k = 0; k < 5; k++) if (k % 2 === 0) ctx.fillRect(x + k * 2 * pxPerFt, y, 2 * pxPerFt, h);
  ctx.strokeRect(x, y, 10 * pxPerFt, h);
  ctx.font = "26px Roboto, Arial, sans-serif";
  ctx.fillStyle = "#1a2430";
  ctx.textAlign = "center";
  ctx.fillText("0", x, y + h + 30);
  ctx.fillText("5", x + 5 * pxPerFt, y + h + 30);
  ctx.fillText("10 ft", x + 10 * pxPerFt, y + h + 30);
  ctx.textAlign = "left";
  ctx.fillText(note, x, y - 12);
}
