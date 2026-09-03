"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { type Sketch, type SketchView, clampZoom, defaultView, exposedRunAt, roomBounds } from "@/lib/sketch";
import { type MoistureMap, roomMoisture, setRoomMoisture } from "@/lib/moisture";
import {
  type ScopeMark,
  emptyScopeMark,
  fromCanvasLayer,
  hasScopeMark,
  scopeFloorSquareFeet,
  scopeWallRunFeet,
  toCanvasLayer,
} from "@/lib/scopeMarks";
import type { MoistureTool } from "./SketchCanvas";

const SketchCanvas = dynamic(() => import("./SketchCanvas"), {
  ssr: false,
  loading: () => <div className="sketch-canvas-loading">Loading sketch…</div>,
});

const CANVAS_HEIGHT = 380;

/** What a question is asking for, which decides what the picker lets you mark and in what unit. */
export type ScopeMeasure = "wallRun" | "floorArea";

/**
 * Marking a quantity out on the sketch instead of estimating it.
 *
 * The point is that a PM standing in a room knows exactly which walls are coming out but not how
 * many linear feet that is. The sketch already holds the geometry, so pointing at the walls and
 * reading off the total is both faster and more accurate than the arithmetic it replaces.
 *
 * The marking is kept, not just its total. Reopening shows what was marked last time, so a number
 * can be adjusted rather than re-derived from scratch — and the extent stays available for anything
 * that later wants to show WHERE, not just how much.
 *
 * The geometry is read-only throughout, same as moisture mapping: this is a question about an
 * existing plan, and a picker that let the plan be edited would change the answer to other questions
 * behind the PM's back.
 */
