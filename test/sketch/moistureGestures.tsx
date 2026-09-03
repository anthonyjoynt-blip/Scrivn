"use client";

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import Konva from "konva";
import SketchCanvas from "@/components/sketch/SketchCanvas";
import { PIXELS_PER_FOOT, type SketchRoom, roomBounds, wallsOf } from "@/lib/sketch";
import {
  type MoistureMap,
  cellCentreWorld,
  cellsAlongStroke,
  cellsUnderBrush,
  emptyMoistureMap,
  parseCellKey,
  setRoomMoisture,
} from "@/lib/moisture";
import { gesturesFor } from "./gestures";

/**
 * Regression tests for moisture mapping on the canvas.
 *
 * Three properties matter here and none of them can be checked by reading the geometry maths:
 *
 *   1. Painting stays inside the room. The area feeds an equipment calculation, so a brush that
 *      spills past a wall inflates a number someone orders driers against.
 *   2. The geometry is read-only while mapping. The room was drawn once; a stray drag that resizes
 *      it while the PM is marking damage would silently change every quantity already recorded.
 *   3. A wall tap records a reading rather than editing the wall's length, which is what the same
 *      tap means in the other mode.
 */

interface Call {
  name: string;
  args: unknown[];
}

const results: { ok: boolean; message: string }[] = [];
function check(ok: boolean, message: string) {
  results.push({ ok, message });
}

/** Mounts the real canvas in moisture mode and records every callback. */
function mount(
  room: SketchRoom,
  moisture: MoistureMap,
  moistureTool: "read" | "paint" | "erase" | null,
  surface: "floor" | "ceiling" = "floor",
) {
  const host = document.getElementById("stage") ?? document.body.appendChild(document.createElement("div"));
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };

  createRoot(host).render(
    createElement(SketchCanvas, {
      rooms: [room],
      width: 700,
      height: 460,
      view: { x: 0, y: 0, scale: 1 },
      tool: "select" as const,
      showSizes: false,
      moisture,
      showMoisture: true,
      moistureTool,
      paintSurface: surface,
      selectedReadingId: null,
      onSelectReading: record("onSelectReading"),
      onResizeReading: record("onResizeReading"),
      selectedRoomId: room.id,
      selectedSymbolId: null,
      onViewChange: record("onViewChange"),
      onSelectRoom: record("onSelectRoom"),
      onSelectSymbol: record("onSelectSymbol"),
      onMoveRoom: record("onMoveRoom"),
      onTapWall: record("onTapWall"),
      onTapWallForReading: record("onTapWallForReading"),
      onPaintFloor: record("onPaintFloor"),
      onPlaceSymbol: record("onPlaceSymbol"),
      onSplitWall: record("onSplitWall"),
      onDragWall: record("onDragWall"),
      onDragWallEnd: record("onDragWallEnd"),
      onRenameRoom: record("onRenameRoom"),
      onMoveVertex: record("onMoveVertex"),
      onRemoveVertex: record("onRemoveVertex"),
      onMoveSymbol: record("onMoveSymbol"),
      onResizeSymbol: record("onResizeSymbol"),
      onPlaceIsland: record("onPlaceIsland"),
      onMoveIsland: record("onMoveIsland"),
      onResizeIsland: record("onResizeIsland"),
    }),
  );

  return {
    calls,
    // Resolved lazily: React renders asynchronously, so no stage exists at the moment this returns.
    stage: () => {
      const stage = Konva.stages[Konva.stages.length - 1];
      if (!stage) throw new Error("SketchCanvas did not create a stage");
      return stage;
    },
    reset: () => (calls.length = 0),
  };
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);
const paintedCells = (calls: Call[]) => named(calls, "onPaintFloor").flatMap((c) => c.args[1] as string[]);

