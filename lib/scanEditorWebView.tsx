import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { mountPlan } from "@/components/sketch/planStage";
import { PIXELS_PER_FOOT, type Sketch, emptySketch, freeWallsOnLevel, roomBounds, roomsOnLevel } from "./sketch";
import { type MoistureMap, emptyMoistureMap } from "./moisture";
import { EDITOR_VERSION, importCapture, phonePhotoLinks, readSketch, sketchSummary } from "./scanEditor";
import { JPEG_FOOT, JPEG_HEAD, JPEG_PAD } from "./scanEditor";
import { type PlanHost, type PlanPicture, buildPlanFiles, storeyExtentFt } from "./scanEditorPdf";

/**
 * Scrivn's sketch editor as Scrivn Scan's own (2026-10-28): the page scripts/build-scan-editor.mjs bundles into Scan's
 * assets/scrivn-editor/, shown full screen in the app's WebView (SketchEditorActivity.kt). Never part of scrivn.ca: nothing
 * in the app imports it.
 *
 * The contract with the phone is ARCapturePrototype's scan-editor/BRIDGE.md, `scan-editor/1`:
 *   phone -> page  window.ScrivnEditor: version, back(), flush(), render(id, meta), rename(name)
 *   page -> phone  window.ScanEditor:   input(), ready(version), changed(seq, json), done(seq, json), action(name),
 *                                       put(id, piece), finished(id, error), log(line)
 *
 * The sketch is the phone's: saved on the phone, never sent anywhere from here. The page has no network (its CSP says
 * connect-src 'none', and the phone answers anything but its three files and the project's walk photos,
 * photos/<n>.jpg, with a 403).
 */

interface PhoneBridge {
  input(): string;
  ready(version: string): void;
  changed(seq: number, json: string): void;
  done(seq: number, json: string): void;
  action(name: string): void;
  put(id: string, piece: string): void;
  finished(id: string, error: string): void;
  log(line: string): void;
}

interface EditorInput {
  format: string;
  project: { id: string; name: string; origin: "scan" | "hand" };
  sketch: unknown;
  capture: string | null;
  captureId: string | null;
  capturedAt: string | null;
  moisture: unknown;
  knownRoomNames: string[];
  app: { versionName: string; versionCode: number };
  notice: string | null;
  /** The walk's photos kept on the phone, by number (2026-10-29), each at photos/<n>.jpg. Absent from an older app. */
  photos?: number[];
}

/** The page's pieces across the bridge (ExteriorEngine's PIECE): no single call should carry megabytes. */
const PIECE = 256 * 1024;
/** A save goes this long after the last change: a drag is many changes, and one save. */
const SAVE_AFTER_MS = 400;

/** Names offered for a room, after the ones the phone knows (the last claim's). */
const ROOM_NAMES = ["Kitchen", "Living room", "Family room", "Dining room", "Bedroom", "Primary bedroom", "Bathroom", "Ensuite", "Hallway",
  "Closet", "Laundry", "Office", "Rec room", "Basement", "Utility room", "Storage", "Entry", "Garage", "Stairs"];

function phone(): PhoneBridge {
  const b = (globalThis as unknown as { ScanEditor?: PhoneBridge }).ScanEditor;
  if (!b) throw new Error("Scan's bridge is not in the page.");
  return b;
}

function log(line: string) {
  try {
    phone().log(line);
  } catch {
    // No phone: nothing to tell.
  }
}

/** What the phone gave, read: a saved sketch, a scan made into one, or a new empty one for a sketch drawn by hand. */
function start(input: EditorInput): { sketch: Sketch; moisture: MoistureMap; notice: string | null; fresh: boolean } {
  const moisture = input.moisture && typeof input.moisture === "object" ? (input.moisture as MoistureMap) : emptyMoistureMap();
  if (input.sketch != null) {
    const read = readSketch(input.sketch);
    if (read.ok) return { sketch: read.sketch, moisture, notice: input.notice, fresh: false };
    log(`saved sketch not readable: ${read.error}`);
  }
  if (input.capture) {
    const made = importCapture(input.capture, { captureId: input.captureId, capturedAt: input.capturedAt, now: new Date().toISOString() });
    if (made.ok) {
      const notes = made.imported.notes.filter((n) => n.trim() !== "");
      return { sketch: made.imported.sketch, moisture: made.imported.moisture, notice: notes.length > 0 ? notes.join(" ") : null, fresh: true };
    }
    return { sketch: emptySketch(), moisture, notice: `The scan could not be drawn: ${made.error}`, fresh: true };
  }
  return { sketch: emptySketch(), moisture, notice: null, fresh: true };
}