export function ScopeMarkPicker({
  sketch,
  measure,
  title,
  initial,
  onCancel,
  onUse,
}: {
  sketch: Sketch;
  measure: ScopeMeasure;
  /** The question being answered, shown so it is clear what is being marked. */
  title: string;
  initial: ScopeMark;
  onCancel: () => void;
  /** The marking and the value it measures, formatted in the unit the question wants. */
  onUse: (mark: ScopeMark, value: string) => void;
}) {
  const [layer, setLayer] = useState<MoistureMap>(() => toCanvasLayer(initial));
  const [tool, setTool] = useState<MoistureTool>(measure === "wallRun" ? "read" : "paint");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(sketch.rooms[0]?.id ?? null);
  const [selectedReadingId, setSelectedReadingId] = useState<string | null>(null);
  const [view, setView] = useState<SketchView>(defaultView);
  const [width, setWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  /* Frame the whole sketch on open — the picker has no history for the PM to have panned. */
  useEffect(() => {
    if (sketch.rooms.length === 0 || width <= 0) return;
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
    const pad = 30;
    const scale = clampZoom(Math.min((width - pad * 2) / (maxX - minX || 1), (CANVAS_HEIGHT - pad * 2) / (maxY - minY || 1)));
    setView({ scale, x: pad - minX * scale, y: pad - minY * scale });
  }, [sketch, width]);

  const mark = useMemo(() => fromCanvasLayer(layer), [layer]);
  const runFeet = scopeWallRunFeet(mark, sketch);
  const areaSquareFeet = scopeFloorSquareFeet(mark, sketch);
  const value = measure === "wallRun" ? runFeet : areaSquareFeet;
  const unit = measure === "wallRun" ? "LF" : "SF";
  const rounded = Math.round(value * 10) / 10;

  /**
   * Tapping a wall toggles it in or out of the marking — one mark per wall, whole wall to start.
   *
   * The decision is made out here, never inside the updater below. A state updater runs while React
   * renders the component that owns that state, so setting other state from within one is a setState
   * during a render — see `test/sketch/stateRules.mjs`, which exists because this shipped once.
   */
  /**
   * `t` is where along the wall the tap landed, and it decides which STRETCH gets marked.
   *
   * This used to mark [0, 1] — the whole wall — whichever part of it was tapped. On a wall a closet
   * is built against, that silently claimed the closet's share too: tapping the exposed part of a
   * bedroom's back wall returned the full 12' rather than the 8' actually selected, and the number
   * went straight into a scope quantity. The moisture editor has always clipped to the tapped run;
   * this path simply never did, so the same gesture measured two different things depending on which
   * screen the PM was on.
   *
   * Where nothing is nested `exposedRunAt` returns [0, 1] and the behaviour is unchanged.
   */
  function handleTapWall(roomId: string, wallId: string, t: number) {
    const already = roomMoisture(layer, roomId).wallReadings.some((r) => r.wallId === wallId);
    setSelectedRoomId(roomId);
    setSelectedReadingId(already ? null : `${roomId}:${wallId}`);

    const room = sketch.rooms.find((r) => r.id === roomId);
    const run: [number, number] = room ? exposedRunAt(room, wallId, sketch.rooms, t) : [0, 1];

    setLayer((prev) => {
      const data = roomMoisture(prev, roomId);
      const existing = data.wallReadings.some((r) => r.wallId === wallId);
      if (existing) {
        return setRoomMoisture(prev, roomId, { ...data, wallReadings: data.wallReadings.filter((r) => r.wallId !== wallId) });
      }
      return setRoomMoisture(prev, roomId, {
        ...data,
        wallReadings: [
          ...data.wallReadings,
          {
            id: `${roomId}:${wallId}`,
            wallId,
            startT: run[0],
            endT: run[1],
            affectedHeightFeet: 0,
            material: "drywall",
            reading: null,
            dryStandard: null,
          },
        ],
      });
    });
  }

  /**
   * A tap that landed on an existing mark rather than on bare wall.
   *
   * A mark draws its own tap target over the wall it covers, so once a wall is marked the wall
   * itself can no longer be tapped — every later tap arrives here instead. In this picker that has
   * to mean the same thing the first tap did: toggle the wall out. Treating it as "select" would
   * make the hint above a lie and leave no way to unmark a wall at all.
   */
  function handleMarkTapped(roomId: string, readingId: string | null) {
    if (!readingId) {
      setSelectedReadingId(null);
      return;
    }
    // The room now comes with the tap, so the mark is found in its own room rather than by
    // searching every room for the id.
    const hit = roomMoisture(layer, roomId).wallReadings.find((r) => r.id === readingId);
    // Toggling off, so the run does not matter — the mark's own start keeps it truthful anyway.
    if (hit) handleTapWall(roomId, hit.wallId, hit.startT);
    else setSelectedReadingId(readingId);
  }

  function handleResize(roomId: string, readingId: string, startT: number, endT: number) {
    setLayer((prev) => {
      const data = roomMoisture(prev, roomId);
      return setRoomMoisture(prev, roomId, {
        ...data,
        wallReadings: data.wallReadings.map((r) => (r.id === readingId ? { ...r, startT, endT } : r)),
      });
    });
  }

  function handlePaint(roomId: string, cells: string[], erase: boolean) {
    if (cells.length === 0) return;
    setLayer((prev) => {
      const data = roomMoisture(prev, roomId);
      const next = new Set(data.floorCells);
      for (const cell of cells) {
        if (erase) next.delete(cell);
        else next.add(cell);
      }
      if (next.size === data.floorCells.length) return prev;
      return setRoomMoisture(prev, roomId, { ...data, floorCells: [...next] });
    });
  }

  const noop = () => {};

  return (
    <div className="scope-picker-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scope-picker">
        <div className="scope-picker-head">
          <div>
            <h3>Mark it on the sketch</h3>
            <p className="field-note">{title}</p>
          </div>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>

        {sketch.rooms.length === 0 ? (
          <p className="field-note">There is no sketch on this claim yet. Draw one first, then mark quantities from it.</p>
        ) : (
          <>
            <div className="sketch-toolbar" role="toolbar" aria-label="Marking tools">
              {measure === "floorArea" && (
                <div className="option-group" role="group" aria-label="Marking tool">
                  {([
                    { value: "paint", label: "Highlight" },
                    { value: "erase", label: "Erase" },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`option-btn${tool === option.value ? " selected" : ""}`}
                      aria-pressed={tool === option.value}
                      onClick={() => setTool(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="sketch-zoom">
                <button type="button" className="btn-secondary" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, scale: clampZoom(v.scale / 1.2) }))}>
                  −
                </button>
                <span className="sketch-zoom-level">{Math.round(view.scale * 100)}%</span>
                <button type="button" className="btn-secondary" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, scale: clampZoom(v.scale * 1.2) }))}>
                  +
                </button>
              </div>
            </div>

            <p className="field-note sketch-hint">
              {measure === "wallRun"
                ? "Tap each wall this applies to. Tap again to remove it, or drag either end to cover part of a wall."
                : "Drag across the floor to mark the area. Pinch to zoom."}
            </p>

            <div className="sketch-canvas-wrap" ref={containerRef}>
              <SketchCanvas
                rooms={sketch.rooms}
                width={width}
                height={CANVAS_HEIGHT}
                view={view}
                tool="select"
                showSizes
                moisture={layer}
                showMoisture
                markStyle="scope"
                moistureTool={tool}
                paintSurface="floor"
                selectedReadingId={selectedReadingId}
                selectedRoomId={selectedRoomId}
                selectedSymbolId={null}
                onViewChange={setView}
                onSelectRoom={setSelectedRoomId}
                onSelectSymbol={noop}
                onTapWallForReading={handleTapWall}
                onSelectReading={handleMarkTapped}
                onResizeReading={handleResize}
                onPaintFloor={(roomId, cells, erase) => handlePaint(roomId, cells, erase)}
                /* Every geometry callback is inert: this picker reads the plan, it never edits it. */
                onMoveRoom={noop}
                onTapWall={noop}
                onPlaceSymbol={noop}
                onSplitWall={noop}
                onDragWall={noop}
                onDragWallEnd={noop}
                onRenameRoom={noop}
                onMoveVertex={noop}
                onRemoveVertex={noop}
                onMoveSymbol={noop}
                onResizeSymbol={noop}
                onPlaceIsland={noop}
                onMoveIsland={noop}
                onResizeIsland={noop}
              />
            </div>

            <div className="scope-picker-foot">
              <div className="scope-picker-total">
                <span className="scope-picker-value">{rounded}</span>
                <span className="scope-picker-unit">{unit}</span>
                <span className="field-note">
                  {measure === "wallRun"
                    ? `${mark.walls.length} ${mark.walls.length === 1 ? "wall" : "walls"} marked`
                    : "marked on the floor"}
                </span>
              </div>
              <div className="actions-row">
                <button type="button" className="btn-secondary" onClick={() => setLayer(toCanvasLayer(emptyScopeMark()))} disabled={!hasScopeMark(mark)}>
                  Clear
                </button>
                <button type="button" className="btn-primary" onClick={() => onUse(mark, `${rounded} ${unit}`)} disabled={!hasScopeMark(mark) || rounded <= 0}>
                  Use {rounded} {unit}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