const rect = (x: number, y: number, wFt: number, hFt: number): SketchRoom => ({
  id: "room-1",
  name: "Basement",
  ceilingHeightFeet: 8,
  ceilingType: "flat",
  ceilingPeakFeet: null,
  stairs: null,
  parentRoomId: null,
  nestingOptOut: false,
  symbols: [],
  // An island cabinet sitting in the room — the thing that was being grabbed by mistake.
  freeCabinets: [
    {
      id: "island-1",
      x: 40,
      y: 40,
      widthPx: 36,
      depthPx: 24,
      widthFeet: 3,
      depthFeet: 2,
      label: "Island",
      tier: "base",
    },
  ],
  vertices: [
    { id: "a", x, y },
    { id: "b", x: x + wFt * PIXELS_PER_FOOT, y },
    { id: "c", x: x + wFt * PIXELS_PER_FOOT, y: y + hFt * PIXELS_PER_FOOT },
    { id: "d", x, y: y + hFt * PIXELS_PER_FOOT },
  ],
});

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  const room = rect(120, 120, 18, 14);
  const bounds = roomBounds(room);
  const mid = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };

  // ── painting ────────────────────────────────────────────────────────────────────────────────
  {
    const { calls, stage, reset } = mount(room, emptyMoistureMap(), "paint");
    await new Promise((r) => setTimeout(r, 150));
    const g = gesturesFor(stage());

    reset();
    g.drag(mid, 90, 0);
    const cells = paintedCells(calls);
    check(cells.length > 0, `dragging across the floor paints cells (got ${cells.length})`);
    check(
      named(calls, "onPaintFloor").every((c) => c.args[2] === false),
      "the paint tool adds rather than erases",
    );

    // Every painted cell must be inside the room — this is the number equipment gets ordered against.
    const outside = cells.filter((key) => {
      const parsed = parseCellKey(key);
      if (!parsed) return true;
      const centre = cellCentreWorld(room, parsed.col, parsed.row);
      return !centre || centre.x < bounds.minX || centre.x > bounds.maxX || centre.y < bounds.minY || centre.y > bounds.maxY;
    });
    check(outside.length === 0, `no painted cell falls outside the room (${outside.length} did)`);

    // A stroke must be continuous, not a dab at each end.
    const cols = [...new Set(cells.map((k) => parseCellKey(k)?.col ?? -1))].sort((a, b) => a - b);
    let gaps = 0;
    for (let i = 1; i < cols.length; i++) if (cols[i] !== (cols[i - 1] ?? 0) + 1) gaps++;
    check(gaps === 0, `the stroke is continuous across ${cols.length} columns (${gaps} gaps)`);

    // Painting must not also move or reshape the room.
    check(named(calls, "onMoveRoom").length === 0, "painting does not move the room");
    check(named(calls, "onMoveVertex").length === 0, "painting does not reshape the room");

    // Starting a stroke outside every room must paint nothing at all.
    reset();
    g.drag({ x: bounds.minX - 60, y: bounds.minY - 60 }, 40, 40);
    check(paintedCells(calls).length === 0, "a stroke started outside the room paints nothing");
  }

  // ── erasing ─────────────────────────────────────────────────────────────────────────────────
  {
    const painted = cellsUnderBrush(room, mid, 40);
    const withPaint = setRoomMoisture(emptyMoistureMap(), room.id, {
      wallReadings: [],
      floorCells: painted,
      ceilingCells: [],
      insetsOver18Inches: 0,
    });
    const { calls, stage, reset } = mount(room, withPaint, "erase");
    await new Promise((r) => setTimeout(r, 150));
    const g = gesturesFor(stage());

    reset();
    g.drag(mid, 40, 0);
    check(paintedCells(calls).length > 0, "the erase tool reports cells to remove");
    check(
      named(calls, "onPaintFloor").every((c) => c.args[2] === true),
      "the erase tool removes rather than adds",
    );
  }

  // ── the ceiling is a separate surface on the same grid ──────────────────────────────────────
  {
    const { calls, stage, reset } = mount(room, emptyMoistureMap(), "paint", "ceiling");
    await new Promise((r) => setTimeout(r, 150));
    const g = gesturesFor(stage());

    reset();
    g.drag(mid, 60, 0);
    const painted = named(calls, "onPaintFloor");
    check(painted.length > 0, "the brush paints with the ceiling surface selected");
    check(
      painted.every((c) => c.args[3] === "ceiling"),
      `every stroke is reported against the ceiling (got ${JSON.stringify(painted.map((c) => c.args[3]).slice(0, 3))})`,
    );
    check(paintedCells(calls).length > 0, "ceiling strokes produce cells like floor strokes do");
  }

  // ── wall readings, and read-only geometry ───────────────────────────────────────────────────
  {
    const { calls, stage, reset } = mount(room, emptyMoistureMap(), "read");
    await new Promise((r) => setTimeout(r, 150));
    const g = gesturesFor(stage());
    const walls = wallsOf(room);
    const topWall = walls[0];
    if (!topWall) throw new Error("fixture has no walls");
    const onWall = { x: (topWall.x1 + topWall.x2) / 2 - 40, y: topWall.y1 };

    reset();
    g.tap(onWall);
    const taps = named(calls, "onTapWallForReading");
    check(taps.length === 1, `tapping a wall records a reading (got ${taps.length})`);
    check(taps[0]?.args[1] === topWall.id, "the reading lands on the wall that was tapped");
    check(named(calls, "onTapWall").length === 0, "tapping a wall does NOT open the length editor while mapping");

    // The room was drawn once. Nothing in this mode may change its geometry or position.
    reset();
    g.drag(mid, 50, 30);
    check(named(calls, "onMoveRoom").length === 0, "the room cannot be dragged while mapping");
    reset();
    const corner = room.vertices[2];
    if (corner) {
      g.drag({ x: corner.x, y: corner.y }, 30, 30);
      check(named(calls, "onMoveVertex").length === 0, "a corner cannot be dragged while mapping");
    }
    reset();
    g.drag(onWall, 0, 30);
    check(named(calls, "onDragWall").length === 0, "a wall cannot be pulled while mapping");

    /*
      The reported bug: reaching for the end of a wall mark next to a cabinet grabbed the cabinet.

      Symbols and islands each carry their own drag pad, so switching off the room group's drag left
      them live. Nothing in the sketch may be edited from this mode — the room was drawn once, and a
      cabinet that shifts while damage is being marked changes the plan the readings describe.
    */
    const island = room.freeCabinets[0];
    if (island) {
      const at = { x: bounds.minX + island.x + island.widthPx / 2, y: bounds.minY + island.y + island.depthPx / 2 };
      reset();
      g.drag(at, 40, 25);
      check(named(calls, "onMoveIsland").length === 0, "a cabinet cannot be dragged while mapping");
      check(named(calls, "onResizeIsland").length === 0, "a cabinet cannot be resized while mapping");
      check(named(calls, "onSelectSymbol").length === 0, "a cabinet cannot even be selected while mapping");
    } else {
      check(false, "the fixture lost its island cabinet");
    }
  }

  // ── the same cabinet, in sketch mode, must still be draggable ───────────────────────────────
  {
    // The control for the lock above: if this also failed, the cabinet would simply be broken
    // everywhere and the moisture-mode assertions would be passing for the wrong reason.
    const { calls, stage, reset } = mount(room, emptyMoistureMap(), null);
    await new Promise((r) => setTimeout(r, 150));
    const g = gesturesFor(stage());
    const island = room.freeCabinets[0];
    if (island) {
      const at = { x: bounds.minX + island.x + island.widthPx / 2, y: bounds.minY + island.y + island.depthPx / 2 };
      reset();
      g.drag(at, 30, 20);
      check(named(calls, "onMoveIsland").length > 0, "the same cabinet IS draggable back in sketch mode");
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results };
}