/** One storey of [sketch], for a picture of it. */
function storeyOf(sketch: Sketch, level: number): Sketch {
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

/** The plan's pictures, drawn by the real canvas ([mountPlan]) at an exact scale. */
function planHost(sketch: Sketch): PlanHost {
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

/** The bridge's other half, `window.ScrivnEditor`, wired to the mounted editor. */
interface Controls {
  back(): string;
  flush(): void;
  render(id: string, metaJson: string): void;
  rename(name: string): void;
}

const controls: { current: Controls | null } = { current: null };

(globalThis as unknown as { ScrivnEditor: Controls & { version: string } }).ScrivnEditor = {
  version: EDITOR_VERSION,
  back: () => controls.current?.back() ?? "close",
  flush: () => controls.current?.flush(),
  render: (id, meta) => controls.current?.render(id, meta),
  rename: (name) => controls.current?.rename(name),
};

function Host({ input }: { input: EditorInput }) {
  const [first] = useState(() => start(input));
  const [sketch, setSketch] = useState<Sketch>(first.sketch);
  const [moisture, setMoisture] = useState<MoistureMap>(first.moisture);
  const [title, setTitle] = useState(input.project.name);
  // The walk-through's photos, on the phone: the 3D view's, read once (a walk is the scan's, and no edit changes it).
  const [photos] = useState(() => phonePhotoLinks(input.photos, first.sketch));
  const [notice, setNotice] = useState<string | null>(first.notice);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const latest = useRef({ sketch, moisture });
  latest.current = { sketch, moisture };
  /** Once edited, always edited: the phone holds the sketch as the truth from then on (BRIDGE.md). */
  const edited = useRef(false);
  const initial = useRef(first.sketch);
  const closed = useRef(false);

  const payload = useCallback(() => {
    const { sketch: s, moisture: m } = latest.current;
    const summary = sketchSummary(s);
    // A scan: edited once it is no longer what the import made. A sketch by hand: once anything changed.
    const now = s.scan !== undefined ? summary.edited : s !== initial.current;
    edited.current = edited.current || now;
    return JSON.stringify({ sketch: s, moisture: m, summary: { rooms: summary.rooms, levels: summary.levels, floorSqFt: summary.floorSqFt }, edited: edited.current });
  }, []);

  const send = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    seq.current += 1;
    phone().changed(seq.current, payload());
  }, [payload]);

  const finish = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    seq.current += 1;
    phone().done(seq.current, payload());
  }, [payload]);

  // Saved: the import (or the empty sketch) once at once, then 400 ms after every change.
  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      if (first.fresh) send();
      phone().ready(EDITOR_VERSION);
      return;
    }
    if (closed.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(send, SAVE_AFTER_MS);
  }, [sketch, moisture, first.fresh, send]);

  useEffect(() => {
    controls.current = {
      back() {
        // A length being typed: its Cancel.
        const popup = document.querySelector(".sketch-length-popup .sketch-length-actions .btn-secondary") as HTMLButtonElement | null;
        if (popup) {
          popup.click();
          return "handled";
        }
        // A sheet, a wall being drawn: the editor's own Escape, which says when it did something.
        const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        window.dispatchEvent(escape);
        if (escape.defaultPrevented) return "handled";
        finish();
        return "close";
      },
      flush() {
        if (timer.current !== null) send();
      },
      render(id, metaJson) {
        void (async () => {
          try {
            const meta = JSON.parse(metaJson) as { title?: string; subtitle?: string; jpg?: boolean };
            const s = latest.current.sketch;
            const files = await buildPlanFiles(s, { title: meta.title || title || "Floor plan", subtitle: meta.subtitle ?? "", jpg: meta.jpg !== false }, planHost(s));
            const text = JSON.stringify(files);
            for (let k = 0; k < text.length; k += PIECE) phone().put(id, text.slice(k, k + PIECE));
            phone().finished(id, "");
          } catch (e) {
            log(`render failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
            phone().finished(id, e instanceof Error ? e.message : String(e));
          }
        })();
      },
      rename(name) {
        if (name.trim() !== "") setTitle(name.trim());
      },
    };
    return () => {
      controls.current = null;
    };
  }, [finish, send, title]);

  const actions = (
    <>
      <button type="button" className="btn-secondary scan-editor-share" onClick={() => phone().action("share")}>
        Share
      </button>
      <button type="button" className="btn-secondary scan-editor-menu" aria-label="More" onClick={() => phone().action("menu")}>
        ⋯
      </button>
    </>
  );
  return createElement(SketchEditor, {
    sketch,
    knownRoomNames: [...new Set([...(input.knownRoomNames ?? []), ...ROOM_NAMES])],
    moisture,
    onChange: setSketch,
    onMoistureChange: setMoisture,
    onClose: finish,
    notice: notice ? (
      <div className="sketch-undo scan-editor-notice" role="status">
        <span>{notice}</span>
        <button type="button" className="btn-secondary" onClick={() => setNotice(null)}>
          OK
        </button>
      </div>
    ) : undefined,
    standalone: { title, actions, photos },
  });
}

function boot() {
  // A phone's screen is 3x: the plan drawn at 2x is as sharp to the eye and a third the work while dragging.
  Konva.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const host = document.getElementById("app");
  if (!host) return;
  let input: EditorInput;
  try {
    input = JSON.parse(phone().input()) as EditorInput;
  } catch (e) {
    host.textContent = `The editor could not start: ${e instanceof Error ? e.message : String(e)}`;
    log(`no input: ${String(e)}`);
    return;
  }
  log(`${EDITOR_VERSION}: ${input.project.origin} ${input.project.id}, ${input.sketch != null ? "a saved sketch" : input.capture ? "a scan to import" : "nothing (by hand)"}`);
  createRoot(host).render(createElement(Host, { input }));
}

window.addEventListener("error", (e) => log(`error: ${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener("unhandledrejection", (e) => log(`unhandled: ${String(e.reason)}`));
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