/**
 * Leaves a fully marked-up room on screen after the assertions run.
 *
 * The tests can prove a cell was painted and a callback fired; they cannot tell whether the ramp
 * reads as one scale getting worse, or whether the floor wash drowns the walls underneath it. That
 * needs an eye, so the page ends with something to look at.
 */
export async function renderShowcase(): Promise<void> {
  const room = rect(120, 120, 18, 14);
  const walls = wallsOf(room);
  const bands: { reading: number; dryStandard: number | null; material: "drywall" | "concrete" }[] = [
    { reading: 0.8, dryStandard: 0.75, material: "drywall" },
    { reading: 1.05, dryStandard: 0.75, material: "drywall" },
    { reading: 1.8, dryStandard: 0.75, material: "drywall" },
    { reading: 9, dryStandard: null, material: "concrete" },
  ];

  const map = setRoomMoisture(emptyMoistureMap(), room.id, {
    wallReadings: walls.slice(0, 4).map((wall, i) => ({
      id: `showcase-${i}`,
      wallId: wall.id,
      // A partial run on two of them, so the showcase shows what a non-full-wall mark looks like.
      startT: i % 2 === 0 ? 0 : 0.25,
      endT: i % 2 === 0 ? 1 : 0.75,
      affectedHeightFeet: [1, 2, 2.5, 1.5][i] ?? 2,
      material: bands[i]?.material ?? "drywall",
      reading: bands[i]?.reading ?? null,
      dryStandard: bands[i]?.dryStandard ?? null,
    })),
    floorCells: cellsAlongStroke(room, { x: 160, y: 180 }, { x: 300, y: 240 }, 34),
    ceilingCells: cellsAlongStroke(room, { x: 290, y: 160 }, { x: 340, y: 190 }, 26),
    insetsOver18Inches: 2,
  });

  mount(room, map, "read");
  await new Promise((r) => setTimeout(r, 200));
}
